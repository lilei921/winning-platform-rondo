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
import { loadConfig, type BaseRegistryConfig } from "../../clients/config.js";
import { MulticaClient } from "../../clients/multica.js";
import { TfsClient } from "../../clients/tfs.js";
import { isDirectBugDelivery, type BugCurrentPr } from "./finalize-facts.js";

interface RepoEntry { tfs_repo?: string; tfs_project?: string; }
interface RegistryConfig extends BaseRegistryConfig { registry: Record<string,RepoEntry>; }
interface Abandoned { repo_key: string; pr_id: number; event_key: string; }
interface Decision { comment_id:string; next:"REWORK"|"RECREATE_PR"; abandoned_prs:string[]; original_prs:BugCurrentPr[]; decided_at:string; }
const USAGE = "用法: rondo bug resume --config <repo-registry.json> --issue <KEY> " +
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
export function assertAbandonedBugSet(prs:BugCurrentPr[],abandoned:Abandoned[]):string[] {
  if(prs.length===0 || abandoned.length===0)throw new FailError("缺少当前 PR 或 Abandoned 事实");
  if(new Set(prs.map(p=>p.repo_key)).size!==prs.length)throw new FailError("current_pr 存在重复 repo_key");
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
  const config=arg(argv,"--config"),issueRef=arg(argv,"--issue");
  const commentId=arg(argv,"--human-comment-id"),next=arg(argv,"--next");
  if(!config||!issueRef||!commentId||!["REWORK","RECREATE_PR"].includes(next)){
    process.stderr.write(USAGE);return 64;
  }
  try{
    const cfg=loadConfig<RegistryConfig>(config);
    const client=new MulticaClient(cfg.runtime);
    const issue=client.getIssue(issueRef),md=issue.metadata??{};
    const issueKey=issue.identifier??issue.id;
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
        const current=readList<BugCurrentPr>(md.current_pr??"[]","current_pr");
        if(current.length!==0)throw new UnknownError("旧 PR 尚未清除，不能将历史 Decision 视为完成");
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
    const comments=client.listComments(issueKey);
    const comment=comments.find(c=>c.id===commentId);
    if(!comment || !comment.content?.trim())throw new FailError("真实 Human 决定评论不存在或为空");
    const observedPrs=readList<BugCurrentPr>(md.current_pr??"[]","current_pr");
    // A previous interrupted run may already have cleared current_pr. The
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
    const tfs=new TfsClient();
    for(const p of prs){
      if (p.source_branch !== candidateBranch(md["tfs.id"])) throw new FailError("Bug 恢复 Candidate Branch 不一致");
      const repo=cfg.registry[p.repo_key];
      if(!repo?.tfs_repo||!repo.tfs_project)throw new FailError("Repository 的 TFS PR 配置缺失: "+p.repo_key);
      const found=await tfs.run(["pr","get","--repo",repo.tfs_repo,"--id",String(p.pr_id),
        "--project",repo.tfs_project],"核实 abandoned PR") as {
        found?:boolean;status?:string;sourceBranch?:string;targetBranch?:string;
      };
      if(found.found===false||found.status!=="abandoned" ||
         found.sourceBranch!==p.source_branch||found.targetBranch!==p.target_branch){
        throw new UnknownError("外部 PR 未确认为 abandoned 或身份冲突: "+p.repo_key+"#"+p.pr_id);
      }
    }
    const saved=decision&&decision.comment_id===commentId?rawDecision!:JSON.stringify({
      comment_id:commentId,next:next as "REWORK"|"RECREATE_PR",abandoned_prs:eventKeys,
      original_prs:prs,decided_at:new Date().toISOString(),
    } satisfies Decision);
    // Persist decision first. Subsequent writes are idempotent and recoverable.
    if(md["bug.resume"]!==saved)client.setMetadata(issue.id,"bug.resume",saved);
    // Remove only the current PR materialization, never the historical abandoned events.
    client.setMetadata(issue.id,"current_pr","[]");
    if(next==="REWORK"){
      client.setMetadata(issue.id,"bug.delivery","[]");
      client.setMetadata(issue.id,"pr_prep","[]");
    }
    const read=client.getIssue(issueKey).metadata??{};
    if(read["bug.resume"]!==saved || read.current_pr!=="[]" ||
       (next==="REWORK"&&(read["bug.delivery"]!=="[]"||read.pr_prep!=="[]"))){
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
