# Workitem Analyst Skill 设计方案

> Version: 1.1  
> Date: 2026-09-22  
> Scope: Multica Delivery Squad 中 Workitem Analyst Agent 的 Skill 拆分、执行驱动、上下文分析、Fast-track / SDD-fast 编码前准备与 Review 机制  
> Status: Baseline

---

# 1. 目标

Workitem Analyst 负责 Delivery Issue 的 Requirement / Bug 分析阶段，并在需要时完成进入 Development 前的编码准备。

本方案基于现有 `winning-platform-monorepo` 中已经验证过的能力进行重构，包括：

- `fire` 中与 Analysis 入口、恢复、路由相关的机制；
- `requirement-analysis` workflow；
- `requirement-brainstorm` 的 Context Pack / Decision Gate；
- `requirement-review` 的独立 Reviewer 机制；
- `bug-analysis` 的系统化根因分析方法；
- 根级 `AGENTS.md` 第 1 章的 Repository Routing；
- `docs/router/*`；
- `code-intelligence` / CodeGraph；
- `fast-track` 编码前 planning；
- `sdd-fast` 的 proposal / spec / tasks 等编码前准备。

迁移到 Multica 后，不复制旧 Harness 的：

- Workflow Runtime；
- Stage Machine；
- `workflow-runner`；
- `sdd-standard` 全量流程。

当前版本只考虑：

```text
Bug
Fast-track
SDD-fast
```

暂不考虑：

```text
SDD-standard
= 全新模块 / 大需求 / 重型架构设计
```

核心原则：

> **Workitem Analyst 负责 Analysis 内部专业工作，不负责整个 Delivery 生命周期。**

> **Analysis 的目标不仅是“分析清楚”，还包括按任务需要完成 Fast-track 或 SDD-fast 的编码前准备，并形成可供人工审核的 Development-Ready Package。**

---

# 2. 当前范围

## 2.1 支持范围

### Bug

适用于缺陷修复。

主要输出：

```text
Root Cause
Fix Strategy
Fix Scope
Repository Scope
Regression Scope
Verification Requirements
```

---

### Fast-track

适用于：

```text
已有功能的局部改造
已有能力优化
范围清晰
现有架构模式可复用
不需要维护正式 Spec Contract
```

编码前需要形成：

```text
Implementation Plan
```

---

### SDD-fast

适用于：

```text
已有功能改造
用户可观察行为变化
API / Contract 变化
存在多个重要业务场景
需要 Proposal / Spec 作为正式行为依据
整体复杂度仍可控
```

编码前需要形成：

```text
proposal.md
spec.md
tasks.md
design.md（按需）
```

---

## 2.2 暂不支持范围

以下场景暂不纳入 Workitem Analyst 当前自动分析方案：

```text
全新业务模块
大规模架构设计
多个核心业务域
重大数据模型重构
复杂跨仓 Contract
需要大量产品 / 架构人工讨论的需求
```

这些场景当前视为：

```text
SDD-standard
```

处理原则：

```text
Workitem Analyst
→ 识别当前范围不足
→ STOP
→ Delivery Lead / Human
```

不自动进入 `sdd-standard`。

---

# 3. Workitem Analyst 最终 Skill 集合

推荐绑定 8 个 Skill：

```text
Workitem Analyst
│
├── workitem-analysis
├── context-analysis
├── requirement-analysis
├── bug-analysis
├── implementation-planning
├── spec-preparation
├── requirement-review
└── analysis-completion
```

职责：

| Skill | 定位 |
|---|---|
| `workitem-analysis` | Analysis Driver / Canonical Entry |
| `context-analysis` | 跨阶段工程上下文分析与 Context Pack |
| `requirement-analysis` | Requirement 语义、方案、影响、AC |
| `bug-analysis` | Root Cause / Fix Scope / Regression |
| `implementation-planning` | Fast-track 编码前实施计划 |
| `spec-preparation` | SDD-fast Proposal / Spec / Tasks |
| `requirement-review` | Requirement Independent Reviewer Subagent |
| `analysis-completion` | Assemble / Gate / Publish |

