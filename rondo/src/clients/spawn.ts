/**
 * clients/spawn.ts — 外部进程统一执行层（multica / tfs-cli / git 等的唯一消费点）。
 *
 * execa 承担原各脚本自维护的 Windows 命令解析（where.exe）与 CRT 引号处理
 * （plan §4.2）；超时 300s、maxBuffer 64MB 与原 runCommand 对齐。
 *
 * argv 留痕：SKILL_FLOW_TRACE=1 时输出参数结构；Metadata 正文仅显示字节数。
 */

import { execaSync } from "execa";
import { UnknownError } from "../cli/errors.js";
import { logLine } from "../cli/output.js";

export interface CmdResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** 只压缩日志中的 Metadata 正文；实际 argv、响应和持久化证据保持原样。 */
function commandForLog(cmd: string[]): string[] {
  const start = cmd.findIndex((arg, i) =>
    arg === "issue" && cmd[i + 1] === "metadata" && cmd[i + 2] === "set");
  if (start < 0) return cmd;
  const displayed = [...cmd];
  const omitted = (value: string) => `<metadata: ${Buffer.byteLength(value, "utf8")} bytes; omitted>`;
  for (let i = start + 3; i < displayed.length; i++) {
    if (displayed[i] === "--value" && i + 1 < displayed.length) {
      displayed[i + 1] = omitted(displayed[i + 1]);
      i++;
    } else if (displayed[i].startsWith("--value=")) {
      displayed[i] = "--value=" + omitted(displayed[i].slice(8));
    }
  }
  return displayed;
}

function trace(cmd: string[]): void {
  if (!process.env.SKILL_FLOW_TRACE) return;
  logLine(`[rondo:trace] argv: ${cmd.map((a) => JSON.stringify(a)).join(" ")}`);
}

/**
 * 同步执行外部命令，非零退出不抛异常（退出码是业务事实，由调用方判定）；
 * 仅当进程根本无法启动时抛 UnknownError（对齐原 runCommand 的 `命令无法执行`）。
 */
