import test from "node:test";
import assert from "node:assert/strict";
import { commitArtifactUrl } from "./commit-identity.js";
import { commitTaskOwners, hasExactArtifactLink, prChangedCommits } from "./commit-facts.js";

const repo={project:"Hospital",repo:"frame",projectId:"11111111-1111-1111-1111-111111111111",
  repoId:"22222222-2222-2222-2222-222222222222"};
const sha="a".repeat(40);
function clientWith(owners:number[], mode:"okay"|"omitted"|"mismatch"="okay"):any {
  return {config:{serverUrl:"http://tfs.example/tfs/C"},
    async rawRequest(input:string) {
      const url=new URL(input);
      if (url.pathname.endsWith("/commits")) return {statusCode:200,body:JSON.stringify({value:[{
        commitId:sha,...(mode==="omitted"?{}:{workItems:owners.map(id=>({id}))})}]})};
      if (url.pathname.endsWith("/workitems")) return {statusCode:200,body:JSON.stringify({value:owners.map(id=>({
        id, fields:{"System.WorkItemType":"任务"},
        relations:[{rel:"ArtifactLink",url:commitArtifactUrl({...repo,sha:mode==="mismatch"?"b".repeat(40):sha})}],
      }))})};
      throw new Error("Unexpected URL "+url);
    },
  };
}
test("反向查询未经真实 TFS 2018 验证则 UNKNOWN，不能认为没有占用", async t=>{
  const prev=process.env.RONDO_TFS_REVERSE_QUERY_VERIFIED;
  t.after(()=>prev===undefined?delete process.env.RONDO_TFS_REVERSE_QUERY_VERIFIED:
    process.env.RONDO_TFS_REVERSE_QUERY_VERIFIED=prev);
  delete process.env.RONDO_TFS_REVERSE_QUERY_VERIFIED;
  await assert.rejects(commitTaskOwners(clientWith([]),repo,sha),/尚未通过/);
});
test("反向查询识别其他 Issue 的 Task，缺 Work Items 或直链不符则 UNKNOWN",async t=>{
  const prev=process.env.RONDO_TFS_REVERSE_QUERY_VERIFIED;
  t.after(()=>prev===undefined?delete process.env.RONDO_TFS_REVERSE_QUERY_VERIFIED:
    process.env.RONDO_TFS_REVERSE_QUERY_VERIFIED=prev);
  process.env.RONDO_TFS_REVERSE_QUERY_VERIFIED="1";
  assert.deepEqual(await commitTaskOwners(clientWith([102,101]),repo,sha),[101,102]);
  assert.deepEqual(await commitTaskOwners(clientWith([]),repo,sha),[]);
  await assert.rejects(commitTaskOwners(clientWith([101],"omitted"),repo,sha),/不完整/);
  await assert.rejects(commitTaskOwners(clientWith([101],"mismatch"),repo,sha),/无对应直接 ArtifactLink/);
  assert.equal(hasExactArtifactLink([commitArtifactUrl({...repo,sha})],{...repo,sha}),true);
  assert.equal(hasExactArtifactLink([commitArtifactUrl({...repo,sha})],{...repo,repoId:"33333333-3333-3333-3333-333333333333",sha}),false);
});
test("PR Commit 候选必须有真实 changes 且包含候选 SHA",async()=>{
  const api:any={config:{serverUrl:"http://tfs.example/tfs/C"},rawRequest:async(input:string)=>{
    const url=new URL(input);
    if (url.pathname.endsWith("/commits")) return {statusCode:200,body:JSON.stringify({value:[{commitId:sha}]})};
    if (url.pathname.endsWith("/changes")) return {statusCode:200,body:JSON.stringify({changes:[{item:{path:"/api.ts"}}]})};
    throw new Error("Unexpected "+url);
  }};
  assert.deepEqual(await prChangedCommits(api,repo,42,sha),[{sha,changed_paths:["/api.ts"],message:""}]);
  await assert.rejects(prChangedCommits(api,repo,42,"b".repeat(40)),/Candidate/);
});

test("PR 变更仅提供候选事实，不把文档提交自动认定为业务 Commit", async () => {
  const docsSha = "b".repeat(40);
  const api: any = { config: { serverUrl: "http://tfs.example/tfs/C" },
    rawRequest: async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/commits")) return {statusCode:200,body:JSON.stringify({value:[
        {commitId:sha,comment:"Implement API\nbody"},
        {commitId:docsSha,comment:"Update docs"},
      ]})};
      if (url.pathname.endsWith("/changes")) {
        const path = url.pathname.includes(docsSha) ? "/README.md" : "/src/api.ts";
        return {statusCode:200,body:JSON.stringify({changes:[{item:{path}}]})};
      }
      throw new Error("Unexpected "+url);
    },
  };
  assert.deepEqual(await prChangedCommits(api,repo,42,sha),[
    {sha,changed_paths:["/src/api.ts"],message:"Implement API"},
    {sha:docsSha,changed_paths:["/README.md"],message:"Update docs"},
  ]);
});
