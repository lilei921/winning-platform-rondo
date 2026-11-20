import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function runCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  let body;
  try { body = JSON.parse(result.stdout); }
  catch { assert.fail("CLI did not produce JSON: " + result.stdout + "\n" + result.stderr); }
  return { exit: result.status, body, stderr: result.stderr };
}

/**
 * fixture：临时根仓 openspec/changes/<ref>/tasks.md，行尾形态可控（LF / CRLF）。
 * realpathSync.native：Windows tmpdir 返回 8.3 短名，与 CLI 侧归一保持一致。
 */
function fixture(t, { eol = "\n" } = {}) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "skill-flow-update-progress-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const changeDir = join(dir, "openspec", "changes", "crlf-case");
  mkdirSync(changeDir, { recursive: true });
  const tasksPath = join(changeDir, "tasks.md");
  const body = ["# Tasks", "", "- [ ] 1.1 实现 A", "- [ ] 1.2 实现 B", ""].join(eol);
  writeFileSync(tasksPath, body, "utf8");
  const run = (check) => runCli([
    "change", "update-progress",
    "--openspec-root", dir, "--change-ref", "crlf-case", "--check", check,
  ]);
  return { tasksPath, run };
}

test("LF tasks.md：UPDATED 且勾选行重写", (t) => {
  const f = fixture(t, { eol: "\n" });
  const r = f.run("1.1");
  assert.equal(r.exit, 0, r.stderr);
  assert.equal(r.body.result, "UPDATED");
  assert.deepEqual(r.body.checked, ["1.1"]);
  assert.match(readFileSync(f.tasksPath, "utf8"), /^- \[x\] 1\.1 实现 A$/m);
});

test("CRLF tasks.md：UPDATED（D1 回归：CHECKBOX_LINE 须容忍 \\r）", (t) => {
  const f = fixture(t, { eol: "\r\n" });
  const r = f.run("1.1");
  assert.equal(r.exit, 0, r.stderr);
  assert.equal(r.body.result, "UPDATED");
  assert.deepEqual(r.body.checked, ["1.1"]);
  const content = readFileSync(f.tasksPath, "utf8");
  // 勾选行重写后仍保留 CRLF（不得把该行静默转成 LF）
  assert.ok(content.includes("- [x] 1.1 实现 A\r\n"), "勾选行应保留 CRLF：" + JSON.stringify(content));
  assert.ok(content.includes("- [ ] 1.2 实现 B\r\n"), "未触及行原样保留");
  assert.ok(!content.includes("实现 A\n"), "不得产生 LF 勾选行");
});

test("CRLF tasks.md：重跑幂等 ALREADY_COMPLETE", (t) => {
  const f = fixture(t, { eol: "\r\n" });
  assert.equal(f.run("1.1").body.result, "UPDATED");
  const r = f.run("1.1");
  assert.equal(r.exit, 0, r.stderr);
  assert.equal(r.body.result, "ALREADY_COMPLETE");
  assert.deepEqual(r.body.skipped_already, ["1.1"]);
});
