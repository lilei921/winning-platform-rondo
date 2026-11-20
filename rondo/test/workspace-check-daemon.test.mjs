import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

/** 隔离平台替身只支持 Runtime 查询；其他调用立即失败，禁止访问真实服务。 */
function fixture(t, runtimes = [{ id: "runtime-1", daemon_id: "daemon-1" }]) {
  const base = realpathSync.native(tmpdir());
  const dir = realpathSync.native(mkdtempSync(join(base, "rondo-daemon-check-")));
  t.after(() => {
    assert.equal(dirname(dir), base);
    rmSync(dir, { recursive: true, force: true });
  });
  const trace = join(dir, "calls.jsonl");
  const script = join(dir, "mock.cjs");
  writeFileSync(script, `const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MC_TRACE, JSON.stringify(args) + '\\n');
if (args[0] !== 'runtime' || args[1] !== 'list') {
  console.error('unexpected platform call: ' + args.join(' ')); process.exit(1);
}
console.log(process.env.MC_RUNTIMES);
`);
  if (process.platform === "win32") {
    writeFileSync(join(dir, "multica.cmd"), `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  } else {
    const shim = join(dir, "multica");
    writeFileSync(shim, `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`);
    chmodSync(shim, 0o755);
  }
  const run = (args = [], daemonId = "daemon-1") => {
    const env = { ...process.env, MC_TRACE: trace, MC_RUNTIMES: JSON.stringify(runtimes), MULTICA_DAEMON_ID: daemonId };
    for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
    env.PATH = dir + delimiter + process.env.PATH;
    const result = spawnSync(process.execPath, [CLI, "workspace", "check-daemon", "--workspace-id", "workspace-1", ...args], { encoding: "utf8", env });
    assert.equal(result.error, undefined, result.error?.message);
    return { ...result, body: result.stdout.trim() ? JSON.parse(result.stdout) : null };
  };
  const calls = () => existsSync(trace) ? readFileSync(trace, "utf8").trim().split(/\r?\n/).map(JSON.parse) : [];
  return { run, calls };
}

test("已注册 daemon 通过，只查询 Runtime，不依赖项目挂载、Squad 或交付亲和", t => {
  const f = fixture(t);
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.body.result, "PASS");
  assert.deepEqual(r.body.checks.map(c => c.name), ["daemon_env", "daemon_registered", "skill_flow"]);
  assert.deepEqual(f.calls(), [["runtime", "list", "--workspace-id", "workspace-1", "--output", "json"]]);
});

test("兼容 project-id 入参不触发 Project、Resource、Agent 或 Issue 查询", t => {
  const f = fixture(t);
  const r = f.run(["--project-id", "github-only-squad-project"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.calls().length, 1);
  assert.deepEqual(f.calls()[0].slice(0, 2), ["runtime", "list"]);
});

for (const daemonId of ["", "unregistered-daemon"]) {
  test(`daemon ${daemonId || "未配置"} 仍返回明确 FAIL`, t => {
    const f = fixture(t);
    const r = f.run([], daemonId);
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.body.result, "FAIL");
    assert.equal(r.body.checks.find(c => c.name === "daemon_registered").result, "FAIL");
    assert.equal(f.calls().length, 1);
  });
}

test("平台返回非列表时报告 UNKNOWN，不误报为未注册", t => {
  const f = fixture(t, { error: "unavailable" });
  const r = f.run();
  assert.equal(r.status, 3, r.stderr);
  assert.equal(r.body.result, "UNKNOWN");
  assert.match(r.body.reason, /Runtime 列表不可核实/);
  assert.equal(f.calls().length, 1);
});

test("兼容参数缺值属于用法错误，平台零调用", t => {
  const f = fixture(t);
  const r = f.run(["--project-id"]);
  assert.equal(r.status, 64, r.stderr);
  assert.deepEqual(f.calls(), []);
});
