import { ensureDeliverySummary } from "./summary.js";
/**
 * delivery finalize — PR 收口、对账与最终完成（02 §11.3 / §12 的确定性投影）。
 *
 * 收编说明（裁决 D3 修订）：自 rondo 收编起，实现位置为 @winning/skill-flow 包内
 * commands/delivery/finalize.ts，原 projects/multica/workspace-skills/finalize-delivery/scripts/
 * finalize-delivery.ts 路径在迁移窗口期保持有效。
 *
 * 调用方：PR Status Sync Run（same-run finalize）或 Delivery Lead 手动触发。
 * 前置：Issue metadata 齐备（tfs.id / analysis.change_ref / analysis.gate.result /
 *       analysis.human_approval / verify_agent.required / current_pr，
 *       契约见 references/finalize-facts-contract.md）。
 *
 * D3-B（2026-11-10）：本命令只负责 Delivery 的工程/Multica 收口。
 *   --phase prepare：核实 PR / 工程交付，执行 OpenSpec Archive、根仓提交推送，保留 finalize.pending。
 *   外部 PR Status Sync Agent 同 Run 调用 rondo tfs writeback（独立 TFS Work Item/Task 管理能力）。
 *   --phase complete：必须确认前述外部 TFS Writeback 完整成功，然后 Summary、Issue done、清 pending。
 * 本命令不创建 TFS 子任务，不估时，不写 TFS Work Item 管理字段。
 *
 * 幂等纪律（02 §12.4.2/§12.4.3）：每步先回读当前事实再补缺失项；不凭上轮日志认定成功；
 * 不做补偿回滚；Issue 已 done 且 pending 残留时仅核对并清 pending。
 *
 * 用法：rondo delivery finalize --phase prepare|complete --issue <KEY|id> --config <repo-registry.json> [--root-repo <path>（使用本地工件时必填）]
 * 本地根仓路径显式使用 --root-repo，
 * 派生 openspec/，业务枢纽仓按 root_repo/repo_path 定位；解析失败一律 UNKNOWN（exit 3），零写入，不回退旧静态路径。
 * 退出码：0 PASS / 2 FAIL（明确条件不满足）/ 3 UNKNOWN / 64 用法错误。stdout 只出 JSON；日志走 stderr。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { runCommand } from "../../clients/spawn.js";
import { loadConfig, type BaseRegistryConfig, type RuntimeConfig } from "../../clients/config.js";
import { MulticaClient } from "../../clients/multica.js";
import { TfsClient } from "../../clients/tfs.js";
import { resolveRuntimePaths, type RuntimePaths } from "../../clients/runtime-paths.js";
import { classifyTfsType } from "../analysis/facts.js";
import { verifyTfsWriteback } from "../tfs/writeback.js";
import { assertStableChangeRef, readChangeSchema, sourceSchemaViolation, changeKindSchemaViolation, CHANGE_KINDS } from "../analysis/change-schema.js";
import { assertProjectedVerifyDecision } from "./verify-decision.js";
import { computeContractFiles, touchedCapabilities } from "./contract-files.js";
import { assertCurrentEvidence } from "./current-evidence.js";
import { isRequirementChangeDelivery, assertRequirementEvidence } from "./requirement-mode.js";
import { isDirectBugDelivery, assertBugFinalizationFacts, bugDeliveryDigest, assertMergedBugSource } from "../bug/finalize-facts.js";
import { RemoteArtifactReader, materializeDeliveryArtifacts, checkoutArchiveRoot, runAuthenticatedRootGit, type DeliveryArtifacts } from "./remote-artifacts.js";
import { readAnalysisSource } from "../analysis/source.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import { resolveStableEvidenceCommit } from "./evidence-repository.js";
import { verifyCloseoutRoot, confirmPublishedArchive, assertCloseoutChange } from "./closeout-root.js";

interface RegistryConfig extends BaseRegistryConfig {
  runtime: RuntimeConfig;
  registry: Record<string, { repo_path: string; repo_url?: string; tfs_repo?: string; tfs_project?: string; default_target_branch?: string }>;
}

interface CurrentPrEntry {
  repo_key: string;
  pr_id: number;
  pr_url: string;
  source_branch: string;
  target_branch: string;
}

interface StepResult { status: "done" | "skipped"; detail?: unknown }

function log(msg: string): void { process.stderr.write(msg + "\n"); }

// --- git 封装（根仓/枢纽仓直接操作） ---
function git(cwd: string, args: string[], remoteUrl?: string): { status: number; stdout: string; stderr: string } {
  const r = remoteUrl ? runAuthenticatedRootGit(remoteUrl, args, cwd) : runCommand(["git", ...args], cwd);
  return r;
}

function gitOk(cwd: string, args: string[], what: string, remoteUrl?: string): string {
  const r = git(cwd, args, remoteUrl);
  if (r.status !== 0) throw new UnknownError(`${what} 失败: ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout.trim();
}

// --- 各步骤 ---

function requireRepo(cfg: RegistryConfig, repoKey: string, needTfs = false): RegistryConfig["registry"][string] {
  const repo = cfg.registry[repoKey];
  if (!repo) throw new FailError(`repo_key 未登记: ${repoKey}`);
  if (typeof repo.repo_path !== "string" || repo.repo_path === "." || repo.repo_path === ".."
    || repo.repo_path.trim() !== repo.repo_path || isAbsolute(repo.repo_path) || /[<>:"/\\|?*\0]/.test(repo.repo_path)) {
    throw new FailError(`${repoKey} 的 repo_path 不是根仓直接子目录: ${String(repo.repo_path)}`);
  }
  if (needTfs && (!repo.tfs_repo || !repo.tfs_project)) {
    throw new FailError(`${repoKey} 缺少 tfs_repo/tfs_project 交付配置，不能执行 PR/TFS 操作`);
  }
  return repo;
}

/** PR Transition Gate（02 §12.1）：逐仓回核终态与身份。全部 completed 才放行。 */
async function prTransitionGate(
  tfs: TfsClient, cfg: RegistryConfig, prs: CurrentPrEntry[],
  expectedSourceCommits?: Map<string,string>,
  stableRepositories = false,
): Promise<void> {
  const notCompleted: unknown[] = [];
  for (const entry of prs) {
    const repo = requireRepo(cfg, entry.repo_key, true);
    if (stableRepositories && expectedSourceCommits) resolveStableEvidenceCommit(cfg.registry, {
      repo_key: entry.repo_key, repo_url: repo.repo_url, sha: expectedSourceCommits.get(entry.repo_key),
    }, loadTfsConfig().serverUrl);
    const got = await tfs.run(
      ["pr", "get", "--repo", repo.tfs_repo as string, "--id", String(entry.pr_id), "--project", repo.tfs_project as string],
      `回核 PR #${entry.pr_id}(${entry.repo_key})`,
    ) as { found?: boolean; status?: string; sourceBranch?: string; targetBranch?: string; sourceCommitId?: string | null };
    if (got.found === false) {
      throw new UnknownError(`${entry.repo_key}: 已登记 PR #${entry.pr_id} 外部查无（身份不可确认，交 Lead）`);
    }
    if ((got as { id?: number }).id !== entry.pr_id) throw new UnknownError("PR 回读身份不一致");
    if (got.sourceBranch !== entry.source_branch || got.targetBranch !== entry.target_branch) {
      throw new UnknownError(`${entry.repo_key}: PR #${entry.pr_id} 分支事实与登记不符（${got.sourceBranch}→${got.targetBranch} vs ${entry.source_branch}→${entry.target_branch}）`);
    }
    if (got.status === "abandoned") {
      throw new UnknownError(`${entry.repo_key}: PR #${entry.pr_id} 已 abandoned——finalize 不处理 abandoned 路径（02 §11.2，等 Human Decision）`);
    }
    if (got.status !== "completed") {
      notCompleted.push({ repo_key: entry.repo_key, pr_id: entry.pr_id, status: got.status });
    }
    if (got.status === "completed" && expectedSourceCommits) {
      const expected = expectedSourceCommits.get(entry.repo_key);
      // TFS 2018 sometimes omits the underlying lastMergeSourceCommit:
      // without it, no one may assert the reviewed candidate was merged.
      assertMergedBugSource(entry.repo_key, got.sourceCommitId, expected);
    }
  }
  if (notCompleted.length > 0) {
    throw new FailError(`存在未完成 PR（等待合并，不属异常）: ${JSON.stringify(notCompleted)}`);
  }
}

