/**
 * materialize-development.ts — Development 派发物化（02 §7 的确定性投影）。
 *
 * （D3 修订：自 rondo 收编起，实现位置为 @winning/skill-flow 包内
 * commands/dev/materialize.ts，原 projects/multica/workspace-skills/delivery-flow/scripts/
 * materialize-development.ts 路径在迁移窗口期保持有效，见 change-progress-script-contract.md addendum。）
 *
 * 调用方：Delivery Lead（派发 Run 内）。
 * 职责边界（02 §7 末段）：脚本只【校验并落实】Lead 已确定的 Owner / task_refs / Projection，
 *   不自行选择成员、不重组 Task Set、不推断是否需要 Sub-Issue。
 *
 * 校验（任一不过 → exit 2，逐项 reason）：
 *   1. Issue 可读；--approved-comment-ref 指向的评论在 Issue 上可读取，且与 Lead 已投影的
 *      analysis.human_approval 一致；由已批准的 verify_agent_required 明确生成最终执行事实
 *      verify_agent.required（不是 Analyst Recommendation），回读后才执行派发副作用；
 *   2. analysis.source 与 Human 批准来源一致；按固定 commit 读取 tasks.md，
 *      校验 task_refs 原生编号唯一且可定位；不回退本地工作树或恢复成其他 Change；
 *   3. --engineer-id 是已注册 Agent（agent get 回读）；
 *   4. 幂等：同 dispatch_key 且 active:true 的派发已存在 → NO-OP（输出既有事实），不重复派发。
 *
 * 落实：
 *   projection=parent（默认）：写 metadata dev.dispatch → 输出 mention payload（评论由 Lead 发）。
 *   projection=sub-issue：创建 Sub-Issue（backlog，不带 assignee 创建 + assign --no-start）→
 *     回读核对 → 写 dev.dispatch（含 sub_issue_ref）；--depends-on 未完成 → 保持 backlog；
 *     无依赖或 --activate → issue status todo（本脚本唯一不带 --no-start 的写入，即启动信号，02 §7.2）。
 *   --activate 重跑：dispatch 已有 sub_issue_ref 且 Sub-Issue 仍 backlog → 只激活，不重建。
 *
 * 用法：rondo dev materialize --config <repo-registry.json> --issue <KEY>
 *   --change-ref <ref> --task-refs 1.1,1.2 --engineer-id <agent-uuid>
 *   --approved-comment-ref <comment-uuid> [--projection parent|sub-issue]
 *   [--depends-on <sub-issue-key>] [--activate]
 * 退出码：0 PASS/NOOP / 2 FAIL（逐项 reasons）/ 3 UNKNOWN / 64 用法错误。stdout 只出 JSON；日志走 stderr。
 *
 * 运行环境：Node ≥ 23.6 直跑（22.6+ 需 --experimental-strip-types）；只用可擦除类型注解；零 npm 依赖。
 */

import { multicaPrefix } from "../../clients/multica-environment.js";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { logLine, markLeafExecuted } from "../../cli/output.js";
import { runJsonStdin } from "../../clients/spawn.js";
import { loadConfig, type BaseRegistryConfig } from "../../clients/config.js";
import { MulticaClient, type IssueRecord } from "../../clients/multica.js";
import { readAnalysisSource, readAnalysisArtifact, sameAnalysisSource, parseAnalysisSource, locateTaskRefs } from "../analysis/source.js";
import { readApprovedVerifyDecision, assertProjectedVerifyDecision } from "../delivery/verify-decision.js";

interface RegistryConfig extends BaseRegistryConfig {
  registry: Record<string, { tfs_repo: string; tfs_project: string; default_target_branch?: string }>;
}

// DispatchEntry / dispatch_key 公式在 ./dispatch-entry.js（writer 侧唯一权威形状，M1/F1）
import { dispatchKeyFor, type DispatchEntry } from "./dispatch-entry.js";

// --- stdin 变体已上提 clients/spawn.js（M3.2）；assign/activate 已收编 MulticaClient 回读确认。 ---

// --- Multica 封装。flag 已对照 0.6.1 核验；升级 CLI 版本后须复核。 ---
// getIssue / setMetadata 与 MulticaClient 相同方法一致，直接复用；以下为命令特化方法。

