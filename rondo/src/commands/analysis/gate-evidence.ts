/**
 * Analysis Gate 证据：绑定执行身份、当前 Change 工件和已审核的 Issue Facts。
 * 排除 Gate Result 自身与约定 Handoff 的派生 gate 字段，避免收口步骤使摘要失效；
 * 其他工程内容和 Review Evidence 必须保持一致。摘要不是审批凭据。
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { FailError, UnknownError } from "../../cli/errors.js";
import { assertStableChangeRef, type ChangeSchema, type ChangeKind } from "./change-schema.js";
import { draftMetadataEntries, type Facts } from "./facts.js";

export const ANALYSIS_GATE_CHECKS = [
  "identity", "change", "acceptance_contract", "tasks",
  "verify_recommendation", "ai_review", "openspec_validate",
] as const;

/** JSON 对象键排序；保留数组顺序及所有业务字段，忽略无语义的缩进变化。 */
function canonicalJson(value: unknown): string {
  function ordered(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(ordered);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([key, item]) => [key, ordered(item)]));
    }
    return v;
  }
  return JSON.stringify(ordered(value));
}

/** 只绑定 Gate 消费的来源和分析字段；后续 gate/human_approval 等流程写入不使结果失效。 */
export function metadataEvidenceDigest(meta: Record<string, unknown>): string {
  const keys = ["tfs.id", "tfs.type", "analysis.change_ref", "analysis.change_kind",
    "analysis.verify_agent.recommendation", "analysis.verify_agent.reason", "analysis.verify_agent.focus_refs",
    "analysis.ai_review.verdict", "analysis.ai_review.findings_ref"];
  return createHash("sha256").update(canonicalJson(Object.fromEntries(keys.map(key => [key, meta[key] ?? null])))).digest("hex");
}

/**
 * Hash the engineering contract and explicitly referenced in-Change evidence.
 * Non-referenced runtime/debug logs do not invalidate a professional Gate.
 * External evidence locators remain bound by metadata_digest, not by file bytes.
 */
export function changeEvidenceDigest(changeDir: string, meta?: Record<string, unknown>, inspect?: (name: string, bytes: Buffer) => void, normalizeEol = false): string {
  try {
    if (!lstatSync(changeDir).isDirectory()) throw new Error("不是普通 Change 目录或为符号链接");
  } catch (exc) {
    throw new UnknownError("无法安全读取 Change 目录: " + String(exc));
  }
  const selected = new Set<string>();
  for (const optional of ["design.md", "analysis-handoff.json"]) {
    if (existsSync(join(changeDir, optional))) selected.add(optional);
  }

  function specs(path: string, prefix: string): void {
    if (!existsSync(path)) return;
    let entries;
    try {
      entries = readdirSync(path, { withFileTypes: true });
    } catch (exc) {
      throw new UnknownError("无法读取 Specs: " + String(exc));
    }
    for (const entry of entries) {
      const rel = prefix + "/" + entry.name;
      if (entry.isDirectory()) specs(join(path, entry.name), rel);
      else if (entry.isFile() && entry.name.endsWith(".md")) selected.add(rel);
      else if (entry.isSymbolicLink()) throw new UnknownError("Specs 包含不可验证的链接: " + rel);
    }
  }
  specs(join(changeDir, "specs"), "specs");

  return digestGateFiles(basename(changeDir), selected, meta, name => {
    const file = join(changeDir, ...name.split("/"));
    if (!existsSync(file)) throw new UnknownError("Gate Evidence 引用的工件不存在: " + name);
    let bytes: Buffer;
    try {
      let parent = changeDir;
      for (const part of name.split("/").slice(0, -1)) {
        parent = join(parent, part);
        if (lstatSync(parent).isSymbolicLink()) throw new Error("父目录为符号链接");
      }
      if (!lstatSync(file).isFile()) throw new Error("非普通文件或符号链接");
      bytes = readFileSync(file);
    } catch (exc) {
      throw new UnknownError("无法验证 Change Evidence " + name + ": " + String(exc));
    }
    inspect?.(name, bytes);
    return bytes;
  }, normalizeEol);
}

/** The same selection and byte digest apply to worktree validation and immutable Git snapshots. */
export function digestGateFiles(changeId: string, selected: Set<string>, meta: Record<string, unknown> | undefined,
  read: (name: string) => Buffer, normalizeEol: boolean): string {
  for (const name of [".openspec.yaml", "proposal.md", "tasks.md"]) selected.add(name);
  function includeReference(input: unknown): void {
    if (typeof input !== "string") return;
    const value = input.trim().split("#", 1)[0].replaceAll("\\", "/");
    if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(value)) return;
    const prefix = "openspec/changes/" + changeId + "/";
    let rel: string;
    if (value.startsWith(prefix)) rel = value.slice(prefix.length);
    else if (value.startsWith("openspec/changes/")) throw new UnknownError("Evidence 引用其他 Change: " + value);
    else if (value.startsWith("./")) rel = value.slice(2);
    else if (/^(?:\.openspec\.yaml|proposal\.md|design\.md|tasks\.md|analysis-handoff\.json|specs\/|logs\/|review\/|evidence\/|references\/)/.test(value)) rel = value;
    else return; // External repository/Issue reference: bind the locator in metadata_digest.
    if (!rel || rel.split("/").some(segment => !segment || segment === "." || segment === "..")) {
      throw new UnknownError("Evidence 路径不安全: " + value);
    }
    if (rel === "logs/analysis-gate-result.json" || rel.startsWith("logs/analysis-gate-result.json.tmp-")) {
      throw new UnknownError("Evidence 不得自引用 Gate Result");
    }
    selected.add(rel);
  }

  if (meta) {
    includeReference(meta["analysis.ai_review.findings_ref"]);
    const rawFocus = meta["analysis.verify_agent.focus_refs"];
    if (typeof rawFocus === "string") {
      let focus: unknown;
      try { focus = JSON.parse(rawFocus); }
      catch { throw new UnknownError("无法解析 Verify Evidence 引用数组"); }
      if (!Array.isArray(focus)) throw new UnknownError("Verify Evidence 必须是引用数组");
      focus.forEach(includeReference);
    }
  }

  const hash = createHash("sha256");
  for (const name of [...selected].sort((a, b) => a.localeCompare(b, "en"))) {
    let bytes = read(name);
    if (normalizeEol && /\.(?:md|ya?ml|json|txt)$/i.test(name)) {
      bytes = Buffer.from(bytes.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
    }
    if (name === "analysis-handoff.json") {
      try {
        const handoff = JSON.parse(bytes.toString("utf8"));
        if (!handoff || typeof handoff !== "object" || Array.isArray(handoff)) throw new Error("必须为对象");
        delete handoff.gate;
        bytes = Buffer.from(canonicalJson(handoff));
      } catch (exc) {
        throw new UnknownError("无法解析 Handoff Facts: " + String(exc));
      }
    }
    hash.update(name).update("\0").update(String(bytes.length)).update("\0").update(bytes).update("\0");
  }
  return hash.digest("hex");
}

