"""Session Replay 跨平台共享指标核心。"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Literal


TimedCallBucket = Literal[
    "foreground_exec",
    "background_exec",
    "human_wait",
    "agent_wait",
    "unclassified_wait",
]

TASK_TYPE_PATTERN = re.compile(r"<task_type>([^<]+)</task_type>")
WALL_BUCKETS = (
    "foreground_exec",
    "background_exec",
    "human_wait",
    "agent_wait",
    "unclassified_wait",
    "thinking",
    "boundary_idle",
)
_BUCKET_PRIORITY = {
    bucket: priority
    for priority, bucket in enumerate(
        (
            "foreground_exec",
            "background_exec",
            "human_wait",
            "agent_wait",
            "unclassified_wait",
        )
    )
}


def _parse_timestamp(value: object) -> float | None:
    """把 ISO 时间转换为 epoch 秒，非法值返回 None。"""

    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


def _iter_jsonl_objects(path: Path, limit: int | None = None):
    """逐行读取 JSON 对象；坏编码、坏 JSON 和非对象记录均跳过。"""

    try:
        with path.open(encoding="utf-8", errors="replace") as source:
            for index, line in enumerate(source):
                if limit is not None and index >= limit:
                    break
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(record, dict):
                    yield record
    except OSError:
        return


def _message_content(record: dict) -> object:
    """安全读取事件 message.content。"""

    message = record.get("message")
    return message.get("content") if isinstance(message, dict) else None


def detect_replay_provider(data: dict) -> Literal["claude", "codex"]:
    """识别回放来源；兼容 provider 字段引入前的历史产物。"""

    provider = str(data.get("provider") or "").strip().lower()
    if provider in {"claude", "codex"}:
        return provider

    transcript = Path(str(data.get("transcript") or ""))
    normalized_path = str(transcript).replace("\\", "/").lower()
    if "/.claude/" in normalized_path:
        return "claude"
    if "/.codex/" in normalized_path:
        return "codex"

    # 临时目录中的测试夹具和搬迁后的旧文件没有平台路径，只能按事件 schema 识别。
    for record in _iter_jsonl_objects(transcript, limit=50):
        record_type = record.get("type")
        if record_type in {"event_msg", "response_item", "session_meta"}:
            return "codex"
        content = _message_content(record)
        if record_type in {"user", "assistant", "progress", "system"}:
            return "claude"
        if isinstance(content, list) and any(
            block.get("type") in {"tool_use", "tool_result"}
            for block in content
            if isinstance(block, dict)
        ):
            return "claude"
    return "codex"


def _iter_subagents(data: dict):
    """递归遍历子代理，供补充 effort 汇总。"""

    for child in data.get("subagents", []) or []:
        yield child
        yield from _iter_subagents(child)


def summarize_claude_replay(data: dict, gap_threshold: float) -> dict | None:
    """从 Claude transcript 配对 tool_use/tool_result 并生成统一时长指标。"""

    transcript = Path(str(data.get("transcript") or ""))
    if not transcript.is_file():
        return None

    wall = data.get("duration_seconds") or 0
    started = _parse_timestamp(data.get("started_at"))
    ended = _parse_timestamp(data.get("ended_at"))
    tool_use: dict[str, tuple[float, str]] = {}
    tool_result: dict[str, tuple[float, object]] = {}
    activity_points: list[float] = []

    for record in _iter_jsonl_objects(transcript):
        timestamp = _parse_timestamp(record.get("timestamp"))
        if timestamp is None:
            continue
        # resumed transcript 可能继续增长，只统计导出快照覆盖的时间窗口。
        if started is not None and timestamp < started:
            continue
        if ended is not None and timestamp > ended:
            continue
        content = _message_content(record)
        if isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                block_type = block.get("type")
                if block_type == "tool_use" and isinstance(block.get("id"), str):
                    tool_use[block["id"]] = (
                        timestamp,
                        block.get("name") or "?",
                    )
                elif block_type == "tool_result" and block.get("tool_use_id"):
                    tool_result[str(block["tool_use_id"])] = (
                        timestamp,
                        block.get("content") or "",
                    )
        activity_points.append(timestamp)

    intervals: list[dict] = []
    by_name: dict[str, float] = {}
    for tool_id, (call_start, name) in tool_use.items():
        result = tool_result.get(tool_id)
        if result is None:
            continue
        call_end, content = result
        if call_end < call_start:
            continue
        duration = call_end - call_start
        by_name[name] = by_name.get(name, 0.0) + duration
        intervals.append(
            {
                "name": name,
                "result": content,
                "started_at": call_start,
                "ended_at": call_end,
                "duration_seconds": duration,
            }
        )

    if not activity_points:
        return None
    if started is None:
        started = min(
            [call["started_at"] for call in intervals] + activity_points,
            default=0.0,
        )
    if ended is None or ended <= started:
        ended = (
            started + float(wall)
            if wall
            else max(
                [call["ended_at"] for call in intervals] + activity_points,
                default=started,
            )
        )

    timeline = summarize_timeline(
        intervals,
        started_at=started,
        ended_at=ended,
        gap_threshold=gap_threshold,
        activity_points=activity_points,
    )
    active = timeline["foreground_exec"] + timeline["background_exec"]
    subagent_duration = sum(
        child.get("duration_seconds") or 0 for child in _iter_subagents(data)
    )
    return {
        **timeline,
        "active": round(active, 1),
        "subagent_duration": round(subagent_duration, 1),
        "by_tool": {
            key: round(value, 1)
            for key, value in sorted(by_name.items(), key=lambda pair: -pair[1])
        },
    }


def classify_timed_call(call: dict) -> TimedCallBucket:
    """按工具与 task_type 将 timed call 映射到唯一墙钟 bucket。"""

    name = call.get("name") or "?"
    if name == "AskUserQuestion":
        return "human_wait"
    if name in {"CollabAgent:wait", "CollabAgentToolCall:wait"}:
        return "agent_wait"
    if name == "TaskOutput":
        match = TASK_TYPE_PATTERN.search(str(call.get("result") or ""))
        task_type = match.group(1).strip() if match else ""
        if task_type == "local_bash":
            return "background_exec"
        if task_type == "local_agent":
            return "agent_wait"
        return "unclassified_wait"
    return "foreground_exec"


def summarize_timeline(
    intervals: list[dict],
    started_at: float,
    ended_at: float,
    gap_threshold: float,
    activity_points: list[float] | None = None,
) -> dict[str, float]:
    """将 timed-call 区间与空白时间切分为互斥墙钟 bucket。"""

    start = float(started_at)
    end = float(ended_at)
    summary = {bucket: 0.0 for bucket in WALL_BUCKETS}
    if end <= start:
        return {
            **summary,
            "wall": 0.0,
            "tool_span_union": 0.0,
            "closure_gap": 0.0,
            "gap_threshold": float(gap_threshold),
        }

    normalized: list[tuple[float, float, TimedCallBucket]] = []
    points = {start, end}
    points.update(
        float(point)
        for point in activity_points or []
        if isinstance(point, (int, float)) and start <= float(point) <= end
    )
    for call in intervals:
        call_start = call.get("started_at")
        call_end = call.get("ended_at")
        if not isinstance(call_start, (int, float)) or not isinstance(
            call_end, (int, float)
        ):
            continue
        clipped_start = max(start, float(call_start))
        clipped_end = min(end, float(call_end))
        if clipped_end <= clipped_start:
            continue
        normalized.append(
            (clipped_start, clipped_end, classify_timed_call(call))
        )
        points.update((clipped_start, clipped_end))

    ordered_points = sorted(points)
    for segment_start, segment_end in zip(ordered_points, ordered_points[1:]):
        duration = segment_end - segment_start
        midpoint = (segment_start + segment_end) / 2
        covered = [
            bucket
            for interval_start, interval_end, bucket in normalized
            if interval_start <= midpoint < interval_end
        ]
        if covered:
            bucket = min(covered, key=_BUCKET_PRIORITY.__getitem__)
        elif duration > gap_threshold:
            bucket = "boundary_idle"
        else:
            bucket = "thinking"
        summary[bucket] += duration

    wall = end - start
    tool_span_union = sum(summary[bucket] for bucket in WALL_BUCKETS[:5])
    rounded = {key: round(value, 1) for key, value in summary.items()}
    return {
        **rounded,
        "wall": round(wall, 1),
        "tool_span_union": round(tool_span_union, 1),
        "closure_gap": round(wall - sum(summary.values()), 1),
        "gap_threshold": float(gap_threshold),
    }


def strip_shell_wrapper(command: str) -> str:
    """移除 Codex Windows transcript 中的 PowerShell runtime 包装。"""

    text = re.sub(
        r'^.*?[\\/](?:pwsh|powershell)(?:\.exe)?"?\s+-Command\s+',
        "",
        command,
        flags=re.IGNORECASE,
    )
    return re.sub(
        r'^(?:pwsh|powershell)(?:\.exe)?"?\s+-Command\s+',
        "",
        text,
        flags=re.IGNORECASE,
    )


def normalize_command_key(command: str) -> str:
    """返回用于重复聚类的完整规范化命令，不做展示截断。"""

    text = re.sub(r"\s*\\\s*\n\s*", " ", command or "")
    text = re.sub(r"\s+", " ", text).strip()
    return strip_shell_wrapper(text)


def display_command(command: str, limit: int = 110) -> str:
    """仅在展示层截断命令，并用省略号标记。"""

    return command if len(command) <= limit else command[: limit - 1] + "…"
