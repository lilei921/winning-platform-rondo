/**
 * workspace check-daemon — daemon 主机的注册与版本体检。
 * 根仓路径由调用方显式提供；本命令不检查项目挂载或交付成员的运行亲和。
 * 退出码：0 PASS / 2 FAIL / 3 UNKNOWN / 64 用法错误。
 */
import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { TOOL_VERSION } from "../../cli/version.js";
import { runJson } from "../../clients/spawn.js";

interface Check { name: string; result: "PASS" | "FAIL"; reasons: string[] }
interface RuntimeRec { id?: string; daemon_id?: string }

function main(argv: string[]): void {
  let workspaceId = "";
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!["--workspace-id", "--project-id"].includes(key) || !argv[i + 1] || argv[i + 1].startsWith("--")) {
      process.stderr.write(`无法识别的参数或缺少值: ${key}\n`);
      throw new ExitSignal(64);
    }
    const value = argv[++i];
    if (key === "--workspace-id") workspaceId = value;
    // 接受既有维护脚本的 project-id；注册体检不再按项目限定或查询资源。
  }
  if (!workspaceId) {
    process.stderr.write("用法: rondo workspace check-daemon --workspace-id <id>\n");
    throw new ExitSignal(64);
  }

  const daemonId = process.env.MULTICA_DAEMON_ID?.trim() || null;
  const checks: Check[] = [daemonId
    ? { name: "daemon_env", result: "PASS", reasons: [`MULTICA_DAEMON_ID=${daemonId}`] }
    : { name: "daemon_env", result: "FAIL", reasons: ["MULTICA_DAEMON_ID 未配置，请核对 daemon 主机的运行环境"] }];

  const runtimes = runJson(["multica", "runtime", "list", "--workspace-id", workspaceId, "--output", "json"],
    "读取 Runtime 列表", undefined, { transient: true });
  if (!Array.isArray(runtimes)) throw new UnknownError("Runtime 列表不可核实");
  const registered = (runtimes as RuntimeRec[]).filter(r => r?.daemon_id === daemonId);
  checks.push(daemonId && registered.length
    ? { name: "daemon_registered", result: "PASS", reasons: [`daemon ${daemonId} 在工作区有 ${registered.length} 条 Runtime`] }
    : { name: "daemon_registered", result: "FAIL", reasons: [daemonId
      ? `MULTICA_DAEMON_ID=${daemonId} 不在本工作区任何 Runtime 的 daemon_id 中`
      : "MULTICA_DAEMON_ID 未配置，无法校验注册"] });

  // 当前进程版本仅用于诊断，不替代工作区版本发布验收。
  checks.push({ name: "skill_flow", result: "PASS", reasons: [`rondo ${TOOL_VERSION}（当前进程）`] });
  const failed = checks.some(c => c.result === "FAIL");
  process.stdout.write(JSON.stringify({ result: failed ? "FAIL" : "PASS", checks }, null, 2) + "\n");
  throw new ExitSignal(failed ? 2 : 0);
}

export function registerWorkspaceCheckDaemon(group: Command): void {
  group.command("check-daemon").description("daemon 注册与版本检查")
    .helpOption(false).allowUnknownOption(true).allowExcessArguments(true)
    .action((...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      try { main(cmd.args); }
      catch (exc) {
        if (exc instanceof UnknownError) {
          process.stdout.write(JSON.stringify({ result: "UNKNOWN", reason: exc.message }, null, 2) + "\n");
          throw new ExitSignal(3);
        }
        throw exc;
      }
    });
}
