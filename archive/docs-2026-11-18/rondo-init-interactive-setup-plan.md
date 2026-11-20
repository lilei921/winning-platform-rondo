# rondo init 交互式环境初始化落地方案

> 状态：方案已评审修订（审核发现 R1–R5 已合入），暂不开发
> 依据：`rondo-doctor-env-check-plan.md`（doctor 已落地，18 项检查）、本仓 `tools/rondo` 源码（@winning/rondo 1.2.10）
> 日期：2026-11-10（首版）；2026-11-10（评审修订）

## 裁决记录（用户 2026-11-10 确认）

| 编号 | 问题 | 裁决 |
| --- | --- | --- |
| D1 | 命令命名 | **`rondo init`**（兼任"首次装机"与"修复既有问题"，不再另设 setup/fix） |
| D2 | TFS 配置持久化方式 | **直写注册表环境变量**（`reg add`），**不用 setx**。第一版**只写用户级 HKCU**；系统级 HKLM 因 R1/R2 评审发现降为后续期（见 §4.4 与 §9） |
| D3 | Linux profile 写入 | **暂不考虑**（第一期仅 Windows；Linux 形态由 daemon 部署手册覆盖） |

## 1. 背景与定位

`rondo doctor` 已落地（4 层 18 项检查、注册表驱动、只读、text/json 双格式），能把 HEY-37 式"环境考古"压缩到 3 秒诊断 + 人读 remediation。但 remediation 仍需人手逐条执行：

- `openspec_cli not_found` → 人手敲 `npm i -g @fission-ai/openspec@<版本>`（HEY-37 实证 13 秒即可修复，诊断已廉价、修复仍是手工）
- `tfs_config missing_pat` → 人手 `setx` / 注册表配置 TFS 三件套，且 setx 后当前进程不生效，无法当次验证 PAT 有效性

`rondo init` 补上这最后一公里：**复用 doctor 检查结果作为事实源，把"有可执行修复动作"的项列成交互清单，用户勾选后自动执行并当次验证**。

### 与 doctor 的边界（硬约束）

| | doctor（既有，不动） | init（本方案新增） |
| --- | --- | --- |
| 性质 | 只读诊断 | 写操作（装包、改 registry、写用户/系统环境变量） |
| 调用方 | 运维手工 + skill 程序化 | 人（装机验收、修复入口） |
| 契约 | 退出码 / JSON schema / 检查项行为**全部不变** | 独立新命令，只 import doctor 的检查函数 |

**doctor 保持只读**（doctor 方案 §2 非目标裁定：全局环境变更属治理决策）。init 不改 doctor 任何代码路径，只消费其检查产物。

## 2. 目标与非目标

### 目标

1. `rondo init`：交互式装机/修复向导——复跑 doctor 检查 → 列出可修复项（编号 + 级别 + 修复动作）→ 用户勾选 → 按依赖序执行 → 逐项复跑验证 → 汇总报告
2. TFS 配置段：`TFS_PAT` 交互输入（掩码不回显），`TFS_URL` / `TFS_COLLECTION` 提供默认值可回车接受，直写注册表用户级环境变量（HKCU\Environment），并注入当前进程 env 使当次可验证
3. 修复即验证：每项执行后复跑该检查项；TFS 段写后加跑 `tfs_api` 验证 PAT 真实可用

### 非目标（第一期明确排除）

- Linux/macOS 支持（D3）：非 win32 平台直接 exit 64 并说明
- 不自动修 `node_runtime`（node 版本治理属部署标准，doctor 方案 §5.2 裁定沿用：init 验证标准、不迁就偏离）
- 不碰 PATH 类变量（注册表改写 PATH 有截断/覆盖风险，本方案只写 TFS 三件套等独立变量）
- 不做批量/远程装机（单机命令，批量由上层编排）
- daemon 的 OS 服务环境修复（`daemon_env` 项只给指引，见 §4.2）

## 3. 命令与输出契约

### 用法

```
rondo init [--yes] [--only <check,...>] [--skip <check,...>] [--format text|json]
```

