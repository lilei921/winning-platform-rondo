import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classifyProviderStatus, collectStatusPages, processIssue } from "../dist/commands/pr/reconcile-status.js";

test("PR provider status classification only accepts known statuses", () => {
  assert.equal(classifyProviderStatus("active"), "active");
  assert.equal(classifyProviderStatus("completed"), "completed");
  assert.equal(classifyProviderStatus("abandoned"), "abandoned");
  for (const value of ["draft", "unknown", "COMPLETED", "", null, undefined, 0]) {
    assert.equal(classifyProviderStatus(value), "unknown");
  }
});

test("array-form issue list continues past a full 100-item page", () => {
  const firstPage = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }));
  const offsets = [];
  const results = collectStatusPages((offset, limit) => {
    offsets.push([offset, limit]);
    return offset === 0 ? firstPage : [{ id: "last" }];
  });
  assert.equal(results.length, 101);
  assert.deepEqual(offsets, [[0, 100], [100, 100]]);
});

test("object-form issue list honors has_more and stops on the last page", () => {
  const offsets = [];
  const results = collectStatusPages((offset) => {
    offsets.push(offset);
    return offset === 0
      ? { issues: [{ id: "a" }], has_more: true }
      : { issues: [{ id: "b" }], has_more: false };
  });
  assert.deepEqual(results.map((x) => x.id), ["a", "b"]);
  assert.deepEqual(offsets, [0, 1]);
});

function fixture(status, metadata = {}) {
  const calls = [];
  const multica = {
    setMetadata: (...args) => calls.push(["metadata", ...args]),
    setStatus: (...args) => calls.push(["status", ...args]),
  };
  const cfg = {
    runtime: {},
    registry: { repo: { tfs_repo: "remote", tfs_project: "project" } },
  };
  const pr = {
    repo_key: "repo",
    pr_id: 42,
    pr_url: "https://example.invalid/pr/42",
    source_branch: "feature/a",
    target_branch: "dev",
  };
  const issue = {
    id: "issue-id",
    identifier: "DF-1",
    status,
    assignee_id: "engineer",
    metadata: { current_pr: JSON.stringify([pr]), ...metadata },
  };
  return { calls, multica, cfg, pr, issue };
}

test("done without pending is skipped without PR lookup or writes", async () => {
  const f = fixture("done");
  const action = await processIssue(f.multica, f.cfg, f.issue, { attempts: 0, successes: 0 }, () => {
    throw new Error("unexpected PR lookup");
  });
  assert.equal(action, null);
  assert.deepEqual(f.calls, []);
});

test("done with pending only requests finalize recovery and never reopens issue", async () => {
  const f = fixture("done", { "finalize.pending": "{}" });
  const action = await processIssue(f.multica, f.cfg, f.issue, { attempts: 0, successes: 0 }, () => {
    throw new Error("unexpected PR lookup");
  });
  assert.equal(action.action, "resume_finalize");
  assert.deepEqual(f.calls, []);
});

test("unknown PR status does not write completion facts", async () => {
  const f = fixture("in_review");
  const action = await processIssue(f.multica, f.cfg, f.issue, { attempts: 0, successes: 0 }, () => ({
    status: "ok",
    pr: { status: "draft", sourceBranch: "feature/a", targetBranch: "dev" },
  }));
  assert.equal(action.action, "unknown");
  assert.deepEqual(f.calls, []);
});

test("completed PR marks pending, and active PR is a no-op", async () => {
  const f = fixture("in_review");
  const lookup = (status) => () => ({
    status: "ok",
    pr: { status, sourceBranch: "feature/a", targetBranch: "dev" },
  });
  const complete = await processIssue(f.multica, f.cfg, f.issue, { attempts: 0, successes: 0 }, lookup("completed"));
  assert.equal(complete.action, "finalize");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][1], "issue-id");
  assert.equal(f.calls[0][2], "finalize.pending");
  assert.deepEqual(JSON.parse(f.calls[0][3]).event_keys, ["DF-1#repo#42#completed"]);

  f.calls.length = 0;
  const active = await processIssue(f.multica, f.cfg, f.issue, { attempts: 0, successes: 0 }, lookup("active"));
  assert.equal(active.action, "noop");
  assert.deepEqual(f.calls, []);
});

test("new abandoned PR blocks without reassigning Issue or requiring delivery_squad_id", async () => {
  for (const owner of ["delivery-squad", "bug-fix-agent"]) {
    const f = fixture("in_review");
    f.issue.assignee_id = owner;
    const action = await processIssue(f.multica, f.cfg, f.issue, { attempts: 0, successes: 0 }, () => ({
      status: "ok",
      pr: { status: "abandoned", sourceBranch: "feature/a", targetBranch: "dev" },
    }));
    assert.equal(action.action, "stopped_abandoned");
    assert.deepEqual(f.calls.map((call) => call[0]), ["metadata", "status"]);
    assert.equal(f.calls[0][2], "pr.abandoned");
    assert.deepEqual(f.calls[1], ["status", "issue-id", "blocked"]);
    assert.equal(f.issue.assignee_id, owner);
  }
});

test("repeated abandoned event preserves human-updated status and assignment", async () => {
  const event_key = "DF-1#repo#42#abandoned";
  const f = fixture("in_progress", {
    "pr.abandoned": JSON.stringify([{ repo_key: "repo", pr_id: 42, event_key, detected_at: "2026-11-03T00:00:00Z" }]),
  });
  const action = await processIssue(f.multica, f.cfg, f.issue, { attempts: 0, successes: 0 }, () => ({
    status: "ok",
    pr: { status: "abandoned", sourceBranch: "feature/a", targetBranch: "dev" },
  }));
  assert.equal(action.action, "stopped_abandoned");
  assert.match(action.detail, /already_stopped/);
  assert.deepEqual(f.calls, []);
});

test("recovery scan and one-issue mode cannot be combined", () => {
  const proc = spawnSync(process.execPath, [
    fileURLToPath(new URL("../dist/index.js", import.meta.url)),
    "pr", "reconcile-status",
    "--config", "not-read.json",
    "--issue", "DF-1",
    "--recover-done",
  ], { encoding: "utf8" });
  assert.equal(proc.status, 64);
  assert.match(proc.stderr, /不可同时使用/);
});
