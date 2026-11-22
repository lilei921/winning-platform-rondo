# Multica 研发任务闭环方案 v1.3.5

> 目标：基于 Multica 原生 Squad、Issue、Run、`@mention`、Sub-Issue、Stage、自定义 Status 与 Autopilot 能力，构建“需求同步 → 分析 → Analysis Review → 研发 → Verify → PR 提交 → 等待合并 → 集成验证 → 归档”的研发闭环。  
> 核心原则：**Squad 负责角色协作，Sub-Issue 负责独立交付单元，Deterministic Gate 负责硬条件，Multica 负责运行与状态。**

> Terminology：本方案中的 Squad、Agent、Issue、Status、Route、Gate 等名称统一遵循 `multica-design-guideline-v1.3.md` 的 Canonical Terminology；本方案不维护第二套全局术语。

---

# 1. 设计目标

整个研发任务默认作为一个完整的 **Delivery Issue** 管理。

一个 TFS Work Item 默认对应一个 Delivery Issue，并由 **Delivery Squad** 负责协作执行。

研发过程中：

- Workitem Analyst、各专业 Engineer、Verify Agent 等角色变化，不因为角色变化创建新的 Issue；
- 只有出现真正能够独立推进、独立验证、独立提交 PR 的交付单元时，才创建 Development Sub-Issue；
- 多 Agent 协作优先由 Delivery Lead 通过 `@mention` 协调；
- 可确定的状态校验、完成条件和硬约束由 Deterministic Gate / Script 处理；
- PR 审核过程由 TFS / PR Platform 管理；Multica 不复制外部 Review 状态机。External State Sync 只检测会改变 Delivery 流向的 PR Significant Events：正常完成的 `Merged / Completed`、需要人工纠偏的 `Rejected`，以及当前 PR 已无法继续的 `Abandoned / Closed`。

---

# 2. 总体架构

```
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
              │            │            │
              └────────────┼────────────┘
                           │
                 optional Sub-Issues
                           │
                           ▼
                       PR / Merge
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

Delivery Lead 是 Delivery Squad 的 Leader。

职责是：

- 读取当前 Delivery Issue 的最新状态；
- 判断当前需要哪种专业能力；
- `@mention` 对应成员；
- 在成员返回结果后继续推进；
- 处理跨角色协作；
- 处理异常、歧义和升级；
- 判断是否需要创建独立 Development Sub-Issue；
- 判断是否需要 Integration Verify；
- 在 Completion Gate 通过后执行最终关闭。

Delivery Lead 不负责：

- 完整需求分析；
- 生产代码实现；
- 正式 Verify；
- 人工批准；
- 覆盖 Deterministic Gate FAIL。

Delivery Lead 每次 Run 应保持短生命周期：

```text
读取当前事实
    ↓
判断当前阶段
    ↓
必要时执行 Gate
    ↓
@对应成员 / 请求人工动作
    ↓
结束本次 Run
```

不长期驻留等待其他 Agent。

---

## 3.4 Specialist Agent

专业 Agent 负责具体工作。

```text
Workitem Analyst
    = 需求 / Bug 分析

Backend / Frontend / Flink Engineer
    = 研发实现

Verify Agent
    = 自动验证 / 集成验证
```

专业 Agent 不承担整个研发流程的全局编排。

---

## 3.5 Deterministic Gate

负责程序化、确定性的判断。

包括：

```text
Analysis Gate
Task Graph Gate
Verification Gate
PR Transition Gate
Development Completion Check
Delivery Completion Gate
```

统一返回：

```yaml
result: PASS | FAIL | UNKNOWN
reasons:
  - ...
```

语义：

```text
PASS
→ 允许继续

FAIL
→ 不允许继续，进入 targeted rework

