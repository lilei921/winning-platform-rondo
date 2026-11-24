/** 共用的本地只读就绪检查；已识别的 Task Checkout 同时核对本地身份。 */
import { dirname } from "node:path";
import { Command } from "commander";
import { validateNativeCheckout, nativeCheckoutExpected, assertNativeTaskCheckout } from "../../clients/native-checkout.js";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";

export function registerRuntimeCheckCheckout(group: Command): void {
  group.command("check-checkout").description("只读检查指定 Git 根仓与根仓规范是否就绪")
    .requiredOption("--root-repo <path>")
    .action((opts: { rootRepo: string }) => {
      markLeafExecuted();
      try {
        const paths = validateNativeCheckout(opts.rootRepo);
        if (nativeCheckoutExpected(paths.rootRepo)) assertNativeTaskCheckout(paths.rootRepo, dirname(paths.rootRepo));
        process.stdout.write(JSON.stringify({ result: "PASS", ...paths, changed: false }) + "\n");
      } catch (e) {
        if (!(e instanceof FailError || e instanceof UnknownError)) throw e;
        process.stdout.write(JSON.stringify({ result: e instanceof FailError ? "FAIL" : "UNKNOWN", reason: e.message }) + "\n");
        throw new ExitSignal(e instanceof FailError ? 2 : 3);
      }
    });
}
