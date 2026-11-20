/**
 * dev check-dispatch 的瞬态重试 CLI 级测试（rll5-replay-remediation-plan M3.1）。
 *
 * loadDispatchFacts 走 runCommandTransient（CmdResult 形，保留 {ok:false} 数据化分类）；
 * mock-multica 故障注入（MOCK_FAIL_MODE + MOCK_FAIL_STATE 跨进程计数）：
 *  - empty_stdout ×2 → 重试后 PASS（exit 0，stdout 干净 JSON，stderr 有重试行）；
 *  - tls_stderr ×1 → 网络签名重试后 PASS；
 *  - empty_stdout ×9（超过重试上限）→ issue_read UNKNOWN（exit 3），分类文案不变。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const MOCK = fileURLToPath(new URL("./mock-multica.cjs", import.meta.url));

function setup(t, failCount) {
  const dir = mkdtempSync(join(tmpdir(), "check-dispatch-transient-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = join(dir, "registry.json");
  writeFileSync(config, JSON.stringify({ runtime: { multica_cli: MOCK }, registry: {} }));
  const statePath = join(dir, "state.json");
  writeFileSync(statePath, JSON.stringify({
    issues: {
      "WNDF-T": {
        id: "issue-1", identifier: "WNDF-T", project_id: "project1", status: "in_progress",
        metadata: {
          "tfs.id": "999", "tfs.type": "Bug",
          "dev.dispatch": JSON.stringify([{
            dispatch_key: "WNDF-T#1.1#eng-1", task_refs: ["1.1"], engineer_id: "eng-1",
            change_ref: "c-1", active: true, dispatched_at: "2026-11-01T00:00:00.000Z",
          }]),
        },
      },
    },
  }));
  const failState = join(dir, "fail-state.txt");
  writeFileSync(failState, String(failCount));
  return { config, failState, statePath };
}

function run(f, mode) {
  return spawnSync(process.execPath,
    [CLI, "dev", "check-dispatch", "--config", f.config, "--issue", "WNDF-T", "--task-refs", "1.1"],
    {
      encoding: "utf8",
      env: {
        ...process.env, MOCK_STATE: f.statePath,
        MOCK_FAIL_MODE: mode, MOCK_FAIL_STATE: f.failState,
      },
    });
}

test("empty_stdout ×2：重试后 PASS，stdout 干净 JSON，stderr 有重试行", (t) => {
  const f = setup(t, 2);
  const r = run(f, "empty_stdout");
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const body = JSON.parse(r.stdout);          // stdout 必须是可解析的干净 JSON
  assert.equal(body.result, "PASS");
  const retryLines = r.stderr.split("\n").filter((l) => l.includes("transient retry"));
  assert.equal(retryLines.length, 2, `stderr=${r.stderr}`);
  assert.equal(readFileSync(f.failState, "utf8"), "0", "故障计数应耗尽");
});

test("tls_stderr ×1：网络签名命中，重试后 PASS", (t) => {
  const f = setup(t, 1);
  const r = run(f, "tls_stderr");
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  assert.equal(JSON.parse(r.stdout).result, "PASS");
  assert.match(r.stderr, /transient retry.*命中网络签名/);
});

test("tls_stderr ×9：超过重试上限 → issue_read UNKNOWN，分类文案不变", (t) => {
  const f = setup(t, 9);
  const r = run(f, "tls_stderr");
  assert.equal(r.status, 3);
  const body = JSON.parse(r.stdout);
  assert.equal(body.result, "UNKNOWN");
  assert.equal(body.code, "issue_read");
  assert.match(body.reasons[0], /读取 Issue WNDF-T 失败 rc=1/);
});
