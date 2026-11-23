#!/usr/bin/env python3
"""对统一 replay.json 生成第一层确定性指标，兼容 Codex 回放。"""

from __future__ import annotations

import argparse
import io
import json
import re
import statistics
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path


for _name in ("stdout", "stderr"):
    _stream = getattr(sys, _name)
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass
    if (getattr(_stream, "encoding", "") or "").lower() != "utf-8":
        try:
            setattr(sys, _name, io.TextIOWrapper(_stream.buffer, encoding="utf-8"))
        except Exception:
            pass


ROOT = Path(__file__).resolve().parents[4]
DEFAULT_REPLAY_ROOT = ROOT / "projects" / "replay"
METRICS_ROOT = Path(__file__).resolve().parent
if str(METRICS_ROOT) not in sys.path:
    # 支持按文件路径加载 analyzer，同时复用共享指标核心。
    sys.path.insert(0, str(METRICS_ROOT))

from metrics_core import (
    detect_replay_provider,
    display_command,
    normalize_command_key,
    summarize_claude_replay,
    summarize_timeline,
)


SYSTEM_USER_PATTERNS = (
    re.compile(r"^\s*<task-notification>"),
    re.compile(r"^\s*<system-reminder>"),
    re.compile(r"^\s*<local-command-"),
)
COMMAND_TOOLS = frozenset({"Bash", "CommandExecution"})
PYTHON_TRACEBACK = re.compile(
    r"(?ms)^Traceback \(most recent call last\):\s*\n.+\n"
    r"(?P<exception>[A-Za-z_][\w.]*)(?::\s*[^\n]+)?\s*$"
)


def load_replay(target: str | None) -> tuple[dict, Path]:
    """加载指定 replay.json，未指定时取最新导出。"""

    if target:
        path = Path(target)
        if path.is_dir():
            path = path / "replay.json"
        if not path.exists():
            raise FileNotFoundError(f"未找到 replay.json: {path}")
    else:
        candidates = sorted(DEFAULT_REPLAY_ROOT.glob("*/replay.json"))
        if not candidates:
            raise FileNotFoundError(f"{DEFAULT_REPLAY_ROOT} 下没有任何导出")
        path = candidates[-1]
    return json.loads(path.read_text(encoding="utf-8")), path


# 保留旧名称，兼容现有调用方；聚类语义由共享核心统一。
normalize_cmd = normalize_command_key


def error_signature(result: str, limit: int = 90) -> str:
    text = re.sub(r"\s+", " ", result or "").strip()
    text = re.sub(r"[A-Za-z]:\\[^\s\"']+", "<path>", text)
    text = re.sub(r"/[\w./-]{8,}", "<path>", text)
    text = re.sub(r"\b[0-9a-f]{8}-[0-9a-f-]{20,}\b", "<guid>", text)
    text = re.sub(r"\b\d{4,}\b", "<num>", text)
    return text[:limit]


def iter_calls(node: dict, scope: str):
    for turn in node.get("turns", []) or []:
        if turn.get("kind") != "assistant":
            continue
        for call in turn.get("tools", []) or []:
            yield scope, turn.get("ts", ""), call
    for child in node.get("subagents", []) or []:
        label = f"{child.get('agent_type', 'subagent')}#{(child.get('agent_id') or '')[:8]}"
        yield from iter_calls(child, label)


def iter_subagents(node: dict):
    for child in node.get("subagents", []) or []:
        yield child
        yield from iter_subagents(child)


def is_real_user_turn(turn: dict) -> bool:
    if turn.get("kind") != "user":
        return False
    text = (turn.get("text") or "").strip()
    return bool(text) and not any(pattern.match(text) for pattern in SYSTEM_USER_PATTERNS)


