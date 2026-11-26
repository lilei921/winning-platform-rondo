import test from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { changeEvidenceDigest, metadataEvidenceDigest, digestGateFiles } from "../dist/commands/analysis/gate-evidence.js";
import { analysisMetadataEntries } from "../dist/commands/analysis/facts.js";
import { committedContract } from "../dist/commands/analysis/published-source.js";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "rondo-contract-gate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "openspec", "changes", "fixture-123");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".openspec.yaml"), "schema: intentional-change\nx-repositories: [frame]\n");
  writeFileSync(join(dir, "proposal.md"), "## Why\nProblem\n## What Changes\nFix\n");
  writeFileSync(join(dir, "tasks.md"), "- [ ] 1.1 Fix and verify\n");
  const meta = { "tfs.id": "123", "tfs.type": "需求", ...analysisMetadataEntries("intentional-change") };
  return { root, dir, meta };
}

test("Change Kind is derived from Schema without professional input", t => {
  const f = fixture(t);
  assert.equal(f.meta["analysis.change_kind"], "intentional");
  assert.equal(f.meta["analysis.ai_review.verdict"], undefined);
});

test("Gate 摘要只绑定工程契约，不依赖派生 Handoff 或 Gate JSON", t => {
  const f = fixture(t);
  const original = changeEvidenceDigest(f.dir, f.meta);
  writeFileSync(join(f.dir, "analysis-handoff.json"), JSON.stringify({ gate: { result: "PASS" } }));
  mkdirSync(join(f.dir, "logs"));
  writeFileSync(join(f.dir, "logs", "analysis-gate-result.json"), JSON.stringify({ result: "FAIL" }));
  assert.equal(changeEvidenceDigest(f.dir, f.meta), original);
  writeFileSync(join(f.dir, "proposal.md"), "## Why\nDifferent\n");
  assert.notEqual(changeEvidenceDigest(f.dir, f.meta), original);
});

test("historical advice and review fields do not influence either digest", t => {
  const f = fixture(t);
  const meta = { ...f.meta, "analysis.verify_agent.focus_refs": JSON.stringify(["review/missing.md"]), "analysis.ai_review.verdict": "NEEDS_REVISION" };
  assert.equal(changeEvidenceDigest(f.dir, meta), changeEvidenceDigest(f.dir, f.meta));
  assert.notEqual(metadataEvidenceDigest(meta, "other-123"), metadataEvidenceDigest(meta, "fixture-123"));
  assert.equal(metadataEvidenceDigest(meta, "fixture-123"), metadataEvidenceDigest(f.meta, "fixture-123"));
  assert.notEqual(metadataEvidenceDigest({ ...f.meta, "analysis.change_kind": "corrective" }, "fixture-123"), metadataEvidenceDigest(f.meta, "fixture-123"));
});

test("reject symbolic links in actual contract files", { skip: process.platform === "win32" }, t => {
  const f = fixture(t);
  const actual = join(f.dir, "real-proposal.md");
  writeFileSync(actual, "actual");
  rmSync(join(f.dir, "proposal.md"));
  symlinkSync(actual, join(f.dir, "proposal.md"));
  assert.throws(() => changeEvidenceDigest(f.dir, f.meta));
  const alias = join(dirname(f.dir), "alias");
  symlinkSync(f.dir, alias, "dir");
  assert.throws(() => changeEvidenceDigest(alias, f.meta));
});

test("只读文件快照与 Change 的规范 digest 同算法", t => {
  const f = fixture(t);
  const selected = new Set();
  const read = name => readFileSync(join(f.dir, ...name.split("/")));
  assert.equal(digestGateFiles("fixture-123", selected, f.meta, read, false),
    changeEvidenceDigest(f.dir, f.meta));
  assert.equal(existsSync(join(f.dir, "logs", "analysis-gate-result.json")), false);
});

test("Intentional/Corrective 的真实嵌套 Specs Git Tree 与工作树 Gate 摘要一致", t => {
  const f = fixture(t);
  const specDir = join(f.dir, "specs", "capability");
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "spec.md"), "## ADDED Requirements\n### Requirement: Valid\n");
  function git(...args) {
    const result = spawnSync("git", args, { cwd: f.root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  git("init");
  git("add", "openspec/changes/fixture-123");
  git("-c", "user.email=test@example.invalid", "-c", "user.name=Test", "commit", "-m", "nested specs");
  const expected = changeEvidenceDigest(f.dir, f.meta, undefined, true);
  const { schema, digest } = committedContract(f.root, "HEAD", "fixture-123", f.meta);
  assert.equal(schema, "intentional-change");
  assert.equal(digest, expected);
});
