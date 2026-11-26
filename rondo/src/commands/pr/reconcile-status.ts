#!/usr/bin/env node
/**
 * reconcile-pr-status.ts — PR 终态检测与事实写入（02 §11 的确定性投影）。
 *
 * 调用方：PR Status Sync Agent（Autopilot cron 或手动触发）。
 * 职责：常规扫描 in_review / blocked；按需单独扫描 done 恢复 finalize.pending → 逐个回读 metadata
 *   （in_review 或已有 PR / 准备 / 收口事实的 blocked；按需补登已核实的 PR）
 *   → 逐 PR 经 TFS API 回核身份与状态 → 按 02 §11 聚合规则写事实 → 输出路由指令。
 * 本脚本只做终态检测与事实写入；收口动作由 Agent 按 SKILL.md 固定路由在同一 Run 内
 * 调 issue-closeout Skill 完成（脚本不内嵌调用）。
 *
 * 聚合规则（02 §11）：
 *   任一 abandoned → 写 pr.abandoned（event_key 已存在 → NO-OP）→ Issue blocked（保留 Assignee）
 *                    → action "stopped_abandoned"（§11.2 确定性停止，机器不解释原因）
 *   任一 UNKNOWN   → 不推进、不覆盖已有事实 → action "unknown"
 *   全部 completed → finalize.pending 已存在 → "resume_finalize"；否则先写 pending → "finalize"
 *   否则           → "noop"（§11.1：active 时不写评论、不唤醒、不改变任何流向）
 *
 * 用法：rondo pr reconcile-status [--issue <KEY> | --recover-done]
 * 退出码：0 全部处理成功（noop 也是成功）/ 2 存在单项失败（failures 逐项 reason）/
 *         3 扫描本身不可信（CLI/TFS 全局故障）/ 64 用法错误。stdout 只出 JSON；日志走 stderr。
 *
 * 运行环境：Node ≥ 23.6 直跑（22.6+ 需 --experimental-strip-types）；只用可擦除类型注解；零 npm 依赖。
 * --no-start 纪律贯穿全部写入；本脚本不创建任何 Issue / Run。
 *
 * 收编说明（D3 修订）：自 rondo 收编起，实现位置为 @winning/rondo 包内
 * commands/pr/reconcile-status.ts，原 projects/multica/workspace-skills/pr-status-sync/scripts/reconcile-pr-status.ts
 * 路径在迁移窗口期保持有效。
 */

import { multicaPrefix } from "../../clients/multica-environment.js";
import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { ExitSignal, logLine, markLeafExecuted } from "../../cli/output.js";
import { runCommand } from "../../clients/spawn.js";
import { resolveMulticaRuntime, type MulticaRuntime } from "../../clients/runtime-context.js";
import { loadConfig as loadTfsConfig, ConfigError } from "../../tfs/config.js";
import { parseTfsPrWebUrl } from "../../tfs/api/pr.js";
import { recoverPreparedPrs } from "./materialize.js";
import { MulticaClient, type IssueRecord } from "../../clients/multica.js";
import { FailError } from "../../tfs/client.js";
import { dispatchTfs, UsageError } from "../../tfs/dispatch.js";

interface CurrentPrEntry {
  repo_key: string;
  pr_id: number;
  pr_url: string;
  source_branch: string;
  target_branch: string;
}

interface AbandonedEntry { repo_key: string; pr_id: number; event_key: string; detected_at: string }

interface Action {
  issue: string;
  action: "finalize" | "resume_finalize" | "stopped_abandoned" | "noop" | "unknown";
  event_keys?: string[];
  detail?: string;
}

export function classifyProviderStatus(value: unknown): "active" | "completed" | "abandoned" | "unknown" {
  if (value === "active" || value === "completed" || value === "abandoned") return value;
  return "unknown";
}

function log(msg: string): void { logLine(msg); }

