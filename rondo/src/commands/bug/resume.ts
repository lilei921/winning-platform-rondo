import { candidateBranch } from "../pr/candidate-branch.js";
/**
 * Explicit Human-directed recovery from a rejected TFS Bug PR.
 * No autonomous reinterpretation of a Human comment; one Issue, no OpenSpec.
 * This command only acts when ALL current PRs were independently confirmed
 * abandoned. Mixed active/completed PR sets require a separate Human plan.
 */
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { resolveMulticaRuntime } from "../../clients/runtime-context.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import { parseTfsPrWebUrl } from "../../tfs/api/pr.js";
import { assertTfsRepository } from "../../clients/authenticated-git.js";
import { assertBugReadyForPr } from "./scope.js";
import { validateBugEvidence } from "./evidence.js";
import { readPrRecords, registeredPrs, withoutPrIdentity, type PrIdentity } from "../pr/facts.js";
import { MulticaClient } from "../../clients/multica.js";
import { TfsClient } from "../../clients/tfs.js";
import { isDirectBugDelivery } from "./finalize-facts.js";

interface Abandoned { repo_key: string; pr_id: number; event_key: string; }
interface Decision { comment_id:string; next:"REWORK"|"RECREATE_PR"; abandoned_prs:string[]; original_prs:PrIdentity[]; decided_at:string; }
const USAGE = "用法: rondo bug resume --issue <KEY> " +
  "--human-comment-id <id> --next REWORK|RECREATE_PR\n";

