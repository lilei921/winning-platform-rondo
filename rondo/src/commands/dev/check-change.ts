import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { markLeafExecuted, ExitSignal } from "../../cli/output.js";
import { loadConfig, type BaseRegistryConfig } from "../../clients/config.js";
import { MulticaClient } from "../../clients/multica.js";
import { checkPublishedChange } from "./change-completion.js";
export function registerDevCheckChange(group: Command): void {
  group.command("check-change").description("核对批准版本、研发发布版本与代码 Evidence 的 Change 级完成检查")
    .requiredOption("--config <file>").requiredOption("--issue <key>").requiredOption("--change-ref <ref>")
    .action(async (opts: { config: string; issue: string; changeRef: string }) => {
      markLeafExecuted();
      try {
        const cfg = loadConfig<BaseRegistryConfig>(opts.config);
        const check = await checkPublishedChange(cfg, new MulticaClient(cfg.runtime), opts.issue, opts.changeRef);
        process.stdout.write(JSON.stringify({ result: "PASS", ...check }, null, 2) + "\n");
      } catch (e) {
        if (!(e instanceof FailError || e instanceof UnknownError)) throw e;
        process.stdout.write(JSON.stringify({ result: e instanceof FailError ? "FAIL" : "UNKNOWN", reason: e.message }, null, 2) + "\n");
        throw new ExitSignal(e instanceof FailError ? 2 : 3);
      }
    });
}
