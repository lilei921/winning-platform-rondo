/**
 * doctor/checks/cli-tools.ts — CLI 工具层（方案 §4.2）。
 *
 * openspec_cli 三态（failure_kind）：
 *   not_found        where.exe 未命中 → 装；
 *   not_spawnable    where 命中但 spawn 失败（受限环境拦截 .cmd shim，tfs-cli SEA 化前科）→ 换形态/放行；
 *   version_mismatch 可执行但版本 ≠ 期望 → 升降版本。
 * 只查 where.exe 会漏掉第二态。
 */

import { isSea } from "node:sea";
import { dirname } from "node:path";
import { TOOL_VERSION } from "../../../cli/version.js";
import { commandExists, whereAll } from "../../../clients/which.js";
import { DEFAULT_EXPECTED_OPENSPEC_VERSION, MIN_RONDO_VERSION, OPENSPEC_PACKAGE, PROBE_TIMEOUT_MS } from "../expectations.js";
import { runProbe } from "../probe.js";
import type { CheckContext, CheckOutcome } from "./registry.js";

const SEMVER_RE = /(\d+\.\d+\.\d+)/;

/** 简化 semver 比较（仅 x.y.z 数值段）：a<b 返回负，a==b 返回 0，a>b 返回正；解析失败视为相等。 */
function compareSemver(a: string, b: string): number {
  const pa = SEMVER_RE.exec(a)?.[1].split(".").map(Number);
  const pb = SEMVER_RE.exec(b)?.[1].split(".").map(Number);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export async function checkOpenspecCli(ctx: CheckContext): Promise<CheckOutcome> {
  const name = "openspec_cli";
  const expected = ctx.expectOpenspecVersion || DEFAULT_EXPECTED_OPENSPEC_VERSION;
  const hits = whereAll("openspec", PROBE_TIMEOUT_MS);
  if (hits.length === 0) {
    return {
      name,
      level: "FAIL",
      result: "FAIL",
      failure_kind: "not_found",
      detail: `${process.platform === "win32" ? "where.exe" : "command -v"} openspec 未命中；PATH 中不存在`,
      remediation: `npm i -g ${OPENSPEC_PACKAGE}@${expected}`,
    };
  }
  // Windows 上 npm 全局包是 .cmd shim，必须经 cmd.exe（shell:true）spawn；受限环境在此暴露 not_spawnable
  const r = await runProbe("openspec", ["--version"], { timeoutMs: PROBE_TIMEOUT_MS, shell: process.platform === "win32" });
  if (!r.ok) {
    return {
      name,
      level: "FAIL",
      result: "FAIL",
      failure_kind: "not_spawnable",
      detail: `where 命中 ${hits[0]} 但不可执行（${r.timedOut ? `超时 >${PROBE_TIMEOUT_MS}ms` : r.spawnError ?? "spawn 失败"}）`,
      remediation: "where 命中但不可执行——受限环境拦截 .cmd shim 创建 cmd.exe：改用 exe 形态分发或放行 cmd.exe（参照 tfs-cli SEA 化前科）",
    };
  }
  const m = SEMVER_RE.exec(r.stdout.trim() || r.stderr.trim());
  const version = m?.[1];
  if (version) ctx.facts.openspecVersion = version;
  ctx.facts.openspecPath = hits[0];
  if (!version) {
    return {
      name,
      level: "FAIL",
      result: "FAIL",
      failure_kind: "version_mismatch",
      detail: `openspec --version 输出无法解析版本: ${(r.stdout.trim() || r.stderr.trim()).slice(0, 120)}`,
      remediation: `npm i -g ${OPENSPEC_PACKAGE}@${expected}`,
    };
  }
  if (version !== expected) {
    return {
      name,
      level: "FAIL",
      result: "FAIL",
      failure_kind: "version_mismatch",
      detail: `${version} @ ${hits[0]}，期望 ${expected}`,
      remediation: `npm i -g ${OPENSPEC_PACKAGE}@${expected}`,
    };
  }
  return { name, level: "FAIL", result: "PASS", detail: `${version} @ ${hits[0]}` };
}

export async function checkRondoSelf(_ctx: CheckContext): Promise<CheckOutcome> {
  const name = "rondo_self";
  // 版本下限守卫（R3）：自检版本低于平台下限 → WARN；--require rondo_self 时 WARN 按 FAIL 计（exit 2）
  const belowMin = compareSemver(TOOL_VERSION, MIN_RONDO_VERSION) < 0;
  if (belowMin) {
    return {
      name,
      level: "WARN",
      result: "WARN",
      failure_kind: "version_mismatch",
      detail: `@winning/rondo@${TOOL_VERSION} 低于平台最低要求 ${MIN_RONDO_VERSION}（resolve-identity 首跑 NOT_FOUND 语义等契约不成立）`,
      remediation: `npm i -g @winning/rondo@${MIN_RONDO_VERSION}（或更新）`,
    };
  }
  if (isSea()) {
    return { name, level: "WARN", result: "PASS", detail: `@winning/rondo@${TOOL_VERSION}（SEA exe 形态: ${process.execPath}）` };
  }
  const entry = process.argv[1];
  if (!entry) {
    return { name, level: "WARN", result: "WARN", detail: `@winning/rondo@${TOOL_VERSION}，无法定位安装路径（argv[1] 缺失）` };
  }
  // npm 全局包装在 node 同级目录下；nvm 形态下同目录即同激活版本
  const nodeDir = dirname(process.execPath);
  if (entry.startsWith(nodeDir)) {
    return { name, level: "WARN", result: "PASS", detail: `@winning/rondo@${TOOL_VERSION}，安装于当前激活版本目录（${entry}）` };
  }
  return {
    name,
    level: "WARN",
    result: "WARN",
    detail: `@winning/rondo@${TOOL_VERSION} 安装于 ${entry}，不在当前 node 目录 ${nodeDir} 下（多版本共存时可能对 daemon 不可见）`,
    remediation: "在当前固定 node 版本下重新全局安装 rondo（托管运行机标准为单一固定 node 版本）",
  };
}

async function simpleToolCheck(name: "git" | "python", level: CheckOutcome["level"], why: string): Promise<CheckOutcome> {
  const candidates = name === "python" ? ["python", "python3"] : [name];
  const found = candidates.find((c) => commandExists(c));
  if (!found) {
    return {
      name,
      level,
      result: level === "FAIL" ? "FAIL" : "WARN",
      failure_kind: "not_found",
      detail: `${candidates.join("/")} 均不在 PATH（${why}）`,
      remediation: name === "git" ? "安装 Git 并加入 PATH" : "安装 Python 3 并加入 PATH",
    };
  }
  const r = await runProbe(found, ["--version"], { timeoutMs: PROBE_TIMEOUT_MS, shell: process.platform === "win32" });
  const version = (r.stdout.trim() || r.stderr.trim()).split(/\r?\n/)[0];
  if (!r.ok || r.status !== 0 || !version) {
    return {
      name,
      level,
      result: level === "FAIL" ? "FAIL" : "WARN",
      failure_kind: "not_spawnable",
      detail: `${found} 存在但 --version 失败（${r.timedOut ? "超时" : r.spawnError ?? `rc=${r.status}`}）`,
      remediation: `修复 ${found} 安装（重装或修复 PATH 关联）`,
    };
  }
  return { name, level, result: "PASS", detail: version };
}

export function checkGit(_ctx: CheckContext): Promise<CheckOutcome> {
  return simpleToolCheck("git", "FAIL", "根仓与业务仓 Git 操作依赖");
}

export function checkPython(_ctx: CheckContext): Promise<CheckOutcome> {
  return simpleToolCheck("python", "WARN", "tools/repo_registry.py 等脚本依赖");
}
