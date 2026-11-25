import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function runCli(args, cwd) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

function fixture(t) {
  const base = realpathSync.native(tmpdir());
  const dir = realpathSync.native(mkdtempSync(join(base, "rondo-resolve-identity-")));
  t.after(() => {
    // 只删除本测试创建的临时目录，禁止扩大清理范围。
    assert.equal(dirname(dir), base);
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/** openspec/ 已定位但尚无 changes/（全新根仓首跑）：只读身份解析器的确定性答案是 NOT_FOUND(exit 0)。 */
test("全新根仓（openspec/ 无 changes/）：resolve-identity 返回 NOT_FOUND exit 0，stdout 为纯 JSON", (t) => {
  const dir = fixture(t);
  const repo = join(dir, "root-repo");
  mkdirSync(join(repo, "openspec", "schemas"), { recursive: true });
  const r = runCli(["change", "resolve-identity", "--openspec-root", repo, "--tfs-id", "263181"]);
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr.slice(0, 300)}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.result, "NOT_FOUND");
  assert.equal(out.change_ref, null);
});

/** 直接传 openspec/ 目录（存量兼容调用形态）同样按 NOT_FOUND 裁决。 */
test("直接传 openspec/ 目录且无 changes/：同样 NOT_FOUND exit 0", (t) => {
  const dir = fixture(t);
  const openspec = join(dir, "openspec");
  mkdirSync(openspec, { recursive: true });
  const r = runCli(["change", "resolve-identity", "--openspec-root", openspec, "--tfs-id", "263181"]);
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr.slice(0, 300)}`);
  assert.equal(JSON.parse(r.stdout).result, "NOT_FOUND");
});

/** openspec/ 本身定位不到（根路径传错）：维持 UNKNOWN 语义，结构化 JSON + exit 3，不抛裸堆栈。 */
test("openspec/ 定位不到：结构化 INVALID exit 3，stdout 为纯 JSON，无未捕获堆栈", (t) => {
  const dir = fixture(t);
  const r = runCli(["change", "resolve-identity", "--openspec-root", dir, "--tfs-id", "263181"]);
  assert.equal(r.status, 3, `rc=${r.status} stderr=${r.stderr.slice(0, 300)}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.result, "INVALID");
  assert.ok(out.detail.startsWith("unexpected:"), out.detail);
  assert.ok(!r.stdout.includes("UnknownError"), "stdout 不得出现未捕获异常堆栈");
});

/** changes/ 已存在但无匹配候选：既有 NOT_FOUND 路径不回归。 */
test("changes/ 存在但无匹配：NOT_FOUND exit 0（既有行为回归锚点）", (t) => {
  const dir = fixture(t);
  const repo = join(dir, "root-repo");
  mkdirSync(join(repo, "openspec", "changes"), { recursive: true });
  const r = runCli(["change", "resolve-identity", "--openspec-root", repo, "--tfs-id", "263181"]);
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr.slice(0, 300)}`);
  assert.equal(JSON.parse(r.stdout).result, "NOT_FOUND");
});

/** changes/ 下存在匹配候选：ACTIVE_FOUND 主路径不回归。 */
test("changes/ 下 tfs-id 后缀命中：ACTIVE_FOUND exit 0（既有行为回归锚点）", (t) => {
  const dir = fixture(t);
  const repo = join(dir, "root-repo");
  const changeDir = join(repo, "openspec", "changes", "fix-metadata-collect-datasource-type-263181");
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, ".openspec.yaml"), "schema: corrective-change\ncreated: 2026-11-07\n");
  const r = runCli(["change", "resolve-identity", "--openspec-root", repo, "--tfs-id", "263181", "--expect-schema", "corrective-change"]);
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr.slice(0, 300)}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.result, "ACTIVE_FOUND");
  assert.equal(out.change_ref, "fix-metadata-collect-datasource-type-263181");
  assert.equal(out.schema, "corrective-change");
});

test("相对 OpenSpec 根路径和显式 JSON 输出与默认输出等价，拒绝其他格式", (t) => {
  const repo = fixture(t);
  mkdirSync(join(repo, "openspec", "changes"), { recursive: true });
  const args = ["change", "resolve-identity", "--openspec-root", ".", "--tfs-id", "263181"];
  const implicit = runCli(args, repo);
  const explicit = runCli([...args, "--output", "json"], repo);
  assert.equal(implicit.status, 0);
  assert.equal(explicit.status, 0);
  assert.equal(explicit.stdout, implicit.stdout);
  for (const flags of [["--output", "table"], ["--output"]]) {
    const invalid = runCli([...args, ...flags], repo);
    assert.equal(invalid.status, 64);
    assert.equal(invalid.stdout, "");
    assert.match(invalid.stderr, /--output/);
  }
});
