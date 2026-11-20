import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
let root;

before(() => {
  root = mkdtempSync(join(tmpdir(), "rondo-dual-identity-"));
  mkdirSync(join(root, "openspec", "changes", "archive"), { recursive: true });
});

after(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function change(id, { archived = false, schema = "corrective-change" } = {}) {
  const dir = archived
    ? join(root, "openspec", "changes", "archive", "2026-11-07-" + id)
    : join(root, "openspec", "changes", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".openspec.yaml"), "schema: " + schema + "\n");
}

function resolve(...args) {
  const out = spawnSync(process.execPath, [cli, "change", "resolve-identity",
    "--openspec-root", root, ...args], { encoding: "utf8" });
  assert.equal(out.error, undefined, out.error?.message);
  return { status: out.status, data: JSON.parse(out.stdout) };
}

test("consistent change_ref + tfs.id resolves existing change", () => {
  change("known-101");
  const result = resolve("--change-ref", "known-101", "--tfs-id", "101",
    "--expect-schema", "corrective-change");
  assert.equal(result.status, 0);
  assert.equal(result.data.result, "ACTIVE_FOUND");
  assert.equal(result.data.change_ref, "known-101");
});

test("primary lookup rejects an existing change_ref whose TFS suffix conflicts", () => {
  change("other-202");
  const result = resolve("--change-ref", "other-202", "--tfs-id", "101");
  assert.equal(result.status, 2);
  assert.equal(result.data.result, "CONFLICT");
  assert.match(result.data.detail, /change_ref=.*tfs.id=/);
});

test("a stale missing change_ref can recover by the known tfs.id", () => {
  change("replacement-303");
  const result = resolve("--change-ref", "stale-303", "--tfs-id", "303");
  assert.equal(result.status, 0);
  assert.equal(result.data.result, "ACTIVE_FOUND");
  assert.equal(result.data.change_ref, "replacement-303");
});

test("archive fallback also rejects an existing mismatched change_ref", () => {
  change("archived-404", { archived: true });
  const result = resolve("--change-ref", "archived-404", "--tfs-id", "405");
  assert.equal(result.status, 2);
  assert.equal(result.data.result, "CONFLICT");
});

test("a single identity is still sufficient for the documented lookup paths", () => {
  const byRef = resolve("--change-ref", "known-101");
  assert.equal(byRef.status, 0);
  assert.equal(byRef.data.result, "ACTIVE_FOUND");
  const byTfs = resolve("--tfs-id", "303");
  assert.equal(byTfs.status, 0);
  assert.equal(byTfs.data.change_ref, "replacement-303");
});

test("no candidate does not become a false conflict", () => {
  const result = resolve("--change-ref", "absent-505", "--tfs-id", "505");
  assert.equal(result.status, 0);
  assert.equal(result.data.result, "NOT_FOUND");
});
