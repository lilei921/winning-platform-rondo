import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, realpathSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const source = fileURLToPath(new URL("../../mcps/", import.meta.url));
const names = ["remote-codegraph", "remote-filesystem", "remote-ripgrep"];

/** 本地有状态 CLI 替身，禁止连接真实平台；不把 stdin 凭据写入 trace 或状态文件。 */
function fixture(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "rondo-mcp-")));
  t.after(() => { assert.equal(dirname(root), realpathSync.native(tmpdir())); rmSync(root, { recursive: true, force: true }); });
  const write = (name, content) => {
    const path = join(root, name); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content)); return path;
  };
  const shared = "projects/multica/skills/_shared/";
  const manifest = {
    mcp_servers: names.map(name => ({ name, template: name + ".json" })),
    managed_skills: ["demo"], agents: [
      { dir: "wayfinder", name: "Wayfinder", skills: ["demo"], mcp_servers: names },
      { dir: "analyst", name: "Analyst", skills: ["demo"], mcp_servers: names, mcp_phase: "08-b" },
    ], squad: { name: "Delivery", leader: "Wayfinder", members: [] }, project: { title: "Project" }, autopilots: [],
  };
  write(shared + "provisioning.json", manifest);
  for (const name of names) write("projects/multica/mcps/" + name + ".json", readFileSync(join(source, name + ".json"), "utf8"));
  for (const name of names) write("projects/multica/mcps/connections/" + name + ".local.json", {
    url: "https://test.invalid/private-token", headers: { Authorization: "Bearer private-secret" },
  });
  for (const dir of ["wayfinder", "analyst"]) {
    write(`projects/multica/agents/${dir}/instructions.md`, "instructions");
    write(`projects/multica/agents/${dir}/description.md`, "description");
  }
  write("projects/multica/skills/demo/SKILL.md", "---\nname: demo\ndescription: fixture\n---\n");
  write("projects/multica/squads/delivery-squad/squad-instructions.md", "instructions");
  const overlayPath = write(shared + "workspaces/pilot.json", { workspace_id: "ws-1" });
  const trace = join(root, "trace.jsonl");
  const statePath = write("state.json", { servers: [], bindings: {}, agents: manifest.agents.map((a, i) => ({
    id: `a-${i}`, name: a.name, instructions: "instructions", description: "description", visibility: "workspace", skills: [{ name: "demo" }],
  })) });
  const script = write("bin/mock.cjs", `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2); fs.appendFileSync(process.env.MC_TRACE, JSON.stringify(args)+'\\n');
while(['--profile','--server-url'].includes(args[0])) args.splice(0,2);
const s=JSON.parse(fs.readFileSync(process.env.MC_STATE,'utf8')); const key=args.slice(0,2).join(' ');
let out; let input;
if(args.includes('--server-config-stdin')) input=JSON.parse(fs.readFileSync(0,'utf8'));
if(key==='config show') { console.log('server_url: https://test.invalid'); process.exit(0); }
if(key==='workspace list') out=s.workspace_exists?[{id:'ws-1',slug:'pilot'}]:[];
else if(key==='workspace create') { s.workspace_exists=true; out={id:'ws-1'}; }
else if(key==='workspace mcp') {
  if(args[2]==='list') out=s.servers;
  else {
    if(process.env.MC_FAIL===args[3]) { console.error('private-token private-secret'); process.exit(3); }
    if(args[2]==='add') { const item={id:'id-'+args[3],name:args[3]}; s.servers.push(item); out=item; }
    else if(args[2]==='update') out=s.servers.find(v=>v.id===args[3]);
    else process.exit(7);
    s.policy={tools:input.enabled_tools,approval:input.default_tools_approval_mode};
    s.input_valid=!!input.url && !!input.headers.Authorization;
  }
} else if(key==='agent mcp') {
  const list=s.bindings[args[3]]??=[];
  if(args[2]==='list') out=list;
  else { let item=list.find(v=>v.id===args[4]);
    if(!item) { item={id:args[4],enabled:true}; list.push(item); } else item.enabled=true;
    if(process.env.MC_FAIL==='readback') item.enabled=false;
    s.bindings[args[3]]=list; out=item;
  }
} else if(key==='agent list') out=s.agents;
else if(key==='agent create') { out={id:'a-'+s.agents.length, name:args[args.indexOf('--name')+1]}; s.agents.push(out); }
else if(key==='agent skills') out={};
else if(key==='runtime list') out=[{id:'runtime-1'}];
else if(key==='skill list') out=[{id:'skill-1',name:'demo'}];
else if(key==='squad list') out=[{id:'squad-1',name:'Delivery',leader_id:'a-0',instructions:'instructions'}];
else if(key==='squad member') out=[];
else if(key==='project list') out=[{id:'project-1',title:'Project'}];
else if(key==='autopilot list') out=[];
else { console.error('Unexpected operation'); process.exit(9); }
fs.writeFileSync(process.env.MC_STATE,JSON.stringify(s)); console.log(JSON.stringify(out));
`);
  if (process.platform === "win32") write("bin/multica.cmd", `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  else { const shim = write("bin/multica", `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`); chmodSync(shim, 0o755); }
  const run = (args = [], extra = {}) => {
    const env = { ...process.env, MULTICA_REPO_ROOT: root, MC_STATE: statePath, MC_TRACE: trace, SKILL_FLOW_TRACE: "1" };
    delete env.MULTICA_SERVER_URL; delete env.RONDO_MULTICA_PROFILE;
    for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
    env.PATH = join(root, "bin") + delimiter + process.env.PATH;
    // 故意提供不同的旧环境变量，验证连接完全来自文件，不受环境覆盖。
    for (const kind of ["CODEGRAPH", "FILESYSTEM", "RIPGREP"]) env[`RONDO_REMOTE_${kind}_CONNECTION`] = JSON.stringify({ url: "https://environment.invalid" });
    Object.assign(env, extra);
    const r = spawnSync(process.execPath, [cli, "workspace", "provision", "--workspace", "pilot", ...args], { encoding: "utf8", env });
    assert.equal(r.error, undefined);
    assert.ok(!`${r.stdout}\n${r.stderr}`.includes("private-token"));
    assert.ok(!`${r.stdout}\n${r.stderr}`.includes("private-secret"));
    assert.ok(!readFileSync(overlayPath, "utf8").includes("private-"));
    return { ...r, body: r.stdout.trim() ? JSON.parse(r.stdout) : null };
  };
  const calls = () => existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse) : [];
  return { run, calls, state: () => JSON.parse(readFileSync(statePath, "utf8")), overlay: () => JSON.parse(readFileSync(overlayPath, "utf8")),
    setConnection: (name, value) => write("projects/multica/mcps/connections/" + name + ".local.json", value),
    removeConnection: name => rmSync(join(root, "projects/multica/mcps/connections/" + name + ".local.json")),
    setState: s => writeFileSync(statePath, JSON.stringify(s)),
    setOverlay: value => writeFileSync(overlayPath, JSON.stringify(value)), overlayPath, root };
}

test("完整 provision 创建三 MCP 并绑定；重入无重复写入，凭据不进日志和 overlay", t => {
  const f = fixture(t); const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.state().servers.length, 3);
  assert.equal(f.state().bindings["a-0"].length, 3);
  assert.equal(f.state().bindings["a-1"], undefined);
  assert.deepEqual(Object.keys(f.overlay().mcp_servers), names);
  assert.equal(f.overlay().provisioning_required, undefined);
  assert.equal(f.state().input_valid, true);
  assert.deepEqual(f.state().policy, { tools: ["search"], approval: "approve" });
  const count = f.calls().length;
  assert.equal(f.run().status, 0);
  assert.ok(f.calls().slice(count).every(a => !a.some(v => ["add", "update", "enable", "create"].includes(v))));
});

test("专项供给和 check 不触碰其他资产；漂移 exit 2，检查零写入", t => {
  const f = fixture(t); const before = readFileSync(f.overlayPath, "utf8");
  const r = f.run(["--mcp-only", "--check"]);
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.body.result, "DRIFT");
  assert.equal(r.body.mcp_configuration, "WRITE_ONLY_NOT_VERIFIED");
  assert.equal(r.body.mcp_runtime, "NOT_RUN");
  assert.equal(readFileSync(f.overlayPath, "utf8"), before);
  assert.equal(f.state().servers.length, 0);
  assert.equal(f.run(["--mcp-only"]).status, 0);
  assert.equal(f.run(["--mcp-only", "--check"]).status, 0);
  assert.ok(f.calls().every(a => !a.some(v => ["skill", "runtime", "workflow", "squad", "project", "autopilot"].includes(v))));
});

test("第二个 MCP 创建失败保留第一个 ID；恢复只补缺失条目", t => {
  const f = fixture(t);
  assert.equal(f.run(["--mcp-only"], { MC_FAIL: "remote-filesystem" }).status, 3);
  assert.equal(f.overlay().mcp_servers["remote-codegraph"].id, "id-remote-codegraph");
  assert.equal(f.state().servers.length, 1);
  assert.equal(f.run(["--mcp-only"]).status, 0);
  assert.equal(f.state().servers.length, 3);
});

test("连接文件缺失时预先停止，即使环境变量有值也不兜底", t => {
  const f = fixture(t);
  f.removeConnection("remote-filesystem");
  const r = f.run(["--mcp-only"]);
  assert.equal(r.status, 3);
  assert.equal(f.state().servers.length, 0);
  assert.equal(f.calls().length, 0);
});

test("显式更新只替换指定 MCP；08-B 绑定需显式启用并保存阶段", t => {
  const f = fixture(t); assert.equal(f.run(["--mcp-only"]).status, 0);
  const count = f.calls().length;
  assert.equal(f.run(["--mcp-only", "--update-mcp", "remote-ripgrep", "--mcp-phase", "08-b"]).status, 0);
  const writes = f.calls().slice(count).filter(a => a.includes("update"));
  assert.equal(writes.length, 1);
  assert.ok(writes[0].includes("id-remote-ripgrep"));
  assert.equal(f.overlay().mcp_phase, "08-b");
  assert.equal(f.state().bindings["a-1"].length, 3);
});

test("绑定回读未启用时失败，不虚报成功", t => {
  const f = fixture(t);
  const r = f.run(["--mcp-only"], { MC_FAIL: "readback" });
  assert.equal(r.status, 3);
  assert.match(r.body.reason, /回读失败/);
  assert.equal(Object.keys(f.overlay().mcp_servers).length, 3);
});

test("非法模式在平台调用前拒绝", t => {
  const f = fixture(t);
  for (const args of [["--mcp-only", "--create-workspace"], ["--check", "--update-mcp", "remote-ripgrep"], ["--update-mcp"], ["--check", "false"], ["--dry-run", "false"], ["--mcp-only", "false"]]) {
    assert.equal(f.run(args).status, 64);
  }
  assert.equal(f.calls().length, 0);
});

test("正式项目配置根仓分支，并为受管源码 Agent 声明 MCP", () => {
  const m = JSON.parse(readFileSync(join(source, "provisioning.json"), "utf8"));
  assert.ok(m.project.workspace_branch.trim());
  assert.deepEqual(m.mcp_servers.map(s => s.name), names);
  for (const dir of ["wayfinder-agent", "bug-fix-agent", "workitem-analyst", "engineer"]) {
    const a = m.agents.find(a => a.dir === dir);
    assert.deepEqual(a.mcp_servers, names);
    assert.equal(a.mcp_phase, ["wayfinder-agent", "bug-fix-agent"].includes(dir) ? undefined : "08-b");
  }
});

test("全新 workspace 与 Agent 从零创建后获得 MCP 绑定", t => {
  const f = fixture(t); f.setOverlay({});
  const state = f.state(); state.agents = []; f.setState(state);
  const r = f.run(["--slug", "pilot", "--create-workspace", "--runtime-id", "runtime-1"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.state().workspace_exists, true);
  assert.equal(f.state().agents.length, 2);
  assert.equal(f.state().bindings["a-0"].length, 3);
  assert.equal(f.overlay().workspace_id, "ws-1");
});

test("全新 workspace 预演包含 MCP 绑定；缺凭据正式执行连 workspace 也不创建", t => {
  const f = fixture(t); f.setOverlay({});
  f.setConnection("remote-codegraph", { url: "" });
  const args = ["--slug", "pilot", "--create-workspace"];
  const preview = f.run([...args, "--dry-run"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.ok(preview.body.created.includes("mcp/remote-codegraph"));
  assert.ok(preview.body.created.includes("agent/Wayfinder/mcp/remote-codegraph"));
  assert.ok(!preview.body.created.includes("agent/Analyst/mcp/remote-codegraph"));
  assert.deepEqual(f.overlay(), {});
  assert.equal(f.run(args).status, 3);
  assert.ok(f.calls().every(a => !a.includes("create") && !a.includes("add")));
});

test("存量 workspace 维护前也必须准备连接地址，检查模式仍保持只读", t => {
  const f = fixture(t);
  assert.equal(f.run(["--mcp-only"]).status, 0);
  f.setConnection("remote-ripgrep", { url: "" });
  const count = f.calls().length;
  assert.equal(f.run(["--mcp-only"]).status, 3);
  assert.equal(f.calls().length, count);
  assert.equal(f.run(["--mcp-only", "--check"]).status, 0);
});
