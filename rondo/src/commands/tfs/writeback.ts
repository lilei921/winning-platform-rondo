import { deliveryCommentReference, readTfsHistory, hasDeliveryComment } from "./delivery-comment.js";
/**
 * TFS Writeback: PR 已完成且 Delivery Prepare 确认后执行。
 * 新 Change-level Requirement: inspect → Agent task plan → 确定性校验
 * → 稳定身份创建/恢复 1–5 个 TFS Task → 独占业务 Commit 关联双向回核
 * → 核对工时与任务状态 → 父需求收口。
 * Direct Bug 跳过子任务。
 * FAIL/UNKNOWN 均阻断 Complete；外部 TFS 写入不盲目重试。
 */

import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { resolveMulticaRuntime, type MulticaRuntime } from "../../clients/runtime-context.js";
import { MulticaClient, type IssueRecord } from "../../clients/multica.js";
import { TfsClient } from "../../clients/tfs.js";
import { resolveRuntimePaths, type RuntimePaths } from "../../clients/runtime-paths.js";
import { resolveChangeDir } from "../delivery/finalize.js";
import type { VerifiedCloseoutPr } from "../delivery/closeout-pr.js";
import { isRequirementChangeDelivery } from "../delivery/requirement-mode.js";
import { validateRequirementTaskPlan, ensurePlannedDeliveryTasks, findExistingPlannedTasks,
  type RequirementTaskPlan } from "./requirement-tasks.js";
import { inspectRequirementCommits, currentCommitOwners, type AvailableCommit } from "./requirement-commits.js";
import { TfsClient as TfsApiClient } from "../../tfs/client.js";
import { hasExactArtifactLink } from "../../tfs/api/commit-facts.js";
import { commitKey, parseCommitArtifact } from "../../tfs/api/commit-identity.js";
import { readAnalysisSource } from "../analysis/source.js";
import { isDirectBugDelivery, assertBugFinalizationFacts, bugDeliveryDigest } from "../bug/finalize-facts.js";
import { verifyCloseoutRoot, confirmPublishedArchive, assertCloseoutChange } from "../delivery/closeout-root.js";
interface TfsWorkItem {
  id: number;
  title?: string | null;
  project?: string | null;
  parentId?: number | null;
  state?: string | null;
  originalEstimate?: number | null;
  remainingWork?: number | null;
  completedWork?: number | null;
  type?: string | null;
  fields?: Record<string, unknown>;
  artifactLinks?: string[];
  childIds?: number[];
}

function log(msg: string): void { process.stderr.write(msg + "\n"); }

export class Clients {
  private multica: MulticaClient;
  private tfs: TfsClient;
  constructor(runtime: MulticaRuntime) {
    this.multica = new MulticaClient(runtime);
    this.tfs = new TfsClient();
  }

  getIssue(issueKey: string): IssueRecord {
    return this.multica.getIssue(issueKey);
  }

  setMetadata(issueId: string, key: string, value: string): void {
    this.multica.setMetadata(issueId, key, value);
  }

  async tfsQuery(wiql: string, what: string): Promise<TfsWorkItem[]> {
    const out = await this.tfs.run(["query", "--wiql", wiql], what);
    if (!Array.isArray(out)) throw new UnknownError(`${what} 输出不是数组`);
    return out as TfsWorkItem[];
  }

  async tfsCreateTask(opts: { title: string; parent: number; project?: string | null; descriptionFile: string; estimate?: number }): Promise<TfsWorkItem> {
    const cmd = ["workitem", "create", "--type", "任务",
      "--title", opts.title, "--parent", String(opts.parent), "--description-file", opts.descriptionFile];
    if (opts.estimate !== undefined) cmd.push("--estimate", String(opts.estimate));
    if (opts.project) cmd.push("--project", opts.project);
    const out = await this.tfs.run(cmd, `创建 TFS 任务(parent=${opts.parent}, title=${opts.title})`) as TfsWorkItem;
    if (!out?.id) throw new UnknownError("创建 TFS 任务返回缺少 id（结果未知，勿盲目重建——重跑经标题前缀认领）");
    return out;
  }

