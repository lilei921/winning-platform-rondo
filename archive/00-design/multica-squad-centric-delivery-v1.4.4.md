# Multica 研发任务闭环方案 v1.4.4

> 目标：基于 Multica 原生 Squad、Issue、Run、`@mention`、Sub-Issue、Stage、自定义 Status 与 Autopilot 能力，构建“需求同步 → 分析 → Analysis Review → 研发 → 按需独立验收 → PR 提交 → 等待合并 → 归档”的研发闭环。  
> 核心原则：**Squad 负责角色协作，Sub-Issue 负责独立交付单元，Deterministic Gate 负责硬条件，Multica 负责运行与状态。**

> Terminology：本方案中的 Squad、Agent、Issue、Status、Route、Gate 等名称统一遵循 `multica-design-guideline-v1.4.md` 的 Canonical Terminology；本方案不维护第二套全局术语。

---

# 1. 设计目标

整个研发任务默认作为一个完整的 **Delivery Issue** 管理。

一个 TFS Work Item 默认对应一个 Delivery Issue，并由 **Delivery Squad** 负责协作执行。

研发过程中：

- Workitem Analyst、各专业 Engineer、Verify Agent 等角色变化，不因为角色变化创建新的 Issue；
- Engineer 的 Local Validation 与 Code Review 属于 Development 必备质量机制，与 Verify Agent 是否参与无关；
- Verify Agent 是按需参与的 **behavior-oriented 独立验收者**，不依赖 Engineer 的实现过程，从 Acceptance Criteria / Verification Requirements 出发验证最终行为；
- Integration / E2E Verification 不再作为独立 Post-Merge 阶段，而是 Verify Agent 在需要时采用的验证方式；
- 只有出现真正能够独立推进、独立验证边界、独立失败 / 重试和独立完成的交付单元时，才创建 Development Sub-Issue；
- **多 Agent 协作优先由 Delivery Lead 通过 `@mention` 协调；**
- **路由、Gate、状态转换、物化、副作用、幂等和完成检查优先使用 Deterministic Script / Gate / Route；**
- **当确定性机制无法可靠决定下一步、返回 `UNKNOWN`、出现事实冲突或跨角色歧义时，由 Delivery Lead 基于当前上下文进行语义路由与协调；**
- Delivery Lead 不替代 Workitem Analyst、Engineer、Verify Agent 的专业工作，但负责决定当前需要哪种专业能力、如何组织成员协作以及何时需要 Human；
- PR 审核过程由 TFS / PR Platform 管理；Multica 不复制外部 Review 状态机。`pr-status-sync` 只依据 TFS 实际可观测的 PR `status` 检测终态：`completed` 表示正常完成，`abandoned` 表示当前 PR 已无法继续并进入人工决策；`active` 保持等待，未知或异常数据返回 `UNKNOWN`。

---

# 2. 总体架构

```text
                    TFS / PR Platform
                           │
                    External State Sync
                           │
                           ▼
                    Multica Runtime
                           │
                    Delivery Issue
                           │
                    Delivery Squad
                           │
                     Delivery Lead
                     （Leader）
              ┌────────────┼────────────┐
              ▼            ▼            ▼
      Workitem Analyst   Engineer    Verify Agent
              │            │          （按需）
              └────────────┼────────────┘
                           │
                 optional Sub-Issues
                           │
                           ▼
                 Development Ready
                           │
                 Verify Agent if required
                           │
                           ▼
                       PR / Completion
                           │
                           ▼
                 Deterministic Gates
                           │
                           ▼
                    Final Completion
```

---

# 3. 核心职责模型

系统分为六个核心层次。

## 3.1 Multica Runtime

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

---

## 3.2 Delivery Squad

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

Delivery Issue 默认分配给 Delivery Squad。

---

## 3.3 Delivery Lead

Delivery Lead 是 Delivery Squad 的 Leader，也是 Squad 原生的协调与路由入口。

核心定位：

> **Deterministic First，Semantic Fallback。**

Delivery Lead 的职责包括：

- 读取当前 Delivery Issue / Development Sub-Issue 的最新事实；
- 判断当前需要哪种专业能力，并通过 `@mention` 协调 Workitem Analyst、Engineer、Verify Agent；
- 多 Agent 协作优先由 Delivery Lead 组织，包括依赖顺序、并行关系、返工回流与跨角色冲突；
- 优先调用 Deterministic Route / Gate / Script 判断可程序化的下一步；
- 当确定性结果明确时，按结果执行 routing / capability dispatch，不重复进行语义判断；
- 当确定性机制返回 `UNKNOWN`、输入不足、事实冲突、责任边界不清或跨角色协作无法自动路由时，进行语义判断并决定下一步；
- 基于 Human 已批准的 Development Plan / Task Graph，决定 Multica Runtime Topology，包括：
  - 是否创建 Development Sub-Issue；
  - 创建几个 Development Sub-Issue；
  - 是否需要 Stage；
  - 各 Unit 由哪个 Specialist 参与；
  - Specialist 的 `@mention` 顺序与协作方式；
- 当 Development Plan / Role / Dependency / Verification Boundary 存在歧义，或执行期间事实发生变化时，进行运行时语义协调，必要时返回 Workitem Analyst / Human；
- 读取 Human 已批准的 Verify Agent Recommendation，并协调 Verify Agent 的启动与结果回流；
- 在 PR / Completion 等确定性机制无法安全推进时介入处理；
- 在需要 Human Decision 时停止自动推进并请求人工。

Delivery Lead 不负责：

- 替代 Workitem Analyst 完整执行 Requirement / Bug Analysis；
- 替代 Engineer 编写生产代码、执行正式 Local Validation 或 Code Review；
- 替代 Verify Agent 完成 Acceptance Verification；
- 替代 Human Approval / Business Decision；
- 覆盖明确的 Deterministic Gate `FAIL`；
- 在确定性 Route 已给出可靠结果时重新发明第二套 Workflow。

Delivery Lead 可以进行语义判断，但语义判断主要解决：

```text
当前事实意味着什么？
下一步需要哪种专业能力？
Runtime Topology 应如何组织？
应该协调哪个 Agent / Human？
跨角色冲突如何处理？
```

而不是替代 Specialist Agent 完成其专业工作。

Delivery Lead 每次 Run 应保持短生命周期：

```text
读取当前事实
    ↓
优先调用 Deterministic Route / Gate
    ↓
├─ 结果明确
│    → @对应成员 / 调用确定性 capability
│    → 结束 Run
│
└─ UNKNOWN / 冲突 / 歧义
     → Delivery Lead 语义判断
     → @对应成员 / 请求 Human
     → 结束 Run
```

不长期驻留等待其他 Agent。

---

## 3.4 Specialist Agent

专业 Agent 负责具体工作。

```text
Workitem Analyst
    = 需求 / Bug 分析
    = 定义 Acceptance Criteria / Verification Requirements
    = 提出 Verify Agent Required / Not Required

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

专业 Agent 不承担整个研发流程的全局编排。

---

## 3.5 Deterministic Gate

负责程序化、确定性的判断。

包括：

```text
Analysis Gate
Task Graph Gate
Development Readiness Check
Verification Gate（仅 Verify Agent required 时）
PR Transition Gate
Delivery Completion Gate
```

统一返回：

```yaml
result: PASS | FAIL | UNKNOWN
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

Development Readiness = NOT_READY
→ 等待其他 required Development Unit

Verification Gate FAIL
→ Engineer targeted rework

PR Transition Gate FAIL
→ 等待或补齐缺失条件

Delivery Completion Gate FAIL
→ 不允许关闭
```

Agent 不允许覆盖一个明确的 Gate `FAIL`。

---

## 3.6 External State Sync

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

External State Sync 只负责识别、校验、持久化并回流这些外部事实，不推断 `abandoned` 的业务原因。`REJECTED / DISCARDED` 只属于后续 Human Decision，不属于 TFS 同步事实。

---

# 4. Issue 模型

采用：

> **Deliverable-oriented Issue Model**

而不是按流程阶段拆 Issue。

默认只有：

```text
Delivery Issue
```

简单任务：

```text
Delivery Issue
└── 无 Sub-Issue
```

复杂任务：

```text
Delivery Issue
│
├── Backend Delivery
├── Frontend Delivery
└── Flink Delivery
```

不默认创建：

```text
Analysis Issue
Verify Issue
PR Issue
Integration Verify Issue
```

角色变化不等于新的 Issue。

---

# 5. TFS Sync

TFS Sync 由 Multica Autopilot 触发，采用 **Thin Agent Adapter + Deterministic Script**：

```text
Multica Autopilot
      ↓
TFS Sync Agent（Thin Adapter）
      ↓
tfs-sync deterministic script
      ↓
Structured Result
      ↓
