/**
 * tfs/retry.ts 单测（rll5-replay-remediation-plan M3.3）：
 * 签名分类真值表、退避序列、onBeforeRetry 次数、非瞬态直通、耗尽 [network] 标记。
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  isTransientTfsError,
  withTransientRetry,
  transientTfsBackoffMs,
  markNetworkError,
} from "./retry.js";

test("签名分类：传输层短语命中（大小写不敏感）", () => {
  for (const msg of [
    "read ECONNRESET",
    "connect ETIMEDOUT 10.0.0.1:8080",
    "socket hang up",
    "getaddrinfo EAI_AGAIN proxy",
    "write EPROTO ... wrong version number",
    "TFS 请求超时（45s）：tfs.example.com",
    "TFS 连接失败：socket hang up",
    "request to https://tfs/x failed, reason: Socket Hang Up",
  ]) {
    assert.equal(isTransientTfsError(new Error(msg)), true, msg);
  }
});

test("签名分类：ECONNREFUSED 与业务错误不算瞬态", () => {
  for (const msg of [
    "connect ECONNREFUSED 127.0.0.1:8080",
    "更新工作项 123 失败: HTTP 400: ...",
    "创建工作项失败（结果未知，勿盲目重建）: HTTP 500",
    "无法识别评论 ID",
    "",
  ]) {
    assert.equal(isTransientTfsError(new Error(msg)), false, msg);
  }
});

test("退避序列：base*3^attempt + 0–20% jitter", () => {
  assert.equal(transientTfsBackoffMs(3000, 0, () => 0), 3000);
  assert.equal(transientTfsBackoffMs(3000, 1, () => 0), 9000);
  assert.equal(transientTfsBackoffMs(3000, 2, () => 0), 27000);
  assert.equal(transientTfsBackoffMs(3000, 0, () => 1), 3600); // +20% 上限
});

test("withTransientRetry：首次成功零开销（无 sleep、无 onBeforeRetry）", async () => {
  let retries = 0;
  const sleeps: number[] = [];
  const v = await withTransientRetry(async () => "ok", {
    onBeforeRetry: () => { retries++; },
    sleep: async (ms) => { sleeps.push(ms); },
  });
  assert.equal(v, "ok");
  assert.equal(retries, 0);
  assert.deepEqual(sleeps, []);
});

test("withTransientRetry：瞬态失败后成功——onBeforeRetry 每次重试前恰好调一次", async () => {
  let calls = 0;
  let rebuilds = 0;
  const sleeps: number[] = [];
  const v = await withTransientRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("read ECONNRESET");
      return "recovered";
    },
    {
      retries: 3,
      baseDelayMs: 1000,
      onBeforeRetry: () => { rebuilds++; },
      sleep: async (ms) => { sleeps.push(ms); },
    },
  );
  assert.equal(v, "recovered");
  assert.equal(calls, 3);
  assert.equal(rebuilds, 2, "两次重试各重建一次");
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[0] >= 1000 && sleeps[0] <= 1200, `attempt0 退避 ${sleeps[0]}`);
  assert.ok(sleeps[1] >= 3000 && sleeps[1] <= 3600, `attempt1 退避 ${sleeps[1]}`);
});

test("withTransientRetry：耗尽后原类型抛出且 message 尾带 [network]", async () => {
  let calls = 0;
  class MyErr extends Error {}
  const err = await withTransientRetry(
    async () => { calls++; throw new MyErr("connect ETIMEDOUT"); },
    { retries: 2, sleep: async () => {} },
  ).then(() => null, (e) => e);
  assert.equal(calls, 3, "1 次原始 + 2 次重试");
  assert.ok(err instanceof MyErr, "保持原错误类型");
  assert.match(err.message, /\[network\]$/);
});

test("withTransientRetry：非瞬态错误直通（不重试、不标记）", async () => {
  let calls = 0;
  const err = await withTransientRetry(
    async () => { calls++; throw new Error("HTTP 400: 工作流拒绝跨态直连"); },
    { retries: 3, sleep: async () => { throw new Error("不应 sleep"); } },
  ).then(() => null, (e) => e);
  assert.equal(calls, 1);
  assert.equal(err.message, "HTTP 400: 工作流拒绝跨态直连");
});

test("markNetworkError：幂等且不重复追加", () => {
  const e = new Error("x");
  markNetworkError(e);
  markNetworkError(e);
  assert.equal(e.message, "x [network]");
  markNetworkError("not an error"); // 不抛
});
