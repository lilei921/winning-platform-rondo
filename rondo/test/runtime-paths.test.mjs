import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRuntimePaths, validateRootRepo } from "../dist/clients/runtime-paths.js";
import { UnknownError } from "../dist/cli/errors.js";
import { git as repoGit } from "../dist/clients/git.js";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

// 使用真实 Git 验证根仓身份；工作目录交给进程启动器，避免测试准备也触发 Git -C 故障。
function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t) {
  const base = realpathSync.native(tmpdir());
  const dir = realpathSync.native(mkdtempSync(join(base, "rondo-root-")));
  t.after(() => {
    // 只删除本测试创建的临时目录，禁止扩大清理范围。
    assert.equal(dirname(dir), base);
    rmSync(dir, { recursive: true, force: true });
  });
  const repo = join(dir, "中文 repo");
  mkdirSync(repo);
  git(repo, "init");
  return { dir, repo };
}

test("Git 根仓支持中文和空格路径，返回规范根路径且不改变主进程 cwd", (t) => {
  const { repo } = fixture(t);
  const before = process.cwd();
  assert.equal(validateRootRepo(repo, "测试"), git(repo, "rev-parse", "--show-toplevel"));
  assert.equal(process.cwd(), before);
});

test("仓内普通子目录不能冒充根仓", (t) => {
  const { repo } = fixture(t);
  const nested = join(repo, "nested");
  mkdirSync(nested);
  assert.throws(() => validateRootRepo(nested, "测试"), /不是 Git 根仓/);
});

test("非 Git 目录、文件和不存在的目录均拒绝", (t) => {
  const { dir } = fixture(t);
  const file = join(dir, "plain.txt");
  writeFileSync(file, "test");
  for (const candidate of [dir, file, join(dir, "missing")]) {
    assert.throws(() => validateRootRepo(candidate, "测试"), UnknownError);
  }
  assert.throws(() => validateRootRepo("relative", "RONDO_WORKSPACE_PATH"), /不是当前系统语义下的绝对路径/);
  assert.throws(() => validateRootRepo("", "--root-repo"), /根仓路径为空/);
});

test("linked worktree 的 .git 文件仍被识别为合法根仓", (t) => {
  const { dir, repo } = fixture(t);
  git(repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "fixture");
  const worktree = join(dir, "linked");
  git(repo, "worktree", "add", "--detach", worktree, "HEAD");
  assert.equal(validateRootRepo(worktree, "测试"), git(worktree, "rev-parse", "--show-toplevel"));
});

test("目录链接返回 Git 规范根路径", (t) => {
  const { dir, repo } = fixture(t);
  const link = join(dir, "alias");
  symlinkSync(repo, link, process.platform === "win32" ? "junction" : "dir");
  assert.equal(validateRootRepo(link, "测试"), git(link, "rev-parse", "--show-toplevel"));
});

test("显式根仓不读取 Multica 配置或运行身份，并按需派生 OpenSpec 路径", (t) => {
  const { repo } = fixture(t);
  mkdirSync(join(repo, "openspec"));
  const cfg = { get runtime() { throw new Error("本地路径检查不得读取平台配置"); } };
  const paths = resolveRuntimePaths(cfg, { rootRepoArg: repo, need: ["openspec"] });
  assert.equal(paths.rootRepo, git(repo, "rev-parse", "--show-toplevel"));
  assert.equal(paths.openspecRoot, join(paths.rootRepo, "openspec"));
  assert.equal(paths.source, "explicit_arg");
  assert.equal(paths.daemonId, null);
});

test("缺少显式根仓直接拒绝，不查询 Project 挂载或隐式沿用 cwd", () => {
  const cfg = { get runtime() { throw new Error("不得尝试平台发现"); } };
  assert.throws(() => resolveRuntimePaths(cfg, { issue: { project_id: "project" } }), /必须显式传入 --root-repo/);
});

test("持久环境路径要求绝对路径", (t) => {
  const { repo } = fixture(t);
  assert.equal(resolveRuntimePaths({}, { rootRepoArg: repo, rootRepoOrigin: "RONDO_WORKSPACE_PATH" }).rootRepo, git(repo, "rev-parse", "--show-toplevel"));
  assert.throws(() => resolveRuntimePaths({}, { rootRepoArg: ".", rootRepoOrigin: "RONDO_WORKSPACE_PATH" }), /绝对路径.*RONDO_WORKSPACE_PATH/);
});

