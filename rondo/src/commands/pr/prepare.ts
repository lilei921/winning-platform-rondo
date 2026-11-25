import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { gitOk } from "../../clients/git.js";
import { runAuthenticatedGit } from "../../clients/authenticated-git.js";
import { authorizedCheckout } from "../dev/authorized-checkout.js";
import { validatePrepareRepo } from "../dev/prepare-workspace.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import { readBugEvidenceInput, validateBugEvidence } from "../bug/evidence.js";
import { requiredBugRepos, assertBugReadyForPr } from "../bug/scope.js";
import { verifyAndExecuteValidation } from "./validation.js";

const filled = (v: unknown): v is string => typeof v === "string" && !!v.trim();
type Fact = { result: "PASS"; summary: string; command?: string[]; evidence_refs?: string[] };
type Finding = { resolved?: boolean; blocking?: boolean; risk_note?: string; risk_ref?: string };
interface Facts {
  validation: Omit<Fact, "result"> & { result?: "PASS" }; code_review: Fact & { findings: Finding[] };
  blockers: string[]; description: string;
  expected_behavior?: string; actual_behavior?: string; root_cause?: unknown; fix_summary?: string; regression?: Fact;
}

export function validatePrFacts(raw: unknown, bug: boolean): Facts {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new FailError("Facts 必须是 JSON 对象");
  const f = raw as Facts, v = f.validation, review = f.code_review;
  if (!v || !filled(v.summary)) throw new FailError("Validation 缺少 summary");
  if (v.result !== undefined && v.result !== "PASS") throw new FailError("Validation result 如提供必须为 PASS");
  if ((v.command !== undefined || !bug) &&
      (!Array.isArray(v.command) || !v.command.length || v.command.some(x => !filled(x))))
    throw new FailError("Validation command 必须是非空合法命令数组");
  if (v.command === undefined && v.result !== "PASS") throw new FailError("无验证命令的 Bug 必须提供真实 Validation PASS");
  if (review?.result !== "PASS" || !filled(review.summary)) throw new FailError("Code Review 缺少 PASS 或 summary");
  const findings = review.findings === undefined ? [] : review.findings;
  if (!Array.isArray(findings) || findings.some(x => !x || typeof x !== "object" || Array.isArray(x) ||
      (x.resolved !== true && (x.blocking !== false || (!filled(x.risk_note) && !filled(x.risk_ref))))))
    throw new FailError("Code Review Findings 未解决或未记录风险");
  if (!Array.isArray(f.blockers) || f.blockers.length) throw new FailError("blockers 必须显式为空数组");
  if (!filled(f.description) || f.description.includes("补 TFS 工作项 id")) throw new FailError("缺少专业 PR Description");
  return { ...f, code_review: { ...review, findings } };
}

function list(raw: string | undefined, field: string): Array<Record<string, unknown>> {
  let value: unknown;
  try { value = JSON.parse(raw ?? "[]"); } catch { throw new UnknownError(field + " 非法 JSON"); }
  if (!Array.isArray(value) || value.some(x => !x || typeof x !== "object" || Array.isArray(x) || !filled(x.repo_key)) ||
      new Set(value.map(x => x.repo_key)).size !== value.length) throw new UnknownError(field + " 仓库事实非法或重复");
  return value;
}

