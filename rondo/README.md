---
title: Rondo CLI 安装与使用
status: active
created_at: 2026-10-28
owner: winning\li_lei
---

# Rondo CLI：安装与使用

**rondo** 是面向 Multica 研发交付的确定性 CLI，提供交付校验、执行、事实管理及平台运维能力。本目录提供安装、配置与常用操作说明；分发包（`.tgz`）按版本单独构建或分发，不保证随 Git 仓库提供。完整参数见 [COMMANDS.md](COMMANDS.md)。
源码与分发包位于根仓 `rondo/`（包 `@winning/rondo`，命令 `rondo`）。

## 1. 分发包与版本

| 文件名格式 | npm 包 | 命令 |
| --- | --- | --- |
| `winning-rondo-<version>.tgz` | `@winning/rondo` | `rondo` |

版本以本目录的 [`package.json`](package.json) 为准；本页不维护固定版本号或安装包数量。旧包可留作回溯，安装时应明确指定版本。

## 2. 前置条件

- 推荐 Node.js 22+；具体兼容性以所选安装包及其依赖要求为准。
- npm 可执行，且 **能访问 npm registry 或内部镜像** —— tgz 的 `files` 白名单包含 `dist`、`README.md` 和 `COMMANDS.md`，
  **不打包第三方依赖**，安装时仍需从配置的 registry 拉取依赖。
  离线环境须先准备依赖缓存或私有仓库，或改用免依赖的 `rondo.exe`（SEA 单文件，见操作手册）。

## 3. 安装

先在分发目录确认实际存在的安装包，再明确指定版本（`npm install -g` 支持本地 tgz）：

```bash
cd rondo
ls winning-rondo-*.tgz

# 将 <version> 换成目录内实际存在的版本号
npm install -g ./winning-rondo-<version>.tgz
```

> 该包**未发布到公共 npm registry**，只能通过本目录的 tgz 安装；若已同步到私有仓库，可改用 `npm install -g @winning/rondo@<version>`。

## 4. 验证

```bash
rondo --version        # 本地版本信息（不访问 TFS）
rondo --help           # 命令总览
rondo doctor           # 只读环境检查
```

`rondo --version` 输出本地版本信息，无需连接 TFS；`--help` / `-h` 输出帮助并返回 0，不执行业务操作；`doctor` 的检查项和要求以当前安装版本的帮助与输出为准。

### 找不到命令

```bash
npm prefix -g               # Windows 示例：D:\UserApp\nvm\node_global
npm root -g                 # 全局 node_modules 实际位置
```

把 `npm prefix -g` 的输出目录加入用户 `PATH`（Windows：`D:\UserApp\nvm\node_global`），
**重新打开终端**后生效。nvm 切换 Node 版本会改变全局目录，切换后需重装或重新确认 PATH。

## 5. 运行期配置

### 5.1 TFS 连接（repo/pr/workitem 及 flow 内 TFS 调用）

全局安装包不含 `config/`，通常通过环境变量提供 TFS 连接信息；如使用外置配置文件，可设置 `TFS_CLI_CONFIG` 指向文件。凭证优先使用环境变量，禁止在命令行传递。

| 变量 | 必需性 | 说明 |
| --- | --- | --- |
| `TFS_PAT` | 必需 | 个人访问令牌，**禁止走命令行参数** |
| `TFS_SERVER_URL` | 推荐 | 完整 collection URL，如 `http://<host>:8080/tfs/<collection>` |
| `TFS_URL` | 替代 | TFS base URL（不含 collection），与 `TFS_COLLECTION` 搭配 |
| `TFS_COLLECTION` | 替代 | 集合名，默认 `WN_Data_Platform` |
| `TFS_PROJECT` | 可选 | 默认团队项目，可被 `--project` 覆盖 |
| `TFS_CLI_CONFIG` | 可选 | 外置 TFS 配置文件路径 |

### 5.2 workspace 组命令

`workspace` 组命令需要定位包含 `workspace-config/` 的配置根目录；Rondo 也支持 monorepo 中的 `projects/multica/workspace-config/` 布局。
如果无法从当前目录识别配置根，可显式指定：

