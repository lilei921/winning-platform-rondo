# Multica 研发任务闭环方案 v1.4.2

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
- 多 Agent 协作继续遵循 Multica Squad / Leader / `@mention` 原生机制；Delivery Lead 可以在 Happy Path 被原生唤醒，但只承担极薄的 routing / deterministic capability dispatch；
- **能确定性化的业务规则、Gate、副作用、幂等、物化全部进入 Script / Gate / Route，不让 Agent 重复思考；**
- 真正的专业语义工作只发生在 Workitem Analyst、Engineer、Verify Agent；Delivery Lead 对 `UNKNOWN`、事实冲突、跨角色异常或无法可靠路由只做协调、dispatch 与升级，不自行补做专业语义判断；
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

Delivery Lead 是 Delivery Squad 的 Leader，定位为：

```text
Thin Squad Router
+ Stage-boundary Adapter
+ Exception Coordinator
```

Delivery Lead 继续利用 Multica Squad 原生 Leader 机制作为协作入口。Happy Path 中即使被原生唤醒，也只读取结构化 Facts、调用确定性 capability / route、`@mention` 正确 Specialist，然后结束当前 Run。

职责是：

- 读取当前 Delivery Issue 的最新结构化事实；
- 在 Squad 原生触发下调用确定性 Route / Gate / Materialization；
- 根据确定性结果 `@mention` Workitem Analyst、Engineer 或 Verify Agent；
- 处理 `UNKNOWN`、事实冲突、跨角色异常和无法可靠归因的问题；
- Human 已明确业务决策后，调用确定性 Route 执行后续动作，不重新解释 Human 意图；
- 确定性机制无法继续时，负责组织澄清、请求 Human / Specialist 决策并继续路由，不自行代替 Specialist 产出专业语义结论。

Delivery Lead 不负责：

- 完整需求分析；
- Development Unit 的二次语义拆分；
- 重新判断 Human 已批准的 Verify Agent Recommendation；
- 生产代码实现；
- Code Review 的具体执行；
- 正式 Acceptance Verification；
- PR Materialization 的逐项业务判断；
- 重复执行可以由 Script / Gate / Route 完成的状态判断；
- 人工批准；
- 覆盖 Deterministic Gate FAIL。

Happy Path 的典型 Run：

```text
读取当前 Facts
    ↓
调用确定性 Route / Capability
    ↓
必要时 @对应 Specialist
    ↓
结束 Run
```

只有出现：

```text
UNKNOWN
事实冲突
无法唯一路由
跨角色责任不明确
Human Decision 不完整
```

时，Delivery Lead 停止确定性推进并发起澄清 / 升级；需要专业语义判断时交给对应 Specialist 或 Human。

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

## 3.5 Deterministic Gate / Route / Script

负责所有可以程序化、确定性执行的控制逻辑。

正式原则：

> **能确定性化的业务规则、Gate、副作用、幂等、物化全部进入 Script / Gate / Route；Agent 只负责调用和解释 `UNKNOWN`，不得重复做同一判断。**

包括：

```text
Analysis Gate
Task Graph Gate
Development Readiness Check
Verification Gate（仅 Verify Agent required 时）
PR Transition Gate
Delivery Completion Gate
Role / Assignee Route
Analysis Review Transition
Development Materialization
PR Materialization
PR Terminal Reconciliation
Delivery Finalization
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

TFS Sync 保留 Multica Autopilot / Agent Run 兼容性，但 Agent 定位为 **Thin Adapter**：Agent 不自行判断同步规则，只调用 `tfs-sync` 的确定性脚本并返回 Structured Result。

```text
Autopilot
→ TFS Sync Agent Thin Run
→ deterministic tfs-sync scripts
→ Structured Result
→ END
```

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

Delivery Issue 进入 `todo` 后仍由 Delivery Squad 持有。按照 Squad 原生机制，Multica 可以唤醒 Delivery Lead。该 Run 不做新的语义判断，只作为极薄的 native router：

```text
Delivery Issue
assignee = Delivery Squad
status   = todo
        ↓
Delivery Lead
        ↓
调用 start-analysis route
        ↓
确定性检查：Analysis 是否尚未启动 / Workitem Analyst 是否可路由
        ↓
@Workitem Analyst
        ↓
END
```

建议由 `delivery-flow/scripts/start-analysis.py` 承担 Route 判断。

只有 Route 返回 `UNKNOWN`、Issue Facts 冲突或无法唯一确定 Workitem Analyst 时，Delivery Lead 才进入异常协调；需要专业语义判断时交给 Workitem Analyst / Human。

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
Development Units / Development Topology Candidate
Verify Agent Recommendation
```

其中 `Verify Agent Recommendation` 至少明确：

```yaml
verify_agent:
  recommendation: required | not_required
  reason: ...
  verification_focus:
    - AC-...
    - ...
```

判断不按 Route 预设默认结果。Workitem Analyst 根据当前任务的 Acceptance Criteria、Verification Requirements、Development Units、跨系统行为和可验证性给出推荐。

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

因此 `bug-fix`、`production-fix`、`sdd-fast` 都可能得到 `REQUIRED` 或 `NOT REQUIRED`；Route 本身不直接决定 Verify Agent 是否参与。

Verify Agent 的建议只回答：

> **是否需要一个独立于实现者的 behavior-oriented 验收视角？**

不用于替代 Engineer 的 Local Validation 或 Code Review。

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

Delivery Lead 被 Squad 原生机制唤醒后，不重新解释 Analysis 内容，而是调用确定性的 `apply-analysis-review` / `materialize-development`：

```text
读取：
- status = analys_review
- Analysis Gate = PASS
- 最新 Human Analysis Review Comment = APPROVED
        ↓
apply-analysis-review.py
        ↓
materialize-development.py
        ↓
status = in_progress
        ↓
创建 / 分配 approved Development Units
        ↓
@required Engineer(s)
        ↓
END
```