test("调用需要 OpenSpec 时拒绝缺少该目录的根仓", (t) => {
  const { repo } = fixture(t);
  assert.throws(() => resolveRuntimePaths({}, { rootRepoArg: repo, need: ["openspec"] }), /openspec\/ 目录不存在/);
});

test("继承的 Git 定位环境变量不能将显式根仓导向其他目录", (t) => {
  const { dir, repo } = fixture(t);
  const other = join(dir, "other");
  mkdirSync(other);
  git(other, "init");
  const expected = git(repo, "rev-parse", "--show-toplevel");
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  process.env.GIT_DIR = join(other, ".git");
  process.env.GIT_WORK_TREE = other;
  assert.equal(validateRootRepo(repo, "环境隔离"), expected);
});

test("本地根仓 CLI 无需平台配置即可解析；缺少显式路径不尝试发现", (t) => {
  const { repo } = fixture(t);
  mkdirSync(join(repo, "docs", "config"), { recursive: true });
  writeFileSync(join(repo, "docs", "config", "repo-context.yaml"), "repos: []\n");
  const r = spawnSync(process.execPath, [CLI, "runtime", "resolve-root-repo", "--root-repo", repo], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).root_repo, git(repo, "rev-parse", "--show-toplevel"));
  for (const [cwd, arg] of [[repo, "."], [dirname(repo), "中文 repo"]]) {
    const relative = spawnSync(process.execPath, [CLI, "runtime", "resolve-root-repo", "--root-repo", arg], { cwd, encoding: "utf8" });
    assert.equal(relative.status, 0, relative.stderr);
    assert.deepEqual(JSON.parse(relative.stdout), JSON.parse(r.stdout));
  }
  mkdirSync(join(repo, "nested"));
  const nested = spawnSync(process.execPath, [CLI, "runtime", "resolve-root-repo", "--root-repo", "nested"], { cwd: repo, encoding: "utf8" });
  assert.equal(nested.status, 3);
  assert.match(JSON.parse(nested.stdout).reason, /不是 Git 根仓/);
  const missing = spawnSync(process.execPath, [CLI, "runtime", "resolve-root-repo"], { encoding: "utf8" });
  assert.equal(missing.status, 64);
  assert.match(missing.stderr, /--root-repo/);
  const help = spawnSync(process.execPath, [CLI, "runtime", "resolve-root-repo", "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--root-repo/);
});

// 现场回归只读既有仓库；不创建文件，不改变沙箱权限。普通环境无需该外部仓库。
const readonlyRoot = process.env.RONDO_TEST_READONLY_ROOT;
const readonlyHub = process.env.RONDO_TEST_READONLY_HUB;
test("现场只读根仓在沙箱中可通过进程 cwd 校验", { skip: !readonlyRoot }, () => {
  const root = resolve(readonlyRoot);
  const before = process.cwd();
  assert.equal(validateRootRepo(root, "现场只读回归"), git(root, "rev-parse", "--show-toplevel"));
  assert.equal(process.cwd(), before, "根仓检查不得改变 Lead 的运行目录");
});

// 复现 Lead 跨目录读取业务仓分支；同时验证共享 Git 封装和根仓校验的不同调用路径。
test("现场只读业务仓可通过子进程 cwd 读取分支且不改变 Lead 目录", { skip: !readonlyHub }, () => {
  const hub = resolve(readonlyHub);
  const before = process.cwd();
  const result = repoGit(hub, ["rev-parse", "--abbrev-ref", "HEAD"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), git(hub, "rev-parse", "--abbrev-ref", "HEAD"));
  assert.notEqual(result.stdout.trim(), "");
  assert.equal(process.cwd(), before);
});

test("prepare-root 显式空路径不回退持久环境变量", t => {
  const { repo } = fixture(t);
  const r = spawnSync(process.execPath, [CLI, "runtime", "prepare-root", "--root-repo", ""], {
    cwd: repo, encoding: "utf8", env: { ...process.env, RONDO_WORKSPACE_PATH: repo, RONDO_WORKSPACE_BRANCH: "dev" },
  });
  assert.equal(r.status, 3, r.stderr);
  assert.match(JSON.parse(r.stdout).reason, /根仓路径为空/);
});
