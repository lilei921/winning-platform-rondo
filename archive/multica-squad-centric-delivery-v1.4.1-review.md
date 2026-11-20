# Multica Squad-Centric Delivery v1.4.1 Review

> Review Target: `multica-squad-centric-delivery-v1.4.1.md`  
> Review Focus:
> 1. 从 Agent Session / Run 切换与启动成本出发，分析是否存在可合并或取消的阶段；
> 2. 分析是否存在可以用 Deterministic Script / Gate / Route 替代 LLM Semantic Operation 的场景。
>
> Status: Review Only  
> Note: 本文档不修改 `v1.4.1` Baseline，仅记录 Review 结论与后续优化建议。

---

# 1. Review 结论

`v1.4.1` 的 Development → Verify → PR 路径已经较为精简。

当前最大的优化空间不再集中在 Engineer / Verify Agent，而集中在 **Delivery Lead 的 Happy Path Run** 与 **PR Completed 后的 Delivery 收口**。

总体建议进一步收敛为：

```text
LLM
= 只处理需要语义理解与工程判断的工作

Human
= 只处理批准与业务决策

Deterministic Script / Gate / Route
= 状态、路由、物化、副作用、完成检查

Delivery Lead
= Exception-oriented Coordinator
= UNKNOWN / 冲突 / 异常处理
```

核心目标：

> **正常 Happy Path 尽量不启动 Delivery Lead Session。**

---

# 2. 当前 Session 模型分析

## 2.1 简单任务

当前概念流程：

```text
TFS Sync
↓
Delivery Lead Run
↓
Workitem Analyst Run
↓
Human Analysis Review
↓
Delivery Lead Run
↓
Engineer Run
↓
PR Materialization
↓
PR Status Sync
↓
Delivery Lead Run
↓
Delivery Completion
```

其中存在三处值得重点优化的 Delivery Lead Run：

```text
1. Delivery Issue 启动
2. Human Analysis Review APPROVED / REJECTED 后
3. PR Completed 后
```

这些位置的大部分输入和下一步已经可以由结构化 Fact 确定，不一定需要再次启动 LLM Session。

---

# 3. Session 优化一：移除 Delivery 启动时的 Delivery Lead Run

当前逻辑：

```text
backlog
↓
todo
↓
Delivery Lead
↓
判断需要 Analysis
↓
@Workitem Analyst
```

但当前方案已经明确：

```text
所有新的 Delivery Issue
→ 首先进入 Workitem Analysis
```

因此：

```text
status = todo
AND analysis_package 不存在
→ Workitem Analyst
```

属于确定性 Route。

推荐：

```text
backlog
↓
todo
↓
Analysis Start Route
↓
Workitem Analyst
```

可以由：

```text
start-analysis.py
```

或统一 `delivery-flow` 中的确定性 Route 完成。

### 收益

每个 Delivery：

```text
减少 1 次 Delivery Lead Session
```

---

# 4. Session 优化二：移除 Human Analysis Review 后的正常 Delivery Lead Run

当前：

```text
Human APPROVED
↓
Delivery Lead
↓
读取 Analysis Package
↓
Development Topology Materialization
↓
verify_agent.required
↓
Engineer(s)
```

但真正的语义判断已经在 Analysis 阶段完成：

```text
Workitem Analyst
→ Development Units
→ Repository Scope
→ Dependencies
→ Verify Agent Recommendation
```

Human Review 又对完整 Analysis Package 做了批准。

因此不建议：

```text
Workitem Analyst 做一次语义拆分
↓
Human APPROVED
↓
Delivery Lead 再做一次类似判断
```

推荐改成：

```text
Workitem Analyst
= 定义 Development Topology

Human
= 批准 Development Topology

Deterministic Script
= Materialize Development Topology
```

---

## 4.1 Approved Analysis Materialization

Analysis Package 应包含足够的结构化信息：

```yaml
development:
  units:
    - id: DEV-Backend
      role: backend
      repository_scope:
        - ...
      dependencies: []
      acceptance_criteria:
        - AC-01

verify_agent:
  recommendation: required
```

Human：

```text
APPROVED
```

之后：

```text
Approved Analysis Materialization
↓
创建 required Development Sub-Issues
↓
Role → Agent Mapping
↓
TFS Task Materialization
↓
Recommendation → verify_agent.required
↓
设置 in_progress
↓
启动 required Engineer(s)
```