- 无参数：交互模式（默认）
- `--yes`：非交互，执行全部默认可修项；TFS 段要求 `TFS_PAT` 已在进程 env（否则该项标记 skipped_no_input，不算失败）
- `--only` / `--skip`：白名单/黑名单子集（语义对齐 doctor `--require` 的名称空间）
- `--format`：默认 `text`（人读，同 doctor 定位）；`--format json` 供程序化消费修复回执

（`--tfs-scope system` 已按 R1/R2 评审发现从第一版移除，见 §4.4 与 §9。）

### 退出码（沿用 rondo 枚举风格；R4 修订）

| 退出码 | 含义 |
| --- | --- |
| 0 | 修复后全部 FAIL 级项复验通过（含"环境健康无需初始化"） |
| 2 | 修复后**仍有 FAIL 级项未过**——无论该项可不可自动修（如 `node_runtime` 未达标只给指引，同样 exit 2；可修/不可修仅在 JSON 里区分 `skipped` / `not_fixable`，不影响退出码） |
| 3 | init 自身异常（注册表读写失败等非预期错误） |
| 64 | 用法错误（含非 TTY 无 `--yes`、非 win32 平台） |

（R4：原设计"仅剩不可自动修项也 exit 0"会让脚本误判环境健康，已收紧为与 doctor 语义一致——FAIL 级项未过即 exit 2。）

### TTY 守卫

非 TTY（daemon/CI/管道）且未给 `--yes` → exit 64 + 提示。交互命令挂起是故障源，宁可拒绝。

### JSON 输出（`--format json`）

```json
{
  "result": "PASS | FAIL",
  "platform": "win32",
  "fixed": [
    { "name": "openspec_cli", "failure_kind": "not_found",
      "action": "npm i -g @fission-ai/openspec@1.13.2",
      "verify": "PASS", "detail": "1.13.2 @ C:\\...\\openspec.cmd" }
  ],
  "skipped": [
    { "name": "node_runtime", "reason": "not_auto_fixable",
      "guidance": "nvm use <期望版本>" }
  ],
  "failed": []
}
```

PAT 红线（沿用 tfs/config.ts 契约）：**任何输出（text/json/日志）不出现 PAT 明文**；action 描述中 TFS 段只写 "写入 HKCU\\Environment: TFS_PAT/TFS_URL/TFS_COLLECTION"。

## 4. 核心设计

### 4.1 事实源唯一：复用 doctor 注册表

init **不重写探测逻辑**，直接 import doctor 的 `CHECKS` / `selectChecks`（`commands/doctor/checks/registry.ts`），以 json 模式同款结构化结果（`name/level/result/failure_kind/remediation`）驱动展示与筛选：

```
runChecks(全部非 opt-in 项) → 过滤 result ∈ {FAIL, WARN} → 查 remedies 注册表分流:
  有可执行动作   → 进入勾选清单
  无动作/不可修  → 进入"指引区"（灰显，打印 remediation 人读指引）
```

doctor 的 `remediation` 字段保持人读字符串不动；可执行动作单独登记，二者按 `(name, failure_kind)` 关联。

### 4.2 修复动作注册表（remedies.ts）

```ts
type Remedy = {
  check: string;                    // doctor 检查项名
  failureKinds?: string[];          // 限定 failure_kind；缺省匹配全部
  describe: (ctx) => string;        // 清单展示用一句话
  run: (ctx) => Promise<RemedyOutcome>;
  needsConfirm?: boolean;           // --yes 模式下仍要显式确认的动作（第一期无）
};
```

第一版登记：

