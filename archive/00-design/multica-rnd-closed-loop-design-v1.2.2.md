# Multica 研发任务闭环方案 v1.2

> 版本：v1.2.2\
> 日期：2026-09-19\
> 目标：基于 Multica 构建“需求同步 → 需求分析 → 人工审核 → 多任务研发 → 自动 Verify → PR 人工审核 → 集成验证（按需）→ 归档”的研发闭环。\
> 核心原则：充分利用 Multica 的 Runtime、Issue、Run、Stage、Agent 与 `@mention` 机制；正常路径优先采用确定性规则推进，Delivery Lead 只处理阶段边界、复杂协调与异常，不再作为所有步骤的全局调度器。

> v1.2.1 修订：将原有 “Deterministic Gate / Analysis Deterministic Gate” 正式统一升级为 **Deterministic Gate Layer**，并明确 **Deterministic Decision 与 LLM Decision 的职责边界**。
>
> v1.2.2 修订：新增 **External State Sync** 外部状态回流机制。PR Review / Merge 等发生在 TFS / Git 平台的外部事实，通过 **Multica Autopilot + tfs-mcp 定时轮询**同步回 Multica，再由 Deterministic Gate / Route 驱动 Engineer 返工或 Development Issue 完成。

***

# 1. v1.2 核心变化

v1.2 相比 v1.1 的核心修正有五项。

## 1.1 Delivery Lead 降级为“阶段边界协调者”

不再采用：

```text
所有 Agent
   ↓
Delivery Lead
   ↓
下一个 Agent
```

改为：

```text
正常路径
    ↓
Deterministic Route / Gate
    ↓
直接进入下一个 Agent

只有 Stage Boundary / Exception / Ambiguity
    ↓
Delivery Lead
```

Delivery Lead 不再承担全局逐步调度。

***

## 1.2 TFS Sync 直接完成第一跳路由

TFS Sync 不只创建 Parent Issue。

它同时创建：

```text
Parent Issue
└── Stage 1
    └── Analysis Child Issue
```

并完成：

```text
Analysis Child
assignee = Workitem Analyst
status   = backlog
```

上下文初始化完成后：

```text
Analysis Child
backlog → todo
```

从而直接启动 Workitem Analyst。

第一跳不需要 Delivery Lead，也不需要 LLM 做 Agent 选择。

***

## 1.3 Development Issue 的 Owner 始终是 Engineer

Engineer 编码完成后：

```text
@Verify Agent
```

让 Verify 临时进入当前 Development Issue 执行验证。

不修改 Development Issue 的 assignee。

```text
Development Issue
assignee = Engineer

Engineer
   ↓
@Verify
   ↓
Verify
   ↓
FAIL → @Engineer
PASS → Engineer 创建/更新 PR
```

***

## 1.4 PR 属于 Engineer 的交付职责

Verify PASS 后，不回到 Delivery Lead 创建 PR。

Engineer 的完整交付职责包括：

```text
coding
test
build
commit
push
Verify feedback fix
PR create / update
PR review feedback fix
```

因此无需额外增加 PR Agent。

***

## 1.5 Development Issue 的 Done 条件改为 PR Merge

不再定义：

```text
Verify PASS
→ Development Issue done
```

而是：

```text
Verify PASS
→ PR
→ Human Review
→ Merge
→ Development Issue done
```

只有全部 Development Issues 完成，Stage 才完成，再唤醒 Parent 上的 Delivery Lead。

***

## 1.6 新增 External State Sync：外部 PR 状态回流

PR Review、Reviewer Vote、PR Merge 等动作发生在 TFS / Git 平台，Multica Runtime 不应假设天然可感知这些外部变化。

v1.2.2 新增一层非常薄的：

```text
External State Sync
```

当前默认实现采用：

```text
Multica Autopilot
        ↓
     tfs-mcp
        ↓
定时查询 in_review Development Issues 对应 PR
        ↓
检测 PR 状态变化
        ↓
同步回 Multica
        ↓
Deterministic Gate / Route
```

核心规则：

```text
PR Changes Requested
→ Sync
→ @Engineer

PR Approved
→ Sync 状态
→ 等待 Merge（或按团队策略触发 Complete）

PR Merged
→ Sync
→ PR Transition Gate
→ Development Issue done

Unknown / abnormal state
→ Delivery Lead
```

External State Sync **只负责同步外部事实，不负责语义判断，也不承担全局工作流编排**。

***

# 2. 总体架构

