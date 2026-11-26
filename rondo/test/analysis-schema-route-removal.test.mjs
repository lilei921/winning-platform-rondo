import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { changeEvidenceDigest } from "../dist/commands/analysis/gate-evidence.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertStableChangeRef,
  readChangeSchema,
  sourceSchemaViolation,
} from "../dist/commands/analysis/change-schema.js";
import {
  analysisMetadataEntries,
} from "../dist/commands/analysis/facts.js";
import {
  checkAcceptanceContract,
  checkChange,
  checkIdentity,
} from "../dist/commands/analysis/validate.js";

function fixture(schema = "corrective-change") {
  const home = mkdtempSync(join(tmpdir(), "rondo-change-schema-"));
  const root = join(home, "openspec");
  const dir = join(root, "changes", "fixture-123");
  const mapping = join(home, "docs", "config", "repo-context.yaml");
  mkdirSync(join(home, "docs", "config"), { recursive: true });
  writeFileSync(mapping, "repos:\n  - repo_id: frame\n  - repo_id: frame-web\n");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".openspec.yaml"), `schema: ${schema}\nx-repositories:\n  - frame\n`, "utf8");
  return { root, dir, mapping, dispose: () => rmSync(home, { recursive: true, force: true }) };
}

test("Issue change_kind 持久化且与 Change Schema 校验一致，不再输出独立 Route", () => {
  const f = fixture();
  try {
    assert.equal(readChangeSchema(f.dir), "corrective-change");
    const entries = analysisMetadataEntries("fixture-123", readChangeSchema(f.dir));
    assert.equal(entries["analysis.change_kind"], "corrective");
    assert.equal(Object.hasOwn(entries, "analysis.route"), false);
    assert.equal(entries["analysis.change_ref"], "fixture-123");
    const checked = checkChange(f.root, { "analysis.change_ref": "fixture-123" });
    assert.equal(checked.check.result, "PASS");
    assert.equal(checked.schema, "corrective-change");
  } finally {
    f.dispose();
  }
});

test("来源管理类型不自动推断 Schema，但拒绝 Bug + Intentional 自动处理", () => {
  assert.equal(sourceSchemaViolation("requirement", "corrective-change"), null);
  assert.equal(sourceSchemaViolation("requirement", "intentional-change"), null);
  assert.equal(sourceSchemaViolation("bug", "corrective-change"), null);
  assert.match(sourceSchemaViolation("bug", "intentional-change"), /超出/);
  assert.equal(checkIdentity({ "tfs.id": "123", "tfs.type": "Requirement", "analysis.change_kind": "corrective" }, "corrective-change", "fixture-123").result, "PASS");
  assert.equal(checkIdentity({ "tfs.id": "123", "tfs.type": "Bug", "analysis.change_kind": "intentional" }, "intentional-change", "fixture-123").result, "FAIL");
  assert.equal(checkIdentity({ "tfs.id": "123", "tfs.type": "Requirement", "analysis.change_kind": "corrective" }, "intentional-change", "fixture-123").result, "PASS");
});

test("Acceptance Contract 根据 Schema 选择而非 Issue 分类字段", () => {
  const corrective = fixture("corrective-change");
  const intentional = fixture("intentional-change");
  try {
    writeFileSync(join(corrective.dir, "proposal.md"),
      "Expected Behavior\nRoot Cause\nFix Strategy\nRegression Scope\n");
    writeFileSync(join(intentional.dir, "proposal.md"), "Why / Goal / Scope\n");
    mkdirSync(join(intentional.dir, "specs", "feature"), { recursive: true });
    writeFileSync(join(intentional.dir, "specs", "feature", "spec.md"), "### Requirement: X\n#### Scenario: Y\n");
    assert.equal(checkAcceptanceContract("corrective-change", corrective.dir, corrective.root).result, "PASS");
    assert.equal(checkAcceptanceContract("intentional-change", intentional.dir, intentional.root).result, "PASS");
    rmSync(join(intentional.dir, "specs"), { recursive: true, force: true });
    // 缺少 Specs 不能靠 Issue 分类字段绕过；原生 skip 状态需要另行核实。
    assert.notEqual(checkAcceptanceContract("intentional-change", intentional.dir, intentional.root).result, "PASS");
  } finally {
    corrective.dispose();
    intentional.dispose();
  }
});

test("Analysis Acceptance Contract 在批准前阻断缺失、非法或重复 Repository Scope", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, "proposal.md"),
      "Expected Behavior\nRoot Cause\nFix Strategy\nRegression Scope\n");
    const path = join(f.dir, ".openspec.yaml");
    for (const metadata of [
      "schema: corrective-change\n",
      "schema: corrective-change\nx-repositories: []\n",
      "schema: corrective-change\nx-repositories: [frame, frame]\n",
      "schema: corrective-change\nx-repositories: [../other]\n",
    ]) {
      writeFileSync(path, metadata);
      const result = checkAcceptanceContract("corrective-change", f.dir, f.root);
      assert.equal(result.result, "FAIL");
      assert.match(result.reasons.join(" "), /x-repositories|Repository Scope/);
    }
    writeFileSync(path, "schema: corrective-change\nx-repositories: [frame]\n");
    assert.equal(checkAcceptanceContract("corrective-change", f.dir, f.root).result, "PASS");
  } finally {
    f.dispose();
  }
});

