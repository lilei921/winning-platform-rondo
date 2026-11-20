/**
 * doctor network_baseline CLI 级测试（rll5-replay-remediation-plan M3.0）。
 *
 * 验收点：
 *  1. --require network_baseline 命中本地 http 服务 → JSON 中 tfs 目标 direct 腿成功、PAT 不进输出；
 *  2. 默认 doctor（无 --require）输出不含 network_baseline（opt-in 字节级守卫）；
 *  3. --network-sample 不带 --require network_baseline → 用法错误 exit 64；非法值同。
 *
 * 注意：CLI 必须异步 spawn——本测试在父进程内起 http 服务，spawnSync 会冻结父事件循环导致 fetch 超时。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function run(args, env = {}) {
  const cleanEnv = { ...process.env };
  // 代理 env 清空，保证 proxy 腿确定性 skipped_no_proxy_env
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"]) delete cleanEnv[k];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...cleanEnv, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ exit: code, stdout, stderr }));
  });
}

function withServer(fn) {
  return new Promise((resolve, reject) => {
    const srv = createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
    srv.listen(0, "127.0.0.1", async () => {
      try { resolve(await fn(srv.address().port)); } catch (e) { reject(e); } finally { srv.close(); }
    });
  });
}

test("network_baseline 命中本地服务 → tfs 目标 direct 腿成功", async () => {
  await withServer(async (port) => {
    // 不断言 exit：internal_npm 目标的真实可达性随机型环境而异（WARN 在 --require 下按 FAIL 计 exit 2）
    const { stdout } = await run(["doctor", "--require", "network_baseline", "--format", "json"], {
      TFS_URL: `http://127.0.0.1:${port}`, TFS_PAT: "dummy-pat-for-test",
    });
    const body = JSON.parse(stdout);
    const check = body.checks.find((c) => c.name === "network_baseline");
    assert.ok(check, "checks 里应有 network_baseline");
    assert.ok(["PASS", "WARN"].includes(check.result));
    assert.match(check.detail, /\[tfs\] direct 1\/1 成功/);
    assert.match(check.detail, /skipped_no_proxy_env/);
    assert.ok(!check.detail.includes("dummy-pat-for-test"), "PAT 不得进输出");
  });
});

test("默认 doctor 输出不含 network_baseline（opt-in 守卫）", async () => {
  // 不断言 exit：默认体检含 tfs_config 等环境相关 FAIL 项，退出码随机型环境而异（0 或 2）
  const { stdout } = await run(["doctor", "--format", "json"]);
  const body = JSON.parse(stdout);
  assert.ok(!body.checks.some((c) => c.name === "network_baseline"), "默认体检面不得包含 opt-in 项");
});

test("--network-sample 不带 --require network_baseline → 用法错误 64", async () => {
  const { exit } = await run(["doctor", "--network-sample", "3"]);
  assert.equal(exit, 64);
});

test("--network-sample 非法值 → 用法错误 64", async () => {
  const { exit } = await run(["doctor", "--require", "network_baseline", "--network-sample", "abc"]);
  assert.equal(exit, 64);
});
