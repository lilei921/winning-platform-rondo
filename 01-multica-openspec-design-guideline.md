# Multica + OpenSpec Unified Design Guideline（统一设计规范）

> Version: 1.16.13  
> Scope: Multica Runtime（运行时）与 OpenSpec Engineering Contract（工程契约）的组合架构；Agent / Squad / Instructions / Skill / Runtime Context、OpenSpec Change / Schema / Artifact / Template / Instruction、跨系统术语与职责边界、公共原生机制及来源引用规范  
> Date: 2026-11-06  
> Author: winning/li_lei

本规范是当前研发交付体系的统一上位设计规范，用于指导 Multica Runtime 与 OpenSpec Engineering Contract 的组合设计、配置设计与评审。具体业务流程、Schema / Template 实现、触发机制、调度方式及运行时适配由对应下游方案确定；文中的 Gate（门禁） / Route（路由）等设计约定不表示相关机制已经实现。

## 目录

- [1. 总则（General）](#1-总则general)
- [2. Multica Native Mechanisms（Multica 原生机制）](#2-multica-native-mechanismsmultica-原生机制)
- [3. OpenSpec Engineering Contract（工程契约与原生机制）](#openspec-core-mechanism)
- [4. Multica Runtime Context & Squad（运行上下文与协作）](#mechanism-shared-context)
- [5. Agent Description（智能体描述规范）](#5-agent-description智能体描述规范)
- [6. Multica Agent Instructions（智能体指令规范）](#6-multica-agent-instructions智能体指令规范)
- [7. Project Skill / SKILL.md（技能设计规范）](#7-project-skill--skillmd技能设计规范)
- [8. Multica Autopilot Prompt（自动驾驶提示词规范）](#8-multica-autopilot-prompt自动驾驶提示词规范)
- [9. Cross-System Rule Ownership & Decision Boundaries（跨系统规则与决策边界）](#9-cross-system-rule-ownership--decision-boundaries跨系统规则与决策边界)
- [10. Anti-Patterns（常见反模式）](#10-anti-patterns常见反模式)
- [11. Unified Review Checklist（统一评审清单）](#11-unified-review-checklist统一评审清单)
- [12. Final Design Principles（最终设计原则）](#12-final-design-principles最终设计原则)
- [附录 A. 官方机制与来源引用规范](#official-reference-policy)
- [附录 B. 官方来源索引](#official-source-index)
- [附录 C. 版本记录](#附录-c-版本记录)

---

## 1. 总则（General）

### 1.1 目的（Purpose）

本规范用于统一 Multica + OpenSpec 组合架构中以下资产的职责和设计方式：

**Multica Runtime：**

- Agent Description（智能体描述）
- Squad / Squad Instructions（小队 / 小队指令）
- Agent Instructions（智能体指令）
- Autopilot Prompt（自动驾驶提示词）
- Skill（技能）
- Workspace / Project / Issue Context（工作区 / 项目 / 事项上下文）
- Issue / Run / Assignment / Comment 等 Runtime Object（运行对象）
- Deterministic Gate / Route（确定性门禁 / 路由）

**OpenSpec Engineering Contract：**

- OpenSpec Change（变更）
- OpenSpec Schema（模式）
- OpenSpec Artifact / Artifact Graph（工件 / 工件依赖图）
- OpenSpec Artifact Template（工件模板）
- OpenSpec Artifact Instruction（工件指令）
- Artifact Dependency / Apply Readiness（工件依赖 / 应用就绪）

核心目标是避免：

- Agent Prompt 过长；
- Prompt、Skill、Workflow 重复定义同一规则；
- LLM 承担本可由确定性逻辑完成的决策；
- 不同层级配置发生职责重叠；
- Workflow 变化后 Prompt 与实际流程产生漂移；
- Multica 与 OpenSpec 中相近术语因为缺少 Owner / Namespace 而被错误理解为同一对象。

核心原则：

> **Multica 负责“谁在什么时候以什么运行状态完成工作”；
> OpenSpec 负责“当前工程变更需要哪些可持久化工件与工程契约”。
> Multica Agent Instructions 定义智能体长期职责、工作方式、边界与交付契约；
> Project Skill 提供可按需使用的可复用工作方法、步骤与资料；
> OpenSpec Artifact Instruction 定义单个 Artifact 的生成语义；
> OpenSpec Artifact Template 定义其输出结构。
> 四者不得混为同一类 Prompt。**

Multica Runtime 内部继续保持：

- Agent Description 说明“这个 Agent 是干什么的”；
- Squad 定义协作单元；
- Squad Instructions 定义 Leader 的协作与交接；
- Autopilot Prompt 定义 Run Intent；
- Agent Instructions 定义 Role / Responsibility / Working Style / Decision Boundary / Delivery；
- Skill 定义可复用步骤、工具与参考资料；
- Issue 定义本次具体工作；
- Deterministic Gate / Route 处理明确硬条件与确定性转换。


<a id="section-1-2"></a>

### 1.2 统一架构与系统边界（Unified Architecture & System Boundaries）

<a id="runtime-artifact-principle"></a>

#### Runtime-Centric Delivery + Artifact-Centric Engineering（组合架构原则）

本项目的跨系统信息架构遵循：

> **充分利用 Multica 的 runtime-centric 协作能力 + OpenSpec 的 artifact-centric 技术契约。**

其权威边界为：

> **OpenSpec = Engineering Truth（工程事实）。**

> **Multica = Delivery Truth（交付事实）。**

具体约束：

- **Engineering Truth**：Requirement / Scenario、Corrective Expected Behavior / Root Cause / Fix / Regression Scope、设计、Implementation / Verification Tasks、Evidence，以及 Engineer / Verification Executor 后续需要长期消费的技术事实，优先由 OpenSpec Change 或明确的 Supporting Artifact 持有；
- **Delivery Truth**：Status、Assignment、Review、Approval、Gate、`verify_agent.required` / Independent Verification（独立验证） Result、Run、Sub-Issue 以及协作与交付事实，优先使用 Multica 原生 Issue / metadata / custom property / comment / status / assignment / run result 承载；
- **Reference, not Replication（引用而非复制）**：两个事实域通过稳定引用连接，不为了交接、展示或方便读取而复制对方的正文事实；
- **No Third Truth Store**：不得仅为跨阶段交接新增拥有独立 schema、lifecycle、version、status 或 reconciliation 的第三套 Contract Store / Runtime Object / Workflow State；
- **One Rule, One Owner（单一规则、单一归属）**：新增事实前先判断它属于 Engineering Truth 还是 Delivery Truth，再放入对应权威 Owner；如果只是摘要、交接或展示，则只保存引用或 View。

该原则是后续设计 Agent、Squad、Skill、Gate、Artifact、Metadata 和跨 Run Handoff 时的**第一归属判断规则**，与 Native First、Deterministic First / Semantic Fallback、One Rule / One Owner 同级使用。具体 Method / Artifact / Runtime Fact / View 分类见 [§1.6](#method-artifact-boundary)。

---


### 1.3 全局设计原则（Global Design Principles）

以下原则适用于 Multica 配置资产、OpenSpec Engineering Contract 资产及相关设计文档。具体资产不重复抄写这些原则。

#### Native First（原生优先）

优先使用 Multica 原生 Squad、Assignment、`@mention`、Comment、Parent / Stage 与 Run 组织协作及结果回流。简单稳定的分工使用 Leader 协作规则；仅为必要的业务校验、批量处理、副作用幂等或恢复增加 Script / Gate，不重复建设 Runtime 或状态机。

#### Specialist Focus（专业聚焦）

Delivery Squad 成员必须优先承担自身专业职责：Workitem Analyst 负责需求 / 问题分析与 OpenSpec Engineering Contract；Engineer 负责代码实现、开发侧验证和工程证据；Verify Agent 负责按需独立验收；Delivery Lead 负责协作、派发决策、Human 意图理解与语义异常处理。

TFS 来源拉取、TFS 工作项 / 子任务管理、状态和工时回写、PR 状态巡检等跨系统支撑及确定性管理操作，原则上由 Squad 外的 Autopilot、平台原生能力或确定性 Script / CLI 承担；不得仅因某专业成员需要消费结果，就将管理流程、外部状态维护与故障恢复写成其专业执行契约。不得为转移机械操作额外创建无必要的 Agent / Run。

专业成员提供或消费这些操作所必需的真实技术事实与引用，不默认负责填造外部管理字段。工程任务合理拆分与 TFS 预估 / 工时管理应分别确定责任归属。必要的需求调查、OpenSpec 编写、Local Validation、Code Review、Commit、PR 技术准备、Evidence 和交接仍属于专业工作；Lead 按授权触发确定性入口并读取回执，不等于必须亲自处理其内部管理步骤。

#### Goal Ownership（目标归属）

不同层级的目标由不同 Owner 承担，不将任务目标、专业目标和能力目标混为一体：

| 目标层级 | 归属 / Owner | 示例 |
|---|---|---|
| Project Goal（项目目标） | Project / Human | 提高研发交付自动化率 |
| Task Goal（任务目标） | Multica Issue | 修复某个业务缺陷 |
| Professional Goal（专业目标） | Agent Instructions | 完成准确、可实施、可验证的需求分析 |
| Capability Outcome（可选的局部能力结果） | Skill（适用时） | `bug-analysis` 形成根因及验证建议；参考型 Skill 不必单列 Goal |

这里的 Owner 表示**目标的职责与内容归属**，不表示 Multica 必须为每一层创建独立平台字段或对象。Multica 没有单独的原生 Professional Goal 配置项；Agent 的专业目标写入每次 Run 都提供的 Agent Instructions，而不是仅写在用于展示、不进入执行 Prompt 的 Agent Description。

**职责与决策规则：**

1. **Agent 对最终专业结果负责。** Professional Goal 是职责范围内长期稳定的目标，不随本次 Issue 变化。无论使用多少 Skill、采用何种适用方法，Agent 都对其专业成果负责，不把整体责任转移给某个 Skill。
2. **Skill 提供可复用的工作指导。** Skill 按场景组织适用条件、步骤、参考资料、模板与工具；专业结果型 Skill 可以明确 Capability Outcome，参考/规范型 Skill 不必另建局部 Goal、Artifact 或生命周期。例如 `bug-analysis` 提供基于证据的根因诊断方法，但不接管整个 Workitem Analysis；同一 Skill 可跨 Agent 复用，也可由一个 Agent 跨任务复用。
3. **Agent 保留专业自主决策空间。** Agent 结合当前 Task Goal、证据充分性、任务复杂度及授权边界，决定是否使用 Skill、使用哪些 Skill、采用哪些 Method 与执行深度；不得仅因未执行推荐步骤就认定失败。批准、必要质量要求、授权及不可交换的确定性副作用顺序仍是 Hard Constraint。

**与工程事实的关系：** Multica Issue 持有本次任务目标与交付上下文；OpenSpec Proposal / Specs 等现有 Artifact 持有本次变更的工程目标、行为与验收契约。Agent 的 Professional Goal 不能替代 Issue Task Goal 或 OpenSpec Change Goal，Skill 不因局部方法结果另建平行工程事实、同名文档或独立状态。Method 是可选的工程技巧组织方式，Tool / Script 与 Runtime / Gate 执行或验证其明确负责的机制。

**Skill 提取原则：** 以可辨识适用场景、跨任务/角色复用或独立维护收益为依据；不要求已有多个 Agent 使用，也不要求每个 Skill 产生独立 Artifact。**既不因存在一个流程步骤就新建 Skill，也不因由同一个 Agent 使用就合并不同能力。** 具体编写规范见 [§6 Agent Instructions](#section-6) 与 [§7 Skill](#mechanism-skills)。

#### Native-aligned Agent / Skill Design（原生语义对齐与按需组合）

- **Agent Instructions = Persistent Role & Working Contract（长期角色与工作契约）**：每次执行都会提供，定义长期职责、专业目标、工作方式、权限边界与交付要求。可包含简短、必要的启动检查和决策原则，不复制完整 Procedure。
- **Skill = Reusable Work Method Package（可复用工作方法包）**：围绕一类工作或场景组织步骤、工具、参考资料与模板；可绑定多个 Agent 并分别启停。Agent 根据当前任务和 Skill Description 判断是否加载，不要求独立 Agent 身份、必填 Capability Goal、专属 Artifact 或新的 Run。
- **Method = Optional Engineering Technique（可选工程技巧）**：是 Skill 内部或可引用的组织方式，不是 Multica 原生独立对象；确有独立复用与维护价值时才提升为 Skill。
- **Right-sized Composition（按需组合）**：Agent 对最终专业结果负责，在授权和质量边界内按任务选择 Skill、Method 与执行深度；不将推荐方法默认变为固定链，也不因 Skill 只绑定一个 Agent 就判定不合格。
- **Binding Truth（绑定事实）**：区分 Multica Workspace Skill 与代码仓内 Tool-native Skill；文件存在不代表已注册、绑定或启用。Skill 允许明确依赖业务系统及工具，但不复制 Agent 身份或当前 Run 的偶然环境路径。

该原则不改变 OpenSpec Artifact Contract、Human Approval、Gate、必要验证及 Script/CLI 的权威边界。官方依据见 [§2](#section-2) 与 [§7.1](#mechanism-skills)。

#### Outcome First, Bounded Autonomy（结果优先、边界内自主）

Agent 以可验证的专业结果为目标，在当前授权范围内自主选择调查路径、技术方案、工具、反馈信号及内部执行顺序。**约束应定义必须满足的结果与不得越过的边界，而不是默认替 Agent 固定每一步专业思考。** 这一原则不改变 Human Approval、Quality Gate、授权范围或跨系统副作用的要求。

新增或评审约束时，先区分：

- **Hard Constraint（硬约束）**：授权、批准范围、安全、必要质量检查、外部状态写入、幂等及安全停止；必须执行，不得由 Agent 覆盖。
- **Outcome Contract（结果契约）**：根因与影响分析可信、实现符合已批准行为、必要验证真实有效、Evidence 可追溯；规定完成标准，允许 Agent 自主选择达成方式。
- **Recommended Method（推荐方法）**：TDD、CodeGraph、调查顺序、局部设计技巧、非必要的文档细化等；按任务适用性选择，不因未采用推荐方法而单独判 FAIL。

只有存在真实依赖、必要副作用顺序、权限或可证实的质量风险时，才把方法步骤升级为硬约束。新增 Hard Constraint 须说明防止的具体风险、唯一规则 Owner 和已有机制为何不足；字段存在、固定模板或单一路径不是专业质量的替代证据。Script / Gate 不承担 Root Cause、Solution 和专业技术路径的语义决策；Agent 可以依据新证据修正诊断和局部实现判断，但不得擅自修改已批准 Engineering Contract。新事实若实质推翻 Fix Strategy、Scope 或 Verification Contract，须停止受影响的实施并回到现有审核路径；不得以自主权绕过已批准边界或明确 Gate FAIL。

#### KISS & YAGNI（保持简单，避免过早设计）

优先采用满足当前真实需求的最简单可行设计。不为假设性需求或未来扩展提前增加不必要的功能、抽象、对象、状态、流程和脚本。新增复杂度应有明确的当前需求、工程证据或可靠性依据。

#### Greenfield First（目标态优先）

只描述当前目标状态。除非当前系统明确要求兼容，否则不维护历史方案、旧术语、迁移路径、版本差异或兼容分支。

#### Minimal Sufficient（最小充分）

只保留影响职责、决策、执行、验证、输出或停止条件的信息。删除后不影响正确执行的内容不进入配置资产。

#### Contract First（契约优先）

直接定义职责、输入、规则、流程、输出和停止条件。默认不写背景叙述、设计过程、方案比较、设计理由或重复说明。

统一表达方式：

```text
必须……
不得……
仅当……才……
如果……则……
输入……
输出……
失败时……
```

规则优先于提醒，契约优先于解释。


<a id="canonical-terminology"></a>

### 1.4 Canonical Terminology（统一术语）

本规范同时作为当前 Multica + OpenSpec 组合架构的 **Canonical Terminology（统一术语）** 权威来源。

核心规则：

> **一个实体只维护一个正式名称。Name、Object Type、Role / Relationship、Display Name 必须区分，不得互相替代。**

例如：

```text
Name       = Delivery Lead
Object Type = Agent
Squad Role = Leader
Squad      = Delivery Squad
```

`Squad Leader` 描述的是关系，不是 `Delivery Lead` 的第二个正式名称。

#### 1.4.1 Squad / Agent Canonical Names（小队 / 智能体统一名称）

| Concept | Canonical Name | Object Type | 允许的关系描述 | 禁止作为同一实体的第二名称 |
|---|---|---|---|---|
| 研发交付协作单元 | `Delivery Squad` | Squad | Squad | Delivery Team / Delivery Group |
| Delivery Squad Leader | `Delivery Lead` | Agent | Leader / Squad Leader | Delivery Lead Agent / Lead |
| 入口准入探索 | `Wayfinder Agent` | Agent | Squad 外 Intake Triage（准入评估） | Wayfinder / WayTriager |
| 分析成员 | `Workitem Analyst` | Agent | Member | Analyst / Workitem Analyst Agent |
| 新 Requirement 研发成员 | `Engineer` | Agent | Member | Requirement Engineer Agent |
| 后端研发成员 | `Backend Engineer` | Agent | Member / Engineer | Backend Agent |
| 前端研发成员 | `Frontend Engineer` | Agent | Member / Engineer | Frontend Agent |
| Flink 研发成员 | `Flink Engineer` | Agent | Member / Engineer | Flink Agent |
| 独立验证成员 | `Verify Agent` | Agent | Member / Independent Verification Executor | Verify / Verifier / Verification Agent |
| TFS 同步 | `TFS Sync Agent` | Agent | Squad 外 Agent | Sync Agent |
| PR 状态同步 | `PR Status Sync Agent` | Agent | Squad 外 Autopilot Thin Adapter（薄适配器） | PR Sync Agent / PR Synchronization Agent |

其中 `Leader`、`Member`、`Squad Leader`、`Engineer`、`Specialist Agent` 只能用于描述类型、关系或角色类别；当指向具体 Multica 配置对象时，必须使用对应 Canonical Name。

`TFS Sync Agent` 与 `PR Status Sync Agent` 都在 Delivery Squad 外通过 Multica Autopilot 运行；分别绑定 `tfs-sync` 与 `pr-status-sync` Skill。后者负责已登记 PR 的状态核对与有界 Finalize，并在满足条件的 Requirement Closeout 中规划 TFS 子任务及估时；不负责创建 / 合并 PR 或解释 Review 意见。

`Wayfinder Agent` 独立于 Delivery Squad，是自动 TFS 入口的默认 Intake Triage：按需使用 `codebase-explorer` 调查准入所需工程证据，由 Wayfinder Instructions 维护准入判断；`accepted` 后按 TFS 来源类型交给 `Bug Fix Agent` 或 `Delivery Squad`，三种 Decision 的确定性执行通过 `rondo delivery admission` 完成。明确直接委派的 Analysis 可以不经过 Wayfinder；Wayfinder Decision 不作为所有 Analysis 的强制 Gate。它不替代 `Workitem Analyst` 的 Change Kind / Analysis Route、Root Cause、需求方案和 OpenSpec Preparation。`codebase-explorer` 参考原有 `context-analysis` 的定位方法，但独立绑定、独立演进；两者仅通过 Evidence References 交接，不共享 Skill 及完成标准。准入、交接和异常由 [Delivery 主方案 §4.1.1](02-multica-delivery-lifecycle-design.md#delivery-intake) 维护，Evidence 增量复用由 [03 §6](03-workitem-analysis-design.md#analysis-section-06) 维护。

PR 生命周期与异常处理由 [Delivery 主方案 §11](02-multica-delivery-lifecycle-design.md#pr-status-sync) 维护。

<a id="delivery-object-terminology"></a>

#### 1.4.2 Issue & Engineering Object Names（事项与工程对象统一名称）

| Concept | Canonical Name | 含义 |
|---|---|---|
| TFS 来源对象 | `TFS Work Item` | 外部工作项 |
| 当前工作对象 | `Issue` | Multica 原生事项；TFS Work Item 是其可选来源，不构成特殊 Issue 类型 |
| 工程变更契约 | `OpenSpec Change` | 当前变更的 Engineering Truth 容器 |
| 工程任务 | `OpenSpec Task` | `tasks.md` 中的 Implementation Task 或按需 Verification Task |
| 实现任务 | `Implementation Task` | 产生代码、配置或其他工程修改，并包含与该任务对应的 Task-level Verification |
| 变更级验证任务 | `Verification Task` | 仅在完整行为必须跨 Task / Module / Repository / System / User Journey 组合后验证时创建；Regression / Integration / E2E 是可选验证方法，不是独立 Stage |
| 独立验证活动 | `Independent Verification` | `verify_agent.required=true` 时由 Verify Agent 对固定候选版本执行的独立行为验收；属于 Delivery Activity，不是新的 OpenSpec Artifact 或 Multica Stage |
| 旧路线分派范围 | `Task Set` / `task_refs` | 旧 Backend / Frontend Engineer 任务级执行范围；不适用于独立 `Engineer` 的 Change 级研发路线 |
| 仓库级修改对象 | `Repository Change` | 某个 Repository 的代码修改与交付范围 |
| 仓库级代码交付对象 | `PR` | 一个 Repository 的 Pull Request |

正式关系：

```text
Issue（可关联 TFS Work Item）
    ↓
OpenSpec Change
    ↓
tasks.md / OpenSpec Tasks
    ↓
旧路线：@Backend Engineer / @Frontend Engineer + task_refs
新 Requirement 路线：@Engineer(change_ref)
    ↓
Repository Change
    ↓
每个发生代码变更的 Repository Change 对应独立 PR
```

OpenSpec Tasks 表达工程工作分解；旧 Backend / Frontend Engineer 路线通过 `@mention` 和 `task_refs` 派发，新 Requirement 路线使用 `@Engineer(change_ref)` 承担整个 Change。两条路线不在同一 Issue 同时派发；仓库数量和 OpenSpec Task 数量不决定 TFS 子任务数量。

#### 1.4.3 OpenSpec Change（变更）、Technical Change Kind（技术变更类型）与 Schema（模式）

`OpenSpec Change` 是变更及其 Artifact Contract，不是 Multica Issue、Run 或审批状态。OpenSpec Tasks 表达工程工作；旧 Agent 通过 `task_refs` 指定 Run 工作范围，新 `Engineer` 使用获批准的完整 Change。旧路线的执行契约由[主方案 §5.3](02-multica-delivery-lifecycle-design.md#section-5-3)、[§7](02-multica-delivery-lifecycle-design.md#development-materialization)–[§8](02-multica-delivery-lifecycle-design.md#development-execution) 维护。

必须区分三个事实维度：

```text
TFS Type                = 来源管理事实（Bug / Requirement），不可由 Agent 改写
Technical Change Kind   = corrective | intentional（Workitem Analyst 根据证据判断，记录在 Multica Issue analysis.change_kind）
OpenSpec Schema         = 当前 Change 的 Artifact Contract（首次准备时确定并持久化）
```

**不再设置独立的 Analysis / Delivery Route 执行模型**，不创建 `analysis-routing.yaml` 或独立的 `analysis.route` 持久化字段。`analysis.change_kind` 是 Multica Issue Metadata 中唯一的技术变更性质分类结果，用于跨 Run 的交付记录与统计，不是第二次决策或 Skill / Workflow 路由。专业能力由 Workitem Analyst 根据实际问题按需组合；自动处理范围取决于当前授权、风险、证据与可交付能力，不能仅凭 Change Kind 默认放行。Schema 决定 Artifact 集合、依赖、生成指令与 Apply 前置，不决定 Agent / Human Approval / Verify required / Status / PR 生命周期。

#### 1.4.4 Canonical OpenSpec Schema IDs（统一 OpenSpec Schema 标识）

当前项目 Schema ID 统一为：

| Technical Change Kind（技术变更类型） | Canonical Schema ID |
|---|---|
| `corrective` | `corrective-change` |
| `intentional` | `intentional-change` |

Schema ID 使用项目规范的 kebab-case `<technical-change-kind>-change` 命名；它表达 **Technical Change Contract**，不编码 TFS 类型、紧急程度、复杂度或专业执行方法。TFS `Bug` 与 `Requirement` 均可能需要恢复既定行为；`Requirement` 也可能要求新增能力或主动改变产品行为。**是否自动推进必须独立判断，不能把 `intentional-change` 等同于自动可交付。**

Change 首次准备时选择并持久化 Schema，后续 Workitem Analyst、Engineer、Finalize 从 `.openspec.yaml` / 原生事实读取，不在每个 Run 重新推断。

当前自动交付仅接受 `corrective-change` 与 `intentional-change`。其他 Schema（如 `sdd`）不作为自动交付的合法输入，须停止并澄清；项目尚未上线，不建立历史 Change 兼容通路。

当前 OpenSpec 使用 **统一 Change Model + 分型项目 Schema**。Schema 专业产物定义位于 [03 Analysis 方案 §9 OpenSpec Preparation](03-workitem-analysis-design.md#openspec-change-contract)，本手册只维护 Canonical ID、职责边界和跨文档命名规则。

<a id="openspec-artifact-terminology"></a>

#### 1.4.5 OpenSpec Artifact / Template / Instruction Canonical Terms（统一术语）

以下术语用于所有主方案、阶段方案、Skill、Script 与 OpenSpec 实施资产：

| Concept | Canonical Meaning | 本项目边界 |
|---|---|---|
| `OpenSpec Artifact` | 一个 Change 中由 Schema 定义并持久化的工程工件，例如 Proposal、Specs、Design、Tasks | 属于 Engineering Truth；不是 Multica Issue / Run / Stage |
| `Artifact Graph` | Artifact 之间由依赖关系形成的有向图 | 表达工程工件构建关系，不表达 Delivery Workflow |
| `Artifact Template` | Schema 为某个 Artifact 引用的输出结构模板 | 约束 Artifact 的结构 / 形态；Template 本身不是独立 Artifact 或 Truth Source |
| `Artifact Instruction` | Schema 为某个 Artifact 定义的生成语义与内容规则 | 说明“该 Artifact 应如何生成、包含什么、避免什么” |
| `generates` | Artifact 的目标输出文件或 glob | 用于识别该 Artifact 的输出位置与存在性 |
| `artifact.requires` | 当前 Artifact 的前置 Artifact 依赖 | 控制 Artifact 构建可用性；不等于 Human Gate |
| `apply.requires` | OpenSpec Apply 的原生前置 Artifact | 控制 OpenSpec Apply readiness；不等于项目 Development Ready |
| `apply.tracks` | Apply 阶段跟踪任务进度的 Artifact | 当前项目用于 `tasks.md` checkbox progress，不表示 Multica Runtime Status，也不表示本项目采用 `/opsx:apply` 执行开发 |

`Template` 与 `Instruction` 必须区分：Template 主要表达输出结构，Instruction 主要表达生成语义；二者由 Schema 关联到具体 Artifact。项目优先使用 OpenSpec 原生 Markdown / checkbox；任务的可读编号与引用、必要校验由 [05-openspec-schema-implementation-design.md](05-openspec-schema-implementation-design.md) 维护，不引入强制 `T-xxx` / `Verify:` Grammar。


<a id="section-1-4-6"></a>

#### 1.4.6 Cross-System Namespace Rule（跨系统命名空间规则）

Multica 与 OpenSpec 共同参与同一 Delivery，但两者拥有不同的 Runtime / Engineering Contract 对象。跨系统设计文档、接口说明和评审结论中，只要术语可能产生歧义，就必须使用 **Owner Prefix（归属前缀）**；不得用裸名称暗示两个组件拥有同一个对象。

| 易歧义短名 | Canonical Term | Owner / Meaning |
|---|---|---|
| Instructions | `Multica Agent Instructions` | Multica Agent 的长期 Role Contract |
| Instructions | `Multica Squad Instructions` | Multica Leader 的 Collaboration Contract |
| Instruction | `OpenSpec Artifact Instruction` | OpenSpec Schema 中某个 Artifact 的生成语义 |
| Project Context | `Multica Project Context` | Multica Project 级长期运行上下文 |
| Context / Rules | `OpenSpec Project Context / Rules` | OpenSpec Artifact generation 使用的项目级工程上下文与规则 |
| Status | `Multica Issue Status` | Delivery Runtime State |
| State / Status | `OpenSpec Artifact State` | 当前 Artifact 的构建 / readiness 状态 |
| Task | `OpenSpec Task` | `tasks.md` 中的 Engineering Task |
| Validation | `OpenSpec Validation` | OpenSpec Artifact / Change Contract 校验 |
| Gate / Check | `Analysis Gate` / `Development Completion Check` 等项目 Gate | Delivery / Runtime 准入判断，不属于 OpenSpec Artifact State |

使用规则：

1. **跨系统章节必须带前缀。** 同一段同时讨论 Multica 与 OpenSpec 时，优先使用完整 Canonical Term；
2. **单一系统章节可在 Scope 明确后使用短名。** 例如 [§6](#section-6) 已明确讨论 Multica Agent Instructions 时可在局部使用 `Agent Instructions`；[§3](#openspec-core-mechanism) 已明确讨论 OpenSpec 时可在局部写 `Artifact Instruction`；
3. `instruction`、`template`、`requires`、`generates` 等 Schema / CLI 字段名保持原始标识符，不因文档前缀规则改写；
4. Owner Prefix 是文档语义限定，不创建新的平台对象名称，也不改变 Multica / OpenSpec 官方字段；
5. 下游文档引用跨系统概念时遵循本节，不建立自己的第二套别名表。

<a id="status-terminology"></a>

#### 1.4.7 Status Key（状态键）与 Display Name（显示名称）

配置、Metadata、Script、Gate、Route 中必须使用 **Status Key**；UI 和面向人的自然语言说明可以使用 **Display Name**。

当前自定义 Issue Status 的正式定义为：

| Status Key | Display Name | Category | 业务含义 |
|---|---|---|---|
| `analysis_review` | `Analysis Review` | `started` | 分析完成，等待 Human Analysis Review |
| `unsupported` | `Unsupported` | `closed` | Wayfinder 已有明确排除证据，终止当前小队的自动交付路径 |

例如，`status = analysis_review` 是机器可执行 / 可判断的正式写法；`Analysis Review` 只用于 Board、List、UI 和自然语言展示。

当前 Delivery 生命周期涉及的 Status Key 统一使用：

```text
backlog
todo
in_progress
analysis_review
in_review
blocked
unsupported
done
```

Wayfinder 的准入结论 `accepted | needs_human | unsupported` 属于 **Triage Decision**，并非三种同名 Issue Status：`accepted` 经 `rondo delivery admission --decision accepted` 单次 Assignment Update 交给 `todo + Bug Fix Agent / Delivery Squad`，由 Multica 启动对应下游 Run；`needs_human` 使用 `blocked` 等待人工补充；`unsupported` 对应上表的自定义 Issue Status `unsupported`。二者均由 `rondo delivery admission` 设置状态，保留 Wayfinder 指派且不启动新 Run。

`unsupported` 表示**当前能力、授权或自动化边界下不支持交付**，不是执行失败，也不是永久不支持；必须有可追溯的排除证据，单纯信息不足应归入 `needs_human`。该状态只终止 Multica 当前自动交付路径，不完成或关闭原始 TFS Work Item；能力或授权变化后，Human 在原 Issue 回复必要信息，并在保留 Wayfinder Assignee 的情况下将状态改为 `todo` 触发重新准入；不要求解除、重新指派或 `@mention`。使用前须按当前安装版本回读 Workspace 的自定义状态配置及其终态行为。准入不授权编码，也不替代 Human Analysis Review。

不得再建立 `analysis.review_status = waiting | approved | rejected` 等第二套 Analysis Review 状态。

#### 1.4.8 Technical Change Kind 与自动处理边界

`corrective` 表示恢复有证据支持的既定行为；`intentional` 表示主动改变预期行为、业务规则或能力。Workitem Analyst 负责基于证据判断，并将结果在存在工程增量时通过 `rondo analysis publish` 写入 Multica Issue Metadata `analysis.change_kind`（string）；Gate 和 Publish 核对该分类与当前 OpenSpec Change 的 `.openspec.yaml.schema` 一致。技术分类是专业判断及统计维度，不是 Workflow、Skill 链或自动化授权。

超出授权、证据或当前自动处理能力的复杂变更须停止并交 Delivery Lead / Human；不另建复杂度 Route。紧急程度与排期由 Human 管理，不创建 `hotfix` 分类。执行分类与方法边界由 [03 §5](03-workitem-analysis-design.md#analysis-section-05) 维护，Schema 归属由 [05](05-openspec-schema-implementation-design.md) 维护。

**实施约定**：当前项目尚未上线，无历史分类数据迁移要求。目标运行契约将 `analysis.change_kind` 写入 Multica 服务器端 Issue Metadata，`analysis.route` 不再使用；验证代码、Skill 和 Workspace 后再发布。完成任务的统计以有效 Issue 完成事实（如 `done`）与分类字段联合过滤，不能把 Stage 的待审核分类直接计为已交付。

<a id="gate-terminology"></a>

#### 1.4.9 Gate Canonical Names（门禁统一名称）

当前交付方案统一使用以下名称；对应控制职责由[主方案](02-multica-delivery-lifecycle-design.md)维护，本节只维护正式名称，不表示这些 Gate 是 Multica 内置功能：

```text
Analysis Gate
Development Completion Check
Verification Gate
PR Transition Gate
Delivery Completion Gate
```

当前控制职责与适用范围见 [主方案：Deterministic Gate](02-multica-delivery-lifecycle-design.md#delivery-gates)。


#### 1.4.10 Naming Usage Rules（命名使用规则）

后续所有 `multica-delivery-lifecycle-design`、`workitem-analysis`、Agent Instructions、Squad Instructions、Skill、Config、Script 和 Artifact 遵循以下规则：

1. 指向具体 Multica 对象时，使用 Canonical Name，不使用简称或角色关系替代名称；
2. 配置、状态判断和脚本使用 Canonical Key / ID，不使用 Display Name；
3. `Analyst` 不再作为 `Workitem Analyst` 的别名；
4. `Verification` / `Verify` 可表示验证活动；`Regression / Integration / E2E` 是 Verification Method；指 Agent 时必须写 `Verify Agent`，其正式角色是按需 Independent Verification Executor；
5. `Engineer` 是 Requirement 新研发路线的正式 Agent 名称；旧 Backend / Frontend / Flink Engineer 仍使用各自完整名称，不混用；
6. `Parent Issue`、`Development Issue` 不再作为正式交付对象名称；
7. 下游方案只引用本节定义，不独立维护第二份全局术语表；
8. 新增术语时优先更新本节，再同步修改引用方案，遵守 **One Rule, One Owner**。


#### 1.4.11 Bilingual Terminology Rule（中英文术语标注规则）

面向人的设计文档中，核心英文概念首次出现或作为章节标题出现时，统一采用 **English Term（中文说明）**。中文用于降低阅读成本，英文继续承担 Canonical Name、标准名或跨文档检索锚点。

规则：

1. 架构、流程、职责、契约等概念性术语应补中文说明，例如 `Canonical Terminology（统一术语）`、`Runtime Projection（运行时投影）`、`Engineering Truth（工程事实）`；
2. Agent / Squad / OpenSpec Artifact 等正式对象名称保留英文正式名，可在首次出现时补中文语义，不另造第二个 Canonical Name；
3. 代码标识符、CLI 参数、Status Key、Route ID、Schema ID、文件名、路径、YAML / JSON 字段和值不翻译、不改写；
4. 同一小节内已经解释过的术语不要求每次重复括注，避免括号噪声；
5. 下游设计文档遵循本规则，不单独维护另一套中英文术语表。

---



### 1.5 设计文档与权威归属（Document and Asset Ownership）

<a id="design-document-scope"></a>

#### 1.5.1 设计文档与执行资产

本手册同时约定设计基线和执行资产的内容边界，两者不使用同一精简尺度。

| 资产 | 保留内容 | 不承担的内容 |
|---|---|---|
| 主方案 / 阶段设计文档 | 当前职责、输入、规则、流程、输出、停止与验收要求；帮助理解现行设计的必要业务背景 | 独立维护其他文档已经拥有的完整规则 |
| Agent / Squad Instructions、Autopilot Prompt | 对实际接收者长期或本次运行必需的约束 | 历史记录、冗长背景、完整专业 Procedure |
| `SKILL.md` | 当前方法的最小充分执行契约及按需引用 | 版本演进、完整设计说明、整份官方手册 |
| 历史变更记录 | 当时的变更、旧名称和版本引用 | 当前授权、状态机、产物要求或执行依据 |

必要业务背景可以在设计文档中完整保留。Goal Ownership 的权威定义位于 §1.3；Agent Instructions 负责长期专业目标和工作方式，Skill 负责复用的方法与资料（适用时定义局部能力结果），本次变更目标仍按既有 Engineering Truth / Delivery Truth 归属。例如，公司对 TFS Bug / Requirement 的绩效、工作量和 Task 管理差异，是理解管理类型与技术语义分离的依据；不因它不是执行步骤而压缩或删除，也不要求各 Skill 重复加载。

设计文档可以保留最终执行模型、决策表和核心原则，作为当前规则的摘要视图；跨阶段摘要须与[主方案](02-multica-delivery-lifecycle-design.md)对齐或引用[主方案](02-multica-delivery-lifecycle-design.md)，不独立改写详细契约。删除跨文档内容前先确认权威来源完整覆盖；未覆盖的必需规则先确定归属，不直接删除。

历史摘要允许暂时保留在独立区域，明确不作为当前执行规则。升级当前版本时不把历史版本号和旧设计改写成现行内容；正文中的废弃方案理由和未来假设不因有历史区而继续重复维护。



<a id="document-ownership"></a>

#### 1.5.2 文档体系与权威归属

| 文档 | 权威维护的内容 | 其他文档的使用方式 |
|---|---|---|
| 本手册 | Multica + OpenSpec 组合架构原则、Canonical Terminology、跨系统职责边界、Multica 配置规范、OpenSpec 公共机制、官方依据与来源引用规范 | 引用具体条目；领域方案不重新定义跨系统术语、Truth Ownership 或公共机制 |
| [Delivery 主方案](02-multica-delivery-lifecycle-design.md) | 跨角色生命周期、TFS 同步后的 Wayfinder 准入、人工授权、状态转换、任务组织、Stage 使用、Verify 批准、PR 与最终收口 | 阶段文档保留自己的输入输出和停止边界，引用跨阶段流程 |
| [Workitem Analysis 设计方案](03-workitem-analysis-design.md) | 分析角色、Wayfinder Evidence 增量复用、输入、分类与方法、OpenSpec Engineering Truth、Multica Analysis Handoff Facts、Verify 推荐生成、Analysis Gate（分析门禁） 细项、提交与定向返工 | 主方案维护交付摘要，引用详细专业契约 |
| [Engineer Development 设计方案](04-engineer-development-design.md) | 当前 assigned Task Set（任务集合） 的工程方法、Local Validation（本地验证）、Code Review（代码审查）、Evidence、工程交付与技术决策边界 | 主方案引用专业契约，不复制全部实现与检查方法 |
| [OpenSpec Schema 实施设计](05-openspec-schema-implementation-design.md) | 项目级 OpenSpec Schema、Artifact Graph、Templates、Change Identity、Task Contract、Apply Context、Validation / Archive 的实施级契约 | 本手册维护公共术语与机制；主方案 / 阶段方案只引用具体实施规则，不复制 Schema YAML、Template grammar 或 parser Contract |
| [Method Skill Library 实施设计](06-method-skill-library-implementation-design.md) | Project Skill 内部 Engineering Method Module 的组织、来源治理、调用与副作用边界 | Agent / Skill 规范只维护公共分层原则，具体 Method 实现引用该方案 |

“上位方案”不表示所有专业细则都必须放在[主方案](02-multica-delivery-lifecycle-design.md)。按规则适用范围确定唯一维护位置；规则归属与实际执行它的 Agent / Script 分开定义。发现冲突时按明确归属核对，无法确认则提出修正，不以文档层级或新版本号静默覆盖业务含义。

阶段设计中的“Analysis 阶段”“Development 阶段”指 Delivery 生命周期的专业工作区段，不对应 Multica 原生 Stage。原生机制见 [Parent / Child 与 Stage](#mechanism-parent-stage)，本项目的使用规则由[主方案](02-multica-delivery-lifecycle-design.md)维护。

---


<a id="method-artifact-boundary"></a>

### 1.6 Method / Artifact / Runtime Fact / View 的边界

本节落实 [§1.2 Runtime-Centric Delivery（以运行时为中心的交付） + Artifact-Centric Engineering（以工件为中心的工程）](#runtime-artifact-principle) 的全局原则。为避免“每执行一个 Skill 就生成一个同名文档”，也避免为了去文档化又创造第三套 Contract Store，专业阶段统一只区分四类概念：

| 概念 | 定义 | 设计要求 |
|---|---|---|
| Skill / Method | Skill 组织可复用步骤、资料与工具；Method 是可选技巧，不是原生平台对象 | 不因 Skill / Method 名称自动生成同名 Markdown 或持久化对象 |
| Artifact | 后续角色长期消费的专业事实与证据，例如 OpenSpec Proposal / Spec / Design / Tasks、必要 Evidence | `bug-analysis` 等 Method 不因名称自动成为 Artifact；专业事实只保留一个 Owner，Corrective 最终结论进入 Proposal |
| Runtime / Handoff Fact | 路由、审核、Gate、批准、Assignment、Status、Verify 是否执行等交付事实 | 优先使用 Multica Issue / metadata / custom property / comment / run result 等原生能力；不另造独立对象生命周期 |
| View / Summary | 面向人的摘要与展示 | 从 Artifact + Runtime Fact 渲染，不成为新的 Truth Source |

本节不重新定义跨系统原则；Engineering Truth / Delivery Truth 的权威定义见 [§1.2](#section-1-2)。这里进一步约束：

> **Skill ≠ Artifact。**

> **Summary / View ≠ Truth Source。**

Supporting Evidence（补充证据） 是 Artifact 或 External Reference 的一种，不单独形成新的架构层；Package 只是“当前审核 / 交接需要读取的一组现有事实”的普通集合概念，不是 Domain Type，也不自动创建 `<package>.md`。

判断是否新增持久化内容时依次询问：

```text
1. 这是 Engineering Truth 还是 Delivery Truth？
2. Engineering Truth 是否已经有 OpenSpec / Supporting Artifact Owner？
3. Delivery Truth 是否可以直接由 Multica 原生 Issue / metadata / comment / run result 承载？
4. 是否只是为了展示或交接而复制已有事实？如果是，只保留引用或 View。
5. 新增对象是否会引入自己的 schema / lifecycle / version / status / reconciliation？如果会，默认不要新增。
```

删除固定 Markdown 不等于删除 Contract；应先把技术事实迁移到明确 Artifact Owner，把交付事实映射到 Multica 原生事实，再取消重复载体。




<a id="section-2"></a>

## 2. Multica Native Mechanisms（Multica 原生机制）

<a id="mechanism-agent-description"></a>

### 2.1 Agent Description（智能体描述）

**官方机制：** Description 是显示在 Agent 列表和详情中的团队介绍，不进入 AI 编程工具的执行 Prompt。不能依赖它约束 Agent 行为。

来源：[创建和配置智能体](#source-agent-config)，文档核对日期 2026-09-29。具体角色描述按 [§5](#section-5) 编写。

<a id="mechanism-agent-instructions"></a>

### 2.2 Agent Instructions（智能体指令）

**官方机制：** Instructions 在每次执行提供给对应 Agent，适合描述职责和禁止事项、开始检查、修改边界、交付方式与需向成员确认的情况。

**本项目约定：** Instructions 维护长期职责、工作方式、决策边界和交付要求；可保留必要的简短检查，详细可复用步骤、资料与工具放入 Skill。六段式为推荐模板，不是官方或本项目的固定章节 Gate。

来源：[创建和配置智能体](#source-agent-config)，文档核对日期 2026-09-29。

<a id="mechanism-assignment"></a>

### 2.3 Assignment（分派）、启动与请求级暂不启动

**官方机制：** Assignment 改变长期 Ownership；当前评论范围的协助使用 `@mention`，不改变 Owner。分配给 Squad 时首先启动 Leader，不自动并行启动全部成员。固定 `backlog` 在正常创建 / 分配路径停放任务；自定义状态即使属于 `unstarted`，也不继承该特殊行为。

“暂不启动”只抑制本次请求。官方手册列出 `issue assign / update / status --no-start`；一次流程有多次写入时分别处理，不能把一次抑制当作后续操作的持久化开关。改 Owner 或 Status 不取消已经运行的 Run；正常交接需要启动新 Owner 时，不应误用暂不启动。

来源：[Assignment](#source-assignment)、[CLI](#source-cli)、[状态触发公开实现入口](#source-issue-trigger)，文档核对日期 2026-09-29。API 的 `suppress_run` 字段及各写入口行为须以团队安装版本的 API Contract 和实测确认；不能仅据 CLI flag 推断所有 API 都接受该字段。

**本项目约定：** 一个工作只采用一个正常派发入口；具体准备、状态写入、启动顺序及恢复由[主方案](02-multica-delivery-lifecycle-design.md) / Skill 定义。本条不授予成员额外状态写入权限，不构成全局锁。

<a id="mechanism-issue-run"></a>

### 2.4 Issue Status（事项状态）与 Run（运行）生命周期

**官方机制：** Issue 保存工作目标和交付状态，Run 保存一次执行；一个 Issue 可以有多次 Run。Run 正常结束本身不将 Issue 自动置为 `done`。状态更新、重新执行与取消 Run 是不同动作；`issue rerun` 为当前 Owner 重新排队一次执行，不等于恢复全部旧会话状态。

原生去重、连续评论合并及同一目标的后续执行不应扩大解释为父子树、不同 Agent 或外部系统的事务锁。运行成功、状态写入成功和业务交付完成分别确认。

来源：[Runs](#source-runs)、[Assignment](#source-assignment)、[评论路由](#source-mentions)、[CLI](#source-cli)，文档核对日期 2026-09-29。

**本项目术语边界：** `Multica Agent Run` 是 Multica 对一次 Agent 执行的运行记录与交接单位；`CLI Session` 指 Claude / Codex 等底层工具自身的会话或上下文生命周期。二者不是同一平台对象；不能根据一次 Run 推断必然新建一个 CLI Session，也不能因底层会话复用就认定多个 Agent 共用一个 Multica Run。Skill / Method 在一个 Agent Run 内的调用本身不要求新建 Multica Run。具体触发和会话复用由 Runtime Adapter / 安装版本确定并验证；本手册不声称官方提供一一对应保证。

**版本验收：** 同一 Issue / Agent 在实际派发入口下的串行行为、重试、底层 CLI Session 与目录恢复，须验证安装版本；不把去重描述当作 exactly-once 交付承诺。

**安装版本核验（2026-10-09）：** 云端 Server `/health` 返回 commit `2ea01ae4e`，本机 CLI 与桌面 Daemon 均为 `0.6.1`，对应同一源码 commit。已核对该版本的派发、领取、重试与恢复实现；实际派发入口的并发 / 故障注入端到端验收仍未完成，不能将源码核验写成全部运行验收通过。证据、测试结果与待验收项见 [Issue / Run 重试与复用核验记录](validation/issue-run-retry-reuse-0.6.1-2026-10-09.md)。

| 入口 / 场景 | 重试与复用语义（上述版本） |
|---|---|
| 同一 Issue + 同一 Agent 的后续执行 | 领取时串行；已有 `dispatched`、`running` 或 `waiting_local_directory` 时，后续 Run 不能同时领取。不同 Agent 不受这条串行规则约束。评论待执行去重还包含讨论线程，不能推导整个 Issue 只有一个待执行 Run。 |
| 普通评论 / 后续 Run | 非强制新会话时，查找同一 Issue + Agent 最近可恢复的 Session；同一 Runtime 且会话存储可达时才尝试继续。新 Run 可以复用旧 CLI Session。 |
| 系统自动重试 | 仅对可重试故障且仍有预算时创建新 Run；一般默认共 2 次尝试，模型服务网络故障默认共 3 次，最后一次约延迟 5 秒。认证、配额、配置等失败通常不自动重试；`max_attempts <= 1` 禁用自动重试。 |
| 历史 Run 行上的 Retry | 使用该历史 Run 的 Agent，以该 Run 为恢复来源；尽力保留目录，同一 Runtime 且 Session 安全、可达时继续会话。Issue 已换 Owner 也不自动改用新 Owner。 |
| `multica issue rerun <issue-id>` | 面向当前 Agent Owner / Squad Leader，新建 Run，不指定历史 Run，不请求继承旧 Session / 托管目录。若配置了固定本地目录，物理目录仍可能相同；不等于清空文件。 |
| Session 不可恢复 | 上下文溢出、损坏历史、缺失会话文件等可导致新建 Session；目录可独立保留。目录不存在或归属检查失败时，按当前配置重新准备执行环境。恢复目录不等于回滚文件或恢复外部副作用。 |

手动重跑会替换同一目标讨论线程内尚未开始的待执行任务；不会中断正在运行或等待目录锁的任务。系统重试、手动重跑与 Daemon 在单个 Run 内的恢复失败回退是不同层级，不能只按 Run 数量推断底层 CLI 调用次数。去重和串行只约束对应运行对象；外部写入已成功而完成回报丢失时，重试仍可能重复副作用，需由该副作用的执行方法查重或对账。

<a id="mechanism-custom-status"></a>

### 2.5 自定义 Issue Status（事项状态）

**官方机制：** Workspace owner / admin 可在 Settings → Issue Statuses 管理自定义状态；状态有生命周期分类，API / CLI 使用 Key，UI 显示名称。自定义状态只继承分类语义，不自动继承固定 `backlog`、`in_review`、`blocked` 或 `in_progress` 的特殊触发、完成或恢复行为。Board / List 按具体状态区分，而非只按分类合并。

Key 在创建状态时确定，修改 Display Name 不改变 Key；部署和调用前回读实际 Key。分类字段的实际枚举值以安装版本的 API Contract 核对，不复制一套推测的枚举映射。

来源：[Issues / Custom statuses](#source-issues)，文档核对日期 2026-09-29。

**本项目约定：** `analysis_review` / `Analysis Review` / `started` 的正式名称见 [§1.4.7](#status-terminology)；它表示什么业务等待、由谁写入和何时离开由[主方案](02-multica-delivery-lifecycle-design.md)维护。该状态不是 Multica 内置的人工批准引擎，也不提供全局暂停能力。

<a id="mechanism-parent-stage"></a>

### 2.6 Parent / Child（父子事项）与 Stage（阶段）

**官方机制：** 子 Issue 独立推进；满足原生子任务批次 / Stage 终态条件时，父 Issue 收到完成通知并由其负责人继续处理。Stage 按子任务分组，原生终态包括 `done` 和 `cancelled`；没有 Stage 的子任务作为一个批次。通知不代表父业务目标已完成，也不直接将所有后续工作启动。

公开 `issue_child_done.go` 实现将父级通知作为已成功状态更新旁的 best-effort 动作；通知错误不回滚该状态更新。具体进入终态条件、父级过滤和去重细节与实现版本相关，不作为不带版本的事务保证。

来源：[Issues](#source-issues)、[Parent / Stage 公开实现](#source-child-done)。文档及公开实现核对日期 2026-09-29；源码入口尚未锁定 commit，须在安装版本验收。

**项目使用边界：** 以 [主方案 §7.5](02-multica-delivery-lifecycle-design.md#delivery-stage) 为准，Stage 只用于需要独立 Runtime State 的 Development Sub-Issues 之间的完成依赖。原生 `cancelled` 不等于相关 Task Set 工程成功；父级仍核对有效 Evidence。项目不复制第二套通知状态机，不依靠反复切换终态制造通知。

<a id="mechanism-comments"></a>

### 2.7 Comment（评论）、Mention（提及）与 Squad（小队）回流

**官方机制：** 真正的 Mention 使用编辑器选择或平台返回的 mention 标识，纯文本 `@name` 不是执行触发。Mention 不改变当前 Issue 的 Owner 或 Status。普通回复按讨论上下文路由；符合回退条件的顶层评论可交给当前 Agent Owner 或 Squad Leader，显式 Mention 会影响回退目标。

连续评论可合并到待处理运行，目标正在执行时可形成后续运行；平台不因此决定业务协作何时结束。不是每一条评论或回复都必然唤醒 Leader，不能把回复成员线程当作可靠的父级审核通知。

**Comment Trigger（评论触发）规则：** 普通 Comment / Reply 会按讨论上下文、当前 Agent Assignee 或 Squad Leader 路由，可能创建 Agent Run；需要 Agent 执行时，使用真实 `@mention` 或符合原生路由规则的 Comment。仅需记录背景、Evidence、决策或交接信息时，以 `/note` 开头发布 Comment：内容仍保留在 Issue，但该 Comment 本身不触发 Agent Run。`/note` 不影响独立的 Assignment / Status 等 Runtime Trigger；发送前通过 Trigger Preview 检查实际接收者，若仍列出 Agent，则取消对应的本次触发。

来源：[Comments](#source-comments)、[Mention / Reply 路由](#source-mentions)、[Squads](#source-squads)，文档核对日期 2026-09-29。实际触发以当前上下文、预览、Access 和安装版本为准，不复制完整原生触发表。

**本项目约定：** 人审决定仍来自真实 Human 意见；评论触发不是批准。领域方案定义审核入口与原始反馈引用，成员 Skill 定义输出和停止条件。Wayfinder 以同一 Issue 的 `/note` Comment 持久化**准入结论、关键 Evidence References、未知项和交接建议**：首次或人工状态触发的 Wayfinder Run 可以发布顶层 `/note`；存在明确 Human 补充评论时，可在对应线程使用 `--parent` 关联回复，不凭空要求评论父 ID。确认有效 Decision 已记录后，`accepted` 通过 `rondo delivery admission --decision accepted` 按当前 `tfs.type` 执行单次 `status=todo + assignee=<目标 ID>` Update，走原生 Assignment Trigger；`/note` 的静默行为还须核查 `comment.created` Wakeup 规则。`/note` 的非触发语义参见 [官方 Mention / Comment 路由](https://multica.ai/docs/mentioning-agents)，具体 CLI / API 仍以安装版本实测为准。Comment 是 Supporting Evidence / Delivery Handoff，不是独立 Engineering Truth，也不替代实际工程变更的 OpenSpec Change。无需工程增量时，Analysis 专业结论直接记录在当前 Issue Comment，复用原生回流，不创建工程契约或研发批准事实。

<a id="mechanism-cli-version"></a>

### 2.8 CLI / API（命令行 / 接口）与安装版本

**官方机制：** CLI 手册提供公共命令入口；准确参数与输出以安装版本各命令的 `--help` 为准。`issue rerun`、状态写入和 `cancel-task` 是不同入口。

来源：[CLI](#source-cli)，文档核对日期 2026-09-29。

**本项目约定：** 脚本读取结构化结果，不解析面向人的终端表格。调用前确认 CLI / Server、API Contract、目标 Workspace 及权限。只能为已核实可用的入口编写可执行步骤；能力不一致时停止并报告，不用任意替代操作绕过启动或授权边界。公开文档、源码版本与本地运行验收分别记录，规则见 [官方机制与来源引用规范](#official-reference-policy)。

<a id="mechanism-autopilot"></a>

### 2.9 Autopilot（自动驾驶）与 Run Intent（运行意图）

**官方机制：** Autopilot 可按配置的计划或事件启动执行；Run 的触发仍通过 Multica 运行机制完成。

来源：[Runs / Trigger sources](#source-runs)、[Autopilots](#source-autopilots)，文档核对日期见来源索引。

**本项目约定：** Autopilot Prompt 的四类信息由 [§8](#section-8) 维护。定时 TFS / PR 同步、Thin Adapter、具体幂等与停止边界属于[主方案](02-multica-delivery-lifecycle-design.md)及对应 Skill；计划触发本身不证明外部同步、业务 Gate 或交付完成。

---


<a id="openspec-core-mechanism"></a>

## 3. OpenSpec Engineering Contract（工程契约与原生机制）

本节只维护理解本项目 OpenSpec 使用方式所需的公共机制，不复制 [05-openspec-schema-implementation-design.md](05-openspec-schema-implementation-design.md) 的项目级 Schema YAML、Template Markdown、Task parser 或实施脚本。

### 3.1 Schema 是 Artifact Contract，不是 Delivery Workflow

OpenSpec Schema 定义一个 Change 的工程工件契约：

```text
Schema
  ├─ Artifact definitions
  │    ├─ id
  │    ├─ generates
  │    ├─ template
  │    ├─ instruction
  │    └─ requires
  │
  └─ apply
       ├─ requires
       ├─ tracks
       └─ instruction
```

其作用可以概括为：

```text
Schema
→ 定义 Artifact 集合与 Artifact Graph
→ 定义每个 Artifact 的输出、Template 与 Instruction
→ OpenSpec 根据当前 Change 解析 Artifact 状态与可执行入口
→ Agent 按当前 OpenSpec Artifact Instruction / Template 生成或更新工程工件
→ OpenSpec 重新解析状态、Validation 与 Apply readiness
```

Schema 不负责 Multica 协作路由、Owner、Assignment、Issue Status、Human Approval、Verify Agent 是否 required、PR 生命周期或 Delivery Completion。以上继续属于 Delivery Truth。

### 3.2 Template 与 Artifact Instruction 的分工

`Artifact Template` 与 `Artifact Instruction` 是同一个 Artifact Contract 的两个不同部分：

```text
Template
= 输出结构 / 章节 / 形态
= “最终 Artifact 大致长什么样”

Instruction
= 内容语义 / 生成规则 / 禁止事项
= “应该如何形成这个 Artifact”
```

Template 不单独拥有工程事实，也不应被理解成另一份需要维护的业务文档。Schema 通过 `template` 字段把模板关联到 Artifact，通过 `instruction` 定义该 Artifact 的生成语义；Agent 基于当前 Change、上游 Artifact、**OpenSpec Project Context / Rules** 与这些生成约束完成最终 Artifact。这里的 Context / Rules 不指 Multica Project Context。

项目的 Native-first Template、任务可读编号与必要的定位 / 负向校验由 OpenSpec Schema 实施设计维护；本手册只维护公共机制和边界。


<a id="artifact-instruction-assembly"></a>

### 3.3 Artifact Instruction Assembly（工件指令装配）

OpenSpec 不负责定义 Multica Agent 的长期身份或协作 Prompt。对本项目而言，OpenSpec `instructions` 能力应理解为 **Artifact Generation Context（工件生成上下文）** 的解析入口，其逻辑输入来自当前 OpenSpec Change 与 Artifact Contract：

```text
OpenSpec Artifact Generation Context
= Current Change / Selected Schema
+ Target Artifact Definition
  - instruction
  - template
  - generates
  - requires
+ OpenSpec Project Context / Rules
+ Dependency Artifacts
+ Current Artifact State
```

典型消费链路：

```text
OpenSpec Change + Schema
→ 解析当前 Artifact State / dependencies
→ 获取目标 Artifact 的 instructions
→ Agent 消费 Artifact Instruction / Template / dependency context
→ 生成或更新 Artifact
→ OpenSpec validate / status 回读
```

必须保持以下边界：

```text
Multica Agent Instructions
Multica Squad Instructions
Multica Autopilot Prompt
Multica Issue Runtime State
Project Skill / Method Procedure
```

**不属于 OpenSpec Artifact Instruction 本身，也不是 OpenSpec Schema 的组成部分。** 它们可以与 OpenSpec Artifact Generation Context 同时被当前 Agent Run 消费，但 Owner、生命周期与生成机制不同。

因此不得把整个 Agent Run 简化描述为：

```text
Agent Instructions + Skill + Schema Instruction + Template = OpenSpec Prompt
```

更准确的组合关系是：

```text
Multica Runtime Context
        ↓
     Agent Run
        │
        └─ 调用 OpenSpec Artifact Contract
                 ↓
        Artifact Generation Context
                 ↓
          Engineering Artifact
```

本节定义的是项目的 **Context Ownership / Assembly Boundary（上下文归属 / 装配边界）**，不声明 OpenSpec 内部 LLM Prompt 的字节级拼接顺序。具体 CLI JSON Contract、Schema / Template 内容与版本行为仍由 [05-openspec-schema-implementation-design.md](05-openspec-schema-implementation-design.md) 锁定并测试。

<a id="skill-artifact-contract-boundary"></a>

### 3.4 Project Skill 与 OpenSpec Artifact Contract 的协作边界

Project Skill 与 OpenSpec Artifact Instruction 可以同时约束一次 Artifact 生成，但作用维度不同：

> **Skill owns the execution method; Schema owns the artifact contract.**  
> Skill 负责如何执行专业工作；Schema 及其 Artifact Instruction / Template 负责目标工件必须表达什么、满足什么内容质量要求、采用什么结构。前者消费后者，不另建同一 Artifact 的内容契约。

| 资产 | 权威职责 | 不应重复维护 |
|---|---|---|
| Project Skill / `SKILL.md` | 任务前置、专业调查 / 分析 / 操作步骤、工具调用、方法验证、结果提交与停止条件 | Artifact 内容结构、Schema 的 Artifact Graph、`requires` / `generates` |
| Schema Artifact Definition | Artifact ID、路径、依赖、生成指令、模板及 OpenSpec 原生 Apply 前置 | Agent 调度、Human Approval、专业 Method Procedure |
| OpenSpec Artifact `instruction` | 本 Artifact 的语义范围、结果证据 / 论证要求、质量与禁止事项、条件性内容要求 | 排查命令、CLI 操作手册、Skill 执行流程、Runtime 状态转换 |
| OpenSpec Artifact Template | Markdown 章节、字段及必要的简短填写提示 | 独立维护与 `instruction` 竞争的内容规则 |
| Gate / Script / Professional Review | 各自职责内的确定性检查或专业语义判定 | 替代 Artifact Contract、以文件存在推断 Human Approval |

**消费与执行：**

1. Skill 先读取当前 Change 已持久化的 Schema / OpenSpec Artifact State，确定目标 Artifact 和可用依赖；不得根据来源管理类型、Skill 名称或固定文件清单重新推断 Schema / Artifact Graph。
2. 生成或更新前，通过当前安装版本验证的 `openspec instructions <artifact-id> --change <name> --json` 等原生入口，获取当前 Artifact 的 `instruction`、`template`、`context` / `rules`、`outputPath` 及 `dependencies`；仅使用当前实际返回并可访问的字段，不把 Context / Rules 直接抄入产物。
3. Skill 消费必要的专业方法结论、上游 Artifact 与 Evidence，按照返回的内容契约和模板生成或更新目标 Artifact；任务方法或工具细节变化，不应要求同步改写每个 Artifact Instruction。
4. 生成后执行适用的 OpenSpec Validation / Status 回读，以及该 Skill 自身必需的验证。专业内容是否成立由负责的 Analysis / Review 方法判断；OpenSpec Validation PASS、文件存在、Artifact complete 或 Apply ready 均不代表专业 Review、Human Approval 或 Development Ready。

**同一主题允许互补，不允许重复定义同一规则。** 例如 Corrective：`bug-analysis` Skill 负责按 Hypothesis → Evidence → Verification → Conclusion 调查根因；`spec-preparation` Skill 负责消费该结论并生成适用 Artifact；Corrective `proposal.instruction` 约束 Root Cause 必须有可靠 Evidence、区分 confirmed / probable / unknown，Template 提供 Root Cause 等输出位置。不得将具体故障调查步骤复制进 `proposal.instruction`，也不得在 Skill 中维护第二份 Proposal 内容标准。

条件性 Artifact 的**存在条件与内容语义**由对应 Schema / Artifact Contract 定义（例如适用时生成 Delta Specs，或合法跳过）；Skill 只负责依据当前契约执行准备、更新必要的 Change metadata、确认实际状态。`artifact.requires` / `apply.requires` 由 Schema 管理，不为迎合 Skill 固定步骤而伪造 Artifact，也不将 OpenSpec Apply readiness 当作 Delivery Gate。

**冲突与缺失处理：** Skill 对某个 Artifact 内容的写作要求若与当前 Change 解析出的 Schema Instruction / Template 不一致，以该 Artifact Contract 为内容权威；应调整重复定义或按授权修订 Contract 后重新验证，不得静默忽略约束。当前 Schema、Instruction、Dependency 或关键 Evidence 不可获取、彼此冲突或语义无法可靠判定时，停止受影响 Artifact 的完成声明并报告缺口；不得以猜测、旧版 Skill 内置模板或空文件代替。Agent / Human 权限及 Delivery Gate 仍分别服从其原有 Owner，不因 Schema 的内容权威而改变。

通用 `openspec-propose` 可以承担 Change 创建、Artifact 状态读取与按依赖生成的编排方法；本项目 Analysis 的专业判断及工程工件准备由 `bug-analysis` / `requirement-analysis` 与 `spec-preparation` 等 Skill 按各阶段方案承担。二者不应各自维护一套针对相同 Artifact 的静态章节或专业质量规则。

---

### 3.5 Artifact Dependency 与 Apply Readiness

必须区分两类前置：

```text
artifact.requires
= 当前 Artifact 何时具备构建前提

apply.requires
= OpenSpec 原生 Apply 何时具备进入前提
```

它们都属于 OpenSpec Engineering Contract，不等于项目 Delivery Gate。尤其必须保持：

```text
Schema Validate PASS
≠ Artifact Graph Complete
≠ OpenSpec Apply Ready
≠ Analysis Gate PASS
≠ Human Approved
≠ Development Ready
```

因此不能仅依据文件存在、CLI 退出码或 OpenSpec Apply Ready 推断任务已经获得人工批准或可以完成交付。

### 3.6 Change Runtime Resolution（变更运行解析）

正常运行中，Change 首次准备时选择并持久化 Schema；后续 Agent / Run 读取现有 `.openspec.yaml` / OpenSpec 原生状态，不重新根据 TFS Type 或当前执行者猜测 Schema。

典型读取链路为：

```text
读取 Change + Schema
→ 读取 OpenSpec status / 当前 Artifact state
→ 获取当前 Artifact instructions
→ 消费所需上游 Artifact / Context
→ 生成或更新目标 Artifact
→ validate / status 回读
→ 进入下一 Artifact 或 Apply
```

项目锁定的 OpenSpec Runtime Baseline、`schema which`、`status`、`instructions`、`validate`、`skip_specs`、Archive 与 Conditional Artifact 的实际版本行为，由 [05-openspec-schema-implementation-design.md](05-openspec-schema-implementation-design.md) 作为实施级权威来源并通过本地 Acceptance Test 验证。

### 3.7 Project Usage Boundary（项目使用边界）

公共规则统一为：

- OpenSpec 负责 Engineering Truth 与 Artifact Contract；Multica 负责 Delivery Truth 与 Runtime；
- Schema 定义 Artifact Contract，不定义 Delivery Workflow；
- Template 定义 Artifact 输出结构，不成为新的 Truth Source；
- Instruction 定义 Artifact 生成语义，不替代专业 Analysis / Engineering Method；
- Artifact dependency / Apply readiness 不替代 Analysis Gate、Human Approval 或 Delivery Completion Gate；
- 项目级 Schema / Template 具体实现只在 [05-openspec-schema-implementation-design.md](05-openspec-schema-implementation-design.md) 维护，其他文档通过引用消费。

当前 OpenSpec 实施基线固定为 `1.14.2`。公共机制与项目实施契约必须分开维护：本节回答“OpenSpec 这些概念如何工作”，[05](05-openspec-schema-implementation-design.md) 回答“本项目两个 Schema 和模板具体如何实现”。

来源基线：OpenSpec Schema Contract、Agent Contract 与 CLI Contract 的当前项目核对入口统一由 [05-openspec-schema-implementation-design.md](05-openspec-schema-implementation-design.md) 维护；版本升级时先在 [05](05-openspec-schema-implementation-design.md) 完成回归，再评估本节公共描述是否需要调整。


<a id="mechanism-shared-context"></a>

## 4. Multica Runtime Context & Squad（运行上下文与协作）

本章只描述 **Multica Runtime Context** 与 Agent / Squad / Skill 的接收边界，不把 OpenSpec Artifact Generation Context 混入同一注入层。OpenSpec 的工件指令装配见 [§3.3](#artifact-instruction-assembly)。

Multica 实际还存在 Workspace、Project 和 Issue 级 Context。官方来源：[Workspace](#source-workspaces)、[Project](#source-projects)、[Issues](#source-issues)，文档核对日期 2026-09-29。

官方说明：

- **Workspace Context** 会提供给 Workspace 中的所有 Agent，适合团队背景、产品约定以及长期有效的公共要求；
- 一次性的执行要求应该放在对应 Issue 中。
- Project Description 适合项目级目标、技术边界和交付约定，而只属于单个 Issue 的要求应放在 Issue 中。
- Issue 本身保存目标、背景、要求、讨论和执行历史；在本项目中，Issue 保存 Source Requirement（源需求）与 Delivery Facts，并通过稳定引用关联 OpenSpec 中的 Canonical Engineering Acceptance Contract（权威工程验收契约），不复制其正文。

因此推荐形成以下完整分层：

以下分层仅表示内容职责划分，不表示 Multica 官方的 Prompt 注入顺序、指令优先级或覆盖关系。

```text
Workspace Context
    │
    │ 团队级长期规则
    ↓
Project Context
    │
    │ 项目级长期约束
    ↓
Autopilot Prompt
    │
    │ Run Intent / Trigger Contract
    ↓
Squad Instructions（当前 Run 以 Squad Leader 身份执行时）
    │
    │ Collaboration Contract
    ↓
Agent Instructions
    │
    │ Agent-specific Role Contract
    ↓
Skill
    │
    │ Reusable Execution Contract
    ↓
Issue / Comment
    │
    │ 本次工作的 Goal / Context / AC
    ↓
Run
```

其中 `Squad Instructions` 表示由 Leader 接收的内容职责层，不表示全队共享的注入顺序。Member 不因加入 Squad 而自动继承该层；未自动注入也不等于绝对不可通过工具读取，但执行契约不能依赖这种隐含读取。

其中：

```text
Agent Description
```

仅承担 UI 展示作用，不属于执行 Prompt 规则层。

对于当前研发交付架构，还增加一个独立维度：

```text
Deterministic Gate / Guard / Route
```

负责可以程序化、确定性判断的流程控制。


### 4.1 Multica 配置层的职责边界

| 层 | 解决的问题 | 生命周期 | 典型内容 |
|---|---|---|---|
| Agent Description | 这个 Agent 干什么 | 长期 | 一句话角色介绍 |
| Workspace Context | 我们这个团队怎么工作 | Workspace 长期 | 团队背景、公共约定 |
| Project Context | 这个项目有什么统一约束 | Project 生命周期 | 项目目标、技术边界 |
| Squad | 哪些 Agent 作为一个协作单元工作 | Squad 生命周期 | Leader / Members |
| Squad Instructions | Leader 如何组织成员协作 | Squad 长期，仅提供给 Leader | Collaboration / Handoff / Escalation |
| Agent Instructions | 负责什么、如何工作、何时停止及交付什么 | Agent 长期、每次执行 | Role / Working Style / Boundary / Delivery |
| Skill | 某类工作需要哪些可复用步骤、资料和工具 | 可跨 Agent 绑定、按需使用 | Procedure / Checklist / Reference / Template / Tool |
| Issue | 这一次具体要做什么 | 单项工作 | Goal / Context / AC |
| Comment | 本轮新增什么信息 | 单次交互 | Feedback / Request |
| Gate / Route | 能否继续、确定性的下一步是什么 | Runtime | PASS / FAIL / Route |

---



<a id="mechanism-squad"></a>

### 4.2 Squad（小队）与 Squad Instructions（小队指令）

当前 Delivery Squad 的默认协作模式是**单一 Issue + 原生 `@mention` + 各成员独立 Run**。`Sub-Issue` 是 Multica 原生能力，但不是本项目当前常规交付路径；仓内已有相关执行分支暂保留待专门回归和退役，不能据此要求 Leader 日常创建。

对于需要多个 Agent 协作完成同一个工作对象的场景，本规范增加 Squad 维度。

#### Squad（小队）

Squad 是：

> **多个 Agent 的协作单元 / Collaboration Unit。**

Squad 本身不是 Agent，不承担某个具体专业角色。

典型结构：

```text
Delivery Squad
│
├── Leader
│   └── Delivery Lead
│
└── Members
    ├── Workitem Analyst
    ├── Backend Engineer
    ├── Frontend Engineer
    ├── Flink Engineer
    └── Verify Agent
```

因此必须区分：

```text
Delivery Squad
= Squad / 协作容器

Delivery Lead
= Agent；在 Delivery Squad 中承担 Leader 关系

Workitem Analyst / Backend Engineer / Frontend Engineer / Flink Engineer / Verify Agent
= Delivery Squad Member Agents
```

不得将 Squad 与 Leader Agent 视为同一个配置对象。

#### Squad Instructions（小队指令）

Squad Instructions 是：

> **提供给 Leader 的 Collaboration Contract：由 Leader 执行的协调、路由、交接与升级规则。**

Multica 的 Squad Instructions 只提供给 Leader，不自动广播给 Member。Leader Run 还会收到原生 Squad Operating Protocol 与 Roster；成员角色说明帮助 Leader 选择执行者，不代替 Member 的执行指令、不授予权限，也不自动给成员绑定 Skill。此处描述注入范围，不声明所有任务共享一个 Prompt 或会话。（来源见 [Squads](#source-squads)；文档核对日期 2026-09-29。）

主要回答：

```text
哪些成员一起工作？
谁是 Leader？
什么时候把工作交给哪个角色？
什么时候等待 Human？
如何在当前 Issue 内分工并保持任务不重复派发？
什么时候需要 Leader 介入？
什么时候可以进入 Squad-level Completion？
```

适合保存：

- Leader / Member 的协作关系；
- 成员之间的交接原则；
- 角色选择和语义路由原则；
- 同一 Issue 内的专业分工与交接原则；
- Human Review / Approval 的等待边界；
- Leader 介入和异常升级条件；
- Squad-level Completion 的协作原则。

不适合保存：

- Specialist 的专业执行步骤；
- 代码实现方法；
- Verify 的详细检查 Procedure；
- Gate 算法和状态判断实现；
- 当前 Issue 的具体需求、Source Requirement 或 OpenSpec Acceptance Contract 正文；
- 已有权威 Script / Gate 维护的状态机副本；
- 仅写在这里却期待 Member 自行遵守的专业执行义务。

本节属于本项目基于 Multica Squad 能力制定的工程约定，不表示 Multica 官方规定了固定的 Squad Instructions Markdown 模板。

### 4.3 Squad Leader 与 Member 的边界

Squad Leader 是普通 Agent 在 Squad 中承担的协调角色，不是独立 Workflow Runtime。

Leader 适合负责：

```text
读取当前事实
理解人工自然语言意见中的决定、条件与反馈；不代替人工批准
判断当前需要哪种专业能力
@mention / handoff 对应 Member
处理歧义、冲突和跨角色问题
处理 Deterministic Route 无法可靠判断的语义问题
在 Squad-level Completion 条件满足后完成收口
```

Leader 不应默认承担：

```text
替代 Workitem Analyst 做正式分析
替代 Engineer 完成生产代码
在 required=true 时替代 Verify Agent 做独立验证
替代 Human Approval
覆盖明确的 Deterministic Gate FAIL
通过 Prompt 维护一套完整 Workflow Engine
```

Member 负责自己的专业工作，不承担整个 Squad 的全局编排。

Assignment 用于 Issue 在不同 Owner 间的责任转移（例如 Wayfinder Agent → Delivery Squad）；Squad 内部专业工作通过当前 Issue 的 `@mention` 派发，不为分工更换整个 Issue 的 Assignee，也不创建独立子事项。职责明确而无需协作的其他 Issue 可以直接分配给 Specialist，但不属于当前 Delivery Squad 的内部派工路径。（来源见 [Squads](#source-squads)。）

当前专业成员分别拥有独立 Run，不共享 Leader 临时会话；Leader 根据同一 Issue 内已持久化的专业结果与实际评论回流继续协调。

同一工作只选一个正常触发入口。状态写入、任务触发与任务取消是不同操作；不以改状态代替显式启动或取消，也不重复 `@mention` 同一工作。

<a id="section-4-4"></a>

### 4.4 Squad Instructions 与 Multica Agent Instructions 的边界

| 资产 | 主要接收者 / 执行者 | 回答的问题 |
|---|---|---|
| Squad 配置 / Role Description | Leader 用于选择协作者 | 哪些成员一起工作，各自适合什么工作 |
| Squad Instructions | 当前以 Leader 身份执行的 Agent | 如何选择成员、交接、等待 Human 与协调异常 |
| Agent Instructions | 对应 Agent | 长期职责、工作方式、决策边界、何时停止和如何交付 |
| 绑定 Skill | 调用该方法的 Agent | 可复用工作步骤、资料与工具；按场景说明必要的 Validation、Evidence、Output 和停止条件 |
| Issue | 当前工作的执行者 | 本次 Goal、Scope、AC、依赖与上下文引用 |
| Comment / Handoff | 本轮请求的处理者 | 新 Finding、修正方向或额外限制 |
| Gate / Script | 确定性执行入口 | 硬条件是否满足，副作用如何安全执行与恢复 |

Member 必须执行的长期职责与停止边界写入该 Agent 的 Instructions；详细方法与输出契约放入其绑定 Skill。不得只在 Squad Instructions 中维护 Member 的执行义务。

Agent Instructions 可以引用方法的权威 Skill；无需再复制整套 Procedure。多个 Agent 使用同一方法时，绑定同一 Skill，不复制多份实现。Workspace / Project Context 仅保存对应范围真正共享的规则，不因“想让成员看见”就把完整 Delivery Workflow 放入公共上下文。（来源见 [Skills](#source-skills)。）

### 4.5 注入与派发规则

Leader 派发只补充本轮必要的目标、范围、顺序和约束，不转述完整 Issue，不复制完整 Squad Instructions 或 Member Skill。原生协议、Roster 与项目自有规则应区分，不维护一份会与平台漂移的原生协议副本。

Member 通过自身 Instructions、明确绑定的 Skill、当前 Issue / Comment 与可访问的权威产物获得执行契约。成员的 `@mention` Run 必须能独立读取工作依据，不依赖 Leader 临时会话。加入 Squad 不意味着自动继承 Leader Instructions、Squad Instructions、其他成员 Skill、工具权限或会话。

配置 Review 同时检查两个问题：规则的权威定义在哪里；执行该规则的 Agent 是否稳定获得该定义或必要引用。One Rule, One Owner 不等于只能把所有规则放在 Leader 可见的位置。

对来源不明确或无法获得的必需输入，执行者应停止并说明缺口，不假设它已经通过父级会话自动传递。

---


<a id="section-5"></a>

## 5. Agent Description（智能体描述规范）

### 5.1 定位

Agent Description 只回答：

> **这个 Agent 是干什么的？**

它面向 Workspace 成员，而不是执行中的 LLM。

---

### 5.2 推荐内容

推荐只描述：

```text
主要职责 + 主要处理对象 + 必要时补充核心目标
```

推荐控制在 **一句话**。

例如：

```text
负责研发交付阶段边界推进、跨任务协调与异常处理，确保交付流程正确闭环。
```

---

### 5.3 Agent Description（智能体描述）不应该包含

不要放：

- Workflow；
- Gate 判断；
- 操作步骤；
- Tool 使用方法；
- Skill 使用方法；
- Exception Playbook；
- Prompt Rules；
- 当前任务的 Source Requirement / Acceptance Contract；
- 当前任务信息。

#### 判断原则

删除这段 Agent Description 后：

> Agent 的实际执行行为不应该发生变化。

否则说明本应属于 Instructions 的规则错误地写进了 Agent Description。

---

<a id="section-6"></a>

## 6. Multica Agent Instructions（智能体指令规范）

### 6.1 定位与 Persistent Role & Working Contract

Agent Instructions 是：

> **Agent 的长期职责、工作方式、边界与交付契约。**

回答：

```text
Who am I?
What professional outcome am I accountable for?
What do I own?
What do I not own?
How should I work and make decisions?
When should I stop / escalate?
How should I deliver?
```

而不是：

```text
整个 Workflow 怎么运行？
```

---


### 6.2 推荐内容维度与六段式模板

以下六部分是推荐的**内容维度**，不强制 Markdown 章节数量、固定顺序或独立 `Goal` 标题。长期目标、职责、工作方式、边界和交付要求清楚时可以合并相近内容，不以模板标题齐全替代执行质量评审。

Instructions 可以保留每次必需的简短启动检查、长期工作策略与交付动作；详细可复用步骤、资料与工具放入 Skill。不得把本次 Issue 的 Task Goal 或 OpenSpec Proposal Goal 写入长期 Instructions。

#### 6.2.1 Role（角色）

定义 Agent 在整个系统中的定位。

通常只需要 1～3 个短段落。

应该包含：

- 是谁；
- 核心定位；
- 在系统中的责任位置；
- 必要的总体原则。

例如：

```text
你是 Multica 研发交付流程中的 Delivery Lead，
负责阶段边界协调、跨任务协调和异常处理。

你正常承担人工意见理解、成员选择和协作交接；涉及硬条件和写入时复用原生工具及必要 Gate。
不替代人工批准或 Specialist 专业判断，不要求语义工作先等待脚本返回 UNKNOWN。
```

---

#### 6.2.2 Goal（专业目标）

用一句话说明 Agent 对什么**长期专业结果**负责；表述要可辨识、职责内可实现、与当前 Issue 无关。不要列成步骤清单，也不要把具体任务的验收条件、Skills 名单或流程状态写入 Goal。

例如：

```text
将工作项转化为准确、可实施、可验证的需求分析结果。
```

---

#### 6.2.3 Core Responsibilities（核心职责）

只描述该 Agent **长期 Owner 的职责**。

建议：

```text
3～5 项核心职责
```

每项描述 **What**，不要展开大量 **How**。

例如：

```text
- 阶段边界推进
- 跨任务协调
- 异常与语义决策
- 最终交付闭环
```

不要在这里开始写：

```text
第一步执行 A
第二步执行 B
第三步创建 C
第四步检查 D
```

那已经属于 Skill 或 Workflow。

---

#### 6.2.4 Boundaries（职责边界）

这是 Multica Agent Prompt 中非常重要的一部分。

明确：

```text
What NOT to do
```

例如：

```text
不得直接修改生产代码。
不得在 required=true 时替代 Verify Agent 完成独立验证。
不得替代人工批准 PR。
不得覆盖 Deterministic Gate FAIL。
```

职责边界通常比额外增加能力描述更重要。

原则：

> **Agent 要知道自己应该停止在哪里。**

---

#### 6.2.5 Execution Principles（执行原则）

主要定义 Agent 的长期决策原则，也可包含每次必需的简短检查，不展开详细执行流程。

适合保存：

- 信息源优先级；
- Source of Truth；
- 决策优先级；
- 修改范围原则；
- Evidence 原则；
- Fail-safe 原则；
- 最小变更原则；
- 确定性机制与 LLM 判断的关系。

例如：

```text
以 Multica 当前事实状态为准，不根据历史会话推测当前状态。

能由 Deterministic Gate / Route 判断的事情，不进行额外语义判断。

失败时优先 targeted rework，不无差别重新执行全部任务。
```

这些规则在不同任务中长期成立，因此适合放 Instructions。

---

#### 6.2.6 Escalation, Communication & Delivery（升级、沟通与交付）

建议将原来的：

```text
Escalation & Communication
```

扩展为：

```text
Escalation, Communication & Delivery
```

原因是 Multica 官方明确把 **Delivery Requirements** 归入 Instructions。

这里定义：

##### Escalation（升级）

什么时候必须停止自主推进：

```text
UNKNOWN
责任归属不明确
关键证据缺失
规则冲突
需要人工批准
超出权限
```

##### Communication（沟通）

与 Agent / Member 沟通时需要提供什么：

```text
事实
问题
Evidence
下一步
责任人
```

##### Delivery（交付）

Agent 最终如何交付：

```text
Issue Comment
Artifact
PR
Status Update
TFS Update
Runtime / Handoff Fact
```

这里定义 **交付契约**，但不要重新描述整个执行步骤。

---


### 6.3 推荐结构与内容归属

可按复杂度选用：

```text
# Role
# Goal
# Core Responsibilities
# Boundaries
# Execution Principles
# Escalation, Communication & Delivery
```

简单 Agent 可以将 Goal 写入 Role、将 Escalation 与 Delivery 合并，保持最小充分；内容归属按语义判断：

```text
长期要达成什么专业结果 → Goal
负责什么 → Core Responsibilities
不负责什么 → Boundaries
长期判断规则 → Execution Principles
停止 / 升级 → Escalation
沟通与交付 → Communication & Delivery
```

---


### 6.4 Prompt 风格规范

统一要求：

> **短、硬、明确。**

推荐使用：

```text
必须……
不得……
优先……
仅当……才……
如果……则停止……
以 X 为事实来源……
无法确定时……
```

避免：

```text
请仔细分析……
充分考虑……
综合判断……
尽可能合理地……
根据实际情况灵活处理……
```

后者缺少可执行约束。

---


### 6.5 Role & Working Style-oriented 原则

Agent Instructions 应：

> **Role-oriented**

描述：

```text
我的职责是什么
我的权限在哪里
我什么时候介入
我的判断原则是什么
我如何选择证据、方法与交付方式
```

而不是：

> **Workflow-oriented**

详细描述：

```text
A → B → C → D → E
```

---


### 6.6 Principle-oriented 原则

Instructions 应描述：

```text
以当前事实状态为准
优先确定性规则
失败优先 targeted rework
不得绕过 Gate FAIL
```

Skill 描述：

```text
Step 1
Step 2
Step 3
```

以上是内容的主要归属，不要求 Instructions 完全没有步骤。每次必需的简短检查可保留在 Instructions，详细步骤与可复用方法放入 Skill，避免重复定义。

---


### 6.7 Boundary-first 原则

设计 Agent 时，不应该不断增加：

```text
Agent 还能做什么？
```

而应该优先明确：

```text
Agent 到哪里必须停止？
什么事情属于别人？
什么事情只能由 Human 决定？
什么事情必须交给 Deterministic Gate？
```

这样可以减少 Agent 之间的职责竞争和流程漂移。

---


### 6.8 长度与最小充分原则

Multica 官方没有规定 Instructions 的行数或 Token 上限。

本规范不设置硬性行数限制。

但由于 Instructions：

> **每次 Run 都会提供给 Agent**

因此建议：

```text
只保留长期、高频、行为约束性强的内容。
```

判断一段内容是否应该留在 Instructions，可以问：

> **这个规则是否值得在这个 Agent 的每一次 Run 中都出现？**

如果答案是：

```text
不是
```

通常就应该移到：

```text
Skill
Issue
Project Context
Reference
Script
```

中的某一层。

---


## 7. Project Skill / SKILL.md（技能设计规范）

<a id="mechanism-skills"></a>

### 7.1 Multica Skill 官方定位与项目约定

官方来源：[Skills](#source-skills)，本次文档核对日期 2026-11-04。下述 Method 分层和推荐模板属于本项目约定，不是 Multica 官方强制 Schema。

Multica 官方将 Skill 定义为：

> 可复用的一组工作方法，由 `SKILL.md` 以及可选的 scripts、templates、references 等支持文件组成。

官方对 **Agent Instructions 与 Skill** 的划分非常明确：

| | Agent Instructions | Skill |
|---|---|---|
| 适合保存 | 专业目标、长期职责、工作方式、边界与交付要求 | 某类工作可复用的步骤、工具、资料与模板 |
| Scope | 属于一个 Agent，每次 Run 提供 | 可绑定多个 Agent，并分别启停 |
| 典型示例 | “只 Review 前端代码，不直接修改” | Accessibility checklist + report template |

官方还明确建议 `SKILL.md` 描述：

- Skill 什么时候适用；
- 开始前检查什么；
- 执行步骤；
- 结果以什么形式提交；
- 什么情况下停止并询问成员。

因此本项目正式采用：

> **Agent Instructions = Persistent Role & Working Contract**  
> **Skill = Reusable Work Method Package**

Capability Outcome 只是专业结果型 Skill 可选的设计补充，不是所有 Skill 的必填字段。**同一 Skill 可以被多个 Agent 使用，也可以由单个 Agent 跨任务复用；是否在实际执行中可用，以工作区绑定、启停与加载机制为准。**

其中必须区分：

```text
Skill
= 完整的可复用能力目录
= SKILL.md + 可选 config / scripts / references / templates / tests

SKILL.md
= Agent 执行该方法时需要读取的最小执行说明
```

`SKILL.md` 不是 Skill 的全部内容，也不应承担整个 Skill 目录中所有知识的汇总职责。

核心原则：

> **SKILL.md 只保存正确执行当前方法所必需的最小充分信息。**

详细知识、参数、确定性实现和模板应按职责拆分到支持文件，避免每次执行都把全部背景和参考资料加载进上下文。

---



### 7.2 Skill（技能）规范

#### 7.2.1 定位

Skill 回答：

> **这项能力适用于什么场景，期望达成什么局部结果，怎样可靠完成？**

Skill 应以 **Capability / Method / Scenario** 为中心，而不是以 Agent 身份为中心。

例如：

```text
tfs-sync
delivery-flow
pr-transition
integration-verification
workitem-analysis
```

比：

```text
delivery-lead-helper
engineer-behavior
```

更适合作为 Skill。

本项目进一步将 Skill 定义为：

> **Reusable Work Method Package：围绕某类工作或场景组织可复用步骤、资料、工具、模板与执行指导。`SKILL.md` 应以最小充分方式说明适用场景、必要准备、执行方法、结果使用或提交方式，以及适用的停止与求助条件；不强制独立 Capability Outcome、Validation 章节或持久化 Artifact。**

**Skill Extraction（能力提取）** 以可复用场景与维护收益为依据。某个阶段存在一个步骤、一个 Agent 经常做某事，不足以证明应创建独立 Skill；纯内部技巧优先保留为 Method。

设计 Skill 时按适用性检查以下六类问题；方法本身必须足以支持正确执行和安全停止，但不强制每项对应独立章节、结果对象或专属 Artifact。参考/规范型 Skill 说明资料如何使用，不必人为制造完整交付链；局部结果确实有辨识价值时可补充 Capability Outcome：

```text
When?
→ 什么时候应该使用？

Input?
→ 开始前需要什么？

How?
→ 具体怎么执行？

Validation?
→ 怎么知道执行正确完成？

Output?
→ 最终交付什么？

Failure?
→ 失败、阻塞或无法判断时怎么办？
```

#### 7.2.2 Skill 与 SKILL.md

必须区分整个 Skill 与入口文件：

```text
<skill>/
├── SKILL.md
├── config/       # optional
├── scripts/      # optional
├── references/   # optional
├── templates/    # optional
└── tests/        # optional
```

职责统一为：

| 资产 | 职责 |
|---|---|
| `SKILL.md` | 最小执行说明与方法边界 |
| `config/` | 环境参数、可配置策略、路由表 |
| `scripts/` | 确定性计算、校验、同步、Gate / Route 实现 |
| `references/` | Schema、API、Mapping、Contract、详细说明 |
| `templates/` | 输出模板与结构化 Artifact 模板 |
| `tests/` | 确定性逻辑和脚本的回归测试 |

原则：

> **Skill 可以完整，SKILL.md 必须克制。**

同时必须区分 Method 与 Artifact：Skill 定义“怎么做”，不因为 Skill 名称是 `requirement-analysis`、`requirement-review`、`context-analysis` 就默认要求生成同名 Markdown。Artifact 是否存在由下游 Contract 和 [§1.6](#method-artifact-boundary) 的 Owner / 持久化原则决定。

#### 7.2.3 Runtime Independence（运行时独立性）

Skill 不依赖特定 Agent 身份、隐式会话、专属物化目录或进程当前工作目录；运行环境负责加载与部署。**允许因真实业务场景明确依赖 TFS、Multica、OpenSpec、`rondo`、CodeGraph、Repository Mapping 等系统与工具**，应说明必要输入与权限，不为追求抽象平台无关性而删除实际业务依赖。

---


### 7.3 SKILL.md 推荐结构

#### 7.3.1 Frontmatter（前置元数据）

推荐使用：

```yaml
---
name: <skill-name>
description: <做什么 + 什么时候使用>
---
```

`description` 应尽量同时表达：

```text
What
+ When
```

因此正文通常不再重复大段 `Purpose / When to Use`。

#### 7.3.2 正文结构

以下结构适用于有执行与交付动作的工作型 Skill；参考型或检查型 Skill 可仅保留真正有用的章节：

```text
# Skill Name

## Preconditions / Inputs

## Approach / Procedure

## Validation

## Output

## Error Handling / Stop Conditions
```

各部分只回答一个问题：

| Section | 回答的问题 |
|---|---|
| Preconditions / Inputs | 开始前必须具备什么？输入从哪里来？ |
| Approach / Procedure | 哪些是不可省略的操作，哪些是 Agent 可按复杂度选择的专业方法？ |
| Validation | 如何判断结果正确、完整、可交付？ |
| Output | 最终产生什么 Artifact / Result / State Change？ |
| Error Handling / Stop Conditions | 失败、UNKNOWN、缺输入、权限不足或无法安全继续时怎么办？ |

Multica 官方明确要求的核心内容仍然覆盖：

```text
什么时候使用
开始前检查什么
执行步骤
结果形式
什么时候停止并询问成员
```

适用时使用 `Validation` 描述 Completion Check、Evidence Check、Test、Gate 或确定性校验；纯参考型 Skill 不强制单列 Validation 或独立 Output Artifact，但不得因此省略当前工作已有的必要安全与质量约束。

可选在标题后加一句 `Capability Outcome: <可验证的局部能力结果>`，不得重复 Agent 的 Professional Goal。对于 `bug-analysis`，局部目标可以是“基于证据定位缺陷根因、确定影响范围与验证建议”；对 `tfs-sync` 等结果已由 `description` / `Output` 明确的 Skill，不强制另写 Goal 章节。

不要求每个 Skill 都单独维护 `Deterministic Checks` 章节；存在确定性检查时，应在 `Validation` 中说明调用什么 Gate / Script 以及如何解释结果。

**示例：`bug-analysis`（规范示例，非当前已部署 Skill）**

```markdown
---
name: bug-analysis
description: 基于工程证据诊断软件缺陷；需要定位根因或评估修复与回归影响时使用。
---

# Bug Analysis
Capability Outcome: 定位可信根因、影响范围与修复验证建议。

## Preconditions / Inputs
缺陷现象、预期 / 实际行为、可访问的代码或运行证据。

## Approach / Procedure
按问题复杂度选择复现、日志、源码与假设验证；不强制固定调查工具或步骤。

## Validation
根因及修复建议能关联可追溯证据；未证实的假设清晰标注。

## Output
根因、证据、影响范围、修复及回归验证建议；由调用场景写入权威 Artifact。

## Error Handling / Stop Conditions
关键证据不足或超出权限时说明未知项，不宣称已确认根因。
```

此 Skill 不定义 Workitem Analyst 身份，不承担 Issue 状态、OpenSpec Change 创建和分析提交审核；同一能力也可服务 Engineer 的定向诊断。

#### 7.3.3 Minimality Principle（最小化原则）

`SKILL.md` 遵循：

> **Minimum Sufficient Instruction：只保留正确执行当前方法所需要的最小充分信息。**

判断某段内容是否应留在 `SKILL.md`，统一询问：

> **Agent 在执行这个 Skill 时，如果不知道这段内容，是否会影响正确执行或安全停止？**

如果答案是否定的，通常应删除或移出 `SKILL.md`。

这不是追求最短文本，而是减少与当前执行无关的信息、重复规则和上下文负担。

**执行步骤的约束等级**：在 `Procedure` 中区分不可交换的副作用/授权顺序与专业建议顺序。允许为便于理解而排列方法步骤，但不得仅因步骤顺序不同、未使用某推荐工具或改用等效验证方法，就认定专业执行失败；有法定、批准或实际依赖的顺序仍须严格遵守。所有任务均须满足适用的 Hard Constraint 与 Outcome Contract；专业方法及实施深度可按复杂度调整，不强制执行无必要的 Recommended Method。

#### 7.3.4 Progressive Disclosure（渐进披露）

Skill 内容采用按需加载：

```text
Level 1
name + description
        ↓ Skill 被选中

Level 2
SKILL.md
最小执行方法
        ↓ 确实需要

Level 3
config / scripts / references / templates
详细参数、实现与知识
```

因此：

- 不要为了执行一个简单任务，要求 Agent 预先阅读整个 references；
- `SKILL.md` 只引用本次执行可能需要的支持文件；
- 只有实际需要字段、Contract、Mapping、模板或脚本行为时才读取对应文件；
- 不建立多层深链式引用，避免 Agent 为找到一个规则连续打开大量文件。

---


### 7.4 Skill 应该保存什么

#### 7.4.1 SKILL.md 中适合保存

##### Preconditions / Inputs（前置条件 / 输入）

例如：

```text
需要哪些输入
输入来源是什么
必需工具 / 权限是否可用
开始前必须满足什么条件
```

##### Approach / Procedure（方法与必要步骤）

只保存完成任务所必需的执行步骤，例如：

```text
读取什么
调用什么能力
执行什么动作
何时进入下一步
```

Approach / Procedure 应区分 **必要顺序** 与 **专业自主路径**，描述到 **Agent 可以正确执行** 的粒度，不应把确定性算法逐行翻译成自然语言。

如果一段逻辑具有：

```text
输入明确
规则明确
结果有限
可以程序化
```

应优先复用已有可靠 API State / Tool / Script / Gate / Route；只有需要新增确定性计算、强制保护或安全副作用控制时，才增加 Script / Gate / Route。`SKILL.md` 只说明：

```text
什么时候调用
输入什么
如何解释结果
失败怎么办
```

##### Validation（校验）

定义完成标准，例如：

```text
Artifact 是否存在
Evidence 是否完整
Schema 是否有效
Test 是否通过
Gate 是否 PASS
Completion Criteria 是否满足
```

##### Output（输出）

定义最终交付契约，例如：

```text
Artifact
Runtime / Handoff Fact
Issue Comment
Metadata Update
Status Change
PR / Verification Report
```

##### Error Handling / Stop Conditions（错误处理 / 停止条件）

只定义方法自身的异常处理：

```text
可重试错误如何处理
单项失败是否继续
何时 FAIL
何时 UNKNOWN
何时停止
何时交给 Human / Delivery Lead
```

#### 7.4.2 支持文件中适合保存

| 内容 | 推荐位置 |
|---|---|
| 环境参数、Project / Squad ID、可配置策略 | `config/` |
| Gate、Validate、Route、Sync 等确定性逻辑 | `scripts/` |
| API Contract、Metadata Schema、Repository Mapping | `references/` |
| Analysis / Verification / Handoff 输出模板 | `templates/` |
| 确定性行为回归验证 | `tests/` |

Skill 内部的 `config/`、`scripts/`、`references/` 等文件应以 Skill 根目录为基准定位，不依赖进程当前工作目录；外部配置路径应明确输入来源。

原则：

> **SKILL.md 描述方法；支持文件承载细节和实现。**

---


### 7.5 Skill 不应该承担什么

生成或更新 OpenSpec Artifact 的 Skill 应按 [§3.4 Skill 与 Artifact Contract 的协作边界](#skill-artifact-contract-boundary) 消费当前 Artifact Instruction / Template，而不是在 SKILL.md 另写一份产物内容规则。

Skill 不应该重复定义已有的角色职责、公共规则或权威流程：

```text
你是谁
你的长期职责是什么
谁是你的长期 Owner
其他位置已维护的研发流程规则
Workspace 全局规则是什么
某个 Issue 本次具体要做什么
```

上述 Agent 身份与长期职责边界属于 Agent Instructions；当前任务属于 Issue；公共规则属于 Workspace / Project Context；已有确定性状态转换属于 Gate / Route / Script。

#### 7.5.1 SKILL.md 默认不应包含

```text
历史沿革
版本迁移过程
方案比较
设计讨论
为什么当初这样设计
旧方案为何废弃
架构背景介绍
CHANGELOG
完整 API / Schema 文档
大段 CLI 帮助
环境配置值
可程序化算法的自然语言展开
与当前 Procedure 无关的大量示例
```

这些信息即使有保存价值，也应进入 Design Doc、ADR、Git History、CHANGELOG、`references/`、`config/` 或 `scripts/`，而不是放在执行入口中。

#### 7.5.2 不要重复 Agent（智能体）身份

不要在每个 Skill 开头重复：

```text
你是 Delivery Lead……
你的职责是……
你不能……
```

方法自身的限制与停止条件仍然必须保留，例如：

```text
本发布方法不得跳过发布前检查。
```

这是 Method Constraint，不是 Agent Role。

#### 7.5.3 不要维护第二套 Workflow（工作流）

可复用流程可以由 Skill 承载；已有权威 Route / Gate / Workflow 定义时，Skill 只描述如何调用或使用，不复制一套相同状态机。

尚未程序化且确实属于该 Skill 的流程，可以暂时由 Skill 作为唯一规则来源；后续迁移为确定性实现后，应删除重复的自然语言算法，只保留调用和结果处理说明。

#### 7.5.4 写作风格

Skill 应直接进入执行契约：

```text
Inputs
→ Procedure
→ Validation
→ Output
→ Error Handling
```

避免使用大量说明性提醒：

```text
注意……
再次注意……
特别提醒……
务必牢记……
```

应改成可执行约束：

```text
必须……
不得……
仅当……才……
如果……则停止……
FAIL 时不得继续……
```

可以程序化保证的约束，应优先进入 Script / Gate，而不是依赖 LLM 记住提醒。

---


<a id="section-8"></a>

## 8. Multica Autopilot Prompt（自动驾驶提示词规范）

### 8.1 定位

Autopilot Prompt 是：

> **Run Intent / Trigger Contract。**

它回答：

```text
为什么触发这次 Run？
这次 Run 要完成什么？
使用哪个 Skill / Capability？
做到什么程度可以结束？
```

Autopilot Prompt 不承担 Agent Role、Skill Procedure、配置参数或确定性流程实现。

这属于本项目的工程约定，不代表 Multica 官方规定了固定的 Autopilot Prompt 模板。

---

### 8.2 Autopilot Prompt（自动驾驶提示词）只维护四类信息

Autopilot Prompt 原则上只维护以下四类内容：

#### 8.2.1 执行目标

说明本次自动运行要完成什么工作。

例如：

```text
执行一次 TFS Work Item 同步。
```

#### 8.2.2 使用哪个 Skill（技能）

仅当本次 Run 对应明确、固定的方法场景时指定 Skill；开放式专业任务应由 Agent 根据任务和已绑定 Skill 的 Description 按需选择，不要求 Autopilot 预设固定 Skill 链。

例如：

```text
执行 `tfs-sync` Skill。
```

#### 8.2.3 本次 Run（运行）的边界

只描述本次自动运行必须停在哪里，不复制完整 Workflow。

例如：

```text
仅按配置将 TFS Work Item 同步至 Multica Issue，记录已确认的同步结果与异常；不扩大本轮同步范围。
```

#### 8.2.4 最终交付要求

说明 Run 结束时需要输出什么。

例如：

```text
输出同步汇总以及必要的失败、冲突信息。
```

因此推荐模板：

```text
完成 <本次执行目标>。

<固定方法场景时：使用指定 Skill；开放任务时：由 Agent 按适用条件选择方法。>

本次运行边界为 <停止边界>。

最后输出 <交付结果>。
```

Autopilot Prompt 通常应保持很薄，推荐约 2～5 句话即可表达完整 Run Intent。

---

### 8.3 Autopilot Prompt（自动驾驶提示词）不应该维护什么

不要在 Autopilot Prompt 中重复维护：

```text
Agent 长期职责和边界
完整 Workflow
具体 Procedure
CLI 命令
脚本调用细节
WIQL / API 查询细节
Collection / Project 等环境配置值
Metadata Schema
幂等状态表
Gate 判断算法
Agent Routing Table
当前 Issue 的详细 AC
```

这些内容分别属于：

```text
Agent Instructions
Skill
Config
Script / Gate / Route
Issue
```

判断原则：

> **如果 Skill 的实现方式、脚本名称、CLI 参数或环境配置变化后，Autopilot Prompt 也必须跟着修改，通常说明 Prompt 写得过深。**

---

### 8.4 Autopilot Prompt（自动驾驶提示词）与其他层的关系

统一采用以下职责模型：

| 层 | 回答的问题 | 典型职责 |
|---|---|---|
| Autopilot Prompt | 为什么触发这次 Run、这次 Run 要完成什么 | Trigger / Run Intent |
| Squad | 哪些 Agent 一起工作 | Collaboration Unit |
| Squad Instructions | Leader 如何组织协作、交接和升级 | Leader-executed Collaboration Contract |
| Agent Instructions | 我是谁、负责什么、在哪里停止 | Role Contract |
| Skill | 这一类工作具体怎么做 | Execution Method |
| Config | 当前环境和可配置参数是什么 | Parameters |
| Script / Gate / Route | 可以确定性判断和执行什么 | Deterministic Execution / Control |
| Multica | 当前真实执行状态是什么 | Issue / Status / Stage / Run State |

进一步浓缩为：

```text
Autopilot = Trigger / Run Intent
Squad = Collaboration Unit
Squad Instructions = Leader-executed Collaboration Contract
Agent Instructions = Role
Skill = Method
Config = Parameters
Script / Gate / Route = Deterministic Execution
Multica = State
```

其中 LLM 只承担需要语义理解的部分：

```text
LLM = Semantic Reasoning
```

Autopilot Prompt 不应成为另一个 Workflow Prompt，也不应复制 Skill。

---

### 8.5 与 Issue（事项）的区别

Autopilot Prompt 描述的是：

```text
这一类定时 / 自动 Run 为什么被触发，以及运行边界是什么。
```

Issue 描述的是：

```text
这一次具体工作对象的 Goal / Context / Source Requirement
+ 必要的 OpenSpec Engineering Contract Reference。
```

Canonical Engineering Acceptance Contract 由 OpenSpec 持有；Issue 不复制 Requirement / Scenario 等工程契约正文。因此不要把某个具体 Work Item 的需求内容、Repository、Acceptance Contract 正文或一次性指令写进 Autopilot Prompt。

---

### 8.6 Review Checklist（评审清单）

Review 一个 Autopilot Prompt 时检查：

- 是否明确了本次 Run 的目标？
- 是否明确引用了对应 Skill / Capability？
- 是否明确了停止边界？
- 是否明确最终输出？
- 是否复制了 Agent Instructions？
- 是否复制了 Skill Procedure？
- 是否写死环境配置值？
- 是否包含 CLI / Script 实现细节？
- 是否把 Autopilot Prompt 写成了 Workflow Engine？

原则：

> **Autopilot Prompt 负责触发意图，不负责实现流程。**

---

## 9. Cross-System Rule Ownership & Decision Boundaries（跨系统规则与决策边界）

### 9.1 规则归属、执行方式与跨 Run 交接

后续设计时，应分别判断“规则归属”和“执行方式”，两者不是互斥选项。

<a id="section-9-1-1"></a>

#### 9.1.1 规则归属：在哪里定义、由谁维护

| 内容性质与适用范围 | 定义位置 |
|---|---|
| 所有 Agent 长期需要的公共约定 | Workspace Context |
| 某个 Project 共享的目标与约束 | Project Context |
| 哪些 Agent 组成长期协作单元 | Squad |
| 由 Leader 执行的成员协作、交接与升级原则 | Squad Instructions |
| 某个 Agent 的长期职责与边界 | Agent Instructions |
| 某类工作可复用的方法与流程 | Skill |
| 当前 Issue 特有的目标、要求与 Source Requirement / Delivery Context | Multica Issue |
| 某个 OpenSpec Artifact 的生成语义、内容边界与禁止事项 | OpenSpec Schema `instruction` |
| 某个 OpenSpec Artifact 的输出结构 / Markdown shape | OpenSpec Artifact Template |
| 后续角色长期消费的 Engineering Truth | 对应 OpenSpec Artifact / 明确 Supporting Artifact |

选择与规则内容和适用范围相符的位置作为权威定义；其他位置可以引用，不独立维护重复版本。

在 Squad 场景下进一步约定：

```text
单个 Agent 的长期职责
→ Agent Instructions

Leader 执行的跨成员协作原则
→ Squad Instructions

Member 自身必须履行的职责与交付义务
→ 该 Agent Instructions / 绑定 Skill

专业执行方法
→ Skill

机器可确定的状态转换
→ Gate / Route / Script

当前任务要求
→ Multica Issue

某个 Artifact 应表达什么、避免什么
→ OpenSpec Artifact Instruction

某个 Artifact 最终长什么样
→ OpenSpec Artifact Template

某类专业工作如何分析 / 执行
→ Project Skill / Method
```

#### 9.1.2 执行方式：如何执行或验证

| 判断性质 | 执行或验证方式 |
|---|---|
| 输入和规则明确、可以程序化的检查或路由 | Deterministic Gate / Guard / Route / Script |
| 需要语义理解和上下文判断 | Agent Semantic Decision |
| 明确要求人工批准或必须由人决定 | Human Decision |

例如，Project Context 定义“交付必须通过验证”的要求，Gate 承担相应检查，Agent Instructions 引用该要求并约束 Agent 不得绕过检查。它们分别承担规则定义、程序检查和角色约束，不应各自重写一套判断标准。

规则的权威来源按 [§9.1.1](#section-9-1-1) 确定；是否以及如何程序化，由对应实施方案决定。

Agent Description 不参与上述规则归属与执行方式判断。

因为 Agent Description 只负责：

```text
让人知道这个 Agent 是做什么的。
```

---

#### 9.1.3 可恢复副作用与返工

Script 的确定性不等于重复调用无副作用，更不等于跨系统原子事务。按以下最小规则设计：

- 恢复先查询权威事实；重新检查必要 Guard，跳过已确认完成的副作用，只补未完成项。部分成功可以保留，不默认补偿回滚。
- 能从外部对象、Artifact 引用或当前 API 状态确认的结果不另建步骤状态表；确需恢复标记时复用现有任务记录和最小 pending 事实，不复制完整生命周期。
- 一个脚本调用有界执行并返回；调度与重试由原生 Runtime / 既有自动化驱动，不在脚本里长期等待或创建另一套 Workflow Runtime。
- 任务重开与执行启动分开；先准备修正输入，再使用一个原生触发入口。正常返工复用原工作对象、Owner 和已批准边界，不创建重复任务。
- 状态写入须明确负责的 Agent / 方法及有限权限，Gate 返回不等于写入完成；分别确认产物、状态与后续派发结果。仅为一次已授权写入不必新增协调 Run；失败或超时先回读，不覆盖后续人工操作或重复派发。
- 旧 Evidence 保留其原版本含义，不自动证明新候选成果通过；只重做受影响范围和必要回归。语义变化超出批准范围时升级，不以返工替代审批。

副作用排序、完成后置条件、具体状态键和返工命令由领域方案 / 对应 Skill 定义，本规范不复制 Delivery 的状态机。

#### 9.1.4 跨 Run（运行）交接与成本边界

Workitem Analyst 与 Engineer 保持不同 Agent / Run。必要分析产物的写入、批准基线持久化、接收方读取当前版本及其职责内的独立判断，属于多角色交接的正常成本；不能以 Token / 时间优化为由合并角色、取消必要证据、假定会话自动共享或压缩掉审核信息。

交接应提供当前工作对象、批准依据、权威产物位置、适用版本 / 修订范围、当前 `task_refs` / Tasks 与验证要求。文件必须在接收方的授权环境中可访问，不以仅属于另一个 Run 的临时目录作为唯一来源。已登记、可跨 Run 持续读取的共享工作区可以按领域契约保存受控的未提交修改；接收方必须区分已提交批准基线、当前受控修改与最终 Git 持久化，不把文件写入成功当作 Git Commit。共享内容丢失或关键 Evidence 不可读时停止自动推进，由相应协调角色处理恢复，不凭旧完成结果重建进度。同一资料被不同角色按职责读取，不自动等于重复分析。Delivery 的提交时点与最终收口规则由 [02 §6](02-multica-delivery-lifecycle-design.md#human-analysis-review) 和 [§12.4](02-multica-delivery-lifecycle-design.md#final-completion) 维护。

优化对象是同一详细内容的多份维护、无新事实的整轮重做、无关历史和全量文档加载、重复派发，以及仅为文档包装 / 机械收口新增的专业接力。正常角色交接和实际有价值的专项审查仍然保留；不设置通用的 Run 数或文档长度硬上限。

评估新增机制的成本时，以保留相同角色、批准与工程质量要求的流程为对照，分别观察 Run、模型请求、工具调用、输入 / 缓存 / 输出用量、主动执行时间与等待 / 返工时间。使用既有遥测，不新增 Token Gate 或以成本指标绕过执行契约。具体产物深度和可合并的工具步骤由领域 Skill 定义，原生方法要求的当前文件核对不能省略。


### 9.2 LLM Decision 与 Deterministic Decision 边界

对于当前 Multica 架构，进一步统一如下。

#### 9.2.1 Deterministic Decision（确定性决策）

满足以下特征：

```text
输入明确
规则明确
结果有限
可以程序化
不需要理解模糊语义
```

例如：

```text
provider_status == completed
当前候选成果对应的 Verify result == PASS
所有 required child issue 的完成状态与有效 Evidence
required fields 是否存在
repository → engineer role mapping
```

应该由：

```text
Gate
Guard
Route
Script
API State
```

处理。

不要让 LLM 再判断一次。

---

#### 9.2.2 LLM Semantic Decision（LLM 语义决策）

适用于：

```text
人工自然语言意见表达什么决定、附加条件、修正方向及是否需要再次确认
需求是否发生实质变化
PR Feedback 是否推翻原 Analysis
Finding 属于哪个 Task Set / Runtime Projection
多个 Task 是否存在语义冲突
是否需要重新拆分任务
失败 Evidence 能否可靠归因
```

这些语义问题由相应专业 Agent 或 Leader 根据职责处理；Agent Instructions 定义长期判断与停止原则，具体分析方法属于 Skill。

---

#### 9.2.3 结果语义与人工决定

Gate 的 `FAIL` 表示明确不满足条件，由该 Gate 定义等待、返工、停止或恢复，不统一解释为重跑。`UNKNOWN` 表示无法可靠判断，不授予 Agent 绕过 Human Approval 的权限。

Human 作出审核决定；自然语言意见的意图、条件和修正方向由负责该协作的 Agent 结合原文与当前上下文理解，方法归属现有 Skill。不先要求脚本识别关键词，也不要求语义理解必须等待确定性失败；明确采用结构化操作协议的独立场景仍按该协议校验，但不得把自然语言默认当作这种协议。

评论没有表达流程动作时使用 `NO_ACTION`；普通问题可以回答。只认可方向、附有未满足条件或要求再审，不自动等于允许进入下一阶段；意图、来源或条件不清先澄清，不自动将 Issue 置为 `blocked`。引文、历史评论和 Agent 自述不能充当新的 Human 批准。

语义理解形成的摘要或 JSON 是执行输入，不会因此成为确定性审核事实。保留真实人工来源及必要上下文；工具只校验可确认的身份、权限、当前状态、前置条件和写入结果，不能保证模型解释必然正确。具体状态与权限由领域方案定义，不新增通用评论解析器、审批状态表或固定文本口令。


### 9.3 Multica Agent / Squad Instructions 不复制 Workflow

这是本规范最重要的工程原则之一。

#### 错误方式

在 Agent Instructions 或 Squad Instructions 中完整维护：

```text
Analysis PASS
→ Create Development Issue
→ Engineer
→ Verify
→ FAIL
→ Engineer
→ Verify
→ PASS
→ PR
→ Review
→ Merge
→ Required Verification（按需 Independent Verify）
→ Completion
```

这相当于又用自然语言实现了一套 Workflow Engine。

最终系统会存在：

```text
Deterministic Workflow
        +
Prompt Workflow
```

两套状态机。

随着流程演进，两者极容易发生漂移。

---

#### 正确方式

Agent Instructions 描述长期职责、工作方式、决策边界与交付要求，Squad Instructions 描述由 Leader 执行的协作原则；两者都不复制完整交付 Workflow。例如：

```text
Delivery Lead 在当前负责的 Issue 上组织专业协作，
不重复 Specialist 已完成的专业判断。

已有可靠 Gate / Route 结果时按结果处理；
无法归因、事实冲突或无法安全推进时协调 Specialist / Human。
```

具体：

```text
PASS 后去哪
FAIL 后去哪
需要哪些字段
Issue 如何变状态
下一 Agent 是谁
```

已有业务硬条件由对应 Gate / Script 统一定义，Skill 描述调用与结果处理，不维护副本。简单固定的成员分工可由 Squad Instructions 作为唯一协作规则来源，并使用原生派发，不必为每次交接创建独立 Route 脚本。

尚未程序化的流程可以由 Skill 承载，并作为该流程的唯一规则来源；后续程序化时，应将规则统一迁移到 Gate / Route，Skill 保留调用说明和必要引用。

---


## 10. Anti-Patterns（常见反模式）

### 10.1 Super Prompt（超级提示词）

一个 Agent Instructions 写数百行，同时包括：

```text
角色
流程
Skill
工具说明
场景手册
Workflow
状态机
模板
Reference
```

应拆层。

---

### 10.2 Workflow-as-Prompt（将工作流写成提示词）

通过大量：

```text
IF A THEN B
IF B THEN C
```

让 LLM 模拟状态机。

应该优先迁移至 Deterministic Gate / Route。

---

### 10.3 Skill-as-Agent（把 Skill 当 Agent）

Skill 中大量写：

```text
你是谁
你的职责是什么
你不能做什么
```

如果这些内容重复定义 Agent 的身份与长期职责，说明 Agent Instructions 和 Skill 边界混乱。方法自身的限制与停止条件仍应保留在 Skill。

---

### 10.3.1 Goal-as-Procedure（将目标误写成执行步骤）

Agent 的 Goal 不等于本次任务清单；Skill 的 Capability Outcome 也不能替代 Agent 的完整专业目标。不得以“必须先调用 A、再调用 B、最后调用 C”定义专业成功；真正不可交换的授权与副作用顺序仍由唯一 Owner 维护。

---

### 10.4 Task-as-Instructions（把任务写进长期指令）

将某一个具体需求、本次临时操作的 Repository、Source Requirement 或本次 OpenSpec Acceptance Contract 写进 Agent Instructions。

本次 Goal / Context / Source Requirement 应放入 Issue；Canonical Engineering Acceptance Contract 由 OpenSpec Engineering Truth 持有，Issue 只保存必要引用。仓库上下文按适用范围放入 Issue 或 Project Context。若某个 Agent 长期负责特定 Repository，则该仓库范围可以作为 Agent Instructions 的职责边界。

---

### 10.5 Squad-as-Agent（把 Squad 当 Agent）

把 Squad 当成一个普通 Agent，并让它同时承担分析、研发、验证等所有专业职责。

错误示例：

```text
Delivery Squad 是一个 Agent，
负责分析、编码、验证和关闭任务。
```

正确关系：

```text
Delivery Squad
= 多 Agent 协作单元

Delivery Lead
= Agent；在 Delivery Squad 中承担 Leader 关系

Workitem Analyst / Backend Engineer / Frontend Engineer / Flink Engineer / Verify Agent
= Delivery Squad Member Agents
```

### 10.6 Leader-as-Workflow（把 Leader 当工作流）

在 Leader Agent Instructions 中完整维护整个研发状态机，例如：

```text
Analysis → Review → Development → Verify → PR → Merge → Completion
```

这样会把 Leader 演化成 Prompt-based Workflow Runner。

正确方式：

```text
Delivery Lead Instructions
= Leader 的职责、边界和语义介入原则

Squad Instructions
= 成员协作原则

Skill
= 专业执行方法

Gate / Route
= 确定性状态转换
```

### 10.7 Skill-as-Design-Document（把 Skill 当设计文档）

把 `SKILL.md` 写成设计文档，例如包含：

```text
背景
历史方案
设计理由
方案比较
版本演进
未来规划
```

这会让执行入口被说明性内容淹没。

正确方式：

```text
SKILL.md
= 当前可执行方法

Design Doc / ADR / Git History
= 为什么演进成当前方法
```

原则：

> **Skill 说明现在怎么做，不负责解释方案是怎么讨论出来的。**

---

### 10.8 Reminder-Pile（提醒堆积）

在 Skill 中不断追加：

```text
注意……
重要……
再次强调……
千万不要……
```

说明约束没有被结构化。

应优先改写为明确 Constraint / Stop Condition；可以确定性检查的规则进一步迁移到 Script / Gate。

---

### 10.9 Reference-in-SKILL（在 SKILL 中堆叠参考资料）

把完整 Metadata Schema、API 字段、Repository Mapping、CLI 帮助或大量 Contract 直接复制进 `SKILL.md`。

正确方式：

```text
SKILL.md
→ 说明何时需要该知识
→ 引用对应 references 文件
```

详细资料按需读取，不应成为每次 Skill 执行的默认上下文。

---

### 10.10 Implicit Squad Inheritance（隐式继承 Squad 规则）

把仅提供给 Leader 的 Squad Instructions 当成 Member 的自动执行契约，或认为加入 Squad 就继承 Skill / 权限。

必须检查实际接收者；Member 的职责放自身 Instructions，方法放绑定 Skill，当前要求放 Issue / Comment。不要用每次派发复制整份配置来补救。

---

### 10.11 Bare Cross-System Term（跨系统裸术语）

在同时讨论 Multica 与 OpenSpec 的章节中直接写：

```text
Instructions
Context
Status
Task
Validation
```

但不说明 Owner，容易把 Runtime Contract 与 Engineering Contract 误认为同一对象。

正确方式：

```text
Multica Agent Instructions
OpenSpec Artifact Instruction
Multica Project Context
OpenSpec Project Context / Rules
Multica Issue Status
OpenSpec Artifact State
OpenSpec Task
OpenSpec Validation
```

单一系统章节在 Scope 已明确后可以使用短名；跨系统引用必须遵守 [§1.4.6](#section-1-4-6)。

---

### 10.12 Duplicate Rules（重复规则）

同一条规则在以下位置分别独立定义、维护：

```text
Workspace Context
Agent Instructions
Skill
Workflow
```

后续容易出现版本漂移。

原则：

> **One Rule, One Owner。**

即一条规则只有一个权威定义和维护归属，允许其他位置引用或使用从权威定义生成的摘要；不要求同一规则只能出现一次。

---


### 10.13 Template-as-Gate（将模板误作门禁）

六段式 Agent Instructions、Skill 的六问以及 Method 字段是推荐组织方式，不是 Multica 原生 Schema。若长期职责、工作方式、方法资料与必要约束已经充分，不得仅因缺少独立 `Goal`、`Validation` 或其他标题而判 FAIL。Review 应检查执行充分性和风险，而不是章节数量。

### 10.14 Pseudo-Reuse & Forced Skill Chain（伪复用与固定 Skill 链）

不得仅因一个阶段步骤创建独立 Skill，或把“必须有多个 Agent 使用”当作 Skill 注册门槛；不得强制串行调用全部候选专业方法，也不得将 Method 的内部组织方式误认为 Multica 原生 Runtime 对象。复用价值应由实际场景、加载成本、维护收益与可靠绑定事实共同判断。

---

## 11. Unified Review Checklist（统一评审清单）

以后新增或 Review 任一 Multica 配置资产时，先检查：

### 11.1 全局

- 新增事实是否先判断为 Engineering Truth 或 Delivery Truth，并放入对应权威 Owner？
- 跨系统内容中的 `Instructions / Context / Status / Task / Validation` 是否使用 Owner Prefix，避免把 Multica 与 OpenSpec 对象混为一体？
- 是否把 `Multica Agent Instructions` 与 `OpenSpec Artifact Instruction` 明确区分，而不是抽象成一套统一 Prompt？
- Engineering Truth 是否优先落入 OpenSpec / canonical Supporting Artifact，而不是复制到 Multica 形成第二份技术契约？
- Delivery Truth 是否优先使用 Multica 原生 Runtime Fact，而不是为交接新增第三套 Contract Store / Runtime Object / Workflow State？
- 执行资产是否只描述当前目标状态，没有历史兼容和版本迁移内容？设计文档的必要背景与历史区按 [§1.5.1](#design-document-scope) 分开检查。
- 是否只保留影响职责、决策、执行、验证、输出或停止条件的信息？
- 是否直接定义 Contract，而不是背景、设计过程、方案比较和解释？
- 是否存在删除后不影响正确执行的说明性内容？
- 是否先核实原生能力，而不是为简单交接或状态写入建立新的 Runtime / 事务 / 锁？

然后按资产类型检查：

### 11.2 设计文档

- 是否引用并遵循 [§1.2](#section-1-2) 的 Runtime-Centric Delivery + Artifact-Centric Engineering，而不是在局部方案重新定义另一套 Truth Model？
- 是否明确 Method / Artifact / Runtime Fact / View 的边界？
- Package 是否被误实现为新的 Domain Object 或重复的 `<package>.md`？
- Summary 是否只是渲染视图，而非第二个 Truth Source？

- 必要业务背景是否按设计理解需要保留，而非机械套用 `SKILL.md` 的长度要求？
- 主方案与阶段方案是否有明确权威归属；删除重复前是否确认原规则被完整覆盖？
- 摘要、模型图与正文是否一致，是否以精确引用替代独立规则副本？
- 历史摘要是否与当前规则分区，旧名称和版本引用是否只保留其历史含义？
- Multica 公共机制是否引用本手册的具体条目，而不是在各方案独立维护官方 URL 清单？
- 是否区分已核实官方机制、项目约定及未完成的安装版本验收？

### 11.3 Autopilot Prompt（自动驾驶提示词）

- 是否只描述 Run Intent，而不是实现流程？
- 是否明确执行目标、停止边界和最终输出？只有固定方法场景才指定 Skill，开放任务允许 Agent 自行选择。
- 是否没有复制 Agent Instructions / Skill Procedure？
- 是否没有写死环境配置和脚本细节？

### 11.4 Agent Description（智能体描述）

- 是否一句话即可理解 Agent 的用途？
- 是否没有承担执行约束？

### 11.5 Squad（小队） / Squad Instructions（小队指令）

- Squad 是否代表真实的多 Agent 协作单元？
- Leader 是否明确？
- Members 是否明确？
- 是否把 Squad 与 Leader Agent 混为同一个对象？
- Squad Instructions 是否只描述由 Leader 执行的协作、交接和升级原则？
- Member 必须执行的规则是否稳定进入其 Instructions / 绑定 Skill，而不是只对 Leader 可见？
- Role Description 是否仅作为 Leader 的成员选择上下文，没有被当作权限或 Member Instructions？
- 是否仅在 Issue Ownership 转移时使用 Assignment，并以 `@mention` 完成 Squad 内协作，避免重复触发？
- 是否把 Specialist 的专业 Procedure 写进 Squad Instructions？
- 是否复制了 Deterministic Route / Workflow？
- 是否为当前 Issue 的内部专业分工不必要地创建新 Issue 或切换 Assignee？
- 是否明确什么时候 Leader 才需要介入？
- 是否明确什么时候需要 Human Decision？

### 11.6 Multica Agent / Squad Instructions（智能体与小队指令）

- 长期职责与专业目标是否清楚（允许写入 Role，不强制独立 Goal 标题）？
- 工作方式是否描述每次需要的判断原则和必要检查，而非复制完整 Procedure？
- Core Responsibilities 是否只包含实现 Goal 的长期职责？
- Boundaries 是否明确？
- Execution Principles 是否稳定？
- Escalation 条件是否明确？
- Delivery 要求是否明确？
- 是否复制了 Workflow？
- 是否包含大量 Procedure？
- 每次必需的简短检查与详细 Skill 流程是否区分清楚？
- 是否包含当前 Issue 特有信息？
- 是否与其他 Agent 职责重叠？
- Specialist 直接接收 Issue 时是否具有完整执行契约，不依赖 Leader 的隐式转述？

### 11.7 Skill（技能）

- 生成 OpenSpec Artifact 时，是否读取当前 Change 的 Schema、Instruction、Template 与 Dependency，而非依赖 Skill 内静态文件清单？
- 是否把分析 / 调查步骤留在 Skill、内容质量要求留在 Artifact Instruction、Markdown 结构留在 Template，避免同一规则被多处独立定义？
- 条件性 Artifact、原生 Validation、专业 Review 与 Human / Delivery Gate 的边界是否清楚；冲突或上下文缺失时是否停止而非猜测？

- 是否把 Skill 名称错误地绑定为必须生成同名 Markdown？
- 是否把六段式 Agent Instructions 或 Skill 六问当作固定标题 Gate，而忽略同等充分的简洁结构？
- 输出是否优先更新已有权威 Artifact / Multica Runtime Fact，而非制造第二份 Requirement / Spec / Design / Review？

- 专业结果型 Skill 的 Capability Outcome 是否局部且不复制 Agent Goal？参考/规范型 Skill 不强制 Goal 或 Artifact。
- Skill 是否具有跨任务、跨 Agent 或独立场景的实际复用与维护价值，而非机械拆分？不以绑定 Agent 数量作为硬指标。
- `description` 是否同时说明 **What + When**，便于 Agent 按相关性选择加载？
- 是否核实实际 Workspace Skill 注册、Agent 绑定与启停状态，避免以仓库文件存在推断运行可用性？
- 是否提供当前方法所需的准备、输入与可用资料，能够正确开始工作？
- 是否依赖特定 Agent Runtime 的加载/物化机制、专属目录或进程当前工作目录？
- Approach / Procedure 是否区分不可交换的 Hard Constraint 与可按复杂度选择的 Recommended Method，而非固定串行专业思考？
- 当前方法是否需要独立 Validation / Completion Criteria？适用时是否可判定？
- 是否说明当前方法的结果如何使用或提交？需要交付时明确 Output Contract，不强制参考型 Skill 另建 Artifact。
- 是否说明适用的停止、求助与阻塞处理条件？涉及风险、副作用时明确 Error Handling 与恢复边界。
- 是否保留方法自身的限制，并避免重复 Agent Instructions？
- 是否没有复制 Workspace / Project 公共规则？
- 是否没有包含当前 Issue 特有信息？
- 是否没有维护第二套 Workflow / Route？
- 可确定逻辑是否尽可能由 Script / Gate / Route 承担？
- 环境参数和可配置策略是否进入 Config？
- Schema / API / Mapping / Contract 是否进入 References？
- 输出模板是否进入 Templates？
- 是否避免历史说明、方案比较、设计讨论和 CHANGELOG？
- `SKILL.md` 是否只包含正确执行该方法所需的最小充分信息？
- 删除任一说明性段落后，如果不影响正确执行，该段落是否应移出 `SKILL.md`？
- 含副作用的方法是否明确已成功、结果未知及部分失败的恢复方式，并复用既有对象身份？
- 返工是否保留批准边界，并区分旧 Evidence 与当前候选成果？

### 11.8 Workflow（工作流） / Gate（门禁）

- 可以程序化判断的事情是否仍交给 LLM？
- PASS / FAIL / UNKNOWN 是否明确，普通无动作评论是否避免被当成异常？
- Route 是否有唯一事实来源？
- 规则归属与执行方式是否分别明确，跨层引用是否指向同一权威定义？
- Prompt 中是否又维护了一套重复 Workflow？
- 是否区分原生运行去重、业务幂等与跨系统事务，且没有夸大保障范围？
- Gate PASS 是否与实际副作用完成分开确认，强制保护是否落实到受保护操作入口？
- 自然语言人工意见是否由相应 Agent 理解并保留来源，而非关键词匹配或以模型 JSON 冒充人工授权？
- 状态写入责任、有限权限、回读与失败恢复是否明确，等待审核是否避免被误解释为批准或完成？

---



## 12. Final Design Principles（最终设计原则）

本节总结 Multica + OpenSpec 组合架构中的资产职责与跨系统协作原则。具体规则以本规范对应章节及各领域权威方案为准，不在本节另建 Schema、Workflow 或状态契约。

**核心架构与事实归属：**

> **Multica = Delivery Truth（交付事实）；OpenSpec = Engineering Truth（工程事实）。**

两者通过稳定引用衔接，遵循 **Reference, not Replication（引用而非复制）** 与 **No Third Truth Store（不建立第三套事实源）**。

**Multica Runtime 资产职责：**

| 资产 | 核心职责 |
|---|---|
| Agent Description | Discoverability（识别与发现） |
| Workspace / Project Context | Shared Runtime Context（共享运行上下文） |
| Autopilot Prompt | Trigger / Run Intent（触发与本次运行意图） |
| Squad | Collaboration Unit（协作单元） |
| Squad Instructions | Leader-executed Collaboration Contract（Leader 协作与交接契约） |
| Agent Instructions | Persistent Role / Working Style / Boundary / Delivery（长期职责、工作方式、边界与交付） |
| Project Skill | Reusable Work Method Package（可复用步骤、资料、模板与工具） |
| Multica Issue | Delivery Work Context（交付目标、协作与运行上下文） |
| Run / Assignment / Status | Runtime Execution & State（运行执行与状态） |
| Config | Parameters（环境参数与配置） |
| Script / Deterministic Gate / Route | Deterministic Execution / Control（确定性执行与控制） |

LLM 负责需要上下文判断的 Semantic Reasoning（语义推理）；明确硬条件由相应确定性机制检查，人工批准仍归 Human。

**OpenSpec Engineering Contract 资产职责：**

| 资产 | 核心职责 |
|---|---|
| OpenSpec Change | Engineering Contract Container（工程变更契约容器） |
| OpenSpec Schema | Artifact Contract / Dependencies / Apply Prerequisites（工件契约、依赖与 Apply 前置） |
| Artifact Instruction | Artifact Generation Semantics（工件生成语义） |
| Artifact Template | Artifact Output Structure（工件输出结构） |
| Proposal / Specs / Design（按适用 Schema） | Engineering Rationale / Requirements / Design（工程依据、需求与设计） |
| `tasks.md` | Engineering Tasks / Verification / Progress（工程任务、验证与完成进度） |

**跨系统协作规则：**

- **Project Skill 消费当前 Change 的 Artifact Contract，不复制其内容标准。** 方法、内容语义、输出结构的具体协作及冲突处理见 [§3.4](#skill-artifact-contract-boundary)。
- **OpenSpec Task 属于 `tasks.md`，不属于 Multica Issue。** Multica 使用 `task_refs` 引用并分派工程工作，不因 Task 数量自动创建 Issue。
- **Multica Issue 承担交付运行与协作。** 默认在 Parent Issue 中通过 `@mention + task_refs` 协作；仅当 Task Set 需要独立 Owner / Status / Block / Retry / Completion / Stage 等持久运行状态时创建 Development Sub-Issue。
- **OpenSpec Artifact Readiness / Validation / Apply Ready 不等于 Multica Delivery Gate / Human Approval。** 两类检查分别履行工程契约与交付决策职责。
- **Multica Agent Instructions、Project Skill、OpenSpec Artifact Instruction 与 Artifact Template 不互相替代。** 角色约束、工作执行方法、工件生成语义及输出结构各有权威 Owner。

**全局设计原则：**

- **Native First**：优先复用平台原生能力，不无必要地创建第二套 Runtime。
- **Specialist Focus**：Squad 成员聚焦分析、研发、专业验证与协作决策；TFS 管理、PR 状态巡检等支撑性确定性操作外置，不将外部管理字段或故障恢复变成专业 Skill 的默认义务。
- **Outcome First, Bounded Autonomy**：强制遵守批准、安全、必要质量与副作用门禁；专业结果明确，调查路径、工程方法和内部顺序由 Agent 在授权范围内自主选择。
- **Greenfield First**：执行资产描述当前目标状态；确需兼容时明确范围。
- **Minimal Sufficient**：仅保留正确执行、验证和交付所需信息。
- **Contract First**：明确职责、输入、规则、输出与停止条件。
- **One Rule, One Owner**：每条规则和权威事实由唯一 Owner 维护。
- **Reference, not Replication**：跨资产和跨系统通过引用关联，不复制权威正文。

**专业方法与产物原则：**

- **Method 是可选工程技巧的组织方式，并非 Multica 原生独立对象**；可以作为 Skill 的内部方法或按需引用，确有独立复用与维护价值时可提升为 Skill。Engineering Truth 属于对应 OpenSpec Artifact 或明确 Supporting Artifact；Delivery Truth 属于 Multica Runtime Facts。
- `SKILL.md` 只保留适用任务的最小充分指导；Skill Description 说明 **What + When**；Procedure 可说明可复用操作步骤，Script / Gate 承担需要确定性保证的逻辑；资料、模板和脚本按需加载。参考型 Skill 不强制独立 Goal、Artifact 或 Validation 标题。
- Evidence 保留在对应 Artifact 或明确引用中；Package 只是事实的逻辑集合，Summary 只是呈现视图，不新增 Truth Source。
- 删除重复文档不得删除原有的执行、验证或交付契约。

以上作为 Multica + OpenSpec 组合架构、配置资产及研发交付方案的统一设计和评审边界。

---



<a id="official-reference-policy"></a>

## 附录 A. 官方机制与来源引用规范

### A.1 集中维护范围

Multica 公共机制的准确含义、官方 URL、来源支持范围和核对信息，由本手册统一维护。主方案与阶段方案引用具体机制条目，不各自维护第二套原生行为说明或 URL 清单。

各方案继续维护自己的使用方式、职责、授权、输入输出、执行约束、停止条件与验收要求；集中官方依据不意味着把 Delivery 状态机、专业 Procedure 或所有运行日志移入本手册。OpenSpec 等专业方法来源由对应领域文档维护，并遵循同一引用规范。

### A.2 何时必须引用

设计依赖平台的实际接收者、触发、Ownership、状态分类、权限、执行、回流、取消、恢复或版本参数时，在首次定义依赖或关键使用处引用本手册的具体条目。仅在文件头笼统写“遵循本手册”不能替代关键机制的来源定位。

保留正确执行所需的短约束和必要摘要，不把 Skill 写成链接清单；无须每次 Run 预读整份手册或整站文档。使用稳定标题 / 显式锚点，优先直接到达权威条目，避免多层深链。

示例：

```markdown
状态提交使用安装版本已验证的请求级暂不启动能力；
发布与状态分别回读确认，失败时不得报告提交成功。
原生行为见 [Assignment 与启动](01-multica-openspec-design-guideline.md#mechanism-assignment)。
本项目的提交权限与具体步骤由 Analysis 阶段方案维护。
```

### A.3 来源类别与结论边界

| 类别 | 如何写 | 不得推导为 |
|---|---|---|
| 官方操作手册 / API 文档 | 说明来源直接支持的能力及条件 | 所有安装版本已支持、项目场景已验收 |
| 官方公开实现 | 记录文件、函数 / 范围及实际核对的 tag / commit；尚未锁定时明确标注 | `main` 永不变化，注释等同所有运行路径 |
| 本项目约定 | 明确哪些角色、授权或业务条件由本项目定义，并指向其 Owner | 官方规定了本项目流程或模板 |
| 版本前提 / 待验证项 | 说明需确认的能力和不满足时的停止方式 | 已经部署、已经测试通过 |
| 本地运行证据 | 记录环境、版本、操作、实际结果与日志引用 | 超过该场景和版本范围的普遍保证 |

优先采用准确且与所述行为相符的官方手册；只有手册不足以支持必要实现细节时再引用公开实现。来源内容或版本不一致时，不拼接成不存在的统一行为；保留差异并要求核对安装版本。不能用官方“支持自定义状态”证明本项目已经实现人工审批，也不能用 `--no-start` 证明整棵任务树被锁住。

### A.4 核对信息与版本验收

来源条目至少维护：机制用途、官方页面 / 源码链接、核对日期、结论范围及是否需要本地验收。依赖源码细节的长期契约应锁定实际核对的 release tag 或 commit；未获得固定版本时明确“未锁定，仅供检索与核对”，不得填入猜测的 SHA。

文档核对与安装验证分别记录。适配验收应覆盖实际 CLI / Server 版本、Workspace / Agent 权限、触发入口、预期与实际 Run / Status 结果；本手册可保存已验证适用范围和验收记录引用，详细日志留在对应实现的验收记录。

本版来源索引中的“2026-09-29 核对”仅表示公开资料核对，**不表示已在团队安装的 Multica 上运行测试**。本次未取得可确认的源码固定 commit；保留公开实现入口并标注该限制，不将其设为部署验收结论。

### A.5 维护与评审

平台升级、入口改变或发现实际行为不一致时，先更新本手册对应机制条目，再检查引用方案及实际 Skill 的影响。业务规则变化更新其领域 Owner，不因改一个平台链接而重写全部专业文档。

评审同时确认：URL 是否支持所述结论；版本和接收者范围是否准确；项目使用约束是否仍完整；实际执行者能否稳定获得自己的契约；摘要与权威条目是否漂移。

---



<a id="official-source-index"></a>

## 附录 B. 官方来源索引

本节只维护来源与支持范围，机制说明位于前文对应条目。所有外部页面按需查阅，不要求执行者逐一打开。本项目新增的文档分层、六段式 Instructions、Gate / Route 分工与审核流程不是官方固定模板。

| 来源 | 官方手册 / 公开实现 | 支持范围与核对信息 |
|---|---|---|
| <a id="source-agent-config"></a>Agent 配置 | [创建和配置智能体](https://multica.ai/docs/zh/agents-create) | [§2.1](#mechanism-agent-description)–[§2.2](#mechanism-agent-instructions)：Description 展示用途、Instructions 每次执行及职责 / 交付边界。2026-09-29 文档核对。 |
| <a id="source-skills"></a>Skills | [Skills](https://multica.ai/docs/zh/skills) | [§7.1](#mechanism-skills)、[§4.4](#section-4-4)：方法复用、显式绑定、Instructions 与 Skill 的边界。2026-09-29 文档核对。 |
| <a id="source-workspaces"></a>Workspace | [工作区](https://multica.ai/docs/zh/workspaces) | [§4](#mechanism-shared-context)：Workspace Context 的共享范围。2026-09-29 文档核对。 |
| <a id="source-projects"></a>Project | [项目](https://multica.ai/docs/zh/projects) | [§4](#mechanism-shared-context)：Project Description、资源和 Issue 上下文边界。2026-09-29 文档核对。 |
| <a id="source-squads"></a>Squad | [Squads](https://multica.ai/docs/squads) | [§4.2](#mechanism-squad)：Leader-first、Leader-only Instructions、Roster、Access 与协作边界；评论细节并读 [§2.7](#mechanism-comments)。2026-09-29 文档核对。 |
| <a id="source-assignment"></a>Assignment | [Assign issues to agents](https://multica.ai/docs/assigning-issues) | [§2.3](#mechanism-assignment)：Ownership、固定 Backlog、请求级暂不启动及不取消已有 Run。2026-09-29 文档核对。 |
| <a id="source-issues"></a>Issues / Status | [Issues](https://multica.ai/docs/issues) | [§2.4](#mechanism-issue-run)–[§2.6](#mechanism-parent-stage)：Issue / Run、自定义状态分类与 Key、Parent / Child / Stage。2026-09-29 文档核对。 |
| <a id="source-runs"></a>Runs | [Runs](https://multica.ai/docs/tasks) | [§2.4](#mechanism-issue-run)：运行记录、触发、结束、失败 / 重试与停止。2026-09-29 文档核对。 |
| <a id="source-comments"></a>Comments | [Comments](https://multica.ai/docs/comments) | [§2.7](#mechanism-comments)：评论、讨论、真实 Mention 与其非 Ownership 语义。2026-09-29 文档核对。 |
| <a id="source-mentions"></a>Mention / Reply | [Mention agents](https://multica.ai/docs/mentioning-agents) | [§2.7](#mechanism-comments)：普通回复路由、触发预览、连续评论合并及范围限制。2026-09-29 文档核对。 |
| <a id="source-cli"></a>CLI | [Using the CLI](https://multica.ai/docs/cli) | [§2.3](#mechanism-assignment)、[§2.8](#mechanism-cli-version)：命令入口、结构化输出及安装版本 `--help` 边界。2026-09-29 文档核对。 |
| <a id="source-autopilots"></a>Autopilot | [Autopilots](https://multica.ai/docs/autopilots) | [§2.9](#mechanism-autopilot)：自动触发入口；具体配置按安装版本验收。2026-09-29 文档核对。 |
| <a id="source-issue-trigger"></a>Issue trigger | [issue_trigger.go](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/service/issue_trigger.go) | `WillEnqueueRun`：创建 / 分配与状态提升触发的区分。2026-09-29 检视公开入口；未锁定 commit，不替代本地验收。 |
| <a id="source-child-done"></a>Parent / Stage | [issue_child_done.go](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/handler/issue_child_done.go) | `notifyParentOfChildDone`：终态 / Stage 条件与 best-effort 边界。2026-09-29 检视公开入口；未锁定 commit。 |
| <a id="source-squad-briefing"></a>Squad 注入实现 | [squad_briefing.go](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/handler/squad_briefing.go) | [§4.2](#mechanism-squad) 的公开实现追踪入口；未锁定 commit。手册结论与本地实际注入分别核对。 |
| <a id="source-cli-implementation"></a>CLI 实现 | [cmd_issue.go](https://raw.githubusercontent.com/multica-ai/multica/main/server/cmd/multica/cmd_issue.go) | 调查 `rerun`、状态与更新命令的公开入口；`main` 可变且检索版本可能滞后，参数以安装版 `--help` / API Contract 为准。 |

---

## 附录 C. 版本记录

### v1.16.11 Multica 原生 Agent / Skill 对齐（2026-11-04）

- 对齐 Agent Instructions 的长期工作方式与 Skill 的可复用工作方法语义；六段式、Capability Outcome 与 Validation 标题不作为形式性硬 Gate。
- 明确单 Agent 跨任务复用、合理业务依赖和绑定/启停事实；Method 不被提升为独立平台对象。
- 同步 Autopilot Skill 选择原则、Anti-Patterns 与 Review Checklist，不改变 Runtime / Gate / OpenSpec 契约。

### v1.16.10 Outcome First, Bounded Autonomy（2026-10-31）

- 在 §1.3 定义 Hard Constraint / Outcome Contract / Recommended Method 的约束分级；Agent 在授权边界内可自主选择专业方法，保持 Human Approval、Gate、Evidence 与确定性副作用硬条件不变。
- §7 和 §11 明确 Skill 中的专业步骤不是天然的强制 Runtime Workflow；§12 同步原则摘要。约束审计与待整改事项记录于现有交付优化计划，不建立新 Runtime/Gate。

### v1.16.9 Specialist Focus 专业聚焦原则（2026-10-31）

- 在 §1.3 新增 `Specialist Focus`：Workitem Analyst / Engineer / Verify Agent 聚焦专业产出，Delivery Lead 聚焦协调、授权与语义异常；TFS 管理和 PR 状态巡检等外部支撑工作由 Squad 外部确定性机制承担。
- 澄清专业必要的验证、Commit、PR 技术准备及交接仍属专业工作，Lead 可以按授权一次调用确定性入口，不为机械支撑新增 Agent / Run；§12 仅同步原则摘要。

### v1.16.8 Wayfinder 默认入口与例外（2026-10-13）

- 明确 Wayfinder 适用于自动 TFS 默认准入路径；显式直接委派的 Analysis 不强制先生成 Wayfinder Decision。统一 `/note` 读取契约由 02 §4.1.1 维护；不新增 Run 状态或 Gate。

### v1.16.7 Wayfinder Todo / Assignment Auto-Start（2026-10-13）

- 统一入口同步完成态为 `todo + Wayfinder`，`eligible` 后由 `rondo delivery handoff` 单次 Update 交给 `Bug Fix Agent` 或 `Delivery Squad`，通过原生机制启动对应 Run。
- 区分首次顶层 `/note` 和评论触发 Run 的线程内 `/note` 回复，并记录 WFP-8 隔离验证与真实环境待验收边界。

### v1.16.6 Wayfinder 流程示例同步（2026-10-13）

- 修正 TFS Sync Autopilot 示例的旧入口；Run 数量与准入交接以 02 主方案为准，不建立第二份流程说明。

### v1.16.5 Wayfinder Intake Triage（2026-10-13）

- 增加 Squad 外 Wayfinder Agent Canonical Name、准入 Decision 与 Issue Status 区分；交付流向由 02 维护。
- 约定 `/note` Comment 的原生 Evidence / Handoff 载体与回读顺序；Wayfinder 独立使用 `codebase-explorer`；Analyst 继续使用 `context-analysis`，跨 Agent 仅交接可复核的 Evidence References，不建立第三套 Truth Store。

### v1.16.4 Skill 与 OpenSpec Artifact Contract 协作规范（2026-10-12）

- 新增 §3.4，明确 Skill / Schema / Artifact Instruction / Template 的 Rule Ownership、运行时消费、条件性 Artifact、Validation 与冲突处理；用 Corrective Proposal 区分根因分析方法与最终产物契约。
- §7.5、§11.7 与 §12 只增加精确引用与评审条款，不复制 Schema YAML 或项目级执行流程。

### v1.16.3 简化原则与协作边界（2026-10-09）

- 以 v1.16.1 正文为基线，精炼 Native First 并在 §1.3 增加 KISS；轻量交付协调与原生回流执行规则由 Delivery 主方案维护。

### v1.16.1 Run / CLI Session 术语澄清（2026-10-09）

- §2.4 区分 Multica Agent Run 与底层 Claude / Codex CLI Session，不假设一一对应或已验证复用能力。
- Single-Engineer Happy Path 的 Run 示例与项目执行边界只保留在 Delivery 主方案 §2.3.1 / §3.1.1，避免跨文档复制流程真相；Wayfinder 引入后的当前数量以现行 02 为准。


### v1.15 结构整理（2026-10-08）

- 保留原“1. 目的”为 §1.1，调整总则顺序为目的、组合架构、全局原则、统一术语、文档归属与事实分类。
- 原 OpenSpec §1.6 升级为独立 §3；Skill 官方定位与项目 Skill / SKILL.md 规范合并到 §7；Agent Instructions 写作规范归并到 §6。
- Autopilot、跨系统规则、Anti-Patterns 和 Review Checklist 集中排序；官方来源和历史记录归入附录。
- 保留原有显式 Anchor、已确认的业务契约和实施级 Owner；本次不改变 Multica / OpenSpec 运行语义，也未执行真实平台测试。
- 修正 §9.1.2 规则权威来源的引用，由错误的 §9.3 改为 §9.1.1。
- 重写 §12 为 Multica Runtime、OpenSpec Engineering Contract 与跨系统协作三部分的最终原则摘要，明确 OpenSpec Task 与 Multica Issue 的归属以及 `task_refs` 关联。
- 保留原有架构、职责边界、审核与 Gate 规则；不恢复已主动删除的 Design Document Header，也不调整其他主章节结构。

### v1.15 变更摘要

- 文档升级并重命名为 `01-multica-openspec-design-guideline-v1.16.md`，正式定位为 Multica Runtime + OpenSpec Engineering Contract 的统一上位设计规范，而不是仅描述 Multica 配置。
- 新增 **Cross-System Namespace Rule（跨系统命名空间规则）**：跨系统章节对 `Instructions / Context / Status / Task / Validation` 等易歧义术语强制使用 `Multica` / `OpenSpec` Owner Prefix；单一系统章节在 Scope 明确后可继续使用短名。
- 明确 `Multica Agent Instructions ≠ OpenSpec Artifact Instruction`、`Multica Project Context ≠ OpenSpec Project Context / Rules`、`Multica Issue Status ≠ OpenSpec Artifact State`。
- 新增 **Artifact Instruction Assembly（工件指令装配）**：定义 OpenSpec Artifact Generation Context 的逻辑来源及与 Multica Runtime Context / Project Skill 的边界；不把 Agent Run 简化为单一 OpenSpec Prompt Compiler。
- §4 与 §15 明确为 Multica Runtime Context / 配置层规范；§16 补充 OpenSpec Artifact Instruction / Template / Engineering Truth 的规则归属；Anti-Patterns 与 Review Checklist 增加跨系统裸术语检查。
- 保持 `05-openspec-schema-implementation-design-v1.5.md` 作为项目级 Schema YAML、Template grammar、Task Contract、Validation / Archive 的实施级权威来源。

### v1.14 变更摘要

- 补充 OpenSpec 公共术语：`OpenSpec Artifact`、`Artifact Graph`、`Artifact Template`、`Artifact Instruction`、`generates`、`artifact.requires`、`apply.requires`、`apply.tracks`，明确它们与 Multica Runtime / Delivery Workflow 的边界。
- 新增 §1.6 OpenSpec 核心概念与原生机制，说明 Schema → Artifact Graph → Template / Instruction → status / instructions → Artifact generation → validation / apply readiness 的基本工作模型。
- 明确 Template 负责输出结构、Instruction 负责生成语义；二者均由 Schema 关联到 Artifact，不建立新的 Truth Source。
- 明确 `artifact.requires` 与 `apply.requires` 的不同职责，并再次区分 Schema Validate、Artifact Complete、Apply Ready、Analysis Gate、Human Approval 与 Development Ready。
- `§1.4 文档体系与权威归属` 增加 OpenSpec Schema 实施设计与 Method Skill Library 实施设计，05 正式拥有项目级 Schema / Template / Task / Apply / Validation / Archive 实施契约。
- 同步 Delivery 主方案引用到 v1.4.20；不复制 05 的 Schema YAML、Template Markdown grammar 或 parser-level 规则。

---

### v1.13 变更摘要

- 收敛 Acceptance Contract Ownership：Multica Issue 保存 Goal / Context / Source Requirement、讨论与 Delivery Facts，并通过稳定引用关联 OpenSpec；Canonical Engineering Acceptance Contract 由 OpenSpec Engineering Truth 持有，不在 Issue / Instructions / Autopilot 中复制正文。
- 明确 TFS / Issue 中的验收描述属于 Source Requirement / Input，经过 Analysis 固化后的 Requirement / Scenario 或 Corrective Expected Behavior / Regression Scope 才构成工程执行使用的权威验收契约。
- 同步最新 Delivery / Analysis / Development 文档引用；不改变 Agent / Squad / Skill / Gate 的既有职责边界。

---

### v1.11 变更摘要

- Canonical Engineering Truth 对齐 OpenSpec Native Acceptance / Verification Model：不再把独立 AC / Verification Requirements 作为默认领域对象；有 Specs 时以 Requirement + Scenario 表达 Acceptance Contract，验证执行要求由 `tasks.md` 承载。
- `OpenSpec Task` Canonical Definition 扩展为 Implementation Task 或按需 Verification Task；Verification Task 仍是 Engineering Truth，不是 Multica Runtime Object。
- `bug-analysis` 明确为 Method；Corrective 最终 Expected / Actual、Root Cause / Fix Strategy / Regression Scope 进入 `proposal.md`，不再把 `bug-analysis.md` 作为默认 Artifact。
- `Regression / Integration / E2E` 明确定义为 Verification Method；`Verify Agent` Canonical Role 收窄为 **Optional Independent Verification Executor**，不拥有验收标准，也不是固定阶段。
- Multica Delivery Truth 中保留 `verify_agent.required` 与 Independent Verification Result；该事实决定是否增加独立执行者，不复制 OpenSpec Verification Contract（验证契约）。
- Anti-Pattern、文档权威归属、Method / Artifact 边界与命名规则同步更新；其他 Multica 原生机制与 Instructions / Skill 写作规范不变。

### v1.10 变更摘要

- 将 **Runtime-Centric Delivery + Artifact-Centric Engineering** 提升为顶层信息架构原则，并明确其作为后续 Agent / Skill / Gate / Artifact / Handoff 设计的第一归属判断规则；本次同版本修订不改变版本号。
- 将 v1.9 的六类 Artifact taxonomy 收敛为 **Method / Artifact / Runtime Fact / View** 四类，避免术语与概念层过度扩张。
- 新增总原则：**OpenSpec = Engineering Truth，Multica = Delivery Truth**。
- `Structured Result` 不再作为独立架构层；跨阶段 Route / Review / Gate / Approval / Assignment / Verify Decision 优先映射到 Multica 原生 Issue / metadata / custom property / comment / run result。
- Supporting Evidence 归入 Artifact / Reference；Package 降为普通 read-set 概念，不成为 Domain Type。
- 明确禁止仅为交接创建拥有独立 schema / lifecycle / version / status / reconciliation 的中间对象。
- 本次仅更新设计规范，具体 Multica 字段映射与执行资产留待方案稳定后统一实现。

---

### v1.9 变更摘要

- 新增 Method / Artifact / Runtime Fact / View 的统一边界，明确 **Skill ≠ Artifact、Logical Package ≠ Markdown、Summary ≠ Truth Source**。
- 新增持久化文件判定规则：优先复用现有权威 Artifact / Runtime / Handoff Fact；只有下游确需长期读取且没有合适 Owner 时才新增文件。
- 明确删除重复文档不等于删除 Contract；AC、Verification Requirements、Review Findings、Route / Scope 等必要信息必须先有明确 Owner。
- Analysis / Development 跨 Run 交接优先组合Engineering Artifact、Multica Runtime Facts 与 Evidence References，不建立第二套 Requirement / Spec / Design / Plan。
- 文档与 Skill Review Checklist 增加“同名 Skill 是否错误绑定同名 Markdown”“Logical Package 是否被文件化”“Summary 是否形成第二 Truth Source”等检查。
- 文档权威归属同步到主方案 v1.4.14、Analysis v1.13、Engineer v1.9；Multica 原生机制、OpenSpec Schema 与实现资产本轮不变。

---

### v1.8 变更摘要

- 新增 Canonical OpenSpec Schema IDs：`corrective-change` / `intentional-change`，直接映射 Technical Change Kind；项目采用 kebab-case `<kind>-change` 双单词命名风格。
- 明确双单词是项目命名规范，不误写为 OpenSpec 对所有 Schema ID 的通用强制规则。
- 正式拆分 TFS Type、Technical Change Kind、Delivery / Analysis Route、OpenSpec Schema 四个维度；Schema 不再使用 `corrective` 或 Route 名 `sdd-fast` 作为正常 ID。
- 当前映射：`corrective` → `corrective-change` → `bug-fix | production-fix`；`intentional` → `intentional-change` → `sdd-fast`。
- 现有 `sdd` 保留已有 Change 兼容和 Full-SDD / `sdd-standard` 候选定位，不进入当前正常 Route 映射、不迁移历史 Change。
- 同步主方案 v1.4.13、Analysis v1.12、Engineer v1.8；Multica 原生机制及 Instructions / Skill 分层规则不变。

---

### v1.7 变更摘要

- OpenSpec 设计正式采用“统一 Change Model + 分型 Schema”：Corrective=`corrective`，Intentional=`spec-driven`。
- 明确 Schema 与 Route 的职责边界：Schema 定义 Artifact / Dependency / generation / Apply 前置，Route 定义技术语义与专业方法；Schema 不成为新的 Runtime 或审批层。
- Change 创建后持久化 Schema，跨 Agent / Run 读取，不依赖上游会话重新解释；TFS 类型与 Schema 不直接绑定。
- 公共 config rules 只维护跨 Schema 真正共享的 Artifact 规则，专业写法归各 Schema instruction / template，遵守 One Rule, One Owner。
- 同步主方案 v1.4.12、Analysis v1.11、Engineer v1.7；Multica 原生机制本身无变化。

---

### v1.6 变更摘要

- 明确 OpenSpec Change 不是新的 Issue / Unit / Run / 审批对象；Corrective 轻量契约只由 Analysis 专业方案维护。
- 新增跨 Run 交接与成本边界：保留独立角色、必要持久化及接收方读取，优化重复分析 / 副本 / 无价值接力，而非强制减少 Run。
- 同步主方案 v1.4.11、Analysis v1.10、Engineer v1.6 的交叉引用；不复制专业产物清单或改变 Multica 原生机制。
- 本次为设计规范更新，不表示 Agent 配置、安装版本或 Token / 耗时已通过运行验收。

---

<a id="historical-changes"></a>

### 历史版本记录

以下 v1.6 及更早记录保留当时含义，旧文件名、旧规则与旧来源核对日期不作为 v1.7 的执行依据。当前规则见正文。

### v1.5 变更摘要

- 区分设计基线与执行资产；允许设计文档保留必要业务背景、对齐的总结视图及独立历史摘要区。
- 明确指导手册、Delivery 主方案、Analysis 与 Development 阶段方案的权威归属，引用具体规则而非笼统按文档层级覆盖。
- 集中维护 Multica 原生机制、官方 URL、支持范围和核对信息；各方案保留项目契约和精确内部引用。
- 统一当前 `analysis_review`、Gate 名称及与主方案的引用；区分生命周期专业阶段与 Multica 原生 Stage。
- 新增来源类别、可变源码、安装版本验证和维护规则；公开资料核对不等于运行验收，不要求每次 Run 加载整份手册。
