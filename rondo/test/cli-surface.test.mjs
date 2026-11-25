import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", env: { ...process.env, ...env },
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

/** 当前完整命令树；包含 analysis read 和顶层叶子 query/doctor。 */
const TREE = {
  change: ["resolve-identity", "update-progress"],
  analysis: ["validate", "complete", "read"],
  dev: ["check-dispatch", "materialize", "git", "prepare", "check-completion", "check-change", "publish", "contract-hash"],
  bug: ["resume"],
  tfs: ["writeback", "materialize-tasks", "resolve-tasks", "reconcile-workitem"],
  pr: ["prepare", "materialize", "worktree", "reconcile-status", "create", "get", "list"],
  delivery: ["route-decision", "finalize", "root-prepare", "admission"],
  workspace: ["provision", "sync", "migrate-repo-keys", "check-daemon"],
  runtime: ["resolve-root-repo","prepare-root","get-context","check-checkout"],
  repo: ["get"],
  branch: ["get"],
  workitem: ["set-state", "comment", "create", "link-commits", "download-attachment"],
};

test("全部命令组:bare 调用 exit 64,stderr 帮助列出全部叶子", () => {
  for (const [group, leaves] of Object.entries(TREE)) {
    const r = runCli([group]);
    assert.equal(r.status, 64, `${group} rc=${r.status} stderr=${r.stderr.slice(0, 300)}`);
    for (const leaf of leaves) {
      assert.ok(r.stderr.includes(leaf), `${group} 帮助缺少叶子 ${leaf}: ${r.stderr.slice(0, 500)}`);
    }
  }
});

test("顶层叶子 query:缺 --wiql exit 64,用法走 stderr,stdout 纯净", () => {
  const r = runCli(["query"]);
  assert.equal(r.status, 64);
  assert.equal(r.stdout, "");
  assert.ok(r.stderr.includes("--wiql"));
});

test("命令总数 = 47", () => {
  const total = Object.values(TREE).reduce((n, leaves) => n + leaves.length, 0) + 2 /* query + doctor */;
  assert.equal(total, 47);
});

test("--version 输出 JSON:name/version/node/sea,exit 0", () => {
  const r = runCli(["--version"]);
  assert.equal(r.status, 0);
  const body = JSON.parse(r.stdout);
  assert.equal(body.name, "@winning/rondo");
  assert.equal(typeof body.version, "string");
  assert.equal(typeof body.node, "string");
  assert.equal(body.sea, false);
});

test("TFS 配置缺失:exit 3 且 stdout 为 {unknown:true}(ConfigError → UNKNOWN)", () => {
  const r = runCli(["repo", "get", "--name", "anything"], {
    TFS_PAT: "", TFS_URL: "", TFS_SERVER_URL: "", TFS_COLLECTION: "", TFS_PROJECT: "",
  });
  assert.equal(r.status, 3, `rc=${r.status} stdout=${r.stdout.slice(0, 300)}`);
  const body = JSON.parse(r.stdout);
  assert.equal(body.unknown, true);
  assert.equal(typeof body.reason, "string");
});

test("workitem 叶子参数错误:exit 64(set-state 缺 --id/--state)", () => {
  const r = runCli(["workitem", "set-state"], {
    TFS_PAT: "x", TFS_URL: "http://localhost:1",
  });
  assert.equal(r.status, 64);
  assert.equal(r.stdout, "");
});

test("delivery root-prepare 不要求 --config，从当前 Runtime 解析环境", () => {
  const r = runCli(["delivery", "root-prepare", "--issue", "TEST-1"], {
    MULTICA_WORKSPACE_ID: "", MULTICA_SERVER_URL: "",
  });
  assert.equal(r.status, 3, `rc=${r.status} stdout=${r.stdout.slice(0, 300)}`);
  const body = JSON.parse(r.stdout);
  assert.equal(body.result, "UNKNOWN");
  assert.match(body.reason, /MULTICA_WORKSPACE_ID.*MULTICA_SERVER_URL/);
});


test("PR Preparation 命名统一，Closeout 拒绝旧配置参数", () => {
  for (const group of ["dev", "bug"]) {
    const help = runCli([group]);
    assert.doesNotMatch(help.stderr, /\bpr-prepare\b/);
    assert.doesNotMatch(help.stderr, /(?:^|\s)(?:pr-prep|prepare-pr)(?=\s|$)/m);
  }
  for (const args of [["dev", "pr-prepare"], ["bug", "pr-prepare"], ["bug", "git"], ["dev", "pr-prep"], ["bug", "prepare-pr"], ["pr","materialize","--issue","X","--config","unused"], ["delivery", "finalize", "--phase", "prepare", "--issue", "X", "--config", "unused"], ["tfs", "writeback", "--issue", "X", "--config", "unused"]]) {
    assert.notEqual(runCli(args).status, 0, args.join(" "));
  }
});