UNKNOWN
→ 当前规则无法可靠判断，交 Delivery Lead / Human
```

Agent 不允许覆盖一个明确的 Gate FAIL。

---

## 3.6 External State Sync

负责同步 Multica 外部事实。

当前主要包括：

```text
TFS Work Item
PR Merged / Completed
PR Rejected
PR Abandoned / Closed
```

PR 的一般 Review 过程、Changes Requested、Approved、Reviewer Vote 变化等属于 TFS / PR Platform 自己的审核过程，Multica 不复制这些过程状态。

其中三类 PR Significant Event 的 Delivery 语义分别为：

```text
Merged / Completed
= Success Event
= 当前 PR 正常完成

Rejected
= Rework Event
= 明确需要人工纠偏，但不自动判断应回 Analysis 还是 Engineering

Abandoned / Closed
= Exceptional Stop Event
= 当前 PR 已无法沿现有路径继续，但不自动推断为任务取消或返工
```

External State Sync 只负责识别、持久化并回流这些外部事实，不做业务语义判断。

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

TFS Sync Agent / Autopilot 负责：

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

Multica 启动 Delivery Lead。

---

# 6. Delivery Issue 启动

Delivery Issue 进入 `todo` 后：

```text
Delivery Issue
assignee = Delivery Squad
        ↓
Delivery Lead
        ↓
读取：
- TFS Context
- Issue Metadata
- Comments
- Existing Artifacts
        ↓
判断当前需要 Analysis
        ↓
@Workitem Analyst
```

Delivery Lead 完成派发后结束本次 Run。

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
→ in_review            # PR 已提交，等待 TFS Significant Event；Rejected / Abandoned / Closed 时进入 blocked
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

Analysis 在当前 Delivery Issue 内完成。

不默认创建 Analysis Child Issue。

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

Repository 数量不决定 Route。

`bug-fix`、`production-fix`、`sdd-fast` 均允许跨 Repository。

Analysis Package 根据 Route 至少包含对应的：

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
Risks
Open Decisions
```

`sdd-fast` 额外按需要包含：

```text
proposal.md
spec / delta spec
tasks.md
design.md（按需）
requirement-review
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

不再使用：

```text
analysis.review_status = waiting | approved | rejected
```

作为第二套审核状态。

原因：

```text
Issue Status
= 当前工作阶段

Human Comment
= 审核决策与反馈

Issue Timeline
= 审核历史
```

## 9.1 Human Approve

Reviewer 在 Delivery Issue 中提交顶层评论：

```text
APPROVED

<可选说明>
```

Delivery Issue 仍由 Delivery Squad 持有。

当 assignee 为 Squad 时，Human 的普通顶层评论由 Multica 路由给 Delivery Lead。

Delivery Lead 被唤醒后：

```text
读取：
- status = analys_review
- Analysis Gate = PASS
- 最新 Human Analysis Review Comment
        ↓
确认 APPROVED
        ↓
status = in_progress
        ↓
进入 Development 准备与执行
```

Workitem Analyst 不允许自行批准自己的 Analysis。

## 9.2 Human Reject

Reviewer 提交：

```text
REJECTED

Reason:
- ...

Expected Change:
- ...
```

Reject 后不新增 `rejected` Issue Status。

Delivery Lead 被 Human Comment 唤醒后：

```text
status = analys_review
        ↓
读取 REJECTED + Feedback
        ↓
status = in_progress
        ↓
@Workitem Analyst
        ↓
Targeted Rework
```

Workitem Analyst 根据 Feedback Area 只修正受影响部分：

```text
Context / Repository Evidence
→ context-analysis

Root Cause / Fix Scope
→ bug-analysis

Requirement / Solution / Impact
→ requirement-analysis

Proposal / Spec / Tasks / Design
→ spec-preparation
```

修正完成后：

```text
analysis-completion
        ↓
Analysis Gate
        ↓
PASS
        ↓
status = analys_review
        ↓
再次等待 Human Analysis Review
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

因此：

```text
`analys_review` / Analysis Review
= 正常等待人工检查

blocked
= 当前确实无法继续
```

---

# 10. Development Planning / Materialization

Human APPROVED 后，Delivery Lead 读取：

```text
TFS Type
Analysis Route
Development Scope
Repository Scope
Role
Dependencies
Acceptance Criteria
Verification Requirements
```

然后判断：

```text
Simple Delivery
或
Complex Delivery
```

