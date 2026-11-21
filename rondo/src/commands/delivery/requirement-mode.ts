/** Explicit new-flow identity from the existing PR branch contract; no dev.dispatch or extra mode metadata. */
import { FailError, UnknownError } from "../../cli/errors.js";
import { checkedTaskProgress, validateChangeDelivery } from "../dev/change-completion.js";
import { parseRepositoryScope } from "../analysis/repository-scope.js";
import { readFileSync } from "node:fs";
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
  // Native delivery facts are pinned per Repository + Candidate in pr_prep.
  // The approved repository scope is still checked against .openspec.yaml.
  const scope = parseRepositoryScope(readFileSync(join(changeDir, ".openspec.yaml"), "utf8"));
  if (md["analysis.change_ref"] !== changeRef) throw new FailError("Requirement Change 身份不一致");
  validateChangeDelivery(prep as any[], scope, Number(md["tfs.id"]), registry);
}
