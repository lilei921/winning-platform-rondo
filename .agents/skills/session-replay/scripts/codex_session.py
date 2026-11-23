#!/usr/bin/env python3
"""读取 Codex 本地 transcript，并转换为 session-replay 的统一结构。"""

from __future__ import annotations

import json
import os
import re
from collections import Counter, OrderedDict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Mapping


@dataclass(frozen=True)
class SessionSource:
    """同一 Codex session 可能由多个 rollout 文件共同组成。"""

    session_id: str
    cwd: str | None
    files: tuple[Path, ...]
    subagent_files: tuple[Path, ...]
    started_at: str | None
    latest_mtime: float


def default_codex_home() -> Path:
    """返回 Codex 本地状态目录。"""

    configured = os.environ.get("CODEX_HOME")
    return Path(configured).expanduser() if configured else Path.home() / ".codex"


def _norm_path(value: str | Path | None) -> str | None:
    if value is None:
        return None
    try:
        return os.path.normcase(str(Path(value).resolve()))
    except OSError:
        return os.path.normcase(os.path.abspath(str(value)))


def _read_session_meta(path: Path) -> dict | None:
    """只扫描文件开头，避免列举 session 时读取整个大文件。"""

    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for index, line in enumerate(handle):
                if index >= 100:
                    break
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(record, dict):
                    continue
                if record.get("type") == "session_meta":
                    payload = record.get("payload") or {}
                    if isinstance(payload, dict):
                        return payload
    except OSError:
        return None
    return None


def discover_sessions(
    codex_home: Path | None = None,
    project: Path | None = None,
) -> list[SessionSource]:
    """扫描活跃和归档目录，并按 session_id 合并 rollout 文件。"""

    home = (codex_home or default_codex_home()).expanduser()
    project_norm = _norm_path(project)
    grouped: dict[str, dict] = {}

    for directory in (home / "sessions", home / "archived_sessions"):
        if not directory.is_dir():
            continue
        for path in directory.rglob("*.jsonl"):
            meta = _read_session_meta(path)
            if not meta:
                continue
            session_id = str(meta.get("session_id") or meta.get("id") or "").strip()
            if not session_id:
                continue
            runtime_id = str(meta.get("id") or session_id).strip()
            thread_source = str(meta.get("thread_source") or "").lower()
            cwd = meta.get("cwd")
            if project_norm is not None and _norm_path(cwd) != project_norm:
                continue
            state = grouped.setdefault(
                session_id,
                {
                    "cwd": cwd,
                    "files": [],
                    "subagent_files": [],
                    "started_at": meta.get("timestamp"),
                    "latest_mtime": 0.0,
                },
            )
            state["cwd"] = state["cwd"] or cwd
            state["started_at"] = state["started_at"] or meta.get("timestamp")
            # 子代理沿用父 session_id，但自己的 id 不同。单独保存，在构建回放时
            # 作为 subagents[] 加载，避免把派发提示错算成真实用户输入。
            target = "subagent_files" if thread_source == "subagent" or runtime_id != session_id else "files"
            state[target].append(path.resolve())
            try:
                state["latest_mtime"] = max(state["latest_mtime"], path.stat().st_mtime)
            except OSError:
                pass

    result = [
        SessionSource(
            session_id=session_id,
            cwd=state["cwd"],
            files=tuple(sorted(state["files"])),
            subagent_files=tuple(sorted(state["subagent_files"])),
            started_at=state["started_at"],
            latest_mtime=state["latest_mtime"],
        )
        for session_id, state in grouped.items()
        if state["files"]
    ]
    return sorted(result, key=lambda item: item.latest_mtime, reverse=True)


def resolve_session(
    *,
    codex_home: Path | None = None,
    project: Path | None = None,
    session_id: str | None = None,
    environ: Mapping[str, str] | None = None,
) -> SessionSource:
    """解析目标 session；未传 ID 时优先使用当前 Codex 环境变量。"""

    env = os.environ if environ is None else environ
    requested = (
        session_id
        or env.get("CODEX_SESSION_ID")
        or env.get("CODEX_THREAD_ID")
        or ""
    ).strip()

    # 显式或运行时提供 ID 时跨 cwd 查找，避免恢复会话后 cwd 变化导致漏匹配。
    sessions = discover_sessions(codex_home=codex_home, project=None if requested else project)
    if requested:
        exact = [item for item in sessions if item.session_id == requested]
        if exact:
            return exact[0]
        prefix = [item for item in sessions if item.session_id.startswith(requested)]
        if len(prefix) == 1:
            return prefix[0]
        if len(prefix) > 1:
            raise ValueError(f"session-id 前缀不唯一: {requested}")
        raise FileNotFoundError(f"未找到 Codex session: {requested}")

    if not sessions:
        location = project or Path.cwd()
        raise FileNotFoundError(f"未找到 cwd={location} 对应的 Codex session")
    return sessions[0]


