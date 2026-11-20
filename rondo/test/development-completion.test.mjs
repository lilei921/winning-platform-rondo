import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { computeContractFiles } from "../dist/commands/delivery/contract-files.js";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const SHA = "a".repeat(40);
function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", env: { ...process.env, ...env },
  });
  assert.equal(result.error, undefined, result.error?.message);
  let body;
  try { body = JSON.parse(result.stdout); }
  catch { assert.fail("CLI did not produce JSON: " + result.stdout + "\n" + result.stderr); }
  return { exit: result.status, body };
}
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "skill-flow-minimal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, "root");
  const change = join(root, "openspec", "changes", "sample");
  mkdirSync(change, { recursive: true });
  const tasksPath = join(change, "tasks.md");
  writeFileSync(join(change, "proposal.md"), "# Corrective proposal\n");
  writeFileSync(tasksPath, "- [ ] 1.1 Implement and verify\n");
  const evidencePath = join(change, "evidence-dev.json");
  const evidence = {
    change_ref: "sample", task_refs: ["1.1"],
    local_validation: { result: "PASS", summary: "focused test exit 0", evidence_refs: ["logs/test.log"] },
    code_review: { result: "PASS", findings: [] },
    commits: [{ repo_path: root, branch: "feat/123", sha: SHA }],
    pr_preparation: { required: false, reason_if_not_required: "test fixture" }, blockers: [],
    contract_files: computeContractFiles(change),
  };
  const save = () => writeFileSync(evidencePath, JSON.stringify(evidence));
  const check = () => runCli(["dev", "check-completion", "--openspec-root", root,
    "--change-ref", "sample", "--task-refs", "1.1", "--evidence", evidencePath]);
  save();
  return { dir, root, tasksPath, evidence, save, check };
}

test("Check PASS precedes Patch; missing/duplicate/invalid Task identities fail", (t) => {
  const f = fixture(t);
  assert.equal(f.check().body.result, "PASS");
  assert.match(readFileSync(f.tasksPath, "utf8"), /- \[ \] 1\.1/);
  const patched = runCli(["change", "update-progress", "--openspec-root", f.root,
    "--change-ref", "sample", "--check", "1.1"]);
  assert.equal(patched.body.result, "UPDATED");
  assert.match(readFileSync(f.tasksPath, "utf8"), /- \[x\] 1\.1/);
  assert.equal(f.check().body.result, "PASS");
  for (const invalid of ["- [ ] 1.2 Wrong\n", "- [ ] 1.1 A\n- [x] 1.1 B\n", "- [-] 1.1 Invalid\n"]) {
    writeFileSync(f.tasksPath, invalid);
    assert.equal(f.check().body.result, "FAIL");
  }
});

test("Review blocks unresolved blocking Findings, permits documented non-blocking risk", (t) => {
  const f = fixture(t);
  f.evidence.code_review.findings = [{ resolved: false, blocking: false, risk_note: "Low risk; no acceptance impact" }];
  f.save();
  assert.equal(f.check().body.result, "PASS");
  f.evidence.code_review.findings = [{ resolved: false, blocking: false }];
  f.save();
  assert.equal(f.check().body.result, "FAIL");
  f.evidence.code_review.findings = [{ resolved: false, blocking: true, risk_note: "Recorded" }];
  f.save();
  assert.equal(f.check().body.result, "FAIL");
});

test("Dispatch matches Change and Engineer and rejects overlapping conflicting owners", (t) => {
  const f = fixture(t);
  const mock = join(f.dir, "multica-mock");
  writeFileSync(mock, "#!/usr/bin/env node\nprocess.stdout.write(process.env.MOCK_ISSUE || '{}');\n");
  chmodSync(mock, 0o755);
  const config = join(f.dir, "registry.json");
  writeFileSync(config, JSON.stringify({ runtime: { multica_cli: mock, tfs_cli: [] } }));
  const dispatch = { task_refs: ["1.1"], change_ref: "sample", engineer_id: "agent-a", active: true };
  const issue = { project_id: "project1", metadata: {
    "tfs.type": "Bug", "tfs.id": "123", "dev.dispatch": JSON.stringify([dispatch]),
  } };
  const run = (change, agent, data = issue) => runCli(["dev", "check-dispatch", "--config", config,
    "--issue", "DEL-1", "--task-refs", "1.1", "--change-ref", change, "--engineer-id", agent],
    { MOCK_ISSUE: JSON.stringify(data) });
  assert.equal(run("sample", "agent-a").body.result, "PASS");
  assert.equal(run("other", "agent-a").body.result, "FAIL");
  assert.equal(run("sample", "agent-b").body.result, "FAIL");
  const collision = { ...issue, metadata: { ...issue.metadata,
    "dev.dispatch": JSON.stringify([dispatch, { ...dispatch, engineer_id: "agent-b" }]) } };
  assert.equal(run("sample", "agent-a", collision).body.result, "FAIL");
});
