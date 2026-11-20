# Workitem Analyst Skill 设计方案

> Version: 1.5
> Date: 2026-09-23  
> Scope: Multica Delivery Squad 中 Workitem Analyst 的分析路由、上下文构建、Bug / Production Fix / SDD-fast 分流、Spec Preparation 与 Review  
> Status: Baseline

> Terminology：本方案中的 Squad、Agent、Issue、Status、Route、Gate 等公共名称统一遵循 `multica-design-guideline-v1.4.md` 的 Canonical Terminology；本方案只维护 Analysis 领域术语。

---

# 1. 目标

Workitem Analyst 负责 Delivery Issue 的分析阶段。

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

进入 `sdd-fast` 后统一使用 OpenSpec Change Model。

根据变更内容决定 Artifact 深度。

## New Capability

生成：

```text
proposal.md
spec.md
tasks.md
design.md（按需）
```

## Modified Capability

已有 Capability 的正式行为发生变化，同样生成相应 Delta Spec：

```text
proposal.md
spec.md
tasks.md
design.md（按需）
```

## 无 Spec-level Behavior Change

例如：

```text
性能优化
内部重构
实现替换
工程整理
但外部行为契约不变
```

仍然可以进入 OpenSpec Change，但：

```text
skip_specs = true
```

不为了流程而伪造 Spec Requirement。

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
| `context-analysis` | Engineering Context Grounding |
| `requirement-analysis` | Intentional Product Change Analysis |
| `bug-analysis` | Corrective Change / Root Cause Analysis |
| `spec-preparation` | SDD-fast OpenSpec Preparation |
| `requirement-review` | SDD-fast Independent Reviewer |
| `analysis-completion` | Assemble / Gate / Publish |

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

`context-analysis` 是跨阶段 Engineering Context Capability。

主要产物：

```text
context-pack.md
```

`context-analysis` 必须天然支持跨 Repository 调查，不得在定位到第一个相关 Repository 后停止。

推荐调查方式：

```text
Work Item
↓
AGENTS.md 定位候选 Repository
↓
识别入口 Repository
↓
沿调用链 / 数据流调查
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
Observation
Expected vs Actual
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
analysis-completion
        ↓
Analysis Gate
        ↓
Human Analysis Review
```

---

# 21. Requirement Analysis

`requirement-analysis` 只处理 Intentional Change。

负责：

```text
Requirement Understanding
Current Behavior
Expected Behavior
Clarification
Solution Exploration
Selected Solution
Impact Scope
Repository Scope
Acceptance Criteria
Development Scope
Verification Requirements
Risks
Open Decisions
```

它不处理：

```text
Corrective Root Cause
```

---

# 22. Spec Preparation

`spec-preparation` 服务 `sdd-fast`。

负责：

```text
Proposal
Spec / Delta Spec
Tasks
Design（按需）
```

它合并原有：

```text
sdd-spec-propose
+
sdd-spec-preparation
```

不再按旧 Workflow Stage 拆成多个顶层 Skill。

---

# 23. OpenSpec Tasks 与 Multica Sub-Issue

必须保持：

```text
OpenSpec tasks.md
≠
Multica Development Sub-Issue
```

`tasks.md`：

```text
Spec Implementation Checklist
```

Multica Development Sub-Issue：

```text
独立 Owner
独立开发
独立 Verify
独立 PR
```

是否创建 Sub-Issue 由 Human Analysis Review 通过后的 Delivery Lead 决定。

---

# 24. Requirement Review

`requirement-review` 只服务 `sdd-fast`。

继续保留独立只读 Reviewer Subagent。

读取：

```text
context-pack.md
requirement-analysis.md
proposal.md
spec.md / delta spec（如有）
tasks.md
design.md（如有）
Acceptance Criteria
Verification Requirements
Evidence
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

失败后只做 targeted rework。

---

# 25. Analysis Completion

`analysis-completion` 负责：

```text
Assemble
Validate
Publish
```

根据 route 执行不同 Gate。

---

# 26. Bug Analysis Package

```text
Analysis Package
├── context-pack.md
├── bug-analysis.md
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
├── requirement-analysis.md
├── proposal.md
├── spec.md / delta spec（按需）
├── tasks.md
├── design.md（按需）
├── requirement-review.md
├── Development Scope
├── Acceptance Criteria
└── Verification Requirements
```

---

# 28. Deterministic Analysis Gate

## Bug / Production Fix

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

至少检查：

```text
Requirement Analysis 存在
proposal.md 存在
tasks.md 存在
spec-required 时 spec 存在
design-required 时 design 存在
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
→ 人确认 Root Cause / Fix Scope 可以进入研发

