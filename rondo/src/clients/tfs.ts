/**
 * clients/tfs.ts — flow 层 TFS 客户端(rondo 合并后:进程内调用,方案 §4.2)。
 *
 * 承自 rondo 的 spawn 形态,语义逐点等价于原 runJson 契约:
 *   - 成功(exit 0)        → 返回结果对象;
 *   - FailError(exit 2)   → FAIL JSON 作为**数据**返回(message 可解析则返回解析值,否则 {error});
 *   - ConfigError/UnknownError(exit 3) → 抛 UnknownError,消息形如 `${what} UNKNOWN: {json}`,
 *     与原 runJson 读取子进程 stdout({unknown:true,reason})的消息形状一致;
 *   - UsageError(exit 64) → 理论上 flow 层不会触发(参数由代码构造),按 rc=64 形态近似。
 *
 * 调用方为 async:`await tfs.run([...], what)`;registry `runtime.tfs_cli` 键废弃。
 */

import { UnknownError } from "../cli/errors.js";
import { FailError, UnknownError as TfsUnknownError } from "../tfs/client.js";
import { ConfigError } from "../tfs/config.js";
import { dispatchTfs, UsageError } from "../tfs/dispatch.js";

export class TfsClient {
  async run(args: string[], what: string): Promise<unknown> {
    try {
      return await dispatchTfs(args);
    } catch (e) {
      if (e instanceof FailError) {
        // runJson exit-2 等价:子进程 stdout 是 FAIL JSON,runJson 解析后作为数据返回
        try {
          return JSON.parse(e.message);
        } catch {
          return { error: e.message };
        }
      }
      if (e instanceof ConfigError || e instanceof TfsUnknownError) {
        // runJson exit-3 等价:`${what} UNKNOWN: ${子进程 stdout(trim)}`,
        // 子进程 stdout 即 {unknown:true,reason} 的 2 空格缩进 JSON
        const stdoutJson = JSON.stringify({ unknown: true, reason: e.message }, null, 2);
        throw new UnknownError(`${what} UNKNOWN: ${stdoutJson}`);
      }
      if (e instanceof UsageError) {
        throw new UnknownError(`${what} 命令失败 rc=64: 用法错误: ${e.message}`);
      }
      const msg = e instanceof Error ? e.message : String(e);
      const stdoutJson = JSON.stringify({ unknown: true, reason: msg }, null, 2);
      throw new UnknownError(`${what} UNKNOWN: ${stdoutJson}`);
    }
  }
}
