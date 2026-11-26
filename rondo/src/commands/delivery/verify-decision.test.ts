import test from "node:test";
import assert from "node:assert/strict";
import { readApprovedVerifyDecision } from "./verify-decision.js";

const source = { repo_url: "https://tfs.example/tfs/C/P/_git/R", branch: "dev", commit: "a".repeat(40), change_ref: "fix-1" };
const md = (recommended: string, approved: boolean, required = approved, comment = "comment-1"): Record<string, string> => ({
  "analysis.verify_agent.recommendation": recommended,
  "analysis.source": JSON.stringify(source),
  "analysis.human_approval": JSON.stringify({
    decision: "approved", by: "human", at: "2026-11-08T00:00:00Z",
    comment_ref: comment, verify_agent_required: approved, source,
  }),
  "verify_agent.required": String(required),
});

test("Human overrides Analyst required to not_required without a Verify Run", () => {
  assert.equal(readApprovedVerifyDecision(md("required", false), "comment-1").required, false);
});

test("Human overrides Analyst not_required to required; final fact must be true", () => {
  assert.equal(readApprovedVerifyDecision(md("not_required", true), "comment-1").required, true);
});

test("matches recommendation when Human accepts it", () => {
  assert.equal(readApprovedVerifyDecision(md("not_required", false)).required, false);
  assert.equal(readApprovedVerifyDecision(md("required", true)).required, true);
});

test("missing final fact never falls back to Analyst Recommendation", () => {
  const input = md("not_required", false);
  delete input["verify_agent.required"];
  assert.equal(readApprovedVerifyDecision(input).required, false);
});

test("missing, malformed or non-Boolean Human decision is never defaulted", () => {
  for (const approval of [undefined, "invalid", "{}", JSON.stringify({
    decision: "approved", comment_ref: "comment-1", verify_agent_required: "false",
  })]) {
    const input = md("not_required", false);
    if (approval === undefined) delete input["analysis.human_approval"];
    else input["analysis.human_approval"] = approval;
    assert.throws(() => readApprovedVerifyDecision(input));
  }
});

test("approval decision and comment source are mandatory", () => {
  assert.throws(() => readApprovedVerifyDecision(md("required", true, true, "other"), "comment-1"), /评论/);
  const input = md("not_required", false);
  input["analysis.human_approval"] = JSON.stringify({ decision: "rejected", comment_ref: "comment-1", verify_agent_required: false });
  assert.throws(() => readApprovedVerifyDecision(input), /尚未批准/);
});

test("Requirement decision does not depend on an independent projection", () => {
  assert.equal(readApprovedVerifyDecision(md("required", false, true)).required, false);
  const input = md("not_required", false);
  input["verify_agent.required"] = "0";
  assert.equal(readApprovedVerifyDecision(input).required, false);
});

test("approval must match the current fixed source", () => {
  const input = md("not_required", false);
  const approval = JSON.parse(input["analysis.human_approval"]);
  delete input["analysis.source"];
  assert.throws(() => readApprovedVerifyDecision(input), /source/);
  input["analysis.source"] = JSON.stringify(source);
  input["analysis.human_approval"] = JSON.stringify({...approval, source: {...source, commit: "b".repeat(40)}});
  assert.throws(() => readApprovedVerifyDecision(input), /不一致/);
});

test("waivers are version-bound; missing means empty and malformed metadata fails closed", () => {
  const source = {repo_url:"https://tfs.example/tfs/C/P/_git/R",branch:"dev",commit:"a".repeat(40),change_ref:"fix-1"};
  const input=md("not_required",false);
  assert.deepEqual(readApprovedVerifyDecision(input).waivedTasks,[]);
  const approval=JSON.parse(input["analysis.human_approval"]);
  input["analysis.human_approval"]=JSON.stringify({...approval,source:undefined,waived_tasks:["3.1"]});
  assert.throws(()=>readApprovedVerifyDecision(input),/Source/);
  input["analysis.source"]=JSON.stringify(source);
  for(const waived_tasks of [null,"3.1",["3.1","3.1"],["bad"],[3.1]]) {
    input["analysis.human_approval"]=JSON.stringify({...approval,source,waived_tasks});
    assert.throws(()=>readApprovedVerifyDecision(input),/waived_tasks/);
  }
  input["analysis.human_approval"]=JSON.stringify({...approval,source,waived_tasks:["3.2","3.1"]});
  assert.deepEqual(readApprovedVerifyDecision(input).waivedTasks,["3.1","3.2"]);
  assert.equal(readApprovedVerifyDecision(input).required,false);
});