```text
                     TFS / PR Platform
                      │            │
               Work Item       PR Review / Merge
                      │            │
                      ▼            ▼
                TFS Sync      PR Status Sync
                  Agent        Autopilot
                      │            │
                      │         tfs-mcp
                      │            │
                      └──────┬─────┘
                             ▼
                      Multica Runtime
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
        Parent Issue                   Analysis Issue
   assignee=Delivery Lead           assignee=Analyst
       status=backlog                status=backlog
              │                             │
              │                       context ready
              │                             │
              │                       backlog → todo
              │                             │
              │                             ▼
              │                          Analyst
              │                             │
              │                 Analysis Deterministic Gate
              │                             │
              │                        Human Review
              │                             │
              │                           done
              │                             │
              └────── Stage 1 Complete ─────┘
                             │
                             ▼
                     Delivery Lead
                    （阶段边界唤醒）
                             │
                   materialize Task Graph
                             │
             ┌───────────────┼───────────────┐
             ▼               ▼               ▼
           DEV-A           DEV-B           DEV-C
        Engineer A      Engineer B      Engineer C
             │               │               │
             ▼               ▼               ▼
          @Verify          @Verify          @Verify
             ↕               ↕               ↕
         Engineer A      Engineer B      Engineer C
             │               │               │
         Verify PASS      Verify PASS      Verify PASS
             │               │               │
             ▼               ▼               ▼
         Create PR        Create PR        Create PR
             │               │               │
         in_review        in_review        in_review
             │               │               │
             └──── External PR Platform ─────┘
                             │
                    Human PR Review / Merge
                             │
                    PR Status Sync Polling
                             │
              ┌──────────────┴──────────────┐
              │                             │
      Changes Requested                  Merged
              │                             │
              ▼                             ▼
          @Engineer                PR Transition Gate
              │                             │
              └→ fix → @Verify             ▼
                                      DEV Issue done
                                             │
                     All DEV done ───────────┘
                             │
                             ▼
                     Delivery Lead
                    （阶段边界唤醒）
                             │
                 Integration Verify required?
                      ↙                  ↘
                    YES                  NO
                     │                    │
                     ▼                    │
               Stage 3 Verify             │
                     │                    │
                    done                  │
                     └──────────┬─────────┘
                                ▼
                         Delivery Lead
                                │
                        Parent Completion
                                │
                           TFS → Done
                                │
                        Parent → Done
```

***

# 3. 核心职责模型

整个系统分为六层。

```text
External State Sync
    = 将 TFS / PR Platform 等外部事实同步回 Multica；默认由 Autopilot + tfs-mcp 轮询实现

Multica Runtime
    = 运行、状态、Run、Issue、Stage、Agent Trigger

Deterministic Gate Layer
    = Validator / Guard / Routing / Completion Check

Deterministic Delivery Flow
    = 根据 Gate 结果执行正常 Happy Path 推进

Specialist Agent
    = Analyst / Engineer / Verify 的专业工作

Delivery Lead
    = Stage Boundary + Exception + Semantic Coordination
```

其中最重要的职责边界：

```text
External State Sync
    读取并同步 Multica 之外发生的事实，不做语义编排

Multica
    保存流程事实状态

Deterministic Gate Layer
    判断硬条件是否满足

Deterministic Delivery Flow
    根据确定性结果推进标准路径

LLM / Specialist Agent
    处理语义分析和专业执行

Delivery Lead
    处理无法确定、跨任务、异常和阶段边界问题
```

**Deterministic Gate 的结果对正常流程具有约束力。**

例如：

```text
Gate = FAIL
```

则 LLM 不允许仅凭主观判断将其改成 PASS 并继续推进。

如果 Gate 本身出现规则缺陷、数据缺失或无法判定：

```text
UNKNOWN / NEEDS_REVIEW
```

则升级给 Delivery Lead 或 Human，而不是让普通 Agent 猜测。

***

# 4. Multica 的职责

Multica 作为 Runtime 层负责：

- Issue 持久化；
- Parent / Child Issue；
- Status；
- Stage；
- Assignee；
- Agent Run；
- `@mention` Agent；
- 多次 Run 历史；
- Agent 运行与恢复；
- Autopilot / 定时执行；
- 阶段完成后的 Parent 唤醒；
- 接收 External State Sync 写回的 PR / Review / Merge 状态。

因此不再额外实现：

```text
Workflow Runner
Python Coordinator
Global State Machine Service
```

除非未来出现强一致、复杂补偿、严格审计等明确需求。

***

# 5. 状态唯一事实来源

**研发流程状态的唯一事实来源仍然是 Multica。**

但对于 PR Review、Reviewer Vote、Merge、Build Policy 等发生在外部平台的事实：

```text
External Platform = 外部事实源
External State Sync = 状态回流入口
Multica = 流程状态唯一事实来源
```

外部事实必须先同步进入 Multica，后续 Gate / Route 才基于 Multica 中的已同步状态继续执行。

研发流程状态只来自 Multica：

```text
Issue
Status
Stage
Sub-Issue
Run
Comment
Metadata
```

不得额外维护：

```text
workflow-state.json
current-phase.yaml
delivery-state.md
```

Skill 可以包含确定性的：

- Validator；
- Guard；
- Gate；
- Routing Rule；

但不维护第二套持久化全局状态。

***

# 6. TFS Sync 阶段

## 6.1 TFS Sync Agent 的职责

TFS Sync Agent / Autopilot 负责：

1. 从 TFS 查询需要进入研发流程的 Work Item；
2. 创建 Parent Issue；
3. Parent 指派给 Delivery Lead；
4. 创建 Stage 1 Analysis Child Issue；
5. Analysis Child 指派给 Workitem Analyst；
6. 将 Parent 和 Analysis Child 初始状态设为 `backlog`；
7. 写入必要的 TFS Context；
8. Context 初始化完成后，把 Analysis Child 从 `backlog` 切换到 `todo`；
9. 结束 Sync Run。

***

## 6.2 启动哪个 Issue

启动分析时修改的是：

```text
Analysis Child Issue
```

不是 Parent Issue。

推荐：

