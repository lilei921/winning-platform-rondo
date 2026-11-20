/** Workspace MCP 供给：仓内保存期望配置，平台保存连接；完整配置只写，不能声称回读无漂移。 */
import { UnknownError } from "../../cli/errors.js";

export interface McpAgent { name: string; mcp_servers?: string[]; mcp_phase?: "08-a" | "08-b"; }
export interface McpManifest { mcp_servers?: { name: string; template: string }[]; agents: McpAgent[]; }
export interface McpOverlay {
  mcp_phase?: "08-a" | "08-b";
  mcp_servers?: Record<string, { id?: string; connection_file?: string }>;
}
export interface McpSpec {
  name: string;
  connection_file: string;
  enabled_tools: string[];
  default_tools_approval_mode?: "approve";
  id?: string;
}
export interface McpDeps {
  cli: string[];
  workspaceId: string;
  dryRun: boolean;
  overlay: McpOverlay;
  created: string[];
  updated: string[];
  unchanged: string[];
  unmanaged: string[];
  allowMissingAgents?: boolean;
  run: (args: string[], input?: string) => unknown;
}
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const nameOk = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-z0-9-]*$/.test(v);
const idOk = (v: unknown): v is string => typeof v === "string" && /^[\w-]+$/.test(v);
// 连接文件限定在 connections 目录内，避免相对路径越界；不接受环境变量引用。
const fileOk = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9.-]*\.local\.json$/.test(v);

/** 模板只允许公开策略和凭据引用，禁止把连接内容混入 Git。 */
export function loadMcpSpecs(manifest: McpManifest, overlay: McpOverlay, readTemplate: (file: string) => unknown): McpSpec[] {
  if (overlay.mcp_phase !== undefined && !["08-a", "08-b"].includes(overlay.mcp_phase)) throw new UnknownError("mcp_phase 仅支持 08-a / 08-b");
  if (manifest.mcp_servers !== undefined && !Array.isArray(manifest.mcp_servers)) throw new UnknownError("mcp_servers 必须为数组");
  const names = new Set<string>();
  const specs = (manifest.mcp_servers ?? []).map(entry => {
    if (!record(entry) || !nameOk(entry.name) || names.has(entry.name)) throw new UnknownError("MCP 名称非法或重复");
    if (typeof entry.template !== "string" || !/^[a-z0-9-]+\.json$/.test(entry.template)) throw new UnknownError("MCP 模板必须为 mcp 目录内的 JSON 文件名");
    names.add(entry.name);
    let t: unknown;
    try { t = readTemplate(entry.template); } catch { throw new UnknownError(`MCP ${entry.name} 模板无法读取`); }
    if (!record(t) || Object.keys(t).some(k => !["connection_file", "enabled_tools", "default_tools_approval_mode"].includes(k))
        || !fileOk(t.connection_file) || !Array.isArray(t.enabled_tools) || t.enabled_tools.length === 0
        || t.enabled_tools.some(v => typeof v !== "string" || !/^\w+$/.test(v)) || new Set(t.enabled_tools).size !== t.enabled_tools.length) {
      throw new UnknownError(`MCP ${entry.name} 模板字段非法，必须声明连接文件及非空工具白名单`);
    }
    if (t.default_tools_approval_mode !== undefined && (t.default_tools_approval_mode !== "approve"
        || entry.name !== "remote-ripgrep" || JSON.stringify(t.enabled_tools) !== '["search"]')) {
      throw new UnknownError("自动批准兼容配置仅允许 remote-ripgrep 的 search");
    }
    return { name: entry.name, ...t } as McpSpec;
  });
  if (overlay.mcp_servers !== undefined) {
    if (!record(overlay.mcp_servers)) throw new UnknownError("overlay.mcp_servers 必须为对象");
    for (const [name, item] of Object.entries(overlay.mcp_servers)) {
      if (!names.has(name) || !record(item) || Object.keys(item).some(k => !["id", "connection_file"].includes(k))
          || (item.id !== undefined && !idOk(item.id)) || (item.connection_file !== undefined && !fileOk(item.connection_file))) {
        throw new UnknownError("overlay MCP 仅允许已登记名称、ID 与连接文件引用");
      }
      if (item.connection_file) specs.find(s => s.name === name)!.connection_file = item.connection_file;
    }
  }
  for (const agent of manifest.agents) {
    if (agent.mcp_phase !== undefined && !["08-a", "08-b"].includes(agent.mcp_phase)) throw new UnknownError(`Agent ${agent.name} MCP 阶段非法`);
    if (agent.mcp_servers !== undefined && (!Array.isArray(agent.mcp_servers)
        || agent.mcp_servers.some(name => !names.has(name)) || new Set(agent.mcp_servers).size !== agent.mcp_servers.length)) {
      throw new UnknownError(`Agent ${agent.name} MCP 引用非法或重复`);
    }
  }
  return specs;
}

