/**
 * change update-progress — tasks.md checkbox 确定性补丁更新（single-writer critical section）。
 *
 * 契约：05-openspec-schema-implementation-design §11（裁决 D1：TS 落地；
 * 裁决 D2：同目录 tasks.md.patch-lock 进程级锁——wx 原子抢占 + owner 记录 +
 * 有界重试 ~200ms/上限 30s + 进程退出清理 + stale 探测（pid 不可活或锁龄 >120s
 * 可接管并记录）；裁决 D3 修订：自 rondo 收编起，实现位置为 @winning/skill-flow
 * 包内 commands/change/update-progress.ts，见 change-progress-script-contract.md addendum）。
 *
 * 只执行 checkbox [ ] → [x] 的确定性 patch，不判断任务是否语义完成；
 * 不写 git、不 commit（根仓提交归 finalize）。
 *
 * 用法：
 *   rondo change update-progress --openspec-root <root>
 *     --change-ref <stable-change-id> --check <1.1,1.2,...>
 *
 * 结果枚举 → 退出码：
 *   UPDATED（本次勾选成功）            → 0
 *   ALREADY_COMPLETE（目标已勾，幂等）  → 0
 *   BUSY（30s 有界重试后仍不可获得锁）  → 2
 *   CONFLICT（目标行变化/消失/编号重复）→ 2
 *   INVALID（输入 / Change / tasks.md contract 非法）→ 2
 *   未预期 IO / 环境错误               → 3
 *   参数用法错误                       → 64
 * stdout 只出 JSON；日志走 stderr。
 */

import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  fsyncSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { emitJson, log, markLeafExecuted } from "../../cli/output.js";
import { resolveOpenspecRootDir } from "../../clients/runtime-paths.js";

type Result = "UPDATED" | "ALREADY_COMPLETE" | "BUSY" | "CONFLICT" | "INVALID";

interface Answer {
  result: Result;
  change_ref: string | null;
  checked: string[];
  skipped_already: string[];
  detail?: string;
}

const LOCK_RETRY_MS = 200;
const LOCK_TIMEOUT_MS = 30_000;
const LOCK_STALE_MS = 120_000;

const LOG_PREFIX = "update-task-progress";

function emit(answer: Answer, exitCode: number): never {
  emitJson(answer, exitCode);
}

function fail(result: "CONFLICT" | "INVALID" | "BUSY", changeRef: string | null, detail: string): never {
  log(LOG_PREFIX, `${result}: ${detail}`);
  emit({ result, change_ref: changeRef, checked: [], skipped_already: [], detail }, 2);
}

function failUnexpected(detail: string): never {
  log(LOG_PREFIX, `unexpected: ${detail}`);
  emit({ result: "INVALID", change_ref: null, checked: [], skipped_already: [], detail: `unexpected: ${detail}` }, 3);
}

function usage(message: string): never {
  log(LOG_PREFIX, message);
  emit({ result: "INVALID", change_ref: null, checked: [], skipped_already: [], detail: `usage: ${message}` }, 64);
}

// --- args ---

interface Args {
  openspecRoot: string;
  changeRef: string;
  checks: string[];
}

const TASK_REF = /^\d+(\.\d+)*$/;

function parseArgs(argv: string[]): Args {
  let openspecRoot: string | null = null;
  let changeRef: string | null = null;
  let check: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) usage(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--openspec-root": openspecRoot = next(); break;
      case "--change-ref": changeRef = next(); break;
      case "--check": check = next(); break;
      case "--help": case "-h":
        process.stdout.write(
          "usage: rondo change update-progress --openspec-root <root> --change-ref <id> --check <1.1,1.2,...>\n",
        );
        process.exit(0);
      default:
        usage(`unknown argument: ${a}`);
    }
  }
  if (!openspecRoot) usage("--openspec-root is required");
  if (!changeRef) usage("--change-ref is required");
  if (/[\\/]/.test(changeRef!)) usage("--change-ref 传稳定 Change ID，不传路径");
  if (!check) usage("--check is required（逗号分隔的任务编号，如 1.1,1.2）");
  const checks = check!
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (checks.length === 0) usage("--check 为空");
  for (const c of checks) {
    if (!TASK_REF.test(c)) usage(`非法任务编号：${c}（期望形如 1.1）`);
  }
  if (new Set(checks).size !== checks.length) usage(`--check 含重复编号：${checks.join(",")}`);
  return { openspecRoot: resolve(openspecRoot!), changeRef: changeRef!, checks };
}

