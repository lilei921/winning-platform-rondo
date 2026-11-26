/** Apply a confirmed Human recovery decision to the current Requirement Issue. */
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { MulticaClient } from "../../clients/multica.js";
import { resolveMulticaRuntime } from "../../clients/runtime-context.js";
import { TfsClient } from "../../clients/tfs.js";
import { readPrRecords, isRegisteredPr, withoutPrIdentity, type RegisteredPr } from "../pr/facts.js";
import { parseTfsPrWebUrl } from "../../tfs/api/pr.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import { assertTfsRepository } from "../../clients/authenticated-git.js";
import { readApprovedVerifyDecision } from "./verify-decision.js";

const NEXTS = ["ANALYSIS", "ENGINEERING", "RECREATE_PR", "CANCEL_DELIVERY"] as const;
type Next = (typeof NEXTS)[number];
type Binding = Pick<RegisteredPr, "repo_key"|"pr_id"|"pr_url"|"candidate_commit">;
interface Decision {
  comment_id: string;
  next: Next;
  abandoned_prs: Binding[];
  completed_at?: string;
}
interface Abandoned { repo_key: string; pr_id: number; detected_at: string }
const binding = ({repo_key,pr_id,pr_url,candidate_commit}: RegisteredPr): Binding =>
  ({repo_key,pr_id,pr_url,candidate_commit});
const sameBinding = (a: Binding, b: Binding) => a.repo_key===b.repo_key && a.pr_id===b.pr_id &&
  a.pr_url===b.pr_url && a.candidate_commit===b.candidate_commit;
function list<T>(raw: string | undefined, field: string): T[] {
  let value: unknown;
  try { value = JSON.parse(raw ?? "[]"); }
  catch { throw new UnknownError(field + " 不是合法 JSON"); }
  if (!Array.isArray(value)) throw new UnknownError(field + " 不是数组");
  return value as T[];
}

export async function routeDecision(client: Pick<MulticaClient,"getIssue"|"listComments"|"setMetadata"|"setStatusNoStart">,
  issueRef: string, commentId: string, next: Next,
  verifyAbandoned: (pr: RegisteredPr, checkCandidate: boolean) => Promise<void>) {
  const issue=client.getIssue(issueRef), md=issue.metadata??{}, issueKey=issue.identifier??issue.id;
  if(md["tfs.type"]!=="需求") throw new FailError("仅支持 Requirement 人工恢复");
  const comment=client.listComments(issueKey).find(c=>c.id===commentId);
  if(!comment?.content?.trim() || comment.author_type!=="member" || !comment.author_id)
    throw new FailError("Human 决定须来自当前 Issue 的真实成员评论");
  const decisions=list<Decision>(md["dev.decision"],"dev.decision");
  const prior=decisions.find(d=>d.comment_id===commentId);
  const directive=next==="ANALYSIS"?"mention_analyst":next==="ENGINEERING"?"needs_engineering":next==="RECREATE_PR"?"rematerialize_pr":"hold_for_human";
  if(prior) {
    if(prior.next!==next) throw new FailError("同一 Human Comment 不允许更改已记录决定");
    if(prior.completed_at || decisions.at(-1)!==prior || issue.status!=="blocked")
      return {result:"NOOP",next,directive,comment_id:commentId};
  }
  if(issue.status!=="blocked" || md["finalize.pending"] || md["delivery.tfs_written"]==="true")
    throw new FailError("当前 Issue 状态不允许人工恢复");
  if(next==="CANCEL_DELIVERY") return {result:"PASS",next,directive};
  const records=readPrRecords(md.pr), abandoned=list<Abandoned>(md["pr.abandoned"],"pr.abandoned");
  const current=records.filter(isRegisteredPr).filter(p=>abandoned.some(a=>a.repo_key===p.repo_key && a.pr_id===p.pr_id));
  if(!current.length) throw new UnknownError("没有当前已登记且确认 abandoned 的 PR；若上次已解除绑定，需 Human 核对当前阻塞后恢复");
  const at=Date.parse(comment.created_at??"");
  if(!Number.isFinite(at) || current.some(p=>!abandoned.some(a=>a.repo_key===p.repo_key && a.pr_id===p.pr_id &&
      Number.isFinite(Date.parse(a.detected_at)) && Date.parse(a.detected_at)<=at)))
    throw new UnknownError("Human Comment 早于当前 PR Abandoned 事件或时间不可确认");
  const bindings=current.map(binding);
  if(prior && (!Array.isArray(prior.abandoned_prs) || prior.abandoned_prs.length!==bindings.length ||
      !bindings.every(b=>prior.abandoned_prs.some(a=>sameBinding(a,b)))))
    throw new UnknownError("当前 PR 已变化，禁止重放旧 Human 决定");
  if(next!=="ANALYSIS") {
    if(md["analysis.gate.result"]!=="PASS") throw new FailError("Analysis Gate 未通过");
    readApprovedVerifyDecision(md);
  }
  for(const pr of current) await verifyAbandoned(pr,next==="RECREATE_PR");
  const keys=["tfs.type","tfs.id","analysis.source","analysis.human_approval","analysis.gate.result","dev.publication",
    "pr","pr.abandoned","dev.decision","finalize.pending","delivery.tfs_written"];
  const fresh=client.getIssue(issueKey);
  if(fresh.status!==issue.status || fresh.assignee_id!==issue.assignee_id || keys.some(k=>fresh.metadata?.[k]!==md[k]))
    throw new UnknownError("人工恢复期间 Issue 事实变化");
  const selected=(p: typeof records[number])=>bindings.some(b=>b.repo_key===p.repo_key && b.pr_id===p.pr_id);
  // Keep the actual delivery set for ENGINEERING, but invalidate its quality facts.
  // ANALYSIS may change the approved repository scope; retain only unaffected records.
  const remaining=next==="ANALYSIS"?records.filter(p=>!selected(p)):records.map(p=>{
    if(!selected(p)) return p;
    const prepared=withoutPrIdentity(p);
    if(next==="ENGINEERING") {
      delete prepared.local_validation;
      delete prepared.code_review;
    }
    return prepared;
  });
  const decision=prior??{comment_id:commentId,next,abandoned_prs:bindings};
  const saved=prior?md["dev.decision"]:JSON.stringify([...decisions,decision]);
  if(!saved) throw new UnknownError("Human Decision 未确认");
  if(!prior) client.setMetadata(issue.id,"dev.decision",saved);
  const nextPr=JSON.stringify(remaining);
  client.setMetadata(issue.id,"pr",nextPr);
  const confirmed=client.getIssue(issueKey);
  if(confirmed.status!=="blocked" || confirmed.metadata?.pr!==nextPr ||
     confirmed.metadata?.["dev.decision"]!==saved ||
     keys.filter(k=>k!=="pr"&&k!=="dev.decision").some(k=>confirmed.metadata?.[k]!==md[k]))
    throw new UnknownError("恢复事实未回读确认，保持 blocked");
  client.setStatusNoStart(issue.id,"in_progress");
  if(client.getIssue(issueKey).status!=="in_progress") throw new UnknownError("恢复状态未回读确认");
  client.setMetadata(issue.id,"dev.decision",JSON.stringify([...decisions.filter(d=>d!==prior),
    {...decision,completed_at:new Date().toISOString()}]));
  return {result:"PASS",next,directive,issue:issueKey,status:"in_progress",repo_keys:bindings.map(b=>b.repo_key)};
}

