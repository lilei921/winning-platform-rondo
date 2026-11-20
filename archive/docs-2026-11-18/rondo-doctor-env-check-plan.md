# rondo doctor 环境检测落地方案

> 状态：方案已评审修订（评审意见 M1–M3 / S1–S3 已合入），暂不开发
> 依据：`D:\Temps\HEY-37.txt`（HEY-37 / TFS 262354 分析 Run 全量日志，2026-11-05）、本仓 `tools/rondo` 源码
> 日期：2026-11-06（首版）；2026-11-06（评审修订）

## 1. 背景与证据基线

HEY-37 分析 Run（分析机 `D:\BI60`，Administrator + nvm4w 环境）全量 49.4 分钟、573 条日志条目，其中：

- **45% 时长（22 分钟、201 条命令）消耗在"寻找 openspec CLI"**：`where.exe openspec` 持续 rc=1，agent 依次搜索 `Roaming\npm`（默认 prefix，nvm4w 不使用）、`C:\nvm4w\v*`（glob 无匹配，版本目录实际在 `%LOCALAPPDATA%\nvm\v*`）、`find ~ -maxdepth 4`（真实路径在第 5 层，差一层未达）等**全部落空的路径**
- 根因：nvm4w 全局包**按 node 版本隔离**（v16.20.2/v18.12.0/v22.12.0 三个版本共存），openspec 未装于当前激活的 v22.12.0；daemon 派生会话继承 PATH 只含 symlink `C:\nvm4w\nodejs`，对非激活版本下的安装不可见
- 收场：agent 运行时即兴 `npm i -g @fission-ai/openspec@1.16.0`（13 秒）解决——**修复本身极廉价，诊断才是全部成本**
- 次级损耗：失控的 `find /d/`（139s 挂起 + 130s ToolSearch 发现 TaskStop）、读历史会话 messages.json 考古契约、6+ 次实验性 validate、评论后 4 轮重复验证

已证伪的归因（防止方案建立在错误前提上）：

| 初判 | 证伪证据 | 真相 |
| --- | --- | --- |
| daemon PATH 缺 node 目录 | 装完立刻 `where.exe openspec` 命中 `C:\nvm4w\nodejs\openspec.cmd`，未改 PATH | PATH 一直正确，是激活版本下未安装 |
| openspec 未装于该机器 | 本方案不依赖此假设；`node_runtime` + `openspec_cli` 三态对"装在旧版本/从未装过"都给出同一条确定处方 | 无论装在旧版本还是从未装，22 分钟考古都不该发生 |
| gate 会拦住缺 CLI 的 Run | rondo dist 源码：`commandExists` 失败时 `openspec_validate` 判 UNKNOWN 而非 FAIL | UNKNOWN 兜底存在但发生在 Gate 阶段，太迟，且此前 Run 可能长期带 UNKNOWN 通过 |

### 工具链前提（2026-11-06 用户确认）

- **skill-flow、tfs-cli 已废弃，统一收编进 rondo**（`tools/rondo`，`@winning/rondo@1.0.1`）
- tfs-mcp 不纳入环境检测；TFS 访问经 rondo 自身 client（`clients/tfs.ts`）与配置

## 2. 目标与非目标

### 目标

1. 新增 `rondo doctor`：只读、确定性的环境体检命令，**3 秒内**给出诊断 + 可执行修复处方。**第一调用方是运维/交付人员手工执行**，用于判定当前机器的 multica 依赖环境是否健康（装机验收、故障排查、daemon 起不来时的第一站）；agent/skill 程序化调用（`--format json`）为衍生用法
2. 把 HEY-37 式的"环境考古"固化为算法，消灭该故障类型
3. 为 skill 前置、daemon 自检、Run 审计提供统一的环境事实源

### 非目标（第一期明确排除）

- 不做 `--fix` 自动修复（全局环境变更属治理决策，先由人/skill 显式执行 remediation；稳定后再评估白名单式 `--fix`）
- 不检测业务状态（issue 状态、TFS 工作项内容等）
- 不做跨机批量体检（单机命令，批量由上层编排）
- 不替代 Gate——doctor 是前置，Gate 的 `openspec_validate` UNKNOWN 兜底保留不动

