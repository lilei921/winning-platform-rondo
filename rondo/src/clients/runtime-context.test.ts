import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hydrateMulticaTaskEnvironment } from "./runtime-context.js";

test("Task environment supplements only missing task fields; no unrelated env injection", t => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-task-env-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "task.json");
  writeFileSync(file, "\uFEFF" + JSON.stringify({ active: true, env: {
    MULTICA_TASK_ID: "task", MULTICA_TASK_CONFIG_ROOT: "config", MULTICA_TASK_SLOT: "2",
    MULTICA_TOKEN: "file-token", PATH: "untrusted", MULTICA_AGENT_ID: "other",
  } }));
  const env: NodeJS.ProcessEnv = { MULTICA_TASK_ENV_FILE: file, MULTICA_TOKEN: "process-token", PATH: "original" };
  hydrateMulticaTaskEnvironment(env);
  assert.deepEqual(env, { MULTICA_TASK_ENV_FILE: file, MULTICA_TASK_ID: "task",
    MULTICA_TASK_CONFIG_ROOT: "config", MULTICA_TASK_SLOT: "2", MULTICA_TOKEN: "process-token", PATH: "original" });
  const ordinary: NodeJS.ProcessEnv = { MULTICA_TASK_ID: "task" };
  hydrateMulticaTaskEnvironment(ordinary);
  assert.deepEqual(ordinary, { MULTICA_TASK_ID: "task" });
});

test("Invalid, inactive or conflicting Task environment fails without exposing credentials or mutating env", t => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-task-env-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "task.json");
  const env: NodeJS.ProcessEnv = { MULTICA_TASK_ENV_FILE: file, MULTICA_TASK_ID: "current" };
  assert.throws(() => hydrateMulticaTaskEnvironment(env), /MULTICA_TASK_ENV_FILE/);
  for (const [record, reason] of [
    ["malformed", /MULTICA_TASK_ENV_FILE/],
    [JSON.stringify({ active: false, env: { MULTICA_TOKEN: "secret" } }), /未激活/],
    [JSON.stringify({ active: true, env: [] }), /格式无效/],
    [JSON.stringify({ active: true, env: { MULTICA_TASK_ID: "other", MULTICA_TOKEN: "secret" } }), /MULTICA_TASK_ID/],
    [JSON.stringify({ active: true, env: { MULTICA_TASK_ID: "current", MULTICA_TASK_SLOT: 2 } }), /MULTICA_TASK_SLOT/],
  ] as const) {
    writeFileSync(file, record);
    assert.throws(() => hydrateMulticaTaskEnvironment(env), reason);
    assert.deepEqual(env, { MULTICA_TASK_ENV_FILE: file, MULTICA_TASK_ID: "current" });
  }
});
