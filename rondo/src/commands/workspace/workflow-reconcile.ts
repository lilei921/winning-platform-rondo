/**
 * commands/workspace/workflow-reconcile.ts — Workflow 自定义状态 reconcile。
 *
 * 方案：projects/plans/workspace-workflow-status-provisioning-plan.md M1。
 * 由 workspace provision 第 6.5 段调用；依赖注入（versionOf / runJsonFn）保证可单测。
 *
 * 纪律（方案 §3.1.3，针对 multica workflow update --steps-file 的全量替换语义）：
 *   - 写前当次回读，零本地缓存（与 UI 并发编辑的互覆窗口收敛到最小）；
 *   - 以远端 steps 为底、只追加，绝不重排/删除远端项；
 *   - steps 文件走临时目录、写完即删，不进仓；
 *   - 写后回读强校验 status_key 与相对顺序（R1：new_status 派生键漂移即 UNKNOWN）。
 * 失败语义：本段任何失败返回 status:"unknown"，由调用方归并 exit 3，不阻断前段成果落盘。
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_STATUS_KEYS } from "../../clients/required-statuses.js";

export interface ManifestWorkflowStatus {
  key: string;
  /** 新建状态的显示名；与 category 成对出现（已存在状态不参与比对）。 */
  name?: string;
  /** 新建状态的类别（started/cancelled 等）；与 name 成对出现。 */
  category?: string;
  /** 插入锚点（前一个状态的 key）；锚点缺失时降级插到 done 之前。 */
  after?: string;
}

export interface ManifestWorkflow {
  ref?: string;
  statuses?: ManifestWorkflowStatus[];
}

export interface WorkflowStep {
  status_key?: string;
  new_status?: { name: string; category: string };
  [k: string]: unknown;
}

export interface MergeResult {
  /** 合并后的 steps（远端逐项原样保留 + 新状态按锚点插入）。 */
  merged: WorkflowStep[];
  /** 与 merged 对齐的期望 key 序列（new_status 项为 manifest 期望派生 key），写后回读校验用。 */
  expectedOrder: string[];
  /** 锚点缺失降级说明。 */
  fallbacks: string[];
}

/** 合并 steps：远端为底只追加；自定义状态用 new_status 形态，内建/已存在键用 status_key 引用。 */
export function mergeWorkflowSteps(remoteSteps: WorkflowStep[], missing: ManifestWorkflowStatus[]): MergeResult {
  const pairs = remoteSteps.map((s) => ({ step: { ...s } as WorkflowStep, key: s.status_key ?? "" }));
  const fallbacks: string[] = [];
  for (const m of missing) {
    const entry: WorkflowStep = m.name && m.category
      ? { new_status: { name: m.name, category: m.category } }
      : { status_key: m.key };
    const anchorIdx = m.after ? pairs.findIndex((p) => p.key === m.after) : -1;
    let insertAt: number;
    if (anchorIdx >= 0) {
      insertAt = anchorIdx + 1;
    } else {
      const doneIdx = pairs.findIndex((p) => p.key === "done");
      if (m.after) fallbacks.push(`workflow/${m.key}（锚点 ${m.after} 不存在，降级插到 done 之前）`);
      insertAt = doneIdx >= 0 ? doneIdx : pairs.length;
    }
    pairs.splice(insertAt, 0, { step: entry, key: m.key });
  }
  return { merged: pairs.map((p) => p.step), expectedOrder: pairs.map((p) => p.key), fallbacks };
}

/** multica 版本门：workflow 命令面需 ≥0.8.0。 */
export function workflowCliSupported(versionOutput: string): { supported: boolean; version: string | null } {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(versionOutput);
  if (!m) return { supported: false, version: null };
  const version = `${m[1]}.${m[2]}.${m[3]}`;
  const supported = Number(m[1]) > 0 || Number(m[2]) >= 8;
  return { supported, version };
}

/**
 * 写后回读校验（R1）：回读 keys 过滤到期望集合后的相对顺序必须等于期望序列。
 * 不一致即 status_key 派生漂移——返回人读原因，一致返回 null。
 */
export function verifyWorkflowSteps(expectedOrder: string[], rereadKeys: string[]): string | null {
  const expectedSet = new Set(expectedOrder);
  const actual = rereadKeys.filter((k) => expectedSet.has(k));
  if (JSON.stringify(actual) !== JSON.stringify(expectedOrder)) {
    return `写后回读校验失败：期望序列 [${expectedOrder.join(", ")}]，实际命中 [${actual.join(", ")}]（回读全量 [${rereadKeys.join(", ")}]）` +
      `——status_key 派生漂移(R1)，请核对平台实际派生键并修正 manifest 的 name/key`;
  }
  return null;
}

export interface WorkflowReconcileDeps {
  dryRun: boolean;
  /** multica 工作区参数（["--workspace-id", <id>]）。 */
  wsArgs: string[];
  /** multica 全局参数（如 ["--profile", <name>]），追加到每次调用的子命令前。 */
  cliArgs?: string[];
  /** 取 multica CLI 版本输出（同步）。 */
  versionOf: () => string;
  runJsonFn: (cmd: string[], what: string) => unknown;
  log?: (msg: string) => void;
}

export interface WorkflowReconcileOutcome {
  status: "ok" | "unknown";
  reason?: string;
  created: string[];
  unchanged: string[];
  unmanaged: string[];
}

