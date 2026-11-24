import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { assertEngineerExecution, readDevelopmentCommit } from "../dist/commands/dev/requirement-guard.js";
import { parseRepositoryScope } from "../dist/commands/analysis/repository-scope.js";
import { checkedTaskProgress, validateChangeDelivery, checkPublishedChange } from "../dist/commands/dev/change-completion.js";
import { isRequirementChangeDelivery, assertRequirementEvidence } from "../dist/commands/delivery/requirement-mode.js";
import { isDeliveryTaskTitle, findDeliveryTasks, ensureDeliveryTasks } from "../dist/commands/tfs/requirement-tasks.js";
import { prepareRequirementWorktree, removePublishedRequirementWorktree } from "../dist/commands/dev/requirement-worktree.js";
import { TfsClient } from "../dist/tfs/client.js";
import { materializeOne } from "../dist/commands/pr/materialize.js";
import { outgoing, prepareRoot, publishChange } from "../dist/commands/runtime/root-git.js";

const repoUrl = "http://tfs.test/tfs/C/P/_git/biz";
const registry = {
  frame: { repo_path: "biz", repo_url: repoUrl, default_target_branch: "dev" },
  web: { repo_path: "web", repo_url: "http://tfs.test/tfs/C/P/_git/web", default_target_branch: "dev" },
};
const sha1 = "a".repeat(40);
const sha2 = "b".repeat(40);
function prep(key, sha) {
  return { repo_key: key, repo_url: registry[key].repo_url, source_branch: "feature/42", target_branch: "dev",
    candidate_commit: sha, title: "Change",
    description: "实现修复；已完成验证；风险已评估。",
    local_validation: { result: "PASS", summary: "Tests passed", command: ["node", "--test"],
      exit_code: 0, candidate_commit: sha, source: "rondo dev pr-prepare" },
    code_review: { result: "PASS", candidate_commit: sha, summary: "Reviewed", findings: [] }, blockers: [] };
}

test("Requirement Scope, Candidate 和验证/Review 必须由同一份原生事实绑定", () => {
  assert.deepEqual(parseRepositoryScope("schema: intentional-change\nx-repositories:\n  - frame\n  - web\n"), ["frame", "web"]);
  assert.deepEqual(validateChangeDelivery([prep("frame", sha1)], ["frame","web"], 42, registry), {frame:sha1});
  assert.deepEqual(validateChangeDelivery([prep("frame",sha1),prep("web",sha2)], ["frame","web"],42,registry), {frame:sha1,web:sha2});
  assert.throws(() => validateChangeDelivery([prep("web",sha2)], ["frame"],42,registry), /Scope/);
  assert.throws(() => validateChangeDelivery([{...prep("frame",sha1),local_validation:{...prep("frame",sha1).local_validation,candidate_commit:sha2}}], ["frame"],42,registry), /Candidate/);
  assert.throws(() => validateChangeDelivery([{...prep("frame",sha1),blockers:["blocking"]}], ["frame"],42,registry), /Blocking/);
  assert.throws(() => validateChangeDelivery([{...prep("frame",sha1),code_review:{...prep("frame",sha1).code_review,candidate_commit:sha2}}], ["frame"],42,registry), /Code Review/);
  assert.throws(() => validateChangeDelivery([{...prep("frame",sha1),code_review:{result:"PASS",candidate_commit:sha1,summary:"Review",findings:[{resolved:false,blocking:true}]}}], ["frame"],42,registry), /Blocking/);
  assert.doesNotThrow(() => validateChangeDelivery([{...prep("frame",sha1),code_review:{result:"PASS",candidate_commit:sha1,summary:"Review",findings:[{resolved:false,blocking:false,risk_note:"known acceptable risk"}]}}], ["frame"],42,registry));
});

