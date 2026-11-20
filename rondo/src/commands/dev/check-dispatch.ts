/**
 * dev check-dispatch —— 派发事实开工预检（只读，零写入）。
 *
 * 背景：派发通知（@mention）与派发事实物化（dev.dispatch）可能脱节——
 * Lead 裸发 mention 而不跑 dev materialize 时，Engineer 干完活才发现无合法派发范围
 * （WNDF-9 / TFS 260203 实测，2026-10-27）。本命令把该隐性依赖变成开工前的确定性检查：
 * no_covering 时停止实现。
 *
 * 2026-10-30 TFS 剥离（tfs-writeback-decoupling-plan）：开发期 commit `Refs:` 统一挂
 * `#<tfs.id>`（需求/Bug 同一规则），tfs_task_ids 由 PR 通过后的 writeback 写入——
 * 原 no_mappings / unmapped_refs 映射核验分支整体删除（映射核验的意义是保证 commit
 * `Refs:` 合法性，新规则下 `Refs: #<tfs.id>` 恒合法；legacy commit 由 check-completion
 * 直接读 dev.dispatch.tfs_task_ids 核验，不经过本命令）。
 *
 * 用法: rondo dev check-dispatch --config <repo-registry.json> --issue <KEY> --task-refs <1.1,1.2,...> [--change-ref <ref> --engineer-id <uuid>]
 *
 * 判定（共享 dispatch-facts.ts 的读取与类型分支）：
 *   - dev.dispatch 无覆盖 task_refs 的 active 条目 → FAIL（Lead 补跑 dev materialize）；
 *   - Issue 不可读 / dev.dispatch 不可解析 / tfs.type 缺失或其他 → UNKNOWN（交 Lead 核对）。
 *
 * 退出码：0 = PASS / 2 = FAIL / 3 = UNKNOWN。
 * 与 check-completion 的口径差异为有意设计：晚期完成检查对同类缺失报 UNKNOWN（不当放行），
 * 开工预检对确定缺失报 FAIL（前置不满足、修复路径明确）。
 * 输出：stdout 仅 JSON，日志走 stderr。
 */

import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { logLine as log, markLeafExecuted } from "../../cli/output.js";
import { TOOL_VERSION } from "../../cli/version.js";
import { loadConfig, type BaseRegistryConfig } from "../../clients/config.js";
import { loadDispatchFacts, type DispatchFactsFailureCode } from "./dispatch-facts.js";

const UNKNOWN_CODES: ReadonlySet<DispatchFactsFailureCode> = new Set(["issue_read", "dispatch_parse", "tfs_type"]);

const REMEDIATION: Record<DispatchFactsFailureCode, string> = {
  issue_read: "",
  dispatch_parse: "",
  tfs_type: "",
  no_covering: "Lead 补跑 rondo dev materialize 完成派发物化后重跑本预检",
};

function parseArgs(argv: string[]): { config: string; issue: string; taskRefs: string[]; changeRef: string | null; engineerId: string | null } {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const config = get("--config");
  const issue = get("--issue");
  const taskRefsRaw = get("--task-refs");
  const changeRef = get("--change-ref");
  const engineerId = get("--engineer-id");
  const taskRefs = taskRefsRaw?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  if (!config || !issue || taskRefs.length === 0) {
    process.stderr.write(
      "用法: rondo dev check-dispatch --config <repo-registry.json> --issue <KEY> --task-refs <1.1,1.2,...>\n" +
      "  可加 --change-ref <ref> --engineer-id <uuid> 校验当前派工身份；FAIL 交 Lead 核对\n",
    );
    process.exit(64);
  }
  return { config, issue, taskRefs, changeRef, engineerId };
}

function main(rawArgs: string[]): number {
  const args = parseArgs(rawArgs);
  try {
    // 预检只读 Issue，不需要 registry / tfs_cli 段
    const cfg = loadConfig<BaseRegistryConfig>(args.config, { requireRegistry: false, requireTfs: false });
    const loaded = loadDispatchFacts(cfg, args.issue, args.taskRefs);

    if (!loaded.ok) {
      const isUnknown = UNKNOWN_CODES.has(loaded.code);
      const remediation = REMEDIATION[loaded.code];
      const reasons = remediation ? [loaded.reason, remediation] : [loaded.reason];
      const result = isUnknown ? "UNKNOWN" : "FAIL";
      if (isUnknown) log(`UNKNOWN: ${loaded.reason}`);
      process.stdout.write(JSON.stringify({
        result, tool_version: TOOL_VERSION, issue: args.issue, code: loaded.code, reasons,
      }, null, 2) + "\n");
      return isUnknown ? 3 : 2;
    }

    const { facts } = loaded;
    const overlapping = facts.dispatches.filter((d) =>
      d.active === true && (d.task_refs ?? []).some((ref) => args.taskRefs.includes(ref)));
    const conflicting = overlapping.some((d) =>
      (args.changeRef !== null && d.change_ref !== args.changeRef) ||
      (args.engineerId !== null && d.engineer_id !== args.engineerId));
    const matching = facts.covering.filter((d) =>
      (args.changeRef === null || d.change_ref === args.changeRef) &&
      (args.engineerId === null || d.engineer_id === args.engineerId));
    if (conflicting || matching.length === 0) {
      const reason = "当前 dev.dispatch 与 change_ref / engineer_id 不一致，或存在重叠有效派工；交 Lead 核对唯一 Owner";
      process.stdout.write(JSON.stringify({
        result: "FAIL", tool_version: TOOL_VERSION, issue: args.issue,
        code: "identity_mismatch", reasons: [reason],
      }, null, 2) + "\n");
      return 2;
    }
    process.stdout.write(JSON.stringify({
      result: "PASS",
      tool_version: TOOL_VERSION,
      issue: args.issue,
      tfs_type: facts.tfsType,
      dispatches: matching.map((d) => ({
        dispatch_key: d.dispatch_key ?? null,
        engineer_id: d.engineer_id ?? null,
        change_ref: d.change_ref ?? null,
        task_refs: d.task_refs ?? [],
        active: d.active === true,
      })),
      tfs_task_ids: facts.bugMode ? null : Object.fromEntries([...facts.idToRef.entries()].map(([id, ref]) => [ref, id])),
    }, null, 2) + "\n");
    return 0;
  } catch (exc) {
    if (exc instanceof UnknownError) {
      log(`UNKNOWN: ${exc.message}`);
      process.stdout.write(JSON.stringify({ result: "UNKNOWN", tool_version: TOOL_VERSION, issue: args.issue, reasons: [exc.message] }, null, 2) + "\n");
      return 3;
    }
    throw exc;
  }
}

/** commander 注册：group=dev；参数解析沿用同组命令实现以保证契约逐字节等价。 */
export function registerDevCheckDispatch(group: Command): void {
  group
    .command("check-dispatch")
    .description("派发事实开工预检（dev.dispatch / tfs_task_ids 只读核验）")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action((...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      process.exitCode = main(cmd.args);
    });
}
