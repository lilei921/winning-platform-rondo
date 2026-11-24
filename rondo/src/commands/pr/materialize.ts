/** Materialize all authorized Candidate PRs and verify their Work Item links. */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { MulticaClient } from "../../clients/multica.js";
import { resolveMulticaRuntime } from "../../clients/runtime-context.js";
import { TfsClient } from "../../clients/tfs.js";
import { TfsClient as ApiTfsClient } from "../../tfs/client.js";
import { verifiedRepo, type VerifiedRepo } from "../../tfs/api/commit-facts.js";
import { ensurePrWorkItemLink } from "../../tfs/api/pr-link.js";
import { normalizeTfsPrWebUrl, parseTfsPrWebUrl } from "../../tfs/api/pr.js";
import { assertTfsRepository } from "../../clients/authenticated-git.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";
import { readApprovedRepoMapping } from "../dev/native-prepare.js";
import { readAnalysisSource } from "../analysis/source.js";
import { assertBugReadyForPr, assertBugAgentAssignment } from "../bug/scope.js";
import { assertBugExecution, assertBugSource } from "../bug/authorization.js";
import { validateBugEvidence } from "../bug/evidence.js";
import { assertEngineerExecution } from "../dev/requirement-guard.js";
import { checkPublishedChange } from "../dev/change-completion.js";
import { candidateBranch } from "./candidate-branch.js";

interface PrPrepEntry {
  repo_key: string; repo_url: string; source_branch: string; target_branch: string;
  candidate_commit: string; title: string; description: string;
}
interface CurrentPrEntry {
  repo_key: string; pr_id: number; pr_url: string; source_branch: string; target_branch: string;
}
export function registerCurrentPr(
  multica: Pick<MulticaClient, "setMetadata" | "getIssue" | "setStatus">, issueId: string, currentPr: string,
): ReturnType<MulticaClient["getIssue"]> {
  multica.setMetadata(issueId, "current_pr", currentPr);
  if (multica.getIssue(issueId).metadata?.current_pr !== currentPr) {
    throw new UnknownError("current_pr 登记未确认，禁止进入 in_review");
  }
  multica.setStatus(issueId, "in_review");
  const confirmed = multica.getIssue(issueId);
  if (confirmed.status !== "in_review" || confirmed.metadata?.current_pr !== currentPr) {
    throw new UnknownError("PR 登记或 in_review 状态未确认");
  }
  return confirmed;
}


const filled = (v: unknown): v is string => typeof v === "string" && !!v.trim();
function list<T extends {repo_key: string}>(raw: string | undefined, field: string): T[] {
  let value: unknown;
  try { value = JSON.parse(raw ?? "[]"); } catch { throw new UnknownError(field + " 非法 JSON"); }
  if (!Array.isArray(value) || value.some(x=>!x || !filled(x.repo_key)) ||
      new Set(value.map(x=>x.repo_key)).size!==value.length) throw new FailError(field + " 仓库身份非法或重复");
  return value as T[];
}

