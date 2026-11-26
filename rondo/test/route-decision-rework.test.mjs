import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const MOCK = fileURLToPath(new URL("./mock-multica.cjs", import.meta.url));

function fixture(t, state) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "route-decision-rework-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  chmodSync(MOCK, 0o755);
  const config = join(dir, "registry.json");
  writeFileSync(config, JSON.stringify({ runtime: { multica_cli: MOCK, workspace_id: "ws-test" }, registry: {} }));
  const statePath = join(dir, "state.json");
  writeFileSync(statePath, JSON.stringify(state));
  const env = { MOCK_STATE: statePath };
  const readState = () => JSON.parse(readFileSync(statePath, "utf8"));
  const run = (args, extraEnv = {}) => {
    const r = spawnSync(process.execPath, [CLI, "delivery", "route-decision", "--config", config, ...args], {
      encoding: "utf8", env: { ...process.env, ...env, ...extraEnv },
    });
    assert.equal(r.error, undefined, r.error?.message);
    return { exit: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const runJson = (args, extraEnv = {}) => {
    const r = run(args, extraEnv);
    let body;
    try { body = JSON.parse(r.stdout); }
    catch { assert.fail("CLI did not produce JSON: " + r.stdout + "\n" + r.stderr); }
    return { ...r, body };
  };
  return { run, runJson, readState, writeState: value => writeFileSync(statePath, JSON.stringify(value)) };
}

function parentState(commentId, _unused = {}, extraMetadata = {}) {
  return {
    issues: { "WNDF-T": { id: "issue-1", identifier: "WNDF-T", project_id: "project1", status: "blocked",
      metadata: { "pr.abandoned": JSON.stringify([{ repo_key: "repo1", pr_id: 1, event_key: "e1", detected_at: "t" }]), ...extraMetadata } } },
    comments: { "issue-1": [{ id: commentId, content: "请返工" }] },
  };
}
test("Engineering rework remains a semantic decision without implicit authorization or duplicate run", t => {
  const state = parentState("rework");
  const f = fixture(t, state);
  const args = ["--issue", "WNDF-T", "--comment-id", "rework", "--next", "ENGINEERING"];
  for (let i = 0; i < 2; i++) {
    const r = f.runJson(args);
    assert.equal(r.exit, 0);
    assert.equal(r.body.directive, "needs_engineering");
    assert.deepEqual(f.readState(), state);
  }
  assert.equal(f.run([...args, "--affected-task-refs", "1.1"]).exit, 64);
});
test("⑥ golden：ANALYSIS / RECREATE_PR(UNKNOWN) / CANCEL_DELIVERY 输出形状不变", (t) => {
  // ANALYSIS
  const a = fixture(t, parentState("c-4"));
  const ra = a.runJson(["--issue", "WNDF-T", "--comment-id", "c-4", "--next", "ANALYSIS"]);
  assert.equal(ra.exit, 0);
  assert.deepEqual(ra.body, { result: "PASS", next: "ANALYSIS", directive: "mention_analyst", issue: "WNDF-T", status: "in_progress" });
  assert.equal(a.readState().issues["WNDF-T"].status, "in_progress");

  // RECREATE_PR：abandoned 的 repo_key 未登记 → 确定性 UNKNOWN（不触 TFS）
  const rp = parentState("c-5", {}, {
    pr_prep: JSON.stringify([{ repo_key: "repo1", source_branch: "b", candidate_commit: "x", title: "t" }]),
    current_pr: JSON.stringify([]),
  });
  const b = fixture(t, rp);
  const rb = b.runJson(["--issue", "WNDF-T", "--comment-id", "c-5", "--next", "RECREATE_PR"]);
  assert.equal(rb.exit, 3);
  assert.deepEqual(rb.body, { result: "UNKNOWN", reason: "pr.abandoned 中 repo_key 未登记: repo1" });

  // CANCEL_DELIVERY：零写入 hold_for_human
  const c = fixture(t, parentState("c-6"));
  const rc = c.runJson(["--issue", "WNDF-T", "--comment-id", "c-6", "--next", "CANCEL_DELIVERY"]);
  assert.equal(rc.exit, 0);
  assert.deepEqual(rc.body, {
    result: "PASS", next: "CANCEL_DELIVERY", directive: "hold_for_human",
    detail: "CANCEL_DELIVERY 专项契约未定义（02 §11.2）——本脚本零写入，Delivery Lead 保持安全停止并交 Human 处理",
  });
});

test("⑦ legacy 状态（无 issues/comments 键）零副作用路由重跑 → NOOP 不变", (t) => {
  const prior = {
    comment_id: "c-7", reason: null, next: "CANCEL_DELIVERY",
    routed_to: "hold_for_human",
    applied_at: "2026-11-02T00:00:00.000Z",
  };
  const legacy = {
    status: "blocked",
    metadata: { "dev.decision": JSON.stringify([prior]) },
    comments: { "issue-1": [{ id: "c-7", content: "取消" }] },
  };
  const { run, readState } = fixture(t, legacy);
  const r = run(["--issue", "WNDF-T", "--comment-id", "c-7", "--next", "CANCEL_DELIVERY"]);
  assert.equal(r.exit, 0);
  const expected = JSON.stringify({
    result: "NOOP",
    reason: "同一 comment_id 的 Decision 已处理（02 §11.2 单次触发）",
    comment_id: "c-7",
    prior,
  }, null, 2) + "\n";
  assert.equal(r.stdout, expected);
  assert.equal(readState().status, "blocked", "零副作用路由：状态不变");
});

test("F5: stale ANALYSIS decision cannot silently unblock a new blocker", (t) => {
  const decision = {
    comment_id: "old-analysis", reason: null, next: "ANALYSIS",
    routed_to: "mention_analyst",
    applied_at: "2026-11-01T00:00:00.000Z",
  };
  const state = parentState("old-analysis", {}, {
    "dev.decision": JSON.stringify([decision]),
  });
  const f = fixture(t, state);
  const r = f.runJson(["--issue", "WNDF-T", "--comment-id", "old-analysis", "--next", "ANALYSIS"]);
  assert.equal(r.exit, 3, r.stdout);
  assert.equal(r.body.result, "UNKNOWN");
  assert.match(r.body.reason, /禁止旧评论自动解除阻塞/);
  assert.deepEqual(f.readState(), state, "保留新的 blocked 事实，不自动覆盖");
});
