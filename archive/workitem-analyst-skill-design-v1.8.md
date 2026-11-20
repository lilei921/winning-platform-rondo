# Workitem Analyst Skill 设计方案

> Version: 1.8
> Date: 2026-09-29  
> Scope: Multica Delivery Squad 中 Workitem Analyst 的需求与问题分析、研发准备、分析路由、上下文构建、Bug / Production Fix / SDD-fast 分流、OpenSpec Preparation、Review 与 Analysis Contract  
> Status: Baseline

> 上位方案：`multica-squad-centric-delivery-v1.4.9.md`  
> 下游工程方案：`engineer-development-stage-design-v1.4.md`

> Terminology：本方案中的 Squad、Agent、Issue、Status、Route、Gate 等公共名称统一遵循 `multica-design-guideline-v1.4.md` 的 Canonical Terminology；本方案只维护 Analysis 领域术语。

---

# 1. 目标

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

## 1.2 Analysis 完成标准

按当前任务与 Route 的适用范围确认：

- 需求 / 问题目标、相关使用者与业务场景清楚，现有行为与预期结果可区分；
- 必要业务规则、正常 / 异常 / 边界场景、需求或修复范围和验收要求明确，后续研发不必重新猜测需求；
- 必要方案或 Root Cause / Fix Strategy、影响范围、依赖与约束已分析，研发准备足以支撑实现；
- AC / Verification Requirements 可验证，能够对应目标行为；`sdd-fast` 的规格、设计和任务保持一致；
- 影响正确实现的关键未决问题已明确提出并取得必要结论；需要人工确认且尚未决定的事项不得用默认假设补齐后宣称完成。

分析清楚不等于编码前确定全部细节。局部算法、类 / 函数拆分、内部结构、测试组织等由 Engineer 在批准边界内细化；不为形式补齐与任务无关的规格或设计。

以上是专业准备标准：语义结论由对应分析方法形成，`sdd-fast` 经 `requirement-review` 审查；`analysis-completion` 汇集现有结果，Gate 只检查可确认事实。已有明确结论的方案可以提交 Human Review 等待正式批准，这与关键需求仍不清楚不同；准备完成或 AI Review 通过不等于获准编码，不新增另一套审批状态。

---

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

# 6. `production-fix` 不区分 Normal / Hotfix Policy

当前方案明确：

> **`production-fix` 不再区分 Normal / Hotfix Policy。**

原因：

1. 紧急程度不改变问题的技术性质；
2. 紧急和不紧急的 Production Fix 使用相同 Root Cause / Fix / Verification 方法；
3. 紧急程度主要影响人的排期、优先级和发布时间；
4. 研发人员比 Agent 更适合判断“什么时候优先安排”；
5. 如果没有真正不同的流程、Gate、权限或交付规则，就没有必要引入新的 Workflow / Policy 概念。

因此：

```text
Production Fix
= 工作性质

紧急程度
= 人工优先级 / 排期属性
```

不进入 Workitem Analyst Route。

如果未来公司真的定义了独立 Hotfix 制度，例如：

```text
特殊分支
特殊审批
缩短 Gate
特殊 Release Window
独立发布权限
```

届时再将 `hotfix` 建模成独立 Delivery Policy。

当前没有这种需求，因此不建模。

---

# 7. 为什么不使用 `fast-track`

原 `fast-track` 容易同时表达：

```text
小改动
快速开发
线上问题
紧急修复
简单需求
```

语义过宽。

当前一级模型直接使用：

```text
production-fix
```

目的不是强调“快”，而是明确：

> **这是上线后已有行为的修复。**

`fast-track` 不属于当前正式模型，不建立别名、兼容 ID 或迁移规则。

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

OpenSpec 不维护第二套 Approval State。

Human Analysis Review 的 `APPROVED` 同时表示接受当前 Analysis Package 中的需求目标、业务规则、范围、必要方案与验收要求，以及 OpenSpec Change 对这些结论的表达，不把全部文件冻结为只读。Engineer 可在批准边界内细化设计与实施任务；实质改变已批准行为、范围、关键技术约束或验收要求时，返回既有审核流程。具体更新权限见 `engineer-development-stage-design-v1.4.md` §8.3。

Human Approval 通过后：

```text
Approved OpenSpec Change
→ root repository Git Commit
→ 记录已批准的 Development 起始基线
```

该根仓 Commit：

