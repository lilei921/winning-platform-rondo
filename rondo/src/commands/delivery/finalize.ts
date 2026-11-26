import { ensureDeliverySummary } from "./summary.js";
/** Prepare → TFS Writeback → Complete; current Requirement and Direct Bug only. */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { runCommand } from "../../clients/spawn.js";
import { resolveMulticaRuntime, type MulticaRuntime } from "../../clients/runtime-context.js";
import { MulticaClient } from "../../clients/multica.js";
import { TfsClient } from "../../clients/tfs.js";
import { resolveRuntimePaths, type RuntimePaths } from "../../clients/runtime-paths.js";
import { verifyTfsWriteback } from "../tfs/writeback.js";
import { assertStableChangeRef } from "../analysis/change-schema.js";
import { computeContractFiles, touchedCapabilities } from "./contract-files.js";
import { isRequirementChangeDelivery, approvedRequirementScope, assertRequirementPrepareGate, assertCompletedRequirementTasks } from "./requirement-mode.js";
import { readApprovedVerifyDecision } from "./verify-decision.js";
import { verifyCloseoutPrs, type CloseoutPr as CurrentPrEntry } from "./closeout-pr.js";
import { TfsClient as TfsApiClient } from "../../tfs/client.js";
import { isDirectBugDelivery, assertBugFinalizationFacts, bugDeliveryDigest } from "../bug/finalize-facts.js";
import { runAuthenticatedGit as runAuthenticatedRootGit } from "../../clients/authenticated-git.js";
import { readAnalysisSource } from "../analysis/source.js";
import { verifyCloseoutRoot, confirmPublishedArchive, assertCloseoutChange } from "./closeout-root.js";

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
function syncArchiveBranch(root: string, localBranch: string, targetBranch: string, allowed: (path: string) => boolean, remoteUrl?: string): void {
  if (gitOk(root, ["symbolic-ref", "--short", "HEAD"], "核对根仓分支") !== localBranch) {
    throw new UnknownError("归档期间根仓分支已变化（保留现场，停止推进）");
  }
  const upstream = `refs/remotes/origin/${targetBranch}`;
  gitOk(root, ["fetch", "origin", `refs/heads/${targetBranch}:${upstream}`], "刷新根仓远端分支", remoteUrl);
  const [ahead, behind] = gitOk(root, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`], "核对根仓分支关系")
    .split(/\s+/).map(Number);
  if (ahead > 0 && behind > 0) {
    throw new UnknownError(`根仓目标分支 ${targetBranch} 已分叉（本地领先 ${ahead}、落后 ${behind}；保留提交与工作区，停止自动收口）`);
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
export function routeArchive(paths: RuntimePaths, issueKey: string, changeRef: string, tfsId: string, targetBranch: string, waivedTasks: readonly string[] = []): Record<string, unknown> {
  const detail: Record<string, unknown> = {};
  const lock = new RootLock(paths, issueKey);
  try {
    const root = paths.rootRepo;
    // The Task-local branch is isolated from the approved remote publication target.
    const branchRes = git(root, ["symbolic-ref", "--short", "HEAD"]);
    if (branchRes.status !== 0 || !branchRes.stdout.trim()) {
      throw new UnknownError("根仓处于 detach HEAD 或无法探测本地归档分支");
    }
    const localBranch = branchRes.stdout.trim();
    const branch = targetBranch;
    if (runCommand(["git", "check-ref-format", "--branch", branch], root).status !== 0) {
      throw new FailError("归档远端目标分支非法");
    }
    detail.branch = branch;
    if (branch !== localBranch) detail.local_branch = localBranch;
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
    const initialChanges = checkWorkspace();
    // An untouched capability path is not proof that its existing changes belong to this Issue.
    // Recovery after OpenSpec has already moved the Change keeps its existing resume path.
    if (!current.archived && initialChanges.some(p => caps.some(c => p.startsWith(`openspec/specs/${c}/`)))) {
      throw new UnknownError("首次 Archive 前存在已修改的 Specs，无法确认属于当前 Change，保留现场");
    }
    // 新增本地提交之前同步，避免“先保存再拉取”制造本可避免的分叉。
    const preHash = JSON.stringify(computeContractFiles(current.dir).files);
    syncArchiveBranch(root, localBranch, branch, allowed, paths.gitRemoteUrl);
    const aligned = resolveChangeDir(paths, changeRef);
    if (aligned.dir !== current.dir || JSON.stringify(computeContractFiles(aligned.dir).files) !== preHash) {
      throw new UnknownError("根仓对齐后契约文件或归档位置漂移（此前 completion_gate PASS 失效，须重新核验）");
    }
    assertCompletedRequirementTasks(aligned.dir, waivedTasks);
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

    // One ordinary fast-forward push; resolve an uncertain reply from remote facts.
    checkWorkspace();
    syncArchiveBranch(root, localBranch, branch, allowed, paths.gitRemoteUrl);
    const archived = resolveChangeDir(paths, changeRef);
    if (!archived.archived || JSON.stringify(computeContractFiles(archived.dir).files) !== preHash) {
      throw new UnknownError("推送前归档契约漂移（保留现场，停止后续收口）");
    }
    const upstream = "refs/remotes/origin/" + branch;
    const unpushed = gitOk(root, ["rev-list", upstream + "..HEAD", "--count"], "核对未推送提交");
    if (unpushed !== "0") {
      const push = git(root, ["push", "origin", "HEAD:refs/heads/" + branch], paths.gitRemoteUrl);
      if (push.status !== 0) {
        // A lost response may mean success. Never reset/rebase after a rejected push.
        gitOk(root, ["fetch", "origin", "refs/heads/" + branch + ":" + upstream],
          "Push 结果不确定时回读远端", paths.gitRemoteUrl);
        if (git(root, ["merge-base", "--is-ancestor", "HEAD", upstream]).status !== 0) {
          throw new UnknownError("根仓 Push 未确认或发生 Non-Fast-Forward，保留本地 Commit: " + push.stderr.trim().slice(0, 300));
        }
        const folder = archived.dir.split(/[\\/]/).at(-1);
        const remoteArchive = upstream + ":openspec/changes/archive/" + folder;
        const localArchive = "HEAD:openspec/changes/archive/" + folder;
        if (gitOk(root, ["rev-parse", localArchive], "读取本地归档树") !==
            gitOk(root, ["rev-parse", remoteArchive], "回读远端归档树")) {
          throw new UnknownError("Push 回执不确定且远端归档内容不一致，保留现场");
        }
        for (const cap of caps) {
          const suffix = ":openspec/specs/" + cap;
          const localSpec = git(root, ["rev-parse", "HEAD" + suffix]);
          const remoteSpec = git(root, ["rev-parse", upstream + suffix]);
          if (localSpec.status !== remoteSpec.status ||
              (localSpec.status === 0 && localSpec.stdout.trim() !== remoteSpec.stdout.trim())) {
            throw new UnknownError("Push 回执不确定且远端 Specs 已变化，保留现场");
          }
        }
      }
    }
    detail.pushed = true;
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
  runtime: MulticaRuntime, client: MulticaClient, tfs: TfsClient,
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
  await verifyCloseoutPrs(md, new TfsApiClient(), tfs, undefined, verifiedSources);
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
  const tfsVerified = await verifyTfsWriteback(runtime, issue);
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
  if (!args.issue || argv.some(arg => arg === "--config" || arg.startsWith("--config=")) || (args.phase !== "prepare" && args.phase !== "complete")) {
    process.stderr.write("用法: rondo delivery finalize --phase prepare|complete --issue <KEY|id> [--root-repo <path>（Requirement 必填）]\n");
    return 64;
  }
  try {
    const runtime = resolveMulticaRuntime();
    const client = new MulticaClient(runtime);
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
      return await finalizeDirectBug(runtime, client, tfs, issue, issueKey, args.phase as "prepare" | "complete");
    }

    if (!isRequirementChangeDelivery(md)) throw new FailError("仅支持 Change-level Requirement 和 Direct Bug Closeout");
    if (issue.status === "blocked") throw new FailError("Issue blocked，禁止 Requirement Closeout");
    if (!args["root-repo"]) throw new UnknownError("Requirement Closeout 必须使用当前 Task 的 Multica Checkout，并显式传入 --root-repo");
    const source = readAnalysisSource(md);
    const paths = verifyCloseoutRoot(resolveRuntimePaths({ runtime }, { issue, rootRepoArg: args["root-repo"], need: ["openspec"] }), source);
    assertCloseoutChange(paths, source);
    const tfsId = md["tfs.id"];
    const changeRef = source.change_ref;
    const verified = await verifyCloseoutPrs(md, new TfsApiClient(), tfs, approvedRequirementScope(md, paths.rootRepo));
    const prs = verified.map(item => item.pr);
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
      // 已确认 Prepare 的 Requirement 只回读归档；事件或 Change 变更时应保留原恢复事实。
      if (pending.prepared_change_ref !== undefined) {
        if (pending.prepared_change_ref !== changeRef) {
          throw new FailError("finalize.pending 的已准备 Change 与当前 Change 不一致，拒绝恢复");
        }
        steps.archive_readback = { status: "done", detail: confirmPublishedArchive(paths, source) };
        steps.route_archive = { status: "skipped", detail: { archive: "skipped_already_archived" } };
        process.stdout.write(JSON.stringify({ result: "PASS", issue: issueKey, status: "prepared", steps }, null, 2) + "\n");
        return 0;
      }

      assertRequirementPrepareGate(md, issue.status);
      steps.completion_gate = { status: "done" };
      steps.route_archive = { status: "done", detail: routeArchive(paths, issueKey, changeRef, tfsId, source.branch, readApprovedVerifyDecision(md).waivedTasks) };
      steps.archive_readback = { status: "done", detail: confirmPublishedArchive(paths, source) };
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
    steps.tfs_verification = { status: "done", detail: await verifyTfsWriteback(runtime, issue, paths.rootRepo, verified) };
    steps.route_archive = { status: "done", detail: confirmPublishedArchive(paths, source) };

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
    for (const k of ["pr_transition_gate", "pending_written", "completion_gate", "tfs_verification",
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