END
```

TFS Sync Agent 不自行做同步业务判断，主要负责调用确定性能力并返回结果。

确定性同步负责：

1. 查询符合条件的 TFS Work Item；
2. 创建对应 Delivery Issue；
3. 写入 TFS 原始上下文；
4. 设置：
   - assignee = Delivery Squad
   - status = backlog
5. 保持同步幂等；
6. 已存在 Issue 时只更新 TFS 管理字段；
7. 不修改已有 Issue 的执行状态和负责人；
8. 不主动启动研发。

推荐 metadata：

```yaml
source: tfs
tfs.id: "<work-item-id>"
tfs.type: "<Requirement|Bug>"
tfs.url: "<url>"
tfs.changed_at: "<changed-date>"
```

当人工确认任务可以执行时：

```text
backlog → todo
```

因为 Delivery Issue 由 Delivery Squad 持有，Multica 按 Squad 原生机制启动 Delivery Lead。

---

# 6. Delivery Issue 启动

Delivery Issue 进入 `todo` 后：

```text
Delivery Issue
assignee = Delivery Squad
        ↓
Multica 启动 Delivery Lead
        ↓
Delivery Lead 调用 start-analysis route
```

`start-analysis.py` 只负责确定性判断，例如：

```text
status = todo
+ Analysis 尚未完成
+ 必要 TFS Context 存在
→ START_ANALYSIS

缺少可恢复的确定性前置条件
→ FAIL

当前事实无法可靠解释
→ UNKNOWN
```

处理：

```text
START_ANALYSIS
→ Delivery Lead @Workitem Analyst
→ 结束 Run

FAIL
→ 按明确原因等待 / 修复

UNKNOWN
→ Delivery Lead 读取：
   - TFS Context
   - Issue Metadata
   - Comments
   - Existing Artifacts
→ 进行语义判断
→ @对应 Specialist / 请求 Human
```

因此仍保留 Squad 原生 Leader 入口，但不让 Delivery Lead 对明显的初始路由重复思考。

---

## 6.1 Delivery Issue 状态模型

当前 Delivery 生命周期使用 Multica Issue Status 作为面向人的主要可见状态。

推荐核心状态：

```text
backlog
→ todo
→ in_progress
→ analys_review          # Display Name: Analysis Review
→ in_progress
→ in_review            # PR 已提交，等待 TFS 终态；abandoned 时进入 blocked
→ done
```

其中：

```text
analys_review
```

是正式 Status Key，Display Name 为 `Analysis Review`，category=`started`，用于正常的 Analysis Human Gate。

```text
blocked
```

只表示真实阻塞，不用于正常审核等待。

Issue Status 与 Agent Run 生命周期分离；Run 完成不等于 Issue 自动完成。

---

# 7. Analysis

Analysis 在当前 Delivery Issue 内完成，不默认创建 Analysis Child Issue。

Delivery Issue 在 Analysis 执行期间：

```text
assignee = Delivery Squad
status   = in_progress
```

Workitem Analyst 不直接根据 TFS `Bug / Requirement` 二分专业方法，而是结合 TFS 管理类型与技术变更语义进行路由：

```text
TFS Bug
→ bug-fix
→ bug-analysis

TFS Requirement + Corrective Change
→ production-fix
→ bug-analysis

TFS Requirement + Intentional Change
→ sdd-fast
→ requirement-analysis
→ spec-preparation
→ requirement-review

Large / New Major Module
→ sdd-standard / Human
→ 当前版本不自动推进
```

其中：

```text
TFS Type
= 公司管理事实，不由 Agent 修改

Change Kind
= Workitem Analyst 的技术语义判断

Route
= 分析 / 研发方法选择
```

Repository 数量不决定 Route；`bug-fix`、`production-fix`、`sdd-fast` 均允许跨 Repository。

Analysis Package 根据 Route 至少包含：

```text
Context Pack
Problem / Requirement
Current Behavior
Expected Behavior
Root Cause（Corrective）
Solution / Fix Strategy
Impact / Fix Scope
Repository Scope
Acceptance Criteria
Verification Requirements
Development Plan / Task Graph
Risks
Open Decisions
Verify Agent Recommendation
```

其中 **Development Plan / Task Graph** 是 Workitem Analyst 对“技术上如何拆解交付”的建议，不等于最终 Multica Runtime Topology。

推荐结构：

```yaml
development_plan:
  units:
    - id: DEV-Backend
      goal: ...
      role_requirement: backend
      repository_scope:
        - ...
      dependencies: []
      acceptance_criteria:
        - AC-01
      verification_boundary: ...
```

Workitem Analyst 负责回答：

```text
有哪些候选 Development Units？
每个 Unit 的目标与 Repository Scope 是什么？
依赖关系是什么？
需要什么 Role / 专业能力？
每个 Unit 的 Acceptance / Verification Boundary 是什么？
```

Delivery Lead 在 Human Review 通过后，基于该 Plan 决定最终 Runtime Topology：

```text
是否创建 Development Sub-Issue
创建几个 Sub-Issue
是否需要 Stage
如何 @mention Specialist
运行时协作顺序
```

`Verify Agent Recommendation` 至少明确：

```yaml
verify_agent:
  recommendation: required | not_required
  reason: ...
  verification_focus:
    - AC-...
    - ...
```

判断不按 Route 预设默认结果。Workitem Analyst 根据 Acceptance Criteria、Verification Requirements、Development Plan、跨系统行为和可验证性给出推荐。

典型判断：

```text
范围小、行为单一、已有可靠 Regression / Runtime Feedback、
Engineer 的 Local Validation + Code Review 可以充分闭合验收目标
→ 推荐 NOT REQUIRED

多个关键 Acceptance Criteria、多个 Development Unit 共同形成最终行为、
跨系统 / Contract / Event / Schema、复杂状态流、
或需要 Runtime / Integration / E2E 行为验收
→ 推荐 REQUIRED
```

因此 `bug-fix`、`production-fix`、`sdd-fast` 都可能得到 `REQUIRED` 或 `NOT REQUIRED`。

`sdd-fast` 额外按需要包含：

```text
proposal.md
spec / delta spec
tasks.md
design.md（按需）
requirement-review
```

Workitem Analyst 最终 Summary 必须显式打印：

```text
Development Plan: ...
Verify Agent Recommendation: REQUIRED | NOT REQUIRED
Reason: ...
Verification Focus: ...
```

分析结果通过 Artifact / Comment 写回 Delivery Issue。

---

# 8. Analysis Deterministic Gate

Workitem Analyst 完成后执行 Analysis Gate。

Gate 根据当前 Analysis Route 检查必需产物，不负责判断业务语义正确性。

通用检查包括：

```text
Context 是否存在
Repository Scope 是否存在
Acceptance Criteria / Verification Requirements 是否满足当前 Route 要求
required artifact 是否存在
Verify Agent Recommendation 是否存在
无 unresolved blocker
```

Corrective Change：

```text
Root Cause Status
Fix Strategy
Fix Scope
Repository Scope
Verification Requirements
```

SDD-fast：

```text
Requirement Analysis
proposal.md
tasks.md
spec-required 时 spec 存在
design-required 时 design 存在
requirement-review APPROVED
Acceptance Criteria
Verification Requirements
```

统一结果：

```yaml
result: PASS | FAIL | UNKNOWN
reasons:
  - ...
```

处理：

```text
FAIL
→ @Workitem Analyst
→ targeted rework

UNKNOWN
→ Delivery Lead / Human

PASS
→ Delivery Issue status = analys_review
→ STOP
```

`analys_review` 是 Multica Workspace 中新增的自定义 Issue Status Key；其显示名称为 `Analysis Review`：

```text
key          = analys_review
display_name = Analysis Review
category     = started
```

它用于在 Board / List 中独立展示所有等待人工分析审核的 Delivery Issue。

---

# 9. Human Analysis Review

`analys_review`（Display Name：`Analysis Review`）是 Delivery Issue 的正式 Human Gate。

进入审核时：

```text
assignee = Delivery Squad
status   = analys_review
```

Human Analysis Review 审核完整 Analysis Package，包括：

```text
Requirement / Root Cause / Solution
Repository Scope
Acceptance Criteria
Verification Requirements
Development Plan / Task Graph
Verify Agent Recommendation
Risks / Open Decisions
```

不再维护第二套：

```text
analysis.review_status = waiting | approved | rejected
```

审核决策通过顶层 Comment 表达，并由 Multica Squad 原生机制唤醒 Delivery Lead。

## 9.1 Human Approve

Reviewer：

```text
APPROVED

<可选说明>
```

Delivery Lead 被唤醒后首先调用：

```text
apply-analysis-review.py
```

确定性处理：

```text
status = analys_review
+ Analysis Gate = PASS
+ latest Human Decision = APPROVED
→ APPROVED
```

然后：

```text
APPROVED
→ status = in_progress
→ 进入 Development Planning / Materialization

UNKNOWN
→ Delivery Lead 语义判断 / Human
```

Human `APPROVED` 表示接受当前 Analysis Package，包括：

```text
Development Plan / Task Graph
Verify Agent Recommendation
```

但 Human 并不是在批准最终 Multica Runtime Topology；最终 Runtime Topology 由 Delivery Lead 在物化阶段决定。

Workitem Analyst 不允许自行批准自己的 Analysis。

## 9.2 Human Reject

Reviewer：

```text
REJECTED

Reason:
- ...

