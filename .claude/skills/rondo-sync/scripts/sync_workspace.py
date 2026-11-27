#!/usr/bin/env python3
"""把仓内 Multica 资产同步到目标 workspace。

默认目标：成员包含 admin、且 slug 以 winning- 开头的全部 workspace。
也可显式给出 workspace 名称覆盖发现结果。

流水线（每步失败即停止该 workspace，其余 workspace 继续）：
  0. install   —— 打包本仓 rondo、全局安装、安装 OpenSpec Schema，并删除 Windows 的 rondo.ps1 shim
                  （全局步骤，先于所有 workspace 执行；--dry-run 时只预演）
  1. provision —— 供给 Skill / Agent / Squad / Project / Autopilot 对象
                  （Rondo 按 workspace slug 在内存中合并 Project / MCP 分组配置）
  2. sync      —— 渲染仓库映射配置并 upsert Skill 文件
  3. disable   —— 关闭 Agent 继承自 runtime 的本地 Skill
  4. tfs-env   —— 为 Agent 补齐 TFS_URL / TFS_COLLECTION / TFS_PAT（只增不改）
  5. repos     —— 供给 workspace 级仓库注册表（只增不维护：已存在的 URL 不改动；
                  按 workspace_groups 分组解析，组 workspace_repos 覆盖顶层默认）
  6. labels    —— 按 docs/config/project-resources.yaml 对齐 Project Resource 的 label
                  （URL 精确匹配，全量对齐，不增不删 Resource）

用法：
  python sync_workspace.py                      # 发现 admin 的全部 winning-* workspace
  python sync_workspace.py winning-lfw          # 只同步指定 workspace
  python sync_workspace.py --member ydx --prefix winning-
  python sync_workspace.py --runtime-id <uuid>
  python sync_workspace.py --with-workflow      # 服务端支持 workflow API 时恢复检查与状态供给
  python sync_workspace.py --skip-tfs-env       # 跳过默认的 TFS 环境变量补齐
  python sync_workspace.py --skip-repos         # 跳过默认的 workspace 仓库注册表供给
  python sync_workspace.py --skip-resource-labels  # 跳过默认的 Project Resource label 对齐
  python sync_workspace.py --dry-run

前置步骤默认执行：npm pack → npm install -g → rondo openspec install-schema → 删除全局 rondo.ps1（Windows）。
只写目标 Multica workspace 与仓内 overlay 文件；不回滚已完成的步骤。
"""

from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import subprocess
import sys
from pathlib import Path

import encoding_bootstrap  # noqa: F401  # 先于任何输出完成 UTF-8 自举
from workspace_paths import command_env, find_repo_root

# provision / sync / disable 都由这三条外部命令承担，本脚本只编排。
# CLI 名称：rondo 为当前主入口，skill-flow 为其前身（命令兼容，未退役前仍可用）。
CLI_CANDIDATES = ("rondo", "skill-flow")
CLI_LOCAL_FALLBACKS = (
    Path("rondo") / "dist" / "index.js",
)
MIN_PYTHON = (3, 7)

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


def resolve_command(command: list[str]) -> list[str]:
    """Windows 下 CLI 常以 .cmd/.ps1 shim 存在，CreateProcess 只按 .EXE 解析裸命令名，
    这里按 PATHEXT（shutil.which）把首个元素解析为完整可执行路径；找不到时保持原样，
    兼容 .exe 直装的命令与非 Windows 环境。"""
    if os.name != "nt" or not command:
        return command
    resolved = shutil.which(command[0])
    if resolved:
        return [resolved, *command[1:]]
    return command


