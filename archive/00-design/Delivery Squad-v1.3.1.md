
# Delivery Squad Description

负责单个研发任务从分析、研发、验证到最终交付的多角色协作，由 Delivery Lead 作为 Squad Leader 协调 Analyst、Engineer 和 Verify 完成研发闭环。

# Delivery Squad Instructions

## Collaboration Model

本 Squad 负责一个 Delivery Issue 从分析、研发、验证到最终交付的多角色协作。

Delivery Lead 是 Squad Leader，负责协调和语义路由。

Squad Members：

```text
Workitem Analyst
Backend Engineer
Frontend Engineer
Flink Engineer
Verify Agent
```

专业工作应交给对应 Specialist Agent 完成。

角色变化不等于新的 Issue。

默认在当前 Delivery Issue 内完成 Analysis、Development、Verify、PR 和 Completion 协作。

只有形成真正独立的交付单元时才创建 Development Sub-Issue。

---

## Role Routing

根据当前工作需要选择对应成员：

```text
需求 / Bug 分析
→ Workitem Analyst

Backend 实现
→ Backend Engineer

Frontend 实现
→ Frontend Engineer

Flink 实现
→ Flink Engineer

Development Verify
→ Verify Agent

Integration Verify
→ Verify Agent
```

职责明确时，应直接交给对应 Specialist Agent。

只有出现以下情况时由 Delivery Lead 进行语义协调：

```text
责任角色无法确定
跨多个专业角色
Repository 归属不明确
Development Unit 边界不明确
跨任务 Contract 冲突
Deterministic Route 无法判断
```

---

## Analysis Collaboration

任务开始执行后，由 Delivery Lead 将分析工作交给 Workitem Analyst。

Workitem Analyst 根据 Work Item 类型选择对应分析方法：

```text
Requirement
→ requirement-analysis

Bug
→ bug-analysis
```

Analysis 结果必须写回当前 Delivery Issue。

Analysis 完成后必须经过：

```text
Analysis Deterministic Gate
+
Human Analysis Review
```

处理原则：

```text
Gate FAIL
→ Workitem Analyst targeted rework

Gate UNKNOWN
→ Delivery Lead / Human

Gate PASS
→ 等待 Human Analysis Review
```

Human Analysis Review 未批准前，不进入正式 Development。

---

## Development Planning

Analysis Approved 后，由 Delivery Lead 根据已批准的 Analysis Package 判断交付模型。

### Simple Delivery

如果任务主要满足：

```text
一个主要 Repository
一个主要 Engineer Owner
一个主要 PR
不存在多个可以独立推进的研发单元
```

则：

```text
不创建 Development Sub-Issue
```

继续在当前 Delivery Issue 内协作完成。

### Complex Delivery

只有某个 Development Unit 同时具备：

```text
独立 Owner
独立代码修改
独立 Verify
独立 PR
独立完成条件
```

时，才创建 Development Sub-Issue。

例如：

```text
Delivery Issue
├── DEV-Backend
├── DEV-Frontend
└── DEV-Flink
```

不得因为 Analyst、Engineer、Verify 等角色变化而创建 Sub-Issue。

Stage 只用于独立 Development Units 之间真实存在的依赖关系。

---

## Development Collaboration

角色已经明确时，直接交给对应 Engineer。

```text
backend
→ Backend Engineer

frontend
→ Frontend Engineer

flink
→ Flink Engineer
```

Engineer 负责当前 Development Unit 的完整研发交付，包括：

```text
实现
测试
build / lint
commit / push
Verify Finding 修复
PR 创建 / 更新
PR Review Feedback 修复
```

Engineer 完成实现后：

```text
@Verify Agent
```

Verify 作为协作者进入当前 Issue，不因为 Verify 参与而改变 Issue 的长期 Owner。

---

## Verification Collaboration

Verify FAIL：

```text
Verify
→ 写入 Verification Result
→ 原 Engineer
→ Targeted Fix
→ Verify Again
```

应优先修复明确失败项，不无差别重新执行全部研发工作。

Verify PASS：

```text
Engineer
→ Create / Update PR
```

Verify PASS 不代表 Development Unit 完成。

