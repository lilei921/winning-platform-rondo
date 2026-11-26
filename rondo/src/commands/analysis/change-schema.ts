/**
 * 从当前 Change 的 .openspec.yaml 读取 Schema；不维护第二套 Analysis Route。
 * Change 身份必须先经 Issue / OpenSpec Resolver 核实。本模块仅做安全路径与
 * Canonical Schema 检查，不从 tfs.type 推断专业变更性质。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FailError, UnknownError } from "../../cli/errors.js";

export const CHANGE_SCHEMAS = ["corrective-change", "intentional-change"] as const;
export type ChangeSchema = (typeof CHANGE_SCHEMAS)[number];
export const CHANGE_KINDS = ["corrective", "intentional"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** Change Kind 是 Issue 的持久化专业分类；Schema 是当前 Change 的工件契约。 */
export function changeKindFromSchema(schema: ChangeSchema): ChangeKind {
  return schema === "corrective-change" ? "corrective" : "intentional";
}

export function changeKindSchemaViolation(kind: unknown, schema: ChangeSchema): string | null {
  const expected = changeKindFromSchema(schema);
  if (kind !== expected) {
    return `analysis.change_kind=${String(kind)} 与当前 Change Schema=${schema} 不一致（预期 ${expected}）`;
  }
  return null;
}

export function isStableChangeRef(ref: unknown): ref is string {
  return typeof ref === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref);
}

/** Change ID 使用独立的数字型 TFS ID 末尾段。Resolver 与 Analysis Gate 共用。 */
export function matchesTfsChangeId(changeRef: string, tfsId: string): boolean {
  return /^\d+$/.test(tfsId) && changeRef.endsWith(`-${tfsId}`);
}

export function assertStableChangeRef(ref: unknown): asserts ref is string {
  if (!isStableChangeRef(ref)) {
    throw new FailError("analysis.change_ref 非法：必须是稳定 Change ID，不能包含目录分隔符或路径跳转");
  }
}

/** 使用项目已经持久化的 Schema；未知/遗留 Schema 不静默重映射。 */
export function readChangeMetadata(changeDir: string): string {
  try {
    return readFileSync(join(changeDir, ".openspec.yaml"), "utf8");
  } catch (exc) {
    throw new UnknownError(`无法读取 Change 的 .openspec.yaml: ${String(exc)}`);
  }
}

export function readChangeSchema(changeDir: string): ChangeSchema {
  return parseChangeSchema(readChangeMetadata(changeDir));
}

/** 本地文件与远端固定版本共用同一 Schema 解析规则。 */
export function parseChangeSchema(raw: string): ChangeSchema {
  // OpenSpec 的 schema 是根节点 scalar。只读取无缩进的顶层字段；
  // 不能从 metadata.schema 等嵌套字段误取。重复、空值或格式错误全部拒绝。
  const topLevel = raw.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => /^schema\s*:/.test(line));
  if (topLevel.length !== 1) {
    throw new UnknownError(".openspec.yaml 必须包含唯一的顶层 schema 字段");
  }
  const match = topLevel[0].match(/^schema\s*:\s*(?:"([A-Za-z0-9_-]+)"|'([A-Za-z0-9_-]+)'|([A-Za-z0-9_-]+))\s*(?:#.*)?$/);
  if (!match) throw new UnknownError(".openspec.yaml 顶层 schema 字段格式无效");
  const schema = match[1] ?? match[2] ?? match[3];
  if (!(CHANGE_SCHEMAS as readonly string[]).includes(schema)) {
    throw new FailError(`当前 Change Schema=${schema} 不属于已支持的自动交付契约，须交 Human 处理`);
  }
  return schema as ChangeSchema;
}

/** TFS 类型是管理事实，不决定 Schema；此处仅检查明确不允许的组合。 */
export function sourceSchemaViolation(
  tfsKind: "bug" | "requirement" | null,
  schema: ChangeSchema,
): string | null {
  if (!tfsKind) return "tfs.type 缺失或不支持";
  if (tfsKind === "bug" && schema === "intentional-change") {
    return "TFS Bug + Intentional Change 超出既定自动处理边界，须先澄清来源类型与授权";
  }
  return null;
}