```text
不是业务 Repository Change
不进入 required PR 集合
不创建独立 PR
```

OpenSpec Archive 属于 Delivery Final Completion，不属于 Workitem Analyst Analysis 职责；总方案负责定义其收口边界。

---

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

# 11.1 Route 与 Repository Scope 必须解耦

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

# 11.2 跨仓不等于拆 Development Sub-Issue

Repository Scope 与 Development Unit 是两个不同概念。

```text
Repository Scope
= 哪些代码仓需要修改 / 验证

Development Unit
= 哪些工作需要独立 Owner、独立推进、独立验证和独立完成
```

因此：

```text
多个 Repository
≠
多个 Development Sub-Issue
```

例如一个 Production Fix 同时修改：

```text
Backend Repository
+
Common Repository
```

如果：

```text
同一 Owner
强耦合修改
统一实现
统一验证
统一完成
```

则仍然可以作为一个 Development Unit，在当前 Delivery Issue 内完成，而不创建 Sub-Issue。

只有存在多个真正可以独立推进的 Development Unit 时，才创建 Development Sub-Issue。

判断重点：

```text
是否可以独立分配 Owner
是否可以独立开始 / 完成
是否可以独立 Verify
是否可以独立处理失败 / 重试
是否可以独立等待外部依赖
是否具有独立交付生命周期
```

Repository 数量和 PR 数量本身不构成拆分条件。

---

# 11.3 Repository 是 PR 的硬边界

虽然跨 Repository 不一定拆 Sub-Issue，但 PR 是 Repository 级对象。

正式规则：

> **PR Boundary = Repository Boundary.**

因此：

```text
每个发生代码变更并需要交付的 Repository
→ 独立 Branch
→ 独立 PR
```

不允许：

```text
Repository A + Repository B
→ 一个 PR
```

所以一个 Delivery Issue 或一个 Development Sub-Issue 都可以关联：

```text
多个 Repository
+
多个 Branch
+
多个 PR
```

例如：

```text
Delivery Issue
├── Repository A
│   └── Branch A
│       └── PR-A
└── Repository B
    └── Branch B
        └── PR-B
```

此场景仍然可以：

```text
0 个 Development Sub-Issue
```

只要这些 Repository Change 属于同一个 Development Unit。

---

# 11.4 四层交付对象边界

后续统一区分：

| 对象 | 回答的问题 |
|---|---|
| Delivery Issue | 这个 TFS Work Item 的完整交付是什么 |
| Development Unit | 哪些工作需要独立 Owner / 生命周期 |
| Repository Change | 哪些 Repository 需要代码变更 |
| PR | 某个 Repository 的代码变更如何交付 |

关系：

```text
Delivery Issue
    │
    ├── Development Unit 1
    │       │
    │       ├── Repository A
    │       │       └── PR-A
    │       │
    │       └── Repository B
    │               └── PR-B
    │
    └── Development Unit 2
            │
            └── Repository C
                    └── PR-C
```

Simple Delivery 可以视为：

```text
Delivery Issue
=
一个隐式 Development Unit
```

因此不需要为了形式创建 Child Issue。


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

# 14. TFS Task 创建规则

TFS Task 是否创建只能依据公司管理类型。

确定性规则：

```text
tfs.type == Bug
→ 禁止创建 TFS Task

tfs.type == Requirement
→ 按 Requirement 规则创建 TFS Task
```

因此：

```text
Requirement + Corrective
→ production-fix
→ 仍然按照 Requirement 规则创建 TFS Task
```

不能因为它技术上是 Bug，就套用 Bug 的 TFS 管理规则。

---

# 15. Workitem Analyst Skill 集合

当前推荐收敛为 7 个 Skill：

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

# 16. 为什么删除 `implementation-planning`

原方案使用：

```text
implementation-planning
```

主要服务旧 `fast-track`。

当 `fast-track` 收敛为 `production-fix` 后，该 Skill 不再有独立存在的必要。

原因：

```text
bug-analysis
```

已经可以输出：

```text
Root Cause
Fix Strategy
Fix Scope
Repository Scope
Regression Scope
Verification Requirements
```

这些信息足以作为 Production Fix 的编码前准备。

因此避免再增加：

```text
bug-analysis
→ implementation-planning
```

重复层。

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

这里的 Repository 数量不改变 `bug-fix` / `production-fix` Route。

---

