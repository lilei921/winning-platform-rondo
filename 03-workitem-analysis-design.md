# Workitem Analysis Design（工作项分析设计方案）

> Version: **1.19.8**  
> Execution Role（执行角色）: `Workitem Analyst`  
> Professional Outcome（专业目标）: Engineering Contract Formation（工程契约形成）  
> Scope: Analysis 专业设计与工程实施契约；包括 Role / Agent Model、输入、语义分类、Context、Corrective / Intentional 分析、OpenSpec Engineering Contract、Verify Recommendation、Review / Analysis Gate、审核提交、返工、实施映射与验收\
> Date: 2026-11-07\
> Author: winning/li_lei
>
> Status（状态）: Design Baseline（仓内 Skill / CLI 已有配置；真实 Workspace 部署与 E2E 仍须回读验证）  
> Upstream Baseline（上位方案）: [01-multica-openspec-design-guideline.md](01-multica-openspec-design-guideline.md)、[02-multica-delivery-lifecycle-design.md](02-multica-delivery-lifecycle-design.md)\
> Related Baseline（关联基线）: [04-engineer-development-design.md](04-engineer-development-design.md)、[05-openspec-schema-implementation-design.md](05-openspec-schema-implementation-design.md)、[06-method-skill-library-implementation-design.md](06-method-skill-library-implementation-design.md)

**文档定位**：`Workitem Analysis Design` 描述工作项分析的专业过程及其实施契约；`Workitem Analyst` 是当前执行角色，`workitem-analysis` 已退役并保留历史文件；当前通过专业 Skill 按需组合完成分析，不新增 Agent、Run 或 Stage。本文以 v1.18.1 的**实施主题章节结构**为基线，吸收 v1.19 的专业质量要求，并前置独立的 Role / Agent Model，形成 15 章结构；不改为五段式章节，不把专业活动变成新的 Workflow / Agent Run / Gate / Artifact。

**权威归属**：[01](01-multica-openspec-design-guideline.md) 负责统一架构与术语；[02](02-multica-delivery-lifecycle-design.md) 负责跨角色 Delivery Lifecycle、审批和交付闭环；[03](03-workitem-analysis-design.md) 负责 Analysis 专业工作、工程准备与交接质量；[05](05-openspec-schema-implementation-design.md) 负责 Schema / Template / Change / Task 与 parser 级实施契约；[06](06-method-skill-library-implementation-design.md) 负责 Method Library。**按实际注册绑定的专业 Skills 组合执行，使用 [05](05-openspec-schema-implementation-design.md) 已收口的 Native First 模板与任务引用契约；[06](06-method-skill-library-implementation-design.md) 的 Analysis Skill 层级专项继续暂缓。**不增加独立审批、Gate、Route、Artifact 状态或实施机制；历史记录放在附录 C，不是当前执行规则。

## 目录

