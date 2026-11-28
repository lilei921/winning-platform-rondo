/** 只读检查调用方明确传入的根仓；执行者授权由具体写操作负责。 */
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, win32 } from "node:path";
import { FailError, UnknownError } from "../cli/errors.js";
import { runCommand } from "./spawn.js";
import { validateRootRepo } from "./runtime-paths.js";
import type { MulticaClient } from "./multica.js";
import { repositoryName } from "../commands/analysis/source.js";
import { canonicalRepositoryIdentity } from "../commands/delivery/evidence-repository.js";

/** 由 Git 确认工作树根目录，兼容普通 checkout 与 linked worktree，不依赖平台目录布局。 */
export function validateNativeCheckout(root: string): { rootRepo: string } {
  const rootRepo = validateRootRepo(root, "--root-repo");
  try {
    if (!statSync(join(rootRepo, "AGENTS.md")).isFile()) throw new Error();
  } catch {
    throw new UnknownError("根仓规范 AGENTS.md 尚不可读或不是文件");
  }
  return { rootRepo };
}

/**
 * 平台 checkout 的身份证据。
 * 弱方案：由 `multica repo checkout` 输出/本 Run 环境生成；
 * 强方案：平台若提供 `.git/multica-checkout.json`，以该 manifest 为准。
 */
export interface PlatformCheckoutIdentity {
  checkout_branch: string;
  task_id: string;
  workspace_id: string;
  checkout_mode: string;
}

/** 平台 manifest 文件名（强方案接口；平台尚未稳定提供时缺失即回退弱方案）。 */
export const PLATFORM_CHECKOUT_MANIFEST = "multica-checkout.json";

/** 当前 Run 可离线复核的平台上下文；checkout_branch 只在证据侧存在。 */
export interface LivePlatformContext {
  mode: string | null;
  taskId?: string;
  workspaceId?: string;
}

/**
 * 平台 checkout 分支尾号：MULTICA_TASK_ID 去连字符后的末 12 位。
 * 实测格式：`agent/<agent>/<尾号>`；同一 Task 的多个 checkout 可能追加 `-<时间戳>` 去重。
 */
export function platformTaskSuffix(taskId: string): string {
  const compact = taskId.replace(/-/g, "");
  if (compact.length < 12) throw new UnknownError("MULTICA_TASK_ID 长度不足，无法核对平台 checkout 身份");
  return compact.slice(-12);
}

/** 读取平台写入工作树配置的 `[multica] checkout-mode`；只读，不修改仓库。 */
export function platformCheckoutMode(rootRepo: string): string | null {
  const r = runCommand(["git", "config", "--get", "multica.checkout-mode"], rootRepo);
  const value = r.stdout.trim();
  return r.status === 0 && value ? value : null;
}

/** 任务 workdir 内的平台任务上下文文件名（daemon 写入）。 */
export const DAEMON_TASK_CONTEXT = join(".multica", "daemon_task_context.json");

export interface DaemonTaskContext {
  managed_by?: string;
  issue_id?: string;
  agent_id?: string;
}

