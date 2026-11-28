import { resolveIssueRef } from "../../clients/native-checkout.js";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { markLeafExecuted } from "../../cli/output.js";
import { resolveMulticaRuntime } from "../../clients/runtime-context.js";
import { MulticaClient } from "../../clients/multica.js";
import { readAnalysisArtifact, readAnalysisSource } from "../analysis/source.js";

/** Lead 按 Issue 的审核快照读取工件，无需根仓挂载，也不修改任何平台事实。 */
export function registerOpenSpecRead(group: Command): void {
  group.command("read").description("读取 Issue 已登记版本的 OpenSpec 工件")
    .option("--issue <key-or-id>", "Multica Issue，默认当前 Issue")
    .requiredOption("--file <path>", "Change 内相对路径，例如 tasks.md")
    .action(async (args: { issue?: string; file: string }) => {
      markLeafExecuted();
      try {
        const issue = new MulticaClient(resolveMulticaRuntime()).getIssue(resolveIssueRef(args.issue));
        const source = readAnalysisSource(issue.metadata ?? {});
        const artifact = await readAnalysisArtifact(source, args.file);
        process.stdout.write(JSON.stringify({ result: "PASS", ...artifact }, null, 2) + "\n");
      } catch (exc) {
        const failed = exc instanceof FailError;
        process.stdout.write(JSON.stringify({ result: failed ? "FAIL" : "UNKNOWN", reason: exc instanceof Error ? exc.message : String(exc) }) + "\n");
        process.exitCode = failed ? 2 : 3;
      }
    });
}
