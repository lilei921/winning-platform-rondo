#!/usr/bin/env python3
"""为目标 workspace 的 Agent 补给 TFS 环境变量（TFS_URL / TFS_COLLECTION / TFS_PAT）。

语义：
  - manifest agents[] 中 `tfs_env: false` 的 Agent（如 Vayne）不配置 TFS 三键；
    若同时声明 `runtime_policy_key`，只处理该 Runtime 策略键：workspace overlay 的
    `runtime_policy` 作为首次写入来源，平台已有策略一律保留不覆盖；缺失时输出
    [WARN] 提示由用户逐个提供主备 Runtime 并写入 overlay。
  - 只增不改：Agent custom_env 中 TFS 键一旦存在（无论值是什么，
    包括空字符串），即视为用户已配置，一律保留不改动；仅补不存在的键。
    三个键都存在的 Agent 直接跳过。
    （纠错场景用 --force-tfs-pat 仅强制重写 TFS_PAT，需明确意图。）
  - TFS_URL / TFS_COLLECTION 使用全局固定值（见下方常量）。
  - TFS_PAT 按 workspace 区分（按优先级）：
      * config/tfs-pat.yaml 的 pats 表中登记了 owner（winning-<owner>）
        的 workspace：下发该 owner 的真实 PAT。
      * winning-admin / winning-lilei（未在表中时兜底）：本机 git 全局
        配置中 tfs2018-web 的 extraheader（li_lei 的 PAT），
        **不是** multica 登录 token。
      * 其余 workspace：占位字面值 "not config"，表示 TFS 凭据未配置，
        由 workspace owner 自行填写，不下发真实 PAT。

红线：真实 PAT 只存在于内存与 stdin 管道，不打印、不进命令行参数；
落盘仅限本机 config/tfs-pat.yaml（chmod 600，不入库、不外发）。

用法：
  python provision_agent_tfs_env.py                    # 默认 winning-admin
  python provision_agent_tfs_env.py winning-lfw        # 指定 workspace slug
  python provision_agent_tfs_env.py --workspace-id <uuid>
  python provision_agent_tfs_env.py --force-tfs-pat winning-lbs   # 纠错：重写 TFS_PAT 为策略值
  python provision_agent_tfs_env.py --dry-run          # 只预演，不写
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys

import encoding_bootstrap  # noqa: F401  # 先于任何输出完成 UTF-8 自举
from cli_retry import run_cli
from pathlib import Path
from workspace_paths import MANIFEST_REL, find_repo_root

import yaml

DEFAULT_WORKSPACE_SLUG = "winning-admin"

# 全局固定值（与 rondo tfs/config.ts 的默认解析一致；TFS_URL 为 base，不含 collection）
TFS_URL = "http://tfs2018-web.winning.com.cn:8080/tfs"
TFS_COLLECTION = "WN_Data_Platform"
TFS_KEYS = ("TFS_URL", "TFS_COLLECTION", "TFS_PAT")

EXTRAHEADER_KEY = "http.http://tfs2018-web.winning.com.cn:8080/.extraheader"

# TFS_PAT 策略：优先按 config/tfs-pat.yaml 的 pats 表下发 owner 真实 PAT；
# 表中未登记且属于下列白名单时，回退本机 git extraheader（li_lei 的 PAT）；
# 其余 workspace 一律写占位值，由 owner 自行配置真实 PAT。
REAL_PAT_WORKSPACES = frozenset({"winning-admin", "winning-lilei"})
PLACEHOLDER_PAT = "not config"

# workspace slug -> PAT 表中的 owner 键：非 winning- 前缀的 workspace 无法从 slug 推导 owner，
# 显式登记其 owner；仅登记 owner 本人的 workspace（自己的机器 / 自有测试空间）。
PAT_WORKSPACE_ALIASES = {"rondo-test": "lilei"}

PAT_REGISTRY_PATH = Path(__file__).resolve().parent.parent / "config" / "tfs-pat.yaml"


def load_agent_env_rules(root: Path) -> tuple[set[str], dict[str, str]]:
    """按 manifest 解析环境变量规则：不用 TFS 的 Agent 与需要校验的 Runtime 策略键。"""
    manifest = json.loads((root / MANIFEST_REL).read_text(encoding="utf-8"))
    agents = manifest.get("agents") or []
    no_tfs = {a["name"] for a in agents if a.get("tfs_env") is False and a.get("name")}
    policy_keys = {
        a["name"]: a["runtime_policy_key"]
        for a in agents if a.get("runtime_policy_key") and a.get("name")
    }
    return no_tfs, policy_keys


def load_overlay_runtime_policy(root: Path, slug: str) -> dict:
    """读取 workspace overlay 保存的首次 Runtime 策略；文件缺失或为空返回 {}。"""
    path = root / "workspace-config" / "workspaces" / f"{slug}.json"
    if not path.is_file():
        return {}
    overlay = json.loads(path.read_text(encoding="utf-8"))
    policy = overlay.get("runtime_policy")
    return policy if isinstance(policy, dict) else {}


def list_workspace_runtimes(ws_id: str) -> dict[str, str]:
    """取 workspace 内 runtime id -> name，用于校验 overlay 策略的主备绑定。"""
    out = run_read(["multica", "runtime", "list", "--workspace-id", ws_id, "--output", "json"])
    if out.returncode != 0:
        raise SystemExit(f"runtime list 失败: {out.stderr.strip()[:200]}")
    items = json.loads(out.stdout)
    return {r["id"]: r.get("name") for r in items if r.get("id")}


def validate_runtime_policy(policy: dict, runtimes: dict[str, str], excluded: set[str]) -> list[str]:
    """首次写入前校验：主备 ID 属于 workspace 且不同，附带的名称与 ID 匹配；Vayne 自身不纳入策略。"""
    problems = []
    for name, cfg in policy.items():
        if name in excluded:
            problems.append(f"{name}: 不纳入策略")
            continue
        if not isinstance(cfg, dict):
            problems.append(f"{name}: 配置不是对象")
            continue
        primary, fallback = cfg.get("primary_runtime_id"), cfg.get("fallback_runtime_id")
        if not primary or not fallback:
            problems.append(f"{name}: 缺少主备 Runtime ID")
        elif primary == fallback:
            problems.append(f"{name}: 主备 Runtime ID 相同")
        elif primary not in runtimes or fallback not in runtimes:
            problems.append(f"{name}: Runtime ID 不属于该 workspace")
        else:
            for id_key, name_key in (("primary_runtime_id", "primary_runtime_name"),
                                     ("fallback_runtime_id", "fallback_runtime_name")):
                expected = cfg.get(name_key)
                if expected is not None and expected != runtimes[cfg[id_key]]:
                    problems.append(f"{name}: {name_key} 与 Runtime ID 不匹配")
    return problems


def run(args: list[str], stdin_text: str | None = None) -> subprocess.CompletedProcess:
    """执行 multica 写命令；写命令不自动重试（可能已在服务端落地）。"""
    return run_cli(args, stdin_text=stdin_text)


def run_read(args: list[str]) -> subprocess.CompletedProcess:
    """执行 multica 只读命令；传输层故障自动重试。"""
    return run_cli(args, transient=True)


def extract_pat() -> str:
    """从 git 全局 extraheader 解出 TFS PAT（li_lei 的），不使用 multica 登录 token。"""
    out = run(["git", "config", "--global", "--get", EXTRAHEADER_KEY])
    if out.returncode != 0 or not out.stdout.strip():
        raise SystemExit(
            f"未能从 git 全局配置读取 {EXTRAHEADER_KEY}；"
            "请先配置 TFS git 凭据（extraheader 或改用 --pat-env 指定环境变量来源）"
        )
    raw = out.stdout.strip()
    prefix = "Authorization: Basic "
    if not raw.startswith(prefix):
        raise SystemExit("extraheader 格式异常（期望 'Authorization: Basic ...'）")
    decoded = base64.b64decode(raw[len(prefix):]).decode()
    if ":" not in decoded:
        raise SystemExit("extraheader 解码后缺少 user:PAT 结构")
    _, pat = decoded.split(":", 1)
    if not pat:
        raise SystemExit("extraheader 中未解析到 PAT")
    return pat


def load_pat_registry() -> dict[str, str]:
    """读取 config/tfs-pat.yaml 的 pats 表（owner slug -> PAT）；文件缺失时返回空表。"""
    if not PAT_REGISTRY_PATH.exists():
        return {}
    data = yaml.safe_load(PAT_REGISTRY_PATH.read_text(encoding="utf-8")) or {}
    return {str(k): str(v) for k, v in (data.get("pats") or {}).items() if v}


def resolve_pat(ws_slug: str) -> tuple[str, str]:
    """按 workspace slug 决定 (pat, 策略说明)；不打印 pat 本身。"""
    registry = load_pat_registry()
    owner = PAT_WORKSPACE_ALIASES.get(ws_slug) or (
        ws_slug[len("winning-"):] if ws_slug.startswith("winning-") else ws_slug
    )
    if owner in registry:
        return registry[owner], f"real(registry:{owner})"
    if ws_slug in REAL_PAT_WORKSPACES:
        return extract_pat(), "real(git-extraheader)"
    return PLACEHOLDER_PAT, "placeholder"


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
    parser = argparse.ArgumentParser(description="为 workspace Agent 补齐 TFS 环境变量（只增不改）")
    parser.add_argument("workspace", nargs="?", default=DEFAULT_WORKSPACE_SLUG,
                        help=f"workspace slug / name / id，默认 {DEFAULT_WORKSPACE_SLUG}")
    parser.add_argument("--workspace-id", help="显式 workspace id（优先于位置参数）")
    parser.add_argument("--force-tfs-pat", action="store_true",
                        help="纠错用：即使 TFS_PAT 已存在也按策略重写（只影响 TFS_PAT）")
    parser.add_argument("--dry-run", action="store_true", help="只预演，不写")
    args = parser.parse_args()

    ws_id, ws_slug = resolve_workspace_id(args.workspace_id or args.workspace)
    print(f"目标 workspace: {ws_slug} ({ws_id})")
    root = find_repo_root()
    no_tfs_agents, policy_keys = load_agent_env_rules(root)
    # overlay 的 runtime_policy 是首次写入来源；平台已有策略一律保留，不覆盖。
    overlay_policy = load_overlay_runtime_policy(root, ws_slug)

    # TFS_PAT 策略：registry 登记的 owner 用其真实 PAT，
    # 白名单回退本机 git extraheader，其余用占位值
    pat, pat_kind = resolve_pat(ws_slug)
    print(f"TFS_PAT 策略: {pat_kind}")
    inject = {"TFS_URL": TFS_URL, "TFS_COLLECTION": TFS_COLLECTION, "TFS_PAT": pat}

    out = run_read(["multica", "agent", "list", "--workspace-id", ws_id, "--output", "json"])
    if out.returncode != 0:
        raise SystemExit(f"agent list 失败: {out.stderr.strip()[:200]}")
    agents = json.loads(out.stdout)
    print(f"agent 数: {len(agents)}")

    skipped, excluded, updated, failed = [], [], [], []
    policy_ok, policy_written, policy_planned, policy_missing, policy_failed = [], [], [], [], []
    for a in agents:
        aid = a["id"]
        name = a.get("name", aid)

        g = run_read(["multica", "agent", "env", "get", aid,
                 "--workspace-id", ws_id, "--output", "json"])
        if g.returncode != 0:
            failed.append((name, f"env get: {g.stderr.strip()[:120]}"))
            continue
        current = json.loads(g.stdout).get("custom_env") or {}

        # manifest 声明不用 TFS 的 Agent：不写 TFS 键，只处理 Runtime 策略键。
        if name in no_tfs_agents:
            excluded.append(name)
            key = policy_keys.get(name)
            if not key:
                continue
            if key in current:
                policy_ok.append((name, key))
                continue
            if not overlay_policy:
                policy_missing.append((name, key))
                continue
            problems = validate_runtime_policy(
                overlay_policy, list_workspace_runtimes(ws_id), no_tfs_agents)
            if problems:
                policy_failed.append((name, problems))
                continue
            value = json.dumps(overlay_policy, ensure_ascii=False, separators=(",", ":"))
            if args.dry_run:
                policy_planned.append((name, key))
                continue
            s = run(["multica", "agent", "env", "set", aid,
                     "--workspace-id", ws_id, "--custom-env-stdin"],
                    stdin_text=json.dumps({**current, key: value}, ensure_ascii=False))
            if s.returncode != 0:
                policy_failed.append((name, [f"env set: {s.stderr.strip()[:120]}"]))
                continue
            v = run_read(["multica", "agent", "env", "get", aid,
                          "--workspace-id", ws_id, "--output", "json"])
            got = json.loads(v.stdout).get("custom_env") or {}
            if got.get(key) != value:
                policy_failed.append((name, ["策略键回读不一致"]))
            else:
                policy_written.append((name, key))
            continue

        # 只增不改：键存在即视为用户已配置（含空字符串），一律保留；
        # 仅补不存在的键。--force-tfs-pat 时 TFS_PAT 例外，按策略重写（纠错用）
        missing = [k for k in TFS_KEYS if k not in current]
        forced = args.force_tfs_pat and current.get("TFS_PAT") != inject["TFS_PAT"]
        if not missing and not forced:
            skipped.append(name)
            continue
        changed = list(missing)
        if forced and "TFS_PAT" not in changed:
            changed.append("TFS_PAT")
        if args.dry_run:
            updated.append((name, changed, True))
            continue

        merged = {**inject, **current}  # current 在后：既有键（含既有 TFS 键）优先
        if args.force_tfs_pat:
            merged["TFS_PAT"] = inject["TFS_PAT"]
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
        bad = [k for k in changed if env.get(k) != inject[k]]
        if bad:
            failed.append((name, f"回读不一致: {bad}"))
        else:
            updated.append((name, changed, False))

    for name in skipped:
        print(f"  [SKIP] {name} | TFS 三键已配置，不改动")
    for name in excluded:
        print(f"  [SKIP] {name} | manifest 声明不配置 TFS 三键")
    for name, missing, dry in updated:
        tag = "[DRY ]" if dry else "[OK  ]"
        print(f"  {tag} {name} | 补齐 {missing}")
    for name, err in failed:
        print(f"  [FAIL] {name} | {err}")
    for name, key in policy_ok:
        print(f"  [SKIP] {name} | {key} 已配置，不覆盖")
    for name, key in policy_planned:
        print(f"  [DRY ] {name} | 预演写入 {key}（来源：workspace overlay）")
    for name, key in policy_written:
        print(f"  [OK  ] {name} | 首次写入 {key}（来源：workspace overlay）")
    for name, err in policy_failed:
        print(f"  [FAIL] {name} | 策略写入失败：{'; '.join(err)}")
    for name, key in policy_missing:
        print(f"  [WARN] {name} 未配置 {key}；由用户逐个提供主备 Runtime 后写入 workspace overlay")
    print(f"跳过 {len(skipped) + len(excluded)}，{'预演补齐' if args.dry_run else '已补齐'} {len(updated)}，失败 {len(failed) + len(policy_failed)}，策略缺失 {len(policy_missing)}")
    sys.exit(1 if failed or policy_failed else 0)


if __name__ == "__main__":
    main()
