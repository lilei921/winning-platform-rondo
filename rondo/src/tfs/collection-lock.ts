/** One exclusive TFS Collection writer across Runtimes; no time-based auto-steal. */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { hostname } from "node:os";
import { UnknownError } from "../cli/errors.js";
import { AsyncLocalStorage } from "node:async_hooks";

interface HeldLock { path: string; marker: string }
const heldByCurrentOperation = new AsyncLocalStorage<Map<string, HeldLock>>();

/** The directory MUST be one atomic O_EXCL-capable, shared filesystem for every writer of this Collection.
 * A local per-Runtime directory is unsafe and must never be configured.
 */
export async function withCollectionWriterLock<T>(serverUrl: string, action: () => Promise<T>): Promise<T> {
  const key = createHash("sha256").update(serverUrl.toLowerCase().replace(/\/+$/, "")).digest("hex");
  // Reentrant only for the same asynchronous call chain, never concurrent independent writers.
  const inherited = heldByCurrentOperation.getStore()?.get(key);
  if (inherited) {
    let actual: string;
    try { actual = readFileSync(inherited.path, "utf8"); }
    catch { throw new UnknownError("TFS Writer 的嵌套调用发现外层锁已丢失"); }
    if (actual !== inherited.marker) throw new UnknownError("TFS Writer 的嵌套锁身份不匹配");
    return action();
  }
  const directory = process.env.RONDO_TFS_COLLECTION_LOCK_DIR;
  if (!directory || !isAbsolute(directory) || !existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new UnknownError("缺少已验证的跨 Runtime 共享锁目录 RONDO_TFS_COLLECTION_LOCK_DIR；拒绝并发不安全的 TFS Commit 写入");
  }
  const lockPath = join(directory, "rondo-tfs-" + key + ".lock");
  const marker = JSON.stringify({ token: randomUUID(), host: hostname(), pid: process.pid });
  let fd: number;
  try { fd = openSync(lockPath, "wx", 0o600); }
  catch { throw new UnknownError("TFS Collection Writer 已被占用或锁目录不可写；不可并发关联 Commit"); }
  try {
    writeSync(fd, marker);
  } finally { closeSync(fd); }
  try {
    const held = new Map(heldByCurrentOperation.getStore() ?? []);
    held.set(key, { path: lockPath, marker });
    return await heldByCurrentOperation.run(held, action);
  } finally {
    let current: string;
    try { current = readFileSync(lockPath, "utf8"); }
    catch { throw new UnknownError("TFS Writer 锁丢失或不可读；无法报告 PASS"); }
    if (current !== marker) throw new UnknownError("TFS Writer 锁身份改变；保留现场人工检查");
    try { unlinkSync(lockPath); }
    catch { throw new UnknownError("TFS Writer 锁释放失败；需人工核对，不报告 PASS"); }
  }
}
