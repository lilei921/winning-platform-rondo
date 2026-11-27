/** Requirement Closeout root: Multica Task checkout, isolated archive branch and remote readback. */
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { resolveMulticaRuntime, type MulticaRuntime } from "../../clients/runtime-context.js";
import { MulticaClient } from "../../clients/multica.js";
import { multicaPrefix } from "../../clients/multica-environment.js";
import { runAuthenticatedGit } from "../../clients/authenticated-git.js";
import { runCommand } from "../../clients/spawn.js";
import { validateRootRepo, type RuntimePaths } from "../../clients/runtime-paths.js";
import {
  assertPlatformCheckoutIdentity,
  platformCheckoutMode,
  platformTaskSuffix,
  parsePlatformCheckoutOutput,
  readDaemonTaskContext,
  DAEMON_TASK_CONTEXT,
  readPlatformCheckoutManifest,
} from "../../clients/native-checkout.js";
import { readAnalysisSource, type AnalysisSource } from "../analysis/source.js";
import { canonicalRepositoryIdentity } from "./evidence-repository.js";
import { touchedCapabilities } from "./contract-files.js";
import { isRequirementChangeDelivery } from "./requirement-mode.js";

export type CloseoutCheckout = (workdir: string, repoUrl: string, ref: string) => { root: string; branch: string };

export interface PrepareRootOptions {
  checkout: CloseoutCheckout;
  remote?: typeof runAuthenticatedGit;
}

function local(root: string, args: string[], what: string): string {
  const r = runCommand(["git", ...args], root);
  if (r.status !== 0) throw new UnknownError(what + ": " + (r.stderr || r.stdout).trim().slice(0, 400));
  return r.stdout.trim();
}

function authenticated(root: string, source: AnalysisSource, args: string[], what: string, timeoutMs?: number, remote = runAuthenticatedGit): string {
  const r = remote(source.repo_url, args, root, timeoutMs);
  if (r.status !== 0) throw new UnknownError(what + ": " + (r.stderr || r.stdout).trim().slice(0, 400));
  return r.stdout.trim();
}

function validBranch(root: string, branch: string): void {
  const r = runCommand(["git", "check-ref-format", "--branch", branch], root);
  if (r.status !== 0 || r.stdout.trim() !== branch || branch.startsWith("-") || branch.startsWith("refs/")) {
    throw new FailError("Closeout 根仓分支非法");
  }
}

/** Task-local branch; it is never a remote publication target. */
function archiveBranch(root: string, source: AnalysisSource): string {
  const taskId = process.env.MULTICA_TASK_ID;
  if (!taskId) throw new UnknownError("缺少 MULTICA_TASK_ID，无法确认归档分支归属");
  const name = "rondo/closeout/" + platformTaskSuffix(taskId) + "/" + source.branch;
  validBranch(root, name);
  return name;
}

function rootName(source: AnalysisSource): string {
  let name: string;
  try { name = decodeURIComponent(new URL(source.repo_url).pathname.split("/").at(-1) ?? ""); }
  catch { throw new FailError("根仓 URL 无法解析仓库名称"); }
  if (!name || name === "." || name === ".." || /[/\\\x00-\x1f]/.test(name)) {
    throw new FailError("根仓名称不能用于 Task workdir 下的直属目录");
  }
  return name;
}

/** No owner marker: the Task workdir and platform checkout are the ownership evidence. */
function assertTaskLocation(root: string, workdir: string): void {
  let realWorkdir: string, realRoot: string;
  try {
    realWorkdir = realpathSync(workdir);
    realRoot = realpathSync(root);
    if (lstatSync(root).isSymbolicLink() || realRoot !== resolve(root) || dirname(realRoot) !== realWorkdir) throw new Error();
  } catch {
    throw new UnknownError("Closeout 根仓不是当前 Task workdir 的直属平台 Checkout，保留现场");
  }
}

function gitDirOf(root: string): string {
  const dir = local(root, ["rev-parse", "--absolute-git-dir"], "定位 Git 目录");
  if (!isAbsolute(dir)) throw new UnknownError("根仓 Git 目录不是绝对路径");
  return dir;
}

