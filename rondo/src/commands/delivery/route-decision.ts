/** Human-authorized Requirement recovery; semantic work is coordinated in the current Issue. */
import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { loadConfig, type BaseRegistryConfig, type RuntimeConfig } from "../../clients/config.js";
import { MulticaClient } from "../../clients/multica.js";
import { FailError } from "../../tfs/client.js";
import { dispatchTfs, UsageError } from "../../tfs/dispatch.js";
interface RegistryConfig extends BaseRegistryConfig {
  runtime: RuntimeConfig;
  registry: Record<string, { repo_path: string; tfs_repo?: string; tfs_project?: string; default_target_branch?: string }>;
}

interface DecisionEntry {
  comment_id: string;
  reason: string | null;
  next: string;
  routed_to: string;
  applied_at: string;
  /** 本脚本负责的路由副作用已完成；重跑不得重新启动已完成的返工。 */
  completed_at?: string;
}

interface PrPrepEntry {
  repo_key: string;
  source_branch: string;
  target_branch?: string;
  candidate_commit: string;
  title: string;
  description_ref?: string;
}

interface CurrentPrEntry {
  repo_key: string;
  pr_id: number;
  pr_url: string;
  source_branch: string;
  target_branch: string;
}

interface AbandonedEntry { repo_key: string; pr_id: number; event_key: string; detected_at: string }

const NEXTS = ["ANALYSIS", "ENGINEERING", "RECREATE_PR", "CANCEL_DELIVERY"] as const;
type Next = (typeof NEXTS)[number];

function log(msg: string): void { process.stderr.write(msg + "\n"); }

/** tfs-cli 契约：rc 0 成功 / rc 2 单项失败（stdout 仍 JSON）/ rc 3 UNKNOWN。 */
/** TFS API 进程内调用（rondo 合并后，等价原 tfs-cli 契约：rc 0 成功 / rc 2 数据返回 / rc 3 UNKNOWN 标记）。 */
async function runTfs(args: string[], what: string): Promise<{ data: unknown; tfsUnknown: boolean }> {
  try {
    return { data: await dispatchTfs(args), tfsUnknown: false };
  } catch (e) {
    if (e instanceof FailError) {
      try { return { data: JSON.parse(e.message), tfsUnknown: false }; }
      catch { return { data: { error: e.message }, tfsUnknown: false }; }
    }
    if (e instanceof UsageError) {
      throw new UnknownError(`${what} 命令失败 rc=64: ${e.message}`);
    }
    return { data: null, tfsUnknown: true };
  }
}

// --- Multica 特化方法（共享 MulticaClient 未覆盖的形态，经 client.run 透传）。flag 已对照 0.6.1 核验；升级 CLI 版本后须复核。 ---
// M3.2：runJsonStdin 已上提 clients/spawn.js；setStatusNoStart/reopenWithStart/addComment 已收编
// MulticaClient（带回读确认）；本文件只保留 commentExists/commentMentions 两个只读核对。

function commentExists(client: MulticaClient, issueKey: string, commentId: string): boolean {
  const out = client.run(
    ["issue", "comment", "list", issueKey, "--full", ...client.ws(), "--output", "json"],
    `读取 Issue ${issueKey} 评论列表`,
    { transient: true },
  );
  const arr = Array.isArray(out) ? out : [];
  return arr.some((c) => (c as { id?: string }).id === commentId);
}

