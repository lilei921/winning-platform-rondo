import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readApprovedRepositoryScope } from "../dist/commands/dev/requirement-guard.js";

test("Repository Scope uses the approved Git object, never the working tree or newer HEAD", async t => {
  const root = mkdtempSync(join(tmpdir(), "rondo-approved-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init");
  const dir = join(root, "openspec", "changes", "fix-42");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, ".openspec.yaml");
  const commit = message => {
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", message);
    return git("rev-parse", "HEAD");
  };
  writeFileSync(file, "schema: intentional-change\nx-repositories: [frame]\n");
  const approved = commit("approved");
  writeFileSync(file, "schema: intentional-change\nx-repositories: [web]\n");
  const newer = commit("newer");
  writeFileSync(file, "schema: intentional-change\nx-repositories: [dirty]\n");
  const source = { repo_url: "https://tfs.example/tfs/C/P/_git/root", branch: "dev", commit: approved, change_ref: "fix-42" };
  const local = { root, source };
  let reads = 0;
  const remote = async () => { reads++; throw new Error("unexpected remote read"); };
  assert.deepEqual(await readApprovedRepositoryScope(source, local, remote), ["frame"]);
  await assert.rejects(readApprovedRepositoryScope({ ...source, commit: newer }, local, remote), /批准来源/);
  const missing = { ...source, change_ref: "missing-42" };
  await assert.rejects(readApprovedRepositoryScope(missing, { root, source: missing }, remote), /批准版 Repository Scope/);
  writeFileSync(file, "x-repositories: []\n");
  const invalid = { ...source, commit: commit("invalid scope") };
  await assert.rejects(readApprovedRepositoryScope(invalid, { root, source: invalid }, remote), /x-repositories/);
  assert.equal(reads, 0, "local failures and invalid contracts must not fall back to a remote read");
});

test("Repository Scope without a prepared local object retains the pinned remote read", async () => {
  const source = { repo_url: "https://tfs.example/tfs/C/P/_git/root", branch: "dev", commit: "a".repeat(40), change_ref: "fix-42" };
  let reads = 0;
  const remote = async (actualSource, file) => {
    reads++;
    assert.deepEqual(actualSource, source);
    assert.equal(file, ".openspec.yaml");
    return { content: "x-repositories: [frame, web]\n" };
  };
  assert.deepEqual(await readApprovedRepositoryScope(source, undefined, remote), ["frame", "web"]);
  assert.equal(reads, 1);
});
