import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classifyProviderStatus, collectStatusPages, processIssue } from "../dist/commands/pr/reconcile-status.js";
import { parseTfsPrWebUrl, normalizeTfsPrWebUrl } from "../dist/tfs/api/pr.js";
import { recoverPreparedPrs } from "../dist/commands/pr/materialize.js";

const COLLECTION = "http://tfs.example.test/tfs/Collection";

test("PR provider status classification only accepts known statuses", () => {
  assert.equal(classifyProviderStatus("active"), "active");
  assert.equal(classifyProviderStatus("completed"), "completed");
  assert.equal(classifyProviderStatus("abandoned"), "abandoned");
  for (const value of ["draft", "unknown", "COMPLETED", "", null, undefined, 0]) {
    assert.equal(classifyProviderStatus(value), "unknown");
  }
});

test("array-form issue list continues past a full 100-item page", () => {
  const firstPage = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }));
  const offsets = [];
  const results = collectStatusPages((offset, limit) => {
    offsets.push([offset, limit]);
    return offset === 0 ? firstPage : [{ id: "last" }];
  });
  assert.equal(results.length, 101);
  assert.deepEqual(offsets, [[0, 100], [100, 100]]);
});

test("object-form issue list honors has_more and stops on the last page", () => {
  const offsets = [];
  const results = collectStatusPages((offset) => {
    offsets.push(offset);
    return offset === 0
      ? { issues: [{ id: "a" }], has_more: true }
      : { issues: [{ id: "b" }], has_more: false };
  });
  assert.deepEqual(results.map((x) => x.id), ["a", "b"]);
  assert.deepEqual(offsets, [0, 1]);
});

function fixture(status, metadata = {}) {
  const calls = [];
  const multica = {
    setMetadata: (...args) => calls.push(["metadata", ...args]),
    setStatus: (...args) => calls.push(["status", ...args]),
  };
  const pr = {
    repo_key: "repo",
    pr_id: 42,
    pr_url: COLLECTION + "/Project/_git/remote/pullrequest/42",
    source_branch: "feature/a",
    target_branch: "dev",
  };
  const issue = {
    id: "issue-id",
    identifier: "DF-1",
    status,
    assignee_id: "engineer",
    metadata: { current_pr: JSON.stringify([pr]), pr_prep: JSON.stringify([{repo_key:pr.repo_key}]), ...metadata },
  };
  return { calls, multica, pr, issue };
}

test("done without pending is skipped without PR lookup or writes", async () => {
  const f = fixture("done");
  const action = await processIssue(f.multica, f.issue, { attempts: 0, successes: 0 }, () => {
    throw new Error("unexpected PR lookup");
  });
  assert.equal(action, null);
  assert.deepEqual(f.calls, []);
});

test("done with pending only requests finalize recovery and never reopens issue", async () => {
  const f = fixture("done", { "finalize.pending": "{}" });
  const action = await processIssue(f.multica, f.issue, { attempts: 0, successes: 0 }, () => {
    throw new Error("unexpected PR lookup");
  });
  assert.equal(action.action, "resume_finalize");
  assert.deepEqual(f.calls, []);
});

test("unknown PR status does not write completion facts", async () => {
  const f = fixture("in_review");
  const action = await processIssue(f.multica, f.issue, { attempts: 0, successes: 0 }, () => ({
    status: "ok",
    pr: { id: 42, status: "draft", sourceBranch: "feature/a", targetBranch: "dev" },
  }), COLLECTION);
  assert.equal(action.action, "unknown");
  assert.deepEqual(f.calls, []);
});

test("completed PR marks pending, and active PR is a no-op", async () => {
  const f = fixture("in_review");
  const lookup = (status) => () => ({
    status: "ok",
    pr: { id: 42, status, sourceBranch: "feature/a", targetBranch: "dev" },
  });
  const complete = await processIssue(f.multica, f.issue, { attempts: 0, successes: 0 }, lookup("completed"), COLLECTION);
  assert.equal(complete.action, "finalize");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][1], "issue-id");
  assert.equal(f.calls[0][2], "finalize.pending");
  assert.deepEqual(JSON.parse(f.calls[0][3]).event_keys, ["DF-1#repo#42#completed"]);

  f.calls.length = 0;
  const active = await processIssue(f.multica, f.issue, { attempts: 0, successes: 0 }, lookup("active"), COLLECTION);
  assert.equal(active.action, "noop");
  assert.deepEqual(f.calls, []);
});

