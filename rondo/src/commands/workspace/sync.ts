/**
 * workspace sync — Skill 资产工作区无关化的渲染 + 平台同步（方案：projects/multica/archive/docs-2026-10-26/workspace-skill-portability-plan.md §3.4，历史溯源）。
 *
 * （rondo 收编：实现位置为 @winning/skill-flow 包内 commands/workspace/sync.ts，
 * 原 projects/multica/scripts/sync-workspace.ts 在迁移窗口期保持有效。）
 *
 * 职责：repo-context.yaml（仓库身份/路径）+ base（runtime + delivery）+ workspaces/<name>.json overlay
 *   → 渲染 8 份 repo-registry + 1 份 sync-config（本地运行与平台 upsert 同源）
 *   → 对 overlay.skills 已登记的 Skill 执行 skill update（SKILL.md）+ files upsert（全量）
 *   → reconcile：平台多出而仓内不存在的文件 files delete（仓内为准，列明 deleted_remote）
 *   → 回读校验：content_hash 逐文件比对，不一致 → exit 3。
 *
 * 用法：
 *   rondo workspace sync --workspace <name> [--skill <name>] [--local-only] [--profile <name>] [--dry-run] [--check]
 *   --profile     multica 配置 profile（云端/97 等多环境；追加到全部 multica 调用，缺省走 CLI 默认 profile）
 *   --local-only  只渲染写本地，不动平台（本地运行就绪）
 *   --dry-run     不写盘不动平台，diff 走 stderr，stdout 仍只出 JSON 摘要
 *   --check       纯检测模式（方案：archive/docs-2026-10-26/workspace-provisioning-plan.md §1.3，历史溯源）：零写入，回读比对
 *                 平台实际状态（SKILL.md content_hash + 逐文件 hash），有漂移 → exit 2 列明
 *
 * 退出码：0 PASS / 2 漂移（--check）/ 3 UNKNOWN（缺文件/缺字段/命令失败/回读不符）/ 64 用法错误。
 * stdout 只出 JSON；日志走 stderr。
 *
 * 运行环境：Node ≥ 23.6 直跑（22.6+ 需 --experimental-strip-types）；只用可擦除类型注解；零 npm 依赖。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { runCommand, runJson, runJsonStdin } from "../../clients/spawn.js";
import { bindEnvironment, multicaPrefix, type MulticaEnvironment } from "../../clients/multica-environment.js";
import { resolveMulticaRoot } from "../../clients/repo-root.js";
import { commandExists } from "../../clients/which.js";
import { readSkillContent } from "./skill-content.js";
import { validateSkillReferences } from "./skill-refs.js";

// 根定位见 clients/repo-root.ts（npm pack 全局安装后不能按包内位置回推）。
// 模块级可变绑定由 main() 开头的 initRoots() 填充，helper 函数引用。
let REPO_ROOT = "";
let MONOREPO_ROOT = "";
let CONFIG_ROOT = "";
let SKILLS_ROOT = "";
function initRoots(): void {
  const r = resolveMulticaRoot();
  REPO_ROOT = r.multicaRoot;
  MONOREPO_ROOT = r.monorepoRoot;
  CONFIG_ROOT = join(REPO_ROOT, "workspace-config");
  SKILLS_ROOT = join(REPO_ROOT, "skills");
}

/** 消费 repo-registry.json 的 Skill；仅渲染本次同步范围内的配置。 */
const REPO_REGISTRY_SKILLS = ["bug-delivery", "delivery-flow", "development-execution", "pull-request", "issue-closeout", "pr-status-sync", "workitem-analysis", "analysis-completion", "spec-preparation", "change-development", "change-handoff", "workspace-preparation"];
/** 消费 sync-config.json 的 Skill（渲染目标 ×1） */
const TFS_SYNC_SKILL = "tfs-sync";

interface Overlay extends MulticaEnvironment {
  provisioning_required?: string[];
  workspace_id?: string;
  delivery_squad_id?: string;
  project?: string;
  skills?: Record<string, string>;
}

function log(msg: string): void { process.stderr.write(msg + "\n"); }

