/**
 * doctor —— Multica 依赖环境体检（只读；rondo-doctor-env-check-plan）。
 *
 * 第一调用方是运维/交付人员手工执行：装机验收、故障排查、daemon 起不来时的第一站；
 * agent/skill 程序化调用用 --output json（兼容 --format json）。
 *
 * 用法：rondo doctor [--require <check,...>] [--output json | --format text|json] [--expect-openspec <version>] [--workspace-id <id>]
 * 退出码：0 PASS / 2 FAIL（--require 命中的项 WARN 按 FAIL 计）/ 3 检测自身异常 / 64 用法错误。
 * 默认 text：stdout 出人读报告；--format json：stdout 只出 JSON。日志走 stderr。
 */

import { Command } from "commander";
import { ExitSignal, emitJson, logLine, markLeafExecuted } from "../../cli/output.js";
import { CHECKS, selectChecks, type CheckContext, type CheckDef, type CheckOutcome, type DoctorFacts } from "./checks/registry.js";
import { DEFAULT_EXPECTED_OPENSPEC_VERSION } from "./expectations.js";
import { renderTextReport } from "./text-format.js";

const USAGE = "用法: rondo doctor [--require <check,...>] [--output json | --format text|json] [--expect-openspec <version>] [--workspace-id <id> [--profile <name>]] [--network-sample <N> [--network-interval <ms>]]";

interface DoctorOptions {
  require?: string[];
  format: "text" | "json";
  expectOpenspec: string;
  workspaceId?: string;
  /** multica 配置 profile（仅影响 workflow_statuses 探测；须配合 --workspace-id）。 */
  profile?: string;
  /** network_baseline 采样：次数与间隔（M3.0；缺省单次探测）。 */
  networkSample?: { count: number; intervalMs: number };
}

/** 正整数解析（--network-sample/--network-interval 共用）；非法 → 用法错误。 */
function parsePositiveInt(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    logLine(`${flag} 须为正整数: ${raw}`);
    logLine(USAGE);
    throw new ExitSignal(64);
  }
  return n;
}

function parseArgs(argv: string[], jsonOutput: boolean): DoctorOptions {
  const opts: DoctorOptions = { format: jsonOutput ? "json" : "text", expectOpenspec: DEFAULT_EXPECTED_OPENSPEC_VERSION };
  let networkSampleCount: number | undefined;
  let networkIntervalMs: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--require") {
      const v = argv[++i] ?? "";
      opts.require = v.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--workspace-id") {
      opts.workspaceId = (argv[++i] ?? "").trim();
      if (!opts.workspaceId) {
        logLine("--workspace-id 缺值");
        logLine(USAGE);
        throw new ExitSignal(64);
      }
    } else if (a === "--profile") {
      opts.profile = (argv[++i] ?? "").trim();
      if (!opts.profile) {
        logLine("--profile 缺值");
        logLine(USAGE);
        throw new ExitSignal(64);
      }
    } else if (a === "--format") {
      const v = (argv[++i] ?? "").trim();
      if (v !== "text" && v !== "json") {
        logLine(`--format 仅支持 text|json: ${v}`);
        logLine(USAGE);
        throw new ExitSignal(64);
      }
      if (jsonOutput && v === "text") {
        logLine("--output json 与 --format text 冲突");
        throw new ExitSignal(64);
      }
      opts.format = v;
    } else if (a === "--expect-openspec") {
      opts.expectOpenspec = (argv[++i] ?? "").trim();
      if (!opts.expectOpenspec) {
        logLine("--expect-openspec 缺值");
        logLine(USAGE);
        throw new ExitSignal(64);
      }
    } else if (a === "--network-sample") {
      networkSampleCount = parsePositiveInt("--network-sample", (argv[++i] ?? "").trim());
    } else if (a === "--network-interval") {
      networkIntervalMs = parsePositiveInt("--network-interval", (argv[++i] ?? "").trim());
    } else {
      logLine(`无法识别的参数: ${a}`);
      logLine(USAGE);
      throw new ExitSignal(64);
    }
  }
  // --profile 仅作为 workflow_statuses 探测的环境选择，无检查对象时不生效——按用法错误处理，避免"以为生效"的假象
  if (opts.profile && !opts.workspaceId) {
    logLine("--profile 需配合 --workspace-id（它只影响 workflow_statuses 一项检查）");
    logLine(USAGE);
    throw new ExitSignal(64);
  }
  // 采样参数只服务 network_baseline；给了参数却没选该项 → 用法错误（同上，防"以为生效"）
  if ((networkSampleCount !== undefined || networkIntervalMs !== undefined)) {
    if (!opts.require?.includes("network_baseline")) {
      logLine("--network-sample/--network-interval 需配合 --require network_baseline");
      logLine(USAGE);
      throw new ExitSignal(64);
    }
    opts.networkSample = { count: networkSampleCount ?? 1, intervalMs: networkIntervalMs ?? 0 };
  }
  return opts;
}

