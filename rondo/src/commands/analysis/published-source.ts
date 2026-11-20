import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { FailError, UnknownError } from "../../cli/errors.js";
import { readGitTree, readGitBlob } from "../../clients/git-tree.js";
import type { Facts } from "./facts.js";
import { parseChangeSchema } from "./change-schema.js";
import { changeEvidenceDigest, digestGateFiles, verifyGateEvidenceData, type GateEvidence } from "./gate-evidence.js";
import { readAnalysisArtifact, type AnalysisSource } from "./source.js";

/** 固定版本的 Schema 与 Gate 一起读取；不以当前工作树的同名文件替代。 */
export async function readPublishedGate(source: AnalysisSource) {
  const schemaFile = await readAnalysisArtifact(source, ".openspec.yaml");
  const gateFile = await readAnalysisArtifact(source, "logs/analysis-gate-result.json");
  let value: unknown;
  try { value = JSON.parse(gateFile.content); }
  catch { throw new UnknownError("固定版本 Gate Result 不是合法 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UnknownError("固定版本 Gate Result 非法");
  return { schema: parseChangeSchema(schemaFile.content), gate: value as GateEvidence };
}

/**
 * git diff 会应用 clean filter，不能证明实际入库正文等于 Gate 检查的工作树。
 * 对全部 Gate 工件直接比对 Git blob；只容忍 Git 常见的 CRLF/LF 换行转换。
 */
export function assertCommittedGateFiles(root: string, source: AnalysisSource, metadata: Record<string, unknown>, expectedDigest: string, normalizeEol = false): void {
  const prefix = `openspec/changes/${source.change_ref}/`;
  const normalize = (bytes: Buffer): string => bytes.toString("latin1").replace(/\r\n/g, "\n");
  const actual = changeEvidenceDigest(join(root, prefix), metadata, (name, bytes) => {
    const result = spawnSync("git", ["cat-file", "blob", `${source.commit}:${prefix}${name}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0 || normalize(result.stdout) !== normalize(bytes)) {
      throw new UnknownError(`Gate 工件 ${name} 与固定 commit 正文不一致，不能发布来源`);
    }
  }, normalizeEol);
  if (actual !== expectedDigest) throw new UnknownError("Gate 工件在来源核验期间变化，停止发布");
}

/** Verify exactly the reviewed contract and evidence in the candidate before Git updates the remote ref. */
export function committedGate(root: string, commit: string, facts: Facts, issueId: string, workspaceId: string, meta: Record<string, unknown>) {
  const tree = readGitTree(root, commit, "openspec/changes/" + facts.change_ref);
  const read = (path: string): Buffer => {
    const entry = tree.get(path);
    if (!entry || !/^100(?:644|755)$/.test(entry.mode)) throw new FailError("Git 版本缺少普通 Gate 工件: " + path);
    return readGitBlob(root, entry.oid);
  };
  const schema = parseChangeSchema(read(".openspec.yaml").toString("utf8"));
  const body = read("logs/analysis-gate-result.json");
  let gate: GateEvidence;
  try { gate = JSON.parse(body.toString("utf8")); }
  catch { throw new FailError("已提交的 Gate Result 不是合法 JSON"); }
  const selected = new Set<string>();
  for (const [name, entry] of tree) {
    if (name === "specs" || (name.startsWith("specs/") && entry.mode === "120000")) {
      throw new FailError("Specs 包含不可验证的 Git 工件: " + name);
    }
    if (["design.md", "analysis-handoff.json"].includes(name) || (name.startsWith("specs/") && name.endsWith(".md"))) {
      selected.add(name);
    }
  }
  const digest = digestGateFiles(facts.change_ref, selected, meta, read, gate?.digest_eol === "lf");
  return { schema, gate: verifyGateEvidenceData(gate, facts, schema, issueId, workspaceId, meta, digest) };
}