test("PR 已登记/外部存在时必须核对 Candidate、状态、分支和专业描述", async (t) => {
  const previous = { TFS_SERVER_URL: process.env.TFS_SERVER_URL, TFS_PAT: process.env.TFS_PAT };
  process.env.TFS_SERVER_URL = "http://tfs.test/tfs/C"; process.env.TFS_PAT = "fixture";
  t.after(() => { for (const [k,v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k]=v; } });
  const entry = prep("frame", sha1);
  const cfg = { registry: { frame: { ...registry.frame, tfs_repo: "biz", tfs_project: "P" } } };
  let remoteHead = sha1;
  let description = "Engineer 已验证的专业 PR 描述";
  let prStatus = "active";
  let listed = false;
  const calls = [];
  const tfs = { run: async args => {
    calls.push(args.slice(0, 2).join(" "));
    if (args[0] === "branch") return { found: true, branch: { commit: remoteHead } };
    if (args[0] === "pr" && args[1] === "get") return {
      id: 17, status: prStatus, sourceBranch: "feature/42", targetBranch: "dev",
      description, url: "http://tfs.test/pr/17",
    };
    if (args[0] === "pr" && args[1] === "list") {
      listed = true;
      return [{ id: 17, targetBranch: "dev", url: "http://tfs.test/pr/17" }];
    }
    throw Error("Unexpected external PR write");
  } };
  const prior = { repo_key: "frame", pr_id: 17, pr_url: "http://tfs.test/pr/17",
    source_branch: "feature/42", target_branch: "dev" };
  await assert.rejects(materializeOne(tfs, cfg, "42", {...entry, repo_url: registry.web.repo_url}, prior, undefined, entry.description), /identity_mismatch/);
  await assert.rejects(materializeOne(tfs, cfg, "42", {...entry, target_branch: "main"}, prior, undefined, entry.description), /target_branch_mismatch/);
  assert.deepEqual(calls, [], "身份不一致不得产生外部 PR 操作");
  const reused = await materializeOne(tfs, cfg, "42", entry, prior, undefined, entry.description);
  assert.equal(reused.pr_id, 17);
  assert.equal(reused.reused, true);
  assert.equal(listed, false, "已登记 PR 必须先按 ID 回读而不是凭分支查找");
  assert.deepEqual(calls, ["branch get", "pr get"]);
  remoteHead = sha2;
  await assert.rejects(materializeOne(tfs, cfg, "42", entry, prior, undefined, entry.description), /HEAD/);
  remoteHead = sha1;
  description = "";
  await assert.rejects(materializeOne(tfs, cfg, "42", entry, prior, undefined, entry.description), /existing_pr_description_missing/);
  description = "专业内容";
  prStatus = "abandoned";
  await assert.rejects(materializeOne(tfs, cfg, "42", entry, prior, undefined, entry.description), /状态不匹配|外部身份/);
  prStatus = "active";
  listed = false;
  assert.equal((await materializeOne(tfs, cfg, "42", entry, undefined, undefined, entry.description)).pr_id, 17);
  assert.equal(listed, true, "未登记 PR 可通过外部 Active PR 发现后复用");
});

test("Requirement Closeout 读取批准范围与现有 pr_prep，不依赖 Evidence JSON", t => {
  const changeDir = mkdtempSync(join(tmpdir(), "rondo-requirement-scope-"));
  t.after(() => rmSync(changeDir, { recursive: true, force: true }));
  writeFileSync(join(changeDir, ".openspec.yaml"), "schema: intentional-change\nx-repositories: [frame]\n");
  writeFileSync(join(changeDir, "proposal.md"), "# Proposal\n");
  writeFileSync(join(changeDir, "tasks.md"), "- [x] 1.1 Build\n");
  const md = { "tfs.id": "42", "analysis.change_ref": "foo-42", pr_prep: JSON.stringify([prep("frame", sha1)]) };
  assert.doesNotThrow(() => assertRequirementEvidence(registry, md, changeDir, "foo-42"));
  writeFileSync(join(changeDir, ".openspec.yaml"), "schema: intentional-change\nx-repositories: [web]\n");
  assert.throws(() => assertRequirementEvidence(registry, md, changeDir, "foo-42"), /Scope/);
});

test("Repository Scope 和完整原生 Tasks 校验，拒绝重复、空范围和未完成项", () => {
  for (const text of [
    "schema: intentional-change\n",
    "x-repositories: []\n",
    "x-repositories: [frame, frame]\n",
    "x-repositories: [../bad]\n",
    "x-repositories: frame\n",
    "x-repositories: [frame, 12]\n",
    "x-repositories: [frame\n",
    "x-repositories: [frame]\nx-repositories: [web]\n",
  ]) {
    assert.throws(() => parseRepositoryScope(text));
  }
  assert.equal(checkedTaskProgress("# Tasks\n- [x] 1.1 Build\n- [X] 1.2 Verify\n"),2);
  assert.throws(()=>checkedTaskProgress("- [x] 1.1 Build\n- [ ] 1.2 Verify\n"),/未完成/);
  assert.throws(()=>checkedTaskProgress("- [x] 1.1 A\n- [x] 1.1 B\n"),/重复/);
  assert.throws(()=>checkedTaskProgress("- [x] 1.1 Build\n- [ ] Verify\n"),/未编号/);
  assert.throws(()=>checkedTaskProgress("- [x] 1.1 Build\n- [y] 1.2 Review\n"),/无效 checkbox/);
});