export interface GateEvidence {
  result: string;
  issue_id: string;
  workspace_id: string;
  change_ref: string;
  change_kind: ChangeKind;
  schema: ChangeSchema;
  change_digest: string;
  digest_eol?: "lf";
  metadata_digest: string;
  checks: Array<{ name: string; result: string }>;
}

/** 拒绝错配或过期结果，不能只凭输入 Facts 中的 PASS 字符串提交审核。 */
export function verifyGateEvidence(
  rootRepo: string,
  facts: Facts,
  schema: ChangeSchema,
  issueId: string,
  workspaceId: string,
  metadata: Record<string, unknown>,
): GateEvidence {
  assertStableChangeRef(facts.change_ref);
  const expectedRef = `openspec/changes/${facts.change_ref}/logs/analysis-gate-result.json`;
  if (facts.gate.reasons_ref !== expectedRef) {
    throw new FailError(`gate.reasons_ref 必须是本次 Change 的 Gate 结果：${expectedRef}`);
  }
  const path = resolve(rootRepo, facts.gate.reasons_ref);
  let gate: unknown;
  try {
    gate = JSON.parse(readFileSync(path, "utf8"));
  } catch (exc) {
    throw new UnknownError(`无法读取/解析 Gate Result ${path}: ${String(exc)}`);
  }
  const dir = join(rootRepo, "openspec", "changes", facts.change_ref);
  return verifyGateEvidenceData(gate, facts, schema, issueId, workspaceId, metadata, changeEvidenceDigest(dir, metadata, undefined, (gate as GateEvidence | null)?.digest_eol === "lf"));
}

/** 审核重放核验固定 commit 内的 Gate，不能仅凭 metadata PASS 或 tasks.md 存在放行。 */
export function verifyGateEvidenceData(
  gate: unknown, facts: Facts, schema: ChangeSchema, issueId: string,
  workspaceId: string, metadata: Record<string, unknown>, digest?: string,
): GateEvidence {
  if (facts.gate.reasons_ref !== `openspec/changes/${facts.change_ref}/logs/analysis-gate-result.json`) {
    throw new FailError("gate.reasons_ref 必须引用当前 Change 的固定 Gate Result");
  }
  if (!gate || typeof gate !== "object") throw new FailError("Gate Result 不是对象");
  const evidence = gate as Partial<GateEvidence>;
  const mismatches: string[] = [];
  if (evidence.result !== "PASS" || facts.gate.result !== "PASS") mismatches.push("Gate Result 不是 PASS");
  if (evidence.issue_id !== issueId) mismatches.push("issue_id");
  if (evidence.workspace_id !== workspaceId) mismatches.push("workspace_id");
  if (evidence.change_ref !== facts.change_ref) mismatches.push("change_ref");
  if (evidence.change_kind !== facts.change_kind) mismatches.push("change_kind");
  if (evidence.schema !== schema) mismatches.push("schema");
  if (evidence.metadata_digest !== metadataEvidenceDigest(metadata) ||
      evidence.metadata_digest !== metadataEvidenceDigest({ ...metadata, ...draftMetadataEntries(facts) })) {
    mismatches.push("Analysis Facts 与 Gate 审核快照不一致，请重新 stage 和 Gate");
  }

  if (!Array.isArray(evidence.checks)) {
    mismatches.push("checks");
  } else {
    const observed = new Map<string, string>();
    for (const check of evidence.checks) {
      if (!check || typeof check.name !== "string" || observed.has(check.name)) {
        mismatches.push("checks 存在重复或非法项"); break;
      }
      observed.set(check.name, check.result);
    }
    if (observed.size !== ANALYSIS_GATE_CHECKS.length ||
        ANALYSIS_GATE_CHECKS.some((name) => observed.get(name) !== "PASS")) {
      mismatches.push("checks 缺少必需 PASS 检查项");
    }
  }
  if (typeof evidence.change_digest !== "string" || !/^[a-f0-9]{64}$/.test(evidence.change_digest)) mismatches.push("change_digest");
  if (digest !== undefined && evidence.change_digest !== digest) mismatches.push("Change 工件已变化，请重新执行 Gate");
  if (mismatches.length) throw new FailError(`Gate Result 与当前 Analysis 不一致: ${mismatches.join("; ")}`);
  return evidence as GateEvidence;
}