def metric_overview(
    data: dict, calls: list, canonical_wall: float | None = None
) -> dict:
    stats = data.get("stats", {}) or {}
    children = list(iter_subagents(data))
    total = (
        canonical_wall
        if canonical_wall is not None
        else data.get("duration_seconds") or 0
    )
    child_seconds = sum(child.get("duration_seconds") or 0 for child in children)
    failures = [call for _, _, call in calls if not call.get("ok")]
    users = [turn for turn in data.get("turns", []) if is_real_user_turn(turn)]
    # 缺失字段代表旧回放没有覆盖证据，不能默认当作完整可观测。
    hook_status = stats.get("hook_observability", "unknown")
    observed_hook_blocks = len(stats.get("hook_blocks") or [])
    return {
        "session_id": data.get("session_id"),
        "started_at": data.get("started_at"),
        "duration_seconds": total,
        "duration_human": f"{total / 3600:.2f}h",
        "first_prompt": (data.get("first_prompt") or "")[:120],
        "assistant_turns": stats.get("assistant_turns"),
        "calls_total": len(calls),
        "calls_failed": len(failures),
        "fail_rate": round(len(failures) / len(calls), 3) if calls else 0,
        "subagent_count": len(children),
        "subagent_seconds": round(child_seconds, 1),
        "subagent_share": round(child_seconds / total, 3) if total else 0,
        "real_user_turns": len(users),
        "hook_observability": hook_status,
        "hook_blocks": observed_hook_blocks if hook_status == "available" else None,
        "hook_blocks_observed": observed_hook_blocks,
        "output_tokens": (stats.get("tokens") or {}).get("output_tokens"),
    }


def metric_repeats(calls: list, threshold: int) -> list:
    counter = Counter()
    for scope, _, call in calls:
        if call.get("name") not in COMMAND_TOOLS:
            continue
        counter[(scope, normalize_command_key(call.get("input_summary") or ""))] += 1
    return [
        {"scope": scope, "count": count, "command": command}
        for (scope, command), count in counter.most_common()
        if count >= threshold
    ]


def metric_failures(calls: list) -> dict:
    clusters: dict[tuple, dict] = {}
    by_tool = Counter()
    for scope, timestamp, call in calls:
        if call.get("ok"):
            continue
        name = call.get("name") or "?"
        by_tool[name] += 1
        signature = error_signature(call.get("result") or "")
        key = (name, signature)
        row = clusters.setdefault(
            key,
            {
                "tool": name,
                "signature": signature,
                "count": 0,
                "scopes": set(),
                "first_ts": timestamp,
                "sample_input": re.sub(r"\s+", " ", call.get("input_summary") or "").strip()[:160],
            },
        )
        row["count"] += 1
        row["scopes"].add(scope)
    rows = sorted(clusters.values(), key=lambda row: -row["count"])
    for row in rows:
        row["scopes"] = sorted(row["scopes"])[:4]
    return {"by_tool": by_tool.most_common(), "clusters": rows}


def diagnose_command_result(result: str, command: str = "") -> tuple[str, str] | None:
    """诊断单条公开命令结果，返回 (signature, confidence)。"""

    traceback_match = PYTHON_TRACEBACK.search(result or "")
    if traceback_match:
        return error_signature(traceback_match.group(0)), "high"
    # shell 回退会掩盖左侧退出码；usage 只能证明执行了回退，不能证明原命令失败。
    if "||" in (command or "") and re.search(r"(?im)^usage:\s*", result or ""):
        return "检测到 --help/usage 回退迹象，原命令结果未知", "fallback_unknown"
    return None


def metric_command_anomalies(calls: list) -> list:
    """从命令工具的公开结果提取独立异常信号，不改变 call.ok。"""

    rows = []
    for scope, timestamp, call in calls:
        if call.get("name") not in COMMAND_TOOLS:
            continue
        result = call.get("result") or ""
        command = call.get("input_summary") or ""
        diagnosis = diagnose_command_result(result, command)
        if diagnosis:
            signature, confidence = diagnosis
            rows.append(
                {
                    "scope": scope,
                    "timestamp": timestamp,
                    "tool": call.get("name"),
                    "signature": signature,
                    "confidence": confidence,
                }
            )
    return rows


def metric_subagents(data: dict) -> list:
    children = list(iter_subagents(data))
    if not children:
        return []
    durations = [child.get("duration_seconds") or 0 for child in children]
    median = statistics.median(durations) if durations else 0
    rows = []
    for child in children:
        stats = child.get("stats", {}) or {}
        total = stats.get("tool_calls_total") or 0
        failed = stats.get("tool_errors_total") or 0
        duration = child.get("duration_seconds") or 0
        flags = []
        if total == 0:
            flags.append("空转(无工具调用)")
        if total and failed / total >= 0.3:
            flags.append(f"高失败率({failed}/{total})")
        if median and duration > median * 3:
            flags.append(f"耗时离群({duration / median:.1f}x中位数)")
        rows.append(
            {
                "agent_type": child.get("agent_type"),
                "description": (child.get("description") or "")[:60],
                "duration_seconds": round(duration, 1),
                "calls": total,
                "failed": failed,
                "flags": flags,
            }
        )
    return sorted(rows, key=lambda row: -row["duration_seconds"])


