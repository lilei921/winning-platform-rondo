import { spawnOpenspec } from "./helpers/openspec.mjs";
import { changeEvidenceDigest, metadataEvidenceDigest } from "../dist/commands/analysis/gate-evidence.js";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const MOCK = fileURLToPath(new URL("./mock-multica.cjs", import.meta.url));
const requireCli = process.env.OPENSPEC_D1_REQUIRED === "1";
const version = spawnOpenspec(["--version"], { encoding: "utf8", timeout: 20_000 });
const usable = !version.error && version.status === 0 && version.stdout.trim() === "1.13.2";
if (requireCli) {
  assert.equal(version.error, undefined);
  assert.equal(version.status, 0, "Pinned OpenSpec CLI not installed");
  assert.equal(version.stdout.trim(), "1.13.2");
}

function fixture(t, { skip = false, schema = "intentional-change", estimate = true } = {}) {
  const parent = realpathSync.native(tmpdir());
  const root = realpathSync.native(mkdtempSync(join(parent, "rondo-skip-specs-")));
  t.after(() => { assert.equal(dirname(root), parent); rmSync(root, { recursive: true, force: true }); });
  const openspec = join(root, "openspec");
  const change = join(openspec, "changes", "d1-internal-1234");
  mkdirSync(change, { recursive: true });
  mkdirSync(join(root, "docs", "config"), { recursive: true });
  writeFileSync(join(root, "docs", "config", "repo-context.yaml"), "repos:\n  - repo_id: frame\n");
  mkdirSync(join(openspec, "specs"), { recursive: true });
  for (const name of ["intentional-change", "corrective-change"]) {
    cpSync(join(REPO, "openspec", "schemas", name),
      join(openspec, "schemas", name), { recursive: true });
  }
  writeFileSync(join(change, ".openspec.yaml"),
    "schema: " + schema + "\nx-repositories:\n  - frame\n" + (skip ? "skip_specs: true\n" : ""));
  writeFileSync(join(change, "proposal.md"),
    "# Internal change\n\n## Why\nRemove unnecessary internal overhead.\n\n## Goal\nRefactor without changing external behavior.\n\n## Capabilities\nNo Spec-level behavior change.\n");
  writeFileSync(join(change, "tasks.md"),
    "# Tasks\n\n## 1. Refactor\n- [ ] 1.1 Refactor implementation and 验证 preserved behavior" + (estimate ? " [预估: 1h]" : "") + "\n");

  const statePath = join(root, "state.json");
  writeFileSync(statePath, JSON.stringify({
    status: "in_progress",
    metadata: {
      "tfs.type": "需求", "tfs.id": "1234",
      "analysis.change_kind": schema === "corrective-change" ? "corrective" : "intentional", "analysis.change_ref": "d1-internal-1234",
    },
  }));
  chmodSync(MOCK, 0o755);
  const configPath = join(root, "registry.json");
  writeFileSync(configPath, JSON.stringify({ runtime: {
    multica_cli: MOCK, workspace_id: "ws-test", multica_profile: "private", multica_server_url: "https://private.example",
  } }));
  function gate() {
    const r = spawnSync(process.execPath, [
      CLI, "analysis", "validate", "--change-ref", "d1-internal-1234", "--issue", "issue-1", "--openspec-root", root,
      "--workspace-id", "ws-test", "--multica", MOCK, "--registry-config", configPath,
    ], {
      encoding: "utf8", env: { ...process.env, MOCK_STATE: statePath, MOCK_EXPECT_PROFILE: "private", MOCK_EXPECT_SERVER: "https://private.example" }, timeout: 30_000,
    });
    assert.equal(r.error, undefined, r.error?.message);
    let body;
    try { body = JSON.parse(r.stdout); }
    catch { assert.fail("Invalid Gate JSON: " + r.stdout + " | " + r.stderr); }
    return { code: r.status, body, stderr: r.stderr };
  }
  return { root, change, gate };
}

