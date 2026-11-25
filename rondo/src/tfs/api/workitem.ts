/**
 * workitem set-state --id <n> --state <s> [--complete-with-estimate] [--project <p>]
 * workitem comment  --id <n> --text-file <f> [--project <p>]
 * workitem create   --type <类型> --title <t> --parent <父id> [--description-file <f>] [--estimate <小时>] [--project <p>]
 * workitem link-commits --id <n> --repo <name|id> --sha <sha,sha,...> [--project <p>]
 * workitem download-attachment --url <附件url> --out <目录> [--name <文件名>]
 *   （gzip 存储自动按 magic 解压；同名覆盖幂等）
 *
 * TFS 2018：写操作走 raw HTTP PATCH/POST + api-version=4.1（SDK 内部 7.1-preview 不支持）。
 * set-state 幂等：当前已是目标状态 → { changed:false } exit 0。
 *   状态路由（2026-10-30 裁定，tfs-writeback-decoupling-plan）：TFS 工作流不允许跨态直连（HTTP 400），
 *   按工作项类型的有序链逐跳中转——Bug：已建议→活动；需求：已建议→活动→已分析→已解决；任务：已建议→活动→已解决→已关闭。
 *   当前态与目标态都在链上且目标靠后时逐跳补齐（输出带 via:string[]）；
 *   不在链上或目标不靠后 → 直连 PATCH（非法跳态由 TFS 拒绝，如实 UNKNOWN，不猜测绕行）。
 * create：创建前只读核对父项（存在性 + 类型为'需求'/'Bug'），父不存在 → FailError(exit 2)；
 *   POST 非 200 → UnknownError(exit 3)——创建结果未知，调用方须按标题前缀查询认领，不盲目重建。
 * 状态名兼容：英文 → 中文版 TFS 本地化状态名映射（移植自 tfs-mcp）。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { marked } from 'marked';
import { TfsClient, UnknownError, FailError } from '../client.js';
import { isTransientTfsError, withTransientRetry } from '../retry.js';
import { resolveRepo } from './repo.js';
import { commitArtifactUrl, parseCommitArtifact } from './commit-identity.js';
import { commitTaskOwners } from './commit-facts.js';
import { normalizeAttachmentUrl } from '../attachments.js';

/** M3.3：SDK 读统一瞬态重试（重试前重建传输层；缓存的 witApi 随旧连接作废后重取）。 */
async function getWorkItemR(client: TfsClient, id: number, fields: string[] | null, expand: string | null, project?: string): Promise<any> {
  return withTransientRetry(
    async () => (await client.getWitApi()).getWorkItem(id, fields, null, expand, project || client.config.project),
    { onBeforeRetry: () => client.rebuildTransport(), what: `读取工作项 ${id}` },
  );
}

/**
 * M3.3 写回读确认（对齐 clients/multica.ts confirmedWrite 语义，F3 写路径 TFS 侧）：
 * 写抛瞬态错 → 回读已生效则按断连恢复返回（不重复写）；未生效重试一次写 → 再回读；
 * 仍无 → UnknownError [write-unconfirmed]（不猜结果，保留现场交人工）。
 * 非瞬态错误（HTTP 400 等业务拒绝）不重试不回读，原样抛出。
 * readback 返回 null = 未生效；非 null = 已生效的恢复值。happy path = 恰好一次写、零额外读。
 */
async function confirmedTfsWrite<T>(
  what: string,
  write: () => Promise<T>,
  readback: () => Promise<T | null>,
): Promise<{ value: T; recovered: boolean }> {
  try {
    return { value: await write(), recovered: false };
  } catch (first) {
    if (!isTransientTfsError(first)) throw first;
    const applied = await readback();
    if (applied !== null) {
      console.error(`[rondo] ${what} 响应丢失但回读确认已生效（断连恢复，不重复写入）`);
      return { value: applied, recovered: true };
    }
    try {
      return { value: await write(), recovered: false };
    } catch (second) {
      if (!isTransientTfsError(second)) throw second;
      // 第二次写也瞬态失败——落回读判定副作用
    }
    const applied2 = await readback();
    if (applied2 !== null) {
      console.error(`[rondo] ${what} 重试后回读确认已生效`);
      return { value: applied2, recovered: true };
    }
    throw new UnknownError(`${what} 写入未确认 [write-unconfirmed]: ${(first as Error).message}——不猜测写入结果，交人工核对后重跑`);
  }
}

