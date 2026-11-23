/** Run-scoped Requirement Closeout root: platform checkout, identity gate, publication and safe release. */
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { loadConfig, type BaseRegistryConfig, type RuntimeConfig } from "../../clients/config.js";
import { MulticaClient, type IssueRecord } from "../../clients/multica.js";
import { multicaPrefix } from "../../clients/multica-environment.js";
import { runAuthenticatedGit } from "../../clients/authenticated-git.js";
import { runCommand } from "../../clients/spawn.js";
import { validateRootRepo, type RuntimePaths } from "../../clients/runtime-paths.js";
import {
  assertPlatformCheckoutIdentity,
  isDaemonCacheWorktree,
  platformCheckoutMode,
  readDaemonTaskContext,
  readPlatformCheckoutManifest,
  type PlatformCheckoutIdentity,
} from "../../clients/native-checkout.js";
import { readAnalysisSource, type AnalysisSource } from "../analysis/source.js";
import { canonicalRepositoryIdentity } from "./evidence-repository.js";
import { isRequirementChangeDelivery } from "./requirement-mode.js";

const ownerFile = "rondo-closeout-owner.json";

/**
 * 收口根仓所有权标记。
 * 平台 worktree 的生命周期归 daemon；Rondo 只在 `.git` 内写标记，证明"本次 Run 使用过该目录"，
 * 清理时只释放标记、绝不删除平台 worktree。
 */
interface Owner extends AnalysisSource {
  token: string;
  workdir: string;
  provenance: "multica-repo-checkout";
  issue_id: string;
  task_id: string;
  workspace_id: string;
  /** 平台 checkout 首次分配的 agent 分支，形如 agent/<agent>/<task 尾号>。 */
  checkout_branch: string;
  checkout_mode: "isolated";
}

/** 平台 checkout 后端：在 dir 下调用平台 checkout，返回根仓路径与平台分配分支。测试可注入 fake。 */
export type CloseoutCheckout = (dir: string, repoUrl: string) => { root: string; branch: string };

export interface PrepareRootOptions {
  /** Issue KEY 仅用于受控子目录命名；非法字符拒绝。 */
  issueKey: string;
  /** Multica Issue UUID，用于 `issue runs --active` 回读。 */
  issueId: string;
  checkout: CloseoutCheckout;
  /** 四条件的第四项：平台 `issue runs --active` 交叉验证，由调用方注入。 */
  verifyRun?: () => void;
  remote?: typeof runAuthenticatedGit;
}

/** 由 Git 自身解析工作树 Git 目录（兼容 `.git` 目录与 linked worktree 的 `.git` 文件）。 */
function gitDirOf(root: string): string {
  const dir = local(root, ["rev-parse", "--absolute-git-dir"], "定位 Git 目录");
  if (!isAbsolute(dir)) throw new UnknownError("无法确认根仓 Git 目录的绝对路径，保留现场");
  return dir;
}

/** 只允许在本次准备记录的 workdir 的一次性受控子目录内操作，且根仓本身不得是符号链接。 */
function assertManagedLocation(root: string, owner: Owner): void {
  if (typeof owner.workdir !== "string" || !isAbsolute(owner.workdir)) {
    throw new UnknownError("Closeout 根仓的受控 workdir 记录无效，保留现场");
  }
  let realWorkdir: string;
  try { realWorkdir = realpathSync(owner.workdir); }
  catch { throw new UnknownError("Closeout 根仓的受控 workdir 已不存在，保留现场"); }
  const realRoot = realpathSync(root);
  const parent = realpathSync(dirname(realRoot));
  if (lstatSync(root).isSymbolicLink() || realRoot !== resolve(root) ||
      !basename(parent).startsWith("rondo-closeout-") ||
      dirname(parent) !== realWorkdir) {
    throw new UnknownError("Closeout 根仓不在受控 workdir 的一次性子目录内，保留现场");
  }
}

function local(root: string, args: string[], what: string): string {
  const r = runCommand(["git", ...args], root);
  if (r.status !== 0) throw new UnknownError(`${what}: ${(r.stderr || r.stdout).trim().slice(0, 400)}`);
  return r.stdout.trim();
}

