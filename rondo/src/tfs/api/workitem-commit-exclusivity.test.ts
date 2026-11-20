import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TfsClient, FailError, UnknownError } from "../client.js";
import { commitArtifactUrl } from "./commit-identity.js";
import { cmdWorkItemLinkCommits } from "./workitem.js";

const projectId = "11111111-1111-1111-1111-111111111111";
const repoId = "22222222-2222-2222-2222-222222222222";
const sha = "a".repeat(40);
const repo = { name:"frame", id:repoId, project:{name:"Hospital",id:projectId} };
const url = commitArtifactUrl({projectId,repoId,sha});

function fixture(t: any, initialOwners: number[], reverseStale = false) {
  const before = {
    TFS_PAT: process.env.TFS_PAT,
    TFS_PROJECT: process.env.TFS_PROJECT,
    TFS_SERVER_URL: process.env.TFS_SERVER_URL,
    RONDO_TFS_REVERSE_QUERY_VERIFIED: process.env.RONDO_TFS_REVERSE_QUERY_VERIFIED,
    RONDO_TFS_COLLECTION_LOCK_DIR: process.env.RONDO_TFS_COLLECTION_LOCK_DIR,
  };
  const root = mkdtempSync(join(tmpdir(),"rondo-task-link-"));
  Object.assign(process.env,{
    TFS_PAT: "fixture",
    TFS_PROJECT: "Hospital",
    TFS_SERVER_URL:"http://tfs.test/tfs/C",
    RONDO_TFS_REVERSE_QUERY_VERIFIED:"1",
    RONDO_TFS_COLLECTION_LOCK_DIR:root,
  });
  const state = { owners:[...initialOwners], taskLinks: [] as string[], patches:0 };
  t.mock.method(TfsClient.prototype, "getGitApi", async () => ({
    getRepository: async () => repo,
  }));
  t.mock.method(TfsClient.prototype, "rawRequest", async (raw: string, method: string, body: string|null = null) => {
    const parsed = new URL(raw), path = parsed.pathname;
    if (path.endsWith("/commits") && method === "GET") {
      return {statusCode:200,body:JSON.stringify({value:[{commitId:sha,
        workItems:state.owners.map(id => ({id}))}]})};
    }
    if (path.endsWith("/_apis/wit/workitems") && method === "GET") {
      const ids = parsed.searchParams.get("ids")?.split(",").map(Number) ?? [];
      return {statusCode:200,body:JSON.stringify({value:ids.map(id => ({id,
        fields:{"System.WorkItemType":"任务"},
        relations:id === 102 ? state.taskLinks.map(x => ({rel:"ArtifactLink",url:x}))
          : [{rel:"ArtifactLink",url}],
      }))})};
    }
    if (path.endsWith("/_apis/wit/workitems/102") && method === "GET") {
      return {statusCode:200,body:JSON.stringify({id:102,fields:{"System.WorkItemType":"任务"},
        relations:state.taskLinks.map(x => ({rel:"ArtifactLink",url:x}))})};
    }
    if (path.endsWith("/_apis/wit/workitems/102") && method === "PATCH") {
      state.patches++;
      const patch = JSON.parse(body!);
      state.taskLinks.push(patch[0].value.url);
      if (!reverseStale) state.owners = [102];
      return {statusCode:200,body:JSON.stringify({id:102})};
    }
    throw new Error("unexpected fake HTTP: "+method+" "+raw);
  });
  t.after(() => {
    for (const [key,value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root,{recursive:true,force:true});
  });
  return state;
}

test("直接 workitem link-commits 必须拒绝其他 Issue Task 已归属的业务 Commit", async t => {
  const state = fixture(t,[101]);
  await assert.rejects(cmdWorkItemLinkCommits({id:102,repo:"frame",project:"Hospital",shas:[sha]}),
    (err: unknown) => err instanceof FailError && /其他 TFS Task/.test(err.message));
  assert.equal(state.patches,0);
});

test("直接 CLI 允许空闲 Commit 链接一次并回读双向唯一关系", async t => {
  const state = fixture(t,[]);
  const result = await cmdWorkItemLinkCommits({id:102,repo:"frame",project:"Hospital",shas:[sha]});
  assert.deepEqual((result as any).linked,[sha]);
  assert.deepEqual(state.owners,[102]);
  assert.equal(state.patches,1);
  const second = await cmdWorkItemLinkCommits({id:102,repo:"frame",project:"Hospital",shas:[sha]});
  assert.deepEqual((second as any).skipped,[sha]);
  assert.equal(state.patches,1);
});

test("写入已发生但反向归属不可确认必须 UNKNOWN；不可重复 PATCH", async t => {
  const state = fixture(t,[],true);
  await assert.rejects(cmdWorkItemLinkCommits({id:102,repo:"frame",project:"Hospital",shas:[sha]}),UnknownError);
  assert.equal(state.patches,1);
  await assert.rejects(cmdWorkItemLinkCommits({id:102,repo:"frame",project:"Hospital",shas:[sha]}),UnknownError);
  assert.equal(state.patches,1);
});
