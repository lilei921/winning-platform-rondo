#!/usr/bin/env node
/**
 * reconcile-pr-status.ts — PR 终态检测与事实写入（02 §11 的确定性投影）。
 *
 * 调用方：PR Status Sync Agent（Autopilot cron 或手动触发）。
 * 职责：常规扫描 in_review / blocked；按需单独扫描 done 恢复 finalize.pending → 逐个回读 metadata
 *   （有 current_pr 或 finalize.pending 才纳入）
 *   → 逐 PR 经 TFS API 回核身份与状态 → 按 02 §11 聚合规则写事实 → 输出路由指令。
 * 本脚本只做终态检测与事实写入；收口动作由 Agent 按 SKILL.md 固定路由在同一 Run 内
 * 调 issue-closeout Skill 完成（脚本不内嵌调用）。
 *
 * 聚合规则（02 §11）：
 *   任一 abandoned → 写 pr.abandoned（event_key 已存在 → NO-OP）→ Issue blocked + assignee=Squad
 *                    → action "stopped_abandoned"（§11.2 确定性停止，机器不解释原因）
 *   任一 UNKNOWN   → 不推进、不覆盖已有事实 → action "unknown"
 *   全部 completed → finalize.pending 已存在 → "resume_finalize"；否则先写 pending → "finalize"
 *   否则           → "noop"（§11.1：active 时不写评论、不唤醒、不改变任何流向）
 *
 * 用法：rondo pr reconcile-status --config <repo-registry.json> [--issue <KEY> | --recover-done]
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
import { loadConfig, type BaseRegistryConfig, type RuntimeConfig } from "../../clients/config.js";
import { MulticaClient, type IssueRecord } from "../../clients/multica.js";
import { FailError } from "../../tfs/client.js";
import { dispatchTfs, UsageError } from "../../tfs/dispatch.js";
import { isDirectBugDelivery } from "../bug/finalize-facts.js";

interface RepoEntry {
  repo_path: string;
  tfs_repo?: string;
  tfs_project?: string;
  default_target_branch?: string;
}

interface RegistryConfig extends BaseRegistryConfig {
  runtime: RuntimeConfig & { delivery_squad_id: string };
  registry: Record<string, RepoEntry>;
}

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
function wsArgs(cfg: RegistryConfig): string[] {
  return cfg.runtime.workspace_id ? ["--workspace-id", cfg.runtime.workspace_id] : [];
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

function listByStatus(cfg: RegistryConfig, status: string): IssueRecord[] {
  return collectStatusPages((offset, limit) => multicaJson(
    [...multicaPrefix(cfg.runtime), "issue", "list", "--status", status,
     "--limit", String(limit), "--offset", String(offset), "--fields", "id,identifier,status",
     ...wsArgs(cfg), "--output", "json"],
    `扫描 Issue(status=${status})`,
  ));
}

function assignToSquad(cfg: RegistryConfig, issueId: string): void {
  multicaJson(
    [...multicaPrefix(cfg.runtime), "issue", "assign", issueId,
     "--to-id", cfg.runtime.delivery_squad_id, "--no-start", ...wsArgs(cfg), "--output", "json"],
    `Issue ${issueId} assignee → Delivery Squad`,
  );
}

/** 回核 PR：返回 { status, sourceBranch, targetBranch }；found:false / tfs UNKNOWN 经 tfsUnknown 标记区分。 */
async function prGet(cfg: RegistryConfig, repoKey: string, prId: number): Promise<{ status: "ok" | "not_found" | "tfs_unknown"; pr?: { status?: string; sourceBranch?: string; targetBranch?: string } }> {
  const repo = cfg.registry[repoKey];
  const r = await tfsApiJson(
    ["pr", "get", "--repo", repo.tfs_repo as string, "--id", String(prId), "--project", repo.tfs_project as string],
    `回核 PR #${prId}(${repoKey})`,
  );
  if (r.tfsUnknown) return { status: "tfs_unknown" };
  const d = r.data as { found?: boolean; status?: string; sourceBranch?: string; targetBranch?: string };
  if (d.found === false) return { status: "not_found" };
  return { status: "ok", pr: d };
}

