# Multica 08 方案：机制验证与实施验收计划

> **类型**：历史机制验证记录与当前方案待验清单
>
> **版本**：v1.2 / 2026-11-14 文档复审；本次修订未执行新 Runtime 用例，已完成的并发配置回读见 §1.4
>
> **历史审查基线**：2026-11-13 的 `winning-platform-monorepo/main`，`projects/multica/08-remote-analysis-git-workspace-design.md` v0.9（文件 blob SHA：`ccb57d9380725cd7b5d116121e023e30ba29cc43`）
> **执行环境**：企业内网、Windows + PowerShell、Codex CLI；按需在真实 Multica Agent Runtime 内执行  
> **历史状态**：M01、M02 已重新采证通过，M02 为真实 Runtime 自主 clone。M03 已补齐无 Project 的真实 CLI 验证；M04–M09 机制验证通过；M12 已补齐 476 文件索引核对与真实 Runtime 降级 PoC。M10 已完成 Rondo 远端工件适配，在 Codex / Claude 双 Runtime 完成真实 Prepare → Writeback → Complete 及三个中断恢复点（11+23 项断言通过）。M11 按当轮用户要求保留 NOT_RUN：缺低权限身份，内网 HTTP 已获准用于当轮验证。具体层级与缺口见 §6.1；当轮工作区适配尚未发布，不据此批准正式切换。
> **原则**：最小机制验证、证据先行、只读优先、隔离写入、一个问题一次判断、不得修改生产交付事实

