/** Verify the direct Work Item relation for one exact TFS PR identity. */
import { FailError, UnknownError } from "../../cli/errors.js";
import type { TfsClient } from "../client.js";
import type { VerifiedRepo } from "./commit-facts.js";

export async function ensurePrWorkItemLink(client: Pick<TfsClient, "config" | "rawRequest">,
  repo: Pick<VerifiedRepo, "projectId" | "repoId">, prId: number, workItemId: number, allowWrite: boolean): Promise<void> {
  if (![prId, workItemId].every(id => Number.isSafeInteger(id) && id > 0)) throw new FailError("PR / Work Item ID 非法");
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!guid.test(repo.projectId) || !guid.test(repo.repoId)) throw new UnknownError("TFS PR 仓库 GUID 未确认");
  const artifact = `vstfs:///Git/PullRequestId/${repo.projectId}%2F${repo.repoId}%2F${prId}`;
  const url = `${client.config.serverUrl.replace(/\/+$/, "")}/_apis/wit/workitems/${workItemId}?api-version=4.1`;
  const read = async () => {
    const res = await client.rawRequest(url + "&$expand=relations", "GET");
    if (res.statusCode !== 200) throw new UnknownError("Work Item 关联读取失败: HTTP " + res.statusCode);
    let item: any;
    try { item = JSON.parse(res.body); } catch { throw new UnknownError("Work Item 回读 JSON 非法"); }
    if (item.id !== workItemId || (item.relations !== undefined && !Array.isArray(item.relations)))
      throw new UnknownError("Work Item 身份或 relations 无法确认");
    const expected = decodeURIComponent(artifact).toLowerCase();
    return { rev: item.rev, linked: (item.relations ?? []).some((r: any) => {
      if (r?.rel !== "ArtifactLink" || typeof r.url !== "string") return false;
      try { return decodeURIComponent(r.url).toLowerCase() === expected; } catch { return false; }
    }) };
  };
  const before = await read();
  if (before.linked) return;
  if (!allowWrite) throw new FailError("已登记 PR 缺少 Work Item 关联");
  if (!Number.isSafeInteger(before.rev) || before.rev <= 0) throw new UnknownError("Work Item revision 无法确认");
  // Do not retry a write blindly: a lost response may follow a successful PATCH.
  try {
    await client.rawRequest(url, "PATCH", JSON.stringify([
      { op: "test", path: "/rev", value: before.rev },
      { op: "add", path: "/relations/-", value: { rel: "ArtifactLink", url: artifact, attributes: { name: "Pull Request" } } }
    ]), { "Content-Type": "application/json-patch+json" });
  } catch { /* authoritative read-back below */ }
  if (!(await read()).linked) throw new UnknownError("PR Work Item 关联未回读确认");
}