const STATE_MAP: Record<string, string> = {
  Active: '活动',
  Resolved: '已解决',
  Closed: '已关闭',
  Proposed: '已建议',
  Suggested: '已建议',
  New: '新建',
  Analyzed: '已分析',
  'In Progress': '进行中',
  Done: '已完成',
  Removed: '已移除',
};

function resolveState(state: string): string {
  return STATE_MAP[state] || state;
}

/** 评论文本按 Markdown 转 HTML（TFS History 是富文本字段） */
async function toHtml(text: string): Promise<string> {
  return (await marked.parse(text)) as string;
}

async function patchWorkItem(client: TfsClient, id: number, document: any[]): Promise<any> {
  const url = `${client.config.serverUrl}/_apis/wit/workitems/${id}?api-version=4.1`;
  const res = await client.rawRequest(url, 'PATCH', JSON.stringify(document), {
    'Content-Type': 'application/json-patch+json',
  });
  if (res.statusCode !== 200) {
    throw new UnknownError(`更新工作项 ${id} 失败: HTTP ${res.statusCode}: ${res.body.slice(0, 500)}`);
  }
  return JSON.parse(res.body);
}

/**
 * 单次 PATCH + 必填日期字段补默认值重试（最多一轮）。
 * 错误体由 patchWorkItem 带进 message（见上），parseRequiredDateFields 据此解析。
 */
async function patchWithDateRetry(client: TfsClient, id: number, document: any[]): Promise<{ updated: any; autoFilled: string[] }> {
  try {
    return { updated: await patchWorkItem(client, id, document), autoFilled: [] };
  } catch (e: any) {
    const missing = parseRequiredDateFields(e.message || '');
    if (missing.length === 0) throw e;
    const retried = [...document];
    for (const f of missing) retried.push({ op: 'add', path: `/fields/${f}`, value: defaultDateForField(f) });
    return { updated: await patchWorkItem(client, id, retried), autoFilled: missing };
  }
}

/** 从 TFS 错误响应解析必填但为空的日期字段，补默认值后重试（移植自 tfs-mcp） */
function parseRequiredDateFields(body: string): string[] {
  const fields: string[] = [];
  const regex = /"fieldReferenceName"\s*:\s*"([^"]+)".*?"fieldStatusFlags"\s*:\s*"[^"]*required[^"]*"/g;
  let m;
  while ((m = regex.exec(body)) !== null) {
    if (/Date/i.test(m[1])) fields.push(m[1]);
  }
  return fields;
}

function defaultDateForField(fieldPath: string): string {
  const now = new Date();
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (fieldPath.includes('StartDate')) return fmt(now);
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
  return fmt(endOfWeek);
}

/** 各工作项类型的有序状态链（2026-10-30 裁定）：跨态直连 TFS 工作流拒绝（HTTP 400），沿链逐跳中转。 */
const STATE_CHAINS: Record<string, string[]> = {
  '需求': ['已建议', '活动', '已分析', '已解决'],
  Bug: ['已建议', '活动'],
  '任务': ['已建议', '活动', '已解决', '已关闭'],
};

