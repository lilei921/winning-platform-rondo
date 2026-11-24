/** Non-destructive persistent root synchronization and per-Change Git publishing. */
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertNativeTaskCheckout, assertNativeCheckoutBaseline, nativeCheckoutExpected } from "../../clients/native-checkout.js";
import { randomUUID } from "node:crypto";
import { changeTree, developmentTree, mergeChangeTrees, publishedTree } from "./change-tree.js";
import { FailError, UnknownError } from "../../cli/errors.js";
import { git, gitRuntime, withTemporaryIndex } from "../../clients/git.js";
import { logLine } from "../../cli/output.js";
import { runAuthenticatedGit } from "../../clients/authenticated-git.js";
import { runCommand, sleepSync } from "../../clients/spawn.js";
import { validateRootRepo } from "../../clients/runtime-paths.js";
import { repositoryUrl } from "../analysis/source.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";

const shaPattern = /^[0-9a-f]{40}$/;
type RootRemote = typeof runAuthenticatedGit;
interface PublishOptions {
  repoUrl: string;
  expectedBranch: string;
  approvedCommit?: string;
  recoverCommit?: string;
  remote?: RootRemote;
  validateTree?: (commit: string) => void | Promise<void>;
}
function run(root: string, args: string[], operation: string): string {
  const result = git(root, args);
  if (result.status !== 0) throw new UnknownError(operation + ": " + (result.stderr.trim() || result.stdout.trim()).slice(0, 500));
  return result.stdout.trim();
}

function rootPath(arg?: string | null): string {
  const specified = arg || process.env.RONDO_WORKSPACE_PATH;
  if (!specified) throw new UnknownError("请通过 --root-repo 或 RONDO_WORKSPACE_PATH 指定持久根仓");
  return validateRootRepo(specified, arg ? "--root-repo" : "RONDO_WORKSPACE_PATH");
}

const rootMapping = "docs/config/repo-context.yaml";
const rootDirectories = ["openspec/schemas", "openspec/changes"];

function assertRootLayout(root: string, preserveChangeDeletion = false): void {
  if (!lstatSync(join(root, rootMapping), { throwIfNoEntry: false })?.isFile()) {
    throw new UnknownError("根仓缺少文件 " + rootMapping);
  }
  for (const path of rootDirectories) {
    const entry = lstatSync(join(root, path), { throwIfNoEntry: false });
    if (entry?.isDirectory()) continue;
    // A sparse checkout is missing a directory without a diff. A local deletion is real WIP.
    if (!entry && preserveChangeDeletion && path === "openspec/changes" &&
        git(root, ["diff", "--quiet", "--no-ext-diff", "HEAD", "--", path]).status === 1) continue;
    throw new UnknownError("根仓缺少目录 " + path);
  }
}

export function requirementRoot(arg?: string | null): string {
  const root = rootPath(arg);
  if (!arg && nativeCheckoutExpected(root)) throw new UnknownError("Native Checkout 必须显式提供 --root-repo");
  assertRootLayout(root);
  return root;
}

/** Check root identity against the existing repository mapping, not a second registry. */
function rootGitUrls(root: string, revision = "HEAD"): { repoUrl: string; fetchUrl: string; pushUrls: string[] } {
  const yaml = run(root, ["show", revision + ":docs/config/repo-context.yaml"], "读取已提交的根仓映射");
  const match = yaml.match(/^[ \t]*-[ \t]+repo_id:[ \t]*root[ \t]*\r?\n([\s\S]*?)(?=^[ \t]*-[ \t]+repo_id:|$(?![\s\S]))/m);
  const raw = match?.[1].match(/^[ \t]*repo_url:[ \t]*(\S+)[ \t]*$/m)?.[1];
  if (!raw) throw new UnknownError("根仓 repo-context.yaml 缺少 root.repo_url");
  const origins = run(root, ["remote", "get-url", "--all", "origin"], "读取根仓 origin").split(/\r?\n/);
  if (origins.length !== 1) throw new UnknownError("根仓 Origin 非唯一");
  const origin = origins[0];
  const pushUrls = run(root, ["remote", "get-url", "--push", "--all", "origin"], "读取根仓 push origin").split(/\r?\n/);
  const identity = canonicalRepositoryIdentity(raw);
  if (pushUrls.length !== 1 || identity !== canonicalRepositoryIdentity(origin) || identity !== canonicalRepositoryIdentity(pushUrls[0])) {
    throw new FailError("根仓 Origin 与 repo-context.yaml 的 root.repo_url 不一致");
  }
  return { repoUrl: repositoryUrl(raw).href, fetchUrl: origin, pushUrls };
}