```text
Parent Issue
status   = backlog
assignee = Delivery Lead

Analysis Issue
status   = backlog
assignee = Workitem Analyst
```

准备完成后：

```text
Analysis Issue
backlog → todo
```

Parent 不需要同步切换为 `todo` 才能开始 Analysis。

Parent 的主要职责是：

> 整个 TFS Work Item 的交付容器和 Stage 边界承载者。

***

# 7. Analysis 阶段

## 7.1 Workitem Analyst 职责

Workitem Analyst 负责产出：

```text
Analysis Package
├── Problem / Requirement
├── Current Behavior
├── Expected Behavior
├── Root Cause（Bug）
├── Solution
├── Impact Scope
├── Repository Scope
├── Acceptance Criteria
├── Development Task Graph
├── Dependencies
├── Verification Requirements
└── Risks
```

***

## 7.2 Analyst 不创建正式 Development Issues

Analyst 只输出：

```text
Development Task Graph
```

例如：

```yaml
development_tasks:
  - id: DEV-01
    role: backend
    repo: winning-dps-df-service
    acceptance_criteria:
      - AC-01
      - AC-02
    depends_on: []

  - id: DEV-02
    role: frontend
    repo: winning-dps-df-web
    acceptance_criteria:
      - AC-03
    depends_on:
      - DEV-01

  - id: DEV-03
    role: flink
    repo: winning-dps-df-flink
    acceptance_criteria:
      - AC-04
    depends_on:
      - DEV-01
```

正式 Development Issue 必须在 Analysis 人工审核通过之后再创建。

***

# 8. Deterministic Gate Layer：Analysis Gate

## 8.1 Analysis Deterministic Gate

Analysis 完成后必须先经过 Deterministic Gate Layer 的分析校验。

这个 Gate 的职责不是“评价方案是否优秀”，而是判断：

> Analysis Package 是否满足进入人工审核所要求的硬性 Contract。

Analysis Deterministic Gate 应优先由脚本、Schema、规则和结构化数据完成，而不是依赖 LLM 主观判断。

适合代码判断的内容包括：

```text
Solution 是否存在
Impact Scope 是否存在
Repository Scope 是否为空
Acceptance Criteria 是否存在
每个 Development Task 是否指定 repo
每个 Task 是否绑定 AC
depends_on 是否引用有效 task
Task Graph 是否存在 cycle
Verification Requirements 是否存在
```

推荐输出：

```yaml
gate:
  name: analysis
  result: PASS | FAIL | UNKNOWN

errors:
  - code:
    field:
    message:

evidence:
  - ...
```

语义：

```text
PASS
→ 满足硬性 Contract，可以进入 Human Analysis Gate

FAIL
→ 不允许进入下一阶段，必须修复明确失败项

UNKNOWN
→ 当前规则或数据无法可靠判断，升级 Delivery Lead / Human
```

***

## 8.2 Human Analysis Gate

只有 Analysis Deterministic Gate PASS 后：

```text
Analysis Issue → in_review
```

等待人工：

```text
Approve
Reject
```

Reject：

```text
Human Feedback
     ↓
Workitem Analyst
     ↓
Targeted Rework
     ↓
Deterministic Gate
     ↓
Human Review
```

Approve：

```text
Analysis Issue → done
```

然后 Stage 1 完成。

***

# 9. Stage 1 完成后的 Delivery Lead

这是 Delivery Lead 第一次真正需要进入正常流程的位置。

Stage 1 完成后：

```text
Multica
   ↓
Parent Issue
assignee = Delivery Lead
   ↓
wake Delivery Lead
```

Delivery Lead 读取：

- Approved Analysis Package；
- Development Task Graph；
- Dependencies；
- Repository；
- Role；
- Verification Requirements。

然后调用确定性的 task materialization / routing 逻辑。

***

# 10. Development Task 创建

Delivery Lead 负责实例化已经批准的 Task Graph。

注意：

> Delivery Lead 负责“创建”，但不应自由发挥重新设计 Task Graph。

正常情况下应严格按已批准的 Analysis Package 创建。

***

## 10.1 Agent Routing

优先使用确定性 Routing Table：

```yaml
routing:
  backend: Backend Engineer
  frontend: Frontend Engineer
  flink: Flink Engineer
  verify: Verify Agent
```

例如：

```text
role = backend
    ↓
Backend Engineer
```

以下情况才升级给 Delivery Lead 做语义判断：

- role 无法识别；
- 一个 Task 同时跨多种角色；
- Task Graph 出现冲突；
- Repository 归属不明确；
- 需要重新拆 Task。

***

## 10.2 Development Issue 初始化

推荐：

```text
DEV-01
status   = backlog
assignee = Backend Engineer
```

先写入完整上下文：

```text
Parent
Repository
Goal
Relevant Analysis
Acceptance Criteria
Dependencies
Interfaces / Contracts
Constraints
Verification Requirements
```

准备完成后：

```text
backlog → todo
```

从而启动对应 Engineer。

***

# 11. Stage 设计

Stage 只表达粗粒度依赖。

例如：

```text
DEV-01
  ↓
DEV-02
DEV-03
```

可以映射为：

```text
Stage 2
└── DEV-01

Stage 3
├── DEV-02
└── DEV-03
```

如果多个任务无依赖，则同一 Stage 并行：

