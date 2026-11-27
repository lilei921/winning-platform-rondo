import { readPrRecords } from "../pr/facts.js";
import { candidateBranch } from "../pr/candidate-branch.js";
/** Requirement delivery identity derives from its TFS type and engineering facts. */
import { FailError, UnknownError } from "../../cli/errors.js";
import { checkedTaskProgress } from "../openspec/change-completion.js";
import { readAnalysisSource } from "../analysis/source.js";
import { readApprovedVerifyDecision } from "./verify-decision.js";
import { runCommand } from "../../clients/spawn.js";
import { parseRepositoryScope } from "../analysis/repository-scope.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function isRequirementChangeDelivery(md: Record<string, string>): boolean {
  if (md["tfs.type"] !== "需求" || !md["analysis.source"] || !md.pr) return false;
  const prep = readPrRecords(md.pr);
  if (!prep.length) return false;
  const tfsId = Number(md["tfs.id"]);
  if (!Number.isSafeInteger(tfsId) || tfsId <= 0) throw new FailError("TFS Requirement ID 非法");
  if (!prep.every(v => v && typeof v === "object" && (v as {source_branch?: string}).source_branch === candidateBranch(tfsId))) {
    throw new FailError("Requirement Candidate Branch 与 TFS ID 不一致");
  }
  return true;
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
  if (readApprovedVerifyDecision(md).required) {
    throw new UnknownError("analysis.human_approval.verify_agent_required=true，但尚无可确认的 Independent Verification PASS；禁止 Finalize");
  }
  if (issueStatus === "blocked") throw new FailError("Issue blocked，禁止 Requirement Closeout");
}

/** Check progress on the aligned Change before archive or recovery commit. */
export function assertCompletedRequirementTasks(changeDir: string, waivedTasks: readonly string[] = []): void {
  let tasks: string;
  try { tasks = readFileSync(join(changeDir, "tasks.md"), "utf8"); }
  catch { throw new UnknownError("tasks.md 不存在或不可读"); }
  checkedTaskProgress(tasks, waivedTasks);
}
