import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, chmodSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { recordApproval } from "../dist/commands/analysis/approve.js";
import { assertProjectedVerifyDecision } from "../dist/commands/delivery/verify-decision.js";

const source = {repo_url:"https://tfs.example.test/tfs/Collection/Project/_git/root", branch:"main",
  commit:"a".repeat(40), change_ref:"change-123"};
const args = {issue:"LEI-123", commentId:"human-1", commit:source.commit, verifyRequired:"false"};
function fixture() {
  const issue = {id:"issue-1",identifier:"LEI-123",status:"analysis_review",metadata:{
    "tfs.type":"需求","tfs.id":"123","analysis.gate.result":"PASS",
    "analysis.change_ref":source.change_ref,"analysis.source":JSON.stringify(source)
  }};
  const comments = [{id:"human-1",content:"批准，不需要独立验收",author_type:"member",
    author_id:"member-1",created_at:"2026-11-25T00:00:00Z"}];
  const writes = [];
  const client = {getIssue:()=>structuredClone(issue),listComments:()=>structuredClone(comments),
    setMetadata:(_id,key,value)=>{writes.push(key);issue.metadata[key]=value;},
    setStatusNoStart:(_id,status)=>{writes.push("status");issue.status=status;}};
  return {issue,comments,writes,client};
}
test("registers exact source and both verify facts before no-start transition; replay is NOOP",()=>{
  const f=fixture();
  assert.equal(recordApproval(f.client,args).result,"PASS");
  assert.deepEqual(f.writes,["analysis.human_approval","verify_agent.required","status"]);
  const approval=JSON.parse(f.issue.metadata["analysis.human_approval"]);
  assert.deepEqual(approval.source,source);
  assert.equal(approval.by,"member-1");
  assert.equal(approval.at,"2026-11-25T00:00:00.000Z");
  assert.equal(assertProjectedVerifyDecision(f.issue.metadata),false);
  assert.equal(f.issue.status,"in_progress");
  assert.equal(recordApproval(f.client,args).result,"NOOP");
  assert.equal(f.writes.length,3);
});
test("rejects invalid source, gate, non-Human comment, missing time and invalid status before writes",()=>{
  for(const mutate of [
    f=>f.issue.metadata["analysis.gate.result"]="FAIL",
    f=>f.comments[0].author_type="agent",
    f=>delete f.comments[0].created_at,
    f=>f.issue.status="done",
    f=>f.issue.metadata["tfs.type"]="Bug",
    f=>delete f.issue.metadata["tfs.id"],
    f=>f.issue.metadata["dev.dispatch"]="[]",
    f=>f.issue.metadata["finalize.pending"]="true",
  ]) {
    const f=fixture();mutate(f);
    assert.throws(()=>recordApproval(f.client,args));assert.deepEqual(f.writes,[]);
  }
  const f=fixture();
  assert.throws(()=>recordApproval(f.client,{...args,commit:"b".repeat(40)}));
  assert.throws(()=>recordApproval(f.client,{...args,verifyRequired:"maybe"}));
  assert.deepEqual(f.writes,[]);
});
test("resumes partial write and never repeats no-start transition",()=>{
  const f=fixture(),write=f.client.setMetadata;
  f.client.setMetadata=(id,key,value)=>{if(key==="verify_agent.required")throw Error("interrupted");write(id,key,value);};
  assert.throws(()=>recordApproval(f.client,args));
  assert.equal(f.issue.status,"analysis_review");
  f.client.setMetadata=write;
  assert.equal(recordApproval(f.client,args).result,"PASS");
  assert.deepEqual(f.writes,["analysis.human_approval","verify_agent.required","status"]);
});
test("same comment cannot change decision; newer explicit override does not restart work",()=>{
  const f=fixture();recordApproval(f.client,args);
  assert.throws(()=>recordApproval(f.client,{...args,verifyRequired:"true"}));
  f.comments.push({...f.comments[0],id:"human-2",created_at:"2026-11-25T01:00:00Z"});
  assert.equal(recordApproval(f.client,{...args,commentId:"human-2",verifyRequired:"true"}).result,"PASS");
  assert.equal(assertProjectedVerifyDecision(f.issue.metadata),true);
  assert.equal(f.writes.filter(x=>x==="status").length,1);
  assert.throws(()=>recordApproval(f.client,args));
});
test("source drift before write stops registration",()=>{
  const f=fixture(),list=f.client.listComments;
  f.client.listComments=()=>{f.issue.metadata["analysis.source"]=JSON.stringify({...source,commit:"b".repeat(40)});return list();};
  assert.throws(()=>recordApproval(f.client,args),/变化/);
  assert.deepEqual(f.writes,[]);
});
test("new approved version requires new comment and analysis review",()=>{
  const f=fixture();recordApproval(f.client,args);
  const next={...source,commit:"b".repeat(40)};
  f.issue.metadata["analysis.source"]=JSON.stringify(next);
  f.comments.push({...f.comments[0],id:"human-2",created_at:"2026-11-25T01:00:00Z"});
  const updated={...args,commentId:"human-2",commit:next.commit};
  assert.throws(()=>recordApproval(f.client,updated));
  f.issue.status="analysis_review";
  assert.throws(()=>recordApproval(f.client,{...args,commit:next.commit}));
  assert.equal(recordApproval(f.client,updated).result,"PASS");
  assert.deepEqual(JSON.parse(f.issue.metadata["analysis.human_approval"]).source,next);
});

