import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hydrateMulticaTaskEnvironment } from "./runtime-context.js";
import { resolveIssueRef } from "./native-checkout.js";

test("Task environment supplements only missing task fields; no unrelated env injection", t => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-task-env-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "task.json");
  writeFileSync(file, "\uFEFF" + JSON.stringify({ active: true, env: {
    MULTICA_TASK_ID: "task", MULTICA_TASK_CONFIG_ROOT: "config", MULTICA_TASK_SLOT: 2,
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

test("Unavailable, inactive or conflicting Task file does not block or replace process env", t => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-task-env-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "task.json");
  const env: NodeJS.ProcessEnv = { MULTICA_TASK_ENV_FILE: file, MULTICA_TASK_ID: "current" };
  const original = { ...env };
  hydrateMulticaTaskEnvironment(env);
  assert.deepEqual(env, original);
  for (const record of [
    "malformed",
    JSON.stringify({ active: false, env: { MULTICA_TASK_ID: "current", MULTICA_TOKEN: "secret" } }),
    JSON.stringify({ active: true, env: [] }),
    JSON.stringify({ active: true, env: { MULTICA_TASK_ID: "other", MULTICA_TOKEN: "secret" } }),
    JSON.stringify({ active: true, env: { MULTICA_TOKEN: "secret" } }),
  ]) {
    writeFileSync(file, record);
    hydrateMulticaTaskEnvironment(env);
    assert.deepEqual(env, original);
  }
});

test("Complete process env takes precedence; invalid optional field does not prevent Task recovery", t => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-task-env-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "task.json");
  const complete: NodeJS.ProcessEnv = { MULTICA_TASK_ENV_FILE: file, MULTICA_TASK_ID: "current",
    MULTICA_TASK_CONFIG_ROOT: "config", MULTICA_TASK_SLOT: "0", MULTICA_TOKEN: "process-token" };
  const original = { ...complete };
  hydrateMulticaTaskEnvironment(complete);
  assert.deepEqual(complete, original);
  writeFileSync(file, JSON.stringify({ active: true, env: {
    MULTICA_TASK_ID: "current", MULTICA_TASK_CONFIG_ROOT: {}, MULTICA_TASK_SLOT: false, MULTICA_TOKEN: "file-token",
  } }));
  const partial: NodeJS.ProcessEnv = { MULTICA_TASK_ENV_FILE: file, MULTICA_TASK_ID: "" };
  hydrateMulticaTaskEnvironment(partial);
  assert.deepEqual(partial, { MULTICA_TASK_ENV_FILE: file, MULTICA_TASK_ID: "current", MULTICA_TOKEN: "file-token" });
});


test("Issue reference uses explicit Key/ID or nearest native Task Context from nested checkout", t => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-issue-context-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const child = join(dir, "repo", "src");
  mkdirSync(child, { recursive: true });
  mkdirSync(join(dir, ".multica"));
  const file = join(dir, ".multica", "daemon_task_context.json");
  const id = "01a21b79-6198-74f3-ae35-b5cbd99a66c5";
  const env = { MULTICA_AGENT_ID: "agent" };
  writeFileSync(file, JSON.stringify({ managed_by: "multica-daemon-task", agent_id: "agent", issue_id: id }));
  assert.equal(resolveIssueRef(undefined, dir, env), id);
  assert.equal(resolveIssueRef(undefined, child, env), id);
  assert.equal(resolveIssueRef("LEI-69", child, {}), "LEI-69");
  assert.equal(resolveIssueRef(id, child, {}), id);
  assert.throws(() => resolveIssueRef("", child, env), /--issue/);
  assert.throws(() => resolveIssueRef(undefined, child, {}), /--issue/);
  assert.throws(() => resolveIssueRef(undefined, child, { MULTICA_AGENT_ID: "other" }), /--issue/);
  mkdirSync(join(child, ".multica"));
  writeFileSync(join(child, ".multica", "daemon_task_context.json"), "invalid");
  assert.throws(() => resolveIssueRef(undefined, child, env), /--issue/);
  rmSync(file);
  assert.throws(() => resolveIssueRef(undefined, dir, env), /--issue/);
  for (const context of [{ managed_by: "multica-daemon-task", agent_id: "agent" },
    { managed_by: "other", agent_id: "agent", issue_id: id },
    { managed_by: "multica-daemon-task", agent_id: "agent", issue_id: "" }]) {
    writeFileSync(file, JSON.stringify(context));
    assert.throws(() => resolveIssueRef(undefined, dir, env), /--issue/);
  }
});
