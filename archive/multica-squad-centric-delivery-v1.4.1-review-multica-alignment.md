# Multica Squad-Centric Delivery v1.4.1 Review — Multica 机制适配性复核

> Review Target: `multica-squad-centric-delivery-v1.4.1.md`  
> Based On: `multica-squad-centric-delivery-v1.4.1-review.md`  
> Status: Review Only  
> Purpose: 复核前一轮 Session / Deterministic 优化建议是否符合 Multica 的 Squad、Leader、Agent Run、Autopilot、Skill / Script 等原生设计机制。  
> Note: 本文档不修改 `v1.4.1` Baseline。

---

# 1. 总体结论

前一轮 Review 的核心工程方向成立：

```text
LLM
= Semantic Reasoning

Human
= Approval / Business Decision

Script / Gate / Route
= Deterministic Execution / Control

Delivery Lead
= Routing + Exception / UNKNOWN / Conflict Handling
```

其中最正确的方向是：

> **能够由明确输入、有限规则和结构化 Fact 决定的工作，应下沉到 Script / Gate / Route，而不是让 LLM 重复判断。**

但需要修正一个过度优化目标：

```text
Happy Path
→ Delivery Lead Run = 0
```

对于当前 `Delivery Issue assignee = Delivery Squad` 的 Squad-centric 架构，这并不应作为强目标。

更符合 Multica 原生机制的目标是：

> **Delivery Lead 可以被 Squad 原生机制唤醒，但 Happy Path 中只承担极薄的 routing / deterministic capability dispatch，不重复专业 Agent 已完成的语义判断。**

因此 Delivery Lead 更准确的目标定位是：

```text
Thin Squad Router
+
Exception Coordinator
```

而不是纯：

```text
Exception-only Handler
```

---

# 2. 符合 Multica 设计的 Review 建议

## 2.1 确定性逻辑下沉到 Skill Script / Gate

符合。

典型包括：

```text
Development Ready 聚合
Role → Agent Mapping
Recommendation → verify_agent.required
Candidate Commit 校验
PR Materialization
PR status active / completed / abandoned
Completion Check
幂等与恢复
```

这些操作都具备：

```text
输入明确
规则明确
结果有限
可以程序化
```

适合由：

```text
Skill
└── scripts/

Gate
Route
Guard
API State
```

承担。

---

## 2.2 Engineer / Verify Agent 保持独立 Session

符合。

原因：

```text
Engineer
= Implementation-oriented

Verify Agent
= Behavior-oriented Acceptance Verification
```

Verify Agent 的独立 Session 本身就是设计价值：

```text
不依赖 Engineer 实现过程
↓
从 Acceptance Criteria / Verification Requirements
↓
重新验证最终行为
```

因此：

```text
Engineer → Verify Agent
```

不是需要消除的无效 Session Boundary。

---

## 2.3 Development Readiness Check 使用确定性逻辑

符合。

推荐职责：

```text
Engineer
→ 产生 Development Ready Facts

Development Readiness Check
→ 聚合所有 required Development Units 的结构化 Facts

Result:
- NOT_READY
- READY
- UNKNOWN
```

随后：

```text
NOT_READY
→ 当前 Engineer Run 结束

READY + verify_agent.required=true
→ @Verify Agent

READY + verify_agent.required=false
→ PR Materialization

UNKNOWN
→ Delivery Lead
```

Agent 不应重新语义判断 `READY / NOT_READY`。

---

## 2.4 PR Materialization 使用确定性脚本

符合。

PR Preparation 与 PR Materialization 应继续保持分离：

```text
PR Preparation
= Engineer Semantic Work

PR Materialization
= Deterministic Side Effect
```

正常情况下不应为创建 PR 再启动新的 Engineer Session。

---

## 2.5 PR Completed 后使用 Deterministic Finalize

高度推荐。

当前：

```text
PR completed
↓
PR Transition Gate
↓
Post-Merge Workspace Reconciliation
↓
Delivery Completion Gate
↓
TFS Close
↓
Issue Done
```

绝大部分都是结构化事实与确定性动作。

推荐：

```text
PR Status Sync Run
↓
same-run deterministic finalize
↓
Done
```

无需为这些步骤再唤醒 Delivery Lead 做语义推理。

---

# 3. 需要修正的 Review 建议

## 3.1 不应强求移除 Delivery 启动时的 Delivery Lead Run

前一轮建议：

```text
todo
→ Workitem Analyst
```

从工程逻辑看可以确定性路由。

但当前架构明确：

```text
Delivery Issue
assignee = Delivery Squad
```

Squad-centric 模型天然以 Leader 作为 Squad 的入口和成员路由点。

因此不建议为了省一次 Run 而绕开：

```text
Squad
→ Leader
→ Member
```

更合理的优化：

```text
Delivery Lead Run
↓
读取结构化 Fact
↓
调用 deterministic route
↓
@Workitem Analyst
↓
END
```

Lead Run 可以非常薄，但不必强行删除。

---

## 3.2 Human Analysis Review 后也不必强求 0 Lead Run

Human：

```text
APPROVED
```

或：

```text
REJECTED
```

发生在 Squad-owned Delivery Issue 上时，Leader 作为原生入口仍然合理。

应优化的是：

