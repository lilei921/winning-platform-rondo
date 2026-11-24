import { readAnalysisSource } from "../analysis/source.js";
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { markLeafExecuted, ExitSignal } from "../../cli/output.js";
import { resolveMulticaRuntime } from "../../clients/runtime-context.js";
import { readApprovedRepoMapping } from "./native-prepare.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import { MulticaClient } from "../../clients/multica.js";
import { checkPublishedChange } from "./change-completion.js";
export function registerDevCheckChange(group: Command): void {
  group.command("check-change").description("核对批准版本、研发发布版本与代码 Evidence 的 Change 级完成检查")
    .requiredOption("--issue <key>").requiredOption("--change-ref <ref>")
    .action(async (opts: { issue: string; changeRef: string }) => {
      markLeafExecuted();
      try {
        const runtime = resolveMulticaRuntime(), client = new MulticaClient(runtime);
        const sourceForMapping = readAnalysisSource(client.getIssue(opts.issue).metadata ?? {});
        const cfg = { runtime, registry: await readApprovedRepoMapping(sourceForMapping, loadTfsConfig().serverUrl) };
        const check = await checkPublishedChange(cfg, client, opts.issue, opts.changeRef);
        if (client.getIssue(opts.issue).metadata?.["analysis.source"] !== JSON.stringify(sourceForMapping) && readAnalysisSource(client.getIssue(opts.issue).metadata??{}).commit !== sourceForMapping.commit) throw new UnknownError("批准来源在检查期间变化");
        process.stdout.write(JSON.stringify({ result: "PASS", ...check }, null, 2) + "\n");
      } catch (e) {
        if (!(e instanceof FailError || e instanceof UnknownError)) throw e;
        process.stdout.write(JSON.stringify({ result: e instanceof FailError ? "FAIL" : "UNKNOWN", reason: e.message }, null, 2) + "\n");
        throw new ExitSignal(e instanceof FailError ? 2 : 3);
      }
    });
}
