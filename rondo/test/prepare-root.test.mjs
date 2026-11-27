import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { prepareRoot, requirementRoot } from "../dist/commands/runtime/root-git.js";

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

test("显式根仓覆盖本机路径；分支配置缺失时旧参数不能触发 Git 写入", t => {
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
  assert.equal(missing.status, 3, missing.stderr);
  assert.match(JSON.parse(missing.stdout).reason, /RONDO_WORKSPACE_BRANCH/);
  assert.equal(git(root, "status", "--porcelain"), "?? pending");
  assert.equal(git(root, "for-each-ref", "refs/remotes"), "");
});

test("在原目录跟踪配置分支；两个 Change 与共享改动独立提交并只留在原分支", t => {
  const { root, bare, remote } = fixture(t);
  const base = git(root, "rev-parse", "HEAD");
  git(root, "rm", "openspec/changes/a/tasks.md");
  put(root, "openspec/changes/a/proposal.md", "new");
  put(root, "openspec/changes/b/tasks.md", "B");
  put(root, "共享 [x].md", "shared");
  git(root, "add", "openspec/changes/b", "共享 [x].md");
  const result = prepareRoot(root, "dev", remote);
  assert.equal(result.branch, "main");
  assert.equal(git(root, "rev-parse", "--abbrev-ref", "@{upstream}"), "origin/main");
  assert.equal(git(root, "rev-parse", "HEAD"), base);
  assert.equal(git(root, "worktree", "list", "--porcelain").match(/^worktree /gm).length, 1);
  const changes = git(root, "rev-list", base + "..dev").split("\n").map(commit =>
    git(root, "-c", "core.quotepath=false", "diff-tree", "--no-commit-id", "--name-only", "-r", commit).split("\n").sort());
  assert.deepEqual(changes.sort(), [
    ["openspec/changes/a/proposal.md", "openspec/changes/a/tasks.md"],
    ["openspec/changes/b/tasks.md"], ["共享 [x].md"],
  ].sort());
  assert.equal(git(bare, "rev-parse", "dev"), base);
  assert.equal(git(bare, "rev-parse", "main"), base);
});

test("分支不存在或被另一工作树占用时保留 HEAD、Index 和未暂存修改", t => {
  const { root, dir, remote } = fixture(t);
  const base = git(root, "rev-parse", "HEAD");
  put(root, "staged", "index");
  git(root, "add", "staged");
  put(root, "pending", "worktree");
  const before = git(root, "status", "--porcelain");
  process.env.RONDO_WORKSPACE_BRANCH = "misspelled";
  assert.throws(() => prepareRoot(root, undefined, remote), /misspelled/);
  process.env.RONDO_WORKSPACE_BRANCH = "main";
  const other = join(dir, "occupied worktree");
  git(root, "worktree", "add", "-b", "main", other);
  assert.throws(() => prepareRoot(root, undefined, remote), e => e.message.includes("main") && e.message.includes("occupied worktree"));
  assert.equal(git(root, "rev-parse", "HEAD"), base);
  assert.equal(git(root, "branch", "--show-current"), "dev");
  assert.equal(git(root, "status", "--porcelain"), before);
  assert.equal(git(root, "show", ":staged"), "index");
});

test("本地与远端分叉时既有历史及暂存、未暂存版本逐字保留", t => {
  const { root, bare, remote } = fixture(t);
  git(root, "switch", "-c", "main");
  put(root, "local-commit", "L");
  git(root, "add", "local-commit");
  git(root, "commit", "-m", "local only");
  const local = git(root, "rev-parse", "HEAD");
  git(root, "switch", "dev");
  put(root, "remote-commit", "R");
  git(root, "add", "remote-commit");
  git(root, "commit", "-m", "remote only");
  git(root, "push", bare, "HEAD:refs/heads/main");
  git(root, "switch", "main");
  put(root, "pending", "staged version");
  git(root, "add", "pending");
  put(root, "pending", "worktree version");
  const result = prepareRoot(root, undefined, remote);
  assert.equal(result.updated, false);
  assert.equal(result.remote_commit, git(bare, "rev-parse", "main"));
  assert.equal(git(root, "rev-parse", "HEAD"), local);
  assert.equal(git(root, "show", ":pending"), "staged version");
  assert.equal(readFileSync(join(root, "pending"), "utf8"), "worktree version");
});