/** 远端流程必须明确且非空；异常响应绝不能降级成空流程再全量覆盖。 */
export function readWorkflowSteps(value: unknown): WorkflowStep[] {
  const steps = (value as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps) || steps.length === 0) throw new Error("workflow get 缺少有效的非空 steps，禁止更新");
  const keys = new Set<string>();
  for (const step of steps) {
    if (!step || typeof step.status_key !== "string" || !step.status_key.trim() || keys.has(step.status_key)) {
      throw new Error("workflow get steps 含非法或重复 status_key，禁止更新");
    }
    keys.add(step.status_key);
  }
  return steps;
}

/** 仅自动执行无需迁移已有 Issue 的纯增量方案；未知预演契约按失败处理。 */
function assertSafePreview(value: unknown): void {
  const preview = value as { dry_run?: boolean; plan?: { required?: unknown; affected_issues?: unknown } } | null;
  if (preview?.dry_run !== true || !Array.isArray(preview.plan?.required)
      || preview.plan.required.length > 0 || preview.plan.affected_issues !== 0) {
    throw new Error("workflow 预演异常或涉及已有 Issue 迁移，禁止自动更新，请人工核对");
  }
}

export function reconcileWorkflowStatuses(wf: ManifestWorkflow, deps: WorkflowReconcileDeps): WorkflowReconcileOutcome {
  const fail = (reason: string): WorkflowReconcileOutcome => ({ status: "unknown", reason, created: [], unchanged: [], unmanaged: [] });
  try {
    // 1. CLI 版本门
    const v = workflowCliSupported(deps.versionOf());
    if (!v.version) return fail("multica 版本输出无法解析——workflow 状态 reconcile 需 multica ≥0.8.0，先执行 multica update");
    if (!v.supported) return fail(`multica ${v.version} 不支持 workflow 命令（需 ≥0.8.0）——执行 multica update 升级后重跑 provision`);

    const ref = wf.ref ?? "default";
    const statuses = wf.statuses ?? [];
    const CLI = deps.cliArgs ?? [];
    const getCmd = (): string[] => ["multica", ...CLI, "workflow", "get", ref, ...deps.wsArgs, "--output", "json"];

    // 2. 写前当次回读（零缓存）
    const remote = deps.runJsonFn(getCmd(), `workflow get ${ref}`) as { steps?: WorkflowStep[] };
    const remoteSteps = readWorkflowSteps(remote);
    const remoteKeys = new Set(remoteSteps.map((s) => s.status_key).filter((k): k is string => !!k));
    const manifestKeys = new Set(statuses.map((s) => s.key));
    const builtins = new Set<string>(BUILTIN_STATUS_KEYS);
    const unchanged = statuses.filter((s) => remoteKeys.has(s.key)).map((s) => `workflow/${s.key}`);
    const unmanaged = remoteSteps
      .filter((s) => s.status_key && !manifestKeys.has(s.status_key!) && !builtins.has(s.status_key!))
      .map((s) => `workflow/${s.status_key}（未受管）`);
    const missing = statuses.filter((s) => !remoteKeys.has(s.key));
    if (missing.length === 0) return { status: "ok", created: [], unchanged, unmanaged };

    const { merged, expectedOrder, fallbacks } = mergeWorkflowSteps(remoteSteps, missing);
    const created = [...missing.map((m) => `workflow/${m.key}`), ...fallbacks];
    if (deps.dryRun) return { status: "ok", created, unchanged, unmanaged };

    // 3. 写入：临时 steps 文件 → update --dry-run 预演（记 stderr）→ 真写；临时文件即删
    const dir = mkdtempSync(join(tmpdir(), "rondo-wf-steps-"));
    try {
      const file = join(dir, "steps.json");
      writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
      const preview = deps.runJsonFn(
        ["multica", ...CLI, "workflow", "update", ref, ...deps.wsArgs, "--steps-file", file, "--dry-run", "--output", "json"],
        "workflow update 迁移预演",
      );
      deps.log?.(`workflow update 迁移预演: ${JSON.stringify(preview)}`);
      assertSafePreview(preview);
      // 缩小并发窗口：预演后重新读取完整步骤（含 instructions/handler），变化即停止。
      // CLI 尚无 CAS/ETag 参数，最后一次读与写之间仍需运维避免并发编辑。
      const latest = readWorkflowSteps(deps.runJsonFn(getCmd(), "workflow get 写前并发校验"));
      if (JSON.stringify(latest) !== JSON.stringify(remoteSteps)) {
        return fail("workflow 在预演期间发生并发修改，已停止更新，请重新运行");
      }
      deps.runJsonFn(
        ["multica", ...CLI, "workflow", "update", ref, ...deps.wsArgs, "--steps-file", file, "--output", "json"],
        "workflow update",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    // 4. 写后回读强校验（R1）
    const after = deps.runJsonFn(getCmd(), "workflow get 写后回读校验") as { steps?: WorkflowStep[] };
    const rereadKeys = readWorkflowSteps(after)
      .map((s) => s.status_key).filter((k): k is string => !!k);
    const drift = verifyWorkflowSteps(expectedOrder, rereadKeys);
    if (drift) return fail(drift);
    return { status: "ok", created, unchanged, unmanaged };
  } catch (exc) {
    return fail(exc instanceof Error ? exc.message : String(exc));
  }
}
