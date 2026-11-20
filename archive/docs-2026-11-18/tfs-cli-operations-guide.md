# rondo 安装与运行操作手册

> 定位：本地及自部署 Multica 服务器上的 rondo 构建、安装、凭证配置、升级与排障。
> 实现位置：本 monorepo `tools/rondo/`；命令与输出契约见 `tools/rondo/README.md` 及合并方案 `projects/plans/rondo-cli-merge-plan.md`。
> 2026-11-04 起 rondo 取代原 tfs-cli / skill-flow 两命令；本文命令面已切换为 rondo，历史 tfs-cli 契约（退出码 0/2/3/64、stdout 纯 JSON）原样保留。
> 当前形态：Node.js CLI，通过 npm 的 `bin` 注册 `rondo` 命令；不是独立原生 exe，运行时仍需要 Node.js。

## 1. 先记住四条原则

1. **程序与凭证分离**：安装包只交付程序；PAT 在本地或服务器部署阶段单独注入，绝不打入 tgz/npm 包。
2. **配置给实际执行者**：本机使用时配置给当前用户；Multica 使用时配置给实际执行 Agent / Skill / Run 的服务进程、Worker 或容器。
3. **生产不用 `npm link`**：`npm link` 依赖源码目录，只适合开发；服务器安装明确版本的 tgz，已有私有 npm 基础设施时也可使用私有仓库。
4. **全局安装不会自动改流水线配置**：现有 Skill 仍按 `config/*.json` 中的 `node + dist/index.js 绝对路径` 调用；安装全局命令不等于这些配置已切换。

## 2. 前置条件与配置项

### 2.1 前置条件

- 已安装 Node.js 与 npm；本仓已验证 Node 24 环境。
- 能访问目标 TFS。
- 使用 tgz 安装时，若生产依赖未缓存，还需访问所配置的 npm 仓库或内部镜像。**tgz 默认不包含全部第三方依赖，不等于完全离线安装包。**

### 2.2 环境变量

| 变量 | 必需性 | 说明 |
|---|---|---|
| `TFS_PAT` | 必需 | TFS 个人访问令牌；禁止通过命令行参数传入 |
| `TFS_SERVER_URL` | 推荐 | 完整 collection URL，例如 `http://<host>:8080/tfs/<collection>` |
| `TFS_PROJECT` | 可选 | 默认团队项目；命令中的 `--project` 可覆盖 |
| `TFS_URL` | 替代方案 | TFS base URL，不含 collection |
| `TFS_COLLECTION` | 替代方案 | 集合名；与 `TFS_URL` 搭配使用 |

`TFS_SERVER_URL` 与 `TFS_URL + TFS_COLLECTION` 二选一；同时存在时，当前实现优先使用 `TFS_SERVER_URL`。

当前代码使用 **`TFS_PAT`**。早期方案文档中出现过的 `TFS_TOKEN` 不是当前实现读取的变量。

当前配置优先级为：**环境变量 > 包目录下 `config/tfs.config.json` > 内置默认值**。tgz 发布包通过 `files` 白名单排除了本地 `config/`，因此全局安装后应使用环境变量。

## 3. 非 Multica 平台：本地使用

### 3.1 开发机从源码启用命令

在 Git Bash 中：

```bash
cd /d/WN_Platform/works/win60_repos/DF/winning-platform-monorepo/tools/rondo
npm install
npm run build
npm link
```

重新打开终端后检查：

```bash
where rondo
```

若提示找不到命令：

```bash
npm prefix -g
```

将输出目录加入 Windows 用户 `PATH`，再重新打开终端。

### 3.2 仅在当前 Git Bash 窗口配置凭证

关闭终端后失效，适合临时使用：

```bash
export TFS_SERVER_URL="http://<host>:8080/tfs/<collection>"
export TFS_PROJECT="<project>"

# 隐藏输入，避免 PAT 直接留在终端历史和屏幕中
read -s -p "TFS PAT: " TFS_PAT
echo
export TFS_PAT
```

在同一窗口执行：

```bash
rondo repo get --name <repo>
```

### 3.3 永久配置为当前 Windows 用户的环境变量

1. Windows 搜索并打开 **“编辑账户的环境变量”**。
2. 在“用户变量”中新建 `TFS_PAT`、`TFS_SERVER_URL`，按需新建 `TFS_PROJECT`。
3. 保存后关闭并重新打开 CMD、PowerShell、Git Bash、IDE 或 Claude Code。
4. 在新进程中执行 `rondo`。

