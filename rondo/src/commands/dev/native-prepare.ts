/** 已提交的工程仓库映射，供交付命令共用。 */
import { parse } from "yaml";
import { FailError, UnknownError } from "../../cli/errors.js";
import { gitOk } from "../../clients/git.js";
import { assertTfsRepository } from "../../clients/authenticated-git.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";
import { RemoteArtifactReader } from "../delivery/remote-artifacts.js";
import type { AnalysisSource } from "../analysis/source.js";
import { validatePrepareRepo, type PrepareRepo } from "./prepare-workspace.js";

/** Read committed engineering mappings, not mutable working files or a second registry. */
export function readNativeRepoMapping(root: string, revision: string, serverUrl: string): Record<string, PrepareRepo> {
  if (revision !== "HEAD" && !/^[0-9a-f]{40}$/.test(revision)) throw new FailError("无效的仓库映射版本");
  let content:string;
  try {content=gitOk(root, ["show", revision + ":docs/config/repo-context.yaml"], "读取已提交仓库映射");}
  catch {throw new UnknownError("无法读取指定版本的 repo-context.yaml；不得回退其他版本");}
  const origin = gitOk(root, ["remote", "get-url", "--all", "origin"], "核对根仓 Origin");
  const push = gitOk(root, ["remote", "get-url", "--push", "--all", "origin"], "核对根仓 Push URL");
  if (canonicalRepositoryIdentity(origin) !== canonicalRepositoryIdentity(push)) throw new FailError("根仓 Origin 与 Push URL 不一致");
  return parseRepoMapping(content, origin, serverUrl);
}

export function parseRepoMapping(content: string, rootUrl: string, serverUrl: string): Record<string, PrepareRepo> {
  let mapping: unknown;
  try { mapping = parse(content); } catch { throw new FailError("repo-context.yaml 格式非法"); }
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
  if (!rootIdentity || canonicalRepositoryIdentity(rootUrl) !== rootIdentity)
    throw new FailError("根仓与已提交仓库映射不一致");
  return result;
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

/** Read the same mapping from the immutable approved root Commit. */
export async function readApprovedRepoMapping(source: AnalysisSource, serverUrl: string): Promise<Record<string, PrepareRepo>> {
  assertTfsRepository(source.repo_url, serverUrl);
  const content = await new RemoteArtifactReader(source.repo_url).read(source.commit, "/docs/config/repo-context.yaml");
  return parseRepoMapping(content, source.repo_url, serverUrl);
}
