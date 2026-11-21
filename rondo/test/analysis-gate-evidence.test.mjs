import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { changeEvidenceDigest, metadataEvidenceDigest, digestGateFiles } from "../dist/commands/analysis/gate-evidence.js";
import { draftMetadataEntries, validateDraftFields } from "../dist/commands/analysis/facts.js";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "rondo-contract-gate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "openspec", "changes", "fixture-123");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".openspec.yaml"), "schema: intentional-change\nx-repositories: [frame]\n");
  writeFileSync(join(dir, "proposal.md"), "## Why\nProblem\n## What Changes\nFix\n");
  writeFileSync(join(dir, "tasks.md"), "- [ ] 1.1 Fix and verify\n");
  const facts = { change_kind: "intentional", change_ref: "fixture-123",
    verify_agent: { recommendation: "not_required", reason: "reviewed", focus_refs: ["proposal.md"] },
    ai_review: { verdict: "APPROVED" } };
  const meta = { "tfs.id": "123", "tfs.type": "需求", ...draftMetadataEntries(facts) };
  return { root, dir, facts, meta };
}

test("Intentional AI Review 只要求 verdict，findings_ref 不再是必需字段", t => {
  const f = fixture(t);
  assert.deepEqual(validateDraftFields(f.facts, "intentional-change"), []);
  assert.equal(f.meta["analysis.ai_review.findings_ref"], undefined);
  assert.ok(validateDraftFields({ ...f.facts, ai_review: { verdict: "NEEDS_REVISION" } }, "intentional-change").length);
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

test("每个引用的真实 Change 内容改变后，重新计算不同 digest", t => {
  const f = fixture(t);
  const initial = changeEvidenceDigest(f.dir, f.meta);
  f.meta["analysis.verify_agent.focus_refs"] = JSON.stringify(["proposal.md", "review/findings.md"]);
  mkdirSync(join(f.dir, "review"));
  writeFileSync(join(f.dir, "review", "findings.md"), "actual reference");
  const bound = changeEvidenceDigest(f.dir, f.meta);
  assert.notEqual(bound, initial);
  writeFileSync(join(f.dir, "review", "findings.md"), "updated findings");
  assert.notEqual(changeEvidenceDigest(f.dir, f.meta), bound);
});

test("Metadata 摘要绑定 Verdict，不要求已退役的 findings_ref", t => {
  const f = fixture(t);
  const before = metadataEvidenceDigest(f.meta);
  assert.equal(metadataEvidenceDigest({ ...f.meta, "analysis.ai_review.findings_ref": "legacy.md" }), before);
  assert.notEqual(metadataEvidenceDigest({ ...f.meta, "analysis.ai_review.verdict": "NEEDS_REVISION" }), before);
});

test("拒绝不存在的、跨 Change、不安全或自引用的内部证据路径", t => {
  const f = fixture(t);
  for (const value of ["review/missing.md", "openspec/changes/other-999/review.md",
    "logs/../review.md", "logs/analysis-gate-result.json"]) {
    const bad = { ...f.meta, "analysis.verify_agent.focus_refs": JSON.stringify([value]) };
    assert.throws(() => changeEvidenceDigest(f.dir, bad));
  }
});

test("拒绝链接形式的 Change 或显式引用内容", { skip: process.platform === "win32" }, t => {
  const f = fixture(t);
  mkdirSync(join(f.dir, "review"));
  const linked = join(f.dir, "review", "linked.md");
  symlinkSync(join(f.dir, "proposal.md"), linked);
  assert.throws(() => changeEvidenceDigest(f.dir, {
    ...f.meta, "analysis.verify_agent.focus_refs": JSON.stringify(["review/linked.md"]),
  }));
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