Expected Change:
- ...
```

Delivery Lead 被唤醒后同样先调用：

```text
apply-analysis-review.py
```

确定性处理：

```text
REJECTED
→ status = in_progress
→ @Workitem Analyst
→ 携带 Reason / Expected Change
```

只有 Comment 无法识别、Decision 缺失或 Feedback 与当前事实冲突时返回：

```text
UNKNOWN
→ Delivery Lead 语义判断 / Human
```

Workitem Analyst 根据 Feedback Area 做 Targeted Rework：

```text
Context / Repository Evidence
→ context-analysis

Root Cause / Fix Scope
→ bug-analysis

Requirement / Solution / Impact
→ requirement-analysis

Development Plan / Dependencies / Verification Boundary
→ development planning part of workitem-analysis

Proposal / Spec / Tasks / Design
→ spec-preparation
```

修正完成后重新：

```text
analysis-completion
→ Analysis Gate
→ PASS
→ status = analys_review
→ Human Analysis Review
```

Reject 不触发整套 Analysis 无差别重跑。

## 9.3 `blocked` 的使用边界

`blocked` 不用于正常 Human Analysis Review。

只用于真正无法继续的异常，例如：

```text
关键输入缺失
外部依赖不可用
权限 / 环境问题
无法获得必要证据
无法可靠定位责任范围
多轮失败且无法自主解决
```

---

# 10. Development Planning / Materialization

Human Analysis Review APPROVED 后，Delivery Lead 被 Squad 原生机制唤醒。

Delivery Lead 读取已批准的：

```text
TFS Type
Analysis Route
Development Scope
Development Plan / Task Graph
Repository Scope
Role Requirements
Dependencies
Acceptance Criteria
Verification Requirements
verify_agent.recommendation
verify_agent.reason
verify_agent.verification_focus
```

职责边界：

```text
Workitem Analyst
= Development Plan / Task Graph 的专业分析 Owner

Human
= 对 Analysis Package / Development Plan 的 Review Owner

Delivery Lead
= 最终 Multica Runtime Topology / Collaboration Decision Owner

Script
= 可确定的 Materialization / Mapping / State Mutation
```

Delivery Lead 首先调用 `materialize-development.py`。

脚本负责可确定部分：

```text
validate approved Development Plan
Role Requirement → known Specialist mapping
Recommendation → verify_agent.required
创建已被 Runtime Topology 明确要求的 Sub-Issue
写入 Parent / Child 关系
写入 Stage / Dependency（如明确）
创建 TFS Task（如规则要求）
设置 assignee = Delivery Squad
```

最终 Runtime Topology 的决定原则：

```text
是否存在多个真正可以独立拥有、
独立推进、
独立验证边界、
独立失败 / 重试、
独立完成的 Development Unit
```

同时：

```text
跨 Repository
≠
必须拆 Development Sub-Issue
```

Delivery Lead 处理：

```text
确定性规则足够
→ 按规则决定 Simple / Complex
→ 调用 materialize-development.py

Topology / Role / Dependency / Verification Boundary 存在歧义
或执行时事实与 Approved Plan 不一致
→ Delivery Lead Semantic Decision
→ 必要时 @Workitem Analyst / Human
```

因此 Delivery Lead 不重复完整 Analysis，但保留 Runtime Topology 的最终协调与语义决策权。

Verify Recommendation 确定性转换：

```text
recommendation = REQUIRED
→ verify_agent.required = true

recommendation = NOT REQUIRED
→ verify_agent.required = false
```

如果 Recommendation 缺失或与 Approved Package 冲突：

```text
→ UNKNOWN
→ Delivery Lead 协调 Workitem Analyst / Human
```

TFS Task 创建仍只依据原始 TFS 类型：

```text
TFS Bug
→ 不创建 TFS Task

TFS Requirement
→ 按 Requirement 规则创建 TFS Task
```

`production-fix` 虽使用 `bug-analysis`，仍遵守 Requirement 的 TFS 管理规则。

---

# 11. Simple Delivery

典型条件：

```text
一个 Development Unit
一个主要 Engineer Owner
不存在多个可独立推进的研发单元
```

Simple Delivery 可以涉及一个或多个 Repository / PR；Repository 数量本身不改变 Simple / Complex 判断。

此时不创建 Development Sub-Issue。

执行：

```text
Delivery Issue
    ↓
Delivery Lead
    ↓
@对应 Engineer
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
Development Ready
    ↓
Engineer 写回 Ready Facts
    ↓
Multica / Squad 原生机制唤醒 Delivery Lead
    ↓
Delivery Lead 调用 Development Readiness Check
    ↓
├─ READY + verify_agent.required=false
│    → PR Materialization
│
├─ READY + verify_agent.required=true
│    → @Verify Agent
│
└─ UNKNOWN / 冲突
     → Delivery Lead 语义判断
```

如果 Verify Agent required：

```text
Verify Agent
    ↓
Acceptance Verification
    ↓
写回 Verification Result
    ↓
Delivery Lead 被唤醒
    ↓
Verification Gate / Route
    ↓
├─ PASS → PR Materialization
├─ FAIL → @对应 Engineer 做 Targeted Rework
└─ UNKNOWN → Delivery Lead 语义判断 / Human
```

所有 required PR 注册完成后：

```text
Issue → in_review
```

这里保留 Delivery Lead 作为 Squad 协调入口，但 Happy Path 中首先依赖确定性 Route / Gate，不重复专业 Agent 已完成的语义判断。

---

# 12. Complex Delivery

当 Approved Development Plan 中存在多个可独立推进的 Development Unit，并且 Delivery Lead 的 Runtime Topology Decision 确认需要独立生命周期时，创建 Development Sub-Issue。

例如：

```text
Delivery Issue
assignee = Delivery Squad
│
├── DEV-Backend
│   assignee = Delivery Squad
│
├── DEV-Frontend
│   assignee = Delivery Squad
│
└── DEV-Flink
    assignee = Delivery Squad
```

每个 Development Sub-Issue 保存：

```text
Goal
Repository Scope
Relevant Analysis
Acceptance Criteria
Dependencies
Contracts
Verification Requirements
Role Requirement
```

**Development Sub-Issue 始终保持 Squad-owned。**

专业 Agent 不成为 Sub-Issue 的长期 assignee，而由 Delivery Lead 通过 `@mention` 协调：

```text
DEV-Backend / Delivery Squad
        ↓
Delivery Lead
        ↓
@Backend Engineer
        ↓
Backend Engineer Run
        ↓
Development Ready / Progress Update
        ↓
Multica 原生再次唤醒 Delivery Lead
```

因此不需要人为设计额外的：

```text
@Delivery Squad 回流父级
```

成员更新 → Leader 再协调，直接复用 Multica Squad 原生循环。

每个 Development Unit 的 Engineer：

```text
Implementation
→ Local Validation
→ Code Review
→ Commit / Push
→ PR Preparation
→ Development Ready
→ 写回 Ready Facts / Progress
```

Delivery Lead 被成员更新唤醒后调用：

```text
check-development-readiness.py
```

该脚本基于 Parent Delivery / required Sub-Issue Facts 聚合：

```text
NOT_READY
READY
UNKNOWN
```

处理：

```text
NOT_READY
→ 还有 required Unit 未完成
→ Lead 不做重复语义推理
→ 结束 Run

READY + verify_agent.required=true
→ Delivery Lead @Verify Agent

READY + verify_agent.required=false
→ Delivery Lead 调用 PR Materialization

UNKNOWN
→ Delivery Lead 语义判断
→ 协调 Engineer / Analyst / Verify / Human
```

`Development Ready` 是 Fact，不新增 Issue Status。

---

# 13. Development Sub-Issue 分配

所有 Development Sub-Issue：

```text
assignee = Delivery Squad
```

不直接把 Sub-Issue 的长期 assignee 改成 Specialist Agent。

Delivery Lead 根据 Runtime Topology 通过 `@mention` 指定当前工作的 Specialist：

```text
role_requirement = backend
→ @Backend Engineer

role_requirement = frontend
→ @Frontend Engineer

role_requirement = flink
→ @Flink Engineer
```

如果工作需要多个专业角色：

```text
Delivery Lead
→ 按依赖 / 协作顺序依次或并行 @mention
```

原则：

```text
Issue Ownership
= Delivery Squad

Professional Execution
= Specialist Agent via @mention

Coordination / Routing
= Delivery Lead
```

这样每个 Sub-Issue 都保持：

```text
Leader
→ Member
→ Leader
```

的 Multica Squad 原生协作循环。

---

# 14. Stage

Stage 只用于真正 Development Units 之间的依赖关系。

例如：

```text
DEV-Backend
    ↓
DEV-Frontend
DEV-Flink
```

可以表示为：

```text
Stage 1
└── DEV-Backend

Stage 2
├── DEV-Frontend
└── DEV-Flink
```

不要使用 Stage 表达：

```text
Analysis
→ Development
→ Verify
→ PR
```

这些属于一个 Delivery 生命周期中的角色协作。

---

# 15. Engineer Execution

各专业 Engineer 负责当前 Development Unit 的完整 Development Contract。

必须包含：

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
Acceptance Criteria Coverage
Scope Drift
Repository Standards
Complexity
Contract Risk
Test Quality
Regression Risk
```

Code Review 可以由 Engineer 自检、read-only reviewer subagent 或独立 review Skill 承担，不形成新的隐藏 Development Owner。

