/**
 * workflow-reconcile 单测（workspace-workflow-status-provisioning-plan M4）。
 *
 * 依赖注入 fake runJsonFn / versionOf，零真实进程。用例对齐方案 §M4 用例表：
 *  1. 远端已全量具备（wn_df_1029 蓝本）→ 全 unchanged，零写调用；
 *  2. 缺 2 个状态 → 合并顺序正确（锚点插入），update 恰好 1 次，写后回读 PASS；
 *  3. 锚点 after 不存在 → 降级插到 done 前并在输出注明；
 *  4. 远端多出状态 → unmanaged 列明，不删不写；
 *  5. --dry-run → 只回读 + diff 输出，零写；
 *  6. multica 0.7.0（无 workflow 命令）→ UNKNOWN 且提示升级；
 *  7. 写后回读 key 与 manifest 不符（R1 派生漂移）→ UNKNOWN；
 *  8. 无 name/category 的条目 → status_key 引用形态（内建键路径）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  mergeWorkflowSteps,
  reconcileWorkflowStatuses,
  verifyWorkflowSteps,
  workflowCliSupported,
  type ManifestWorkflowStatus,
  type WorkflowReconcileDeps,
  type WorkflowStep,
} from "./workflow-reconcile.js";

const WS = ["--workspace-id", "ws-1"];

const BLUEPRINT: WorkflowStep[] = [
  "backlog", "todo", "in_progress", "analysis_review", "in_review", "unsupported", "blocked", "done", "cancelled",
].map((k) => ({ status_key: k, handler: { type: "none" }, instructions: "" }));

const MANIFEST_STATUSES: ManifestWorkflowStatus[] = [
  { key: "analysis_review", name: "Analysis Review", category: "started", after: "in_progress" },
  { key: "unsupported", name: "Unsupported", category: "cancelled", after: "in_review" },
];

test("异常或重复的远端 steps 必须停止，不能按空工作流覆盖", () => {
  for (const remote of [{}, { steps: null }, { steps: [] }, { steps: [{}] }, { steps: [{ status_key: "todo" }, { status_key: "todo" }] }]) {
    const calls: string[][] = [];
    const result = reconcileWorkflowStatuses({ statuses: MANIFEST_STATUSES }, {
      dryRun: false, wsArgs: WS, versionOf: () => "0.8.1",
      runJsonFn: cmd => { calls.push(cmd); return remote; },
    });
    assert.equal(result.status, "unknown");
    assert.ok(calls.every(cmd => !cmd.includes("update")));
  }
});

test("预演要求迁移或无法解释预演时禁止真实更新", () => {
  for (const preview of [{}, { dry_run: true, plan: { required: ["todo"], affected_issues: 1, unchanged: [] } }]) {
    const calls: string[][] = [];
    const result = reconcileWorkflowStatuses({ statuses: MANIFEST_STATUSES }, {
      dryRun: false, wsArgs: WS, versionOf: () => "0.8.1",
      runJsonFn: cmd => { calls.push(cmd); return cmd.includes("get") ? { steps: [{ status_key: "todo" }] } : preview; },
    });
    assert.equal(result.status, "unknown");
    assert.ok(calls.every(cmd => !cmd.includes("update") || cmd.includes("--dry-run")));
  }
});

test("预演期间工作流发生变化时停止，保留远端并发编辑", () => {
  let reads = 0;
  const calls: string[][] = [];
  const result = reconcileWorkflowStatuses({ statuses: MANIFEST_STATUSES }, {
    dryRun: false, wsArgs: WS, versionOf: () => "0.8.1",
    runJsonFn: cmd => {
      calls.push(cmd);
      if (cmd.includes("get")) return { steps: [{ status_key: "todo", instructions: ++reads === 1 ? "old" : "edited" }] };
      return { dry_run: true, plan: { required: [], affected_issues: 0, unchanged: [] } };
    },
  });
  assert.equal(result.status, "unknown");
  assert.match(result.reason!, /并发/);
  assert.ok(calls.every(cmd => !cmd.includes("update") || cmd.includes("--dry-run")));
});

interface FakeCli {
  calls: string[][];
  updates: string[][];
  stepsFileContents: string[];
}

/** fake runJsonFn：get 返回 remote（update 后切换为 afterUpdate），update 记录调用。 */
function makeDeps(remote: WorkflowStep[], opts?: {
  dryRun?: boolean;
  version?: string;
  afterUpdate?: WorkflowStep[];
}) {
  const fake: FakeCli = { calls: [], updates: [], stepsFileContents: [] };
  let updated = false;
  const deps: WorkflowReconcileDeps = {
    dryRun: opts?.dryRun ?? false,
    wsArgs: WS,
    versionOf: () => opts?.version ?? "multica 0.8.1 (commit: abc, built: 2026-11-06)",
    log: () => {},
    runJsonFn: (cmd: string[], _what: string): unknown => {
      fake.calls.push(cmd);
      if (cmd.includes("get")) {
        return { steps: updated ? (opts?.afterUpdate ?? remote) : remote };
      }
      if (cmd.includes("update") && !cmd.includes("--dry-run")) {
        updated = true;
        fake.updates.push(cmd);
        const fileIdx = cmd.indexOf("--steps-file");
        fake.stepsFileContents.push(readFileSync(cmd[fileIdx + 1], "utf8"));
        return {};
      }
      return { dry_run: true, plan: { affected_issues: 0, required: [], unchanged: [] } };
    },
  };
  return { fake, deps };
}

