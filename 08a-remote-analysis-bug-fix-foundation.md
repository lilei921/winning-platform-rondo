# 08-A｜共享基础（含 Wayfinder）与独立 Bug Fix

状态：**P0，08-A 本地实现已落地，隔离 Bug 正向 E2E 已闭环，完整 Runtime 验收仍有缺口。** [08 总览](08-remote-analysis-git-workspace-design.md) · [08-B Requirement](08b-requirement-remote-git-delivery.md)。源码、Agent / Skill 执行资产已按本页同步；未发布 Runtime 或切换生产。实施与验证证据见 [08-A 本地实施记录](validation/new/08a-implementation-2026-11-14.md)。

## 1. 目标与边界

**目标**：先交付 08-A / 08-B 共用的 Wayfinder 准入、原生根仓就绪校验、远程源码读取及必要业务仓准备能力；真实 `tfs.type=Bug` 经 Wayfinder 准入后，由 Bug Fix Agent 完成诊断、修复、验证和 PR，PR Status Sync 在另一 Runtime、无原工作区时完成 TFS Writeback 与 Issue Done。

- **本阶段**：Wayfinder 的 Bug / Requirement 共享准入与交接、Multica 原生根仓 checkout 就绪校验、三个远程 MCP 优先读取、`rondo dev prepare`、Bug Fix 的必要适配和跨 Runtime 收口。
- **不在本阶段**：Requirement 的 `analysis.source`、Human Approval、OpenSpec 工件发布、Tasks / Evidence 更新、Lead 派发、Archive。
- **事实归属**：Multica Issue 持有指派与交付事实；业务 Git Commit / PR 和现有 `bug.delivery` 持有修复与验证事实。不新增 Bug OpenSpec、Evidence 文档、交付状态机或独立工作区服务。

遵循 [01 设计规范](01-multica-openspec-design-guideline.md) 的 Native First、Specialist Focus、KISS、One Rule, One Owner。Wayfinder 只负责准入；Bug Fix Agent 负责诊断与修复；Rondo 负责确定性仓库操作 / Gate；PR Status Sync 负责核实与触发收口，不唤醒原 Agent。

### 1.1 Wayfinder：两阶段共享准入

Wayfinder 同时服务 Bug 与 Requirement，属于两阶段共同依赖的基础能力。按现有 [workitem-triage](workspace-skills/workitem-triage/SKILL.md) 与 [Handoff Contract](workspace-skills/workitem-triage/references/multica-handoff-contract.md)形成并回读有效 `/note`，再由现有确定性入口分别交接 Bug Fix Agent / Delivery Squad。

