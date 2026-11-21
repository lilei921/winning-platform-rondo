import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, realpathSync } from "node:path";
import { runCommand } from "../../clients/spawn.js";
import type { runAuthenticatedGit } from "../../clients/authenticated-git.js";
import type { AnalysisSource } from "../analysis/source.js";
import { cloneCloseoutRoot, cleanupCloseoutRoot, verifyCloseoutRoot } from "./closeout-root.js";

function git(cwd: string, ...args: string[]): string {
  const result = runCommand(["git", ...args], cwd);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function fixture(t: { after: (fn: () => void) => void }) {
  const base = mkdtempSync(join(tmpdir(), "rondo-closeout-test-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const sourceRepo = join(base, "source");
  const workdir = join(base, "task-workdir");
  mkdirSync(sourceRepo);
  mkdirSync(workdir);
  git(sourceRepo, "init", "-b", "main");
  git(sourceRepo, "config", "user.name", "Closeout Test");
  git(sourceRepo, "config", "user.email", "closeout@example.invalid");
  const change = join(sourceRepo, "openspec", "changes", "change-1");
  mkdirSync(change, { recursive: true });
  writeFileSync(join(change, "tasks.md"), "- [x] 1.1 done\n");
  git(sourceRepo, "add", ".");
  git(sourceRepo, "commit", "-m", "test: approved change");

  const source: AnalysisSource = {
    repo_url: "http://tfs.example.invalid/tfs/Collection/Project/_git/root",
    branch: "main",
    commit: git(sourceRepo, "rev-parse", "HEAD"),
    change_ref: "change-1",
  };
  const remote: typeof runAuthenticatedGit = (url, args, cwd) => {
    if (args.includes("clone")) {
      const cloned = runCommand(["git", "clone", "--single-branch", "--no-tags",
        "--branch", source.branch, "--", sourceRepo, "."], cwd);
      if (cloned.status !== 0) return cloned;
      const changed = runCommand(["git", "remote", "set-url", "origin", url], cwd);
      return changed.status === 0 ? cloned : changed;
    }
    if (args[0] === "fetch") {
      return runCommand(["git", "fetch", sourceRepo,
        "refs/heads/main:refs/remotes/origin/main"], cwd);
    }
    throw new Error("Unexpected authenticated Git operation");
  };
  const paths = (rootRepo: string) => ({
    rootRepo, openspecRoot: join(rootRepo, "openspec"),
    projectId: "", daemonId: null, source: "explicit_arg" as const,
  });
  return { base, workdir, source, remote, paths };
}

function inWorkdir<T>(workdir: string, action: () => T): T {
  const old = process.cwd();
  process.chdir(workdir);
  try { return action(); }
  finally { process.chdir(old); }
}

test("Clone 自动使用进程 cwd；受控 Cleanup 不删除 workdir 或其它文件", (t) => {
  const f = fixture(t);
  inWorkdir(f.workdir, () => {
    const other = join(f.workdir, "other.txt");
    writeFileSync(other, "keep");
    const { root_repo, cleanup_token } = cloneCloseoutRoot(f.source, f.remote);
    assert.equal(dirname(root_repo), realpathSync(f.workdir));
    assert.equal(verifyCloseoutRoot(f.paths(root_repo), f.source).rootRepo, root_repo);
    const owner = JSON.parse(readFileSync(join(root_repo, ".git", "rondo-closeout-owner.json"), "utf8"));
    assert.equal(owner.workdir, realpathSync(f.workdir));
    assert.deepEqual(cleanupCloseoutRoot(root_repo, cleanup_token, f.remote), { removed: true });
    assert.equal(existsSync(root_repo), false);
    assert.equal(readFileSync(other, "utf8"), "keep");
  });
});

test("错误 token、脏工作区与 workdir 标记不一致时均保留 Clone", (t) => {
  const f = fixture(t);
  inWorkdir(f.workdir, () => {
    const { root_repo, cleanup_token } = cloneCloseoutRoot(f.source, f.remote);
    assert.throws(() => cleanupCloseoutRoot(root_repo, "wrong", f.remote), /token/);
    const dirtyFile = join(root_repo, "untracked.txt");
    writeFileSync(dirtyFile, "WIP");
    assert.throws(() => cleanupCloseoutRoot(root_repo, cleanup_token, f.remote), /未提交修改/);
    rmSync(dirtyFile);
    const ownerPath = join(root_repo, ".git", "rondo-closeout-owner.json");
    const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
    writeFileSync(ownerPath, JSON.stringify({ ...owner, workdir: f.base }));
    assert.throws(() => verifyCloseoutRoot(f.paths(root_repo), f.source), /workdir/);
    assert.throws(() => cleanupCloseoutRoot(root_repo, cleanup_token, f.remote), /workdir/);
    assert.equal(existsSync(root_repo), true);
    writeFileSync(ownerPath, JSON.stringify(owner));
    assert.deepEqual(cleanupCloseoutRoot(root_repo, cleanup_token, f.remote), { removed: true });
  });
});