> **Delivery Lead 不再重新做 Development Topology / Verify Recommendation 等语义判断。**

推荐：

```text
Human APPROVED
↓
Delivery Lead
↓
materialize-development.py
↓
@Engineer(s)
↓
END
```

REJECTED：

```text
Human REJECTED
↓
Delivery Lead
↓
apply-analysis-review.py
↓
@Workitem Analyst
↓
END
```

即：

```text
保留 native Leader Run
删除重复 semantic reasoning
```

---

# 4. PR Completed 后可以真正取消 Lead Happy Path

这一段与 Analysis 前后不同。

PR Completed 后的输入已经完全结构化：

```text
required PR statuses
candidate / verified commits
blocker
Development Ready Facts
Verify Facts
target_branch
workspace state
```

因此：

```text
PR Status Sync
↓
PR Transition Check
↓
Workspace Reconciliation
↓
Completion Check
↓
Summary Render
↓
TFS Close
↓
Issue Done
```

可以由一个 deterministic finalize pipeline 完成。

此处没有必要利用 Squad Leader 做中转。

---

# 5. PR Abandoned 的正确边界

机器只能确定：

```text
provider_status = abandoned
```

不能确定：

```text
REJECTED
DISCARDED
ANALYSIS
ENGINEERING
RECREATE_PR
CANCEL_DELIVERY
```

因此：

```text
Human Decision
```

必须保留。

但 Human 已明确 `NEXT` 后：

```text
NEXT = ANALYSIS
NEXT = ENGINEERING
NEXT = RECREATE_PR
NEXT = CANCEL_DELIVERY
```

下一步可以由确定性 Route 执行。

如果 Squad 原生机制已经唤醒 Delivery Lead，可以让 Lead 作为极薄 adapter 调用 Route；不应再让 Lead重新判断 Human 已明确的意图。

---

# 6. TFS Sync / PR Status Sync 与 Autopilot

工程上：

```text
TFS Sync
PR Status Sync
```

都高度确定性。

理想实现是：

```text
scheduled deterministic worker
```

但在 Multica Autopilot 模型下，如果触发对象仍然是 Agent / Squad，则实际仍可能表现为 Agent Run。

因此当前更稳妥的方式是：

```text
Autopilot
↓
Thin Agent Adapter
↓
Deterministic Script
↓
Structured Result
↓
END
```

不要为了完全消除 Agent Run 而重新建设一套独立 Workflow Runtime。

---

# 7. Delivery Lead 的最终定位

不建议定义为：

```text
Exception-only Coordinator
```

更推荐：

```text
Delivery Lead
= Thin Squad Router
+ Stage-boundary Adapter
+ Exception Coordinator
```

Happy Path：

```text
只读 Facts
调用确定性 capability
@mention 正确 Specialist
结束
```

异常：

```text
UNKNOWN
事实冲突
跨角色冲突
无法可靠归因
Human Decision 不完整
```

才进入真正语义判断。

---

# 8. 对前一轮 P0 的修订

## 原 P0-1：移除 Delivery 启动 Lead Run

调整为：

```text
不强求删除
```

推荐：

```text
Lead Thin Run
→ deterministic start-analysis route
→ Workitem Analyst
```

---

## 原 P0-2：移除 Human Review 后 Lead Run

调整为：

```text
不强求删除 Run
但删除重复语义判断
```

推荐：

```text
Lead Thin Run
→ deterministic review transition
→ materialize / rework
```

---

## 原 P0-3：移除 PR Completed 后 Lead Run

保留：

```text
强烈推荐
```

因为这段真正可以变成：

```text
same-run deterministic finalize
```

---

# 9. 最符合 Multica 的目标执行模型

```text
Delivery Issue
assignee = Delivery Squad
        │
        ▼
Delivery Lead
Thin Native Router
        │
        ▼
Workitem Analyst
Semantic Analysis
        │
        ▼
Human Analysis Review
        │
        ▼
Delivery Lead
Thin Native Router / Materialization Adapter
        │
        ▼
Engineer(s)
Semantic Engineering
        │
        ├── no Verify ──────────────┐
        │                            │
        └── Verify required          │
                 ↓                   │
             Verify Agent            │
          Semantic Acceptance        │
                 │                   │
                 └──────────┬────────┘
                            ▼
                    PR Materialization
                    Deterministic Tail
                            │
                            ▼
                     PR Status Sync
                            │
                            ▼
                    Delivery Finalize
                    Deterministic Tail
                            │
                            ▼
                           Done
```

---

# 10. 最终判断

前一轮 Review 的大部分技术判断成立：

```text
Deterministic logic
→ Script / Gate / Route

Semantic work
→ Specialist Agent

Human decision
→ Human

UNKNOWN / Conflict
→ Delivery Lead
```

但应避免把：

```text
减少 LLM Semantic Work
```

误解为：

```text
必须消除所有 Delivery Lead Run
```

在当前 Squad-centric 设计中，更合理的是：

> **保留 Multica 原生 Leader 协作入口，但把 Happy Path Lead Run 压缩成非常薄的确定性路由 / capability dispatch。**

这样既保留 Multica 的 Squad / Leader / `@mention` / Run 原生机制，又避免 Delivery Lead 重新演化成 Prompt-based Workflow Runner。