---

# 4. Superpowers 的处理原则

原 Requirement / Bug 分析分别依赖：

```text
superpowers:brainstorming
superpowers:systematic-debugging
```

当前方案不再将 Superpowers 作为运行时硬依赖。

采用：

> **保留方法，移除依赖。**

## 4.1 Requirement

吸收：

```text
需求澄清
方案探索
多方案比较
关键约束
Open Questions
Human Decision Point
```

这些直接成为 `requirement-analysis` 的执行方法。

## 4.2 Bug

吸收：

```text
Root Cause Investigation
→ Pattern Analysis
→ Hypothesis & Verification
→ Fix Strategy
→ Regression Scope
```

这些直接成为 `bug-analysis` 方法。

---

# 5. `context-analysis`

`context-analysis` 是跨阶段能力，不只服务 Requirement Analysis。

它负责：

> **Engineering Context Grounding**

主要产物：

```text
context-pack.md
```

可被：

```text
requirement-analysis
bug-analysis
implementation-planning
spec-preparation
requirement-review
Engineer
Verify
```

复用。

---

# 6. Repository Routing

Repository 一级定位必须首先读取：

```text
Root AGENTS.md §1 工作区仓库与边界
```

该章节维护：

```text
Repository
类型
主要职责
业务关键词
不负责范围
```

Skill 不应自行硬编码 Repository Mapping。

---

# 7. Context 加载顺序

统一采用：

```text
① Current Work Item / Issue
        ↓
② external-knowledge.md
        ↓
③ Root AGENTS.md §1
        ↓
④ Target Repository Instructions
        ↓
⑤ docs/router/overview.md
        ↓
⑥ docs/router/*-mapping.md
        ↓
⑦ code-intelligence / CodeGraph
        ↓
⑧ caller / callee / impact analysis
        ↓
⑨ Exact Source Read
        ↓
⑩ ripgrep / code search fallback
```

形成：

```text
业务事实
→ 人工补充知识
→ Repository
→ 模块 / API
→ Code Graph
→ Source Evidence
```

---

# 8. AGENTS.md / Router / CodeGraph 边界

## AGENTS.md

回答：

```text
这个需求属于哪个 Repository / Domain？
```

## docs/router

回答：

```text
这个 Repository 中具体页面 / API / Controller / 模块入口在哪里？
```

## CodeGraph

回答：

```text
Symbol / Caller / Callee / Dependency / Impact 是什么？
```

## Source Read

回答：

```text
最终源码事实是什么？
```

正式顺序：

```text
AGENTS.md
→ docs/router
→ CodeGraph
→ Source
```

---

# 9. Context Pack

建议保留：

```markdown
# Context Pack

## Work Item
## External Knowledge
## Repository Routing
## Repository Boundaries
## Entry Points
## Router Evidence
## Code Evidence
## Call Paths
## Existing Patterns
## Acceptance Signals
## Constraints
## Open Questions
## Evidence Gaps
## Source Inventory
```

---

# 10. Requirement Analysis

`requirement-analysis` 统一负责：

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

它不直接负责：

```text
Proposal / Spec / Tasks
Implementation Plan
代码实现
```

完成后，判断当前 Requirement 后续需要：

```text
fast-track preparation
or
sdd-fast preparation
```

---

# 11. Fast-track 编码前准备

Fast-track 用于：

```text
已有功能局部调整
影响范围明确
实现方式较清晰
主要复用现有模式
不需要正式 Spec Contract
```

执行：

```text
requirement-analysis
        ↓
implementation-planning
```

---

# 12. `implementation-planning`

`implementation-planning` 只服务 Fast-track 编码前准备。

它回答：

> **当前已确认方案具体准备怎样实现？**

主要输出：

```text
plan.md
```

建议内容：