/** TFS API 进程内调用（rondo 合并后，等价原 tfs-cli 契约：rc 0 成功 / rc 2 单项失败数据返回 / rc 3 UNKNOWN 标记）。 */
async function tfsApiJson(args: string[], what: string): Promise<{ data: unknown; tfsUnknown: boolean }> {
  try {
    return { data: await dispatchTfs(args), tfsUnknown: false };
  } catch (e) {
    if (e instanceof FailError) {
      // rc 2 等价：FAIL JSON 作为数据返回（如 found:false）
      try { return { data: JSON.parse(e.message), tfsUnknown: false }; }
      catch { return { data: { error: e.message }, tfsUnknown: false }; }
    }
    if (e instanceof UsageError) {
      throw new UnknownError(`${what} 命令失败 rc=64: ${e.message}`);
    }
    // ConfigError / TfsUnknownError / 其他 → tfs-cli main 一律归 exit 3
    return { data: null, tfsUnknown: true };
  }
}

/** Multica CLI 调用（失败即 UNKNOWN 上抛——Multica 不可用 = 扫描不可信）。 */
function multicaJson(cmd: string[], what: string): unknown {
  const cp = runCommand(cmd);
  if (cp.status !== 0) throw new UnknownError(`${what} 命令失败 rc=${cp.status}: ${cp.stderr.trim() || cp.stdout.trim()}`);
  try { return JSON.parse(cp.stdout); }
  catch (exc) { throw new UnknownError(`${what} 输出不是合法 JSON: ${exc}`); }
}

// --- 命令特化的 Multica / TFS 调用形态（共享层缺口，见移植报告）。flag 已对照 0.6.1 核验；升级 CLI 版本后须复核。 ---
function wsArgs(cfg: MulticaRuntime): string[] {
  return cfg.workspace_id ? ["--workspace-id", cfg.workspace_id] : [];
}

/** 支持 CLI 的数组分页和带 has_more 的对象分页；仅返回候选身份，metadata 按需回读。 */
export function collectStatusPages(fetchPage: (offset: number, limit: number) => unknown, limit = 100): IssueRecord[] {
  const out: IssueRecord[] = [];
  let offset = 0;
  for (;;) {
    const raw = fetchPage(offset, limit);
    const items = Array.isArray(raw) ? raw : (raw as { issues?: IssueRecord[] } | null)?.issues;
    if (!Array.isArray(items)) throw new UnknownError("Issue 列表不是预期的数组或 issues 对象");
    out.push(...items);
    const explicitMore = Array.isArray(raw) ? undefined : (raw as { has_more?: boolean }).has_more;
    const hasMore = explicitMore ?? (items.length === limit);
    if (!hasMore) break;
    if (items.length === 0) throw new UnknownError("Issue 分页声称有下一页但返回空列表");
    offset += items.length;
  }
  return out;
}

function listByStatus(cfg: MulticaRuntime, status: string): IssueRecord[] {
  return collectStatusPages((offset, limit) => multicaJson(
    [...multicaPrefix(cfg), "issue", "list", "--status", status,
     "--limit", String(limit), "--offset", String(offset), "--fields", "id,identifier,status",
     ...wsArgs(cfg), "--output", "json"],
    `扫描 Issue(status=${status})`,
  ));
}

/** 使用解析后的 TFS PR 定位参数回核身份及状态。 */
async function prGet(project: string, repository: string, prId: number): Promise<{
  status: "ok" | "not_found" | "tfs_unknown" | "invalid";
  pr?: { id?: number; status?: string; sourceBranch?: string; targetBranch?: string };
}> {
  const r = await tfsApiJson(
    ["pr", "get", "--repo", repository, "--id", String(prId), "--project", project],
    "回核 PR #" + prId + "(" + repository + ")",
  );
  if (r.tfsUnknown) return { status: "tfs_unknown" };
  const d = r.data as { found?: boolean; id?: number; status?: string; sourceBranch?: string; targetBranch?: string } | null;
  if (d?.found === false) return { status: "not_found" };
  if (!d || d.id !== prId || typeof d.sourceBranch !== "string" ||
      typeof d.targetBranch !== "string" || classifyProviderStatus(d.status) === "unknown") {
    return { status: "invalid" };
  }
  return { status: "ok", pr: d };
}

