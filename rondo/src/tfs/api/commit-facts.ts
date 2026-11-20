/** TFS 2018 read-only Git facts for Requirement Commit→Task accounting. */
import { TfsClient } from "../client.js";
import { UnknownError } from "../../cli/errors.js";
import { resolveRepo } from "./repo.js";
import { commitKey, parseCommitArtifact, type CommitIdentity } from "./commit-identity.js";

const fullSha = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{40}$/i.test(s);
const guid = (s: unknown): s is string => typeof s === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export interface VerifiedRepo {
  project: string; repo: string; projectId: string; repoId: string;
}

async function getJson(client: TfsClient, url: URL, what: string): Promise<any> {
  let response: {statusCode:number;body:string};
  try { response = await client.rawRequest(url.href, "GET"); }
  catch (error) { throw new UnknownError(`${what} TFS 请求不可确认: ${error instanceof Error ? error.message : String(error)}`); }
  if (response.statusCode !== 200) throw new UnknownError(`${what}: HTTP ${response.statusCode}`);
  try { return JSON.parse(response.body); }
  catch { throw new UnknownError(`${what}: TFS 返回无效 JSON`); }
}

export async function verifiedRepo(client: TfsClient, project: string, repoName: string): Promise<VerifiedRepo> {
  let repo: Awaited<ReturnType<typeof resolveRepo>>;
  try { repo = await resolveRepo(client, repoName, project); }
  catch (error) { throw new UnknownError(`仓库查询不可确认: ${error instanceof Error ? error.message : String(error)}`); }
  if (!repo || !guid(repo.id) || !guid(repo.project?.id) ||
      String(repo.name).toLowerCase() !== repoName.toLowerCase() ||
      String(repo.project?.name).toLowerCase() !== project.toLowerCase()) {
    throw new UnknownError(`TFS 仓库身份未确认: ${project}/${repoName}`);
  }
  return { project, repo: repoName, projectId: repo.project.id.toLowerCase(), repoId: repo.id.toLowerCase() };
}

function safeCommitLink(url: string): CommitIdentity | null {
  try { return parseCommitArtifact(url); }
  catch { throw new UnknownError("TFS ArtifactLink 存在非法 Commit 身份，无法验证独占关系"); }
}

function gitUrl(client: TfsClient, repo: VerifiedRepo, suffix: string): URL {
  const base = client.config.serverUrl.replace(/\/+$/, "");
  return new URL(`${base}/${encodeURIComponent(repo.projectId)}/_apis/git/repositories/${repo.repoId}/${suffix}`);
}

/** Read PR-scoped changed commits. The Agent, not file-count heuristics, chooses business commits. */
export interface PrChangedCommit { sha: string; changed_paths: string[]; message: string }
export async function prChangedCommits(client: TfsClient, repo: VerifiedRepo, prId: number, candidate?: string): Promise<PrChangedCommit[]> {
  if (!Number.isSafeInteger(prId) || prId <= 0 || (candidate !== undefined && !fullSha(candidate))) throw new UnknownError("PR/Commit 身份非法");
  const url = gitUrl(client, repo, `pullRequests/${prId}/commits`);
  url.searchParams.set("$top", "200");
  url.searchParams.set("api-version", "4.1");
  const body = await getJson(client, url, "PR Commit 列表");
  if (!Array.isArray(body?.value) || body.value.length >= 200 || !body.value.length ||
      body.value.some((v: any) => !fullSha(v?.commitId))) {
    throw new UnknownError("TFS PR Commit 列表缺失、截断或包含非法 SHA");
  }
  const all = [...new Set(body.value.map((v: any) => String(v.commitId).toLowerCase()))] as string[];
  if (candidate !== undefined && !all.includes(candidate.toLowerCase())) throw new UnknownError("Candidate 不在 PR Commit 列表内");
  const changed: PrChangedCommit[] = [];
  for (const sha of all) {
    const changesUrl = gitUrl(client, repo, `commits/${sha}/changes`);
    changesUrl.searchParams.set("api-version", "4.1");
    const changes = await getJson(client, changesUrl, "Commit 代码变更核对");
    if (!Array.isArray(changes?.changes)) throw new UnknownError(`Commit ${sha} 缺少可核验的 changes`);
    if (!changes.changes.length) continue;
    const info = body.value.find((v: any) => String(v.commitId).toLowerCase() === sha);
    changed.push({ sha,
      changed_paths: [...new Set(changes.changes.map((c: any) => c?.item?.path)
        .filter((path: unknown): path is string => typeof path === "string" && path.length > 0))] as string[],
      message: typeof info?.comment === "string" ? info.comment.split("\n")[0].slice(0, 200) : "",
    });
  }
  if (candidate !== undefined && !changed.some(c => c.sha === candidate.toLowerCase())) throw new UnknownError("Candidate Commit 没有真实变更");
  return changed;
}

