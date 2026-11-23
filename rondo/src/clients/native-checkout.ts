/** 只读检查调用方明确传入的根仓；执行者授权由具体写操作负责。 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FailError, UnknownError } from "../cli/errors.js";
import { runCommand } from "./spawn.js";
import { validateRootRepo } from "./runtime-paths.js";

/** 由 Git 确认工作树根目录，兼容普通 checkout 与 linked worktree，不依赖平台目录布局。 */
export function validateNativeCheckout(root: string): { rootRepo: string } {
  const rootRepo = validateRootRepo(root, "--root-repo");
  try {
    if (!statSync(join(rootRepo, "AGENTS.md")).isFile()) throw new Error();
  } catch {
    throw new UnknownError("根仓规范 AGENTS.md 尚不可读或不是文件");
  }
  return { rootRepo };
}

/**
 * 平台 checkout 的身份证据。
 * 弱方案：由 `multica repo checkout` 输出/本 Run 环境生成；
 * 强方案：平台若提供 `.git/multica-checkout.json`，以该 manifest 为准。
 */
export interface PlatformCheckoutIdentity {
  checkout_branch: string;
  task_id: string;
  workspace_id: string;
  checkout_mode: string;
}

/** 平台 manifest 文件名（强方案接口；平台尚未稳定提供时缺失即回退弱方案）。 */
export const PLATFORM_CHECKOUT_MANIFEST = "multica-checkout.json";

/** 当前 Run 可离线复核的平台上下文；checkout_branch 只在证据侧存在。 */
export interface LivePlatformContext {
  mode: string | null;
  taskId?: string;
  workspaceId?: string;
}

/**
 * 平台 checkout 分支尾号：MULTICA_TASK_ID 去连字符后的末 12 位。
 * 实测格式：`agent/<agent>/<尾号>`；同一 Task 的多个 checkout 可能追加 `-<时间戳>` 去重。
 */
export function platformTaskSuffix(taskId: string): string {
  const compact = taskId.replace(/-/g, "");
  if (compact.length < 12) throw new UnknownError("MULTICA_TASK_ID 长度不足，无法核对平台 checkout 身份");
  return compact.slice(-12);
}

/** 读取平台写入工作树配置的 `[multica] checkout-mode`；只读，不修改仓库。 */
export function platformCheckoutMode(rootRepo: string): string | null {
  const r = runCommand(["git", "config", "--get", "multica.checkout-mode"], rootRepo);
  const value = r.stdout.trim();
  return r.status === 0 && value ? value : null;
}

/** 任务 workdir 内的平台任务上下文文件名（daemon 写入）。 */
export const DAEMON_TASK_CONTEXT = join(".multica", "daemon_task_context.json");

export interface DaemonTaskContext {
  managed_by?: string;
  issue_id?: string;
  agent_id?: string;
}

/** 读取 daemon task 上下文；缺失或损坏返回 null，由调用方决定是否拒绝。 */
export function readDaemonTaskContext(workdir: string): DaemonTaskContext | null {
  try {
    const value = JSON.parse(readFileSync(join(workdir, DAEMON_TASK_CONTEXT), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as DaemonTaskContext;
  } catch {
    return null;
  }
}

/**
 * linked worktree 的 Git 公共目录是否位于 daemon 的 `<workspaces-root>/.repos/<workspace-id>/` 缓存下。
 * 这是平台从 bare cache 创建隔离 worktree 的直接形态证据（新版 daemon 不写 `[multica] checkout-mode`）。
 */
export function isDaemonCacheWorktree(rootRepo: string, workspaceId: string | undefined): boolean {
  if (!workspaceId) return false;
  const r = runCommand(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], rootRepo);
  if (r.status !== 0) return false;
  const parts = r.stdout.trim().replace(/\\/g, "/").split("/");
  return parts.some((part, i) => part === ".repos" && parts[i + 1] === workspaceId);
}

/**
 * 读取平台 checkout manifest；不存在返回 null（走弱方案）。
 * manifest 存在但不可解析或缺字段时 fail closed，避免把未知目录当作收口根仓。
 */
export function readPlatformCheckoutManifest(gitDir: string): PlatformCheckoutIdentity | null {
  const file = join(gitDir, PLATFORM_CHECKOUT_MANIFEST);
  const entry = statSync(file, { throwIfNoEntry: false });
  if (!entry) return null;
  if (!entry.isFile()) throw new UnknownError("平台 checkout manifest 不是文件，拒绝收口");
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new UnknownError("平台 checkout manifest 不是合法 JSON，拒绝收口"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UnknownError("平台 checkout manifest 不是对象，拒绝收口");
  }
  const obj = value as Record<string, unknown>;
  // 兼容平台可能采用的蛇形/驼峰命名；只要存在明确字符串值即取用。
  const pick = (...keys: string[]): string =>
    keys.map((key) => obj[key]).find((v): v is string => typeof v === "string" && v.length > 0) ?? "";
  const evidence: PlatformCheckoutIdentity = {
    checkout_branch: pick("checkout_branch", "checkoutBranch", "branch"),
    task_id: pick("task_id", "taskId"),
    workspace_id: pick("workspace_id", "workspaceId"),
    checkout_mode: pick("checkout_mode", "checkoutMode", "mode"),
  };
  if (!evidence.checkout_branch || !evidence.task_id || !evidence.workspace_id || !evidence.checkout_mode) {
    throw new UnknownError("平台 checkout manifest 缺少身份字段，拒绝把该目录当作收口根仓");
  }
  return evidence;
}

/**
 * 弱方案四条件中可离线交叉验证的三项：isolated 模式、Task/Workspace 绑定、平台分支尾号。
 * 第四项 `issue runs --active` 依赖平台 API，由准备根仓的调用方在主流程中核实。
 */
export function assertPlatformCheckoutIdentity(evidence: PlatformCheckoutIdentity, live: LivePlatformContext): void {
  if (evidence.checkout_mode.toLowerCase() !== "isolated" || (live.mode ?? "").toLowerCase() !== "isolated") {
    throw new UnknownError("当前不是 Multica isolated checkout 任务，禁止使用收口根仓");
  }
  if (!live.taskId || !live.workspaceId) {
    throw new UnknownError("缺少 MULTICA_TASK_ID / MULTICA_WORKSPACE_ID，不能校验收口 checkout 身份");
  }
  if (evidence.task_id !== live.taskId || evidence.workspace_id !== live.workspaceId) {
    throw new FailError("平台 checkout 的 Task/Workspace 与当前 Run 不一致，拒绝使用该根仓");
  }
  const suffix = platformTaskSuffix(live.taskId);
  // 平台在分支名冲突时为同一 Task 追加 `-<时间戳>`，仍属本 Task 的 checkout。
  const tail = evidence.checkout_branch.split("/").at(-1) ?? "";
  if (tail !== suffix && !new RegExp("^" + suffix + "-\\d+$").test(tail)) {
    throw new FailError("平台 checkout 分支尾号与当前 Task 不一致，拒绝使用该根仓");
  }
}