Engineer 完成后输出 Development Evidence：

```text
Development Ready
```

至少表示：

```text
[ ] Implementation Complete
[ ] Required Local Validation PASS
[ ] Code Review PASS
[ ] Review Findings 已处理
[ ] Development Evidence 完整
[ ] Commit / Push 完成
[ ] PR Preparation 完整
[ ] 无 Development blocker
```

PR Preparation 至少包含：

```text
Repository / Repository ID
Source Branch
Target Branch
Candidate Commit
PR Title
PR Description / Description Reference
TFS Work Item / Delivery Issue 关联信息
```

Engineer 的职责到：

```text
产生当前 Unit 的 Development Ready Facts
+ 写回 Development Evidence
+ 在当前 Squad-owned Issue / Sub-Issue 中更新 Progress / Result
```

为止。

Engineer 不负责：

```text
聚合整个 Delivery 的 Ready 状态
决定最终 Runtime Topology
决定下一专业 Agent
```

由于当前 Issue / Sub-Issue 都由 Delivery Squad 持有，Engineer 的 Progress / Result Update 复用 Multica Squad 原生机制重新唤醒 Delivery Lead：

```text
Engineer Result
→ Delivery Lead
→ Development Readiness Check
→ deterministic result
→ @mention / capability dispatch
```

若 Check 返回 `UNKNOWN` 或 Facts 冲突，Delivery Lead 再进行语义协调。

---

# 16. Verify Agent

Verify Agent 是按需参与的 **Delivery-level、behavior-oriented 独立验收者**。

核心原则：

> **Verify Agent 不依赖 Engineer 的实现过程，从 Acceptance Criteria / Verification Requirements 出发，独立验证最终交付行为确实成立。**

Verify Agent 不承担：

```text
Implementation Code Review
Repository Style Review
类 / 函数拆分评价
实现是否优雅
替代 Engineer 的 Local Validation
替代 Engineer 修复代码
```

Verify Agent 关注：

```text
Acceptance Criteria
Verification Requirements
用户可观察行为
API / Runtime Behavior
Contract Behavior
Cross-Repository Behavior
Integration Behavior
E2E Behavior
```

Integration / E2E 不再是独立 Post-Merge Stage，而只是 Verify Agent 根据当前 Verification Requirements 选择的验证方式。

## 16.1 是否需要 Verify Agent

由 Workitem Analyst 在 Analysis Package 中提出：

```yaml
verify_agent:
  recommendation: required | not_required
  reason: ...
  verification_focus:
    - ...
```

Human Analysis Review 对该 Recommendation 一并审核。Human `APPROVED` 后确定性物化为：

```text
verify_agent.required = true | false
```

判断原则不按 `bug-fix / production-fix / sdd-fast` 预设默认值，而是回答：

> **当前交付是否值得增加一个独立于实现者、从 Acceptance Criteria / Verification Requirements 出发的 behavior-oriented 验收视角？**

## 16.2 Verify 输入

Verify Agent 开始前必须满足：

```text
所有 required Development Units = Development Ready
Acceptance Criteria 可读取
Verification Requirements 可读取
verify_agent.required = true
所有待验证 Repository 的 Branch / Commit SHA 已固定
```

Verify Agent 基于明确的候选代码版本验证，不依赖 PR 已经创建。

## 16.3 Integration / E2E Verification

当最终 AC 需要多个 Development Unit 组合后才能验证时，Verify Agent 可以构造临时 Verification Workspace / Environment：

```text
Required Branch / Commit Set
        ↓
Temporary Verification Workspace
        ↓
Runtime / Integration / E2E Scenario
        ↓
Behavior Evidence
```

该过程不是正式 Merge，不改变目标分支，不创建额外 Delivery Stage。

## 16.4 Verify PASS

Verify Agent 输出结构化 Verification Report：

```yaml
verification:
  result: PASS
  verified_commits:
    - repository: ...
      commit: ...
  acceptance_coverage:
    AC-01: PASS
    AC-02: PASS
  evidence:
    - ...
```

Verify Agent 写回结果后，由 Squad 原生机制让 Delivery Lead 继续协调。

Delivery Lead 首先调用 Verification Gate：

```text
verify_agent.required = true
+ Verification Report.result = PASS
+ verified commit set 与当前候选 commit set 一致
+ required AC / Verification Requirements 已覆盖
```

处理：

```text
PASS
→ Delivery Lead 调用 PR Materialization

FAIL
→ 按 Finding 中明确的 Development Unit 进行确定性路由
→ @对应 Engineer

UNKNOWN
→ Delivery Lead 进行语义判断
→ 必要时 @Engineer / @Workitem Analyst / Human
```

## 16.5 Verify FAIL / UNKNOWN

Verify Agent 对 Finding 负责做专业语义归因，尽量输出：

```yaml
issues:
  - id: VERIFY-001
    development_unit: DEV-Backend
    description: ...
    evidence: ...
```

当 `development_unit` 明确时：

```text
Development Unit → Engineer
```

由确定性 Route 完成，Delivery Lead 只负责 `@mention` 协调。

如果 Finding 无法可靠归因、涉及多个 Unit 冲突或可能推翻 Analysis：

```text
Deterministic Route → UNKNOWN
↓
Delivery Lead 语义判断
↓
决定：
- @对应 Engineer
- @Workitem Analyst
- 多 Agent 协作
- Human
```

Engineer 修复后重新：

```text
Local Validation
→ Code Review
→ Commit / Push
→ Development Ready
→ 回到 Squad 协调
```

如果代码 Commit Set 变化，旧 Verify PASS 自动失效。

---

# 17. PR Preparation / Materialization 与映射

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

## 17.1 PR Preparation

Engineer 在进入 `Development Ready` 前完成：

```text
Local Validation PASS
Code Review PASS
Commit / Push
PR Preparation
```

每个 required Repository Change 至少准备：

```yaml
repository: ...
repository_id: ...
source_branch: ...
target_branch: ...
candidate_commit: ...
pr:
  title: ...
  description: ...
  ready: true
```

PR Title / Description 属于 Engineer 对本次代码修改的语义准备。

## 17.2 PR Materialization

当满足：

```text
所有 required Development Units Ready
+ verify_agent.required = false
```

或：

```text
所有 required Development Units Ready
+ verify_agent.required = true
+ Verification Gate PASS
```

Delivery Lead 在当前协调 Run 中调用确定性的 `pull-request` capability。

标准过程：

```text
读取 PR Preparation Facts
↓
逐仓校验 Repository / Branch / Candidate Commit
↓
确认 Branch HEAD 与 candidate_commit 一致
↓
调用 TFS / PR API
↓
校验返回身份
↓
写回 current_pr
↓
全部 required PR 注册完成
↓
Issue → in_review
```

PR Materialization 必须幂等；多个 Repository 可以一次处理，失败重试只补未完成项。

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

一个 Delivery Issue / Development Sub-Issue 可以关联多个 Repository Change；每个 Repository Change 保存一个当前 required PR。

所有 required PR 成功登记后才进入：

```text
in_review
```

---

# 18. PR Status Sync

PR 审核发生在 TFS / PR Platform。Multica 不复制审核过程；`pr-status-sync` 只读取已登记的 current required PR，并依据 provider `status` 做确定性终态检测。

运行模型：

```text
Multica Autopilot
      ↓
PR Status Sync Agent（Thin Adapter）
      ↓
reconcile-pr-status.py
      ↓
Structured Result
```

Thin Agent 不自行解释 PR 业务含义，只调用确定性脚本并应用结构化结果。

查询：

```text
status = in_review
或 current_pr.sync.pending_event exists
```

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

否则全部 current_pr = completed
→ Completion

否则
→ NO-OP
```

## 18.1 普通审核过程

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

## 18.2 PR Abandoned

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
Issue.status = blocked
↓
assignee = Delivery Squad
↓
STOP，等待 Human Decision
```

机器不推断 abandoned 的业务原因。

Human 顶层 Comment 必须明确：

```text
Reason:
- REJECTED | DISCARDED

NEXT:
- ANALYSIS
- ENGINEERING
- RECREATE_PR
- CANCEL_DELIVERY
```

因为 Issue 是 Squad-owned，Human Comment 按 Multica 原生机制唤醒 Delivery Lead。

Delivery Lead 首先调用：

```text
route-human-decision.py
```

确定性路由：

```text
NEXT = ANALYSIS
→ status = in_progress
→ @Workitem Analyst

NEXT = ENGINEERING
+ affected Development Unit 唯一明确
→ status = in_progress
→ @对应 Engineer

NEXT = RECREATE_PR
+ Candidate Commit Set 未变化
→ PR Materialization

NEXT = RECREATE_PR
+ Candidate Commit Set 已变化
→ @对应 Engineer

NEXT = CANCEL_DELIVERY
→ Cancellation Handler / Policy
```

如果：

```text
NEXT 缺失
affected Unit 不唯一
事实冲突
无法可靠判断 Commit Set 是否可沿用
Human Decision 与当前状态不一致
```

则：

```text
route-human-decision.py → UNKNOWN
↓
Delivery Lead Semantic Decision
↓
@对应 Specialist / 请求 Human
```

