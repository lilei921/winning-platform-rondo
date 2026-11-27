import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { requirementRoot } from "../dist/commands/runtime/root-git.js";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function put(root, path, text) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "rondo-08b-root-"));
  const root = join(dir, "root"), bare = join(dir, "remote.git");
  const saved = process.env.RONDO_WORKSPACE_BRANCH;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    if (saved === undefined) delete process.env.RONDO_WORKSPACE_BRANCH;
    else process.env.RONDO_WORKSPACE_BRANCH = saved;
  });
  process.env.RONDO_WORKSPACE_BRANCH = "main";
  git(dir, "init", "-b", "dev", root);
  git(dir, "init", "--bare", bare);
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  const url = "http://tfs.test/tfs/C/P/_git/root";
  git(root, "remote", "add", "origin", url);
  put(root, "docs/config/repo-context.yaml", "repos:\n  - repo_id: root\n    repo_url: " + url + "\n");
  put(root, "openspec/schemas/sample.yaml", "schema");
  put(root, "openspec/changes/a/tasks.md", "initial\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "base");
  git(root, "push", bare, "dev", "HEAD:refs/heads/main");
  const remote = (_url, args, cwd) => {
    const result = spawnSync("git", args.map(arg => arg === "origin" ? bare : arg), { cwd, encoding: "utf8" });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  return { dir, root, bare, remote };
}

test("显式根仓覆盖本机路径；退役命令不能触发 Git 写入", t => {
  const { root } = fixture(t);
  const saved = process.env.RONDO_WORKSPACE_PATH;
  t.after(() => {
    if (saved === undefined) delete process.env.RONDO_WORKSPACE_PATH;
    else process.env.RONDO_WORKSPACE_PATH = saved;
  });
  process.env.RONDO_WORKSPACE_PATH = root;
  assert.equal(requirementRoot(), git(root, "rev-parse", "--show-toplevel"));
  process.env.RONDO_WORKSPACE_PATH = join(root, "wrong");
  assert.equal(requirementRoot(root), git(root, "rev-parse", "--show-toplevel"));
  delete process.env.RONDO_WORKSPACE_BRANCH;
  put(root, "pending", "local");
  const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
  const missing = spawnSync(process.execPath, [cli, "runtime", "prepare-root", "--root-repo", root, "--branch", "dev"],
    { encoding: "utf8" });
  assert.equal(missing.status, 64, missing.stderr);
  assert.equal(git(root, "status", "--porcelain"), "?? pending");
  assert.equal(git(root, "for-each-ref", "refs/remotes"), "");
});
