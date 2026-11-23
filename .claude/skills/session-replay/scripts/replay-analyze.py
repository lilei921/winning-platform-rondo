#!/usr/bin/env python3
# replay-analyze.py - 只读：对 session-export.py 产出的 replay.json 做第一层确定性统计
#
# Author: winning\li_lei
# Created: 2026-07-30
# Updated: 2026-09-02
# Description: 复盘分析三层漏斗中的第 1 层。不做任何语义判断，只算指标、
#              定位可疑区间，把 50 万字符的 replay.md 压缩成几百行可读报告，
#              供 LLM 在第 2 层做归因、第 3 层做取证。
#
# 硬约束：只读 replay.json，只向 stdout / --out 写，不修改任何仓库状态。
from __future__ import annotations

import argparse
import io
import json
import re
import statistics
import sys
from collections import Counter
from pathlib import Path

# Windows 控制台默认 GBK，打印中文会炸，这里强制 UTF-8
for _name in ("stdout", "stderr"):
    _stream = getattr(sys, _name)
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass
    # reconfigure 在个别重定向场景可能静默失效，退回 buffer 包装兜底
    if (getattr(_stream, "encoding", "") or "").lower() != "utf-8":
        try:
            setattr(sys, _name, io.TextIOWrapper(_stream.buffer, encoding="utf-8"))
        except Exception:
            pass

# 脚本位于 .claude/skills/session-replay/scripts/ 下，向上四级为仓库根
ROOT = Path(__file__).resolve().parents[4]
DEFAULT_REPLAY_ROOT = ROOT / "projects" / "replay"
METRICS_ROOT = ROOT / ".agents" / "skills" / "session-replay" / "scripts"
if str(METRICS_ROOT) not in sys.path:
    # Claude analyzer 与 Codex analyzer 共用同一套指标语义。
    sys.path.insert(0, str(METRICS_ROOT))

from metrics_core import display_command, normalize_command_key, summarize_claude_replay

# task-notification 等系统回灌的 user turn 不是真实用户干预，统计时剔除
SYSTEM_USER_PATTERNS = (
    re.compile(r"^\s*<task-notification>"),
    re.compile(r"^\s*<system-reminder>"),
    re.compile(r"^\s*<local-command-"),
)

# ---------------------------------------------------------------- 通用工具


def load_replay(target: str | None) -> tuple[dict, Path]:
    """定位并加载 replay.json。target 可为 json 文件、导出目录，或留空取最新一次导出。"""
    if target:
        p = Path(target)
        if p.is_dir():
            p = p / "replay.json"
        if not p.exists():
            sys.exit(f"未找到 replay.json: {p}")
    else:
        candidates = sorted(DEFAULT_REPLAY_ROOT.glob("*/replay.json"))
        if not candidates:
            sys.exit(f"{DEFAULT_REPLAY_ROOT} 下没有任何导出，请先运行 session-export.py")
        # 导出目录名以 YYYYmmdd-HHMM 开头，字典序即时间序
        p = candidates[-1]
    with p.open(encoding="utf-8") as fh:
        return json.load(fh), p


# 保留旧名称，兼容现有调用方；聚类语义由共享核心统一。
normalize_cmd = normalize_command_key


def error_signature(result: str, limit: int = 90) -> str:
    """把错误文本压成签名，用于聚类同类失败。"""
    s = re.sub(r"\s+", " ", result or "").strip()
    # 去掉具体路径、ID、GUID 等可变部分，让同类错误落到同一个签名
    s = re.sub(r"[A-Za-z]:\\[^\s\"']+", "<path>", s)
    s = re.sub(r"/[\w./-]{8,}", "<path>", s)
    s = re.sub(r"\b[0-9a-f]{8}-[0-9a-f-]{20,}\b", "<guid>", s)
    s = re.sub(r"\b\d{4,}\b", "<num>", s)
    return s[:limit]


