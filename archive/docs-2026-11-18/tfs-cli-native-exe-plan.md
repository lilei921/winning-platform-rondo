# tfs-cli 原生 exe 方案（SEA 单文件可执行）

> 状态：**M1/M2 已实施验收（2026-10-28，见 §12 实施记录）**；M3 Linux / M4 文档回切 / M5 macOS 待排期。
> 定位：消除 tfs-cli 对 Windows `cmd.exe` shim 中转的依赖，使裸 `tfs-cli` 命令在受限 Agent 运行环境（Codex 桌面应用等）可直接拉起。
> 前置事实：2026-10-28 tfs-sync 派入 Codex 桌面应用执行，`skill-flow tfs reconcile-workitem` 返回 UNKNOWN——底层 `tfs-cli query` 启动失败（`spawn cmd.exe EPERM`）。同环境 `multica`（原生 PE32+ exe）、`openspec`（shell 工具经 sh 脚本拉起）均正常；差异不在命令本身，而在启动路径是否需要 `cmd.exe` 中转。
> 决策记录：① 不改 skill-flow spawn 层（见 §2 非目标与 §6 论证）；② 过渡解封走配置层 `["node", "<entry>"]` 形态；③ 本方案（原生 exe）为治本项目，完成后配置回切裸 `tfs-cli`。

## 1. 背景与问题

### 1.1 故障链

`sync-config.json` 的 `query_command` 使用裸 `"tfs-cli"`。Windows 上 npm 全局安装的 bin 是 shim 三件套（无扩展 sh 脚本 + `tfs-cli.cmd` + `tfs-cli.ps1`）：

- 人手 / bash shell 工具执行时，sh 脚本被优先解释执行，不需要 `cmd.exe`；
- skill-flow（Node 进程）内部 `execaSync("tfs-cli", …)`（`tools/skill-flow/src/clients/spawn.ts`）按 PATHEXT 解析选中 `tfs-cli.cmd`，Windows 执行 `.cmd` 必须绕道 `cmd.exe /d /s /c`；
- Codex 桌面应用的 Agent 运行环境拦截进程树内部创建 `cmd.exe`（CreateProcess 返回 EPERM）→ execa 进程根本无法启动 → `runCommand` 抛 UnknownError → reconcile 按契约映射 exit 3 = UNKNOWN。

2026-10-28 本机普通终端用同版本 execa v9 + Node 24 复现同一调用，进程正常拉起——**代码无缺陷，纯粹是受限环境差异**。

### 1.2 同类先例

- 根仓 `.codex/config.toml` 的 codegraph MCP 配置已用 `node + npm-shim.js` 绕过 `.cmd`，注释明确记录："Windows 下 codegraph 为 npm shim，需通过 node 直接执行包入口，避免 CreateProcess 无法解析 .cmd/.ps1"。
- `multica` CLI 为原生 PE32+ exe（`~/.multica/bin/multica`），任何环境直接 CreateProcess 成功，从未踩此坑——本方案即对齐该形态。
- `.cmd` shim 是一**类**问题：今后任何 Node CLI 要进入受限 Agent 环境都会踩中，逐个在消费方配置里绕是治标。

### 1.3 跨平台事实

此问题 **Windows 独有**。macOS/Linux 上 npm 全局 bin 是指向带 `#!/usr/bin/env node` shebang 的 JS 文件的符号链接，`execve` 直接执行，无 shell 中转（test220 Linux daemon 长期正常即实证）。因此：

- 方案产物需覆盖三平台（分发形态统一），但**只有 Windows 产物的动机是解封**；mac/Linux 产物是为统一安装运维形态；
- 过渡期配置可以分平台差异化（见 §7），终态全平台统一裸 `tfs-cli`。

## 2. 目标与非目标

### 目标

1. tfs-cli 产出 Windows x64 / Linux x64 / macOS（arm64，按需 x64）原生单文件可执行程序，启动路径不经过 `cmd.exe` / `powershell` / `sh`。
2. 分发与安装对齐 multica 模式：tgz 正规安装到用户目录（如 `~/.tfs-cli/bin`），Windows 免 `C:\Program Files\nodejs`（免管理员权限）。
3. 消费方零改动：命令面、退出码契约（0/2/3/64）、stdout JSON 契约、PAT 注入红线全部保持；config 中裸 `"tfs-cli"` 终态可用。
4. skill-flow 零改动。

### 非目标

- 不改 skill-flow spawn 层（不做 `.cmd` shim 内容解析、不加 shell 回退——受限环境禁的是 `cmd.exe` 进程本身，`shell: true` 同样无效；解析 npm shim 私有格式属于把部署事实耦合进基础设施，脆且错层）。
- 不改 CLI 业务行为与任何输出契约。
- 不替换开发态工作流：本地开发仍是 `tsc` + `node dist/index.js`，npm 包继续发布（exe 是新增分发形态，不是替代）。
- 不处理其它 CLI（openspec 等）的同类问题；本方案形成的管线可复用，但不在本范围。

