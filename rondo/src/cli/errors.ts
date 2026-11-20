/**
 * cli/errors.ts — rondo 统一错误类型。
 *
 * UnknownError → exit 3（环境/身份不可确认，零写入语义由各命令保证）；
 * FailError    → exit 2（前置不满足，message 为纯文本 reason）。
 * 各命令模块在顶层捕获并映射为自己的 stdout JSON 契约。
 */

export class UnknownError extends Error {}
export class FailError extends Error {}
