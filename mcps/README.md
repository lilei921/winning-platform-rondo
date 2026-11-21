# MCP 配置

本目录维护 Multica Workspace 的远程 MCP 模板与连接文件。MCP 对象、Agent 绑定、Workspace 分组及 Overlay 的受管来源是 [workspace-config/provisioning.json](../workspace-config/provisioning.json) 和 [workspace-config/workspaces/](../workspace-config/workspaces/)；本目录不重复维护绑定清单。

## 目录与模板

| 模板 | 功能 | 默认连接文件（`connections/`） |
| --- | --- | --- |
| [remote-codegraph.json](remote-codegraph.json) | `codegraph_explore`：代码关系探索 | `remote-codegraph.local.json` |
| [remote-filesystem.json](remote-filesystem.json) | 授权路径内的目录、文件读取与查找 | `remote-filesystem.local.json` |
| [remote-ripgrep.json](remote-ripgrep.json) | `search`：代码文本搜索 | `remote-ripgrep.local.json` |

模板定义 `enabled_tools` 及可选审批策略；连接文件提供传输地址与认证配置。不同 Workspace 可通过 Overlay 或 `workspace_groups` 选用不同的 `connection_file`：当前 manifest 中 `df` 使用 `remote-*.local.json`，`bi` 使用 `bi-*.local.json`。

## 连接文件

在 `mcps/connections/` 中为实际环境准备连接文件，支持以下字段：

```json
{
  "type": "http",
  "url": "https://mcp.example.invalid/service",
  "headers": { "Authorization": "Bearer <token>" }
}
```

`type` 可省略（如提供仅支持 `http` / `sse`），`headers` 可省略。只允许连接字段 `type`、`url`、`headers`，不要通过连接文件覆盖工具白名单或审批规则。URL 和 headers 可能携带凭据，不能公开或写入日志；正式发布前确认连接地址与认证有效。

**安全注意：** `.gitignore` 已忽略 `mcps/connections/*.local.json`，但截至本次核查，仓库中已有 6 个此类文件被 Git 跟踪，并包含认证字段。忽略规则不能取消已有跟踪；应单独处理停止跟踪、历史暴露评估及凭据轮换。不要继续提交真实连接凭据。

## 维护命令

以下命令从仓库根目录执行，示例 Workspace 名称需替换为实际值：

```bash
# 使用当前源码构建 CLI
npm --prefix rondo run build

# 预演、更新和检查已有 Workspace 的 MCP
node rondo/dist/index.js workspace provision --workspace <name> --mcp-only --dry-run
node rondo/dist/index.js workspace provision --workspace <name> --mcp-only
node rondo/dist/index.js workspace provision --workspace <name> --mcp-only --check

# 明确需要替换远端 MCP 配置时
node rondo/dist/index.js workspace provision --workspace <name> --mcp-only --update-mcp remote-ripgrep

# 需要为 Analyst / Engineer 配置 08-B MCP 绑定时
node rondo/dist/index.js workspace provision --workspace <name> --mcp-only --mcp-phase 08-b
```

新建 Workspace 需使用完整 `workspace provision` 流程；`--mcp-only` 只适用于现有 Workspace。正式供给前准备相应连接文件；`--dry-run` 和 `--check` 不验证实际 MCP 连通性。更完整的参数见 [Rondo 命令说明](../rondo/COMMANDS.md)。

## 验证与恢复

- `--check` 只能核实公开的 MCP 身份和绑定，不能证明完整连接配置或工具可用。
- `--update-mcp` 会更新指定 MCP 的远端配置；运行前先确认连接文件和目标对象，异常时回读后再重试。
- 平台无法完整回读连接内容时，不能将 Provision 成功等同于配置验收；需要在真实 Task 中验证各 MCP 的可访问性与授权范围。
- 修改 `mcp_phase` 不会自动删除之前的 Agent 绑定；不把阶段切换当作回滚机制。
