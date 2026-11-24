import test from "node:test";
import assert from "node:assert/strict";
import { candidateBranch } from "./candidate-branch.js";

test("Candidate branch is independent of TFS business type", () => {
  assert.equal(candidateBranch(42), "feature/42");
  assert.equal(candidateBranch("42"), "feature/42");
  for (const invalid of [0, -1, 1.5, "", "bad", "1e2", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => candidateBranch(invalid), /TFS ID/);
  }
});