test("approval remains confirmed when Issue is already todo or in_progress",()=>{
  for(const status of ["todo","in_progress"]){
    const f=fixture();f.issue.status=status;
    assert.equal(recordApproval(f.client,{...args,verifyRequired:"true"}).result,"PASS");
    assert.deepEqual(f.writes,["analysis.human_approval","verify_agent.required"]);
    assert.equal(f.issue.status,status);
    assert.equal(assertProjectedVerifyDecision(f.issue.metadata),true);
  }
});
test("readback mismatch prevents state transition and can be retried",()=>{
  const f=fixture(),write=f.client.setMetadata;
  f.client.setMetadata=(id,key,value)=>{if(key!=="verify_agent.required")write(id,key,value);};
  assert.throws(()=>recordApproval(f.client,args),/变化/);
  assert.equal(f.issue.status,"analysis_review");
  f.client.setMetadata=write;
  assert.equal(recordApproval(f.client,args).result,"PASS");
  assert.deepEqual(f.writes,["analysis.human_approval","verify_agent.required","status"]);
});
test("approval CLI uses current Runtime without registry or Agent/Run identity", t=>{
  const dir=mkdtempSync(join(tmpdir(),"rondo-analysis-approve-"));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const cli=fileURLToPath(new URL("../dist/index.js",import.meta.url));
  const mock=fileURLToPath(new URL("./mock-multica.cjs",import.meta.url));
  const multica=join(dir,process.platform==="win32"?"multica.cmd":"multica");
  if(process.platform==="win32")writeFileSync(multica,`@echo off\r\nnode "${mock}" %*\r\n`);
  else {copyFileSync(mock,multica);chmodSync(multica,0o755);}
  const f=fixture(),statePath=join(dir,"state.json"),callsPath=join(dir,"calls.jsonl");
  writeFileSync(statePath,JSON.stringify({issues:{[f.issue.identifier]:f.issue},comments:{[f.issue.id]:f.comments}}));
  const pathKey=Object.keys(process.env).find(k=>k.toLowerCase()==="path")??"PATH";
  const env={...process.env,[pathKey]:dir+delimiter+(process.env[pathKey]??""),
    MULTICA_CLI_PATH:multica,MULTICA_SERVER_URL:"http://multica.test",MULTICA_WORKSPACE_ID:"workspace-1",
    MULTICA_AGENT_ID:"",MULTICA_TASK_ID:"",MOCK_REQUIRE_TASK_RUNTIME:"0",
    MOCK_STATE:statePath,MOCK_SYNC_CALLS_FILE:callsPath,MOCK_EXPECT_SERVER:"http://multica.test"};
  function run(required="true"){
    writeFileSync(callsPath,"");
    const cp=spawnSync(process.execPath,[cli,"analysis","approve","--issue",args.issue,
      "--comment-id",args.commentId,"--commit",args.commit,"--verify-required",required],{env,encoding:"utf8",cwd:dir});
    assert.equal(cp.error,undefined,cp.error?.message);
    let body;try{body=JSON.parse(cp.stdout);}catch{assert.fail(cp.stdout+"\n"+cp.stderr);}
    return {code:cp.status,body,calls:readFileSync(callsPath,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse)};
  }
  const first=run();
  assert.equal(first.code,0,JSON.stringify(first));assert.equal(first.body.result,"PASS");
  assert.equal(first.body.verify_agent_required,true);
  assert.equal(first.calls.filter(c=>c[0]==="issue"&&c[1]==="get").length,4);
  assert.equal(first.calls.filter(c=>c[0]==="issue"&&c[1]==="metadata"&&c[2]==="set").length,2);
  const status=first.calls.filter(c=>c[0]==="issue"&&c[1]==="status");
  assert.equal(status.length,1);assert.ok(status[0].includes("--no-start"));
  assert.ok(first.calls.every(c=>c[0]==="issue" && c[1]!=="runs" && !(c[1]==="comment"&&c[2]!=="list")));
  const saved=JSON.parse(readFileSync(statePath,"utf8")).issues[f.issue.identifier];
  assert.equal(saved.status,"in_progress");assert.equal(assertProjectedVerifyDecision(saved.metadata),true);
  const again=run();assert.equal(again.code,0,JSON.stringify(again));assert.equal(again.body.result,"NOOP");
  assert.ok(!again.calls.some(c=>c[1]==="status"||c[2]==="set"));
  assert.equal(run("maybe").code,2);
});
test("retired change-handoff is absent from published assets and Workspace overlays",()=>{
  const root=fileURLToPath(new URL("../../",import.meta.url));
  const manifest=JSON.parse(readFileSync(join(root,"workspace-config/provisioning.json"),"utf8"));
  assert.deepEqual(manifest.agents.find(a=>a.name==="Delivery Lead").skills,[]);
  assert.ok(!manifest.managed_skills.includes("change-handoff"));
  assert.ok(!existsSync(join(root,"skills/change-handoff")));
  const dir=join(root,"workspace-config/workspaces");
  for(const name of readdirSync(dir).filter(n=>n.endsWith(".json"))){
    assert.ok(!Object.hasOwn(JSON.parse(readFileSync(join(dir,name),"utf8")).skills??{},"change-handoff"),name);
  }
});