def iter_calls(node: dict, scope: str):
    """递归遍历主会话与所有子代理的工具调用，产出 (scope, ts, call)。"""
    for turn in node.get("turns", []) or []:
        if turn.get("kind") != "assistant":
            continue
        for call in turn.get("tools", []) or []:
            yield scope, turn.get("ts", ""), call
    for sub in node.get("subagents", []) or []:
        label = f"{sub.get('agent_type', 'subagent')}#{(sub.get('agent_id') or '')[:8]}"
        yield from iter_calls(sub, label)


def iter_subagents(node: dict):
    for sub in node.get("subagents", []) or []:
        yield sub
        yield from iter_subagents(sub)


def is_real_user_turn(turn: dict) -> bool:
    if turn.get("kind") != "user":
        return False
    text = (turn.get("text") or "").strip()
    if not text:
        return False
    return not any(p.match(text) for p in SYSTEM_USER_PATTERNS)


# ---------------------------------------------------------------- 各项指标


def metric_overview(
    data: dict, calls: list, canonical_wall: float | None = None
) -> dict:
    stats = data.get("stats", {}) or {}
    subs = list(iter_subagents(data))
    total = (
        canonical_wall
        if canonical_wall is not None
        else data.get("duration_seconds") or 0
    )
    # 子代理串行执行时其耗时计入主线，这里只用于识别"时间去哪了"，不做精确归因
    sub_seconds = sum(s.get("duration_seconds") or 0 for s in subs)
    errors = [c for _, _, c in calls if not c.get("ok")]
    real_users = [t for t in data.get("turns", []) if is_real_user_turn(t)]
    return {
        "session_id": data.get("session_id"),
        "started_at": data.get("started_at"),
        "duration_seconds": total,
        "duration_human": f"{total / 3600:.2f}h",
        "first_prompt": (data.get("first_prompt") or "")[:120],
        "assistant_turns": stats.get("assistant_turns"),
        "calls_total": len(calls),
        "calls_failed": len(errors),
        "fail_rate": round(len(errors) / len(calls), 3) if calls else 0,
        "subagent_count": len(subs),
        "subagent_seconds": round(sub_seconds, 1),
        "subagent_share": round(sub_seconds / total, 3) if total else 0,
        "real_user_turns": len(real_users),
        "hook_blocks": len(stats.get("hook_blocks") or []),
        "output_tokens": (stats.get("tokens") or {}).get("output_tokens"),
    }


def metric_repeats(calls: list, threshold: int) -> list:
    """重复 Bash 命令：暴露轮询式推进与试错式调参。"""
    counter = Counter()
    for scope, _, call in calls:
        if call.get("name") != "Bash":
            continue
        counter[(scope, normalize_command_key(call.get("input_summary") or ""))] += 1
    rows = [
        {"scope": scope, "count": n, "command": cmd}
        for (scope, cmd), n in counter.most_common()
        if n >= threshold
    ]
    return rows


def metric_failures(calls: list) -> dict:
    """失败调用：按 (工具, 错误签名) 聚类，同类只留首个样本。"""
    clusters: dict[tuple, dict] = {}
    by_tool = Counter()
    for scope, ts, call in calls:
        if call.get("ok"):
            continue
        name = call.get("name") or "?"
        by_tool[name] += 1
        sig = error_signature(call.get("result") or "")
        key = (name, sig)
        if key not in clusters:
            clusters[key] = {
                "tool": name,
                "signature": sig,
                "count": 0,
                "scopes": set(),
                "first_ts": ts,
                # 入参压成单行，避免破坏 md 列表结构
                "sample_input": re.sub(r"\s+", " ", call.get("input_summary") or "").strip()[:160],
            }
        clusters[key]["count"] += 1
        clusters[key]["scopes"].add(scope)
    rows = sorted(clusters.values(), key=lambda r: -r["count"])
    for r in rows:
        r["scopes"] = sorted(r["scopes"])[:4]
    return {"by_tool": by_tool.most_common(), "clusters": rows}