function readJson(path: string, what: string): any {
  if (!existsSync(path)) throw new UnknownError(`${what} 不存在: ${path}`);
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (exc) { throw new UnknownError(`${what} 不是合法 JSON (${path}): ${exc}`); }
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// --- 渲染 ---

interface RenderTarget { skill: string; relPath: string; content: string; }

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, what: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new UnknownError(`${what} 必须是非空字符串`);
  return value;
}

/** repo-context + delivery overlay 的单向投影；仓库身份、路径和 TFS 归属不在 base 双写。 */
function renderRegistry(base: any): Record<string, Record<string, string>> {
  const contextPath = join(MONOREPO_ROOT, "docs", "config", "repo-context.yaml");
  const toolPath = join(MONOREPO_ROOT, "tools", "repo_registry.py");
  if (!existsSync(contextPath)) throw new UnknownError(`仓库映射事实源不存在: ${contextPath}`);
  if (!existsSync(toolPath)) throw new UnknownError(`仓库映射只读查询工具不存在: ${toolPath}`);
  // Skill 入口传入已预检的解释器；直接运行 Rondo 时按平台查找。
  const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  const python = process.env.RONDO_WORKSPACE_PYTHON?.trim() || candidates.find(commandExists);
  if (!python) throw new UnknownError("未找到 Python 解释器（python / python3 均不在 PATH）");
  const cp = runCommand(
    [python, toolPath, "--workspace", MONOREPO_ROOT, "list"],
    MONOREPO_ROOT,
    { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  );
  if (cp.status !== 0) {
    throw new UnknownError(`读取 repo-context 失败 rc=${cp.status}: ${cp.stderr.trim() || cp.stdout.trim()}`);
  }
  let context: any;
  try { context = JSON.parse(cp.stdout); }
  catch (exc) { throw new UnknownError(`repo-context 查询输出不是合法 JSON: ${exc}`); }
  if (context.contract_version !== "repo-registry-result/v1" || context.operation !== "list"
    || context.status !== "ok" || !Array.isArray(context.repos)
    || (Array.isArray(context.errors) && context.errors.length > 0)) {
    throw new UnknownError("repo-context 查询结果契约不符（须为 repo-registry-result/v1、list、status=ok 且 errors 为空）");
  }

  const seenIds = new Set<string>();
  const seenPaths = new Map<string, string>();
  const repos = new Map<string, { repo_path: string; repo_url?: string; tfs_project?: string }>();
  context.repos.forEach((raw: unknown, index: number) => {
    if (!isRecord(raw)) throw new UnknownError(`repo-context repos[${index}] 不是对象`);
    const repoId = requiredString(raw.repo_id, `repo-context repos[${index}].repo_id`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repoId) || repoId === "." || repoId === "..") {
      throw new UnknownError(`repo-context repo_id 含非法路径/身份字符: ${repoId}`);
    }
    if (seenIds.has(repoId)) throw new UnknownError(`repo-context 存在重复 repo_id: ${repoId}`);
    seenIds.add(repoId);
    const repoType = requiredString(raw.repo_type, `repo-context ${repoId}.repo_type`);
    const repoPath = requiredString(raw.repo_path, `repo-context ${repoId}.repo_path`);
    requiredString(raw.responsibility, `repo-context ${repoId}.responsibility`);
    for (const field of ["keywords", "not_responsible_for"]) {
      if (!Array.isArray(raw[field]) || raw[field].some((v: unknown) => typeof v !== "string")) {
        throw new UnknownError(`repo-context ${repoId}.${field} 必须是字符串数组`);
      }
    }
    if (raw.tfs_project !== undefined && raw.tfs_project !== null) {
      requiredString(raw.tfs_project, `repo-context ${repoId}.tfs_project`);
    }
    if (repoType === "root-workspace") return;
    if (repoPath === "." || repoPath === ".." || repoPath.trim() !== repoPath
      || isAbsolute(repoPath) || /[<>:"/\\|?*\0]/.test(repoPath)) {
      throw new UnknownError(`repo-context ${repoId}.repo_path 必须是根仓内的直接子目录名: ${repoPath}`);
    }
    const normalizedPath = repoPath.toLowerCase();
    const pathOwner = seenPaths.get(normalizedPath);
    if (pathOwner) throw new UnknownError(`repo-context repo_path 重复: ${pathOwner} 与 ${repoId} 均指向 ${repoPath}`);
    seenPaths.set(normalizedPath, repoId);
    repos.set(repoId, {
      repo_path: repoPath,
      ...(raw.repo_url ? { repo_url: requiredString(raw.repo_url, `repo-context ${repoId}.repo_url`) } : {}),
      ...(raw.tfs_project ? { tfs_project: raw.tfs_project } : {}),
    });
  });
  if (repos.size === 0) throw new UnknownError("repo-context 未登记任何非 root 仓库");

  const delivery = base.delivery ?? {};
  if (!isRecord(delivery)) throw new UnknownError("repo-registry base.delivery 必须是对象");
  for (const [repoId, raw] of Object.entries(delivery)) {
    if (!repos.has(repoId)) {
      throw new UnknownError(`delivery overlay 含 repo-context 不存在的仓库键: ${repoId}（拒绝陈旧 repo_key）`);
    }
    if (!isRecord(raw)) throw new UnknownError(`delivery overlay ${repoId} 必须是对象`);
    for (const key of Object.keys(raw)) {
      if (key !== "tfs_repo" && key !== "default_target_branch") {
        throw new UnknownError(`delivery overlay ${repoId}.${key} 不允许覆盖 repo-context 字段或引入未登记配置`);
      }
    }
    for (const key of ["tfs_repo", "default_target_branch"]) {
      if (raw[key] !== undefined) requiredString(raw[key], `delivery overlay ${repoId}.${key}`);
    }
  }

  const registry: Record<string, Record<string, string>> = {};
  for (const repoId of [...repos.keys()].sort()) {
    const repo = repos.get(repoId)!;
    const overlay = delivery[repoId] ?? {};
    registry[repoId] = {
      repo_path: repo.repo_path,
      ...(repo.repo_url ? { repo_url: repo.repo_url } : {}),
      ...(overlay.tfs_repo ? { tfs_repo: overlay.tfs_repo } : {}),
      ...(repo.tfs_project ? { tfs_project: repo.tfs_project } : {}),
      ...(overlay.default_target_branch ? { default_target_branch: overlay.default_target_branch } : {}),
    };
  }
  return registry;
}

function renderConfigs(overlay: Overlay, scope: Set<string>): RenderTarget[] {
  if (!overlay.workspace_id) throw new UnknownError("overlay 缺少 workspace_id");
  const targets: RenderTarget[] = [];

  const needRegistry = REPO_REGISTRY_SKILLS.some((s) => scope.has(s));
  if (needRegistry) {
    if (!overlay.delivery_squad_id) {
      throw new UnknownError("overlay 缺少 delivery_squad_id（repo-registry 渲染必需； Squad 未建时先只同步其他 Skill）");
    }
    const base = readJson(join(CONFIG_ROOT, "repo-registry.base.json"), "repo-registry base");
    requiredString(base.runtime?.multica_cli, "repo-registry base.runtime.multica_cli");
    const registry = renderRegistry(base);
    // 显式构造键序，保证渲染产物字节稳定（MG-1 与存量逐字节比对依赖键序）
    // rondo：base 省略时默认 "rondo"（PATH 解析；非标准安装配置绝对路径）。
    // rondo 合并后 tfs_cli / skill_flow 两键退场，统一为 rondo（TFS 调用进程内化）。
    const rondo = typeof base.runtime?.rondo === "string" && base.runtime.rondo.trim()
      ? base.runtime.rondo : "rondo";
    const merged = {
      runtime: {
        multica_cli: base.runtime.multica_cli,
        ...(overlay.multica_profile ? { multica_profile: overlay.multica_profile } : {}),
        ...(overlay.multica_server_url ? { multica_server_url: overlay.multica_server_url } : {}),
        workspace_id: overlay.workspace_id,
        rondo,
        delivery_squad_id: overlay.delivery_squad_id,
      },
      // 机器路径已全部退场：根仓路径运行时解析；registry 是 repo-context + delivery overlay 的渲染投影。
      registry,
    };
    const content = JSON.stringify(merged, null, 2) + "\n";
    for (const skill of REPO_REGISTRY_SKILLS) {
      if (scope.has(skill)) targets.push({ skill, relPath: "config/repo-registry.json", content });
    }
  }

  if (scope.has(TFS_SYNC_SKILL)) {
    if (!overlay.project) {
      throw new UnknownError("overlay 缺少 project（tfs-sync 的 sync-config 渲染必需；项目未建时先跳过 tfs-sync）");
    }
    const base = readJson(join(CONFIG_ROOT, "sync-config.base.json"), "sync-config base");
    const merged = {
      tfs: base.tfs,
      multica: {
        cli: base.multica?.cli,
        ...(overlay.multica_profile ? { multica_profile: overlay.multica_profile } : {}),
        ...(overlay.multica_server_url ? { multica_server_url: overlay.multica_server_url } : {}),
        workspace_id: overlay.workspace_id,
        project: overlay.project,
        intake_agent: base.multica?.intake_agent,
        initial_status: base.multica?.initial_status,
        cli_note: base.multica?.cli_note,
      },
      sync: base.sync,
    };
    targets.push({ skill: TFS_SYNC_SKILL, relPath: "config/sync-config.json", content: JSON.stringify(merged, null, 2) + "\n" });
  }
  return targets;
}

/** 仓内 Skill 清单：skills/ 下排除 _shared 的目录；SKILL.md = content，其余文件全量 = skill files */
function listSkillFiles(skill: string): string[] {
  const dir = join(SKILLS_ROOT, skill);
  if (!existsSync(dir)) throw new UnknownError(`Skill 目录不存在: ${dir}`);
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.filter((p) => p !== "SKILL.md");
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { out[key] = next; i++; }
      else out[key] = true;
    }
  }
  return out;
}

