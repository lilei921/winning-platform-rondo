import test from "node:test";
import assert from "node:assert/strict";
import {
  assertBugFinalizationFacts, isDirectBugDelivery, bugDeliveryDigest, assertMergedBugSource,
} from "../dist/commands/bug/finalize-facts.js";

function fixture() {
  const sha = "a".repeat(40);
  const prs = [{ repo_key: "frame-web", pr_id: 12, pr_url: "https://example.test/pr/12",
                 source_branch: "feature/123", target_branch: "main" }];
  const bug = [{
    repo_key: "frame-web", tfs_id: 123, source_branch: "feature/123", target_branch: "main",
    candidate_commit: sha, expected_behavior: "返回列表", actual_behavior: "请求失败",
    fix_summary: "修复空值分支",
    root_cause: { confidence: "confirmed", summary: "空指针", evidence_refs: ["trace:1"] },
    regression: { result: "PASS", summary: "回归用例通过", evidence_refs: ["ci:1"] },
    local_validation: { result: "PASS", summary: "编译通过", evidence_refs: ["ci:2"] },
    code_review: { result: "PASS", summary: "无 Blocking Finding", evidence_refs: ["review:1"], findings: [] },
  }];
  const prep = [{
    repo_key: "frame-web", candidate_commit: sha, title: "fix: null case",
    source_branch: "feature/123", target_branch: "main", description_ref: "file:/tmp/pr.md",
  }];
  const md = {
    "tfs.type": "Bug", "tfs.id": "123",
    "bug.required_repos": JSON.stringify(["frame-web"]),
    "bug.delivery": JSON.stringify(bug),
    "pr_prep": JSON.stringify(prep),
    "current_pr": JSON.stringify(prs),
  };
  return { md, prs, bug, prep };
}

test("direct Bug delivery has no OpenSpec dependency", () => {
  const { md, prs } = fixture();
  assert.equal(isDirectBugDelivery(md), true);
  assert.doesNotThrow(() => assertBugFinalizationFacts(md, "in_review", prs));
  assert.match(bugDeliveryDigest(md), /^[a-f0-9]{64}$/);
  assert.equal(bugDeliveryDigest(md), bugDeliveryDigest({ ...md, "analysis.change_kind": "corrective" }));
});

test("Bug delivery fails when a PR is not covered or candidate differs", () => {
  const { md, prs, bug } = fixture();
  const conflicting = { ...md, "bug.delivery": JSON.stringify([{ ...bug[0], candidate_commit: "b".repeat(40) }]) };
  assert.throws(() => assertBugFinalizationFacts(conflicting, "in_review", prs), /候选身份不一致|Candidate Commit/);
  assert.throws(() => assertBugFinalizationFacts(md, "in_review", [...prs, { ...prs[0], repo_key: "another" }]), /数量不一致|未覆盖全部/);
});

test("blocking review findings, explicit verification and blocked issue fail closed", () => {
  const { md, prs, bug } = fixture();
  const bad = { ...bug[0], code_review: { ...bug[0].code_review, findings: [{ blocking: true, resolved: false }] } };
  assert.throws(() => assertBugFinalizationFacts({ ...md, "bug.delivery": JSON.stringify([bad]) }, "in_review", prs), /Code Review/);
  assert.throws(() => assertBugFinalizationFacts(md, "blocked", prs), /blocked/);
  assert.throws(() => assertBugFinalizationFacts({ ...md, "verify_agent.required": "true" }, "in_review", prs), /Independent Verification/);
});

test("finalize blocks if required Bug repositories have changed after PR readiness", () => {
  const { md, prs } = fixture();
  const stale = { ...md, "bug.required_repos": JSON.stringify(["frame","frame-web"]) };
  assert.throws(() => assertBugFinalizationFacts(stale, "in_review", prs), /准备不完整/);
  assert.notEqual(bugDeliveryDigest(md), bugDeliveryDigest(stale));
});

test("prepare digest detects modification to committed Bug evidence", () => {
  const { md, bug } = fixture();
  const before = bugDeliveryDigest(md);
  const after = bugDeliveryDigest({ ...md, "bug.delivery": JSON.stringify([{ ...bug[0], fix_summary: "different fix" }]) });
  assert.notEqual(before, after);
});

test("OpenSpec Bug remains on existing Change-based path", () => {
  const { md } = fixture();
  assert.equal(isDirectBugDelivery({ ...md, "analysis.change_ref": "fix-123" }), false);
});

test("merged PR must point to the exact candidate verified by Bug Agent", () => {
  const expected = "a".repeat(40);
  assert.doesNotThrow(() => assertMergedBugSource("frame", expected, expected));
  assert.throws(() => assertMergedBugSource("frame", "b".repeat(40), expected), /禁止 TFS Writeback/);
  assert.throws(() => assertMergedBugSource("frame", null, expected), /禁止 TFS Writeback/);
});
