/**
 * doctor/checks/consistency.ts — 一致性层（方案 §4.5，跨项交叉验证）。
 *
 * phase=2：依赖 phase=1 结果（ctx.prior / ctx.facts），由 doctor 入口保证时序。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { TOOL_VERSION } from "../../../cli/version.js";
import { CUSTOM_PIPELINE_STATUSES } from "../../../clients/required-statuses.js";
import { resolveMulticaRoot } from "../../../clients/repo-root.js";
import { whereAll } from "../../../clients/which.js";
import { PROBE_TIMEOUT_MS } from "../expectations.js";
import { runProbe } from "../probe.js";
import type { CheckContext, CheckOutcome } from "./registry.js";

export async function checkVersionAlignment(ctx: CheckContext): Promise<CheckOutcome> {
  const name = "version_alignment";
  const openspec = ctx.prior.get("openspec_cli");
  if (openspec?.result !== "PASS" || !ctx.facts.openspecVersion) {
    return { name, level: "WARN", result: "SKIP", detail: "openspec_cli 未通过，无法比对版本对齐" };
  }
  const detected = ctx.facts.openspecVersion;
  if (detected !== ctx.expectOpenspecVersion) {
    return {
      name,
      level: "WARN",
      result: "WARN",
      detail: `openspec ${detected} 与契约期望 ${ctx.expectOpenspecVersion} 漂移（rondo ${TOOL_VERSION}；openspec_cli 项已给处方）`,
    };
  }
  return {
    name,
    level: "WARN",
    result: "PASS",
    detail: `openspec ${detected} == 契约期望；rondo ${TOOL_VERSION}`,
  };
}

export async function checkPathPrecedence(ctx: CheckContext): Promise<CheckOutcome> {
  const name = "path_precedence";
  const multi: string[] = [];
  for (const cmd of ["openspec", "node"]) {
    const hits = whereAll(cmd, PROBE_TIMEOUT_MS);
    // 同一目录下的多个 shim（如 openspec + openspec.cmd）是同一次安装，不构成抢占
    const dirs = [...new Set(hits.map((h) => dirname(h)))];
    if (dirs.length > 1) multi.push(`${cmd} 解析顺序: ${hits.join(" → ")}`);
  }
  if (multi.length === 0) {
    return { name, level: "WARN", result: "PASS", detail: "openspec/node 均为单一命中，无抢占风险" };
  }
  // 前置命中版本与期望不符时点名（旧 shim 抢占是经典隐性故障）
  const frontMismatch = ctx.facts.openspecVersion && ctx.facts.openspecVersion !== ctx.expectOpenspecVersion
    ? `；前置命中 openspec ${ctx.facts.openspecVersion} ≠ 期望 ${ctx.expectOpenspecVersion}`
    : "";
  return {
    name,
    level: "WARN",
    result: "WARN",
    detail: `${multi.join("；")}${frontMismatch}`,
    remediation: "移除或后置旧版本 shim，确保 PATH 前置命中为期望版本",
  };
}

// ---------- workflow_statuses（workspace-workflow-status-provisioning-plan M2，只读） ----------

export async function checkWorkflowStatuses(ctx: CheckContext): Promise<CheckOutcome> {
  const name = "workflow_statuses";
  if (!ctx.workspaceId) {
    return { name, level: "WARN", result: "INFO", detail: "未提供 --workspace-id，跳过（指定后校验目标工作区 default workflow 的自定义状态键是否齐全）" };
  }
  // 版本门：workflow 命令面需 multica ≥0.8.0（低版本给明确处方而非"unknown command"）。
  // 自检版本而非依赖 prior.multica_api——--require 单选本项时 prior 为空。
  const vp = await runProbe("multica", ["--version"], { timeoutMs: PROBE_TIMEOUT_MS, shell: process.platform === "win32" });
  const vm = /(\d+)\.(\d+)\.(\d+)/.exec(vp.stdout);
  if (!vp.ok || vp.status !== 0 || !vm) {
    return { name, level: "WARN", result: "WARN", failure_kind: "probe_failed", detail: `multica --version 失败（${vp.timedOut ? "超时" : vp.spawnError ?? `rc=${vp.status}`}）` };
  }
  if (!(Number(vm[1]) > 0 || Number(vm[2]) >= 8)) {
    return {
      name,
      level: "WARN",
      result: "WARN",
      failure_kind: "version_too_old",
      detail: `multica ${vm[1]}.${vm[2]}.${vm[3]} 不支持 workflow 命令（需 ≥0.8.0）`,
      remediation: "multica update 升级 CLI 后重试",
    };
  }
  // 比对基准：manifest workflow.statuses；缺段或非 monorepo 上下文回退到内置消费键常量
  let required: string[] = [...CUSTOM_PIPELINE_STATUSES];
  let basis = "内置消费键常量（clients/required-statuses.ts）";
  try {
    const { multicaRoot } = resolveMulticaRoot();
    const manifest = JSON.parse(
      readFileSync(join(multicaRoot, "workspace-config", "provisioning.json"), "utf8"),
    ) as { workflow?: { statuses?: Array<{ key?: string }> } };
    const statuses = manifest.workflow?.statuses;
    if (Array.isArray(statuses) && statuses.length > 0) {
      required = statuses.map((s) => s.key).filter((k): k is string => !!k);
      basis = "provisioning.json workflow.statuses";
    }
  } catch { /* 非 monorepo 或 manifest 不可读 → 常量兜底 */ }

  // 校验对象证据（L1）：--profile > MULTICA_SERVER_URL env > config.json（镜像 multica 解析链，
  // detail 标注来源便于人工核对；profile 场景用同名 profile 探测其 server_url）
  const SRV = ctx.profile ? ["--profile", ctx.profile] : [];
  let serverEvidence = process.env.MULTICA_SERVER_URL ?? "";
  if (!serverEvidence) {
    const cs = await runProbe("multica", [...SRV, "config", "show"], { timeoutMs: PROBE_TIMEOUT_MS, shell: process.platform === "win32" });
    serverEvidence = /^server_url:\s*(\S+)$/m.exec(cs.stdout)?.[1] ?? "<无法解析>";
  }
  const serverTag = `server: ${serverEvidence}${ctx.profile ? `（profile: ${ctx.profile}）` : ""}`;

  // workflow get 走 API 网络往返（实测 ~2s+），不能用 PROBE_TIMEOUT_MS（2s，为本地 --version 类探测设计）
  const WF_PROBE_TIMEOUT_MS = 15_000;
  const r = await runProbe("multica", [...SRV, "workflow", "get", "default", "--workspace-id", ctx.workspaceId, "--output", "json"],
    { timeoutMs: WF_PROBE_TIMEOUT_MS, shell: process.platform === "win32" });
  if (!r.ok || r.status !== 0) {
    return {
      name,
      level: "WARN",
      result: "WARN",
      failure_kind: "probe_failed",
      detail: `workflow get 失败（${r.timedOut ? `超时 >${WF_PROBE_TIMEOUT_MS}ms` : r.spawnError ?? `rc=${r.status}: ${r.stderr.trim().slice(0, 120)}`}）；${serverTag}——rc=4/404 多为服务端无 workflow API（需 ≥0.8.0）或工作区不在该环境`,
      remediation: "确认服务端版本 ≥0.8.0（自建实例如 97 需升级 server）；工作区在其他环境时用 --profile 指定（rondo doctor --workspace-id <id> --profile <name>）",
    };
  }
  let keys: string[];
  try {
    const wf = JSON.parse(r.stdout) as { steps?: Array<{ status_key?: string }> };
    keys = (wf.steps ?? []).map((s) => s.status_key).filter((k): k is string => !!k);
  } catch {
    return { name, level: "WARN", result: "WARN", failure_kind: "bad_output", detail: `workflow get 输出无法解析: ${r.stdout.slice(0, 120)}（${serverTag}）` };
  }
  const missing = required.filter((k) => !keys.includes(k));
  if (missing.length > 0) {
    return {
      name,
      level: "WARN",
      result: "WARN",
      failure_kind: "missing_statuses",
      detail: `default workflow 缺少自定义状态键: ${missing.join(", ")}（基准: ${basis}；现有 [${keys.join(", ")}]；${serverTag}）`,
      remediation: "重跑 rondo workspace provision --workspace <name> 供给缺失状态",
    };
  }
  return { name, level: "WARN", result: "PASS", detail: `${required.length} 个自定义状态键齐全（基准: ${basis}；${serverTag}）` };
}