export function rootRepositoryUrl(root: string, revision = "HEAD"): string {
  return rootGitUrls(root, revision).repoUrl;
}

/** Resolve the first Native publication from the current Issue's injected Project Resource. */
export function resolveProjectRootBranch(root: string, projectId: unknown, fixedBranch?: string): string {
  const repo = canonicalRepositoryIdentity(rootRepositoryUrl(root));
  let project: { project_id?: unknown; resources?: Array<{ resource_type?: unknown; resource_ref?: { url?: unknown; ref?: unknown } }> };
  try { project = JSON.parse(readFileSync(join(dirname(root), ".multica", "project", "resources.json"), "utf8")); }
  catch { throw new UnknownError("无法读取当前 Task 的 Project Resource"); }
  if (!project || typeof projectId !== "string" || !projectId || project.project_id !== projectId || !Array.isArray(project.resources))
    throw new UnknownError("Project Resource 与当前 Issue 的 Project 身份不一致");
  const matches = project.resources.filter(row => {
    if (row?.resource_type !== "github_repo" || typeof row.resource_ref?.url !== "string") return false;
    try { return canonicalRepositoryIdentity(row.resource_ref.url) === repo; }
    catch { return false; }
  });
  if (matches.length !== 1) throw new UnknownError("根仓 URL 对应的 Project Resource 缺失或不唯一");
  const branch = fixedBranch ?? matches[0].resource_ref?.ref;
  if (typeof branch !== "string" || !branch || branch.startsWith("-") || branch.startsWith("refs/") ||
      git(root, ["check-ref-format", "refs/heads/" + branch]).status !== 0)
    throw new FailError("根仓 Project Resource ref 必须是有效分支");
  return branch;
}

export function requirementBranch(): string {
  const branch = process.env.RONDO_WORKSPACE_BRANCH;
  if (!branch) throw new UnknownError("请配置 RONDO_WORKSPACE_BRANCH 后再准备根仓");
  return branch;
}

function rootChanges(root: string): string[] {
  const status = git(root, ["status", "--porcelain=v1", "--no-renames", "--untracked-files=all", "-z"]);
  if (status.status !== 0) throw new UnknownError("检查根仓 WIP 失败: " + status.stderr);
  return status.stdout.split("\0").filter(Boolean);
}

