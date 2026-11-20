/** Complete 只按本次摘要内容认领，不以 ID 缺失判断尚未发布。 */
import { UnknownError } from "../../cli/errors.js";
import type { MulticaClient } from "../../clients/multica.js";

// PR 列表顺序及换行不改变交付身份；其余正文必须一致。
const normalized = (s: string): string => s.split(/\r?\n/).map(l => l.trim()).filter(Boolean).sort().join("\n");
export function ensureDeliverySummary(client: Pick<MulticaClient, "listComments" | "addCommentContent" | "setMetadata">, issueId: string, summary: string): { status: "done" | "skipped"; detail: string } {
  const comments = client.listComments(issueId);
  if (!Array.isArray(comments) || comments.some(c => !c || typeof c.content !== "string")) throw new UnknownError("无法确认完整交付摘要列表，停止 Complete");
  const found = comments.filter(c => normalized(c.content!) === normalized(summary));
  if (found.length) return { status: "skipped", detail: "已存在本次交付摘要，直接复用" };
  const id = client.addCommentContent(issueId, summary);
  // 该引用保存失败时，下次仍可从正文恢复，不要求补存 ID 后才能 Done。
  client.setMetadata(issueId, "delivery.summary_comment_id", id);
  return { status: "done", detail: id };
}
