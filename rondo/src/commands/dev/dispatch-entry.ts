/**
 * dispatch-entry.ts — dev.dispatch 事实形状的 writer 侧唯一权威（rll5-replay-remediation-plan M1/F1）。
 *
 * 背景：materialize.ts（writer）与 route-decision.ts / dispatch-facts.ts（reader）各自持有
 * DispatchEntry 形状。F1 修复需要 route-decision 在返工路由时"恢复同一派发"（同 dispatch_key
 * 新 active 条目），形状必须唯一权威，否则 writer/reader 漂移即事实破损。
 *
 * 本模块只做纯数据构造，无任何 I/O。
 */

/** dev.dispatch metadata 单条目形状（与 dispatch-facts-contract.md 对齐）。 */
import type { AnalysisSource } from "../analysis/source.js";

export interface DispatchEntry {
  dispatch_key: string;
  task_refs: string[];
  engineer_id: string;
  engineer_name: string;
  projection: "parent" | "sub_issue";
  sub_issue_ref: string | null;
  change_ref: string;
  /** 新派发必须保存来源；可选类型仅用于读取历史条目，历史条目不允许重新派发/激活。 */
  analysis_source?: AnalysisSource;
  approved_comment_ref: string;
  dispatched_at: string;
  active: boolean;
  invalidated_by?: string;
  /** F1：返工再派发条目记录恢复来源（触发评论 id）；首派条目无此键。 */
  rework_comment_ref?: string;
}

/** dispatch_key 公式（materialize.ts 原公式原样迁入）：issueKey#sortedRefs#engineerId。 */
export function dispatchKeyFor(issueKey: string, sortedRefs: string[], engineerId: string): string {
  return `${issueKey}#${sortedRefs.join(",")}#${engineerId}`;
}

/**
 * 返工再派发：从已失效目标条目恢复"同一派发"（同 dispatch_key 新 active 条目）。
 * 整体 spread 继承（task_refs 拷贝、sub_issue_ref / 遗留键原样保留），仅覆盖：
 *   dispatched_at=now / active=true / invalidated_by=undefined / rework_comment_ref=commentId。
 * 语义上是"恢复同一派发"而非重复派发（02 §11.2 契约文本偏差，见实施报告）。
 */
export function buildReworkDispatch(target: DispatchEntry, commentId: string): DispatchEntry {
  return {
    ...target,
    task_refs: [...target.task_refs],
    dispatched_at: new Date().toISOString(),
    active: true,
    invalidated_by: undefined,
    rework_comment_ref: commentId,
  };
}
