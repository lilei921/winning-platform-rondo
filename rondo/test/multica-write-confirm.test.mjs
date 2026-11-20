/**
 * MulticaClient 写命令回读确认（rll5-replay-remediation-plan M3.2）。
 *
 * mock-multica 故障注入：
 *  - MOCK_FAIL_MODE=flaky_write：写操作先落状态再 rc=1 + TLS 文本（"写成功但响应丢失"）
 *    → 客户端应回读确认已生效，副作用恰好一次，不抛错；
 *  - MOCK_FAIL_MODE=tls_stderr：状态不变 + rc=1（真失败，读写皆断）
 *  - MOCK_FAIL_MODE=write_fail：状态不变 + rc=1（真失败，读正常）
 *    → 重试一次写、再回读仍无 → UnknownError 带 [write-unconfirmed]。
 * MOCK_FAIL_STATE 文件为跨进程剩余故障计数。
 *
 * 注：客户端经 execa 同步 spawn mock 子进程，env 继承本进程——测试内直接改写
 * process.env 的 MOCK_* 变量控制故障注入；t.after 复原。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MOCK = fileURLToPath(new URL("./mock-multica.cjs", import.meta.url));
const { MulticaClient } = await import(pathToFileURL(fileURLToPath(new URL("../dist/clients/multica.js", import.meta.url))).href);

const MOCK_ENV_KEYS = ["MOCK_STATE", "MOCK_FAIL_MODE", "MOCK_FAIL_STATE", "MOCK_ROOT_REPO", "OPS_LOG", "MOCK_EXPECT_PROFILE", "MOCK_EXPECT_SERVER"];

function setup(t, { failMode = null, failCount = 0, environment = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "multica-write-confirm-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const saved = Object.fromEntries(MOCK_ENV_KEYS.map((k) => [k, process.env[k]]));
  t.after(() => { for (const k of MOCK_ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  const statePath = join(dir, "state.json");
  writeFileSync(statePath, JSON.stringify({
    issues: { "WNDF-T": { id: "issue-1", identifier: "WNDF-T", project_id: "project1", status: "in_progress", metadata: {} } },
  }));
  const failState = join(dir, "fail-state.txt");
  writeFileSync(failState, String(failCount));
  process.env.MOCK_STATE = statePath;
  process.env.MOCK_FAIL_STATE = failState;
  if (failMode) process.env.MOCK_FAIL_MODE = failMode; else delete process.env.MOCK_FAIL_MODE;

  if (environment.multica_profile) process.env.MOCK_EXPECT_PROFILE = environment.multica_profile;
  if (environment.multica_server_url) process.env.MOCK_EXPECT_SERVER = environment.multica_server_url;
  const client = new MulticaClient({ multica_cli: MOCK, workspace_id: "ws-test", ...environment });
  const readState = () => JSON.parse(readFileSync(statePath, "utf8"));
  return { client, readState, failState, statePath };
}

test("flaky_write：setMetadata 响应丢失 → 回读已生效，值恰好一次，不抛错", (t) => {
  const { client, readState } = setup(t, { failMode: "flaky_write", failCount: 1 });
  client.setMetadata("issue-1", "k1", "v1");
  assert.equal(readState().issues["WNDF-T"].metadata.k1, "v1");
});

test("多环境写入与响应丢失后的每次回读都保留 profile/server 绑定", (t) => {
  const { client, readState, failState } = setup(t, {
    failMode: "flaky_write",
    environment: { multica_profile: "isolated-test", multica_server_url: "https://isolated.invalid" },
  });
  // 每次写都注入一次响应丢失；mock 对读写的每个 argv 强制检查环境。
  const confirm = (action) => { writeFileSync(failState, "1"); return action(); };
  confirm(() => client.setMetadata("issue-1", "env-key", "yes"));
  confirm(() => client.deleteMetadata("issue-1", "env-key"));
  confirm(() => client.setStatus("issue-1", "blocked"));
  confirm(() => client.setStatusNoStart("issue-1", "in_progress"));
  // 启动信号响应丢失时，状态可能已落库，但不能据此断言 Run 已启动。
  writeFileSync(failState, "1");
  assert.throws(
    () => client.setStatusWithStart("issue-1", "done", "测试状态启动"),
    (e) => e instanceof Error && e.message.includes("[run-start-unconfirmed]"),
  );
  assert.equal(readState().issues["WNDF-T"].status, "done");
  confirm(() => client.assignNoStart("issue-1", "engineer-1"));
  confirm(() => client.addCommentContent("issue-1", "绑定环境的评论"));
  const dir = mkdtempSync(join(tmpdir(), "multica-env-comment-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "comment.md");
  writeFileSync(file, "绑定环境的文件评论");
  confirm(() => client.addComment("issue-1", file));
  assert.equal(readState().issues["WNDF-T"].status, "done");
  assert.equal(readState().issues["WNDF-T"].assignee_id, "engineer-1");
  assert.equal(readState().comments["issue-1"].length, 2);
  assert.deepEqual(client.listMetadata("issue-1"), {});
});

test("flaky_write：setStatus 响应丢失 → 回读已生效，状态恰好为目标值", (t) => {
  const { client, readState } = setup(t, { failMode: "flaky_write", failCount: 1 });
  client.setStatus("issue-1", "done");
  assert.equal(readState().issues["WNDF-T"].status, "done");
});

test("flaky_write：addCommentContent 响应丢失 → 内容认领，评论恰好一条", (t) => {
  const { client, readState } = setup(t, { failMode: "flaky_write", failCount: 1 });
  const id = client.addCommentContent("issue-1", "回读确认测试评论");
  assert.ok(typeof id === "string" && id.length > 0);
  const comments = readState().comments["issue-1"];
  assert.equal(comments.length, 1, "副作用恰好一次——不重复评论");
  assert.equal(comments[0].id, id, "返回的 id 须为回读认领到的评论 id");
  assert.equal(comments[0].content, "回读确认测试评论");
});

test("flaky_write：addComment（--content-file，finalize 摘要路径）响应丢失 → 恰好一条评论", (t) => {
  const { client, readState } = setup(t, { failMode: "flaky_write", failCount: 1 });
  const dir = mkdtempSync(join(tmpdir(), "multica-write-confirm-file-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const textFile = join(dir, "summary.md");
  writeFileSync(textFile, "交付摘要：模拟 finalize summary 评论");
  const id = client.addComment("issue-1", textFile);
  const comments = readState().comments["issue-1"];
  assert.equal(comments.length, 1, "finalize 摘要路径：副作用恰好一次，exit 0 不抛错");
  assert.equal(comments[0].id, id);
  assert.equal(comments[0].content, "交付摘要：模拟 finalize summary 评论");
});

test("write_fail（真失败，状态不变、读正常）：重试一次仍无 → [write-unconfirmed] UNKNOWN", (t) => {
  // 写永远失败、回读永远成功且未生效 → 两次写 + 两次回读 → [write-unconfirmed]
  const { client, readState } = setup(t, { failMode: "write_fail", failCount: 99 });
  assert.throws(
    () => client.setMetadata("issue-1", "k1", "v1"),
    (e) => e instanceof Error && e.message.includes("[write-unconfirmed]") && e.message.includes("写入 metadata"),
  );
  assert.equal(readState().issues["WNDF-T"].metadata.k1, undefined, "真失败不得留下副作用");
});

test("deleteMetadata：flaky_write 响应丢失 → 回读 key 已消失即生效", (t) => {
  const { client, readState, failState } = setup(t, { failMode: "flaky_write", failCount: 0 });
  // 先无故障写入一个 key，再把故障预算拨给 delete 这一笔写
  client.setMetadata("issue-1", "k-del", "x");
  writeFileSync(failState, "1");
  client.deleteMetadata("issue-1", "k-del");
  assert.equal(readState().issues["WNDF-T"].metadata["k-del"], undefined);
});

test("F4: uncertain status transition must not claim Run started or retry the start signal", (t) => {
  const { client, readState } = setup(t, { failMode: "flaky_write", failCount: 1 });
  assert.throws(
    () => client.setStatusWithStart("issue-1", "todo", "激活 Sub-Issue"),
    (e) => e instanceof Error && e.message.includes("[run-start-unconfirmed]"),
  );
  assert.equal(readState().issues["WNDF-T"].status, "todo",
    "状态已写入，但不能据此断言 Run 启动成功");
});

test("F6: failed comment write must not claim an older identical comment", (t) => {
  const { client, readState, statePath } = setup(t, { failMode: "write_fail", failCount: 1 });
  const state = readState();
  state.comments = { "issue-1": [{ id: "old-comment", content: "同一评论" }] };
  state.comment_seq = 1;
  writeFileSync(statePath, JSON.stringify(state));
  assert.throws(
    () => client.addCommentContent("issue-1", "同一评论"),
    (e) => e instanceof Error && e.message.includes("[write-unconfirmed]"),
  );
  assert.deepEqual(readState().comments["issue-1"], state.comments["issue-1"],
    "不应认领历史评论，也不盲目重发");
});

test("F6: deterministic business write failure propagates without recovery retries", (t) => {
  const { client, readState } = setup(t);
  const prev = process.env.MOCK_FAIL_METADATA_KEY;
  process.env.MOCK_FAIL_METADATA_KEY = "denied";
  t.after(() => {
    if (prev === undefined) delete process.env.MOCK_FAIL_METADATA_KEY;
    else process.env.MOCK_FAIL_METADATA_KEY = prev;
  });
  assert.throws(
    () => client.setMetadata("issue-1", "denied", "v"),
    (e) => e instanceof Error && e.message.includes("injected metadata set failure") &&
      !e.message.includes("[write-unconfirmed]"),
  );
  assert.equal(readState().issues["WNDF-T"].metadata.denied, undefined);
});
