"""核验 Codex 回放的公开事件覆盖，不输出隐藏推理内容。"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

from codex_session import SessionSource, _content_text, _read_merged_records, _truncate

# 未知事件可由导出器保留，但不能据此声称完整支持该事件格式。
PUBLIC_TOOLS = {"CommandExecution", "FileChange", "Extension", "CollabAgentToolCall",
                "McpToolCall", "ImageView", "WebSearch", "Plan"}


def source_fingerprints(paths) -> list[dict]:
    """记录来源身份；调用方比较导出前后哈希以识别运行中变化。"""
    return [{"path": str(path), "size_bytes": path.stat().st_size,
             "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in paths]


def verify_replay(source: SessionSource, replay: dict, *, max_user_chars: int = 4000) -> dict:
    """按合并后的事件顺序核验工具和公开消息；旧格式如实报告未核验。"""
    records = _read_merged_records(source)
    expected_tools = []
    messages = []
    unknown = Counter()
    boundaries = []
    completed = 0
    completed_ids = set()
    for record in records:
        payload = record.get("payload") or {}
        if record.get("type") != "event_msg":
            continue
        if payload.get("type") in {"task_started", "task_complete"}:
            boundaries.append({"timestamp": record.get("timestamp"), "type": payload["type"]})
        if payload.get("type") != "item_completed":
            continue
        completed += 1
        item = payload.get("item") or {}
        kind = item.get("type")
        completed_ids.add(item.get("id"))
        if kind in {"UserMessage", "AgentMessage"}:
            text = _content_text(item.get("content"))
            role = "user" if kind == "UserMessage" else "assistant"
            if role == "user":
                text = _truncate(text, max_user_chars)
            if text:
                messages.append((role, text))
            content = item.get("content")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and str(block.get("type", "")).lower() not in {
                        "text", "input_text", "output_text", "image", "input_image", "audio", "input_audio"
                    }:
                        unknown["message:" + str(block.get("type"))] += 1
        elif kind not in {"Reasoning", "ContextCompaction"}:
            expected_tools.append(item.get("id"))
            if kind not in PUBLIC_TOOLS:
                unknown[str(kind)] += 1
    # exec 是编排外壳：可包含多项工具、异步启动或纯轮询，不与内部工具一一对应。
    # 只将它记入外壳审计；其他未被完成事件表示的旧调用/Assistant 消息是覆盖缺口。
    response_envelopes = 0
    unmatched_response_items = []
    for record in records:
        if record.get("type") != "response_item":
            continue
        payload = record.get("payload") or {}
        kind = payload.get("type")
        if kind == "custom_tool_call" and payload.get("name") == "exec":
            response_envelopes += 1
        elif kind in {"custom_tool_call", "function_call"} or (
            kind == "message" and payload.get("role") == "assistant"
        ):
            if not ({payload.get("id"), payload.get("call_id")} - {None}) & completed_ids:
                unmatched_response_items.append({"type": kind, "id": payload.get("id") or payload.get("call_id")})
    actual_tools = [tool.get("id") for turn in replay.get("turns", []) for tool in turn.get("tools", [])]
    actual_messages = []
    for turn in replay.get("turns", []):
        if turn.get("kind") == "user":
            actual_messages.append(("user", turn.get("text")))
        else:
            actual_messages.extend(("assistant", text) for text in turn.get("text", []))
    missing = list((Counter(expected_tools) - Counter(actual_tools)).elements())
    extra = list((Counter(actual_tools) - Counter(expected_tools)).elements())
    invalid = 0
    legacy_only_files = []
    for path in source.files:
        file_has_completed = False
        file_has_legacy = False
        for line in path.read_bytes().splitlines():
            if not line.strip():
                continue
            try:
                record = json.loads(line)
                if not isinstance(record, dict):
                    invalid += 1
                    continue
                payload = record.get("payload") or {}
                file_has_completed |= record.get("type") == "event_msg" and payload.get("type") == "item_completed"
                file_has_legacy |= record.get("type") == "response_item" and payload.get("type") in {
                    "message", "custom_tool_call", "function_call"
                }
            except (ValueError, UnicodeError):
                invalid += 1
        if file_has_legacy and not file_has_completed:
            legacy_only_files.append(str(path))
    children = []
    # 每个子代理与自己的来源核对，避免主 session 通过却漏掉子任务。
    actual_children = {str(Path(child["transcript"]).resolve()): child for child in replay.get("subagents", [])}
    for path in source.subagent_files:
        child = actual_children.get(str(path.resolve()))
        if child is None:
            children.append({"path": str(path), "complete": False, "reason": "子代理未导出"})
            continue
        child_source = SessionSource(child["agent_id"], None, (path,), (), None, path.stat().st_mtime)
        children.append(verify_replay(child_source, child, max_user_chars=max_user_chars))
    return {
        "session_id": source.session_id,
        "verification_schema": "item_completed" if completed else "unsupported_or_empty",
        "source_public_tool_count": len(expected_tools),
        "exported_tool_count": len(actual_tools),
        "source_user_messages": sum(role == "user" for role, _ in messages),
        "source_assistant_messages": sum(role == "assistant" for role, _ in messages),
        "messages_match": messages == actual_messages,
        "missing_tool_ids": missing, "extra_tool_ids": extra,
        "tool_order_matches": expected_tools == actual_tools,
        "invalid_jsonl_lines": invalid, "unsupported_events": dict(unknown),
        "task_boundaries": boundaries, "subagents": children,
        "coverage_granularity": "item_completed (exec envelopes and injected response context excluded)",
        "response_exec_envelopes": response_envelopes,
        "unmatched_response_items": unmatched_response_items,
        "legacy_only_files": legacy_only_files,
        "complete": bool(completed) and not missing and not extra and not invalid and not unknown
                    and messages == actual_messages and expected_tools == actual_tools
                    and not unmatched_response_items and not legacy_only_files
                    and len(actual_children) == len(source.subagent_files)
                    and all(child["complete"] for child in children),
    }