function authenticated(root: string, source: AnalysisSource, args: string[], what: string, timeoutMs?: number, remote = runAuthenticatedGit): string {
  const r = remote(source.repo_url, args, root, timeoutMs);
  if (r.status !== 0) throw new UnknownError(`${what}: ${(r.stderr || r.stdout).trim().slice(0, 400)}`);
  return r.stdout.trim();
}

function validBranch(root: string, branch: string): void {
  const r = runCommand(["git", "check-ref-format", "--branch", branch], root);
  if (r.status !== 0 || r.stdout.trim() !== branch || branch.startsWith("-") || branch.startsWith("refs/")) {
    throw new FailError("Closeout 根仓分支非法");
  }
}

function locateChange(root: string, ref: string): { archived: boolean; folder: string } {
  const base = join(root, "openspec", "changes");
  const live = join(base, ref);
  const archive = join(base, "archive");
  const names = existsSync(archive) ? readdirSync(archive).filter((s: string) => s === ref || s.endsWith("-" + ref)) : [];
  if ((existsSync(live) ? 1 : 0) + names.length !== 1) {
    throw new UnknownError("当前分支 OpenSpec Change 不存在或身份不唯一: " + ref);
  }
  return names.length ? { archived: true, folder: names[0] } : { archived: false, folder: ref };
}

/** Per-Issue Change uniqueness: do not silently select a live Change over its archived copy. */
export function assertCloseoutChange(paths: RuntimePaths, source: AnalysisSource): void {
  locateChange(paths.rootRepo, source.change_ref);
}

/**
 * 平台 isolated 证据（对应四条件中的 checkout-mode=isolated）：
 * - 完整 checkout 由平台写 `[multica] checkout-mode=isolated`；
 * - 新版 daemon 的 linked worktree 不写该键，改用「位于 `.repos/<workspace-id>/` 的 bare cache worktree」
 *   加 daemon 写入的任务上下文（managed_by/issue/agent）判定；
 * - 不使用 `MULTICA_REPO_CHECKOUT_MODE` 环境变量（当前 daemon task 不提供）。
 */
function platformIsolatedMode(root: string, workdir: string, workspaceId: string | undefined, issueId: string): string | null {
  const configured = platformCheckoutMode(root);
  if (configured) return configured;
  if (isDaemonCacheWorktree(root, workspaceId)) {
    const context = readDaemonTaskContext(workdir);
    if (context?.managed_by === "multica-daemon-task" && context.issue_id === issueId) {
      const agentId = process.env.MULTICA_AGENT_ID;
      if (!agentId || context.agent_id === agentId) return "isolated";
    }
  }
  return null;
}

