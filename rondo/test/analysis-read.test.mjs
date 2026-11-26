import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analysisTfsFixture } from "./analysis-tfs-fixture.mjs";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const MOCK = fileURLToPath(new URL("./mock-multica.cjs", import.meta.url));
const content = "# Tasks\n\n- [ ] 1.1 中文任务\n  - 验收：保持多行正文\n- [x] 1.2 已完成\n";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "rondo-analysis-read-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = "/openspec/changes/fix-101/tasks.md";
  const commit = "a".repeat(40);
  const tfs = analysisTfsFixture(t, dir, { versions: { [commit]: { [path]: content } } });
  const source = { repo_url: tfs.repoUrl, branch: "dev", commit, change_ref: "fix-101" };
  const stateFile = join(dir, "state.json"), config = join(dir, "config.json");
  writeFileSync(config, JSON.stringify({ runtime: { multica_cli: MOCK, workspace_id: "ws-test", multica_profile: "private", multica_server_url: "https://private.example" } }));
  const write = value => writeFileSync(stateFile, JSON.stringify({ metadata: { "analysis.source": value === undefined ? undefined : JSON.stringify(value) } }));
  write(source);
  const run = (file = "tasks.md", extraEnv = {}) => {
    const before = readFileSync(stateFile, "utf8");
    const r = spawnSync(process.execPath, [CLI, "analysis", "read", "--issue", "WNDF-T", "--file", file], {
      encoding: "utf8", timeout: 15000,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== "path")), ...tfs.env,
        MOCK_STATE: stateFile, MULTICA_CLI_PATH: MOCK, MULTICA_WORKSPACE_ID: "ws-test", MULTICA_SERVER_URL: "https://private.example", MOCK_EXPECT_SERVER: "https://private.example", ...extraEnv },
    });
    assert.equal(r.error, undefined, r.error?.message);
    assert.equal(readFileSync(stateFile, "utf8"), before, "读取不得写 Issue");
    return { code: r.status, body: JSON.parse(r.stdout) };
  };
  return { run, tfs, source, write, path, config };
}

test("analysis read 无需根仓挂载，按固定 commit 完整返回中文多行正文", t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(result.body.content, content);
  assert.deepEqual(result.body.source, f.source);
  assert.match(result.body.sha256, /^[0-9a-f]{64}$/);
  assert.equal(f.tfs.state().requests[0].query["api-version"], "4.1");
  assert.equal(f.tfs.state().requests[0].method, "GET");
  // 模拟分支产生新版本；旧审核记录仍必须读取旧 commit。
  f.tfs.update(s => { s.versions["b".repeat(40)] = { [f.path]: "新的分支正文" }; });
  assert.equal(f.run().body.content, content);
});

test("缺失来源、穿越路径、凭据 URL、跨 TFS 服务在发请求前失败", t => {
  const f = fixture(t);
  f.write(undefined);
  assert.equal(f.run().code, 3);
  f.write(f.source);
  assert.equal(f.run("../tasks.md").code, 2);
  f.write({ ...f.source, repo_url: "https://user:secret@evil.example/tfs/C/P/_git/R" });
  const credential = f.run();
  assert.equal(credential.code, 3);
  assert.equal(JSON.stringify(credential).includes("secret"), false);
  f.write({ ...f.source, repo_url: "https://evil.example/tfs/C/P/_git/R" });
  assert.equal(f.run().code, 3);
  assert.equal(f.tfs.state().requests, undefined);
});

test("404 与权限/服务错误均不会回退本地或其他版本", t => {
  const f = fixture(t);
  for (const status of [404, 401, 403, 500, 302]) {
    f.tfs.update(s => { s.status = status; });
    const r = f.run();
    assert.equal(r.code, status === 404 ? 2 : 3, JSON.stringify(r));
    assert.equal(r.body.content, undefined);
  }
  assert.ok(f.tfs.state().requests.every(r => r.query["versionDescriptor.version"] === f.source.commit));
});

test("错误 commit、路径、正文或无效 JSON 不能伪装成功", t => {
  const f = fixture(t);
  for (const responseOverride of [{ commitId: "b".repeat(40) }, { path: "/other" }, { content: null }, { isFolder: true }, { objectId: null }]) {
    f.tfs.update(s => { s.responseOverride = responseOverride; });
    assert.equal(f.run().code, 3);
  }
  f.tfs.update(s => { s.malformed = true; });
  assert.equal(f.run().code, 3);
  for (const rawResponse of ["null", "[]", "42"]) {
    f.tfs.update(s => { delete s.malformed; s.rawResponse = rawResponse; });
    assert.equal(f.run().code, 3);
  }
});

test("缺少显式 Workspace 时不能落入默认工作区", t => {
  const f = fixture(t);
  const result = f.run("tasks.md", {MULTICA_WORKSPACE_ID:""});
  assert.equal(result.code, 3);
  assert.match(result.body.reason, /MULTICA_WORKSPACE_ID/);
  assert.equal(f.tfs.state().requests, undefined);
});

test("缺少 TFS 凭据返回 UNKNOWN JSON，不产生请求", t => {
  const f = fixture(t);
  const result = f.run("tasks.md", { TFS_PAT: "", TFS_CLI_CONFIG: f.config });
  assert.equal(result.code, 3);
  assert.match(result.body.reason, /配置无效/);
  assert.equal(f.tfs.state().requests, undefined);
});
