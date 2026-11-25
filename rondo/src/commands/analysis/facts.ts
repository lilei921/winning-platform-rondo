/**
 * Analysis Handoff Facts 的单一字段契约（validate / complete 共用）。
 * TFS Type、持久化的 analysis.change_kind 与 OpenSpec Schema 各司其职；不维护独立路由。
 * 输入检查确认字段形状；Gate 按 Change Schema 检查专业结果；
 * complete 与 validate 使用本次 Facts；审核重放核验已发布 Schema。
 */
import { readFileSync } from "node:fs";
import { UnknownError } from "../../cli/errors.js";
import { CHANGE_KINDS, changeKindSchemaViolation, type ChangeKind, type ChangeSchema } from "./change-schema.js";

/** 来源管理类型，不用于推断 Technical Change Kind。 */
export function classifyTfsType(value: unknown): "bug" | "requirement" | null {
  if (value === "Bug") return "bug";
  if (value === "需求" || value === "Requirement") return "requirement";
  return null;
}

export interface DraftFacts {
  change_kind: ChangeKind;
  change_ref: string;
  verify_agent: { recommendation: string; reason: string; focus_refs: string[] };
  ai_review?: { verdict: string };
}
export type Facts = DraftFacts;

export class PreconditionError extends Error {}

export function loadFactsFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (exc) {
    throw new UnknownError(`无法读取 facts 文件 ${path}: ${exc}`);
  }
}

/**
 * 未传 schema 时检查本次 Facts 的基础形状；传入 canonical Schema
 * 时检查对应专业 Review 必备字段，不允许 Intentional 漏审后 complete。
 * 必填 change_kind 是可跨 Run 查询和统计的专业分类，不是固定流程选择器。
 */
export function validateDraftFields(f: Partial<DraftFacts>, schema?: ChangeSchema): string[] {
  const missing: string[] = [];
  if (!CHANGE_KINDS.includes(f.change_kind as ChangeKind)) missing.push("change_kind（corrective/intentional）");
  if (schema) {
    const violation = changeKindSchemaViolation(f.change_kind, schema);
    if (violation) missing.push(violation);
  }
  if (typeof f.change_ref !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(f.change_ref) || f.change_ref === "." || f.change_ref === "..") missing.push("change_ref（稳定 Change ID，不得含路径）");
  if (!f.verify_agent || !["required", "not_required"].includes(f.verify_agent.recommendation)) missing.push("verify_agent.recommendation");
  if (typeof f.verify_agent?.reason !== "string" || !f.verify_agent.reason.trim()) missing.push("verify_agent.reason");
  if (!Array.isArray(f.verify_agent?.focus_refs) || f.verify_agent.focus_refs.length === 0 ||
      f.verify_agent.focus_refs.some((x) => typeof x !== "string" || !x.trim())) {
    missing.push("verify_agent.focus_refs（非空字符串引用数组）");
  }
  if (f.ai_review !== undefined && !["APPROVED", "NEEDS_REVISION"].includes(f.ai_review?.verdict ?? "")) missing.push("ai_review.verdict");
  if (schema) {
    const reason = reviewVerdictViolation(schema, f.ai_review?.verdict);
    if (reason) missing.push(reason);
  }
  return missing;
}

/** Intentional 必须通过专业审查；Corrective 不强制 Review。 */
export function reviewVerdictViolation(schema: ChangeSchema, verdict: unknown): string | null {
  if (schema !== "intentional-change" || verdict === "APPROVED") return null;
  return verdict === "NEEDS_REVISION" ? "ai_review.verdict=NEEDS_REVISION（尚未通过专业审查）" : "ai_review.verdict 缺失或非法";
}

/** Both CLI entrypoints validate input before projecting professional fields. */
export function loadValidatedFacts(path: string): Facts {
  const raw = loadFactsFile(path) as Partial<Facts> | null;
  const missing = raw && typeof raw === "object" && !Array.isArray(raw) ? validateDraftFields(raw) : ["facts 必须为对象"];
  if (missing.length) throw new PreconditionError("facts 字段缺失或非法: " + missing.join("; "));
  return raw as Facts;
}

/** 写入 Multica Issue Metadata，供跨 Run 交接及完成任务的统计分析。 */
export function draftMetadataEntries(f: DraftFacts): Record<string, string> {
  const entries: Record<string, string> = {
    "analysis.change_kind": f.change_kind,
    "analysis.change_ref": f.change_ref,
    "analysis.verify_agent.recommendation": f.verify_agent.recommendation,
    "analysis.verify_agent.reason": f.verify_agent.reason,
    "analysis.verify_agent.focus_refs": JSON.stringify(f.verify_agent.focus_refs),
  };
  if (f.ai_review !== undefined) {
    entries["analysis.ai_review.verdict"] = f.ai_review.verdict;
  }
  return entries;
}

/** This submission replaces previous professional fields; source facts stay unchanged. */
export function submissionMetadata(meta: Record<string, unknown>, facts: DraftFacts): Record<string, unknown> {
  const next: Record<string, unknown> = { ...meta, ...draftMetadataEntries(facts) };
  if (facts.ai_review === undefined) delete next["analysis.ai_review.verdict"];
  return next;
}
