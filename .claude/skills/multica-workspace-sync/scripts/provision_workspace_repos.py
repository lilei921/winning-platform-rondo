#!/usr/bin/env python3
"""为目标 workspace 供给 workspace 级仓库注册表（multica repo add）。

语义：
  - 只增不维护：URL 已存在于 workspace 仓库注册表时视为已配置，一律保留
    原描述不改动，不更新；仅补注册表中不存在的 URL。
  - 分组：provisioning.json 的 workspace_groups 段按 workspace slug 分组
    （df / bi）。组的 workspace_repos 覆盖顶层 workspace_repos；
    组内未声明或未分组的 workspace 回落顶层默认（df 组）。
  - 声明来源：仓内 workspace-config/provisioning.json
    的 workspace_repos / workspace_groups 段（缺段或为空则整步跳过，向后兼容）。

用法：
  python provision_workspace_repos.py                    # 默认 winning-admin
  python provision_workspace_repos.py winning-lfw        # 指定 workspace slug
  python provision_workspace_repos.py --workspace-id <uuid>
  python provision_workspace_repos.py --dry-run          # 只预演，不写
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from workspace_paths import command_env, find_repo_root

DEFAULT_WORKSPACE_SLUG = "winning-admin"

MANIFEST = Path("workspace-config") / "provisioning.json"


def run(args: list[str], workspace_id: str) -> subprocess.CompletedProcess:
    """执行 multica 命令，用 MULTICA_WORKSPACE_ID 定向 workspace，不改动 CLI 默认工作区。"""
    env = {**command_env(), "MULTICA_WORKSPACE_ID": workspace_id}
    return subprocess.run(args, capture_output=True, encoding="utf-8", errors="replace", env=env)


def resolve_workspace_id(name_or_id: str) -> tuple[str, str]:
    """把 slug 或 id 解析为 (workspace_id, slug)。"""
    out = subprocess.run(
        ["multica", "workspace", "list", "--output", "json"],
        capture_output=True, encoding="utf-8", errors="replace", env=command_env(),
    )
    if out.returncode != 0:
        raise SystemExit(f"workspace list 失败: {out.stderr.strip()[:200]}")
    for ws in json.loads(out.stdout):
        if name_or_id in (ws.get("id"), ws.get("slug"), ws.get("name")):
            return ws["id"], ws.get("slug", ws["id"])
    raise SystemExit(f"未找到 workspace: {name_or_id}")


def resolve_group(manifest: dict, slug: str) -> tuple[str | None, dict]:
    """按 workspace slug 解析所属分组；未分组返回 (None, {})。"""
    for name, group in (manifest.get("workspace_groups") or {}).items():
        if slug in (group.get("workspaces") or []):
            return name, group
    return None, {}


def load_declared_repos(root: Path, slug: str) -> tuple[list[dict], str | None]:
    """取目标 workspace 生效的仓库清单：组 workspace_repos 覆盖顶层默认（df）。"""
    manifest_path = root / MANIFEST
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    group_name, group = resolve_group(manifest, slug)
    repos = group.get("workspace_repos", manifest.get("workspace_repos")) or []
    for repo in repos:
        if not repo.get("url"):
            raise SystemExit(f"{MANIFEST} 的 workspace_repos 存在缺少 url 的条目：{repo!r}")
    return repos, group_name


def list_existing_urls(workspace_id: str) -> set[str]:
    out = run(["multica", "repo", "list", "--output", "json"], workspace_id)
    if out.returncode != 0:
        raise SystemExit(f"repo list 失败: {out.stderr.strip()[:200]}")
    return {r.get("url") for r in json.loads(out.stdout) if r.get("url")}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="为 workspace 供给仓库注册表（只增不维护：已存在的 URL 不改动）"
    )
    parser.add_argument(
        "workspace", nargs="?", default=DEFAULT_WORKSPACE_SLUG,
        help=f"workspace slug / name / id，默认 {DEFAULT_WORKSPACE_SLUG}",
    )
    parser.add_argument("--workspace-id", help="显式 workspace id（优先于位置参数）")
    parser.add_argument("--dry-run", action="store_true", help="只预演，不写")
    parser.add_argument("--repo-root", help="本次使用的仓库根目录；省略时从当前目录、脚本目录上溯")
    args = parser.parse_args()

    root = find_repo_root(repo_root=args.repo_root)
    ws_id, ws_slug = resolve_workspace_id(args.workspace_id or args.workspace)
    declared, group_name = load_declared_repos(root, ws_slug)
    if not declared:
        print("[SKIP] provisioning.json 未声明 workspace_repos，跳过仓库注册表供给")
        return

    group_label = group_name if group_name else "未分组（顶层默认）"
    print(f"目标 workspace: {ws_slug} ({ws_id})，分组: {group_label}")

    existing = list_existing_urls(ws_id)
    skipped, added, failed = [], [], []
    for repo in declared:
        url = repo["url"]
        if url in existing:
            skipped.append(url)
            continue
        if args.dry_run:
            added.append(url)
            continue
        command = ["multica", "repo", "add", url]
        if repo.get("description"):
            command += ["--description", repo["description"]]
        out = run(command, ws_id)
        if out.returncode != 0:
            failed.append((url, out.stderr.strip()[:160]))
            continue
        # 回读校验：确认 URL 已进入注册表
        if url in list_existing_urls(ws_id):
            added.append(url)
        else:
            failed.append((url, "回读未命中"))

    for url in skipped:
        print(f"  [SKIP] {url} | 已存在，不维护")
    for url in added:
        tag = "[DRY ]" if args.dry_run else "[OK  ]"
        action = "预演加入注册表" if args.dry_run else "已加入注册表"
        print(f"  {tag} {url} | {action}")
    for url, err in failed:
        print(f"  [FAIL] {url} | {err}")
    print(f"跳过 {len(skipped)}，{'预演加入' if args.dry_run else '已加入'} {len(added)}，失败 {len(failed)}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
