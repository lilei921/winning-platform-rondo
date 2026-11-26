import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", env: { ...process.env, ...env },
  });
  assert.equal(result.error, undefined, result.error?.message);
  let body;
  try { body = JSON.parse(result.stdout); }
  catch { assert.fail("CLI did not produce JSON: " + result.stdout + "\n" + result.stderr); }
  return { exit: result.status, body };
}
test("Dispatch matches Change and Engineer and rejects overlapping conflicting owners", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-check-dispatch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const mock = join(dir, "multica-mock");
  writeFileSync(mock, "#!/usr/bin/env node\nprocess.stdout.write(process.env.MOCK_ISSUE || '{}');\n");
  chmodSync(mock, 0o755);
  const config = join(dir, "registry.json");
  writeFileSync(config, JSON.stringify({ runtime: { multica_cli: mock, tfs_cli: [] } }));
  const dispatch = { task_refs: ["1.1"], change_ref: "sample", engineer_id: "agent-a", active: true };
  const issue = { project_id: "project1", metadata: {
    "tfs.type": "Bug", "tfs.id": "123", "dev.dispatch": JSON.stringify([dispatch]),
  } };
  const run = (change, agent, data = issue) => runCli(["dev", "check-dispatch", "--config", config,
    "--issue", "DEL-1", "--task-refs", "1.1", "--change-ref", change, "--engineer-id", agent],
    { MOCK_ISSUE: JSON.stringify(data) });
  assert.equal(run("sample", "agent-a").body.result, "PASS");
  assert.equal(run("other", "agent-a").body.result, "FAIL");
  assert.equal(run("sample", "agent-b").body.result, "FAIL");
  const collision = { ...issue, metadata: { ...issue.metadata,
    "dev.dispatch": JSON.stringify([dispatch, { ...dispatch, engineer_id: "agent-b" }]) } };
  assert.equal(run("sample", "agent-a", collision).body.result, "FAIL");
});
