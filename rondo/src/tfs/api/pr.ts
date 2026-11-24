/**
 * pr create --repo <name|id> --source <branch> --target <branch> --title <t>
 *           [--description-file <f>] [--work-items <id,id>] [--project <p>]
 * pr get    --id <n> --repo <name|id> [--project <p>]
 * pr list   --repo <name|id> [--status active|completed|abandoned] [--source-branch <b>] [--top <n>] [--project <p>]
 *
 * 纪律：已存在同 source→target 的 active PR 时如实返回 { created:false, existing }，不擅自复用（判定权交调用方）。
 * status 原样透传（小写），终态判定是 pr-status-sync 的职责。
 */

import * as fs from 'node:fs';
import { TfsClient, FailError, UnknownError } from '../client.js';
import { isTransientTfsError, withTransientRetry } from '../retry.js';
import { ensurePrWorkItemLink } from './pr-link.js';

export interface TfsPrLocation {
  project: string;
  repository: string;
  prId: number;
}

/** 仅解析配置 Collection 内的 TFS PR 网页链接，不请求链接地址。 */
export function parseTfsPrWebUrl(prUrl: string, collectionUrl: string): TfsPrLocation | null {
  try {
    const url = new URL(prUrl);
    const collection = new URL(collectionUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== collection.origin ||
        url.username || url.password || collection.username || collection.password) return null;
    const decode = (segment: string): string => {
      const decoded = decodeURIComponent(segment);
      if (!decoded || decoded === "." || decoded === ".." || /[/\\\x00-\x1f]/.test(decoded)) throw new Error("invalid segment");
      return decoded;
    };
    const base = collection.pathname.split("/").filter(Boolean).map(decode);
    const parts = url.pathname.split("/").filter(Boolean).map(decode);
    if (parts.length !== base.length + 5 || base.some((segment, i) => parts[i] !== segment)) return null;
    const [project, marker, repository, route, rawId] = parts.slice(base.length);
    if (marker !== "_git" || route !== "pullrequest" || !/^[1-9]\d*$/.test(rawId)) return null;
    const prId = Number(rawId);
    return Number.isSafeInteger(prId) ? { project, repository, prId } : null;
  } catch {
    return null;
  }
}

/** 仅规范化缺失或不受支持的链接；可解析的身份冲突必须停止。 */
export function normalizeTfsPrWebUrl(
  candidate: string | undefined, collectionUrl: string, project: string, repository: string, prId: number,
): string {
  const parsed = candidate ? parseTfsPrWebUrl(candidate, collectionUrl) : null;
  if (parsed) {
    if (parsed.prId !== prId ||
        parsed.project.toLowerCase() !== project.toLowerCase() ||
        parsed.repository.toLowerCase() !== repository.toLowerCase()) {
      throw new UnknownError("TFS 返回的 PR URL 与已核实的 Project、Repository 或 PR ID 不一致");
    }
    return candidate!;
  }
  const base = new URL(collectionUrl);
  return base.origin + base.pathname.replace(/\/+$/, "") + "/" +
    encodeURIComponent(project) + "/_git/" + encodeURIComponent(repository) + "/pullrequest/" + prId;
}

function normalizeRef(branch: string): string {
  return branch.startsWith('refs/') ? branch : `refs/heads/${branch}`;
}