判断原则不是 Repository 数量，也不是 PR 数量，而是：

> 是否存在多个真正可以独立拥有、独立推进、独立验证和独立完成的 Development Unit。

同时遵守：

```text
跨 Repository
≠
必须拆 Development Sub-Issue
```

但：

```text
每个发生代码变更并需要交付的 Repository
→ 独立 Branch
→ 独立 PR
```

因此一个 Delivery Issue / Development Sub-Issue 可以关联多个 Repository 与多个 PR。

TFS Task 的创建只依据原始 TFS 类型：

```text
TFS Bug
→ 不创建 TFS Task

TFS Requirement
→ 按 Requirement 规则创建 TFS Task
```

因此 `production-fix` 虽然技术上使用 `bug-analysis`，仍然按照 Requirement 的 TFS 管理规则处理。

---

# 11. Simple Delivery

典型条件：

```text
一个主要 Repository
一个主要 Engineer Owner
一个主要 PR
不存在多个可独立并行的研发单元
```

此时：

> 不创建 Development Sub-Issue。

继续在当前 Delivery Issue 内执行。

```text
Delivery Issue
    ↓
Delivery Lead
    ↓
@对应 Engineer
    ↓
Implementation
    ↓
@Verify Agent
    ↓
PR
    ↓
in_review / 等待 TFS 结果
    ↓
PR Status Sync
```

这是默认 Happy Path。

---

# 12. Complex Delivery

当 Analysis Task Graph 中出现多个独立交付单元，例如：

```text
Backend
Frontend
Flink
```

并且每个单元具有：

```text
独立 Owner
独立代码修改
独立 Verify
独立 PR
独立完成条件
```

才创建 Development Sub-Issue。

例如：

```text
Delivery Issue
│
├── DEV-Backend
├── DEV-Frontend
└── DEV-Flink
```

每个 Development Sub-Issue 保存：

```text
Repository
Goal
Relevant Analysis
Acceptance Criteria
Dependencies
Contracts
Verification Requirements
```

---

# 13. Development Sub-Issue 分配

如果角色已经明确：

```text
backend
→ Backend Engineer

frontend
→ Frontend Engineer

flink
→ Flink Engineer
```

直接分配对应专业 Agent。

如果任务本身仍存在：

```text
跨角色
职责不明确
需要动态协调
```

则可以分配：

```text
Delivery Squad
```

由 Delivery Lead 继续协调。

原则：

```text
明确工作
→ Specialist Agent

不明确 / 多角色工作
→ Delivery Squad
```

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
→ Verification
→ PR
```

这些属于一个 Delivery 生命周期中的角色协作。

---

# 15. Engineer Execution

各专业 Engineer 负责完整研发交付：

```text
代码实现
测试
build
lint
commit
push
修复 Verify Finding
创建 / 更新 PR
```

Engineer 完成实现后：

```text
@Verify Agent
```

Verify 临时进入当前 Issue。

当前 Delivery Issue / Development Sub-Issue 的 Owner 不变。

---

# 16. Verify 闭环

## Verify FAIL

```text
Verify Agent
    ↓
Verification Report
    ↓
@对应 Engineer
    ↓
Targeted Fix
    ↓
@Verify Agent
```

Verification Report 应尽量结构化：

```yaml
verification:
  result: FAIL

  requirement_coverage:
    AC-01: PASS
    AC-02: FAIL

  checks:
    compile: PASS
    unit_test: PASS
    lint: PASS

  issues:
    - id: VERIFY-001
      severity: blocker
      requirement: AC-02
      description: ...
      evidence: ...
```

不要要求 Engineer 每次从头重新执行全部研发工作。

---

## Verify PASS

```text
Verify PASS
    ↓
Engineer
    ↓
Create / Update PR
    ↓
