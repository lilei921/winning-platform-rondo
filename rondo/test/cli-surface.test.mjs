import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", env: { ...process.env, ...env },
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

/** 当前完整命令树；包含 analysis read 和顶层叶子 doctor。 */
const TREE = {
  analysis: ["validate", "publish", "read", "approve"],
  dev: ["git", "publish"],
  pr: ["prepare", "materialize", "resume", "reconcile-status", "create", "get", "list"],
  delivery: [ "finalize", "root-prepare", "admission"],
  workspace: ["provision", "sync", "check-daemon"],
  runtime: ["get-context","check-checkout"],
  openspec: ["resolve-identity", "install-schema"],
  repo: ["get", "get-branch"],
  workitem: ["sync", "writeback", "query", "set-state", "comment", "create", "link-commits", "download-attachment"],
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

test("workitem query:缺 --wiql exit 64,用法走 stderr,stdout 纯净", () => {
  const r = runCli(["workitem", "query"]);
  assert.equal(r.status, 64);
  assert.equal(r.stdout, "");
  assert.ok(r.stderr.includes("--wiql"));
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
  const r = runCli(["repo", "get", "--repo", "anything"], {
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
  for (const group of ["dev"]) {
    const help = runCli([group]);
    assert.doesNotMatch(help.stderr, /\bpr-prepare\b/);
    assert.doesNotMatch(help.stderr, /(?:^|\s)(?:pr-prep|prepare-pr)(?=\s|$)/m);
  }
  for (const args of [["dev", "pr-prepare"], ["bug", "pr-prepare"], ["bug", "git"], ["dev", "pr-prep"], ["bug", "prepare-pr"], ["pr","materialize","--issue","X","--config","unused"], ["delivery", "finalize", "--phase", "prepare", "--issue", "X", "--config", "unused"], ["workitem", "writeback", "--issue", "X", "--config", "unused"]]) {
    assert.notEqual(runCli(args).status, 0, args.join(" "));
  }
});

test("全局 --output json 由 Commander 统一消费，不改变子命令输出和退出码", () => {
  for (const args of [["openspec", "resolve-identity", "--help"], ["dev", "publish", "--help"], ["runtime", "check-checkout"], ["workitem", "query"]]) {
    const implicit = runCli(args);
    for (const explicitArgs of [["--output=json", ...args], [...args, "--output", "json"]]) {
      const explicit = runCli(explicitArgs);
      assert.equal(explicit.status, implicit.status, explicitArgs.join(" "));
      assert.equal(explicit.stdout, implicit.stdout, explicitArgs.join(" "));
    }
  }
  for (const args of [["openspec", "resolve-identity"], ["runtime", "check-checkout"], ["workitem", "query"], ["doctor"]]) {
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
  assert.doesNotMatch(help.stdout + help.stderr, /\bprepare\b/);
  for (const command of ["publish"]) {
    const help = runCli(["dev", command, "--help"]);
    assert.equal(help.status, 0);
    assert.doesNotMatch(help.stdout + help.stderr, /--change-ref/);
    const args = ["dev", command, "--issue", "X", "--change-ref", "old"];
    const rejected = runCli(args);
    assert.notEqual(rejected.status, 0, args.join(" "));
    assert.match(rejected.stderr, /--change-ref/);
  }
});

test("retired Task Set commands are not registered", () => {
  for (const args of [["dev","materialize"],["dev","check-dispatch"],["tfs","materialize-tasks"],["tfs","resolve-tasks"]]) {
    assert.notEqual(runCli(args).status,0);
    assert.doesNotMatch(runCli([args[0]]).stderr,new RegExp("  "+args[1]+"(?: |\\n)"));
  }
});

test("PR recovery only exposes pr resume", () => {
  assert.equal(runCli(["pr","resume","--help"]).status,0);
  assert.notEqual(runCli(["delivery","route-decision"]).status,0);
  assert.notEqual(runCli(["bug","resume"]).status,0);
});

test("全部公开命令 --help / -h 输出帮助到 stdout，exit 0 且不执行安装", () => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-cli-help-"));
  try {
    const commands = [[], ["doctor"], ...Object.entries(TREE).flatMap(
      ([group, leaves]) => [[group], ...leaves.map(leaf => [group, leaf])]
    )];
    for (const args of commands) {
      for (const flag of ["--help", "-h"]) {
        const r = runCli([...args, flag], { XDG_DATA_HOME: dir, TFS_PAT: "", MULTICA_WORKSPACE_ID: "", MULTICA_SERVER_URL: "" });
        const label = [...args, flag].join(" ");
        assert.equal(r.status, 0, label + ": " + r.stderr);
        assert.match(r.stdout, /(?:usage|用法)/i, label);
        assert.equal(r.stderr, "", label);
      }
    }
    assert.equal(existsSync(join(dir, "openspec")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Help 不执行带有效业务参数的写操作", () => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-cli-help-"));
  try {
    const r = runCli(["openspec", "install-schema", "--help"], { XDG_DATA_HOME: dir });
    assert.equal(r.status, 0);
    assert.equal(existsSync(join(dir, "openspec")), false);
    const w = runCli(["workitem", "writeback", "--issue", "TEST-1", "--help"], { MULTICA_WORKSPACE_ID: "", MULTICA_SERVER_URL: "" });
    assert.equal(w.status, 0, w.stderr);
    assert.match(w.stdout, /usage/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("OpenSpec 仅保留统一命令组，不注册旧入口", () => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-help-"));
  try {
    for (const args of [["change", "resolve-identity"], ["openspec", "install"]]) {
      const r = runCli(args, { XDG_DATA_HOME: dir });
      assert.equal(r.status, 64, args.join(" "));
    }
    assert.equal(existsSync(join(dir, "openspec")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("退役入口不再公开", () => {
  for (const args of [["branch","get"],["query"],["delivery","root-clone"],["runtime","prepare-root"],["runtime","resolve-root-repo"],["pr","worktree"],["tfs"],["tfs","reconcile-workitem"],["tfs","writeback"],["workitem","reconcile-workitem"]]) {
    assert.equal(runCli(args).status,64,args.join(" "));
  }
  const missing = runCli(["repo","get-branch","--repo","example"]);
  assert.equal(missing.status,64);
  assert.match(missing.stderr,/--branch/);
});

test("workitem sync 只接受 WIQL 参数；workspace sync 拒绝已移除的 local-only", () => {
  for (const args of [["workitem","sync"],["workitem","sync","--config","old.json"],["workspace","sync","--workspace","pilot","--local-only"]]) assert.equal(runCli(args).status,64,args.join(" "));
});