```text
Stage 2
├── DEV-A
├── DEV-B
└── DEV-C
```

不要把：

```text
Engineer
Verify
PR
```

拆成不同 Stage。

它们都属于同一个 Development Issue 的生命周期。

***

# 12. Development Issue 生命周期

Development Issue 的完整生命周期：

```text
backlog
   ↓
todo
   ↓
in_progress
   │
   ▼
Engineer
   │
   ▼
@Verify
   │
 ┌─┴────┐
 │      │
FAIL   PASS
 │      │
 ▼      ▼
Engineer  Create/Update PR
  ↺             │
                ▼
            in_review
                │
                ▼
         External PR Platform
                │
          Human PR Review
            ↙         ↘
 Changes Requested    Approve / Merge
          │                │
          └──────┬─────────┘
                 ▼
          PR Status Sync
       (Autopilot + tfs-mcp)
            ↙         ↘
 Changes Requested    Merged
          │              │
          ▼              ▼
      @Engineer     PR Transition Gate
          │              │
     targeted fix        PASS
          │              │
       @Verify           ▼
          │             done
      Update PR
```

因此：

> Development Issue 的 Done 条件是 **PR Merge + PR Transition Gate PASS**，而不是 Verify PASS。

PR Review 发生在外部平台时，必须先通过 External State Sync 回流到 Multica，不能依赖 Engineer Agent 自己持续等待或驻留。

***

# 13. Engineer 的职责

Engineer 是 Development Issue 的长期 Owner。

职责包括：

```text
实现代码
补测试
build
lint
commit
push
修复 Verify Finding
创建 / 更新 PR
修复 PR Review Feedback
```

不单独增加 PR Agent。

***

# 14. Engineer → Verify

Engineer 编码完成后：

```text
@Verify Agent
```

Verify 作为临时执行者进入当前 Development Issue。

不修改：

```text
Development Issue.assignee
```

它仍然属于 Engineer。

***

# 15. Verify 反馈闭环

## 15.1 Verify FAIL

```text
Verify
   ↓
Verification Report
   ↓
@Engineer
   ↓
Engineer targeted fix
   ↓
@Verify
```

Verification Report 推荐：

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
      suggestion: ...
```

***

## 15.2 Verify PASS

PASS 后不回 Delivery Lead。

直接：

```text
Engineer
   ↓
Create / Update PR
   ↓
Development Issue → in_review
   ↓
Human PR Review
```

***

# 16. PR Review 与外部状态回流

PR Review 是典型的 **Multica 外部动作**。

Engineer 创建 / 更新 PR 后：

```text
Development Issue → in_review
```

Engineer Run 可以结束，不需要保持会话等待人工审核。

后续由 `PR Status Sync` 定时获取外部 PR 状态并回写 Multica。

***

## 16.1 PR Status Sync：默认采用 Autopilot + tfs-mcp

v1.2.2 第一阶段不新增 Webhook Service。

默认实现：

```text
Multica Autopilot
      │
      │ 定时运行
      ▼
查询 Multica 中：
status = in_review
且存在 pr.id 的 Development Issues
      │
      ▼
根据 pr.id / repository
调用 tfs-mcp 查询 PR 当前状态
      │
      ▼
与 Multica 中已记录状态比较
      │
      ├─ 无变化 → no-op
      │
      └─ 有变化 → 写回 Multica
                       │
                       ▼
              Deterministic Route / Gate
```

推荐轮询周期从 **3～5 分钟**开始，具体频率由团队对审核反馈延迟的容忍度决定。

轮询只处理 `in_review` 且存在有效 PR 映射的 Development Issue，避免全量扫描。

***

## 16.2 Development Issue 与 PR 的确定性映射

Engineer 创建 PR 后，必须将 PR 映射写回当前 Development Issue。

推荐 metadata：

```yaml
delivery:
  repository: winning-dps-df-service
  branch: feature/12345-dev-01

  pr:
    id: 18452
    url: ...
    status: active
    review_status: waiting
    last_sync_at: ...
```

核心映射必须能够确定：

```text
Development Issue ID ↔ Repository ↔ PR ID
```

因此 PR Status Sync 收到 `PR 18452` 的状态后，可以确定性找到对应 Development Issue，不需要 LLM 判断 PR 属于哪个任务。

***

## 16.3 PR Changes Requested

外部平台出现：

```text
PR Review = Changes Requested
```

PR Status Sync 执行：

```text
1. 查询 PR review feedback
2. 找到对应 Development Issue
3. 写入 review status / review feedback / sync timestamp
4. 保持 Development Issue.assignee = Engineer
5. @Engineer
```

流程：

```text
PR Changes Requested
        ↓
PR Status Sync
        ↓
Development Issue
        ↓
@Engineer
        ↓
Engineer targeted fix
        ↓
@Verify
        ↓
Verify PASS
        ↓
Update PR
        ↓