def _parse_ts(value: object) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _one_line(value: object, limit: int = 500) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _truncate(value: object, limit: int) -> str:
    text = str(value or "")
    if limit <= 0 or len(text) <= limit:
        return text
    return text[:limit] + f"\n…[已截断，原文共 {len(text)} 字符]"


def _content_text(content: object) -> str:
    """提取公开消息文本；不读取 reasoning/raw_content/encrypted_content。"""

    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        # 新版公开消息使用 Text/Image；归一化类型仍只读取公开文本字段。
        item_type = str(item.get("type") or "").lower()
        if item_type in {"input_text", "output_text", "text"}:
            parts.append(str(item.get("text") or ""))
        elif item_type in {"input_image", "image"}:
            parts.append("[image]")
        elif item_type in {"input_audio", "audio"}:
            parts.append("[audio]")
    return "\n".join(part for part in parts if part).strip()


def _read_merged_records(source: SessionSource) -> list[dict]:
    """合并 continuation/恢复产生的 rollout，并对重复快照去重。"""

    rows: list[tuple[datetime, int, int, int, dict]] = []
    seen: set[str] = set()
    fallback_time = datetime.min

    for file_index, path in enumerate(source.files):
        try:
            with path.open("r", encoding="utf-8", errors="replace") as handle:
                for line_index, line in enumerate(handle):
                    line = line.strip()
                    if not line or line in seen:
                        continue
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(record, dict):
                        continue
                    seen.add(line)
                    timestamp = _parse_ts(record.get("timestamp")) or fallback_time
                    ordinal = record.get("ordinal")
                    ordinal = ordinal if isinstance(ordinal, int) else line_index
                    rows.append((timestamp, ordinal, file_index, line_index, record))
        except OSError:
            continue

    rows.sort(key=lambda row: row[:4])
    return [row[4] for row in rows]


def _extract_tokens(records: list[dict]) -> dict[str, int]:
    """提取最后一次累计 token 事件，避免对累计值重复求和。"""

    total: dict = {}
    for record in records:
        if record.get("type") != "event_msg":
            continue
        payload = record.get("payload") or {}
        if payload.get("type") != "token_count":
            continue
        info = payload.get("info") or {}
        candidate = info.get("total_token_usage") or {}
        if isinstance(candidate, dict):
            total = candidate

    aliases = {
        "cached_input_tokens": "cache_read_input_tokens",
        "cache_write_input_tokens": "cache_creation_input_tokens",
    }
    result: dict[str, int] = {}
    for key, value in total.items():
        if isinstance(value, int):
            result[aliases.get(key, key)] = value
    return result


def _load_hook_audit(source: SessionSource) -> tuple[str, list[dict]]:
    """读取项目级 Codex hook 审计；历史会话无记录时明确标记不可用。"""

    if not source.cwd:
        return "unavailable", []
    path = Path(source.cwd) / "docs" / "replay" / "codex-hook-events.jsonl"
    if not path.is_file():
        return "unavailable", []

    matched = False
    blocks: list[dict] = []
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if str(event.get("session_id") or "") != source.session_id:
                    continue
                matched = True
                if event.get("blocked") is True:
                    blocks.append(
                        {
                            "ts": event.get("recorded_at"),
                            "event": event.get("hook_event_name"),
                            "tool": event.get("tool_name"),
                            "text": _one_line(event.get("reason") or "Codex hook blocked", 300),
                        }
                    )
    except OSError:
        return "unavailable", []
    return ("available" if matched else "unavailable"), blocks


def _read_meta(path: Path) -> dict:
    return _read_session_meta(path) or {}


