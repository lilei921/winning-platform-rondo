#!/usr/bin/env python3
"""回读校验目标 workspace 的供给状态是否与仓内 manifest 一致（只读，不写平台与仓内文件）。

校验维度（基准：workspace-config/provisioning.json）：
  1. MCP        —— workspace MCP 库与 manifest mcp_servers（组覆盖优先于顶层默认）
  2. 仓库注册表 —— manifest workspace_repos 声明的 URL 均在 multica repo list 中（只增不维护，多余项只提示）
  3. Project    —— 分组 project.title 对应的项目存在，且挂有仓库资源（git URL 或匹配的 local_directory）
  4. Agent      —— manifest agents 齐全、Skill 绑定一致、runtime 绑定统一且有效（未失效/尽量在线）、TFS 环境变量键数
  5. Skill      —— managed_skills 均在 workspace Skill 清单中
  6. Squad      —— Delivery Squad 存在，成员数 = squad.members + leader
  7. Autopilot  —— manifest autopilots 均在且为 active（无 trigger 属 MG-5 设计，不报警）

分级：[OK] 一致 / [INFO] 多余项（只增不维护语义下不回滚）/ [WARN] 可用性风险 / [FAIL] 与 manifest 不一致。
任一 [FAIL] 该 workspace 计入失败；退出码为失败 workspace 数（>0 即非零）。

用法：
  python check_workspaces.py                        # 发现 admin 的全部 winning-* workspace
  python check_workspaces.py winning-lfw            # 只校验指定 workspace（可多个）
  python check_workspaces.py --member ydx --prefix winning-
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from cli_retry import run_cli_json
from workspace_paths import command_env, find_repo_root

MANIFEST_REL = Path("workspace-config") / "provisioning.json"

# TFS 环境变量三键（TFS_URL / TFS_COLLECTION / TFS_PAT）的最低键数
TFS_ENV_KEY_COUNT = 3


def run_json(args: list[str], workspace_id: str | None = None) -> object:
    """执行 multica 只读命令并解析 JSON 输出；用 MULTICA_WORKSPACE_ID 定向 workspace。"""
    env = command_env()
    if workspace_id:
        env["MULTICA_WORKSPACE_ID"] = workspace_id
    return run_cli_json(args, env=env)


def list_workspaces() -> list[dict]:
    return run_json(["multica", "workspace", "list", "--output", "json", "--full-id"])


def list_members(workspace_id: str) -> list[dict]:
    return run_json([
        "multica", "workspace", "member", "list",
        "--workspace-id", workspace_id, "--output", "json",
    ])


def discover_workspaces(member: str, prefix: str) -> list[dict]:
    """找出成员包含 member、且 slug 以 prefix 开头的 workspace（与 sync_workspace.py 同一发现口径）。"""
    matched = []
    for workspace in list_workspaces():
        slug = workspace.get("slug") or workspace.get("name") or ""
        if prefix and not slug.startswith(prefix):
            continue
        hit = next(
            (m for m in list_members(workspace["id"])
             if member in (m.get("name"), m.get("email"))),
            None,
        )
        if hit is None:
            continue
        matched.append({
            "id": workspace["id"],
            "slug": slug,
            "role": hit.get("role"),
        })
    return matched


def resolve_workspace(name: str) -> dict:
    for workspace in list_workspaces():
        if name in (workspace.get("name"), workspace.get("slug"), workspace.get("id")):
            return {"id": workspace["id"], "slug": workspace.get("slug") or name, "role": None}
    raise SystemExit(f"未找到 workspace：{name}")


def resolve_group(manifest: dict, slug: str) -> tuple[str | None, dict]:
    """按 workspace slug 解析所属分组；未分组返回 (None, {})（回落顶层默认，即 df）。"""
    for name, group in (manifest.get("workspace_groups") or {}).items():
        if slug in (group.get("workspaces") or []):
            return name, group
    return None, {}


class Expectation:
    """单个 workspace 按分组解析后的供给基准。"""

    def __init__(self, manifest: dict, slug: str):
        self.group, group_cfg = resolve_group(manifest, slug)
        mcps = group_cfg.get("mcp_servers", manifest.get("mcp_servers")) or []
        self.mcp_names = sorted(m["name"] for m in mcps if m.get("name"))
        repos = group_cfg.get("workspace_repos", manifest.get("workspace_repos")) or []
        self.repo_urls = [r["url"] for r in repos if r.get("url")]
        project = {**(manifest.get("project") or {}), **(group_cfg.get("project") or {})}
        self.project_title = project.get("title")
        self.agents = {
            a["name"]: sorted(a.get("skills", []))
            for a in manifest.get("agents", []) if a.get("name")
        }
        self.skills = sorted(manifest.get("managed_skills", []))
        squad = manifest.get("squad") or {}
        self.squad_name = squad.get("name")
        self.squad_members = len(squad.get("members", [])) + (1 if squad.get("leader") else 0)
        self.autopilots = sorted(
            a["title"] for a in manifest.get("autopilots", []) if a.get("title")
        )

    def group_label(self) -> str:
        return self.group if self.group else "未分组(顶层默认)"


def repo_name_from_url(url: str) -> str:
    """从 git URL 取仓库名（.../_git/<name> 或路径末段）。"""
    tail = url.rstrip("/").rsplit("/", 1)[-1]
    return tail


def resource_matches_repo(resource: dict, repo_url: str) -> str | None:
    """项目资源是否覆盖声明仓库；命中返回资源形态描述，否则 None。"""
    ref = resource.get("resource_ref") or {}
    rtype = resource.get("resource_type") or ""
    url = ref.get("url") or ""
    if url and url.rstrip("/") == repo_url.rstrip("/"):
        return f"git({repo_name_from_url(repo_url)})"
    name = repo_name_from_url(repo_url)
    for text in (ref.get("label"), ref.get("local_path")):
        if text and name in str(text):
            return f"{rtype or 'local'}({text})"
    return None


def check_workspace(slug: str, ws_id: str, exp: Expectation) -> list[tuple[str, str, str]]:
    """逐维度回读校验，返回 (级别, 维度, 明细) 列表。级别：OK/INFO/WARN/FAIL/ERROR。"""
    findings: list[tuple[str, str, str]] = []

    def add(level: str, dim: str, detail: str) -> None:
        findings.append((level, dim, detail))

    # --- MCP ---
    try:
        mcps = run_json(["multica", "workspace", "mcp", "list", slug, "--output", "json"], ws_id)
        names = sorted(m.get("name") for m in mcps)
        missing = [n for n in exp.mcp_names if n not in names]
        extra = [n for n in names if n not in exp.mcp_names]
        if missing:
            add("FAIL", "MCP", f"{len(names)}/{len(exp.mcp_names)} 缺失={missing}")
        else:
            add("OK", "MCP", f"{len(names)} -> {names}")
        if extra:
            add("INFO", "MCP", f"多余={extra}")
    except (RuntimeError, json.JSONDecodeError) as exc:
        add("ERROR", "MCP", str(exc))

    # --- workspace 仓库注册表（只增不维护：多余项仅提示） ---
    try:
        repos = run_json(["multica", "repo", "list", "--output", "json"], ws_id)
        urls = [r.get("url") for r in repos if r.get("url")]
        missing = [u for u in exp.repo_urls if u not in urls]
        extra = [u for u in urls if u not in exp.repo_urls]
        if missing:
            add("FAIL", "仓库注册表", f"缺失={[repo_name_from_url(u) for u in missing]}")
        else:
            add("OK", "仓库注册表", f"声明 {len(exp.repo_urls)} 个均在册")
        if extra:
            add("INFO", "仓库注册表",
                f"多余 {len(extra)} 个={[repo_name_from_url(u) for u in extra]}")
    except (RuntimeError, json.JSONDecodeError) as exc:
        add("ERROR", "仓库注册表", str(exc))

    # --- Project 与项目资源 ---
    try:
        projects = run_json(["multica", "project", "list", "--output", "json"], ws_id)
        target = next((p for p in projects if p.get("title") == exp.project_title), None)
        if target is None:
            titles = [p.get("title") for p in projects]
            add("FAIL", "Project", f"未找到 '{exp.project_title}'（现有={titles}）")
        else:
            resources = run_json(
                ["multica", "project", "resource", "list", target["id"], "--output", "json"],
                ws_id,
            )
            hits = []
            for resource in resources:
                for url in exp.repo_urls:
                    hit = resource_matches_repo(resource, url)
                    if hit:
                        hits.append(hit)
            if hits:
                add("OK", "Project", f"'{exp.project_title}' 资源={hits}")
            elif resources:
                kinds = [r.get("resource_type") for r in resources]
                add("WARN", "Project",
                    f"'{exp.project_title}' 有 {len(resources)} 个资源但均未匹配声明仓库（类型={kinds}）")
            else:
                add("FAIL", "Project", f"'{exp.project_title}' 无任何资源")
        extra_projects = [p.get("title") for p in projects
                          if p.get("title") != exp.project_title]
        if extra_projects:
            add("INFO", "Project", f"另有 {len(extra_projects)} 个自有项目={extra_projects}")
    except (RuntimeError, json.JSONDecodeError) as exc:
        add("ERROR", "Project", str(exc))

    # --- Agent（数量、Skill 绑定、TFS 环境变量、runtime 绑定） ---
    try:
        agents = run_json(["multica", "agent", "list", "--output", "json"], ws_id)
        names = sorted(a.get("name") for a in agents)
        missing = [n for n in exp.agents if n not in names]
        extra = [n for n in names if n not in exp.agents]
        if missing:
            add("FAIL", "Agent", f"{len(agents)}/{len(exp.agents)} 缺失={missing}")
        else:
            add("OK", "Agent", f"{len(agents)} 个 manifest Agent 齐全")
        if extra:
            add("INFO", "Agent", f"多余={extra}")
        tfs_missing = []
        for agent in sorted(agents, key=lambda x: x.get("name") or ""):
            name = agent.get("name")
            if name not in exp.agents:
                continue
            got = sorted(
                s.get("name") if isinstance(s, dict) else s
                for s in (agent.get("skills") or [])
            )
            if got != exp.agents[name]:
                add("FAIL", "Agent Skill 绑定",
                    f"{name}: got={got} exp={exp.agents[name]}")
            env_keys = agent.get("custom_env_key_count")
            if env_keys is not None and env_keys < TFS_ENV_KEY_COUNT:
                tfs_missing.append(f"{name}({env_keys}键)")
        if tfs_missing:
            add("WARN", "Agent TFS 环境变量",
                f"{len(tfs_missing)} 个 Agent 不足 {TFS_ENV_KEY_COUNT} 键：{tfs_missing}")
        # runtime 绑定：统一性、失效、在线状态
        try:
            runtimes = run_json(["multica", "runtime", "list", "--output", "json"], ws_id)
            if isinstance(runtimes, dict):
                runtimes = runtimes.get("runtimes", [])
        except (RuntimeError, json.JSONDecodeError):
            runtimes = []
        rt_map = {r.get("id"): r for r in runtimes}
        bound: dict[str, list[str]] = {}
        for agent in agents:
            rid = agent.get("runtime_id")
            if rid:
                bound.setdefault(rid, []).append(agent.get("name"))
        stale = [rid for rid in bound if rid not in rt_map]
        for rid in stale:
            add("FAIL", "runtime",
                f"{len(bound[rid])} 个 Agent 绑定失效 runtime {rid[:8]}（已不在 workspace）")
        if len(bound) > 1:
            dist = [f"{(rt_map.get(r) or {}).get('name') or r[:8]}×{len(n)}"
                    for r, n in bound.items()]
            add("WARN", "runtime", f"Agent 绑定分散在 {len(bound)} 个 runtime：{dist}")
        for rid, agent_names in bound.items():
            runtime = rt_map.get(rid)
            if runtime and runtime.get("status") != "online":
                add("WARN", "runtime",
                    f"{runtime.get('name') or rid[:8]} 离线，{len(agent_names)} 个 Agent 不可用")
        if not bound and agents:
            add("WARN", "runtime", "所有 Agent 均未绑定 runtime")
    except (RuntimeError, json.JSONDecodeError) as exc:
        add("ERROR", "Agent", str(exc))

    # --- Skill ---
    try:
        skills = run_json(["multica", "skill", "list", "--output", "json"], ws_id)
        items = skills if isinstance(skills, list) else skills.get("skills", [])
        names = sorted(s.get("name") for s in items)
        missing = [n for n in exp.skills if n not in names]
        extra = [n for n in names if n not in exp.skills]
        if missing:
            add("FAIL", "Skill", f"{len(names)}/{len(exp.skills)} 缺失={missing}")
        else:
            add("OK", "Skill", f"managed {len(exp.skills)} 个均在册（共 {len(names)}）")
        if extra:
            add("INFO", "Skill", f"多余={extra}")
    except (RuntimeError, json.JSONDecodeError) as exc:
        add("ERROR", "Skill", str(exc))

    # --- Squad ---
    try:
        squads = run_json(["multica", "squad", "list", "--output", "json"], ws_id)
        target = next((s for s in squads if s.get("name") == exp.squad_name), None)
        if target is None:
            add("FAIL", "Squad", f"未找到 '{exp.squad_name}'")
        else:
            count = target.get("member_count")
            if count != exp.squad_members:
                add("WARN", "Squad",
                    f"'{exp.squad_name}' 成员 {count}，期望 {exp.squad_members}")
            else:
                add("OK", "Squad", f"'{exp.squad_name}' 成员 {count}")
        extra_squads = [s.get("name") for s in squads if s.get("name") != exp.squad_name]
        if extra_squads:
            add("INFO", "Squad", f"另有自有 Squad={extra_squads}")
    except (RuntimeError, json.JSONDecodeError) as exc:
        add("ERROR", "Squad", str(exc))

    # --- Autopilot ---
    try:
        aps = run_json(["multica", "autopilot", "list", "--output", "json"], ws_id)
        items = aps.get("autopilots", []) if isinstance(aps, dict) else aps
        titles = sorted(a.get("title") for a in items)
        missing = [t for t in exp.autopilots if t not in titles]
        extra = [t for t in titles if t not in exp.autopilots]
        if missing:
            add("FAIL", "Autopilot", f"缺失={missing}")
        else:
            add("OK", "Autopilot", f"{len(exp.autopilots)} 个均在 -> {exp.autopilots}")
        paused = [a.get("title") for a in items
                  if a.get("title") in exp.autopilots and a.get("status") != "active"]
        if paused:
            add("WARN", "Autopilot", f"非 active={paused}")
        if extra:
            add("INFO", "Autopilot", f"多余={extra}")
    except (RuntimeError, json.JSONDecodeError) as exc:
        add("ERROR", "Autopilot", str(exc))

    return findings


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "workspaces", nargs="*",
        help="目标 workspace 名称或 slug；缺省时按 --member / --prefix 发现",
    )
    parser.add_argument(
        "--member", default="admin",
        help="按成员名或邮箱筛选 workspace（默认 admin）",
    )
    parser.add_argument(
        "--prefix", default="winning-",
        help="只校验 slug 以此前缀开头的 workspace（默认 winning-；传空字符串关闭筛选）",
    )
    parser.add_argument("--repo-root", help="本次使用的仓库根目录；省略时从当前目录、脚本目录上溯")
    args = parser.parse_args()

    root = find_repo_root(repo_root=args.repo_root)
    manifest = json.loads((root / MANIFEST_REL).read_text(encoding="utf-8"))

    try:
        if args.workspaces:
            targets = [resolve_workspace(name) for name in args.workspaces]
        else:
            targets = discover_workspaces(args.member, args.prefix)
    except SystemExit as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    if not targets:
        print(f"没有匹配到 workspace（member={args.member}，prefix={args.prefix!r}）。",
              file=sys.stderr)
        return 2
    print(f"校验目标 workspace（{len(targets)} 个）："
          f"{[t['slug'] for t in targets]}")

    failed, warned = [], []
    for target in targets:
        slug, ws_id = target["slug"], target["id"]
        exp = Expectation(manifest, slug)
        print(f"\n===== 校验 {slug}（{ws_id[:8]}，分组 {exp.group_label()}）=====")
        try:
            findings = check_workspace(slug, ws_id, exp)
        except KeyboardInterrupt:
            print("\n校验已中断。", file=sys.stderr)
            return 130
        has_fail = has_warn = False
        for level, dim, detail in findings:
            print(f"  [{level:5s}] {dim}: {detail}")
            has_fail = has_fail or level in ("FAIL", "ERROR")
            has_warn = has_warn or level == "WARN"
        if has_fail:
            failed.append(slug)
        elif has_warn:
            warned.append(slug)

    print(f"\n校验完成：共 {len(targets)} 个 workspace，"
          f"失败 {len(failed)}，仅告警 {len(warned)}，全部通过 "
          f"{len(targets) - len(failed) - len(warned)}")
    if failed:
        print(f"  失败：{failed}")
    if warned:
        print(f"  告警：{warned}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
