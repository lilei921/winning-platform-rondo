// initial_status 配置驱动回归：backlog 停放；todo 仅在初始化收口后发一次启动信号。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const MOCK_MULTICA = fileURLToPath(new URL("./mock-multica.cjs", import.meta.url));
const MOCK_TFS = fileURLToPath(new URL("./mock-tfs.cjs", import.meta.url));

/** 构造一轮 reconcile 的临时环境；initial_status 缺省表示配置不写该字段。 */
function fixture(t, initialStatus) {
  const dir = mkdtempSync(join(tmpdir(), "rondo-initial-status-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const queryFile = join(dir, "query.json"), statePath = join(dir, "state.json");
  const callsFile = join(dir, "calls.jsonl"), config = join(dir, "config.json");
  writeFileSync(queryFile, JSON.stringify([{
    id: 265137, type: "Bug", title: "自动推进用例", url: "http://tfs/wi/265137",
    state: "活动", changedDate: "2026-11-23T08:00:00Z", fields: {}, attachments: [],
  }]));
  writeFileSync(statePath, JSON.stringify({ agents_list: [{ id: "agent-wayfinder", name: "Wayfinder Agent" }] }));
  chmodSync(MOCK_MULTICA, 0o755);
  writeFileSync(config, JSON.stringify({
    tfs: { query_command: [process.execPath, MOCK_TFS, "query"] },
    multica: {
      cli: MOCK_MULTICA, workspace_id: "ws-test", project: "proj-1", intake_agent: "Wayfinder Agent",
      ...(initialStatus === undefined ? {} : { initial_status: initialStatus }),
    },
    sync: {},
  }));

  return {
    state() { return JSON.parse(readFileSync(statePath, "utf8")); },
    run() {
      writeFileSync(callsFile, "");
      const r = spawnSync(process.execPath, [CLI, "tfs", "reconcile-workitem", "--config", config], {
        encoding: "utf8",
        env: { ...process.env, MOCK_STATE: statePath, MOCK_TFS_QUERY_FILE: queryFile, MOCK_SYNC_CALLS_FILE: callsFile },
      });
      assert.equal(r.error, undefined);
      return {
        exit: r.status, result: JSON.parse(r.stdout), stderr: r.stderr,
        calls: readFileSync(callsFile, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)),
      };
    },
  };
}

const statusCalls = r => r.calls.filter(a => a[0] === "issue" && a[1] === "status");
const issueOf = f => Object.values(f.state().issues)[0];

test("initial_status=backlog：新建停放 backlog，重跑不激活也不重复写入", t => {
  const f = fixture(t, "backlog");
  const first = f.run();
  assert.equal(first.exit, 0, first.stderr);
  assert.equal(issueOf(f).status, "backlog");
  assert.equal(statusCalls(first).length, 0);

  const again = f.run();
  assert.equal(again.exit, 0, again.stderr);
  assert.equal(again.result.skipped.length, 1);
  assert.equal(statusCalls(again).length, 0);
});

test("initial_status=todo：创建仍 backlog，收口后恰好一次启动信号，重跑不再发", t => {
  const f = fixture(t, "todo");
  const first = f.run();
  assert.equal(first.exit, 0, first.stderr);
  const created = first.calls.find(a => a[0] === "issue" && a[1] === "create");
  assert.equal(created[created.indexOf("--status") + 1], "backlog", "不能在初始化完成前启动");
  assert.equal(issueOf(f).status, "todo");

  // 启动信号不带 --no-start；一次同步只发一次
  const statuses = statusCalls(first);
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0][3], "todo");
  assert.ok(!statuses[0].includes("--no-start"));

  const again = f.run();
  assert.equal(again.exit, 0, again.stderr);
  assert.equal(again.result.skipped.length, 1);
  assert.equal(statusCalls(again).length, 0, "已有 Issue 不得重复激活");
  assert.equal(issueOf(f).status, "todo");
});

test("非法 initial_status 整体拒绝，未创建 Issue", t => {
  const f = fixture(t, "in_progress");
  const r = f.run();
  assert.equal(r.exit, 3, r.stderr);
  assert.equal(r.result.result, "UNKNOWN");
  assert.equal(f.state().issues, undefined);
});