/** Path-limited commits leave other groups' staged changes in the index. */
function saveRootChanges(root: string): void {
  type PathEdits = { staged: boolean; working: boolean; untracked: boolean };
  const groups = new Map<string, Map<string, PathEdits>>();
  for (const entry of rootChanges(root)) {
    const xy = entry.slice(0, 2), path = entry.slice(3);
    if (xy.includes("U") || xy === "AA" || xy === "DD") throw new UnknownError("根仓冲突尚未解决: " + path);
    const change = /^openspec\/changes\/([^/]+)\//.exec(path)?.[1];
    const key = change && change !== "archive" ? change : "";
    const paths = groups.get(key) ?? new Map<string, PathEdits>();
    const edits = paths.get(path) ?? { staged: false, working: false, untracked: false };
    // A staged deletion followed by an untracked replacement produces two records for one path.
    edits.staged ||= xy[0] !== " " && xy !== "??";
    edits.working ||= xy[1] !== " ";
    edits.untracked ||= xy === "??";
    paths.set(path, edits);
    groups.set(key, paths);
  }
  if (!groups.size) return;
  withTemporaryIndex(root, (index, dir) => {
    let stagedTree: string | undefined;
    const file = join(dir, "paths");
    const fromFile = ["--pathspec-file-nul", "--pathspec-from-file=" + file];
    const select = (paths: string[]) => writeFileSync(file, paths.join("\0") + "\0");
    for (const [change, entries] of groups) {
      const paths = [...entries.keys()];
      const subject = "WIP: " + (change || "shared root changes");
      const partial = paths.filter(path => entries.get(path)!.staged && entries.get(path)!.working);
      if (partial.length) {
        // Preserve the staged version in this group's history before committing the working copy.
        stagedTree ??= writeGit(root, ["write-tree"], "固定原暂存版本");
        select(partial);
        index(["read-tree", "HEAD"]);
        index(["--literal-pathspecs", "restore", "--staged", "--source=" + stagedTree, ...fromFile]);
        index(["commit", "-m", subject + " (staged)"]);
      }
      const untracked = paths.filter(path => entries.get(path)!.untracked);
      if (untracked.length) {
        select(untracked);
        writeGit(root, ["--literal-pathspecs", "add", ...fromFile], "暂存新增文件");
      }
      select(paths);
      writeGit(root, ["--literal-pathspecs", "commit", "--only", "-m", subject, ...fromFile], "保存原分支改动",
        () => !rootChanges(root).some(entry => entries.has(entry.slice(3))));
    }
  });
  if (run(root, ["status", "--porcelain"], "确认原分支保存结果")) throw new UnknownError("原分支仍有未保存改动，保留现场");
}

/** Git protects branches occupied by a worktree, even when a rebase or bisect detached its HEAD. */
function checkWorktreeOccupancy(root: string, source: string, target: string): void {
  const runtime = gitRuntime({ ...process.env, GIT_ALLOW_PROTOCOL: "file", LC_ALL: "C" });
  const check = runCommand([runtime.executable, "fetch", "--dry-run", "--no-write-fetch-head", "--no-tags",
    "--no-recurse-submodules", "--no-auto-maintenance", root, source + ":" + target], root, runtime.env);
  if (check.status !== 0) {
    if (check.stderr.includes("checked out at")) throw new FailError("根仓分支被占用: " + check.stderr.trim());
    throw new UnknownError("无法确认根仓分支占用: " + check.stderr.trim());
  }
}

