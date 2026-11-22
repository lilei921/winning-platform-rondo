# Multica 研发任务闭环方案 v1.3.0

> 目标：基于 Multica 原生 Squad、Issue、Run、`@mention`、Sub-Issue、Stage 与 Autopilot 能力，构建“需求同步 → 分析 → 人工审核 → 研发 → Verify → PR 审核 → 合并 → 集成验证 → 归档”的研发闭环。  
> 核心原则：**Squad 负责角色协作，Sub-Issue 负责独立交付单元，Deterministic Gate 负责硬条件，Multica 负责运行与状态。**

---

# 1. 设计目标

整个研发任务默认作为一个完整的 **Delivery Issue** 管理。

一个 TFS Work Item 默认对应一个 Delivery Issue，并由 **Delivery Squad** 负责协作执行。

研发过程中：

- Analyst、Engineer、Verify 等角色变化，不因为角色变化创建新的 Issue；
- 只有出现真正能够独立推进、独立验证、独立提交 PR 的交付单元时，才创建 Development Sub-Issue；
- 多 Agent 协作优先使用 Squad Leader 与 `@mention`；
- 可确定的状态校验、完成条件和硬约束由 Deterministic Gate / Script 处理；
- PR Review、Merge 等外部事实通过 External State Sync 回流 Multica。

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
                     （Squad Leader）
              ┌────────────┼────────────┐
              ▼            ▼            ▼
           Analyst      Engineer      Verify
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

Delivery Lead 是 Delivery Squad Leader。

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
Parent Completion Gate
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
PR Review
PR Changes Requested
PR Approved
PR Merged
```

External State Sync 只同步事实，不做业务语义判断。

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

Multica 启动 Delivery Squad Leader。

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

# 7. Analysis

Analysis 在当前 Delivery Issue 内完成。

不默认创建 Analysis Child Issue。

Workitem Analyst 根据 Work Item 类型选择对应分析方法：

```text
Requirement
→ requirement-analysis

Bug
→ bug-analysis
```

可绑定的分析能力包括：

```text
requirement-analysis
bug-analysis
repo-investigation
root-cause-analysis
solution-design
impact-analysis
development-task-planning
analysis-completion
```

Analysis Package 至少包含：

```text
Problem / Requirement
Current Behavior
Expected Behavior
Root Cause（Bug）
Solution
Impact Scope
Repository Scope
Acceptance Criteria
Development Task Graph
Dependencies
Verification Requirements
Risks
```

分析结果通过 Artifact / Comment 写回 Delivery Issue。

---

# 8. Analysis Deterministic Gate

Analyst 完成后执行 Analysis Gate。

适合确定性检查的内容包括：

```text
Solution 是否存在
Impact Scope 是否存在
Repository Scope 是否为空
Acceptance Criteria 是否存在
Development Task 是否指定 repo
Development Task 是否绑定 AC
depends_on 是否有效
Task Graph 是否存在 cycle
Verification Requirements 是否存在
```

结果：

```text
FAIL
→ @Workitem Analyst
→ targeted rework

UNKNOWN
→ Delivery Lead / Human

PASS
→ Human Analysis Review
```

---

# 9. Human Analysis Review

Analysis Review 是 Delivery Issue 中间 Gate。

Delivery Issue 本身仍保持：

```text
in_progress
```

不要因为 Analysis Review 就把整个 Delivery Issue 设置成 `in_review`。

推荐 metadata：

```yaml
analysis.review_status: waiting
```

人工批准：

```yaml
analysis.review_status: approved
```

人工拒绝：

```yaml
analysis.review_status: rejected
```

Human Feedback 必须保存在 Delivery Issue 中。

Reject：

```text
Human Feedback
    ↓
Delivery Lead
    ↓
@Workitem Analyst
    ↓
Targeted Rework
    ↓
Analysis Gate
    ↓
