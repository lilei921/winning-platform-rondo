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
  change: ["resolve-identity"],
  analysis: ["validate", "publish", "read", "approve"],
  dev: ["git", "prepare", "publish"],
  bug: ["resume"],
  tfs: ["writeback", "reconcile-workitem"],
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

test("命令总数 = 39", () => {
  const total = Object.values(TREE).reduce((n, leaves) => n + leaves.length, 0) + 2 /* query + doctor */;
  assert.equal(total, 39);
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

test("全局 --output json 由 Commander 统一消费，不改变子命令输出和退出码", () => {
  for (const args of [["change", "resolve-identity", "--help"], ["dev", "publish", "--help"], ["runtime", "resolve-root-repo"], ["query"]]) {
    const implicit = runCli(args);
    for (const explicitArgs of [["--output=json", ...args], [...args, "--output", "json"]]) {
      const explicit = runCli(explicitArgs);
      assert.equal(explicit.status, implicit.status, explicitArgs.join(" "));
      assert.equal(explicit.stdout, implicit.stdout, explicitArgs.join(" "));
    }
  }
  for (const args of [["change", "resolve-identity"], ["runtime", "check-checkout"], ["query"], ["doctor"]]) {
    for (const flags of [["--output", "table"], ["--output"]]) {
      const result = runCli([...args, ...flags]);
      assert.equal(result.status, 64);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /--output/);
    }
  }
});

test("doctor 默认文本，统一 JSON 输出兼容原 --format json，冲突拒绝", () => {
  const args = ["doctor", "--require", "node_runtime"];
  const plain = runCli(args);
  const explicit = runCli([...args, "--output", "json"]);
  const legacy = runCli([...args, "--format", "json"]);
  assert.equal(explicit.status, legacy.status);
  assert.equal(plain.status, legacy.status);
  assert.throws(() => JSON.parse(plain.stdout));
  const { duration_ms: _a, ...actual } = JSON.parse(explicit.stdout);
  const { duration_ms: _b, ...expected } = JSON.parse(legacy.stdout);
  assert.deepEqual(actual, expected);
  const conflict = runCli([...args, "--output", "json", "--format", "text"]);
  assert.equal(conflict.status, 64);
  assert.match(conflict.stderr, /冲突/);
});

test("retired stage and handoff are not public commands", () => {
  for (const args of [["analysis", "stage"], ["delivery", "handoff"]]) assert.notEqual(runCli(args).status, 0);
  for (const args of [["analysis", "validate"], ["analysis", "publish"], ["delivery", "admission"]]) assert.equal(runCli([...args, "--help"]).status, 0);
});

test("P0 退役独立进度与完成检查，研发命令不再接受 Change 参数", () => {
  const help = runCli(["dev", "--help"]);
  assert.equal(help.status, 0);
  for (const command of ["check-completion", "contract-hash"]) {
    assert.ok(!(help.stdout + help.stderr).includes(command));
    assert.notEqual(runCli(["dev", command]).status, 0);
  }
  for (const args of [["change", "update-progress"], ["dev", "check-change"]]) assert.notEqual(runCli(args).status, 0, args.join(" "));
  for (const command of ["prepare", "publish"]) {
    const help = runCli(["dev", command, "--help"]);
    assert.equal(help.status, 0);
    assert.doesNotMatch(help.stdout + help.stderr, /--change-ref/);
    const args = ["dev", command, "--issue", "X", ...(command === "prepare" ? ["--repo", "biz"] : []), "--change-ref", "old"];
    const rejected = runCli(args);
    assert.equal(rejected.status, 64, args.join(" "));
    assert.match(rejected.stderr, /--change-ref/);
  }
});

test("retired Task Set commands are not registered", () => {
  for (const args of [["dev","materialize"],["dev","check-dispatch"],["tfs","materialize-tasks"],["tfs","resolve-tasks"]]) {
    assert.notEqual(runCli(args).status,0);
    assert.doesNotMatch(runCli([args[0]]).stderr,new RegExp("  "+args[1]+"(?: |\\n)"));
  }
});
