"""Claude 来源适配：复用已有 session-replay 解析器，仅补充来源与覆盖核验。"""
from __future__ import annotations

import importlib.util
import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from types import SimpleNamespace

from codex_session import SessionSource


@lru_cache(maxsize=1)
def exporter():
    """加载唯一的 Claude 会话解析实现，避免另写 tool_use/tool_result 配对逻辑。"""
    path = Path(__file__).resolve().parents[4] / ".claude/skills/session-replay/scripts/session-export.py"
    spec = importlib.util.spec_from_file_location("shared_claude_session_export", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def options(full=False):
    """Issue 回放始终排除 thinking，full 也仅放开公开文本截断。"""
    return SimpleNamespace(max_tool_chars=0 if full else 800, max_user_chars=0 if full else 4000,
        max_thinking_chars=0, no_thinking=True, raw_tool_input=False, keep_meta=False,
        no_tool_results=False, show_skipped=False)


def discover_sources(session_ids, homes) -> dict[str, SessionSource]:
    """按完整 session 文件名发现 Claude projects，元数据身份随后独立核验。"""
    homes = {Path(home).expanduser().resolve() for home in homes}
    homes.add(Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude").expanduser().resolve())
    result = {}
    for sid in session_ids:
        files = sorted({p.resolve() for home in homes for p in (home / "projects").glob(f"*/{sid}.jsonl")})
        if not files:
            continue
        children = sorted({p.resolve() for parent in files for p in (parent.parent / sid / "subagents").glob("agent-*.jsonl")})
        result[sid] = SessionSource(sid, None, tuple(files), tuple(children), None, max(p.stat().st_mtime for p in files))
    return result


def read_records(files, session_id):
    """合并恢复日志并按 UUID 去重；坏行、身份差异和冲突均保留为核验缺口。"""
    rows, seen = [], {}
    problems = {"invalid_jsonl_lines": 0, "identity_mismatch_files": [], "conflicting_uuids": []}
    for path in files:
        identities = set()
        for line in path.read_bytes().splitlines():
            if not line.strip():
                continue
            try:
                record = json.loads(line)
                if not isinstance(record, dict):
                    raise ValueError("record is not an object")
            except (ValueError, UnicodeError):
                problems["invalid_jsonl_lines"] += 1
                continue
            if record.get("sessionId"):
                identities.add(record["sessionId"])
            # 在交给原解析器前移除隐藏 block；既不提取正文，也不保留签名。
            message = record.get("message")
            if isinstance(message, dict) and isinstance(message.get("content"), list):
                record = {**record, "message": {**message, "content": [b for b in message["content"]
                    if not isinstance(b, dict) or b.get("type") not in {"thinking", "redacted_thinking"}]}}
            canonical = json.dumps(record, sort_keys=True, ensure_ascii=False)
            key = record.get("uuid") or canonical
            if key in seen:
                if seen[key] != canonical:
                    problems["conflicting_uuids"].append(str(key))
                continue
            seen[key] = canonical
            rows.append(record)
        if identities != {session_id}:
            problems["identity_mismatch_files"].append(str(path))
    fallback = datetime.min.replace(tzinfo=timezone.utc)
    rows.sort(key=lambda row: exporter().parse_ts(row.get("timestamp")) or fallback)
    return rows, problems


def child_sources(source):
    """相同子代理在多个 home 的副本/续跑合并，不重复计数。"""
    grouped = defaultdict(list)
    for path in source.subagent_files:
        grouped[path.stem].append(path)
    return grouped


def build_replay(source, *, full=False):
    """调用 Claude 原生解析器生成与 Codex 相同的统一 replay 数据结构。"""
    lib, opts = exporter(), options(full)
    records, problems = read_records(source.files, source.session_id)
    if problems["identity_mismatch_files"]:
        raise ValueError("Claude transcript session 身份不匹配，不导出内容")
    main = [r for r in records if not r.get("isSidechain")]
    parsed = lib.build_timeline(main, opts)
    children = []
    for agent_id, paths in child_sources(source).items():
        child_records, problems = read_records(paths, source.session_id)
        if problems["identity_mismatch_files"]:
            raise ValueError("Claude 子代理 transcript session 身份不匹配，不导出内容")
        children.append({"agent_id": agent_id, "agent_type": "claude-subagent",
            **lib.build_timeline(child_records, opts, allow_sidechain=True)})
    payload = {"provider": "claude", "session_id": source.session_id, "transcript": str(source.files[-1]),
        "cwd": next((r.get("cwd") for r in records if r.get("cwd")), None),
        "git_branch": next((r.get("gitBranch") for r in records if r.get("gitBranch")), None),
        "first_prompt": lib.first_user_prompt(main), "exported_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "subagents": children, **parsed}
    result = lib.to_json_payload(payload)
    result["transcripts"] = [str(p) for p in source.files]
    # 没有显式 hook 审计时不把“未观察到阻断”写成零次阻断。
    result["stats"]["hook_observability"] = "available" if any(
        r.get("type") == "system" and ("preventedContinuation" in r or "hookErrors" in r) for r in main) else "unavailable"
    for child in result["subagents"]:
        paths = child_sources(source)[child["agent_id"]]
        child["transcript"] = str(paths[-1])
        child["transcripts"] = [str(p) for p in paths]
    return result


def render_markdown(replay, *, full=False):
    """复用 Claude 渲染器，恢复它需要的 Counter 视图，不改统一 JSON。"""
    stats = {**replay["stats"], "tools": Counter(replay["stats"]["tools"]), "skills": Counter(replay["stats"]["skills"])}
    text = exporter().render_markdown({**replay, "stats": stats}, options(full))
    if stats.get("hook_observability") == "unavailable":
        text = text.replace(f"| hook 拦截 | {len(stats['hook_blocks'])} |", "| hook 拦截 | 不可用（缺少显式审计记录）|")
    return text


# 已知的 Claude 编辑器/调度遥测不是公开消息，不进入覆盖计数。
RUNTIME_TYPES = {"progress", "atis-latch", "api-request-shape", "api-request-blob", "api-request", "tools-used",
                 "cost-state", "permission-mode", "agent-setting", "saved_hook_context"}


def verify_records(records, problems, replay, *, full=False, allow_sidechain=False):
    """独立对照公开文本、工具 ID、结果配对和错误标志，避免只比较总数。"""
    lib, opts = exporter(), options(full)
    tools, results, users, assistant = [], {}, [], []
    unknown, duplicate_results = Counter(), []
    public = [r for r in records if allow_sidechain or not r.get("isSidechain")]
    for record in public:
        kind = record.get("type")
        if kind not in {"user", "assistant", "system", "attachment"} | lib.SKIP_TYPES | RUNTIME_TYPES:
            unknown[str(kind)] += 1
        if kind not in {"user", "assistant"}:
            continue
        stamp = lib.parse_ts(record.get("timestamp"))
        if not stamp or not stamp.tzinfo:
            unknown["missing_or_invalid_timestamp"] += 1
        blocks = lib.blocks_of(record)
        for block in blocks:
            btype = block.get("type")
            if btype not in {"text", "tool_use", "tool_result", "image"}:
                unknown["block:" + str(btype)] += 1
            if kind == "assistant" and btype == "tool_use":
                tools.append(block)
            if kind == "assistant" and btype == "text":
                assistant.append(lib.block_text(block))
            if kind == "user" and btype == "tool_result":
                tid = block.get("tool_use_id")
                if tid in results:
                    duplicate_results.append(tid)
                results[tid] = block
        if kind == "user":
            text = "\n".join(lib.block_text(b) for b in blocks if b.get("type") != "tool_result").strip()
            text = lib.normalize_user_text(text)
            if text and not record.get("isMeta"):
                users.append(lib.truncate(text, opts.max_user_chars))
    exported = [tool for turn in replay.get("turns", []) for tool in turn.get("tools", [])]
    ids = [t.get("id") for t in tools]
    actual_ids = [t.get("id") for t in exported]
    missing = list((Counter(ids) - Counter(actual_ids)).elements())
    extra = list((Counter(actual_ids) - Counter(ids)).elements())
    result_match = True
    for raw, actual in zip(tools, exported):
        result = results.get(raw.get("id"))
        result_match &= (actual.get("name") == raw.get("name")
            and actual.get("input_summary") == lib.summarize_tool_input(raw.get("name"), raw.get("input") or {}, opts.max_tool_chars)
            and actual.get("result") == lib.truncate(lib.block_text(result or {}), opts.max_tool_chars)
            and actual.get("ok") == (not bool((result or {}).get("is_error")))
            and actual.get("has_result") == bool(result))
    messages_match = (users == [t.get("text") for t in replay.get("turns", []) if t.get("kind") == "user"]
        and assistant == [text for t in replay.get("turns", []) if t.get("kind") == "assistant" for text in t.get("text", [])])
    missing_results = [tid for tid in ids if tid not in results]
    orphan_results = [tid for tid in results if tid not in ids]
    duplicates = [tid for tid, count in Counter(ids).items() if count > 1]
    complete = (bool(users or assistant or tools) and not any(problems.values()) and not unknown
        and not missing and not extra and ids == actual_ids and None not in ids and not duplicates
        and not duplicate_results and not missing_results and not orphan_results and result_match and messages_match)
    return {"verification_schema": "claude_public_messages", "coverage_granularity": "public text + tool_use/tool_result",
        **problems, "source_public_tool_count": len(ids), "exported_tool_count": len(exported),
        "source_user_messages": len(users), "source_assistant_messages": len(assistant),
        "messages_match": messages_match, "missing_tool_ids": missing, "extra_tool_ids": extra,
        "tool_order_matches": ids == actual_ids, "tool_results_match": bool(result_match),
        "missing_tool_results": missing_results, "orphan_tool_results": orphan_results,
        "duplicate_tool_ids": duplicates, "duplicate_tool_results": duplicate_results,
        "unsupported_events": dict(unknown), "complete": bool(complete)}


def verify_replay(source, replay, *, full=False):
    """核验主会话和全部已发现子代理；inline sidechain 不可静默遗漏。"""
    records, problems = read_records(source.files, source.session_id)
    result = verify_records(records, problems, replay, full=full)
    result["session_id"] = source.session_id
    result["subagents"] = []
    grouped = child_sources(source)
    children = {c["agent_id"]: c for c in replay.get("subagents", [])}
    all_records = list(records)
    for agent_id, paths in grouped.items():
        child_records, child_problems = read_records(paths, source.session_id)
        all_records.extend(child_records)
        child = children.get(agent_id)
        verification = verify_records(child_records, child_problems, child or {}, full=full, allow_sidechain=True)
        verification["agent_id"] = agent_id
        result["subagents"].append(verification)
    inline = [r for r in records if r.get("isSidechain") and r.get("type") in {"user", "assistant"}]
    result["inline_sidechain_records"] = len(inline)
    # 结构化派生代理引用属于可核验证据；缺少对应文件不能被当作零次子代理调用。
    referenced = {"agent-" + str(r["toolUseResult"]["agentId"]) for r in all_records
                  if isinstance(r.get("toolUseResult"), dict) and r["toolUseResult"].get("agentId")}
    result["missing_subagent_ids"] = sorted(referenced - grouped.keys())
    result["complete"] &= not result["missing_subagent_ids"]
    result["complete"] &= not inline and len(children) == len(grouped) and all(c["complete"] for c in result["subagents"])
    return result


def completion_candidates(source):
    """提供公开请求到最终文本的候选区间；平台 Run 关联由 Issue 层判断。"""
    records, _ = read_records(source.files, source.session_id)
    lib = exporter()
    main = [r for r in records if not r.get("isSidechain")]
    parsed = lib.build_timeline(main, options())
    endings = {}
    for record in main:
        if record.get("type") == "assistant":
            message = record.get("message") or {}
            endings[message.get("id")] = (record.get("timestamp"), message.get("stop_reason"))
    candidates, request = [], None
    for turn in parsed["turns"]:
        if turn["kind"] == "user":
            request = turn
        elif turn["kind"] == "assistant" and request and turn.get("text") and not turn.get("tools"):
            end, reason = endings.get(turn.get("msg_id"), (turn.get("ts"), None))
            candidates.append({"request_id": request["ts"], "started_at": request["ts"], "completed_at": end,
                "message_id": turn.get("msg_id"), "text": "\n".join(turn["text"]), "end_turn": reason == "end_turn"})
    return candidates