| 检查项 | failure_kind | 动作 | 备注 |
| --- | --- | --- | --- |
| `openspec_cli` | `not_found` / `version_mismatch` | `npm i -g @fission-ai/openspec@<期望版本>` | 期望版本读 `expectations.ts`（单一事实源） |
| `openspec_cli` | `not_spawnable` | 不可自动修 → 指引区 | 受限环境拦截 cmd shim，属环境放行问题 |
| `npm_registry_config` | — | `npm config set registry <INTERNAL_NPM_REGISTRY>` | 常量复用 expectations |
| `tfs_config` | `missing_pat` / `missing_url` / `session_only` / `file_fallback` | 进入 §4.3 TFS 交互配置段 | 四种失败形态同一入口 |
| `node_runtime` | — | 不可自动修 → 指引区 | `nvm use <期望>` / 部署手册 |
| `repo_registry` / `openspec_root` | — | 指引区 | 涉及仓检出/文档补齐，非一条命令 |
| `daemon_env` | — | 指引区 | 改的是 daemon 的 OS 服务环境，本进程修不了 |
| `rondo_self` / `python` | — | 指引区（WARN 级默认不勾选） | `npm i -g @winning/rondo@latest` 可后续增补 |

**依赖拓扑**（沿用 doctor 方案 §5.5）：执行前查 `internal_npm_registry` 与 `npm_registry_config` 结果；registry 未配/不通时，所有 `npm i -g` 类动作自动排在其修复之后，仍不通则标 `skipped: registry_unreachable`（避免 HEY-37 式盲装）。

### 4.3 TFS 交互配置段（D1/D2 落地）

触发条件：`tfs_config` 检查未过（含 WARN 的 `session_only`/`file_fallback`——这两态意味着"配了但没配对地方"，init 正是归位工具）。

交互形态：

```
TFS 配置(写入用户环境变量 HKCU\Environment):
  TFS_PAT        : ********                       ← 手动输入,掩码不回显
  TFS_URL        : [http://tfs2018-web.winning.com.cn:8080/tfs]  ← 回车取默认
  TFS_COLLECTION : [WINNING-6.0]                  ← 回车取默认
```

- **默认值来源**:`TFS_URL` 默认取 `tfs/config.ts` 的 `DEFAULT_BASE_URL`,`TFS_COLLECTION` 默认取 `expectations.ts` 的 `DEFAULT_TFS_COLLECTION`。两处常量现状一致（`WINNING-6.0` / tfs2018-web 地址）；为避免双事实源漂移，实施时把 `DEFAULT_BASE_URL` 从 tfs/config.ts 导出复用（或上移至 expectations），**只留一处**。
- **已存在的值做默认**:`tfs_config` 三来源核对已给出各变量来源；进程 env / 配置文件里已有的值作为对应项的当前默认（PAT 除外——PAT 永远重新输入，不回显、不以旧值为默认展示，过期 PAT 就该换）。
- **输入校验**:PAT 非空（trim 后）；URL 以 `http(s)://` 开头；COLLECTION 非空。非法即重问，最多 3 次后放弃该项。

### 4.4 注册表写入（D2：reg add，不用 setx；R1/R2 修订）

第一版**只写用户级**：

```
reg add "HKCU\Environment" /v TFS_PAT /t REG_SZ /d "<pat>" /f
```

- **与 doctor 判据天然兼容**:doctor `userEnvHas()` 读的就是 `reg query HKCU\Environment /v <name>`（`config-data.ts:101`）——reg add 写完即 PASS，无 setx 的转义/1024 截断史问题。
- **系统级 HKLM 从第一版移除（R1/R2 评审发现）**：
  - **R1 优先级事实**:Windows 构建进程环境时先系统后用户，**HKCU 覆盖 HKLM 同名值**（仅 Path 例外为追加合并）。用户级存在旧值时写系统级新值，**新值在未来进程里不生效**，且 init 的 process.env 注入会掩盖这一点（当次验证 PASS、重开终端回到旧值）——原方案"HKLM 优先于 HKCU"的表述有误。
  - **R2 判据冲突**:doctor 配置标准是"必须配置在**用户**环境变量",`userEnvHas` 只读 HKCU。写 HKLM 后 `tfs_config` 依然 FAIL,"写完即 PASS"对系统级不成立。HKLM 若未来需要，前置条件是 doctor 判据同步放宽（接受 HKLM 为合法来源），届时再恢复 `--tfs-scope` 并配套管理员权限检测（`net session` rc，非管理员拒绝且"不写一半"）。