/** 合并后工作区对账（02 §12.2）：枢纽对齐 target、worktree 回收、源分支 -d（绝不 -D）。 */
function reconcileWorkspace(cfg: RegistryConfig, paths: RuntimePaths, issueKey: string, entry: CurrentPrEntry): Record<string, unknown> {
  const repo = requireRepo(cfg, entry.repo_key);
  const hub = join(paths.rootRepo, repo.repo_path);
  if (!existsSync(join(hub, ".git"))) {
    throw new UnknownError(`枢纽克隆不存在: ${hub}（先人工克隆就位）`);
  }
  const detail: Record<string, unknown> = { repo_key: entry.repo_key, hub };
  gitOk(hub, ["fetch", "origin", "--prune"], `fetch(${entry.repo_key})`);

  // 枢纽对齐 target_branch：已对齐不重复切换；脏树/无法 ff → UNKNOWN（02 §12.2 强行对齐禁区）
  const curBranch = gitOk(hub, ["rev-parse", "--abbrev-ref", "HEAD"], "读取枢纽当前分支");
  if (curBranch !== entry.target_branch) {
    const dirty = gitOk(hub, ["status", "--porcelain"], "检查枢纽工作树");
    if (dirty) throw new UnknownError(`枢纽工作树不干净: ${hub}（拒绝切换分支，交人工核对）`);
    gitOk(hub, ["switch", entry.target_branch], `枢纽切换到 ${entry.target_branch}`);
    detail.switched = entry.target_branch;
  }
  gitOk(hub, ["pull", "--ff-only", "origin", entry.target_branch], `对齐 ${entry.target_branch}`);
  detail.target_aligned = true;

  // worktree 回收：存在且干净才删；脏 → UNKNOWN 拒删（不吞未提交工作）
  const wt = join(paths.rootRepo, ".worktrees", `${issueKey}-${entry.repo_key}`);
  if (existsSync(wt)) {
    const dirty = gitOk(wt, ["status", "--porcelain"], "检查 worktree 工作树");
    if (dirty) throw new UnknownError(`worktree 不干净: ${wt}（拒删，交人工核对）\n${dirty.slice(0, 500)}`);
    gitOk(hub, ["worktree", "remove", wt], "移除 worktree");
    detail.worktree_removed = wt;
  }

  // 源分支清理：git branch -d（安全删除被拒绝则保留；绝不 -D，02 §12.2）
  const srcRef = git(hub, ["rev-parse", "--verify", `refs/heads/${entry.source_branch}`]);
  if (srcRef.status === 0) {
    const del = git(hub, ["branch", "-d", entry.source_branch]);
    detail.source_branch_deleted = del.status === 0;
    if (del.status !== 0) detail.source_branch_keep_reason = del.stderr.trim();
  } else {
    detail.source_branch_deleted = "skipped_not_exists";
  }
  return detail;
}

/** 定位 Change 目录：未归档取 changes/<ref>；已归档取 changes/archive/*<ref>（幂等恢复）。
 * 冻结契约明示的既定例外：本函数内联保留，不改用 change resolve-identity。
 * （导出供 tfs writeback 复用：PR 通过后 tasks.md / evidence 可能已随归档移动。） */
export function resolveChangeDir(paths: RuntimePaths, changeRef: string): { dir: string; archived: boolean } {
  assertStableChangeRef(changeRef);
  const live = join(paths.openspecRoot, "changes", changeRef);
  if (existsSync(live)) return { dir: live, archived: false };
  const archiveRoot = join(paths.openspecRoot, "changes", "archive");
  if (existsSync(archiveRoot)) {
    const hits = readdirSync(archiveRoot).filter((d) => d === changeRef || d.endsWith(`-${changeRef}`));
    if (hits.length > 1) throw new UnknownError(`归档 Change 身份不唯一（${changeRef}）：${hits.join(", ")}`);
    if (hits.length === 1) return { dir: join(archiveRoot, hits[0]), archived: true };
  }
  throw new UnknownError(`Change 目录不可确认：changes/${changeRef} 与 archive 中均不存在`);
}

/** Delivery Completion Gate（02 §12.3 的机器可判定子集）。
 * 尾部追加 M2.2 contract_binding 检查（Evidence↔契约哈希绑定）；既有 5 项检查原样在前。 */
