# OpenSpec 工件配置

## 配置

`--config` 使用本 Skill 下 `config/repo-registry.json` 的绝对路径。该文件由 `rondo workspace sync --workspace <name>` 按 Workspace 渲染，包含 `runtime.workspace_id` 和业务仓 `registry`。

## 读取方式

- **Requirement 远端模式**：不传 `--root-repo`。Rondo 从已批准的 `analysis.source` 获取根仓 URL、分支、Commit 与 Change 引用，并通过 TFS 读取和验证远端工件；需要有效的 TFS 连接配置。
- **本地 OpenSpec 模式**：在 Prepare、Writeback、Complete 三条命令中都附加 `--root-repo "<实际根仓绝对路径>"`。
- **独立 Bug**：无需根仓工件与 OpenSpec Archive，不传 `--root-repo`。

缺少必要配置、工件或批准事实时，以 Rondo 的 `FAIL` / `UNKNOWN` 结果停止；不自行补造来源或切换未经核验的版本。