Issue → in_review
```

Verify PASS 不代表 Issue Done。

---

# 17. PR 映射

Engineer 创建 PR 后必须写回当前工作 Issue。

一个 Delivery Issue / Development Sub-Issue 可以关联多个 Repository / PR。推荐 metadata：

```yaml
delivery:
  repositories:
    - repository: winning-dps-df-service
      source_branch: feature/12345
      target_branch: develop
      pr:
        id: 18452
        url: ...
        status: active | merged | abandoned
        merged_at: null
        rejected: false
        rejected_at: null
        rejection_notified_at: null
        abandoned_at: null
        abandonment_notified_at: null

  pr_completion:
    notified_at: null
```

必须能够确定：

```text
Issue ID
↔ Repository
↔ Source Branch / Target Branch
↔ PR ID
```

PR metadata 不维护完整 `review_status`。Multica 只保存 Delivery 真正需要的关键事实：PR 归属、`Merged / Completed`、`Rejected`、`Abandoned / Closed` 以及 Merge 后目标分支。

避免外部 PR 关键状态回流时依赖 LLM 判断所属任务。

---

# 18. PR Status Sync

PR 审核发生在 TFS / PR Platform。Multica 不跟踪审核过程，只检测会改变 Delivery 流向的 PR Significant Events：

```text
Merged / Completed
= Success Event
= 正常完成

Rejected
= Rework Event
= 需要人工纠偏

Abandoned / Closed
= Exceptional Stop Event
= 当前 PR 已无法沿现有路径继续，需要人工决定下一步
```

继续保留 `pr-status-sync` Skill。它不是 PR Lifecycle Replica，而是 **PR Significant Event Detection**。

采用：

```text
Multica Autopilot
      ↓
tfs-mcp
      ↓
查询 status = in_review 且存在 required pr.id 的 Issue
      ↓
读取并规范化 required PR 当前事实
      ↓
是否存在 Abandoned / Closed？
      ├─ YES → Abandon Handling
      └─ NO
           ↓
      是否存在当前有效的 Rejected？
           ├─ YES → Reject Handling
           └─ NO
                ↓
           是否全部 Merged / Completed？
                ├─ YES → Completion Handling
                └─ NO  → NO-OP
```

事件解析遵循 **当前终态优先**：

```text
Merged / Completed
→ 视为 Success，不再被历史 Reviewer Reject 覆盖

Abandoned / Closed
→ 视为 Exceptional Stop

仅当 PR 仍处于可继续状态时
→ Rejected 才作为 Rework Event
```

对于多个 required PR，聚合规则为：

```text
任一 required PR = Abandoned / Closed
→ Exceptional Stop

否则任一未终止 required PR = Rejected
→ Rework

否则全部 required PR = Merged / Completed
→ Completion

否则
→ NO-OP
```

## 18.1 普通审核过程

以下状态全部忽略：

```text
Active
Changes Requested
Approved
Reviewer Vote 的一般变化
Review Feedback
```

只要没有触发 `Rejected` 或 `Abandoned / Closed`，且 required PR 尚未全部 `Merged / Completed`：

```text
NO-OP
```

要求：

- 不复制 TFS PR Review 状态机；
- 不同步普通 Review Feedback；
- 不写 Comment；
- 不唤醒 Delivery Lead / Engineer；
- 下一次 Autopilot 再次检查。

## 18.2 PR Rejected

当任一 required PR 出现团队定义的 `Rejected` 信号时：

```text
PR Status Sync
      ↓
写入 Reject Facts
      ↓
记录 previous_assignee
      ↓
当前 Delivery Issue / Development Sub-Issue.status = blocked
      ↓
assignee = Delivery Squad
      ↓
写入说明性 Comment
      ↓
STOP，等待 Human Decision
```

`pr-status-sync` 不允许自行判断：

```text
设计 / Analysis 有问题？
还是
Engineering / Implementation 有问题？
```

这属于 Human Decision。

建议 Human 在当前 Issue 提交轻量顶层 Comment：

```text
REWORK: ANALYSIS

Reason:
- ...
```

或：

```text
REWORK: ENGINEERING

