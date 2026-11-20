/** 单个业务仓安全准备主体；不修改根仓、不覆盖已有工作树、不自动 push。 */
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { FailError, UnknownError } from "../../cli/errors.js";
import { git, gitOk } from "../../clients/git.js";
import { runAuthenticatedGit, assertTfsRepository } from "../../clients/authenticated-git.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";

export interface PrepareRepo { repo_path: string; repo_url: string; tfs_repo?: string; tfs_project?: string; default_target_branch: string }
type RemoteGit = typeof runAuthenticatedGit;
const same = (a: string, b: string) => process.platform === "win32" ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);

export function validatePrepareRepo(repo: PrepareRepo | undefined, serverUrl: string): PrepareRepo {
  if (!repo?.repo_url || !repo.repo_path || !repo.default_target_branch) throw new FailError("Registry 缺少 repo_path / repo_url / default_target_branch");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repo.repo_path) || /[. ]$/.test(repo.repo_path) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(repo.repo_path)) throw new FailError("repo_path 必须为安全的直接子目录");
  const url = assertTfsRepository(repo.repo_url, serverUrl);
  const parts = url.pathname.split("/").map(decodeURIComponent);
  if (parts.at(-1)!.toLowerCase() === "winning-platform-monorepo" || repo.repo_path.toLowerCase() === "winning-platform-monorepo") throw new FailError("dev prepare 不允许准备根仓");
  if (!repo.tfs_repo || !repo.tfs_project || repo.tfs_repo.toLowerCase() !== parts.at(-1)!.toLowerCase() ||
      repo.tfs_project.toLowerCase() !== parts.at(-3)!.toLowerCase()) throw new FailError("Registry URL 与 TFS Project / Repository 不一致");
  const ref = repo.default_target_branch;
  if (ref.startsWith("-") || ref.startsWith("refs/") || /[\s~^:?*\[\\\x00-\x1f\x7f]/.test(ref) || ref.includes("..") || ref.includes("@{") ||
      ref.split("/").some(p => !p || p.startsWith(".") || p.endsWith(".") || p.endsWith(".lock"))) throw new FailError("Registry 目标分支名非法");
  return repo;
}

export function validateBusinessPath(root: string, repo: PrepareRepo): string {
  // 在调用者遗漏 Registry 校验时也不得允许路径逃逸。
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repo.repo_path) || /[.]$/.test(repo.repo_path)) throw new FailError("业务仓路径非法");
  const path = join(root, repo.repo_path);
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (entry && (entry.isSymbolicLink() || !entry.isDirectory() || !same(realpathSync(path), path))) throw new FailError("业务仓路径存在链接或越界");
  if (gitOk(root, ["ls-files", "--", repo.repo_path], "检查根仓跟踪边界")) throw new FailError("业务仓目录被根仓跟踪");
  if (git(root, ["check-ignore", "--no-index", "-q", "--", repo.repo_path + "/"]).status !== 0) throw new FailError("业务仓目录未被根仓忽略");
  return path;
}

export function validateBusinessCheckout(path: string, repo: PrepareRepo, branch: string): string {
  const dotgit = join(path, ".git");
  if (!existsSync(dotgit) || lstatSync(dotgit).isSymbolicLink() || !lstatSync(dotgit).isDirectory()) throw new UnknownError("已有目录不是完整独立业务仓，保留现场");
  if (!same(gitOk(path, ["rev-parse", "--show-toplevel"], "核验业务仓根"), path) ||
      !same(gitOk(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"], "核验业务仓 Git 目录"), dotgit)) throw new FailError("业务仓不是独立 Git checkout");
  const origin = gitOk(path, ["remote", "get-url", "--all", "origin"], "核验业务仓 origin");
  const push = gitOk(path, ["remote", "get-url", "--push", "--all", "origin"], "核验业务仓 push URL");
  if (canonicalRepositoryIdentity(origin) !== canonicalRepositoryIdentity(repo.repo_url) ||
      canonicalRepositoryIdentity(push) !== canonicalRepositoryIdentity(repo.repo_url)) throw new FailError("业务仓 origin 与 Registry 不一致");
  if (gitOk(path, ["symbolic-ref", "--short", "HEAD"], "核验候选分支") !== branch) throw new FailError("现有分支不属于当前 Bug；保留 dirty 和未推送 Commit");
  return gitOk(path, ["rev-parse", "HEAD"], "核验候选 HEAD");
}

export function prepareBusinessWorkspace(root: string, repo: PrepareRepo, tfsId: number, remote: RemoteGit = runAuthenticatedGit): Record<string, unknown> {
  if (!Number.isSafeInteger(tfsId) || tfsId <= 0) throw new FailError("TFS Bug ID 无效");
  const branch = `feat/${tfsId}`;
  for (const ref of [branch, repo.default_target_branch]) {
    if (!ref || ref.startsWith("-") || ref.startsWith("refs/") || git(root, ["check-ref-format", `refs/heads/${ref}`]).status !== 0) throw new FailError("候选 / 目标分支名非法");
  }
  if (branch === repo.default_target_branch) throw new FailError("候选分支不得等于交付目标分支");
  const path = validateBusinessPath(root, repo);
  let changed = false;
  if (!existsSync(path)) {
    // clone 时直接选择远端已有同 Bug 分支，支持跨 Task 接续已 push 的内容。
    const refs = remote(repo.repo_url, ["ls-remote", repo.repo_url, `refs/heads/${branch}`, `refs/heads/${repo.default_target_branch}`], root);
    if (refs.status !== 0) throw new UnknownError("读取远端候选 / 目标分支失败，未准备业务仓");
    const names = refs.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => {
      const m = /^([0-9a-f]{40})\s+(refs\/heads\/\S+)$/.exec(line);
      if (!m) throw new UnknownError("远端分支响应无法确认");
      return m[2];
    });
    if (!names.includes(`refs/heads/${repo.default_target_branch}`)) throw new FailError("Registry 目标分支不存在");
    const existing = names.includes(`refs/heads/${branch}`);
    const clone = remote(repo.repo_url, ["clone", "--no-tags", "--single-branch", "--branch", existing ? branch : repo.default_target_branch, "--", repo.repo_url, path], root, 1_200_000);
    if (clone.status !== 0) throw new UnknownError("业务仓 clone 未确认成功；保留现场，禁止自动清理后重试");
    if (!existing) gitOk(path, ["checkout", "-b", branch], "建立 Bug 候选分支");
    changed = true;
  }
  const head = validateBusinessCheckout(path, repo, branch);
  return { result: "PASS", path, repo_url: repo.repo_url, branch, head, changed,
    reason: changed ? "已准备当前 Bug 候选分支" : "已核验并复用；保留 dirty / unpushed，未 fetch 或整合" };
}
