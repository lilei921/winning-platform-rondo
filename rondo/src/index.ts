#!/usr/bin/env node
/**
 * rondo —— Multica 交付流水线统一 CLI(方案:projects/plans/rondo-cli-merge-plan.md)。
 *
 * 由 rondo(编排层)与 tfs-cli(TFS API 层)合并而来,命令面铺平:
 *   flow 组:change / analysis / dev / tfs / pr(materialize|worktree|reconcile-status)/
 *           delivery / workspace / runtime —— 原 rondo 逐字保留;
 *   TFS API:query / repo get / branch get / pr create|get|list / workitem * —— 原 tfs-cli。
 *
 * 基线语义:退出码 0 成功 / 2 FAIL / 3 UNKNOWN / 64 用法错误;
 * stdout 只出 JSON,日志走 stderr。
 *
 * commander 只做 group/command 两级路由与 --help;
 * 各命令的参数解析沿用原实现(helpOption(false) + allowUnknownOption),
 * 保证 stdout JSON、退出码与用法错误消息逐字节等价。
 */

import { Command, CommanderError } from "commander";
import { isSea } from "node:sea";
import { ExitSignal, hasLeafExecuted, logLine } from "./cli/output.js";
import { TOOL_VERSION } from "./cli/version.js";
import { registerTfsApiLeaf } from "./tfs/runner.js";
import { registerResolveIdentity } from "./commands/change/resolve-identity.js";
import { registerUpdateProgress } from "./commands/change/update-progress.js";
import { registerAnalysisValidate } from "./commands/analysis/validate.js";
import { registerAnalysisComplete } from "./commands/analysis/complete.js";
import { registerAnalysisStage } from "./commands/analysis/stage.js";
import { registerAnalysisRead } from "./commands/analysis/read.js";
import { registerAnalysisApprove } from "./commands/analysis/approve.js";
import { registerDevMaterialize } from "./commands/dev/materialize.js";
import { registerDevPrepare } from "./commands/dev/prepare.js";
import { registerDevCheckCompletion } from "./commands/dev/check-completion.js";
import { registerDevCheckChange } from "./commands/dev/check-change.js";
import { registerDevPublish } from "./commands/dev/publish.js";
import { registerDevCheckDispatch } from "./commands/dev/check-dispatch.js";
import { registerDevContractHash } from "./commands/dev/contract-hash.js";
import { registerDevGit } from "./commands/dev/git.js";
import { registerRuntimeCheckCheckout } from "./commands/runtime/check-checkout.js";
import { registerRuntimePrepareRoot } from "./commands/runtime/prepare-root.js";
import { registerRuntimeGetContext } from "./commands/runtime/get-context.js";
import { registerBugResume } from "./commands/bug/resume.js";
import { registerDeliveryAdmission } from "./commands/delivery/handoff.js";
import { registerTfsMaterializeTasks } from "./commands/tfs/materialize-tasks.js";
import { registerTfsResolveTasks } from "./commands/tfs/resolve-tasks.js";
import { registerTfsReconcileWorkitem } from "./commands/tfs/reconcile-workitem.js";
import { registerTfsWriteback } from "./commands/tfs/writeback.js";
import { registerPrMaterialize } from "./commands/pr/materialize.js";
import { registerPrPrepare } from "./commands/pr/prepare.js";
import { registerPrWorktree } from "./commands/pr/worktree.js";
import { registerPrReconcileStatus } from "./commands/pr/reconcile-status.js";
import { registerDeliveryRouteDecision } from "./commands/delivery/route-decision.js";
import { registerDeliveryFinalize } from "./commands/delivery/finalize.js";
import { registerCloseoutRoot } from "./commands/delivery/closeout-root.js";
import { registerWorkspaceProvision } from "./commands/workspace/provision.js";
import { registerWorkspaceSync } from "./commands/workspace/sync.js";
import { registerWorkspaceMigrateRepoKeys } from "./commands/workspace/migrate-repo-keys.js";
import { registerWorkspaceCheckDaemon } from "./commands/workspace/check-daemon.js";
import { registerRuntimeResolveRootRepo } from "./commands/runtime/resolve-root-repo.js";
import { registerDoctor } from "./commands/doctor/doctor.js";

const program = new Command();

program
  .name("rondo")
  .description("rondo —— Multica 交付流水线统一 CLI(stdout 只出 JSON;退出码 0/2/3/64)")
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

const change = bareGroup(program.command("change").description("OpenSpec Change 身份与任务进度(冻结契约 §1/§2)"));
registerResolveIdentity(change);
registerUpdateProgress(change);

const analysis = bareGroup(program.command("analysis").description("Analysis Gate 与收口(02 §5.4/§12.1)"));
registerAnalysisStage(analysis);
registerAnalysisValidate(analysis);
registerAnalysisComplete(analysis);
registerAnalysisRead(analysis);
registerAnalysisApprove(analysis);