test("Completion 读取批准 SHA 与登记的研发 SHA，其他 Change 推进分支后仍通过 PR 前置检查", async t => {
  const source = { repo_url: repoUrl, change_ref: "foo-42", branch: "main", commit: sha1 };
  const ref = "/openspec/changes/" + source.change_ref;
  const proposal = "# Proposal\n";
  const scopeMetadata = "schema: intentional-change\nx-repositories:\n  - frame\n";
  const branchTip = "c".repeat(40);
  const files = {
    [sha1]: { ".openspec.yaml": scopeMetadata, "proposal.md": proposal, "tasks.md": "- [ ] 1.1 Build" },
    [sha2]: { ".openspec.yaml": scopeMetadata, "proposal.md": proposal, "tasks.md": "- [x] 1.1 Build" },
  };
  // A later commit to another Change leaves this directory identical; its SHA is not the delivery receipt.
  files[branchTip] = files[sha2];
  const approval = { source, decision: "approved", comment_ref: "approved", by: "human",
    at: "2026-11-19T00:00:00Z", verify_agent_required: false };
  const metadata = { "analysis.source": JSON.stringify(source), "analysis.gate.result": "PASS",
    "analysis.change_ref": source.change_ref, "analysis.human_approval": JSON.stringify(approval),
    "tfs.type": "需求", "tfs.id": "42", pr_prep: JSON.stringify([prep("frame", sha2)]),
    "dev.publication": JSON.stringify({ analysis_commit: sha1, commit: sha2 }) };
  const issue = { id: "issue", status: "in_progress", metadata };
  const cfg = { runtime: { workspace_id: "ws" }, registry };
  const env = { MULTICA_TASK_ID: "run", MULTICA_AGENT_ID: "agent", MULTICA_WORKSPACE_ID: "ws",
    MULTICA_TOKEN: "fixture", MULTICA_DAEMON_PORT: "1", TFS_PAT: "fixture", TFS_SERVER_URL: "http://tfs.test/tfs/C" };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    process.env[key] = value;
  }
  const multica = {
    ws: () => [], getIssue: () => issue, listComments: () => [{ id: "approved" }],
    run: args => args[0] === "issue"
      ? [{ id: "run", agent_id: "agent", issue_id: "issue", workspace_id: "ws", status: "running" }]
      : { id: "agent", name: "Engineer" },
  };
  const versions = new Set();
  t.mock.method(TfsClient.prototype, "rawRequest", async raw => {
    const url = new URL(raw), q = url.searchParams;
    if (url.pathname.endsWith("/refs")) return { statusCode: 200,
      body: JSON.stringify({ value: [{ name: "refs/heads/main", objectId: branchTip }] }) };
    const commit = q.get("versionDescriptor.version");
    versions.add(commit);
    const item = name => ({ path: ref + "/" + name, commitId: commit, objectId: "d".repeat(40) });
    const name = q.get("path")?.slice(ref.length + 1);
    const body = q.has("scopePath")
      ? { value: Object.keys(files[commit]).map(item) } : { ...item(name), content: files[commit][name] };
    return { statusCode: 200, body: JSON.stringify(body) };
  });
  const checked = await checkPublishedChange(cfg, multica, issue.id, source.change_ref);
  assert.equal(checked.commit, sha2);
  assert.deepEqual(checked.repo_keys, ["frame"]);
  assert.deepEqual(versions, new Set([sha1, sha2]));
  files[sha2][".openspec.yaml"] = "schema: intentional-change\nx-repositories:\n  - web\n";
  await assert.rejects(checkPublishedChange(cfg, multica, issue.id, source.change_ref), /\.openspec\.yaml/);
  for (const receipt of [undefined, "{", JSON.stringify({ analysis_commit: branchTip, commit: sha2 }),
    JSON.stringify({ analysis_commit: sha1, commit: "main" })]) {
    assert.throws(() => readDevelopmentCommit({ "dev.publication": receipt }, source), /dev.publication|研发发布记录/);
  }
});