async function verifyAbandoned(pr: RegisteredPr, checkCandidate: boolean): Promise<void> {
  const server=loadTfsConfig().serverUrl, tfs=new TfsClient();
  const location=parseTfsPrWebUrl(pr.pr_url,server);
  const parts=assertTfsRepository(pr.repo_url,server).pathname.split("/").map(decodeURIComponent);
  if(!location || location.prId!==pr.pr_id || location.project.toLowerCase()!==parts.at(-3)?.toLowerCase() ||
    location.repository.toLowerCase()!==parts.at(-1)?.toLowerCase())
    throw new UnknownError("当前 PR 与仓库身份不一致");
  const args=["--repo",location.repository,"--project",location.project];
  const live=await tfs.run(["pr","get",...args,"--id",String(pr.pr_id)],"核实 abandoned PR") as
    {id?:number;status?:string;sourceBranch?:string;targetBranch?:string};
  if(live?.id!==pr.pr_id || live.status!=="abandoned" || live.sourceBranch!==pr.source_branch || live.targetBranch!==pr.target_branch)
    throw new UnknownError("当前 PR 外部 abandoned 状态或身份无法确认");
  if(checkCandidate) {
    const r=await tfs.run(["branch","get",...args,"--name",pr.source_branch],"核实 Candidate") as {found?:boolean;branch?:{commit:string}};
    if(!r?.found || !r.branch?.commit) throw new UnknownError("候选分支无法确认");
    if(r.branch.commit!==pr.candidate_commit) throw new FailError("Candidate 已变化，须由 Human 确认工程返工");
  }
}

export function registerDeliveryRouteDecision(group: Command): void {
  group.command("route-decision").description("恢复 Human 明确批准的 Requirement 交付")
    .requiredOption("--issue <key>").requiredOption("--comment-id <id>")
    .requiredOption("--next <decision>").option("--reason <reason>")
    .action(async (opts: {issue:string;commentId:string;next:Next})=>{
      markLeafExecuted();
      try {
        if(!NEXTS.includes(opts.next)) throw new FailError("无效 Human 决定");
        const result=await routeDecision(new MulticaClient(resolveMulticaRuntime()),opts.issue,opts.commentId,opts.next,verifyAbandoned);
        process.stdout.write(JSON.stringify(result)+"\n");
      } catch(e) {
        if(!(e instanceof FailError || e instanceof UnknownError)) throw e;
        process.stdout.write(JSON.stringify({result:e instanceof FailError?"FAIL":"UNKNOWN",reason:e.message})+"\n");
        throw new ExitSignal(e instanceof FailError?2:3);
      }
    });
}
