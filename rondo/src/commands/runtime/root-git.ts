/** Per-Change Git publishing. */
import { existsSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertNativeTaskCheckout, assertNativeCheckoutBaseline, nativeCheckoutExpected, readDaemonTaskContext, projectRootResource, type ProjectResource } from "../../clients/native-checkout.js";
import { randomUUID } from "node:crypto";
import { changeTree, developmentTree, mergeChangeTrees, publishedTree } from "./change-tree.js";
import { FailError, UnknownError } from "../../cli/errors.js";
import { git } from "../../clients/git.js";
import { runAuthenticatedGit } from "../../clients/authenticated-git.js";
import { sleepSync } from "../../clients/spawn.js";
import { validateRootRepo } from "../../clients/runtime-paths.js";
import { repositoryUrl } from "../analysis/source.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";

const shaPattern = /^[0-9a-f]{40}$/;
type RootRemote = typeof runAuthenticatedGit;
interface PublishOptions {
  repoUrl: string;
  expectedBranch: string;
  approvedCommit?: string;
  /** Analysis saves its Gate-checked working files before projecting the Change. */
  commitWorkingChange?: boolean;
  fixedSourceCommit?: string;
  /** 在固定来源已 Fetch 且可达后，按当前契约决定是否恢复该版本。 */
  canRecoverFixedSource?: (commit: string, localHead: string) => boolean;
  remote?: RootRemote;
  validateTree?: (commit: string) => void | Promise<void>;
}
function run(root: string, args: string[], operation: string): string {
  const result = git(root, args);
  if (result.status !== 0) throw new UnknownError(operation + ": " + (result.stderr.trim() || result.stdout.trim()).slice(0, 500));
  return result.stdout.trim();
}

function rootPath(arg?: string | null): string {
  if (arg != null) return validateRootRepo(arg, "--root-repo");
  const specified = process.env.RONDO_WORKSPACE_PATH;
  if (!specified) throw new UnknownError("请通过 --root-repo 或 RONDO_WORKSPACE_PATH 指定持久根仓");
  return validateRootRepo(specified, "RONDO_WORKSPACE_PATH");
}

const rootDirectories = ["openspec/schemas", "openspec/changes"];

function assertRootLayout(root: string): void {
  for (const path of rootDirectories) {
    const entry = lstatSync(join(root, path), { throwIfNoEntry: false });
    if (entry?.isDirectory()) continue;
    throw new UnknownError("根仓缺少目录 " + path);
  }
}

export function requirementRoot(arg?: string | null): string {
  const root = rootPath(arg);
  if (!arg && (nativeCheckoutExpected(root) || nativeCheckoutExpected(process.cwd()) ||
      readDaemonTaskContext(process.cwd()))) throw new UnknownError("Native Checkout 必须显式提供 --root-repo");
  assertRootLayout(root);
  return root;
}

/** Verify the actual Git fetch and push identity; the caller supplies its authorized source. */
function rootGitUrls(root: string): { repoUrl: string; fetchUrl: string; pushUrls: string[] } {
  const origins = run(root, ["remote", "get-url", "--all", "origin"], "读取根仓 origin").split(/\r?\n/);
  if (origins.length !== 1) throw new UnknownError("根仓 Origin 非唯一");
  const origin = origins[0];
  const pushUrls = run(root, ["remote", "get-url", "--push", "--all", "origin"], "读取根仓 push origin").split(/\r?\n/);
  const identity = canonicalRepositoryIdentity(origin);
  if (pushUrls.length !== 1 || identity !== canonicalRepositoryIdentity(pushUrls[0])) {
    throw new FailError("根仓 Origin 与 Push URL 不一致");
  }
  return { repoUrl: repositoryUrl(origin).href, fetchUrl: origin, pushUrls };
}

export function rootRepositoryUrl(root: string): string {
  return rootGitUrls(root).repoUrl;
}