```powershell
$env:MULTICA_REPO_ROOT = "D:/UserProgram/winning-platform-rondo"
```

在 Bash 中使用 `export MULTICA_REPO_ROOT=/path/to/monorepo`。

定位失败会返回 `exit 3`（UNKNOWN），不产生任何写入。

### 5.3 Multica 交付命令

交付命令使用当前 Multica Run 的 `MULTICA_WORKSPACE_ID`、`MULTICA_SERVER_URL`（可选 `MULTICA_CLI_PATH`）。仓库配置以当前 Project Resource 为准，Requirement 的修改授权以已批准 OpenSpec Scope 为准；后续交付消费已登记的 PR Facts。业务仓 `repo_id` / `repo_key` 为完整 Git/TFS 仓库名称。TFS Sync Agent 通过 `RONDO_PROJECT_TITLE` 在当前 Workspace 解析目标 Project；provision 按分组补齐缺失变量，允许人工配置且不覆盖已有值。


`workspace provision / sync` 和 `doctor` 可使用 `--profile <name>` 选择 Multica 连接配置（`doctor` 需同时提供 `--workspace-id`）。不要跨环境复用 Workspace Overlay。

## 6. 常用命令

以下为常见入口，全部参数以 [命令参考](COMMANDS.md) 为准：

```bash
# 查询 TFS 工作项
rondo workitem query --wiql "SELECT [System.Id] FROM workitems WHERE [System.AssignedTo] = @me"

# 预览 Workspace Skill 同步
rondo workspace sync --workspace <name> --dry-run

# 检查 Skill 同步差异（只读）
rondo workspace sync --workspace <name> --check

# 更新现有 Skill 内容
rondo workspace sync --workspace <name> [--skill <skill-name>]

# 新增 Skill 或修改 Agent 绑定时供给资源
rondo workspace provision --workspace <name>

# 检查指定 Workspace 的状态配置
rondo doctor --workspace-id <id> --profile <name>
```

OpenSpec 的版本要求及其他环境前提通过 `rondo doctor` 检查；需将特定检查作为验收条件时使用 `doctor --require`，未执行的检查不能视为通过。

## 7. 升级与卸载

测试环境升级前，先完成或结束仍持有不符合当前 `dev.publication` 契约的 Requirement Issue（回执须包含完整 `analysis_source` 和研发 `commit`）。新版不自动迁移旧回执，也不允许在 `in_review` 重新执行研发发布；新的测试 Issue 通过正常研发流程登记回执，不手工填造或删除交付事实以绕过检查。

```bash
# 升级：新版 tgz 落地后覆盖安装即可
npm install -g ./winning-rondo-<new-version>.tgz

# 卸载
npm uninstall -g @winning/rondo
```

## 8. 注意事项

1. **凭证不进包**：tgz 内不含任何 PAT / 配置文件；安装包交付程序及使用文档。
2. **全局安装不改变既有流水线调用**：现有 Skill 仍按配置里的 `node + dist/index.js 绝对路径` 调用，
   安装全局命令不等于配置已切换，切换需同步改配置。
3. **生产不用 `npm link`**：`npm link` 依赖源码目录，仅限开发机临时使用。
4. 重新构建分发包在根仓 `rondo/` 执行：`npm pack`（`prepack` 自动 `npm run build`），产物文件名形如
   `winning-rondo-<version>.tgz`，产物直接保留在 `rondo/` 目录；包内的 `README.md` 与 `COMMANDS.md` 和 `package.json` 同级。本页不记录每次发布的版本清单。

## 9. 相关文档

| 文档 | 说明 |
| --- | --- |
| [Rondo 命令参考](COMMANDS.md) | 命令组、参数、退出码与调用约束。 |
| [TFS CLI 安装与运行操作手册](../archive/docs-2026-11-18/tfs-cli-operations-guide.md) | 凭证配置、自部署服务器、排障全文（命令面已并入 rondo）。 |
| [Workspace 资产同步操作手册](../archive/docs-2026-11-18/workspace-sync-operations-guide.md) | `rondo workspace provision / sync` 日常运维。 |
| [Multica + OpenSpec 索引](../README.md) | 本目录上级索引与资产清单。 |