def metric_subagents(data: dict) -> list:
    """子代理健康度：空转、高失败率、耗时离群。"""
    subs = list(iter_subagents(data))
    if not subs:
        return []
    durations = [s.get("duration_seconds") or 0 for s in subs]
    median = statistics.median(durations) if durations else 0
    rows = []
    for s in subs:
        st = s.get("stats", {}) or {}
        total = st.get("tool_calls_total") or 0
        failed = st.get("tool_errors_total") or 0
        dur = s.get("duration_seconds") or 0
        flags = []
        if total == 0:
            flags.append("空转(无工具调用)")
        if total and failed / total >= 0.3:
            flags.append(f"高失败率({failed}/{total})")
        if median and dur > median * 3:
            flags.append(f"耗时离群({dur / median:.1f}x中位数)")
        rows.append(
            {
                "agent_type": s.get("agent_type"),
                "description": (s.get("description") or "")[:60],
                "duration_seconds": round(dur, 1),
                "calls": total,
                "failed": failed,
                "flags": flags,
            }
        )
    return sorted(rows, key=lambda r: -r["duration_seconds"])


def metric_rework(data: dict, threshold: int) -> list:
    """同一文件被反复写入：返工信号。"""
    touched = (data.get("stats", {}) or {}).get("files_touched") or {}
    if isinstance(touched, dict):
        items = touched.items()
    else:  # 兼容 list 形态
        items = Counter(touched).items()
    return [
        {"file": f, "count": n}
        for f, n in sorted(items, key=lambda kv: -kv[1])
        if n >= threshold
    ]


def metric_interventions(data: dict) -> list:
    """真实用户输入：剔除 task-notification 等系统回灌；中途插话是 agent 跑偏/卡住的信号。"""
    rows = []
    for turn in data.get("turns", []):
        if not is_real_user_turn(turn):
            continue
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
        {"tool": name, "count": n, "failed": failed.get(name, 0)}
        for name, n in total.most_common()
    ]


def metric_duration(data: dict, gap_threshold: float) -> dict | None:
    """从共享核心生成 Claude 时长分解。"""

    return summarize_claude_replay(data, gap_threshold)


# ---------------------------------------------------------------- 报告渲染


def _fmt_sec(s: float) -> str:
    """秒数 → 人读格式。"""
    return f"{s:.0f}s（{s / 60:.1f}min）"


