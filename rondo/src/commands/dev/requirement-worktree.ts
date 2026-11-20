/** Requirement branch worktree: shared base clone; never reset/clean or change Bug checkout semantics. */
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { FailError, UnknownError } from "../../cli/errors.js";
import { git, gitOk } from "../../clients/git.js";
import { runAuthenticatedGit } from "../../clients/authenticated-git.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";
import { validatePrepareRepo, validateBusinessPath, type PrepareRepo } from "./prepare-workspace.js";

type Remote = typeof runAuthenticatedGit;
const samePath = (a: string, b: string): boolean => process.platform === "win32"
  ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
function checked(root: string, args: string[], what: string): string {
  return gitOk(root, args, what);
}
function verifyOrigin(repoPath: string, url: string): void {
  for (const args of [["remote", "get-url", "origin"], ["remote", "get-url", "--push", "origin"]]) {
    if (canonicalRepositoryIdentity(checked(repoPath, args, "检查 Origin")) !== canonicalRepositoryIdentity(url)) {
      throw new FailError("业务仓 Origin 不属于批准的 Registry Repository");
    }
  }
}
function candidateBranchExists(path: string, branch: string): boolean {
  return git(path, ["show-ref", "--verify", "--quiet", "refs/heads/" + branch]).status === 0;
}

/** Reentrancy preserves dirty/unpushed Worktree. Another Worktree holding the branch always blocks. */
export function prepareRequirementWorktree(
  root: string, repo: PrepareRepo, tfsId: number, serverUrl: string, remote: Remote = runAuthenticatedGit,
): Record<string, unknown> {
  validatePrepareRepo(repo, serverUrl);
  if (!Number.isSafeInteger(tfsId) || tfsId <= 0) throw new FailError("TFS Requirement ID 非法");
  const branch = "feature/" + tfsId;
  const hub = validateBusinessPath(root, repo);
  const worktreeName = repo.repo_path + "-" + tfsId;
  if (git(root, ["check-ignore", "--no-index", "-q", "--", worktreeName + "/"]).status !== 0 ||
      checked(root, ["ls-files", "--", worktreeName], "检查 Worktree 路径跟踪状态")) {
    throw new FailError("Requirement Worktree 目录未被根仓忽略或已被根仓跟踪");
  }
  const worktree = join(root, worktreeName);
  const entry = lstatSync(worktree, { throwIfNoEntry: false });
  if (entry && (entry.isSymbolicLink() || !entry.isDirectory() || !samePath(realpathSync(worktree), worktree))) {
    throw new FailError("业务 Worktree 目录包含链接或不是普通目录");
  }
  if (existsSync(hub)) {
    const dot = join(hub, ".git");
    if (!existsSync(dot) || !lstatSync(dot).isDirectory() ||
        !samePath(checked(hub, ["rev-parse", "--show-toplevel"], "检查基础仓根"), hub)) {
      throw new UnknownError("已有业务基础仓不是独立 Git checkout，保留现场");
    }
    verifyOrigin(hub, repo.repo_url);
  } else {
    const cloned = remote(repo.repo_url, ["clone", "--no-tags", "--branch", repo.default_target_branch,
      "--", repo.repo_url, hub], root, 1_200_000);
    if (cloned.status !== 0) throw new UnknownError("基础仓 Clone 失败，保留已有现场: " + cloned.stderr.slice(0, 240));
    verifyOrigin(hub, repo.repo_url);
  }
  const wtExists = existsSync(worktree);
  if (wtExists) {
    if (!existsSync(join(worktree, ".git")) || lstatSync(join(worktree, ".git")).isDirectory() ||
        !samePath(checked(worktree, ["rev-parse", "--show-toplevel"], "检查 Worktree 根"), worktree) ||
        !samePath(checked(worktree, ["rev-parse", "--path-format=absolute", "--git-common-dir"], "检查 Worktree 归属"), join(hub, ".git")) ||
        checked(worktree, ["symbolic-ref", "--short", "HEAD"], "检查 Worktree 分支") !== branch) {
      throw new FailError("已有目录不是本 Requirement 的 Worktree，保留现场");
    }
    verifyOrigin(worktree, repo.repo_url);
    return { result: "PASS", path: worktree, base: hub, branch, head: checked(worktree, ["rev-parse", "HEAD"], "读取 Worktree HEAD"), changed: false };
  }
  // Remote discovery before branch creation; source can already exist from another Runtime.
  const refs = remote(repo.repo_url, ["ls-remote", repo.repo_url,
    "refs/heads/" + repo.default_target_branch, "refs/heads/" + branch], hub);
  if (refs.status !== 0) throw new UnknownError("读取业务远端分支失败: " + refs.stderr.slice(0, 240));
  const refNames = refs.stdout.split(/\r?\n/).filter(Boolean).map(line => line.split(/\s+/)[1]);
  if (!refNames.includes("refs/heads/" + repo.default_target_branch)) throw new FailError("目标分支不存在: " + repo.default_target_branch);
  const candidateExists = refNames.includes("refs/heads/" + branch);
  const fetch = remote(repo.repo_url, ["fetch", "origin", "refs/heads/" + repo.default_target_branch + ":refs/remotes/origin/" + repo.default_target_branch,
    ...(candidateExists ? ["refs/heads/" + branch + ":refs/remotes/origin/" + branch] : [])], hub);
  if (fetch.status !== 0) throw new UnknownError("Fetch 业务候选 / 目标失败，保留现场");
  let args: string[];
  if (candidateBranchExists(hub, branch)) {
    if (candidateExists) {
      const local = checked(hub, ["rev-parse", "refs/heads/" + branch], "读取本地候选");
      const published = checked(hub, ["rev-parse", "refs/remotes/origin/" + branch], "读取远端候选");
      if (local !== published) {
        if (git(hub, ["merge-base", "--is-ancestor", local, published]).status !== 0) {
          throw new FailError("本地候选与远端 feature 分支存在未推送或分叉提交；保留现场");
        }
        checked(hub, ["branch", "-f", branch, published], "安全快进未检出的本地候选");
      }
    }
    args = ["worktree", "add", worktree, branch];
  } else args = ["worktree", "add", "-b", branch, worktree,
    "origin/" + (candidateExists ? branch : repo.default_target_branch)];
  const add = git(hub, args);
  if (add.status !== 0) throw new UnknownError("创建 Worktree 未确认，保留现场: " + add.stderr.slice(0, 350));
  if (!samePath(checked(worktree, ["rev-parse", "--path-format=absolute", "--git-common-dir"], "核验新 Worktree"), join(hub, ".git"))) {
    throw new UnknownError("新 Worktree 归属与业务基础仓不一致");
  }
  return { result: "PASS", path: worktree, base: hub, branch, head: checked(worktree, ["rev-parse", "HEAD"], "读取新 Worktree HEAD"), changed: true };
}
