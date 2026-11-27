import type { RuntimeConfig } from "../../clients/config.js";
import { UnknownError } from "../../cli/errors.js";
import { resolveMulticaRuntime } from "../../clients/runtime-context.js";

/** Native Run identity, with explicit CLI/profile for terminal diagnostics. */
export function analysisRuntime(argv: string[], cli: string, workspaceId: string | null): RuntimeConfig {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new UnknownError(`${name} 缺值`);
    return value;
  };
  if (argv.includes("--registry-config")) throw new UnknownError("--registry-config 已退役");
  const currentWorkspace = process.env.MULTICA_WORKSPACE_ID?.trim();
  if (currentWorkspace) {
    if (workspaceId && currentWorkspace !== workspaceId) throw new UnknownError("当前 Multica Workspace 与 --workspace-id 不一致");
    if (argv.includes("--profile") || argv.includes("--multica")) throw new UnknownError("当前 Multica Run 不接受 CLI / Profile 覆盖");
    return resolveMulticaRuntime();
  }
  if (!workspaceId) throw new UnknownError("只读终端诊断需要 --workspace-id");
  return {
    multica_cli: arg("--multica") ?? cli,
    workspace_id: workspaceId ?? undefined,
    multica_server_url: process.env.MULTICA_SERVER_URL?.trim() || undefined,
    multica_profile: arg("--profile"),
  };
}
