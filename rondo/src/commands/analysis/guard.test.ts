import test from "node:test";
import assert from "node:assert/strict";
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

test("Analysis diagnostics reuse current Runtime and reject environment overrides", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { MULTICA_WORKSPACE_ID: "workspace-a", MULTICA_SERVER_URL: "https://multica.example", MULTICA_CLI_PATH: "native-cli" });
    assert.deepEqual(analysisRuntime([], "multica", null), { workspace_id: "workspace-a", multica_server_url: "https://multica.example", multica_cli: "native-cli" });
    assert.throws(() => analysisRuntime([], "multica", "workspace-b"), /Workspace/);
    assert.throws(() => analysisRuntime(["--profile", "other"], "multica", null), /覆盖/);
    assert.throws(() => analysisRuntime(["--registry-config", "old.json"], "multica", null), /退役/);
    delete process.env.MULTICA_WORKSPACE_ID;
    assert.equal(analysisRuntime(["--profile", "diagnostic"], "multica", "workspace-b").workspace_id, "workspace-b");
    assert.throws(() => analysisRuntime([], "multica", null), /workspace-id/);
  } finally { process.env = saved; }
});
