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
import { readApprovedRepoMapping } from "../dev/native-prepare.js";
import { readAnalysisSource } from "../analysis/source.js";
import { assertBugReadyForPr, assertBugAgentAssignment } from "../bug/scope.js";
import { assertBugExecution, assertBugSource } from "../bug/authorization.js";
import { validateBugEvidence } from "../bug/evidence.js";
import { assertEngineerExecution } from "../dev/requirement-guard.js";
import { checkPublishedChange } from "../dev/change-completion.js";
import { candidateBranch } from "./candidate-branch.js";
import { readPrRecords, isRegisteredPr, type PrRecord } from "./facts.js";

type PrPrepEntry = Pick<PrRecord, "repo_key"|"repo_url"|"source_branch"|"target_branch"|"candidate_commit"|"title"|"description">;
interface CurrentPrEntry {
  repo_key: string; pr_id: number; pr_url: string; source_branch: string; target_branch: string;
}
type MaterializedPr = CurrentPrEntry & { reused: boolean };

/** Persist each confirmed identity before moving to another repository. */
export async function materializePreparedPrs(
  multica: Pick<MulticaClient, "setMetadata" | "getIssue" | "setStatus">, issueId: string,
  initialPr: string | undefined, readOnly: boolean,
  authorize: (expectedPr: string | undefined, checkActor?: boolean) => void,
  materialize: (entry: PrPrepEntry, prior: CurrentPrEntry | undefined, authorizeCurrent: () => void) => Promise<MaterializedPr>,
): Promise<MaterializedPr[]> {
  let records = readPrRecords(initialPr);
  if (!records.length || (readOnly && records.some(p => !isRegisteredPr(p)))) throw new FailError("pr 准备或登记不完整");
  let currentPr = initialPr;
  const authorizeCurrent = () => authorize(currentPr);
  const prs: MaterializedPr[] = [];
  for (const entry of records) {
    const prior = isRegisteredPr(entry) ? entry : undefined;
    const pr = await materialize(entry, prior, authorizeCurrent);
    if (!prior && !readOnly) {
      authorize(currentPr, false);
      records = records.map(p => p.repo_key === entry.repo_key ? {...p, pr_id: pr.pr_id, pr_url: pr.pr_url} : p);
      const next = JSON.stringify(records);
      multica.setMetadata(issueId, "pr", next);
      if (multica.getIssue(issueId).metadata?.pr !== next) throw new UnknownError("pr 登记未确认，停止后续 PR 物化");
      currentPr = next;
    }
    prs.push(pr);
  }
  authorize(currentPr, false);
  if (!readOnly) {
    multica.setStatus(issueId, "in_review");
    const confirmed = multica.getIssue(issueId);
    if (confirmed.status !== "in_review" || confirmed.metadata?.pr !== currentPr) throw new UnknownError("PR 登记或 in_review 状态未确认");
  }
  return prs;
}