Human `APPROVED` 表示接受当前完整 Analysis Package，包括 Development Topology Candidate 与 `Verify Agent Recommendation: REQUIRED | NOT REQUIRED`。Delivery Lead 不得在此重新拆分 Development Unit 或重新评估 Verify Agent 是否必要。

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

Delivery Lead 被 Human Comment 唤醒后，只调用确定性的 Review Transition：

```text
status = analys_review
+ Human Comment = REJECTED
        ↓
apply-analysis-review.py
        ↓
status = in_progress
        ↓
@Workitem Analyst
        ↓
Targeted Rework
```

只有 Comment 格式无法解析、Feedback 与当前 Facts 冲突或无法确定返工目标时，才返回 `UNKNOWN` 给 Delivery Lead / Human。

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

Workitem Analyst 在 Analysis Package 中完成 Development Topology 的语义设计，至少明确：

```text
Development Units
Role
Repository Scope
Dependencies
Acceptance Criteria
Verification Requirements
Verify Agent Recommendation
```

Human Analysis Review `APPROVED` 后，Delivery Lead 可以被 Squad 原生机制唤醒，但不再做第二次 Topology 语义判断。它只调用 `materialize-development.py`。

`materialize-development.py` 负责确定性执行：

```text
读取 approved Analysis Package
        ↓
校验 Development Units / Role / Dependencies
        ↓
Simple Delivery
→ 不创建 Development Sub-Issue

Complex Delivery
→ 创建 approved Development Sub-Issues
        ↓
Role → Agent Mapping
        ↓
按 tfs.type 创建 / 不创建 TFS Task
        ↓
Verify Recommendation → verify_agent.required
        ↓
设置必要 Issue / Sub-Issue Facts
        ↓
分配 / 启动 required Engineer(s)
```

正式边界：

```text
Workitem Analyst
= 语义设计 Development Topology

Human
= 批准 Development Topology

materialize-development.py
= 物化已批准 Topology

Delivery Lead
= 调用 materialization；不重新设计 Topology
```

仍遵守：

```text
跨 Repository
≠
必须拆 Development Sub-Issue

每个发生代码变更并需要交付的 Repository
→ 独立 Branch
→ 独立 PR
```

Human `APPROVED` 后，Verify Recommendation 确定性转换：

```text
recommendation = REQUIRED
→ verify_agent.required = true

recommendation = NOT REQUIRED
→ verify_agent.required = false
```

仅当 approved Analysis Package 缺少必须字段、Development Unit / Role 无法唯一物化或 Facts 互相冲突时返回 `UNKNOWN`，交 Delivery Lead / Human。

---

# 11. Simple Delivery

典型条件：

```text
一个 Development Unit
一个主要 Engineer Owner
不存在多个可独立推进的研发单元
```

Simple Delivery 可以涉及一个或多个 Repository / PR；Repository 数量本身不改变 Simple / Complex 判断。

此时：

> 不创建 Development Sub-Issue。

继续在当前 Delivery Issue 内执行。

```text
Delivery Issue
    ↓
materialize-development.py
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
Development Ready
    ↓
Development Readiness Check
    ↓
Verify Agent Required?
    ├─ No
    │    ↓
    │  当前 Engineer Run → PR Materialization
    │
    └─ Yes
         ↓
       @Verify Agent
         ↓
       Acceptance Verification PASS
         ↓
       当前 Verify Agent Run → PR Materialization
    ↓
all required PR registered
    ↓
in_review / 等待 TFS 结果
    ↓
PR Status Sync
```

---

# 12. Complex Delivery

当 Analysis Task Graph 中出现多个独立交付单元，例如：

```text
Backend
Frontend
Flink
```

并且每个单元具有独立的：

```text
Owner
Development Scope
Verification Boundary
失败 / 重试边界
Dependencies
Completion Lifecycle
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
Repository Scope
Goal
Relevant Analysis
Acceptance Criteria
Dependencies
Contracts
Verification Requirements
```

多个 Repository / PR 本身不构成 Development Unit 拆分条件。

Complex Delivery 的关键边界是：

```text
各 Development Unit
→ 各自完成 Engineer Development Contract
→ 各自 Commit / Push
→ Development Ready

每个 Development Unit 达到 Development Ready 后
→ Engineer 写回 Ready Facts
→ 当前 Engineer Run 调用 `check-development-readiness.py`

NOT_READY
→ 当前 Engineer Run 结束

READY + verify_agent.required=true
→ 当前 Engineer Run `@Verify Agent` 后结束

READY + verify_agent.required=false
→ 当前 Engineer Run 直接调用 PR Materialization

UNKNOWN
→ Delivery Lead / Human
```

`Development Ready` 是 Development Fact，不新增 Issue Status。Development Readiness Check 的职责属于 Deterministic Script，而不是 Engineer / Verify Agent / Delivery Lead 的语义判断。

如果 Multica Squad 原生机制在上述过程中额外唤醒 Delivery Lead，Delivery Lead 只读取 Readiness Result 并做极薄 dispatch / no-op，不重新判断 `READY / NOT_READY`。

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

Code Review 的具体实现可以由 Engineer 自检、read-only reviewer subagent 或独立 review Skill 承担；具体机制由 Engineer Development Design 定义，但不得形成新的隐藏 Development Owner。

Engineer 完成开发后输出 Development Evidence，并将当前 Development Unit 标记为：

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

Engineer 在 `Development Ready` 前不创建正式 PR，但必须在当前 Development Run 内完成 **PR Preparation**，至少准备每个 required Repository Change 的：

```text
Repository / Repository ID
Source Branch
Target Branch
Candidate Commit
PR Title
PR Description / Description Reference
TFS Work Item / Delivery Issue 关联信息
```

PR Preparation 属于 Engineer 的交付准备，因为其中仍包含对本次代码修改的语义描述；实际调用 TFS / PR API 创建 PR 是确定性副作用，不需要新的工程语义推理。若当前 Engineer Run 正好完成最后一个必需前置条件，可以在同一 Run 尾部调用 PR Materialization。

