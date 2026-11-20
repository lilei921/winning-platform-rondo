import test from "node:test";
import assert from "node:assert/strict";
import { estimateIssue, parseEstimate, stripEstimateTail, truncateTitleText } from "../dist/commands/tfs/materialize-tasks.js";

test("D3-B: engineering task without a TFS estimate is valid input", () => {
  const text = "Implement API and verify access control";
  assert.equal(estimateIssue(text), null);
  assert.equal(parseEstimate(text), null);
  assert.equal(stripEstimateTail(text), text);
});

test("D3-B: legacy estimate remains optional and strips cleanly", () => {
  const text = "Implement API and verify access control [预估: 3.5h]";
  assert.equal(estimateIssue(text), null);
  assert.equal(parseEstimate(text), 3.5);
  assert.equal(stripEstimateTail(text), "Implement API and verify access control");
});

test("D3-B: engineering Task is not forced to split by historical six-hour limit", () => {
  assert.equal(estimateIssue("Refactor migration [预估: 8h]"), null);
  assert.equal(parseEstimate("Refactor migration [预估: 8h]"), 8);
});

test("D3-B: malformed explicitly supplied estimate is rejected, not fabricated", () => {
  assert.match(estimateIssue("Implement API [预估: unknown]"), /格式非法/);
  assert.match(estimateIssue("Implement API [预估: 0h]"), /非法/);
  assert.equal(parseEstimate("Implement API [预估: 0h]"), null);
  assert.equal(parseEstimate("Implement API [预估: unknown]"), null);
});

test("D3-B: TFS title remains bounded independent of optional estimates", () => {
  const text = "x".repeat(100);
  assert.equal(truncateTitleText(text), "x".repeat(80) + "…");
});
