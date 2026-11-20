---
title: Multica 工具分发包安装说明
version: 1.2.28
status: active
created_at: 2026-10-28
updated_at: 2026-11-20
owner: winning\li_lei
---

# tools —— Multica 工具分发包安装说明

本目录存放 Multica 统一 CLI **rondo** 的 **npm pack 产物（`.tgz`）**，用于不依赖源码目录、按明确版本做全局安装。
源码与详细命令契约在根仓 `tools/rondo/`（包 `@winning/rondo`，命令 `rondo`）。

## 1. 分发包与版本

| 文件名格式 | npm 包 | 命令 |
| --- | --- | --- |
| `winning-rondo-<version>.tgz` | `@winning/rondo` | `rondo` |

版本取自 `tools/rondo/package.json`。旧版本包保留，安装时必须明确选择版本，不要用通配符安装。

## 2. 前置条件

- 推荐 Node.js 22+（依赖中的 `commander@14`、`marked@17` 均要求 Node.js 20+）。
- npm 可执行，且 **能访问 npm registry 或内部镜像** —— tgz 的 `files` 白名单只含 `dist`，
  **不打包第三方依赖**（`commander`、`execa`、`azure-devops-node-api`、`marked`），安装时仍需联网拉取。
  离线环境须先准备依赖缓存或私有仓库，或改用免依赖的 `rondo.exe`（SEA 单文件，见操作手册）。

## 3. 安装

在本目录下执行（相对路径即可，`npm install -g` 支持本地 tgz）：

```bash
cd projects/multica/tools

# 将 <version> 换成目录内实际存在的版本号
npm install -g ./winning-rondo-<version>.tgz
```

> 该包**未发布到公共 npm registry**，只能通过本目录的 tgz 安装；若已同步到私有仓库，可改用 `npm install -g @winning/rondo@<version>`。

## 4. 验证

当前源码重新构建并安装后，Rondo 的 Metadata 写入命令日志仅显示 Issue、key、参数结构和 value 字节数，不回显正文；`SKILL_FLOW_TRACE=1` 同样采用该摘要。实际 CLI 参数、JSON 返回、Metadata 持久化和 Gate 校验保持完整。需要复核某项事实时按 Issue / key 读取，不依赖日志还原证据；旧安装包不会随源码修改自动更新。

```bash
rondo --version        # JSON 输出:name/version/node/sea
```

`rondo --version` 仅输出本地版本信息，无需连接 TFS；无参数时打印命令总览。

### 找不到命令

```bash
npm prefix -g               # Windows 示例：D:\UserApp\nvm\node_global
npm root -g                 # 全局 node_modules 实际位置
```

把 `npm prefix -g` 的输出目录加入用户 `PATH`（Windows：`D:\UserApp\nvm\node_global`），
**重新打开终端**后生效。nvm 切换 Node 版本会改变全局目录，切换后需重装或重新确认 PATH。

## 5. 运行期配置

### 5.1 TFS 连接（query/repo/branch/pr/workitem 及 flow 内 TFS 调用）

全局安装后包内不含 `config/`（被 `files` 排除），**必须使用环境变量**：

| 变量 | 必需性 | 说明 |
| --- | --- | --- |
| `TFS_PAT` | 必需 | 个人访问令牌，**禁止走命令行参数** |
| `TFS_SERVER_URL` | 推荐 | 完整 collection URL，如 `http://<host>:8080/tfs/<collection>` |
| `TFS_URL` | 替代 | TFS base URL（不含 collection），与 `TFS_COLLECTION` 搭配 |
| `TFS_COLLECTION` | 替代 | 集合名，默认 `WN_Data_Platform` |
| `TFS_PROJECT` | 可选 | 默认团队项目，可被 `--project` 覆盖 |

### 5.2 workspace 组命令

`workspace` 组命令需要定位包含 `skills/_shared` 的配置根目录：默认从当前目录向上查找；同时支持 monorepo 的 `projects/multica/skills/_shared` 布局。
在仓库目录之外执行时显式指定 Rondo 配置仓库根目录（或 monorepo 根目录）：

```bash
export MULTICA_REPO_ROOT="D:/UserProgram/winning-platform-rondo"
```

定位失败会返回 `exit 3`（UNKNOWN），不产生任何写入。

## 6. 升级与卸载

```bash
# 升级：新版 tgz 落地后覆盖安装即可
npm install -g ./winning-rondo-<new-version>.tgz

# 卸载
npm uninstall -g @winning/rondo
```

## 7. 注意事项

1. **凭证不进包**：tgz 内不含任何 PAT / 配置文件；安装包只交付程序。
2. **全局安装不改变既有流水线调用**：现有 Skill 仍按配置里的 `node + dist/index.js 绝对路径` 调用，
   安装全局命令不等于配置已切换，切换需同步改配置。
3. **生产不用 `npm link`**：`npm link` 依赖源码目录，仅限开发机临时使用。
4. 重新构建分发包在根仓 `tools/rondo/` 执行：`npm pack`（`prepack` 自动 `npm run build`），产物文件名形如
   `winning-rondo-<version>.tgz`，复制回本目录并更新 §1 清单。

## 8. 相关文档

| 文档 | 说明 |
| --- | --- |
| [成员安装使用速览](QUICKSTART.md) | 面向团队成员的最小上手说明（安装、配置、常用命令）。 |
| [rondo 命令契约手册](COMMANDS.md) | 全部 35 个命令的用法、参数与退出码事实清单。 |
| [TFS CLI 安装与运行操作手册](../archive/docs-2026-11-18/tfs-cli-operations-guide.md) | 凭证配置、自部署服务器、排障全文（命令面已并入 rondo）。 |
| [Workspace 资产同步操作手册](../archive/docs-2026-11-18/workspace-sync-operations-guide.md) | `rondo workspace provision / sync` 日常运维。 |
| [Multica + OpenSpec 索引](../README.md) | 本目录上级索引与资产清单。 |
