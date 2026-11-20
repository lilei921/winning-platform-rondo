/**
 * dev contract-hash — 计算 Change 契约文件哈希（rll5-replay-remediation-plan M2.1/F2）。
 *
 * 调用方：Backend/Frontend Engineer（写 evidence.json 时）。
 * 输出即 evidence 的 contract_files 字段值：{ algorithm: "sha256", files: { <相对路径>: <hash> } }。
 * 归档感知：change 已归档（changes/archive/*<ref>）也能解析（复用 finalize 的 resolveChangeDir）。
 *
 * 用法：rondo dev contract-hash --openspec-root <根仓或 openspec 目录> --change-ref <ref>
 * 退出码：0 PASS / 3 UNKNOWN / 64 用法错误。stdout 只出 JSON；日志走 stderr。
 */

import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { resolveOpenspecRootDir, type RuntimePaths } from "../../clients/runtime-paths.js";
import { computeContractFiles } from "../delivery/contract-files.js";
import { resolveChangeDir } from "../delivery/finalize.js";

const USAGE = "用法: rondo dev contract-hash --openspec-root <根仓或 openspec 目录> --change-ref <ref>\n";

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

function main(rawArgs: string[]): number {
  const args = parseArgs(rawArgs);
  // --help：stdout 用法 + exit 0（M5 先例：change resolve-identity）
  if (args.help || args.h) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (typeof args["openspec-root"] !== "string" || typeof args["change-ref"] !== "string") {
    process.stderr.write(USAGE);
    return 64;
  }
  try {
    const openspecRoot = resolveOpenspecRootDir(args["openspec-root"]);
    // resolveChangeDir 只消费 openspecRoot（归档感知）；其余字段本命令用不到
    const paths = { openspecRoot } as RuntimePaths;
    const change = resolveChangeDir(paths, args["change-ref"]);
    process.stdout.write(JSON.stringify(computeContractFiles(change.dir), null, 2) + "\n");
    return 0;
  } catch (exc) {
    if (exc instanceof UnknownError) {
      process.stdout.write(JSON.stringify({ result: "UNKNOWN", reason: exc.message }, null, 2) + "\n");
      return 3;
    }
    if (exc instanceof Error && /契约文件缺失/.test(exc.message)) {
      process.stdout.write(JSON.stringify({ result: "UNKNOWN", reason: exc.message }, null, 2) + "\n");
      return 3;
    }
    throw exc;
  }
}

/** commander 注册：group=dev（M2.1 新增叶子；cli-surface TREE 相应 +1）。 */
export function registerDevContractHash(group: Command): void {
  group
    .command("contract-hash")
    .description("计算 Change 契约文件哈希（evidence contract_files 取值，M2.1）")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action((...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      const code = main(cmd.args);
      if (code !== 0) throw new ExitSignal(code);
    });
}