等待下一轮 Human Review
```

这里不需要 Delivery Lead，因为：

```text
Changes Requested → Engineer
```

是确定性路由。

只有以下情况才升级 Delivery Lead：

- PR Feedback 推翻原 Analysis；
- 需要新增 Repository；
- 需要新增 Development Task；
- 出现跨任务冲突；
- 连续多轮相同问题失败。

***

## 16.4 PR Approved

`Approved` 与 `Merged` 必须区分。

默认推荐：

```text
PR Approved
→ PR Status Sync 写回 Multica
→ 不唤醒 Engineer
→ 等待 PR Merge / Complete
```

如果团队策略要求 Engineer 手工 Complete PR，则可配置为：

```text
PR Approved
→ @Engineer
→ Engineer Complete / Merge
```

但这属于团队 Merge Policy，不应硬编码为默认流程。

***

## 16.5 PR Merged

真正驱动 Development Issue 完成的外部事件是：

```text
PR = Merged / Completed
```

PR Status Sync 检测到 Merge 后：

```text
PR Merged
    ↓
写回 Multica
    ↓
PR Transition Gate
    ↓
Verify == PASS ?
PR == MERGED ?
No unresolved blocker ?
    ↓
PASS
    ↓
Development Issue → done
```

Merged 正常路径不需要再次唤醒 Engineer，也不经过 Delivery Lead。

***

## 16.6 PR Transition Gate

推荐确定性规则：

```python
def development_done(ctx):
    return (
        ctx.verify_status == "PASS"
        and ctx.pr_status == "MERGED"
        and ctx.unresolved_blocker == 0
    )
```

统一结果：

```text
PASS
→ Development Issue = done

FAIL
→ 不允许关闭 Development Issue

UNKNOWN
→ Delivery Lead / Human
```

禁止出现：

```text
PR Merged
→ LLM 主观判断“应该没问题”
→ 直接 done
```

***

## 16.7 PR Status Sync 的职责边界

PR Status Sync 只负责：

```text
查询外部状态
比较状态变化
同步 PR facts / review feedback
触发确定性 route / gate
```

不负责：

```text
理解代码
修改代码
评价 Review 意见是否合理
重新设计 Task Graph
重新做需求分析
全局 Workflow 编排
```

因此它属于：

> External State Sync / Deterministic Delivery Flow 的入口适配器。

而不是新的 Coordinator Agent。

***

# 17. Development Stage 完成

例如：

```text
DEV-A = done
DEV-B = done
DEV-C = done
```

Stage 2 才真正完成。

此时：

```text
Multica
   ↓
wake Parent assignee
   ↓
Delivery Lead
```

这是 Delivery Lead 第二次正常进入流程。

***

# 18. Integration Verify

Delivery Lead 在 Development Stage 完成后判断：

```text
是否需要 Integration Verify？
```

可以使用“确定性规则 + 语义判断”。

典型需要条件：

- 多 Repository；
- API + Consumer；
- 前后端 Contract；
- Event / Schema；
- Flink 与上下游系统；
- 多个 Task 的组合行为才能验证 Parent AC。

***

## 18.1 Integration Verify 作为独立 Child Issue

如果需要：

```text
Stage N
└── Integration Verification
    assignee = Verify Agent
    status   = backlog
```

准备上下文后：

```text
backlog → todo
```

因为这已经是独立交付任务，不再只是 Development Issue 内部一次临时 `@mention`。

***

## 18.2 Integration Verify FAIL

需要定位影响任务：

```text
INT-001 → DEV-02
INT-002 → DEV-04
```

只重新激活受影响任务：

```text
Engineer Fix
    ↓
Task Verify
    ↓
PR / Merge
    ↓
Integration Verify again
```

不无差别重开所有研发任务。

***

# 19. Delivery Lead 的正式定位

v1.2 中 Delivery Lead 不再是 Global Coordinator。

正式定义为：

> Stage Boundary Coordinator + Semantic Exception Handler。

***

## 19.1 Delivery Lead 只在三类场景出现

### A. Stage Boundary

例如：

```text
Analysis Stage done
Development Stage done
Integration Verify Stage done
```

***

### B. Exception / Ambiguity

例如：

```text
Task 无法路由
Task Graph 冲突
跨仓失败归因
Verify 多轮失败
PR Feedback 推翻 Analysis
需要重新拆任务
需要新增 Repository
```

***

### C. Parent Completion

负责：

```text
Completion Gate
TFS 更新
Parent 关闭
```

***

# 20. Delivery Lead 不应该做什么

禁止：

```text
所有 Agent 完成后都先回 Delivery Lead
每次 Verify 都由 Delivery Lead 决定下一步
由 Delivery Lead 创建每一个 PR
由 Delivery Lead 做实际代码修改
由 Delivery Lead 代替 Analyst 分析
由 Delivery Lead 代替 Verify 做正式验证
```

否则 Delivery Lead 会重新变成 LLM Workflow Runner。

***

# 21. Delivery Lead 推荐配置

```yaml
name: Delivery Lead

description: >
  负责阶段边界推进、复杂任务协调、异常处理和最终交付关闭。
  正常确定性 Happy Path 不经过 Delivery Lead。

runtime:
  preferred: Claude Code
  alternative: Codex

model:
  preferred: Claude Sonnet
  alternative: GPT-5.6 Sol

thinking:
  recommended: medium

skills:
  - delivery-coordination
  - development-task-handoff
  - task-close

mcp:
  - tfs-mcp
```

但 `delivery-coordination` Skill 应按 v1.2 缩减职责：

```text
不再负责每一步正常路由
只负责 Stage Boundary + Exception + Completion
```

***

# 22. Deterministic Gate Layer 与 Delivery Flow

Deterministic Gate Layer 是 v1.2.1 的正式架构层。

它负责四类能力：

```text
Validator
    → 输入和产物是否满足 Contract

