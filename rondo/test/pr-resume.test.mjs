import test from "node:test";
import assert from "node:assert/strict";
import { resumePr } from "../dist/commands/pr/resume.js";
import { validateChangeDelivery } from "../dist/commands/dev/change-completion.js";
import { deliveryCommentReference } from "../dist/commands/tfs/delivery-comment.js";

const sha="a".repeat(40);
const source={repo_url:"https://tfs.test/tfs/C/P/_git/root",branch:"dev",commit:sha,change_ref:"fix-42"};
function record(key,id) {
  const repo_url="https://tfs.test/tfs/C/P/_git/"+key;
  return {repo_key:key,repo_url,source_branch:"feature/42",target_branch:"dev",candidate_commit:sha,
    title:"fix",description:"fix and test",pr_id:id,pr_url:repo_url+"/pullrequest/"+id,
    local_validation:{result:"PASS",source:"rondo pr prepare",exit_code:0,summary:"pass",command:["test"],candidate_commit:sha},
    code_review:{result:"PASS",candidate_commit:sha,summary:"reviewed",findings:[]}};
}
function fixture() {
  const a=record("frame",1), b=record("web",2);
  const issue={id:"i",identifier:"I-1",status:"blocked",metadata:{
    "tfs.type":"需求","tfs.id":"42","analysis.gate.result":"PASS","analysis.source":JSON.stringify(source),
    "analysis.human_approval":JSON.stringify({decision:"approved",by:"member",at:"2026-11-25T00:00:00Z",comment_ref:"approval",verify_agent_required:false,source}),
    pr:JSON.stringify([a,b]),"pr.abandoned":JSON.stringify([{repo_key:"web",pr_id:2,event_key:"I-1#web#2#abandoned",detected_at:"2026-11-25T01:00:00Z"}])}};
  const comment={id:"human",author_type:"member",author_id:"member",content:"恢复交付",created_at:"2026-11-25T02:00:00Z"};
  const writes=[],checks=[];
  const client={
    getIssue:()=>structuredClone(issue),
    listComments:()=>[comment],
    setMetadata(id,key,value){writes.push(key);issue.metadata[key]=value;},
    setStatusNoStart(id,status){writes.push("status");issue.status=status;}
  };
  const verify=async (p,checkCandidate)=>{checks.push([p.repo_key,checkCandidate]);};
  const run=(next,check=verify)=>resumePr(client,issue.id,comment.id,next,check);
  const records=()=>JSON.parse(issue.metadata.pr);
  return {a,b,issue,comment,client,writes,checks,run,records};
}
test("REWORK invalidates only the abandoned repository and keeps it in the required actual delivery set",async()=>{
  const f=fixture();
  const result=await f.run("REWORK");
  assert.equal(result.result,"PASS");
  assert.equal(f.issue.status,"blocked");
  assert.deepEqual(f.records()[0],f.a);
  const b=f.records()[1];
  assert.equal(b.repo_key,"web");
  assert.equal(b.pr_id,undefined);
  assert.equal(b.pr_url,undefined);
  assert.equal(b.local_validation,undefined);
  assert.equal(b.code_review,undefined);
  const registry=Object.fromEntries([f.a,f.b].map(p=>[p.repo_key,{repo_url:p.repo_url,default_target_branch:"dev"}]));
  assert.throws(()=>validateChangeDelivery(f.records(),["frame","web"],42,registry),/验证/);
  assert.deepEqual(f.checks,[["web",false]]);
  assert.deepEqual(f.writes,["pr"]);
  await assert.rejects(f.run("REWORK"),/没有当前已登记/);
  assert.equal(f.writes.length,1);
});
test("RECREATE_PR preserves Candidate and evidence; rejects changed Candidate before any write",async()=>{
  const f=fixture();
  await assert.rejects(f.run("RECREATE_PR",async()=>{throw Error("Candidate changed");}),/Candidate changed/);
  assert.deepEqual(f.writes,[]);
  await f.run("RECREATE_PR");
  assert.deepEqual(f.checks,[["web",true]]);
  const {pr_id,pr_url,...prepared}=f.b;
  assert.deepEqual(f.records(),[f.a,prepared]);
  assert.equal(f.issue.status,"blocked");
});
test("non-Human or stale comment cannot alter PR facts",async()=>{
  const f=fixture();
  f.comment.author_type="agent";
  await assert.rejects(f.run("REWORK"),/真实成员/);
  f.comment.author_type="member";
  f.comment.created_at="2026-11-25T00:30:00Z";
  await assert.rejects(f.run("REWORK"),/早于/);
  assert.deepEqual(f.writes,[]);
});
test("interrupted PR write can retry while original facts remain",async()=>{
  const f=fixture(), write=f.client.setMetadata;
  f.client.setMetadata=(id,key,value)=>{if(key==="pr")throw Error("interrupted");write(id,key,value);};
  await assert.rejects(f.run("REWORK"),/interrupted/);
  assert.equal(f.issue.status,"blocked");
  f.client.setMetadata=write;
  assert.equal((await f.run("REWORK")).result,"PASS");
  assert.equal(f.records()[1].pr_id,undefined);
});
test("old decision after PR reset does not unblock a subsequent blocker or remove a replacement PR",async()=>{
  const f=fixture();
  await f.run("RECREATE_PR");
  f.issue.status="blocked";
  f.issue.metadata.pr=JSON.stringify([f.a,record("web",3)]);
  const before=structuredClone(f.issue);
  await assert.rejects(f.run("RECREATE_PR"),/没有当前已登记/);
  assert.deepEqual(f.issue,before);
});
test("a new abandoned event cannot be acted on by an older Human Comment",async()=>{
  const f=fixture();
  await f.run("RECREATE_PR");
  f.issue.metadata.pr=JSON.stringify([f.a,record("web",3)]);
  const events=JSON.parse(f.issue.metadata["pr.abandoned"]);
  events.push({repo_key:"web",pr_id:3,event_key:"I-1#web#3#abandoned",detected_at:"2026-11-25T03:00:00Z"});
  f.issue.metadata["pr.abandoned"]=JSON.stringify(events);
  const before=structuredClone(f.issue);
  await assert.rejects(f.run("REWORK"),/早于/);
  assert.deepEqual(f.issue,before);
});
test("Bug REWORK retains fixed scope and refuses mixed PR sets",async()=>{
  const f=fixture(), md=f.issue.metadata;
  md["tfs.type"]="Bug";
  delete md["analysis.source"];
  delete md["analysis.human_approval"];
  delete md["analysis.gate.result"];
  md["bug.required_repos"]=JSON.stringify(["frame","web"]);
  await assert.rejects(f.run("REWORK"),/尚未确认 abandoned/);
  assert.deepEqual(f.writes,[]);
  md["pr.abandoned"]=JSON.stringify([...JSON.parse(md["pr.abandoned"]),
    {repo_key:"frame",pr_id:1,event_key:"I-1#frame#1#abandoned",detected_at:"2026-11-25T01:00:00Z"}]);
  await f.run("REWORK");
  assert.deepEqual(f.records(),[]);
  assert.equal(md["bug.required_repos"],JSON.stringify(["frame","web"]));
  assert.equal(f.issue.status,"blocked");
  assert.deepEqual(f.writes,["pr"]);
});
test("Bug RECREATE_PR refuses missing professional Evidence before writes",async()=>{
  const f=fixture(), md=f.issue.metadata;
  md["tfs.type"]="Bug";
  delete md["analysis.source"];
  delete md["analysis.human_approval"];
  delete md["analysis.gate.result"];
  md["bug.required_repos"]=JSON.stringify(["frame","web"]);
  md["pr.abandoned"]=JSON.stringify([...JSON.parse(md["pr.abandoned"]),
    {repo_key:"frame",pr_id:1,event_key:"I-1#frame#1#abandoned",detected_at:"2026-11-25T01:00:00Z"}]);
  await assert.rejects(f.run("RECREATE_PR"),/缺少 expected_behavior/);
  assert.deepEqual(f.writes,[]);
});
test("readback drift blocks PR recovery without overwriting concurrent facts",async()=>{
  const f=fixture();
  await assert.rejects(f.run("REWORK",async()=>{f.issue.metadata.pr=JSON.stringify([f.a,record("web",3)]);}),/事实变化/);
  assert.deepEqual(f.writes,[]);
});
test("TFS comment identity consumes only fully registered PRs and pinned Change identity",()=>{
  const f=fixture();
  const initial=deliveryCommentReference(f.issue);
  f.issue.metadata.pr=JSON.stringify([f.b,f.a]);
  assert.equal(deliveryCommentReference(f.issue),initial);
  f.issue.metadata["analysis.source"]=JSON.stringify({...source,change_ref:"another"});
  assert.notEqual(deliveryCommentReference(f.issue),initial);
  const {pr_id,pr_url,...prepared}=f.b;
  f.issue.metadata.pr=JSON.stringify([f.a,prepared]);
  assert.throws(()=>deliveryCommentReference(f.issue),/不完整/);
});