test("new abandoned PR blocks without reassigning Issue or requiring delivery_squad_id", async () => {
  for (const owner of ["delivery-squad", "bug-fix-agent"]) {
    const f = fixture("in_review");
    f.issue.assignee_id = owner;
    const action = await processIssue(f.multica, f.issue, { attempts: 0, successes: 0 }, () => ({
      status: "ok",
      pr: { id: 42, status: "abandoned", sourceBranch: "feature/a", targetBranch: "dev" },
    }), COLLECTION);
    assert.equal(action.action, "stopped_abandoned");
    assert.deepEqual(f.calls.map((call) => call[0]), ["metadata", "status"]);
    assert.equal(f.calls[0][2], "pr.abandoned");
    assert.deepEqual(f.calls[1], ["status", "issue-id", "blocked"]);
    assert.equal(f.issue.assignee_id, owner);
  }
});

test("repeated abandoned event preserves human-updated status and assignment", async () => {
  const event_key = "DF-1#repo#42#abandoned";
  const f = fixture("in_progress", {
    "pr.abandoned": JSON.stringify([{ repo_key: "repo", pr_id: 42, event_key, detected_at: "2026-11-03T00:00:00Z" }]),
  });
  const action = await processIssue(f.multica, f.issue, { attempts: 0, successes: 0 }, () => ({
    status: "ok",
    pr: { id: 42, status: "abandoned", sourceBranch: "feature/a", targetBranch: "dev" },
  }), COLLECTION);
  assert.equal(action.action, "stopped_abandoned");
  assert.match(action.detail, /already_stopped/);
  assert.deepEqual(f.calls, []);
});

test("recovery scan and one-issue mode cannot be combined", () => {
  const proc = spawnSync(process.execPath, [
    fileURLToPath(new URL("../dist/index.js", import.meta.url)),
    "pr", "reconcile-status",
    "--issue", "DF-1",
    "--recover-done",
  ], { encoding: "utf8" });
  assert.equal(proc.status, 64);
  assert.match(proc.stderr, /不可同时使用/);
});


test("retired --config returns usage error", () => {
  const proc = spawnSync(process.execPath, [
    fileURLToPath(new URL("../dist/index.js", import.meta.url)),
    "pr", "reconcile-status", "--config", "not-read.json",
  ], { encoding: "utf8" });
  assert.equal(proc.status, 64);
  assert.match(proc.stderr, /用法/);
});

test("PR URL parser validates TFS collection, identity and encoded names", () => {
  const url = COLLECTION + "/%E5%85%83%E6%95%B0%E6%8D%AE%20%25/_git/repo%20web/pullrequest/42?_a=overview";
  assert.deepEqual(parseTfsPrWebUrl(url, COLLECTION), {
    project: "元数据 %", repository: "repo web", prId: 42,
  });
  for (const invalid of [
    "http://evil.example/tfs/Collection/Project/_git/repo/pullrequest/42",
    "http://tfs.example.test/tfs/Other/Project/_git/repo/pullrequest/42",
    COLLECTION + "-evil/Project/_git/repo/pullrequest/42",
    COLLECTION + "/Project/_git/repo/pullrequest/0",
    COLLECTION + "/Project/_git/repo/pullrequest/abc",
    COLLECTION + "/Project/_git/a%2Fb/pullrequest/42",
  ]) assert.equal(parseTfsPrWebUrl(invalid, COLLECTION), null);
  assert.equal(normalizeTfsPrWebUrl("http://evil.example/pr/42", COLLECTION, "元数据 %", "repo web", 42),
    COLLECTION + "/%E5%85%83%E6%95%B0%E6%8D%AE%20%25/_git/repo%20web/pullrequest/42");
});

test("normalization rejects a parseable PR URL that conflicts with the verified identity", () => {
  for (const candidate of [
    COLLECTION + "/Project/_git/other/pullrequest/42",
    COLLECTION + "/Other/_git/remote/pullrequest/42",
    COLLECTION + "/Project/_git/remote/pullrequest/43",
  ]) {
    assert.throws(
      () => normalizeTfsPrWebUrl(candidate, COLLECTION, "Project", "remote", 42),
      /PR URL 与已核实的 Project、Repository 或 PR ID 不一致/,
    );
  }
  assert.equal(
    normalizeTfsPrWebUrl("https://unsupported.example/pr/42", COLLECTION, "Project", "remote", 42),
    COLLECTION + "/Project/_git/remote/pullrequest/42",
  );
});