```text
修改范围
关键 Repository
关键模块 / 文件 / Symbol
主要实现步骤
依赖关系
测试策略
Verification Requirements
风险点
```

它属于：

```text
Analysis-side Coding Preparation
```

不执行：

```text
Branch
Code Change
Commit
Push
PR
```

---

# 13. SDD-fast 编码前准备

对于需要 Spec Coding 的已有功能改造：

```text
requirement-analysis
        ↓
spec-preparation
```

输出：

```text
proposal.md
spec.md
tasks.md
design.md（按需）
```

---

# 14. `spec-preparation`

`spec-preparation` 合并原：

```text
sdd-spec-propose
+
sdd-spec-preparation
```

不再保留两个顶层 Skill。

它负责：

## Proposal

回答：

```text
Why
Scope
Solution Direction
Impact
```

输出：

```text
proposal.md
```

## Spec

回答：

```text
目标行为是什么？
有哪些 Scenario？
Acceptance Contract 是什么？
```

输出：

```text
spec.md
```

## Tasks

根据 Spec 形成：

```text
tasks.md
```

用于描述 Spec 实现步骤 / Checklist。

## Design

仅在确有必要时生成：

```text
design.md
```

例如：

```text
Contract 变化
数据模型调整
跨模块设计
兼容性策略
```

---

# 15. OpenSpec `tasks.md` 与 Multica Sub-Issue 的边界

必须明确：

```text
OpenSpec tasks.md
≠
Multica Development Sub-Issue
```

`tasks.md` 表示：

```text
Spec Implementation Checklist
```

Multica Development Sub-Issue 表示：

```text
可独立 Owner
可独立开发
可独立 Verify
可独立 PR
```

例如：

```text
tasks.md
- 修改 API
- 增加 DTO 字段
- 修改页面
- 增加测试
```

不代表需要创建 4 个 Multica Issue。

Development Sub-Issue 是否创建，由 Human Review 通过后 Delivery Lead 根据 Development Scope 判断。

---

# 16. Fast-track Requirement 流程

```text
workitem-analysis
        ↓
context-analysis
        ↓
requirement-analysis
        ↓
选择 fast-track preparation
        ↓
implementation-planning
        ↓
requirement-review
        ↓
analysis-completion
        ↓
Deterministic Analysis Gate
        ↓
Human Analysis Review
```

主要产物：

```text
context-pack.md
requirement-analysis.md
plan.md
requirement-review.md
```

---

# 17. SDD-fast Requirement 流程

```text
workitem-analysis
        ↓
context-analysis
        ↓
requirement-analysis
        ↓
选择 sdd-fast preparation
        ↓
spec-preparation
        │
        ├── proposal.md
        ├── spec.md
        ├── tasks.md
        └── design.md（按需）
        ↓
requirement-review
        ↓
analysis-completion
        ↓
Deterministic Analysis Gate
        ↓
Human Analysis Review
```

---

# 18. Bug 流程

Bug 当前不参与 Fast-track / SDD-fast Preparation 分类。

流程：

```text
workitem-analysis
        ↓
context-analysis
        ↓
bug-analysis
        ↓
analysis-completion
        ↓
Deterministic Analysis Gate
        ↓
Human Analysis Review
```

---

# 19. `bug-analysis`

负责：

```text
Symptom
Expected vs Actual
Reproduction
Failure Path
Root Cause Investigation
Pattern Analysis
Hypothesis
Verification
Fix Strategy
Fix Scope
Repository Scope
Regression Scope
Verification Requirements
```

必须明确区分：

```text
Observation
Hypothesis
Evidence
Verification
Conclusion
```

建议输出：

```yaml
root_cause:
  status: confirmed | probable | unknown
  summary: ...
  evidence:
    - ...
  rejected_hypotheses:
    - ...
```

只有存在可追溯 Evidence 时才能声明：

```text
root_cause = confirmed
```

---

# 20. Bug 不执行独立 AI Review

Requirement 的主要风险：

