---
title: rondo 成员安装使用速览
status: active
created_at: 2026-11-03
updated_at: 2026-11-20
owner: winning\lintao
---

# rondo 成员安装使用速览

面向团队成员的最小上手说明。完整运维手册见文末链接；冲突时以手册为准。

## 1. 这个工具是什么

`rondo`（npm 包 `@winning/rondo`）是 Multica 交付流水线的统一 CLI：

- 读写 TFS 工作项、附件、PR；Multica 流水线与 TFS 的统一回写入口。
- 仓内 Skill / Agent / Squad 资产到 Multica 平台的供给（provision）与内容同步（sync），以及本地配置渲染。

该包**未发布到公共 npm registry**，只能装本仓的分发包：`projects/multica/tools/winning-rondo-<version>.tgz`。

## 2. 前置条件

- Node.js 22+、npm 可执行，且能访问 npm registry 或内部镜像（tgz 不含第三方依赖，安装时要联网拉取）。
- 只读 TFS 还需要一枚 TFS 个人访问令牌（PAT）。

## 3. 安装

先确认分发目录里的最新版本号：

```bash
ls projects/multica/tools/*.tgz
```

然后在本目录显式指定版本安装（不要用通配符）：

```bash
cd projects/multica/tools

npm install -g ./winning-rondo-<version>.tgz
```

### 找不到命令

```bash
npm prefix -g   # 把输出目录加入用户 PATH，重新打开终端
```

nvm 切换 Node 版本会改变全局目录，切换后需重装。

## 4. 运行期配置

### TFS 连接：只用环境变量，凭证禁止走命令行参数

| 变量 | 必需性 | 说明 |
| --- | --- | --- |
| `TFS_PAT` | 必需 | 个人访问令牌 |
| `TFS_SERVER_URL` | 推荐 | 完整 collection URL，如 `http://<host>:8080/tfs/<collection>` |
| `TFS_URL` + `TFS_COLLECTION` | 替代 | 分两段配置；`TFS_COLLECTION` 默认 `WN_Data_Platform` |
| `TFS_PROJECT` | 可选 | 默认团队项目，可被 `--project` 覆盖 |

### 定位 Multica 配置根

`workspace` 组命令默认从当前目录上溯查找 `skills/_shared`，兼容 monorepo 的 `projects/multica/skills/_shared`。在仓库外执行时显式指定：

```bash
export MULTICA_REPO_ROOT="D:/UserProgram/winning-platform-rondo"
```

定位失败返回 `exit 3`，不产生任何写入。

## 5. 验证

```bash
rondo --version        # JSON 输出:name/version/node/sea,无需连接 TFS
rondo doctor           # 环境体检(只读):16 项检查,FAIL 项附可执行处方
```

## 6. 常用命令

```bash
# 命令总览(无参数时打印全部命令)
rondo --help

# 查询工作项
rondo query --wiql "SELECT [System.Id] FROM workitems WHERE [System.AssignedTo] = @me"

# 改完 Skill 内容后同步到平台
rondo workspace sync --workspace <name> [--skill <skill-name>]

# 只渲染本地配置（clone 后 / 换机器先跑这步）
rondo workspace sync --workspace <name> --local-only

# 审计平台漂移，只看不改
rondo workspace sync --workspace <name> --check

# 新增 Skill 或调整 Agent 绑定后（低频，先于 sync）
rondo workspace provision --workspace <name>

# 体检指定工作区的工作流自定义状态(如 97 自建实例用 --profile 选环境)
rondo doctor --workspace-id <id> --profile 97host
```

`workspace provision / sync` 与 `doctor` 均支持 `--profile <name>` 指定 multica 配置 profile
（profile 自带 server_url+token）。首次通过 provision 绑定到独立 overlay，随后 sync 继承绑定；不要跨环境复用 overlay。运行配置中的环境随分析和交付命令传递。

OpenSpec 默认要求 1.13.2；自动验收使用 `doctor --require`，未实际执行的检查不会被判为通过。

## 7. 升级与卸载

```bash
npm install -g ./winning-rondo-<new-version>.tgz   # 覆盖安装即升级
npm uninstall -g @winning/rondo
```

## 8. 注意事项

1. 分发包不含任何 PAT / 配置文件，凭证只走环境变量。
2. 生产环境不用 `npm link`（仅限开发机临时使用）。
3. 全局安装不影响既有流水线里 `node + dist/index.js 绝对路径` 的调用方式，切换需同步改配置。

## 9. 详细手册

| 文档 | 内容 |
| --- | --- |
| [tools/README.md](README.md) | 分发包版本清单、离线依赖、重建分发包方法 |