/** 收口根仓的弱方案四条件交叉验证；manifest 存在时以平台 manifest 为准。 */
function verifyPlatformCheckout(root: string, gitDir: string, owner: Owner): void {
  // 强方案接口：平台 manifest 若存在，身份字段必须与当前 Run 一致。
  // linked worktree 的 manifest 可能落在公共 Git 目录，因此两个位置都探测。
  const commonDir = local(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"], "定位 Git 公共目录");
  const manifest = readPlatformCheckoutManifest(gitDir) ??
    (commonDir !== gitDir ? readPlatformCheckoutManifest(commonDir) : null);
  const evidence: PlatformCheckoutIdentity = manifest ?? {
    checkout_branch: owner.checkout_branch,
    task_id: owner.task_id,
    workspace_id: owner.workspace_id,
    checkout_mode: owner.checkout_mode,
  };
  const live = {
    // 平台形态证据优先，环境变量兜底。
    mode: platformIsolatedMode(root, owner.workdir, process.env.MULTICA_WORKSPACE_ID, owner.issue_id),
    taskId: process.env.MULTICA_TASK_ID,
    workspaceId: process.env.MULTICA_WORKSPACE_ID,
  };
  assertPlatformCheckoutIdentity(evidence, live);
}

/** The prepared root must belong to a platform checkout recorded by this Run, not a user's checkout. */
export function verifyCloseoutRoot(paths: RuntimePaths, source: AnalysisSource): RuntimePaths {
  const root = validateRootRepo(paths.rootRepo, "--root-repo");
  const gitDir = gitDirOf(root);
  const marker = join(gitDir, ownerFile);
  if (lstatSync(root).isSymbolicLink() || !existsSync(marker)) {
    throw new UnknownError("Requirement Closeout 必须使用平台 checkout 准备的受控根仓，禁止修改其它根仓");
  }
  let owner: Owner;
  try { owner = JSON.parse(readFileSync(marker, "utf8")) as Owner; }
  catch { throw new UnknownError("Closeout 根仓所有权标记不可读"); }
  assertManagedLocation(root, owner);
  if (typeof owner.token !== "string" || !owner.token ||
      owner.branch !== source.branch ||
      canonicalRepositoryIdentity(owner.repo_url) !== canonicalRepositoryIdentity(source.repo_url)) {
    throw new FailError("Closeout 根仓所有权与当前 Issue 的 Repository/Branch 不一致");
  }
  if (owner.provenance !== "multica-repo-checkout") {
    throw new UnknownError("Closeout 根仓不是平台 checkout 准备的，禁止使用");
  }
  verifyPlatformCheckout(root, gitDir, owner);
  return verifyGitRoot(paths, source);
}

/** Each Issue independently checks origin, branch and its own approved commit. */
function verifyGitRoot(paths: RuntimePaths, source: AnalysisSource): RuntimePaths {
  const root = validateRootRepo(paths.rootRepo, "--root-repo");
  validBranch(root, source.branch);
  const origin = local(root, ["remote", "get-url", "origin"], "核对 origin");
  const pushUrls = local(root, ["remote", "get-url", "--push", "--all", "origin"], "核对 push origin")
    .split(/\r?\n/).filter(Boolean);
  const identity = canonicalRepositoryIdentity(source.repo_url);
  if (identity !== canonicalRepositoryIdentity(origin) || pushUrls.length !== 1 ||
      identity !== canonicalRepositoryIdentity(pushUrls[0])) {
    throw new FailError("Closeout 根仓 Origin/Push 与 analysis.source.repo_url 不一致");
  }
  if (local(root, ["symbolic-ref", "--short", "HEAD"], "核对 HEAD 分支") !== source.branch) {
    throw new FailError("Closeout 根仓 HEAD 分支与当前 Issue analysis.source.branch 不一致");
  }
  if (local(root, ["cat-file", "-t", source.commit], "读取批准 Commit") !== "commit") {
    throw new UnknownError("批准版 analysis.source.commit 不是本仓 Git Commit");
  }
  const ancestor = runCommand(["git", "merge-base", "--is-ancestor", source.commit, "HEAD"], root);
  if (ancestor.status !== 0) throw new UnknownError("批准 Commit 不在当前根仓分支历史中");
  return { ...paths, gitRemoteUrl: source.repo_url };
}

/** A readback of the actual remote branch; local archive or a successful push response alone is not enough. */
export function confirmPublishedArchive(paths: RuntimePaths, source: AnalysisSource, remote = runAuthenticatedGit): { commit: string; folder: string } {
  const checked = verifyCloseoutRoot(paths, source);
  const root = checked.rootRepo;
  const remoteRef = "refs/remotes/origin/" + source.branch;
  authenticated(root, source, ["fetch", "origin", "refs/heads/" + source.branch + ":" + remoteRef], "归档远端回读 Fetch", undefined, remote);
  const ancestor = runCommand(["git", "merge-base", "--is-ancestor", "HEAD", remoteRef], root);
  if (ancestor.status !== 0) throw new UnknownError("本地归档 HEAD 尚未包含于远端目标分支，禁止收口");
  const remoteCommit = local(root, ["rev-parse", remoteRef], "读取远端目标 Commit");
  const scope = remoteRef + ":openspec/changes/archive";
  const list = runCommand(["git", "ls-tree", "--name-only", "-d", scope], root);
  if (list.status !== 0) throw new UnknownError("远端未找到 OpenSpec Archive 目录");
  const matches = list.stdout.split(/\r?\n/).filter(n => n === source.change_ref || n.endsWith("-" + source.change_ref));
  if (matches.length !== 1) throw new UnknownError("远端归档 Change 不存在或不唯一");
  if (runCommand(["git", "cat-file", "-e", remoteRef + ":openspec/changes/" + source.change_ref], root).status === 0) {
    throw new UnknownError("远端 Change 仍存在于活跃目录，拒绝确认归档");
  }
  const localTree = local(root, ["rev-parse", "HEAD:openspec/changes/archive/" + matches[0]], "核对本地归档树");
  const remoteTree = local(root, ["rev-parse", remoteRef + ":openspec/changes/archive/" + matches[0]], "核对远端归档树");
  if (localTree !== remoteTree) throw new UnknownError("远端归档内容与本地发布版本不一致");
  return { commit: remoteCommit, folder: matches[0] };
}

/**
 * 解析 `multica repo checkout` 人类可读输出：
 * 路径写 stdout，`Checked out <url> → <path> (branch: <branch>)` 写 stderr（实测）。
 * 两个流都参与解析，避免因流分离丢失平台分配分支。
 */
export function parsePlatformCheckoutOutput(stdout: string, stderr = ""): { root: string; branch: string } {
  const combined = stdout + "\n" + stderr;
  const root = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => isAbsolute(line)) ??
    combined.split(/\r?\n/).map((line) => line.trim()).find((line) => isAbsolute(line));
  const branch = /\(branch:\s*([^)]+)\)/.exec(combined)?.[1]?.trim();
  if (!root || !isAbsolute(root) || !branch || !branch.includes("/")) {
    throw new UnknownError("平台 repo checkout 输出无法识别，拒绝使用: " + combined.trim().slice(0, 300));
  }
  return { root, branch };
}

