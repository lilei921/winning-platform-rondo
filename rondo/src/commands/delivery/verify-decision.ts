/**
 * Human-approved Independent Verification Decision.
 * Analysis Recommendation is advice only; never derive the effective decision from it.
 * Approval lives on the existing Multica Issue (no additional status).
 */
import { UnknownError } from "../../cli/errors.js";
import { readAnalysisSource, parseAnalysisSource, sameAnalysisSource } from "../analysis/source.js";

export interface ApprovedVerifyDecision {
  required: boolean;
  commentRef: string;
  waivedTasks: string[];
}

/** A missing waiver is an empty set; malformed persisted facts never grant a waiver. */
export function parseWaivedTasks(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(ref => typeof ref !== "string" || !/^\d+(?:\.\d+)*$/.test(ref)) ||
      new Set(value).size !== value.length) {
    throw new UnknownError("analysis.human_approval.waived_tasks 必须是无重复的任务编号数组");
  }
  return [...value].sort();
}

/** Delivery Lead records an explicitly understood Human approval and its source comment. */
export function readApprovedVerifyDecision(
  md: Record<string, unknown>,
  expectedCommentRef?: string,
): ApprovedVerifyDecision {
  const raw = md["analysis.human_approval"];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new UnknownError("缺少 analysis.human_approval，无法确认最终 Verify Decision");
  }
  let approval: unknown;
  try { approval = JSON.parse(raw); }
  catch { throw new UnknownError("analysis.human_approval 不是合法 JSON"); }
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
    throw new UnknownError("analysis.human_approval 格式非法");
  }
  const a = approval as Record<string, unknown>;
  if (a.decision !== "approved") {
    throw new UnknownError("analysis.human_approval 尚未批准，不得派发或收口");
  }
  if (typeof a.comment_ref !== "string" || !a.comment_ref.trim()) {
    throw new UnknownError("analysis.human_approval 缺少批准评论引用 comment_ref");
  }
  if (expectedCommentRef && a.comment_ref !== expectedCommentRef) {
    throw new UnknownError("当前批准评论与 --approved-comment-ref 不一致，禁止使用其他轮次批准");
  }
  // The Lead owns semantic approval and permission checks; CLI enforces the
  // deterministic shape of the recorded approval, not its natural language.
  if (typeof a.by !== "string" || !a.by.trim()) {
    throw new UnknownError("analysis.human_approval 缺少批准人 by");
  }
  if (typeof a.at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(a.at) ||
      Number.isNaN(Date.parse(a.at))) {
    throw new UnknownError("analysis.human_approval.at 必须是有效的 ISO8601 时间");
  }
  if (typeof a.verify_agent_required !== "boolean") {
    throw new UnknownError("analysis.human_approval 缺少明确的 verify_agent_required boolean，不能默认使用 Analyst Recommendation");
  }
  const waivedTasks = parseWaivedTasks(a.waived_tasks);
  if (waivedTasks.length && (!md["analysis.source"] || !a.source)) {
    throw new UnknownError("Task Waiver 缺少获批 Analysis Source");
  }
  const source = readAnalysisSource(md);
  if (!sameAnalysisSource(source, parseAnalysisSource(a.source, source.change_ref))) {
    throw new UnknownError("Human 批准的规范版本与 analysis.source 不一致，须重新审核");
  }
  return { required: a.verify_agent_required, commentRef: a.comment_ref, waivedTasks };
}