function commentExists(multica: MulticaClient, issueKey: string, commentId: string): boolean {
  const out = multica.run(
    ["issue", "comment", "list", issueKey, "--full", ...multica.ws(), "--output", "json"],
    `读取 Issue ${issueKey} 评论列表`,
    { transient: true },
  );
  const arr = Array.isArray(out) ? out : [];
  return arr.some((c) => (c as { id?: string }).id === commentId);
}

function getAgent(multica: MulticaClient, agentId: string): { id: string; name?: string } {
  const out = multica.run(
    ["agent", "get", agentId, ...multica.ws(), "--output", "json"],
    `回读 Agent ${agentId}`,
    { transient: true },
  ) as { id?: string; name?: string };
  if (!out?.id) throw new UnknownError(`Agent ${agentId} 回读缺少 id`);
  return out as { id: string; name?: string };
}

/** 创建 Sub-Issue（不带 assignee，避免 create 触发 Run；assign 走 --no-start 单独写入）。 */
function createSubIssue(cfg: RegistryConfig, multica: MulticaClient, projectId: string, parentId: string, title: string, description: string): IssueRecord {
  const out = runJsonStdin(
    [...multicaPrefix(cfg.runtime), "issue", "create", "--project", projectId, "--parent", parentId,
     "--status", "backlog", "--title", title, "--description-stdin", ...multica.ws(), "--output", "json"],
    `创建 Sub-Issue(parent=${parentId})`,
    description,
  ) as IssueRecord;
  if (!out?.id) throw new UnknownError("创建 Sub-Issue 返回缺少 id（创建结果未知——先查 Issue 列表核实，不盲目重建，02 §7.3）");
  return out;
}

/** Sub-Issue assignee（--no-start；M3.2 委托共享回读确认）。 */
function assignNoStart(multica: MulticaClient, issueId: string, agentId: string): void {
  multica.assignNoStart(issueId, agentId);
}

