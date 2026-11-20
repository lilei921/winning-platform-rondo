# Engineer Development Design（工程师研发设计方案）

> Version: **1.15.5**  
> Execution Roles（执行角色）: `Backend Engineer` / `Frontend Engineer` / `Flink Engineer`  
> Professional Outcome（专业目标）: Approved Engineering Contract Implementation（已批准工程契约的实现与验证）  
> Scope: Development 专业过程、Engineer Role Contract、Task Set 接收、Feedback-Driven Development、Implementation / Verification、Code Review、Commit / Push、PR Preparation、Development Evidence、Completion Handoff、Skill / Method 实施与验收  
> Date: 2026-11-06  
> Status（状态）: Design Baseline（实施导向设计基线；不代表对应 Skill / Script 已部署）  
> Upstream Baseline（上位方案）: [01-multica-openspec-design-guideline.md](01-multica-openspec-design-guideline.md)、[02-multica-delivery-lifecycle-design.md](02-multica-delivery-lifecycle-design.md)\
> Analysis Baseline（分析输入）: [03-workitem-analysis-design.md](03-workitem-analysis-design.md)\
> Related Implementation Baseline（实施契约）: [05-openspec-schema-implementation-design.md](05-openspec-schema-implementation-design.md)、[06-method-skill-library-implementation-design.md](06-method-skill-library-implementation-design.md)

**文档定位**：本文设计 Engineer / Development 的专业过程与实施契约，不是单个 `SKILL.md`，也不是 Multica Delivery Lifecycle（交付生命周期）或新建的 Workflow Runtime。专业活动不独立构成新的 Agent、Run、Multica Stage、Gate 或 Artifact。

**权威归属**：[01](01-multica-openspec-design-guideline.md) 维护统一架构、术语与配置约定；[02](02-multica-delivery-lifecycle-design.md) 维护跨角色交付、审批、任务投影、独立验证、PR / Finalize；[03](03-workitem-analysis-design.md) 维护需求 / Bug 分析及研发准备；[04](04-engineer-development-design.md) 维护已批准 Task Set 的工程方法、工程质量、Evidence 和专业交接；[05](05-openspec-schema-implementation-design.md) 维护 OpenSpec Schema、Change / Task Identity、写权限、Task Progress；[06](06-method-skill-library-implementation-design.md) 维护 Internal Method Module 的组织与来源治理。**同一规则只维护一个 Owner（One Rule, One Owner）**。

## 目录

