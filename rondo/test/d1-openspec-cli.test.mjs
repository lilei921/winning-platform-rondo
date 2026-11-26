import { spawnOpenspec } from "./helpers/openspec.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const schemaSource = join(repoRoot, "openspec", "schemas");
const requireCli = process.env.OPENSPEC_D1_REQUIRED === "1";
const version = spawnOpenspec(["--version"], { encoding: "utf8", timeout: 20_000 });
const usable = !version.error && version.status === 0 && version.stdout.trim() === "1.14.2";
if (requireCli) {
  assert.equal(version.error, undefined, "D1 CI must have OpenSpec v1.14.2 installed");
  assert.equal(version.status, 0, "OpenSpec CLI version command failed: " + version.stderr);
  assert.equal(version.stdout.trim(), "1.14.2", "D1 tests require the pinned OpenSpec v1.14.2");
}

function fixture(t) {
  const parent = realpathSync.native(tmpdir());
  const root = realpathSync.native(mkdtempSync(join(parent, "multica-openspec-d1-")));
  t.after(() => {
    assert.equal(dirname(root), parent);
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "openspec", "changes"), { recursive: true });
  mkdirSync(join(root, "openspec", "specs"), { recursive: true });
  for (const schema of ["intentional-change", "corrective-change"]) {
    cpSync(join(schemaSource, schema), join(root, "openspec", "schemas", schema), { recursive: true });
  }
  return root;
}

function run(root, ...args) {
  const r = spawnOpenspec(args, { cwd: root, encoding: "utf8", timeout: 25_000 });
  assert.equal(r.error, undefined, "openspec " + args.join(" ") + ": " + r.error?.message);
  let json;
  try { json = JSON.parse(r.stdout); }
  catch { assert.fail("OpenSpec JSON output malformed for " + args.join(" ") + ": " + r.stdout + " | stderr " + r.stderr); }
  return { code: r.status, json, stderr: r.stderr };
}
function start(root, id, schema = "intentional-change") {
  const r = run(root, "new", "change", id, "--schema", schema, "--json");
  assert.equal(r.code, 0, r.stderr);
  assert.equal(realpathSync.native(r.json.root.path), root, "change created under wrong root");
  assert.ok(existsSync(join(root, "openspec", "changes", id, ".openspec.yaml")));
  return join(root, "openspec", "changes", id);
}
function artifact(status, id) {
  const item = status.artifacts.find(a => a.id === id);
  assert.ok(item, "missing artifact " + id);
  return item;
}

test("OpenSpec v1.14.2: D1 project Schema and correct Root are selected", { skip: !usable }, (t) => {
  const root = fixture(t);
  const which = run(root, "schema", "which", "intentional-change", "--json");
  assert.equal(which.code, 0, which.stderr);
  assert.equal(which.json.source, "project");
  const change = start(root, "d1-project-root");
  const status = run(root, "status", "--change", "d1-project-root", "--json");
  assert.equal(status.code, 0, status.stderr);
  assert.equal(realpathSync.native(status.json.root.path), root);
  assert.equal(artifact(status.json, "proposal").status, "ready");
  const instructions = run(root, "instructions", "proposal", "--change", "d1-project-root", "--json");
  assert.equal(instructions.code, 0, instructions.stderr);
  assert.equal(realpathSync.native(instructions.json.root.path), root);
  assert.equal(instructions.json.artifactId, "proposal");
  assert.ok(existsSync(join(change, ".openspec.yaml")));
});

test("OpenSpec v1.14.2: status uses the process cwd; another Root must be rejected by caller", { skip: !usable }, (t) => {
  const expected = fixture(t);
  const other = fixture(t);
  start(expected, "d1-expected");
  const different = run(other, "status", "--change", "d1-expected", "--json");
  assert.notEqual(different.code, 0, "status unexpectedly found a Change in a different root");
  // Native CLI has no rondo-root context; spec-preparation must pin cwd and verify returned root.
  const otherRoot = run(other, "schema", "which", "intentional-change", "--json");
  assert.equal(otherRoot.code, 0);
  assert.equal(otherRoot.json.source, "project");
  assert.notEqual(expected, other);
});

