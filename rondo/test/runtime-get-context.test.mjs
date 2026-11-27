import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const MOCK = fileURLToPath(new URL("./mock-multica.cjs", import.meta.url));

function fixture(t, squads = [{ id: "squad-1", name: "Delivery Squad" }]) {
  const dir = mkdtempSync(join(tmpdir(), "rondo-runtime-context-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const multica = join(dir, process.platform === "win32" ? "multica.cmd" : "multica");
  if (process.platform === "win32") {
    writeFileSync(multica, `@echo off\r\nnode "${MOCK}" %*\r\n`);
  } else {
    copyFileSync(MOCK, multica);
    chmodSync(multica, 0o755);
  }

  const statePath = join(dir, "state.json");
  const callsPath = join(dir, "calls.jsonl");
  writeFileSync(statePath, JSON.stringify({ squads_list: squads }));
  writeFileSync(callsPath, "");
  const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === "path") ?? "PATH";

  return (overrides = {}) => {
    const cp = spawnSync(process.execPath, [CLI, "runtime", "get-context"], {
      encoding: "utf8",
      env: {
        ...process.env,
        [pathKey]: dir + delimiter + (process.env[pathKey] ?? ""),
        MOCK_STATE: statePath,
        MOCK_SYNC_CALLS_FILE: callsPath,
        MOCK_EXPECT_SERVER: "http://multica.test",
        MULTICA_WORKSPACE_ID: "workspace-1",
        MULTICA_SERVER_URL: "http://multica.test",
        ...overrides,
      },
    });
    assert.equal(cp.error, undefined, cp.error?.message);
    let body;
    try { body = JSON.parse(cp.stdout); }
    catch { assert.fail("invalid JSON: " + cp.stdout + "\n" + cp.stderr); }
    const calls = readFileSync(callsPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    return { code: cp.status, body, calls };
  };
}

test("get-context reads Runtime env and resolves the default Delivery Squad", t => {
  const run = fixture(t, [
    { id: "archived", name: "Delivery Squad", archived_at: "2026-01-01" },
    { id: "squad-1", name: "Delivery Squad" },
    { id: "other", name: "Other Squad" },
  ]);
  const result = run();
  assert.equal(result.code, 0);
  assert.deepEqual(result.body, {
    result: "PASS",
    runtime: {
      multica_cli: "multica",
      multica_server_url: "http://multica.test",
      workspace_id: "workspace-1",
      rondo: "rondo",
      delivery_squad_id: "squad-1",
    },
  });
  assert.deepEqual(result.calls, [
    ["squad", "list", "--workspace-id", "workspace-1", "--output", "json"],
  ]);
});

test("get-context does not fall back to default Workspace or Server", t => {
  const run = fixture(t);
  for (const missing of ["MULTICA_WORKSPACE_ID", "MULTICA_SERVER_URL"]) {
    const result = run({ [missing]: "" });
    assert.equal(result.code, 3);
    assert.equal(result.body.result, "UNKNOWN");
    assert.match(result.body.reason, /MULTICA_WORKSPACE_ID|MULTICA_SERVER_URL/);
  }
});

test("get-context rejects missing, duplicate or malformed Squad lookup", t => {
  for (const squads of [
    [],
    [{ id: "squad-1", name: "Other Squad" }],
    [{ id: "a", name: "Delivery Squad" }, { id: "b", name: "Delivery Squad" }],
    { invalid: true },
    [{ id: "squad-1", name: "Delivery Squad" }, null],
    [{ id: "squad-1", name: "Delivery Squad" }, { id: 1, name: "Other Squad" }],
  ]) {
    const run = fixture(t, squads);
    const result = run();
    assert.equal(result.code, 3);
    assert.equal(result.body.result, "UNKNOWN");
  }
});

test("get-context 不依赖当前 Task，缺失的 Task 环境文件不阻断命令", t => {
  const run = fixture(t);
  const dir = mkdtempSync(join(tmpdir(), "rondo-no-task-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = run({ MULTICA_TASK_ID: "", MULTICA_TASK_ENV_FILE: join(dir, "missing.json") });
  assert.equal(result.code, 0);
  assert.equal(result.body.result, "PASS");
});