/** 单 Issue 处理（02 §11 聚合规则的确定性投影）。写失败抛 Error 由上层记入 failures。 */
export async function processIssue(
  multica: Pick<MulticaClient, "setMetadata" | "setStatus">,
  issue: IssueRecord,
  tfs: { attempts: number; successes: number },
  lookupPr: typeof prGet = prGet,
  tfsCollectionUrl?: string,
  recoverMissing?: (issue: IssueRecord) => Promise<{issue: IssueRecord; detail?: string}>,
): Promise<Action | null> {
  let md = issue.metadata ?? {};
  const issueKey = issue.identifier ?? issue.id;
  const pendingRaw = md["finalize.pending"];
  let currentPrRaw = md["current_pr"];
  // done 的交付已完成：仅交由 finalize 清理残留 pending，不重新判断 PR 或改变已完成状态。
  if (issue.status === "done") {
    return pendingRaw
      ? { issue: issueKey, action: "resume_finalize", detail: "Issue 已 done，仅核对并清理 finalize.pending" }
      : null;
  }
  let prs: CurrentPrEntry[];
  let prepared: {repo_key: string}[];
  try { prs = JSON.parse(currentPrRaw ?? "[]"); }
  catch { return { issue: issueKey, action: "unknown", detail: "metadata current_pr 不是合法 JSON" }; }
  if (!Array.isArray(prs)) return { issue: issueKey, action: "unknown", detail: "current_pr 不是数组" };
  try { prepared = JSON.parse(md.pr_prep ?? "[]"); }
  catch { return { issue: issueKey, action: "unknown", detail: "pr_prep 不是合法 JSON" }; }
  if (!Array.isArray(prepared)) return { issue: issueKey, action: "unknown", detail: "pr_prep 不是数组" };
  if (!prs.length && !pendingRaw && issue.status !== "in_review" &&
      !(issue.status === "blocked" && prepared.length)) return null;

  let recoveryDetail: string | undefined;
  if (recoverMissing && (issue.status === "in_review" || issue.status === "blocked") &&
      prepared.some(p => p && !prs.some(pr => pr?.repo_key === p.repo_key))) {
    const recovered = await recoverMissing(issue);
    issue = recovered.issue;
    md = issue.metadata ?? {};
    currentPrRaw = md.current_pr;
    recoveryDetail = recovered.detail;
    prs = JSON.parse(currentPrRaw ?? "[]");
  }
  if (!prs.length) {
    return { issue: issueKey, action: "unknown", detail: recoveryDetail ?? "缺少 current_pr，无法确认 PR 交付" };
  }

  // done 恢复无需 TFS；其他路径只在存在 PR 登记时读取 TFS 连接配置。
  const collectionUrl = tfsCollectionUrl ?? loadTfsConfig().serverUrl;
  const unknowns: string[] = recoveryDetail ? [recoveryDetail] : [];
  const abandoned: CurrentPrEntry[] = [];
  const seenRepoKeys = new Set<string>();
  let completedCount = 0;
  for (const entry of prs) {
    if (!entry || typeof entry.repo_key !== "string" || !entry.repo_key.trim() ||
        !Number.isSafeInteger(entry.pr_id) || entry.pr_id <= 0 ||
        typeof entry.source_branch !== "string" || !entry.source_branch ||
        typeof entry.target_branch !== "string" || !entry.target_branch ||
        typeof entry.pr_url !== "string" || seenRepoKeys.has(entry.repo_key)) {
      unknowns.push("current_pr 包含无效或重复的 PR 登记");
      continue;
    }
    seenRepoKeys.add(entry.repo_key);
    const location = parseTfsPrWebUrl(entry.pr_url, collectionUrl);
    if (!location || location.prId !== entry.pr_id) {
      unknowns.push(entry.repo_key + ": PR URL 与配置的 TFS Collection 或登记 ID 不匹配");
      continue;
    }
    tfs.attempts++;
    const got = await lookupPr(location.project, location.repository, entry.pr_id);
    if (got.status === "tfs_unknown") { unknowns.push(entry.repo_key + "#" + entry.pr_id + ": TFS 查询 UNKNOWN"); continue; }
    if (got.status === "not_found") { unknowns.push(entry.repo_key + ": 已登记 PR #" + entry.pr_id + " 外部查无"); continue; }
    if (got.status === "invalid") { unknowns.push(entry.repo_key + ": PR #" + entry.pr_id + " 回核身份或状态无效"); continue; }
    const pr = got.pr!;
    if (pr.id !== entry.pr_id || pr.sourceBranch !== entry.source_branch || pr.targetBranch !== entry.target_branch) {
      unknowns.push(entry.repo_key + ": PR #" + entry.pr_id + " 身份或分支与登记不符");
      continue;
    }
    const status = classifyProviderStatus(pr.status);
    if (status === "unknown") { unknowns.push(entry.repo_key + ": PR #" + entry.pr_id + " 状态不可识别"); continue; }
    tfs.successes++;
    if (status === "abandoned") abandoned.push(entry);
    else if (status === "completed") completedCount++;
    // active 不写入交付事实。
  }

  // 聚合（顺序即 02 §11 优先级）：abandoned → unknown → completed → noop
  if (abandoned.length > 0) {
    let known: AbandonedEntry[] = [];
    const knownRaw = md["pr.abandoned"];
    if (knownRaw) {
      try { known = JSON.parse(knownRaw) as AbandonedEntry[]; } catch { known = []; }
    }
    const knownKeys = new Set(known.map((k) => k.event_key));
    const fresh = abandoned
      .map((e) => ({ repo_key: e.repo_key, pr_id: e.pr_id, event_key: `${issueKey}#${e.repo_key}#${e.pr_id}#abandoned`, detected_at: new Date().toISOString() }))
      .filter((e) => !knownKeys.has(e.event_key));
    if (fresh.length === 0) {
      // 同 event_key 已停止过 → 严格 NO-OP（不重复写 blocked、不重指派；人工后续动作不被机器覆盖）
      return { issue: issueKey, action: "stopped_abandoned", detail: "already_stopped（幂等 NO-OP）" };
    }
    // §11.4：先持久化 abandoned 事实，再做状态写入
    multica.setMetadata(issue.id, "pr.abandoned", JSON.stringify([...known, ...fresh]));
    if (issue.status !== "blocked") multica.setStatus(issue.id, "blocked");
    // PR 状态同步只负责停止推进，不改变当前 Issue Owner。
    return {
      issue: issueKey, action: "stopped_abandoned",
      event_keys: fresh.map((e) => e.event_key),
      detail: unknowns.length > 0 ? `另有 ${unknowns.length} 项 UNKNOWN: ${unknowns[0]}` : undefined,
    };
  }

  if (unknowns.length > 0) {
    return { issue: issueKey, action: "unknown", detail: unknowns.join("；") };
  }

  // Materialize can persist a partial set. Never treat it as the full delivery.
  if (!prepared.length || prepared.length !== prs.length ||
      prepared.some(p => !p || typeof p.repo_key !== "string" || !p.repo_key.trim()) ||
      new Set(prepared.map(p => p.repo_key)).size !== prepared.length ||
      prepared.some(p => !prs.some(pr => pr?.repo_key === p.repo_key))) {
    return { issue: issueKey, action: "unknown", detail: "current_pr 与 pr_prep 仓库集合不完整，禁止收口" };
  }

  if (completedCount === prs.length) {
    if (issue.status !== "in_review") {
      return { issue: issueKey, action: "noop", detail: issue.status === "blocked"
        ? "PR 已全部 completed，Issue blocked，保留收口事实"
        : "PR 已全部 completed，等待 Materialize 确认 in_review" };
    }
    if (pendingRaw) {
      return { issue: issueKey, action: "resume_finalize", detail: "finalize.pending 已存在，按当前事实补齐" };
    }
    const eventKeys = prs.map((p) => `${issueKey}#${p.repo_key}#${p.pr_id}#completed`);
    // §11.4：先于任何收口副作用持久化 completed 事件
    multica.setMetadata(issue.id, "finalize.pending",
      JSON.stringify({ event_keys: eventKeys, recorded_at: new Date().toISOString() }));
    return { issue: issueKey, action: "finalize", event_keys: eventKeys };
  }

  return { issue: issueKey, action: "noop", detail: `${completedCount}/${prs.length} PR completed，其余 active（§11.1 NO-OP）` };
}

