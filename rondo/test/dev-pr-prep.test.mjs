import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const MOCK = fileURLToPath(new URL("./mock-multica.cjs", import.meta.url));
const SHA_OTHER = "b".repeat(40);
const SHA_WRONG = "c".repeat(40);
const OTHER_ENTRY = { repo_key: "other-repo", source_branch: "feat/1", candidate_commit: SHA_OTHER, title: "Other PR" };

function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", env: { ...process.env, ...env },
  });
  assert.equal(result.error, undefined, result.error?.message);
  let body;
  try { body = JSON.parse(result.stdout); }
  catch { assert.fail("CLI did not produce JSON: " + result.stdout + "\n" + result.stderr); }
  return { exit: result.status, body, stderr: result.stderr };
}

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * fixture：bare remote + 根仓（git 仓，含 openspec/）+ 枢纽克隆（rootRepo/hub-clone，origin=remote）。
 * 桩 multica 经 MOCK_STATE 持有 Issue metadata；根仓路径由调用者显式传入。
 */
function fixture(t, { tfsId = "261056", seedPrep = null } = {}) {
  // realpathSync.native：Windows tmpdir 返回 8.3 短名（普通 realpath 不解析），
  // CLI 侧经 git --show-toplevel 归一为长名，两边必须同形态
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "skill-flow-pr-prepare-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const repoUrl = "http://tfs.test/tfs/C/P/_git/biz";
  const remote = join(dir, "remote.git");
  mkdirSync(remote);
  git(remote, "init", "--bare");

  const rootRepo = join(dir, "root-repo");
  mkdirSync(join(rootRepo, "openspec", "changes", "sample"), { recursive: true });
  git(rootRepo, "init");
  git(rootRepo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init");

  const hub = join(rootRepo, "hub-clone");
  mkdirSync(hub);
  git(hub, "init");
  git(hub, "remote", "add", "origin", remote);
  writeFileSync(join(hub, "a.txt"), "v1\n");
  git(hub, "add", "a.txt");
  git(hub, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "c1");
  git(hub, "branch", "-M", "main");
  git(hub, "push", "origin", "main");
  git(hub, "checkout", "-b", `feat/${tfsId}`);
  writeFileSync(join(hub, "a.txt"), "v2\n");
  git(hub, "commit", "-am", "c2");
  git(hub, "push", "origin", `feat/${tfsId}`);
  const head = git(hub, "rev-parse", `feat/${tfsId}`);
  git(hub, "remote", "set-url", "origin", repoUrl);
  const transport = join(dir, "git-transport.cjs");
  writeFileSync(transport, `#!/usr/bin/env node\nconst {spawnSync}=require("node:child_process");\nconst args=process.argv.slice(2);\nif(args[0]==="ls-remote" && args[1]==="origin") args[1]=${JSON.stringify(remote)};\nconst r=spawnSync("git",args,{stdio:"inherit"});\nprocess.exit(r.status??1);\n`, {mode:0o755});

  chmodSync(MOCK, 0o755);
  const config = join(dir, "registry.json");
  writeFileSync(config, JSON.stringify({
    runtime: { multica_cli: MOCK, workspace_id: "ws-test" },
    registry: { "datamodel-web": { repo_path: "hub-clone", repo_url: repoUrl, default_target_branch: "main" } },
  }));

  const statePath = join(dir, "state.json");
  const metadata = { "tfs.id": tfsId };
  if (seedPrep) metadata["pr_prep"] = JSON.stringify(seedPrep);
  writeFileSync(statePath, JSON.stringify({ metadata, project_resources: [] }));

  const callsPath = join(dir, "calls.jsonl");
  const env = { MOCK_STATE: statePath, MOCK_SYNC_CALLS_FILE: callsPath, TFS_SERVER_URL: "http://tfs.test/tfs/C", TFS_PAT: "fixture", RONDO_GIT_EXECUTABLE: transport };
  const descPath = join(rootRepo, "openspec", "changes", "sample", "pr-description-datamodel-web.md");
  const run = (over = {}) => runCli([
    "dev", "pr-prepare", "--config", config, "--issue", "WNDF-T", "--repo", "datamodel-web",
    "--root-repo", rootRepo,
    "--change-ref", "sample", "--candidate-commit", over.sha ?? head,
    "--title", over.title ?? "测试 PR", ...(over.extra ?? []),
  ], env);
  const state = () => JSON.parse(readFileSync(statePath, "utf8"));
  const calls = () => readFileSync(callsPath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  return { head, descPath, run, state, calls };
}

test("PASS 合并写入保留他仓条目并搭架描述文件", (t) => {
  const f = fixture(t, { seedPrep: [OTHER_ENTRY] });
  const r = f.run();
  assert.equal(r.exit, 0, r.stderr);
  assert.equal(r.body.result, "PASS");
  assert.equal(r.body.head, f.head);
  assert.equal(r.body.description_scaffolded, true);
  assert.deepEqual(r.body.preserved_repo_keys, ["other-repo"]);
  assert.equal(r.body.pr_prep_size, 2);

  const prep = JSON.parse(f.state().metadata["pr_prep"]);
  assert.equal(prep.length, 2);
  assert.deepEqual(prep.find((e) => e.repo_key === "other-repo"), OTHER_ENTRY);
  const mine = prep.find((e) => e.repo_key === "datamodel-web");
  assert.equal(mine.source_branch, "feat/261056");
  assert.equal(mine.repo_url, "http://tfs.test/tfs/C/P/_git/biz");
  assert.equal(mine.target_branch, "main");
  assert.equal(mine.candidate_commit, f.head);
  assert.equal(mine.title, "测试 PR");
  assert.equal(mine.description_ref, `file:${f.descPath}`);
  assert.equal(existsSync(f.descPath), true);
  assert.equal(f.calls().some(args => args[0] === "project"), false, "准备 PR 不应重新发现根仓挂载");
});

test("缺少 --root-repo 在访问平台或写入事实前返回用法错误", () => {
  const r = spawnSync(process.execPath, [CLI, "dev", "pr-prepare", "--config", "missing.json",
    "--issue", "WNDF-T", "--repo", "datamodel-web", "--change-ref", "sample",
    "--candidate-commit", SHA_OTHER, "--title", "测试"], { encoding: "utf8" });
  assert.equal(r.status, 64);
  assert.match(r.stderr, /--root-repo/);
});

test("HEAD 不一致 FAIL 且不写 metadata", (t) => {
  const f = fixture(t);
  const r = f.run({ sha: SHA_WRONG });
  assert.equal(r.exit, 2);
  assert.equal(r.body.result, "FAIL");
  assert.equal(r.body.code, "head_mismatch");
  assert.equal(f.state().metadata["pr_prep"], undefined);
});

test("远端分支不存在 FAIL", (t) => {
  const f = fixture(t);
  const r = f.run({ extra: ["--source-branch", "feat/nonexistent"] });
  assert.equal(r.exit, 2);
  assert.equal(r.body.code, "source_branch_not_found");
  assert.equal(f.state().metadata["pr_prep"], undefined);
});

test("candidate_commit 非 40 位 SHA FAIL", (t) => {
  const f = fixture(t);
  const r = f.run({ sha: "abc1234" });
  assert.equal(r.exit, 2);
  assert.equal(r.body.code, "invalid_candidate_commit");
});

test("重跑幂等：本仓条目替换不重复，既有描述文件不改写", (t) => {
  const f = fixture(t, { seedPrep: [OTHER_ENTRY] });
  assert.equal(f.run().body.result, "PASS");
  writeFileSync(f.descPath, "# 人工撰写的语义描述\n");
  const r = f.run({ title: "测试 PR 改题" });
  assert.equal(r.exit, 0);
  assert.equal(r.body.description_scaffolded, false);
  assert.equal(readFileSync(f.descPath, "utf8"), "# 人工撰写的语义描述\n");
  const prep = JSON.parse(f.state().metadata["pr_prep"]);
  assert.equal(prep.length, 2);
  assert.equal(prep.filter((e) => e.repo_key === "datamodel-web").length, 1);
  assert.equal(prep.find((e) => e.repo_key === "datamodel-web").title, "测试 PR 改题");
});
