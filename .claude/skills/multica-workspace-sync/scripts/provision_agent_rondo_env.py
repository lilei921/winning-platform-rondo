#!/usr/bin/env python3
"""为目标 workspace 的指定 Agent 补齐 Rondo 工作区环境变量
（RONDO_WORKSPACE_PATH / RONDO_WORKSPACE_BRANCH）。

语义：
  - 只作用于 TARGET_AGENTS（Workitem Analyst / Engineer / Wayfinder Agent）；
    目标 Agent 在 workspace 中缺失时打印 [WARN]，不计入失败（由 provision 负责供给）。
  - 只增不改：Agent custom_env 中键一旦存在（无论值是什么，包括空字符串），
    即视为用户已配置，一律保留原值不改动；仅补不存在的键；两键都存在的 Agent
    直接跳过。既有非 Rondo 键不受影响。
  - 取值全局固定（参考 TFS_URL 的固定常量方式）：
      RONDO_WORKSPACE_PATH   = /tmp
      RONDO_WORKSPACE_BRANCH = dev

用法：
  python provision_agent_rondo_env.py                    # 默认 winning-admin
  python provision_agent_rondo_env.py winning-lfw        # 指定 workspace slug
  python provision_agent_rondo_env.py --workspace-id <uuid>
  python provision_agent_rondo_env.py --dry-run          # 只预演，不写
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

import encoding_bootstrap  # noqa: F401  # 先于任何输出完成 UTF-8 自举
from cli_retry import run_cli

DEFAULT_WORKSPACE_SLUG = "winning-admin"

# 只补这三个 Agent（按用户指定）；其余 Agent 不注入 Rondo 工作区变量
TARGET_AGENTS = ("Workitem Analyst", "Engineer", "Wayfinder Agent")

# 全局固定默认值（只增不改：已存在的键不会被覆盖）
RONDO_WORKSPACE_PATH = "/tmp"
RONDO_WORKSPACE_BRANCH = "dev"
RONDO_KEYS = ("RONDO_WORKSPACE_PATH", "RONDO_WORKSPACE_BRANCH")


def run(args: list[str], stdin_text: str | None = None) -> subprocess.CompletedProcess:
    """执行 multica 写命令；写命令不自动重试（可能已在服务端落地）。"""
    return run_cli(args, stdin_text=stdin_text)


def run_read(args: list[str]) -> subprocess.CompletedProcess:
    """执行 multica 只读命令；传输层故障自动重试。"""
    return run_cli(args, transient=True)


def resolve_workspace_id(name_or_id: str) -> tuple[str, str]:
    """把 slug 或 id 解析为 (workspace_id, slug)。"""
    out = run_read(["multica", "workspace", "list", "--output", "json"])
    if out.returncode != 0:
        raise SystemExit(f"workspace list 失败: {out.stderr.strip()[:200]}")
    for ws in json.loads(out.stdout):
        if name_or_id in (ws.get("id"), ws.get("slug"), ws.get("name")):
            return ws["id"], ws.get("slug", ws["id"])
    raise SystemExit(f"未找到 workspace: {name_or_id}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="为指定 Agent 补齐 Rondo 工作区环境变量（只增不改）",
    )
    parser.add_argument("workspace", nargs="?", default=DEFAULT_WORKSPACE_SLUG,
                        help=f"workspace slug / name / id，默认 {DEFAULT_WORKSPACE_SLUG}")
    parser.add_argument("--workspace-id", help="显式 workspace id（优先于位置参数）")
    parser.add_argument("--dry-run", action="store_true", help="只预演，不写")
    args = parser.parse_args()

    ws_id, ws_slug = resolve_workspace_id(args.workspace_id or args.workspace)
    print(f"目标 workspace: {ws_slug} ({ws_id})")
    print(f"目标 Agent: {list(TARGET_AGENTS)}")

    inject = {
        "RONDO_WORKSPACE_PATH": RONDO_WORKSPACE_PATH,
        "RONDO_WORKSPACE_BRANCH": RONDO_WORKSPACE_BRANCH,
    }

    out = run_read(["multica", "agent", "list", "--workspace-id", ws_id, "--output", "json"])
    if out.returncode != 0:
        raise SystemExit(f"agent list 失败: {out.stderr.strip()[:200]}")
    agents = {a.get("name"): a for a in json.loads(out.stdout)}

    warned, skipped, updated, failed = [], [], [], []
    for name in TARGET_AGENTS:
        agent = agents.get(name)
        if agent is None:
            warned.append(name)
            continue
        aid = agent["id"]

        g = run_read(["multica", "agent", "env", "get", aid,
                 "--workspace-id", ws_id, "--output", "json"])
        if g.returncode != 0:
            failed.append((name, f"env get: {g.stderr.strip()[:120]}"))
            continue
        current = json.loads(g.stdout).get("custom_env") or {}

        # 只增不改：键存在即视为用户已配置（含空字符串），一律保留；仅补不存在的键
        missing = [k for k in RONDO_KEYS if k not in current]
        if not missing:
            skipped.append(name)
            continue
        if args.dry_run:
            updated.append((name, missing, True))
            continue

        merged = {**inject, **current}  # current 在后：既有键优先
        s = run(["multica", "agent", "env", "set", aid,
                 "--workspace-id", ws_id, "--custom-env-stdin"],
                stdin_text=json.dumps(merged))
        if s.returncode != 0:
            failed.append((name, f"env set: {s.stderr.strip()[:120]}"))
            continue

        # 回读校验：只比对键与值是否生效，不输出值
        v = run_read(["multica", "agent", "env", "get", aid,
                 "--workspace-id", ws_id, "--output", "json"])
        env = json.loads(v.stdout).get("custom_env") or {}
        bad = [k for k in missing if env.get(k) != inject[k]]
        if bad:
            failed.append((name, f"回读不一致: {bad}"))
        else:
            updated.append((name, missing, False))

    for name in warned:
        print(f"  [WARN] {name} | workspace 中不存在该 Agent，跳过")
    for name in skipped:
        print(f"  [SKIP] {name} | Rondo 两键已配置，不改动")
    for name, missing, dry in updated:
        tag = "[DRY ]" if dry else "[OK  ]"
        print(f"  {tag} {name} | 补齐 {missing}")
    for name, err in failed:
        print(f"  [FAIL] {name} | {err}")
    print(f"跳过 {len(skipped)}，{'预演补齐' if args.dry_run else '已补齐'} {len(updated)}，"
          f"缺失告警 {len(warned)}，失败 {len(failed)}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
