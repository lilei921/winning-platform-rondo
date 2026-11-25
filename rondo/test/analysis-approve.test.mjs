import test from "node:test";
import assert from "node:assert/strict";
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
