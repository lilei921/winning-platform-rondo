/** 显式根仓的本地检查入口；不负责检出、平台发现或执行者授权。 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { ExitSignal, logLine, markLeafExecuted } from "../../cli/output.js";
import { validateRootRepo } from "../../clients/runtime-paths.js";

const USAGE = "用法: rondo runtime resolve-root-repo --root-repo <根仓路径>\n";

function main(rawArgs: string[]): void {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  // 本入口只消费调用者明确选择的路径，缺参时不回退 cwd 或查询平台。
  if (rawArgs.length !== 2 || rawArgs[0] !== "--root-repo" || !rawArgs[1] || rawArgs[1].startsWith("--")) {
    logLine(USAGE.trimEnd());
    throw new ExitSignal(64);
  }
  const root = validateRootRepo(rawArgs[1], "--root-repo");
  const repoContext = join(root, "docs", "config", "repo-context.yaml");
  if (!existsSync(repoContext)) {
    throw new UnknownError(`根仓缺少 docs/config/repo-context.yaml（仓库语义与路径映射权威数据）: ${repoContext}`);
  }
  process.stdout.write(JSON.stringify({
    root_repo: root,
    openspec_root: join(root, "openspec"),
    repo_context: repoContext,
    source: "explicit_arg",
  }, null, 2) + "\n");
}

export function registerRuntimeResolveRootRepo(group: Command): void {
  group.command("resolve-root-repo")
    .description("只读检查显式根仓并返回本地文档路径")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action((...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      try {
        main(cmd.args);
      } catch (exc) {
        if (exc instanceof UnknownError) {
          process.stdout.write(JSON.stringify({ unknown: true, reason: exc.message }, null, 2) + "\n");
          throw new ExitSignal(3);
        }
        throw exc;
      }
    });
}