Guard
    → 当前状态是否允许发生某个转换

Routing
    → 已知 role / repo / result 应路由给哪个 Agent

Completion Check
    → 某个 Issue / Stage / Parent 是否满足完成条件
```

推荐的 Gate：

```text
Analysis Deterministic Gate
Task Graph Deterministic Gate
Development Deterministic Gate
Verification Deterministic Gate
PR Transition Gate
Parent Completion Gate
```

这些 Gate 不负责调用所有 Agent，也不维护全局 workflow state。

它们只接受当前 Multica 状态和结构化产物，输出：

```yaml
result: PASS | FAIL | UNKNOWN
reasons:
  - ...
next_allowed_actions:
  - ...
```

随后由 Deterministic Delivery Flow 根据结果推进正常路径。

正常 Happy Path 应优先由确定性规则推进。

对于发生在外部平台的状态变化，先执行：

```text
External State Sync
→ Multica facts updated
→ Deterministic Gate / Route
```

再进入标准 Happy Path。

```text
TFS Sync
→ Analyst

Analysis Deterministic Gate PASS
→ Human Review

Human Approve + Analysis done
→ Stage Complete
→ Delivery Lead materialize tasks

role=backend
→ Backend Engineer

Engineer completed
→ @Verify

Verify FAIL
→ @Engineer

Verify PASS
→ Engineer create PR

PR Changes Requested
→ PR Status Sync
→ @Engineer
→ @Verify

PR Merged
→ PR Status Sync
→ PR Transition Gate
→ Dev done

All Dev done
→ Stage Complete
→ Delivery Lead
```

***

# 23. Deterministic Decision vs LLM Decision

这是 v1.2.1 的核心设计边界。

原则：

> 能由明确输入、规则、Schema、状态和返回码稳定判断的事情，必须优先 Deterministic。

> 需要理解需求、代码语义、业务关系、影响范围、模糊上下文的事情，交给 LLM。

> 不允许 LLM 覆盖一个已经明确 FAIL 的 Deterministic Gate。

***

## 23.1 Deterministic Decision

适合确定性代码判断：

### Analysis Contract

```text
Required fields 是否存在
Repository Scope 是否为空
Acceptance Criteria 是否存在
每个 Task 是否有 repo / role / AC
depends_on 是否引用有效 Task
Task Graph 是否存在 cycle
Verification Requirements 是否存在
```

### Agent Routing

```text
role=backend  → Backend Engineer
role=frontend → Frontend Engineer
role=flink    → Flink Engineer
```

如果 Routing Table 无匹配：

```text
result = UNKNOWN
→ Delivery Lead
```

而不是随便选择 Agent。

### Development Verification 硬条件

```text
build exit_code == 0
test.failed == 0
lint.blocker == 0
Verify.blocker == 0
required AC coverage 满足约定
```

### PR Transition

```text
Verify PASS
→ 可以进入 PR Human Review

PR Changes Requested
→ Engineer Rework → Verify

PR Approved + Merged + Verify PASS
→ Development Issue done
```

### Completion

```text
Analysis approved
All required Development Issues done
All required PRs merged
All required Verify PASS
Integration Verify PASS if required
No unresolved blocker
```

***

## 23.2 LLM Decision

适合 LLM 判断：

```text
需求真正影响哪些 Repository？
Bug 根因是什么？
Development Task Graph 应如何拆？
某项修改属于 backend 还是 flink 的职责边界？
多个实现方案哪个更符合当前架构？
Integration Failure 应归因哪个 Development Task？
PR Feedback 是否意味着原 Analysis 已失效？
是否需要新增任务或重新进入 Analysis？
无法通过 Routing Table 时应该如何重新规划？
```

这些问题没有稳定的布尔规则，通常需要结合：

```text
需求语义
代码结构
业务上下文
历史实现
接口关系
当前 diff
```

进行推理。

***

## 23.3 Hybrid Decision

部分问题适合“确定性预判 + LLM 语义补充”。

例如 Integration Verify 是否需要：

```text
repo_count > 1
→ deterministic signal = HIGH

contract_changed = true
→ deterministic signal = HIGH

但：
多个 repo 是否事实上相互独立？
→ LLM semantic decision
```

推荐模式：

```text
Deterministic Pre-check
        ↓
明确 YES / NO
        │
        └─ 无法确定 → LLM / Delivery Lead
```

而不是反过来所有事情先问 LLM。

***

## 23.4 决策优先级

正式优先级：

```text
1. Multica 当前事实状态
2. Deterministic Gate / Guard
3. 明确的 Human Decision
4. LLM Semantic Decision
5. Delivery Lead Exception Handling
```

注意：

Human Gate 与 Deterministic Gate 解决的是不同问题。

例如：

```text
Analysis Deterministic Gate
    = Analysis Package 是否完整、结构是否合法

Human Analysis Gate
    = 方案是否被业务/技术负责人接受