Reason:
- ...
```

Reject 进入 `blocked` 时统一将受影响 Issue 交给 `Delivery Squad`，因此 Human 顶层 Comment 可以稳定复用 Multica Squad 机制唤醒 `Delivery Lead`；不依赖该 Issue 在 Reject 前是否直接分配给某个 Engineer。

Delivery Lead 根据 Human Decision 执行定向回流：

```text
REWORK: ENGINEERING
→ status = in_progress
→ 恢复 / 指定对应 Engineer
→ @对应 Engineer
→ Targeted Fix
→ Verify Agent
→ Update / Recreate PR as needed
→ status = in_review
```

```text
REWORK: ANALYSIS
→ status = in_progress
→ @Workitem Analyst
→ Targeted Analysis Rework
→ analysis-completion
→ Analysis Gate
→ status = analys_review
→ Human Analysis Review
→ Development / Verify / PR
```

如果问题回到 Analysis，必须重新经过 Analysis Gate 与 Human Analysis Review；不得因为已有旧审批而直接进入编码。

Reject Rework 不默认全量重跑，只修正 Human 指定或 Evidence 明确受影响的部分。

## 18.3 PR Abandoned / Closed

PR 被 `Abandoned / Closed` 与 Reviewer Reject 不等价。它表示当前 PR 已无法沿现有路径继续，但 External State Sync 无法仅根据该事实判断 Delivery Intent。

检测到任一 required PR `Abandoned / Closed` 时：

```text
PR Status Sync
      ↓
写入 Abandon Facts
      ↓
记录 previous_assignee
      ↓
当前 Delivery Issue / Development Sub-Issue.status = blocked
      ↓
assignee = Delivery Squad
      ↓
写入说明性 Comment
      ↓
STOP，等待 Human Decision
```

当前版本不自动把它解释为：

```text
任务取消
重新创建 PR
回 Analysis
回 Engineering
```

这些都属于 Human Decision。Human 顶层 Comment 继续复用 Squad Comment → Delivery Lead 唤醒机制，由 Delivery Lead 根据人工指令执行后续动作。

如果未来需要正式的 Delivery Cancellation Policy，应单独定义 Canonical Status / Completion Rule，不在 `pr-status-sync` 中隐式推断。

## 18.4 PR Merged / Completed

全部 required PR 已 `Merged / Completed`：

```text
PR Status Sync
      ↓
写入最终 Merge Facts
      ↓
设置 delivery.pr_completion.notified_at
      ↓
向当前 Delivery Issue 写普通顶层 Comment
      ↓
Delivery Lead 被 Multica 唤醒
```

Comment 只是 **Trigger**，不是事实来源。Delivery Lead 被唤醒后必须读取 PR metadata，并由 Deterministic Gate 判断是否允许继续。

典型 Comment：

```text
PR COMPLETED

All required PRs are merged.
```

同步必须幂等：

```text
rejected == true
AND rejection_notified_at missing
→ persist reject facts + blocked + Comment once

rejected == true
AND rejection_notified_at exists
→ NO-OP

abandoned_or_closed == true
AND abandonment_notified_at missing
→ persist abandon facts + blocked + Comment once

abandoned_or_closed == true
AND abandonment_notified_at exists
→ NO-OP

all(required_pr_merged) == false
→ NO-OP

all(required_pr_merged) == true
AND pr_completion.notified_at exists
→ NO-OP

all(required_pr_merged) == true
AND pr_completion.notified_at missing
→ persist final facts + Comment once
```

PR Status Sync 不负责：

```text
修改代码
切换本地分支
执行 git pull
理解或评价 PR Review 意见
判断 Reject 应回 Analysis 还是 Engineering
判断 Abandoned / Closed 代表取消、重建 PR、回 Analysis 还是回 Engineering
重新设计任务
全局 Workflow 编排
```

因此：

> **TFS / PR Platform 管理 PR Review Process；Multica 只处理会改变 Delivery 流向的 PR Significant Events：`Merged / Completed`、`Rejected`、`Abandoned / Closed`。**

---

# 19. PR Transition Gate

Delivery Lead 因 PR Completion Comment 被唤醒后，执行确定性 PR Transition Gate。

推荐规则：

```python
def development_done(ctx):
    return (
        ctx.required_verify_pass
        and all(ctx.required_pr_merged)
        and ctx.unresolved_blocker == 0
    )
