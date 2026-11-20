/** Explicit new-flow identity from the existing PR branch contract; no dev.dispatch or extra mode metadata. */
import { FailError, UnknownError } from "../../cli/errors.js";
import { checkedTaskProgress, validateChangeDelivery } from "../dev/change-completion.js";
import { parseRepositoryScope } from "../analysis/repository-scope.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function isRequirementChangeDelivery(md: Record<string, string>): boolean {
  if (md["tfs.type"] !== "需求" || !md["analysis.source"] || !md.pr_prep) return false;
  let prep: unknown;
  try { prep = JSON.parse(md.pr_prep); }
  catch { throw new UnknownError("Requirement pr_prep 不是合法 JSON"); }
  if (!Array.isArray(prep) || !prep.length) return false;
  const tfsId = Number(md["tfs.id"]);
  if (!Number.isSafeInteger(tfsId) || tfsId <= 0) throw new FailError("TFS Requirement ID 非法");
  const match = prep.map(v => v && typeof v === "object" && (v as {source_branch?: string}).source_branch === "feature/" + tfsId);
  if (match.some(Boolean) && !match.every(Boolean)) throw new FailError("同一 Issue 混合新旧 PR 分支，无法安全判断 Delivery 模式");
  if (match.every(Boolean) && md["dev.dispatch"]) {
    // Existing dispatch is a different delivery authority. No implicit downgrade or mixed settlement.
    throw new FailError("Requirement Change 不能同时使用旧 dev.dispatch 派发事实");
  }
  return match.every(Boolean);
}

/** Pure, archive-safe local verification of the new Change-level evidence. */
export function assertRequirementEvidence(
  registry: Record<string, {repo_path?: string; repo_url?: string; default_target_branch?: string}>,
  md: Record<string, string>, changeDir: string, changeRef: string,
): void {
  checkedTaskProgress(readFileSync(join(changeDir, "tasks.md"), "utf8"));
  let prep: unknown;
  try { prep = JSON.parse(md.pr_prep ?? "null"); }
  catch { throw new UnknownError("Requirement pr_prep 非法"); }
  const evidence: Record<string, unknown> = {};
  for (const file of readdirSync(changeDir)) {
    if (!/^evidence[^/]*\.json$/i.test(file)) continue;
    let ev: unknown;
    try { ev = JSON.parse(readFileSync(join(changeDir, file), "utf8")); }
    catch { throw new FailError("Evidence JSON 损坏: " + file); }
    if (!ev || typeof ev !== "object" || Array.isArray(ev) || typeof (ev as {repo_key?: unknown}).repo_key !== "string") {
      throw new FailError("Evidence 缺少稳定 repo_key: " + file);
    }
    const key = (ev as {repo_key:string}).repo_key;
    if (key in evidence) throw new FailError("Evidence repo_key 重复: " + key);
    evidence[key] = ev;
  }
  // 收口时从 Change 元数据重新核对仓库范围，防止候选仓库越界。
  const scope = parseRepositoryScope(readFileSync(join(changeDir, ".openspec.yaml"), "utf8"));
  validateChangeDelivery(prep as any[], evidence as any, scope, Number(md["tfs.id"]), registry);
  if (Object.values(evidence).some(e => (e as {change_ref?:string}).change_ref !== changeRef)) {
    throw new FailError("Evidence Change 身份不一致");
  }
}
