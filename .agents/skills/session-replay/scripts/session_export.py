#!/usr/bin/env python3
"""Codex session-replay 命令入口；默认导入当前会话并落盘。"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from codex_session import (
    build_replay,
    default_codex_home,
    discover_sessions,
    resolve_session,
)
from output_path import allocate_replay_dir


for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass


ROOT = Path(__file__).resolve().parents[4]
DEFAULT_OUT_ROOT = ROOT / "projects" / "replay"


def _local_time(value: object, fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.astimezone().strftime(fmt)
    except (TypeError, ValueError):
        return str(value or "-")


def _one_line(value: object, limit: int = 300) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _render_turns(turns: list[dict], heading_level: int = 3) -> list[str]:
    """渲染主会话或子任务时间线。"""

    lines: list[str] = []
    prefix = "#" * heading_level
    for index, turn in enumerate(turns, 1):
        stamp = _local_time(turn.get("ts"))
        if turn.get("kind") == "user":
            lines.extend([f"{prefix} [{index}] USER · {stamp}", "", str(turn.get("text") or ""), ""])
            continue
        lines.extend([f"{prefix} [{index}] ASSISTANT · {stamp}", ""])
        for text in turn.get("text") or []:
            if text:
                lines.extend([str(text), ""])
        for tool in turn.get("tools") or []:
            flag = "OK" if tool.get("ok") else "ERROR"
            lines.append(f"- **{tool.get('name')}** `[{flag}]` {_one_line(tool.get('input_summary'))}")
            if tool.get("result"):
                lines.extend(["", "  ```text", str(tool["result"]), "  ```"])
        lines.append("")
    return lines


def render_markdown(replay: dict) -> str:
    """把统一结构渲染为可定点取证的 Markdown。"""

    stats = replay["stats"]
    lines = [
        f"# Codex 会话回放 · {replay['session_id']}",
        "",
        "| 项 | 值 |",
        "| --- | --- |",
        f"| provider | `codex` |",
        f"| session | `{replay['session_id']}` |",
        f"| transcript files | {len(replay.get('transcripts') or [])} |",
        f"| cwd | `{replay.get('cwd') or '-'}` |",
        f"| 开始 | {_local_time(replay.get('started_at'))} |",
        f"| 结束 | {_local_time(replay.get('ended_at'))} |",
        f"| 时长 | {replay.get('duration_seconds')} 秒 |",
        f"| 用户输入 | {stats.get('user_prompts', 0)} |",
        f"| assistant 轮次 | {stats.get('assistant_turns', 0)} |",
        f"| 工具调用 | {stats.get('tool_calls_total', 0)}（失败 {stats.get('tool_errors_total', 0)}）|",
        f"| 子代理 | {len(replay.get('subagents') or [])} |",
        (
            f"| hook 拦截 | {len(stats.get('hook_blocks') or [])} |"
            if stats.get("hook_observability") == "available"
            else "| hook 拦截 | 不可用（历史会话无 Codex hook 审计）|"
        ),
        f"| output tokens | {(stats.get('tokens') or {}).get('output_tokens')} |",
        "",
        "## 初始诉求",
        "",
        f"> {_one_line(replay.get('first_prompt') or '-', 500)}",
        "",
        "## 时间线",
        "",
    ]

    lines.extend(_render_turns(replay.get("turns") or []))
    if stats.get("hook_blocks"):
        lines.extend(["## Hook 拦截记录", ""])
        for item in stats["hook_blocks"]:
            lines.append(f"- `{_local_time(item.get('ts'))}` {item.get('text')}")
        lines.append("")
    if replay.get("subagents"):
        lines.extend(["## 子代理会话", ""])
        for index, child in enumerate(replay["subagents"], 1):
            lines.extend(
                [
                    f"### 子代理 {index} · {child.get('agent_type') or '?'} · `{child.get('agent_id')}`",
                    "",
                    f"- 任务：{_one_line(child.get('description') or '-', 300)}",
                    f"- 耗时：{child.get('duration_seconds')} 秒",
                    "",
                ]
            )
            lines.extend(_render_turns(child.get("turns") or [], heading_level=4))
    return "\n".join(lines).rstrip() + "\n"


def list_sessions(args: argparse.Namespace) -> int:
    sessions = discover_sessions(codex_home=args.codex_home, project=args.project)
    print(f"{'session-id':38} {'修改时间':19} {'文件':>4}  首目录")
    for source in sessions[: args.limit]:
        modified = datetime.fromtimestamp(source.latest_mtime).strftime("%Y-%m-%d %H:%M:%S")
        print(
            f"{source.session_id:38} {modified:19} {len(source.files):>4}  "
            f"{_one_line(source.cwd, 80)}"
        )
    return 0


def export_replay(replay: dict, args: argparse.Namespace) -> int:
    out_root = args.out.resolve()
    out_dir = allocate_replay_dir(
        out_root,
        replay.get("started_at"),
        str(replay["session_id"]),
    )

    written: list[Path] = []
    # replay.json 同时承担目录身份元数据，任何成功导出都必须写入。
    path = out_dir / "replay.json"
    path.write_text(json.dumps(replay, ensure_ascii=False, indent=2), encoding="utf-8")
    written.append(path)
    if args.format in {"md", "both"}:
        path = out_dir / "replay.md"
        path.write_text(render_markdown(replay), encoding="utf-8")
        written.append(path)

    print(f"session      : {replay['session_id']}")
    print(f"transcripts  : {len(replay.get('transcripts') or [])}")
    for path in written:
        print(f"输出         : {path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="导入 Codex 本地 session，并生成 replay.json/replay.md",
    )
    parser.add_argument("--list", action="store_true", help="列出当前项目的 Codex sessions")
    parser.add_argument("--session", help="指定完整 session-id 或唯一前缀")
    parser.add_argument("--project", type=Path, default=Path.cwd(), help="项目 cwd，默认当前目录")
    parser.add_argument("--codex-home", type=Path, default=default_codex_home())
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_ROOT)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--format", choices=("json", "md", "both"), default="both")
    parser.add_argument("--max-tool-chars", type=int, default=800)
    parser.add_argument("--max-user-chars", type=int, default=4_000)
    parser.add_argument("--no-subagents", action="store_true", help="不导入 Codex 子任务会话")
    parser.add_argument("--full", action="store_true", help="不截断工具结果和用户输入")
    args = parser.parse_args()

    if args.list:
        return list_sessions(args)

    try:
        source = resolve_session(
            codex_home=args.codex_home,
            project=args.project,
            session_id=args.session,
        )
        if args.full:
            args.max_tool_chars = 0
            args.max_user_chars = 0
        replay = build_replay(
            source,
            max_tool_chars=args.max_tool_chars,
            max_user_chars=args.max_user_chars,
            include_subagents=not args.no_subagents,
        )
    except (FileNotFoundError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    return export_replay(replay, args)


if __name__ == "__main__":
    raise SystemExit(main())