/** 流转事实写入一律 --no-start（状态与 Run 生命周期分离）。M3.2：委托共享回读确认。 */
function setStatusNoStart(client: MulticaClient, issueId: string, status: string): void {
  client.setStatusNoStart(issueId, status);
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

function parseJsonArray<T>(raw: string | undefined, keyName: string, issueKey: string): T[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new UnknownError(`Issue ${issueKey} 的 metadata ${keyName} 不是合法 JSON`); }
  if (!Array.isArray(parsed)) throw new UnknownError(`Issue ${issueKey} 的 metadata ${keyName} 不是数组`);
  return parsed as T[];
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (!args.config || !args.issue || !args["comment-id"] || !args.next) {
    process.stderr.write(
      "用法: rondo delivery route-decision --config <repo-registry.json> --issue <KEY>\n" +
      "  --comment-id <uuid> --next ANALYSIS|ENGINEERING|RECREATE_PR|CANCEL_DELIVERY\n" +
      "  [--reason REJECTED|DISCARDED]\n",
    );
    return 64;
  }
  if (!(NEXTS as readonly string[]).includes(args.next)) {
    process.stderr.write(`--next 只能是 ${NEXTS.join("|")}，收到: ${args.next}\n`);
    return 64;
  }
  const next = args.next as Next;
  if (argv.includes("--affected-task-refs")) return 64;

  try {
    const cfg = loadConfig<RegistryConfig>(args.config);
    const client = new MulticaClient(cfg.runtime);
    const issue = client.getIssue(args.issue);
    const issueKey = issue.identifier ?? issue.id;
    const md = issue.metadata ?? {};

    // --- 前置校验（不过 → UNKNOWN 零写入，02 §11.2 UNKNOWN 清单） ---
    // 顺序：触发评论可确认 → 幂等（已处理同 comment_id → NOOP，无论当前状态）→ 场景前置（blocked + pr.abandoned）
    if (!commentExists(client, issueKey, args["comment-id"])) {
      throw new UnknownError(`--comment-id ${args["comment-id"]} 不在 Issue ${issueKey} 的评论列表中（触发评论不可确认）`);
    }

    const decisions = parseJsonArray<DecisionEntry>(md["dev.decision"], "dev.decision", issueKey);
    const noop = (prior: DecisionEntry): number => {
      process.stdout.write(JSON.stringify({ result: "NOOP", reason: "同一 comment_id 的 Decision 已处理（02 §11.2 单次触发）", comment_id: args["comment-id"], prior }, null, 2) + "\n");
      return 0;
    };
    const completeDecision = (): void => {
      // 回读后更新单条，避免把执行期间产生的其他决定覆盖掉。
      const latest = parseJsonArray<DecisionEntry>(client.getIssue(issueKey).metadata?.["dev.decision"], "dev.decision", issueKey);
      const current = latest.find(d => d.comment_id === args["comment-id"]);
      if (!current) throw new UnknownError("路由完成但原 Decision 已不存在，停止写入完成事实");
      if (!current.completed_at) {
        client.setMetadata(issue.id, "dev.decision", JSON.stringify(latest.map(d => d === current ? { ...d, completed_at: new Date().toISOString() } : d)));
      }
    };
    const prior = decisions.find((d) => d.comment_id === args["comment-id"]);
    if (prior) {
      // 旧回调不能影响后续轮次；completed_at 只表示本脚本的路由动作已完成。
      if (prior.completed_at || issue.status === "done") return noop(prior);
      const later = decisions.slice(decisions.indexOf(prior) + 1);
      if (later.length) return noop(prior);
      // 后置条件核对（M1/F1）：同 comment_id 已处理 ≠ 路由动作全部落地——首次执行可能在
      // persist-before-act 的中途断连（决策已写、动作未做/未做完）。按 prior.routed_to 逐项核对
      // 并补缺（恢复路径）；全部满足 → 输出与修复前完全相同的 NOOP JSON（正常路径零变化）。
      const repairs: string[] = [];
      if (prior.routed_to === "mention_analyst") {
        // 旧 Decision 不能证明当前 blocked 仍属于当时未完成的状态写入；
        // 自动恢复可能解除后续新阻塞。保留事实并交 Human 核对，不做状态写入。
        if (issue.status === "blocked") {
          throw new UnknownError("历史 ANALYSIS Decision 未标记完成，当前 blocked 的来源不可确认；禁止旧评论自动解除阻塞");
        }
        return noop(prior);
      } else if (prior.routed_to === "rematerialize_pr") {
        const abandoned = parseJsonArray<AbandonedEntry>(md["pr.abandoned"], "pr.abandoned", issueKey);
        const currentPr = parseJsonArray<CurrentPrEntry>(md["current_pr"], "current_pr", issueKey);
        const remaining = currentPr.filter((p) => !abandoned.some((a) => a.repo_key === p.repo_key && a.pr_id === p.pr_id));
        if (remaining.length !== currentPr.length) {
          client.setMetadata(issue.id, "current_pr", JSON.stringify(remaining));
          repairs.push("current_pr");
        }
      }
      // needs_engineering / hold_for_human：零副作用路由，无后置条件可补
      if (repairs.length === 0) {
        return noop(prior);
      }
      process.stdout.write(JSON.stringify({ result: "PASS", mode: "repair", comment_id: args["comment-id"], prior, repairs }, null, 2) + "\n");
      return 0;
    }

    if (issue.status !== "blocked") {
      throw new UnknownError(`Issue ${issueKey} 当前状态 ${issue.status}（非 blocked）——本脚本只服务 02 §11.2 PR Abandoned 后的 Human Decision 场景`);
    }
    if (!md["pr.abandoned"]) {
      throw new UnknownError(`Issue ${issueKey} 缺少 metadata pr.abandoned——无 PR Abandoned 事实，不属于本脚本场景`);
    }

    const recordDecision = (routedTo: string): void => {
      const entry: DecisionEntry = {
        comment_id: args["comment-id"],
        reason: args.reason ?? null,
        next,
        routed_to: routedTo,
        applied_at: new Date().toISOString(),
      };
      client.setMetadata(issue.id, "dev.decision", JSON.stringify([...decisions, entry]));
    };

    // --- ANALYSIS ---
    if (next === "ANALYSIS") {
      recordDecision("mention_analyst");
      setStatusNoStart(client, issue.id, "in_progress");
      completeDecision();
      process.stdout.write(JSON.stringify({ result: "PASS", next, directive: "mention_analyst", issue: issueKey, status: "in_progress" }, null, 2) + "\n");
      return 0;
    }

    // Lead coordinates Change-level rework using current native Issue/Run facts.
    // No automatic reset of candidate or PR authorization is implied.
    if (next === "ENGINEERING") {
      process.stdout.write(JSON.stringify({ result: "PASS", next, directive: "needs_engineering",
        detail: "由 Delivery Lead 核对当前批准、PR 事实与 Human 返工要求，使用原生协作安排研发；未解除交付阻塞" }, null, 2) + "\n");
      return 0;
    }

    // --- RECREATE_PR ---
    if (next === "RECREATE_PR") {
      const abandoned = parseJsonArray<AbandonedEntry>(md["pr.abandoned"], "pr.abandoned", issueKey);
      const currentPr = parseJsonArray<CurrentPrEntry>(md["current_pr"], "current_pr", issueKey);
      if (!md["pr_prep"]) throw new UnknownError(`Issue ${issueKey} 缺少 metadata pr_prep（候选提交事实不可确认）`);
      const prPrep = parseJsonArray<PrPrepEntry>(md["pr_prep"], "pr_prep", issueKey);
      const abandonedRepoKeys = [...new Set(abandoned.map((a) => a.repo_key))];
      if (abandonedRepoKeys.length === 0) throw new UnknownError("pr.abandoned 为空（无待重建仓）");

      // 逐 abandoned 仓核对 candidate commit 未变（确定性；任一已变 → needs_engineering）
      const changed: string[] = [];
      for (const repoKey of abandonedRepoKeys) {
        const repo = cfg.registry[repoKey];
        if (!repo) throw new UnknownError(`pr.abandoned 中 repo_key 未登记: ${repoKey}`);
        if (!repo.tfs_repo || !repo.tfs_project) {
          throw new UnknownError(`${repoKey} 缺少 tfs_repo/tfs_project 交付配置，不能核对候选分支`);
        }
        const prep = prPrep.find((p) => p.repo_key === repoKey);
        if (!prep) throw new UnknownError(`pr_prep 缺少 repo_key=${repoKey} 的条目（候选提交事实不全）`);
        const r = await runTfs(
          ["branch", "get", "--repo", repo.tfs_repo as string, "--name", prep.source_branch, "--project", repo.tfs_project as string],
          `核对分支 ${prep.source_branch}(${repoKey})`,
        );
        if (r.tfsUnknown) throw new UnknownError(`${repoKey}: TFS 分支查询 UNKNOWN（候选提交核对不可信）`);
        const d = r.data as { found: boolean; branch?: { commit: string } };
        if (!d.found) throw new UnknownError(`${repoKey}: 分支 ${prep.source_branch} 在 TFS 查无（候选事实不可确认，交 Lead）`);
        if (d.branch?.commit !== prep.candidate_commit) {
          changed.push(`${repoKey}: HEAD ${d.branch?.commit} != candidate ${prep.candidate_commit}`);
        }
      }

      if (changed.length > 0) {
        recordDecision("needs_engineering");
        process.stdout.write(JSON.stringify({
          result: "PASS", next, directive: "needs_engineering",
          detail: "候选提交已变化，语义修改属 Engineer（02 §11.2 RECREATE_PR 边界）",
          changed,
        }, null, 2) + "\n");
        return 0;
      }

      // 候选未变：从 current_pr 移除已 abandoned 条目（确定性：这些 PR 已确认 abandoned），
      // 使 pull-request materialize-pr 可重新物化；active 条目保留复用。
      const remaining = currentPr.filter((p) => !abandoned.some((a) => a.repo_key === p.repo_key && a.pr_id === p.pr_id));
      recordDecision("rematerialize_pr");
      client.setMetadata(issue.id, "current_pr", JSON.stringify(remaining));
      process.stdout.write(JSON.stringify({
        result: "PASS", next, directive: "rematerialize_pr",
        removed_from_current_pr: currentPr.length - remaining.length,
        remaining_current_pr: remaining,
      }, null, 2) + "\n");
      return 0;
    }

    // --- CANCEL_DELIVERY：零写入（02 §11.2：取消专项契约未定义，安全停止交 Human） ---
    process.stdout.write(JSON.stringify({
      result: "PASS", next, directive: "hold_for_human",
      detail: "CANCEL_DELIVERY 专项契约未定义（02 §11.2）——本脚本零写入，Delivery Lead 保持安全停止并交 Human 处理",
    }, null, 2) + "\n");
    return 0;
  } catch (exc) {
    if (exc instanceof UnknownError) {
      process.stdout.write(JSON.stringify({ result: "UNKNOWN", reason: exc.message }, null, 2) + "\n");
      log(`UNKNOWN: ${exc.message}`);
      return 3;
    }
    throw exc;
  }
}

/** commander 注册：group=delivery；参数解析沿用原脚本实现以保证契约逐字节等价。 */
export function registerDeliveryRouteDecision(group: Command): void {
  group
    .command("route-decision")
    .description("Human Decision 确定性路由（02 §11.2）")
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