## 3. 命令与输出契约

### 用法

```
rondo doctor [--require <check,...>] [--format text|json] [--expect-openspec <version>]
```

- 无参数：全量检查
- `--require`：只跑指定检查项子集（供 skill 前置按需调用）
- `--format`：**默认 `text`（人读）**——doctor 定位是运维人员手工执行的诊断命令，用于判定当前机器的 multica 依赖环境是否健康；`--format json` 供程序化消费（skill 前置、Run metadata 落证时显式指定）。这是 rondo 既有"stdout-JSON 优先"契约的**有意例外**：其他命令的调用方是 agent/skill，doctor 的第一调用方是人
- `--expect-openspec`：临时覆盖期望版本；默认读期望源（§5.4）

### 输出契约（沿用 rondo 既有约定）

- **默认 text 模式**：stdout 出人读报告，日志走 stderr；**`--format json` 模式**：stdout 只出 JSON（`cli/output.ts` 的 `emitJson`/`log` 既有机制），保证可被 `JSON.parse` 直接消费
- 退出码沿用既有枚举风格：`0 PASS` / `2 FAIL` / `3 检测自身异常` / `64 用法错误`
- **WARN 不占用独立退出码**：整体 WARN 时退出码 0、JSON `result: "WARN"`（连通性等可降级项不应打断离线场景；收紧由 `--require` 的调用方决定——`--require` 命中的项 WARN 按 FAIL 计，退出码 2）

### JSON Schema（草案）

```json
{
  "result": "PASS | WARN | FAIL",
  "node": { "version": "v22.12.0", "path": "C:\\nvm4w\\nodejs\\node.exe" },
  "platform": "win32",
  "checks": [
    {
      "name": "openspec_cli",
      "level": "FAIL",
      "result": "FAIL",
      "failure_kind": "not_found",
      "detail": "where.exe openspec rc=1；PATH 中不存在",
      "remediation": "npm i -g @fission-ai/openspec@1.16.0"
    },
    {
      "name": "node_runtime",
      "level": "FAIL",
      "result": "PASS",
      "detail": "v22.12.0 在期望区间 >=18.19 内"
    }
  ]
}
```

字段约束：

- 每项显式声明 `level: FAIL | WARN | INFO`（该项未过时的默认严重级）
- `remediation` 必须是**可直接复制执行的命令**或一句确定性指引，禁止"请检查 xxx"式空话；仅未过项携带
- `failure_kind` 用于区分同一名检查的不同失败形态（见 §4.2 openspec_cli 三态）
- `detail` 含探测证据（命令 + rc + 关键输出），便于审计
- 典型场景的完整输出示例见附录 A

## 4. 检查项清单

工具链收敛后共 4 层 12 项。每项独立函数，注册表驱动，便于 `--require` 取子集。四层的分工：**工具层管"装没装"，连通性管"通不通"，配置层管"对不对"，一致性管"配不配"**。

### 4.1 运行时层

| 检查项 | 检测逻辑 | 默认级别 | remediation |
| --- | --- | --- | --- |
| `node_runtime` | `process.execPath` + `process.version` 对期望区间（注意 HEY-37 已出现 EBADENGINE：openspec 依赖要求 `^22.13.0`，分析机为 22.12.0） | FAIL | `nvm use <期望版本>` |
| `npm_registry_config` | `npm config get registry` 是否指向内部源 | FAIL | `npm config set registry <内部源>` |

（nvm 不设独立检查项：托管运行机标准为单一固定 node 版本，nvm 目录识别仅用于 `node_runtime` 不合期望时生成 remediation，见 §5.2。）

### 4.2 CLI 工具层