```text
方案遗漏
边界遗漏
Spec / Plan 不自洽
Impact 不完整
```

因此需要 Independent Reviewer。

Bug 的分析方法本身已经包含：

```text
Hypothesis
→ Evidence
→ Verification
→ Conclusion
```

因此当前采用：

```text
bug-analysis internal verification
+
analysis-completion gate
+
Human Review
```

不额外执行 `requirement-review`。

---

# 21. Requirement Review

`requirement-review` 保留原 `requirement-review` 的独立 Subagent 思路。

Reviewer 是：

```text
read-only Independent Reviewer Subagent
```

不是 Multica Squad Member。

---

# 22. Fast-track Review 输入

Reviewer 读取：

```text
context-pack.md
requirement-analysis.md
plan.md
Acceptance Criteria
Verification Requirements
Evidence
```

重点检查：

```text
方案正确性
影响范围
实现计划完整性
AC 覆盖
Verification Coverage
风险遗漏
```

---

# 23. SDD-fast Review 输入

Reviewer 读取：

```text
context-pack.md
requirement-analysis.md
proposal.md
spec.md
tasks.md
design.md（如有）
Acceptance Criteria
Evidence
```

重点检查：

```text
Proposal 是否与 Requirement 一致
Spec 是否覆盖目标行为
Scenario 是否完整
tasks 是否可追溯到 Spec
Impact Scope 是否完整
Verification 是否覆盖关键场景
```

不再单独创建：

```text
spec-review
plan-review
```

顶层 Skill。

---

# 24. Reviewer 输出

统一：

```yaml
verdict: APPROVED | NEEDS_REVISION

issues:
  - id:
    severity:
    area:
    description:
    evidence:
    suggestion:
    auto_fixable:
```

`area` 可包括：

```text
context
requirement
solution
impact
acceptance_criteria
implementation_plan
proposal
spec
tasks
design
verification
risk
```

---

# 25. Review Rework

Reviewer 返回问题后：

```text
context
→ context-analysis

requirement / solution / impact / AC
→ requirement-analysis

implementation_plan
→ implementation-planning

proposal / spec / tasks / design
→ spec-preparation
```

然后重新执行 Review。

原则：

> **Targeted Rework，不全量重新执行 Analysis。**

建议最多：

```text
2 rounds
```

Round 2 仍然存在重大问题：

```text
→ STOP
→ Human / Delivery Lead
```

---

# 26. `analysis-completion`

负责：

```text
Assemble
Validate
Publish
```

---

# 27. Analysis Package：Bug

```text
Analysis Package
│
├── context-pack.md
├── bug-analysis.md
├── Fix Scope
├── Repository Scope
├── Regression Scope
├── Acceptance Criteria
└── Verification Requirements
```

---

# 28. Analysis Package：Fast-track

```text
Analysis Package
│
├── context-pack.md
├── requirement-analysis.md
├── plan.md
├── requirement-review.md
├── Acceptance Criteria
├── Development Scope
└── Verification Requirements
```

---

# 29. Analysis Package：SDD-fast

```text
Analysis Package
│
├── context-pack.md
├── requirement-analysis.md
├── proposal.md
├── spec.md
├── tasks.md
├── design.md              # optional
├── requirement-review.md
├── Acceptance Criteria
├── Development Scope
└── Verification Requirements
```

---

# 30. Deterministic Analysis Gate

Gate 根据当前 Analysis 类型检查不同要求。

## Bug

至少检查：

```text
Root Cause 状态存在
Fix Scope 存在
Repository Scope 存在
Verification Requirements 存在
无 unresolved blocker
```

## Fast-track

至少检查：

```text
Requirement Analysis 存在
Solution 存在
Impact Scope 存在
Repository Scope 存在
Acceptance Criteria 存在
plan.md 存在
requirement-review APPROVED
Verification Requirements 存在
```

## SDD-fast

至少检查：

