import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { analysisTfsFixture } from "./analysis-tfs-fixture.mjs";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const MOCK = fileURLToPath(new URL("./mock-dev-verify.cjs", import.meta.url));

function fixture(t, { recommendation = "not_required", finalRequired = false, validApproval = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "rondo-verify-materialize-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root]);
  const change = join(root, "openspec", "changes", "fix-101");
  mkdirSync(change, { recursive: true });
  writeFileSync(join(change, "tasks.md"), "- [ ] 1.1 Fix behavior\n");
  const config = join(root, "config.json");
  const stateFile = join(root, "state.json");
  chmodSync(MOCK, 0o755);
  writeFileSync(config, JSON.stringify({
    runtime: { multica_cli: MOCK, workspace_id: "ws-test" }, registry: {},
  }));
  const tfs = analysisTfsFixture(t, root, { versions: { ["a".repeat(40)]: { "/openspec/changes/fix-101/tasks.md": "- [ ] 1.1 远端已批准任务\n" } } });
  const source = { repo_url: tfs.repoUrl, branch: "dev", commit: "a".repeat(40), change_ref: "fix-101" };
  const approval = { source,
    decision: "approved", by: "human", at: "2026-11-08T00:00:00Z",
    comment_ref: "approval-1", ...(validApproval ? { verify_agent_required: finalRequired } : {}),
  };
  const metadata = {
    "analysis.change_ref": "fix-101",
    "analysis.source": JSON.stringify(source),
    "analysis.gate.result": "PASS",
    "analysis.verify_agent.recommendation": recommendation,
    "analysis.human_approval": JSON.stringify(approval),
  };
  writeFileSync(stateFile, JSON.stringify({ metadata, comments: ["approval-1"] }));
  const state = () => JSON.parse(readFileSync(stateFile, "utf8"));
  const update = (edit) => { const s = state(); edit(s); writeFileSync(stateFile, JSON.stringify(s)); };
  const run = (extraEnv = {}, approvedCommentRef = "approval-1", extraArgs = []) => {
    const out = spawnSync(process.execPath, [
      CLI, "dev", "materialize", "--config", config,
      "--issue", "WNDF-T", "--change-ref", "fix-101", "--task-refs", "1.1",
      "--engineer-id", "engineer-1", "--approved-comment-ref", approvedCommentRef,
      "--root-repo", root, ...extraArgs,
    ], {
      encoding: "utf8",
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== "path")), ...tfs.env, MOCK_VERIFY_STATE: stateFile, ...extraEnv },
      timeout: 30_000,
    });
    assert.equal(out.error, undefined, out.error?.message);
    let body;
    try { body = JSON.parse(out.stdout); }
    catch { assert.fail(out.stdout + "\n" + out.stderr); }
    return { code: out.status, body };
  };
  return { state, update, run, source, tfs, root, config, stateFile };
}

for (const phase of ["ASSIGN", "DISPATCH", "NONE"]) {
  test(`Sub-Issue 落账/启动前核对来源：${phase}`, t => {
    const f = fixture(t);
    const r = f.run({ [`MOCK_VERIFY_DRIFT_ON_${phase}`]: "1" }, "approval-1", ["--projection", "sub-issue"]);
    assert.equal(r.code, phase === "NONE" ? 0 : 3, JSON.stringify(r));
    assert.equal(f.state().sub.status, phase === "NONE" ? "todo" : "backlog");
    assert.equal(f.state().activations || 0, phase === "NONE" ? 1 : 0);
    if (phase === "ASSIGN") assert.equal(f.state().metadata["dev.dispatch"], undefined);
    if (phase === "DISPATCH") {
      // 落账后发现冲突，保留事实但不启动；重跑也不能以 NOOP 绕过版本不一致。
      assert.equal(f.run({}, "approval-1", ["--activate"]).code, 3);
    }
  });
}

test("Analyst required, Human not_required: project false before dispatch; retry is NOOP", (t) => {
  const f = fixture(t, { recommendation: "required", finalRequired: false });
  const first = f.run();
  assert.equal(first.code, 0, JSON.stringify(first));
  assert.equal(first.body.result, "PASS");
  assert.equal(f.state().metadata["verify_agent.required"], "false");
  assert.equal(JSON.parse(f.state().metadata["dev.dispatch"]).length, 1);
  const again = f.run();
  assert.equal(again.body.result, "NOOP");
  assert.equal(JSON.parse(f.state().metadata["dev.dispatch"]).length, 1);
});

