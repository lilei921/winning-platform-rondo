import { deliveryCommentReference, readTfsHistory, hasDeliveryComment } from "./delivery-comment.js";
/**
 * TFS Writeback: PR 已完成且 Delivery Prepare 确认后执行。
 * 新 Change-level Requirement: inspect → Agent task plan → 确定性校验
 * → 稳定身份创建/恢复 1–5 个 TFS Task → 独占业务 Commit 关联双向回核
 * → 核对工时与任务状态 → 父需求收口。
 * Bug 跳过子任务；旧 dev.dispatch Requirement 保留既有兼容路径。
 * FAIL/UNKNOWN 均阻断 Complete；外部 TFS 写入不盲目重试。
 */

import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { loadConfig, type BaseRegistryConfig } from "../../clients/config.js";
import { MulticaClient, type IssueRecord } from "../../clients/multica.js";
import { TfsClient } from "../../clients/tfs.js";
import { resolveRuntimePaths, type RuntimePaths } from "../../clients/runtime-paths.js";
import { resolveChangeDir, verifyRemoteRequirement } from "../delivery/finalize.js";
import { isRequirementChangeDelivery } from "../delivery/requirement-mode.js";
import { validateRequirementTaskPlan, ensurePlannedDeliveryTasks, findExistingPlannedTasks,
  type RequirementTaskPlan } from "./requirement-tasks.js";
import { inspectRequirementCommits, currentCommitOwners, type AvailableCommit } from "./requirement-commits.js";
import { TfsClient as TfsApiClient } from "../../tfs/client.js";
import { hasExactArtifactLink } from "../../tfs/api/commit-facts.js";
import { commitKey, parseCommitArtifact } from "../../tfs/api/commit-identity.js";
import { RemoteArtifactReader, materializeDeliveryArtifacts, type DeliveryArtifacts } from "../delivery/remote-artifacts.js";
import { readAnalysisSource } from "../analysis/source.js";
import { resolveStableEvidenceCommit, type EvidenceCommit, type EvidenceRepository } from "../delivery/evidence-repository.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import { isDirectBugDelivery, assertBugFinalizationFacts, bugDeliveryDigest, type BugCurrentPr } from "../bug/finalize-facts.js";
import { verifyCloseoutRoot, confirmPublishedArchive, assertCloseoutChange } from "../delivery/closeout-root.js";
import {
  estimateIssue,
  extractTaskText,
  parseEstimate,
  stripEstimateTail,
  truncateTitleText,
} from "./materialize-tasks.js";

interface RegistryConfig extends BaseRegistryConfig {
  runtime: BaseRegistryConfig["runtime"];
  registry?: Record<string, EvidenceRepository>;
}

interface DispatchEntry {
  dispatch_key: string;
  task_refs: string[];
  active: boolean;
  tfs_task_ids?: Record<string, number>;
}

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

interface EvidenceFile {
  task_refs?: string[];
  commits?: EvidenceCommit[];
}

function log(msg: string): void { process.stderr.write(msg + "\n"); }

