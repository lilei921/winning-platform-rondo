/** Restore PR facts after an explicit Human decision; Multica owns Issue status and Run. */
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { MulticaClient } from "../../clients/multica.js";
import { resolveMulticaRuntime } from "../../clients/runtime-context.js";
import { TfsClient } from "../../clients/tfs.js";
import { readPrRecords, isRegisteredPr, withoutPrIdentity, type RegisteredPr } from "./facts.js";
import { parseTfsPrWebUrl } from "../../tfs/api/pr.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import { assertTfsRepository } from "../../clients/authenticated-git.js";
import { candidateBranch } from "./candidate-branch.js";
import { assertBugReadyForPr } from "../bug/scope.js";
import { validateBugEvidence } from "../bug/evidence.js";
import { readApprovedVerifyDecision } from "../delivery/verify-decision.js";

type Next = "REWORK" | "RECREATE_PR";
interface Abandoned { repo_key: string; pr_id: number; event_key: string; detected_at: string }

export async function resumePr(client: Pick<MulticaClient,"getIssue"|"listComments"|"setMetadata">,
  issueRef: string, commentId: string, next: Next,
  verify: (pr: RegisteredPr, checkCandidate: boolean) => Promise<void> = verifyAbandoned) {
  const issue = client.getIssue(issueRef), md = {...issue.metadata}, issueKey = issue.identifier ?? issue.id;
  const bug = md["tfs.type"] === "Bug";
  if ((!bug && md["tfs.type"] !== "需求") || (bug && (md["analysis.source"] !== undefined || md["analysis.gate.result"])))
    throw new FailError("当前 Issue 不属于受支持的 Bug / Requirement 交付");
  if (issue.status !== "blocked" || md["finalize.pending"] || md["delivery.tfs_written"] === "true")
    throw new FailError("当前 Issue 状态不允许 PR 恢复");
  if (next !== "REWORK" && next !== "RECREATE_PR") throw new FailError("无效 PR 恢复方式");
  const comment = client.listComments(issueKey).find(c => c.id === commentId);
  if (!comment?.content?.trim() || comment.author_type !== "member" || !comment.author_id)
    throw new FailError("Human 决定须来自当前 Issue 的真实成员评论");
  const records = readPrRecords(md.pr), registered = records.filter(isRegisteredPr);
  let abandoned: Abandoned[];
  try {
    const value: unknown = JSON.parse(md["pr.abandoned"] ?? "[]");
    if (!Array.isArray(value) || value.some(a => !a || typeof a.repo_key !== "string" || !Number.isSafeInteger(a.pr_id) ||
        typeof a.event_key !== "string" || !a.event_key || !Number.isFinite(Date.parse(a.detected_at)))) throw new Error();
    abandoned = value as Abandoned[];
  } catch { throw new UnknownError("pr.abandoned 事实不可确认"); }
  const current = registered.filter(p => abandoned.some(a => a.repo_key === p.repo_key && a.pr_id === p.pr_id));
  // A single metadata update removes the old identity. Repeating it cannot remove a new PR.
  // No matching current PR is not evidence of authorization to change Issue status.
  if (!current.length) throw new UnknownError("没有当前已登记且确认 abandoned 的 PR；核对现有 PR Facts 与 Human 决定");
  if (bug && current.length !== registered.length)
    throw new FailError("Bug 存在尚未确认 abandoned 的 PR，须由 Human 处理混合 PR 集合");
  const at = Date.parse(comment.created_at ?? "");
  if (!Number.isFinite(at) || current.some(p => {
    const events = abandoned.filter(a => a.repo_key === p.repo_key && a.pr_id === p.pr_id);
    return events.length !== 1 || Date.parse(events[0].detected_at) > at;
  })) throw new UnknownError("Human Comment 早于当前 PR Abandoned 事件或事件不可确认");
  const tfsId = Number(md["tfs.id"]);
  if (!Number.isSafeInteger(tfsId) || tfsId <= 0 || current.some(p => p.source_branch !== candidateBranch(tfsId)))
    throw new FailError("当前 TFS / Candidate Branch 身份无效");
  if (next === "RECREATE_PR") {
    if (bug) {
      assertBugReadyForPr(md);
      for (const p of records) {
        const errors = validateBugEvidence(p, {issue: issueKey, tfsId, repoKey: p.repo_key, sha: p.candidate_commit}, false, true);
        if (errors.length) throw new FailError(errors.join("；"));
      }
    } else {
      if (md["analysis.gate.result"] !== "PASS") throw new FailError("Analysis Gate 未通过");
      readApprovedVerifyDecision(md);
      // Materialization still enforces the complete published Change and quality Gate.
    }
  }
  for (const pr of current) await verify(pr, next === "RECREATE_PR");
  const keys = ["tfs.type","tfs.id","tfs.url","analysis.source","analysis.human_approval","analysis.gate.result",
    "dev.publication","bug.required_repos","pr","pr.abandoned","finalize.pending","delivery.tfs_written"];
  const fresh = client.getIssue(issueKey);
  if (fresh.id !== issue.id || fresh.status !== "blocked" || fresh.assignee_id !== issue.assignee_id ||
      keys.some(k => fresh.metadata?.[k] !== md[k]))
    throw new UnknownError("PR 恢复期间 Issue 事实变化");
  const remaining = bug && next === "REWORK" ? [] : records.map(p => {
    if (!current.some(a => a.repo_key === p.repo_key && a.pr_id === p.pr_id)) return p;
    const prepared = withoutPrIdentity(p);
    if (next === "REWORK") {
      delete prepared.local_validation;
      delete prepared.code_review;
    }
    return prepared;
  });
  const nextPr = JSON.stringify(remaining);
  client.setMetadata(issue.id, "pr", nextPr);
  if (client.getIssue(issueKey).metadata?.pr !== nextPr)
    throw new UnknownError("PR 恢复事实未回读确认");
  return {result: "PASS", issue: issueKey, next, repo_keys: current.map(p => p.repo_key)};
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

export function registerPrResume(group: Command): void {
  group.command("resume").description("根据 Human 决定恢复 abandoned PR 的交付事实")
    .requiredOption("--issue <key>").requiredOption("--comment-id <id>")
    .requiredOption("--next <REWORK|RECREATE_PR>")
    .action(async (opts: {issue:string;commentId:string;next:Next}) => {
      markLeafExecuted();
      try {
        const result = await resumePr(new MulticaClient(resolveMulticaRuntime()), opts.issue, opts.commentId, opts.next);
        process.stdout.write(JSON.stringify(result)+"\n");
      } catch (e) {
        if (!(e instanceof FailError || e instanceof UnknownError)) throw e;
        process.stdout.write(JSON.stringify({result:e instanceof FailError?"FAIL":"UNKNOWN",reason:e.message})+"\n");
        throw new ExitSignal(e instanceof FailError?2:3);
      }
    });
}
