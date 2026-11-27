/** Deterministic Requirement authorization: approved Change, repo scope and Git source. */
import { FailError, UnknownError } from "../../cli/errors.js";
import type { BaseRegistryConfig } from "../../clients/config.js";
import { MulticaClient, type IssueRecord } from "../../clients/multica.js";
import { gitOk } from "../../clients/git.js";
import { analysisArtifactPath, readAnalysisSource, readAnalysisArtifact, parseAnalysisSource, sameAnalysisSource, type AnalysisSource } from "../analysis/source.js";
import { parseRepositoryScope } from "../analysis/repository-scope.js";
import { readApprovedVerifyDecision } from "../delivery/verify-decision.js";

interface ApprovedIdentity {
  issue: IssueRecord;
  source: AnalysisSource;
  tfsId: number;
}
export interface ApprovedChange extends ApprovedIdentity { scope: string[] }

export function developmentPublication(md: Record<string, string>): { analysis_source: AnalysisSource; commit: string } | undefined {
  if (md["dev.publication"] === undefined) return undefined;
  let receipt;
  try { receipt = JSON.parse(md["dev.publication"]); }
  catch { throw new UnknownError("dev.publication 不是合法 JSON"); }
  if (typeof receipt?.commit !== "string" || !/^[0-9a-f]{40}$/.test(receipt.commit)) {
    throw new UnknownError("dev.publication 包含无效的 Commit SHA");
  }
  let source: AnalysisSource;
  try { source = parseAnalysisSource(receipt.analysis_source); }
  catch { throw new UnknownError("dev.publication 缺少有效的完整 Analysis Source，请核对交付事实"); }
  return { analysis_source: source, commit: receipt.commit };
}

export function readDevelopmentCommit(md: Record<string, string>, source: AnalysisSource): string {
  const receipt = developmentPublication(md);
  if (!receipt || !sameAnalysisSource(receipt.analysis_source, source)) {
    throw new UnknownError("当前批准版本缺少有效的研发发布记录，请执行 rondo dev publish");
  }
  return receipt.commit;
}

/** Native @Engineer Change delegation is authorized by the live Multica Run. */
export function assertEngineerExecution(multica: MulticaClient, issue: IssueRecord, workspaceId?: string): void {
  const taskId = process.env.MULTICA_TASK_ID;
  const agentId = process.env.MULTICA_AGENT_ID;
  const currentWorkspace = process.env.MULTICA_WORKSPACE_ID;
  if (!taskId || !agentId || !currentWorkspace || !process.env.MULTICA_TOKEN || !process.env.MULTICA_DAEMON_PORT) {
    throw new UnknownError("缺少当前 Multica Task / Actor / Workspace 上下文");
  }
  if (workspaceId && currentWorkspace !== workspaceId) throw new FailError("当前 Workspace 与执行环境不一致");
  const runs = multica.run(["issue", "runs", issue.id, "--active", ...multica.ws(), "--output", "json"],
    "核验当前 Engineer Run", { transient: true });
  if (!Array.isArray(runs)) throw new UnknownError("无法回读当前 Engineer 的活跃 Run");
  const matches = runs.filter(r => r?.id === taskId);
  if (matches.length !== 1) throw new UnknownError("当前 Task 不属于此 Issue 的唯一有效 Run");
  const current = matches[0];
  if (current.issue_id !== issue.id || current.agent_id !== agentId || current.workspace_id !== currentWorkspace ||
      current.status !== "running") throw new FailError("当前 Task / Issue / Actor / Workspace / Run 身份不一致");
  const agent = multica.run(["agent", "get", agentId, ...multica.ws(), "--output", "json"],
    "回读 Engineer Agent 身份", { transient: true }) as {id?:string;name?:string};
  if (agent?.id !== agentId || agent?.name !== "Engineer") throw new FailError("当前执行者不是已登记的 Engineer Agent");
}

/** A Native caller has already confirmed the root identity. */
interface ApprovedCheckout {
  root: string;
  source: AnalysisSource;
}

/** Use the available fixed Git object; callers without a prepared object use the pinned TFS read. */
export async function readApprovedRepositoryScope(source: AnalysisSource, local?: ApprovedCheckout,
  readRemote = readAnalysisArtifact): Promise<string[]> {
  if (!local) return parseRepositoryScope((await readRemote(source, ".openspec.yaml")).content);
  if (!sameAnalysisSource(source, local.source)) throw new UnknownError("批准来源在读取本地 Scope 前变化");
  const path = analysisArtifactPath(source, ".openspec.yaml").slice(1);
  return parseRepositoryScope(gitOk(local.root, ["show", source.commit + ":" + path], "读取批准版 Repository Scope"));
}

export function approvedIdentity(cfg: BaseRegistryConfig, multica: MulticaClient, issueRef: string, allowInReview = false): ApprovedIdentity {
  const issue = multica.getIssue(issueRef), md = issue.metadata ?? {};
  // A completed Engineer Run is not active during read-only PR admission.
  if (!allowInReview) assertEngineerExecution(multica, issue, cfg.runtime.workspace_id);
  if (md["tfs.type"] !== "需求") throw new FailError("当前 Change 研发仅支持 TFS Requirement，Bug 使用原有入口");
  if (!(allowInReview ? ["todo", "in_progress", "in_review"] : ["todo", "in_progress"]).includes(issue.status ?? "")) throw new FailError("当前 Issue 状态不允许 Requirement 开工");
  if (md["analysis.gate.result"] !== "PASS") {
    throw new FailError("Analysis Gate 未通过");
  }
  if (md["finalize.pending"] || md["delivery.tfs_written"] === "true") throw new FailError("当前 Change 已进入收口，禁止写入");
  const tfsId = Number(md["tfs.id"]);
  if (!Number.isSafeInteger(tfsId) || tfsId <= 0) throw new FailError("TFS Requirement ID 非法");
  const source = readAnalysisSource(md);
  const decision = readApprovedVerifyDecision(md);
  if (!multica.listComments(issue.identifier ?? issue.id).some(c => c.id === decision.commentRef)) {
    throw new FailError("批准评论未在当前 Issue 回读成功");
  }
  return { issue, source, tfsId };
}

export async function approvedChange(cfg: BaseRegistryConfig, multica: MulticaClient, issueRef: string, allowInReview = false,
  local?: ApprovedCheckout): Promise<ApprovedChange> {
  const approved = approvedIdentity(cfg, multica, issueRef, allowInReview);
  return { ...approved, scope: await readApprovedRepositoryScope(approved.source, local) };
}

export async function guardRepository(cfg: BaseRegistryConfig, multica: MulticaClient, issue: string, repo: string,
  local?: ApprovedCheckout): Promise<ApprovedChange> {
  const change = await approvedChange(cfg, multica, issue, false, local);
  if (!change.scope.includes(repo)) throw new FailError("repo_id " + repo + " 超出批准的 Repository Scope");
  return change;
}