def run_json(command: list[str], cwd: Path) -> object:
    result = subprocess.run(
        resolve_command(command), cwd=cwd, env=command_env(), check=True, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
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


def run_text(command: list[str], cwd: Path) -> str:
    """执行输出为普通文本的命令，返回 strip 后的 stdout。"""
    result = subprocess.run(
        resolve_command(command), cwd=cwd, env=command_env(), check=True, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return result.stdout.decode("utf-8").strip()


def install_rondo_cli(root: Path, dry_run: bool = False) -> None:
    """同步前重新打包 rondo、全局安装、安装 OpenSpec Schema，并清理 Windows 下的 rondo.ps1 shim。

    --dry-run 只打印计划，不写全局环境；失败时抛 SystemExit，由 main 统一报告。
    """
    rondo_dir = root / "rondo"
    if not (rondo_dir / "package.json").is_file():
        raise SystemExit(f"未找到 {rondo_dir / 'package.json'}，无法打包 rondo")
    if dry_run:
        print("[DRY-RUN] 跳过 rondo 打包、全局安装、OpenSpec Schema 安装与 rondo.ps1 清理")
        return
    try:
        pack_output = run_text(["npm", "pack", "--silent"], rondo_dir)
        tarball = pack_output.splitlines()[-1].strip() if pack_output else ""
        if not tarball:
            raise SystemExit("npm pack 未返回 tarball 文件名")
        print(f"[OK] 打包 rondo：{tarball}")
        run_text(["npm", "install", "-g", str(rondo_dir / tarball)], rondo_dir)
        print("[OK] 全局安装 rondo")
        run_text(["rondo", "openspec", "install-schema"], rondo_dir)
        print("[OK] 安装 OpenSpec Schema")
        if os.name == "nt":
            prefix = run_text(["npm", "prefix", "-g"], rondo_dir)
            ps1 = Path(prefix) / "rondo.ps1"
            if ps1.is_file():
                ps1.unlink()
                print(f"[OK] 删除 {ps1}")
            else:
                print(f"[SKIP] 删除 {ps1}：文件不存在")
    except (OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f"rondo 打包/全局安装/OpenSpec Schema 安装失败：{exc}") from exc


def check_python() -> None:
    """检查当前解释器及资源配置脚本依赖。"""
    major, minor = sys.version_info[:2]
    if (major, minor) < MIN_PYTHON:
        raise SystemExit(
            f"python {major}.{minor} 过低：rondo-sync 需要 ≥{MIN_PYTHON[0]}.{MIN_PYTHON[1]}。"
        )
    try:
        import yaml  # noqa: F401  # 资源配置脚本使用 PyYAML
    except ImportError as exc:
        raise SystemExit(
            f'当前 Python 缺少可用的 PyYAML。请用同一个解释器执行 "{sys.executable}" -m pip install PyYAML。'
        ) from exc


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


def should_disable_runtime_skills(
    root: Path, workspace_id: str, bound_runtime_ids: list[str],
) -> tuple[bool, str]:
    """判断是否执行"禁用 runtime skills"。

    只要 Agent 绑定了 workspace 内仍存在的 runtime 就执行，不区分本机与同事机器：
    Runtime 本地 Skill 会与仓内供给的 Skill 重复暴露，统一在 Agent 侧禁用。
    失效绑定由 disable_runtime_skills.py 自行跳过，不阻断其他 Agent。
    """
    if not bound_runtime_ids:
        return False, "没有 Agent 绑定 runtime，跳过禁用"
    known = {str(r.get("id")) for r in list_runtimes(root, workspace_id)}
    if not any(runtime_id in known for runtime_id in bound_runtime_ids):
        return False, "Agent 绑定的 runtime 均已不在该 workspace，跳过禁用"
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
    repos_script: Path,
    skip_repos: bool,
    labels_script: Path,
    skip_resource_labels: bool,
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
        # 有 Agent 绑定 workspace 内 runtime 时统一禁用，包括同事机器上的 runtime。
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
    if skip_repos:
        print("[SKIP] 供给 workspace 仓库注册表：按 --skip-repos 跳过", flush=True)
    else:
        # 只增不维护：注册表已存在的 URL 一律保留，不更新描述；仅补不存在的。
        repos_command = [sys.executable, str(repos_script), name]
        if dry_run:
            repos_command.append("--dry-run")
        steps.append(("供给 workspace 仓库注册表", None, repos_command))
    if skip_resource_labels:
        print("[SKIP] 对齐 Project Resource label：按 --skip-resource-labels 跳过", flush=True)
    else:
        # 全量对齐 YAML label：URL 精确匹配，不新增/删除 Resource，写入后回读。
        labels_command = [sys.executable, str(labels_script), name]
        if dry_run:
            labels_command.append("--dry-run")
        steps.append(("对齐 Project Resource label", None, labels_command))
    env = command_env()
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
            subprocess.run(command, cwd=root, env=env, check=True)
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
        help="禁用 runtime 继承的 Skill：auto 在 Agent 绑定了 workspace 内 runtime 时执行"
             "（含同事机器的 runtime）；always 无条件执行；never 从不执行",
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
        "--skip-repos", action="store_true",
        help="跳过默认的 workspace 仓库注册表供给（只增不维护）",
    )
    parser.add_argument(
        "--skip-resource-labels", action="store_true",
        help="跳过默认的 Project Resource label 对齐（按 project-resources.yaml）",
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
    repos_script = Path(__file__).resolve().parent / "provision_workspace_repos.py"
    if not args.skip_repos and not repos_script.is_file():
        print(f"未找到脚本：{repos_script}", file=sys.stderr)
        return 1
    labels_script = Path(__file__).resolve().parent / "provision_project_resource_labels.py"
    if not args.skip_resource_labels and not labels_script.is_file():
        print(f"未找到脚本：{labels_script}", file=sys.stderr)
        return 1

    try:
        install_rondo_cli(root, args.dry_run)
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
            repos_script=repos_script, skip_repos=args.skip_repos,
            labels_script=labels_script, skip_resource_labels=args.skip_resource_labels,
        )
        if code:
            failures += 1

    print(f"\nMultica 同步完成。失败 workspace 数：{failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