Engineer 必须把 Development Ready 与 PR Preparation 作为结构化 Development Evidence 写回当前工作 Issue，然后在当前 Run 尾部调用确定性的 `check-development-readiness.py`。Engineer 只负责产生当前 Development Unit 的 Ready Facts，不负责判断其他 Development Unit。

`check-development-readiness.py` 负责聚合全部 required Development Units，并统一返回：

```text
NOT_READY
READY
UNKNOWN
```

`NOT_READY` 时当前 Run 结束；`READY` 时按 `verify_agent.required` 直接 `@Verify Agent` 或执行 PR Materialization；`UNKNOWN` 时才升级 Delivery Lead / Human。

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

这些属于 Development / Code Review。

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

由 Workitem Analyst 在 Analysis Package 中提出 Recommendation：

```yaml
verify_agent:
  recommendation: required | not_required
  reason: ...
  verification_focus:
    - ...
```

Human Analysis Review 对该 Recommendation 一并审核。Human `APPROVED` 后，Development Materialization 将其转换为 `verify_agent.required = true | false` 执行事实。

判断原则不按 `bug-fix / production-fix / sdd-fast` 预设默认值，而是回答：

> **当前交付是否值得增加一个独立于实现者、从 Acceptance Criteria / Verification Requirements 出发的 behavior-oriented 验收视角？**

典型推荐 `NOT REQUIRED`：

```text
修改范围小、最终行为单一
已有可靠 Regression / Runtime Feedback
Acceptance Criteria 可由单个 Development Unit 清晰闭合
不涉及跨系统 / Contract / Event / Schema 组合行为
Engineer 的 Local Validation + Code Review 已能充分支撑交付信心
```

典型推荐 `REQUIRED`：

```text
多个关键 Acceptance Criteria
多个 Development Unit 共同形成最终行为
前后端联动
API / External Contract
Event / Schema
跨系统 / 上下游链路
复杂状态流
单个 Engineer 无法独立闭合 Parent AC
需要 Runtime / Integration / E2E 行为验收
Human 明确要求独立验收
```

因此简单 `bug-fix / production-fix` 往往会得到 `NOT REQUIRED`，但不是固定默认；复杂 Corrective Change 同样可以推荐 `REQUIRED`。Repository 数量本身不是 `REQUIRED` 的充分条件。

## 16.2 Verify 输入

Verify Agent 开始前必须满足：

```text
所有 required Development Units = Development Ready
Acceptance Criteria 可读取
Verification Requirements 可读取
verify_agent.required = true
所有待验证 Repository 的 Branch / Commit SHA 已固定
```

Verify Agent 基于 **明确的候选代码版本** 验证，不依赖 PR 已经创建。

推荐输入：

```yaml
verification_candidate:
  repositories:
    - repository: ...
      branch: ...
      commit: ...
```

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

该过程：

```text
不是正式 Merge
不改变目标分支
不创建额外 Delivery Stage
不要求 PR 已完成
```


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

Verification Gate 确认：

```text
verify_agent.required = true
+ Verification Report.result = PASS
+ verified commit set 与当前候选 commit set 一致
+ required AC / Verification Requirements 已覆盖
```

PASS 后：

```text
当前 Verify Agent Run
→ 调用确定性的 PR Materialization
→ Create required PR(s)
→ Run 结束
```

正常 Happy Path 不额外唤醒 Delivery Lead，也不重新启动 Engineer Session。只有 PR Materialization 发现需要新的代码修改、Branch 修复或工程语义判断时，才回到对应 Engineer；出现 `UNKNOWN`、跨任务冲突或无法可靠路由时才升级 Delivery Lead / Human。

## 16.5 Verify FAIL / UNKNOWN

FAIL：

```text
Verify Agent
→ 语义归因 Finding 到 affected Development Unit
        ↓
route-verify-result.py
→ Development Unit → Engineer 确定性映射
        ↓
@对应 Engineer
    ↓
Targeted Fix
    ↓
Local Validation
    ↓
Code Review
    ↓
Commit / Push
    ↓
Development Ready
    ↓
Verify Agent Again
```

只重验受影响场景及必要 Regression / Integration 范围，不无差别重跑所有工作。

UNKNOWN：

```text
→ 不允许创建 PR
→ Delivery Lead / Human
```

如果代码 Commit Set 发生变化，旧 Verify PASS 自动失效，必须基于新的候选 Commit Set 重新验证。

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
= Engineer 在原 Development Run 内准备 PR 所需语义与事实

PR Materialization
= 基于已准备 Facts 的确定性副作用，实际调用 TFS / PR API 创建 PR
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

PR Title / Description 可以由 Engineer 基于当前 Development Evidence 生成，因为它们需要正确描述本次代码修改；完成后作为 Fact 保存，不要求后续 PR 创建 Run 再重新理解代码。

## 17.2 PR Materialization

当满足以下任一条件时：

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

PR Materialization 不要求固定由 Delivery Lead 发起。正常 Happy Path 由**完成最后一个必需前置条件的当前 Agent Run**直接调用确定性的 `pull-request` capability：

```text
verify_agent.required = false
→ 使全部 required Development Units Ready 的当前 Engineer Run
→ PR Materialization

verify_agent.required = true
→ Verification Gate PASS 的当前 Verify Agent Run
→ PR Materialization
```

这只是当前 Run 的确定性收尾动作，不改变 Engineer / Verify Agent 的专业职责；PR 语义仍来自 Engineer 已完成的 PR Preparation。

标准过程：

```text
读取所有 required Repository Change 的 PR Preparation Facts
        ↓
逐仓校验 Repository / Branch / Candidate Commit
        ↓
确认 Branch HEAD 与 candidate_commit 一致
        ↓
调用 TFS / PR API 创建 required PR
        ↓
校验返回的 PR / Repository / Source / Target Branch
        ↓
写回 current_pr metadata
        ↓
所有 required PR 注册完成
        ↓
Issue → in_review
```

正常 Happy Path 不额外启动 Delivery Lead Session、不重新 `@Engineer`，也不为每个 Repository 再启动独立 Agent Session。