  async tfsSetState(id: number, state: string, completeWithEstimate = false): Promise<{ via?: string[]; estimateMissing?: boolean }> {
    const cmd = ["workitem", "set-state", "--id", String(id), "--state", state];
    if (completeWithEstimate) cmd.push("--complete-with-estimate");
    const out = await this.tfs.run(cmd, `置 TFS 工作项 ${id} 状态为 ${state}`) as { via?: string[]; estimateMissing?: boolean };
    return out ?? {};
  }

  async tfsComment(id: number, textFile: string): Promise<void> {
    const result = await this.tfs.run(["workitem", "comment", "--id", String(id), "--text-file", textFile], `TFS 工作项 ${id} 评论`) as { commentAdded?: boolean };
    if (result?.commentAdded !== true) throw new UnknownError("TFS 评论写入未确认");
  }

  /** commit 关联：失败（含 exit 2 部分失败与 UNKNOWN）一律上抛，由调用方记 commit_link_failed（不阻断）。 */
  async tfsLinkCommits(id: number, repo: string, shas: string[], project?: string): Promise<{ linked?: string[]; skipped?: string[]; failed?: Array<{ sha: string; error: string }> }> {
    const cmd = ["workitem", "link-commits", "--id", String(id), "--repo", repo, "--sha", shas.join(",")];
    if (project) cmd.push("--project", project);
    return await this.tfs.run(cmd, `TFS 工作项 ${id} 关联 ${shas.length} 个 commit`) as { linked?: string[]; skipped?: string[]; failed?: Array<{ sha: string; error: string }> };
  }
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { out[key] = next; i++; }
      else out[key] = true;
    }
  }
  return out;
}

export const TASK_TARGET_STATE = "已关闭";

function parentTargetState(md: Record<string, string>): string {
  return isDirectBugDelivery(md) ? "活动" : "已解决";
}

export async function writebackParent(clients: Pick<Clients, "tfsQuery" | "tfsSetState" | "tfsComment" | "setMetadata">, issue: IssueRecord, issueKey: string, md: Record<string, string>, tfsId: number, readHistory = readTfsHistory): Promise<Record<string, unknown>> {
  const targetState = parentTargetState(md);
  if (md["delivery.tfs_written"] === "true") {
    const actual = await clients.tfsQuery(`SELECT [System.Id] FROM WorkItems WHERE [System.Id] = ${tfsId}`, "回读已登记 TFS 父项");
    if (actual.length !== 1 || actual[0].state !== targetState) {
      throw new UnknownError(`delivery.tfs_written 已登记但 TFS 父项未确认${targetState}，拒绝复用过期标记`);
    }
    return { status: "skipped", note: "delivery.tfs_written 已置位，父项实际状态已回读" };
  }
  const reference = deliveryCommentReference(issue);
  const legacy = `交付完成（Multica ${issueKey}）`;
  const exists = hasDeliveryComment(await readHistory(tfsId), reference, legacy);
  const stateOut = await clients.tfsSetState(tfsId, targetState);
  if (!exists) {
    const commentFile = join(tmpdir(), `writeback-tfs-comment-${process.pid}.md`);
    const content = isDirectBugDelivery(md)
      ? `${legacy}：Bug 修复 PR 已合并，验证与代码审查证据见 Multica pr。`
      : `${legacy}：PR 已合并，OpenSpec Change \`${readAnalysisSource(md).change_ref}\` 已归档。详见 Delivery Issue 摘要评论。`;
    writeFileSync(commentFile, content + "\n\n" + reference, "utf8");
    try { await clients.tfsComment(tfsId, commentFile); }
    finally { try { unlinkSync(commentFile); } catch { /* 保留外部成功事实，下次回读。 */ } }
    if (!hasDeliveryComment(await readHistory(tfsId), reference, legacy)) throw new UnknownError("TFS 评论成功响应后未回读到本次引用");
  }
  clients.setMetadata(issue.id, "delivery.tfs_written", "true");
  return { status: "done", state: targetState, ...(stateOut.via?.length ? { via: stateOut.via } : {}), comment: true };
}

