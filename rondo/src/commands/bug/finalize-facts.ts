/**
 * Shared, read-only facts for the independent TFS Bug delivery path.
 * No OpenSpec Change / Schema / tasks.md dependencies.
 */
import { createHash } from "node:crypto";
import { FailError, UnknownError } from "../../cli/errors.js";
import { assertBugReadyForPr } from "./scope.js";
import { registeredPrs } from "../pr/facts.js";
import { validateBugEvidence } from "./evidence.js";

/** Direct Bug has independent delivery evidence and no OpenSpec Change. */
export function isDirectBugDelivery(md: Record<string, string>): boolean {
  return md["tfs.type"] === "Bug" && !!md.pr && md["analysis.source"] === undefined;
}

/** Bind all repository-specific Bug evidence to the exact PR identities. */
export function assertBugFinalizationFacts(
  md: Record<string, string>, issueStatus: string | undefined,
): void {
  if (!isDirectBugDelivery(md)) throw new FailError("当前 Issue 不属于独立 Bug Delivery");
  if (md["analysis.gate.result"]) throw new FailError("独立 Bug Delivery 不得混入 OpenSpec Analysis Gate");
  if (issueStatus === "blocked") throw new FailError("Issue blocked，禁止 Bug Finalize");
  if (md["verify_agent.required"] === "true") throw new UnknownError("Bug 要求 Independent Verification，尚无可核验独立 PASS，禁止自动 Finalize");
  const required = assertBugReadyForPr(md);
  const prs = registeredPrs(md.pr);
  if (prs.length !== required.length) throw new FailError("Bug pr 未登记全部 required_repos");
  for (const pr of prs) {
    const reasons = validateBugEvidence(pr, {issue: "", tfsId: Number(md["tfs.id"]), repoKey: pr.repo_key, sha: pr.candidate_commit}, false, true);
    if (reasons.length) throw new FailError(pr.repo_key + ": " + reasons.join("；"));
  }
}

/** The merged PR source must be the exact code that passed regression/review. */
export function assertMergedBugSource(
  repoKey: string, actual: string | null | undefined, expected: string | undefined,
): void {
  if (!expected || !/^[0-9a-f]{40}$/i.test(expected) ||
      !actual || !/^[0-9a-f]{40}$/i.test(actual) ||
      actual.toLowerCase() !== expected.toLowerCase()) {
    throw new UnknownError(repoKey +
      ": PR 合并源 Commit 与已验证的 Bug Candidate 不一致或不可查询，禁止 TFS Writeback");
  }
}

/** Used in finalize.prepare and tfs.writeback to prevent stale evidence replay. */
export function bugDeliveryDigest(md: Record<string, string>): string {
  return createHash("sha256").update(JSON.stringify({
    tfs_id: md["tfs.id"] ?? "",
    required_repos: md["bug.required_repos"] ?? "",
    pr: md.pr ?? "",
  })).digest("hex");
}