也可使用 §6 的 BAT 脚本。不要把真实 PAT 写进 BAT 文件。

## 4. tgz 打包、全局安装、升级与卸载

### 4.1 构建并生成 tgz

在 Git Bash 中：

```bash
cd /d/WN_Platform/works/win60_repos/DF/winning-platform-monorepo/tools/rondo
npm run pack
```

`npm run pack` 会调用 `npm pack`；`prepack` 自动执行 `npm run build`。以版本 `1.0.0` 为例，生成：

```text
winning-rondo-1.0.0.tgz
```

分发前可先检查内容而不实际生成包：

```bash
npm run pack -- --dry-run
```

输出中应只有 `dist/`、`README.md`、`package.json` 等发布内容，**不得出现 `config/tfs.config.json`**。

### 4.2 从 tgz 全局安装

在 tgz 所在目录执行：

```bash
npm install -g ./winning-rondo-1.0.0.tgz
```

或指定完整路径：

```bash
npm install -g "D:/path/to/winning-rondo-1.0.0.tgz"
```

重新打开终端后检查：

```bash
where rondo
```

然后配置 §2.2 的环境变量，执行只读命令验证：

```bash
rondo repo get --name <repo> --project <project>
```

### 4.3 私有 npm 仓库（已有基础设施时）

仅当包已发布到公司私有仓库、且当前 npm 已配置该仓库和访问权限时：

```bash
npm install -g @winning/rondo@1.0.0
```

不要把包含公司内部信息的包发布到公共 npm 仓库。少量服务器无需仅为 rondo 新建仓库，版本化 tgz 即可。

### 4.4 升级与卸载

安装新版 tgz 即替换旧版：

```bash
npm install -g ./winning-rondo-<new-version>.tgz
```

卸载：

```bash
npm uninstall -g @winning/rondo
```

升级程序不需要重写用户环境变量；**修改环境变量后必须重启相关终端或服务进程**。

## 5. 自部署 Multica 服务器

### 5.1 部署选择

- 一套或少数几套服务器：推荐 **版本化 tgz + 固定版本全局安装**，并记录版本号或文件校验值。
- 已有多服务器、私有 npm 仓库和统一权限管理：直接使用私有 npm 仓库。
- 不使用 `npm link` 作为生产部署方式。

在**实际执行 Run 的节点**安装 rondo。如果 Multica Server 只负责调度、Run 由独立 Worker 执行，则只装在 Web Server 上不够。

### 5.2 Windows 用户 daemon（CLI 启动）

截至 Multica CLI 0.6.1，未发现可供 Agent / Skill / rondo 使用的通用 Workspace 或 Runtime 环境变量注入入口。`workspace mcp` 配置仅适用于 MCP Server，不能替代 rondo 的运行环境配置。因此，TFS 变量应配置在**实际运行 `multica daemon` 的 Windows 账号下**，不上传到 Multica 平台。

Multica 本身不解析这些 `TFS_*` 变量，操作系统通过进程环境继承将它们传给 rondo：

```text
Windows 用户环境变量
  → 新终端
  → multica daemon
  → Run / Agent / Skill 子进程
  → rondo 的 process.env
```

当前 Skill 脚本创建子进程时未覆盖 `env`，因此默认继承 daemon 环境。每个 Runtime 机器需分别配置，平台不会同步这些变量。

如果 daemon 是通过 CLI 在当前 Windows 账号下启动的，按以下步骤配置：

1. 在 CMD 执行 `whoami`，确认当前账号就是启动 daemon 的账号。
2. Windows 搜索并打开 **“编辑账户的环境变量”**。
3. 在上方“用户变量”区域新建：

   | 变量名 | 变量值 |
   |---|---|
   | `TFS_SERVER_URL` | `http://<host>:8080/tfs/<collection>` |
   | `TFS_PROJECT` | 实际 TFS Team Project 名称 |
   | `TFS_PAT` | 有效的 TFS PAT |

   也可使用 §6 的 BAT 脚本隐藏输入 PAT；不要把真实 PAT 写入脚本或命令历史。
4. 保存后关闭旧 CMD、PowerShell、Git Bash，再打开新终端。已经运行的终端和 daemon 不会动态读取新值。
5. 在新 CMD 中检查变量是否存在，但不输出 PAT：

   ```cmd
   echo %TFS_SERVER_URL%
   echo %TFS_PROJECT%
   if defined TFS_PAT (echo TFS_PAT=SET) else (echo TFS_PAT=NOT SET)
   ```

