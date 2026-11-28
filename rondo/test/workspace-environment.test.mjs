import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, realpathSync } from "node:fs";
import { join, dirname, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

/** 完全隔离的 CLI/工作区夹具，所有平台调用只写本地 trace。 */
function fixture(t, scenario = "normal", extraEnv = {}) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "rondo-workspace-env-")));
  t.after(() => { assert.equal(dirname(root), realpathSync.native(tmpdir())); rmSync(root, { recursive: true, force: true }); });
  const write = (name, value) => {
    const path = join(root, name); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)); return path;
  };
  const shared = "workspace-config/";
  const overlay = write(shared + "workspaces/pilot.json", { workspace_id: "ws-1" });
  const branchScenario = ["branch", "group", "native-branch"].includes(scenario);
  const preparation = "native-workspace";
  const agents = [{ dir: "analyst", name: "Workitem Analyst", skills: ["spec-preparation", ...(branchScenario ? [preparation] : [])] }];
  if (["branch", "native-branch"].includes(scenario)) agents.push(
    { dir: "engineer", name: "Engineer", skills: [preparation] },
    { dir: "delivery-lead", name: "Delivery Lead", skills: [] },
  );
  if (scenario === "sync-project") {
    agents.push({ dir: "tfs-sync-agent", name: "TFS Sync Agent", skills: [] });
    write("agents/tfs-sync-agent/instructions.md", "instructions");
    write("agents/tfs-sync-agent/description.md", "description");
  }
  write(shared + "provisioning.json", {
    managed_skills: ["spec-preparation", ...(branchScenario ? [preparation] : [])], agents,
    squad: { name: "Delivery", leader: "Workitem Analyst", members: [] }, project: { title: "Project", workspace_branch: branchScenario ? "release" : undefined, description: ["project-create", "project-description"].includes(scenario) ? "项目描述" : undefined }, autopilots: [],
    workspace_groups: { bi: { workspaces: ["pilot"], project: ["group", "sync-project"].includes(scenario) ? { title: "BI Project" } : {} } },
    workflow: { statuses: [{ key: "analysis_review", name: "Analysis Review", category: "started" }] },
  });
  write("skills/spec-preparation/SKILL.md", "---\nname: spec-preparation\ndescription: fixture\n---\n");
  write("agents/analyst/instructions.md", "instructions");
  write("agents/analyst/description.md", "description");
  if (branchScenario) write(`skills/${preparation}/SKILL.md`, `---\nname: ${preparation}\ndescription: fixture\n---\n`);
  if (["branch", "native-branch"].includes(scenario)) {
    for (const dir of ["engineer", "delivery-lead"]) {
      write(`agents/${dir}/instructions.md`, "instructions");
      write(`agents/${dir}/description.md`, "description");
    }
  }
  write("squads/squad-instructions.md", "instructions");
  const trace = join(root, "trace.jsonl");
  if (scenario === "remote-stale") writeFileSync(trace + ".stale", "legacy");
  const script = write("bin/mock.cjs", `#!/usr/bin/env node
const fs=require('node:fs'); const args=process.argv.slice(2); fs.appendFileSync(process.env.MC_TRACE,JSON.stringify(args)+'\\n');
const hash=(content)=>require('node:crypto').createHash('sha256').update(content).digest('hex');
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
else if(key==='skill list') out=process.env.MC_SCENARIO==='skill-create'?[]:[{id:'skill-1',name:'spec-preparation'}, ...(['branch','group','native-branch'].includes(process.env.MC_SCENARIO)?[{id:'skill-2',name:'native-workspace'}]:[])];
else if(key==='skill create') {
  if(!args.includes('--content-stdin')) throw new Error('expected UTF-8 stdin');
  fs.writeFileSync(process.env.MC_TRACE+'.skill',fs.readFileSync(0)); out={id:'skill-1'};
}
else if(key==='skill get') {
  const path=process.env.MC_TRACE+'.skill';
  out={content_hash:fs.existsSync(path)?hash(fs.readFileSync(path)):''};
}
else if(key==='skill update') {
  if(!args.includes('--content-stdin')) throw new Error('expected UTF-8 stdin');
  fs.writeFileSync(process.env.MC_TRACE+'.skill',fs.readFileSync(0)); out={};
}
else if(key==='skill files') {
  const path=process.env.MC_TRACE+'.file';
  if(args[2]==='upsert') {
    if(!args.includes('--content-stdin')) throw new Error('expected UTF-8 stdin');
    fs.writeFileSync(path,fs.readFileSync(0)); out={};
  } else if(args[2]==='list') {
    const content=fs.existsSync(path)?fs.readFileSync(path):null;
    const files=content?[{path:'references/note.md',content_hash:hash(content),size:content.length}]:[];
    const stale=process.env.MC_TRACE+'.stale';
    if(process.env.MC_SCENARIO==='remote-stale' && fs.existsSync(stale)) {
      const old=fs.readFileSync(stale);
      files.push({id:'stale-registry',path:'config/repo-registry.json',content_hash:hash(old),size:old.length});
    }
    out=files;
  } else if(args[2]==='delete') {
    if(process.env.MC_SCENARIO!=='remote-stale' || args[args.length-1]!=='stale-registry') {
      throw new Error('unexpected skill files delete');
    }
    fs.rmSync(process.env.MC_TRACE+'.stale',{force:true});
    out={};
  } else throw new Error('unexpected skill files operation');
}
else if(key==='agent list') {
  const preparation=['branch','group','native-branch'].includes(process.env.MC_SCENARIO)?[{name:'native-workspace'}]:[];
  out=[{id:'agent-1',name:'Workitem Analyst',instructions:'instructions',description:'description',visibility:'workspace',skills:[{name:'spec-preparation'},...preparation]}];
  if(process.env.MC_SCENARIO==='sync-project') out.push({...out[0],id:'sync-agent',name:'TFS Sync Agent',skills:[]});
  if(fs.existsSync(process.env.MC_TRACE+'.agent-2')) out.push({...out[0],id:'agent-2',name:'Engineer',skills:preparation});
  if(['branch','native-branch'].includes(process.env.MC_SCENARIO)) out.push({...out[0],id:'agent-3',name:'Delivery Lead',skills:[]});
}
else if(key==='agent create') {
  const env=args.includes('--custom-env')?JSON.parse(args[args.indexOf('--custom-env')+1]):{};
  fs.writeFileSync(process.env.MC_TRACE+'.agent-2',JSON.stringify(env)); out={id:'agent-2'};
}
else if(key==='agent skills') out={};
else if(key==='agent env') {
  const id=args[3], path=process.env.MC_TRACE+'.'+id;
  const env=fs.existsSync(path)?JSON.parse(fs.readFileSync(path)): {RONDO_WORKSPACE_BRANCH:'dev',OTHER:'fixture-private-value'};
  if(args[2]==='set') {
    const submitted=JSON.parse(fs.readFileSync(0,'utf8'));
    for(const k of Object.keys(env)) if(submitted[k]!==env[k]) throw new Error('existing environment changed');
    fs.writeFileSync(path,JSON.stringify(submitted));
    out={agent_id:id,custom_env:submitted};
  }
  out={agent_id:id,custom_env:env};
}
else if(key==='squad list') out=[{id:'squad-1',name:'Delivery',leader_id:'agent-1',instructions:'instructions'}];
else if(key==='squad member') out=[];
else if(key==='project list') out=process.env.MC_SCENARIO==='project-create'?[]:[{id:'project-1',title:['group','sync-project'].includes(process.env.MC_SCENARIO)?'BI Project':'Project',description:process.env.MC_SCENARIO==='project-description'?'旧描述':'项目描述'}];
else if(key==='project create') out={id:'project-1'};
else if(key==='project update') out={id:'project-1'};
else if(key==='autopilot list') out=[];
else { console.error('Unexpected platform mutation: '+args.join(' ')); process.exit(1); }
console.log(JSON.stringify(out));
`);
  if (process.platform === "win32") write("bin/multica.cmd", `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  else { const shim = write("bin/multica", `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`); chmodSync(shim, 0o755); }
  const run = (...args) => {
    const env = { ...process.env, ...extraEnv, MULTICA_REPO_ROOT: root, MC_TRACE: trace, MC_SCENARIO: scenario };
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

test("根目录供给按分组选择 Project 且不改写 manifest", t => {
  const f = fixture(t, "group");
  const manifest = join(dirname(f.overlay), "..", "provisioning.json");
  const before = readFileSync(manifest, "utf8");
  for (const flags of [["--dry-run"], []]) {
    const r = f.run("workspace", "provision", "--workspace", "pilot", "--skip-workflow", ...flags);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.body.unchanged.includes("project/BI Project"));
    assert.equal(readFileSync(manifest, "utf8"), before);
  }
  assert.ok(!f.calls().some(args => args.includes("env") || args.some(arg => arg.includes("RONDO_WORKSPACE_BRANCH"))));
});

test("创建 Project 时下发 manifest 中的 description", t => {
  const f = fixture(t, "project-create");
  const result = f.run("workspace", "provision", "--workspace", "pilot", "--skip-workflow");
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.body.created.includes("project/Project"));
  const create = f.calls().find(args => args.includes("project") && args.includes("create"));
  assert.ok(create);
  assert.equal(create[create.indexOf("--description") + 1], "项目描述");
  assert.equal(JSON.parse(readFileSync(f.overlay, "utf8")).project, "project-1");
});

test("已有 Project 的描述漂移支持预检和更新", t => {
  const f = fixture(t, "project-description");
  const provision = (...flags) => f.run("workspace", "provision", "--workspace", "pilot", "--skip-workflow", ...flags);
  const preview = provision("--dry-run");
  assert.equal(preview.code, 0, preview.stderr);
  assert.ok(preview.body.updated.includes("project/Project (description)"));
  assert.ok(!f.calls().some(args => args.includes("project") && args.includes("update")));

  const result = provision();
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.body.updated.includes("project/Project (description)"));
  const update = f.calls().find(args => args.includes("project") && args.includes("update"));
  assert.ok(update);
  assert.ok(update.includes("project-1"));
  assert.equal(update[update.indexOf("--description") + 1], "项目描述");
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
  assert.ok(r.body.unchanged.includes("agent/Workitem Analyst"));
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
  assert.match(r.body.next, /^rondo workspace sync-skills --workspace pilot --profile private$/);
  assert.equal(f.run("workspace", "provision", "--workspace", "pilot").code, 0);
  const before = readFileSync(f.overlay, "utf8"); const count = f.calls().length;
  assert.equal(f.run("workspace", "provision", "--workspace", "pilot", "--profile", "cloud").code, 3);
  assert.equal(f.calls().length, count); assert.equal(readFileSync(f.overlay, "utf8"), before);
});

test("analysis-publish sync no longer renders a Repository Registry", t => {
  const f = fixture(t, "normal");
  f.write(f.shared + "workspaces/pilot.json", {
    workspace_id: "ws-1", skills: { "analysis-publish": "skill-1" },
  });
  f.write("skills/analysis-publish/SKILL.md", "---\nname: analysis-publish\ndescription: fixture\n---\n");
  const result = f.run("workspace", "sync-skills", "--workspace", "pilot", "--skill", "analysis-publish", "--dry-run");
  assert.equal(result.code, 0, JSON.stringify(result.body));
  assert.equal(result.body.mode, "dry-run");
  assert.equal(existsSync(join(dirname(f.overlay), "..", "..", "skills", "analysis-publish", "config", "repo-registry.json")), false);
});

test("旧 Analyst overlay 同步必须先完成供给，不能静默跳过新 Skills", t => {
  const f = fixture(t);
  f.write(f.shared + "workspaces/pilot.json", { workspace_id: "ws-1", skills: { "workitem-analysis": "old" }, provisioning_required: ["spec-preparation"] });
  const r = f.run("workspace", "sync-skills", "--workspace", "pilot", "--dry-run");
  assert.equal(r.code, 3); assert.match(r.body.reason, /provision/); assert.equal(f.calls().length, 0);
});

test("sync dry-run 报告缺失引用且不上传；正式同步在上传前阻断", t => {
  const f = fixture(t);
  f.write(f.shared + "provisioning.json", { managed_skills: ["demo"] });
  f.write(f.shared + "workspaces/pilot.json", { workspace_id: "ws-1", skills: { "demo": "skill-1" } });
  f.write("skills/demo/SKILL.md", "缺页：`references/missing.md`\n");
  const preview = f.run("workspace", "sync-skills", "--workspace", "pilot", "--dry-run");
  assert.equal(preview.code, 0, preview.stderr);
  assert.match(preview.stderr, /references 引用问题.*1/);
  const actual = f.run("workspace", "sync-skills", "--workspace", "pilot");
  assert.equal(actual.code, 3, actual.stderr);
  assert.match(actual.body.reason, /references 引用缺页/);
  assert.ok(f.calls().every(a => !a.includes("skill")), "引用不完整时不访问远端 Skill");
});

test("供给新 Skill 时通过 UTF-8 stdin 发送去掉 BOM 和 CRLF 的正文", t => {
  const f = fixture(t, "skill-create");
  const content = "---\nname: spec-preparation\ndescription: 中文说明\n---\n";
  f.write("skills/spec-preparation/SKILL.md", "\uFEFF" + content.replaceAll("\n", "\r\n"));
  const result = f.run("workspace", "provision", "--workspace", "pilot", "--skip-workflow");
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.body.created.includes("skill/spec-preparation"));
  assert.equal(readFileSync(f.trace + ".skill", "utf8"), content);
});

test("同步上传和校验统一使用无 BOM 的 UTF-8 LF，切换检出格式后无需重传", t => {
  const f = fixture(t);
  f.write(f.shared + "provisioning.json", { managed_skills: ["demo"] });
  f.write(f.shared + "workspaces/pilot.json", { workspace_id: "ws-1", skills: { demo: "skill-1" } });
  const skill = "---\nname: demo\ndescription: 中文描述\n---\n";
  const note = "中文内容 🚀\n";
  const asWindows = (text) => "\uFEFF" + text.replaceAll("\n", "\r\n");
  const skillPath = f.write("skills/demo/SKILL.md", asWindows(skill));
  const notePath = f.write("skills/demo/references/note.md", asWindows(note));
  const sync = (...args) => f.run("workspace", "sync-skills", "--workspace", "pilot", ...args);
  const first = sync();
  assert.equal(first.code, 0, first.stderr);
  assert.equal(readFileSync(f.trace + ".skill", "utf8"), skill);
  assert.equal(readFileSync(f.trace + ".file", "utf8"), note);
  assert.equal(readFileSync(skillPath, "utf8"), asWindows(skill));
  assert.equal(readFileSync(notePath, "utf8"), asWindows(note));

  f.write("skills/demo/SKILL.md", skill);
  f.write("skills/demo/references/note.md", note);
  const before = f.calls().length;
  const check = sync("--check");
  assert.equal(check.code, 0, check.stderr);
  const again = sync();
  assert.equal(again.code, 0, again.stderr);
  assert.equal(again.body.unchanged_files, 2);
  assert.ok(f.calls().slice(before).every(args => !args.includes("update") && !args.includes("upsert")));

  // CP936 的“中文”是非法 UTF-8，应该指出具体文件并停止上传。
  f.write("skills/demo/references/note.md", Buffer.from([0xd6, 0xd0, 0xce, 0xc4]));
  const invalid = sync();
  assert.equal(invalid.code, 3, invalid.stderr);
  assert.match(invalid.body.reason, /UTF-8.*note\.md/);
  assert.equal(readFileSync(f.trace + ".file", "utf8"), note);
});

test("对象供给中断后保留恢复标志，sync 不得发布半成品绑定", t => {
  const f = fixture(t, "partial");
  const r = f.run("workspace", "provision", "--workspace", "pilot", "--profile", "private");
  assert.equal(r.code, 3);
  const overlay = JSON.parse(readFileSync(f.overlay, "utf8"));
  assert.deepEqual(overlay.provisioning_required, ["spec-preparation"]);
  assert.equal(f.run("workspace", "sync-skills", "--workspace", "pilot", "--dry-run").code, 3);
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
  assert.equal(f.run("workspace", "sync-skills", "--workspace", "pilot", "--dry-run").code, 3);
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

test("spec-preparation no longer renders Repository Registry", t => {
  const f = fixture(t);
  f.write(f.shared + "workspaces/pilot.json", {
    workspace_id: "ws-1", skills: { "spec-preparation": "skill-1" },
  });
  f.write("skills/spec-preparation/SKILL.md", "---\nname: spec-preparation\ndescription: fixture\n---\n");
  const result = f.run("workspace", "sync-skills", "--workspace", "pilot", "--skill", "spec-preparation", "--dry-run");
  assert.equal(result.code, 0, JSON.stringify(result.body));
  assert.equal(result.body.mode, "dry-run");
  assert.equal(existsSync(join(dirname(f.overlay), "..", "..", "skills", "spec-preparation", "config", "repo-registry.json")), false);
});

test("spec-preparation sync deletes a stale remote Repository Registry attachment", t => {
  const f = fixture(t, "remote-stale");
  f.write(f.shared + "workspaces/pilot.json", {
    workspace_id: "ws-1", skills: { "spec-preparation": "skill-1" },
  });
  f.write("skills/spec-preparation/SKILL.md", "---\nname: spec-preparation\ndescription: fixture\n---\n");
  const localRegistry = join(dirname(f.overlay), "..", "..", "skills", "spec-preparation", "config", "repo-registry.json");
  assert.equal(existsSync(localRegistry), false);

  const result = f.run("workspace", "sync-skills", "--workspace", "pilot", "--skill", "spec-preparation");
  assert.equal(result.code, 0, JSON.stringify(result.body));
  assert.deepEqual(result.body.deleted_remote, ["spec-preparation/config/repo-registry.json"]);
  assert.ok(f.calls().some(args =>
    args.includes("skill") && args[args.indexOf("skill") + 1] === "files" && args[args.indexOf("skill") + 2] === "delete" && args.at(-1) === "stale-registry"));
  assert.equal(existsSync(f.trace + ".stale"), false);

  const check = f.run("workspace", "sync-skills", "--workspace", "pilot", "--skill", "spec-preparation", "--check");
  assert.equal(check.code, 0, JSON.stringify(check.body));
  assert.equal(check.body.result, "PASS");
});
test("pr-status-sync no longer renders Repository Registry", t => {
  const f = fixture(t);
  f.write(f.shared + "workspaces/pilot.json", {
    workspace_id: "ws-1", skills: { "pr-status-sync": "skill-1" },
  });
  f.write("skills/pr-status-sync/SKILL.md", "---\nname: pr-status-sync\ndescription: fixture\n---\n");
  const result = f.run("workspace", "sync-skills", "--workspace", "pilot", "--skill", "pr-status-sync", "--dry-run");
  assert.equal(result.code, 0, JSON.stringify(result.body));
  assert.equal(result.body.mode, "dry-run");
  assert.equal(existsSync(join(dirname(f.overlay), "..", "..", "skills", "pr-status-sync", "config", "repo-registry.json")), false);
});

test("pr-status-sync sync deletes a stale remote Repository Registry attachment", t => {
  const f = fixture(t, "remote-stale");
  f.write(f.shared + "workspaces/pilot.json", {
    workspace_id: "ws-1", skills: { "pr-status-sync": "skill-1" },
  });
  f.write("skills/pr-status-sync/SKILL.md", "---\nname: pr-status-sync\ndescription: fixture\n---\n");
  const localRegistry = join(dirname(f.overlay), "..", "..", "skills", "pr-status-sync", "config", "repo-registry.json");
  assert.equal(existsSync(localRegistry), false);

  const result = f.run("workspace", "sync-skills", "--workspace", "pilot", "--skill", "pr-status-sync");
  assert.equal(result.code, 0, JSON.stringify(result.body));
  assert.deepEqual(result.body.deleted_remote, ["pr-status-sync/config/repo-registry.json"]);
  assert.ok(f.calls().some(args =>
    args.includes("skill") && args[args.indexOf("skill") + 1] === "files" && args[args.indexOf("skill") + 2] === "delete" && args.at(-1) === "stale-registry"));
  assert.equal(existsSync(f.trace + ".stale"), false);

  const check = f.run("workspace", "sync-skills", "--workspace", "pilot", "--skill", "pr-status-sync", "--check");
  assert.equal(check.code, 0, JSON.stringify(check.body));
  assert.equal(check.body.result, "PASS");
});
test("delivery-closeout no longer renders Repository Registry", t => {
  const f = fixture(t);
  f.write(f.shared + "workspaces/pilot.json", {
    workspace_id: "ws-1", skills: { "delivery-closeout": "skill-1" },
  });
  f.write("skills/delivery-closeout/SKILL.md", "---\nname: delivery-closeout\ndescription: fixture\n---\n");
  const result = f.run("workspace", "sync-skills", "--workspace", "pilot", "--skill", "delivery-closeout", "--dry-run");
  assert.equal(result.code, 0, JSON.stringify(result.body));
  assert.equal(result.body.mode, "dry-run");
  assert.equal(existsSync(join(dirname(f.overlay), "..", "..", "skills", "delivery-closeout", "config", "repo-registry.json")), false);
});

test("delivery-closeout sync deletes a stale remote Repository Registry attachment", t => {
  const f = fixture(t, "remote-stale");
  f.write(f.shared + "workspaces/pilot.json", {
    workspace_id: "ws-1", skills: { "delivery-closeout": "skill-1" },
  });
  f.write("skills/delivery-closeout/SKILL.md", "---\nname: delivery-closeout\ndescription: fixture\n---\n");
  const localRegistry = join(dirname(f.overlay), "..", "..", "skills", "delivery-closeout", "config", "repo-registry.json");
  assert.equal(existsSync(localRegistry), false);

  const result = f.run("workspace", "sync-skills", "--workspace", "pilot", "--skill", "delivery-closeout");
  assert.equal(result.code, 0, JSON.stringify(result.body));
  assert.deepEqual(result.body.deleted_remote, ["delivery-closeout/config/repo-registry.json"]);
  assert.ok(f.calls().some(args =>
    args.includes("skill") && args[args.indexOf("skill") + 1] === "files" && args[args.indexOf("skill") + 2] === "delete" && args.at(-1) === "stale-registry"));
  assert.equal(existsSync(f.trace + ".stale"), false);

  const check = f.run("workspace", "sync-skills", "--workspace", "pilot", "--skill", "delivery-closeout", "--check");
  assert.equal(check.code, 0, JSON.stringify(check.body));
  assert.equal(check.body.result, "PASS");
});

test("Native Workspace provision does not read or inject the historical root branch variable", t => {
  const f = fixture(t, "native-branch");
  const result = f.run("workspace", "provision", "--workspace", "pilot", "--skip-workflow");
  assert.equal(result.code, 0, result.stderr);
  assert.ok(!f.calls().some(args => args.includes("env") || args.some(arg => arg.includes("RONDO_WORKSPACE_BRANCH"))));
});

test("TFS Sync Agent 按分组补齐 Project Title，保留已有环境变量并幂等", t => {
  const f = fixture(t, "sync-project");
  const args = ["workspace", "provision", "--workspace", "pilot", "--skip-workflow"];
  assert.equal(f.run(...args, "--dry-run").code, 0);
  assert.ok(!f.calls().some(a => a.includes("env") && a.includes("set")));
  const first = f.run(...args);
  assert.equal(first.code, 0, first.stderr);
  const env = JSON.parse(readFileSync(f.trace + ".sync-agent", "utf8"));
  assert.equal(env.RONDO_PROJECT_TITLE, "BI Project");
  assert.equal(env.OTHER, "fixture-private-value");
  assert.equal(env.RONDO_WORKSPACE_BRANCH, "dev");
  assert.equal(f.run(...args).code, 0);
  assert.equal(f.calls().filter(a => a.includes("env") && a.includes("set")).length, 1);
  for (const title of ["Manual Project", ""]) {
    const manual = { ...env, RONDO_PROJECT_TITLE: title, TFS_URL: "https://tfs.example", TFS_PAT: "fixture-pat" };
    writeFileSync(f.trace + ".sync-agent", JSON.stringify(manual));
    assert.equal(f.run(...args).code, 0);
    assert.deepEqual(JSON.parse(readFileSync(f.trace + ".sync-agent", "utf8")), manual);
    assert.equal(f.calls().filter(a => a.includes("env") && a.includes("set")).length, 1);
  }
  writeFileSync(f.trace + ".sync-agent", JSON.stringify({}));
  assert.equal(f.run(...args).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(f.trace + ".sync-agent", "utf8")), { RONDO_PROJECT_TITLE: "BI Project" });
  assert.equal(f.calls().filter(a => a.includes("env") && a.includes("set")).length, 2);
});