test("mismatched PR URL or provider identity cannot write finalize.pending", async () => {
  const f = fixture("in_review");
  const pr = JSON.parse(f.issue.metadata.current_pr)[0];
  pr.pr_url = COLLECTION + "/Project/_git/remote/pullrequest/43";
  f.issue.metadata.current_pr = JSON.stringify([pr]);
  const badUrl = await processIssue(f.multica, f.issue, { attempts: 0, successes: 0 }, () => {
    throw new Error("must not query invalid URL");
  }, COLLECTION);
  assert.equal(badUrl.action, "unknown");
  assert.deepEqual(f.calls, []);

  pr.pr_url = COLLECTION + "/Project/_git/remote/pullrequest/42";
  f.issue.metadata.current_pr = JSON.stringify([pr]);
  const badIdentity = await processIssue(f.multica, f.issue, { attempts: 0, successes: 0 }, () => ({
    status: "ok", pr: { id: 99, status: "completed", sourceBranch: "feature/a", targetBranch: "dev" },
  }), COLLECTION);
  assert.equal(badIdentity.action, "unknown");
  assert.deepEqual(f.calls, []);
});

test("部分 PR 登记不能触发 Closeout；研发状态即使全部完成也等待 Materialize", async () => {
  for (const status of ["in_review","blocked"]) {
    const f=fixture(status, {pr_prep:JSON.stringify([{repo_key:"repo"},{repo_key:"web"}])});
    const action=await processIssue(f.multica,f.issue,{attempts:0,successes:0},()=>({
      status:"ok",pr:{id:42,status:"completed",sourceBranch:"feature/a",targetBranch:"dev"}
    }),COLLECTION);
    assert.equal(action.action,"unknown");
    assert.match(action.detail,/仓库集合不完整/);
    assert.deepEqual(f.calls,[]);
  }
  const f=fixture("in_progress");
  const action=await processIssue(f.multica,f.issue,{attempts:0,successes:0},()=>({
    status:"ok",pr:{id:42,status:"completed",sourceBranch:"feature/a",targetBranch:"dev"}
  }),COLLECTION);
  assert.equal(action.action,"noop");
  assert.deepEqual(f.calls,[]);
});

test("partial registration still detects abandoned PRs before Closeout completeness check", async () => {
  const f=fixture("in_review",{pr_prep:JSON.stringify([{repo_key:"repo"},{repo_key:"web"}])});
  const action=await processIssue(f.multica,f.issue,{attempts:0,successes:0},()=>({
    status:"ok",pr:{id:42,status:"abandoned",sourceBranch:"feature/a",targetBranch:"dev"}
  }),COLLECTION);
  assert.equal(action.action,"stopped_abandoned");
  assert.deepEqual(f.calls.map(c=>c[0]),["metadata","status"]);
  assert.equal(f.calls[0][2],"pr.abandoned");
  assert.deepEqual(f.calls[1],["status","issue-id","blocked"]);
});

function recoveryFixture(status="in_review", registered=[]) {
  const sha="a".repeat(40), keys=["backend","frontend"];
  const prepared=keys.map(key=>({repo_key:key,repo_url:COLLECTION+"/Project/_git/"+key,
    source_branch:"feature/42",target_branch:"dev",candidate_commit:sha}));
  const issue={id:"issue-id",identifier:"DF-42",status,assignee_id:"engineer",metadata:{
    "tfs.id":"42","tfs.type":"需求",pr_prep:JSON.stringify(prepared),
    ...(registered.length?{current_pr:JSON.stringify(registered)}:{})
  }};
  const calls=[], tfsCalls=[];
  const repoId=key=>key==="backend"?"22222222-2222-2222-2222-222222222222":"33333333-3333-3333-3333-333333333333";
  const projectId="11111111-1111-1111-1111-111111111111";
  const id=key=>key==="backend"?17:18;
  const pr=key=>({repo_key:key,pr_id:id(key),pr_url:COLLECTION+"/Project/_git/"+key+"/pullrequest/"+id(key),source_branch:"feature/42",target_branch:"dev"});
  const live={backend:"completed",frontend:"completed"};
  let missingLink=false, wrongSha=false, drift=false;
  const multica={getIssue:()=>structuredClone(issue),setMetadata(_id,key,value){calls.push(key);issue.metadata[key]=value;},
    setStatus(_id,status){calls.push("status");issue.status=status;}};
  const api={config:{serverUrl:COLLECTION},rawRequest:async(_url,method)=>{
    assert.equal(method,"GET");
    return {statusCode:200,body:JSON.stringify({id:42,rev:1,relations:missingLink?[]:keys.map(key=>({
      rel:"ArtifactLink",url:"vstfs:///Git/PullRequestId/"+projectId+"%2F"+repoId(key)+"%2F"+id(key)
    }))})};
  }};
  const resolveRepo=async(_api,project,key)=>({project,repo:key,projectId,repoId:repoId(key)});
  const tfs={run:async args=>{
    tfsCalls.push(args.slice(0,2).join(" "));
    const key=args.includes(repoId("backend"))?"backend":"frontend";
    if(args[1]==="list") return args.includes(live[key])?[{id:id(key),targetBranch:"dev"}]:[];
    if(args[1]==="get" && args[0]==="pr") {
      if(drift) issue.metadata.pr_prep="changed";
      return {id:id(key),status:live[key],sourceBranch:"feature/42",targetBranch:"dev",sourceCommitId:wrongSha?"b".repeat(40):sha};
    }
    if(args[0]==="branch" && live[key]==="active") return {found:true,branch:{commit:sha}};
    throw Error("Unexpected external operation: "+args.join(" "));
  }};
  const lookup=async(_project,key,prId)=>({status:"ok",pr:{id:prId,status:live[key],sourceBranch:"feature/42",targetBranch:"dev"}});
  const recover=candidate=>recoverPreparedPrs(multica,candidate,api,tfs,resolveRepo);
  const run=()=>processIssue(multica,structuredClone(issue),{attempts:0,successes:0},lookup,COLLECTION,recover);
  return {issue,calls,tfsCalls,live,pr,run,missingLink:()=>{missingLink=true;},wrongSha:()=>{wrongSha=true;},drift:()=>{drift=true;}};
}