test("1. 远端已全量具备（wn_df_1029 蓝本）→ 全 unchanged，零写调用", () => {
  const { fake, deps } = makeDeps(BLUEPRINT);
  const r = reconcileWorkflowStatuses({ ref: "default", statuses: MANIFEST_STATUSES }, deps);
  assert.equal(r.status, "ok");
  assert.deepEqual(r.created, []);
  assert.deepEqual(r.unchanged, ["workflow/analysis_review", "workflow/unsupported"]);
  assert.deepEqual(r.unmanaged, []);
  assert.equal(fake.updates.length, 0);
  assert.equal(fake.calls.filter((c) => c.includes("get")).length, 1);
});

test("2. 缺 2 个状态 → 锚点插入合并，update 恰好 1 次，写后回读 PASS", () => {
  const remote = BLUEPRINT.filter((s) => !["analysis_review", "unsupported"].includes(s.status_key!));
  const afterUpdate: WorkflowStep[] = [
    "backlog", "todo", "in_progress", "analysis_review", "in_review", "unsupported", "blocked", "done", "cancelled",
  ].map((k) => ({ status_key: k }));
  const { fake, deps } = makeDeps(remote, { afterUpdate });
  const r = reconcileWorkflowStatuses({ ref: "default", statuses: MANIFEST_STATUSES }, deps);
  assert.equal(r.status, "ok", r.reason);
  assert.deepEqual(r.created, ["workflow/analysis_review", "workflow/unsupported"]);
  assert.equal(fake.updates.length, 1);
  // 预演 dry-run 先于真写
  const updateCalls = fake.calls.filter((c) => c.includes("update"));
  assert.equal(updateCalls.length, 2);
  assert.ok(updateCalls[0].includes("--dry-run"));
  // 合并 steps：远端字段原样保留 + new_status 按锚点插入
  const merged = JSON.parse(fake.stepsFileContents[0]) as WorkflowStep[];
  assert.deepEqual(merged.map((s) => s.status_key ?? `new:${s.new_status?.name}`), [
    "backlog", "todo", "in_progress", "new:Analysis Review", "in_review", "new:Unsupported", "blocked", "done", "cancelled",
  ]);
  assert.deepEqual(merged[0].handler, { type: "none" }, "远端 step 字段必须原样保留");
  assert.deepEqual((merged[3].new_status!), { name: "Analysis Review", category: "started" });
  // 临时文件已清理
  const fileIdx = fake.updates[0].indexOf("--steps-file");
  assert.equal(existsSync(fake.updates[0][fileIdx + 1]), false);
});

test("3. 锚点 after 不存在 → 降级插到 done 前并注明", () => {
  const remote = BLUEPRINT.filter((s) => !["analysis_review", "unsupported", "in_review"].includes(s.status_key!));
  // analysis_review 锚点 in_progress 命中；unsupported 锚点 in_review 缺失 → 降级插到 done 前（blocked 之后）
  const afterUpdate: WorkflowStep[] = [
    "backlog", "todo", "in_progress", "analysis_review", "blocked", "unsupported", "done", "cancelled",
  ].map((k) => ({ status_key: k }));
  const { deps } = makeDeps(remote, { afterUpdate });
  const r = reconcileWorkflowStatuses({ ref: "default", statuses: MANIFEST_STATUSES }, deps);
  assert.equal(r.status, "ok", r.reason);
  assert.ok(r.created.some((c) => c.includes("锚点 in_review 不存在") && c.includes("降级")), r.created.join(";"));
});