test("切换前同时保存同一路径的暂存版本和工作区版本", t => {
  const { root, remote } = fixture(t);
  const task = "openspec/changes/a/tasks.md";
  put(root, task, "index version");
  git(root, "add", task);
  put(root, task, "working version");
  const replaced = "openspec/changes/a/replaced.md";
  put(root, replaced, "original");
  git(root, "add", replaced);
  git(root, "commit", "--only", "-m", "existing", "--", replaced);
  git(root, "rm", replaced);
  put(root, replaced, "replacement");

  prepareRoot(root, undefined, remote);
  assert.equal(git(root, "show", "dev~:" + task), "index version");
  assert.equal(git(root, "ls-tree", "dev~", "--", replaced), "");
  assert.equal(git(root, "show", "dev:" + task), "working version");
  assert.equal(git(root, "show", "dev:" + replaced), "replacement");
  assert.equal(git(root, "branch", "--show-current"), "main");
});

test("原根仓仅跟踪单个分支时仍可建立配置分支的远端跟踪", t => {
  const { root, remote } = fixture(t);
  git(root, "remote", "set-branches", "origin", "dev");
  prepareRoot(root, undefined, remote);
  assert.equal(git(root, "rev-parse", "--abbrev-ref", "@{u}"), "origin/main");
});

test("仅 Fetch 配置分支；远端删除后仍能使用本地分支，旧跟踪记录不算远端存在", t => {
  const { root, bare, remote } = fixture(t);
  prepareRoot(root, undefined, remote);
  assert.equal(git(root, "for-each-ref", "--format=%(refname)", "refs/remotes"), "refs/remotes/origin/main");
  const base = git(root, "rev-parse", "HEAD");
  git(bare, "update-ref", "-d", "refs/heads/main");
  assert.equal(prepareRoot(root, undefined, remote).remote_commit, null);
  assert.equal(git(root, "rev-parse", "HEAD"), base);
  git(root, "switch", "dev");
  git(root, "branch", "-D", "main");
  assert.throws(() => prepareRoot(root, undefined, remote), /本地与远端均无.*main/);
  assert.equal(git(root, "branch", "--show-current"), "dev");
});

test("将要切换的分支正在 Merge 时保留 MERGE_HEAD、暂存版本及工作区", t => {
  const { root, remote } = fixture(t);
  git(root, "switch", "-c", "other");
  put(root, "other", "from merged branch");
  git(root, "add", "other");
  git(root, "commit", "-m", "other commit");
  git(root, "switch", "dev");
  git(root, "merge", "--no-ff", "--no-commit", "other");
  const mergeHead = git(root, "rev-parse", "MERGE_HEAD");
  const head = git(root, "rev-parse", "HEAD");
  const task = "openspec/changes/a/tasks.md";
  put(root, task, "index");
  git(root, "add", task);
  put(root, task, "worktree");
  const index = git(root, "write-tree");

  assert.throws(() => prepareRoot(root, undefined, remote), /MERGE_HEAD/);
  assert.equal(git(root, "rev-parse", "MERGE_HEAD"), mergeHead);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
  assert.equal(git(root, "write-tree"), index);
  assert.equal(readFileSync(join(root, task), "utf8"), "worktree");
});

test("共享 Index 持续占用时只尝试三次，释放后可安全重入", t => {
  const { root, remote } = fixture(t);
  const pending = "openspec/changes/a/pending.md";
  put(root, pending, "work in progress");
  const head = git(root, "rev-parse", "HEAD");
  const lock = join(root, ".git", "index.lock");
  writeFileSync(lock, "fixture lock owner");
  let attempts = 0;
  t.mock.method(process.stderr, "write", line => {
    if (String(line).startsWith("$ git --literal-pathspecs add ")) attempts++;
    return true;
  });
  assert.throws(() => prepareRoot(root, undefined, remote), /index\.lock/);
  assert.equal(attempts, 3);
  assert.equal(readFileSync(lock, "utf8"), "fixture lock owner");
  assert.equal(git(root, "rev-parse", "HEAD"), head);
  assert.equal(git(root, "status", "--porcelain"), "?? " + pending);
  rmSync(lock);
  prepareRoot(root, undefined, remote);
  assert.equal(git(root, "show", "dev:" + pending), "work in progress");
  assert.equal(git(root, "rev-list", "--count", head + "..dev"), "1");
});

test("原分支删除最后一个 Change 时，先保存删除并切换到有效的目标根仓", t => {
  const { root, remote } = fixture(t);
  rmSync(join(root, "openspec", "changes"), { recursive: true });
  rmSync(join(root, "docs/config/repo-context.yaml"));
  const result = prepareRoot(root, undefined, remote);
  assert.equal(result.branch, "main");
  assert.equal(git(root, "ls-tree", "dev", "--", "openspec/changes", "docs/config/repo-context.yaml"), "");
  assert.equal(readFileSync(join(root, "openspec/changes/a/tasks.md"), "utf8"), "initial\n");
});