/** 读取 daemon task 上下文；缺失或损坏返回 null，由调用方决定是否拒绝。 */
export function readDaemonTaskContext(workdir: string): DaemonTaskContext | null {
  try {
    const value = JSON.parse(readFileSync(join(workdir, DAEMON_TASK_CONTEXT), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as DaemonTaskContext;
  } catch {
    return null;
  }
}

/** 单 Issue 命令默认读取当前 Multica Task 的原生 Issue ID；显式 Key / ID 优先。 */
export function resolveIssueRef(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  if (explicit !== undefined) {
    if (!explicit.trim() || explicit.startsWith("--")) throw new UnknownError("--issue 必须提供有效 Key 或 ID");
    return explicit;
  }
  const configRoot = env.MULTICA_TASK_CONFIG_ROOT?.trim();
  if (!configRoot || !isAbsolute(configRoot)) {
    throw new UnknownError("无法确认当前 Multica Task 配置目录，请检查 MULTICA_TASK_CONFIG_ROOT 或显式提供 --issue");
  }
  // Multica Task 的 multica-config 与 workdir 是同级目录；不依赖调用方 cwd。
  const context = readDaemonTaskContext(join(dirname(configRoot), "workdir"));
  const agentId = env.MULTICA_AGENT_ID?.trim();
  if (agentId && context?.managed_by === "multica-daemon-task" && context.agent_id === agentId &&
      typeof context.issue_id === "string" && context.issue_id.trim()) return context.issue_id;
  throw new UnknownError("无法确认当前 Issue，请显式提供 --issue <key-or-id>");
}

/** Native intent must not silently fall back to a legacy Git workflow when identity is incomplete. */
export function nativeCheckoutExpected(path: string, workdir = dirname(path), legacyBranch?: string): boolean {
  if (platformCheckoutMode(path) !== null) return true;
  const branch = runCommand(["git", "symbolic-ref", "--short", "HEAD"], path);
  const name = branch.status === 0 ? branch.stdout.trim() : "";
  if (name.startsWith("agent/")) return true;
  // An explicitly expected legacy branch is not inferred from the parent's checkout.
  if (legacyBranch && name === legacyBranch) return false;
  return existsSync(join(workdir, DAEMON_TASK_CONTEXT));
}

/** Kept does not switch refs. Check the selected ref, not the history of every remote branch. */
export function assertNativeCheckoutBaseline(path: string, branch: string): void {
  const read = (args: string[]) => runCommand(["git", ...args], path);
  const target = "refs/remotes/origin/" + branch;
  const fail = () => { throw new UnknownError("Native Checkout 初始基线无法确认或与目标分支不一致: " + branch); };
  const local = read(["symbolic-ref", "--short", "HEAD"]);
  if (local.status !== 0 || read(["rev-parse", "--verify", target + "^{commit}"]).status !== 0) return fail();
  const name = local.stdout.trim();
  const remote = read(["config", "--get", "branch." + name + ".remote"]);
  const merge = read(["config", "--get", "branch." + name + ".merge"]);
  const upstream = remote.status === 0 && merge.status === 0 &&
    remote.stdout.trim() === "origin" && merge.stdout.trim() === "refs/heads/" + branch;
  if ((remote.status === 0 || merge.status === 0) && !upstream) return fail();
  const ancestor = (older: string, newer: string) => read(["merge-base", "--is-ancestor", older, newer]).status === 0;
  const history = read(["reflog", "show", "--format=%H%x09%gs", "refs/heads/" + name]);
  const first = history.status === 0 ? history.stdout.trim().split(/\r?\n/).at(-1) ?? "" : "";
  const creation = /^([0-9a-f]{40})\tbranch: Created from (.+)$/.exec(first);
  if (creation) {
    const [, base, from] = creation;
    if (!ancestor(base, "HEAD") || !ancestor(base, target)) return fail();
    if (upstream || from === target || from === "origin/" + branch) return;
    if (from !== base) return fail();
    // Isolated clone may start at a raw SHA. A single observed containing ref
    // is sufficient only when the selected branch is that ref; ambiguous facts stop.
    const refs = read(["for-each-ref", "--contains=" + base, "--format=%(refname)", "refs/remotes/origin/"]);
    const matching = refs.stdout.trim().split(/\r?\n/).filter(ref => ref && ref !== "refs/remotes/origin/HEAD");
    if (refs.status === 0 && matching.length === 1 && matching[0] === target) return;
    return fail();
  }
  // Linked checkout can lack a creation reflog. A named upstream plus an
  // actual fast-forward relationship (or its recorded fork point) is sufficient.
  if (upstream && (ancestor(target, "HEAD") || ancestor("HEAD", target))) return;
  if (upstream) {
    const fork = read(["merge-base", "--fork-point", target, "HEAD"]);
    if (fork.status === 0 && ancestor(fork.stdout.trim(), target)) return;
  }
  return fail();
}

/**
 * 读取平台 checkout manifest；不存在返回 null（走弱方案）。
 * manifest 存在但不可解析或缺字段时 fail closed，避免把未知目录当作收口根仓。
 */
export function readPlatformCheckoutManifest(gitDir: string): PlatformCheckoutIdentity | null {
  const file = join(gitDir, PLATFORM_CHECKOUT_MANIFEST);
  const entry = statSync(file, { throwIfNoEntry: false });
  if (!entry) return null;
  if (!entry.isFile()) throw new UnknownError("平台 checkout manifest 不是文件，拒绝收口");
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new UnknownError("平台 checkout manifest 不是合法 JSON，拒绝收口"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UnknownError("平台 checkout manifest 不是对象，拒绝收口");
  }
  const obj = value as Record<string, unknown>;
  // 兼容平台可能采用的蛇形/驼峰命名；只要存在明确字符串值即取用。
  const pick = (...keys: string[]): string =>
    keys.map((key) => obj[key]).find((v): v is string => typeof v === "string" && v.length > 0) ?? "";
  const evidence: PlatformCheckoutIdentity = {
    checkout_branch: pick("checkout_branch", "checkoutBranch", "branch"),
    task_id: pick("task_id", "taskId"),
    workspace_id: pick("workspace_id", "workspaceId"),
    checkout_mode: pick("checkout_mode", "checkoutMode", "mode"),
  };
  if (!evidence.checkout_branch || !evidence.task_id || !evidence.workspace_id || !evidence.checkout_mode) {
    throw new UnknownError("平台 checkout manifest 缺少身份字段，拒绝把该目录当作收口根仓");
  }
  return evidence;
}

/** 校验实际 Checkout 分支；存在平台 manifest 时核对其独立身份事实。 */
export function assertPlatformCheckoutIdentity(evidence: PlatformCheckoutIdentity | null, live: LivePlatformContext, branch = evidence?.checkout_branch ?? ""): void {
  if ((evidence && evidence.checkout_mode.toLowerCase() !== "isolated") || (live.mode ?? "").toLowerCase() !== "isolated") {
    throw new UnknownError("当前不是 Multica isolated checkout 任务，禁止使用收口根仓");
  }
  if (!live.taskId || !live.workspaceId) {
    throw new UnknownError("缺少 MULTICA_TASK_ID / MULTICA_WORKSPACE_ID，不能校验收口 checkout 身份");
  }
  if (evidence && (evidence.task_id !== live.taskId || evidence.workspace_id !== live.workspaceId)) {
    throw new FailError("平台 checkout 的 Task/Workspace 与当前 Run 不一致，拒绝使用该根仓");
  }
  const suffix = platformTaskSuffix(live.taskId);
  // 平台在分支名冲突时为同一 Task 追加 `-<时间戳>`，仍属本 Task 的 checkout。
  if (!branch.startsWith("agent/") || (evidence && evidence.checkout_branch !== branch)) throw new FailError("平台 Checkout 分支身份不一致");
  const tail = branch.split("/").at(-1) ?? "";
  if (tail !== suffix && !new RegExp("^" + suffix + "-\\d+$").test(tail)) {
    throw new FailError("平台 checkout 分支尾号与当前 Task 不一致，拒绝使用该根仓");
  }
}


/** Read the actual path and Task branch from the supported CLI output (including Kept). */
export function parsePlatformCheckoutOutput(stdout: string, stderr = ""): { root: string; branch: string } {
  const combined = stdout + "\n" + stderr;
  const absolute = (line: string) => isAbsolute(line) || win32.isAbsolute(line);
  const lines = combined.split(/\r?\n/).map(line => line.trim());
  const branch = /\(branch:\s*(agent\/[^,\s)]+)(?=[,\s)])/m.exec(combined)?.[1];
  const paths = lines.filter(absolute);
  for (const line of lines) {
    const match = /^(?:Checked out|Kept the existing checkout)\b.*?\s->\s(.+?)(?:\s+\(branch:|$)/.exec(line);
    if (match && absolute(match[1])) paths.push(match[1]);
  }
  const unique = [...new Set(paths)];
  if (unique.length !== 1 || !branch) throw new UnknownError("平台 repo checkout 输出无法确认路径与 Task 分支，保留现场");
  return { root: unique[0], branch };
}

const samePath = (a: string, b: string): boolean => process.platform === "win32"
  ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);

/** Check a daemon-managed Native Checkout; Multica owns its creation and reuse. */
export function assertNativeTaskCheckout(path: string, workdir: string, reportedBranch?: string, issueId?: string): string {
  const workspaceId = process.env.MULTICA_WORKSPACE_ID;
  const agentId = process.env.MULTICA_AGENT_ID;
  const context = readDaemonTaskContext(workdir);
  if (!workspaceId || !agentId || context?.managed_by !== "multica-daemon-task" || context.agent_id !== agentId)
    throw new UnknownError("无法确认当前 daemon Task 上下文");
  if (issueId && context.issue_id !== issueId) throw new FailError("当前 daemon Task 不属于此 Issue");
  const canonical = realpathSync(path), parent = realpathSync(workdir);
  if (!samePath(canonical, path) || lstatSync(path).isSymbolicLink() ||
      !samePath(dirname(canonical), parent) ||
      !existsSync(join(path, ".git")) ||
      lstatSync(join(path, ".git")).isSymbolicLink()) throw new FailError("工作树不属于当前 Task 的 Native Checkout");
  const read = (args: string[]) => {
    const r = runCommand(["git", ...args], path);
    if (r.status !== 0 || !r.stdout.trim()) throw new UnknownError("Native Checkout Git 身份无法确认");
    return r.stdout.trim();
  };
  if (!samePath(read(["rev-parse", "--show-toplevel"]), canonical)) throw new FailError("Native Git 根目录不一致");
  const branch = read(["symbolic-ref", "--short", "HEAD"]);
  if (!branch.startsWith("agent/") || (reportedBranch && reportedBranch !== branch))
    throw new FailError("Native Checkout 当前分支与平台返回不一致");
  const gitDir = read(["rev-parse", "--absolute-git-dir"]);
  const commonDir = read(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const manifest = readPlatformCheckoutManifest(gitDir) ??
    (samePath(commonDir, gitDir) ? null : readPlatformCheckoutManifest(commonDir));
  const liveMode = platformCheckoutMode(path) ?? "isolated";
  if (liveMode.toLowerCase() !== "isolated" || (manifest && manifest.checkout_mode.toLowerCase() !== "isolated"))
    throw new UnknownError("当前不是 Multica isolated checkout 任务");
  if (manifest && manifest.workspace_id !== workspaceId) throw new FailError("Native Checkout manifest Workspace 不一致");
  if (manifest && manifest.checkout_branch !== branch) throw new FailError("Native Checkout manifest 分支不一致");
  return branch;
}

/** Native Project Resource is the only configuration input for repository selection. */
export interface ProjectResource {
  resource_type?: unknown;
  label?: unknown;
  resource_ref?: { url?: unknown; ref?: unknown };
}
export function readProjectResources(workdir: string, projectId: unknown,
  client?: Pick<MulticaClient, "run" | "ws">): ProjectResource[] {
  if (typeof projectId !== "string" || !projectId) throw new UnknownError("当前 Issue 缺少 Project 身份");
  const path = join(workdir, ".multica", "project", "resources.json");
  if (existsSync(path)) {
    let project;
    try { project = JSON.parse(readFileSync(path, "utf8")); }
    catch { throw new UnknownError("无法读取当前 Task 的 Project Resource"); }
    if (project?.project_id !== projectId || !Array.isArray(project.resources))
      throw new UnknownError("Project Resource 与当前 Issue 的 Project 身份不一致");
    return project.resources;
  }
  if (!client) throw new UnknownError("当前 Task 缺少 Project Resource");
  const resources = client.run(["project", "resource", "list", projectId, ...client.ws(), "--output", "json"],
    "查询当前 Project Resource", { transient: true });
  if (!Array.isArray(resources)) throw new UnknownError("当前 Project Resource 列表无法确认");
  return resources;
}

type RepoResource = { url: string; ref?: unknown };
function selectResource(resources: ProjectResource[], matches: (url: string) => boolean, what: string): RepoResource {
  const rows = resources.filter(row => {
    if (row?.resource_type !== "github_repo" || typeof row.resource_ref?.url !== "string") return false;
    try { return matches(row.resource_ref.url); } catch { return false; }
  });
  if (rows.length !== 1) throw new FailError(what + " 对应的 Project Resource 缺失或不唯一");
  return rows[0].resource_ref as RepoResource;
}
export function projectRepository(resources: ProjectResource[], name: string): RepoResource {
  return selectResource(resources, url => repositoryName(url) === name, "repo_id " + name);
}
/** Resolve only a selected business member, excluding the actual engineering root. */
export function projectBusinessRepository(resources: ProjectResource[], name: string, rootUrl: string): RepoResource {
  if (name === repositoryName(rootUrl)) throw new FailError("业务仓范围不能包含工程契约根仓 " + name);
  const selected = projectRepository(resources, name);
  if (canonicalRepositoryIdentity(selected.url) === canonicalRepositoryIdentity(rootUrl))
    throw new FailError("业务仓范围不能包含工程契约根仓 " + name);
  return selected;
}
export function projectRootResource(resources: ProjectResource[], rootUrl: string): RepoResource {
  const identity = canonicalRepositoryIdentity(rootUrl);
  return selectResource(resources, url => canonicalRepositoryIdentity(url) === identity, "根仓 URL");
}