/** 只读后置条件：核对 TFS 外部真实状态，不创建任务、不更新工时/状态、不追加评论。 */
export async function verifyTfsWriteback(runtime: MulticaRuntime, issue: IssueRecord, rootRepo?: string, verified?: VerifiedCloseoutPr[]): Promise<Record<string, unknown>> {
  const md = issue.metadata ?? {};
  if (md["delivery.tfs_written"] !== "true") {
    throw new UnknownError("未确认 TFS Writeback 完成，拒绝 Issue done");
  }
  const tfsId = Number(md["tfs.id"]);
  if (!Number.isInteger(tfsId) || tfsId <= 0) throw new FailError("TFS 父项身份无效");
  const tfsType = md["tfs.type"];
  if (!isDirectBugDelivery(md) && !isRequirementChangeDelivery(md)) throw new FailError("仅支持 Change-level Requirement 和 Direct Bug Closeout");
  const clients = new Clients(runtime);
  const parent = await clients.tfsQuery(
    `SELECT [System.Id] FROM WorkItems WHERE [System.Id] = ${tfsId}`, "核对 TFS 父项实际完成状态",
  );
  const targetState = parentTargetState(md);
  if (parent.length !== 1 || parent[0].id !== tfsId || parent[0].state !== targetState) {
    throw new UnknownError(`TFS 父项 ${tfsId} 当前未确认${targetState}；不可仅凭 delivery.tfs_written 完成 Multica Issue`);
  }
  if (isDirectBugDelivery(md)) return { parent: tfsId, parent_state: parent[0].state, tasks: "skipped_bug" };

  if (isRequirementChangeDelivery(md)) {
    const saved = parseStoredTaskPlan(md["delivery.tfs_task_plan"], "delivery.tfs_task_plan");
    if (!saved) throw new FailError("新 Requirement 缺少已确认的 TFS 子任务计划");
    if (!rootRepo) throw new UnknownError("Complete 缺少已核验的根仓，不能证明业务 Commit 来源");
    const api = new TfsApiClient();
    const snapshot = await inspectRequirementCommits(md, rootRepo, api, undefined, verified);
    const plan = validateRequirementTaskPlan(saved, snapshot.approvedTasks, snapshot.commits);
    const ids = await findExistingPlannedTasks(clients, issue.identifier ?? issue.id,
      readAnalysisSource(md).change_ref, tfsId, plan);
    if (ids.some(id => id === null)) throw new UnknownError("已登记 TFS 计划存在未创建的子任务");
    await verifyPlannedTaskFacts(clients, api, plan, ids as number[], snapshot.commits, true);
    const commentRef = deliveryCommentReference(issue);
    if (!hasDeliveryComment(await readTfsHistory(tfsId), commentRef,
      `交付完成（Multica ${issue.identifier ?? issue.id}）`)) {
      throw new UnknownError("TFS 父需求收口评论尚未回读确认，不能完成 Issue");
    }
    return { parent: tfsId, parent_state: parent[0].state, tasks: ids,
      commit_links: "verified_exclusive", estimates: "verified", comment: "verified" };
  }
  throw new FailError("仅支持 Change-level Requirement 和 Direct Bug Closeout");
}

interface PlannedWritebackOptions { inspect?: boolean; taskPlan?: unknown }

function parseStoredTaskPlan(raw: string | undefined, label: string): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch { throw new UnknownError(`${label} 不是合法 JSON`); }
}

function approvedTaskPlan(
  input: unknown, stored: unknown, approvedTasks: string, commits: AvailableCommit[],
): RequirementTaskPlan {
  const commitRefs = commits.map(c => ({ repo_key: c.repo_key, sha: c.sha }));
  if (!input && !stored) throw new FailError("新 Requirement 首次回写必须提供 --task-plan，禁止默认创建泛化任务");
  const selected = validateRequirementTaskPlan(input ?? stored, approvedTasks, commitRefs);
  if (stored) {
    const previous = validateRequirementTaskPlan(stored, approvedTasks, commitRefs);
    if (JSON.stringify(previous) !== JSON.stringify(selected)) {
      throw new FailError("已保存的 delivery.tfs_task_plan 与新计划不一致，不允许自动覆盖");
    }
  }
  return selected;
}

