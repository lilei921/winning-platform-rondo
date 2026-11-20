/**
 * clients/required-statuses.ts — 交付流水线消费的 Issue 状态键清单（单一事实源）。
 *
 * 方案：projects/plans/workspace-workflow-status-provisioning-plan.md M3。
 *
 * CUSTOM_PIPELINE_STATUSES：流水线消费、且非 multica 内建的自定义状态键——必须由
 * workspace-skills/_shared/provisioning.json 的 workflow.statuses 段供给；
 * 防漂移测试（required-statuses.test.ts）断言 manifest 覆盖本清单。
 * 消费点锚点（新增消费键必须先登记此处并过测试）：
 *   analysis_review — commands/analysis/complete.ts TARGET_STATUS（02 §5.4 收口置态）；
 *                     commands/analysis/guard.ts（幂等判定）
 *   unsupported     — 02 契约人工决策路由（不支持类需求终态）
 *
 * 注：in_review / blocked 同为流水线消费键，但属 multica 内建键
 * （multica issue status --help：backlog, todo, in_progress, in_review, done, blocked, cancelled），
 * 无需 manifest 供给。
 */

export const CUSTOM_PIPELINE_STATUSES = ["analysis_review", "unsupported"] as const;

export const BUILTIN_STATUS_KEYS = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] as const;
