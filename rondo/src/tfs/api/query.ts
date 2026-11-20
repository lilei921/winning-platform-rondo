/**
 * query --wiql "<WIQL>" [--project <p>]
 * 输出契约：JSON 数组，元素 { id, type, title, url, state, changedDate, project, parentId,
 *   originalEstimate, remainingWork, completedWork, fields, attachments, childIds, artifactLinks }
 * （基础字段对齐 workspace-skills/tfs-sync/scripts/reconcile-workitem.ts 的 REQUIRED_WI_FIELDS；
 *  工时字段为 2026-10-20 增量，resolve-tfs-tasks 回读核对 CW=OE / RW=0 用，不影响既有消费方；
 *  fields/attachments 为 2026-10-28 增量：fields 是 TFS 返回的全量字段原样透传（含
 *  System.Description / Winning.Demand.Analysis 等 HTML 字段），attachments 从 relations
 *  过滤 AttachedFile（含真实文件名 attributes.name 与 comment）——供 tfs-sync 将需求详情、
 *  需求分析、附件写入 Delivery Issue 正文；既有消费方不读新字段不受影响）
 */

import { TfsClient, UnknownError } from '../client.js';
import { withTransientRetry } from '../retry.js';

/**
 * M3.3：getWorkItems 从 SDK 迁到 rawRequest GET——SDK 在 TFS 2018 下走 gzip 压缩响应，
 * 大批量展开（$expand=all）时存在截断 bug；rawRequest 不声明 Accept-Encoding，服务端
 * 原样返回明文 JSON。批大小 200 → 50（raw GET 的 URL 长度与单批体量的稳妥值）。
 */
export const WORKITEM_BATCH = 50;

/** 纯函数：批量取工作项的 GET URL（$expand=all 含 fields+relations，与 SDK expand 'All' 同形）。 */
export function workItemsUrl(serverUrl: string, ids: number[]): string {
  return `${serverUrl}/_apis/wit/workitems?ids=${ids.join(',')}&$expand=all&api-version=4.1`;
}

export async function cmdQuery(opts: { wiql: string; project?: string }): Promise<unknown> {
  const client = new TfsClient();
  const project = opts.project || client.config.project;

  const teamContext = project ? { project } : {};
  // WIQL 只回 ID（体量小），留 SDK + 瞬态重试（重试前重建传输层，避免复用坏连接）
  const queryResult = await withTransientRetry(
    async () => (await client.getWitApi()).queryByWiql({ query: opts.wiql }, teamContext),
    { onBeforeRetry: () => client.rebuildTransport(), what: 'WIQL 查询' },
  );

  if (!queryResult.workItems || queryResult.workItems.length === 0) {
    return [];
  }

  const ids = queryResult.workItems.map((wi: any) => wi.id);
  // 分批取；任一批非 200 或缺 value 视为服务端异常 → UNKNOWN（rawRequest GET 已内置瞬态重试）
  const items: any[] = [];
  for (let i = 0; i < ids.length; i += WORKITEM_BATCH) {
    const batchIds = ids.slice(i, i + WORKITEM_BATCH);
    const res = await client.rawRequest(workItemsUrl(client.config.serverUrl, batchIds), 'GET');
    if (res.statusCode !== 200) {
      throw new UnknownError(`getWorkItems 第 ${i / WORKITEM_BATCH + 1} 批失败: HTTP ${res.statusCode}: ${res.body.slice(0, 300)}`);
    }
    const parsed = JSON.parse(res.body);
    if (!Array.isArray(parsed?.value)) {
      throw new UnknownError(`getWorkItems 第 ${i / WORKITEM_BATCH + 1} 批返回缺少 value 数组（服务端异常，可重试）`);
    }
    items.push(...parsed.value);
  }

  return items.map((wi: any) => {
    const f = wi.fields || {};
    const proj = f['System.TeamProject'] || project;
    // 父子链接（expand=All 时 relations 含 Hierarchy-Reverse）；TFS 2018 扁平 WIQL 不支持 [System.Parent] 字段，
    // 需要父 id 的消费方（如 materialize-tfs-tasks 孤儿认领）用此字段过滤，不要在 WIQL 里写 System.Parent。
    const relations = wi.relations == null ? [] : wi.relations;
    if (!Array.isArray(relations)) throw new UnknownError(`工作项 ${wi.id} 的 relations 不可信`);
    const parentRel = relations.find((r: any) => r.rel === 'System.LinkTypes.Hierarchy-Reverse');
    const parentId = parentRel ? Number(String(parentRel.url).split('/').pop()) : NaN;
    // Children and raw Commit relations are exposed for identity-safe Delivery recovery.
    // Preserve the original URL: consumers must verify full project/repository GUID + SHA.
    const childIds = relations
      .filter((r: any) => r.rel === 'System.LinkTypes.Hierarchy-Forward')
      .map((r: any) => Number(String(r.url).split('/').pop()));
    if (childIds.some((id: number) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new UnknownError(`工作项 ${wi.id} 的子项关系非法`);
    }
    // TFS may omit relations on work items without links; $expand=all remains authoritative.
    const artifactLinks = relations
      .filter((r: any) => r.rel === 'ArtifactLink' && typeof r.url === 'string' &&
        r.url.toLowerCase().startsWith('vstfs:///git/commit/'))
      .map((r: any) => r.url as string);
    // 附件：relations 中 rel=AttachedFile 的项；attributes.name 是真实文件名，comment 为附件备注。
    // 无附件 → 空数组（与"未获取"区分：expand=All 下 relations 是完整事实）。
    const attachments = relations
      .filter((r: any) => r.rel === 'AttachedFile')
      .map((r: any) => ({
        url: r.url,
        name: r.attributes?.name ?? null,
        comment: r.attributes?.comment ?? null,
      }));
    return {
      id: wi.id,
      type: f['System.WorkItemType'] ?? null,
      title: f['System.Title'] ?? null,
      url: wi._links?.html?.href || client.workItemWebUrl(wi.id, proj),
      state: f['System.State'] ?? null,
      changedDate: f['System.ChangedDate'] ?? null,
      project: proj,
      parentId: Number.isInteger(parentId) && parentId > 0 ? parentId : null,
      originalEstimate: f['Microsoft.VSTS.Scheduling.OriginalEstimate'] ?? null,
      remainingWork: f['Microsoft.VSTS.Scheduling.RemainingWork'] ?? null,
      completedWork: f['Microsoft.VSTS.Scheduling.CompletedWork'] ?? null,
      fields: f,
      attachments,
      childIds,
      artifactLinks,
    };
  });
}
