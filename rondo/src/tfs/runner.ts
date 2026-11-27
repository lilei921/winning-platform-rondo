/**
 * tfs/runner.ts —— TFS API 命令的 CLI 运行器(承自 tfs-cli index.ts main 的错误映射)。
 *
 * 契约:退出码 0 成功 / 2 单项失败 / 3 UNKNOWN / 64 用法错误;stdout 只出 JSON,日志走 stderr。
 * FailError.message 可能是 JSON 字符串(found:false 场景)——原样作为 stdout 契约输出。
 */

import { Command } from "commander";
import { markLeafExecuted } from "../cli/output.js";
import { FailError, UnknownError } from "./client.js";
import { ConfigError } from "./config.js";
import { dispatchTfs, UsageError } from "./dispatch.js";
import { TFS_API_USAGE } from "./usage.js";

export async function runTfsApi(argv: string[]): Promise<number> {
  try {
    const result = await dispatchTfs(argv);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  } catch (e: any) {
    if (e instanceof UsageError) {
      if (e.message) console.error(`用法错误: ${e.message}`);
      console.error(TFS_API_USAGE);
      return 64;
    }
    if (e instanceof FailError) {
      try {
        const parsed = JSON.parse(e.message);
        process.stdout.write(JSON.stringify(parsed, null, 2) + "\n");
      } catch {
        process.stdout.write(JSON.stringify({ error: e.message }, null, 2) + "\n");
      }
      console.error(`FAIL: ${e.message}`);
      return 2;
    }
    if (e instanceof ConfigError || e instanceof UnknownError) {
      console.error(`UNKNOWN: ${e.message}`);
      process.stdout.write(JSON.stringify({ unknown: true, reason: e.message }, null, 2) + "\n");
      return 3;
    }
    console.error(`UNKNOWN: ${e?.message || e}`);
    process.stdout.write(JSON.stringify({ unknown: true, reason: String(e?.message || e) }, null, 2) + "\n");
    return 3;
  }
}

/**
 * 注册一个 TFS API 叶子:argv 前缀(如 ["workitem","set-state"])+ 原始参数交 dispatchTfs。
 * Commander 处理帮助；业务参数仍交给 dispatchTfs。
 */
export function registerTfsApiLeaf(group: Command, name: string, argvPrefix: string[], description: string, usage: string): void {
  group
    .command(name)
    .description(description)
    .usage(usage)
    .addHelpText("after", "\n配置：通过 TFS_PAT 和 TFS_SERVER_URL（或 TFS_URL / TFS_COLLECTION）连接 TFS；TFS_PROJECT 为默认项目。")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      process.exit(await runTfsApi([...argvPrefix, ...cmd.args]));
    });
}