const filled = (v: unknown): v is string => typeof v === "string" && !!v.trim();
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
  const verify = async (id:number, reused:boolean, priorUrl?:string) => {
    if(!Number.isSafeInteger(id)||id<=0) throw new UnknownError("TFS PR ID 未确认");
    const live = await tfs.run(["pr","get",...args,"--id",String(id)], "核实 PR") as
      {found?:boolean;id?:number;status?:string;sourceBranch?:string;targetBranch?:string;sourceCommitId?:string;description?:string;url?:string};
    if(live.found===false||live.id!==id||live.sourceBranch!==entry.source_branch||live.targetBranch!==entry.target_branch||
      !(live.status==="active" || live.status==="completed") ||
      (live.status==="completed" && live.sourceCommitId!==entry.candidate_commit))
      throw new UnknownError("PR 外部身份、分支或状态不一致");
    if(live.status==="active" && (!filled(live.description)||live.description.includes("补 TFS 工作项 id"))) throw new FailError("已有 PR 缺少有效专业描述");
    const url = normalizeTfsPrWebUrl(live.url??priorUrl,collection,repo.project,repo.repo,id);
    if(live.status==="active") await checkHead();
    authorize();
    await ensurePrWorkItemLink(api,repo,id,tfsId,!readOnly);
    return {repo_key:entry.repo_key,pr_id:id,pr_url:url,source_branch:entry.source_branch,target_branch:entry.target_branch,reused};
  };
  if(prior) return verify(prior.pr_id,true,prior.pr_url);
  if(readOnly) throw new FailError("in_review 缺少完整已登记 PR");
  const existing: Array<{id:number;url:string;targetBranch:string}> = [];
  for (const status of ["active", "completed"]) {
    const prs = await tfs.run(["pr","list",...args,"--status",status,"--source-branch",entry.source_branch,"--top","100"], "查询已有 PR") as
      Array<{id:number;url:string;targetBranch:string}>;
    if(!Array.isArray(prs) || prs.length >= 100) throw new UnknownError("已有 PR 列表不可完整确认");
    existing.push(...prs.filter(p=>p.targetBranch===entry.target_branch));
  }
  // A PR may move from active to completed between the two reads.
  const unique = [...new Map(existing.map(pr=>[pr.id,pr])).values()];
  if(unique.length>1) throw new UnknownError("存在多个相同源目标的 active/completed PR");
  if(unique.length===1) return verify(unique[0].id,true,unique[0].url);
  const dir=mkdtempSync(join(tmpdir(),"rondo-pr-"));
  try {
    const file=join(dir,"description.md"); writeFileSync(file,entry.description,"utf8");
    await checkHead();
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
        const authorize=(expectedCurrentPr: string | undefined, checkActor = true)=>{
          const fresh=multica.getIssue(issue.id), facts=fresh.metadata??{};
          if(fresh.status!==issue.status||fresh.assignee_id!==issue.assignee_id||
            ["tfs.id","tfs.type","tfs.url","analysis.source","analysis.human_approval","analysis.change_ref","analysis.gate.result",
              "dev.publication","bug.required_repos","finalize.pending","delivery.tfs_written","verify_agent.required"]
              .some(k=>facts[k]!==md[k]) || facts.pr!==expectedCurrentPr) throw new UnknownError("PR 物化期间授权或准备事实变化");
          if(!["todo","in_progress","in_review"].includes(fresh.status??"")||facts["finalize.pending"]||facts["delivery.tfs_written"]==="true")
            throw new FailError("当前 Issue 状态不允许 PR 物化");
          if(readOnly || !checkActor) return;
          if(bug) {
            assertBugExecution(multica,fresh);
            assertBugAgentAssignment(fresh.assignee_id,multica.run(["agent","list",...multica.ws(),"--output","json"],"核验 Bug Fix 指派",{transient:true}));
          } else assertEngineerExecution(multica,fresh,runtime.workspace_id);
        };
        authorize(md.pr);
        const api=new ApiTfsClient(), tfs=new TfsClient(), server=api.config.serverUrl;
        const prep=readPrRecords(md.pr);
        if(!prep.length) throw new FailError("缺少 PR Preparation");
        if(bug) {
          await assertBugSource(issue,server);
          assertBugReadyForPr(md);
          for(const d of prep) {
            const errors=validateBugEvidence(d,{issue:issue.identifier??issue.id,tfsId,repoKey:d.repo_key,sha:d.candidate_commit}, false, true);
            if(errors.length) throw new FailError(errors.join("；"));
          }
        } else {
          const source=readAnalysisSource(md);
          const registry=await readApprovedRepoMapping(source,server);
          await checkPublishedChange({runtime,registry},multica,opts.issue,source,md.pr);
        }
        const identities=new Map<string,VerifiedRepo>(), seen=new Set<string>();
        for(const entry of prep) {
          if(bug&&(entry.source_branch!==branch||!filled(entry.target_branch)||entry.target_branch===branch||
            !/^[0-9a-f]{40}$/.test(entry.candidate_commit??"")||!filled(entry.title)||!filled(entry.description)||entry.description.includes("补 TFS 工作项 id")))
            throw new FailError("PR Candidate / Description 无效");
          const url=assertTfsRepository(entry.repo_url,server), parts=url.pathname.split("/").map(decodeURIComponent);
          const repo=await verifiedRepo(api,parts.at(-3)!,parts.at(-1)!);
          const key=repo.projectId+"/"+repo.repoId;
          if(seen.has(key)) throw new FailError("不同 repo_key 指向同一真实 TFS Repository");
          seen.add(key);identities.set(entry.repo_key,repo);
        }
        const prs=await materializePreparedPrs(multica,issue.id,md.pr,readOnly,authorize,
          (entry,prior,authorizeCurrent)=>materializeOne(tfs,api,tfsId,entry,identities.get(entry.repo_key)!,
            prior,readOnly,authorizeCurrent));
        process.stdout.write(JSON.stringify({result:"PASS",issue:issue.identifier??issue.id,status:"in_review",prs},null,2)+"\n");
      } catch(e) {
        if(!(e instanceof FailError||e instanceof UnknownError)) throw e;
        process.stdout.write(JSON.stringify({result:e instanceof FailError?"FAIL":"UNKNOWN",reason:e.message})+"\n");
        throw new ExitSignal(e instanceof FailError?2:3);
      }
    });
}