function parseArgs(argv: string[]): { issue?: string; recoverDone: boolean } | null {
  let issue: string | undefined;
  let recoverDone = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--recover-done" && !recoverDone) { recoverDone = true; continue; }
    if (argv[i] === "--issue" && !issue && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      issue = argv[++i];
      continue;
    }
    return null; // 包括已退役的 --config
  }
  return { issue, recoverDone };
}

async function main(rawArgs: string[]): Promise<number> {
  const args = parseArgs(rawArgs);
  if (!args) {
    process.stderr.write("用法: rondo pr reconcile-status [--issue <KEY> | --recover-done]\n");
    return 64;
  }
  if (args.issue && args.recoverDone) {
    process.stderr.write("--issue 与 --recover-done 不可同时使用\n");
    return 64;
  }
  try {
    const cfg = resolveMulticaRuntime();
    const multica = new MulticaClient(cfg);

    // 常规巡检不遍历所有历史 done；--recover-done 用于独立、低频恢复扫描。
    let candidates: IssueRecord[];
    if (args.issue) {
      candidates = [multica.getIssue(args.issue)];
    } else if (args.recoverDone) {
      candidates = listByStatus(cfg, "done");
    } else {
      const inReview = listByStatus(cfg, "in_review");
      const blocked = listByStatus(cfg, "blocked");
      candidates = [...inReview, ...blocked];
    }

    const actions: Action[] = [];
    const failures: Array<{ issue: string; error: string }> = [];
    const tfs = { attempts: 0, successes: 0 };

    for (const cand of candidates) {
      let issue: IssueRecord;
      try {
        issue = args.issue ? cand : multica.getIssue(cand.identifier ?? cand.id); // 逐条回读 metadata
      } catch (exc) {
        failures.push({ issue: cand.identifier ?? cand.id, error: `回读失败: ${exc instanceof Error ? exc.message : exc}` });
        continue;
      }
      try {
        const action = await processIssue(multica, issue, tfs, prGet, undefined,
          candidate => recoverPreparedPrs(multica, candidate));
        if (action) actions.push(action);
      } catch (exc) {
        if (exc instanceof ConfigError) throw new UnknownError("TFS 连接配置不可用: " + exc.message);
        // 单项写入失败：记入 failures，不中断其余 Issue
        failures.push({ issue: issue.identifier ?? issue.id, error: exc instanceof Error ? exc.message : String(exc) });
      }
    }

    // TFS 全局故障探测：有回核尝试但零成功 → 扫描不可信（exit 3）
    if (tfs.attempts > 0 && tfs.successes === 0) {
      process.stdout.write(JSON.stringify({
        result: "UNKNOWN",
        reason: `TFS PR 回核全部失败（${tfs.attempts} 次尝试 0 成功）——终态检测不可信，本轮不写任何事实`,
        scanned: candidates.length, actions, failures,
      }, null, 2) + "\n");
      return 3;
    }

    const result = {
      result: failures.length === 0 ? "PASS" : "FAIL",
      scanned: candidates.length,
      included: actions.length,
      actions,
      failures,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return failures.length === 0 ? 0 : 2;
  } catch (exc) {
    if (exc instanceof UnknownError) {
      process.stdout.write(JSON.stringify({ result: "UNKNOWN", reason: exc.message }, null, 2) + "\n");
      log(`UNKNOWN: ${exc.message}`);
      return 3;
    }
    throw exc;
  }
}

/** commander 注册：group=pr；参数解析沿用原脚本实现以保证契约逐字节等价。 */
export function registerPrReconcileStatus(group: Command): void {
  group
    .command("reconcile-status")
    .description("PR 状态对账")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      throw new ExitSignal(await main(cmd.args));
    });
}