def _tool_from_item(item: dict, payload: dict, max_tool_chars: int) -> dict:
    item_type = str(item.get("type") or "Unknown")
    started_ms = payload.get("started_at_ms")
    completed_ms = payload.get("completed_at_ms")
    duration = None
    if isinstance(started_ms, (int, float)) and isinstance(completed_ms, (int, float)):
        duration = round(max(0.0, completed_ms - started_ms) / 1000, 3)

    name = item_type
    summary = ""
    result = ""
    ok = item.get("status") not in {"failed", "error", "declined", "cancelled"}

    if item_type == "CommandExecution":
        command = item.get("command")
        summary = " ".join(map(str, command)) if isinstance(command, list) else str(command or "")
        result = item.get("aggregated_output") or item.get("formatted_output") or ""
        if not result:
            result = "\n".join(
                part for part in (str(item.get("stdout") or ""), str(item.get("stderr") or "")) if part
            )
        ok = ok and item.get("exit_code") in {None, 0}
    elif item_type == "FileChange":
        changes = item.get("changes") or {}
        summary = ", ".join(map(str, changes.keys())) if isinstance(changes, dict) else str(changes)
        result = "\n".join(
            part for part in (str(item.get("stdout") or ""), str(item.get("stderr") or "")) if part
        )
    elif item_type == "Extension":
        kind = item.get("kind")
        name = f"Extension:{kind}" if kind else "Extension"
        summary = str(item.get("query") or item.get("action") or "")
        result = json.dumps(item.get("results") or [], ensure_ascii=False)
    elif item_type == "CollabAgentToolCall":
        tool = item.get("tool")
        name = f"CollabAgent:{tool}" if tool else "CollabAgentToolCall"
        summary = str(item.get("prompt") or "")
    else:
        summary = _one_line(json.dumps(item, ensure_ascii=False), max_tool_chars)

    return {
        "id": item.get("id"),
        "name": name,
        "input_summary": _truncate(summary, max_tool_chars),
        "input_raw": None,
        "ok": bool(ok),
        "has_result": bool(result) or item_type in {"FileChange", "CollabAgentToolCall"},
        "result_chars": len(str(result)),
        "result": _truncate(result, max_tool_chars),
        "started_at": payload.get("started_at_ms"),
        "ended_at": payload.get("completed_at_ms"),
        "duration_seconds": duration,
    }


def _fallback_response_items(records: list[dict], max_tool_chars: int) -> list[dict]:
    """兼容没有 item_completed 的旧版 transcript。"""

    outputs: dict[str, str] = {}
    for record in records:
        if record.get("type") != "response_item":
            continue
        payload = record.get("payload") or {}
        if payload.get("type") == "custom_tool_call_output":
            outputs[str(payload.get("call_id") or "")] = _content_text(payload.get("output"))

    events: list[dict] = []
    for record in records:
        if record.get("type") != "response_item":
            continue
        payload = record.get("payload") or {}
        subtype = payload.get("type")
        if subtype == "message" and payload.get("role") in {"user", "assistant"}:
            events.append(
                {
                    "kind": payload.get("role"),
                    "ts": record.get("timestamp"),
                    "text": _content_text(payload.get("content")),
                }
            )
        elif subtype == "custom_tool_call":
            call_id = str(payload.get("call_id") or "")
            raw_input = payload.get("input")
            if not isinstance(raw_input, str):
                raw_input = json.dumps(raw_input, ensure_ascii=False)
            result = outputs.get(call_id, "")
            events.append(
                {
                    "kind": "tool",
                    "ts": record.get("timestamp"),
                    "tool": {
                        "id": payload.get("id") or call_id,
                        "name": payload.get("name") or "Unknown",
                        "input_summary": _truncate(raw_input, max_tool_chars),
                        "input_raw": None,
                        "ok": payload.get("status") not in {"failed", "error"},
                        "has_result": call_id in outputs,
                        "result_chars": len(result),
                        "result": _truncate(result, max_tool_chars),
                    },
                }
            )
    return events


