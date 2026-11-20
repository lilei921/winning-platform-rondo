/**
 * doctor/checks/runtime.ts — 运行时层：node_runtime / npm_registry_config（方案 §4.1）。
 *
 * nvm 不设独立检查项（§5.2 评审裁定：托管运行机标准为单一固定 node 版本）；
 * nvm home 识别仅用于 node_runtime 不合期望时生成 remediation。
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { EXPECTED_NODE_MIN, EXPECTED_NODE_RANGE_DESC, INTERNAL_NPM_REGISTRY, PROBE_TIMEOUT_MS } from "../expectations.js";
import { runProbe } from "../probe.js";
import type { CheckContext, CheckOutcome } from "./registry.js";

function ok(name: string, level: CheckOutcome["level"], detail: string): CheckOutcome {
  return { name, level, result: "PASS", detail };
}

/** 检测 nvm home 是否存在（仅用于生成 remediation，不告警、不盘点安装矩阵）。 */
function nvmHome(): string | null {
  if (process.env.NVM_HOME?.trim()) return process.env.NVM_HOME.trim();
  const candidates = process.platform === "win32"
    ? [process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "nvm") : ""]
    : [join(homedir(), ".nvm")];
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

export async function checkNodeRuntime(_ctx: CheckContext): Promise<CheckOutcome> {
  const name = "node_runtime";
  const m = /^v(\d+)\.(\d+)\.(\d+)/.exec(process.version);
  const ver = m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
  const meets = ver !== null
    && (ver.major > EXPECTED_NODE_MIN.major
      || (ver.major === EXPECTED_NODE_MIN.major && ver.minor >= EXPECTED_NODE_MIN.minor));
  // HEY-37 已出现 EBADENGINE：openspec 依赖要求 ^22.13.0，低于时记录备查（不判 FAIL，契约基线仍是 >=18.19）
  const belowOpenspecDep = ver !== null && (ver.major < 22 || (ver.major === 22 && ver.minor < 13));
  const note = belowOpenspecDep ? "；低于 openspec 依赖期望的 ^22.13.0，记录备查" : "";
  if (meets) {
    return ok(name, "FAIL", `${process.version} @ ${process.execPath}（期望 ${EXPECTED_NODE_RANGE_DESC}${note}）`);
  }
  const nvm = nvmHome();
  return {
    name,
    level: "FAIL",
    result: "FAIL",
    failure_kind: "version_out_of_range",
    detail: `${process.version} @ ${process.execPath} 不在期望区间 ${EXPECTED_NODE_RANGE_DESC}${note}`,
    remediation: nvm
      ? `nvm install 22.13.0 && nvm use 22.13.0（检测到 nvm home: ${nvm}；或任一 ${EXPECTED_NODE_RANGE_DESC} 版本）`
      : `安装并固定单一 node 版本（${EXPECTED_NODE_RANGE_DESC}，建议 22.13+ 以满足 openspec 依赖 ^22.13.0）；托管运行机不需要 nvm`,
  };
}

export async function checkNpmRegistryConfig(_ctx: CheckContext): Promise<CheckOutcome> {
  const name = "npm_registry_config";
  const r = await runProbe("npm", ["config", "get", "registry"], { timeoutMs: PROBE_TIMEOUT_MS, shell: process.platform === "win32" });
  if (!r.ok || r.status !== 0) {
    return {
      name,
      level: "FAIL",
      result: "FAIL",
      failure_kind: "npm_unavailable",
      detail: `npm config get registry 失败（${r.timedOut ? `超时 >${PROBE_TIMEOUT_MS}ms` : r.spawnError ?? `rc=${r.status}`}）`,
      remediation: "确认 node/npm 安装完整（npm 随 node 分发）",
    };
  }
  const registry = r.stdout.trim();
  const norm = (u: string) => u.replace(/\/+$/, "");
  if (norm(registry) === norm(INTERNAL_NPM_REGISTRY)) {
    return ok(name, "FAIL", `registry=${registry}`);
  }
  return {
    name,
    level: "FAIL",
    result: "FAIL",
    failure_kind: "registry_mismatch",
    detail: `registry=${registry}，期望 ${INTERNAL_NPM_REGISTRY}`,
    remediation: `npm config set registry ${INTERNAL_NPM_REGISTRY}`,
  };
}