Human Review
```

Approve 后进入 Development Planning。

---

# 10. Development Planning

Analysis Approved 后，Delivery Lead 读取：

```text
Development Task Graph
Repository Scope
Role
Dependencies
Acceptance Criteria
Verification Requirements
```

然后判断任务属于：

```text
Simple Delivery
或
Complex Delivery
```

判断原则不是“有几个流程阶段”，而是：

> 是否存在多个真正能够独立拥有、独立开发、独立验证、独立提交 PR 的交付单元。

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
@Engineer
    ↓
Implementation
    ↓
@Verify
    ↓
PR
    ↓
Human Review
    ↓
Merge
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

每个 Development Issue 保存：

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

# 13. Development Issue 分配

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
→ Verify
→ PR
```

这些属于一个 Delivery 生命周期中的角色协作。

---

# 15. Engineer Execution

Engineer 负责完整研发交付：

```text
代码实现
测试
build
lint
commit
push
修复 Verify Finding
创建 / 更新 PR
修复 PR Review Feedback
```

Engineer 完成实现后：

```text
@Verify Agent
```

Verify 临时进入当前 Issue。

Development Issue 的 Owner 不变。

---

# 16. Verify 闭环

## Verify FAIL

```text
Verify
    ↓
Verification Report
    ↓
@Engineer
    ↓
Targeted Fix
    ↓
@Verify
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

推荐 metadata：

```yaml
delivery:
  repository: winning-dps-df-service
  branch: feature/12345

  pr:
    id: 18452
    url: ...
    status: active
    review_status: waiting
    last_sync_at: ...
```

必须能够确定：

```text
Issue ID
↔ Repository
↔ Branch
↔ PR ID
```

避免外部 PR 状态回流时依赖 LLM 判断所属任务。

---

# 18. PR Status Sync

PR Review 发生在外部平台。

采用：

```text
Multica Autopilot
      ↓
tfs-mcp
      ↓
查询 in_review 且存在 pr.id 的 Issue
      ↓
获取 PR 状态
      ↓
与 Multica 已记录状态比较
      ↓
同步变化
```

PR Status Sync 负责：

```text
查询外部状态
比较变化
同步 PR facts
同步 Review Feedback
触发确定性 Route / Gate
```

不负责：

```text
修改代码
理解代码
评价 Review 意见
重新设计任务
全局 Workflow 编排
```

同步操作必须幂等。

---

# 19. PR Changes Requested

检测到：

```text
PR Review = Changes Requested
```

执行：

```text
PR Status Sync
      ↓
写回 Review Feedback
      ↓
@Engineer
      ↓
Targeted Fix
      ↓
@Verify
      ↓
Verify PASS
      ↓
Update PR
```

正常情况下不需要 Delivery Lead。

只有出现以下情况才升级：

```text
PR Feedback 推翻原 Analysis
需要新增 Repository
需要新增 Development Task
跨任务 Contract 冲突
无法明确归因
连续多轮相同问题失败
```

---

# 20. PR Approved / Merged

`Approved` 和 `Merged` 必须区分。

默认：

```text
Approved
→ 写回 Multica
→ 等待 Merge
```

真正驱动完成的是：

```text
Merged
```

Merged 后执行 PR Transition Gate。

---

# 21. PR Transition Gate

推荐规则：

```python
def development_done(ctx):
    return (
        ctx.verify_status == "PASS"
        and ctx.pr_status == "MERGED"
        and ctx.unresolved_blocker == 0
    )
```

结果：

```text
PASS
→ 当前 Development Unit 完成

FAIL
→ 不允许关闭