/** The agent branch remains as a ref after switching to a Task-local archive branch. */
function checkoutBranch(root: string): string {
  const taskId = process.env.MULTICA_TASK_ID;
  if (!taskId) throw new UnknownError("缺少 MULTICA_TASK_ID");
  const suffix = platformTaskSuffix(taskId);
  const refs = local(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads/agent"], "定位平台 Checkout 分支")
    .split(/\r?\n/).filter(Boolean);
  const matching = refs.filter((ref) => {
    const tail = ref.split("/").at(-1) ?? "";
    return ref.startsWith("agent/") && (tail === suffix || new RegExp("^" + suffix + "-\\d+$").test(tail));
  });
  if (matching.length !== 1) throw new UnknownError("当前 Task 的平台 Checkout 分支不存在或不唯一，保留现场");
  return matching[0];
}

function platformIsolatedMode(root: string, workdir: string): string | null {
  const configured = platformCheckoutMode(root);
  const context = readDaemonTaskContext(workdir);
  const agentId = process.env.MULTICA_AGENT_ID;
  if (existsSync(join(workdir, DAEMON_TASK_CONTEXT)) &&
      (!context || context.managed_by !== "multica-daemon-task" || !agentId || context.agent_id !== agentId))
    throw new FailError("Closeout daemon Task / Agent 上下文不一致");
  // The Task's original branch is checked separately, including after Archive branch switches.
  return configured ?? (context ? "isolated" : null);
}

function verifyPlatformCheckout(root: string, workdir: string, reportedBranch?: string): void {
  const taskId = process.env.MULTICA_TASK_ID;
  const workspaceId = process.env.MULTICA_WORKSPACE_ID;
  const gitDir = gitDirOf(root);
  const commonDir = local(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"], "定位 Git 公共目录");
  const manifest = readPlatformCheckoutManifest(gitDir) ??
    (commonDir !== gitDir ? readPlatformCheckoutManifest(commonDir) : null);
  const liveMode = platformIsolatedMode(root, workdir);
  if (liveMode !== "isolated") throw new UnknownError("当前不是 Multica isolated checkout 任务，禁止使用收口根仓");
  const branch = manifest?.checkout_branch ?? reportedBranch ?? checkoutBranch(root);
  if (runCommand(["git", "show-ref", "--verify", "--quiet", "refs/heads/" + branch], root).status !== 0) {
    throw new UnknownError("平台分配的 Checkout 分支不存在，拒绝使用");
  }
  assertPlatformCheckoutIdentity(manifest, { mode: liveMode, taskId, workspaceId }, branch);
  if (reportedBranch && reportedBranch !== branch) {
    throw new UnknownError("平台 Checkout 返回分支与身份事实不一致");
  }
  const current = local(root, ["symbolic-ref", "--short", "HEAD"], "核对当前 Task 本地分支");
  if (current !== branch && (reportedBranch || !current.startsWith("rondo/closeout/" + platformTaskSuffix(taskId!) + "/")))
    throw new UnknownError("当前分支不属于本 Task 的 Checkout 或归档分支");
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

export function assertCloseoutChange(paths: RuntimePaths, source: AnalysisSource): void {
  locateChange(paths.rootRepo, source.change_ref);
}

/** Verify both fetch and push destinations before any authenticated remote operation. */
function assertRepositoryRemote(root: string, source: AnalysisSource): void {
  const origin = local(root, ["remote", "get-url", "origin"], "核对 origin");
  const pushUrls = local(root, ["remote", "get-url", "--push", "--all", "origin"], "核对 push origin")
    .split(/\r?\n/).filter(Boolean);
  const identity = canonicalRepositoryIdentity(source.repo_url);
  if (identity !== canonicalRepositoryIdentity(origin) || pushUrls.length !== 1 ||
      identity !== canonicalRepositoryIdentity(pushUrls[0])) {
    throw new FailError("Closeout 根仓 Origin/Push 与 analysis.source.repo_url 不一致");
  }
}

function verifyGitRoot(paths: RuntimePaths, source: AnalysisSource): RuntimePaths {
  const root = validateRootRepo(paths.rootRepo, "--root-repo");
  validBranch(root, source.branch);
  assertRepositoryRemote(root, source);
  if (local(root, ["symbolic-ref", "--short", "HEAD"], "核对本地归档分支") !== archiveBranch(root, source)) {
    throw new UnknownError("Closeout 本地 Task 归档分支与 analysis.source.branch 不一致");
  }
  if (local(root, ["cat-file", "-t", source.commit], "读取批准 Commit") !== "commit") {
    throw new UnknownError("analysis.source.commit 不是本仓 Git Commit");
  }
  const ancestor = runCommand(["git", "merge-base", "--is-ancestor", source.commit, "HEAD"], root);
  if (ancestor.status !== 0) throw new UnknownError("批准 Commit 不在本地归档分支历史中");
  return { ...paths, gitRemoteUrl: source.repo_url };
}

export function verifyCloseoutRoot(paths: RuntimePaths, source: AnalysisSource): RuntimePaths {
  const root = validateRootRepo(paths.rootRepo, "--root-repo");
  const workdir = realpathSync(process.cwd());
  assertTaskLocation(root, workdir);
  if (rootName(source) !== root.split(/[\\/]/).at(-1)) {
    throw new FailError("Checkout 目录名与 analysis.source.repo_url 不一致");
  }
  verifyPlatformCheckout(root, workdir);
  return verifyGitRoot(paths, source);
}

/** Read the exact source branch from origin; never infer it from the local HEAD name. */
export function confirmPublishedArchive(paths: RuntimePaths, source: AnalysisSource, remote = runAuthenticatedGit): { commit: string; folder: string } {
  const checked = verifyCloseoutRoot(paths, source);
  const root = checked.rootRepo;
  const remoteRef = "refs/remotes/origin/" + source.branch;
  authenticated(root, source, ["fetch", "origin", "refs/heads/" + source.branch + ":" + remoteRef], "归档远端回读 Fetch", undefined, remote);
  if (runCommand(["git", "merge-base", "--is-ancestor", "HEAD", remoteRef], root).status !== 0) {
    throw new UnknownError("本地归档 HEAD 尚未包含于远端目标分支，禁止收口");
  }
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
  // Other Runs may archive a different Change against the same capability.
  for (const cap of touchedCapabilities(join(root, "openspec", "changes", "archive", matches[0]))) {
    const suffix = ":openspec/specs/" + cap;
    const localSpec = runCommand(["git", "rev-parse", "HEAD" + suffix], root);
    const remoteSpec = runCommand(["git", "rev-parse", remoteRef + suffix], root);
    if (localSpec.status !== remoteSpec.status ||
        (localSpec.status === 0 && localSpec.stdout.trim() !== remoteSpec.stdout.trim())) {
      throw new UnknownError("远端归档后的 Specs 与本地发布版本不一致: " + cap);
    }
  }
  return { commit: remoteCommit, folder: matches[0] };
}

export { parsePlatformCheckoutOutput } from "../../clients/native-checkout.js";

/** Direct checkout into Task workdir; safe local branch reuse without resets or cleanup. */
export function prepareRoot(source: AnalysisSource, options: PrepareRootOptions): { root_repo: string } {
  const remote = options.remote ?? runAuthenticatedGit;
  const workdir = realpathSync(process.cwd());
  if (!process.env.MULTICA_TASK_ID || !process.env.MULTICA_WORKSPACE_ID) {
    throw new UnknownError("缺少 Multica Task/Workspace 上下文，不能准备收口根仓");
  }
  validBranch(workdir, source.branch);
  const expected = join(workdir, rootName(source));
  let reportedBranch: string | undefined;
  let root: string;
  try {
    if (!existsSync(expected)) {
      const platform = options.checkout(workdir, source.repo_url, source.branch);
      if (!platform || !platform.root || !isAbsolute(platform.root)) {
        throw new UnknownError("平台 repo checkout 未返回绝对根仓路径");
      }
      root = validateRootRepo(platform.root, "平台 checkout");
      reportedBranch = platform.branch;
    } else {
      root = validateRootRepo(expected, "已有平台 checkout");
    }
    assertTaskLocation(root, workdir);
    if (realpathSync(root) !== realpathSync(expected)) {
      throw new UnknownError("平台 checkout 未落在 workdir/<repo-name> 直属目录");
    }
    verifyPlatformCheckout(root, workdir, reportedBranch);
    assertRepositoryRemote(root, source);
    const paths: RuntimePaths = { rootRepo: root, openspecRoot: join(root, "openspec"),
      projectId: "", daemonId: null, source: "explicit_arg" };

    // The remote approved baseline is authoritative; never silently fall back to master.
    const upstream = "refs/remotes/origin/" + source.branch;
    authenticated(root, source,
      ["fetch", "origin", "refs/heads/" + source.branch + ":" + upstream],
      "收口目标分支 Fetch", 600_000, remote);
    if (local(root, ["cat-file", "-t", source.commit], "读取批准 Commit") !== "commit" ||
        runCommand(["git", "merge-base", "--is-ancestor", source.commit, upstream], root).status !== 0) {
      throw new UnknownError("批准 Commit 不在 analysis.source.branch 的远端基线历史中");
    }

    const target = archiveBranch(root, source);
    const current = local(root, ["symbolic-ref", "--short", "HEAD"], "定位当前分支");
    if (current !== target) {
      if (local(root, ["status", "--porcelain=v1", "--untracked-files=all"], "切换前检查工作区")) {
        throw new UnknownError("切换本地归档分支前工作区非空，保留现场");
      }
      // Prevent switching groups while a previous archive is still unpushed.
      if (current.startsWith("rondo/closeout/" + platformTaskSuffix(process.env.MULTICA_TASK_ID) + "/")) {
        const previousTarget = current.slice(("rondo/closeout/" + platformTaskSuffix(process.env.MULTICA_TASK_ID) + "/").length);
        const previousRemote = "refs/remotes/origin/" + previousTarget;
        authenticated(root, { ...source, branch: previousTarget },
          ["fetch", "origin", "refs/heads/" + previousTarget + ":" + previousRemote],
          "核对上一归档分支", 600_000, remote);
        if (runCommand(["git", "merge-base", "--is-ancestor", "HEAD", previousRemote], root).status !== 0) {
          throw new UnknownError("上一组仍有未确认的本地 Commit，保留现场");
        }
      }
      const exists = runCommand(["git", "show-ref", "--verify", "--quiet", "refs/heads/" + target], root).status === 0;
      const args = exists ? ["switch", target] : ["switch", "-c", target, upstream];
      local(root, args, "切换 Task 独立归档分支");
    }

    const [ahead, behind] = local(root, ["rev-list", "--left-right", "--count", "HEAD..." + upstream], "核对本地与远端关系")
      .split(/\s+/).map(Number);
    if (!Number.isInteger(ahead) || !Number.isInteger(behind)) throw new UnknownError("无法读取归档分支 ahead/behind");
    if (ahead > 0 && behind > 0) throw new UnknownError("本地归档分支与远端分叉，保留现场");
    if (behind > 0) {
      if (local(root, ["status", "--porcelain=v1", "--untracked-files=all"], "快进前检查工作区")) {
        throw new UnknownError("远端已前进但工作区非空，保留现场");
      }
      local(root, ["merge", "--ff-only", "--no-autostash", upstream], "快进本地归档分支");
    }
    verifyGitRoot(paths, source);
    locateChange(root, source.change_ref);
    return { root_repo: root };
  } catch (error) {
    // Multica owns this checkout. Never delete, reset, or release it on failure.
    if (error instanceof FailError || error instanceof UnknownError) throw error;
    throw new UnknownError("收口根仓准备失败（平台 checkout 保留）: " + (error instanceof Error ? error.message : String(error)));
  }
}

function argsOf(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--") && argv[i + 1] && !argv[i + 1].startsWith("--")) {
    args[argv[i].slice(2)] = argv[++i];
  }
  return args;
}

function platformCheckout(runtime: MulticaRuntime): CloseoutCheckout {
  return (workdir, repoUrl, ref) => {
    const r = runCommand([...multicaPrefix(runtime), "repo", "checkout", repoUrl, "--ref", ref], workdir, undefined, 600_000);
    if (r.status !== 0 || /fetch[_ -]error|fetch (?:failed|failure)/i.test(r.stdout + "\n" + r.stderr)) throw new UnknownError("平台 repo checkout 失败: " + (r.stderr || r.stdout).trim().slice(0, 400));
    return parsePlatformCheckoutOutput(r.stdout, r.stderr);
  };
}

async function invoke(argv: string[]): Promise<number> {
  try {
    const args = argsOf(argv);
    if (!args.issue) return 64;
    const runtime = resolveMulticaRuntime();
    const client = new MulticaClient(runtime);
    const issue = client.getIssue(args.issue);
    const md = issue.metadata ?? {};
    if (!isRequirementChangeDelivery(md)) throw new FailError("仅 Requirement OpenSpec Change 可以准备 Closeout 根仓");
    const source = readAnalysisSource(md);
    const prepared = prepareRoot(source, { checkout: platformCheckout(runtime) });
    process.stdout.write(JSON.stringify({ result: "PASS", ...prepared,
      repo_url: source.repo_url, branch: source.branch, change_ref: source.change_ref }) + "\n");
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
  // Retain root-clone as a compatibility alias; it now runs the same native checkout.
  for (const name of ["root-prepare", "root-clone"]) {
    group.command(name)
      .description("在 Task workdir 直属目录复用 Multica checkout 并准备本地归档分支")
      .helpOption(false).allowUnknownOption(true).allowExcessArguments(true)
      .action(async (...values: unknown[]) => {
        markLeafExecuted();
        const cmd = values[values.length - 1] as Command;
        const code = await invoke(cmd.args);
        if (code !== 0) throw new ExitSignal(code);
      });
  }
}
