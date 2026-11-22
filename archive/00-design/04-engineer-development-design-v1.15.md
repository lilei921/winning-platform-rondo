# Engineer Development Design（工程师研发设计方案）

> Version: **1.15**  
> Execution Roles（执行角色）: `Backend Engineer` / `Frontend Engineer` / `Flink Engineer`  
> Professional Outcome（专业目标）: Approved Engineering Contract Implementation（已批准工程契约的实现与验证）  
> Scope: Development 专业过程、Engineer Role Contract、Task Set 接收、Feedback-Driven Development、Implementation / Verification、Code Review、Commit / Push、PR Preparation、Development Evidence、Completion Handoff、Skill / Method 实施与验收  
> Date: 2026-10-09  
> Status（状态）: Design Baseline（实施导向设计基线；不代表对应 Skill / Script 已部署）  
> Upstream Baseline（上位方案）: `01-multica-openspec-design-guideline-v1.16.3.md`、`02-multica-delivery-lifecycle-design-v1.6.6.md`  
> Analysis Baseline（分析输入）: `03-workitem-analysis-design-v1.19.1.md`  
> Related Implementation Baseline（实施契约）: `05-openspec-schema-implementation-design-v1.5.md`、`06-method-skill-library-implementation-design-v1.4.md`

**文档定位**：本文设计 Engineer / Development 的专业过程与实施契约，不是单个 `SKILL.md`，也不是 Multica Delivery Lifecycle（交付生命周期）或新建的 Workflow Runtime。本文沿用 03 v1.19.1 的**实施主题章节结构**，不把专业活动拆成新的 Agent、Run、Multica Stage、Gate 或 Artifact。

**权威归属**：01 维护统一架构、术语与配置约定；02 维护跨角色交付、审批、任务投影、独立验证、PR / Finalize；03 维护需求 / Bug 分析及研发准备；04 维护已批准 Task Set 的工程方法、工程质量、Evidence 和专业交接；05 维护 OpenSpec Schema、Change / Task Identity、写权限、Task Progress；06 维护 Internal Method Module 的组织与来源治理。**同一规则只维护一个 Owner（One Rule, One Owner）**。

**本次对齐范围**：保留既有 Backend / Frontend / Flink Engineer、`development-execution`、三种 Development Mode 与 Feedback-Driven Development；修正 Method / Skill 层级、批准后 `tasks.md` 写权限、PR Preparation 关联事实、Evidence Identity / Freshness、Completion / Progress 顺序，并将 v1.14 分散的专业规则按执行过程重组。不提前定稿 05 的 P0-2 Markdown Parser Contract，不改动 03 七个 Analysis Project Skills，也不新增全局状态机。

## 目录