/** 单 Issue 处理（02 §11 聚合规则的确定性投影）。写失败抛 Error 由上层记入 failures。 */
export async function processIssue(
  multica: Pick<MulticaClient, "setMetadata" | "setStatus">,
  cfg: RegistryConfig,
  issue: IssueRecord,
  tfs: { attempts: number; successes: number },
  lookupPr: typeof prGet = prGet,
  assign: typeof assignToSquad = assignToSquad,
): Promise<Action | null> {
  const md = issue.metadata ?? {};
  const issueKey = issue.identifier ?? issue.id;
  const pendingRaw = md["finalize.pending"];
  const currentPrRaw = md["current_pr"];
  // done 的交付已完成：仅交由 finalize 清理残留 pending，不重新判断 PR 或改变已完成状态。
  if (issue.status === "done") {
    return pendingRaw
      ? { issue: issueKey, action: "resume_finalize", detail: "Issue 已 done，仅核对并清理 finalize.pending" }
      : null;
  }
  if (!currentPrRaw && !pendingRaw) return null; // 无 PR 事实，不纳入

  if (!currentPrRaw) {
    return { issue: issueKey, action: "unknown", detail: "finalize.pending 存在但 current_pr 缺失（事实状态破损，交 Lead 核对）" };
  }
  let prs: CurrentPrEntry[];
  try { prs = JSON.parse(currentPrRaw) as CurrentPrEntry[]; }
  catch { return { issue: issueKey, action: "unknown", detail: "metadata current_pr 不是合法 JSON" }; }
  if (!Array.isArray(prs) || prs.length === 0) {
    return { issue: issueKey, action: "unknown", detail: "current_pr 为空数组" };
  }

  // 逐 PR 回核身份与状态（先全部确认，再聚合写入——不在身份未明时写任何事实）
  const unknowns: string[] = [];
  const abandoned: CurrentPrEntry[] = [];
  let completedCount = 0;
  for (const entry of prs) {
    const repo = cfg.registry[entry.repo_key];
    if (!repo) {
      unknowns.push(`repo_key 未登记: ${entry.repo_key}`);
      continue;
    }
    if (!repo.tfs_repo || !repo.tfs_project) {
      unknowns.push(`${entry.repo_key}: 缺少 tfs_repo/tfs_project 交付配置，无法回核 PR`);
      continue;
    }
    tfs.attempts++;
    const got = await lookupPr(cfg, entry.repo_key, entry.pr_id);
    if (got.status === "tfs_unknown") { unknowns.push(`${entry.repo_key}#${entry.pr_id}: TFS 查询 UNKNOWN`); continue; }
    if (got.status === "not_found") { unknowns.push(`${entry.repo_key}: 已登记 PR #${entry.pr_id} 外部查无（身份不可确认）`); continue; }
    tfs.successes++;
    const pr = got.pr!;
    if (pr.sourceBranch !== entry.source_branch || pr.targetBranch !== entry.target_branch) {
      unknowns.push(`${entry.repo_key}: PR #${entry.pr_id} 分支事实与登记不符（${pr.sourceBranch}→${pr.targetBranch} vs ${entry.source_branch}→${entry.target_branch}）`);
      continue;
    }
    const status = classifyProviderStatus(pr.status);
    if (status === "abandoned") abandoned.push(entry);
    else if (status === "completed") completedCount++;
    else if (status === "unknown") unknowns.push(`${entry.repo_key}: PR #${entry.pr_id} 返回未知状态 ${JSON.stringify(pr.status)}`);
    // 仅明确的 active 可以继续等待；缺失或不支持的 status 不能作为 noop。
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
    // Independent Bug delivery remains with its Bug Fix Agent on PR abandonment;
    // it must not be silently reassigned to a Squad Lead.
    if (!isDirectBugDelivery(md) && issue.assignee_id !== cfg.runtime.delivery_squad_id) assign(cfg, issue.id);
    return {
      issue: issueKey, action: "stopped_abandoned",
      event_keys: fresh.map((e) => e.event_key),
      detail: unknowns.length > 0 ? `另有 ${unknowns.length} 项 UNKNOWN: ${unknowns[0]}` : undefined,
    };
  }

  if (unknowns.length > 0) {
    return { issue: issueKey, action: "unknown", detail: unknowns.join("；") };
  }

  if (completedCount === prs.length) {
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

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--recover-done") { out["recover-done"] = "true"; continue; }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { out[key] = next; i++; }
    }
  }
  return out;
}

async function main(rawArgs: string[]): Promise<number> {
  const args = parseArgs(rawArgs);
  if (!args.config) {
    process.stderr.write("用法: rondo pr reconcile-status --config <repo-registry.json> [--issue <KEY> | --recover-done]\n");
    return 64;
  }
  if (args.issue && args["recover-done"]) {
    process.stderr.write("--issue 与 --recover-done 不可同时使用\n");
    return 64;
  }
  try {
    const cfg = loadConfig<RegistryConfig>(args.config);
    if (!cfg.runtime?.delivery_squad_id) {
      throw new UnknownError("配置缺少 runtime.delivery_squad_id");
    }
    const multica = new MulticaClient(cfg.runtime);

    // 常规巡检不遍历所有历史 done；--recover-done 用于独立、低频恢复扫描。
    let candidates: IssueRecord[];
    if (args.issue) {
      candidates = [multica.getIssue(args.issue)];
    } else if (args["recover-done"]) {
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
        const action = await processIssue(multica, cfg, issue, tfs);
        if (action) actions.push(action);
      } catch (exc) {
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