function commitByRef(commits: AvailableCommit[]): Map<string, AvailableCommit> {
  return new Map(commits.map(c => [c.repo_key + "/" + c.sha, c]));
}

/** No TFS side effects: read back each planned Task, estimates, and every direct + reverse Commit link. */
async function verifyPlannedTaskFacts(
  clients: Clients, api: TfsApiClient, plan: RequirementTaskPlan,
  ids: number[], commits: AvailableCommit[], completed: boolean,
): Promise<void> {
  if (ids.length !== plan.tasks.length || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new UnknownError("计划 TFS Task 数量或身份不可信");
  }
  const readback = await clients.tfsQuery(
    `SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (${ids.join(",")})`, "回读规划 TFS 子任务与工时",
  );
  const byId = new Map(readback.map(item => [item.id, item]));
  if (byId.size !== ids.length) throw new UnknownError("规划 TFS 子任务回读不完整");
  const byCommit = commitByRef(commits);
  for (let i = 0; i < ids.length; i++) {
    const task = byId.get(ids[i]);
    if (!task || (task.type !== "任务" && task.type !== "Task") ||
        task.originalEstimate !== plan.tasks[i].estimate_hours) {
      throw new FailError(`TFS Task ${ids[i]} 的类型或 OriginalEstimate 与计划不一致`);
    }
    if (completed && (task.state !== TASK_TARGET_STATE || task.remainingWork !== 0 ||
        task.completedWork !== plan.tasks[i].estimate_hours)) {
      throw new UnknownError(`TFS Task ${ids[i]} 未确认${TASK_TARGET_STATE}或工时未完全落库`);
    }
    // A planned Task must not silently carry an unrelated/manual business Commit.
    const allowed = new Set(plan.tasks[i].commits.map(ref => {
      const verified = byCommit.get(ref.repo_key + "/" + ref.sha);
      if (!verified) throw new FailError("计划引用了未核实的 PR Commit");
      return commitKey(verified);
    }));
    if (!Array.isArray(task.artifactLinks)) throw new UnknownError("TFS Task Commit ArtifactLink 回读缺失");
    for (const url of task.artifactLinks) {
      let identity;
      try { identity = parseCommitArtifact(url); }
      catch { throw new UnknownError(`TFS Task ${ids[i]} 包含身份不可信的 Commit ArtifactLink`); }
      if (!identity || !allowed.has(commitKey(identity))) {
        throw new FailError(`TFS Task ${ids[i]} 包含计划外业务 Commit，禁止收口`);
      }
    }
    for (const assigned of plan.tasks[i].commits) {
      const commit = byCommit.get(assigned.repo_key + "/" + assigned.sha);
      if (!commit) throw new FailError("计划引用了未核实的 PR Commit");
      if (!hasExactArtifactLink(task.artifactLinks, commit)) {
        throw new UnknownError(`TFS Task ${ids[i]} 缺少准确的 Commit ArtifactLink: ${commit.sha}`);
      }
      const owners = await currentCommitOwners(api, commit);
      if (owners.length !== 1 || owners[0] !== ids[i]) {
        throw new UnknownError(`Commit ${commit.sha} 的全局 TFS Task 归属冲突或回读不可信: ${owners.join(",")}`);
      }
    }
  }
}

