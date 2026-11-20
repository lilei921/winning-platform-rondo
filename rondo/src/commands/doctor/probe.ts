/**
 * 异步探测复用 execa 的 argv 与 Windows shim 解析，避免用户参数被 shell 解释。
 * spawn 失败与超时分别返回 spawnError / timedOut，不把异常转换成成功。
 */

import { execa } from "execa";

export interface ProbeResult {
  /** true = 进程正常启动并退出（无论 rc）；false = spawn 失败或超时。 */
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  spawnError?: string;
  timedOut?: boolean;
}

export interface ProbeOptions {
  timeoutMs: number;
  /** 兼容旧调用参数；执行器统一安全解析 shim，不启用 shell 拼接。 */
  shell?: boolean;
}

/** 使用 argv 执行，execa 负责 Windows shim 解析，禁止拼接用户输入到 shell。 */
export async function runProbe(cmd: string, args: string[], opts: ProbeOptions): Promise<ProbeResult> {
  try {
    const r = await execa(cmd, args, { reject: false, timeout: opts.timeoutMs, windowsHide: true });
    return {
      ok: !r.timedOut && !r.isTerminated && r.exitCode !== undefined,
      status: r.exitCode ?? null,
      stdout: r.stdout,
      stderr: r.stderr,
      ...(r.timedOut ? { timedOut: true } : {}),
      ...(r.exitCode === undefined && !r.timedOut ? { spawnError: r.shortMessage } : {}),
    };
  } catch (exc) {
    return { ok: false, status: null, stdout: "", stderr: "", spawnError: String(exc) };
  }
}

/** fetch 带超时（连通性探测用），异常一律收敛为 ok=false，doctor 自身不得成为故障源。 */
export async function fetchProbe(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<{ ok: boolean; status?: number; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers, redirect: "manual" });
    return { ok: true, status: res.status };
  } catch (exc) {
    return { ok: false, error: exc instanceof Error && exc.name === "AbortError" ? `超时(>${timeoutMs}ms)` : String(exc) };
  } finally {
    clearTimeout(timer);
  }
}