/** Resolve the initial publication branch from the matching current Project Resource. */
export function resolveProjectRootBranch(root: string, resources: ProjectResource[], rootUrl: string): string {
  const branch = projectRootResource(resources, rootUrl).ref;
  if (typeof branch !== "string" || !branch || branch.startsWith("-") || branch.startsWith("refs/") ||
      git(root, ["check-ref-format", "refs/heads/" + branch]).status !== 0)
    throw new FailError("根仓 Project Resource ref 必须是有效分支");
  return branch;
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

function rootGitOperation(root: string): string | undefined {
  const gitDir = run(root, ["rev-parse", "--absolute-git-dir"], "定位根仓 Git 目录");
  return ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"]
    .find(name => existsSync(join(gitDir, name)));
}

/** Save only the current analysis Change; preserve unrelated staged/working files. */
function commitWorkingChange(root: string, path: string, allowed: RegExp | undefined, subject: string,
  beforeWrite: () => void): void {
  const prefix = path + "/";
  const status = git(root, ["--literal-pathspecs", "status", "--porcelain=v1", "--no-renames", "--untracked-files=all", "-z", "--", path]);
  if (status.status !== 0) throw new UnknownError("检查 Analysis Change 修改失败: " + status.stderr);
  const isAllowed = (file: string): boolean => file.startsWith(prefix) && (!allowed || allowed.test(file.slice(prefix.length)));
  const entries = status.stdout.split("\0").filter(entry => entry && isAllowed(entry.slice(3)));
  if (!entries.length) return;
  const selected = [...new Set(entries.map(entry => entry.slice(3)))];
  const stage = new Set<string>();
  for (const entry of entries) {
    const xy = entry.slice(0, 2), file = entry.slice(3);
    if (xy.includes("U") || xy === "AA" || xy === "DD") throw new UnknownError("Analysis Change 存在未解决冲突: " + file);
    // A deletion already staged is absent from both the index and working tree.
    if (xy[1] !== " ") stage.add(file);
  }
  beforeWrite();
  const operation = rootGitOperation(root);
  if (operation) throw new UnknownError("根仓 Git 操作仍在进行，已保留现场: " + operation);
  if (stage.size) writeGit(root, ["--literal-pathspecs", "add", "-A", "--", ...stage], "暂存 Analysis Change");
  const staged = git(root, ["--literal-pathspecs", "diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD", "--", ...selected]);
  if (staged.status !== 0) throw new UnknownError("检查 Analysis Change 暂存差异失败: " + staged.stderr);
  const paths = staged.stdout.split("\0").filter(Boolean);
  if (!paths.length) return;
  const marker = randomUUID();
  writeGit(root, ["--literal-pathspecs", "commit", "--only", "-m", subject + "\n\nRondo-Publish: " + marker, "--", ...paths],
    "按路径保存 Analysis Change", () => Boolean(latestMarkedCommit(root, marker)));
  const commit = latestMarkedCommit(root, marker);
  if (!commit) throw new UnknownError("Analysis Change Commit 无法确认");
  const actual = git(root, ["diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", commit]);
  if (actual.status !== 0) throw new UnknownError("核对 Analysis Change Commit 失败: " + actual.stderr);
  if (actual.stdout.split("\0").filter(Boolean).some(file => !isAllowed(file)))
    throw new UnknownError("Analysis Change Commit 包含未授权工件");
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
  const isAncestor = (older: string, newer: string): boolean =>
    git(root, ["merge-base", "--is-ancestor", older, newer]).status === 0;
  let baselineChecked = false;
  const checkBaseline = () => {
    if (native && !options.approvedCommit && !baselineChecked) {
      assertNativeCheckoutBaseline(root, branch);
      baselineChecked = true;
    }
  };
  const checkFixedSource = (tip: string) => {
    if (options.fixedSourceCommit && !isAncestor(options.fixedSourceCommit, tip))
      throw new UnknownError("已有 analysis.source.commit 不在原目标分支，停止发布");
  };
  // Analysis must confirm the target before saving new work. Clean recovery keeps
  // its existing fixed-source fast path; Development still consumes committed work.
  let remoteTip = options.commitWorkingChange ? fetch() : undefined;
  if (options.commitWorkingChange) {
    checkFixedSource(remoteTip!);
    commitWorkingChange(root, path, allowed, subject ?? `analysis: ${changeRef} (${issue})`, checkBaseline);
  }
  const head = run(root, ["rev-parse", "HEAD"], "固定本地提交");
  const source = run(root, ["log", "-1", "--format=%H", head, "--", path], "定位 Change 已提交版本");
  if (!shaPattern.test(source)) throw new FailError("Change 尚未形成 Git Commit: " + path);
  const localTree = changeTree(root, head, path);
  const result = (commit: string, committed: number | string = "skipped_no_changes"): PublishedChange =>
    ({ repo_url: repositoryUrl(target.pushUrls[0]).href, branch, commit, committed, pushed: true });
  remoteTip ??= fetch();
  for (let attempt = 0; attempt < 3; attempt++) {
    checkFixedSource(remoteTip);
    if (attempt === 0) {
      // 固定来源已可达；按本次契约判断是否恢复，不需要重复读取或校验候选。
      const fixed = options.fixedSourceCommit;
      if (fixed && options.canRecoverFixedSource?.(fixed, head)) {
        if (changeTree(root, remoteTip, path) !== changeTree(root, fixed, path))
          throw new UnknownError("原目标分支的 Change 已变化，不能复用旧审核版本");
        return result(fixed);
      }
      checkBaseline();
    }
    const approved = options.approvedCommit;
    const descendsFromApproval = (commit: string): boolean =>
      !approved || isAncestor(approved, commit);
    if (!descendsFromApproval(remoteTip)) throw new FailError("目标分支不含批准的 Analysis SHA: " + approved);
    const receipts = remoteReceipts(root, remoteTip, changeRef);
    const sourceIsRemote = isAncestor(source, remoteTip);
    // A fresh clone can contain a zero-diff receipt after its last path-changing commit.
    const known = receipts.find(r => r.source === source ||
      (sourceIsRemote && isAncestor(source, r.commit) && isAncestor(r.commit, head)));
    const prior = known?.commit ?? (sourceIsRemote ? source : undefined);
    if (prior && descendsFromApproval(prior)) {
      if (!approved && changeTree(root, remoteTip, path) !== changeTree(root, prior, path))
        throw new UnknownError("原目标分支的 Change 已变化，不能复用旧发布记录");
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