6. 在**同一个新终端**重启 daemon，使新进程继承这些变量：

   ```bash
   multica daemon restart
   multica daemon status
   ```

后续 Run 中的 rondo 会自动读取变量，不需要在每个命令前重新设置。若 daemon 由其他 Windows 账号或 Windows Service 运行，当前用户变量未必生效，应按实际服务账号配置或使用下节的服务级方案。

### 5.3 Windows Service

优先使用服务管理或部署工具提供的服务级环境变量配置。没有该能力时，可由管理员配置 Windows **系统环境变量**，然后重启 Multica Server / Worker 服务。

注意：

- 只配置管理员当前终端或管理员用户变量，服务通常读不到。
- 修改环境变量后，仅重开终端不够，必须重启对应服务。
- `setx /M` 是机器级配置，影响范围大于单服务；多环境共存时优先使用服务级配置。

### 5.4 Docker Compose

宿主机的环境变量不会自动进入容器，必须注入到实际执行 Run 的 Server / Worker 容器。

创建不进入 Git 的 `secrets/rondo.env`：

```dotenv
TFS_PAT=<PAT>
TFS_SERVER_URL=http://<host>:8080/tfs/<collection>
TFS_PROJECT=<project>
```

在实际服务的 Compose 配置中引用；以下服务名仅为示例：

```yaml
services:
  multica-worker:
    env_file:
      - ./secrets/rondo.env
```

要求：

- 将凭证文件加入 `.gitignore`，限制为仅部署管理员可读；
- 修改后按部署方式重建或重启对应容器；
- 不把凭证文件复制进镜像或构建上下文。

### 5.5 Linux systemd

可将变量写入 `/etc/multica/rondo.env`，限制权限为仅服务管理员可读写，并在实际服务的 systemd override 中引入：

```ini
[Service]
EnvironmentFile=/etc/multica/rondo.env
```

然后重新加载 systemd 配置并重启实际执行 Run 的服务。

### 5.6 与现有流水线调用的关系

当前仓内 `_shared` 配置使用全局 `rondo` 命令。因此：

- 实际 Runtime 必须已安装 rondo，且 npm 全局命令目录在 daemon / Worker 的 `PATH` 中；
- TFS 环境变量需配置在实际运行账号下，修改后重启 daemon / Worker；
- 现有 Skill 脚本在 Windows 下通过 `where.exe` 解析 `rondo.cmd`，不再依赖仓内 `tools/rondo` 源码目录或 `dist/index.js` 绝对路径；
- rondo 的版本升级与回退通过全局安装指定版本的 tgz / npm 包完成；
- 如特定环境必须恢复 `node + dist/index.js` 绝对路径，应修改 `_shared` base 后重新渲染同步，不逐份手改 Skill 渲染产物。

## 6. CMD 环境变量与 BAT 脚本

CMD 中：

- `set`：只影响当前 CMD 窗口，关闭后失效；
- `setx`：持久化用户或系统环境变量，对之后新开的进程生效，不改变已经运行的进程。

以下脚本将配置保存到**当前 Windows 用户**，PAT 通过 PowerShell 隐藏输入获取，不写死在脚本中。保存为 `set-tfs-env.bat`：

```bat
@echo off
setlocal EnableExtensions

rem ===== Edit non-secret values =====
set "TFS_SERVER_URL=http://<host>:8080/tfs/<collection>"
set "TFS_PROJECT=<project>"

rem ===== Prompt for PAT without echoing it =====
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$s = Read-Host 'TFS PAT' -AsSecureString; $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }"`) do set "TFS_PAT=%%P"

if not defined TFS_PAT (
    echo [ERROR] TFS PAT cannot be empty.
    exit /b 1
)

rem ===== Persist for the current Windows user =====
setx TFS_SERVER_URL "%TFS_SERVER_URL%" >nul
if errorlevel 1 goto :error

setx TFS_PROJECT "%TFS_PROJECT%" >nul
if errorlevel 1 goto :error

setx TFS_PAT "%TFS_PAT%" >nul
if errorlevel 1 goto :error

echo.
echo TFS environment variables saved for the current user.
echo Close and reopen CMD, PowerShell, IDE, or Claude Code before using rondo.

endlocal
exit /b 0