test("missing registrations recover existing completed PRs and trigger closeout in same scan",async()=>{
  const f=recoveryFixture();
  assert.equal((await f.run()).action,"finalize");
  assert.deepEqual(JSON.parse(f.issue.metadata.current_pr),[f.pr("backend"),f.pr("frontend")]);
  assert.deepEqual(f.calls,["current_pr","current_pr","finalize.pending"]);
  assert.ok(f.tfsCalls.every(c=>c==="pr list"||c==="pr get"));
  f.calls.length=0;f.tfsCalls.length=0;
  assert.equal((await f.run()).action,"resume_finalize");
  assert.deepEqual(f.calls,[]);
  assert.deepEqual(f.tfsCalls,[]);
});

test("partial recovery retains progress, never creates PR and preserves abandoned priority",async()=>{
  const f=recoveryFixture();
  f.live.frontend="absent";
  assert.equal((await f.run()).action,"unknown");
  assert.deepEqual(JSON.parse(f.issue.metadata.current_pr),[f.pr("backend")]);
  assert.deepEqual(f.calls,["current_pr"]);
  f.live.backend="abandoned";
  assert.equal((await f.run()).action,"stopped_abandoned");
  assert.equal(f.issue.status,"blocked");
  assert.equal(f.issue.metadata["finalize.pending"],undefined);
  assert.ok(f.tfsCalls.every(c=>c==="pr list"||c==="pr get"));
});

test("blocked can restore known PRs but never starts closeout; active recovered PR is noop",async()=>{
  const blocked=recoveryFixture("blocked");
  assert.equal((await blocked.run()).action,"noop");
  assert.deepEqual(blocked.calls,["current_pr","current_pr"]);
  assert.equal(blocked.issue.status,"blocked");
  const active=recoveryFixture();
  active.live.frontend="active";
  assert.equal((await active.run()).action,"noop");
  assert.deepEqual(active.calls,["current_pr","current_pr"]);
});

test("recovery refuses mismatched Candidate and missing Work Item link, does not write TFS",async()=>{
  for(const fail of ["missingLink","wrongSha"]){
    const f=recoveryFixture();f[fail]();
    assert.equal((await f.run()).action,"unknown");
    assert.deepEqual(f.calls,[]);
  }
  const drift=recoveryFixture();drift.drift();
  await assert.rejects(drift.run(),/事实变化/);
  assert.deepEqual(drift.calls,[]);
});

test("in_review missing current_pr is visible; normal blocked without delivery facts is skipped",async()=>{
  const a=fixture("in_review",{current_pr:undefined,pr_prep:undefined});
  const b=fixture("blocked",{current_pr:"[]",pr_prep:"[]"});
  const lookup=()=>{throw Error("unexpected lookup")};
  assert.equal((await processIssue(a.multica,a.issue,{attempts:0,successes:0},lookup,COLLECTION)).action,"unknown");
  assert.equal(await processIssue(b.multica,b.issue,{attempts:0,successes:0},lookup,COLLECTION),null);
  assert.deepEqual([...a.calls,...b.calls],[]);
});