PR Materialization 必须幂等。对于多个 Repository，可在一次 deterministic run 中逐仓处理；已经成功创建并正确登记的 PR 不重复创建，失败项重试时只补未完成项。

## 17.3 何时重新交给 Engineer

只有出现需要新的 Engineering Semantic Work 时才重新启动对应 Engineer，例如：

```text
Branch HEAD != candidate_commit
需要 rebase / conflict resolution
PR 前置检查暴露新的代码问题
必须修改代码、测试或 PR Preparation 内容
Repository / Branch 事实与已批准 Development Evidence 冲突
```

此时：

```text
STOP PR Materialization
→ @对应 Engineer
→ Targeted Fix / Branch Repair
→ Local Validation
→ Code Review
→ Commit / Push
→ 更新 PR Preparation / Candidate Commit
→ Development Ready
→ 如果 verify_agent.required=true，则旧 Verify PASS 失效并重新 Verify
→ 再次 PR Materialization
```

以下问题不需要 Engineer：

```text
TFS / PR API 临时失败
网络超时
幂等恢复
已成功 PR 的 metadata 回填
可确定性的字段 / 身份校验
```

这些由 `pull-request` capability 重试、恢复或返回 `UNKNOWN`。

当 `verify_agent.required=true` 时，PR Materialization 必须基于已验证的候选 Commit Set。Verify PASS 后如代码发生任何实质变更：

```text
旧 Verify PASS
→ 失效
→ Local Validation + Code Review
→ 更新候选 Commit Set / PR Preparation
→ Verify Again
```

不得让未经过重新验收的代码变化沿用旧 Verify PASS。

一个 Delivery Issue / Development Sub-Issue 可以关联多个 Repository Change；每个 Repository Change 保存一个**当前 required PR**，历史被替代的 PR 进入审计历史，而不继续参与 Completion Gate。

推荐 metadata：

```yaml
delivery:
  repositories:
    - repository: winning-dps-df-service
      project: DP-03-数据采集管理软件
      repository_id: "..."
      branch: feature/12345
      candidate_commit: "..."

      current_pr:
        id: 18452
        url: ...
        source_branch: feature/12345
        target_branch: develop

        provider_status: active | completed | abandoned
        provider_closed_at: null
        observed_at: null

        sync:
          pending_event: null
          event_key: null

      pr_history: []

  verification:
    required: true | false
    result: not_required | pending | pass | fail | unknown
    verified_commits: []

  pr_completion:
    notified_at: null
    event_key: null
```

必须能够确定：

```text
Issue ID
↔ Repository / Repository ID
↔ Branch / Candidate Commit
↔ Current PR ID
```

当所有 required Repository Change 都已成功注册 `current_pr` 后：

```text
Issue → in_review
```

不得在仅创建部分 required PR 时提前进入 `in_review`。

`pr-status-sync` 调用 TFS MCP 后必须核对返回的 PR ID、Repository、Project 与登记事实；不一致时返回 `UNKNOWN`，不得更新当前 Delivery 的 PR Facts。

PR metadata 不维护完整 `review_status`。当前方案只保存 Delivery 真正需要的事实：

```text
current PR 身份
source / target branch
provider_status
provider_closed_at
observed_at
历史替代 PR
同步恢复状态
```

其中：

```text
provider_status = completed
→ Success

provider_status = abandoned
→ Exceptional Stop

provider_status = active
→ Waiting / NO-OP
```

`completedDate` 统一归一化为 `provider_closed_at`，不得无条件映射为 `merged_at`：`completed` 与 `abandoned` 都可能存在关闭时间。

如果 Abandoned 后人工决定重新创建 PR：

```text
旧 current_pr
→ 移入 pr_history

新 PR
→ 替换为 current_pr
```

Completion Gate 只检查每个 required Repository Change 的 `current_pr`，历史 PR 只用于审计。

---

# 18. PR Status Sync

PR Status Sync 保留 Multica Autopilot / Agent Run 兼容性，但 Agent 定位为 **Thin Adapter**；终态识别、身份校验、幂等恢复与 Finalize 触发均由脚本完成，不让 LLM 重复解释 provider facts。

PR 审核发生在 TFS / PR Platform。Multica 不跟踪审核过程；`pr-status-sync` 只读取已登记的 current required PR，并依据 provider `status` 做确定性终态检测。

继续保留 `pr-status-sync` Skill。它不是 PR Lifecycle Replica，而是 **PR Terminal State Detection + Reconciliation**。

采用：

```text
Multica Autopilot
      ↓
查询需要检查的 Issue：
- status = in_review
- 或存在 current_pr.sync.pending_event
      ↓
读取已登记的 Project / Repository ID / PR ID
      ↓
tfs-mcp 查询 PR
      ↓
校验 PR / Repository / Project 身份
      │
      ├─ 不一致 / 缺字段 / 未知 status
      │      → UNKNOWN
      │
      └─ 校验通过
             ↓
       provider_status ?
          ├─ abandoned → Exceptional Stop Handling
          ├─ completed → Completion Evaluation
          └─ active    → NO-OP
```

`mergeStatus`、`mergeCommitId`、`mergeCommitMessage` 不参与终态判定。即使这些字段看起来已经具备合并信息，只要 `status=active`，当前 PR 仍视为未完成。

对于多个 required Repository Change，聚合规则为：

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

只要 current PR 仍为：

```text
provider_status = active
```

统一：

```text
NO-OP
```

不根据以下信息改变 Delivery 流向：

```text
Changes Requested
Approved
Review Feedback
mergeStatus
mergeCommitId
mergeCommitMessage
```

要求：

- 不复制 TFS PR Review 状态机；
- 不同步普通 Review Feedback；
- 不写 Comment；
- 不唤醒 Delivery Lead / Engineer；
- 下一次 Autopilot 再次检查。

## 18.2 PR Abandoned

检测到任一 required current PR：

```text
provider_status = abandoned
```

执行：