test("目标分支缺少 Schema 时，保存 WIP 前报告失败", t => {
  const { root, bare, remote } = fixture(t);
  git(root, "switch", "-c", "main");
  git(root, "rm", "-r", "openspec/schemas");
  git(root, "commit", "-m", "target without schemas");
  git(root, "push", bare, "main");
  git(root, "switch", "dev");
  put(root, "pending.md", "local WIP");
  const current = git(root, "rev-parse", "HEAD"), index = git(root, "write-tree");
  assert.throws(() => prepareRoot(root, undefined, remote), /openspec\/schemas/);
  assert.equal(git(root, "branch", "--show-current"), "dev");
  assert.equal(git(root, "rev-parse", "HEAD"), current);
  assert.equal(git(root, "write-tree"), index);
  assert.equal(readFileSync(join(root, "pending.md"), "utf8"), "local WIP");
});

test("目标分支可删除旧仓库映射；真实 fetch/push Origin 必须一致", t => {
  const { root, bare, remote } = fixture(t);
  prepareRoot(root, undefined, remote);
  git(root, "switch", "-c", "remote-edit");
  git(root, "rm", "docs/config/repo-context.yaml");
  git(root, "commit", "-m", "remove obsolete repo mapping");
  git(root, "push", bare, "HEAD:refs/heads/main");
  git(root, "switch", "main");
  assert.equal(prepareRoot(root, undefined, remote).branch, "main");
  assert.equal(git(root, "rev-parse", "HEAD"), git(bare, "rev-parse", "main"));
  assert.equal(requirementRoot(root), git(root, "rev-parse", "--show-toplevel"));
  git(root, "remote", "set-url", "--push", "origin", "http://tfs.test/tfs/C/P/_git/other");
  assert.throws(() => prepareRoot(root, undefined, remote), /Origin.*Push URL/);
});

test("已在目标分支时保留工作区对最后一个 Change 的删除", t => {
  const { root, remote } = fixture(t);
  prepareRoot(root, undefined, remote);
  rmSync(join(root, "openspec/changes"), { recursive: true });
  const before = git(root, "status", "--porcelain");
  assert.equal(prepareRoot(root, undefined, remote).preserved_wip, true);
  assert.equal(git(root, "status", "--porcelain"), before);
  assert.throws(() => requirementRoot(root), /openspec\/changes/);
});

test("Sparse Checkout 省略 Schema 时不能报告根仓准备完成", t => {
  const { root, remote } = fixture(t);
  prepareRoot(root, undefined, remote);
  git(root, "sparse-checkout", "set", "docs/config", "openspec/changes");
  assert.equal(git(root, "status", "--porcelain"), "");
  assert.throws(() => prepareRoot(root, undefined, remote), /openspec\/schemas/);
});

for (const operation of ["rebase", "bisect"]) {
  test(`目标分支在另一 Worktree 执行 ${operation} 时，保存前报告占用现场`, t => {
    const { root, dir, remote } = fixture(t);
    const other = join(dir, "occupied worktree");
    git(root, "worktree", "add", "-b", "main", other);
    const task = "openspec/changes/a/tasks.md";
    if (operation === "rebase") {
      put(other, task, "conflicting main");
      git(other, "commit", "-am", "main edit");
      put(root, task, "conflicting dev");
      git(root, "commit", "-am", "dev edit");
      assert.equal(spawnSync("git", ["rebase", "dev"], { cwd: other }).status, 1);
    } else {
      for (let i = 0; i < 3; i++) git(other, "commit", "--allow-empty", "-m", "bisect sample");
      git(other, "bisect", "start", "HEAD", "HEAD~3");
    }
    assert.equal(git(other, "branch", "--show-current"), "");
    put(root, task, "staged");
    git(root, "add", task);
    put(root, task, "working");
    const head = git(root, "rev-parse", "HEAD");
    const index = git(root, "write-tree");
    const fetchHead = git(root, "rev-parse", "--path-format=absolute", "--git-path", "FETCH_HEAD");
    let fetched;
    const fetch = (...args) => {
      const result = remote(...args);
      fetched = readFileSync(fetchHead);
      return result;
    };
    assert.throws(() => prepareRoot(root, undefined, fetch), error =>
      error.message.includes("main") && error.message.includes("occupied worktree"));
    assert.equal(git(root, "rev-parse", "HEAD"), head);
    assert.equal(git(root, "write-tree"), index);
    assert.equal(readFileSync(join(root, task), "utf8"), "working");
    assert.deepEqual(readFileSync(fetchHead), fetched);
  });
}
