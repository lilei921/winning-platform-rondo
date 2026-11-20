/**
 * cli/output.ts — rondo 统一输出与退出语义。
 *
 * 契约（与原 21 个独立脚本一致）：
 *   stdout 只出 JSON（2 空格缩进 + 末尾换行）；日志走 stderr；
 *   退出码 0 成功 / 2 FAIL（前置不满足）/ 3 UNKNOWN（环境不可确认）/ 64 用法错误。
 *
 * process.exit 不会展开栈（finally 中的锁清理等不会执行），
 * 统一以 ExitSignal 抛出、src/index.ts 顶层捕获后退出。
 */

export class ExitSignal extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`exit ${code}`);
    this.code = code;
  }
}

/** 输出 JSON 并请求退出（抛 ExitSignal，由顶层统一 process.exit）。 */
export function emitJson(answer: unknown, exitCode: number): never {
  process.stdout.write(JSON.stringify(answer, null, 2) + "\n");
  throw new ExitSignal(exitCode);
}

/** stderr 日志，prefix 为命令标识（保持原脚本的 [command-name] 形态）。 */
export function log(prefix: string, ...args: unknown[]): void {
  console.error(`[${prefix}]`, ...args);
}

/** stderr 裸行日志（保持原平台类脚本 `log(msg)` 的无前缀形态）。 */
export function logLine(msg: string): void {
  process.stderr.write(msg + "\n");
}

/** 叶子命令执行标记：index.ts 据此把"裸 group / 无参数"归为用法错误（exit 64）。 */
let leafExecuted = false;
export function markLeafExecuted(): void {
  leafExecuted = true;
}
export function hasLeafExecuted(): boolean {
  return leafExecuted;
}
