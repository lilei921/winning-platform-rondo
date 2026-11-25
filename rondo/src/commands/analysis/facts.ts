/**
 * Analysis Handoff Facts 的单一字段契约（validate / complete 共用）。
 * TFS Type、持久化的 analysis.change_kind 与 OpenSpec Schema 各司其职；不维护独立路由。
 * 输入检查确认字段形状；专业审查由 Analyst 负责。
 * complete 与 validate 使用本次 Facts。
 */
import { readFileSync } from "node:fs";
import { UnknownError } from "../../cli/errors.js";
import { CHANGE_KINDS, changeKindSchemaViolation, isStableChangeRef, type ChangeKind, type ChangeSchema } from "./change-schema.js";

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
 * 检查本次 Facts 的基础形状；传入 canonical Schema 时检查分类与 Schema 一致。
 * 必填 change_kind 是可跨 Run 查询和统计的专业分类，不是固定流程选择器。
 */
export function validateDraftFields(f: Partial<DraftFacts>, schema?: ChangeSchema): string[] {
  const missing: string[] = [];
  if (!CHANGE_KINDS.includes(f.change_kind as ChangeKind)) missing.push("change_kind（corrective/intentional）");
  if (schema) {
    const violation = changeKindSchemaViolation(f.change_kind, schema);
    if (violation) missing.push(violation);
  }
  if (!isStableChangeRef(f.change_ref)) missing.push("change_ref（稳定 Change ID，不得含路径）");
  if (!f.verify_agent || !["required", "not_required"].includes(f.verify_agent.recommendation)) missing.push("verify_agent.recommendation");
  if (typeof f.verify_agent?.reason !== "string" || !f.verify_agent.reason.trim()) missing.push("verify_agent.reason");
  if (!Array.isArray(f.verify_agent?.focus_refs) || f.verify_agent.focus_refs.length === 0 ||
      f.verify_agent.focus_refs.some((x) => typeof x !== "string" || !x.trim())) {
    missing.push("verify_agent.focus_refs（非空字符串引用数组）");
  }
  return missing;
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
  return entries;
}

/** This submission replaces previous professional fields; source facts stay unchanged. */
export function submissionMetadata(meta: Record<string, unknown>, facts: DraftFacts): Record<string, unknown> {
  return { ...meta, ...draftMetadataEntries(facts) };
}
