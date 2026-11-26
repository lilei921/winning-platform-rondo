# Multica 研发交付生命周期设计方案

> Version: 1.6.14  
> Scope: 基于 Multica 原生 Squad（小队）、Issue（事项）、Run（运行）、`@mention`、自定义 Status（状态）与 Autopilot（自动驾驶）能力，构建“需求同步 → Wayfinder 准入 → 分析 → Analysis Review（分析审核） → 研发 → 按需独立验收 → PR 提交 → 等待合并 → 归档”的研发闭环。  
> Date: 2026-11-06  
> Author: winning/li_lei

> Status（状态）: Draft Baseline（结构优化评审版；未部署）  
> Core Principle（核心原则）: **Squad 通过单一 Issue 内的原生 `@mention` 协作，Deterministic Gate（确定性门禁）负责硬条件，Multica 负责运行与状态。**  
> Terminology（术语）: 本方案中的 Squad、Agent、Issue、Status、Route、Gate 等名称统一遵循 [01-multica-openspec-design-guideline.md](01-multica-openspec-design-guideline.md) 的 Canonical Terminology（统一术语）；本方案不维护第二套全局术语。
> Architecture Principle（架构原则）: 本方案遵循 [Runtime-Centric Delivery（以运行时为中心的交付） + Artifact-Centric Engineering（以工件为中心的工程）](01-multica-openspec-design-guideline.md#runtime-artifact-principle)；权威定义由[指导手册](01-multica-openspec-design-guideline.md)维护，本方案只定义 Delivery（交付）生命周期中的应用。

## 目录

- [1. 文档定位与设计目标](#delivery-scope)
- [2. 总体架构与研发闭环模型](#2-总体架构与研发闭环模型)
- [3. 核心职责、对象与公共运行机制](#3-核心职责对象与公共运行机制)
- [4. TFS Sync 与 Delivery Startup（同步与启动）](#4-tfs-sync-与-delivery-startup同步与启动)
- [5. Analysis（分析）与 Analysis Gate（分析门禁）](#5-analysis分析与-analysis-gate分析门禁)
- [6. Human Analysis Review（人工分析审核）](#human-analysis-review)
- [7. Development Runtime Projection（研发运行时投影）与交付单元](#development-materialization)
- [8. Development Execution、Completion & Aggregation（研发执行、完成与聚合）](#development-execution)
- [9. Verification & Rework（验证与返工）](#verification-rework)
- [10. PR Preparation & Materialization（PR 准备与物化）](#pr-materialization)
- [11. PR Status Sync & Exception Handling（PR 状态同步与异常）](#pr-status-sync)
- [12. Delivery Finalization（PR 收口、对账与最终完成）](#12-delivery-finalizationpr-收口对账与最终完成)
- [13. Cross-Stage Delivery Facts & Decision Boundaries（跨阶段事实与决策边界）](#13-cross-stage-delivery-facts--decision-boundaries跨阶段事实与决策边界)
- [14. 核心设计决策（摘要视图）](#delivery-principles)
- [附录 A. Agent、Squad 与 Skill 实施资产映射](#附录-a-agentsquad-与-skill-实施资产映射)
- [附录 B. 端到端验收索引（不替代各阶段检查契约）](#附录-b-端到端验收索引不替代各阶段检查契约)
- [附录 C. 机制与专业来源引用](#附录-c-机制与专业来源引用)
- [附录 D. 章节迁移索引（仅供更新引用）](#附录-d-章节迁移索引仅供更新引用)
- [附录 E. 历史版本与设计决策记录](#historical-changes)

---


<a id="delivery-scope"></a>

# 1. 文档定位与设计目标

本方案维护跨角色 Delivery 生命周期及授权、协作、TFS、Verify、PR 和完成规则；专业方法分别由 [Analysis 阶段方案](03-workitem-analysis-design.md)、[Development 阶段方案](04-engineer-development-design.md) 维护。文档权威归属见 [指导手册](01-multica-openspec-design-guideline.md#document-ownership)；Multica 公共机制与官方 URL 统一引用该手册的具体条目，本方案保留自己的使用约束与验收要求。

整个研发任务默认作为一个完整的 **Issue** 管理。

当前统一 Engineer 的研发契约以 [09](09-unified-engineer-development-design.md) 为准，Tasks 直接编辑与发布规则由 [05 §11](05-openspec-schema-implementation-design.md#openspec-schema-section-11) 维护。本文中 Task Set 派发相关内容仅描述尚待退役的旧路线，不作为当前 Engineer 的执行要求。

一个配置范围内的 TFS Work Item 默认对应一个 Issue。**自动 TFS 同步入口**先由 Wayfinder Agent 探索和准入，`accepted` 后根据 `tfs.type` 交 Bug Fix Agent 或 Delivery Squad；明确直接委派给 Squad / Workitem Analyst 的 Analysis 可以绕过 Wayfinder，不将其作为所有 Analysis 的强制 Gate。存在实际工程增量时，后续 Analysis Gate 与 Human Approval 规则不变；无需工程增量时，Analyst 在当前 Issue Comment 记录专业结论、关键依据和处理建议，复用原生回流，不生成 Change、Gate 或研发批准，不得借此绕过已生效的工程契约。

研发过程中：

- Workitem Analyst、各专业 Engineer、Verify Agent 等角色变化，不因为角色变化创建新的 Issue；
- Engineer 的 Local Validation（本地验证） 与 Code Review（代码审查） 属于 Development 必备质量机制，与 Verify Agent 是否参与无关；
- Verification 是 Development / Delivery Completion Contract 的组成部分，不固定为单独 Stage；每个 Implementation Task 必须完成自己的验证，组合行为按需使用 Change-level Verification Task；
- Regression / Integration / E2E 是 Verification Method；责任执行者由 Runtime Projection（运行时投影） 确定为 Engineer，或在已批准 Independent Verification（独立验证） 与 Verification Task 范围重合时为 Verify Agent；CI / script / test runner 仅作为执行机制；
- Verify Agent 是按需参与的 **Independent Verification Executor**，只有 `verify_agent.required=true` 时才增加独立验收者；
- 本期默认不创建 Development Sub-Issue；当前 Issue 内通过 `@mention + task_refs` 分工，多个 Tasks、Engineer、Repository 或 PR 不需要拆分 Issue；
- **Workitem Analyst 负责需求与问题分析及研发准备，澄清目标、业务场景、行为规则、范围和验收要求，形成后续研发依据，并在 `analysis-publish` 中提交审核、回读确认；Human 作出决定，Delivery Lead 理解意见并组织后续协作；**
- **获准自动交付的 Corrective / Intentional 均采用 OpenSpec Change Model；Corrective 使用专用轻量产物契约，Intentional 保留规格驱动分析与实施；Multica 继续负责独立 Agent Run、运行与协作；**
- **Delivery Lead 在已批准的需求、方案与验收边界内，结合当前 Roster 正常承担成员选择、工作分工与交接；独立工作使用 Assignment，当前 Issue 内协作使用 `@mention`；**
- **启动、Assignment、`@mention` 与 Parent / Stage 回流优先复用 Multica；简单成员分工由协作规则表达，业务硬条件、物化、副作用与幂等由必要的 Script / Gate 承担；**
- **Deterministic First，Semantic Fallback 适用于明确硬条件与可靠事实；专业分析、成员选择和协作安排由相应 Agent 正常承担，不以脚本先返回 `UNKNOWN` 为前提；**
- **确定性机制返回 `UNKNOWN` 或出现事实冲突时，Delivery Lead 协调适当的 Specialist / Human 查明原因、补充信息；不得据此覆盖明确 `FAIL` 或替代人工批准；**
- Delivery Lead 不替代 Workitem Analyst、Engineer、Verify Agent 的专业工作，但负责决定当前需要哪种专业能力、如何组织成员协作以及何时需要 Human；
- PR 审核过程由 TFS / PR Platform 管理；Multica 不复制外部 Review 状态机。`pr-status-sync` 只依据 TFS 实际可观测的 PR `status` 检测终态：`completed` 表示正常完成，`abandoned` 表示当前 PR 已无法继续并进入人工决策；`active` 保持等待，未知或异常数据返回 `UNKNOWN`。

---


# 2. 总体架构与研发闭环模型

**入口阶段说明**：当前研发测试暂保留 `backlog`，Human 手动改 `todo`；目标态仍是 TFS Sync 初始化完成后自动改 `todo` 驱动 Wayfinder。两者的适用范围与验收按 [§4.1 阶段约定](#wayfinder-entry-stages)区分，下图展示研发测试入口。

```text
TFS Work Item → TFS Sync Autopilot / Deterministic Reconcile
                         │
                         ▼
Issue（同步初始化完成后保持 backlog + Wayfinder Agent）
                         │ Human 手动改 todo，保留 Wayfinder 指派
                         ▼
Wayfinder Agent（Squad 外）
   Wayfinder Instructions；按需 codebase-explorer
   Triage Decision + Evidence → 确认 /note 已记录 → admission
                         │
         ┌───────────────┼────────────────┐
         ▼               ▼                ▼
      accepted       needs_human       unsupported
         │           blocked + Wayfinder   unsupported（终止状态）
         │           Human Comment → Wayfinder    当前自动交付终止
         ▼
Delivery Squad（status = todo；Assignment Trigger 自动启动）
         │ 仅已激活 accepted Issue
         ▼
Delivery Lead → @Workitem Analyst
         ▼
Analysis（无工程增量 → 当前 Issue Comment；下方仅实际工程增量）
         ▼
Analysis Package → Analysis Gate → analysis_review
         ▼
Human Analysis Review → Delivery Lead（批准边界）
         ▼
OpenSpec Tasks / Runtime Projection
   ├─ Parent Issue + @Engineer + task_refs（默认）
   └─ Development Sub-Issue + task_refs（按需）
         ▼
Implementation / Local Validation / Code Review
         ▼
Development Completion Check → Tasks 完成状态更新
         ▼
Parent Delivery Aggregation → Verification Projection
   ├─ verify_agent.required=false → 验证 Evidence
   └─ verify_agent.required=true → @Verify Agent → Verification Gate
         ▼
PR Materialization → PR Status Sync → Finalize / Archive
         ▼
TFS Close / Issue Done
```

上述自动 TFS 入口只有在 `accepted` 且满足启动条件时才继续对应交付路径（Requirement 进入 Squad 分析、Bug 进入独立修复）；明确直接委派的 Analysis 可不经 Wayfinder，实际工程增量仍遵守 Analysis Gate 与 Human Approval。其他准入结论不是正常 Delivery Review。准入事实、Decision、Comment 与恢复的权威规则见 [§4.1.1](#delivery-intake)，下游生命周期见 [§5](#section-5)–[§12](#section-12)。

## 2.1 Agent（智能体）定位与介绍

以下为各 Agent 的职责摘要；具体执行边界见 [§3](#section-3)、[§5](#section-5)、[§7](#development-materialization)、[§8](#development-execution)–[§11](#pr-status-sync)。`Delivery Squad` 是协作单元，不是另一个 Agent。

| Agent | 在交付中的位置 | 定位与主要工作 | 交付与边界 |
|---|---|---|---|
| **Delivery Lead** | Delivery Squad 的 Leader；父 Delivery 的协调入口 | 理解人工审核意见中的决定、条件与反馈；读取批准边界、当前 Roster 和执行事实，组织成员分工、委派与交接；处理跨角色问题 | 形成可执行的协作安排并持续协调；不重复专业分析、不编写生产代码、不替代验收或 Human Approval（人工批准），也不管理底层 Run 调度 |
| **Workitem Analyst** | Squad 分析成员 | 澄清需求与问题的目标、业务场景、行为规则、范围及验收要求；结合现有系统分析 Solution / Root Cause / Fix Strategy、影响与约束，按 Change Kind 形成适用规格或修复依据及其他研发准备 | 交付可审核、能支撑研发与验证的逻辑 Analysis Package 及 Verify Agent Recommendation；在 `analysis-publish` 中提交审核并确认状态；不得自行批准、启动研发或关闭 Delivery，不负责最终成员分工 |
| **Backend Engineer** | 后端专业成员 | 在已批准范围与当前 Task Set 内完成后端实现、Local Validation、Code Review 和整改 | 交付 Commit / Push、PR Preparation 与 Development Evidence（研发证据）；不重新定义需求或决定整个 Delivery 的分工 |
| **Frontend Engineer** | 前端专业成员 | 在已批准范围与当前 Task Set 内完成前端实现、本地与必要浏览器验证、Code Review 和整改 | 交付当前 Task Set 的工程成果与 Evidence；不把技术步骤自行扩展成新的交付任务 |
| **Flink Engineer** | Flink / 流处理专业成员 | 在已批准范围与当前 Task Set 内完成流处理实现、相关行为验证、Code Review 和整改 | 交付当前 Task Set 的工程成果与 Evidence；涉及已批准 Contract / Scope 的实质变更时升级 |
| **Verify Agent** | 按需参与的 Delivery-level 独立验证成员 | 在 `verify_agent.required=true` 时消费已批准 OpenSpec Acceptance / Verification Contract（验证契约），对固定候选 Commit Set 做 independent verification 并归因 Finding | 交付 Verification Report 与失败证据；不拥有 Requirement / Scenario / Verification Task 的 Engineering Contract；可在批准范围内承担 assigned Verification Task 的 Runtime Execution，不替代 Engineer 的 Task Verification / Local Validation / Code Review |
| **TFS Sync Agent** | Squad 外的 Autopilot Thin Adapter | 通过 `tfs-sync` 获取 TFS 原始事实、调用确定性同步并汇总结果 | 新建 Issue 由 Wayfinder 持有并在完整初始化后受控激活；不做准入语义判断或直接启动 Squad 研发 |
| **Wayfinder Agent** | Squad 外的 Intake Triage Agent | 使用独立的 `codebase-explorer` 按需深入探索 Repository、代码、调用链与 Spec；依据 Wayfinder Instructions 形成 `accepted / needs_human / unsupported` 结论 | 确认 `/note` Comment 已记录后受控交接；不做正式 Root Cause / Technical Change Kind 判断 / OpenSpec Preparation |
| **PR Status Sync Agent** | PR 状态核实与同步 | 核实已登记 PR 的外部状态，使用 `pr-status-sync` 完成状态对账并交付异常与待处理事项 | 对状态事实的准确性负责；不解释 Review 意见、不推断 abandoned 原因或替代交付决策 |

### 2.1.1 Professional Goal 与 Capability Composition（专业目标和能力组合）

以下三个案例说明目标归属与可组合能力；**实际绑定以 `workspace-config/provisioning.json` 为准**，未登记的 Skill 不视作已部署。

| Agent | Professional Goal（专业目标） | 可组合能力（已实现 / 候选） | 结果责任 |
|---|---|---|---|
| Wayfinder Agent | 依据证据判断 Issue 是否具备进入自动交付分析的条件 | `codebase-explorer`（调查）；Wayfinder Instructions（准入分类） | 准入 Decision、`/note` Evidence 与受控交接 |
| Workitem Analyst | 将 Work Item 转化为准确、可实施、可验证的分析与工程准备成果 | 当前源文件：`codebase-explorer`、`bug-analysis`、`requirement-analysis`、`spec-preparation`、`analysis-publish` | 可信根因或需求、OpenSpec Change、Verify 推荐与审核提交 |
| Backend / Frontend Engineer | 在批准范围内完成正确、可维护、可验证的实现 | 已实现：`development-execution`、对应领域 Skill；按需使用 Internal Methods | Task Set 实现、验证、Evidence 与 PR Preparation |

Agent 对专业结果负责并按任务选取能力；Skill 仅负责局部 Capability Outcome。候选 Skill 是否提取应由 [03 §14](03-workitem-analysis-design.md#analysis-section-14) 与 [06](06-method-skill-library-implementation-design.md) 的独立复用证据决定。必要 Gate 与授权、外部副作用顺序不因自主选择方法而改变。

## 2.2 协作与执行边界

> **Workitem Analyst 把需求与问题分析清楚，做好研发准备；Delivery Lead 组织分工与协作；Engineer 在明确的需求、方案和约束下完成实现；Verify Agent 按需独立验收；Script 保障明确硬条件和副作用；Multica 承担实际运行。**

Workitem Analyst 与 Engineer 保持不同 Agent / Run，经已持久化且获批准的产物交接；不为节省 Token 合并角色、假定共享会话或取消必要文档。需求与问题分析、协作安排和工程实现分别承担专业职责，不要求新增三份计划文档。需求结论、必要方案和研发准备按 Owner 保留在 OpenSpec Change / Multica delivery facts / Supporting Evidence（补充证据） References；协作安排保存在当前 Issue 的成员交接和派发事实中；详细实现由 Engineer 在批准边界内决定。

Workitem Analyst 的完整职责与分析完成标准见 [03 §1](03-workitem-analysis-design.md#analysis-stage-scope)，角色契约见 [§2](03-workitem-analysis-design.md#analysis-agent-model)，专业分析与工程准备见 [§6–§9](03-workitem-analysis-design.md#analysis-section-06)；Verify 推荐、提交与 Summary、Analysis Gate 分别见 [§10](03-workitem-analysis-design.md#verify-recommendation)、[§12.1](03-workitem-analysis-design.md#analysis-publish)、[§11.2](03-workitem-analysis-design.md#analysis-gate)。

Engineer 的完整职责与完成标准见 [04 §1](04-engineer-development-design.md#engineering-stage-scope)，角色契约见 [§2](04-engineer-development-design.md#development-section-02)，输入、工程执行、Evidence 与 Completion 见 [§3–§11](04-engineer-development-design.md#engineering-input)；技术决策权限与停止边界见 [§12](04-engineer-development-design.md#development-section-12)。

Human 批准需求、方案与验收边界。Leader 的正常成员选择与协作安排无需先等待 Script 返回 `UNKNOWN`；已有明确安排时直接复用。需要改变批准边界时，按 [§6.1](#section-6-1) 返回相应 Specialist / Human。

---


<a id="delivery-execution-model"></a>

## 2.3 端到端执行模型（总览）

本节提供全文端到端阅读索引，不建立“简单 / 复杂 Delivery”等新的 Delivery 分类；各步骤的准入、执行与异常规则以对应生命周期章节为准。Development Runtime Projection（研发运行时投影）的权威规则见 [§7](#development-materialization)。

下图展示**自动驱动目标态**；研发阶段为便于测试，暂以 Human 手动改 `todo` 替代首次自动激活，见 [入口阶段约定](#wayfinder-entry-stages)。自动激活是既定目标，不因当前采用手动测试入口而视为旧规则残留。

```text
TFS Sync Autopilot
 ↓
Thin TFS Sync Agent → deterministic reconcile
 ↓
Issue
assignee = Wayfinder Agent
status = todo（同步完成后自动启动）
 ↓
Wayfinder Intake Triage（codebase-explorer 深入探索）
 ↓
/note Comment 持久化并回读确认 → 准入结论
 ├─ accepted → rondo delivery admission（按 tfs.type 单次 todo + Bug Fix Agent / Delivery Squad Update）
 ├─ needs_human → status = blocked + assignee = Wayfinder（Human Comment 唤醒后重评）
 └─ unsupported → unsupported（终止当前自动交付路径）
 （仅 accepted 且满足启动条件时继续）
 ↓
Multica 启动 Delivery Lead（通过准入且被激活）
 ↓
@Workitem Analyst
 ↓
Analysis Package（逻辑集合）
+ OpenSpec Change
+ Analysis Handoff Facts
+ Supporting Evidence（按需）
 ↓
有工程增量时 Workitem Analyst 提交并确认 analysis_review；无工程增量时直接 Comment 回流，结束本轮分析
 ↓
Human 自然语言审核意见
 ↓
Delivery Lead 理解决定与条件；明确批准后继续
 ↓
结合 Approved OpenSpec Tasks、批准边界、依赖与当前 Roster 组织 Task Set
 ↓
对各 Task Set 使用 §7 已定义的 Runtime Projection
 │
 ├─ Parent Issue Runtime（默认）
 │    ├─ @Backend Engineer + task_refs      ┐
 │    ├─ @Frontend Engineer + task_refs     ├─ 无阻塞依赖时可以并行
 │    └─ @Flink Engineer + task_refs        ┘
 │
 └─ Development Sub-Issue（按需）
      ├─ materialize-development.py 落实已确定的 Owner / task_refs / 依赖
      ├─ Assignment → Specialist / Delivery Squad
      └─ 仅对依赖满足的 Sub-Issue：backlog → todo
 ↓
各 Engineer 按相同 Engineering Contract 执行
Implementation
→ Local Validation
→ Code Review
→ Commit / Push
→ PR Preparation
→ Development Evidence
 ↓
Development Completion Check
 ↓
Tasks 完成状态更新 → 核对依据 → Task Set READY
 ↓
Parent Issue / Delivery Lead 聚合当前有效结果
├─ Parent Issue Runtime → task_refs completion / evidence facts 回流
└─ Development Sub-Issue → done 后通过原生 Parent / Stage 回流
 ↓
确认 required Implementation Tasks 与 Engineer-owned Verification Tasks 已完成，读取已批准 Independent Verification Decision
+ Implementation / Engineer-owned Verification Evidence 当前有效
+ 对应 Engineer Task Sets Development Ready / required Development Sub-Issues 已完成
+ 若 verify_agent.required=true：Verify-Agent-owned required Verification Tasks 已明确分配（可保持 pending）
+ 无 unresolved Development blocker
 ↓
├─ verify_agent.required=true 且无当前有效 PASS
│    → @Verify Agent：执行其 assigned Verification Tasks + Independent Verification
│    → 形成 Verification Report / Evidence，持久化已完成 Verification Tasks
│    ├─ 满足 §9.5 条件 → Verification Gate PASS
│    └─ FAIL / UNKNOWN → Targeted Rework / 升级
│                       → 重新检查受影响的 Engineer-side Readiness
│                       → Parent Delivery 重新评估 Verify
│
└─ verify_agent.required=false / 已有当前有效 PASS
 ↓
全部 required OpenSpec Tasks（含 Verify-Agent-owned Verification Tasks）完成
+ 全部 required Verification Evidence 当前有效
+ Verify 不要求或当前 Verification Gate PASS
 ↓
PR Materialization → Create required PR(s)
→ in_review
 ↓
PR Status Sync Agent（Thin Adapter）
→ reconcile-pr-status.py
 ↓
all required PR completed
 ↓
same-run deterministic finalize
（Change Archive / 根仓 Commit / 引用回填）
 ↓
TFS Done / Issue Done
```

当前 Issue 可以承载多个专业 Agent Run；同一 Repository 的所有 Task Sets 保持唯一有效 Engineer，不从两个入口派发同一 Task Set。多个 Engineer、Repository 或 PR 不构成新建 Issue 的理由。

当前专业协作由 Delivery Lead 在 Issue 内统一协调，不创建新 Issue 承接普通角色交接。

Merge 后正常 QA / 测试发现的新问题形成新的 TFS Bug / Requirement。

### 2.3.1 Single-Engineer Happy Path（单工程师理想执行示例）

这是成功路径的 **8 次关键 Agent Run 示例**，不代表固定执行配额，也不是另一套 Delivery 分类或状态机。

以下 Run 0–1 按研发测试阶段的手动入口描述；目标态将首次 `backlog → todo` 交给 TFS Sync 自动执行，后续准入和交接职责不变，见 [入口阶段约定](#wayfinder-entry-stages)。

**场景假设：** 一个单 Repository、单 Backend Engineer、单 PR 的 Intentional Change，Wayfinder 一次判为 `accepted` 且 `/note` Comment 回读成功；`accepted` 固定自动启动；Analysis 一次审核通过，Human 确认 `verify_agent.required=false`；研发、PR 均一次成功，使用 Parent Issue Runtime。

- **Run 0 — TFS Sync Agent：** 创建 `backlog` Issue，写入并回读 TFS 来源事实，设置 `assignee=Wayfinder Agent` 并确认初始化；保持 `backlog`，不激活 Wayfinder 或 Squad。
- **Run 1 — Wayfinder Agent：** Human 手动将 Issue 改为 `todo` 并保留 Wayfinder 指派，由原生 Status Trigger 启动 Run；依据 Wayfinder Instructions，按需使用 `codebase-explorer`；给出 `accepted`，确认同一 Issue 的顶层 `/note` Comment 已记录；通过一次 `todo + Squad` Assignment Update 自动唤醒 Leader。
- **Run 2 — Delivery Lead：** 读取有效准入事实与当前 Owner / Status，`@Workitem Analyst`，结束协调 Run。
- **Run 3 — Workitem Analyst：** 增量复核 Wayfinder Evidence，完成 Intentional Analysis、OpenSpec Preparation、Analysis Gate；通过 `analysis-publish` 提交并回读 `analysis_review`。
- **Run 4 — Delivery Lead：** Human 明确批准后，核对批准事实、提交根仓初始基线，确定 `task_refs` 和 Backend Engineer；`in_progress` 回读后 `@Backend Engineer`。
- **Run 5 — Backend Engineer：** 实现、Task Verification、Local Validation、Code Review、Commit / Push、PR Preparation、Development Evidence 与 Completion Check；Tasks 完成状态更新后发布 READY。
- **Run 6 — Delivery Lead：** 聚合当前有效结果；本例不需独立 Verify，满足 PR Gate 后调用确定性 PR Materialization，进入 `in_review`。
- **Run 7 — PR Status Sync Agent：** PR `completed` 后在同一 Run 执行有界 Finalize / Archive / TFS Close，并按后置条件关闭 Issue。

**数量口径：** 此例合计 **8 次关键 Agent Run**，其中 Squad 内 **5 次**，Squad 外的 TFS Sync、Wayfinder、PR Status Sync **3 次**。若 `verify_agent.required=true`，且增加一次 Verify Agent Run 与一次结果回流 Lead Run，此例相应为 **10 次**。TFS 批量同步、PR `active` 轮询、失败重试和恢复均可改变实际数量；Multica Agent Run 不等同于 CLI Session。

`accepted` 按 `tfs.type` 交给 Bug Fix Agent 或 Delivery Squad，由原生 Assignment Trigger 启动对应 Run，不设置 `manual_start` 分支。

---


<a id="section-3"></a>

# 3. 核心职责、对象与公共运行机制

系统分为六个核心层次。

## 3.1 Multica Runtime（Multica 运行时）

负责：

- Issue；
- Status；
- Assignee；
- Squad；
- Agent Run；
- `@mention`；
- Sub-Issue；
- Stage；
- Comments；
- Metadata；
- Autopilot；
- Run History。

Multica 是研发流程状态的主要持久化载体。

### 3.1.1 Run Boundary Contract（运行边界契约）

Run Boundary 是 Multica 运行与交接约束，不等于引入新的 Stage、Issue、Workflow State 或 OpenSpec Artifact。正常协作优先复用原生 Assignment / `@mention` / Squad 回流和 Autopilot；可靠触发、重复通知与重试由当前事实及 [§8.2.2](#section-8-2-2) 的幂等规则约束。

| 执行场景 | Run Boundary（执行边界） | 说明 |
|---|---|---|
| 同一 Agent 执行多个 Project Skill / 内部 Method | **不因 Skill / Method 切换而强制新建 Multica Run** | Workitem Analyst 的分析、OpenSpec Preparation 和 Analysis Gate 可在本轮分析 Run 完成；具体停止条件仍有效 |
| TFS Sync → Wayfinder Agent | **独立 Agent Run** | 先创建完整来源事实并停放在 `backlog`，随后一次受控激活；不得在未完成来源初始化时启动探索 |
| Wayfinder Agent → Bug Fix Agent / Delivery Squad | **独立 Agent Run** | 发布 `/note` Comment 并回读确认后，受控切换 Owner / Status；Wayfinder 结束本轮，不与下游 Agent 并行写交付事实 |
| Delivery Lead → Workitem Analyst | **独立 Agent Run** | Lead `@mention` 分析成员并结束协调 Run；专业分析不在 Lead Run 内替代执行 |
| Workitem Analyst 提交 Human Analysis Review | **结束当前 Run，等待 Human Decision** | `analysis_review` 是 Issue Status，不是驻留的 Agent Session；不得自动继续研发 |
| Human Approval → Delivery Lead | **新的协调 Run** | 由有效 Human Comment / 原生机制唤醒，核对批准事实后作出成员分工与交接 |
| Delivery Lead → Engineer | **独立 Agent Run** | 当前 Issue 内使用 `@mention` + `task_refs`，不改变 Issue Assignee |
| Engineer 内部 Task Verification、Local Validation 与 Code Review | **默认当前 Engineer Run 内完成** | 不因内部方法切换强制另开 Multica Run；按授权使用的 read-only review 工具不产生新的 Delivery Owner |
| Engineer 完成 → Parent Delivery / Delivery Lead | **父级回流后按需新的协调 Run** | 读取当前有效 completion / evidence facts，聚合、按需独立 Verify、PR 物化；不得重复派发已完成 Task Set |
| Delivery Lead 触发 PR Materialization | **不为确定性 capability 额外唤醒 Engineer** | 一次协调 Run 内消费 PR Preparation Facts 并调用 `pull-request`；只有新 Engineering Semantic Work 才重新委派 Engineer |
| 外部 PR 处于 `active` | **PR Status Sync 可以多次 Autopilot Run** | NO-OP，不唤醒 Lead / Engineer；不得误记为业务完成 |
| PR `completed` → Finalize | **同一个 PR Status Sync Run 内完成** | 调用 `rondo delivery finalize`，正常成功路径不专门唤醒 Delivery Lead |
| Gate / Script 检查 | **本身不要求新建 Agent Run** | 确定性工具属于调用方当前 Run；`FAIL` / `UNKNOWN` 仍按相应阶段规则处理 |

**术语边界：** 本文计数使用 **Multica Agent Run**，不把它直接等同于 Claude / Codex 的 CLI Session（底层工具会话）。一个 Run 如何创建或复用 CLI 进程 / Session、上下文和工作目录，是 Runtime Adapter 与安装版本的实现和验收事项；流程方案不对二者作固定一一对应承诺。公共机制定义见[统一规范 §2.4](01-multica-openspec-design-guideline.md#mechanism-issue-run)。

---

## 3.2 Delivery Squad（交付小队）

负责一个研发任务内部的多角色协作。

推荐成员：

```text
Delivery Squad

Leader
└── Delivery Lead

Members
├── Workitem Analyst
├── Backend Engineer
├── Frontend Engineer
├── Flink Engineer
└── Verify Agent
```

自动 TFS 入口通过 Wayfinder 准入且满足启动条件后，由 `rondo delivery admission` 将 Issue 交给 Bug Fix Agent 或 Delivery Squad；准入之前由 Wayfinder Agent 持有，不触发 Squad Leader。明确直接委派的 Analysis 不要求先经过 Wayfinder；两种入口的 Human Analysis Review 均不改变。Leader-first、Instructions 与 Roster 的接收范围见 [指导手册：Squad](01-multica-openspec-design-guideline.md#mechanism-squad)。

---

## 3.3 Delivery Lead（交付负责人）

Delivery Lead 是 Delivery Squad 的 Leader，负责在已批准的需求、方案与验收边界内组织分工、委派与交接，并协调执行中的跨角色问题。

核心定位：

> **Parent Delivery Coordination：需求与问题由 Workitem Analyst 分析并做好研发准备；成员选择与协作安排由 Delivery Lead 负责；已确定动作由原生能力和必要脚本落实。**

Delivery Lead 的职责包括：

- 读取当前 Issue 的事实、逻辑 Analysis Package、现有协作安排与当前 Squad Roster；
- 在现有 `delivery-flow` 方法中，结合本次 Human Comment 和相关上下文理解审核决定、附加条件与修正要求；明确后落实，意图不明先澄清，不替代 Human 批准；
- 结合工作内容、成员角色和能力选择执行者；已有明确且仍有效的分工时直接复用，不要求每次重新选择；
- 在当前 Issue 内按 `task_refs` 组织专业成员的分工和交接，不因角色、任务或 Repository 数量创建额外 Issue；
- 当前交付 Issue 由 Delivery Squad 负责，内部专业工作通过 `@mention` 委派；入口阶段确实需要转移整个 Issue 的 Owner 时才使用 Assignment；
- 尊重已批准技术依赖与约束，安排协作顺序、允许的并行工作和必要 Stage；不把运行时调用关系自动当作开发完成依赖；
- 调用原生能力和必要 Script / Gate，落实已确定的协作安排、校验硬条件并执行副作用；不要求为正常成员选择先运行通用 Router；
- 在父 Issue 上协调按批准要求执行的 Verify、结果回流、受影响 Task Set 的定向返工以及后续 PR / Completion；
- 遇到事实冲突、输入不足或 `UNKNOWN` 时，协调适当的 Specialist / Human 查明原因、补充信息或调整执行安排；需要改变批准边界时停止相应推进并升级。

Delivery Lead 不负责：

- 替代 Workitem Analyst 重新调查已确认根因、重做需求分析或另选技术方案；
- 替代 Engineer 决定类 / 函数拆分、详细实现步骤、生产代码、正式 Local Validation 或 Code Review；
- 在 `verify_agent.required=true` 时替代 Verify Agent 完成 Independent Verification，或替代 Human Approval / Business Decision；
- 为当前 Issue 内的普通专业分工额外创建子 Issue，或反复切换整个 Issue 的 Assignee；
- 实现底层 Run 队列、调度器、全局事务或第二套 Workflow Runtime；
- 覆盖明确 Gate `FAIL`，或把 `UNKNOWN` 当作自行放宽硬条件的权限。

Delivery Lead 作为轻量 Delivery Coordinator（交付协调者），正常负责父 Delivery 的成员分工、结果聚合与阶段交接，而非仅处理异常。`Deterministic First，Semantic Fallback` 的适用范围见 [§13.2](#section-13-2)：可靠规则已决定的结论不重复裁量；本来需要专业或协作语义判断的工作，直接由相应角色承担。

Delivery Lead 每次 Run 应保持短生命周期：

```text
读取当前事实 / 已批准边界 / 现有协作安排
    ↓
├─ 已有安排或结果仍有效
│    → 复用；等待或只补尚未完成的动作
│
├─ 当前有人工审核意见需处理
│    → 理解本次决定与条件，意图不明先澄清
│    → 明确后核对硬条件并落实，不替代 Human 批准
│
├─ 当前确需成员选择、分工或交接
│    → 结合 Roster 作出有边界的协作决定
│    → 原生派发 / 必要脚本落实
│
├─ 当前动作有明确硬条件
│    → 使用相应 Gate / Check；不重新裁量可靠结果
│
└─ 事实冲突、输入不足或无法安全推进
     → 协调适当的 Specialist / Human
    ↓
结束 Run
```

以上是按当前问题选择处理方式，不是每次 Run 必须执行的固定流水线。不长期驻留等待其他 Agent；无新增动作则结束。

---

## 3.4 Specialist Agent（专业智能体）

专业 Agent 对自身的长期 Professional Goal 与最终专业结果负责，Skill 不接管角色责任；具体专业设计分别由 [03](03-workitem-analysis-design.md) / [04](04-engineer-development-design.md) 维护。

```text
Workitem Analyst
    = 需求与问题分析及研发准备
    = 澄清目标、业务场景、行为规则、范围与验收要求
    = 结合现有系统形成必要方案、根因 / 修复策略、影响与约束
    = 按适用 Schema 准备规格、设计、任务或修复依据
    = 提出 Verify Agent Recommendation 与待确认事项
    = 通过 analysis-publish 提交审核、确认 analysis_review 后结束本轮分析
    = 按需提出技术拆分建议，不决定最终小队分工

Backend / Frontend / Flink Engineer
    = 研发实现
    = Local Validation
    = Code Review
    = Development Evidence

Verify Agent
    = 按需独立验收
    = behavior-oriented
    = Acceptance / Runtime / Integration / E2E Verification（按需）
```

专业 Agent 不承担整个研发流程的全局编排。Workitem Analyst 不以读取 Squad Roster 或掌握具体成员配置为 Analysis 前提；Engineer 在当前工作范围内决定实现细节，不替代 Delivery Lead 组织整体分工。

---

<a id="delivery-gates"></a>

## 3.5 Deterministic Gate（确定性门禁）

负责程序化、确定性的判断。

包括：

```text
Analysis Gate
Development Completion Check
Verification Gate（仅 Verify Agent required 时）
PR Transition Gate
Delivery Completion Gate
```

统一返回：

```yaml
result: PASS | FAIL | UNKNOWN
# PASS 时提供 issue_id、workspace_id、change_ref、change_kind、schema、change_digest
checks:
  - name: identity
    result: PASS
reasons:
  - ...
```

统一语义：

```text
PASS
→ 当前 Gate 控制的转换可以继续

FAIL
→ 当前条件明确不满足
→ 按该 Gate 自己定义的 wait / rework / stop / recovery 处理

UNKNOWN
→ 当前规则无法可靠判断
→ Delivery Lead / Human
```

不同 Gate 的 `FAIL` 不强制映射为同一种行为，例如：

```text
Analysis Gate FAIL
→ Workitem Analyst targeted rework

Development Completion Check FAIL
→ 当前 assigned Task Set 未满足完成契约，按明确缺失条件 targeted rework

Verification Gate FAIL
→ Engineer targeted rework

PR Transition Gate FAIL
→ 等待或补齐缺失条件

Delivery Completion Gate FAIL
→ 不允许关闭
```

Agent 不允许覆盖一个明确的 Gate `FAIL`。

---

## 3.6 External State Sync（外部状态同步）

负责同步 Multica 外部事实。

当前主要包括：

```text
TFS Work Item
PR status = completed
PR status = abandoned
```

PR 的一般 Review 过程、Changes Requested、Approved、Review Feedback 等属于 TFS / PR Platform 自己的审核过程，Multica 不复制，也不作为自动路由输入。

PR 外部事实统一以 provider 返回的 `status` 为权威字段：

```text
active
= 当前 PR 仍在外部流程中
= NO-OP

completed
= Success Event
= 当前 PR 正常完成

abandoned
= Exceptional Stop Event
= 当前 PR 已无法沿现有路径继续，但无法仅根据该事实判断是“审核拒绝”还是“主动丢弃”

其他值 / 字段异常 / 身份不一致
= UNKNOWN
```

`mergeStatus`、`mergeCommitId`、`mergeCommitMessage` 只作为辅助证据，不得替代 `status=completed` 判断 PR 完成。

External State Sync（外部状态同步） 只负责识别、校验、持久化并回流这些外部事实，不推断 `abandoned` 的业务原因。`REJECTED / DISCARDED` 只属于后续 Human Decision，不属于 TFS 同步事实。

---


## 3.7 Issue（事项）模型

采用 **Deliverable-oriented Issue Model（面向交付物的事项模型）**，不按流程阶段、任务复杂度或参与角色拆 Issue。

TFS Work Item 同步后默认关联一个 Multica **Issue**，不另建特殊的交付事项对象类型。OpenSpec Task 数量、Engineer 数量、Repository 数量、PR 数量以及是否并行，都不要求额外创建 Issue。

当前采用单 Issue 协作方式，具体执行契约见 [§7](#development-materialization)–[§8](#development-execution)：

```text
Issue（Assignee = Delivery Squad）
    └─ Delivery Lead
         ├─ @Workitem Analyst（分析）
         ├─ @Backend Engineer / @Frontend Engineer（按 task_refs 分工）
         └─ @Verify Agent（经批准且成员可用时）
```

成员分别执行独立 Run，结果回到同一 Issue。默认不创建 Development Sub-Issue，不因专业分工改变 Issue Assignee；已有可选 Sub-Issue 代码路径暂保留，待专项回归与清理，但不作为当前正常交付路径。

不默认创建：

```text
Analysis Issue
Verify Issue
PR Issue
Change-level Integration / E2E Verification Issue
```

角色变化不等于新的 Issue；多个 Engineer 并行也不自动创建新的 Issue。

---


<a id="section-4"></a>

# 4. TFS Sync 与 Delivery Startup（同步与启动）


## 4.1 TFS Sync（TFS 同步）

TFS Sync 由 Multica Autopilot 触发，采用 **Thin Agent Adapter + Deterministic Script**：

```text
Multica Autopilot
      ↓
TFS Sync Agent（Thin Adapter）
      ↓
tfs-sync deterministic script
      ↓
Structured Script Result
      ↓
END
```

TFS Sync Agent 不自行做同步业务判断，主要负责调用确定性能力并返回结果。

确定性同步负责：

1. 查询符合条件的 TFS Work Item；
2. 创建对应 Issue；
3. 写入 TFS 原始上下文；
4. 设置：
   - assignee = Wayfinder Agent
   - status = backlog（初始化状态；完成后按第 8 项区分研发测试与目标态）
5. 保持同步幂等；
6. 已存在 Issue 时只更新 TFS 管理字段；
7. 不修改已有 Issue 的执行状态和负责人；
8. 来源字段、附件和 Owner 回读成功后确认初始化完成，按下述阶段约定处理首次激活：研发测试保持 `backlog + Wayfinder Agent`；目标态由 TFS Sync 单次自动改为 `todo`，保留 Wayfinder 指派。不直接启动 Squad / Analyst；初始化或激活结果未知时先回读并仅补缺失步骤；
9. 已有 Issue 只更新 TFS 管理字段，不重置准入结论、不修改当前 Owner / Status、不重跑 Wayfinder。

<a id="wayfinder-entry-stages"></a>

**首次准入的阶段约定（2026-11-14 确认，02–08 及相关 validation 共用）**

| 阶段 | 初始化完成后的状态与动作 | 目的及验收范围 |
| --- | --- | --- |
| **当前研发测试阶段** | TFS Sync 保持 `backlog + Wayfinder Agent`；Human 手动将 Status 改为 `todo`，保留 Wayfinder 指派，由原生 Status Trigger 启动 Run | 便于分别观察来源同步、Wayfinder 准入及下游交接；手动改状态替代的仅是首次自动激活动作，不使用 `@mention` 代替该入口 |
| **研发结束后的自动驱动目标态** | 来源、附件和 Owner 初始化并回读成功后，由 TFS Sync 单次自动执行 `backlog → todo`，保留 Wayfinder 指派，原生启动准入 | 继续保留自动化目标；切换前独立验证自动激活、真实 Run 回读及失败恢复，不要求 Human 逐项改状态 |

**评审口径**：当前停留 `backlog` 是便于研发测试的过渡安排，不是取消自动驱动；方案中的自动 `todo` 描述属于目标态，不应仅因当前采用手动入口就判为旧规则。手动测试通过也不等于自动入口已通过。两阶段均不改变 Wayfinder 的判断、`accepted` 后按 `tfs.type` 路由或 Direct Assignment 的例外。

两种入口都须回读实际 Wayfinder Run；TFS Sync 来源同步成功不等于准入完成。自动化切换与重试不得重新激活已处理的 Issue，结果未知时先对账。阶段结果分别记录；本次仅修订文档，未启用自动激活或改变当前 Runtime / Skill 行为。

推荐 metadata：

```yaml
source: tfs
tfs.id: "<work-item-id>"
tfs.type: "<Requirement|Bug>"
tfs.url: "<url>"
tfs.changed_at: "<changed-date>"
```

来源初始化完成后先进入下述 Wayfinder Intake Triage；`accepted` 后由 `rondo delivery admission` 按 `tfs.type` 移交：Requirement 的 Squad-owned Issue 启动 Delivery Lead，Bug Issue 启动 Bug Fix Agent。`backlog → todo` 的具体触发与首次处理、失败恢复分别见 [§4.1.1](#delivery-intake) 和 [§4.2](#delivery-start)。

---



<a id="delivery-intake"></a>

## 4.1.1 Wayfinder Intake Triage（入口准入评估）

**目标**：判断当前 TFS 工作项是否具备进入相应自动交付路径的条件，**不是承诺一定实现成功**。入口准入独立于 Workitem Analyst 的 Technical Change Kind 和 Human Approval。

- **执行主体**：Squad 外的 `Wayfinder Agent`，准入规则由自身 Instructions 维护；独立绑定 `codebase-explorer` Project Skill，与 Workitem Analyst 按需复用 `codebase-explorer` 的可追溯工程证据；CodeGraph、源码、Spec 的权限须单独配置和验证，**不影响 Workitem Analyst 现有 Skill 绑定与执行规则**。
- **执行方式**：按需使用 `codebase-explorer`；根据当前工作项的不确定性选择调查方式，证据足以支持准入即可停止，不要求完整调查根因、调用链或最终修改范围。
- **判断内容**：依 [Wayfinder Instructions](agents/wayfinder-agent/instructions.md) 的准入维度与结论语义判断；不得将“找到 Repository”等同于交付成功，也不得以 TFS Type、仓库数量或修改文件数推断专业变更性质。
- **停止边界**：不写生产代码、不创建 OpenSpec Change、不形成正式 Root Cause / Solution / Acceptance Contract，不替代 Analyst / Human 的决定。

### 准入判断维度（Delivery Eligibility Dimensions）

准入维度、证据充分性与未知项的处理标准以 [Wayfinder Instructions](agents/wayfinder-agent/instructions.md) 为唯一执行依据。准入依据 Business Scope、Repository Discovery、Processing Capability 三项条件；Bug、需求中的 Bug 类问题及现有功能优化支持，新增业务功能暂不支持；按需通过 `codebase-explorer` 补充工程证据，不要求在准入阶段完成 Root Cause 或技术方案。

### Triage Decision

`accepted`、`needs_human`、`unsupported` 的语义由 [Wayfinder Instructions](agents/wayfinder-agent/instructions.md) 定义。本项目典型场景：已定位授权 Repository 但 Root Cause 未明，可进入后续专业分析；多候选系统无法消歧或权限待授权，需 Human 补充；外部封闭系统已确认禁止修改且无可行授权路径，则属于明确硬性排除。复杂度、Repository 数量或单一工具故障不能独立证明不支持。

**交接顺序**：先按 [Wayfinder Instructions](agents/wayfinder-agent/instructions.md) 确认有效 Decision 已记录在 `/note`，再执行 `rondo delivery admission --issue <KEY> --decision <accepted|needs_human|unsupported>`。CLI 不解析 Comment 正文；仅 accepted 执行目标映射、Assignment 与 Run 校验，其他分支保留 Wayfinder Assignee，分别设置 blocked / unsupported，不启动新 Run。

Decision Comment 的内容、来源版本引用和有效性判断统一遵循 [Wayfinder Instructions](agents/wayfinder-agent/instructions.md)。本场景以原 Issue 的 `/note` 为交付事实入口，按需引用工程 Evidence，不新增独立 Triage Artifact 或平行事实源。

**Decision 消费：** Workitem Analyst 读取当前有效 `/note` Decision 及 Evidence 时遵循 [Wayfinder Instructions](agents/wayfinder-agent/instructions.md)，不得凭 Comment 自述推断 Root Cause 或已获研发批准。明确直接委派、未经过准入的 Analysis 不需要补造 Decision。

交接前核对来源版本并确认 `/note` 持久化；目标更新、预期 Run 回读及 UNKNOWN 恢复由 `rondo delivery admission` 执行。未经确认不报告交接成功。

初版不自动重评估已移交 Squad、`needs_human` 或 `unsupported` 的 Issue；TFS Changed Date 增量同步只更新来源字段。

**来源实质变更复核（不新增 Gate）**：Workitem Analyst 在提交 `analysis_review` 前、Delivery Lead 在依据 Human APPROVED 提交批准基线或启动 Development 前，应核对当前 `tfs.changed_at` 与本轮 Analysis 所依据的来源版本。版本发生变化时，读取来源差异并判断：仅备注、排期等不影响 Engineering Contract 的管理变更，记录差异后可继续；影响需求目标、Expected Behavior、交付范围、系统归属、授权或验收要求的实质变更，必须先复核或更新 Analysis / OpenSpec Contract，并按既有 Human Review 规则处理受影响的批准边界，不得基于旧结论启动研发。无法确认变化性质时停止推进并澄清。不要求自动重跑 Wayfinder，也不增加独立状态、脚本或 Gate。

人工补充或能力扩展后的重新准入沿用原 Issue。Human 补充 Comment 后通过 Multica 原生 Comment Trigger 唤醒 Wayfinder；Wayfinder 增量评估、在触发线程记录新 `/note`，结果不明时回读，由 Wayfinder 调用 `rondo delivery admission` 执行本次 Decision。Human 不需先改 `todo`。

**`unsupported` 恢复边界**：以当前 Workspace 实际有效的终止 Status 为准（当前 Manifest 将 `unsupported` 定义为 `cancelled` Category）；该分支的 Comment 唤醒与恢复仍需独立验证，结果不明时停止。

---

<a id="delivery-start"></a>

## 4.2 Issue（交付事项）启动

自动 TFS 入口的 Issue 需有已确认的 `accepted` Decision，再由 Wayfinder 调用 `rondo delivery admission` 完成 Assignment Trigger 交接，启动 Bug Fix Agent 或 Delivery Lead；此动作只进入 Analysis，不构成 Human Approval 或编码授权。明确直接委派的 Analysis 不以 Wayfinder Decision 为前置。

已通过准入的 Requirement `todo + Squad` Issue 由 Multica 原生 Assignment Trigger 自动启动 Lead。Bug Issue 则直接启动 Bug Fix Agent，不进入下述 Squad 分析路径。首次进入交付流程且尚未开展 Analysis 的 Issue，由 Delivery Lead 直接通过 `@mention` 将专业分析工作交给 Workitem Analyst：

```text
Issue（Wayfinder accepted + Comment 已验证）
assignee = Delivery Squad
        ↓
单次 Assignment Update 自动启动
        ↓
Multica 启动 Delivery Lead
        ↓
Delivery Lead 按 Squad 协作规则
        ↓
@Workitem Analyst
        ↓
Workitem Analyst 按需组合专业 Skill
```

本阶段不设置独立 `start-analysis.py` 或通用启动 Router。原生 Assignment / Mention 与触发边界见 [指导手册：Assignment](01-multica-openspec-design-guideline.md#mechanism-assignment)、[Comment / Mention](01-multica-openspec-design-guideline.md#mechanism-comments)。

职责边界：

```text
Multica
= Issue 启动与 Squad Leader Run

Delivery Lead
= 初始成员协调与 @mention

Workitem Analyst Instructions + 当前绑定 Skills
= Analysis 专业判断、工程准备与停止条件

Analysis Gate
= Analysis 产物与硬条件校验
```

已有 Analysis、Review、Development 或其他执行进展的 Issue，再次唤醒 Delivery Lead 时应根据当前事实继续协调，不因重新进入 Leader Run 而重复启动首次 Analysis。

Delivery Lead 遵循 Multica Squad 原生协议处理当前协调与派发，派发后结束本次 Run。Workitem Analyst 在 `analysis-publish` 中拥有提交审核状态的有限写入职责，见 [§5.4](#section-5-4)；Issue 的 Squad Ownership 不要求每次状态写入都重新唤醒 Leader。项目不复制额外的启动状态机。

---

<a id="delivery-status"></a>

## 4.3 Issue（交付事项）状态模型

当前 Delivery 生命周期使用 Multica Issue Status 作为面向人的主要可见状态。准入前的 `todo / in_progress` 属于 Wayfinder Run；准入完成后才进入正式 Delivery 生命周期。

推荐核心状态：

```text
backlog
→ todo
→ in_progress
→ analysis_review          # Display Name: Analysis Review
→ in_progress
→ in_review            # PR 已提交，等待 TFS 终态；abandoned 时进入 blocked
→ done
```

入口准入例外：`needs_human → blocked`；`unsupported → unsupported`（自定义终止状态，当前 Manifest 为 `cancelled`）。`accepted` 不是状态 Key，成功交接后对应目标 Agent / Squad 持有的 `todo` Issue。二者与正常 Human Analysis Review 的 `analysis_review` 互不替代，禁止把审核等待改为 `blocked`。未创建并回读自定义 `unsupported` Status 前不得假设其在 Workspace 已可用。

其中：

```text
analysis_review
```

是正式 Status Key，Display Name 为 `Analysis Review`，category=`started`，用于正常的 Analysis Human Gate。名称以[指导手册 §1.4.7](01-multica-openspec-design-guideline.md#status-terminology) 为准；原生自定义状态能力及不继承特殊行为的边界见 [指导手册：自定义 Issue Status](01-multica-openspec-design-guideline.md#mechanism-custom-status)。

正常 Human Analysis Review 使用 `analysis_review`，不使用 `blocked`。

Issue Status 与 Agent Run 生命周期分离（[原生机制](01-multica-openspec-design-guideline.md#mechanism-issue-run)）；Run 完成不等于 Issue 自动完成。进入 `analysis_review` 由 Workitem Analyst 的 `analysis-publish` 写入并确认；人工审核后的离开动作由 Delivery Lead 组织。批准研发与退回分析都可能写入 `in_progress`，该状态本身不能证明已经获准编码；具体授权依据和状态转换以 [§6.1](#section-6-1) Human Approve 与 [§6.2](#section-6-2) Human Reject 为准。

---


<a id="section-5"></a>

# 5. Analysis（分析）与 Analysis Gate（分析门禁）


<a id="delivery-analysis"></a>

## 5.1 Analysis（分析）

Analysis 在当前 Issue 内完成，不默认创建 Analysis Child Issue。目标是把需求与问题分析清楚，为后续研发和验证提供依据；技术调查与方案设计服务于这个目标，不以需求已经完整明确为前提。

Issue 在 Analysis 执行期间：

```text
assignee = Delivery Squad
status   = in_progress
```

Workitem Analyst 保留 TFS 来源类型并根据可信证据判断 Technical Change Kind；不额外产生独立 Analysis Route：

```text
TFS Bug / Requirement + 恢复既定行为
→ corrective → 按需 bug-analysis → spec-preparation → corrective-change

TFS Requirement + 主动改变产品行为
→ intentional → 按需 requirement-analysis → spec-preparation → intentional-change

当前授权、证据、工程范围或自动处理能力不足
→ STOP → Delivery Lead / Human
```

TFS Type 属于外部管理事实；Change Kind 属于 Workitem Analyst 的专业判断；Schema 属于已持久化的 OpenSpec Artifact Contract。三者不可混用。Repository、Engineer、文件或 PR 数量不决定 Change Kind，专业能力不是固定步骤链。

## 5.2 Analysis Truth Model（分析事实模型）

本节应用 [指导手册 §1.2 Runtime-Centric Delivery（以运行时为中心的交付） + Artifact-Centric Engineering（以工件为中心的工程）](01-multica-openspec-design-guideline.md#runtime-artifact-principle)，不重新定义全局原则。Analysis 只在 Delivery 生命周期中落实两个权威事实域：

> **OpenSpec = Engineering Truth（工程事实）**
>
> **Multica = Delivery Truth（交付事实）**

```text
Analysis Package
= OpenSpec Change
+ Multica Analysis Handoff Facts
+ Supporting Evidence References（按需）
```

`Analysis Package` 只是提交 Human Review 时的当前有效输入集合，不是新的 Domain Object，也不对应 `analysis-package.md`。Summary 只是从权威来源渲染的展示视图，不成为新的 Truth Source。

### Engineering Truth（工程事实）：OpenSpec

OpenSpec Change 维护后续 Engineer / Verification Executor 需要长期读取的专业技术事实：

| Technical Change Kind | Engineering Truth |
|---|---|
| Corrective | `proposal.md` 中的 Expected / Actual、Root Cause / Evidence、Fix Strategy、Fix / Regression Scope；条件性 Specs；`tasks.md` 中的 Implementation / Verification；必要 Supporting Design / Evidence |
| Intentional | `proposal.md`、Specs / Delta Specs（Requirement + Scenario = Acceptance Contract（验收契约））、`tasks.md` 中的 Implementation / Verification；满足 Conditional Design 条件时包含 `design.md`；必要 Supporting Evidence |

本项目不维护独立 `AC-xxx` / `VR-xxx` Truth。有 Specs 时 Requirement + Scenario 构成 Acceptance Contract；Corrective 合法 `skip_specs` 时由 Proposal Expected Behavior / Regression Scope 与 Task Verification / Evidence 证明修复。Regression / Integration / E2E 是 Verification Method，不属于某个 Agent 的专有 Engineering Truth。

### Delivery Truth（交付事实）：Multica

Analysis Handoff Facts 不是新对象，只表示使用 Multica 原生 Issue / metadata / custom property / comment / run result 等能力保存的最小交付事实。具体字段映射由后续实现设计确定，本设计不引入新的存储、版本、状态或生命周期。

最小事实包括：

```yaml
analysis:
  change_kind: corrective | intentional  # 从当前 Change Schema 推导并登记
  change_ref: ...


  gate:
    result: PASS  # complete 最终真实 Gate 通过后登记
```

实际工程增量的 `analysis.change_kind` 由 `rondo analysis publish` 从通过最终 Gate 的当前 Change Schema 确定性推导并登记、回读，供跨 Run 交接及完成任务统计。它是持久化分类结果，不决定 Skill 顺序或自动化授权。统计完成工作须结合 Issue 的有效完成状态，不以分类字段存在作为完成证据。

专业审查结论与 Independent Verify Recommendation、理由及必要验证重点进入当前 Issue 审核 Comment，不要求结构化 Review Verdict 或 Focus 引用数组。Human Review 后形成的 `verify_agent.required`、Independent Verification Result、Assignment / Owner / Status / Runtime Projection 继续属于 Multica Delivery Truth。

`codebase-explorer`、`requirement-analysis`、`bug-analysis` 与适用专业 Review 表示可组合的专业能力，不要求生成同名 Markdown。Corrective 的 `bug-analysis` Method 将最终确认事实沉淀到 `proposal.md`；Intentional 的 `requirement-analysis` 直接把工程结论沉淀到 Proposal / Specs / Tasks，并仅在 Conditional Design 条件满足时维护 `design.md`。

Verify Agent Recommendation 是实际工程变更的必需输出，但它只决定是否建议增加 **Independent Verify Agent**。`false` 不取消 Task Verification、Change-level Verification、Local Validation 或 Code Review。OpenSpec Native Verify 不是默认强制步骤，仅在当前 Project / Change Contract 明确要求或需要 Change-level consistency audit 时执行。

<a id="section-5-3"></a>

## 5.3 OpenSpec Integration（OpenSpec 集成）

本项目采用 **统一 OpenSpec Change Model + Technical Change Kind（技术变更类型） 分型 Schema**。获准自动交付的 Corrective / Intentional 均使用 OpenSpec Change Identity、工程任务、Git 基线与归档；Schema 表达 Technical Change Kind 的 Artifact Contract，不再维护独立 Analysis Route。超出当前自动处理能力的变更须停止并交 Human。

### 5.3.1 Schema / Artifact Runtime Model（模式 / 工件运行模型）

本方案只描述 OpenSpec 在 Delivery 生命周期中的作用，不复制项目 Schema / Template 的实施正文。公共机制统一引用 [统一规范：OpenSpec Engineering Contract](01-multica-openspec-design-guideline.md#openspec-core-mechanism)，Artifact Generation Context（工件生成上下文）的边界见[该规范 §3.3](01-multica-openspec-design-guideline.md#artifact-instruction-assembly)。

Delivery 视角只需要理解：

```text
OpenSpec Change
    ↓
Schema
    ↓
Artifact definitions + Artifact Graph
    ↓
Template + Instruction
    ↓
Proposal / Specs / Design / Tasks
    ↓
OpenSpec Apply readiness
```

其中：

- Artifact 是持续保存并由后续角色消费的 Engineering Truth；
- Template 定义 Artifact 的输出结构，Instruction 定义该 Artifact 的生成语义；
- `artifact.requires` 定义 Artifact 构建依赖，`apply.requires` 定义 OpenSpec Apply 前置；
- OpenSpec 根据当前 Change / Schema 解析 OpenSpec Artifact State，并提供目标 Artifact 的生成语义及依赖上下文；Multica Agent Run 同时消费自身 Runtime Context，两类 Context 的 Owner 与生成机制不同；
- Schema / Artifact Graph 不表示 `Analyst → Engineer → Verify → PR` 的 Delivery Workflow，也不拥有 Human Approval、Assignment、Status 或 Verify Decision。

因此，OpenSpec `status / instructions / validate` 及原生 Apply readiness / task tracking 提供的是 Engineering Contract 的工件状态、生成与读取上下文、校验、进度信息，不是 Multica Issue Status 或 Delivery Gate。本项目**不调用 `/opsx:apply` 执行研发**；实际任务执行使用 [04](04-engineer-development-design.md) 的 `development-execution`，只消费批准范围。项目 Schema、Templates、当前任务编号定位、Validation 与 Archive 的实施细节以 [05-openspec-schema-implementation-design.md](05-openspec-schema-implementation-design.md) 为权威来源。

当前正式映射：

```text
Technical Change Kind = corrective → schema = corrective-change
Technical Change Kind = intentional → schema = intentional-change
```

| Technical Change Kind | 分析与工件准备能力（按需） | OpenSpec Schema | 交付依据与检查重点 |
|---|---|---|---|
| `corrective` | `bug-analysis`、`spec-preparation`、`analysis-publish` | `corrective-change` | 已确认 Expected / Actual、Root Cause / Evidence、Fix Strategy、Regression Scope；Specs 可合法跳过，Tasks 承载实施与验证 |
| `intentional` | `requirement-analysis`、`spec-preparation`、必要专业 Review、`analysis-publish` | `intentional-change` | Proposal、适用 Specs / Design、Tasks 与 Verification Contract；仅在原生契约允许且行为没有变化时才能跳过 Specs |

Corrective 是否形成 Delta 取决于是否需要补录长期行为规格；主动改变 Expected Behavior 必须重新确认 Change Kind、适用 Schema 和 Human 批准边界。所有 Change 均由项目根仓版本管理：
```text
openspec/schemas/corrective-change/
openspec/schemas/intentional-change/
```

`corrective-change` Artifact Graph（工件依赖图）：

```text
   proposal
      ↓
 specs / skipped
      ↓
    tasks
```

`apply.requires = [proposal, specs, tasks]`。`bug-analysis` 不再是 Schema Artifact；复杂修复确有额外设计时由 Corrective Proposal / Handoff 显式引用 Supporting Design。

`intentional-change` 保留：

```text
             proposal
             /      \
    specs / skipped  design [conditional]
             \      /
              tasks
```

按 [05 §6.3](05-openspec-schema-implementation-design.md#section-6-3)，`tasks.requires = [specs]`，`apply.requires = [tasks]`；Specs 合法 skipped 时满足依赖。Design 为 Conditional Artifact，不作为 Tasks 的原生硬依赖；专业分析认定需要 Design 时，由 Preparation 在形成 Tasks 前生成，Analysis Gate 核对生成 / 省略依据及必要内容。条件不满足时省略，不引入 `skip_design`。图中 Design → Tasks 仅表示存在 Design 时的内容输入，不表示原生硬依赖。

当前 `tasks.md` 允许：

```text
Implementation Task
Verification Task
```

每个 Implementation Task 必须说明自己的验证方式；只有必须组合多个 Task / Module / Repository / System / User Journey 才能证明的行为才增加 Change-level Verification Task。Verification Task 仍属于 Engineering Truth，不等于 Verify Agent、Sub-Issue 或 Delivery Stage。

OpenSpec Native Verify 用于 Artifact-to-Implementation 的 Completeness / Correctness / Coherence 检查；它不自动替代真实 Runtime / Integration / E2E，也不等于 Independent Verify Agent。Corrective `skip_specs` 时 Spec-dependent checks 不适用，不能伪装为 PASS。

当前锁定 OpenSpec `1.13.2`。Change Identity 的查找、创建与恢复、共享 `tasks.md` checkbox 的受控串行更新，以及 Schema / Template 的实施细节统一以 [05-openspec-schema-implementation-design.md](05-openspec-schema-implementation-design.md) 为实现基线。

Workitem Analyst 与 Engineer 保持独立 Agent / Run。Human 明确批准后提交当前 Change 到根仓记录 Development 起始基线；批准范围内可以细化 Design / Tasks / Verification procedure，实质改变批准的 Requirement / Scenario、Corrective Expected Behavior / Root Cause / Fix Strategy / Regression Scope、Scope 或验证强度时返回 Human Review。

```text
业务代码 Repository Change → Branch / Commit / Push / PR
OpenSpec 根仓产物 → Git 跟踪与 Commit，不创建独立 PR，不进入 required PR 集合
```

`Schema Validate PASS`、Artifact Graph Complete、OpenSpec Apply Ready、Analysis Gate PASS、Human Approved、Development Ready 与 Independent Verification PASS（required 时）必须分别判断；不能仅凭 CLI 退出码或 Apply Ready 推断项目准入。


<a id="section-5-4"></a>

## 5.4 Analysis Gate（分析门禁）

存在实际工程增量时，Workitem Analyst 使用 `analysis-publish`，由 `rondo analysis publish` 执行最终真实 Gate、发布固定来源及写入审核状态；按需使用只读 `validate` 诊断。Gate 本身只返回检查结果，详细执行契约见 [03 §12.1 Analysis Publish](03-workitem-analysis-design.md#analysis-publish)。

Analysis Gate 的公共检查和不同 Change Contract 的细项统一引用 [03 Analysis 方案 §11.2](03-workitem-analysis-design.md#analysis-gate)。整体专业准备与确定性检查至少应满足以下条件（并非 CLI 逐项自动检查）：

```text
Delivery / TFS identity、Change Kind 与已持久化 Schema 一致
当前唯一 OpenSpec Change 与 Schema 可确认
Development Scope / Repository Scope 可读取
当前 Acceptance Contract 可读取：Intentional 为 Requirement / Scenario；Corrective 为 Proposal Expected Behavior / Regression Scope，存在 Specs 时一并读取
每个 Implementation Task 有验证方式；需要组合验证时存在 Change-level Verification Task
审核 Comment 提供有依据的独立验证建议及必要验证重点
Evidence References 可追溯
适用 OpenSpec Artifact 与原生 Validation 满足当前 Schema
Analyst 已完成适用专业 Review / Consistency Check，无未解决的关键问题
```

Corrective 的 Expected / Actual、Root Cause / Evidence、Fix Strategy、Fix / Regression Scope 与 Tasks / Verification 一致性，以及 Intentional 的 Proposal / Specs / Tasks、Conditional Design 判断，由 Analyst 专业复核；CLI 只检查适用的确定性条件，不消费 Analyst 自报的专业审查结果。Gate 不要求 `bug-analysis.md`、`acceptance.md`、`verification-requirements.md` 等重复载体。

专业结论由 Analyst 负责；Artifact 存在或 Validation PASS 不替代语义判断。Gate 的 PASS 结果须能核对 Issue / Workspace、Change Kind / Schema 与当前 Change 工件摘要；Publish 直接消费指定 Change，执行真实 Gate 并确认候选 Git 契约一致及发布可达性；核对服务端冲突事实后登记 Facts、Source 和本次 PASS，再提交 `analysis_review`。不落盘 Gate Result。结果引用与摘要只是本次确定性校验证据，不创建新的审批状态、版本对象或重复技术事实。成员选择及 `task_refs` 分工在 Human Review 后由 Delivery Lead 处理，不作为 Analysis 的必交输入。

统一结果：

```yaml
result: PASS | FAIL | UNKNOWN
reasons:
  - ...
```

处理：

```text
FAIL
→ 当前 Workitem Analyst 按缺失项 targeted rework

UNKNOWN
→ 停止提交，交 Delivery Lead / Human 澄清必要事实

PASS
→ Workitem Analyst 发布逻辑 Analysis Package 的引用、Multica Analysis Handoff Facts 与 Gate 结果
→ 在 analysis-publish 中写入 Issue.status = analysis_review
→ 回读确认状态与产物引用
→ 结束本轮分析执行，等待 Human Review；不得自动进入研发
```

`analysis_review` 的 Key / Display Name / category 不变。Gate PASS 不生成 `verify_agent.required`，也不表示当前 Change 已获准编码。


<a id="human-analysis-review"></a>

# 6. Human Analysis Review（人工分析审核）

`analysis_review`（Display Name：`Analysis Review`）是 Issue 的正式 Human Gate。

进入审核时：

```text
assignee = Delivery Squad
status   = analysis_review
```

Human Analysis Review 审核完整逻辑 Analysis Package（OpenSpec Change + Multica Analysis Handoff Facts + Supporting Evidence References），包括：

```text
Requirement / Problem Goal、业务场景与行为规则
Expected Behavior、需求 / 修复范围及不在范围内的内容
Root Cause / Solution / Fix Strategy（按 Change Kind）
Repository Scope
Acceptance Contract
Verification Contract
技术依赖、约束与研发准备
技术拆分建议（如有）
Verify Agent Recommendation
Risks / Open Decisions
```

不再维护第二套：

```text
analysis.review_status = waiting | approved | rejected
```

Human 可以通过自然语言顶层 Comment 表达审核意见，沿用 Multica Squad 的评论回流交给 Delivery Lead（[原生评论路由](01-multica-openspec-design-guideline.md#mechanism-comments)）。`APPROVED` / `REJECTED` 在本文表示批准 / 退回的业务含义，不是强制输入格式；人无需填写固定字段或 JSON。

Human 作出决定；Delivery Lead 结合本次评论、当前逻辑 Analysis Package 与相关上下文理解决定和条件，不重新代替人评审。方法放在现有 `delivery-flow` Skill；原生工具和必要脚本只负责明确后的硬条件检查、写入与恢复，不先由脚本解析自然语言再等 `UNKNOWN`。具体边界见 [§6.3](#section-6-3)–[§6.4](#section-6-4)。

审核沿用当前逻辑 Analysis Package、Human Comment 和 Human Review 流程，不引入 revision / hash 绑定或审批快照。批准后的实质性方案变更必须回到既有 Analysis / Human Review 流程，不得直接视为已经获批。相关 Spec、Design、Tasks、Acceptance / Verification Contract 应按影响范围一并更新；即使代码 Commit 未变，规格场景或验收要求的实质变化也必须按 [§9.7](#section-9-7) 重新判断旧 Evidence 的有效性。

<a id="section-6-1"></a>

## 6.1 Human Approve（人工批准）

Human 明确允许当前分析进入研发，例如：“方案没问题，按当前范围开始开发。”这是表达示例，不是固定口令。

Delivery Lead 读取本次真实 Human 评论及相关上下文，确认所指对象、批准范围和前置条件；只认可方向、要求补充后再审或授权不明时，不进入本分支。批准带有明确前置条件时，必须先满足条件；涉及分析内容的实质修改仍按既有重新审核规则处理。

```text
Human 明确批准当前分析进入研发
→ Delivery Lead 理解决定、条件与范围，保留原始评论引用
→ 核对任务身份、审核来源权限、当前处理阶段与有效 Analysis Gate PASS
→ 所有已获准交付的 Change：提交已批准 OpenSpec Change / 分析交接基线到根仓并确认（不创建 PR）
→ 通过原生工具 / 必要执行封装写入 in_progress，回读确认
→ Delivery Lead 组织 Development 协作安排 / Materialization
```

本分支由 Delivery Lead 在当前 Run 组织执行。状态写入不额外派发 Run；后续专业工作只使用现有唯一正常派发入口。Corrective Change 同样记录已批准 Change 基线，但不补跑 Intentional 的需求分析或独立 Review。硬条件明确不满足时停止；必要事实或授权意图不清时保持审核等待并澄清，不以自然语言同意绕过 Gate `FAIL`。

Human `APPROVED` 表示接受当前逻辑 Analysis Package 中的需求 / 问题目标、业务场景与规则、Expected Behavior、需求 / 修复范围、Root Cause / Solution、关键约束、Acceptance Contract、Verification Contract 及当前 Verify Agent 决策；获准交付的 Change 均同时接受当前 OpenSpec Change 的适用产物、任务与需求 / 修复边界。

Verify Agent Recommendation 由 Workitem Analyst 首次提出，Human Analysis Review 拥有最终决定权。Human 可以接受 Recommendation，也可以仅对独立验收要求进行 override：

```text
Workitem Analyst Recommendation
→ true | false
        ↓
Human Analysis Review
├─ accept recommendation
└─ override recommendation
        ↓
Final Independent Verification Decision
        ↓
verify_agent.required = true | false
```

仅改变“是否需要 Independent Verify Agent”且不改变 Acceptance Contract、Verification Contract、Scope 或 required Verification Tasks 时，不要求返回 Analysis；Delivery Lead 理解 Human 决定，使用 `rondo analysis approve` 引用真实批准评论、获批 Commit 和明确的独立验收决定，由 CLI 核对 Gate、登记 `analysis.human_approval` 并投影、回读 `verify_agent.required`。对同一获批 Change 的新决定，在允许的研发状态下更新批准事实，不重新派发已有效委派的工作。缺失、冲突或无法确认时不从 Analyst Recommendation 自动推断最终决定。Human 可明确批准具体已列任务在本轮不执行，由 Delivery Lead 使用 `rondo analysis approve --waive-tasks <refs>` 将完整豁免集合登记在 `analysis.human_approval.waived_tasks`（可选编号数组，缺省为空；复用批准评论及获批 Commit）。CLI 核验编号属于固定批准版 Tasks；同一评论的决定不可改写。Task Waiver 不等同于 Independent Verification 决定，也不取消必要 Candidate Validation 或 Code Review。若 Human 意见实质改变验收行为、必须满足的 Verification Contract 或批准 Scope，须返回 Workitem Analyst 定向更新 Engineering Truth 并重新 Human Review。

已获准交付的 Approved OpenSpec Change 在进入 Development 前提交到根仓 Git，记录已批准的开发基线。Git Commit 不禁止批准边界内的设计细化和任务更新；需要改变已批准行为、范围、关键技术约束或验收要求时，仍返回既有 Analysis / Human Review。该 Commit 不创建独立 PR，也不进入业务 required PR 集合。

**根仓 Git 提交时点**：初始批准基线先提交；研发期间获准的 OpenSpec 修改保存到同一个已登记、跨 Run 可读取的持久共享根仓工作区；最终由 [§12.4](#final-completion) 的 Finalize 统一提交当前 Delivery 的授权变更及归档结果。Engineer 不为每个 Task Set 提交根仓，Task Set 完成不以最终根仓 Commit 为前置。交接须区分批准基线、后续受控修订及尚未提交的进度，不能将未提交修改当作 Git 历史；该安排不取消实质契约变化的重新审核要求。

Delivery Lead 在这些批准边界内组织成员与任务，不等于重新审批技术方案，也不默认增加第二次分工审批：

| 协作决定或变化 | 处理 |
|---|---|
| 选择符合要求的具体成员 | Delivery Lead 结合当前 Roster 决定 |
| 将技术工作组织为一个或多个独立工作项，且不改变批准范围、技术约束和验收要求 | Delivery Lead 决定，按需物化 |
| 技术条件允许时安排并行或顺序执行 | Delivery Lead 决定，不机械把调用关系转为完成依赖 |
| 改变 Expected Behavior、外部 Contract、技术方案的实质结论或已批准 Scope | 返回 Workitem Analyst / Human |
| 删除或改变 Acceptance / Verification Contract、范围或已批准的必要任务 | 返回既有 Analysis / Human Review，不得自行放宽 |
| 仅更改额外 Independent Verify Agent 的最终决定、技术验收范围不变 | 由有权 Human 明确决定，记录 Comment / Override；无需修改 OpenSpec 工件 |
| 现有技术假设不成立，必须改动技术方案才能推进 | 由相应 Specialist 补充事实，返回 Workitem Analyst / Human |

如果当前任务明确要求 Human 批准人员分工、执行顺序或某项拆分方式，该明确要求同样属于批准边界；不得以“协作决定”为由绕过。技术拆分建议本身不自动冻结 Sub-Issue 数量或 Agent 配置，已批准的强制技术约束则必须保留。

Workitem Analyst 不允许自行批准自己的 Analysis。

<a id="section-6-2"></a>

## 6.2 Human Reject（人工驳回）

Human 明确不接受当前分析或要求先修改再审，例如：“根因判断不对，先排查缓存失效，再把修订结果给我看。”无需填写 `Reason / Expected Change` 标签，但反馈须足以确定当前修正工作；不足时由 Delivery Lead 询问具体缺口，不自行编造拒绝理由。

```text
Human 明确要求退回 / 修改分析
→ Delivery Lead 理解反馈，保留原文引用与修正方向
→ 核对当前对象、来源权限与执行事实，准备定向返工输入
→ 写入 Issue.status = in_progress，回读确认，不另行触发 Run
→ 在当前 Issue 中 @Workitem Analyst 一次
→ Workitem Analyst targeted rework；不得据此启动编码
```

退回是有效的人审决定，不是脚本失败；不要求当前 Analysis Gate 仍为 PASS 才允许修正。返工输入包括原始反馈、明确要求和受影响内容，不把 Lead 的推断冒充人工要求；已派发或已完成的同一修正请求不重复派发。

Workitem Analyst 消费原始反馈和明确修正要求，按 [03 Analysis 方案 §12.3](03-workitem-analysis-design.md#analysis-rework) 定向修正 Context、问题 / 需求结论、相关 OpenSpec、验证要求及 Verify 推荐；不在本方案维护第二份专业方法映射。

修正完成后重新：

```text
Workitem Analyst 执行 analysis-publish
→ 当前 Change 的 Analysis Gate PASS
→ 发布修订结果并写入 analysis_review，回读确认
→ 结束本轮返工，等待 Human Analysis Review
```

Reject 不触发整套 Analysis 无差别重跑。针对已经批准的 Analysis，仅涉及成员选择或协作安排、且不改变批准边界的反馈，由 Delivery Lead 处理，不要求 Workitem Analyst 为修改 Agent 分工重新执行专业分析。明确的 `REJECTED` 仍按既有审核流程处理，不得视为已批准并直接启动研发。

<a id="section-6-3"></a>

## 6.3 Human Comment（人工评论）理解与停止边界

人工分析审核采用自然语言。Delivery Lead 直接读取本次待处理评论、作者 / 来源、当前 Issue 和 Analysis Package、相关问答及已有执行记录，理解否定、附加条件、修正范围和是否需要再次确认。这是正常语义工作，不以脚本先返回 `UNKNOWN` 为前提。

| 人工意见 / 当前情况 | 处理 |
|---|---|
| 明确同意当前分析进入研发，且前置条件满足 | 按 [§6.1](#section-6-1) 执行；不由 Lead 再次批准方案 |
| 明确拒绝或要求修改分析，方向足以执行 | 按 [§6.2](#section-6-2) 定向返工，不将退回当作研发授权 |
| “方向可以，但补充后还要我再看” | 只执行明确要求的分析修订；仍需再次 Human Review，不启动研发 |
| 普通问题、备注或补充信息 | 回答或保留上下文；`NO_ACTION` 表示不据此转换流程，不自动当作批准或拒绝 |
| 是否允许推进、附加条件、对象或决定存在歧义 / 冲突 | 先澄清；分析审核保持 `analysis_review`，不自动设置 `blocked` |
| 同一评论 / 修正已处理，或本次通知只是重复唤醒 | 回读现有产物、状态与 Run；复用结果或补未完成动作，不重新批准、提交或派发 |

当前批准必须能追溯到真实 Human 意见及其所指内容。引文、历史决定、Agent 自述和仅出现某个关键词不能作为新授权；新的有效意见与旧记录冲突时先确认当前决定，不按“最后出现的单词”路由。普通讨论发现新的专业问题时可以协调澄清，但仍不构成研发批准。

`NO_ACTION` / `UNKNOWN` 是本次处理说明，不是新增 Issue Status 或审批状态。Lead 将自然语言理解结果整理为交接说明或结构化调用参数，只是执行输入；它不因此成为由程序证明正确的审核事实，不能用 `approved=true` 取代原始人工依据。必要批准未取得或 Gate 明确 `FAIL` 时，仍禁止推进。

本节自然语言审核接入针对 Analysis。PR Abandoned 的合法 `NEXT` 动作和 `route-human-decision.py` 输入契约仍按 [§11.2](#section-11-2)；其普通讨论、意图不明和禁止关键词误触发遵循本节原则，本次不改变该专用路由协议。

<a id="section-6-4"></a>

## 6.4 执行边界与恢复

| 主体 | 承担的职责 |
|---|---|
| Human | 作出批准、退回以及必须由人确认的取舍 |
| Workitem Analyst / `analysis-publish` | 实际工程增量通过 Gate 后发布固定来源，写入并确认 `analysis_review`；无需工程增量直接记录普通 Comment，提交细节见 [03 §12.1 Analysis Publish](03-workitem-analysis-design.md#analysis-publish) |
| Delivery Lead / `delivery-flow` | 理解人审意见及条件，保留来源和必要摘要，组织批准后的研发或退回后的分析修正 |
| Gate | 检查当前适用的硬条件并返回结果；不修改审核状态、不批准分析 |
| 原生工具 / 必要执行封装 | 核对可确认的身份、来源、状态和已执行动作；完成已明确授权的 Git / 状态写入并回读，不解释自然语言或替代 Human 决定 |

不设置人工分析审核的必经评论解析脚本。明确动作优先使用原生 CLI / API；仅当已有硬条件、幂等或恢复需要时复用必要封装，不为解释文本新增规则引擎或另一套审批状态。

现有 Comment / Run / Handoff 中保留本次 Human 评论引用、Lead 理解的动作与条件、已经完成及仍待处理的动作。评论 ID / 原始引用用于追踪，不建立 revision / hash 审批绑定或独立状态表。工具结果必须区分实际写入成功、失败和结果未知；理解为“批准”不等于提交、改状态或派发已经完成。

状态更新使用安装版本已确认的请求级暂不启动能力（[统一规范：Assignment / 暂不启动](01-multica-openspec-design-guideline.md#mechanism-assignment)），与后续唯一派发分开。若 API 超时，先回读当前状态、Git、原生 Run 及已有交接记录，只补缺失动作；不得盲目重复 `@mention`、Rerun 或将已推进的状态改回审核。原始批准仍适用且只是执行中断时，不重复索取人工批准。

`in_progress` 同时用于获准研发和分析返工，不能单独当作批准证据。Leader 和下游入口必须结合人审来源、明确决定及当前交接范围确认本次工作；事实无法对应时停止澄清。

## 6.5 提交与人工审核验收

以下为后续 Skill / 工具适配的验收要求，本次文档更新未执行运行测试：

| 场景 | 验收要求 |
|---|---|
| Analysis Gate PASS，产物发布和状态写入成功 | Workitem Analyst 回读 `analysis_review` 并结束；不专门唤醒 Lead 只为改状态，不开始编码 |
| 发布失败、状态写入失败或响应超时 | 不宣称提交成功；核对已完成部分后恢复，不重复发布或覆盖后续人工动作 |
| 发布 / 原生回流使 Lead 再次运行，但没有 Human 决定 | 保持审核等待，不启动研发或循环委派分析 |
| 自然语言明确批准，不含 APPROVED 关键词 | Lead 正确理解，满足 Gate 与条件后按批准事实执行，不要求改填格式 |
| 自然语言要求修正，不含 REJECTED / Reason 标签 | 反馈足够时定向返工；不足先澄清，不编造修正方向 |
| 有保留意见，明确要求补充后再审 | 不当作开发授权；修订后再次提交 Human Review |
| 普通提问、引文包含 APPROVED、Agent 声称获批 | 不据此放行；问题正常答复，批准来源仍为 Human |
| 人工同意但 Gate FAIL、必要授权或输入缺失 | 保留停止条件，不用语义理解绕过硬条件 |
| 重复评论、重复 Run 或状态已经 in_progress | 根据当前人审依据与已执行事实处理，不重复派发；不能靠状态推断是研发还是返工 |
| Corrective 提交及审核（分别验证） | 轻量 Change 与根因 / 修复依据一并审核，批准后提交根仓基线；不新增审批或完整 requirement-review |

---


<a id="development-materialization"></a>

# 7. Development Runtime Projection（研发运行时投影）与交付单元

Human Analysis Review APPROVED 后，Delivery Lead 读取已批准 OpenSpec Change、`tasks.md`、技术依赖、当前 Squad Roster，以及 Multica 中的批准 / Gate / Verify 决策事实，在当前 Issue 内组织研发执行。

工程任务以 OpenSpec Tasks 为准。一组分配给 Engineer 的 Tasks 用 `task_refs` 引用，不建立额外的 Task Set 状态对象或子 Issue。

```text
OpenSpec Tasks
    ↓
Delivery Lead 按 Roster 选择 Engineer
    ↓
当前 Issue 内 @mention Engineer + task_refs
    ↓
Engineer Run + Development Evidence / Completion Facts
    ↓
Delivery Lead 在当前 Issue 聚合
```

**当前派发原则：**

- 当前 Issue 保持 `Delivery Squad` 作为 Assignee；内部角色协作使用 `@mention`，不为分工切换 Issue Ownership。
- 同一 Issue 中同一业务 Repository 的全部 Task Sets 由同一名当前有效 Engineer 承接，允许分组或分次执行；不同 Repository 可由不同 Engineer 并行。
- 有效派发不得重叠；换 Engineer 前先确认旧 Run 已结束，并按当前 Task / Evidence 事实交接，不因切换角色而创建新 Issue。
- 任务数量、Repository 数量、多个 PR、跨前后端协作或普通技术依赖都不构成额外创建 Issue 的理由。
- 技术依赖体现在 OpenSpec Tasks、Design 与本轮派发安排；不为普通执行顺序创建 Stage。
- 必要硬条件、幂等和副作用由现有 `rondo dev materialize` 的默认 `parent` 路径处理；现存 `sub-issue` 分支不进入当前常规协作。

派发提供本轮必要的 `change_ref`、`task_refs`、批准依据、Repository / Scope、适用 Artifacts 与 Evidence 引用。专业成员应能够在独立 Run 中读取当前版本，不能依赖前序 Agent 临时会话。

<a id="development-activation"></a>

## 7.1 Current Issue Runtime（当前事项运行时）

Delivery Lead 可以在同一 Issue 内向不同 Repository 的 Engineer 分别发送原生 `@mention`，但同仓始终保持单一有效 Engineer。每个 Task Set 只选择一个启动入口，不重复 Mention / Rerun。

Engineer 完成工作后在同一 Issue 返回与 `task_refs` 关联的 Development Result / Evidence，Delivery Lead 按当前事实聚合后续工作。

共享 OpenSpec `tasks.md` 的 checkbox 更新仍应遵循 [05 §11](05-openspec-schema-implementation-design.md#task-progress-update) 的受控串行写入；工程完成检查、Patch / 回读、READY 的顺序沿用 [§8](#development-execution)。

<a id="section-7-2"></a>

## 7.2 Legacy Sub-Issue Path（非当前默认交付）

> `rondo dev materialize --projection sub-issue` 等现有代码分支暂时保留，但当前 Delivery Lead 不在普通交付中选择该路径。以下细节仅供已有代码维护和后续专项清理参考，不作为本期新 Issue 创建规则。


需要独立 persistent runtime state 时，按 [§7](#development-materialization) 先查找并复用同仓 Development Sub-Issue；不存在才创建。一个 Sub-Issue 可以承接多个 Task Sets，只有其全部当前 required Task Sets 完成后才允许关闭。创建时直接保存完整执行输入，不先启动空壳：

```text
Parent Issue
+ task_refs
+ Goal / Scope refs
+ Approved OpenSpec Change refs
+ 相关 Spec / Design（适用时）/ Corrective Proposal，以及 Acceptance / Verification Contract 引用（Requirement / Scenario、Corrective Proposal 中的预期行为与回归范围、当前已批准任务编号如 1.1）
+ Owner
+ backlog
+ 必要 Dependency / Stage
```

Sub-Issue Owner 的选择（Specialist-owned / Squad-owned）统一由 [§7.4](#section-7-4) 规定；本节仅落实 Delivery Lead 已明确的 Owner Assignment，不在物化阶段重新判断 Owner。

创建并准备完整后，只有依赖已经满足的 Sub-Issue 才从 `backlog → todo`。已经通过 Sub-Issue Assignment 启动的 Task Set，不再在父 Issue `@mention` 同一 Engineer执行相同 `task_refs`。

<a id="section-7-3"></a>

## 7.3 准备失败、恢复与安装版本验收

| 当前情况 | 处理 |
|---|---|
| Parent Runtime 派发结果未知 | 先读取当前 Run / Comment 事实，不立即重复 Mention |
| Sub-Issue 已创建但输入不完整 | 保持 `backlog`，补齐后回读，不激活 |
| Sub-Issue 激活结果未知 | 查询 Issue / Run 后恢复，不重复 Assignment / Mention / Rerun |
| task_refs 无效、范围重叠冲突或依赖无法确认 | `FAIL` / `UNKNOWN`，交 Delivery Lead 修正 |
| 同仓多个 Engineer、重复 Sub-Issue 或父 / 子入口重叠派工 | 暂停冲突工作，按 [§7](#development-materialization) 恢复唯一责任和入口，不在 PR 阶段补救 |
| 共享工作区修改丢失或关键 Evidence 不可读 | 停止自动推进，交 Delivery Lead 协调恢复；不得凭旧 READY 自动补勾 |
| 身份 / 权限 / 外部结果无法可靠确认 | `UNKNOWN`，停止相关副作用 |

安装版本至少验证：

```text
父 Issue @mention 一个 Engineer
父 Issue 分别 @mention 多个 Engineer
创建带 Owner 的 backlog Sub-Issue 不启动 Specialist
backlog → todo 产生预期 Specialist Run
原已 done 的 Development Sub-Issue 重开至非完成状态：确认新 Run 的实际触发机制，结果未知时查 Run 且不重复请求
同一 task_refs 不出现双触发
Stage / Parent 回流只针对实际 Sub-Issue
同仓多 Task Sets 复用唯一 Engineer / Sub-Issue；部分 READY 不关闭 Sub-Issue
换 Engineer 前旧 Run 已结束；原 Sub-Issue 复用且不出现两个有效 Owner
不同 Agent / 新 Run 可读取同一共享根仓的受控修改；丢失时停止
```

---


<a id="section-7-4"></a>

## 7.4 Legacy Sub-Issue Ownership（非当前交付路径）

Development Sub-Issue 是可选 Runtime Isolation，不是 Task decomposition。其 Owner 由 Delivery Lead 根据该 Task Set 的持续运行责任选择。

```text
单一专业 Owner
→ Specialist-owned

需要持续多角色协调 / 动态交接
→ Squad-owned
```

Assignment 表达长期 Issue Ownership；`@mention` 表达父 Issue 中的当前请求。不得仅为了“多个 Engineer”“跨仓”或“Tasks 很多”创建 Sub-Issue。

Squad-owned 是 Issue 的协调 Ownership，不豁免 [§7](#development-materialization) 的同仓唯一 Engineer 约束；实际承担同一业务 Repository 实现的 Engineer 仍须唯一。Owner 变化和后续返工保持原 Sub-Issue 的身份与可追溯交接。


<a id="delivery-stage"></a>

## 7.5 Legacy Stage（非当前交付路径）

Stage 只用于 Development Sub-Issues 之间确实存在的**完成依赖**。

```text
技术任务依赖
→ 先体现在 OpenSpec Tasks / Design / 派发顺序

需要以前置 Sub-Issue 的完成状态控制后续 Sub-Issue 激活
→ 使用 Stage
```

不存在独立 Sub-Issue 时，不为了表达普通 Task 依赖创建 Stage。接口契约已经明确且可并行时，前后端可以直接在父 Issue 中分别运行。

Stage 编号不是全局执行锁；父级收到原生回流后仍需检查当前 Task coverage、Evidence、blocker 与已执行动作。


<a id="development-execution"></a>

# 8. Development Execution、Completion & Aggregation（研发执行、完成与聚合）

无论 Runtime Projection 是 Parent Issue Runtime 还是 Development Sub-Issue，Engineer 执行模型相同：

```text
assigned task_refs
    ↓
Ground
    ↓
Implementation
    ↓
Local Validation
    ↓
Code Review
    ↓
Commit / Push
    ↓
PR Preparation
    ↓
Development Evidence
    ↓
Development Completion Check
    ↓
Tasks 完成状态更新
    ↓
核对检查依据 → 当前 Task Set READY
```

`Development Completion Check` 判断的是当前 assigned Task Set 的 Engineering Contract，而不是整个 Delivery：

```text
当前仍需执行的 assigned OpenSpec Tasks 实质完成且有有效验证 Evidence
+ Local Validation PASS
+ Code Review PASS
+ Review Findings 已处理
+ 必要业务代码 Repository Commit / Push 完成
+ PR Preparation 完整
+ Development Evidence 完整
+ 无当前 Task Set blocker
```

已批准取消 / 替换项由受控任务修订保留编号与批准依据，并按 [05 §8.5](05-openspec-schema-implementation-design.md#section-8-5) / [§10.2](05-openspec-schema-implementation-design.md#section-10-2) 转为非 checkbox 历史记录；不要求其实现 / 测试 Evidence，也不虚假勾选。纯验证且无代码修改的 Task Set 按 [04 §7.1](04-engineer-development-design.md#section-7-1) 引用已有 Candidate 及仍有效的 Review / PR Preparation，不要求新 Commit / Push 或重复 Code Review，但本轮要求的验证仍须执行并留存证据。

Check 依据当前 Candidate、批准契约与 Evidence 判断工程实质完成，**不以本轮 checkbox 已勾选为前置**。Check PASS 后在当前 Engineer Run 内连续执行：

```text
按 05 §11 受控 Patch 当前已完成任务 → 回读确认
→ 发布前核对 Candidate、工程契约与派工范围仍符合本轮 Check 依据
→ 写回当前 Task Set READY Completion Fact / Evidence 引用
```

Patch / 回读失败或结果 UNKNOWN 时不得发布 READY；先查当前文件与证据，补缺失动作。有相关实质变化则重新检查受影响范围；仅 checkbox 更新不使检查依据失效。根仓最终 Git Commit 留给 [§12.4](#final-completion)，不是此处 READY 的前置；共享内容丢失时按 [§7.3](#section-7-3) 停止恢复。

当前 Task Set READY 后：

```text
Parent Issue Runtime
→ 保存 task_refs + completion/evidence facts
→ 不将父 Issue 置为 done

Development Sub-Issue
→ 先保存当前 Task Set 结果
→ 该 Sub-Issue 的全部当前 required Task Sets 均 READY 后，才按授权置为 done
→ 使用原生 Parent / Stage 回流
```

Checkbox 不替代工程 Evidence；已勾选任务仍须核对当前候选与契约下的证据有效性。单个 Task Set READY 不表示整个 Repository 的最终 PR Candidate 已形成。

---


## 8.1 Engineer Execution（工程师执行与质量保障）

各专业 Engineer 负责当前 assigned Task Set 的完整 Engineering Contract。所有获准自动交付的 Change 消费当前 Change 的任务与适用产物：Corrective 以已批准根因 / Fix Strategy、既定行为和 Regression Scope 驱动修复；Intentional 以 Spec / Design / Tasks 驱动实现。两者均在批准边界内同步任务、必要设计与验证证据。Feedback-Driven Development、TDD、Local Validation 和 Code Review 继续作为实现与验证方法。

按 [§8](#development-execution) 的适用条件完成以下工程活动；纯验证且无代码修改时复用有效 Candidate / Review / PR 事实：

```text
Ground / 读取已批准 Development Context
Feedback Setup
Implementation
Required Local Validation
Code Review
Review Finding Fix
Development Evidence
Commit
Push
PR Preparation
```

正式原则：

> **Local Validation + Code Review 是 Development 必备环节，与 Verify Agent 是否参与无关。**

Engineer Local Validation 关注：

```text
Targeted Test
Regression Test
Build / Compile / Type Check / Lint
Required Runtime Check
Required Contract Check
```

Code Review 关注：

```text
Specification / Fix Strategy Alignment
Acceptance Contract Coverage
Scope Drift
Repository Standards
Complexity
Contract Risk
Test Quality
Regression Risk
```

Code Review 可以由 Engineer 自检、read-only reviewer subagent 或独立 review Skill 承担，不形成新的隐藏 Development Owner。

全部获准自动处理的 Change 的 `tasks.md` 只承载工程实现与开发侧验证，不以等待 Human、独立 Verify、PR 合并或 Archive 作为 Task Set 完成条件；任务内容边界见 [03 §9.4–§9.5 任务与运行时分工](03-workitem-analysis-design.md#analysis-task-contract)。每个 Task Set 只检查自身承担的必要任务，不等待其他 Task Set 的 checkbox 全部完成。规格覆盖、任务事实及其 Evidence 要求由 [04 §7 验证](04-engineer-development-design.md#development-section-07)、[§10 Evidence](04-engineer-development-design.md#engineering-evidence) 与 [§11 Completion](04-engineer-development-design.md#engineering-completion) 维护，不能仅凭勾选判定实现正确。

Engineer 完成工程工作后提交结构化 Development Evidence，并按本章开头统一的 Development Completion Contract 检查实现、验证、Review Finding、Commit / Push、PR Preparation、Evidence 与 blocker；不再维护第二份完成条件清单。

PR Preparation 由同仓唯一 Engineer 按 [§10.1](#section-10-1) 的统一最小输入契约准备，包含每个 required Repository Change 的分支、候选 Commit、PR Title / Description 及 TFS Work Item / Issue 的关联引用；本节不另建一份字段定义。

不同 Runtime Projection 的完成边界和父级回流已在本章开头统一规定；Engineer 不据此关闭父 Issue，父级下一步由 Delivery Lead 根据 [§8.2](#parent-delivery-aggregation) 当前事实决定。

Engineer 不负责：

```text
决定整个 Delivery 是否完成
决定 Delivery-level Verify 是否 required
派发 Delivery-level Verify Agent 或触发父 Delivery 的 PR Materialization
执行 PR Materialization 的业务语义判断
关闭父 Issue
```

PR Materialization 消费 Engineer 已准备的 PR Facts，由父 Delivery 流程在整体条件满足后调用确定性 capability。

---


<a id="parent-delivery-aggregation"></a>

## 8.2 Parent Delivery Coordination / Aggregation（父交付协调与聚合）

父 Issue 是 Development 聚合点。Delivery Lead 每次被唤醒只读取当前事实并决定尚需做什么：

```text
OpenSpec required Tasks / task_refs coverage
Parent Issue Engineer Run results
Development Sub-Issue current status / results
Unresolved blockers / findings
verify_agent.required
Repository Change / PR preparation facts
```

Development 可以由多个 Parent Issue Engineer Runs 与多个按需 Sub-Issues 共同完成。父级不要求它们具有统一的中间对象。所有 required OpenSpec Tasks 必须有明确的 Runtime Executor / `task_refs` 承接范围，但**进入 Verify 前的聚合只检查 Engineer-side Readiness**，不等待 Verify Agent 自己负责的 Verification Tasks 完成。

进入 Independent Verification / 后续 PR 决策前的 Engineer-side Readiness 条件：

```text
所有 required Implementation Tasks 已完成且有当前有效 Evidence
+ Engineer-owned required Change-level Verification Tasks 已完成且有当前有效 Evidence
+ 对应 Engineer Task Sets 已按 §8 完成 Check → Patch / 回读 → 发布并形成有效 READY
+ 上述 Engineer 工作对应的 required Development Sub-Issues（如有）处于有效完成状态
+ 若 verify_agent.required=true：Verify-Agent-owned required Verification Tasks 已明确分配（可以 pending）
+ 无 unresolved Development blocker
```

以上只是 Verify Agent 的准入聚合结果，**不等于整个 Change 的 required Verification Tasks 全部完成**。父级据此按 [§9.4](#section-9-4) 判断是否启动 Verify Agent；真正进入 PR Materialization 前，仍须按 [§9.8](#section-9-8)、[§10.2](#section-10-2) 检查包括 Verify-Agent-owned Tasks 在内的全部 required Tasks 及有效 Evidence。旧 Run、自述或已失效 Evidence 不覆盖当前事实。

<a id="section-8-2-1"></a>

### 8.2.1 父级协调与原生调度边界

Parent Issue Runtime 的 Engineer 持久化 Development Result / Evidence，并通过经安装版本确认能回流至 Squad Leader 的 Comment / Result 路径交接；Development Sub-Issue 使用原生 Parent / Stage 终态回流。Run 结束或普通回复不必然唤醒 Leader。

当前 Task Set 的结果只有在 [§8](#development-execution) 的 Check、Patch / 回读与发布前核对完成后才有效。共享工作区或关键 Evidence 丢失时停止自动聚合，不以旧 READY 补勾或宣称完成；根仓尚未最终 Commit 本身不使已满足条件的 Task Set 失效。

Delivery Lead 收到回流后核对 [§8.2](#parent-delivery-aggregation) 的当前事实，再决定是否启动 Verify 或调用 PR Script；通知本身不等于 Delivery Ready。回流与失败恢复须验证安装版本，避免重复 Mention / Rerun，不另建通知队列或工作流运行时。

<a id="section-8-2-2"></a>

### 8.2.2 当前事实与副作用幂等

重复唤醒时先读取当前状态：已经完成的 `task_refs` 不重复派发；已存在的 Sub-Issue 不重复创建；已有有效 Run 不重复触发。外部调用超时先查事实再恢复。重复回流无新增待执行动作时，Delivery Lead 结束当前 Run，不重跑已完成的专业工作或副作用。

### 8.2.3 安装版本并发与重试验收

至少验证：

```text
多个 @mention Engineer Run 并行回流
Parent Run + Sub-Issue 混合完成
同一 task_refs 重复派发保护
Sub-Issue done → Parent / Stage 回流
重开后旧 completion fact 不再放行
Parent Issue Result / Comment 的实际 Leader 回流、通知丢失后的恢复
重复回流不会重复启动 Verify Agent Run 或创建 required PR
Sub-Issue / Stage 已完成但父级通知丢失时，可通过经安装版本验证的原生入口恢复父 Delivery 协调，且不重复派发或执行已完成动作
```


<a id="verification-rework"></a>

# 9. Verification & Rework（验证与返工）

Verification 是当前 Change 的工程完成条件之一，但**不是固定的独立 Delivery Stage**。OpenSpec 定义“验什么”，Multica 决定“由谁执行、是否要求独立性”。

当前三层模型：

```text
Level 1 — Task-level Verification
每个 Implementation Task 必须拥有自己的验证方式

Level 2 — Change-level Verification
只有组合多个 Task / Module / Repository / System / User Journey 后才能证明的行为，才在 tasks.md 增加独立 Verification Task

Level 3 — Independent Verification
只有已批准 verify_agent.required=true 时，额外由 Verify Agent 对固定候选版本进行独立验证
```

Regression / Integration / E2E 都是 Verification Method，不与某个 Agent 绑定。Change-level Verification Task 本身不绑定角色；Multica 可以将其投影给 Engineer，或在已批准 Independent Verification 与该 Task 重合时投影给 Verify Agent。CI / script / test runner 是执行机制，不是 Task Owner。OpenSpec Native Verify 是 Artifact-to-Implementation Verification，也不是 Verify Agent 或真实 E2E 的同义词。

<a id="verify-agent-decision"></a>

## 9.1 是否需要 Verify Agent（验证智能体）

Workitem Analyst 在 Analysis 中形成是否建议 Independent Verification 的专业结论、理由及必要验证重点，并通过当前 Issue 审核 Comment 提交。

Workitem Analyst 是首次专业判断者：根据当前 Acceptance / Verification Contract、Task-level / Change-level Verification 的可闭合性、候选风险与是否需要实现者之外的独立性，形成 Recommendation、Reason 与 Focus。Human Analysis Review 是最终决定者，可以接受或 override 该 Recommendation。

仅对独立性要求的 override 不修改 OpenSpec Engineering Truth，也不要求 Analysis Rework。明确的 Task Waiver 按 Human Approval 登记具体任务，不改变必须满足的 Verification Contract、Acceptance Contract 或 Scope；实质契约变更须返回 Workitem Analyst 定向修订并重新审核。

Human 最终决定批准后，执行事实继续使用现有字段（由 `rondo analysis approve` 依据 Human 决定统一登记并回读；与批准评论及获批版本绑定）：

```text
verify_agent.required = true | false
```

字段不迁移，只收窄语义。缺失、非法值或与已批准决定不一致时，派发、激活与 Finalize 均不得静默放行：

```text
false
= 不要求额外 Independent Verify Agent
= 不取消 Task Verification / Change-level Verification / Local Validation / Code Review

true
= 在 required Implementation Tasks 已完成、相关 Engineer Task Sets Development Ready，且 Engineer-owned Verification Tasks 已完成后，必须增加 Verify Agent independent verification
= Verify-Agent-owned Verification Tasks 可以在该 Independent Verification 中完成
```

`verify_agent.required` 表示 Human 已批准的最终 Independent Verification Decision，不要求与 Workitem Analyst 的原始 Recommendation 相同。Recommendation 保留为专业建议事实；Human override 保留原始评论 / Decision 引用，不复制形成第二套技术合同。

Delivery Lead 正常情况下执行已批准结果，不按 Change Kind 或测试类型重新判断，也不得自行把 `required=true` 降为 `false`。若 Development 中出现的新工程事实实质改变独立性要求，由 Delivery Lead 协调回到既有 Analysis / Human Review；若同时改变 Verification Contract / Scope，则先由 Workitem Analyst 更新 Engineering Truth。

## 9.2 Verification Contract（验证契约）输入

父 Delivery 在进入 Verification / PR 决策前必须确认当前候选版本能够追溯到：

```text
OpenSpec Change / schema
Corrective：proposal Expected Behavior / Root Cause / Fix / Regression Scope
Intentional：Requirement / Scenario；满足 Conditional Design 条件时，必须包含 Design；合法省略时，沿用 Analysis Gate 已确认的省略判断
required tasks.md
  - Implementation Tasks + task-level verification
  - Change-level Verification Tasks（如有）
Development Evidence / candidate Commit Set
```

不再要求独立 `AC-xxx` / `VR-xxx` Identity，也不默认创建 `acceptance.md` / `verification-requirements.md`。有 Specs 时 Requirement + Scenario 构成 Acceptance Contract；Corrective 合法 `skip_specs` 时由 Proposal + Task Verification / Regression Evidence 证明修复。

OpenSpec Native Verify 可以检查 Artifact-to-Implementation 的 Completeness / Correctness / Coherence，但其 PASS 不自动证明真实 Runtime / Integration / E2E 已执行；`skip_specs` 时 Spec-dependent checks 应视为不适用，而不是伪造 Coverage。

执行策略：

```text
verify_agent.required = true
→ Verify Agent 在本次 Independent Verification 中执行或复用当前候选 Commit Set 的有效 OpenSpec Native Verify 结果

verify_agent.required = false
→ 不作为 PR Transition 默认强制条件
→ 仅在 Project / Change Contract 明确要求或需要 Change-level consistency audit 时执行
```

OpenSpec Native Verify 不按 Engineer / Task Set 重复运行，也不替代实际 Verification Task Evidence。

<a id="section-9-3"></a>

## 9.3 Change-level Regression / Integration / E2E Verification（变更级回归 / 集成 / 端到端验证）

当某个验证能够归属于单个 Implementation Task 时，写入该 Task 的 Verify，不建立额外 Verification Task。

只有以下组合行为才建立 Change-level Verification Task：

```text
多个 Implementation Tasks 组合后才能证明最终行为
Frontend + Backend / Backend + DB 等跨模块真实链路
多 Repository Contract / Event / Schema 协同
完整 User Journey / E2E
Corrective 公共组件的统一 Regression Scope
异步 / 状态机 / 流处理等必须端到端观察的行为
```

Change-level Verification Task 仍属于 `tasks.md`，不创建新的 Verification Artifact 或 Delivery Stage。Runtime Projection 可以将责任执行者分配为：

```text
Engineer
Verify Agent（仅当已批准 Independent Verification 与该 Task 范围重合时）
```

本文中的 **Engineer-owned / Verify-Agent-owned Verification Task** 仅指上述 Runtime Projection 中的**责任执行者**，不代表将 OpenSpec Task 的 Engineering Contract、验收标准或 Artifact Ownership 转移给 Agent。

执行过程中可以使用：

```text
CI / deterministic test capability
browser / runtime environment
integration / E2E runner
```

这些是执行机制，不拥有 Task Contract 或 Multica Runtime Ownership。

如果 `verify_agent.required=true` 且某个 Change-level Verification Task 已覆盖独立验收重点，可以直接由 Verify Agent 执行；其一次有效执行可同时满足该 Verification Task Completion 与对应 Independent Verification Scope，不要求 Engineer 为形式先执行一遍相同 E2E。若该 Task 已由 Engineer 完成，已有 Evidence 仍不自动等于 Independent Verification PASS，Verify Agent 按独立性要求决定需要复验的范围。

因此：

```text
Integration / E2E required
≠ Verify Agent required
```

如果多个候选 Branch / Commit 必须组合才能测试，可以建立临时 Verification Workspace / Environment；它不是正式 Merge，不改变目标分支，也不产生新的 Delivery Stage。

<a id="section-9-4"></a>

## 9.4 Independent Verify Agent（独立验证智能体）

仅当：

```text
verify_agent.required = true
```

父 Delivery 才调度 Verify Agent。开始前至少满足：

```text
所有 required Implementation Tasks 已完成且对应 Task Sets Development Ready
所有分配给 Engineer 的 required Change-level Verification Tasks 已有当前有效 Evidence
分配给 Verify Agent 的 Change-level Verification Tasks 可以保持 pending，作为本次 Independent Verification 输入
当前 Acceptance / Verification Contract 可读取
Verification Focus 可定位到 Requirement / Scenario、Corrective Proposal 或当前已批准任务编号
所有待验证 Repository 的 Branch / Commit SHA 已固定
```

不得要求“所有 Verification Tasks 已完成”之后才启动 Verify Agent，否则会阻塞由 Verify Agent 自己负责的 Verification Task。此处是**Verify Agent 启动条件**；待 Verify Agent 执行结束，才由 [§9.8](#section-9-8) / [§10.2](#section-10-2) 对所有 required Verification Tasks（不论执行者）做 **PR Materialization 准入检查**。

Verify Agent 不重新定义验收标准，不修改生产代码，不重做 implementation-oriented Code Review。它可以作为被明确分配的 Change-level Verification Task 的 Runtime Executor，并对当前候选 Commit Set 独立执行行为 / Runtime / Integration / E2E 验证，输出 Evidence / Finding。Task Contract 仍由 OpenSpec `tasks.md` 持有。

<a id="section-9-5"></a>

## 9.5 Verification Report（验证报告）与 Gate（门禁）

Verify Agent 输出结构化 Report，例如：

```yaml
verification:
  result: PASS | FAIL | UNKNOWN
  verified_commits:
    - repository: ...
      commit: ...
  coverage:
    - ref: <requirement-or-scenario-or-task-ref>
      result: PASS | FAIL | NOT_APPLICABLE | NOT_VERIFIED
  evidence:
    - ...
  findings:
    - ...
```

Verification Gate 在 `verify_agent.required=true` 时检查：

```text
Verification Report.result = PASS
verified commit set 与当前 candidate commit set 一致
批准的 independent verification focus 已覆盖
Verify-Agent-owned required Verification Tasks 均已完成且有当前有效 Evidence
Evidence 属于当前候选版本
不存在 unresolved blocker
```

Verification Gate 只读取已持久化的 Task Completion、Verification Report 和当前有效 Evidence，不负责执行或勾选 Verification Task。Verify-Agent-owned Task 的完成记录必须先于 Gate 检查。

`required=false` 时 Verification Gate 不要求 Verify Agent Report，但父级仍必须确认 required OpenSpec Tasks、Task Verification、Change-level Verification（如有）、Local Validation 与 Code Review 均满足当前候选版本。

## 9.6 FAIL / UNKNOWN 与 Targeted Rework（定向返工）

Verify Finding 能映射到明确 `task_refs` 时，只激活受影响 Task Set：

```text
Verify Finding
→ original Engineer / assigned Task Set
→ targeted fix
→ task verification / Local Validation
→ Code Review
→ Commit / Push
→ affected Change-level Verification（如需）
→ independent re-verify（required 时）
```

Finding 证明 Requirement / Scenario、Corrective Expected Behavior / Root Cause / Fix Strategy / Regression Scope 或批准 Scope 本身需要改变时，返回 Analysis / Human Review；不得由 Engineer 或 Verify Agent自行改写 Engineering Contract。

无法可靠归因、事实冲突或多轮同类 blocker 不收敛时交 Delivery Lead / Human。父级保存 `verification.result = fail | unknown` 及 Report 引用；未取得当前有效 PASS 前不得进入需要独立验收的 PR Materialization。

<a id="section-9-7"></a>

## 9.7 Evidence（证据）有效性

任何用于 Verification 的 Evidence 都绑定实际候选代码 / 配置 / 环境事实。代码 Commit Set 变化时，旧 Independent Verify PASS 默认失效；受影响 Task Verification / Change-level Verification 同样必须重新判断是否需要执行。

Requirement / Scenario、Corrective Regression Scope、Verification Task 或独立性要求实质变化时，即使代码 Commit 未变也必须重新评估旧 Evidence。纯排版或不改变 Contract 的 checkbox 修正不自动触发全量复验。

<a id="section-9-8"></a>

## 9.8 完成与再次验收

当前 Development Completion 不等待无关 Task Set，但父 Delivery 在 PR Materialization 前统一检查：

```text
所有 required Engineer Task Sets Development Ready
所有 required Verification Tasks（含 Verify-Agent-owned）已完成并有当前有效 Evidence
verify_agent.required=false
  OR
当前候选 Commit Set 的 Independent Verification PASS
```

满足后才进入 [§10](#pr-materialization)。Merge 后不再自动创建“Change-level Integration / E2E Verification Stage”；后续 QA / 测试发现的新问题形成新的 TFS Work Item / Delivery。


<a id="section-9-9"></a>

## 9.9 反馈循环保护

Development 内部反馈循环：

```text
Engineer
→ Local Validation
→ Code Review
→ Finding
→ Targeted Fix
→ Local Validation
→ Code Review
→ Development Completion Check
```

Verify Agent required 时，Engineer-side Readiness 与最终任务完成分开判断。Verify-Agent-owned Verification Task 的完成与持久化必须先于 Verification Gate：

```text
required Implementation Tasks + Engineer-owned Verification Tasks Complete
+ 对应 Engineer Task Sets Development Ready
 ↓
Verify Agent 执行 assigned Verification Tasks（启动时允许 pending）
+ Independent Verification
 ↓
形成 Verification Report + 当前候选 Evidence
 ↓
已完成的 Verify-Agent-owned Verification Tasks
→ 持久化 Evidence / tasks.md checkbox，并回读确认
（失败或未完成的 Task 不勾选）
 ↓
Verification Gate 检查 §9.5 的全部条件
├─ PASS → 确认全部 required Verification Tasks Complete + Evidence 有效
│         → PR Materialization（仍需满足 §10.2）
└─ FAIL / UNKNOWN → Targeted Rework / Human Escalation
                    → 重新评估受影响的 Engineer-side Readiness
                    → 按需再次 Independent Verification
```

Task Completion 来自 Verify Agent 对实际执行结果及有效 Evidence 的确认，不以 Verification Gate PASS 作为 checkbox 写入前置。若 Evidence 有效但持久化失败，先恢复受控写入并回读；未完成写入前 Gate 不得 PASS，也不因单纯写入失败机械重复验证。Gate 只校验事实，不执行 Task Completion。

Verify FAIL 且 Finding 能明确归因到已完成 Development Sub-Issue 时：

```text
Finding
→ 受影响 Development Sub-Issue 重新进入 in_progress
→ 对应 Specialist Targeted Rework
→ Local Validation
→ Code Review
→ Commit / Push
→ PR Preparation / Evidence Update
→ Development Completion Check
→ Tasks 完成状态更新 → 核对依据 → 受影响 Task Set READY
→ 原 Sub-Issue 的全部当前 required Task Sets 均 READY 后再次完成
→ Parent Delivery 重新评估 Verify
```

上述是定向返工的执行顺序，不意味着仅将 Sub-Issue 从 `done` 改为 `in_progress` 就必然产生新 Run。Specialist-owned / Squad-owned 的具体单次触发方式与当前 Run 检查遵循 [§7.3](#section-7-3)；来自 PR Abandoned 的 ENGINEERING 返工复用本路径并按 [§11.2](#section-11-2) 保持原 Runtime Projection。

如果：

```text
verification_round >= 3
AND
同类 blocker 重复
```

则：

```text
Parent / affected Issue → blocked
      ↓
Delivery Lead
      ↓
Semantic Diagnosis / Human Escalation
```

不得无限 Engineer ↔ Verify 循环。父级重复推进遵循 [§8.2.1](#section-8-2-1)–[§8.2.2](#section-8-2-2)；定向重开、证据失效与 Stage 影响遵循 [§9.5](#section-9-5)–[§9.8](#section-9-8)；收口恢复遵循 [§12.4.2](#section-12-4-2)–[§12.4.4](#section-12-4-4)。PR Abandoned 后的 `ENGINEERING` / 需要工程工作的 `RECREATE_PR` 复用上述原 Sub-Issue 定向重开原则，具体 Human 授权与两种 Runtime Projection 的唯一触发路径见 [§11.2](#section-11-2)。只按实际验收轮次计入现有失败阈值，重复通知或脚本恢复不额外计为新验收。

---


<a id="pr-materialization"></a>

# 10. PR Preparation & Materialization（PR 准备与物化）

PR 是 Repository 级交付对象。

正式原则：

```text
每个发生代码变更并需要交付的 Repository
→ 独立 Branch
→ 独立 PR
```

PR 交付拆成两个职责，不新增 Workflow Stage：

```text
PR Preparation
= Engineer Semantic Work

PR Materialization
= Deterministic Side Effect
```

<a id="section-10-1"></a>

## 10.1 PR Preparation（PR 准备）

Engineer 在声明当前 assigned Task Set 完成前完成：

```text
Local Validation PASS
Code Review PASS
Commit / Push
PR Preparation
```

纯验证且无代码修改时按 [§8](#development-execution) / [04 §7.1](04-engineer-development-design.md#section-7-1) 复用仍有效的 Candidate、Code Review 与 PR Preparation，不制造新提交。同一 Repository 的多次 Task Set 结果由同一 Engineer 维护，可以逐次更新准备事实；正式 PR Materialization 前须确认该 Repository 的全部 required Task Sets 及最终 Candidate，不把较早 Task Set 的 READY 当作最终仓库候选。

每个 required Repository Change 至少准备以下事实；其中 YAML 仅示意逻辑结构，不新增 Multica / TFS 平台字段或独立数据对象，实际字段映射由 `pull-request` Skill 确定：

```yaml
repository: ...
repository_id: ...
source_branch: ...
target_branch: ...
candidate_commit: ...
pr:
  title: ...
  description: ...          # 或持久可读的 Description Reference
  ready: true
associations:
  tfs_work_item: ...       # 来源 TFS Work Item 的稳定身份 / 引用
  delivery_issue: ...      # 当前 Issue 的稳定身份 / 引用
```

必需项包括 Repository / Repository ID、Source Branch、Target Branch、Candidate Commit、PR Title、PR Description（或持久可读的 Description Reference）、TFS Work Item / Issue 关联信息；不得因为相关身份已经存在于父 Issue 就在 Materialization 输入中丢失其可追溯引用。这里的 `associations` 是契约示意，不规定实际 API 字段名，也不要求复制已由 Multica 保存的来源事实。

PR Title / Description 属于 Engineer 对本次代码修改的语义准备，只有 Engineer 可以修改其语义内容。Script 仅可对已确认的 Repository / Branch / Candidate Commit 等客观事实进行确定性校验与必要回填，不得借事实回填自行改写 PR Title / Description。

<a id="section-10-2"></a>

## 10.2 PR Materialization（PR 物化）

当满足：

```text
所有 required Implementation Tasks 已完成且对应 Engineer Task Sets Development Ready
+ 所有 required Change-level Verification Tasks 已完成且 Evidence 当前有效
+ verify_agent.required = false
```

或：

```text
所有 required Implementation Tasks 已完成且对应 Engineer Task Sets Development Ready
+ 所有 required Change-level Verification Tasks（含 Verify-Agent-owned）已完成且 Evidence 当前有效
+ verify_agent.required = true
+ 当前候选 Commit Set 的 Verification Gate PASS
```

所有获准自动处理的 Change 在上述两条路径中都必须满足：当前 Change 的必要工程任务没有遗漏，当前 Fix / Acceptance Contract 及适用规格要求有覆盖，已识别的修复 / 规格 / 实现偏差已处理，所需验证有适用于当前代码与验收要求的 Evidence。Corrective 不能只凭 Tasks 勾选替代根因对应与回归证据。Task Set 完成不要求业务 PR 已创建或合并。

这些条件纳入既有 Development Completion / PR 前置检查，不新增具名 Gate 或状态表。程序核对现有任务进度、必需引用与有效专业结论；语义覆盖不明确交相应 Engineer / Workitem Analyst，不能由脚本凭 checkbox 或 Leader 自述替代专业判断。必要任务确已取消或替换时须保留理由并遵循批准边界，不得为过 Gate 虚假勾选、删除要求或将未完成工作移入无效清单。

父 Delivery 流程在上述整体条件满足后，通过明确的正常调用路径调用确定性的 `pull-request` capability。PR Materialization 不绑定某个 Specialist Agent；调用者须提供已准备 Facts 和当前 Delivery 上下文，不因此允许多个入口无协调地同时创建同一 PR。调用前按 [§8.2.2](#section-8-2-2) 检查当前事实与已执行动作。

标准过程：

```text
读取 PR Preparation Facts / current_pr
↓
逐仓核对当前 PR 与外部事实：已存在则复用 / 恢复登记
↓
Active 或确需创建时核对 Branch HEAD；Completed 核对最终 Source Commit
↓
确需创建时调用 TFS / PR API
↓
确认 PR 身份与 Work Item 关联
↓
立即登记本仓 current_pr，保留其他仓库已登记事实
↓
全部 required PR 注册完成
↓
Issue → in_review
```

PR Materialization 必须幂等；多个 Repository 可以一次处理，逐仓登记已确认 PR，失败重试复用已登记事实。部分登记不能触发 Closeout。外部 PR 已创建但 `current_pr` 回写失败时，重试必须先确认外部事实并恢复登记，不能因本地记录缺失直接再建 PR；无法可靠确认身份或结果时返回 `UNKNOWN`。

如果确定性 Materialization 返回：

```text
PASS
→ in_review

FAIL
→ 按明确失败原因处理；不得绕过

UNKNOWN
→ Delivery Lead 语义判断
```

只有出现新的 Engineering Semantic Work 时才重新 `@Engineer`，例如：

```text
Branch HEAD != candidate_commit 且原因不明
需要 rebase / conflict resolution
PR 前置检查暴露代码问题
必须修改代码 / 测试 / PR Preparation
Repository / Branch Fact 冲突
```

以下问题不需要 Engineer：

```text
TFS / PR API 临时失败
网络超时
幂等恢复
metadata 回填
可确定性的字段 / 身份校验
```

当 Verify required 时，PR Materialization 必须基于已验证候选 Commit Set；代码实质变化会使旧 Verify PASS 失效。

一个 Issue / Development Sub-Issue 可以关联多个 Repository Change；每个 Repository Change 保存一个当前 required PR。

所有 required PR 成功登记后才进入：

```text
in_review
```

---


<a id="pr-status-sync"></a>

# 11. PR Status Sync & Exception Handling（PR 状态同步与异常）

PR 审核发生在 TFS / PR Platform。Multica 不复制审核过程；`pr-status-sync` 只读取已登记的 current required PR，并依据 provider `status` 做确定性终态检测。

运行模型：

```text
Multica Autopilot
      ↓
PR Status Sync Agent（状态核实与同步）
      ↓
skill-flow pr reconcile-status
      ↓
Structured Script Result
```

PR 状态识别与同步副作用由确定性命令负责；Agent 交付核实结果，不自行解释 Review 语义。后续收口由独立 `issue-closeout` 能力按本生命周期的触发约定执行，不属于 `pr-status-sync` Skill 的内部步骤。

查询：

```text
常规巡检：status = in_review / blocked
历史完成事项：--issue <KEY> 定向恢复，或 --recover-done 独立恢复扫描
```

已 `done` 且残留 `finalize.pending` 时仅清理待恢复事实；常规巡检不遍历历史 `done`。

`in_review` 或有 PR Preparation 的 `blocked` Issue 缺少登记时，复用 Materialize 的已有 PR 身份核实和逐仓登记方法，仅补登已确认 Candidate 与 Work Item 关联的 PR，不创建 PR、不修改 TFS 或研发成果、不重复工程 Gate。无法确认时返回 `unknown`；已登记 PR 仍按现有终态优先级处理。仅 `in_review` 且全部实际交付仓 PR 已确认 completed 时触发收口，`blocked` 保留原状态和 pending。

脚本执行：

```text
读取 Project / Repository ID / PR ID
↓
tfs-mcp 查询 PR
↓
校验 PR / Repository / Project 身份
↓
provider_status ?
├─ active     → NO-OP
├─ completed  → Completion Evaluation
├─ abandoned  → Exceptional Stop
└─ 其他       → UNKNOWN
```

多个 required PR 聚合：

```text
任一 current_pr = abandoned
→ Exceptional Stop

否则任一 current_pr = UNKNOWN
→ UNKNOWN

否则全部实际交付仓 current_pr = completed 且 Issue = in_review
→ Completion

否则
→ NO-OP
```

## 11.1 普通审核过程

`provider_status = active`：

```text
NO-OP
```

不根据以下内容改变 Delivery 流向：

```text
Changes Requested
Approved
Review Feedback
mergeStatus
mergeCommitId
mergeCommitMessage
```

不写 Comment、不唤醒 Delivery Lead / Engineer；等待下一次 Autopilot。

<a id="section-11-2"></a>

## 11.2 PR Abandoned（PR 已放弃）

检测到：

```text
provider_status = abandoned
```

确定性处理：

```text
持久化 Abandoned Fact
↓
pending_event / event_key
↓
Issue.status = blocked（Assignee 保持不变）
↓
STOP，等待 Human Decision
```

机器不推断 abandoned 的业务原因。

Human 提交流程决定时，顶层 Comment 必须明确：

```text
Reason:
- REJECTED | DISCARDED

NEXT:
- ANALYSIS
- ENGINEERING
- RECREATE_PR
- CANCEL_DELIVERY
```

正常 Requirement Issue 已由 Delivery Squad 持有，Human Comment 按 Multica 原生机制唤醒 Delivery Lead；PR Status Sync 不重新指派 Issue，若 Owner 已被其他操作更改，应由 Delivery Lead / Human 核对，而非自动覆盖。普通讨论或补充信息按 [§6.3](#section-6-3) 返回 `NO_ACTION`，不得仅因没有 `NEXT` 就视为异常。

Delivery Lead 调用：

```text
route-human-decision.py
```

确定性路由：

```text
NEXT = ANALYSIS
→ status = in_progress
→ @Workitem Analyst

NEXT = ENGINEERING
+ affected Task Set 唯一明确
+ 原 Runtime Projection / Owner / 当前 Issue 与 Run 事实可确认
→ 按原 Runtime Projection 执行 Engineering Targeted Rework（见下文）

NEXT = RECREATE_PR
+ Candidate Commit Set 未变化
→ 核查原 PR Preparation 是否仍符合 Human Decision
→ 无新的 Engineering Semantic Work 且当前 PR / Verification 前置事实有效：按 §10.2 重新核验并执行 PR Materialization
→ 需要修改 PR Title / Description 等语义内容：确认 affected Task Set，按原 Runtime Projection 交 Engineer 定向处理
→ 原产物是否仍适用或责任归属不明确：UNKNOWN / 安全停止

NEXT = RECREATE_PR
+ Candidate Commit Set 已变化
→ 先核验 Commit 变化原因、原 PR Preparation 的适用性及是否需要 Engineering Semantic Work
→ 需要代码 / 测试 / 冲突处理，或需要修改 PR Title / Description 等语义内容：
  确认 affected Task Set，按原 Runtime Projection 执行 Engineer Targeted Rework
→ 仅存在可确定性校验的 Candidate Commit 等客观事实变化，且原 PR Preparation 语义内容仍准确：
  Script 校验并回填候选 Commit 等事实；复用原 PR Title / Description，不自行修改语义内容
→ 原因、Owner、语义适用性或有效事实不明确：UNKNOWN / 安全停止
→ 重新评估受影响 Evidence、Verification Gate 和 §10.2 前置条件；必要时重新验证
→ 满足条件后才允许 PR Materialization

NEXT = CANCEL_DELIVERY
→ Cancellation Handler / Policy
```

> **实施边界待明确**：本版已规定 `CANCEL_DELIVERY` 由 Human 明确选择，但尚未定义完整 Cancellation Handler 的状态、OpenSpec Change、TFS、PR 等后置条件。该分支不得被视为已具备自动取消和收口能力；实施前必须补齐并审核专项契约，未补齐时由 Delivery Lead 保持安全停止并交 Human 处理。

**ENGINEERING Targeted Rework（复用现有 Runtime Projection）**：`route-human-decision.py` 负责确定 Human 授权的下一步；`NEXT=ENGINEERING` 不重新选择执行入口。Delivery Lead 依据 `affected task_refs`、原 Runtime Projection、Owner、当前 Issue / Run 事实确定目标并检查已有返工动作；禁止把原 Sub-Issue Task Set 转移到父 Issue 上重新 Mention。

| 原执行入口 | 返工准备、Completion Fact 失效与唯一触发路径 |
|---|---|
| Parent Issue Runtime | 使受影响 `task_refs` 的当前 `development.result=complete` 结论失效，保留历史 Evidence；父 Issue 恢复 `in_progress`，在父 Issue **单次** `@原 Engineer`，不得重复派发相同 Task Set。 |
| Specialist-owned Development Sub-Issue | 在**原 Sub-Issue** 写入 Human Feedback、`affected task_refs` 和必要当前 Contract 引用；将原 `done` Sub-Issue 重开至非完成状态（按可执行条件使用 `in_progress`），使其旧 Runtime Completion Fact 立即失效；按原 Owner 和已验证的原生启动机制在该 Sub-Issue **单次**触发，不在父 Issue 再次 `@Engineer`。 |
| Squad-owned Development Sub-Issue | 同样在**原 Sub-Issue** 更新返工输入、重开并使旧完成事实失效；由原 Squad Owner 按该 Sub-Issue 的协作机制单次路由至对应 Specialist，不转移到父 Issue。 |

在 Development Sub-Issue 路径中，父 Issue 可恢复 `in_progress` **仅用于继续协调与聚合**，并不成为该 Task Set 的执行入口。若原 Sub-Issue 不可用、`task_refs` / Owner 与当前 Contract 冲突、已有 Run 的结果不明，停止自动派发，由 Delivery Lead / Human 明确恢复安排；不默认新建 Sub-Issue 或重开整个 Stage。重开可能影响下游依赖时，按 [§7.5](#delivery-stage) 检查 Stage 当前事实，不自动回滚无关的已完成 Task Set。

**顺序与幂等**：先核对 Human Decision、当前 Issue / Run / `task_refs`，再准备返工输入并使受影响 Completion Fact 失效，之后才触发新的执行。Sub-Issue `done → in_progress` 是否足以产生新 Run，须由 [§7.3](#section-7-3) 的安装版本验收确认；不能仅凭状态变化认定已启动，也不能在结果未知时盲目追加 Mention / Assignment / Rerun。重开规则沿用 [§9.9](#section-9-9)，事实有效性与 Parent 聚合沿用 [§13.1](#delivery-facts)、[§8.2.2](#section-8-2-2)；重复处理同一 Human Decision 不得产生第二次执行。

**RECREATE_PR 的工程动作边界**：Human 选择 `RECREATE_PR` 不等于授权绕过已有 Verification / PR Gate。Candidate Commit Set 是否变化，不直接决定是否启动 Engineer：代码 / 测试 / 冲突处理，以及 PR Title、Description、变更摘要、测试说明、风险说明等语义修改，都属于 Engineer Semantic Work；即使代码不变，也必须确认 affected Task Set 并复用上表的原 Runtime 入口。仅当变化局限于可可靠核验的 Commit / Branch 等客观事实，且既有 PR Preparation 语义内容仍准确适用时，Script 才可校验、回填候选 Commit 引用等事实并复用原语义内容，不得自行撰写或修改 PR Description。若无法证明现有描述仍准确，禁止按“无需工程返工”处理。

**Verification 与安全恢复**：即使无需 Engineer，仍须按 [§9.7](#section-9-7)–[§9.8](#section-9-8) 和 [§10.2](#section-10-2) 重新评估当前 Candidate Commit Set 的 Evidence、旧 Verify PASS 与 PR 前置条件。Commit Set 变化时旧 Independent Verify PASS 默认失效，必要时重新执行验证；不能因为代码内容表面相同或 Script 已回填新 SHA 就直接沿用旧 PASS。原 abandoned PR 始终保留为历史事实，不再作为当前有效 PR 放行。

明确要求执行流程动作，但存在以下情况时：

```text
NEXT 或该动作必需信息缺失
affected Task Set 不唯一（需要 Engineering Semantic Work 时）
原 Runtime Projection、Owner 或目标 Issue 无法可靠确认
当前 Issue / Run / Completion Fact 与准备执行的动作冲突
事实冲突
无法可靠判断 Commit Set、Verification Evidence 或 PR 前置事实是否可沿用
Human Decision 与当前状态不一致
```

则：

```text
route-human-decision.py → UNKNOWN
↓
保持当前状态，不执行该流程动作
↓
Delivery Lead 澄清缺失信息 / 冲突，必要时请求 Human
```

若回 ANALYSIS，新 Analysis 再次通过 Human Review 后，以新的技术范围、约束、Acceptance / Verification Contract 及 Verify Recommendation 为准；Delivery Lead 只在相关新事实影响现有分工时调整协作安排，不默认重建全部任务。

若回 ENGINEERING，受影响 Task Set 按原 Runtime Projection 完成修复、Local Validation、Code Review、Commit / Push、PR Preparation 和 Development Completion Check；父级只聚合当前有效事实。返工一旦启动，旧 Development Completion Fact 不得继续放行，但历史 Evidence 保留；验证 Evidence 是否重用须按 [§9.7](#section-9-7) 的候选 Commit Set、Contract 和影响范围判断。Verify required 且 Commit Set 变化时旧 Verify PASS 失效；Contract 实质变化时即使 Commit 未变也须重新评估。满足全部 required Tasks / Verification Gate / [§10.2](#section-10-2) 前置条件后，才可重新 PR Materialization。

本分支至少验收：Parent Runtime 单次返工；已 `done` 的 Specialist-owned / Squad-owned Sub-Issue 在原 Issue 重开且父级不双触发；只重开多个 Sub-Issue 中受影响的一个；同一 Human Decision 重试不产生第二个 Run；重开但原生触发结果未知时先查 Run；Commit 未变化但 PR Title / Description 需修改时仍由原 Engineer 处理；仅客观 Commit 事实变化且既有 PR 语义内容有效时 Script 不修改 PR 文案；候选 Commit Set 变化后不沿用失效 Verify PASS。

## 11.3 PR Completed（PR 已完成）

只有：

```text
provider_status = completed
```

才表示单个 current PR 成功完成。

所有 required current PR 都 completed 后：

```text
PR Status Sync Run
↓
持久化 Completion Facts / pending_event
↓
same-run 使用 `issue-closeout` 按 Prepare → TFS Writeback → Complete 收口
```

同一 PR Status Sync Run 内执行三个确定性命令，分别报告结果：

```text
rondo delivery finalize --phase prepare
  → PR Transition / Delivery Gate → Workspace Reconciliation → OpenSpec Archive + Git Push
rondo tfs writeback
  → TFS 管理子任务、合法工时、Commit 关联、状态链与回读（完整 PASS 才可继续）
rondo delivery finalize --phase complete
  → 确认 TFS 写回事实 → Final Summary → Issue done → 清 pending
```

Happy Path 不为这些确定性步骤额外唤醒 Delivery Lead。

如果：

```text
UNKNOWN
事实冲突
需要跨角色协调
无法确定安全恢复动作
```

则：

```text
→ Delivery Squad / Delivery Lead
→ Delivery Lead Semantic Decision
```

## 11.4 幂等与恢复

每个 current PR 使用稳定 `event_key`：

```text
owner issue
repository
PR ID
provider terminal status
```

终态事实分别按已有契约记录：`abandoned` 使用 `pr.abandoned`（包含 `event_key`），全部 required PR `completed` 且准备收口时使用 `finalize.pending`（包含 `event_keys`）。两者均由确定性命令按当前事实幂等写入。

`finalize.pending` 在 [§12.4](#final-completion) 的收口后置条件确认后清除；中途失败则保留待恢复标记。常规扫描覆盖 `in_review` / `blocked`，历史 `done` 的待清理标记通过指定 Issue 或单独的 `--recover-done` 扫描恢复，不得因此重新打开已完成交付。

核心幂等规则：

```text
active
→ NO-OP

abandoned + 新 event_key
→ 写入 pr.abandoned，并停止在 blocked 状态

abandoned + 已记录 event_key
→ NO-OP，不覆盖后续人工状态与指派

all current required PR completed
+ completion already finalized
→ NO-OP

all completed
+ finalize pending
→ 恢复 issue-closeout

query / identity / schema UNKNOWN
→ 不推进、不覆盖已有可靠事实
```

PR Status Sync 不修改代码、不理解 Review 意见、不推断 abandoned 原因。

---


<a id="section-12"></a>

# 12. Delivery Finalization（PR 收口、对账与最终完成）


## 12.1 PR Transition Gate（PR 转换门禁）

PR Transition Gate 属于 `issue-closeout` 内部的确定性检查，不要求独立 Agent Run。

推荐规则：

```python
def pr_transition_ready(ctx):
    acceptance_ok = (
        not ctx.verify_agent_required
        or ctx.verify_agent_pass
    )

    return (
        ctx.all_required_tasks_complete
        and acceptance_ok
        and all(ctx.required_current_pr_completed)
        and ctx.unresolved_blocker == 0
    )
```

结果：

```text
PASS
→ 继续 deterministic finalize

FAIL
→ 不允许关闭
→ 根据明确缺失条件等待 / 修复

UNKNOWN
→ 停止 finalize
→ 升级 Delivery Lead
```

Gate 本身只判断硬条件；若 `UNKNOWN` 背后需要理解跨角色事实或决定下一步专业能力，由 Delivery Lead 进行语义路由。`all_required_tasks_complete` 必须结合 OpenSpec Task coverage、当前 Development Results、必要 Sub-Issue 状态与有效 Engineering Evidence 判断；被重开的 Sub-Issue、尚未解决的 Finding 或仍属 required 但未完成的 Task，均不得算作成功完成。

---


<a id="section-12-2"></a>

## 12.2 Post-Merge Workspace Reconciliation（合并后工作区对账）

PR Transition Gate PASS 后，由 `issue-closeout` 对登记且当前运行有权操作的本地工作区执行 Merge 后对齐。仓库 / 工作目录身份、权限和是否有其他执行占用必须可确认；不得以另一台机器或任意同名目录代替当前工作区。无法安全操作时停止并交 Delivery Lead，不新增跨 Runtime 自动迁移。

每个 required 业务代码 Repository（共享根仓的 OpenSpec 修改按 [§12.4](#final-completion) 处理）：

```text
For each required Repository:
    git fetch --prune origin
    git switch <target_branch>
    git pull --ff-only origin <target_branch>
```

工作区已经满足当前目标状态时不重复切换。远程 Source Branch 已删除时，本地 Source Branch 可按团队策略安全清理；不存在即跳过，安全删除被拒绝则保留。该可选清理失败不覆盖已完成的代码交付，也不允许强删：

```text
git branch -d <source_branch>
```

不得默认使用：

```text
git branch -D
```

以下情况不得强行对齐：

```text
working tree 非 clean
target_branch 不存在
pull 无法 fast-forward
Repository 状态与记录不一致
```

处理原则：

```text
可确定的恢复动作
→ Script 处理

无法安全恢复 / 事实冲突 / 需要语义判断
→ UNKNOWN
→ Delivery Lead
```

不得使用 `reset --hard` 等破坏性操作掩盖冲突。

Merge 后不再新增独立 Verification Stage。当前 Change 所需的 Task-level / Change-level Verification（含适用的 Regression / Integration / E2E）应在 PR Materialization 前完成；后续 QA / 测试发现的新问题形成新的 TFS Work Item / Delivery。

---


<a id="delivery-completion"></a>

## 12.3 Delivery Completion Gate（交付完成门禁）

Delivery Completion Gate（交付完成门禁） 属于 `issue-closeout` 内部确定性检查。Gate PASS 表示可以执行收口；不表示摘要、归档、TFS 回写和最终 `done` 已完成。这些后置条件按 [§12.4](#final-completion) 回读确认。

关闭 Issue 前确认：

```text
[ ] Analysis Gate PASS
[ ] Human Analysis Review 已明确批准，有当前适用的原始评论 / 交接依据，不仅依赖 in_progress 或 Agent 自述
[ ] 所有 required OpenSpec Implementation Tasks 已覆盖且对应 Task Sets Development Complete
[ ] 所有 required OpenSpec Verification Tasks 已完成并有当前有效 Evidence
[ ] 所有 required Task Sets Local Validation PASS
[ ] 所有 required Task Sets Code Review PASS
[ ] verify_agent.required=false，或 Independent Verify Agent PASS
[ ] Independent Verification PASS 对应当前候选 Commit Set 与批准的 Verification Focus（如果 required）
[ ] 当前 Change 必要工程任务、Fix / Acceptance Contract 与适用规格覆盖、有效 Evidence 满足 §10.2 收口前置要求
[ ] 所有 required current PR provider_status = completed
[ ] Post-Merge Workspace Reconciliation 成功
[ ] 无 unresolved blocker
```

统一输出：

```yaml
result: PASS | FAIL | UNKNOWN
```

```text
PASS
→ Final Completion

FAIL
→ 不允许关闭

UNKNOWN
→ 停止 deterministic finalize
→ Delivery Lead 语义判断 / 协调
```

---


<a id="final-completion"></a>

## 12.4 Final Completion（最终完成）

**D3-B 现行实施契约（2026-11-10）**：Engineering Completion 与 TFS Work Item 管理分属不同责任域；`Workitem Analyst`/OpenSpec 不承担 TFS 工时，`PR Status Sync Agent` 作为外部终态与收口触发入口，不替代工程专业判断。现行实现已将 `rondo delivery finalize` 的 TFS 业务调用拆成外部 `rondo tfs writeback` 能力，`issue-closeout` 在同一 PR Status Sync Run 核实 Archive/Writeback，再设置 Issue `done`。**TFS Writeback 不完整、失败或 UNKNOWN 时不允许 `done`；保留 `finalize.pending` 并有界恢复，不重复工程/PR/归档。**详细分步及兼容验收以 [D3-B 专项方案](../plans/d3b-external-tfs-management-decoupling-plan-2026-11-10.md) 为准。本节以下对收口顺序的描述，以本段独立 Writeback 和最终 `done` 硬依赖为准；运行环境仍需真实 Workspace E2E 验收。

Delivery Completion Gate PASS 后，`issue-closeout` 按当前事实完成：

```text
先核实 PR/Delivery Gate，并按当前 Change 契约归档（OpenSpec Archive + Git Commit/Push，不创建 PR；保留 finalize.pending）
→ 独立 TFS Writeback：需求按 task_refs 创建 / 复用子任务、仅写可信管理工时、关联 Commit、置「已解决」并回读；父项按状态链更新并写收口评论
→ 校验 TFS 完整 PASS 与工程归档事实，发布 Final Summary 和必要 PR / Verify / Artifact 关联结果
→ Issue = done（最后写入）
→ 清除 finalize.pending
→ 清除本次 completion pending_event
```

Final Delivery Summary 默认由结构化 Facts 模板化生成，不依赖 LLM。摘要只陈述已确认事实；在最终写入之前不得宣称交付已关闭。当前方案不默认增加 Final Human Confirmation。

`in_review` 表示 required PR 已注册、等待外部结果；全部 PR 完成后的正常收口也可以在该状态内执行，不新增 `finalizing` 状态。


### 12.4.1 OpenSpec Archive（OpenSpec 归档，所有获准自动交付的 Change）

本小节适用于获准自动交付的 Corrective / Intentional Change。统一 Archive 不改变各自专业完成契约或 TFS 管理规则；超出当前自动处理能力的变更不得自动收口。

Change Archive 包含将已实现且已批准的 Delta（如有）纳入主规格并归档当前 Change。无 Delta 的 Corrective Change（纠正性变更） 只归档修复产物与记录，不修改主规格，也不在归档时临时生成规格。只有业务交付满足当前 Final Completion 条件后才执行；主规格随后作为其他分析与研发的行为依据，不提前纳入尚未完成交付的提案。

此处按 [§6.1](#section-6-1) 的提交规则执行**最终根仓 Git Commit**：消费初始批准基线、后续受控修订和共享工作区中尚未提交的当前 Delivery 修改，将其与必要归档 / 主规格更新一并记录。调用前确认实际登记的持久共享根仓及 Evidence 可读取；修改丢失或关键证据不可读时停止并交 Delivery Lead，不要求 Engineer 补中间 Commit，也不凭旧完成记录自动重建内容。

修复 / 规格与实现的语义一致性在 Analysis、Development / Verification 中解决。`rondo delivery finalize` 消费已有可靠结果，不在 PR 完成后重新执行一轮 LLM 需求分析。

```text
既有 Delivery Completion Gate PASS
+ §10.2 的工程任务、规格覆盖及有效 Evidence 条件仍满足
+ 当前 Change 与根仓身份可确认
+ 原生规格 / Delta 校验满足项目要求
        ↓
OpenSpec 原生归档：Delta 纳入主规格（如有）+ Change Archive
        ↓
回读确认归档位置、适用主规格结果与分析 / 工程 Evidence 引用
        ↓
根仓 Git Commit，确认本次修改被记录
        ↓
继续 TFS 回写和 Delivery 收口
```

项目必须在调用前检查当前必要工程任务完成状态，不能以 Archive 退出成功推断交付完整。PR Materialize 与 Archive 共用任务判定：每项任务已完成或属于当前 Human Approval 的 `waived_tasks`；未执行的豁免任务保持未勾选，其他未完成任务阻断。公开 Archive 实现在存在未完成任务时允许 `--yes` 继续；仅在项目 Guard 确认不存在未处理的必要任务后使用原生非交互归档，不绕过规格校验。[^d-openspec-archive]

不得通过 `--no-validate` 绕过失败，也不得用 `--skip-specs` 掩盖本应合入主规格的 Delta。无 Spec-level 行为变化的 Change 按 Workitem Analyst 方案的原生跳过标记与校验要求处理；它不是为已有行为变更跳过规格同步的权限。

以下情况停止后续收口，不得将 Delivery 标记为 `done`：

```text
必要工程任务未完成，或修复 / 规格 / 实现偏差仍未处理
Change / 根仓身份或安全工作区无法可靠确认
OpenSpec Validation / Archive 失败
归档产物、主规格结果或必要引用无法确认
Archive 后根仓 Git Commit 失败或结果未知
```

明确不满足条件为 `FAIL`；身份、权限、结果无法确认或需专业判断为 `UNKNOWN`。解析命令结果并回读实际后置条件，不能只看 Run / 命令退出成功。Archive / Commit 不创建独立 PR，根仓不加入业务 required PR 集合。

部分成功按 [§12.4.2](#section-12-4-2)–[§12.4.3](#section-12-4-3) 查询已有归档、Git 和外部事实，只补缺失动作，不重复应用 Delta、不破坏唯一副本、不回滚已完成业务 PR；恢复时相关引用应指向实际归档位置。

---

#### 归档引用与根仓安全

当前 Change 的内部文档使用可随目录移动的相对引用；外部 Evidence 使用已持久化、可授权读取的 Artifact / Git / 日志引用。Archive 后更新现有 Issue / Handoff / Summary 中的当前产物路径，并回读验证；保留原 Change ID 与已批准基线记录，不另建一套身份或归档状态。`context-pack.md` 等项目附加分析文档仅在实际生成时随 Change 保存；`proposal.md` 在 `corrective-change` 中属于正式 Schema Artifact；`bug-analysis` Method 不产生同名 Artifact。

多个任务使用不同 Change 目录，不等于可以安全并发更新同一主规格或根仓 Git index。进入 Archive / Commit 前确认当前可安全操作的根仓与最新主规格；已有执行占用或同一规格的 Delta 冲突时停止相关写入，经现有执行环境 / Lead 安排重试或语义协调。只提交当前 Change 与其实际更新的主规格，不使用全仓 `git add .` 夹带其他交付修改；不新增全局锁、事务框架或自动覆盖冲突的规则。

共享根仓存在本 Delivery 的受控未提交修改是正常中间状态，不能直接套用 [§12.2](#section-12-2) 对业务 checkout 的 clean 要求。最终提交须核对明确文件范围及已有暂存项，保留其他 Delivery 的修改；无法安全区分或存在提交冲突时停止。Commit 失败或结果 UNKNOWN 不得声称 Finalize 成功。仅 Task checkbox / Archive 的根仓提交不构成业务 Candidate Commit 变化，不机械使业务验证失效。

若 Archive / Commit 已完成而路径回填失败，按既有 pending 机制只恢复引用，不重复应用 Delta。代码 PR 已合并不表示交付已关闭；归档失败保留已完成业务事实，停止最终 `done`，不重新发起工程实现。

---

<a id="section-12-4-2"></a>

### 12.4.2 最小恢复模型

`issue-closeout` 是一次有界调用：读取当前事实、检查、补齐缺失动作、输出结构化结果后结束。由现有 PR Status Sync Run 调用；后续 Autopilot 或人工重试可以再次调用同一入口。

恢复时重新执行必要的只读检查和安全 Guard，跳过已确认完成的副作用，只补未完成项。不得从“上次第几步”盲目继续，也不得为了恢复而重跑 Analysis、Development 或 Verify。

不新增 `finalize-state.json`、持久化 `current_step`、全局事务、补偿引擎、长期轮询循环或新的 Workflow Runtime。恢复依据优先使用 TFS / PR 当前事实、Multica 当前记录、已有 Artifact 引用与本地工作区状态；无法可靠确认的操作不得仅根据上一轮日志认定成功。

<a id="section-12-4-3"></a>

### 12.4.3 各动作的重试与后置条件

| 动作 | 必须确认的事实 | 再次调用时如何处理 |
|---|---|---|
| PR Transition Gate / Delivery Completion Gate | 当前 required Task Sets、有效 Verify、current PR 终态及无 blocker | 重新检查；不把旧 PASS 当作跳过当前 Guard 的依据 |
| Workspace Reconciliation | 登记工作区可安全操作，目标分支和远程状态符合 [§12.2](#section-12-2) | 已对齐则跳过；未对齐则安全补齐；脏目录、权限或身份冲突时停止 |
| Summary / Artifact | 当前 Delivery 的摘要与产物存在、内容正确、引用可读取 | 按既有 ID / 稳定目标更新或补齐，不重复追加相同评论、附件或归档记录 |
| Change Archive | 当前 Change 要求的产物已归档且仍可读取 | 已归档不重复移动；部分成功时先核对源与目标再恢复，不破坏仅存副本 |
| OpenSpec Archive / Root Commit（所有获准自动交付的 Change） | 当前 Change 已正确归档，根仓 Commit 可确认且与本 Delivery 对应 | 已归档 / 已提交则复用；结果未知先查询 Git / OpenSpec 事实，只补未完成动作；不创建 PR |
| TFS 回写（writeback） | 需求子任务已按 task_refs 建齐（工时仅在有合法来源时写入）、必要 Commit Artifact Link 已处理、子任务全部「已解决」且 RemainingWork 等必需状态回读一致、父项 Work Item 已按类型状态链达「已解决」且有收口评论 | 逐步幂等断点续走：已有映射复用 / 孤儿认领不重建，已落库字段跳过；部分完成只补缺失对象；不覆盖无关字段或撤销人工状态 |
| Issue Done | 上述必需动作均已确认，父 Issue 为 `done` | 未完成则最后写入；请求结果未知先回读，不再次触发新交付 |
| Pending 清理 | 对应事件的收口后置条件均已成立 | 只清理该事件；清理失败保留恢复入口 |

摘要与归档使用当前 Delivery / Artifact 的稳定身份；不得以“每次执行生成新文件名 / 新评论”代替恢复。已确认的工作区对齐结果与必需对象引用写入现有收口 Artifact，供最终写入及遗留事件恢复核对，不增加步骤状态表。外部操作已成功、Multica 引用回写失败时，优先找到并复用已存在对象，不盲目重新创建。

普通网络故障允许工具级有限重试；本轮仍失败时保留 pending 并结束，后续再恢复。已经成功的 PR 合并、TFS 更新和归档不做补偿回滚。

明确缺失条件按 `FAIL` 停止后续写入；身份、权限、证据或外部状态无法可靠确认时返回 `UNKNOWN`，交 Delivery Lead / Human。需要人工处理的真实阻塞使用现有 `blocked`，但不得每次轮询重复通知或再次启动专业返工。普通重试不更改已完成 Development Sub-Issue。

若父 Issue 已是 `done` 且存在 pending，仅执行收口事实核对和遗留引用 / 事件清理；不能因为本地会话目录已被回收就自动重开它。必需后置条件确实缺失或当前事实冲突时停止并交人工，不把异常伪装成成功，也不自动重新关闭 TFS。

<a id="section-12-4-4"></a>

### 12.4.4 安装版本恢复验收

本节是项目执行契约，不表示 Multica 自动提供跨 TFS、Git、Artifact 的事务。以下运行测试尚未执行：

| 场景 | 预期 |
|---|---|
| TFS 已更新，父 Issue 最后一次 `done` 写入失败 | 恢复时不重复研发、不重建 PR、不回滚 TFS，只补未完成写入 |
| 摘要 / 归档只完成一部分 | 核对既有对象后补齐，不重复产物、不丢引用 |
| 父 Issue 已 `done`，pending 清理失败 | 下一次扫描仍能恢复，核实后清理，不重新交付 |
| 工作区脏、被占用或来源不明 | 停止，不 `reset --hard` / 强删，不切换其他任务的分支 |
| 完整重复运行 finalize | 不重复副作用；已有合法结果保持不变 |
| Corrective Change 缺少已要求的 OpenSpec 环境或 Change | 报告具体缺口，不能完成 Analysis Gate / 正式研发授权 / Finalize；保留已完成调查，不静默降级或伪造产物 |
| 两类修复缺少必要根因 / 修复输入、有效回归证据或人工批准 | 按现有契约停止；不将“轻量产物”解释为跳过公共质量与审批条件 |
| 任一自动交付的 Change 仍有必要工程任务未完成，但归档命令支持 `--yes` | 项目 Guard 在归档前返回 FAIL，不更新主规格、不关闭交付 |
| 规格 / 验收要求变化，候选代码未变 | 旧 Evidence 先作有效性判断，未取得当前必需结果不得放行 |
| 归档成功但根仓提交或引用回写失败 | 查询已归档与 Git 事实后只补未完成项，不重复 Delta 合入 |
| 无 Delta 的 Corrective Change | 原生跳过事实和 Validation 一致；归档后主规格不变，Corrective Proposal / Tasks / Evidence 仍可读取 |
| Corrective 补录既定行为场景形成 Delta | 人审批准该补录及修复范围；按同一 Change 完成实现、验证与主规格同步，不隐式转为需求路线 |
| Workitem Analyst 与 Engineer 在不同 Run / 工作目录 | 持久化交接和已批准基线可读取，不依赖共享会话或 Workitem Analyst 临时文件；读取不触发重新分析 |
| 两个 Change 修改同一主规格 / 根仓被占用 | 不覆盖他人修改，不使用旧基线无条件归档；冲突停止并按现有协作处理 |
| 初始批准基线已提交，研发 Tasks / Design 尚未最终提交 | 后续 Run 可从同一持久共享根仓读取；Task Set READY 不要求中间根仓 Commit，Finalize 统一提交授权范围 |
| 共享修改丢失或关键 Evidence 不可读 | 停止并交 Lead 恢复，不凭旧 READY 自动补勾或重建产物 |
| 根仓包含其他 Delivery 的修改或暂存项 | 只纳入当前 Delivery 的授权修改和归档结果；无法安全提交时停止，不混入他人修改 |

根仓归档的 Git 边界：

- 允许 `openspec/` 外的未暂存修改和未跟踪文件留在原处；不清理运行时注入，不自动 stash。提交范围仅限当前 Change、其唯一归档目录及所触及的主规格；其他 OpenSpec 改动仍停止处理。
- 操作前和每次提交前检查全仓暂存区，存在范围外内容时停止并保留索引；推送前逐个检查本地未推送提交，拒绝夹带范围外历史或无法确认范围的合并提交。
- 新增本地保存提交之前先 fetch：分支一致或仅本地领先时核对后继续；仅落后时只允许 `merge --ff-only --no-autostash`。需要快进但暂存区非空、会覆盖本地修改或分支已分叉时停止，保留提交及工作区。
- 对齐后复核 Change 位置与契约哈希。推送失败先回读远端，未分叉时最多尝试三次；分叉时不 rebase、不强推，保留归档提交与 `finalize.pending`，不进入后续 TFS 回写及 Issue 完成。

Run 成功、PR completed、Issue done 是不同事实。调用方只根据上述后置条件报告收口成功。

---


# 13. Cross-Stage Delivery Facts & Decision Boundaries（跨阶段事实与决策边界）


<a id="delivery-facts"></a>

## 13.1 状态与事实来源

Multica 保存：

```text
Issue
Status
Assignee
Squad
Sub-Issue
Stage
Run
Comment
Metadata
Artifact
```

入口准入依据由同一 Issue 的 `/note` Comment 保留（首次可顶层，Human Comment 触发的恢复 Run 必须线程回复；含 Decision、TFS 来源版本、Evidence References、未决问题），Status / Assignee 表达当前交接结果；不新增 Triage Artifact 或并行 Truth Store。权威细则见 [§4.1.1](#delivery-intake)。

存在工程增量时，Analysis 在 Multica Issue Metadata 中保存最小 Delivery Facts，不新增 `analysis_result` Domain Object；无需工程增量仅保留原生 Comment。以下为已提交审核的逻辑字段视图：

```yaml
analysis:
  change_kind: corrective | intentional
  change_ref: ...
  source: ... # 固定 repo_url / branch / commit / change_ref


  gate:
    result: PASS
```

Acceptance Contract、Verification Contract、Development / Repository Scope、技术风险 / 依赖 / Open Decision 与 Evidence 均保留在各自权威 OpenSpec / Supporting Artifact 中；Multica Handoff Facts 只保存 Delivery 决策与必要引用，不复制工程契约。Analysis Gate 以 stdout 返回 PASS / FAIL / UNKNOWN；仅发布成功的 PASS 登记为 Issue Metadata，不创建 `gate-result.md` 或独立 Gate Result 对象。

对于一次 Engineer Task Set 执行，建议在当前 Run / Issue 上保存最小 Engineering Facts，并以 `task_refs` 标识覆盖范围：

```yaml
development:
  task_refs: []
  result: complete | blocked | unknown
  local_validation: pass | fail | unknown
  code_review: pass | fail | unknown
  candidate_commits:
    - repository: ...
      commit: ...
  pr_preparation_ready: true | false
  evidence_ref: ...
```

其中：

```text
development.result = complete
= 当前 assigned Task Set 已满足 §8 的工程完成及进度发布条件
= Local Validation PASS
+ Code Review PASS
+ 必要业务代码 Commit / Push（纯验证按 §8 复用）
+ PR Preparation
+ Evidence 完整
+ Tasks 完成状态更新确认且发布前依据仍有效
```

对于 Development Sub-Issue，先按 [§8](#development-execution) 保存各 Task Set 结果；其全部当前 required Task Sets 均满足 READY 条件后，才以 Sub-Issue 的当前完成状态作为其完整承接范围的 Runtime Completion Fact。重开时该事实立即不成立；旧 `development.result` / Check 结果仅可作为对应旧候选成果的记录，不能覆盖当前 Issue 状态。

对于 Parent Issue Runtime，`development.result = complete` 与对应 `task_refs` 作为父 Issue 中的 Development Fact 保存，但不改变父 Issue 的最终完成状态。返工时清除当前 complete 结论，保留旧 Evidence，重新满足 [§8](#development-execution) 的 Check → Patch / 回读 → 发布条件后再记录；不增加 `reworking` 状态或版本绑定字段。本节字段仍是逻辑示例，[04](04-engineer-development-design.md) 的 READY 表达相同的当前 Task Set 专业完成含义；实际字段映射由实施接口确定，不新增两套完成状态。

Verify 继续保存：

```yaml
verify_agent:
  required: true | false
  reason: ...
  verification_focus: []

verification:
  result: not_required | pending | pass | fail | unknown
  verified_commits: []
  evidence_ref: ...
```

其中：

```text
审核 Comment 中的 Independent Verify Recommendation
= Workitem Analyst 提出的分析建议

verify_agent.required
= Human Analysis Review APPROVED 后由 Development Materialization 从 Human 最终 Independent Verification Decision 确定性生成的执行事实

verification.result / verified_commits
= `verify_agent.required=true` 时 Verify Agent / Verification Gate 的 Independent Verification Delivery Fact；Task-level / Change-level Verification 的工程结果仍由 OpenSpec Tasks 与 Development Evidence 承载
```

对于外部系统：

```text
TFS / PR Platform
= 外部事实来源

External State Sync
= TFS Work Item + PR provider status（active / completed / abandoned）事实回流入口

Multica
= 研发流程状态持久化载体
```

不得额外维护：

```text
workflow-state.json
current-stage.yaml
delivery-state.md
```

---


<a id="section-13-2"></a>

## 13.2 Deterministic Decision（确定性决策）与 Semantic Decision（语义决策）

### 13.2.1 原则的适用范围

保留 **Deterministic First，Semantic Fallback**，但不解释为“所有工作先交脚本，脚本失败后才允许 Agent 判断”。

> **明确规则与可靠事实已经决定的结论，不由 LLM 重新裁量；本来需要专业分析或协作判断的工作，由相应角色正常承担，不必先经过一个无法判断的脚本。**

Multica、Agent、Script 分别承担运行、语义工作与明确动作保障；确定性、语义性和 Human Decision 是判断性质的区别。它们不是要求每次依次经过的三层控制器。

| 当前问题 | 正常处理方式 | 边界 |
|---|---|---|
| TFS Work Item 是否具备进入小队的业务归属、仓库、授权与自动化可行性 | Wayfinder Agent 依据自身 Instructions，按需使用 `codebase-explorer` 形成 Evidence-backed Triage Decision；Script 保障写入和回读 | `accepted` 不是编码授权；未知不默认 `unsupported`，不替代 Analyst / Human Review |
| 当前工作适合哪个成员、是否需要独立工作项 | Delivery Lead 结合批准范围与 Roster；已有明确安排时复用 | 不要求 Workitem Analyst 预先选择全部角色，不以 Router 返回 UNKNOWN 为前提 |
| 需求目标、场景、规则与范围是否清楚，Root Cause / Solution 是否成立，研发需遵守哪些约束 | Workitem Analyst；新工程事实由相应 Specialist 提供 | 不交 Leader 重做专业分析；需人工决定的关键取舍由 Human 确认 |
| 当前 Task Set 的实现细节、反馈方法与工程整改 | Engineer | 不擅自改动批准范围或整体协作安排 |
| `verify_agent.required=true` 时，批准的 Independent Verification Focus 是否在固定候选版本上成立、Finding 如何专业归因 | Verify Agent | 不把普通 Task Verification 或 Engineer Local Validation 全部转交 Verify Agent；也不用实现者自述替代要求的独立验收 |
| 候选 Commit、必需 Evidence、对象身份是否满足明确条件 | 必要的 Script / Gate / Check | 只检查可核实硬条件，不覆盖 Human 或专业语义判断 |
| 已确定 Owner 的任务如何写入、关联和恢复 | Multica API / CLI，必要时由脚本封装幂等与校验 | 不在每次写入时重新规划分工 |
| Run 排队、执行、状态及 Parent / Stage 回流 | Multica 原生机制 | 不另建项目级运行调度器 |
| 是否批准 Analysis、是否允许改变已批准边界 | Human / 既有 Review 流程 | UNKNOWN 和语义兜底均不授予绕过批准的权限 |
| 人工审核文本表达什么决定、附加条件与修正方向 | Delivery Lead / 现有 `delivery-flow` | 直接进行语义理解，保留原始来源；不由脚本关键词匹配，不代替 Human 批准 |

### 13.2.2 Deterministic Decision（确定性决策）

输入与规则明确、结果能够可靠检查，并且确有程序化保证价值的逻辑，交给已有 API 状态、Script / Gate / Check；平台已提供的运行机制直接复用，不在项目脚本中再实现一遍。

适用内容包括：

```text
必填字段与必要引用是否存在、可读取
创建 / 更新 / 激活入口的对象关联、已声明依赖引用与循环等待检查（按需，见 §7）
已批准 Human-approved Independent Verification Decision → verify_agent.required
已选择 Owner 的身份解析与校验
现有明确映射规则的直接应用（如有）
Development Completion Contract 的可检查条件
Development Sub-Issue 当前状态与有效 Evidence
Verify PASS 是否对应当前 Commit Set
Finding 已明确命中 `task_refs` 时，读取对应 Runtime Projection 的现有 Owner / Engineer
PR Preparation 必填 Facts
Branch HEAD / candidate_commit 校验
PR Materialization / 外部对象身份 / 幂等恢复
PR status active / completed / abandoned
已明确 Human Decision 的动作硬条件、来源引用、状态与写入结果（自然语言理解由相应 Agent 负责）
PR Transition / Workspace Reconciliation 安全检查
Delivery Completion / TFS Close / Issue Done
```

成员是否适合、某项技术工作能否独立拆分、运行依赖是否需要变成开发完成依赖，不能仅凭自由文本被声称为确定性结论。Script 不自行进行这些判断，也不扩展为根据 Analysis 自动生成唯一分工的 Compiler。

简单固定的成员分工由 Leader 可见的协作规则维护并使用原生派发；确有明确映射时直接沿用，不为每次交接增加独立 Route Script。

### 13.2.3 Semantic Decision（语义决策）

#### Wayfinder Agent（入口准入智能体）

在 Squad 外 Intake Triage 阶段调查 Business Scope、Repository Discovery 与 Processing Capability；基于可复核 Evidence 判定 `accepted | needs_human | unsupported`，持久化 `/note` Comment 并受控交接。不得代替 Analyst 的 Change Kind 判断、Root Cause / OpenSpec Preparation、Human Approval 或 Squad 内成员派工，详见 [§4.1.1](#delivery-intake)。

#### Workitem Analyst（工作项分析员）

负责：

```text
Requirement / Problem Goal、业务场景与行为规则
Current / Expected Behavior、需求范围与验收澄清
Corrective / Intentional
Root Cause / Solution / Fix Strategy
Development Scope / Repository Scope
技术依赖与约束
OpenSpec Tasks / 当前 Change 的实施依据
技术拆分与能力需求建议（按需）
Acceptance / Verification Contract（OpenSpec）
Verify Agent Recommendation（Multica） / Verification Focus
```

不要求掌握当前小队成员配置，不承担最终成员选择或 `@mention` 派工；需求分析与研发准备不等于运行分工。

#### Delivery Lead（交付负责人）

负责人工审核意见的正常语义理解，以及批准边界内的协作判断：

```text
理解本次 Human Comment 的决定、条件、修正方向与是否需再确认
结合当前 Roster 选择适合的成员
当前 Issue 中哪些 `task_refs` 分配给哪些成员
通过 `@mention` 交接专业工作
技术约束允许的并行 / 顺序
复用现有分工；只在相关新事实改变安排时调整
跨角色冲突、无法归因的 Finding 及责任协调
输入不足或 UNKNOWN 应交哪个 Specialist / Human 处理
何时必须回到已批准边界的 Review
```

Leader 不是纯异常处理者，也不是所有技术规划的 Owner。选择成员与组织协作不必等到脚本返回 `UNKNOWN`；不重新调查已确认根因或替代 Engineer 编写详细实现步骤。

#### Engineer（工程师）

负责工程实现语义：

```text
Implementation Detail
局部设计与重构
实现步骤、测试策略与 Feedback 方法
Code Review 判断
代码修复
PR Preparation Semantic
```

#### Verify Agent（验证智能体）

负责 Delivery-level 验收语义：

```text
Acceptance Contract 是否实际满足
Behavior / Runtime / Integration / E2E Evidence
Finding 的专业归因
```

#### Human（人工决策者）

负责：

```text
Analysis Approval / Rejection
需求、方案与验收边界及其需要批准的变更
当前任务明确要求审批的人员 / 拆分 / 顺序（如有）
abandoned 的业务含义
ANALYSIS / ENGINEERING / RECREATE_PR / CANCEL_DELIVERY
其他明确要求人工批准的决策
```

### 13.2.4 Semantic Fallback（语义兜底）与停止边界

`UNKNOWN` 表示当前机制不能获得可靠结论。需要跨角色处理时由 Delivery Lead 协调适当的语义 Owner 查明原因、补充信息或安排修复；不要求 Leader 亲自承担所有专业诊断。

明确 `FAIL` 仍按对应 Gate 的等待、返工、停止或恢复规则处理。权限不足、必要批准缺失、证据不匹配等条件，不能因进入 Semantic Fallback 就获得豁免。

统一原则：

```text
原生运行与协作机制
→ 直接复用 Multica

已明确硬条件与可靠事实
→ 使用相应确定性结果，不再主观裁量

专业分析或协作选择
→ 由相应 Agent 正常承担，不先制造 UNKNOWN

已有安排或有效结果
→ 复用，不因新 Run 重复规划和派发

无法可靠继续 / 需要改变批准边界
→ 协调适当的 Specialist / Human，不能绕过硬条件
```

---


<a id="delivery-principles"></a>

# 14. 核心设计决策（摘要视图）

> **一个 TFS Work Item 默认对应一个 Issue。**

> **OpenSpec `tasks.md` 是 Engineering Work Breakdown；`Task Set / task_refs` 只是一次 Engineer Run 的分派引用范围，不建立独立对象、状态或生命周期。**

> **Development 默认使用父 Issue + `@Engineer` + `task_refs`；Development Sub-Issue 只用于需要独立 persistent runtime state 的执行范围。**

> **TFS Sync 初始化新 Issue 为 `backlog + Wayfinder Agent`，来源 / Owner 回读后受控激活；Wayfinder 结论 `/note` 持久化且 `accepted` 后按 `tfs.type` 交给 Bug Fix Agent 或 Delivery Squad；职责明确的 Development Sub-Issue 默认直接由对应 Specialist Agent 持有。**

> **只有 Development Sub-Issue 本身需要持续多角色协调或无法由单一 Specialist 长期持有时，才由 Delivery Squad 持有。**

> **Delivery Lead 在批准边界内结合当前 Roster 正常承担成员选择、工作分工、委派与交接；不是仅在 UNKNOWN 时介入的异常处理者，也不替代专业技术规划或底层运行调度。**

> **Workitem Analyst 把需求与问题分析清楚并做好研发准备：明确目标、业务场景、行为规则、范围和验收要求，结合现有系统形成必要方案；可以提出技术拆分建议，不承担最终成员分工或人工批准。**

> **Corrective / Intentional 共用 OpenSpec Change Model；各自使用项目级 `corrective-change` / `intentional-change`。Schema 负责 Artifact Contract，专业方法按需组合，不合并 Agent / Run。**

> **OpenSpec 初始批准基线先提交根仓；研发受控修改保存于持久共享工作区，最终由 Finalize 统一提交。它不作为业务 Repository Change，不创建独立 PR，也不进入 required PR 集合；关键内容丢失时停止并交 Lead 恢复。**

> **实际工程增量由 Workitem Analyst 通过 `analysis-publish` 提交审核；无需工程增量直接记录普通 Comment。Human 作出工程契约批准决定；Delivery Lead 理解自然语言意见并落实。Gate 检查与工具写入不代替人工决定，也不替代其语义理解。**

> **Human 批准需求、方案与验收边界；Leader 在边界内组织协作。需要改变 Expected Behavior、Contract、Scope 或降低验收要求时，返回既有 Analysis / Human Review。**

> **Materialization 只落实已确定的协作安排；Script 检查硬条件、身份与幂等，不从 Analysis 自由文本自行决定任务拆分和成员选择。**

> **Deterministic First，Semantic Fallback 适用于明确硬条件与可靠事实；专业分析和协作选择由相应 Agent 正常承担，不要求先获得 UNKNOWN。明确 FAIL 不因语义兜底而被覆盖。**

> **Leader 减负依靠复用已有分工、避免重复分析与重复派发，不把正常协作职责转移给 Workitem Analyst 或通用 Router。**

> **Development Sub-Issue 的完成契约止于 Engineering Contract 完成：Implementation、Local Validation、Code Review、Commit / Push、PR Preparation 与 Development Evidence。**

> **当前 Task Set 经 Check → Patch / 回读 → 发布前核对后形成 READY；同仓唯一 Development Sub-Issue 承接的全部当前 required Task Sets 均完成后，才允许该 Sub-Issue 完成，不表示整个 Delivery 完成。**

> **Development Sub-Issue 创建为 backlog，完成必要写入与回读后，仅激活依赖满足的 Sub-Issue；准备与激活复用原生能力，不新增 Bootstrap 事务、锁或状态机。**

> **Isolated Runtime 优先复用 Multica 原生子任务 / Stage 完成机制回流 Parent Delivery，而不是维护额外 Development Ready 父级通知状态机。**

> **Multica 负责原生运行去重与同一 Issue / Agent 的串行调度；父级按当前事实继续协调；capability 负责副作用幂等。不新增 Parent Lock、CAS、Transition Claim 或第二套 Runtime State。**

> **Parent Issue Runtime 没有独立 Sub-Issue；Development Completion 只形成父 Issue 内的 Development Fact，父 Issue 继续承担 Verify、PR 与最终关闭。**

> **Local Validation + Code Review 是 Development 必备环节，与 Verify Agent 是否参与无关。**

> **Code Review = implementation-oriented；Verify Agent = optional independent behavior-verification executor。**

> **Verify Agent 是否需要由 Workitem Analyst 推荐，Human Analysis Review 确认。进入 Independent Verification 前，必须完成全部 required Implementation Tasks、Engineer-owned required Verification Tasks 及相应 Engineer-side Development Completion；Verify-Agent-owned Verification Tasks 可以保持 pending，由 Verify Agent 在本次独立验收中完成。进入 PR Materialization 前，所有 required Verification Tasks（不论执行者）必须完成并有当前有效 Evidence，且 `verify_agent.required=true` 时还须当前 Independent Verification PASS。**

> **Verify Finding 命中 Development Sub-Issue 的 `task_refs` 时，在原 Sub-Issue 准备输入、重开并单次触发 targeted rework；命中 Parent Issue Runtime 的 `task_refs` 时，由 Delivery Lead 在父 Issue 定向 @ 原 Engineer；不级联回退整个 Stage，不沿用失效 Evidence。**

> **PR Preparation 属于 Engineer Semantic Work；PR Materialization 属于确定性副作用，不绑定某个 Specialist Agent。**

> **PR 是 Repository 级交付对象；每个代码变更 Repository 独立 PR。**

> **PR Completed 后由 PR Status Sync 当前 Run 执行有界 deterministic finalize；恢复时重查事实、只补未完成副作用，父 Issue 最后写 done，全部后置条件确认后清理 pending。**

> **TFS Sync Agent / PR Status Sync Agent 保留 Multica Autopilot Agent Run，但 Agent 仅作为 Thin Adapter，确定性逻辑进入 Script。**

> **Integration / E2E 是 Verification Method，不是独立 Post-Merge Stage，也不与 Verify Agent 绑定。**

> **Stage 只用于 Development Sub-Issues 之间基于完成状态的依赖，不用于表达 Delivery 生命周期阶段。**

> **Squad Instructions 只约束接收它的 Leader；Member 通过自身 Instructions、绑定 Skill 和当前 Issue 获得执行契约。**

> **不建设第二套全局 Workflow Runtime。**

---


# 附录 A. Agent、Squad 与 Skill 实施资产映射

本附录描述交付方案使用的配置资产与推荐关系；公共配置写法以 [01](01-multica-openspec-design-guideline.md) 规范为准，专业执行规则以 [03](03-workitem-analysis-design.md) / [04](04-engineer-development-design.md) / [06](06-method-skill-library-implementation-design.md) 为准。下列目录为推荐实施视图，不能因目录存在就推断其已部署。


## A.1 Agent（智能体） / Squad（小队） / Skill（技能）边界

公共配置边界以 [统一规范：Multica Runtime Context](01-multica-openspec-design-guideline.md#mechanism-shared-context) 的 [§4](#section-4)、[§6](#human-analysis-review)–[§7](#development-materialization)，以及 [§9.1](#verify-agent-decision)（规则归属）、[§9.3](#section-9-3)（Instructions 不复制 Workflow）为依据。本方案仅列交付场景的使用方式。

| 资产 | 执行主体 / 用途 | 当前交付内容 |
|---|---|---|
| Multica Squad Instructions | 提供给当前 Run 的 Leader，定义协调与委派 | 首次分析委派、人工审核意见理解与权限边界、基于 Roster 的成员选择与交接、已有安排复用、Human 等待与异常升级 |
| Multica Agent Instructions | 提供给对应 Agent，定义长期职责与边界 | Wayfinder（Squad 外）、Workitem Analyst、Engineer、Verify Agent 的责任、禁止越界和停止条件 |
| 绑定 Skill | 对应 Agent 的可复用执行方法 | `bug-analysis`、`requirement-analysis`、`spec-preparation`、`development-execution` 等的步骤、Evidence 与输出契约 |
| Multica Issue | 当前交付运行工作契约 | Goal、Approved Context、Source Requirement、Repository Scope、OpenSpec Engineering Contract 引用、依赖、Candidate Commit、产物引用 |
| Multica Comment / Handoff | 本轮新增的工作要求 | Wayfinder `/note` 准入证据、Finding、预期修正、必要协作信息；普通讨论不自动构成审批 |
| Script / Gate | 必要的硬条件与副作用 | Completion Check、PR Materialization、Sync、有限且可恢复的 Finalize |

Squad Instructions 不自动广播给 Member。Squad Role Description / Roster 帮助 Leader 选择成员，不替代 Member 的 Instructions，不自动赋予权限或绑定 Skill。成员可能通过工具读取其他资料，但不得据此假定这些规则已经进入其执行上下文。[^d-squad]

成员必须执行的输出、前置检查与停止要求，放在其 Agent Instructions 或绑定 Skill 中；其中详细方法统一由 Skill 维护。Backend / Frontend / Flink Engineer 共用的 `development-execution` 分别绑定给三个 Agent，不复制三份方法。

Leader 不在每次派发时复制完整 Squad Instructions / Skill，不要求所有 Member 先读取完整 Squad 配置。Issue 保存本次任务，Member 自有契约提供稳定方法，Leader 只补充本轮特有的协调信息。

Workitem Analyst 的需求与问题分析不依赖当前 Roster 或具体 Agent 配置。它可以提出工作所需的技术能力建议，但不为承担 Leader 的成员选择职责而额外复制、注入或长期维护小队成员映射。

同一 Issue 内的 Specialist 通过自己的 Instructions / Skills 和当前 `@mention` 任务独立执行，不依赖 Leader 临时对话；成员完成单个 Task Set 不得据此关闭整个 Issue。

---


## A.2 推荐 Agent（智能体） × Skill（技能）

| Agent | Squad Role | 主要 Skill |
|---|---|---|
| Delivery Lead | Leader | delivery-flow / delivery-gate / development-task-materialization / pull-request / task-close |
| Workitem Analyst | Member | 当前：codebase-explorer / bug-analysis / requirement-analysis / spec-preparation / analysis-publish |
| Backend Engineer | Member / Sub-Issue Owner | development-execution / backend-engineering |
| Frontend Engineer | Member / Sub-Issue Owner | development-execution / frontend-engineering |
| Flink Engineer | Member / Sub-Issue Owner | development-execution / flink-engineering |
| Verify Agent | Member | acceptance-verification |
| Wayfinder Agent | Squad 外 Intake Triage | codebase-explorer |
| TFS Sync Agent | Squad 外 Thin Adapter | tfs-sync |
| PR Status Sync Agent | Squad 外 Thin Adapter | pr-status-sync |

说明：

- 表中候选能力与已实现绑定不得混淆；以 `workspace-config/provisioning.json` 为当前仓内配置权威，不以概念图要求创建七个 Analysis Skills。
- Delivery Lead 正常承担父 Delivery 的成员选择、工作分工、委派与交接；已有安排直接复用，明确硬条件使用 Gate / Check，不以 `UNKNOWN` 作为协作判断的准入条件。
- Workitem Analyst 输出需求与问题分析结论及研发准备，并在 `analysis-publish` 中提交审核、确认状态后结束；Delivery Lead 理解后续 Human 意见，组织返工或获准研发，最终成员与 Sub-Issue 分工仍由 Lead 负责。
- 职责明确的 Development Sub-Issue 默认直接分配给对应 Specialist Agent；只有 Task Set 本身需要持续多角色协调时才 Squad-owned。
- Specialist 按 [§8](#development-execution) 完成各 Task Set 的 Check → Patch / 回读 → 发布；Development Sub-Issue 承接的全部当前 required Task Sets 均 READY 后进入完成状态，父级回流使用 Multica 原生父子 / Stage 机制。
- TFS Sync Agent / PR Status Sync Agent 作为 Multica Autopilot 的 Thin Adapter；真正同步与 reconcile 逻辑放在确定性脚本中。
- Code Review 属于 Engineer Development 内部机制。
- `pull-request` 的 PR Materialization 是确定性副作用，不绑定某个 Specialist Agent；由父 Delivery 流程在整体 Gate 满足后调用。

---


<a id="delivery-skill-layout"></a>

## A.3 推荐 Skill（技能）目录

```text
workspace-skills/
│
├── tfs-sync/
│   ├── SKILL.md
│   └── scripts/
│       └── reconcile-workitem.py
│
├── codebase-explorer/        # Wayfinder 独立代码库探索
├── workitem-analysis/   # Retired：历史源文件，不参与新绑定
├── codebase-explorer/       # 当前专业调查 Skill
├── requirement-analysis/     # 候选：Intentional 分析能力
├── bug-analysis/             # 候选：Corrective 诊断能力
├── spec-preparation/         # 候选：独立复用时提取
├── requirement-review/       # 候选：独立 Review 确有价值时提取
├── analysis-publish/
│
├── development-task-materialization/
├── development-execution/
├── backend-engineering/
├── frontend-engineering/
├── flink-engineering/
│
├── acceptance-verification/
│
├── pull-request/
│   ├── SKILL.md
│   ├── scripts/
│   │   └── materialize-pr.py
│   └── references/
│       └── pr-materialization-contract.md
│
├── pr-status-sync/
│   ├── SKILL.md
│   └── scripts/
│       └── reconcile-pr-status.py
│
├── delivery-flow/
│   ├── SKILL.md
│   ├── scripts/
│   │   ├── materialize-development.py
│   │   ├── route-verify-result.py
│   │   ├── route-human-decision.py
│   │   └── rondo delivery finalize
│   └── references/
│
├── delivery-gate/
│   ├── SKILL.md
│   ├── scripts/
│   │   ├── validate-analysis.py
│   │   ├── check-development-completion.py
│   │   ├── validate-verification.py
│   │   ├── evaluate-pr-transition.py
│   │   └── evaluate-completion.py
│   └── references/
│
└── task-close/
```

设计原则：

```text
delivery-flow
= 人工分析审核意见理解与后续协调方法
+ 调用原生操作与必要的确定性 materialization / finalize

delivery-gate
= 硬条件检查与 assigned Task Set Completion Check

Delivery Lead
= Parent Delivery Coordination
+ 正常成员选择 / 工作分工 / 委派与交接
+ 复用已有安排，调用必要确定性 capability
+ 协调冲突与 UNKNOWN，不替代专业判断

Specialist-owned Development Sub-Issue
= 独立 Engineering Contract

Sync Agent
= Thin Adapter

Specialist
= 专业语义工作
```

Issue 启动使用 Multica 原生 Squad Leader → Member 协作，不设置独立启动脚本。

不建设额外的全局 Workflow Runner。

---


<a id="section-B"></a>

# 附录 B. 端到端验收索引（不替代各阶段检查契约）

| 验收范围 | 对应权威章节 | 应覆盖的主要情形 |
|---|---|---|
| 同步 / Wayfinder 准入 / 启动 | [§4](#section-4) | TFS 初始化与受控激活、三种 Triage Decision、`/note` 持久化 / 回读、Owner / Status 交接、`unsupported` 终止状态人工恢复 E2E、重复启动与失败对账 |
| 分析 / 人审 | [§5](#section-5)–[§6](#human-analysis-review) | Gate PASS / FAIL / UNKNOWN、审核自然语言批准 / 驳回、状态回读与恢复 |
| 研发投影 | [§7](#development-materialization) | Parent / Sub-Issue 两种入口、Owner、Stage、派发失败和依赖激活 |
| 研发完成 / 回流 | [§8](#development-execution) | Task Set Coverage、Local Validation、Code Review、并行回流、旧 Evidence 失效 |
| 验证 / 返工 | [§9](#verification-rework) | 按需独立验收、验证失败定位、固定 Commit、连续失败保护 |
| PR / 最终完成 | [§10](#pr-materialization)–[§12](#section-12) | 仓库级 PR、active / completed / abandoned、Merge 对账、Archive、TFS / Delivery Done、部分失败恢复 |

此表是导航，不引入新的 Gate、状态或验收事实源。详细可执行测试要求仍以各章节原有验收条款和安装版本验证为准。


# 附录 C. 机制与专业来源引用

Multica 机制及官方 URL 统一在 [指导手册来源索引](01-multica-openspec-design-guideline.md#official-source-index) 维护；本文脚注只定位到对应机制条目。专业 OpenSpec Archive 依据保留在本方案，不迁入公共机制手册。

[^d-squad]: 参见 [指导手册：Squad / Instructions](01-multica-openspec-design-guideline.md#mechanism-squad)，平台接收范围和官方来源由该条目统一维护。
[^d-trigger]: 参见 [指导手册：Assignment、启动与请求级暂不启动](01-multica-openspec-design-guideline.md#mechanism-assignment) 和 [CLI / API 版本边界](01-multica-openspec-design-guideline.md#mechanism-cli-version)；本方案只定义返工的准备与唯一触发路径。
[^d-runs]: 参见 [指导手册：Issue Status 与 Run 生命周期](01-multica-openspec-design-guideline.md#mechanism-issue-run)，`rerun` 不等于全量重做或保证恢复旧会话。
[^d-assign]: 参见 [指导手册：Assignment](01-multica-openspec-design-guideline.md#mechanism-assignment)，改状态或改 Owner 不取消已经开始的 Run。
[^d-child]: 参见 [指导手册：Parent / Child 与 Stage](01-multica-openspec-design-guideline.md#mechanism-parent-stage)，原生通知与业务完成、事务保证分开。

[^d-openspec-archive]: OpenSpec 官方 [Archive 公开实现](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/src/core/archive.ts)，2026-09-29 核对：未完成任务的原生交互 / `--yes` 行为不等于项目交付授权。安装版本仍须执行 [§12.4.4](#section-12-4-4) 验收；公开 `main` 不等于团队已安装版本。

---

# 附录 D. 章节迁移索引（仅供更新引用）

| v1.5 章节 | v1.6 位置 |
|---|---|
| §1–§3、§4 | §1–§3（对象模型现为 §3.7） |
| §5–§6 | §4 |
| §7–§8 | §5 |
| §9 | §6 |
| §10、§13–§14 | §7 |
| §11、§12、§15 | §8 |
| §16、§28 | §9 |
| §17–§18 | §10–§11 |
| §19–§22 | §12 |
| §26–§27 | §13 |
| §29 | §2.3 |
| §30 | §14 |
| §31 | 与 §2.3 / §14 重复的总结不再独立维护；来源引用见附录 C |
| §23–§25 | 附录 A |

此索引不是新的执行规则。跨文档如引用旧章节号，应按对应标题和明确的 HTML 锚点核对后更新。

---

<a id="historical-changes"></a>

# 附录 E. 历史版本与设计决策记录

## v1.6.12 来源变更复核与 unsupported 恢复验收（2026-10-13）

- 在 Analysis 提交和 Human 批准基线消费前检查 TFS 来源实质变更；非实质管理更新允许继续，实质变更按已有 Analysis / Human Review 流程处理，不自动重跑 Wayfinder。
- `unsupported (closed)` 的 Human Mention 恢复仍待独立 E2E，记录验收步骤但不新增 Workflow 状态、Gate 或补偿脚本。

## v1.6.10 默认入口与 Comment 读取契约（2026-10-13）

- Wayfinder 仅是自动 TFS 同步入口的默认准入；显式直接委派的 Analysis 允许绕过，Human Analysis Review 仍按现行契约执行。
- §4.1.1 统一 `/note` Decision 的顶层与回复读取规则；不扩展 Issue Status、Run 验收层级或新建脚本。

## v1.6.9 Wayfinder Todo + Assignment Auto-Start（2026-10-13）

- TFS Sync 的同步完成态固定 `todo + Wayfinder`，初始化仍停放 `backlog` 并回读来源字段。
- Wayfinder `eligible` 后通过 `rondo intake handoff` 以单次 Update 设置 `todo + Bug Fix Agent / Delivery Squad`，通过原生 Assignment Trigger 启动对应 Run。
- Human 显式 `@Wayfinder` 恢复准入；评论触发 Run 在触发线程发布 `/note` 回复并按引用回读，沿用 WFP-7 / WFP-8 E2E 证据。
- 错误恢复、Run 重叠和生产验证继续作为待验收边界。

## v1.6.8 Wayfinder E2E Consistency（2026-10-13）

- 修正 §2 总图、§2.3.1 Run 示例、§13 Decision Ownership、附录验收与 Activation / 重新准入边界，使权威流程一致。

## v1.6.7 Wayfinder Intake Triage（2026-10-13）

- TFS Sync 改为初始化 Wayfinder-owned Issue，经独立 `codebase-explorer` 深度探索 / `/note` Comment 回读后按 Decision 分流。Workitem Analyst 继续使用现有 `context-analysis`。
- 只对 `eligible` 按 `tfs.type` 交给 Bug Fix Agent 或 Delivery Squad；`needs_human` 阻塞等待人处理，`unsupported` 终止当前自动交付路径，不影响 TFS 原始状态。
- Workitem Analyst 复用准入 Evidence，Human Analysis Review、Development / PR / Finalize 机制不变。


> 本附录保留此前各版本当时的设计决策及其演进依据，供架构讨论与追溯参考。历史内容按形成时的原意记录，可能与现行设计不同；**当前执行契约始终以 §1–§14 为准**。旧版本的文件名、章节号、字段和状态约定不自动升级为当前版本要求。

## v1.6.6 执行边界与回流验收补充（2026-10-09）

- 明确 Engineer 的父级 Verify / PR 停止边界、重复回流的无动作退出与幂等验收，补充 Sub-Issue / Stage 通知丢失后的原生恢复验收；首页修正 Sub-Issue 的按需运行隔离定位。

## v1.6.5 轻量协调与原生回流契约（2026-10-09）

- 以 v1.6.3 正文为基线；§3.3 明确 Delivery Lead 的轻量交付协调定位，§8.2.1 / §8.2.3 明确 Parent / Sub-Issue 原生回流及安装版本验收。

## v1.6.3 Run Boundary 说明补充（2026-10-09）

- §2.3.1 完整增加单 Engineer、无独立 Verify 的 7 次 Run 理想流转；保留逐次职责、状态、停止与交接描述；同时区分需要 Verify 的 9 次路径与 Autopilot 轮询的不固定计数。
- §3.1.1 增加 Run Boundary Contract，区分专业 Agent Run、Skill / Method 内部调用、Human Review 等待、确定性 PR 物化和 same-run Finalize。
- 不改变 Issue / Sub-Issue / Stage、Human Gate、Verification Contract、PR 生命周期及确定性 Gate 的既有权威规则；Run 数量仅为示例，不是新的固定执行要求。

---

## v1.6.1 局部修订记录

- §9.5 / §9.9 与 §2.3：明确 Verify-Agent-owned required Verification Tasks 的 Evidence 与 `tasks.md` 完成事实在 Verification Gate 前持久化，Gate 只读取事实；修正流程图顺序。
- §10.1 / §11.2：区分 Engineer 的 PR Preparation 语义修改与 Script 的客观事实校验、回填；涵盖仅修改 PR 描述、不修改 Commit 的情况。
- 本版不修改其他方案，不新增 Runtime、Stage、Gate、独立状态或 Task Completion Store。

---

## v1.6 章节重构记录

- 本版基于 v1.5 重排章节，保留主要交付职责、Gate、批准、Status、Evidence、异常与恢复契约；重复的第三份架构总结不再独立保留。
- 采用 §2 总览 + §4–§12 研发闭环 + §13 跨阶段决策 + §14 设计摘要的文档结构，迁移对照见附录 D。
- 本次修订将重复的 Sub-Issue Ownership 判定收敛至 §7.4、PR Preparation 最小输入契约收敛至 §10.1，修正内部编号与标题层级；不借此次文档修复调整批准或 Gate 语义。
- 补全 §11.2 PR Abandoned 返工在 Parent Issue Runtime / Development Sub-Issue 下的独立失效与单次启动规则，并将需要工程动作的 `RECREATE_PR` 指向同一规则；复用 §9.9 的 Targeted Rework，不新增 Runtime、Stage 或 Gate。

---

## v1.5 变更摘要

- 对齐统一规范 `01-multica-openspec-design-guideline-v1.16.1.md` 的章节重排；§23 精确引用当前配置、职责与 Workflow 边界。
- §7.1.1 明确 Multica Agent Run Context 与 OpenSpec Artifact Generation Context / Artifact State / Validation 的区分；实施级 Schema / Template 规则仍由 05 维护。
- 本版不改变 Delivery 生命周期、Human Review、Status、Gate、Task Set / Sub-Issue、Verify、PR、TFS 或收口契约。

---

## v1.4.20 变更摘要

- 在 §7.1 增加 OpenSpec Schema / Artifact Runtime Model 桥接说明，解释 Change → Schema → Artifact Graph → Template / Instruction → Artifact → Apply readiness 的关系。
- 明确 Template 负责 Artifact 输出结构、Instruction 负责生成语义；`artifact.requires` 与 `apply.requires` 分别表示工件构建依赖和 OpenSpec Apply 前置。
- 再次明确 OpenSpec Engineering Contract 状态与 Multica Delivery Lifecycle 分离：Schema / Artifact Graph 不表达 Owner、Human Approval、Issue Status、Verify Decision、PR 或 Delivery Completion。
- 具体 Schema YAML、Template Markdown、Task Identity、Validation / Archive 继续由 OpenSpec Schema 实施设计 v1.5 独占维护，主方案不复制实施细节。
- 同步当时的指导手册引用；不改变现有 Delivery 生命周期、状态机、Gate、Sub-Issue、Verify 或 PR 语义。

---

## v1.4.19 变更摘要

- 本版本不改变 Delivery 生命周期、状态机、Gate、Sub-Issue、Verify 或 PR 语义；同步最新 Guideline / Analysis / Development / OpenSpec Schema 文档引用。
- 同步专业 Owner 已确定的摘要规则：Intentional Design 改为 Conditional Artifact，Analysis Handoff 字段改为 `ai_review`，Issue 只保存 Source Requirement 与 OpenSpec Engineering Contract 引用。
- 上述专业规则的详细判断继续由 01 / 03 / 05 维护，Delivery 主方案不复制第二套判定算法。

---

## v1.4.17 变更摘要

- 同版本补充 Verify 决策权边界：Workitem Analyst 首次形成 Recommendation；Human Analysis Review 可接受或 override，最终 `verify_agent.required` 表示 Human 已批准的 Independent Verification Decision；仅改变独立性要求不触发 Analysis Rework，改变 Verification Contract / Scope 时必须返回 Workitem Analyst。
- Verification Executor 进一步收口：Change-level Verification Task 继续属于 OpenSpec Engineering Truth，不绑定 Agent；Multica 可投影给 Engineer，或在已批准 Independent Verification 与任务范围重合时投影给 Verify Agent。
- CI / script / browser / test runner 明确为 Verification Execution Mechanism，不作为 Task Contract Owner 或 Multica Runtime Owner。
- 修正 Verify Agent 启动前置：要求全部 Implementation Tasks 与 Engineer-owned Verification Tasks Ready；Verify-Agent-owned Verification Tasks 可保持 pending，由 Verify Agent 在 Independent Verification 中执行，避免“所有 Tasks 完成后才能启动 Verify Agent”的自锁。
- Verify Agent 执行的 Change-level Verification Task 若同时覆盖 Independent Verification Focus，一次有效执行可同时满足 Task Completion 与对应独立验收范围；已有 Engineer Evidence 不自动等价于独立 PASS。
- OpenSpec Native Verify 改为可选 Change-level consistency capability：`verify_agent.required=true` 时由 Verify Agent 执行或复用当前候选版本结果；`required=false` 时不作为 PR Transition 默认强制条件。
- 对齐 OpenSpec Schema Implementation 与 Engineer Development；Analysis、Guideline 不扩写。

---

## v1.4.16 变更摘要

- 对齐 OpenSpec Schema Implementation、Analysis 与 Engineer，Delivery Verification 模型改为 **Task-level Verification → 按需 Change-level Verification → 按需 Independent Verification**，不再把 Verify Agent 当作固定阶段。
- 保留 `verify_agent.required` 字段但收窄语义：只表示是否要求额外 Independent Verify Agent；`false` 不取消 Implementation Task Verify、Change-level Verification、Local Validation、Code Review 或必要 OpenSpec Native Verify。
- Regression / Integration / E2E 统一定义为 Verification Method；存在 Integration / E2E 需求不自动要求 Verify Agent，可由 Engineer、CI 或 Verify Agent 按 Runtime Projection 执行。
- Corrective 不再依赖 `bug-analysis.md` Artifact；最终 Problem / Root Cause / Fix / Regression Contract 归 `proposal.md`，条件性 Specs 与 `tasks.md` 共同形成 Engineering Truth。
- 取消独立 AC / VR Identity；有 Specs 时 Requirement + Scenario 构成 Acceptance Contract，Corrective `skip_specs` 时由 Proposal Expected Behavior / Regression Scope + Task Verification / Evidence 证明修复。
- Change-level Verification Task 仍属于 `tasks.md`，不创建 `verification.md` / `acceptance.md`、独立 Verify Issue 或 Integration Verify Stage。
- Verify Agent 定位为 **Optional Independent Verification Executor**；Verification Report 改为覆盖 OpenSpec Requirement / Scenario / Corrective Proposal / Task references，不再使用 `AC-xx` / `VR-xx`。
- PR Materialization 前统一检查 required Task Sets、required Verification Tasks，以及 `verify_agent.required=false OR current Independent Verify PASS`。
- 本次仅更新五份设计方案中的 Delivery 主方案，不修改 Delivery Lead / Squad / Specialist Agent 配置或执行资产。

## v1.4.15 变更摘要

- 将 **Runtime-Centric Delivery + Artifact-Centric Engineering** 明确为指导手册维护的顶层架构原则；本方案只引用并落实到 Delivery 生命周期，本次同版本修订不改变版本号。
- 将 Analysis 事实模型收敛为 **OpenSpec = Engineering Truth / Multica = Delivery Truth**，不再把 `Structured Analysis Result` 设计为第三套 Contract Store。
- `Analysis Handoff Facts` 明确只是 Multica 原生 Issue / metadata / custom property / comment / run result 上的最小交付事实集合，不拥有独立文件、生命周期、状态机或版本。
- AC、Verification Requirements、技术风险、依赖、Open Decision 与 Evidence 回归 OpenSpec / 专业 Supporting Artifact；Multica 只保存 Route、Change 引用、Verify Recommendation / Focus 引用、Review / Gate / Approval / Assignment 等交付事实。
- `Analysis Package` 继续作为 Human Review 的输入集合概念，不成为 Domain Object；Supporting Evidence 继续按需。
- 本次仅更新设计文档；Multica 字段映射、Agent Instructions、Skills、Scripts、Route Config 与 OpenSpec Schema 留待设计定稿后统一实现。

---

## v1.4.14 变更摘要

- Analysis 产物模型收敛为 **OpenSpec Change + Multica Analysis Handoff Facts + Supporting Evidence References（按需）**；`Analysis Package` 明确为逻辑集合，不创建同名 Markdown。
- 明确 Analysis Method / Skill 与 Artifact 解耦：`context-analysis`、`requirement-analysis`、`requirement-review` 等方法不再意味着必须生成同名文件。
- `requirement-analysis.md`、`requirement-review.md` 不再作为固定交付文件；Intentional 的需求结论直接沉淀到 Proposal / Specs / Design / Tasks 与 Analysis Handoff Facts，Review 输出结构化 Result / Findings。
- `context-pack.md` 改为条件性 Supporting Evidence；Context Evidence 仍必须可追溯，复杂跨仓 / 长证据链任务才需要独立 Context Pack。
- AC / Verification Requirements / Verify Recommendation 全部保留：Corrective AC 归 `bug-analysis.md`，Intentional AC 归 Spec；Verification Requirements 与 Verify Recommendation 作为跨阶段验证契约持久化。
- Verify Recommendation 继续区分 Recommendation 与 Human 批准后生成的 `verify_agent.required`；`not_required` 不取消必要 Verification Requirements 与开发侧验证。
- `corrective-change` / `intentional-change` Schema 本轮保持不变：Corrective 继续保留轻量 Proposal；Intentional 继续要求 Proposal / Specs / Design / Tasks，Design 为 Required Artifact / Conditional Depth。
- Workitem Analyst 不输出完整 Task Graph、`development_plan.units` 或 `role_requirement`；Delivery Lead 继续根据批准边界和当前 Roster 组织成员与 assigned Task Set。
- 配套升级 Analysis、Engineer、指导手册；本次仅更新四份设计文档，不修改 Agent Instructions、Skills、Scripts、Schema 或运行配置。

---

## v1.4.13 变更摘要

- OpenSpec Schema ID 正式统一为 Technical Change Kind 映射：`corrective-change` / `intentional-change`；Schema ID 使用项目级 kebab-case `<kind>-change` 命名，不再使用 `corrective` 或 Route 名 `sdd-fast` 作为正常 Schema ID。
- `bug-fix` / `production-fix` → `change_kind=corrective` → `schema=corrective-change`；`sdd-fast` → `change_kind=intentional` → `schema=intentional-change`。TFS Type、Technical Change Kind、Route、Schema 四个维度正式解耦。
- `intentional-change` 从 OpenSpec 1.13.2 `spec-driven` Fork 为项目级 Schema，Design 改为项目必需 Artifact，深度按复杂度伸缩；`apply.requires` 收紧为 Proposal / Specs / Design / Tasks 四项。
- `sdd-fast` 的 Specs 为项目必需行为契约，不允许用 `skip_specs` 掩盖 Intentional Behavior Change；Corrective 保留原生 `skip_specs` 表达“本次无主规格变化”。
- `corrective-change` 延续已验证的 `bug-analysis → proposal → specs/skipped → tasks`，独立 Design 不作为默认 Schema Artifact；复杂修复可显式引用附加设计。
- 明确 `Schema Validate PASS`、Artifact Graph Complete、Apply Ready、Analysis Gate PASS、Human Approved、Development Ready 分别判断；不以 CLI 退出码或 Apply Ready 代替项目准入。
- 现有项目级 `sdd` Schema 保留已有 Change 兼容与 Full-SDD / `sdd-standard` 候选定位，不映射到新的 `sdd-fast`，不迁移已有 `schema: sdd` Change。
- OpenSpec 1.13.2 的自定义 Schema、严格 Apply 前置、`skip_specs`、Validate / Archive 及跨进程恢复已有本地运行证据；真实 Multica 多 Agent、业务实现和异常恢复继续作为集成验收项。
- 配套升级 Analysis、Engineer、指导手册；本次更新设计文档，不发布正式 Schema 或 Agent / Skill / Script 配置。

---

## v1.4.12 变更摘要

- OpenSpec 运行基线明确锁定为 `1.13.2`；统一 Change 生命周期保留，产物契约改为按技术变更性质选择 Schema。
- `bug-fix` / `production-fix` 统一使用项目级 `corrective` Schema；`sdd-fast` 继续使用原生 `spec-driven`，不按 TFS Requirement / Bug 字面类型直接选择 Schema。
- Schema 选择在 Change 创建时持久化并跨 Run 复用；不新增 Route、Agent、Multica Stage、审批状态或第二套 Runtime。
- Corrective Schema 将 Bug Analysis 纳入正式 Artifact 依赖，保留 Proposal / Specs / Tasks，Specs 无变化时使用合法 `skip_specs`；不把独立 Design 设为默认必需节点。
- Human Review、Verify 推荐、TFS Task 规则、assigned Task Set / Sub-Issue、业务 PR、Archive 时点与现有幂等恢复模型保持不变。
- 配套升级 Analysis、Engineer、指导手册；本次为设计更新，仍需在锁定的 OpenSpec 1.13.2 环境执行 Schema / Status / Apply / Validate / Archive 验收。

---

## v1.4.11 变更摘要

- 三条自动 Route 统一采用 OpenSpec Change Model；Corrective 使用轻量产物契约，保留 bug-analysis、原有审核与工程质量要求。
- 保留 Workitem Analyst / Engineer 独立 Agent 与 Run，将必要持久化和接收方读取明确为交接基线；不新增包装 / 归档 Agent、Stage 或审批状态。
- 公共 Change / Tasks / 原生校验接入 Analysis、批准后根仓基线、Unit 交接、完成检查及 Finalize；需求专属 Review 不扩散至修复。
- Archive 覆盖全部自动 Route，有 Delta 才同步主规格；补齐跨 Run 可读引用、归档后路径恢复、根仓占用 / 冲突及仅提交当前交付文件的边界。
- TFS 管理类型、Task 规则、Verify 推荐 / 人审、Sub-Issue、PR 仓库边界、运行回流与幂等恢复保持不变。
- 配套升级 Analysis、Engineer、指导手册；本次仅更新设计，未部署 Agent / Skill / Script，未执行团队环境或 Token / 耗时验收。

---

### 历史版本记录（v1.4.10 及更早）

以下 v1.4.11 及更早记录保留当时含义，旧文件名、旧规则与旧来源核对日期不作为 v1.4.12 的执行依据。当前规则见正文。

## v1.4.10 变更摘要

- 配套引用升级为指导手册、Analysis 阶段方案 与 Engineer 阶段方案；分析文档正式使用 stage-design 命名。
- 明确主方案拥有跨角色生命周期，Analysis 拥有专业准备、Verify 推荐生成、Summary、Gate 细项和定向返工方法。
- Analysis 专业细则由阶段文档维护，本方案保留交付摘要及审核、物化、后续执行责任，消除推荐 / 检查清单的独立副本。
- Multica 官方机制与 URL 集中到指导手册，项目的启动、有限写入、回读、恢复和验收条件继续保留。
- 当前 Status Key 继续使用 `analysis_review`，Gate 名称与指导手册对齐；不将正常等待改为 blocked，不修改 PR Abandoned 专用路由。
- 保留现有业务生命周期、根仓 Git、TFS Task、Verify 批准与最终收口规则及历史摘要；本次仅更新文档，未部署或执行 Multica 运行验收。

## v1.4.9 变更摘要

- 明确 Workitem Analyst 在 `analysis-publish` 中发布分析、写入并确认 `analysis_review`；Gate PASS、状态生效与 Run 结束分别确认，提交后等待人工，不启动研发。
- 人工分析审核采用自然语言，由 Delivery Lead / `delivery-flow` 理解决定与条件；取消 `apply-analysis-review.py` 必经解析入口，工具仅保障明确后的检查、写入和恢复；保留版本号及 PR Abandoned 专用路由。
- 创建 / 更新 / 激活所需的输入、Owner、关联与依赖检查归入现有操作入口；Gate 名称和推荐脚本目录同步收敛，保留 Fix Strategy、OpenSpec Tasks 与必要 Stage。
- 将 Workitem Analyst 统一定位为需求与问题分析及研发准备，补齐目标、场景、规则、范围与验收在角色、审核和交接中的表达。
- 明确角色与 OpenSpec 方法协作，专业分析与规格准备连续深化；不复制详细规格 / 设计 / 计划，不冻结工程实现细节；沿用当前版本号与 Corrective 边界。
- 明确 OpenSpec 准备、校验、任务与归档仅适用于 `sdd-fast`；两类修复按自身契约执行，补充无 OpenSpec 环境的回归验收，版本号保持不变。
- 将 OpenSpec 组合表落实到现有 Analysis、Human Review、Development、Verification 和 Finalize 入口，不新增 Agent、Stage 或运行层。
- 派发当前 Unit 时明确 Change、主规格 / Delta、任务组及验收范围引用；规格任务不机械映射 Sub-Issue。
- 规格一致性检查融入现有 Code Review，独立行为验收仍按已批准 Verify 要求执行；未要求 Verify Agent 不等于免除验证。
- PR 前及 Finalize 检查必要工程任务、规格覆盖、偏差处理和有效 Evidence；规格 / 验收要求实质变化时重新判断证据，不只比较代码 Commit。
- Archive 使用原生能力，项目 Guard 不因 `--yes`、跳过校验或跳过规格同步而放宽；根仓直接提交、不建立独立 PR。
- 详细准备与执行契约分别下沉到 Analyst v1.8 和 Engineer，并补充安装版本验收场景。本次只更新设计文档，未实现 Skill / Script 或运行验收。

以下为历史版本记录，不作为当前执行规则。

## v1.4.8 变更摘要

- OpenSpec 定位为项目采用的规格驱动开发方式，规格贯穿分析、设计、实现、验证与归档，不绑定特定执行命令。
- Analysis 形成可驱动研发的规格与计划；Engineer 按规格实现并结合反馈验证，允许在批准边界内更新设计与任务。
- 保留既有 Route、人审、协作、Gate 与 PR 机制；归档时点、根仓 Git 跟踪及不单独创建 PR 的规则不变。

以下为历史版本记录，当前执行规则以正文为准。

## v1.4.7 变更摘要

本版本补充 OpenSpec 与当前 Delivery 架构的正式接入边界，不改变既有 Multica Runtime、Issue 生命周期、成员分工或业务 PR 模型。

- `sdd-fast` 正式使用 OpenSpec 作为 **Versioned Change Contract**；OpenSpec 不承担 Runtime、Assignment、Sub-Issue、Stage 或 Delivery Status。
- Workitem Analyst 在 Analysis 阶段创建 / 更新 OpenSpec Change；Human Analysis Review 一并批准其技术、行为与验收边界，不增加第二套 OpenSpec Approval State。
- Delivery Lead 消费 Approved OpenSpec 组织协作，但不得将 `tasks.md` 机械映射为 Development Sub-Issue。
- Engineer 在当前 assigned Task Set 内消费 Approved OpenSpec；`tasks.md` 只作为 Implementation Checklist。
- Approved OpenSpec Change 在 Human Review 通过后提交到根仓，形成稳定 Development 输入；根仓 Commit 不作为业务 Repository Change，不创建独立 PR。
- `sdd-fast` Final Completion 的 Route Archive 明确包含 OpenSpec Archive + 根仓 Git Commit；失败 / UNKNOWN 阻止最终 `done`，但不回滚已完成业务 PR。
- OpenSpec Change Identity、Artifact 深度、Preparation / Review / Rework 细节下沉到 Workitem Analyst 领域方案，遵守 One Rule, One Owner（单一规则、单一归属）。

## v1.4.6 变更摘要

本次只调整技术准备、成员协作与确定性执行的职责边界，保留既有交付生命周期和运行机制。

- 在 §2 总体架构图下新增各 Agent 定位、主要工作与交付边界，并说明 Squad、Human、Script 与 Multica 的关系。
- Delivery Lead 收敛为批准边界内的父级协作职责；正常负责成员选择、必要任务分工与交接，不再以笼统的 Runtime Topology Owner 定义全部规划权，也不降为纯异常处理者。
- Workitem Analyst 保留研发准备、技术依赖、实现建议与按需拆分建议；不强制输出完整执行 Task Graph、`development_plan.units` 或 `role_requirement`，不依赖当前 Roster。
- Human Review 明确批准技术与验收边界；边界内的正常协作安排由 Leader 承担，明确要求人工审批的分工或顺序仍遵循该要求。
- `materialize-development.py` 继续落实已经明确的协作安排，不扩展为从 Analysis 自动推导唯一运行分工的 Compiler。
- 明确 Deterministic First，Semantic Fallback 的作用域：硬条件不重复裁量，专业与协作语义由相应角色正常承担，UNKNOWN 不授予绕过 FAIL 或人工批准的权限。
- 同步修订 §1、§3、§7–§10、§12–§14、§23–§25、§27、§29–§31 的契约、模板、流程与摘要，避免仅在角色说明中修改而下游继续依赖旧职责。

本次未调整 Status Key、Gate / Skill 集合、PR 同步与收口策略，也未改写配套规范、Analyst 或 Engineer 独立文档。实施前需将本次职责边界同步到相应 Instructions / Skills；本次仅完成文档更新，未执行 Multica CLI / Server 运行验收。

以下历史摘要保留版本记录，不作为当前执行规则；当前职责与流程以正文为准。

---

## v1.4.5 变更摘要

当前执行规则见正文：原生 Squad 启动与按职责分配；Engineering Contract 完成与父级回流；子任务准备 / 激活；父级防重复；Human Comment 处理；Leader / Member 注入边界；定向返工与事实驱动收口。版本号保持 v1.4.5。


---

## v1.4.4 变更摘要

相对 v1.4.3，本版本完成 Review P0 / P1 / P2 / P3 的收敛：

- Development Topology 调整为两层模型：
  - Workitem Analyst 输出 **Development Plan / Task Graph**；
  - Delivery Lead 拥有最终 **Multica Runtime Topology / Collaboration Decision**；
- Human Analysis Review 审核 Development Plan / Task Graph，但不直接批准最终 Runtime Topology；
- Delivery Lead 决定是否创建 Development Sub-Issue、是否需要 Stage、各 Specialist 的参与与 `@mention` 顺序；
- 所有 Development Sub-Issue 统一 `assignee = Delivery Squad`，不直接长期分配给 Specialist Agent；
- Specialist 统一通过 Delivery Lead `@mention` 工作，成员 Result / Progress Update 复用 Multica 原生机制重新唤醒 Leader；
- 不再设计额外 `@Delivery Squad` 的父级回流机制；
- `start-analysis.py` 正式接入 Issue 启动流程；
- `apply-analysis-review.py` 正式接入 Human Analysis Review 的 APPROVED / REJECTED 路径；
- `route-human-decision.py` 正式接入 PR Abandoned 后 Human `NEXT` 的确定性路由；
- `Development Completion Check` 统一更名并收敛为 `Development Readiness Check`；
- Gate `FAIL` 不再统一解释为 targeted rework，而由每个 Gate 定义 wait / rework / stop / recovery；
- TFS Sync Agent / PR Status Sync Agent 明确采用 **Multica Autopilot + Thin Agent Adapter + Deterministic Script**，避免为了完全无 Agent Run 再建设第二套 Runtime；
- PR Completed 后继续使用 PR Status Sync current-run 的 deterministic finalize；
- 修复重复的 `## 3.4 Specialist Agent` 标题等编辑问题；
- 两条核心原则保持不变：
  1. 能确定性化的业务规则、Gate、副作用、幂等、物化全部进入 Script；
  2. Happy Path 保留 Multica Squad 原生 Delivery Lead Run，Lead 优先使用确定性路由，确定性不足时承担完整语义协调职责。

---

## v1.4.3 变更摘要

> 本版本直接基于 `v1.4.1` 调整；此前生成的 `v1.4.2` 草案废弃，不作为本版本基线。

- 恢复并明确 Delivery Lead 的完整 Leader 定位：**Deterministic First，Semantic Fallback**；
- 保留“多 Agent 协作优先由 Delivery Lead 通过 `@mention` 协调”；
- 明确 Delivery Lead 在确定性 Route / Gate 无法可靠决定下一步、返回 `UNKNOWN`、出现事实冲突或跨角色歧义时，必须承担语义路由与协调职责；
- 区分 **专业语义工作** 与 **协调语义工作**：Workitem Analyst / Engineer / Verify Agent 负责各自专业领域，Delivery Lead 负责跨角色 routing / coordination semantic decision；
- 确定性规则、Gate、副作用、幂等、物化与完成检查继续全部下沉到 Script / Gate / Route；
- Delivery 启动与 Human Analysis Review 后保留 Squad 原生 Delivery Lead Run；Lead 优先调用确定性 route / materialization，必要时才语义判断；
- Development Readiness Check 正式定义为 Deterministic Script：Engineer 只产生 Ready Facts，Delivery Lead 被成员进展唤醒后调用 Check 并协调下一步；
- Isolated Runtime 不再以“Engineer 最后一个 Ready Run 直接跨成员 dispatch”作为主路径；改为成员结果回流 Squad，由 Delivery Lead 依据 Readiness Check `@Verify Agent` 或触发 PR Materialization；
- Verify Agent 输出 Finding 的专业归因；明确 assigned Task Set → Engineer 的映射使用确定性 Route，无法归因时由 Delivery Lead 做语义协调；
- PR Materialization 保留确定性实现，但由 Delivery Lead 在 Ready / Verification Gate 满足后调用；不重新启动 Engineer 只为创建 PR；
- PR Completed 后继续采用 PR Status Sync same-run deterministic finalize，避免无语义价值的 Lead Run；若 Finalize 返回 `UNKNOWN` / 冲突，再升级 Delivery Lead；
- Delivery Lead 不再被定义为纯 Exception Handler，而是 **Squad Router + Semantic Coordinator + Exception Handler**。

---

## v1.4.1 变更摘要

相对 v1.4.0，本版本进一步减少 Happy Path 的 Agent Run 与 Token 开销：

- PR Materialization 改为 **same-run deterministic tail**，不再固定由 Delivery Lead 新 Run 触发；
- `verify_agent.required=false` 时，最后一个使全部 required Task Sets 达到 `Development Ready` 的当前 Engineer Run 直接调用 `pull-request` capability；
- `verify_agent.required=true` 时，Verify Agent 在 Verification Gate PASS 后于当前 Run 尾部直接调用 `pull-request` capability；
- Isolated Runtime 的 Specialist Agent 达到 `Development Ready` 后不再固定 `@Delivery Squad` 唤醒 Delivery Lead；改为写回 Ready Facts 并执行确定性的 Development Readiness Check；
- 尚有 assigned Task Set 未 Ready 时当前 Engineer Run 直接结束；当前 Run 使全部 required Units Ready 时，按 `verify_agent.required` 直接 `@Verify Agent` 或执行 PR Materialization；
- Delivery Lead 从正常 PR 创建 Happy Path 中移出，仅在 `UNKNOWN`、事实冲突、跨角色异常或无法可靠路由时介入；
- `pull-request` 改为 Engineer / Verify Agent 当前 Run 都可调用的共享确定性 capability；Delivery Lead 不再把它作为正常职责 Skill；
- PR Materialization 仍保持幂等、多 Repository 一次处理、Candidate Commit 校验与 current_pr 回填；PR Preparation 仍由 Engineer 在 Development Run 内完成；
- PR Materialization 发现需要 rebase、冲突解决、代码修改或其他 Engineering Semantic Work 时，仍定向回到对应 Engineer；纯 API / 网络 / 幂等恢复问题不启动 Agent；
- 不改变 Verify Agent 的 behavior-oriented 独立验收定位，不改变 Workitem Analyst Recommendation + Human Analysis Review 的 Verify 决策机制。

---

## v1.4.0 变更摘要

相对 v1.3.9，本版本进一步收敛 PR 创建责任与 Run 成本：

- 将 PR 交付正式拆分为 **PR Preparation** 与 **PR Materialization**，两者是职责边界，不新增 Workflow Stage；
- Engineer 在原 Development Run 内完成 PR Preparation：Repository / Source Branch / Target Branch / Candidate Commit / PR Title / Description / Work Item 关联等，避免后续 PR 创建重新加载代码上下文；
- `Development Ready` 增加 `PR Preparation 完整` 条件；Engineer 仍负责代码实现、Local Validation、Code Review、Commit / Push 与 PR 语义准备；
- Verify PASS 或无需 Verify 后，不再 `@` 每个 Engineer 启动新 Session 创建 PR；Delivery Lead 触发确定性的 `pull-request` capability 执行 PR Materialization；
- PR Materialization 一次读取所有 required Repository Change 的已准备 Facts，逐仓校验 Branch / Candidate Commit、调用 TFS / PR API、校验返回身份并写回 `current_pr`；
- 多 Repository PR 创建采用幂等处理：已成功创建并登记的 PR 不重复创建，失败重试只补未完成项；
- 只有 Branch HEAD 与 candidate commit 不一致、需要 rebase / conflict resolution、出现新的代码问题或其他 Engineering Semantic Work 时，才重新交给对应 Engineer；API 临时失败、网络错误和 metadata 恢复不启动 Engineer；
- `pull-request` Skill 从 Engineer 的主要 Skill 中移出，由 Delivery Lead 作为确定性 Materialization capability 触发；具体创建动作由 script / API 完成，不让 LLM 重复执行确定性副作用；
- `verify_agent.required=true` 时，PR Materialization 只能使用 Verify PASS 对应的候选 Commit Set；代码变化会使旧 Verify PASS 失效，并重新走 Local Validation + Code Review + Verify；
- 所有 required PR 成功登记后，Issue 才进入 `in_review`；后续 PR Status Sync / Completion 机制保持不变。

---

## v1.3.9 变更摘要

相对 v1.3.8，本版本进一步收敛 Verify Agent 决策与验证范围：

- 暂不设计“同一 Repository 多个候选 Branch 需要组合验证”的复杂场景；当前 Delivery 方案只要求 Verify Agent 基于各 required Repository 已固定的候选 Branch / Commit 执行验收；
- `bug-fix / production-fix` 不再硬编码默认 `Verify Agent: NOT REQUIRED`，`sdd-fast` 也不硬编码默认 `REQUIRED`；是否需要 Verify Agent 统一由任务的 Acceptance Criteria、Verification Requirements、assigned Task Sets、跨系统行为和可验证性决定；
- Workitem Analyst 只输出 `Verify Agent Recommendation: REQUIRED | NOT REQUIRED`、Reason 与 Verification Focus，不直接拥有最终批准权；
- Human Analysis Review 对 Recommendation 与整个 Analysis Package 一并审核；Human `APPROVED` 即表示接受该 Recommendation，不增加第二个 Verify 审批动作；
- Development Materialization 将已批准 Recommendation 确定性转换为 `verify_agent.required=true|false` 执行事实；Delivery Lead 只按批准结果执行，不重复做风险判断；
- 简单 Corrective Change 通常会推荐 `NOT REQUIRED`，但这只是常见分析结果而非 Route 默认；复杂 `bug-fix / production-fix` 同样可以推荐 `REQUIRED`；
- Workitem Analyst 最终 Summary 统一显式打印 `Verify Agent Recommendation`，用于 Human Review 时快速确认。

---

## v1.3.8 变更摘要

相对 v1.3.7，本版本重新收敛 Verify Agent 与 Development Quality Model：

- 删除 `Verification Policy = engineer | independent` 概念；Engineer Local Validation / Code Review 不再被视为 Verification Policy 的一种；
- 正式明确 **Local Validation + Code Review 是 Development 必备环节，与 Verify Agent 是否参与无关**；
- Verify Agent 收窄为 Delivery-level、behavior-oriented 独立验收者，只从 Acceptance Criteria / Verification Requirements 验证最终行为；
- `bug-fix / production-fix` 默认 `Verify Agent: NOT REQUIRED`；复杂 `sdd-fast`、跨系统行为、复杂 AC、Runtime / Integration / E2E 场景按 Analysis 决定；
- 是否需要 Verify Agent 由 Workitem Analyst 在 Analysis Package 中提出，并在最终 Summary 中显式打印；Human Analysis Review 对该结论一并确认；Delivery Lead 正常情况下只执行，不重新判断；
- Integration / E2E Verification 合并为 Verify Agent 的验证方式，删除独立 Post-Merge Integration Verify 阶段；
- Verify Agent 从“每个 Engineer 完成后参与”上移到“所有 required Task Sets Ready 后按需参与”；
- Engineer 在 Development 阶段完成 Local Validation、Code Review、Commit / Push，形成固定候选 Branch / Commit Set，但暂不创建正式 PR；
- Verify Agent required 时，基于候选 Commit Set 做 Acceptance / Runtime / Integration / E2E Verification；PASS 后再由对应 Engineer 创建各 Repository PR；
- Verify FAIL 时只激活受影响 assigned Task Set，Engineer 修复后必须重新 Local Validation + Code Review + Commit / Push，再进入 Verify；
- PR 创建时点统一为：所有 required Task Sets Ready，且 Verify Agent 不需要或 Verify PASS；所有 required PR 注册完成后才进入 `in_review`；
- Merge 后只执行 Post-Merge Workspace Reconciliation 与 Delivery Completion，不再自动做 Integration Verify；后续 QA / 测试发现的问题形成新的 TFS Work Item / Delivery；
- Verification Facts 增加候选 Commit Set / verified commit set 对齐，避免 Verify PASS 后代码变化仍沿用旧 Evidence。

---

## v1.3.7 变更摘要

相对 v1.3.6，本版本收敛 Development Verification 模型：

- 将“所有研发默认 Engineer → Verify Agent”调整为 **Verification 必须、Verify Agent 按需**；
- 新增 `Verification Policy`，当前仅保留 `engineer | independent` 两种模式，不增加多级复杂度；
- `engineer` 仅用于低风险 Corrective Change：Root Cause confirmed、Expected Behavior / Contract 不变、存在可靠 Regression Signal、Verification Requirements 可在当前 assigned Task Set 内闭合；
- `independent` 用于 `sdd-fast`、Root Cause 未确认、Contract / Schema / Migration / Event Change、跨系统边界、无法建立可靠 Feedback、显式独立验证要求等场景；
- Repository 数量本身不决定 Verification Policy；跨仓只有在形成 Contract / Integration Boundary 时才成为 Independent Verification 信号；
- Engineer Execution 改为 `Implementation → Local Validation → Review → Verification Policy`，不再默认直接 `@Verify Agent`；
- Policy=`engineer` 时，Engineer Local Validation + Development-level Review + Evidence 可以满足 Required Verification；
- Policy=`independent` 时，必须由 Verify Agent 独立验证，Engineer 不得自行降级；Targeted Rework（定向返工） 后仍按原 Policy 重新验证；
- `required_verify_pass` 统一抽象为 `required_verification_pass`，PR Transition Gate 与 Delivery Completion Gate 不再要求每个 assigned Task Set 必须存在 Verify Agent PASS；
- Integration Verify 保持独立机制，继续在 Merge 后根据跨 Repository / Contract / Event / 多 assigned Task Set 等组合风险按需执行；
- Parent Issue Runtime 的定义进一步收敛为“单一 assigned Task Set”，不再把单 Repository / 单 PR 当作必要特征；
- Canonical Terminology（统一术语） 引用更新为当时的设计规范；
- Squad、Sub-Issue、PR Status Sync、Abandoned Human Decision、Post-Merge Reconciliation 等 v1.3.6 核心机制保持不变。

---

## v1.3.6 变更摘要

相对 v1.3.5，本版本根据 TFS MCP 实际 PR 快照验证结果收敛 PR 状态模型：

- 取消机器层面的 `Rejected` Significant Event；正式以 provider `status=active|completed|abandoned` 作为 PR 状态事实，其他值或异常结构进入 `UNKNOWN`；
- `active` 统一 NO-OP；`completed` 为 Success Event；`abandoned` 为 Exceptional Stop Event，并进入 `blocked + Human Decision`；
- `Rejected / Discarded` 不再由 `pr-status-sync` 推断，只允许作为 Human 对 `abandoned` 原因的分类；Human 同时明确 `ANALYSIS / ENGINEERING / RECREATE_PR / CANCEL_DELIVERY` 等下一步；
- 删除 Reviewer Vote 相关设计；普通审核过程继续由 TFS 管理，不进入 Multica Delivery 状态模型；
- Completion 只认 `provider_status=completed`；`mergeStatus / mergeCommitId / mergeCommitMessage` 仅作为 provider 辅助信息，不得触发完成；
- `completedDate` 统一归一化为 `provider_closed_at`，必须结合 `provider_status` 解释，不再无条件映射为 `merged_at`；
- PR Metadata 从单一 `pr` 调整为 `current_pr + pr_history`：被 Abandoned / 替代的旧 PR 移入历史，新 PR 成为 current PR；Completion Gate 只检查 current required PR；
- 新增 PR 查询身份校验：PR ID、Repository、Project 与登记映射不一致时返回 `UNKNOWN`，不得依赖标题、描述或 TFS Work Item 反查 Delivery；
- 新增轻量 `current_pr.sync.pending_event / event_key` 恢复机制；Autopilot 除扫描 `in_review` 外，还需恢复 pending event，避免状态部分写入后永久失联；
- Abandoned 同步不写普通顶层 Comment；机器只负责 `blocked + Delivery Squad + facts`，真正唤醒 Delivery Lead 的 Trigger 改为后续 Human Decision Comment；
- PR Transition Gate 改为检查 `all(required_current_pr_completed)`，并明确 `UNKNOWN` 不允许关闭；
- 不改变 Squad、Delivery Lead、Analysis Review、Verify、Post-Merge Workspace Reconciliation 与最终 Completion 的总体架构。

---

## v1.3.5 变更摘要

相对 v1.3.4：

- 统一 PR 外部事件模型为 **PR Significant Event Model**，当前只识别 `Merged / Completed`、`Rejected`、`Abandoned / Closed` 三类会改变 Delivery 流向的事件；
- `Merged / Completed` 定义为 Success Event，`Rejected` 定义为 Rework Event，`Abandoned / Closed` 定义为 Exceptional Stop Event；
- 修正 §1、§3.6、§17、§18、§29、§30、§32、§33 等章节中“只处理两类事件”与 `Abandoned / Closed` 实际处理逻辑不一致的问题；
- `pr-status-sync` 增加 Significant Event 解析优先级：当前终态优先；多 PR 聚合按 `Abandoned / Closed` → 当前有效 `Rejected` → `all required PR Merged / Completed` → 否则 NO-OP；历史 Reviewer Reject 不覆盖已完成的 PR 终态；
- `Abandoned / Closed` 增加独立事实与幂等通知字段 `abandoned_at / abandonment_notified_at`，防止定时同步重复 Comment / 重复唤醒；
- `Abandoned / Closed` 继续进入 `blocked + Human Decision`，但不自动推断任务取消、重新创建 PR、回 Analysis 或回 Engineering；
- 不改变既有 PR Happy Path、Reject 回流机制、Delivery Lead 职责或 Completion Gate，仅做模型与表述一致性修订。

---

## v1.3.4 变更摘要

相对 v1.3.3：

- `pr-status-sync` 从仅检测 Merge 扩展为 PR Significant Event Detection；当前识别 `Merged / Completed`、`Rejected`、`Abandoned / Closed`，仍不复制完整 PR Review 状态机；
- 普通 `Active / Changes Requested / Approved / Reviewer Vote / Review Feedback` 继续忽略并 NO-OP；
- 任一 required PR 出现 `Rejected` 时，记录原负责人，将当前 Issue / Development Sub-Issue 置为 `blocked` 并交给 `Delivery Squad`，写入 Reject Facts 后停止自动推进；
- `pr-status-sync` 不判断 Reject 属于 Analysis 问题还是 Engineering 问题，该决策明确交给 Human；
- Human 通过顶层 Comment 使用 `REWORK: ANALYSIS` 或 `REWORK: ENGINEERING` 指定纠偏方向，复用 Squad Comment → Delivery Lead 唤醒机制；
- `REWORK: ENGINEERING` 只执行 Targeted Fix → Verify → PR；`REWORK: ANALYSIS` 回到 Workitem Analyst，并重新经过 Analysis Gate + Human Analysis Review；
- PR `Abandoned / Closed` 作为独立 Exceptional Stop Event 进入 `blocked + Human Decision`，不隐式推断为任务取消；未来如需取消语义，单独定义 Cancellation Policy；
- Reject / Abandon / Completion 同步均要求幂等通知，避免 Autopilot 重复 Comment / 重复唤醒。

---

## v1.3.3 变更摘要

相对 v1.3.2：

- PR 阶段进一步收敛：Multica 不再建模 `Changes Requested / Approved / Reviewer Vote / Review Feedback` 等 TFS PR 中间状态；
- 保留 `pr-status-sync` Skill 名称，但职责收敛为 PR Completion Detection；
- `status = in_review` 期间仅定时检查所有 required PR 是否已 `Merged / Completed`；未全部完成时 NO-OP；
- 所有 required PR 合并完成后，只写一次最终 Merge Facts，并向 Issue 写普通顶层 Comment；
- Issue 由 `Delivery Squad` 持有时，普通 PR Completion Comment 复用 Multica Squad 机制唤醒 `Delivery Lead`；
- Comment 只作为 Trigger；PR metadata 作为外部事实持久化；`PR Transition Gate` 负责确定性完成判断；
- PR Transition Gate 统一检查 `required_verify_pass + all(required_pr_merged) + no_unresolved_blocker`；
- 新增 Post-Merge Workspace Reconciliation：Merge 后切换 PR `target_branch`，执行 `fetch --prune + pull --ff-only`，本地 Source Branch 仅允许安全删除；
- `pr-status-sync` 不直接操作 Git 工作区，Merge 后本地对齐由 Delivery Lead 的收口流程负责；
- Isolated Runtime 的 Development Sub-Issue 仍在全部完成后显式 `@Delivery Squad`，不假设普通 Comment 能跨 Sub-Issue 隐式唤醒父级 Delivery Lead。

---

## v1.3.2 变更摘要

相对 v1.3.1：

- 引用当时设计规范的 Canonical Terminology，不再在本方案维护第二套全局术语；
- Squad 正式名称统一为 `Delivery Squad`，Leader Agent 正式名称统一为 `Delivery Lead`；
- 分析 Agent 正式名称统一为 `Workitem Analyst`，不再使用 `Analyst` 作为同一 Agent 的别名；
- 验证 Agent 正式名称统一为 `Verify Agent`；`Verify` 仅在表示验证动作时使用；
- `Development Issue` 统一改为 `Development Sub-Issue`；
- `Parent Completion Gate` 统一改为 `Delivery Completion Gate`；
- Analysis Review 的正式 Status Key 改为 `analysis_review`，Display Name 保持 `Analysis Review`，Category=`started`；
- 所有状态判断、流程文本和 Gate 条件统一使用 `analysis_review`；UI / 自然语言说明可显示 `Analysis Review`。