test("Requirement 和旧 Task Set 明确分开，不隐式从缺少 dispatch 推断",()=>{
  const newMd={"tfs.id":"42","tfs.type":"需求","analysis.source":"{}",
    pr_prep:JSON.stringify([prep("frame",sha1)])};
  assert.equal(isRequirementChangeDelivery(newMd),true);
  const legacy={...newMd,pr_prep:JSON.stringify([{...prep("frame",sha1),source_branch:"feat/42"}])};
  assert.equal(isRequirementChangeDelivery(legacy),false);
  assert.throws(()=>isRequirementChangeDelivery({...newMd,"dev.dispatch":"[]"}),/dev.dispatch/);
  assert.throws(()=>isRequirementChangeDelivery({...newMd,pr_prep:JSON.stringify([prep("frame",sha1),{...prep("web",sha2),source_branch:"feat/42"}])}),/混合/);
});

test("兼容旧 Delivery Task helper：默认单任务与外部分合行为保留，不作为新 Requirement 入口",async()=>{
  assert.equal(isDeliveryTaskTitle("LEI-24","[LEI-24 Delivery] 开发"),true);
  assert.equal(isDeliveryTaskTitle("LEI-24","[LEI-24 Delivery/5] Backend"),true);
  assert.equal(isDeliveryTaskTitle("LEI-24","[LEI-24 1.1] Backend"),false);
  const state = { tasks:[], creates:0 };
  const client = {
    async tfsQuery(query) {
      return query.includes("System.Id] = 42")
        ? [{id:42,project:"P"}] : state.tasks;
    },
    async tfsCreateTask({title,parent}) {
      state.creates++;
      const t={id:55,title,parentId:parent,state:"活动"};
      state.tasks.push(t);
      return t;
    },
  };
  const first=await ensureDeliveryTasks(client,"LEI-24","foo-42",42);
  assert.deepEqual(first,{ids:[55],created:true});
  const replay=await ensureDeliveryTasks(client,"LEI-24","foo-42",42);
  assert.deepEqual(replay,{ids:[55],created:false});
  assert.equal(state.creates,1);
  state.tasks.push(...[1,2,3,4,5].map(i=>({id:55+i,parentId:42,title:"[LEI-24 Delivery/"+i+"] task"})));
  await assert.rejects(findDeliveryTasks(client,"LEI-24",42),/超过 5/);
  state.tasks = [{id:80,parentId:42,title:"[LEI-24 Delivery] default"},{id:81,parentId:42,title:"[LEI-24 Delivery/1] split"}];
  await assert.rejects(findDeliveryTasks(client,"LEI-24",42),/混用/);
  state.tasks = [{id:82,parentId:42,title:"[LEI-24 Delivery/1] A"},{id:83,parentId:42,title:"[LEI-24 Delivery/1] B"}];
  await assert.rejects(findDeliveryTasks(client,"LEI-24",42),/重复编号/);
  state.tasks = [{id:84,parentId:42,title:"[LEI-24 Delivery/1] A"},{id:85,parentId:42,title:"[LEI-24 Delivery/2] B"}];
  assert.deepEqual((await findDeliveryTasks(client,"LEI-24",42)).map(t=>t.id),[84,85]);
});