test("Identity 核对实际 Change ID 与当前 TFS ID 的独立末尾段", () => {
  const metadata = { "tfs.id": "123", "tfs.type": "Requirement", "analysis.change_ref": "stale-999" };
  assert.equal(checkIdentity(metadata, "corrective-change", "fixture-123").result, "PASS");
  for (const ref of ["fixture-9123", "fixture-1234", "fixture-123-extra", "fixture"]) {
    const result = checkIdentity(metadata, "corrective-change", ref);
    assert.equal(result.result, "FAIL");
    assert.match(result.reasons.join(" "), /change_ref=.*tfs.id=/);
  }
  for (const invalid of ["", "abc", "123.4", null, ["123"]]) {
    assert.equal(checkIdentity({ ...metadata, "tfs.id": invalid }, "corrective-change", "fixture-123").result, "FAIL");
  }
  assert.equal(checkIdentity({ ...metadata, "tfs.id": 123 }, "corrective-change", "fixture-123").result, "PASS");
  for (const invalid of ["0", "9007199254740992"]) {
    assert.equal(checkIdentity({ ...metadata, "tfs.id": invalid }, "corrective-change", `fixture-${invalid}`).result, "FAIL");
  }
});

test("Repository Scope 仅接受当前根仓已登记仓库，权威映射不可核实时 UNKNOWN", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, "proposal.md"), "Restore behavior");
    const metadata = join(f.dir, ".openspec.yaml");
    writeFileSync(metadata, "schema: corrective-change\nx-repositories: [frame, frame-web]\n");
    const check = () => checkAcceptanceContract("corrective-change", f.dir, f.root);
    assert.equal(check().result, "PASS");
    writeFileSync(f.mapping, "repos:\n  - repo_id: frame\n  - repo_id: frame-web\n  - repo_id: unrelated_legacy\n  - repo_id: 123\n  - null\n");
    assert.equal(check().result, "PASS");
    writeFileSync(metadata, "schema: corrective-change\nx-repositories: [frame, unknown-repo]\n");
    assert.equal(check().result, "FAIL");
    assert.match(check().reasons.join(" "), /未登记的 repo_id: unknown-repo/);
    writeFileSync(metadata, "schema: corrective-change\nx-repositories: [frame]\n");
    for (const invalid of ["repos: [", "repos: {}", "repos: [{repo_id: 123}]"]) {
      writeFileSync(f.mapping, invalid);
      assert.equal(check().result, "UNKNOWN");
    }
    rmSync(f.mapping);
    assert.equal(check().result, "UNKNOWN");
  } finally {
    f.dispose();
  }
});

test("Schema 必须来自顶层字段，嵌套、重复和非法声明不得被接受", () => {
  const f = fixture();
  const yaml = join(f.dir, ".openspec.yaml");
  try {
    writeFileSync(yaml, "metadata:\n  schema: corrective-change\n");
    assert.throws(() => readChangeSchema(f.dir), /顶层 schema/);
    writeFileSync(yaml, "schema: corrective-change\nschema: intentional-change\n");
    assert.throws(() => readChangeSchema(f.dir), /唯一的顶层 schema/);
    writeFileSync(yaml, 'schema: "corrective-change\n');
    assert.throws(() => readChangeSchema(f.dir), /格式无效/);
    writeFileSync(yaml, "schema: intentional-change\nmetadata:\n  schema: corrective-change\n");
    assert.equal(readChangeSchema(f.dir), "intentional-change");
  } finally {
    f.dispose();
  }
});

test("工件摘要保护实际工程内容，不受历史专业建议引用影响", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, "proposal.md"), "Expected Behavior\nRoot Cause\nFix Strategy\nRegression Scope\n");
    writeFileSync(join(f.dir, "tasks.md"), "- [ ] 1.1 验证修复\n");
    const meta = { "analysis.verify_agent.focus_refs": JSON.stringify(["proposal.md"]) };
    const before = changeEvidenceDigest(f.dir, meta);
    const logs = join(f.dir, "logs");
    mkdirSync(logs);
    writeFileSync(join(logs, "analysis-gate-result.json"), JSON.stringify({ result: "PASS" }));
    writeFileSync(join(logs, "review-findings.md"), "# reviewed");
    assert.equal(changeEvidenceDigest(f.dir, meta), before);
    const reviewed = { "analysis.verify_agent.focus_refs": JSON.stringify(["proposal.md", "logs/review-findings.md"]) };
    const after = changeEvidenceDigest(f.dir, reviewed);
    assert.equal(after, before);
    writeFileSync(join(logs, "review-findings.md"), "# reviewed and amended");
    assert.equal(changeEvidenceDigest(f.dir, reviewed), after);
  } finally {
    f.dispose();
  }
});

test("未知 Schema 与不安全 Change ID 均安全停止", () => {
  const f = fixture("sdd");
  try {
    assert.throws(() => readChangeSchema(f.dir), /不属于已支持/);
    assert.equal(checkChange(f.root, { "analysis.change_ref": "fixture-123" }).check.result, "FAIL");
    assert.throws(() => assertStableChangeRef("../fixture-123"), /非法/);
    assert.equal(checkChange(f.root, { "analysis.change_ref": "../fixture-123" }).check.result, "FAIL");
  } finally {
    f.dispose();
  }
});