- [1. 定位、职责与完成标准](#development-section-01)
- [2. Engineer Role 与 Agent Model](#development-section-02)
- [3. Development 输入与 Task Set 契约](#development-section-03)
- [4. Development Execution Model](#development-section-04)
- [5. Ground 与 Feedback](#development-section-05)
- [6. Incremental Implementation 与 Engineering Methods](#development-section-06)
- [7. Development Verification 与 Local Validation](#development-section-07)
- [8. Code Review 与 Targeted Rework](#development-section-08)
- [9. Commit / Push 与 PR Preparation](#development-section-09)
- [10. Development Evidence](#development-section-10)
- [11. Development Completion 与交付回流](#development-section-11)
- [12. 技术决策、异常诊断与停止边界](#development-section-12)
- [13. Agent / Skill / Method 实施结构](#development-section-13)
- [14. Development 接入验收](#development-section-14)
- [附录 A–C：执行摘要、设计决策、方法来源与版本记录](#development-appendix-a)

---

<a id="engineering-stage-scope"></a>
<a id="development-section-01"></a>

# 1. 文档定位、专业职责与完成标准

本方案的核心问题是：**Engineer 如何在已批准的 OpenSpec Engineering Contract（工程契约）及明确 `task_refs` 范围内，正确实现代码、证明当前候选版本满足要求，并把可复核的 Development Ready Facts（研发就绪事实）交回 Multica？**

“Development 阶段”仅指 Delivery Lifecycle 中的专业工作区段，**不对应 Multica 原生 Stage**。一个 TFS Work Item 默认对应一个 Delivery Issue；多名 Engineer、多个 Repository / Task / PR 均不自动生成 Development Sub-Issue。是否创建独立 Sub-Issue 仅按 [02 §7](../02-multica-delivery-lifecycle-design-v1.6.6.md#development-materialization) 的 Runtime Isolation（运行隔离）要求确定。

## 1.1 专业职责与边界

| 专业职责 | Engineer 必须完成的内容 | 不属于 Engineer 的职责 |
|---|---|---|
| 消费工程契约 | 读取当前批准范围、`change_ref`、`task_refs`、适用 Specs / Proposal / Design、验证要求与证据 | 重新决定 Requirement / Route / Schema / Human Approval |
| 工程实现 | 选择局部技术设计、小步编码、建立有效反馈、处理代码问题 | 重新定义已批准的行为、范围或新增未经授权的工程任务 |
| 工程质量 | 每项 Implementation Task 的验证、分配给自己的 Verification Task、Local Validation、Code Review、Targeted Rework | 替代独立 Verify Agent 或自行改变 `verify_agent.required` |
| 工程交付 | Commit / Push、按 Repository 准备 PR 语义、发布有效 Development Evidence | PR Materialization / Status Sync、跨角色聚合、Archive、TFS / Delivery 完成关闭 |
| 异常上报 | 报告证据冲突、范围变化、环境阻塞、缺失输入并提出具体建议 | 自建第二套 Workflow State 或覆盖确定性 FAIL |

**角色边界**：Workitem Analyst 分析“是什么、为什么、应达到什么结果”；Human 批准需求、方案和验收边界；Delivery Lead 安排“谁执行哪些 Task Set”；Engineer 在已批准边界内决定“如何正确实现并证明完成”。Engineer 不依赖 Workitem Analyst 的会话内存，必须读取持久化的批准依据。

## 1.2 Development 完成标准

对**当前被明确分配的 Task Set**（不是整个 Delivery Issue），至少满足：

1. 全部 assigned Implementation Tasks 的实现和各自 Task-level Verification 有效完成；分配给 Engineer 的 required Change-level Verification Tasks 也有有效结果。
2. Required Local Validation 为 PASS；Implementation-oriented Code Review 为 PASS；无未处理 blocking finding。
3. Commit / Push 完成，候选代码、验证结果和 Review Evidence 对应当前版本。
4. 每个需要代码 PR 的 Repository Change 具有完整 PR Preparation；必要的 TFS / Delivery 关联可追溯。
5. Development Evidence 能从 `change_ref`、`task_refs` 追到工程契约、实现位置、执行的验证、Candidate Commit、风险与偏差；无未解决的当前 Task Set blocker。
6. Development Completion Check 判定通过；任务进度经受控写入并回读确认，当前 Task Set Completion Facts 按所选 Runtime Projection 写回。

这里的完成标准**不要求**整个 OpenSpec Change 的所有 Task 同时完成，也**不要求** Engineer 执行由 Verify Agent 拥有的待验收 Verification Task。Engineer-side Completion 与后续 Parent Aggregation、Independent Verification、PR Materialization 分属不同职责。

## 1.3 Engineering Truth 与 Delivery Truth

沿用 01 §1.2 的统一归属：

- **OpenSpec = Engineering Truth**：Intentional Requirement / Scenario、Corrective Expected / Actual / Root Cause / Fix / Regression Scope、Design、Implementation / Verification Tasks、Task Progress 与长期消费的 Engineering Evidence。
- **Multica = Delivery Truth**：批准、Assignment、Issue / Run、Status、Task Set Runtime Projection、Verify Agent Decision、Gate / Completion Facts、PR 生命周期中的交付事实。
- **Reference, not Replication**：`change_ref + task_refs + relevant artifact / evidence refs + Multica Runtime Context` 是交接引用集合，非第三套 Development Contract Store。`Task Set`、`Development Evidence` 的逻辑汇总不自动产生同名持久化对象。

专业方法、Runtime 状态、Artifact 与 Summary 必须分开。具体术语见 [01 §1.4–§1.6](../01-multica-openspec-design-guideline-v1.16.3.md#document-ownership)。

---

<a id="development-section-02"></a>

# 2. Engineer Role 与 Agent Model

## 2.1 专业 Agent 与公共开发模型

正式 Agent 保持：

```text
Backend Engineer    → backend-engineering
Frontend Engineer   → frontend-engineering
Flink Engineer      → flink-engineering
          └─ 都通过 development-execution 完成当前 Task Set
```

`development-execution` 是统一 Project Skill 入口；各领域 Skill 提供技术领域方法，不复制完整 Development Workflow。公共方法的复用与内部模块由 §13 和 06 维护。

## 2.2 Agent Description（展示说明）

| Agent | Description |
|---|---|
| `Backend Engineer` | 负责已分配后端 OpenSpec Tasks 的代码实现、开发侧验证、Code Review、整改及 Development Evidence 交付。 |
| `Frontend Engineer` | 负责已分配前端 OpenSpec Tasks 的代码实现、浏览器与开发侧验证、Code Review、整改及 Development Evidence 交付。 |
| `Flink Engineer` | 负责已分配 Flink / 流处理 OpenSpec Tasks 的代码实现、相关行为验证、Code Review、整改及 Development Evidence 交付。 |

Description 用于 UI / Discoverability（可发现性），不承担完整执行 Procedure。

## 2.3 Agent Instructions 的长期 Role Contract

三名 Engineer 使用同构五段式 Instructions，具体规则不应同时复制到多个 Agent Prompt：

| Section | 必要内容 |
|---|---|
| `Role` | 当前 Delivery Squad 中的专业 Engineer；执行明确分配的 OpenSpec Task Set，不负责交付整体调度。 |
| `Core Responsibilities` | 读取已批准工程契约、Implementation、开发侧验证、Code Review / Finding Fix、Commit / Push、PR Preparation、Development Evidence、Completion Handoff。 |
| `Boundaries` | 不改 Requirement / Fix Contract、不改 approved scope / `task_refs`、不创建 Sub-Issue、不自行决定 Verify、PR Materialization 或 Delivery Completion。 |
| `Execution Principles` | 当前事实优先；Feedback-first、small increments、evidence-first；正确写入受控进度；不重复分析、不猜测批准信息。 |
| `Escalation, Communication & Delivery` | 报告阻塞 / 冲突、当前依据、影响范围、Evidence、下一责任人及所需决定；写回当前 Issue / Sub-Issue 后结束 Run。 |

Agent Instructions 保持稳定和简短；`development-execution/SKILL.md` 维护执行契约，Domain Skills 维护领域方法，Internal Methods 维护单项方法。01 的 Agent / Skill 配置规范为权威来源。

---

<a id="engineering-work-object"></a>
<a id="engineering-input"></a>
<a id="development-section-03"></a>

# 3. Development 输入与 Task Set 契约

## 3.1 工作对象与接收方式

Engineer 的工作对象是明确分配的 **OpenSpec Task Set**：`task_refs` 是一组当前 Change 的 Task 引用，不是独立实体、状态机或新工单。

| Runtime Projection | 入口 | Engineer 完成边界 |
|---|---|---|
| Parent Issue Runtime（默认） | Delivery Lead 在 Squad-owned 父 Issue `@mention` 指定 Engineer + `task_refs` | 完成本轮 Task Set，写回 Evidence / Completion Facts，不关闭父 Issue |
| Development Sub-Issue（按需隔离） | 已物化 Sub-Issue，经 Assignment 启动对应 Specialist | 完成本 Sub-Issue 引用的 `task_refs`；仅按当前授权完成本 Sub-Issue |

同一 Task Set 正常情况下只拥有一个触发入口；已通过 Sub-Issue Assignment 启动，不重复用父 Issue Mention 执行相同 `task_refs`。Engineer 不自行改变 Projection、Sub-Issue Owner 或 Stage；02 §7 是唯一权威。

## 3.2 必备输入

| 输入 | 消费要求 |
|---|---|
| Identity | 当前 Delivery Issue / Sub-Issue、OpenSpec `change_ref`、`.openspec.yaml` Schema、`task_refs` |
| Authorization | 明确的 Human Analysis Approval、Delivery Lead 派发依据及尚未完成的附加条件 |
| Approved Engineering Baseline | 已批准的根仓 Git 基线、适用的后续受控修订、Proposal / Specs / Design / Tasks 引用 |
| Functional / Corrective Contract | Intentional Requirement + Scenario；或 Corrective Expected / Actual / Root Cause / Fix / Regression Scope；相关主规格约束 |
| Verification | 每项 Implementation Task 的验证方式；若当前 Engineer 被分配 Change-level Verification Task，则包含对应任务和执行边界 |
| Scope / Dependencies | 业务目标、Repository Scope、代码允许修改范围、跨仓接口 Contract、当前依赖与 Blocker |
| Context / Evidence | 必需上下文、复现 / 实验事实、环境与测试方法、当前候选实现和已有 Finding（返工时） |

Engineer 必须读取**当前可访问的持久化依据**。不因独立 Run、CLI Session 或目录变化而假定输入自动继承；不为降低 Token 省略会影响正确性的必要读取，也不重新执行整个 TFS Requirement Analysis。

## 3.3 Corrective / Intentional 的输入差异

**Corrective（`bug-fix` / `production-fix`）**：读取 `corrective-change` 的 Proposal（Expected / Actual、Failure Path、Root Cause Status / Evidence、Fix Strategy、Fix / Regression Scope）、`tasks.md`、合法存在的 Specs / Supporting Design。若 `skip_specs: true` 合法，不制造 Spec / Scenario Coverage；若省略独立 Design 且符合 Schema，也不当作失败。

**Intentional（`sdd-fast`）**：读取 `intentional-change` 的 Proposal、当前 Delta Specs 与受影响的 Existing Specs（包括未修改但继续适用的约束）、存在时的 Design、`tasks.md` 与 Acceptance / Verification Contract。Design 合法省略时不补造空白文件。

首次 Preparation 已确定的 Change ID / Schema 不在 Engineer Run 重新选择。`sdd-standard` 当前不属于自动 Development 正常入口。

## 3.4 Approved Task Contract 的读写权限

05 §10–§12 是正式实施级约束；Human Approval 后，Top-level `T-xxx` Identity 冻结。Engineer 默认只读 `tasks.md` 的正文和 Verification Contract。允许的直接写入为**经 05 定义的 deterministic patch** 更新 assigned `task_refs` 的 checkbox；不得由并行 Engineer 自行新增、删除、重编号或复用 `T-xxx`，也不得私自改写 task body / verification requirement。

| 内容 | Engineer 权限 |
|---|---|
| 代码、测试与局部实现方案 | 在已批准范围内直接修改 |
| `design.md`（若存在） | 仅在批准边界内细化 implementation detail，不改变已批准技术决策 |
| `tasks.md` 正文 / Verification Contract | Approval 后默认只读；修改需受控 Analysis / Coordination 路径 |
| Assigned `tasks.md` checkbox | Completion Check 取得有效证据后，通过 05 的串行确定性机制更新 |
| 新 Top-level Task、变更批准范围、Spec / Corrective Proposal 关键事实 | STOP，提交 Goal / Reason / Scope Impact，由 Delivery Lead 协调 Workitem Analyst，必要时重新 Human Review |

`tasks.md` checkbox 不等于 Multica Runtime Status，也不代替真实任务完成证据。05 当前 P0-2 的 Markdown Parser / Task Link Grammar 尚待专项定稿，本文不另定竞争格式。

## 3.5 Rework 输入与停止保护

收到明确 Code Review Finding、Independent Verify Finding 或 Human Engineering Feedback 时，先定位原 Finding、Candidate Commit、当前 `task_refs`、受影响 Evidence 与批准边界；只修复可归属当前 Task Set 的问题。若问题证明 Requirement / Scenario、Expected Behavior、Root Cause / Fix Strategy、Regression Scope 或 Approved Scope 需要实质更改，则停止工程性返工，回到既有 Analysis / Human Review 路径。

---

<a id="development-section-04"></a>

# 4. Development Execution Model（研发执行模型）

`development-execution` 在一次明确的 Engineer Run 中组织专业工作；以下是**工程执行步骤**，不是新增的十个 Multica Stage / Agent Run。

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
10. Development Completion Check → Progress / Completion Handoff
```

**统一方法**：Spec / Corrective Contract 定义要实现什么、怎样证明行为正确；Feedback-Driven Development 定义如何通过小步修改与持续检查收敛。所有自动 Route 共享该执行模型，不引入第二套 Runtime 或独立的 Task State Machine。

## 4.1 Corrective Mode（纠正性修复）

用于 `bug-fix` / `production-fix`，以**恢复既定 Expected Behavior** 为目标，优先消费已批准 Root Cause、Fix Strategy 和 Regression Scope：

```text
Approved Corrective Proposal + Tasks
→ 可行时建立 Failure / Regression Signal
→ Minimal Necessary Fix
→ Regression / Normal / Boundary Verification
→ Code Review → Evidence / Completion
```

不默认重启整个 `bug-analysis`；仅当当前 Root Cause / Fix Strategy 被新证据否定，或无法形成可靠 Feedback / 影响范围失控时进入 §12 的 Diagnostic Escalation。

03 v1.19.1 §7.3 已区分 `confirmed` / `probable` / `unknown` Root Cause：

- `confirmed`：依据已确认的根因和方案实施；仍需验证候选版本。
- `probable`：若 Analysis Gate、必要 Human Review / 条件已满足，且 Fix Strategy 与验证边界可实施，则可按**有界的已批准假设**执行；持续记录剩余不确定性与实际证据，不擅自宣称根因 confirmed。
- `unknown`：不应形成正常可执行的已批准修复基线；收到此类冲突交接时停止并请 Delivery Lead 核对，而不是由 Engineer 猜测修复。

`probable` 不能被机械当作 BLOCKED，也不能被 Engineer 自行当作完全确证；新的反证可能需要返回 Analysis。

## 4.2 Intentional Mode（意图性需求变更）

用于 `sdd-fast`，依据已批准 Requirement / Scenario、Task Verification、存在时的 Design 逐个完成行为切片。可以按当前 Schema 使用 OpenSpec Native Apply，或由项目 Skill 执行等效实现语义；**两者都必须显式限制当前 `task_refs`**，不得把整个 Change 的未分配任务自动领取。原生 Apply readiness 不等于 Multica Human Approval 或 Development Completion。

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

不默认重跑完整 Analysis、全 Change Apply、整个 Development，或创建新 OpenSpec Change。若修复必须越过批准 Scope，则按 §12 停止升级；旧 PASS 与旧 checkbox 不代替新候选代码所需的新证据。

---

<a id="development-section-05"></a>

# 5. Ground（建立事实基线）与 Establish Feedback（建立反馈）

## 5.1 Ground 的最小判定

开始主要实现前，Engineer 应确认：当前 Task Set 获得有效批准与派工；Change / Schema / `task_refs` 与根仓基线一致；必要 Dependencies 满足；目标 Branch / Repository 可操作；当前 Acceptance 与 Verification Contract 可读取；既有 Evidence 对当前版本仍有效。缺失必要批准、身份或材料时停止，不靠猜测补齐。

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
→ Compare before / after evidence
→ Check relevant normal / abnormal / boundary cases
```

不能复现时可使用可靠日志、Trace、失败测试、生产运行记录等替代证据，并标注局限。不能将“无法本地复现”直接等同于“根因未知”，也不能在缺乏任何可信 Signal 时宣称 Regression PASS。

---
<a id="development-section-06"></a>

# 6. Incremental Implementation（增量实现）与 Engineering Methods（工程方法）

## 6.1 实现原则与 Engineer 自主权

统一采用 Incremental Vertical Implementation（增量垂直切片）策略：

```text
Small Behavior / Small Change
→ Focused Feedback
→ Next Small Change
→ Focused Feedback
```

避免一次修改大量文件、最后才执行完整构建。Engineer 在批准边界内自主选择类 / 函数拆分、局部算法、模块内部结构、测试组织、非 Contract 级重构与必要依赖调整；不得因此改变 Requirement / Scenario、Approved Root Cause / Fix Strategy、External Contract、Repository Scope 或 Current Task Set。

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

## 6.4 Diagnostic Method 的条件性使用

Development 正常入口不执行一轮完整 `bug-analysis`。需要诊断时，由当前父 Project Skill 负责 Method Dispatch（方法调度），调用必要的 `diagnosing-bugs` 方法内容，得到 Finding / Evidence / 影响范围，再决定继续或升级；Internal Method 不修改 Multica Status、不新增 Agent 或 Issue、不直接重写 Corrective Proposal。

06 当前将 `diagnosing-bugs.md` 的主要实现放在 `bug-analysis/methods/`，同时允许 Development escalation 复用其方法。实现时必须采用**明确的父 Skill 复用接口**（例如可读取的只读方法引用或受控内置副本），保持单一方法规则归属；在具体 Skill 落地前，不假定已经存在跨 Skill 自动调用机制，不把 `diagnosing-bugs` 重新注册为顶层 Multica Skill。可复用方式由 06 的小范围实施补充最终确认。

## 6.5 `verification-before-completion`（完成前验证纪律）

在声明 Local Validation PASS、Task Complete 或 Development Ready 之前，必须核对 Claim 与当前 Candidate / Contract 的 Evidence：实际执行 / 有效读取哪些检查、结果是什么、哪些 Claim 仍缺证据。它是父 Skill 内部 Method，**不是** Independent Verify Agent，也不能自行决定 `verify_agent.required`。

Methods 的 `Use When / Input / Output / Allowed Effects / Forbidden Effects / Stop` 以及 Project-native / Vendored（内置副本）治理，以 [06](06-method-skill-library-implementation-design-v1.4.md) 为权威；本节维护的是 Engineer 何时选择方法、哪些质量目标不允许被省略。

---

<a id="development-section-07"></a>

# 7. Development Verification（开发侧验证）与 Local Validation（本地验证）

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

## 7.2 Required Local Validation

每个 assigned Task Set **必须**根据当前工程内容执行适用的：Targeted Test、Relevant Regression、Build / Compile / Type Check、Lint / Static Check、Required Runtime / Contract Check；选择与现有项目工具对应的实际命令和环境，不机械要求所有类型代码都执行同一命令。

完成后记录检查名称、实际方式、结果、关键 Evidence、Candidate Commit、适用范围与必要的失败说明。存在无法执行的 required check 时，不得把其隐式视为 PASS；依据已批准 Contract 判定 BLOCKED / UNKNOWN 并升级。允许先做较窄 Focused Test，再根据变更风险执行必要扩大范围的 Check；不能仅有 Building Evidence 而遗漏 Behavior Evidence。

## 7.3 OpenSpec Native Validation / Verify 与 Verify Agent 的区别

| 能力 | 定位 | 不等于 |
|---|---|---|
| OpenSpec Validation | Artifact / Schema / Change 原生结构与语义约束的校验 | Human Approval、实际运行行为验证 |
| OpenSpec Native Verify | Change-level Artifact-to-Implementation Consistency（工件与实现一致性）检查 | 每个 Engineer Task Set 默认必跑、独立 Verify Agent、真实 E2E 运行证明 |
| Task / Change-level Verification | `tasks.md` 中定义的工程行为检查，可采用 Regression / Integration / E2E 等方法 | 固定由 Verify Agent 执行 |
| Independent Verification | `verify_agent.required=true` 时，Verify Agent 对固定候选版本执行独立行为验收 | Engineer Self Review、Local Validation |

OpenSpec Native Verify 可在 Project / Change Contract 明确要求、变更级一致性审计有价值时按需执行或复用，但不人为增加每个 Task Set 的固定必经步骤；无论使用哪一种工具，真实行为要求仍需对应的可观察 Evidence。父级 Independent Verification 的准入、结果和 Gate 见 [02 §9](../02-multica-delivery-lifecycle-design-v1.6.6.md)。

## 7.4 Verification Evidence 的最低要求

每项 Required Verification 应可回答：

1. 依据哪个 `task_ref`、Requirement / Scenario 或 Corrective Expected / Regression Scope？
2. 对哪个 Repository Candidate / Contract / Environment 执行？
3. 实际采用什么命令、测试、浏览器操作、运行记录或其他可复核方法？
4. 结果 PASS / FAIL / UNKNOWN 的证据位置和失败限制是什么？
5. 如果复用既有 Evidence，为什么它对当前 Candidate 与 Contract 仍有效？

这里定义**内容要求**，不新增 `VR-xxx`、`verification-requirements.md` 或独立 Coverage Store。精准 parser-level 引用格式仍由 05 P0-2 后续定稿。

---

<a id="engineering-code-review"></a>
<a id="development-section-08"></a>

# 8. Code Review（代码审查）与 Targeted Rework（定向返工）

## 8.1 必备定位与双轴审查

Code Review 是 Engineer Development 的 **implementation-oriented mandatory quality mechanism（面向实现的必备质量机制）**。所有 Route、所有 assigned Task Set 都要进行，不因为 Verify Agent 将来可能参与就跳过。

保留两条独立 Review Axis：

| Review Axis | 核心问题 |
|---|---|
| Specification / Fix Alignment（规格 / 修复一致性） | 实现和当前批准 Task / Requirement / Corrective Proposal 是否一致、是否有可追溯验证、是否越界？ |
| Engineering Standards（工程标准） | 代码是否符合 Repository Conventions、复杂度、重复、错误处理、可维护性、安全、测试质量和回归风险要求？ |

双轴判断可分别产出 Findings，避免代码风格 PASS 就忽略 Contract 偏差，或规格一致就忽略工程质量问题。06 的 `methods/code-review.md` 负责具体 Method Procedure；本节定义不可省略的 Review Contract。

## 8.2 Specification / Fix Alignment 的检查

**公共检查**：当前 Diff 与 `task_refs` / Approved Scope 对应；每项 Implementation Task 具备有效验证；已分配 Change-level Verification Task 有 Evidence；没有未解释的 Scope Drift / Stale Evidence；任务进度与事实一致（不能以 checkbox 替代验收）。

**Corrective**：修复是否针对已批准 Root Cause / Fix Strategy，Expected Behavior 是否恢复，Regression Scope 是否覆盖；合法 `skip_specs` 不伪造 Spec Coverage，有 Delta 时适用 Requirement / Scenario 仍应成立；对 `probable` 的残余不确定性给出真实说明。

**Intentional**：是否符合已有和新增 Requirement / Scenario；存在时是否遵守 `design.md` 中批准的技术决策；是否遗漏 Spec 场景、外部兼容性规则或 Verification Task；不得为适配代码擅自修改规格。

**Rework**：核对 Finding 对应任务和当前 Candidate，检查修复确实解决原问题，未引入新的越界或必要验证缺口。

## 8.3 Engineering Standards 检查

至少从当前 Diff 适用的维度检查：Repository Conventions、Complexity、Duplication、Contract Risk、Error Handling、Test Quality、Regression Risk、Maintainability、Safety / Security。专业规则可来自相应 Domain Skill 和项目约定，不为无关文件扩大 Review Scope。

Code Review 可由 Engineer 自审、受控只读 Reviewer Helper 或其他已授权检查机制辅助，但**不能因调用 Reviewer 而出现隐藏的持久化 Development Owner、Sub-Issue、Run 或额外 Workflow**；不得直接套用外部 Method 默认的 parallel subagent topology。

## 8.4 Findings 与定向修复

Review 结果至少包含 `PASS | NEEDS_FIX | UNKNOWN`、固定审查基线、双轴 Findings、阻塞项、Code / Task / Contract 引用及必要 Evidence。`NEEDS_FIX` 时：

```text
Finding → Affected Scope → Targeted Fix
→ Affected Task Verification / Local Validation
→ Re-review → Refresh Evidence
```

不默认重跑整个 Task Set / Change。若 Finding 实质否定已批准 Expected Behavior、Root Cause、Requirement / Scenario 或 Approved Scope，则不是 Engineer 可自行解决的代码修复，必须走 §12 的 Analysis / Human Escalation。

`PASS` 仅说明当前 Candidate 的 Engineering Review 条件满足；不代替真正的 Runtime / Integration / E2E Evidence，也不代替 Independent Verification。

---

<a id="development-section-09"></a>

# 9. Commit / Push 与 PR Preparation（PR 准备）

## 9.1 Git / Candidate Commit Contract

Engineer 负责为当前 Task Set 的业务代码变更完成必要 Commit / Push，保留当前 Repository、Source / Target Branch、Candidate Commit 与实际修改的对应关系。不提交未经授权的其他 Task Set 改动，不将根仓 OpenSpec Engineering Artifact 作为新的独立业务 PR。

对根仓内本次获准的 Design 实现细化或任务进度修改，遵循 02 / 05 的 Git Baseline 和受控写入规则；不同仓库的代码变更分别形成 Repository Change。提交后如果 Code / Test / Contract 出现实质变化，应重新检查所依赖的 Evidence Freshness（证据时效性），不能自动沿用旧 Commit 对应的 PASS。

## 9.2 PR Preparation 与 PR Materialization 分离

```text
Engineer = PR Preparation（代码修改的语义准备）
Script / Project Capability = PR Materialization（确定性创建与幂等关联）
PR Status Sync Agent = 外部终态同步与按条件 Finalize
```

Engineer 在 Development Ready 前，应为每个 required Repository Change 提供至少：

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

Engineer 负责 PR Title / Description 的技术语义、Change Summary、影响范围、测试与风险说明；Schema 中 `associations` 仅表明必需可追溯的输入关系，不要求在 Multica 复制已有 TFS 来源事实，真正字段映射由 `pull-request` 的实施契约确定。

Engineer **不执行** PR API 创建、幂等 Reconcile、外部 Provider 身份判定、Review 状态同步、PR Merge 或 Delivery Finalize。每个实际代码 Repository Change 对应仓库级 PR；多个 Repository / PR 不自动产生多个 Development Sub-Issue。

## 9.3 PR Preparation 的完成条件

当前 required Repository Change 已固定 Candidate Commit；PR Title / Description 有明确内容或持久可读引用；必要 TFS Work Item / Delivery Issue Association 可解析；Scope、Build / Test Evidence 和风险说明与当前 Candidate 一致。缺少必需字段，不得以“父 Issue 中可以猜出来”为由直接宣称准备完整。PR Materialization 的最终准入仍以 02 §10 为准。

---

<a id="engineering-evidence"></a>
<a id="development-section-10"></a>

# 10. Development Evidence（研发证据）

## 10.1 证据的作用与归属

Development Evidence 要证明**某个已批准工程契约范围，在某个当前候选代码版本上，实际完成了哪些实现与验证**。它是工程事实 / Evidence References 的逻辑汇总，不自动形成新的 `development-evidence` 领域身份、任务状态机或独立 Contract Store。

Engineer 可以根据 Project Skill 的实施选择结构化结果、Multica Run / Issue 的最小引用与必要 Supporting Artifact / 原始 Test Report 的组合；技术证据优先留在代码仓、OpenSpec 或适当 Supporting Artifact，Multica 只持有本次 Task Set Result、定位引用与当前运行事实。汇总 `READY | BLOCKED | UNKNOWN` 表示当前 Task Set 专业交付结果，不是新的全局 Status Key。

## 10.2 最小逻辑 Evidence Contract

| Evidence 维度 | 最小要求 |
|---|---|
| Scope Identity | 当前 `change_ref`、Assigned `task_refs`、当前 Issue / Sub-Issue 引用 |
| Approved Contract | 已批准根仓 Baseline、必要后续受控修订、Relevant OpenSpec Artifact / Acceptance / Verification Refs |
| Candidate | 受影响 Repository、Branch、Candidate Commit（可跨多个 Repository） |
| Implementation | 具体修改摘要及主要实现位置、影响范围、非 Contract 级设计细化 |
| Verification | 每个 assigned Task 及 required Check 的方法、结果、Evidence Reference、执行版本与关键失败说明 |
| Code Review | 固定审查基线、双轴 Review 结果、Blocking Finding、整改与复核状态 |
| Deviations / Risks | 已批准的例外、风险、未解决事项以及对完成的影响 |
| PR Preparation | 每个 required Repository Change 的准备事实或稳定引用 |

**示例**（逻辑形态，不新增独立实体；字段名非 Parser Contract）：

```yaml
development:
  result: READY | BLOCKED | UNKNOWN
  change_ref: <existing-change-ref>
  task_refs: [T-001, T-002]
  runtime_ref: <current-issue-or-subissue>
  approved_baseline_ref: <git-commit-or-approved-reference>

  repositories:
    - repository: <repo>
      source_branch: <branch>
      target_branch: <branch>
      candidate_commit: <commit>
      implementation_refs: [<code-ref>]

  verification:
    - task_ref: T-001
      contract_refs: [<existing-openspec-ref>]
      method: <actual-test-or-check>
      result: PASS | FAIL | UNKNOWN
      evidence_ref: <actual-output-ref>
      candidate_ref: <matching-repo-commit-ref>

  local_validation:
    result: PASS | FAIL | UNKNOWN
    checks_ref: <validation-evidence-ref>

  code_review:
    result: PASS | NEEDS_FIX | UNKNOWN
    findings_ref: <review-findings-ref>

  deviations_ref: <approved-deviations-if-any>
  known_risks_ref: <risk-ref-if-any>
  blockers_ref: <blocker-ref-if-any>
  pr_preparation_ref: <required-per-repository-facts-ref>
```

`contract_refs` 直接指向现有 OpenSpec Requirement / Scenario、Corrective Proposal 中的稳定语义位置或 `T-xxx`，不得新造 `AC-xxx` / `VR-xxx` 或使用 `Acceptance Contract-01` 作为平行身份。05 P0-2 尚未确定的引用 Grammar 不在这里预先定稿。

示例中的字段不能被误解为新建持久化 `TaskSet`、`EvidenceStore`、`Unit` 或独立批准版本。是否需要独立 Evidence Markdown 按实际长期保存需求判断；**不能仅因 `development-execution` 运行就强制生成同名文件**。

## 10.3 Evidence Freshness（证据时效性）

Current Evidence 应与当前 Candidate / Contract / Execution Context 可验证地对应：

- **代码变化**：Candidate Commit / Changed Files 变化时判断受影响验证与 Review 是否需要重做。
- **契约变化**：Requirement / Scenario、Corrective Expected / Regression Scope、Task Verification 或批准范围实质变化，即使 Commit 不变也要重评既有 PASS。
- **环境变化**：影响验证有效性的 Runtime、数据、Dependency、Config、Schema 或 Test Environment 变化时，补充实际检查或明确 Evidence 局限。
- **返工变化**：只更新受影响 Task / Repository 的证据，不因为无关任务变化而盲目废弃全部证据，也不能复用已被推翻的 PASS。
- **Independent Verify PASS**：其是否失效及是否需要重验由 02 §9.7 / Verification Gate 判定；Engineer 只报告 Candidate 与事实变化，不能自行覆盖独立结论。

**不能声称执行了实际未执行的检查**，不能以“Review 很可能没问题”“此前某次 Run 通过”替代当前可复核证据。`COVERED` 只有在能追到实际实现与验证时才有意义。

## 10.4 Publish / Handoff

成功或阻塞都应写回当前 Issue / Sub-Issue 可恢复的最小 Result、相关 Evidence / Commit / PR Preparation 引用和下一步必要动作。Summary 可从现有 Engineering / Delivery Truth 渲染；不产生新的独立数据 Owner。实际 `development-contract.md`、`development-evidence.md` 模板与校验器在 §13 实施，但模板只表达输出格式，不替代本节及 05 / 06 的权威定义。

---

<a id="engineering-completion"></a>
<a id="development-section-11"></a>

# 11. Development Completion（研发完成）与交付回流

## 11.1 当前 Task Set 的 Development Ready

`Development Ready` 是当前 Task Set 的结果事实，不是 Multica Issue 的另一个永久状态，也不是整个 Delivery 的聚合结果。必要条件如下：

```text
Assigned Task Implementation Complete
+ Assigned Required Task / Change-level Verification Evidence valid
+ Required Local Validation PASS
+ Code Review PASS / No unresolved blocking findings
+ Commit / Push & Candidate Identity complete
+ PR Preparation complete for affected Repository Changes
+ Development Evidence traceable and current
+ No unresolved Task Set blocker
```

Engineer 不负责将父 Delivery `done`、决定是否启用 Verify Agent、创建 PR 或完成 TFS 回写。独立 Verify-Agent-owned Change-level Tasks 允许在当前 Engineer Task Set 完成时保持 pending；全 Change 的 PR / Finalize 准入由 02 的 Parent Delivery 负责。

## 11.2 Development Completion Check 与 Task Progress 更新

02 §8 定义 `Development Completion Check` 的业务硬条件；05 §11 定义 `update-task-progress.py` 等确定性任务进度写入契约。04 不创建 `Development Readiness Check`、第二套完成状态或另一个中央 Task Writer。

正常完成顺序（同一个 Engineer Run 内可完成，不新增 Stage / Run）：

```text
Engineer 完成 Implementation / Verification / Review
→ 固定 Candidate Commit / PR Preparation
→ 生成当前有效 Development Evidence
→ Development Completion Check（核对当前 assigned Task Set）
   FAIL → Targeted Rework / Blocked（不得标记 Task Complete）
   UNKNOWN → Report / Escalate（不得隐式 PASS）
   PASS → 调用 05 的受控 Task Progress Patch
→ 在 Change-scoped Single-writer Critical Section 内更新
→ 回读 tasks.md，核对已分配 Task Ref 的 checkbox / identity
→ 写回当前 Task Set Completion Fact / Evidence Ref
→ 结束本轮 Run
```

**并发保证**：多个 Engineer / Verify Agent 可以并行实现或验证，`tasks.md` checkbox 最终持久化必须经过 change-scoped serialized write；写入结果未知时以读取当前真实文件并校验 `task_refs` 恢复，不能盲目重试覆盖其他人的进度。Engineer 不直接在共享文件上并行重写 checkbox，也不通过完成标记宣称工程行为已通过。

`Development Completion Check` 校验 Contract 和 Evidence，不只是文件存在与字段非空；真正专业正确性仍以代码 / 测试 / Review 的实际结果支撑。原生 OpenSpec Validation 或 checkbox PASS 不能替代此 Check。

## 11.3 Parent Issue Runtime / Sub-Issue 的不同完成动作

| Runtime Projection | Check PASS 后的动作 | 禁止动作 |
|---|---|---|
| Parent Issue Runtime | 回写 `task_refs` 对应 Completion / Evidence Facts，通知或允许父级接收结果 | 因单个 Task Set 完成就将父 Delivery 置为 `done` |
| Development Sub-Issue | 依据已授权范围使当前 Sub-Issue 完成并由 Multica 原生 Parent / Stage 回流 | 擅自更改父级 Owner、Stage / Dependency 或全 Delivery 状态 |

如果当前 Task Set 已有有效完成事实，重复 Mention / Assignment 不应重新执行整轮 Development。若候选代码或契约发生实质变化，则需要重新判断该完成事实的有效性；具体 Resume / Aggregation、依赖和状态规则以 02 §7–§9 为准。

## 11.4 与后续 Independent Verification / PR 的接口

Engineer 交付的最小事实应足以让父级判断：哪些 required Implementation Tasks 完成，哪些 Change-level Verification Tasks 由 Engineer 完成，哪些是被批准交给 Verify Agent 的 pending 项；Candidate Commit Set / Evidence 是否可用，PR Preparation 是否齐全。父级才决定是否开展 Independent Verification 及 PR Materialization。

不得把 `Local Validation`、`Code Review`、`OpenSpec Native Verify` 或 `Change-level Verification Task` 一律解释为 Verify Agent 活动；也不能以 `verify_agent.required=false` 取消必要的组合验证。02 §9–§12 是后续唯一生命周期权威。

---

<a id="development-section-12"></a>

# 12. Engineer 技术决策、Diagnostic Escalation（诊断升级）与停止边界

## 12.1 可以自主决定的 Engineering Semantic Work

在当前批准 Contract 范围内：局部算法 / 类与函数拆分、内部数据结构与组件组织、测试策略 / Feedback Technique、局部修复与非契约级重构、实现过程中的 Code Review 判断、适用 Internal Method 选择。

不得擅自改变：Approved Expected Behavior、Requirement / Scenario、Root Cause / Fix Strategy / Regression Scope、External Contract、Repository / Development Scope、Assigned Task Set、已批准的 Verification Task、Runtime Projection 或 Human Approval 条件。

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

该过程借助 §6 所述受控 Debugging Method，仅产生当前 Finding / Evidence；不在 Development 中默认生成新的 Corrective Proposal、重复执行完整 Requirement Analysis 或扩张 Scope。**单纯 `root_cause.status=probable` 不构成必须重分析**；只有新事实影响已批准 Fix Strategy / Scope / Verification 正确性时才需要实质升级。

## 12.3 STOP / BLOCKED / UNKNOWN 与责任人

| 情况 | 本轮处理 |
|---|---|
| 当前批准、身份、必要 `task_refs` / Context 缺失 | STOP；说明缺失事实，交 Delivery Lead 核实或补充分派 |
| Requirement / Scenario / Expected / Fix / Regression Contract 冲突或必须修改 | STOP；提供影响与证据，由 Delivery Lead 协调 Workitem Analyst / Human |
| 未批准 Task / Repository 扩围、需要新增 `T-xxx` | STOP 当前自动扩围；报告 Goal / Reason / Impact，走受控 Analysis / Coordination |
| 环境、权限、依赖导致安全实现或必需验证不能完成 | BLOCKED；记录错误、重现条件和所需外部动作 |
| Deterministic Check / Identity / Evidence 返回 UNKNOWN | 不假装通过；提供现有事实，由 Delivery Lead 协调排障 / Human |
| 明确的 Gate / Check FAIL | 不覆盖 FAIL；能归因的局部修复继续 Targeted Rework，不能归因时升级 |
| 多轮相同 Finding / Blocker 无法收敛 | 停止无界重试；提供历史尝试和 Evidence，交 Delivery Lead |
| 当前 Finding 可在已批准边界内修复 | Targeted Fix → Affected Verification → Review → Evidence Refresh |

重要交接至少包含 Current Facts、具体冲突 / 决定点、Evidence References、受影响 `task_refs` / Repository、建议及下一责任角色。升级不等于 Engineer 自主修改 Issue Status；具体状态、下一 Agent / Human 通知和重试次数由 02 维护。

## 12.4 Deterministic 与 Semantic 的责任边界

- **Engineer Semantic Decision**：实现和局部设计选择、Feedback / Review 策略、Finding 判断、诊断假设。
- **Deterministic Script / Check**：Identity / `task_refs` 校验、完成硬条件、required Evidence 存在性、Task Progress 串行 patch、PR Preparation 字段完整性等可客观判断的事实。
- **Delivery Lead**：成员分工、跨角色 / 跨仓语义、Scope / Runtime Projection 异常、必要 Human 决策。
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

# Analysis 已有：bug-analysis/methods/diagnosing-bugs.md
# Development Diagnostic Escalation 按 §6.4 / 06 受控复用，不新建顶层诊断 Skill。
```

`development-execution` 是公共专业入口、Context Assembly（上下文组装）、Method Dispatcher（方法调度器）、Evidence Publisher 和 Completion Handoff 的 Owner。`backend-engineering` / `frontend-engineering` / `flink-engineering` 是各专业 Project Skills，只提供技术领域约束 / Feedback / Pattern，不重复一套完整执行 Procedure。

## 13.2 Agent × Project Skill 的推荐绑定

| Agent | 必绑 / 主入口 | 专业 Domain Skill | 不应直接绑定为独立 Runtime Skill |
|---|---|---|---|
| Backend Engineer | `development-execution` | `backend-engineering` | `tdd`、`code-review`、`verification-before-completion`、`diagnosing-bugs` |
| Frontend Engineer | `development-execution` | `frontend-engineering` | 同左 |
| Flink Engineer | `development-execution` | `flink-engineering` | 同左 |

Method 文件不是 Workspace / Agent 可独立调用的顶层 Skill，不含独立 Multica Agent Binding、Run、Issue Assignment、PR / Archive Side Effect。06 v1.4 为 Method Library 的唯一治理与实现依据。

## 13.3 `development-execution/SKILL.md` 最小执行契约

建议实际 Skill 只说明：`Use When`、`Inputs`、`Preconditions`、`Procedure`、`Outputs`、`Stop / Escalation`、内部 Methods / References；不要把本设计文档、第三方历史讨论、全部官方手册复制进去。

```text
Use When: 当前 Engineer 收到明确授权的 Task Set / 有界 Rework
Input: change_ref + task_refs + approved baseline + artifact/evidence refs + runtime context
Check: identity / authorization / scope / required evidence / dependencies
Procedure: Ground → Feedback → Implement → Verify → Review → Commit / Push
           → PR Preparation → Evidence → Completion Check / Progress Handoff
Output: Development Result + Evidence Ref + Commit / PR Preparation Facts
Stop: contract drift / permissions / required checks missing / Gate FAIL or UNKNOWN
```

Method Dispatch 由父 Project Skill 决定：行为可自动测试时用 `methods/tdd.md`；重要局部代码设计决策时按需用 `methods/codebase-design.md`；候选实现可审查时用 `methods/code-review.md`；声明完成前用 `methods/verification-before-completion.md`。Methods 不能私自继续调用其他 Method、Agent 或 Workflow。诊断升级采用 §6.4 的显式复用接口。

## 13.4 Domain Skills 的专业内容与边界

**`backend-engineering`**：Java / Spring、API / Service / Domain Layer、Persistence / Transaction、Database Migration、Backend Test / Contract Strategy、错误处理与兼容性。

**`frontend-engineering`**：Vue、Component / State / Routing、Type System、Browser Interaction、表单 / 错误状态、组件测试、E2E / Build。

**`flink-engineering`**：Flink Job、Stream / Event Processing、State / Timer / Watermark、Schema Compatibility、Checkpoint / Recovery、Flink Test Harness。

Domain Skill 负责“这个技术领域如何正确实现”；`development-execution` 负责“当前 Task Set 如何完成工程闭环”。Domain Skill 不决定 Route、Human Review、Runtime Projection、Sub-Issue、PR Materialization 或 Delivery Completion。

## 13.5 Script / Template / Evidence 最小责任

| 资产 | Owner / 用途 | 不承担 |
|---|---|---|
| `development-contract.md` | 当前 Task Set 的输入 / 输出 / Stop 参考契约 | 复制批准的 Specs、Task Body 或 Runtime State |
| `development-evidence.md`（模板） | 必需证据字段 / 引用的输出形态 | 新的独立 Acceptance / Verification Identity 或生命周期 |
| `validate-development-evidence.py`（按需） | 判断必需字段 / 引用 / 结构完整性，返回 PASS / FAIL / UNKNOWN | 判定主观代码语义是否正确、替代 Review / Testing |
| `update-task-progress.py`（05 Owner） | 对 assigned Task checkbox 受控且串行 patch | 修改 Task Body、生成工程计划、创建 Runtime State |
| `Development Completion Check`（02 Owner） | 判断当前 Task Set 的完成硬条件 | 聚合整个 Delivery、独立验证、创建 PR、替代专业 Evidence |

不引入全局 `method-library.yaml`、Method Registry、Method Run State、`tdd-result.md`、`debugging-result.md`、`method-result.json`、`development-plan.md` 等并行对象。只有实际需要长期留存的 Evidence 才作为 Supporting Artifact 保存。

## 13.6 实施落地顺序

1. 配置 Backend / Frontend / Flink Engineer Description / Instructions 与明确的 Project Skill 绑定。
2. 实施 `development-execution/SKILL.md` 的输入读取 / 授权 / Task Set Scope / 停止契约；接通批准根仓 Baseline。
3. 实施 Required Verification、Code Review 和当前 Candidate 的 Evidence 产生与回读。
4. 对齐 05 的 Change-scoped Task Progress Patch 与 02 的 Development Completion Check / Parent 回流。
5. 补齐 Commit / Push、PR Preparation（含 TFS / Delivery 关联）和异常恢复。
6. 按 06 放入内部 Method / Domain Skills，按需完善开发诊断复用接口。
7. 实施 §14 的正向、负向、并发与恢复测试；未验证的设计不得在说明中标记为已部署。

---

<a id="development-section-14"></a>

# 14. Development 接入验收（Acceptance Tests）

本章定义设计目标的**实施验收场景**，不是本次文档编辑已运行的真实环境测试。所有结果应可从 Engineer Run、当前 Repository、OpenSpec Change / Tasks、Multica 当前事实与 Evidence Reference 复核。

| ID | 场景 | 期望结果 |
|---|---|---|
| D-01 | Parent Issue 中 `@Backend Engineer + task_refs` | 仅实现当前 assigned Task Set，完成后不误关父 Delivery |
| D-02 | 独立 Development Sub-Issue 通过 Assignment 启动 | 不依赖父 Issue 再次 Mention / 前一 Agent Session，按授权完成 Sub-Issue |
| D-03 | 相同 `task_refs` 重复通知 / 分派 | 已有有效完成事实不重跑整轮；无双重写入或重复 Side Effect |
| D-04 | 两个 Engineer 并行更新同一 `tasks.md` 的不同任务 | 各自仅修改 assigned checkbox，change-scoped critical section 无 lost update |
| D-05 | Human Approval 后 Engineer 企图新增 / 变更 `T-xxx` 正文 | 拒绝直接修改，记录 Goal / Reason / Impact，走受控 Analysis / Coordination |
| D-06 | Corrective 合法 `skip_specs: true` 或 Design 缺省 | 根据 Proposal / Tasks 修复验证，不伪造 Spec 或空 Design |
| D-07 | `root_cause.status=probable` 但已获批准且修复边界充分 | 按批准 Fix Strategy 有界开发，记录残余不确定性与回归证据，不擅自升级为 confirmed |
| D-08 | `root_cause.status=unknown` 或已有根因证据被代码事实推翻 | 停止正常实现，向 Delivery Lead 报告具体矛盾并返回 Analysis 边界 |
| D-09 | Intentional Design 合法省略，或 Diff 只读 Delta 漏掉原主规格约束 | 不要求空 Design；Ground 读取相关 Existing Specs 并保持既有兼容条件 |
| D-10 | Native Apply 返回 Change 全部未完成 Tasks，但当前 Engineer 只负责一部分 | 只执行当前 `task_refs`；不扩大为全 Change 或替代其他 Engineer |
| D-11 | 适用 TDD Method | RED / GREEN / Refactor 有实际 Behavior Evidence；Method 不新增 Multica Run / Issue |
| D-12 | Code Review 双轴检查 | 单独评估 Contract Alignment 与 Engineering Standards，Finding 可追踪并被定向修复 |
| D-13 | Test / Build PASS 但 Behavior Verification 缺失 | Completion Check 不因工具 PASS / checkbox 而宣称任务完成 |
| D-14 | Required Change-level Verification Task 由 Engineer 负责 | Task Set Completion 包含当前有效 Combination Evidence |
| D-15 | Independent Verify Agent 已批准并持有另一个 Verification Task | Engineer-side Ready 允许该任务 pending；父级在验证 / PR 前要求相应 Task / Gate 完成 |
| D-16 | `verify_agent.required=false`，但存在 Required Regression / Integration Task | 仍需指定的 Runtime Executor 完成验证，不能省略 required checks |
| D-17 | PR Preparation 缺 Repository ID / Candidate Commit / TFS or Delivery association | 不通过对应完整性要求，不能以“父 Issue 理应知道”补齐 |
| D-18 | 一个 Task Set 改动两个业务 Repository | 分别形成 Repository Change / PR Preparation；不因此强制新建 Sub-Issue |
| D-19 | Commit、Contract 或影响测试结论的环境发生实质变化 | 重新评估受影响 Evidence，失效 PASS 不能复用；不无条件重做无关检查 |
| D-20 | Independent Verify PASS 后当前 Candidate 又改变 | 按 02 的 Verification Gate / Freshness 规则复核，Engineer 不自行覆盖独立 PASS |
| D-21 | Check PASS 但 Task Progress Patch 写入结果未知 | 回读真实 `tasks.md`，幂等恢复而非覆盖其他 Engineer 任务 |
| D-22 | Completion Fact 写回失败或重复运行 | 可从当前 Task / Evidence / Candidate 恢复，不能错误关闭 Parent Delivery |
| D-23 | 正常 Technical Finding 与跨 Contract / Scope Finding | 前者 Targeted Fix；后者停止并明确升级 Workitem Analyst / Human 路径 |
| D-24 | Reviewer Helper / Internal Method 尝试创建隐藏 Agent、Workflow、Task / PR | 禁止 Method Side Effect；父 Project Skill 保持唯一 Dispatcher |
| D-25 | OpenSpec Native Verify / Schema Validation PASS，但实际 Integration / E2E 未执行 | 不能将一致性检查误报为实际独立行为验收 |
| D-26 | Required Checks 无法执行、Gate FAIL 或 UNKNOWN、同类 blocker 反复出现 | BLOCKED / STOP / Escalate，不凭推断放行或无界重试 |

最低实施验收至少覆盖：一个正常 Corrective Path、一个正常 Intentional Path、一个 Backend / Frontend / Flink 代表性 Task Set、一个并行写入、一个工程返工、一个 Evidence 失效、一个 PR Preparation 缺项和一个跨契约 STOP。其他场景可按实现顺序分批补充，但验收状态必须真实记录。

---

<a id="development-appendix-a"></a>

# 附录 A. 最终 Development 执行模型（摘要）

本图是本专业方案的阅读摘要，不维护新的 Delivery Workflow。Analysis Handoff / Task Set 派工与下游 Verify / PR / Finalize 的完整规则请读 [02 §2.3](../02-multica-delivery-lifecycle-design-v1.6.6.md#delivery-execution-model)。

```text
Delivery Lead（已批准交接 + 现有 Roster / Runtime Projection）
    ├─ Parent Issue + @Engineer + task_refs（默认）
    └─ Development Sub-Issue + Assignment + task_refs（按需）
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
             Commit / Push → PR Preparation
                      ↓
             Development Evidence（current Candidate）
                      ↓
             Development Completion Check
                      ↓ PASS
             Change-scoped Task Progress Patch / Readback
                      ↓
             Completion / Evidence Facts → 当前 Issue / Sub-Issue
                      ↓
             Parent Delivery / Delivery Lead
                      ↓
             Verification Projection / PR Materialization / Finalize（02 Owner）
```

# 附录 B. 当前决策与核心原则（摘要视图）

此处是当前规则的检索摘要，不作为第二份权威 Contract；遇到跨文档歧义按 01 的 Document Ownership / 02 Delivery Lifecycle / 05 Schema / 06 Methods 的对应条目确认。

| 主题 | 当前决策 |
|---|---|
| Engineer 工作对象 | `change_ref + task_refs + relevant artifact / evidence refs + Multica Runtime Context`；Task Set 是引用范围 |
| 工程入口 | `development-execution`（统一 Project Skill） |
| 专业角色 | Backend / Frontend / Flink Engineer，共用 Execution Model、独立 Domain Skill |
| 方法层级 | `tdd` / `code-review` / `codebase-design` / `verification-before-completion` 是父 Skill 内部 Method，不注册同级 Runtime Skill |
| Development 策略 | Feedback-Driven + 小步实现；TDD 适用时优先，但不机械强制 |
| Corrective | 恢复既定行为；合法 `skip_specs`，Root Cause `probable` 可按已批准有界方案开发 |
| Intentional | 规格驱动实现；保留 Existing Specs，Design 按需 |
| Rework | Targeted Fix / Re-validate / Review；实质 Contract 改变返回 Analysis |
| `tasks.md` | Approval 后正文默认只读；top-level `T-xxx` 冻结；checkbox 通过 05 串行 patch |
| Verification | 每个 Implementation Task 有验证；Change-level 按需；执行者为当前明确分派的 Engineer / Verify Agent |
| Local Validation / Code Review | 每个 Task Set 必备；与 `verify_agent.required` 无关 |
| OpenSpec Native Verify | Change-level 一致性能力，按需调用，非独立验收等价物 |
| Development Evidence | 通过原生 Identity / refs 关联批准 Contract、Current Candidate、Review 和实际验证；不创建第三套 Store |
| Completion | Check PASS → 受控 Task Progress Patch / Readback → Completion Handoff；Engineer 不直接关闭父 Delivery |
| Commit / Push | Engineer 负责当前 Task Set 的 Git 事实与候选版本 |
| PR | Engineer 负责语义准备、含 TFS / Delivery 关联；PR Materialization / Sync 由 02 规定的能力负责 |
| Sub-Issue | 多仓、多 Engineer / Task / PR 都不自动触发；只在需要独立持久 Runtime State 时创建 |
| Decision Owner | Engineer 负责局部技术语义；Deterministic 层负责客观硬条件；Delivery Lead 协调跨角色 / Runtime；Human 负责批准 |

**核心原则**：不重复做需求分析；不修改获批行为来迎合实现；不把 Method 当 Runtime；不把 Task checkbox 当正确性；不把工具 Validation 当实际运行 Evidence；不把独立 Verify Agent 当所有测试的 Owner；失败优先定向修复；无法判断或需要扩大批准范围时停止升级；工程交付结束于有证据、可恢复的当前 Task Set Completion Facts。

# 附录 C. 方法来源与版本说明（非现行执行规则）

- [OpenSpec Apply 工作方法公开模板](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/src/core/templates/workflows/apply-change.ts)；使用原生 Apply 时的 `task_refs` 限制是本项目适配约束，不能假定原生工具自动理解 Multica Task Set。
- [OpenSpec Verify 工作方法公开模板](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/src/core/templates/workflows/verify-change.ts)；其一致性检查不能替代真实 Runtime / Integration / E2E。
- Matt Pocock / Superpowers 方法的具体选型、Vendored / Project-native 方式、上游引用固定与副作用控制以 `06-method-skill-library-implementation-design-v1.4.md` 为准；04 不另维护一份第三方 Skill 目录或历史决策。
- 版本演进：v1.15 将原 `04-engineer-development-stage-design` 更名为 **`04-engineer-development-design`**，重组为专业过程与实施契约，集中修正 Method 层级、Task 写入权限、PR Association、Evidence Freshness 与 Completion Handoff。此前 v1.14 及更早版本的完整变更记录保留在旧版文档中，不作为本版现行执行规则。

**实施状态提醒**：本文件是设计基线，不能被解释为已完成 Multica Project Skill、Script、Schema Parser 或生产验收部署。05 P0-2 的 Parser-Level Markdown Contract、Development 诊断方法跨 Project Skill 复用接口尚需对应实施方案进一步明确；本文不创建临时替代机制。