| 检查项 | 检测逻辑 | 默认级别 |
| --- | --- | --- |
| `openspec_cli` | 三态区分（`failure_kind`）：`not_found`（`commandExists` 失败）→ 装；`not_spawnable`（where 命中但 spawn EPERM——npm `.cmd` shim 在 Codex 类受限环境被拦截创建 cmd.exe，tfs-cli SEA 化前科即此类）→ 换 exe 形态或环境放行；`version_mismatch`（可执行但 `openspec --version` ≠ 期望 1.16.0）→ 升降版本。只查 where.exe 会漏掉第二态 | FAIL |
| `rondo_self` | 自身版本输出；自身安装位置（`process.argv[1]` 回溯）是否处于激活版本目录下——rondo 同为 npm 全局包，同样受 nvm 隔离影响 | WARN |
| `git` | `commandExists("git")` + `git --version`（子仓 `git -C` 硬依赖） | FAIL |
| `python` | `commandExists("python")` + `python --version`（`tools/repo_registry.py` 等脚本依赖） | WARN |

### 4.3 服务连通层（默认 WARN，不堵离线场景）

| 检查项 | 检测逻辑 |
| --- | --- |
| `internal_npm_registry` | `npm ping`（超时 ≤5s），区分"没装"与"装不了" |
| `tfs_api` | 经 rondo 既有 TFS 通道做最轻探测。注意 `TfsClient`（`clients/tfs.ts:19`）是子进程 dispatch 包装、无现成心跳方法，需指定具体轻量操作：**新增 `rondo tfs ping` 叶子**（读当前集合信息 + PAT 有效性，顺带成为 doctor 之外的通用排障入口）；PAT 缺失/过期给出既有 token 更新指引 |
| `multica_api` | 经 `clients/multica.ts` 做心跳级调用（最小 list 查询） |

### 4.4 数据/配置层

| 检查项 | 检测逻辑 |
| --- | --- |
| `openspec_root` | `resolveOpenspecRootDir` 解析成功 + `openspec/config.yaml` 可读 + `openspec/schemas/` 目录存在（HEY-37 次级痛点：`corrective-change` schema 缺失引发另一轮搜寻，缺失时 WARN 并列出实际可用 schema） |
| `repo_registry` | `docs/config/repo-context.yaml` 登记的仓路径逐一验证存在且为 git 仓（登记漂移会导致定位阶段整体跑偏）；不在根仓运行时降级为 INFO |
| `tfs_config` | **TFS 三件套环境变量校验**（配置标准：`TFS_PAT / TFS_URL / TFS_COLLECTION` 必须配置在**用户环境变量**）。校验分三个来源逐级核对：① **用户级 env**（Windows 读 HKCU\Environment 注册表 / `[Environment]::GetEnvironmentVariable(name,'User')`，Linux 读 shell profile 落盘处）——这是权威判据，进程 env 有 ≠ 用户 env 有（会话级 `set` 重启即丢、daemon 继承不到）；② 进程 env；③ `config/tfs.config.json` 文件回退。判定：`TFS_PAT` / `TFS_URL` 用户级缺失 → **FAIL**（`failure_kind: missing_pat` / `missing_url`），remediation 给 `setx TFS_PAT "<pat>"`（并提示需重开终端/daemon 重启生效）；仅存在于进程 env（会话级未持久化）→ **WARN**（`session_only`：新会话和 daemon 将丢失）；仅存在于配置文件回退 → **WARN**（`file_fallback`：不符合"用户环境变量"标准，daemon 环境不读该文件的风险自担）；`TFS_COLLECTION` 未配 → INFO（默认 `WINNING-6.0`）。与 `tfs_api` 的分工：本项查"**配没配、配在哪**"（本地、离线可检），`tfs_api` 查"**通了没、有效没**"（在线）；`tfs_config` FAIL 时 `tfs_api` 降级 SKIP |
| `daemon_env` | daemon 场景必需环境变量存在性（参照 test220 事故史：daemon 须带 TFS 环境变量启动）。清单锚定为 `TFS_PAT / TFS_URL / TFS_COLLECTION / MULTICA_DAEMON_ID`（与 `tfs/config.ts`、`check-daemon.ts` 的实际消费对齐，关闭原开放问题）；与 `tfs_config` 的分工：本项查 **daemon 进程环境**里有没有（daemon 继承启动 shell 环境，用户交互 shell 配了不等于 daemon 有），`tfs_config` 查当前进程解析链 |

### 4.5 一致性层（跨项交叉验证）