function shortRef(ref?: string): string | null {
  return ref ? ref.replace(/^refs\/heads\//, '') : null;
}

// SDK 反序列化在 TFS 2018 下常给出数字枚举，映射回契约文本（小写）
const PR_STATUS: Record<string, string> = { '1': 'active', '2': 'abandoned', '3': 'completed' };
const MERGE_STATUS: Record<string, string> = { '1': 'queued', '2': 'conflicts', '3': 'succeeded', '4': 'rejected', '5': 'failure' };

function prShape(client: TfsClient, pr: any, repoName: string, project?: string): Record<string, unknown> {
  const webUrl =
    pr._links?.web?.href ||
    `${client.config.serverUrl}/${encodeURIComponent(project || '')}/_git/${encodeURIComponent(repoName)}/pullrequest/${pr.pullRequestId}?_a=overview`;
  const statusRaw = String(pr.status ?? '');
  const mergeRaw = pr.mergeStatus != null ? String(pr.mergeStatus) : null;
  return {
    id: pr.pullRequestId,
    title: pr.title,
    description: pr.description || "",
    status: PR_STATUS[statusRaw] || statusRaw.toLowerCase(),
    mergeStatus: mergeRaw != null ? MERGE_STATUS[mergeRaw] || mergeRaw.toLowerCase() : null,
    mergeCommitId: pr.lastMergeCommit?.commitId || null,
    sourceCommitId: pr.lastMergeSourceCommit?.commitId || null,
    sourceBranch: shortRef(pr.sourceRefName),
    targetBranch: shortRef(pr.targetRefName),
    createdBy: pr.createdBy?.displayName || null,
    creationDate: pr.creationDate || null,
    url: webUrl,
  };
}

async function resolveRepo(client: TfsClient, nameOrId: string, project?: string): Promise<any> {
  const proj = project || client.config.project;
  try {
    return await withTransientRetry(
      async () => (await client.getGitApi()).getRepository(nameOrId, proj),
      { onBeforeRetry: () => client.rebuildTransport(), what: `读取仓库 ${nameOrId}` },
    );
  } catch {
    const repos: any[] = await withTransientRetry(
      async () => (await client.getGitApi()).getRepositories(proj),
      { onBeforeRetry: () => client.rebuildTransport(), what: '列出仓库' },
    );
    const repo = repos.find((r) => String(r.name).toLowerCase() === nameOrId.toLowerCase());
    if (!repo) throw new FailError(JSON.stringify({ found: false, repo: nameOrId, reason: 'repo_not_found' }));
    return repo;
  }
}

/** 按 source→target 查 active PR（创建前查重与瞬态认领共用；M3.3 读路径瞬态重试）。 */
async function findActivePr(client: TfsClient, repoId: string, sourceRef: string, targetRef: string, proj?: string): Promise<any | null> {
  const existing: any[] = await withTransientRetry(
    async () => (await client.getGitApi()).getPullRequests(
      repoId,
      { status: 1 /* active */, sourceRefName: sourceRef, targetRefName: targetRef },
      proj,
    ),
    { onBeforeRetry: () => client.rebuildTransport(), what: '查询 active PR' },
  );
  return existing && existing.length > 0 ? existing[0] : null;
}

export async function cmdPrCreate(opts: {
  repo: string;
  source: string;
  target: string;
  title: string;
  descriptionFile?: string;
  workItems?: number[];
  project?: string;
}): Promise<unknown> {
  const client = new TfsClient();
  const proj = opts.project || client.config.project;
  const repo = await resolveRepo(client, opts.repo, proj);

  // 重复创建检查：同 source→target 已有 active PR → 如实返回 existing
  const sourceRef = normalizeRef(opts.source);
  const targetRef = normalizeRef(opts.target);
  const preExisting = await findActivePr(client, repo.id, sourceRef, targetRef, proj);
  const link = async (pr: any) => {
    const out = prShape(client, pr, repo.name, proj);
    if (!opts.workItems?.length) return out;
    const projObj = await withTransientRetry(async () => (await client.getCoreApi()).getProject(proj),
      { onBeforeRetry: () => client.rebuildTransport(), what: `读取项目 ${proj}` });
    const linked:number[] = [], failures:number[] = [];
    for (const wid of opts.workItems) {
      try { await ensurePrWorkItemLink(client, {projectId:projObj.id, repoId:repo.id}, pr.pullRequestId, wid, true); linked.push(wid); }
      catch { failures.push(wid); }
    }
    out.workItems=linked;
    if(failures.length) out.workItemLinkFailures=failures;
    return out;
  };
  if (preExisting) return { created: false, existing: await link(preExisting) };

  const description = opts.descriptionFile ? fs.readFileSync(opts.descriptionFile, 'utf-8') : '';
  // M3.3：POST 不自动重试；瞬态失败后按 source/target ref 认领可能已落库的 PR（防断连重复建 PR）
  let pr: any;
  try {
    pr = await (await client.getGitApi()).createPullRequest(
      { sourceRefName: sourceRef, targetRefName: targetRef, title: opts.title, description },
      repo.id,
      proj
    );
  } catch (e) {
    if (!isTransientTfsError(e)) throw e;
    client.rebuildTransport();
    const claimed = await findActivePr(client, repo.id, sourceRef, targetRef, proj);
    if (!claimed) {
      throw new UnknownError(`创建 PR 失败且回读无同 source→target 的 active PR（未落库，可重跑）: ${(e as Error).message} [network]`);
    }
    console.error(`[rondo] 创建 PR 响应丢失，但回读认领已落库 PR #${claimed.pullRequestId}（断连恢复，不重复创建）`);
    pr = claimed;
  }

  return { created: true, pr: await link(pr) };
}

export async function cmdPrGet(opts: { id: number; repo: string; project?: string }): Promise<unknown> {
  const client = new TfsClient();
  const proj = opts.project || client.config.project;
  const repo = await resolveRepo(client, opts.repo, proj);

  const pr = await withTransientRetry(
    async () => (await client.getGitApi()).getPullRequest(repo.id, opts.id, proj),
    { onBeforeRetry: () => client.rebuildTransport(), what: `读取 PR #${opts.id}` },
  );
  if (!pr) throw new FailError(JSON.stringify({ found: false, pr: opts.id }));
  return prShape(client, pr, repo.name, proj);
}

export async function cmdPrList(opts: {
  repo: string;
  status?: string;
  sourceBranch?: string;
  top?: number;
  project?: string;
}): Promise<unknown> {
  const client = new TfsClient();
  const proj = opts.project || client.config.project;
  const repo = await resolveRepo(client, opts.repo, proj);

  const statusMap: Record<string, number> = { active: 1, completed: 3, abandoned: 2 };
  const criteria: any = {};
  if (opts.status) {
    const code = statusMap[opts.status.toLowerCase()];
    if (!code) throw new FailError(`不支持的 status 过滤值: ${opts.status}（支持 active|completed|abandoned）`);
    criteria.status = code;
  }
  if (opts.sourceBranch) criteria.sourceRefName = normalizeRef(opts.sourceBranch);

  const prs: any[] = await withTransientRetry(
    async () => (await client.getGitApi()).getPullRequests(repo.id, criteria, proj, undefined, undefined, opts.top || 20),
    { onBeforeRetry: () => client.rebuildTransport(), what: '列出 PR' },
  );
  return (prs || []).map((pr) => prShape(client, pr, repo.name, proj));
}