```

两者都需要通过，不能相互替代。

***

## 23.5 Gate 结果约束

统一采用：

```yaml
result: PASS | FAIL | UNKNOWN
```

### PASS

```text
允许进入 Gate 定义的下一状态。
```

### FAIL

```text
禁止推进。
输出明确 reasons / findings。
进入 targeted rework。
```

### UNKNOWN

```text
当前数据或确定性规则不足以做可靠判断。
升级给 Delivery Lead 或 Human。
```

禁止：

```text
Gate FAIL
↓
LLM 认为“问题不大”
↓
继续推进
```

***

# 24. Deterministic Gate 与 LLM 的协作方式

推荐：

```text
Specialist Agent
      ↓
产生结构化 Artifact / Evidence
      ↓
Deterministic Gate
   ↙      ↓       ↘
FAIL     PASS    UNKNOWN
 │        │         │
返工     正常推进   Delivery Lead / Human
```

LLM 主要负责：

```text
生成候选方案
理解语义
执行专业任务
解释复杂错误
异常归因
```

Deterministic Gate 主要负责：

```text
硬条件
格式
依赖
状态转换 Guard
返回码
数量阈值
完成条件
路由表
```

最终目标：

> LLM 负责智能，Deterministic Gate 负责纪律。

***

# 25. Skill 中允许的“状态逻辑”

Skill 内可以包含：

```python
def can_start_development(ctx):
    return (
        ctx.analysis_gate == "PASS"
        and ctx.human_review == "APPROVED"
    )
```

也可以包含：

```python
def route_task(task):
    return ROUTES.get(task.role)
```

以及：

```python
def development_done(ctx):
    return (
        ctx.verify == "PASS"
        and ctx.pr_status == "MERGED"
    )
```

这属于：

> Validator / Guard / Gate / Routing

允许存在。

***

# 26. Skill 中禁止的全局 Workflow Runtime

不要：

```python
state = load("workflow-state.json")

while state != "DONE":
    if state == "ANALYSIS":
        ...
    elif state == "DEVELOPMENT":
        ...
```

因为这会重新实现 Multica Runtime。

***

# 27. 防止无限反馈循环

例如：

```text
Engineer
↕
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
Development Issue → blocked
           ↓
       Delivery Lead
           ↓
  semantic diagnosis / human escalation
```

Analysis 同理。

***

# 28. Agent × Skill 关系

| Agent                    | Workspace Skill                                               | Repository Skill                  | 主要职责                                    |
| ------------------------ | ------------------------------------------------------------- | --------------------------------- | --------------------------------------- |
| TFS Sync Agent           | tfs-sync                                                      | 无                                 | Bootstrap Parent + Analysis             |
| Workitem Analyst         | workitem-analysis / analysis-completion-check                 | architecture / repo conventions   | 分析与 Task Graph                          |
| Backend Engineer         | pull-request                                                  | backend-development / build-test  | 编码 + PR                                 |
| Frontend Engineer        | pull-request                                                  | frontend-development / build-test | 编码 + PR                                 |
| Flink Engineer           | pull-request                                                  | flink-development / build-test    | 编码 + PR                                 |
| Verify Agent             | development-verification                                      | build-test / project conventions  | 自动验证                                    |
| PR Status Sync Autopilot | pr-status-sync                                                | 无                                 | 轮询外部 PR 状态并回写 Multica                   |
| Delivery Lead            | delivery-coordination / development-task-handoff / task-close | 少量必要项目约定                          | Stage Boundary / Exception / Completion |

***

# 29. Skill 管理边界

## Multica Workspace Skills

直接由 Multica Workspace 管理：

```text
tfs-sync
delivery-coordination
workitem-analysis
analysis-completion-check
development-task-handoff
development-verification
pull-request
pr-status-sync
task-close
```

它们描述：

> 团队如何完成研发交付。

***

## Repository Skills

跟代码仓一起管理：

```text
backend-development
frontend-development
flink-development
build-test
project-conventions
repo-debugging
```

它们描述：

> 当前项目具体如何实现。

***

# 30. 最终 Issue 树

```text
Parent Issue
assignee = Delivery Lead
status   = backlog
│
├── Stage 1
│   └── Analysis Issue
│       assignee = Workitem Analyst
│       backlog → todo → in_progress → in_review → done
│
├── Stage 2
│   ├── DEV-Backend
│   │   assignee = Backend Engineer
│   │   Engineer ↔ Verify → PR → Merge → done
│   │
│   ├── DEV-Frontend
│   │   assignee = Frontend Engineer
│   │   Engineer ↔ Verify → PR → Merge → done
│   │
│   └── DEV-Flink
│       assignee = Flink Engineer
│       Engineer ↔ Verify → PR → Merge → done
│
└── Stage 3（optional）
    └── Integration Verification
        assignee = Verify Agent
        backlog → todo → done
```

***

# 31. Delivery Lead 调用频率

正常需求下，Delivery Lead 可能只需要执行 2\~3 次。

```text
第一次：
Analysis Stage Complete
→ 创建 Development Tasks

第二次：
Development Stage Complete
→ 判断 Integration Verify / Completion

第三次：
Integration Verify Stage Complete（如果存在）
→ Parent Completion
```

日常：

```text
Engineer ↔ Verify ↔ PR Reviewer
```

完全不经过 Delivery Lead。

***

# 32. 最终路由原则

统一采用：

```text
能确定
   ↓
Deterministic Route
   ↓
Specialist Agent

不能确定
   ↓
