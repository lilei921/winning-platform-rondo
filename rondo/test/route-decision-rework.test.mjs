/**
 * route-decision 返工再派发 + NOOP 后置条件修复（rll5-replay-remediation-plan M1/F1）。
 *
 * 验收点：
 *  ① parent 返工全路径：失效+同 key 新 active 一笔写完、rework_comment_ref 记录、Issue 回 in_progress；
 *  ② 同 comment_id 重跑：后置条件全满足 → NOOP 与修复前逐字节一致，且仍恰 1 条 active；
 *  ③ 预置"decision 已写、dispatch 已失效未恢复、status 仍 blocked" → mode=repair 补缺；
 *  ④⑤ sub_issue 返工全路径与修复路径（dispatch→comment→reopen 顺序）；
 *  ⑥ 未动路径 golden：ANALYSIS / RECREATE_PR(UNKNOWN) / CANCEL_DELIVERY 输出形状不变；
 *  ⑦ legacy 单 Issue 状态（无 issues/comments 键）下零副作用路由重跑 → NOOP 不变。
 */
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

function mkDispatch(overrides = {}) {
  return {
    dispatch_key: "WNDF-T#1.1,1.2#eng-1",
    task_refs: ["1.1", "1.2"],
    engineer_id: "eng-1",
    engineer_name: "Eng One",
    projection: "parent",
    sub_issue_ref: null,
    change_ref: "c-x",
    approved_comment_ref: "c-0",
    dispatched_at: "2026-11-01T00:00:00.000Z",
    active: true,
    ...overrides,
  };
}

/** parent 投影 + blocked + pr.abandoned 的多 Issue 初始状态。 */
function parentState(commentId, dispatchOverrides = {}, extraMetadata = {}) {
  return {
    issues: {
      "WNDF-T": {
        id: "issue-1", identifier: "WNDF-T", project_id: "project1", status: "blocked",
        metadata: {
          "pr.abandoned": JSON.stringify([{ repo_key: "repo1", pr_id: 1, event_key: "e1", detected_at: "t" }]),
          "dev.dispatch": JSON.stringify([mkDispatch(dispatchOverrides)]),
          ...extraMetadata,
        },
      },
    },
    comments: { "issue-1": [{ id: commentId, content: "请返工" }] },
  };
}

const ENG_ARGS = (cid) => ["--issue", "WNDF-T", "--comment-id", cid, "--next", "ENGINEERING", "--affected-task-refs", "1.1,1.2", "--reason", "REJECTED"];

const SOURCE = { repo_url: "https://tfs.example/tfs/collection/project/_git/root", branch: "main", commit: "a".repeat(40), change_ref: "c-x" };

test("仅批准保留来源时，也不能按历史无来源返工放行", t => {
  const state = parentState("approval-source", {}, {
    "analysis.change_ref": "c-x", "analysis.human_approval": JSON.stringify({ source: SOURCE }),
  });
  const f = fixture(t, state);
  assert.equal(f.runJson(ENG_ARGS("approval-source")).exit, 3);
  assert.deepEqual(f.readState(), state);
});

for (const recovery of [false, true]) {
  for (const broken of ["changed", "missing", "none"]) {
    test(`返工来源 ${recovery ? "恢复" : "首跑"}：${broken}`, t => {
      const state = parentState("source-check", { analysis_source: SOURCE }, {
        "analysis.change_ref": "c-x", "analysis.source": JSON.stringify(SOURCE),
      });
      const f = fixture(t, state);
      if (recovery) {
        assert.equal(f.runJson(ENG_ARGS("source-check"), { MOCK_FAIL_METADATA_KEY: "dev.dispatch" }).exit, 3);
      }
      const before = f.readState();
      const md = before.issues["WNDF-T"].metadata;
      if (broken === "changed") md["analysis.source"] = JSON.stringify({ ...SOURCE, commit: "b".repeat(40) });
      if (broken === "missing") delete md["analysis.source"];
      f.writeState(before);
      const r = f.runJson(ENG_ARGS("source-check"));
      if (broken !== "none") {
        assert.equal(r.exit, 3, r.stdout);
        assert.deepEqual(f.readState(), before, "拒绝恢复时不得写入 Decision、派发或状态");
      } else {
        assert.equal(r.exit, 0, r.stdout);
        const active = JSON.parse(f.readState().issues["WNDF-T"].metadata["dev.dispatch"]).filter(d => d.active);
        assert.equal(active.length, 1);
        assert.deepEqual(active[0].analysis_source, SOURCE);
      }
    });
  }
}