def metric_rework(data: dict, threshold: int) -> list:
    touched = (data.get("stats", {}) or {}).get("files_touched") or {}
    items = touched.items() if isinstance(touched, dict) else Counter(touched).items()
    return [
        {"file": path, "count": count}
        for path, count in sorted(items, key=lambda pair: -pair[1])
        if count >= threshold
    ]


def metric_interventions(data: dict) -> list:
    rows = []
    for turn in data.get("turns", []) or []:
        if is_real_user_turn(turn):
            text = re.sub(r"\s+", " ", turn.get("text") or "").strip()
            rows.append({"ts": turn.get("ts"), "text": text[:200]})
    return rows


def metric_tool_mix(calls: list) -> list:
    total = Counter()
    failed = Counter()
    for _, _, call in calls:
        name = call.get("name") or "?"
        total[name] += 1
        if not call.get("ok"):
            failed[name] += 1
    return [
        {"tool": name, "count": count, "failed": failed.get(name, 0)}
        for name, count in total.most_common()
    ]


def _parse_ts(value: object) -> float | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


def _call_interval(call: dict) -> tuple[float, float] | None:
    started = call.get("started_at")
    ended = call.get("ended_at")
    if not isinstance(started, (int, float)) or not isinstance(ended, (int, float)):
        return None
    # Codex item_completed 使用 epoch 毫秒；兼容测试与旧数据中的秒值。
    divisor = 1000.0 if max(abs(started), abs(ended)) > 10_000_000_000 else 1.0
    start_seconds = started / divisor
    end_seconds = ended / divisor
    return (start_seconds, end_seconds) if end_seconds >= start_seconds else None


def metric_duration(data: dict, gap_threshold: float) -> dict | None:
    """按回放来源选择时间解析方式并生成统一时长分解。"""

    if detect_replay_provider(data) == "claude":
        return summarize_claude_replay(data, gap_threshold)

    wall = data.get("duration_seconds") or 0
    calls = list(iter_calls(data, "MAIN"))
    main_calls = [call for scope, _, call in calls if scope == "MAIN"]
    timed_count = sum(_call_interval(call) is not None for call in main_calls)
    total_count = len(main_calls)
    timing_status = (
        "unavailable"
        if timed_count == 0
        else "available"
        if timed_count == total_count
        else "partial"
    )
    coverage = {
        "status": timing_status,
        "timed_calls": timed_count,
        "total_calls": total_count,
        "ratio": timed_count / total_count if total_count else None,
    }
    started = _parse_ts(data.get("started_at"))
    ended = _parse_ts(data.get("ended_at"))
    if not calls and not wall and not (
        started is not None and ended is not None and ended > started
    ):
        return None

    by_name: dict[str, float] = {}
    main_intervals: list[dict] = []
    for scope, _, call in calls:
        duration = call.get("duration_seconds")
        duration = float(duration) if isinstance(duration, (int, float)) else 0.0
        name = call.get("name") or "?"
        by_name[name] = by_name.get(name, 0.0) + duration
        if scope == "MAIN":
            interval = _call_interval(call)
            if interval:
                start, end = interval
                main_intervals.append(
                    {**call, "started_at": start, "ended_at": end}
                )

    children = list(iter_subagents(data))
    subagent_duration = sum(child.get("duration_seconds") or 0 for child in children)
    activity_points = [
        parsed
        for turn in data.get("turns", []) or []
        if (parsed := _parse_ts(turn.get("ts"))) is not None
    ]
    if started is None or ended is None or ended <= started:
        if started is None:
            started = min(
                [call["started_at"] for call in main_intervals] + activity_points,
                default=0.0,
            )
        ended = (
            started + float(wall)
            if wall
            else max(
                [call["ended_at"] for call in main_intervals] + activity_points,
                default=started,
            )
        )
    timeline = summarize_timeline(
        main_intervals,
        started_at=started,
        ended_at=ended,
        gap_threshold=gap_threshold,
        activity_points=activity_points,
    )
    active = timeline["foreground_exec"] + timeline["background_exec"]
    if timing_status == "unavailable":
        # 墙钟和子代理 effort 仍有独立证据；墙钟 bucket 缺少工具区间证据时不可报告伪零。
        for key in (
            "foreground_exec",
            "background_exec",
            "human_wait",
            "agent_wait",
            "unclassified_wait",
            "thinking",
            "boundary_idle",
            "closure_gap",
        ):
            timeline[key] = None
    return {
        **timeline,
        "active": None if timing_status == "unavailable" else round(active, 1),
        "subagent_duration": round(subagent_duration, 1),
        "by_tool": None if timing_status == "unavailable" else {
            key: round(value, 1)
            for key, value in sorted(by_name.items(), key=lambda pair: -pair[1])
        },
        "timing_coverage": coverage,
    }


