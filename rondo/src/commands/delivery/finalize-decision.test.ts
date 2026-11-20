import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeContractFiles } from "./contract-files.js";
import { deliveryCompletionGate } from "./finalize.js";

function caseFixture(t: { after: (fn: () => void) => void }, analyst: string, human: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "rondo-finalize-verify-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "tasks.md"), "- [x] 1.1 Verified by Engineer\n");
  writeFileSync(join(dir, "proposal.md"), "# 当前提案\n");
  writeFileSync(join(dir, "evidence.json"), JSON.stringify({ change_ref: "c-x", task_refs: ["1.1"], contract_files: computeContractFiles(dir) }));
  const metadata = {
    "dev.dispatch": JSON.stringify([{ active: true, change_ref: "c-x", task_refs: ["1.1"] }]),
    "analysis.gate.result": "PASS",
    "analysis.verify_agent.recommendation": analyst,
    "analysis.human_approval": JSON.stringify({
      decision: "approved", by: "human", at: "2026-11-08T00:00:00Z",
      comment_ref: "approval-1", verify_agent_required: human,
    }),
    "verify_agent.required": String(human),
  };
  const check = (values = metadata) =>
    deliveryCompletionGate({} as never, values, "in_review", dir, "c-x");
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
