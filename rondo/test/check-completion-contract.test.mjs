/**
 * Minimal regression for F3: Engineer Completion must check contract_files
 * before PR/Finalize, with the same digest rules used by Finalize.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { computeContractFiles } from "../dist/commands/delivery/contract-files.js";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "rondo-check-contract-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const changeRef = "minimal-contract-test";
  const dir = join(root, "openspec", "changes", changeRef);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "proposal.md"), "# Corrective proposal\n", "utf8");
  writeFileSync(join(dir, "tasks.md"), "- [ ] 1.1 Implement fix\n", "utf8");
  const binding = computeContractFiles(dir);
  const evidence = {
    change_ref: changeRef,
    task_refs: ["1.1"],
    local_validation: { result: "PASS", summary: "verified" },
    code_review: { result: "PASS", findings: [] },
    commits: [{ sha: "abcdef0123456789", branch: "feature" }],
    pr_preparation: { required: false, reason_if_not_required: "test" },
    blockers: [],
    contract_files: binding,
  };
  const run = (updatedEvidence) => {
    const evidencePath = join(root, "evidence.json");
    writeFileSync(evidencePath, JSON.stringify(updatedEvidence), "utf8");
    const cp = spawnSync(process.execPath, [CLI, "dev", "check-completion",
      "--openspec-root", root, "--change-ref", changeRef, "--task-refs", "1.1",
      "--evidence", evidencePath], { encoding: "utf8" });
    assert.equal(cp.error, undefined, cp.error?.message);
    let result;
    try { result = JSON.parse(cp.stdout); }
    catch { assert.fail(`check-completion did not emit JSON: ${cp.stdout}\n${cp.stderr}`); }
    return { exit: cp.status, result };
  };
  return { evidence, run };
}

test("F3: current contract hash passes Engineer Completion", (t) => {
  const f = fixture(t);
  const r = f.run(f.evidence);
  assert.equal(r.exit, 0, JSON.stringify(r.result));
  assert.equal(r.result.result, "PASS");
  assert.equal(r.result.checks.find((c) => c.name === "contract_binding")?.result, "PASS");
});

test("F3: missing contract_files is caught before Finalize", (t) => {
  const f = fixture(t);
  const { contract_files, ...withoutBinding } = f.evidence;
  const r = f.run(withoutBinding);
  assert.equal(r.exit, 3, JSON.stringify(r.result));
  assert.equal(r.result.checks.find((c) => c.name === "contract_binding")?.result, "UNKNOWN");
});

test("F3: stale contract hash fails Engineer Completion", (t) => {
  const f = fixture(t);
  const old = { ...f.evidence, contract_files: {
    ...f.evidence.contract_files,
    files: { ...f.evidence.contract_files.files, "proposal.md": "0".repeat(64) },
  } };
  const r = f.run(old);
  assert.equal(r.exit, 2, JSON.stringify(r.result));
  assert.equal(r.result.checks.find((c) => c.name === "contract_binding")?.result, "FAIL");
});