test("Analyst not_required, Human required: project true rather than default false", (t) => {
  const f = fixture(t, { recommendation: "not_required", finalRequired: true });
  const r = f.run();
  assert.equal(r.code, 0, JSON.stringify(r));
  assert.equal(f.state().metadata["verify_agent.required"], "true");
});

test("missing Human Verify Decision stops before final projection or dispatch", (t) => {
  const f = fixture(t, { validApproval: false });
  const r = f.run();
  assert.equal(r.code, 3);
  assert.equal(r.body.result, "UNKNOWN");
  assert.equal(f.state().metadata["verify_agent.required"], undefined);
  assert.equal(f.state().metadata["dev.dispatch"], undefined);
});

test("failed Verify projection never writes dev.dispatch; can retry safely", (t) => {
  const f = fixture(t);
  const failed = f.run({ MOCK_VERIFY_FAIL_KEY: "verify_agent.required" });
  assert.equal(failed.code, 3);
  assert.equal(f.state().metadata["dev.dispatch"], undefined);
  const retried = f.run();
  assert.equal(retried.code, 0, JSON.stringify(retried));
  assert.equal(f.state().metadata["verify_agent.required"], "false");
  assert.ok(f.state().metadata["dev.dispatch"]);
});

test("conflicting final decision is never overwritten", (t) => {
  const f = fixture(t, { finalRequired: true });
  f.update((st) => { st.metadata["verify_agent.required"] = "false"; });
  const r = f.run();
  assert.equal(r.code, 3);
  assert.equal(f.state().metadata["verify_agent.required"], "false");
  assert.equal(f.state().metadata["dev.dispatch"], undefined);
});

test("post-dispatch Human override changes only final Verify Decision, preserving dev.dispatch", (t) => {
  const f = fixture(t, { finalRequired: false });
  assert.equal(f.run().code, 0);
  const dispatch = f.state().metadata["dev.dispatch"];
  f.update((st) => {
    st.comments.push("approval-2");
    st.metadata["analysis.human_approval"] = JSON.stringify({
      source: f.source, decision: "approved", by: "human", at: "2026-11-08T04:00:00Z",
      comment_ref: "approval-2", verify_agent_required: true,
    });
  });
  const r = f.run({}, "approval-2");
  assert.equal(r.code, 0, JSON.stringify(r));
  assert.equal(r.body.result, "NOOP");
  assert.equal(f.state().metadata["verify_agent.required"], "true");
  assert.equal(f.state().metadata["dev.dispatch"], dispatch, "原派发的任务与批准来源应保持");
  const again = f.run({}, "approval-2");
  assert.equal(again.body.result, "NOOP");
});

test("post-dispatch Human override from required to not_required is supported", (t) => {
  const f = fixture(t, { finalRequired: true });
  assert.equal(f.run().code, 0);
  f.update((st) => {
    st.comments.push("approval-2");
    st.metadata["analysis.human_approval"] = JSON.stringify({
      source: f.source, decision: "approved", by: "human", at: "2026-11-08T04:00:00Z",
      comment_ref: "approval-2", verify_agent_required: false,
    });
  });
  const r = f.run({}, "approval-2");
  assert.equal(r.code, 0, JSON.stringify(r));
  assert.equal(f.state().metadata["verify_agent.required"], "false");
  assert.equal(JSON.parse(f.state().metadata["dev.dispatch"]).length, 1);
});

test("changing the decision with the same old approval comment must fail closed", (t) => {
  const f = fixture(t);
  assert.equal(f.run().code, 0);
  f.update((st) => { st.metadata["analysis.human_approval"] = JSON.stringify({
    source: f.source, decision: "approved", by: "human", at: "2026-11-08T04:00:00Z",
    comment_ref: "approval-1", verify_agent_required: true,
  }); });
  const r = f.run();
  assert.equal(r.code, 3);
  assert.equal(f.state().metadata["verify_agent.required"], "false");
});

