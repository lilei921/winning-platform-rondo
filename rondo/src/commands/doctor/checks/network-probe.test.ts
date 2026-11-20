/**
 * network-probe.ts 单元测试（rll5-replay-remediation-plan M3.0）。
 *
 * 验收点：
 *  1. aggregateLeg 聚合数学（min/avg/max、fail 计数、last_error 取末次）；
 *  2. parseCurlWriteOut 解析 "200 0.123" / 拒绝畸形输出；
 *  3. detectProxyEnv 的 set/unset 判定与优先级（HTTPS_PROXY > HTTP_PROXY，含小写）；
 *  4. checkNetworkBaseline 绝不抛异常（配置全缺/目标全失败时也返回 CheckOutcome）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { aggregateLeg, parseCurlWriteOut, detectProxyEnv, checkNetworkBaseline } from "./network-probe.js";

test("aggregateLeg: 聚合成败与 RTT，last_error 取最后一个错误", () => {
  const leg = aggregateLeg([
    { ok: true, rttMs: 10 },
    { ok: false, rttMs: 0, error: "超时" },
    { ok: true, rttMs: 30 },
    { ok: false, rttMs: 0, error: "HTTP 503" },
  ]);
  assert.equal(leg.attempts, 4);
  assert.equal(leg.ok, 2);
  assert.equal(leg.fail, 2);
  assert.deepEqual(leg.rtt_ms, { min: 10, avg: 20, max: 30 });
  assert.equal(leg.last_error, "HTTP 503");
});

test("aggregateLeg: 全成功无 last_error；全失败 rtt 归零", () => {
  const ok = aggregateLeg([{ ok: true, rttMs: 5 }]);
  assert.equal(ok.last_error, undefined);
  const bad = aggregateLeg([{ ok: false, rttMs: 0, error: "x" }]);
  assert.deepEqual(bad.rtt_ms, { min: 0, avg: 0, max: 0 });
});

test("parseCurlWriteOut: 标准输出与畸形输出", () => {
  assert.deepEqual(parseCurlWriteOut("200 0.123"), { httpCode: "200", totalMs: 123 });
  assert.deepEqual(parseCurlWriteOut("  000 2.000\n"), { httpCode: "000", totalMs: 2000 });
  assert.equal(parseCurlWriteOut("curl: (7) failed"), null);
  assert.equal(parseCurlWriteOut(""), null);
});

test("detectProxyEnv: set/unset 与 HTTPS 优先", () => {
  const saved = { HTTP_PROXY: process.env.HTTP_PROXY, HTTPS_PROXY: process.env.HTTPS_PROXY, NO_PROXY: process.env.NO_PROXY, http_proxy: process.env.http_proxy, https_proxy: process.env.https_proxy };
  try {
    delete process.env.HTTP_PROXY; delete process.env.HTTPS_PROXY; delete process.env.NO_PROXY;
    delete process.env.http_proxy; delete process.env.https_proxy;
    let d = detectProxyEnv();
    assert.equal(d.proxyUrl, null);
    assert.deepEqual(d.env, { HTTP_PROXY: "unset", HTTPS_PROXY: "unset", NO_PROXY: "unset" });
    process.env.HTTP_PROXY = "http://p1:8080";
    d = detectProxyEnv();
    assert.equal(d.proxyUrl, "http://p1:8080");
    process.env.https_proxy = "http://p2:8080";
    d = detectProxyEnv();
    assert.equal(d.proxyUrl, "http://p2:8080");
    assert.equal(d.env.HTTPS_PROXY, "set");
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("checkNetworkBaseline: 配置全缺、目标不可达时也不抛，返回 WARN 级 CheckOutcome", async () => {
  const saved = { TFS_PAT: process.env.TFS_PAT, TFS_CLI_CONFIG: process.env.TFS_CLI_CONFIG, MULTICA_API_URL: process.env.MULTICA_API_URL };
  try {
    delete process.env.TFS_PAT;
    process.env.TFS_CLI_CONFIG = "";            // 显式空，防拾取本机 config
    delete process.env.MULTICA_API_URL;
    const ctx = { expectOpenspecVersion: "0", facts: {}, prior: new Map(), networkSample: { count: 1, intervalMs: 0 } };
    const out = await checkNetworkBaseline(ctx as never);
    assert.equal(out.name, "network_baseline");
    assert.equal(out.level, "WARN");
    assert.ok(["PASS", "WARN"].includes(out.result));
    assert.ok(out.detail.includes("internal_npm") || out.detail.includes("跳过"));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
