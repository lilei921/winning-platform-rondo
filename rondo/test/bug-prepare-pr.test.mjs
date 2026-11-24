import test from "node:test";
import assert from "node:assert/strict";
import { validateBugEvidence, readBugEvidenceInput } from "../dist/commands/bug/evidence.js";
import { FailError, UnknownError } from "../dist/cli/errors.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const identity = { issue: "MUL-123", tfsId: 123, repoKey: "frame-web", sha: "a".repeat(40) };
function valid() {
  return {
    issue: identity.issue, tfs_id: identity.tfsId, repo_key: identity.repoKey,
    candidate_commit: identity.sha,
    expected_behavior: "返回正常列表", actual_behavior: "请求返回 500",
    fix_summary: "修复错误的边界条件",
    root_cause: { confidence: "confirmed", summary: "错误使用空值", evidence_refs: ["test:NullCase"] },
    regression: { result: "PASS", summary: "复现失败用例通过", evidence_refs: ["ci:regression-123"] },
    local_validation: { result: "PASS", summary: "单元测试与编译通过", evidence_refs: ["ci:build-123"] },
    code_review: { result: "PASS", summary: "阻断问题已处理", evidence_refs: ["review:123"], findings: [] },
    blockers: [],
  };
}

test("Bug evidence allows a bounded, verified repair without OpenSpec fields", () => {
  assert.deepEqual(validateBugEvidence(valid(), identity), []);
});

test("Bug evidence rejects identity mismatch and missing regression", () => {
  const ev = valid();
  ev.tfs_id = 999;
  ev.regression.result = "FAIL";
  const reasons = validateBugEvidence(ev, identity);
  assert.ok(reasons.some((x) => x.includes("tfs_id")));
  assert.ok(reasons.some((x) => x.includes("regression.result")));
});

test("probable Root Cause must describe remaining risk", () => {
  const ev = valid();
  ev.root_cause.confidence = "probable";
  assert.ok(validateBugEvidence(ev, identity).some((x) => x.includes("remaining_risk")));
  ev.root_cause.remaining_risk = "仅有生产 Trace，无法完整复现";
  assert.deepEqual(validateBugEvidence(ev, identity), []);
});

test("blocking review findings and unresolved blockers reject readiness", () => {
  const ev = valid();
  ev.code_review.findings = [{ blocking: true, resolved: false }];
  ev.blockers = ["外部 API 行为未获授权"];
  const reasons = validateBugEvidence(ev, identity);
  assert.ok(reasons.some((x) => x.includes("Blocking Finding")));
  assert.ok(reasons.some((x) => x.includes("blockers")));
});

test("compact Bug evidence omits CLI-derived identity without weakening quality checks", () => {
  const ev = valid();
  delete ev.issue;
  delete ev.tfs_id;
  delete ev.repo_key;
  delete ev.candidate_commit;
  assert.deepEqual(validateBugEvidence(ev, identity), []);
  ev.local_validation.evidence_refs = [];
  assert.ok(validateBugEvidence(ev, identity).some(x => x.includes("local_validation.evidence_refs")));
});

test("explicit identity conflicts still fail for all four CLI-derived fields", () => {
  for (const [key, bad] of [
    ["issue", "MUL-999"], ["tfs_id", 999],
    ["repo_key", "wrong-repo"], ["candidate_commit", "b".repeat(40)],
  ]) {
    const ev = valid();
    ev[key] = bad;
    assert.ok(validateBugEvidence(ev, identity).some(x => x.includes(key)), key);
  }
});

test("Bug evidence input supports UTF-8 files with or without BOM and stdin", t => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-bug-evidence-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ev = valid();
  const path = join(dir, "evidence.json");
  for (const prefix of ["", "\uFEFF"]) {
    writeFileSync(path, prefix + JSON.stringify(ev));
    assert.deepEqual(readBugEvidenceInput(path), ev);
  }

  const moduleUrl = new URL("../dist/commands/bug/evidence.js", import.meta.url).href;
  const script = `import { readBugEvidenceInput } from ${JSON.stringify(moduleUrl)};
process.stdout.write(JSON.stringify(readBugEvidenceInput("-")));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8", input: JSON.stringify(ev), timeout: 10_000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), ev);
});

test("empty or malformed Bug input is FAIL; unreadable input is UNKNOWN", t => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-bug-input-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "evidence.json");
  for (const text of ["", "  \n", "\uFEFF", "{", "not-json"]) {
    writeFileSync(path, text);
    assert.throws(() => readBugEvidenceInput(path), FailError);
  }
  assert.throws(() => readBugEvidenceInput(join(dir, "missing.json")), UnknownError);
});

test("interactive Bug evidence stdin is FAIL before any read", () => {
  const moduleUrl = new URL("../dist/commands/bug/evidence.js", import.meta.url).href;
  const errorsUrl = new URL("../dist/cli/errors.js", import.meta.url).href;
  const script = `import { readBugEvidenceInput } from ${JSON.stringify(moduleUrl)};
import { FailError } from ${JSON.stringify(errorsUrl)};
Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
try { readBugEvidenceInput("-"); process.exitCode = 1; }
catch (error) {
  if (!(error instanceof FailError) || !error.message.includes("stdin 管道")) process.exitCode = 2;
}`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", input: "", timeout: 10_000 });
  assert.equal(r.status, 0, r.stderr);
});
