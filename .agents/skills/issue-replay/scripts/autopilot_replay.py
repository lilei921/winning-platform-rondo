#!/usr/bin/env python3
"""只读采集 Multica Autopilot 的最近 Run，复用 issue-replay 的导出与完整性核验。

Autopilot Run 没有 Issue 关联，这里仅补齐导出器需要的字段（issue_id/workspace_id/agent_id/started_at），
原始平台字段全部保留；执行窗口口径为 triggered_at → completed_at。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import issue_replay as ir


def identifier_for(autopilot: dict, runs: list[dict]) -> str:
    """目录标识只保留安全字符；单次 Run 附带 ID 前缀，避免与多次合并回放互相覆盖。"""
    base = re.sub(r"[^A-Za-z0-9_-]+", "-", str(autopilot.get("title") or "").strip()).strip("-")[:60]
    base = base or f"autopilot-{autopilot['id'][:8]}"
    return f"{base}-run-{runs[0]['id'][:8]}" if len(runs) == 1 else base


def normalize_run(run: dict, autopilot: dict) -> dict:
    """保留原始字段，仅补充导出器所需的 Issue 形态字段。"""
    if run.get("autopilot_id") != autopilot["id"]:
        raise ValueError("Run 不属于目标 Autopilot")
    ir.safe_key(run.get("id"), "Run")
    agent_id = autopilot.get("assignee_id") if autopilot.get("assignee_type") == "agent" else None
    return {**run, "issue_id": autopilot["id"], "workspace_id": autopilot["workspace_id"],
            "agent_id": agent_id, "started_at": run.get("triggered_at") or run.get("created_at")}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("autopilot", help="Autopilot 完整 UUID")
    parser.add_argument("--profile", help="Multica CLI profile；缺省沿用 CLI 当前配置")
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--last", type=int, default=1, help="采集最近 N 次 Run，默认 1")
    parser.add_argument("--server-url", default=os.environ.get("MULTICA_SERVER_URL"))
    parser.add_argument("--cli", default=os.environ.get("MULTICA_CLI_PATH", "multica"))
    parser.add_argument("--codex-home", type=Path, action="append", default=[], help="补充日志目录，可重复")
    parser.add_argument("--claude-home", type=Path, action="append", default=[], help="补充 Claude 配置目录（含 projects），可重复")
    parser.add_argument("--out-root", type=Path, default=ir.ROOT / "projects/replay")
    parser.add_argument("--full", action="store_true", help="不截断公开消息和工具结果文本")
    args = parser.parse_args()
    if args.last < 1:
        parser.error("--last 必须为正整数")
    try:
        client = ir.MulticaClient(args.cli, args.profile, args.workspace_id, args.server_url)
        # get 返回 {autopilot, collaborators, triggers}；只保留 Autopilot 本体，不落盘触发器凭证。
        payload = client.read("get", args.autopilot, resource="autopilot")
        autopilot = payload.get("autopilot") if isinstance(payload, dict) else None
        if not isinstance(autopilot, dict) or autopilot.get("id") != args.autopilot \
                or autopilot.get("workspace_id") != args.workspace_id:
            raise ValueError("返回 Autopilot 与请求的 ID/Workspace 不匹配")
        payload = client.read("runs", autopilot["id"], resource="autopilot", extra=("--limit", str(args.last)))
        runs = payload.get("runs") if isinstance(payload, dict) else None
        if not isinstance(runs, list) or not runs or not all(isinstance(run, dict) for run in runs):
            raise ValueError("Run JSON 形状无效或该 Autopilot 没有执行记录")
        # 平台按最新在前返回；只取请求的最近 N 次。
        runs = [normalize_run(run, autopilot) for run in runs[:args.last]]
        agents, agent_warnings = client.read_agents(runs)
        issue_view = {**autopilot, "identifier": identifier_for(autopilot, runs), "subject_type": "autopilot"}
        directory, index = ir.export_issue(
            issue_view, runs, output_root=args.out_root, profile=args.profile or "cli-default",
            server_url=args.server_url, codex_homes=args.codex_home, claude_homes=args.claude_home,
            collected_at=ir.now(), commands=client.commands, full=args.full,
            agents=agents, agent_warnings=agent_warnings)
        # 补充窗口口径与采集范围，不改变导出器已有结论；Autopilot 快照由导出器写入 evidence/autopilot.json。
        manifest_path = directory / "evidence/source-manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest.update({"subject_type": "autopilot", "autopilot_id": autopilot["id"],
                         "run_window_basis": "triggered_at → completed_at", "requested_last": args.last})
        ir.write_json(manifest_path, manifest)
        index.update({"subject_type": "autopilot", "autopilot_id": autopilot["id"], "title": autopilot.get("title")})
        ir.write_json(directory / "issue-replay.json", index)
        print(json.dumps({"directory": str(directory), "coverage": index["coverage"],
                          "runs": len(runs), "sessions": len(index["sessions"]),
                          "tools": index["tool_calls_total"], "gaps": index["gaps"],
                          "agent_warnings": index["agent_warnings"]}, ensure_ascii=False))
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
