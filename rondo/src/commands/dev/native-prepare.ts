/** Native business checkout: reuse existing authorization and platform worktrees. */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import { FailError, UnknownError } from "../../cli/errors.js";
import { git, gitOk } from "../../clients/git.js";
import { runAuthenticatedGit, assertTfsRepository } from "../../clients/authenticated-git.js";
import { runCommand } from "../../clients/spawn.js";
import { multicaPrefix } from "../../clients/multica-environment.js";
import type { MulticaRuntime } from "../../clients/runtime-context.js";
import { parsePlatformCheckoutOutput } from "../../clients/native-checkout.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";
import { validatePrepareRepo, validateBusinessPath, validateBusinessCheckout, type PrepareRepo } from "./prepare-workspace.js";

/** Read committed engineering mappings, not mutable working files or a second registry. */
export function readNativeRepoMapping(root: string, revision: string, serverUrl: string): Record<string, PrepareRepo> {
  if (revision !== "HEAD" && !/^[0-9a-f]{40}$/.test(revision)) throw new FailError("无效的仓库映射版本");
  let mapping: unknown;
  try { mapping = parse(gitOk(root, ["show", revision + ":docs/config/repo-context.yaml"], "读取已提交仓库映射")); }
  catch { throw new UnknownError("无法读取指定版本的 repo-context.yaml；不得回退其他版本"); }
  const rows = (mapping as { repos?: unknown })?.repos;
  if (!Array.isArray(rows)) throw new FailError("repo-context.yaml 缺少 repos");
  const result: Record<string, PrepareRepo> = Object.create(null);
  const keys = new Set<string>();
  let rootIdentity = "";
  for (const raw of rows) {
    if (!raw || typeof raw !== "object" || typeof raw.repo_id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(raw.repo_id) || keys.has(raw.repo_id))
      throw new FailError("repo-context.yaml 仓库 ID 非法或重复");
    keys.add(raw.repo_id);
    if (raw.repo_id === "root") {
      if (raw.repo_path !== "." || typeof raw.repo_url !== "string") throw new FailError("根仓映射无效");
      rootIdentity = canonicalRepositoryIdentity(assertTfsRepository(raw.repo_url, serverUrl).href);
      continue;
    }
    // Scope is validated separately. Validate full delivery fields only for a selected repository.
    const url = typeof raw.repo_url === "string" ? raw.repo_url : "";
    let name = "";
    try { name = decodeURIComponent(new URL(url).pathname.split("/").at(-1) ?? ""); } catch { /* selected repo fails validation */ }
    result[raw.repo_id] = { repo_path: typeof raw.repo_path === "string" ? raw.repo_path : "",
      repo_url: url, tfs_project: typeof raw.tfs_project === "string" ? raw.tfs_project : "",
      tfs_repo: name, default_target_branch: typeof raw.default_target_branch === "string" ? raw.default_target_branch : "" };
  }
  const origin = gitOk(root, ["remote", "get-url", "--all", "origin"], "核对根仓 Origin");
  const push = gitOk(root, ["remote", "get-url", "--push", "--all", "origin"], "核对根仓 Push URL");
  if (!rootIdentity || canonicalRepositoryIdentity(origin) !== rootIdentity || canonicalRepositoryIdentity(push) !== rootIdentity)
    throw new FailError("根仓与已提交仓库映射不一致");
  return result;
}