for (const projection of ["parent", "sub_issue"]) {
  test(`恢复缺口：${projection} Decision 已写而 dispatch 更新失败后可续走`, (t) => {
    const f = fixture(t, projection === "parent" ? parentState("gap-1") : subState("gap-1"));
    const failed = f.runJson(ENG_ARGS("gap-1"), { MOCK_FAIL_METADATA_KEY: "dev.dispatch" });
    assert.equal(failed.exit, 3);
    assert.equal(JSON.parse(f.readState().issues["WNDF-T"].metadata["dev.decision"]).length, 1);
    assert.equal(JSON.parse(f.readState().issues["WNDF-T"].metadata["dev.dispatch"])[0].active, true);
    const repaired = f.runJson(ENG_ARGS("gap-1"));
    assert.equal(repaired.exit, 0, repaired.stdout);
    const ds = JSON.parse(f.readState().issues["WNDF-T"].metadata["dev.dispatch"]);
    assert.equal(ds.length, 2);
    assert.equal(ds.filter(d => d.active).length, 1);
    assert.equal(ds[1].rework_comment_ref, "gap-1");
    assert.equal(f.runJson(ENG_ARGS("gap-1")).body.result, "NOOP");
  });
}

test("完成返工后同评论重跑不得再次启动已完成 Sub-Issue", (t) => {
  const f = fixture(t, subState("done-1"));
  assert.equal(f.runJson(ENG_ARGS("done-1")).exit, 0);
  const state = f.readState();
  state.issues["WNDF-T-1"].status = "done";
  f.writeState(state);
  assert.equal(f.runJson(ENG_ARGS("done-1")).body.result, "NOOP");
  assert.equal(f.readState().issues["WNDF-T-1"].status, "done");
  assert.equal(f.readState().comments["issue-sub-1"].length, 1);
});

for (const kind of ["replaced", "ambiguous", "legacy", "superseded"]) {
  test(`Decision 恢复边界：${kind} 不误派发旧轮次`, (t) => {
    const decision = { comment_id: "recover-old", next: "ENGINEERING", affected_task_refs: ["1.1", "1.2"],
      routed_to: "rework_parent_mention", applied_at: "2026-11-02T00:00:00.000Z", target_dispatch: mkDispatch() };
    const ds = [mkDispatch()];
    const decisions = [decision];
    if (kind === "replaced") ds[0].dispatched_at = "2026-11-03T00:00:00.000Z";
    if (kind === "ambiguous") ds.push(mkDispatch());
    if (kind === "legacy") delete decision.target_dispatch;
    if (kind === "superseded") decisions.push({ ...decision, comment_id: "recover-new" });
    const state = parentState("recover-old", {}, { "dev.dispatch": JSON.stringify(ds), "dev.decision": JSON.stringify(decisions) });
    const f = fixture(t, state);
    const result = f.runJson(ENG_ARGS("recover-old"));
    if (kind === "legacy") {
      assert.equal(result.exit, 0, result.stdout);
      assert.equal(JSON.parse(f.readState().issues["WNDF-T"].metadata["dev.dispatch"]).filter(d => d.active).length, 1);
    } else {
      assert.equal(result.exit, kind === "superseded" ? 0 : 3, result.stdout);
      assert.deepEqual(f.readState(), state, "有歧义或被取代时保持原事实");
    }
  });
}

test("① parent 返工：失效+同 key 新 active 一笔写完，rework_comment_ref 记录", (t) => {
  const { runJson, readState } = fixture(t, parentState("c-1"));
  const { exit, body } = runJson(ENG_ARGS("c-1"));
  assert.equal(exit, 0);
  assert.equal(body.result, "PASS");
  assert.equal(body.directive, "rework_parent_mention");
  assert.equal(body.invalidated_dispatch, "WNDF-T#1.1,1.2#eng-1");
  assert.deepEqual(body.redispatched, { dispatch_key: "WNDF-T#1.1,1.2#eng-1", active: true, rework_comment_ref: "c-1" });
  assert.deepEqual(body.rework_target, { engineer_id: "eng-1", engineer_name: "Eng One", task_refs: ["1.1", "1.2"] });

  const st = readState();
  const dispatches = JSON.parse(st.issues["WNDF-T"].metadata["dev.dispatch"]);
  assert.equal(dispatches.length, 2);
  assert.equal(dispatches.filter((d) => d.active).length, 1, "恰 1 条 active");
  const old = dispatches[0];
  assert.equal(old.active, false);
  assert.equal(old.invalidated_by, "c-1");
  const neo = dispatches[1];
  assert.equal(neo.active, true);
  assert.equal(neo.rework_comment_ref, "c-1");
  assert.equal(neo.invalidated_by, undefined);
  assert.equal(neo.dispatch_key, old.dispatch_key);
  assert.equal(neo.approved_comment_ref, old.approved_comment_ref, "整体 spread 继承");
  assert.ok(neo.dispatched_at > old.dispatched_at);
  assert.equal(st.issues["WNDF-T"].status, "in_progress");
});

test("② 同 comment_id 重跑 → NOOP 逐字节一致且仍恰 1 条 active", (t) => {
  const { run, runJson, readState } = fixture(t, parentState("c-2"));
  runJson(ENG_ARGS("c-2")); // 首次：完成返工再派发
  const second = run(ENG_ARGS("c-2"));
  assert.equal(second.exit, 0);
  const prior = JSON.parse(readState().issues["WNDF-T"].metadata["dev.decision"])[0];
  const expected = JSON.stringify({
    result: "NOOP",
    reason: "同一 comment_id 的 Decision 已处理（02 §11.2 单次触发）",
    comment_id: "c-2",
    prior,
  }, null, 2) + "\n";
  assert.equal(second.stdout, expected, "NOOP 输出与修复前形状逐字节一致（无新增 key）");
  const dispatches = JSON.parse(readState().issues["WNDF-T"].metadata["dev.dispatch"]);
  assert.equal(dispatches.filter((d) => d.active).length, 1, "重跑不产生重复 active");
});

