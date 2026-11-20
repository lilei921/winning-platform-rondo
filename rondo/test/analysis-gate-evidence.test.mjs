import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { changeEvidenceDigest, metadataEvidenceDigest, verifyGateEvidence, ANALYSIS_GATE_CHECKS } from "../dist/commands/analysis/gate-evidence.js";
import { draftMetadataEntries } from "../dist/commands/analysis/facts.js";

/** 证据单测只操作临时 Change；完整命令链另由 analysis-complete.test 验证。 */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "rondo-gate-evidence-"));
  t.after(() => { assert.equal(dirname(resolve(root)), resolve(tmpdir())); rmSync(root, { recursive: true, force: true }); });
  const dir = join(root, "openspec/changes/fixture-123");
  mkdirSync(join(dir, "logs"), { recursive: true });
  writeFileSync(join(dir, ".openspec.yaml"), "schema: corrective-change\n");
  writeFileSync(join(dir, "proposal.md"), "Expected Behavior\nRoot Cause\nFix Strategy\nRegression Scope\n");
  writeFileSync(join(dir, "tasks.md"), "- [ ] 1.1 验证 Fix\n");
  const facts = { change_kind: "corrective", change_ref: "fixture-123",
    verify_agent: { recommendation: "not_required", reason: "本地可验证", focus_refs: ["proposal.md"] } };
  const handoff = join(dir, "analysis-handoff.json");
  writeFileSync(handoff, JSON.stringify(facts));
  const meta = { "tfs.id": "123", "tfs.type": "Bug", ...draftMetadataEntries(facts) };
  const evidence = { result: "PASS", issue_id: "issue-1", workspace_id: "ws-test", change_ref: facts.change_ref,
    change_kind: facts.change_kind, schema: "corrective-change", change_digest: changeEvidenceDigest(dir, meta),
    metadata_digest: metadataEvidenceDigest(meta), checks: ANALYSIS_GATE_CHECKS.map(name => ({ name, result: "PASS" })) };
  const ref = "openspec/changes/fixture-123/logs/analysis-gate-result.json";
  const save = () => writeFileSync(join(root, ref), JSON.stringify(evidence));
  save();
  facts.gate = { result: "PASS", reasons_ref: ref };
  const verify = () => verifyGateEvidence(root, facts, "corrective-change", "issue-1", "ws-test", meta);
  return { dir, handoff, facts, meta, evidence, save, verify };
}

test("Handoff 补写 gate 不失效，修改专业 Facts 或 Review 日志必须失效", t => {
  const f = fixture(t);
  writeFileSync(f.handoff, JSON.stringify(f.facts, null, 2));
  assert.doesNotThrow(f.verify);
  f.facts.verify_agent.reason = "更改专业结论";
  writeFileSync(f.handoff, JSON.stringify(f.facts));
  assert.throws(f.verify, /工件已变化/);
});

test("Gate 后即使 Facts 与 metadata 一起被替换也不能复用旧 PASS", t => {
  const f = fixture(t);
  f.facts.verify_agent.recommendation = "required";
  Object.assign(f.meta, draftMetadataEntries(f.facts));
  assert.throws(f.verify, /Facts/);
});

test("外部 Facts 必须与 Gate 审核的 metadata 一致", t => {
  const f = fixture(t);
  f.facts.verify_agent.reason = "仅替换输入文件";
  assert.throws(f.verify, /Facts/);
});

for (const field of ["issue_id", "workspace_id", "schema", "change_digest", "metadata_digest"]) {
  test(`拒绝错配的 Gate ${field}`, t => {
    const f = fixture(t); f.evidence[field] = "wrong"; f.save();
    assert.throws(f.verify, /不一致/);
  });
}

test("Gate 缺项、重复检查与伪 PASS 都不得提交", t => {
  const f = fixture(t);
  f.evidence.checks.pop(); f.save(); assert.throws(f.verify, /检查项/);
  f.evidence.checks.push(f.evidence.checks[0]); f.save(); assert.throws(f.verify, /重复/);
  f.evidence.result = "FAIL"; f.save(); assert.throws(f.verify, /不是 PASS/);
});

test("未引用的运行日志不使 Gate 过期；明确引用的 Review Evidence 受摘要保护", t => {
  const f = fixture(t);
  const before = changeEvidenceDigest(f.dir, f.meta);
  writeFileSync(join(f.dir, "logs", "debug.log"), "unrelated runtime output");
  writeFileSync(join(f.dir, "logs", "review.json"), JSON.stringify({ reviewed: "v1" }));
  assert.equal(changeEvidenceDigest(f.dir, f.meta), before);
  assert.doesNotThrow(f.verify);

  f.meta["analysis.verify_agent.focus_refs"] = JSON.stringify(["proposal.md", "logs/review.json"]);
  f.facts.verify_agent.focus_refs = ["proposal.md", "logs/review.json"];
  f.evidence.metadata_digest = metadataEvidenceDigest(f.meta);
  f.evidence.change_digest = changeEvidenceDigest(f.dir, f.meta);
  f.save();
  assert.doesNotThrow(f.verify);
  writeFileSync(join(f.dir, "logs", "review.json"), JSON.stringify({ reviewed: "v2" }));
  assert.throws(f.verify, /工件已变化/);
});

test("Handoff 的派生 gate 不影响摘要；专业字段改变或 JSON 损坏仍拒绝", t => {
  const f = fixture(t);
  const before = changeEvidenceDigest(f.dir, f.meta);
  writeFileSync(f.handoff, JSON.stringify({ change_kind: "corrective", change_ref: "fixture-123",
    verify_agent: { recommendation: "not_required", reason: "本地可验证", focus_refs: ["proposal.md"] },
    gate: { result: "PASS" } }, null, 2));
  assert.equal(changeEvidenceDigest(f.dir, f.meta), before);
  writeFileSync(f.handoff, "{broken");
  assert.throws(() => changeEvidenceDigest(f.dir, f.meta), /Handoff/);
});

test("缺失、跨 Change 和不安全的被引用证据不得悄悄忽略", t => {
  const f = fixture(t);
  const withFindings = (ref) => ({ ...f.meta, "analysis.ai_review.findings_ref": ref });
  assert.throws(() => changeEvidenceDigest(f.dir, withFindings("logs/missing.md")), /不存在/);
  assert.throws(() => changeEvidenceDigest(f.dir, withFindings("openspec/changes/other-999/review.md")), /其他 Change/);
  assert.throws(() => changeEvidenceDigest(f.dir, withFindings("logs/../review.md")), /不安全/);
  assert.throws(() => changeEvidenceDigest(f.dir, withFindings("logs/analysis-gate-result.json")), /自引用/);
});

test("Gate 不接受符号链接形式的 Change 或被引用 Evidence", { skip: process.platform === "win32" }, t => {
  const f = fixture(t);
  const linked = join(f.dir, "logs", "linked-review.md");
  symlinkSync(join(f.dir, "proposal.md"), linked);
  const refs = { ...f.meta, "analysis.ai_review.findings_ref": "logs/linked-review.md" };
  assert.throws(() => changeEvidenceDigest(f.dir, refs), /非普通文件|符号链接/);
  const alias = join(dirname(f.dir), "alias-change");
  symlinkSync(f.dir, alias, "dir");
  assert.throws(() => changeEvidenceDigest(alias, f.meta), /无法安全读取 Change 目录/);
});
