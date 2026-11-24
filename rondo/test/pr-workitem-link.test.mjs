import test from "node:test";
import assert from "node:assert/strict";
import { ensurePrWorkItemLink } from "../dist/tfs/api/pr-link.js";
const repo = { projectId: "11111111-1111-1111-1111-111111111111", repoId: "22222222-2222-2222-2222-222222222222" };
const artifact = `vstfs:///Git/PullRequestId/${repo.projectId}%2F${repo.repoId}%2F9`;
function fixture({ linked = false, lose = false, refuse = false } = {}) {
  let relations = linked ? [{rel:"ArtifactLink",url:artifact}] : [], writes = 0;
  const client = {config:{serverUrl:"http://tfs.test/C"}, async rawRequest(url, method, body) {
    if (method === "GET") return {statusCode:200, body:JSON.stringify({id:42,rev:3,relations})};
    writes++;
    const patch = JSON.parse(body); assert.equal(patch[0].value, 3);
    if (!refuse) relations.push(patch[1].value);
    if (lose) throw Error("response lost");
    return {statusCode:refuse?409:200,body:"{}"};
  }};
  return { client, writes:()=>writes };
}
test("existing link is read-only and never duplicated", async()=>{const f=fixture({linked:true}); await ensurePrWorkItemLink(f.client,repo,9,42,false); assert.equal(f.writes(),0);});
test("missing link is repaired, including lost PATCH response", async()=>{const f=fixture({lose:true}); await ensurePrWorkItemLink(f.client,repo,9,42,true); await ensurePrWorkItemLink(f.client,repo,9,42,true); assert.equal(f.writes(),1);});
test("read-only missing link and unconfirmed PATCH fail", async()=>{const f=fixture({refuse:true}); await assert.rejects(ensurePrWorkItemLink(f.client,repo,9,42,false),/缺少/); assert.equal(f.writes(),0); await assert.rejects(ensurePrWorkItemLink(f.client,repo,9,42,true),/未回读/);});
