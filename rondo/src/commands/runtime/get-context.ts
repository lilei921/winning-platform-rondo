import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { emitJson, markLeafExecuted } from "../../cli/output.js";
import { resolveRuntimeContext } from "../../clients/runtime-context.js";

/** 查询当前 Run 的 Multica Workspace 与 Delivery Squad；不读取 Registry 或修改平台。 */
export function registerRuntimeGetContext(group: Command): void {
  group.command("get-context")
    .description("只读获取当前 Multica Run 的 Runtime 配置")
    .action(() => {
      markLeafExecuted();
      try {
        emitJson({ result: "PASS", runtime: resolveRuntimeContext() }, 0);
      } catch (error) {
        if (error instanceof UnknownError) {
          emitJson({ result: "UNKNOWN", reason: error.message }, 3);
        }
        throw error;
      }
    });
}
