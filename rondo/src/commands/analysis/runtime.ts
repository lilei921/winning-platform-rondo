import { loadConfig, type BaseRegistryConfig, type RuntimeConfig } from "../../clients/config.js";
import { UnknownError } from "../../cli/errors.js";

/** Analysis 三个步骤共用配置身份；在读取或写入 Issue 之前验证工作区和环境。 */
export function analysisRuntime(argv: string[], cli: string, workspaceId: string | null): RuntimeConfig {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new UnknownError(`${name} 缺值`);
    return value;
  };
  const path = arg("--registry-config");
  const cfg = path ? loadConfig<BaseRegistryConfig>(path, { requireRegistry: false }).runtime : undefined;
  if (cfg && cfg.workspace_id !== workspaceId) throw new UnknownError("Analysis Registry 与 --workspace-id 不一致");
  const profile = arg("--profile");
  if ((cfg?.multica_server_url || cfg?.multica_profile) && profile && profile !== cfg.multica_profile) {
    throw new UnknownError("--profile 与 Analysis Registry 环境不一致");
  }
  return {
    ...cfg,
    multica_cli: arg("--multica") ?? cfg?.multica_cli ?? cli,
    workspace_id: workspaceId ?? undefined,
    multica_profile: profile ?? cfg?.multica_profile,
  };
}
