/** 业务仓映射与当前 Checkout 身份校验。 */
import { lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FailError, UnknownError } from "../../cli/errors.js";
import { gitOk } from "../../clients/git.js";
import { assertTfsRepository } from "../../clients/authenticated-git.js";
import { assertNativeTaskCheckout, nativeCheckoutExpected } from "../../clients/native-checkout.js";
import { repositoryName } from "../analysis/source.js";
import { projectRepository, type ProjectResource } from "../../clients/native-checkout.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";

export interface PrepareRepo { repo_path: string; repo_url: string; default_target_branch: string }
const same = (a: string, b: string) => process.platform === "win32" ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);

export function validatePrepareRepo(repo: PrepareRepo | undefined, serverUrl: string): PrepareRepo {
  if (!repo?.repo_url || !repo.repo_path || !repo.default_target_branch) throw new FailError("Project Resource 缺少仓库 URL 或 default_branch_hint");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repo.repo_path) || /[. ]$/.test(repo.repo_path) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(repo.repo_path)) throw new FailError("repo_path 必须为安全的直接子目录");
  const url = assertTfsRepository(repo.repo_url, serverUrl);
  if (repositoryName(url.href) !== repo.repo_path) throw new FailError("业务仓名称与实际仓库 URL 不一致");
  const ref = repo.default_target_branch;
  if (ref.startsWith("-") || ref.startsWith("refs/") || /[\s~^:?*\[\\\x00-\x1f\x7f]/.test(ref) || ref.includes("..") || ref.includes("@{") ||
      ref.split("/").some(p => !p || p.startsWith(".") || p.endsWith(".") || p.endsWith(".lock"))) throw new FailError("Project Resource 目标分支名非法");
  return repo;
}

/** Resolve only the currently authorized business repository, not a project-wide mapping. */
export function resourcePrepareRepo(resources: ProjectResource[], key: string, rootUrl: string, serverUrl: string): PrepareRepo {
  const selected = projectRepository(resources, key);
  if (canonicalRepositoryIdentity(selected.url) === canonicalRepositoryIdentity(rootUrl) ||
      repositoryName(rootUrl) === key) throw new FailError("业务仓不得指向工程契约根仓");
  return validatePrepareRepo({
    repo_path: repositoryName(selected.url), repo_url: selected.url,
    default_target_branch: typeof selected.default_branch_hint === "string" ? selected.default_branch_hint : "",
  }, serverUrl);
}

function validateDirectBusinessPath(parent: string, repo: Pick<PrepareRepo, "repo_path">): string {
  // 业务仓路径不得逃逸当前 Task。
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repo.repo_path) || /[.]$/.test(repo.repo_path)) throw new FailError("业务仓路径非法");
  const path = join(parent, repo.repo_path);
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (entry && (entry.isSymbolicLink() || !entry.isDirectory() || !same(realpathSync(path), path))) throw new FailError("业务仓路径存在链接或越界");
  return path;
}

/** Native repositories are siblings under the current Task workdir. */
export function resolveNativeBusinessPath(root: string, repo: Pick<PrepareRepo, "repo_path">): string {
  const path = validateDirectBusinessPath(dirname(root), repo);
  if (same(path, root)) throw new FailError("业务仓路径与根仓冲突");
  // Never create a second checkout while a previous nested worktree may contain WIP.
  if (lstatSync(join(root, repo.repo_path, ".git"), { throwIfNoEntry: false }))
    throw new UnknownError("根仓内仍存在业务 Checkout，保留现场");
  return path;
}

export function validateBusinessCheckout(path: string, repo: PrepareRepo, branch: string, nativeWorkdir?: string): string {
  const dotgit = join(path, ".git");
  const dot = lstatSync(dotgit, { throwIfNoEntry: false });
  if (!dot || dot.isSymbolicLink() || (!dot.isDirectory() && !dot.isFile())) throw new UnknownError("已有目录不是有效业务仓，保留现场");
  if (!same(gitOk(path, ["rev-parse", "--show-toplevel"], "核验业务仓根"), path)) throw new FailError("业务仓 Git 根目录不一致");
  const workdir = nativeWorkdir ?? dirname(dirname(path));
  if (nativeWorkdir || nativeCheckoutExpected(path, workdir, branch)) {
    assertNativeTaskCheckout(path, workdir);
  } else {
    if (!same(gitOk(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"], "核验业务仓 Git 目录"), dotgit))
      throw new FailError("业务仓不是独立 Git checkout");
    if (gitOk(path, ["symbolic-ref", "--short", "HEAD"], "核验候选分支") !== branch)
      throw new FailError("现有分支不属于当前 Bug；保留 dirty 和未推送 Commit");
  }
  const origin = gitOk(path, ["remote", "get-url", "--all", "origin"], "核验业务仓 origin");
  const push = gitOk(path, ["remote", "get-url", "--push", "--all", "origin"], "核验业务仓 push URL");
  if (canonicalRepositoryIdentity(origin) !== canonicalRepositoryIdentity(repo.repo_url) ||
      canonicalRepositoryIdentity(push) !== canonicalRepositoryIdentity(repo.repo_url)) throw new FailError("业务仓 origin 与已授权仓库不一致");
  return gitOk(path, ["rev-parse", "HEAD"], "核验候选 HEAD");
}