- [1. 文档定位、专业职责与完成标准](#development-section-01)
- [2. Engineer Role 与 Agent Model](#development-section-02)
- [3. Development 输入与 Task Set 契约](#development-section-03)
- [4. Development Execution Model（研发执行模型）](#development-section-04)
- [5. Ground（建立事实基线）与 Establish Feedback（建立反馈）](#development-section-05)
- [6. Incremental Implementation（增量实现）与 Engineering Methods（工程方法）](#development-section-06)
- [7. Development Verification（开发侧验证）与 Local Validation（本地验证）](#development-section-07)
- [8. Code Review（代码审查）与 Targeted Rework（定向返工）](#development-section-08)
- [9. Commit / Push 与 PR Preparation（PR 准备）](#development-section-09)
- [10. Development Evidence（研发证据）](#development-section-10)
- [11. Development Completion（研发完成）与交付回流](#development-section-11)
- [12. Engineer 技术决策、Diagnostic Escalation（诊断升级）与停止边界](#development-section-12)
- [13. Agent / Project Skill / Internal Method 实施结构](#development-section-13)
- [14. Development 接入验收（Acceptance Tests）](#development-section-14)
- [附录 A. 最终 Development 执行模型（摘要）](#development-appendix-a)
- [附录 B. 当前决策与核心原则（摘要视图）](#附录-b-当前决策与核心原则摘要视图)
- [附录 C. 方法来源与版本说明（非现行执行规则）](#附录-c-方法来源与版本说明非现行执行规则)
- [附录 D. 变更摘要](#historical-changes)

---

<a id="engineering-stage-scope"></a>
<a id="development-section-01"></a>

# 1. 文档定位、专业职责与完成标准

本方案的核心问题是：**Engineer 如何在已批准的 OpenSpec Engineering Contract（工程契约）及明确 `task_refs` 范围内，正确实现代码、证明当前候选版本满足要求，并把可复核的 Development Ready Facts（研发就绪事实）交回 Multica？**

“Development 阶段”仅指 Delivery Lifecycle 中的专业工作区段，**不对应 Multica 原生 Stage**。本期采用单 Issue 协作：同一 Issue 中，同一 Repository 的全部 Task Sets 归一名当前有效 Engineer，多个 Repository 或 Engineer 不导致额外创建 Issue。专业成员由 Delivery Lead 在当前 Issue 上通过 `@mention + task_refs` 委派；具体规则见 [02 §7](02-multica-delivery-lifecycle-design.md#development-materialization)。

## 1.1 专业职责与边界

| 专业职责 | Engineer 必须完成的内容 | 不属于 Engineer 的职责 |
|---|---|---|
| 消费工程契约 | 读取当前批准范围、`change_ref`、`task_refs`、适用 Specs / Proposal / Design、验证要求与证据 | 重新决定 Technical Change Kind / Schema / Human Approval |
| 工程实现 | 选择局部技术设计、小步编码、建立有效反馈、处理代码问题 | 重新定义已批准的行为、范围或新增未经授权的工程任务 |
| 工程质量 | 每项 Implementation Task 的验证、分配给自己的 Verification Task、Local Validation、Code Review、Targeted Rework | 替代独立 Verify Agent 或自行改变 `verify_agent.required` |
| 工程交付 | Commit / Push、按 Repository 准备 PR 语义、发布有效 Development Evidence | PR Materialization / Status Sync、跨角色聚合、Archive、TFS / Delivery 完成关闭 |
| 异常上报 | 报告证据冲突、范围变化、环境阻塞、缺失输入并提出具体建议 | 自建第二套 Workflow State 或覆盖确定性 FAIL |

**角色边界**：Workitem Analyst 分析“是什么、为什么、应达到什么结果”；Human 批准需求、方案和验收边界；Delivery Lead 安排“谁执行哪些 Task Set”；Engineer 在已批准边界内决定“如何正确实现并证明完成”。Engineer 不依赖 Workitem Analyst 的会话内存，必须读取持久化的批准依据。

## 1.2 Development 完成标准

对**当前被明确分配的 Task Set**（不是整个 Issue），至少满足：

1. 当前仍需执行的全部 assigned Implementation Tasks 的实现和各自 Task-level Verification 有效完成；分配给 Engineer 的 required Change-level Verification Tasks 也有有效结果。
2. Required Local Validation 为 PASS；Implementation-oriented Code Review 为 PASS；无未处理 blocking finding。
3. **业务代码 Repository** 的必要 Commit / Push 完成，候选代码、验证结果和 Review Evidence 对应当前版本；纯验证且无代码修改时按 [§7.1](#section-7-1) 复用已有候选及有效事实。**根仓研发期间的 OpenSpec 修改不要求 Engineer 此时 Git Commit**，由最终 Finalize 统一提交，初始批准基线仍先提交。
4. 当前 Engineer 负责的每个 Repository Change 具有完整 PR Preparation；必要的 TFS / Delivery 关联可追溯。同一 Delivery 内同一 Repository 的全部 Task Sets 必须归同一个 Engineer。
5. Development Evidence 能从 `change_ref`、`task_refs` 追到工程契约、实现位置、执行的验证、Candidate Commit、风险与偏差；无未解决的当前 Task Set blocker。
6. Development Completion Check 判定通过；任务进度经受控写入并回读确认，发布前核对检查依据未发生相关变化，当前 Task Set Completion Facts 写回当前 Issue。

这里的完成标准只针对 [§3.4](#section-3-4) 定义的当前仍需执行的 assigned Tasks，**不要求**整个 OpenSpec Change 的所有 Task 同时完成，也**不要求** Engineer 执行由 Verify Agent 拥有的待验收 Verification Task。单个 Task Set READY 不等于整个 Issue 已完成，见 [§11.3](#section-11-3)。Engineer-side Completion 与后续 Issue Aggregation、Independent Verification、PR Materialization 分属不同职责。

## 1.3 Engineering Truth 与 Delivery Truth

沿用 [01 §1.2](01-multica-openspec-design-guideline.md#section-1-2) 的统一归属：

- **OpenSpec = Engineering Truth**：Intentional Requirement / Scenario、Corrective Expected / Actual / Root Cause / Fix / Regression Scope、Design、Implementation / Verification Tasks、Task Progress 与长期消费的 Engineering Evidence。
- **Multica = Delivery Truth**：批准、Assignment、Issue / Run、Status、Task Set Runtime Projection、Verify Agent Decision、Gate / Completion Facts、PR 生命周期中的交付事实。
- **Reference, not Replication**：`change_ref + task_refs + relevant artifact / evidence refs + Multica Runtime Context` 是交接引用集合，非第三套 Development Contract Store。`Task Set`、`Development Evidence` 的逻辑汇总不自动产生同名持久化对象。

专业方法、Runtime 状态、Artifact 与 Summary 必须分开。具体术语见 [01 §1.4 统一术语](01-multica-openspec-design-guideline.md#canonical-terminology)、[§1.5.2 文档权威归属](01-multica-openspec-design-guideline.md#document-ownership) 与 [§1.6 方法和事实边界](01-multica-openspec-design-guideline.md#method-artifact-boundary)。

---

<a id="development-section-02"></a>

# 2. Engineer Role 与 Agent Model

## 2.1 专业 Agent 与公共开发模型

正式 Agent 保持；各 Agent 的 Professional Goal 属于自身 Instructions，公共 / 领域 Skill 只提供实现目标的局部能力，不定义 Engineer 身份：

```text
Backend Engineer    → backend-engineering
Frontend Engineer   → frontend-engineering
Flink Engineer      → flink-engineering
          └─ 都通过 development-execution 完成当前 Task Set
```

`development-execution` 是当前完整 Development 场景 Skill；各领域 Skill 提供技术领域能力，不复制完整 Development Workflow。Agent 按任务复杂度选择专业路径；授权与交付 Check / Patch / Readback 等硬顺序不可省略。公共方法的复用与内部模块由 [§13](#development-section-13) 和 [06](06-method-skill-library-implementation-design.md) 维护。

## 2.2 Agent Description（展示说明）

| Agent | Description |
|---|---|
| `Backend Engineer` | 负责已分配后端 OpenSpec Tasks 的代码实现、开发侧验证、Code Review、整改及 Development Evidence 交付。 |
| `Frontend Engineer` | 负责已分配前端 OpenSpec Tasks 的代码实现、开发侧验证及按需浏览器行为验证、Code Review、整改及 Development Evidence 交付。 |
| `Flink Engineer` | 负责已分配 Flink / 流处理 OpenSpec Tasks 的代码实现、相关行为验证、Code Review、整改及 Development Evidence 交付。 |

Description 用于 UI / Discoverability（可发现性），不承担完整执行 Procedure。

<a id="section-2-3"></a>

## 2.3 Agent Instructions 的长期 Role Contract

三名 Engineer 的 Instructions 均应清晰表达长期 Professional Goal、职责、工作方式、边界与交付要求，**六段式仅为可复用的推荐模板**，不要求每份文件保留完全相同的章节。方法和交付副作用仍由各自权威资产维护。本节定义公共 Role Contract 的内容维度；配置参考见 [§13.2](#section-13-2)，详细可复用 Procedure 在 Skill 中维护：

| Section | 必要内容 |
|---|---|
| `Role` | 当前 Delivery Squad 中的专业 Engineer；执行明确分配的 OpenSpec Task Set，不负责交付整体调度。 |
| `Goal` | 在已批准的边界内实现正确、可维护、可验证的代码，并对本次 assigned Task Set 的工程结果负责。 |
| `Core Responsibilities` | 读取已批准工程契约、Implementation、开发侧验证、Code Review / Finding Fix、Commit / Push、PR Preparation、Development Evidence、Completion Handoff。 |
| `Boundaries` | 不改 Requirement / Fix Contract、不改 approved scope / `task_refs` 或 Issue Assignee，不自行决定 Verify、PR Materialization 或 Delivery Completion。 |
| `Execution Principles` | 当前事实优先；Feedback-first、small increments、evidence-first；正确写入受控进度；不重复分析、不猜测批准信息。 |
| `Escalation, Communication & Delivery` | 报告阻塞 / 冲突、当前依据、影响范围、Evidence、下一责任人及所需决定；写回当前 Issue 后结束 Run。 |

Agent Instructions 保持稳定和简短；不得在三个 Agent 中重复维护完整 Development Procedure。`development-execution/SKILL.md` 维护执行契约，Domain Skills 维护领域方法，Internal Methods 维护单项方法。[01](01-multica-openspec-design-guideline.md) 的 Agent / Skill 配置规范为权威来源。

---

<a id="engineering-work-object"></a>
<a id="engineering-input"></a>
<a id="development-section-03"></a>

# 3. Development 输入与 Task Set 契约

## 3.1 工作对象与接收方式

Engineer 的工作对象是明确分配的 **OpenSpec Task Set**：`task_refs` 是一组当前 Change 的 Task 引用，不是独立实体、状态机或新工单。

当前仅使用一种专业工作入口：

| 工作入口 | Engineer 完成边界 |
|---|---|
| 当前 Issue 的 `@mention + task_refs` | 完成本轮 Task Set、写回 Evidence / Completion Facts，不关闭整个 Issue |

同一 Task Set 只有一个正常触发入口，不重复 Mention / Rerun。同一 Issue 内同一 Repository 的多个 Task Sets 可以分组执行，但应由同一名 Engineer 承接；若发现责任重叠、关键依赖或权限冲突，停止受影响工作并交 Delivery Lead 协调，不自行改变 Issue 的 Assignee。

## 3.2 必备输入

| 输入 | 消费要求 |
|---|---|
| Identity | 当前 Issue、OpenSpec `change_ref`、`.openspec.yaml` Schema、`task_refs` |
| Authorization | 明确的 Human Analysis Approval、Delivery Lead 派发依据及尚未完成的附加条件 |
| Approved Engineering Baseline | 已批准的根仓 Git 基线、适用后续受控修订、当前 Change 共享工作区中尚未最终 Git 提交的受控进度（若有）及 Proposal / Specs / Design / Tasks 引用；三者须可区分 |
| Functional / Corrective Contract | Intentional Requirement + Scenario；或 Corrective Expected / Actual / Root Cause / Fix / Regression Scope；相关主规格约束 |
| Verification | 每项 Implementation Task 的验证方式；若当前 Engineer 被分配 Change-level Verification Task，则包含对应任务和执行边界 |
| Scope / Dependencies | 业务目标、Repository Scope、代码允许修改范围、跨仓接口 Contract、当前依赖与 Blocker |
| Context / Evidence | 必需上下文、复现 / 实验事实、环境与测试方法、当前候选实现和已有 Finding（返工时） |
| Native Preparation / Validation | 当前 Change 按适用 Schema 已满足必要 Artifact Preparation 与原生 Validation 条件，且有可核对的有效结果；合法省略的条件性 Artifact 不构成缺失 |
| Repository Owner / Dispatch | 当前 Issue 中同仓 `task_refs` 归同一个 Engineer；工作通过当前 Issue 的 `@mention` 触发，不并行重复派发同一 Task Set |

Engineer 必须读取**当前可访问的持久化依据**。不因独立 Run、CLI Session 或目录变化而假定输入自动继承；不为降低 Token 省略会影响正确性的必要读取，也不重新执行整个 TFS Requirement Analysis。**只核对已有 Native Preparation / Validation 结果，不默认重新生成整个 Change 的 Artifact 或重复执行 Analysis；必需结果缺失、失效或与当前 Change 不符时停止正常实现并报告。**

## 3.3 Corrective / Intentional 的输入差异

**Corrective**：读取 `corrective-change` 的 Proposal（Expected / Actual、Failure Path、Root Cause Status / Evidence、Fix Strategy、Fix / Regression Scope）、`tasks.md`、合法存在的 Specs / Supporting Design。若 `skip_specs: true` 合法，不制造 Spec / Scenario Coverage；若省略独立 Design 且符合 Schema，也不当作失败。

**Intentional**：读取 `intentional-change` 的 Proposal、实际存在的 Delta Specs、受影响的 Existing Specs（包括未修改但继续适用的约束）、存在时的 Design、`tasks.md` 与 Verification Contract。合法 `skip_specs: true` 时不制造 Delta / Scenario Coverage，依据 Proposal、适用现行 Specs 与 Tasks 完成实现和验证；Design 合法省略时也不补造空白文件。

首次 Preparation 已确定的 Change ID / Schema 不在 Engineer Run 重新选择。超出授权、证据或自动交付能力边界的复杂变更不得自动进入 Development。

<a id="section-3-4"></a>

## 3.4 Approved Task Contract 的读写权限

[05 §10](05-openspec-schema-implementation-design.md#openspec-schema-section-10)–[§12](05-openspec-schema-implementation-design.md#openspec-schema-section-12) 是正式实施级约束；Human Approval 后，已派发任务的原生可读编号（如 `1.1`）和相关正文必须保持稳定，直到受控重新派工或修订。Engineer 默认只读 `tasks.md` 正文和 Verification Contract，允许的进度修改仅是**经 [05](05-openspec-schema-implementation-design.md) 定义的 deterministic patch** 更新 assigned `task_refs` 的 checkbox；不得自行新增、删除、重编号已派发任务，也不得私自更改 task body / 验证边界。编号不是 OpenSpec 原生持久 Task ID，不新增 `T-xxx`。

| 内容 | Engineer 权限 |
|---|---|
| 代码、测试与局部实现方案 | 在已批准范围内直接修改 |
| `design.md`（若存在） | 仅在批准边界内细化 implementation detail，不改变已批准技术决策 |
| `tasks.md` 正文 / Verification Contract | Approval 后默认只读；修改需受控 Analysis / Coordination 路径 |
| Assigned `tasks.md` checkbox | Completion Check 取得有效证据后，通过 [05](05-openspec-schema-implementation-design.md) 的串行确定性机制更新 |
| 新 Top-level Task、变更批准范围、Spec / Corrective Proposal 关键事实 | STOP，提交 Goal / Reason / Scope Impact，由 Delivery Lead 协调 Workitem Analyst，必要时重新 Human Review |

`tasks.md` checkbox 不等于 Multica Runtime Status，也不代替真实任务完成证据。[05](05-openspec-schema-implementation-design.md) P0-2 已采用原生编号与最小定位约束；本文不新增固定 `Verify:`、`T-xxx` 或竞争性 Parser。

**已批准取消 / 替换的任务**：保留原任务编号与可追溯的批准依据，由 Delivery Lead 协调受控修订并调整派工范围；Engineer 不自行取消任务或删除记录。历史记录不再保留可计入进度的待完成 checkbox，也不得虚假勾选 `[x]`。完成、验证及 Patch 仅针对当前仍需执行的 assigned Tasks；替代任务按批准后的新范围执行。

## 3.5 Rework 输入与停止保护

收到明确 Code Review Finding、Independent Verify Finding 或 Human Engineering Feedback 时，先定位原 Finding ID / Evidence、Candidate Commit、当前 `task_refs`、受影响 Evidence 与批准边界；只修复可归属当前 Task Set 的问题。新证据可以用于修正 Engineer 的技术诊断和实现选择，但不得擅自改写已批准 Proposal；若新事实使 Approved Fix Strategy / Regression Scope 或其他批准契约实质失效，则停止受影响的实施，由 Delivery Lead 协调既有 Analysis / Human Review。仅诊断假设变化、而目标行为/批准任务/验证范围仍有效时，不机械触发整轮重审。

---

<a id="development-section-04"></a>

# 4. Development Execution Model（研发执行模型）

`development-execution` 在一次明确的 Engineer Run 中组织专业工作；下图是**常见的工程实践路径**，不是十道强制按序的专业步骤，也不是新的 Multica Stage / Agent Run。Engineer 可按实际任务选择诊断、反馈与实现方法；授权前置、Required Validation、有效 Evidence 以及 Check → Patch / Readback → READY 的交付顺序不可省略或颠倒。

```text
Assigned Task Set + Approved Engineering Baseline
        ↓
1. Ground（建立事实与授权基线）
        ↓
2. Establish Feedback（建立可观测反馈）
        ↓
3. Incremental Implementation（小步实现；按需 Internal Methods）
        ↓
4. Development Verification / Required Local Validation
        ↓
5. Implementation-oriented Code Review
        ↓
6. Targeted Fix + Re-validate / Re-review（存在 Finding 时）
        ↓
7. Commit / Push（固定 Candidate Commit）
        ↓
8. PR Preparation（按 Repository Change）
        ↓
9. Publish Development Evidence
        ↓
10. Development Completion Check → Task Progress Patch / Readback → Completion Handoff（根仓 Git 在最终 Finalize 提交）
```

**统一方法**：Spec / Corrective Contract 定义要实现什么、怎样证明行为正确；Feedback-Driven Development 定义如何通过小步修改与持续检查收敛。所有获准自动交付的 Change 共享该执行模型，不引入第二套 Runtime 或独立的 Task State Machine。

## 4.1 Corrective Mode（纠正性修复）

用于 Corrective Change，以**恢复既定 Expected Behavior** 为目标，优先消费已批准 Root Cause、Fix Strategy 和 Regression Scope：

```text
Approved Corrective Proposal + Tasks
→ 可行时建立 Failure / Regression Signal
→ Minimal Necessary Fix
→ Regression / Normal / Boundary Verification
→ Code Review → Evidence / Completion
```

不默认重启整个 `bug-analysis`；仅当当前 Root Cause / Fix Strategy 被新证据否定，或无法形成可靠 Feedback / 影响范围失控时进入 [§12](#development-section-12) 的 Diagnostic Escalation。

[03 §7.3 Root Cause 可信度](03-workitem-analysis-design.md#analysis-root-cause-confidence) 已区分 `confirmed` / `probable` / `unknown` Root Cause：

- `confirmed`：依据已确认的根因和方案实施；仍需验证候选版本。
- `probable`：若 Analysis Gate、必要 Human Review / 条件已满足，且 Fix Strategy 与验证边界可实施，则可按**有界的已批准假设**执行；持续记录剩余不确定性与实际证据，不擅自宣称根因 confirmed。
- `unknown`：不应形成正常可执行的已批准修复基线；收到此类冲突交接时停止并请 Delivery Lead 核对，而不是由 Engineer 猜测修复。

`probable` 不能被机械当作 BLOCKED，也不能被 Engineer 自行当作完全确证；新的反证可能需要返回 Analysis。

## 4.2 Intentional Mode（意图性需求变更）

用于 Intentional Change，依据已批准 Requirement / Scenario、Task Verification、存在时的 Design 逐个完成行为切片。**已确定：使用项目 `development-execution`，不调用 OpenSpec 原生 `/opsx:apply` 执行研发。**在仅派发部分任务时显式限制 `task_refs`；单 Engineer 全量执行可以引用整个已批准范围。原生 `instructions apply` 允许只读获取上下文，Apply readiness 不等于 Multica Human Approval 或 Development Completion。

```text
Approved Requirements / Scenarios + Tasks
→ Select assigned behavior / test seam
→ Feedback → Small Implementation → Feedback
→ Verify assigned tasks → Code Review
→ Evidence / Completion
```

可自动化的行为优先采用 TDD；Design 缺省不强制生成。工程实现不得改变规范性行为合同或跳过外部 Compatibility / Security Constraint。

## 4.3 Rework Mode（定向返工）

触发于当前 Engineer 可归因的 Code Review / Verify Finding 或明确的人类 Engineering Feedback：

```text
Finding + Affected Task Refs / Candidate
→ Identify Impact
→ Targeted Change
→ Affected Verification / Local Validation
→ Code Review
→ Update Commit / Evidence
→ Re-check Completion
```

不默认重跑完整 Analysis、全 Change Apply、整个 Development，或创建新 OpenSpec Change。若修复必须越过批准 Scope，则按 [§12](#development-section-12) 停止升级；旧 PASS 与旧 checkbox 不代替新候选代码所需的新证据。

---

<a id="development-section-05"></a>

# 5. Ground（建立事实基线）与 Establish Feedback（建立反馈）

## 5.1 Ground 的最小判定

开始主要实现前，Engineer 应确认：当前 Task Set 获得有效批准与派工；Change / Schema / `task_refs` 能追溯到已批准根仓 Git 基线和适用的受控修订，且能区分尚未 Git 提交的共享工作区 Task Progress；必要 Dependencies 满足；目标 Branch / Repository 可操作；当前 Acceptance 与 Verification Contract 可读取；既有 Evidence 对当前版本仍有效。缺失必要批准、身份或材料时停止，不靠猜测补齐。

Corrective 额外核对 Expected / Actual、Root Cause Status / Evidence、Fix Strategy 与 Regression Scope；Intentional 额外核对 Requirement / Scenario、当前主规格与现有接口行为。调查应按需加载相关代码与测试，而不是每次扫描整个 Monorepo。

## 5.2 为什么采用 Feedback-Driven Development

不同类型工程资产的有效反馈不同。开发统一原则并非“所有代码都必须使用同一个测试框架”，而是：

> **主要代码修改之前必须识别能证明本次行为或修复正在收敛的可靠、可观察 Signal，并在修改过程中持续使用。**

Signal 可以是 Unit / Regression / Integration / Contract Test、Compiler / Type Check、Lint / Build、API Invocation、Browser Interaction、Runtime Reproduction、Schema Validation、Flink Test Harness 或其他项目允许的可重复检查。编译成功不能替代用户可见行为或 Task Verification；无法自动测试时也不得伪造 RED / GREEN。

## 5.3 Backend Feedback

- Unit / Service / Domain Test：业务规则、异常路径、计算与业务状态转换。
- Integration / Contract / API Reproduction：接口行为、权限、序列化与跨模块协作。
- Build / Static Analysis：项目构建、类型和静态约束。
- Database / Migration Validation：Schema、事务、兼容与数据迁移安全。

选择与当前 `task_refs` 对应的最小可靠 Signal；涉及跨仓 Contract 时保留约束引用及必要后续组合 Verification Task。

## 5.4 Frontend Feedback

- Type Check / Unit / Component Test：业务逻辑、组件状态、交互约束。
- Browser Behavior / E2E：路由、表单、错误提示、权限与用户可观察路径。
- Build / Lint：构建与静态质量。

界面或 CSS 场景可以使用浏览器观察、可复现操作和必要截图 / Trace，但不能仅以构建 PASS 替代已要求的交互验收。

## 5.5 Flink Feedback

- Unit / Flink Test Harness：处理逻辑、算子、State / Timer、Watermark。
- Sample Events / Schema Compatibility：边界事件、脏数据、上下游兼容。
- Checkpoint / Recovery / Integration：需要时验证状态恢复、重启和端到端行为。
- Build / Required Runtime Check：流处理依赖、打包与部署相关前置。

验证策略必须匹配流式语义；仅检查源代码编译不能证明窗口、乱序、水位线、状态恢复等行为正确。

## 5.6 Corrective Regression Signal

优先恢复或建立原 Failure Signal：

```text
Corrective Expected / Actual + Failure Path
→ Reproduce / Observe（可行时）
→ Identify discriminating Regression Signal
→ Minimal Fix
→ 若可稳定复现：保留修复前 FAIL 与修复后 PASS 的对应证据
→ 若无法稳定复现：采用可靠替代证据验证批准的 Fix / Regression Scope
→ Check relevant normal / abnormal / boundary cases
```

**可稳定复现时**，应保留同一目标行为在修复前 **FAIL**、修复后 **PASS** 的可核对回归证据；不得仅用“运行结果不同”或单次 Build PASS 代替。**无法稳定复现时**，不自动触发 STOP 或重新分析；如果可靠日志、Trace、失败测试、生产运行记录等替代 Evidence 能支撑已批准 Fix Strategy、Regression Scope 与必要 Verification，可以继续并明确记录证据局限。若既无法复现、又缺少可信替代 Evidence，则进入 [§12.2](#section-12-2) Diagnostic Escalation，不能靠猜测实施或宣称 Regression PASS；不得为形式上的 FAIL → PASS 人为重新引入缺陷。

---
<a id="development-section-06"></a>

# 6. Incremental Implementation（增量实现）与 Engineering Methods（工程方法）

## 6.1 实现原则与 Engineer 自主权

优先采用 Incremental Vertical Implementation（增量垂直切片）方法，在任务适用时按以下节奏建立反馈；不以未采用该固定节奏本身作为 Completion FAIL：

```text
Small Behavior / Small Change
→ Focused Feedback
→ Next Small Change
→ Focused Feedback
```

避免无反馈地一次修改大量文件、最后才执行完整构建。Engineer 在批准边界内自主选择类 / 函数拆分、局部算法、模块内部结构、测试组织、诊断假设、非 Contract 级重构与必要依赖调整；可以基于新证据修正内部技术理解，但不擅自改写已批准 Root Cause / Fix Strategy，也不改变 Requirement / Scenario、External Contract、Repository Scope 或 Current Task Set。新证据实质推翻批准方案或验证边界时按 §12 升级。

实现要遵循当前 Repository 的架构、命名、错误处理、兼容、测试与安全约束，优先复用已有机制，避免无关重构；禁止把个人推断的“更好方案”代入已批准行为。

## 6.2 TDD（Test-Driven Development，测试驱动开发）

TDD 是 `development-execution` 内部的正式 Method，不是 Agent 另起的 Workflow，也不对全部工程资产全局强制。适合：Business Rule、Domain Logic、Service / API Contract、Pure Function、Bug Regression 等可稳定自动测试的行为。

```text
Select Observable Behavior / Test Seam
→ RED（测试证明目标行为尚未满足）
→ Minimal GREEN（最小实现通过）
→ Safe Refactor（保持 GREEN）
→ Next Behavior
```

关键要求：优先测试外部可观察行为；RED 必须有针对性，不以任意测试失败冒充；GREEN 要与生产实现关联，Refactor 不改变已批准 Contract。复杂 Layout / CSS、环境配置、Migration / SQL、Generated Code、外部系统或人工交互为主的场景，如果无法构造有价值的 Test Seam，则返回父 Skill 选择其他 Feedback，**不为形式测试内部实现细节**。

## 6.3 `codebase-design` 与局部设计

当模块边界、Adapter / Interface Seam、数据流或测试可达性影响正确实现时，`development-execution` 可读取 `methods/codebase-design.md` 作为设计词汇 / 方法参考；它不启动独立架构评审 Runtime、不变更批准 Scope。局部设计允许自洽调整；跨 Repository Contract、数据库重大迁移、安全模型或已批准外部接口需要改变时必须停止协调。

<a id="section-6-4"></a>

## 6.4 Diagnostic Method 的条件性使用

Development 正常入口不要求执行完整 Analysis，也不因疑似 Bug 固定调用 `bug-analysis`。当 [§12.2](#section-12-2) 的诊断条件成立时，由 `development-execution` 这一父 Project Skill 显式决定是否采用 `diagnosing-bugs`；Method 仅提供诊断步骤，不拥有新的 Agent Run、Issue 或交付状态。

**Development 侧最小调用契约：**

| 项目 | 约束 |
|---|---|
| Caller / Entry | 当前 `development-execution` 在既有 Engineer Run 中调用，不由 Internal Method 自主触发 |
| Method Source | 当前可直接读取本 Skill 内的 `methods/bounded-diagnosis.md`；若未来抽取独立 `bug-analysis`，只有确认通用输入输出、实际绑定与跨 Skill 可访问性后才能复用，不假定 Multica 自动发现或跨 Skill 调度 |
| Inputs | 当前症状与 Expected / Actual、相关 `task_refs`、Approved Fix Strategy、Candidate / Code Context、现有 Evidence 与允许的诊断范围 |
| Outputs | Reproduction / Feedback Signal、Hypotheses、Finding、Evidence Refs、受影响 `task_refs` / Scope、残余不确定性以及是否冲突于已批准 Analysis |
| Effects / Boundaries | 可按当前 Engineer 权限进行有界检查；不得修改 Multica Status、创建 Issue / Agent、擅改 Corrective Proposal 或批准的 Scope |
| Failure / Stop | Method 无法实际读取或必要权限不足时，停止该诊断路径并报告缺失；证据不足时返回 UNKNOWN / blocker；若新事实推翻批准的 Contract，则停止自主修复并升级 |

实施时固定一个可实际读取的 Method Source，并在父 Skill 中显式声明其加载位置；不得为解决不可达而重新注册独立的 `diagnosing-bugs` Runtime Skill。诊断结果先返回 `development-execution`，由父 Skill 决定批准边界内继续实现还是报告 Delivery Lead / Human。此节定义调用接口，不声称跨 Project Skill 读取机制已部署。

## 6.5 `verification-before-completion`（完成前验证纪律）

在声明 Local Validation PASS、Task Complete 或 Development Ready 之前，必须核对 Claim 与当前 Candidate / Contract 的 Evidence：实际执行 / 有效读取哪些检查、结果是什么、哪些 Claim 仍缺证据。它是父 Skill 内部 Method，**不是** Independent Verify Agent，也不能自行决定 `verify_agent.required`。

Methods 的 `Use When / Input / Output / Allowed Effects / Forbidden Effects / Stop` 以及 Project-native / Vendored（内置副本）治理，以 [06](06-method-skill-library-implementation-design.md) 为权威；本节维护的是 Engineer 何时选择方法、哪些质量目标不允许被省略。

---

<a id="development-section-07"></a>

# 7. Development Verification（开发侧验证）与 Local Validation（本地验证）

<a id="section-7-1"></a>

## 7.1 验证责任不是独立执行角色

```text
Engineer-owned Development Verification
= every Implementation Task's Task-level Verification
+ assigned Change-level Verification Tasks（如有）
+ Required Local Validation
```

- 每个 Implementation Task 自带如何验证其完成的要求，该 Task 的当前 Engineer 必须提供相应 Evidence。
- Change-level Verification Task 只在跨 Task / Module / Repository / System / User Journey 的组合行为不能在单 Task 内证明时建立。只有**明确分配**给当前 Engineer 的相关 Task，才是该 Engineer Completion 的前置。
- 若 `verify_agent.required=true` 且相关 Change-level Verification Task 被明确投影给 Verify Agent，则它可以在 Engineer-side Ready 时仍为 pending；由父 Delivery 在独立验收阶段执行并完成。
- CI / script / test runner 是 Execution Mechanism（执行机制），不是新 Agent / Task Owner。

Verification Task 的工程合同属于 OpenSpec `tasks.md`，Runtime Executor 的分配属于 Multica；不因 `verify_agent.required=false` 删除任何 required Task-level / Change-level Verification。

**纯验证 Task Set**：现有 Change-level Verification Task 可以只执行验证而不修改代码，不为此新建任务类型、Sub-Issue 或流程。本轮没有产生代码修改时，引用被验证的现有 Candidate Commit 及仍有效的 Code Review / PR Preparation 事实，不要求新增 Commit / Push、重复代码审查或重复 PR Preparation；仍须执行本轮要求的验证并保存 Evidence，不能用旧验证结果冒充本轮执行。本文后续统一完成条件按此适用规则执行；若验证中需要修改代码，则回到对应的实现、验证、Review 和提交流程，超出批准范围时停止升级。

## 7.2 Required Local Validation

每个 assigned Task Set **必须**根据当前工程内容执行适用的：Targeted Test、Relevant Regression、Build / Compile / Type Check、Lint / Static Check、Required Runtime / Contract Check；选择与现有项目工具对应的实际命令和环境，不机械要求所有类型代码都执行同一命令。

完成后记录检查名称、实际方式、结果、关键 Evidence、Candidate Commit、适用范围与必要的失败说明。存在无法执行的 required check 时，不得把其隐式视为 PASS；依据已批准 Contract 判定 BLOCKED / UNKNOWN 并升级。允许先做较窄 Focused Test，再根据变更风险执行必要扩大范围的 Check；不能仅有 Building Evidence 而遗漏 Behavior Evidence。

<a id="section-7-3"></a>

## 7.3 OpenSpec Native Validation / Verify 与 Verify Agent 的区别

| 能力 | 定位 | 不等于 |
|---|---|---|
| OpenSpec Validation | Artifact / Schema / Change 原生结构与语义约束的校验 | Human Approval、实际运行行为验证 |
| OpenSpec Native Verify | Change-level Artifact-to-Implementation Consistency（工件与实现一致性）检查 | 每个 Engineer Task Set 默认必跑、独立 Verify Agent、真实 E2E 运行证明 |
| Task / Change-level Verification | `tasks.md` 及适用 Spec / Proposal 描述的工程验证行为，可采用 Regression / Integration / E2E 等方法；不要求固定 `Verify:` 字段 | 固定由 Verify Agent 执行 |
| Independent Verification | `verify_agent.required=true` 时，Verify Agent 对固定候选版本执行独立行为验收 | Engineer Self Review、Local Validation |

**当前执行边界**：正式 Development 入口为项目 `development-execution`，不调用 `/opsx:apply`；可只读使用 OpenSpec status / instructions / validation / native Apply readiness。`/opsx:verify` 是独立的 Change-level Artifact-to-Implementation 一致性审查，不代替实际测试、Local Validation、Code Review 或 Verify Agent。按 [05 §9.4](05-openspec-schema-implementation-design.md#section-9-4)：`verify_agent.required=true` 时由 Verify Agent 运行或复用当前候选的有效 Native Verify；不要求独立 Verify 时默认不强制，只有项目契约要求或确需 Change-level consistency audit 才按需调用；不按每 Task Set 重复执行。

无论是否使用 Native Verify，明确要求的工程行为验证必须有可观察 Evidence，不能用 Native Verify / Schema Validation 的 PASS 替代真实行为验收。父级 Independent Verification 准入、结果和 Gate 仍以 [02 §9](02-multica-delivery-lifecycle-design.md#verification-rework) 为准。

## 7.4 Verification Evidence 的最低要求

每项 Required Verification 应可回答：

1. 依据哪个 `task_ref`、Requirement / Scenario 或 Corrective Expected / Regression Scope？
2. 对哪个 Repository Candidate / Contract / Environment 执行？
3. 实际采用什么命令、测试、浏览器操作、运行记录或其他可复核方法？
4. 结果 PASS / FAIL / UNKNOWN 的证据位置和失败限制是什么？
5. 如果复用既有 Evidence，为什么它对当前 Candidate 与 Contract 仍有效？

这里定义**内容要求**，不新增 `VR-xxx`、`verification-requirements.md` 或独立 Coverage Store。已有 Contract 引用依据 [05 §8](05-openspec-schema-implementation-design.md#openspec-schema-section-08) / [§10](05-openspec-schema-implementation-design.md#openspec-schema-section-10) 的原生路径、Heading 与必要任务编号定位。

---

<a id="engineering-code-review"></a>
<a id="development-section-08"></a>

# 8. Code Review（代码审查）与 Targeted Rework（定向返工）

## 8.1 必备定位与双轴审查

Code Review 是 Engineer Development 的 **implementation-oriented mandatory quality mechanism（面向实现的必备质量机制）**。所有变更的代码实现都须审查，不因为 Verify Agent 将来可能参与就跳过；纯验证且无代码修改的 Task Set 按 [§7.1](#section-7-1) 引用仍有效的审查事实，不重复进行代码审查。

保留两条独立 Review Axis：

| Review Axis | 核心问题 |
|---|---|
| Specification / Fix Alignment（规格 / 修复一致性） | 实现和当前批准 Task / Requirement / Corrective Proposal 是否一致、是否有可追溯验证、是否越界？ |
| Engineering Standards（工程标准） | 代码是否符合 Repository Conventions、复杂度、重复、错误处理、可维护性、安全、测试质量和回归风险要求？ |

双轴判断可分别产出 Findings，避免代码风格 PASS 就忽略 Contract 偏差，或规格一致就忽略工程质量问题。[06](06-method-skill-library-implementation-design.md) 的 `methods/code-review.md` 负责具体 Method Procedure；本节定义不可省略的 Review Contract。

## 8.2 Specification / Fix Alignment 的检查

**公共检查**：当前 Diff 与 `task_refs` / Approved Scope 对应；每项 Implementation Task 具备有效验证；已分配 Change-level Verification Task 有 Evidence；没有未解释的 Scope Drift / Stale Evidence；已持久化的任务进度不得与事实冲突（不能以 checkbox 替代验收）。**当前 Task 尚未勾选属于 Code Review 阶段的正常情况，不得因此判定 Review FAIL；已勾选却缺少有效 Evidence 才是应当阻断的异常。**

**Corrective**：修复是否针对已批准 Root Cause / Fix Strategy，Expected Behavior 是否恢复，Regression Scope 是否覆盖；合法 `skip_specs` 不伪造 Spec Coverage，有 Delta 时适用 Requirement / Scenario 仍应成立；对 `probable` 的残余不确定性给出真实说明。

**Intentional**：有 Delta 时检查新增 / 修改的 Requirement / Scenario 与现行主规格；合法 skip 时依据批准 Proposal、现行约束及 Tasks 的可验证完成标准审查，不伪造 Delta Coverage。存在 Design 时检查已批准技术决策；不得遗漏适用的兼容约束或 Verification Task，也不得为适配代码擅自修改规格。

**Rework**：核对 Finding 对应任务和当前 Candidate，检查修复确实解决原问题，未引入新的越界或必要验证缺口。

## 8.3 Engineering Standards 检查

至少从当前 Diff 适用的维度检查：Repository Conventions、Complexity、Duplication、Contract Risk、Error Handling、Test Quality、Regression Risk、Maintainability、Safety / Security。专业规则可来自相应 Domain Skill 和项目约定，不为无关文件扩大 Review Scope。

Code Review 可由 Engineer 自审、受控只读 Reviewer Helper 或其他已授权检查机制辅助，但**不能因调用 Reviewer 而出现隐藏的持久化 Development Owner、Sub-Issue、Run 或额外 Workflow**；不得直接套用外部 Method 默认的 parallel subagent topology。

## 8.4 Findings 与定向修复

Review 结果至少包含 `PASS | NEEDS_FIX | UNKNOWN`、固定审查基线、双轴 Findings、阻塞项、Code / Task / Contract 引用及必要 Evidence。**每个需整改 Finding 必须具备足以定位和复核的最小结构**（下例是逻辑结构，不强制新增专门报告文件）：

```yaml
result: PASS | NEEDS_FIX | UNKNOWN
review_baseline_ref: <candidate-and-contract-ref>
findings:
  - id: <stable-finding-ref>
    axis: specification-fix-alignment | engineering-standards
    severity: <severity>
    area: <code-or-task-ref>
    evidence_ref: <finding-evidence>
    suggestion: <targeted-fix-direction>
    blocking: true | false
    resolution: open | resolved
    resolution_evidence_ref: <recheck-evidence-if-resolved>
```

`id` 用于当前 Review / Rework 内追踪问题，不是新的 OpenSpec Task 或持久化 Identity Registry；`severity` 与 `blocking` 由当前 Code Review 判断。**Blocking Finding 必须真正解决且有复核证据，才能形成 Review PASS**；Non-blocking Finding 可以保持 `open`，但必须记录其风险与对完成的影响。经证据确认的误报可标记 `resolved` 并说明理由。人工接受技术风险的事实可以被既有 Deviations / Risks 引用，但**不是**新增 Finding Approval Status，也不得凭风险接受直接覆盖 Blocking Finding 或改变批准的工程契约。引用外部原始报告时，该报告必须能还原 Finding、影响位置、修复建议、解决 / 复核状态。`NEEDS_FIX` 时：

```text
Finding ID + Evidence → Affected Scope → Targeted Fix
→ Affected Task Verification / Local Validation
→ Re-review → Resolution Evidence / Refresh Candidate Evidence
```

不默认重跑整个 Task Set / Change。若 Finding 实质否定已批准 Expected Behavior、Root Cause、Requirement / Scenario 或 Approved Scope，则不是 Engineer 可自行解决的代码修复，必须走 [§12](#development-section-12) 的 Analysis / Human Escalation。

**Review Snapshot（审查快照）**必须能固定实际被审查的 Code / Diff 与 Engineering Contract。Code Review PASS 对该 Snapshot 有效；Commit / Push 后应核对最终 Candidate 与已审查快照的差异，实质影响原 Review / Verification 结论时进行受影响范围的 Targeted Re-review / Re-validation；无相关实质差异时可复用原有效 PASS，不机械重复全量审查。`PASS` 不代替真正的 Runtime / Integration / E2E Evidence，也不代替 Independent Verification。

---

<a id="development-section-09"></a>

# 9. Commit / Push 与 PR Preparation（PR 准备）

<a id="section-9-1"></a>

## 9.1 Git / Candidate Commit Contract

Engineer 负责为当前 Task Set 的**业务代码 Repository** 完成必要 Commit / Push，保留 Repository、Source / Target Branch、Candidate Commit 与实际修改的对应关系。不提交未经授权的其他 Task Set 改动，不将根仓 OpenSpec Engineering Artifact 作为新的独立业务 PR。**同一 Issue 内，一个 Repository 只对应一名当前有效 Engineer Owner**；同仓多个 Task Sets 由该 Engineer 统一处理代码候选及 PR Preparation，不能分给多个 Engineer 再额外设计 PR 聚合流程。

**根仓 OpenSpec Git 提交规则**：提交时点由 [02 §6](02-multica-delivery-lifecycle-design.md#human-analysis-review) 与 [§12.4](02-multica-delivery-lifecycle-design.md#final-completion) 维护。Engineer 读取已提交的初始批准基线，在批准边界内细化 Design，并按 [05](05-openspec-schema-implementation-design.md) 受控更新 `tasks.md`；研发修改保存到**同一个持久共享根仓工作区**，不为每个 Task Set 提交根仓。最终提交属于父级 Finalize，不是 Engineer READY 的前置。

**中间保存与异常处理**：交接前确认当前 Design（如有）、Tasks、必要 Evidence 已保存且后续 Run 可以读取；外部 Evidence 使用已有的可持久读取引用。Patch / Readback 成功不等于根仓 Git Commit，后续 Run 不得把未提交修改当作 Git 历史。共享工作区及证据完整时，按当前事实继续；**工作区修改丢失或关键证据不可读时，停止自动推进，交 Delivery Lead 协调恢复**。不设计自动重建机制，不得仅凭旧 READY 或缓存补勾，也不得宣称完成；恢复后重新核对有效依据再继续。

**最终 Git Commit 交接**：Engineer 保留当前 Delivery 的授权修改与 Evidence 引用，供 [02 §12.4](02-multica-delivery-lifecycle-design.md#final-completion) 的 Finalize 检查范围、暂存项、冲突及 Commit 后置条件；最终提交失败不回头要求各 Engineer 补交中间根仓 Commit。Engineer 不将共享工作区写入成功报告为 Git 已持久化或 Delivery 已完成。

业务代码 Commit / Push 后，必须比较最终 Candidate 与 Code Review Snapshot / Verification Evidence；如果 Code / Test / Contract 发生**影响既有结论的实质变化**（例如 Commit Hook 改动业务代码），只重新执行受影响的 Review / Validation。无关或无语义影响的差异不强制全量重跑。**根仓 Task checkbox / Archive 的最终 Git Commit 本身不是业务代码 Candidate 变化**，不得机械使业务验证 Evidence 失效。

## 9.2 PR Preparation 与 PR Materialization 分离

```text
Engineer = PR Preparation（代码修改的语义准备）
Script / Project Capability = PR Materialization（确定性创建与幂等关联）
PR Status Sync Agent = 外部终态同步与按条件 Finalize
```

**同一 Issue 中，同一 Repository 的所有 Task Sets 只能由同一 Engineer 负责**；多个 Task Set 可以由该 Engineer 在一次或受控连续执行中处理，但不能分派给多个 Engineer。这里不引入 `Task Set PR Contribution`、`Repository PR Aggregator` 或新增 PR 责任角色。Engineer 在 Development Ready 前，应为自己负责的每个 required Repository Change 提供至少：

```yaml
# 仅示意逻辑输入；不定义新的平台字段或 Store
repository: <repository>
repository_id: <repository-id>
source_branch: <source-branch>
target_branch: <target-branch>
candidate_commit: <commit>
pr:
  title: <human-readable-title>
  description: <description-or-persistent-reference>
  ready: true
associations:
  tfs_work_item: <stable-tfs-ref>
  delivery_issue: <stable-delivery-ref>
```

Engineer 负责 PR Title / Description 的技术语义、Change Summary、影响范围、测试与风险说明；**上面 PR Preparation 逻辑示例中的 `associations`** 仅表明必需可追溯的关联引用，**不是 OpenSpec Schema 字段**，也不要求在 Multica 复制已有 TFS 来源事实，真正字段映射由 `pull-request` 的实施契约确定。

Engineer **不执行** PR API 创建、幂等 Reconcile、外部 Provider 身份判定、Review 状态同步、PR Merge 或 Delivery Finalize。**PR 是 Repository 级代码交付对象，不是 Task Set 级对象**：同一 Repository 多个 Task Sets 由同一个 Engineer 完成 Repository Change 和 PR Preparation；不因 Task Set 数量自动创建 PR，也不允许通过多 Engineer 同仓派工再在 PR 层兜底聚合。跨不同 Repository 的代码交付分别处理 PR；多个 Repository / PR 不自动产生 Development Sub-Issue。

## 9.3 PR Preparation 的完成条件

**当前 Task Set 影响到的** Repository Change 必须有明确 Candidate Commit，PR Title / Description 有内容或持久可读引用，必要 TFS Work Item / Issue Association 可解析，Scope、Build / Test Evidence 和风险说明与该候选版本一致。**同仓多个 Task Sets 由同一个 Engineer 维护同一 Repository 的候选代码和 PR Preparation**：可以分次执行、逐次更新准备信息；当前 Task Set 的 READY 不应仅因同一 Repository 尚有该 Engineer 的其他未完成 Task Set 而被阻断，也不能把当前候选版本误报为整个 Repository 的最终 PR Candidate。正式 PR Materialization 前应核对该 Repository 所有 required Task Sets 和最终 Candidate；这仍属于既有责任边界，不新增 PR Aggregator 或 PR 贡献对象。缺少必需字段，不得以“父 Issue 中可以猜出来”为由宣称准备完整。PR Materialization 的最终准入仍以 [02 §10](02-multica-delivery-lifecycle-design.md#pr-materialization) 为准。

---

<a id="engineering-evidence"></a>
<a id="development-section-10"></a>

# 10. Development Evidence（研发证据）

## 10.1 证据的作用与归属

Development Evidence 要证明**某个已批准工程契约范围，在某个当前候选代码版本上，实际完成了哪些实现与验证**。它是工程事实 / Evidence References 的逻辑汇总，不自动形成新的 `development-evidence` 领域身份、任务状态机或独立 Contract Store。

**Engineer 必须形成可结构化读取、可恢复的 Development Result / Evidence Index（研发结果与证据索引）**，将 `change_ref`、当前 `task_refs`、批准基线、Candidate Commit、Verification / Review Result、必要 Evidence Refs 与 PR Preparation 关联起来。承载方式可使用现有 Multica Run / Issue 的结构化结果与稳定引用，以及按需 Supporting Artifact / 原始 Test Report；**不强制一个 Task Set 生成独立 `development-evidence.md`，也不新建 Evidence Store**。仅写“测试已通过，见日志”而没有明确 Task / Candidate / Check 关联，不满足本契约。

技术证据优先留在代码仓、OpenSpec 或适当 Supporting Artifact；Multica 保存本次 Task Set Result、可解析索引 / 引用与运行事实。最终 `READY | BLOCKED | UNKNOWN` 是当前 Task Set 的专业交付结果，不是新的全局 Status Key。**Evidence Collection 与 Result Publication 分开**：在 Completion Check 前允许逐步形成 Evidence Index，此时**不填写最终 `development.result`**，不新增 `PENDING` 等过渡枚举；Check 与必要的 Task Progress Patch / Readback 完成后才发布 `READY`。这里的 Task Progress Persistence 指当前共享工作区的受控写入与回读，**不要求最终根仓 Git Commit 已完成**；根仓 Commit 由最终 Finalize 负责。无法满足 Check / Patch 条件时，记录已有的 `BLOCKED` / `UNKNOWN` 与原因，不误写 READY。

## 10.2 最小逻辑 Evidence Contract

| Evidence 维度 | 最小要求 |
|---|---|
| Scope Identity | 当前 `change_ref`、Assigned `task_refs`、当前 Issue 引用 |
| Approved Contract | 已批准根仓 Baseline、必要后续受控修订、Relevant OpenSpec Artifact / Acceptance / Verification Refs |
| Candidate | 受影响 Repository、Branch、Candidate Commit（可跨多个 Repository），并可还原 Changed Files / Diff Scope |
| Implementation | 具体修改摘要及主要实现位置、影响范围、非 Contract 级设计细化 |
| Verification | 每个 assigned Task 及 required Check 的方法、实际结果、执行版本、环境与原始 Evidence Reference；逐项检查细节可由稳定引用恢复 |
| Code Review | 固定审查基线、双轴 Review 结果、Finding ID / Severity / Area / Evidence / Suggestion、Blocking 与整改复核状态 |
| Deviations / Risks | 已批准的例外、风险、未解决事项以及对完成的影响 |
| PR Preparation | 当前 Engineer 负责的每个 Repository Change 的完整准备事实或稳定引用；同一 Repository 的多个 Task Sets 不涉及跨 Engineer 的 PR 贡献聚合 |

**示例**（逻辑形态，不新增独立实体；字段名非 Parser Contract）：

```yaml
development:
  # Evidence Collection 阶段不填写 result；完成检查与进度回读后才填最终结果
  result: READY | BLOCKED | UNKNOWN
  change_ref: <existing-change-ref>
  task_refs: ["1.1", "1.2"]
  runtime_ref: <current-issue-or-subissue>
  approved_baseline_ref: <git-commit-or-approved-reference>

  repositories:
    - repository: <repo>
      source_branch: <branch>
      target_branch: <branch>
      candidate_commit: <commit>
      changed_files_ref: <diff-or-files-ref>
      implementation_refs: [<code-ref>]

  verification:
    - task_ref: "1.1"
      contract_refs: [<existing-openspec-ref>]
      method: <actual-test-or-check>
      result: PASS | FAIL | UNKNOWN
      evidence_ref: <actual-output-ref>
      candidate_ref: <matching-repo-commit-ref>

  local_validation:
    result: PASS | FAIL | UNKNOWN
    checks_ref: <per-check-result-and-execution-evidence-ref>

  code_review:
    result: PASS | NEEDS_FIX | UNKNOWN
    review_baseline_ref: <candidate-and-contract-ref>
    findings_ref: <findings-with-id-severity-area-evidence-suggestion-ref>
    resolved_findings_ref: <resolution-and-recheck-evidence-ref>

  deviations_ref: <approved-deviations-if-any>
  known_risks_ref: <risk-ref-if-any>
  blockers_ref: <blocker-ref-if-any>
  pr_preparation_ref: <required-per-repository-facts-ref>
```

`contract_refs` 直接指向现有 OpenSpec Requirement / Scenario（Capability Spec 路径 + 原生标题）、Corrective Proposal 语义位置或当前已批准任务编号（例如 `1.1`）；不得新造 `AC-xxx` / `VR-xxx` 或使用 `Acceptance Contract-01` 作为平行身份。定位准确性依据 [05 §8](05-openspec-schema-implementation-design.md#openspec-schema-section-08) / [§10](05-openspec-schema-implementation-design.md#openspec-schema-section-10) 的 Native First 契约。**`checks_ref` / `findings_ref` / `changed_files_ref` 等引用必须能定位可读取的实际明细**（检查名与执行方法、结果、执行环境、发现与解决状态、Changed Files / Diff），不是用空占位符或一句摘要替代 Evidence。

示例中的字段是最小可读结构的表达方式，不是需要新增的持久化 `TaskSet`、`EvidenceStore`、`Unit` 或独立批准版本，也不是新的 Markdown Parser Contract。可使用其他等价的结构化载体，但必须保留字段语义与恢复能力。是否需要独立 Evidence Markdown 按实际长期保存需求判断；**不能仅因 `development-execution` 运行就强制生成同名文件**。

## 10.3 Evidence Freshness（证据时效性）

Current Evidence 应与当前 Candidate / Contract / Execution Context 可验证地对应：

- **代码变化**：Candidate Commit / Changed Files 变化时判断受影响验证与 Review 是否需要重做。
- **契约变化**：Requirement / Scenario、Corrective Expected / Regression Scope、Task Verification 或批准范围实质变化，即使 Commit 不变也要重评既有 PASS。
- **环境变化**：影响验证有效性的 Runtime、数据、Dependency、Config、Schema 或 Test Environment 变化时，补充实际检查或明确 Evidence 局限。
- **返工变化**：只更新受影响 Task / Repository 的证据，不因为无关任务变化而盲目废弃全部证据，也不能复用已被推翻的 PASS。
- **Independent Verify PASS**：其是否失效及是否需要重验由 [02 §9.7](02-multica-delivery-lifecycle-design.md#section-9-7) / Verification Gate 判定；Engineer 只报告 Candidate 与事实变化，不能自行覆盖独立结论。

**不能声称执行了实际未执行的检查**，不能以“Review 很可能没问题”“此前某次 Run 通过”替代当前可复核证据。`COVERED` 只有在能追到实际实现与验证时才有意义。

## 10.4 Publish / Handoff

成功或阻塞都应写回当前 Issue **结构化、可恢复**的最小 Result / Evidence Index、相关 Commit / PR Preparation 引用和下一步必要动作。`READY` 的最终发布以 [§11.2](#section-11-2) 回读完成为前提；阻塞时可保留已完成检查与失败原因，但不得写成成功。Summary 可从现有 Engineering / Delivery Truth 渲染；不产生新的独立数据 Owner。实际 `development-contract.md`、`development-evidence.md` 模板与校验器在 [§13](#development-section-13) 实施，但模板只表达输出格式，不替代本节及 [05](05-openspec-schema-implementation-design.md) / [06](06-method-skill-library-implementation-design.md) 的权威定义。

---

<a id="engineering-completion"></a>
<a id="development-section-11"></a>

# 11. Development Completion（研发完成）与交付回流

## 11.1 当前 Task Set 的 Development Ready

`Development Ready` 是当前 Task Set 的结果事实，不是 Multica Issue 的另一个永久状态，也不是整个 Delivery 的聚合结果。必要条件如下：

```text
Current Required Assigned Task Implementation Complete（已批准取消 / 替换项按 §3.4 处理）
+ Assigned Required Task / Change-level Verification Evidence valid
+ Required Local Validation PASS
+ Code Review PASS / No unresolved blocking findings
+ Required Business Repository Commit / Push & Candidate Identity complete
+ PR Preparation complete for Engineer-owned Repository Changes（纯验证按 §7.1 复用有效事实）
+ Same-Delivery Repository Owner Unique（同一 Repository 的 Task Sets 只归同一 Engineer）
+ Development Evidence traceable and current
+ No unresolved Task Set blocker
```

Engineer 不负责将父 Delivery `done`、决定是否启用 Verify Agent、创建 PR、完成 TFS 回写或提前提交根仓 OpenSpec Git。独立 Verify-Agent-owned Change-level Tasks 允许在当前 Engineer Task Set 完成时保持 pending；全 Change 的 PR / Finalize 准入由 [02](02-multica-delivery-lifecycle-design.md) 的 Parent Delivery 负责。

<a id="section-11-2"></a>

## 11.2 Development Completion Check 与 Task Progress 更新

[02 §8](02-multica-delivery-lifecycle-design.md#development-execution) 定义 `Development Completion Check` 的业务硬条件；[05 §11](05-openspec-schema-implementation-design.md#openspec-schema-section-11) 定义 `update-task-progress.py` 等确定性任务进度写入契约。[04](04-engineer-development-design.md) 不创建 `Development Readiness Check`、第二套完成状态或另一个中央 Task Writer。

**两个不同的完成概念：**

- **Engineering Completion（工程实质完成）**：依当前 Candidate、批准的 Engineering Contract、实际 Verification / Local Validation、Code Review 与 Evidence 判断；**不以当前 checkbox 已勾选作为前置**。
- **Task Progress Persistence（任务进度持久化）**：在 Engineering Completion 判定 PASS 后，将当前 assigned `task_refs` 的 checkbox 受控写入**共享根仓工作区**并回读确认；此步骤未成功时不得发布最终 `READY` Completion Fact。此处 Persistence **不等于根仓 Git Commit**：根仓 Git 最终提交是父级 Finalize 的责任，不是 Engineer READY 的前置。

正常完成顺序（Check → Patch → READY 在当前 Engineer Run 内连续执行，不新增 Stage / Run）：

```text
Engineer 完成 Implementation / Verification / Review
→ 固定 Candidate Commit / PR Preparation
→ 形成可结构化读取的 Development Evidence Index（未提前宣称 READY）
→ Development Completion Check（只依据 Engineering Contract 与当前 Evidence）
   FAIL → Targeted Rework / Blocked（不得标记 Task Complete）
   UNKNOWN → Report / Escalate（不得隐式 PASS）
   PASS → 调用 05 的受控 Task Progress Patch
→ 在 Change-scoped Single-writer Critical Section 内更新共享工作区
→ 回读 tasks.md，核对已分配 Task Ref 的 checkbox / identity
   失败 / 写入结果 UNKNOWN → 恢复 / 报告，不能发表最终 READY
→ 发布前核对 Candidate Commit、工程契约和派工范围仍与 Check 依据一致
   发现相关变化 → 不发布 READY，重新检查受影响部分
→ 写回当前 Task Set READY Completion Fact / 结构化 Evidence Index Ref
→ 结束本轮 Run（根仓 OpenSpec 尚未 Git Commit 属于正常中间状态）
→ 父级最终 Finalize 时统一提交根仓 Git（不属于本次 Engineer Run）
```

`Development Completion Check` 不能将“`tasks.md` 已为 `- [x]`”作为此次 PASS 的必要条件，否则会与“Check PASS 后才允许 Patch”形成循环依赖。原本已勾选的 Task 同样须由当前 Candidate / Contract / Evidence 重新确认有效性；单靠持久化进度不得重新放行。

发布前核对直接使用本轮已有的 Candidate、Contract 和派工事实，不增加版本状态机、锁或专门校验机制。受控 Patch 只处理当前仍需执行且已满足完成条件的任务；已批准取消 / 替换项保留记录，不虚假勾选。单纯 checkbox 更新不属于使本轮检查依据失效的契约变化。

**并发边界**：不同 Repository 的 Engineer / Verify Agent 可以按既定任务分工并行实现或验证；同一 Issue / Repository 唯一有效 Engineer，同一 Task Set 不重复派发。`tasks.md` checkbox 继续使用 [05](05-openspec-schema-implementation-design.md) 已有的 change-scoped serialized write，不新增锁机制。写入结果 UNKNOWN 时先回读当前共享工作区；工作区修改丢失或关键证据不可读时按 [§9.1](#section-9-1) 停止自动推进，交 Delivery Lead 协调处理，不自动重放 checkbox。根仓最终 Git Commit 由 Finalize 负责，与单个 Task Set 的 Patch Lock 是不同边界，必须避免误提交其他 Delivery Change。

`Development Completion Check` 校验 Contract 和 Evidence，不只是文件存在与字段非空；真正专业正确性仍以代码 / 测试 / Review 的实际结果支撑。原生 OpenSpec Validation 或 checkbox PASS 不能替代此 Check。

<a id="section-11-3"></a>

## 11.3 当前 Issue 的完成交接

当前 Task Set 的 Check PASS、Task Progress Patch / Readback 成功后，Engineer 将 `task_refs` 对应的 Completion / Evidence Facts 返回当前 Issue，结束本轮 Run。单个 Task Set 完成不能关闭整个 Issue，后续聚合、Verify 和 PR 由 Delivery Lead 协调。

已有完成事实只有在共享工作区、Candidate 和 Evidence 仍有效时才可复用。重复 `@mention` 不应使已完成的专业工作无依据地重跑；Candidate 或工程契约发生实质变化时，重新核对受影响部分。恢复和聚合遵循 [02 §7](02-multica-delivery-lifecycle-design.md#development-materialization)–[§9](02-multica-delivery-lifecycle-design.md#verification-rework)。

## 11.4 与后续 Independent Verification / PR 的接口

Engineer 交付的最小事实应足以让父级判断：哪些 required Implementation Tasks 完成，哪些 Change-level Verification Tasks 由 Engineer 完成，哪些是被批准交给 Verify Agent 的 pending 项；Candidate Commit Set / Evidence 是否可用，由唯一的 Repository Owner 提供的 PR Preparation 是否齐全，以及最终根仓 Git Commit 尚待 Finalize 的事实。父级才决定是否开展 Independent Verification 及 PR Materialization；当前 Task Set READY 不代表根仓 OpenSpec 已 Git 提交。

不得把 `Local Validation`、`Code Review`、`OpenSpec Native Verify` 或 `Change-level Verification Task` 一律解释为 Verify Agent 活动；也不能以 `verify_agent.required=false` 取消必要的组合验证。[02 §9](02-multica-delivery-lifecycle-design.md#verification-rework)–[§12](02-multica-delivery-lifecycle-design.md#section-12) 是后续唯一生命周期权威。

---

<a id="development-section-12"></a>

# 12. Engineer 技术决策、Diagnostic Escalation（诊断升级）与停止边界

## 12.1 可以自主决定的 Engineering Semantic Work

在当前批准 Contract 范围内：局部算法 / 类与函数拆分、内部数据结构与组件组织、测试策略 / Feedback Technique、局部修复与非契约级重构、实际代码与 Evidence 的诊断判断、Code Review 判断、适用 Internal Method 选择。发现 Root Cause 的新证据时，可提出并验证修正假设，记录 Finding / Evidence；只有仍满足当前批准的 Fix Strategy、任务和验证边界，才能继续实施。

不得自行修改已批准的 Expected Behavior、Requirement / Scenario、Root Cause / Fix Strategy / Regression Scope、External Contract、Repository / Development Scope、Assigned Task Set、已批准的 Verification Task、Issue Assignee 或 Human Approval 条件。新事实实质推翻已批准契约时停止受影响实施并升级；诊断假设变更本身不自动触发重新 Analysis。

<a id="section-12-2"></a>

## 12.2 Diagnostic Escalation 的进入条件

当出现 Root Cause Evidence 与代码事实冲突、修复后原 Failure 仍存在、新增 Failure、无法形成必要反馈、依赖 / 环境显著偏离、影响范围超过批准边界时，Engineer 应从当前问题进入有界诊断：

```text
Observed Failure
→ Reproduction / Feedback（可行时）
→ Minimal Failure Path
→ Hypotheses + Discriminating Evidence
→ New Finding / Effect on Approved Analysis
→ Continue within approved boundary OR STOP / Escalate
```

该过程借助 [§6](#development-section-06) 所述受控 Debugging Method，仅产生当前 Finding / Evidence；不在 Development 中默认生成新的 Corrective Proposal、重复执行完整 Requirement Analysis 或扩张 Scope。**单纯 `root_cause.status=probable` 不构成必须重分析**；只有新事实影响已批准 Fix Strategy / Scope / Verification 正确性时才需要实质升级。

## 12.3 STOP / BLOCKED / UNKNOWN 与责任人

| 情况 | 本轮处理 |
|---|---|
| 当前批准、身份、必要 `task_refs` / Context / Native Preparation / Validation 缺失 | STOP；说明缺失事实，交 Delivery Lead 核实或补充分派；不默认重新生成 Analysis Artifact |
| 同一 Delivery 中同一 Repository 被分配给多个 Engineer | STOP 冲突范围；交 Delivery Lead 统一调整为一名有效 Owner，不能在 PR 阶段补救派工冲突 |
| 同一 Issue / Repository 存在重叠派工或同时启动多个 Engineer | STOP 冲突范围；交 Delivery Lead 调整唯一有效 Engineer 与任务引用，不新增调度机制 |
| 持久共享工作区修改丢失或关键 Evidence 不可读 | 停止自动推进；交 Delivery Lead 协调恢复，不能仅凭旧 READY 补勾或宣称完成 |
| Requirement / Scenario / Expected / Fix / Regression Contract 冲突或必须修改 | STOP；提供影响与证据，由 Delivery Lead 协调 Workitem Analyst / Human |
| 未批准 Task / Repository 扩围、需要新增或改变已派发任务编号 / 正文 | STOP 当前自动扩围；报告 Goal / Reason / Impact，走受控 Analysis / Coordination |
| 环境、权限、依赖导致安全实现或必需验证不能完成 | BLOCKED；记录错误、重现条件和所需外部动作 |
| Deterministic Check / Identity / Evidence 返回 UNKNOWN | 不假装通过；提供现有事实，由 Delivery Lead 协调排障 / Human |
| 明确的 Gate / Check FAIL | 不覆盖 FAIL；能归因的局部修复继续 Targeted Rework，不能归因时升级 |
| 多轮相同 Finding / Blocker 无法收敛 | 停止无界重试；提供历史尝试和 Evidence，交 Delivery Lead |
| 新诊断证据出现，但批准的任务、Fix Strategy、Scope、Verification Contract 均仍有效 | 在原 Run 内有界复核并记录 Finding / Evidence；可以调整局部实现，不修改批准的 Proposal，不重走整轮 Analysis |
| 当前 Finding 可在已批准边界内修复 | Targeted Fix → Affected Verification → Review → Evidence Refresh |

重要交接至少包含 Current Facts、具体冲突 / 决定点、Evidence References、受影响 `task_refs` / Repository、建议及下一责任角色。升级不等于 Engineer 自主修改 Issue Status；具体状态、下一 Agent / Human 通知和重试次数由 [02](02-multica-delivery-lifecycle-design.md) 维护。

## 12.4 Deterministic 与 Semantic 的责任边界

- **Engineer Semantic Decision**：实现和局部设计选择、Feedback / Review 策略、Finding 判断、诊断假设。
- **Deterministic Script / Check**：Identity / `task_refs` 校验、完成硬条件、required Evidence 存在性、Task Progress 串行 patch、PR Preparation 字段完整性等可客观判断的事实。
- **Delivery Lead**：当前 Issue 的成员分工、跨角色 / 跨仓语义、Scope / 派工异常、必要 Human 决策。
- **Human**：批准 Requirement / Solution / Verification Boundary 与实质变更；Engineer 不以任何 LLM 或脚本结果替代人工批准。

Method、Reviewer Helper 或内嵌 subagent 只可辅助受控调查 / Review，不得形成隐藏的持久运行边界或取代 Multica Native Collaboration。

---

<a id="development-section-13"></a>

# 13. Agent / Project Skill / Internal Method 实施结构

## 13.1 目标层级及资产目录

推荐 Workspace / Project 实施资产按以下逻辑组织；实际 Skill 安装路径依 Multica 配置确定，不把本图中的目录当作平台自动发现保证：

```text
project-skills/
├── development-execution/                 # Canonical Project Skill Entry
│   ├── SKILL.md
│   ├── methods/                         # 内部方法，不注册为顶层 Multica Skill
│   │   ├── tdd.md
│   │   ├── codebase-design.md
│   │   ├── code-review.md
│   │   └── verification-before-completion.md
│   ├── references/
│   │   └── development-contract.md
│   ├── templates/
│   │   └── development-evidence.md
│   ├── scripts/
│   │   └── validate-development-evidence.py   # 确有必要时
│   └── tests/
├── backend-engineering/
│   └── SKILL.md
├── frontend-engineering/
│   └── SKILL.md
└── flink-engineering/
    └── SKILL.md

# Development 已有：development-execution/methods/bounded-diagnosis.md
# 独立 bug-analysis 目前是候选能力，只有确有跨 Agent 复用需要且可访问时才提取。
```

`development-execution` 是公共专业入口、Context Assembly（上下文组装）、Method Dispatcher（方法调度器）、Evidence Publisher 和 Completion Handoff 的 Owner。调用前应核对同一 Delivery / Repository 的 Engineer Owner 唯一性；不由本 Skill 自行修正冲突派工。`backend-engineering` / `frontend-engineering` / `flink-engineering` 是各专业 Project Skills，只提供技术领域约束 / Feedback / Pattern，不重复一套完整执行 Procedure。

<a id="section-13-2"></a>

## 13.2 Agent × Project Skill 的推荐绑定

| Agent | 必绑 / 主入口 | 专业 Domain Skill | 不应直接绑定为独立 Runtime Skill |
|---|---|---|---|
| Backend Engineer | `development-execution` | `backend-engineering` | `tdd`、`code-review`、`verification-before-completion`、`diagnosing-bugs` |
| Frontend Engineer | `development-execution` | `frontend-engineering` | 同左 |
| Flink Engineer | `development-execution` | `flink-engineering` | 同左 |

Method 文件不是 Workspace / Agent 可独立调用的顶层 Skill，不含独立 Multica Agent Binding、Run、Issue Assignment、PR / Archive Side Effect。[06](06-method-skill-library-implementation-design.md) v1.4.1 为 Method Library 的唯一治理与实现依据。

**Engineer Common Instructions Baseline（公共指令基线）**：以下六段仅作为 Backend / Frontend / Flink Engineer 的推荐内容参考；可以按角色复杂度合并章节，结合当前专业 Domain Skill，保留每次必要的工作检查；不复制 [§4](#development-section-04)–[§11](#development-section-11) 的详细 Procedure，也不另立与 [§2.3](#section-2-3) 竞争的 Role Contract。

```text
Role
你是 Delivery Squad 中被明确委派 Task Set 的专业 Engineer。
在已批准的工程契约范围内实现并验证代码；不重新定义需求或组织整个 Delivery。

Goal
在已批准范围内完成正确、可维护、可验证的代码实现，形成真实有效的工程交付成果。

Core Responsibilities
读取当前 change_ref / task_refs 与批准根仓基线；建立 Feedback；
完成 Implementation、Assigned Task Verification、Required Local Validation、Code Review / Finding Fix；
完成业务代码仓 Commit / Push、唯一 Repository Owner 范围内的 PR Preparation、结构化 Development Evidence Index 与完成交接。

Boundaries
不改变已批准 Requirement / Corrective Fix Contract、Scope 或 Task Set；同一 Issue 的同一 Repository 只归一个有效 Engineer，后续任务 / 返工沿用同一 Issue 交接；
不新增 / 重编号 Top-level Task 或擅改任务正文；不创建 Sub-Issue、决定 Verify Executor；
不自行创建 PR、合并 PR 或关闭父 Delivery；不覆盖明确 Gate FAIL。

Execution Principles
从持久化当前事实工作，不假定继承 Analyst 的会话；先识别有效 Feedback，按需 TDD；
Change-level Verification Task 只执行分配给自己的部分，不自行转交 Verify Agent；
Finding 优先定向修复；Completion Check 凭当前 Evidence，不凭 Checkbox；进度只通过受控 Patch。
已批准取消 / 替换任务保留依据并由 Lead 调整范围，不虚假勾选；纯验证无代码修改时复用现有候选及有效 Review / PR 事实，不制造新提交。

Escalation, Communication & Delivery
必要批准 / 范围 / Evidence 缺失、批准合同与代码冲突、Root Cause 不成立、必要验证不可执行、
需要扩围或新增 Top-level Task 时停止自主扩展，给出事实 / Evidence / 影响 / 下一责任人；
Check → Patch → READY 连续执行，发布前核对检查依据；有相关变化则重新检查受影响部分。
将当前 Task Set Result 与 Evidence Refs 写回当前 Issue；单个 Task Set READY 不关闭 Issue。
初始批准基线先提交；研发修改保存在持久共享工作区，Git 最终提交由父级 Finalize 负责。工作区修改或关键证据丢失时停止，交 Delivery Lead 协调恢复。
```

## 13.3 `development-execution/SKILL.md` 最小执行契约

建议实际 Skill 只说明：`Use When`、`Inputs`、`Preconditions`、`Procedure`、`Outputs`、`Stop / Escalation`、内部 Methods / References；不要把本设计文档、第三方历史讨论、全部官方手册复制进去。

```text
Use When: 当前 Engineer 收到明确授权的 Task Set / 有界 Rework
Input: change_ref + task_refs + approved baseline + artifact/evidence refs + runtime context
Check: identity / authorization / native preparation / repository engineer uniqueness / scope / required evidence / dependencies
Procedure: Ground → Feedback → Implement → Verify → Review → Business Repo Commit / Push
           → PR Preparation → Evidence → Completion Check / Shared Workspace Progress Handoff
           → Parent Finalize later commits OpenSpec Root Git (outside Engineer Run)
Output: Development Result + Evidence Ref + Commit / PR Preparation Facts
Applicability: 已批准取消 / 替换项按调整后的 required 范围检查；纯验证无代码修改时复用候选及有效 Review / PR 事实
Stop: contract drift / permissions / required checks missing / Gate FAIL or UNKNOWN
```

Agent 根据本次任务与反馈自行选择适当方法；在完整场景 Skill 内，需要组合的 Internal Methods 由当前 `development-execution` 进行指导，不形成独立 Run。Method Dispatch 由父 Project Skill 决定：行为可自动测试时用 `methods/tdd.md`；重要局部代码设计决策时按需用 `methods/codebase-design.md`；候选实现可审查时用 `methods/code-review.md`；声明完成前用 `methods/verification-before-completion.md`。Methods 不能私自继续调用其他 Method、Agent 或 Workflow。诊断升级采用 [§6.4](#section-6-4) 的显式复用接口。

## 13.4 Domain Skills 的专业内容与边界

**`backend-engineering`**：Java / Spring、API / Service / Domain Layer、Persistence / Transaction、Database Migration、Backend Test / Contract Strategy、错误处理与兼容性。

**`frontend-engineering`**：Vue、Component / State / Routing、Type System、Browser Interaction、表单 / 错误状态、组件测试、E2E / Build。

**`flink-engineering`**：Flink Job、Stream / Event Processing、State / Timer / Watermark、Schema Compatibility、Checkpoint / Recovery、Flink Test Harness。

Domain Skill 负责“这个技术领域如何正确实现”；`development-execution` 负责“当前 Task Set 如何完成工程闭环”。Domain Skill 不决定 Technical Change Kind、Human Review、Runtime Projection、Sub-Issue、PR Materialization 或 Delivery Completion。

## 13.5 Script / Template / Evidence 最小责任

| 资产 | Owner / 用途 | 不承担 |
|---|---|---|
| `development-contract.md` | 当前 Task Set 的输入 / 输出 / Stop 参考契约 | 复制批准的 Specs、Task Body 或 Runtime State |
| `development-evidence.md`（模板） | 当前 Task Set 的结构化 Development Result / Evidence Index 形态（可由现有原生载体实现，不强制每轮创建文件） | 新的独立 Acceptance / Verification Identity 或生命周期 |
| `validate-development-evidence.py`（按需） | 判断必需字段 / 引用 / 结构完整性，返回 PASS / FAIL / UNKNOWN | 判定主观代码语义是否正确、替代 Review / Testing |
| `update-task-progress.py`（[05](05-openspec-schema-implementation-design.md) Owner） | 对 assigned Task checkbox 受控且串行 patch | 修改 Task Body、生成工程计划、创建 Runtime State |
| `Development Completion Check`（[02](02-multica-delivery-lifecycle-design.md) Owner） | 判断当前 Task Set 的完成硬条件 | 聚合整个 Delivery、独立验证、创建 PR、替代专业 Evidence |

不引入全局 `method-library.yaml`、Method Registry、Method Run State、`tdd-result.md`、`debugging-result.md`、`method-result.json`、`development-plan.md` 等并行对象。只有实际需要长期留存的 Evidence 才作为 Supporting Artifact 保存。

## 13.6 实施落地顺序

以下按**完成检查所依赖的结果**安排集成顺序；具体 Method / Domain Skill 可以随相关工程步骤同步落地，不是到最后才允许使用 TDD / Review：

1. 配置 Backend / Frontend / Flink Engineer Description / Instructions 与 Project Skill 绑定。
2. 实施 `development-execution/SKILL.md` 的批准输入读取、Task Set Scope、Ground / Feedback、STOP 契约，接通根仓 Baseline。
3. 实施 Incremental Implementation、Required Verification、Local Validation、Code Review / Finding Rework，并接入所需 Internal Methods 与 Domain Skills。
4. 实施业务代码仓必要 Commit / Push、Candidate Commit Identity、PR Preparation（含 TFS / Delivery 关联）及错误恢复；核对同一 Issue / Repository 唯一 Engineer；纯验证按 [§7.1](#section-7-1) 复用有效事实。
5. 实施可结构化读取的 Development Result / Evidence Index 与当前 Candidate / Check 的 Evidence Freshness 核验。
6. 对齐 Development Completion Check（只判当前 required Tasks 的 Engineering Completion）→ [05](05-openspec-schema-implementation-design.md) Task Progress Patch / Shared Workspace Readback → 发布前核对检查依据 → READY / Parent 回流；不要求本阶段对根仓 Git Commit，不新增版本状态机或锁。
7. 明确父级 Finalize 最终 Git Commit 的交接事实，以及工作区修改 / 关键 Evidence 丢失时停止并交 Lead 的处理边界；完成 [§14](#development-section-14) 的正向、负向、并发、恢复测试，未验证的设计不得标记为已部署。

**后续实施依赖**：[05](05-openspec-schema-implementation-design.md) 的 Native First 任务定位 / 受控进度脚本及其回归、实际 Evidence 字段映射、[06](06-method-skill-library-implementation-design.md) 诊断 Method 的可读入口仍须落地验证。派工、共享工作区与最终提交规则由 [02](02-multica-delivery-lifecycle-design.md) 维护；OpenSpec 执行方式及 Native Verify 策略按 [§7.3](#section-7-3) / [05 §9.4](05-openspec-schema-implementation-design.md#section-9-4) 执行。

---

<a id="development-section-14"></a>

# 14. Development 接入验收（Acceptance Tests）

本章定义设计目标的**实施验收场景**，不是本次文档编辑已运行的真实环境测试。所有结果应可从 Engineer Run、当前 Repository、OpenSpec Change / Tasks、Multica 当前事实与 Evidence Reference 复核。

| ID | 场景 | 期望结果 |
|---|---|---|
| D-01 | Parent Issue 中 `@Backend Engineer + task_refs` | 仅实现当前 assigned Task Set，完成后不误关父 Delivery |
| D-02 | 当前 Issue 内通过 `@mention + task_refs` 委派专业成员 | 不更改 Issue Assignee，成员可以在独立 Run 中读取工作依据，完成 Task Set 后不关闭整个 Issue |
| D-03 | 相同 `task_refs` 重复通知 / 分派 | 已有有效完成事实不重跑整轮；无双重写入或重复 Side Effect |
| D-04 | 不同 Repository 的 Engineer 并行更新同一 Change 的不同 `task_refs` | 各自只修改 assigned checkbox，change-scoped critical section 无 lost update；不允许同一 Repository 多 Engineer 共同执行 |
| D-05 | Human Approval 后 Engineer 企图新增 / 改写已派发任务的正文或编号 | 拒绝直接修改，记录 Goal / Reason / Impact，走受控 Analysis / Coordination |
| D-06 | Corrective 合法 `skip_specs: true` 或 Design 缺省 | 根据 Proposal / Tasks 修复验证，不伪造 Spec 或空 Design |
| D-07 | `root_cause.status=probable` 但已获批准且修复边界充分 | 按批准 Fix Strategy 有界开发，记录残余不确定性与回归证据，不擅自升级为 confirmed |
| D-08 | `root_cause.status=unknown` 或已有根因证据被代码事实推翻 | 停止正常实现，向 Delivery Lead 报告具体矛盾并返回 Analysis 边界 |
| D-09 | Intentional Design 合法省略、Specs 合法 skipped，或 Diff 只读 Delta 漏掉原主规格约束 | 不要求空 Design / Delta；Ground 读取相关 Existing Specs 并按批准 Proposal / Tasks 验证，保持既有兼容条件 |
| D-10 | 原生 OpenSpec 上下文包含 Change 全部未完成 Tasks，但当前 Engineer 只负责一部分 | `development-execution` 只执行当前 `task_refs`，不调用 `/opsx:apply` 或代替其他 Engineer；单 Engineer 全量派发按批准范围执行 |
| D-11 | 适用 TDD Method | RED / GREEN / Refactor 有实际 Behavior Evidence；Method 不新增 Multica Run / Issue |
| D-12 | Code Review 双轴检查 | 单独评估 Contract Alignment 与 Engineering Standards，Finding 可追踪并被定向修复 |
| D-13 | Test / Build PASS 但 Behavior Verification 缺失 | Completion Check 不因工具 PASS / checkbox 而宣称任务完成 |
| D-14 | Required Change-level Verification Task 由 Engineer 负责 | Task Set Completion 包含当前有效 Combination Evidence |
| D-15 | Independent Verify Agent 已批准并持有另一个 Verification Task | Engineer-side Ready 允许该任务 pending；父级在验证 / PR 前要求相应 Task / Gate 完成 |
| D-16 | `verify_agent.required=false`，但存在 Required Regression / Integration Task | 仍需指定的 Runtime Executor 完成验证，不能省略 required checks |
| D-17 | PR Preparation 缺 Repository ID / Candidate Commit / TFS or Delivery association | 不通过对应完整性要求，不能以“父 Issue 理应知道”补齐；同仓多 Task Sets 由唯一 Engineer 准备 |
| D-18 | 一个 Task Set 改动两个业务 Repository | 分别形成 Repository Change / PR Preparation；不因此新建 Issue |
| D-19 | Commit、Contract 或影响测试结论的环境发生实质变化 | 重新评估受影响 Evidence，失效 PASS 不能复用；不无条件重做无关检查 |
| D-20 | Independent Verify PASS 后当前 Candidate 又改变 | 按 [02](02-multica-delivery-lifecycle-design.md) 的 Verification Gate / Freshness 规则复核，Engineer 不自行覆盖独立 PASS |
| D-21 | Check PASS 但共享工作区 Task Progress Patch 写入结果 UNKNOWN | 回读真实 `tasks.md`，幂等恢复而非覆盖其他 Engineer 任务；此时无需根仓 Git Commit |
| D-22 | Completion Fact 写回失败、重复运行或根仓尚未提交 | 共享工作区和 Evidence 完整可读时，依据当前事实补缺失动作；根仓未提交不阻塞满足条件的 Task Set READY；工作区修改 / 关键 Evidence 丢失则停止并交 Lead |
| D-23 | 正常 Technical Finding 与跨 Contract / Scope Finding | 前者 Targeted Fix；后者停止并明确升级 Workitem Analyst / Human 路径 |
| D-24 | Reviewer Helper / Internal Method 尝试创建隐藏 Agent、Workflow、Task / PR | 禁止 Method Side Effect；父 Project Skill 保持唯一 Dispatcher |
| D-25 | OpenSpec Native Verify / Schema Validation PASS，但实际 Integration / E2E 未执行 | 不能将一致性检查误报为实际独立行为验收 |
| D-26 | Required Checks 无法执行、Gate FAIL 或 UNKNOWN、同类 blocker 反复出现 | BLOCKED / STOP / Escalate，不凭推断放行或无界重试 |
| D-27 | Issue Status 为 `in_progress`，但原始 Human Feedback 要求重新分析 / 再审核 | 不把 Status 当开发批准；核对审批来源与条件，不启动编码 |
| D-28 | 无合法 Human Approval，或 Approval 附加条件仍未满足 | 即使 Analysis Gate / 文件完整，也禁止 Engineering Implementation；报告缺失条件 |
| D-29 | Corrective Change 缺少 Change、Tasks 或必要原生准备结果 | 各缺项单独验证 STOP；不补造分析产物，不静默改用无 Change 路径 |
| D-30 | Corrective 不能本地复现，且缺少足够替代 Evidence / 必需 Regression Signal | 进入有界诊断或阻塞；不能宣称 Regression PASS；只有具备可靠替代 Evidence 才能按授权继续 |
| D-31 | Workitem Analyst 与 Engineer 在不同 Run / 根仓目录，批准 Baseline 缺失、未提交或过期 | 从持久化已批准 Baseline 与受控修订恢复；无法核实身份 / 当前版本则停止，不依赖历史会话 |
| D-32 | Check 尚未 PASS，`tasks.md` 当前 Task checkbox 仍为空 | Code Review 不因未勾选而 FAIL；Check 依据 Engineering Evidence PASS 后才受控 Patch；Patch 回读失败不得发布 READY |
| D-33 | Review Finding 需返工，后续复核完成 | 能从 Finding ID 找到 Severity、Area、Evidence、Suggestion、Resolution 与 Recheck Evidence；无证据不得标记已解决 |
| D-34 | 同一 Delivery 的两个 Task Sets 修改同一个 Repository，尝试分给两个 Engineer | 派工冲突被拒绝 / 阻断；改由同一个 Engineer 承接该 Repository 全部 Task Sets；PR 层不新增跨 Engineer 聚合机制 |
| D-35 | 当前 Task Set Check / Patch / Readback 已通过，根仓 OpenSpec 尚未 Git Commit | 允许发布 Task Set READY；最终根仓 Git Commit 留给父级 Finalize，不能声称 READY 已等于 Git 历史持久化 |
| D-36 | Finalize 时根仓含其他 Delivery 的未提交修改，或最终 Git Commit 失败 / UNKNOWN | 只纳入当前 Delivery 的授权 OpenSpec 变更；不混入其他 Change；不能声称 Finalize 成功，并保留恢复线索 |
| D-37 | Run 继续时未提交 Design / Tasks 修改丢失，或关键 Evidence 不可读（分别验证） | 停止自动推进，由 Delivery Lead 协调恢复；不得仅凭旧 READY 自动重放 checkbox 或宣称完成；恢复后重新核对有效依据 |
| D-38 | Review Snapshot 与业务代码最终 Commit 不一致（含 Commit Hook 修改） | 有实质影响时重做受影响 Review / Validation；无相关影响时复用有效证据，不机械全量重跑 |
| D-39 | Code Review 出现未解决 Blocking Finding，却尝试通过“人工接受风险”改为 PASS | 禁止直接覆盖；仅 Non-blocking Finding 可带风险保留 open，误报需证据后 resolved |
| D-40 | Corrective 可稳定复现与不可稳定复现两种场景 | 前者须有修复前 FAIL / 修复后 PASS；后者有可靠替代 Evidence 和局限说明，否则不能声明 Regression PASS |
| D-41 | 同一 Issue / Repository 原 Engineer 无法继续，需要重新分工 | Delivery Lead 确认旧 Run 已结束，将剩余 `task_refs` 交给唯一新 Engineer；继续使用当前 Issue |
| D-42 | 同一 Repository 的两个 Task Sets 由同一 Engineer 先后实施，后一个尚未完成 | 前一个可按有效证据形成 READY，不冒充最终 Repository PR Candidate；由同一 Engineer 继续处理，不因部分 READY 关闭 Issue |
| D-43 | 同一 Issue / Repository 又接到新 Task Set 或返工 | 复用现有 Issue 和唯一 Engineer；确认旧 Run 已结束并完成交接，不重复启动相同 `task_refs` |
| D-44 | Check PASS 后、READY 发布前 Candidate / 工程契约 / 派工范围发生相关变化 | 不发布 READY，重新检查受影响部分；使用本轮已有事实核对，不新增版本状态机或锁 |
| D-45 | Assigned Task 已获批准取消或被替换 | 保留原 ID 和批准依据，由 Lead 调整派工范围；只检查当前仍需执行的任务，不伪造测试证据或虚假勾选 |
| D-46 | Engineer 只执行已分配 Change-level Verification，本轮没有代码修改 | 引用已有 Candidate 和有效 Review / PR Preparation 事实，保存本轮验证证据；不要求新 Commit / Push 或重复审查；需要改代码时恢复相应工程流程 |
| D-47 | 初始批准基线已提交，研发期间 Design / Tasks / Evidence 尚未最终 Git 提交 | 交接前已保存到持久共享工作区或已有证据载体，后续 Run 可读取；Finalize 统一提交当前 Delivery 的授权变更 |

最低实施验收至少覆盖：一个正常 Corrective Path、一个正常 Intentional Path、一个 Backend / Frontend / Flink 代表性 Task Set、不同 Repository 的并行写入、同仓 Engineer 责任冲突拒绝与交接、一个工程返工、一个 Evidence 失效、一个 PR Preparation 缺项、一个审批 / 基线缺项、Check / Patch / READY 顺序及依据变化、任务取消 / 替换、纯验证无代码修改、根仓最终提交与关键内容丢失时停止处理、一个跨契约 STOP。其他场景可按实现顺序分批补充，但验收状态必须真实记录。

---

<a id="development-appendix-a"></a>

# 附录 A. 最终 Development 执行模型（摘要）

本图是本专业方案的阅读摘要，不维护新的 Delivery Workflow。Analysis Handoff / Task Set 派工与下游 Verify / PR / Finalize 的完整规则请读 [02 §2.3](02-multica-delivery-lifecycle-design.md#delivery-execution-model)。

```text
Delivery Lead（已批准交接 + 当前 Roster）
    └─ 当前 Issue 内 @Engineer + task_refs
                      ↓
             Engineer / development-execution
                      ↓
             Ground / Establish Feedback
                      ↓
             Implementation + Internal Methods（按需）
                      ↓
             Required Task Verification / Local Validation
                      ↓
             Code Review → Targeted Fix（按需）
                      ↓
             必要 Commit / Push → PR Preparation（纯验证无代码修改时复用有效事实）
                      ↓
             Development Evidence（current Candidate）
                      ↓
             Development Completion Check
                      ↓ PASS
             Change-scoped Task Progress Patch / Shared Workspace Readback
                       ↓
             核对检查依据；有相关变化则重新检查受影响部分
                       ↓
             Completion / Evidence Facts → 当前 Issue
             （此时根仓 OpenSpec 允许尚未 Git Commit）
             （共用 Sub-Issue 的全部 required Task Sets 完成后才关闭）
                      ↓
             Parent Delivery / Delivery Lead
                      ↓
             Verification Projection / PR Materialization / Finalize（02 Owner）
                      ↓
             Finalize 统一提交根仓 OpenSpec Git（仅当前 Delivery 授权变更）
```

# 附录 B. 当前决策与核心原则（摘要视图）

此处是当前规则的检索摘要，不作为第二份权威 Contract；遇到跨文档歧义按 [01](01-multica-openspec-design-guideline.md) 的 Document Ownership / [02](02-multica-delivery-lifecycle-design.md) Delivery Lifecycle / [05](05-openspec-schema-implementation-design.md) Schema / [06](06-method-skill-library-implementation-design.md) Methods 的对应条目确认。

| 主题 | 当前决策 |
|---|---|
| Engineer 工作对象 | `change_ref + task_refs + relevant artifact / evidence refs + Multica Runtime Context`；Task Set 是引用范围 |
| 工程入口 | `development-execution`（统一 Project Skill） |
| 专业角色 | Backend / Frontend / Flink Engineer，共用 Execution Model、独立 Domain Skill |
| 方法层级 | `tdd` / `code-review` / `codebase-design` / `verification-before-completion` 是父 Skill 内部 Method，不注册同级 Runtime Skill |
| Development 策略 | Feedback-Driven + 小步实现为优先推荐方法；TDD/诊断方法按适用性选择，专业路径可替代，但必要验证与 Check → Patch → READY 不可跳过 |
| Corrective | 恢复既定行为；合法 `skip_specs`，Root Cause `probable` 可按已批准有界方案开发 |
| Intentional | 规格驱动实现；保留 Existing Specs，Design 按需 |
| Rework | Targeted Fix / Re-validate / Review；实质 Contract 改变返回 Analysis |
| `tasks.md` | Approval 后正文默认只读；已派发编号稳定；checkbox 通过 [05](05-openspec-schema-implementation-design.md) 串行 patch；取消 / 替换项保留依据、退出活跃 checkbox，由 Lead 调整范围，不虚假勾选 |
| Verification | 每个 Implementation Task 有验证；Change-level 按需；执行者为当前明确分派的 Engineer / Verify Agent |
| Local Validation / Code Review | 每个 Task Set 必备；与 `verify_agent.required` 无关 |
| OpenSpec 执行方式 / Native Verify | 使用 `development-execution`，不调用 `/opsx:apply`；Native Verify 依 [05 §9.4](05-openspec-schema-implementation-design.md#section-9-4) 按候选版本与独立性要求执行或复用，不替代真实测试 |
| Development Evidence | 必须形成结构化可恢复的 Result / Evidence Index，关联批准 Contract、Current Candidate、Finding / Review 和实际验证；不创建第三套 Store |
| Completion | Check → Patch / Readback → READY 连续执行；发布前核对检查依据，有相关变化则重新检查受影响部分；不新增版本状态机或锁 |
| Commit / Push | 初始批准基线先提交；Engineer 完成必要业务代码提交；研发 OpenSpec 修改保存在持久共享工作区，Finalize 统一提交；关键内容丢失时停止并交 Lead |
| 纯验证 Task Set | 无代码修改时复用候选版本及有效 Review / PR 事实，不制造新提交或重复审查；本轮必要验证与 Evidence 不省略 |
| PR | 同一 Delivery / Repository 所有 Task Sets 由一个 Engineer 负责完整 PR Preparation，含 TFS / Delivery 关联；不设计跨 Engineer PR 聚合 |
| Issue | 当前唯一交付协作对象；同仓唯一 Engineer，按 `task_refs` 交接，不为普通专业分工另建 Issue |
| 实施待办 | 受控进度脚本、Evidence 字段映射、Method 可读入口与真实运行验收 |
| Decision Owner | Engineer 负责局部技术语义；Deterministic 层负责客观硬条件；Delivery Lead 协调跨角色 / Runtime；Human 负责批准 |

**核心原则**：不重复做需求分析；不修改获批行为来迎合实现；不把 Method 当 Runtime；不把 Task checkbox 当正确性；不把工具 Validation 当实际运行 Evidence；不把独立 Verify Agent 当所有测试的 Owner；失败优先定向修复；无法判断或需要扩大批准范围时停止升级；工程交付结束于有证据、可恢复的当前 Task Set Completion Facts。

# 附录 C. 方法来源与版本说明（非现行执行规则）

- [OpenSpec Apply 工作方法公开模板](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/src/core/templates/workflows/apply-change.ts)；仅作外部方法参考，本项目当前明确**不使用 `/opsx:apply` 执行研发**，派发范围由 `development-execution` 控制。
- [OpenSpec Verify 工作方法公开模板](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/src/core/templates/workflows/verify-change.ts)；其一致性检查不能替代真实 Runtime / Integration / E2E。
- Matt Pocock / Superpowers 方法的具体选型、Vendored / Project-native 方式、上游引用固定与副作用控制以 `06-method-skill-library-implementation-design.md` 为准；04 不另维护一份第三方 Skill 目录或历史决策。
- 版本演进：v1.15 将原 `04-engineer-development-stage-design` 更名为 **`04-engineer-development-design`**，重组为专业过程与实施契约；v1.15.1 修复结构化 Evidence / Finding、Completion Check / Checkbox 时序与负向验收；**v1.15.2** 确认根仓最终 Git 提交（方案 B）、同一 Delivery / Repository 唯一 Engineer Owner，并收敛 Result 时序、Review Snapshot、原生准备准入、Finding Resolution 和 Corrective FAIL → PASS 证据要求。旧版文档不作为本版执行规则。

---

<a id="historical-changes"></a>

# 附录 D. 变更摘要

以下按版本倒序保留修订记录；旧版本中的文件名、规则、职责和实施状态仅反映当时设计，当前执行规则以本版正文为准。

历史记录来源：[v1.15.1 归档](archive/04-engineer-development-design-v1.15.1.md)、[v1.15 归档](archive/04-engineer-development-design-v1.15.md)、[v1.14 归档](archive/04-engineer-development-stage-design-v1.14.md)。v1.13 归档未提供独立变更摘要，故不推测补写。

## v1.15.4 变更摘要

- 对齐 01 的 Outcome First, Bounded Autonomy：Engineer 可在批准范围内修正诊断假设与局部实现路径，但不得自行改写已批准 Proposal；实质推翻 Fix Strategy、Scope 或 Verification Contract 时停止受影响实施并回审。
- 将专业执行图明确为常见方法路径，保留授权、验证、Evidence、Check → Patch / Readback → READY 的不可交换顺序；本次不修改运行时 Agent / Skill / Gate。

## v1.15.2 变更摘要

**本版修订范围**：在 v1.15.1 已确定的 14 章结构内，收敛七项执行契约：根仓 OpenSpec 修改由既有 Finalize 路径**最终统一 Git 提交**；一个 Issue 内**同一 Repository 的 Task Sets 只分配给同一个 Engineer**；明确 Evidence Result 的发布时序、Review Snapshot 与最终 Commit 的对应、原生 Preparation / Validation 准入、Finding Resolution 简化以及 Corrective Regression 证明。其余 Development 方法和职责边界保持不变；不新增 Runtime / Gate / Agent / Artifact。

**本轮确认补充**：方案 B 保持最终统一提交，补充初始批准基线、持久共享工作区和关键内容丢失时停止处理；同一 Delivery / Repository 唯一 Engineer、按需最多一个 Development Sub-Issue；完成发布采用连续步骤与发布前核对；明确批准取消 / 替换任务及纯验证任务的适用条件。关联文档同步暂缓，OpenSpec 原生 Skill / 语义自定义实现和 Native Verify 策略保留 TODO。

## v1.15.1 变更摘要

在 v1.15 已确定的 14 章结构与 Development 架构内，修复 Evidence 结构化交付、Completion Check / Checkbox 顺序、Review Finding 追溯、Diagnostic Method 调用、PR 粒度表述及实施顺序，补齐必要负向验收；不重新开放 Method / Skill 层级、Task 写权限或新的 Runtime / Artifact 设计。

## v1.15 变更摘要

- 将原 `04-engineer-development-stage-design` 更名为 **`04-engineer-development-design`**，重组为专业过程与实施契约。
- 保留既有 Backend / Frontend / Flink Engineer、`development-execution`、三种 Development Mode 与 Feedback-Driven Development；修正 Method / Skill 层级、批准后 `tasks.md` 写权限、PR Preparation 关联事实、Evidence Identity / Freshness、Completion / Progress 顺序，并将 v1.14 分散的专业规则按执行过程重组。不提前定稿 05 的 P0-2 Markdown Parser Contract，不改动 03 七个 Analysis Project Skills，也不新增全局状态机。

## v1.14 变更摘要

- 对齐 `intentional-change` Conditional Design：Engineer 始终消费 Proposal / Specs / Tasks；只有 `design.md` 实际存在时才将其作为正式技术输入并在批准边界内细化，不再把 Design 文件存在作为 Development 前置条件。
- Intentional Code Review 改为“存在 Design 时检查已批准 Technical Decisions 是否落实”；合法省略 Design 不构成缺失输入。
- 正文中的 `OpenSpec Schema Implementation` 硬编码改为稳定的 Task Identity Contract anchor 引用；历史版本摘要中的旧版本号保留为历史事实。
- 同步 Guideline、Delivery、Analysis；不改变 Development Method / Verify / Evidence / Completion 语义。

## v1.12 变更摘要

- 正式定义 `Development Verification = Task-level Verification + Engineer-owned Change-level Verification Task（按需）+ Local Validation`；Code Review、Evidence、Commit / Push、PR Preparation 继续作为 Development Completion 的并列条件。
- Task-level Verification 明确由 Assigned Engineer 负责；Change-level Verification Task 默认可投影给 Engineer，在已批准 Independent Verification 与范围重合时也可由父 Delivery 投影给 Verify Agent。
- CI / script / test runner 明确为 Verification Execution Mechanism，不作为 Task Owner；Engineer 不自行把本应承担的验证转交 Verify Agent。
- OpenSpec Native Verify 不属于每个 Task Set 的 mandatory Development Verification；`verify_agent.required=true` 时由 Verify Agent 执行或复用，`false` 时只在明确要求或 Change-level consistency audit 需要时运行。
- 对齐 Delivery 与 OpenSpec Schema Implementation；Analysis、Guideline 保持不变。

## v1.11 变更摘要

- 对齐 OpenSpec Schema Implementation 与 Analysis：Engineer 不再消费独立 `bug-analysis.md`、AC / VR Identity；Corrective 从 `proposal.md` 读取 Expected / Actual、Root Cause / Fix Strategy / Regression Scope，Intentional 从 Requirement / Scenario 读取 Acceptance Contract。
- `tasks.md` 正式同时包含 Implementation Task 与按需 Change-level Verification Task；每个 Implementation Task 必须有 task-level verification，只有组合后的 Change 才能证明行为时才需要独立 Verification Task。
- Regression / Integration / E2E 统一定义为 Verification Method，不再与 Verify Agent 角色绑定；Engineer / CI 在授权范围内可以执行。
- Verify Agent 收窄为 **Optional Independent Verification Executor**；`verify_agent.required=true` 只表示父 Delivery 需要额外独立验收，不取消 Engineer 的 Task Verification / Local Validation / Code Review。
- OpenSpec Native Verify 定位为 Artifact-to-Implementation Verification，可被工程检查复用，但不替代真实 Runtime Integration / E2E 或 Independent Verify Agent。
- Human Approval 后冻结 top-level `T-xxx` Identity；Engineer 只在受控边界内细化任务描述、Verification procedure 和 checkbox，不并行新增 / 重编号 top-level Task。
- Ground、Code Review、Development Completion、Evidence、Rework 与核心原则同步到 Native Acceptance / Verification Model；不修改 Agent / Skill 实现资产。

## v1.10 变更摘要

- 对齐指导手册的 **Runtime-Centric Delivery（以运行时为中心的交付） + Artifact-Centric Engineering（以工件为中心的工程）** 顶层原则，明确 Engineer 不建立第三套工程输入；本次同版本修订不改变版本号。
- 对齐 **OpenSpec = Engineering Truth / Multica = Delivery Truth**：Engineer 的技术输入以已批准 OpenSpec Change 为准，Multica Handoff Facts 只提供 Route、批准、分工、Verify 等 Delivery Facts。
- Verification Requirements 不再从独立 Structured Result 读取；Corrective 从 Bug Analysis、Intentional 从 Spec / Delta Spec 读取。
- Engineer 不依赖第三套 Analysis Contract Store；跨 Run 交接只需要 OpenSpec 引用 + Multica delivery facts + 必要 Evidence references。
- 本次仅更新设计文档，不修改 Engineer Instructions、Skills、Gate、脚本或 OpenSpec Schema。

## v1.9 变更摘要

- 对齐 Analysis 的 Artifact Model：Engineer 交接输入改为已批准的 **OpenSpec Change + Analysis Handoff Facts + Supporting Evidence / Review Facts**，不依赖 `requirement-analysis.md`、`requirement-review.md` 或 `analysis-package.md`。
- Intentional Development 继续以 Proposal / Specs / Design / Tasks 为正式技术输入；Selected Solution 从 Proposal / Design 与批准后的 Analysis Result 读取，避免重建第二套 Requirement 文档。
- Corrective 继续消费 Bug Analysis / Proposal / Tasks 与合法 Specs done/skipped；AC 与 Verification Requirements 均以 Bug Analysis 为权威；Multica 交接只引用其 AC / VR，并提供 Verify Recommendation / Focus 等 Delivery Facts。
- Verify Agent 输入边界进一步明确：AC 定义验收结果，Verification Requirements 定义必须验证的内容，Verification Focus 定义独立验收重点；`verify_agent.required=false` 仍不取消开发侧验证。
- `intentional-change` 的 Specs / Design 继续是 Required Artifact；只有当前 Schema 明确允许的省略（如 Corrective `skip_specs`）才可作为合法输入，不以“文档精简”放宽 Schema。
- 本次只同步 Development 设计契约，不修改 Engineer Instructions、Skills、Scripts 或其他实现资产。

## v1.8 变更摘要

- 对齐 Technical Change Kind Schema 命名：Corrective=`corrective-change`，Intentional=`intentional-change`；Engineer 只读取 Change 已持久化 Schema，不自行重选。
- `intentional-change` 作为项目级 `sdd-fast` Development Contract：Proposal / Specs / Design / Tasks 全部必需，Design 深度按复杂度伸缩；缺任一 Artifact 不进入正式工程执行。
- `corrective-change` 继续消费 Bug Analysis / Proposal / Tasks 与 Specs done/skipped；独立 Design 不作为默认前置，批准交接引用附加设计时才消费。
- 明确 Apply Ready / CLI exit code 不等于 Human Approval、Engineering Ready 或 Development Complete；Engineer 继续依据批准上下文、当前 Task Set、Validation 与 Engineering Contract 工作。
- 现有项目 `sdd` 不作为当前 `sdd-fast` Engineer 输入 Schema；已有 `schema: sdd` Change 的兼容与未来定位由主方案 / Analysis 统一管理。
- 配套主方案、Analysis、指导手册；本次仅更新设计契约，不发布生产 Schema 或执行真实业务开发。

## v1.7 变更摘要

- 对齐 OpenSpec `1.13.2` 与分型 Schema：Corrective 使用 `corrective`，Intentional 使用 `spec-driven`；Engineer 读取 Change 已持久化 Schema，不重新路由。
- Corrective 输入正式包含 Schema Artifact `bug-analysis`、Proposal、Tasks 和适用 Specs；独立 Design 只在批准交接明确引用时读取，不作为默认完成前置。
- `skip_specs` 只表示本 Change 无 Specs Artifact，不免除既定 Expected Behavior、Regression Signal、Local Validation、Code Review 或 Evidence。
- 其余 Engineering Contract、assigned Task Set 边界、按需 Verify、PR Preparation、Targeted Rework 与跨 Run 交接保持不变。
- 同步主方案、Analysis 与指导手册；本次仅更新设计，未运行自定义 Schema 接入验收。

## v1.6 变更摘要

- 三条自动 Route 共用 Change 生命周期与 Tasks 交接；Engineer 按 Change 中已持久化的 Schema 消费产物，Corrective=`corrective`、Intentional=`spec-driven`。
- Ground 明确跨 Run 的持久化批准基线与接收方当前读取；不依赖 Workitem Analyst 会话，不因缺失准备而重做整轮 Analysis。
- Code Review、Evidence、Development Completion Check 与 Rework 同步到轻量 Change；合法省略不误判失败，必需任务 / 证据缺口不得放行。
- 原有 Local Validation、Code Review、按需 Verify、PR Preparation、角色权限与 Targeted Rework 不变；不新增完整 OpenSpec Review 链。
- 同步主方案、Analysis 与指导手册；仅更新设计，未部署或执行运行验收。

## v1.5 变更摘要

- 更新主方案、指导手册 和当时的 Analysis 阶段设计引用。
- 修正“只维护 Analysis 领域术语”的复制残留，明确 Engineering / Development 专业范围及其与 Multica 原生 Stage 的区别。
- 平台 Assignment、Mention、Instructions、Skills 与 Run 机制统一引用指导手册，保留本阶段完整输入和停止边界。
- Verify 推荐引用 Analysis 专业契约，最终 required 与执行规则对齐主方案，不由 Engineer 按 Route 重新决定；工程方法、Evidence 和历史摘要保留。
- 本次为文档对齐，未更新平台中的 Agent 配置或生成执行 Skill，未运行工程 / Multica 接入验收。

## v1.4 变更摘要

- 同步人工审核语义与研发授权输入：Lead 理解自然语言意见，Engineer 消费明确批准及条件的交接；不以状态值、Gate PASS 或 Agent 自述作为独立批准依据。
- 同步 Workitem Analyst 的需求与问题分析、研发准备定位；Ground 复用明确的目标、场景、规则与验收，关键需求缺口定向澄清，局部实现选择由 Engineer 细化。
- 将 Code Review 明确为公共检查 + Route 专项；Corrective 输入、完成检查及 Rework 不要求 OpenSpec 产物，并同步方法摘要和回归验收，版本号保持不变。
- 将当前 Task Set 的主规格 / Delta、任务范围、开发侧验证及证据引用落实到 Ground、实施、Review 和完成契约，不绑定 Apply 命令。
- OpenSpec 一致性检查融入现有 Code Review；Evidence 能追踪规格场景、任务、实现、验证结果和候选版本。
- Tasks 仅表示工程实现与开发侧验证；当前 Task Set 不等待其他 Task Set 或业务 PR，按实际事实更新任务，不虚假勾选。
- 规格 / 验收要求实质变化时重新判断旧证据，不仅检查代码 Commit 是否改变。
- 修正 §3 / Instructions 中仅限 Squad-owned 与 Mention 的旧规则；统一使用总方案的 Development Completion Check，不维护 Readiness 聚合副本。
- 本次只更新专业设计和验收要求，未生成执行 Skill、部署配置或运行测试。

## v1.3 变更摘要

- `sdd-fast` 从读取 OpenSpec 文档明确为按规格驱动实现，Feedback-Driven Development、TDD、Local Validation 和 Code Review 继续保留。
- 可以调用 `/opsx:apply`，也可以由 `development-execution` 实现相应语义；不绑定特定命令。
- 允许批准边界内的设计细化与任务更新；改变已批准行为、范围、关键约束或验收要求时仍升级，Evidence 体现相关规格场景的实现与验证。

## v1.2 变更摘要

- 同步当时的研发闭环方案与分析技能设计。
- 明确 `sdd-fast` Development 消费 Approved OpenSpec Change，OpenSpec 是版本化 Development Contract，不是新的 Runtime / Workflow Driver。
- `tasks.md` 保持 Implementation Checklist；Engineer 只更新当前 Task Set 相关完成事实，不将 task 机械映射为 assigned Task Set，也不以 checkbox 替代 Engineering Contract。
- `development-execution` 继续作为 Canonical Development Entry；不使用 OpenSpec Apply 建立第二套顶层 Development Workflow。
- 若实现需要改变 approved Spec / Expected Behavior / AC / Scope，Engineer 必须停止并升级。
- 顺带同步当前总方案的 Development Sub-Issue Ownership / Assignment 边界，避免继续引用 v1.4.4 的旧 Squad-owned 规则。