```text
PR Status Sync
      ↓
持久化 Abandoned Fact
- provider_status = abandoned
- provider_closed_at
- observed_at
      ↓
写入 current_pr.sync.pending_event
      ↓
记录 previous_assignee
      ↓
当前 Delivery Issue / Development Sub-Issue.status = blocked
      ↓
assignee = Delivery Squad
      ↓
清除 pending_event / 标记该事件已应用
      ↓
STOP，等待 Human Decision
```

`pr-status-sync` 不推断 Human 意图。

Human 需要明确：

```text
为什么 Abandoned？
- REJECTED
- DISCARDED

下一步是什么？
- ANALYSIS
- ENGINEERING
- RECREATE_PR
- CANCEL_DELIVERY
```

Human 顶层 Comment 复用 Multica Squad 机制唤醒 Delivery Lead。Delivery Lead 不重新解释 Human 已明确的分类和 `NEXT`，而是调用 `route-human-decision.py`：

```text
Human Decision Comment
        ↓
Delivery Lead Thin Run
        ↓
route-human-decision.py
        ├─ ANALYSIS      → Workitem Analyst
        ├─ ENGINEERING   → affected Development Unit Engineer
        ├─ RECREATE_PR   → PR Materialization / Engineer（按 Commit Facts）
        └─ CANCEL_DELIVERY → Cancellation Handler
```

只有 `NEXT` 缺失、对象不唯一、Facts 冲突或 Route 返回 `UNKNOWN` 时，Delivery Lead 才负责异常协调与升级；不得自行推断 Human 未明确的业务意图。

### NEXT: ENGINEERING

```text
status = in_progress
→ 恢复 / 指定对应 Engineer
→ Targeted Fix
→ Local Validation
→ Code Review
→ Commit / Push
→ Development Ready
→ 如果 verify_agent.required=true：旧 Verify PASS 失效，重新 @Verify Agent
→ 满足验收条件后执行 PR Materialization
→ 旧 PR 移入 pr_history
→ 新 PR 成为 current_pr
→ status = in_review
```

### NEXT: ANALYSIS

```text
status = in_progress
→ @Workitem Analyst
→ Targeted Analysis Rework
→ analysis-completion
→ Analysis Gate
→ status = analys_review
→ Human Analysis Review
→ 重新物化 Development Topology
→ 使用新批准的 verify_agent.required
→ Development
```

Analysis 被重新批准后，旧 `verify_agent.required` 结论不自动继承，以新的 Analysis Package 为准。

### NEXT: RECREATE_PR

如果候选 Commit Set 未变化：

```text
→ 不重复 Development
→ 已存在的 Verify PASS（如 required）可以继续使用
→ PR Materialization
```

如果 Commit Set 发生变化：

```text
→ 回到对应 Engineer
→ Local Validation + Code Review
→ Development Ready
→ 如 required，重新 Verify
→ PR Materialization
```

`NEXT: CANCEL_DELIVERY` 属于明确 Human Cancellation Decision；具体 TFS / Delivery 关闭规则如果需要进一步标准化，应由独立 Cancellation Policy 定义，不由 `pr-status-sync` 隐式决定。

## 18.3 PR Completed

只有：

```text
provider_status = completed
```

才表示单个 current PR 成功完成。

当所有 required Repository Change 的 `current_pr.provider_status = completed`：

```text
PR Status Sync Run
      ↓
持久化最终 Completion Facts
      ↓
设置 delivery.pr_completion.event_key / notified_at
      ↓
同一 Run 调用 finalize-delivery.py
      ↓
PR Transition Check
      ↓
Post-Merge Workspace Reconciliation
      ↓
Delivery Completion Check
      ↓
Final Summary Render
      ↓
TFS Close / Delivery Issue Done
```

该 Happy Path 不再写普通顶层 Comment 仅用于唤醒 Delivery Lead。`finalize-delivery.py` 使用结构化 Facts 完成确定性收口；只有任一 Check 返回 `UNKNOWN`、Workspace 冲突或无法安全完成时才交 Delivery Lead / Human。

## 18.4 幂等与恢复

定时同步必须考虑“状态已部分写入，但 Run 中途失败”的情况。

每个 current PR 使用稳定 `event_key`，至少包含：

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

完成相应状态 / assignee / metadata / notification 动作后再清除 `pending_event`。

因此 Autopilot 的恢复扫描不能只看 `status = in_review`，还必须包含：

```text
current_pr.sync.pending_event exists
```

核心幂等规则：

```text
active
→ NO-OP

abandoned + same event already applied
→ NO-OP

abandoned + pending_event
→ 恢复 blocked / Delivery Squad / metadata 一致性
→ 不自动 Comment

all current required PR completed
+ completion event already notified
→ NO-OP

all current required PR completed
+ completion event not notified
→ persist facts + Comment once

query / identity / schema result UNKNOWN
→ 不推进 Completion，不覆盖已有可靠事实
```

PR Status Sync 不负责修改代码、切换本地分支、理解 Review 意见、推断 abandoned 原因或重新设计任务。

---

# 19. PR Transition Gate

PR Transition Gate 保持独立检查职责，但不对应独立 Agent Run。正常 PR Completed Happy Path 中，由 `finalize-delivery.py` 在当前 PR Status Sync Run 内调用。

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

其中：

```text
verify_agent.required = false
→ 不要求 Verify Agent PASS

verify_agent.required = true
→ 必须存在基于当前候选 Commit Set 的 Verify PASS
```

Gate 输入必须来自当前 Delivery / Development Facts，以及每个 required Repository Change 的 `current_pr`；不得把 `pr_history` 中已经 Abandoned / 被替代的历史 PR 继续算作 required PR。

结果：

```text
PASS
→ 允许进入 Merge 后收口

FAIL
→ 不允许关闭；等待缺失条件

UNKNOWN
→ 必要 Evidence / PR Facts 无法可靠确认
→ 不允许关闭，交 Delivery Lead / Human
```

---

# 20. Post-Merge Workspace Reconciliation

PR Transition Gate PASS 后，由 `finalize-delivery.py` 执行 Merge 后本地工作区对齐，不需要额外 Delivery Lead Run。

