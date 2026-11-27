import { readFileSync } from "node:fs";
import { UnknownError } from "../cli/errors.js";
import { logLine } from "../cli/output.js";
import { MulticaClient } from "./multica.js";
import type { RuntimeConfig } from "./config.js";

export interface RuntimeContext extends RuntimeConfig {
  workspace_id: string;
  multica_server_url: string;
  rondo: string;
  delivery_squad_id: string;
}

/** 补齐平台 Task 环境；是否需要 Task 身份由具体命令判断。 */
export function hydrateMulticaTaskEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const keys = ["MULTICA_TASK_ID", "MULTICA_TASK_CONFIG_ROOT", "MULTICA_TASK_SLOT", "MULTICA_TOKEN"];
  const missing = keys.filter(key => !env[key]?.trim());
  if (!env.MULTICA_TASK_ENV_FILE || !missing.length) return;
  let record;
  try {
    record = JSON.parse(readFileSync(env.MULTICA_TASK_ENV_FILE, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    logLine("[rondo] 无法读取 Task 环境文件，保留现有环境");
    return;
  }
  if (record?.active !== true || !record.env || typeof record.env !== "object" || Array.isArray(record.env)) return;
  const taskId = record.env.MULTICA_TASK_ID;
  if (typeof taskId !== "string" || !taskId.trim() || taskId.includes("\0")) return;
  if (env.MULTICA_TASK_ID?.trim() && env.MULTICA_TASK_ID !== taskId) {
    logLine("[rondo] Task 环境文件身份与当前 Task 不一致，保留现有环境");
    return;
  }
  for (const key of missing) {
    const value = record.env[key];
    if (typeof value === "string" && value.trim() && !value.includes("\0")) env[key] = value;
    else if (key === "MULTICA_TASK_SLOT" && typeof value === "number" && Number.isFinite(value)) env[key] = String(value);
  }
}

/** 当前 Run 的最小运行身份，不查 Squad 或读取 Registry。 */
export interface MulticaRuntime {
  multica_cli: string;
  multica_server_url: string;
  workspace_id: string;
}

export function resolveMulticaRuntime(): MulticaRuntime {
  const workspaceId = process.env.MULTICA_WORKSPACE_ID?.trim();
  const serverUrl = process.env.MULTICA_SERVER_URL?.trim();
  if (!workspaceId || !serverUrl) {
    throw new UnknownError("缺少 MULTICA_WORKSPACE_ID 或 MULTICA_SERVER_URL");
  }
  return {
    multica_cli: process.env.MULTICA_CLI_PATH?.trim() || "multica",
    multica_server_url: serverUrl,
    workspace_id: workspaceId,
  };
}

/** 保持 runtime get-context 的 Delivery Squad 输出契约。 */
export function resolveRuntimeContext(): RuntimeContext {
  const runtime = resolveMulticaRuntime();
  const client = new MulticaClient(runtime);
  const squads = client.run(
    ["squad", "list", ...client.ws(), "--output", "json"],
    "查询 Delivery Squad",
    { transient: true },
  );
  if (!Array.isArray(squads) || squads.some((s) =>
    !s || typeof s !== "object" || Array.isArray(s) ||
    typeof s.id !== "string" || !s.id ||
    typeof s.name !== "string")) {
    throw new UnknownError("Squad 列表不可确认");
  }
  const matches = squads.filter((s) =>
    s.name === "Delivery Squad" && !s.archived_at);
  if (matches.length !== 1) {
    throw new UnknownError("Delivery Squad 不存在或不唯一");
  }

  return { ...runtime, rondo: "rondo", delivery_squad_id: matches[0].id };
}
