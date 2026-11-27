import type { RuntimeConfig } from "../../clients/config.js";
import { UnknownError } from "../../cli/errors.js";

/** Native Run identity, with explicit CLI/profile for terminal diagnostics. */
export function analysisRuntime(argv: string[], cli: string, workspaceId: string | null): RuntimeConfig {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new UnknownError(`${name} 缺值`);
    return value;
  };
  const currentWorkspace = process.env.MULTICA_WORKSPACE_ID?.trim();
  if (currentWorkspace && currentWorkspace !== workspaceId) throw new UnknownError("当前 Multica Workspace 与 --workspace-id 不一致");
  return {
    multica_cli: arg("--multica") ?? (process.env.MULTICA_CLI_PATH?.trim() || cli),
    workspace_id: workspaceId ?? undefined,
    multica_server_url: process.env.MULTICA_SERVER_URL?.trim() || undefined,
    multica_profile: arg("--profile"),
  };
}