export function runCommand(cmd: string[], cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs = 300_000): CmdResult {
  const displayed = commandForLog(cmd);
  logLine(`$ ${displayed.join(" ")}`);
  trace(displayed);
  let r;
  try {
    r = execaSync(cmd[0], cmd.slice(1), {
      reject: false,
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      cwd,
      ...(env ? { env } : {}),
    });
  } catch (e) {
    throw new UnknownError(`命令无法执行: ${cmd[0]}: ${(e as Error).message}`);
  }
  if (r.failed && r.exitCode === undefined) {
    throw new UnknownError(`命令无法执行: ${cmd[0]}: ${r.message}`);
  }
  return { status: r.exitCode ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * stdin 变体（M3.2 上提共享）：route-decision 的 issue comment add --content-stdin
 * 与 materialize 的 issue create --description-stdin 两处重复实现收敛于此（行为不变的去重）。
 * 语义对齐 runJson：非 0 即失败；JSON 解析失败抛 UnknownError。
 */
export function runJsonStdin(cmd: string[], what: string, stdin: string): unknown {
  const displayed = commandForLog(cmd);
  logLine(`$ ${displayed.join(" ")}`);
  trace(displayed);
  let r;
  try {
    r = execaSync(cmd[0], cmd.slice(1), {
      reject: false,
      timeout: 300_000,
      maxBuffer: 64 * 1024 * 1024,
      input: stdin,
    });
  } catch (e) {
    throw new UnknownError(`命令无法执行: ${cmd[0]}: ${(e as Error).message}`);
  }
  if (r.failed && r.exitCode === undefined) {
    throw new UnknownError(`命令无法执行: ${cmd[0]}: ${r.message}`);
  }
  const status = r.exitCode ?? 1;
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  if (status !== 0) throw new UnknownError(`${what} 命令失败 rc=${status}: ${stderr.trim() || stdout.trim()}`);
  try { return JSON.parse(stdout); }
  catch (exc) { throw new UnknownError(`${what} 输出不是合法 JSON: ${exc}`); }
}

/** 允许 exit 2（单项失败契约，stdout 仍有 JSON）；exit 3 → UNKNOWN 上抛 */
export interface RunJsonOptions {
  /**
   * 读类命令瞬态标记（analyst-run-efficiency-optimization-plan P0）：
   * exit 0/2 但 stdout 完全为空/全空白时，判定为传输层瞬态故障（如 multica CLI
   * 超时后以空 stdout 混出），重试 retries 次后再走 UNKNOWN。
   * 仅限幂等读命令使用；合法空 JSON（`[]`/`{}`）非空白，不会触发重试。
   *
   * M3.1（rll5-replay-remediation-plan）扩展：rc=3 或 rc≠0/2/3 且输出命中
   * TRANSIENT_NETWORK_PATTERNS 签名时同样重试；JSON 截断（"Unexpected end of
   * JSON input"）也按签名重试。重试耗尽/最终失败的消息尾加 ` [network]` 分类标记。
   */
  transient?: boolean;
  /** 瞬态重试次数，默认 3（M3.1 起；旧默认 1 仅存在于无签名时代）。 */
  retries?: number;
  /** 退避基数毫秒数，默认 3000；实际等待 = base*3^attempt + 0–20% jitter。 */
  retryDelayMs?: number;
}

/** 传输层瞬态故障签名（大小写不敏感子串；均为传输层专有短语，业务 UNKNOWN 文案不会命中）。 */
export const TRANSIENT_NETWORK_PATTERNS = [
  "TLS handshake",
  "Could not reach",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EPROTO",
  "socket hang up",
  "Unexpected end of JSON input",
] as const;

export function isTransientNetworkText(text: string): boolean {
  const lower = text.toLowerCase();
  return TRANSIENT_NETWORK_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

/** 指数退避：base*3^attempt + 0–20% jitter（rand 可注入以便测试，默认 Math.random）。 */
export function transientBackoffMs(baseMs: number, attempt: number, rand: () => number = Math.random): number {
  return Math.round(baseMs * Math.pow(3, attempt) * (1 + rand() * 0.2));
}

/** 同步等待（runJson 为同步契约，无法用 setTimeout；Atomics.wait 阻塞当前线程即可）。
 * 导出供 dispatch-facts 的 CmdResult 形瞬态包装复用同一等待实现。 */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function runJson(cmd: string[], what: string, cwd?: string, opts?: RunJsonOptions): unknown {
  const transient = opts?.transient === true;
  const retries = transient ? (opts?.retries ?? 3) : 0;
  const baseMs = opts?.retryDelayMs ?? 3000;
  const retry = (attempt: number, reason: string): boolean => {
    if (!transient || attempt >= retries) return false;
    const delay = transientBackoffMs(baseMs, attempt);
    logLine(`[rondo] transient retry: ${what}（第 ${attempt + 1} 次尝试${reason}，${delay}ms 后重试）`);
    sleepSync(delay);
    return true;
  };
  for (let attempt = 0; ; attempt++) {
    const cp = runCommand(cmd, cwd);
    // 按本次响应判定；网络恢复后的业务失败不可沿用前一次分类继续重试。
    let sawNetwork = transient && isTransientNetworkText(`${cp.stdout}\n${cp.stderr}`);

    if (cp.status === 3) {
      if (sawNetwork && retry(attempt, ` rc=3 命中网络签名`)) continue;
      throw new UnknownError(`${what} UNKNOWN: ${cp.stdout.trim() || cp.stderr.trim()}${sawNetwork ? " [network]" : ""}`);
    }
    if (cp.status !== 0 && cp.status !== 2) {
      if (sawNetwork && retry(attempt, ` rc=${cp.status} 命中网络签名`)) continue;
      throw new UnknownError(`${what} 命令失败 rc=${cp.status}: ${cp.stderr.trim()}${sawNetwork ? " [network]" : ""}`);
    }
    if (cp.stdout.trim() === "" && transient && attempt < retries) {
      // 空 stdout 本身就是传输层故障形态（无签名可命中），直接计入分类
      sawNetwork = true;
      retry(attempt, " stdout 为空");
      continue;
    }
    try {
      return JSON.parse(cp.stdout);
    } catch (exc) {
      // 截断 JSON（"Unexpected end of JSON input"）同属传输层签名
      sawNetwork = sawNetwork || (transient && isTransientNetworkText(String(exc)));
      if (sawNetwork && retry(attempt, " JSON 截断")) continue;
      const retried = transient && retries > 0 && cp.stdout.trim() === "";
      throw new UnknownError(
        `${what} 输出不是合法 JSON（rc=${cp.status}, stdout_bytes=${Buffer.byteLength(cp.stdout, "utf8")}）: ${exc}` +
        `${cp.stderr.trim() ? `；stderr: ${cp.stderr.trim()}` : ""}` +
        `${retried ? `（已重试 ${retries} 次，stdout 仍为空，疑似传输层故障）` : ""}${sawNetwork ? " [network]" : ""}`,
      );
    }
  }
}