```

结果：

```text
PASS
→ 当前 Development Unit / Simple Delivery 允许进入 Merge 后收口

FAIL
→ 不允许关闭；保持当前状态并等待缺失条件

UNKNOWN
→ Delivery Lead / Human
```

因此：

> Development 完成条件只关心 required Verify、required PR 最终 Merge 事实以及 Blocker；不关心 PR Review 中间过程。

---

# 20. Post-Merge Workspace Reconciliation

PR Transition Gate PASS 后，由 Delivery Lead 在后续收口过程中执行 Merge 后本地工作区对齐。

目标不是“切回上一次分支”，而是回到每个 PR 明确记录的 `target_branch`：

```text
For each required Repository:
    git fetch --prune origin
    git switch <target_branch>
    git pull --ff-only origin <target_branch>
```

这样可以保证后续 Integration Verify / Final Completion 基于已经合并后的目标分支状态。

如果 TFS 在完成 PR 时删除了远程 Source Branch：

```text
origin/<source_branch>
→ 可能已经不存在
```

本地 Source Branch 可按团队策略执行安全清理：

```text
git branch -d <source_branch>
```

不得默认使用强制删除：

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

此时返回 `UNKNOWN / blocked`，交 Delivery Lead / Human 处理；不得使用 `reset --hard` 等破坏性操作掩盖状态冲突。

该动作属于 Delivery 收口，不由 `pr-status-sync` 执行。

---

# 21. Development Completion

对于 Simple Delivery：

```text
当前 Delivery Issue
required Verify PASS
+
all required PR Merged
+
No Blocker
→ PR Completion Comment
→ Delivery Lead
→ PR Transition Gate PASS
→ Post-Merge Workspace Reconciliation
→ Development Complete
```

对于 Complex Delivery：

```text
所有 required Development Sub-Issues done
→ Development Complete
```

Development Sub-Issue 完成后，应执行确定性 completion check。

Development Sub-Issue 的负责人可能是 Specialist Agent，因此不能假设普通 Comment 一定会唤醒 Delivery Lead。

当所有必要 Development Units 都已完成时，继续保留显式：

```text
@Delivery Squad
```

唤醒 Delivery Lead 继续 Delivery Issue。

因此，**普通 PR Completion Comment → Delivery Lead** 主要用于当前工作 Issue 由 `Delivery Squad` 持有的场景；Sub-Issue 的父级回流继续使用显式 `@Delivery Squad`。

---

# 22. Integration Verify

Development 完成且 Post-Merge Workspace Reconciliation 成功后，Delivery Lead 判断是否需要 Integration Verify。

适合使用：

```text
Deterministic Signal
+
Semantic Decision
```

典型信号：

```text
多 Repository
API + Consumer
前后端 Contract
Event / Schema
Flink 与上下游
多个 Development Unit 组合后才能覆盖 Parent AC
```

如果需要：

```text
Delivery Issue
    ↓
@Verify Agent
    ↓
Integration Verify
```

默认不创建独立 Integration Issue。

只有 Integration Verify 本身具有：

```text
独立 Owner
独立环境
较长生命周期
独立计划
```

才创建独立 Sub-Issue。

---

# 23. Integration Verify FAIL

Verify 需要明确失败归因：

```text
INT-001
→ DEV-Backend

INT-002
→ DEV-Flink
```

然后只重新激活受影响任务：

```text
Affected Development Unit
      ↓
Engineer Fix
      ↓
Verify Agent
      ↓
PR
      ↓
Merge
      ↓
Integration Verify Again
```

不要无差别重新执行全部研发任务。

---

# 24. Delivery Completion Gate

关闭 Delivery Issue 前必须确认：

```text
[ ] Analysis Gate PASS
[ ] Delivery Issue 已通过 `analys_review`（Analysis Review）Human Gate
[ ] 所有 required Development Units 完成
[ ] 所有 required Verify PASS
[ ] 所有 required PR merged
[ ] 无 unresolved blocker
[ ] Integration Verify PASS（如果 required）
```

统一输出：

```yaml
result: PASS | FAIL | UNKNOWN
```

---

# 25. Final Completion

Completion Gate PASS 后：

```text
Delivery Lead
    ↓