```text
Requirement Analysis 存在
proposal.md 存在
spec.md 存在
tasks.md 存在
design.md 在 required 时存在
requirement-review APPROVED
Acceptance Criteria 存在
Verification Requirements 存在
```

统一返回：

```yaml
result: PASS | FAIL | UNKNOWN
reasons:
  - ...
```

---

# 31. Human Analysis Review

Analysis Gate PASS 后：

```text
analysis.review_status = waiting
```

进入 Human Review。

Human Review 审核的是：

```text
需求 / Bug 理解
Solution / Fix Strategy
Impact Scope
Repository Scope
Fast-track Plan
或 SDD-fast Proposal / Spec / Tasks
Acceptance Criteria
Verification Requirements
```

批准：

```text
analysis.review_status = approved
```

拒绝：

```text
analysis.review_status = rejected
```

然后由 Delivery Lead 再次唤醒 Workitem Analyst 做 targeted rework。

---

# 32. Analysis 与 Development 边界

当前正式定义：

```text
Analysis
=
Context Grounding
+
Requirement / Bug Analysis
+
必要的 Fast-track Implementation Plan
或 SDD-fast Spec Preparation
+
Independent Review（Requirement）
+
Deterministic Gate
+
Human Approval
```

Development：

```text
Development
=
将已批准的开发准备材料实例化为实际开发工作
+
Branch
+
Code
+
Verify
+
Commit / Push
+
PR
```

---

# 33. Development Scope

`requirement-analysis` / `bug-analysis` 都应提供：

```text
Development Scope
```

用于告诉 Delivery Lead：

```text
涉及哪些 Repository
涉及哪些主要模块
有哪些独立 Delivery Units
是否存在 Dependencies
需要哪些专业角色
```

它不是详细编码计划。

---

# 34. Delivery Lead 在 Human Review 后的职责

Human Review APPROVED 后：

```text
Delivery Lead
        ↓
读取 Development Scope
        ↓
判断 Simple / Complex Delivery
```

Simple：

```text
一个主要 Owner
一个主要 Repository / PR
不存在真正独立的 Delivery Unit
→ 当前 Delivery Issue 继续
```

Complex：

```text
多个真正独立：
Owner
Code Change
Verify
PR
→ 创建 Development Sub-Issue
```

OpenSpec `tasks.md` 不直接驱动 Sub-Issue 创建。

---

# 35. `workitem-analysis` Driver

`workitem-analysis` 是 Workitem Analyst 唯一 Canonical Entry。

它不维护自己的 workflow state。

每次：

```text
读取当前 Issue / Artifact / Feedback
        ↓
判断下一能力
        ↓
执行对应 Skill
        ↓
重新读取最新事实
        ↓
继续或停止
```

典型 Route：

```text
Context 缺失 / 过期
→ context-analysis

Requirement Analysis 缺失 / 过期
→ requirement-analysis

Bug Root Cause 未完成
→ bug-analysis

Requirement preparation = fast-track
→ implementation-planning

Requirement preparation = sdd-fast
→ spec-preparation

Requirement Draft 未 Review
→ requirement-review

Review NEEDS_REVISION
→ targeted rework

Bug Analysis 完成
→ analysis-completion

Requirement Review APPROVED
→ analysis-completion

Human Decision Required
→ STOP

SDD-standard / 当前范围不足
→ STOP / Delivery Lead / Human

Analysis Gate PASS
→ STOP / waiting Human Review
```

---

# 36. 推荐 Skill 目录

