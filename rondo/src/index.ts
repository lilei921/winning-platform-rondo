#!/usr/bin/env node
/** Rondo CLI 命令注册、帮助、全局输出选项与退出码映射。 */

import { Command, CommanderError, Option } from "commander";
import { isSea } from "node:sea";
import { ExitSignal, hasLeafExecuted, logLine } from "./cli/output.js";
import { hydrateMulticaTaskEnvironment } from "./clients/runtime-context.js";
import { TOOL_VERSION } from "./cli/version.js";
import { registerTfsApiLeaf } from "./tfs/runner.js";
import { registerResolveIdentity } from "./commands/openspec/resolve-identity.js";
import { registerOpenSpecValidate } from "./commands/openspec/validate.js";
import { registerOpenSpecSubmitReview } from "./commands/openspec/submit-review.js";
import { registerOpenSpecRead } from "./commands/openspec/read.js";
import { registerWorkitemApprove } from "./commands/workitem/approve.js";
import { registerOpenSpecPublish } from "./commands/openspec/publish.js";
import { registerRepoGit } from "./commands/repo/git.js";
import { registerRuntimeCheckCheckout } from "./commands/runtime/check-checkout.js";
import { registerRuntimeCheckDaemon } from "./commands/runtime/check-daemon.js";
import { registerRuntimeGetContext } from "./commands/runtime/get-context.js";
import { registerRuntimeReconcile } from "./commands/runtime/reconcile.js";
import { registerPrResume } from "./commands/pr/resume.js";
import { registerWorkitemApplyDecision } from "./commands/delivery/handoff.js";
import { registerTfsReconcileWorkitem } from "./commands/tfs/reconcile-workitem.js";
import { registerTfsWriteback } from "./commands/tfs/writeback.js";
import { registerPrMaterialize } from "./commands/pr/materialize.js";
import { registerPrPrepare } from "./commands/pr/prepare.js";
import { registerPrReconcileStatus } from "./commands/pr/reconcile-status.js";
import { registerDeliveryFinalize } from "./commands/delivery/finalize.js";
import { registerCloseoutRoot } from "./commands/delivery/closeout-root.js";
import { registerWorkspaceProvision } from "./commands/workspace/provision.js";
import { registerWorkspaceSyncSkills } from "./commands/workspace/sync-skills.js";
import { registerDoctor } from "./commands/doctor/doctor.js";
import { registerOpenspecInstallSchema } from "./commands/openspec/install-schema.js";

const program = new Command().exitOverride();

program
  .name("rondo")
  .description("面向 Multica 研发交付的确定性 CLI，提供交付校验、执行、事实管理及平台运维能力。")
  .addOption(new Option("--output <format>", "输出 JSON").choices(["json"]))
  .addHelpText("after", "\n输出约定：业务命令默认输出 JSON，doctor 默认输出文本；诊断信息走 stderr。\n退出码：0 成功，2 FAIL，3 UNKNOWN，64 用法错误。")
  // --version 输出 JSON(方案 §4.4,沿用 tfs-cli 字段形状)
  .version(
    JSON.stringify({ name: "@winning/rondo", version: TOOL_VERSION, node: process.version, sea: isSea() }, null, 2),
    "--version",
    "输出版本(JSON)",
  );

// 裸 group(不带子命令)视为用法错误:帮助文本走 stderr 保持 stdout 纯净,exit 64。
function bareGroup(group: Command): Command {
  return group.action((...cbArgs: unknown[]) => {
    const cmd = cbArgs[cbArgs.length - 1] as Command;
    logLine(cmd.helpInformation());
    throw new ExitSignal(64);
  });
}

// PR 交付与 TFS PR 操作
const pr = bareGroup(program.command("pr").description("PR 准备、创建、查询、恢复与状态核实"));
registerPrMaterialize(pr);
registerPrPrepare(pr);
registerPrResume(pr);
registerPrReconcileStatus(pr);
registerTfsApiLeaf(pr, "create", ["pr", "create"], "创建 TFS Git PR", "--repo <name|id> --source <branch> --target <branch> --title <title> [--description-file <path>] [--work-items <ids>] [--project <project>]");
registerTfsApiLeaf(pr, "get", ["pr", "get"], "查询指定 TFS Git PR", "--repo <name|id> --id <id> [--project <project>]");
registerTfsApiLeaf(pr, "list", ["pr", "list"], "按条件查询 TFS Git PR", "--repo <name|id> [--status active|completed|abandoned] [--source-branch <branch>] [--top <n>] [--project <project>]");

