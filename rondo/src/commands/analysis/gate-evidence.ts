/**
 * Analysis Gate 证据：绑定执行身份、当前 Change 工件和已审核的 Issue Facts。
 * 只计算当前 Engineering Contract；专业审核建议不属于确定性 Gate 输入。
 * Gate 是内存执行结果，不在 Change 内存储 Gate 或 Handoff 文件。
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { UnknownError } from "../../cli/errors.js";

export const ANALYSIS_GATE_CHECKS = [
  "identity", "change", "acceptance_contract", "tasks",
  "openspec_validate",
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
  const keys = ["tfs.id", "tfs.type", "analysis.change_ref", "analysis.change_kind"];
  return createHash("sha256").update(canonicalJson(Object.fromEntries(keys.map(key => [key, meta[key] ?? null])))).digest("hex");
}

/**
 * Hash the engineering contract only; runtime/debug logs and professional advice are not Gate input.
 */
export function changeEvidenceDigest(changeDir: string, meta?: Record<string, unknown>, inspect?: (name: string, bytes: Buffer) => void, normalizeEol = false): string {
  try {
    if (!lstatSync(changeDir).isDirectory()) throw new Error("不是普通 Change 目录或为符号链接");
  } catch (exc) {
    throw new UnknownError("无法安全读取 Change 目录: " + String(exc));
  }
  const selected = new Set<string>();
  for (const optional of ["design.md"]) {
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

/** Select the same contract files for worktree, Git tree and remote reads. */
export function selectGateFiles(_changeId: string, selected: Set<string>, _meta: Record<string, unknown> | undefined): Set<string> {
  for (const name of [".openspec.yaml", "proposal.md", "tasks.md"]) selected.add(name);
  return selected;
}

/** The same selection and byte digest apply to worktree validation and immutable Git snapshots. */
export function digestGateFiles(changeId: string, selected: Set<string>, meta: Record<string, unknown> | undefined,
  read: (name: string) => Buffer, normalizeEol: boolean): string {
  const hash = createHash("sha256");
  for (const name of [...selectGateFiles(changeId, selected, meta)].sort((a, b) => a.localeCompare(b, "en"))) {
    let bytes = read(name);
    if (normalizeEol && /\.(?:md|ya?ml|json|txt)$/i.test(name)) {
      bytes = Buffer.from(bytes.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
    }
    hash.update(name).update("\0").update(String(bytes.length)).update("\0").update(bytes).update("\0");
  }
  return hash.digest("hex");
}

