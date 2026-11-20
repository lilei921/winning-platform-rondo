/**
 * Shared, read-only facts for the independent TFS Bug delivery path.
 * No OpenSpec Change / Schema / tasks.md dependencies.
 */
import { createHash } from "node:crypto";
import { FailError, UnknownError } from "../../cli/errors.js";
import { assertBugReadyForPr } from "./scope.js";

export interface BugCurrentPr {
  repo_key: string;
  pr_id: number;
  pr_url: string;
  source_branch: string;
  target_branch: string;
}
interface BugEntry {
  repo_key: string;
  source_branch: string;
  target_branch: string;
  candidate_commit: string;
  tfs_id: number;
  expected_behavior?: string;
  actual_behavior?: string;
  fix_summary?: string;
  root_cause?: { confidence?: string; summary?: string; evidence_refs?: string[]; remaining_risk?: string };
  regression?: { result?: string; summary?: string; evidence_refs?: string[] };
  local_validation?: { result?: string; summary?: string; evidence_refs?: string[] };
  code_review?: {
    result?: string; summary?: string; evidence_refs?: string[];
    findings?: Array<{ resolved?: boolean; blocking?: boolean; risk_note?: string; risk_ref?: string }>;
  };
}
interface PrepEntry {
  repo_key: string;
  source_branch: string;
  target_branch?: string;
  candidate_commit: string;
  title?: string;
  description_ref?: string;
}

function list<T>(raw: string | undefined, field: string): T[] {
  if (!raw) throw new FailError("缺少交付事实: " + field);
  let obj: unknown;
  try { obj = JSON.parse(raw); }
  catch { throw new UnknownError("metadata " + field + " 不是合法 JSON"); }
  if (!Array.isArray(obj) || obj.length === 0) {
    throw new FailError("metadata " + field + " 必须为非空数组");
  }
  return obj as T[];
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function validRefs(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 &&
    value.every((r: unknown) => typeof r === "string" && r.trim().length > 0);
}

/** Legacy/OpenSpec Bug continues through the unchanged Change-based flow. */
export function isDirectBugDelivery(md: Record<string, string>): boolean {
  return md["tfs.type"] === "Bug" && !!md["bug.delivery"] && !md["analysis.change_ref"];
}

/** Bind all repository-specific Bug evidence to the exact PR identities. */
export function assertBugFinalizationFacts(
  md: Record<string, string>, issueStatus: string | undefined,
  prs: BugCurrentPr[],
): void {
  if (!isDirectBugDelivery(md)) throw new FailError("当前 Issue 不属于独立 Bug Delivery");
  if (md["analysis.change_kind"] !== "corrective") {
    throw new FailError("独立 Bug Delivery 要求 analysis.change_kind=corrective");
  }
  if (md["analysis.gate.result"]) {
    throw new FailError("独立 Bug Delivery 不得混入 OpenSpec Analysis Gate");
  }
  if (issueStatus === "blocked") throw new FailError("Issue blocked，禁止 Bug Finalize");
  if (md["verify_agent.required"] === "true") {
    throw new UnknownError("Bug 要求 Independent Verification，尚无可核验独立 PASS，禁止自动 Finalize");
  }
  const required = assertBugReadyForPr(md);
  if (prs.length === 0) throw new FailError("缺少 current_pr");
  const prKeys = prs.map(p => p.repo_key).sort();
  if (prKeys.length !== required.length || required.some((key,i) => key !== prKeys[i])) {
    throw new FailError("Bug current_pr 未覆盖全部 required_repos");
  }
  const entries = list<BugEntry>(md["bug.delivery"], "bug.delivery");
  const prep = list<PrepEntry>(md.pr_prep, "pr_prep");
  const tfsId = Number(md["tfs.id"]);
  if (!Number.isSafeInteger(tfsId) || tfsId <= 0) throw new FailError("tfs.id 非法");
  if (new Set(prs.map(p => p.repo_key)).size !== prs.length ||
      new Set(entries.map(p => p.repo_key)).size !== entries.length ||
      new Set(prep.map(p => p.repo_key)).size !== prep.length) {
    throw new FailError("current_pr / bug.delivery / pr_prep 中存在重复 repo_key");
  }
  if (prs.length !== entries.length || prs.length !== prep.length) {
    throw new FailError("Bug 已准备的仓库与 required PR 数量不一致，禁止漏仓收口");
  }
  for (const pr of prs) {
    const entry = entries.find(e => e.repo_key === pr.repo_key);
    const p = prep.find(e => e.repo_key === pr.repo_key);
    if (!entry || !p || !Number.isSafeInteger(pr.pr_id) || pr.pr_id <= 0 || !pr.pr_url) {
      throw new FailError(pr.repo_key + ": PR / Bug Evidence / Preparation 身份缺失");
    }
    if (!/^[0-9a-f]{40}$/i.test(entry.candidate_commit) ||
        entry.tfs_id !== tfsId ||
        p.candidate_commit !== entry.candidate_commit ||
        p.source_branch !== pr.source_branch ||
        entry.source_branch !== pr.source_branch ||
        (p.target_branch ?? pr.target_branch) !== pr.target_branch ||
        entry.target_branch !== pr.target_branch) {
      throw new FailError(pr.repo_key + ": Candidate Commit / PR Branch / TFS 身份不一致");
    }
    if (entry.root_cause?.confidence !== "confirmed" &&
        entry.root_cause?.confidence !== "probable") {
      throw new FailError(pr.repo_key + ": Root Cause 无可信分类");
    }
    if (!text(entry.expected_behavior) || !text(entry.actual_behavior) || !text(entry.fix_summary)) {
      throw new FailError(pr.repo_key + ": Bug 行为依据或修复摘要缺失");
    }
    if (!text(entry.root_cause?.summary) || !validRefs(entry.root_cause.evidence_refs) ||
        (entry.root_cause.confidence === "probable" && !text(entry.root_cause.remaining_risk))) {
      throw new FailError(pr.repo_key + ": Root Cause Evidence 或剩余风险不足");
    }
    for (const kind of ["regression", "local_validation", "code_review"] as const) {
      const fact = entry[kind];
      if (fact?.result !== "PASS" || !text(fact.summary) || !validRefs(fact.evidence_refs)) {
        throw new FailError(pr.repo_key + ": " + kind + " 缺少有效 PASS 与可核查依据");
      }
    }
    const findings = entry.code_review?.findings ?? [];
    if (!Array.isArray(findings) || findings.some(f => f.resolved !== true &&
        (f.blocking !== false || (!text(f.risk_note) && !text(f.risk_ref))))) {
      throw new FailError(pr.repo_key + ": Code Review 存在未解决的 Blocking Finding 或无解释风险");
    }
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
    change_kind: md["analysis.change_kind"] ?? "",
    required_repos: md["bug.required_repos"] ?? "",
    delivery: md["bug.delivery"] ?? "",
    pr_prep: md.pr_prep ?? "",
    current_pr: md.current_pr ?? "",
  })).digest("hex");
}