export async function cmdWorkItemSetState(opts: { id: number; state: string; project?: string; completeWithEstimate?: boolean }): Promise<unknown> {
  const client = new TfsClient();
  const current = await getWorkItemR(client, opts.id, null, 'All', opts.project);
  const previousState = current.fields?.['System.State'] ?? null;
  const wiType: string | null = current.fields?.['System.WorkItemType'] ?? null;
  const target = resolveState(opts.state);

  // --complete-with-estimate：CompletedWork=OriginalEstimate、RemainingWork=0，与最终状态同一 PATCH 落库。
  // 幂等：状态已是目标态仍核对工时字段，不齐则补（CW 派生自当前 OE；OE 缺失 → 只写 RW=0 并标注 estimateMissing）。
  let doc: any[];
  if (previousState === target || previousState === opts.state) {
    if (!opts.completeWithEstimate) {
      return { id: opts.id, state: previousState, changed: false };
    }
    doc = [];
  } else {
    doc = [{ op: 'add', path: '/fields/System.State', value: target }];
  }

  let estimateMissing = false;
  if (opts.completeWithEstimate) {
    const oe = current.fields?.['Microsoft.VSTS.Scheduling.OriginalEstimate'];
    const rw = current.fields?.['Microsoft.VSTS.Scheduling.RemainingWork'];
    const cw = current.fields?.['Microsoft.VSTS.Scheduling.CompletedWork'];
    if (typeof oe === 'number') {
      if (cw !== oe) doc.push({ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.CompletedWork', value: oe });
    } else {
      estimateMissing = true;
    }
    if (rw !== 0) doc.push({ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork', value: 0 });
  }
  if (doc.length === 0) {
    return { id: opts.id, state: previousState, changed: false, ...(opts.completeWithEstimate ? { estimateMissing } : {}) };
  }

  // 状态路由（2026-10-30 裁定，tfs-writeback-decoupling-plan）：当前态与目标态都在类型有序链上
  // 且目标靠后时，逐跳补齐中间态（TFS 工作流拒绝跨态直连，HTTP 400）；
  // 不在链上或目标不靠后 → 直连 PATCH，非法跳态由 TFS 拒绝后如实 UNKNOWN，不猜测绕行。
  const via: string[] = [];
  const chain = (wiType && STATE_CHAINS[wiType]) || null;
  if (chain && previousState !== target && previousState !== opts.state) {
    const from = chain.indexOf(previousState as string);
    const to = chain.indexOf(target);
    if (from !== -1 && to !== -1 && from < to) {
      for (const hop of chain.slice(from + 1, to)) {
        await patchWithDateRetry(client, opts.id, [{ op: 'add', path: '/fields/System.State', value: hop }]);
        via.push(hop);
      }
    }
  }

  // M3.3：仅最终 PATCH 包回读确认；逐跳中转的 hop PATCH 不包——hop 瞬态失败后命令整体
  // 幂等（重跑按当前态重新算链续走），盲目重试 hop 反而可能逆向跳态被 TFS 400 拒绝。
  const { value: finalResult, recovered } = await confirmedTfsWrite(
    `工作项 ${opts.id} 状态 → ${target}`,
    () => patchWithDateRetry(client, opts.id, doc),
    async () => {
      const wi = await getWorkItemR(client, opts.id, null, null, opts.project);
      const st = wi?.fields?.['System.State'];
      return st === target || st === opts.state ? { updated: wi, autoFilled: [] as string[] } : null;
    },
  );
  const { updated, autoFilled } = finalResult;
  return {
    id: opts.id,
    previousState,
    state: updated.fields?.['System.State'] ?? target,
    changed: true,
    ...(via.length > 0 ? { via } : {}),
    ...(autoFilled.length > 0 ? { autoFilledFields: autoFilled } : {}),
    ...(opts.completeWithEstimate ? { estimateMissing } : {}),
    ...(recovered ? { recovered: true } : {}),
  };
}

/**
 * workitem link-commits：把 commit 以 Artifact Link（vstfs:///Git/Commit/<projectId>%2F<repoId>%2F<sha>）
 * 挂到工作项（tfs-writeback-decoupling-plan §commit↔任务关联）。
 * TFS Task 关联必须使用完整 SHA，先检查 Collection 内已有 Task 独占归属（含英文 Task 类型）；非 Task 保留旧 SHA 兼容。
 * 单项失败不中断，failed 非空 → FailError(exit 2)，结果 JSON 原样上 stdout（是否阻断由调用方裁定）。
 * 链接按 仓库 GUID + SHA 寻址，与分支无关（源分支删除、squash 合并均不影响）。
 */
export async function cmdWorkItemLinkCommits(opts: { id: number; repo: string; shas: string[]; project?: string }): Promise<unknown> {
  const client = new TfsClient();
  const repo = await resolveRepo(client, opts.repo, opts.project);
  if (!repo) {
    throw new FailError(JSON.stringify({ id: opts.id, repo: opts.repo, linked: [], skipped: [], failed: opts.shas.map((sha) => ({ sha, error: 'repo_not_found' })) }));
  }
  const projectId: string | undefined = repo.project?.id;
  if (!projectId) throw new UnknownError(`仓库 ${opts.repo} 缺少 project.id，无法构造 commit 链接`);

  // Commit repo may belong to another TFS Project. Work Item IDs are Collection-global:
  // read the Work Item by ID, not through the repository project's SDK context.
  const readLinkedItem = async (): Promise<any> => {
    const res = await client.rawRequest(
      `${client.config.serverUrl}/_apis/wit/workitems/${opts.id}?$expand=all&api-version=4.1`, 'GET');
    if (res.statusCode !== 200) throw new UnknownError(`工作项 ${opts.id} 跨 Project 回读失败: HTTP ${res.statusCode}`);
    try { return JSON.parse(res.body); }
    catch { throw new UnknownError(`工作项 ${opts.id} 回读无效 JSON`); }
  };
  // This public CLI entrypoint has the same exclusive-Commit gate as Requirement Writeback.
  const original = await readLinkedItem();
  if (original?.id !== opts.id) throw new UnknownError(`TFS 工作项 ${opts.id} 身份未确认`);
  const type = original.fields?.['System.WorkItemType'];
  if (typeof type !== 'string') throw new UnknownError('TFS Work Item 类型不可读，禁止 Commit 关联');
  const isTask = type === '任务' || type === 'Task';
  const projectName = String(repo.project?.name ?? '');
  const identityRepo = { project: projectName, repo: String(repo.name),
    projectId: projectId.toLowerCase(), repoId: String(repo.id).toLowerCase() };
  if (isTask && (!identityRepo.project ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(identityRepo.projectId) ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(identityRepo.repoId))) {
    throw new UnknownError('TFS Task Commit 关联缺少可核验的 Project / Repository GUID');
  }

  const linkAll = async (): Promise<unknown> => {
    const wi = await readLinkedItem();
    if (wi?.id !== opts.id || wi.fields?.['System.WorkItemType'] !== type) {
      throw new UnknownError('TFS Work Item 身份或类型在写入前发生变化');
    }
    const identity = { projectId, repoId: String(repo.id), sha: "" };
    const existing = (wi.relations ?? []).filter((r: any) => r.rel === 'ArtifactLink' &&
      typeof r.url === 'string').map((r: any) => parseCommitArtifact(r.url))
      .filter((v: any) => v !== null);
    const alreadyLinked = (sha: string): boolean => existing.some((e: any) =>
      e.projectId === projectId.toLowerCase() && e.repoId === String(repo.id).toLowerCase() &&
      (e.sha === sha || (e.sha.length < 40 && sha.startsWith(e.sha)) ||
        (sha.length < 40 && e.sha.startsWith(sha))));

    const linked: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ sha: string; error: string }> = [];
    for (const shaRaw of opts.shas) {
      const sha = String(shaRaw).trim().toLowerCase();
      if (!/^[0-9a-f]{7,40}$/.test(sha) || (isTask && sha.length !== 40)) {
        failed.push({ sha: shaRaw, error: isTask ? 'TFS Task 必须使用完整 40 位 SHA' : '非法 sha（须为 7-40 位十六进制）' });
        continue;
      }
      let owners: number[] = [];
      if (isTask) {
        // Recheck current Commit ownership before binding.
        owners = await commitTaskOwners(client, identityRepo, sha);
        if (owners.length > 1 || (owners.length === 1 && owners[0] !== opts.id)) {
          failed.push({sha, error: `Commit 已归属其他 TFS Task: ${owners.join(",")}`});
          continue;
        }
      }
      if (alreadyLinked(sha)) {
        if (isTask && (owners.length !== 1 || owners[0] !== opts.id)) {
          throw new UnknownError(`已有 Commit ArtifactLink，但反向归属不能确认 Task ${opts.id} 独占`);
        }
        skipped.push(sha); continue;
      }
      const url = commitArtifactUrl({ ...identity, sha });
      const linkDoc = [
        { op: 'add', path: '/relations/-',
          value: { rel: 'ArtifactLink', url, attributes: { artifactType: 'Commit', name: 'Fixed in Commit' } } },
      ];
      try {
        await confirmedTfsWrite(
          `工作项 ${opts.id} 关联 commit ${sha}`,
          async () => { await patchWorkItem(client, opts.id, linkDoc); return true; },
          async () => {
            const refreshed = await readLinkedItem();
            if (!Array.isArray(refreshed?.relations)) throw new UnknownError('Commit 关联回读缺少 relations');
            return refreshed.relations.some((r: any) => {
              if (r.rel !== 'ArtifactLink' || typeof r.url !== 'string') return false;
              const link = parseCommitArtifact(r.url);
              return link !== null && link.projectId === projectId.toLowerCase() &&
                link.repoId === String(repo.id).toLowerCase() && link.sha === sha;
            }) ? true : null;
          },
        );
        if (isTask) {
          const current = await readLinkedItem();
          if (!Array.isArray(current?.relations) ||
              !current.relations.some((r: any) => {
                const parsed = r.rel === 'ArtifactLink' && typeof r.url === 'string'
                  ? parseCommitArtifact(r.url) : null;
                return parsed?.projectId === projectId.toLowerCase() &&
                  parsed?.repoId === String(repo.id).toLowerCase() && parsed?.sha === sha;
              })) {
            throw new UnknownError(`Task ${opts.id} Commit ArtifactLink 未回读确认`);
          }
          const owners = await commitTaskOwners(client, identityRepo, sha);
          if (owners.length !== 1 || owners[0] !== opts.id) {
            throw new UnknownError(`Task ${opts.id} Commit 反向归属不唯一或不可信: ${owners.join(",")}`);
          }
        }
        linked.push(sha);
        existing.push({ ...identity, projectId: projectId.toLowerCase(),
          repoId: String(repo.id).toLowerCase(), sha });
      } catch (exc) {
        if (exc instanceof UnknownError) throw exc; // after a partial write: no FAIL/PASS inference
        failed.push({ sha, error: exc instanceof Error ? exc.message : String(exc) });
      }
    }
    const result = { id: opts.id, repo: repo.name, linked, skipped, failed };
    if (failed.length > 0) throw new FailError(JSON.stringify(result));
    return result;
  };
  return linkAll();
}

export async function cmdWorkItemComment(opts: { id: number; textFile: string; project?: string }): Promise<unknown> {
  const client = new TfsClient();
  const text = fs.readFileSync(opts.textFile, 'utf-8');
  const html = await toHtml(text);
  // M3.3：History 是累积富文本字段——回读判定 = 现有内容包含本次 HTML（防断连重复评论）
  const { recovered } = await confirmedTfsWrite(
    `工作项 ${opts.id} 评论`,
    async () => { await patchWorkItem(client, opts.id, [{ op: 'add', path: '/fields/System.History', value: html }]); return true; },
    async () => {
      const wi = await getWorkItemR(client, opts.id, ['System.History'], null, opts.project);
      const history = String(wi?.fields?.['System.History'] ?? '');
      return history.includes(html) ? true : null;
    },
  );
  return { id: opts.id, commentAdded: true, ...(recovered ? { recovered: true } : {}) };
}

/**
 * workitem download-attachment：下载附件到本地（--out 目录 + --name 文件名，缺省取 fileName 或 GUID）。
 * TFS 2018 附件按 gzip 存储但不声明 Content-Encoding：按 1f 8b magic 判定并解压（decompressed 回报）。
 * 文件名清洗：非法字符与控制字符替换为 '_'；同名覆盖幂等。
 */
export async function cmdWorkItemDownloadAttachment(opts: { url: string; out: string; name?: string }): Promise<unknown> {
  const client = new TfsClient();
  // TFS 跨项目批量读取可能把图片项目路径改错；使用可信 collection + GUID 下载。
  let downloadUrl: string;
  try { downloadUrl = normalizeAttachmentUrl(opts.url, client.config.serverUrl); }
  catch (error) { throw new FailError(`下载附件失败: ${(error as Error).message}`); }
  const res = await client.rawRequestBuffer(downloadUrl);
  if (res.statusCode === 404) throw new FailError(`下载附件失败: HTTP 404，附件不存在或无权限: ${downloadUrl}（来源: ${opts.url}）`);
  if (res.statusCode !== 200) throw new UnknownError(`下载附件失败: HTTP ${res.statusCode}: ${downloadUrl}（来源: ${opts.url}）`);
  let buf = res.body;
  let decompressed = false;
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = zlib.gunzipSync(buf);
    decompressed = true;
  }
  const parsedDownload = new URL(downloadUrl);
  const rawName = opts.name || parsedDownload.searchParams.get('fileName') || String(parsedDownload.pathname.split('/').pop());
  const name = rawName
    .replace(/[\\/<>:"|?*]/g, '_')
    .split('')
    .map((c) => (c.charCodeAt(0) < 32 ? '_' : c))
    .join('')
    .trim() || 'attachment';
  fs.mkdirSync(opts.out, { recursive: true });
  const filePath = path.join(opts.out, name);
  fs.writeFileSync(filePath, buf);
  return { path: filePath, name, size: buf.length, decompressed };
}

/**
 * workitem create：在 --parent 下创建子工作项（Hierarchy-Reverse 父子链接）。
 * 用于 delivery-flow materialize-tfs-tasks（docs/tfs-task-materialization-plan.md §4.1）。
 */
export async function cmdWorkItemCreate(opts: {
  type: string;
  title: string;
  parent: number;
  descriptionFile?: string;
  estimate?: number;
  project?: string;
}): Promise<unknown> {
  const client = new TfsClient();
  const project = opts.project || client.config.project;
  if (!project) throw new FailError('创建需要团队项目上下文（--project 或 TFS_PROJECT）');

  // 创建前只读核对父项：存在性 + 类型（本流程父项为需求/Bug）
  const parentWi = await getWorkItemR(client, opts.parent, null, 'All', project);
  if (!parentWi?.id) {
    throw new FailError(JSON.stringify({ created: false, reason: `父工作项 ${opts.parent} 不存在或不可读` }));
  }
  const parentType = parentWi.fields?.['System.WorkItemType'] ?? null;
  if (parentType && parentType !== '需求' && parentType !== 'Bug') {
    throw new FailError(
      JSON.stringify({ created: false, reason: `父工作项 ${opts.parent} 类型为 ${parentType}，不是'需求'/'Bug'，不在本流程父项范围内` }),
    );
  }

  const doc: any[] = [{ op: 'add', path: '/fields/System.Title', value: opts.title }];
  if (opts.descriptionFile) {
    const html = await toHtml(fs.readFileSync(opts.descriptionFile, 'utf-8'));
    doc.push({ op: 'add', path: '/fields/System.Description', value: html });
  }
  // 预估工时（docs/tfs-state-writeback-plan.md §4.7）：OriginalEstimate 与 RemainingWork 同写 N；
  // CompletedWork 创建时不写；任务收口时由 set-state --complete-with-estimate 落库 CW=OE。
  if (opts.estimate !== undefined) {
    doc.push({ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.OriginalEstimate', value: opts.estimate });
    doc.push({ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork', value: opts.estimate });
  }
  doc.push({
    op: 'add',
    path: '/relations/-',
    value: {
      rel: 'System.LinkTypes.Hierarchy-Reverse',
      url: `${client.config.serverUrl}/_apis/wit/workitems/${opts.parent}`,
    },
  });

  const url = `${client.config.serverUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/$${encodeURIComponent(opts.type)}?api-version=4.1`;
  // M3.3：create 绝不自动重试（无法安全判重——认领是 writeback 既有职责）；
  // 瞬态失败仅补 [network] 分类与重跑提示，如实 UNKNOWN。
  const post = async (document: any[]) => {
    try {
      return await client.rawRequest(url, 'POST', JSON.stringify(document), { 'Content-Type': 'application/json-patch+json' });
    } catch (e) {
      if (!isTransientTfsError(e)) throw e;
      throw new UnknownError(`创建工作项失败（结果未知，勿盲目重建；认领是 writeback 既有职责，排查后重跑）: ${(e as Error).message} [network]`);
    }
  };

  let res = await post(doc);
  // 本实例任务类型有必填排期日期字段（实测：完成日期 FinishDate Required, InvalidEmpty）——
  // 与 set-state 同模式：解析必填日期字段补默认值重试一次（TFS 强制字段，非可选管理字段）。
  let autoFilled: string[] = [];
  if (res.statusCode === 400) {
    autoFilled = parseRequiredDateFields(res.body);
    if (autoFilled.length > 0) {
      for (const f of autoFilled) doc.push({ op: 'add', path: `/fields/${f}`, value: defaultDateForField(f) });
      res = await post(doc);
    }
  }
  if (res.statusCode !== 200) {
    throw new UnknownError(`创建工作项失败（结果未知，勿盲目重建）: HTTP ${res.statusCode}: ${res.body.slice(0, 500)}`);
  }
  const created = JSON.parse(res.body);
  return {
    id: created.id,
    type: opts.type,
    title: opts.title,
    parent: opts.parent,
    url: client.workItemWebUrl(created.id, project),
    ...(opts.estimate !== undefined ? { estimate: opts.estimate } : {}),
    ...(autoFilled.length > 0 ? { autoFilledFields: autoFilled } : {}),
  };
}