- **PAT 不落命令行历史的顾虑不成立但需实现纪律**:`reg add` 经 `clients/spawn.ts` 子进程直接 spawn（不走 shell），无 shell history；但**命令行参数对同机进程短暂可见**（wmic/任务管理器命令列），属可接受的本地暴露面（与 setx 同等），写日志时参数必须脱敏。
- **生效广播（尽力而为）**:reg add 不触发 `WM_SETTINGCHANGE`，已开窗口不感知。附加一步 PowerShell P/Invoke `SendMessageTimeout(HWND_BROADCAST, WM_SETTINGCHANGE, "Environment")` 广播；失败仅记 stderr，不阻塞（权威生效路径仍是"重开终端/重启 daemon"，报告里必须写明）。
- **当次生效**（init 核心体验）：写入成功后同步 `process.env.TFS_PAT/URL/COLLECTION = 输入值`，使后续验证项当次可跑——这是 init 优于"人手 setx + 重开终端"的关键差异。

### 4.5 修复即验证

- 每项动作执行后，按 `name` 重取 doctor 对应检查函数单跑（复用 `guard()` 同款异常兜底），PASS 才算 fixed。
- `openspec_cli` 修复后除重跑检查外，报告实际落点路径（`where.exe openspec` 首命中），呼应 `path_precedence` 检查。
- TFS 段写后双验：`tfs_config`（配置层，应为 PASS）+ `tfs_api`（连通层，验证 PAT 真能用）；`tfs_api` 失败时整体 exit 2，detail 区分"写了但 PAT 无效"与"写了但网络不通"。

## 5. 交互实现

- **readline/promises**（Node 内置，**零新增依赖**——rondo 走 SEA 打包，依赖越少越好）。
- 多选清单：编号列表，接受 `1,3` / `all` / `q`；空输入 = 只打印指引区后退出（exit 0）。
- PAT 掩码：readline 自定义 output stream 静默回显（标准 muted-readline 写法），输入过程不出现明文。
- 环境健康短路：全项 PASS 时直接打印"环境健康，无需初始化"exit 0，不进交互。

## 6. 源码落点（本仓 `tools/rondo`）

```
tools/rondo/src/commands/
  init/
    init.ts            # 命令入口:参数解析、TTY 守卫、平台守卫(win32)、流程编排、emitJson
    remedies.ts        # 修复动作注册表(§4.2)
    prompt.ts          # readline 交互:多选清单、TFS 三件套输入(PAT 掩码)
    persist-env.ts     # reg add 用户级写入 + WM_SETTINGCHANGE 广播 + process.env 注入
  doctor/              # 零改动;init 只 import CHECKS/selectChecks/expectations 与检查函数
                       # （R3：doctor.ts 的 guard 未导出——init 自带同款异常兜底 wrapper，不为 import 给 doctor 加 export）
tools/rondo/src/index.ts                # registerInit(program)——顶层 leaf(先例:query/doctor,§10 裁定 2)
tools/rondo/test/cli-surface.test.mjs   # 锚点 36→37,顶层 leaf 列表加 init(必做,防回归)
```

既有机制复用：`cli/output.ts`（emitJson/logLine/markLeafExecuted/ExitSignal）、`clients/spawn.ts`（runCommand/runJson）、`clients/which.ts`、`doctor` 全部检查函数与 `expectations.ts` 常量、`tfs/config.ts` 默认值。

构建/测试沿用既有：`npm run build`（tsc）、`npm test`（node --test）、SEA 打包无额外工作（readline/reg add 均为内置能力）。`engines.node >=18.19` 不变。

## 7. 测试与验证方案

沿用 doctor 方案 §8 的裁定：**诊断/向导类命令不新增自动化测试**，验证以人工实跑为准。仅一项被迫的既有测试维护：

- **cli-surface 锚点更新（必做，P0）**：命令总数 36→37，顶层 leaf 加 `init`。

人工验证清单（P0/P1 完成标准）：

