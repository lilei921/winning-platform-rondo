/** Deterministic Requirement authorization: approved Change, repo scope and Git source. */
import { FailError, UnknownError } from "../../cli/errors.js";
import type { BaseRegistryConfig } from "../../clients/config.js";
import { MulticaClient, type IssueRecord } from "../../clients/multica.js";
import { readAnalysisSource, readAnalysisArtifact, type AnalysisSource } from "../analysis/source.js";
import { parseRepositoryScope } from "../analysis/repository-scope.js";
import { readApprovedVerifyDecision } from "../delivery/verify-decision.js";

export interface ApprovedChange {
  issue: IssueRecord;
  source: AnalysisSource;
  scope: string[];
  tfsId: number;
  verifyRequired: boolean;
}

export function developmentPublication(md: Record<string, string>): { analysis_commit: string; commit: string } | undefined {
  if (md["dev.publication"] === undefined) return undefined;
  let receipt;
  try { receipt = JSON.parse(md["dev.publication"]); }
  catch { throw new UnknownError("dev.publication 不是合法 JSON"); }
  if (typeof receipt?.analysis_commit !== "string" || !/^[0-9a-f]{40}$/.test(receipt.analysis_commit) ||
      typeof receipt.commit !== "string" || !/^[0-9a-f]{40}$/.test(receipt.commit)) {
    throw new UnknownError("研发发布记录包含无效的 Commit SHA");
  }
  return receipt;
}

export function readDevelopmentCommit(md: Record<string, string>, source: AnalysisSource): string {
  const receipt = developmentPublication(md);
  if (!receipt || receipt.analysis_commit !== source.commit) {
    throw new UnknownError("当前批准版本缺少有效的研发发布记录，请执行 rondo dev publish");
  }
  return receipt.commit;
}

/** Native @Engineer Change delegation is authorized by the live Multica Run, not by dev.dispatch. */
export function assertEngineerExecution(multica: MulticaClient, issue: IssueRecord, workspaceId?: string): void {
  const taskId = process.env.MULTICA_TASK_ID;
  const agentId = process.env.MULTICA_AGENT_ID;
  const currentWorkspace = process.env.MULTICA_WORKSPACE_ID;
  if (!taskId || !agentId || !currentWorkspace || !process.env.MULTICA_TOKEN || !process.env.MULTICA_DAEMON_PORT) {
    throw new UnknownError("缺少当前 Multica Task / Actor / Workspace 上下文");
  }
  if (workspaceId && currentWorkspace !== workspaceId) throw new FailError("当前 Workspace 与 Registry 不一致");
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

export async function approvedChange(cfg: BaseRegistryConfig, multica: MulticaClient, issueRef: string, allowInReview = false): Promise<ApprovedChange> {
  const issue = multica.getIssue(issueRef), md = issue.metadata ?? {};
  // A completed Engineer Run is not active during read-only PR admission.
  if (!allowInReview) assertEngineerExecution(multica, issue, cfg.runtime.workspace_id);
  if (md["tfs.type"] !== "需求") throw new FailError("当前 Change 研发仅支持 TFS Requirement，Bug 使用原有入口");
  if (!(allowInReview ? ["todo", "in_progress", "in_review"] : ["todo", "in_progress"]).includes(issue.status ?? "")) throw new FailError("当前 Issue 状态不允许 Requirement 开工");
  if (md["analysis.gate.result"] !== "PASS") {
    throw new FailError("Analysis Gate 未通过");
  }
  if (md["dev.dispatch"] !== undefined) throw new FailError("Change 级 Engineer 不允许与旧 dev.dispatch 同时生效");
  if (md["finalize.pending"] || md["delivery.tfs_written"] === "true") throw new FailError("当前 Change 已进入收口，禁止写入");
  const tfsId = Number(md["tfs.id"]);
  if (!Number.isSafeInteger(tfsId) || tfsId <= 0) throw new FailError("TFS Requirement ID 非法");
  const source = readAnalysisSource(md);
  const decision = readApprovedVerifyDecision(md);
  if (md["verify_agent.required"] !== undefined && md["verify_agent.required"] !== String(decision.required)) {
    throw new FailError("verify_agent.required 与 Human Approval 冲突");
  }
  if (!multica.listComments(issue.identifier ?? issue.id).some(c => c.id === decision.commentRef)) {
    throw new FailError("批准评论未在当前 Issue 回读成功");
  }
  const approvedMetadata = await readAnalysisArtifact(source, ".openspec.yaml");
  const scope = parseRepositoryScope(approvedMetadata.content);
  for (const id of scope) {
    if (!cfg.registry || !Object.prototype.hasOwnProperty.call(cfg.registry, id)) {
      throw new FailError("批准的 Repository Scope 在 Registry 中不存在: " + id);
    }
  }
  return { issue, source, scope, tfsId, verifyRequired: decision.required };
}

export async function guardRepository(cfg: BaseRegistryConfig, multica: MulticaClient, issue: string, repo: string): Promise<ApprovedChange> {
  const change = await approvedChange(cfg, multica, issue);
  if (!change.scope.includes(repo)) throw new FailError("repo_id " + repo + " 超出批准的 Repository Scope");
  return change;
}