def _fmt_sec(seconds: float) -> str:
    return f"{seconds:.0f}s（{seconds / 60:.1f}min）"


def _format_timing_coverage(coverage: dict) -> str:
    """格式化 MAIN 计时覆盖，避免把无调用显示成 0%。"""

    calls = f"{coverage['timed_calls']}/{coverage['total_calls']}"
    if coverage.get("ratio") is None:
        return f"MAIN 计时覆盖 {calls}（不适用）"
    return f"MAIN 计时覆盖 {calls} ({coverage['ratio']:.1%})"


def render_markdown(report: dict, source: Path) -> str:
    overview = report["overview"]
    duration = report.get("duration")
    lines = [
        f"# 回放分析 · {overview['session_id']}",
        "",
        f"来源：`{source}`",
        "",
        "## 概览",
        "",
        "| 项 | 值 |",
        "| --- | --- |",
        f"| 初始诉求 | `{overview['first_prompt']}` |",
        f"| 墙钟 | {overview['duration_human']}（{overview['duration_seconds']:.0f}s）|",
    ]
    if duration:
        coverage = duration.get("timing_coverage")
        if coverage and coverage["status"] == "unavailable":
            lines.append(
                "| 墙钟机器执行 | 不可用（"
                f"{_format_timing_coverage(coverage)}；MAIN 工具调用缺少起止时间）|"
            )
        else:
            wall = duration["wall"] or 1
            coverage_note = ""
            if coverage and coverage["status"] == "partial":
                coverage_note = (
                    f"；已观测区间合计；{_format_timing_coverage(coverage)}"
                )
            lines.append(
                f"| 墙钟机器执行 | 前台 {duration['foreground_exec']:.0f}s + 后台 {duration['background_exec']:.0f}s "
                f"= {_fmt_sec(duration['active'])}（占墙钟 {duration['active'] / wall:.1%}{coverage_note}）|"
            )
        lines.append(
            f"| 子代理补充 effort | {_fmt_sec(duration['subagent_duration'])}（不与墙钟相加）|"
        )
    lines.extend(
        [
            f"| assistant 轮次 | {overview['assistant_turns']} |",
            f"| 工具调用（含子代理） | {overview['calls_total']}，失败 {overview['calls_failed']}（{overview['fail_rate']:.1%}）|",
            f"| 子代理 | {overview['subagent_count']} 个，累计 {overview['subagent_seconds']}s（占 {overview['subagent_share']:.0%}）|",
            f"| 真实用户输入 | {overview['real_user_turns']} 次（含初始诉求）|",
            (
                f"| hook 拦截 | {overview['hook_blocks']} |"
                if overview["hook_blocks"] is not None
                else f"| hook 拦截 | 已观测 {overview.get('hook_blocks_observed', 0)} 条，覆盖未知 |"
                if overview.get("hook_blocks_observed", 0)
                else "| hook 拦截 | 不可用（覆盖未知）|"
            ),
            f"| output tokens | {overview['output_tokens']} |",
            "",
        ]
    )

    if duration:
        coverage = duration.get("timing_coverage")
        if coverage and coverage["status"] == "unavailable":
            lines.extend(
                [
                    "## 0. 时长分解（真实执行 vs 等待）",
                    "",
                    "MAIN 工具计时不可用，"
                    f"{_format_timing_coverage(coverage)}；"
                    "无法可信计算机器执行、等待分类、未覆盖时间或闭合差。",
                    f"墙钟：{_fmt_sec(duration['wall'])}；补充 effort · 子代理：{_fmt_sec(duration['subagent_duration'])}（不与墙钟相加）。",
                    "",
                ]
            )
        else:
            _render_duration_breakdown(lines, duration, report.get("provider"))

    lines.extend(["## 1. 重复命令（轮询 / 试错信号）", ""])

    if report["repeats"]:
        lines.extend(["| 次数 | scope | 命令 |", "| --- | --- | --- |"])
        for row in report["repeats"]:
            command = display_command(row["command"]).replace("|", "\\|")
            lines.append(f"| {row['count']} | {row['scope']} | `{command}` |")
    else:
        lines.append("无（未达阈值）")

    lines.extend(["", "## 2. 失败聚类（同类错误已合并）", ""])
    failures = report["failures"]
    if failures["clusters"]:
        lines.extend(["| 次数 | 工具 | 错误签名 | 出现于 |", "| --- | --- | --- | --- |"])
        for row in failures["clusters"]:
            lines.append(
                f"| {row['count']} | {row['tool']} | {row['signature'].replace('|', '\\|')} | {', '.join(row['scopes'])} |"
            )
        lines.extend(["", "样本入参：", ""])
        for row in failures["clusters"][:8]:
            lines.append(f"- `{row['tool']}` @ {row['first_ts']} → `{row['sample_input']}`")
    else:
        lines.append("无失败调用")

    anomalies = report.get("command_anomalies") or []
    lines.extend(["", "### 独立命令异常信号", ""])
    if anomalies:
        for row in anomalies:
            lines.append(
                f"- `{row['tool']}` @ {row['timestamp']} [{row['confidence']}] {row['signature']}"
            )
    else:
        lines.append("无")

    lines.extend(["", "## 3. 子代理健康度", ""])
    if report["subagents"]:
        lines.extend(["| 类型 | 耗时(s) | 调用 | 失败 | 标记 | 任务 |", "| --- | --- | --- | --- | --- | --- |"])
        for row in report["subagents"]:
            flags = "、".join(row["flags"]) or "-"
            lines.append(
                f"| {row['agent_type']} | {row['duration_seconds']} | {row['calls']} | {row['failed']} | {flags} | {row['description']} |"
            )
    else:
        lines.append("无子代理")

    lines.extend(["", "## 4. 文件返工", ""])
    if report["rework"]:
        lines.extend(f"- ×{row['count']} `{row['file']}`" for row in report["rework"])
    else:
        lines.append("无（未达阈值）")

    lines.extend(["", "## 5. 用户输入点（初始诉求 + 中途干预）", ""])
    if report["interventions"]:
        lines.extend(f"- [{row['ts']}] {row['text']}" for row in report["interventions"])
    else:
        lines.append("无")

    lines.extend(["", "## 6. 工具分布", "", "| 工具 | 次数 | 失败 |", "| --- | --- | --- |"])
    for row in report["tool_mix"]:
        lines.append(f"| {row['tool']} | {row['count']} | {row['failed']} |")
    lines.extend(
        [
            "",
            "---",
            "",
            "以上为第 1 层确定性指标。继续按 analyze 模块做归因，并只对 P0/P1 回 replay.md 取证。",
        ]
    )
    return "\n".join(lines)


