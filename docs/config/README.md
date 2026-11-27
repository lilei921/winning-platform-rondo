# 配置参考

## Project Resource 配置

Multica 当前 Project Resource 是仓库配置和业务归属线索的来源。当前可用仓库、初始版本、PR Target 及业务线索分别由 `resource_ref.url`、`resource_ref.ref`、`resource_ref.default_branch_hint`、顶层 `label` 表达。

- [project-resources.yaml](./project-resources.yaml)：供资源配置准备和 label 对齐参考，不是 Agent 或 Rondo CLI 的运行时仓库映射。
- [project-resources.yaml.example](./project-resources.yaml.example)：配置参考示例。

Agent 按需使用当前 Project 的原生上下文或 `multica project resource list <project-id> --output json`。业务仓标识为 URL 中解码后的完整仓库名称，实际工程行为以源码为准。已批准的 Requirement Repository Scope 由 OpenSpec `x-repositories` 保存。

Workspace 和 TFS 资源供给配置仍由各自配置维护。

## Runtime Policy 配置

[runtime-policy.json.example](./runtime-policy.json.example) 是 Vayne 的主备 Runtime 策略模板，仅供管理员配置参考，不是运行时配置来源。实际策略由各 Workspace 的 Vayne Agent Environment Variables 独立维护。

### 配置步骤

1. 使用 Multica 原生命令查询当前 Workspace 的 Runtime，按设备及 Provider 确认本机和服务器 Runtime ID：

   ```powershell
   multica runtime list --workspace-id <workspace-id> --output json |
       ConvertFrom-Json |
       Format-Table id, name, device_info, provider, status
   ```

2. 复制 JSON 模板，将占位符替换为实际 Runtime UUID。Key 为当前 Workspace 内的准确 Agent Name，每个 Agent 独立设置 `primary_runtime_id` 和 `fallback_runtime_id`；首版主备须为同一 Provider，且两个 Runtime ID 不同。未配置的 Agent 不参与协调，不配置 Vayne 自身。
3. 在 Multica 中将 Vayne 固定绑定到服务器 Runtime，设置 Max Concurrent Tasks 为 1，并新增 Agent Environment Variable：Key 为 `RONDO_RUNTIME_POLICY`，Value 为完整 JSON 对象的文本（无外层包装）。
4. 确认服务器安装支持该命令的 Rondo 版本，在 Vayne 的 Run 中执行预览：

   ```bash
   rondo runtime reconcile --dry-run
   ```

5. 按[黑灯计划](../../20-lights-out-plan.md)完成现网权限、原生 Run 迁移等 PoC，确认实际改绑符合预期后，再启用 Vayne 的 Autopilot Trigger。

### 日常维护

- 更换电脑或服务器时，更新对应 Agent 的主备 Runtime ID；正常上下班无需修改配置。
- 不再管理某个 Agent 时，删除对应 JSON 节点；清空策略可设置为 `{}`，暂停定时协调可禁用 Autopilot Trigger。
- 修改策略后由后续 Vayne Run 消费，无需重新发布 Rondo。删除策略或停用 Trigger 不会自动恢复现有 Runtime 绑定。
- 优先通过 Multica 界面修改单个环境变量。若使用 `multica agent env set`，须注意其整体替换 custom_env 的语义，保留其他环境变量。

实际配置只维护在 Multica，不将各 Workspace 的生产策略重复保存至仓库模板或供给配置。
