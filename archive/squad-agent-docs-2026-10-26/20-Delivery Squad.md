# Delivery Squad Description

负责单个研发任务的多角色协作，由 Delivery Lead 协调 Analyst、Engineer 和 Verify 完成端到端研发交付。

# Delivery Squad Instructions

## Collaboration Model

自动 TFS 入口的 Delivery Issue 经 Wayfinder 判定 `eligible`、完成 `/note` Comment 持久化并交接后，由本 Squad 协作；经明确直接委派的 Analysis 也可进入本 Squad，不要求补做 Wayfinder 准入。所有 Analysis 仍需后续 Analysis Gate 与 Human Approval 才能进入 Development。

Delivery Lead 是 Squad Leader，负责协调、语义路由和异常处理。

Squad Members：

```text
Workitem Analyst
Backend Engineer
Frontend Engineer
Flink Engineer
Verify Agent
```

专业工作由对应 Specialist Agent 完成。

已有明确 Owner 的专业工作可通过原生 Mention / Assignment 协作；首次 Analysis 委派及批准后的成员分工由 Delivery Lead 负责，不绕过授权与去重。

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

已批准的 Independent Verification 且 verify_agent.required=true
→ Verify Agent；其他 Task Verification 由 Task Owner 执行
```

责任明确时直接交给对应 Specialist Agent。

以下情况由 Delivery Lead 进行语义协调：

```text
责任角色无法确定
跨多个专业角色
Repository 归属不明确
Development Unit 边界不明确
跨任务 Contract 冲突
Deterministic Route 无法可靠判断
```

---

## Issue and Delivery Unit Rules

角色变化不等于新的 Issue。

Analysis、Development、Verify、PR 等协作默认在当前 Delivery Issue 内完成。

仅在 Task Set 需要独立、持久的 Owner / Status / Block / Retry / Completion / Stage Runtime State 时才创建 Development Sub-Issue；Task、Engineer、Repository 或 PR 数量本身不是创建条件。

Development Sub-Issue 承接已批准 Task Set 的 Runtime State；OpenSpec Tasks 仍为 Engineering Truth，PR 按 Repository 独立创建，不为 Verify Agent 或 PR 机械拆分 Issue。

Stage 只用于独立 Development Units 之间真实存在的依赖关系。

---

## Collaboration Rules

Analysis 必须经过规定的 Analysis Gate 和 Human Approval 后才能进入正式 Development。

Engineer 必须完成 Task Verification、Local Validation 和 Code Review；仅当 Human 确认 `verify_agent.required=true` 时调用独立 Verify Agent。Verify FAIL 根据 Findings / `task_refs` 定向返工；Verify 不要求或有效 PASS 后由父 Delivery 调用确定性 PR Materialization，不再为 PR 创建额外唤醒 Engineer。

PR Review、Approved、Changes Requested、Merged 等外部事实，以 External State Sync 回流 Multica 后的状态为准。

责任明确的 Verify Feedback 和 PR Review Feedback 应直接返回对应 Engineer，不经过 Delivery Lead。

Development 后由父 Delivery 汇总 Evidence，执行已批准的 Verification Contract；Integration / E2E 是 Verification Method 而非固定 Stage。PR `completed` 后由 PR Status Sync 当前 Run 有界 Finalize。

---

## Gate and Human Rules

可以确定性判断的事项必须使用对应 Deterministic Gate / Route。

```text
PASS
→ 允许继续

FAIL
→ 不允许继续，进入 targeted rework

UNKNOWN
→ Delivery Lead / Human
```

任何 Squad Member 不得覆盖明确的 Gate FAIL。

所有被定义为 Human Gate 的事项必须等待 Human Decision，Squad 不得代替人工批准。

Delivery Issue 只有在 Completion Gate PASS 后才允许关闭。

---

## Escalation

出现以下情况时交给 Delivery Lead：

```text
下一责任角色无法确定
Repository 或 Development Unit 边界不明确
Task Graph 出现语义冲突
需要新增或重新拆分 Development Unit
需要新增 Repository
跨 Development Unit Contract 冲突
PR Feedback 实质性推翻原 Analysis
Integration Failure 无法可靠归因
Gate UNKNOWN
Engineer 与 Verify 连续多轮重复失败
Multica 状态与外部事实发生冲突
```

Delivery Lead 无法可靠处理时升级 Human。

---

## Collaboration Principles

```text
Multica 保存当前研发流程事实。

专业问题交给 Specialist Agent。

确定性问题交给 Gate / Route。

跨角色和异常问题交给 Delivery Lead。

人工决策交给 Human。

失败优先 targeted rework。

角色变化不创建 Issue。

只有独立交付单元才创建 Sub-Issue。
```