:error
echo.
echo [ERROR] Failed to save TFS environment variables.
endlocal
exit /b 1
```

使用步骤：

1. 修改脚本中的 `TFS_SERVER_URL`、`TFS_PROJECT`；不需要默认项目时，移除对应的 `set` 和 `setx` 行。
2. 在 CMD 执行 `set-tfs-env.bat`，按提示输入 PAT。
3. 关闭并重新打开 CMD，再执行 `rondo`。

若确需机器级配置，可由管理员将三条 `setx` 改为 `setx /M`，然后重启 Multica 等相关服务。不要把真实 PAT 保存在 BAT 中，也不要把含真实值的脚本提交 Git。

## 7. 验证与排障

### 7.1 安全检查

可以检查变量是否存在，但不要输出变量值：

```bash
[ -n "$TFS_PAT" ] && echo "TFS_PAT=SET" || echo "TFS_PAT=NOT SET"
[ -n "$TFS_SERVER_URL" ] && echo "TFS_SERVER_URL=SET" || echo "TFS_SERVER_URL=NOT SET"
```

不要执行 `echo "$TFS_PAT"`、`env`、`printenv` 等可能把凭证写入终端或日志的命令。

### 7.2 常见问题

| 现象 | 优先检查 |
|---|---|
| `rondo` 找不到 | 是否完成全局安装；`npm prefix -g` 是否在 `PATH`；是否重开终端 |
| 本机能用，Multica 不能用 | 是否装在实际 Worker；变量是否注入实际服务/容器；服务是否重启；Skill 是否仍指向旧绝对路径 |
| exit 3，提示 PAT 未配置 | 当前进程是否读到 `TFS_PAT`；不要只检查管理员个人终端 |
| exit 3，TFS 返回 401 | PAT 是否有效、过期或权限不足；服务账号是否读取到最新值 |
| tgz 安装时依赖下载失败 | 服务器到 npm 仓库/内部镜像的网络与仓库配置；tgz 本身不含完整依赖 |
| 自动化找不到 `rondo.cmd` | 服务账号 `PATH` 与 Windows `spawn` 调用方式；必要时保留 `node + 绝对路径` |
| 修改配置仍不生效 | 环境变量只被新进程继承；重开终端或重启 Server / Worker / 容器 |

### 7.3 TFS 正文图片同步与失败恢复

自 rondo 1.2.22 起，TFS 正文内嵌图片和 AttachedFile 统一按附件 GUID 下载，使用配置集合的 `/_apis/wit/attachments/{guid}?api-version=4.1` 接口。原图片 URL 保留用于追溯；附件身份按来源集合和 GUID 识别，兼容旧正文映射中的项目路径与查询参数形式，避免跨项目批量查询改变图片 URL 后重复上传。

- 下载必须成功退出且返回可校验的本地文件；`404 + error JSON` 不会进入上传步骤。明确的附件下载失败记录到单项 `failed`，其余工作项继续处理。
- 上传结果无法确认时仍返回 `UNKNOWN`，并保留已完成、当前部分处理及未处理项的信息。先回读已有 Issue 和附件，不盲目重复上传。
- 已创建但附件未齐的 Issue 保留 `tfs.intake_pending`。修复下载原因后使用原同步配置重新执行，补齐附件和正文并回读，再清除 pending；不删除重建 Issue，不手工清除 pending 绕过初始化。
- 恢复验收需连续执行两轮同步：第一轮确认图片副本可读取、pending 清除；第二轮核对同一 `tfs.id` 仍只有一个 Issue，附件副本 ID 不变，且没有新的创建或上传调用。Agent 会话 `completed` 不能代替同步退出码和回读结果。

1.2.23 补充图片显示：内嵌图片的附件段除保留来源映射外，还输出 `![文件名](../../Multica副本URL)`，由 Multica 图片组件展示。只有普通下载链接不等于图片可见；直接在浏览器打开受保护附件链接可能提示缺少授权。旧正文缺少图片引用时仅刷新正文，不再次上传。验收需同时核对页面可见性与附件幂等。

## 8. 凭证纪律

1. PAT 不进入 tgz、npm 包、Git、BAT、命令行参数、Issue、评论、Agent/Squad Instructions、`SKILL.md` 或会同步到平台的 Skill `config/*.json`。
2. 不用 `env`、`printenv`、详细启动日志等方式回显完整环境。
3. 生产建议使用专用服务账号的最小权限 PAT，并建立到期轮换流程，避免绑定个人日常账号。
4. 凭证轮换只更新实际运行环境，然后重启相关服务；不需要重新打包 rondo。
