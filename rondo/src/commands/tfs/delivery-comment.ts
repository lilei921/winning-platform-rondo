/** TFS 2018 History 不是累积字段；按 updates 全量分页回读本次交付引用。 */
import { createHash } from "node:crypto";
import { TfsClient } from "../../tfs/client.js";
import { UnknownError } from "../../cli/errors.js";
import type { IssueRecord } from "../../clients/multica.js";

export function deliveryCommentReference(issue: IssueRecord): string {
  const md = issue.metadata ?? {};
  let prs: unknown;
  try { prs = JSON.parse(md.current_pr ?? ""); } catch { throw new UnknownError("无法确认本次交付 PR 引用"); }
  if (!Array.isArray(prs) || !prs.length || prs.some(p => !p?.repo_key || !p?.pr_url || !Number.isSafeInteger(p?.pr_id) || p.pr_id <= 0)) throw new UnknownError("交付 PR 引用不完整");
  const identity = { issue: issue.id, tfs: md["tfs.id"], change: md["analysis.change_ref"] ?? "",
    prs: prs.map(p => [p.repo_key, p.pr_id, p.pr_url]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
  return "Rondo delivery: " + createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export async function readTfsHistory(id: number, client: Pick<TfsClient, "config" | "rawRequest"> = new TfsClient()): Promise<string[]> {
  const base = `${client.config.serverUrl}/_apis/wit/workitems/${id}`;
  async function get(url: string): Promise<any> {
    let r;
    try { r = await client.rawRequest(url, "GET"); } catch { throw new UnknownError("TFS 评论查询失败，停止写回"); }
    if (r.statusCode !== 200) throw new UnknownError(`TFS 评论查询 HTTP ${r.statusCode}，停止写回`);
    try { return JSON.parse(r.body); } catch { throw new UnknownError("TFS 评论查询响应非法"); }
  }
  const item = await get(base + "?api-version=4.1");
  if (item.id !== id || !Number.isSafeInteger(item.rev) || item.rev < 1) throw new UnknownError("TFS 工作项 revision 不可确认");
  const history: string[] = [];
  let skip = 0, lastRev = 0;
  while (true) {
    if (skip >= 100_000) throw new UnknownError("TFS History 超过回读上限");
    const page = await get(`${base}/updates?$top=200&$skip=${skip}&api-version=4.1`);
    if (!Array.isArray(page.value) || page.value.length > 200 || page.count !== page.value.length) throw new UnknownError("TFS History 分页不完整");
    if (!page.value.length) break;
    for (const update of page.value) {
      // TFS 2018 关系更新可复用 rev，但 update.id 仍递增，不能用 rev 当分页游标。
      if (update.workItemId !== id || update.id !== skip + 1 || !Number.isSafeInteger(update.rev) || update.rev < 1 || update.rev < lastRev || update.rev > item.rev) throw new UnknownError("TFS History 编号不连续或查询期间已变化");
      lastRev = update.rev;
      const value = update.fields?.["System.History"]?.newValue;
      if (value !== undefined && typeof value !== "string") throw new UnknownError("TFS History 正文不可确认");
      if (typeof value === "string") history.push(value);
      skip++;
    }
  }
  if (lastRev !== item.rev) throw new UnknownError("TFS History 未覆盖当前 revision");
  const after = await get(base + "?api-version=4.1");
  if (after.id !== id || after.rev !== item.rev) throw new UnknownError("TFS History 查询期间发生变化，先对账再重试");
  return history;
}

/** 未标记的旧格式命中时不能确认当前候选，保守停止而非重复发布。 */
export function hasDeliveryComment(history: string[], reference: string, legacy: string): boolean {
  if (history.some(h => h.includes(reference))) return true;
  if (history.some(h => h.includes(legacy))) throw new UnknownError("存在无稳定交付引用的旧收口评论，无法确认是否为本次交付");
  return false;
}
