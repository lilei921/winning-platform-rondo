/**
 * help exit 0 契约（rll5-replay-remediation-plan M5，F5）。
 *
 * 正常 help 求助返回 0（stdout 出用法），不再污染工具失败指标；
 * 缺必填参数仍是 64（stderr 出用法）——行为守卫，防止本修复把用法错误也放成 0。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

const CASES = [
  { name: "pr prepare", args: ["pr", "prepare"] },
];

for (const c of CASES) {
  test(`${c.name} --help → exit 0，stdout 出用法`, () => {
    const r = run([...c.args, "--help"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr.slice(0, 300)}`);
    assert.match(r.stdout, /用法|usage/);
  });

  test(`${c.name} 缺必填参数 → exit 64（行为守卫）`, () => {
    const r = run(c.args);
    assert.equal(r.status, 64, `stdout: ${r.stdout.slice(0, 300)}`);
    assert.match(r.stderr, /用法|usage/);
  });
}