def render_md(report: dict, source: Path) -> str:
    o = report["overview"]
    dur = report.get("duration")
    wall = (dur["wall"] or 1) if dur else 1
    L: list[str] = []
    L.append(f"# 回放分析 · {o['session_id']}")
    L.append("")
    L.append(f"来源：`{source}`")
    L.append("")
    L.append("## 概览")
    L.append("")
    L.append("| 项 | 值 |")
    L.append("| --- | --- |")
    L.append(f"| 初始诉求 | `{o['first_prompt']}` |")
    L.append(f"| 墙钟 | {o['duration_human']}（{o['duration_seconds']:.0f}s）|")
    if dur:
        L.append(
            f"| 墙钟机器执行 | 前台 {dur['foreground_exec']:.0f}s + 后台 {dur['background_exec']:.0f}s "
            f"= {_fmt_sec(dur['active'])}（占墙钟 {dur['active'] / wall:.1%}）|"
        )
        L.append(
            f"| 子代理补充 effort | {_fmt_sec(dur['subagent_duration'])}（不与墙钟相加）|"
        )
    L.append(f"| assistant 轮次 | {o['assistant_turns']} |")
    L.append(f"| 工具调用（含子代理） | {o['calls_total']}，失败 {o['calls_failed']}（{o['fail_rate']:.1%}）|")
    L.append(f"| 子代理 | {o['subagent_count']} 个，累计 {o['subagent_seconds']}s（占 {o['subagent_share']:.0%}）|")
    L.append(f"| 真实用户输入 | {o['real_user_turns']} 次（含初始诉求）|")
    L.append(f"| hook 拦截 | {o['hook_blocks']} |")
    L.append(f"| output tokens | {o['output_tokens']} |")
    L.append("")

    if dur:
        L.append("## 0. 时长分解（真实执行 vs 等待）")
        L.append("")
        L.append(
            "口径：从原始 transcript JSONL 逐事件配对 tool_use→tool_result 时间戳；"
            "配对结果按工具与 task_type 进入互斥墙钟 bucket；"
            f"无工具覆盖的相邻活动事件 gap > {dur['gap_threshold']:.0f}s 归人工闲置，"
            "其余归模型思考（启发式，非精确计时）。"
        )
        L.append("")
        L.append("| 构成 | 时长 | 占比 | 说明 |")
        L.append("| --- | --- | --- | --- |")
        rows = [
            ("机器执行 · 前台工具", dur["foreground_exec"], "非等待型主线程工具"),
            ("机器执行 · 后台任务", dur["background_exec"], "TaskOutput task_type=local_bash"),
            ("等待用户", dur["human_wait"], "AskUserQuestion 提问到回答"),
            ("等待子代理", dur["agent_wait"], "agent wait 或 TaskOutput task_type=local_agent"),
            ("未分类等待", dur["unclassified_wait"], "未知或缺失 task_type 的 TaskOutput"),
            ("模型思考/生成", dur["thinking"], f"事件间 gap ≤ {dur['gap_threshold']:.0f}s"),
            ("人工闲置", dur["boundary_idle"], f"无工具覆盖的相邻活动事件 gap > {dur['gap_threshold']:.0f}s"),
        ]
        for name, v, note in rows:
            L.append(f"| {name} | {_fmt_sec(v)} | {v / wall:.1%} | {note} |")
        L.append(
            f"| **墙钟机器执行合计** | **{_fmt_sec(dur['active'])}** | **{dur['active'] / wall:.1%}** "
            "| 前台 + 后台 |"
        )
        L.append(
            f"| 补充 effort · 子代理 | {_fmt_sec(dur['subagent_duration'])} | - "
            "| subagents[].duration_seconds 累计，不与墙钟相加 |"
        )
        if dur.get("closure_gap") is not None:
            L.append(
                f"| 闭合差 | {_fmt_sec(dur['closure_gap'])} | - "
                "| 墙钟 − 以上合计（启发式口径允许舍入差） |"
            )
        L.append("")

    L.append("## 1. 重复命令（轮询 / 试错信号）")
    L.append("")
    if report["repeats"]:
        L.append("| 次数 | scope | 命令 |")
        L.append("| --- | --- | --- |")
        for r in report["repeats"]:
            cmd = display_command(r["command"]).replace("|", "\\|")
            L.append(f"| {r['count']} | {r['scope']} | `{cmd}` |")
    else:
        L.append("无（未达阈值）")
    L.append("")

    L.append("## 2. 失败聚类（同类错误已合并）")
    L.append("")
    fail = report["failures"]
    if fail["clusters"]:
        L.append("| 次数 | 工具 | 错误签名 | 出现于 |")
        L.append("| --- | --- | --- | --- |")
        for c in fail["clusters"]:
            sig = c["signature"].replace("|", "\\|")
            L.append(f"| {c['count']} | {c['tool']} | {sig} | {', '.join(c['scopes'])} |")
        L.append("")
        L.append("样本入参：")
        L.append("")
        for c in fail["clusters"][:8]:
            L.append(f"- `{c['tool']}` @ {c['first_ts']} → `{c['sample_input']}`")
    else:
        L.append("无失败调用")
    L.append("")

    L.append("## 3. 子代理健康度")
    L.append("")
    if report["subagents"]:
        L.append("| 类型 | 耗时(s) | 调用 | 失败 | 标记 | 任务 |")
        L.append("| --- | --- | --- | --- | --- | --- |")
        for s in report["subagents"]:
            flags = "、".join(s["flags"]) or "-"
            L.append(
                f"| {s['agent_type']} | {s['duration_seconds']} | {s['calls']} | "
                f"{s['failed']} | {flags} | {s['description']} |"
            )
    else:
        L.append("无子代理")
    L.append("")

    L.append("## 4. 文件返工")
    L.append("")
    if report["rework"]:
        for r in report["rework"]:
            L.append(f"- ×{r['count']} `{r['file']}`")
    else:
        L.append("无（未达阈值）")
    L.append("")

    L.append("## 5. 用户输入点（初始诉求 + 中途干预）")
    L.append("")
    if report["interventions"]:
        for r in report["interventions"]:
            L.append(f"- [{r['ts']}] {r['text']}")
    else:
        L.append("无")
    L.append("")

    L.append("## 6. 工具分布")
    L.append("")
    L.append("| 工具 | 次数 | 失败 |")
    L.append("| --- | --- | --- |")
    for r in report["tool_mix"]:
        L.append(f"| {r['tool']} | {r['count']} | {r['failed']} |")
    L.append("")

    L.append("---")
    L.append("")
    L.append("以上为第 1 层确定性指标。请继续按 `modules/analyze.md`：")
    L.append("第 2 层把每个可疑点归因到「契约缺失 / 外部不稳定 / 流程设计缺陷 / 一次性失误」，")
    L.append("第 3 层仅对 P0/P1 回 replay.md 时间线取证。")
    return "\n".join(L)