整个过程可以由确定性脚本完成。

推荐：

```text
materialize-development.py
```

---

# 5. Session 优化三：Human REJECTED 后也可取消 Delivery Lead Happy Path

当前：

```text
REJECTED
↓
Delivery Lead
↓
读取 Reason / Expected Change
↓
status = in_progress
↓
@Workitem Analyst
```

如果 Human Review 已使用结构化格式：

```text
REJECTED

Reason:
- ...

Expected Change:
- ...
```

则可以确定性处理：

```text
status == analys_review
+
review.decision == REJECTED
↓
status = in_progress
↓
Workitem Analyst
↓
携带 Review Feedback
```

推荐：

```text
apply-analysis-review.py
```

只有以下情况才需要 Delivery Lead / Human：

```text
Review 格式无法识别
Decision 缺失
Feedback 与当前事实冲突
无法可靠定位返工目标
```

---

# 6. Development / Verify / PR Session 边界

这部分 `v1.4.1` 已经较合理，不建议继续硬合并。

## 6.1 Engineer 与 Verify Agent 不应合并

Verify Agent 的价值就在于：

```text
Engineer Context
≠
Verify Context
```

Verify Agent 必须保持独立 Session，确保：

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

属于有价值的 Session Boundary，而不是冗余切换。

---

## 6.2 Development Readiness Check 已适合确定性处理

当前合理模型：

```text
Engineer A → Ready
Engineer B → Ready
Engineer C → Ready
```

每个 Engineer 写回：

```text
Development Ready Facts
```

随后：

```text
Development Readiness Check
```

结果：

```text
仍有 Unit 未 Ready
→ 当前 Run 结束

全部 Ready
+ verify_agent.required = true
→ @Verify Agent

全部 Ready
+ verify_agent.required = false
→ PR Materialization

UNKNOWN
→ Delivery Lead
```

这部分应继续保持 deterministic。

---

# 7. Verify FAIL → Engineer：保留 Session，但确定性化路由

Verify FAIL 后：

```text
Verify Finding
↓
Affected Development Unit
↓
Engineer
```

Engineer 新 Session 是合理的，因为后续需要新的 Engineering Semantic Work。

但应把两层职责拆开：

```text
Verify Agent
= 语义判断 Finding 属于哪个 Development Unit

Deterministic Route
= Development Unit → Engineer
```

例如：

```yaml
issues:
  - id: VERIFY-001
    development_unit: DEV-Backend
    description: ...
```

之后：

```text
DEV-Backend
→ Backend Engineer
```

不需要再让 LLM 判断责任人。

---

# 8. 最大剩余优化点：PR Completed 后全部下沉到 Deterministic Finalize

当前：

```text
PR Status Sync
↓
all PR completed
↓
Comment
↓
Delivery Lead
↓
PR Transition Gate
↓
Post-Merge Workspace Reconciliation
↓
Delivery Completion Gate
↓
Final Delivery Summary
↓
TFS Done
↓
Delivery Issue Done
```

这里大部分动作已经是确定性的。

## 8.1 PR Transition Gate

当前条件类似：

```text
all Development Units Ready
AND
Verify PASS if required
AND
all current required PR completed
AND
blocker == 0
```

完全可以程序化。

## 8.2 Post-Merge Workspace Reconciliation

执行：

```text
git fetch --prune
git switch <target_branch>
git pull --ff-only
```

以及：

```text
working tree clean?
target_branch exists?
fast-forward possible?
repository identity correct?
```

也属于确定性检查。

## 8.3 Delivery Completion Gate

检查：

```text
Analysis Gate PASS
Human Analysis Review APPROVED
Development Ready
Local Validation PASS
Code Review PASS
Verify PASS if required
PR completed
Workspace Reconciliation PASS
No Blocker
```

仍然是确定性检查。

## 8.4 推荐合并为一次 Finalize Pipeline

建议：

```text
delivery-finalize
```

执行：

```text
PR Status Sync
↓
all required current PR = completed
↓
PR Transition Check
↓
Post-Merge Workspace Reconciliation
↓
Delivery Completion Check
↓
TFS Close
↓
Delivery Issue Done
```

整个流程：

```text
不需要 LLM Session
```