const dev = bareGroup(program.command("dev").description("Development 派发与完成检查(02 §7/§8)"));
registerDevMaterialize(dev);
registerDevPrepare(dev);
registerDevGit(dev);
registerDevCheckDispatch(dev);
registerDevCheckCompletion(dev);
registerDevCheckChange(dev);
registerDevPublish(dev);
registerDevContractHash(dev);

const bug = bareGroup(program.command("bug").description("无 OpenSpec 的 TFS Bug 修复交付入口"));
registerBugResume(bug);

const tfs = bareGroup(program.command("tfs").description("TFS 统一回写(writeback)/ 对账;旧物化与置态命令仅作在途恢复入口"));
registerTfsWriteback(tfs);
registerTfsMaterializeTasks(tfs);
registerTfsResolveTasks(tfs);
registerTfsReconcileWorkitem(tfs);

// pr 组:flow(materialize/worktree/reconcile-status)+ TFS API(create/get/list)合并,子命令名不交叠(方案 §3.1)
const pr = bareGroup(program.command("pr").description("PR 物化 / worktree / 状态对账 / TFS PR 事实(create|get|list)"));
registerPrMaterialize(pr);
registerPrPrepare(pr);
registerPrWorktree(pr);
registerPrReconcileStatus(pr);
registerTfsApiLeaf(pr, "create", ["pr", "create"], "创建 TFS PR(幂等核对:重复返回 created:false + existing)");
registerTfsApiLeaf(pr, "get", ["pr", "get"], "读取 TFS PR 事实(status 原样透传)");
registerTfsApiLeaf(pr, "list", ["pr", "list"], "列出 TFS PR(--status/--source-branch/--top)");

const delivery = bareGroup(program.command("delivery").description("入口交接、Human Decision 路由与交付收口(02 §4.1/§11.2/§12)"));
registerDeliveryRouteDecision(delivery);
registerDeliveryAdmission(delivery);
registerDeliveryFinalize(delivery);
registerCloseoutRoot(delivery);

// workspace 组(运维/供给,与 flow 组隔离)
const workspace = bareGroup(program.command("workspace").description("平台供给 / 资产同步 / 迁移 / daemon 检查"));
registerWorkspaceProvision(workspace);
registerWorkspaceSync(workspace);
registerWorkspaceMigrateRepoKeys(workspace);
registerWorkspaceCheckDaemon(workspace);

// runtime 组(运行时路径解析工具)
const runtime = bareGroup(program.command("runtime").description("运行时路径解析(multi-daemon-root-repo-resolution-plan §4/§7)"));
registerRuntimeResolveRootRepo(runtime);
registerRuntimeCheckCheckout(runtime);
registerRuntimePrepareRoot(runtime);
registerRuntimeGetContext(runtime);

// TFS API 叶子(原 tfs-cli):query 顶级;repo/branch/workitem 各自成组
registerTfsApiLeaf(program, "query", ["query"], "WIQL 查询(--wiql 必填)");

// doctor:环境体检(只读),顶层 leaf(方案 §10 裁定 2,先例为上方 query)
registerDoctor(program);

const repo = bareGroup(program.command("repo").description("TFS 仓库事实"));
registerTfsApiLeaf(repo, "get", ["repo", "get"], "按名/ID 查仓库(found:false → exit 2)");

const branch = bareGroup(program.command("branch").description("TFS 分支事实"));
registerTfsApiLeaf(branch, "get", ["branch", "get"], "查分支 HEAD(精确匹配,不回退)");

const workitem = bareGroup(program.command("workitem").description("TFS 工作项读写(置态/评论/创建/关联/附件)"));
registerTfsApiLeaf(workitem, "set-state", ["workitem", "set-state"], "置状态(幂等;跨态按类型链逐跳中转)");
registerTfsApiLeaf(workitem, "comment", ["workitem", "comment"], "评论(Markdown → HTML 落 History)");
registerTfsApiLeaf(workitem, "create", ["workitem", "create"], "在父项下创建子工作项");
registerTfsApiLeaf(workitem, "link-commits", ["workitem", "link-commits"], "commit 以 Artifact Link 挂工作项(幂等)");
registerTfsApiLeaf(workitem, "download-attachment", ["workitem", "download-attachment"], "下载附件(gzip 自动解压)");

program.exitOverride();

// async action 需要 parseAsync;包成 IIFE 避免顶层 await(esbuild CJS bundle 不支持 TLA)。
void (async () => {
  try {
    await program.parseAsync(process.argv);
    // 无参数 / 裸 group:视为用法错误(exit 64),帮助文本走 stderr 保持 stdout 纯净。
    if (!hasLeafExecuted()) {
      program.outputHelp();
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