| 检查项 | 检测逻辑 |
| --- | --- |
| `version_alignment` | rondo 版本 × openspec 版本 × skill 契约期望版本三者对齐；不对齐 WARN 并指出漂移方 |
| `path_precedence` | `where.exe`（Win）/ `which -a`（Linux）返回多命中时报告解析顺序，前置命中与期望版本不符 → WARN（旧 shim 抢占是经典隐性故障） |

## 5. 关键检测算法

### 5.1 commandExists 复用与抽取

HEY-37 日志显示 dist 产物中 `validate.ts` 内联了 `commandExists`（Windows 走 `where.exe`、POSIX 走 `command -v`）。doctor 将其抽取到 `clients/spawn.ts`（或新 `clients/which.ts`；rondo 已有 `which` npm 依赖可用），`validate` 与 `doctor` 共用同一实现，避免两份探测逻辑漂移。

### 5.2 环境偏离检测（替代原 stranded 算法）

**设计前提（2026-11-06 评审裁定）**：托管运行机（daemon/分析机）的正确形态是**单一固定 node 版本**，不需要 nvm；nvm 是开发机工具。doctor 的职责是**验证标准**（node 版本是否符合期望），不是**迁就偏离**（帮人翻旧版本目录找已装的 CLI）。

因此检查逻辑收敛为：

1. `node_runtime` 校验 `process.version` 是否符合期望区间——这是唯一的环境版本判据
2. 不合期望时，检测 nvm home 是否存在（`NVM_HOME` / `%LOCALAPPDATA%\nvm` / `~/.nvm`），仅用于**生成 remediation**：
   - 有 nvm → `nvm use <期望版本>`（若该版本未装则 `nvm install`）
   - 无 nvm → 安装/切换到期望 node 版本的部署指引
3. nvm 存在本身不告警、不扫描各版本目录、不输出安装矩阵——HEY-37 式"装在别的版本"问题在单版本标准下不存在；若机器保留 nvm，那是环境管理问题，不由 doctor 负责盘点

原 stranded 算法（扫描各版本目录找 CLI）**从方案移除**：它为偏离标准的形态设计，会增加实现复杂度并传递"多版本共存是可接受的"的错误信号。

### 5.3 期望版本来源（单一事实源）

- 新增 `src/commands/doctor/expectations.ts`：内置默认期望（node 区间、openspec 1.16.0、内部 registry 地址、daemon 必需 env 清单键名）
- 允许 `--expect-openspec` 等 flag 覆盖；后续若多 skill 需要引用同一期望值，再评估抽到根仓配置文件（第一期不做，避免配置漂移）

### 5.4 性能约束

- 全部检查并行化（Promise.all）；单项超时：本地探测 2s、连通性 2s
- **全程预算 = max(单项超时) + 1s 聚合余量 ≤ 3s**（可验证表述：任何单项超时不超过 2s，故全程 ≤3s；原"单项 5s / 全程 3s"自相矛盾，已修订）
- 任何单项异常不抛出，降级为该当 `result: "FAIL", detail: "check error: ..."`——doctor 自身不得成为新的故障源

### 5.5 聚合与 remediation 依赖序

- 多项 FAIL 时 remediation 按依赖拓扑排序输出：`npm_registry_config` / `internal_npm_registry` 先于一切 `npm i -g` 类处方（registry 不通时安装处方必然失败，应先修 registry）
- 聚合规则：`FAIL 级项未过 → FAIL`；`--require` 命中的项 WARN 按 FAIL 计（exit 2）；其余 WARN 不影响退出码

## 6. 源码落点（本仓 `tools/rondo`）

```
tools/rondo/src/
  commands/
    doctor/
      doctor.ts            # 命令入口：参数解析、检查编排、结果聚合、emitJson
      checks/
        registry.ts        # 检查项注册表（id/level/适用平台/执行函数）
        runtime.ts         # node_runtime / npm_registry_config
        cli-tools.ts       # openspec_cli（三态）/ rondo_self / git / python
        connectivity.ts    # internal_npm_registry / tfs_api / multica_api
        config-data.ts     # openspec_root / repo_registry / tfs_config / daemon_env
        consistency.ts     # version_alignment / path_precedence
      expectations.ts      # 期望版本与常量（§5.3）
      text-format.ts       # text 报告渲染（默认格式，人读）
  clients/
    spawn.ts               # 抽取 commandExists（或新 clients/which.ts）
  index.ts                 # 注册 doctor 命令（leaf 命令挂 program，非 bareGroup）
```

