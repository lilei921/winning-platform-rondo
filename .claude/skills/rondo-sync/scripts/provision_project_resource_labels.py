#!/usr/bin/env python3
"""按 docs/config/project-resources.yaml 的 label 对齐目标 Project 的仓库 Resource。

语义：
  - 按 repo_url 精确匹配 github_repo 类型 Resource；label 不一致就更新（全量对齐 YAML），
    包括覆盖已有手写 label。不新增/删除 Resource，不改 ref / default_branch_hint。
  - Project 定位沿用 provisioning.json 的分组 project.title（组覆盖顶层默认），
    在目标 workspace 内按标题精确匹配，不创建项目。
  - 只读命令走传输层重试；写命令不重试。写入后统一回读一次校验 label 生效。

用法：
  python provision_project_resource_labels.py [workspace] [--workspace-id <uuid>]
      [--repo-root <path>] [--dry-run]
  # 默认 workspace 为 winning-admin；主同步流水线按每个目标 workspace 调用本脚本。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml  # PyYAML 是 rondo-sync 的既定前置依赖
import encoding_bootstrap  # noqa: F401  # 先于任何输出完成 UTF-8 自举
from cli_retry import run_cli, run_cli_json
from workspace_paths import command_env, find_repo_root

DEFAULT_WORKSPACE_SLUG = "winning-admin"
LABELS_REL = Path("docs") / "config" / "project-resources.yaml"
MANIFEST_REL = Path("workspace-config") / "provisioning.json"


def normalize_url(url: str) -> str:
    """URL 只做首尾空白与尾部斜杠归一化，不做模糊匹配或仓库名猜测。"""
    return url.strip().rstrip("/") if isinstance(url, str) else ""


def resource_url(resource: dict) -> str:
    """取 github_repo Resource 的归一化 URL；其他类型返回空串。"""
    if resource.get("resource_type") != "github_repo":
        return ""
    ref = resource.get("resource_ref")
    return normalize_url(ref.get("url") if isinstance(ref, dict) else "")


def load_label_map(root: Path) -> dict[str, str]:
    """从仓库清单构建 repo_url -> label；结构错误抛 ValueError（调用方决定如何呈现）。"""
    path = root / LABELS_REL
    if not path.is_file():
        raise ValueError(f"缺少仓库清单：{path}")
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    repos = data.get("repos") if isinstance(data, dict) else None
    if not isinstance(repos, list):
        raise ValueError(f"{LABELS_REL.as_posix()} 缺少 repos 列表")
    labels: dict[str, str] = {}
    for repo in repos:
        url = normalize_url(repo.get("repo_url") if isinstance(repo, dict) else "")
        raw_label = repo.get("label") if isinstance(repo, dict) else ""
        label = raw_label.strip() if isinstance(raw_label, str) else ""
        if not url or not label:
            raise ValueError(f"{LABELS_REL.as_posix()} 存在缺少 repo_url 或 label 的条目：{repo!r}")
        if url in labels and labels[url] != label:
            raise ValueError(f"{LABELS_REL.as_posix()} 同一仓库 URL 存在不同 label：{url}")
        labels[url] = label
    if not labels:
        raise ValueError(f"{LABELS_REL.as_posix()} 未声明任何仓库 label")
    return labels


def workspace_env(workspace_id: str) -> dict[str, str]:
    """用 MULTICA_WORKSPACE_ID 定向 workspace，不改动 CLI 默认工作区。"""
    return {**command_env(), "MULTICA_WORKSPACE_ID": workspace_id}


def run_read(args: list[str], workspace_id: str):
    """只读 multica 命令：传输层故障自动重试。"""
    return run_cli_json(args, env=workspace_env(workspace_id))


def resolve_workspace_id(name_or_id: str) -> tuple[str, str]:
    """把 slug / name / id 解析为 (workspace_id, slug)。"""
    try:
        workspaces = run_cli_json(
            ["multica", "workspace", "list", "--output", "json"], env=command_env()
        )
    except RuntimeError as exc:
        raise SystemExit(f"workspace list 失败: {exc}") from exc
    for ws in workspaces:
        if name_or_id in (ws.get("id"), ws.get("slug"), ws.get("name")):
            return ws["id"], ws.get("slug", ws["id"])
    raise SystemExit(f"未找到 workspace: {name_or_id}")


def resolve_group(manifest: dict, slug: str) -> dict:
    """按 workspace slug 取分组配置；未分组返回空字典（回落顶层默认）。"""
    for group in (manifest.get("workspace_groups") or {}).values():
        if slug in (group.get("workspaces") or []):
            return group
    return {}


def expected_project_title(manifest: dict, slug: str) -> str | None:
    """分组 project.title 覆盖顶层默认，与 check_workspaces.py 同一口径。"""
    group = resolve_group(manifest, slug)
    project = {**(manifest.get("project") or {}), **(group.get("project") or {})}
    return project.get("title")


def find_project(workspace_id: str, title: str) -> dict | None:
    projects = run_read(["multica", "project", "list", "--output", "json"], workspace_id)
    return next((p for p in projects if p.get("title") == title), None)


def list_resources(workspace_id: str, project_id: str) -> list[dict]:
    return run_read(
        ["multica", "project", "resource", "list", project_id, "--output", "json"],
        workspace_id,
    )


def repo_name(url: str) -> str:
    """仅用于日志展示的仓库名。"""
    return url.rsplit("/", 1)[-1]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="按仓库清单为当前 Project 的仓库 Resource 设置 label（全量对齐 YAML）"
    )
    parser.add_argument(
        "workspace", nargs="?", default=DEFAULT_WORKSPACE_SLUG,
        help=f"workspace slug / name / id，默认 {DEFAULT_WORKSPACE_SLUG}",
    )
    parser.add_argument("--workspace-id", help="显式 workspace id（优先于位置参数）")
    parser.add_argument("--dry-run", action="store_true", help="只预演，不写平台")
    parser.add_argument("--repo-root", help="本次使用的仓库根目录；省略时从当前目录、脚本目录上溯")
    args = parser.parse_args()

    root = find_repo_root(repo_root=args.repo_root)
    try:
        labels = load_label_map(root)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    manifest = json.loads((root / MANIFEST_REL).read_text(encoding="utf-8"))
    workspace_id, slug = resolve_workspace_id(args.workspace_id or args.workspace)
    title = expected_project_title(manifest, slug)
    if not title:
        raise SystemExit(f"{MANIFEST_REL.as_posix()} 未声明 project.title")
    project = find_project(workspace_id, title)
    if not project:
        raise SystemExit(f"workspace {slug} 未找到 Project '{title}'（应先执行 provision）")
    project_id = project["id"]
    print(f"目标 workspace: {slug} ({workspace_id})，Project: {title}，仓库清单 {len(labels)} 条")

    resources = list_resources(workspace_id, project_id)
    unchanged: list[str] = []
    pending: list[tuple[dict, str, str]] = []
    for resource in resources:
        url = resource_url(resource)
        if not url or url not in labels:
            print(f"  [INFO] {repo_name(url) or resource.get('resource_type', 'unknown')} | 非匹配仓库，跳过")
            continue
        label = labels[url]
        if (resource.get("label") or "") == label:
            unchanged.append(repo_name(url))
        else:
            pending.append((resource, label, url))

    for name in unchanged:
        print(f"  [SKIP] {name} | label 已一致")
    updated: list[tuple[dict, str, str]] = []
    failed: list[tuple[str, str]] = []
    for resource, label, url in pending:
        name = repo_name(url)
        if args.dry_run:
            updated.append((resource, label, url))
            continue
        out = run_cli(
            [
                "multica", "project", "resource", "update", project_id, resource["id"],
                "--label", label,
            ],
            env=workspace_env(workspace_id),  # 写命令不重试：避免重复写入
        )
        if out.returncode != 0:
            failed.append((name, (out.stderr or out.stdout).strip()[:160]))
            continue
        updated.append((resource, label, url))

    # 有写入才回读一次，逐条确认 label 生效。
    if updated and not args.dry_run:
        actual = {r.get("id"): r.get("label") for r in list_resources(workspace_id, project_id)}
        confirmed = []
        for resource, label, url in updated:
            name = repo_name(url)
            if (actual.get(resource["id"]) or "") == label:
                confirmed.append((resource, label, url))
            else:
                failed.append((name, "回读未命中"))
        updated = confirmed

    for resource, label, url in updated:
        tag = "[DRY ]" if args.dry_run else "[OK  ]"
        action = "预演设置 label" if args.dry_run else "已设置 label"
        print(f"  {tag} {repo_name(url)} | {action}（{len(label)} 字）")
    for name, err in failed:
        print(f"  [FAIL] {name} | {err}")
    verb = "预演设置" if args.dry_run else "已设置"
    print(f"跳过 {len(unchanged)}，{verb} {len(updated)}，失败 {len(failed)}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