/** 激活：唯一不带 --no-start 的写入（backlog→todo 即启动信号，02 §7.2）。 */
function activate(multica: MulticaClient, issueId: string): void {
  multica.setStatusWithStart(issueId, "todo", `Sub-Issue ${issueId} 激活 backlog→todo`);
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

const USAGE =
  "用法: rondo dev materialize --config <repo-registry.json> --issue <KEY> --change-ref <ref>\n" +
  "  --task-refs 1.1,1.2 --engineer-id <agent-uuid> --approved-comment-ref <comment-uuid>\n" +
  "  [--projection parent|sub-issue] [--depends-on <sub-issue-key>] [--activate]\n";

async function main(rawArgs: string[]): Promise<number> {
  const args = parseArgs(rawArgs);
  // --help：stdout 用法 + exit 0（M5，先例：change resolve-identity）——正常求助不计入业务失败指标
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const required = ["config", "issue", "change-ref", "task-refs", "engineer-id", "approved-comment-ref"];
  const missingArgs = required.filter((k) => typeof args[k] !== "string" || args[k] === "");
  if (missingArgs.length > 0) {
    process.stderr.write(USAGE + `缺少参数: ${missingArgs.join(", ")}\n`);
    return 64;
  }
  const projectionArg = (args.projection as string) ?? "parent";
  if (projectionArg !== "parent" && projectionArg !== "sub-issue") {
    process.stderr.write(`--projection 只能是 parent|sub-issue，收到: ${projectionArg}\n`);
    return 64;
  }
  // 事实契约存储值规范化：CLI 参数 sub-issue → 契约值 sub_issue（dispatch-facts-contract.md）
  const projection: "parent" | "sub_issue" = projectionArg === "sub-issue" ? "sub_issue" : "parent";

  try {
    const cfg = loadConfig<RegistryConfig>(args.config as string, { requireTfs: false });
    const multica = new MulticaClient(cfg.runtime);
    const issue = multica.getIssue(args.issue as string);
    const issueKey = issue.identifier ?? issue.id;
    const md = issue.metadata ?? {};
    // Gate PASS is a Development admission invariant, including NOOP and --activate.
    // The Analyst Recommendation itself is not a Development admission decision.
    if (md["analysis.gate.result"] !== "PASS") {
      process.stdout.write(JSON.stringify({ result: "FAIL", reasons: ["analysis.gate.result != PASS，禁止派发或激活 Engineer"] }, null, 2) + "\n");
      return 2;
    }
    const approvedRef = args["approved-comment-ref"] as string;
    const verifyDecision = readApprovedVerifyDecision(md, approvedRef);
    // Before NOOP, activation or new dispatch, reject mismatched Human source / final projection.
    if (!commentExists(multica, issueKey, approvedRef)) {
      process.stdout.write(JSON.stringify({ result: "FAIL", reasons: [`--approved-comment-ref ${approvedRef} 不在 Issue ${issueKey} 的评论列表中`] }, null, 2) + "\n");
      return 2;
    }
    const requestedChangeRef = args["change-ref"] as string;
    // All dispatch paths, including an early NOOP, must refer to this approved Change.
    if (!md["analysis.change_ref"] || md["analysis.change_ref"] !== requestedChangeRef) {
      process.stdout.write(JSON.stringify({ result: "FAIL", reasons: ["analysis.change_ref 与待派发 Change 不一致或缺失"] }, null, 2) + "\n");
      return 2;
    }
    const taskRefs = (args["task-refs"] as string).split(",").map((s) => s.trim()).filter(Boolean);
    if (taskRefs.length === 0) {
      process.stdout.write(JSON.stringify({ result: "FAIL", reasons: ["--task-refs 为空"] }, null, 2) + "\n");
      return 2;
    }
    const sortedRefs = [...taskRefs].sort();
    const source = readAnalysisSource(md);
    // 首派、NOOP 和激活均读取同一审核版本，禁止从本地工作树恢复成另一个 Change。
    const tasks = await readAnalysisArtifact(source, "tasks.md");
    const missing = locateTaskRefs(tasks.content, taskRefs);
    if (missing.length) throw new FailError(`task_refs 在已批准 tasks.md 中不可定位: ${missing.join(", ")}`);
    const dispatchKey = dispatchKeyFor(issueKey, sortedRefs, args["engineer-id"] as string);

    // --- 幂等：同 dispatch_key 且 active 的派发已存在 → NO-OP（--activate 除外：对既有 Sub-Issue 只激活） ---
    let dispatches: DispatchEntry[] = [];
    const rawDispatch = md["dev.dispatch"];
    if (rawDispatch) {
      try { dispatches = JSON.parse(rawDispatch) as DispatchEntry[]; }
      catch { throw new UnknownError(`Issue ${issueKey} 的 metadata dev.dispatch 不是合法 JSON`); }
      if (!Array.isArray(dispatches)) throw new UnknownError(`Issue ${issueKey} 的 metadata dev.dispatch 不是数组`);
    }
    const existing = dispatches.find((d) => d.dispatch_key === dispatchKey && d.active);
    const activeDispatches = dispatches.filter((d) => d.active);
    for (const dispatch of activeDispatches) {
      if (!sameAnalysisSource(source, parseAnalysisSource(dispatch.analysis_source, requestedChangeRef))) {
        throw new UnknownError("active 派发依据的规范版本已变化，不能按相同 dispatch_key 返回 NOOP 或激活");
      }
    }
    if (activeDispatches.some((d) => d.change_ref !== requestedChangeRef)) {
      throw new UnknownError("active 开发派发引用其他 Change；不能仅更新 Verify Decision");
    }

    /** Project the current Human decision without rewriting an existing dispatch audit.
     * A new Human approval can change only the additional independent verifier:
     * existing task_refs / engineer / Sub-Issue remain owned by their original approval.
     */
    const ensureFinalDecision = (expectedDispatch = md["dev.dispatch"]): void => {
      const latest = multica.getIssue(args.issue as string).metadata ?? {};
      if (latest["analysis.gate.result"] !== "PASS" || latest["analysis.change_ref"] !== requestedChangeRef) {
        throw new UnknownError("派发前 Analysis Gate 或 Change Identity 已变化，停止");
      }
      const currentApproval = readApprovedVerifyDecision(latest, approvedRef);
      if (!sameAnalysisSource(source, readAnalysisSource(latest))) throw new UnknownError("派发期间 analysis.source 已变化，停止");
      if (currentApproval.required !== verifyDecision.required || currentApproval.commentRef !== verifyDecision.commentRef) {
        throw new UnknownError("派发期间 Human Verify Decision 已变化，停止");
      }
      if ((latest["dev.dispatch"] ?? null) !== (expectedDispatch ?? null)) {
        throw new UnknownError("派发期间 dev.dispatch 已变化，先回读重新执行");
      }
      const persisted = latest["verify_agent.required"];
      if (persisted !== undefined && persisted !== "true" && persisted !== "false") {
        throw new UnknownError("已持久化 verify_agent.required 非法，拒绝覆盖");
      }
      if (persisted !== String(currentApproval.required)) {
        // A post-dispatch override must have a fresh, verified Human comment;
        // an edit to the initial approval or a repeated comment is not a new approval.
        if (persisted !== undefined &&
            (activeDispatches.length === 0 ||
             activeDispatches.some((d) => d.approved_comment_ref === approvedRef))) {
          throw new UnknownError("已投影的 Verify Decision 冲突；只有新的 Human 批准评论可更新已派发事项");
        }
        multica.setMetadata(issue.id, "verify_agent.required", String(currentApproval.required));
      }
      const after = multica.getIssue(args.issue as string).metadata ?? {};
      assertProjectedVerifyDecision(after, approvedRef);
      if (!sameAnalysisSource(source, readAnalysisSource(after))) throw new UnknownError("派发写入前规范来源已变化，停止");
      if (after["analysis.gate.result"] !== "PASS" || (after["dev.dispatch"] ?? null) !== (expectedDispatch ?? null)) {
        throw new UnknownError("回读时 Gate 或派发记录已变化，停止");
      }
    };

    if (existing && !args.activate) {
      ensureFinalDecision();
      process.stdout.write(JSON.stringify({ result: "NOOP", reason: "同 dispatch_key 的 active 派发已存在，不重复派发", dispatch: existing }, null, 2) + "\n");
      return 0;
    }

    // --activate 重跑路径：只对既有 backlog Sub-Issue 激活
    if (args.activate) {
      ensureFinalDecision();
      if (!existing?.sub_issue_ref) {
        process.stdout.write(JSON.stringify({ result: "FAIL", reasons: ["--activate 要求同 dispatch_key 的 active 派发已存在且 projection=sub_issue"], dispatch_key: dispatchKey }, null, 2) + "\n");
        return 2;
      }
      const sub = multica.getIssue(existing.sub_issue_ref);
      if (sub.status === "backlog") {
        ensureFinalDecision();
        activate(multica, sub.id);
      } else if (sub.status !== "todo" && sub.status !== "in_progress" && sub.status !== "done") {
        throw new UnknownError(`Sub-Issue ${existing.sub_issue_ref} 状态 ${sub.status}，不是可激活状态（交 Lead 判断）`);
      }
      process.stdout.write(JSON.stringify({ result: "PASS", mode: "activate", sub_issue: sub.identifier ?? sub.id, previous_status: sub.status, dispatch: existing }, null, 2) + "\n");
      return 0;
    }

    // --- 确定性校验（任一不过 → FAIL 逐项 reason；平台/文件不可读 → UNKNOWN） ---
    const reasons: string[] = [];
    const changeRef = requestedChangeRef;

    let engineerName = "";
    try {
      const agent = getAgent(multica, args["engineer-id"] as string);
      engineerName = agent.name ?? "";
    } catch (exc) {
      if (exc instanceof UnknownError && /回读缺少 id/.test(exc.message)) throw exc;
      reasons.push(`--engineer-id ${args["engineer-id"]} 不是可回读的已注册 Agent`);
    }

    // 原脚本即如此：projection 已归一为 "sub_issue"，此比较按原样保留（cast 仅为通过严格类型检查）。
    if ((projection as string) === "sub-issue" && typeof args["depends-on"] === "string") {
      const dep = multica.getIssue(args["depends-on"] as string);
      if (dep.status !== "done") {
        logLine(`依赖 ${args["depends-on"]} 状态 ${dep.status}（未 done）——Sub-Issue 将保持 backlog 不激活`);
      }
    }

    if (reasons.length > 0) {
      process.stdout.write(JSON.stringify({ result: "FAIL", reasons }, null, 2) + "\n");
      return 2;
    }

    // Only after all preflight checks may the final decision be persisted.
    ensureFinalDecision();

    const entry: DispatchEntry = {
      dispatch_key: dispatchKey,
      task_refs: sortedRefs,
      engineer_id: args["engineer-id"] as string,
      engineer_name: engineerName,
      projection,
      sub_issue_ref: null,
      change_ref: changeRef,
      analysis_source: source,
      approved_comment_ref: args["approved-comment-ref"] as string,
      dispatched_at: new Date().toISOString(),
      active: true,
    };
    if (projection === "parent") {
      multica.setMetadata(issue.id, "dev.dispatch", JSON.stringify([...dispatches, entry]));
      process.stdout.write(JSON.stringify({
        result: "PASS",
        mode: "parent",
        dispatch: entry,
        payload: {
          mention_target: engineerName,
          issue: issueKey,
          change_ref: entry.change_ref,
          task_refs: entry.task_refs,
          analysis_source: source,
        },
      }, null, 2) + "\n");
      return 0;
    }

    // --- projection=sub-issue：创建（backlog，不启动）→ 指派（--no-start）→ 回读 → 写事实 → 依赖门控激活 ---
    if (!issue.project_id) throw new UnknownError(`Issue ${issueKey} 缺少 project_id，无法创建 Sub-Issue`);
    const title = `[Dev] ${entry.change_ref} tasks ${sortedRefs.join(",")} (${issueKey})`;
    const description = [
      `Development Sub-Issue（delivery-flow materialize-development 物化，02 §7.2）`,
      ``,
      `- Parent: ${issueKey}`,
      `- Change: openspec/changes/${entry.change_ref}/（${source.repo_url}@${source.commit}）`,
      `- Task refs: ${sortedRefs.join(", ")}`,
      `- 批准评论: ${entry.approved_comment_ref}（见 Parent Issue）`,
      `- 依赖: ${typeof args["depends-on"] === "string" ? args["depends-on"] : "无"}`,
      ``,
      `任务内容以 Change 的 tasks.md 原生编号为准（Reference-not-Replication，本描述不复制任务文本）。`,
    ].join("\n");

    const sub = createSubIssue(cfg, multica, issue.project_id, issue.id, title, description);
    assignNoStart(multica, sub.id, entry.engineer_id);
    const readback = multica.getIssue(sub.identifier ?? sub.id);
    if (readback.parent_issue_id !== issue.id || readback.assignee_id !== entry.engineer_id || readback.status !== "backlog") {
      throw new UnknownError(
        `Sub-Issue ${sub.identifier ?? sub.id} 回读不一致（parent=${readback.parent_issue_id} assignee=${readback.assignee_id} status=${readback.status}）——外部事实已变，交 Lead 核对`,
      );
    }
    entry.sub_issue_ref = readback.identifier ?? readback.id;
    // 创建/指派 Sub-Issue 也可能耗时；在落账与启动前重新确认批准来源。
    ensureFinalDecision();
    const publishedDispatch = JSON.stringify([...dispatches, entry]);
    multica.setMetadata(issue.id, "dev.dispatch", publishedDispatch);

    let activated = false;
    let awaiting: string | null = null;
    if (typeof args["depends-on"] === "string") {
      const dep = multica.getIssue(args["depends-on"] as string);
      if (dep.status !== "done") awaiting = args["depends-on"] as string;
    }
    if (!awaiting) {
      ensureFinalDecision(publishedDispatch);
      activate(multica, readback.id);
      activated = true;
    }

    process.stdout.write(JSON.stringify({
      result: "PASS",
      mode: "sub_issue",
      dispatch: entry,
      sub_issue: entry.sub_issue_ref,
      activated,
      awaiting_dependency: awaiting,
    }, null, 2) + "\n");
    return 0;
  } catch (exc) {
    if (exc instanceof FailError) {
      process.stdout.write(JSON.stringify({ result: "FAIL", reason: exc.message }) + "\n");
      return 2;
    }
    if (exc instanceof UnknownError) {
      process.stdout.write(JSON.stringify({ result: "UNKNOWN", reason: exc.message }, null, 2) + "\n");
      logLine(`UNKNOWN: ${exc.message}`);
      return 3;
    }
    throw exc;
  }
}

/** commander 注册：group=dev；参数解析沿用原脚本实现以保证契约逐字节等价。 */
export function registerDevMaterialize(group: Command): void {
  group
    .command("materialize")
    .description("Development 派发物化（02 §7）")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      process.exitCode = await main(cmd.args);
    });
}