test("4. 远端多出未受管状态 → unmanaged 列明，不删不写", () => {
  const remote = [...BLUEPRINT.slice(0, 8), { status_key: "qa_hold" }, ...BLUEPRINT.slice(8)];
  const { fake, deps } = makeDeps(remote);
  const r = reconcileWorkflowStatuses({ ref: "default", statuses: MANIFEST_STATUSES }, deps);
  assert.equal(r.status, "ok");
  assert.deepEqual(r.unmanaged, ["workflow/qa_hold（未受管）"]);
  assert.equal(fake.updates.length, 0);
});

test("5. --dry-run → 只回读 + diff 输出，零写", () => {
  const remote = BLUEPRINT.filter((s) => !["analysis_review", "unsupported"].includes(s.status_key!));
  const { fake, deps } = makeDeps(remote, { dryRun: true });
  const r = reconcileWorkflowStatuses({ ref: "default", statuses: MANIFEST_STATUSES }, deps);
  assert.equal(r.status, "ok");
  assert.deepEqual(r.created, ["workflow/analysis_review", "workflow/unsupported"]);
  assert.equal(fake.updates.length, 0);
  assert.equal(fake.calls.filter((c) => c.includes("get")).length, 1);
});

test("6. multica 0.7.0 → UNKNOWN 且提示升级，零平台调用", () => {
  const { fake, deps } = makeDeps(BLUEPRINT, { version: "multica 0.7.0 (commit: dbdbb2991)" });
  const r = reconcileWorkflowStatuses({ ref: "default", statuses: MANIFEST_STATUSES }, deps);
  assert.equal(r.status, "unknown");
  assert.match(r.reason!, /0\.7\.0/);
  assert.match(r.reason!, /multica update/);
  assert.equal(fake.calls.length, 0);
});

test("7. 写后回读 key 派生漂移（R1）→ UNKNOWN 并列出实际键", () => {
  const remote = BLUEPRINT.filter((s) => !["analysis_review", "unsupported"].includes(s.status_key!));
  // 平台把 "Analysis Review" 派生成 analysis-review（连字符而非下划线）
  const afterUpdate: WorkflowStep[] = [
    "backlog", "todo", "in_progress", "analysis-review", "in_review", "unsupported", "blocked", "done", "cancelled",
  ].map((k) => ({ status_key: k }));
  const { deps } = makeDeps(remote, { afterUpdate });
  const r = reconcileWorkflowStatuses({ ref: "default", statuses: MANIFEST_STATUSES }, deps);
  assert.equal(r.status, "unknown");
  assert.match(r.reason!, /写后回读校验失败/);
  assert.match(r.reason!, /analysis-review/);
});

test("9. cliArgs（--profile 等全局参数）透传到每次 multica 调用", () => {
  const remote = BLUEPRINT.filter((s) => s.status_key !== "analysis_review");
  const afterUpdate = BLUEPRINT.map((s) => ({ status_key: s.status_key }));
  const { fake, deps } = makeDeps(remote, { afterUpdate });
  deps.cliArgs = ["--profile", "97host"];
  const r = reconcileWorkflowStatuses({ ref: "default", statuses: MANIFEST_STATUSES.slice(0, 1) }, deps);
  assert.equal(r.status, "ok", r.reason);
  assert.ok(fake.calls.length > 0);
  for (const cmd of fake.calls) {
    assert.deepEqual(cmd.slice(0, 3), ["multica", "--profile", "97host"], `调用未带 cliArgs: ${cmd.join(" ")}`);
  }
});

test("8. 无 name/category 的条目 → status_key 引用形态；版本解析与回读校验纯函数", () => {
  const { merged } = mergeWorkflowSteps(
    [{ status_key: "todo" }, { status_key: "done" }],
    [{ key: "in_review", after: "todo" }],
  );
  assert.deepEqual(merged, [{ status_key: "todo" }, { status_key: "in_review" }, { status_key: "done" }]);

  assert.deepEqual(workflowCliSupported("multica 0.8.0 (commit: x)"), { supported: true, version: "0.8.0" });
  assert.deepEqual(workflowCliSupported("multica 1.0.0"), { supported: true, version: "1.0.0" });
  assert.deepEqual(workflowCliSupported("multica 0.7.9"), { supported: false, version: "0.7.9" });
  assert.deepEqual(workflowCliSupported("garbage"), { supported: false, version: null });

  assert.equal(verifyWorkflowSteps(["a", "b"], ["x", "a", "b", "y"]), null);
  assert.match(verifyWorkflowSteps(["a", "b"], ["b", "a"])!, /写后回读校验失败/);
});