| 场景 | 预期 |
| --- | --- |
| 健康环境跑 init | 直接 exit 0，不进交互 |
| openspec 缺失环境 | 勾选后 `npm i -g` 执行成功，复验 PASS，exit 0（HEY-37 同型回归） |
| `tfs_config` missing_pat | 交互输入三件套 → HKCU\Environment 可 `reg query` 命中 → 当次 `tfs_api` PASS |
| session_only 形态（进程 env 有、注册表无） | init 归位到注册表后 `tfs_config` PASS |
| 修复后仍有 FAIL 级不可修项（如 node_runtime 未达标） | exit 2（R4：不给"假健康"），指引区有明确处方 |
| 非 TTY 无 `--yes` | exit 64 + 提示 |
| PAT 红线 | 全程输出/日志无 PAT 明文（含 registry 写入失败的错误日志） |
| `--yes` + 进程 env 无 TFS_PAT | TFS 段 skipped_no_input，不影响其他项，exit 按其余项结果 |

## 8. 分期与工作量估算

| 期 | 内容 | 预估 |
| --- | --- | --- |
| P0 | init 骨架（参数/TTY/平台守卫、doctor 结果复跑、多选清单、指引区）+ openspec_cli / npm_registry_config 两类自动修复 + 依赖拓扑 + cli-surface 锚点 | 1d |
| P1 | TFS 交互配置段（掩码输入、reg add 用户/系统级、广播、process.env 注入、写后双验） | 1d |
| P2 | `--yes/--only/--skip/--format json` 非交互面打磨 + 修复失败残留报告细化 + `rondo_self` 自升级动作评估 | 0.5d |

P0 覆盖 HEY-37 事故修复类型；P1 兑现 TFS 配置"一次输入、当次生效、当次验证"。

## 9. 风险与开放问题

**已裁决**：D1 命名 init；D2 reg add 直写注册表（第一版仅用户级 HKCU）；D3 暂不支持 Linux。

**评审修订记录（2026-11-10 审核，源码核实）**：

| 编号 | 发现 | 处置 |
| --- | --- | --- |
| R1 | 原方案"HKLM 优先于 HKCU"事实错误——Windows 实际为 **HKCU 覆盖 HKLM**（仅 Path 追加合并），用户级旧值会使系统级新值在未来进程失效 | HKLM 从第一版移除（§4.4） |
| R2 | system scope 与 doctor 判据冲突：`userEnvHas` 只读 HKCU，写 HKLM 后 `tfs_config` 仍 FAIL，"写完即 PASS"不成立 | 同上；HKLM 恢复的前置条件是 doctor 判据放宽 |
| R3 | §6 原写 import `guard`，但 `guard` 是 doctor.ts 模块内函数未导出 | init 自带同款异常兜底 wrapper，保住"doctor 零改动"硬约束（§6） |
| R4 | 原退出码"仅剩不可自动修项也 exit 0"会让脚本误判环境健康 | FAIL 级项未过一律 exit 2，与 doctor 语义对齐（§3 退出码） |
| R5 | doctor 既有 remediation 文案仍指引 `setx`（`connectivity.ts:54`、`config-data.ts:148`） | 不阻塞本方案；init 上线后另起任务改指 `rondo init`（属 doctor 文案编辑） |

**仍开放：**

1. **默认值双事实源**:`DEFAULT_BASE_URL`（tfs/config.ts）与 `DEFAULT_TFS_COLLECTION`（expectations.ts）分处两地，实施时收敛导出关系（P1 内顺带完成，不单列任务）。
2. **HKLM 支持路径**：若 daemon 主机未来确需系统级配置，需先放宽 doctor `tfs_config` 判据（接受 HKLM 为合法来源并处理 HKCU 旧值覆盖问题），再恢复 `--tfs-scope system`（管理员检测 + "不写一半"）。当前无此需求，不预留实现。
3. **后续扩展位**：`rondo_self` 自升级（`npm i -g @winning/rondo@<latest>`）、`git`/`python` 缺失的 winget 安装指引，P2 后按使用反馈增补 remedies 条目即可，架构已为此预留（注册表驱动）。