**首次入口分阶段执行，权威约定见 [02 §4.1](02-multica-delivery-lifecycle-design.md#wayfinder-entry-stages)**：当前研发测试为便于独立观察，TFS Sync 初始化后停放于 `backlog + Wayfinder`，由 Human 手动改为 `todo`；研发结束后的目标态仍由 TFS Sync 初始化回读成功后单次自动改 `todo`。两者均保留 Wayfinder 指派并由原生状态触发准入。自动驱动目标没有取消，不应将其认定为旧规则残留；当前手动测试也不代表自动入口已验收。

共享验收覆盖两类来源的准入、恢复、来源变化、结果未知时对账及唯一交接；手动入口和目标自动入口分别记录证据，细项见 [Wayfinder 验收清单](validation/wayfinder-asset-acceptance-2026-10-28.md)。Requirement 的后续研发、审批与工件发布仍由 08-B 负责。

## 2. 必需能力

### 2.1 根仓：原生供应与就绪校验

**Wayfinder Agent、Bug Fix Agent、Workitem Analyst、Engineer（Backend / Frontend）均使用同一约定：根仓 checkout 由 Multica 原生能力提供。** 各 Agent 在读取根仓规范前，确认原生供应已完成并消费平台返回的**实际根仓路径**；核对目录可读、路径为 Git 根目录且所需规范文件可读取。根仓就绪检查不查询 Run、Actor 或 Issue 负责人。Resource 已登记或 cache 已同步均不单独等于 checkout 已完成。08-A 验收 Wayfinder / Bug Fix 的接入，08-B 验收 Workitem Analyst / Engineer 的接入，共享规则一致。

Desktop 0.9.0 的真实 TT-5 / TT-6 运行表明，Resource 清单不自动触发 Task checkout。首次尚无根仓时，在 Task workdir 调用平台原生 `multica repo checkout <已登记根仓 URL>`，沿用 Resource ref，取得平台返回路径后再校验；禁止 `--fresh`、自行 Git clone 或 Bootstrap。供应失败或目录不可用时停止受影响步骤；结果未知先回读现场，不增加缓存预热或自动重试逻辑。已有 checkout 的同一 Task 重入只重新校验，保留本地修改和 Commit。此为共享原生供应契约修正，不推进 08-B 的交付实现。禁止从已检出的根仓 cwd 再次 checkout 根仓，以免产生重复嵌套目录。

需要本地根仓的 Rondo 命令显式接收 `--root-repo <path>`，只做本地 Git 根校验及所需目录派生，不从 Project 挂载或 daemon 重新发现路径。根仓可用不等于业务操作获准；Bug 准备、Git 写入及 PR 准备在各自操作入口核验执行者、来源、仓库范围和交付状态。

根仓本地 Task 分支不推送。checkout 就绪不等于内容最新；Bug 读取规范时按需通过安全只读视图核实所需的 `main` 内容，无法取得有效内容时停止受影响工作，不覆盖现有工作树。不将此检查升级为 Requirement 的跨 Run 工件发布 / 审批机制。

### 2.2 业务源码：Remote MCP 优先

- 业务源码的只读调查优先使用已授权、启用的 `remote-codegraph`、`remote-filesystem`、`remote-ripgrep`。各 Agent Instructions 直接说明本角色的 MCP 用途、选择和边界；[`codebase-explorer`](workspace-skills/codebase-explorer/SKILL.md) 按需提供调查方法，不作为调用 MCP 的前置条件。只读取**已授权业务仓**，不自动建索引；本次修复的实现核对与验证以当前 Task 的业务工作树及 Candidate Commit 为准。
- 仓库身份与相对 `repo_path` 来自 `repo-context.yaml`；交付目标分支来自渲染后的 Rondo Registry `default_target_branch`，其配置归属为现有 `repo-registry.base.json` 的 `delivery`。远程镜像当前分支另行核实，不将它或默认 `main` 当成交付目标；必要分支事实缺失时停止受影响判断。
- 通过当前 MCP 授权目录取得服务器根路径，再结合已核实的 `repo_path` 定位；CodeGraph 显式使用服务器子仓 `projectPath`。服务器路径与 Task 本地路径分别使用，不照搬历史 validation 的绝对路径，不新增第二份仓库映射或路径服务。
- 服务器只读镜像接受定时同步延迟。对关键结论保留**最少必要**的仓库 / 分支、实际版本（可取得时）及源码位置；版本未知、索引与源码不一致时说明限制，关键调用关系必须以可核实的源码为准，不把图谱线索当事实。无需每轮固定 Commit、完整调用图、索引时间报告或调用耗时统计。
- 复用已有服务器 Git 同步与 MCP 配置，先验证仓库 / 路径授权、只读权限、可用版本及基本一致性。**不把新增索引监控、同步状态服务、性能计量作为 P0 必交付**；如当前设施无法安全读取，再仅修复实际阻塞。
- 只有 MCP 不可用或明确需要最新 / 历史 TFS 版本时，才按需复用 TFS Git API 只读查询；不为每次 Bug 追加 API 复查。敏感路径和仓库越权不得通过任何兜底入口读取，凭据不得进入 URL / 日志。

#### 2.2.1 Workspace MCP 配置供给与维护

**实现状态（2026-11-15）**：三个 MCP 已纳入 `rondo workspace provision` 的仓内配置与供给逻辑；本次仅实施代码和本地验证，按用户要求不修改平台。实际平台响应适配、连接配置生效与新 Task 调用仍须在服务恢复后验收；不把本地夹具结果视为线上通过。操作说明与连接输入格式见 [MCP 维护说明](workspace-skills/_shared/mcp/README.md)。

配置归属如下，不新增第二份仓库路径映射：

| 内容 | 权威位置 | 保存规则 |
| --- | --- | --- |
| 受管 MCP 名称、模板及 Agent 绑定 | [`_shared/provisioning.json`](workspace-skills/_shared/provisioning.json) | 纳入 Git，初始化与后续维护同源 |
| 连接文件名、只读工具白名单与兼容策略 | [`_shared/mcp/`](workspace-skills/_shared/mcp/README.md) | 纳入 Git，禁止实际 endpoint / token / headers 值 |
| 已解析 MCP ID、可选连接文件引用覆盖、部署阶段 | `_shared/workspaces/<name>.json` | provision 保存 ID 与显式阶段；不保存凭据 |
| 完整连接配置 | Multica workspace MCP library | 创建 / 显式更新时通过 stdin 注入；完整连接源文件在维护前准备并受控备份，不从环境变量读取 |
| 实际绑定及 enabled 状态 | Multica Agent MCP assignments | 写后回读校验；注册条目不等于 Agent 已绑定 |

默认 `08-a` 阶段为 Wayfinder、Bug Fix Agent 绑定三个 MCP。Workitem Analyst、Backend Engineer、Frontend Engineer 的同一组绑定已在 manifest 声明，仅显式选择 `--mcp-phase 08-b` 后供给；该参数不代表 08-B 流程已验收或授权上线。TFS Sync、PR Status Sync、Delivery Lead 不默认绑定。

供给规则：

1. 正式维护前先校验模板、引用及全部受管 MCP 的预备连接文件；缺文件、空地址或格式非法时在访问平台前停止。地址直接维护于 `mcp/connections/<name>.local.json` 的 `url` 字段，不从环境变量取值。`--dry-run` / `--check` 不要求秘密文件，仅检查公开元数据。
2. 保存 ID 优先核对；无 ID 时仅接管目标 workspace 中唯一同名条目。名称重复、已保存 ID 失效、平台响应不明时停止，不自动换绑或重建。
3. 条目供给后完成 Agent 绑定和启用，并回读确认。重复执行只补缺失条目 / 绑定，不覆盖已有完整连接配置；不删除非受管条目或额外绑定。
4. `--update-mcp <name,...>` 才替换指定条目的完整配置，保留 server ID。地址变更、模板调整、凭据轮换均按此执行；必须提供完整连接输入，不能依赖平台导出旧凭据。
5. 失败保存已确认 ID；写入返回未知时不自动重放，重入先回读。`--dry-run` 与 `--check` 均不写平台或 overlay；检查缺失 / 绑定禁用返回 `2`，无法确定返回 `3`。
6. 本机 Multica 0.8.2 CLI 帮助明确 MCP 完整配置只写，`list` 仅返回公开元数据。因此 `--check` 的 PASS 仅证明本次可观察的条目 / 绑定满足要求；输出始终单列 `mcp_configuration=WRITE_ONLY_NOT_VERIFIED`、`mcp_runtime=NOT_RUN`，不声称连接内容无漂移或服务可用。

工具策略由模板统一维护：CodeGraph 仅启用 `codegraph_explore`；filesystem 仅启用目录发现、文本读取及文件查询工具；ripgrep 仅启用 `search`。ripgrep 的 `default_tools_approval_mode=approve` 是现有 [TT-9 验收](validation/new/08a-runtime/remote-mcp-followup.md) 的限定兼容策略，不能扩展到其他工具或全局审批。工具白名单不替代服务端目录授权；本次未修改远程服务权限。

验收分层：本地验证覆盖初始化、重复执行、阶段选择、显式更新、只读检查、缺凭据、异常清单、部分失败恢复、绑定回读失败与凭据脱敏；平台恢复后再验证真实 workspace 供给、新 Task 三 MCP 调用及越界 / 敏感路径矩阵。历史 TT-9 正常查询成功不替代本次初始化链和 V07 验收。

本地验证（2026-11-15）：`npm run build` 通过；`mcp-reconcile.test.js`、`workspace-mcp.test.mjs` 与既有 `workspace-environment.test.mjs` 共 **36 项通过**。其中新增 21 项覆盖 MCP 逻辑与 CLI 集成，15 项覆盖原有环境 / workflow / 恢复契约。CLI 测试全部使用临时目录和本地 Multica 替身；未读取或写入真实 MCP 连接配置。

前一版初始化供给的 Rondo 全量 `npm test`：**438 项通过、0 失败、3 项跳过**（共 441 项；符号链接及现场只读目录相关用例跳过）。首次沙箱执行因本机 HTTP 测试服务连接 `EACCES` 中止，允许本机回环连接后重跑通过。日志位于本地忽略目录 `tools/rondo/build/mcp-provision-regression-local.log`；本次连接文件调整重跑构建与上述 36 项相关回归，未重复运行无关全量用例；平台初始化与真实工具调用仍为 `NOT_RUN`。

<a id="dev-prepare"></a>

### 2.3 业务仓：`rondo dev prepare`

**实现状态（2026-11-14）**：已注册 `rondo dev prepare`，薄入口为 [prepare.ts](../../tools/rondo/src/commands/dev/prepare.ts)，安全主体为 [prepare-workspace.ts](../../tools/rondo/src/commands/dev/prepare-workspace.ts)。共享只读入口为 `rondo runtime check-checkout`；`rondo bug prepare-pr` 复用同一 Task / 路径校验。`rondo bug git --operation fetch|push` 为后续网络交付提供同一工具与认证，不接受任意 Git 参数。TT-6 已完成实际 prepare/reuse/fetch/push/PR，详细证据与剩余矩阵见 [Runtime 报告](validation/new/08a-runtime/README.md)。

业务仓准备使用单一确定性入口：

```bash
# 在 Multica 已提供的根仓下准备指定业务仓。
rondo dev prepare --config "<repo-registry.json>" --issue <KEY> \
  --repo <repo-key> --root-repo "<已校验就绪的根仓绝对路径>"
```

#### 2.3.1 职责、调用者与输入

职责是：在已就绪且属于当前 Task 的根仓下，为一个已授权业务仓准备可安全使用的独立 Git 目录与候选分支。只处理 `--repo` 指定仓库，不准备根仓或无关子仓，不创建 worktree hub / 工作区服务。

| 使用方 | 根仓来源 | `dev prepare` 的使用范围 |
| --- | --- | --- |
| Wayfinder / Workitem Analyst | Multica 原生 checkout，只做 §2.1 校验 | 常规准入 / 静态分析使用三个远程 MCP；不因读取源码而调用业务仓准备 |
| Bug Fix Agent | 同上 | 08-A：在有效 Bug 授权范围内，确需修改、本地验证或复现时按需调用 |
| Engineer（Backend / Frontend） | 同上 | 08-B：基于有效 Approval / Dispatch / `repo_keys[]` 调用共享准备主体 |

命令不承担语义诊断、测试执行、Commit / Push、PR 创建、TFS Writeback 或 OpenSpec Archive。三个远程 MCP 是调用前的调查入口，`dev prepare` 本身不依赖每次 MCP 调用或固定版本 API 复查。方案中的 clone / fetch / push 联合验收覆盖后续交付链，**不表示 prepare 自动 push**。

| 输入 / 事实 | 来源与校验 |
| --- | --- |
| `--config` | 当前 Runtime 可读取的已渲染 Rondo Registry；检查本命令必需字段，不另建配置副本 |
| `--issue` | 通过现有 Multica 客户端读取有效 Issue、Workspace / Project、来源与指派；命令参数不替代实际 Task 绑定 |
| `--repo` | 必须命中 Registry；身份 / 相对 `repo_path` 来自 `repo-context.yaml`，交付目标分支来自 `delivery.*.default_target_branch` |
| `--root-repo` | 平台已提供的实际根仓；按 §2.1 校验就绪、Task 归属及 Git 身份，不接受任意绝对路径作为授权 |
| Git 与认证 | Runtime 受控工具配置和现有 TFS 认证配置；不增加 PAT 参数，不把凭据写入 URL、Git origin 或共享 Registry |

#### 2.3.2 现有依赖与最小实现范围

| 领域 | 已有能力 / 源码依据 | 本次实现 / 后续范围 |
| --- | --- | --- |
| CLI 与结果 | [index.ts](../../tools/rondo/src/index.ts)、[loadConfig](../../tools/rondo/src/clients/config.ts)及既有错误 / 结果约定 | 已新增 `commands/dev/prepare.ts` 并注册。薄入口只处理参数、编排和输出；现有配置读取不是业务仓完整校验器，需补本命令字段校验 |
| Registry 投影 | [repo_registry.py](../../tools/repo_registry.py)读取 YAML；[workspace/sync.ts](../../tools/rondo/src/commands/workspace/sync.ts)的 `renderRegistry` 合并交付配置 | 已在 Python 记录 / 输出及 TypeScript 渲染两处透传 `repo_url`；复用现有 `repo_path`、`tfs_repo`、`default_target_branch`，不新增第二份仓库登记 |
| 根仓与 Task 身份 | [runtime-paths.ts](../../tools/rondo/src/clients/runtime-paths.ts)已校验绝对路径、存在性及 Git top-level | 已通过 `native-checkout.ts` 补只读 Task / Issue / Project / Agent / Resource 绑定和 origin 一致性校验；与 `bug prepare-pr` 共用，不扩展成根仓准备服务 |
| Bug 开工授权 | [bug/prepare-pr.ts](../../tools/rondo/src/commands/bug/prepare-pr.ts)已有 Bug 来源、状态和冲突检查；[bug/scope.ts](../../tools/rondo/src/commands/bug/scope.ts)已有指派 / Scope 判断 | 已提取 `bug/authorization.ts` 的开工检查，结合原生校验绑定实际调用 Agent；不提前要求 Candidate、Evidence、PR 或写入 `bug.required_repos` |
| Git 工具与认证 | [spawn.ts](../../tools/rondo/src/clients/spawn.ts)支持显式程序、cwd、env 和超时；[git.ts](../../tools/rondo/src/clients/git.ts)封装命令；[remote-artifacts.ts](../../tools/rondo/src/commands/delivery/remote-artifacts.ts)已有受控认证环境与脱敏 | 提取必要的共享 Git 调用能力，支持 Runtime 兼容工具组合；新增业务仓 clone / 分支准备 / 安全复用，不能让该能力依赖 Requirement Archive 语义 |
| Requirement 授权（08-B） | [dev/materialize.ts](../../tools/rondo/src/commands/dev/materialize.ts)、[dispatch-facts.ts](../../tools/rondo/src/commands/dev/dispatch-facts.ts)已有批准与派发基础 | 在 writer / reader 两端扩展 `repo_keys[]`，核实实际 Engineer 与有效派发；当前 [DispatchEntry](../../tools/rondo/src/commands/dev/dispatch-entry.ts)没有该字段，不视为已实现 |

**Registry 依赖链**：`repo-context.yaml → tools/repo_registry.py → workspace sync.renderRegistry → 各 Skill 的 repo-registry.json → dev prepare`。YAML 已有 `repo_url`，仅修改 Python 不足以完成透传，TypeScript 渲染也需接入。当前 Sync 调用 `list` 不带 `--present-only`，并未过滤未 checkout 的仓库，因此支持首次准备已登记仓；仅存在于 `.example` 的条目不会自动进入运行 Registry。`repo_status=present` 只表示目录存在，不能代替 Git / checkout 校验。

仓库身份校验可复用 [canonicalRepositoryIdentity](../../tools/rondo/src/commands/delivery/evidence-repository.ts)及 [repositoryUrl](../../tools/rondo/src/commands/analysis/source.ts)的规范化 / URL 检查能力。涉及 candidate 的既有入口不能用虚构 SHA 调用；只提取本命令真正需要的身份校验，确认 URL、TFS Collection / Project / Repository 一致后再使用认证。

#### 2.3.3 就绪与授权检查的实际缺口

**已核实的 Task 绑定来源**：只读回查历史真实 TEST-5 Run 与其平台文件，确认 Run API 提供 `id / issue_id / agent_id / workspace_id / status / work_dir`；Task 环境的 `MULTICA_TASK_ID / MULTICA_AGENT_ID / MULTICA_WORKSPACE_ID` 在历史真实 Runtime 证据中存在。当前实现只接受在线 `running` 的同一 Run，交叉核对 Issue 指派、`.multica/daemon_task_context.json`、Project Resource 在线列表和 `.multica/project/resources.json`，再核对实际根仓与 origin。

当前支持 `work_dir/<所选 Resource URL 对应目录名>` 原生独立 checkout 形态，不固定根仓名称。以显式 `--root-repo` 指定仓库的完整 Git origin 唯一匹配当前 Project Resource，再核对 Resource 与 Task manifest 一致、路径属于当前 Task 的对应直接子目录。Project Resources 没有独立的根仓角色标记，根仓由调用方按任务选择，校验器验证其登记身份与 Task 归属，不凭目录名推断业务角色。缺少 Task 身份、未运行、Resource 匹配不唯一或无法核实平台路径时为 `UNKNOWN`；明确身份不符为 `FAIL`。历史事实核实不等于当前 Agent Runtime 验收通过，其他平台 checkout 布局保持停止，不能猜测路径。通用 `resolveRuntimePaths` 的 Requirement 旧契约保持不变。

**Bug 授权**：复用有效 `tfs.type=Bug`、合法来源身份、可执行状态、当前 Bug Fix 指派及无冲突交付事实等开工条件；已固定的仓库 Scope 必须遵守。诊断阶段不强制提前写 `bug.required_repos`，首次 PR 准备仍由既有 Gate 固定最终集合。“该仓库是否属于本 Bug”的业务判断由 Bug Fix / Human 承担；Registry 登记和合法身份不能被宣称为自动证明业务相关性，超授权范围先取得明确决定。

**Requirement 授权**：08-B 在同一准备主体前检查有效 `analysis.source`、Approval、Dispatch、当前 Engineer 与 `repo_keys[]`。`dev materialize` 是 Lead 的派发写入口，prepare 只能消费已有派发，不能为了通过检查而顺便补派发。08-A 不提前删除当前 `analysis.source.commit`，08-B 的来源契约变更须与现有消费者一起适配。

#### 2.3.4 Git 执行与安全准备流程

Runtime 前置条件来自真实验证：[M02](validation/new/08-mechanism-results/M02.md)仅证明显式兼容 `git.exe` 与子进程局部 `PATH` 可在受测 Windows Runtime clone 本地 fixture；本地沙箱复现了裸 `git` 的 MSYS 限制；命令现支持 Runtime 注入 `RONDO_GIT_EXECUTABLE` 和 `RONDO_GIT_PATH_PREFIX`，未据此宣称真实业务认证已验收。工具路径与局部环境由受控 Runtime 配置供给，不依赖被平台屏蔽的 Agent `custom_env.PATH`，不把机器绝对路径写回共享仓库 Registry。

认证复用现有 [TFS 配置来源](../../tools/rondo/src/tfs/config.ts)及受控 Git 子进程机制：在仓库身份和授权通过后注入精确目标 URL 的认证，保持非交互与输出脱敏，不持久化 PAT。兼容工具 / 认证组合必须同时覆盖 prepare、`bug prepare-pr` 的远程检查及 Agent 后续 fetch / push，避免仅 clone 成功而后续交付失败。

执行顺序如下，确定性安全检查通过前不修改业务仓：

1. **读取并校验事实**：参数、Issue / Actor、原生根仓、Registry / URL、目标分支及授权范围均通过；不以远程镜像当前分支替代交付目标。
2. **核实目标路径**：由已验证根仓和相对 `repo_path` 得出实际子仓路径；检查路径边界及已有目录的符号链接 / junction，拒绝指向根仓自身或范围外目录。核实业务目录不会被根仓 Git 跟踪，沿用已有忽略规则。
3. **缺仓时准备**：从已核实 URL clone 指定业务仓，以明确的交付目标分支准备本 Issue 候选分支；不 clone 根仓或其他业务仓。网络中断产生的不完整目录不算成功，重试前先核实现场，不能自动删除不明目录。
4. **已有仓时复核**：确认独立 Git top-level、origin、当前分支 / HEAD 与 Issue 归属；不能把普通子目录中向上解析到的根仓误认为业务仓已检出。
5. **安全复用或停止**：确认可安全复用时保留未提交修改与未 Push Commit；确需 fetch 时仅更新远端事实，不自动整合。需要覆盖修改、混入其他 Issue 或无法确认分支归属时停止，不自动 `reset / clean / stash / rebase`。
6. **回读输出**：返回实际路径、仓库身份、branch / HEAD、`changed` 和原因；成功只表示业务工作区可使用，不替代修复验证、PR 或交付 Gate。

| 结果 | 语义 |
| --- | --- |
| `PASS`，exit 0 | 准备或安全复用成功；仅检查并复用、未产生变更时 `changed=false`，实际变更则如实报告 |
| `FAIL`，exit 2 | 已确认违反输入、身份、授权、路径或 Git 安全条件；保留现场 |
| `UNKNOWN`，exit 3 | Task 绑定、外部状态、工具 / 认证或操作结果无法确认；说明原因并停止受影响步骤 |

沿用上述现有结果约定，不增加 `NOOP` 枚举或工作区 Metadata。重复调用不能为了返回成功而重置工作树。

#### 2.3.5 实施依赖顺序与待明确项

依赖顺序：**确认平台 Task / checkout 绑定 → Registry URL 透传与 Git / 认证共用能力 → Bug 开工授权 → 安全准备主体 → Bug Skill / `prepare-pr` 接入 → 真实 Runtime 验收**。08-B 再扩展 Requirement 授权，复用准备主体。现有 [pr/worktree.ts](../../tools/rondo/src/commands/pr/worktree.ts)要求已有业务 hub 并创建额外 worktree，不作为本方案的准备入口。

| 编码前需明确的事项 | 现有依据与约束 |
| --- | --- |
| Task / Actor 绑定从哪里取得 | 来源字段已由历史 Task 文件及在线 Run / Resource 只读核实；当前新实现的真实 Runtime 接入仍待验，未确认绑定时 UNKNOWN |
| 兼容 Git 配置如何提供 | 已支持受控 RONDO_GIT_EXECUTABLE / RONDO_GIT_PATH_PREFIX 与现有 TFS 配置；不新增机器路径到共享 Registry，真实 Task 注入待验 |
| 候选分支命名与覆盖方式 | `bug prepare-pr` 当前默认 `feat/<tfs.id>`，允许 `--source-branch`；prepare / bug git 当前仅使用默认 feat/<tfs.id>，prepare-pr 保留显式覆盖与候选归属检查；不静默生成不同分支 |
| 同 Issue 跨 Task 的续接 | 已按 feat/<tfs.id> 识别远端候选分支；未 Push Commit 与未提交修改仅保留在原工作区，不宣称自动迁移 |
| 不完整 clone / 已有目录的恢复 | 根据实际目录和 Git 身份判断可复用范围；归属不明返回 `UNKNOWN`，不自动清理或覆盖用户内容 |

验证覆盖：参数 / 身份 / URL 不匹配、路径及链接越界、首次 clone、已有同 Issue 安全复用、dirty / unpushed 保留、错误 origin / 分支、clone 中断与重试，以及真实业务仓认证。单测 / 隔离 Git fixture 证明局部行为，真实 Task 验证平台归属与兼容工具；后续 fetch / push / PR 链另行验证。对应 [08A-V04](validation/new/08-multica-mechanism-validation-acceptance-plan-2026-11-13.md)仍为 `NOT_RUN`，不能用 M02 / M06 的历史 PASS 代替。

### 2.4 Bug Fix 与 Finalize：复用现有契约

**共享收口配置**：PR Status Sync Agent 的 `max_concurrent_tasks` 固定为 `1`，复用 Multica 原生排队；当前配置已调整并回读确认，Bug / Requirement 共用该约定。不再增加并发收口仲裁或专项并发验收。配置记录、摘要复用及跨机器待验项见 [共享收口确认与待验](validation/new/08-multica-mechanism-validation-acceptance-plan-2026-11-13.md#finalize-shared-validation)。

1. Bug Fix Agent 在远程诊断后按需执行 `dev prepare`，完成修复、必要验证、Code Review、Commit / Push。
2. 沿用 [`bug-delivery`](workspace-skills/bug-delivery/SKILL.md) 的 `rondo bug prepare-pr`、`bug.delivery`、`pr_prep`、`rondo pr materialize` 和质量 Gate。传入当前 Task 的 `--root-repo`，让现有代码定位二级业务仓；不因本次路径改变增加 Evidence 字段或降低既有检查。
3. Human 完成 PR 审核 / 合并；PR Status Sync 沿用现有 [`issue-closeout`](workspace-skills/issue-closeout/SKILL.md) 的 `prepare → tfs writeback → complete`。独立 Bug 已有无根仓 / 无 Archive 路径，保留该主流程。
4. 必须核对实际 PR 终态、合并源 Commit 与已验证 candidate 身份；TFS Writeback 成功后才能将 Issue 设为 `done`。响应不明确时先回读现有 PR / Issue / TFS 事实，不重复执行无法确认的副作用。
5. **已实现的恢复修复**：`writeback` 在评论正文附加当前 Issue / TFS / Change / PR 身份的稳定引用，重入时完整分页读取 TFS updates，已有引用直接复用，再恢复现有完成标记。旧格式评论无法确认属于当前交付时返回 UNKNOWN；不补发。将“评论已成功、标记未保存、换 Runtime 重试”纳入故障验证；不以正常重复执行通过替代此项，也不新增交付状态机。
6. **Complete 摘要复用（已实现，真实 Runtime 待验）**：已有本次交付摘要就复用，确认没有才发布；查询失败或无法确认时停止。现有 `delivery.summary_comment_id` 可保留作引用，但不能因缺失就认定摘要不存在，也不要求补存 ID 后才能继续。覆盖“摘要发布成功、ID 未保存即中断”的恢复，不新增字段、摘要状态机或额外 ID 管理流程。

**跨机器验证仍待执行**：跨 Runtime 的历史 PASS 不代表不同机器已通过。后续确认原执行已停止，在另一台独立机器上，使用其已具备的工具、配置和凭据、在无法访问原工作目录的条件下继续 Bug 收口；记录两台机器 / Runtime 身份和结果。该项为 `NOT_RUN`，Requirement 的对应接续在 08-B 验收，不增加恢复机制。

## 3. 实施顺序

| 顺序 | 修改范围 | 完成条件 |
| --- | --- | --- |
| 1 | 共享根仓就绪校验、实际 Task 路径向 Rondo 传递 | 只消费 Multica 原生 checkout；身份正确、重入不丢修改，未就绪可明确停止 |
| 2 | 三个远程 MCP 优先读取、现有仓库 / 分支映射及 Wayfinder 共享准入接入 | Bug / Requirement 均能基于授权证据准入与唯一交接；恢复和未知结果可对账 |
| 3 | `rondo dev prepare`、Registry 必要透传、Git 工具 / 认证适配、Bug `prepare-pr` 路径适配 | 真实 Runtime 单仓 clone / fetch / push、重入 / 错仓 / 脏树安全；多仓遵守原有 Scope Gate |
| 4 | Writeback 中断恢复、Complete 摘要复用最小适配，Bug Agent / PR Status Sync 联调 | 并发配置保持 1；跨 Runtime 的 `bug.delivery` → PR → TFS Writeback → Issue Done 成功，已有本次交付摘要复用；独立机器接续另行验收 |

Agent Instructions 只保留必要职责与就绪条件；Skill 说明何时调用、输入输出和失败处理；CLI 内实现仓库身份、权限、幂等与 Git 安全检查，不把算法写入提示词。以上实现已同步相关执行资产；本地测试与真实运行验收分别记录，未向平台发布。

## 4. 最小验收与停止条件

- **共享基础**：研发阶段以 Human 手动 `backlog → todo` 验证准入；目标态上线前，补齐 TFS Sync 自动激活、失败恢复及不重复启动的独立验收。均保留 Wayfinder 指派并回读真实 Run，覆盖 Bug / Requirement 的准入、来源变化、Human 恢复及未知结果对账；分别只交接到 Bug Fix Agent / Delivery Squad，核实唯一目标 Run。
- **原生就绪与源码读取**：真实 Task 中只校验已有 checkout，未就绪 / 身份不符时停止，重复检查保留修改与未推送 Commit；Wayfinder / Bug 能以三个远程 MCP 完成正常调查，远程路径与目标分支可核实。API 仅在 §2.2 的适用条件下兜底，不要求正常路径逐次 API 复查。
- **业务仓准备**：Bug 使用实际 `dev prepare` 和兼容 Git / 认证完成业务仓准备及后续交付；单仓重入、错 origin、脏树和必要多仓场景通过，不使用 fixture guard 的结果替代 CLI 验证。
- **正确授权**：错误根仓 / 业务仓、未经授权的仓库、越界源码读取或危险的 Git 覆盖操作必须被拒绝；失败不泄露凭据。
- **真实 Bug 闭环**：完成至少一例 TFS Bug 的修复、PR 合并，PR Status Sync 在**没有原本地工作区**的 Runtime 独立完成收口；PR 未完成或 candidate 不一致不能放行。
- **必要恢复**：在 PR Status Sync 并发固定为 `1` 的配置下，重复调用不产生重复 PR / Writeback / 交付摘要；覆盖 TFS 评论已成功但标记保存前中断、标记保存失败，以及摘要已发布但 ID 未保存后的恢复。已有本次交付摘要直接复用，确认没有才发布，无法确认时保持 `UNKNOWN`，仅补未完成动作后继续 Done。
- **独立机器接续（NOT_RUN）**：另一台具备运行依赖的机器在原执行停止、原目录不可访问的条件下完成 Bug 收口；不同 Runtime / 不同 Task 目录的结果不能替代此项。

不因未提供新增的同步监控、完整 MCP / HTTP 性能报表或历史验证编号而阻塞 P0。[当前待验项与历史矩阵](validation/new/08-multica-mechanism-validation-acceptance-plan-2026-11-13.md)分开记录：M01 / M02 仅证明原生与二级仓局部机制，M06 是 fixture guard，M10 是预置 Requirement 事实后的收口，M11 未完成权限边界验证，M12 属于旧 API-first 路线。保留各自历史结果与限制，不替代以上集成验收；新增项在实际执行前均为 `NOT_RUN`。

**切换条件**：在独立验证 Project 通过本阶段验收后再启用；生产 Requirement 继续使用当前 `analysis.source.commit` 与根仓发布契约，08-A 不修改其语义。08-B 复用本阶段的路径、仓库准备和源码读取能力。