def _render_duration_breakdown(lines: list[str], duration: dict, provider: str | None = None) -> None:
    """渲染具有至少部分 MAIN 工具区间证据的时长分解。"""

    wall = duration["wall"] or 1
    coverage = duration.get("timing_coverage")
    partial = bool(coverage and coverage.get("status") == "partial")
    observed_prefix = "已观测 · " if partial else ""
    duration_column = "已观测时长" if partial else "时长"
    ratio_column = "占墙钟比例" if partial else "占比"
    # 口径按回放来源区分（220466f9 跨平台时长统计）：Claude 走原始 JSONL 逐事件配对。
    duration_method = (
        "从原始 transcript JSONL 逐事件配对 tool_use→tool_result 时间戳；"
        if provider == "claude"
        else "使用 Codex item_completed 的工具起止时间；"
    )
    lines.extend(
        [
            "## 0. 时长分解（真实执行 vs 等待）",
            "",
            f"口径：{duration_method}配对结果按工具与 task_type 分类；"
            "各墙钟 bucket 互斥，"
            "事件间隙仅表示未被工具区间覆盖的时间（启发式），不等同于人工闲置或模型思考。",
            *(
                [
                    f"以下数值均为已观测区间口径；{_format_timing_coverage(coverage)}，"
                    "不代表全部 MAIN 工具调用的完整总量。",
                ]
                if partial
                else []
            ),
            "",
            f"| 构成 | {duration_column} | {ratio_column} | 说明 |",
            "| --- | --- | --- | --- |",
        ]
    )
    rows = [
        ("机器执行 · 前台工具", duration["foreground_exec"], "非等待型主线程工具"),
        ("机器执行 · 后台任务", duration["background_exec"], "TaskOutput task_type=local_bash"),
        ("等待用户", duration["human_wait"], "AskUserQuestion 提问到回答"),
        ("等待子代理", duration["agent_wait"], "agent wait 或 TaskOutput task_type=local_agent"),
        ("未分类等待", duration["unclassified_wait"], "未知或缺失 task_type 的 TaskOutput"),
        (
            "未被工具区间覆盖的时间（启发式）",
            duration["thinking"] + duration["boundary_idle"],
            "仅表示区间未覆盖，不作活动归因",
        ),
    ]
    for name, value, note in rows:
        lines.append(
            f"| {observed_prefix}{name} | {_fmt_sec(value)} | {value / wall:.1%} | {note} |"
        )
    total_label = "已观测墙钟机器执行合计" if partial else "墙钟机器执行合计"
    lines.append(
        f"| **{total_label}** | **{_fmt_sec(duration['active'])}** | "
        f"**{duration['active'] / wall:.1%}** | 前台 + 后台 |"
    )
    lines.append(
        f"| 补充 effort · 子代理 | {_fmt_sec(duration['subagent_duration'])} | - | "
        "subagents[].duration_seconds 累计，不与墙钟相加 |"
    )
    if duration.get("closure_gap") is not None:
        closure_label = "已观测口径闭合差" if partial else "闭合差"
        lines.append(
            f"| {closure_label} | {_fmt_sec(duration['closure_gap'])} | - | "
            "墙钟 − 以上闭合口径（允许舍入差） |"
        )
    lines.append("")