# ---------------------------------------------------------------- 入口


def main() -> int:
    parser = argparse.ArgumentParser(
        description="对 replay.json 做第一层确定性统计，输出可归因的复盘指标报告"
    )
    parser.add_argument(
        "target",
        nargs="?",
        help="replay.json 路径或其所在目录；留空取 projects/replay 下最新一次导出",
    )
    parser.add_argument("--format", choices=["md", "json"], default="md")
    parser.add_argument(
        "--out",
        help="指定输出文件；默认写入回放目录下的 metrics.md / metrics.json",
    )
    parser.add_argument("--no-save", action="store_true", help="只打印到 stdout，不落盘")
    parser.add_argument("--repeat-threshold", type=int, default=2, help="重复命令阈值，默认 2")
    parser.add_argument("--rework-threshold", type=int, default=3, help="文件返工阈值，默认 3")
    parser.add_argument("--top", type=int, default=25, help="重复命令最多展示条数，默认 25")
    parser.add_argument(
        "--gap-threshold",
        type=float,
        default=60.0,
        help="时长分解中事件间 gap 超过该秒数归为人工闲置，默认 60",
    )
    args = parser.parse_args()

    data, source = load_replay(args.target)
    calls = list(iter_calls(data, "MAIN"))
    duration = metric_duration(data, args.gap_threshold)

    report = {
        "source": str(source),
        "overview": metric_overview(
            data, calls, duration["wall"] if duration else None
        ),
        "duration": duration,
        "repeats": metric_repeats(calls, args.repeat_threshold)[: args.top],
        "failures": metric_failures(calls),
        "subagents": metric_subagents(data),
        "rework": metric_rework(data, args.rework_threshold),
        "interventions": metric_interventions(data),
        "tool_mix": metric_tool_mix(calls),
    }

    if args.format == "json":
        text = json.dumps(report, ensure_ascii=False, indent=2)
    else:
        text = render_md(report, source)

    # 指标报告始终打印（LLM 要接着做第 2 层归因），同时默认在回放目录留档
    print(text)

    if args.no_save:
        return 0
    out = Path(args.out) if args.out else source.parent / f"metrics.{args.format}"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    print(f"\n> 指标报告已留档：{out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