export async function materializeOne(tfs: Pick<TfsClient, "run">, api: Pick<ApiTfsClient, "config" | "rawRequest">,
  tfsId: number, entry: PrPrepEntry, repo: VerifiedRepo, prior: CurrentPrEntry | undefined,
  readOnly: boolean, authorize: () => void): Promise<CurrentPrEntry & {reused:boolean}> {
  const collection = api.config.serverUrl;
  const expected = (url: string) => {
    const location = parseTfsPrWebUrl(url, collection);
    return location && location.project.toLowerCase() === repo.project.toLowerCase() &&
      location.repository.toLowerCase() === repo.repo.toLowerCase() ? location : null;
  };
  if (prior && (expected(prior.pr_url)?.prId !== prior.pr_id || prior.repo_key !== entry.repo_key ||
      prior.source_branch !== entry.source_branch || prior.target_branch !== entry.target_branch))
    throw new UnknownError("current_pr 仓库、PR 或分支身份不一致");
  const args = ["--repo", repo.repoId, "--project", repo.project];
  const checkHead = async () => {
    const branch = await tfs.run(["branch","get",...args,"--name",entry.source_branch], "核对远端 Candidate") as
      {found?:boolean;branch?:{commit:string}};
    if (!branch.found || branch.branch?.commit !== entry.candidate_commit) throw new UnknownError("远端 Candidate HEAD 不一致");
  };
  await checkHead();
  const verify = async (id:number, reused:boolean, priorUrl?:string) => {
    if(!Number.isSafeInteger(id)||id<=0) throw new UnknownError("TFS PR ID 未确认");
    const live = await tfs.run(["pr","get",...args,"--id",String(id)], "核实 PR") as
      {found?:boolean;id?:number;status?:string;sourceBranch?:string;targetBranch?:string;sourceCommitId?:string;description?:string;url?:string};
    if(live.found===false||live.id!==id||live.sourceBranch!==entry.source_branch||live.targetBranch!==entry.target_branch||
      !(live.status==="active" || (readOnly && live.status==="completed")) ||
      (live.status==="completed" && live.sourceCommitId!==entry.candidate_commit))
      throw new UnknownError("PR 外部身份、分支或状态不一致");
    if(!filled(live.description)||live.description.includes("补 TFS 工作项 id")) throw new FailError("已有 PR 缺少有效专业描述");
    const url = normalizeTfsPrWebUrl(live.url??priorUrl,collection,repo.project,repo.repo,id);
    await checkHead();
    authorize();
    await ensurePrWorkItemLink(api,repo,id,tfsId,!readOnly);
    return {repo_key:entry.repo_key,pr_id:id,pr_url:url,source_branch:entry.source_branch,target_branch:entry.target_branch,reused};
  };
  if(prior) return verify(prior.pr_id,true,prior.pr_url);
  if(readOnly) throw new FailError("in_review 缺少完整已登记 PR");
  const prs = await tfs.run(["pr","list",...args,"--status","active","--source-branch",entry.source_branch], "查询已有 PR") as
    Array<{id:number;url:string;targetBranch:string}>;
  if(!Array.isArray(prs)) throw new UnknownError("已有 PR 列表不可确认");
  const existing=prs.filter(p=>p.targetBranch===entry.target_branch);
  if(existing.length>1) throw new UnknownError("存在多个相同源目标的 active PR");
  if(existing.length===1) return verify(existing[0].id,true,existing[0].url);
  const dir=mkdtempSync(join(tmpdir(),"rondo-pr-"));
  try {
    const file=join(dir,"description.md"); writeFileSync(file,entry.description,"utf8");
    authorize();
    const created=await tfs.run(["pr","create",...args,"--source",entry.source_branch,"--target",entry.target_branch,
      "--title",entry.title,"--description-file",file], "创建 PR") as {created?:boolean;pr?:{id:number;url:string};existing?:{id:number;url:string}};
    const pr=created.created===true?created.pr:created.created===false?created.existing:undefined;
    if(!pr) throw new UnknownError("创建 PR 结果不可确认");
    return await verify(pr.id,!created.created,pr.url);
  } finally { try {rmSync(dir,{recursive:true,force:true});} catch {/* best-effort temporary cleanup */} }
}