/** 维护前从预先准备的文件读取完整连接；不从环境变量取值，也不覆盖工具策略。 */
export function mcpPayload(spec: McpSpec, readConnection: (file: string) => string): string {
  let raw: string;
  try { raw = readConnection(spec.connection_file); }
  catch { throw new UnknownError(`MCP ${spec.name} 连接文件无法读取：connections/${spec.connection_file}`); }
  if (!raw.trim()) throw new UnknownError(`MCP ${spec.name} 连接文件为空：connections/${spec.connection_file}`);
  let c: unknown;
  try { c = JSON.parse(raw); } catch { throw new UnknownError(`MCP ${spec.name} 连接配置不是合法 JSON（内容已隐藏）`); }
  try {
    if (!record(c) || Object.keys(c).some(k => !["url", "headers", "type"].includes(k)) || typeof c.url !== "string") throw new Error();
    const url = new URL(c.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    if (c.type !== undefined && !["http", "sse"].includes(c.type)) throw new Error();
    if (c.headers !== undefined && (!record(c.headers) || Object.entries(c.headers).some(([k, v]) => !/^[\w-]+$/.test(k) || typeof v !== "string" || /[\r\n]/.test(v)))) throw new Error();
  } catch { throw new UnknownError(`MCP ${spec.name} 连接配置字段非法（内容已隐藏）`); }
  return JSON.stringify({ ...(c as Record<string, unknown>), enabled_tools: spec.enabled_tools,
    ...(spec.default_tools_approval_mode ? { default_tools_approval_mode: spec.default_tools_approval_mode } : {}) });
}

/** 所有 CLI 异常统一脱敏，包含服务端可能回显的 URL / headers；写操作不自动重试。 */
function call(deps: McpDeps, args: string[], operation: string, input?: string): unknown {
  try { return deps.run([...deps.cli, ...args, "--output", "json"], input); }
  catch { throw new UnknownError(`MCP ${operation} 结果未知；请先回读平台后重试（原始输出已隐藏）`); }
}
function servers(deps: McpDeps): { id: string; name: string }[] {
  const result = call(deps, ["workspace", "mcp", "list", deps.workspaceId], "清单读取");
  if (!Array.isArray(result) || result.some(v => !record(v) || !idOk(v.id) || typeof v.name !== "string")
      || new Set(result.map(v => v.id)).size !== result.length) throw new UnknownError("MCP 服务清单响应非法");
  return result;
}

/** 先解析整批身份和凭据再写；保存已确认 ID，保留非受管对象。 */
export function reconcileMcpServers(specs: McpSpec[], deps: McpDeps, readConnection: (file: string) => string, updates: string[] = []): void {
  if (updates.some(n => !specs.some(s => s.name === n))) throw new UnknownError("--update-mcp 包含未登记 MCP");
  if (!specs.length) return;
  const remote = servers(deps);
  const plan = specs.map(spec => {
    const matches = remote.filter(r => r.name === spec.name);
    if (matches.length > 1) throw new UnknownError(`MCP ${spec.name} 名称重复，禁止自动接管`);
    const storedId = deps.overlay.mcp_servers?.[spec.name]?.id;
    if (storedId && matches[0]?.id !== storedId) throw new UnknownError(`MCP ${spec.name} 已保存 ID 与平台不一致，需核对归属`);
    spec.id = matches[0]?.id;
    const write = !spec.id || updates.includes(spec.name);
    return { spec, write, payload: write && !deps.dryRun ? mcpPayload(spec, readConnection) : undefined };
  });
  for (const r of remote) if (!specs.some(s => s.name === r.name)) deps.unmanaged.push(`mcp/${r.name}`);
  for (const { spec, write, payload } of plan) {
    if (write) {
      const existed = !!spec.id;
      if (!deps.dryRun) {
        call(deps, ["workspace", "mcp", existed ? "update" : "add", spec.id ?? spec.name, deps.workspaceId, "--server-config-stdin"], `${spec.name} ${existed ? "更新" : "创建"}`, payload);
        const reread = servers(deps).filter(r => r.name === spec.name);
        if (reread.length !== 1 || (existed && reread[0].id !== spec.id)) throw new UnknownError(`MCP ${spec.name} 写后身份回读失败`);
        spec.id = reread[0].id;
      }
      (existed ? deps.updated : deps.created).push(`mcp/${spec.name}`);
    } else deps.unchanged.push(`mcp/${spec.name} (identity only; configuration write-only)`);
    if (!deps.dryRun && spec.id) {
      deps.overlay.mcp_servers ??= {};
      deps.overlay.mcp_servers[spec.name] = { ...deps.overlay.mcp_servers[spec.name], id: spec.id };
    }
  }
}

function assignments(deps: McpDeps, agentId: string): { id: string; enabled: boolean }[] {
  const result = call(deps, ["agent", "mcp", "list", agentId, "--workspace-id", deps.workspaceId], "Agent 绑定读取");
  if (!Array.isArray(result)) throw new UnknownError("MCP 绑定清单响应非法");
  const mapped = result.map(v => ({ id: v?.mcp_server_id ?? v?.server_id ?? v?.id, enabled: v?.enabled }));
  if (mapped.some(v => !idOk(v.id) || typeof v.enabled !== "boolean") || new Set(mapped.map(v => v.id)).size !== mapped.length) throw new UnknownError("MCP 绑定清单字段非法");
  return mapped;
}

/** 只收敛显式受管绑定；08-B 未启用时不修改其 Agent，也不移除用户另行绑定的 MCP。 */
export function reconcileMcpBindings(agents: McpAgent[], agentIds: Record<string, string>, specs: McpSpec[], deps: McpDeps): void {
  const active = agents.filter(a => a.mcp_servers?.length && (a.mcp_phase !== "08-b" || deps.overlay.mcp_phase === "08-b"));
  for (const a of active) if (!agentIds[a.name] && !(deps.dryRun && deps.allowMissingAgents)) throw new UnknownError(`MCP 绑定缺少 Agent ${a.name}，请先完整 provision`);
  for (const a of active) {
    const agentId = agentIds[a.name];
    const current = agentId ? assignments(deps, agentId) : [];
    for (const name of a.mcp_servers!) {
      const spec = specs.find(s => s.name === name)!;
      const hit = current.find(r => r.id === spec.id);
      const label = `agent/${a.name}/mcp/${name}`;
      if (hit?.enabled) { deps.unchanged.push(label); continue; }
      if (!deps.dryRun) {
        if (!spec.id) throw new UnknownError(`MCP ${name} 缺少已确认 ID`);
        call(deps, ["agent", "mcp", hit ? "enable" : "add", agentId, spec.id, "--workspace-id", deps.workspaceId], `${label} 绑定`);
        if (!assignments(deps, agentId).some(r => r.id === spec.id && r.enabled)) throw new UnknownError(`MCP ${label} 写后绑定回读失败`);
      }
      (hit ? deps.updated : deps.created).push(label);
    }
  }
}