test("③ 修复路径：decision 已写、dispatch 已失效未恢复、status 仍 blocked → repairs", (t) => {
  const st0 = parentState("c-9", { active: false, invalidated_by: "c-9" }, {
    "dev.decision": JSON.stringify([{
      comment_id: "c-9", reason: "REJECTED", next: "ENGINEERING",
      affected_task_refs: ["1.1", "1.2"], routed_to: "rework_parent_mention",
      applied_at: "2026-11-02T00:00:00.000Z",
    }]),
  });
  const { runJson, readState } = fixture(t, st0);
  const { exit, body } = runJson(ENG_ARGS("c-9"));
  assert.equal(exit, 0);
  assert.equal(body.result, "PASS");
  assert.equal(body.mode, "repair");
  assert.deepEqual(body.repairs, ["dispatch", "status"]);
  const st = readState();
  const dispatches = JSON.parse(st.issues["WNDF-T"].metadata["dev.dispatch"]);
  assert.equal(dispatches.filter((d) => d.active).length, 1);
  assert.equal(dispatches[1].rework_comment_ref, "c-9");
  assert.equal(st.issues["WNDF-T"].status, "in_progress");
});

/** sub_issue 投影初始状态（含 Sub-Issue）。 */
function subState(commentId, { subStatus = "done", dispatchOverrides = {}, extraMetadata = {}, subComments = [] } = {}) {
  const st = parentState(commentId, {
    projection: "sub_issue", sub_issue_ref: "WNDF-T-1", ...dispatchOverrides,
  }, extraMetadata);
  st.issues["WNDF-T-1"] = {
    id: "issue-sub-1", identifier: "WNDF-T-1", project_id: "project1",
    status: subStatus, parent_issue_id: "issue-1", assignee_id: "eng-1", metadata: {},
  };
  if (subComments.length > 0) st.comments["issue-sub-1"] = subComments;
  return st;
}

test("④ sub_issue 返工：失效+新 active、返工评论、Sub-Issue 重开", (t) => {
  const { runJson, readState } = fixture(t, subState("c-3"));
  const { exit, body } = runJson(ENG_ARGS("c-3"));
  assert.equal(exit, 0);
  assert.equal(body.result, "PASS");
  assert.equal(body.directive, "rework_sub_issue_activated");
  assert.equal(body.sub_issue, "WNDF-T-1");

  const st = readState();
  const dispatches = JSON.parse(st.issues["WNDF-T"].metadata["dev.dispatch"]);
  assert.equal(dispatches.length, 2);
  assert.equal(dispatches[0].active, false);
  assert.equal(dispatches[0].invalidated_by, "c-3");
  assert.equal(dispatches[1].active, true);
  assert.equal(dispatches[1].rework_comment_ref, "c-3");
  assert.equal(dispatches[1].sub_issue_ref, "WNDF-T-1", "sub_issue_ref 继承");
  const subComments = st.comments["issue-sub-1"];
  assert.equal(subComments.length, 1);
  assert.match(subComments[0].content, /c-3/);
  assert.match(subComments[0].content, /返工输入/);
  assert.equal(st.issues["WNDF-T-1"].status, "in_progress");

  // 重跑 → 后置条件全满足 → NOOP
  const again = runJson(ENG_ARGS("c-3"));
  assert.equal(again.body.result, "NOOP");
});

test("⑤ sub_issue 修复路径：全部后置条件缺失 → repairs [dispatch, comment, reopen]", (t) => {
  const st0 = subState("c-8", {
    dispatchOverrides: { active: false, invalidated_by: "c-8" },
    extraMetadata: {
      "dev.decision": JSON.stringify([{
        comment_id: "c-8", reason: null, next: "ENGINEERING",
        affected_task_refs: ["1.1", "1.2"], routed_to: "rework_sub_issue_activated",
        applied_at: "2026-11-02T00:00:00.000Z",
      }]),
    },
  });
  const { runJson, readState } = fixture(t, st0);
  const { exit, body } = runJson(ENG_ARGS("c-8"));
  assert.equal(exit, 0);
  assert.equal(body.mode, "repair");
  assert.deepEqual(body.repairs, ["dispatch", "comment", "reopen"]);
  const st = readState();
  assert.equal(JSON.parse(st.issues["WNDF-T"].metadata["dev.dispatch"]).filter((d) => d.active).length, 1);
  assert.equal(st.comments["issue-sub-1"].length, 1);
  assert.equal(st.issues["WNDF-T-1"].status, "in_progress");
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
    affected_task_refs: null, routed_to: "hold_for_human",
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
    affected_task_refs: null, routed_to: "mention_analyst",
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