export function registerPrPrepare(group: Command): void {
  group.command("prepare").description("准备已授权 Candidate 的 PR 事实")
    .requiredOption("--issue <key>").requiredOption("--repo <key>").requiredOption("--root-repo <path>")
    .requiredOption("--candidate-commit <sha>").requiredOption("--facts <file|->").requiredOption("--title <title>")
    .option("--validation-cwd <path>").option("--required-repos <repos>")
    .action(async (opts: {issue:string;repo:string;rootRepo:string;candidateCommit:string;facts:string;title:string;validationCwd?:string;requiredRepos?:string}) => {
      markLeafExecuted();
      try {
        const sha = opts.candidateCommit;
        if (!/^[0-9a-f]{40}$/.test(sha) || !filled(opts.title)) throw new FailError("Candidate SHA 或标题非法");
        const current = await authorizedCheckout(opts.issue, opts.repo, opts.rootRepo);
        const {client, issue, md, repo, path, branch, tfsId, bug, registry} = current;
        const rawInput = readBugEvidenceInput(opts.facts);
        const facts = validatePrFacts(rawInput, bug);
        const suppliedIdentity = rawInput as Record<string,unknown>;
        for (const [key, expected] of Object.entries({issue:issue.identifier??issue.id,tfs_id:tfsId,repo_key:opts.repo,candidate_commit:sha})) {
          if (suppliedIdentity[key] !== undefined && (key === "tfs_id" ? Number(suppliedIdentity[key]) !== expected : suppliedIdentity[key] !== expected))
            throw new FailError("Facts "+key+" 与当前 Candidate 身份不一致");
        }
        if (!bug && opts.requiredRepos !== undefined) throw new FailError("Requirement 使用已批准 Scope，不接受 --required-repos");
        let required: string[] = [];
        const review = {result:"PASS", summary:facts.code_review.summary, findings:facts.code_review.findings,
          candidate_commit:sha, ...(bug && {evidence_refs:facts.code_review.evidence_refs})};
        checkLocalCandidate(current.head);
        if (bug) {
          required = opts.requiredRepos !== undefined ? requiredBugRepos(JSON.stringify(opts.requiredRepos.split(",").map(x=>x.trim()))) :
            md["bug.required_repos"] ? requiredBugRepos(md["bug.required_repos"]) : [opts.repo];
          if (!required.includes(opts.repo) || (md["bug.required_repos"] && JSON.stringify(required)!==JSON.stringify(requiredBugRepos(md["bug.required_repos"]))))
            throw new FailError("Bug required_repos 与固定 Scope 不一致");
          for(const key of required) validatePrepareRepo(registry[key],loadTfsConfig().serverUrl);
          const refs = gitOk(path,["show","-s","--format=%B",sha],"读取 Candidate Commit").split(/\r?\n/).filter(x=>/^Refs:\s*/i.test(x));
          if (refs.length!==1 || refs[0].trim()!=="Refs: #"+tfsId) throw new FailError("Candidate 必须包含唯一 Refs: #"+tfsId);
        }
        function checkLocalCandidate(head:string) {
          if(head!==sha || gitOk(path,["status","--porcelain","--untracked-files=no"],"核对 Candidate 工作树"))
            throw new FailError("Candidate HEAD 不一致或存在未提交修改");
        }
        const checkCandidate = (head:string) => {
          checkLocalCandidate(head);
          const ref="refs/heads/"+branch, remote=runAuthenticatedGit(repo.repo_url,["ls-remote",repo.repo_url,ref],path);
          if(remote.status!==0 || remote.stdout.trim()!==sha+"\t"+ref) throw new UnknownError("远端 Candidate SHA 未确认");
        };
        checkCandidate(current.head);
        if (facts.validation.command) verifyAndExecuteValidation(path,opts.validationCwd??path,repo.repo_url,sha,facts.validation.command);
        else if (opts.validationCwd!==undefined) throw new FailError("无执行命令时不接受 --validation-cwd");
        const fresh=await authorizedCheckout(opts.issue,opts.repo,opts.rootRepo);
        if(fresh.issue.id!==issue.id || fresh.issue.status!==issue.status || fresh.revision!==current.revision ||
          fresh.path!==path || JSON.stringify(fresh.repo)!==JSON.stringify(repo) ||
          ["analysis.source","analysis.human_approval","analysis.change_ref","analysis.gate.result","tfs.id","tfs.type","tfs.url","bug.required_repos","current_pr","finalize.pending","delivery.tfs_written"]
            .some(k=>fresh.md[k]!==md[k])) throw new UnknownError("Validation 期间授权或仓库事实变化");
        checkCandidate(fresh.head);
        const validation = {result:"PASS", summary:facts.validation.summary, ...(bug && {evidence_refs:facts.validation.evidence_refs}),
          ...(facts.validation.command && {command:facts.validation.command, exit_code:0, candidate_commit:sha, source:"rondo pr prepare"})};
        let delivery: Record<string, unknown> | undefined;
        if (bug) {
          const raw = {expected_behavior:facts.expected_behavior, actual_behavior:facts.actual_behavior, root_cause:facts.root_cause,
            fix_summary:facts.fix_summary, regression:facts.regression, local_validation:validation, code_review:review, blockers:facts.blockers};
          const problems = validateBugEvidence(raw,{issue:issue.identifier??issue.id,tfsId,repoKey:opts.repo,sha});
          if (problems.length) throw new FailError(problems.join("；"));
          const {blockers:_, ...professional} = raw;
          delivery = {...professional,repo_key:opts.repo,source_branch:branch,target_branch:repo.default_target_branch,candidate_commit:sha,tfs_id:tfsId};
        }
        const replace = (field:string,entry:Record<string,unknown>) => {
          const before=list(md[field],field), after=list(fresh.md[field],field);
          if(JSON.stringify(before.find(x=>x.repo_key===opts.repo))!==JSON.stringify(after.find(x=>x.repo_key===opts.repo)))
            throw new UnknownError(field+" 本仓事实在验证期间变化");
          return JSON.stringify([...after.filter(x=>x.repo_key!==opts.repo),entry]);
        };
        const prepared=replace("pr_prep",{repo_key:opts.repo,repo_url:repo.repo_url,source_branch:branch,target_branch:repo.default_target_branch,
          candidate_commit:sha,title:opts.title,description:facts.description,...(!bug && {local_validation:validation,code_review:review,blockers:[]})});
        const bugDelivery=delivery?replace("bug.delivery",delivery):undefined;
        const requiredJson=JSON.stringify(required);
        if(bug && !md["bug.required_repos"]) client.setMetadata(issue.id,"bug.required_repos",requiredJson);
        if(bugDelivery) client.setMetadata(issue.id,"bug.delivery",bugDelivery);
        client.setMetadata(issue.id,"pr_prep",prepared);
        const confirmed=client.getIssue(issue.id).metadata??{};
        if(confirmed.pr_prep!==prepared || (bug && (confirmed["bug.required_repos"]!==requiredJson || confirmed["bug.delivery"]!==bugDelivery)))
          throw new UnknownError("PR Preparation 事实未回读确认");
        let ready=true;
        if(bug) {try {assertBugReadyForPr(confirmed);} catch(e) {if(!(e instanceof FailError)) throw e;ready=false;}}
        process.stdout.write(JSON.stringify({result:"PASS",repo_key:opts.repo,candidate_commit:sha,ready_for_pr:ready})+"\n");
      } catch(e) {
        if(!(e instanceof FailError || e instanceof UnknownError)) throw e;
        process.stdout.write(JSON.stringify({result:e instanceof FailError?"FAIL":"UNKNOWN",reason:e.message})+"\n");
        throw new ExitSignal(e instanceof FailError?2:3);
      }
    });
}
