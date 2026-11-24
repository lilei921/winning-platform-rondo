import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderBugPrDescription, resolveDescription } from "../dist/commands/pr/materialize.js";

function delivery(repo_key = "datamodel") {
  return {
    repo_key, tfs_id: 264104, candidate_commit: "a".repeat(40),
    expected_behavior: "SQL 错误应包含可操作的原因",
    actual_behavior: "仅返回通用异常",
    fix_summary: "保留安全的 SQL 错误明细",
    root_cause: { confidence: "confirmed", summary: "异常被过度包装", evidence_refs: ["source:query-service"] },
    regression: { result: "PASS", summary: "11 项相关用例通过", evidence_refs: ["test:query-11"] },
    local_validation: { result: "PASS", summary: "模块构建与测试通过", evidence_refs: ["test:module"] },
    code_review: { result: "PASS", summary: "已检查变更范围", evidence_refs: ["review:264104"], findings: [] },
  };
}

test("Bug PR description uses saved facts and actual validation", () => {
  const desc = renderBugPrDescription(delivery());
  for (const expected of [
    "## Problem", "仅返回通用异常", "## Root Cause", "异常被过度包装",
    "## Fix", "## Validation", "Regression: PASS", "11 项相关用例通过",
    "## Evidence", "source:query-service", "## References", "#264104", "a".repeat(40),
  ]) assert.ok(desc.includes(expected), expected);
});

test("Bug PR description includes probable diagnosis and nonblocking review risks", () => {
  const data = delivery("datamodel-web");
  data.root_cause.confidence = "probable";
  data.root_cause.remaining_risk = "暂无生产环境复现";
  data.code_review.findings = [{ blocking: false, risk_note: "需线上观察" }];
  const desc = renderBugPrDescription(data);
  assert.match(desc, /## Remaining Risks/);
  assert.match(desc, /暂无生产环境复现/);
  assert.match(desc, /需线上观察/);
});

test("Bug PR description blocks missing evidence, FAIL validation and unresolved blocking findings", () => {
  const failed = delivery(); failed.regression.result = "FAIL";
  assert.throws(() => renderBugPrDescription(failed), /incomplete_bug_delivery/);
  const noRefs = delivery(); noRefs.local_validation.evidence_refs = [];
  assert.throws(() => renderBugPrDescription(noRefs), /incomplete_bug_delivery/);
  const findings = delivery(); findings.code_review.findings = [{ blocking: true, resolved: false }];
  assert.throws(() => renderBugPrDescription(findings), /incomplete_bug_delivery/);
});

test("default Bug PR description is generated on the materialization host; explicit file stays unchanged", () => {
  const entry = { repo_key: "datamodel", source_branch: "feature/264104", candidate_commit: "a".repeat(40), title: "Bug Fix" };
  const generated = resolveDescription(entry, delivery());
  try {
    assert.equal(generated.cleanup, true);
    assert.match(readFileSync(generated.file, "utf8"), /异常被过度包装/);
  } finally { if (generated.file) unlinkSync(generated.file); }

  const file = join(tmpdir(), "rondo-pr-description-test-" + process.pid + ".md");
  writeFileSync(file, "Human-authored description\n");
  try {
    const explicit = resolveDescription({ ...entry, description_ref: "file:" + file }, delivery());
    assert.equal(explicit.cleanup, false);
    assert.equal(explicit.file, file);
    assert.equal(readFileSync(explicit.file, "utf8"), "Human-authored description\n");
  } finally { unlinkSync(file); }

  const normal = resolveDescription({ ...entry });
  try { assert.equal(readFileSync(normal.file, "utf8"), "Bug Fix\n"); }
  finally { if (normal.file) unlinkSync(normal.file); }
});