function acceptance(result) {
  const c = result.body.checks?.find(c => c.name === "acceptance_contract");
  assert.ok(c, "Gate must include acceptance_contract");
  return c;
}

test("D3-A: legal native skip_specs does not require Delta Specs", { skip: !usable }, (t) => {
  const f = fixture(t, { skip: true });
  const r = f.gate();
  assert.equal(acceptance(r).result, "PASS", JSON.stringify(r.body));
  assert.equal(acceptance(r).reasons.length, 0, JSON.stringify(r.body));
  assert.equal(r.body.result, "PASS", "legal skip_specs should pass the entire Analysis Gate: " + JSON.stringify(r.body));
  assert.equal(r.body.issue_id, "issue-1");
  assert.equal(r.body.workspace_id, "ws-test");
  assert.equal(r.body.change_ref, "d1-internal-1234");
  assert.equal(r.body.change_kind, "intentional");
  assert.equal(r.body.schema, "intentional-change");
  assert.match(r.body.change_digest, /^[a-f0-9]{64}$/);
  assert.equal(r.body.change_digest, changeEvidenceDigest(f.change, JSON.parse(readFileSync(join(f.root, "state.json"), "utf8")).metadata));
  assert.equal(r.body.metadata_digest,
    metadataEvidenceDigest(JSON.parse(readFileSync(join(f.root, "state.json"), "utf8")).metadata));
  assert.equal(existsSync(join(f.change, "logs", "analysis-gate-result.json")), false);
  assert.equal(r.code, 0, JSON.stringify(r.body));
});

test("Analysis Gate rejects a Change without Repository Scope before Human Approval", { skip: !usable }, t => {
  const f = fixture(t, { skip: true });
  writeFileSync(join(f.change, ".openspec.yaml"), "schema: intentional-change\nskip_specs: true\n");
  const result = f.gate();
  assert.equal(acceptance(result).result, "FAIL", JSON.stringify(result.body));
  assert.match(acceptance(result).reasons.join(" "), /x-repositories/);
  assert.equal(result.code, 2);
});

test("D3-A: missing required Delta Specs still fails acceptance_contract", { skip: !usable }, (t) => {
  const f = fixture(t);
  const r = f.gate();
  assert.equal(acceptance(r).result, "FAIL", JSON.stringify(r.body));
  assert.match(acceptance(r).reasons.join("\n"), /缺少 specs/);
  assert.equal(r.body.result, "FAIL", JSON.stringify(r.body));
});

test("Gate validates the requested root when a nested workspace has the same change", { skip: !usable }, t => {
  const f = fixture(t, { skip: true });
  const planning = join(f.root, "openspec");
  const nested = join(planning, "openspec");
  cpSync(join(planning, "schemas"), join(nested, "schemas"), { recursive: true });
  cpSync(f.change, join(nested, "changes", basename(f.change)), { recursive: true });
  mkdirSync(join(nested, "specs"));

  // The nested change still passes. Only the requested change now has an invalid delta.
  writeFileSync(join(f.change, ".openspec.yaml"), "schema: intentional-change\nx-repositories: [frame]\n");
  const reports = join(f.change, "specs", "reports");
  mkdirSync(reports, { recursive: true });
  writeFileSync(join(reports, "spec.md"), "## ADDED Requirements\n\n### Requirement: Export\nThe system SHALL export reports.\n");
  const invalid = f.gate();
  const check = invalid.body.checks.find(c => c.name === "openspec_validate");
  assert.equal(check?.result, "FAIL", JSON.stringify(invalid.body));
  assert.match(check.reasons.join("\n"), /scenario/i);
  assert.equal(invalid.code, 2, JSON.stringify(invalid.body));

  rmSync(join(reports, "spec.md"));
  writeFileSync(join(f.change, ".openspec.yaml"), "schema: intentional-change\nx-repositories: [frame]\nskip_specs: true\n");
  // The requested root also has a main spec with the change's name.
  const sameName = join(planning, "specs", basename(f.change));
  mkdirSync(sameName);
  writeFileSync(join(sameName, "spec.md"), [
    "# Reports", "", "## Purpose", "Users can export their reports for offline storage and later review.",
    "", "## Requirements", "", "### Requirement: Export", "The system SHALL export reports.",
    "", "#### Scenario: Report export", "- **WHEN** a report is requested", "- **THEN** a file is returned.", "",
  ].join("\n"));
  const skipped = f.gate();
  assert.equal(acceptance(skipped).result, "PASS", JSON.stringify(skipped.body));
  assert.equal(skipped.code, 0, JSON.stringify(skipped.body));
});

