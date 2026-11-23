#!/usr/bin/env python3
"""对统一 replay.json 生成工具调用事件序列表 timeline.md，兼容 Codex 回放。

输出契约与 Claude Code 版（.claude/skills/session-replay/scripts/session-timeline.py）一致：
完整工具调用明细按时间升序成表（时间/域/工具/对象/结果），对象列对 Task / MCP·TFS /
CodeGraph 做语义化描述，结果列给出成败摘要。对回放数据的中文字段乱码保持鲁棒，
TFS 标题可经 --tfs-titles 补注。

硬约束：只读 replay.json，只写回放目录下的 timeline.md。
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
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
SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SCRIPT_ROOT) not in sys.path:
    # 支持测试按文件路径加载 timeline，同时复用公开命令结果诊断 helper。
    sys.path.insert(0, str(SCRIPT_ROOT))

from metrics_core import normalize_command_key
from replay_analyze import diagnose_command_result


# ---------------------------------------------------------------- 数据加载


def load_replay(target: str | None) -> tuple[dict, Path]:
    """定位并加载 replay.json（与 replay_analyze.py 同口径）。"""
    if target:
        p = Path(target)
        if p.is_dir():
            p = p / "replay.json"
        if not p.exists():
            sys.exit(f"未找到 replay.json: {p}")
    else:
        candidates = sorted(DEFAULT_REPLAY_ROOT.glob("*/replay.json"))
        if not candidates:
            sys.exit(f"{DEFAULT_REPLAY_ROOT} 下没有任何导出，请先运行 session_export.py")
        p = candidates[-1]
    with p.open(encoding="utf-8") as fh:
        return json.load(fh), p


def iter_calls(node: dict, scope: str):
    """递归遍历主会话与所有子代理的工具调用，产出 (scope, ts, call)。"""
    for turn in node.get("turns", []) or []:
        if turn.get("kind") != "assistant":
            continue
        for call in turn.get("tools", []) or []:
            yield scope, turn.get("ts", ""), call
    for sub in node.get("subagents", []) or []:
        yield from iter_calls(sub, "SUB")


# ---------------------------------------------------------------- 语义提取（乱码鲁棒）


def ascii_only(s: str) -> str:
    """保留 ASCII 可打印字符，其余替换为空格（回放数据中文可能已乱码）。"""
    return "".join(ch if 32 <= ord(ch) < 127 else " " for ch in (s or ""))


def json_get(s: str, *keys):
    try:
        d = json.loads(s)
    except Exception:
        return None
    if isinstance(d, dict):
        for k in keys:
            if k in d and d[k] is not None:
                return d[k]
    return None


def is_garbled(s: str) -> bool:
    """判断字符串是否为乱码：含替换符，或含控制区私用字符。"""
    if not s:
        return True
    if "�" in s:
        return True
    if re.search(r"[-]", s):
        return True
    return False


def tool_group(tool: str) -> str:
    if tool.startswith("mcp__codegraph"):
        return "MCP·CodeGraph"
    if tool.startswith("mcp__winning-tfs"):
        return "MCP·TFS"
    if tool in ("TaskCreate", "TaskUpdate"):
        return "Task"
    if tool in ("Agent", "AskUserQuestion"):
        return "Agent·Ask"
    return tool


def task_desc(summary: str, result: str) -> str:
    """Task 工具对象描述：输入 JSON 的 ASCII 片段 + result 的任务编号。"""
    a = ascii_only(result)
    m = re.search(r"Task #(\d+) created", a)
    num = m.group(1) if m else json_get(summary, "taskId")
    status = json_get(summary, "status")
    if status:
        return f"Task #{num} → {status}"
    subj = json_get(summary, "subject") or json_get(summary, "activeForm") or ""
    words = [w for w in ascii_only(subj).split() if len(w) >= 4][:4]
    return f"Task #{num} 创建 · " + " ".join(words)


def tfs_desc(tool: str, summary: str, result: str, tfs_titles: dict) -> str:
    """TFS 调用对象描述：优先 result 中的工作项标题，乱码则用 --tfs-titles 映射。"""
    wid = json_get(summary, "id") or "?"
    if tool.endswith("tfs_list_attachments"):
        return f"TFS 需求 {wid} 附件列表"
    title = None
    try:
        title = json_get(result, "title")
    except Exception:
        title = None
    if is_garbled(title):
        title = tfs_titles.get(str(wid))
    if title:
        return f"TFS 需求 {wid}「{title}」"
    return f"TFS 需求 {wid}（标题源数据乱码，可经 --tfs-titles 补注）"


def obj_desc(scope: str, tool: str, summary: str, result: str, tfs_titles: dict) -> str:
    """对象列：Task / MCP·TFS / CodeGraph 给语义描述，其余保留原始入参。"""
    if tool in ("TaskCreate", "TaskUpdate"):
        return task_desc(summary, result)
    if tool.startswith("mcp__winning-tfs"):
        return tfs_desc(tool, summary, result, tfs_titles)
    if tool.startswith("mcp__codegraph"):
        q = json_get(summary, "query")
        return "CodeGraph 查询「" + q + "」" if q else summary
    return summary


TRUNCATION_SUFFIX = re.compile(r"\n…?\[已截断，原文共 \d+ 字符\]\s*$")
GREP_MATCH_LINE = re.compile(r"^(?:.+?:)?\d+:.*$")
GREP_CONTEXT_LINE = re.compile(r"^(?:.+?-)?\d+-.*$")


def _looks_like_path(line: str) -> bool:
    """识别 Glob 当前支持的逐行路径格式，拒绝明显的说明性文本。"""
    if not line or any(ch.isspace() for ch in line):
        return False
    return bool(
        "/" in line
        or "\\" in line
        or re.search(r"(?:^|[./\\])[^./\\]+\.[^./\\]+$", line)
    )


def _search_summary(tool: str, result: str, result_chars: int) -> str:
    """按原始换行统计搜索结果；截断时仅报告完整保留项的下界。"""
    raw_result = result or ""
    marker = TRUNCATION_SUFFIX.search(raw_result)
    # marker 前的换行由导出器追加，不属于保留前缀；先剥离才能判断真实截断边界。
    retained = raw_result[:marker.start()] if marker else raw_result
    retained_ends_line = retained.endswith(("\n", "\r"))
    lines = [line.strip() for line in retained.splitlines() if line.strip()]
    truncated = marker is not None or result_chars > len(raw_result)
    if truncated and lines and not retained_ends_line:
        # 仅当前缀停在行内时，最后一行才可能是不完整项。
        lines.pop()

    label = "个文件" if tool == "Glob" else "处匹配"
    if not truncated and (not lines or lines == ["No matches found"]):
        return f"✓ 0 {label}"

    if tool == "Glob":
        known = [line for line in lines if _looks_like_path(line)]
        supported = len(known) == len(lines)
    else:
        known = [line for line in lines if GREP_MATCH_LINE.fullmatch(line)]
        supported = all(
            GREP_MATCH_LINE.fullmatch(line)
            or GREP_CONTEXT_LINE.fullmatch(line)
            or line == "--"
            for line in lines
        )

    if truncated:
        return f"✓ 至少 {len(known)} {label}" if known else "✓ 已返回，命中总数未知"
    if supported:
        return f"✓ {len(known)} {label}"
    return "✓ 已返回，命中总数未知"


def result_summary(tool: str, ok: bool, result: str, result_chars: int) -> str:
    """结果列摘要：对乱码鲁棒，只依赖 ASCII 结构。"""
    a = ascii_only(result)
    if not ok:
        if tool == "Bash":
            m = re.search(r"[Ee]xit code (\d+)", a)
            m2 = (re.search(r'"error":\s*"([A-Za-z_]+)"', a)
                  or re.search(r"\berror\.([A-Za-z_]+)", a)
                  or re.search(r"Error:\s*([A-Za-z_]+)", a))
            err = (" · " + m2.group(1)) if m2 else ""
            return f"✗ exit {m.group(1) if m else '?'}{err}"
        if tool == "Read":
            return "✗ File does not exist"
        return "✗ " + a.strip()[:40]
    if tool == "Bash":
        diagnosis = diagnose_command_result(result)
        if diagnosis and diagnosis[1] == "high":
            return "✓ 工具成功；输出含异常信号"
        m = re.search(r'"route_result":\s*"([a-z_]+)"', a)
        if m:
            return f"✓ route_result={m.group(1)}"
        m = re.search(r'^\s*\{\s*"status":\s*"([a-z_]+)"', a)
        if m:
            return f"✓ status={m.group(1)}"
        return "✓ " + a.strip().split("\n")[0].strip()[:52]
    if tool == "Read":
        return f"✓ {result_chars} 字符"
    if tool == "Write":
        m = re.search(r"([A-Za-z]:\\[^\s()]+)", a)
        return "✓ 已写入 " + os.path.basename(m.group(1)) if m else "✓"
    if tool == "Grep":
        return _search_summary(tool, result, result_chars)
    if tool == "Glob":
        return _search_summary(tool, result, result_chars)
    if tool.startswith("mcp__codegraph"):
        m = re.search(r"Found (\d+) symbols? across (\d+) files?", a)
        return f"✓ {m.group(0)}" if m else "✓ 已返回"
    if tool.startswith("mcp__winning-tfs"):
        if tool.endswith("tfs_get_work_item"):
            return "✓ 已获取需求"
        return "✓ 无附件" if a.strip() == "[]" else "✓ 已返回"
    if tool == "TaskCreate":
        return "✓ 已创建（见对象列）"
    if tool == "TaskUpdate":
        return "✓ 任务状态已更新"
    if tool == "Agent":
        return "✓ 已派发子代理"
    if tool == "AskUserQuestion":
        return "✓ 已回答（内容见 replay.md）"
    return "✓"


# ---------------------------------------------------------------- 重复统计


def repeat_stats(calls) -> str:
    """重复读取/执行统计：Read/Write 按路径、Bash 按规范化命令族、Grep 按 pattern 分组。

    只列出出现 >=2 次的对象；全部唯一时返回单行说明。
    """
    read_c: Counter = Counter()
    write_c: Counter = Counter()
    bash_c: Counter = Counter()
    grep_c: Counter = Counter()
    for _scope, _ts, call in calls:
        name = call["name"]
        summary = (call.get("input_summary") or "").replace("\n", " ")
        if name == "Read":
            read_c[summary] += 1
        elif name == "Write":
            write_c[summary] += 1
        elif name == "Bash":
            bash_c[normalize_command_key(summary)] += 1
        elif name == "Grep":
            grep_c[summary] += 1

    def render(title: str, counter: Counter) -> str | None:
        items = sorted(((n, k) for k, n in counter.items() if n >= 2), reverse=True)
        if not items:
            return None
        lines = [f"### {title}", "", "| 次数 | 对象 |", "| --- | --- |"]
        for n, k in items:
            lines.append(f"| {n} | {k.replace('|', '¦')} |")
        return "\n".join(lines)

    sections = [
        s
        for s in (
            render("重复读取的文档（Read，完整路径）", read_c),
            render("重复执行的脚本（Bash，命令族口径，归一化去除可变参数）", bash_c),
            render("重复写入的文件（Write，完整路径）", write_c),
            render("重复搜索（Grep pattern）", grep_c),
        )
        if s
    ]
    if not sections:
        return "无重复项：所有文档 / 脚本 / pattern 均只出现 1 次。"
    return "\n\n".join(sections)


# ---------------------------------------------------------------- 文档生成


def build_timeline_md(data: dict, source: Path, tfs_titles: dict) -> str:
    calls = sorted(
        iter_calls(data, "MAIN"),
        key=lambda x: datetime.fromisoformat(x[1].replace("Z", "+00:00")),
    )
    sid = data.get("session_id", "?")
    rows = []
    failures = 0
    for i, (scope, ts_raw, call) in enumerate(calls, 1):
        summary = (call.get("input_summary") or "").replace("\n", " ")
        result = call.get("result") or ""
        ok = call.get("ok")
        if not ok:
            failures += 1
        t = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
        # 对象列完整保留入参（文件路径等不截断）；仅转义表格分隔符
        obj = obj_desc(scope, call["name"], summary, result, tfs_titles)
        obj = obj.replace("|", "¦").replace("\n", " ")
        res = result_summary(call["name"], ok, result, call.get("result_chars") or 0)
        rows.append(
            f'| {i} | {t.strftime("%H:%M:%S")} | {scope} | `{tool_group(call["name"])}` | {obj} | {res} |'
        )

    frontmatter = f"""---
