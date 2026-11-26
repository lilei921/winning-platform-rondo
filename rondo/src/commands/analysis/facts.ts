/** Source classification and machine-consumed Analysis metadata. */
import { changeKindFromSchema, type ChangeSchema } from "./change-schema.js";

/** 来源管理类型，不用于推断 Technical Change Kind。 */
export function classifyTfsType(value: unknown): "bug" | "requirement" | null {
  if (value === "Bug") return "bug";
  if (value === "需求" || value === "Requirement") return "requirement";
  return null;
}

export class PreconditionError extends Error {}

/** Schema is authoritative; persist the derived classification for delivery statistics. */
export function analysisMetadataEntries(schema: ChangeSchema): Record<string, string> {
  return {
    "analysis.change_kind": changeKindFromSchema(schema),
  };
}