若回 ANALYSIS，新 Analysis 再次通过 Human Review 后，以新的 Analysis Package / Development Plan / Verify Recommendation 为准。

若回 ENGINEERING，Engineer 修复后重新 Local Validation / Code Review / Commit / Push / Development Ready；如 Verify required 且 Commit Set 变化，旧 Verify PASS 失效。

## 18.3 PR Completed

只有：

```text
provider_status = completed
```

才表示单个 current PR 成功完成。

所有 required current PR 都 completed 后：

```text
PR Status Sync Run
↓
持久化 Completion Facts
↓
same-run 调用 finalize-delivery.py
```

`finalize-delivery.py`：

```text
PR Transition Check
↓
Post-Merge Workspace Reconciliation
↓
Delivery Completion Check
↓
Final Summary Render
↓
TFS Close
↓
Delivery Issue Done
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

## 18.4 幂等与恢复

每个 current PR 使用稳定 `event_key`：

```text
owner issue
repository
PR ID
provider terminal status
```

处理终态前先写：

```yaml
current_pr:
  sync:
    pending_event: abandoned | completed
    event_key: "..."
```

动作全部完成后清除 `pending_event`。

核心幂等规则：

```text
active
→ NO-OP

abandoned + same event already applied
→ NO-OP

abandoned + pending_event
→ 恢复 blocked / Delivery Squad / metadata 一致性

all current required PR completed
+ completion already finalized
→ NO-OP

all completed
+ finalize pending
→ 恢复 finalize-delivery