Final Delivery Summary
    ↓
归档本次 Delivery 产物（如当前 Route 要求）
    ↓
更新 TFS Work Item
    ↓
记录 PR / Verify / Integration 结果
    ↓
Delivery Issue → done
```

当前方案不默认增加 Final Human Confirmation。

如果未来团队要求最终人工确认，应单独定义对应的 Human Gate / Status Policy，不复用 `in_review`；`in_review` 在当前方案中专门表示：

```text
PR 已提交
→ 等待 TFS PR Merged / Completed
```

---

# 26. Agent / Squad / Skill 边界

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

---

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

---

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
development-verification
pull-request
pr-status-sync
task-close
```

---

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

# 27. 推荐 Agent × Skill

| Agent | Squad Role | 主要 Skill |
|---|---|---|
| Delivery Lead | Leader | delivery-gate / development-task-materialization / task-close |
| Workitem Analyst | Member | requirement-analysis / bug-analysis / analysis-completion |
| Backend Engineer | Member | backend-development / pull-request |
| Frontend Engineer | Member | frontend-development / pull-request |
| Flink Engineer | Member | flink-development / pull-request |
| Verify Agent | Member | development-verification / integration-verification |
| TFS Sync Agent | Squad 外 | tfs-sync |
| PR Status Sync | Squad 外 | pr-status-sync |

---

# 28. 推荐 Skill 目录

```text
workspace-skills/
│
├── tfs-sync/
│
├── requirement-analysis/
├── bug-analysis/
├── analysis-completion/
│
├── development-task-materialization/
│
├── backend-development/
├── frontend-development/
├── flink-development/
│
├── development-verification/
├── integration-verification/
│
├── pull-request/
├── pr-status-sync/
│
├── delivery-gate/
│   ├── SKILL.md
│   ├── scripts/
│   │   ├── validate-analysis.py
│   │   ├── validate-task-graph.py
│   │   ├── evaluate-pr-transition.py
│   │   ├── check-development-completion.py
│   │   └── evaluate-completion.py
│   └── references/
│
└── task-close/
```

不建设额外的全局 Workflow Runner。

---

# 29. 状态与事实来源

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

对于外部系统：

```text
TFS / PR Platform
= 外部事实来源

External State Sync
= TFS Work Item + PR Significant Events（Merged / Completed、Rejected、Abandoned / Closed）关键事实回流入口

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

# 30. Deterministic Decision 与 LLM Decision

## Deterministic Decision

适合：

```text
必填字段是否存在
Task Graph 是否合法
depends_on 是否有效
是否存在 cycle
Verify 是否 PASS
是否检测到 PR Rejected
PR Reject 是否已通知
是否检测到 PR Abandoned / Closed
PR Abandoned / Closed 是否已通知
所有 required PR 是否 MERGED / COMPLETED
PR Completion 是否已通知
blocker 是否为 0
所有 required Sub-Issue 是否 done
```

交给：

```text
Gate
Guard
Script
API State
```

---

## LLM / Delivery Lead Decision

适合：

```text
当前需要哪种专业能力
需求影响哪些 Repository
Bug 根因是什么
Task 应如何拆
是否存在真正独立交付单元
Integration Verify 是否必要
Human 已决定 PR Reject 回 Analysis 还是 Engineering 后，如何执行定向回流
跨任务失败应归因给谁
```

---

# 31. 反馈循环保护

例如：

```text
Engineer
↔
Verify Agent
```

建议：

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

Analysis 同理。

---

# 32. 最终执行模型

## 简单任务

```text
TFS
 ↓
Delivery Issue
 ↓
Delivery Squad
 ↓
Workitem Analyst
 ↓
Human Analysis Review
 ↓
Engineer
 ↓
Verify Agent
 ↓
PR
 ↓
in_review / 等待 TFS 结果
 ↓