// Workspace 资源供给与 Skill 同步
const workspace = bareGroup(program.command("workspace").description("Workspace 资源供给与 Skill 同步"));
registerWorkspaceProvision(workspace);
registerWorkspaceSyncSkills(workspace);

// runtime 组
const runtime = bareGroup(program.command("runtime").description("Runtime、Daemon 检查、Checkout 与主备协调"));
registerRuntimeCheckDaemon(runtime);
registerRuntimeCheckCheckout(runtime);
registerRuntimeGetContext(runtime);
registerRuntimeReconcile(runtime);

// OpenSpec 工程契约操作
const openspec = bareGroup(program.command("openspec").description("OpenSpec Change、Schema 与工件管理"));
registerResolveIdentity(openspec);
registerOpenspecInstallSchema(openspec);
registerOpenSpecValidate(openspec);
registerOpenSpecRead(openspec);
registerOpenSpecSubmitReview(openspec);
registerOpenSpecPublish(openspec);


// doctor: 全局环境体检
registerDoctor(program);

const repo = bareGroup(program.command("repo").description("Git 仓库查询、准备与受控操作"));
registerTfsApiLeaf(repo, "get", ["repo", "get"], "查询 TFS Git 仓库信息", "--repo <name|id> [--project <project>]");
registerTfsApiLeaf(repo, "get-branch", ["repo", "get-branch"], "查询指定 TFS Git 分支及 HEAD", "--repo <name|id> --branch <branch> [--project <project>]");
registerRepoGit(repo);
registerCloseoutRoot(repo);

const workitem = bareGroup(program.command("workitem").description("工作项同步、准入、批准、收口与查询操作"));
registerWorkitemApprove(workitem);
registerWorkitemApplyDecision(workitem);
registerDeliveryFinalize(workitem);
registerTfsReconcileWorkitem(workitem);
registerTfsWriteback(workitem);
registerTfsApiLeaf(workitem, "set-state", ["workitem", "set-state"], "更新 TFS 工作项状态", "--id <id> --state <state> [--complete-with-estimate] [--project <project>]");
registerTfsApiLeaf(workitem, "comment", ["workitem", "comment"], "写入 TFS 工作项评论", "--id <id> --text-file <path> [--project <project>]");
registerTfsApiLeaf(workitem, "create", ["workitem", "create"], "创建并关联 TFS 子工作项", "--type <type> --title <title> --parent <id> [--description-file <path>] [--estimate <hours>] [--project <project>]");
registerTfsApiLeaf(workitem, "link-commits", ["workitem", "link-commits"], "将 Git Commit 关联至 TFS 工作项", "--id <id> --repo <name|id> --sha <sha,...> [--project <project>]");
registerTfsApiLeaf(workitem, "download-attachment", ["workitem", "download-attachment"], "下载 TFS 工作项附件", "--url <url> --out <directory> [--name <file>]");

program.hook("preAction", () => { hydrateMulticaTaskEnvironment(); });

// async action 需要 parseAsync;包成 IIFE 避免顶层 await(esbuild CJS bundle 不支持 TLA)。
void (async () => {
  try {
    await program.parseAsync(process.argv);
    // 无参数 / 裸 group:视为用法错误(exit 64),帮助文本走 stderr 保持 stdout 纯净。
    if (!hasLeafExecuted()) {
      program.outputHelp({ error: true });
      process.exit(64);
    }
  } catch (e) {
    if (e instanceof ExitSignal) {
      process.exit(e.code);
    }
    if (e instanceof CommanderError) {
      // --help / --version 已正常输出;其余(未知命令等)归一化为用法错误 64。
      process.exit(e.exitCode === 0 ? 0 : 64);
    }
    throw e;
  }
})();