export function prepareRoot(arg?: string | null, legacyBranch?: string, remote: RootRemote = runAuthenticatedGit): Record<string, unknown> {
  const branch = requirementBranch();
  const root = rootPath(arg);
  if (legacyBranch && legacyBranch !== branch) logLine("采用 RONDO_WORKSPACE_BRANCH=" + branch + "（忽略 --branch " + legacyBranch + "）");
  const valid = git(root, ["check-ref-format", "--branch", branch]);
  if (valid.status !== 0 || valid.stdout.trim() !== branch || branch.startsWith("refs/")) throw new FailError("根仓分支名非法: " + branch);
  const { fetchUrl } = rootGitUrls(root);
  const localRef = "refs/heads/" + branch, remoteRef = "refs/remotes/origin/" + branch;
  const fetched = remote(fetchUrl, ["fetch", "--no-tags", "origin", "+" + localRef + ":" + remoteRef], root);
  let remoteTip: string | null = null;
  if (fetched.status === 0) {
    remoteTip = run(root, ["rev-parse", "--verify", remoteRef], "读取根仓远端分支");
  } else {
    // An old tracking ref can survive branch deletion. Only a successful remote query proves absence.
    const probe = remote(fetchUrl, ["ls-remote", "--exit-code", "--heads", "origin", localRef], root);
    if (probe.status !== 2) throw new UnknownError("Fetch 根仓分支 " + branch + " 失败: " + fetched.stderr.trim().slice(0, 500));
  }
  const local = git(root, ["rev-parse", "--verify", "--quiet", localRef]);
  if (local.status > 1) throw new UnknownError("读取根仓本地分支失败: " + local.stderr);
  const localTip = local.stdout.trim();
  const targetTip = localTip || remoteTip;
  if (!targetTip) throw new FailError("本地与远端均无根仓分支: " + branch);

  let finalTip = targetTip;
  if (localTip && remoteTip && localTip !== remoteTip) {
    const ancestor = git(root, ["merge-base", "--is-ancestor", localTip, remoteTip]);
    if (ancestor.status === 0) finalTip = remoteTip;
    else if (ancestor.status !== 1) throw new UnknownError("无法核验根仓历史: " + ancestor.stderr);
  }
  const current = run(root, ["symbolic-ref", "HEAD"], "检查根仓分支");
  const switched = current !== localRef;
  const fastForward = Boolean(localTip && localTip !== finalTip);
  if (switched) checkWorktreeOccupancy(root, localTip ? localRef : remoteRef, localRef);
  // Validate the tree that will be consumed before touching the current index or branch.
  const entries = run(root, ["ls-tree", "-z", "--format=%(objectmode) %(path)", finalTip, "--", rootMapping, ...rootDirectories],
    "核对目标根仓布局").split("\0");
  if (!entries.includes("100644 " + rootMapping) && !entries.includes("100755 " + rootMapping)) {
    throw new FailError("目标分支 " + branch + " 缺少普通文件 " + rootMapping);
  }
  for (const path of rootDirectories) {
    if (!entries.includes("040000 " + path)) throw new FailError("目标分支 " + branch + " 缺少目录 " + path);
  }
  if (switched || fastForward) rootRepositoryUrl(root, finalTip);
  if (switched) {
    // Even a commit with a private index would consume the current worktree's MERGE_HEAD.
    const gitDir = run(root, ["rev-parse", "--absolute-git-dir"], "定位根仓 Git 目录");
    const operation = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"]
      .find(name => existsSync(join(gitDir, name)));
    if (operation) throw new UnknownError("原分支 Git 操作仍在进行，已保留现场: " + operation);
    if (!localTip) {
      // A single-branch clone needs the new tracking refspec for @{upstream} and later fetches.
      const refspecs = git(root, ["config", "--get-all", "remote.origin.fetch"]).stdout.split(/\r?\n/).map(spec => spec.replace(/^\+/, ""));
      if (!refspecs.includes("refs/heads/*:refs/remotes/origin/*") && !refspecs.includes(localRef + ":" + remoteRef)) {
        run(root, ["remote", "set-branches", "--add", "origin", branch], "登记根仓跟踪分支");
      }
    }
    saveRootChanges(root);
    const args = localTip ? [branch] : ["--track", "-c", branch, remoteRef];
    run(root, ["switch", "--no-overwrite-ignore", ...args], "切换根仓分支 " + branch);
  }

  const dirty = run(root, ["status", "--porcelain", "--untracked-files=all"], "检查根仓 WIP");
  if (fastForward) {
    run(root, ["merge", "--ff-only", "--no-autostash", "--no-overwrite-ignore", finalTip], "根仓不能安全 Fast-forward（已保留 WIP）");
  }
  if (run(root, ["rev-parse", "HEAD"], "核对实际根仓版本") !== finalTip) throw new UnknownError("根仓分支在准备期间发生变化，请重试");
  assertRootLayout(root, !switched);
  const normative = [rootMapping, "openspec/schemas", "openspec/specs"];
  if (run(root, ["status", "--porcelain", "--untracked-files=all", "--", ...normative], "检查根仓规范")) {
    throw new UnknownError("Schema / Specs / Repository Mapping 存在未提交变更，拒绝使用不确定的规范");
  }
  return { root_repo: root, branch, remote_commit: remoteTip, updated: switched || fastForward, preserved_wip: Boolean(dirty) };
}

function latestMarkedCommit(root: string, marker: string): string | null {
  const r = git(root, ["log", "-1", "--format=%H", "--fixed-strings", "--grep=Rondo-Publish: " + marker]);
  const found = r.stdout.trim();
  return r.status === 0 && shaPattern.test(found) ? found : null;
}