PR Status Sync
 ├─ Rejected → blocked → Human Comment → Delivery Lead
 │               ├─ REWORK: ANALYSIS → Workitem Analyst → Analysis Review
 │               └─ REWORK: ENGINEERING → Engineer → Verify → PR
 │
 ├─ Abandoned / Closed → blocked → Human Comment → Delivery Lead
 │                         └─ Human 决定继续、返工、重建 PR 或终止
 │
 └─ All Merged / Completed
        ↓
   PR Completion Comment → Delivery Lead
        ↓
   PR Transition Gate
 ↓
Post-Merge Workspace Reconciliation
 ↓
Integration Verify if required
 ↓
Delivery Completion Gate
 ↓
TFS Done
 ↓
Delivery Issue Done
```

---

## 复杂任务

```text
TFS
 ↓
Delivery Issue
 ↓
Delivery Squad
 ↓
Workitem Analyst
 ↓
Human Analysis Review
 ↓
Task Graph
 ↓
Create independent Development Sub-Issues
   ├── Backend Engineer → Verify Agent → PR → wait Result
   ├── Frontend Engineer → Verify Agent → PR → wait Result
   └── Flink Engineer → Verify Agent → PR → wait Result
 ↓
PR Status Sync
   ├── Rejected → affected Issue blocked → Human Correction
   ├── Abandoned / Closed → affected Issue blocked → Human Decision
   └── Merged / Completed → Development Completion Check
 ↓
All Development Complete
 ↓
@Delivery Squad
 ↓
Integration Verify if required
 ↓
Delivery Completion Gate
 ↓
TFS Done
 ↓
Delivery Issue Done
```

---

# 33. 核心设计原则

整个方案最终遵循以下原则：

> **一个 TFS Work Item 默认对应一个 Delivery Issue。**

> **Delivery Issue 默认交给 Delivery Squad。**

> **Delivery Lead 是 Delivery Squad 的 Leader，负责协作与语义路由。**

> **Workitem Analyst → Engineer → Verify Agent 是角色协作，不因为角色变化创建 Sub-Issue。**

> **只有独立 Owner、独立修改、独立 Verify、独立 PR 的交付单元才创建 Sub-Issue。**

> **Stage 只用于独立 Development Units 之间的依赖。**

> **Delivery Lead 负责“下一步需要谁”，Deterministic Gate 负责“是否允许继续”。**

> **External State Sync 不复制 TFS PR Review 过程；只处理会改变 Delivery 流向的三类 PR Significant Event：`Merged / Completed`、`Rejected`、`Abandoned / Closed`。**

> **Verify PASS 不等于开发完成；所有 required PR Merge + PR Transition Gate PASS + Merge 后工作区对齐后，才进入后续收口。**

> **PR Completion Comment 只负责唤醒 Delivery Lead；PR metadata 是事实，PR Transition Gate 是确定性判断。**

> **PR Reject 进入 `blocked`，由 Human 决定回 `Workitem Analyst` 还是对应 Engineer；`pr-status-sync` 不替代这个语义决策。**

> **不建设第二套全局 Workflow Runtime。**

---

# 34. 架构总结

最终架构可以概括为：

```text
External Systems
      │
      ▼
External State Sync
      │
      ▼
Multica Runtime
      │
      ▼
Delivery Issue
      │
      ▼
Delivery Squad
      │
      ├── Delivery Lead
      ├── Workitem Analyst
      ├── Engineer
      └── Verify Agent
      │
      ▼
Optional Development Sub-Issues
      │
      ▼
PR / Merge
      │
      ▼
Deterministic Gates
      │
      ▼
Final Completion
```

其中：

```text
Squad
= 多角色协作

Sub-Issue
= 独立交付单元

Stage
= 独立交付单元之间的依赖

Skill
= 专业执行方法

Gate
= 硬条件和完成条件

Multica
= Runtime 和状态

External State Sync
= 外部事实回流
```

这套设计既利用 Multica 原生的 Squad 协作机制，又保留研发交付闭环所需要的确定性约束、外部状态同步和可审计性。


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
