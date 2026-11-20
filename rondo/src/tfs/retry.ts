/**
 * tfs/retry.ts — TFS 调用瞬态重试（rll5-replay-remediation-plan M3.3，F3 TFS 侧）。
 *
 * 与 clients/spawn.ts 的 runJson 瞬态重试同族，但面向 in-process SDK/raw HTTP：
 * - 签名分类：仅传输层专有短语（ECONNRESET/ETIMEDOUT/socket hang up/EAI_AGAIN/EPROTO
 *   及 client.ts rawRequest 的"请求超时/连接失败"包装文案）；
 *   ECONNREFUSED 显式排除——那是配置/对端停机问题，重试无意义。
 * - 退避：base*3^attempt + 0–20% jitter（默认 3s/9s/27s），与 runJson 一致。
 * - 耗尽：原错误 message 尾加 ` [network]` 分类标记后原类型抛出（runner.ts 把
 *   UnknownError/未知错误都映射 exit 3，消息即分类载体）。
 * - onBeforeRetry：每次重试前回调（调用方借此重建 agent/连接——坏连接不重用时
 *   重试才有意义）。
 */

export const TRANSIENT_TFS_PATTERNS = [
  "ECONNRESET",
  "ETIMEDOUT",
  "socket hang up",
  "EAI_AGAIN",
  "EPROTO",
  "请求超时",
  "连接失败",
] as const;

export function isTransientTfsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // ECONNREFUSED = 对端明确拒绝（服务停机/端口错误），属配置问题而非瞬态抖动
  if (/ECONNREFUSED/i.test(msg)) return false;
  const lower = msg.toLowerCase();
  return TRANSIENT_TFS_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

export interface TransientRetryOptions {
  /** 重试次数（不含首次），默认 3 → 最多 4 次尝试 */
  retries?: number;
  /** 退避基数毫秒，默认 3000；实际等待 = base*3^attempt + 0–20% jitter */
  baseDelayMs?: number;
  /** 每次重试前回调（重建传输层：agent/WebApi/缓存 API） */
  onBeforeRetry?: (attempt: number) => void | Promise<void>;
  /** 可注入的 sleep（测试用），默认 setTimeout */
  sleep?: (ms: number) => Promise<void>;
  /** 重试日志标签（stderr；缺省不记日志） */
  what?: string;
}

export function transientTfsBackoffMs(baseMs: number, attempt: number, rand: () => number = Math.random): number {
  return Math.round(baseMs * Math.pow(3, attempt) * (1 + rand() * 0.2));
}

export async function withTransientRetry<T>(fn: () => Promise<T>, opts?: TransientRetryOptions): Promise<T> {
  const retries = opts?.retries ?? 3;
  const base = opts?.baseDelayMs ?? 3000;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransientTfsError(e)) throw e;
      if (attempt >= retries) {
        // 耗尽：原类型抛出，message 尾加 [network] 分类标记（runner 把消息带上 stdout/exit 3）
        markNetworkError(e);
        throw e;
      }
      await opts?.onBeforeRetry?.(attempt);
      const delay = transientTfsBackoffMs(base, attempt);
      if (opts?.what) console.error(`[rondo] transient retry: ${opts.what}（第 ${attempt + 1} 次尝试，${delay}ms 后重试）`);
      await sleep(delay);
      // 循环尾部：下一次尝试
    }
  }
}

/** 耗尽时给错误 message 追加 [network] 分类标记（保持原错误类型），供调用方在不再重试的边界使用。 */
export function markNetworkError(e: unknown): void {
  if (e instanceof Error && !e.message.includes("[network]")) e.message += " [network]";
}
