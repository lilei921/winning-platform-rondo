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
  const repository = join(base, "remote");
  const workdir = join(base, "workdir");
  mkdirSync(repository);
  mkdirSync(workdir);
  git(repository, "init", "-b", "main");
  git(repository, "config", "user.name", "Closeout Test");
  git(repository, "config", "user.email", "closeout@example.invalid");
  const change = join(repository, "openspec", "changes", "change-1");
  mkdirSync(change, { recursive: true });
  writeFileSync(join(change, "tasks.md"), "- [x] 1.1 test\n");
  git(repository, "add", ".");
  git(repository, "commit", "-m", "test: approved change");

  const source: AnalysisSource = {
    repo_url: "http://tfs.example.invalid:8080/tfs/Collection/Project/_git/root",
    branch: "main",
    commit: git(repository, "rev-parse", "HEAD"),
    change_ref: "change-1",
  };
  // 本地 Git fixture 模拟受控远端：仍由真实 Git 校验 HEAD / Origin / 分支 / 工作树。
  const remote: typeof runAuthenticatedGit = (url, args, cwd) => {
    if (args.includes("clone")) {
      const cloned = runCommand(["git", "clone", "--single-branch", "--no-tags",
        "--branch", source.branch, "--", repository, "."], cwd);
      if (cloned.status !== 0) return cloned;
      const setUrl = runCommand(["git", "remote", "set-url", "origin", url], cwd);
      return setUrl.status === 0 ? cloned : setUrl;
    }
    if (args[0] === "fetch") {
      return runCommand(["git", "fetch", repository,
        `refs/heads/${source.branch}:refs/remotes/origin/${source.branch}`], cwd);
    }
    throw new Error("Unexpected authenticated Git operation");
  };
  const paths = (rootRepo: string) => ({
    rootRepo, openspecRoot: join(rootRepo, "openspec"),
    projectId: "", daemonId: null, source: "explicit_arg" as const,
  });
  return { base, repository, workdir, source, remote, paths };
}

test("Clone 位于显式 workdir 一级子目录，Cleanup 仅清理受控 Clone", (t) => {
  const f = fixture(t);
  const { root_repo, cleanup_token } = cloneCloseoutRoot(f.source, f.workdir, f.remote);
  assert.equal(dirname(root_repo), realpathSync(f.workdir));
  assert.equal(verifyCloseoutRoot(f.paths(root_repo), f.source).rootRepo, root_repo);
  const marker = JSON.parse(readFileSync(join(root_repo, ".git", "rondo-closeout-owner.json"), "utf8"));
  assert.equal(marker.workdir, realpathSync(f.workdir));
  assert.deepEqual(cleanupCloseoutRoot(root_repo, cleanup_token, f.remote), { removed: true });
  assert.equal(existsSync(root_repo), false);
  assert.equal(existsSync(f.workdir), true);
  assert.equal(existsSync(f.repository), true);
});

test("不接受缺失或相对 workdir，且不回退系统 Temp", (t) => {
  const f = fixture(t);
  assert.throws(() => cloneCloseoutRoot(f.source, "relative-workdir", f.remote), /workdir/);
  assert.throws(() => cloneCloseoutRoot(f.source, join(f.workdir, "missing"), f.remote), /workdir/);
});

test("所有权 workdir 篡改与错误 token 均拒绝清理并保留现场", (t) => {
  const f = fixture(t);
  const { root_repo, cleanup_token } = cloneCloseoutRoot(f.source, f.workdir, f.remote);
  assert.throws(() => cleanupCloseoutRoot(root_repo, "wrong-token", f.remote), /token/);
  const ownerPath = join(root_repo, ".git", "rondo-closeout-owner.json");
  const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
  writeFileSync(ownerPath, JSON.stringify({ ...owner, workdir: f.repository }));
  assert.throws(() => verifyCloseoutRoot(f.paths(root_repo), f.source), /受控子目录/);
  assert.throws(() => cleanupCloseoutRoot(root_repo, cleanup_token, f.remote), /受控子目录/);
  assert.equal(existsSync(root_repo), true);
  writeFileSync(ownerPath, JSON.stringify(owner));
  assert.deepEqual(cleanupCloseoutRoot(root_repo, cleanup_token, f.remote), { removed: true });
});

test("存在未保存的本地文件时保留 Clone，不删除 workdir", (t) => {
  const f = fixture(t);
  const { root_repo, cleanup_token } = cloneCloseoutRoot(f.source, f.workdir, f.remote);
  const untracked = join(root_repo, "local-notes.txt");
  writeFileSync(untracked, "uncommitted");
  assert.throws(() => cleanupCloseoutRoot(root_repo, cleanup_token, f.remote), /未提交修改/);
  assert.equal(existsSync(root_repo), true);
  rmSync(untracked);
  assert.deepEqual(cleanupCloseoutRoot(root_repo, cleanup_token, f.remote), { removed: true });
  assert.equal(existsSync(f.workdir), true);
});