/** Only new Change-level Requirements use planned Task ownership. */
async function executePlannedRequirement(
  clients: Clients, issue: IssueRecord, issueKey: string,
  md: Record<string,string>, tfsId: number, rootRepo: string, opts: PlannedWritebackOptions,
): Promise<Record<string,unknown>> {
  const api = new TfsApiClient();
  const snapshot = await inspectRequirementCommits(md, rootRepo, api);
  if (opts.inspect) return {
    mode: "inspect", approved_tasks_source: "analysis.source.commit", approved_tasks: snapshot.approvedTasks,
    commits: snapshot.commits,
    available_unique_commits: snapshot.commits.filter(c => !c.owners.length).length,
    saved_plan: Boolean(md["delivery.tfs_task_plan"]),
  };
  const stored = parseStoredTaskPlan(md["delivery.tfs_task_plan"], "delivery.tfs_task_plan");
  const plan = approvedTaskPlan(opts.taskPlan, stored, snapshot.approvedTasks, snapshot.commits);
  const latestIssue = clients.getIssue(issueKey);
  const fresh = latestIssue.metadata ?? {};
  if (fresh["finalize.pending"] !== md["finalize.pending"] ||
      fresh["analysis.source"] !== md["analysis.source"] ||
      fresh["pr"] !== md["pr"] ||
      fresh["tfs.id"] !== md["tfs.id"]) {
    throw new UnknownError("收口期间 Issue 事实发生变化，停止外部 TFS 写入");
  }
  const prior = parseStoredTaskPlan(fresh["delivery.tfs_task_plan"], "delivery.tfs_task_plan");
  approvedTaskPlan(plan, prior, snapshot.approvedTasks, snapshot.commits);
  const existing = await findExistingPlannedTasks(clients, issueKey, readAnalysisSource(md).change_ref, tfsId, plan);
  // Recheck Commit ownership immediately before creating any TFS Task.
  for (let i = 0; i < plan.tasks.length; i++) for (const ref of plan.tasks[i].commits) {
    const commit = commitByRef(snapshot.commits).get(ref.repo_key + "/" + ref.sha)!;
    const owners = await currentCommitOwners(api, commit);
    if (owners.length > 1 || (owners.length === 1 && owners[0] !== existing[i])) {
      throw new FailError(`Commit ${commit.repo_key}/${commit.sha} 已归属其他 TFS Task: ${owners.join(",")}`);
    }
  }
  if (!prior) {
    clients.setMetadata(issue.id, "delivery.tfs_task_plan", JSON.stringify(plan));
    const saved = clients.getIssue(issueKey).metadata?.["delivery.tfs_task_plan"];
    if (saved !== JSON.stringify(plan)) throw new UnknownError("任务计划未回读确认；禁止创建 TFS Task");
  }
  const materialized = await ensurePlannedDeliveryTasks(clients, issueKey, readAnalysisSource(md).change_ref, tfsId, plan);
  const byCommit = commitByRef(snapshot.commits);
  for (let i = 0; i < plan.tasks.length; i++) for (const ref of plan.tasks[i].commits) {
    const commit = byCommit.get(ref.repo_key + "/" + ref.sha)!;
    const taskId = materialized.ids[i];
    const readback = await clients.tfsQuery(
      `SELECT [System.Id] FROM WorkItems WHERE [System.Id] = ${taskId}`, "核对当前 TFS Task Commit 关系",
    );
    if (readback.length !== 1 || readback[0].id !== taskId) throw new UnknownError("TFS Task 不可读");
    if (!hasExactArtifactLink(readback[0].artifactLinks, commit)) {
      // Never broadcast an entire Change commit list to every Task.
      const linked = await clients.tfsLinkCommits(taskId, commit.repoId, [commit.sha], commit.projectId);
      if (linked?.failed?.length || !(linked?.linked?.includes(commit.sha) || linked?.skipped?.includes(commit.sha))) {
        throw new UnknownError(`Commit ${commit.sha} 关联至 Task ${taskId} 未确认`);
      }
    }
    // A write response alone is not proof: verify both directions before any Task state transition.
    const confirmed = await clients.tfsQuery(
      `SELECT [System.Id] FROM WorkItems WHERE [System.Id] = ${taskId}`, "核对 Commit ArtifactLink",
    );
    if (confirmed.length !== 1 || !hasExactArtifactLink(confirmed[0].artifactLinks, commit)) {
      throw new UnknownError("TFS Commit ArtifactLink 写入后回读不可信");
    }
    const owners = await currentCommitOwners(api, commit);
    if (owners.length !== 1 || owners[0] !== taskId) {
      throw new UnknownError(`Commit ${commit.sha} 存在外部 Task 竞争或反向回读不可信`);
    }
  }
  await verifyPlannedTaskFacts(clients, api, plan, materialized.ids, snapshot.commits, false);
  for (const id of materialized.ids) {
    const result = await clients.tfsSetState(id, TASK_TARGET_STATE, true);
    if (result.estimateMissing) throw new UnknownError(`TFS Task ${id} 缺少 OriginalEstimate`);
  }
  await verifyPlannedTaskFacts(clients, api, plan, materialized.ids, snapshot.commits, true);
  const parent = await writebackParent(clients, issue, issueKey, md, tfsId);
  return { tasks_materialized: materialized, tasks_resolved: materialized.ids,
    commit_links: "verified_exclusive", parent_writeback: parent };
}