# 19. Bug / Production Fix 不执行 Requirement Reviewer

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
        ↓ Human 自然语言明确批准，Delivery Lead 理解并核对
根仓 Commit Approved OpenSpec Change（sdd-fast）
```

这里的 OpenSpec Preparation / Review 属于规格驱动开发的分析与准备，不新增 Multica Workflow Stage。`requirement-analysis → spec-preparation → requirement-review` 执行链保持不变。

---

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
→ 执行原生准备状态检查与 Validation
→ 输出现有 Change Reference / Preparation Result，交 requirement-review
```

`spec-preparation` 合并原有：

```text
sdd-spec-propose
+
sdd-spec-preparation
```

不再按旧 Workflow Stage 拆成多个顶层 Skill。

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

Multica Development Sub-Issue 表达：

```text
独立 Owner
独立推进
独立验证边界
独立失败 / 重试
独立完成
```

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

# 25. Analysis Completion

`analysis-completion` 由 **Workitem Analyst** 执行，负责整理分析、调用 Gate、发布结果并提交 Human Review。它是当前分析 Run 的收口方法，不是另一个 Agent；不需要仅为状态写入再唤醒 Delivery Lead。

## 25.1 输入与有限权限

读取当前 Delivery Issue、Route、§1.2 的专业准备结果、当前 Analysis Package 和关联 Evidence；核对本次分析任务、Issue 身份、当前处理阶段及写入权限。发现专业缺口交回对应分析方法，不在组装步骤重做完整需求分析。

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

状态更新使用安装版本已确认的请求级暂不启动能力，按总方案 §10.1 执行；不额外调用 Run / Rerun 或 Mention 以触发后续工作。发布结果或正常回流即使唤醒 Delivery Lead，也不构成人工批准；Lead 按总方案 §9 保持等待。状态写入不是全局锁，也不会自动停止其他正在运行的 Agent。

## 25.3 输出与结束边界

现有 Result / Artifact 至少说明：当前 Issue、Route、Analysis Package / Gate 结果引用、实际回读状态，以及已完成或尚未完成的发布 / 写入动作。正常终点是“分析提交成功，等待人工”，不是“已批准研发”或“Delivery 完成”。不增加审批状态表、快照或固定审核文本协议。

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

# 26. Bug Analysis Package

```text
Analysis Package
├── context-pack.md
├── bug-analysis.md（问题场景、Expected vs Actual 及依据）
├── Root Cause
├── Fix Strategy
├── Fix Scope
├── Repository Scope
├── Regression Scope
└── Verification Requirements
```

适用于：

```text
bug-fix
production-fix
```

---

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
├── Acceptance Criteria
└── Verification Requirements
```

OpenSpec Artifact 是后续规格驱动实现与验证的依据，作为 Analysis Package 的组成部分统一审核。Multica Issue / Artifact 只保存必要引用与 Review / Delivery 事实，不复制整套 OpenSpec 内容。

---

# 28. Deterministic Analysis Gate

Analysis Gate 只检查并返回结果，不发布产物或修改 Issue 状态；PASS 后由 Workitem Analyst 按 §25 提交并回读确认。Gate 先确认 Route，再选择对应检查契约。公共部分只核对任务身份、当前 Route 的必需输入 / 产物和可确认结果；不得将 OpenSpec CLI、目录、配置或 Change 状态作为所有 Route 的共同前置条件。当前 Route 或其必需事实无法可靠确认时返回 `UNKNOWN`，明确缺失必需条件时按既有规则处理。

## Bug / Production Fix

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

## SDD-fast

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

# 29. Human Analysis Review

所有自动 Analysis 最终进入 Human Analysis Review。

原因：

```text
bug-fix / production-fix
→ 人确认问题场景、既定 Expected Behavior、Root Cause / Fix Scope 及回归要求可以支撑研发

