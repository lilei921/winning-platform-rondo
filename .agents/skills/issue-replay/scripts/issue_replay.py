#!/usr/bin/env python3
"""只读采集 Multica Issue，复用 session-replay 生成任务级回放。"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
SHARED = Path(__file__).resolve().parents[2] / "session-replay/scripts"
sys.path.insert(0, str(SHARED))
import claude_session
from codex_session import SessionSource, build_replay, default_codex_home, discover_sessions
from output_path import allocate_replay_dir
from replay_verify import source_fingerprints, verify_replay
from session_export import render_markdown
from session_timeline import build_timeline_md

BEIJING = timezone(timedelta(hours=8))
TERMINAL = {"completed", "failed", "cancelled", "canceled"}


def now() -> str:
    """任务日期采用北京时间，不受宿主时区影响。"""
    return datetime.now(BEIJING).isoformat(timespec="seconds")


def write_text(path: Path, text: str) -> None:
    """UTF-8/LF 原子写入，保留其他产物。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = text.replace("\r\n", "\n")
    if path.suffix == ".md":
        text = "\n".join(line.rstrip() for line in text.splitlines()).rstrip() + "\n"
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(text.encode("utf-8"))
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def write_json(path: Path, data) -> None:
    """结构化证据与 Markdown 共用编码约定。"""
    write_text(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def safe_key(value, label: str) -> str:
    """平台标识进入路径或 CLI 参数前拒绝路径穿越与选项注入。"""
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", value):
        raise ValueError(f"无效的 {label}")
    return value


class MulticaClient:
    """Desktop 与 CLI 使用同一组只读命令；不改变当前配置。"""
    def __init__(self, cli: str, profile: str | None, workspace_id: str, server_url: str | None = None):
        # profile 缺省时沿用 CLI 当前配置，不自动登录或改写配置。
        self.command = [cli]
        if profile:
            self.command += ["--profile", profile]
        self.command += ["--workspace-id", workspace_id]
        if server_url:
            self.command += ["--server-url", server_url]
        self.commands = []
        self.workspace_id = workspace_id

    def read(self, action: str, target: str, *, resource: str = "issue", extra=()):
        if (resource, action) not in {("issue", "get"), ("issue", "runs"), ("agent", "get"),
                                      ("autopilot", "get"), ("autopilot", "runs")}:
            raise ValueError("仅允许读取 Issue、Autopilot、Run 和 Agent 身份")
        safe_key(target, resource)
        command = [*self.command, resource, action, target, *extra, "--output", "json"]
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", timeout=60)
        if result.returncode:
            raise RuntimeError(f"multica {resource} {action} 失败：{result.stderr.strip()[:500]}")
        self.commands.append(command)
        try:
            return json.loads(result.stdout.lstrip("\ufeff"))
        except ValueError as error:
            raise ValueError(f"multica {resource} {action} 未返回有效 JSON") from error


    def read_agents(self, runs: list[dict]) -> tuple[list[dict], list[str]]:
        """仅保留本次 Agent 的 ID、名称；配置、指令、环境变量不落盘。"""
        agents, warnings = [], []
        for agent_id in sorted({run.get("agent_id") for run in runs if run.get("agent_id")}):
            safe_key(agent_id, "Agent")
            name = None
            try:
                data = self.read("get", agent_id, resource="agent")
                if not isinstance(data, dict) or data.get("id") != agent_id or data.get("workspace_id") != self.workspace_id:
                    raise ValueError("Agent 身份不匹配")
                if not isinstance(data.get("name"), str) or not data["name"].strip():
                    raise ValueError("Agent 名称缺失")
                name = data["name"].strip()
            except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
                warnings.append(f"Agent {agent_id} 名称不可用（{type(error).__name__}），使用 ID 标签")
            agents.append({"id": agent_id, "name": name})
        return agents, warnings


def find_sources(runs: list[dict], codex_homes) -> dict[str, SessionSource]:
    """优先从实际工作目录定位；显式 home 和当前用户 home 补充 CLI 布局。"""
    homes = {Path(home).expanduser().resolve() for home in codex_homes}
    homes.add(default_codex_home().resolve())
    for run in runs:
        result = run.get("result") or {}
        for work_dir in (result.get("work_dir"), run.get("work_dir")):
            if work_dir:
                homes.add((Path(work_dir).parent / "codex-home").resolve())
    grouped = defaultdict(list)
    requested = {(run.get("result") or {}).get("session_id") for run in runs}
    for home in sorted(homes):
        for source in discover_sessions(codex_home=home):
            if source.session_id in requested:
                grouped[source.session_id].append(source)
    sources = {}
    for session_id, matches in grouped.items():
        # 恢复运行可能在不同 home 留下 continuation，不能只取最新文件。
        sources[session_id] = SessionSource(
            session_id, matches[0].cwd,
            tuple(sorted({p for source in matches for p in source.files})),
            tuple(sorted({p for source in matches for p in source.subagent_files})),
            matches[0].started_at, max(source.latest_mtime for source in matches),
        )
    return sources


def find_claude_sources(runs: list[dict], homes):
    """支持默认 Claude 配置目录、显式 home 和 Multica 隔离运行目录。"""
    candidates = list(homes)
    for run in runs:
        for work_dir in ((run.get("result") or {}).get("work_dir"), run.get("work_dir")):
            if work_dir:
                candidates.extend([Path(work_dir).parent / "claude-home", Path(work_dir) / ".claude"])
    ids = {(run.get("result") or {}).get("session_id") for run in runs}
    return claude_session.discover_sources([sid for sid in ids if sid], candidates)


def select_source(session_id, runs, codex_sources, claude_sources):
    """优先使用 Run 的 provider 证据；证据缺失且来源歧义时不猜测。"""
    declared = {entry.get("provider") for run in runs for entry in run.get("usage", []) if entry.get("provider")}
    declared.update((run.get("result") or {}).get("provider") for run in runs if (run.get("result") or {}).get("provider"))
    sources = {key: value for key, value in {
        "codex": codex_sources.get(session_id), "claude": claude_sources.get(session_id)}.items() if value is not None}
    if declared:
        if len(declared) != 1 or not declared <= {"codex", "claude"}:
            raise ValueError(f"provider 不支持或冲突：{sorted(declared)}")
        provider = next(iter(declared))
        if provider not in sources:
            raise ValueError(f"未找到声明的 {provider} 日志，可补充 --{provider}-home")
        return provider, sources[provider]
    if len(sources) != 1:
        raise ValueError("未找到唯一的本地会话来源，可补充 --codex-home / --claude-home 并核对 Run provider")
    return next(iter(sources.items()))


def match_claude_runs(runs, source):
    """以公开请求、终态文本和平台执行窗口关联 Run，不伪造 Codex 任务边界。"""
    candidates = claude_session.completion_candidates(source)
    assignments, used = {}, set()
    for run in sorted(runs, key=chronological):
        assignments[run["id"]] = []
        start = claude_session.exporter().parse_ts(run.get("started_at"))
        end = claude_session.exporter().parse_ts(run.get("completed_at"))
        if not start or not end or not start.tzinfo or not end.tzinfo:
            continue
        output = " ".join(str((run.get("result") or {}).get("output") or "").split())
        matches = []
        for candidate in candidates:
            a = claude_session.exporter().parse_ts(candidate["started_at"])
            b = claude_session.exporter().parse_ts(candidate["completed_at"])
            # 平台 started_at 登记可能晚于首条请求；仅允许 5 秒时钟/登记偏差。
            if not a or not b or not a.tzinfo or not b.tzinfo or not (start - timedelta(seconds=5) <= a <= b <= end and start <= b):
                continue
            if ((" ".join(candidate["text"].split()) == output) if output else candidate["end_turn"]):
                matches.append(candidate)
        if len(matches) == 1 and matches[0]["request_id"] not in used:
            candidate = matches[0]
            used.add(candidate["request_id"])
            assignments[run["id"]].append({key: candidate[key] for key in ("started_at", "completed_at", "message_id")})
            assignments[run["id"]][-1]["matched_by"] = "platform_final_output" if output else "native_end_turn"
    return {"method": "claude_public_request_and_completion", "run_intervals": assignments,
            "uncovered_run_ids": [key for key, value in assignments.items() if not value],
            "complete": bool(runs) and all(assignments.values())}


def match_run_boundaries(runs: list[dict], boundaries: list[dict]) -> dict:
    """用独立执行区间证明每个 Run 有日志，不因 session ID 相同就推定全部覆盖。"""
    def parse(value):
        try:
            stamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return stamp if stamp.tzinfo is not None else None
        except ValueError:
            return None

    intervals = []
    pending = None
    malformed = False
    for boundary in boundaries:
        stamp = parse(boundary.get("timestamp"))
        if stamp is None:
            malformed = True
            continue
        if boundary["type"] == "task_started":
            malformed |= pending is not None
            pending = stamp
        elif boundary["type"] == "task_complete":
            if pending is None or stamp < pending:
                malformed = True
            else:
                intervals.append((pending, stamp))
            pending = None
    windows = {run["id"]: (parse(run.get("started_at")), parse(run.get("completed_at"))) for run in runs}
    assignments = {run["id"]: [] for run in runs}
    ambiguous = []
    for start, end in intervals:
        candidates = [key for key, (a, b) in windows.items()
                      if a is not None and b is not None and a <= b and max(a, start) <= min(b, end)]
        if len(candidates) == 1:
            assignments[candidates[0]].append({"started_at": start.isoformat(), "completed_at": end.isoformat()})
        else:
            ambiguous.append({"started_at": start.isoformat(), "completed_at": end.isoformat(), "run_ids": candidates})
    return {"complete": bool(runs) and all(assignments.values()) and not ambiguous and not malformed and pending is None,
            "run_intervals": assignments, "uncovered_run_ids": [key for key, value in assignments.items() if not value],
            "ambiguous_intervals": ambiguous, "invalid_boundaries": malformed, "open_task": pending is not None}


def cell(value) -> str:
    """平台文字进入表格时保持单行，避免破坏索引布局。"""
    return " ".join(str(value or "-").split()).replace("|", "\\|")


def agent_directories(agents: list[dict], previous: dict) -> dict[str, str]:
    """目录名可读但身份由 ID 约束；既有映射固定，重名时扩展 ID 后缀。"""
    reserved = {"sessions", "evidence", "shared", "agent-unknown", "con", "prn", "aux", "nul",
                *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}
    groups = dict(previous)
    for agent_id, value in groups.items():
        safe_key(agent_id, "Agent")
        if not isinstance(value, str) or not re.fullmatch(r"[\w-]+", value) or value.lower() in reserved:
            raise ValueError("Agent 目录映射无效")
    if len({value.casefold() for value in groups.values()}) != len(groups):
        raise ValueError("Agent 目录映射重复")
    slugs = {}
    for agent in agents:
        agent_id = safe_key(agent["id"], "Agent")
        name = re.sub(r"[\s_-]+agent$", "", (agent.get("name") or "").strip(), flags=re.I)
        slugs[agent_id] = re.sub(r"[^\w]+", "-", name.lower()).strip("-_")[:60] or f"agent-{agent_id[:8]}"
    used = {value.casefold() for value in groups.values()}
    for agent_id, base in sorted(slugs.items()):
        if agent_id in groups:
            continue
        candidate = base
        if base in reserved or list(slugs.values()).count(base) > 1 or base.casefold() in used:
            candidate = f"{base}-{agent_id[:8]}"
        suffix = 2
        while candidate.casefold() in used:
            candidate = f"{base}-{agent_id[:8]}-{suffix}"
            suffix += 1
        groups[agent_id] = candidate
        used.add(candidate.casefold())
    return groups


def contained_session_dir(directory: Path, relative: str) -> Path:
    """迁移前验证源、目标均为本 Issue 下的两级目录，拒绝越界或链接跳转。"""
    value = Path(relative)
    if value.is_absolute() or len(value.parts) != 2 or any(part in {".", ".."} for part in value.parts):
        raise ValueError("会话目录路径无效")
    if value.parts[0].lower() == "evidence":
        raise ValueError("会话目录不能位于 evidence")
    path = directory / value
    resolved = path.resolve()
    if not resolved.is_relative_to(directory.resolve()) or path.is_symlink() or path.parent.is_symlink():
        raise ValueError("会话目录越界或包含符号链接")
    return resolved


def migrate_session_directories(directory: Path, index: dict, groups: dict[str, str]) -> None:
    """先校验全部迁移，再移动完整目录；每次移动后持久化路径以支持中断重试。"""
    moves = []
    planned_targets = set()
    for session_id, relative in list(index["session_directories"].items()):
        source = contained_session_dir(directory, relative)
        if not source.exists():
            index["session_directories"].pop(session_id)
            continue
        metadata = json.loads((source / "replay.json").read_text(encoding="utf-8"))
        if metadata.get("session_id") != session_id:
            raise ValueError("会话目录身份不匹配")
        if session_id not in groups:
            continue
        target = contained_session_dir(directory, f"{groups[session_id]}/{source.name}")
        if source == target:
            continue
        if target.exists():
            raise ValueError(f"目标会话目录已存在，不覆盖：{target}")
        # 不同 Agent 下的会话可能同分钟、同 ID 前缀；合并分组时也需消歧。
        suffix = 2
        while target in planned_targets:
            target = contained_session_dir(directory, f"{groups[session_id]}/{source.name}-{suffix}")
            suffix += 1
            if target.exists():
                raise ValueError(f"目标会话目录已存在，不覆盖：{target}")
        planned_targets.add(target)
        moves.append((session_id, source, target))
    for session_id, source, target in moves:
        target.parent.mkdir(parents=True, exist_ok=True)
        source.rename(target)
        index["session_directories"][session_id] = target.relative_to(directory).as_posix()
        write_json(directory / "issue-replay.json", index)
        # 只清理迁移后为空的分组目录，不删除未登记文件。
        if not any(source.parent.iterdir()):
            source.parent.rmdir()


def beijing_time(value) -> str:
    """表格统一使用北京时间；原始时间继续保留在证据 JSON。"""
    try:
        stamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return stamp.astimezone(BEIJING).strftime("%Y-%m-%d %H:%M:%S") if stamp.tzinfo else cell(value)
    except ValueError:
        return cell(value)


def agent_label(agent_id, agents: list[dict]) -> str:
    """名称不可用不影响事件覆盖，回退到稳定 ID 标签。"""
    return next((agent["name"] for agent in agents if agent["id"] == agent_id and agent.get("name")),
                f"agent-{agent_id[:8]}" if agent_id else "未知 Agent")


def chronological(run: dict):
    """按实际开始时间排序，缺少时间的记录置后。"""
    try:
        stamp = datetime.fromisoformat(str(run.get("started_at")).replace("Z", "+00:00"))
        return stamp.timestamp() if stamp.tzinfo else float("inf")
    except ValueError:
        return float("inf")


def render_index(issue: dict, runs: list[dict], index: dict) -> str:
    """只汇总可追溯事实，不把平台完成消息作为重新验证的结论。"""
    lines = [f"# {issue['identifier']} 回放记录", "",
             f"- 任务：{cell(issue.get('title'))}",
             f"- 采集时间：{index['collected_at']}；平台状态快照：`{issue.get('status', '-')}`。",
             f"- Profile：`{index['profile']}`；Workspace：`{index['workspace_id']}`。",
             f"- 覆盖：**{index['coverage']}**；{len(runs)} 次 Run，{len(index['sessions'])} 个已导出 session，"
             f"主会话 {index['tool_calls_total']} 次工具调用，子代理 {index['subagent_tool_calls_total']} 次。", "",
             "## 会话入口", "", "| Agent / Provider | 执行时间（北京时间） | Run 数 | 工具调用 | 回放 | 时间线 | 核验 |",
             "| --- | --- | ---: | ---: | --- | --- | --- |"]
    for entry in index["sessions"]:
        replay = entry["replay"]
        names = " / ".join(agent_label(agent_id, index["agents"]) for agent_id in entry["agent_ids"]) or "未知 Agent"
        lines.append(f"| {cell(names)} / {entry['provider']} | {beijing_time(entry['started_at'])} — {beijing_time(entry['completed_at'])} | "
                     f"{len(entry['run_ids'])} | {entry['tool_calls_total']} | "
                     f"[回放]({Path(replay).with_suffix('.md').as_posix()}) | "
                     f"[时间线]({entry['timeline']}) | {entry['verification']} |")
    lines += ["", "## Run 与 session 对应", "", "| Agent | Run | session | 状态 | 开始 / 结束（北京时间） |",
              "| --- | --- | --- | --- | --- |"]
    for run in sorted(runs, key=chronological):
        lines.append(f"| {cell(agent_label(run.get('agent_id'), index['agents']))} | `{run['id']}` | "
                     f"`{(run.get('result') or {}).get('session_id', '-')}` | {cell(run.get('status'))} | "
                     f"{beijing_time(run.get('started_at'))} / {beijing_time(run.get('completed_at'))} |")
    lines += ["", "## 平台完成消息", ""]
    for run in sorted(runs, key=chronological):
        lines.append(f"- **{cell(agent_label(run.get('agent_id'), index['agents']))}**（`{run['id']}`）："
                     f"{cell((run.get('result') or {}).get('output'))}")
    if index["agent_warnings"]:
        lines += ["", "## Agent 名称提示", "", *[f"- {cell(w)}" for w in index["agent_warnings"]]]
    lines += ["", "## 覆盖缺口", ""]
    lines += [f"- {cell(gap)}" for gap in index["gaps"]] or ["- 无。"]
    # Autopilot 复用本导出器时，证据文件与措辞随主体切换，不称为 Issue。
    subject = "Autopilot" if issue.get("subject_type") == "autopilot" else "Issue"
    lines += ["", "## 证据与边界", "",
              f"- [任务索引](issue-replay.json)、[{subject} 快照](evidence/{subject.lower()}.json)、"
              "[Run 快照](evidence/runs.json)、[Agent 名称快照](evidence/agents.json)、[来源与核验](evidence/source-manifest.json)。",
              "- 完成消息来自平台历史记录，本次未重新执行业务测试；Run 完成不等于 Issue 已合并、部署或验收。",
              "- Codex 按 item_completed、Claude 按公开消息与 tool_use/tool_result 核验；编排外壳和注入上下文不重复计数。默认截断长文本，FileChange 补丁等受共享导出器限制，非原始日志逐字副本。",
              "- 不导出隐藏推理；hook 审计可用性以各 session 回放为准。运行中的 Run 仅记录采集时快照。",
              "- 本命令只读平台与原始日志，仅写本回放目录；没有提交、推送或修改 Issue。", ""]
    return "\n".join(lines)


def export_issue(issue: dict, runs: list[dict], *, output_root: Path, profile: str,
                 server_url: str | None = None, codex_homes=(), claude_homes=(), collected_at: str | None = None,
                 commands=(), full: bool = False, agents=None, agent_warnings=()) -> tuple[Path, dict]:
    """映射、导出、核验一个 Issue；缺失证据可留档，但结果必须为 partial。"""
    if not isinstance(issue, dict) or not isinstance(runs, list):
        raise ValueError("Issue/Run JSON 形状无效，不能确认完整执行历史")
    for key in ("id", "identifier", "workspace_id"):
        safe_key(issue.get(key), key)
    seen = set()
    for run in runs:
        if not isinstance(run, dict) or run.get("issue_id") != issue["id"]:
            raise ValueError("Run 不属于目标 Issue")
        if run.get("workspace_id") != issue["workspace_id"]:
            raise ValueError("Run Workspace 身份不匹配")
        safe_key(run.get("id"), "Run")
        if run["id"] in seen:
            raise ValueError("Run ID 重复，不能确认平台列表完整性")
        seen.add(run["id"])
    collected_at = collected_at or now()
    date = datetime.fromisoformat(collected_at).astimezone(BEIJING).strftime("%Y%m%d")
    directory = output_root.resolve() / f"{date}-{issue['identifier']}"
    index_path = directory / "issue-replay.json"
    identity = {"profile": profile, "server_url": server_url,
                "workspace_id": issue["workspace_id"], "issue_id": issue["id"]}
    old = {}
    if index_path.exists():
        old = json.loads(index_path.read_text(encoding="utf-8"))
        if any(old.get(key) != value for key, value in identity.items()):
            raise ValueError(f"回放目录身份冲突：{directory}；请使用不同 --out-root")
    elif directory.exists() and any(directory.iterdir()):
        raise ValueError(f"回放目录缺少身份索引，不覆盖：{directory}")
    agent_ids = sorted({run.get("agent_id") for run in runs if run.get("agent_id")})
    for agent_id in agent_ids:
        safe_key(agent_id, "Agent")
    supplied = {agent["id"]: agent.get("name") for agent in (agents if agents is not None else old.get("agents", []))}
    agents = [{"id": agent_id, "name": supplied.get(agent_id) if isinstance(supplied.get(agent_id), str) else None}
              for agent_id in agent_ids]
    directories = agent_directories(agents, old.get("agent_directories", {}))
    session_dirs = dict(old.get("session_directories", {}))
    for entry in old.get("sessions", []):
        session_dirs.setdefault(entry["session_id"], Path(entry["replay"]).parent.as_posix())
    for relative in session_dirs.values():
        contained_session_dir(directory, relative)
    index = {"schema": "multica-issue-replay/v2", **identity, "identifier": issue["identifier"],
             "collected_at": collected_at, "coverage": "partial", "sessions": [],
             "agents": agents, "agent_warnings": list(agent_warnings), "agent_directories": directories,
             "session_directories": session_dirs,
             "run_count": len(runs), "active_run_count": 0,
             "tool_calls_total": 0, "subagent_tool_calls_total": 0, "gaps": ["导出尚未完成"]}
    write_json(index_path, index)
    write_json(directory / f"evidence/{'autopilot' if issue.get('subject_type') == 'autopilot' else 'issue'}.json", issue)
    write_json(directory / "evidence/runs.json", runs)
    write_json(directory / "evidence/agents.json", {"collected_at": collected_at, "agents": agents, "warnings": list(agent_warnings)})
    manifest = {"collected_at": collected_at, **identity, "read_only_commands": list(commands), "sessions": []}
    index["gaps"] = []
    grouped = defaultdict(list)
    for run in sorted(runs, key=chronological):
        if run.get("status") not in TERMINAL:
            index["active_run_count"] += 1
            index["gaps"].append(f"Run {run['id']} 尚未终止或状态未知：{run.get('status')}")
        session_id = (run.get("result") or {}).get("session_id")
        if not session_id:
            index["gaps"].append(f"Run {run['id']} 没有 session_id")
        else:
            grouped[safe_key(session_id, "session")].append(run["id"])
    session_agents = {sid: sorted({run.get("agent_id") for run in runs
                                  if run["id"] in run_ids and run.get("agent_id")}) for sid, run_ids in grouped.items()}
    session_groups = {sid: directories[ids[0]] if len(ids) == 1 else "shared" if ids else "agent-unknown"
                      for sid, ids in session_agents.items()}
    migrate_session_directories(directory, index, session_groups)
    write_json(index_path, index)
    sources = find_sources(runs, codex_homes)
    claude_sources = find_claude_sources(runs, claude_homes)
    for session_id, run_ids in grouped.items():
        session_runs = [run for run in runs if run["id"] in run_ids]
        try:
            provider, source = select_source(session_id, session_runs, sources, claude_sources)
            existing = index["session_directories"].get(session_id)
            if existing:
                metadata = json.loads((contained_session_dir(directory, existing) / "replay.json").read_text(encoding="utf-8"))
                if metadata.get("provider") != provider:
                    raise ValueError("已有回放 provider 不一致，不覆盖")
            before = source_fingerprints((*source.files, *source.subagent_files))
            if provider == "claude":
                replay = claude_session.build_replay(source, full=full)
                verification = claude_session.verify_replay(source, replay, full=full)
                run_coverage = match_claude_runs(session_runs, source)
                markdown = claude_session.render_markdown(replay, full=full)
            else:
                replay = build_replay(source, max_tool_chars=0 if full else 800, max_user_chars=0 if full else 4000)
                verification = verify_replay(source, replay, max_user_chars=0 if full else 4000)
                run_coverage = match_run_boundaries(session_runs, verification["task_boundaries"])
                markdown = render_markdown(replay)
            verification["provider"] = provider
            after = source_fingerprints((*source.files, *source.subagent_files))
            verification["sources"] = before
            if before != after:
                verification["sources_after"] = after
            verification["run_coverage"] = run_coverage
            verification["sources_stable"] = before == after
            verification["complete"] = verification["complete"] and before == after and verification["run_coverage"]["complete"]
            relative = index["session_directories"].get(session_id)
            if relative:
                out = contained_session_dir(directory, relative)
            else:
                group = session_groups[session_id]
                contained_session_dir(directory, f"{group}/check")
                out = allocate_replay_dir(directory / group, replay["started_at"], session_id)
                index["session_directories"][session_id] = out.relative_to(directory).as_posix()
            write_json(index_path, index)
            write_json(out / "replay.json", replay)
            write_text(out / "replay.md", markdown)
            timeline, total, _ = build_timeline_md(replay, out / "replay.json", {})
            write_text(out / "timeline.md", timeline)
        except (OSError, ValueError, KeyError, TypeError) as error:
            index["gaps"].append(f"session {session_id} 导出失败：{error}")
            continue
        manifest["sessions"].append(verification)
        session_runs = sorted([run for run in runs if run["id"] in run_ids], key=chronological)
        entry = {"session_id": session_id, "provider": provider, "run_ids": run_ids, "agent_ids": session_agents[session_id],
                 "started_at": session_runs[0].get("started_at"),
                 "completed_at": session_runs[-1].get("completed_at"),
                 "tool_calls_total": replay["stats"]["tool_calls_total"],
                 "replay": (out / "replay.json").relative_to(directory).as_posix(),
                 "timeline": (out / "timeline.md").relative_to(directory).as_posix(),
                 "verification": "PASS" if verification["complete"] else "PARTIAL"}
        index["sessions"].append(entry)
        main_count = replay["stats"]["tool_calls_total"]
        index["tool_calls_total"] += main_count
        index["subagent_tool_calls_total"] += total - main_count
        if not verification["complete"]:
            index["gaps"].append(f"session {session_id} 完整性核验未通过，详见 source-manifest.json")
    index["coverage"] = "complete" if not index["gaps"] else "partial"
    manifest["coverage"] = index["coverage"]
    manifest["verified_at"] = now()
    write_json(directory / "evidence/source-manifest.json", manifest)
    write_text(directory / "replay.md", render_index(issue, runs, index))
    write_json(index_path, index)
    return directory, index


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("issue", help="Issue 编号或完整 UUID")
    parser.add_argument("--profile", required=True, help="Multica Desktop 或 CLI 的已配置 profile")
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--server-url", default=os.environ.get("MULTICA_SERVER_URL"))
    parser.add_argument("--cli", default=os.environ.get("MULTICA_CLI_PATH", "multica"))
    parser.add_argument("--codex-home", type=Path, action="append", default=[], help="补充日志目录，可重复")
    parser.add_argument("--claude-home", type=Path, action="append", default=[], help="补充 Claude 配置目录（含 projects），可重复")
    parser.add_argument("--out-root", type=Path, default=ROOT / "projects/replay")
    parser.add_argument("--full", action="store_true", help="不截断公开消息和工具结果文本")
    args = parser.parse_args()
    try:
        client = MulticaClient(args.cli, args.profile, args.workspace_id, args.server_url)
        collected_at = now()
        issue = client.read("get", args.issue)
        if not isinstance(issue, dict) or issue.get("workspace_id") != args.workspace_id:
            raise ValueError("返回 Issue 的 Workspace 身份不匹配")
        if args.issue not in {issue.get("id"), issue.get("identifier")}:
            raise ValueError("返回 Issue 与请求不符")
        runs = client.read("runs", issue["id"])
        if not isinstance(runs, list) or not all(isinstance(run, dict) for run in runs):
            raise ValueError("Run JSON 形状无效")
        agents, agent_warnings = client.read_agents(runs)
        directory, index = export_issue(
            issue, runs, output_root=args.out_root, profile=args.profile, server_url=args.server_url,
            codex_homes=args.codex_home, claude_homes=args.claude_home, collected_at=collected_at, commands=client.commands, full=args.full,
            agents=agents, agent_warnings=agent_warnings)
        print(json.dumps({"directory": str(directory), "coverage": index["coverage"],
                          "runs": len(runs), "sessions": len(index["sessions"]),
                          "tools": index["tool_calls_total"], "gaps": index["gaps"], "agent_warnings": index["agent_warnings"]}, ensure_ascii=False))
        return 0 if index["coverage"] == "complete" else 2
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    raise SystemExit(main())
