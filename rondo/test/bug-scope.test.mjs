import test from "node:test";
import assert from "node:assert/strict";
import { assertBugReadyForPr, assertBugAgentAssignment, requiredBugRepos } from "../dist/commands/bug/scope.js";

function valid() {
  const id = 123, sha = "a".repeat(40);
  const mk = (repo_key) => ({
    repo_key, tfs_id: id, candidate_commit: sha,
    source_branch: "feature/" + id, target_branch: "main",
  });
  return {
    "tfs.type": "Bug", "tfs.id": String(id),
    "bug.required_repos": JSON.stringify(["frame","frame-web"]),
    "bug.delivery": JSON.stringify([mk("frame-web"),mk("frame")]),
    pr_prep: JSON.stringify([mk("frame"),mk("frame-web")]),
  };
}

test("Bug PR gate accepts an exact multi-repo scope irrespective of entry order", () => {
  assert.deepEqual(assertBugReadyForPr(valid()), ["frame","frame-web"]);
});

test("Bug PR gate blocks incomplete preparation before any PR is created", () => {
  const md = valid();
  md.pr_prep = JSON.stringify(JSON.parse(md.pr_prep).slice(0,1));
  assert.throws(() => assertBugReadyForPr(md), /准备不完整/);
});

test("Bug PR gate rejects a failed validation without losing the repository scope", () => {
  const md = valid();
  const ev=JSON.parse(md["bug.delivery"]);
  ev[0].local_validation={result:"FAIL"};
  md["bug.delivery"]=JSON.stringify(ev);
  assert.throws(()=>assertBugReadyForPr(md),/验证失败/);
  ev[0].local_validation.result="PASS";
  md["bug.delivery"]=JSON.stringify(ev);
  assert.deepEqual(assertBugReadyForPr(md),["frame","frame-web"]);
});

test("Bug PR gate rejects unregistered, changed or duplicate repository scope", () => {
  assert.throws(() => requiredBugRepos(JSON.stringify(["frame","frame"])), /无重复/);
  assert.throws(() => requiredBugRepos(JSON.stringify(["../other"])), /非法/);
  const md = valid(); const ev=JSON.parse(md["bug.delivery"]);
  ev[0].candidate_commit="b".repeat(40);
  md["bug.delivery"]=JSON.stringify(ev);
  assert.throws(() => assertBugReadyForPr(md), /候选身份不一致/);
});

test("Direct Bug preparation must verify native Agent assignment", () => {
  const agents=[{id:"bug-uuid",name:"Bug Fix Agent"},{id:"other",name:"Workitem Analyst"}];
  assert.doesNotThrow(()=>assertBugAgentAssignment("bug-uuid",agents));
  assert.throws(()=>assertBugAgentAssignment("other",agents),/未有效指派/);
  assert.throws(()=>assertBugAgentAssignment(null,agents),/未有效指派/);
  assert.throws(()=>assertBugAgentAssignment("bug-uuid",[]),/缺少唯一/);
  assert.throws(()=>assertBugAgentAssignment("bug-uuid",[...agents,agents[0]]),/缺少唯一/);
});


test("Bug gate rejects the retired candidate branch even when all facts match", () => {
  const md = valid();
  for (const key of ["pr_prep", "bug.delivery"]) {
    md[key] = JSON.stringify(JSON.parse(md[key]).map(entry => ({ ...entry, source_branch: "feat/123" })));
  }
  assert.throws(() => assertBugReadyForPr(md), /候选身份不一致/);
});
