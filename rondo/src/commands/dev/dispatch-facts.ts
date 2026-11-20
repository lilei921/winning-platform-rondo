/**
 * commands/dev/dispatch-facts.ts — dev.dispatch 派发事实读取与类型分支（共享模块）。
 *
 * 消费者：dev check-dispatch（开工预检）、dev check-completion 的 commit_task_links 检查。
 * 两处共用同一读取与分类实现，防止规则漂移（同 analysis/facts.ts 的 stage/complete 模式）。
 * 事实契约唯一权威：delivery-flow/references/dispatch-facts-contract.md（本模块只是读者）。
 *
 * 类型分支（tfs-bug-delivery-task-skip-plan §4.5）：tfs.type=Bug 时不建 TFS 子任务、
 * tfs_task_ids 恒缺省为正常态；tfs.type 缺失/其他 → 分类为 tfs_type 失败，交 Lead 核对。
 *
 * 2026-10-30 TFS 剥离（tfs-writeback-decoupling-plan）：子任务延后到 PR 通过后的
 * writeback 创建，开发期 commit `Refs:` 统一挂 tfs.id——tfs_task_ids 在开发期恒缺省
 * 成为全类型正常态，原 no_mappings 失败与 unmappedRefs 口径随之移除；
 * tfs_task_ids 仅作在途 legacy 交付的兼容事实保留读取。
 */

import { multicaPrefix } from "../../clients/multica-environment.js";
import type { BaseRegistryConfig } from "../../clients/config.js";
import { isTransientNetworkText, runCommand, sleepSync, transientBackoffMs, type CmdResult } from "../../clients/spawn.js";
import { logLine } from "../../cli/output.js";

/** 瞬态重试包装（rll5-replay-remediation M3.1）：本模块必须保留 runCommand + 数据化
 * `{ok:false}` 错误分类（消费方按 code 归类），不能改走 runJson 的抛错契约——
 * 故在本地复刻同一签名/退避策略：空 stdout（rc 0/2）或输出命中网络签名时指数退避
 * 重试 ≤3 次，最终失败原样返回 CmdResult（:62-64 文案不变）。 */
function runCommandTransient(cmd: string[], retries = 3, baseMs = 3000): CmdResult {
  for (let attempt = 0; ; attempt++) {
    const r = runCommand(cmd);
    const emptyOk = (r.status === 0 || r.status === 2) && r.stdout.trim() === "";
    const signature = isTransientNetworkText(`${r.stdout}\n${r.stderr}`);
    if ((emptyOk || signature) && attempt < retries) {
      const delay = transientBackoffMs(baseMs, attempt);
      logLine(`[rondo] transient retry: ${cmd.slice(1, 3).join(" ")}（第 ${attempt + 1} 次尝试${emptyOk ? " stdout 为空" : "命中网络签名"}，${delay}ms 后重试）`);
      sleepSync(delay);
      continue;
    }
    return r;
  }
}

export interface DispatchEntry {
  dispatch_key?: string;
  engineer_id?: string;
  change_ref?: string;
  task_refs?: string[];
  active?: boolean;
  tfs_task_ids?: Record<string, number>;
}

export interface DispatchFacts {
  projectId: string | null;
  tfsType: string;
  tfsId: number;
  bugMode: boolean;
  dispatches: DispatchEntry[];
  /** active 且 task_refs 覆盖本次请求范围的条目 */
  covering: DispatchEntry[];
  /** covering 条目合并后的 {TFS 任务 id: task_ref} 映射（legacy 在途交付事实；新交付恒为空） */
  idToRef: Map<number, string>;
}

export type DispatchFactsFailureCode =
  | "issue_read"      // Issue 读取失败（环境/权限，不可确认）
  | "dispatch_parse"  // dev.dispatch 不可解析（事实不可确认）
  | "tfs_type"        // tfs.type 缺失/不是 需求/Bug（来源同步问题，交 Lead 核对）
  | "no_covering";    // 无覆盖 task_refs 的 active 条目（派发未物化，确定缺失）

export type DispatchFactsResult =
  | { ok: true; facts: DispatchFacts }
  | { ok: false; code: DispatchFactsFailureCode; reason: string };

/**
 * 读取 Issue 并解析 dev.dispatch，按 taskRefs 求覆盖条目与映射缺口。
 * 只读，零写入。reason 文案与 check-completion 历史口径保持一致（该检查的消费方按文案归类）。
 */
export function loadDispatchFacts(
  cfg: BaseRegistryConfig,
  issueKey: string,
  taskRefs: string[],
): DispatchFactsResult {
  const wsArgs = cfg.runtime.workspace_id ? ["--workspace-id", cfg.runtime.workspace_id] : [];
  const gi = runCommandTransient([...multicaPrefix(cfg.runtime), "issue", "get", issueKey, ...wsArgs, "--output", "json"]);
  if (gi.status !== 0) {
    return { ok: false, code: "issue_read", reason: `读取 Issue ${issueKey} 失败 rc=${gi.status}: ${gi.stderr.trim() || gi.stdout.trim()}` };
  }

  let projectId: string | null = null;
  let tfsType = "";
  let tfsId = NaN;
  let dispatches: DispatchEntry[];
  try {
    const issue = JSON.parse(gi.stdout) as { project_id?: string | null; metadata?: Record<string, string> };
    projectId = issue.project_id ?? null;
    tfsType = typeof issue.metadata?.["tfs.type"] === "string" ? issue.metadata["tfs.type"] : "";
    tfsId = Number(issue.metadata?.["tfs.id"] ?? NaN);
    dispatches = JSON.parse(issue.metadata?.["dev.dispatch"] ?? "[]") as DispatchEntry[];
    if (!Array.isArray(dispatches)) throw new Error("不是数组");
  } catch (exc) {
    return { ok: false, code: "dispatch_parse", reason: `Issue ${issueKey} 的 dev.dispatch 不可解析: ${exc}` };
  }

  const bugMode = tfsType === "Bug";
  if (!bugMode && tfsType !== "需求") {
    return { ok: false, code: "tfs_type", reason: `Issue ${issueKey} metadata tfs.type 缺失或不是 需求/Bug: ${tfsType || "(缺失)"}——不默认按需求核验，交 Lead 核对来源同步` };
  }

  const covering = dispatches.filter((d) =>
    d.active === true && taskRefs.every((r) => (d.task_refs ?? []).includes(r)));
  const idToRef = new Map<number, string>();
  for (const d of covering) {
    for (const [ref, id] of Object.entries(d.tfs_task_ids ?? {})) {
      if (typeof id === "number" && id > 0) idToRef.set(id, ref);
    }
  }
  if (covering.length === 0) {
    return { ok: false, code: "no_covering", reason: `dev.dispatch 无覆盖 task_refs(${taskRefs.join(",")}) 的 active 条目` };
  }
  // TFS 剥离：需求无 tfs_task_ids 是新流程正常态（子任务由 PR 通过后 writeback 创建），
  // 不再作为失败；映射仅作 legacy 兼容事实由消费方自行取用（idToRef）。

  return {
    ok: true,
    facts: { projectId, tfsType, tfsId, bugMode, dispatches, covering, idToRef },
  };
}
