import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, realpathSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

/** 完全隔离的 CLI/工作区夹具，所有平台调用只写本地 trace。 */
function fixture(t, scenario = "normal") {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "rondo-workspace-env-")));
  t.after(() => { assert.equal(dirname(root), realpathSync.native(tmpdir())); rmSync(root, { recursive: true, force: true }); });
  const write = (name, value) => {
    const path = join(root, name); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value)); return path;
  };
  const shared = "projects/multica/workspace-config/";
  const overlay = write(shared + "workspaces/pilot.json", { workspace_id: "ws-1" });
  const agents = [{ dir: "analyst", name: "Analyst", skills: ["spec-preparation"] }];
  if (scenario === "branch") agents.push({ dir: "engineer", name: "Engineer", skills: [] });
  write(shared + "provisioning.json", {
    managed_skills: ["spec-preparation"], agents,
    squad: { name: "Delivery", leader: "Analyst", members: [] }, project: { title: "Project", workspace_branch: scenario === "branch" ? "release" : undefined }, autopilots: [],
    workflow: { statuses: [{ key: "analysis_review", name: "Analysis Review", category: "started" }] },
  });
  write("projects/multica/skills/spec-preparation/SKILL.md", "---\nname: spec-preparation\ndescription: fixture\n---\n");
  write("projects/multica/agents/analyst/instructions.md", "instructions");
  write("projects/multica/agents/analyst/description.md", "description");
  if (scenario === "branch") {
    write("projects/multica/agents/engineer/instructions.md", "instructions");
    write("projects/multica/agents/engineer/description.md", "description");
  }
  write("projects/multica/squads/delivery-squad/squad-instructions.md", "instructions");
  const trace = join(root, "trace.jsonl");
  const script = write("bin/mock.cjs", `#!/usr/bin/env node
const fs=require('node:fs'); const args=process.argv.slice(2); fs.appendFileSync(process.env.MC_TRACE,JSON.stringify(args)+'\\n');
while(['--profile','--server-url'].includes(args[0])) args.splice(0,2);
const key=args.slice(0,2).join(' '); let out;
if(key==='workflow get' && process.env.MC_SCENARIO==='unsupported') { console.error('The requested resource was not found.'); process.exit(4); }
if(key==='agent list' && process.env.MC_SCENARIO==='partial') { console.log(JSON.stringify({reason:'fixture interruption'})); process.exit(3); }
if(key==='config show') { console.log('server_url: https://private.example'); process.exit(0); }
if(args[0]==='--version') { console.log(process.env.MC_SCENARIO==='old'?'multica 0.7.0':'multica 0.8.1'); process.exit(0); }
if(key==='workspace list') out=[];
else if(key==='workspace create') out={id:'new-ws'};
else if(key==='workflow get') out=['bad','new-bad'].includes(process.env.MC_SCENARIO)?{}:{steps:[{status_key:'todo'},{status_key:'analysis_review'},{status_key:'done'}]};
else if(key==='runtime list') out=process.env.MC_SCENARIO==='no-runtime'?[]:[{id:'runtime-1'}];
else if(key==='skill list') out=[{id:'skill-1',name:'spec-preparation'}];
else if(key==='agent list') {
  out=[{id:'agent-1',name:'Analyst',instructions:'instructions',description:'description',visibility:'workspace',skills:[{name:'spec-preparation'}]}];
  if(fs.existsSync(process.env.MC_TRACE+'.agent-2')) out.push({...out[0],id:'agent-2',name:'Engineer',skills:[]});
}
else if(key==='agent create') {
  const env=JSON.parse(args[args.indexOf('--custom-env')+1]);
  fs.writeFileSync(process.env.MC_TRACE+'.agent-2',JSON.stringify(env)); out={id:'agent-2'};
}
else if(key==='agent env') {
  const id=args[3], path=process.env.MC_TRACE+'.'+id;
  const env=fs.existsSync(path)?JSON.parse(fs.readFileSync(path)): {RONDO_WORKSPACE_BRANCH:'dev',OTHER:'fixture-private-value'};
  if(args[2]==='set') {
    const submitted=JSON.parse(fs.readFileSync(0,'utf8'));
    if(submitted.OTHER!=='****') throw new Error('missing preserve marker');
    for(const k of Object.keys(env)) if(!(k in submitted)) delete env[k];
    for(const [k,v] of Object.entries(submitted)) if(v!=='****') env[k]=v;
    fs.writeFileSync(path,JSON.stringify(env));
  }
  out={agent_id:id,custom_env:env};
}
else if(key==='squad list') out=[{id:'squad-1',name:'Delivery',leader_id:'agent-1',instructions:'instructions'}];
else if(key==='squad member') out=[];
else if(key==='project list') out=[{id:'project-1',title:'Project'}];
else if(key==='autopilot list') out=[];
else { console.error('Unexpected platform mutation: '+args.join(' ')); process.exit(1); }
console.log(JSON.stringify(out));
`);
  if (process.platform === "win32") write("bin/multica.cmd", `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  else { const shim = write("bin/multica", `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`); chmodSync(shim, 0o755); }
  const run = (...args) => {
    const env = { ...process.env, MULTICA_REPO_ROOT: root, MC_TRACE: trace, MC_SCENARIO: scenario };
    delete env.MULTICA_SERVER_URL; delete env.RONDO_MULTICA_PROFILE;
    for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
    env.PATH = join(root, "bin") + delimiter + process.env.PATH;
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env });
    assert.equal(r.error, undefined);
    assert.ok(r.stdout.trim(), `CLI 未输出 JSON（exit ${r.status}）: ${r.stderr}`);
    return { code: r.status, body: JSON.parse(r.stdout), stderr: r.stderr };
  };
  const calls = () => existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse) : [];
  return { overlay, run, calls, write, shared, trace };
}

test("项目分支下发至新建和已有 Agent，保留其他变量且再次供给无写入", t => {
  const f = fixture(t, "branch");
  const provision = (...flags) => f.run("workspace", "provision", "--workspace", "pilot", "--skip-workflow", ...flags);
  const preview = provision("--dry-run");
  assert.equal(preview.code, 0, preview.stderr);
  assert.ok(preview.body.updated.includes("agent/Analyst (RONDO_WORKSPACE_BRANCH)"));
  assert.ok(!f.calls().some(args => args.includes("set") || args.includes("create")));
  const first = provision();
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(JSON.parse(readFileSync(f.trace + ".agent-1")), { RONDO_WORKSPACE_BRANCH: "release", OTHER: "fixture-private-value" });
  assert.deepEqual(JSON.parse(readFileSync(f.trace + ".agent-2")), { RONDO_WORKSPACE_BRANCH: "release" });
  assert.doesNotMatch(first.stderr + JSON.stringify(first.body) + readFileSync(f.trace, "utf8"), /fixture-private-value/);
  const before = f.calls().length;
  const again = provision();
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(again.body.updated, []);
  assert.ok(!f.calls().slice(before).some(args => args.includes("set") || args.includes("create")));
});

for (const scenario of ["old", "bad", "unsupported"]) test(`供给前拒绝 ${scenario} workflow，平台和 overlay 零写入`, t => {
  const f = fixture(t, scenario); const before = readFileSync(f.overlay, "utf8");
  const r = f.run("workspace", "provision", "--workspace", "pilot", "--profile", "private");
  assert.equal(r.code, 3, r.stderr);
  assert.equal(readFileSync(f.overlay, "utf8"), before);
  assert.ok(f.calls().every(a => !a.some(x => ["create", "update", "set"].includes(x))));
});

// 兼容模式必须绕过两处 workflow 调用，同时继续供给其他对象并保留失败语义。
for (const scenario of ["old", "unsupported"]) test(`显式跳过 ${scenario} workflow 后完成其他对象供给`, t => {
  const f = fixture(t, scenario);
  const r = f.run("workspace", "provision", "--workspace", "pilot", "--skip-workflow");
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.body.workflow_skipped, true);
  assert.ok(f.calls().every(a => !a.includes("workflow") && !a.includes("--version")));
  assert.ok(f.calls().some(a => a.includes("runtime")));
  assert.ok(r.body.unchanged.includes("agent/Analyst"));
  assert.ok(r.body.unchanged.includes("project/Project"));
  const overlay = JSON.parse(readFileSync(f.overlay, "utf8"));
  assert.equal(overlay.skills["spec-preparation"], "skill-1");
  assert.equal(overlay.provisioning_required, undefined);
});

test("跳过 workflow 的 dry-run 不写 overlay", t => {
  const f = fixture(t, "unsupported"); const before = readFileSync(f.overlay, "utf8");
  const r = f.run("workspace", "provision", "--workspace", "pilot", "--skip-workflow", "--dry-run");
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.body.workflow_skipped, true);
  assert.equal(r.body.overlay_written, false);
  assert.equal(readFileSync(f.overlay, "utf8"), before);
  assert.ok(f.calls().every(a => !a.includes("workflow")));
});

test("跳过 workflow 后其他对象失败仍保留同步门禁", t => {
  const f = fixture(t, "partial");
  const r = f.run("workspace", "provision", "--workspace", "pilot", "--skip-workflow");
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.body.workflow_skipped, true);
  assert.deepEqual(JSON.parse(readFileSync(f.overlay, "utf8")).provisioning_required, ["spec-preparation"]);
});

test("provision 保存环境；重复执行继承环境且拒绝跨 profile 覆盖", t => {
  const f = fixture(t);
  const r = f.run("workspace", "provision", "--workspace", "pilot", "--profile", "private");
  assert.equal(r.code, 0, r.stderr);
  const overlay = JSON.parse(readFileSync(f.overlay, "utf8"));
  assert.equal(overlay.multica_profile, "private"); assert.equal(overlay.multica_server_url, "https://private.example");
  assert.match(r.body.next, /--profile private/);
  assert.equal(f.run("workspace", "provision", "--workspace", "pilot").code, 0);
  const before = readFileSync(f.overlay, "utf8"); const count = f.calls().length;
  assert.equal(f.run("workspace", "provision", "--workspace", "pilot", "--profile", "cloud").code, 3);
  assert.equal(f.calls().length, count); assert.equal(readFileSync(f.overlay, "utf8"), before);
});

test("旧 Analyst overlay 同步必须先完成供给，不能静默跳过新 Skills", t => {
  const f = fixture(t);
  f.write(f.shared + "workspaces/pilot.json", { workspace_id: "ws-1", skills: { "workitem-analysis": "old" }, provisioning_required: ["spec-preparation"] });
  const r = f.run("workspace", "sync", "--workspace", "pilot", "--local-only");
  assert.equal(r.code, 3); assert.match(r.body.reason, /provision/); assert.equal(f.calls().length, 0);
});

test("sync dry-run 报告缺失引用且不上传；正式同步在上传前阻断", t => {
  const f = fixture(t);
  f.write(f.shared + "provisioning.json", { managed_skills: ["demo"] });
  f.write(f.shared + "workspaces/pilot.json", { workspace_id: "ws-1", skills: { "demo": "skill-1" } });
  f.write("projects/multica/skills/demo/SKILL.md", "缺页：`references/missing.md`\n");
  const preview = f.run("workspace", "sync", "--workspace", "pilot", "--dry-run");
  assert.equal(preview.code, 0, preview.stderr);
  assert.match(preview.stderr, /references 引用问题.*1/);
  const actual = f.run("workspace", "sync", "--workspace", "pilot");
  assert.equal(actual.code, 3, actual.stderr);
  assert.match(actual.body.reason, /references 引用缺页/);
  assert.ok(f.calls().every(a => !a.includes("skill")), "引用不完整时不访问远端 Skill");
});

test("对象供给中断后保留恢复标志，sync 不得发布半成品绑定", t => {
  const f = fixture(t, "partial");
  const r = f.run("workspace", "provision", "--workspace", "pilot", "--profile", "private");
  assert.equal(r.code, 3);
  const overlay = JSON.parse(readFileSync(f.overlay, "utf8"));
  assert.deepEqual(overlay.provisioning_required, ["spec-preparation"]);
  assert.equal(f.run("workspace", "sync", "--workspace", "pilot", "--local-only").code, 3);
});

for (const scenario of ["no-runtime", "new-bad"]) test(`新建工作区在 ${scenario} 中断时保留环境与恢复 ID`, t => {
  const f = fixture(t, scenario);
  f.write(f.shared + "workspaces/pilot.json", {});
  const r = f.run("workspace", "provision", "--workspace", "pilot", "--slug", "new", "--create-workspace", "--profile", "private");
  assert.equal(r.code, 3, r.stderr);
  const overlay = JSON.parse(readFileSync(f.overlay, "utf8"));
  assert.equal(overlay.workspace_id, "new-ws");
  assert.equal(overlay.multica_profile, "private");
  assert.equal(overlay.multica_server_url, "https://private.example");
  assert.deepEqual(overlay.provisioning_required, ["spec-preparation"]);
  assert.equal(r.body.overlay_written, true);
  assert.equal(f.run("workspace", "sync", "--workspace", "pilot", "--local-only").code, 3);
});

test("已绑定工作区不因错误 slug 创建额外对象", t => {
  const f = fixture(t); const before = readFileSync(f.overlay, "utf8");
  const r = f.run("workspace", "provision", "--workspace", "pilot", "--slug", "new", "--create-workspace");
  assert.equal(r.code, 3);
  assert.ok(f.calls().every(a => !a.includes("create")));
  assert.equal(readFileSync(f.overlay, "utf8"), before);
});

test("新建工作区 dry-run 输出计划且不使用空工作区 ID", t => {
  const f = fixture(t); f.write(f.shared + "workspaces/pilot.json", {});
  const before = readFileSync(f.overlay, "utf8");
  const r = f.run("workspace", "provision", "--workspace", "pilot", "--slug", "new", "--create-workspace", "--dry-run");
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.body.mode, "dry-run");
  assert.ok(r.body.created.includes("workspace/new"));
  assert.ok(r.body.created.includes("skill/spec-preparation"));
  assert.ok(r.body.deferred_checks.includes("runtime"));
  assert.ok(f.calls().every(a => !a.includes("create") && !a.includes("--workspace-id")));
  assert.equal(readFileSync(f.overlay, "utf8"), before);
});