sdd-fast
→ 人确认 Requirement / Proposal / Spec / Tasks 可以进入研发
```

Analysis Gate PASS 后：

```text
Delivery Issue.status = analysis_review
```

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

Reviewer 提交顶层评论：

```text
APPROVED

<可选说明>
```

Delivery Issue 保持：

```text
assignee = Delivery Squad
status   = analysis_review
```

Human 顶层评论由 Multica 路由给 Delivery Lead。

Delivery Lead：

```text
读取 Analysis Gate + 最新 Human Comment
        ↓
确认 APPROVED
        ↓
status = in_progress
        ↓
进入后续 Development
```

## 29.2 Human Reject

Reviewer 提交：

```text
REJECTED

Reason:
- ...

Expected Change:
- ...
```

Delivery Lead：

```text
读取 Reject Feedback
        ↓
status = in_progress
        ↓
@Workitem Analyst
        ↓
Targeted Rework
```

Workitem Analyst 只修改受影响部分：

```text
context
→ context-analysis

root_cause / fix_scope
→ bug-analysis

requirement / solution / impact
→ requirement-analysis

proposal / spec / tasks / design
→ spec-preparation
```

重新完成：

```text
analysis-completion
→ Analysis Gate
→ PASS
→ status = analysis_review
```

再次等待人工审核。

不新增：

```text
rejected
reworking
resubmitted
```

等 Issue Status。

## 29.3 `blocked` 边界

正常 Human Analysis Review 不使用 `blocked`。

仅当存在真实无法继续的问题时使用：

```text
关键事实缺失
外部依赖不可用
权限 / 环境问题
必要 Evidence 无法获得
无法可靠判断
多轮失败无法自主恢复
```

因此：

```text
`analysis_review` / Analysis Review
= Normal Human Gate

blocked
= Exceptional Stop
```

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

# 30.2 PR Metadata 建议

一个 Issue / Sub-Issue 应允许记录多个 Repository Delivery Record：

```yaml
delivery:
  repositories:
    - repository: repo-a
      branch: fix/12345-a
      pr:
        id: 101
        url: ...
        status: active

    - repository: repo-b
      branch: fix/12345-b
      pr:
        id: 205
        url: ...
        status: active
```

不要再假设：

```text
Issue
↔
唯一 Repository
↔
唯一 PR
```

正确关系是：

```text
Issue / Development Unit
↔
1..N Repository Change
↔
每个 Repository Change 对应独立 PR
```

---

# 30.3 Development Completion Gate

跨仓场景下，Development Completion 不能只检查单个 PR。

应检查：

```text
所有 required Repository Change 均已完成
+
所有 required PR 均满足完成条件
+
required Verify PASS
+
无 unresolved blocker
```

概念上：

```text
development_done =
    required_verify_pass
    AND
    all(required_repository_pr_merged)
    AND
    no_unresolved_blocker
```

例如：

```text
Repository A → PR-A MERGED
Repository B → PR-B MERGED
Repository C → 仅验证，无代码变更，不要求 PR
```

只有所有 required Repository 的代码交付完成后，当前 Development Unit 才能完成。

Verify 的数量和粒度不与 PR 数量强绑定：

```text
多个 PR
```

可以对应：

```text
一次整体 Verify
```

也可以对应：

```text
Repository-level Verify
+
Integration Verify
```

由 Development Unit 和 Verification Boundary 决定。

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
Required Artifacts
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
      - proposal
      - tasks

fallback:
  unsupported_scope:
    action: stop
    target: human
```

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
→ Delivery Issue.status = analysis_review
→ STOP

Human APPROVED
→ Delivery Lead
→ status = in_progress
→ Development

Human REJECTED
→ Delivery Lead
→ status = in_progress
→ @Workitem Analyst
→ targeted rework
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

Analysis：