def build_report(data: dict, repeat_threshold: int, rework_threshold: int, gap_threshold: float, top: int) -> dict:
    calls = list(iter_calls(data, "MAIN"))
    duration = metric_duration(data, gap_threshold)
    return {
        "provider": detect_replay_provider(data),
        "overview": metric_overview(
            data, calls, duration["wall"] if duration else None
        ),
        "duration": duration,
        "repeats": metric_repeats(calls, repeat_threshold)[:top],
        "failures": metric_failures(calls),
        "command_anomalies": metric_command_anomalies(calls),
        "subagents": metric_subagents(data),
        "rework": metric_rework(data, rework_threshold),
        "interventions": metric_interventions(data),
        "tool_mix": metric_tool_mix(calls),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="对 replay.json 生成第一层确定性复盘指标")
    parser.add_argument("target", nargs="?", help="replay.json 或回放目录；默认取最新导出")
    parser.add_argument("--format", choices=("md", "json"), default="md")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--no-save", action="store_true")
    parser.add_argument("--repeat-threshold", type=int, default=2)
    parser.add_argument("--rework-threshold", type=int, default=3)
    parser.add_argument("--top", type=int, default=25)
    parser.add_argument("--gap-threshold", type=float, default=60.0)
    args = parser.parse_args()

    try:
        data, source = load_replay(args.target)
    except (FileNotFoundError, json.JSONDecodeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    report = build_report(
        data,
        repeat_threshold=args.repeat_threshold,
        rework_threshold=args.rework_threshold,
        gap_threshold=args.gap_threshold,
        top=args.top,
    )
    report["source"] = str(source)
    text = json.dumps(report, ensure_ascii=False, indent=2) if args.format == "json" else render_markdown(report, source)
    print(text)

    if not args.no_save:
        output = args.out or source.parent / f"metrics.{args.format}"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(text, encoding="utf-8")
        print(f"\n> 指标报告已留档：{output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
