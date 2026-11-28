# Multica + OpenSpec 工程实施推进计划

> Date: 2026-11-06  
> Version: 1.3.7  
> Status: Implementation Planning Baseline（实施基线；不代表代码、正式 Runtime 或全链路已验收）  
> Scope: 对 01–06 已确定设计做工程实施排序、交付跟踪和验收；**不新增** Workflow Runner、交付状态或事实源。
> Tracker: [在线 Google Sheets 实施跟踪表](https://docs.google.com/spreadsheets/d/1DGW-nhkyQGpjZHXnrMQI2yUpJrN83LkLzwghOCEf0QE/edit)；16 Step、17 工作包（07-A/07-B 分开）与 78 条具体任务。

## 0. 定位、原则和权威边界

当前目标模型在设计、Workitem Analyst 配置及 `rondo` / Gate / Finalize 的独立 PR 中分层落实；以上变更须通过自动化及隔离 Workspace 验收后统一发布。项目尚未上线，不需要历史 Issue 数据迁移。当前重点从设计讨论转向工程交付。先交付可真实关闭的 **Corrective** 链路，让团队尽早 Pilot，再扩展 Intentional、按需 Verify Agent、多仓交付和推广。旧 12 步调整为 **5 阶段 / 16 Step**，执行时并行研发、按需串行集成，不能把 16 个 Step 误读成 16 道串行 Gate。

- **Native First / KISS / One Rule–One Owner**：Multica = Delivery Truth，OpenSpec = Engineering Truth；使用原生 Assignment、Mention、Comment、Human Approval 与 OpenSpec 工程契约；确定性副作用交由 Script/Gate。
- **证据驱动**：设计已收口、文件存在、隔离 Spike PASS 与正式环境 E2E PASS 是四种不同结论；任何工作包以可复现验收证据完成。
- **Goal Ownership / Skill Composition**：Agent 对长期专业目标、工作方式与最终结果负责；Skill 是按需组合的可复用工作方法包（步骤、资料、工具、模板），专业结果型 Skill 可选定义局部 Capability Outcome；提取以跨任务/角色复用和维护价值为依据，不以 Agent 绑定数量、固定章节或固定执行链判定实施完成。
- **Corrective First**：首轮 `Corrective`；Human 可批准 `verify_agent.required=false` 的真实用例，但不取消 Task Verification、Local Validation、Code Review；暂不自动处理超出授权与交付能力的大型复杂需求。
- **并行独立研发**：OpenSpec、TFS-MCP、Multica B-Core、TFS Sync、Wayfinder 等按各自前置条件并行；进入具体 E2E 之前做相应集成验收。
- **不因入口增加强制 Gate**：显式 Direct Assignment 可以绕过 Wayfinder；自动 TFS 入口必须经 Wayfinder `eligible / needs_human / unsupported`，二者都须通过 Analysis Gate 与 Human Review。

### 0.1 设计文档定位

| 权威文档 | 文档版本 / 基线标识（以当前仓库为准） | 权威范围 |
|---|---|---|
| [01](01-multica-openspec-design-guideline.md) | 1.16.11 | Native Mechanism、Agent Instructions 的长期工作方式、Skill 的复用与按需加载边界 |
| [02](02-multica-delivery-lifecycle-design.md) | 1.6.12 | Delivery Lifecycle、Wayfinder、人审、PR/Finalize |
| [03](03-workitem-analysis-design.md) | 1.19.5（历史版本标识） | Analyst Goal、能力选择与可复用 Skill 提取、Change Kind、Analysis Gate |
| [04](04-engineer-development-design.md) | 1.15.4 | Task Set、Engineer、Evidence 与 Completion |
| [05](05-openspec-schema-implementation-design.md) | 1.5.2 | 两 Schema、Task Identity、Resolver/Writer、Archive |
| [06](06-method-skill-library-implementation-design.md) | 1.4.1 | Project Skill 与内部 Method 的归属 |

## 1. 目标链路与五阶段规划

```text
TFS Sync → Wayfinder eligible → Delivery Squad → Delivery Lead → Workitem Analyst
       ├─ needs_human → blocked → Human 回复并改 todo 重新准入
       └─ unsupported → unsupported(closed) → 显式重进验收
             ↑
Direct Assignment ──┘（明确直接委派可绕过 Wayfinder）

Analysis Gate PASS → analysis_review → Human APPROVED → 根仓批准基线 Commit
→ Engineer Task Set → Task/Local Verification + Code Review → Completion Check
→ Task Progress Patch/Readback → READY → （若 Human 决定）Independent Verify
→ PR Materialization → PR completed → Post-Merge/Completion Gate
→ OpenSpec Archive + 根仓 Commit → TFS Close → Delivery Issue Done
```

| 阶段 | Step 范围 | 里程碑 | 必须交付的出口 |
|---|---|---|---|
| **P0 基础机制验证与工程环境准备** | 01–04 | M1 Foundation Ready | 核心正式 Runtime、Corrective Foundation 与接口契约可用 |
| **P1 Corrective 研发交付能力建设与全流程验收** | 05–09（07 为 07-A/07-B） | M2 Corrective E2E Ready | Corrective 真实自动入口及最短交付闭环 |
| **P2 Corrective 真实任务小范围试运行** | 10 | M3 Pilot Accepted | 真实工作项稳定跑通，形成初始问题与指标基线 |
| **P3 Intentional、独立 Verify 与多仓交付能力建设** | 11–13 | M4 Extended Delivery Ready | Intentional、Independent Verify、多仓、多 PR 集成通过 |
| **P4 试运行问题整改、团队推广与持续优化** | 14–16 | M5 Team Rollout | 反馈整改、扩大 Pilot、用数据持续优化 |

Step 07 拆为 **07-A（TFS Sync 自动入口）** 和 **07-B（PR Status Sync / Finalize）**，二者独立开发、独立验收，因此 16 Step 对应 Excel 的 17 个工作包。

## 2. 已有资产、验证范围与正式实施差距

- **隔离验证已取得限定证据**：Multica 0.6.1（commit `2ea01ae4e`）的 R01–R05 PASS；Wayfinder WFP-8/9/10 已有隔离分支 E2E PASS。R06 Sub-Issue/Stage NOT_RUN，不阻塞首轮 Parent-only Pilot。
- **正式环境尚未通过**：同机跨 Run 文件读取不等于正式共享 Git 根仓持久读写；原测试路径 `D:` 写入曾出现 `UnauthorizedAccessException`。正式 Status Key、Squad/Skills 和 Human Approval 基线顺序仍须回读。
- **自动入口的实际阻塞**：TFS Sync 最近读取的 20 次 Run 因 `agent runtime is offline at dispatch time` 均为 skipped；Wayfinder `unsupported(closed)` 显式重新准入只有 SOP，尚未取得 E2E PASS。
- **工程资产已有但未完整验收**：`openspec/schemas/corrective-change/` 和 `intentional-change/` 已有 Schema/Templates，Corrective 有部分测试；Resolver、Task Writer、Native 集成、并发恢复须补证据。现有文档中的过时“Schema 未发现”已被更新纠正。
- **Task Identity** 使用 OpenSpec 原生任务编号（如 `1.1`、`1.2`），不创建 `T-xxx`、`AC-xxx`、`VR-xxx` 身份体系。

### 2.1 Step 01 / Wayfinder 验证事实与当前实施状态（截至 2026-10-13）

权威执行记录：[Step 01 Runtime Spike Result](validation/01-runtime-asset-inventory-and-spike-result-2026-10-12.md)；操作流程：[Step 01 SOP](validation/01-runtime-asset-inventory-and-spike-0.6.1.md)；已有源码证据：[0.6.1 Run / Session 核验](validation/issue-run-retry-reuse-0.6.1-2026-10-09.md)。

| 范围 | 结果 | 应用于本路线图 |
|---|---|---|
| Multica 0.6.1（commit `2ea01ae4e`）/ OpenSpec 1.13.2 | 运行版本已实查 | 不重新选型；OpenSpec 继续按 05 固定基线实施 |
| R01：隔离 Squad-owned Issue `backlog→todo` 启动 Leader（**未运行 Wayfinder**） | PASS（仅 Squad 原生启动） | Wayfinder 准入、`/note` 回读与交接必须单独集成验收，不能冒用本项 PASS |
| R02：真实 `@mention` 派发 Specialist | PASS | 默认 Parent + Mention，暂不自建普通派工引擎 |
| R03：`analysis_review` + Human Comment 回流 | PASS（隔离测试） | 继续采用顶层评论；正式批准基线 Commit、`in_progress` 状态回读、工程启动顺序**仍待验证** |
| R04：跨 Agent / Run 共享文件读取 | PASS（同机绝对路径） | 不等于正式根仓持久共享已验证；预设 `D:` 写入遭遇 `UnauthorizedAccessException` |
| R05：Run 串行 / 重复回流 / 超时恢复 | PASS（修订 Spike Lead 指令后） | **保留首轮重复派工与盲重试失败证据**；正式幂等仍由真实事实查询与必要 Adapter / Script 负责 |
| [WFP-8](validation/wayfinder-needs-human-resume-single-update-e2e-2026-10-13.md)：`blocked + Wayfinder → todo + Squad` | E2E PASS（隔离） | 真实 Human Mention、线程内 `/note` 回复与单次 Assignment Update；不等同于正式 Workspace |
| [WFP-9](validation/wayfinder-first-todo-to-squad-2026-10-13.md)：首次 `todo + Wayfinder → todo + Squad` | E2E PASS（隔离启动） | 该次顶层 Decision 缺少 `/note` 前缀，不算 Note 静默性测试 |
| [WFP-10](validation/wayfinder-todo-ui-mention-to-squad-2026-10-13.md)：真实 UI Mention → `/note` 回复 → 唯一 Lead Run | E2E PASS（隔离） | 起点由 `--no-start` 预置；未验证真实 TFS Sync 初始化 |
| [`unsupported` 恢复 SOP](validation/wayfinder-unsupported-reentry-e2e-sop-2026-10-13.md) | **NOT_RUN** | `closed` 状态真实 Mention、回复及重新交接不得借用 WFP-8/9/10 的 PASS |
| R06：Sub-Issue / Stage | NOT_RUN | 后移到需要 Runtime Isolation 的阶段，不阻塞首个 Parent-only Pilot |

资产盘点发现的实际缺口：

- **正式部署环境**：初步选择已有 Squad 的 `winning-dps-df`，但它的 Squad Instructions 有固定 Verify / 旧 PR 协作规则，Lead / Analyst 尚未绑定专业 Skills；最终目标 Workspace 及 TFS 路由须核准。正式 `analysis_review` 设置尚未直接读取。
- **专业能力**：Wayfinder Agent / `workitem-triage` 在正式 Workspace 尚无运行验收；Backend / Frontend / Flink Engineer、Verify Agent、PR Status Sync Agent 尚未发现；按对应接入阶段创建，不要求 Step 02 一次补全。
- **TFS Sync 定时运行**：绑定 Skill 的 Autopilot 已启用，但最近读取的 20 次 Run 全部 `skipped`，原因均为 `agent runtime is offline at dispatch time`；本地 TFS Sync 14 项单元测试 PASS 不代表 09:00 定时执行可用。
- **Engineering Foundation**：两套目标 Schema 与 Resolver / Task Progress Writer 尚未发现，属于主线 A 的明确缺口。
- **共享工作区**：同机不同 Agent 可按绝对路径读取文件，但原定 `D:` 测试目录不可写；正式共享 Git 根仓路径、Agent 写权限、未提交工件持久化与清理策略需要在主线 B 明确。

**截至 2026-10-13 的仓库资产复核**：`openspec/schemas/corrective-change/` 与 `openspec/schemas/intentional-change/` 的 Schema / Templates 已在根仓，`tests/schema/test_corrective_change.py` 已存在。该事实更新上方 2026-10-12 资产盘点中的“Schema 尚未发现”，但**不代表两套 Schema 的原生集成验收、Resolver / Writer 或 Foundation 整体已通过**；后续按 Step 02 检查缺项，不重复创建既存文件。

**阶段判定**：Step 01 原生协作与上述 Wayfinder 隔离分支已得到限定范围的证据；正式 Workspace、真实 TFS 来源、`unsupported` 恢复以及完整交付尚未验收。可继续实施 A 与 B-Core；B-Intake 按正式自动入口上线条件验收。

## 3. 实施过程中需验证的六类风险

### 3.1 Multica 原生机制与跨 Run 工作区

**已得到的实际证据**：R01–R05 在隔离 Workspace PASS，证明 0.6.1 的 Squad 启动、真实 Mention、Human Comment 回流、同机跨 Agent Run 读文件，以及先回读再避免重复业务写入的可行性；Wayfinder WFP-8/9/10 分别补充了恢复交接、首次交接与真实 UI Mention / `/note` 回复的隔离证据。R05 首轮仍出现过重复 Run / 盲重试，不能将原生去重扩大为业务副作用 exactly-once 保证。WFP-8/9/10 等早期 Mention 验证只表示历史测试入口，不替代当前按 Wayfinder Assignment + Human Status `todo` 触发的设计规则。

**仍需在正式集成前验证 / 解决**：

1. 选定正式 Workspace，核实 `analysis_review` Key / Category 的真实 API 表达；隔离读到的 `status_category=in_progress` 与设计的 `started` 是术语映射待核对，不自行判断冲突已消失。
2. 同机目标共享**根仓**可读写，Agent 跨 Run 能访问未提交 OpenSpec 产物；工作目录权限、Runtime 归属、锁和清理策略可解释。当前 D 盘路径写入失败，托管 task workdir 的单文件读取不能替代该验收。
3. 正式 Lead 在重复 Human Comment、派工、网络超时后采用**先回读、再 NO-OP / 补写**；正式 Skills 与配置并未随 Spike 自动修正。
4. R06 Sub-Issue / Stage 留待实际采用 Sub-Issue 的 Development Projection 验证；**不作为** OpenSpec Foundation 或首次 Parent-only Analysis 的前置条件。
5. 同机 Codex 已有实测。Claude、跨机器共享和更复杂目录恢复须在正式启用相应 Runtime / 场景之前补证据。
6. **B-Intake**：正式 Workspace 需核实 `todo + Wayfinder` 初始激活、两种 `/note` 写入与统一读取、`eligible / needs_human / unsupported`、单次 Squad Assignment 与异常回读；`unsupported (closed)` 显式恢复目前只有 SOP（`NOT_RUN`），不能声明可用。
7. 已交接 Issue 如 TFS 来源变更，在 Analysis 提交及批准基线使用前复核差异是否改变业务范围、授权或 Engineering Contract；非实质管理变更可以记录后继续，不要求因 ChangedDate 变化自动重跑 Wayfinder。

**产出**：维持并引用现有 Spike 结果；新的工作重点是正式 Workspace 适配、共享工程目录和恢复校验，而不是重复一轮完整原生机制研究。

### 3.2 OpenSpec Foundation 的有效性

05 将 OpenSpec 版本固定为 `1.13.2`。必须核实 `openspec --version` 和 `openspec schema which` 指向当前 Project Schema，验证 `skip_specs`、Conditional Design、`artifact.requires`、`apply.requires`、`apply.tracks`、Validation 和 Archive。不能把 05 的 P0 Resolved 当成代码实现与回归完成。

### 3.3 Human Analysis Review 交接

```text
Workitem Analyst
  → Analysis Gate PASS
  → OpenSpec / Handoff Facts 发布
  → analysis_review 写入并回读
  → Analyst Run 结束
  → Human Comment
  → Delivery Lead 理解批准 / 驳回 / 变更意见
  → 批准：批准边界 + 根仓基线 Commit → Development
  → 驳回：定向 Analysis 返工
```

不得把 `analysis_review` 看作自动全局锁，也不能把 `in_progress` 当作已批准事实。Human 对 `verify_agent.required` 作最终决策；Analysis 的 Recommendation 不能自行变为审批结果。需检验重复评论、失败重试和写入未知是否造成重复派工。

### 3.4 同仓唯一 Engineer + 共享根仓并发

同一个 Delivery Issue 内，同一个 Repository 的全部 Task Sets 只能由当前唯一有效 Engineer 承接；跨 Repository 的 Engineer 可并行。多 Task、多 Engineer、多 Repository、多 PR 并不天然要求 Development Sub-Issue，只有独立持久运行态的实际需求才创建。

共享 `tasks.md` 更新必须通过 **change-scoped single-writer critical section**，临界区内重读、定位、冲突校验、原子写入、回读；对根仓不同 Change 的并行提交也要核对 Git 工作区和 index 冲突。根仓最初批准基线先 Commit，研发中间可保留未提交进度，最终由 Finalize 收口；需测试未提交修改丢失后的恢复。

### 3.5 Verification 分层

| 机制 | 适用性 | Owner |
|---|---|---|
| Task-level Verification | 每个 Implementation Task 必需 | 当前 Engineer |
| Change-level Verification Task | 跨 Task / Module / Repository 才可证明的组合行为按需建立 | 由 Multica Runtime Projection 指派 Engineer 或 Verify Agent |
| Independent Verification | Human 最终批准 `verify_agent.required=true` 才有 | Verify Agent |
| Local Validation 与 Code Review | Development 必备 | Engineer |

若 Verify Agent 被分配了 Change-level Verification Task，该 Task 可在 Engineer READY 时 pending，由 Verify Agent 执行并更新；不能错误要求“所有 Tasks 已完成”才允许 Verify Agent 启动，形成死锁。

### 3.6 PR / Finalize 的外部事实、幂等和安全停止

PR 平台的 `status` 是 `rondo pr reconcile-status` 判定依据：`active` 等待；`completed` 允许核查 Finalize；`abandoned` 进入异常与人工决策；冲突或未知事实返回 UNKNOWN。不得复制外部 PR Review 状态机。

Finalize 每次读取现实外部事实和已完成后置条件，只补缺失动作：PR completed → Post-Merge Reconciliation → Completion Gate → Archive / 根仓 Commit → TFS Close → Delivery Issue Done。`CANCEL_DELIVERY` 的完整后置条件尚未定义：在专项契约补齐前，只做安全停止和人工处理，不臆造自动取消机制。


## 4. 工程实施 Backlog（16 Step）

每项由 **范围、交付物、验收标准、依赖** 构成。Owner/日期/执行状态/验收状态在 Excel 更新，未形成真实证据的工作包不得标为 Accepted。Analysis Skill 数量不作硬指标；保留当前已注册专业 Skill 与确定性交付边界，独立能力仅在 [03](03-workitem-analysis-design.md) / [06](06-method-skill-library-implementation-design.md) 的提取条件满足时增加。

### P0 — 基础机制验证与工程环境准备

#### Step 01 — Multica / OpenSpec 核心机制验证

**实施范围**：复用 R01–R05、WFP-8/9/10 隔离 Spike；正式 Workspace 验证 Squad、Assignment、Mention、Comment/Human Review、/note 双写入单读取、Status、持久共享根仓及 OpenSpec Native 操作；补齐未验收分支。

**交付物**：正式运行时配置/权限和操作证据；机制验证记录与待修复问题。

**验收**：正式环境的派工、Human 回流、根仓读写和基础 OpenSpec 操作可复现；隔离 Spike 不能冒充正式 PASS。

**依赖/依据**：01/02；与 02/03/04 并行。

#### Step 02 — TFS-MCP 常用接口与改造范围

**实施范围**：盘点实际 TFS-MCP 工具及调用方；对照 Work Item 增量查询（ChangedDate）、详情、父子关联、评论附件、状态/Identity/权限写回需求；明确实际 API 的输入输出、失败与重试契约，区分复用/修补/重写，避免预设不存在的接口。

**交付物**：Interface Inventory、接口契约、兼容性缺口和重写 Backlog、真实调用测试。

**验收**：TFS Sync、Analyst、Finalize 首期接口可调用；ChangedDate、权限与错误语义一致；改造边界明确。

**依赖/依据**：02 §4/§12；可与 03/04 并行。

#### Step 03 — OpenSpec Schema / Template Foundation

**实施范围**：以现有 corrective-change Schema/Templates 为起点，验证 proposal/specs/design/tasks 的实际原生契约；补齐 resolve-openspec-change.py、update-task-progress.py、active-first/archive fallback、原生任务编号、并发回读与 Native Validation/Archive。intentional-change 尽量复用 spec-driven，按 05 明确差异增量适配，不强制取消原生可选机制。

**研发任务拆解（4 项）**：

1. **03-01 — 实现 Corrective Change Schema / Templates**：盘点现有 OpenSpec 资产，补齐 `corrective-change` Schema、Templates、Artifact Instructions，验证 Proposal / Specs / Tasks 的原生生成、Validation 和兼容性；交付工程契约及测试证据。
2. **03-02 — 实现 Change Resolver 与 Task Progress Writer**：分别开发 `resolve-openspec-change.py`、`update-task-progress.py`，实现 Active-first / Archive fallback、原生任务编号、`tasks.md` change-scoped 单写、安全 Patch、冲突检查与原子回读；两个 Script 保持独立，作为同一工程工具任务交付。
3. **03-03 — 完善 Intentional Change 基础 Schema / Templates**：优先复用 `spec-driven`，仅实现 `intentional-change` 所需的 Schema / Templates 差异，保留原生可选机制；完整 Intentional 分析与开发仍由 Step 11 实现。
4. **03-04 — 完成 OpenSpec Foundation 集成验证**：验证 Corrective Change 创建、Native Validation、Task Progress Patch / Readback、Archive，以及并发冲突和失败恢复；不重复 Step 05 / 06 / 09 承担的 Analyst→Engineer 交付 E2E。

**交付物**：两套 Schema/Templates、Resolver/Writer、正反向测试与恢复记录。

**验收**：Corrective Contract 可真实创建、验证、归档并安全更新 Task Progress；Intentional 在 Step 11 接入前完成其所需回归。已有文件不是自动 PASS。

**依赖/依据**：05；与 04 并行。

#### Step 04 — Delivery Squad 基础定义

**实施范围**：落地 Squad Description/Instructions、Delivery Lead 与初期 Analyst/Backend Agent、Roster、Skill 绑定和权限；正式核实 analysis_review/unsupported Status Key、共享根仓、原生 Run 触发；移除旧固定 Verify/PR 分工。

**研发任务拆解（4 项）**：

1. **设计并编写** Delivery Squad 和 Delivery Lead 的 Description / Instructions，明确职责与原生协作规则。
2. 创建并配置 Squad、Lead、最小成员、Roster、Status Key、Runtime 和基础 Skill 绑定。
3. 配置共享 Monorepo 权限，验证正式环境和跨 Run 持久读写。
4. 验证 Lead 的原生 Assignment / Mention / Comment、Human Handoff 与重复触发控制。

**职责边界**：本 Step 实现 Squad / Lead 基础协作能力；Workitem Analyst Agent / Skills 由 Step 05 研发，Backend Engineer Agent / Skills 由 Step 06 研发，不作为 Step 04 完成的前置假设。

**交付物**：正式 Workspace 配置和回读、Agent/Instructions、共享工程目录证据。

**验收**：Delivery Lead 能按 Squad 规则 @mention Analyst；正式多 Run 可访问持续工程产物，重复触发不盲目派发。

**依赖/依据**：01/02；先于 Step 05 集成。

### P1 — Corrective 研发交付能力建设与全流程验收

#### Step 05 — Workitem Analyst 阶段实施

**实施范围**：落实 Workitem Analyst 专业 Goal，当前以 `codebase-explorer`、`bug-analysis`、`requirement-analysis`、`spec-preparation` 按需组合，使用 `analysis-publish` / `delivery-gate` 收口；原 `workitem-analysis` 已退役但保留源文件。验证 Change Kind 判断、现有 Change 解析与 Schema 读取，不引入独立 Analysis Route 配置。首期跑通 Corrective，Wayfinder Evidence 按需复用，明确直接委派可绕过准入。

**研发任务拆解（7 项）**：

1. **核对并优化专业目标与场景入口**：评审当前 Workitem Analyst 的专业职责、按复杂度自主执行与现有证据增量复用；针对典型 Corrective / Intentional 用例验证专业结果，不将不同能力固定串行。
2. **按证据提取可复用能力**：优先评估 `bug-analysis`、`requirement-analysis`，其他候选 Skill 仅在有独立复用收益时注册；保持 `analysis-publish` / Gate 的确定性交付能力，不复制 OpenSpec Schema。
3. 更新 Workitem Analyst Agent Instructions 的 `Goal`、职责和边界，按最终确认的真实 Skill 集合登记绑定与可访问性；不以设计候选目录视作已部署。
4. 验证 Technical Change Kind 的语义判断、Multica Issue Metadata `analysis.change_kind` 的持久化与回读、Schema 首次选择及跨 Run 读取，并验证分类与 Schema 一致；不新增 Analysis Route 配置或映射脚本。
5. 集成 Step 03 的 OpenSpec Contract，生成并校验 Corrective Proposal / Specs / Tasks，不重复实现 Schema。
6. 开发 Analysis Gate、Human Review / 驳回返工与 `APPROVED` 后的根仓基线 Commit。
7. 完成 TFS Bug（Corrective） / TFS Requirement（Corrective） 分析阶段 E2E、边界和失败恢复验收。

**交付物**：Agent Goal / Instructions、实际启用的 Skills 与绑定清单、适用 Change Kind / Gate 验证；Engineering Contract、审核及代表性执行证据。

**验收**：Corrective 分析包含真实 Root Cause / Fix / Regression / Tasks；Agent 在代表性简单 / 复杂场景选择必要能力，不为执行全部候选 Skill 制造无关步骤；`analysis_review` 提交 / 回读、Human APPROVED / REJECTED / 返工与批准根仓 Commit 可复现。

**依赖/依据**：03/06；依赖 03 Corrective Foundation + 04 B-Core。

#### Step 06 — Development — Corrective

**实施范围**：实现 Backend Engineer、development-execution、backend-engineering 及 tdd、code-review、verification-before-completion 等内部 Method；Delivery Lead 基于批准 task_refs 做 Task Set Projection；验证/证据、Completion Check、原生 Task Progress Patch/Readback、Commit/Push 与 PR Preparation。

**研发任务拆解（6 项）**：

1. **06-01** 设计并编写 Backend Engineer Description / Instructions，明确获批任务边界和运行配置。交付：Backend Engineer Description / Instructions、Runtime 配置与评审记录。
2. **06-02** 编写 development-execution、backend-engineering Skills 及必要的 TDD / Code Review / Verification Methods。交付：SKILL.md / Methods、调用样例、单元与负向测试。
3. **06-03** 开发 Task Set Projection 和派工规则，落实同仓唯一 Engineer Owner。交付：Task Set Projection / 派工契约、Owner 冲突测试及结果回读。
4. **06-04** 集成 Skills 与业务代码执行，实施 Local Validation、Code Review 和 Evidence 采集。交付：Corrective 代码变更样例、测试日志、Code Review / Evidence 记录。
5. **06-05** 开发 Completion Check 并集成 Task Progress Writer 的 Patch / Readback 及 READY 流转。交付：Completion Check Script、Patch / Readback 与 READY 测试记录。
6. **06-06** 完成 Backend Corrective 从 APPROVED 基线到 READY 的 E2E 与失败恢复回归。交付：Backend Engineer E2E 报告、负向用例与恢复证据。

**交付物**：Engineer Agent/Skills/Methods、Task Set 分工、测试/Evidence、Completion Script。

**验收**：Human APPROVED 基线后真实编码；同仓唯一 Engineer；Check PASS→Patch/Readback→READY；旧 Evidence、越权任务修改、冲突均安全停止。

**依赖/依据**：02/04/05/06；依赖 Step 05 审核。

#### Step 07-A — TFS Sync 自动入口研发

**实施范围**：TFS Sync Autopilot / Thin Agent 只负责触发、直接调用 Rondo CLI 与报告；增量同步、Issue 创建/去重、来源保存、Wayfinder 指派与 todo 激活由确定性 `reconcile-workitem.py` 完成；按 ChangedDate 增量处理，已有 Issue 不复位 Status/Owner；修复正式定时 Runtime Offline。

**研发任务拆解（3 项）**：

1. **07-A-01 — 实现 TFS Work Item 增量同步脚本**：开发/完善 `reconcile-workitem.py`，覆盖 ChangedDate、Issue 映射/幂等、来源变化、Wayfinder 指派和 todo 状态；交付同步脚本及确定性单元测试。
2. **07-A-02 — 配置自动执行入口**：编写/完善 TFS Sync Autopilot Prompt、Agent Instructions，接入 `rondo workitem sync`并解决 Runtime Offline；交付可执行的定时配置、运行与回读证据；Agent 不复制同步业务逻辑。
3. **07-A-03 — 真实入口 E2E 验收**：验证 ChangedDate 增量边界、重复同步、来源变化、部分失败恢复和 Wayfinder Run 实际启动；分别确认 Issue 同步成功与下游 Run 成功。

**交付物**：`reconcile-workitem.py`、轻量入口配置与必要 Skill、增量/幂等测试和正式定时 E2E 证据。

**验收**：真实 TFS Work Item 幂等同步，成功指派并触发 Wayfinder；未知结果先回读，不重复 Issue / Run；正式定时 Runtime 可运行。

**依赖/依据**：Step 02、04；可与 05/06 并行，Step 08 联调。

#### Step 07-B — PR Status Sync 与 Finalize 功能研发

**实施范围**：实现仓库级 PR Materialization、轻量 PR Status Sync Agent / Autopilot / Skill、确定性 `reconcile-pr-status.py` 与 `rondo workitem finalize`；完整处理 `active / abandoned / completed / UNKNOWN` 的状态回流、Human Decision、Post-Merge / Completion Gate、Archive、根仓 Commit、TFS Close 和 Delivery Done。外部 PR 审核和合并仍由 TFS 管理，不复制 Review 状态机。

**研发任务拆解（4 项）**：

1. **07-B-01 — PR 创建与幂等关联**：Delivery Lead 在必要 Task / Verification / PR Gate 满足后调用确定性 PR Materialization，每个业务仓库独立创建 PR，登记 `current_pr` 与关联引用，重复调用先回读，不能自动合并。
2. **07-B-02 — PR Status Sync 与终态聚合**：编写/配置轻量 Agent、Autopilot、Skill 和 `reconcile-pr-status.py`；按 PR / Repository / Project 身份回读事实，区分 `active / completed / abandoned / UNKNOWN`，维护 `current_pr / pr_history`、稳定 `pending_event / event_key`；多个 required PR 按 abandoned 优先、UNKNOWN 停止、全部 completed 才可 Finalize 的规则聚合。
3. **07-B-03 — 终态回流与确定性 Finalize**：`abandoned` 持久化终态事实，Issue 置 `blocked` 并指派 Delivery Squad，等待 Human Comment；Delivery Lead 经 `route-human-decision.py` 执行 `ANALYSIS / ENGINEERING / RECREATE_PR / CANCEL_DELIVERY` 决策（取消交付专项契约未就绪时安全停止）。全部 required current PR 为 `completed` 后由 PR Status Sync **当前 Run** 调用 `rondo workitem finalize`，依次检查 PR Transition Gate、Post-Merge Workspace Reconciliation、Delivery Completion Gate，再执行 Summary、OpenSpec Archive / 根仓 Commit、TFS Close、Delivery Done；失败恢复只补缺失副作用。
4. **07-B-04 — PR 终态回流 E2E**：覆盖 active 普通 Review 不触发、abandoned 四类 Human Decision（含原 Engineer / 原 Runtime 定向返工）、RECREATE_PR 的 Candidate / Evidence 重新校验、completed 多 PR 聚合与自动 Finalize、UNKNOWN 安全停止、重复事件去重、归档及 TFS 回写部分失败恢复。

**状态回流契约**（遵循 [02 §11–§12](02-multica-delivery-lifecycle-design.md)）：

| 外部 current PR 事实 | 处理规则 |
|---|---|
| `active` | NO-OP，继续等待。Reviewer Approval / Changes Requested 等普通意见不产生 Multica 返工指令。 |
| 任一 required `abandoned` | 记录外部事实和 pending，Issue `blocked` + Delivery Squad，安全停止。Human 明确 Reason / NEXT 后才由 Lead 路由；不可自动推断 REJECTED、取消或返工。 |
| 任一 `UNKNOWN`（且未命中更高优先级 abandoned） | 不覆盖可靠事实、不关闭交付；需要协调时交 Delivery Lead。 |
| 部分 `completed`、其余仍 `active` | 等待，不启动 Finalize。 |
| 全部 required current PR `completed` | 同一个 PR Status Sync Run 触发有界 Finalize；满足每一 Gate 及后置条件后才写 Delivery Done。 |

**Abandoned Human Decision 边界**：`ANALYSIS` 返回 Analyst 重审；`ENGINEERING` 按原 Task Set / Runtime Projection 定向返工并确保单次触发；`RECREATE_PR` 核验 PR Preparation、Candidate Commit Set、Evidence 和 Verify PASS 的有效性，语义修改交原 Engineer，新 PR 注册为 current，旧 abandoned PR 留在历史；`CANCEL_DELIVERY` 的自动取消后置条件尚未定义，首期只允许安全停止和人工处理。重复 Comment / Sync Event 不得重复派发。机器不根据 `abandoned` 推断审核原因。

**Completed / Finalize 边界**：仅 provider `status=completed` 可确认单个 PR 完成；`mergeStatus` / `mergeCommitId` 等仅为辅助信息。多个 required PR 必须全部 completed 才允许 Finalize；PR completed 不等于 Delivery Issue done。Archive、根仓 Commit 或 TFS Close 局部成功时，按当前外部/工程事实回读并只补缺失动作，不回滚已合并 PR 或重跑 Engineer。

**交付物**：PR Materialization、`reconcile-pr-status.py`、轻量 Agent/Autopilot/Skill、`route-human-decision.py`、`rondo workitem finalize`、终态回流与负向/恢复测试。

**验收**：`active` 不误派工；`abandoned` 阻塞后 Human Decision 可复现，返工/重建 PR 不越权；全部 required PR completed 后有界 Finalize 才能关闭；UNKNOWN / partial failure 不误归档或关闭，并可幂等恢复。

**依赖/依据**：Step 02、03、06；详细状态事实与人工路由遵循 02 §10–§12。

#### Step 08 — Wayfinder 入口准入研发

**实施范围**：独立 Wayfinder Agent + workitem-triage + codebase-explorer；五维 Evidence→eligible/needs_human/unsupported；/note 顶层/回复持久化和统一读取；eligible 单次 todo+Squad Assignment 自动唤醒 Lead；blocked/unsupported 由 Human 回复并修改状态为 todo，保持 Wayfinder Owner 重新准入；TFS 来源变更复核。

**研发任务拆解（7 项）**：

1. **08-01** 设计并编写 Wayfinder Agent Description / Instructions 与 workitem-triage Skill。交付：Wayfinder Agent 配置文档、workitem-triage SKILL.md、决策用例。
2. **08-02** 设计并编写 codebase-explorer Skill，支持仓库定位和可执行性证据探索。交付：codebase-explorer SKILL.md、仓库探索样例及测试。
3. **08-03** 实现三类 Triage Decision、Evidence 和 /note 写入/统一读取契约。交付：Triage Contract、Issue Comment /note 写读用例及异常测试。
4. **08-04** 实现 eligible→todo Squad Assignment 与 Lead 唯一启动验证。交付：eligible 分诊、Squad Assignment、唯一启动测试证据。
5. **08-05** 保留 needs_human / unsupported 恢复能力：Human 补充回复后修改状态为 `todo`，保持 Wayfinder Assignee；使用已有 `/note` 记录，不重复安排本次规范调整未触及的已验证场景。交付：既有恢复证据引用与必要差异核对。
6. **08-06** 实现 unsupported(closed) 显式重进与重新准入验证。交付：unsupported 重进步骤、状态与准入 E2E 报告。
7. **08-07** 验证 TFS Source Change、重复唤醒、三分支和正式 Workspace 端到端行为。交付：Wayfinder 全分支正式 E2E、Source Change 与去重报告。

**交付物**：Agent/Skill 配置、Triage Comment/Decision 和三分支 E2E。

**验收**：正式 Workspace 入口三分支及恢复可复现；unsupported(closed) 重进在实测 PASS 前不得宣称已可用；不替代 Analyst 的 Root Cause/Contract。

**依赖/依据**：Step 01、04、07-A；02 §4.1.1。

#### Step 09 — Corrective E2E 验收

**实施范围**：先用 Direct Assignment 跑 Analysis→Human→Engineer→PR→Finalize；再用真实 TFS Sync→Wayfinder 自动入口跑同一技术闭环。至少覆盖 两种来源管理类型下的 Corrective、Human 返工、来源实质变化、重复 Comment/Run、PR abandoned、部分 Archive 与 TFS Close 失败。

**交付物**：双入口 E2E 证据、恢复与故障注入记录、Corrective 验收报告。

**验收**：声明自动闭环 PASS 时必须真实 TFS 进入、三 Decision 覆盖、PR completed→Archive→TFS Close→Delivery Done；首例 Human 可批准 verify_agent.required=false，但保留 Task/Local/Code Review。

**依赖/依据**：Step 05、06、07-A、07-B、08；先技术后完整自动入口。

### P2 — Corrective 真实任务小范围试运行

#### Step 10 — 首轮小范围团队试运行

**实施范围**：建议从约 5–10 个范围可控、单仓 Backend 的真实 Corrective 开始，保留 Human Analysis 和 PR Review；区分 Direct 与 Auto TFS；采集 Issue/Run/Commit/PR/Gate 与干预/返工/成本。

**交付物**：试运行事项清单、操作反馈、缺陷 Backlog 与指标基线。

**验收**：真实任务持续完成、关键故障可恢复；不能以直接委派成功替代自动入口成功率。

**依赖/依据**：Step 09 完整相应路径验收。

### P3 — Intentional、独立 Verify 与多仓交付能力建设

#### Step 11 — Development — Intentional

**实施范围**：Intentional Contract 回归复用 spec-driven，需求分析/requirement-review/Intentional spec-preparation、Engineer Intentional Mode，覆盖 Specs 可选、Conditional Design、Acceptance/Verification Contract 及交付收口。

**研发任务拆解（4 项）**：

1. **11-01** 盘点 Step 03 的 intentional-change Schema / Templates 并验证 spec-driven 原生契约。交付：Intentional Contract 差距清单、Schema / Templates 原生回归记录。
2. **11-02** 扩展并测试 Intentional 需求分析、Spec Preparation 和必要专业 Review；复用已独立维护的 `requirement-analysis` 与 `spec-preparation`，只在确有独立复用收益时提取新的 Skill。交付：适用的方法或 Skill 变更、产物与审核测试。
3. **11-03** 开发 Engineer Intentional Mode，复用 Corrective 的执行与 Verification Methods。交付：Intentional Mode Skills / 配置、任务执行与校验用例。
4. **11-04** 验证 Intentional 从分析、Human Review 到编码、PR / Finalize 的完整 E2E。交付：Intentional 真实 Run、工程产物、PR 与归档验收记录。

**交付物**：Intentional 工作方法或按需提取的 Skills、相关 Tests、至少一个真实 Intentional E2E 案例。

**验收**：Human Review 后 Intentional 小需求从分析到 PR completed/Finalize 关闭；首轮不自动开放 超出自动处理范围的大型复杂需求。

**依赖/依据**：Step 03 Intentional、05、06、07-B；可与 10/12 研发并行。

#### Step 12 — 独立 Verify Agent 实施

**实施范围**：建立 Verify Agent、acceptance-verification、Verification Gate/Report、route-verify-result.py，按 Human 最终 verify_agent.required 决策启动；冻结 Candidate Commit Set，支持 Verify Agent Own 的 Verification Task、PASS/FAIL/UNKNOWN 与 Targeted Rework。

**研发任务拆解（6 项）**：

1. **12-01** 设计并编写 Independent Verify Agent Description / Instructions 与验收输入输出契约。交付：Verify Agent Description / Instructions、Input / Output Contract。
2. **12-02** 编写 acceptance-verification Skill，定义测试执行、证据核验与报告生成方法。交付：acceptance-verification SKILL.md、Method / Test 样例。
3. **12-03** 开发 Verification Gate / Report 和 route-verify-result.py。交付：Verification Gate / Report、route-verify-result.py 和自动化测试。
4. **12-04** 实现 Human required=true、Candidate Commit Set 冻结及 Verify-owned Tasks 执行。交付：required=true 与 Candidate / Verify-owned Tasks 集成证据。
5. **12-05** 验证 FAIL / UNKNOWN 定向返工及 Candidate / Contract 变更后旧 PASS 失效。交付：FAIL / UNKNOWN、Candidate 失效与定向返工负向测试。
6. **12-06** 完成 Verify Agent 独立验收与开发返工闭环 E2E。交付：Independent Verify E2E 测试报告与验收证据。

**交付物**：Verify Agent/Skill/Gate/Report、PASS/FAIL/UNKNOWN 回归。

**验收**：required=true 必须独立验收；Candidate/Contract 变化旧 PASS 失效；FAIL 可定向返工；Verify-owned Task 不产生等待死锁。

**依赖/依据**：Step 06 和审批契约；02 §9、05 §9、06。

#### Step 13 — 多仓 / 独立验收 E2E

**实施范围**：Backend + Frontend 跨仓、多 Task Set、每仓独立 PR；同仓唯一 Engineer，change-scoped 单写者 tasks.md，独立 Verify PASS/FAIL 与返工；按需 Sub-Issue Runtime Isolation。

**研发任务拆解（6 项）**：

1. **13-01** 盘点并编写 Frontend Engineer Agent Description / Instructions 与前端工程 Skills。交付：Frontend Engineer Agent / SKILL.md、前端构建 / 测试运行记录。
2. **13-02** 配置跨仓 Repository Context、Runtime 和 Task Set 到仓库/Engineer 的映射。交付：Repository / Runtime 映射与跨仓 Task Set 配置回读。
3. **13-03** 实现 Backend + Frontend 任务协作与每仓独立 PR 的交付联动。交付：跨仓任务样例、仓库级 PR 和关联追踪证据。
4. **13-04** 验证 shared tasks.md 单写、进度并发 Patch 和仓库 Owner 冲突处理。交付：Task Progress 并发冲突 / 回读报告、Owner 校验日志。
5. **13-05** 验证 Independent Verify PASS / FAIL 及跨仓定向返工。交付：跨仓 Verify 报告、FAIL 返工与复验记录。
6. **13-06** 验证所有必需 PR completed 后才执行 Archive 与最终关闭。交付：多 PR Completion Gate、Archive / Done 全流程 E2E 报告。

**交付物**：跨仓/Verify 全流程测试、并发与恢复验收记录。

**验收**：无进度丢写、跨仓 PR 聚合或重复派工；多个 required PR 全部完成后 Finalize；FAIL 正确回流。

**依赖/依据**：Step 11/12 与 Frontend 专业接入；02/04/05。

### P4 — 试运行问题整改、团队推广与持续优化

#### Step 14 — 首轮 Pilot 反馈整改

**实施范围**：对 Step 10 的真实问题分类，优先修错误 Change Kind 分类/准入、Context 缺口、Instructions 的 Goal / 职责不清、Skill 重复、无效 Run、Human/PR 交接、幂等与权限；补回归并更新 SOP，不扩张通用 Workflow Engine。

**交付物**：问题/修复 Backlog、PR、回归测试和使用规范。

**验收**：P0/P1 类实际问题已关闭并验证；有失败→修复→再验收的证据。

**依赖/依据**：Step 10；可与 11/12 并行。

#### Step 15 — 扩大团队试运行

**实施范围**：分批纳入更多成员、Backend/Frontend/Flink 工程环境、Intentional、独立 Verify、多仓与必要并行；按仓库/角色/运行环境逐步放行，不一次性覆盖所有 Task。

**研发任务拆解（4 项）**：

1. **15-01** 分批增加团队成员并完成各自 Runtime 与仓库权限核验。交付：团队接入名单、Runtime / Repository 权限校验结果。
2. **15-02** 盘点 Flink Engineer 现有 Agent / Skill，并按缺口编写适配及回归测试。交付：Flink Engineer 能力差距、Agent / Skill 增量或复用证据。
3. **15-03** 逐批开放已验收的 Intentional、Frontend / Flink、Verify 与多仓交付场景。交付：分批场景 Run / PR / Verify 记录与能力准入检查。
4. **15-04** 记录每批次验收、运行问题与闭环整改后再扩大范围。交付：各批次验收清单、问题台账与解决证据。

**交付物**：扩展范围及环境清单、各批次 E2E 与风险记录。

**验收**：只有相关能力已过验收且无高风险阻塞时才推广；不同成员使用同一稳定交接规则。

**依赖/依据**：Step 13/14。

#### Step 16 — 试运行数据回收、优化迭代

**实施范围**：统计 Intake Eligibility、E2E Completion、Lead Time、Agent Execution、Human Waiting、Manual Intervention、Analysis/Development Rework、Runtime Failure、Cost per Completed Work Item；按 TFS Type / Technical Change Kind 与 Auto TFS/Direct 分组。

**研发任务拆解（4 项）**：

1. **16-01** 定义准入、完成、返工、耗时、成本等研发交付指标的计算口径。交付：指标字典、数据字段映射与可追溯引用。
2. **16-02** 评估并实现首期低成本的数据采集方式，明确手动记录和必要 Script 的责任。交付：数据采集方案、字段来源与必要轻量 Script / 手工模板。
3. **16-03** 按 TFS Type、Change Kind 和 Auto TFS / Direct Assignment 区分采集、核对完成率及执行数据。交付：分类指标数据表、抽样核对与异常记录。
4. **16-04** 定期复盘指标、修订迭代 Backlog 并验证改进效果。交付：周期复盘报告、优化 Backlog 与效果验证证据。

**交付物**：指标定义、真实数据源、周期复盘与迭代 Backlog。

**验收**：所有指标有 Work Item/Issue/Run/PR/Gate 证据，基于前后对比调整流程；不把局部样本视为总体成功。

**依赖/依据**：Step 10/15；数据采集可从首轮 Pilot 即开始。

## 5. 并行研发与硬依赖

| 工作包主线 | 可以并行开发 | 集成前必须确认 |
|---|---|---|
| A — OpenSpec Foundation | 03 Schema/Templates/Resolver/Writer，不必等待 TFS/Wayfinder | Analysis-only 需可生成/读取 Corrective Change；首次真实 Task Patch 前 Task Writer 并发/冲突回归已过 |
| B-Core — Multica Runtime | 01/04 的正式 Workspace/Squad/根仓/原生消息 | Direct Assignment Analysis-only 需要 Status、Human 回流、共享根仓和副作用回读 |
| B-Intake — 自动 TFS 准入 | 02/07-A/08 可与 Analyst、Engineer 研发并行 | 自动 TFS 入口必须真实初始化、Wayfinder 三分支/恢复可用，不能借用 Direct Assignment PASS |
| C — 专业开发 | 05/06/11/12 的 Skill、Agent、Method 可按接口并行 | Human 批准基线之后才可真正开发；Verify Agent 仅对 Human required=true 启用 |
| D — PR/Finalize | 07-B 可独立于自动入口联调 | PR/Completion/Gate/Archive/TFS 外部事实一致，无 UNKNOWN 越权关单 |

**必须保持以下硬依赖：**

1. `Analysis Gate PASS → analysis_review → Human APPROVED → 批准根仓基线 Commit/Readback → Development`。
2. `Development Completion Check PASS → Task Progress Patch/Readback → Task Set READY`。
3. Human 批准 `verify_agent.required=true` 时，Verify-Agent-owned Tasks 和 Verification Gate 按契约在 PR Materialization 前完成；不得以 Change-level Verify Task 的 Pending 状态形成死锁。
4. `全部 required PR completed → Post-Merge / Completion Gate → Archive + 根仓 Commit → TFS Close → Delivery Issue Done`。
5. 若 Sync 来源在 Analysis 提交 / Human 批准基线消费前出现实质改变，必须先比较差异并经既有 Analysis / Review 处理；不新增 Gate，不要求所有 ChangedDate 变化强制重跑 Wayfinder。

### 5.1 分场景验证的正确顺序

- **Analysis-only Pilot**：A + B-Core 即可用明确直接委派验证 Analysis Gate、人审、基线 Commit；此结果不证明自动入口。
- **Direct Assignment 的单仓技术 E2E**：Step 05/06/07-B 可以在 B-Intake 未上线时先验证 Engineer→PR→Finalize 的正确性；验收记录必须注明“未覆盖 TFS/Wayfinder”。
- **Auto TFS 的 E2E**：Step 07-A/08 的真实同步、eligible/needs_human/unsupported 与恢复专项通过后，才能声明自动入口闭环已覆盖。
- **扩展场景**：Step 11/12 可与 Step 10 的试运行交叉开发；Step 13 需按真实多仓/Verify 集成验收；Step 14 可边收集 Pilot 问题边整改。

## 6. 第一批真实验收样本

首选一个仓库、范围可控、可重复验证的 TFS Bug（Corrective）。Human 最终决定 `verify_agent.required=false` 时可验证无独立 Verify 的最短完整链路；仍严格执行 Task-level Verification、必要 Change-level Verification、Local Validation、Code Review 与 PR 审核。

随后使用 TFS Requirement（Corrective） 验证 TFS Requirement 管理类型与 Corrective 技术语义分离；再用 Intentional 验证 Intentional 的 Specs/Conditional Design；必要时以 Backend+Frontend 跨仓案例和 `required=true` 验证独立验收。

**异常集成必须包含**：Human Reject/返工、重复 Comment/Run、Change 引用未回写、Task Progress 并发冲突、Evidence 失效、PR abandoned/状态 UNKNOWN、部分 Archive、TFS Close 失败、Wayfinder 的顶层/回复 `/note` 读取、unsupported 显式恢复。确定性可补写时只补缺失副作用，不能证明安全时停止并上报。

## 7. 团队试运行与数据回收

- 第一轮建议约 **5–10 个**低风险单仓 Corrective Work Item；这是建议起点，不是硬性验收配额。
- 完整记录 TFS Work Item、Delivery Issue、OpenSpec Change、Run、Commit、PR、Gate Evidence 的对应引用。自动入口和 Direct Assignment 分开统计。
- 关键指标：Intake Eligibility Rate、E2E Completion Rate、Lead Time、Skill Selection / Analysis Quality / Agent Execution Time、Human Waiting Time、Manual Intervention Rate、Analysis/Development Rework Rate、Runtime Failure Rate、Cost per Completed Work Item。
- 每周通过 Excel 维护 Owner、计划/实际日期、Priority、Status、验收状态、阻塞、证据。完成度按检查项统计；**只有独立验收状态为“通过”才计入里程碑完成**。
- Step 16 按 Corrective / Intentional 及 Auto TFS / Direct Assignment 分组复盘，避免样本混淆；没有可追溯事实的指标不能用于评估。

## 8. 不扩张范围与待处理专项

- 不建全局 Workflow Engine/Runner、第三个 Truth Store、全局 Method Registry；不复制 PR 平台完整 Review 状态机。
- 不为每个 OpenSpec Task 强制创建 Multica Sub-Issue；需要独立持久状态时再使用；跨仓 PR 仍然每仓一份。
- 不在首轮自动处理超出授权、证据与交付能力的大型复杂需求，也不自动执行尚未明确设计边界的新模块或缺少后置条件的 `CANCEL_DELIVERY`。
- Step 06 接入前澄清 Apply Context 与 Development Context 边界；Step 07-B 编码前明确 Archive/Finalize Integration Contract；Foundation 起持续加入 Validation 负向和部分成功恢复测试。
- 未经证据证明的旧结论不得当作当前 PASS。正式 Workspace、Run、Version、权限发生变化时，只复测受影响的原生机制而非全面重做 Spike。

### 8.1 Multica Change Kind 分类字段与上线前验收

**最终目标**：取消独立 Analysis Route 执行模型；保留 `analysis.change_kind` 作为 Multica Issue 的持久化专业分类事实（`corrective | intentional`），由 Analyst 判断、通过 `rondo analysis stage` 写入并回读。该字段用于交付追踪与统计，**不是** Workflow、Status、授权或 Schema 的替代品。

1. **Facts / Stage / Gate / Complete**：`facts.json.change_kind` 为必填，服务端写入 `analysis.change_kind`；读取当前 Change 的 `.openspec.yaml.schema`，核对二者一致。Gate PASS 需携带本次 Issue / Workspace、Change Kind / Schema 和当前 Change 工件摘要（仅排除 Gate Result 自身）；Complete 回读真实 Gate Result，核对全部必要 PASS 检查项及工件未变化，保留 Intentional 的专业 AI Review、必要 Gate / Human Review 约束。
2. **Finalize / Skill**：正常 Finalize 再次核对 `analysis.change_kind`、Schema 与完成条件；已 `done` 的幂等回放则先核对服务器端最小分类 / Gate 事实，再决定是否清理 `finalize.pending`，不依赖可能已卸载的归档根仓。同步 Analyst Instructions、`analysis-publish`、`delivery-gate` 及相关契约；不引入 `analysis-routing.yaml`、新状态或额外 Skill 链。
3. **统计与分组**：`tfs.type` 代表来源管理类型，`analysis.change_kind` 代表技术变更性质。使用已有数据库直接查询 Multica Issue 及其 Metadata，并与真实 Issue `done` 等有效终态关联，按两字段组合统计数量、交付耗时、返工率与自动完成率。数据表与字段路径以现有数据库实际结构为准；**不评估 Multica 原生 Metadata 聚合查询能力**，不为此建立新的统计服务、状态或 Truth Store。
4. **验收**：在独立 Workspace 验证 Corrective（Bug / Requirement）、Intentional、分类字段 Stage 写入和回读、Schema 冲突 FAIL、Review / Gate、返工、Finalize 与统计提取；CI 通过不替代真实 Workspace 验证。

项目尚未上线，**不执行历史 Route 数据迁移或兼容补写**。新代码及相关 Agent / Skill PR 验证并合并后统一发布；完成前保持当前 Runtime，避免不同版本的 Handoff Facts 互不兼容。

## 9. 本版变更摘要

v1.3.7（2026-11-06）：保留服务端 `analysis.change_kind` 作为专业分类及统计维度；Agent 负责判断、Stage 落账、Gate / Finalize 校验 Schema 一致，不恢复独立 Route 执行模型。项目未上线，无历史数据迁移要求。

v1.3.6（2026-11-06）：取消独立 Analysis Route 目标模型；按 TFS Type / Technical Change Kind / OpenSpec Schema 明确归属，更新 Workitem Analyst 专业能力组合与后续 CLI、Gate、Finalize、存量 Issue 迁移的验收边界。本次设计 PR 不修改运行代码、Agent 配置或 Skill，也不执行发布。

v1.3.5：Step 03 OpenSpec Foundation 子任务从 6 项归并为 4 项；将机制盘点并入 Corrective / Intentional 资产研发，将 Resolver 与 Writer 作为同一工程工具任务管理但保持脚本独立，Foundation 集成验证与完整交付 E2E 分离；保留工作包实施范围、交付物及验收，Tracker 总任务数 80→78。

v1.3.4：简化 Step 07-A / 07-B 的细分任务（6→3、6→4），以确定性 Script 为实现中心；补全 PR active / abandoned / completed / UNKNOWN 的状态回流、Human Decision、跨仓 PR 聚合及 Finalize 恢复契约；原工作包范围与 Gate 保留；在线 Tracker 任务总数更新为 80。

v1.3.3：保留 17 个工作包原有范围/交付物/验收条件，补齐工作包 06、07-A、07-B、08、11、12、13、15、16 的 Agent / Skill / Script 研发与验证任务；任务总数 70→85，与在线 Google Sheets 同步。

v1.3.2：细化工作包 03 / 04 / 05 的研发实施任务，明确 Schema / Template / Skill / Agent 需经历设计、编写、集成及验证，任务总数 64→70；原有工作包实施范围、交付物与验收条件保留，同步在线 Google Sheets。

v1.3.1：统一 P0–P4 阶段名称，明确各阶段交付能力与验收目标，对齐在线 Google Sheets。

v1.3：旧 12 Step 重排为 **16 Step / 17 个工作包**；新增 TFS-MCP 接口契约确认，将 TFS Sync（07-A）与 PR Status Sync/Finalize（07-B）分开管理；以 Corrective E2E 为第一条真实交付闭环，将小范围团队试运行提前到 Intentional、Verify 与多仓扩展之前；加入 M1–M5 阶段出口与 Excel 交付检查项/指标跟踪。保留原有 R01–R05、Wayfinder Spike 证据、Human Gate、Source Change 复核及 Safe Recovery 边界。

**一句话推进路线**：已有机制补证据 + OpenSpec Corrective Foundation → Analyst/Engineer/PR 最短闭环 → TFS Sync + Wayfinder 真正自动入口 → 首轮团队 Pilot → Intentional + Independent Verify + 多仓 → 整改推广与数据迭代。