## 3. 现状盘点

| 项 | 现状 |
| --- | --- |
| 语言/构建 | TypeScript ESM（`"type": "module"`），`tsc` → `dist/`，bin 指向 `dist/index.js` |
| 依赖 | `azure-devops-node-api ^6.6.2`、`marked ^17.0.5`，**均为纯 JS，无 native addon** —— 可 bundle |
| 运行时外部文件 | `config/tfs.config.json` 兜底配置，路径经 `import.meta.url` 相对 dist 解析（`src/config.ts` `configFilePath()`）——**SEA 化必须改造**，见 §5.3 |
| 安装现状 | `npm i -g` 至 `C:\Program Files\nodejs`（需管理员）；test220 为 tgz 正规安装 |
| 消费方 | `tfs-sync/config/sync-config.json` `query_command`；多处 registry `runtime.tfs_cli`（`_shared/repo-registry.base.json`、`analysis-completion` 等）均为裸 `"tfs-cli"`；`reconcile-workitem.ts:525` 前缀推导兼容 `["node", entry]` 形态 |
| Node 基线 | 本机 v24.14.1；SEA 能力按 Node 22+ 评估 |

## 4. 技术路线选型

| 候选 | 结论 | 理由 |
| --- | --- | --- |
| **Node SEA + esbuild**（推荐） | ✅ | 保持 Node 运行时语义（`azure-devops-node-api` 行为不变）；官方能力，Node 22+ 可用；esbuild 负责把 ESM + 依赖打成单文件 CJS 喂给 SEA |
| pkg | ❌ | 项目已废弃（2024 归档），不支持新 Node |
| nexe | ❌ | 维护停滞，需自行编译 Node 底座 |
| `bun build --compile` / Deno compile | ❌ | 运行时换成 Bun/Deno，`azure-devops-node-api`（NTLM/Basic、TLS 细节）在非 Node 运行时的行为未验证，引入新风险面 |
| 微型 launcher exe + 外挂 JS | ❌ | exe 仍需定位并 spawn `node.exe` 与 JS 入口，依赖机器装 Node 与路径解析，等于把 shim 问题换成自研 shim |

## 5. 设计

### 5.1 构建管线

```text
src/ (TS, ESM)
  └─ tsc ──► dist/                       # 开发态不变
  └─ esbuild --bundle --platform=node --format=cjs --target=node22
       └─► build/sea/bundle.cjs          # 单文件；外部依赖全部内联
            └─ node --experimental-sea sea-config.json
                 └─► build/sea/sea-prep.blob
                      └─ postject 注入 node 底座
                           └─► dist-exe/tfs-cli[.exe]   # 三平台各一份
```

新增 npm scripts（示意，实现时定稿）：`build:bundle` / `build:sea` / `pack:exe`；`sea-config.json` 关键项：

- `main: build/sea/bundle.cjs`，`output: sea-prep.blob`
- `disableExperimentalSEAWarning: true`（SEA 仍带 experimental 标记，消警告）
- `useSnapshot: false`、`useCodeCache: false`（避免 V8 snapshot 跨机器兼容问题，首版保守；启动耗时增量对 CLI 场景可接受，后续再评估开启）

### 5.2 ESM → CJS 注意点

- 源码全部 `import`，esbuild 转 CJS 无业务改动；
- 排查点：`import.meta.url`、`createRequire`、动态 `import()`、依赖内部的动态 `require`（`azure-devops-node-api` 的 typed-rest-client / `marked` 需实测）；动态 require 无法静态打包时按 esbuild `external` + 随包携带 fallback（见 §8 风险 R2）。

### 5.3 配置加载改造（SEA 必要适配）

现状 `configFilePath()` 以 `import.meta.url` 相对 dist 定位 `config/tfs.config.json`。SEA 下入口位于内嵌 blob，`import.meta.url`/`__dirname` 指向虚拟路径，**兜底配置将静默失效**（`readConfigFile` catch 后返回 `{}`，PAT 若只配在文件里会直接报 ConfigError）。

改造设计（保持注入优先级语义不变）：

1. 配置文件查找改为依次探测：`$TFS_CLI_CONFIG`（新环境变量，显式指定）→ `process.execPath` 同级 `config/tfs.config.json`（exe 形态）→ cwd `config/tfs.config.json`（兼容现状）；
2. 环境变量优先级不变（`TFS_PAT` 等仍最高）；PAT 红线不变；
3. 未找到任何配置时不报错语义不变（继续走内置默认 + 环境变量）。

安装后布局对齐 multica：`~/.tfs-cli/bin/tfs-cli(.exe)` + `~/.tfs-cli/config/tfs.config.json`，查找规则①②覆盖。

