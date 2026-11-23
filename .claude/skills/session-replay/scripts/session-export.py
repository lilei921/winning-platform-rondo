#!/usr/bin/env python3
# session-export.py - 只读：把 Claude Code 会话 transcript 导出为可回放/可分析的 md + json
#
# Author: winning\li_lei
# Created: 2026-07-30
# Updated: 2026-07-30
# Description: 读取 ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl 及其
#              subagents/*.jsonl，剔除 hook/reminder 等噪声，重建时间线，
#              配对 tool_use / tool_result，输出 replay.md（人读 + 喂大模型）
#              与 replay.json（结构化统计）。
#
# 硬约束：全程只读原始 transcript，只向 --out 目录写文件，不修改任何仓库状态。
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, OrderedDict
from datetime import datetime
from pathlib import Path

# Windows 控制台默认 GBK，打印中文会炸，这里强制 UTF-8
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

# 以脚本位置向上四级定位仓库根目录（脚本位于 .claude/skills/session-replay/scripts/ 下）
ROOT = Path(__file__).resolve().parents[4]
DEFAULT_OUT_ROOT = ROOT / "projects" / "replay"
PROJECTS_ROOT = Path.home() / ".claude" / "projects"

# 复用仓库共享的输出目录分配器，确保 Claude 与 Codex 语义一致。
SHARED_SCRIPT_ROOT = ROOT / ".agents" / "skills" / "session-replay" / "scripts"
sys.path.insert(0, str(SHARED_SCRIPT_ROOT))
from output_path import allocate_replay_dir

# ---------------------------------------------------------------- 噪声过滤规则

# 顶层 record type 中对回放无价值的部分（纯编辑器/调度状态）
SKIP_TYPES = {
    "file-history-snapshot",
    "file-history-delta",
    "mode",
    "last-prompt",
    "queue-operation",
    "summary",
}

# attachment.type 中属于运行时噪声的部分（hook 回显、技能清单、提醒等）
SKIP_ATTACHMENT_TYPES = {
    "hook_success",
    "hook_additional_context",
    "task_reminder",
    "skill_listing",
    "agent_listing_delta",
    "deferred_tools_delta",
    "mcp_instructions_delta",
    "command_permissions",
    "edited_text_file",
    "selected_lines_in_ide",
    "opened_file_in_ide",
    "diagnostics",
    "nested_memory",
    "queued_command",
    "todo",
    "ultramode_status",
}

# 写文件类工具：用于统计 files_touched
WRITE_TOOLS = {"Edit", "Write", "NotebookEdit", "MultiEdit"}

# 内置无业务语义的 slash command，不能当作"初始诉求"
NOOP_COMMANDS = {
    "/clear", "/model", "/compact", "/config", "/export", "/cost", "/status",
    "/help", "/resume", "/login", "/logout", "/fast", "/vim", "/terminal-setup",
    "/doctor", "/memory", "/permissions", "/theme",
}


# ---------------------------------------------------------------- 基础工具函数


def encode_project_dir(cwd: str) -> str:
    """把工作目录路径编码成 ~/.claude/projects 下的目录名（非字母数字全部替换为 -）"""
    return re.sub(r"[^a-zA-Z0-9]", "-", str(cwd))


def truncate(text: str, limit: int) -> str:
    """按字符数截断，并标注被省略的长度；limit <= 0 表示不截断"""
    if text is None:
        return ""
    text = str(text)
    if limit <= 0 or len(text) <= limit:
        return text
    return text[:limit] + f"\n…[已截断，原文共 {len(text)} 字符]"


def one_line(text: str, limit: int = 160) -> str:
    """压成单行摘要，用于列表和标题"""
    flat = re.sub(r"\s+", " ", str(text or "")).strip()
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


