import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { markLeafExecuted } from "../../cli/output.js";
import { MulticaClient } from "../../clients/multica.js";
import { resolveMulticaRuntime } from "../../clients/runtime-context.js";
import { parseAnalysisSource, readAnalysisArtifact, readAnalysisSource, sameAnalysisSource } from "./source.js";
import { readApprovedVerifyDecision, parseWaivedTasks } from "../delivery/verify-decision.js";
import { readTaskProgress, assertWaiverRefs } from "../openspec/change-completion.js";

interface ApprovalArgs {
  issue: string;
  commentId: string;
  commit: string;
  verifyRequired: string;
  waiveTasks?: string;
}
type ApprovalClient = Pick<MulticaClient, "getIssue" | "listComments" | "setMetadata" | "setStatusNoStart">;

const APPROVAL = "analysis.human_approval";
const FACTS = ["tfs.type", "tfs.id", "analysis.gate.result",
  "analysis.source", APPROVAL, "finalize.pending", "delivery.tfs_written"];

/** Lead interprets the Human decision; CLI records and validates its exact source. */
export async function recordApproval(client: ApprovalClient, args: ApprovalArgs, readArtifact = readAnalysisArtifact) {
  if (!/^[0-9a-f]{40}$/.test(args.commit) || !["true", "false"].includes(args.verifyRequired) ||
      !args.commentId.trim()) throw new FailError("需要完整获批 Commit、批准评论 ID 和明确的独立验收决定");
  const issue = client.getIssue(args.issue);
  const md = issue.metadata ?? {};
  if (issue.parent_issue_id || md["tfs.type"] !== "需求" ||
      !["analysis_review", "todo", "in_progress"].includes(issue.status ?? "")) {
    throw new FailError("当前 Issue 不是可登记批准的 Requirement");
  }
  if (md["analysis.gate.result"] !== "PASS" ||
      md["finalize.pending"] || md["delivery.tfs_written"] === "true") {
    throw new FailError("Analysis Gate 未通过或存在不允许批准的交付事实");
  }
  const tfsId = Number(md["tfs.id"]);
  if (!Number.isSafeInteger(tfsId) || tfsId <= 0) throw new FailError("TFS Requirement ID 非法");
  const source = readAnalysisSource(md);
  if (source.commit !== args.commit) throw new FailError("获批 Commit 与当前 analysis.source 不一致");
  const required = args.verifyRequired === "true";
  const requested = args.waiveTasks === undefined ? [] : args.waiveTasks.split(",").map(ref => ref.trim());
  if (requested.some(ref => !/^\d+(?:\.\d+)*$/.test(ref))) throw new FailError("--waive-tasks 必须是逗号分隔的有效任务编号");
  const waivedTasks = [...new Set(requested)].sort();
  const key = issue.identifier ?? issue.id;
  const comment = client.listComments(key).find(c => c.id === args.commentId);
  if (!comment?.content?.trim() || comment.author_type !== "member" || !comment.author_id) {
    throw new FailError("批准依据必须是当前 Issue 的真实成员评论");
  }
  const at = comment.created_at;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) throw new UnknownError("无法确认批准评论时间");
  const approval = { decision: "approved", by: comment.author_id, at: new Date(at).toISOString(),
    comment_ref: args.commentId, verify_agent_required: required, source,
    ...(waivedTasks.length ? { waived_tasks: waivedTasks } : {}) };
  let saved = JSON.stringify(approval);
  let alreadyRecorded = false;
  if (md[APPROVAL] !== undefined) {
    let prior;
    try { prior = JSON.parse(md[APPROVAL]); }
    catch { throw new UnknownError("已有批准记录无法解析"); }
    if (!prior || typeof prior !== "object" || typeof prior.comment_ref !== "string" ||
        typeof prior.at !== "string" || Number.isNaN(Date.parse(prior.at))) {
      throw new UnknownError("已有批准记录不完整");
    }
    const priorSource = parseAnalysisSource(prior.source);
    if (prior.comment_ref === args.commentId) {
      if (!sameAnalysisSource(priorSource, source) || prior.verify_agent_required !== required ||
          prior.by !== approval.by || Date.parse(prior.at) !== Date.parse(approval.at) ||
          JSON.stringify(parseWaivedTasks(prior.waived_tasks)) !== JSON.stringify(waivedTasks)) {
        throw new FailError("同一批准评论不得改变已登记的决定或版本");
      }
      readApprovedVerifyDecision(md, args.commentId);
      saved = md[APPROVAL];
      alreadyRecorded = true;
    } else {
      if (Date.parse(approval.at) <= Date.parse(prior.at)) throw new FailError("不得用更早的批准覆盖现有决定");
      if (!sameAnalysisSource(priorSource, source) && issue.status !== "analysis_review") {
        throw new FailError("变更批准版本必须重新进入分析审核");
      }
    }
  }
  // A recorded decision already passed the pinned task-reference check.
  if (waivedTasks.length && !alreadyRecorded) {
    const artifact = await readArtifact(source, "tasks.md");
    assertWaiverRefs(readTaskProgress(artifact.content), waivedTasks);
  }
  const expected = {...md};
  let status = issue.status;
  const fresh = () => {
    const latest = client.getIssue(key);
    if (latest.id !== issue.id || latest.status !== status ||
        FACTS.some(k => latest.metadata?.[k] !== expected[k])) {
      throw new UnknownError("批准登记期间 Issue 状态或交付事实变化，请重新核对");
    }
    return latest;
  };
  // Validate the exact record with the same reader used by downstream gates.
  readApprovedVerifyDecision({...md, [APPROVAL]: saved}, args.commentId);
  let changed = false;
  fresh();
  if (expected[APPROVAL] !== saved) {
    client.setMetadata(issue.id, APPROVAL, saved);
    expected[APPROVAL] = saved;
    changed = true;
  }
  readApprovedVerifyDecision(fresh().metadata ?? {}, args.commentId);
  if (status === "analysis_review") {
    client.setStatusNoStart(issue.id, "in_progress");
    status = "in_progress";
    changed = true;
    fresh();
  }
  return { result: changed ? "PASS" : "NOOP", issue: key, status,
    change_ref: source.change_ref, commit: source.commit, comment_ref: args.commentId,
    verify_agent_required: required, waived_tasks: waivedTasks };
}

export function registerAnalysisApprove(group: Command): void {
  group.command("approve").description("登记已确认的人工批准及独立验收决定")
    .addHelpText("after", "\n登记批准后不启动 Run。")
    .requiredOption("--issue <key>", "当前 Requirement Issue")
    .requiredOption("--comment-id <id>", "Human 批准评论 ID")
    .requiredOption("--commit <sha>", "Human 获批完整 Commit")
    .requiredOption("--verify-required <boolean>", "明确的独立验收决定 true|false")
    .option("--waive-tasks <refs>", "Human 明确批准豁免的全部任务编号，逗号分隔；省略表示无豁免")
    .action(async (args: ApprovalArgs) => {
      markLeafExecuted();
      try {
        const result = await recordApproval(new MulticaClient(resolveMulticaRuntime()), args);
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } catch (err) {
        const failed = err instanceof FailError;
        process.stdout.write(JSON.stringify({ result: failed ? "FAIL" : "UNKNOWN",
          reason: err instanceof Error ? err.message : String(err) }, null, 2) + "\n");
        process.exitCode = failed ? 2 : 3;
      }
    });
}