Delivery Lead
   ↓
Semantic Routing
```

这是 v1.2 的核心路由原则。

***

# 33. Parent Completion Gate

关闭 Parent 前，必须确认：

```text
[ ] Analysis 已人工 Approve
[ ] Analysis Issue = done
[ ] 所有必要 Development Issue = done
[ ] 所有必要 Verify = PASS
[ ] 所有 PR = merged
[ ] 无 unresolved blocker
[ ] Integration Verify = PASS（如果 required）
```

满足后：

```text
Delivery Lead
    ↓
task-close
    ↓
更新 TFS
    ↓
记录 PR / Verify / Integration 结果
    ↓
Parent → done
```

***

# 34. Deterministic Gate Layer 的实现建议

第一阶段不需要建设一个独立常驻 Gate Service。

建议优先以 Multica Workspace Skill 的方式组织：

```text
delivery-flow/
├── SKILL.md
├── scripts/
│   ├── validate-analysis.py
│   ├── validate-task-graph.py
│   ├── route-agent.py
│   ├── evaluate-development.py
│   ├── evaluate-pr-transition.py
│   └── evaluate-completion.py
└── references/
    ├── analysis-schema.yaml
    ├── task-graph-schema.yaml
    └── routing.yaml
```

其中：

```text
SKILL.md
    = 何时调用哪些确定性判断

scripts/
    = 真正的确定性逻辑

references/
    = Contract / Schema / Routing Table
```

脚本只：

```text
读取输入
↓
判断
↓
输出 PASS / FAIL / UNKNOWN + reasons
```

不：

```text
长期保存 workflow state
无限循环调用 Agent
替代 Multica Run 调度
```

如果未来 Deterministic Gate 规则数量、并发和审计要求显著上升，再考虑将其独立为 Runtime Service。

***

## 34.1 PR Status Sync Skill 实现建议

建议新增：

```text
pr-status-sync/
├── SKILL.md
├── scripts/
│   ├── list-reviewing-issues.py
│   ├── sync-pr-status.py
│   └── apply-pr-transition.py
└── references/
    └── pr-status-mapping.yaml
```

其中：

```text
SKILL.md
    = 定义 Autopilot 每次 Run 的固定步骤和幂等规则

list-reviewing-issues.py
    = 查询 status=in_review 且存在 pr.id 的 Development Issues

sync-pr-status.py
    = 使用 tfs-mcp 查询 PR，并将变化写回 Multica

apply-pr-transition.py
    = 根据 PR 状态执行 deterministic route / gate

pr-status-mapping.yaml
    = TFS PR 状态 → Multica 标准状态映射
```

建议所有同步操作必须幂等：

```text
PR 状态未变化
→ no-op

相同 review feedback 已同步
→ 不重复 @Engineer

相同 merge event 已处理
→ 不重复关闭 Issue
```

这样即使 Autopilot 重复执行，也不会制造重复 Run 或重复通知。

***

# 35. 最终架构结论

v1.2.2 最终架构可以概括为：

```text
┌──────────────────────────────────────────┐
│            External Systems              │
│       TFS Work Item / PR Platform        │
└────────────────────┬─────────────────────┘
                     │
              Sync / Polling
                     │
                     ▼
┌──────────────────────────────────────────┐
│           External State Sync            │
│      TFS Sync / PR Status Sync           │
│      Autopilot + tfs-mcp (default)       │
└────────────────────┬─────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────┐
│              Multica Runtime             │
│ Issue / Run / Queue / Status / Stage     │
└────────────────────┬─────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────┐
│          Deterministic Gate Layer        │
│ Validator / Guard / Routing / Completion │
└────────────────────┬─────────────────────┘
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
      Analyst     Engineer      Verify
                      ↕
                  PR Reviewer
             （External Platform）
         │           │           │
         └───────────┴───────────┘
                     │
           Stage Boundary / Exception
                     │
                     ▼
               Delivery Lead
                     │
             Human if required
```

核心原则：

> 外部平台负责产生 PR Review / Merge 等事实，External State Sync 负责把这些事实回流到 Multica。

> 当前默认采用 **Multica Autopilot + tfs-mcp 定时轮询**，第一阶段不新增 Webhook Service。

> Multica 负责运行和保存流程状态。

> Deterministic Gate Layer 负责硬条件、Guard、Routing 与 Completion Check。

> Deterministic Delivery Flow 根据 Gate 结果推进标准 Happy Path。

> Specialist Agent 负责专业执行。

> Delivery Lead 不再是全局调度器，只负责阶段边界、复杂协调、异常和最终关闭。

> Engineer 是 Development Issue 的长期 Owner，并负责创建和维护 PR。

> Verify 通过 `@mention` 临时进入 Development Issue，不改变 Engineer 的 assignee。

> `PR Changes Requested` 经 PR Status Sync 回流后确定性 `@Engineer`；`PR Merged` 经 PR Transition Gate 后关闭 Development Issue。

> Development Issue 必须到 **PR Merge + PR Transition Gate PASS** 才算 Done。

> Stage Complete 才唤醒 Parent 上的 Delivery Lead。

这套设计最大程度利用 Multica runtime-centric 的能力，同时补齐了外部平台事件无法天然回流 Multica 的关键闭环，并避免重新实现一个 Workflow Runner。
