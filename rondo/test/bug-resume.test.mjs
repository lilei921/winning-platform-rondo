import test from "node:test";
import assert from "node:assert/strict";
import { assertAbandonedBugSet } from "../dist/commands/bug/resume.js";

const prs = [{
  repo_key: "frame", pr_id: 1001, pr_url: "https://example.test/1001",
  source_branch: "feature/123", target_branch: "main",
}];
const abandoned = [{repo_key: "frame", pr_id: 1001, event_key: "MUL-123#frame#1001#abandoned"}];

test("Human recovery only accepts exact abandoned PR identity", () => {
  assert.deepEqual(assertAbandonedBugSet(prs, abandoned), ["MUL-123#frame#1001#abandoned"]);
  assert.throws(() => assertAbandonedBugSet(prs, []), /缺少当前 PR/);
  assert.throws(() => assertAbandonedBugSet(prs, [{...abandoned[0], pr_id: 1002}]), /尚未确认 abandoned/);
});

test("Mixed active or completed PR set is not automatically reset", () => {
  assert.throws(() => assertAbandonedBugSet([...prs, {...prs[0], repo_key: "frame-web", pr_id: 1003}], abandoned),
    /尚未确认 abandoned/);
});

test("Invalid duplicate identities fail before recovery", () => {
  assert.throws(() => assertAbandonedBugSet([...prs, prs[0]], abandoned), /重复 repo_key/);
});