for (const [operation, delta, expected] of [
  ["REMOVED", "## REMOVED Requirements\n\n### Requirement: CSV export\n**Reason**: The legacy format is being retired.\n**Migration**: Use JSON export.", "PASS"],
  ["RENAMED", "## RENAMED Requirements\n\n- FROM: `### Requirement: CSV export`\n- TO: `### Requirement: Tabular export`", "PASS"],
  ["ADDED without a Scenario", "## ADDED Requirements\n\n### Requirement: PDF export\nThe system SHALL export PDF reports.", "FAIL"],
]) {
  test(`Analysis Gate delegates ${operation} delta validation to OpenSpec`, { skip: !usable }, t => {
    const f = fixture(t);
    const baseline = join(f.root, "openspec", "specs", "reports");
    const update = join(f.change, "specs", "reports");
    mkdirSync(baseline, { recursive: true });
    mkdirSync(update, { recursive: true });
    writeFileSync(join(baseline, "spec.md"), [
      "# Reports", "", "## Purpose", "Reports allow users to export and reuse their data in supported formats.",
      "", "## Requirements", "",
      "### Requirement: CSV export", "The system SHALL export CSV reports.",
      "#### Scenario: Export in CSV", "- **WHEN** CSV is requested", "- **THEN** a CSV file is returned.", "",
      "### Requirement: JSON export", "The system SHALL export JSON reports.",
      "#### Scenario: Export in JSON", "- **WHEN** JSON is requested", "- **THEN** a JSON file is returned.", "",
    ].join("\n"));
    writeFileSync(join(f.change, "proposal.md"), "## Why\n\nAlign report formats with the supported exports.\n\n## What Changes\n\nUpdate the reports capability.\n\n## Repository Scope\n\n- repo_id: frame\n");
    writeFileSync(join(update, "spec.md"), delta + "\n");
    const r = f.gate();
    assert.equal(r.body.checks.find(c => c.name === "openspec_validate")?.result, expected, JSON.stringify(r.body));
    assert.equal(r.body.result, expected, JSON.stringify(r.body));
    assert.equal(r.code, expected === "PASS" ? 0 : 2);
  });
}

test("D3-A: corrective-change has no English keyword Gate", { skip: !usable }, (t) => {
  const f = fixture(t, { skip: true, schema: "corrective-change" });
  const r = f.gate();
  assert.equal(acceptance(r).result, "PASS", JSON.stringify(r.body));
});

test("D3-B: Requirement Analysis Gate PASS does not require TFS work estimate", { skip: !usable }, t => {
  const f = fixture(t, { skip: true, estimate: false });
  const result = f.gate();
  assert.equal(result.code, 0, JSON.stringify(result.body));
  assert.equal(result.body.result, "PASS", JSON.stringify(result.body));
  assert.equal(result.body.checks.some(c => c.name === "task_estimates"), false);
  assert.equal(result.body.checks.find(c => c.name === "tasks")?.result, "PASS");
});

test("D3-B: a historical legal estimate is not a Gate requirement", { skip: !usable }, t => {
  const f = fixture(t, { skip: true, estimate: true });
  const result = f.gate();
  assert.equal(result.body.result, "PASS", JSON.stringify(result.body));
  assert.equal(result.body.checks.some(c => c.name === "task_estimates"), false);
});