sdd-fast
→ 人确认需求目标、业务规则、范围、必要方案与验收要求，并审核相互一致的 Requirement Analysis + OpenSpec Change
```

Analysis Gate PASS 后，由 Workitem Analyst 在 `analysis-completion` 中完成：

```text
发布本轮 Analysis Package 与 Gate 结果
→ 写入 Delivery Issue.status = analysis_review
→ 回读确认并结束本轮分析，等待 Human Review
```

详细提交与恢复仅按 §25 执行。Human 作出审核决定，Delivery Lead 通过现有 `delivery-flow` 理解自然语言意见并组织后续动作；`APPROVED / REJECTED` 只是决定含义，不是要求人填写的协议字段。具体意见处理和硬条件边界以总方案 §9 为准。

其中正式 Status Key 为 `analysis_review`，Display Name 为 `Analysis Review`：

```text
key          = analysis_review
display_name = Analysis Review
category     = started
```

用于在 Board / List 中形成独立审核列。

不再维护：

```text
analysis.review_status = waiting | approved | rejected
```

第二套状态。

## 29.1 Human Approve

Human 可以自然表达：“当前方案可以，按这个范围开始开发。”Delivery Lead 读取本次评论、相关上下文与 Analysis Package，理解是否明确允许研发及其条件；无需人额外提交固定格式或 JSON。

```text
Human 明确批准当前分析
→ Delivery Lead 理解决定、范围与条件，保留原始评论引用
→ 核对来源权限、当前任务与有效 Analysis Gate PASS
→ sdd-fast：提交已批准 OpenSpec 开发基线并确认（不创建 PR）
→ Delivery Lead 写入 in_progress 并回读确认
→ 组织后续 Development
```

只认可方向、要求补充后再审、普通问题或决定冲突，都不能当作研发授权。Lead 不以自己的质量判断代替 Human 决定，也不以结构化解释替代人工来源。两类修复不执行 OpenSpec 提交；各 Route 的硬条件仍须满足。

根仓 Commit 记录当前已批准的开发基线，不把 OpenSpec Change 冻结为只读。后续设计和任务按 §9.3 的权限边界更新并由 Git 跟踪，不创建独立 PR，也不改变 Multica Delivery Status 的事实来源。

涉及已批准行为、关键技术决定、Scope 或验收要求的实质变化时，更新全部受影响的规格、设计、任务与 AC / Verification Requirements，再返回既有 Review。只补局部设计 / 测试细节不重跑完整 Analysis；代码未变但验收目标已变时，旧 Evidence 仍须按总方案 §16.7 判断有效性，不新增审批快照或 hash 绑定。

## 29.2 Human Reject

Human 可以自然表达：“根因还不成立，先补充缓存失效的证据，再交我审核。”Delivery Lead 理解反馈并保留原文引用及足以执行的修正方向；不要求 `REJECTED / Reason / Expected Change` 标签。关键方向不清楚时先询问，不编造理由或默认重做全部 Analysis。

```text
Human 明确要求修改 / 退回分析
→ Delivery Lead 读取本次反馈与当前执行事实
→ 准备原始评论引用、修正要求及受影响范围
→ 写入 in_progress 并回读确认，不额外启动 Run
→ 在当前 Delivery Issue @Workitem Analyst 一次
→ Workitem Analyst Targeted Rework
```

退回分析与批准研发都可能进入 `in_progress`，必须以当前人审意见和交接内容区分；本分支不授权编码。普通讨论和意图不明的处理按总方案 §9.3，不由 Workitem Analyst 自行解释为获得批准。

Workitem Analyst 只修改受影响部分：

```text
context
→ context-analysis

problem_scenario / expected_behavior / root_cause / fix_scope（Corrective）
→ bug-analysis

requirement / goal / business_scenarios / rules / scope / AC / solution / impact（sdd-fast）
→ requirement-analysis

proposal / spec / tasks / design / OpenSpec Change（仅 sdd-fast）
→ spec-preparation
→ targeted update same active Change
```

重新完成：

```text
Workitem Analyst 执行 analysis-completion
→ 当前 Route 的 Analysis Gate PASS
→ 发布修订结果，写入并确认 analysis_review
→ 结束本轮返工，等待人工
```

再次等待人工审核。

不新增：

```text
rejected
reworking
resubmitted
```

等 Issue Status。

---

# 30. Human Analysis Review 后的 TFS / Development 处理

Human Analysis Review APPROVED 后由 Delivery Lead 根据：

```text
tfs.type
Development Scope
Repository Scope
Role
Dependencies
```

执行后续动作。

其中 TFS Task 创建规则：

```text
Bug
→ 不创建

