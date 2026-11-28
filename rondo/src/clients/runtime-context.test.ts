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


test("Issue reference uses explicit Key/ID or current Task Context from Multica config root", t => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-issue-context-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const taskRoot = join(dir, "task");
  const configRoot = join(taskRoot, "multica-config");
  const workdir = join(taskRoot, "workdir");
  mkdirSync(configRoot, { recursive: true });
  mkdirSync(join(workdir, ".multica"), { recursive: true });
  const contextFile = join(workdir, ".multica", "daemon_task_context.json");
  const envFile = join(dir, "task-env.json");
  const id = "01a21b79-6198-74f3-ae35-b5cbd99a66c5";
  writeFileSync(envFile, JSON.stringify({ active: true, env: {
    MULTICA_TASK_ID: "task-1", MULTICA_TASK_CONFIG_ROOT: configRoot, MULTICA_TASK_SLOT: 0, MULTICA_TOKEN: "fixture",
  } }));
  const env: NodeJS.ProcessEnv = { MULTICA_TASK_ENV_FILE: envFile, MULTICA_AGENT_ID: "agent" };
  hydrateMulticaTaskEnvironment(env);
  assert.equal(env.MULTICA_TASK_CONFIG_ROOT, configRoot);
  writeFileSync(contextFile, JSON.stringify({ managed_by: "multica-daemon-task", agent_id: "agent", issue_id: id }));
  assert.equal(resolveIssueRef(undefined, env), id);
  assert.equal(resolveIssueRef("LEI-69", {}), "LEI-69");
  assert.equal(resolveIssueRef(id, {}), id);
  assert.throws(() => resolveIssueRef("", env), /--issue/);
  assert.throws(() => resolveIssueRef(undefined, { MULTICA_AGENT_ID: "agent" }), /MULTICA_TASK_CONFIG_ROOT/);
  assert.throws(() => resolveIssueRef(undefined, { ...env, MULTICA_TASK_CONFIG_ROOT: "relative/config" }), /MULTICA_TASK_CONFIG_ROOT/);
  assert.throws(() => resolveIssueRef(undefined, { ...env, MULTICA_AGENT_ID: "other" }), /--issue/);
  writeFileSync(contextFile, "invalid");
  assert.throws(() => resolveIssueRef(undefined, env), /--issue/);
  for (const context of [
    { managed_by: "other", agent_id: "agent", issue_id: id },
    { managed_by: "multica-daemon-task", agent_id: "agent", issue_id: "" },
    { managed_by: "multica-daemon-task", agent_id: "", issue_id: id },
  ]) {
    writeFileSync(contextFile, JSON.stringify(context));
    assert.throws(() => resolveIssueRef(undefined, env), /--issue/);
  }
  rmSync(contextFile);
  assert.throws(() => resolveIssueRef(undefined, env), /--issue/);
});
