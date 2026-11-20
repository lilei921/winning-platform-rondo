/**
 * clients/which.ts — 命令探测（where.exe / command -v）。
 *
 * 抽取自 analysis/validate.ts 内联实现（rondo-doctor-env-check-plan §5.1），
 * validate 与 doctor 共用同一实现，避免两份探测逻辑漂移。
 */

import { spawnSync } from "node:child_process";

/** 命令是否存在于 PATH。Windows 下 shell:true 时命令不存在由 cmd.exe 报 rc=1，无法用 ENOENT 区分，必须先显式探测。 */
export function commandExists(cmd: string): boolean {
  const r = process.platform === "win32"
    ? spawnSync("where.exe", [cmd], { encoding: "utf8" })
    : spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" });
  return !r.error && r.status === 0;
}

/**
 * 返回命令的全部命中路径（解析顺序），未命中返回空数组。
 * 供 doctor 的 path_precedence / openspec_cli 定位使用；超时按失败处理（返回空数组）。
 */
export function whereAll(cmd: string, timeoutMs = 2000): string[] {
  const r = process.platform === "win32"
    ? spawnSync("where.exe", [cmd], { encoding: "utf8", timeout: timeoutMs })
    : spawnSync("sh", ["-c", `command -v -a ${cmd} 2>/dev/null || command -v ${cmd}`], { encoding: "utf8", timeout: timeoutMs });
  if (r.error || r.status !== 0) return [];
  return r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
