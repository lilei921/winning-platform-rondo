import { UnknownError } from "../cli/errors.js";
import { MulticaClient } from "./multica.js";
import type { RuntimeConfig } from "./config.js";

export interface RuntimeContext extends RuntimeConfig {
  workspace_id: string;
  multica_server_url: string;
  rondo: string;
  delivery_squad_id: string;
}

/** 只从当前 Multica Run 获取身份；Squad 按默认名称从当前 Workspace 只读解析。 */
export function resolveRuntimeContext(): RuntimeContext {
  const workspaceId = process.env.MULTICA_WORKSPACE_ID?.trim();
  const serverUrl = process.env.MULTICA_SERVER_URL?.trim();
  if (!workspaceId || !serverUrl) {
    throw new UnknownError("缺少 MULTICA_WORKSPACE_ID 或 MULTICA_SERVER_URL");
  }

  const runtime = {
    multica_cli: "multica",
    multica_server_url: serverUrl,
    workspace_id: workspaceId,
  };
  const client = new MulticaClient(runtime);
  const squads = client.run(
    ["squad", "list", ...client.ws(), "--output", "json"],
    "查询 Delivery Squad",
    { transient: true },
  );
  if (!Array.isArray(squads)) {
    throw new UnknownError("Squad 列表不可确认");
  }
  const matches = squads.filter((s) =>
    s && typeof s.id === "string" && s.id &&
    s.name === "Delivery Squad" && !s.archived_at);
  if (matches.length !== 1) {
    throw new UnknownError("Delivery Squad 不存在或不唯一");
  }

  return { ...runtime, rondo: "rondo", delivery_squad_id: matches[0].id };
}