**当前适用范围（2026-11-14）**：[08-A](../../08a-remote-analysis-bug-fix-foundation.md) 与 [08-B](../../08b-requirement-remote-git-delivery.md) 已拆分。Wayfinder 是两者共享的准入基础；[首次入口分阶段](../../02-multica-delivery-lifecycle-design.md#wayfinder-entry-stages)：研发测试由 Human 手动 `backlog → todo`，目标态仍由 TFS Sync 自动改 `todo`，均保留 Wayfinder 指派并分别验收。Wayfinder Agent、Bug Fix Agent、Workitem Analyst、Engineer 的根仓 checkout 均由 Multica 原生提供，Agent 只检验就绪、身份与实际路径；业务源码优先使用 `remote-codegraph`、`remote-filesystem`、`remote-ripgrep`，TFS Git API 仅按条件兜底。以下历史 M 编号、PASS 与原始证据保持不变，**不表示当前方案已验收**。当前新增待验项目与共享收口确认见 §1.3–§1.4；§2–§7 保留当轮执行口径，历史授权不自动授权新的外部写入，也不要求重复执行已验证的底层机制。

## 1. 目标与范围

原计划验证 08 v0.9 中**尚不能从现有证据直接确认的机制性前提**。本次文档复审保留这些结论，并补充当前 08-A 的集成验收缺口；不重复做全部 TFS Git REST API 测试，也不将历史 PoC 升格为产品验收。

以下是 **2026-11-13 当轮设计基线**，用于解释历史测试，不作为当前执行指令：

- 根仓通过 Multica Project Git Resource / 原生 checkout 使用；业务子仓仍位于根仓下的二级目录，由 `rondo dev prepare` 按需准备。
- 当轮 Wayfinder / Workitem Analyst / Bug Fix Agent 的业务源码静态阅读默认走固定 Commit 的 TFS Git API，CodeGraph 为可选增强；**该优先级已由当前 08-A §2.2 的三个 Remote MCP 主路径替代**。
- Delivery Lead 通过 `rondo analysis read` 读取已批准的 `tasks.md`，不要求本地 Git 仓库。
- PR Status Sync 继续复用现有 `run_only` Autopilot Prompt + `pr-status-sync` / `finalize-delivery` Skill；Requirement Archive 由 Rondo 在临时根仓执行，独立 Bug 无 OpenSpec Archive。
- **不新增** Archive Commit SHA Metadata、PR Status Sync 并发仲裁、分布式锁、工作区服务、Agent 或第二套交付状态机。

### 1.1 验证与实施验收严格分离

| 层级 | 含义 | 可以给出的结论 |
| --- | --- | --- |
| 机制验证（PoC） | 在隔离目录、真实只读 API 或真实 Task Context 验证平台/协议行为 | 某项机制可行 / 不可行；**不**表示 Rondo 已实现 |
| Rondo 适配验收 | 对已开发的 Rondo 命令和 Skill 的输入、输出、失败恢复做真实测试 | 具体命令 PASS / FAIL；**不**自动等于完整交付 PASS |
| 端到端验收 | 按对应方案，在不同 Runtime 验证共享准入与 Bug / Requirement 交付链 | 当前按 08-A / 08-B 各自完成条件验收；旧 V01–V22 仅对应历史 v0.9 |

单项状态使用 `PASS` / `FAIL` / `NOT_RUN`。前置条件不满足、只有源码推断或只能完成部分步骤时，记录 `NOT_RUN` 与阻碍原因；不得把“静态可行”写为“真实 Runtime 已 PASS”。可在记录中标注 `PARTIAL_EVIDENCE`，但不作为第四种通过状态。

### 1.2 已有证据：避免重复测试

| 现有证据 | 当前结论 | 本计划怎样使用 |
| --- | --- | --- |
| T01–T06，T09 | TFS API 4.0 的仓库/分支读取、测试分支创建、文件新增/修改、旧 HEAD 拒绝已 PASS | 不重复创建远端测试分支；M04 重点验证**具体发布实现**，不是重新证明 API 有此能力 |
| T07–T08 | 测试 PR 创建、查询、abandoned、测试分支删除已 PASS | **没有验证 completed**；M08 只读核验真实已完成 PR |
| T11 | 6 组中文、空格、`#`、`%`、字面量 `%23/%25` 路径已 PASS | Rondo 真实适配器按同一组用例回归；不重新生成 T11 远端测试数据 |
| datamodel 远程源码分析 | 固定 Commit 的 TFS Git API 可完成该案例的主要静态定位 | 不再重复该案例；M12 只核对可选 MCP / 图谱的版本一致性 |
| T10、T12 和 V01–V22 | 未完成相应测试 | 不能由 API PASS 自动推定通过 |

现有 API 实验是在 `rondo` 基准分支的独立**测试分支**上执行；从未验证向根仓权威 `master` 发布，也没有测试 PR `completed` 或 Multica Task-local checkout。

### 1.3 当前 08-A 新增待验项目（2026-11-14）

本表引用 [08-A 的共享基础、各项能力与最小验收](../../08a-remote-analysis-bug-fix-foundation.md)，只列现有证据不能替代的验证。当前状态已按 [TT-5 / TT-6 后续验收](08a-runtime/README.md) 更新；正向闭环与完整子项矩阵分别判定，不以局部 PASS 替代整体通过。

| 编号 | 当前验收对象 | 必须观察的行为 | 状态与既有证据边界 |
| --- | --- | --- | --- |
| 08A-V01 | 研发测试入口与 Wayfinder 共享准入；08-A §1.1、§4 | 分别验证 Human 将 Bug、Requirement 从 `backlog` 手动改为 `todo` 并保留 Wayfinder 指派后，由原生状态触发准入；覆盖 `needs_human` / `unsupported` 的契约恢复、来源变更和重复唤醒；有效 Decision 回读后只发生一次正确交接，Bug 到 Bug Fix Agent、Requirement 到 Delivery Squad，回读对应唯一 Bug Fix Agent / Delivery Lead Run；不以预置最终状态代替真实 Run 证据 | NOT_RUN（PARTIAL_EVIDENCE）；TT-6 Bug 手动入口与唯一交接 PASS，其余共享矩阵未补齐 |
| 08A-V02 | 原生根仓就绪、身份与路径；08-A §2.1 | Wayfinder / Bug Fix 消费 Multica 已完成的 checkout，核对实际 Git root、origin、Project / Task 归属与可读取规范；未就绪、错误身份或无法唯一确定路径时停止并说明原因；从已有根仓目录重入只重新校验，不生成嵌套根仓，不丢修改与未 Push Commit | NOT_RUN（PARTIAL_EVIDENCE）；TT-6 原生供应/校验/复用 PASS；TT-5 首次供应超时，全部 Runtime 负向矩阵未补齐 |
| 08A-V03 | 三个 Remote MCP 正常主路径与条件兜底；08-A §2.2 | Wayfinder / Bug Fix 在真实 Runtime 使用三个 MCP 完成所需代码定位、检索和读取；正常路径不强制 TFS API 复查。MCP 不可用或明确需要最新/历史版本时才使用已授权 API；版本未知或索引不一致时标明限制，并以可核实源码支持关键结论 | PARTIAL；TT-9 Bug Fix 三 MCP 主路径 PASS，rondo-tt 限定 search 授权修复已实测；Wayfinder 修正后重验未执行，见[补充证据](08a-runtime/remote-mcp-followup.md) |
| 08A-V04 | `rondo dev prepare` 与 Bug PR 路径；08-A §2.3–§2.4 | 在真实 Runtime 核实 Task / Actor 绑定、Registry URL 透传及兼容 Git / 认证，准备一个已授权业务仓；验证首次 clone、同 Task 复用、路径 / junction 越界及错误 origin / Issue 拒绝、dirty / unpushed 保留、clone 中断恢复。fetch 不自动整合，`bug prepare-pr` 使用已验证根仓路径；后续交付另验 push，prepare 本身不 push | NOT_RUN（PARTIAL_EVIDENCE）；TT-6 实际 clone/reuse/fetch/push/prepare-pr PASS，完整 Runtime 边界矩阵未补齐 |
| 08A-V05 | 独立 Bug 全链路；08-A §2.4、§4 | 至少一例真实 `tfs.type=Bug` 经 Wayfinder、Bug Fix、质量 Gate、`bug.delivery`、PR 审核合并；真实 PR Status Sync 在无原工作区的另一 Runtime 完成 Writeback / Done。PR 未完成、candidate 不一致及写回未成功均不得 Done；重复调用不重复创建 PR 或收口 | NOT_RUN（PARTIAL_EVIDENCE）；TT-6 / 265022 / PR 3786 正向 E2E 已闭环，candidate 漂移与重复物化等 Runtime 子项未补齐 |
| 08A-V06 | Writeback 评论已成功、完成标记未持久化的恢复；08-A §2.4、§4 | 在授权测试对象上分别验证 TFS 评论成功后、完成标记持久化前中断及标记保存失败；另一 Runtime 恢复时先回读已有副作用，不能重复追加评论或提前 Done；不能确认时保持 `UNKNOWN`。同时核对重复恢复后的评论数量、Issue 标记和状态 | PASS；TT-7 Codex 评论后中断，TT-8 Claude 标记保存失败及恢复，评论始终 1 条；见后续证据 |
| 08A-V07 | 读取权限与路径边界；08-A §2.1–§2.3、§4 | 逐一核验实际启用 MCP 的已授权仓库/路径可读、越界或敏感路径被拒绝及只读能力；图谱、检索、文件读取与 API 兜底遵守同一授权边界；认证值不进入 URL/日志。对未启用的入口不虚报通过 | FAIL；权限矩阵未补齐，Claude 诊断将 Task token 输出到平台日志；本地副本脱敏与执行约束修订不代表已重验 |
| 08A-V08 | 目标态自动首次准入；02 阶段约定、08-A §1.1 | TFS Sync 初始化及回读完成后单次自动改 `todo`、保留 Wayfinder 指派；核实唯一真实 Run、失败 / 未知结果恢复、重复同步及切换不重启已处理 Issue | NOT_RUN；目标态启用前单独验收，08A-V01 的手动测试及历史自动入口记录均不能直接替代 |

建议研发阶段先以手动入口验证共享准入、根仓就绪和 MCP 主路径，再验证业务仓准备与 Bug 全链路；权限边界和恢复窗口随对应入口联合验收。研发结束切换自动驱动前补齐 08A-V08，并分开记录两阶段结果。保留最少必要证据，不新增同步监控、性能报表、索引状态服务或独立交付状态机。切换条件以 08-A §4 为准，08-B 的 Requirement 专属交付仍需按其自身范围验收。

<a id="finalize-shared-validation"></a>

08-A 本地实现与回归见 [2026-11-14 实施记录](08a-implementation-2026-11-14.md)。已增加真实 CLI + 平台 fixture、隔离 Git 与故障注入覆盖，并只读核实平台 / TFS 协议；后续真实 Runtime 的执行及剩余项见 [08-A Runtime 报告](08a-runtime/README.md)。这些本地证据不改变 M01～M12 的历史结论和范围。

### 1.4 共享收口确认与待验（2026-11-14）

以下三项为本次逐项确认结果，适用于 08-A Bug 与 08-B Requirement。PR Status Sync 无 Project；Requirement 归档由 Rondo 临时 checkout 根仓，Bug 不要求根仓或 Archive。配置回读与真实恢复用例分别记录，不以配置已保存推定端到端通过。

| 编号 | 确认结果 / 验收对象 | 行为与证据边界 | 当前状态 |
| --- | --- | --- | --- |
| 08-F01 | PR Status Sync 并发固定为 `1` | `max_concurrent_tasks=1`，复用 Multica 原生排队。取消此前提出的多巡检 Run 并发收口专项，不新增锁、CAS 或调度机制；部署时保持该配置。根仓其他工件发布引起的分支前进 / Spec 冲突仍按 08-B 验收 | PASS，仅配置变更及独立回读；不代表执行链已验收 |
| 08-F02 | 已有本次交付摘要就复用 | 已有摘要直接复用，确认没有才发布，查询失败或无法确认时停止。Comment ID 可供引用，不作唯一判断，也不要求补存 ID 才能继续。验证摘要已发布、ID 未保存即中断后的恢复，以及无摘要 / 查询失败分支；只核实本次交付，不把历史交付摘要当成本次结果 | NOT_RUN（PARTIAL_EVIDENCE）；TT-8 Bug 摘要 ID 保存失败后内容复用与重放 PASS；完整查询失败等 Runtime 子项未补齐 |
| 08-F03 | 独立机器接续 | 原执行停止后，在另一台具备工具、配置、凭据且无法访问原工作目录的机器上继续收口；记录两台机器 / Runtime 身份与结果。08-A 验证 Bug，08-B 验证 Requirement，按阶段分别登记。不同 Runtime / Task 目录不能单独证明跨机器 | NOT_RUN；M10 保留跨 Runtime 接续 PASS，不能扩大为跨机器已通过；不增加恢复机制 |

**08-F01 配置回读记录**：本会话经用户确认，将 `PR Status Sync Agent`（`34986774-e980-4695-816b-4266a25a86c9`）的 `max_concurrent_tasks` 从 `6` 改为 `1`；执行 `multica agent update <该 Agent ID> --max-concurrent-tasks 1 --output json` 后，通过独立 `multica agent list --output json` 回读同一 ID，结果为 `max_concurrent_tasks=1`。没有修改其他 Agent 字段。本次文档同步不再次修改配置或执行真实收口。

08A-V05 / V06 的 Bug 全链路及 TFS 评论恢复按并发固定为 `1` 的前提执行；08-F02 补充的是 Multica 交付摘要复用，不能替代 08A-V06 的 TFS 评论恢复。08-B 复用相同规则。两项恢复能力已实现；本轮 TT-7 / TT-8 已取得 Bug 路径的中断恢复证据，完整矩阵按上表分别判定。独立机器接续仍 NOT_RUN，历史 PASS 不改写。

## 2. 历史 Codex 执行约束（2026-11-13）

### 2.1 每次只执行一个编号

**本轮授权覆盖（2026-11-13）**：用户明确要求 M01 也全部重新验证，且无问题时自动连续推进 M01 → M02，无需逐项停顿。本轮按编号顺序分别记录结论，旧结果仅保留历史，不复用其 PASS；其余副作用与证据约束不变。

**追加授权**：用户要求先解决 M02 MSYS 沙箱问题，在真实 Runtime 自主 clone 后重验，通过后连续执行后续验证，不逐项暂停。允许完成该修复所需的最小工具适配与测试 Run；不据此扩大为生产 Git/交付事实写入。后续咨询中用户提供 TFS Work Item 260986 作为测试资源；仍须核对实际对象、能力与 Runtime 前置条件，不把一个 Work Item 视为低权限身份或传输策略批准。

**补验授权**：用户要求继续补齐 M03/M10/M11/M12，明确 260986 可作为测试工作项，允许自主准备前置条件并连续验证。故本轮可创建隔离测试 Issue、测试版本指针及验证 Run，覆盖 M03 操作 1 原先“无则 NOT_RUN、不修改 Metadata”的限制；不修改生产审批事实。用户随后明确没有低权限用户，并允许当前内网 HTTP 用于本次验证。

**M10 实施授权**：用户进一步要求补齐 Rondo 远端归档读取适配，用 260986 在真实 Runtime 完成 Prepare → Writeback → Complete 和中断恢复，自主准备必要条件、连续执行；M11 保留 NOT_RUN。本轮据此修改最小代码及对应 Skill 调用文档，创建隔离测试分支/PR、TEST-13/14/15，并对 260986 与其专用子项执行真实写回。该授权覆盖下列默认“只验证、逐项停顿、无远端写入”的限制，仅限本次测试资源；未授权生产分支发布、全局安装升级或工作区提交推送。

1. 先阅读本计划对应 M 编号，以及 08 方案的相关节、现有 Rondo/Multica 代码和验证记录。
2. 优先执行不改变任何远程状态的检查；如果需要写入，只能在**本地一次性实验目录**或获得专门授权的**独立 TFS 测试仓/测试分支/测试 Work Item**操作。
3. 不把尚未实现的 `rondo dev prepare`、远程发布入口或新的 Finalize 能力“命令不存在”判定为底层机制 `FAIL`：能做隔离 PoC 就做，命令级验收标为 `NOT_RUN`。
4. 记录真实执行命令、环境、脱敏结果、完整 SHA（仅仓库和 Git Commit 身份）、异常与恢复；只给证据支持的结论。
5. 一项执行结束即生成结果，不自行延伸执行下一项、修改 Agent Instruction/Skill、修复代码、改方案、提交 Commit 或创建 PR。

### 2.2 安全要求

- 不向 TFS 根仓 `master` / `rondo`、业务仓真实目标分支写入；不创建或合并生产 PR；不修改真实 TFS Work Item 状态、工时或评论；不改变 Multica 生产 Issue Status/Metadata/Assignment。
- **未经明确授权，不向真实 TFS Git 远端执行 `git push`**；本机完全隔离的 Git fixture 可以在其私有测试 remote 内提交/Push。禁止对生产仓库执行 `git reset --hard`、`git clean -fd`、`git checkout --force`、`--fresh`、`force push` 或批量删除分支。真实 TFS 测试分支的 Push 也须单独明确授权。
- 不擅自启动/重启 Multica Daemon、修改 Project Resource 或触发正式 Autopilot。需要真实 Agent Run 时，必须使用已有的授权测试 Run，或仅提交“需要测试 Run”的说明。
- 不打印/提交 PAT、Cookie、Authorization Header、含凭据的 URL、Git Credential Manager 文件或原始环境变量内容。`git remote -v` / `git config remote.*.url` 结果必须先脱敏才保存。
- **普通 PowerShell 不等于 Multica Task Context**：`multica repo checkout` 依赖 Daemon 注入的 Task 作用域身份。缺少 `MULTICA_TOKEN` / `MULTICA_DAEMON_PORT` 时，只能判定“当前不在 Task Context”，不可据此判定平台不支持。不可伪造此类变量。
- 真实外部副作用实验需要明确测试仓库、测试 Issue 和回滚/清理授权；没有则 `NOT_RUN`，不以生产资源代替。
- 每轮记录 Git HEAD / ref 的前后值，验证未触及非目标对象。Windows、Linux 路径不得跨机器当作仓库身份。

### 2.3 环境和基线记录

Codex 首次执行前记录（**不要**输出凭据值）：

```powershell
# 普通终端允许只读执行
$PSVersionTable.PSVersion.ToString()
git --version
multica --version
rondo --version
multica runtime list --output json
multica project list --output json

# 确认当前代码分支与版本；不切分支或拉取覆盖在研修改
git status --short
git rev-parse HEAD
```

`rondo --version` 或 `multica --version` 若该版本不支持，记录真实用法而不臆造。`multica project resource list <project-id> --output json` 可用于只读检查资源类型、URL、ref。不得因为显示 Resource 就推定已 checkout。

### 2.4 Codex 调用模板（每次替换一个编号）

```text
请读取本文件「08-multica-mechanism-validation-acceptance-plan-2026-11-13.md」和
winning-platform-monorepo/main 下的 projects/multica/08-remote-analysis-git-workspace-design.md。

本次只执行验证编号 MXX：严格按该项的前置条件、步骤和通过标准进行机制核实。
先核对当前代码与环境，不以既往聊天或设计假设代替实际结果。
不实现新功能，不修改仓库文件或远程资源，不执行下一验证项。
没有授权测试环境时，只完成静态/只读部分并标记未执行项目为 NOT_RUN。
结束后输出：环境、执行命令、脱敏证据、PASS/FAIL/NOT_RUN、发现、对 08 方案的影响、最小建议。
```

## 3. 历史机制矩阵与执行顺序（08 v0.9）

| 编号 | 对应 08 / V 项 | 优先级 | 独立验证的机制问题 | 最小前置条件 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| **M01** | §5.1 / V05 | P0 | 实际 Multica Task 内能否 checkout TFS 根仓并确认身份 | 真实授权测试 Run | PASS（本轮 main；脏树与独立 Run 隔离已验；[证据](08-mechanism-results/M01.md)） |
| **M02** | §6.3 / V05、V10 | P0 | 根仓 Task checkout 内能否安全容纳二级独立业务 Git 仓 | M01 有真实根仓路径 | PASS（真实 Runtime 自主 clone；同 Task / 独立 Run 隔离；[证据](08-mechanism-results/M02.md)） |
| **M03** | §5.3 / V08、V20 | P0 | Lead 无本地 Project 时是否可靠读取固定批准版本 | 有有效 `analysis.source` 的测试 Issue | PASS（TEST-10 无 Project 真实 CLI；7 行为 + 11 上下文检查通过） |
| **M04** | §5.2 / V06–V07、V14 | P0 | 临时 Agent 分支上的 OpenSpec 能否安全发布到固定权威分支 | 隔离 Git 仓；远端权威权限单独验收 | PASS（本地受限发布 PoC；正式权威 ref 尚未统一） |
| **M05** | §5.3 / V08、V12 | P1 | 批准基线与后续进度是否可跨 Runtime 分开读取 | 可控制的测试 Change / 快照 | PASS（固定批准与最新进度本地 PoC） |
| **M06** | §6 / V09–V11 | P1 | 子仓首次/重复准备、错误 origin、脏树和候选分支恢复 | 隔离根仓 + 独立子仓 | PASS（Git / 安全规则 PoC；dev prepare 未实现） |
| **M07** | §5.4、§7.2 / V12–V15 | P1 | 不同 Engineer 的 Evidence 与 `tasks.md` 能否无覆盖地一致发布 | 隔离根仓 + 模拟两个交付方 | PASS（顺序发布 PoC；真实 Facts 联合验收待实现） |
| **M08** | §5.5 / V16、V18 | P0 | TFS 2018 completed PR 是否提供可确认的合并源 Commit | 真实已完成 PR（仅读） | PASS（PR 3532 与已发布 Candidate 精确一致） |
| **M09** | §5.5 / V17 | P0 | 无 Project 的 Finalize Runtime 能否用临时根仓正确执行 Archive | 独立测试仓或本地隔离 Git fixture | PASS（真实 OpenSpec / 私有 remote PoC；生产 Finalize 未验） |
| **M10** | §5.5、§7 / V17、V19 | P0 | 临时根仓删除后，Writeback / Complete 是否仍能独立收口 | 已实现的远端读取适配 + 授权测试 Issue | PASS（工作区适配；TEST-13，Codex Prepare 11/11、Claude Writeback/Complete 23/23；三个中断点恢复通过） |
| **M11** | §4.4 / V03 | P1 | 只读权限、路径边界、凭据与传输方式是否满足部署约束 | 已批准的低权限测试身份 | NOT_RUN（HTTP 本次获准，匿名 GET 拒绝 401；用户确认无低权限身份） |
| **M12** | §4.2–4.3 / V02、V22 | P2 可选 | CodeGraph / Filesystem / Ripgrep 证据能否对应固定 Commit | 实际可用 MCP 和对应代码仓 | PASS（476/476 索引文件匹配；真实 Runtime 三场景降级 PoC） |

**当轮执行顺序**：先 M01 → M02；M03、M08 可并行独立只读核实；再 M04 → M05 → M06 → M07；最后 M09 → M10。当轮将 M11 列为部署前验证、M12 列为可选；当前 MCP 主路径与边界按 §1.3 验收，不沿用这一可选优先级。

## 4. 历史各机制的独立验证和验收标准

### M01 — Multica 原生 TFS Git checkout

**要回答**：Resource 注入、Git URL 可接受、Daemon Cache、Task-local checkout、TFS 非交互认证是否在**当前部署版本**共同成立。

**操作**：

1. 只读查询 Root Project 及 Wayfinder、Workitem Analyst、Engineer、Bug Fix Agent 的关联配置；记录 Project Resource 的真实 `resource_type`（可能是历史命名 `github_repo`）、URL、`ref`、Agent Runtime / Daemon 身份。
2. 识别真实 Run 的 Task Context，确认 CLI 和 Daemon 版本；判断 checkout 是自动执行，还是需要显式 `multica repo checkout <repo-url>`。不要在普通终端冒充 Task 进行试验。
3. 在**授权的空测试 Task 工作目录**调用原生 checkout；记录返回的实际路径，用 `git rev-parse --show-toplevel`、`git rev-parse HEAD`、`git status --porcelain` 和已脱敏 origin 核对根仓身份。
4. 在同一测试 Task 重复调用普通 checkout（**不用 `--fresh`**），观察原生重入语义；如有多个可安全创建的测试 Run，再检查是否各自获得隔离目录、原内容不丢失。
5. 若 TFS HTTP Git 认证失败，分别记录 CLI URL 校验错误、Git credential 错误和 Daemon 网络错误，不把三者混为一谈。

**PASS**：真实 Task 中 checkout 正确 TFS 根仓；路径可确定且与当前 Task 关联；版本、origin、认证及重复调用行为被核实；没有覆盖原有修改。**FAIL**：在前置条件满足时，原生机制实际不兼容 TFS Git 或无法取得仓库。**NOT_RUN**：没有真实 Task 或缺少受控凭据。

**证据**：脱敏 Resource JSON、CLI/Daemon 版本、Task/Runtime ID、checkout 路径、Git HEAD、失败类型、重入前后状态。

**失败决策**：只讨论根仓获取的最小适配，不立即替换 08 的整个工作区架构。

### M02 — 二级嵌套业务仓与 Workdir 生命周期

**要回答**：在 M01 返回的根仓路径下，业务子仓可否作为独立 Git 仓维护，并在 Task 重入 / 不同 Run 时符合预期。

**操作**：

1. 在**可废弃的 Task 根仓 checkout**中，读取 `.gitignore` 与 `docs/config/repo-context.yaml` 的 `repo_path`，确认该目标子仓目录尚不存在或为允许使用的测试目录。
2. 在该根仓的授权子路径下，clone **一个**测试业务仓（不可在真实在研工作树中重复 clone）；记录子仓 `.git`、origin、HEAD。不得把子仓注册成第二个 Multica Project Resource。
3. 分别在根仓与子仓执行 `git rev-parse --show-toplevel` 和只读 `git status --short`；确认根仓 `git status` 不把嵌套仓源码当作待提交内容。
4. 观察同一 Task 重复调用和下一测试 Run 的工作区身份；明确二级子仓是否自动随根仓保留、必须按 `dev prepare` 重新准备，或必须从已 Push 的业务 Commit 恢复。

**PASS**：双仓 Git 根目录独立、嵌套路径正确、根仓忽略业务目录、不污染根仓提交；生命周期行为明确且可由 `dev prepare` 处理。**NOT_RUN**：M01 尚未提供真实 Task 根仓。

**证据**：树形目录、两个 Git top-level、两个 origin（脱敏）、HEAD、根仓 status、同 Run / 跨 Run 观察记录。

**失败决策**：只修改 `dev prepare` 的本地路径准备策略；保留仓库关系的逻辑二级结构，避免重建共享枢纽。

### M03 — Lead 无本地 Project 的固定批准版本读取

**要回答**：`rondo analysis read` 能否在非根仓 Runtime 读取 `analysis.source.commit` 的批准 `tasks.md`，并处理 API 版本差异。

**操作**：

1. 选取已有合法 `analysis.source` 的**测试 Issue**（无则只读核对代码，记 `NOT_RUN`），记录 `repo_url`、`branch`、完整 Commit、`change_ref`（不修改 Metadata）。
2. 在不引用本地根仓路径的环境执行：

   ```powershell
   rondo analysis read --config <repo-registry.json> --issue <test-issue-key> --file tasks.md
   ```

3. 核对输出 `result=PASS`、source Commit 和返回内容。直接以同一 Commit 的 TFS Git API 独立回读比较内容或 Hash。
4. 测试读取不存在文件、无效 Commit 或已脱敏的配置错误；应给出 `FAIL/UNKNOWN`，不能回退到本地或最新 HEAD。
5. 关注 Rondo 当前使用的 `api-version=4.1` 与此前实测 `4.0` 的兼容性，只以**真实 Rondo 请求结果**判定。

**PASS**：无本地根仓也能固定 SHA 读取、内容可比对、错误正确 fail closed。**NOT_RUN**：缺少可安全读取的已批准测试 Issue。

**证据**：命令、脱敏配置定位、source、输出 SHA / Hash、HTTP 状态和错误行为。

### M04 — 临时 Agent 分支与固定根仓权威分支的发布机制

**要回答**：Agent 的 Task-local 分支不同于权威分支时，能否安全把白名单 Change 发布到固定发布分支，且不动 Agent 当前工作树。

**操作**：

1. 先以 `rondo branch get` 等只读方式确认**实际**根仓权威分支是 `master`、`rondo` 还是其他配置；记录“配置期望”和“远端实际”，不能自行改配置。
2. 在本地一次性 Git fixture（或获得授权的专用测试仓）建立基线分支、模拟 Agent 工作分支和两个不同 Change 目录；不得直接写真实 `master`。
3. 从 Agent 分支上的一个合法测试 Change 生成受限补丁，在隔离 Git 工作树 / REST 测试分支发布。检查发布目标、提交范围和目标 SHA；确认 Agent 工作树不被 checkout/reset/clean。
4. 模拟目标分支提前一个 Commit、目标相同路径发生冲突、Push 成功而本地结果回报丢失；验证拒绝覆盖和回读后再决定是否补登事实。
5. 若只在本地 fixture 完成，记录为“发布机制 PoC PASS”，而真实权威分支权限 / Rondo 最终适配仍 `NOT_RUN`。

**机制 PASS**：目标 ref 明确、只提交白名单、无强推/错误分支 Push，冲突停止、已成功操作可回读。**端到端 PASS**：还需 Rondo 发布到明确授权目标并通过 V06–V07；不能以 T09 REST API 通过代替。

**证据**：前后 ref、提交路径清单、Diff、模拟冲突结果、原 Agent 工作树状态。

### M05 — 批准基线与最新研发进度的版本隔离

**要回答**：`analysis.source` 冻结后，Engineer 能正确拿到批准 `tasks.md`；后续 `tasks.md` 勾选与 Evidence 发布又可被其他 Run 读取，而不移动批准基线。

**操作**：

1. 在隔离根仓准备 Change 的两个 Git Commit：C1（批准正文与未勾选任务）→ C2（只更新允许的 checkbox 与 Evidence）。
2. 模拟 Analyst 固定 `analysis.source = C1`；模拟 Lead 只按 C1 读取并派发 `task_refs`。
3. 模拟 Engineer / Finalize 读取权威分支的 C2，确认取得最新进度，同时比较 C1 的合同正文 Hash 未改变。
4. 验证当本地原生 checkout 停留 C1 或其他 Task 分支时，能够选择正确 Git 视图，不能把旧 checkbox 当作最新，也不能自动替换批准 Commit。

**机制 PASS**：同一 Change 的批准基线与最新进度身份不会混用、正文不漂移。完整 Rondo 路径尚未实现时，**命令级验收仍 `NOT_RUN`**。

**证据**：C1/C2 SHA、批准正文哈希、`tasks.md` 差异、远端/本地读出的对应 Commit。

### M06 — `rondo dev prepare` 需要的 Git 行为

**要回答**：只准备指定业务子仓的 Git Clone、Fetch、候选分支和安全恢复是否可行；不要把该命令不存在误判为 Git 不可行。

**操作**：

1. 在隔离二级目录中读取已有 `repo-context.yaml` 的一个实际 `repo_key` 和无凭据 `repo_url`；不能根据路径名猜 URL。
2. 模拟首次 `git clone`，再模拟已存在正确仓库的 `fetch`、相同候选分支重入和远端 HEAD 前进。
3. 模拟错误 origin、脏树、未 Push Commit、未经授权的 `repo_key`；应停止而不 `reset/clean`。未经授权仓的拒绝可先通过规则单测/fixture 验证，不能假设已有 CLI 实现。
4. 检查同 Issue 内同仓的所有 `task_refs` 是否能由同一 Engineer 承接；独立 Bug 未固定 `required_repos` 前不应因此阻断合法的单仓复现实验。

**机制 PASS**：Git 原语及二级目录行为可实现既定恢复；**完整验收**等 `rondo dev prepare` 开发后补跑 V09–V11。

**证据**：origin / HEAD、不同状态的退出行为、目录列表、候选分支及未提交修改保留情况。

### M07 — Evidence 与 `tasks.md` 一致发布、跨 Run 汇合

**要回答**：多个 Engineer 分别负责不同业务仓，是否能够把各自 `evidence*.json` 和任务 checkbox 安全汇总到同一根仓权威分支，不覆盖彼此成果。

**操作**：

1. 在隔离根仓建立同一 Change 内 T1 / T2 两组独立任务，分别由模拟 Engineer A、B 产出 Evidence 和允许的 checkbox 补丁。
2. 按顺序而非同仓并发，分别读取最新权威分支 → 校验批准正文与 `task_refs` → 提交 A → 再提交 B；确认最终远端能读取两组完整结果。
3. 模拟 B 基于旧 HEAD 发布，确认不会将 A 的 checkbox 重置或丢失 Evidence；仅对未发布补丁重新核验，冲突停止。
4. 检查 `pr_prep` / `dev.dispatch` 的事实写入顺序及恢复后条目是否保留；不在本项引入 Metadata CAS 或分布式锁。

**机制 PASS**：Git 工件在两个顺序发布中一致、无丢项、批准正文不变。真正的 Multica Facts + Rondo 联合验收需等实现后执行 V12–V15。

**证据**：两个候选身份、两次发布 Commit、最终 Tasks/Evidence、冲突处理结果及 Facts 前后差异。

### M08 — 已完成 TFS PR 的源 Commit 读取（只读优先）

**要回答**：当前 TFS 2018 的 `completed` PR 能否返回 Rondo Bug Finalize 所要求的精确源 Commit，且与候选 SHA 对得上。

**操作**：

1. 从已存在的生产历史中寻找**允许查看的** `completed` PR；只读查询，不创建 PR、不修改状态。
2. 使用当前 Rondo 只读接口（先核对 `rondo --help` 与已装版本）：

   ```powershell
   rondo pr list --repo <repo-name-or-id> --status completed --project <tfs-project>
   rondo pr get --repo <repo-name-or-id> --id <completed-pr-id> --project <tfs-project>
   ```

3. 核对 `status=completed`、source/target 分支、`sourceCommitId`（如果 API/Rondo 暴露该字段）及其对应原始结构 `lastMergeSourceCommit`。对照一个已知 Candidate Commit；如没有可信 Candidate，标注“字段存在性已核实，精确匹配尚未验证”。
4. 分清字段缺失、API 版本差异、权限不足与合并策略差异；不能把 `lastMergeCommit` 误当作 `lastMergeSourceCommit`。

**PASS**：至少一例可审计的 completed PR 与 Candidate 对得上，Rondo 的既有读取路径可返回准确源 Commit。**NOT_RUN / 部分证据**：无法取得可信 Candidate 或没有可读的 completed PR。**FAIL**：必要字段在合法条件下确实不可取得，需重新评审该 Gate 的最小可验证依据。

**证据**：PR ID、仓库 ID、状态、分支、完整 Commit、Rondo/API 字段路径（脱敏）。

### M09 — 无 Project 的 PR Status Sync + Rondo 临时根仓 Archive

**要回答**：不拥有 Project、也没有原 Engineer 业务仓的 Runtime，能否通过一次性根仓完成原生 OpenSpec Archive 与远端确认。

**操作**：

1. 先只读核对 PR Status Sync `run_only` Autopilot、Prompt、Skill 绑定，验证现有组合；不重新创建 Agent 或额外 Run。
2. 在**本地一次性根仓 Git fixture**安装/使用当前 `openspec` CLI，准备一个最小合法 Change、对应 Specs 与 `tasks.md`。不要把真实项目 Change 直接归档测试。
3. 使用临时目录 clone fixture，执行 `openspec archive <test-change-ref> --yes --json`；检查归档目录与 Specs 合并内容、未授权文件是否被修改。
4. 在**本地隔离 Git remote**完成 Commit / Push / 回读；如果需要在真实 TFS Git 远端验证，只使用单独授权的测试仓/分支，不写 `master` / `rondo`。
5. 删除临时目录；确认结果仍能从隔离 remote 回读。不以本地剩余文件作为成功依据。
6. 当前 Rondo `delivery finalize` 仍依赖 Project / 业务 hub，故此项在新实现前最多确认 Git/OpenSpec PoC 与运行环境；**不得**将其标记为真实 Finalize PASS。

**机制 PASS**：隔离 Git/OpenSpec 可完成归档并回读，不依赖 Engineer 目录。**端到端 PASS**：需在已适配的真实 PR Status Sync Runtime 中验证 V17。

**证据**：`openspec --version`、临时仓、归档前后 Diff、Push HEAD、归档路径与 Specs 校验、删除目录后回读结果。

### M10 — Prepare 后不依赖临时目录的 Writeback / Complete

**要回答**：Rondo 完成 Archive 后即使临时根仓被删除，是否还能读取 `tasks.md` / Evidence 并执行 TFS Writeback、Issue Done。

**操作**：

1. 用 M09 的隔离归档工件和**专用测试 Issue / TFS Work Item**准备一组完整 `finalize.pending.prepared_change_ref`、PR 与 Evidence 事实；不新增 Archive Commit SHA Metadata。
2. 在原 Finalize Runtime 完成 Prepare 后删除其临时根仓（仅测试目录）；在另一**授权测试 Runtime**继续读取已归档 Git 工件和执行后续步骤。
3. 验证 Writeback 所需的 Tasks 内容、Candidate / Repository Identity、TFS 子任务绑定与 Commit 关联不通过旧绝对路径反解。
4. 模拟 Push 已成功但 Prepare Metadata 写入失败、Prepare 成功但 Writeback 失败、Writeback 成功但 Complete 失败，核对只补未完成动作。
5. **没有隔离的 TFS/Multica 测试对象时，不执行任何实际 Writeback 或 Issue Done**；只能做读取或模拟，命令级/端到端状态记 `NOT_RUN`。

**PASS**：真实授权测试对象从另一 Runtime 完成 Writeback / Complete，且无需原临时目录、原 Engineer Runtime；中断恢复无重复副作用。只验证远程读取时记部分证据，不虚报整体 PASS。

**证据**：测试 Issue/TFS ID（仅内部报告）、Prepare/Facts 前后、远端工件、TFS 回读、Issue 状态、各故障点恢复结果。

### M11 — 权限、凭据和异常响应部署前验证

**要回答**：只读读源码与受控写工件能否在 Runtime 保持权限边界；TFS 2018 内网 HTTP 的使用是否符合部署策略。

**操作**：

1. 检查 Runtime Secret、CLI/Git 认证入口与日志脱敏方式；只查看**配置是否存在**，不导出值。
2. 使用经批准的低权限测试身份读取授权仓库、尝试访问应拒绝的仓库/路径；仅在授权的测试仓检查写入被拒绝，禁止用正式对象做负向写入。
3. 用已知的 T11 字符用例和非 JSON 404/401/403 模拟响应回归 Rondo HTTP 适配器，确认错误能被识别、不会静默回退本地 HEAD。
4. 记录实际 TFS API `4.0` 与当前 Rondo `4.1` 的兼容状况；HTTPS / HTTP 传输是否符合组织策略由部署负责人确认。

**PASS**：授权/拒绝规则真实可证、错误安全失败、凭据不泄露，部署安全要求明确满足。没有低权限账号或网络审批时 `NOT_RUN`，不自行降低 Gate。

### M12 — 可选 MCP 的源码与索引版本一致性

**要回答**：只有在启用 CodeGraph / Filesystem / Ripgrep 的场景，能否把结果可靠对应到已选 TFS Git Commit。

**操作**：

1. 记录 MCP 服务版本、目标仓库映射、镜像 HEAD、CodeGraph 索引版本（或可确定的对应 Commit）。
2. 在一个固定 SHA 上查询符号 / 文件，与 TFS Git API 该 SHA 的源码比对；确认版本不一致时只作为线索而非事实。
3. 模拟 MCP 不可用或索引过期，检查主流程仍能用 TFS Git API 继续分析或准确报告未知项。

**PASS**：对应同一 SHA 的证据一致；版本不一致时能明确降级。**NOT_RUN**：未启用 MCP，本项不作为 08 主流程阻塞。

## 5. 历史代码差异快照：不重复作为机制实验

本节是 2026-11-13 阅读仓库得到的代码快照；**不应要求 Codex 再开展独立机制实验才能承认当时存在这些差异**。当轮 M10 追加实施已更新下列远端收口相关行；当时工作区适配尚未发布，其余缺口不由 M10 PASS 自动消除。当前实施应核对实际源码与 08-A / 08-B，不能将本表的历史实施方向直接作为新任务。

| 文件 | 目前状态 | 后续实施方向 |
| --- | --- | --- |
| `docs/config/repo-context.yaml` / `.example` | 已有 `repo_url` 且在 Schema 中为必填 | 复用现有值，不另建 URL 配置 |
| `tools/repo_registry.py` | `RepoRecord` / `to_dict()` 尚未透传 `repo_url` | 按现有 Registry 契约补齐读取、输出与测试 |
| `tools/rondo/src/clients/runtime-paths.ts` | 原 Project 路径仍只解析 `local_directory(in_place)`；M10 增加 `remote_artifacts` 路径来源 | Git Resource 实际 checkout 路径的通用适配仍待实施 |
| `tools/rondo/src/commands/analysis/complete.ts` | 当前按本地 checkout 分支 Push | 固定根仓权威分支的受控发布 |
| `tools/rondo/src/commands/delivery/current-evidence.ts` | M10 远端模式已要求 `repo_key + repo_url + 完整 SHA`；本地模式保留兼容 | 上游 Evidence 发布适配仍需按 V12–V15 联合验收 |
| `tools/rondo/src/commands/delivery/finalize.ts` / `remote-artifacts.ts` | M10 已实现固定 SHA API 读取、临时根仓 Archive/push/回读/清理及远端恢复 | 完成生产配置、发布与实际 Autopilot 联合验收后再切换 |
| `tools/rondo/src/commands/tfs/writeback.ts` / `evidence-repository.ts` | M10 已实现归档 API 读取、稳定仓库身份关联及跨 Runtime 写回 | 保留 TFS 必填估算等规则；实际业务输入与部署权限继续验收 |
| `projects/multica/agents/pr-status-sync-agent/autopilot-prompt.md` | 已要求 `finalize / resume_finalize` 后使用 `finalize-delivery` | 验证真实执行；**不是**重新设计触发链路 |

08 v0.9 的 §6.1 仍带有旧版“YAML 无 `repo_url`”的历史描述；以**当前 `main` 文件内容**为准，后续文档修订应清理旧事实，但不阻碍 M01–M03 的机制验证。

## 6. 历史结果登记与判定模板

### 6.1 历史机制结果登记（当前待验项另见 §1.3）

| 编号 | 结果 | 环境与模式 | 关键证据 | 阻碍/失败原因 | 对 08 设计影响 |
| --- | --- | --- | --- | --- | --- |
| M01 | PASS | Windows / rondo-test / Codex (lileipc)，TEST-5/6，ref=main | [结果](08-mechanism-results/M01.md)：首次 6.745s、干净重入 4.224s、脏树重入 3.799s；独立 Run 两次成功；身份和 Hash 核对 | TEST-4 首次后台 clone 网络失败；保留[定位记录](08-mechanism-results/M01-M02-rerun-failure-analysis.md)。四类业务 Agent、冷启动时限保障、未推送 Commit 未覆盖 | 原生根仓机制成立；补齐 cache 就绪与首次同步失败恢复策略；不等于完整 V05 |
| M02 | PASS | Codex (lileipc)，TEST-7/8，MXC/workspace-write/never | [结果](08-mechanism-results/M02.md)：62+28 项断言；真实 Task 自主双 clone；TEST-7 before/after 完全相同 | 默认 MSYS 仍不兼容；使用显式 BusyBox MinGit 子进程调用；dev prepare 命令 NOT_RUN | 二级结构成立；prepare 需选择兼容工具，不依赖 custom_env.PATH |
| M03 | PASS | TEST-10 无 Project / Codex (lileipc) / Rondo 1.2.20 | [结果](08-mechanism-results/M03.md)：7/7 行为与 11/11 上下文核对通过；API 4.0/4.1 同 SHA/Hash，三项负向关闭 | 采用授权测试指针，不代表新生产审批或交付 E2E | 固定 SHA 的无根仓读取命令成立 |
| M04 | PASS | 本地私有 Git remote PoC | [结果](08-mechanism-results/M04.md)：白名单发布、目标前进、冲突停止、丢响应回读；Agent 脏树不变 | 契约 master / Project main / 当前分支 Push 尚不统一；正式权限及适配未验 | 固定权威 ref 后实施受限发布，不随 Agent 分支漂移 |
| M05 | PASS | 本地隔离 Git PoC | [结果](08-mechanism-results/M05.md)：C1 固定、C2 最新进度，合同 Hash 一致 | Rondo 跨 Runtime 完整命令链未验 | 批准版本与最新进度分别读取 |
| M06 | PASS | 本地二级 Git / 显式 guard PoC | [结果](08-mechanism-results/M06.md)：clone、fetch、ff-only；错 origin、脏树、未 Push、未授权均停止 | dev prepare 尚未实现；真实认证与派发联合验收未验 | 按现有 registry 准备直接子目录，保留未发布工作 |
| M07 | PASS | 两个模拟 Engineer 顺序发布 PoC | [结果](08-mechanism-results/M07.md)：旧 HEAD Push 被拒，重核后 A/B checkbox 与 Evidence 均保留 | Multica Facts + Rondo 联合验收 NOT_RUN | 读取最新权威版本后只补未发布工件，不引入新锁 |
| M08 | PASS | 真实 Rondo / TFS 只读 | [结果](08-mechanism-results/M08.md)：PR 3532 sourceCommitId 与固定根仓 Evidence Candidate 精确匹配；4.0/4.1 内容一致 | 仅一例历史 completed PR，未做生产写入 | 既有精确源 Commit Gate 可保留 |
| M09 | PASS | OpenSpec 1.13.2 / 本地私有 remote | [结果](08-mechanism-results/M09.md)：归档、合并 specs、发布、删除临时 clone 后 remote 回读 | 本项为原始 PoC；真实 Finalize 适配与双 Runtime 验证见 M10，生产 Autopilot 未验；清理只读属性失败已恢复 | 临时根仓机制成立，不新增 Archive Commit Metadata |
| M10 | PASS | TEST-13/14/15；Codex Prepare → Claude Writeback/Complete；工作区未发布适配 | [结果](08-mechanism-results/M10.md)：Prepare 11/11、finish 23/23；三个中断点恢复及重放；260986/264845 已解决，TEST-13 done；独立回读 43/43（含文件校验） | 已修复沙箱认证、clone 超时、测试驱动 Windows import；测试子项补充明确标识的估算 1h 后通过；生产部署与完整 Autopilot 未验 | 远端工件与稳定仓库身份适配成立，原临时目录删除后可跨 Runtime 独立收口 |
| M11 | NOT_RUN | 真实 T11 GET、匿名 GET、异常模拟；用户确认 HTTP 可用于本次验证 | [结果](08-mechanism-results/M11.md)：六组路径兼容、匿名 401、错误安全关闭；M03 真实 Runtime 认证读取成功 | 用户明确没有低权限身份；未做越权读取/拒绝写入 | 仅保留实际权限隔离 Gate，不把匿名拒绝替代低权限测试 |
| M12 | PASS | 只读索引快照 + TEST-11 Codex Runtime 隔离降级 PoC | [结果](08-mechanism-results/M12.md)：476/476 索引文件对应固定 Commit；正常/不可用/过期三场景均用真实同 SHA API 完成 | 生产自动编排适配仍待实施；索引核对不证明所有图谱语义正确 | MCP 可选增强机制成立，权威事实仍取固定 SHA API |

### 6.2 单项报告模板

复制此段作为 `MXX` 的单项记录，建议保存为与本计划相邻的 `08-mechanism-results/MXX.md`。验证完成前不要直接修改 08 设计文件。

```markdown
# MXX — <机制名称> 验证结果

- 日期：YYYY-MM-DD
- 验证人/工具：Codex CLI / <本机环境>
- 对应 08 章节与 V 项：
- 本次状态：PASS / FAIL / NOT_RUN
- 证据层级：机制 PoC / Rondo 适配 / 端到端

## 环境与前置条件
- Multica CLI / Daemon / Runtime：
- Rondo、OpenSpec、Git：
- Repo/Project/Issue：脱敏标识
- 测试身份、工作区与授权范围：

## 已执行操作及证据
| 序号 | 命令或步骤（脱敏） | 预期 | 实际 | 证据位置 |
| --- | --- | --- | --- | --- |
| 1 |  |  |  |  |

## 验收核对
- [ ] 关键身份（仓库 / Commit / Task / Issue）核对一致
- [ ] 核心正向行为符合 MXX 的 PASS 标准
- [ ] 必要负向行为安全停止
- [ ] 无未授权持久化副作用；必要清理已回读确认
- [ ] 证据足以支持结论；未执行项已明确记录

## 结论与设计决策
- 状态：
- 已证明的机制：
- 未证明的部分：
- 是否需要修改 08 方案：否 / 是（最小建议） / 待后续验证
- 下一步建议：仅下一个 M 编号或指定代码适配，不自动实施
```

### 6.3 需要修改 08 方案时的判断原则

- **机制 PASS，代码未实现**：不修改架构，进入 Rondo 最小适配。
- **机制 FAIL 且已具备有效前置条件**：只修该项假设；例如根仓 checkout 不可用，才讨论根仓准备的最小替代实现。
- **NOT_RUN / 证据不足**：补齐条件后复测，不据猜测改方案。
- **TFS API 已 PASS，但 Rondo 不兼容**：定位具体客户端/API 版本/数据契约问题，不把整个 TFS Git 方向判定失败。
- **M10 仍需要临时目录**：修正 Writeback/Complete 的读取方式，不引入新 Agent 或 Archive Commit Metadata。

## 7. 历史推荐起点与当前使用边界

当轮建议第一项仅执行 **M01**，用于确认 08 v0.9 §5.1 的原生根仓前提。该机制现已有证据；当前从 §1.3 的待验清单出发，检验原生 checkout 就绪与消费方行为，不因旧起点再次自建 checkout 流程。没有授权的真实 Task Run 时，相关集成项目保持 `NOT_RUN`，不要用普通 PowerShell 的失败代替真实结果。

**当前文档验收完成条件**：历史结果的基线与局限可追溯；§1.3–§1.4 每个项目有真实状态和相应证据，配置回读与实际恢复验证分开记录；正式切换满足当前 08-A §4、08-B 对应阶段及部署条件。历史 v0.9 的 V01–V22 编号留作证据定位，不直接套用为拆分后方案的验收标准；本文不自动批准正式切换。

## 8. 参考资料

- [08 方案 v0.9](https://github.com/lilei921/winning-platform-monorepo/blob/main/projects/multica/08-remote-analysis-git-workspace-design.md)
- [TFS Git API 验证记录](https://github.com/lilei921/winning-platform-monorepo/blob/main/projects/multica/validation/tfs-git-api-pr-cas-validation-2026-11-12.md)
- [T11 结构化证据](https://github.com/lilei921/winning-platform-monorepo/blob/main/projects/multica/validation/tfs-git-api-t11-paths-2026-11-12.evidence.json)
- [datamodel 纯 TFS Git API 分析记录](https://github.com/lilei921/winning-platform-monorepo/blob/main/projects/multica/validation/datamodel-tfs-api-analysis-2026-11-12.md)
- [Multica 上游 Runtimes and Repos](https://github.com/multica-ai/multica/blob/main/server/internal/service/builtin_skills/multica-platform/references/runtimes.md)
- [Multica 上游 Project Resources](https://github.com/multica-ai/multica/blob/main/server/internal/service/builtin_skills/multica-platform/references/projects.md)
