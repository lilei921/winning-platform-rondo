import test from "node:test";
import assert from "node:assert/strict";
import { verifyCloseoutPrs } from "../dist/commands/delivery/closeout-pr.js";

const collection = "http://tfs.test/tfs/C";
const projectId = project => project === "P1" ? "11111111-1111-1111-1111-111111111111" : "22222222-2222-2222-2222-222222222222";
const repoId = "33333333-3333-3333-3333-333333333333";
const candidate = "a".repeat(40);
function facts(key, project = "P1", id = 1) {
  const repo_url = collection + "/" + project + "/_git/app";
  return {
    prep: { repo_key: key, repo_url, source_branch: "feature/42", target_branch: "main" },
    pr: { repo_key: key, pr_url: repo_url + "/pullrequest/" + id, pr_id: id, source_branch: "feature/42", target_branch: "main" }
  };
}
function fixture(...entries) {
  const calls = [];
  const api = {config:{serverUrl:collection}, async getGitApi() { return {async getRepository(name, project) {
    return {id: repoId, name, project:{id:projectId(project),name:project}};
  }}; }};
  const flow = {async run(args) {
    calls.push(args);
    return {id:Number(args[args.indexOf("--id")+1]), status:"completed",sourceBranch:"feature/42",targetBranch:"main",sourceCommitId:candidate};
  }};
  const md = {current_pr: JSON.stringify(entries.map(e=>e.pr)),pr_prep:JSON.stringify(entries.map(e=>e.prep))};
  return {api,flow,md,calls};
}
test("approved scope permits subset and same repo name in different Projects", async () => {
  const f=fixture(facts("a","P1",1),facts("b","P2",2));
  const result=await verifyCloseoutPrs(f.md,f.api,f.flow,["a","b","c"]);
  assert.equal(result.length,2);
  assert.notEqual(result[0].repo.projectId,result[1].repo.projectId);
  assert.deepEqual(f.calls.map(a=>a.slice(-4)),[["--repo",repoId,"--project","P1"],["--repo",repoId,"--project","P2"]]);
});
test("two repo keys cannot close the same real repository",async()=>{
  const f=fixture(facts("a"),facts("b","P1",2));
  await assert.rejects(verifyCloseoutPrs(f.md,f.api,f.flow,["a","b"]),/同一真实/);
});
test("repository, Collection, PR ID, branch and approved scope conflicts block",async()=>{
  for(const mutate of [
    e=>{e.pr.pr_url=e.pr.pr_url.replace("/C/","/Other/")},
    e=>{e.pr.pr_url=e.pr.pr_url.replace("/P1/","/P2/")},
    e=>{e.pr.pr_url=e.pr.pr_url.replace("/app/","/other/")},
    e=>{e.pr.pr_id=7},
    e=>{e.pr.target_branch="dev"},
    e=>{delete e.prep.repo_url}
  ]){
    const e=facts("a");mutate(e);const f=fixture(e);
    await assert.rejects(verifyCloseoutPrs(f.md,f.api,f.flow,["a"]));
    assert.equal(f.calls.length,0);
  }
  const f=fixture(facts("a"));
  await assert.rejects(verifyCloseoutPrs(f.md,f.api,f.flow,["b"]),/Scope/);
});
test("live PR must be completed with exact identity; Direct Bug retains merged candidate check",async()=>{
  const f=fixture(facts("a"));
  const original=f.flow.run;
  for(const overrides of [{id:99},{status:"active"},{status:"abandoned"},{sourceBranch:"wrong"},{targetBranch:"wrong"}]){
    f.flow.run=async args=>({...await original(args),...overrides});
    await assert.rejects(verifyCloseoutPrs(f.md,f.api,f.flow,["a"]));
  }
  f.flow.run=original;
  await verifyCloseoutPrs(f.md,f.api,f.flow,undefined,new Map([["a",candidate]]));
  await assert.rejects(verifyCloseoutPrs(f.md,f.api,f.flow,undefined,new Map([["a","b".repeat(40)]])));
});