/** 核心流程（commander 包装与 finalize 共用）：硬失败上抛 FailError/UnknownError，返回各步明细。 */
export async function executeWriteback(runtime: MulticaRuntime, issue: IssueRecord, paths: RuntimePaths | null, opts: PlannedWritebackOptions = {}): Promise<Record<string, unknown>> {
  const clients = new Clients(runtime);
  const issueKey = issue.identifier ?? issue.id;
  const md = issue.metadata ?? {};
  const detail: Record<string, unknown> = { issue: issueKey };
  if (!isDirectBugDelivery(md) && !isRequirementChangeDelivery(md)) throw new FailError("仅支持 Change-level Requirement 和 Direct Bug Closeout");
  if (issue.status === "blocked") throw new FailError("Issue blocked，禁止 TFS Writeback");

  // D3-B：TFS Work Item/Task 管理只允许在 Delivery Prepare 已确认 PR、工程和归档后执行。
  // 不根据任意调用方的声称直接进行外部写入；准备失败或结果未知时保持零 TFS 副作用。
  if (!md["finalize.pending"]) {
    throw new FailError("TFS Writeback 必须在 delivery finalize --phase prepare 登记 finalize.pending 后执行");
  }
  // Bug mode consumes the existing Delivery Prepare marker, without requiring
  // an OpenSpec Change or a local root repository on the external TFS writer.
  let pending: { prepared_change_ref?: unknown; prepared_kind?: unknown; prepared_bug_digest?: unknown };
  try { pending = JSON.parse(md["finalize.pending"]) as typeof pending; }
  catch { throw new UnknownError("finalize.pending 无法解析，不能执行外部 TFS 写入"); }
  if (isDirectBugDelivery(md)) {
    assertBugFinalizationFacts(md, issue.status);
    if (pending.prepared_kind !== "bug" || pending.prepared_bug_digest !== bugDeliveryDigest(md)) {
      throw new FailError("Bug TFS Writeback 必须等待有效的 Bug Delivery Prepare");
    }
  } else {
    const preparedChange = readAnalysisSource(md).change_ref;
    if (!paths || !preparedChange || !pending || pending.prepared_change_ref !== preparedChange ||
        !resolveChangeDir(paths, preparedChange).archived) {
      throw new FailError("TFS Writeback 必须等待 Prepare 的 Archive / Git Push 已确认，禁止仅凭 pending 或本地归档执行");
    }
    confirmPublishedArchive(paths, readAnalysisSource(md));
  }

  const tfsIdRaw = md["tfs.id"];
  const tfsId = tfsIdRaw ? Number(tfsIdRaw) : NaN;
  if (!tfsIdRaw || !Number.isInteger(tfsId) || tfsId <= 0) {
    throw new FailError(`metadata tfs.id 缺失或不是正整数: ${tfsIdRaw ?? "(缺失)"}`);
  }
  detail.parent = tfsId;

  const tfsType = typeof md["tfs.type"] === "string" ? (md["tfs.type"] as string) : "";
  detail.tfs_type = tfsType || null;
  if (tfsType !== "需求" && tfsType !== "Bug") {
    throw new UnknownError(`Issue ${issueKey} metadata tfs.type 缺失或不是 需求/Bug: ${tfsType || "(缺失)"}——交 Lead 核对来源同步`);
  }

  const requirementChange = isRequirementChangeDelivery(md);

  if (isDirectBugDelivery(md)) {
    if (opts.inspect || opts.taskPlan !== undefined) throw new FailError("Bug 不接受任务规划参数");
    detail.tasks = "skipped_bug";
    detail.commit_links = "skipped_bug";
  } else if (requirementChange) {
    if (!paths) throw new FailError("Requirement TFS Writeback 缺少 OpenSpec 根仓");
    const changeRef = readAnalysisSource(md).change_ref;
    if (!changeRef) throw new FailError("Change 身份缺失");
    resolveChangeDir(paths, changeRef);
    return { ...detail, ...await executePlannedRequirement(clients, issue, issueKey, md, tfsId, paths.rootRepo, opts) };
  }

  // 4. 父项回写（Bug 与 需求 共用；子任务全部关闭后才到这一步）
  detail.parent_writeback = await writebackParent(clients, issue, issueKey, md, tfsId);

  return detail;
}

