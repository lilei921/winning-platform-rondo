import test from "node:test";
import assert from "node:assert/strict";
import { assertRequirementPrepareGate } from "./requirement-mode.js";

function caseFixture(t: { after: (fn: () => void) => void }, analyst: string, human: boolean) {
  const source = { repo_url: "http://tfs.test/tfs/C/P/_git/root", branch: "main", commit: "a".repeat(40), change_ref: "c-x" };
  const metadata = {
    "analysis.source": JSON.stringify(source),
    "analysis.change_ref": "c-x",
    "analysis.gate.result": "PASS",
    "analysis.verify_agent.recommendation": analyst,
    "analysis.human_approval": JSON.stringify({
      source, decision: "approved", by: "human", at: "2026-11-08T00:00:00Z",
      comment_ref: "approval-1", verify_agent_required: human,
    }),
    "verify_agent.required": String(human),
  };
  const check = (values = metadata) =>
    assertRequirementPrepareGate(values, "in_review");
  return { metadata, check };
}

test("Human override required -> not_required: original Analyst recommendation does not block completion", (t) => {
  const f = caseFixture(t, "required", false);
  assert.doesNotThrow(() => f.check());
});

test("Human override not_required -> required: blocks until actual independent validation is available", (t) => {
  const f = caseFixture(t, "not_required", true);
  assert.throws(() => f.check(), /Independent Verification PASS/);
});

test("missing or inconsistent effective Verify fact blocks before any completion decision", (t) => {
  const f = caseFixture(t, "not_required", false);
  assert.throws(() => f.check({ ...f.metadata, "verify_agent.required": "" }), /verify_agent.required/);
  assert.throws(() => f.check({ ...f.metadata, "verify_agent.required": "true" }), /不一致/);
  assert.throws(() => f.check({ ...f.metadata, "analysis.human_approval": "{}" }), /尚未批准/);
});
