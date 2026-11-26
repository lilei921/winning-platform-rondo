/** Materialize all authorized Candidate PRs and verify their Work Item links. */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { MulticaClient, type IssueRecord } from "../../clients/multica.js";
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

interface PrPrepEntry {
  repo_key: string; repo_url: string; source_branch: string; target_branch: string;
  candidate_commit: string; title: string; description: string;
}
interface CurrentPrEntry {
  repo_key: string; pr_id: number; pr_url: string; source_branch: string; target_branch: string;
}
type MaterializedPr = CurrentPrEntry & { reused: boolean };

/** Persist a verified identity without replacing any other registration. */
function registerPrIdentity(
  multica: Pick<MulticaClient, "setMetadata" | "getIssue">, issueId: string,
  registered: CurrentPrEntry[], pr: MaterializedPr, check: () => void,
): IssueRecord {
  const { reused: _, ...identity } = pr;
  check();
  const next = JSON.stringify([...registered, identity]);
  multica.setMetadata(issueId, "current_pr", next);
  const confirmed = multica.getIssue(issueId);
  if (confirmed.metadata?.current_pr !== next) {
    throw new UnknownError("current_pr 登记未确认，停止后续 PR 物化");
  }
  registered.push(identity);
  return confirmed;
}

/** Persist each confirmed identity before moving to another repository. */
export async function materializePreparedPrs(
  multica: Pick<MulticaClient, "setMetadata" | "getIssue" | "setStatus">, issueId: string,
  prep: PrPrepEntry[], initialCurrentPr: string | undefined, readOnly: boolean,
  authorize: (expectedCurrentPr: string | undefined, checkActor?: boolean) => void,
  materialize: (entry: PrPrepEntry, prior: CurrentPrEntry | undefined, authorizeCurrent: () => void) => Promise<MaterializedPr>,
): Promise<MaterializedPr[]> {
  const registered = list<CurrentPrEntry>(initialCurrentPr, "current_pr");
  if (!prep.length || registered.some(p => !prep.some(x => x.repo_key === p.repo_key) ||
      !Number.isSafeInteger(p.pr_id) || p.pr_id <= 0) || (readOnly && registered.length !== prep.length)) {
    throw new FailError("current_pr 与准备仓库集合不一致");
  }
  let currentPr = initialCurrentPr;
  const authorizeCurrent = () => authorize(currentPr);
  const prs: MaterializedPr[] = [];
  for (const entry of prep) {
    const prior = registered.find(p => p.repo_key === entry.repo_key);
    const pr = await materialize(entry, prior, authorizeCurrent);
    if (!prior && !readOnly) {
      currentPr = registerPrIdentity(multica, issueId, registered, pr,
        () => authorize(currentPr, false)).metadata!.current_pr;
    }
    prs.push(pr);
  }
  authorize(currentPr, false);
  if (!readOnly) {
    multica.setStatus(issueId, "in_review");
    const confirmed = multica.getIssue(issueId);
    if (confirmed.status !== "in_review" || confirmed.metadata?.current_pr !== currentPr) {
      throw new UnknownError("PR 登记或 in_review 状态未确认");
    }
  }
  return prs;
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
  readOnly: boolean, authorize: () => void, recoverOnly = false): Promise<CurrentPrEntry & {reused:boolean}> {
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
    if(!recoverOnly && live.status==="active" && (!filled(live.description)||live.description.includes("补 TFS 工作项 id"))) throw new FailError("已有 PR 缺少有效专业描述");
    const url = normalizeTfsPrWebUrl(live.url??priorUrl,collection,repo.project,repo.repo,id);
    if(live.status==="active") await checkHead();
    authorize();
    await ensurePrWorkItemLink(api,repo,id,tfsId,!readOnly && !recoverOnly);
    return {repo_key:entry.repo_key,pr_id:id,pr_url:url,source_branch:entry.source_branch,target_branch:entry.target_branch,reused};
  };
  if(prior) return verify(prior.pr_id,true,prior.pr_url);
  if(readOnly && !recoverOnly) throw new FailError("in_review 缺少完整已登记 PR");
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
  if(recoverOnly) throw new UnknownError("未找到可恢复的已有 PR: " + entry.repo_key);
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

async function resolvePreparedRepos(api: ApiTfsClient, prep: PrPrepEntry[], resolveRepo = verifiedRepo): Promise<Map<string, VerifiedRepo>> {
  const identities = new Map<string, VerifiedRepo>(), seen = new Set<string>();
  for (const entry of prep) {
    const url = assertTfsRepository(entry.repo_url, api.config.serverUrl);
    const parts = url.pathname.split("/").map(decodeURIComponent);
    const repo = await resolveRepo(api, parts.at(-3)!, parts.at(-1)!);
    const key = repo.projectId + "/" + repo.repoId;
    if (seen.has(key)) throw new FailError("不同 repo_key 指向同一真实 TFS Repository");
    seen.add(key); identities.set(entry.repo_key, repo);
  }
  return identities;
}

