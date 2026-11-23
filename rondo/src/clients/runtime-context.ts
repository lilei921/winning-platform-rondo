import { UnknownError } from "../cli/errors.js";
import { MulticaClient } from "./multica.js";
import type { RuntimeConfig } from "./config.js";

export interface RuntimeContext extends RuntimeConfig {
  workspace_id: string;
  multica_server_url: string;
  rondo: string;
  delivery_squad_id: string;
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