export function registerPrMaterialize(group: Command): void {
  group.command("materialize").description("创建或核实已准备的 PR")
    .requiredOption("--issue <key>")
    .action(async (opts: {issue:string}) => {
      markLeafExecuted();
      try {
        const runtime=resolveMulticaRuntime(), multica=new MulticaClient(runtime);
        const issue=multica.getIssue(opts.issue), md=issue.metadata??{}, readOnly=issue.status==="in_review";
        const bug=md["tfs.type"]==="Bug", tfsId=Number(md["tfs.id"]);
        if(!bug&&md["tfs.type"]!=="需求") throw new FailError("不支持当前 TFS Type");
        if(bug&&(md["analysis.change_ref"]||md["analysis.gate.result"])) throw new FailError("Bug 不能混入 OpenSpec Gate");
        const branch=candidateBranch(md["tfs.id"]);
        const authorize=()=>{
          const fresh=multica.getIssue(issue.id), facts=fresh.metadata??{};
          if(fresh.status!==issue.status||fresh.assignee_id!==issue.assignee_id||
            ["tfs.id","tfs.type","tfs.url","analysis.source","analysis.human_approval","analysis.change_ref","analysis.gate.result",
              "dev.publication","pr_prep","bug.delivery","bug.required_repos","current_pr","finalize.pending","delivery.tfs_written","dev.dispatch","verify_agent.required"]
              .some(k=>facts[k]!==md[k])) throw new UnknownError("PR 物化期间授权或准备事实变化");
          if(!["todo","in_progress","in_review"].includes(fresh.status??"")||facts["finalize.pending"]||facts["delivery.tfs_written"]==="true")
            throw new FailError("当前 Issue 状态不允许 PR 物化");
          if(readOnly) return;
          if(bug) {
            assertBugExecution(multica,fresh);
            assertBugAgentAssignment(fresh.assignee_id,multica.run(["agent","list",...multica.ws(),"--output","json"],"核验 Bug Fix 指派",{transient:true}));
          } else assertEngineerExecution(multica,fresh,runtime.workspace_id);
        };
        authorize();
        const api=new ApiTfsClient(), tfs=new TfsClient(), server=api.config.serverUrl;
        const prep=list<PrPrepEntry>(md.pr_prep,"pr_prep"), prior=list<CurrentPrEntry>(md.current_pr,"current_pr");
        if(!prep.length) throw new FailError("缺少 PR Preparation");
        if(prior.some(p=>!prep.some(x=>x.repo_key===p.repo_key)||!Number.isSafeInteger(p.pr_id)||p.pr_id<=0)||
          (readOnly&&prior.length!==prep.length)) throw new FailError("current_pr 与准备仓库集合不一致");
        let registry:Awaited<ReturnType<typeof readApprovedRepoMapping>>|undefined;
        if(bug) {
          await assertBugSource(issue,server);
          assertBugReadyForPr(md);
          const delivery=list<Record<string,unknown>&{repo_key:string}>(md["bug.delivery"],"bug.delivery");
          for(const d of delivery) {
            const errors=validateBugEvidence({...d,blockers:[]},{issue:issue.identifier??issue.id,tfsId,repoKey:d.repo_key,sha:String(d.candidate_commit)});
            if(errors.length) throw new FailError(errors.join("；"));
          }
        } else {
          const source=readAnalysisSource(md);
          registry=await readApprovedRepoMapping(source,server);
          await checkPublishedChange({runtime,registry},multica,opts.issue,source.change_ref);
        }
        const identities=new Map<string,VerifiedRepo>(), seen=new Set<string>();
        for(const entry of prep) {
          if(entry.source_branch!==branch||!filled(entry.target_branch)||entry.target_branch===branch||
            !/^[0-9a-f]{40}$/.test(entry.candidate_commit??"")||!filled(entry.title)||!filled(entry.description)||entry.description.includes("补 TFS 工作项 id"))
            throw new FailError("PR Candidate / Description 无效");
          const url=assertTfsRepository(entry.repo_url,server), parts=url.pathname.split("/").map(decodeURIComponent);
          if(registry) {
            const approved=registry[entry.repo_key];
            if(!approved||approved.default_target_branch!==entry.target_branch||
              canonicalRepositoryIdentity(approved.repo_url)!==canonicalRepositoryIdentity(url.href)) throw new FailError("PR 仓库或目标分支偏离批准映射");
          }
          const repo=await verifiedRepo(api,parts.at(-3)!,parts.at(-1)!);
          const key=repo.projectId+"/"+repo.repoId;
          if(seen.has(key)) throw new FailError("不同 repo_key 指向同一真实 TFS Repository");
          seen.add(key);identities.set(entry.repo_key,repo);
        }
        authorize();
        const prs=[];
        for(const entry of prep) prs.push(await materializeOne(tfs,api,tfsId,entry,identities.get(entry.repo_key)!,
          prior.find(p=>p.repo_key===entry.repo_key),readOnly,authorize));
        authorize();
        if(!readOnly) registerCurrentPr(multica,issue.id,JSON.stringify(prs.map(({reused:_,...rest})=>rest)));
        process.stdout.write(JSON.stringify({result:"PASS",issue:issue.identifier??issue.id,status:"in_review",prs},null,2)+"\n");
      } catch(e) {
        if(!(e instanceof FailError||e instanceof UnknownError)) throw e;
        process.stdout.write(JSON.stringify({result:e instanceof FailError?"FAIL":"UNKNOWN",reason:e.message})+"\n");
        throw new ExitSignal(e instanceof FailError?2:3);
      }
    });
}