既有机制复用：`cli/output.ts`（emitJson/log/markLeafExecuted）、`clients/spawn.ts`（runCommand/runJson）、`clients/config.ts`、`clients/runtime-paths.ts`、`clients/tfs.ts`、`clients/multica.ts`。

构建/测试沿用既有：`npm run build`（tsc）、`npm test`（node --test）、`npm run build:exe`（SEA，doctor 随 exe 分发无额外工作）。`engines.node >=18.19` 不变——doctor 自身只依赖 fs/child_process，兼容 18。

## 7. 集成点（分期接入，见 §9）

1. **skill 前置**：`workitem-analysis`、`analysis-completion` 等 skill 首步插入 `rondo doctor --require openspec_cli,node_runtime --format json`，FAIL 即停、按 remediation 执行后重跑一次——把"agent 即兴装环境"变成契约行为
2. **Gate 联动（不改变 Gate 语义）**：`openspec_validate` UNKNOWN 时 reason 追加指引"先跑 rondo doctor 定位"，减少人工排查
3. **Run 落证**：doctor 输出写入 Run metadata（如 `doctor.result` / 报告路径），事后审计"为何 UNKNOWN"有据可查
4. **daemon 启动自检（可选）**：daemon 拉起时全量 doctor，FAIL 拒绝接单并输出 text 报告

## 8. 测试与验证方案

本期**不新增 doctor 测试**（诊断类只读命令，验证以人工实跑为准；后续若 doctor 输出被 Gate/skill 强依赖再补）。仅一项被迫的既有测试维护：

- **命令面锚点更新（必做）**：`test/cli-surface.test.mjs` 穷举命令树并断言"命令总数 = 34（防回归锚点）"，bare 组调用必须 exit 64。新增 `doctor` 须同步：顶层 leaf 列表加 `doctor`、总数 34→35。开发首次跑测试不更新即红，列入 P0 任务

人工验证清单（P0 完成标准）：

- **退出码矩阵**：PASS / WARN / FAIL / 用法错误（64）/ 自身异常（3）各实跑一次确认
- **openspec_cli 三态**：`not_found` / `not_spawnable`（受限环境或 mock）/ `version_mismatch` 的 `failure_kind` 与 remediation 正确
- **node_runtime 偏离处置**：在 node 版本不合期望的机器上实跑，确认 remediation 按"有 nvm → `nvm use` / 无 nvm → 安装指引"正确分叉
- **双平台**：Windows（分析机形态，nvm4w + .cmd shim）+ Linux（test220 daemon 形态，`~/.nvm` + bin/）
- **回归验证**：HEY-37 同型环境（v22 激活、openspec 缺失）实跑一次，预期 doctor 3 秒内给出 `not_found` FAIL + 精确 remediation

## 9. 分期与工作量估算

| 期 | 内容 | 预估 |
| --- | --- | --- |
| P0 | doctor 核心：4.1/4.2 全部（含 openspec_cli 三态）+ 一致性层 `path_precedence` + text 报告（默认格式）+ 注册表 + cli-surface 锚点更新（不新增测试，按 §8 人工清单验证） | 1.5d |
| P1 | `--require` 子集 + `--format json` 模式 + skill 前置接入（workitem-analysis / analysis-completion）+ Gate UNKNOWN 指引联动 | 1d |
| P2 | 4.3 连通性（含新增 `rondo tfs ping` 叶子——`TfsClient` 无现成心跳，工作量已含）+ 4.4 配置层 + Run metadata 落证 + daemon 启动自检；评估 `--fix` 白名单 | 2d |

P0 即覆盖 HEY-37 事故类型（openspec 缺失 + node 版本不符），P1 兑现"fail-fast 前置"的主要收益，P2 为增强。

## 10. 风险与开放问题

**已裁决（评审结论，仓库内有先例支撑）：**