/** Recover missing registrations from pinned preparation; never create PRs or change Issue status. */
export async function recoverPreparedPrs(
  multica: Pick<MulticaClient, "getIssue" | "setMetadata">, issue: IssueRecord,
  api = new ApiTfsClient(), tfs: Pick<TfsClient, "run"> = new TfsClient(), resolveRepo = verifiedRepo,
): Promise<{issue: IssueRecord; detail?: string}> {
  const md = issue.metadata ?? {};
  if (issue.status !== "in_review" && issue.status !== "blocked") return {issue};
  let currentPr = md.current_pr;
  let fresh = issue;
  const check = () => {
    fresh = multica.getIssue(issue.id);
    const facts = fresh.metadata ?? {};
    if (fresh.status !== issue.status || fresh.assignee_id !== issue.assignee_id ||
        facts.current_pr !== currentPr ||
        ["tfs.id","tfs.type","tfs.url","pr_prep","pr.abandoned","bug.resume","finalize.pending","delivery.tfs_written"]
          .some(k => facts[k] !== md[k])) {
      throw new UnknownError("PR 恢复期间 Issue 事实变化");
    }
  };
  let prep: PrPrepEntry[], registered: CurrentPrEntry[], identities: Map<string, VerifiedRepo>;
  const tfsId = Number(md["tfs.id"]);
  try {
    prep = list<PrPrepEntry>(md.pr_prep, "pr_prep");
    registered = list<CurrentPrEntry>(md.current_pr, "current_pr");
    if (!prep.length || registered.some(p => !prep.some(x => x.repo_key === p.repo_key) ||
        !Number.isSafeInteger(p.pr_id) || p.pr_id <= 0)) {
      throw new FailError("current_pr 与 pr_prep 仓库集合不一致");
    }
    if (registered.length === prep.length) return {issue};
    const branch = candidateBranch(md["tfs.id"]);
    if (md["tfs.type"] !== "Bug" && md["tfs.type"] !== "需求") throw new FailError("不支持当前 TFS Type");
    for (const entry of prep) {
      if (entry.source_branch !== branch || !filled(entry.target_branch) ||
          entry.target_branch === branch || !/^[0-9a-f]{40}$/i.test(entry.candidate_commit ?? "")) {
        throw new FailError("PR Preparation 缺少有效 Candidate: " + entry.repo_key);
      }
    }
    identities = await resolvePreparedRepos(api, prep, resolveRepo);
  } catch (e) {
    check();
    return {issue: fresh, detail: (e as Error).message};
  }
  for (const entry of prep) {
    if (registered.some(p => p.repo_key === entry.repo_key)) continue;
    let pr: MaterializedPr;
    try {
      pr = await materializeOne(tfs, api, tfsId, entry, identities.get(entry.repo_key)!, undefined, true, check, true);
    } catch (e) {
      // Preserve successful registrations and allow Sync to inspect known PRs.
      check();
      return {issue: fresh, detail: (e as Error).message};
    }
    fresh = registerPrIdentity(multica, issue.id, registered, pr, check);
    currentPr = fresh.metadata!.current_pr;
  }
  check();
  return {issue: fresh};
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
              "dev.publication","pr_prep","bug.delivery","bug.required_repos","finalize.pending","delivery.tfs_written","dev.dispatch","verify_agent.required"]
              .some(k=>facts[k]!==md[k]) || facts.current_pr!==expectedCurrentPr) throw new UnknownError("PR 物化期间授权或准备事实变化");
          if(!["todo","in_progress","in_review"].includes(fresh.status??"")||facts["finalize.pending"]||facts["delivery.tfs_written"]==="true")
            throw new FailError("当前 Issue 状态不允许 PR 物化");
          if(readOnly || !checkActor) return;
          if(bug) {
            assertBugExecution(multica,fresh);
            assertBugAgentAssignment(fresh.assignee_id,multica.run(["agent","list",...multica.ws(),"--output","json"],"核验 Bug Fix 指派",{transient:true}));
          } else assertEngineerExecution(multica,fresh,runtime.workspace_id);
        };
        authorize(md.current_pr);
        const api=new ApiTfsClient(), tfs=new TfsClient(), server=api.config.serverUrl;
        const prep=list<PrPrepEntry>(md.pr_prep,"pr_prep");
        if(!prep.length) throw new FailError("缺少 PR Preparation");
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
          const registry=await readApprovedRepoMapping(source,server);
          await checkPublishedChange({runtime,registry},multica,opts.issue,source,md.pr_prep);
        }
        for(const entry of prep) {
          if(bug&&(entry.source_branch!==branch||!filled(entry.target_branch)||entry.target_branch===branch||
            !/^[0-9a-f]{40}$/.test(entry.candidate_commit??"")||!filled(entry.title)||!filled(entry.description)||entry.description.includes("补 TFS 工作项 id")))
            throw new FailError("PR Candidate / Description 无效");
        }
        const identities=await resolvePreparedRepos(api,prep);
        const prs=await materializePreparedPrs(multica,issue.id,prep,md.current_pr,readOnly,authorize,
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