### 5.4 三平台构建矩阵

| 平台 | 产物 | 构建机 | 备注 |
| --- | --- | --- | --- |
| Windows x64 | `tfs-cli.exe` | 本机（win60 开发机） | 动机平台；Codex 受限环境回归在此做 |
| Linux x64 | `tfs-cli` | test220（172.17.1.97，已免密） | daemon 运行机，替换现有 tgz 安装验证 |
| macOS arm64 | `tfs-cli` | 按需（暂无 mac 使用方） | 内网分发免签名，安装脚本 `xattr -d com.apple.quarantine`；x64 暂缓 |

postject 注入需各平台 Node 底座（`node.exe` 副本注入后改名）；底座 Node 版本锁入 `sea-config.json` 旁注释，安全补丁 = 换新底座重打（记录 rebuild 步骤到 README）。

### 5.5 分发与安装

- 产物：`winning-tfs-cli-<version>-<platform>.tgz`（对齐现有 `winning-tfs-cli-1.0.1.tgz` 命名习惯，加平台后缀）；
- 安装脚本（`install.sh` / `install.ps1`）：解压至 `~/.tfs-cli/`，提示/写入 PATH；Windows 不再需要管理员权限；
- `tfs-cli --version` 输出版号 + 内嵌 Node 版本（便于现场确认底座）；
- 升级 = 重跑安装脚本覆盖；卸载 = 删目录 + PATH 还原。

### 5.6 消费方影响

| 消费方 | 过渡期（§7 A） | 终态（本方案落地后） |
| --- | --- | --- |
| `sync-config.json query_command` | Windows：`["node", "<abs>/tools/tfs-cli/dist/index.js", "query", …]`；Linux/mac：裸 `tfs-cli` 不变 | 全平台裸 `["tfs-cli", "query", …]` |
| registry `runtime.tfs_cli`（多处） | 同上 | 裸 `"tfs-cli"` 不变（本就如此） |
| `reconcile-workitem.ts` 前缀推导 | 天然兼容两种形态（取 `query` 子命令前段） | 不变 |
| skill-flow spawn 层 | 不变 | 不变 |
| `.codex/config.toml` codegraph 注释 | 不变（该例留作 shim 类问题的文档记录） | 不变 |

过渡期 Windows 配置的路径绑定问题由 workspace provision（`skill-flow workspace sync` 已做 per-workspace registry 物化）生成吸收，不手维护。

## 6. 为什么 skill-flow 不改

1. **错层**："这个 CLI 在这台机器上如何启动"是部署事实，由配置表达；spawn 层契约是"给什么 argv 跑什么，起不来即 UNKNOWN"，保持纯净。
2. **绕不开**：受限环境禁的是 `cmd.exe` 进程本身，任何"让 Node 帮忙走 shell"的方案（`shell: true` 等）在 Windows 上都等于拉 `cmd.exe`，同样 EPERM。
3. **脆**：skill-flow 侧唯一可行替代是解析 npm `.cmd` shim 私有格式提取 JS 入口——npm 改模板即静默坏，且要处理 pnpm/yarn 布局分叉。不进基础设施。

## 7. 与过渡方案 A 的关系

- **A（配置层 `["node", entry]`）**：立即解封 Windows 派 Codex 场景，随本方案评审后先行实施；优点是零构建投入，缺点是绑机器路径、只覆盖改到的 config。
- **本方案（B）**：消除 shim 类问题根因，完成后 A 的临时配置回切裸 `tfs-cli`，全平台统一。
- 两者不冲突：A 的 config 形态在 B 落地后仍是合法契约（`tfs_cli` 数组支持前导参数）。

## 8. 风险与缓解

| # | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| R1 | SEA 仍带 experimental 标记，Node 未来版本行为可能变 | 构建流程需跟随调整 | 锁定构建机 Node 版本；`disableExperimentalSEAWarning`；升级 Node 时重跑 §9 验证矩阵 |
| R2 | 依赖含动态 require / 资源文件，bundle 后运行时缺模块 | exe 启动即崩或特定命令失败 | **已命中并固化缓解（2026-10-28）**：`azure-devops-node-api` 的 `WebApi` 构造器运行时 `readFileSync(__dirname + '/package.json')` 读版本组 User-Agent；`build-exe.mjs` 第 5 步自动生成 sidecar `package.json` 随 exe 携带 |
| R3 | 体积：内嵌 Node 底座约 90–110MB，tgz 压缩后约 30MB | 内网分发可接受 | 无需缓解；文档注明 |
| R4 | macOS 未签名被 Gatekeeper 拦 | mac 首次运行失败 | 安装脚本 `xattr -d`；操作文档写明 |
| R5 | exe 内嵌 Node 的安全补丁滞后 | 内网工具风险低但存在 | rebuild 流程文档化；跟随 Node LTS 安全发布节奏重打 |
| R6 | 配置加载路径改造（§5.3）引入回归 | 现有 npm 安装形态配置失效 | 查找规则保持 cwd 兼容；§9 等价性验证覆盖 npm 形态 |

