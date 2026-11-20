/**
 * spawn.ts runJson transient 重试桩测试（analyst-run-efficiency-optimization-plan P0；
 * rll5-replay-remediation-plan M3.1 扩展：签名识别 + 指数退避 + rc=3 重试 + [network] 分类）。
 *
 * 桩 CLI：node 执行临时脚本，通过计数文件控制第 N 次调用的输出形态。
 * 验收点：
 *  1. 首次空 stdout、二次正常 → 返回正常结果，无 UnknownError；
 *  2. 持续空 stdout → UnknownError，reason 含重试记录与 [network] 标记（M3.1：默认重试 3 次）；
 *  3. 合法空 JSON（[]）→ 不触发重试（仅一次调用）；
 *  4. 未标 transient → 空 stdout 直接报错，不重试；
 *  5. rc=1 + ECONNRESET 签名 → 重试后成功（M3.1）；
 *  6. rc=3 + 签名 → 重试后成功；耗尽 → 原样 UNKNOWN 消息 + [network]；
 *  7. rc=1 无签名 → 立即抛，不重试；
 *  8. 未标 transient 即使命中签名也永不重试（守卫）；
 *  9. 截断 JSON（"Unexpected end of JSON input"）→ 签名重试后成功；
 * 10. transientBackoffMs 退避序列：rand=0 → 1×/3×/9×；rand→1 上限 20% jitter。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isTransientNetworkText, runJson, transientBackoffMs } from "./spawn.js";
import { UnknownError } from "../cli/errors.js";

const STUB = `
const fs = require("fs");
const counter = process.argv[2];
const mode = process.argv[3];
const n = (parseInt(fs.readFileSync(counter, "utf8"), 10) || 0) + 1;
fs.writeFileSync(counter, String(n));
if (mode === "flaky" && n === 1) process.exit(0);           // 首次空 stdout + exit 0（模拟 multica 超时混出）
if (mode === "always-empty") process.exit(0);               // 持续空 stdout
if (mode === "network-error") {
  fs.writeSync(2, "Could not reach the Multica server. Check your network connection.\\n");
  process.exit(2);
}
if (mode === "json-fail") {
  fs.writeSync(1, JSON.stringify({ passed: false }) + "\\n");
  fs.writeSync(2, "validation failed\\n");
  process.exit(2);
}
if (mode === "empty-array") { process.stdout.write("[]\\n"); process.exit(0); } // 合法空 JSON
if (mode === "tls-flaky" && n <= 2) { process.stderr.write("TLS handshake timeout\\n"); process.exit(1); }  // 前 2 次签名失败
if (mode === "rc3-flaky" && n === 1) { process.stderr.write("read ECONNRESET\\n"); process.exit(3); }       // 首次 rc=3 签名
if (mode === "tls-always") { process.stderr.write("read ECONNRESET\\n"); process.exit(1); }                 // 持续签名失败
if (mode === "fatal") { process.stderr.write("permission denied\\n"); process.exit(1); }                    // 非签名失败
if (mode === "network-then-business") {
  process.stderr.write(n === 1 ? "ECONNRESET\\n" : "permission denied\\n");
  process.exit(3);
}
if (mode === "always-truncated") { process.stdout.write('{"ok":'); process.exit(0); }
if (mode === "truncated" && n === 1) { process.stdout.write("{\\"ok\\": tru"); process.exit(0); }             // 截断 JSON → Unexpected end of JSON input
process.stdout.write(JSON.stringify({ ok: true, attempt: n }) + "\\n");
`;

function setup(mode: string): { cmd: string[]; counter: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "rondo-spawn-"));
  const script = join(dir, "stub.cjs");
  const counter = join(dir, "counter.txt");
  writeFileSync(script, STUB);
  writeFileSync(counter, "0");
  return { cmd: [process.execPath, script, counter, mode], counter, dir };
}

const attempts = (counter: string): number => parseInt(readFileSync(counter, "utf8"), 10);

test("flaky read: first empty stdout retried once, second attempt succeeds", () => {
  const { cmd, counter, dir } = setup("flaky");
  try {
    const out = runJson(cmd, "读取测试", undefined, { transient: true, retryDelayMs: 1 }) as { ok: boolean; attempt: number };
    assert.equal(out.ok, true);
    assert.equal(out.attempt, 2);
    assert.equal(attempts(counter), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("always empty stdout: UnknownError after retries, reason records retries and [network]", () => {
  const { cmd, counter, dir } = setup("always-empty");
  try {
    assert.throws(
      () => runJson(cmd, "读取测试", undefined, { transient: true, retryDelayMs: 1 }),
      (exc: unknown) => {
        assert.ok(exc instanceof UnknownError);
        assert.match((exc as Error).message, /输出不是合法 JSON/);
        assert.match((exc as Error).message, /已重试 3 次/);   // M3.1：默认 retries 1→3
        assert.match((exc as Error).message, /\[network\]$/);
        return true;
      },
    );
    assert.equal(attempts(counter), 4);                        // 首次 + 3 次重试
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legitimate empty JSON array is not treated as transient", () => {
  const { cmd, counter, dir } = setup("empty-array");
  try {
    const out = runJson(cmd, "读取测试", undefined, { transient: true, retryDelayMs: 1 });
    assert.deepEqual(out, []);
    assert.equal(attempts(counter), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("without transient flag, empty stdout fails immediately without retry", () => {
  const { cmd, counter, dir } = setup("always-empty");
  try {
    assert.throws(() => runJson(cmd, "读取测试", undefined, { retryDelayMs: 1 }), UnknownError);
    assert.equal(attempts(counter), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rc=1 with ECONNRESET signature retried then succeeds (M3.1)", () => {
  const { cmd, counter, dir } = setup("tls-flaky");
  try {
    const out = runJson(cmd, "读取测试", undefined, { transient: true, retryDelayMs: 1 }) as { ok: boolean; attempt: number };
    assert.equal(out.ok, true);
    assert.equal(out.attempt, 3);
    assert.equal(attempts(counter), 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rc=3 with network signature retried then succeeds (M3.1)", () => {
  const { cmd, counter, dir } = setup("rc3-flaky");
  try {
    const out = runJson(cmd, "读取测试", undefined, { transient: true, retryDelayMs: 1 }) as { ok: boolean; attempt: number };
    assert.equal(out.ok, true);
    assert.equal(attempts(counter), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exhausted signature retries: original failure message + [network] suffix", () => {
  const { cmd, counter, dir } = setup("tls-always");
  try {
    assert.throws(
      () => runJson(cmd, "读取测试", undefined, { transient: true, retryDelayMs: 1 }),
      (exc: unknown) => {
        assert.ok(exc instanceof UnknownError);
        assert.match((exc as Error).message, /命令失败 rc=1: read ECONNRESET \[network\]$/);
        return true;
      },
    );
    assert.equal(attempts(counter), 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rc=1 without signature throws immediately, no retry", () => {
  const { cmd, counter, dir } = setup("fatal");
  try {
    assert.throws(
      () => runJson(cmd, "读取测试", undefined, { transient: true, retryDelayMs: 1 }),
      (exc: unknown) => {
        assert.ok(exc instanceof UnknownError);
        assert.match((exc as Error).message, /命令失败 rc=1: permission denied$/);
        return true;
      },
    );
    assert.equal(attempts(counter), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guard: non-transient caller never retries even when signature matches", () => {
  const { cmd, counter, dir } = setup("tls-always");
  try {
    assert.throws(
      () => runJson(cmd, "读取测试", undefined, { retryDelayMs: 1 }),
      (exc: unknown) => {
        assert.ok(exc instanceof UnknownError);
        assert.match((exc as Error).message, /命令失败 rc=1: read ECONNRESET$/);
        return true;
      },
    );
    assert.equal(attempts(counter), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("truncated JSON hits signature and is retried (M3.1)", () => {
  const { cmd, counter, dir } = setup("truncated");
  try {
    const out = runJson(cmd, "读取测试", undefined, { transient: true, retryDelayMs: 1 }) as { ok: boolean; attempt: number };
    assert.equal(out.ok, true);
    assert.equal(attempts(counter), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("transientBackoffMs: base*3^attempt with 0–20% jitter", () => {
  assert.equal(transientBackoffMs(3000, 0, () => 0), 3000);
  assert.equal(transientBackoffMs(3000, 1, () => 0), 9000);
  assert.equal(transientBackoffMs(3000, 2, () => 0), 27000);
  assert.equal(transientBackoffMs(3000, 1, () => 1), 10800);   // jitter 上限 +20%
});

test("网络恢复后业务 UNKNOWN 立即停止，不沿用前次网络分类", () => {
  const { cmd, counter, dir } = setup("network-then-business");
  try {
    assert.throws(() => runJson(cmd, "读取测试", undefined, { transient: true, retryDelayMs: 1 }),
      /UNKNOWN: permission denied$/);
    assert.equal(attempts(counter), 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("持续截断 JSON 耗尽重试后保留 network 分类", () => {
  const { cmd, counter, dir } = setup("always-truncated");
  try {
    assert.throws(() => runJson(cmd, "读取测试", undefined, { transient: true, retries: 1, retryDelayMs: 1 }),
      /\[network\]$/);
    assert.equal(attempts(counter), 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("isTransientNetworkText: 大小写不敏感签名表", () => {
  assert.ok(isTransientNetworkText("read ECONNRESET"));
  assert.ok(isTransientNetworkText("tls handshake timeout"));
  assert.ok(isTransientNetworkText("Error: Unexpected end of JSON input"));
  assert.ok(!isTransientNetworkText("permission denied"));
  assert.ok(!isTransientNetworkText("analysis.gate.result != PASS"));
});

test("exit 2 with empty stdout preserves the transport error and remains UNKNOWN", () => {
  const { cmd, counter, dir } = setup("network-error");
  try {
    assert.throws(() => runJson(cmd, "读取 Issue"), (exc: unknown) => {
      assert.ok(exc instanceof UnknownError);
      assert.match(exc.message, /rc=2, stdout_bytes=0/);
      assert.match(exc.message, /stderr: Could not reach the Multica server/);
      return true;
    });
    assert.equal(attempts(counter), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exit 2 with valid JSON still returns the failure contract without mixing stderr", () => {
  const { cmd, counter, dir } = setup("json-fail");
  try {
    assert.deepEqual(runJson(cmd, "验证"), { passed: false });
    assert.equal(attempts(counter), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