async function main(rawArgs: string[]): Promise<number> {
  const args = parseArgs(rawArgs);
  if (typeof args.issue !== "string" || !args.issue ||
      rawArgs.some(arg => arg === "--config" || arg.startsWith("--config="))) {
    process.stderr.write("用法: rondo tfs writeback --issue <KEY> [--root-repo <path>] [--inspect | --task-plan <plan.json>]\n");
    return 64;
  }
  try {
    const runtime = resolveMulticaRuntime();
    const client = new MulticaClient(runtime);
    const issue = client.getIssue(args.issue);
    const md = issue.metadata ?? {};
    const bug = isDirectBugDelivery(md);
    if (!bug && !isRequirementChangeDelivery(md)) throw new FailError("仅支持 Change-level Requirement 和 Direct Bug Closeout");
    if (!bug && typeof args["root-repo"] !== "string") throw new UnknownError("Requirement TFS Writeback 必须显式使用同组 --root-repo");
    const paths = bug ? null : resolveRuntimePaths({ runtime }, { issue, rootRepoArg: args["root-repo"] as string, need: ["openspec"] });
    if (paths) {
      const source = readAnalysisSource(md);
      Object.assign(paths, verifyCloseoutRoot(paths, source));
      assertCloseoutChange(paths, source);
    }
    if (args.inspect && args["task-plan"]) throw new FailError("--inspect 与 --task-plan 不能同时使用");
    if (args.inspect && args.inspect !== true) throw new FailError("--inspect 不接受值");
    let taskPlan: unknown;
    if (args["task-plan"] !== undefined) {
      if (typeof args["task-plan"] !== "string") throw new FailError("--task-plan 必须提供 JSON 文件路径");
      let source: string;
      try { source = readFileSync(args["task-plan"], "utf8"); }
      catch { throw new FailError("--task-plan 文件不存在或不可读"); }
      try { taskPlan = JSON.parse(source); }
      catch { throw new FailError("--task-plan 文件不是合法 JSON"); }
    }
    const detail = await executeWriteback(runtime, issue, paths, {
      inspect: args.inspect === true, ...(taskPlan !== undefined ? { taskPlan } : {}),
    });
    process.stdout.write(JSON.stringify({ result: "PASS", ...detail }, null, 2) + "\n");
    return 0;
  } catch (exc) {
    if (exc instanceof FailError) {
      process.stdout.write(JSON.stringify({ result: "FAIL", reason: exc.message }, null, 2) + "\n");
      log(`FAIL: ${exc.message}`);
      return 2;
    }
    if (exc instanceof UnknownError) {
      process.stdout.write(JSON.stringify({ result: "UNKNOWN", reason: exc.message }, null, 2) + "\n");
      log(`UNKNOWN: ${exc.message}`);
      return 3;
    }
    throw exc;
  }
}

/** commander 注册：group=tfs；参数解析沿用组内既有实现。 */
export function registerTfsWriteback(group: Command): void {
  group
    .command("writeback")
    .description("根据交付事实回写 TFS 工作项")
    .usage("--issue <key> [--root-repo <path>] [--inspect | --task-plan <plan.json>]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      throw new ExitSignal(await main(cmd.args));
    });
}