需要强调：

> Gate 可以继续保持独立函数和独立责任，但不需要对应独立 Agent Run。

即：

```text
Gate 独立
≠
Session 独立
```

---

# 9. Final Delivery Summary 可以模板化

当前 Final Summary 的输入已经结构化：

```text
Analysis Package
Development Evidence
Verification Report
PR Facts
```

因此可以 deterministic render：

```markdown
## Delivery Summary

- TFS: 12345
- Route: sdd-fast
- Development Units: 2
- Repositories:
  - repo-a / PR-101
  - repo-b / PR-102
- Verify Agent: PASS
- Acceptance Coverage: 5/5
- PR Status: completed
```

如果未来需要高质量自然语言摘要：

```text
LLM Summary
= Optional Enhancement
```

不得成为 Delivery Completion 的阻塞条件。

---

# 10. PR Abandoned 后也可减少 Delivery Lead Run

当前：

```text
PR abandoned
↓
Human Decision
↓
Delivery Lead
↓
根据 NEXT 路由
```

机器无法判断 abandoned 的业务含义，因此：

```text
Human Decision
```

必须保留。

但 Human 已明确：

```text
NEXT:
- ANALYSIS
- ENGINEERING
- RECREATE_PR
- CANCEL_DELIVERY
```

之后的下一步已经可以确定性路由。

推荐：

```text
NEXT = ANALYSIS
→ Workitem Analyst

NEXT = ENGINEERING
→ affected Development Unit Engineer

NEXT = RECREATE_PR
→ Candidate Commit unchanged?
   ├─ Yes → PR Materialization
   └─ No → Engineer

NEXT = CANCEL_DELIVERY
→ Cancellation Handler
```

只有以下情况才进入 Delivery Lead：

```text
NEXT 缺失
对象不唯一
事实冲突
无法可靠路由
```

推荐：

```text
route-human-decision.py
```

---

# 11. TFS Sync / PR Status Sync 的 LLM 使用问题

当前 `tfs-sync` 已经基本属于确定性 Worker：

```text
TFS 查询
↓
JSON Snapshot
↓
Normalization
↓
Reconcile
↓
Bootstrap Check
```

PR Status Sync 同样是：

```text
API Query
↓
Identity Check
↓
active | completed | abandoned
↓
Idempotent State Update
```

这些本质上都不需要 LLM。

理想状态：

```text
TFS Sync
PR Status Sync
= Non-LLM Scheduled Worker
```

如果 Multica Autopilot 技术上必须启动 Agent Run，则暂时保留：

```text
Thin Agent Adapter
↓
call deterministic script
↓
return result
```

并将 Prompt 控制到最小。

---

# 12. 推荐的 Deterministic Script 集合

下一版可以收敛为：

```text
delivery-flow/
├── start-analysis.py
├── apply-analysis-review.py
├── materialize-development.py
├── check-development-readiness.py
├── route-verify-result.py
├── materialize-pr.py
├── reconcile-pr-status.py
├── route-human-decision.py
└── finalize-delivery.py
```

## 12.1 `start-analysis.py`

```text
todo
→ Workitem Analyst
```

用于取消 Delivery 启动时的 Delivery Lead Run。

## 12.2 `apply-analysis-review.py`

```text
APPROVED
→ materialize-development

REJECTED
→ Workitem Analyst targeted rework
```

用于取消 Human Analysis Review 后的正常 Delivery Lead Run。

## 12.3 `materialize-development.py`

负责：

```text
approved Development Units
→ Development Sub-Issue
→ Role Mapping
→ TFS Task
→ verify_agent.required
→ Engineer Assignment / Start
```

不再让 Delivery Lead 重复做 Development Topology 判断。

## 12.4 `check-development-readiness.py`

负责：

```text
all Development Units Ready?
Verify required?
Next Actor / Action?
```

## 12.5 `route-verify-result.py`

负责：

```text
PASS
→ PR Materialization

FAIL
→ Development Unit → Engineer

UNKNOWN
→ Delivery Lead
```

其中 Finding → Development Unit 由 Verify Agent 输出。

## 12.6 `materialize-pr.py`

负责：

```text
PR Preparation Facts
→ Identity / Branch / Commit Check
→ Create PR
→ Reconcile current_pr
→ in_review
```