Requirement
→ 创建
```

因此：

```text
production-fix
```

虽然使用 `bug-analysis`，仍然按照 Requirement 的 TFS 管理规则处理。

---


# 30.1 Human Analysis Review 后的 Development Topology

Human Analysis Review APPROVED 后，Delivery Lead 根据：

```text
Development Scope
Repository Scope
Owner / Role
Dependencies
Verification Boundary
```

判断 Development Topology。

规则：

```text
跨仓
≠
必须拆 Development Sub-Issue
```

只有存在多个独立 Development Unit 时才创建 Sub-Issue。

但无论是否拆 Sub-Issue：

```text
每个 required Repository Change
→ 独立 Branch / PR
```

因此可能出现：

```text
一个 Delivery Issue
0 个 Development Sub-Issue
2 个 Repository
2 个 PR
```

也可能出现：

```text
一个 Delivery Issue
2 个 Development Sub-Issue
3 个 Repository
3 个或更多 PR
```

PR 数量由 Repository Change 决定，不由 Issue 数量决定。

---

# 30.2 PR 引用与事实归属

一个 Delivery Issue / Development Unit 可关联多个 Repository Change，每个需要交付的业务 Repository 独立 PR。PR Preparation、`current_pr` / `pr_history`、外部终态和恢复契约统一引用 `multica-squad-centric-delivery-v1.4.9.md` §17–§18、§26；本 Analysis 文档不维护第二套 PR Metadata Schema。

Workitem Analyst 交付 Repository Scope、必要接口约束和验收要求；不在 Analysis 阶段创建 PR、填入尚不存在的 PR ID 或把 PR 完成作为分析 / 工程任务的前置条件。

---

# 30.3 Development Completion 与 Delivery Completion

完成规则以 `multica-squad-centric-delivery-v1.4.9.md` §11–§12、§15–§17、§21–§22 为唯一权威来源。

```text
Development Unit 完成
= 当前 Unit 的 Engineering Contract 完成
  （sdd-fast 同时满足当前 Unit 的必要工程任务和规格证据要求）

Delivery Issue 完成
= 所有 required Units 完成
  + 必要 Verify、业务 PR 与最终收口条件满足
```

Development Sub-Issue 不等待业务 PR 合并、独立 Verify 或 OpenSpec Archive 才能完成；其完成后由父 Delivery 推进这些交付动作。本方案不维护另一份 Development / PR / Verify 聚合 Gate。

---

# 30.4 `analysis-routing.yaml`

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

`analysis-routing.yaml` 是 Analysis Route 的唯一配置源，负责定义：

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

`sdd-fast` 的原生产物格式、依赖和跳过规则通过 `spec-preparation` / 原生 Schema 状态检查，不在本配置重新枚举 Proposal / Specs / Design / Tasks 的依赖。表中的 `required_artifacts` 只声明项目额外产物；删除重复声明不表示取消 OpenSpec 准备要求。配置归属见 §9.4。

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

`workitem-analysis` 是 Workitem Analyst 唯一 Canonical Entry。

典型 Route：

```text
Context 缺失 / 过期
→ context-analysis

tfs.type == Bug
→ bug-analysis
→ route = bug-fix

tfs.type == Requirement
且 Expected Behavior 已存在
且本次目标只是恢复正确行为
→ bug-analysis
→ route = production-fix

tfs.type == Requirement
且产品主动改变 Expected Behavior
→ requirement-analysis
→ spec-preparation
→ requirement-review
→ route = sdd-fast

范围明显超出当前自动处理能力
→ sdd-standard / STOP / Human

Analysis 完成
→ analysis-completion
→ Analysis Gate

Analysis Gate PASS
→ Workitem Analyst 在 analysis-completion 中发布分析与 Gate 结果
→ 写入并回读确认 Delivery Issue.status = analysis_review
→ 结束本轮分析，等待人工，不自动进入研发

Human 自然语言明确批准研发
→ Delivery Lead 理解本次决定与条件，保留原始来源并核对硬条件
→ sdd-fast：根仓 Commit 记录批准的开发起始基线（不创建 PR）
→ 写入并确认 in_progress
→ 组织 Development

Human 自然语言明确要求修改分析
→ Delivery Lead 整理原始反馈与可执行修正方向
→ 写入并确认 in_progress
→ @Workitem Analyst 一次
→ targeted rework，完成后由 Workitem Analyst 再次提交审核