export function deliveryCompletionGate(
  cfg: RegistryConfig,
  md: Record<string, string>,
  issueStatus: string | undefined,
  changeDir: string,
  changeRef: string,
  context?: { rootRepo: string; issueKey: string; remote?: boolean },
): void {
  if (md["analysis.gate.result"] !== "PASS") {
    throw new FailError(`analysis.gate.result != PASS（实际 ${md["analysis.gate.result"] ?? "缺失"}）`);
  }
  // Never decide from Analyst Recommendation: the effective, Human-approved decision
  // must already be projected and consistent with its approval source.
  if (assertProjectedVerifyDecision(md)) {
    // Verify Agent execution / Evidence Gate is not implemented in the current runtime.
    // Fail closed even if an unrelated or stale verification.result happens to exist.
    throw new UnknownError("verify_agent.required=true，但当前尚无可确认的 Independent Verification PASS；禁止 Finalize");
  }
  if (issueStatus === "blocked") {
    throw new FailError("Issue 当前为 blocked（存在未解除阻塞）");
  }
  // tasks.md 勾选事实：任何未勾选项 → FAIL（checkbox 缺失可确定性 FAIL，02 §8）
  const tasksPath = join(changeDir, "tasks.md");
  if (!existsSync(tasksPath)) throw new UnknownError(`tasks.md 不存在: ${tasksPath}`);
  const unchecked = readFileSync(tasksPath, "utf8").split("\n").filter((l) => /^\s*-\s*\[ \]/.test(l));
  if (unchecked.length > 0) {
    throw new FailError(`tasks.md 存在 ${unchecked.length} 个未勾选任务（首个: ${unchecked[0].trim().slice(0, 120)}）`);
  }

  // 活跃/归档目录均支持；运行入口显式传入根仓，独立 Gate 调用按标准 Change 路径解析。
  const rootRepo = context?.rootRepo ?? resolve(changeDir, basename(dirname(changeDir)) === "archive" ? "../../../.." : "../../..");
  if (isRequirementChangeDelivery(md)) {
    assertRequirementEvidence(cfg.registry ?? {}, md, changeDir, changeRef);
  } else {
    assertCurrentEvidence(cfg.registry ?? {}, md, changeDir, changeRef, rootRepo, context?.issueKey, context?.remote);
  }

}

/** Final Summary：结构化事实模板渲染（非 LLM），评论 ID 回写防重复（02 §12.4.3）。 */
function renderSummary(issueKey: string, tfsId: string, tfsUrl: string, changeRef: string, prs: CurrentPrEntry[]): string {
  const prLines = prs.map((p) => `| ${p.repo_key} | #${p.pr_id} | ${p.source_branch} → ${p.target_branch} | ${p.pr_url} |`).join("\n");
  return [
    `## 交付完成摘要（finalize-delivery）`,
    ``,
    `- Delivery Issue：${issueKey}`,
    `- TFS 工作项：#${tfsId}${tfsUrl ? `（${tfsUrl}）` : ""}`,
    `- OpenSpec Change：\`${changeRef}\`（已归档）`,
    ``,
    `| 仓 | PR | 分支 | 链接 |`,
    `|---|---|---|---|`,
    prLines,
    ``,
    `> 本摘要由 finalize-delivery.ts 模板化生成，只陈述已确认事实（02 §12.4）。`,
  ].join("\n");
}

// --- 根仓临界区（ops guide §3.5：mkdir 原子锁；持锁 → UNKNOWN，不偷锁） ---
class RootLock {
  private lockDir: string;
  private held = false;
  constructor(paths: RuntimePaths, issueKey: string) {
    this.lockDir = join(paths.rootRepo, ".multica", "locks", "root-finalize.lock");
    mkdirSync(join(paths.rootRepo, ".multica", "locks"), { recursive: true });
    try {
      mkdirSync(this.lockDir);
      writeFileSync(join(this.lockDir, "owner.json"), JSON.stringify({ issue: issueKey, pid: process.pid, at: new Date().toISOString() }));
      this.held = true;
    } catch {
      let holder = "未知";
      try { holder = readFileSync(join(this.lockDir, "owner.json"), "utf8"); } catch { /* 无 owner 信息 */ }
      throw new UnknownError(`根仓临界区被占用: ${this.lockDir}（持锁者 ${holder}；不偷锁，交 Lead/下轮恢复）`);
    }
  }
  release(): void {
    if (!this.held) return;
    try { unlinkSync(join(this.lockDir, "owner.json")); } catch { /* 忽略 */ }
    try { rmdirSync(this.lockDir); } catch { /* 忽略 */ }
    this.held = false;
  }
}

/** NUL 分隔保留中文、空格和箭头文件名；重命名检查两侧，未跟踪目录展开到文件。 */
function porcelainPaths(cwd: string): string[] {
  const r = git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (r.status !== 0) throw new UnknownError(`读取根仓工作区状态失败: ${r.stderr.trim()}`);
  const paths: string[] = [];
  const entries = r.stdout.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    paths.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) paths.push(entries[++i]);
  }
  return paths;
}

/** 暂存区必须全仓检查：限定 add 路径并不能排除用户此前已经暂存的其他文件。 */
function assertArchiveIndex(root: string, allowed: (path: string) => boolean): string[] {
  const staged = gitPaths(root, ["diff", "--cached", "--name-only", "--no-renames", "-z"], "核对根仓暂存区");
  const foreign = staged.filter(p => !allowed(p));
  if (foreign.length) {
    throw new UnknownError(`根仓暂存区存在本 Change 之外的内容（拒绝夹带提交，保留暂存现场）: ${foreign.slice(0, 5).join(", ")}`);
  }
  return staged;
}

/** 路径输出不能 trim，否则前导空格会把范围外路径误判为 openspec 内路径。 */
function gitPaths(root: string, args: string[], what: string): string[] {
  const result = git(root, args);
  if (result.status !== 0) throw new UnknownError(`${what} 失败: ${result.stderr.trim()}`);
  return result.stdout.split("\0").filter(Boolean);
}