UNKNOWN
→ Delivery Lead / Human
```

因此：

> Development Unit 必须到 PR Merge + Gate PASS 才算完成。

---

# 22. Development Completion

对于 Simple Delivery：

```text
当前 Delivery Issue
Verify PASS
+
PR Merged
+
No Blocker
→ Development Complete
```

对于 Complex Delivery：

```text
所有 required Development Sub-Issues done
→ Development Complete
```

Development Sub-Issue 完成后，应执行确定性 completion check。

如果所有必要 Development Units 都已完成，则显式：

```text
@Delivery Squad
```

唤醒 Delivery Lead 继续 Parent Delivery Issue。

不要依赖未明确保证的隐式 Squad 唤醒行为。

---

# 23. Integration Verify

Development 完成后，Delivery Lead 判断是否需要 Integration Verify。

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

# 24. Integration Verify FAIL

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
Verify
      ↓
PR
      ↓
Merge
      ↓
Integration Verify Again
```

不要无差别重新执行全部研发任务。

---

# 25. Parent Completion Gate

关闭 Delivery Issue 前必须确认：

```text
[ ] Analysis Gate PASS
[ ] Analysis Human Review APPROVED
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

# 26. Final Completion

Completion Gate PASS 后：

```text
Delivery Lead
    ↓
Final Delivery Summary
    ↓
更新 TFS Work Item
    ↓
记录 PR / Verify / Integration 结果
    ↓
Delivery Issue → done
```

如果团队要求最终人工确认，可以：

```text
Completion Gate PASS
    ↓
Delivery Issue → in_review
    ↓
Human Final Confirmation
    ↓
task-close
```

是否要求最终人工确认由团队策略决定。

---

# 27. Agent / Squad / Skill 边界

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

# 28. 推荐 Agent × Skill

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

# 29. 推荐 Skill 目录

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

# 30. 状态与事实来源

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
= 外部事实回流入口

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

# 31. Deterministic Decision 与 LLM Decision

## Deterministic Decision

适合：

```text
必填字段是否存在
Task Graph 是否合法
depends_on 是否有效
是否存在 cycle
Verify 是否 PASS
PR 是否 MERGED
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

## LLM / Squad Leader Decision

适合：

```text
当前需要哪种专业能力
需求影响哪些 Repository
Bug 根因是什么
Task 应如何拆
是否存在真正独立交付单元
PR Feedback 是否推翻 Analysis
Integration Verify 是否必要
跨任务失败应归因给谁
```

---

# 32. 反馈循环保护

例如：

```text
Engineer
↔
Verify
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

# 33. 最终执行模型

## 简单任务

```text
TFS
 ↓
Delivery Issue
 ↓
Delivery Squad
 ↓
Analyst
 ↓
Human Analysis Review
 ↓
Engineer
 ↓
Verify
 ↓
PR
 ↓
PR Review / Merge
 ↓
Completion Gate
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
Analyst
 ↓
Human Analysis Review
 ↓
Task Graph
 ↓
Create independent Development Sub-Issues
   ├── Backend → Verify → PR
   ├── Frontend → Verify → PR
   └── Flink → Verify → PR
 ↓
All Development Complete
 ↓
@Delivery Squad
 ↓
Integration Verify if required
 ↓
Completion Gate
 ↓
TFS Done
 ↓
Delivery Issue Done
```

---

# 34. 核心设计原则

整个方案最终遵循以下原则：

> **一个 TFS Work Item 默认对应一个 Delivery Issue。**

> **Delivery Issue 默认交给 Delivery Squad。**

> **Delivery Lead 是 Squad Leader，负责协作与语义路由。**

> **Analyst → Engineer → Verify 是角色协作，不因为角色变化创建 Sub-Issue。**

> **只有独立 Owner、独立修改、独立 Verify、独立 PR 的交付单元才创建 Sub-Issue。**

> **Stage 只用于独立 Development Units 之间的依赖。**

> **Squad Leader 负责“下一步需要谁”，Deterministic Gate 负责“是否允许继续”。**

> **External State Sync 负责将 TFS / PR 外部事实回流 Multica。**

> **Verify PASS 不等于开发完成，PR Merge + Transition Gate PASS 后才算完成。**

> **不建设第二套全局 Workflow Runtime。**

---

# 35. 架构总结

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
      ├── Analyst
      ├── Engineer
      └── Verify
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