test("no new dispatch or NOOP permitted without a valid Analysis Gate PASS", (t) => {
  for (const gate of [undefined, "FAIL", "UNKNOWN"]) {
    const f = fixture(t);
    f.update(st => {
      if (gate === undefined) delete st.metadata["analysis.gate.result"];
      else st.metadata["analysis.gate.result"] = gate;
    });
    const blocked = f.run();
    assert.equal(blocked.code, 2, JSON.stringify(blocked));
    // Sub-Issue activation must not bypass the same Gate admission check.
    const blockedActivate = f.run({}, "approval-1", ["--activate"]);
    assert.equal(blockedActivate.code, 2, JSON.stringify(blockedActivate));
    assert.equal(f.state().metadata["verify_agent.required"], undefined);
    assert.equal(f.state().metadata["dev.dispatch"], undefined);
  }
  const f = fixture(t);
  assert.equal(f.run().code, 0);
  f.update(st => { st.metadata["analysis.gate.result"] = "FAIL"; });
  const blockedNoop = f.run();
  assert.equal(blockedNoop.code, 2);
  assert.equal(JSON.parse(f.state().metadata["dev.dispatch"]).length, 1);
});

test("approval projection rejects missing or malformed human identity and timestamp", (t) => {
  for (const malformed of [
    { decision: "approved", at: "2026-11-08T04:00:00Z", comment_ref: "approval-1", verify_agent_required: false },
    { decision: "approved", by: "human", at: "yesterday", comment_ref: "approval-1", verify_agent_required: false },
  ]) {
    const f = fixture(t);
    f.update(st => { st.metadata["analysis.human_approval"] = JSON.stringify(malformed); });
    assert.equal(f.run().code, 3);
    assert.equal(f.state().metadata["dev.dispatch"], undefined);
  }
});

test("派发只读远端已批准任务，本地 tasks.md 修改或删除不改变分工依据", t => {
  const f = fixture(t);
  writeFileSync(join(f.root, "openspec", "changes", "fix-101", "tasks.md"), "- [ ] 9.9 未批准任务\n");
  const first = f.run();
  assert.equal(first.code, 0, JSON.stringify(first));
  assert.deepEqual(first.body.dispatch.analysis_source, f.source);
  rmSync(join(f.root, "openspec"), { recursive: true });
  assert.equal(f.run().body.result, "NOOP");
  assert.equal(f.run({}, "approval-1", ["--task-refs", "9.9"]).code, 2);
});

test("新分析不能复用旧批准；同 key 新版本不能 NOOP 或激活旧派发", t => {
  const f = fixture(t);
  assert.equal(f.run().code, 0);
  const dispatch = f.state().metadata["dev.dispatch"];
  const newer = { ...f.source, commit: "b".repeat(40) };
  f.tfs.update(s => { s.versions[newer.commit] = { "/openspec/changes/fix-101/tasks.md": "- [ ] 1.1 新任务\n" }; });
  f.update(s => { s.metadata["analysis.source"] = JSON.stringify(newer); });
  assert.equal(f.run().code, 3);
  f.update(s => {
    const approval = JSON.parse(s.metadata["analysis.human_approval"]);
    approval.source = newer;
    s.metadata["analysis.human_approval"] = JSON.stringify(approval);
  });
  assert.equal(f.run().code, 3);
  assert.equal(f.run({}, "approval-1", ["--activate"]).code, 3);
  assert.equal(f.state().metadata["dev.dispatch"], dispatch);
});

test("缺失来源或重复任务编号时零派发写入", t => {
  const f = fixture(t);
  f.update(s => { delete s.metadata["analysis.source"]; });
  assert.equal(f.run().code, 3);
  f.update(s => { s.metadata["analysis.source"] = JSON.stringify(f.source); });
  f.tfs.update(s => { s.versions[f.source.commit]["/openspec/changes/fix-101/tasks.md"] = "- [ ] 1.1 A\n- [ ] 1.1 B\n"; });
  assert.equal(f.run().code, 2);
  assert.equal(f.state().metadata["dev.dispatch"], undefined);
  assert.equal(f.state().metadata["verify_agent.required"], undefined);
});

test("读取后来源并发变化，写入前回读阻止派发", t => {
  const f = fixture(t);
  const result = f.run({ MOCK_VERIFY_DRIFT_ON_AGENT: "1" });
  assert.equal(result.code, 3, JSON.stringify(result));
  assert.match(result.body.reason, /source 已变化/);
  assert.equal(f.state().metadata["dev.dispatch"], undefined);
  assert.equal(f.state().metadata["verify_agent.required"], undefined);
});