- [1. 文档定位、专业职责与完成标准](#analysis-section-01)
- [2. Workitem Analyst Role 与 Agent Model](#analysis-section-02)
- [3. TFS 管理类型与技术语义](#analysis-section-03)
- [4. Analysis 输入与执行模型](#analysis-section-04)
- [5. Technical Change Kind 判断与自动处理边界](#analysis-section-05)
- [6. Context Analysis 与 Evidence](#analysis-section-06)
- [7. Corrective Analysis（纠正性分析）](#analysis-section-07)
- [8. Intentional Requirement Analysis（意图性需求分析）](#analysis-section-08)
- [9. OpenSpec Preparation 与 Analysis Engineering Contract](#analysis-section-09)
- [10. Independent Verify Agent Recommendation](#analysis-section-10)
- [11. Professional Review 与 Analysis Gate](#analysis-section-11)
- [12. Analysis Publish、Human Handoff 与返工](#analysis-section-12)
- [13. Development Handoff 与职责边界](#analysis-section-13)
- [14. Agent / Skill / Config 实施结构](#analysis-section-14)
- [15. Analysis 与 OpenSpec 接入验收](#analysis-section-15)
- [附录 A. 最终 Analysis 执行模型（摘要）](#analysis-execution-model)
- [附录 B. 当前设计决策与核心原则（摘要视图）](#附录-b-当前设计决策与核心原则摘要视图)
- [附录 C. 专业依据与历史版本（非现行执行规则）](#附录-c-专业依据与历史版本非现行执行规则)

---
<a id="analysis-professional-scope"></a>
<a id="analysis-stage-scope"></a>

<a id="analysis-section-01"></a>

# 1. 文档定位、专业职责与完成标准

本文设计 **Analysis 专业过程与实施契约**，当前由 Workitem Analyst 执行；它不是单个 `SKILL.md`，也不是 Delivery Lead 的全局流程。核心问题是：如何将不完整、可能有歧义的 TFS Work Item 转化为正确、可审核、可实施且可验证的 Engineering Contract（工程契约）。

本文维护分析职责、输入、专业方法、产物与检查、提交审核和定向返工；人工审核决定的处理、研发组织、TFS Task 物化、PR 与最终交付由 [Delivery 主方案](02-multica-delivery-lifecycle-design.md) 维护。统一术语、文档职责和 Multica 官方机制由 [指导手册](01-multica-openspec-design-guideline.md#document-ownership) 维护。

本文“Analysis 阶段”指 Delivery 生命周期中的专业工作区段，不对应 Multica 原生 Stage；Stage 使用见[主方案 §7.5](02-multica-delivery-lifecycle-design.md#delivery-stage)，原生机制见 [指导手册：Parent / Child 与 Stage](01-multica-openspec-design-guideline.md#mechanism-parent-stage)。当前仓内 Analysis 由 Workitem Analyst 使用现行绑定的专业 Skills 执行，并由 `analysis-completion` 等已配置能力收口；其他专业方法是否独立提取为 Skill，取决于能力复用证据，不按历史七 Skill 数量强制配置。Agent 正式名称保持不变。

## 阶段目标

Workitem Analyst 负责需求与问题分析及研发准备，澄清目标、业务场景、行为规则、范围和验收要求，结合现有系统形成必要方案，为后续研发与验证提供清晰、可审核、可执行的依据。

技术调查、规格与设计服务于需求和问题的澄清，不以“需求已经明确，只需分析改哪些代码”为前提。

**专业方法总览（仅用于确保分析质量，不是新增执行工作流）：**

| 专业活动 | 核心判断 | 本文主要实施章节 |
|---|---|---|
| Understand（理解） | 问题、目标、现有 / 预期行为及未知项是什么 | [§4](#analysis-section-04) 输入与执行模型 |
| Investigate & Clarify（调查与澄清） | 关键业务 / 工程事实是否有证据，歧义是否已澄清 | [§6](#analysis-section-06) Context Analysis 与 Evidence |
| Decide（专业判断） | Change Kind、Root Cause 或 Solution 是否有依据 | [§5](#analysis-section-05) Change Kind、[§7](#analysis-section-07) Corrective、[§8](#analysis-section-08) Intentional |
| Specify & Prepare（规格与研发准备） | 是否形成可被 Engineer 消费、可验证的工程契约 | [§9](#analysis-section-09) OpenSpec Preparation、[§10](#analysis-section-10) Verify 推荐 |
| Review & Submit（审查与提交） | 专业审查、确定性 Gate、提交审核是否分别满足条件 | [§11](#analysis-section-11) Review / Gate、[§12](#analysis-section-12) Publish / Rework |

这些活动允许根据证据往返迭代，不要求五个 Stage、五次 Run 或五个固定 Skill；实际执行仍以 [§4.2](#section-4-2) Driver 与 [§14](#analysis-section-14) 实施映射为准。

当前方案重点解决：

- TFS `Bug` 与 `Requirement` 的管理语义不能混淆；
- `Requirement` 中存在“技术本质是 Bug”的上线后问题；
- 获准自动处理的 Change 统一使用 OpenSpec Change；两类修复采用 Corrective 轻量产物，正常产品迭代保留完整 SDD 准备；
- 超出自动处理范围的复杂需求 代表的大需求 / 全新复杂模块当前暂不自动处理；
- Analysis 结束前形成足以供人工审核和后续研发使用的 OpenSpec Change、Multica Analysis Handoff Facts 与必要 Supporting Evidence（补充证据） References。

核心原则：

> **TFS 类型是公司管理事实，Agent 不修改、不覆盖。**

> **技术变更性质由 Workitem Analyst 语义判断。**

> **TFS 管理类型与技术语义可以不同，两者必须同时保留。**

> **紧急程度属于研发人员的排期和优先级判断，不参与 Agent Workflow 路由。**

## 1.1 职责与边界

| 职责 | 需要明确的内容 |
|---|---|
| 需求与问题理解 | 为什么提出、谁在什么场景下遇到什么问题、希望达成什么目标 |
| 行为、规则与范围澄清 | 既有与预期行为，相关业务规则、正常 / 异常 / 边界场景，本次做什么、不做什么以及如何验收 |
| 方案与影响分析 | 现有能力复用、可行方案与关键取舍，受影响业务流程、接口、数据和代码范围，依赖、约束与风险 |
| 研发准备 | 按技术变更性质形成必要规格、设计、任务或 Root Cause / Fix Strategy，并明确验证要求和待确认事项 |

这是职责维度，不是新增阶段，也不要求四份独立文档。内容按权威归属沉淀到当前 OpenSpec Change、Multica Analysis Handoff Facts 与必要 Supporting Evidence References；不因 Skill 名称生成同名 Markdown。Intentional 分工见 [§8](#analysis-section-08)，Corrective 分工见 [§7](#analysis-section-07) 与 [§9.6](#section-9-6)。

必须主动发现歧义、调查证据、提出澄清问题、比较选项并给出建议；需要人工决定的关键业务取舍交 Human 确认，不将假设或建议当成已经确认的需求。不替代人的业务决策，不等于不做业务需求分析。

不自行修改 TFS 管理类型、决定优先级或代替 Human Approval（人工批准）；不决定当前成员、最终 Sub-Issue / Stage 分工，也不替代 Engineer 完成生产代码与局部实现设计。超出自动处理范围的复杂需求 的自动处理边界见 [§5.3](#section-5-3)。

<a id="analysis-readiness"></a>

## 1.2 Analysis（分析）完成标准

按当前任务与技术变更性质的适用范围确认：

- 需求 / 问题目标、相关使用者与业务场景清楚，现有行为与预期结果可区分；
- 必要业务规则、正常 / 异常 / 边界场景、需求或修复范围和验收边界明确，后续研发不必重新猜测需求；
- 必要方案或 Root Cause / Fix Strategy、影响范围、依赖与约束已分析，研发准备足以支撑实现；
- Intentional 的 Requirement / Scenario 可测试并构成 Acceptance Contract（验收契约）；Corrective 的 Expected Behavior、Failure / Regression Scope 可读取；每个 Implementation Task 有明确验证方式，必须组合多个 Task / Module / Repository / System 才能证明的行为按需形成 Change-level Verification Task；
- 当前 Change 的 Tasks、适用 Specs / Design / Corrective Proposal 与需求或修复依据一致，原生准备及 Validation 满足适用契约；
- 影响正确实现的关键未决问题已明确提出并取得必要结论；需要人工确认且尚未决定的事项不得用默认假设补齐后宣称完成；
- 已形成是否需要 **Independent Verify Agent** 的 Recommendation、Reason 与 Verification Focus，具体输出与判断边界见 [§10](#analysis-section-10)。

分析清楚不等于编码前确定全部细节。局部算法、类 / 函数拆分、内部结构、测试组织等由 Engineer 在批准边界内细化；不为形式补齐与任务无关的规格或设计。

以上是专业准备标准：语义结论由对应分析方法形成；Corrective 在 `bug-analysis` / 轻量 Preparation 中完成内部一致性检查，Intentional 由 Workitem Analyst 完成专业 Review；`analysis-completion` 汇集现有结果，Gate 只检查可确认事实。已有明确结论的方案可以提交 Human Review 等待正式批准，这与关键需求仍不清楚不同；准备完成或 AI Review 通过不等于获准编码，不新增另一套审批状态。

<a id="section-1-2-1"></a>

## 1.2.1 Engineering Truth（工程事实）与 Delivery Truth（交付事实）

本节应用 [指导手册 §1.2 Runtime-Centric Delivery（以运行时为中心的交付） + Artifact-Centric Engineering（以工件为中心的工程）](01-multica-openspec-design-guideline.md#runtime-artifact-principle)，不重新维护另一套全局 Truth Model。Analysis 的职责是把专业分析沉淀到正确 Owner，并形成必要 Delivery Facts；不得建立独立于 Multica 和 OpenSpec 的第三套 Contract System。

> **OpenSpec = Engineering Truth（工程事实）**
>
> **Multica = Delivery Truth（交付事实）**

```text
Analysis Method / Skill
= 如何调查、分析、Review
≠ 必须生成同名 Markdown

OpenSpec Change / Supporting Artifact
= Engineer 与后续 Verification 长期消费的专业技术事实

Multica Analysis Handoff Facts
= 审核、Gate、Independent Verify Recommendation 等最小交付事实和 OpenSpec 引用
```

提交 Human Review 时：

```text
Analysis Package
= OpenSpec Change
+ Multica Analysis Handoff Facts
+ Supporting Evidence References（按需）
```

`Analysis Package` 只是当前审核输入集合，不对应 `analysis-package.md`，也没有独立状态或生命周期。Summary 是从 OpenSpec 与 Multica 当前事实渲染的人类可读 View，不成为 Truth Source。

### OpenSpec：Engineering Truth（工程事实）

必须由后续 Engineer / Verification Executor 读取的技术结论留在 OpenSpec 或其明确引用的 Supporting Artifact：

```text
Corrective
- proposal.md: Problem / Expected / Actual、Failure Path、Root Cause / Evidence、Fix Strategy、Fix / Regression Scope、Impact / Spec Relation
- specs/: 需要长期补录 / 澄清既定行为时，以 Requirement + Scenario 表达；否则合法 skip_specs
- tasks.md: Implementation Tasks + task-level verification + 按需 Change-level Verification Tasks
- additional design / evidence: 仅实际需要时

Intentional
- proposal.md: Why / Goal / Scope
- specs/: 仅在 Spec-level 行为发生变化时生成 Delta Requirement / Scenario；无 Delta 时合法 skipped，验收依批准 Proposal、现行 Specs 与 Tasks
- design.md: technical approach / constraints / risks / dependencies
- tasks.md: Implementation Tasks + task-level verification + 按需 Change-level Verification Tasks
- supporting evidence: 仅实际需要时
```

本项目不再维护独立 `AC-xxx` / `VR-xxx` Truth：

- 有 Specs 时，OpenSpec `Requirement + Scenario` 是原生 Acceptance Contract；
- Corrective 合法 `skip_specs` 时，以 Proposal 中的 Expected Behavior / Regression Scope 与 `tasks.md` 的 Verification 描述证明修复；
- 能归属于单个 Implementation Task 的验证写在该 Task 内；只有组合后的 Change 才能证明的行为才建立 Change-level Verification Task；
- Regression / Integration / E2E 是 Verification Method，不绑定某个 Agent；
- 是否需要独立 Verify Agent 属于 Multica Delivery Policy，不属于 OpenSpec Engineering Truth。

### Multica：Delivery Truth（交付事实）

Analysis Handoff Facts **不是新对象**，只是使用 Multica 原生 Issue / metadata / custom property / comment / run result 等能力持久化的最小交付事实。具体字段映射由后续实现统一设计；本方案不定义新的存储、版本、状态机或生命周期。

```yaml
analysis:
  change_kind: corrective | intentional  # Multica Issue Metadata：analysis.change_kind
  change_ref: ...

  verify_agent:
    recommendation: required | not_required
    reason: ...
    focus_refs:
      - <requirement-or-scenario-ref>
      - <task-number: 1.1>

  ai_review:
    verdict: APPROVED | NEEDS_REVISION
    findings_ref: ...

  gate:
    result: PASS | FAIL | UNKNOWN
    reasons_ref: ...
```

`analysis.change_kind` 是 Workitem Analyst 的专业分类结论，由 `analysis-completion` 在 Stage 写入 Multica Issue Metadata 并回读。它供交付追溯和统计；OpenSpec Schema 仍只由当前 Change 持有。Gate / Complete 校验两者对应；该字段不能作为独立 Route、Human Approval 或自动处理授权。

`focus_refs` 只引用当前 OpenSpec Acceptance / Verification Contract（验证契约），不复制正文；可使用 Capability Spec 路径 + 原生 Requirement / Scenario 标题、Corrective Proposal 现有 Heading，或当前 Change 的可读任务编号（例如 `1.1`）定位。具体精确引用与唯一性检查由 [05](05-openspec-schema-implementation-design.md) 的 Native First 契约维护，不另造 Acceptance / Verification Identity。技术 Risk、Dependency、Open Decision、Evidence、Development Scope 等不因为跨 Run 交接而复制成第二份结构化技术合同。

---


<a id="analysis-agent-model"></a>
<a id="analysis-section-02"></a>

# 2. Workitem Analyst Role 与 Agent Model

## 2.1 专业 Agent 与统一分析模型

`Workitem Analyst` 是 Analysis 的单一专业 Agent，负责把当前 Issue 转化为准确、可实施、可验证的 Engineering Contract，并对最终 Analysis Package 负责；不因 Corrective / Intentional 新建 Agent 或固定流水线。

```text
Workitem Analyst（专业目标与最终结果 Owner）
├── 证据调查：按需 codebase-explorer、复用已有 Evidence
├── Corrective：按需 bug-analysis
├── Intentional：按需 requirement-analysis
├── 工程契约：按需 spec-preparation
└── 提交审核：analysis-completion（内部调用 Analysis Gate）
```

上述是能力组合而非强制顺序。`workitem-analysis` 已退役、源文件暂保留用于审计，不作为现行执行入口；有效 Skill 及绑定以 `workspace-config/provisioning.json` 为准。已有有效产物与 Evidence 增量复用，定向返工仅修订必要部分。

## 2.2 Agent Description（展示说明）

```text
负责需求与问题分析、技术变更性质判断及研发准备，形成可审核、可实施、可验证的 OpenSpec 工程依据，并提交人工分析审核。
```

Description 用于 UI / Discoverability（可发现性），不承担完整执行 Procedure。

## 2.3 Agent Instructions 的长期 Role Contract

Agent Instructions 依据[指导手册](01-multica-openspec-design-guideline.md)维护长期专业目标、职责、工作方式、边界与交付要求；下表为内容维度，不要求固定章节。Squad 归属由配置维护，上游 Evidence 的来源角色、具体 Handoff 字段、Gate 和 CLI 步骤由对应配置与 Skill 负责，不复制到长期 Instructions。

| 部分 | 当前 Role Contract |
|---|---|
| Role | Workitem Analyst，专注缺陷与需求分析，为研发提供准确、清晰、可实施、可验证的工程依据。 |
| Goal | 分析清楚当前 Issue 的目标、既有与预期行为、问题或需求边界以及必要工程依据；长期专业目标不替代当次 Issue Goal。 |
| Core Responsibilities | 澄清业务场景、规则、范围与验收；缺陷分析关注 Root Cause、Fix Strategy 和回归范围，需求分析关注业务意图、方案选择及影响；根据证据区分恢复既定行为的 `corrective` 与主动改变预期行为的 `intentional`，不直接按来源管理类型分类；准备适用 OpenSpec Change 工件与验证要求，并给出有依据的 Independent Verify Recommendation。 |
| Working Principles | 从 Issue、现有规格、代码和可信 Evidence 出发，区分事实、假设、建议及待授权决定；按复杂度与证据缺口组合专业 Skill，复用有效结果；评估拟采用验证方案的覆盖能力、明确独立验收要求及重要剩余风险；仅当独立执行确有必要或能够实质降低重要风险时推荐 `required`，验证方案充分且无额外要求时推荐 `not_required`；依据不足先补证或澄清，不默认填写，且 `not_required` 不取消开发侧必要验证。不把计划中的测试视为已执行结果。 |
| Boundaries | 不代替业务方作未经授权的产品决策，不将推断写成已确认事实；不擅自改变已批准工程要求；不负责生产代码实现、成员分工、外部工作项管理或人工批准。 |
| Escalation, Communication & Delivery | 影响正确分析的关键事实或授权无法确认时明确缺口与影响；形成可追溯的工程工件、必要专业 Review 和 Verify Recommendation，通过 `analysis-completion` 提交并确认审核状态；反馈返工仅修订受影响内容。 |

Description 的展示边界、Instructions 的接收范围分别见 [指导手册：Description](01-multica-openspec-design-guideline.md#mechanism-agent-description)、[Instructions](01-multica-openspec-design-guideline.md#mechanism-agent-instructions)。详细诊断方法、工件编写、Verify Recommendation 字段和提交操作以对应 Skill 及实施契约为准。
---

<a id="tfs-management-background"></a>

<a id="analysis-section-03"></a>

# 3. TFS 管理类型与技术语义

## 3.1 为什么 TFS 类型不能等同技术语义

公司内部对 TFS 类型存在明确管理差异：

### Bug（缺陷）

- 会影响绩效；
- 不统计需求工作量；
- 不能创建 TFS Task；
- 主要是在测试期间集中发现的缺陷。

### Requirement（需求）

- 统计工作量；
- 需要按需求管理规则创建 TFS Task；
- 包含正常产品迭代；
- 也可能包含上线后现场发现、技术本质属于 Bug 的问题。

因此：

```text
TFS Type
≠
Technical Change Kind
```

Agent 不应该因为判断某个 Requirement “实际上是 Bug”，就修改或覆盖它的 TFS 类型。

推荐保留：

```yaml
tfs.type: Requirement

analysis:
  change_kind: corrective
```

## 3.2 管理事实与技术变更性质分离

必须区分 `TFS Type`（来源管理事实）和 `Technical Change Kind`（技术变更性质），三者的分类规则见 [§5](#analysis-section-05)。例如，TFS Requirement 可以属于 Corrective Change，仍保留 Requirement 的绩效、工作量与 TFS Task 管理规则；Workitem Analyst 只能识别技术性质，不能覆写来源类型。

`TFS Task` 是否创建只依据原始 `tfs.type`；实际物化、工时管理与状态回写由 Squad 外的 `rondo tfs writeback` 在 PR 完成后的收口过程中承担，见 [02 §12.4](02-multica-delivery-lifecycle-design.md#final-completion)。Analysis 只提供可信的 OpenSpec Engineering Tasks，不负责 TFS Task 的创建、工时或管理状态。

---


<a id="analysis-input"></a>

<a id="analysis-section-04"></a>

# 4. Analysis 输入与执行模型

<a id="section-4-1"></a>

## 4.1 分析输入与启动契约

从当前明确委派的 Issue 开始专业分析，不因一次普通通知就重复执行完整分析。

| 输入 | 要求 |
|---|---|
| 当前工作对象 | Issue 身份、TFS Work Item 来源、当前委派和工作范围能够对应。 |
| 管理事实 | 原始 `tfs.type` 与 TFS 内容可读取；不以技术判断覆盖来源类型。 |
| 需求 / 问题上下文 | 目标、已知场景、现有说明、可读取证据与待确认项；不要求原始需求已经完整。 |
| Repository / 项目上下文 | 本次调查需要的入口、权限、相关规则和代码可定位；按需扩展调查，不预读全仓资料。 |
| 已有结果 | 当前 OpenSpec Change、Multica Analysis Handoff Facts、Context / Evidence References、Wayfinder 的最新有效 `/note` Exploration Comment 与已有反馈（如有），先判断可复用范围。 |
| 返工请求 | 原始人工评论 / Finding 引用、明确修正方向和受影响范围；按 [§12.3](#analysis-rework) 处理。 |

无法确认任务身份、必要来源或授权时停止并说明缺口；需求歧义进入正常澄清，不自行补成已确认事实。获准自动处理的 Change 的 Change 准备能力均按 [§9.3](#openspec-configuration)、[§9.4](#analysis-task-contract) 验证；未准备好环境时可保留已完成问题调查，但不能声明 Analysis Gate（分析门禁） PASS、批准研发就绪或静默退回无 Change 的交付方式。

首次启动与 Member 委派由[主方案 §4.2](02-multica-delivery-lifecycle-design.md#delivery-start) 维护；Assignment、Mention 与成员实际接收上下文的机制分别见 [指导手册：Assignment](01-multica-openspec-design-guideline.md#mechanism-assignment)、[Comment / Mention](01-multica-openspec-design-guideline.md#mechanism-comments)。本节只检查本阶段收到的工作契约，不重建启动 Router。

<a id="section-4-2"></a>

## 4.2 以目标为导向的分析与能力选择

Workitem Analyst 根据当前目标、证据与授权自行组合专业 Skill，不存在必须先执行的场景 Driver。Workitem Analyst 先核对任务身份、当前证据与已有结论，再自主选择足以达成当前专业目标的调查深度：

```text
当前 Issue / 已有分析或返工请求
  → 明确本次目标、已知事实、关键未知项
  → 语义判断 Corrective / Intentional
     ├─ Corrective：按需诊断根因、影响和修复验证
     └─ Intentional：按需澄清规则、范围、场景和方案
  → 按当前 Schema / Artifact Instruction 准备必要 OpenSpec Contract
  → 适用的专业一致性检查或 Review
  → analysis-completion / Gate / 提交 Human Review（硬边界）
```

此图是工作能力选择与必要交付边界，不是强制 Method 调用顺序。复杂或证据不足的任务可深化调查，简单 Corrective 应避免无关的 Intentional 分析；已完成有效内容只补差异，定向返工不重复整轮调查。不能省略必须的授权、Analysis Gate、Human Review 或证据充分性要求。

`bug-analysis`、`requirement-analysis`、`codebase-explorer` 和 `spec-preparation` 已作为专业 Skill 配置源文件，真实 Workspace 是否发布及实际绑定仍须回读 manifest 和平台状态。分析结果按 [§9](#analysis-section-09) 写入权威 Artifact，不新增同名 Markdown。

<a id="section-4-3"></a>

## 4.3 输入理解、事实分层与完成信号

Workitem Analyst 收到不完整描述时，应先形成最小的 **Problem / Requirement Understanding（问题 / 需求理解）**，而不是要求业务方先提供完整规格。理解至少覆盖：目标与受影响角色、触发场景、观察到的行为、可追溯的 Expected Behavior 来源、关键约束、正常 / 异常 / 边界场景，以及仍可能改变路由或验收的未知项。

| 信息类别 | 含义 | 处理要求 |
|---|---|---|
| Source Requirement（来源要求） | TFS 描述、原始评论或请求方说法 | 保留来源及 `tfs.type`；不自动视为已确认工程结论 |
| Observed Fact（观察事实） | 实际代码、日志、测试、运行现象 | 保留可复核的 Evidence 引用；不自动当作 Expected Behavior |
| Hypothesis（假设） | 对根因、规则或行为的尚未验证解释 | 明确不确定性，交 [§6](#analysis-section-06)–[§8](#analysis-section-08) 验证 |
| Recommendation（建议） | 备选方案与专业推荐 | 说明原因、影响及取舍；不代替业务批准 |
| Confirmed Decision（确认决定） | 由足够依据或必要 Human 决定确认的规则与范围 | 写入其权威 OpenSpec Artifact 或对应 Delivery Fact |

**完成信号**：能够用业务语言讲清目标 / 问题、当前与预期行为、主要场景、来源和待确认问题。输入不完整通常触发调查澄清；仅在身份、权限、必要来源不可确认时按 [§4.1](#section-4-1) 停止。此处不生成必需的 `understanding.md`。

---


<a id="analysis-section-05"></a>

# 5. Technical Change Kind 判断与自动处理边界

## 5.1 Change Kind 判定矩阵

Workitem Analyst 保留 `TFS Type` 管理事实，依据**恢复既定行为还是主动改变预期行为**判断 Technical Change Kind；不创建独立 Analysis Route，也不因名称而要求固定 Skill 链。

| TFS Type | 技术语义与证据 | Technical Change Kind | 可选专业能力 |
|---|---|---|---|
| `Bug` | 实际行为偏离有依据的既定行为 | `corrective` | `bug-analysis` |
| `Requirement` | 恢复已有、可追溯的预期行为 | `corrective` | `bug-analysis` |
| `Requirement` | 新增能力、修改业务规则或主动改变 API / Contract / 预期行为 | `intentional` | `requirement-analysis` |
| 任意来源 | 语义、授权、关键证据不充分或超出当前交付能力 | 暂不形成可执行结论 | 停止受影响准备，向 Delivery Lead / Human 澄清 |

Change Kind 首次准备时映射到 `corrective-change` / `intentional-change` Schema；Schema / Artifact Contract 以 [05](05-openspec-schema-implementation-design.md) 为唯一维护源。Agent 根据任务深度和证据按需组合专业能力，最终通过 `spec-preparation` 准备当前 Change，不能把本矩阵实现为第二套 Workflow 或 Route Config。

## 5.2 Corrective 与 Intentional 语义判定

**Corrective：** 当前行为偏离有可信来源的 Expected Behavior，目标是恢复正确行为，不主动引入新产品行为。来源是 `Bug` 还是 `Requirement` 只影响管理规则，不改变专业分析本质；有依据地补录既定约束仍可属于 Corrective。

**Intentional：** 产品主动要求未来行为发生变化，例如新场景、规则、能力、外部 API 或 Contract 修改。小规模改动仍须满足适用的行为规格与验收契约，不因简单就自动省略 Specs。

当既定行为来源冲突、Expected Behavior 不明确或修复实际需要扩展产品行为时，不借 Corrective 绕过规格要求；核实当前授权与专业结论，必要时交 Delivery Lead / Human 澄清。

<a id="section-5-3"></a>

## 5.3 自动处理能力边界

当前暂不自动处理全新大型模块、重大架构或数据模型重构、重大跨域 Contract、需要大量人工产品或架构取舍的工作。能力、风险和授权边界与 Change Kind 正交；即使 `intentional` 分类成立，也不能自动视作获准交付。超界时执行 `STOP → Delivery Lead / Human`，不建立复杂度 Route。

<a id="section-5-4"></a>

## 5.4 与优先级、仓库及 PR 数量解耦

`Priority / Severity / Deadline` 是来源管理事实，由 Human 决定排期；本项目不建立独立 `hotfix` 技术分类。Repository、文件、Engineer、Task Set 或 PR 数量均不决定 Change Kind，也不单独构成越界条件。

## 5.5 分类结果与执行约束

Workitem Analyst 以 Issue、来源事实、既定行为依据和 Evidence 支撑语义判断，并在 Handoff Facts 中提供 `change_kind`；`rondo analysis stage` 将其持久化到服务端 `analysis.change_kind`，供统计和交接。不新增 `analysis-routing.yaml`、`resolve-analysis-route.py` 或独立 `analysis.route`。复用当前 Change Schema，校验分类与 Schema 一致。结果不覆盖 `tfs.type`、审批、Gate 或 Task 管理规则。

## 5.6 混合变更与澄清

说明当前究竟恢复哪条既定行为、主动改变哪条预期行为，以及必要 Human 决策。混合变更、Spec 与来源冲突、重大范围变化，应先澄清适用 Engineering Contract 和批准边界；同一 Delivery 不因分类冲突自动建立多个 Change。

---

<a id="analysis-section-06"></a>

# 6. Context Analysis 与 Evidence

<a id="section-6-1"></a>

## 6.1 工程与业务上下文调查（按需使用 `codebase-explorer`）

现行 `codebase-explorer` 提供需求 / 问题与工程上下文，调查相关业务场景、已有规则、系统能力和实现事实，支撑后续分析，不替代 `requirement-analysis` / `bug-analysis` 的专业结论。Workitem Analyst 与 Wayfinder 均可按需使用独立绑定的 `codebase-explorer`，但各自依据当前 Issue 与专业目标选择调查深度；跨角色只复用可复核的 Evidence References。

`codebase-explorer` 只提供调查方法，不要求每次生成 `context-pack.md`。统一要求是：

```text
Context Evidence 必须可追溯
context-pack.md 仅在复杂任务需要时生成
```

简单任务例如单仓、目标明确、既有 Spec 清晰、证据引用较少时，Evidence References 直接保留在当前专业 Artifact / Analysis Package 引用中即可，不为形式创建 Context Pack。

以下情况优先生成 `context-pack.md` 作为 Supporting Evidence：跨 Repository / 跨服务调查、历史规则复杂、需要较长 Evidence Chain、规格与实现存在多处差异、需要集中保存大量持久化引用。生成后它仍只是 Supporting Evidence，不成为 Proposal / Spec / Corrective Proposal 的第二份正文。

工程调查必须天然支持跨 Repository 调查，不得在定位到第一个相关 Repository 后停止。

推荐调查方式：

```text
Work Item
↓
读取需求 / 问题目标、业务场景、已确认规则及来源
↓
AGENTS.md 定位候选 Repository
↓
识别入口 Repository 与相关已有规格 / Capability
↓
对照行为约定，沿调用链 / 数据流调查
↓
发现跨仓 Boundary
↓
继续调查相关 Repository
↓
直到 Evidence Chain 闭合
```

Context Evidence 应能够区分：

```text
Root Cause Repository
Affected Repositories
Fix Repositories
Verification Repositories
```

这些集合允许不同。例如根因可能只在一个 Repository，但修复和验证需要覆盖多个 Repository。

### 6.1.1 已有规格与实际实现

调查当前相关范围时，存在可读取的相关主规格则一并读取 `openspec/specs/`，与代码 / 测试和可获得的运行证据对照，不等到准备文档时才检索规格。读取已有 Markdown 规格不以 OpenSpec CLI 可用为前提。

| 输入 | 用途 |
|---|---|
| TFS Work Item / 已确认需求 / Human 补充 | 本次目标、使用者与业务场景、已确认规则及约束 |
| 已有主规格 | 已约定的行为、场景与外部限制 |
| 代码、测试、运行记录 | 已实际实现或观察到的行为 |

不能把代码现状自动视为正确规格，也不能把规格存在视为已经实现。不一致必须保留来源；如已生成 Context Pack 可集中记录，否则以 Evidence References / 当前专业 Artifact 记录。影响本次方案或正确性判断时交相应分析 / Human 确认，不静默覆盖任一来源。

只补足本次修改相关的规格认识，不以全量补齐 Monorepo 规格库作为前置条件。Intentional 尚无主规格时，标明已确认的既有行为及证据，必要基线在当前 Change 中准备，不提前将尚未交付的变化写入主规格。

Corrective 同样使用统一 Change；已有主规格只是 Expected Behavior 的一种来源，缺少相关主规格不要求先补齐模块 / 全仓规格库。继续依据已确认需求、Human 说明与相关证据分析，代码现状不能单独证明预期正确。缺少必要 Expected Behavior / 根因证据时停止澄清；缺少 CLI / 根仓访问时按 [§9.3](#openspec-configuration) 保留调查、停止准备完成声明，两种缺口不得混淆。

Repository 定位顺序：

```text
Work Item / Issue
↓
external-knowledge.md
↓
Root AGENTS.md §1
↓
Target Repository Instructions
↓
docs/router/overview.md
↓
docs/router/*-mapping.md
↓
code-intelligence / CodeGraph
↓
caller / callee / impact
↓
Exact Source Read
↓
ripgrep fallback
```

## 6.2 Wayfinder Evidence 消费与增量调查

Wayfinder 通过独立 `codebase-explorer` 调查，在自动 TFS 准入路径中将结论写入同一 Issue 的 `/note` Comment（首次非评论 Run 可用顶层 Comment，Human 恢复 Run 使用触发线程的回复）。Comment 写入、统一读取入口、Decision、Assignment / Status 与恢复均以 [02 §4.1.1](02-multica-delivery-lifecycle-design.md#delivery-intake) 为准；本节不复制流程状态机。

Workitem Analyst 开始 Context Analysis 时：

1. 按 [02 §4.1.1](02-multica-delivery-lifecycle-design.md#delivery-intake) 的统一入口检索顶层 Comment 与回复线程，定位当前**有效**的 Wayfinder Exploration Comment；核对 Work Item 身份、来源 `tfs.changed_at`、`supersedes` / `resume_ref`（如有）、Repository / Commit、Code / Spec 引用、主要结论和未决问题。按引用回读代码事实；不能因为 Comment 自称 `eligible` 就假定根因或方案正确。
2. 区分可直接复用的 Observed Facts、仍需确认的 Hypotheses、仅供参考的 Recommendations。复核证据适用于当前工作范围且未过期时，直接复用；只补缺失、变化、冲突或专业分析新发现的跨仓上下文，不机械重走 CodeGraph / Source Read。
3. 如发现重要冲突或 Evidence 失效，标明具体失效原因及新引用，并用当前专业 Artifact / Supporting Evidence 记录修正；Wayfinder 的准入结论不约束 Analyst 的 Technical Change Kind、Root Cause、Solution 或 Human Escalation。
4. 长证据链仅按 [§6.1](#section-6-1) 的条件生成 `context-pack.md`，**不**把 Comment 复制成第二份规格正文；最终 OpenSpec Engineering Truth 仍由 `requirement-analysis` / `bug-analysis` 和 `spec-preparation` 确认并形成。

**完成信号**：有可用 Wayfinder Context 时已引用并按需复核，新增调查覆盖 Analysis Readiness 必需的缺口；无可用 Comment、权限不足或 Evidence 已过期时，按当前委派范围使用 `codebase-explorer` 调查并说明。Wayfinder Comment 不是所有 Analysis 的强制输入；自动 TFS 入口的准入交接仍由 [02 §4](02-multica-delivery-lifecycle-design.md#section-4) 管理。

## 6.3 证据链、澄清与跨 Run 保留

- **业务证据链**：TFS / Comment → 目标与用户场景 → 已确认业务规则 / 决策；对于关键歧义，提出可回答的问题、可选行为及对验收的影响。
- **工程证据链**：现行 OpenSpec Spec → 代码 / 测试 / 运行观察 → 受影响的调用链、数据流与 Repository；存在冲突时保留各自来源，不用代码现状证明规格正确。
- **推断强度**：Observed Fact、Hypothesis、Recommendation、Confirmed Decision 按 [§4.3](#section-4-3) 区分；记录支持与反证，不用单一现象推断完整 Root Cause。
- **澄清权限**：业务取舍、外部 Contract、无法自主决定的范围经 [02](02-multica-delivery-lifecycle-design.md) 的已有 Lead / Human 接口确认；本方案不新增 Clarification Status、Gate 或 Issue 类型。
- **交接保存**：需要后续独立 Run 使用的证据须保持可定位、可追溯；仅在复杂长证据链情况下按 [§6.1](#section-6-1) 生成 `context-pack.md`。

**完成信号**：后续专业判断依赖的关键事实具有可读取来源；影响正确实现的矛盾已有确认结论，或已经说明停止 / 升级理由。发现新证据改变 Root Cause、方案或范围时返回对应专业分析，不为完成当前 Skill 而继续推进。

---


<a id="analysis-section-07"></a>

# 7. Corrective Analysis（纠正性分析）

<a id="section-7-1"></a>

## 7.1 `bug-analysis`：缺陷与生产修复共用方法

两类 TFS 来源都可能属于 Corrective，因此复用同一个 `bug-analysis` Skill，不按来源管理类型复制分析方法。

`bug-analysis` 是 Corrective 的分析 **Method**，不是 OpenSpec Artifact。它负责形成：

```text
Problem Scenario / Affected Behavior
Observation
Expected vs Actual / Expected Behavior 来源
Reproduction（复现条件、步骤与结果）
Failure Path
Root Cause Hypothesis
Evidence
Verification / Regression Signal
Conclusion
Fix Strategy
Fix Scope
Regression Scope
Verification Considerations
```

复现信息应说明必要环境、输入数据、操作步骤及观察结果，供后续 Engineer 重现问题和验证修复。无法复现时记录原因与替代证据，不把成功复现作为所有问题的统一前置条件；关键根因或行为仍无法确认时，按 [§7.2](#section-7-2) 停止并澄清。复现信息保留在 Corrective Proposal 或其明确引用的 Supporting Evidence 中，不新增独立必需工件。

建议 Root Cause：

```yaml
root_cause:
  status: confirmed | probable | unknown
  summary: ...
  evidence:
    - ...
  rejected_hypotheses:
    - ...
```

同时应输出跨仓 Repository Scope，例如：

```yaml
repository_scope:
  root_cause_repositories:
    - repo-a
  affected_repositories:
    - repo-a
    - repo-b
  fix_repositories:
    - repo-a
    - repo-b
  verification_repositories:
    - repo-a
    - repo-b
    - repo-c
```

这些最终确认的工程事实由 `spec-preparation` 写入同一 Corrective `proposal.md` 与 `tasks.md`：Proposal 持有问题 / 根因 / 修复 / 回归 Contract，Tasks 持有 Implementation 与 Verification 工作；确需长期补录既有行为时再生成 Delta Spec。Method Output 不自动生成 `bug-analysis.md`。

Repository 数量不改变 Change Kind。根据本轮风险和独立性要求，同步按 [§10](#analysis-section-10) 形成 Verify Agent Recommendation；不把 Integration / E2E 测试类型直接等同于 Verify Agent。

<a id="section-7-2"></a>

## 7.2 Corrective 专业一致性检查

`bug-analysis` 保留 `Hypothesis → Evidence → Verification → Conclusion` 的诊断闭环。Corrective 不增加独立 Reviewer Skill，也不表示取消语义检查。

Preparation 提交前在当前 Workitem Analyst 的专业执行中检查：

- Expected Behavior 与来源明确，根因结论及证据能够支撑当前 Fix Strategy；Corrective Proposal 未新增未经确认的产品目标；
- Proposal 的 Fix / Regression Scope 与 Tasks 一致；每个 Implementation Task 有自己的验证方式；
- 只有必须组合多个 Task / Module / Repository / System 才能证明的行为才新增 Change-level Verification Task，不为流程角色机械创建 Verification Task；
- Design / Delta（如有）与既定行为和修复范围一致；有 Specs 时 Requirement / Scenario 可测试，省略理由与原生支持一致；
- 当前 Change、Evidence 引用和 Independent Verify Recommendation 可读取；发现偏差时仅修正命中内容及其必要关联。

Corrective 一致性检查只返回 `PASS / NEEDS_REVISION` 与必要 Findings，并记录到当前 Multica Run Result / Comment 等原生事实中，同时引用实际命中的 OpenSpec Artifact；不创建独立 `Corrective Consistency Result` 对象，也不强制新增 `corrective-review.md`、Preparation Result Markdown、独立 Review Agent、Stage 或 Gate。Gate 消费这些原生事实与引用，不自行证明根因或规格正确。

```text
bug-analysis Method 的证据验证
+ spec-preparation 的 Corrective 一致性检查 / 原生 Validation
+ analysis-completion / Analysis Gate
+ 既有 Human Analysis Review
```

若行为、范围或支撑 Fix Strategy 的关键根因证据仍不足，一致性检查返回 `NEEDS_REVISION`，停止提交审核并按既有 Lead / Human 边界处理；可继续调查或修订草稿。`probable` 是否足以提交审核按 [§7.3](#analysis-root-cause-confidence) 判断，不能仅因保留残余不确定性就一律阻断，也不能因“轻量”而省略必要检查。

<a id="analysis-root-cause-confidence"></a>

## 7.3 Root Cause 可信度与继续执行边界

`root_cause.status`（[§7.1](#section-7-1)）是**专业调查结论**，不是 Multica Issue Status 或新增 Gate 状态：

| 值 | 专业含义 | 实施与审核要求 |
|---|---|---|
| `confirmed` | 根因、故障路径有足够证据支持，Fix Strategy 与验证方式能够针对该原因 | 保留关键 Evidence / Regression Signal 的引用，供 [§7.2](#section-7-2) 一致性检查 |
| `probable` | 有高可信假设及支持证据，但诊断仍存在未闭合环节 | 明示残余不确定性、风险及其对修复 / 验证的影响；不得写成 confirmed；必要 Human 取舍按既有机制处理 |
| `unknown` | 尚无可支撑修复方案的可信根因 | 不得因为 Proposal / Tasks 文件齐全而认定专业分析完成；按 [§7.2](#section-7-2) 停止澄清 |

`probable` 的继续执行边界分为三类动作：

| 动作 | 判断责任与条件 |
|---|---|
| 继续调查或整理 Proposal / Tasks 草稿 | Workitem Analyst 可保留假设、证据和未决项；草稿存在不表示分析通过 |
| 提交 Human Review | Workitem Analyst 在 [§7.2](#section-7-2) 一致性检查中判断：Expected Behavior / 范围明确，证据足以支撑有边界的 Fix Strategy 与验证方案，残余不确定性及风险已明确，且不存在影响正确实现的未决关键事项。满足时可返回 `PASS`，保持根因状态为 `probable`；否则返回 `NEEDS_REVISION` |
| 开始研发 | 一致性检查 `PASS` 只作为 Analysis Gate 的输入；Gate PASS、发布和状态回读完成后进入 Human Review。研发仍须取得 [02](02-multica-delivery-lifecycle-design.md) 规定的正式 Human Approval |

**本节不设置可信度分数或自动放行阈值。** 必要的前置业务取舍沿既有 Lead / Human 接口澄清；最终研发批准仍在既有 Human Review 中处理。Gate 消费当前一致性检查结论与证据引用，不重新判断根因是否正确。无法本地复现时可使用可靠日志、Trace、失败测试或运行记录，但必须说明证据局限。`unknown` 不满足提交条件，`confirmed` 也不能替代一致性检查和其他 Gate 条件。

---


<a id="requirement-analysis"></a>

<a id="analysis-section-08"></a>

# 8. Intentional Requirement Analysis（意图性需求分析）

<a id="section-8-1"></a>

## 8.1 `requirement-analysis`：需求与方案分析

`requirement-analysis` 只处理 Intentional Change。它是一种专业分析方法，不要求生成固定的 `requirement-analysis.md`；目标是把已确认结论直接沉淀到后续真正消费它们的权威位置。

按任务需要澄清：

```text
Requirement Goal / Background
Users / Business Scenarios
Current Behavior / Expected Behavior
Business Rules / Normal, Error and Boundary Scenarios
In-Scope / Out-of-Scope
Clarification / Confirmed Decisions
Solution Exploration / Reuse / Selected Solution
Impact Scope / Repository Scope
Acceptance Contract（Requirement + Scenario）
Development Scope / Constraints
Verification Considerations
Risks / Open Decisions
```

已确认事实、待验证假设、方案建议与需要 Human 决定的事项必须区分。影响正确实现的业务歧义不能留给 Engineer 自行猜测；属于局部实现选择的事项不人为升级为需求决策。

分析结论按 Owner 直接落位：

| 结论 | 权威位置 |
|---|---|
| Why / Goal / Change Scope / Capability 摘要 | `proposal.md` |
| Expected Behavior / Business Rules / Normal、Error、Boundary Scenarios | `specs/<capability>/spec.md` / Delta Spec，以 OpenSpec Requirement + Scenario 表达 Acceptance Contract |
| Selected Technical Approach、关键 Contract / Data / Dependency / 风险处理 | `design.md`（仅在 Conditional Design 条件满足时）；简单变更若无独立技术决策则不生成 |
| Implementation Task、每 Task Verify、按需 Change-level Verification Task | `tasks.md` |
| Development Scope / Repository Scope | `proposal.md` / `design.md` / `tasks.md` 中按实际职责表达；不另建第二份技术范围 |
| Technical Risks / Dependencies / Open Decisions | 需要独立 Technical Design 时进入 `design.md`；否则保留在其自然 Owner（Proposal / Spec / Tasks / Evidence），未决 blocker 不靠 Handoff Facts 掩盖 |
| Verify Recommendation / Reason / Focus References | Multica Analysis Handoff Facts；只引用当前 OpenSpec Acceptance / Verification Contract |
| Evidence References | 对应 OpenSpec Artifact / Supporting Evidence；Analysis Package 只引用，不复制 |
| 大量复杂调查上下文 | `context-pack.md`，仅在 [§6](#analysis-section-06) 条件满足时生成 |

因此不再维护一份与 Proposal / Spec / Design / Tasks 重复的固定 `requirement-analysis.md`。确有复杂业务决策历史或需要长期保留的补充说明时，可作为 Supporting Evidence / Decision Record 保存，但它不是标准必需 Artifact，也不是 OpenSpec Apply 前置。

Requirement / Scenario 与 Tasks 明确后按 [§10](#analysis-section-10) 形成 Independent Verify Recommendation；后续规格准备改变相关范围、行为、Verification Task 或风险时同步更新。Workitem Analyst 在 Intentional 专业 Review 中审查当前 Proposal / Specs / Tasks、存在时的 Design、Verify Recommendation 与 Evidence references，不依赖固定 Requirement Analysis 文件。

`requirement-analysis` 不处理：

```text
Corrective Root Cause
Agent Assignment
Development Sub-Issue / Stage
完整 Runtime Task Graph
```

## 8.2 Solution Decision（方案决策）与研发细节边界

对于存在实质取舍的 Intentional Change，不只是列出 Solution 名称；应按实际需要说明：可复用能力 / 主要备选方案、选定方案的依据、对用户场景和外部 Contract 的影响、关键依赖与风险，以及哪些决策仍需 Human 确认。这些内容直接维护到 [§8.1](#section-8-1) 的相应 OpenSpec Owner，不强制另建 `solution-analysis.md` 或完整设计备忘录。

**专业完成信号**：Goal / Scope 与可测试的 Requirement / Scenario、Selected Solution 和 Verification Considerations 保持一致；关键业务行为、权限与数据规则不留给 Engineer 猜测。类 / 函数拆分、局部算法、测试组织等实现细节由 Engineer 在批准边界内细化，分析阶段不为形式提前冻结。

---


<a id="openspec-change-contract"></a>

<a id="analysis-section-09"></a>

# 9. OpenSpec Preparation 与 Analysis Engineering Contract

Corrective 与 Intentional 统一采用 OpenSpec Change Model。Schema 直接映射 **Technical Change Kind（技术变更类型）**，不是 TFS Type 或独立执行路径：

```text
change_kind = corrective
→ schema = corrective-change

change_kind = intentional
→ schema = intentional-change
```

Schema ID 采用项目规范的 kebab-case `<technical-change-kind>-change` 命名。超出自动处理范围的复杂需求仍须交 Human；只有 `corrective-change` / `intentional-change` 是当前自动交付的有效 Schema。其他 Schema（包括 `sdd`）不自动放行，也不建立历史兼容策略。

| 工作性质 | 分析方法 | OpenSpec Schema | Change 产物表达 | Analysis 专业检查 |
|---|---|---|---|---|
| Corrective：恢复有依据的既定行为 | `bug-analysis` | `corrective-change` | Corrective Proposal、Specs（可合法 skip）、Tasks；独立 Design 不作为默认节点 | 根因验证与必要的 Corrective 一致性检查 |
| Intentional：计划性变更 | `requirement-analysis` | `intentional-change` | Proposal、Tasks 必需；有 Spec-level Delta 时生成 Specs，否则可合法 skip；Design 满足条件时生成 | Workitem Analyst 专业 Review |

两种方法都复用当前 Context 与已形成结论，直接形成其权威产物；不是先完成一套完整详细分析 / 设计 / 计划，再在 OpenSpec 中重写。Workitem Analyst 和 Engineer 仍在独立 Agent / Run 中执行；必要文档、批准后的持久化与接收方读取属于交接基线，不以节省 Token 为由合并角色或省略必要证据。

<a id="section-9-1"></a>

## 9.1 OpenSpec Change 身份与可读取性

每个处于获准自动处理的 Change 的 Issue 默认维护一个唯一 active Change：

```yaml
analysis:
  change_ref:
    id: <stable-change-id>
    path: openspec/changes/<stable-change-id>
    schema: corrective-change | intentional-change
```

Change ID 与 Schema 在首次 Preparation 时确定，同一 Delivery 的 Human Reject、分析修订、工程返工均更新同一 Change；不得因为进入另一个 Agent / Run 重新选择 Schema。Change 的确定性查找、创建与恢复遵循 [05-openspec-schema-implementation-design.md](05-openspec-schema-implementation-design.md) 的 Change Identity Contract：正常路径优先读取已保存 `change_ref`，缺失或路径失效时 active-first、archive fallback；重复、损坏或 Schema 冲突不得猜测，只有明确 `NOT_FOUND` 才允许创建。

当前模型仍是一个 Delivery 默认拥有一个 active Change，不引入多个 Delivery 共用可写 Change 的完成 / 审批聚合。修复与另一个尚未完成的 Change 有关时，可以引用它的批准依据或规格，但不能让一个 Bug 的关闭归档另一个 Delivery 的 Change，也不把未批准提案当作既定行为。一个 Change 的 Tasks 可以被多个 Engineer Run 按 `task_refs` 分工消费，边界见 [§9.5](#section-9-5)。

OpenSpec Artifact 与实际需要随 Change 保存的 Supporting Evidence 置于该 Change 目录；调查过程可先形成临时结果，Preparation 将最终确认的 Corrective 工程事实写入 `proposal.md`，不维护 `bug-analysis.md` 内容副本。`bug-analysis` 是 Analysis Method，不是 Schema Artifact。`context-pack.md` 仅在 [§6](#analysis-section-06) 条件满足时作为项目附加 Supporting Evidence 生成，Gate 检查的是 Context Evidence 可追溯性而非固定文件存在。外部大日志、测试记录使用持久化证据引用，不为“同一容器”复制完整原始资料。

路径是项目根仓布局约定，实际写入前与原生解析结果及登记根仓核对，不因 CLI 的其他 planning home 默认值将文件写到未登记位置。内部文档使用相对引用；外部引用应能跨 Run 读取。Archive 后原 Change ID 不变，当前路径回填与恢复归[主方案 §12.4](02-multica-delivery-lifecycle-design.md#final-completion)。

## 9.2 Corrective / Intentional Artifact 语义

#### Corrective（纠正性变更）

Corrective 采用 rapid-style 轻量 Artifact Graph（工件依赖图）：`proposal → specs/skipped → tasks`。`bug-analysis` 保留为 Method，其最终确认的工程事实进入 Corrective `proposal.md`。

Corrective 的 Specs 是否生成由“本次是否需要更新长期行为规格”决定：

| 当前事实 | Spec / Delta 处理 | 技术语义 |
|---|---|---|
| 主规格已正确、完整，代码偏离它；或既定行为已有可靠来源且本次不更新规格文本 | 使用合法 `skip_specs: true` | Corrective，不伪造行为变化 |
| 修复揭示遗漏场景，能够证明是既有约束的补录 / 澄清 | 形成必要 Delta，以 Requirement + Scenario 表达长期行为 | 可以仍为 Corrective，不以存在 Delta 自动改变 Change Kind |
| 已有规格错误、来源相互冲突或无法确认正确预期 | 先调查 / Human 澄清 | 结论未明前不能声明准备完成 |
| 实际需要主动改变 Expected Behavior / Contract / Requirement | 停止当前 Corrective 准备，重新确认 Change Kind / Schema / Human Review | Intentional，不借修复名义扩展范围 |

`skip_specs: true` 是 OpenSpec 1.13.2 的原生持久化事实；Specs 显示 skipped，并可满足下游依赖和 `apply.requires`。若 Delta 文件与 `skip_specs` 同时存在，Validation 必须失败；不得用“任务小”“时间紧”或“修复路线”替代语义判断。

Corrective 没有 Specs 时，不创建平行 Acceptance / Verification 文档。Expected Behavior、Failure / Regression Scope 保留在 Proposal；每个 Implementation Task 写明自己的验证方式；必须组合多个 Task / Module / Repository / System 才能证明的行为才增加 Change-level Verification Task。

Corrective 无 Specs 时，OpenSpec Native Verify 的 Spec-dependent checks 不适用，不能伪装为已验证；修复正确性主要由 Task Verification、Regression Evidence 与实际候选版本证明。

#### Intentional（意图性变更）

`intentional-change` 遵循 OpenSpec 原生 `skip_specs`：存在 Spec-level 行为变化时必须生成 Delta Spec，并以 Requirement + Scenario 表达 Acceptance Contract；仅当本次没有 Spec-level 行为变化时允许显式设置 `skip_specs: true`。不得为了校验编造 Requirement，也不得用 skip 隐藏行为变化；验证执行要求由 `tasks.md` 承接。

`intentional-change` 的 `design.md` 为 **Conditional Artifact（条件式工件）**，沿用 `spec-driven` 的原生判断：只有存在跨模块 / 新架构模式、新外部依赖 / 显著数据模型变化、Security / Performance / Migration complexity，或存在需要在编码前固化的 Technical Ambiguity 时才生成。条件不满足时明确省略 Design 并继续形成 Tasks；不创建空 Design，也不增加 `skip_design`、`design_required` 等第二套状态。

<a id="openspec-configuration"></a>

## 9.3 Schema 使用基线与实现权威

当前锁定 OpenSpec `1.13.2`。`corrective-change` 默认 `proposal + specs/skipped + tasks`；`intentional-change` 为 `proposal + specs/skipped + tasks + conditional design`。Intentional 的 `design.md` 只有满足技术设计条件才生成；Corrective 没有 Spec-level 变化时使用合法 `skip_specs: true`，不伪造 Delta。已存在的 `sdd` Schema 不映射到当前 Intentional。

项目级 `schema.yaml`、Artifact Graph、Template / Instruction、`artifact.requires`、`apply.requires` / `tracks`、CLI 原生状态、Change Resolver、Task parser、Validation / Archive 的**实施级权威**是 [05 — OpenSpec Schema Implementation Design v1.5.2](05-openspec-schema-implementation-design.md)，本方案不另维护 Schema YAML 或第二份解析契约。执行前验证 `openspec --version` 和项目 Schema 的实际解析来源；CLI 返回成功 / Apply Ready 都不等于 Analysis Gate PASS 或 Human Approval。

`openspec/config.yaml` 的公共 context / rules 与各 Schema 专属 instruction / template 的边界遵循 [05 §2.6 公共配置与 Schema 专属规则](05-openspec-schema-implementation-design.md#shared-config-schema-rules)，避免两套 Schema 共享 Artifact ID 时发生规则串扰。

[05](05-openspec-schema-implementation-design.md) P0-2 已按 Native First 收口：不使用强制 `T-xxx` / `Verify:` Grammar，也不建立 `AC-xxx` / `VR-xxx` Identity。`focus_refs` 按现有 Spec 路径 / Heading 与当前已批准任务编号定位，具体校验归 [05](05-openspec-schema-implementation-design.md)；本阶段不重复实现 Parser。

<a id="analysis-task-contract"></a>

## 9.4 `spec-preparation`：工程契约准备

`spec-preparation` 是获准自动处理的 Change 共用的 Change 准备方法。它消费已有专业结论，形成同一 Change 的适用 OpenSpec Artifact 与可确认准备事实；不新建 Agent / Multica Stage，也不要求 Workitem Analyst 与 Engineer 共用 Run。

Corrective 依 [§9.6](#section-9-6) 将 `bug-analysis` 的最终结论写入 Corrective Proposal / Tasks，不生成平行 Bug Analysis Artifact；Intentional 将 `requirement-analysis` 的结论直接维护到 Proposal / Specs / Tasks，并仅在 Conditional Design 条件满足时维护 `design.md`。

### 输入

```text
当前 Issue 身份、Change Kind 与 Change Intent
可复用 Context Evidence / Supporting Evidence（如有）
Corrective：Expected Behavior 来源 / Root Cause Evidence / Fix Strategy / Regression Scope
Intentional：已确认 Goal / Requirement / Scenario / Rules / Scope / Selected Solution
当前 Development Scope / Repository Scope / 技术约束
当前 Verification Considerations / Independent Verify Recommendation
已有 Change 引用与适用主规格（如有）
原生 Schema / 项目配置 / 安装版本可用能力
```

### 按需准备（New / Prepare / Revise）

`New`、`Prepare`、`Revise` 是同一 `spec-preparation` Skill 依据当前任务选择的场景，不是三个固定 Stage、Run 或必须依次执行的步骤：

| 场景 | 适用条件与必要行为 |
|---|---|
| New | 经 `rondo change resolve-identity` 确认 `NOT_FOUND`，且身份、Schema 与创建授权明确时，使用 OpenSpec CLI 创建唯一 Change 并回读；创建目录不等于准备完成 |
| Prepare | 在新建或已存在的 active Change 上，根据当前 Schema、`apply.requires` 及 Artifact `requires` 传递依赖、条件性 Design 和**实际文件集合**补全必要工件；复用已有效内容 |
| Revise | 已有明确修订请求且仍在本次授权及批准边界内时，仅修订受影响工件，并核对必要上下游依赖、Tasks 和 Verification；越权的业务决策或已批准契约变更须停止并请求确认 |

准备期间必须核实唯一 Change 与根仓、项目级 Schema 及 OpenSpec 版本，明确设置 CLI 的根仓 `cwd`，并使用原生 `status / instructions / validate` 及当前专业 Evidence。对 `specs/**/*.md` 等 Glob，不因 `specs=done` 就假定 Proposal 声明的所有 Capability Spec 已齐全：按**具体文件路径**核实预期集合，只补缺失或获授权修订的文件。Conditional Design 的适用性是专业判断；需要时先形成关键 Design 决策再定稿相关 Tasks，不需要时不制造空文件。只有原生事实允许且业务行为确无 Spec-level Delta 时才能 `skip_specs`。

按当前需要维护 Corrective Proposal / Tasks 或 Intentional Proposal / Specs / Conditional Design / Tasks；每项 Implementation Task 说明可执行的验证方法，必要时才补 Change-level Verification Task。定向返工复用同一 Change，不重做有效专业分析；未确认的身份、授权、业务选择、真实文件路径或 CLI 结果必须安全停止。准备完成后回读原生状态和 Validation；Corrective 做必要专业一致性复核、Intentional 由 Analyst 做专业 Review，最终通过 `analysis-completion` 收口。具体执行细节以现行 `workspace-skills/spec-preparation/SKILL.md` 为准。

当前 Schema 适用范围摘要：

```text
corrective-change
= proposal + specs/skipped + tasks

intentional-change
= proposal + specs/skipped + tasks + design（conditional）
```

Intentional 的 Proposal / Tasks 为稳定必需 Artifact；Specs 有 Delta 时生成，否则合法 skipped；Design 为 Conditional Artifact，只在原生条件满足时生成，不使用 `skip_design` 或额外状态字段。Corrective 的 `bug-analysis` 是 Method，不是 Artifact；其 Proposal 是完整 Corrective Engineering Contract，而不是 Bug Analysis 的摘要副本。

### 输出与权威来源

Preparation 不要求创建 `preparation-result.md`。已持久化的 Change 引用以 [§9.1](#section-9-1) 的 `analysis.change_ref` 为准；准备检查只返回当前运行使用的最小结果（示意，非新增持久化 Metadata Schema）：

```yaml
change_ref: <reference-to-analysis.change_ref>
validation: PASS | FAIL | UNKNOWN
state_ref: <native-openspec-state-reference>
```

Required / Conditional / Skipped 直接读取当前 OpenSpec Schema、Artifact Instruction 与 Artifact State（经 OpenSpec status 获取），不在 Multica Handoff Facts 中再持久化 `spec_required`、`design_required` 或 `skip_design` 等平行状态。`intentional-change` 的 Specs 有 Delta 则生成，无 Delta 可合法 skipped，Design 按条件生成或省略；`corrective-change` 的 Specs 可合法 skipped，Design 不属于默认 Schema Artifact。

同时保留任何合法省略的理由、Evidence / Finding 引用与 Corrective 一致性结果。原生 Validation 不能代替 Requirement / Scenario 的语义质量、Corrective 根因与修复结论、Task Verification 或 Human Approval。

### 任务—行为—验证对应

`tasks.md` 正式允许两类 OpenSpec Task：

```text
Implementation Task
Verification Task
```

规则：

1. 每个 Implementation Task 都必须说明自己的验证方式；
2. 能在单个 Task 内闭合的 Unit / Regression / Integration / Browser / API 等验证，不创建额外 Verification Task；
3. 只有必须在多个 Task / Module / Repository / System / User Journey 组合完成后才能证明的行为，才增加 Change-level Verification Task；
4. Regression / Integration / E2E 是 Verification Method，不等于 Verify Agent；
5. Verification Task 的责任执行者由后续 Multica Runtime Projection 决定，可以是 Engineer，或在已批准 Independent Verification 与该 Task 范围重合时由 Verify Agent 承担；CI / script / test runner 只作为执行机制，不作为 Task Owner。

示例：

| 分析依据 | Tasks 中的工程动作 | 验证方式 |
|---|---|---|
| Corrective：无查询结果应返回空列表；证据定位转换异常 | 1.1 修正转换并增加失败回归 | 原 Failure Signal 修复前失败、修复后通过；无需额外 Verification Task |
| Intentional：前后端共同形成导出权限链路 | 1.1 Backend、2.1 Frontend | 两项各自验证；若只有组合后才能证明完整行为，再增加 3.1 Change-level E2E Verification |

### 停止与职责边界

不决定 Roster、Owner、Sub-Issue、Stage 或 Assignment，不执行生产代码和 Archive。原生结构 / 配置不兼容、身份 / 权限不明或必要 Artifact / Result 不可读取时，停止准备完成声明并报告具体缺口；保留有效分析，不默默改为无 Change 流程，不复制解析器或新建 Schema 兜底。

现行 `spec-preparation/SKILL.md` 已实现上述按需准备方法；根因分析仍属于 `bug-analysis`，Intentional 专业 Review 由 Workitem Analyst 负责，提交与有限状态写入仍属于 `analysis-completion`.

<a id="section-9-5"></a>

## 9.5 Engineering Decomposition 与 Runtime Projection 的边界

Workitem Analyst 在 `tasks.md` 形成 Implementation Tasks、每 Task Verification、必要的 Change-level Verification Tasks，并提供技术依赖、Repository / Module Scope 与约束；**不**决定最终 Task Set、成员派发或 PR。`tasks.md` 是 Engineering Truth，不是 Multica 状态或 TFS Task 的一对一映射。

Human Review 通过后，Delivery Lead 依据已批准 Change / Tasks、技术依赖、Repository Scope 和当前 Roster 组织 Task Set，并在当前 Issue 上通过 `@mention + task_refs` 派发；Task Set 只是 OpenSpec Task 引用集合，不拥有独立对象或状态，也不增加单独批准步骤。跨仓、并行、多工程师或多 PR 不要求创建其他 Issue；具体规则见 [02 主方案 §7–§8](02-multica-delivery-lifecycle-design.md#development-materialization)。

当 Engineer 并行消费同一 Change 时，任务编号定位与 checkbox 的受控更新契约由 [05 §10](05-openspec-schema-implementation-design.md#openspec-schema-section-10)–[§11](05-openspec-schema-implementation-design.md#openspec-schema-section-11) 维护，其中更新与串行化规则见 [05 §11 Task Progress Update](05-openspec-schema-implementation-design.md#task-progress-update)；不需要新建 `T-xxx`，Analysis 不重复设计单写者机制。

<a id="section-9-6"></a>

## 9.6 Corrective Proposal、Tasks 与轻量交接

适用于 Corrective。本节维护项目级 **`corrective-change` Schema 的专业内容契约**；Schema 不等于新 Workflow、Stage 或 Skill。

### 内容与文件归属

| 产物 | 内容 / 权威归属 | 不重复维护 |
|---|---|---|
| `proposal.md` | Problem / Scenario、Expected vs Actual 与预期来源、Failure Path、Root Cause / Status / Evidence、Fix Strategy / Fix Scope、Repository Scope、Regression Scope、Impact / Specification Relation | 不塞入完整调试日志；具体工程 checklist 只在 Tasks；Independent Verify Recommendation 进入 Multica Handoff Facts |
| `tasks.md` | Implementation Tasks、每 Task Verification、按需 Change-level Regression / Integration / E2E Verification Tasks | 不复制 Root Cause 论证，不塞入审批、等待 Agent、PR / Archive |
| `specs/<capability>/spec.md`（条件性） | 本次需要长期保留的既定行为补录 / 澄清，以 Requirement + Scenario 表达；无规格级变化时使用合法 `skip_specs` | 不写故障日志、代码行、诊断过程，不为通过校验制造 Delta |
| `context-pack.md`（条件性 Supporting Evidence） | 仅在 [§6](#analysis-section-06) 的复杂上下文 / 长 Evidence Chain 场景生成 | 不作为每个 Corrective Change 的固定文件，不复制完整会话或大日志 |
| Supporting Design（条件性、非 Schema Artifact） | 复杂修复确需独立技术设计时保存并显式引用 | 不把它升级为所有 Corrective 的默认前置 |

默认布局：

```text
openspec/changes/<change-id>/
├── .openspec.yaml
├── proposal.md
├── tasks.md
└── specs/<capability>/spec.md   # 本次确有 Delta 时；否则合法 skip_specs
```

`bug-analysis` 继续作为 Method，不生成 `bug-analysis.md`。外部 Evidence 不强制搬入 Change 目录，但必须持久化且跨 Run / 归档后可访问。

### 轻量准备与交接

`bug-analysis` 形成诊断结论、Regression Signal 与 Fix Strategy；`spec-preparation` 将最终确认事实写入 Corrective Proposal，并形成 Tasks / Verification。Proposal 是 Corrective Change 的主 Engineering Contract，不再只是 Bug Analysis 摘要。

有 Specs 时，以 Requirement + Scenario 作为 Acceptance Contract；无 Specs 时，以 Proposal 的 Expected Behavior / Regression Scope 与 Tasks 的 Verification 形成修复验收依据。不得另建 `acceptance.md`、`verification-requirements.md` 或 `AC-xxx` / `VR-xxx` Identity。

Multica Analysis Handoff Facts 只保存 Change 引用、Independent Verify Recommendation / Reason / Focus 引用、Review / Gate 等 Delivery Facts；技术 Risk / Open Decision 与 Evidence 继续由对应 OpenSpec / Supporting Artifact 作为唯一技术事实来源。

交接必须让独立 Engineer Run 读到当前 Change / 已批准基线、自己的 Tasks 与 Repository / `task_refs` 范围、Root Cause / Fix Strategy、Regression Scope 以及当前 Verification Contract。只依赖 Workitem Analyst 会话、临时目录或不可定位的相对路径不满足交接。

### 完成边界

进入 Human Review 前，必要 OpenSpec Artifact、Multica Analysis Handoff Facts 和实际需要的 Supporting Evidence References 可读取；原生 skip / Validation 一致；[§7.2](#section-7-2) 检查无未解决关键问题；每个 Implementation Task 有验证方式，必要 Change-level Verification Task 已建立；Independent Verify Recommendation 完整。完整交付仍需工程、必要 Verification、业务 PR、[主方案 §12.4](02-multica-delivery-lifecycle-design.md#final-completion) 的 Archive / 根仓 Commit / 引用恢复。

## 9.7 Intentional 逻辑 Analysis Package

Intentional 的 Analysis Package 是逻辑集合，不创建 `analysis-package.md`：

```text
Analysis Package
├── OpenSpec Change (`intentional-change`)
│   ├── proposal.md              REQUIRED  # Why / Goal / Scope
│   ├── specs/...                CONDITIONAL # 有 Spec-level Delta 时生成，否则 skipped
│   ├── design.md                CONDITIONAL # 仅存在真实 Technical Design Decision 时生成
│   └── tasks.md                 REQUIRED  # Implementation + task-level / change-level Verification
├── Multica Analysis Handoff Facts
│   ├── Change Kind / Change Reference
│   ├── Independent Verify Recommendation / Reason / Focus References
│   ├── AI Review Verdict / Findings Reference
│   └── Analysis Gate Result / Reasons Reference
└── Supporting Evidence References（按需）
    └── context-pack.md / external evidence 等
```

Intentional 有 Delta 时以 Requirement + Scenario 为行为与验收契约；合法跳过 Delta 时依照批准 Proposal、适用现行长期 Specs 和 Tasks 的验证要求，不制造新的 Spec Coverage。验证执行要求由 Tasks 承载。Multica Analysis Handoff Facts 只保存 Independent Verify 决策与必要引用，不复制规格正文。

`requirement-analysis` 提供专业需求结论，`spec-preparation` 将已确认内容写入上述权威工件，不要求 `requirement-analysis.md`。Workitem Analyst 的 Intentional 专业 Review 输出最小 AI Review Verdict / Findings，并记录为 Multica 原生 delivery fact；不要求 `requirement-review.md`，也不建立独立 Review Result 生命周期。

OpenSpec Artifact 是后续规格驱动实现与验证的主要技术依据。Multica 只保存必要 Result、引用与 Review / Delivery 事实，不复制整套 OpenSpec 内容。

## 9.8 Preparation 的专业完成信号

在提交 [§11](#analysis-section-11)–[§12](#analysis-section-12) 之前，当前待审 Change 应充分到：批准后，下一位**独立的** Engineer 可据此回答：**实现什么、为什么、哪些行为 / 范围不能改、在哪些 Repository / Module 内实现、怎样验证正确**。这是一项准备质量要求，不要求提交审核前已有 Human Approval 或提前启动 Engineer。Intentional 的 Requirement / Scenario 应与 Tasks 对应；Corrective 的 Expected Behavior、Root Cause / Evidence、Fix / Regression Scope 应与 Tasks 对应。Schema / CLI Validation 只能检查其可确认的结构和状态，不能替代以上专业充分性判断。

如果准备时发现目标、根因或业务规则尚不可靠，应返回 [§6](#analysis-section-06)–[§8](#analysis-section-08) 的相应方法，并修订同一 Change；不得为了凑齐 Artifact 而跳过调查、制造虚假 Delta 或复制第二套 Requirement / Design / Plan。

---


<a id="verify-recommendation"></a>

<a id="analysis-section-10"></a>

# 10. Independent Verify Agent Recommendation

<a id="section-10-1"></a>

## 10.1 Verify Agent Recommendation

Workitem Analyst 在本轮 Analysis 中提出是否需要 **Independent Verify Agent** 的建议。Recommendation 是 Multica Analysis Handoff Fact；它不定义“验什么”，只决定是否需要在 Engineer 已借助必要 CI / deterministic tooling 完成开发侧 Verification 之外，再增加一个独立验证执行者。

Verification Contract 由 OpenSpec Engineering Truth 提供：Intentional 主要来自 Requirement / Scenario 与 Tasks；Corrective 主要来自 Proposal 的 Expected Behavior / Regression Scope、条件性 Specs 与 Tasks。`analysis-completion` 只汇集已有 Recommendation，不在收口时首次补做专业判断。

### 输出契约

```yaml
analysis:
  verify_agent:
    recommendation: required | not_required
    reason: ...
    focus_refs:
      - <requirement-or-scenario-ref>
      - <task-number: 1.1>
```

`recommendation` 表示是否建议增加独立 Verify Agent；`reason` 说明独立性的工程理由；`focus_refs` 引用当前分析版本、待提交审核的 OpenSpec Acceptance / Verification Contract，不以预先取得 Human Approval 为条件，不复制正文，也不创建 `AC-xxx` / `VR-xxx` Identity。批准后的执行按获批契约消费引用；返工导致相关内容变化时按 [§10.1](#section-10-1) 的检查与修订规则复核。Requirement / Scenario 使用现有 Spec 路径及原生 Heading 组合定位；按需引用的任务使用 `change_ref` + 当前可读编号，不要求 `T-xxx`。

Workitem Analyst 是 `verify_agent` 的首次专业判断者，只输出 Recommendation、Reason 与 Focus，不预先写最终 `verify_agent.required`。Human Analysis Review 拥有最终决定权，可以接受或 override Recommendation；批准后的 Development Materialization 根据 Human 最终决定生成 `verify_agent.required=true|false`。因此 `verify_agent.required` 不要求与原 Recommendation 相同；`verification.result` 仅在 `verify_agent.required=true` 时表示 Independent Verification（独立验证） 的结果。批准、转换及执行边界见 [主方案 §9.1](02-multica-delivery-lifecycle-design.md#verify-agent-decision) 与 [§13.1](02-multica-delivery-lifecycle-design.md#delivery-facts)。

### 推荐方法：独立验证增量价值判断

Independent Verify Agent 是在 Engineer 已承担 Task-level / 必要 Change-level Verification、Local Validation 和 Code Review 之外，按需增加的独立执行者。**常规情况下优先考虑 `not_required`；`required` 必须有能说明独立性必要性或实质增量价值的理由。** 这不是允许跳过开发侧验证，也不是对未调查事项预填 `not_required`。

Workitem Analyst 根据当前已确认的 Acceptance / Verification Contract 与可获得的 Evidence，按实际问题判断三件事（不是固定三步流程）：

1. **明确的独立性要求**：是否存在已确认的业务验收、合同、安全隔离或授权要求，必须由实现者之外的主体检查？若存在且适用于当前 Change，推荐 `required`，引用具体要求。
2. **开发侧验证充分性**：已规划的 Task Verification、必要 Change-level Verification、CI / Automated Tests / Runtime Checks 能否有效覆盖正确行为、关键回归和失败模式？能闭合且无重大剩余风险、不存在明确独立性要求时，推荐 `not_required`。分析阶段判断的是**验证方案是否可执行、可观察**，不提前假定未来测试已 PASS。
3. **独立执行者的增量价值**：存在显著剩余风险时，是否必须由实现者之外的独立执行者复核，才能发现 Engineer 使用现有测试账号、权限、环境、数据对账和自动化工具仍无法充分消除的重要风险？只有独立执行者的实际增量价值明确、与风险相称时，推荐 `required`。需要第二账号、隔离环境或 E2E，本身都只是验证方法，不等于必须增加 Verify Agent。

**信号不等于判据：** Bug/Requirement、Change Kind、生产故障、关键业务路径、Security / Permission / Data Integrity、Repository / Engineer 数量、独立测试账号/环境，以及 Regression / Integration / E2E 测试类型，均不能单独决定 `required`；应判断实际影响、开发侧覆盖缺口，以及**实现者之外的独立执行者**能增加什么可观察证据。

| 代表性场景 | 推荐方向 | 判断依据 |
|---|---|---|
| 局部 Bug，既定行为与根因明确，针对性回归和 CI 能覆盖 | `not_required` | 修复及回归可由开发侧充分验证 |
| 普通新增字段 / 查询 API / 简单 UI 规则，验收清楚且验证手段可靠 | `not_required` | 不因它属于 Requirement 就增加独立执行者 |
| 多 Repository 接口调整或必要 E2E，已有可执行 Contract / Integration / E2E 验证 | `not_required` | 跨仓和 E2E 是验证范围/方法，不是执行者身份要求 |
| 跨租户访问控制用测试账号和自动化用例即可可靠确认隔离 | 可为 `not_required` | Engineer 使用不同测试身份验证，不自动需要另一个执行 Agent |
| 跨租户访问控制按批准要求必须由独立验收主体复核 | `required` | 需求明确规定实现者之外的验收者，独立性来自执行者的职责隔离 |
| 高影响资金规则或不可逆数据处理，需实施者之外的数据完整性复核 | 倾向 `required` | 错误后果重大且独立对账可减少真实剩余风险 |
| 重大生产故障但已有可信验证信号、覆盖充分且无独立性要求 | 可为 `not_required` | 生产故障标签本身不决定执行者 |
| 业务预期、关键行为或 Verification Contract 尚不明确 | 先补证或澄清 | 不以默认 `required` 掩盖不完整的验收契约，也不臆造 `not_required` |

**输出要求：**

- `recommendation=not_required`：`reason` 简述为什么现有计划中的工程验证足够、没有额外独立性需求；`focus_refs` 指向支撑此判断的当前 Acceptance / Verification Contract。
- `recommendation=required`：`reason` 说明为什么 Engineer 使用现有可靠测试手段仍不足，以及**独立执行者**所需的职责隔离或实际风险降低价值；`focus_refs` 指向必须独立确认的行为、风险或验证要求。
- **事实不足**：先按专业职责补充必要 Evidence / Verification Task，或返回待授权的业务澄清；尚无法形成有依据的 Recommendation 时，不得为了满足字段检查强行提交 `required` 或 `not_required`。

`focus_refs` 沿用当前非空引用数组契约；两种 Recommendation 都引用当前有效的 OpenSpec Acceptance / Verification Contract，不创建新的风险分数字段、验收对象或独立报告。Recommendation 发生实质变化时按现有 Stage / Gate / Review 契约更新，不复用失效的 Evidence。

`not_required` **仅表示不增加 Independent Verify Agent**。全部必需 Task Verification、Change-level Verification、Local Validation、Code Review 和合同要求的其他验证仍必须按实际执行结果完成；任何人不得因为该推荐值减掉既有 Verification Contract。

### Human Override（人工覆盖）边界

Human Review 可以只改变 Independent Verification Decision，而不要求 Workitem Analyst 修改 Recommendation：

```text
Recommendation = professional advice from Workitem Analyst
Human Decision = final delivery authorization
verify_agent.required = materialized Human Decision
```

如果 Human 仅将 `required ↔ not_required` 改为另一结果，且没有新增、删除或改变 Acceptance Contract、Verification Contract、required Verification Tasks 或批准 Scope，则不返回 Analysis；原 Recommendation 保留，Human 决定通过原始 Comment / Decision 引用进入 Delivery Truth。

如果 Human Feedback 实质改变“需要验证什么”——例如新增 E2E 场景、扩大 Regression Scope、增加 Change-level Verification Task、改变 Requirement / Scenario 或批准范围——则必须返回 Workitem Analyst 定向更新 OpenSpec Engineering Truth、复核 Recommendation，并重新提交 Human Review。

### 检查与修订

Recommendation 与当前 Goal、Scope、Requirement / Scenario、Corrective Regression Scope、Tasks 和风险保持一致；这些事实发生实质变化时同步复核 Recommendation。语义充分性由专业分析 / Review 处理，Analysis Gate 只检查字段、取值、必要引用和已有结果，不凭字段存在证明推荐正确。

---


<a id="analysis-section-11"></a>

# 11. Professional Review 与 Analysis Gate

## 11.1 Intentional Professional Review（Workitem Analyst 专业审查）

Workitem Analyst 针对 Intentional 的需求结论及当前 OpenSpec Change 完成必要的只读专业 Review；这是一项专业活动，不要求独立 Reviewer Skill / Agent / Run：先确认需求与问题是否清楚，再检查规格、设计、任务和 Verification Contract 是否一致、完整、可实现、可验证；不以文件齐全或技术方案可编码代替需求质量审查。

读取：

```text
OpenSpec Change Reference
proposal.md
spec / delta spec（Requirement + Scenario）
design.md（仅在满足 Conditional Design 条件时）
tasks.md（Implementation + Verification）
Analysis Handoff Facts
  - Verify Agent Recommendation / Reason / Verification Focus
  - Review / Gate refs
Supporting Evidence（如有，例如 context-pack.md）
```

Review 至少检查：

```text
需求目标、相关使用者 / 业务场景及期望结果清楚
业务规则、正常 / 异常 / 边界场景、In-Scope / Out-of-Scope 足以指导实现
关键业务歧义和需人工决定的事项未被假设掩盖
Proposal 的意图与范围与 Spec 一致
Requirement / Scenario 准确表达行为变化且具备可测试性
Tasks 与规格对应，足以指导实现与验证
满足 Conditional Design 条件时，Design 记录必要技术决策且深度与复杂度匹配；条件不满足时不制造空 Design
无 Scope Drift / 未决关键决策
每个 Implementation Task 有自己的验证方式
组合行为需要 Change-level Verification 时已有对应 Verification Task
Tasks 不包含等待审批、等待独立 Verify Agent、PR 合并或归档等运行步骤
原生准备状态 / Validation 与当前 Schema 契约一致
Verify 推荐的理由与 Verification Focus 对应当前行为、Verification Tasks 与风险
```

输出最小 AI Review Verdict / Findings，并记录到 Multica 当前 Issue / Run Result / Comment 等原生事实中；不创建 `requirement-review.md`，也不定义独立 Review Result 对象生命周期。例如:

```yaml
ai_review:
  verdict: APPROVED | NEEDS_REVISION
  findings:
    - id: RF-...
      severity: blocker | major | minor
      target_ref: proposal | spec | design | task | verification
      description: ...
  unresolved_blockers: 0
```

Review 通过或退回时引用实际被审 OpenSpec Artifact；不复制 Proposal / Spec / Design / Tasks 的正文。按 Finding 和新证据决定必要复核深度。`NEEDS_REVISION` 只对 Finding 命中的 OpenSpec Artifact / Multica Handoff Fact 及其必要关联内容做 targeted rework，继续使用同一个 active OpenSpec Change，不新建平行 Change。

`ai_review.verdict=APPROVED` 只表示 Workitem Analyst 的 AI Review 通过；最终仍必须进入 Human Analysis Review。

<a id="analysis-gate"></a>

## 11.2 Analysis Gate：确定性检查与返回

Analysis Gate 只执行确定性检查并返回结果，不发布产物、不修改 Issue Status、不授予研发权限。完整 Analysis 质量要求同时包含 Workitem Analyst 的专业 Review 与现有 Gate；不能把专业判断都描述为已由 CLI 自动检查。当前 `rondo analysis validate` 主要检查身份 / Change Kind 与 Schema、Change 和 Proposal / Specs / Tasks 的基本存在及格式、合法原生 Specs skip、Task 预估尾注、Verify 推荐字段、Intentional `ai_review` 结果字段及 OpenSpec Validation。它**不逐一核对 Proposal 声明的 Capability Spec 文件集合，不判定 Conditional Design 是否必要，也不评价 Root Cause、Task Verification 或 AI Review 的专业语义质量**。准备与 Review 应先完成这些必要判断，再由 Gate 约束它实际可核实的事实。**即使确定性 Gate PASS，只要必要的专业审查未通过，Workitem Analyst 仍不得调用 `analysis-completion` 宣称分析完成或提交审核**；超出自动范围按原有停止规则处理。

### Analysis 完成条件（专业审查 + 当前确定性检查）

以下是整体交付应满足的专业和确定性条件，**不是现行 Rondo CLI 已逐项实现的检查清单**；不可把 Gate PASS 当作所有专业条件均已被机器验证。

```text
Issue / TFS identity、Change Kind 与当前 Change Schema 一致
当前唯一 OpenSpec Change / Schema / 根仓位置可确认
Development Scope / Repository Scope 可从 OpenSpec Artifact 读取
当前 Acceptance Contract 可读取：Intentional 为 Requirement / Scenario；Corrective 为 Proposal Expected Behavior / Regression Scope，存在 Specs 时一并读取
每个 Implementation Task 有验证方式；需要组合验证时存在 Change-level Verification Task
analysis.verify_agent.recommendation / reason / focus_refs 完整且引用有效
Evidence References 可追溯；需要 Supporting Evidence 时对应资料可读取
当前 Schema 的必需 Artifact、合法 skip 与 OpenSpec Validation 一致
适用于当前分析内容的专业 Review / Consistency Result 可读取且通过，无 unresolved blocker
```

Gate 不要求固定 `bug-analysis.md`、`acceptance.md`、`verification-requirements.md`、`context-pack.md`、`requirement-analysis.md`、`requirement-review.md`、Preparation Result Markdown、`analysis-package.md` 或 `gate-result.md`。它检查这些概念对应的真实 OpenSpec Artifact / Multica Runtime Fact / 引用。

### Bug（缺陷） / Production Fix（生产修复）

公共检查加 Corrective 轻量契约：

```text
Corrective Proposal 中 Expected Behavior 来源、Actual / Failure Path 可读取
Root Cause Status、支持当前结论的 Evidence 与 Fix Strategy 存在
Fix Scope / Regression Scope 与 Tasks 对应
每个 Implementation Task 有 task-level verification
组合修复行为需要 Change-level Verification 时已有相应 Task
§7.2 Corrective 一致性检查 verdict = PASS；findings 及其 Artifact 引用可读取，关键 Finding 已解决
适用 Supporting Design / Delta 与修复边界一致；无 Delta 时原生 skip 有效
```

不要求 Requirement Analysis / Requirement Review 或人为制造 Spec / Design。

### SDD-fast（快速规格驱动开发）

公共检查加 Intentional 专业契约：

```text
Proposal 可表达 Why / Goal / Scope
Spec / Delta Spec 以 Requirement / Scenario 表达 Expected Behavior / Rules / Acceptance Contract
Design Decision 已按 Conditional Design 规则处理：条件满足则 `design.md` 存在且内容充分；条件不满足则有明确省略依据且不制造空文档
Tasks 覆盖当前 Requirement / Scenario，且每个 Implementation Task 有验证方式
组合行为需要 Change-level Verification 时已有对应 Task
Structured AI Review Result = APPROVED
无未解决关键语义 Finding / blocker
```

需求清晰度、覆盖、一致性、可实现性及可验证性仍由 Workitem Analyst 专业 Review 判断；原生 Validation PASS 不能替代。

### 结果与有限权限

```yaml
result: PASS | FAIL | UNKNOWN
reasons:
  - ...
```

必要项明确缺失 / 不合法为 `FAIL`，事实 / 身份 / 权限 / 结果无法确认时为 `UNKNOWN`。`PASS` 后仍由 Workitem Analyst 按 [§12.1](#analysis-completion) 发布引用 / Result、写入并回读 `analysis_review`，再等待 Human；不生成 `verify_agent.required`，不等同于获准编码。

Corrective 一致性检查为 `NEEDS_REVISION`、关键结论已失效或 `root_cause.status=unknown` 时，不满足 [§7.3](#analysis-root-cause-confidence) 的**专业提交条件**；`probable` 不自动失败，但须有充分证据和清楚的剩余风险。**现行 `rondo analysis validate` 尚未直接读取 Corrective 一致性 Verdict 或根因可信度来执行这些语义判定**；专业不通过时 Analyst 应修订或停止提交，不得宣称机器 Gate 已自动拦截。确需将它们升级为确定性硬 Gate，须另行明确可读的结果契约并实施测试。现行 CLI 的 FAIL / UNKNOWN 仍按实际检查项返回，禁止绕过。

## 11.3 专业质量、确定性准备与人工批准的分层

| 判断 | Owner | 可依据什么判断 | 不能代替 |
|---|---|---|---|
| Semantic Quality（语义质量） | Corrective 的 `bug-analysis` / 内部一致性检查，或 Workitem Analyst 的 Intentional 专业 Review | Expected Behavior、Root Cause / Evidence、方案与 Spec / Tasks 的准确性、一致性 | 不能仅凭 Artifact 存在或 CLI PASS 认定专业质量 |
| Deterministic Readiness（确定性准备） | Analysis Gate | Issue / Change 身份、必要字段 / 引用、Artifact 状态、原生 Validation、已产生的专业 Verdict 与未解 blocker | 不自行裁决业务需求、根因、方案或批准 |
| Approval（人工批准） | Human；解释与后续流转由 [02](02-multica-delivery-lifecycle-design.md) 的 Delivery Lead 处理 | 人工对当前 Analysis 基线的有效决定 | 不等同于 AI Review、Analysis Gate PASS 或 `analysis_review` 状态 |

这三类判断允许顺序消费结果，但**不能相互替代**；不为此新增 Review Agent、Gate 或审批字段。

[§11.2](#analysis-gate) 中包含语义的条件按以下方式消费，不在 Gate 内通过关键词匹配或再次调用 LLM 重做专业审查：

| 条件 | 专业方法形成的依据 | Gate 的确定性责任 |
|---|---|---|
| 是否需要组合验证、Tasks 是否覆盖当前行为 | Corrective 一致性检查或 Intentional Review 的结论及命中 Artifact / Task 引用 | 核对当前检查通过；依据已确认引用检查对应 Task 与验证描述可读取 |
| Conditional Design 是否适用、内容是否充分 | Preparation 的生成 / 省略依据与适用专业检查结论 | 核对依据及当前结果可读取；按已确认结论检查必要 Design / 引用存在，不自行裁决复杂度 |
| 根因、方案、范围与验证是否一致 | 当前一致性检查 / Review Verdict、Findings 与 Evidence 引用 | 核对通过条件、必要引用及未解 blocker，不自行证明专业结论正确 |

Verification Focus 是展示概念，Analysis 推荐的机器字段统一使用 `analysis.verify_agent.focus_refs`，不新增 `verification_focus` 别名。具体字段持久化适配与引用解析沿用 [02](02-multica-delivery-lifecycle-design.md) / [05](05-openspec-schema-implementation-design.md) 的权威契约；不另造 Markdown Grammar 或 Task Identity。

---


<a id="analysis-section-12"></a>

# 12. Analysis Publish、Human Handoff 与返工

<a id="analysis-completion"></a>

## 12.1 `analysis-completion`：发布与提交审核

`analysis-completion` 由 **Workitem Analyst** 执行，负责组装逻辑 Analysis Package 的引用、调用 Gate、发布 Analysis Handoff Facts / 必要视图并提交 Human Review；完成写入与回读后结束本轮分析，不仅为状态写入另行唤醒 Delivery Lead。

### 输入与有限权限

读取当前 Issue、当前 Change 与来源类型、[§1.2](#analysis-readiness) 的专业准备结果、当前 OpenSpec Change、Multica Analysis Handoff Facts、AI Review Result、[§10](#analysis-section-10) 的 Verify 推荐和关联 Evidence；发现专业缺口交回对应分析方法，不在组装步骤重做完整需求分析。

Workitem Analyst 只可在当前授权分析任务的提交环节写入 `analysis_review`，保持 `assignee = Delivery Squad`。不得自行批准、把提交审核当作研发授权，或将父 Delivery 置为 `done`。

### 执行步骤

```text
确认逻辑 Analysis Package：OpenSpec Change + Multica Analysis Handoff Facts + Supporting Evidence References
→ 调用现有 Analysis Gate（§11.2）
→ PASS 后发布 / 更新权威 Result 与必要引用
→ 渲染面向人的 Summary，不复制完整技术正文
→ 发布 Gate 结果引用
→ 确认 Human 能读取本轮分析及检查结果
→ 写入 Issue.status = analysis_review
→ 回读确认 Issue 状态、Squad Ownership 及发布引用
→ 输出已提交审核的事实，结束本轮分析，等待 Human Review
```

Gate 只返回 `PASS / FAIL / UNKNOWN`，不修改 Issue 状态。Gate PASS 同时引用本次 Issue / Workspace、Change Kind / Schema 和当前 Change 工件摘要。`analysis-completion` 必须读取当前 Change 日志下的真实 Gate Result，检查完整 PASS 项和工件摘要；Gate 后发生工件变更时重新运行 Gate，不能仅将 `facts.json.gate.result=PASS` 视为有效证据。只有发布和状态后置条件均确认后，才能报告“已提交人工审核”；不能以 Gate PASS、命令退出成功或 Run 成功代替。

<a id="analysis-summary"></a>

### 输出与结束边界

Summary 至少展示：

```text
Requirement / Problem Goal and Scenarios
Expected Behavior / Rules / Scope / Requirement-Scenario references or Corrective Regression Scope
Selected Solution / Fix Strategy / Development Scope
Constraints / Open Decisions
Technical Decomposition Suggestion（确有建议时）
Verify Agent Recommendation: REQUIRED | NOT REQUIRED
Reason
Verification Focus / Verification Task references
```

Summary 是 `render(OpenSpec Change + Multica Delivery Facts)` 的人类可读视图，不创建 `analysis-summary.md`，也不作为新的 Truth Source。结构化推荐继续使用 [§10](#analysis-section-10) 的 `required / not_required`。

现有 Result / Artifact 同时说明：当前 Issue、Change Kind、逻辑 Analysis Package / Gate 结果引用、实际回读状态，以及已完成或尚未完成的发布 / 写入动作。正常终点是“分析提交成功，等待人工”，不是“已批准研发”或“Delivery 完成”。

`STOP` 在这个环节仅表示结束本轮自动分析；不会关闭 Delivery，也不将正常等待改为 `blocked`。人工审核后的自然语言理解、状态离开和返工派发由 Delivery Lead 负责，见 [02 主方案 §6](02-multica-delivery-lifecycle-design.md#human-analysis-review)。

### 失败与恢复

| 当前事实 | 处理 |
|---|---|
| Gate FAIL | 按明确缺失项定向完善，不发布为待审成功，不写入 `analysis_review` |
| Gate UNKNOWN、身份 / 必需输入 / 权限无法确认 | 停止提交，说明缺口并交 Delivery Lead / Human；不伪造 PASS |
| Result / Evidence 发布失败，或状态写入失败 / 结果未知 | 保留已确认结果，先回读当前产物和状态再补缺失项；不得声称已进入审核 |
| 同一本轮分析已发布且处于 `analysis_review` | 确认引用后复用，不重复通知、创建附件或切换状态 |
| 重试旧提交时，人工已处理该轮或流程已进入后续返工 / 研发 / 结束 | 不重放旧提交，不覆盖后续状态；当前新委派的返工完成后仍可按 [§12.1](#analysis-completion) 提交新修订 |

当前 Run 有界结束，不驻留轮询人工决定。部分成功的恢复使用现有 Issue、Artifact / Comment 和 Run 记录；正常审核等待不因本方法返回而自动激活研发，真实权限或环境阻塞按既有规则处理。

<a id="section-12-2"></a>

## 12.2 Human Analysis Review：本阶段接口

所有自动 Analysis 均在 [§12.1](#analysis-completion) 的发布、状态写入和回读成功后进入人工审核。正式 Multica Issue Status Key 为 `analysis_review`，正常等待不改为 `blocked`；Key / Display Name 定义见 [统一规范 §1.4.7](01-multica-openspec-design-guideline.md#status-terminology)。

Human 决定是否批准，并对 Verify Agent Recommendation 拥有最终修改权；可以接受 Recommendation，也可以仅 override Independent Verification Decision。Delivery Lead 理解自然语言意见、核对条件并组织后续动作。完整审核、批准 / 退回、状态离开、Verify override 与恢复规则只引用 [主方案 §6](02-multica-delivery-lifecycle-design.md#human-analysis-review)。Workitem Analyst 不自行处理“是否已获准研发”的判断，也不在 Human override 仅改变独立性要求时重写原 Recommendation；不以 AI Review APPROVED、Analysis Gate PASS 或 `in_progress` 代替 Human 授权。

本阶段的后续接口：收到明确分析返工请求时，消费原始意见引用、修正方向和受影响范围，按 [§12.3](#analysis-rework) 定向修订并重新提交；仅局部分工变化由 Delivery Lead 处理，不重做专业分析。

Comment / Reply 的原生路由见 [指导手册：Comment、Mention 与回流](01-multica-openspec-design-guideline.md#mechanism-comments)。不能因评论被触发、回复到某个线程或出现批准关键词，推断已经取得有效人工决定。

<a id="analysis-rework"></a>

## 12.3 Targeted Rework（定向返工）

收到 Delivery Lead 的明确分析修正请求后，读取原始 Human Comment / Finding 引用、修正要求、受影响范围和当前产物；方向不明确或与有效决定冲突时先澄清，不编造拒绝理由，不自动重做全部 Analysis。

| 反馈命中内容 | 当前专业方法 |
|---|---|
| Context / Repository Evidence | `codebase-explorer` |
| 问题场景、Expected vs Actual、Root Cause、Fix Scope（Corrective） | `bug-analysis` |
| Goal、业务场景、规则、Scope、Requirement / Scenario、Solution、Impact（Intentional） | `requirement-analysis` |
| Proposal、Spec、Design、Tasks / OpenSpec Change（全部获准自动处理的 Change） | `spec-preparation`，更新同一 active Change |
| 技术依赖 / 约束、Verification Tasks、Independent Verify Recommendation | 当前 Change 的相关分析部分；推荐按 [§10](#analysis-section-10) 同步修订 |

只修正命中内容和必要关联产物；Requirement / Scenario、Corrective Regression Scope、Tasks / Verification 或 Recommendation 受影响时一并对齐。Corrective 通过 [§7.2](#section-7-2) 的受影响范围一致性复核，Intentional 经 Workitem Analyst 复核受影响工件后，再执行 `analysis-completion` 和当前 Change 的 Analysis Gate，发布修订并回读确认 `analysis_review`，结束本轮返工。

返工授权只允许修订分析，不允许开始编码；`in_progress` 不能单独证明获准研发。Human 意见理解、状态离开与返工派发由[主方案 §6](02-multica-delivery-lifecycle-design.md#human-analysis-review) 维护，本节不复制这套跨角色流程。

---


<a id="analysis-section-13"></a>

# 13. Development Handoff 与职责边界

## 13.1 正式交付输入与责任分界

Workitem Analyst 正式提交可审核的逻辑 Analysis Package：OpenSpec Change、Multica Analysis Handoff Facts 和必要 Supporting Evidence References，并确认审核状态写入。批准后的独立 Engineer Run 消费当前已批准 Change、`task_refs`、相关 Proposal / Specs / Design / Tasks / Evidence，而不是沿用 Analyst 会话。工程交付输入与执行方法见 [04 Development 方案 §3](04-engineer-development-design.md#engineering-input)。

Workitem Analyst 负责需求 / 问题语义、可测试的验收边界、Solution / Fix Strategy、工程范围和技术依赖；不负责成员选择、Sub-Issue 与 Stage 编排、生产代码、独立验证结果、PR 创建合并或最终 Delivery Completion。

## 13.2 Human Approval 与根仓 Git 边界

Analysis Gate PASS、专业 AI Review 通过和 OpenSpec 原生准备完成均不构成研发授权。Human 明确批准后，Delivery Lead 根据 [02 主方案 §6](02-multica-delivery-lifecycle-design.md#human-analysis-review) 落实授权条件、批准基线的根仓 Commit 和研发组织；该根仓 Commit 不创建独立业务 PR。Engineering Contract 的实质变更必须返回 Analysis / Human Review，批准边界内的局部实现细化属于 Engineer。

## 13.3 TFS Task、OpenSpec Tasks 与 PR 的权威归属

**D3-B 现行工程职责契约（2026-11-10）**：Workitem Analyst 只为实施与验证拆分 OpenSpec Tasks；不强制填写 `[预估: Nh]`、不按 TFS 的 6h 限额拆 Task，不负责外部工作量估算或 TFS 工时管理。TFS 管理能力可以使用已批准的 `change_ref + task_refs` 建立管理关联，但不能反向定义任务粒度或 Analysis Gate。与实际旧实现差异、分批消除 TFS 工时消费的顺序见 [D3-B 专项方案](../plans/d3b-external-tfs-management-decoupling-plan-2026-11-10.md)。

TFS Task 的管理与同步遵循相应外部支撑契约；OpenSpec Task 是工程 Checklist，不等于 TFS Task 或独立 Issue。分析结束后由 Delivery Lead 在当前 Issue 中按 `task_refs` 交接，多个 Repository 的 PR Materialization、PR Status Sync 与最终收口由 [02 §7](02-multica-delivery-lifecycle-design.md#development-materialization)–[§12](02-multica-delivery-lifecycle-design.md#section-12) 维护，不在 Analysis 阶段重定义。

## 13.4 Analysis 与 Development 的专业停止边界

Analysis 输出的任务和约束需足以让 Engineer 不重新猜测需求，但不提前冻结类、函数、测试组织等局部实现细节。Engineer 若发现批准的 Expected Behavior、Root Cause、Scope、Contract 或必要验证依据实质不成立，应按 [02](02-multica-delivery-lifecycle-design.md)、[04](04-engineer-development-design.md) 的返工 / 升级接口返回，不由 Engineer 静默修改原 Analysis 决策。

## 13.5 专业停止与恢复的统一判断

| 情形 | 当前阶段处理 | 责任边界 |
|---|---|---|
| 关键行为、业务规则、Root Cause 或范围有歧义 | 返回 [§6](#analysis-section-06)–[§8](#analysis-section-08) 调查与澄清；说明未决决策及影响 | 需要 Human 决定时沿 [02](02-multica-delivery-lifecycle-design.md) 接口升级，不默许实现方猜测 |
| 身份、权限、OpenSpec Schema / Change 或必要 Evidence 无法可靠读取 | 停止受影响的 Preparation / Publish 动作，保留已确认结果并报告缺口 | Gate `UNKNOWN` 不能当 PASS；运行失败不等于专业审查失败 |
| 内容超出自动 Change Kind 或发生实质范围变化 | 停止当前自动准备、重新确认 Change Kind / Schema 与批准边界 | 不自动新增 Change、Stage 或交付状态 |
| 仅依赖 Agent 临时对话才能解释结果 | 补齐当前 OpenSpec Artifact 与持久化 Evidence 引用 | 跨 Run 不可读则不满足 Analysis 交接标准 |

**Analysis 准备完成 ≠ Human Approval ≠ Development Ready ≠ Delivery Done**；后面三者的权威判断归 [02](02-multica-delivery-lifecycle-design.md)。

---


<a id="analysis-skills"></a>

<a id="analysis-section-14"></a>

# 14. Agent / Skill / Config 实施结构

<a id="section-14-1"></a>

## 14.1 Agent 配置与 Skill 绑定

Agent Goal 与长期职责由 [§2](#analysis-agent-model) 和 [01 §6](01-multica-openspec-design-guideline.md#section-6) 维护。当前仓内受管 Skill 与绑定以 `workspace-config/provisioning.json` 为准；文件存在与真实 Workspace 发布状态必须区分。

| 对象 | 当前源文件职责 |
|---|---|
| Workitem Analyst | 按需使用 `codebase-explorer`、`bug-analysis`、`requirement-analysis`、`spec-preparation`、`analysis-completion` |
| `codebase-explorer` | 依据现有证据调查代码、领域边界和关联 Repository |
| `bug-analysis` / `requirement-analysis` | 分别提供 Corrective 根因诊断与 Intentional 需求探索能力 |
| `spec-preparation` | 使用当前 OpenSpec Schema / CLI 新建、补全、定向修订 Artifact |
| `analysis-completion`（内部调用 Analysis Gate） | 提交审核、回读与已实现的确定性检查；不要求 Analyst 额外绑定 `delivery-gate` |
| `workitem-analysis` | Retired；保留历史源文件，不用于新 Run 的有效绑定 |

新增专业 Skill 必须有明确能力边界与独立维护价值，不因工作流程增加固定步骤。目标 Workspace 发布前须回读绑定并按适用用例验证；现行 Analysis 不再使用独立 `analysis.route`。

<a id="analysis-skills-list"></a>

## 14.2 专业能力与按需提取

已存在的 `bug-analysis`、`requirement-analysis`、`codebase-explorer`、`spec-preparation` 按当前用途组合，不再把它们当成等待提取的候选；Intentional 专业 Review 是 Workitem Analyst 按需完成的专业审查活动，只有出现独立复用、输入输出与维护收益时才独立提取。专业活动不必等同 Skill，也不要求生成同名 Markdown。

Workitem Analyst 对总体分析质量负责：从实际任务、证据与变更复杂度选择方法，而不是通过完整调用所有 Skill 证明完成。Analysis Gate 与人工批准保持原有硬边界。

<a id="analysis-routing-config"></a>

## 14.3 Change Kind 与 Schema 归属

Workitem Analyst 依据当前 Issue 与可信证据判断 `corrective | intentional`；`tfs.type` 保留来源管理语义。首次准备时确定当前 OpenSpec Schema，之后所有 Run 从当前 Change 的原生状态读取；映射与 Artifact 依赖由 [05](05-openspec-schema-implementation-design.md) 维护。

不建立 Analysis Route 配置、路由脚本或新的 Skill 调度表；专业 Skill 按需调用。**现行已实现契约**：Analysis Handoff Facts 必含 `change_kind`，Stage 写入并回读 Multica 服务端 Issue Metadata；Gate / Complete / Finalize 核对其与当前 Change Schema 一致。相关源码变更已合并并通过自动化测试，仍须隔离 Workspace 验证实际 CLI 发布与 Agent/Skill 加载。项目尚未上线，无历史数据迁移任务。

```text
Issue / Evidence → Analyst 判断 Change Kind
→ 读取或确定当前 OpenSpec Schema
→ 按需使用专业 Skill 并准备适用 Artifact
→ Analysis Gate / Human Review
```

## 14.4 实施资产与后续 Gate 迁移

当前仓内的专业配置源文件位于 `projects/multica/agents/workitem-analyst/` 与 `workspace-skills/`；以 `provisioning.json` 回读现行绑定：`codebase-explorer`、`bug-analysis`、`requirement-analysis`、`spec-preparation`、`analysis-completion`。Gate 通过 `analysis-completion` 调用，不直接绑定 Analyst。原 `workitem-analysis` 为 Retired，仅保留历史源文件。

Agent Instructions 与相关 Skill 的职责收敛已通过 #83 合并；`rondo analysis` 的持久化分类、Gate Evidence 一致性及 Change Identity 校验已在相应 CLI PR 中实施。当前仓内实现与远端 Workspace 生效状态应分别核实；不需要历史 Issue 数据迁移。

## 14.5 专业活动与现行能力映射

| 专业活动 | 现行能力（按需） | 专业结果 |
|---|---|---|
| Context / Repository Evidence | `codebase-explorer` | 可复核的上下文与依赖证据 |
| Corrective Diagnosis | `bug-analysis` | Root Cause、影响、Fix Strategy 和 Regression Scope |
| Intentional Clarification | `requirement-analysis` | 目标、行为规则、场景、方案及关键待决事项 |
| OpenSpec Preparation | `spec-preparation` | 当前 Change 的适用 Proposal / Specs / Design / Tasks |
| Publish / Handoff | `analysis-completion`（内部调用 Gate） | 确定性结果、Handoff Facts 和 `analysis_review` 回读 |

以上是责任与能力对照，不是必须按顺序执行的步骤链；专业 Review 以当前 Contract 的必要质量为准，不因未注册同名 Skill 而省略审查。

<a id="analysis-acceptance"></a>

<a id="analysis-section-15"></a>

# 15. Analysis 与 OpenSpec 接入验收

以下分为**已完成的 OpenSpec 1.13.2 本地运行确认**与**后续 Multica / 真实业务集成验收**。已确认项可以作为当前 Schema 设计依据；未覆盖的真实调度、业务实现与异常恢复仍不得写成已部署事实：

| 场景 | 应满足的行为 |
|---|---|
| Analyst Agent 配置与 Skill 绑定 | Instructions 清晰表达长期专业目标与工作方式（可写在 Role 中），当前实际绑定与 manifest 一致，能够按需使用 `bug-analysis` / `requirement-analysis` / `spec-preparation` 并通过 `analysis-completion` 收口；不将已退役 `workitem-analysis` 当成现行入口 |
| Analyst 收到明确委派，Lead 未转述完整 Procedure | 能从自身 Instructions、绑定 Skills、当前 Issue 和持久化引用获取执行契约；关键规则只在 Squad Instructions 中时不满足接入要求 |
| Corrective / Intentional Change Kind 或专业 Review 被使用 | 根据证据与任务复杂度调用实际可用能力；专业一致性检查不因某候选 Skill 未注册而自动缺失，也不因名称另建 Agent、Run 或 Stage；AI Review 不替代 Human Approval |
| 确实必需的已批准专业能力不可读取 | 报告具体缺口并停止受影响动作；候选 Skill 不存在不等于任务失败，不能依靠 Leader 临时转述或猜测方法宣称 Gate PASS / 提交成功 |
| 重复通知或明确的定向返工请求 | 先确认当前委派与已有结果；重复通知不全量重跑或覆盖后续状态，返工只修订命中内容与必要关联项并完成当前检查 |
| Analysis 提交审核并回读成功 | 结束本轮分析；不自行批准、生成最终 `verify_agent.required`、启动 Engineer 或关闭 Delivery |
| OpenSpec 安装版本 | `openspec --version` 确认为 `1.13.2`；版本不一致时不把本设计的 Schema / skip / Archive 假设当作已验证事实 |
| 项目级 Schema 来源 / Fork | `corrective-change` / `intentional-change` 均以项目级 Schema 为目标；1.13.2 已本地验证项目 Fork、`schema which`、Schema Validate 与项目优先解析可用 |
| `intentional-change` Conditional Design / Apply 前置 | 按 [05 §6.3](05-openspec-schema-implementation-design.md#section-6-3)：`tasks.requires=[specs]`、`apply.requires=[tasks]`；Design 不作为 Tasks 原生硬依赖。条件满足时 Preparation 在形成 Tasks 前生成 Design，条件不满足时省略；Analysis Gate 核对必要内容及生成 / 省略依据；Apply 仅提供只读就绪 / 上下文信息 |
| CLI 状态解释 | 本地验证 Apply instructions 在 blocked 时仍可能 exit 0；Gate 必须解析结构化 state / missingArtifacts，不能只看退出码 |
| Corrective 首次创建 Change | `.openspec.yaml` 持久化 `schema=corrective-change`；后续 Analyst / Engineer / Finalize 读取同一 Schema，不重新选择 |
| Intentional 首次创建 Change | `.openspec.yaml` 使用 `schema=intentional-change`；Proposal / Tasks 必需，Specs 有 Delta 时生成，无 Delta 时合法 skipped；Design 按条件生成 |
| `corrective-change` 无规格级变化 | Corrective Proposal / Proposal / Tasks 完整，Specs 使用合法 `skip_specs`；status / validate / apply 前置与项目 Gate 结果一致，不要求独立 Design |
| `corrective-change` 需要补录既定行为场景 | 不使用 `skip_specs` 掩盖 Delta；生成合法 Specs，仍保持 Corrective，除非实际变成主动行为改变 |
| `corrective-change` Tasks 已存在但 Corrective Proposal 缺失 | Schema Apply 前置或项目 Gate 不放行；不得仅凭 Tasks ready 开始正式研发 |
| `corrective-change` 复杂修复有附加 `design.md` | Handoff / Corrective Proposal 显式引用，Engineer 可读取；不能假设非 Schema Artifact 自动进入 Apply 上下文 |
| `intentional-change` 不生成 Design | 仅当 Design instruction 的条件均不适用时允许；Preparation / Review 必须能够说明省略依据，继续生成 Tasks；不得创建空 Design，也不得引入 `skip_design` |
| Schema 解析来源 | `openspec schema which` / 等价能力确认项目 `corrective-change` / `intentional-change` 来源唯一且与根仓版本一致，不被用户级同名 Schema 静默覆盖 |
| Archive：Corrective 无 Delta | Change 能正常归档且不修改主规格；归档位置、根仓 Commit 与 Issue 引用恢复可确认 |
| Archive：Corrective 有 Delta | 只将本次已批准 Delta 纳入主规格，再归档 Change；失败 / UNKNOWN 阻止最终收口 |
| 只给出“支持导出”等模糊目标，尚未明确必要业务场景、规则、范围与验收要求 | Workitem Analyst 调查并澄清；仅列出改哪些代码或任务不能算 Analysis 完成 |
| 关键业务取舍需要人工决定 | 提供事实、选项和建议，取得必要确认；不自行假设，也不将业务分析排除在职责之外 |
| 需求结论已明确，进入规格准备 | 复用同一组事实与决定，形成对应规格 / 设计 / 任务；不重新运行完整分析或维护第二份详细计划 |
| 局部算法、类 / 函数拆分等尚待实现时细化 | 不据此否定充分的 Analysis；Engineer 在批准边界内决定，行为或范围变化仍按既有审核处理 |
| 已有规格与代码不一致 | 区分约定与实现事实，记录证据，不静默覆盖 |
| Intentional 当前模块无规格 | 只建立本次相关认识与必要 Change 内容，不要求先补齐全仓规格 |
| Corrective 缺少必需 OpenSpec 环境或 Change（分别验证） | 保留已完成调查，报告缺口；不得通过 Analysis Gate 或自动降级为无 Change 交付 |
| 两类修复已有规格正确，或缺少必要 Expected Behavior / 根因证据 | 前者引用既有行为并准备轻量 Change；后者停止澄清，不因文档齐全放行 |
| 新建 / 修改 Capability | 遵循选用 Schema，保留已有路径与场景，无遗漏的行为—任务—验证对应 |
| 无行为规格变化的内部调整 | `intentional-change` 允许原生 `skip_specs: true`；Proposal 说明无 Spec-level 行为变化的依据，验证以现行约束和 Tasks 为准，不虚构 Delta |
| Corrective 补录可证明的既定边界场景 | Delta 保留来源和原有约束，内部检查与人审覆盖本次补录；不因有 Delta 自动转 Intentional |
| `intentional-change` Design | Design 为 Conditional Artifact：跨模块 / 新架构模式、新依赖 / 显著数据模型变化、Security / Performance / Migration complexity、或编码前需固化 Technical Decision 时生成；否则明确省略，不创建空文档 / `skip_design` |
| 极小 Bug 只有少量修复 / 回归动作 | Proposal 简短、Tasks 最小充分，Corrective Proposal 证据不降级；不强制额外的需求分析或 Review Skill |
| 简单单仓任务 Evidence 很少 | 不强制生成 `context-pack.md`；Evidence References 足够可追溯即可 |
| Intentional 完成需求分析 | 更新 Proposal / Tasks、有 Delta 时更新 Specs、按条件更新 Design，并更新 Multica Analysis Handoff Facts；不要求固定 `requirement-analysis.md` |
| Intentional 专业 Review APPROVED | 保存结构化 AI Review Result / Findings 与被审 Artifact 引用；不要求 `requirement-review.md` |
| Human Review 读取 Analysis Package | 读取逻辑集合中的 Change / Result / Evidence / Review Facts；不要求存在 `analysis-package.md` 或 `analysis-summary.md` |
| 分析与编码在不同 Agent / Run | 当前 Change、批准基线、Tasks / task_refs 和证据可读，Engineer 不依赖 Workitem Analyst 会话或临时目录 |
| Change 归档后读取 Corrective Proposal / 证据 | 内部相对引用与外部持久化引用有效；现有 Issue 当前路径已回填 |
| 同一 Delivery 分析退回两次 | 定向更新同一 Change，不重做全部分析或复制两套 Tasks |
| 任务小但行为、错误处理或性能承诺变化 | 仍表达相应规格，不按任务大小跳过 |
| 原生准备完成但 Human 未批准 | 停在既有 Analysis Review，不启动实施 |
| Gate PASS，Workitem Analyst 完成发布与状态写入 | 回读 analysis_review 后结束本轮分析，不仅为改状态新增 Lead Run |
| 发布 / 写入失败或结果未知，或旧提交在人工处理后重试 | 查询实际事实，只恢复当前适用的缺失动作，不重复通知或覆盖后续状态 |
| 退回意见以自然语言表达，无固定字段 | 由 Lead 理解并交接足够反馈，Workitem Analyst 定向返工后再次提交，不自行开始研发 |
| Human Reject 或实质规格修订 | 同一 Change 定向更新受影响产物，重新审核，不沿用失效 Evidence |
| 一个 Change 交给两个 Engineer Task Sets | Tasks 保留工程范围且可引用，不包含等待独立验收、PR 或归档；分工由 Delivery Lead 完成 |
| 安装版本与文档 / Schema 预期不一致 | 报告具体不兼容项，不伪造文件、状态或校验通过 |
| 任一获准自动处理的 Change 缺少 Verify Recommendation / Reason / Verification Focus | Analysis Gate 按缺失项处理，不从来源类型或 Change Kind 填默认值 |
| Corrective 行为涉及跨系统复杂验收，或 SDD 行为已有可靠开发侧覆盖 | 都按实际 Acceptance / Verification Contract 给出推荐，不固定 required / not_required |
| 推荐为 not_required | 仍保留必要 Verification Contract 与开发侧验收依据 |
| Summary 或产物更新漏掉最新推荐 | 提交前修正为同一轮结果，不能交接相互冲突的建议 |
| 人审退回 AC / Scope / Verification Contract | 定向修订必要分析与推荐，适用时重做 Review 和 Gate，再提交，不沿用未经复核的推荐 |
| 分析阶段尝试写入 verify_agent.required 或 verification.result | 不作为本阶段输出；只交付 recommendation，最终执行事实与验收结果由[主方案](02-multica-delivery-lifecycle-design.md)规定 |
| 检查器配置指向两份 validate-analysis.py | 只保留[主方案](02-multica-delivery-lifecycle-design.md) delivery-gate 的唯一实现，Analysis 维护专业检查契约 |
| 来源需求不完整、TFS Comment 与代码行为不一致 | 能保留 Source / Observed / Hypothesis / Decision 来源，提出具体澄清问题；不能将任一单独来源默认为已确认规格 |
| Bug 无法本地复现但有可靠 Trace / 失败测试 | 记录复现限制及替代证据；若 Root Cause `probable`，显式保留风险；`unknown` 不能被文档齐全掩盖 |
| 修复需求同时涉及新增业务能力 | 识别 Corrective / Intentional 混合语义，停止受影响的自动准备并请求既有 Human / Lead 澄清，不自动新增 Change |
| Intentional 的两个方案存在关键外部 Contract 取舍 | 记录选项、推荐、影响与需 Human 确认的决定；未确认的关键取舍不得写成已经批准 |
| Engineer 从新的独立 Run 读取 Analysis Package | 仅依靠已保存 Change、Handoff Facts 和 Evidence 引用，能定位应实现行为、范围、Task Verification 与风险；不需要 Analyst 临时对话 |
| Semantic Review 通过但 Gate 所需身份或引用未知 | Analysis Gate 返回 `UNKNOWN` 而不是 PASS；不得写入 `analysis_review` |
| Gate PASS 但 Human 尚未批准 | 只能提交 Human Review；不得生成批准后的 `verify_agent.required` 或启动 Engineer |
| `probable` 有可靠 Trace，Expected Behavior / 范围明确，修复与验证方案有据且残余风险已说明 | Analyst 依 [§7.3](#analysis-root-cause-confidence) 判断足以提交并取得一致性检查 `PASS`；全部 Gate 条件满足后可提交人审，根因状态仍为 `probable`，研发等待正式批准 |
| `probable` 的替代解释尚可能改变 Fix Strategy，当前验证方案不能区分原因 | 可继续调查或保存草稿；一致性检查为 `NEEDS_REVISION`、Gate FAIL，不提交为待审成功 |
| Corrective 一致性检查为 `NEEDS_REVISION`，但没有 blocker | Gate FAIL；不能只凭 blocker 数量为零放行，须完成复核并取得 PASS |
| 必需检查结果缺失 / 已确认失效，或当前结果无法读取 / 适用性未知 | 前者 FAIL，后者 UNKNOWN；两者均不写入 `analysis_review` |
| 初次分析尚未获得 Human Approval | Verify 推荐可引用当前待审契约；Preparation 按批准后可消费性检查，不提前要求批准或启动 Engineer |
| Human Review 通过后形成研发分派 | Lead 从已批准 Change / Tasks 组织 Task Set 并形成 `task_refs`，不要求事先存在单独批准的分派引用 |

---


<a id="analysis-execution-model"></a>

# 附录 A. 最终 Analysis 执行模型（摘要）

本图中的 Skill 名称表示可组合的专业能力，不表示必须生成同名 Markdown；Workitem Analyst 的专业工作止于写入并确认 `analysis_review`，Human Review / Delivery Lead 部分仅标示下游接口。入口接[主方案 §4.2](02-multica-delivery-lifecycle-design.md#delivery-start)，终点接[主方案 §6](02-multica-delivery-lifecycle-design.md#human-analysis-review)；完整交付模型以 [主方案 §2.3](02-multica-delivery-lifecycle-design.md#delivery-execution-model) 为准。

```text
Issue（当前目标 / 可信 Evidence）
       ↓
Workitem Analyst：判断 corrective / intentional（并核对自动化边界）
       ├── Corrective → 按需 bug-analysis
       └── Intentional → 按需 requirement-analysis
       ↓
按需 codebase-explorer 补证据，spec-preparation 准备当前 Change
       ↓
Analysis Package（OpenSpec Change + Handoff Facts + Evidence）
       ↓
analysis-completion / Analysis Gate → analysis_review
       ↓
Human Analysis Review → Delivery Lead
```


# 附录 B. 当前设计决策与核心原则（摘要视图）

## B.1 决策表

本表总结本阶段现行规则，不作为第二份独立契约；跨阶段条目以[主方案](02-multica-delivery-lifecycle-design.md)相应章节为准。

| 项目 | 决策 |
|---|---|
| TFS Type | 公司管理事实，Agent 不修改 |
| 技术变更性质 | Workitem Analyst 语义判断 |
| TFS Bug（按既定行为修复） | Corrective |
| Requirement + Corrective | Corrective |
| Requirement + Intentional | Intentional |
| 大型复杂需求 | 超出自动处理范围的复杂需求，暂不自动处理 |
| `hotfix` | 当前不建模 |
| 紧急程度 | 人工排期 / 优先级，不进入 Agent Change Kind 判断 |
| `bug-analysis` | 服务两种 TFS 来源下的 Corrective 问题 |
| `requirement-analysis` | 只服务 Intentional Change；是分析方法，不要求 `requirement-analysis.md` |
| OpenSpec | 获准自动处理的 Change 共用 Change Model；`corrective` → `corrective-change`，`intentional` → `intentional-change`；不绑定特定命令 |
| OpenSpec Change Identity | 每个自动 Delivery 默认维护一个稳定 active Change；Change 创建时持久化 Schema，Rework 复用，不新增多 Delivery 共用可写 Change |
| New / Modified Capability | 都可生成 Spec / Delta Spec |
| Corrective 无 Spec-level 行为变化 | `corrective-change` 使用原生 `skip_specs`；Intentional / `intentional-change` 不允许用 skip 掩盖 Intentional Behavior Change |
| Requirement Review | 仅 Intentional；输出结构化 AI Review Result / Findings，不要求独立 Review Skill 或 `requirement-review.md`；Corrective 采用 [§7.2](#section-7-2) 内部一致性检查；均不替代 Human Review |
| TFS Task | 只看原始 `tfs.type` |
| Workitem Analyst | 需求与问题分析及研发准备；不替代 Human 决策，不修改 TFS 管理类型或承担最终成员分工 |
| Analysis 完成标准 | [§1.2](#analysis-readiness)：需求与问题清楚、必要研发依据充分；不要求预先冻结全部实现细节 |
| Analysis Review Status | Status Key=`analysis_review`；Display Name=`Analysis Review`；category=`started` |
| 提交审核责任 | Workitem Analyst / `analysis-completion` 发布、写入并回读确认状态；不自行批准或启动研发 |
| Review Decision | Human 自然语言评论为来源；Delivery Lead 理解决定和条件，不维护 `analysis.review_status` 或强制格式协议 |
| Analysis Artifact Model | Analysis Package = OpenSpec Change + Multica Analysis Handoff Facts + Supporting Evidence References（按需）；逻辑集合不对应同名 Markdown |
| Wayfinder Evidence | Wayfinder 通过独立 `codebase-explorer` 形成 Comment 和 Evidence References；Analyst 使用原有 `codebase-explorer` 按需复核并按需增量调查，Triage Decision 不替代 Workitem Analyst 的技术判断 |
| Context Pack | Context Evidence 必须可追溯；`context-pack.md` 仅复杂跨仓 / 长证据链任务按需生成 |
| Acceptance Contract | Intentional → Spec / Delta Spec 的 Requirement + Scenario；Corrective → Proposal Expected Behavior / Regression Scope，存在 Specs 时一并使用 |
| Verification Contract | 每个 Implementation Task 必须有验证方式；组合行为按需形成 Change-level Verification Task；不因 `verify_agent=not_required` 取消 |
| Verify 推荐 | 所有获准自动处理的 Change 都输出 Independent Verify Recommendation / Reason / Focus；只决定是否需要独立执行者，不拥有 Verification Contract |
| Human Analysis Review | 所有自动 Analysis 都需人工决定；不是 Analysis Gate PASS 的同义词，完整流程见[主方案 §6](02-multica-delivery-lifecycle-design.md#human-analysis-review) |
| Approved OpenSpec Commit | Human APPROVED 后提交根仓 Git，记录开发基线；允许批准边界内更新，不创建独立 PR |
| Reject Rework | Lead 理解并保留反馈，写入并确认 `in_progress` 后单次委派 Workitem Analyst；修订后由 Workitem Analyst 再提交 |
| Analysis Route 配置 | 不创建 `analysis-routing.yaml`，现行模型见 [§14.3](#analysis-routing-config) |
| Cross-Repository | Corrective / Intentional 均允许跨仓 |
| Change Kind 与仓库数 | Repository 数量不参与 Change Kind 判断 |
| Sub-Issue | 跨仓不等于必须拆 Sub-Issue；仅在 Task Set 需要独立 Runtime State 时创建 |
| PR Boundary | 每个需交付的业务代码 Repository 独立 Branch / PR；OpenSpec 根仓不属于业务 required PR 集合，见[主方案 §5.3](02-multica-delivery-lifecycle-design.md#section-5-3)、[§10](02-multica-delivery-lifecycle-design.md#pr-materialization) |
| Multi-PR | 一个 Issue / Sub-Issue 可以关联多个 PR |
| Completion | assigned Task Set 完成 Engineering Contract 与被分配的 Verification；Independent Verify（如 required）/ PR / Finalize 属于父 Delivery；详细规则只引用[总方案](02-multica-delivery-lifecycle-design.md) |

## B.2 核心原则

以下为本阶段规则摘要；跨角色与最终完成原则引用 [主方案 §14](02-multica-delivery-lifecycle-design.md#delivery-principles)，不独立重定义。

> **TFS 怎么登记、技术上是什么、走什么开发方法，是三个不同的问题。**

> **Bug 类型的管理规则由 TFS Type 决定，不由 Agent 重分类。**

> **Requirement 可以在技术上属于 Corrective Change，但仍然保留 Requirement 的工作量和 TFS Task 规则。**

> **获准自动处理的 Change 统一使用 OpenSpec Change；Technical Change Kind=`corrective` 使用 `corrective-change`，`intentional` 使用 `intentional-change`。产品行为变更按 Intentional 准备，修复按 Corrective 准备，不新增复杂度分类。**

> **Analysis Method 不等于同名 Markdown。Workitem Analyst 直接形成当前 Change 的 OpenSpec Engineering Truth、Multica Delivery Facts 与必要 Evidence References；Engineer 在独立 Run 消费批准后的当前版本，不维护第二套 Requirement / Design / Plan。**

> **每个自动 Issue 默认维护一个稳定 active OpenSpec Change；Schema 在创建时确定并跨 Run 读取，Human Reject / targeted rework 更新同一个 Change，不共享其他 Delivery 的归档权限。**

> **OpenSpec `tasks.md` 是 Implementation Checklist，不是 Development Sub-Issue 映射表，也不是 Multica Delivery Status。**

> **Workitem Analyst 负责 Engineering decomposition；Runtime Projection 由 Delivery Lead 根据 `task_refs`、当前 Roster 与运行需要组织，多个 Engineer / Repository / PR 不自动产生 Sub-Issue。**

> **Workitem Analyst 提交审核并确认状态，Human 作出决定，Delivery Lead 理解自然语言意见并组织后续动作；Gate PASS、in_progress 或 Agent 自述都不能单独证明已经批准。**

> **Human APPROVED 后将 OpenSpec Change 提交到根仓记录开发基线；允许批准边界内细化设计与任务，实质改变已批准行为、范围或验收要求时重新审核；根仓 Commit 不创建独立 PR。**

> **Corrective 不区分 Normal / Hotfix；紧急程度交给人管理。**

> **优先级与排期不参与 Change Kind 判断；当前不建立 Hotfix Policy，按 [§5.4](#section-5-4) 执行。**

> **Workitem Analyst 负责需求与问题分析及研发准备，主动澄清目标、场景、规则、范围与验收要求；技术调查与必要方案服务于研发支撑。不替代人的业务决策，不等于不做业务需求分析。**

> **Repository Scope 不决定 Change Kind；Corrective Change 即使跨多个 Repository，也不能仅因跨仓数量而重新分类。**

> **Acceptance / Verification Contract 优先采用 OpenSpec 原生模型：Intentional 由 Requirement + Scenario 定义正确行为，Corrective 由 Proposal 的 Expected Behavior / Regression Scope 与必要 Specs 定义；Tasks 负责验证执行要求。Verify Agent Recommendation 只决定是否建议增加独立验收者，不创建第二套 Acceptance / Verification Truth。**

> **跨仓、多个 Task Group 或多个 Engineer 都不自动要求 Sub-Issue；Sub-Issue 只用于独立 Runtime State。**

> **PR 是业务 Repository 级交付对象；OpenSpec 根仓产物只按[主方案](02-multica-delivery-lifecycle-design.md) Git 规则记录，不进入 required PR 集合。**

> **一个 Issue 或 Development Sub-Issue 可以关联多个 Repository 和多个 PR。**

> **assigned Task Set 的工程完成不等待 PR 合并；业务 PR 与最终收口条件由父 Delivery 按[总方案](02-multica-delivery-lifecycle-design.md)检查。**


# 附录 C. 专业依据与历史版本（非现行执行规则）

## C.1 专业方法来源

Multica 公共机制与官方来源统一引用 [指导手册来源索引](01-multica-openspec-design-guideline.md#official-source-index)；本节仅保留 OpenSpec 的专业方法来源，原有核对日期不表示本次完成本地运行验收。

[^a-openspec-schema]: OpenSpec 官方 [spec-driven Schema](https://github.com/Fission-AI/OpenSpec/blob/main/schemas/spec-driven/schema.yaml) 与 Propose Workflow，2026-10-07 再次核对；Design instruction 明确为条件性工件，条件不满足时允许省略并继续生成 Tasks，dependency 是 planning enabler 而不是强制 Gate。公开 `main` 不替代团队锁定的 1.13.2 回归验收。
[^a-openspec-1-13-2]: OpenSpec 官方 [v1.13.2 Release](https://github.com/Fission-AI/OpenSpec/releases/tag/v1.13.2)，版本发布于 2026-09-23，commit `db23097`。本方案将其作为团队实现基线；具体 Schema / CLI 行为仍以本地安装包验收记录为准。
[^a-openspec-custom-schema]: OpenSpec 官方 [Customization](https://github.com/Fission-AI/OpenSpec/blob/main/docs/customization.md)，支持项目级自定义 Schema、Artifact / Dependency 定义、`schema fork` / `schema init` 及 Change metadata / CLI / project config 的 Schema 解析优先级。
[^a-openspec-propose]: OpenSpec 官方 [Propose 公开方法模板](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/src/core/templates/workflows/propose.ts)，2026-09-30 检视公开 main，未锁定 commit。指令允许条件性省略，但不据此伪造机器 skipped 或省去安装版路径验收；Corrective 专用契约是本项目设计。

[^a-openspec-config]: OpenSpec 官方 [Customization](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/docs/customization.md)，2026-09-29 核对。项目配置提供上下文与规则，不是权限或硬条件的替代；本节职责划分与默认不 Fork 的选择属于本项目设计。

---

## C.2 入口 Evidence 交接（2026-10-13）

### v1.19.5 可选准入与按需 Context Analysis

- 修正附录 A：Wayfinder Decision / Evidence 不再被画为所有 Analysis 的前置，`context-analysis` 根据 Evidence 缺口按需调用；正文统一入口同步使用条件性描述。

### v1.19.3 Comment 读取与直接委派

- Analyst 统一引用 02 §4.1.1 的顶层 / 回复 `/note` Decision 读取规则；Wayfinder 是自动 TFS 入口的默认路径，不构成所有 Analysis 的强制 Gate。

### v1.19.2 入口 Evidence 交接

- Wayfinder 独立使用 `codebase-explorer`；Analyst 保留原有 `context-analysis`；新增探索 Comment 回读与 Incremental Analyst Evidence 复核契约；准入的 Runtime Decision / Assignment / Status 仍由 02 维护。
- 维持七个 Analyst Project Skills、正式 OpenSpec Change 和 Human Analysis Review 不变；不强制新增 Triage Artifact。

## C.3 v1.19.1 实施导向专业质量优化（2026-10-09）

**2026-10-10 同版本结构补充**：新增第 2 章 Workitem Analyst Role 与 Agent Model，将原 §13.1 的 Description / 五段式 Role Contract 前置；原第 2–14 章顺延为第 3–15 章。新 §14.1 明确七个 Project Skills 的绑定、统一入口及可访问性要求，§15 补充角色配置与调用边界验收；同步当前章节引用及 04 v1.15 关联基线。保留既有 Route / Schema / Human Review 和历史记录含义，未部署或修改实际 Agent / Skill / Script。

- **基线与名称**：以 v1.18.1 的 14 章实施结构为基线，吸收 v1.19 的专业质量要求；名称统一为 `Workitem Analysis Design（工作项分析设计方案）`，当时文件名为 `03-workitem-analysis-design-v1.19.1.md`，不继续采用 v1.19 五段式正文目录。
- **专业质量**：在对应章节补入问题理解 / 事实分类、业务与工程证据链、混合变更边界、Root Cause 可信度、Intentional 方案取舍与独立 Engineer 可消费的完成信号。
- **落地与验收**：补入 Semantic Quality / Deterministic Readiness / Human Approval 分层、专业停止矩阵、专业活动到七个 Skill 的实施映射和异常验收场景。
- **不变规则**：完整保留 TFS Bug / Requirement 管理背景、三条自动 Route、两个 OpenSpec Schema、`analysis.change_ref`、七个 Project Skills、`analysis-completion` 的 `analysis_review` 写入与回读及 02 / 05 的单一权威归属。未修改实际 Agent / Skill / Script，未定稿 05 P0-2。
- **对照 v1.17 修订**：公共配置与 Schema 专属规则由 05 §2.6 承接；修正任务分派、审核前契约和 Task 更新引用；明确 Corrective PASS 与 `probable` 提交边界、统一 `focus_refs`，并补入对应正反验收场景。

---

## C.4 v1.18.1 结构与归属调整摘要（2026-10-09）

- 将 38 个原正文主章节调整为 14 个专业主题章节；Route、输入、Preparation、Review / Gate、Human Handoff、Config 按职责与执行顺序归位。
- 保留 §2 中完整的 TFS Bug / Requirement 公司管理背景；保留原最终执行模型、决策表、核心原则与历史记录（见附录 A–C）。
- 将 Schema YAML / Template / Parser / Change Resolver 等实施权威收敛引用至 05；将 Sub-Issue / PR / Human Approval / 状态转换规则收敛引用至 02；保持 01 Canonical Terminology。
- 将当前 Change 的 Multica 引用示例统一为 `analysis.change_ref.{id,path,schema}`；移除 `analysis-routing.yaml` 对 Human Review 强制约束的重复可配置开关。
- 保留七个 Project Skill、`analysis-completion` 提交并回读 `analysis_review`、Gate 和独立 Verify 推荐的既定边界；仅修订内部引用与章节组织，不新增第二阶段的专业契约或实施机制。
- 01 / 02 / 04 / 05 / 06 文件仍保持各自原版本；它们指向 03 v1.17 的历史链接尚未改写。新文档保留常用显式锚点，便于下次多文档引用同步；本版不擅自升级上位方案。

---

## C.5 历史版本变更记录（原文保留）

## v1.17 变更摘要

- `intentional-change` 恢复 OpenSpec `spec-driven` 的 Conditional Design：Proposal / Specs / Tasks 必需，`design.md` 仅在跨模块 / 新架构、新依赖 / 显著数据模型变化、Security / Performance / Migration complexity 或编码前需固化 Technical Decision 时生成。
- 不增加 `skip_design` / `design_required` 等第二套状态；条件不满足时明确省略 Design 并继续生成 Tasks，Analysis Gate 负责确认省略是否合法。
- `requirement-review` 的 Multica 结果字段统一为 `analysis.ai_review` / `ai_review.verdict`，与 Human Analysis Review 明确分离。
- 同步 Guideline、Delivery、Development、OpenSpec Schema Implementation 引用；Skill / Method 层级本轮不调整。

---

## v1.15 变更摘要

- 同版本补充 Verify 决策权边界：Workitem Analyst 首次形成 Independent Verify Recommendation；Human Analysis Review 可接受或 override；仅改变独立性要求不修改 OpenSpec Engineering Truth，改变 Verification Contract / Scope 时返回 Workitem Analyst 定向修订。
- 对齐当时的 OpenSpec Schema 实施契约：Corrective 删除独立 `bug-analysis` Artifact；`bug-analysis` 保留为 Analysis Method，最终 Expected / Actual、Root Cause / Evidence、Fix Strategy、Fix / Regression Scope 等工程事实进入 Corrective `proposal.md`。
- `corrective-change` Artifact Graph 收敛为 `proposal → specs/skipped → tasks`；Intentional 继续使用 `proposal + specs + design + tasks`。
- 取消独立 `AC-xxx` / `VR-xxx` Identity 与独立 Acceptance / Verification Artifact；Intentional 使用 OpenSpec Requirement + Scenario 作为 Acceptance Contract，Corrective 无 Specs 时使用 Proposal Expected Behavior / Regression Scope + Task Verification。
- `tasks.md` 正式区分 Implementation Task 与按需 Change-level Verification Task；每个 Implementation Task 必须说明自己的验证方式，只有组合后的 Change 才能证明行为时才建立 Regression / Integration / E2E Verification Task。
- Verify Agent Recommendation 的语义收窄为 **是否需要 Independent Verify Agent**；Integration / Regression / E2E 只是 Verification Method，不直接决定 Agent。`verify_agent.required` 继续作为 Human Review 后的 Multica Delivery Fact，避免字段迁移。
- `focus_refs` 不再使用 AC / VR ID；可引用 Requirement / Scenario、Corrective Proposal 语义位置或 `T-xxx`，其最终 parser-level 格式随 Native OpenSpec Template Contract P0-2 定稿。
- Analysis Gate、Requirement Review、Corrective 一致性检查、Summary、下游交接与核心原则同步采用 Native Acceptance / Verification Model。
- 配套基线为 Delivery、Engineer、OpenSpec Schema Implementation、Design Guideline；本次同版本修订不修改 Agent / Squad 配置或执行资产。

## v1.14 变更摘要

- 对齐指导手册的 **Runtime-Centric Delivery + Artifact-Centric Engineering** 顶层原则；Analysis 只负责把专业事实沉淀到 OpenSpec、把交付事实留在 Multica，本次同版本修订不改变版本号。
- 明确 **OpenSpec = Engineering Truth / Multica = Delivery Truth**，取消把 `Structured Analysis Result` 作为第三套技术 Contract Store 的设计。
- `Analysis Handoff Facts` 收缩为 Multica 原生事实上的最小交接集合：Route、Change 引用、Verify Recommendation / Focus 引用、Review / Gate 结果；不拥有独立文件、状态机、生命周期或版本。
- AC 与 Verification Requirements 全部回归 Engineering Truth：Corrective 由 `bug-analysis.md` 维护；Intentional 由 Spec / Delta Spec 维护。
- Development Scope、技术 Risk / Dependency / Open Decision / Evidence 不再复制进 Handoff Facts，按专业 Owner 留在 Proposal / Spec / Design / Tasks / Bug Analysis / Supporting Evidence。
- Requirement Review 继续保留方法与 Findings，但结果直接记录为 Multica delivery fact，不设计独立 Review Result 对象。
- 本次仅更新设计模型；Multica metadata / property / comment / result 的实际字段映射、Skills、Instructions、Scripts、Route Config 与 OpenSpec Schema 暂不修改。

---

## v1.13 变更摘要

- Analysis Artifact Model 重构为 **OpenSpec Change + Multica Analysis Handoff Facts + Supporting Evidence References（按需）**；`Analysis Package` 明确为逻辑集合，不创建同名 Markdown。
- 明确 **Analysis Method / Skill ≠ 同名 Artifact**：`requirement-analysis` 不再要求 `requirement-analysis.md`，`requirement-review` 不再要求 `requirement-review.md`，`analysis-completion` 不再生成 `analysis-package.md`。
- `context-pack.md` 从固定产物降为条件性 Supporting Evidence；Context Evidence 仍必须可追溯，简单任务直接保存 Evidence References。
- AC / Verification Requirements / Verify Recommendation 保持为核心 Analysis Contract：Corrective AC 归 `bug-analysis.md`，Intentional AC 归 Spec；Verification Requirements 与 Verify Recommendation 进入 Analysis Handoff Facts 并建立 AC 引用。
- Requirement Analysis 直接把 Why / Scope 写入 Proposal、Behavior / Rules / Scenarios / AC 写入 Specs、技术决策写入 Design、工程清单写入 Tasks；不维护第二份详细需求文档。
- Requirement Review 改为结构化 Review Result / Findings；Gate 检查真实 Result 与 Artifact，不检查已取消的固定 Markdown 文件名。
- Corrective 保留当前 `corrective-change` Schema 与轻量 Proposal；Intentional 保留 Proposal / Specs / Design / Tasks 全部 Required，Design 继续采用 Required Artifact / Conditional Depth。
- Summary 仅作为 `render(OpenSpec Change + Multica Delivery Facts)` 的展示视图，不成为 Truth Source。
- Development Task Graph / `development_plan.units` / `role_requirement` 不属于 Workitem Analyst 输出；技术拆分只保留建议，实际 `task_refs` / Runtime Projection / Owner 由 Delivery Lead 组织。
- 配套主方案、Engineer、指导手册；本次仅更新四份设计文档，不修改实现资产或 OpenSpec Schema。

---

## v1.12 变更摘要

- Schema 命名改为直接映射 Technical Change Kind：`corrective-change` / `intentional-change`；项目采用 kebab-case `<kind>-change` 风格，Route 与 Schema 不再同名绑定。
- `bug-fix` / `production-fix` → `change_kind=corrective` → `corrective-change`；`sdd-fast` → `change_kind=intentional` → `intentional-change`。Change 创建后持久化 Schema，跨 Agent / Run 读取现有事实。
- `corrective-change` 固化为 `bug-analysis → proposal → specs/skipped → tasks`，`apply.requires` 覆盖四项；合法 `skip_specs` 已在 OpenSpec 1.13.2 本地验证通过。
- `intentional-change` 从 1.13.2 `spec-driven` Fork，Design 改为项目必需 Artifact但深度按复杂度伸缩；`apply.requires=[proposal,specs,design,tasks]`，缺 Design 时必须 blocked。
- `sdd-fast` 代表 Intentional Behavior Change，Specs 为项目必需，不允许用 `skip_specs` 掩盖行为变化；未来无 Spec-level 的计划性工程调整另行判断，不放宽当前 Route。
- 明确 Schema Validate、Planning Complete、Apply Ready、Analysis Gate、Human Approval、Development Ready 六类状态分别判断；CLI exit 0 / Apply Ready 不构成项目准入。
- 现有 `sdd` Schema 保留已有 Change 兼容和 Full-SDD / `sdd-standard` 候选定位，不映射 `sdd-fast`，不迁移历史 `schema: sdd`。
- 配套升级主方案、Engineer、指导手册；Schema / CLI 行为已有本地运行证据，真实 Multica / 业务实现仍需集成验收。

---

## v1.11 变更摘要

- OpenSpec 实现基线锁定为 `1.13.2`；统一 Change Model 保留，正式采用按技术变更性质分型 Schema。
- `bug-fix` / `production-fix` 使用项目级 `corrective`；`sdd-fast` 使用原生 `spec-driven`；Schema 创建时持久化，跨 Run 复用。
- `corrective` 将 `bug-analysis.md` 登记为正式 Artifact，保留 Proposal / Specs / Tasks；Specs 无变化使用原生 `skip_specs`，独立 Design 不作为默认必需 Artifact。
- `analysis-routing.yaml` 增加 Route → Schema 映射；Schema 负责产物 / 依赖，Skill 负责专业方法，Gate 负责项目硬条件，避免三处复制依赖图。
- 补充跨 Schema `config.rules` 边界、附加 Design 的引用要求，以及 1.13.2 Schema / Status / Apply / Validate / Archive 验收清单。
- 完整保留 §2 TFS 管理背景和既有 Human Review / Verify / TFS Task / Route 语义；本次只更新设计，未部署自定义 Schema。

---

## v1.10 变更摘要

- bug-fix / production-fix 进入共享 spec-preparation 的 Corrective 轻量契约，不重做 requirement-analysis、不默认增加 requirement-review。
- §9 统一 Change Identity、产物深度、原生 skip / Design 省略边界；§26 明确 Bug Analysis、Proposal、Tasks、条件性 Design / Delta 的唯一内容归属与跨 Run 交接。
- §19 保留诊断闭环并补充同一专业执行内的一致性检查；§22、§28、路由配置与返工契约同步，不新增 Skill / Gate / Schema。
- 明确补录既定约束与主动改变行为的区别；缺少主规格不等于缺少工具环境，必需 Change / 原生能力缺口不得静默降级。
- 完整保留 §2 TFS 管理背景；同步主方案、Engineer 与指导手册。
- 本次只更新文档及验收要求，未生成或部署执行 Skill / Script；原生省略能力须由安装版本验收。

---

<a id="historical-changes"></a>

## 早期版本记录

以下 v1.10 及更早记录保留当时含义，旧文件名、旧规则与旧来源核对日期不作为 v1.11 的执行依据。当前规则见正文。

## v1.9 变更摘要

- 文档升级为专业阶段设计，定位为 Workitem Analyst / Analysis 专业阶段；入口 Skill 和七个专业 Skill 名称保持不变。
- 完整保留 §2 的 TFS 管理背景，保留并对齐 §35–§37 的总结视图，历史 v1.8 / v1.7 / v1.6 / v1.5 摘要暂时保留。
- 补充角色配置、输入和启动契约；移除正文中的废弃 Skill / Route 设计理由，优先级规则收敛为当前约束。
- 主方案已完整覆盖的 Sub-Issue、PR、审核后开发与完成规则改为精确引用；人工决定归主方案，提交和定向返工细节仍由本阶段维护。
- 对齐主方案的 Verify Agent Recommendation，补入专业完成标准、两类 Package、Review、Summary、公共 Gate 和验收场景；不新增审批或 required 字段 Owner。
- Multica 机制与 URL 改为指导手册的具体条目引用；OpenSpec 专业来源继续在领域文档维护。
- 对齐唯一 Analysis Gate 实现位置，保留当前路线、审核职责、根仓 Git 与工程交付边界；仅更新设计文档，未部署 Skill / Script 或执行运行验收。

## v1.8 变更摘要

- 明确 `analysis-completion` 的执行者为 Workitem Analyst，负责发布、写入并回读 `analysis_review`；补充权限、失败恢复与等待边界，Gate 只返回检查结果。
- 人工审核采用自然语言，Lead 理解决定与条件并组织批准 / 返工；同步 Driver、交接和验收，不依赖固定口令、审批状态表或必经评论解析脚本。
- 将角色目标明确为需求与问题分析及研发准备，新增职责维度与专业完成标准，强调主动业务澄清及人工决策边界。
- 将目标、场景、规则、范围与验收要求落实到 Context、Requirement Analysis、OpenSpec 准备 / Review 和交付说明；不复制详细规格、设计或计划，保留 Engineer 实现空间及 Corrective 路由。
- Analysis Gate 先按 Route 分流；OpenSpec 原生准备、Validation 与 Requirement Review 只约束 `sdd-fast`，两类修复不依赖 OpenSpec 环境或产物，版本号保持不变。
- `context-analysis` 同时调查已有规格和实现事实；Analysis、Proposal、Spec、Design、Tasks 按内容职责分工，减少重复计划。
- 默认复用原生 Schema、模板、依赖与校验；补充项目配置 / Route / Skill / Gate 的归属及安装版本验收。
- 明确规格—任务—验证对应，Tasks 只包含工程实现与开发侧验证；当前 assigned Task Set 完成不等待整个 Change 或后续 PR / Archive。
- Review 检查语义覆盖，Gate 消费可确认的原生事实；规格 / 验收要求变化时重新判断旧证据。
- 清理 §30 的旧 PR Metadata 副本及“PR 合并后工程任务才完成”规则，交付完成条件统一引用总方案。
- 保留现有 Route、Human Review、根仓提交规则；本次只更新设计文档，未生成执行 Skill 或修改已运行配置。

以下为历史版本记录，不作为当前执行规则。

## v1.7 变更摘要

- OpenSpec 定位调整为规格驱动开发方式，`spec-preparation` 形成能够驱动实现与验证的规格、设计和任务，不绑定原生命令。
- `requirement-review` 明确审查一致性、完整性、可实现性及可验证性；Gate 不以文件存在替代语义审查。
- Git Commit 记录已批准开发基线，不冻结全部产物；既有分析执行链、Change Identity、人审和根仓提交规则保持不变。

以下为历史版本记录，当前执行规则以正文为准。

## v1.6 变更摘要

相对 v1.5，本版本重点细化 `sdd-fast` 的 OpenSpec Analysis Contract：

- OpenSpec 正式定位为 `sdd-fast` 的 **Versioned Change Contract**，不承担 Multica Runtime、Assignment、Sub-Issue、Stage 或 Delivery Status。
- 一个 `sdd-fast` Issue 默认维护一个稳定 active OpenSpec Change；Human Reject / targeted rework 继续更新同一个 Change，不创建平行 Change。
- `spec-preparation` 正式定位为 **OpenSpec Preparation Method**，负责 Change 解析 / 创建、Artifact Depth、proposal / delta spec / design / tasks 更新与 Validation；具体 CLI / 命令留给后续 Skill。
- `requirement-review` 改为 Review 完整 OpenSpec Change，并保持 AI Review 与 Human Analysis Review 分离。
- `tasks.md` 明确为 Implementation Checklist；Runtime 只引用 `task_refs`，Sub-Issue 仅用于独立 Runtime State。
- SDD-fast Analysis Gate 增加 OpenSpec Change identity、OpenSpec Validation 与 required artifact 检查。
- Human `APPROVED` 后将 Approved OpenSpec Change 提交根仓 Git，作为稳定 Development 输入；根仓 Commit 不创建独立 PR。
- OpenSpec Archive 明确属于总方案 Final Completion，本 Workitem Analyst 方案不维护 Archive Workflow。
- `spec-preparation` 目录不再自建 proposal / spec / tasks / design 模板副本，避免复制 OpenSpec 原生 Artifact Contract。

## v1.5 变更摘要

相对 v1.4：

- 引用当时设计规范的 Canonical Terminology（统一术语），不再独立维护公共命名；
- Analysis Review 正式 Status Key 统一为 `analysis_review`，Display Name=`Analysis Review`，category=`started`；
- Analysis Gate PASS 后统一写入 `Issue.status = analysis_review`；
- Human Approve / Reject 的等待与回流流程统一使用 `analysis_review` 作为机器状态值；
- Human 顶层 Comment 明确回流正式 Agent `Delivery Lead`，不再以 `Squad Leader` 作为第二名称；
- `Workitem Analyst` 保持为分析 Agent 的唯一正式名称；