export class Clients {
  private multica: MulticaClient;
  private tfs: TfsClient;
  constructor(cfg: RegistryConfig) {
    this.multica = new MulticaClient(cfg.runtime);
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

function parseDispatches(md: Record<string, string>, issueKey: string): DispatchEntry[] {
  const raw = md["dev.dispatch"];
  if (!raw) return [];
  let dispatches: DispatchEntry[];
  try { dispatches = JSON.parse(raw) as DispatchEntry[]; }
  catch { throw new UnknownError(`Issue ${issueKey} 的 metadata dev.dispatch 不是合法 JSON`); }
  if (!Array.isArray(dispatches)) throw new UnknownError(`Issue ${issueKey} 的 metadata dev.dispatch 不是数组`);
  return dispatches;
}

/** 步骤 1：任务物化（与 materialize-tasks 同源；含映射回写与预估前置）。 */
async function materializeTasks(
  clients: Clients, issue: IssueRecord, issueKey: string, md: Record<string, string>,
  dispatches: DispatchEntry[], activeEntries: DispatchEntry[], unionRefs: string[],
  changeDir: string, tfsId: number,
): Promise<{ created: Record<string, number>; reused: Record<string, number>; adopted: Record<string, number> }> {
  const reasons: string[] = [];
  const tasksPath = join(changeDir, "tasks.md");
  if (!existsSync(tasksPath)) {
    reasons.push(`tasks.md 不存在: ${tasksPath}`);
  }
  let tasksText = "";
  if (reasons.length === 0) {
    tasksText = readFileSync(tasksPath, "utf8");
    const missing = unionRefs.filter((ref) => extractTaskText(tasksText, ref) === null);
    if (missing.length > 0) reasons.push(`task_refs 在 ${tasksPath} 中不可定位: ${missing.join(", ")}`);
    for (const ref of unionRefs) {
      const text = extractTaskText(tasksText, ref);
      if (text === null) continue;
      const issue0 = estimateIssue(text);
      if (issue0) reasons.push(`task ${ref} ${issue0}`);
    }
  }
  if (reasons.length > 0) throw new FailError(reasons.join("；"));

  // 父项核对（WIQL 回读；确定不存在 → FAIL 零创建；查询故障 → UNKNOWN）
  const parentArr = await clients.tfsQuery(`SELECT [System.Id] FROM WorkItems WHERE [System.Id] = ${tfsId}`, `回读 TFS 父工作项 ${tfsId}`);
  if (parentArr.length === 0) throw new FailError(`TFS 父工作项 ${tfsId} 不存在或不可读`);
  const parentProject = parentArr[0].project ?? null;

  const created: Record<string, number> = {};
  const reused: Record<string, number> = {};
  const adopted: Record<string, number> = {};

  for (const ref of unionRefs) {
    // 1) 既有记录（含失效条目）→ 核对仍存在 → reused
    let recordedId: number | undefined;
    for (const d of dispatches) {
      const id = d.tfs_task_ids?.[ref];
      if (typeof id === "number" && id > 0) { recordedId = id; break; }
    }
    if (recordedId !== undefined) {
      const check = await clients.tfsQuery(`SELECT [System.Id] FROM WorkItems WHERE [System.Id] = ${recordedId}`, `核对 TFS 任务 ${recordedId}（ref=${ref}）`);
      if (check.length === 0) {
        throw new UnknownError(`tfs_task_ids 记录的任务 ${recordedId}（ref=${ref}）在 TFS 侧不存在——事实冲突，交 Lead 核对，不擅自重建`);
      }
      reused[ref] = recordedId;
      continue;
    }

    // 2) 孤儿认领：同前缀标题 + 父链接匹配（创建后回写失败遗留）→ adopted
    const prefix = `[${issueKey} ${ref}]`;
    const orphans = (await clients.tfsQuery(
      `SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS '${prefix}'`,
      `孤儿任务查询(parent=${tfsId}, ref=${ref})`,
    )).filter((wi) => typeof wi.title === "string" && (wi.title as string).startsWith(prefix) && wi.parentId === tfsId);
    if (orphans.length > 0) {
      adopted[ref] = orphans[0].id;
      continue;
    }

    // 3) 创建：TFS 管理投影不强制 OpenSpec Task 提供估算；旧尾注可选兼容。
    const owner = activeEntries.find((d) => (d.task_refs ?? []).includes(ref));
    const rawText = extractTaskText(tasksText, ref) as string;
    const estimate = parseEstimate(rawText);
    const title = `${prefix} ${truncateTitleText(stripEstimateTail(rawText))}`;
    const descriptionFile = join(tmpdir(), `tfs-task-${issueKey}-${ref.replace(/[^\w.-]/g, "_")}.md`);
    writeFileSync(descriptionFile, [
      `Multica Delivery Issue: ${issueKey}`,
      `OpenSpec Change: ${md["analysis.change_ref"] ?? "(未知)"}`,
      `Task ref: ${ref}`,
      `派发身份 dispatch_key: ${owner?.dispatch_key ?? "(未知)"}`,
      `Task: ${rawText}`,
      ...(estimate !== null ? [`预估: ${estimate}h`] : []),
      ``,
      `工程真相以 OpenSpec Change 为准（Reference-not-Replication，本任务不复制需求/验收内容）。`,
    ].join("\n"), "utf8");
    try {
      const wi = await clients.tfsCreateTask({ title, parent: tfsId, project: parentProject, descriptionFile, ...(estimate !== null ? { estimate } : {}) });
      created[ref] = wi.id;
    } finally {
      try { unlinkSync(descriptionFile); } catch { /* 临时文件清理失败不影响主流程 */ }
    }
  }

  // 映射回写：合并进对应 active 条目 tfs_task_ids（含失效条目原样保留）
  const resolved: Record<string, number> = { ...reused, ...adopted, ...created };
  for (const d of activeEntries) {
    const merged: Record<string, number> = { ...(d.tfs_task_ids ?? {}) };
    for (const ref of d.task_refs ?? []) {
      if (typeof resolved[ref] === "number") merged[ref] = resolved[ref];
    }
    d.tfs_task_ids = merged;
  }
  clients.setMetadata(issue.id, "dev.dispatch", JSON.stringify(dispatches));

  return { created, reused, adopted };
}

/** 步骤 2：commit 关联（best-effort；任何单项失败只进 commit_link_failed，不上抛）。 */
async function linkCommits(
  clients: Clients, cfg: RegistryConfig, paths: RuntimePaths, issueKey: string,
  dispatches: DispatchEntry[], changeDir: string, taskIdByRef: Map<string, number>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { linked: {}, skipped: {}, commit_link_failed: [] as unknown[], evidence_missed: [] as string[] };
  const linked = out.linked as Record<string, string[]>;
  const skippedMap = out.skipped as Record<string, string[]>;
  const linkFailed = out.commit_link_failed as Array<Record<string, unknown>>;
  const evidenceMissed = out.evidence_missed as string[];

  // evidence 发现：只扫 Change 目录顶层 evidence*.json（散落代码仓验证目录的不参与）
  const allRefs = [...new Set(dispatches.flatMap((d) => d.task_refs ?? []))].sort();
  if (allRefs.length === 0) { out.note = "无 dispatch task_refs"; return out; }
  const commitsByRef = new Map<string, EvidenceCommit[]>();
  let evidenceCount = 0;
  for (const f of readdirSync(changeDir)) {
    if (!/^evidence.*\.json$/i.test(f)) continue;
    let ev: EvidenceFile;
    try { ev = JSON.parse(readFileSync(join(changeDir, f), "utf8")) as EvidenceFile; }
    catch { evidenceMissed.push(`${f}（JSON 解析失败）`); continue; }
    evidenceCount++;
    for (const ref of ev.task_refs ?? []) {
      if (!allRefs.includes(ref)) continue;
      const list = commitsByRef.get(ref) ?? [];
      for (const c of ev.commits ?? []) list.push(c);
      commitsByRef.set(ref, list);
    }
  }
  out.evidence_files = evidenceCount;

  // repo_path → registry repo_key 反解（hub 路径或 .worktrees/<issue>-<repo_key>）；根仓显式跳过
  const rootRepo = resolve(paths.rootRepo);
  const registry = cfg.registry ?? {};
  const resolveRepoKey = (repoPath: string): { key: string | null; rootRepo: boolean } => {
    const abs = resolve(repoPath);
    if (abs === rootRepo) return { key: null, rootRepo: true };
    for (const [key, repo] of Object.entries(registry)) {
      if (abs === resolve(join(rootRepo, repo.repo_path))) return { key, rootRepo: false };
      if (abs === resolve(join(rootRepo, ".worktrees", `${issueKey}-${key}`))) return { key, rootRepo: false };
    }
    return { key: null, rootRepo: false };
  };

  // 按 (task_ref, repo_key) 归并 sha（去重）
  const shasByTaskRepo = new Map<string, { taskId: number; repo: string; project?: string; shas: string[] }>();
  const rootRepoSkipped: string[] = [];
  for (const [ref, commits] of commitsByRef) {
    const taskId = taskIdByRef.get(ref);
    if (typeof taskId !== "number") continue; // 无任务面的 ref（如失效条目未建任务）不关联
    for (const c of commits) {
      if (paths.source === "remote_artifacts" || c.repo_key !== undefined || c.repo_url !== undefined) {
        try {
          const identity = resolveStableEvidenceCommit(registry, c, loadTfsConfig().serverUrl);
          const k = `${ref}#${identity.key}`;
          const bucket = shasByTaskRepo.get(k) ?? { taskId, repo: identity.repo, project: identity.project, shas: [] };
          if (!bucket.shas.includes(identity.sha)) bucket.shas.push(identity.sha);
          shasByTaskRepo.set(k, bucket);
        } catch (error) { linkFailed.push({ ref, error: error instanceof Error ? error.message : "仓库身份非法" }); }
        continue;
      }
      if (!c.sha || !c.repo_path) {
        linkFailed.push({ ref, sha: c.sha ?? null, error: "evidence commit 缺 sha 或 repo_path" });
        continue;
      }
      const { key, rootRepo: isRoot } = resolveRepoKey(c.repo_path);
      if (isRoot) { rootRepoSkipped.push(c.sha); continue; }
      if (!key) {
        linkFailed.push({ ref, sha: c.sha, repo_path: c.repo_path, error: "repo_path 无法反解为 registry repo_key" });
        continue;
      }
      const repoCfg = registry[key];
      if (!repoCfg.tfs_repo) {
        linkFailed.push({ ref, sha: c.sha, repo_key: key, error: `repo_key ${key} 缺少 tfs_repo 配置` });
        continue;
      }
      const k = `${ref}#${key}`;
      // 不传 tfs_project：registry 的 tfs_project 是工作项所属项目，git 仓库可能挂在另一个 TFS 项目下
      // （如 winning-dps-df-datamodel-web 在 WiNEX_Data_Governance），按项目限定会解析不到仓库。
      const bucket = shasByTaskRepo.get(k) ?? { taskId, repo: repoCfg.tfs_repo, shas: [] };
      if (!bucket.shas.includes(c.sha)) bucket.shas.push(c.sha);
      shasByTaskRepo.set(k, bucket);
    }
  }
  if (rootRepoSkipped.length > 0) out.root_repo_skipped = rootRepoSkipped.length;

  for (const [k, bucket] of shasByTaskRepo) {
    const ref = k.split("#")[0];
    try {
      const r = await clients.tfsLinkCommits(bucket.taskId, bucket.repo, bucket.shas, bucket.project);
      if (r.linked?.length) linked[ref] = [...(linked[ref] ?? []), ...r.linked];
      if (r.skipped?.length) skippedMap[ref] = [...(skippedMap[ref] ?? []), ...r.skipped];
      for (const f of r.failed ?? []) linkFailed.push({ ref, task_id: bucket.taskId, ...f });
    } catch (exc) {
      linkFailed.push({ ref, task_id: bucket.taskId, repo: bucket.repo, error: exc instanceof Error ? exc.message : String(exc) });
    }
  }
  return out;
}

/** 步骤 3：任务解决 + 回读核对（逻辑与 resolve-tasks 同源；任一失败 → UNKNOWN 断点续走）。 */
async function resolveTasks(
  clients: Clients, dispatches: DispatchEntry[], unionRefs: string[], verifyOnly = false,
): Promise<{ resolved: Record<string, number>; estimate_missing: unknown[] }> {
  const idByRef = new Map<string, number>();
  for (const d of dispatches) {
    for (const [ref, id] of Object.entries(d.tfs_task_ids ?? {})) {
      if (typeof id === "number" && id > 0 && !idByRef.has(ref)) idByRef.set(ref, id);
    }
  }
  const unmapped = unionRefs.filter((ref) => !idByRef.has(ref));
  if (unmapped.length > 0) throw new UnknownError(`任务物化后仍有 task_refs 缺映射: ${unmapped.join(", ")}——逻辑缺陷，交 Lead 核对`);

  const resolved: Record<string, number> = {};
  for (const ref of unionRefs) resolved[ref] = idByRef.get(ref) as number;
  const uniqueIds = [...new Set(Object.values(resolved))];
  const refById = new Map<number, string>();
  for (const [ref, id] of Object.entries(resolved)) if (!refById.has(id)) refById.set(id, ref);

  const failed: Array<Record<string, unknown>> = [];
  const estimateMissing: Array<Record<string, unknown>> = [];
  if (!verifyOnly) for (const id of uniqueIds) {
    try {
      const out = await clients.tfsSetState(id, "已解决", true);
      if (out.estimateMissing) {
        estimateMissing.push({ ref: refById.get(id), id, note: "OriginalEstimate 缺失，仅落库 RemainingWork=0" });
      }
    } catch (exc) {
      failed.push({ ref: refById.get(id), id, error: exc instanceof Error ? exc.message : String(exc) });
    }
  }

  const failedIds = new Set(failed.map((f) => f.id as number));
  const readback = await clients.tfsQuery(
    `SELECT [System.Id] FROM WorkItems WHERE [System.Id] IN (${uniqueIds.join(", ")})`,
    "回读任务状态核对",
  );
  const wiById = new Map<number, TfsWorkItem>();
  for (const wi of readback) wiById.set(wi.id, wi);
  for (const id of uniqueIds) {
    if (failedIds.has(id)) continue;
    const wi = wiById.get(id);
    if (!wi) { failed.push({ ref: refById.get(id), id, error: "回读未找到该任务（不存在或不可读）" }); continue; }
    if (wi.state !== "已解决") { failed.push({ ref: refById.get(id), id, state: wi.state ?? null }); continue; }
    const problems: string[] = [];
    if (wi.remainingWork !== 0) problems.push(`remainingWork=${wi.remainingWork ?? null}（应为 0）`);
    if (typeof wi.originalEstimate === "number" && wi.completedWork !== wi.originalEstimate) {
      problems.push(`completedWork=${wi.completedWork ?? null}（应为 originalEstimate=${wi.originalEstimate}）`);
    }
    if (problems.length > 0) failed.push({ ref: refById.get(id), id, error: `工时字段未落齐: ${problems.join("; ")}` });
  }

  if (failed.length > 0) {
    throw new UnknownError(`部分任务未达'已解决'或工时未落齐（重跑本命令幂等补齐）: ${JSON.stringify(failed)}`);
  }
  return { resolved, estimate_missing: estimateMissing };
}

/** 步骤 4：父项回写（状态链由 tfs-cli 逐跳 walk；稳定交付引用用于评论对账，delivery.tfs_written 为完成标记）。 */
export async function writebackParent(clients: Pick<Clients, "tfsQuery" | "tfsSetState" | "tfsComment" | "setMetadata">, issue: IssueRecord, issueKey: string, md: Record<string, string>, tfsId: number, readHistory = readTfsHistory): Promise<Record<string, unknown>> {
  if (md["delivery.tfs_written"] === "true") {
    const actual = await clients.tfsQuery(`SELECT [System.Id] FROM WorkItems WHERE [System.Id] = ${tfsId}`, "回读已登记 TFS 父项");
    if (actual.length !== 1 || actual[0].state !== "已解决") {
      throw new UnknownError("delivery.tfs_written 已登记但 TFS 父项未确认已解决，拒绝复用过期标记");
    }
    return { status: "skipped", note: "delivery.tfs_written 已置位，父项实际状态已回读" };
  }
  const reference = deliveryCommentReference(issue);
  const legacy = `交付完成（Multica ${issueKey}）`;
  const exists = hasDeliveryComment(await readHistory(tfsId), reference, legacy);
  const stateOut = await clients.tfsSetState(tfsId, "已解决");
  if (!exists) {
    const commentFile = join(tmpdir(), `writeback-tfs-comment-${process.pid}.md`);
    const content = isDirectBugDelivery(md)
      ? `${legacy}：Bug 修复 PR 已合并，验证与代码审查证据见 Multica bug.delivery / PR。`
      : `${legacy}：PR 已合并，OpenSpec Change \`${md["analysis.change_ref"] ?? ""}\` 已归档。详见 Delivery Issue 摘要评论。`;
    writeFileSync(commentFile, content + "\n\n" + reference, "utf8");
    try { await clients.tfsComment(tfsId, commentFile); }
    finally { try { unlinkSync(commentFile); } catch { /* 保留外部成功事实，下次回读。 */ } }
    if (!hasDeliveryComment(await readHistory(tfsId), reference, legacy)) throw new UnknownError("TFS 评论成功响应后未回读到本次引用");
  }
  clients.setMetadata(issue.id, "delivery.tfs_written", "true");
  return { status: "done", state: "已解决", ...(stateOut.via?.length ? { via: stateOut.via } : {}), comment: true };
}

/** 只读后置条件：核对 TFS 外部真实状态，不创建任务、不更新工时/状态、不追加评论。 */
export async function verifyTfsWriteback(cfg: RegistryConfig, issue: IssueRecord, rootRepo?: string): Promise<Record<string, unknown>> {
  const md = issue.metadata ?? {};
  if (md["delivery.tfs_written"] !== "true") {
    throw new UnknownError("未确认 TFS Writeback 完成，拒绝 Issue done");
  }
  const tfsId = Number(md["tfs.id"]);
  if (!Number.isInteger(tfsId) || tfsId <= 0) throw new FailError("TFS 父项身份无效");
  const tfsType = md["tfs.type"];
  if (tfsType !== "需求" && tfsType !== "Bug") throw new UnknownError("TFS 来源类型缺失或不支持");
  const clients = new Clients(cfg);
  const parent = await clients.tfsQuery(
    `SELECT [System.Id] FROM WorkItems WHERE [System.Id] = ${tfsId}`, "核对 TFS 父项实际完成状态",
  );
  if (parent.length !== 1 || parent[0].id !== tfsId || parent[0].state !== "已解决") {
    throw new UnknownError(`TFS 父项 ${tfsId} 当前未确认已解决；不可仅凭 delivery.tfs_written 完成 Multica Issue`);
  }
  if (tfsType === "Bug") return { parent: tfsId, parent_state: parent[0].state, tasks: "skipped_bug" };

  if (isRequirementChangeDelivery(md)) {
    const saved = parseStoredTaskPlan(md["delivery.tfs_task_plan"], "delivery.tfs_task_plan");
    if (!saved) throw new FailError("新 Requirement 缺少已确认的 TFS 子任务计划");
    if (!rootRepo) throw new UnknownError("Complete 缺少已核验的根仓，不能证明业务 Commit 来源");
    const snapshot = await inspectRequirementCommits(cfg.registry ?? {}, md, rootRepo);
    const plan = validateRequirementTaskPlan(saved, snapshot.approvedTasks, snapshot.commits);
    const api = new TfsApiClient();
    const ids = await findExistingPlannedTasks(clients, issue.identifier ?? issue.id,
      md["analysis.change_ref"], tfsId, plan);
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
  const dispatches = parseDispatches(md, issue.identifier ?? issue.id);
  const active = dispatches.filter((d) => d.active);
  if (active.length === 0) throw new FailError("无有效 dev.dispatch，不能确认 TFS 子任务已完成");
  const taskRefs = [...new Set(active.flatMap((d) => d.task_refs ?? []))].sort();
  if (taskRefs.length === 0) throw new FailError("无当前有效 task_refs，不能确认 TFS 子任务已完成");
  // 复用同一状态/工时回读逻辑；verifyOnly 不进行 set-state，也不重复物化。
  const tasks = await resolveTasks(clients, dispatches, taskRefs, true);
  return { parent: tfsId, parent_state: parent[0].state, tasks: tasks.resolved };
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
    if (completed && (task.state !== "已解决" || task.remainingWork !== 0 ||
        task.completedWork !== plan.tasks[i].estimate_hours)) {
      throw new UnknownError(`TFS Task ${ids[i]} 未确认已解决或工时未完全落库`);
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
  cfg: RegistryConfig, clients: Clients, issue: IssueRecord, issueKey: string,
  md: Record<string,string>, tfsId: number, rootRepo: string, opts: PlannedWritebackOptions,
): Promise<Record<string,unknown>> {
  const snapshot = await inspectRequirementCommits(cfg.registry ?? {}, md, rootRepo);
  if (opts.inspect) return {
    mode: "inspect", approved_tasks_source: "analysis.source.commit", approved_tasks: snapshot.approvedTasks,
    commits: snapshot.commits,
    available_unique_commits: snapshot.commits.filter(c => !c.owners.length).length,
    saved_plan: Boolean(md["delivery.tfs_task_plan"]),
  };
  const stored = parseStoredTaskPlan(md["delivery.tfs_task_plan"], "delivery.tfs_task_plan");
  const plan = approvedTaskPlan(opts.taskPlan, stored, snapshot.approvedTasks, snapshot.commits);
  const api = new TfsApiClient();
  const latestIssue = clients.getIssue(issueKey);
  const fresh = latestIssue.metadata ?? {};
  if (fresh["finalize.pending"] !== md["finalize.pending"] ||
      fresh["analysis.change_ref"] !== md["analysis.change_ref"] ||
      fresh["analysis.source"] !== md["analysis.source"] ||
      fresh["current_pr"] !== md["current_pr"] ||
      fresh["tfs.id"] !== md["tfs.id"]) {
    throw new UnknownError("收口期间 Issue 事实发生变化，停止外部 TFS 写入");
  }
  const prior = parseStoredTaskPlan(fresh["delivery.tfs_task_plan"], "delivery.tfs_task_plan");
  approvedTaskPlan(plan, prior, snapshot.approvedTasks, snapshot.commits);
  const existing = await findExistingPlannedTasks(clients, issueKey, md["analysis.change_ref"], tfsId, plan);
  // This check happens under the collection lock, before creating ANY TFS Task.
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
  const materialized = await ensurePlannedDeliveryTasks(clients, issueKey, md["analysis.change_ref"], tfsId, plan);
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
      const linked = await clients.tfsLinkCommits(taskId, commit.repo, [commit.sha], commit.project);
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
    const result = await clients.tfsSetState(id, "已解决", true);
    if (result.estimateMissing) throw new UnknownError(`TFS Task ${id} 缺少 OriginalEstimate`);
  }
  await verifyPlannedTaskFacts(clients, api, plan, materialized.ids, snapshot.commits, true);
  const parent = await writebackParent(clients, issue, issueKey, md, tfsId);
  return { tasks_materialized: materialized, tasks_resolved: materialized.ids,
    commit_links: "verified_exclusive", parent_writeback: parent };
}

/** 核心流程（commander 包装与 finalize 共用）：硬失败上抛 FailError/UnknownError，返回各步明细。 */
export async function executeWriteback(cfg: RegistryConfig, issue: IssueRecord, paths: RuntimePaths | null, opts: PlannedWritebackOptions = {}): Promise<Record<string, unknown>> {
  const clients = new Clients(cfg);
  const issueKey = issue.identifier ?? issue.id;
  const md = issue.metadata ?? {};
  const detail: Record<string, unknown> = { issue: issueKey };

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
    let prs: BugCurrentPr[];
    try { prs = JSON.parse(md.current_pr ?? "null") as BugCurrentPr[]; }
    catch { throw new UnknownError("Bug current_pr 无法解析"); }
    if (!Array.isArray(prs)) throw new FailError("Bug current_pr 缺失");
    assertBugFinalizationFacts(md, issue.status, prs);
    if (pending.prepared_kind !== "bug" || pending.prepared_bug_digest !== bugDeliveryDigest(md)) {
      throw new FailError("Bug TFS Writeback 必须等待有效的 Bug Delivery Prepare");
    }
  } else {
    const preparedChange = md["analysis.change_ref"];
    if (!paths || !preparedChange || !pending || pending.prepared_change_ref !== preparedChange ||
        !resolveChangeDir(paths, preparedChange).archived) {
      throw new FailError("TFS Writeback 必须等待 Prepare 的 Archive / Git Push 已确认，禁止仅凭 pending 或本地归档执行");
    }
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
  const dispatches = requirementChange ? [] : parseDispatches(md, issueKey);

  if (tfsType === "Bug") {
    if (opts.inspect || opts.taskPlan !== undefined) throw new FailError("Bug 不接受任务规划参数");
    detail.tasks = "skipped_bug";
    detail.commit_links = "skipped_bug";
  } else if (requirementChange) {
    if (!paths) throw new FailError("Requirement TFS Writeback 缺少 OpenSpec 根仓");
    const changeRef = md["analysis.change_ref"];
    if (!changeRef) throw new FailError("Change 身份缺失");
    resolveChangeDir(paths, changeRef);
    return { ...detail, ...await executePlannedRequirement(cfg, clients, issue, issueKey, md, tfsId, paths.rootRepo, opts) };
  } else {
    if (opts.inspect || opts.taskPlan !== undefined) throw new FailError("--inspect / --task-plan 只适用于新 Change-level Requirement");
    if (!paths) throw new FailError("Requirement TFS Writeback 缺少 OpenSpec 根仓");
    const activeEntries = dispatches.filter((d) => d.active);
    if (activeEntries.length === 0) throw new FailError("dev.dispatch 无 active:true 条目——无任务面可回写");
    const unionRefs = [...new Set(activeEntries.flatMap((d) => d.task_refs ?? []))].sort();
    if (unionRefs.length === 0) throw new FailError("active dispatch 条目的 task_refs 并集为空");
    const changeRef = md["analysis.change_ref"];
    if (!changeRef) throw new FailError("metadata analysis.change_ref 缺失（无法定位 tasks.md）");
    const change = resolveChangeDir(paths, changeRef);

    // 1. 任务物化
    const mat = await materializeTasks(clients, issue, issueKey, md, dispatches, activeEntries, unionRefs, change.dir, tfsId);
    detail.tasks_materialized = mat;

    // 2. commit 关联（best-effort）
    const idByRef = new Map<string, number>();
    for (const d of dispatches) {
      for (const [ref, id] of Object.entries(d.tfs_task_ids ?? {})) {
        if (typeof id === "number" && id > 0 && !idByRef.has(ref)) idByRef.set(ref, id);
      }
    }
    detail.commit_links = await linkCommits(clients, cfg, paths, issueKey, dispatches, change.dir, idByRef);

    // 3. 任务解决 + 回读
    detail.tasks_resolved = await resolveTasks(clients, dispatches, unionRefs);
  }

  // 4. 父项回写（Bug 与 需求 共用；子任务全部解决后才到这一步）
  detail.parent_writeback = await writebackParent(clients, issue, issueKey, md, tfsId);

  return detail;
}

async function main(rawArgs: string[]): Promise<number> {
  const args = parseArgs(rawArgs);
  const missingArgs = ["config", "issue"].filter((k) => typeof args[k] !== "string" || args[k] === "");
  if (missingArgs.length > 0) {
    process.stderr.write(
      "用法: rondo tfs writeback --config <repo-registry.json> --issue <KEY>\n" +
      "  配置 runtime.root_branch 可从远端归档读取；使用本地工件时必须传 --root-repo\n" +
      "  [--root-repo <path>]（使用本地工件时必填）\n" +
      `缺少参数: ${missingArgs.join(", ")}\n`,
    );
    return 64;
  }

  let remote: DeliveryArtifacts | undefined;
  try {
    const cfg = loadConfig<RegistryConfig>(args.config as string, { requireRegistry: false });
    const client = new MulticaClient(cfg.runtime);
    const issue = client.getIssue(args.issue as string);
    const md = issue.metadata ?? {};
    if (isRequirementChangeDelivery(md) && !args["root-repo"]) throw new UnknownError("Requirement TFS Writeback 必须显式使用同组 --root-repo");
    if (!isDirectBugDelivery(md) && !args["root-repo"] && cfg.runtime.root_branch !== undefined) {
      if (!cfg.runtime.workspace_id) throw new UnknownError("远端回写必须显式配置 workspace_id");
      const source = readAnalysisSource(md);
      remote = await materializeDeliveryArtifacts(new RemoteArtifactReader(source.repo_url), md,
        isRequirementChangeDelivery(md) ? source.branch : cfg.runtime.root_branch!);
      if (!remote.archived) throw new FailError("权威分支尚未确认归档，禁止 TFS Writeback");
      await verifyRemoteRequirement({ ...cfg, registry: cfg.registry ?? {} }, issue, remote.paths);
    }
    const paths = isDirectBugDelivery(md) ? null : remote?.paths ?? resolveRuntimePaths(cfg, { issue, rootRepoArg: args["root-repo"] as string | undefined, need: ["openspec"] });
    if (paths && isRequirementChangeDelivery(md)) {
      const source = readAnalysisSource(md);
      Object.assign(paths, verifyCloseoutRoot(paths, source));
      assertCloseoutChange(paths, source);
      confirmPublishedArchive(paths, source);
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
    const detail = await executeWriteback(cfg, issue, paths, {
      inspect: args.inspect === true, ...(taskPlan !== undefined ? { taskPlan } : {}),
    });
    if (remote) detail.remote_artifacts = { repo_url: remote.source.repo_url, branch: remote.branch, commit: remote.commit, archived: true };
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
  } finally {
    remote?.dispose();
  }
}

/** commander 注册：group=tfs；参数解析沿用组内既有实现。 */
export function registerTfsWriteback(group: Command): void {
  group
    .command("writeback")
    .description("TFS 收口统一回写：任务物化+commit 关联+任务解决+父项回写（PR 通过后调用，tfs-writeback-decoupling-plan）")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      throw new ExitSignal(await main(cmd.args));
    });
}