/** 单项异常不抛出：降级为该项级别对应的失败结果（方案 §5.4——doctor 自身不得成为新的故障源）。 */
async function guard(def: CheckDef, ctx: CheckContext): Promise<CheckOutcome> {
  try {
    return await def.run(ctx);
  } catch (exc) {
    const result = def.level === "FAIL" ? "FAIL" : def.level === "WARN" ? "WARN" : "INFO";
    return { name: def.name, level: def.level, result, detail: `check error: ${exc instanceof Error ? exc.message : String(exc)}` };
  }
}

export function aggregate(opts: Pick<DoctorOptions, "require">, outcomes: CheckOutcome[]): { overall: "PASS" | "WARN" | "FAIL"; exitCode: number } {
  const requireMode = (opts.require?.length ?? 0) > 0;
  const hasFail = outcomes.some((o) => o.result === "FAIL");
  const hasWarn = outcomes.some((o) => o.result === "WARN");
  if (requireMode) {
    // 必检项必须真正完成；跳过或仅提示信息也不能算验收通过。
    return outcomes.some(o => o.result !== "PASS") ? { overall: "FAIL", exitCode: 2 } : { overall: "PASS", exitCode: 0 };
  }
  if (hasFail) return { overall: "FAIL", exitCode: 2 };
  if (hasWarn) return { overall: "WARN", exitCode: 0 };
  return { overall: "PASS", exitCode: 0 };
}

async function runDoctor(rawArgs: string[], jsonOutput: boolean): Promise<never> {
  const opts = parseArgs(rawArgs, jsonOutput);
  let checks: CheckDef[];
  try {
    checks = selectChecks(opts.require);
  } catch (exc) {
    logLine(exc instanceof Error ? exc.message : String(exc));
    logLine(USAGE);
    throw new ExitSignal(64);
  }

  try {
    const started = Date.now();
    const facts: DoctorFacts = {};
    const ctx: CheckContext = { expectOpenspecVersion: opts.expectOpenspec, facts, prior: new Map(), workspaceId: opts.workspaceId, profile: opts.profile, networkSample: opts.networkSample };
    // phase=1 并行；phase=2（一致性层）依赖 phase=1 结果
    const phase1 = checks.filter((c) => c.phase === 1);
    const results1 = await Promise.all(phase1.map((c) => guard(c, ctx)));
    for (const r of results1) ctx.prior.set(r.name, r);
    const results2 = await Promise.all(checks.filter((c) => c.phase === 2).map((c) => guard(c, ctx)));
    const byName = new Map([...results1, ...results2].map((r) => [r.name, r]));
    const ordered = checks.map((c) => byName.get(c.name)!);
    const elapsedMs = Date.now() - started;
    const { overall, exitCode } = aggregate(opts, ordered);
    logLine(`[doctor] ${ordered.length} 项检查完成，耗时 ${(elapsedMs / 1000).toFixed(1)}s，结果 ${overall}`);

    if (opts.format === "json") {
      emitJson({
        result: overall,
        node: { version: process.version, path: process.execPath },
        platform: process.platform,
        duration_ms: elapsedMs,
        checks: ordered,
      }, exitCode);
    }
    process.stdout.write(renderTextReport({ overall, exitCode, checks: ordered, nodeVersion: process.version, nodePath: process.execPath, elapsedMs }) + "\n");
    throw new ExitSignal(exitCode);
  } catch (exc) {
    if (exc instanceof ExitSignal) throw exc;
    // 检测自身异常 → exit 3
    const reason = exc instanceof Error ? exc.message : String(exc);
    logLine(`[doctor] 检测自身异常: ${reason}`);
    if (opts.format === "json") {
      emitJson({ unknown: true, reason }, 3);
    }
    process.stdout.write(`rondo doctor — ERROR (exit 3)\n${reason}\n`);
    throw new ExitSignal(3);
  }
}

/** 顶层 leaf（先例：rondo query 挂 program 直属，不进 bareGroup——方案 §10 裁定 2）。 */
export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("只读检查运行环境、CLI 工具、配置及服务连通性")
    .usage("[--require <checks>] [--output json | --format text|json] [--expect-openspec <version>] [--workspace-id <id> [--profile <name>]] [--network-sample <N> [--network-interval <ms>]]")
    .addHelpText("after", "\n默认输出文本；--require 指定必检项（逗号分隔）；网络采样需指定 --require network_baseline。")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      await runDoctor(cmd.args, program.opts().output === "json");
    });
}
