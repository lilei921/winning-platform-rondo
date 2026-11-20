# Workitem Analyst / Analysis 阶段设计方案

> Version: 1.13
> Date: 2026-10-03  
> Scope: Workitem Analyst 的角色与配置契约、Analysis 专业阶段的输入、需求与问题分析、路由、研发准备、OpenSpec Preparation、Review、Analysis Artifact Model、Verify 推荐、提交与停止边界  
> Status: Draft Baseline（设计评审版；未部署）

> 上位方案：`multica-squad-centric-delivery-v1.4.14.md`  
> 下游工程方案：`engineer-development-stage-design-v1.9.md`

> Terminology：本方案中的 Squad、Agent、Issue、Status、Route、Gate 等公共名称统一遵循 `multica-design-guideline-v1.9.md` 的 Canonical Terminology；本方案只维护 Analysis 领域术语。

---

<a id="analysis-stage-scope"></a>

# 1. 文档定位与目标

本文设计 **Workitem Analyst / Analysis 专业阶段**，不是单个 `SKILL.md`，也不是 Delivery Lead 的全局流程。

本文维护分析职责、输入、专业方法、产物与检查、提交审核和定向返工；人工审核决定的处理、研发组织、TFS Task 物化、PR 与最终交付由 [Delivery 主方案](multica-squad-centric-delivery-v1.4.14.md) 维护。统一术语、文档职责和 Multica 官方机制由 [指导手册](multica-design-guideline-v1.9.md#document-ownership) 维护。

本文“Analysis 阶段”指 Delivery 生命周期中的专业工作区段，不对应 Multica 原生 Stage；Stage 使用见主方案 §14，原生机制见 [指导手册：Parent / Child 与 Stage](multica-design-guideline-v1.9.md#mechanism-parent-stage)。入口 Skill 继续使用 `workitem-analysis`，七个 Skill 的名称及 Agent 正式名称不随文档改名变化。

## 阶段目标

Workitem Analyst 负责需求与问题分析及研发准备，澄清目标、业务场景、行为规则、范围和验收要求，结合现有系统形成必要方案，为后续研发与验证提供清晰、可审核、可执行的依据。

技术调查、规格与设计服务于需求和问题的澄清，不以“需求已经明确，只需分析改哪些代码”为前提。

当前方案重点解决：

- TFS `Bug` 与 `Requirement` 的管理语义不能混淆；
- `Requirement` 中存在“技术本质是 Bug”的上线后问题；
- 三条自动 Route 统一使用 OpenSpec Change；两类修复采用 Corrective 轻量产物，正常产品迭代保留完整 SDD 准备；
- `sdd-standard` 代表的大需求 / 全新复杂模块当前暂不自动处理；
- Analysis 结束前形成足以供人工审核和后续研发使用的 OpenSpec Change、Structured Analysis Result 与必要 Supporting Evidence。

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
| 研发准备 | 按 Route 形成必要规格、设计、任务或 Root Cause / Fix Strategy，并明确验证要求和待确认事项 |

这是职责维度，不是新增阶段，也不要求四份独立文档。内容按权威归属沉淀到当前 OpenSpec Change、Structured Analysis Result 与必要 Supporting Evidence；不因 Skill 名称生成同名 Markdown。Intentional 分工见 §21，Corrective 分工见 §26。

必须主动发现歧义、调查证据、提出澄清问题、比较选项并给出建议；需要人工决定的关键业务取舍交 Human 确认，不将假设或建议当成已经确认的需求。不替代人的业务决策，不等于不做业务需求分析。

不自行修改 TFS 管理类型、决定优先级或代替 Human Approval；不决定当前成员、最终 Sub-Issue / Stage 分工，也不替代 Engineer 完成生产代码与局部实现设计。`sdd-standard` 的自动处理边界保持 §10 的规定。

<a id="analysis-readiness"></a>

## 1.2 Analysis 完成标准

按当前任务与 Route 的适用范围确认：

- 需求 / 问题目标、相关使用者与业务场景清楚，现有行为与预期结果可区分；
- 必要业务规则、正常 / 异常 / 边界场景、需求或修复范围和验收要求明确，后续研发不必重新猜测需求；
- 必要方案或 Root Cause / Fix Strategy、影响范围、依赖与约束已分析，研发准备足以支撑实现；
- AC / Verification Requirements 可验证并对应目标行为；当前 Change 的 Tasks、适用规格 / Design 与需求或修复依据一致，原生准备及 Validation 满足适用契约；
- 影响正确实现的关键未决问题已明确提出并取得必要结论；需要人工确认且尚未决定的事项不得用默认假设补齐后宣称完成。
- 已形成与当前 AC / Verification Requirements 对应的 Verify Agent Recommendation、Reason 与 Verification Focus，具体输出与判断边界见 §16。

分析清楚不等于编码前确定全部细节。局部算法、类 / 函数拆分、内部结构、测试组织等由 Engineer 在批准边界内细化；不为形式补齐与任务无关的规格或设计。

以上是专业准备标准：语义结论由对应分析方法形成；Corrective 在 `bug-analysis` / 轻量 Preparation 中完成内部一致性检查，`sdd-fast` 经 `requirement-review` 审查；`analysis-completion` 汇集现有结果，Gate 只检查可确认事实。已有明确结论的方案可以提交 Human Review 等待正式批准，这与关键需求仍不清楚不同；准备完成或 AI Review 通过不等于获准编码，不新增另一套审批状态。

---

## 1.2.1 Analysis Artifact Model

Analysis 的专业方法、持久化技术契约、结构化决策结果必须分离：

```text
Analysis Method / Skill
= 如何调查、分析、Review
≠ 必须生成同名 Markdown

OpenSpec Change
= 长期研发技术契约

Structured Analysis Result
= OpenSpec 不适合承载、但 Delivery / Verify 必须消费的跨阶段决策型信息

Supporting Evidence
= 按需保存的复杂上下文与证据资料
```

提交 Human Review 的逻辑集合定义为：

```text
Analysis Package
= OpenSpec Change
+ Structured Analysis Result
+ Supporting Evidence（按需）
+ Review / Gate Facts
```

`Analysis Package` 不对应 `analysis-package.md`。Summary 是从权威 Artifact / Result 渲染的人类可读视图，不成为新的事实来源。

标准 Structured Analysis Result 至少表达：

```yaml
analysis_result:
  route: ...
  change_kind: corrective | intentional
  change_ref: ...

  development_scope: ...
  repository_scope: ...

  verification:
    requirements:
      - id: VR-...
        target:
          - AC-...
        description: ...
    verify_agent:
      recommendation: required | not_required
      reason: ...
      verification_focus:
        - AC-...
        - VR-...

  risks: []
  open_decisions: []
  evidence_refs: []
  review_result_ref: ...
```

Acceptance Criteria 保留在技术行为的权威 Artifact 中而不是复制进多个文件：Corrective 的 AC 以 `bug-analysis.md` 为权威；Intentional 的 AC 以 Spec / Delta Spec 为权威。Structured Analysis Result 可以引用 AC，但不维护第二份完整 AC 正文。

Verification Requirements 与 AC 不同：AC 定义正确结果；Verification Requirements 定义证明这些结果必须验证的行为、场景或证据要求。即使 `verify_agent.recommendation=not_required`，Verification Requirements 仍必须存在并由 Development / 后续交付满足。

## 1.3 Agent 配置契约

Agent Description：

```text
负责 TFS 工作项的需求与问题分析及研发准备，形成可审核的 OpenSpec Change、Structured Analysis Result、必要 Evidence 与 Verify Agent Recommendation，并提交人工审核。
```

Agent Instructions 按指导手册五段式维护以下长期职责；各 Skill 的详细 Procedure 不复制进 Instructions。

| 部分 | 当前 Role Contract |
|---|---|
| Role | Delivery Squad 中的 Workitem Analyst，负责需求与问题分析及研发准备，不承担 Delivery 的整体运行协调。 |
| Core Responsibilities | 澄清目标、场景、规则、范围与验收；调查现有系统并形成必要方案或 Root Cause / Fix Strategy；按 Route 准备修复依据或需求规格，统一形成当前 OpenSpec Change，提出 Verify 推荐并交付逻辑 Analysis Package（Change + Result + Evidence）。 |
| Boundaries | 不修改 TFS 管理类型或决定优先级；不选择最终成员 / Sub-Issue / Stage 分工；不写生产代码、不自行批准研发或关闭 Delivery。 |
| Execution Principles | 从当前 Issue 与可追溯证据工作；区分事实、假设和人工决定；经 `workitem-analysis` 使用对应专业方法，复用有效结果并定向修订；不得覆盖明确 Gate FAIL。 |
| Escalation, Communication & Delivery | 关键需求、根因、权限或证据无法确认时说明缺口并交 Delivery Lead / Human；完成后按 `analysis-completion` 发布、写入并回读审核状态，结束本轮分析；返工依据原始反馈及明确范围。 |

Description 的展示边界、Instructions 的接收范围分别见 [指导手册：Description](multica-design-guideline-v1.9.md#mechanism-agent-description)、[Instructions](multica-design-guideline-v1.9.md#mechanism-agent-instructions)。本阶段规则须进入 Workitem Analyst 自身 Instructions / 绑定 Skill，不仅放在 Leader 可见的 Squad Instructions。

---

<a id="tfs-management-background"></a>

# 2. 为什么 TFS 类型不能等同技术语义

公司内部对 TFS 类型存在明确管理差异：

## Bug

- 会影响绩效；
- 不统计需求工作量；
- 不能创建 TFS Task；
- 主要是在测试期间集中发现的缺陷。

## Requirement

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

---

# 3. 当前一级交付路径

当前版本采用四条语义清晰的路径：

```text
bug-fix
production-fix
sdd-fast
sdd-standard
```

其中：

| Path | 含义 | 当前自动处理 |
|---|---|---|
| `bug-fix` | 测试阶段登记为 TFS Bug 的缺陷 | 是 |
| `production-fix` | 上线后登记为 Requirement、但技术本质属于缺陷修复 | 是 |
| `sdd-fast` | 正常产品迭代、功能优化、行为变化、Capability 变化 | 是 |
| `sdd-standard` | 全新复杂模块、大需求、重型架构设计 | 暂不自动处理 |

---

# 4. `bug-fix`

`bug-fix` 的判断首先依据 TFS 管理类型：

```text
tfs.type == Bug
→ bug-fix
```

它代表：

> **测试阶段发现并按公司 Bug 类型登记的缺陷。**

技术分析使用：

```text
bug-analysis
```

主要分析：

```text
Symptom
Expected vs Actual
Reproduction
Failure Path
Root Cause
Hypothesis & Verification
Fix Strategy
Fix Scope
Regression Scope
Acceptance Criteria
Verification Requirements
```

公司管理规则继续由 TFS 类型决定：

```text
TFS Bug
→ 不创建 TFS Task
```

不得由 Agent 根据技术语义改变。

---

# 5. `production-fix`

`production-fix` 定义为：

> **已经上线的功能出现问题，TFS 登记类型为 Requirement，但目标是恢复已经存在的 Expected Behavior，而不是主动改变产品行为。**

典型条件：

```text
tfs.type == Requirement
+
系统已经存在既定行为
+
当前实际行为偏离既定预期
+
本次修改目标是恢复正确行为
```

因此它在技术上仍然属于：

```text
Corrective Change
```

分析方法继续复用：

```text
bug-analysis
```

而不是新建 `production-fix-analysis`。

---

# 6. 优先级与分析路由边界

`production-fix` 不区分 Normal / Hotfix Policy。紧急程度影响人的排期、优先级和发布时间，不改变分析 Route 或免除当前质量与人工审核要求。

Workitem Analyst 可以读取现有 Priority、Severity、Deadline 与 Human Comment 作为上下文，但不自行决定优先级、不创建 Hotfix Workflow，也不把仓库数或改动大小作为紧急程度替代条件。

---

<a id="analysis-input"></a>

# 7. 分析输入与启动契约

从当前明确委派的 Delivery Issue 进入 `workitem-analysis`，不因一次普通通知就重复执行完整分析。

| 输入 | 要求 |
|---|---|
| 当前工作对象 | Delivery Issue 身份、TFS Work Item 来源、当前委派和工作范围能够对应。 |
| 管理事实 | 原始 `tfs.type` 与 TFS 内容可读取；不以技术判断覆盖来源类型。 |
| 需求 / 问题上下文 | 目标、已知场景、现有说明、可读取证据与待确认项；不要求原始需求已经完整。 |
| Repository / 项目上下文 | 本次调查需要的入口、权限、相关规则和代码可定位；按需扩展调查，不预读全仓资料。 |
| 已有结果 | 当前 OpenSpec Change、Structured Analysis Result、Context / Evidence 与已有反馈（如有），先判断可复用范围。 |
| 返工请求 | 原始人工评论 / Finding 引用、明确修正方向和受影响范围；按 §32 处理。 |

无法确认任务身份、必要来源或授权时停止并说明缺口；需求歧义进入正常澄清，不自行补成已确认事实。三条自动 Route 的 Change 准备能力均按 §9、§22 验证；未准备好环境时可保留已完成问题调查，但不能声明 Analysis Gate PASS、批准研发就绪或静默退回无 Change 的交付方式。

首次启动与 Member 委派由主方案 §6 维护；Assignment、Mention 与成员实际接收上下文的机制分别见 [指导手册：Assignment](multica-design-guideline-v1.9.md#mechanism-assignment)、[Comment / Mention](multica-design-guideline-v1.9.md#mechanism-comments)。本节只检查本阶段收到的工作契约，不重建启动 Router。

---

# 8. `sdd-fast`

`sdd-fast` 定义为：

> **正常的 Intentional Product Change。**

包括：

```text
日常产品迭代
功能增强
功能优化
主动行为调整
业务规则改变
New Capability
Modified Capability
API / Contract Change
```

判断关键不是：

```text
改动大小
```

也不是：

```text
是否 New Capability
```

而是：

> **Expected Behavior 本身是否被主动改变。**

如果是，则进入：

```text
sdd-fast
```

---

<a id="openspec-change-contract"></a>

# 9. 统一 OpenSpec Change 与 Technical Change Kind Schema

`bug-fix`、`production-fix`、`sdd-fast` 统一采用 OpenSpec Change Model。Schema 直接映射 **Technical Change Kind**，不是 TFS Type 或 Delivery Route：

```text
change_kind = corrective
→ schema = corrective-change
→ route = bug-fix | production-fix

change_kind = intentional
→ schema = intentional-change
→ route = sdd-fast
```

Schema ID 采用项目规范的 kebab-case `<technical-change-kind>-change` 命名。`sdd-standard` 仍暂不自动推进；现有 `sdd` Schema 只保留兼容与 Full-SDD 候选定位，不作为当前正常 Route 的 Schema。

| 工作性质 | 分析方法 | OpenSpec Schema | Change 产物表达 | Analysis 专业检查 |
|---|---|---|---|---|
| Corrective：恢复有依据的既定行为 | `bug-analysis` | `corrective-change` | Bug Analysis、简短 Proposal、Specs（可合法 skip）、Tasks；独立 Design 不作为默认节点 | 根因验证 + Preparation 一致性检查，不默认 `requirement-review` |
| Intentional：主动改变预期行为 | `requirement-analysis` | `intentional-change` | Proposal、Delta Specs、Design、Tasks；四份均为当前 Schema 必需 Artifact | `requirement-review` |

两种方法都复用当前 Context 与已形成结论，直接形成其权威产物；不是先完成一套完整详细分析 / 设计 / 计划，再在 OpenSpec 中重写。Workitem Analyst 和 Engineer 仍在独立 Agent / Run 中执行；必要文档、批准后的持久化与接收方读取属于交接基线，不以节省 Token 为由合并角色或省略必要证据。

## 9.1 Change Identity

每个处于三条自动 Route 的 Delivery Issue 默认维护一个唯一 active Change：

```yaml
openspec:
  change_id: <stable-change-id>
  path: openspec/changes/<stable-change-id>
  schema: corrective-change | intentional-change
```

Change ID 与 Schema 在首次 Preparation 时确定，同一 Delivery 的 Human Reject、分析修订、工程返工均更新同一 Change；不得因为进入另一个 Agent / Run 重新选择 Schema。先核对已有身份再创建，不因每次 Run 或每个 TFS Bug 重试新建平行 Change；身份冲突或无法唯一对应时返回 `UNKNOWN`。

当前模型仍是一个 Delivery 默认拥有一个 active Change，不引入多个 Delivery 共用可写 Change 的完成 / 审批聚合。修复与另一个尚未完成的 Change 有关时，可以引用它的批准依据或规格，但不能让一个 Bug 的关闭归档另一个 Delivery 的 Change，也不把未批准提案当作既定行为。一个 Change 由多个 Development Unit 消费的边界见 §23。

OpenSpec Artifact 与实际需要随 Change 保存的 Supporting Evidence 置于该 Change 目录；调查过程可先形成临时结果，Preparation 直接保存或移动到最终唯一位置，不维护内容副本。`corrective-change` 将 `bug-analysis.md` 登记为正式 Schema Artifact；`context-pack.md` 仅在 §17 条件满足时作为项目附加 Supporting Evidence 生成，Gate 检查的是 Context Evidence 可追溯性而非固定文件存在。外部大日志、测试记录使用持久化证据引用，不为“同一容器”复制完整原始资料。

路径是项目根仓布局约定，实际写入前与原生解析结果及登记根仓核对，不因 CLI 的其他 planning home 默认值将文件写到未登记位置。内部文档使用相对引用；外部引用应能跨 Run 读取。Archive 后原 Change ID 不变，当前路径回填与恢复归主方案 §22。

## 9.2 Artifact 深度与规格语义

### 9.2.1 Corrective

Corrective 的 Specs 是否生成由“本次是否需要更新长期行为规格”决定：

| 当前事实 | Spec / Delta 处理 | 技术语义 |
|---|---|---|
| 主规格已正确、完整，代码偏离它；或既定行为已有可靠来源且本次不更新规格文本 | 使用合法 `skip_specs: true` | Corrective，不伪造行为变化 |
| 修复揭示遗漏场景，能够证明是既有约束的补录 / 澄清 | 形成必要 Delta，保留 Expected Behavior 来源和原有场景 | 可以仍为 Corrective，不以存在 Delta 自动改 Route |
| 已有规格错误、来源相互冲突或无法确认正确预期 | 先调查 / Human 澄清 | 结论未明前不能声明准备完成 |
| 实际需要主动改变 Expected Behavior / Contract / AC | 停止当前 Corrective 准备，重新确认 Change Kind / Route / Human Review | Intentional，不借修复名义扩展范围 |

`skip_specs: true` 是 OpenSpec 1.13.2 的原生持久化事实；Specs 显示 skipped，并可满足下游依赖和 `apply.requires`。若 Delta 文件与 `skip_specs` 同时存在，Validation 必须失败；不得用“任务小”“时间紧”或“修复路线”替代语义判断。

### 9.2.2 Intentional

`sdd-fast` 定义已经要求 **Expected Behavior 主动发生变化**，因此当前项目 `intentional-change` Schema 的 Specs 必需，正常 Route **不允许 `skip_specs`**。如果未来出现“主动计划的内部工程调整但无任何 Spec-level Behavior Change”，先单独确认其 Technical Change Kind / Route，不为边缘场景放宽 `sdd-fast` 的规格契约。

`intentional-change` 的 Design 同样为必需 Artifact，但 **Design required ≠ Design heavy**。简单需求允许短 Design，只记录满足正确实现所必需的 Approach、关键决策、Contract / Data / Dependency、兼容 / 风险及验证考虑；复杂跨模块、数据模型、安全、性能、迁移 / 回滚场景则展开相应内容。不得创建空 Design、模板填充或使用未受支持的 `skip_design` 绕过。

## 9.3 Approval 与 Git 边界

三条自动 Route 均将当前 Analysis Package 与 Change 一并提交既有 Human Review，不新增 Approval State 或第二次人工批准。Schema 准备完成、AI Review / 内部自检、Analysis Gate PASS 都不等于允许编码。

Human 明确批准后，按 [主方案 §9](multica-squad-centric-delivery-v1.4.14.md#human-analysis-review) 提交当前 Change 和必要分析交接文件到根仓，记录研发起始基线；不创建根仓 PR。Engineer 在自己的 Run 中获得可读取的当前 Schema / Artifact、批准依据、当前 Unit / Tasks 范围与必要根因 / AC，而不是接收整份 Workitem Analyst 会话。

Git 不冻结所有文件。Engineer 可在批准边界内细化 Design / Tasks 和开发侧验证；实质改变 Expected Behavior、Root Cause / Fix Strategy、方案、范围或 AC / Verification Requirements 时回到既有审核。具体更新权限见 Engineer 方案 §8.3；Archive 归主方案 §22，不在 Analysis 中提前更新主规格或归档。

<a id="openspec-configuration"></a>

## 9.4 OpenSpec 1.13.2、项目 Schema 与本地验收

当前项目锁定 OpenSpec `1.13.2`。正常自动 Route 使用两个项目级 Schema：

```text
openspec/schemas/corrective-change/
openspec/schemas/intentional-change/
```

Schema 创建后写入 Change `.openspec.yaml`，后续 Run 读取已有事实，不重新推断或临时切换。Schema 来源通过 `openspec schema which` / 等价能力确认，避免用户级同名 Schema 静默覆盖项目契约。

### 9.4.1 项目级 `corrective-change`

`corrective-change` 从 OpenSpec 1.13.2 `spec-driven` Fork 并项目化，正式 Artifact Graph：

```text
bug-analysis
      ↓
   proposal
      ↓
 specs / skipped
      ↓
    tasks
```

| Artifact | 文件 / 目录 | 职责 |
|---|---|---|
| `bug-analysis` | `bug-analysis.md` | Expected vs Actual、Root Cause / Evidence、Fix Strategy、Fix / Regression Scope、AC / Verification Requirements |
| `proposal` | `proposal.md` | 简短说明为什么修、修复范围、影响及规格关系，引用 Bug Analysis |
| `specs` | `specs/<capability>/spec.md` | 需要长期补录 / 澄清既定行为时生成；无规格级变化使用合法 `skip_specs` |
| `tasks` | `tasks.md` | 工程实现与开发侧验证 checklist |

`apply.requires = [bug-analysis, proposal, specs, tasks]`；Specs 合法 skipped 时仍满足前置。Design 不属于默认 Schema Artifact；复杂修复确实需要额外技术设计时，通过 Bug Analysis / Handoff 显式引用附加设计文件。未登记为 Schema Artifact 的附加文件不会自动进入 Apply context，交接必须保留引用。

### 9.4.2 项目级 `intentional-change`

`intentional-change` 从 OpenSpec 1.13.2 package `spec-driven` Fork，保留四个核心 Artifact，并收紧项目准入：

```text
             proposal
             /      \\
         specs      design
             \\      /
              tasks
```

| Artifact | 文件 / 目录 | 职责 |
|---|---|---|
| `proposal` | `proposal.md` | Why / Goal、Scope、Capabilities、Impact；不复制完整 Requirement Analysis |
| `specs` | `specs/<capability>/spec.md` | Expected Behavior、业务规则、正常 / 异常 / 边界场景和外部 Contract |
| `design` | `design.md` | Approach、关键技术决策、Contract / Data / Dependency、Risks / Compatibility、Verification Considerations |
| `tasks` | `tasks.md` | 工程实现、必要测试和开发侧验证清单；不包含 Human / Multica / PR / Archive 等 Delivery 运行步骤 |

`apply.requires = [proposal, specs, design, tasks]`，`tracks = tasks.md`。本地 1.13.2 验证已确认：缺 Design 即使 Tasks 存在也保持 Apply blocked；四份 Artifact 完整时 Planning Complete=true、Apply Ready 且无 missing prerequisite。严格 Apply 前置只说明当前 Schema 的必需 Artifact 满足，不替代 Validation、`requirement-review`、Analysis Gate 或 Human Approval。

### 9.4.3 既有 `sdd` Schema

项目现有 `sdd` 继续保留已有 active / archived Change 的解析与历史兼容。其当前 Artifact Graph 为：

```text
brainstorm
    ↓
proposal
    ↓
 specs
    ↓
 design
    ↓
 tasks
    ↓
 plan
```

它包含额外 Brainstorm / Plan，且现有 `optional: true` 未在 1.13.2 本地验证中表现为自动 skipped；`apply.requires` 仍只要求 Tasks。因此当前 **不映射到 `sdd-fast`**。未来若重新设计 `sdd-standard`，可将其作为 Full-SDD 候选单独评审；当前不因名字相近而自动采用，也不迁移已有 `schema: sdd` Change。

### 9.4.4 CLI 状态与项目 Gate

本地验证确认以下状态必须分开：

```text
Schema Validate PASS
≠ Artifact Graph Complete
≠ OpenSpec Apply Ready
≠ Project Analysis Ready
≠ Human Approved
≠ Development Ready
```

`instructions apply` 在 blocked 情况也可能以退出码 0 返回，因此 Gate 必须解析结构化 state / missingArtifacts / status，而不是只检查进程退出码。Validation PASS 证明工具支持的规格 / 结构约束成立，不证明需求、Design、Root Cause 或业务语义正确。

### 9.4.5 配置与规则归属

| 位置 | 权威内容 | 不维护内容 |
|---|---|---|
| OpenSpec Schema / templates | Artifact 集合、依赖、生成指令、Apply 前置 | Multica Assignment、Human Approval、Delivery Status |
| Change `.openspec.yaml` | 当前 Change 的 Schema 与合法原生 metadata | Route、Human 决定、运行分工 |
| `openspec/config.yaml` | 公共 context 与真正跨 Schema 的 artifact rules | 某个 Technical Change Kind 的专业规则副本 |
| `analysis-routing.yaml` | Route → Change Kind / Schema / 专业方法、AI Review 与项目额外要求 | OpenSpec Artifact 依赖图 |
| Skill / Gate | 调用当前 Schema、消费专业结论、检查项目硬条件 | 复制模板 / 依赖图、把语义正确性伪装成程序结论 |

公共 `rules` 以 Artifact ID 匹配。两套 Schema 共享 `proposal` / `specs` / `tasks` 时，只在 `openspec/config.yaml` 中放真正共用的规则；Corrective / Intentional 专有写法分别放对应 Schema instruction / template，避免规则串扰。

---

# 10. `sdd-standard`

当前暂不自动处理：

```text
全新大型业务模块
重大架构设计
多个核心领域
大规模数据模型重构
重大跨域 Contract / 数据模型设计
需要大量产品 / 架构人工决策
```

当 Workitem Analyst 判断当前任务明显超出 `sdd-fast` 可控范围：

```text
STOP
→ Delivery Lead / Human
```

不自动进入 `sdd-standard`。

---

# 11. 当前 Route Decision

推荐 Route：

```text
                         TFS Work Item
                              │
                    读取原始 TFS Type
                              │
              ┌───────────────┴───────────────┐
              │                               │
            Bug                           Requirement
              │                               │
              ▼                               ▼
          bug-fix                    判断 Change Intent
                                              │
                                  ┌───────────┴───────────┐
                                  │                       │
                             Corrective              Intentional
                                  │                       │
                                  ▼                       ▼
                          production-fix              sdd-fast


Large / New Major Module
→ sdd-standard / Human
```

这里不增加：

```text
Urgent / Normal
Hotfix Policy
```

Route 维度。


---

## 11.1 Route 与 Repository Scope 必须解耦

`bug-fix`、`production-fix`、`sdd-fast`、`sdd-standard` 的选择不得由 Repository 数量决定。

正式规则：

> **Repository Scope does not determine analysis route.**

一级 Route 只依据：

```text
TFS Type
+
Change Intent
+
当前需求是否超出自动处理边界
```

以下因素不得单独触发 Route 升级：

```text
Repository 数量
修改文件数量
Development Unit 数量
Engineer 数量
PR 数量
```

因此以下场景完全合法：

```text
TFS Bug
+ 跨 3 个 Repository
→ 仍然是 bug-fix
```

```text
TFS Requirement
+ Corrective
+ 跨 4 个 Repository
→ 仍然是 production-fix
```

```text
TFS Requirement
+ Intentional Change
+ 单 Repository
→ 仍然可能是 sdd-fast
```

同样：

```text
单 Repository
```

也不意味着一定是简单任务；一个全新的复杂领域模块即使只落在一个 Repository，也可能超出 `sdd-fast` 范围。

---

## 11.2 Development Sub-Issue 边界

跨仓不等于拆 Development Sub-Issue。Workitem Analyst 输出 Repository Scope、技术依赖 / 约束及按需的技术拆分建议；最终 Unit、Owner、Sub-Issue 和协作顺序由 Delivery Lead 在批准边界内决定。

独立交付单元的判定与物化规则只引用 [主方案 §10](multica-squad-centric-delivery-v1.4.14.md#development-materialization)、[§11](multica-squad-centric-delivery-v1.4.14.md#simple-delivery)、[§12](multica-squad-centric-delivery-v1.4.14.md#complex-delivery)，本方案不维护第二份拓扑判定清单。

## 11.3 PR 边界

业务 Repository 是 PR 的硬边界，但 PR 数量不决定 Analysis Route。Workitem Analyst 交付需修改 / 验证的 Repository 范围，不在分析阶段创建 PR 或填写尚不存在的 PR ID。

逐仓 Branch / PR、PR Preparation、Materialization 与关联规则见 [主方案 §17](multica-squad-centric-delivery-v1.4.14.md#pr-materialization)；OpenSpec 根仓产物边界见主方案 §7.1。

## 11.4 交付对象术语

Delivery Issue、Development Unit、Repository Change 与 PR 的正式名称、对象含义和关系，统一引用 [指导手册：Delivery Object Canonical Names](multica-design-guideline-v1.9.md#delivery-object-terminology)。本阶段只生成分析与范围引用，不重新定义四层交付对象。

---

# 12. Corrective 与 Intentional 的判断

## Corrective Change

核心问题：

> **当前行为是否偏离已经存在、已经确认的 Expected Behavior？**

如果：

```text
Expected Behavior 已经存在
+
本次目标只是恢复它
```

则：

```text
Corrective
```

Requirement 类型时：

```text
→ production-fix
```

Bug 类型时：

```text
→ bug-fix
```

## Intentional Change

核心问题：

> **产品是否主动要求系统以后表现得与之前不同？**

例如：

```text
主动新增产品场景（非补录既有约束）
修改业务规则
新增能力
扩展已有能力
改变 API Contract
改变用户可观察行为
```

则：

```text
Intentional
→ sdd-fast
```

---

# 13. TFS 管理规则与技术 Route 解耦

必须保持：

```text
TFS Type
= 公司管理事实

analysis.change_kind
= 技术语义

workflow / route
= 研发执行路径
```

例如：

```yaml
tfs:
  type: Requirement

analysis:
  change_kind: corrective

delivery:
  route: production-fix
```

这三个字段表达不同含义。

---

# 14. TFS Task 管理边界

TFS Task 的创建规则只依据原始 `tfs.type`，技术上属于 Corrective 的 Requirement 仍按 Requirement 管理。业务背景完整保留在 §2。

实际创建时点、执行者与物化行为见 [主方案 §10](multica-squad-centric-delivery-v1.4.14.md#development-materialization)。Workitem Analyst 保留并传递管理事实，不在 Analysis 内重复创建 Task 或建立另一套 TFS 管理流程。

---

<a id="analysis-skills"></a>

# 15. Workitem Analyst Skill 集合

当前使用以下 7 个 Skill：

```text
Workitem Analyst
│
├── workitem-analysis
├── context-analysis
├── requirement-analysis
├── bug-analysis
├── spec-preparation
├── requirement-review
└── analysis-completion
```

职责：

| Skill | 定位 |
|---|---|
| `workitem-analysis` | Analysis Driver / Route |
| `context-analysis` | 需求 / 问题相关的业务与工程上下文、既有行为及实现事实 |
| `requirement-analysis` | Intentional Change 的目标、场景、规则、范围、验收及必要方案分析 |
| `bug-analysis` | Corrective Change 的问题场景、预期偏差、根因与修复准备 |
| `spec-preparation` | 三条自动 Route 的 Change 准备；Corrective 轻量契约 / Intentional 规格、设计与任务 |
| `requirement-review` | SDD-fast 规格与计划的一致性、完整性、可实现性及可验证性 Review |
| `analysis-completion` | Assemble / Gate / Publish；由 Workitem Analyst 写入并确认 `analysis_review`，结束本轮分析 |

---

<a id="verify-recommendation"></a>

# 16. Verify Agent Recommendation

Workitem Analyst 在本轮 Analysis 中提出是否需要独立 Verify Agent 的建议。该建议作为 Structured Analysis Result 中的正式字段，与当前 OpenSpec Change、AC、Verification Requirements 和必要 Evidence 一并提交 Human Review，不新增 Agent、Skill、推荐文档或第二次审批。

推荐在专业分析中形成：两类修复由 `bug-analysis` 随 Verification Requirements 给出，`sdd-fast` 由 `requirement-analysis` 方法形成；两者均由 `spec-preparation` 按实际任务与当前规格同步更新。`analysis-completion` 只汇集已有推荐，不在收口时首次补做专业判断。

## 16.1 输出契约

```yaml
analysis_result:
  verification:
    requirements:
      - id: VR-...
        target:
          - AC-...
        description: ...

    verify_agent:
      recommendation: required | not_required
      reason: ...
      verification_focus:
        - AC-...
        - VR-...
```

`recommendation` 是分析建议；`reason` 说明验收风险和可验证性依据；`verification_focus` 引用当前 AC / Verification Requirements 中的重点行为或场景。Recommendation 不创建独立 Markdown，也不依赖 Summary 作为权威来源。

`verify_agent.required` 是 Human Analysis Review 通过后由 Development Materialization 从已批准 Recommendation 生成的执行事实，不由 Workitem Analyst 预先写成最终决定；`verification.result` 属于后续验收事实。批准、转换及执行边界见 [主方案 §16.1](multica-squad-centric-delivery-v1.4.14.md#verify-agent-decision) 与 [§26](multica-squad-centric-delivery-v1.4.14.md#delivery-facts)。

## 16.2 推荐方法

根据当前 Acceptance Criteria、Verification Requirements、技术范围与约束、跨系统行为和可验证性判断，不以最终 Roster、Sub-Issue 数量或分工已经确定为前提。

| 当前验收依据 | 推荐方向 |
|---|---|
| 范围小、行为单一，有可靠 Regression / Runtime Feedback，Engineer 的 Local Validation + Code Review 能闭合必要验收目标 | 可推荐 `not_required`，说明依据与覆盖重点。 |
| 多个关键 AC、多个技术修改共同构成最终行为、跨系统 Contract / Event / Schema、复杂状态流，或需要独立 Runtime / Integration / E2E 验收 | 可推荐 `required`，说明重点场景及原因。 |

这些是专业判断依据，不是 Route 默认值。`bug-fix`、`production-fix`、`sdd-fast` 均可能推荐任一结果；不因修复路线默认取消独立验收，也不因采用 OpenSpec 默认要求独立验收。

`not_required` 只表示不增加独立验收者，不取消必要验证。无法可靠判断时明确问题并澄清，不随意填默认值；关键结论未明确时不得宣称 Analysis 已充分。

## 16.3 检查与修订

推荐与本轮目标、范围和验收要求保持一致；需求、Fix Scope、AC 或 Verification Requirements 发生实质变化时同步修订推荐。语义充分性由专业分析 / Review 处理，Analysis Gate 只检查字段、取值、必要引用和已有结果，不凭字段存在证明推荐正确。

最终 Summary 显式打印 Recommendation、Reason、Verification Focus，但 Summary 只渲染 Structured Analysis Result，不成为新的 Truth Source。Human 批准后需要改变验证安排时，按主方案既有审核流程处理，不由 Workitem Analyst 或 Engineer 自行降低标准。

# 17. `context-analysis`

`context-analysis` 提供需求 / 问题与工程上下文，调查相关业务场景、已有规则、系统能力和实现事实，支撑后续分析，不替代 `requirement-analysis` / `bug-analysis` 的专业结论。

`context-analysis` 是方法，不要求每次生成 `context-pack.md`。统一要求是：

```text
Context Evidence 必须可追溯
context-pack.md 仅在复杂任务需要时生成
```

简单任务例如单仓、目标明确、既有 Spec 清晰、证据引用较少时，Evidence References 直接进入 Structured Analysis Result / 当前专业 Artifact 即可，不为形式创建 Context Pack。

以下情况优先生成 `context-pack.md` 作为 Supporting Evidence：跨 Repository / 跨服务调查、历史规则复杂、需要较长 Evidence Chain、规格与实现存在多处差异、需要集中保存大量持久化引用。生成后它仍只是 Supporting Evidence，不成为 Proposal / Spec / Bug Analysis 的第二份正文。

`context-analysis` 必须天然支持跨 Repository 调查，不得在定位到第一个相关 Repository 后停止。

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

### 17.1 已有规格与实际实现

调查当前相关范围时，存在可读取的相关主规格则一并读取 `openspec/specs/`，与代码 / 测试和可获得的运行证据对照，不等到准备文档时才检索规格。读取已有 Markdown 规格不以 OpenSpec CLI 可用为前提。

| 输入 | 用途 |
|---|---|
| TFS Work Item / 已确认需求 / Human 补充 | 本次目标、使用者与业务场景、已确认规则及约束 |
| 已有主规格 | 已约定的行为、场景与外部限制 |
| 代码、测试、运行记录 | 已实际实现或观察到的行为 |

不能把代码现状自动视为正确规格，也不能把规格存在视为已经实现。不一致必须保留来源；如已生成 Context Pack 可集中记录，否则以 Evidence References / 当前专业 Artifact 记录。影响本次方案或正确性判断时交相应分析 / Human 确认，不静默覆盖任一来源。

只补足本次修改相关的规格认识，不以全量补齐 Monorepo 规格库作为前置条件。`sdd-fast` 尚无主规格时，标明已确认的既有行为及证据，必要基线在当前 Change 中准备，不提前将尚未交付的变化写入主规格。

`bug-fix` / `production-fix` 同样使用统一 Change；已有主规格只是 Expected Behavior 的一种来源，缺少相关主规格不要求先补齐模块 / 全仓规格库。继续依据已确认需求、Human 说明与相关证据分析，代码现状不能单独证明预期正确。缺少必要 Expected Behavior / 根因证据时停止澄清；缺少 CLI / 根仓访问时按 §9.4 保留调查、停止准备完成声明，两种缺口不得混淆。

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

# 18. Bug / Production Fix 共用 `bug-analysis`

两类任务技术方法相同：

```text
bug-fix
        ┐
        ├── bug-analysis
production-fix
        ┘
```

`bug-analysis` 负责：

```text
Problem Scenario / Affected Behavior
Observation
Expected vs Actual / Expected Behavior 来源
Failure Path
Root Cause Hypothesis
Evidence
Verification
Conclusion
Fix Strategy
Fix Scope
Regression Scope
Verification Requirements
```

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

这里的 Repository 数量不改变 `bug-fix` / `production-fix` Route。根据本轮回归与验证要求，同步按 §16 形成 Verify 推荐、理由和重点；同一组结论直接形成 §26 产物，随后由 `spec-preparation` 完成轻量 Change 准备，不重跑 `requirement-analysis`。

---

# 19. Corrective 分析验证

`bug-analysis` 保留 `Hypothesis → Evidence → Verification → Conclusion` 的诊断闭环。统一 Change 不增加默认 `requirement-review`，也不表示取消语义检查。

Preparation 提交前在当前 Workitem Analyst 的专业执行中检查：

- Expected Behavior 与来源明确，根因结论及证据能够支撑当前 Fix Strategy；Proposal 未新增未经确认的产品目标。
- Tasks 覆盖必要修复、Regression Scope 和开发侧验收；不把外部审批、独立 Verify、PR / Archive 填入工程待办。
- Design / Delta（如有）与既定行为、修复范围、AC / 验证要求一致；省略理由与原生支持一致，未用跳过掩盖规格变化。
- 当前 Change、分析 / Evidence 引用和 Verify 推荐可读取；发现偏差时仅修正命中内容及其必要关联。

以结构化 Corrective Consistency Result 保留检查结论、范围引用和必要 Finding，并由 Structured Analysis Result / Review Facts 引用；不强制新增 `corrective-review.md`、Preparation Result Markdown、独立 Review Agent、Stage 或 Gate。Gate 消费结论和原生事实，不自行证明根因或规格正确。

```text
bug-analysis 内部证据验证
+ spec-preparation 的 Corrective 一致性检查 / 原生 Validation
+ analysis-completion / Analysis Gate
+ 既有 Human Analysis Review
```

若关键根因、行为或范围仍不能确认，停止并按既有 Lead / Human 边界处理；需要补充专业审查时使用现有协作机制，不把“轻量”解释为必须少检查或允许未决问题进入研发。

---

# 20. SDD-fast 执行链

```text
workitem-analysis
        ↓
context-analysis
        ↓
requirement-analysis
        ↓
spec-preparation
        ↓
requirement-review
        ↓
analysis-completion（Workitem Analyst）
        ↓
Analysis Gate PASS → 发布产物 → 写入并回读 analysis_review
        ↓
结束本轮分析，等待 Human Analysis Review

```

OpenSpec Preparation / Review 属于规格驱动开发的分析与准备，不新增 Multica Stage。人工审核后的批准、根仓提交和研发组织只引用主方案 §9–§10；本执行链止于提交审核。

---

<a id="requirement-analysis"></a>

# 21. Requirement Analysis

`requirement-analysis` 只处理 Intentional Change。它是一种专业分析方法，不再要求生成固定的 `requirement-analysis.md`；目标是把已确认结论直接沉淀到后续真正消费它们的权威位置。

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
Acceptance Criteria
Development Scope / Constraints
Verification Requirements
Risks / Open Decisions
```

已确认事实、待验证假设、方案建议与需要 Human 决定的事项必须区分。影响正确实现的业务歧义不能留给 Engineer 自行猜测；属于局部实现选择的事项不人为升级为需求决策。

分析结论按 Owner 直接落位：

| 结论 | 权威位置 |
|---|---|
| Why / Goal / Change Scope / Capability 摘要 | `proposal.md` |
| Expected Behavior / Business Rules / Normal、Error、Boundary Scenarios / AC | `specs/<capability>/spec.md` / Delta Spec |
| Selected Technical Approach、关键 Contract / Data / Dependency / 风险处理 | `design.md`；Intentional 为 Required Artifact，深度按复杂度伸缩 |
| Implementation / developer-side validation checklist | `tasks.md` |
| Development Scope / Repository Scope、Verification Requirements、Verify Recommendation、Risks / Open Decisions、Evidence References | Structured Analysis Result |
| 大量复杂调查上下文 | `context-pack.md`，仅在 §17 条件满足时生成 |

因此不再维护一份与 Proposal / Spec / Design / Tasks 重复的固定 `requirement-analysis.md`。确有复杂业务决策历史或需要长期保留的补充说明时，可作为 Supporting Evidence / Decision Record 保存，但它不是标准必需 Artifact，也不是 OpenSpec Apply 前置。

AC / Verification Requirements 明确后按 §16 形成 Verify 推荐；后续规格准备改变相关范围、AC 或验证依据时同步更新。`requirement-review` 直接审查当前 Proposal / Specs / Design / Tasks、Structured Analysis Result 与 Evidence，不依赖固定 Requirement Analysis 文件。

`requirement-analysis` 不处理：

```text
Corrective Root Cause
Agent Assignment
Development Sub-Issue / Stage
完整 Runtime Task Graph
```

<a id="spec-preparation"></a>

# 22. Spec Preparation

`spec-preparation` 是三条自动 Route 共用的 Change 准备方法。它消费已有专业结论，形成同一 Change 的适用 OpenSpec Artifact 与可确认准备事实；不新建 Agent / Multica Stage，也不要求 Workitem Analyst 与 Engineer 共用 Run。

Corrective 依 §26 直接形成轻量产物，不重跑需求分析；Intentional 将 `requirement-analysis` 的结论直接维护到 Proposal / Specs / Design / Tasks，不先生成一份平行 Requirement Analysis 文档再二次拆写。

## 22.1 输入

```text
当前 Delivery Issue identity / Route / Change Intent
可复用 Context Evidence / Supporting Evidence（如有）
Corrective：bug-analysis / Expected Behavior 来源 / Root Cause Evidence / Fix Strategy / Regression Scope
Intentional：已确认 Goal / Scenarios / Rules / Scope / Selected Solution
当前 Development Scope / Repository Scope / 技术约束
AC 的权威引用 / Verification Requirements / Verify Agent Recommendation
已有 Change 引用与适用主规格（如有）
原生 Schema / 项目配置 / 安装版本可用能力
```

## 22.2 准备流程

```text
核对唯一 Change / 根仓与最终产物位置
→ 按 Route 复用已形成结论，读取必要原生指令与当前状态
→ 按当前 Schema 直接维护 required / conditional Artifact
→ 检查 Tasks 对 AC / Fix / Spec 的覆盖与开发侧验证方式
→ 核对原生结构 / skip / Validation，并同步 Structured Analysis Result
→ Corrective：§19 内部一致性检查，交 analysis-completion
→ Intentional：交 requirement-review，再交 analysis-completion
```

当前 Schema 契约保持不变：

```text
corrective-change
= bug-analysis + proposal + specs/skipped + tasks

intentional-change
= proposal + specs + design + tasks
```

Intentional 的 Specs / Design 均为 Required Artifact；Design 只是深度按复杂度伸缩，不使用“按需文件”或 `skip_design` 弱化当前项目契约。Corrective 的 Proposal 本轮继续保留为轻量 Change 摘要。

## 22.3 输出与权威来源

Preparation 不要求创建 `preparation-result.md`。准备事实以结构化结果 / 原生状态引用表达，例如：

```yaml
openspec:
  change_id: ...
  path: ...
  schema: corrective-change | intentional-change
  spec_required: true | false
  design_required: true | false
  validation: PASS | FAIL | UNKNOWN
  state_ref: ...
```

其中 `spec_required` / `design_required` 是对当前 Schema 与合法 skip 事实的派生说明，不是允许绕过 Schema 的开关：`intentional-change` 的 Specs / Design 固定 required；`corrective-change` 的 Specs 可合法 skipped，Design 不属于默认 Schema Artifact。

同时保留任何合法省略的理由、Evidence / Finding 引用与 Corrective 一致性结果。原生 Validation 不能代替专业结论、AC、Verification Requirements 或 Human Approval。

## 22.4 任务—行为—验证对应

每项必须实现的行为、修复目标或 AC 都应能追到相关 Tasks 和开发侧验证方式。对应直接使用现有路径、标题、任务编号与 AC，不新增独立追踪文件。

| 分析依据示例 | Tasks 中的工程动作 | 开发侧验证 |
|---|---|---|
| Corrective：无查询结果应返回空列表；已有证据定位转换异常 | 增加失败回归、修正转换、验证相关正常场景 | 同一 Regression Signal 在修复前失败、修复后通过 |
| Intentional：未授权用户不能导出 | 权限校验与拒绝场景测试 | 验证拒绝且没有数据泄露 |

以上是内容示例，不是实际业务需求。独立验收要求仍由 Verification Requirements 与既有批准机制承载。

## 22.5 停止与职责边界

不决定 Roster、Owner、Sub-Issue、Stage 或 Assignment，不执行生产代码和 Archive。原生结构 / 配置不兼容、身份 / 权限不明或必要 Artifact / Result 不可读取时，停止准备完成声明并报告具体缺口；保留有效分析，不默默改为无 Change 流程，不复制解析器或新建 Schema 兜底。

`spec-preparation/SKILL.md` 后续只实现本节的最小执行方法；根因分析仍属于 `bug-analysis`，Intentional 语义审查仍属于 `requirement-review`，提交与有限状态写入仍属于 `analysis-completion`.

<a id="openspec-tasks"></a>

# 23. OpenSpec Tasks 与 Multica Development Unit

必须保持：

```text
OpenSpec tasks.md
≠
Multica Development Sub-Issue
```

OpenSpec Tasks 是工程清单，不是 TFS Task；即使 Bug 使用 Tasks，也仍按原始 TFS 类型执行主方案的 Task 创建 / 统计规则。

`tasks.md`：

```text
Implementation Checklist
```

它描述实现当前规格 / 工程目标及开发侧验证需要完成的技术工作，可以由一个或多个 Development Unit 执行；不是仅用于归档的静态附件。

| 纳入 Tasks | 不纳入 Tasks |
|---|---|
| 代码 / 页面 / 数据修改，必要测试、回归、兼容性和开发侧运行验证 | 等待 Human Approval、创建 Sub-Issue、等待独立 Verify Agent、等待 PR 合并、OpenSpec Archive、关闭 TFS |

独立验收要求仍在 Verification Requirements 中表达，是否执行由现有已批准 Verify 机制决定。不能把整个 Delivery 的运行步骤放进工程 checklist，造成 Development 等待 PR、PR 又等待 Development 的循环。

Development Sub-Issue 的独立 Owner / 生命周期规则由主方案 §10–§12 定义，本节只维护 OpenSpec Tasks 的内容与消费边界。

因此允许：

```text
1 OpenSpec Change
→ N 个 Development Unit
```

也允许一个 Development Unit 消费多个 OpenSpec task。

不得机械执行：

```text
tasks.md task 1 → Sub-Issue 1
tasks.md task 2 → Sub-Issue 2
```

是否创建 Sub-Issue、Owner、Assignment / `@mention` 与 Stage 由 Human Analysis Review 通过后的 Delivery Lead 在批准边界内决定。

`tasks.md` 的 checkbox 是实施清单事实，不是 Multica Delivery Status。当前 Unit 只需完成自身承担的必要工程任务和 Engineering Contract，不等待其他 Unit 的任务全部勾选；整个 Change 的实施完成还要求所有 required Units 完成且无遗漏的必要工程任务。具体放行与交付完成条件以总方案为准。

任务组可以作为派发范围引用，但不能机械决定 Owner / Sub-Issue。派发后，Engineer 仅更新当前承担任务及批准范围内的细化，更新权限见 Engineer 方案 §8.3。任务确实不再需要时保留取消 / 替换理由并按授权调整；不得为通过检查虚假勾选，或删去仍须满足的要求。

---

<a id="requirement-review"></a>

# 24. Requirement Review

`requirement-review` 只服务 `sdd-fast`，对 Intentional 需求结论与完整 OpenSpec Change 做独立只读 Review：先确认需求与问题是否清楚，再检查规格、设计、任务、验收与验证契约是否一致、完整、可实现、可验证；不以文件齐全或技术方案可编码代替需求质量审查。

它是 Review 方法，不要求生成 `requirement-review.md`。

读取：

```text
OpenSpec Change Reference
proposal.md
spec / delta spec
设计文档 design.md
任务文档 tasks.md
Structured Analysis Result
  - Development Scope / Repository Scope
  - Verification Requirements
  - Verify Agent Recommendation / Reason / Verification Focus
  - Risks / Open Decisions
  - Evidence References
Supporting Evidence（如有，例如 context-pack.md）
```

AC 直接从 Spec / Delta Spec 的权威场景读取，不要求在 Review 输入中复制一份完整 AC 列表。

Review 至少检查：

```text
需求目标、相关使用者 / 业务场景及期望结果清楚
业务规则、正常 / 异常 / 边界场景、In-Scope / Out-of-Scope 与 AC 足以指导实现
关键业务歧义和需人工决定的事项未被假设掩盖
Proposal 的意图与范围与 Spec 一致
Spec / Delta Spec 准确表达业务规则与 Expected Behavior 的变化
规格场景覆盖本次行为变化及相关 AC
Design / Tasks 与规格对应，足以指导实现与验证
Design 记录 required 技术决策，深度与复杂度匹配而非模板填充
无 Scope Drift / 未决关键决策
规格场景、AC 与 Verification Requirements 对应且可验证
每项必须实现的行为有工程任务与验证方式承接，无遗漏
Tasks 不包含等待审批、独立验收、PR 合并或归档等运行步骤
原生准备状态 / Validation 与当前 Schema 契约一致
Verify 推荐的理由与 Verification Focus 对应当前 AC / Verification Requirements
```

输出结构化 Review Result / Findings，例如：

```yaml
review:
  type: requirement
  verdict: APPROVED | NEEDS_REVISION
  reviewed_artifacts:
    - proposal
    - specs
    - design
    - tasks
    - analysis_result
  findings:
    - id: RF-...
      severity: blocker | major | minor
      area: ...
      description: ...
      evidence: ...
      suggestion: ...
  unresolved_blockers: 0
```

最多建议 2 rounds。`NEEDS_REVISION` 只对 Finding 命中的 OpenSpec Artifact / Analysis Result 及其必要关联内容做 targeted rework，继续使用同一个 active OpenSpec Change，不新建平行 Change。

`review.verdict=APPROVED` 只表示 AI Review 通过；最终仍必须进入 Human Analysis Review。

<a id="analysis-completion"></a>

# 25. Analysis Completion

`analysis-completion` 由 **Workitem Analyst** 执行，负责组装逻辑 Analysis Package 的引用、调用 Gate、发布 Structured Analysis Result / 必要视图并提交 Human Review；完成写入与回读后结束本轮分析，不仅为状态写入另行唤醒 Delivery Lead。

## 25.1 输入与有限权限

读取当前 Delivery Issue、Route、§1.2 的专业准备结果、当前 OpenSpec Change、Structured Analysis Result、Review Result、§16 的 Verify 推荐和关联 Evidence；发现专业缺口交回对应分析方法，不在组装步骤重做完整需求分析。

Workitem Analyst 只可在当前授权分析任务的提交环节写入 `analysis_review`，保持 `assignee = Delivery Squad`。不得自行批准、把提交审核当作研发授权，或将父 Delivery 置为 `done`。

## 25.2 执行步骤

```text
确认逻辑 Analysis Package：OpenSpec Change + Structured Analysis Result + Supporting Evidence / Review Facts
→ 调用现有 Analysis Gate（§28）
→ PASS 后发布 / 更新权威 Result 与必要引用
→ 渲染面向人的 Summary，不复制完整技术正文
→ 发布 Gate 结果引用
→ 确认 Human 能读取本轮分析及检查结果
→ 写入 Delivery Issue.status = analysis_review
→ 回读确认 Issue 状态、Squad Ownership 及发布引用
→ 输出已提交审核的事实，结束本轮分析，等待 Human Review
```

Gate 只返回 `PASS / FAIL / UNKNOWN`，不修改 Issue 状态。只有发布和状态后置条件均确认后，才能报告“已提交人工审核”；不能以 Gate PASS、命令退出成功或 Run 成功代替。

<a id="analysis-summary"></a>

## 25.3 输出与结束边界

Summary 至少展示：

```text
Requirement / Problem Goal and Scenarios
Expected Behavior / Rules / Scope / AC references
Selected Solution / Fix Strategy / Development Scope
Constraints / Open Decisions
Technical Decomposition Suggestion（确有建议时）
Verify Agent Recommendation: REQUIRED | NOT REQUIRED
Reason
Verification Focus
```

Summary 是 `render(OpenSpec Change + Structured Analysis Result)` 的人类可读视图，不创建 `analysis-summary.md`，也不作为新的 Truth Source。结构化推荐继续使用 §16 的 `required / not_required`。

现有 Result / Artifact 同时说明：当前 Issue、Route、逻辑 Analysis Package / Gate 结果引用、实际回读状态，以及已完成或尚未完成的发布 / 写入动作。正常终点是“分析提交成功，等待人工”，不是“已批准研发”或“Delivery 完成”。

`STOP` 在这个环节仅表示结束本轮自动分析；不会关闭 Delivery，也不将正常等待改为 `blocked`。人工审核后的自然语言理解、状态离开和返工派发由 Delivery Lead 负责，见总方案 §9。

## 25.4 失败与恢复

| 当前事实 | 处理 |
|---|---|
| Gate FAIL | 按明确缺失项定向完善，不发布为待审成功，不写入 `analysis_review` |
| Gate UNKNOWN、身份 / 必需输入 / 权限无法确认 | 停止提交，说明缺口并交 Delivery Lead / Human；不伪造 PASS |
| Result / Evidence 发布失败，或状态写入失败 / 结果未知 | 保留已确认结果，先回读当前产物和状态再补缺失项；不得声称已进入审核 |
| 同一本轮分析已发布且处于 `analysis_review` | 确认引用后复用，不重复通知、创建附件或切换状态 |
| 重试旧提交时，人工已处理该轮或流程已进入后续返工 / 研发 / 结束 | 不重放旧提交，不覆盖后续状态；当前新委派的返工完成后仍可按 §25 提交新修订 |

当前 Run 有界结束，不驻留轮询人工决定。部分成功的恢复使用现有 Issue、Artifact / Comment 和 Run 记录；正常审核等待不因本方法返回而自动激活研发，真实权限或环境阻塞按既有规则处理。

# 26. Corrective OpenSpec Change / Bug Analysis Package

适用于 `bug-fix` 与 `production-fix`。本节维护项目级 **`corrective-change` Schema 的专业内容契约**；Schema 不等于新 Route、工作流、Stage 或 Skill。

## 26.1 内容与文件归属

| 产物 | 内容 / 权威归属 | 不重复维护 |
|---|---|---|
| `bug-analysis.md` / Artifact=`bug-analysis` | 问题场景、Expected vs Actual 与预期来源、Failure Path、Root Cause / Status / Evidence、Fix Strategy / Fix Scope、Repository Scope、Regression Scope、AC / Verification Requirements | 具体工程 checklist 只在 Tasks；Verify 推荐等跨阶段决策进入 Structured Analysis Result |
| `proposal.md` | 轻量 Change 摘要：为什么修、修复 / 不变范围、Capability / Spec 关系，引用 Bug Analysis | 不重述完整诊断、AC 或 Verification Requirements，不虚构 New / Modified Capability |
| `tasks.md` | 修复实现与开发侧验证清单，对应根因 / AC / Regression Scope | 不复制 Root Cause 论证，不塞入审批、独立 Verify、PR / Archive |
| `specs/<capability>/spec.md`（条件性） | 本次需要长期保留的既定行为补录 / 澄清；无规格级变化时使用合法 `skip_specs` | 不写故障日志、代码行、诊断过程，不为通过校验制造 Delta |
| `context-pack.md`（条件性 Supporting Evidence） | 仅在 §17 的复杂上下文 / 长 Evidence Chain 场景生成 | 不作为每个 Corrective Change 的固定文件，不复制完整会话或大日志 |
| 附加 `design.md`（条件性、非 Schema Artifact） | 复杂修复确需独立技术设计时保存并显式引用 | 不把它升级为所有 Corrective 的默认前置 |

默认布局中的最小 Schema Artifact 保持：

```text
openspec/changes/<change-id>/
├── .openspec.yaml
├── bug-analysis.md
├── proposal.md
├── tasks.md
└── specs/<capability>/spec.md   # 本次确有 Delta 时；否则合法 skip_specs
```

按需可以附加：

```text
context-pack.md                  # Supporting Evidence
additional design.md             # 复杂修复设计，非默认 Schema Artifact
```

外部 Evidence 不强制搬入 Change 目录，但必须持久化且跨 Run / 归档后可访问。

## 26.2 轻量准备与交接

`bug-analysis` 形成诊断结论、AC 与 Verification Requirements；`spec-preparation` 直接复用并维护当前 Change，不重跑 `requirement-analysis`。Proposal 只作为轻量 Change Manifest，不复制完整 Bug Analysis。复杂修复需要独立 Design 时由 Bug Analysis / Handoff 显式引用。

Structured Analysis Result 保存 Development / Repository Scope、Verify Recommendation / Reason / Focus、Risks / Open Decisions 与 Evidence References；不再依赖 Summary 或 Context Pack 承担这些字段的唯一事实来源。

Workitem Analyst 按 §19 检查内部一致性，按 §25 提交既有人审。`requirement-review` 不成为 Corrective 默认步骤；新增 Delta 也不自动派发完整 Intentional Review，但必须检查来源、已有约束保留与场景 / 测试对应。

交接必须让独立 Engineer Run 读到当前 Change / 已批准基线、自己的 Tasks 与 Repository / Unit 范围、Root Cause / Fix Strategy、Regression Scope、AC 与 Verification Requirements。只依赖 Workitem Analyst 会话、临时目录或不可定位的相对路径不满足交接。

## 26.3 完成边界

进入 Human Review 前，必要 OpenSpec Artifact、Structured Analysis Result 和实际需要的 Supporting Evidence 可读取；原生 skip / Validation 一致；§19 检查无未解决关键问题；Verify 推荐完整。完整交付仍需工程与必要独立验收、业务 PR、主方案 §22 的 Archive / 根仓 Commit / 引用恢复。

<a id="sdd-analysis-package"></a>

# 27. SDD-fast Analysis Package

`sdd-fast` 的 Analysis Package 是逻辑集合，不创建 `analysis-package.md`：

```text
Analysis Package
├── OpenSpec Change (`intentional-change`)
│   ├── proposal.md              REQUIRED
│   ├── specs/...                REQUIRED
│   ├── design.md                REQUIRED / depth by complexity
│   └── tasks.md                 REQUIRED
├── Structured Analysis Result
│   ├── Development Scope / Repository Scope
│   ├── Verification Requirements
│   ├── Verify Agent Recommendation / Reason / Verification Focus
│   ├── Risks / Open Decisions
│   ├── Evidence References
│   └── Requirement Review Result reference
└── Supporting Evidence（按需）
    └── context-pack.md 等
```

Intentional 的 Acceptance Criteria 以 Spec / Delta Spec 中的 Requirement / Scenario 为权威；Structured Analysis Result 只保存必要 AC 引用与 Verification Requirements，不复制完整规格正文。

`requirement-analysis` 作为方法直接生成 / 更新上述权威内容，不要求 `requirement-analysis.md`。`requirement-review` 输出结构化 Review Result / Findings，不要求 `requirement-review.md`。

OpenSpec Artifact 是后续规格驱动实现与验证的主要技术依据。Multica Issue / Artifact 只保存必要 Result、引用与 Review / Delivery 事实，不复制整套 OpenSpec 内容。

<a id="analysis-gate"></a>

# 28. Analysis Gate

Analysis Gate 只检查并返回结果，不发布产物、不修改 Issue Status、不授予研发权限。先确认当前任务处于三条自动 Route，再核对逻辑 Analysis Package 与当前 Schema 的专业差异；超出自动范围按原有停止规则处理。

## 28.1 公共检查

```text
Delivery Issue / TFS identity 与当前 Route 可对应
当前唯一 OpenSpec Change / Schema / 根仓位置可确认
Development Scope / Repository Scope 可读取
AC 权威来源可读取
Verification Requirements 可读取且能引用 AC / 场景
verify_agent.recommendation / reason / verification_focus 完整且引用有效
Evidence References 可追溯；需要 Supporting Evidence 时对应资料可读取
当前 Schema 的必需 Artifact、合法 skip 与 OpenSpec Validation 一致
专业 Review / Consistency Result 可读取，无 unresolved blocker
```

Gate 不要求固定 `context-pack.md`、`requirement-analysis.md`、`requirement-review.md`、Preparation Result Markdown、`analysis-package.md` 或 `gate-result.md`。它检查这些概念对应的真实 Artifact / Structured Result / 引用。

## 28.2 Bug / Production Fix

公共检查加 Corrective 轻量契约：

```text
Bug Analysis / Expected Behavior 来源可读取
Root Cause Status、支持当前结论的 Evidence 与 Fix Strategy 存在
Fix Scope / Regression Scope / 必要约束与 AC 对应
Bug Analysis 中 AC / Verification Requirements 完整且可验证
Tasks 覆盖当前修复与开发侧验证要求
§19 Corrective Consistency Result 及其输入引用可读取，关键 Finding 已解决
适用附加 Design / Delta 与修复边界一致；无 Delta 时原生 skip 有效
```

不要求 Requirement Analysis / Requirement Review 或人为制造 Spec / Design。

## 28.3 SDD-fast

公共检查加 Intentional 专业契约：

```text
Proposal 可表达 Why / Goal / Scope
Spec / Delta Spec 可表达 Expected Behavior / Rules / Scenarios / AC
Design 为当前 intentional-change Required Artifact，内容深度与复杂度匹配
Tasks 覆盖当前 Spec / AC 与开发侧验证
Structured Requirement Review Result = APPROVED
无未解决关键语义 Finding / blocker
```

需求清晰度、覆盖、一致性、可实现性及可验证性仍由 `requirement-review` 语义判断；原生 Validation PASS 不能替代。

## 28.4 结果与有限权限

```yaml
result: PASS | FAIL | UNKNOWN
reasons:
  - ...
```

必要项明确缺失 / 不合法为 `FAIL`，事实 / 身份 / 权限 / 结果无法确认时为 `UNKNOWN`。`PASS` 后仍由 Workitem Analyst 按 §25 发布引用 / Result、写入并回读 `analysis_review`，再等待 Human；不生成 `verify_agent.required`，不等同于获准编码。

# 29. Human Analysis Review 接口

所有自动 Analysis 均在 §25 的发布、状态写入和回读成功后进入人工审核。正式状态 Key 为 `analysis_review`，正常等待不改为 `blocked`；Key / Display Name 定义见指导手册 §1.2.3。

Human 决定是否批准；Delivery Lead 理解自然语言意见、核对条件并组织后续动作。完整审核、批准 / 退回、状态离开与恢复规则只引用 [主方案 §9](multica-squad-centric-delivery-v1.4.14.md#human-analysis-review)。Workitem Analyst 不自行处理“是否已获准研发”的判断，不以 AI Review APPROVED、Analysis Gate PASS 或 `in_progress` 代替 Human 授权。

本阶段的后续接口：收到明确分析返工请求时，消费原始意见引用、修正方向和受影响范围，按 §32 定向修订并重新提交；仅局部分工变化由 Delivery Lead 处理，不重做专业分析。

Comment / Reply 的原生路由见 [指导手册：Comment、Mention 与回流](multica-design-guideline-v1.9.md#mechanism-comments)。不能因评论被触发、回复到某个线程或出现批准关键词，推断已经取得有效人工决定。

---

# 30. 下游交付边界

本阶段的正式输出是可审核的逻辑 Analysis Package（OpenSpec Change + Structured Analysis Result + Supporting Evidence / Review Facts）及提交事实。跨阶段推进由主方案维护，本节只保留交接所需边界和权威引用。

## 30.1 TFS 与 Development 交接

Workitem Analyst 传递原始 TFS Type、Route、需求 / 问题结论、Development / Repository Scope、技术依赖与约束、必要方案 / Fix Strategy、AC / Verification Requirements 及 Verify 推荐；三条自动 Route 均传递 Change、当前 Tasks 与适用 Design / 规格引用，Corrective 保留根因 / 修复与回归依据。

Human 批准后的 TFS Task、成员选择、Unit / Sub-Issue 及 Stage 分工由 [主方案 §10–§14](multica-squad-centric-delivery-v1.4.14.md#development-materialization) 定义。四层交付对象见指导手册 §1.2.2，本阶段不再次维护拓扑判定表。

## 30.2 PR 引用与事实归属

Workitem Analyst 交付 Repository Scope、必要接口约束和验收要求，不创建 PR，不填写尚不存在的 PR ID，也不以 PR 完成作为分析或工程任务的前置条件。

PR Preparation、Materialization、`current_pr` / `pr_history`、外部终态与恢复统一引用 [主方案 §17](multica-squad-centric-delivery-v1.4.14.md#pr-materialization)、[§18](multica-squad-centric-delivery-v1.4.14.md#pr-status-sync)、[§26](multica-squad-centric-delivery-v1.4.14.md#delivery-facts)。

## 30.3 Development 与 Delivery 完成

Development Unit 完成 Engineering Contract 后，由父 Delivery 继续必要 Verify、业务 PR 与 Finalize；Workitem Analyst 不聚合这些下游完成条件，也不关闭 Delivery。

Unit 完成以 [主方案 §11–§12](multica-squad-centric-delivery-v1.4.14.md#simple-delivery)、§15 为准；Delivery 完成以 [主方案 §21–§22](multica-squad-centric-delivery-v1.4.14.md#delivery-completion) 为准。Engineer 的详细输入与完成方法见 [Engineer 阶段方案](engineer-development-stage-design-v1.9.md#engineering-input)。

---

<a id="analysis-routing-config"></a>

## 30.4 `analysis-routing.yaml`

`workitem-analysis` 不应在 `SKILL.md` 中长期维护三条 Route 的完整路由表。

推荐增加：

```text
workitem-analysis/
├── SKILL.md
├── config/
│   └── analysis-routing.yaml
├── scripts/
│   ├── resolve-analysis-route.py
│   └── validate-analysis-route.py
└── references/
    └── analysis-route-contract.md
```

`analysis-routing.yaml` 是 Analysis Route 的唯一配置源。下面只是后续实现目标，不表示当前配置已经修改。本轮 Artifact Model 重构不要求在 Route 配置里复制 OpenSpec Artifact Graph，也不把 `context-pack.md`、`requirement-analysis.md`、`requirement-review.md` 重新变成 required artifacts。

配置负责定义：

```text
合法 Route
TFS Type 约束
Change Kind 约束
Analysis Method / Skill
Preparation Method / Skill
AI Review 是否需要及使用哪个 Review Skill
Human Analysis Review 是否需要
```

示例：

```yaml
version: 1

routes:
  bug-fix:
    openspec:
      schema: corrective-change
    source:
      tfs_type: Bug
    analysis:
      skill: bug-analysis
    preparation:
      skill: spec-preparation
    ai_review:
      required: false
    human_review:
      required: true

  production-fix:
    openspec:
      schema: corrective-change
    source:
      tfs_type: Requirement
    semantic:
      change_kind: corrective
    analysis:
      skill: bug-analysis
    preparation:
      skill: spec-preparation
    ai_review:
      required: false
    human_review:
      required: true

  sdd-fast:
    openspec:
      schema: intentional-change
    source:
      tfs_type: Requirement
    semantic:
      change_kind: intentional
    analysis:
      skill: requirement-analysis
    preparation:
      skill: spec-preparation
    ai_review:
      required: true
      skill: requirement-review
    human_review:
      required: true

fallback:
  unsupported_scope:
    action: stop
    target: human
```

OpenSpec Artifact 的 required / conditional / skipped 契约由当前 Schema 负责；Structured Analysis Result、AC Owner、Verification Requirements、Verify Recommendation、Evidence 可追溯性由 §1.2.1、§16、§26–§28 负责。Route Config 不维护第二份 Artifact 清单。

配置文件只定义：

> **一个已知语义对应哪个 Route，以及该 Route 要执行什么方法。**

它不通过关键词等确定性规则判断：

```text
Requirement 是 Corrective 还是 Intentional
```

该判断仍由 Workitem Analyst 基于上下文进行 LLM Semantic Decision。

随后：

```text
semantic result
→ resolve-analysis-route.py
→ deterministic route
```

正式边界：

```text
LLM
= Corrective / Intentional Semantic Classification

analysis-routing.yaml
= Route Contract

resolve-analysis-route.py
= Deterministic Route Resolution

Skill
= Route 对应的专业执行方法
```

Repository 数量不参与 `analysis-routing.yaml` 的一级 Route 判断。

---

# 31. `workitem-analysis` Driver

`workitem-analysis` 是 Workitem Analyst 的唯一 Canonical Entry。输入按 §7 检查，Route 依据 §11 的语义结果与 §30.4 配置确定；不以关键词程序替代 Corrective / Intentional 判断。

```text
当前明确的分析任务 / 定向返工请求
→ 核对 Issue、来源、现有结果与本轮范围
→ Context 缺失或过期时执行 context-analysis
→ 按当前 Route 使用专业方法
   bug-fix / production-fix → bug-analysis（形成 Verify 推荐）→ spec-preparation（轻量 / 内部一致性检查）
   sdd-fast → requirement-analysis → spec-preparation（同步 Verify 推荐）→ requirement-review
   超出自动处理边界 → sdd-standard / STOP / Human
→ 汇集当前逻辑 Analysis Package 与已形成、适用时已复核的 Verify Agent Recommendation
→ analysis-completion：Analysis Gate / 发布 / 写入并回读 analysis_review
→ 结束本轮分析，等待人工
```

已有有效分析与审核提交时，不因重复通知重跑完整 Analysis 或覆盖后续状态。收到明确修正请求时按 §32 定向执行；必要关联内容和当前 Gate 仍需复核。

本 Driver 不解释人工批准、不提交批准后的开发基线、不决定成员分工或启动 Engineer；这些动作由主方案 §9–§10 的 Delivery Lead / `delivery-flow` 处理。优先级边界见 §6。

---

<a id="analysis-rework"></a>

# 32. 定向返工契约

收到 Delivery Lead 的明确分析修正请求后，读取原始 Human Comment / Finding 引用、修正要求、受影响范围和当前产物；方向不明确或与有效决定冲突时先澄清，不编造拒绝理由，不自动重做全部 Analysis。

| 反馈命中内容 | 当前专业方法 |
|---|---|
| Context / Repository Evidence | `context-analysis` |
| 问题场景、Expected vs Actual、Root Cause、Fix Scope（Corrective） | `bug-analysis` |
| Goal、业务场景、规则、Scope、AC、Solution、Impact（sdd-fast） | `requirement-analysis` |
| Proposal、Spec、Design、Tasks / OpenSpec Change（全部自动 Route） | `spec-preparation`，更新同一 active Change |
| 技术依赖 / 约束、Verification Requirements、Verify 推荐 | 当前 Route 的相关分析部分；推荐按 §16 同步修订 |

只修正命中内容和必要关联产物；规格、Tasks、AC / Verification Requirements 或推荐受影响时一并对齐。Corrective 通过 §19 的受影响范围一致性复核，`sdd-fast` 通过适用的 `requirement-review` 后，再执行 `analysis-completion` 和当前 Route 的 Analysis Gate，发布修订并回读确认 `analysis_review`，结束本轮返工。

返工授权只允许修订分析，不允许开始编码；`in_progress` 不能单独证明获准研发。Human 意见理解、状态离开与返工派发由主方案 §9 维护，本节不复制这套跨角色流程。

---

# 33. Analysis 与 Development 边界

| 工作 | 负责位置 / 终点 |
|---|---|
| 需求与问题理解、场景 / 规则 / 范围 / 验收澄清、Context、必要方案及按 Route 的研发准备 | Workitem Analyst；按 §1.2 形成可审核、能支撑研发与验证的逻辑 Analysis Package |
| Analysis Gate | 只校验当前 Route 的可确认条件并返回结果，不写状态 |
| Verify Agent Recommendation | Workitem Analyst 按 §16 形成推荐、理由与验收重点；Human 批准后的执行事实由主方案维护 |
| 发布与提交 Human Review | Workitem Analyst / `analysis-completion`：发布、写入并确认 `analysis_review`，结束本轮分析 |
| 人工决定与意见处理 | Human 决定；Delivery Lead / `delivery-flow` 理解自然语言意见并落实，不以原生准备完成或 Agent 自述替代批准 |
| TFS Task、必要 Sub-Issue 及协作安排 | Human 批准后的 Delivery Lead / 必要确定性物化，见总方案 |
| Branch、规格或 Fix Strategy 驱动实现、Local Validation、Code Review、Commit / Push、PR Preparation、Evidence | 当前 Engineer 的 Engineering Contract |
| 按需独立 Verify、业务 PR、Archive、TFS 关闭 | 父 Delivery 的交付流程，见总方案 |

Analysis 让研发不必猜测需求，不要求预先确定全部局部实现细节，也不指定最终运行分工。三条自动 Route 使用 OpenSpec 持续维护其适用产物：Corrective 保留诊断 / 修复依据及轻量契约，Intentional 保留完整规格准备；Engineer 在批准边界内细化实现，不再重新设计需求或复制一套计划。Engineer 不把整个 Delivery 的完成条件塞入 `tasks.md`；规格、任务、实现和证据通过现有引用衔接，不新增第二套状态。

---

# 34. 推荐目录

以下是后续实现资产的目标结构示意，本轮只更新设计，不修改实际 Skill：

```text
workspace-skills/
│
├── workitem-analysis/
│   ├── SKILL.md
│   ├── config/
│   │   └── analysis-routing.yaml
│   ├── scripts/
│   │   ├── resolve-analysis-route.py
│   │   └── validate-analysis-route.py
│   └── references/
│       └── analysis-route-contract.md
│
├── context-analysis/
│   ├── SKILL.md
│   ├── modules/
│   │   ├── repository-routing.md
│   │   ├── external-knowledge.md
│   │   └── code-investigation.md
│   └── templates/
│       └── context-pack.md              # 仅复杂任务按需使用
│
├── requirement-analysis/
│   └── SKILL.md                         # 方法，不要求同名 Markdown
│
├── bug-analysis/
│   └── SKILL.md
│
├── spec-preparation/
│   ├── SKILL.md
│   └── references/
│       └── openspec-integration-contract.md
│
├── requirement-review/
│   ├── SKILL.md                         # 输出结构化 Review Result
│   └── references/
│       └── review-schema.md
│
└── analysis-completion/
    └── SKILL.md                         # assemble refs / result；不生成 analysis-package.md
```

Analysis Gate 的检查契约由 §28 维护；确定性实现唯一复用主方案 §25 的 `delivery-gate/scripts/validate-analysis.py`。本轮不修改上述实现资产。

<a id="analysis-execution-model"></a>

# 35. 最终执行模型

本图中的 Skill 名称表示专业方法，不表示必须生成同名 Markdown。入口接主方案 §6，终点接主方案 §9；完整交付模型以 [主方案 §29](multica-squad-centric-delivery-v1.4.14.md#delivery-execution-model) 为准。

```text
TFS Work Item → workitem-analysis → context-analysis
                       │
         ┌─────────────┴──────────────────┐
         │                                │
bug-fix / production-fix               sdd-fast
         │                                │
    bug-analysis                  requirement-analysis
         │                                │
spec-preparation（Corrective）    spec-preparation（Intentional）
+ 内部一致性检查                         │
         │                        requirement-review
         └─────────────┬──────────────────┘
                       ▼
              Structured Analysis Result
              + 同一 OpenSpec Change
              + Supporting Evidence（按需）
                       ↓
          Analysis Package（逻辑集合）
                       ↓
analysis-completion → Analysis Gate → 发布 / 写入并回读 analysis_review
                       ↓
                Human Analysis Review
                       ↓
          Delivery Lead（批准后基线提交与交接）
```

对应 Route 保持：

```text
TFS Bug → bug-fix
TFS Requirement + Corrective → production-fix
TFS Requirement + Intentional Change → sdd-fast
Large / New Major Module → sdd-standard / Human
```

# 36. 最终设计决策

本表总结本阶段现行规则，不作为第二份独立契约；跨阶段条目以主方案相应章节为准。

| 项目 | 决策 |
|---|---|
| TFS Type | 公司管理事实，Agent 不修改 |
| 技术变更性质 | Workitem Analyst 语义判断 |
| TFS Bug | `bug-fix` |
| Requirement + Corrective | `production-fix` |
| Requirement + Intentional | `sdd-fast` |
| 大型复杂需求 | `sdd-standard`，暂不自动处理 |
| `hotfix` | 当前不建模 |
| 紧急程度 | 人工排期 / 优先级，不进入 Agent Route |
| `bug-analysis` | 同时服务 bug-fix / production-fix |
| `requirement-analysis` | 只服务 Intentional Change；是分析方法，不要求 `requirement-analysis.md` |
| OpenSpec | 三条自动 Route 共用 Change Model；`corrective` → `corrective-change`，`intentional` → `intentional-change`；不绑定特定命令 |
| OpenSpec Change Identity | 每个自动 Delivery 默认维护一个稳定 active Change；Change 创建时持久化 Schema，Rework 复用，不新增多 Delivery 共用可写 Change |
| New / Modified Capability | 都可生成 Spec / Delta Spec |
| Corrective 无 Spec-level 行为变化 | `corrective-change` 使用原生 `skip_specs`；`sdd-fast` / `intentional-change` 不允许用 skip 掩盖 Intentional Behavior Change |
| Requirement Review | 仅 sdd-fast；输出结构化 Review Result / Findings，不要求 `requirement-review.md`；Corrective 采用 §19 内部一致性检查；均不替代 Human Review |
| TFS Task | 只看原始 `tfs.type` |
| Workitem Analyst | 需求与问题分析及研发准备；不替代 Human 决策，不修改 TFS 管理类型或承担最终成员分工 |
| Analysis 完成标准 | §1.2：需求与问题清楚、必要研发依据充分；不要求预先冻结全部实现细节 |
| Analysis Review Status | Status Key=`analysis_review`；Display Name=`Analysis Review`；category=`started` |
| 提交审核责任 | Workitem Analyst / `analysis-completion` 发布、写入并回读确认状态；不自行批准或启动研发 |
| Review Decision | Human 自然语言评论为来源；Delivery Lead 理解决定和条件，不维护 `analysis.review_status` 或强制格式协议 |
| Analysis Artifact Model | Analysis Package = OpenSpec Change + Structured Analysis Result + Supporting Evidence（按需）+ Review / Gate Facts；逻辑集合不对应同名 Markdown |
| Context Pack | Context Evidence 必须可追溯；`context-pack.md` 仅复杂跨仓 / 长证据链任务按需生成 |
| AC Owner | Corrective → `bug-analysis.md`；Intentional → Spec / Delta Spec；其他 Result / Summary 只引用 |
| Verification Requirements | 必须保留并持久化，定义“必须验证什么”；不因 `verify_agent=not_required` 取消 |
| Verify 推荐 | 所有自动 Route 都输出 Recommendation / Reason / Verification Focus；作为 Structured Analysis Result 字段，不按 Route 预设默认值 |
| Human Analysis Review | 所有自动 Analysis 都需人工决定；不是 Analysis Gate PASS 的同义词，完整流程见主方案 §9 |
| Approved OpenSpec Commit | Human APPROVED 后提交根仓 Git，记录开发基线；允许批准边界内更新，不创建独立 PR |
| Reject Rework | Lead 理解并保留反馈，写入并确认 `in_progress` 后单次委派 Workitem Analyst；修订后由 Workitem Analyst 再提交 |
| Analysis Route Config | `analysis-routing.yaml` 维护三条自动 Route 及越界停止规则；配置示例见 §30.4 |
| Cross-Repository | `bug-fix` / `production-fix` / `sdd-fast` 均允许跨仓 |
| Route 与仓库数 | Repository 数量不参与一级 Route 判断 |
| Sub-Issue | 跨仓不等于必须拆 Sub-Issue；按独立 Development Unit 判断 |
| PR Boundary | 每个需交付的业务代码 Repository 独立 Branch / PR；OpenSpec 根仓不属于业务 required PR 集合，见主方案 §7.1、§17 |
| Multi-PR | 一个 Delivery Issue / Sub-Issue 可以关联多个 PR |
| Completion | Unit 完成 Engineering Contract；Verify / PR / Finalize 属于父 Delivery；详细规则只引用总方案 |

---

# 37. 核心原则

以下为本阶段规则摘要；跨角色与最终完成原则引用 [主方案 §30](multica-squad-centric-delivery-v1.4.14.md#delivery-principles)，不独立重定义。

> **TFS 怎么登记、技术上是什么、走什么开发方法，是三个不同的问题。**

> **Bug 类型的管理规则由 TFS Type 决定，不由 Agent 重分类。**

> **Requirement 可以在技术上属于 Corrective Change，并走 `production-fix`，但仍然保留 Requirement 的工作量和 TFS Task 规则。**

> **三条自动 Route 统一使用 OpenSpec Change；Technical Change Kind=`corrective` 使用 `corrective-change`，`intentional` 使用 `intentional-change`。正常产品迭代走 sdd-fast，修复仍走 bug-fix / production-fix，不新增复杂度路由。**

> **Analysis Method 不等于同名 Markdown。Workitem Analyst 直接形成当前 Route 的 OpenSpec 技术契约、Structured Analysis Result 与必要 Evidence；Engineer 在独立 Run 消费批准后的当前版本，不维护第二套 Requirement / Design / Plan。**

> **每个自动 Delivery Issue 默认维护一个稳定 active OpenSpec Change；Schema 在创建时确定并跨 Run 读取，Human Reject / targeted rework 更新同一个 Change，不共享其他 Delivery 的归档权限。**

> **OpenSpec `tasks.md` 是 Implementation Checklist，不是 Development Sub-Issue 映射表，也不是 Multica Delivery Status。**

> **Workitem Analyst 提交审核并确认状态，Human 作出决定，Delivery Lead 理解自然语言意见并组织后续动作；Gate PASS、in_progress 或 Agent 自述都不能单独证明已经批准。**

> **Human APPROVED 后将 OpenSpec Change 提交到根仓记录开发基线；允许批准边界内细化设计与任务，实质改变已批准行为、范围或验收要求时重新审核；根仓 Commit 不创建独立 PR。**

> **`production-fix` 不区分 Normal / Hotfix；紧急程度交给人管理。**

> **优先级与排期不参与 Analysis Route 选择；当前不建立 Hotfix Policy，按 §6 执行。**

> **Workitem Analyst 负责需求与问题分析及研发准备，主动澄清目标、场景、规则、范围与验收要求；技术调查与必要方案服务于研发支撑。不替代人的业务决策，不等于不做业务需求分析。**

> **Repository Scope 不决定 Workflow Route；Corrective Change 即使跨多个 Repository，仍然是 `bug-fix` 或 `production-fix`。**

> **AC、Verification Requirements、Verify Agent Recommendation 都是不可删除的 Analysis Contract：AC 定义正确结果，Verification Requirements 定义证明要求，Recommendation 只决定是否建议增加独立验收者；推荐不等于已批准的 required 执行事实。**

> **跨仓不等于拆 Sub-Issue；Sub-Issue 只表达独立 Development Unit。**

> **PR 是业务 Repository 级交付对象；OpenSpec 根仓产物只按主方案 Git 规则记录，不进入 required PR 集合。**

> **一个 Delivery Issue 或 Development Sub-Issue 可以关联多个 Repository 和多个 PR。**

> **Development Unit 完成以 Engineering Contract 为准，不等待 PR 合并；业务 PR 与最终收口条件由父 Delivery 按总方案检查。**


---


<a id="analysis-acceptance"></a>

# 38. Analysis 与 OpenSpec 接入验收

以下分为**已完成的 OpenSpec 1.13.2 本地运行确认**与**后续 Multica / 真实业务集成验收**。已确认项可以作为当前 Schema 设计依据；未覆盖的真实调度、业务实现与异常恢复仍不得写成已部署事实：

| 场景 | 应满足的行为 |
|---|---|
| OpenSpec 安装版本 | `openspec --version` 确认为 `1.13.2`；版本不一致时不把本设计的 Schema / skip / Archive 假设当作已验证事实 |
| 项目级 Schema 来源 / Fork | `corrective-change` / `intentional-change` 均以项目级 Schema 为目标；1.13.2 已本地验证项目 Fork、`schema which`、Schema Validate 与项目优先解析可用 |
| `intentional-change` 严格 Apply 前置 | 本地验证 `apply.requires=[proposal,specs,design,tasks]` 后，缺 Design 时 Apply blocked，四项完整时 Planning Complete=true / Apply Ready |
| CLI 状态解释 | 本地验证 Apply instructions 在 blocked 时仍可能 exit 0；Gate 必须解析结构化 state / missingArtifacts，不能只看退出码 |
| `bug-fix` / `production-fix` 首次创建 Change | `.openspec.yaml` 持久化 `schema=corrective-change`；后续 Analyst / Engineer / Finalize 读取同一 Schema，不重新选择 |
| `sdd-fast` 首次创建 Change | `.openspec.yaml` 使用 `schema=intentional-change`；Specs / Design / Tasks 均按项目 Schema 必需契约执行 |
| `corrective-change` 无规格级变化 | Bug Analysis / Proposal / Tasks 完整，Specs 使用合法 `skip_specs`；status / validate / apply 前置与项目 Gate 结果一致，不要求独立 Design |
| `corrective-change` 需要补录既定行为场景 | 不使用 `skip_specs` 掩盖 Delta；生成合法 Specs，仍保持 Corrective Route，除非实际变成主动行为改变 |
| `corrective-change` Tasks 已存在但 Bug Analysis 缺失 | Schema Apply 前置或项目 Gate 不放行；不得仅凭 Tasks ready 开始正式研发 |
| `corrective-change` 复杂修复有附加 `design.md` | Handoff / Bug Analysis 显式引用，Engineer 可读取；不能假设非 Schema Artifact 自动进入 Apply 上下文 |
| `intentional-change` 缺 Design | 即使 Tasks 已存在也必须保持 Apply blocked；不得自行设置未支持的 `skip_design` 或以空 Design 绕过 |
| Schema 解析来源 | `openspec schema which` / 等价能力确认项目 `corrective-change` / `intentional-change` 来源唯一且与根仓版本一致，不被用户级同名 Schema 静默覆盖 |
| Archive：Corrective 无 Delta | Change 能正常归档且不修改主规格；归档位置、根仓 Commit 与 Issue 引用恢复可确认 |
| Archive：Corrective 有 Delta | 只将本次已批准 Delta 纳入主规格，再归档 Change；失败 / UNKNOWN 阻止最终收口 |
| 只给出“支持导出”等模糊目标，尚未明确必要业务场景、规则、范围与验收要求 | Workitem Analyst 调查并澄清；仅列出改哪些代码或任务不能算 Analysis 完成 |
| 关键业务取舍需要人工决定 | 提供事实、选项和建议，取得必要确认；不自行假设，也不将业务分析排除在职责之外 |
| 需求结论已明确，进入规格准备 | 复用同一组事实与决定，形成对应规格 / 设计 / 任务；不重新运行完整分析或维护第二份详细计划 |
| 局部算法、类 / 函数拆分等尚待实现时细化 | 不据此否定充分的 Analysis；Engineer 在批准边界内决定，行为或范围变化仍按既有审核处理 |
| 已有规格与代码不一致 | 区分约定与实现事实，记录证据，不静默覆盖 |
| `sdd-fast` 当前模块无规格 | 只建立本次相关认识与必要 Change 内容，不要求先补齐全仓规格 |
| `bug-fix` / `production-fix` 缺少必需 OpenSpec 环境或 Change（分别验证） | 保留已完成调查，报告缺口；不得通过 Analysis Gate 或自动降级为无 Change 交付 |
| 两类修复已有规格正确，或缺少必要 Expected Behavior / 根因证据 | 前者引用既有行为并准备轻量 Change；后者停止澄清，不因文档齐全放行 |
| 新建 / 修改 Capability | 遵循选用 Schema，保留已有路径与场景，无遗漏的行为—任务—验证对应 |
| 无行为规格变化的内部调整 | OpenSpec 技术上可 `skip_specs`，但当前 `sdd-fast` 语义不接纳此例外；若未来有真实场景，先确认 Technical Change Kind / Route，不放宽 `intentional-change` |
| Corrective 补录可证明的既定边界场景 | Delta 保留来源和原有约束，内部检查与人审覆盖本次补录；不因有 Delta 自动转 sdd-fast |
| `intentional-change` Design | 已本地验证为项目必需 Artifact；缺 Design 即使 Tasks 存在也保持 Apply blocked。Design 内容深度按复杂度伸缩，不使用空文档 / `skip_design` |
| 极小 Bug 只有少量修复 / 回归动作 | Proposal 简短、Tasks 最小充分，Bug Analysis 证据不降级；不新增 requirement-analysis / requirement-review |
| 简单单仓任务 Evidence 很少 | 不强制生成 `context-pack.md`；Evidence References 足够可追溯即可 |
| `sdd-fast` 完成需求分析 | 直接更新 Proposal / Specs / Design / Tasks 与 Structured Analysis Result；不要求固定 `requirement-analysis.md` |
| `requirement-review` APPROVED | 保存结构化 Review Result / Findings 与被审 Artifact 引用；不要求 `requirement-review.md` |
| Human Review 读取 Analysis Package | 读取逻辑集合中的 Change / Result / Evidence / Review Facts；不要求存在 `analysis-package.md` 或 `analysis-summary.md` |
| 分析与编码在不同 Agent / Run | 当前 Change、批准基线、Unit / Tasks 和证据可读，Engineer 不依赖 Workitem Analyst 会话或临时目录 |
| Change 归档后读取 Bug Analysis / 证据 | 内部相对引用与外部持久化引用有效；现有 Issue 当前路径已回填 |
| 同一 Delivery 分析退回两次 | 定向更新同一 Change，不重做全部分析或复制两套 Tasks |
| 任务小但行为、错误处理或性能承诺变化 | 仍表达相应规格，不按任务大小跳过 |
| 原生准备完成但 Human 未批准 | 停在既有 Analysis Review，不启动实施 |
| Gate PASS，Workitem Analyst 完成发布与状态写入 | 回读 analysis_review 后结束本轮分析，不仅为改状态新增 Lead Run |
| 发布 / 写入失败或结果未知，或旧提交在人工处理后重试 | 查询实际事实，只恢复当前适用的缺失动作，不重复通知或覆盖后续状态 |
| 退回意见以自然语言表达，无固定字段 | 由 Lead 理解并交接足够反馈，Workitem Analyst 定向返工后再次提交，不自行开始研发 |
| Human Reject 或实质规格修订 | 同一 Change 定向更新受影响产物，重新审核，不沿用失效 Evidence |
| 一个 Change 交给两个 Unit | Tasks 保留工程范围且可引用，不包含等待独立验收、PR 或归档；分工由 Delivery Lead 完成 |
| 安装版本与文档 / Schema 预期不一致 | 报告具体不兼容项，不伪造文件、状态或校验通过 |
| 任一自动 Route 缺少 Verify Recommendation / Reason / Verification Focus | Analysis Gate 按缺失项处理，不从 Route 填默认值 |
| Corrective 行为涉及跨系统复杂验收，或 SDD 行为已有可靠开发侧覆盖 | 都按实际 AC / Verification Requirements 给出推荐，不固定 required / not_required |
| 推荐为 not_required | 仍保留必要 Verification Requirements 与开发侧验收依据 |
| Summary 或产物更新漏掉最新推荐 | 提交前修正为同一轮结果，不能交接相互冲突的建议 |
| 人审退回 AC / Scope / Verification Requirements | 定向修订必要分析与推荐，适用时重做 Review 和 Gate，再提交，不沿用未经复核的推荐 |
| 分析阶段尝试写入 verify_agent.required 或 verification.result | 不作为本阶段输出；只交付 recommendation，最终执行事实与验收结果由主方案规定 |
| 检查器配置指向两份 validate-analysis.py | 只保留主方案 delivery-gate 的唯一实现，Analysis 维护专业检查契约 |

---

---

## 专业方法来源

Multica 公共机制与官方来源统一引用 [指导手册来源索引](multica-design-guideline-v1.9.md#official-source-index)；本节仅保留 OpenSpec 的专业方法来源，原有核对日期不表示本次完成本地运行验收。

[^a-openspec-schema]: OpenSpec 官方 [spec-driven Schema](https://github.com/Fission-AI/OpenSpec/blob/main/schemas/spec-driven/schema.yaml)，2026-09-30 核对公开文档；默认产物为 Proposal / Specs / Design / Tasks，Specs 支持 `skip_specs`，Design 为条件性省略。公开 `main` 不替代团队锁定的 1.13.2 运行验收。
[^a-openspec-1-13-2]: OpenSpec 官方 [v1.13.2 Release](https://github.com/Fission-AI/OpenSpec/releases/tag/v1.13.2)，版本发布于 2026-09-23，commit `db23097`。本方案将其作为团队实现基线；具体 Schema / CLI 行为仍以本地安装包验收记录为准。
[^a-openspec-custom-schema]: OpenSpec 官方 [Customization](https://github.com/Fission-AI/OpenSpec/blob/main/docs/customization.md)，支持项目级自定义 Schema、Artifact / Dependency 定义、`schema fork` / `schema init` 及 Change metadata / CLI / project config 的 Schema 解析优先级。
[^a-openspec-propose]: OpenSpec 官方 [Propose 公开方法模板](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/src/core/templates/workflows/propose.ts)，2026-09-30 检视公开 main，未锁定 commit。指令允许条件性省略，但不据此伪造机器 skipped 或省去安装版路径验收；Corrective 专用契约是本项目设计。

[^a-openspec-config]: OpenSpec 官方 [Customization](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/docs/customization.md)，2026-09-29 核对。项目配置提供上下文与规则，不是权限或硬条件的替代；本节职责划分与默认不 Fork 的选择属于本项目设计。

---

# v1.13 变更摘要

- Analysis Artifact Model 重构为 **OpenSpec Change + Structured Analysis Result + Supporting Evidence（按需）+ Review / Gate Facts**；`Analysis Package` 明确为逻辑集合，不创建同名 Markdown。
- 明确 **Analysis Method / Skill ≠ 同名 Artifact**：`requirement-analysis` 不再要求 `requirement-analysis.md`，`requirement-review` 不再要求 `requirement-review.md`，`analysis-completion` 不再生成 `analysis-package.md`。
- `context-pack.md` 从固定产物降为条件性 Supporting Evidence；Context Evidence 仍必须可追溯，简单任务直接保存 Evidence References。
- AC / Verification Requirements / Verify Recommendation 保持为核心 Analysis Contract：Corrective AC 归 `bug-analysis.md`，Intentional AC 归 Spec；Verification Requirements 与 Verify Recommendation 进入 Structured Analysis Result 并建立 AC 引用。
- Requirement Analysis 直接把 Why / Scope 写入 Proposal、Behavior / Rules / Scenarios / AC 写入 Specs、技术决策写入 Design、工程清单写入 Tasks；不维护第二份详细需求文档。
- Requirement Review 改为结构化 Review Result / Findings；Gate 检查真实 Result 与 Artifact，不检查已取消的固定 Markdown 文件名。
- Corrective 保留当前 `corrective-change` Schema 与轻量 Proposal；Intentional 保留 Proposal / Specs / Design / Tasks 全部 Required，Design 继续采用 Required Artifact / Conditional Depth。
- Summary 仅作为 `render(OpenSpec Change + Structured Analysis Result)` 的展示视图，不成为 Truth Source。
- Development Task Graph / `development_plan.units` / `role_requirement` 不属于 Workitem Analyst 输出；技术拆分只保留建议，实际 Unit / Owner 由 Delivery Lead 组织。
- 配套主方案 v1.4.14、Engineer v1.9、指导手册 v1.9；本次仅更新四份设计文档，不修改实现资产或 OpenSpec Schema。

---

# v1.12 变更摘要

- Schema 命名改为直接映射 Technical Change Kind：`corrective-change` / `intentional-change`；项目采用 kebab-case `<kind>-change` 风格，Route 与 Schema 不再同名绑定。
- `bug-fix` / `production-fix` → `change_kind=corrective` → `corrective-change`；`sdd-fast` → `change_kind=intentional` → `intentional-change`。Change 创建后持久化 Schema，跨 Agent / Run 读取现有事实。
- `corrective-change` 固化为 `bug-analysis → proposal → specs/skipped → tasks`，`apply.requires` 覆盖四项；合法 `skip_specs` 已在 OpenSpec 1.13.2 本地验证通过。
- `intentional-change` 从 1.13.2 `spec-driven` Fork，Design 改为项目必需 Artifact但深度按复杂度伸缩；`apply.requires=[proposal,specs,design,tasks]`，缺 Design 时必须 blocked。
- `sdd-fast` 代表 Intentional Behavior Change，Specs 为项目必需，不允许用 `skip_specs` 掩盖行为变化；未来无 Spec-level 的计划性工程调整另行判断，不放宽当前 Route。
- 明确 Schema Validate、Planning Complete、Apply Ready、Analysis Gate、Human Approval、Development Ready 六类状态分别判断；CLI exit 0 / Apply Ready 不构成项目准入。
- 现有 `sdd` Schema 保留已有 Change 兼容和 Full-SDD / `sdd-standard` 候选定位，不映射 `sdd-fast`，不迁移历史 `schema: sdd`。
- 配套升级主方案 v1.4.13、Engineer v1.8、指导手册 v1.8；Schema / CLI 行为已有本地运行证据，真实 Multica / 业务实现仍需集成验收。

---

# v1.11 变更摘要

- OpenSpec 实现基线锁定为 `1.13.2`；统一 Change Model 保留，正式采用按技术变更性质分型 Schema。
- `bug-fix` / `production-fix` 使用项目级 `corrective`；`sdd-fast` 使用原生 `spec-driven`；Schema 创建时持久化，跨 Run 复用。
- `corrective` 将 `bug-analysis.md` 登记为正式 Artifact，保留 Proposal / Specs / Tasks；Specs 无变化使用原生 `skip_specs`，独立 Design 不作为默认必需 Artifact。
- `analysis-routing.yaml` 增加 Route → Schema 映射；Schema 负责产物 / 依赖，Skill 负责专业方法，Gate 负责项目硬条件，避免三处复制依赖图。
- 补充跨 Schema `config.rules` 边界、附加 Design 的引用要求，以及 1.13.2 Schema / Status / Apply / Validate / Archive 验收清单。
- 完整保留 §2 TFS 管理背景和既有 Human Review / Verify / TFS Task / Route 语义；本次只更新设计，未部署自定义 Schema。

---

# v1.10 变更摘要

- bug-fix / production-fix 进入共享 spec-preparation 的 Corrective 轻量契约，不重做 requirement-analysis、不默认增加 requirement-review。
- §9 统一 Change Identity、产物深度、原生 skip / Design 省略边界；§26 明确 Bug Analysis、Proposal、Tasks、条件性 Design / Delta 的唯一内容归属与跨 Run 交接。
- §19 保留诊断闭环并补充同一专业执行内的一致性检查；§22、§28、路由配置与返工契约同步，不新增 Skill / Gate / Schema。
- 明确补录既定约束与主动改变行为的区别；缺少主规格不等于缺少工具环境，必需 Change / 原生能力缺口不得静默降级。
- 完整保留 §2 TFS 管理背景；同步主方案 v1.4.11、Engineer v1.6 与指导手册 v1.6。
- 本次只更新文档及验收要求，未生成或部署执行 Skill / Script；原生省略能力须由安装版本验收。

---

<a id="historical-changes"></a>

## 历史版本记录

以下 v1.10 及更早记录保留当时含义，旧文件名、旧规则与旧来源核对日期不作为 v1.11 的执行依据。当前规则见正文。

# v1.9 变更摘要

- 文件升级为 `workitem-analyst-stage-design-v1.9.md`，定位为 Workitem Analyst / Analysis 专业阶段；入口 Skill 和七个专业 Skill 名称保持不变。
- 完整保留 §2 的 TFS 管理背景，保留并对齐 §35–§37 的总结视图，历史 v1.8 / v1.7 / v1.6 / v1.5 摘要暂时保留。
- 补充角色配置、输入和启动契约；移除正文中的废弃 Skill / Route 设计理由，优先级规则收敛为当前约束。
- 主方案已完整覆盖的 Sub-Issue、PR、审核后开发与完成规则改为精确引用；人工决定归主方案，提交和定向返工细节仍由本阶段维护。
- 对齐主方案的 Verify Agent Recommendation，补入专业完成标准、两类 Package、Review、Summary、公共 Gate 和验收场景；不新增审批或 required 字段 Owner。
- Multica 机制与 URL 改为指导手册的具体条目引用；OpenSpec 专业来源继续在领域文档维护。
- 对齐唯一 Analysis Gate 实现位置，保留当前路线、审核职责、根仓 Git 与工程交付边界；仅更新设计文档，未部署 Skill / Script 或执行运行验收。

# v1.8 变更摘要

- 明确 `analysis-completion` 的执行者为 Workitem Analyst，负责发布、写入并回读 `analysis_review`；补充权限、失败恢复与等待边界，Gate 只返回检查结果。
- 人工审核采用自然语言，Lead 理解决定与条件并组织批准 / 返工；同步 Driver、交接和验收，不依赖固定口令、审批状态表或必经评论解析脚本。
- 将角色目标明确为需求与问题分析及研发准备，新增职责维度与专业完成标准，强调主动业务澄清及人工决策边界。
- 将目标、场景、规则、范围与验收要求落实到 Context、Requirement Analysis、OpenSpec 准备 / Review 和交付说明；不复制详细规格、设计或计划，保留 Engineer 实现空间及 Corrective 路由。
- Analysis Gate 先按 Route 分流；OpenSpec 原生准备、Validation 与 Requirement Review 只约束 `sdd-fast`，两类修复不依赖 OpenSpec 环境或产物，版本号保持不变。
- `context-analysis` 同时调查已有规格和实现事实；Analysis、Proposal、Spec、Design、Tasks 按内容职责分工，减少重复计划。
- 默认复用原生 Schema、模板、依赖与校验；补充项目配置 / Route / Skill / Gate 的归属及安装版本验收。
- 明确规格—任务—验证对应，Tasks 只包含工程实现与开发侧验证；当前 Unit 完成不等待整个 Change 或后续 PR / Archive。
- Review 检查语义覆盖，Gate 消费可确认的原生事实；规格 / 验收要求变化时重新判断旧证据。
- 清理 §30 的旧 PR Metadata 副本及“PR 合并后 Unit 才完成”规则，交付完成条件统一引用总方案。
- 保留现有 Route、Human Review、根仓提交规则；本次只更新设计文档，未生成执行 Skill 或修改已运行配置。

以下为历史版本记录，不作为当前执行规则。

# v1.7 变更摘要

- OpenSpec 定位调整为规格驱动开发方式，`spec-preparation` 形成能够驱动实现与验证的规格、设计和任务，不绑定原生命令。
- `requirement-review` 明确审查一致性、完整性、可实现性及可验证性；Gate 不以文件存在替代语义审查。
- Git Commit 记录已批准开发基线，不冻结全部产物；既有分析执行链、Change Identity、人审和根仓提交规则保持不变。

以下为历史版本记录，当前执行规则以正文为准。

# v1.6 变更摘要

相对 v1.5，本版本重点细化 `sdd-fast` 的 OpenSpec Analysis Contract：

- OpenSpec 正式定位为 `sdd-fast` 的 **Versioned Change Contract**，不承担 Multica Runtime、Assignment、Sub-Issue、Stage 或 Delivery Status。
- 一个 `sdd-fast` Delivery Issue 默认维护一个稳定 active OpenSpec Change；Human Reject / targeted rework 继续更新同一个 Change，不创建平行 Change。
- `spec-preparation` 正式定位为 **OpenSpec Preparation Method**，负责 Change 解析 / 创建、Artifact Depth、proposal / delta spec / design / tasks 更新与 Validation；具体 CLI / 命令留给后续 Skill。
- `requirement-review` 改为 Review 完整 OpenSpec Change，并保持 AI Review 与 Human Analysis Review 分离。
- `tasks.md` 明确为 Implementation Checklist，与 Multica Development Unit / Sub-Issue 解耦；一个 Change 可以被多个 Development Unit 消费。
- SDD-fast Analysis Gate 增加 OpenSpec Change identity、OpenSpec Validation 与 required artifact 检查。
- Human `APPROVED` 后将 Approved OpenSpec Change 提交根仓 Git，作为稳定 Development 输入；根仓 Commit 不创建独立 PR。
- OpenSpec Archive 明确属于总方案 Final Completion，本 Workitem Analyst 方案不维护 Archive Workflow。
- `spec-preparation` 目录不再自建 proposal / spec / tasks / design 模板副本，避免复制 OpenSpec 原生 Artifact Contract。

# v1.5 变更摘要

相对 v1.4：

- 引用 `multica-design-guideline-v1.4.md` 的 Canonical Terminology，不再独立维护公共命名；
- Analysis Review 正式 Status Key 统一为 `analysis_review`，Display Name=`Analysis Review`，category=`started`；
- Analysis Gate PASS 后统一写入 `Delivery Issue.status = analysis_review`；
- Human Approve / Reject 的等待与回流流程统一使用 `analysis_review` 作为机器状态值；
- Human 顶层 Comment 明确回流正式 Agent `Delivery Lead`，不再以 `Squad Leader` 作为第二名称；
- `Workitem Analyst` 保持为分析 Agent 的唯一正式名称；
- `bug-fix / production-fix / sdd-fast / sdd-standard`、`Development Unit`、`Repository Change`、`Development Sub-Issue` 等领域边界保持 v1.4 不变。
