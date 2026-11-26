import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertAnalysisWritable } from "./guard.js";
import { analysisRuntime } from "./runtime.js";
import { classifyTfsType } from "./facts.js";

test("Analysis requires in_progress; blocked is not automatic reanalysis permission", () => {
  assert.equal(assertAnalysisWritable({ status: "in_progress" }, {}), true);
  for (const status of ["blocked", "done", "todo", "in_review"]) {
    assert.throws(() => assertAnalysisWritable({ status }, {}));
    assert.throws(() => assertAnalysisWritable({ status }, {}, {}));
  }
});

test("historical Human Approval does not permanently prevent authorized reanalysis", () => {
  const historical = { "analysis.human_approval": '{"decision":"approved"}' };
  assert.equal(assertAnalysisWritable({ status: "in_progress" }, historical), true);
  assert.equal(assertAnalysisWritable({ status: "in_progress" }, historical, {}), true);
});

test("complete reuses identical review facts without replaying delivery writes", () => {
  const facts = { "analysis.route": "bug-fix", "analysis.source": "fix-123" };
  assert.equal(assertAnalysisWritable({ status: "analysis_review" }, facts, facts), false);
  assert.throws(() => assertAnalysisWritable(
    { status: "analysis_review" }, facts, { ...facts, "analysis.source": "stale-123" },
  ));
  assert.throws(() => assertAnalysisWritable({ status: "analysis_review" }, facts));
});

test("TFS management type is classified independently of route", () => {
  assert.equal(classifyTfsType("Bug"), "bug");
  assert.equal(classifyTfsType("需求"), "requirement");
  assert.equal(classifyTfsType("Requirement"), "requirement");
  assert.equal(classifyTfsType("Feature"), null);
});

test("Registry Workspace identity must match the current Workspace", () => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-analysis-"));
  const path = join(dir, "registry.json");
  try {
    writeFileSync(path, JSON.stringify({ runtime: { multica_cli: "multica", workspace_id: "workspace-a" } }));
    assert.doesNotThrow(() => analysisRuntime(["--registry-config", path], "multica", "workspace-a"));
    assert.throws(() => analysisRuntime(["--registry-config", path], "multica", "workspace-b"), /Workspace|workspace-id/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
