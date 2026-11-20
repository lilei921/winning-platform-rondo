/**
 * analysis stage —— Analysis draft Facts 的确定性落账（Gate 前置步骤）。
 *
 * 背景：Analysis Gate（validate）从 Issue metadata 读 analysis.route、analysis.change_ref、
 * analysis.verify_agent.*、analysis.ai_review.*，而 complete 又以 Gate PASS 为前置才写
 * metadata——draft 键的写入责任原缺位（契约鸡生蛋），曾靠执行 Agent 手工
 * `issue metadata set` 即兴补步掩盖（FOMA-35/37），WNDF-8（TFS 260203）首次暴露。
 * 本命令把该步正规化。
 *
 * 用法: rondo analysis stage --issue <issue-id> --facts <facts.json> --workspace-id <id> [--multica <cli>]
 *
 * facts.json 为 draft 形态：route/change_ref/verify_agent/ai_review（sdd-fast 必填，
 * 其他 route 可缺省）；**禁止含 gate 段**——Gate 未跑即写 gate.result 视为契约违规（exit 2）。
 *
 * 动作：
 *   1. 字段校验（与 complete 共用 facts.ts 的 draft 校验，防止两处规则漂移）；
 *   2. 确认 Issue 在当前工作区可读取（防静默读错工作区，与 validate 同一守卫）；
 *   3. 逐键写入 draft metadata（不写 gate.*、不写 status）；
 *   4. 回读确认全部一致。
 *
 * 退出码：0 = 写入且回读一致；2 = 前置/回读失败；3 = UNKNOWN（环境/身份不可确认）。
 * 幂等：同值重写无变化；与后续 complete 的重写天然兼容（complete 重写同值 + 补 gate.*）。
 * 输出：stdout 仅 JSON，日志走 stderr。
 */

import { analysisRuntime } from "./runtime.js";
import { multicaPrefix } from "../../clients/multica-environment.js";
import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { logLine as log, markLeafExecuted } from "../../cli/output.js";
import { runJson } from "../../clients/spawn.js";
import { assertAnalysisWritable } from "./guard.js";
import {
  PreconditionError,
  draftMetadataEntries,
  loadFactsFile,
  validateDraftFields,
  type DraftFacts,
} from "./facts.js";

function loadDraftFacts(path: string): DraftFacts {
  const raw = loadFactsFile(path) as Partial<DraftFacts> & { gate?: unknown };
  if (raw.gate !== undefined) {
    throw new PreconditionError("draft facts 禁止含 gate 段（Gate 未跑即写 gate.result 属契约违规）；gate.* 由 Gate PASS 后 complete 落账");
  }
  const missing = validateDraftFields(raw);
  if (missing.length > 0) throw new PreconditionError(`facts 字段缺失或非法: ${missing.join("; ")}`);
  return raw as DraftFacts;
}

function parseArgs(argv: string[]): { issue: string; facts: string; cli: string; workspaceId: string | null } {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const issue = get("--issue");
  const facts = get("--facts");
  if (!issue || !facts || !get("--workspace-id")) {
    process.stderr.write("用法: rondo analysis stage --issue <issue-id> --facts <facts.json> --workspace-id <id> [--multica <cli>]\n");
    process.exit(64);
  }
  return { issue, facts, cli: get("--multica") ?? "multica", workspaceId: get("--workspace-id") };
}

function main(rawArgs: string[]): number {
  const args = parseArgs(rawArgs);
  const ws = ["--workspace-id", args.workspaceId!];
  try {
    const MC = multicaPrefix(analysisRuntime(rawArgs, args.cli, args.workspaceId));
    const facts = loadDraftFacts(args.facts);
    const entries = draftMetadataEntries(facts);

    // 0. 确认 Issue 在当前工作区可读取（transient：空 stdout 瞬态重试一次，P0）
    const before = runJson([...MC, "issue", "get", args.issue, ...ws, "--output", "json"], "读取 Issue", undefined, { transient: true }) as Record<string, unknown>;
    if (!before.id) throw new UnknownError(`Issue ${args.issue} 不可读取（不存在或不属于当前工作区）`);
    const priorMeta = runJson([...MC, "issue", "metadata", "list", args.issue, ...ws, "--output", "json"], "检查 Analysis 状态", undefined, { transient: true }) as Record<string, unknown>;
    assertAnalysisWritable(before, priorMeta, "stage");

    // 1. 写 draft metadata（逐键；单键失败即停止，交人工核对部分状态）
    for (const [k, v] of Object.entries(entries)) {
      runJson([...MC, "issue", "metadata", "set", args.issue,
               "--key", k, "--value", v, "--type", "string", ...ws, "--output", "json"],
              `写入 metadata(key=${k})`);
    }

    // 2. 回读确认
    const meta = runJson([...MC, "issue", "metadata", "list", args.issue, ...ws, "--output", "json"], "回读 metadata", undefined, { transient: true }) as Record<string, unknown>;
    const mismatches: string[] = [];
    for (const [k, v] of Object.entries(entries)) {
      if (String(meta[k]) !== v) mismatches.push(`metadata ${k} 回读不一致`);
    }
    if (mismatches.length > 0) {
      process.stdout.write(JSON.stringify({ result: "FAIL", reason: "回读校验不一致", mismatches }, null, 2) + "\n");
      return 2;
    }

    process.stdout.write(JSON.stringify({
      result: "PASS",
      issue: args.issue,
      metadata_keys: Object.keys(entries),
    }, null, 2) + "\n");
    return 0;
  } catch (exc) {
    if (exc instanceof PreconditionError) {
      process.stdout.write(JSON.stringify({ result: "FAIL", reason: exc.message }, null, 2) + "\n");
      return 2;
    }
    if (exc instanceof UnknownError) {
      log(`UNKNOWN: ${exc.message}`);
      process.stdout.write(JSON.stringify({ result: "UNKNOWN", reason: exc.message }, null, 2) + "\n");
      return 3;
    }
    throw exc;
  }
}

/** commander 注册：group=analysis；参数解析沿用同组命令实现以保证契约逐字节等价。 */
export function registerAnalysisStage(group: Command): void {
  group
    .command("stage")
    .description("Analysis draft Facts 落账（Gate 前置步骤）")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action((...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      process.exit(main(cmd.args));
    });
}