test("OpenSpec v1.14.2: one Glob spec can appear done while another declared Capability is missing", { skip: !usable }, (t) => {
  const root = fixture(t);
  const change = start(root, "d1-multiple-capabilities");
  writeFileSync(join(change, "proposal.md"), "# Proposal\n\n## Capabilities\n- cap-one\n- cap-two\n");
  const specDir = join(change, "specs", "cap-one");
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "spec.md"), "## ADDED Requirements\n\n### Requirement: Cap one\nThe system SHALL work.\n\n#### Scenario: Valid\n- **WHEN** requested\n- **THEN** successful\n");
  const status = run(root, "status", "--change", "d1-multiple-capabilities", "--json");
  assert.equal(status.code, 0, status.stderr);
  assert.equal(artifact(status.json, "specs").status, "done");
  assert.equal(existsSync(join(change, "specs", "cap-two", "spec.md")), false);
  // D1 skill explicitly requires checking each Proposal Capability's concrete path.
});

test("OpenSpec v1.14.2: metadata skip_specs is reflected in native status", { skip: !usable }, (t) => {
  const root = fixture(t);
  const change = start(root, "d1-internal-only");
  writeFileSync(join(change, ".openspec.yaml"), "schema: intentional-change\nx-repositories: [frame]\nskip_specs: true\n");
  writeFileSync(join(change, "proposal.md"), "# Proposal\n\n## Goal\nInternal refactor; no Spec-level change.\n");
  const status = run(root, "status", "--change", "d1-internal-only", "--json");
  assert.equal(status.code, 0, status.stderr);
  assert.equal(artifact(status.json, "specs").status, "skipped");
  assert.match(readFileSync(join(change, ".openspec.yaml"), "utf8"), /x-repositories:/);
  const validate = run(root, "validate", "d1-internal-only", "--type", "change", "--strict", "--no-interactive", "--json");
  assert.equal(validate.code, 0, JSON.stringify(validate.json));
});

const noticePurpose = "A first sign-in notice lets customers confirm that their new account was successfully accessed.";
const noticeBehavior = "The system SHALL send a notice after the first sign-in.";
const noticeScenario = "#### Scenario: First sign-in\n- **WHEN** a customer signs in for the first time\n- **THEN** they receive a notice";

function noticeDelta(t, id, schema) {
  const root = fixture(t);
  const change = start(root, id, schema);
  writeFileSync(join(change, "proposal.md"), "## Why\n\nCustomers need clear sign-in notifications.\n\n## What Changes\n\nUpdate sign-in-notice.\n\n");
  writeFileSync(join(change, "tasks.md"), "- [x] 1.1 Update the notice and verify account notifications.\n");
  const instructions = run(root, "instructions", "specs", "--change", id, "--json");
  assert.equal(instructions.code, 0, instructions.stderr);
  const dir = join(change, "specs", "sign-in-notice");
  mkdirSync(dir, { recursive: true });
  return { root, change, template: instructions.json.template, deltaFile: join(dir, "spec.md") };
}

function writeExistingNotice(root) {
  const dir = join(root, "openspec", "specs", "sign-in-notice");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "spec.md");
  writeFileSync(path, [
    "# Sign-in notice", "## Purpose", noticePurpose, "## Requirements",
    "### Requirement: First sign-in notice", noticeBehavior, noticeScenario,
  ].join("\n\n") + "\n");
  return path;
}