## 12.7 `reconcile-pr-status.py`

负责：

```text
active
completed
abandoned
UNKNOWN
```

及幂等恢复。

## 12.8 `route-human-decision.py`

负责：

```text
ANALYSIS
ENGINEERING
RECREATE_PR
CANCEL_DELIVERY
```

Human 决策之后的确定性路由。

## 12.9 `finalize-delivery.py`

整合执行：

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

内部 Gate 仍保持独立函数，不意味着独立 Run。

---

# 13. 应保留的 LLM Semantic Work

不建议为了减少 Token 而过度确定性化以下场景：

| 场景 | 保留原因 |
|---|---|
| Corrective / Intentional 判断 | 需要理解业务语义 |
| Root Cause Analysis | 需要证据推理 |
| Requirement / Solution Analysis | 需要需求理解 |
| Development Unit 拆分 | 强语义判断 |
| Verify Agent Recommendation | 需要分析验收价值与复杂度 |
| Engineer Implementation | 工程实现决策 |
| Code Review | 实现语义与风险判断 |
| Verify Acceptance | 从 AC 判断最终行为 |
| Verify FAIL → Development Unit 归因 | 可能需要语义判断 |
| UNKNOWN / 冲突 / 异常 | Delivery Lead 的核心价值 |

---

# 14. 推荐目标 Session 模型

## 14.1 简单任务

```text
TFS Sync                         # Deterministic
↓
Workitem Analyst Run             # LLM
↓
Human Analysis Review            # Human
↓
Analysis Materialization         # Deterministic
↓
Engineer Run                     # LLM
├─ Development
├─ Local Validation
├─ Code Review
├─ Commit / Push
├─ PR Preparation
└─ PR Materialization
↓
PR Status + Delivery Finalize    # Deterministic
↓
Done
```

正常情况下：

```text
LLM Session = 2
```

## 14.2 复杂任务 + Verify

```text
Workitem Analyst Run             # 1
↓
Human Review
↓
Deterministic Materialization
↓
Engineer A Run                   # 2
Engineer B Run                   # 3
Engineer C Run                   # 4
↓
Deterministic Readiness Check
↓
Verify Agent Run                 # 5
↓
PR Materialization same-run
↓
Deterministic PR / Finalize
↓
Done
```

正常情况下：

```text
Delivery Lead Run = 0
```

Delivery Lead 只在异常时出现。

---

# 15. 优先级建议

## P0 — 建议优先处理

### 1. 移除 Delivery 启动时的 Delivery Lead Run

```text
todo → Workitem Analyst
```

改为确定性 Route。

### 2. 移除 Human Analysis Review 后的正常 Delivery Lead Run

```text
APPROVED / REJECTED
```

使用 deterministic transition。

Development Topology 由 Analysis Package 定义，Human 批准后直接 Materialize。

### 3. 移除 PR Completed 后的 Delivery Lead Run

将：

```text
PR Transition Gate
Post-Merge Reconciliation
Delivery Completion Gate
Task Close
```

组合成一次 deterministic Finalize Pipeline。

## P1 — 推荐处理

### 4. Human Abandoned Decision 后确定性路由

Human 已给出 `NEXT` 后，不再默认经过 Delivery Lead。

### 5. Final Delivery Summary 模板化

LLM Summary 改为 optional。

### 6. TFS Sync / PR Status Sync 尽可能非 LLM 化

若 Multica 机制要求 Agent，则仅保留 Thin Adapter。

---

# 16. 最终 Review 判断

`v1.4.1` 的核心 Development / Verify / PR 设计已经基本稳定。

下一轮最大的收益不是继续增加 Agent、Skill 或新的 Workflow 概念，而是：

> **把 Happy Path 上剩余的 Delivery Lead Run 下沉为 Deterministic Route / Materialization / Finalize。**

最终目标：

```text
Workitem Analyst
= Analysis Semantic Reasoning

Engineer
= Engineering Semantic Work

Verify Agent
= Behavior-oriented Acceptance Reasoning

Human
= Approval / Business Decision

Delivery Lead
= Exception / UNKNOWN / Conflict Handling

Script / Gate / Route
= Everything Deterministic
```

因此 Delivery Lead 的目标定位可以进一步收敛为：

> **Exception-oriented Coordinator，而不是 Happy Path Stage Coordinator。**