目标不是“切回上一次分支”，而是回到每个 PR 明确记录的 `target_branch`：

```text
For each required Repository:
    git fetch --prune origin
    git switch <target_branch>
    git pull --ff-only origin <target_branch>
```

如果 TFS 在完成 PR 时删除了远程 Source Branch，本地 Source Branch 可按团队策略安全清理：

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

此时返回 `UNKNOWN / blocked`，交 Delivery Lead / Human 处理；不得使用 `reset --hard` 等破坏性操作掩盖状态冲突。

该动作属于 Delivery Finalize，由 `finalize-delivery.py` 在 PR terminal reconciliation 成功后执行。

Merge 后不再自动执行 Integration Verify。后续正常 QA / 测试流程发现的新问题，应登记新的 TFS Bug / Requirement，并形成新的 Delivery Issue。

---

# 21. Delivery Completion Gate

Delivery Completion Gate 保持独立检查职责，但不对应独立 Agent Run。正常 Happy Path 中由 `finalize-delivery.py` 调用。

关闭 Delivery Issue 前必须确认：

```text
[ ] Analysis Gate PASS
[ ] Delivery Issue 已通过 `analys_review` Human Gate
[ ] 所有 required Development Units = Development Ready
[ ] 所有 Development Units 的 Local Validation PASS
[ ] 所有 Development Units 的 Code Review PASS
[ ] verify_agent.required=false，或 Verify Agent PASS
[ ] Verify PASS 对应当前候选 Commit Set（如果 required）
[ ] 所有 required current PR `provider_status = completed`
[ ] Post-Merge Workspace Reconciliation 成功
[ ] 无 unresolved blocker
```

统一输出：

```yaml
result: PASS | FAIL | UNKNOWN
```

Delivery Completion Gate 不要求 Post-Merge Integration Verify。

---

# 22. Final Completion

正常 Happy Path 的 Final Completion 由 `finalize-delivery.py` 确定性完成：

```text
PR Transition Gate PASS
    ↓
Post-Merge Workspace Reconciliation PASS
    ↓
Delivery Completion Gate PASS
    ↓
模板化 Final Delivery Summary
    ↓
归档本次 Delivery 产物（如当前 Route 要求）
    ↓
更新 TFS Work Item
    ↓
记录 PR / Verify 结果
    ↓
Delivery Issue → done
```

Final Delivery Summary 默认从 Analysis Package、Development Evidence、Verification Report 与 PR Facts 模板化生成。高质量自然语言 Summary 可以作为 optional enhancement，但不得阻塞 Delivery Completion。

只有 Finalize 返回 `UNKNOWN`、事实冲突或无法安全更新外部系统时，才升级 Delivery Lead / Human。

当前方案不默认增加 Final Human Confirmation。

`in_review` 在当前方案中专门表示：

```text
所有 required PR 已创建
→ 等待 TFS PR `completed` 或 `abandoned` 终态
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
| Delivery Lead | Leader | delivery-flow / delivery-gate（仅 routing / dispatch / exception） |
| Workitem Analyst | Member | requirement-analysis / bug-analysis / analysis-completion |
| Backend Engineer | Member | backend-development / pull-request |
| Frontend Engineer | Member | frontend-development / pull-request |
| Flink Engineer | Member | flink-development / pull-request |
| Verify Agent | Member | acceptance-verification / pull-request |
| TFS Sync Agent | Squad 外 | tfs-sync |
| PR Status Sync | Squad 外 | pr-status-sync / delivery-flow（terminal finalize） |

Code Review 属于 Engineer Development 内部机制；具体采用 Engineer 自检、read-only reviewer subagent 或 `code-review` Skill，由 Engineer Development Design 进一步定义。`pull-request` 是 Engineer / Verify Agent 都可在当前 Run 尾部调用的共享确定性 capability；出现在 Agent 可用 Skill 中只表示可调用，不代表 PR 语义责任从 Engineer 转移。

---

# 25. 推荐 Skill 目录

```text
workspace-skills/
│
├── tfs-sync/
│   └── scripts/                 # 同步确定性实现；Agent 仅作 thin adapter
│
├── requirement-analysis/
├── bug-analysis/
├── analysis-completion/
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
│       └── delivery-flow-contract.md
│
├── backend-development/
├── frontend-development/
├── flink-development/
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
└── task-close/                  # 如仍需独立 TFS close method，可被 finalize-delivery 调用
```

职责边界：

```text
delivery-flow
= 确定性阶段边界、路由、物化、Ready 聚合、Finalize orchestration

delivery-gate
= 纯检查函数 / PASS | FAIL | UNKNOWN

pull-request
= PR Materialization 副作用

