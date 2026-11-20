# Workitem Analyst / Analysis 阶段设计方案

> Version: 1.9
> Date: 2026-09-29  
> Scope: Workitem Analyst 的角色与配置契约、Analysis 专业阶段的输入、需求与问题分析、路由、研发准备、OpenSpec Preparation、Review、Analysis Package、Verify 推荐、提交与停止边界  
> Status: Baseline

> 上位方案：`multica-squad-centric-delivery-v1.4.10.md`  
> 下游工程方案：`engineer-development-stage-design-v1.5.md`

> Terminology：本方案中的 Squad、Agent、Issue、Status、Route、Gate 等公共名称统一遵循 `multica-design-guideline-v1.5.md` 的 Canonical Terminology；本方案只维护 Analysis 领域术语。

---

<a id="analysis-stage-scope"></a>

# 1. 文档定位与目标

本文设计 **Workitem Analyst / Analysis 专业阶段**，不是单个 `SKILL.md`，也不是 Delivery Lead 的全局流程。

本文维护分析职责、输入、专业方法、产物与检查、提交审核和定向返工；人工审核决定的处理、研发组织、TFS Task 物化、PR 与最终交付由 [Delivery 主方案](multica-squad-centric-delivery-v1.4.10.md) 维护。统一术语、文档职责和 Multica 官方机制由 [指导手册](multica-design-guideline-v1.5.md#document-ownership) 维护。

本文“Analysis 阶段”指 Delivery 生命周期中的专业工作区段，不对应 Multica 原生 Stage；Stage 使用见主方案 §14，原生机制见 [指导手册：Parent / Child 与 Stage](multica-design-guideline-v1.5.md#mechanism-parent-stage)。入口 Skill 继续使用 `workitem-analysis`，七个 Skill 的名称及 Agent 正式名称不随文档改名变化。

## 阶段目标

Workitem Analyst 负责需求与问题分析及研发准备，澄清目标、业务场景、行为规则、范围和验收要求，结合现有系统形成必要方案，为后续研发与验证提供清晰、可审核、可执行的依据。

技术调查、规格与设计服务于需求和问题的澄清，不以“需求已经明确，只需分析改哪些代码”为前提。

当前方案重点解决：

- TFS `Bug` 与 `Requirement` 的管理语义不能混淆；
- `Requirement` 中存在“技术本质是 Bug”的上线后问题；
- 日常产品迭代、功能优化、行为变化统一进入 SDD / OpenSpec；
- `sdd-standard` 代表的大需求 / 全新复杂模块当前暂不自动处理；
- Analysis 结束前形成足以供人工审核和后续研发使用的 Development-Ready Package。

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

这是职责维度，不是新增阶段，也不要求四份独立文档。具体内容保存在现有 Analysis Package / OpenSpec 中，分工见 §21。

必须主动发现歧义、调查证据、提出澄清问题、比较选项并给出建议；需要人工决定的关键业务取舍交 Human 确认，不将假设或建议当成已经确认的需求。不替代人的业务决策，不等于不做业务需求分析。

不自行修改 TFS 管理类型、决定优先级或代替 Human Approval；不决定当前成员、最终 Sub-Issue / Stage 分工，也不替代 Engineer 完成生产代码与局部实现设计。`sdd-standard` 的自动处理边界保持 §10 的规定。

<a id="analysis-readiness"></a>

## 1.2 Analysis 完成标准

按当前任务与 Route 的适用范围确认：

- 需求 / 问题目标、相关使用者与业务场景清楚，现有行为与预期结果可区分；
- 必要业务规则、正常 / 异常 / 边界场景、需求或修复范围和验收要求明确，后续研发不必重新猜测需求；
- 必要方案或 Root Cause / Fix Strategy、影响范围、依赖与约束已分析，研发准备足以支撑实现；
- AC / Verification Requirements 可验证，能够对应目标行为；`sdd-fast` 的规格、设计和任务保持一致；
- 影响正确实现的关键未决问题已明确提出并取得必要结论；需要人工确认且尚未决定的事项不得用默认假设补齐后宣称完成。
- 已形成与当前 AC / Verification Requirements 对应的 Verify Agent Recommendation、Reason 与 Verification Focus，具体输出与判断边界见 §16。

分析清楚不等于编码前确定全部细节。局部算法、类 / 函数拆分、内部结构、测试组织等由 Engineer 在批准边界内细化；不为形式补齐与任务无关的规格或设计。

以上是专业准备标准：语义结论由对应分析方法形成，`sdd-fast` 经 `requirement-review` 审查；`analysis-completion` 汇集现有结果，Gate 只检查可确认事实。已有明确结论的方案可以提交 Human Review 等待正式批准，这与关键需求仍不清楚不同；准备完成或 AI Review 通过不等于获准编码，不新增另一套审批状态。

---

## 1.3 Agent 配置契约

Agent Description：

```text
负责 TFS 工作项的需求与问题分析及研发准备，形成可审核的 Analysis Package、验证要求和 Verify Agent Recommendation，并提交人工审核。
```

Agent Instructions 按指导手册五段式维护以下长期职责；各 Skill 的详细 Procedure 不复制进 Instructions。

| 部分 | 当前 Role Contract |
|---|---|
| Role | Delivery Squad 中的 Workitem Analyst，负责需求与问题分析及研发准备，不承担 Delivery 的整体运行协调。 |
| Core Responsibilities | 澄清目标、场景、规则、范围与验收；调查现有系统并形成必要方案或 Root Cause / Fix Strategy；按 Route 准备规格或修复依据，提出 Verify 推荐并交付 Analysis Package。 |
| Boundaries | 不修改 TFS 管理类型或决定优先级；不选择最终成员 / Sub-Issue / Stage 分工；不写生产代码、不自行批准研发或关闭 Delivery。 |
| Execution Principles | 从当前 Issue 与可追溯证据工作；区分事实、假设和人工决定；经 `workitem-analysis` 使用对应专业方法，复用有效结果并定向修订；不得覆盖明确 Gate FAIL。 |
| Escalation, Communication & Delivery | 关键需求、根因、权限或证据无法确认时说明缺口并交 Delivery Lead / Human；完成后按 `analysis-completion` 发布、写入并回读审核状态，结束本轮分析；返工依据原始反馈及明确范围。 |

Description 的展示边界、Instructions 的接收范围分别见 [指导手册：Description](multica-design-guideline-v1.5.md#mechanism-agent-description)、[Instructions](multica-design-guideline-v1.5.md#mechanism-agent-instructions)。本阶段规则须进入 Workitem Analyst 自身 Instructions / 绑定 Skill，不仅放在 Leader 可见的 Squad Instructions。

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
| 已有结果 | 当前 Analysis Package、Context、关联 OpenSpec Change 与已有反馈（如有），先判断可复用范围。 |
| 返工请求 | 原始人工评论 / Finding 引用、明确修正方向和受影响范围；按 §32 处理。 |

无法确认任务身份、必要来源或授权时停止并说明缺口；需求歧义进入正常澄清，不自行补成已确认事实。`bug-fix` / `production-fix` 不以 OpenSpec 环境存在为启动前提；`sdd-fast` 的准备能力按 §9、§22 验证。

首次启动与 Member 委派由主方案 §6 维护；Assignment、Mention 与成员实际接收上下文的机制分别见 [指导手册：Assignment](multica-design-guideline-v1.5.md#mechanism-assignment)、[Comment / Mention](multica-design-guideline-v1.5.md#mechanism-comments)。本节只检查本阶段收到的工作契约，不重建启动 Router。

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

# 9. SDD-fast 与 OpenSpec

本项目采用 OpenSpec 的规格驱动开发方式，当前在 `sdd-fast` 中落地。规格贯穿分析、设计、实现、验证与归档；Multica 负责 Agent 运行和协作。

Workitem Analyst 是承担需求与问题分析及研发准备的角色；OpenSpec 是其在 `sdd-fast` 中采用的规格驱动方法，并由 Engineer 在开发阶段继续贯彻。Workitem Analyst 基于需求目标、业务场景、规则和已有系统，形成本次 Proposal、Spec / Delta Spec、Design 和 Tasks，使需求、预期行为、方案、实施任务与验收要求相互对应。

| 分析与准备工作 | OpenSpec 中的表达 |
|---|---|
| 澄清为什么做、解决什么问题、本次目标和范围 | 探索与 Proposal |
| 明确业务规则、预期行为、正常 / 异常 / 边界场景 | Spec / Delta Spec（如 required） |
| 分析复用方式、关键技术方案、约束与取舍 | Design（按需） |
| 准备落实规格和开发侧验证的工程工作 | Tasks，关联规格 / AC |

规格不只描述技术接口，也表达业务规则和用户可观察行为。需求澄清、探索与规格准备是同一次分析工作的连续深化；不在 OpenSpec 之外先维护一套完整详细需求、设计和实施计划，再让 OpenSpec 重写。具体内容分工见 §21。

具体执行可以调用 OpenSpec 原生能力，也可以由项目 Skill 实现相应语义，不绑定特定命令。Assignment、Development Sub-Issue、Stage 和 Delivery Status 仍由既有 Multica 交付机制管理。

## 9.1 Change Identity

一个 `sdd-fast` Delivery Issue 默认只维护一个 active OpenSpec Change：

```yaml
openspec:
  change_id: <stable-change-id>
  path: openspec/changes/<stable-change-id>
```

规则：

- Change ID 在首次 Preparation 时确定，并在当前 Delivery 生命周期内保持稳定；
- Human Reject / targeted rework 继续修改同一个 active Change，不因为每轮 Review 新建 Change；
- 已存在 Change 时必须先读取并确认其与当前 Delivery Issue 的关联，不重复创建平行 Change；
- 无法唯一确认 Change 身份时返回 `UNKNOWN`，不得猜测或创建替代 Change；
- Change ID 的具体生成格式由后续 `spec-preparation` Skill / Config 定义，本设计只要求稳定、唯一、可追踪。

## 9.2 Artifact 深度

Artifact 深度由行为变化决定，而不是为了流程固定生成所有文件。

### New Capability

生成：

```text
proposal.md
spec / delta spec
tasks.md
design.md（按需）
```

### Modified Capability

已有 Capability 的正式行为发生变化，同样生成对应 Delta Spec：

```text
proposal.md
spec / delta spec
tasks.md
design.md（按需）
```

### 无 Spec-level Behavior Change

例如：

```text
性能优化
内部重构
实现替换
工程整理
但外部行为契约不变
```

仍然可以保留在 OpenSpec Change 中，但：

```text
skip_specs = true
```

不得为了流程伪造 Spec Requirement。`skip_specs` 只表示无规格级行为变化，不表示任务小或时间紧；新增性能承诺、改变错误处理、接口行为等仍须表达相关规格变化。

跳过标记使用当前 Change 的原生 `.openspec.yaml`（受安装版本支持时）；`spec_required` 只是本次准备结果的派生说明，不另设可与原生事实冲突的开关。无法通过原生状态 / 校验确认跳过条件时停止，先处理版本或配置差异，不伪造空规格。[^a-openspec-schema]

Design 按需处理跨模块、重要数据模型、安全、性能、迁移及关键技术决策。产物深度必须与选用 Schema 和安装版本可识别的依赖 / 跳过方式一致；不能仅将 `design_required=false` 就宣称原生前置条件已满足。原生状态仍要求产物而当前方法无法满足时，报告配置 / 版本问题，不生成无内容文件骗过检查。

## 9.3 Approval 与 Git 边界

OpenSpec 不维护第二套 Approval State。Workitem Analyst 交付同一 active Change 及 Analysis Package，提交后等待 Human Review，不自行批准或启动研发。

Human Approval 的含义、批准后根仓 Git Commit 及其不进入业务 required PR 集合的规则，统一见 [主方案：Human Analysis Review](multica-squad-centric-delivery-v1.4.10.md#human-analysis-review)；OpenSpec Archive 属于主方案 §22 的 Final Completion，不属于 Analysis。

Git 记录已批准的 Development 起始基线，不将所有文件冻结为只读；Engineer 在批准边界内细化 Design / Tasks，具体权限见 [Engineer 方案 §8.3](engineer-development-stage-design-v1.5.md#engineering-openspec-input)。实质改变已批准行为、范围、关键约束或验收要求时，返回既有审核；相关分析修订按 §32 执行。

---

<a id="openspec-configuration"></a>

## 9.4 原生能力、项目配置与规则归属

当前先采用原生 `spec-driven` Schema 和少量项目配置，不默认 Fork Schema、复制模板或建立通用 OpenSpec 编排层。只有确认原生结构无法表达实际产物要求时，才单独评审 Schema 定制。

| 位置 | 维护内容 | 不维护内容 |
|---|---|---|
| OpenSpec Schema / 模板 / 原生状态与校验 | 产物格式、依赖、生成指令与可机器检查的原生约束 | Multica Assignment、Human Approval、Delivery Status |
| `openspec/config.yaml` | 默认 Schema、简短项目上下文、每类产物的附加编写规则 | 当前任务分工、审批事实、交付状态机 |
| `analysis-routing.yaml` | 已知技术语义到 Route / Skill 的映射、项目审核和额外产物要求 | 原生产物依赖图、另一套 Spec 格式或 Delta 解析 |
| 现有 Skill | 如何读取输入、完成准备 / Review、产生 Evidence、停止或交接 | 模板副本、第二套运行状态 |
| Issue / Sub-Issue | 当前 Change、Scope、AC、任务范围与交接引用 | 整份 OpenSpec 内容副本 |
| 现有 Gate / Script | 身份、必需引用、状态与结果、授权和副作用检查 | 将语义正确性伪装为纯程序结论 |

配置中的规则是 Agent 执行上下文，不等于硬权限或 Gate；Human 批准前不得派发实施，执行入口仍须检查批准事实。OpenSpec 原生准备完成只表示产物前置条件满足，不表示获准编码。[^a-openspec-config]

`spec-preparation` 获取选用 Schema 的模板、指令和当前状态，按原生产物依赖形成 Proposal、Specs、Design、Tasks；不把这些依赖复制为 Multica Stage。具体命令可替换，产物格式、可读取性和校验要求不可绕过。

安装版本应确认 Schema、跳过规则、状态输出和 Validation 的实际能力；本设计不将公开文档或 `main` 当作本地已通过验收的事实。实现验证要求见 §38。

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

独立交付单元的判定与物化规则只引用 [主方案 §10](multica-squad-centric-delivery-v1.4.10.md#development-materialization)、[§11](multica-squad-centric-delivery-v1.4.10.md#simple-delivery)、[§12](multica-squad-centric-delivery-v1.4.10.md#complex-delivery)，本方案不维护第二份拓扑判定清单。

## 11.3 PR 边界

业务 Repository 是 PR 的硬边界，但 PR 数量不决定 Analysis Route。Workitem Analyst 交付需修改 / 验证的 Repository 范围，不在分析阶段创建 PR 或填写尚不存在的 PR ID。

逐仓 Branch / PR、PR Preparation、Materialization 与关联规则见 [主方案 §17](multica-squad-centric-delivery-v1.4.10.md#pr-materialization)；OpenSpec 根仓产物边界见主方案 §7.1。

## 11.4 交付对象术语

Delivery Issue、Development Unit、Repository Change 与 PR 的正式名称、对象含义和关系，统一引用 [指导手册：Delivery Object Canonical Names](multica-design-guideline-v1.5.md#delivery-object-terminology)。本阶段只生成分析与范围引用，不重新定义四层交付对象。

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
增加新场景
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

实际创建时点、执行者与物化行为见 [主方案 §10](multica-squad-centric-delivery-v1.4.10.md#development-materialization)。Workitem Analyst 保留并传递管理事实，不在 Analysis 内重复创建 Task 或建立另一套 TFS 管理流程。

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
| `spec-preparation` | SDD-fast 规格、设计与实施任务准备 |
| `requirement-review` | SDD-fast 规格与计划的一致性、完整性、可实现性及可验证性 Review |
| `analysis-completion` | Assemble / Gate / Publish；由 Workitem Analyst 写入并确认 `analysis_review`，结束本轮分析 |

---

<a id="verify-recommendation"></a>

# 16. Verify Agent Recommendation

Workitem Analyst 在本轮 Analysis 中提出是否需要独立 Verify Agent 的建议。该建议随完整 Analysis Package 一并提交 Human Review，不新增 Agent、Skill 或第二次审批。

推荐在专业分析中形成：两类修复由 `bug-analysis` 随 Verification Requirements 给出；`sdd-fast` 由 `requirement-analysis` 形成，`spec-preparation` 按实际规格与任务同步更新，必须在 `requirement-review` 开始前可读取。`analysis-completion` 只汇集已有推荐，不在收口时首次补做专业判断。

## 16.1 输出契约

```yaml
verify_agent:
  recommendation: required | not_required
  reason: ...
  verification_focus:
    - AC-...
    - ...
```

`recommendation` 是分析建议；`reason` 说明验收风险和可验证性依据；`verification_focus` 对应当前 AC / Verification Requirements 中的重点行为或场景。通过现有 Analysis Package、Summary 和引用表达，不要求另建推荐文档。

`verify_agent.required` 是 Human Analysis Review 通过后由 Development Materialization 从已批准推荐生成的执行事实，不由 Workitem Analyst 预先写成最终决定；`verification.result` 属于后续验收事实。批准、转换及执行边界见 [主方案 §16.1](multica-squad-centric-delivery-v1.4.10.md#verify-agent-decision) 与 [§26](multica-squad-centric-delivery-v1.4.10.md#delivery-facts)。

## 16.2 推荐方法

根据当前 Acceptance Criteria、Verification Requirements、技术范围与约束、跨系统行为和可验证性判断，不以最终 Roster、Sub-Issue 数量或分工已经确定为前提。

| 当前验收依据 | 推荐方向 |
|---|---|
| 范围小、行为单一，有可靠 Regression / Runtime Feedback，Engineer 的 Local Validation + Code Review 能闭合必要验收目标 | 可推荐 `not_required`，说明依据与覆盖重点。 |
| 多个关键 AC、多个技术修改共同构成最终行为、跨系统 Contract / Event / Schema、复杂状态流，或需要独立 Runtime / Integration / E2E 验收 | 可推荐 `required`，说明重点场景及原因。 |

这些是专业判断依据，不是 Route 默认值。`bug-fix`、`production-fix`、`sdd-fast` 均可能推荐任一结果；不因修复路线默认取消独立验收，也不因采用 OpenSpec 默认要求独立验收。

`not_required` 只表示不增加独立验收者，不取消必要验证。无法可靠判断时明确问题并澄清，不随意填默认值；关键结论未明确时不得宣称 Analysis 已充分。

## 16.3 检查与修订

推荐与本轮目标、范围和验收要求保持一致；需求、Fix Scope 或 Verification Requirements 发生实质变化时同步修订推荐。语义充分性由专业分析 / Review 处理，Analysis Gate 只检查字段、取值、必要引用和已有结果，不凭字段存在证明推荐正确。

最终 Summary 显式打印 Recommendation、Reason、Verification Focus，格式见 §25.3。Human 批准后需要改变验证安排时，按主方案既有审核流程处理，不由 Analyst 或 Engineer 自行降低标准。

---

# 17. `context-analysis`

`context-analysis` 提供跨阶段的需求 / 问题与工程上下文，调查相关业务场景、已有规则、系统能力和实现事实，支撑后续分析，不替代 `requirement-analysis` / `bug-analysis` 的结论。

主要产物：

```text
context-pack.md
```

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

Context Pack 应区分：

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

不能把代码现状自动视为正确规格，也不能把规格存在视为已经实现。不一致记录在 Context Pack 中并附来源；影响本次方案或正确性判断时交相应分析 / Human 确认，不静默覆盖任一来源。

只补足本次修改相关的规格认识，不以全量补齐 Monorepo 规格库作为前置条件。`sdd-fast` 尚无主规格时，标明已确认的既有行为及证据，必要基线在当前 Change 中准备，不提前将尚未交付的变化写入主规格。

`bug-fix` / `production-fix` 可以引用已有规格作为 Expected Behavior 依据，不因此自动新建 Change、准备 OpenSpec 产物或改变 Route。不存在相关规格、`openspec/` 目录或 OpenSpec CLI 时，继续依据已确认需求、人工说明、代码 / 测试与运行证据分析；代码现状仍不能单独证明预期行为正确。若 Expected Behavior 或必要根因证据无法确认，按原有 Corrective Contract 停止并澄清，不因缺少 OpenSpec 本身阻塞，也不因此放宽分析要求。


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

---

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

这里的 Repository 数量不改变 `bug-fix` / `production-fix` Route。根据本轮回归与验证要求，同步按 §16 形成 Verify 推荐、理由和重点，供 Package 与人审使用。

---

# 19. Corrective 分析验证

`bug-analysis` 本身已经具备：

```text
Hypothesis
→ Evidence
→ Verification
→ Conclusion
```

因此：

```text
bug-fix
production-fix
```

当前都不增加 `requirement-review`。

质量控制采用：

```text
bug-analysis internal verification
+
analysis-completion deterministic gate
+
Human Analysis Review
```

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

`requirement-analysis` 只处理 Intentional Change，先明确需要解决的问题、业务目标和正确结果，再结合现有系统分析必要方案；不以确定修改文件清单代替需求分析。

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

它输出需求理解、澄清结论和必要方案依据，与后续规格准备连续衔接，不决定最终 Multica 分工。探索可复用 OpenSpec 原生方法或由本 Skill 实现；不为同一问题重复运行两套完整分析，也不要求全部实现细节先定稿才能准备规格。准备阶段发现业务规则缺口、场景遗漏或方案冲突时，定向回查受影响事实 / 决策，并更新相应结论。

已确认事实、待验证假设、方案建议与需要 Human 决定的事项必须区分。影响正确实现的业务歧义不能留给 Engineer 自行猜测；属于局部实现选择的事项不人为升级为需求决策。

AC / Verification Requirements 明确后按 §16 形成 Verify 推荐；后续规格准备改变相关范围或验证依据时同步更新，交 `requirement-review` 使用。

产物分工：

| 产物 | 主要内容 |
|---|---|
| `context-pack.md` | 需求 / 问题相关背景、已有业务规则与规格、代码事实、调查证据及引用 |
| `requirement-analysis.md` | 目标与业务场景、需求理解、规则与范围的澄清结论、判断依据、影响与未决问题、AC / 验证要求或其权威引用 |
| `proposal.md` | 变更动机、目标、范围与涉及的 Capability，保留必要需求摘要 |
| `specs/<capability>/spec.md` | 本次新增 / 修改的业务规则、行为要求及正常 / 异常 / 边界场景；已有 Capability 沿用原生路径 |
| `design.md` | 满足规格的关键技术选择、约束与必要理由 |
| `tasks.md` | 工程实现与开发侧验证任务，内容范围见 §23 |

允许必要摘要和澄清依据，但详细行为规格统一维护在 Spec / Delta Spec，详细技术设计在 Design（如需要），工程任务在 Tasks。Analysis 保留形成结论的上下文并引用这些内容，不独立维护第二份详细规格、设计或实施计划；修改结论时同步受影响的权威产物，避免副本漂移。AC 与规格场景通过引用对应，不要求复制完整内容。

它不处理：

```text
Corrective Root Cause
Agent Assignment
Development Sub-Issue / Stage
```

---

<a id="spec-preparation"></a>

# 22. Spec Preparation

`spec-preparation` 将已澄清的目标、业务场景、规则和范围深化为能够驱动研发与验证的规格、必要设计和实施任务，不只是将分析结果转换为 OpenSpec 文件。它与 `requirement-analysis` 共用同一组事实和决定；发现缺口时定向补充，不重复开展完整分析。

正式职责：

```text
读取已确认需求结论、业务场景与规则、Context Pack 和相关已有规格
→ 解析或确认 active Change、选用 Schema 与项目配置
→ 获取原生模板 / 指令 / 当前产物状态，确认依赖与 Artifact Depth
→ 形成 proposal：意图、目标、范围及涉及的 Capability
→ 形成 spec / delta spec：业务规则、预期行为、正常 / 异常 / 边界场景及与已有规格的变化（如 required）
→ 形成 design：关键技术选择、约束和必要理由（如 required）
→ 形成 tasks：工程实现与开发侧验证任务
→ 对照规格场景、设计、Tasks、AC / Verification Requirements 检查遗漏
→ 按当前规格、任务及验证要求同步 §16 的 Verify 推荐
→ 执行原生准备状态检查与 Validation
→ 输出现有 Change Reference / Preparation Result，交 requirement-review
```

### 22.1 输入

至少消费：

```text
Delivery Issue identity
Analysis Route = sdd-fast
context-pack.md
requirement-analysis.md（目标、业务场景、规则、需求范围与已确认决定）
相关已有规格 / Capability（如有）
Selected Solution
Development Scope / Repository Scope
Acceptance Criteria
Verification Requirements
已有 openspec.change_id（如已创建）
```

### 22.2 输出

至少输出：

```yaml
openspec:
  change_id: ...
  path: ...
  spec_required: true | false       # 从当前变更及原生跳过事实派生
  design_required: true | false     # 与技术需要和选用 Schema 的实际要求一致
  validation: PASS | FAIL | UNKNOWN
```

并形成对应 OpenSpec Artifact，满足以下交付要求：

- 需求目标、业务规则、预期行为与相关正常 / 异常 / 边界场景明确，规格准确表达本次范围内的行为变化；
- Design / Tasks 与规格及 AC 对应，能够指导实现；
- Verification Requirements 能验证相关规格场景和验收要求，区分开发侧验证与需要独立验收的场景；
- 原生准备状态、必需产物及跳过事实相互一致，Validation 结果可读取。

无 Spec-level 行为变化时，按 §9.2 处理，不伪造新规格；设计与任务仍须对应已有行为及本次验收要求。

### 22.3 规格—任务—验证对应关系

每个本次必须实现的 Requirement / Scenario 应能找到相关实现任务和验证方式；每组 Tasks 应能回到规格 / AC 或批准的工程目标。对应关系直接使用现有路径、标题、任务编号和 AC 引用。

以下仅为内容对应示例，不代表实际业务需求：

| 规格场景 | 工程任务引用 | 验证要求 |
|---|---|---|
| 无导出权限用户直接请求接口被拒绝 | Tasks 1.2：权限校验及拒绝测试 | 后端接口测试确认拒绝且不泄露数据 |
| 导出结果符合当前筛选条件 | Tasks 1.1：筛选导出；2.1：传递筛选参数 | 开发侧验证筛选语义；按已批准要求补组合行为验收 |

Spec 描述业务规则、用户可观察行为、输入输出、错误 / 边界条件和外部约束；类名、函数拆分、实现步骤属于 Design / Tasks。原生语法、Delta 操作和校验由 Schema / 工具维护，本 Skill 不复制解析逻辑。

能够实现 Tasks 不等于已经获得开发权限；Preparation 结束后继续 AI Review、Analysis Gate 和 Human Review。

### 22.4 边界

`spec-preparation` 不负责：

```text
选择当前 Squad 成员
创建 Development Sub-Issue
生成 Stage
决定 Assignment / @mention
执行代码实现
执行 OpenSpec Archive
```

后续 `spec-preparation/SKILL.md` 定义具体步骤和 Change ID 格式；可以调用 OpenSpec 原生能力，也可以实现相应准备语义，产物遵循选用的 OpenSpec 格式与校验要求。本设计不绑定具体命令。

---

<a id="openspec-tasks"></a>

# 23. OpenSpec Tasks 与 Multica Development Unit

必须保持：

```text
OpenSpec tasks.md
≠
Multica Development Sub-Issue
```

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

`requirement-review` 只服务 `sdd-fast`，对需求分析与完整 OpenSpec Change 做独立只读 Review：先确认需求与问题是否清楚，再检查规格与必要方案 / 任务是否一致、完整、可实现、可验证；不以技术方案可编码或文件齐全代替需求质量审查。

读取：

```text
context-pack.md
requirement-analysis.md
OpenSpec Change Reference
proposal.md
spec / delta spec（如有）
tasks.md
design.md（如有）
Acceptance Criteria
Verification Requirements
Verify Agent Recommendation（§16）
Evidence
```

Review 至少检查：

```text
需求目标、相关使用者 / 业务场景及期望结果清楚
业务规则、正常 / 异常 / 边界场景、In-Scope / Out-of-Scope 与 AC 足以指导实现
关键业务歧义和需人工决定的事项未被假设掩盖
Requirement / Proposal 的意图与范围一致
Spec / Delta Spec 准确表达业务规则与从已有规格到 Expected Behavior 的变化
规格场景覆盖本次行为变化及相关 Acceptance Criteria
Design / Tasks 与规格对应，足以指导实现与验证
Design 解决 required 技术决策（如 required），方案与任务可实现
无 Scope Drift / 未决关键决策
规格场景、AC 与 Verification Requirements 对应且可验证
每项必须实现的行为有工程任务与验证方式承接，无遗漏
Tasks 不包含等待审批、独立验收、PR 合并或归档等运行步骤
原生准备状态 / Validation 与 required / skip 事实一致
Verify 推荐的理由与 Verification Focus 对应当前 AC / Verification Requirements，不以字段齐全替代语义审查
```

输出：

```yaml
verdict: APPROVED | NEEDS_REVISION

issues:
  - id:
    severity:
    area:
    description:
    evidence:
    suggestion:
```

最多建议：

```text
2 rounds
```

`NEEDS_REVISION` 只对 Finding 命中的 Requirement Analysis / OpenSpec Artifact 及其受影响的关联内容做 targeted rework，继续使用同一个 active OpenSpec Change，不新建平行 Change。判断准备完整性不以已知 Roster、最终 Owner 或 Sub-Issue 分工为前提。

`requirement-review APPROVED` 只表示 AI Review 通过；最终仍必须进入 Human Analysis Review。

---

<a id="analysis-completion"></a>

# 25. Analysis Completion

`analysis-completion` 由 **Workitem Analyst** 执行，负责整理分析、调用 Gate、发布结果并提交 Human Review；完成写入与回读后结束本轮分析，不仅为状态写入另行唤醒 Delivery Lead。

## 25.1 输入与有限权限

读取当前 Delivery Issue、Route、§1.2 的专业准备结果、当前 Analysis Package、§16 的 Verify 推荐和关联 Evidence；核对本次分析任务、Issue 身份、当前处理阶段及写入权限。发现专业缺口交回对应分析方法，不在组装步骤重做完整需求分析。

Workitem Analyst 只可在当前授权分析任务的提交环节写入 `analysis_review`，保持 `assignee = Delivery Squad`。不得自行批准、把提交审核当作研发授权，或将父 Delivery 置为 `done`。Issue 属于 Squad 不等于只有 Leader 能执行这项明确授权的写入。

## 25.2 执行步骤

```text
整理当前 Route 的 Analysis Package，确认必需引用可读取
→ 调用现有 Analysis Gate（§28）
→ PASS 后发布 / 更新 Analysis Package、Summary 与 Gate 结果
→ 确认人能够读取本轮分析及检查结果
→ 通过 Multica CLI / API 写入 Delivery Issue.status = analysis_review
→ 回读确认 Issue 状态、Squad Ownership 及发布引用
→ 输出已提交审核的事实，结束本轮分析，等待 Human Review
```

Gate 只返回 `PASS / FAIL / UNKNOWN`，不修改 Issue 状态。只有发布和状态后置条件均确认后，才能报告“已提交人工审核”；不能以 Gate PASS、命令退出成功或 Run 成功代替。

原生状态与运行边界见 [指导手册：Assignment 与启动](multica-design-guideline-v1.5.md#mechanism-assignment)、[Issue / Run](multica-design-guideline-v1.5.md#mechanism-issue-run)。状态更新使用安装版本已确认的请求级暂不启动能力，按总方案 §10.1 执行；不额外调用 Run / Rerun 或 Mention 以触发后续工作。发布结果或正常回流即使唤醒 Delivery Lead，也不构成人工批准；Lead 按总方案 §9 保持等待。状态写入不是全局锁，也不会自动停止其他正在运行的 Agent。

<a id="analysis-summary"></a>

## 25.3 输出与结束边界

最终 Summary 至少显式打印本轮专业结论与推荐：

```text
Requirement / Problem Goal and Scenarios: ...
Expected Behavior / Rules / Scope / AC: ...
Selected Solution / Fix Strategy / Development Scope: ...
Constraints / Open Decisions: ...
Technical Decomposition Suggestion: ...（确有拆分建议时）
Verify Agent Recommendation: REQUIRED | NOT REQUIRED
Reason: ...
Verification Focus: ...
```

Summary 使用面向人的 `REQUIRED / NOT REQUIRED` 展示，结构化推荐使用 §16 的 `required / not_required`；不是新增状态值。

现有 Result / Artifact 同时说明：当前 Issue、Route、Analysis Package / Gate 结果引用、实际回读状态，以及已完成或尚未完成的发布 / 写入动作。正常终点是“分析提交成功，等待人工”，不是“已批准研发”或“Delivery 完成”。不增加审批状态表、快照或固定审核文本协议。

`STOP` 在这个环节仅表示结束本轮自动分析；不会关闭 Delivery，也不将正常等待改为 `blocked`。人工审核后的自然语言理解、状态离开和返工派发由 Delivery Lead 负责，见总方案 §9。

## 25.4 失败与恢复

| 当前事实 | 处理 |
|---|---|
| Gate FAIL | 按明确缺失项定向完善，不发布为待审成功，不写入 `analysis_review` |
| Gate UNKNOWN、身份 / 必需输入 / 权限无法确认 | 停止提交，说明缺口并交 Delivery Lead / Human；不伪造 PASS |
| 产物发布失败，或状态写入失败 / 结果未知 | 保留已确认结果，先回读当前产物和状态再补缺失项；不得声称已进入审核 |
| 同一本轮分析已发布且处于 `analysis_review` | 确认引用后复用，不重复通知、创建附件或切换状态 |
| 重试旧提交时，人工已处理该轮或流程已进入后续返工 / 研发 / 结束 | 不重放旧提交，不覆盖后续状态；当前新委派的返工完成后仍可按 §25 提交新修订 |

当前 Run 有界结束，不驻留轮询人工决定。部分成功的恢复使用现有 Issue、Artifact / Comment 和 Run 记录；正常审核等待不因本方法返回而自动激活研发，真实权限或环境阻塞按既有规则处理。

---

<a id="corrective-package"></a>

# 26. Bug Analysis Package

适用于 `bug-fix` 与 `production-fix`：

```text
Analysis Package
├── context-pack.md
├── bug-analysis.md（问题场景、Expected vs Actual 及依据）
├── Root Cause / Root Cause Evidence
├── Fix Strategy / Fix Scope
├── Development Scope / Repository Scope
├── 技术依赖与约束（如有）
├── Regression Scope
├── Acceptance Criteria / Verification Requirements
├── Verify Agent Recommendation / Reason / Verification Focus
└── Risks / Open Decisions
```

以上是内容集合，不要求每一项独立成文件。已在 `bug-analysis.md` 或其他权威产物中表达的内容使用必要引用；Verify 推荐按 §16，最终 Summary 按 §25.3。不要求 OpenSpec 产物或 `requirement-review`。

---

<a id="sdd-analysis-package"></a>

# 27. SDD-fast Analysis Package

```text
Analysis Package
├── context-pack.md
├── requirement-analysis.md（目标、场景、规则、范围与澄清依据）
├── OpenSpec Change Reference
│   ├── change_id
│   └── path
├── proposal.md
├── spec / delta spec（按需）
├── tasks.md
├── design.md（按需）
├── requirement-review.md
├── Development Scope / Repository Scope
├── Acceptance Criteria / Verification Requirements
├── Verify Agent Recommendation / Reason / Verification Focus
└── Risks / Open Decisions
```

Verify 推荐使用 §16 的同一契约，并在 §25.3 的 Summary 中显式展示；不新增独立审批或推荐文件。

OpenSpec Artifact 是后续规格驱动实现与验证的依据，作为 Analysis Package 的组成部分统一审核。Multica Issue / Artifact 只保存必要引用与 Review / Delivery 事实，不复制整套 OpenSpec 内容。

---

<a id="analysis-gate"></a>

# 28. Analysis Gate

Analysis Gate 只检查并返回结果，不发布产物或修改 Issue 状态；PASS 后由 Workitem Analyst 按 §25 提交并回读确认。Gate 先确认 Route，再选择对应检查契约。公共部分只核对任务身份、当前 Route 的必需输入 / 产物和可确认结果；不得将 OpenSpec CLI、目录、配置或 Change 状态作为所有 Route 的共同前置条件。当前 Route 或其必需事实无法可靠确认时返回 `UNKNOWN`，明确缺失必需条件时按既有规则处理。

## 28.1 公共检查

所有当前自动处理 Route 均检查：

```text
Delivery Issue / TFS identity 与 Route 可对应
Context Pack 和当前 Route 的必需产物 / 引用可读取
Repository Scope 存在
Acceptance Criteria / Verification Requirements 满足当前 Route 的要求
verify_agent.recommendation 存在，取值为 required 或 not_required
verify_agent.reason 与 verification_focus 存在，必要引用可读取
无 unresolved blocker
```

字段明确缺失或取值不合法，按缺失项返回 `FAIL`；必要身份、引用或结果无法可靠确认时返回 `UNKNOWN`。Gate 不重新判断推荐理由是否正确，不以 Route 默认值补字段，也不在人工批准前要求或生成 `verify_agent.required`。该执行事实由主方案 §10、§16.1、§26 定义。

## 28.2 Bug / Production Fix

仅按 `bug-analysis` / Corrective Contract 检查，不执行 OpenSpec 原生准备状态、OpenSpec Validation 或 `requirement-review` 检查，也不要求 Proposal、Delta Spec、Design 或 `tasks.md`。引用已有规格不改变此范围；不得仅因缺少这些 OpenSpec 输入返回 `FAIL` / `UNKNOWN`。

至少检查：

```text
Root Cause Status 存在
Fix Strategy 存在
Fix Scope 存在
Repository Scope 存在
Verification Requirements 存在
无 unresolved blocker
```

## 28.3 SDD-fast

仅本 Route 检查 OpenSpec 原生准备状态、Validation 和 `requirement-review` 结果。需求是否清楚以及规格与计划的一致性、完整性、可实现性、可验证性由 `requirement-review` 审查，不能以文件存在或 Validation PASS 替代。原生产物依赖与跳过判断使用工具结果，不在 Gate 或 Route Config 中维护第二份依赖图；必需原生状态无法确认时返回 `UNKNOWN`，不得伪造 PASS。

至少检查：

```text
Requirement Analysis 存在
OpenSpec Change identity 与相关原生配置可唯一读取
原生产物准备状态满足选用 Schema 的必需依赖
proposal.md / tasks.md 可读取
spec-required 时相关 spec / delta spec 可读取，否则原生跳过事实有效
design-required 时 design 可读取，省略时不与原生依赖状态冲突
OpenSpec Validation PASS，结果可确认
requirement-review APPROVED
Acceptance Criteria 存在
Verification Requirements 存在
无 unresolved blocker
```

统一：

```yaml
result: PASS | FAIL | UNKNOWN
reasons:
  - ...
```

---

<a id="analysis-human-review-interface"></a>

# 29. Human Analysis Review 接口

所有自动 Analysis 均在 §25 的发布、状态写入和回读成功后进入人工审核。正式状态 Key 为 `analysis_review`，正常等待不改为 `blocked`；Key / Display Name 定义见指导手册 §1.2.3。

Human 决定是否批准；Delivery Lead 理解自然语言意见、核对条件并组织后续动作。完整审核、批准 / 退回、状态离开与恢复规则只引用 [主方案 §9](multica-squad-centric-delivery-v1.4.10.md#human-analysis-review)。Workitem Analyst 不自行处理“是否已获准研发”的判断，不以 AI Review APPROVED、Analysis Gate PASS 或 `in_progress` 代替 Human 授权。

本阶段的后续接口：收到明确分析返工请求时，消费原始意见引用、修正方向和受影响范围，按 §32 定向修订并重新提交；仅局部分工变化由 Delivery Lead 处理，不重做专业分析。

Comment / Reply 的原生路由见 [指导手册：Comment、Mention 与回流](multica-design-guideline-v1.5.md#mechanism-comments)。不能因评论被触发、回复到某个线程或出现批准关键词，推断已经取得有效人工决定。

---

# 30. 下游交付边界

本阶段的正式输出是可审核的 Analysis Package 及提交事实。跨阶段推进由主方案维护，本节只保留交接所需边界和权威引用。

## 30.1 TFS 与 Development 交接

Workitem Analyst 传递原始 TFS Type、Route、需求 / 问题结论、Development / Repository Scope、技术依赖与约束、必要方案 / Fix Strategy、AC / Verification Requirements 及 Verify 推荐；`sdd-fast` 同时传递 Change、规格与 Tasks 引用。

Human 批准后的 TFS Task、成员选择、Unit / Sub-Issue 及 Stage 分工由 [主方案 §10–§14](multica-squad-centric-delivery-v1.4.10.md#development-materialization) 定义。四层交付对象见指导手册 §1.2.2，本阶段不再次维护拓扑判定表。

## 30.2 PR 引用与事实归属

Workitem Analyst 交付 Repository Scope、必要接口约束和验收要求，不创建 PR，不填写尚不存在的 PR ID，也不以 PR 完成作为分析或工程任务的前置条件。

PR Preparation、Materialization、`current_pr` / `pr_history`、外部终态与恢复统一引用 [主方案 §17](multica-squad-centric-delivery-v1.4.10.md#pr-materialization)、[§18](multica-squad-centric-delivery-v1.4.10.md#pr-status-sync)、[§26](multica-squad-centric-delivery-v1.4.10.md#delivery-facts)。

## 30.3 Development 与 Delivery 完成

Development Unit 完成 Engineering Contract 后，由父 Delivery 继续必要 Verify、业务 PR 与 Finalize；Workitem Analyst 不聚合这些下游完成条件，也不关闭 Delivery。

Unit 完成以 [主方案 §11–§12](multica-squad-centric-delivery-v1.4.10.md#simple-delivery)、§15 为准；Delivery 完成以 [主方案 §21–§22](multica-squad-centric-delivery-v1.4.10.md#delivery-completion) 为准。Engineer 的详细输入与完成方法见 [Engineer 阶段方案](engineer-development-stage-design-v1.5.md#engineering-input)。

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

`analysis-routing.yaml` 是 Analysis Route 的唯一配置源，下面是待实现配置的设计示例，不表示已部署。它承接当前项目路由与审核要求，不独立修改主方案的人工授权规则，负责定义：

```text
合法 Route
TFS Type 约束
Change Kind 约束
Analysis Skill
Preparation Skill
AI Review 要求
Human Analysis Review 要求
项目额外 Required Artifacts
```

示例：

```yaml
version: 1

routes:
  bug-fix:
    source:
      tfs_type: Bug

    analysis:
      skill: bug-analysis

    ai_review:
      required: false

    human_review:
      required: true

    required_artifacts:
      - context-pack
      - bug-analysis

  production-fix:
    source:
      tfs_type: Requirement

    semantic:
      change_kind: corrective

    analysis:
      skill: bug-analysis

    ai_review:
      required: false

    human_review:
      required: true

    required_artifacts:
      - context-pack
      - bug-analysis

  sdd-fast:
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

    required_artifacts:
      - context-pack
      - requirement-analysis
      - requirement-review

fallback:
  unsupported_scope:
    action: stop
    target: human
```

`sdd-fast` 的原生产物格式、依赖和跳过规则通过 `spec-preparation` / 原生 Schema 状态检查，不在本配置重新枚举 Proposal / Specs / Design / Tasks 的依赖。表中的 `required_artifacts` 只声明项目额外产物；公共 Verify 推荐属于现有 Analysis Package 的字段，不为此新增 Artifact 或 Rule 副本，由 §16、§28 检查。删除重复声明不表示取消 OpenSpec 准备要求。配置归属见 §9.4。

配置文件只定义：

> **一个已知语义对应哪个 Route，以及该 Route 要执行什么。**

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
   bug-fix / production-fix → bug-analysis（形成 Verify 推荐）
   sdd-fast → requirement-analysis → spec-preparation（同步 Verify 推荐）→ requirement-review
   超出自动处理边界 → sdd-standard / STOP / Human
→ 汇集当前 Analysis Package 与已形成、适用时已复核的 Verify Agent Recommendation
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
| Proposal、Spec、Design、Tasks / OpenSpec Change（sdd-fast） | `spec-preparation`，更新同一 active Change |
| 技术依赖 / 约束、Verification Requirements、Verify 推荐 | 当前 Route 的相关分析部分；推荐按 §16 同步修订 |

只修正命中内容和必要关联产物；规格、Tasks、AC / Verification Requirements 或推荐受影响时一并对齐。`sdd-fast` 的变更通过适用的 `requirement-review` 复核后，再执行 `analysis-completion` 和当前 Route 的 Analysis Gate，发布修订并回读确认 `analysis_review`，结束本轮返工。

返工授权只允许修订分析，不允许开始编码；`in_progress` 不能单独证明获准研发。Human 意见理解、状态离开与返工派发由主方案 §9 维护，本节不复制这套跨角色流程。

---

# 33. Analysis 与 Development 边界

| 工作 | 负责位置 / 终点 |
|---|---|
| 需求与问题理解、场景 / 规则 / 范围 / 验收澄清、Context、必要方案及按 Route 的研发准备 | Workitem Analyst；按 §1.2 形成可审核、能支撑研发与验证的 Analysis Package |
| Analysis Gate | 只校验当前 Route 的可确认条件并返回结果，不写状态 |
| Verify Agent Recommendation | Workitem Analyst 按 §16 形成推荐、理由与验收重点；Human 批准后的执行事实由主方案维护 |
| 发布与提交 Human Review | Workitem Analyst / `analysis-completion`：发布、写入并确认 `analysis_review`，结束本轮分析 |
| 人工决定与意见处理 | Human 决定；Delivery Lead / `delivery-flow` 理解自然语言意见并落实，不以原生准备完成或 Agent 自述替代批准 |
| TFS Task、必要 Sub-Issue 及协作安排 | Human 批准后的 Delivery Lead / 必要确定性物化，见总方案 |
| Branch、规格或 Fix Strategy 驱动实现、Local Validation、Code Review、Commit / Push、PR Preparation、Evidence | 当前 Engineer 的 Engineering Contract |
| 按需独立 Verify、业务 PR、Archive、TFS 关闭 | 父 Delivery 的交付流程，见总方案 |

Analysis 让研发不必猜测需求，不要求预先确定全部局部实现细节，也不指定最终运行分工。`sdd-fast` 使用 OpenSpec 形成并持续维护规格 / 设计 / 任务；Engineer 在批准边界内细化实现，不再重新设计需求或复制一套计划。Engineer 不把整个 Delivery 的完成条件塞入 `tasks.md`；规格、任务、实现和证据通过现有引用衔接，不新增第二套状态。

---

# 34. 推荐目录

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
│       └── context-pack.md
│
├── requirement-analysis/
│   └── SKILL.md
│
├── bug-analysis/
│   └── SKILL.md
│
├── spec-preparation/
│   ├── SKILL.md
│   └── references/
│       └── openspec-integration-contract.md   # 按需
│
├── requirement-review/
│   ├── SKILL.md
│   └── references/
│       └── review-schema.md
│
└── analysis-completion/
    ├── SKILL.md
    └── templates/
        └── analysis-package.md
```

---

Analysis Gate 的检查契约由 §28 维护；确定性实现唯一复用主方案 §25 的 `delivery-gate/scripts/validate-analysis.py`。`analysis-completion` 调用该检查，不在自身目录维护第二份同名校验实现；这不新增第八个 Analysis 专业 Skill。

---

<a id="analysis-execution-model"></a>

# 35. 最终执行模型

本图汇集的 Verify 推荐在专业分析中形成，并在 `sdd-fast` 的 `requirement-review` 前准备完整，不增加独立 Stage。入口接主方案 §6，终点接主方案 §9；完整交付模型以 [主方案 §29](multica-squad-centric-delivery-v1.4.10.md#delivery-execution-model) 为准。

```text
                           TFS Work Item
                               │
                        workitem-analysis
                               │
                        context-analysis
                               │
              ┌────────────────┴────────────────┐
              │                                 │
          TFS Bug                         TFS Requirement
              │                                 │
              ▼                                 ▼
        bug-analysis                      Change Intent?
              │                          ┌───────┴────────┐
              │                          │                │
              │                     Corrective       Intentional
              │                          │                │
              │                          ▼                ▼
              │                    bug-analysis    requirement-analysis
              │                          │                │
              │                          │         spec-preparation
              │                          │                │
              │                          │       requirement-review
              │                          │                │
              └──────────────┬───────────┴────────────────┘
                             ▼
                     Analysis Package
                 + Verify Agent Recommendation
                             │
                     analysis-completion
                             │
                       Analysis Gate
                             │
                             ▼
            Workitem Analyst 发布 / 写入 / 回读
                    analysis_review
                    (Analysis Review)
                             │
                   Human Analysis Review
                             │
                             ▼
                       Delivery Lead
```

对应 Route：

```text
TFS Bug
→ bug-fix

TFS Requirement + Corrective
→ production-fix

TFS Requirement + Intentional Change
→ sdd-fast

Large / New Major Module
→ sdd-standard / Human
```

---

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
| `requirement-analysis` | 只服务 Intentional Change |
| OpenSpec | 项目采用的规格驱动开发方式，当前在 `sdd-fast` 落地；不绑定特定命令 |
| OpenSpec Change Identity | 一个 `sdd-fast` Delivery Issue 默认维护一个稳定 active Change；Rework 复用同一 Change |
| New / Modified Capability | 都可生成 Spec / Delta Spec |
| 无 Spec-level 行为变化 | OpenSpec `skip_specs`，不伪造 Spec Requirement |
| Requirement Review | 审查规格与计划的一致性、完整性、可实现性和可验证性；AI APPROVED 不替代 Human Review |
| TFS Task | 只看原始 `tfs.type` |
| Workitem Analyst | 需求与问题分析及研发准备；不替代 Human 决策，不修改 TFS 管理类型或承担最终成员分工 |
| Analysis 完成标准 | §1.2：需求与问题清楚、必要研发依据充分；不要求预先冻结全部实现细节 |
| Analysis Review Status | Status Key=`analysis_review`；Display Name=`Analysis Review`；category=`started` |
| 提交审核责任 | Workitem Analyst / `analysis-completion` 发布、写入并回读确认状态；不自行批准或启动研发 |
| Review Decision | Human 自然语言评论为来源；Delivery Lead 理解决定和条件，不维护 `analysis.review_status` 或强制格式协议 |
| Verify 推荐 | 所有自动 Route 都输出 Recommendation / Reason / Verification Focus；方法见 §16，不按 Route 预设默认值 |
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

以下为本阶段规则摘要；跨角色与最终完成原则引用 [主方案 §30](multica-squad-centric-delivery-v1.4.10.md#delivery-principles)，不独立重定义。

> **TFS 怎么登记、技术上是什么、走什么开发方法，是三个不同的问题。**

> **Bug 类型的管理规则由 TFS Type 决定，不由 Agent 重分类。**

> **Requirement 可以在技术上属于 Corrective Change，并走 `production-fix`，但仍然保留 Requirement 的工作量和 TFS Task 规则。**

> **正常产品迭代统一走 `sdd-fast` / OpenSpec。**

> **Workitem Analyst 在 `sdd-fast` 中使用 OpenSpec 开展规格驱动分析与准备，Engineer 继续按规格实施；需求澄清与规格准备连续深化，详细规格、设计和任务不在 OpenSpec 外重复维护。Multica 负责运行与协作。**

> **一个 `sdd-fast` Delivery Issue 默认维护一个稳定 active OpenSpec Change；Human Reject / targeted rework 更新同一个 Change。**

> **OpenSpec `tasks.md` 是 Implementation Checklist，不是 Development Sub-Issue 映射表，也不是 Multica Delivery Status。**

> **Workitem Analyst 提交审核并确认状态，Human 作出决定，Delivery Lead 理解自然语言意见并组织后续动作；Gate PASS、in_progress 或 Agent 自述都不能单独证明已经批准。**

> **Human APPROVED 后将 OpenSpec Change 提交到根仓记录开发基线；允许批准边界内细化设计与任务，实质改变已批准行为、范围或验收要求时重新审核；根仓 Commit 不创建独立 PR。**

> **`production-fix` 不区分 Normal / Hotfix；紧急程度交给人管理。**

> **优先级与排期不参与 Analysis Route 选择；当前不建立 Hotfix Policy，按 §6 执行。**

> **Workitem Analyst 负责需求与问题分析及研发准备，主动澄清目标、场景、规则、范围与验收要求；技术调查与必要方案服务于研发支撑。不替代人的业务决策，不等于不做业务需求分析。**

> **Repository Scope 不决定 Workflow Route；Corrective Change 即使跨多个 Repository，仍然是 `bug-fix` 或 `production-fix`。**

> **Verify Agent Recommendation 由 Workitem Analyst 形成并提交人审；推荐不等于已批准的 required 执行事实，不需要独立 Verify Agent 也不等于免除验证。**

> **跨仓不等于拆 Sub-Issue；Sub-Issue 只表达独立 Development Unit。**

> **PR 是业务 Repository 级交付对象；OpenSpec 根仓产物只按主方案 Git 规则记录，不进入 required PR 集合。**

> **一个 Delivery Issue 或 Development Sub-Issue 可以关联多个 Repository 和多个 PR。**

> **Development Unit 完成以 Engineering Contract 为准，不等待 PR 合并；业务 PR 与最终收口条件由父 Delivery 按总方案检查。**


---


<a id="analysis-acceptance"></a>

# 38. Analysis 与 OpenSpec 接入验收

以下为后续 Skill / Script 的验收要求，本次文档更新未执行运行测试：

| 场景 | 应满足的行为 |
|---|---|
| 只给出“支持导出”等模糊目标，尚未明确必要业务场景、规则、范围与验收要求 | Workitem Analyst 调查并澄清；仅列出改哪些代码或任务不能算 Analysis 完成 |
| 关键业务取舍需要人工决定 | 提供事实、选项和建议，取得必要确认；不自行假设，也不将业务分析排除在职责之外 |
| 需求结论已明确，进入规格准备 | 复用同一组事实与决定，形成对应规格 / 设计 / 任务；不重新运行完整分析或维护第二份详细计划 |
| 局部算法、类 / 函数拆分等尚待实现时细化 | 不据此否定充分的 Analysis；Engineer 在批准边界内决定，行为或范围变化仍按既有审核处理 |
| 已有规格与代码不一致 | 区分约定与实现事实，记录证据，不静默覆盖 |
| `sdd-fast` 当前模块无规格 | 只建立本次相关认识与必要 Change 内容，不要求先补齐全仓规格 |
| `bug-fix` / `production-fix` 无 OpenSpec CLI、目录、配置和 Change（分别验证） | 按 Corrective Contract 分析和执行 Gate，满足原有要求即可进入 Human Review；不要求创建 OpenSpec 产物或伪造原生 PASS |
| 两类修复引用已有规格，或缺少必要 Expected Behavior / 根因证据 | 有规格则与实现事实对照，不触发 Change；必要事实不明仍按原有分析要求停止澄清 |
| 新建 / 修改 Capability | 遵循选用 Schema，保留已有路径与场景，无遗漏的行为—任务—验证对应 |
| 无行为变化的内部调整 | 原生跳过事实与 Validation 一致；本地布尔值不能绕过工具依赖 |
| 任务小但行为、错误处理或性能承诺变化 | 仍表达相应规格，不按任务大小跳过 |
| 原生准备完成但 Human 未批准 | 停在既有 Analysis Review，不启动实施 |
| Gate PASS，Workitem Analyst 完成发布与状态写入 | 回读 analysis_review 后结束本轮分析，不仅为改状态新增 Lead Run |
| 发布 / 写入失败或结果未知，或旧提交在人工处理后重试 | 查询实际事实，只恢复当前适用的缺失动作，不重复通知或覆盖后续状态 |
| 退回意见以自然语言表达，无固定字段 | 由 Lead 理解并交接足够反馈，Analyst 定向返工后再次提交，不自行开始研发 |
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

Multica 公共机制与官方来源统一引用 [指导手册来源索引](multica-design-guideline-v1.5.md#official-source-index)；本节仅保留 OpenSpec 的专业方法来源，原有核对日期不表示本次完成本地运行验收。

[^a-openspec-schema]: OpenSpec 官方 [spec-driven Schema](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/schemas/spec-driven/schema.yaml)，2026-09-29 核对。原生模板 / 指令、依赖和 `.openspec.yaml` 跳过事实以团队安装版本为准；本项目不复制其完整内容。
[^a-openspec-config]: OpenSpec 官方 [Customization](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/docs/customization.md)，2026-09-29 核对。项目配置提供上下文与规则，不是权限或硬条件的替代；本节职责划分与默认不 Fork 的选择属于本项目设计。

---

# v1.9 变更摘要

- 文件升级为 `workitem-analyst-stage-design-v1.9.md`，定位为 Workitem Analyst / Analysis 专业阶段；入口 Skill 和七个专业 Skill 名称保持不变。
- 完整保留 §2 的 TFS 管理背景，保留并对齐 §35–§37 的总结视图，历史 v1.8 / v1.7 / v1.6 / v1.5 摘要暂时保留。
- 补充角色配置、输入和启动契约；移除正文中的废弃 Skill / Route 设计理由，优先级规则收敛为当前约束。
- 主方案已完整覆盖的 Sub-Issue、PR、审核后开发与完成规则改为精确引用；人工决定归主方案，提交和定向返工细节仍由本阶段维护。
- 对齐主方案的 Verify Agent Recommendation，补入专业完成标准、两类 Package、Review、Summary、公共 Gate 和验收场景；不新增审批或 required 字段 Owner。
- Multica 机制与 URL 改为指导手册的具体条目引用；OpenSpec 专业来源继续在领域文档维护。
- 对齐唯一 Analysis Gate 实现位置，保留当前路线、审核职责、根仓 Git 与工程交付边界；仅更新设计文档，未部署 Skill / Script 或执行运行验收。

<a id="historical-changes"></a>

## 历史版本记录

以下 v1.8 及更早摘要保留原版本内容；其中旧术语、旧文件名及章节引用仅表达当时的变更，不作为 v1.9 的执行或引用依据。

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
