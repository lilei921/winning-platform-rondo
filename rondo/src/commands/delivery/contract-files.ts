/**
 * contract-files.ts — OpenSpec Change 契约文件哈希绑定（rll5-replay-remediation-plan M2.1/F2）。
 *
 * 绑定对象 = Change 目录内的契约文件集合：proposal.md / tasks.md（必有）+ design.md（有则）
 * + specs/**\/*.md（递归）。用途：
 *   - 工程师侧：`rondo dev contract-hash` 计算并粘贴进 evidence.json 的 contract_files 字段；
 *   - 交付侧：finalize completion_gate 对每份适用 Evidence 核验哈希（改契约不改 Evidence → FAIL）。
 *
 * 归一化纪律：CRLF/CR → LF（跨平台克隆不抖）；tasks.md 的 checkbox [x]/[X] → [ ]
 * （Progress Patch 勾选不改变契约哈希——勾选是进度事实不是契约语义）。
 *
 * 纯模块：只读 fs + node:crypto，可单测，不依赖 cli/clients 层。
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CONTRACT_ALGORITHM = "sha256" as const;

export interface ContractFiles {
  algorithm: typeof CONTRACT_ALGORITHM;
  /** key = 相对 changeDir 的 POSIX 路径；value = 归一化正文的 sha256 hex。 */
  files: Record<string, string>;
}

export type VerifyResult = { ok: true } | { ok: false; kind: string; problems: string[] };

/** 归一化契约文本（CRLF/CR→LF；tasks.md 额外把 [xX] 复选框归一为 [ ]）。 */
export function normalizeContractText(relPath: string, text: string): string {
  let t = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (relPath === "tasks.md") {
    t = t.replace(/^(\s*-\s*\[)[xX](\])/gm, "$1 $2");
  }
  return t;
}

function walkSpecs(specsDir: string, relPrefix: string, out: string[]): void {
  for (const ent of readdirSync(specsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) walkSpecs(join(specsDir, ent.name), rel, out);
    else if (ent.isFile() && ent.name.endsWith(".md")) out.push(rel);
  }
}

/** 契约文件清单（相对路径，POSIX 分隔，确定性排序）；proposal.md/tasks.md 缺失 → 抛错。 */
export function listContractFiles(changeDir: string): string[] {
  const files: string[] = [];
  for (const f of ["proposal.md", "tasks.md"]) {
    if (!existsSync(join(changeDir, f))) throw new Error(`契约文件缺失: ${f}（${changeDir}）`);
    files.push(f);
  }
  if (existsSync(join(changeDir, "design.md"))) files.push("design.md");
  const specsDir = join(changeDir, "specs");
  const specFiles: string[] = [];
  if (existsSync(specsDir)) walkSpecs(specsDir, "", specFiles);
  specFiles.sort();
  return [...files, ...specFiles.map((f) => `specs/${f}`)];
}

/** 计算契约哈希（sha256，归一化正文）。 */
export function computeContractFiles(changeDir: string): ContractFiles {
  const files: Record<string, string> = {};
  for (const rel of listContractFiles(changeDir)) {
    const text = readFileSync(join(changeDir, ...rel.split("/")), "utf8");
    files[rel] = createHash(CONTRACT_ALGORITHM).update(normalizeContractText(rel, text), "utf8").digest("hex");
  }
  return { algorithm: CONTRACT_ALGORITHM, files };
}

/** 核验：现状与 Evidence 记录的 contract_files 逐文件比对。 */
export function verifyContractFiles(changeDir: string, contract: ContractFiles): VerifyResult {
  if (contract?.algorithm !== CONTRACT_ALGORITHM) {
    return { ok: false, kind: "algorithm_mismatch", problems: [`algorithm=${String(contract?.algorithm)}（须为 ${CONTRACT_ALGORITHM}）`] };
  }
  let current: ContractFiles;
  try {
    current = computeContractFiles(changeDir);
  } catch (exc) {
    return { ok: false, kind: "missing_file", problems: [exc instanceof Error ? exc.message : String(exc)] };
  }
  const problems: string[] = [];
  let kind = "";
  const recorded = contract.files ?? {};
  for (const [rel, hash] of Object.entries(recorded)) {
    if (!(rel in current.files)) {
      problems.push(`${rel}: 已记录但当前不存在`);
      kind = kind || "missing_file";
    } else if (current.files[rel] !== hash) {
      problems.push(`${rel}: 哈希不匹配（契约已变，须重算 rondo dev contract-hash 并复核 Evidence）`);
      kind = kind || "hash_mismatch";
    }
  }
  for (const rel of Object.keys(current.files)) {
    if (!(rel in recorded)) {
      problems.push(`${rel}: 当前存在但 Evidence 未记录`);
      kind = kind || "added_file";
    }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, kind, problems };
}

/** 本 Change 触及的 capability（changeDir/specs 顶层子目录名；M2.5 白名单收窄用）。 */
export function touchedCapabilities(changeDir: string): string[] {
  const specsDir = join(changeDir, "specs");
  if (!existsSync(specsDir)) return [];
  return readdirSync(specsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}