title: 工具调用事件序列表 · {sid[:8]}
contract: SessionReplay
version: 1.1.0
status: active
created_at: {datetime.now().strftime('%Y-%m-%d')}
updated_at: {datetime.now().strftime('%Y-%m-%d')}
owner: winning\\li_lei
---

# 工具调用事件序列表 · {sid}

> 数据源：`replay.json`（与本目录 `replay.md` 同源）。
> 时间轴为 **UTC**；会话 `{data.get('started_at', '?')} → {data.get('ended_at', '?')}`，共 {data.get('duration_seconds', 0):.0f}s。
> 事件粒度：轮次级（assistant turn 时间戳，同一轮内并行工具共享时间戳）。
> 域：MAIN = 主线程，SUB = 子代理。

## 重复统计（相同文档 / 脚本的重复读取与执行，>=2 次）

{repeat_stats(calls)}

## 完整事件序列表（{len(rows)} 条，按时间升序）

| # | 时间(UTC) | 域 | 工具 | 对象 | 结果 |
| --- | --- | --- | --- | --- | --- |
{chr(10).join(rows)}
"""
    return frontmatter, len(rows), failures


# ---------------------------------------------------------------- 入口


def main() -> int:
    parser = argparse.ArgumentParser(
        description="从统一 replay.json 生成工具调用事件序列表 timeline.md"
    )
    parser.add_argument(
        "target",
        nargs="?",
        help="replay.json 路径或其所在目录；留空取 projects/replay 下最新一次导出",
    )
    parser.add_argument(
        "--out",
        help="指定输出文件；默认写入回放目录下的 timeline.md",
    )
    parser.add_argument(
        "--tfs-titles",
        default="{}",
        help='TFS 工作项标题补注映射（JSON 字符串，如 \'{"245614": "数据源管理"}\'）。'
        "回放数据中工作项标题乱码时使用，生成文档前可经 TFS MCP 现查补注。",
    )
    args = parser.parse_args()

    try:
        tfs_titles = json.loads(args.tfs_titles)
        if not isinstance(tfs_titles, dict):
            sys.exit("--tfs-titles 必须是 JSON 对象")
    except Exception:
        sys.exit("--tfs-titles 解析失败，需要 JSON 对象格式")

    data, source = load_replay(args.target)
    text, total, failures = build_timeline_md(data, source, tfs_titles)

    out = Path(args.out) if args.out else source.parent / "timeline.md"
    out.write_text(text, encoding="utf-8")
    print(f"timeline.md 已生成：{out}")
    print(f"事件总数 {total}，失败 {failures}")
    if tfs_titles:
        print(f"TFS 标题补注 {len(tfs_titles)} 条：{list(tfs_titles)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