// --- patch lock（05 §11.3 + 裁决 D2：process-scoped、可自恢复） ---

interface LockOwner {
  pid: number;
  acquired_at: string;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH = 不存在；EPERM = 存在但无权限（视为存活）
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLockOwner(lockPath: string): LockOwner | null {
  try {
    const raw = readFileSync(lockPath, "utf8");
    const o = JSON.parse(raw) as LockOwner;
    return typeof o?.pid === "number" ? o : null;
  } catch {
    return null;
  }
}

/** stale 判定：pid 不可活 或 锁龄 >120s（D2；Windows pid 复用风险以锁龄为准，开放问题 2）。 */
function isStale(lockPath: string): { stale: boolean; reason: string } {
  let ageMs = Infinity;
  try {
    ageMs = Date.now() - statSync(lockPath).mtimeMs;
  } catch {
    return { stale: false, reason: "lock stat 失败，按未 stale 处理" };
  }
  const owner = readLockOwner(lockPath);
  if (owner && !pidAlive(owner.pid)) {
    return { stale: true, reason: `owner pid ${owner.pid} 不可活（acquired_at=${owner.acquired_at}）` };
  }
  if (ageMs > LOCK_STALE_MS) {
    return { stale: true, reason: `锁龄 ${Math.round(ageMs / 1000)}s > ${LOCK_STALE_MS / 1000}s` };
  }
  return { stale: false, reason: "" };
}

function acquireLock(lockPath: string): void {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  const owner: LockOwner = { pid: process.pid, acquired_at: new Date().toISOString() };
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx");
      writeFileSync(fd, JSON.stringify(owner) + "\n", "utf8");
      closeSync(fd);
      log(LOG_PREFIX, `lock acquired: ${lockPath} (pid=${process.pid})`);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
        failUnexpected(`lock acquire: ${(e as Error).message}`);
      }
    }
    const s = isStale(lockPath);
    if (s.stale) {
      log(LOG_PREFIX, `stale lock 接管：${s.reason}`);
      try {
        unlinkSync(lockPath);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          failUnexpected(`stale lock unlink: ${(e as Error).message}`);
        }
      }
      continue;
    }
    if (Date.now() >= deadline) {
      fail("BUSY", null, `有界重试 ${LOCK_TIMEOUT_MS / 1000}s 后锁仍不可获得：${lockPath}`);
    }
    const waitUntil = Date.now() + LOCK_RETRY_MS;
    while (Date.now() < waitUntil) {
      // busy-wait 上限 200ms，避免子进程依赖
    }
  }
}

function releaseLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
    log(LOG_PREFIX, "lock released");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      log(LOG_PREFIX, `WARN: lock release 失败：${(e as Error).message}`);
    }
  }
}

// --- tasks.md patch ---

// 原生 checkbox 行：- [ ] 1.1 …（标记区允许任意单字符，便于识别 [~] / [-] 等非法翻转目标）
// 行尾兼容 CRLF：JS `.` 不匹配 \r，CRLF 行须由结尾 (\r?) 显式吸收，且重写时原样保留（2026-11-03 WNDF-52 D1）
const CHECKBOX_LINE = /^(\s*[-*]\s*\[)(.)(\]\s+)(\d+(?:\.\d+)*)(?=[\s:：]|\r?$)(.*)(\r?)$/;

interface TaskLine {
  lineIndex: number;
  mark: string;
  ref: string;
}

function parseTasks(content: string): { lines: string[]; tasks: TaskLine[] } {
  const lines = content.split("\n");
  const tasks: TaskLine[] = [];
  lines.forEach((line, i) => {
    const m = line.match(CHECKBOX_LINE);
    if (m) tasks.push({ lineIndex: i, mark: m[2], ref: m[4] });
  });
  return { lines, tasks };
}

