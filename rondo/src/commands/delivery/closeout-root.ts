/** Run-scoped Requirement Closeout root: authenticated clone, identity, publication and safe release. */
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { loadConfig, type BaseRegistryConfig } from "../../clients/config.js";
import { MulticaClient } from "../../clients/multica.js";
import { runAuthenticatedGit } from "../../clients/authenticated-git.js";
import { runCommand } from "../../clients/spawn.js";
import { validateRootRepo, type RuntimePaths } from "../../clients/runtime-paths.js";
import { readAnalysisSource, type AnalysisSource } from "../analysis/source.js";
import { canonicalRepositoryIdentity } from "./evidence-repository.js";
import { isRequirementChangeDelivery } from "./requirement-mode.js";

const ownerFile = "rondo-closeout-owner.json";
interface Owner { token: string; workdir: string; repo_url: string; branch: string; commit: string; change_ref: string }

/** Clone 只允许创建在调用方明确指定的现有 workdir 下，不隐式退回系统 Temp。 */
function checkedWorkdir(input: string): string {
  if (!isAbsolute(input) || !existsSync(input) ||
      !lstatSync(input).isDirectory() || lstatSync(input).isSymbolicLink()) {
    throw new FailError("Closeout --workdir 必须是已存在的真实绝对目录");
  }
  return realpathSync(input);
}

