/**
 * doctor/checks/connectivity.ts — 服务连通层（方案 §4.3，默认 WARN，不堵离线场景）。
 *
 * 与配置层的分工：tfs_config 查"配没配、配在哪"（本地、离线可检），本层查"通了没、有效没"（在线）；
 * tfs_config FAIL 时 tfs_api 降级 SKIP。
 * 红线：PAT 只进请求头，永不进 detail/remediation 输出。
 */

import { whereAll } from "../../../clients/which.js";
import { ConfigError, loadConfig } from "../../../tfs/config.js";
import { INTERNAL_NPM_REGISTRY, PROBE_TIMEOUT_MS } from "../expectations.js";
import { fetchProbe, runProbe } from "../probe.js";
import type { CheckContext, CheckOutcome } from "./registry.js";

export async function checkInternalNpmRegistry(_ctx: CheckContext): Promise<CheckOutcome> {
  const name = "internal_npm_registry";
  const r = await fetchProbe(INTERNAL_NPM_REGISTRY, PROBE_TIMEOUT_MS);
  if (r.ok && r.status !== undefined && r.status < 400) {
    return { name, level: "WARN", result: "PASS", detail: `${INTERNAL_NPM_REGISTRY} HTTP ${r.status}` };
  }
  return {
    name,
    level: "WARN",
    result: "WARN",
    detail: `${INTERNAL_NPM_REGISTRY} 不可达（${r.ok ? `HTTP ${r.status}` : r.error}）`,
    remediation: "检查内网/VPN 连接——registry 不通时一切 npm i -g 处方必然失败（先修本项再执行安装类修复）",
  };
}

export async function checkTfsApi(_ctx: CheckContext): Promise<CheckOutcome> {
  const name = "tfs_api";
  let serverUrl: string;
  let pat: string;
  try {
    ({ serverUrl, pat } = loadConfig());
  } catch (exc) {
    if (exc instanceof ConfigError) {
      return { name, level: "WARN", result: "SKIP", detail: `TFS 配置缺失（${exc.message}），跳过连通性探测——见 tfs_config 项` };
    }
    throw exc;
  }
  const auth = Buffer.from(`:${pat}`).toString("base64");
  const r = await fetchProbe(`${serverUrl}/_apis/projects?$top=1&api-version=2.2`, PROBE_TIMEOUT_MS, { Authorization: `Basic ${auth}` });
  if (r.ok && r.status === 200) {
    return { name, level: "WARN", result: "PASS", detail: `${serverUrl} 连通，PAT 有效` };
  }
  if (r.ok && (r.status === 401 || r.status === 403)) {
    return {
      name,
      level: "WARN",
      result: "WARN",
      failure_kind: "pat_invalid",
      detail: `${serverUrl} HTTP ${r.status}——PAT 无效或过期`,
      remediation: "更新 PAT 后以 setx TFS_PAT 持久化到用户环境变量，并重开终端/重启 daemon 生效",
    };
  }
  return {
    name,
    level: "WARN",
    result: "WARN",
    detail: `${serverUrl} 不可达（${r.ok ? `HTTP ${r.status}` : r.error}）`,
    remediation: "检查内网/VPN 连接与 TFS 服务状态；离线场景本项可忽略（WARN 不影响退出码）",
  };
}

export async function checkMulticaApi(_ctx: CheckContext): Promise<CheckOutcome> {
  const name = "multica_api";
  const hits = whereAll("multica", PROBE_TIMEOUT_MS);
  if (hits.length === 0) {
    return {
      name,
      level: "WARN",
      result: "WARN",
      failure_kind: "not_found",
      detail: "multica CLI 不在 PATH",
      remediation: "部署 multica CLI 并加入 PATH（见 daemon 部署手册）",
    };
  }
  const r = await runProbe("multica", ["--version"], { timeoutMs: PROBE_TIMEOUT_MS, shell: process.platform === "win32" });
  if (!r.ok || r.status !== 0) {
    return {
      name,
      level: "WARN",
      result: "WARN",
      failure_kind: "not_spawnable",
      detail: `multica 命中 ${hits[0]} 但 --version 失败（${r.timedOut ? "超时" : r.spawnError ?? `rc=${r.status}`}）`,
      remediation: "修复 multica CLI 安装（重装或放行受限环境的 shim 执行）",
    };
  }
  const version = r.stdout.trim().split(/\r?\n/)[0];
  return {
    name,
    level: "WARN",
    result: "PASS",
    detail: `multica ${version || "可用"} @ ${hits[0]}（API 级心跳需 workspace 上下文，本项验证 CLI 可用性）`,
  };
}