def build_replay(
    source: SessionSource,
    *,
    max_tool_chars: int = 800,
    max_user_chars: int = 4_000,
    include_subagents: bool = True,
) -> dict:
    """构建兼容既有 replay-analyze 数据形状的 Codex 回放。"""

    records = _read_merged_records(source)
    events: list[dict] = []
    meta: dict = {}
    item_count = 0

    for record in records:
        if record.get("type") == "session_meta" and not meta:
            meta = record.get("payload") or {}
            continue
        if record.get("type") != "event_msg":
            continue
        payload = record.get("payload") or {}
        if payload.get("type") != "item_completed":
            continue
        item = payload.get("item") or {}
        item_type = item.get("type")
        item_count += 1
        if item_type == "UserMessage":
            events.append(
                {
                    "kind": "user",
                    "ts": record.get("timestamp"),
                    "text": _truncate(_content_text(item.get("content")), max_user_chars),
                    "cwd": source.cwd,
                    "git_branch": (meta.get("git") or {}).get("branch") if isinstance(meta.get("git"), dict) else None,
                }
            )
        elif item_type == "AgentMessage":
            events.append(
                {
                    "kind": "assistant",
                    "ts": record.get("timestamp"),
                    "text": _content_text(item.get("content")),
                }
            )
        elif item_type not in {"Reasoning", "ContextCompaction"}:
            events.append(
                {
                    "kind": "tool",
                    "ts": record.get("timestamp"),
                    "tool": _tool_from_item(item, payload, max_tool_chars),
                }
            )

    if item_count == 0:
        events = _fallback_response_items(records, max_tool_chars)

    turns: list[dict] = []
    pending_tools: list[dict] = []
    stats_tools: Counter = Counter()
    stats_errors: Counter = Counter()
    files_touched: OrderedDict[str, int] = OrderedDict()
    bash_commands: list[str] = []
    skipped: Counter = Counter()
    timestamps: list[datetime] = []

    def flush_tools() -> None:
        if pending_tools:
            turns.append(
                {
                    "kind": "assistant",
                    "ts": pending_tools[0].get("ts"),
                    "msg_id": None,
                    "model": meta.get("model_provider"),
                    "thinking": [],
                    "text": [],
                    "tools": [entry["tool"] for entry in pending_tools],
                }
            )
            pending_tools.clear()

    for event in events:
        parsed = _parse_ts(event.get("ts"))
        if parsed:
            timestamps.append(parsed)
        if event["kind"] == "tool":
            tool = event["tool"]
            pending_tools.append(event)
            stats_tools[tool["name"]] += 1
            if not tool["ok"]:
                stats_errors[tool["name"]] += 1
            if tool["name"] == "CommandExecution" and tool["input_summary"]:
                bash_commands.append(_one_line(tool["input_summary"], 200))
            if tool["name"] == "FileChange":
                for path in filter(None, map(str.strip, tool["input_summary"].split(","))):
                    files_touched[path] = files_touched.get(path, 0) + 1
            continue

        if event["kind"] == "user":
            flush_tools()
            if event.get("text"):
                turns.append(event)
            continue

        if event["kind"] == "assistant":
            turns.append(
                {
                    "kind": "assistant",
                    "ts": event.get("ts"),
                    "msg_id": None,
                    "model": meta.get("model_provider"),
                    "thinking": [],
                    "text": [event.get("text")] if event.get("text") else [],
                    "tools": [entry["tool"] for entry in pending_tools],
                }
            )
            pending_tools.clear()
    flush_tools()

    user_turns = [turn for turn in turns if turn.get("kind") == "user"]
    assistant_turns = [turn for turn in turns if turn.get("kind") == "assistant"]
    started = min(timestamps).isoformat() if timestamps else source.started_at
    ended = max(timestamps).isoformat() if timestamps else source.started_at
    duration = None
    if timestamps:
        duration = round((max(timestamps) - min(timestamps)).total_seconds(), 1)

    hook_observability, hook_blocks = _load_hook_audit(source)
    replay = {
        "provider": "codex",
        "session_id": source.session_id,
        "transcript": str(source.files[-1]) if source.files else None,
        "transcripts": [str(path) for path in source.files],
        "cwd": source.cwd,
        "git_branch": (meta.get("git") or {}).get("branch") if isinstance(meta.get("git"), dict) else None,
        "started_at": started,
        "ended_at": ended,
        "duration_seconds": duration,
        "first_prompt": user_turns[0].get("text") if user_turns else None,
        "exported_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "stats": {
            "user_prompts": len(user_turns),
            "assistant_turns": len(assistant_turns),
            "tools": dict(stats_tools),
            "tool_errors": dict(stats_errors),
            "tool_calls_total": sum(stats_tools.values()),
            "tool_errors_total": sum(stats_errors.values()),
            "files_touched": dict(files_touched),
            "bash_commands": bash_commands,
            "models": {str(meta.get("model_provider")): 1} if meta.get("model_provider") else {},
            "skills": {},
            "hook_blocks": hook_blocks,
            "hook_observability": hook_observability,
            "tokens": _extract_tokens(records),
            "skipped": dict(skipped),
        },
        "turns": turns,
        "subagents": [],
    }

    if include_subagents:
        for path in source.subagent_files:
            child_meta = _read_meta(path)
            child_id = str(child_meta.get("id") or path.stem)
            try:
                mtime = path.stat().st_mtime
            except OSError:
                mtime = 0.0
            child_source = SessionSource(
                session_id=child_id,
                cwd=child_meta.get("cwd") or source.cwd,
                files=(path,),
                subagent_files=(),
                started_at=child_meta.get("timestamp"),
                latest_mtime=mtime,
            )
            child = build_replay(
                child_source,
                max_tool_chars=max_tool_chars,
                max_user_chars=max_user_chars,
                include_subagents=False,
            )
            replay["subagents"].append(
                {
                    "agent_id": child_id,
                    "agent_type": child_meta.get("agent_role") or "codex-subagent",
                    "agent_nickname": child_meta.get("agent_nickname"),
                    "description": child.get("first_prompt"),
                    "tool_use_id": None,
                    "spawn_depth": 1,
                    "duration_seconds": child.get("duration_seconds"),
                    "stats": child["stats"],
                    "turns": child["turns"],
                    "transcript": str(path),
                }
            )
    return replay