/** All linked Work Items across the Collection, then verify direct ArtifactLink for each Task.
 * A missing workItems collection or inaccessible Work Item is UNKNOWN, not an empty owner set.
 */
export async function commitTaskOwners(client: TfsClient, repo: VerifiedRepo, sha: string): Promise<number[]> {
  if (!fullSha(sha)) throw new UnknownError("Commit 必须为完整 SHA");
  if (process.env.RONDO_TFS_REVERSE_QUERY_VERIFIED !== "1") {
    throw new UnknownError("TFS 2018 Commit 反向关联尚未通过跨 Project 真实验证；停止独占关联");
  }
  const url = gitUrl(client, repo, "commits");
  url.searchParams.set("searchCriteria.fromCommitId", sha);
  url.searchParams.set("searchCriteria.toCommitId", sha);
  url.searchParams.set("searchCriteria.includeWorkItems", "true");
  url.searchParams.set("api-version", "4.1");
  const body = await getJson(client, url, "Commit 反向关联");
  if (!Array.isArray(body?.value) || body.value.length !== 1 ||
      body.value[0].commitId?.toLowerCase() !== sha.toLowerCase() ||
      !Array.isArray(body.value[0].workItems)) {
    throw new UnknownError("Commit 反向关联返回不完整或无法确认唯一 SHA");
  }
  const ids = body.value[0].workItems.map((wi: any) => Number(wi.id));
  if (ids.some((id: number) => !Number.isSafeInteger(id) || id <= 0) ||
      new Set(ids).size !== ids.length || ids.length > 500) {
    throw new UnknownError("Commit 反向关联返回无效或不完整的 Work Item IDs");
  }
  if (ids.length === 0) return [];
  const owners: number[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const itemsUrl = new URL(client.config.serverUrl.replace(/\/+$/, "") + "/_apis/wit/workitems");
    itemsUrl.searchParams.set("ids", batch.join(","));
    itemsUrl.searchParams.set("$expand", "all");
    itemsUrl.searchParams.set("api-version", "4.1");
    const data = await getJson(client, itemsUrl, "跨 Project Commit Work Item 回读");
    if (!Array.isArray(data?.value) || data.value.length !== batch.length) {
      throw new UnknownError("Commit Work Item 存在不可读/已删除条目，无法证明全局唯一");
    }
    const seen = new Set<number>();
    for (const item of data.value) {
      if (!batch.includes(item.id) || seen.has(item.id)) throw new UnknownError("Commit Work Item 回读身份异常");
      seen.add(item.id);
      if (item.fields?.["System.WorkItemType"] !== "任务" &&
          item.fields?.["System.WorkItemType"] !== "Task") continue;
      if (!Array.isArray(item.relations)) throw new UnknownError("TFS Task 缺少 relations，无法确认直接关联");
      const targetKey = commitKey({ projectId: repo.projectId, repoId: repo.repoId, sha });
      if (!item.relations.some((r: any) => {
        if (r.rel !== "ArtifactLink" || typeof r.url !== "string") return false;
        const link = safeCommitLink(r.url);
        return link !== null && commitKey(link) === targetKey;
      })) {
        throw new UnknownError(`TFS Task ${item.id} 在反向查询中出现但无对应直接 ArtifactLink`);
      }
      owners.push(item.id);
    }
  }
  return owners.sort((a, b) => a - b);
}

export function hasExactArtifactLink(links: string[] | undefined, identity: CommitIdentity): boolean {
  if (!Array.isArray(links)) throw new UnknownError("TFS 工作项未提供 Commit ArtifactLink 回读字段");
  return links.some(url => {
    const link = safeCommitLink(url);
    return link !== null && commitKey(link) === commitKey(identity);
  });
}