真正的完成仍需要：

```text
PR Merged
+
PR Transition Gate PASS
```

---

## PR Collaboration

PR Review、Approved、Changes Requested、Merged 属于外部事实。

这些事实应通过 External State Sync 回流 Multica 后再继续处理。

正常路由优先使用确定性规则：

```text
PR Changes Requested
→ 原 Engineer

PR Approved
→ 等待 Merge

PR Merged
→ PR Transition Gate
```

正常情况下不需要 Delivery Lead 介入。

只有以下情况升级 Delivery Lead：

```text
PR Feedback 实质性推翻原 Analysis
需要新增 Repository
需要新增或重新拆分 Development Unit
跨 Development Unit Contract 冲突
无法确定 Review Feedback 责任归属
连续多轮出现相同问题
```

---

## Development Completion

对于 Simple Delivery：

```text
Verify PASS
+
PR Merged
+
No unresolved blocker
→ Development Complete
```

对于 Complex Delivery：

```text
所有 required Development Sub-Issues 完成
→ Development Complete
```

Complex Delivery 完成后，应显式通知 Delivery Squad 继续处理 Parent Delivery Issue。

不要依赖未明确保证的隐式唤醒行为。

---

## Integration Verification

Development Complete 后，由 Delivery Lead 判断是否需要 Integration Verify。

重点考虑以下情况：

```text
多 Repository
API + Consumer
前后端 Contract
Event / Schema
Flink 与上下游系统
多个 Development Unit 组合后才能覆盖 Parent Acceptance Criteria
```

默认在当前 Delivery Issue 内：

```text
@Verify Agent
→ Integration Verify
```

只有 Integration Verify 本身具有：

```text
独立 Owner
独立环境
较长生命周期
独立计划
```

时，才创建独立 Sub-Issue。

Integration Verify FAIL 时，应明确失败归因并只重新激活受影响的 Development Unit。

---

## Deterministic Gate Rules

以下事项优先交给 Deterministic Gate / Script：

```text
Analysis Package 是否完整
Task Graph 是否合法
depends_on 是否有效
是否存在 cycle
Verify 是否 PASS
PR 是否 MERGED
是否存在 unresolved blocker
required Sub-Issue 是否全部完成
Completion 条件是否满足
```

统一结果：

```text
PASS
→ 允许继续

FAIL
→ 不允许继续，进入 targeted rework

UNKNOWN
→ Delivery Lead / Human
```

任何 Squad Member 不得覆盖明确的 Gate FAIL。

---

## Human Decision

以下事项必须等待 Human：

```text
Analysis Approval
PR Human Review
团队明确要求的最终人工确认
其他被标记为 Human Gate 的事项
```

Squad 不得代替 Human 完成人工批准。

---

## Escalation Rules

出现以下情况时，应交给 Delivery Lead：

```text
下一责任角色无法确定
Repository Scope 不明确
Task Graph 存在语义冲突
需要重新拆分 Development Unit
需要新增 Repository
跨任务 Contract 冲突
PR Feedback 推翻原 Analysis
Integration Failure 无法可靠归因
Gate UNKNOWN
Engineer ↔ Verify 连续多轮相同 blocker
Multica 状态与外部同步事实冲突
```

如果 Delivery Lead 仍无法可靠处理，升级 Human。

---

## Completion

关闭 Delivery Issue 前必须确认：

```text
Analysis Gate PASS
Analysis Human Review APPROVED
所有 required Development Units 完成
所有 required Verify PASS
所有 required PR MERGED
无 unresolved blocker
Integration Verify PASS（如果 required）
```

Completion Gate PASS 后，由 Delivery Lead 完成：

```text
Final Delivery Summary
TFS Work Item 更新
PR / Verify / Integration 结果记录
Delivery Issue → done
```

---

## Collaboration Principles

所有成员遵循以下原则：

```text
Multica 当前状态是研发流程事实依据。

专业问题交给 Specialist Agent。

确定性问题交给 Gate / Script。

语义协调问题交给 Delivery Lead。

人工决策交给 Human。

失败优先 targeted rework。

角色切换不创建 Issue。

只有独立交付单元才创建 Sub-Issue。
```

