/**
 * doctor/checks/registry.ts — 检查项注册表与共享类型（rondo-doctor-env-check-plan §4）。
 *
 * 4 层 12 项：运行时 / CLI 工具 / 连通性 / 数据配置 / 一致性。
 * 每项独立函数、注册表驱动，--require 按 name 取子集。
 * phase=1 项并行执行；phase=2（一致性层）在 phase=1 完成后执行，经 ctx.prior / ctx.facts 读取前置结果。
 */

import { checkNodeRuntime, checkNpmRegistryConfig } from "./runtime.js";
import { checkOpenspecCli, checkRondoSelf, checkGit, checkPython } from "./cli-tools.js";
import { checkInternalNpmRegistry, checkTfsApi, checkMulticaApi } from "./connectivity.js";
import { checkOpenspecRoot, checkTfsConfig, checkDaemonEnv } from "./config-data.js";
import { checkVersionAlignment, checkPathPrecedence, checkWorkflowStatuses } from "./consistency.js";
import { checkNetworkBaseline } from "./network-probe.js";

/** 该项未过时的默认严重级。 */
export type CheckLevel = "FAIL" | "WARN" | "INFO";
export type CheckResult = "PASS" | "WARN" | "FAIL" | "SKIP" | "INFO";

export interface CheckOutcome {
  name: string;
  level: CheckLevel;
  result: CheckResult;
  /** 同一检查的不同失败形态（如 openspec_cli 的 not_found / not_spawnable / version_mismatch）。 */
  failure_kind?: string;
  /** 探测证据（命令 + rc + 关键输出）。 */
  detail: string;
  /** 可直接复制执行的命令或确定性指引；仅未过项携带。 */
  remediation?: string;
}

/** 跨项共享的探测事实（由产生方检查填写，一致性层消费）。 */
export interface DoctorFacts {
  openspecVersion?: string;
  openspecPath?: string;
}

export interface CheckContext {
  expectOpenspecVersion: string;
  facts: DoctorFacts;
  prior: Map<string, CheckOutcome>;
  /** workflow_statuses 检查的目标工作区（doctor --workspace-id；缺省跳过该项）。 */
  workspaceId?: string;
  /** workflow_statuses 探测的 multica profile（doctor --profile；缺省走 CLI 默认 profile）。 */
  profile?: string;
  /** network_baseline 采样参数（doctor --network-sample/--network-interval；缺省单次）。 */
  networkSample?: { count: number; intervalMs: number };
}

export interface CheckDef {
  name: string;
  level: CheckLevel;
  phase: 1 | 2;
  run: (ctx: CheckContext) => Promise<CheckOutcome>;
  /** opt-in 项：默认（无 --require）不执行，保证默认 doctor 输出不变；--require 按名可选中。 */
  optIn?: boolean;
}

function def(name: string, level: CheckLevel, phase: 1 | 2, run: CheckDef["run"], optIn = false): CheckDef {
  return { name, level, phase, run, optIn };
}

export const CHECKS: CheckDef[] = [
  // 4.1 运行时层
  def("node_runtime", "FAIL", 1, checkNodeRuntime),
  def("npm_registry_config", "FAIL", 1, checkNpmRegistryConfig),
  // 4.2 CLI 工具层
  def("openspec_cli", "FAIL", 1, checkOpenspecCli),
  def("rondo_self", "WARN", 1, checkRondoSelf),
  def("git", "FAIL", 1, checkGit),
  def("python", "WARN", 1, checkPython),
  // 4.3 服务连通层（默认 WARN，不堵离线场景）
  def("internal_npm_registry", "WARN", 1, checkInternalNpmRegistry),
  def("tfs_api", "WARN", 1, checkTfsApi),
  def("multica_api", "WARN", 1, checkMulticaApi),
  // 4.4 数据/配置层
  def("openspec_root", "WARN", 1, checkOpenspecRoot),
  def("tfs_config", "FAIL", 1, checkTfsConfig),
  def("daemon_env", "WARN", 1, checkDaemonEnv),
  // 4.5 一致性层（依赖 phase=1 结果）
  def("version_alignment", "WARN", 2, checkVersionAlignment),
  def("path_precedence", "WARN", 2, checkPathPrecedence),
  def("workflow_statuses", "WARN", 2, checkWorkflowStatuses),
  // 4.6 网络基线（rll5-replay-remediation-plan M3.0）：opt-in——直连/代理对照采样耗时较长，
  // 不进入默认体检面（默认输出字节级不变），按需 --require network_baseline 或诊断时启用
  def("network_baseline", "WARN", 1, checkNetworkBaseline, true),
];

/** 按 --require 取子集；未知名称抛错（由 doctor 入口归一化为用法错误 64）。
 *  无 --require 时排除 opt-in 项（默认体检面不变）；--require 可点名 opt-in 项。 */
export function selectChecks(require?: string[]): CheckDef[] {
  if (!require || require.length === 0) return CHECKS.filter((c) => !c.optIn);
  const known = new Set(CHECKS.map((c) => c.name));
  const unknown = require.filter((n) => !known.has(n));
  if (unknown.length > 0) {
    throw new Error(`未知检查项: ${unknown.join(", ")}（可选: ${[...known].join(", ")}）`);
  }
  const wanted = new Set(require);
  // 一致性检查必须先取得版本事实，不能因缺少依赖而静默跳过。
  if (wanted.has("version_alignment")) wanted.add("openspec_cli");
  return CHECKS.filter((c) => wanted.has(c.name));
}