function git(cwd,...args){
  const r=spawnSync("git",args,{cwd,encoding:"utf8"});
  assert.equal(r.status,0,args.join(" ")+": "+r.stderr);
  return r.stdout.trim();
}
test("Requirement Worktree 支持候选恢复和交付后安全回收",t=>{
  const folder=realpathSync(mkdtempSync(join(tmpdir(),"rondo-req-wt-")));
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const root=join(folder,"root"), bare=join(folder,"bare.git");
  mkdirSync(root); mkdirSync(bare);
  git(bare,"init","--bare");
  git(root,"init","-b","dev");
  writeFileSync(join(root,".gitignore"),"biz*/\ndist/\nnode_modules/\n.env\n");
  git(root,"add",".gitignore");
  git(root,"-c","user.email=test@example.invalid","-c","user.name=Test","commit","-m","init");
  git(root,"push",bare,"dev");
  // The root is a separate repository; the business bare remote is seeded from the root only for transport fixture.
  const runRemote=(_url,args,cwd)=>{
    const mapped=args.map(a=>a===repoUrl || a==="origin"?bare:a);
    const r=spawnSync("git",mapped,{cwd,encoding:"utf8"});
    if(args[0]==="clone" && r.status===0)git(args.at(-1),"remote","set-url","origin",repoUrl);
    return {status:r.status,stdout:r.stdout,stderr:r.stderr};
  };
  const business={repo_path:"biz",repo_url:repoUrl,tfs_repo:"biz",tfs_project:"P",default_target_branch:"dev"};
  const one=prepareRequirementWorktree(root,business,42,"http://tfs.test/tfs/C",runRemote);
  assert.equal(one.changed,true);
  assert.equal(one.branch,"feature/42");
  assert.equal(readFileSync(join(one.path,".git"),"utf8").startsWith("gitdir:"),true);
  writeFileSync(join(one.path,"work.txt"),"WIP");
  const second=prepareRequirementWorktree(root,business,42,"http://tfs.test/tfs/C",()=>{throw Error("unexpected transport")});
  assert.equal(second.changed,false);
  assert.equal(readFileSync(join(one.path,"work.txt"),"utf8"),"WIP");
  const moved=join(folder,"other-wt");
  git(one.base,"worktree","add","-b","feature/43",moved,"origin/dev");
  assert.equal(git(moved,"symbolic-ref","--short","HEAD"),"feature/43");
  // Another existing local branch checkout remains owned by its Worktree and must never be stolen.
  const wrong=join(root,"biz-43");
  assert.throws(()=>prepareRequirementWorktree(root,business,43,"http://tfs.test/tfs/C",runRemote),/Worktree|already checked out/i);
  assert.equal(readFileSync(join(one.path,"work.txt"),"utf8"),"WIP");
  // Stale local branch may be fast-forwarded only when it is not checked out.
  git(one.base,"branch","feature/46","origin/dev");
  const remoteClone=join(folder,"other-runtime");
  git(folder,"clone",bare,remoteClone);
  git(remoteClone,"checkout","-b","feature/46","origin/dev");
  writeFileSync(join(remoteClone,"remote.txt"),"remote commit");
  git(remoteClone,"add","remote.txt");
  git(remoteClone,"-c","user.name=Test","-c","user.email=test@example.invalid","commit","-m","remote candidate");
  git(remoteClone,"push",bare,"feature/46");
  const recovered=prepareRequirementWorktree(root,business,46,"http://tfs.test/tfs/C",runRemote);
  assert.equal(recovered.head,git(remoteClone,"rev-parse","HEAD"));
  assert.equal(readFileSync(join(recovered.path,"remote.txt"),"utf8"),"remote commit");

  assert.throws(() => removePublishedRequirementWorktree(root, business, 42, sha1), /HEAD/);
  assert.throws(() => removePublishedRequirementWorktree(root, business, 42, one.head), /本地修改/);
  unlinkSync(join(one.path, "work.txt"));
  writeFileSync(join(one.path, ".env"), "local");
  assert.throws(() => removePublishedRequirementWorktree(root, business, 42, one.head), /未确认可丢弃/);
  unlinkSync(join(one.path, ".env"));
  for (const dir of ["dist", "node_modules"]) {
    mkdirSync(join(one.path, dir));
    writeFileSync(join(one.path, dir, "generated.txt"), "generated");
  }
  assert.equal(removePublishedRequirementWorktree(root, business, 42, one.head), "biz-42");
  assert.equal(existsSync(one.path), false);
  assert.equal(removePublishedRequirementWorktree(root, business, 42, one.head), undefined);
  assert.equal(git(one.base, "rev-parse", "feature/42"), one.head);
  assert.equal(git(recovered.path, "symbolic-ref", "--short", "HEAD"), "feature/46");
  assert.equal(git(moved, "symbolic-ref", "--short", "HEAD"), "feature/43");

  writeFileSync(join(root,".gitignore"),"biz/\n");
  assert.throws(()=>prepareRequirementWorktree(root,business,44,"http://tfs.test/tfs/C",runRemote),/未被根仓忽略/);
});

