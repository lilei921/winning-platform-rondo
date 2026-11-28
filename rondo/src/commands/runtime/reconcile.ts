import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { emitJson, markLeafExecuted } from "../../cli/output.js";
import { MulticaClient } from "../../clients/multica.js";
import { resolveMulticaRuntime } from "../../clients/runtime-context.js";

interface Change { agent: string; from: string | null; to: string }
interface Problem { agent?: string; reason: string; result: "FAIL" | "UNKNOWN" }
interface Result {
  result: "PASS" | "FAIL" | "UNKNOWN";
  changed: Change[];
  planned?: Change[];
  errors: Problem[];
  reason?: string;
}
type RecordValue = Record<string, unknown>;
type Client = Pick<MulticaClient, "run" | "ws">;

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function list(value: unknown, label: string): RecordValue[] {
  if (!Array.isArray(value) || !value.every(v => record(v) && text(v.id))) {
    throw new UnknownError(label + "不可确认");
  }
  return value;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 单次协调；Run 迁移、并发和恢复均由 Multica 原生负责。 */
export function reconcileRuntime(
  rawPolicy: string | undefined,
  createClient: () => Client,
  dryRun = false,
): Result {
  const changed: Change[] = [];
  const planned: Change[] = [];
  const errors: Problem[] = [];
  const finish = (message?: string): Result => ({
    result: errors.some(e => e.result === "UNKNOWN") ? "UNKNOWN" : errors.length ? "FAIL" : "PASS",
    changed,
    ...(dryRun ? { planned } : {}),
    errors,
    ...(message ? { reason: message } : {}),
  });
  const fail = (message: string, agent?: string) => errors.push({ result: "FAIL", reason: message, ...(agent ? { agent } : {}) });
  const unknown = (message: string, agent?: string) => errors.push({ result: "UNKNOWN", reason: message, ...(agent ? { agent } : {}) });

  if (!rawPolicy?.trim()) {
    fail("RONDO_RUNTIME_POLICY 未配置");
    return finish();
  }
  let policy: unknown;
  try { policy = JSON.parse(rawPolicy); }
  catch {
    fail("RONDO_RUNTIME_POLICY 不是合法 JSON");
    return finish();
  }
  if (!record(policy)) {
    fail("RONDO_RUNTIME_POLICY 必须为 JSON Object");
    return finish();
  }
  const entries = Object.entries(policy);
  if (!entries.length) return finish("主备策略为空，无需协调");

  // 先解析策略；单项错误不影响其他有效 Agent。
  const valid: { name: string; primary: string; fallback: string }[] = [];
  for (const [name, item] of entries) {
    if (name === "Vayne") {
      fail("Vayne 不参与自动改绑", name);
    } else if (!text(name) || !record(item) ||
      !text(item.primary_runtime_id) || !text(item.fallback_runtime_id) ||
      item.primary_runtime_id === item.fallback_runtime_id) {
      fail("主备策略必须包含两个不同的 Runtime ID", name);
    } else {
      valid.push({ name, primary: item.primary_runtime_id, fallback: item.fallback_runtime_id });
    }
  }
  if (!valid.length) return finish();

  let client: Client;
  let agents: RecordValue[];
  let runtimes: RecordValue[];
  try {
    client = createClient();
    runtimes = list(client.run(["runtime", "list", ...client.ws(), "--output", "json"], "读取 Runtime 列表", { transient: true }), "Runtime 列表");
    agents = list(client.run(["agent", "list", ...client.ws(), "--output", "json"], "读取 Agent 列表", { transient: true }), "Agent 列表");
    if (agents.some(a => !text(a.name))) throw new UnknownError("Agent 名称不可确认");
  } catch (error) {
    unknown(reason(error));
    return finish();
  }

  for (const { name, primary, fallback } of valid) {
    const matches = agents.filter(a => a.name === name && !a.archived_at && a.status !== "archived");
    if (matches.length !== 1) {
      unknown("Agent 不存在或不唯一", name);
      continue;
    }
    const agent = matches[0];
    const p = runtimes.filter(r => r.id === primary);
    const f = runtimes.filter(r => r.id === fallback);
    if (p.length !== 1 || f.length !== 1) {
      unknown("主备 Runtime 不存在、不可见或不唯一", name);
      continue;
    }
    const primaryRuntime = p[0], fallbackRuntime = f[0];
    // 主备 Provider 允许不同：策略只表达期望的 Runtime，不校验 Provider 组合。
    const target = primaryRuntime.status === "online" ? primary :
      primaryRuntime.status === "offline" && fallbackRuntime.status === "online" ? fallback : undefined;
    if (!target) {
      if (primaryRuntime.status === "offline" && fallbackRuntime.status === "offline") {
        fail("主备 Runtime 均离线", name);
      } else {
        unknown("Runtime 可用性不可确认", name);
      }
      continue;
    }
    const current = agent.runtime_id;
    if (current === target) continue;
    if (typeof current !== "string" && current !== null) {
      unknown("当前 Runtime 绑定不可确认", name);
      continue;
    }
    if (current) {
      // 允许跨 Provider 改绑；平台可能清空不兼容的模型配置，由管理员在策略侧评估。
      const bound = runtimes.filter(r => r.id === current);
      if (bound.length !== 1) {
        unknown("当前 Runtime 不可确认", name);
        continue;
      }
    }
    const change: Change = { agent: name, from: current || null, to: target };
    if (dryRun) {
      planned.push(change);
      continue;
    }

    // 成功响应已确认绑定时不额外读；响应不确定时只回读，不重复写。
    const confirmed = (value: unknown) =>
      record(value) && value.id === agent.id && value.runtime_id === target;
    let writeReason = "改绑响应未确认目标 Runtime";
    try {
      const updated = client.run(["agent", "update", ...client.ws(), String(agent.id), "--runtime-id", target, "--output", "json"], "改绑 Agent " + name);
      if (confirmed(updated)) {
        changed.push(change);
        continue;
      }
    } catch (error) {
      writeReason = reason(error);
    }
    try {
      const after = client.run(["agent", "get", String(agent.id), ...client.ws(), "--output", "json"], "核实 Agent " + name, { transient: true });
      if (confirmed(after)) {
        changed.push(change);
        continue;
      }
    } catch (error) {
      writeReason += "；回读失败：" + reason(error);
    }
    unknown(writeReason, name);
  }
  return finish();
}

export function registerRuntimeReconcile(group: Command): void {
  group.command("reconcile")
    .description("根据 Agent 主备策略自动协调 Runtime 绑定")
    .option("--dry-run", "只预览改绑计划，不写入")
    .action((opts: { dryRun?: boolean }) => {
      markLeafExecuted();
      const output = reconcileRuntime(
        process.env.RONDO_RUNTIME_POLICY,
        () => new MulticaClient(resolveMulticaRuntime()),
        opts.dryRun === true,
      );
      emitJson(output, output.result === "PASS" ? 0 : output.result === "FAIL" ? 2 : 3);
    });
}
