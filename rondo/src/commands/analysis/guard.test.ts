import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertAnalysisWritable } from "./guard.js";
import { assertRegistryWorkspace } from "./complete.js";
import { classifyTfsType } from "./facts.js";

test("Analysis requires in_progress; blocked is not automatic reanalysis permission", () => {
  assert.equal(assertAnalysisWritable({ status: "in_progress" }, {}, "stage"), true);
  for (const status of ["blocked", "done", "todo", "in_review"]) {
    assert.throws(() => assertAnalysisWritable({ status }, {}, "stage"));
    assert.throws(() => assertAnalysisWritable({ status }, {}, "complete", {}));
  }
});

test("historical Human Approval does not permanently prevent authorized reanalysis", () => {
  const historical = { "analysis.human_approval": '{"decision":"approved"}' };
  assert.equal(assertAnalysisWritable({ status: "in_progress" }, historical, "stage"), true);
  assert.equal(assertAnalysisWritable({ status: "in_progress" }, historical, "complete", {}), true);
});

test("complete reuses identical review facts without replaying delivery writes", () => {
  const facts = { "analysis.route": "bug-fix", "analysis.change_ref": "fix-123" };
  assert.equal(assertAnalysisWritable({ status: "analysis_review" }, facts, "complete", facts), false);
  assert.throws(() => assertAnalysisWritable(
    { status: "analysis_review" }, facts, "complete", { ...facts, "analysis.change_ref": "stale-123" },
  ));
  assert.throws(() => assertAnalysisWritable({ status: "analysis_review" }, facts, "stage"));
});

test("TFS management type is classified independently of route", () => {
  assert.equal(classifyTfsType("Bug"), "bug");
  assert.equal(classifyTfsType("需求"), "requirement");
  assert.equal(classifyTfsType("Requirement"), "requirement");
  assert.equal(classifyTfsType("Feature"), null);
});

// TFS 剥离（tfs-writeback-decoupling-plan）：analysis complete 不再回写 TFS，
// 任何类型都不再依赖 tfs_cli；Workspace 身份校验保留（tfs_cli 缺失不报错）。
test("Registry Workspace identity is always validated; tfs_cli no longer required", () => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-analysis-"));
  const path = join(dir, "registry.json");
  try {
    writeFileSync(path, JSON.stringify({ runtime: { workspace_id: "workspace-a" } }));
    assert.doesNotThrow(() => assertRegistryWorkspace(path, "workspace-a"));
    assert.throws(() => assertRegistryWorkspace(path, "workspace-b"));
    writeFileSync(path, JSON.stringify({ runtime: { workspace_id: "workspace-a", tfs_cli: ["tfs-cli"] } }));
    assert.doesNotThrow(() => assertRegistryWorkspace(path, "workspace-a"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
