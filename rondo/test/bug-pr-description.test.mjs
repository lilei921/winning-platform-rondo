import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { materializeOne } from "../dist/commands/pr/materialize.js";
test("new PR submits Agent description unchanged and verifies existing Work Item link",async()=>{
  const repo={project:"P",repo:"biz",projectId:"11111111-1111-1111-1111-111111111111",repoId:"22222222-2222-2222-2222-222222222222"};
  const sha="a".repeat(40),desc="## Root Cause\n实际故障\n\n验证与风险";
  const entry={repo_key:"biz",repo_url:"http://tfs.test/C/P/_git/biz",source_branch:"feature/42",target_branch:"main",candidate_commit:sha,title:"fix",description:desc};
  let file,linked=false,writes=0;
  const api={config:{serverUrl:"http://tfs.test/C"},rawRequest:async(url,method,body)=>{
    if(method==="GET")return {statusCode:200,body:JSON.stringify({id:42,rev:2,relations:linked?[{rel:"ArtifactLink",url:"vstfs:///Git/PullRequestId/"+repo.projectId+"%2F"+repo.repoId+"%2F9"}]:[]})};
    writes++;linked=true;return {statusCode:200,body:"{}"};
  }};
  const tfs={run:async args=>{
    if(args[0]==="branch")return {found:true,branch:{commit:sha}};
    if(args[1]==="list")return [];
    if(args[1]==="create"){file=args[args.indexOf("--description-file")+1];assert.equal(readFileSync(file,"utf8"),desc);return {created:true,pr:{id:9}};}
    if(args[1]==="get")return {id:9,status:"active",sourceBranch:entry.source_branch,targetBranch:entry.target_branch,description:desc};
    throw Error("unexpected command");
  }};
  assert.equal((await materializeOne(tfs,api,42,entry,repo,undefined,false,()=>{})).pr_id,9);
  assert.equal(writes,1);assert.equal(existsSync(file),false);
});