function run(rawArgs: string[]): void {
  const args = parseArgs(rawArgs);
  // --openspec-root 语义统一：根仓路径自动归一到其 openspec/ 子目录
  const changeDir = join(resolveOpenspecRootDir(args.openspecRoot), "changes", args.changeRef);
  if (!existsSync(changeDir)) {
    fail("INVALID", args.changeRef, `change 不存在或已 archive：${changeDir}（archive 变更不再更新进度）`);
  }
  const tasksPath = join(changeDir, "tasks.md");
  if (!existsSync(tasksPath)) {
    fail("INVALID", args.changeRef, `tasks.md 不存在：${tasksPath}`);
  }
  const lockPath = `${tasksPath}.patch-lock`;

  acquireLock(lockPath);
  try {
    // 05 §11.3：进入锁以后必须重新读取最新 tasks.md。
    const content = readFileSync(tasksPath, "utf8");
    const { lines, tasks } = parseTasks(content);

    // 结构校验：编号重复 → CONFLICT（不假勾）。
    const byRef = new Map<string, TaskLine[]>();
    for (const t of tasks) {
      const arr = byRef.get(t.ref) ?? [];
      arr.push(t);
      byRef.set(t.ref, arr);
    }
    const dups = [...byRef.entries()].filter(([, v]) => v.length > 1).map(([k]) => k);
    if (dups.length > 0) {
      fail("CONFLICT", args.changeRef, `任务编号重复：${dups.join(", ")}，停止 patch（05 §11.4）`);
    }

    const toCheck: string[] = [];
    const already: string[] = [];
    for (const ref of args.checks) {
      const t = byRef.get(ref)?.[0];
      if (!t) {
        fail("CONFLICT", args.changeRef, `目标任务 ${ref} 在当前 tasks.md 中不存在（目标行消失，05 §11.4）`);
      }
      const mark = t!.mark;
      if (mark === " ") {
        toCheck.push(ref);
      } else if (mark === "x" || mark === "X") {
        already.push(ref);
      } else {
        fail(
          "CONFLICT",
          args.changeRef,
          `目标任务 ${ref} 当前标记为 [${mark}]；脚本只允许 [ ] → [x]（05 §11.2），不覆盖其他状态`,
        );
      }
    }

    if (toCheck.length === 0) {
      emit({ result: "ALREADY_COMPLETE", change_ref: args.changeRef, checked: [], skipped_already: already }, 0);
    }

    for (const ref of toCheck) {
      const t = byRef.get(ref)![0];
      const line = lines[t.lineIndex];
      const m = line.match(CHECKBOX_LINE)!;
      lines[t.lineIndex] = `${m[1]}x${m[3]}${m[4]}${m[5]}${m[6]}`;
    }

    // 05 §11.3 原子写入：同文件系统临时文件 + flush + rename + 写后回读核对。
    const tmpPath = `${tasksPath}.tmp-${process.pid}`;
    try {
      const fd = openSync(tmpPath, "w");
      writeFileSync(fd, lines.join("\n"), "utf8");
      fsyncSync(fd);
      closeSync(fd);
      renameSync(tmpPath, tasksPath);
    } catch (e) {
      failUnexpected(`atomic write: ${(e as Error).message}`);
    }

    const verify = parseTasks(readFileSync(tasksPath, "utf8"));
    const verifyMap = new Map(verify.tasks.map((t) => [t.ref, t.mark]));
    for (const ref of toCheck) {
      const mark = verifyMap.get(ref);
      if (mark !== "x" && mark !== "X") {
        failUnexpected(`read-back 核对失败：${ref} 回读标记为 [${mark ?? "?"}]`);
      }
    }

    emit({ result: "UPDATED", change_ref: args.changeRef, checked: toCheck, skipped_already: already }, 0);
  } finally {
    releaseLock(lockPath);
  }
}

/** commander 注册：group=change；参数解析沿用原脚本实现以保证契约逐字节等价。 */
export function registerUpdateProgress(group: Command): void {
  group
    .command("update-progress")
    .description("tasks.md checkbox 串行写入（冻结契约 §2）")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action((...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      run(cmd.args);
    });
}