function main(rawArgs: string[]): number {
  const args = parseArgs(rawArgs);
  if (typeof args.workspace !== "string" || !args.workspace) {
    process.stderr.write(
      "用法: rondo workspace sync --workspace <name> [--skill <name>] [--local-only] [--profile <name>] [--dry-run]\n",
    );
    return 64;
  }
  const localOnly = args["local-only"] === true;
  const dryRun = args["dry-run"] === true;
  // --profile：multica 配置 profile（云端/97 等多环境，自带 server_url+token）；缺省走 CLI 默认 profile
  let MC: string[] = [];
  const checkMode = args.check === true;
  const noWrite = dryRun || checkMode;

  try {
    initRoots();
    const overlayPath = join(CONFIG_ROOT, "workspaces", `${args.workspace}.json`);
    const overlay = readJson(overlayPath, `工作区 overlay ${args.workspace}`) as Overlay;

    if (overlay.provisioning_required?.length) {
      throw new UnknownError(`工作区需先 provision 补齐 Skills: ${overlay.provisioning_required.join(", ")}`);
    }
    if ((args.profile !== undefined || process.env.RONDO_MULTICA_PROFILE) && !overlay.multica_server_url) {
      throw new UnknownError("overlay 尚未绑定环境；请先用指定 profile 执行 workspace provision");
    }
    // 离线渲染保持零平台调用；显式 profile 必须先由 provision 绑定，避免产生跨环境配置。
    if (localOnly || dryRun) {
      if (args.profile !== undefined && args.profile !== overlay.multica_profile) {
        throw new UnknownError("离线同步的 profile 未绑定；请先为该环境执行 workspace provision");
      }
    } else {
      Object.assign(overlay, bindEnvironment(overlay, args.profile, prefix => {
        const cp = runCommand([...prefix, "config", "show"]);
        if (cp.status !== 0) throw new UnknownError("multica config show 失败");
        return process.env.MULTICA_SERVER_URL || /^server_url:\s*(\S+)$/m.exec(cp.stdout)?.[1] || "";
      }));
    }
    MC = multicaPrefix({ multica_cli: "multica", ...overlay });
    // 全量同步前发现旧 overlay 缺少受管 Skills 时停止；不能静默发布不完整的 Analyst。
    const manifestPath = join(CONFIG_ROOT, "provisioning.json");
    if (args.skill === undefined && existsSync(manifestPath)) {
      const managed = readJson(manifestPath, "provisioning manifest").managed_skills as string[];
      const missing = managed.filter(name => !overlay.skills?.[name]);
      if (missing.length) throw new UnknownError(`overlay 缺少受管 Skills: ${missing.join(", ")}；先运行 workspace provision`);
    }

    // 范围：overlay.skills 已登记的 Skill；--skill 进一步收窄
    const registered = Object.keys(overlay.skills ?? {});
    let scope = registered;
    if (typeof args.skill === "string") {
      if (!registered.includes(args.skill)) {
        throw new UnknownError(`Skill ${args.skill} 未在 overlay ${args.workspace} 的 skills 映射登记`);
      }
      scope = [args.skill];
    }
    const scopeSet = new Set(scope);

    if (!localOnly) {
      // M6 发布前闸（F6 防复发）：references 引用完整性——包内引用必须包内存在，
      // 跨包引用必须在 skillsRoot 存在；--dry-run 只报告不阻断，正式同步/检测列全量后阻断，local-only 保持仅渲染
      const refProblems = scope.flatMap((s) => validateSkillReferences(SKILLS_ROOT, s));
      if (refProblems.length > 0) {
        const report = refProblems.map((p) => `  ${p.skill}/${p.file} -> ${p.ref}（${p.kind}）`).join("\n");
        if (dryRun) log(`references 引用问题 ${refProblems.length} 处（dry-run 仅报告）:\n${report}`);
        else throw new UnknownError(`Skill references 引用缺页 ${refProblems.length} 处，阻断发布：\n${report}`);
      }
    }

    // --- 渲染 ---
    const rendered = renderConfigs(overlay, scopeSet);
    const renderedPaths: string[] = [];
    const renderedContent = new Map<string, string>(); // "skill/relPath" → 渲染内容（--check 比对用）
    const changes: Array<{ target: RenderTarget; abs: string; old: Buffer | null }> = [];
    for (const t of rendered) {
      const abs = join(SKILLS_ROOT, t.skill, t.relPath);
      renderedPaths.push(`${t.skill}/${t.relPath}`);
      renderedContent.set(`${t.skill}/${t.relPath}`, t.content);
      const old = existsSync(abs) ? readFileSync(abs) : null;
      if (old?.toString("utf8") === t.content) {
        log(`渲染 ${t.skill}/${t.relPath}: 无变化`);
        continue;
      }
      changes.push({ target: t, abs, old });
      if (noWrite) {
        log(`渲染 ${t.skill}/${t.relPath}: DIFF（旧 ${old === null ? "<不存在>" : old.length + " bytes"} → 新 ${Buffer.byteLength(t.content)} bytes）`);
      }
    }
    if (!noWrite && changes.length > 0) {
      const tempPaths: string[] = [];
      const committed: Array<{ abs: string; old: Buffer | null }> = [];
      try {
        // 先完成全部临时文件写入，再同目录原子替换；失败时恢复已替换文件，避免半套配置。
        changes.forEach((change, index) => {
          mkdirSync(dirname(change.abs), { recursive: true });
          const temp = `${change.abs}.sync-${process.pid}-${index}.tmp`;
          tempPaths.push(temp);
          writeFileSync(temp, change.target.content, "utf8");
        });
        changes.forEach((change, index) => {
          renameSync(tempPaths[index], change.abs);
          committed.push({ abs: change.abs, old: change.old });
          log(`渲染 ${change.target.skill}/${change.target.relPath}: 已写入（${change.target.content.length} chars）`);
        });
      } catch (exc) {
        const rollbackErrors: string[] = [];
        for (const temp of tempPaths) {
          try { rmSync(temp, { force: true }); } catch (rollback) { rollbackErrors.push(String(rollback)); }
        }
        for (const change of committed.reverse()) {
          try {
            if (change.old === null) rmSync(change.abs, { force: true });
            else writeFileSync(change.abs, change.old);
          } catch (rollback) { rollbackErrors.push(String(rollback)); }
        }
        throw new UnknownError(`本地渲染写入失败，已执行回滚: ${exc}${rollbackErrors.length ? `；回滚异常: ${rollbackErrors.join("；")}` : ""}`);
      }
    }

    const skippedUnregistered = readdirSync(SKILLS_ROOT)
      .filter((d) => statSync(join(SKILLS_ROOT, d)).isDirectory())
      .filter((d) => !registered.includes(d));

    if (localOnly || dryRun) {
      process.stdout.write(JSON.stringify({
        result: "PASS",
        workspace: args.workspace,
        mode: localOnly ? "local-only" : "dry-run",
        rendered: renderedPaths,
        skipped_unregistered: skippedUnregistered,
      }, null, 2) + "\n");
      return 0;
    }

    // --- 平台同步 / 检测 ---
    // 显式 workspace 纪律（红线 2）：skill 各子命令按 CLI 默认工作区解析，跨工作区必须显式带 --workspace-id
    const WS = ["--workspace-id", overlay.workspace_id as string];


    const synced: string[] = [];
    const deletedRemote: string[] = [];
    const mismatches: string[] = [];
    const drifts: string[] = [];
    const unchangedFiles: string[] = [];
    for (const skill of scope) {
      const skillId = (overlay.skills as Record<string, string>)[skill];
      const skillDir = join(SKILLS_ROOT, skill);
      const skillMd = join(skillDir, "SKILL.md");
      if (!existsSync(skillMd)) throw new UnknownError(`Skill ${skill} 缺 SKILL.md`);
      const skillContent = readSkillContent(skillMd);
      const skillMdHash = sha256(Buffer.from(skillContent, "utf8"));

      // 本地事实集：仓内文件 + 渲染产物覆盖（--check 时渲染产物可能未写盘，以内存内容为准）
      const paths = new Set(listSkillFiles(skill));
      for (const key of renderedContent.keys()) {
        if (key.startsWith(skill + "/")) paths.add(key.slice(skill.length + 1));
      }
      const localByPath = new Map<string, { content: string; hash: string; size: number }>();
      for (const rel of paths) {
        const content = renderedContent.get(`${skill}/${rel}`) ?? readSkillContent(join(skillDir, rel));
        const buf = Buffer.from(content, "utf8");
        localByPath.set(rel, { content, hash: sha256(buf), size: buf.length });
      }

      // 回读平台实际状态（回读式 diff 的唯一比对依据；SKILL.md 经 skill get 的 content_hash 比对）
      const getOut = runJson([...MC, "skill", "get", skillId, ...WS, "--output", "json"], `skill get ${skill}`, undefined, { transient: true }) as Record<string, any>;
      const preListOut = runJson([...MC, "skill", "files", "list", skillId, ...WS, "--output", "json"], `files list ${skill}`, undefined, { transient: true }) as any;
      const preRemote = (Array.isArray(preListOut) ? preListOut : preListOut.files ?? []) as Array<Record<string, any>>;
      const preByPath = new Map(preRemote.map((rf) => [rf.path, rf]));

      if (checkMode) {
        if (typeof getOut.content_hash === "string" && getOut.content_hash !== skillMdHash) {
          drifts.push(`${skill}/SKILL.md: 内容不符（平台 ${getOut.content_hash.slice(0, 12)}… != 仓内 ${skillMdHash.slice(0, 12)}…）`);
        }
        for (const [rel, f] of localByPath) {
          const rf = preByPath.get(rel);
          if (!rf) drifts.push(`${skill}/${rel}: 平台缺失（待 upsert）`);
          else if (typeof rf.content_hash === "string" && rf.content_hash !== f.hash) {
            drifts.push(`${skill}/${rel}: 内容不符（平台 ${rf.content_hash.slice(0, 12)}… != 仓内 ${f.hash.slice(0, 12)}…）`);
          }
        }
        for (const rf of preRemote) if (!localByPath.has(rf.path)) drifts.push(`${skill}/${rf.path}: 平台多余（待 delete）`);
        continue;
      }

      // hash 预比对：未变化跳过（provisioning 方案 §1.3；语义不变，末尾回读校验保留）
      if (typeof getOut.content_hash === "string" && getOut.content_hash === skillMdHash) {
        log(`${skill}/SKILL.md: 未变化，跳过 update`);
        unchangedFiles.push(`${skill}/SKILL.md`);
      } else {
        runJsonStdin([...MC, "skill", "update", skillId, ...WS, "--content-stdin", "--output", "json"], `skill update ${skill}`, skillContent);
      }
      for (const [rel, f] of localByPath) {
        const rf = preByPath.get(rel);
        if (rf && typeof rf.content_hash === "string" && rf.content_hash === f.hash) {
          log(`${skill}/${rel}: 未变化，跳过 upsert`);
          unchangedFiles.push(`${skill}/${rel}`);
          continue;
        }
        runJsonStdin(
          [...MC, "skill", "files", "upsert", skillId, ...WS, "--path", rel, "--content-stdin", "--output", "json"],
          `files upsert ${skill}/${rel}`, f.content,
        );
      }

      // reconcile + 回读校验（post list：以上写入后的平台实际状态）
      const listOut = runJson([...MC, "skill", "files", "list", skillId, ...WS, "--output", "json"], `files list ${skill}`, undefined, { transient: true }) as any;
      const remoteFiles = (Array.isArray(listOut) ? listOut : listOut.files ?? []) as Array<Record<string, any>>;
      for (const rf of remoteFiles) {
        const local = localByPath.get(rf.path);
        if (!local) {
          // files delete 无 --output flag（0.6.1 实测），按退出码判定
          const del = runCommand([...MC, "skill", "files", "delete", skillId, ...WS, rf.id]);
          if (del.status !== 0) {
            throw new UnknownError(`files delete ${skill}/${rf.path} 命令失败 rc=${del.status}: ${del.stderr.trim() || del.stdout.trim()}`);
          }
          deletedRemote.push(`${skill}/${rf.path}`);
        } else if (typeof rf.content_hash === "string" && rf.content_hash !== local.hash) {
          mismatches.push(`${skill}/${rf.path}: content_hash 不符（remote ${rf.content_hash.slice(0, 12)}… != local ${local.hash.slice(0, 12)}…）`);
        } else if (typeof rf.size === "number" && rf.size !== local.size) {
          mismatches.push(`${skill}/${rf.path}: size 不符（remote ${rf.size} != local ${local.size}）`);
        }
      }
      synced.push(skill);
    }

    if (checkMode) {
      process.stdout.write(JSON.stringify({
        result: drifts.length > 0 ? "DRIFT" : "PASS",
        workspace: args.workspace,
        mode: "check",
        checked: scope,
        drifts,
        skipped_unregistered: skippedUnregistered,
      }, null, 2) + "\n");
      return drifts.length > 0 ? 2 : 0;
    }

    if (mismatches.length > 0) {
      process.stdout.write(JSON.stringify({
        result: "UNKNOWN",
        reason: "回读校验不符（如实列明；修复后重跑本脚本幂等）",
        workspace: args.workspace,
        synced,
        deleted_remote: deletedRemote,
        mismatches,
        skipped_unregistered: skippedUnregistered,
      }, null, 2) + "\n");
      return 3;
    }
    process.stdout.write(JSON.stringify({
      result: "PASS",
      workspace: args.workspace,
      rendered: renderedPaths,
      synced,
      deleted_remote: deletedRemote,
      unchanged_files: unchangedFiles.length,
      skipped_unregistered: skippedUnregistered,
    }, null, 2) + "\n");
    return 0;
  } catch (exc) {
    if (exc instanceof UnknownError) {
      process.stdout.write(JSON.stringify({ result: "UNKNOWN", reason: exc.message }, null, 2) + "\n");
      log(`UNKNOWN: ${exc.message}`);
      return 3;
    }
    throw exc;
  }
}

/** commander 注册：group=workspace；参数解析沿用原脚本实现以保证契约逐字节等价。 */
export function registerWorkspaceSync(group: Command): void {
  group
    .command("sync")
    .description("Skill 资产渲染 + 平台同步")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action((...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      throw new ExitSignal(main(cmd.args));
    });
}
