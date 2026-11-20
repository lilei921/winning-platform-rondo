# Workspace 远程 MCP 维护

本目录保存三个远程 MCP 的公开配置模板。受管清单和绑定以 [provisioning.json](../skills/_shared/provisioning.json) 为准；执行与验收边界见 [08-A §2.2.1](../08a-remote-analysis-bug-fix-foundation.md#221-workspace-mcp-配置供给与维护)。

## 配置输入与保存

| 模板 | 预先准备的连接文件（本目录的 `connections/` 下） | 工具范围 |
| --- | --- | --- |
| `remote-codegraph.json` | `remote-codegraph.local.json` | `codegraph_explore` |
| `remote-filesystem.json` | `remote-filesystem.local.json` | 授权目录、目录列表、文本 / 多文件读取、文件信息与查找 |
| `remote-ripgrep.json` | `remote-ripgrep.local.json` | `search`，沿用限定自动批准兼容配置 |

**地址直接维护在连接文件的 `url` 字段，不从环境变量取值。** 在执行维护前，在 `mcps/connections/` 内准备对应的 `*.local.json`（已有文件不要覆盖），填写实际地址和所需认证信息。示例中的空地址不能用于正式维护；下列内容仅展示格式：

```json
{
  "type": "http",
  "url": "https://mcp.example.invalid/service",
  "headers": { "Authorization": "Bearer <secret>" }
}
```

`type` 可省略，提供时仅允许 `http` / `sse`；`headers` 可省略。输入仅允许这三个字段，不能覆盖模板的工具白名单 / 审批策略或引入本地 command。连接 URL 可能包含会话凭据，整体按秘密处理；不将真实对象写入 Git、命令参数、Skill 或日志。凭据应通过 headers 提供。

模板本身只允许 `connection_file`、`enabled_tools`、可选 `default_tools_approval_mode`。完整连接对象从文件读取后经 stdin 传给 Multica。`connections/*.local.json` 已加入 `.gitignore`，由维护人员保管和受控备份；示例及策略模板纳入 Git。平台完整配置不可导出，丢失文件后需从备份恢复或重新准备。

workspace overlay 的可选配置形态如下，`id` 由 provision 解析并保存；不同 workspace 可引用专用连接文件，文件均放在同一个 `connections/` 目录中：

```json
{
  "mcp_phase": "08-a",
  "mcp_servers": {
    "remote-codegraph": {
      "id": "<platform-server-id>",
      "connection_file": "team-codegraph.local.json"
    }
  }
}
```

未提供 `connection_file` 时使用模板默认文件名；未提供 `mcp_phase` 时使用 `08-a`。文件引用只接受 `*.local.json` 文件名，不接受绝对路径、上级目录或环境变量。不要从其他 workspace 复制 ID。存量唯一同名条目可直接接管；旧条目配置不可回读，接管成功不代表已应用本目录的新模板。

## 产品线分组（workspace_groups）

`provisioning.json` 的 `workspace_groups` 按产品线把 workspace 分为 `df` 与 `bi` 两组，组内除 `workspaces` 清单外还可覆盖 `project` / `workspace_repos` / `mcp_servers`；解析顺序为：workspace 所属组的 `mcp_servers` → 顶层 `mcp_servers`（未分组 workspace 与存量行为）。

- `df` 组：`mcp_servers` 显式使用 `remote-*.local.json`，与模板默认文件名一致（写出来只为固化「df 默认用现有连接」的意图）。
- `bi` 组：`mcp_servers` 指向 `bi-*.local.json` 专用连接文件，复用同一套公开模板。这些连接文件尚未准备；按现有规则，bi 组 workspace 正式维护时会因连接文件缺失立即停止，凭据备齐后由维护人员放入 `connections/`（gitignore 已覆盖），不进 Git。

组内条目的 `connection_file` 语义与 overlay 覆盖一致：只接受 `*.local.json` 文件名，省略时回落模板默认。

## 初始化与维护命令

从根工作区执行，使用包含本次改动的 Rondo 构建版本；实际 workspace 名称、profile 与 runtime 按目标环境填写。

```powershell
# 先构建本地 CLI（全局安装的旧 rondo 不包含新增能力）。
npm --prefix rondo run build

# 新 workspace 完整初始化；运行前填写三个连接文件的 url / headers。
node rondo/dist/index.js workspace provision --workspace pilot --slug pilot --create-workspace --runtime-id <runtime-id>

# 已有 workspace 只维护 MCP 与绑定，保留其他平台资产。
node rondo/dist/index.js workspace provision --workspace pilot --mcp-only --dry-run
node rondo/dist/index.js workspace provision --workspace pilot --mcp-only

# 只读检查公开身份、绑定与启用状态，不验证连接内容或连通性。
node rondo/dist/index.js workspace provision --workspace pilot --mcp-only --check

# 显式替换完整配置：先准备该 MCP 的完整连接输入，再执行更新。
node rondo/dist/index.js workspace provision --workspace pilot --mcp-only --update-mcp remote-ripgrep

# 08-B 部署时追加 Analyst / Engineer 绑定，并保存阶段。
node rondo/dist/index.js workspace provision --workspace pilot --mcp-only --mcp-phase 08-b
```

`--mcp-only` 仅用于已有 workspace 和 Agent，不接受 `--create-workspace`。新 workspace 仍需按原供给流程具备可用 runtime；无 runtime 时保存已创建 workspace 身份后停止。`--check` 不接受 `--update-mcp` 或创建操作。省略 `--mcp-only` 时检查 / 供给还覆盖原有平台对象，依赖原有 runtime 和资产前置条件。

阶段参数只决定本次需要供给的绑定；改回 `08-a` 不移除已有 08-B 绑定。需要撤销绑定时另行明确操作，不能将其当成发布回滚开关。

## 结果与恢复

- `0`：本次供给或检查完成；预演不表示已经部署。
- `2`：`--check` 发现缺失条目或绑定漂移；不会自动修复。
- `3`：配置、身份、回读或平台调用未知；已确认 ID 仍保存，先回读对账再重入。
- `64`：参数用法错误。

正式维护（包括已有工作区重入、绑定修复、显式更新）在访问平台前读取并校验全部受管 MCP 的连接文件，缺失、空地址或非法内容立即停止。本次调用缓存文件内容，预检与写入使用相同配置，不回退环境变量。`--dry-run` / `--check` 仅预演或检查公开元数据，不要求连接文件，也不证明本地地址已经准备好。`--update-mcp` 对已存在条目执行替换，对缺失条目执行创建；遇到已登记 ID 不匹配时停止。

输出中的 `mcp_configuration=WRITE_ONLY_NOT_VERIFIED` 表示平台无法回读完整配置，`mcp_runtime=NOT_RUN` 表示尚未从真实 Task 验证工具调用。正式切换前应执行新 Task 的三 MCP 正常访问及授权边界验收，不能只依据退出码 `0`。

本次已完成本地实现和验证，并从本机现有 Codex 配置填充三个本地连接文件（地址与对应认证信息）。这些 `*.local.json` 文件不纳入 Git；未写入或修改任何真实 workspace。其他机器需自行准备连接文件。