test("原生 @Engineer Run 的真实 Actor / Workspace 身份必须匹配，不能以旧 dispatch 代替",()=>{
  const keys=["MULTICA_TASK_ID","MULTICA_AGENT_ID","MULTICA_WORKSPACE_ID","MULTICA_TOKEN","MULTICA_DAEMON_PORT"];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const restore=()=>{for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}};
  try{
    Object.assign(process.env,{MULTICA_TASK_ID:"run-1",MULTICA_AGENT_ID:"eng-1",MULTICA_WORKSPACE_ID:"ws-1",
      MULTICA_TOKEN:"test-token",MULTICA_DAEMON_PORT:"1234"});
    const issue={id:"issue-1"};
    const client={
      ws:()=>["--workspace-id","ws-1"],
      run:(args)=>args[0]==="agent" ? {id:"eng-1",name:"Engineer"} :
        [{id:"run-1",issue_id:"issue-1",agent_id:"eng-1",workspace_id:"ws-1",status:"running"}],
    };
    assert.doesNotThrow(()=>assertEngineerExecution(client,issue,"ws-1"));
    assert.throws(()=>assertEngineerExecution({...client,run:(args)=>args[0]==="agent"?{id:"eng-1",name:"Backend Engineer"}:client.run(args)},issue,"ws-1"),/Engineer/);
    assert.throws(()=>assertEngineerExecution(client,issue,"ws-other"),/Workspace/);
    delete process.env.MULTICA_AGENT_ID;
    assert.throws(()=>assertEngineerExecution(client,issue,"ws-1"),/Actor/);
  }finally{restore();}
});

test("根仓 Push 历史允许单 Change Commit，拒绝未核验 Merge Commit", t => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "rondo-root-push-")));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const root = join(folder, "root"), bare = join(folder, "bare.git");
  mkdirSync(root); mkdirSync(bare);
  git(bare, "init", "--bare");
  git(root, "init", "-b", "main");
  writeFileSync(join(root, "README.md"), "base");
  git(root, "add", "README.md");
  git(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "base");
  git(root, "remote", "add", "origin", bare);
  git(root, "push", "-u", "origin", "main");
  const changeDir = join(root, "openspec", "changes", "feature-42");
  mkdirSync(changeDir, {recursive:true});
  writeFileSync(join(changeDir, "a.md"), "a");
  git(root, "add", "openspec/changes/feature-42/a.md");
  git(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "approved");
  const tip = git(root, "rev-parse", "HEAD");
  assert.doesNotThrow(() => outgoing(root, "main", tip, "openspec/changes/feature-42/"));

  git(root, "checkout", "-b", "side", "origin/main");
  mkdirSync(changeDir, {recursive:true});
  writeFileSync(join(changeDir, "b.md"), "b");
  git(root, "add", "openspec/changes/feature-42/b.md");
  git(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "side");
  git(root, "checkout", "main");
  git(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "merge", "--no-ff", "side", "-m", "merge");
  assert.throws(() => outgoing(root, "main", git(root, "rev-parse", "HEAD"), "openspec/changes/feature-42/"), /Merge/);
});


test("Proposal 不保存仓库清单；Change 元数据由 spec-preparation Skill 维护", () => {
  for (const schema of ["corrective-change", "intentional-change"]) {
    const proposal = readFileSync(new URL("../../../openspec/schemas/" + schema + "/templates/proposal.md", import.meta.url), "utf8");
    assert.doesNotMatch(proposal, /^## Repository Scope$/m);
  }
  const skill = readFileSync(new URL("../../skills/spec-preparation/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /x-repositories/);
});

test("多个 Rondo 发布的 Change 允许共用一次 Push，拒绝无凭据的其他 Commit", t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rondo-sibling-")));
  t.after(() => rmSync(dir, {recursive:true,force:true}));
  const root=join(dir,"root"),bare=join(dir,"bare.git"); mkdirSync(root);mkdirSync(bare);
  git(bare,"init","--bare");git(root,"init","-b","main");
  writeFileSync(join(root,"README.md"),"base");
  git(root,"add","README.md");
  git(root,"-c","user.email=test@example.invalid","-c","user.name=Test","commit","-m","init");
  git(root,"remote","add","origin",bare);git(root,"push","-u","origin","main");
  const addChange=(ref, marked)=>{
    const dir=join(root,"openspec","changes",ref);mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,"tasks.md"),"- [x] 1.1 Done\n");
    git(root,"add","openspec/changes/"+ref);
    const args=["-c","user.email=test@example.invalid","-c","user.name=Test","commit","-m","analysis: "+ref+" (ISSUE)"];
    if(marked)args.push("-m","Rondo-Publish: 11111111-1111-4111-8111-111111111111");
    git(root,...args);
  };
  addChange("first-1",false);addChange("second-2",true);
  assert.doesNotThrow(()=>outgoing(root,"main",git(root,"rev-parse","HEAD"),"openspec/changes/first-1/"));
  addChange("third-3",false);
  assert.throws(()=>outgoing(root,"main",git(root,"rev-parse","HEAD"),"openspec/changes/first-1/"),/受控发布标记/);
});