```text
workspace-skills/
│
├── workitem-analysis/
│   ├── SKILL.md
│   ├── scripts/
│   │   └── resolve-analysis-route.py
│   └── references/
│       └── analysis-routing.md
│
├── context-analysis/
│   ├── SKILL.md
│   ├── modules/
│   │   ├── repository-routing.md
│   │   ├── external-knowledge.md
│   │   └── code-investigation.md
│   ├── scripts/
│   │   └── validate-context.py
│   ├── references/
│   │   └── context-pack-schema.md
│   └── templates/
│       └── context-pack.md
│
├── requirement-analysis/
│   ├── SKILL.md
│   └── modules/
│       ├── clarification.md
│       ├── solution-analysis.md
│       └── impact-analysis.md
│
├── bug-analysis/
│   └── SKILL.md
│
├── implementation-planning/
│   ├── SKILL.md
│   └── templates/
│       └── plan.md
│
├── spec-preparation/
│   ├── SKILL.md
│   ├── templates/
│   │   ├── proposal.md
│   │   ├── spec.md
│   │   ├── tasks.md
│   │   └── design.md
│   └── references/
│       └── openspec-guidelines.md
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
    ├── references/
    │   └── analysis-package-schema.md
    └── templates/
        └── analysis-package.md
```

---

# 37. 最终执行模型

```text
                         workitem-analysis
                                │
                        context-analysis
                                │
                    ┌───────────┴───────────┐
                    │                       │
              Requirement                  Bug
                    │                       │
                    ▼                       ▼
          requirement-analysis        bug-analysis
                    │                       │
              preparation?                  │
              ┌─────┴─────┐                │
              │           │                │
          fast-track    sdd-fast            │
              │           │                │
              ▼           ▼                │
 implementation-    spec-preparation       │
    planning             │                 │
              └─────┬────┘                 │
                    ▼                      │
          requirement-review               │
                    │                      │
                    └──────────┬───────────┘
                               ▼
                     analysis-completion
                               │
                         Analysis Gate
                               │
                               ▼
                         Human Review
                               │
                               ▼
                         Delivery Lead
                               │
                      Development Scope
                               │
                       ┌───────┴───────┐
                       ▼               ▼
                     Simple          Complex
                       │               │
                    Engineer       Sub-Issues
```

---

# 38. 最终设计决策

| 项目 | 当前决策 |
|---|---|
| Superpowers | 不再作为运行时硬依赖 |
| Context Skill | `context-analysis` |
| Context Pack | 跨阶段共享 Artifact |
| Repository 一级定位 | 根级 `AGENTS.md` §1 |
| Router | `docs/router/*` |
| Code Intelligence | CodeGraph / code-intelligence |
| Requirement Analysis | 负责方案、影响、AC、Development Scope |
| Bug Analysis | Root Cause + Hypothesis Verification |
| Bug AI Review | 不单独执行 |
| Fast-track | 编码前 Planning 迁入 Analysis |
| Fast-track Skill | `implementation-planning` |
| SDD-fast | Proposal / Spec / Tasks 迁入 Analysis |
| SDD-fast Skill | `spec-preparation` |
| SDD-standard | 当前版本暂不考虑 |
| Requirement Review | Independent Reviewer Subagent |
| Review Scope | 包含 Fast-track Plan 或 SDD-fast Spec Artifacts |
| OpenSpec tasks.md | 不等于 Multica Sub-Issue |
| Analysis Gate | 根据 Bug / Fast-track / SDD-fast 分类型检查 |
| Human Review | Analysis 最终 Gate |
| Development | 从真实开发工作实例化与代码副作用开始 |

---

# 39. 核心原则

> **Context 是跨阶段资产。**

> **仓库定位先读 AGENTS.md，再下钻 Router、CodeGraph 和源码。**

> **Requirement Analysis 先解决“做什么、为什么、影响哪里”，Coding Preparation 再解决 Fast-track Plan 或 SDD-fast Spec。**

> **Fast-track 和 SDD-fast 的编码前准备迁入 Analysis。**

> **SDD-standard 当前明确不进入自动 Analysis 方案。**

> **Requirement 使用 Independent Reviewer；Bug 依赖根因假设验证 + Gate + Human Review。**

> **OpenSpec tasks.md 是实现清单，不是 Multica Development Sub-Issue。**

> **Workitem Analyst 内部由 `workitem-analysis` 做轻量 Driver，不建设新的 Workflow Engine。**

> **Analysis 结束于 Human Approval；Development 从真实开发交付开始。**