/** 清理目标必须是原 Clone workdir 的直接子目录，且不能通过符号链接绕过边界。 */
function assertManagedCloneLocation(root: string, owner: Owner): void {
  let withinWorkdir = false;
  try {
    withinWorkdir = typeof owner.workdir === "string" &&
      basename(root).startsWith("rondo-closeout-") &&
      !lstatSync(root).isSymbolicLink() && realpathSync(root) === root &&
      realpathSync(dirname(root)) === checkedWorkdir(owner.workdir);
  } catch { /* 任何身份/路径异常都不得放行 */ }
  if (!withinWorkdir) throw new UnknownError("Closeout Clone 不在所属 workdir 的受控子目录");
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

/** The prepared root must belong to a managed temporary Clone, not a user's checkout. */
export function verifyCloseoutRoot(paths: RuntimePaths, source: AnalysisSource): RuntimePaths {
  const root = validateRootRepo(paths.rootRepo, "--root-repo");
  const marker = join(root, ".git", ownerFile);
  if (!basename(root).startsWith("rondo-closeout-") ||
      lstatSync(root).isSymbolicLink() || !existsSync(marker)) {
    throw new UnknownError("Requirement Closeout 必须使用受控临时 Clone，禁止修改其它根仓");
  }
  let owner: Owner;
  try { owner = JSON.parse(readFileSync(marker, "utf8")) as Owner; }
  catch { throw new UnknownError("Closeout Clone 所有权标记不可读"); }
  assertManagedCloneLocation(root, owner);
  if (typeof owner.token !== "string" || !owner.token ||
      owner.branch !== source.branch ||
      canonicalRepositoryIdentity(owner.repo_url) !== canonicalRepositoryIdentity(source.repo_url)) {
    throw new FailError("Closeout Clone 所有权与当前 Issue 的 Repository/Branch 不一致");
  }
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

export function cloneCloseoutRoot(source: AnalysisSource, workdir: string, remote = runAuthenticatedGit): { root_repo: string; cleanup_token: string } {
  const base = checkedWorkdir(workdir);
  const root = mkdtempSync(join(base, "rondo-closeout-"));
  let cleaned = false;
  try {
    validBranch(root, source.branch);
    authenticated(root, source,
      ["-c", "core.symlinks=false", "clone", "--single-branch", "--no-tags", "--branch", source.branch, "--", source.repo_url, "."],
      "受控根仓 Clone", 1_200_000, remote);
    const paths: RuntimePaths = { rootRepo: root, openspecRoot: join(root, "openspec"), projectId: "", daemonId: null, source: "explicit_arg" };
    verifyGitRoot(paths, source);
    const token = randomUUID();
    const owner: Owner = { token, workdir: base, ...source };
    writeFileSync(join(root, ".git", ownerFile), JSON.stringify(owner), { flag: "wx", mode: 0o600 });
    try { locateChange(root, source.change_ref); }
    catch (error) {
      // Missing or ambiguous Change is a known, clean clone failure: release it safely.
      // If cleanup cannot be proven safe, keep the root and expose recovery details.
      try { cleanupCloseoutRoot(root, token, remote); cleaned = true; }
      catch (cleanupError) {
        throw new UnknownError("Change 核验失败且 Clone 无法安全清理，保留 " + root +
          ": " + (cleanupError instanceof Error ? cleanupError.message : String(cleanupError)));
      }
      throw error;
    }
    return { root_repo: root, cleanup_token: token };
  } catch (error) {
    // Only remove a truly empty directory left by an early failure. Keep partial
    // clones and any unknown Git state for investigation.
    if (!cleaned && existsSync(root) && readdirSync(root).length === 0) {
      rmdirSync(root);
      cleaned = true;
    }
    throw new UnknownError("Clone/身份核验失败（" + (cleaned ? "已安全清理临时 Clone" : "保留现场 " + root) + "）: " +
      (error instanceof Error ? error.message : String(error)));
  }
}

/** Token and temporary-parent proof must come from this Run; errors always preserve the root. */
export function cleanupCloseoutRoot(raw: string, token: string, remote = runAuthenticatedGit): { removed: true } {
  const root = resolve(raw);
  if (!/^rondo-closeout-/.test(basename(root)) ||
      lstatSync(root).isSymbolicLink() || realpathSync(root) !== root ||
      !existsSync(join(root, ".git", ownerFile)) || process.cwd() === root ||
      process.cwd().startsWith(root + "/") || process.cwd().startsWith(root + "\\")) {
    throw new UnknownError("非本 Run 的安全临时 Clone 或当前目录仍在使用，拒绝清理");
  }
  let owner: Owner;
  try { owner = JSON.parse(readFileSync(join(root, ".git", ownerFile), "utf8")) as Owner; }
  catch { throw new UnknownError("Closeout 临时 Clone 所有权标记损坏，保留现场"); }
  assertManagedCloneLocation(root, owner);
  if (!token || owner.token !== token) throw new FailError("Closeout Cleanup token 不匹配，拒绝清理");
  const source: AnalysisSource = owner;
  const paths: RuntimePaths = { rootRepo: root, openspecRoot: join(root, "openspec"), projectId: "", daemonId: null, source: "explicit_arg" };
  verifyCloseoutRoot(paths, source);
  for (const file of ["index.lock", "HEAD.lock", "packed-refs.lock", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"]) {
    if (existsSync(join(root, ".git", file))) throw new UnknownError("Git 操作尚未结束: " + file + "（保留 Clone）");
  }
  const localRefs = local(root, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags", "refs/stash"], "核对临时 Clone 本地引用")
    .split(/\r?\n/).filter(Boolean);
  if (localRefs.some(ref => ref !== "refs/heads/" + source.branch)) {
    throw new UnknownError("临时 Clone 仍有其它 Branch/Tag/Stash 引用，可能包含未 Push Commit，保留现场");
  }
  const worktrees = local(root, ["worktree", "list", "--porcelain"], "核对 Clone Worktree")
    .split(/\r?\n/).filter(line => line.startsWith("worktree "));
  if (worktrees.length !== 1) throw new UnknownError("临时 Clone 存在其它 Worktree，拒绝清理");
  const dirty = local(root, ["status", "--porcelain=v1", "--untracked-files=all"], "核对 Clone WIP");
  if (dirty) throw new UnknownError("临时 Clone 存在未提交修改，保留现场");
  const ignored = local(root, ["ls-files", "--others", "--ignored", "--exclude-standard"], "核对 Clone 被忽略文件");
  if (ignored) throw new UnknownError("临时 Clone 存在被 Git 忽略的文件，保留现场");
  const remoteRef = "refs/remotes/origin/" + source.branch;
  authenticated(root, source, ["fetch", "origin", "refs/heads/" + source.branch + ":" + remoteRef], "Cleanup 前核对远端", undefined, remote);
  if (runCommand(["git", "merge-base", "--is-ancestor", "HEAD", remoteRef], root).status !== 0) {
    throw new UnknownError("临时 Clone 存在未 Push Commit 或分叉，保留现场");
  }
  // No concurrent operation may use this root; the caller invokes cleanup only after the group has stopped.
  rmSync(root, { recursive: true });
  if (existsSync(root)) throw new UnknownError("临时 Clone 清理后仍存在");
  return { removed: true };
}

function argsOf(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--") && argv[i + 1] && !argv[i + 1].startsWith("--")) {
    args[argv[i].slice(2)] = argv[++i];
  }
  return args;
}

async function invoke(action: "clone" | "cleanup", argv: string[]): Promise<number> {
  try {
    const args = argsOf(argv);
    let value: Record<string, unknown>;
    if (action === "clone") {
      if (!args.issue || !args.config) return 64;
      if (!args.workdir) {
        process.stderr.write("缺少 --workdir：请传入当前 Multica Task workdir 的绝对路径\n");
        return 64;
      }
      const cfg = loadConfig<BaseRegistryConfig>(args.config);
      const issue = new MulticaClient(cfg.runtime).getIssue(args.issue);
      const md = issue.metadata ?? {};
      if (!isRequirementChangeDelivery(md)) throw new FailError("仅 Requirement OpenSpec Change 可以 Clone Closeout 根仓");
      const source = readAnalysisSource(md);
      value = { ...cloneCloseoutRoot(source, args.workdir), repo_url: source.repo_url, branch: source.branch, change_ref: source.change_ref };
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
  for (const action of ["clone", "cleanup"] as const) {
    group.command("root-" + action)
      .description(action === "clone" ? "按 Issue 批准来源准备一次性根仓" : "安全释放本 Run 的根仓 Clone")
      .helpOption(false).allowUnknownOption(true).allowExcessArguments(true)
      .action(async (...values: unknown[]) => {
        markLeafExecuted();
        const cmd = values[values.length - 1] as Command;
        const code = await invoke(action, cmd.args);
        if (code !== 0) throw new ExitSignal(code);
      });
  }
}
