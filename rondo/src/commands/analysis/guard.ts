/** 仅允许当前 Analysis 提交；历史 Human Approval 不是永久禁用标记。 */
import { UnknownError } from "../../cli/errors.js";

/** 相同 Facts 已处于 analysis_review 时返回 false，恢复时不重复写状态。 */
export function assertAnalysisWritable(
  issue: Record<string, unknown>,
  metadata: Record<string, unknown>,
  phase: "stage" | "complete",
  expected?: Record<string, string>,
): boolean {
  const status = String(issue.status ?? issue.status_name ?? "");
  if (phase === "complete" && status === "analysis_review") {
    if (!expected || Object.entries(expected).some(([key, value]) => String(metadata[key] ?? "") !== value)) {
      throw new UnknownError("Issue 已在 analysis_review，但 Facts 与当前审核版本不一致，禁止重放旧提交");
    }
    return false;
  }
  // blocked 可能表示 PR Abandoned 等其他阻塞，不等于 Analysis 授权。
  if (status !== "in_progress") {
    throw new UnknownError(`Issue.status=${status || "<missing>"}，当前不允许 Analysis ${phase}`);
  }
  // in_progress 只是必要条件；本次分析或返工的授权仍由 Delivery Lead / Human 确认。
  return true;
}
