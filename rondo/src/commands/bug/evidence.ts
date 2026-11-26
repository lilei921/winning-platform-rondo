import { readFileSync } from "node:fs";
import { FailError, UnknownError } from "../../cli/errors.js";

interface ValidationFact {
  result?: string;
  summary?: string;
  evidence_refs?: string[];
}
interface BugEvidence {
  issue?: string;
  tfs_id?: number | string;
  repo_key?: string;
  candidate_commit?: string;
  expected_behavior?: string;
  actual_behavior?: string;
  fix_summary?: string;
  root_cause?: {
    confidence?: string;
    summary?: string;
    evidence_refs?: string[];
    remaining_risk?: string;
  };
  regression?: ValidationFact;
  local_validation?: ValidationFact;
  code_review?: ValidationFact & {
    findings?: Array<{ resolved?: boolean; blocking?: boolean; risk_note?: string; risk_ref?: string }>;
  };
  blockers?: string[];
}
function record(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}
function filled(raw: unknown): raw is string {
  return typeof raw === "string" && raw.trim().length > 0;
}
function refs(raw: unknown): boolean {
  return Array.isArray(raw) && raw.length > 0 && raw.every(filled);
}

/** Pure evidence validation; external I/O and Git identity are checked by pr-prepare. */
export function validateBugEvidence(
  raw: unknown, identity: { issue: string; tfsId: number; repoKey: string; sha: string },
  commandPending = false, persisted = false,
): string[] {
  const reasons: string[] = [];
  if (!record(raw)) return ["evidence 必须是 JSON 对象"];
  const ev = raw as BugEvidence;
  // 身份来自已核验的 Issue、Repository 和候选 Commit；输入可省略，但显式给出时不得冲突。
  if (ev.issue !== undefined && ev.issue !== identity.issue) reasons.push("evidence.issue 与当前 Issue 不一致");
  if (ev.tfs_id !== undefined && Number(ev.tfs_id) !== identity.tfsId) reasons.push("evidence.tfs_id 与当前 TFS Bug 不一致");
  if (ev.repo_key !== undefined && ev.repo_key !== identity.repoKey) reasons.push("evidence.repo_key 与准备仓库不一致");
  if (ev.candidate_commit !== undefined && ev.candidate_commit !== identity.sha) reasons.push("evidence.candidate_commit 与候选 SHA 不一致");
  for (const key of ["expected_behavior", "actual_behavior", "fix_summary"] as const) {
    if (!filled(ev[key])) reasons.push("缺少 " + key);
  }
  const root = ev.root_cause;
  if (!root || !["confirmed", "probable"].includes(root.confidence ?? "")) {
    reasons.push("root_cause.confidence 必须为 confirmed 或 probable");
  }
  if (!filled(root?.summary)) reasons.push("root_cause.summary 缺失");
  if (!refs(root?.evidence_refs)) reasons.push("root_cause.evidence_refs 缺少可信引用");
  if (root?.confidence === "probable" && !filled(root.remaining_risk)) {
    reasons.push("probable Root Cause 必须说明 remaining_risk");
  }
  for (const key of ["regression", "local_validation", "code_review"] as const) {
    const item = ev[key];
    if (!(commandPending && key === "local_validation" && item?.result === undefined) && item?.result !== "PASS") reasons.push(key + ".result 必须为 PASS");
    if (!filled(item?.summary)) reasons.push(key + ".summary 缺失");
    if (!refs(item?.evidence_refs)) reasons.push(key + ".evidence_refs 缺少可核查依据");
  }
  const findings = ev.code_review?.findings ?? [];
  if (!Array.isArray(findings)) reasons.push("code_review.findings 必须是数组");
  else findings.forEach((f, i) => {
    if (!record(f)) { reasons.push("code_review.findings[" + i + "] 非法"); return; }
    if (f.resolved === true) return;
    if (f.blocking !== false) reasons.push("code_review.findings[" + i + "] 存在未解决 Blocking Finding");
    else if (!filled(f.risk_note) && !filled(f.risk_ref)) {
      reasons.push("code_review.findings[" + i + "] 未说明 Non-blocking 风险");
    }
  });
  if (!persisted || ev.blockers !== undefined) {
    if (!Array.isArray(ev.blockers)) reasons.push("blockers 必须是数组");
    else if (ev.blockers.length > 0) reasons.push("存在未解决 blockers");
  }
  return reasons;
}

/** 读取 UTF-8 文件或 stdin；输入格式错误为 FAIL，读取失败为 UNKNOWN。 */
export function readBugEvidenceInput(input: string): unknown {
  if (input === "-" && process.stdin.isTTY) throw new FailError("--evidence - 仅接受 stdin 管道，不等待交互输入");
  let text: string;
  try { text = readFileSync(input === "-" ? 0 : input, "utf8").replace(/^\uFEFF/, ""); }
  catch (e) { throw new UnknownError("无法读取 evidence 输入: " + (e as Error).message); }
  if (!text.trim()) throw new FailError("evidence 输入不能为空");
  try { return JSON.parse(text); }
  catch { throw new FailError("evidence 必须是合法 JSON"); }
}
