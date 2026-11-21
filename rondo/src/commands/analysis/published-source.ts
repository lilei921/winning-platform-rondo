import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { FailError, UnknownError } from "../../cli/errors.js";
import { readGitTree, readGitBlob } from "../../clients/git-tree.js";
import { RemoteArtifactReader } from "../delivery/remote-artifacts.js";
import type { Facts } from "./facts.js";
import { parseChangeSchema } from "./change-schema.js";
import { changeEvidenceDigest, digestGateFiles } from "./gate-evidence.js";
import type { AnalysisSource } from "./source.js";

/** Read a pinned remote Engineering Contract. No Gate file is stored in Git. */
export async function readPublishedContract(source: AnalysisSource, metadata: Record<string, unknown>) {
  const reader = new RemoteArtifactReader(source.repo_url);
  const prefix = "/openspec/changes/" + source.change_ref;
  const items = await reader.list(source.commit, prefix);
  const contents = new Map<string, Buffer>();
  const selected = new Set<string>();
  for (const item of items) {
    if (item.isFolder || !item.path.startsWith(prefix + "/")) continue;
    const name = item.path.slice(prefix.length + 1);
    contents.set(name, Buffer.from(await reader.read(source.commit, item.path), "utf8"));
    if (name === "design.md" || (name.startsWith("specs/") && name.endsWith(".md"))) selected.add(name);
  }
  const read = (name: string): Buffer => {
    const data = contents.get(name);
    if (!data) throw new FailError("固定 Git 版本缺少 Gate 所需工件: " + name);
    return data;
  };
  const schema = parseChangeSchema(read(".openspec.yaml").toString("utf8"));
  const digest = digestGateFiles(source.change_ref, selected, metadata, read, true);
  return { schema, digest };
}

/** Check that local bytes inspected by the final Gate match the immutable Git candidate. */
export function assertCommittedContractFiles(
  root: string, source: AnalysisSource, metadata: Record<string, unknown>, expectedDigest: string,
): void {
  const prefix = `openspec/changes/${source.change_ref}/`;
  const normalize = (bytes: Buffer): string => bytes.toString("latin1").replace(/\r\n/g, "\n");
  const actual = changeEvidenceDigest(join(root, prefix), metadata, (name, bytes) => {
    const result = spawnSync("git", ["cat-file", "blob", `${source.commit}:${prefix}${name}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0 || normalize(result.stdout) !== normalize(bytes)) {
      throw new UnknownError(`Gate 工件 ${name} 与固定 commit 正文不一致，不能发布来源`);
    }
  }, true);
  if (actual !== expectedDigest) throw new UnknownError("Gate 工件在来源核验期间变化，停止发布");
}

/** Compare a Git candidate's actual tree to the same in-memory Gate contract. */
export function committedContract(
  root: string, commit: string, facts: Facts, meta: Record<string, unknown>,
) {
  const tree = readGitTree(root, commit, "openspec/changes/" + facts.change_ref);
  const read = (path: string): Buffer => {
    const entry = tree.get(path);
    if (!entry || !/^100(?:644|755)$/.test(entry.mode)) throw new FailError("Git 版本缺少普通 Gate 工件: " + path);
    return readGitBlob(root, entry.oid);
  };
  const schema = parseChangeSchema(read(".openspec.yaml").toString("utf8"));
  const selected = new Set<string>();
  for (const [name, entry] of tree) {
    if (name === "specs" || (name.startsWith("specs/") && entry.mode === "120000")) {
      throw new FailError("Specs 包含不可验证的 Git 工件: " + name);
    }
    if (name === "design.md" || (name.startsWith("specs/") && name.endsWith(".md"))) selected.add(name);
  }
  const digest = digestGateFiles(facts.change_ref, selected, meta, read, true);
  return { schema, digest };
}