export function prepareNativeBusiness(root: string, repo: PrepareRepo, branch: string, runtime: MulticaRuntime,
  resourceRef?: string, remote = runAuthenticatedGit, checkout = runCommand): Record<string, unknown> {
  const workdir = dirname(root);
  const path = validateBusinessPath(root, repo);
  const existing = existsSync(path);
  if (existing) validateBusinessCheckout(path, repo, branch, workdir);
  const candidateRef = "refs/heads/" + branch;
  const targetRef = "refs/heads/" + repo.default_target_branch;
  for (const ref of [candidateRef, targetRef]) {
    if (git(root, ["check-ref-format", ref]).status !== 0) throw new FailError("候选或目标分支非法");
  }
  if (candidateRef === targetRef) throw new FailError("候选分支不得等于交付目标分支");
  // Spike verified branch refs. Never use target branch as an implicit Resource ref.
  const initialRef = resourceRef ? "refs/heads/" + resourceRef : undefined;
  if (initialRef && (resourceRef!.startsWith("-") || resourceRef!.startsWith("refs/") ||
      git(root, ["check-ref-format", initialRef]).status !== 0)) throw new FailError("Resource ref 必须为已核实的分支名");
  const requested = [...new Set([candidateRef, targetRef, ...(initialRef ? [initialRef] : [])])];
  const refs = remote(repo.repo_url, ["ls-remote", repo.repo_url, ...requested], root);
  if (refs.status !== 0) throw new UnknownError("读取候选及基线失败，保留现场");
  const observed = new Map<string, string>();
  for (const line of refs.stdout.trim().split(/\r?\n/).filter(Boolean)) {
    const m = /^([0-9a-f]{40})\s+(refs\/heads\/\S+)$/.exec(line);
    if (!m || !requested.includes(m[2]) || observed.has(m[2])) throw new UnknownError("远端 ref 响应无法确认");
    observed.set(m[2], m[1]);
  }
  if (!observed.has(targetRef)) throw new FailError("交付目标分支不存在");
  const candidate = observed.get(candidateRef);
  if (!candidate && (!initialRef || !observed.has(initialRef))) throw new UnknownError("缺少已确认的 Project Resource 初始分支");
  const ref = candidate ? branch : resourceRef!;
  const result = checkout([...multicaPrefix(runtime), "repo", "checkout", repo.repo_url, "--ref", ref], root, undefined, 600_000);
  if (result.status !== 0 || /fetch[_ -]error|fetch (?:failed|failure)/i.test(result.stdout + "\n" + result.stderr))
    throw new UnknownError("Multica Native Checkout 或 Fetch 未确认成功，保留现场");
  const reported = parsePlatformCheckoutOutput(result.stdout, result.stderr);
  const same = (a: string, b: string) => process.platform === "win32"
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
  if (!same(reported.root, path) || !same(validateBusinessPath(root, repo), path)) throw new FailError("Native Checkout 实际路径与仓库映射不一致");
  const head = validateBusinessCheckout(path, repo, branch, workdir);
  const localBranch = gitOk(path, ["symbolic-ref", "--short", "HEAD"], "核对 Task Branch");
  if (localBranch !== reported.branch) throw new FailError("Native 当前分支与平台返回不一致");
  if (!existing && head !== (candidate ?? observed.get(initialRef!)))
    throw new UnknownError("首次 Checkout HEAD 与已确认基线不一致，保留现场");
  if (existing && !candidate) {
    // Kept does not switch refs. Verify the original upstream rather than requiring the latest remote tip.
    const upstream = git(path, ["rev-parse", "--symbolic-full-name", "@{upstream}"]);
    if (upstream.status !== 0 || upstream.stdout.trim() !== "refs/remotes/origin/" + resourceRef ||
        git(path, ["merge-base", head, upstream.stdout.trim()]).status !== 0)
      throw new UnknownError("已有工作树的初始基线无法确认，保留现场");
  }
  if (candidate && git(path, ["merge-base", "--is-ancestor", candidate, head]).status !== 0)
    throw new UnknownError("当前工作树未包含已发布 Candidate，保留现场");
  return { result: "PASS", path, repo_url: repo.repo_url, branch, local_branch: localBranch, head, changed: !existing };
}


/** Ensure remaining delivery commands consume the same repository and target as Native prepare. */
export function assertNativeDeliveryMapping(root: string, revision: string, key: string,
  configured: { repo_path: string; repo_url?: string; default_target_branch?: string }, server: string): void {
  const selected = validatePrepareRepo(readNativeRepoMapping(root, revision, server)[key], server);
  if (selected.repo_path !== configured.repo_path ||
      canonicalRepositoryIdentity(selected.repo_url) !== canonicalRepositoryIdentity(configured.repo_url ?? "") ||
      selected.default_target_branch !== configured.default_target_branch)
    throw new FailError("Native 准备与交付的仓库身份或目标分支不一致");
}