test("持久根仓安全 Fast-forward 保留其他 Change 的 staged WIP",async t=>{
  const dir=realpathSync(mkdtempSync(join(tmpdir(),"rondo-dirty-root-")));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const root=join(dir,"root"),bare=join(dir,"bare.git");mkdirSync(root);mkdirSync(bare);
  git(bare,"init","--bare");git(root,"init","-b","main");
  mkdirSync(join(root,"openspec","schemas"),{recursive:true});
  writeFileSync(join(root,"openspec","schemas","sample.yaml"),"schema");
  const mapping=join(root,"docs","config");mkdirSync(mapping,{recursive:true});
  const url="http://tfs.test/tfs/C/P/_git/root";
  writeFileSync(join(mapping,"repo-context.yaml"),"repos:\n  - repo_id: root\n    repo_url: "+url+"\n");
  const other=join(root,"openspec","changes","other-200");mkdirSync(other,{recursive:true});
  writeFileSync(join(other,"tasks.md"),"initial\n");
  git(root,"add",".");git(root,"-c","user.email=test@example.invalid","-c","user.name=Test","commit","-m","init");
  git(root,"remote","add","origin",url);
  git(root,"push",bare,"main");
  git(root,"checkout","-b","advance");
  const fresh=join(root,"openspec","changes","new-100");mkdirSync(fresh,{recursive:true});
  writeFileSync(join(fresh,"proposal.md"),"approved\n");
  git(root,"add",".");
  git(root,"-c","user.email=test@example.invalid","-c","user.name=Test","commit","-m","approved change");
  git(root,"push",bare,"HEAD:refs/heads/main");
  git(root,"checkout","main");
  writeFileSync(join(other,"tasks.md"),"local WIP\n");git(root,"add","openspec/changes/other-200/tasks.md");
  const remote=(_url,args,cwd)=>{
    const r=spawnSync("git",args.map(arg=>arg==="origin"?bare:arg),{cwd,encoding:"utf8"});
    return {status:r.status,stdout:r.stdout,stderr:r.stderr};
  };
  const oldBranch=process.env.RONDO_WORKSPACE_BRANCH;
  t.after(()=>{ if(oldBranch===undefined) delete process.env.RONDO_WORKSPACE_BRANCH; else process.env.RONDO_WORKSPACE_BRANCH=oldBranch; });
  process.env.RONDO_WORKSPACE_BRANCH="main";
  const result=prepareRoot(root,"main",remote);
  assert.equal(result.updated,true);assert.equal(result.preserved_wip,true);
  assert.equal(readFileSync(join(other,"tasks.md"),"utf8"),"local WIP\n");
  assert.equal(readFileSync(join(fresh,"proposal.md"),"utf8"),"approved\n");
  assert.match(git(root,"status","--porcelain","--","openspec/changes/other-200/tasks.md"),/^M /);
  const oldTip=git(root,"rev-parse","HEAD");
  await assert.rejects(()=>publishChange(root,"new-100","ISSUE",undefined,undefined,
    {repoUrl:"http://tfs.test/tfs/C/P/_git/wrong-root",expectedBranch:"main"}),/Origin \/ Branch/);
  assert.equal(git(root,"rev-parse","HEAD"),oldTip);

  // Authenticated-mode Git operations use the supplied remote transport, not local credential helpers.
  writeFileSync(join(fresh,"proposal.md"),"progress");
  const authorized=(_url,args,cwd)=>{
    const mapped=args[0]==="fetch"
      ? ["fetch",bare,"+refs/heads/main:refs/remotes/origin/main"]
      : ["push",bare,args[2]];
    const p=spawnSync("git",mapped,{cwd,encoding:"utf8"});
    return {status:p.status,stdout:p.stdout,stderr:p.stderr};
  };
  const done=await publishChange(root,"new-100","ISSUE",undefined,undefined,{repoUrl:url,expectedBranch:"main",remote:authorized});
  assert.equal(done.pushed,true);
  assert.equal(git(root,"rev-parse","refs/remotes/origin/main"),done.commit);
  assert.match(git(root,"status","--porcelain","--","openspec/changes/other-200/tasks.md"),/^M /);
});