/** push 发送提交历史而非路径：逐个核对待推送提交，不能用最终净差异掩盖先改后还原。 */
function assertArchiveCommits(root: string, upstream: string, allowed: (path: string) => boolean): void {
  const commits = gitOk(root, ["rev-list", "--parents", `${upstream}..HEAD`], "核对待推送提交").split("\n").filter(Boolean);
  for (const entry of commits) {
    const [sha, ...parents] = entry.split(" ");
    if (parents.length > 1) throw new UnknownError(`待推送提交 ${sha} 是合并提交，无法确认仅属于本 Change（保留现场）`);
    const paths = gitPaths(root, ["diff-tree", "--root", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", sha], "核对提交范围");
    const foreign = paths.filter(p => !allowed(p));
    if (foreign.length) throw new UnknownError(`待推送提交 ${sha} 包含本 Change 之外的改动（拒绝推送）: ${foreign.slice(0, 5).join(", ")}`);
  }
}

/** 只做安全快进；分叉不 rebase、不 stash，保留本地提交、索引及运行时文件。 */
function syncArchiveBranch(root: string, branch: string, allowed: (path: string) => boolean, expectedRemoteCommit?: string, remoteUrl?: string): void {
  if (gitOk(root, ["symbolic-ref", "--short", "HEAD"], "核对根仓分支") !== branch) {
    throw new UnknownError("归档期间根仓分支已变化（保留现场，停止推进）");
  }
  const upstream = `refs/remotes/origin/${branch}`;
  gitOk(root, ["fetch", "origin", `refs/heads/${branch}:${upstream}`], "刷新根仓远端分支", remoteUrl);
  if (expectedRemoteCommit) {
    const remoteHead = gitOk(root, ["rev-parse", upstream], "核对固定归档基线");
    const localHead = gitOk(root, ["rev-parse", "HEAD"], "核对本次归档提交");
    // 只容忍本次 push 已被接受但响应丢失；其他分支前进须重新读取所有事实。
    if (remoteHead !== expectedRemoteCommit && remoteHead !== localHead) {
      throw new UnknownError("权威分支在 Gate 后前进，须重新核验远端工件；保留归档现场");
    }
  }
  const [ahead, behind] = gitOk(root, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`], "核对根仓分支关系")
    .split(/\s+/).map(Number);
  if (ahead > 0 && behind > 0) {
    throw new UnknownError(`根仓分支 ${branch} 已分叉（本地领先 ${ahead}、落后 ${behind}；保留提交与工作区，停止自动收口）`);
  }
  assertArchiveCommits(root, upstream, allowed);
  const staged = assertArchiveIndex(root, allowed);
  if (behind > 0) {
    if (staged.length) throw new UnknownError("根仓需要快进但暂存区非空（保留暂存内容，停止自动收口）");
    gitOk(root, ["merge", "--ff-only", "--no-autostash", upstream], "根仓安全快进（失败保留本地改动）");
  }
}

/** Route Archive：安全快进 → 保存本 Change → 原生归档 → 限定提交/推送。
 * openspec 外未暂存改动允许保留；外来暂存项和无关 OpenSpec 修改仍拒绝。
 * 对齐后与归档后复核契约；分叉保留现场，不自动改写历史或暂存用户文件。 */
export function routeArchive(paths: RuntimePaths, issueKey: string, changeRef: string, tfsId: string, expectedRemoteCommit?: string): Record<string, unknown> {
  const detail: Record<string, unknown> = {};
  const lock = new RootLock(paths, issueKey);
  try {
    const root = paths.rootRepo;
    // §4.6（2026-10-19 实证缺陷修复）：fetch/push 目标 = 当前检出分支。硬编码 master 曾在 dev 检出下
    // 静默假成功（rev-list origin/master..HEAD 永≠0 → push origin master NO-OP → pushed:true，
    // dev 上的归档提交从未推送）。
    const branchRes = git(root, ["symbolic-ref", "--short", "HEAD"]);
    if (branchRes.status !== 0 || !branchRes.stdout.trim()) {
      throw new UnknownError("根仓处于 detach HEAD 或无法探测当前分支（无法确定 push 目标）");
    }
    const branch = branchRes.stdout.trim();
    detail.branch = branch;
    const liveDir = join(paths.openspecRoot, "changes", changeRef);
    const changePrefix = `openspec/changes/${changeRef}/`;
    // M2.5：specs 白名单收窄为本 Change 触及的 capability；未触及的 specs/ 改动按 foreign 拒绝
    const current = resolveChangeDir(paths, changeRef);
    const caps = touchedCapabilities(current.dir);
    // 移动成功而提交前中断时，白名单检查前就必须识别本 Change 的唯一归档目录。
    let archivePrefix: string | null = current.archived
      ? `openspec/changes/archive/${current.dir.split(/[\\/]/).pop()}/` : null;
    // 白名单前缀判定（porcelainPaths 已 -uall 展开目录折叠，全部条目都是完整文件路径，纯前缀匹配）
    const allowed = (p: string): boolean =>
      [changePrefix, ...(archivePrefix !== null ? [archivePrefix] : []), ...caps.map((c) => `openspec/specs/${c}/`)]
        .some((pre) => p.startsWith(pre));

    // 仅放宽 openspec 外未暂存改动；暂存区的检查不受目录过滤影响。
    const checkWorkspace = (): string[] => {
      const changed = porcelainPaths(root);
      const foreign = changed.filter(p => (p === "openspec" || p.startsWith("openspec/")) && !allowed(p));
      if (foreign.length) throw new UnknownError(`根仓工作区存在本 Change 之外的改动（拒绝夹带提交）: ${foreign.slice(0, 5).join(", ")}`);
      assertArchiveIndex(root, allowed);
      return changed;
    };
    checkWorkspace();
    // 新增本地提交之前同步，避免“先保存再拉取”制造本可避免的分叉。
    const preHash = JSON.stringify(computeContractFiles(current.dir).files);
    syncArchiveBranch(root, branch, allowed, expectedRemoteCommit, paths.gitRemoteUrl);
    const aligned = resolveChangeDir(paths, changeRef);
    if (aligned.dir !== current.dir || JSON.stringify(computeContractFiles(aligned.dir).files) !== preHash) {
      throw new UnknownError("根仓对齐后契约文件或归档位置漂移（此前 completion_gate PASS 失效，须重新核验）");
    }
    const before = checkWorkspace();

    // 幂等：已归档（change 目录不在、archive 在）→ 跳过 archive，只核对 commit/push
    const alreadyArchived = current.archived;
    if (alreadyArchived) {
      detail.archive = "skipped_already_archived";
    } else {
      // A. 先提交本 Change 工件（保存优先于归档）：before 中 changePrefix 子集非空才提交
      const artifactPaths = before.filter((p) => p.startsWith(changePrefix));
      if (artifactPaths.length > 0) {
        // 保存工件使用更窄的范围，主规格已有暂存项也不能混入该次提交。
        assertArchiveIndex(root, p => p.startsWith(changePrefix));
        gitOk(root, ["add", "-A", "--", changePrefix], "暂存本 Change 工件");
        assertArchiveIndex(root, p => p.startsWith(changePrefix));
        gitOk(root, ["commit", "-m", `finalize: ${changeRef} (${issueKey} / tfs ${tfsId})`], "提交本 Change 工件");
        detail.artifacts_committed = artifactPaths.length;
      }

      // B. 原生归档后重新核对目录与契约哈希。
      const arc = runCommand(["openspec", "archive", changeRef, "--yes", "--json"], root);
      if (arc.status !== 0) {
        throw new UnknownError(`openspec archive 失败 rc=${arc.status}: ${(arc.stderr || arc.stdout).trim().slice(0, 500)}`);
      }
      // 回读确认归档事实（不只看退出码，02 §12.4.1）
      if (existsSync(liveDir)) throw new UnknownError(`archive 返回成功但 ${changeRef} 仍在 changes/ 下（结果不可确认）`);
      const resolved = resolveChangeDir(paths, changeRef);
      if (!resolved.archived) throw new UnknownError(`archive 后未在 archive/ 找到 ${changeRef}（结果不可确认）`);
      archivePrefix = `openspec/changes/archive/${resolved.dir.split(/[\\/]/).pop()}/`;
      if (JSON.stringify(computeContractFiles(resolved.dir).files) !== preHash) {
        throw new UnknownError(`归档快照契约哈希与归档前不一致（归档结果不可确认，交 Lead 核对）`);
      }
      detail.archive = resolved.dir;
    }

    // 提交：只 add 本 Change 相关路径（allowed 已按 M2.5 收窄）；禁 git add .（02 §12.4.1）
    const after = checkWorkspace();
    const commitPaths = after.filter(allowed);
    if (commitPaths.length > 0) {
      gitOk(root, ["add", "-A", "--", ...commitPaths], "暂存归档改动");
      assertArchiveIndex(root, allowed);
      gitOk(root, ["commit", "-m", `archive: ${changeRef} (${issueKey} / tfs ${tfsId})`], "根仓提交");
      detail.committed = commitPaths.length;
    } else {
      detail.committed = "skipped_no_changes";
    }

    // push 失败先回读远端：已接受则幂等成功，分叉则停止，其余有界重试 ≤3。
    for (let attempt = 1; ; attempt++) {
      checkWorkspace();
      syncArchiveBranch(root, branch, allowed, expectedRemoteCommit, paths.gitRemoteUrl);
      const archived = resolveChangeDir(paths, changeRef);
      if (!archived.archived || JSON.stringify(computeContractFiles(archived.dir).files) !== preHash) {
        throw new UnknownError("推送前归档契约漂移（保留现场，停止后续收口）");
      }
      const unpushed = gitOk(root, ["rev-list", `origin/${branch}..HEAD`, "--count"], "核对未推送提交");
      if (unpushed === "0") { detail.pushed = true; break; }
      const push = git(root, ["push", "origin", branch], paths.gitRemoteUrl);
      if (push.status === 0) { detail.pushed = true; break; }
      if (attempt >= 3) {
        throw new UnknownError(`根仓 push 失败（已重试 ${attempt} 次）: ${push.stderr.trim().slice(0, 300)}（本地 Commit 保留，恢复时只补 push）`);
      }
      log(`push 失败，回核远端后决定是否重试（第 ${attempt} 次；本地 Commit 保留）`);
    }
    return detail;
  } finally {
    lock.release();
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { out[key] = next; i++; }
    }
  }
  return out;
}

/** 远端收口必须精确证明合并的是本轮候选，不能用 merge commit 或旧路径代替。 */
function remoteCandidateCommits(md: Record<string, string>, prs: CurrentPrEntry[]): Map<string, string> {
  let candidates: Array<{ repo_key?: string; candidate_commit?: string }>;
  try { candidates = JSON.parse(md.pr_prep ?? "null"); } catch { throw new UnknownError("pr_prep 非法"); }
  if (!Array.isArray(candidates) || !candidates.length || !Array.isArray(prs) || !prs.length) throw new UnknownError("远端收口缺少候选或 PR");
  const map = new Map<string, string>();
  for (const c of candidates) {
    if (!c?.repo_key || !/^[0-9a-f]{40}$/i.test(c.candidate_commit ?? "") || map.has(c.repo_key)) throw new UnknownError("候选仓库不唯一或缺少完整 SHA");
    map.set(c.repo_key, c.candidate_commit!.toLowerCase());
  }
  if (prs.length !== map.size || new Set(prs.map(p => p?.repo_key)).size !== map.size ||
      prs.some(p => !p || !map.has(p.repo_key) || !Number.isInteger(p.pr_id) || p.pr_id <= 0)) throw new UnknownError("current_pr 与当前候选仓库集合不一致");
  return map;
}

/** 独立远端 Writer 重验工程 Gate、PR 与 pending 绑定；Prepare 标记不能替代当前外部事实。 */
export async function verifyRemoteRequirement(cfg: RegistryConfig, issue: import("../../clients/multica.js").IssueRecord, paths: RuntimePaths): Promise<void> {
  const md = issue.metadata ?? {}; const changeRef = md["analysis.change_ref"];
  const change = resolveChangeDir(paths, changeRef);
  const schema = readChangeSchema(change.dir);
  const mismatch = changeKindSchemaViolation(md["analysis.change_kind"], schema) || sourceSchemaViolation(classifyTfsType(md["tfs.type"]), schema);
  if (mismatch) throw new FailError(mismatch);
  if (schema === "intentional-change" && md["analysis.ai_review.verdict"] !== "APPROVED") throw new FailError("Intentional Change 缺少专业 AI Review");
  let prs: CurrentPrEntry[], pending: { event_keys?: string[] };
  try { prs = JSON.parse(md.current_pr ?? "null"); pending = JSON.parse(md["finalize.pending"] ?? "null"); }
  catch { throw new UnknownError("PR 或 pending 事实损坏"); }
  const candidates = remoteCandidateCommits(md, prs);
  const expected = prs.map(p => `${issue.identifier ?? issue.id}#${p.repo_key}#${p.pr_id}#completed`);
  if (!pending || !Array.isArray(pending.event_keys) || pending.event_keys.length !== expected.length || expected.some(k => !pending.event_keys!.includes(k))) {
    throw new FailError("finalize.pending 与当前 PR 完成事件不一致");
  }
  deliveryCompletionGate(cfg, md, issue.status, change.dir, changeRef, { rootRepo: paths.rootRepo, issueKey: issue.identifier ?? issue.id, remote: true });
  await prTransitionGate(new TfsClient(), cfg, prs, candidates, true);
}

/** Done 重放仅核对服务端最小交付事实，不要求已卸载的 OpenSpec 根仓可访问。 */
export function assertCompletedAnalysisFacts(md: Record<string, string>): void {
  assertStableChangeRef(md["analysis.change_ref"]);
  if (md["delivery.tfs_written"] !== "true") {
    throw new FailError("已完成 Issue 缺少已确认的 TFS Writeback 标记");
  }
}


/**
 * Independent Bug completion shares PR Transition, TFS Writeback and Issue Status
 * semantics with Requirement delivery, but has no OpenSpec Root / Change Archive.
 * Do not run workspace Git mutations in the external PR Status Sync daemon.
 */
async function finalizeDirectBug(
  cfg: RegistryConfig, client: MulticaClient, tfs: TfsClient,
  issue: ReturnType<MulticaClient["getIssue"]>, issueKey: string,
  phase: "prepare" | "complete",
): Promise<number> {
  const md = issue.metadata ?? {};
  let prs: CurrentPrEntry[];
  try { prs = JSON.parse(md.current_pr ?? "null") as CurrentPrEntry[]; }
  catch { throw new UnknownError("Bug current_pr 不是合法 JSON"); }
  if (!Array.isArray(prs) || prs.length === 0) throw new FailError("Bug current_pr 缺失或为空");
  assertBugFinalizationFacts(md, issue.status, prs);
  // Never trust metadata alone: confirm the actual external PR states before side effects.
  const entries = JSON.parse(md["bug.delivery"]) as Array<{repo_key:string;candidate_commit:string}>;
  const verifiedSources = new Map(entries.map(item => [item.repo_key, item.candidate_commit]));
  await prTransitionGate(tfs, cfg, prs, verifiedSources);
  const expectedKeys = prs.map(p => issueKey + "#" + p.repo_key + "#" + p.pr_id + "#completed");
  type BugPending = {
    event_keys?: unknown;
    recorded_at?: string;
    prepared_kind?: string;
    prepared_bug_digest?: string;
  };
  const readPending = (raw: string): BugPending => {
    let p: unknown;
    try { p = JSON.parse(raw); }
    catch { throw new UnknownError("Bug finalize.pending 无法解析"); }
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new UnknownError("Bug pending 类型错误");
    const item = p as BugPending;
    if (!Array.isArray(item.event_keys) || item.event_keys.length !== expectedKeys.length ||
        !expectedKeys.every(key => (item.event_keys as unknown[]).includes(key))) {
      throw new FailError("Bug finalize.pending 的 PR 事件身份不一致");
    }
    return item;
  };
  const digest = bugDeliveryDigest(md);
  if (phase === "prepare") {
    const original = md["finalize.pending"];
    const pending = original ? readPending(original) : {
      event_keys: expectedKeys, recorded_at: new Date().toISOString(),
    } as BugPending;
    if (pending.prepared_kind && pending.prepared_kind !== "bug") {
      throw new FailError("Bug pending 与其它 Delivery 模式冲突");
    }
    if (pending.prepared_bug_digest && pending.prepared_bug_digest !== digest) {
      throw new FailError("Bug Evidence / PR 身份在 Prepare 之后发生变化，需 Human 复核");
    }
    const prepared = JSON.stringify({ ...pending, prepared_kind: "bug", prepared_bug_digest: digest });
    if (md["finalize.pending"] !== prepared) client.setMetadata(issue.id, "finalize.pending", prepared);
    const confirmed = client.getIssue(issueKey).metadata?.["finalize.pending"];
    if (!confirmed || readPending(confirmed).prepared_bug_digest !== digest) {
      throw new UnknownError("Bug Prepare 事实回读不一致，禁止 TFS Writeback");
    }
    process.stdout.write(JSON.stringify({
      result: "PASS", issue: issueKey, status: "prepared", mode: "bug",
      steps: { pr_transition_gate: {status: "done"}, pending_written: {status: "done"},
               completion_gate: {status: "done"}, route_archive: {status: "skipped"} },
    }, null, 2) + "\n");
    return 0;
  }

  if (!md["finalize.pending"]) throw new FailError("缺少 Bug Prepare，禁止直接 Complete");
  const pending = readPending(md["finalize.pending"]);
  if (pending.prepared_kind !== "bug" || pending.prepared_bug_digest !== digest) {
    throw new FailError("Bug Prepare 与当前 Evidence / PR 身份不一致，禁止 Complete");
  }
  if (md["delivery.tfs_written"] !== "true") {
    throw new UnknownError("Bug TFS Writeback 尚未确认，禁止 Issue Done");
  }
  const tfsVerified = await verifyTfsWriteback(cfg, issue);
  const summary = [
      "## Bug 修复交付完成",
      "",
      "- Multica Issue: " + issueKey,
      "- TFS Bug: #" + md["tfs.id"],
      "- PR 已完成（逐仓）：",
      ...prs.map(p => "  - " + p.repo_key + ": " + p.pr_url),
      "- 证据：Issue metadata bug.delivery（Candidate Commit / Root Cause / Verification / Code Review）",
      "- TFS Writeback: 已核实",
    ].join("\n");
  const summaryResult = ensureDeliverySummary(client, issue.id, summary);
  client.setStatus(issue.id, "done");
  if (client.getIssue(issueKey).status !== "done") {
    throw new UnknownError("Bug Issue done 回读不一致");
  }
  client.deleteMetadata(issue.id, "finalize.pending");
  if (client.getIssue(issueKey).metadata?.["finalize.pending"]) {
    throw new UnknownError("Bug pending 清理回读不一致");
  }
  process.stdout.write(JSON.stringify({
    result: "PASS", issue: issueKey, status: "done", mode: "bug",
    steps: { pr_transition_gate: {status: "done"}, tfs_verification: {status: "done", detail: tfsVerified},
             summary: summaryResult, issue_done: {status: "done"},
             pending_cleared: {status: "done"}, route_archive: {status: "skipped"} },
  }, null, 2) + "\n");
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (!args.issue || !args.config || (args.phase !== "prepare" && args.phase !== "complete")) {
    process.stderr.write("用法: rondo delivery finalize --phase prepare|complete --issue <KEY|id> --config <repo-registry.json> [--root-repo <path>（使用本地工件时必填）]\n");
    return 64;
  }
  let remote: DeliveryArtifacts | undefined;
  let temporary: ReturnType<typeof checkoutArchiveRoot> | undefined;
  let archivePublished = false;
  try {
    const cfg = loadConfig<RegistryConfig>(args.config);
    const client = new MulticaClient(cfg.runtime);
    const tfs = new TfsClient();
    const issue = client.getIssue(args.issue);
    const md = issue.metadata ?? {};
    const issueKey = issue.identifier ?? args.issue;
    const steps: Record<string, StepResult> = {};

    // 0. 已 done：先核对对应交付事实，再清 pending；不重放副作用。
    if (issue.status === "done") {
      if (isDirectBugDelivery(md)) {
        let prs: CurrentPrEntry[];
        try { prs = JSON.parse(md.current_pr ?? "null") as CurrentPrEntry[]; }
        catch { throw new UnknownError("已完成 Bug 的 current_pr 不是合法 JSON"); }
        if (!Array.isArray(prs)) throw new FailError("已完成 Bug 缺少 current_pr");
        assertBugFinalizationFacts(md, issue.status, prs);
        if (md["delivery.tfs_written"] !== "true") throw new FailError("已完成 Bug 缺少 TFS Writeback 标记");
      } else {
        assertCompletedAnalysisFacts(md);
      }
      if (md["finalize.pending"]) {
        client.deleteMetadata(issue.id, "finalize.pending");
        steps.pending_cleared = { status: "done" };
      }
      process.stdout.write(JSON.stringify({ result: "PASS", issue: issueKey, already: "done", steps }, null, 2) + "\n");
      return 0;
    }

    // Direct Bug path has no root repository or OpenSpec Archive dependency.
    if (isDirectBugDelivery(md)) {
      return await finalizeDirectBug(cfg, client, tfs, issue, issueKey, args.phase as "prepare" | "complete");
    }

    // 本地根仓由调用方显式传入；只校验与派生路径。
    // 在任何持久化写入（finalize.pending）之前完成解析，失败即 UNKNOWN 零写入。
    // 显式配置固定分支才启用新路径；旧本地模式与独立 Bug 均保持原契约。
    const changeMode = isRequirementChangeDelivery(md);
    if (changeMode && !args["root-repo"]) throw new UnknownError("Requirement Closeout 必须使用受控 Clone，并显式传入 --root-repo");
    if (!args["root-repo"] && cfg.runtime.root_branch !== undefined) {
      if (!cfg.runtime.workspace_id) throw new UnknownError("远端收口必须显式配置 workspace_id");
      const authorized = readAnalysisSource(md);
      remote = await materializeDeliveryArtifacts(new RemoteArtifactReader(authorized.repo_url), md, changeMode ? authorized.branch : cfg.runtime.root_branch!);
      steps.remote_artifacts = { status: "done", detail: { repo_url: remote.source.repo_url, branch: remote.branch, commit: remote.commit, archived: remote.archived } };
    }
    const paths = remote?.paths ?? resolveRuntimePaths(cfg, { issue, rootRepoArg: args["root-repo"], need: ["openspec"] });
    const source = changeMode ? readAnalysisSource(md) : null;
    if (source) {
      Object.assign(paths, verifyCloseoutRoot(paths, source));
      assertCloseoutChange(paths, source);
    }

    // 1. 身份、Multica 的持久化 Change Kind 与 OpenSpec Engineering Contract：
    //    必须相互一致，不能从 TFS 类型单独推断技术变更性质。
    const tfsId = md["tfs.id"];
    if (!tfsId) throw new UnknownError("缺少 metadata tfs.id");
    const changeRef = md["analysis.change_ref"];
    assertStableChangeRef(changeRef);
    // Quality/approval gates belong to upstream stages, not Requirement Closeout.
    if (!changeMode) {
      const schema = readChangeSchema(resolveChangeDir(paths, changeRef).dir);
    const kindMismatch = changeKindSchemaViolation(md["analysis.change_kind"], schema);
    if (kindMismatch) throw new FailError(kindMismatch);
    const violation = sourceSchemaViolation(classifyTfsType(md["tfs.type"]), schema);
    if (violation) throw new FailError(violation);
    if (schema === "intentional-change" && md["analysis.ai_review.verdict"] !== "APPROVED") {
      throw new FailError("Intentional Change 缺少 APPROVED 的专业 AI Review");
    }
    // Fail closed before PR Transition, pending metadata, workspace reconciliation,
    // archive, or TFS writeback can produce externally visible side effects.
    if (assertProjectedVerifyDecision(md)) {
      throw new UnknownError("verify_agent.required=true，Independent Verification 尚未实现或未取得有效 PASS，禁止进入 Finalize");
    }
    }
    const prsRaw = md["current_pr"];
    if (!prsRaw) throw new UnknownError("缺少 metadata current_pr（无业务仓交付的收口路径 v1 未覆盖，交 Lead）");
    let prs: CurrentPrEntry[];
    try { prs = JSON.parse(prsRaw) as CurrentPrEntry[]; }
    catch { throw new UnknownError("metadata current_pr 不是合法 JSON"); }
    if (!Array.isArray(prs) || prs.length === 0) throw new UnknownError("current_pr 为空数组");

    // 2. PR Transition Gate（只读；全部 completed 才可持久化 completed 事件）
    await prTransitionGate(tfs, cfg, prs);
    steps.pr_transition_gate = { status: "done" };

    const expectedKeys = prs.map((p) => `${issueKey}#${p.repo_key}#${p.pr_id}#completed`);
    const parsePending = (raw: string): { event_keys?: unknown; prepared_change_ref?: unknown; recorded_at?: unknown } => {
      let value: unknown;
      try { value = JSON.parse(raw); }
      catch { throw new UnknownError("finalize.pending 不是合法 JSON"); }
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new UnknownError("finalize.pending 不是合法对象");
      return value as { event_keys?: unknown; prepared_change_ref?: unknown; recorded_at?: unknown };
    };
    const assertPendingEvents = (pending: { event_keys?: unknown }): void => {
      const found = pending.event_keys;
      if (!Array.isArray(found) || found.length !== expectedKeys.length ||
          expectedKeys.some((key) => !found.includes(key))) {
        throw new FailError("finalize.pending 与当前 PR 完成事件不一致，拒绝收口");
      }
    };

    if (args.phase === "prepare") {
      // pending 先记录恢复入口；prepared_change_ref 只能在归档及 Git Push 已确认后写入。
      let pending: { event_keys?: unknown; prepared_change_ref?: unknown; recorded_at?: unknown };
      if (!md["finalize.pending"]) {
        pending = { event_keys: expectedKeys, recorded_at: new Date().toISOString() };
        client.setMetadata(issue.id, "finalize.pending", JSON.stringify(pending));
        steps.pending_written = { status: "done", detail: expectedKeys };
      } else {
        pending = parsePending(md["finalize.pending"]);
        assertPendingEvents(pending);
        steps.pending_written = { status: "skipped", detail: "已存在（恢复模式，按当前事实补齐）" };
      }
      if (remote || changeMode) {
        steps.workspace_reconciliation = { status: "skipped", detail: "Closeout 不负责业务 Workspace 对账" };
      } else {
        const reconcileDetails: unknown[] = [];
        for (const entry of prs) reconcileDetails.push(reconcileWorkspace(cfg, paths, issueKey, entry));
        steps.workspace_reconciliation = { status: "done", detail: reconcileDetails };
      }

      // 已确认 Prepare 的 Requirement 只回读归档；事件或 Change 变更时应保留原恢复事实。
      if (source && pending.prepared_change_ref !== undefined) {
        if (pending.prepared_change_ref !== changeRef) {
          throw new FailError("finalize.pending 的已准备 Change 与当前 Change 不一致，拒绝恢复");
        }
        steps.archive_readback = { status: "done", detail: confirmPublishedArchive(paths, source) };
        steps.route_archive = { status: "skipped", detail: { archive: "skipped_already_archived" } };
        process.stdout.write(JSON.stringify({ result: "PASS", issue: issueKey, status: "prepared", steps }, null, 2) + "\n");
        return 0;
      }

      const change = resolveChangeDir(paths, changeRef);
      if (!changeMode) {
        deliveryCompletionGate(cfg, md, issue.status, change.dir, changeRef, { rootRepo: paths.rootRepo, issueKey, remote: Boolean(remote) });
        steps.completion_gate = { status: "done" };
      }
      if (remote?.archived) {
        steps.route_archive = { status: "done", detail: { archive: "skipped_already_archived", pushed: true, commit: remote.commit } };
      } else if (remote) {
        temporary = checkoutArchiveRoot(remote);
        const localChange = resolveChangeDir(temporary.paths, changeRef);
        deliveryCompletionGate(cfg, md, issue.status, localChange.dir, changeRef, { rootRepo: temporary.paths.rootRepo, issueKey, remote: true });
        steps.route_archive = { status: "done", detail: routeArchive(temporary.paths, issueKey, changeRef, tfsId, remote.commit) };
        archivePublished = true;
        // 用独立 API 回读已发布归档；不新增 Archive SHA Metadata。
        const confirmed = await materializeDeliveryArtifacts(new RemoteArtifactReader(remote.source.repo_url), md, remote.branch);
        try {
          if (!confirmed.archived) throw new UnknownError("归档 push 后远端仍未确认归档，禁止 Prepare 标记");
          deliveryCompletionGate(cfg, md, issue.status, confirmed.changeDir, changeRef, { rootRepo: confirmed.paths.rootRepo, issueKey, remote: true });
          steps.archive_readback = { status: "done", detail: { commit: confirmed.commit, archived: true } };
        } finally { confirmed.dispose(); }
      } else {
        steps.route_archive = { status: "done", detail: routeArchive(paths, issueKey, changeRef, tfsId) };
        if (source) steps.archive_readback = { status: "done", detail: confirmPublishedArchive(paths, source) };
      }
      // 只有安全归档 + Git Push 返回成功后才能给独立 TFS Writer 提供可执行准备事实。
      client.setMetadata(issue.id, "finalize.pending", JSON.stringify({ ...pending, prepared_change_ref: changeRef }));
      const persisted = client.getIssue(args.issue).metadata?.["finalize.pending"];
      if (!persisted) throw new UnknownError("Prepare 成功标记回读缺失，禁止 TFS Writeback");
      const confirmed = parsePending(persisted);
      assertPendingEvents(confirmed);
      if (confirmed.prepared_change_ref !== changeRef) throw new UnknownError("Prepare 成功标记回读不一致，禁止 TFS Writeback");
      process.stdout.write(JSON.stringify({ result: "PASS", issue: issueKey, status: "prepared", steps }, null, 2) + "\n");
      return 0;
    }

    // --phase complete 不重复准备/归档，只核实它们已经完成，且 TFS 外部管理写回成功。
    if (!md["finalize.pending"]) {
      throw new FailError("缺少 finalize.pending：必须先执行 delivery finalize --phase prepare");
    }
    const pending = parsePending(md["finalize.pending"]);
    assertPendingEvents(pending);
    if (pending.prepared_change_ref !== changeRef) {
      throw new UnknownError("当前 Change 尚无已确认的 Prepare / Git Push 成功事实");
    }
    // delivery.tfs_written 仅由独立的 TFS Writeback 在子任务和父项全部成功后置位。
    if (md["delivery.tfs_written"] !== "true") {
      throw new UnknownError("TFS Writeback 尚未完整成功（delivery.tfs_written != true），禁止 Issue done");
    }
    if (!resolveChangeDir(paths, changeRef).archived) {
      throw new UnknownError("工程 Change 尚未归档，不能跳过 prepare 直接 complete");
    }
    // 再次只读回核父项及全部 required TFS 子任务的外部真实状态；仅凭 Metadata 标记不足以 done。
    steps.tfs_verification = { status: "done", detail: await verifyTfsWriteback(
      cfg, issue, source ? paths.rootRepo : remote?.changeDir ?? resolveChangeDir(paths, changeRef).dir,
    ) };
    // 再次确定 Archive 已提交到远端；幂等回读，不操作 TFS Work Item/Task。
    if (source) {
      steps.route_archive = { status: "done", detail: confirmPublishedArchive(paths, source) };
    } else if (remote) {
      deliveryCompletionGate(cfg, md, issue.status, remote.changeDir, changeRef, { rootRepo: paths.rootRepo, issueKey, remote: true });
      steps.route_archive = { status: "done", detail: { archived: true, commit: remote.commit, source: "fixed_commit_api" } };
    } else {
      steps.route_archive = { status: "done", detail: routeArchive(paths, issueKey, changeRef, tfsId) };
    }

    // 先查询本次摘要；ID 缺失/旧 ID 均不能作为发布或跳过的依据。
    steps.summary = ensureDeliverySummary(client, issue.id,
      renderSummary(issueKey, tfsId, md["tfs.url"] ?? "", changeRef, prs));

    // 9. Issue → done（最后写入）+ 回读确认
    client.setStatus(issue.id, "done");
    const after = client.getIssue(args.issue);
    if (after.status !== "done") throw new UnknownError(`Issue 状态回读非 done（实际 ${after.status}）`);
    steps.issue_done = { status: "done" };

    // 10. 全部后置条件确认后清 pending
    client.deleteMetadata(issue.id, "finalize.pending");
    steps.pending_cleared = { status: "done" };

    // complete 阶段返回工程和 Multica 的确定性收口事实；TFS Writeback 单独提供结果。
    const orderedSteps: Record<string, StepResult> = {};
    for (const k of ["remote_artifacts", "pr_transition_gate", "pending_written", "workspace_reconciliation", "completion_gate", "tfs_verification",
      "summary", "route_archive", "issue_done", "pending_cleared"]) {
      if (steps[k]) orderedSteps[k] = steps[k];
    }
    process.stdout.write(JSON.stringify({ result: "PASS", issue: issueKey, status: "done", steps: orderedSteps }, null, 2) + "\n");
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
    // 推送已确认的临时 clone 可删除；未知或未发布提交保留现场。
    if (archivePublished) temporary?.dispose();
  }
}

/** commander 注册：group=delivery；参数解析沿用原脚本实现以保证契约逐字节等价。 */
export function registerDeliveryFinalize(group: Command): void {
  group
    .command("finalize")
    .description("交付收口")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      const code = await main(cmd.args);
      if (code !== 0) throw new ExitSignal(code);
    });
}