1. ~~WARN 语义~~ → **裁定：整体 WARN 退出码 0 + JSON 区分**。与既有 UNKNOWN（exit 3 + JSON 表达）先例一致；`--require` 场景 WARN 升级为 FAIL（exit 2）缓解"被忽略"风险
2. ~~doctor 挂法~~ → **裁定：`rondo doctor` 挂 program 直属 leaf**。`cli-surface.test.mjs` 显示已有顶层 leaf 先例 `rondo query`（不在任何 bareGroup 内），分组风格不构成约束

**仍开放：**

1. **期望版本漂移**：openspec 契约版本升级时 expectations.ts 需同步——P2 评估抽配置后收敛
2. ~~daemon_env 清单来源~~ → **已关闭**：清单锚定为 `TFS_PAT / TFS_URL / TFS_COLLECTION / MULTICA_DAEMON_ID`，与 `tfs/config.ts`、`check-daemon.ts` 的实际消费对齐（见 §4.4 `tfs_config` / `daemon_env` 分工）
3. **存量 nvm 多版本机器**：本方案按"托管机单版本"标准设计，不为多版本形态做安装盘点。存量机器（如 HEY-37 分析机）若保留 nvm 多版本，`node_runtime` 只校验当前版本、remediation 给 `nvm use`；"openspec 装在哪个旧版本"不再由 doctor 回答——环境标准化（单版本固定 node）是根本解，建议在部署手册中明确该标准

## 附录 A：典型场景输出示例

### A.1 HEY-37 事故现场还原（openspec 缺失，默认 text）

```bash
$ rondo doctor   # exit 2
```

```
rondo doctor — FAIL (exit 2)
node v22.12.0 @ C:\nvm4w\nodejs\node.exe · platform win32 · 2.1s

✓ node_runtime        v22.12.0（期望 >=18.19；低于 openspec 依赖期望的 ^22.13.0，记录备查）
✗ openspec_cli        [not_found] where.exe openspec rc=1；PATH 中不存在
                      修复: npm i -g @fission-ai/openspec@1.16.0
✓ npm_registry_config registry=http://172.16.9.57:8081/repository/npm-group/
✓ rondo_self          @winning/rondo@1.0.1，安装于当前激活版本目录
...（其余 8 项略）
```

运维人员照"修复"行逐条执行即可——HEY-37 的 22 分钟考古 = 这一次 2 秒的命令。

### A.2 环境健康（默认 text）

```bash
$ rondo doctor   # exit 0
```

```
rondo doctor — PASS (exit 0)
node v22.12.0 @ C:\nvm4w\nodejs\node.exe · platform win32 · 1.8s

✓ node_runtime        v22.12.0
✓ openspec_cli        1.16.0 @ C:\nvm4w\nodejs\openspec.cmd
...（12 项全 PASS）
```

### A.3 skill 前置（子集 + JSON 模式）

```bash
$ rondo doctor --require openspec_cli,node_runtime --format json   # exit 2
```

```json
{
  "result": "FAIL",
  "node": { "version": "v22.12.0", "path": "C:\\nvm4w\\nodejs\\node.exe" },
  "platform": "win32",
  "checks": [
    { "name": "node_runtime", "level": "FAIL", "result": "PASS",
      "detail": "v22.12.0 在期望区间 >=18.19 内" },
    { "name": "openspec_cli", "level": "FAIL", "result": "FAIL", "failure_kind": "not_found",
      "detail": "where.exe openspec rc=1；PATH 中不存在",
      "remediation": "npm i -g @fission-ai/openspec@1.16.0" }
  ]
}
```

`--require` 命中的项 WARN 按 FAIL 计，任一不过即 exit 2，skill 据此 fail-fast；PASS 项不携带 `remediation`。

### A.4 退出码总表

| 整体结果 | 退出码 | 触发条件 |
| --- | --- | --- |
| PASS | 0 | 全项 PASS（INFO/WARN 不影响，全量模式） |
| WARN | 0 | 有 WARN 无 FAIL（仅全量模式） |
| FAIL | 2 | 任一 FAIL 级项未过；或 `--require` 项 WARN |
| — | 3 | doctor 自身异常（如非预期的环境读取失败） |
| — | 64 | 参数用法错误 |

日志（探测过程、耗时）全部走 stderr；`--format json` 时 stdout 保证可被 `JSON.parse` 直接消费。