test("A filled Spec template archives only the intended new requirement", { skip: !usable }, t => {
  const id = "add-sign-in-notice";
  const { root, template, deltaFile } = noticeDelta(t, id, "intentional-change");
  // Keep the entire template, including HTML comments: 1.14.2 can parse Delta headings inside them.
  const spec = template
    .replace(/^## ADDED Requirements$/m, "## Purpose\n\n" + noticePurpose + "\n\n## ADDED Requirements")
    .replace(/^### Requirement:$/m, "### Requirement: First sign-in notice\n" + noticeBehavior)
    .replace(/^#### Scenario:\r?\n- \*\*WHEN\*\*\r?\n- \*\*THEN\*\*$/m, noticeScenario);
  writeFileSync(deltaFile, spec);
  const archived = run(root, "archive", id, "--yes", "--json");
  assert.equal(archived.code, 0, JSON.stringify(archived.json));
  const stored = run(root, "show", "sign-in-notice", "--type", "spec", "--json");
  assert.equal(stored.code, 0, stored.stderr);
  assert.deepEqual(stored.json.requirements.map(req => req.text), [noticeBehavior]);
  const strict = run(root, "validate", "sign-in-notice", "--type", "spec", "--strict", "--json");
  assert.equal(strict.code, 0, JSON.stringify(strict.json));
});

for (const schema of ["intentional-change", "corrective-change"]) {
  test(`${schema}: the empty template cannot generate a requirement alongside a rename`, { skip: !usable }, t => {
    const id = "rename-sign-in-notice";
    const { root, template, deltaFile } = noticeDelta(t, id, schema);
    const mainFile = writeExistingNotice(root);

    writeFileSync(deltaFile, template);
    const empty = run(root, "validate", id, "--type", "change", "--strict", "--json");
    assert.notEqual(empty.code, 0, JSON.stringify(empty.json));
    writeFileSync(deltaFile, template.replace(/^### Requirement:$/m, "### Requirement: Account access"));
    const titleOnly = run(root, "validate", id, "--type", "change", "--strict", "--json");
    assert.notEqual(titleOnly.code, 0, JSON.stringify(titleOnly.json));

    const rename = "\n## RENAMED Requirements\n\n- FROM: `### Requirement: First sign-in notice`\n- TO: `### Requirement: New account notice`\n";
    writeFileSync(deltaFile, template + rename.replace("First sign-in", "Frist sign-in"));
    const misspelled = run(root, "archive", id, "--yes", "--json");
    assert.notEqual(misspelled.code, 0);
    assert.match(JSON.stringify(misspelled.json.status), /Frist sign-in/);

    writeFileSync(deltaFile, template + rename);
    const archived = run(root, "archive", id, "--yes", "--json");
    assert.equal(archived.code, 0, JSON.stringify(archived.json));
    assert.deepEqual(archived.json.archive.totals, { added: 0, modified: 0, removed: 0, renamed: 1 });
    assert.match(readFileSync(mainFile, "utf8"), /^### Requirement: New account notice$/m);
  });
}

test("Archiving a final removal requires explicit capability retirement", { skip: !usable }, t => {
  const id = "retire-sign-in-notice";
  const { root, change, template, deltaFile } = noticeDelta(t, id, "intentional-change");
  const mainFile = writeExistingNotice(root);
  writeFileSync(deltaFile, template + "\n## REMOVED Requirements\n\n### Requirement: First sign-in notice\n**Reason**: Notices are being retired.\n**Migration**: Use account activity.\n");
  const unapproved = run(root, "archive", id, "--yes", "--json");
  assert.notEqual(unapproved.code, 0);
  assert.match(JSON.stringify(unapproved.json.status), /retire_capabilities/);
  assert.ok(existsSync(mainFile));

  const metadata = join(change, ".openspec.yaml");
  writeFileSync(metadata, readFileSync(metadata, "utf8") + "\nretire_capabilities: true\n");
  const archived = run(root, "archive", id, "--yes", "--json");
  assert.equal(archived.code, 0, JSON.stringify(archived.json));
  assert.equal(existsSync(mainFile), false);
});

test("OpenSpec v1.14.2: Conditional Design is separate from Tasks apply.requires", { skip: !usable }, (t) => {
  const root = fixture(t);
  const change = start(root, "d1-design-conditional");
  writeFileSync(join(change, "proposal.md"), "# Proposal\n\n## Goal\nComplex API change.\n");
  const status = run(root, "status", "--change", "d1-design-conditional", "--json");
  assert.equal(status.code, 0, status.stderr);
  const design = artifact(status.json, "design");
  assert.ok(["ready", "done"].includes(design.status));
  const tasks = artifact(status.json, "tasks");
  assert.equal(tasks.status, "blocked");
  assert.ok(!existsSync(join(change, "design.md")));
});
