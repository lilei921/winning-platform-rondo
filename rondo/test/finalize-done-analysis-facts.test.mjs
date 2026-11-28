import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { assertCompletedAnalysisFacts } from "../dist/commands/delivery/finalize.js";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const MOCK = fileURLToPath(new URL("./mock-multica.cjs", import.meta.url));

const good = {
  "analysis.change_kind": "corrective",
  "analysis.source": JSON.stringify({repo_url:"https://tfs.example/tfs/C/P/_git/root",branch:"dev",commit:"a".repeat(40),change_ref:"issue-change-123"}),
  "analysis.gate.result": "PASS",
  "delivery.tfs_written": "true",
  "analysis.human_approval": JSON.stringify({
    decision: "approved", by: "human", at: "2026-11-08T00:00:00Z",
    comment_ref: "approval-1", verify_agent_required: false,
  }),
};

function runDone(t, metadata) {
  const root = mkdtempSync(join(tmpdir(), "rondo-finalize-done-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateFile = join(root, "state.json");
  chmodSync(MOCK, 0o755);
  writeFileSync(stateFile, JSON.stringify({ status: "done", metadata }));
  const out = spawnSync(process.execPath, [CLI, "workitem", "finalize", "--phase", "complete",
    "--issue", "issue-1"], {
    encoding: "utf8",
    env: { ...process.env, MOCK_STATE: stateFile, MULTICA_CLI_PATH: MOCK, MULTICA_WORKSPACE_ID: "ws-test", MULTICA_SERVER_URL: "http://multica.test" },
    timeout: 20_000,
  });
  assert.equal(out.error, undefined, out.error?.message);
  let body;
  try { body = JSON.parse(out.stdout); }
  catch { assert.fail(`Non-JSON finalize response: ${out.stdout} ${out.stderr}`); }
  return { code: out.status, body, state: JSON.parse(readFileSync(stateFile, "utf8")) };
}

test("done replay checks only stable Change identity and completed Writeback", (t) => {
  for (const bad of [
    { "analysis.source": JSON.stringify({...JSON.parse(good["analysis.source"]),change_ref:"../bad"}) },
    { "delivery.tfs_written": "false" },
  ]) {
    const metadata = { ...good, ...bad, "finalize.pending": "pending" };
    const r = runDone(t, metadata);
    assert.equal(r.code, 2, JSON.stringify(r.body));
    assert.equal(r.body.result, "FAIL");
    assert.equal(r.state.metadata["finalize.pending"], "pending");
  }
});

test("done replay with valid classification clears only pending without requiring root repo", (t) => {
  const r = runDone(t, { ...good, "finalize.pending": "pending" });
  assert.equal(r.code, 0, JSON.stringify(r.body));
  assert.equal(r.body.result, "PASS");
  assert.equal(r.state.status, "done");
  assert.equal(r.state.metadata["finalize.pending"], undefined);
  assert.equal(r.state.metadata["analysis.change_kind"], "corrective");
});

test("done replay with valid facts and no pending remains a no-op", (t) => {
  const r = runDone(t, good);
  assert.equal(r.code, 0, JSON.stringify(r.body));
  assert.deepEqual(r.body.steps, {});
});

test("completed facts checker keeps identity and TFS hard gates, not upstream classification", () => {
  assert.doesNotThrow(() => assertCompletedAnalysisFacts(good));
  assert.doesNotThrow(() => assertCompletedAnalysisFacts({ ...good, "analysis.change_kind": "production-fix" }));
  assert.throws(() => assertCompletedAnalysisFacts({ ...good, "analysis.source": JSON.stringify({...JSON.parse(good["analysis.source"]),change_ref:"/etc/passwd"}) }), /change_ref/);
  assert.throws(() => assertCompletedAnalysisFacts({ ...good, "delivery.tfs_written": "false" }), /TFS Writeback/);
});

test("done replay does not re-run upstream Approval or Verify Decision", (t) => {
  for (const metadata of [
    { ...good, "verify_agent.required": undefined, "finalize.pending": "pending" },
    { ...good, "verify_agent.required": "true", "finalize.pending": "pending" },
    { ...good, "analysis.human_approval": undefined, "finalize.pending": "pending" },
    { ...good, "analysis.human_approval": JSON.stringify({
      decision: "approved", comment_ref: "approval-1", verify_agent_required: true,
    }), "verify_agent.required": "true", "finalize.pending": "pending" },
  ]) {
    const r = runDone(t, metadata);
    assert.equal(r.code, 0, JSON.stringify(r.body));
    assert.equal(r.body.result, "PASS");
    assert.equal(r.state.metadata["finalize.pending"], undefined);
  }
});