function readList<T>(raw:string|undefined,key:string):T[] {
  if (!raw) throw new FailError("缺少 "+key);
  let value:unknown;try{value=JSON.parse(raw)}catch{throw new UnknownError(key+" 无法解析")}
  if (!Array.isArray(value))throw new FailError(key+" 必须为数组");
  return value as T[];
}
function arg(argv:string[],flag:string):string {
  const i=argv.indexOf(flag);
  return i>=0 && i+1<argv.length && !argv[i+1].startsWith("--")?argv[i+1]:"";
}
export function assertAbandonedBugSet(prs:PrIdentity[],abandoned:Abandoned[]):string[] {
  if(prs.length===0 || abandoned.length===0)throw new FailError("缺少当前 PR 或 Abandoned 事实");
  if(new Set(prs.map(p=>p.repo_key)).size!==prs.length)throw new FailError("pr 存在重复 repo_key");
  const events:string[]=[];
  for(const p of prs){
    const matching=abandoned.filter(a=>a.repo_key===p.repo_key && a.pr_id===p.pr_id);
    if(matching.length!==1 || !matching[0].event_key) {
      throw new FailError("存在尚未确认 abandoned 的 PR: "+p.repo_key+"#"+p.pr_id);
    }
    events.push(matching[0].event_key);
  }
  return events.sort();
}
async function main(argv:string[]):Promise<number>{
  if(argv.includes("--help")||argv.includes("-h")){process.stdout.write(USAGE);return 0;}
  const issueRef=arg(argv,"--issue");
  const commentId=arg(argv,"--human-comment-id"),next=arg(argv,"--next");
  if(argv.some((v,j)=>j%2===0&&!["--issue","--human-comment-id","--next"].includes(v))||!issueRef||!commentId||!["REWORK","RECREATE_PR"].includes(next)){
    process.stderr.write(USAGE);return 64;
  }
  try{
    const client=new MulticaClient(resolveMulticaRuntime());
    const issue=client.getIssue(issueRef),md=issue.metadata??{};
    const issueKey=issue.identifier??issue.id;
    const comment=client.listComments(issueKey).find(c=>c.id===commentId);
    if(!comment || !comment.content?.trim() || comment.author_type!=="member" || !comment.author_id) throw new FailError("Human 决定须来自当前 Issue 的真实成员评论");
    const rawDecision=md["bug.resume"];
    let decision:Decision|undefined;
    if(rawDecision) {
      try{decision=JSON.parse(rawDecision) as Decision;}
      catch{throw new UnknownError("bug.resume Decision 无法解析");}
      if(!decision || typeof decision.comment_id!=="string" || !Array.isArray(decision.abandoned_prs) || !Array.isArray(decision.original_prs)) {
        throw new UnknownError("bug.resume Decision 不完整");
      }
      if(decision.comment_id===commentId && decision.next!==next){
        throw new FailError("同一 Human Comment 不允许更改已记录的决定");
      }
      if(decision.comment_id===commentId && issue.status==="in_progress"){
        const current=registeredPrs(md.pr);
        if(current.length!==0 || (next==="REWORK" && readPrRecords(md.pr).length!==0))throw new UnknownError("当前恢复事实与已记录 Decision 不一致");
        if(next==="RECREATE_PR") assertBugReadyForPr(md);
        process.stdout.write(JSON.stringify({result:"NOOP",issue:issueKey,next,comment_id:commentId})+"\n");
        return 0;
      }
    }
    if(!isDirectBugDelivery(md) || issue.status!=="blocked"){
      throw new FailError("仅允许 blocked 且存在当前独立 Bug Delivery 事实的 Issue 恢复");
    }
    if(md["finalize.pending"] || md["delivery.tfs_written"]==="true"){
      throw new FailError("已有收口或 TFS 写回事实，禁止 Bug PR 恢复覆盖");
    }
    const observedPrs=registeredPrs(md.pr).map(({repo_key,pr_id,pr_url,source_branch,target_branch})=>({repo_key,pr_id,pr_url,source_branch,target_branch}));
    // A previous interrupted run may already have cleared pr. The
    // persist-before-act Decision retains its original immutable PR snapshot.
    const prs=observedPrs.length>0?observedPrs:
      decision?.comment_id===commentId?decision.original_prs:[];
    const abandoned=readList<Abandoned>(md["pr.abandoned"],"pr.abandoned");
    const eventKeys=assertAbandonedBugSet(prs,abandoned);
    if(decision && decision.comment_id===commentId) {
      if(JSON.stringify(decision.abandoned_prs)!==JSON.stringify(eventKeys)){
        throw new FailError("PR Abandoned 事件在 Human 决策后改变，拒绝重放");
      }
    }
    const tfs=new TfsClient(), server=loadTfsConfig().serverUrl;
    const prepared=readPrRecords(md.pr);
    if(next==="RECREATE_PR") {
      assertBugReadyForPr(md);
      for(const d of prepared) {
        const errors=validateBugEvidence(d,{issue:issueKey,tfsId:Number(md["tfs.id"]),repoKey:d.repo_key,sha:d.candidate_commit}, false, true);
        if(errors.length) throw new FailError(errors.join("；"));
      }
    }
    if(decision?.comment_id===commentId && JSON.stringify(prs)!==JSON.stringify(decision.original_prs)) throw new FailError("原始 PR 事实与已登记 Decision 不一致");
    for(const p of prs){
      if (p.source_branch !== candidateBranch(md["tfs.id"])) throw new FailError("Bug 恢复 Candidate Branch 不一致");
      const location=parseTfsPrWebUrl(p.pr_url,server);
      if(!location || location.prId!==p.pr_id)throw new FailError("原 PR URL 身份不一致");
      const prep=prepared.find(x=>x.repo_key===p.repo_key);
      if(prep){const parts=assertTfsRepository(prep.repo_url,server).pathname.split("/").map(decodeURIComponent);
        if(parts.at(-3)?.toLowerCase()!==location.project.toLowerCase()||parts.at(-1)?.toLowerCase()!==location.repository.toLowerCase()||
          prep.source_branch!==p.source_branch||prep.target_branch!==p.target_branch)throw new FailError("原 PR 与准备事实不一致");}
      else if(next==="RECREATE_PR") throw new FailError("RECREATE_PR 缺少原 Candidate");
      const found=await tfs.run(["pr","get","--repo",location.repository,"--id",String(p.pr_id),
        "--project",location.project],"核实 abandoned PR") as {
        found?:boolean;id?:number;status?:string;sourceBranch?:string;targetBranch?:string;
      };
      if(found.found===false||found.id!==p.pr_id||found.status!=="abandoned" ||
         found.sourceBranch!==p.source_branch||found.targetBranch!==p.target_branch){
        throw new UnknownError("外部 PR 未确认为 abandoned 或身份冲突: "+p.repo_key+"#"+p.pr_id);
      }
      if(next==="RECREATE_PR" && prep) {
        const branch=await tfs.run(["branch","get","--repo",location.repository,"--project",location.project,"--name",p.source_branch],"核验原 Candidate") as {found?:boolean;branch?:{commit:string}};
        if(!branch.found||branch.branch?.commit!==prep.candidate_commit)throw new FailError("Candidate 已改变，需要重新授权 REWORK");
      }
    }
    const saved=decision&&decision.comment_id===commentId?rawDecision!:JSON.stringify({
      comment_id:commentId,next:next as "REWORK"|"RECREATE_PR",abandoned_prs:eventKeys,
      original_prs:prs,decided_at:new Date().toISOString(),
    } satisfies Decision);
    const latest=client.getIssue(issueRef);
    if(latest.status!==issue.status || ["tfs.id","tfs.type","pr","bug.required_repos","pr.abandoned","bug.resume","finalize.pending","delivery.tfs_written"].some(k=>latest.metadata?.[k]!==md[k])) throw new UnknownError("恢复期间 Issue 事实变化");
    // Persist decision first. Subsequent writes are idempotent and recoverable.
    if(md["bug.resume"]!==saved)client.setMetadata(issue.id,"bug.resume",saved);
    const nextPr = JSON.stringify(next==="REWORK" ? [] : prepared.map(withoutPrIdentity));
    if (md.pr!==nextPr) client.setMetadata(issue.id,"pr",nextPr);
    const read=client.getIssue(issueKey).metadata??{};
    if(read["bug.resume"]!==saved || read.pr!==nextPr){
      throw new UnknownError("Bug 恢复事实回读不一致，保持 blocked");
    }
    // This is a state transition, not a new Run trigger. The existing Human
    // mention or an explicit Bug Agent run decides what to do next.
    client.setStatusNoStart(issue.id,"in_progress");
    if(client.getIssue(issueKey).status!=="in_progress")throw new UnknownError("Bug 恢复状态回读不一致");
    process.stdout.write(JSON.stringify({
      result:"PASS",issue:issueKey,status:"in_progress",next,
      directive:next==="REWORK"?"reanalyse_and_fix":"rematerialize_pr",
      comment_id:commentId,abandoned_pr_events:eventKeys,
    },null,2)+"\n");
    return 0;
  }catch(err){
    if(err instanceof FailError||err instanceof UnknownError){
      const result=err instanceof FailError?"FAIL":"UNKNOWN";
      process.stdout.write(JSON.stringify({result,reason:err.message},null,2)+"\n");
      return result==="FAIL"?2:3;
    }
    throw err;
  }
}
export function registerBugResume(group:Command):void {
  group.command("resume")
    .description("在明确 Human 评论后受控恢复 abandoned Bug PR")
    .helpOption(false).allowUnknownOption(true).allowExcessArguments(true)
    .action(async (...cbArgs:unknown[])=>{
      markLeafExecuted();
      const cmd=cbArgs[cbArgs.length-1] as Command;
      throw new ExitSignal(await main(cmd.args));
    });
}