query / identity / schema UNKNOWN
→ 不推进、不覆盖已有可靠事实
```

PR Status Sync 不修改代码、不理解 Review 意见、不推断 abandoned 原因。

---

# 19. PR Transition Gate

PR Transition Gate 属于 `finalize-delivery` 内部的确定性检查，不要求独立 Agent Run。

推荐规则：

```python
def pr_transition_ready(ctx):
    acceptance_ok = (
        not ctx.verify_agent_required
        or ctx.verify_agent_pass
    )

    return (
        ctx.all_required_development_units_ready
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

Gate 本身只判断硬条件；若 `UNKNOWN` 背后需要理解跨角色事实或决定下一步专业能力，由 Delivery Lead 进行语义路由。

---

# 20. Post-Merge Workspace Reconciliation

PR Transition Gate PASS 后，由 `finalize-delivery` 执行 Merge 后本地工作区对齐：

```text
For each required Repository:
    git fetch --prune origin
    git switch <target_branch>
    git pull --ff-only origin <target_branch>
```

如果远程 Source Branch 已删除，本地 Source Branch 可按团队策略安全清理：

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

Merge 后不再自动执行 Integration Verify。后续 QA / 测试发现的新问题形成新的 TFS Work Item / Delivery。

---

# 21. Delivery Completion Gate

Delivery Completion Gate 属于 `finalize-delivery` 内部确定性检查。

关闭 Delivery Issue 前确认：

```text
[ ] Analysis Gate PASS
[ ] Human Analysis Review 已批准
[ ] 所有 required Development Units = Development Ready
[ ] 所有 Development Units Local Validation PASS
[ ] 所有 Development Units Code Review PASS
[ ] verify_agent.required=false，或 Verify Agent PASS
[ ] Verify PASS 对应当前候选 Commit Set（如果 required）
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

# 22. Final Completion

Completion Gate PASS 后，`finalize-delivery` 继续：

```text
Render Final Delivery Summary
↓
归档当前 Route 要求的产物
↓
更新 TFS Work Item
↓
记录 PR / Verify 结果
↓
Delivery Issue → done
```

Final Delivery Summary 默认由结构化 Facts 模板化生成，不依赖 LLM。

如果最终关闭需要处理未建模的业务语义、外部冲突或不明确状态：

```text
finalize-delivery → UNKNOWN
→ Delivery Lead
```

当前方案不默认增加 Final Human Confirmation。

`in_review` 专门表示：

```text
所有 required PR 已创建
→ 等待 TFS PR completed / abandoned
```

---

# 23. Agent / Squad / Skill 边界

## Agent Instructions

定义：

```text
这个 Agent 是谁
负责什么
不负责什么
长期决策原则
升级条件
交付要求
```

## Squad Instructions

定义：

```text
成员如何协作
什么时候交给哪个角色
什么时候等待人工
什么时候创建独立 Sub-Issue
什么时候升级 Delivery Lead
什么时候进入 Completion
```

Squad Instructions 描述协作与路由，不描述专业工作的详细做法。

## Skill

定义：

```text
某类事情具体怎么做
```

例如：

```text
requirement-analysis
bug-analysis
backend-development
acceptance-verification
pull-request
pr-status-sync
task-close
```

## Deterministic Script

定义：

```text
硬条件
Schema 校验
状态 Guard
Completion Check
明确的机器路由
```

---

# 24. 推荐 Agent × Skill

| Agent | Squad Role | 主要 Skill |
|---|---|---|
| Delivery Lead | Leader | delivery-flow / delivery-gate / development-task-materialization / pull-request / task-close |
| Workitem Analyst | Member | workitem-analysis / requirement-analysis / bug-analysis / analysis-completion |
| Backend Engineer | Member | development-execution / backend-engineering |
| Frontend Engineer | Member | development-execution / frontend-engineering |
| Flink Engineer | Member | development-execution / flink-engineering |
| Verify Agent | Member | acceptance-verification |
| TFS Sync Agent | Squad 外 Thin Adapter | tfs-sync |
| PR Status Sync Agent | Squad 外 Thin Adapter | pr-status-sync |

说明：

- Delivery Lead 是 Runtime Topology / 多 Agent 协调 Owner，优先消费确定性 Route / Gate；`UNKNOWN` 时做语义判断。
- Workitem Analyst 输出 Development Plan / Task Graph，但不直接拥有最终 Multica Runtime Topology。
- Development Issue / Sub-Issue 均保持 Delivery Squad-owned，Specialist 通过 `@mention` 工作。
- TFS Sync / PR Status Sync Agent 作为 Multica Autopilot 的 Thin Adapter；真正同步与 reconcile 逻辑放在确定性脚本中。
- Code Review 属于 Engineer Development 内部机制。
- `pull-request` 的 PR Materialization 是确定性副作用；由 Delivery Lead 在 Gate 满足后调用，不意味着 Delivery Lead 负责 PR 语义。

---

# 25. 推荐 Skill 目录

```text
workspace-skills/
│
├── tfs-sync/
│   ├── SKILL.md
│   └── scripts/
│       └── reconcile-workitem.py
│
├── workitem-analysis/
├── requirement-analysis/
├── bug-analysis/
├── analysis-completion/
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
│   │   ├── start-analysis.py
│   │   ├── apply-analysis-review.py
│   │   ├── materialize-development.py
│   │   ├── check-development-readiness.py
│   │   ├── route-verify-result.py
│   │   ├── route-human-decision.py
│   │   └── finalize-delivery.py
│   └── references/
│
├── delivery-gate/
│   ├── SKILL.md
│   ├── scripts/
│   │   ├── validate-analysis.py
│   │   ├── validate-task-graph.py
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
= 确定性 routing / materialization / finalize

delivery-gate
= 硬条件检查

Delivery Lead
= Runtime Topology / Coordination Owner
+ 调用确定性 capability
+ UNKNOWN 时做语义判断

Sync Agent
= Thin Adapter

Specialist
= 专业语义工作
```

不建设额外的全局 Workflow Runner。

---

# 26. 状态与事实来源

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

对于 Development / Delivery Verification，建议保存最小事实：

```yaml
development:
  result: ready | blocked | unknown
  local_validation: pass | fail | unknown
  code_review: pass | fail | unknown
  candidate_commits:
    - repository: ...
      commit: ...
  evidence_ref: ...

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
development.result = ready
= Engineer Development Contract 已完成
= Local Validation PASS + Code Review PASS + Commit / Push + PR Preparation + Evidence 完整

verify_agent.recommendation
= Workitem Analyst 提出的分析建议

verify_agent.required
= Human Analysis Review APPROVED 后由 Development Materialization 从已批准 Recommendation 确定性生成的执行事实

verification.result / verified_commits
= Verify Agent / Verification Gate 的执行事实（仅 required=true 时）
```

`Development Ready`、Verify 结果均作为 Fact / Evidence 保存，不新增额外 Issue Status。

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

# 27. Deterministic Decision 与 Semantic Decision

## Deterministic Decision

满足：

```text
输入明确
规则明确
结果有限
可以程序化
```

的逻辑统一交给：

```text
Script
Gate
Route
Guard
API State
```

包括：

```text
必填字段是否存在
Task Graph 是否合法
depends_on 是否有效
是否存在 cycle
Recommendation → verify_agent.required
已明确 Role Requirement → Specialist Mapping
Development Ready Facts 聚合
Verify PASS 是否对应当前 Commit Set
Finding 中已明确 Development Unit → Engineer 映射
PR Preparation 必填 Facts
Branch HEAD / candidate_commit 校验
PR Materialization
PR status active / completed / abandoned
PR 幂等 / pending event 恢复
Human NEXT 的明确路由
PR Transition
Workspace Reconciliation 的安全检查
Delivery Completion
TFS Close / Issue Done
```

正式原则：

> **能确定性化的业务规则、Gate、副作用、幂等和物化全部进入 Script；不要让 Agent 重复思考。**

## Semantic Decision

### Workitem Analyst

负责专业 Analysis 语义：

```text
Corrective / Intentional
Root Cause
Requirement / Solution
Repository Scope
Development Plan / Task Graph
候选 Development Units
Dependencies
Role Requirements
Verification Boundary
Verify Agent Recommendation
Verification Focus
```

### Delivery Lead

负责 Runtime / 协作语义：

```text
最终 Multica Runtime Topology
是否创建 Development Sub-Issue
是否需要 Stage
多个 Unit / Agent 如何组织
Deterministic Route = UNKNOWN 时下一步需要哪种专业能力
事实冲突时应该找谁澄清
跨 Development Unit 的协作与顺序
Finding 无法自动归因时如何协调
当前结果是否需要 Human Decision
```

Delivery Lead 的语义判断是系统设计的一部分，不应被删除。

### Engineer

负责工程实现语义：

```text
Implementation Detail
局部设计与重构
测试策略
Code Review 判断
代码修复
```

### Verify Agent

负责验收语义：

```text
Acceptance Criteria 是否实际满足
Behavior / Runtime / Integration / E2E Evidence
Finding 的专业归因
```

### Human

负责：

```text
Analysis Approval / Rejection
对 Development Plan / Task Graph 的 Review
abandoned 的业务含义
ANALYSIS / ENGINEERING / RECREATE_PR / CANCEL_DELIVERY
其他明确要求人工批准的决策
```

统一原则：

```text
Deterministic result available
→ Delivery Lead 按结果 routing / dispatch
→ 不重复思考

Deterministic result unavailable / UNKNOWN / conflict
→ Delivery Lead Semantic Decision
→ @对应 Specialist / Human
```

专业 Agent 负责各自领域语义；Delivery Lead 负责跨角色与 Runtime Topology 语义。

---

# 28. 反馈循环保护

Development 内部反馈循环：

```text
Engineer
→ Local Validation
→ Code Review
→ Finding
→ Targeted Fix
→ Local Validation
→ Code Review
```

Verify Agent required 时：

```text
Engineer(s) Development Ready
↔
Verify Agent Acceptance Verification
```

如果：

```text
verification_round >= 3
AND
同类 blocker 重复
```

则：

```text
Issue → blocked
      ↓
@Delivery Squad
      ↓
Delivery Lead
      ↓
Semantic Diagnosis / Human Escalation
```

不得无限 Engineer ↔ Verify 循环。

---

# 29. 最终执行模型

## 简单 Corrective Task

```text
TFS Sync Autopilot
 ↓
Thin TFS Sync Agent → deterministic reconcile
 ↓
Delivery Issue
assignee = Delivery Squad
 ↓
Delivery Lead
 └─ start-analysis.py
 ↓
@Workitem Analyst
 ↓
Analysis Package
+ Development Plan / Task Graph
+ Verify Recommendation
 ↓
Human Analysis Review
 ↓
Delivery Lead
 └─ apply-analysis-review.py
 ↓
Runtime Topology Decision
 └─ Simple Delivery
 ↓
@Engineer
 ↓
Implementation
→ Local Validation
→ Code Review
→ Commit / Push
→ PR Preparation
→ Development Ready
 ↓
Engineer Progress Update
 ↓
Delivery Lead
 └─ check-development-readiness.py
      ├─ READY + Verify NOT REQUIRED → PR Materialization
      ├─ READY + Verify REQUIRED → @Verify Agent
      └─ UNKNOWN → Lead Semantic Routing
 ↓
in_review
 ↓
PR Status Sync Thin Agent
 ↓
reconcile-pr-status.py
 ↓
all required PR completed
 ↓
same-run finalize-delivery.py
 ↓
TFS Done / Delivery Issue Done
```

## Complex Delivery

```text
Analysis Package
+ Development Plan / Task Graph
 ↓
Human Analysis Review
 ↓
Delivery Lead
 ↓
Runtime Topology Decision
 ↓
materialize-development.py
 ↓
Parent Delivery Issue        assignee = Delivery Squad
├─ DEV-Backend               assignee = Delivery Squad
├─ DEV-Frontend              assignee = Delivery Squad
└─ DEV-Flink                 assignee = Delivery Squad
 ↓
Delivery Lead 分别 @mention Specialist
 ↓
Engineer A / B / C
 ↓
各自在 Squad-owned Sub-Issue 更新 Result / Progress
 ↓
Multica 原生重新唤醒 Delivery Lead
 ↓
check-development-readiness.py
 ├─ NOT_READY → 结束当前 Lead Run
 ├─ READY + Verify REQUIRED → @Verify Agent
 ├─ READY + Verify NOT REQUIRED → PR Materialization
 └─ UNKNOWN → Lead Semantic Routing
 ↓
Verify Agent（如 required）
 ↓
Verification Result
 ↓
Delivery Lead
 └─ Verification Gate / route-verify-result.py
      ├─ PASS → PR Materialization
      ├─ FAIL + Unit 明确 → @对应 Engineer
      └─ UNKNOWN → Lead Semantic Routing
 ↓
Create required PR(s)
 ↓
in_review
 ↓
PR Status Sync Thin Agent
 ↓
same-run deterministic finalize
 ↓
Done
```

Verify FAIL 时，Finding 的专业归因由 Verify Agent 输出；明确的 Development Unit → Engineer 使用确定性 Route，无法可靠归因时由 Delivery Lead 协调。

Merge 后正常 QA / 测试发现的新问题形成新的 TFS Bug / Requirement。

---

# 30. 核心设计原则

> **一个 TFS Work Item 默认对应一个 Delivery Issue。**

> **Delivery Issue 与 Development Sub-Issue 均保持 Delivery Squad-owned。**

> **Delivery Lead 是 Squad 原生 Leader、Runtime Topology Owner 与多 Agent 协调入口。**

> **多 Agent 协作优先由 Delivery Lead 通过 `@mention` 协调。**

> **Workitem Analyst 输出 Development Plan / Task Graph；Delivery Lead 基于批准后的 Plan 决定最终 Multica Runtime Topology。**

> **Deterministic First，Semantic Fallback：能由明确规则判断的 routing / Gate / materialization / side effect / idempotency / completion 全部进入 Script；确定性机制无法可靠决定时，由 Delivery Lead 做语义路由与协调。**

> **Delivery Lead 的语义职责不能被删除：它负责 Runtime Topology、当前需要哪种专业能力、应该协调谁、跨角色冲突怎么处理；但不替代 Workitem Analyst、Engineer、Verify Agent 的专业工作。**

> **Local Validation + Code Review 是 Development 必备环节，与 Verify Agent 是否参与无关。**

> **Code Review = implementation-oriented；Verify Agent = behavior-oriented。**

> **Verify Agent 是否需要由 Workitem Analyst 推荐，Human Analysis Review 确认，Delivery Lead 按批准结果协调执行。**

> **Development Readiness Check 属于 Deterministic Script；Engineer 产生 Ready Facts，Delivery Lead 调用 Check 并负责结果后的协作。**

> **PR Preparation 属于 Engineer Semantic Work；PR Materialization 属于确定性副作用。**

> **PR 是 Repository 级交付对象；每个代码变更 Repository 独立 PR。**

> **PR Completed 后优先由 PR Status Sync 当前 Run 执行 deterministic finalize；只有 `UNKNOWN`、冲突或无法安全收口时才升级 Delivery Lead。**

> **TFS Sync / PR Status Sync 保留 Multica Autopilot Agent Run，但 Agent 仅作为 Thin Adapter，确定性逻辑进入 Script。**

> **Integration / E2E Verification 是 Verify Agent 的验证方式，不是独立 Post-Merge Stage。**

> **Stage 只用于独立 Development Units 之间的依赖。**

> **External State Sync 不复制 TFS PR Review 过程；PR 自动判断只认 provider `status`。**

> **不建设第二套全局 Workflow Runtime。**

---

# 31. 架构总结

最终架构：

```text
External Systems
      │
      ▼
Autopilot + Thin Sync Agent
      │
      ▼
Deterministic Sync Script
      │
      ▼
Delivery Issue
assignee = Delivery Squad
      │
      ▼
Delivery Lead
Runtime Topology + Coordination
      │
      ├── deterministic route available
      │      → @Specialist / capability dispatch
      │
      └── UNKNOWN / conflict / ambiguity
             → Lead semantic decision
      │
      ▼
Workitem Analyst
→ Development Plan / Task Graph
      │
      ▼
Human Review
      │
      ▼
Delivery Lead
→ Runtime Topology Decision
      │
      ├── Delivery Issue
      └── Development Sub-Issue(s)
          all Squad-owned
      │
      ▼
@Engineer(s)
      │
      ▼
Development Ready Facts
      │
      ▼
Delivery Lead
→ Development Readiness Check
      │
      ├── @Verify Agent
      └── PR Materialization
      │
      ▼
PR Status Sync Thin Agent
      │
      ▼
Deterministic Finalize
      │
      ├── PASS → Done
      └── UNKNOWN → Delivery Lead
```

核心职责：

```text
Workitem Analyst
= Development Plan / Analysis Semantic Owner

Delivery Lead
= Runtime Topology Owner
+ Squad Router
+ Multi-Agent Coordinator
+ Semantic Fallback

Engineer
= Engineering Semantic Owner

Verify Agent
= Acceptance Semantic Owner

Script / Gate / Route
= Deterministic Control / Side Effect / Idempotency

Multica
= Issue / Squad / Leader / Member / Run / @mention / Status Runtime
```

这套设计保留 Multica 原生：

```text
Leader → Member → Leader
```

循环，同时让 Leader 在明确规则存在时优先消费确定性结果，而不是重复让 LLM 思考机器已经能够判断的问题。

---

# v1.4.4 变更摘要

相对 v1.4.3，本版本完成 Review P0 / P1 / P2 / P3 的收敛：

- Development Topology 调整为两层模型：
  - Workitem Analyst 输出 **Development Plan / Task Graph**；
  - Delivery Lead 拥有最终 **Multica Runtime Topology / Collaboration Decision**；
- Human Analysis Review 审核 Development Plan / Task Graph，但不直接批准最终 Runtime Topology；
- Delivery Lead 决定是否创建 Development Sub-Issue、是否需要 Stage、各 Specialist 的参与与 `@mention` 顺序；
- 所有 Development Sub-Issue 统一 `assignee = Delivery Squad`，不直接长期分配给 Specialist Agent；
- Specialist 统一通过 Delivery Lead `@mention` 工作，成员 Result / Progress Update 复用 Multica 原生机制重新唤醒 Leader；
- 不再设计额外 `@Delivery Squad` 的父级回流机制；
- `start-analysis.py` 正式接入 Delivery Issue 启动流程；
- `apply-analysis-review.py` 正式接入 Human Analysis Review 的 APPROVED / REJECTED 路径；
- `route-human-decision.py` 正式接入 PR Abandoned 后 Human `NEXT` 的确定性路由；
- `Development Completion Check` 统一更名并收敛为 `Development Readiness Check`；
- Gate `FAIL` 不再统一解释为 targeted rework，而由每个 Gate 定义 wait / rework / stop / recovery；
- TFS Sync / PR Status Sync 明确采用 **Multica Autopilot + Thin Agent Adapter + Deterministic Script**，避免为了完全无 Agent Run 再建设第二套 Runtime；
- PR Completed 后继续使用 PR Status Sync current-run 的 deterministic finalize；
- 修复重复的 `## 3.4 Specialist Agent` 标题等编辑问题；
- 两条核心原则保持不变：
  1. 能确定性化的业务规则、Gate、副作用、幂等、物化全部进入 Script；
  2. Happy Path 保留 Multica Squad 原生 Delivery Lead Run，Lead 优先使用确定性路由，确定性不足时承担完整语义协调职责。

---

# v1.4.3 变更摘要

> 本版本直接基于 `v1.4.1` 调整；此前生成的 `v1.4.2` 草案废弃，不作为本版本基线。

- 恢复并明确 Delivery Lead 的完整 Leader 定位：**Deterministic First，Semantic Fallback**；
- 保留“多 Agent 协作优先由 Delivery Lead 通过 `@mention` 协调”；
- 明确 Delivery Lead 在确定性 Route / Gate 无法可靠决定下一步、返回 `UNKNOWN`、出现事实冲突或跨角色歧义时，必须承担语义路由与协调职责；
- 区分 **专业语义工作** 与 **协调语义工作**：Workitem Analyst / Engineer / Verify Agent 负责各自专业领域，Delivery Lead 负责跨角色 routing / coordination semantic decision；
- 确定性规则、Gate、副作用、幂等、物化与完成检查继续全部下沉到 Script / Gate / Route；
- Delivery 启动与 Human Analysis Review 后保留 Squad 原生 Delivery Lead Run；Lead 优先调用确定性 route / materialization，必要时才语义判断；
- Development Readiness Check 正式定义为 Deterministic Script：Engineer 只产生 Ready Facts，Delivery Lead 被成员进展唤醒后调用 Check 并协调下一步；
- Complex Delivery 不再以“Engineer 最后一个 Ready Run 直接跨成员 dispatch”作为主路径；改为成员结果回流 Squad，由 Delivery Lead 依据 Readiness Check `@Verify Agent` 或触发 PR Materialization；
- Verify Agent 输出 Finding 的专业归因；明确 Development Unit → Engineer 的映射使用确定性 Route，无法归因时由 Delivery Lead 做语义协调；
- PR Materialization 保留确定性实现，但由 Delivery Lead 在 Ready / Verification Gate 满足后调用；不重新启动 Engineer 只为创建 PR；
- PR Completed 后继续采用 PR Status Sync same-run deterministic finalize，避免无语义价值的 Lead Run；若 Finalize 返回 `UNKNOWN` / 冲突，再升级 Delivery Lead；
- Delivery Lead 不再被定义为纯 Exception Handler，而是 **Squad Router + Semantic Coordinator + Exception Handler**。

---

# v1.4.1 变更摘要

相对 v1.4.0，本版本进一步减少 Happy Path 的 Agent Run 与 Token 开销：

- PR Materialization 改为 **same-run deterministic tail**，不再固定由 Delivery Lead 新 Run 触发；
- `verify_agent.required=false` 时，最后一个使全部 required Development Units 达到 `Development Ready` 的当前 Engineer Run 直接调用 `pull-request` capability；
- `verify_agent.required=true` 时，Verify Agent 在 Verification Gate PASS 后于当前 Run 尾部直接调用 `pull-request` capability；
- Complex Delivery 的 Specialist Agent 达到 `Development Ready` 后不再固定 `@Delivery Squad` 唤醒 Delivery Lead；改为写回 Ready Facts 并执行确定性的 Development Readiness Check；
- 尚有 Development Unit 未 Ready 时当前 Engineer Run 直接结束；当前 Run 使全部 required Units Ready 时，按 `verify_agent.required` 直接 `@Verify Agent` 或执行 PR Materialization；
- Delivery Lead 从正常 PR 创建 Happy Path 中移出，仅在 `UNKNOWN`、事实冲突、跨角色异常或无法可靠路由时介入；
- `pull-request` 改为 Engineer / Verify Agent 当前 Run 都可调用的共享确定性 capability；Delivery Lead 不再把它作为正常职责 Skill；
- PR Materialization 仍保持幂等、多 Repository 一次处理、Candidate Commit 校验与 current_pr 回填；PR Preparation 仍由 Engineer 在 Development Run 内完成；
- PR Materialization 发现需要 rebase、冲突解决、代码修改或其他 Engineering Semantic Work 时，仍定向回到对应 Engineer；纯 API / 网络 / 幂等恢复问题不启动 Agent；
- 不改变 Verify Agent 的 behavior-oriented 独立验收定位，不改变 Workitem Analyst Recommendation + Human Analysis Review 的 Verify 决策机制。

---

# v1.4.0 变更摘要

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

# v1.3.9 变更摘要

相对 v1.3.8，本版本进一步收敛 Verify Agent 决策与验证范围：

- 暂不设计“同一 Repository 多个候选 Branch 需要组合验证”的复杂场景；当前 Delivery 方案只要求 Verify Agent 基于各 required Repository 已固定的候选 Branch / Commit 执行验收；
- `bug-fix / production-fix` 不再硬编码默认 `Verify Agent: NOT REQUIRED`，`sdd-fast` 也不硬编码默认 `REQUIRED`；是否需要 Verify Agent 统一由任务的 Acceptance Criteria、Verification Requirements、Development Units、跨系统行为和可验证性决定；
- Workitem Analyst 只输出 `Verify Agent Recommendation: REQUIRED | NOT REQUIRED`、Reason 与 Verification Focus，不直接拥有最终批准权；
- Human Analysis Review 对 Recommendation 与整个 Analysis Package 一并审核；Human `APPROVED` 即表示接受该 Recommendation，不增加第二个 Verify 审批动作；
- Development Materialization 将已批准 Recommendation 确定性转换为 `verify_agent.required=true|false` 执行事实；Delivery Lead 只按批准结果执行，不重复做风险判断；
- 简单 Corrective Change 通常会推荐 `NOT REQUIRED`，但这只是常见分析结果而非 Route 默认；复杂 `bug-fix / production-fix` 同样可以推荐 `REQUIRED`；
- Workitem Analyst 最终 Summary 统一显式打印 `Verify Agent Recommendation`，用于 Human Review 时快速确认。

---

# v1.3.8 变更摘要

相对 v1.3.7，本版本重新收敛 Verify Agent 与 Development Quality Model：

- 删除 `Verification Policy = engineer | independent` 概念；Engineer Local Validation / Code Review 不再被视为 Verification Policy 的一种；
- 正式明确 **Local Validation + Code Review 是 Development 必备环节，与 Verify Agent 是否参与无关**；
- Verify Agent 收窄为 Delivery-level、behavior-oriented 独立验收者，只从 Acceptance Criteria / Verification Requirements 验证最终行为；
- `bug-fix / production-fix` 默认 `Verify Agent: NOT REQUIRED`；复杂 `sdd-fast`、跨系统行为、复杂 AC、Runtime / Integration / E2E 场景按 Analysis 决定；
- 是否需要 Verify Agent 由 Workitem Analyst 在 Analysis Package 中提出，并在最终 Summary 中显式打印；Human Analysis Review 对该结论一并确认；Delivery Lead 正常情况下只执行，不重新判断；
- Integration / E2E Verification 合并为 Verify Agent 的验证方式，删除独立 Post-Merge Integration Verify 阶段；
- Verify Agent 从“每个 Engineer 完成后参与”上移到“所有 required Development Units Ready 后按需参与”；
- Engineer 在 Development 阶段完成 Local Validation、Code Review、Commit / Push，形成固定候选 Branch / Commit Set，但暂不创建正式 PR；
- Verify Agent required 时，基于候选 Commit Set 做 Acceptance / Runtime / Integration / E2E Verification；PASS 后再由对应 Engineer 创建各 Repository PR；
- Verify FAIL 时只激活受影响 Development Unit，Engineer 修复后必须重新 Local Validation + Code Review + Commit / Push，再进入 Verify；
- PR 创建时点统一为：所有 required Development Units Ready，且 Verify Agent 不需要或 Verify PASS；所有 required PR 注册完成后才进入 `in_review`；
- Merge 后只执行 Post-Merge Workspace Reconciliation 与 Delivery Completion，不再自动做 Integration Verify；后续 QA / 测试发现的问题形成新的 TFS Work Item / Delivery；
- Verification Facts 增加候选 Commit Set / verified commit set 对齐，避免 Verify PASS 后代码变化仍沿用旧 Evidence。

---

# v1.3.7 变更摘要

相对 v1.3.6，本版本收敛 Development Verification 模型：

- 将“所有研发默认 Engineer → Verify Agent”调整为 **Verification 必须、Verify Agent 按需**；
- 新增 `Verification Policy`，当前仅保留 `engineer | independent` 两种模式，不增加多级复杂度；
- `engineer` 仅用于低风险 Corrective Change：Root Cause confirmed、Expected Behavior / Contract 不变、存在可靠 Regression Signal、Verification Requirements 可在当前 Development Unit 内闭合；
- `independent` 用于 `sdd-fast`、Root Cause 未确认、Contract / Schema / Migration / Event Change、跨系统边界、无法建立可靠 Feedback、显式独立验证要求等场景；
- Repository 数量本身不决定 Verification Policy；跨仓只有在形成 Contract / Integration Boundary 时才成为 Independent Verification 信号；
- Engineer Execution 改为 `Implementation → Local Validation → Review → Verification Policy`，不再默认直接 `@Verify Agent`；
- Policy=`engineer` 时，Engineer Local Validation + Development-level Review + Evidence 可以满足 Required Verification；
- Policy=`independent` 时，必须由 Verify Agent 独立验证，Engineer 不得自行降级；Targeted Rework 后仍按原 Policy 重新验证；
- `required_verify_pass` 统一抽象为 `required_verification_pass`，PR Transition Gate 与 Delivery Completion Gate 不再要求每个 Development Unit 必须存在 Verify Agent PASS；
- Integration Verify 保持独立机制，继续在 Merge 后根据跨 Repository / Contract / Event / 多 Development Unit 等组合风险按需执行；
- Simple Delivery 的定义进一步收敛为“单一 Development Unit”，不再把单 Repository / 单 PR 当作必要特征；
- Canonical Terminology 引用更新为 `multica-design-guideline-v1.4.md`；
- Squad、Sub-Issue、PR Status Sync、Abandoned Human Decision、Post-Merge Reconciliation 等 v1.3.6 核心机制保持不变。

---

# v1.3.6 变更摘要

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

# v1.3.5 变更摘要

相对 v1.3.4：

- 统一 PR 外部事件模型为 **PR Significant Event Model**，当前只识别 `Merged / Completed`、`Rejected`、`Abandoned / Closed` 三类会改变 Delivery 流向的事件；
- `Merged / Completed` 定义为 Success Event，`Rejected` 定义为 Rework Event，`Abandoned / Closed` 定义为 Exceptional Stop Event；
- 修正 §1、§3.6、§17、§18、§29、§30、§32、§33 等章节中“只处理两类事件”与 `Abandoned / Closed` 实际处理逻辑不一致的问题；
- `pr-status-sync` 增加 Significant Event 解析优先级：当前终态优先；多 PR 聚合按 `Abandoned / Closed` → 当前有效 `Rejected` → `all required PR Merged / Completed` → 否则 NO-OP；历史 Reviewer Reject 不覆盖已完成的 PR 终态；
- `Abandoned / Closed` 增加独立事实与幂等通知字段 `abandoned_at / abandonment_notified_at`，防止定时同步重复 Comment / 重复唤醒；
- `Abandoned / Closed` 继续进入 `blocked + Human Decision`，但不自动推断任务取消、重新创建 PR、回 Analysis 或回 Engineering；
- 不改变既有 PR Happy Path、Reject 回流机制、Delivery Lead 职责或 Completion Gate，仅做模型与表述一致性修订。

---

# v1.3.4 变更摘要

相对 v1.3.3：

- `pr-status-sync` 从仅检测 Merge 扩展为 PR Significant Event Detection；当前识别 `Merged / Completed`、`Rejected`、`Abandoned / Closed`，仍不复制完整 PR Review 状态机；
- 普通 `Active / Changes Requested / Approved / Reviewer Vote / Review Feedback` 继续忽略并 NO-OP；
- 任一 required PR 出现 `Rejected` 时，记录原负责人，将当前 Delivery Issue / Development Sub-Issue 置为 `blocked` 并交给 `Delivery Squad`，写入 Reject Facts 后停止自动推进；
- `pr-status-sync` 不判断 Reject 属于 Analysis 问题还是 Engineering 问题，该决策明确交给 Human；
- Human 通过顶层 Comment 使用 `REWORK: ANALYSIS` 或 `REWORK: ENGINEERING` 指定纠偏方向，复用 Squad Comment → Delivery Lead 唤醒机制；
- `REWORK: ENGINEERING` 只执行 Targeted Fix → Verify → PR；`REWORK: ANALYSIS` 回到 Workitem Analyst，并重新经过 Analysis Gate + Human Analysis Review；
- PR `Abandoned / Closed` 作为独立 Exceptional Stop Event 进入 `blocked + Human Decision`，不隐式推断为任务取消；未来如需取消语义，单独定义 Cancellation Policy；
- Reject / Abandon / Completion 同步均要求幂等通知，避免 Autopilot 重复 Comment / 重复唤醒。

---

# v1.3.3 变更摘要

相对 v1.3.2：

- PR 阶段进一步收敛：Multica 不再建模 `Changes Requested / Approved / Reviewer Vote / Review Feedback` 等 TFS PR 中间状态；
- 保留 `pr-status-sync` Skill 名称，但职责收敛为 PR Completion Detection；
- `status = in_review` 期间仅定时检查所有 required PR 是否已 `Merged / Completed`；未全部完成时 NO-OP；
- 所有 required PR 合并完成后，只写一次最终 Merge Facts，并向 Delivery Issue 写普通顶层 Comment；
- Delivery Issue 由 `Delivery Squad` 持有时，普通 PR Completion Comment 复用 Multica Squad 机制唤醒 `Delivery Lead`；
- Comment 只作为 Trigger；PR metadata 作为外部事实持久化；`PR Transition Gate` 负责确定性完成判断；
- PR Transition Gate 统一检查 `required_verify_pass + all(required_pr_merged) + no_unresolved_blocker`；
- 新增 Post-Merge Workspace Reconciliation：Merge 后切换 PR `target_branch`，执行 `fetch --prune + pull --ff-only`，本地 Source Branch 仅允许安全删除；
- `pr-status-sync` 不直接操作 Git 工作区，Merge 后本地对齐由 Delivery Lead 的收口流程负责；
- Complex Delivery 的 Development Sub-Issue 仍在全部完成后显式 `@Delivery Squad`，不假设普通 Comment 能跨 Sub-Issue 隐式唤醒父级 Delivery Lead。

---

# v1.3.2 变更摘要

相对 v1.3.1：

- 引用 `multica-design-guideline-v1.3.md` 的 Canonical Terminology，不再在本方案维护第二套全局术语；
- Squad 正式名称统一为 `Delivery Squad`，Leader Agent 正式名称统一为 `Delivery Lead`；
- 分析 Agent 正式名称统一为 `Workitem Analyst`，不再使用 `Analyst` 作为同一 Agent 的别名；
- 验证 Agent 正式名称统一为 `Verify Agent`；`Verify` 仅在表示验证动作时使用；
- `Development Issue` 统一改为 `Development Sub-Issue`；
- `Parent Completion Gate` 统一改为 `Delivery Completion Gate`；
- Analysis Review 的正式 Status Key 改为 `analys_review`，Display Name 保持 `Analysis Review`，Category=`started`；
- 所有状态判断、流程文本和 Gate 条件统一使用 `analys_review`；UI / 自然语言说明可显示 `Analysis Review`。
