import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { prepareRoot } from "./root-git.js";

export function registerRuntimePrepareRoot(group: Command): void {
  group.command("prepare-root")
    .description("准备常驻根仓的工作分支")
    .option("--root-repo <path>", "常驻根仓路径")
    .option("--branch <name>", "兼容参数；项目分支取 RONDO_WORKSPACE_BRANCH")
    .action((opts: { rootRepo?: string; branch?: string }) => {
      markLeafExecuted();
      try {
        process.stdout.write(JSON.stringify({ result: "PASS", ...prepareRoot(opts.rootRepo, opts.branch) }) + "\n");
      } catch (e) {
        if (!(e instanceof FailError || e instanceof UnknownError)) throw e;
        process.stdout.write(JSON.stringify({ result: e instanceof FailError ? "FAIL" : "UNKNOWN", reason: e.message }) + "\n");
        throw new ExitSignal(e instanceof FailError ? 2 : 3);
      }
    });
}