## 9. 验证方案（落地时执行）

1. **契约等价**：同一 WIQL 的 `query` 输出，npm 形态 vs exe 形态 stdout 逐字节一致；`--version`、`workitem set-state`（对测试工作项）等 8 个子命令退出码契约 0/2/3/64 全过。
2. **受限环境回归**：Codex 桌面应用内跑 `skill-flow tfs reconcile-workitem` 全链路（即 2026-10-28 失败场景），tfs-cli 段不再 EPERM。
3. **三平台冒烟**：Windows 本机、test220 Linux daemon 替换安装后跑一次真实同步；mac 按需。
4. **配置兼容**：npm 形态（`import.meta.url` 路径）、exe 形态（execPath 路径）、纯环境变量三种注入方式各验证一次。
5. **skill-flow 回归**：对照 2026-10-26 analysis complete 全链路 PASS 基线重跑。

## 10. 里程碑（暂不开发，评审后排期）

| 里程碑 | 内容 | 出口条件 |
| --- | --- | --- |
| M1 ✅ | bundle 可行性：esbuild 打 `azure-devops-node-api` + `marked`，`node bundle.cjs query` 实连 TFS 跑通 | 已完成（2026-10-28，见 §12） |
| M2 ✅ | Windows SEA 产物 + Codex 受限环境回归 | 产物已建并本地验收；Codex 回归待用户重启应用后执行 |
| M3 | Linux 产物 + test220 替换安装 + daemon 真实同步 | §9.3 Linux 项通过 |
| M4 | 安装脚本、`--version` 底座信息、README/运维文档、config 回切裸 `tfs-cli` | §9 全量通过；A 临时配置撤出（A 已不需要） |
| M5 | macOS 产物（按需启动） | 有 mac 使用方时 |

## 11. 立即动作（不属于本方案开发范围）

- 过渡方案 A：Windows 侧 `sync-config.json` 及 registry 裸 `"tfs-cli"` 改 `["node", "<abs>/dist/index.js"]` 形态，解封 tfs-sync 派 Codex 场景；
- 本方案评审通过后按 §10 排期。

## 12. 实施记录（2026-10-28）

**M1 + M2 + Windows 安装解封当日完成**，过渡方案 A 不再需要（exe 形态直接覆盖）：

| 项 | 结果 |
| --- | --- |
| M1 bundle 可行性 | ✅ esbuild 单文件 CJS 1.6MB 一次通过；R2 命中（sidecar `package.json` 已固化进管线） |
| §5.3 配置加载改造 | ✅ `src/config.ts` 查找链：`TFS_CLI_CONFIG` → execPath 上两级 `config/` → import.meta.url 原位（npm 兼容）→ cwd；npm 形态回归通过 |
| M2 Windows 产物 | ✅ `npm run build:exe`（`scripts/build-exe.mjs` 五步管线；sentinel 自动从底座扫描——Node 24 为 `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`，与旧文档不同）；产物 91MB |
| §9.1 契约等价 | ✅ 确定性小响应（WI#249）：exe 与 npm 形态 stdout 逐字节一致；`--version`（1.0.2 / sea:true / node v24.14.1）、exit 0/3/64 契约全过；execPath 配置兜底（无 TFS_PAT 环境变量时读 `~/.tfs-cli/config/`）通过 |
| Windows 安装 | ✅ `~/.tfs-cli/bin/tfs-cli.exe` + sidecar + `~/.tfs-cli/config/tfs.config.json`；User PATH 前置（`scripts/add-path.ps1`）；npm 全局 shim 已卸载（原为指向本仓的 link）；裸 `tfs-cli` 解析到 exe |
| §9.2 Codex 回归 | ⏳ 需用户重启 Codex 桌面应用（加载新 User PATH）后重跑一次 tfs-sync 验证 |

**重要附带发现（与 exe 无关的既有缺陷，需另行立项）**：`query` 大响应输出随机出现 U+FFFD 乱码（实测 npm 与 exe 形态单次运行各 470–673 处，同一形态两次运行位置都不同）——`azure-devops-node-api`/typed-rest-client 解压 gzip 流时 chunk 边界截断多字节 UTF-8 字符所致。影响：tfs-sync 同步进 multica 的 HTML 正文字段可能带随机乱码。修复方向：请求侧关 gzip（`Accept-Encoding: identity`）或绕开 SDK 流式解码走 raw HTTP。

**遗留**：M3（Linux 产物 + test220 替换，涉及运行中 daemon，需单独确认窗口）、M4（安装脚本文档化、各平台 config 终态回切确认）、M5（macOS，按需）。