/**
 * 在 Task workdir 的受控子目录内准备平台 checkout，并切换到 analysis.source.branch。
 * 不再执行任何直接 `git clone`；平台 worktree 由 daemon 管理，Rondo 只写所有权标记。
 */
export function prepareRoot(source: AnalysisSource, options: PrepareRootOptions): { root_repo: string; cleanup_token: string } {
  const remote = options.remote ?? runAuthenticatedGit;
  const workdir = realpathSync(process.cwd());
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.issueKey)) {
    throw new FailError("Issue KEY 含非法字符，不能用于受控目录名");
  }
  // 必须在独立子目录中 checkout，避免复用/干扰 daemon 已检出的 agent 分支工作树。
  const subdir = mkdtempSync(join(workdir, "rondo-closeout-" + options.issueKey + "-"));
  let marker: string | undefined;
  let root: string | undefined;
  try {
    validBranch(subdir, source.branch);
    const platform = options.checkout(subdir, source.repo_url);
    if (!platform || typeof platform.root !== "string" || !isAbsolute(platform.root)) {
      throw new UnknownError("平台 repo checkout 未返回绝对根仓路径，拒绝使用");
    }
    root = validateRootRepo(platform.root, "平台 checkout");
    if (realpathSync(dirname(root)) !== realpathSync(subdir)) {
      throw new UnknownError("平台 checkout 未落在受控子目录内，拒绝使用");
    }
    validBranch(root, source.branch);
    const taskId = process.env.MULTICA_TASK_ID;
    const workspaceId = process.env.MULTICA_WORKSPACE_ID;
    // 平台身份证据：完整 checkout 配置、daemon cache linked worktree 形态、或任务环境变量。
    const liveMode = platformIsolatedMode(root, workdir, workspaceId, options.issueId);
    if ((liveMode ?? "").toLowerCase() !== "isolated") {
      throw new UnknownError("当前 checkout 缺少 isolated 平台证据，拒绝使用");
    }
    assertPlatformCheckoutIdentity({
      checkout_branch: platform.branch,
      task_id: taskId ?? "",
      workspace_id: workspaceId ?? "",
      checkout_mode: liveMode as string,
    }, {
      mode: liveMode,
      taskId,
      workspaceId,
    });
    // 平台分配分支必须真实存在于该 checkout，防止仅伪造输出文本。
    if (runCommand(["git", "rev-parse", "--verify", "--quiet", "refs/heads/" + platform.branch], root).status !== 0) {
      throw new UnknownError("平台分配分支不存在于 checkout，拒绝使用该根仓");
    }
    // 第四条件：平台回读当前 Task 仍是该 Issue 的活跃 Run。
    options.verifyRun?.();

    // 显式抓取到远端跟踪引用，保证后续 switch 的目标一定存在且是最新远端提交。
    authenticated(root, source,
      ["fetch", "origin", "refs/heads/" + source.branch + ":refs/remotes/origin/" + source.branch],
      "收口分支 Fetch", 600_000, remote);
    // `git switch` 幂等复用已有本地分支；不存在时才以 origin/<branch> 创建。
    const switched = runCommand(["git", "switch", source.branch], root);
    if (switched.status !== 0) {
      const created = runCommand(["git", "switch", "-c", source.branch, "origin/" + source.branch], root);
      if (created.status !== 0) {
        throw new UnknownError("切换收口分支失败: " + (created.stderr || created.stdout).trim().slice(0, 400));
      }
    }
    // daemon bare cache 可能已有同名本地分支且落后于刚抓取的远端（LEI-49 实测 main 落后）。
    // 只允许快进对齐；分叉或无法快进则拒绝，避免在旧提交上做收口。
    const originRef = "refs/remotes/origin/" + source.branch;
    const localCommit = local(root, ["rev-parse", source.branch], "读取本地收口分支");
    const remoteCommit = local(root, ["rev-parse", originRef], "读取远端收口分支");
    if (localCommit !== remoteCommit) {
      const ancestor = runCommand(["git", "merge-base", "--is-ancestor", localCommit, originRef], root);
      if (ancestor.status !== 0) throw new UnknownError("本地收口分支与远端分叉，拒绝使用");
      const merged = runCommand(["git", "merge", "--ff-only", originRef], root);
      if (merged.status !== 0) {
        throw new UnknownError("收口分支无法快进到远端: " + (merged.stderr || merged.stdout).trim().slice(0, 400));
      }
    }

    const paths: RuntimePaths = { rootRepo: root, openspecRoot: join(root, "openspec"), projectId: "", daemonId: null, source: "explicit_arg" };
    verifyGitRoot(paths, source);
    const token = randomUUID();
    const owner: Owner = {
      token,
      workdir,
      repo_url: source.repo_url,
      branch: source.branch,
      commit: source.commit,
      change_ref: source.change_ref,
      provenance: "multica-repo-checkout",
      issue_id: options.issueId,
      task_id: taskId as string,
      workspace_id: workspaceId as string,
      checkout_branch: platform.branch,
      checkout_mode: "isolated",
    };
    marker = join(gitDirOf(root), ownerFile);
    writeFileSync(marker, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
    locateChange(root, source.change_ref);
    return { root_repo: root, cleanup_token: token };
  } catch (error) {
    // 平台 worktree 不删除、不改动；失败时只释放本次所有权标记，或移除尚未落地的空子目录。
    if (marker && existsSync(marker)) {
      try { unlinkSync(marker); } catch { /* 标记释放失败则保留现场 */ }
    }
    if (!marker && existsSync(subdir) && readdirSync(subdir).length === 0) {
      rmdirSync(subdir);
    }
    throw new UnknownError("收口根仓准备失败（" + (marker ? "已释放所有权标记，保留现场 " + root : "保留现场 " + subdir) + "）: " +
      (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * 只释放本 Run 的所有权标记，绝不删除平台 worktree。
 * 平台目录的生命周期归 daemon；错误始终保留标记与现场。
 */
export function cleanupCloseoutRoot(raw: string, token: string): { released: true } {
  const rootArg = resolve(raw);
  if (!existsSync(rootArg)) throw new UnknownError("收口根仓目录不存在，拒绝清理");
  const root = validateRootRepo(rootArg, "--root-repo");
  const gitDir = gitDirOf(root);
  const marker = join(gitDir, ownerFile);
  if (lstatSync(root).isSymbolicLink() || !existsSync(marker)) {
    throw new UnknownError("非本 Run 准备的平台收口根仓，拒绝清理");
  }
  let owner: Owner;
  try { owner = JSON.parse(readFileSync(marker, "utf8")) as Owner; }
  catch { throw new UnknownError("Closeout 根仓所有权标记损坏，保留现场"); }
  assertManagedLocation(root, owner);
  if (!token || owner.token !== token) throw new FailError("Closeout Cleanup token 不匹配，拒绝清理");
  if (owner.provenance !== "multica-repo-checkout") throw new UnknownError("收口根仓不是平台 checkout 准备的，拒绝清理");
  unlinkSync(marker);
  return { released: true };
}

function argsOf(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--") && argv[i + 1] && !argv[i + 1].startsWith("--")) {
    args[argv[i].slice(2)] = argv[++i];
  }
  return args;
}

/** 平台 repo checkout 后端：multica CLI 的人可读输出解析为根仓路径与平台分支。 */
function platformCheckout(runtime: RuntimeConfig): CloseoutCheckout {
  return (dir, repoUrl) => {
    const r = runCommand([...multicaPrefix(runtime), "repo", "checkout", repoUrl], dir, undefined, 600_000);
    if (r.status !== 0) {
      throw new UnknownError("平台 repo checkout 失败: " + (r.stderr || r.stdout).trim().slice(0, 400));
    }
    return parsePlatformCheckoutOutput(r.stdout, r.stderr);
  };
}

/** 四条件的第四项：当前 Task 必须仍是该 Issue 的活跃 Run。 */
function assertCloseoutRun(client: MulticaClient, issue: IssueRecord): void {
  const taskId = process.env.MULTICA_TASK_ID;
  const workspaceId = process.env.MULTICA_WORKSPACE_ID;
  if (!taskId || !workspaceId) throw new UnknownError("缺少 Multica Task/Workspace 上下文，不能准备收口根仓");
  const raw = client.run(["issue", "runs", issue.id, "--active", ...client.ws(), "--output", "json"], "核验收口 Run", { transient: true });
  if (!Array.isArray(raw)) throw new UnknownError("收口 Run 列表不可核实");
  const runs = raw.filter((r) => r?.id === taskId);
  if (runs.length !== 1) throw new UnknownError("当前 Task 不属于该 Issue 的有效 Run");
  const run = runs[0];
  if (run.issue_id !== issue.id || run.workspace_id !== workspaceId || run.status !== "running") {
    throw new FailError("收口 Run / Issue / Workspace 绑定不一致或未运行");
  }
}

async function invoke(action: "prepare" | "cleanup", argv: string[]): Promise<number> {
  try {
    const args = argsOf(argv);
    let value: Record<string, unknown>;
    if (action === "prepare") {
      if (!args.issue || !args.config) return 64;
      const cfg = loadConfig<BaseRegistryConfig>(args.config);
      const client = new MulticaClient(cfg.runtime);
      const issue = client.getIssue(args.issue);
      const md = issue.metadata ?? {};
      if (!isRequirementChangeDelivery(md)) throw new FailError("仅 Requirement OpenSpec Change 可以准备 Closeout 根仓");
      const source = readAnalysisSource(md);
      value = {
        ...prepareRoot(source, {
          issueKey: issue.identifier ?? args.issue,
          issueId: issue.id,
          checkout: platformCheckout(cfg.runtime),
          verifyRun: () => assertCloseoutRun(client, issue),
        }),
        repo_url: source.repo_url,
        branch: source.branch,
        change_ref: source.change_ref,
      };
    } else {
      if (!args["root-repo"] || !args.token) return 64;
      value = cleanupCloseoutRoot(args["root-repo"], args.token);
    }
    process.stdout.write(JSON.stringify({ result: "PASS", ...value }) + "\n");
    return 0;
  } catch (error) {
    const known = error instanceof FailError || error instanceof UnknownError;
    process.stdout.write(JSON.stringify({ result: error instanceof FailError ? "FAIL" : "UNKNOWN",
      reason: error instanceof Error ? error.message : String(error) }) + "\n");
    if (!known) process.stderr.write(String(error) + "\n");
    return error instanceof FailError ? 2 : 3;
  }
}

export function registerCloseoutRoot(group: Command): void {
  // root-clone 是旧名兼容别名；新流程统一为 root-prepare（平台 checkout）。
  for (const [name, action] of [["root-prepare", "prepare"], ["root-clone", "prepare"], ["root-cleanup", "cleanup"]] as const) {
    group.command(name)
      .description(action === "prepare"
        ? "在受控子目录准备平台收口根仓并切换到 analysis.source.branch"
        : "只释放本 Run 的收口根仓所有权标记（平台 worktree 由 daemon 管理）")
      .helpOption(false).allowUnknownOption(true).allowExcessArguments(true)
      .action(async (...values: unknown[]) => {
        markLeafExecuted();
        const cmd = values[values.length - 1] as Command;
        const code = await invoke(action, cmd.args);
        if (code !== 0) throw new ExitSignal(code);
      });
  }
}
