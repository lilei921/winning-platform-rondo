/** Explicit new-flow identity from the existing PR branch contract; no dev.dispatch or extra mode metadata. */
import { FailError, UnknownError } from "../../cli/errors.js";
import { checkedTaskProgress } from "../dev/change-completion.js";
import { readAnalysisSource } from "../analysis/source.js";
import { assertProjectedVerifyDecision } from "./verify-decision.js";
import { runCommand } from "../../clients/spawn.js";
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

/** Scope is authoritative at the approved Commit, not the latest working or archived file. */
export function approvedRequirementScope(md: Record<string, string>, root: string): string[] {
  const source = readAnalysisSource(md);
  const shown = runCommand(["git", "show", source.commit + ":openspec/changes/" + source.change_ref + "/.openspec.yaml"], root);
  if (shown.status !== 0 || !shown.stdout.trim()) throw new UnknownError("批准版 Repository Scope 不存在或不可读");
  return parseRepositoryScope(shown.stdout);
}

/** First Prepare consumes approval and verification, not Engineering quality evidence. */
export function assertRequirementPrepareGate(md: Record<string, string>, issueStatus: string | undefined): void {
  if (md["analysis.gate.result"] !== "PASS") throw new FailError("analysis.gate.result != PASS");
  if (assertProjectedVerifyDecision(md)) {
    throw new UnknownError("verify_agent.required=true，但尚无可确认的 Independent Verification PASS；禁止 Finalize");
  }
  if (issueStatus === "blocked") throw new FailError("Issue blocked，禁止 Requirement Closeout");
}

/** Check progress on the aligned Change before archive or recovery commit. */
export function assertCompletedRequirementTasks(changeDir: string): void {
  let tasks: string;
  try { tasks = readFileSync(join(changeDir, "tasks.md"), "utf8"); }
  catch { throw new UnknownError("tasks.md 不存在或不可读"); }
  checkedTaskProgress(tasks);
}
