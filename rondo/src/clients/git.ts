/**
 * clients/git.ts — 根仓/枢纽仓直接 git 操作的共享封装。
 *
 * 收敛自 finalize.ts / worktree.ts 内逐份复制的 git/gitOk/porcelainPaths（历史两份并存）；
 * 新增调用方一律用本模块，存量两处暂不回改（控制回归面，后续再收敛）。
 */

import { UnknownError } from "../cli/errors.js";
import { runCommand } from "./spawn.js";
import { isAbsolute, delimiter, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

/** Runtime 管理员注入兼容 Git；路径只作用于子进程，不进入共享 Registry。 */
export function gitRuntime(env: NodeJS.ProcessEnv = process.env): { executable: string; env: NodeJS.ProcessEnv } {
  const executable = env.RONDO_GIT_EXECUTABLE || "git";
  if (executable !== "git" && !isAbsolute(executable)) throw new UnknownError("RONDO_GIT_EXECUTABLE 必须为绝对路径");
  const child = { ...env };
  // execa 会合并父环境，须用 undefined 显式清除，不能只 delete 后再被继承。
  // Windows 环境名不区分大小写；cwd 始终是本次 Git 操作的目录来源。
  const locationKeys = new Set(["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]);
  for (const key of Object.keys(child)) {
    if (locationKeys.has(key.toUpperCase())) child[key] = undefined;
  }
  const prefix = env.RONDO_GIT_PATH_PREFIX;
  if (prefix) {
    if (prefix.split(delimiter).some(p => !isAbsolute(p))) throw new UnknownError("RONDO_GIT_PATH_PREFIX 必须由绝对目录组成");
    const key = Object.keys(child).find(k => k.toLowerCase() === "path") || "PATH";
    child[key] = prefix + delimiter + (child[key] || "");
  }
  return { executable, env: child };
}

export function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const runtime = gitRuntime();
  return runCommand([runtime.executable, ...args], cwd, runtime.env);
}

export function gitOk(cwd: string, args: string[], what: string): string {
  const r = git(cwd, args);
  if (r.status !== 0) throw new UnknownError(`${what} 失败: ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout.trim();
}

/** Isolate tree construction from the user's staging area. */
export function withTemporaryIndex<T>(root: string, use: (index: (args: string[]) => string, dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "rondo-git-index-"));
  try {
    const runtime = gitRuntime();
    const env = { ...runtime.env, GIT_INDEX_FILE: join(dir, "index") };
    return use(args => {
      const result = runCommand([runtime.executable, ...args], root, env);
      if (result.status !== 0) throw new UnknownError("临时 Git Index 操作失败: " + result.stderr);
      return result.stdout.trim();
    }, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** porcelain 解析（-c core.quotepath=false；rename 取两侧路径）。
 * 注意：不得对整体 stdout 做 trim()——porcelain 首列是状态位，首行可能以空格开头（" D"），
 * trim 会吃掉该空格导致 slice(3) 错位（实测 F1 踩坑：" D openspec/…" → "penspec/…"）。 */
export function porcelainPaths(cwd: string): string[] {
  const r = git(cwd, ["-c", "core.quotepath=false", "status", "--porcelain"]);
  if (r.status !== 0) throw new UnknownError(`读取根仓工作区状态失败: ${r.stderr.trim()}`);
  const paths: string[] = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const p = line.slice(3);
    for (const part of p.split(" -> ")) paths.push(part.trim());
  }
  return paths;
}
