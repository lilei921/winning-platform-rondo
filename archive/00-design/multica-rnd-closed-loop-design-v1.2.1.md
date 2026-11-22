# Multica 研发任务闭环方案 v1.2

> 版本：v1.2.1  
> 日期：2026-09-19  
> 目标：基于 Multica 构建“需求同步 → 需求分析 → 人工审核 → 多任务研发 → 自动 Verify → PR 人工审核 → 集成验证（按需）→ 归档”的研发闭环。  
> 核心原则：充分利用 Multica 的 Runtime、Issue、Run、Stage、Agent 与 `@mention` 机制；正常路径优先采用确定性规则推进，Delivery Lead 只处理阶段边界、复杂协调与异常，不再作为所有步骤的全局调度器。

>
> v1.2.1 修订：将原有 “Deterministic Gate / Analysis Deterministic Gate” 正式统一升级为 **Deterministic Gate Layer**，并明确 **Deterministic Decision 与 LLM Decision 的职责边界**。

---

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

---

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

---

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

---

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

---

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

---

# 2. 总体架构

```text
                         TFS
                          │
                          ▼
                    TFS Sync Agent
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
        Parent Issue             Analysis Issue
   assignee=Delivery Lead     assignee=Analyst
       status=backlog          status=backlog
              │                       │
              │                 context ready
              │                       │
              │                 backlog → todo
              │                       │
              │                       ▼
              │                    Analyst
              │                       │
              │               Analysis Deterministic Gate
              │                       │
              │                  Human Review
              │                       │
              │                     done
              │                       │
              └──── Stage 1 Complete ─┘
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
      Human Review     Human Review     Human Review
        ↙    ↘           ↙    ↘           ↙    ↘
     Rework  Merge    Rework  Merge    Rework  Merge
        │      │         │      │         │      │
        └→Eng  done      └→Eng  done      └→Eng  done
               │                │                │
               └──────── Stage 2 Complete ──────┘
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

---

# 3. 核心职责模型

整个系统分为五层。

```text
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
Multica
    保存事实状态

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

---

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
- 阶段完成后的 Parent 唤醒。

因此不再额外实现：

```text
Workflow Runner
Python Coordinator
Global State Machine Service
```

除非未来出现强一致、复杂补偿、严格审计等明确需求。

---

# 5. 状态唯一事实来源

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

---

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

---

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

---

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

---

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

---

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

---

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

---

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

---

# 10. Development Task 创建

Delivery Lead 负责实例化已经批准的 Task Graph。

注意：

> Delivery Lead 负责“创建”，但不应自由发挥重新设计 Task Graph。

正常情况下应严格按已批准的 Analysis Package 创建。

---

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

---

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

---

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

---

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
          Human PR Review
            ↙         ↘
      Changes         Approve
      Requested          │
          │              ▼
          ▼             Merge
       Engineer           │
          │               ▼
       @Verify           done
          │
      PR Review again
```

因此：

> Development Issue 的 Done 条件是 PR Merge，而不是 Verify PASS。

---

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

---

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

---

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

---

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

---

# 16. PR Review

## 16.1 PR Changes Requested

PR 被人工要求修改：

```text
PR Review Feedback
       ↓
@Engineer
       ↓
Engineer targeted fix
       ↓
@Verify
       ↓
PASS
       ↓
再次请求 Human PR Review
```

仍不需要 Delivery Lead。

只有以下情况才升级：

- Feedback 推翻原 Analysis；
- 需要新增 Repository；
- 需要新增 Development Task；
- 出现跨任务冲突；
- 连续多轮失败。

---

## 16.2 PR Approved / Merged

只有满足：

```text
Verify = PASS
AND
PR = Approved
AND
PR = Merged
```

才：

```text
Development Issue → done
```

---

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

---

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

---

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

---

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

---

# 19. Delivery Lead 的正式定位

v1.2 中 Delivery Lead 不再是 Global Coordinator。

正式定义为：

> Stage Boundary Coordinator + Semantic Exception Handler。

---

## 19.1 Delivery Lead 只在三类场景出现

### A. Stage Boundary

例如：

```text
Analysis Stage done
Development Stage done
Integration Verify Stage done
```

---

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

---

### C. Parent Completion

负责：

```text
Completion Gate
TFS 更新
Parent 关闭
```

---

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

---

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

---

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
→ @Engineer
→ @Verify

PR Merged
→ Dev done

All Dev done
→ Stage Complete
→ Delivery Lead
```

---

# 23. Deterministic Decision vs LLM Decision

这是 v1.2.1 的核心设计边界。

原则：

> 能由明确输入、规则、Schema、状态和返回码稳定判断的事情，必须优先 Deterministic。

> 需要理解需求、代码语义、业务关系、影响范围、模糊上下文的事情，交给 LLM。

> 不允许 LLM 覆盖一个已经明确 FAIL 的 Deterministic Gate。

---

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

---

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

---

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

---

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

---

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

---

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

---

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

---

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

---

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

---

# 28. Agent × Skill 关系

| Agent | Workspace Skill | Repository Skill | 主要职责 |
|---|---|---|---|
| TFS Sync Agent | tfs-sync | 无 | Bootstrap Parent + Analysis |
| Workitem Analyst | workitem-analysis / analysis-completion-check | architecture / repo conventions | 分析与 Task Graph |
| Backend Engineer | pull-request | backend-development / build-test | 编码 + PR |
| Frontend Engineer | pull-request | frontend-development / build-test | 编码 + PR |
| Flink Engineer | pull-request | flink-development / build-test | 编码 + PR |
| Verify Agent | development-verification | build-test / project conventions | 自动验证 |
| Delivery Lead | delivery-coordination / development-task-handoff / task-close | 少量必要项目约定 | Stage Boundary / Exception / Completion |

---

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
task-close
```

它们描述：

> 团队如何完成研发交付。

---

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

---

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

---

# 31. Delivery Lead 调用频率

正常需求下，Delivery Lead 可能只需要执行 2~3 次。

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

---

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

---

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

---

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

---

# 35. 最终架构结论

v1.2 最终架构可以概括为：

```text
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

> Multica 负责运行和保存状态。

> Deterministic Gate Layer 负责硬条件、Guard、Routing 与 Completion Check。

> Deterministic Delivery Flow 根据 Gate 结果推进标准 Happy Path。

> Specialist Agent 负责专业执行。

> Delivery Lead 不再是全局调度器，只负责阶段边界、复杂协调、异常和最终关闭。

> Engineer 是 Development Issue 的长期 Owner，并负责创建和维护 PR。

> Verify 通过 `@mention` 临时进入 Development Issue，不改变 Engineer 的 assignee。

> Development Issue 必须到 PR Merge 才算 Done。

> Stage Complete 才唤醒 Parent 上的 Delivery Lead。

这套设计最大程度利用 Multica runtime-centric 的能力，同时避免重新实现一个 LLM 驱动的 Workflow Runner。
