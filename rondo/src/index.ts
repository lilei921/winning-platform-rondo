#!/usr/bin/env node
/** Rondo CLI 命令注册、帮助、全局输出选项与退出码映射。 */

import { Command, CommanderError, Option } from "commander";
import { isSea } from "node:sea";
import { ExitSignal, hasLeafExecuted, logLine } from "./cli/output.js";
import { hydrateMulticaTaskEnvironment } from "./clients/runtime-context.js";
import { TOOL_VERSION } from "./cli/version.js";
import { registerTfsApiLeaf } from "./tfs/runner.js";
import { registerResolveIdentity } from "./commands/openspec/resolve-identity.js";
import { registerAnalysisValidate } from "./commands/analysis/validate.js";
import { registerAnalysisPublish } from "./commands/analysis/publish.js";
import { registerAnalysisRead } from "./commands/analysis/read.js";
import { registerAnalysisApprove } from "./commands/analysis/approve.js";
import { registerDevPublish } from "./commands/dev/publish.js";
import { registerDevGit } from "./commands/dev/git.js";
import { registerRuntimeCheckCheckout } from "./commands/runtime/check-checkout.js";
import { registerRuntimePrepareRoot } from "./commands/runtime/prepare-root.js";
import { registerRuntimeGetContext } from "./commands/runtime/get-context.js";
import { registerPrResume } from "./commands/pr/resume.js";
import { registerDeliveryAdmission } from "./commands/delivery/handoff.js";
import { registerTfsReconcileWorkitem } from "./commands/tfs/reconcile-workitem.js";
import { registerTfsWriteback } from "./commands/tfs/writeback.js";
import { registerPrMaterialize } from "./commands/pr/materialize.js";
import { registerPrPrepare } from "./commands/pr/prepare.js";
import { registerPrWorktree } from "./commands/pr/worktree.js";
import { registerPrReconcileStatus } from "./commands/pr/reconcile-status.js";
import { registerDeliveryFinalize } from "./commands/delivery/finalize.js";
import { registerCloseoutRoot } from "./commands/delivery/closeout-root.js";
import { registerWorkspaceProvision } from "./commands/workspace/provision.js";
import { registerWorkspaceSync } from "./commands/workspace/sync.js";
import { registerWorkspaceCheckDaemon } from "./commands/workspace/check-daemon.js";
import { registerRuntimeResolveRootRepo } from "./commands/runtime/resolve-root-repo.js";
import { registerDoctor } from "./commands/doctor/doctor.js";
import { registerOpenspecInstallSchema } from "./commands/openspec/install-schema.js";

const program = new Command();

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

const analysis = bareGroup(program.command("analysis").description("分析校验、发布、读取与批准登记"));
registerAnalysisValidate(analysis);
registerAnalysisPublish(analysis);
registerAnalysisRead(analysis);
registerAnalysisApprove(analysis);

const dev = bareGroup(program.command("dev").description("研发 Git 操作与工件发布"));
registerDevGit(dev);
registerDevPublish(dev);


const tfs = bareGroup(program.command("tfs").description("TFS 工作项同步与交付回写"));
registerTfsWriteback(tfs);
registerTfsReconcileWorkitem(tfs);

// pr 组:flow(materialize/worktree/reconcile-status)+ TFS API(create/get/list)合并,子命令名不交叠(方案 §3.1)
const pr = bareGroup(program.command("pr").description("PR 准备、创建、恢复、状态核实及 Worktree 管理"));
registerPrMaterialize(pr);
registerPrPrepare(pr);
registerPrResume(pr);
registerPrWorktree(pr);
registerPrReconcileStatus(pr);
registerTfsApiLeaf(pr, "create", ["pr", "create"], "创建 TFS Git PR", "--repo <name|id> --source <branch> --target <branch> --title <title> [--description-file <path>] [--work-items <ids>] [--project <project>]");
registerTfsApiLeaf(pr, "get", ["pr", "get"], "查询指定 TFS Git PR", "--repo <name|id> --id <id> [--project <project>]");
registerTfsApiLeaf(pr, "list", ["pr", "list"], "按条件查询 TFS Git PR", "--repo <name|id> [--status active|completed|abandoned] [--source-branch <branch>] [--top <n>] [--project <project>]");

const delivery = bareGroup(program.command("delivery").description("准入执行与交付收口"));
registerDeliveryAdmission(delivery);
registerDeliveryFinalize(delivery);
registerCloseoutRoot(delivery);

// workspace 组(运维/供给,与 flow 组隔离)
const workspace = bareGroup(program.command("workspace").description("Workspace 资源供给、同步与检查"));
registerWorkspaceProvision(workspace);
registerWorkspaceSync(workspace);
registerWorkspaceCheckDaemon(workspace);

// runtime 组(运行时路径解析工具)
const runtime = bareGroup(program.command("runtime").description("Runtime 上下文与根仓管理"));
registerRuntimeResolveRootRepo(runtime);
registerRuntimeCheckCheckout(runtime);
registerRuntimePrepareRoot(runtime);
registerRuntimeGetContext(runtime);

// OpenSpec 身份解析与 Schema 安装
const openspec = bareGroup(program.command("openspec").description("OpenSpec Change 身份解析与 Schema 安装"));
registerResolveIdentity(openspec);
registerOpenspecInstallSchema(openspec);


// doctor: 全局环境体检
registerDoctor(program);

const repo = bareGroup(program.command("repo").description("TFS Git 仓库查询"));
registerTfsApiLeaf(repo, "get", ["repo", "get"], "查询 TFS Git 仓库信息", "--repo <name|id> [--project <project>]");
registerTfsApiLeaf(repo, "get-branch", ["repo", "get-branch"], "查询指定 TFS Git 分支及 HEAD", "--repo <name|id> --branch <branch> [--project <project>]");

const workitem = bareGroup(program.command("workitem").description("TFS 工作项查询与操作"));
registerTfsApiLeaf(workitem, "query", ["workitem", "query"], "执行 TFS WIQL 查询", "--wiql <WIQL> [--project <project>]");
registerTfsApiLeaf(workitem, "set-state", ["workitem", "set-state"], "更新 TFS 工作项状态", "--id <id> --state <state> [--complete-with-estimate] [--project <project>]");
registerTfsApiLeaf(workitem, "comment", ["workitem", "comment"], "写入 TFS 工作项评论", "--id <id> --text-file <path> [--project <project>]");
registerTfsApiLeaf(workitem, "create", ["workitem", "create"], "创建并关联 TFS 子工作项", "--type <type> --title <title> --parent <id> [--description-file <path>] [--estimate <hours>] [--project <project>]");
registerTfsApiLeaf(workitem, "link-commits", ["workitem", "link-commits"], "将 Git Commit 关联至 TFS 工作项", "--id <id> --repo <name|id> --sha <sha,...> [--project <project>]");
registerTfsApiLeaf(workitem, "download-attachment", ["workitem", "download-attachment"], "下载 TFS 工作项附件", "--url <url> --out <directory> [--name <file>]");

program.hook("preAction", () => { hydrateMulticaTaskEnvironment(); });

program.exitOverride();

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
