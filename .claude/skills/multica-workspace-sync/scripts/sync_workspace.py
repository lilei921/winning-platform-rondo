#!/usr/bin/env python3
"""把仓内 Multica 资产同步到目标 workspace。

默认目标：成员包含 admin、且 slug 以 winning- 开头的全部 workspace。
也可显式给出 workspace 名称覆盖发现结果。

流水线（每步失败即停止该 workspace，其余 workspace 继续）：
  1. provision —— 供给 Skill / Agent / Squad / Project / Autopilot 对象
                  （Rondo 按 workspace slug 在内存中合并 Project / MCP 分组配置）
  2. sync      —— 渲染仓库映射配置并 upsert Skill 文件
  3. disable   —— 关闭 Agent 继承自 runtime 的本地 Skill
  4. tfs-env   —— 为 Agent 补齐 TFS_URL / TFS_COLLECTION / TFS_PAT（只增不改）
  5. rondo-env —— 为 Workitem Analyst / Engineer / Wayfinder Agent 补齐
                  RONDO_WORKSPACE_PATH（默认 /tmp）/ RONDO_WORKSPACE_BRANCH（默认 dev）
                  （只增不改）
  6. repos     —— 供给 workspace 级仓库注册表（只增不维护：已存在的 URL 不改动；
                  按 workspace_groups 分组解析，组 workspace_repos 覆盖顶层默认）

用法：
  python sync_workspace.py                      # 发现 admin 的全部 winning-* workspace
  python sync_workspace.py winning-lfw          # 只同步指定 workspace
  python sync_workspace.py --member ydx --prefix winning-
  python sync_workspace.py --runtime-id <uuid>
  python sync_workspace.py --with-workflow      # 服务端支持 workflow API 时恢复检查与状态供给
  python sync_workspace.py --skip-tfs-env       # 跳过默认的 TFS 环境变量补齐
  python sync_workspace.py --skip-rondo-env     # 跳过默认的 Rondo 工作区环境变量补齐
  python sync_workspace.py --skip-repos         # 跳过默认的 workspace 仓库注册表供给
  python sync_workspace.py --dry-run

只写目标 Multica workspace 与仓内 overlay 文件；不回滚已完成的步骤。
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import socket
import subprocess
import sys
from pathlib import Path

from workspace_paths import command_env, find_repo_root

# provision / sync / disable 都由这三条外部命令承担，本脚本只编排。
# CLI 名称：rondo 为当前主入口，skill-flow 为其前身（命令兼容，未退役前仍可用）。
CLI_CANDIDATES = ("rondo", "skill-flow")
CLI_LOCAL_FALLBACKS = (
    Path("rondo") / "dist" / "index.js",
)
MIN_PYTHON = (3, 7)  # tools/repo_registry.py 使用 from __future__ import annotations

MANIFEST_REL = Path("workspace-config") / "provisioning.json"


def manifest_backup_path(root: Path) -> Path:
    manifest = root / MANIFEST_REL
    return manifest.with_name(manifest.name + ".group-swap.bak")


def restore_manifest_if_needed(root: Path, dry_run: bool = False) -> None:
    """上次运行在分组 project 供给期间被杀时，从哨兵备份恢复共享 manifest。"""
    backup = manifest_backup_path(root)
    if backup.is_file():
        if dry_run:
            raise SystemExit(f"检测到旧版同步遗留备份 {backup}；请先恢复 manifest 再预演。")
        manifest = root / MANIFEST_REL
        manifest.write_text(backup.read_text(encoding="utf-8"), encoding="utf-8")
        backup.unlink()
        print(f"[WARN] 检测到上次分组供给中断，已从备份恢复 {manifest}", file=sys.stderr)


def run_json(command: list[str], cwd: Path) -> object:
    result = subprocess.run(
        command, cwd=cwd, env=command_env(), check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    return json.loads(result.stdout.decode("utf-8"))


def resolve_cli(root: Path) -> list[str]:
    """优先使用当前仓库构建，避免全局旧版 CLI 继续读取迁移前的路径。"""
    for relative in CLI_LOCAL_FALLBACKS:
        local = root / relative
        if local.is_file():
            return ["node", str(local)]
    for name in CLI_CANDIDATES:
        installed = shutil.which(name)
        if installed:
            return [installed]
    raise SystemExit(
        "未找到 rondo / skill-flow。请先全局安装（npm i -g @winning/rondo）"
        "或在仓内构建（cd rondo && npm install && npm run build）。"
    )


def check_python() -> None:
    """预检 Rondo 渲染 registry 使用的 python 版本和 PyYAML 依赖。"""
    executable = shutil.which("python")
    if not executable:
        raise SystemExit("未找到 python。rondo 同步 Skill 时需要 `python` 在 PATH 上。")
    probe = subprocess.run(
        [executable, "-c", "import sys; print('%d.%d' % sys.version_info[:2])"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if probe.returncode != 0:
        raise SystemExit(f"无法执行 {executable}：{probe.stderr.decode('utf-8', 'replace').strip()}")
    try:
        major, minor = (int(part) for part in probe.stdout.decode().strip().split("."))
    except ValueError:
        raise SystemExit(f"无法解析 python 版本：{probe.stdout.decode().strip()!r}")
    if (major, minor) < MIN_PYTHON:
        raise SystemExit(
            f"python {major}.{minor} 过低：tools/repo_registry.py 需要 ≥{MIN_PYTHON[0]}.{MIN_PYTHON[1]}。"
        )

    dependency = subprocess.run(
        [executable, "-c", "import yaml"], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if dependency.returncode != 0:
        raise SystemExit("python 缺少 PyYAML；请先执行 python -m pip install PyYAML。")


def list_workspaces(root: Path) -> list[dict]:
    return run_json(["multica", "workspace", "list", "--output", "json"], root)


def list_members(root: Path, workspace_id: str) -> list[dict]:
    return run_json(
        ["multica", "workspace", "member", "list", "--workspace-id", workspace_id, "--output", "json"],
        root,
    )


def discover_workspaces(root: Path, member: str, prefix: str) -> list[dict]:
    """找出成员包含 member、且 slug 以 prefix 开头的 workspace。

    member 按 name 或 email 匹配（admin / admin@winning.com.cn 均可）。
    """
    matched = []
    for workspace in list_workspaces(root):
        slug = workspace.get("slug") or workspace.get("name") or ""
        if prefix and not slug.startswith(prefix):
            continue
        members = list_members(root, workspace["id"])
        hit = next(
            (
                m for m in members
                if member in (m.get("name"), m.get("email"))
            ),
            None,
        )
        if hit is None:
            continue
        matched.append({
            "id": workspace["id"],
            "slug": slug,
            "name": workspace.get("name") or slug,
            "role": hit.get("role"),
        })
    return matched


def list_runtimes(root: Path, workspace_id: str) -> list[dict]:
    return run_json(
        ["multica", "runtime", "list", "--workspace-id", workspace_id, "--output", "json"], root,
    )


def resolve_workspace(name: str, root: Path) -> dict:
    for workspace in list_workspaces(root):
        if name in (workspace.get("name"), workspace.get("slug"), workspace.get("id")):
            return {"id": workspace["id"], "slug": workspace.get("slug") or name,
                    "name": workspace.get("name") or name, "role": None}
    raise SystemExit(f"未找到 workspace：{name}")


def resolve_runtime(root: Path, workspace_id: str, fixed: str | None) -> tuple[str, list[str], list[str]]:
    """选 runtime。

    显式指定优先；否则沿用该 workspace 既有 Agent 绑定的 runtime；
    都没有时在该 workspace 的在线 runtime 中随机取一个。
    沿用既有绑定可避免把新建 Agent 绑到其他同事机器的 runtime 上。

    返回 (runtime_id, 既有绑定列表, 失效绑定列表)：既有 Agent 指向的 runtime
    已从该 workspace 消失时列入失效绑定——这类绑定必须改绑，否则后续 skill 发现会 404。
    """
    runtimes = list_runtimes(root, workspace_id)
    if fixed:
        if not any(r.get("id") == fixed for r in runtimes):
            raise SystemExit(f"--runtime-id {fixed} 不在 workspace {workspace_id} 的 runtime 清单中")
        return fixed, [], []
    if not runtimes:
        raise SystemExit(
            f"workspace {workspace_id} 下没有 runtime。runtime 是 workspace 级对象，"
            "需先在该 workspace 启动 daemon 注册。"
        )
    agents = run_json(
        ["multica", "agent", "list", "--workspace-id", workspace_id, "--output", "json"], root,
    )
    bound = {a.get("runtime_id") for a in agents if a.get("runtime_id")}
    valid = {r.get("id") for r in runtimes}
    stale = sorted(bound - valid)
    if len(bound) == 1:
        existing = next(iter(bound))
        if existing in valid:
            return existing, sorted(bound), stale
    online = [r for r in runtimes if r.get("status") == "online"]
    pool = online or runtimes
    return random.choice(pool)["id"], sorted(bound), stale


def runtime_device(root: Path, workspace_id: str, runtime_id: str) -> str | None:
    """取 runtime 所在设备名（device_info 的第一段，如 test220-pg-db1）。"""
    for runtime in list_runtimes(root, workspace_id):
        if runtime.get("id") != runtime_id:
            continue
        device = (runtime.get("device_info") or "").split("·")[0].strip()
        return device or None
    return None


def should_disable_runtime_skills(
    root: Path, workspace_id: str, bound_runtime_ids: list[str],
) -> tuple[bool, str]:
    """判断是否执行"禁用 runtime skills"。

    Agent 绑定的是同事自己机器上的 runtime 时，其本地 Skill 是本人有意保留的环境，
    不做禁用；绑在本机 runtime 上时才禁用（避免与仓内 Skill 重复暴露）。
    """
    if not bound_runtime_ids:
        return False, "没有 Agent 绑定 runtime，跳过禁用"
    local = socket.gethostname()
    for runtime_id in bound_runtime_ids:
        device = runtime_device(root, workspace_id, runtime_id)
        if device is None:
            return False, f"Agent 绑定 runtime {runtime_id} 已不在该 workspace，跳过禁用"
        if device != local:
            return False, f"Agent 绑定的是 {device} 上的 runtime（非本机 {local}），按约定不执行禁用"
    return True, ""


def bind_agent_runtime(root: Path, workspace_id: str, runtime_id: str, dry_run: bool) -> int:
    """把 Agent 改绑到指定 runtime。

    provision 只在新建 Agent 时使用 --runtime-id，已存在的 Agent 保留原 runtime；
    显式指定 runtime 时必须单独改绑，否则 --runtime-id 对已供给的 workspace 无效。
    """
    agents = run_json(
        ["multica", "agent", "list", "--workspace-id", workspace_id, "--output", "json"], root,
    )
    drift = [a for a in agents if a.get("runtime_id") != runtime_id]
    if not drift:
        return 0
    for agent in drift:
        label = f"{agent.get('name')} [{agent.get('id')}]"
        if dry_run:
            print(f"[PREVIEW] 改绑 runtime：{label} → {runtime_id}")
            continue
        run_json(
            [
                "multica", "agent", "update", "--workspace-id", workspace_id, agent["id"],
                "--runtime-id", runtime_id, "--output", "json",
            ],
            root,
        )
        print(f"[OK] 改绑 runtime：{label} → {runtime_id}")
    return len(drift)


def sync_workspace(
    name: str,
    workspace_id: str,
    runtime_id: str,
    root: Path,
    cli: list[str],
    disable_script: Path,
    dry_run: bool,
    rebind_runtime: bool,
    discovery_timeout: float,
    disable_runtime_skills: bool,
    disable_skip_reason: str,
    skip_workflow: bool,
    tfs_script: Path,
    skip_tfs_env: bool,
    rondo_script: Path,
    skip_rondo_env: bool,
    repos_script: Path,
    skip_repos: bool,
) -> int:
    provision = cli + [
        "workspace", "provision",
        "--workspace", name, "--slug", name,
        "--runtime-id", runtime_id,
    ]
    if skip_workflow:
        # 默认跳过 workflow 前置检查与状态供给（97 等服务端无 workflow API）；
        # 服务端支持时可用 --with-workflow 恢复。
        provision.append("--skip-workflow")
    sync = cli + ["workspace", "sync", "--workspace", name]
    if dry_run:
        provision.append("--dry-run")
        sync.append("--dry-run")

    steps = [
        ("配置 workspace", None, provision),
        ("同步 skills 和 agents", None, sync),
    ]
    if rebind_runtime:
        # provision 只在新建 Agent 时用 --runtime-id，显式指定 runtime 时补一次改绑。
        steps.append(("绑定 Agent runtime", "bind", None))
    disable_base = [
        sys.executable, str(disable_script), "--workspace-id", workspace_id,
        "--discovery-timeout", str(discovery_timeout),
    ]
    if not disable_runtime_skills:
        # Agent 绑定同事自己机器的 runtime：其本地 Skill 是本人有意保留的环境，不禁用。
        print(f"[SKIP] 禁用 runtime skills：{disable_skip_reason}", flush=True)
    else:
        if not dry_run:
            # 先预览再落盘：禁用数量异常时先看清作用范围。
            steps.append(("预览 runtime skills", None, disable_base))
        steps.append((
            "禁用 runtime skills",
            None,
            disable_base + ([] if dry_run else ["--apply"]),
        ))
    if skip_tfs_env:
        print("[SKIP] 补齐 Agent TFS 环境变量：按 --skip-tfs-env 跳过", flush=True)
    else:
        # 只增不改：已配置的 TFS 键一律保留；real PAT 只下发 winning-admin / winning-lilei。
        tfs_command = [sys.executable, str(tfs_script), name]
        if dry_run:
            tfs_command.append("--dry-run")
        steps.append(("补齐 Agent TFS 环境变量", None, tfs_command))
    if skip_rondo_env:
        print("[SKIP] 补齐 Agent Rondo 环境变量：按 --skip-rondo-env 跳过", flush=True)
    else:
        # 只增不改：仅对 Workitem Analyst / Engineer / Wayfinder Agent 补
        # RONDO_WORKSPACE_PATH / RONDO_WORKSPACE_BRANCH，已存在的键一律保留。
        rondo_command = [sys.executable, str(rondo_script), name]
        if dry_run:
            rondo_command.append("--dry-run")
        steps.append(("补齐 Agent Rondo 环境变量", None, rondo_command))
    if skip_repos:
        print("[SKIP] 供给 workspace 仓库注册表：按 --skip-repos 跳过", flush=True)
    else:
        # 只增不维护：注册表已存在的 URL 一律保留，不更新描述；仅补不存在的。
        repos_command = [sys.executable, str(repos_script), name]
        if dry_run:
            repos_command.append("--dry-run")
        steps.append(("供给 workspace 仓库注册表", None, repos_command))
    for index, (label, kind, command) in enumerate(steps, start=1):
        print(f"[{index}/{len(steps)}] {label}", flush=True)
        if kind == "bind":
            try:
                bind_agent_runtime(root, workspace_id, runtime_id, dry_run)
            except (subprocess.CalledProcessError, SystemExit) as exc:
                print(f"{label}失败：{exc}", file=sys.stderr)
                return 1
            continue
        try:
            subprocess.run(command, cwd=root, env=command_env(), check=True)
        except subprocess.CalledProcessError as exc:
            print(f"{label}失败（退出码 {exc.returncode}），已停止。", file=sys.stderr)
            return exc.returncode
        except OSError as exc:
            print(f"{label}无法执行：{exc}", file=sys.stderr)
            return 1
        except KeyboardInterrupt:
            print("\n同步已中断。", file=sys.stderr)
            return 130
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
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
        help="只同步 slug 以此前缀开头的 workspace（默认 winning-；传空字符串关闭筛选）",
    )
    parser.add_argument("--runtime-id", help="固定 runtime（缺省时沿用既有 Agent 绑定，无绑定时随机选）")
    parser.add_argument(
        "--discovery-timeout", type=float, default=120.0, metavar="秒",
        help="runtime skill 发现超时，默认 120 秒",
    )
    parser.add_argument(
        "--disable-runtime-skills", choices=("auto", "always", "never"), default="auto",
        help="禁用 runtime 继承的 Skill：auto 仅在 Agent 绑定本机 runtime 时执行；"
             "always 始终执行；never 从不执行",
    )
    parser.add_argument(
        "--skip-workflow", dest="skip_workflow", action="store_true", default=True,
        help="（默认）provision 时跳过 workflow 能力检查与状态供给，兼容不支持 workflow 的服务端",
    )
    parser.add_argument(
        "--with-workflow", dest="skip_workflow", action="store_false",
        help="恢复 workflow 能力检查与状态供给（仅服务端支持 workflow API 时使用）",
    )
    parser.add_argument(
        "--skip-tfs-env", action="store_true",
        help="跳过默认的 Agent TFS 环境变量补齐（TFS_URL / TFS_COLLECTION / TFS_PAT）",
    )
    parser.add_argument(
        "--skip-rondo-env", action="store_true",
        help="跳过默认的 Agent Rondo 环境变量补齐（RONDO_WORKSPACE_PATH / RONDO_WORKSPACE_BRANCH）",
    )
    parser.add_argument(
        "--skip-repos", action="store_true",
        help="跳过默认的 workspace 仓库注册表供给（只增不维护）",
    )
    parser.add_argument("--dry-run", action="store_true", help="只预演，不写平台与仓内 overlay")
    parser.add_argument("--repo-root", help="本次使用的仓库根目录；省略时从当前目录、脚本目录上溯")
    args = parser.parse_args()

    root = find_repo_root(repo_root=args.repo_root)
    # 上次运行若在分组 project 供给期间被杀，先从哨兵备份恢复共享 manifest。
    restore_manifest_if_needed(root, args.dry_run)
    disable_script = Path(__file__).resolve().parent / "disable_runtime_skills.py"
    if not disable_script.is_file():
        print(f"未找到脚本：{disable_script}", file=sys.stderr)
        return 1
    tfs_script = Path(__file__).resolve().parent / "provision_agent_tfs_env.py"
    if not args.skip_tfs_env and not tfs_script.is_file():
        print(f"未找到脚本：{tfs_script}", file=sys.stderr)
        return 1
    rondo_script = Path(__file__).resolve().parent / "provision_agent_rondo_env.py"
    if not args.skip_rondo_env and not rondo_script.is_file():
        print(f"未找到脚本：{rondo_script}", file=sys.stderr)
        return 1
    repos_script = Path(__file__).resolve().parent / "provision_workspace_repos.py"
    if not args.skip_repos and not repos_script.is_file():
        print(f"未找到脚本：{repos_script}", file=sys.stderr)
        return 1

    try:
        cli = resolve_cli(root)
        check_python()
        if args.workspaces:
            targets = [resolve_workspace(name, root) for name in args.workspaces]
        else:
            targets = discover_workspaces(root, args.member, args.prefix)
    except SystemExit as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    if not targets:
        print(f"没有匹配到 workspace（member={args.member}，prefix={args.prefix!r}）。", file=sys.stderr)
        return 2
    print(f"目标 workspace（{len(targets)} 个）：")
    for target in targets:
        role = f" [{target['role']}]" if target.get("role") else ""
        print(f"  - {target['slug']} ({target['id']}){role}")

    failures = 0
    for target in targets:
        name = target["slug"]
        workspace_id = target["id"]
        try:
            runtime_id, bound, stale = resolve_runtime(root, workspace_id, args.runtime_id)
        except SystemExit as exc:
            print(f"[FAIL] {name}: {exc}", file=sys.stderr)
            failures += 1
            continue
        for stale_id in stale:
            print(
                f"[WARN] {name}: Agent 绑定 runtime {stale_id} 已不在该 workspace；"
                "该绑定需改绑（--runtime-id）后才会生效",
                file=sys.stderr,
            )
        disable_allowed, disable_reason = should_disable_runtime_skills(root, workspace_id, bound)
        if args.disable_runtime_skills == "always":
            disable_allowed, disable_reason = True, ""
        elif args.disable_runtime_skills == "never":
            disable_allowed, disable_reason = False, "按 --disable-runtime-skills never 跳过"
        print(
            f"\n===== 同步 {name}（workspace {workspace_id}，runtime {runtime_id}"
            f"{'，dry-run' if args.dry_run else ''}）=====",
            flush=True,
        )
        code = sync_workspace(
            name, workspace_id, runtime_id, root, cli, disable_script, args.dry_run,
            rebind_runtime=bool(args.runtime_id), discovery_timeout=args.discovery_timeout,
            disable_runtime_skills=disable_allowed, disable_skip_reason=disable_reason,
            skip_workflow=args.skip_workflow,
            tfs_script=tfs_script, skip_tfs_env=args.skip_tfs_env,
            rondo_script=rondo_script, skip_rondo_env=args.skip_rondo_env,
            repos_script=repos_script, skip_repos=args.skip_repos,
        )
        if code:
            failures += 1

    print(f"\nMultica 同步完成。失败 workspace 数：{failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
