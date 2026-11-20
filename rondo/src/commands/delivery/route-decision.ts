/**
 * delivery route-decision — PR Abandoned 后 Human Decision 的确定性路由（02 §11.2 的确定性投影）。
 *
 * 收编说明（裁决 D3 修订）：自 rondo 收编起，实现位置为 @winning/skill-flow 包内
 * commands/delivery/route-decision.ts，原 projects/multica/workspace-skills/delivery-flow/scripts/
 * route-human-decision.ts 路径在迁移窗口期保持有效。
 *
 * 调用方：Delivery Lead（被 blocked Issue 上的 Human 评论唤醒后）。
 * 语义/确定性分界（02 §6.3–§6.4、§11.2）：Lead 负责理解自然语言评论并得出结构化 --next；
 *   本脚本只消费结构化输入做前置校验、确定性状态写入与路由指令输出，不解析自然语言。
 *
 * 前置校验（不过 → UNKNOWN exit 3，零写入）：
 *   Issue 当前 blocked；metadata 有 pr.abandoned；--comment-id 指向的评论存在；
 *   同 comment_id 已在 dev.decision → NOOP（exit 0，单次触发，02 §11.2）。
 *
 * 路由（先写 dev.decision，后执行状态动作——persist-before-act）：
 *   ANALYSIS       → Issue blocked→in_progress（--no-start）→ 指令 mention_analyst
 *   ENGINEERING    → --affected-task-refs 须恰好命中一条 active dev.dispatch（不唯一/不存在 → UNKNOWN）；
 *                    该 dispatch active:false + invalidated_by；parent 投影 → Issue →in_progress（--no-start）
 *                    → 指令 rework_parent_mention；sub_issue 投影 → 原 Sub-Issue 发结构化返工评论 +
 *                    重开 done→in_progress（本脚本唯一不带 --no-start 的写入，即返工启动信号）
 *                    → 指令 rework_sub_issue_activated
 *   RECREATE_PR    → 逐 abandoned 仓核对分支 HEAD == pr_prep.candidate_commit（tfs-cli branch get）；
 *                    全部未变 → 从 current_pr 移除已 abandoned 条目 → 指令 rematerialize_pr；
 *                    任一已变 → 指令 needs_engineering（语义修改属 Engineer，脚本不处置，02 §11.2 边界）
 *   CANCEL_DELIVERY→ 零写入（02 §11.2：取消专项契约未定义）→ 指令 hold_for_human
 *
 * 用法：rondo delivery route-decision --config <repo-registry.json> --issue <KEY>
 *   --comment-id <uuid> --next ANALYSIS|ENGINEERING|RECREATE_PR|CANCEL_DELIVERY
 *   [--reason REJECTED|DISCARDED] [--affected-task-refs 1.1,1.2]
 * 退出码：0 PASS/NOOP / 2 FAIL（用法级前置不满足）/ 3 UNKNOWN / 64 用法错误。stdout 只出 JSON；日志走 stderr。
 */

import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { runCommand } from "../../clients/spawn.js";
import { loadConfig, type BaseRegistryConfig, type RuntimeConfig } from "../../clients/config.js";
import { MulticaClient } from "../../clients/multica.js";
import { FailError } from "../../tfs/client.js";
import { dispatchTfs, UsageError } from "../../tfs/dispatch.js";
// DispatchEntry / buildReworkDispatch 在 ../dev/dispatch-entry.js（writer 侧唯一权威形状，M1/F1）
import { buildReworkDispatch, type DispatchEntry } from "../dev/dispatch-entry.js";
import { parseAnalysisSource, readAnalysisSource, sameAnalysisSource } from "../analysis/source.js";