Human 普通讨论 / 授权意图不明确
→ 回答或澄清，保持审核等待，不开始研发
```

不判断：

```text
Normal / Urgent
Hotfix Policy
```

---

# 32. 紧急程度的正式边界

当前不让 Agent 判断：

```text
是不是紧急
是不是必须马上修
是不是 Hotfix
```

这些属于：

```text
研发负责人
产品负责人
现场负责人
发布负责人
```

的排期 / 优先级决策。

Agent 可以读取现有：

```text
Priority
Severity
Deadline
Human Comment
```

作为执行上下文，但不能自行把任务升级为 Hotfix Workflow。

如果人工认为紧急：

```text
→ 提前安排
→ 提高优先级
→ 更早启动开发
```

即可。

只要技术流程没有实质不同，就不需要增加 Agent 路由概念。

---

# 33. Analysis 与 Development 边界

| 工作 | 负责位置 / 终点 |
|---|---|
| 需求与问题理解、场景 / 规则 / 范围 / 验收澄清、Context、必要方案及按 Route 的研发准备 | Workitem Analyst；按 §1.2 形成可审核、能支撑研发与验证的 Analysis Package |
| Analysis Gate | 只校验当前 Route 的可确认条件并返回结果，不写状态 |
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
    ├── scripts/
    │   └── validate-analysis.py
    └── templates/
        └── analysis-package.md
```

---

# 35. 最终执行模型

```text
                           Work Item
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

| 项目 | 决策 |
|---|---|
| TFS Type | 公司管理事实，Agent 不修改 |
| 技术变更性质 | Workitem Analyst 语义判断 |
| TFS Bug | `bug-fix` |
| Requirement + Corrective | `production-fix` |
| Requirement + Intentional | `sdd-fast` |
| 大型复杂需求 | `sdd-standard`，暂不自动处理 |
| `fast-track` | 不属于当前正式模型 |
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
| Human Analysis Review | 所有 Analysis 最终 Gate |
| Approved OpenSpec Commit | Human APPROVED 后提交根仓 Git，记录开发基线；允许批准边界内更新，不创建独立 PR |
| Reject Rework | Lead 理解并保留反馈，写入并确认 `in_progress` 后单次委派 Workitem Analyst；修订后由 Workitem Analyst 再提交 |
| Analysis Route Config | `analysis-routing.yaml` 是三条 Route 的唯一配置源 |
| Cross-Repository | `bug-fix` / `production-fix` / `sdd-fast` 均允许跨仓 |
| Route 与仓库数 | Repository 数量不参与一级 Route 判断 |
| Sub-Issue | 跨仓不等于必须拆 Sub-Issue；按独立 Development Unit 判断 |
| PR Boundary | 每个发生代码变更的 Repository 独立 Branch / PR |
| Multi-PR | 一个 Delivery Issue / Sub-Issue 可以关联多个 PR |
| Completion | Unit 完成 Engineering Contract；Verify / PR / Finalize 属于父 Delivery；详细规则只引用总方案 |

---

# 37. 核心原则

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

> **只有未来真正存在不同的 Hotfix 流程、Gate、权限或 Release Policy 时，才值得把 Hotfix 建模成系统概念。**

> **Workitem Analyst 负责需求与问题分析及研发准备，主动澄清目标、场景、规则、范围与验收要求；技术调查与必要方案服务于研发支撑。不替代人的业务决策，不等于不做业务需求分析。**

> **Repository Scope 不决定 Workflow Route；Corrective Change 即使跨多个 Repository，仍然是 `bug-fix` 或 `production-fix`。**

> **跨仓不等于拆 Sub-Issue；Sub-Issue 只表达独立 Development Unit。**

> **PR 是 Repository 级交付对象；每个发生代码变更的 Repository 必须独立 Branch / PR。**

> **一个 Delivery Issue 或 Development Sub-Issue 可以关联多个 Repository 和多个 PR。**

> **Development Unit 完成以 Engineering Contract 为准，不等待 PR 合并；业务 PR 与最终收口条件由父 Delivery 按总方案检查。**


---


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

---

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

[^a-openspec-schema]: OpenSpec 官方 [spec-driven Schema](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/schemas/spec-driven/schema.yaml)，2026-09-29 核对。原生模板 / 指令、依赖和 `.openspec.yaml` 跳过事实以团队安装版本为准；本项目不复制其完整内容。
[^a-openspec-config]: OpenSpec 官方 [Customization](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/docs/customization.md)，2026-09-29 核对。项目配置提供上下文与规则，不是权限或硬条件的替代；本节职责划分与默认不 Fork 的选择属于本项目设计。
