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
    repo_key: "frame-web", source_branch: "feature/123", target_branch: "main",
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
    pr: JSON.stringify([{...prep[0], ...bug[0], ...prs[0], repo_url:"https://example.test/tfs/C/P/_git/frame-web"}]),
  };
  return { md, records: JSON.parse(md.pr) };
}

test("direct Bug delivery has no OpenSpec dependency", () => {
  const { md } = fixture();
  assert.equal(isDirectBugDelivery(md), true);
  assert.doesNotThrow(() => assertBugFinalizationFacts(md, "in_review"));
  assert.match(bugDeliveryDigest(md), /^[a-f0-9]{64}$/);
  assert.equal(bugDeliveryDigest(md), bugDeliveryDigest({ ...md, "analysis.change_kind": "corrective" }));
});

test("Bug delivery rejects missing registration or an additional repository", () => {
  const { md, records } = fixture();
  const {pr_id,pr_url,...prepared}=records[0];
  assert.throws(()=>assertBugFinalizationFacts({...md,pr:JSON.stringify([prepared])},"in_review"),/未登记全部/);
  assert.throws(()=>assertBugFinalizationFacts({...md,pr:JSON.stringify([...records,{...records[0],repo_key:"another"}])},"in_review"),/准备不完整/);
});

test("blocking review findings, explicit verification and blocked issue fail closed", () => {
  const { md, records } = fixture();
  const bad = { ...records[0], code_review: { ...records[0].code_review, findings: [{ blocking: true, resolved: false }] } };
  assert.throws(() => assertBugFinalizationFacts({ ...md, pr: JSON.stringify([bad]) }, "in_review"), /Blocking Finding/);
  assert.throws(() => assertBugFinalizationFacts(md, "blocked"), /blocked/);
  assert.throws(() => assertBugFinalizationFacts({ ...md, "verify_agent.required": "true" }, "in_review"), /Independent Verification/);
});

test("finalize blocks if required Bug repositories have changed after PR readiness", () => {
  const { md } = fixture();
  const stale = { ...md, "bug.required_repos": JSON.stringify(["frame","frame-web"]) };
  assert.throws(() => assertBugFinalizationFacts(stale, "in_review"), /准备不完整/);
  assert.notEqual(bugDeliveryDigest(md), bugDeliveryDigest(stale));
});

test("prepare digest detects modification to committed Bug evidence", () => {
  const { md, records } = fixture();
  const before = bugDeliveryDigest(md);
  const after = bugDeliveryDigest({ ...md, pr: JSON.stringify([{ ...records[0], fix_summary: "different fix" }]) });
  assert.notEqual(before, after);
});

test("OpenSpec Bug remains on existing Change-based path", () => {
  const { md } = fixture();
  assert.equal(isDirectBugDelivery({ ...md, "analysis.source": "{}" }), false);
});

test("merged PR must point to the exact candidate verified by Bug Agent", () => {
  const expected = "a".repeat(40);
  assert.doesNotThrow(() => assertMergedBugSource("frame", expected, expected));
  assert.throws(() => assertMergedBugSource("frame", "b".repeat(40), expected), /禁止 TFS Writeback/);
  assert.throws(() => assertMergedBugSource("frame", null, expected), /禁止 TFS Writeback/);
});