pr-status-sync
= PR 外部事实 reconciliation
```

Gate 可以保持独立函数和独立责任，但不要求独立 Agent Run：

> **Gate 独立 ≠ Session 独立。**

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

适合：

```text
必填字段是否存在
Task Graph 是否合法
depends_on 是否有效
是否存在 cycle
Human Analysis Review Comment 是否为合法 APPROVED / REJECTED Contract
approved Development Units 如何物化
Role → Agent Mapping
TFS Type → 是否创建 TFS Task
所有 required Development Units 是否 Development Ready
Local Validation / Code Review Evidence 是否存在
已批准的 verify_agent.recommendation 是否存在
verify_agent.required 是否已由批准 Recommendation 正确物化
Verify PASS 是否对应当前 Commit Set
Development Unit → Engineer Mapping
PR Preparation 必填 Facts 是否完整
Branch HEAD 是否与 candidate_commit 一致
required PR 是否已存在 / 是否需要创建
所有 required PR 是否已登记
PR 查询身份是否与登记事实一致
provider_status 是否 active / completed / abandoned
所有 required current PR 是否 completed
Human 已给出 NEXT 后的明确路由
Delivery Finalize 是否满足全部 Gate
blocker 是否为 0
```

交给：

```text
Gate
Guard
Script
API State
```

## LLM / Human Semantic Decision

Workitem Analyst 负责：

```text
需求影响哪些 Repository
Bug 根因是什么
Task 应如何拆
是否存在真正独立 Development Unit
是否推荐 Verify Agent 独立验收
Verify Agent 应重点覆盖哪些 Acceptance Criteria / 行为
```

Human Analysis Review 负责确认：

```text
Analysis Package 是否可进入 Development
Verify Agent Recommendation（REQUIRED / NOT REQUIRED）是否合理
```

Delivery Lead 正常情况下不重新判断 Development Topology 或 Verify Agent 是否必要，只执行已批准事实和确定性 Route。

Delivery Lead 只在以下情况介入协调 / 升级：

```text
批准结果缺失 / 冲突
当前事实与已批准 Analysis 明显不一致
跨任务失败无法可靠归因
Human Decision 不完整或 NEXT 无法唯一执行
确定性 Route / Gate 返回 UNKNOWN
```

Human 已明确 abandoned 分类和 `NEXT` 后，下一步优先由 `route-human-decision.py` 确定性执行；Delivery Lead 不重新解释明确 Human Decision。

Human Decision 继续负责：

```text
abandoned 是 REJECTED 还是 DISCARDED
下一步是 ANALYSIS / ENGINEERING / RECREATE_PR / CANCEL_DELIVERY
```

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
TFS Sync Agent Thin Run
→ deterministic tfs-sync scripts
 ↓
Delivery Issue → todo
 ↓
Delivery Lead Thin Native Run
→ start-analysis.py
→ @Workitem Analyst
 ↓
Workitem Analyst Semantic Analysis
 ↓
Analysis Gate
 ↓
Human Analysis Review
 ↓
Delivery Lead Thin Native Run
→ apply-analysis-review.py
→ materialize-development.py
→ @Engineer
 ↓
Engineer Semantic Development
→ Local Validation
→ Code Review
→ Commit / Push
→ PR Preparation
→ Development Ready Facts
→ check-development-readiness.py
 ↓
READY + Verify NOT REQUIRED
→ same-run PR Materialization
 ↓
in_review
 ↓
PR Status Sync Thin Run
→ reconcile-pr-status.py
 ↓
all required PR completed
→ same-run finalize-delivery.py
→ PR Transition Gate
→ Post-Merge Reconciliation
→ Delivery Completion Gate
→ Summary Render / TFS Close / Done
```

Happy Path 中 Delivery Lead 仍可按 Squad 原生机制被唤醒，但只执行极薄的 route / materialization dispatch，不承担专业语义工作。

## 复杂需求 / 需要独立验收

```text
Delivery Lead Thin Run
→ start-analysis.py
→ @Workitem Analyst
 ↓
Workitem Analyst
→ Development Units
→ Acceptance Criteria
→ Verification Requirements
→ Verify Agent Recommendation: REQUIRED
 ↓
Human Analysis Review
 ↓
Delivery Lead Thin Run
→ materialize-development.py
→ @Engineer A / B / C
 ↓
Engineer A → Local Validation → Code Review → Commit / Push → Ready Facts
Engineer B → Local Validation → Code Review → Commit / Push → Ready Facts
Engineer C → Local Validation → Code Review → Commit / Push → Ready Facts
 ↓
每个 Engineer same-run 调用 check-development-readiness.py
 ↓
最后一个结果 = READY
→ @Verify Agent
 ↓
Verify Agent Behavior-oriented Acceptance Verification
→ Acceptance / Runtime / Integration / E2E（按需）
 ↓
Verification Gate PASS
→ same-run PR Materialization
 ↓
in_review
 ↓
PR Status Sync Thin Run
→ completed
→ same-run finalize-delivery.py
→ Done
```

如果 Multica 原生 Squad 机制在 Engineer / Verify handoff 时额外唤醒 Delivery Lead，Lead 只读取已存在的 Route Result / Facts，执行必要 dispatch 或直接 no-op，不重复语义判断。

Verify FAIL：

```text
Verify Agent
→ Finding 语义归因到 Development Unit
→ route-verify-result.py
→ @对应 Engineer
→ Targeted Fix
→ Local Validation
→ Code Review
→ Commit / Push
→ Ready Check
→ Verify Again
```

Merge 后正常 QA / 测试发现的新问题进入新的 TFS Bug / Requirement，不在当前 Delivery 内继续建立自动 Post-Merge Integration Verify 回路。

---

# 30. 核心设计原则

> **一个 TFS Work Item 默认对应一个 Delivery Issue。**

> **Delivery Issue 默认交给 Delivery Squad。**

> **能确定性化的业务规则、Gate、副作用、幂等、物化全部进入 Script / Gate / Route；不要让 Agent 重复思考。**

> **Happy Path 允许 Multica 按 Squad 原生机制唤醒 Delivery Lead，但 Delivery Lead 只做极薄的 routing / deterministic capability dispatch；真正语义工作只发生在 Workitem Analyst、Engineer、Verify Agent。**

> **Delivery Lead 是 Delivery Squad 的 Thin Squad Router + Stage-boundary Adapter + Exception Coordinator；Happy Path 只做确定性 dispatch，异常时负责澄清与升级，不替代 Specialist 做专业语义判断。**

> **Local Validation + Code Review 是 Development 必备环节，与 Verify Agent 是否参与无关。**

> **Code Review = implementation-oriented；Verify Agent = behavior-oriented。**

> **Verify Agent 不依赖 Engineer 的实现过程，从 Acceptance Criteria / Verification Requirements 重新验证最终行为。**

> **Verify Agent 是按需的 Delivery-level 独立验收者，不是每个 Engineer 完成后的固定步骤。**

> **Verify Agent 是否需要不由 Route 预设默认值；Workitem Analyst 按 Acceptance Criteria、Verification Requirements 与交付复杂度给出 REQUIRED / NOT REQUIRED 推荐，Human Analysis Review 最终确认。**

> **是否需要 Verify Agent 由 Workitem Analyst 提出，Human Analysis Review 确认；正常 Happy Path 由当前 Engineer / Verify Agent Run 按已批准事实继续推进，Delivery Lead 只处理异常与 `UNKNOWN`。**