/** Retry only a proven short-lived Git index lock, never delete the lock. */
function writeGit(root: string, args: string[], what: string, confirmed?: () => boolean): string {
  for (let i = 0; ; i++) {
    const r = git(root, args);
    if (r.status === 0 || confirmed?.()) return r.stdout.trim();
    if (i === 2 || !/index\.lock|could not lock index|Unable to create .*\.lock/i.test(r.stderr)) {
      throw new UnknownError(what + ": " + (r.stderr.trim() || r.stdout.trim()).slice(0, 500));
    }
    sleepSync((i + 1) * 100);
  }
}

function published(root: string, commit: string, branch: string): boolean {
  return git(root, ["merge-base", "--is-ancestor", commit, "refs/remotes/origin/" + branch]).status === 0;
}

/** Co-publish sibling Change commits only when their paths and Rondo receipt are verified. */
export function outgoing(root: string, branch: string, tip: string, allowedPrefix: string): void {
  if (git(root, ["merge-base", "--is-ancestor", "origin/" + branch, tip]).status !== 0) {
    throw new UnknownError("待推送分支与远端分叉");
  }
  const commits = run(root, ["rev-list", "origin/" + branch + ".." + tip], "检查待推送历史").split(/\r?\n/).filter(Boolean);
  for (const commit of commits) {
    const parents = run(root, ["rev-list", "--parents", "-n", "1", commit], "核对待推送历史结构").split(/\s+/);
    if (parents.length !== 2) throw new UnknownError("待推送历史包含 Merge 或无父 Commit，无法确认按路径授权");
    const paths = run(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", commit], "检查待推送 Commit")
      .split(/\r?\n/).filter(Boolean);
    if (!paths.length) throw new UnknownError("待推送历史包含空 Commit，无法确认发布授权");
    if (paths.every(path => path.startsWith(allowedPrefix))) continue;
    const sibling = /^openspec\/changes\/([A-Za-z0-9][A-Za-z0-9._-]*)\//.exec(paths[0]);
    if (!sibling || !paths.every(path => path.startsWith("openspec/changes/" + sibling[1] + "/"))) {
      throw new UnknownError("Push 会携带非本 Change 范围的 Commit，保留现场");
    }
    const message = run(root, ["show", "-s", "--format=%B", commit], "核对其他 Change 发布凭据");
    const first = message.split(/\r?\n/)[0];
    const receipt = /^Rondo-Publish: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/m.test(message);
    if (!((first.startsWith("analysis: " + sibling[1] + " (") || first.startsWith("change: " + sibling[1] + " (")) && receipt)) {
      throw new UnknownError("其他 Change 的 Commit 缺少 Rondo 受控发布标记，禁止夹带");
    }
  }
}

export interface PublishedChange { repo_url: string; branch: string; commit: string; committed: number | string; pushed: boolean }

/** The source path commit is stable when another Change advances the shared local branch. */
function remoteReceipts(root: string, remoteTip: string, changeRef: string): Array<{ commit: string; source: string }> {
  // A content-equivalent publication has a receipt but no path diff.
  const log = run(root, ["log", "--fixed-strings", "--grep=Rondo-Source: " + changeRef + " ",
    "--format=%H %P %(trailers:key=Rondo-Source,valueonly)", remoteTip],
    "读取远端 Change 发布记录");
  return log.split(/\r?\n/).flatMap(line => {
    const [commit, parent, ref, source] = line.trim().split(" ");
    if (ref !== changeRef || !shaPattern.test(commit) || !shaPattern.test(parent) || !shaPattern.test(source)) return [];
    // A copied trailer on a sibling or mixed commit is not a receipt for this Change.
    const outside = git(root, ["diff", "--quiet", "--no-ext-diff", "--no-renames", parent, commit,
      "--", ".", ":(top,exclude)openspec/changes/" + changeRef]);
    if (outside.status === 1) return [];
    if (outside.status !== 0) throw new UnknownError("无法核对根仓发布记录: " + outside.stderr);
    return [{ commit, source }];
  });
}

function authorizedPaths(root: string, before: string, after: string, allowed?: RegExp): string[] {
  const diff = git(root, ["diff", "--name-only", "--no-renames", "-z", before, after]);
  if (diff.status !== 0) throw new UnknownError("无法核对已提交工件: " + diff.stderr);
  const paths = diff.stdout.split("\0").filter(Boolean);
  const forbidden = allowed ? paths.filter(p => !allowed.test(p)) : [];
  if (forbidden.length) throw new FailError("存在不允许发布的 Change 工件: " + forbidden.join(", "));
  return paths;
}

/** Concurrent Changes share origin/<branch>. Retry a proven local tracking-ref race only. */
function fetchPublishBase(root: string, url: string, branch: string, remote: RootRemote): string {
  const ref = "refs/remotes/origin/" + branch;
  for (let attempt = 1; ; attempt++) {
    const res = remote(url, ["fetch", "origin", "+refs/heads/" + branch + ":" + ref], root);
    if (res.status === 0) return run(root, ["rev-parse", ref], "定位远端版本");
    const error = res.stderr.trim() || res.stdout.trim();
    const refRace = error.includes(ref) && /incorrect old value|is at [0-9a-f]+ but expected|cannot lock ref.*\.lock.*File exists/is.test(error);
    if (!refRace || attempt === 3) throw new UnknownError("回读根仓远端: " + error.slice(0, 500));
    sleepSync(attempt * 100);
  }
}

async function publishCommittedChange(
  root: string, changeRef: string, issue: string, allowed: RegExp | undefined, subject: string | undefined, options: PublishOptions,
): Promise<PublishedChange> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(changeRef)) throw new FailError("Change 名称非法");
  const path = "openspec/changes/" + changeRef;
  const { expectedBranch: branch, repoUrl, remote = runAuthenticatedGit } = options;
  const native = nativeCheckoutExpected(root);
  if (git(root, ["check-ref-format", "refs/heads/" + branch]).status !== 0 || branch.startsWith("-") || branch.startsWith("refs/"))
    throw new FailError("根仓发布目标分支非法");
  const checkTarget = () => {
    const target = rootGitUrls(root);
    if (native) assertNativeTaskCheckout(root, dirname(root));
    if (target.pushUrls.length !== 1 || canonicalRepositoryIdentity(target.repoUrl) !== canonicalRepositoryIdentity(repoUrl) ||
        (!native && run(root, ["symbolic-ref", "--short", "HEAD"], "核对根仓分支") !== branch)) {
      throw new FailError("根仓 Origin / Branch 与批准的发布目标不一致");
    }
    return target;
  };
  let target = checkTarget();
  const branchRef = "refs/heads/" + branch;
  const fetch = () => fetchPublishBase(root, target.fetchUrl, branch, remote);
  const head = run(root, ["rev-parse", "HEAD"], "固定本地提交");
  const source = run(root, ["log", "-1", "--format=%H", head, "--", path], "定位 Change 已提交版本");
  if (!shaPattern.test(source)) throw new FailError("Change 尚未形成 Git Commit: " + path);
  const localTree = changeTree(root, head, path);
  const result = (commit: string, committed: number | string = "skipped_no_changes"): PublishedChange =>
    ({ repo_url: repositoryUrl(target.pushUrls[0]).href, branch, commit, committed, pushed: true });
  const isAncestor = (older: string, newer: string): boolean =>
    git(root, ["merge-base", "--is-ancestor", older, newer]).status === 0;
  let remoteTip = fetch();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (native && !options.approvedCommit) assertNativeCheckoutBaseline(root, branch);
    const approved = options.approvedCommit;
    const descendsFromApproval = (commit: string): boolean =>
      !approved || isAncestor(approved, commit);
    if (!descendsFromApproval(remoteTip)) throw new FailError("目标分支不含批准的 Analysis SHA: " + approved);
    if (options.recoverCommit) {
      if (!shaPattern.test(options.recoverCommit) || !isAncestor(options.recoverCommit, remoteTip))
        throw new UnknownError("已固定的分析发布 Commit 不在原目标分支，停止恢复");
      await options.validateTree?.(options.recoverCommit);
      return result(options.recoverCommit);
    }
    const receipts = remoteReceipts(root, remoteTip, changeRef);
    const sourceIsRemote = isAncestor(source, remoteTip);
    // A fresh clone can contain a zero-diff receipt after its last path-changing commit.
    const known = receipts.find(r => r.source === source ||
      (sourceIsRemote && isAncestor(source, r.commit) && isAncestor(r.commit, head)));
    const prior = known?.commit ?? (sourceIsRemote ? source : undefined);
    if (prior && descendsFromApproval(prior)) {
      await options.validateTree?.(prior);
      return result(prior);
    }

    let base = run(root, ["merge-base", head, remoteTip], "定位 Change 共同基线");
    let publishedBase = base;
    // The previous publication may be a projected commit absent from local history.
    // Use its corresponding local source as the ancestor for the next Change delta.
    for (const receipt of receipts) {
      if (isAncestor(base, receipt.source) && isAncestor(receipt.source, head)) {
        base = receipt.source;
        publishedBase = receipt.commit;
        break;
      }
    }
    let baseTree = changeTree(root, base, path);
    let proposed = localTree;
    if (approved && (publishedBase === approved || !descendsFromApproval(publishedBase))) {
      const approvedTree = changeTree(root, approved, path);
      if (approvedTree !== baseTree) proposed = developmentTree(root, path, baseTree, localTree, approvedTree);
      baseTree = approvedTree;
    }
    const remoteTree = changeTree(root, remoteTip, path);
    const merged = mergeChangeTrees(root, path, baseTree, proposed, remoteTree, Boolean(approved));
    // Even if another commit already contains the same delta, record which local
    // source was accepted so its next edit (including an undo) uses the right base.
    const paths = authorizedPaths(root, remoteTree, merged, allowed);
    const tree = paths.length ? publishedTree(root, remoteTip, path, merged)
      : run(root, ["rev-parse", remoteTip + "^{tree}"], "读取等价发布的 Git Tree");
    const title = subject ?? `change: ${changeRef} (${issue})`;
    const candidate = run(root, ["commit-tree", tree, "-p", remoteTip, "-m", title, "-m",
      `Rondo-Source: ${changeRef} ${source}`], "构造单 Change 发布提交");
    await options.validateTree?.(candidate);
    target = checkTarget();
    let failure: string;
    try {
      const push = remote(target.pushUrls[0], ["push", "origin", candidate + ":" + branchRef], root);
      failure = push.stderr.trim();
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
    // A transport exception can occur after the remote accepted the commit.
    const observed = fetch();
    if (isAncestor(candidate, observed)) return result(candidate, paths.length);
    if (observed === remoteTip) throw new UnknownError("根仓 Push 未确认: " + failure.slice(0, 500));
    remoteTip = observed;
  }
  throw new UnknownError("根仓 Push 连续竞争，保留现场后重试");
}