/** 真正无来源的历史派发保留旧路径；新记录不能在来源丢失或变更后恢复旧轮次。 */
function assertReworkSource(md: Record<string, unknown>, target: DispatchEntry, history: DispatchEntry[]): void {
  let approval: unknown;
  if (md["analysis.human_approval"] !== undefined) {
    try { approval = JSON.parse(String(md["analysis.human_approval"])); }
    catch { throw new UnknownError("批准记录无法解析，不能确认旧数据兼容范围"); }
  }
  const hasApprovalSource = !!approval && typeof approval === "object" && "source" in approval;
  if (md["analysis.source"] === undefined && !hasApprovalSource && !("analysis_source" in target) && !history.some(d => "analysis_source" in d)) return;
  const current = readAnalysisSource(md);
  if (!sameAnalysisSource(current, parseAnalysisSource(target.analysis_source, target.change_ref))) {
    throw new UnknownError("返工派发与当前 analysis.source 不一致，不能恢复旧来源");
  }
}

interface RegistryConfig extends BaseRegistryConfig {
  runtime: RuntimeConfig;
  registry: Record<string, { repo_path: string; tfs_repo?: string; tfs_project?: string; default_target_branch?: string }>;
}

interface DecisionEntry {
  comment_id: string;
  reason: string | null;
  next: string;
  affected_task_refs: string[] | null;
  routed_to: string;
  applied_at: string;
  /** 记录动作前的原派发，恢复时不得误认同任务的新派发。 */
  target_dispatch?: DispatchEntry;
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

/** Sub-Issue 返工重开：唯一不带 --no-start 的写入（done→in_progress 即返工启动信号）。 */
function reopenWithStart(client: MulticaClient, issueId: string): void {
  client.setStatusWithStart(issueId, "in_progress", `Sub-Issue ${issueId} 重开 done→in_progress（触发返工 Run）`);
}

function addComment(client: MulticaClient, issueId: string, content: string): void {
  client.addCommentContent(issueId, content);
}

/** Sub-Issue 结构化返工评论正文（fresh 路径与 NOOP 修复路径共用，保证补发内容一致）。 */
function reworkCommentBody(issueKey: string, commentId: string, affected: string[], target: DispatchEntry, reason: string | undefined): string {
  return [
    `返工输入（delivery-flow route-human-decision 路由，02 §11.2）：`,
    ``,
    `- 触发评论: ${issueKey} 评论 ${commentId}`,
    `- 受影响 Task refs: ${affected.join(", ")}`,
    `- Change: openspec/changes/${target.change_ref}/`,
    `- 原因类别: ${reason ?? "未提供"}`,
    ``,
    `原完成结论（dev.dispatch ${target.dispatch_key}）已失效；历史 Evidence 保留在 Change 目录不动。修正方向见 Parent Issue 触发评论上下文。`,
  ].join("\n");
}

/** 评论存在性按内容匹配（NOOP 修复路径核对"返工评论是否已补发"；按 id 的精确核对走 commentExists）。 */
function commentMentions(client: MulticaClient, issueRef: string, needle: string): boolean {
  const out = client.run(
    ["issue", "comment", "list", issueRef, "--full", ...client.ws(), "--output", "json"],
    `读取 Issue ${issueRef} 评论列表`,
    { transient: true },
  );
  const arr = Array.isArray(out) ? out : [];
  return arr.some((c) => typeof (c as { content?: unknown }).content === "string" && (c as { content: string }).content.includes(needle));
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
      "  [--reason REJECTED|DISCARDED] [--affected-task-refs 1.1,1.2]\n",
    );
    return 64;
  }
  if (!(NEXTS as readonly string[]).includes(args.next)) {
    process.stderr.write(`--next 只能是 ${NEXTS.join("|")}，收到: ${args.next}\n`);
    return 64;
  }
  const next = args.next as Next;

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
      if (later.some(d => !d.affected_task_refs || d.affected_task_refs.some(ref => prior.affected_task_refs?.includes(ref)))) return noop(prior);
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
      } else if (prior.routed_to === "rework_parent_mention" || prior.routed_to === "rework_sub_issue_activated") {
        const affected = [...(prior.affected_task_refs ?? [])].sort();
        const dispatches = parseJsonArray<DispatchEntry>(md["dev.dispatch"], "dev.dispatch", issueKey);
        const invalidated = dispatches.filter(
          (d) => !d.active && d.invalidated_by === args["comment-id"] && [...d.task_refs].sort().join(",") === affected.join(","),
        );
        let target = invalidated.length === 1 ? invalidated[0] : undefined;
        if (invalidated.length > 1) throw new UnknownError("同一返工决定命中多个失效派发，不能恢复");
        if (!target) {
          // Decision 已写而 dispatch 尚未写：只认持久化快照中的原目标。
          // 旧格式无快照时，要求仍 blocked 且只有一条早于该决定的匹配派发。
          const snapshot = prior.target_dispatch;
          const candidates = dispatches.filter(d => d.active && [...d.task_refs].sort().join(",") === affected.join(",") &&
            d.projection === (prior.routed_to === "rework_parent_mention" ? "parent" : "sub_issue") &&
            (snapshot ? d.dispatch_key === snapshot.dispatch_key && d.dispatched_at === snapshot.dispatched_at &&
              d.change_ref === snapshot.change_ref && d.engineer_id === snapshot.engineer_id &&
              d.approved_comment_ref === snapshot.approved_comment_ref && d.sub_issue_ref === snapshot.sub_issue_ref
              : issue.status === "blocked" && Date.parse(d.dispatched_at) <= Date.parse(prior.applied_at)));
          if (candidates.length !== 1) throw new UnknownError("Decision 已记录但无法唯一确认原目标派发，停止恢复");
          target = candidates[0];
        }
        assertReworkSource(md, target, dispatches);
        if (prior.target_dispatch) assertReworkSource(md, prior.target_dispatch, dispatches);
        const active = dispatches.filter(d => d.dispatch_key === target.dispatch_key && d.active);
        const restored = active.find(d => d.rework_comment_ref === args["comment-id"]);
        if (restored) assertReworkSource(md, restored, dispatches);
        if (active.length > 1 || (active.length === 1 && !restored && active[0] !== target)) {
          throw new UnknownError("原派发已被其他 active 派发替换，不能恢复旧轮次");
        }
        if (!restored) {
          const history = dispatches.map(d => d === target ? { ...d, active: false, invalidated_by: args["comment-id"] } : d);
          client.setMetadata(issue.id, "dev.dispatch", JSON.stringify([...history, buildReworkDispatch(target, args["comment-id"])]));
          repairs.push("dispatch");
        }
        if (prior.routed_to === "rework_parent_mention") {
          if (issue.status === "blocked") {
            setStatusNoStart(client, issue.id, "in_progress");
            repairs.push("status");
          }
        } else {
          // sub_issue：先补 dispatch（上面），再补返工评论，最后重开——保持 persist-before-act 顺序
          if (!target.sub_issue_ref) throw new UnknownError("失效 dispatch 为 sub_issue 投影但缺 sub_issue_ref（事实破损）");
          const sub = client.getIssue(target.sub_issue_ref);
          const hasComment = commentMentions(client, sub.identifier ?? sub.id, args["comment-id"]);
          if (restored && hasComment && sub.status === "done") {
            throw new UnknownError("返工派发和评论已存在，但 Sub-Issue 为 done 且缺少路由完成标记；不能猜测是否已经完成返工并再次启动");
          }
          if (!hasComment) {
            addComment(client, sub.id, reworkCommentBody(issueKey, args["comment-id"], affected, target, prior.reason ?? undefined));
            repairs.push("comment");
          }
          if (sub.status === "done") {
            reopenWithStart(client, sub.id);
            repairs.push("reopen");
          }
        }
        completeDecision();
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

    const recordDecision = (routedTo: string, affected: string[] | null, target?: DispatchEntry): void => {
      const entry: DecisionEntry = {
        comment_id: args["comment-id"],
        reason: args.reason ?? null,
        next,
        affected_task_refs: affected,
        routed_to: routedTo,
        applied_at: new Date().toISOString(),
        ...(target ? { target_dispatch: target } : {}),
      };
      client.setMetadata(issue.id, "dev.decision", JSON.stringify([...decisions, entry]));
    };

    // --- ANALYSIS ---
    if (next === "ANALYSIS") {
      recordDecision("mention_analyst", null);
      setStatusNoStart(client, issue.id, "in_progress");
      process.stdout.write(JSON.stringify({ result: "PASS", next, directive: "mention_analyst", issue: issueKey, status: "in_progress" }, null, 2) + "\n");
      return 0;
    }

    // --- ENGINEERING ---
    if (next === "ENGINEERING") {
      if (!args["affected-task-refs"]) {
        throw new UnknownError("NEXT=ENGINEERING 缺少 --affected-task-refs（受影响 Task Set 不明，02 §11.2 UNKNOWN）");
      }
      const affected = args["affected-task-refs"].split(",").map((s) => s.trim()).filter(Boolean).sort();
      if (affected.length === 0) throw new UnknownError("--affected-task-refs 解析后为空");
      const dispatches = parseJsonArray<DispatchEntry>(md["dev.dispatch"], "dev.dispatch", issueKey);
      const hits = dispatches.filter((d) => d.active && [...d.task_refs].sort().join(",") === affected.join(","));
      if (hits.length !== 1) {
        throw new UnknownError(`--affected-task-refs ${affected.join(",")} 命中 active dispatch ${hits.length} 条（须恰好 1 条；不唯一/不存在 → UNKNOWN，02 §11.2）`);
      }
      const target = hits[0];
      assertReworkSource(md, target, dispatches);
      const invalidated = dispatches.map((d) => d === target ? { ...d, active: false, invalidated_by: args["comment-id"] } : d);

      if (target.projection === "sub_issue") {
        if (!target.sub_issue_ref) throw new UnknownError("命中 dispatch 为 sub_issue 投影但缺 sub_issue_ref（事实破损）");
        const sub = client.getIssue(target.sub_issue_ref);
        if (sub.status !== "done") {
          throw new UnknownError(`Sub-Issue ${target.sub_issue_ref} 状态 ${sub.status}（非 done，原完成结论不可确认，交 Lead）`);
        }
        // persist-before-act：先写 dev.decision + dispatch（失效+同 key 新 active 一笔写完，消除
        // "零 active 派发"窗口期，M1/F1），再发评论，最后重开（启动信号放最后）
        recordDecision("rework_sub_issue_activated", affected, target);
        client.setMetadata(issue.id, "dev.dispatch", JSON.stringify([...invalidated, buildReworkDispatch(target, args["comment-id"])]));
        addComment(client, sub.id, reworkCommentBody(issueKey, args["comment-id"], affected, target, args.reason));
        reopenWithStart(client, sub.id);
        completeDecision();
        process.stdout.write(JSON.stringify({
          result: "PASS", next, directive: "rework_sub_issue_activated",
          sub_issue: target.sub_issue_ref, invalidated_dispatch: target.dispatch_key,
        }, null, 2) + "\n");
        return 0;
      }

      // parent 投影：失效+恢复一笔写完（同 dispatch_key 新 active 条目，消除"零 active 派发"窗口期，
      // M1/F1——语义上是恢复同一派发而非重复派发）；Issue 回转 in_progress（--no-start），单次返工 @mention 由 Lead 发
      recordDecision("rework_parent_mention", affected, target);
      const redispatched = buildReworkDispatch(target, args["comment-id"]);
      client.setMetadata(issue.id, "dev.dispatch", JSON.stringify([...invalidated, redispatched]));
      setStatusNoStart(client, issue.id, "in_progress");
      completeDecision();
      process.stdout.write(JSON.stringify({
        result: "PASS", next, directive: "rework_parent_mention",
        issue: issueKey, status: "in_progress",
        invalidated_dispatch: target.dispatch_key,
        redispatched: { dispatch_key: redispatched.dispatch_key, active: redispatched.active, rework_comment_ref: redispatched.rework_comment_ref },
        rework_target: { engineer_id: target.engineer_id, engineer_name: target.engineer_name, task_refs: target.task_refs },
      }, null, 2) + "\n");
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
        recordDecision("needs_engineering", null);
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
      recordDecision("rematerialize_pr", null);
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