```text
Context Grounding
+
Bug Root Cause / Requirement Analysis
+
SDD-fast OpenSpec Preparation（仅 Intentional Change）
+
Independent Review（仅 SDD-fast）
+
Deterministic Gate
+
Human Approval
```

Development：

```text
TFS Task Materialization（Requirement）
+
Sub-Issue Materialization（按需）
+
Branch
+
Code
+
Verification
+
Commit / Push
+
PR
```

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
│   └── templates/
│       ├── proposal.md
│       ├── spec.md
│       ├── tasks.md
│       └── design.md
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
| OpenSpec | `sdd-fast` 使用 |
| New / Modified Capability | 都可生成 Spec |
| 无 Spec-level 行为变化 | OpenSpec `skip_specs` |
| Requirement Review | 只服务 `sdd-fast` |
| TFS Task | 只看原始 `tfs.type` |
| Workitem Analyst | 不负责 TFS 类型修正 |
| Analysis Review Status | Status Key=`analysis_review`；Display Name=`Analysis Review`；category=`started` |
| Review Decision | 使用 Human Comment 保存，不维护 `analysis.review_status` |
| Human Analysis Review | 所有 Analysis 最终 Gate |
| Reject Rework | Delivery Lead → `in_progress` → `@Workitem Analyst` → targeted rework |
| blocked | 只用于真实异常，不用于正常审核等待 |
| Analysis Route Config | `analysis-routing.yaml` 是三条 Route 的唯一配置源 |
| Cross-Repository | `bug-fix` / `production-fix` / `sdd-fast` 均允许跨仓 |
| Route 与仓库数 | Repository 数量不参与一级 Route 判断 |
| Sub-Issue | 跨仓不等于必须拆 Sub-Issue；按独立 Development Unit 判断 |
| PR Boundary | 每个发生代码变更的 Repository 独立 Branch / PR |
| Multi-PR | 一个 Delivery Issue / Sub-Issue 可以关联多个 PR |
| Completion | 检查所有 required Repository PR，而不是单 PR |

---

# 37. 核心原则

> **TFS 怎么登记、技术上是什么、走什么开发方法，是三个不同的问题。**

> **Bug 类型的管理规则由 TFS Type 决定，不由 Agent 重分类。**

> **Requirement 可以在技术上属于 Corrective Change，并走 `production-fix`，但仍然保留 Requirement 的工作量和 TFS Task 规则。**

> **正常产品迭代统一走 `sdd-fast` / OpenSpec。**

> **`production-fix` 不区分 Normal / Hotfix；紧急程度交给人管理。**

> **只有未来真正存在不同的 Hotfix 流程、Gate、权限或 Release Policy 时，才值得把 Hotfix 建模成系统概念。**

> **当前 Workitem Analyst 只负责事实分析、语义分类和开发前准备，不替代人的业务管理决策。**

> **Repository Scope 不决定 Workflow Route；Corrective Change 即使跨多个 Repository，仍然是 `bug-fix` 或 `production-fix`。**

> **跨仓不等于拆 Sub-Issue；Sub-Issue 只表达独立 Development Unit。**

> **PR 是 Repository 级交付对象；每个发生代码变更的 Repository 必须独立 Branch / PR。**

> **一个 Delivery Issue 或 Development Sub-Issue 可以关联多个 Repository 和多个 PR。**

> **Development Completion 必须检查所有 required Repository 的 PR 完成状态。**


---

# v1.5 变更摘要

相对 v1.4：

- 引用 `multica-design-guideline-v1.4.md` 的 Canonical Terminology，不再独立维护公共命名；
- Analysis Review 正式 Status Key 统一为 `analysis_review`，Display Name=`Analysis Review`，category=`started`；
- Analysis Gate PASS 后统一写入 `Delivery Issue.status = analysis_review`；
- Human Approve / Reject 的等待与回流流程统一使用 `analysis_review` 作为机器状态值；
- Human 顶层 Comment 明确回流正式 Agent `Delivery Lead`，不再以 `Squad Leader` 作为第二名称；
- `Workitem Analyst` 保持为分析 Agent 的唯一正式名称；
- `bug-fix / production-fix / sdd-fast / sdd-standard`、`Development Unit`、`Repository Change`、`Development Sub-Issue` 等领域边界保持 v1.4 不变。
