/**
 * validate.ts emitResult（--out 落盘，P1-4）桩测试。
 *
 * 验收点：
 *  1. --out 产物与 stdout JSON 逐字节一致（含末尾换行）；
 *  2. 目标目录不存在时自动创建；
 *  3. 原子写：完成后不残留临时文件；
 *  4. outPath=null 时不落盘、仅 stdout（由返回值与无文件断言）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitResult } from "./validate.js";

/** 捕获一次 stdout 写入。 */
function withCapturedStdout<T>(fn: () => T): { result: T; stdout: string } {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as { write: typeof orig }).write = ((chunk: unknown, ...rest: unknown[]) => {
    buf += String(chunk);
    return true;
  }) as typeof orig;
  try {
    return { result: fn(), stdout: buf };
  } finally {
    (process.stdout as { write: typeof orig }).write = orig;
  }
}

test("--out writes atomically and matches stdout byte-for-byte; dirs auto-created", () => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-validate-"));
  try {
    const outPath = join(dir, "nested", "logs", "analysis-gate-result.json");
    const payload = { result: "PASS", tool_version: "test", checks: [{ name: "identity", result: "PASS", reasons: [] }], reasons: [] };
    const { result: code, stdout } = withCapturedStdout(() => emitResult(payload, 0, outPath));
    assert.equal(code, 0);
    const fileText = readFileSync(outPath, "utf8");
    assert.equal(fileText, stdout);
    assert.equal(fileText, JSON.stringify(payload, null, 2) + "\n");
    // 原子写：目录中只剩目标文件，无临时文件残留
    assert.deepEqual(readdirSync(join(dir, "nested", "logs")), ["analysis-gate-result.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("null outPath emits stdout only", () => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-validate-"));
  try {
    const payload = { result: "UNKNOWN", checks: [], reasons: ["x"] };
    const { result: code, stdout } = withCapturedStdout(() => emitResult(payload, 3, null));
    assert.equal(code, 3);
    assert.equal(stdout, JSON.stringify(payload, null, 2) + "\n");
    assert.equal(readdirSync(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("second emit overwrites previous result (overwrite via rename)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-validate-"));
  try {
    const outPath = join(dir, "gate.json");
    writeFileSync(outPath, '{"stale":true}');
    const payload = { result: "FAIL", checks: [], reasons: ["[tasks] 缺少 tasks.md"] };
    withCapturedStdout(() => emitResult(payload, 2, outPath));
    assert.equal(readFileSync(outPath, "utf8"), JSON.stringify(payload, null, 2) + "\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