/** Store actual commit SHA, not a shared HEAD that another Change can advance. */
export function publishChange(root: string, changeRef: string, issue: string, allowed?: RegExp, subject?: string): PublishedChange;
export function publishChange(root: string, changeRef: string, issue: string, allowed: RegExp | undefined,
  subject: string | undefined, options: PublishOptions): Promise<PublishedChange>;
export function publishChange(root: string, changeRef: string, issue: string, allowed?: RegExp, subject?: string,
  options?: PublishOptions): PublishedChange | Promise<PublishedChange> {
  if (options) return publishCommittedChange(root, changeRef, issue, allowed, subject, options);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(changeRef)) throw new FailError("Change 名称非法");
  const prefix = "openspec/changes/" + changeRef + "/";
  const branch = run(root, ["symbolic-ref", "--short", "HEAD"], "定位根仓分支");
  const pushUrls = run(root, ["remote", "get-url", "--push", "--all", "origin"], "读取推送地址").split(/\r?\n/);
  if (pushUrls.length !== 1) throw new UnknownError("根仓 Push origin 非唯一");
  const repoUrl = repositoryUrl(pushUrls[0]).href;
  const fetch = (): void => { run(root, ["fetch", "origin", branch], "回读根仓远端"); };
  const changed = run(root, ["-c", "core.quotepath=false", "status", "--porcelain", "--untracked-files=all", "--", prefix], "检查 Change 修改");
  // Keep historical analysis complete count: an entirely untracked Change directory is one status entry.
  const changedEntryCount = run(root, ["-c", "core.quotepath=false", "status", "--porcelain", "--", prefix], "核对 Change 改动计数")
    .split(/\r?\n/).filter(Boolean).length;
  if (allowed && changed.split(/\r?\n/).filter(Boolean).some(line => {
    const path = line.slice(3).replace(/^"|"$/g, "");
    return !path.startsWith(prefix) || !allowed.test(path.slice(prefix.length));
  })) throw new FailError("存在不允许发布的 Change 工件");
  let commit: string;
  let committed: number | string = "skipped_no_changes";
  const marker = randomUUID();
  if (changed) {
    writeGit(root, ["add", "-A", "--", prefix], "暂存 Change");
    writeGit(root, ["commit", "--only", "-m", (subject ?? ("change: " + changeRef + " (" + issue + ")")) + "\n\nRondo-Publish: " + marker, "--", prefix], "按路径 Commit",
      () => Boolean(latestMarkedCommit(root, marker)));
    commit = latestMarkedCommit(root, marker) ?? "";
    if (!shaPattern.test(commit)) throw new UnknownError("按路径 Commit 的实际 SHA 无法确定");
    const files = run(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", commit], "核对 Commit 内容");
    if (files.split(/\r?\n/).filter(Boolean).some(p => !p.startsWith(prefix))) throw new UnknownError("Commit 包含当前 Change 以外的文件");
    committed = changedEntryCount;
  } else {
    commit = run(root, ["log", "-1", "--format=%H", "--", prefix], "定位已有 Change 版本");
    if (!shaPattern.test(commit)) throw new UnknownError("Change 尚未形成 Git Commit");
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    fetch();
    if (published(root, commit, branch)) return { repo_url: repoUrl, branch, commit, committed, pushed: true };
    let tip = run(root, ["rev-parse", "HEAD"], "固定 Push tip");
    if (git(root, ["merge-base", "--is-ancestor", "origin/" + branch, tip]).status !== 0) {
      if (committed === "skipped_no_changes" ||
          run(root, ["status", "--porcelain", "--untracked-files=all"], "检查根仓 WIP")) {
        throw new UnknownError("Push 竞争且根仓存在 WIP 或未确认提交；不自动 Rebase");
      }
      const base = run(root, ["merge-base", "origin/" + branch, "HEAD"], "定位重放基线");
      const unpublished = run(root, ["rev-list", base + "..HEAD"], "核对本地待重放 Commit");
      for (const sha of unpublished.split(/\r?\n/).filter(Boolean)) {
        const parents = run(root, ["rev-list", "--parents", "-n", "1", sha], "核对待重放历史结构").split(/\s+/);
        if (parents.length !== 2) throw new UnknownError("待重放历史包含 Merge 或无父 Commit，拒绝自动重放");
        const paths = run(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", sha], "核对重放范围");
        if (!paths) throw new UnknownError("待重放历史包含空 Commit，拒绝自动重放");
        if (paths.split(/\r?\n/).filter(Boolean).some(p => !p.startsWith(prefix))) throw new UnknownError("待重放包含其他 Change，停止");
      }
      run(root, ["rebase", "origin/" + branch], "安全重放 Change");
      commit = latestMarkedCommit(root, marker) ?? "";
      if (!shaPattern.test(commit)) throw new UnknownError("重放后无法定位本次 Commit");
      tip = run(root, ["rev-parse", "HEAD"], "固定重放 tip");
    }
    outgoing(root, branch, tip, prefix);
    const push = git(root, ["push", "origin", tip + ":refs/heads/" + branch]);
    fetch();
    if (published(root, commit, branch)) return { repo_url: repoUrl, branch, commit, committed, pushed: true };
    if (push.status !== 0 && !/non-fast-forward|fetch first|stale info|rejected/i.test(push.stderr)) {
      throw new UnknownError("根仓 Push 结果未知: " + push.stderr.trim().slice(0, 400));
    }
    if (attempt === 3) throw new UnknownError("根仓 Push 竞争达到三次，保留现场");
  }
  throw new UnknownError("根仓发布无法确认");
}