> **Integration / E2E Verification 是 Verify Agent 的验证方式，不再是独立 Post-Merge Stage。**

> **Engineer 在原 Development Run 内完成 Commit / Push 与 PR Preparation，固定候选版本和 PR 语义；无需为了后续创建 PR 再启动 Engineer Session。**

> **PR Materialization 采用 same-run deterministic tail：无需 Verify 时由满足全部 Ready 条件的当前 Engineer Run 调用；需要 Verify 时由 Verification Gate PASS 的当前 Verify Agent Run 调用；不为纯确定性副作用额外启动 Delivery Lead Session。**

> **PR 是 Repository 级交付对象；每个发生代码变更的 Repository 必须独立 PR；多个 Repository 的 required PR 可以在一次幂等 Materialization Run 中创建。**

> **Stage 只用于独立 Development Units 之间的依赖。**

> **External State Sync 不复制 TFS PR Review 过程；PR 自动判断只认 provider `status`。**

> **Merge 后不再自动执行 Integration Verify；后续 QA / 测试发现的问题形成新的 Work Item / Delivery。**

> **不建设第二套全局 Workflow Runtime。**

---

# 31. 架构总结

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
      ├── Delivery Lead（Thin Router）
      ├── Workitem Analyst
      ├── Engineer(s)
      └── Verify Agent（按需）
      │
      ▼
Optional Development Sub-Issues
      │
      ▼
Engineer Development
- Local Validation
- Code Review
- Commit / Push
      │
      ▼
All Required Development Ready
      │
      ├── Verify not required → current Engineer Run ─┐
      │                                                │
      └── Verify required → Verify Agent              │
                         → Behavior PASS               │
                         → current Verify Agent Run ───┘
                                                       │
                                                       ▼
                                               PR Materialization
                                           │
                                           ▼
                                      Create PR(s)
                                           │
                                           ▼
                                     PR Completion
                                           │
                                           ▼
                              Deterministic Finalize
                    - PR Transition / Reconciliation / Completion
                                           │
                                           ▼
                                    Final Completion
```

其中：

```text
Squad
= 多角色协作

Sub-Issue
= 独立 Development Unit

Engineer Development
= Implementation + Local Validation + Code Review

Verify Agent
= 按需 Behavior-oriented Acceptance Verification

Integration / E2E
= Verify Agent 可选验证方法

PR
= Repository 级交付对象

Gate
= 硬条件和完成条件

Multica
= Runtime 和状态
```

这套设计保留独立验收能力，但避免把 Verify Agent 固化为每个 Engineer 后的重复检查，也避免 Merge 后再次建立一套自动 Integration Verify 流程。

---

# v1.4.2 变更摘要

相对 v1.4.1，本版本根据 Session / Deterministic Review 与 Multica 原生机制适配性复核进一步收敛：

- 保留 Squad-centric Leader-first 入口，不再追求 Happy Path `Delivery Lead Run = 0`；Delivery Lead 正式定位为 **Thin Squad Router + Stage-boundary Adapter + Exception Coordinator**；
- 新增全局硬原则：**能确定性化的业务规则、Gate、副作用、幂等、物化全部进入 Script / Gate / Route，不让 Agent 重复思考**；
- 新增全局硬原则：**Happy Path 允许 Multica 按 Squad 原生机制唤醒 Delivery Lead，但 Lead 只做极薄 routing / deterministic capability dispatch；真正语义工作只发生在 Workitem Analyst、Engineer、Verify Agent**；
- Delivery Issue `todo` 启动仍允许 Multica 原生唤醒 Delivery Lead，但 Lead 只调用 `start-analysis.py` 并 `@Workitem Analyst`；
- Workitem Analyst 的 Analysis Package 正式包含 Development Units / Development Topology Candidate；Human Review 审核该 Topology 与 Verify Recommendation；
- Human `APPROVED / REJECTED` 后继续允许 Squad 原生唤醒 Delivery Lead，但 Lead 不做二次语义分析，只调用 `apply-analysis-review.py`、`materialize-development.py` 或定向返工 Route；
- Development Topology 的语义 Owner 明确为 Workitem Analyst；Human 负责批准；`materialize-development.py` 负责创建 Sub-Issue、Role → Agent Mapping、TFS Task、`verify_agent.required` 与 Engineer Assignment；
- `Development Readiness Check` 正式归属 Deterministic Script：Engineer 只产生当前 Unit 的 Ready Facts，并 same-run 调用 `check-development-readiness.py`；结果统一为 `NOT_READY | READY | UNKNOWN`；
- Verify FAIL 后，Verify Agent 只负责把 Finding 语义归因到 Development Unit；`route-verify-result.py` 负责 Unit → Engineer 的确定性路由；
- PR Completed Happy Path 不再写 Comment 唤醒 Delivery Lead；`pr-status-sync` 在当前 Run 内调用 `finalize-delivery.py`，依次执行 PR Transition Gate、Post-Merge Workspace Reconciliation、Delivery Completion Gate、模板化 Summary、TFS Close 与 Issue Done；
- Gate 保持独立函数和独立职责，但不再默认对应独立 Agent Run，正式采用 **Gate 独立 ≠ Session 独立**；
- Final Delivery Summary 默认模板化生成，LLM 自然语言 Summary 仅作为 optional enhancement，不阻塞 Completion；
- PR Abandoned 的业务分类仍由 Human 决定；Human 已明确 `NEXT` 后优先由 `route-human-decision.py` 确定性执行，Delivery Lead 只处理缺失、冲突或 `UNKNOWN`；
- TFS Sync / PR Status Sync 继续保留 Multica Autopilot Agent Run 兼容性，但定位为 Thin Agent Adapter + Deterministic Script，不为减少 Run 引入第二套外部 Workflow Runtime；
- 推荐新增 `delivery-flow` 确定性脚本集合：`start-analysis.py`、`apply-analysis-review.py`、`materialize-development.py`、`check-development-readiness.py`、`route-verify-result.py`、`route-human-decision.py`、`finalize-delivery.py`。

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