def parse_ts(value: str):
    """解析 ISO 时间戳，失败返回 None"""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def local_str(value, fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    """把 transcript 中的 UTC 时间戳转成本地时区字符串（md 展示用；json 保留原始 ISO）"""
    parsed = parse_ts(value)
    if parsed is None:
        return str(value or "-")[:19].replace("T", " ")
    try:
        parsed = parsed.astimezone()
    except Exception:
        pass
    return parsed.strftime(fmt)


def read_jsonl(path: Path) -> list:
    """逐行读取 jsonl，坏行跳过（不让单条脏数据毁掉整次导出）"""
    records = []
    bad = 0
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except Exception:
                bad += 1
    if bad:
        print(f"warn: {path.name} 有 {bad} 行无法解析，已跳过", file=sys.stderr)
    return records


def blocks_of(record: dict) -> list:
    """统一取出消息 content 的 block 列表（content 可能是纯字符串）"""
    message = record.get("message")
    if not isinstance(message, dict):
        return []
    content = message.get("content")
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    if isinstance(content, list):
        return [b for b in content if isinstance(b, dict)]
    return []


def block_text(block: dict) -> str:
    """从任意 block 里抽出可读文本"""
    content = block.get("content", block.get("text", block.get("thinking", "")))
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                if item.get("type") == "text":
                    parts.append(item.get("text", ""))
                elif item.get("type") == "image":
                    parts.append("[image]")
                else:
                    parts.append(f"[{item.get('type')}]")
            else:
                parts.append(str(item))
        return "\n".join(parts)
    return "" if content is None else str(content)


def normalize_user_text(text: str) -> str:
    """规整用户输入：把 slash command 包裹标签还原成 `/cmd args`，剔除回显与提醒噪声"""
    raw = text or ""
    # 先抽出 slash command 名与参数（真实用户意图，必须保留）
    names = re.findall(r"<command-name>(.*?)</command-name>", raw, flags=re.S)
    args_list = re.findall(r"<command-args>(.*?)</command-args>", raw, flags=re.S)
    commands = []
    for i, name in enumerate(names):
        arg = args_list[i].strip() if i < len(args_list) else ""
        command = name.strip()
        if not command.startswith("/"):
            command = "/" + command
        commands.append(f"{command} {arg}".strip())

    # 再删掉所有包裹标签与运行时噪声
    body = raw
    for pattern in (
        r"<command-name>.*?</command-name>",
        r"<command-message>.*?</command-message>",
        r"<command-args>.*?</command-args>",
        r"<local-command-stdout>.*?</local-command-stdout>",
        r"<local-command-stderr>.*?</local-command-stderr>",
        r"<local-command-caveat>.*?</local-command-caveat>",
        r"<system-reminder>.*?</system-reminder>",
    ):
        body = re.sub(pattern, "", body, flags=re.S)
    body = body.strip()

    parts = [c for c in commands if c]
    if body:
        parts.append(body)
    return "\n".join(parts).strip()


def is_meta_user_text(text: str) -> bool:
    """规整后为空的用户文本视为纯噪声（本地命令回显、system-reminder 等）"""
    return not normalize_user_text(text)


# ---------------------------------------------------------------- 工具入参摘要

def summarize_tool_input(name: str, tool_input, limit: int) -> str:
    """按工具类型提取关键入参，避免把整个 JSON 塞进回放文本"""
    if not isinstance(tool_input, dict):
        return truncate(json.dumps(tool_input, ensure_ascii=False), limit)

    def get(*keys):
        for key in keys:
            if tool_input.get(key) not in (None, ""):
                return str(tool_input[key])
        return ""

    if name in ("Bash", "PowerShell"):
        return truncate(get("command"), limit)
    if name in ("Read", "Write", "NotebookEdit"):
        return get("file_path", "notebook_path")
    if name in ("Edit", "MultiEdit"):
        return get("file_path")
    if name == "Glob":
        return f'{get("pattern")}  @{get("path") or "."}'
    if name == "Grep":
        return f'{get("pattern")}  @{get("path") or "."}  {get("glob", "type")}'.strip()
    if name == "Agent":
        return f'[{get("subagent_type") or "general-purpose"}] {get("description")}'
    if name == "Skill":
        return f'{get("skill")} {get("args")}'.strip()
    if name == "TodoWrite":
        todos = tool_input.get("todos") or []
        return f"{len(todos)} 项待办"
    if name == "Task" or name.startswith("mcp__"):
        return truncate(json.dumps(tool_input, ensure_ascii=False), limit)
    return truncate(json.dumps(tool_input, ensure_ascii=False), limit)


# ---------------------------------------------------------------- transcript 解析


def build_timeline(records: list, opts, allow_sidechain: bool = False) -> dict:
    """把 jsonl 记录流重建为回放时间线 + 统计信息"""
    # 先扫一遍收集 tool_result，按 tool_use_id 索引
    results = {}
    for record in records:
        if record.get("type") != "user":
            continue
        for block in blocks_of(record):
            if block.get("type") == "tool_result":
                results[block.get("tool_use_id")] = {
                    "text": block_text(block),
                    "is_error": bool(block.get("is_error")),
                    "ts": record.get("timestamp"),
                }

    turns = []
    stats = {
        "tools": Counter(),
        "tool_errors": Counter(),
        "files_touched": OrderedDict(),
        "bash_commands": [],
        "models": Counter(),
        "skills": Counter(),
        "agents": [],
        "hook_blocks": [],
        "tokens": Counter(),
        "skipped": Counter(),
        "user_prompts": 0,
        "assistant_turns": 0,
    }
    first_ts = last_ts = None
    current = None  # 正在累积的 assistant turn（按 message.id 合并）

    def flush():
        nonlocal current
        if current is not None:
            turns.append(current)
            current = None

    for record in records:
        rtype = record.get("type")
        ts = record.get("timestamp")
        parsed = parse_ts(ts)
        if parsed:
            first_ts = parsed if first_ts is None else min(first_ts, parsed)
            last_ts = parsed if last_ts is None else max(last_ts, parsed)

        if rtype in SKIP_TYPES:
            stats["skipped"][rtype] += 1
            continue

        # sidechain 记录（子代理轮次）不进主时间线；解析子代理文件时才放行
        if record.get("isSidechain") and not allow_sidechain:
            stats["skipped"]["sidechain-inline"] += 1
            continue

        if rtype == "attachment":
            atype = (record.get("attachment") or {}).get("type")
            if atype in SKIP_ATTACHMENT_TYPES:
                stats["skipped"][f"attachment:{atype}"] += 1
                continue
            flush()
            turns.append(
                {
                    "kind": "attachment",
                    "ts": ts,
                    "subtype": atype,
                    "text": truncate(block_text(record.get("attachment") or {}), opts.max_tool_chars),
                }
            )
            continue

        if rtype == "system":
            # 只保留有价值的系统事件：hook 拦截、错误、中断
            blocked = record.get("preventedContinuation") or bool(record.get("hookErrors"))
            level = (record.get("level") or "").lower()
            if not blocked and level not in ("error", "warn"):
                stats["skipped"]["system"] += 1
                continue
            text = truncate(block_text(record), opts.max_tool_chars)
            entry = {
                "kind": "system",
                "ts": ts,
                "level": level or "info",
                "subtype": record.get("subtype"),
                "blocked": bool(blocked),
                "text": text,
            }
            if blocked:
                stats["hook_blocks"].append({"ts": ts, "text": one_line(text, 300)})
            flush()
            turns.append(entry)
            continue

        if rtype == "user":
            plain = []
            for block in blocks_of(record):
                if block.get("type") == "tool_result":
                    continue  # 已在 tool_use 侧展示
                plain.append(block_text(block))
            text = "\n".join(p for p in plain if p).strip()
            if not text:
                continue
            normalized = normalize_user_text(text)
            if record.get("isMeta") or not normalized:
                stats["skipped"]["user-meta"] += 1
                if not opts.keep_meta:
                    continue
                normalized = normalized or text
            flush()
            stats["user_prompts"] += 1
            turns.append(
                {
                    "kind": "user",
                    "ts": ts,
                    "text": truncate(normalized, opts.max_user_chars),
                    "git_branch": record.get("gitBranch"),
                    "cwd": record.get("cwd"),
                }
            )
            continue

        if rtype == "assistant":
            message = record.get("message") or {}
            msg_id = message.get("id")
            model = message.get("model")
            if model:
                stats["models"][model] += 1
            usage = message.get("usage") or {}
            for key in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"):
                if isinstance(usage.get(key), int):
                    stats["tokens"][key] += usage[key]

            if current is None or (msg_id and current.get("msg_id") != msg_id):
                flush()
                stats["assistant_turns"] += 1
                current = {
                    "kind": "assistant",
                    "ts": ts,
                    "msg_id": msg_id,
                    "model": model,
                    "thinking": [],
                    "text": [],
                    "tools": [],
                }

            for block in blocks_of(record):
                btype = block.get("type")
                if btype == "thinking":
                    if not opts.no_thinking:
                        current["thinking"].append(truncate(block_text(block), opts.max_thinking_chars))
                elif btype == "text":
                    current["text"].append(block_text(block))
                elif btype == "tool_use":
                    name = block.get("name") or "?"
                    tool_input = block.get("input") or {}
                    result = results.get(block.get("id")) or {}
                    stats["tools"][name] += 1
                    if result.get("is_error"):
                        stats["tool_errors"][name] += 1
                    if name in WRITE_TOOLS and isinstance(tool_input, dict):
                        path = tool_input.get("file_path") or tool_input.get("notebook_path")
                        if path:
                            stats["files_touched"].setdefault(str(path), 0)
                            stats["files_touched"][str(path)] += 1
                    if name in ("Bash", "PowerShell") and isinstance(tool_input, dict):
                        command = tool_input.get("command")
                        if command:
                            stats["bash_commands"].append(one_line(command, 200))
                    if name == "Skill" and isinstance(tool_input, dict):
                        stats["skills"][str(tool_input.get("skill"))] += 1
                    current["tools"].append(
                        {
                            "id": block.get("id"),
                            "name": name,
                            "input_summary": summarize_tool_input(name, tool_input, opts.max_tool_chars),
                            "input_raw": tool_input if opts.raw_tool_input else None,
                            "ok": not result.get("is_error", False),
                            "has_result": bool(result),
                            "result_chars": len(result.get("text") or ""),
                            "result": truncate(result.get("text") or "", opts.max_tool_chars),
                        }
                    )
            continue

        stats["skipped"][f"type:{rtype}"] += 1

    flush()

    duration = None
    if first_ts and last_ts:
        duration = round((last_ts - first_ts).total_seconds(), 1)

    return {
        "turns": turns,
        "stats": stats,
        "started_at": first_ts.isoformat() if first_ts else None,
        "ended_at": last_ts.isoformat() if last_ts else None,
        "duration_seconds": duration,
    }


def load_subagents(session_dir: Path, opts) -> list:
    """加载 <session-id>/subagents/*.jsonl 及其 meta，返回子代理回放列表"""
    sub_dir = session_dir / "subagents"
    if not sub_dir.is_dir():
        return []
    agents = []
    for jsonl in sorted(sub_dir.glob("agent-*.jsonl")):
        meta_path = jsonl.with_suffix(".meta.json")
        meta = {}
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
        parsed = build_timeline(read_jsonl(jsonl), opts, allow_sidechain=True)
        agents.append(
            {
                "agent_id": jsonl.stem,
                "agent_type": meta.get("agentType"),
                "description": meta.get("description"),
                "tool_use_id": meta.get("toolUseId"),
                "spawn_depth": meta.get("spawnDepth"),
                **parsed,
            }
        )
    return agents


# ---------------------------------------------------------------- 渲染 markdown


def render_tool(tool: dict, opts) -> list:
    """渲染单个工具调用"""
    lines = []
    flag = "OK" if tool["ok"] else "ERROR"
    if not tool["has_result"]:
        flag = "NO-RESULT"
    lines.append(f"- **{tool['name']}** `[{flag}]`")
    if tool["input_summary"]:
        lines.append("  ```")
        for row in str(tool["input_summary"]).splitlines():
            lines.append(f"  {row}")
        lines.append("  ```")
    if tool["result"] and not opts.no_tool_results:
        lines.append(f"  <details><summary>result ({tool['result_chars']} chars)</summary>")
        lines.append("")
        lines.append("  ```")
        for row in tool["result"].splitlines():
            lines.append(f"  {row}")
        lines.append("  ```")
        lines.append("")
        lines.append("  </details>")
    return lines


def render_turns(turns: list, opts, heading_level: int = 3) -> list:
    """渲染时间线"""
    hashes = "#" * heading_level
    lines = []
    index = 0
    for turn in turns:
        index += 1
        stamp = local_str(turn.get("ts"))
        kind = turn["kind"]
        if kind == "user":
            lines.append(f"{hashes} [{index}] USER · {stamp}")
            branch = turn.get("git_branch")
            if branch:
                lines.append(f"> branch: `{branch}`")
            lines.append("")
            lines.append(turn["text"])
            lines.append("")
        elif kind == "assistant":
            model = turn.get("model") or ""
            lines.append(f"{hashes} [{index}] ASSISTANT · {stamp} · {model}")
            lines.append("")
            for think in turn["thinking"]:
                lines.append("<details><summary>thinking</summary>")
                lines.append("")
                lines.append(think)
                lines.append("")
                lines.append("</details>")
                lines.append("")
            for text in turn["text"]:
                if text.strip():
                    lines.append(text)
                    lines.append("")
            if turn["tools"]:
                lines.append("**tool calls**")
                lines.append("")
                for tool in turn["tools"]:
                    lines.extend(render_tool(tool, opts))
                lines.append("")
        elif kind == "system":
            tag = "HOOK-BLOCKED" if turn.get("blocked") else f"SYSTEM/{turn.get('level')}"
            lines.append(f"{hashes} [{index}] {tag} · {stamp}")
            lines.append("")
            lines.append("```")
            lines.append(turn["text"])
            lines.append("```")
            lines.append("")
        elif kind == "attachment":
            lines.append(f"{hashes} [{index}] ATTACHMENT/{turn.get('subtype')} · {stamp}")
            lines.append("")
            lines.append("```")
            lines.append(turn["text"])
            lines.append("```")
            lines.append("")
    return lines


def render_markdown(payload: dict, opts) -> str:
    """生成 replay.md"""
    stats = payload["stats"]
    lines = [
        f"# 会话回放 · {payload['session_id']}",
        "",
        "| 项 | 值 |",
        "| --- | --- |",
        f"| session | `{payload['session_id']}` |",
        f"| transcript | `{payload['transcript']}` |",
        f"| cwd | `{payload.get('cwd') or '-'}` |",
        f"| git branch | `{payload.get('git_branch') or '-'}` |",
        f"| 开始 | {local_str(payload.get('started_at'))}（本地时区）|",
        f"| 结束 | {local_str(payload.get('ended_at'))} |",
        f"| 时长 | {payload.get('duration_seconds')} 秒 |",
        f"| 用户输入 | {stats['user_prompts']} 次 |",
        f"| assistant 轮次 | {stats['assistant_turns']} |",
        f"| 工具调用 | {sum(stats['tools'].values())}（失败 {sum(stats['tool_errors'].values())}）|",
        f"| 子代理 | {len(payload.get('subagents') or [])} |",
        f"| hook 拦截 | {len(stats['hook_blocks'])} |",
        f"| output tokens | {stats['tokens'].get('output_tokens', 0)} |",
        f"| 模型 | {', '.join(f'{k}×{v}' for k, v in stats['models'].items()) or '-'} |",
        "",
        "## 初始诉求",
        "",
        f"> {one_line(payload.get('first_prompt') or '-', 500)}",
        "",
        "## 工具使用分布",
        "",
    ]
    if stats["tools"]:
        lines += ["| 工具 | 次数 | 失败 |", "| --- | --- | --- |"]
        for name, count in stats["tools"].most_common():
            lines.append(f"| {name} | {count} | {stats['tool_errors'].get(name, 0)} |")
    else:
        lines.append("（无）")
    lines.append("")

    if stats["files_touched"]:
        lines += ["## 改动文件", ""]
        for path, count in stats["files_touched"].items():
            lines.append(f"- `{path}` ×{count}")
        lines.append("")

    if stats["skills"]:
        lines += ["## 触发的 Skill", ""]
        for name, count in stats["skills"].most_common():
            lines.append(f"- `{name}` ×{count}")
        lines.append("")

    if stats["hook_blocks"]:
        lines += ["## Hook 拦截记录", ""]
        for item in stats["hook_blocks"]:
            lines.append(f"- `{local_str(item['ts'])}` {item['text']}")
        lines.append("")

    lines += ["## 时间线", ""]
    lines += render_turns(payload["turns"], opts, heading_level=3)

    subagents = payload.get("subagents") or []
    if subagents:
        lines += ["## 子代理会话", ""]
        for i, agent in enumerate(subagents, 1):
            lines.append(
                f"### 子代理 {i} · {agent.get('agent_type') or '?'} · `{agent['agent_id']}`"
            )
            lines.append("")
            lines.append(f"- 任务：{one_line(agent.get('description') or '-', 300)}")
            lines.append(f"- 关联 tool_use：`{agent.get('tool_use_id') or '-'}`")
            asub = agent["stats"]
            lines.append(
                f"- 工具调用 {sum(asub['tools'].values())}（失败 {sum(asub['tool_errors'].values())}）"
                f"，时长 {agent.get('duration_seconds')} 秒"
            )
            lines.append("")
            lines += render_turns(agent["turns"], opts, heading_level=4)

    if opts.show_skipped and stats["skipped"]:
        lines += ["## 已过滤的噪声记录", ""]
        for name, count in stats["skipped"].most_common():
            lines.append(f"- {name}: {count}")
        lines.append("")

    return "\n".join(lines) + "\n"


def to_json_payload(payload: dict) -> dict:
    """把 Counter/OrderedDict 转成可序列化结构"""

    def conv_stats(stats):
        return {
            "user_prompts": stats["user_prompts"],
            "assistant_turns": stats["assistant_turns"],
            "tools": dict(stats["tools"]),
            "tool_errors": dict(stats["tool_errors"]),
            "tool_calls_total": sum(stats["tools"].values()),
            "tool_errors_total": sum(stats["tool_errors"].values()),
            "files_touched": dict(stats["files_touched"]),
            "bash_commands": stats["bash_commands"],
            "models": dict(stats["models"]),
            "skills": dict(stats["skills"]),
            "hook_blocks": stats["hook_blocks"],
            "tokens": dict(stats["tokens"]),
            "skipped": dict(stats["skipped"]),
        }

    result = {
        "provider": payload.get("provider", "claude"),
        "session_id": payload["session_id"],
        "transcript": payload["transcript"],
        "cwd": payload.get("cwd"),
        "git_branch": payload.get("git_branch"),
        "started_at": payload.get("started_at"),
        "ended_at": payload.get("ended_at"),
        "duration_seconds": payload.get("duration_seconds"),
        "first_prompt": payload.get("first_prompt"),
        "exported_at": payload.get("exported_at"),
        "stats": conv_stats(payload["stats"]),
        "turns": payload["turns"],
        "subagents": [
            {
                "agent_id": a["agent_id"],
                "agent_type": a.get("agent_type"),
                "description": a.get("description"),
                "tool_use_id": a.get("tool_use_id"),
                "spawn_depth": a.get("spawn_depth"),
                "duration_seconds": a.get("duration_seconds"),
                "stats": conv_stats(a["stats"]),
                "turns": a["turns"],
            }
            for a in (payload.get("subagents") or [])
        ],
    }
    return result


# ---------------------------------------------------------------- 会话定位


def resolve_project_dir(args) -> Path:
    """定位 ~/.claude/projects 下的项目目录"""
    if args.project_dir:
        return Path(args.project_dir)
    base = Path(args.project).resolve() if args.project else Path.cwd()
    candidate = PROJECTS_ROOT / encode_project_dir(base)
    return candidate


def list_sessions(project_dir: Path) -> list:
    """列出项目下所有 transcript，按修改时间倒序"""
    if not project_dir.is_dir():
        return []
    items = []
    for path in project_dir.glob("*.jsonl"):
        items.append(path)
    return sorted(items, key=lambda p: p.stat().st_mtime, reverse=True)


def first_user_prompt(records: list) -> str:
    """取第一条真实用户诉求；优先取自然语言正文，其次取 slash command"""
    fallback = ""
    for record in records:
        if record.get("type") != "user" or record.get("isSidechain") or record.get("isMeta"):
            continue
        text = "\n".join(
            block_text(b) for b in blocks_of(record) if b.get("type") != "tool_result"
        ).strip()
        normalized = normalize_user_text(text)
        if not normalized:
            continue
        # 剔除系统生成的伪用户消息（子代理通知、中断标记），它们不代表用户诉求
        cleaned = re.sub(r"<task-notification>.*?</task-notification>", "", normalized, flags=re.S)
        cleaned = re.sub(r"^\[Request interrupted.*?\]$", "", cleaned, flags=re.M).strip()
        # 跳过纯 slash command 行，找真正的自然语言诉求
        body = "\n".join(
            line for line in cleaned.splitlines() if not line.strip().startswith("/")
        ).strip()
        if body:
            return body
        # 只剩 slash command：排除 /clear、/model 这类内置无业务语义命令
        real = [
            line.strip()
            for line in cleaned.splitlines()
            if line.strip() and line.strip().split()[0] not in NOOP_COMMANDS
        ]
        if real:
            return "\n".join(real)
        fallback = fallback or normalized
    return fallback


# ---------------------------------------------------------------- 命令实现


def cmd_list(args) -> int:
    project_dir = resolve_project_dir(args)
    if not project_dir.is_dir():
        print(f"Error: 项目目录不存在: {project_dir}", file=sys.stderr)
        return 1
    sessions = list_sessions(project_dir)
    if not sessions:
        print(f"（{project_dir} 下没有 transcript）")
        return 0
    print(f"项目目录: {project_dir}")
    print(f"{'session-id':38} {'修改时间':20} {'大小':>9}  首条输入")
    for path in sessions[: args.limit]:
        stat = path.stat()
        mtime = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
        size = f"{stat.st_size / 1024:.0f}KB"
        prompt = one_line(first_user_prompt(read_jsonl(path)), 60) or "-"
        print(f"{path.stem:38} {mtime:20} {size:>9}  {prompt}")
    return 0


def cmd_export(args) -> int:
    project_dir = resolve_project_dir(args)

    if args.file:
        transcript = Path(args.file).resolve()
    elif args.session:
        transcript = project_dir / f"{args.session}.jsonl"
    else:  # --last
        sessions = list_sessions(project_dir)
        if not sessions:
            print(f"Error: {project_dir} 下没有 transcript", file=sys.stderr)
            return 1
        # 默认跳过当前会话自身（正在写入的最新文件通常就是当前会话）
        pick = 0
        if args.skip_current and len(sessions) > 1:
            current = os.environ.get("CLAUDE_SESSION_ID")
            if current and sessions[0].stem == current:
                pick = 1
        transcript = sessions[pick]

    if not transcript.exists():
        print(f"Error: transcript 不存在: {transcript}", file=sys.stderr)
        return 1

    records = read_jsonl(transcript)
    if not records:
        print(f"Error: transcript 为空: {transcript}", file=sys.stderr)
        return 1

    parsed = build_timeline(records, args)
    session_id = transcript.stem
    session_dir = transcript.parent / session_id

    payload = {
        "provider": "claude",
        "session_id": session_id,
        "transcript": str(transcript),
        "cwd": next((r.get("cwd") for r in records if r.get("cwd")), None),
        "git_branch": next((r.get("gitBranch") for r in records if r.get("gitBranch")), None),
        "first_prompt": first_user_prompt(records),
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "subagents": [] if args.no_subagents else load_subagents(session_dir, args),
        **parsed,
    }

    out_root = Path(args.out).resolve() if args.out else DEFAULT_OUT_ROOT
    out_dir = allocate_replay_dir(
        out_root,
        payload.get("started_at"),
        str(payload["session_id"]),
    )

    written = []
    if args.format in ("md", "both"):
        md_path = out_dir / "replay.md"
        md_path.write_text(render_markdown(payload, args), encoding="utf-8")
        written.append(md_path)
    # replay.json 同时承担目录身份元数据，任何成功导出都必须写入。
    json_path = out_dir / "replay.json"
    json_path.write_text(
        json.dumps(to_json_payload(payload), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    written.append(json_path)

    stats = payload["stats"]
    print(f"session      : {session_id}")
    print(f"transcript   : {transcript}")
    print(f"轮次         : user {stats['user_prompts']} / assistant {stats['assistant_turns']}")
    print(
        f"工具调用     : {sum(stats['tools'].values())}"
        f"（失败 {sum(stats['tool_errors'].values())}）"
    )
    print(f"子代理       : {len(payload['subagents'])}")
    print(f"hook 拦截    : {len(stats['hook_blocks'])}")
    print(f"过滤噪声     : {sum(stats['skipped'].values())} 条")
    for path in written:
        print(f"输出         : {path}  ({path.stat().st_size / 1024:.0f}KB)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="导出 Claude Code 会话 transcript 为可回放的 md/json（只读）",
    )
    parser.add_argument("--list", action="store_true", help="列出本项目所有会话")
    parser.add_argument("--limit", type=int, default=20, help="--list 显示条数，默认 20")

    group = parser.add_argument_group("会话选择")
    group.add_argument("--last", action="store_true", help="导出最近一次会话（默认行为）")
    group.add_argument("--session", help="指定 session-id")
    group.add_argument("--file", help="直接指定 transcript jsonl 路径")
    group.add_argument("--project", help="项目工作目录，默认当前目录")
    group.add_argument("--project-dir", help="直接指定 ~/.claude/projects 下的目录")
    group.add_argument(
        "--skip-current",
        action="store_true",
        help="--last 时跳过当前正在进行的会话（依赖 CLAUDE_SESSION_ID）",
    )

    out = parser.add_argument_group("输出控制")
    out.add_argument("--out", help=f"输出根目录，默认 {DEFAULT_OUT_ROOT}")
    out.add_argument("--format", choices=["md", "json", "both"], default="both")
    out.add_argument("--max-tool-chars", type=int, default=800, help="工具结果截断长度，默认 800，0 为不截断")
    out.add_argument("--max-thinking-chars", type=int, default=600, help="thinking 截断长度，默认 600")
    out.add_argument("--max-user-chars", type=int, default=4000, help="用户输入截断长度，默认 4000")
    out.add_argument("--no-thinking", action="store_true", help="不导出 thinking")
    out.add_argument("--no-tool-results", action="store_true", help="md 中不展开工具结果")
    out.add_argument("--no-subagents", action="store_true", help="不导出子代理会话")
    out.add_argument("--raw-tool-input", action="store_true", help="json 中保留完整工具入参")
    out.add_argument("--keep-meta", action="store_true", help="保留本地命令回显等 meta 输入")
    out.add_argument("--show-skipped", action="store_true", help="md 末尾附噪声过滤统计")
    out.add_argument("--full", action="store_true", help="不截断任何内容（等价 max-* 全设 0）")

    args = parser.parse_args()
    if args.full:
        args.max_tool_chars = 0
        args.max_thinking_chars = 0
        args.max_user_chars = 0

    if args.list:
        return cmd_list(args)
    return cmd_export(args)


if __name__ == "__main__":
    sys.exit(main())
