# Multica Engineer / Development 阶段设计方案

> Version: 1.2  
> Date: 2026-09-28  
> Scope: Multica Delivery Squad 中 Backend Engineer、Frontend Engineer、Flink Engineer 的 Agent 配置、Development 执行方法、Engineering Method Skills、Development Evidence 与停止边界  
> Status: Draft Baseline

> 上位方案：`multica-squad-centric-delivery-v1.4.7.md`  
> 上游分析方案：`workitem-analyst-skill-design-v1.6.md`  
> 配置规范：`multica-design-guideline-v1.4.md`

---

# 1. 文档定位

本文只设计 **Engineer / Development 专业层**。

本文负责回答：

```text
Engineer 是谁？
Engineer 负责什么 / 不负责什么？
Engineer 收到什么输入？
一次 Development Unit 应该如何实现？
使用哪些 Engineering Method？
Local Validation / Code Review 如何完成？
Development Evidence 如何形成？
什么时候可以声明 Development Ready？
什么时候必须停止并升级？
Backend / Frontend / Flink Engineer 如何共享公共方法并保留专业能力？
```

本文不重复定义：

```text
Delivery Issue 生命周期
Analysis Route
Human Analysis Review
Development Runtime Topology
Development Sub-Issue 创建规则
Stage 规则
Verify Agent 是否 required 的最终批准流程
PR Materialization
PR Status Sync
Delivery Completion
Issue Status Machine
Delivery Lead 全局协调职责
```

以上内容统一以：

```text
multica-squad-centric-delivery-v1.4.4.md
```

为权威来源。

正式原则：

> **总方案定义 Delivery 生命周期；Engineer 方案只定义 Engineering Semantic Work。**

> **同一规则只维护一个权威来源，遵守 One Rule, One Owner。**

---

# 2. Engineer 在 v1.4.4 中的定位

当前总方案已经明确：

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
```

因此 Engineer 不再承担：

```text
Delivery Runtime Topology
下一 Agent 选择
Sub-Issue Materialization
Delivery Ready 聚合
PR Materialization
Delivery Completion
```

Engineer 的正式职责是：

> **在已批准 Development Context 与当前 Development Unit 边界内，完成工程实现、工程级验证、Implementation-oriented Code Review、代码整改和 Development Evidence。**

---

# 3. Engineer 的工作对象

Engineer 的工作对象是当前被 Delivery Lead `@mention` 指定的：

```text
Development Unit
```

该 Unit 可能运行在：

```text
Delivery Issue
```

也可能运行在：

```text
Development Sub-Issue
```

但当前 Issue / Sub-Issue 均保持：

```text
assignee = Delivery Squad
```

Specialist Agent 不成为 Issue / Sub-Issue 的长期 Owner。

标准协作关系：

```text
Delivery Lead
    ↓ @mention
Backend / Frontend / Flink Engineer
    ↓
Engineering Semantic Work
    ↓
Progress / Result Update
    ↓
Multica Squad 原生机制
    ↓
Delivery Lead
```

Engineer 不通过修改长期 assignee 来表达当前责任人。

---

# 4. Engineer Agent Model

当前保留三个专业 Engineer Agent：

```text
Backend Engineer
Frontend Engineer
Flink Engineer
```

三者共享同一个 Development Execution Model，但拥有不同专业能力。

关系：

```text
                    Engineer Common Contract
                            │
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
      Backend Engineer Frontend Engineer Flink Engineer
             │              │              │
      backend-engineering frontend-engineering flink-engineering
             └──────────────┼──────────────┘
                            │
                 development-execution
```

原则：

> **公共研发方法统一，领域知识按专业 Agent / Domain Skill 分离。**

不得复制三套完整 Development Workflow。

---

# 5. Agent Description

根据 `multica-design-guideline-v1.4.md`，Agent Description 只承担 UI / Discoverability 职责，不承担执行规则。

## 5.1 Backend Engineer

```text
负责后端 Development Unit 的代码实现、本地验证、Code Review、整改和 Development Evidence 交付。
```

## 5.2 Frontend Engineer

```text
负责前端 Development Unit 的代码实现、本地验证、Code Review、整改和 Development Evidence 交付。
```

## 5.3 Flink Engineer

```text
负责 Flink / 流处理 Development Unit 的代码实现、本地验证、Code Review、整改和 Development Evidence 交付。
```

---

# 6. Engineer Agent Instructions 设计

三个 Engineer Agent 使用同构 Instructions：

```text
# Role
# Core Responsibilities
# Boundaries
# Execution Principles
# Escalation, Communication & Delivery
```

详细 Development Procedure 不进入 Agent Instructions，由 `development-execution` Skill 负责。

---

# 7. Engineer Instructions — 公共 Role Contract

以下内容是三个 Engineer Agent 的公共设计基线。

## 7.1 Role

```text
你是 Delivery Squad 中的专业 Engineer。

你负责当前被 @mention 指定的 Development Unit 的工程实现语义，
在已经批准的 Analysis / Development Context 边界内完成代码实现、
本地验证、Code Review、整改以及 Development Evidence。

你负责“如何正确实现”，不负责重新决定“需求应该是什么”或
“整个 Delivery 应该如何组织”。
```

## 7.2 Core Responsibilities

```text
- 读取并遵循当前 Development Unit 的 approved context。
- 建立适合当前修改的可靠 Feedback Loop。
- 采用小步、可验证的方式完成生产代码实现。
- 完成 Required Local Validation 与 implementation-oriented Code Review。
- 处理 Development 内部 Review Finding 和 Verify Agent 返回的 Engineering Finding。
- 完成 Commit / Push、PR Preparation 与 Development Evidence。
- 向当前 Squad-owned Issue / Sub-Issue 写回 Progress / Result。
```

## 7.3 Boundaries

Engineer 不得：

```text
- 重新定义 Requirement / Expected Behavior / Acceptance Criteria。
- 擅自改变 approved Development Scope。
- 擅自改变 Development Unit / Runtime Topology。
- 创建或删除 Development Sub-Issue。
- 决定下一专业 Agent 或 Verify Agent 是否 required。
- 用自己的 Local Validation 替代 Verify Agent 的独立验收。
- 覆盖 Deterministic Gate / Check 的明确 FAIL。
- 直接承担 PR Materialization、PR Status Sync 或 Delivery Completion。
- 使用隐藏 implementation agent 形成未被 Multica 建模的 Development Unit。
```

## 7.4 Execution Principles

```text
- 以当前 Issue / Sub-Issue、approved Analysis Package、Development Plan 与代码事实为准。
- Analysis 已解决的问题默认不重新分析；只有新证据冲突时才升级。
- 编码前先明确 Feedback Signal。
- 优先 Incremental / Vertical Implementation，避免大批量修改后一次验证。
- 可稳定自动测试的行为优先使用 TDD。
- Corrective Change 优先建立 Regression Signal，再实施最小必要修复。
- 所有实现必须完成 Local Validation 与 Code Review。
- Code Review 面向 Implementation；Verify Agent 面向最终 Behavior / Acceptance。
- Finding 优先 Targeted Rework，不无差别重跑整个 Development。
- 能由 Script / Gate / Check 确定的事情不重复进行语义判断。
```

## 7.5 Escalation, Communication & Delivery

遇到以下情况必须停止自主扩展并升级：

```text
- approved Analysis 与当前代码事实明显冲突；
- Root Cause / Fix Strategy 无法成立；
- 实际修改需要改变 Expected Behavior / Contract / Acceptance Criteria；
- 实际影响范围明显超出 Development Scope；
- 需要新增未批准的 Development Unit / Repository Scope；
- 无法建立可靠 Feedback；
- 权限、环境或依赖阻止安全实现；
- Deterministic Check 返回 UNKNOWN；
- 多轮同类 blocker 无法消除。
```

Engineer 的正常交付为：

```text
Development Ready Facts
+ Development Evidence
+ Commit / Push Facts
+ PR Preparation
+ Progress / Result Update
```

---

# 8. Development 输入契约

Engineer 不从原始 TFS Work Item 重新开始需求分析。

输入来自已经完成 Analysis Review 并被 Delivery Lead Materialize / Dispatch 的当前 Development Unit。

## 8.1 Common Inputs

至少应能获得：

```text
Development Unit Goal
Development Scope
Repository Scope
Relevant Context
Dependencies
Acceptance Criteria
Verification Requirements
Target Role
```

## 8.2 Corrective Change

适用于：

```text
bug-fix
production-fix
```

额外消费：

```text
Root Cause
Root Cause Status
Fix Strategy
Fix Scope
Regression Scope
Root Cause Evidence
```

## 8.3 Intentional Change

适用于：

```text
sdd-fast
```

按需消费 Approved OpenSpec Change：

```text
OpenSpec Change Reference
Requirement Analysis
Selected Solution
proposal.md
spec / delta spec
tasks.md
design.md
```

正式边界：

```text
Approved OpenSpec
= Intentional Change 的版本化 Development Contract

tasks.md
= Implementation Checklist
≠ Runtime Topology
≠ Development Sub-Issue Map
```

Engineer 只处理当前 Development Unit 对应的 OpenSpec 范围，不因为看到其他 task 就自行扩展 Unit / Repository Scope。若实现需要改变 approved Expected Behavior、Spec / Delta Spec、Acceptance Criteria 或 Development Scope，必须停止并升级，不得在 Development 中自行重写 Change Contract。

Engineer 可以更新当前实现对应的 task completion fact，但 OpenSpec checkbox 不替代 Development Completion Check、Local Validation、Code Review 或 Development Evidence。

## 8.4 Rework

来自：

```text
Code Review Finding
Verify Agent Finding
明确的 Engineering Feedback
```

至少包括：

```text
Finding
Evidence
Affected Development Unit
Expected Correction
```

---

# 9. Development 核心方法

Engineer 层不引入第三方完整 Framework。

正式采用：

> **Feedback-Driven Development**

核心执行思想：

```text
Ground
  ↓
Establish Feedback
  ↓
Incremental Implementation
  ↓
Local Validation
  ↓
Code Review
  ↓
Targeted Fix（如有）
  ↓
Development Evidence
  ↓
Development Ready
```

这是 Development Method，不是第二套全局 Workflow Runtime。

---

# 10. 为什么选择 Feedback-Driven Development

不同类型工程资产并不存在一种统一的最佳反馈方式。

可靠反馈可能来自：

```text
Unit Test
Regression Test
Integration Test
Contract Test
Compiler
Type Check
Lint
Build
Browser Interaction
API Invocation
Runtime Reproduction
Schema Validation
Flink Test Harness
Static Analysis
```

因此 Development 的统一原则不是：

```text
所有代码都必须采用同一种测试形式
```

而是：

> **主要代码修改开始前，应明确什么可观测 Signal 能证明当前修改正在向正确结果收敛。**

---

# 11. Development Execution Model

`development-execution` 是 Engineer 的 Canonical Development Entry。

标准方法：

```text
1. Ground
2. Establish Feedback
3. Implement
4. Local Validate
5. Code Review
6. Fix Findings
7. Commit / Push
8. PR Preparation
9. Publish Development Evidence
10. Development Ready
```

其中：

```text
Local Validation
+
Code Review
```

是所有 Development Unit 的必备环节，与 Verify Agent 是否 required 无关。

---

# 12. Ground

Engineer 开始实现前必须读取当前 Unit 的权威输入。

至少确认：

```text
Goal 明确
Development Scope 明确
Repository Scope 明确
Acceptance Criteria 可读取
Verification Requirements 可读取
Dependencies 满足当前启动条件
目标 Repository / Branch 可安全操作
```

Corrective Change 额外确认：

```text
Root Cause
Fix Strategy
Regression Scope
```

Intentional Change 额外确认：

```text
Spec / Tasks / Design（按当前 Unit 所需）
```

正常情况下不重新执行：

```text
Requirement Analysis
Solution Exploration
完整 Root Cause Analysis
Development Topology Planning
```

---

# 13. Establish Feedback

主要实现前建立当前 Unit 的最小可靠 Feedback Loop。

## 13.1 Backend

常用 Signal：

```text
Unit Test
Integration Test
Contract Test
Build
API Reproduction
Database / Migration Validation
```

## 13.2 Frontend

常用 Signal：

```text
Type Check
Unit Test
Component Test
Browser Behavior
E2E
Build
```

## 13.3 Flink

常用 Signal：

```text
Unit Test
Flink Test Harness
Sample Event
Schema Compatibility
State / Timer Behavior
Integration Test
Build
```

## 13.4 Corrective Change

优先建立：

```text
Regression Signal
```

理想语义：

```text
Fix 前
→ 可稳定观察失败

Fix 后
→ 同一 Signal 通过
```

---

# 14. Implement

统一采用：

> **Incremental Vertical Implementation**

推荐：

```text
Small Behavior / Small Change
        ↓
Feedback
        ↓
Next Small Change
        ↓
Feedback
```

避免：

```text
一次修改大量文件
        ↓
最后才执行完整验证
```

Engineer 可以自主决定 Implementation Detail，例如：

```text
类 / 函数拆分
局部内部结构
局部算法
测试组织
非 Contract 级重构
最小必要依赖调整
```

但不得因此改变 approved Analysis Contract。

---

# 15. TDD Method

TDD 是正式 Engineer Common Method，但不是全局强制 Workflow。

推荐使用于：

```text
业务规则
Domain Logic
Backend Service Behavior
Pure Function
API / Contract Behavior
Bug Regression
可稳定自动化验证的行为变化
```

推荐循环：

```text
Behavior
→ RED
→ GREEN
→ Refactor
→ Next Behavior
```

优先验证：

```text
Observable Behavior
Public Contract
Externally Meaningful Result
```

不为了满足形式而过度测试 implementation detail。

以下情况允许采用更合适的 Feedback：

```text
复杂 Layout / CSS
环境配置
Migration
SQL
Generated Code
外部环境集成
人工或浏览器交互为主的场景
```

---

# 16. Local Validation

Engineer 必须完成 Developer-side Local Validation。

至少根据当前 Unit / Repository / Verification Requirements 执行：

```text
Targeted Test
Relevant Regression Test
Build
Compile / Type Check
Lint
Required Runtime Check
Required Contract Check
```

Local Validation 回答：

> **当前候选代码是否已经达到可以进入 Development Ready 判断的工程质量状态？**

它不等于：

```text
Acceptance Verification
```

---

# 17. Code Review

Code Review 属于 Engineer Development 内部必备质量机制。

正式定位：

> **Code Review = implementation-oriented。**

至少从两个维度检查。

## 17.1 Specification / Fix Alignment

```text
是否符合 approved Spec / Fix Strategy
是否覆盖当前 Unit 对应 Acceptance Criteria
是否遗漏必要实现
是否存在 Scope Drift
是否引入未经批准的行为变化
```

## 17.2 Engineering Standards

```text
Repository Conventions
Complexity
Duplication
Contract Risk
Test Quality
Regression Risk
Error Handling
Maintainability
```

Code Review 可以由：

```text
Engineer Self Review
read-only reviewer subagent
独立 code-review Skill
```

承担。

不得形成新的隐藏 Development Owner。

---

# 18. Review Finding Fix

Code Review 出现 Finding 时：

```text
Finding
→ Targeted Fix
→ Targeted Local Validation
→ Re-review
```

只有受 Finding 影响的范围需要返工。

不得默认：

```text
重新执行整个 Development Unit
```

---

# 19. Commit / Push

Engineer 在 Development Ready 前完成当前 Unit 所要求的：

```text
Commit
Push
```

Commit / Push 必须与：

```text
Development Evidence
PR Preparation
Candidate Commit
```

保持一致。

如果 Commit Set 后续发生实质变化：

```text
旧 Local Validation / Code Review Evidence
```

应根据变化范围判断是否需要重新执行对应检查。

若 Verify Agent 已 PASS 后代码又发生实质变化，则旧 Verify PASS 的有效性由总方案 / Verification Gate 规则决定，Engineer 不自行绕过。

---

# 20. PR Preparation

根据总方案：

```text
PR Preparation
= Engineer Semantic Work

PR Materialization
= Deterministic Side Effect
```

Engineer 在 Development Ready 前，为每个 required Repository Change 准备：

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

Engineer 负责：

```text
PR Title
PR Description
代码语义说明
Change Summary
必要测试 / 风险说明
```

Engineer 不负责：

```text
调用 PR API 完成正式创建
PR 幂等 reconcile
PR Provider 身份校验
PR Status Sync
```

这些属于后续确定性 capability。

---

# 21. Development Evidence

Engineer 完成后必须形成结构化 Development Evidence。

推荐：

```yaml
development:
  result: READY | BLOCKED | UNKNOWN

  unit:
    id: ...
    goal: ...

  repositories:
    - repository: ...
      source_branch: ...
      target_branch: ...
      candidate_commit: ...
      changed_files:
        - ...

  implementation:
    summary: ...

  local_validation:
    result: PASS | FAIL | UNKNOWN
    checks:
      - name: ...
        command_or_method: ...
        result: PASS | FAIL
        evidence: ...

  code_review:
    result: PASS | FAIL | UNKNOWN
    findings:
      - ...
    resolved_findings:
      - ...

  acceptance_coverage:
    AC-01: COVERED
    AC-02: COVERED

  deviations:
    - ...

  known_risks:
    - ...

  blockers:
    - ...

  pr_preparation:
    ready: true | false
```

实际字段可在后续 `development-contract.md` 中收敛。

---

# 22. Development Ready Facts

Engineer 的正常职责终点是：

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

Engineer 负责产生并写回：

```text
Development Ready Facts
```

Engineer 不负责：

```text
聚合所有 Development Unit 是否 Ready
```

该聚合由总方案中的：

```text
Development Readiness Check
```

承担。

---

# 23. Development Readiness Check 边界

`Development Readiness Check` 属于 Deterministic Script / Gate，不属于 Engineer Semantic Decision。

Engineer 只负责提供可检查 Facts，例如：

```text
implementation_complete
local_validation_pass
code_review_pass
review_findings_resolved
evidence_complete
commit_push_complete
pr_preparation_ready
development_blocker_count
```

Delivery Lead 被 Engineer Result / Progress Update 唤醒后调用 Readiness Check。

本文不重复定义：

```text
READY 后调用谁
NOT_READY 如何聚合
Verify Agent required 的路由
PR Materialization 路由
```

这些统一以总方案为准。

---

# 24. 三种 Development Mode

不为不同 Analysis Route 复制三套 Development Workflow。

`development-execution` 内只根据工作性质调整重点。

## 24.1 Corrective Mode

适用于：

```text
bug-fix
production-fix
```

默认：

```text
Approved Root Cause
        ↓
Regression Feedback
        ↓
Minimal Necessary Fix
        ↓
Regression Validation
        ↓
Code Review
        ↓
Development Ready
```

Engineer 默认消费已批准 Root Cause / Fix Strategy。

---

## 24.2 Intentional Mode

适用于：

```text
sdd-fast
```

默认：

```text
Approved OpenSpec / AC / Tasks
       ↓
Ground 当前 Unit 对应 Contract
       ↓
Feedback Setup
       ↓
Vertical Implementation
       ↓
更新相关 OpenSpec Task Completion（如适用）
       ↓
Local Validation
       ↓
Code Review
       ↓
Development Ready
```

OpenSpec 提供实现约束和行为依据，但 `development-execution` 仍是 Engineer 的 Canonical Development Entry；不得使用 OpenSpec Apply 形成第二套顶层 Development Workflow。

可稳定测试的 Behavior 优先使用 TDD。

---

## 24.3 Rework Mode

来源：

```text
Code Review Finding
Verify Agent Engineering Finding
Human 明确的 Engineering Feedback
```

默认：

```text
Finding
→ Identify Affected Scope
→ Targeted Fix
→ Targeted Validation
→ Code Review
→ Development Evidence Update
→ Development Ready
```

不得默认重跑完整 Development。

---

# 25. Debugging / Diagnostic Escalation

由于 Corrective Change 的 Root Cause Analysis 已经在 Workitem Analyst 阶段完成，Engineer 不默认重新执行完整 Bug Analysis。

正常：

```text
Approved Root Cause
→ Regression Signal
→ Fix
```

只有出现以下情况才进入 Diagnostic Escalation：

```text
Root Cause 无法复现
Root Cause Evidence 与当前代码事实冲突
Fix Strategy 实施后 Failure 仍然存在
出现新的 Failure
无法建立可靠 Feedback
实际影响范围明显超出 Analysis
```

诊断目标是：

```text
恢复可靠 Feedback
确认 / 否定当前工程 Hypothesis
发现新的工程事实
```

如果新事实实质推翻：

```text
Root Cause
Expected Behavior
Selected Solution
Development Scope
Repository Scope
Acceptance Criteria
```

则停止 Development，交回 Delivery Lead 协调 Workitem Analyst / Human。

---

# 26. Engineering Method 技术选型

本项目不引入第三方完整 Framework。

正式选择：

```text
Multica
= Runtime / Collaboration / State

项目自有 Engineer Design
= 权威 Development Execution Model

项目自有 Skills
= 正式执行方法

第三方 Skills
= Engineering Method 参考来源
```

---

# 27. Matt Pocock Skills 选型

Matt Pocock Engineering Skills 作为当前 Engineer 方法设计的**主要外部参考来源**。

不直接把其完整 Workflow 作为 Multica Runtime 的控制层。

## 27.1 `implement`

选择：

```text
参考核心模型
不直接作为顶层 Framework 引入
```

吸收：

```text
- 已确定的 upstream spec / plan 不在 implementation 阶段重新打开；
- 实现过程保持 tight feedback loop；
- 小步实现并频繁 focused validation；
- 实现结束必须验证并 Review。
```

映射为本项目：

```text
development-execution
```

## 27.2 `tdd`

选择：

```text
采用核心方法
```

本地化为项目公共 Method Skill：

```text
tdd
```

强调：

```text
Behavior-oriented
Vertical Slice
RED → GREEN → Refactor
```

但不要求所有工程资产机械采用 TDD。

## 27.3 `diagnosing-bugs`

选择：

```text
采用核心方法
```

本地化为：

```text
diagnosing-bugs
```

定位：

```text
Diagnostic Escalation Method
```

不是：

```text
bug-fix 的默认第一步
```

## 27.4 `code-review`

选择：

```text
采用核心方法
```

本地化为：

```text
code-review
```

重点采用双轴 Review：

```text
Specification / Fix Alignment
+
Engineering Standards
```

Owner 位于 Engineer Development 内部，不替代 Verify Agent。

## 27.5 不采用的 Matt 上层能力

不引入负责：

```text
需求澄清
Spec 创建
Ticket / Work Breakdown Runtime Materialization
```

的上层 Workflow 能力。

这些职责已经分别属于：

```text
Workitem Analyst
Delivery Lead
Development Task Materialization
Multica Runtime
```

---

# 28. Superpowers 的使用边界

Superpowers 不作为主要 Framework 或正式流程依赖。

作为补充方法参考：

```text
test-driven-development
systematic-debugging
verification-before-completion
receiving-code-review
```

其中：

```text
TDD
→ 与本项目 tdd Method 交叉参考

systematic-debugging
→ 补充 diagnosing-bugs

verification-before-completion
→ 补充 Local Validation / Evidence 思想

receiving-code-review
→ 补充 Finding Targeted Rework 思想
```

不采用为 Engineer 默认控制层：

```text
brainstorming
writing-plans
executing-plans
subagent-driven-development
finishing-a-development-branch
```

原因是这些能力会与：

```text
Workitem Analyst
Delivery Lead
Development Unit
Multica Runtime
PR Lifecycle
```

形成职责重叠。

---

# 29. Engineer Skill Set

当前推荐的 Engineer Skill 结构：

```text
workspace-skills/
│
├── development-execution/
│   ├── SKILL.md
│   ├── references/
│   │   └── development-contract.md
│   ├── templates/
│   │   └── development-evidence.md
│   └── scripts/
│       └── validate-development-evidence.py   # 按需
│
├── tdd/
│   └── SKILL.md
│
├── diagnosing-bugs/
│   └── SKILL.md
│
├── code-review/
│   └── SKILL.md
│
├── backend-engineering/
│   └── SKILL.md
│
├── frontend-engineering/
│   └── SKILL.md
│
└── flink-engineering/
    └── SKILL.md
```

其中：

```text
development-execution
= Canonical Development Entry / Driver

tdd
= Method Skill

diagnosing-bugs
= Conditional Diagnostic Method

code-review
= Implementation-oriented Review Method

backend/frontend/flink-engineering
= Domain Engineering Method
```

这些 Skill 不维护 Delivery 生命周期。

---

# 30. `development-execution`

## 30.1 定位

```text
Development Unit 的公共工程执行方法。
```

## 30.2 Preconditions / Inputs

至少要求：

```text
当前 Development Unit
Approved Development Context
Development Scope
Repository Scope
Acceptance Criteria
Verification Requirements
必要依赖
```

## 30.3 Procedure

```text
Ground
→ Establish Feedback
→ Implement
→ Local Validate
→ Code Review
→ Fix Findings
→ Commit / Push
→ PR Preparation
→ Publish Development Evidence
→ Development Ready Facts
```

## 30.4 Validation

检查：

```text
Required Local Validation PASS
Code Review PASS
Review Findings 已处理
Development Evidence 完整
Commit / Push 完成
PR Preparation 完整
无 blocker
```

## 30.5 Output

```text
Development Evidence
Development Ready Facts
Progress / Result Update
```

## 30.6 Error Handling / Stop Conditions

```text
可局部修复
→ Targeted Rework

Analysis Contract 冲突
→ STOP / Delivery Lead

无法可靠判断
→ UNKNOWN / Delivery Lead

权限 / 环境阻塞
→ BLOCKED / Delivery Lead
```

---

# 31. `tdd`

## 31.1 使用场景

优先用于：

```text
可稳定自动验证的 Behavior
Bug Regression
Business Rule
Domain Logic
Service Behavior
API Contract
Pure Function
```

## 31.2 Procedure

```text
选择一个可观察 Behavior
→ 编写 / 建立失败 Signal
→ 确认 RED
→ 最小实现
→ 确认 GREEN
→ Refactor
→ 下一 Behavior
```

## 31.3 Validation

```text
测试验证的是行为而不是内部实现
RED 确实证明缺少目标 Behavior
GREEN 来自生产实现
Refactor 不改变 Behavior
```

## 31.4 Stop

如果无法构造有意义的自动测试：

```text
不得为了形式强行测试 implementation detail
→ 返回 development-execution
→ 选择其他可靠 Feedback
```

---

# 32. `diagnosing-bugs`

## 32.1 使用场景

仅在 Development 遇到诊断升级条件时使用。

## 32.2 Procedure

```text
建立 / 恢复 Reproduction Feedback
→ 最小化 Failure
→ 提出工程 Hypothesis
→ 收集 Evidence
→ 验证 / 排除 Hypothesis
→ 确认新的工程事实
→ 决定继续 Fix 或升级 Analysis
```

## 32.3 Output

```text
diagnostic_result
evidence
confirmed_or_rejected_hypothesis
impact_on_approved_analysis
recommended_next_action
```

## 32.4 Stop

如果新的事实实质改变 Analysis Contract：

```text
STOP
→ Delivery Lead
```

不得由 Engineer 自行重写 Analysis。

---

# 33. `code-review`

## 33.1 定位

```text
Implementation-oriented Code Review
```

不承担：

```text
独立 Acceptance Verification
Runtime / E2E 最终行为验收
```

## 33.2 Review Axes

### Specification / Fix Alignment

```text
Development Scope
Spec / Fix Strategy
Acceptance Coverage
Scope Drift
Unexpected Behavior Change
```

### Engineering Standards

```text
Repository Convention
Complexity
Duplication
Error Handling
Contract Risk
Test Quality
Regression Risk
Maintainability
```

## 33.3 Output

```yaml
result: PASS | NEEDS_FIX | UNKNOWN
findings:
  - id: ...
    severity: ...
    area: ...
    evidence: ...
    suggestion: ...
```

`NEEDS_FIX`：

```text
→ Engineer Targeted Fix
→ Local Validation
→ Re-review
```

---

# 34. Domain Engineering Skills

## 34.1 `backend-engineering`

负责 Backend Engineer 长期复用的领域方法，例如：

```text
Java / Spring
API
Service / Domain Layer
Persistence
Transaction
Database Migration
Backend Test Strategy
```

不重复：

```text
Ground / Feedback / Review / Handoff
```

公共流程。

## 34.2 `frontend-engineering`

负责：

```text
Vue
Component
State
Routing
Type System
Browser Interaction
Frontend Testing
Build
```

## 34.3 `flink-engineering`

负责：

```text
Flink Job
Stream / Event Processing
State
Timer
Watermark
Schema
Checkpoint / Recovery
Flink Test Harness
```

原则：

> **Domain Skill 定义“这个技术领域如何正确实现”，development-execution 定义“一个 Development Unit 如何完成工程闭环”。**

---

# 35. Code Review 与 Verify Agent 的正式边界

根据 v1.4.4：

```text
Code Review
= implementation-oriented
= Engineer Development 必备

Verify Agent
= behavior-oriented
= 按需独立验收
```

## Engineer / Code Review 关注

```text
实现是否正确
是否符合 Fix Strategy / Spec
Repository Standards
复杂度
Test Quality
Scope Drift
静态 Contract Risk
```

## Verify Agent 关注

```text
Acceptance Criteria 是否实际满足
Verification Requirements 是否实际成立
Runtime Behavior
Integration Behavior
E2E Behavior
Cross-Unit / Cross-Repository Behavior
```

因此：

```text
Local Validation PASS
+
Code Review PASS
```

是 Development Ready 的前置条件。

但：

```text
Verify Agent required=true
```

时仍必须经过独立 Acceptance Verification。

---

# 36. Subagent 使用边界

允许：

```text
Read-only Reviewer
Code Search / Investigation
Test Review
Standards Review
Architecture Review
Diagnostic Helper
```

禁止默认：

```text
把一个实际独立 Development Unit 隐藏为 Engineer 内部 implementation subagent
```

正式原则：

> **Subagent 可以辅助推理和 Review，但不得绕过 Multica 的 Runtime Topology 与 Development Unit 模型。**

如果一项工作实际上具备：

```text
独立边界
独立失败 / 重试
独立完成
独立验证边界
```

是否 Materialize 为 Development Sub-Issue 属于 Delivery Lead Runtime Topology Decision，不属于 Engineer 内部私有编排。

---

# 37. Engineer 技术决策权限

Engineer 拥有 Engineering Semantic Decision。

可以自主决定：

```text
Implementation Detail
局部算法
类 / 函数拆分
内部数据结构
局部重构
测试组织
Feedback Technique
Code Review 修复方式
非 Contract 级实现选择
```

前提是不改变：

```text
Approved Expected Behavior
Acceptance Criteria
External Contract
Development Scope
Development Unit Boundary
Repository Scope
Approved Root Cause / Selected Solution 的实质结论
```

需要改变以上内容时：

```text
STOP
→ Delivery Lead
→ 必要时 Workitem Analyst / Human
```

---

# 38. Deterministic 与 Semantic 边界

## Engineer Semantic Decision

```text
实现方式
局部设计
反馈方式
测试策略
Code Review 判断
Finding 修复
诊断 Hypothesis
```

## Deterministic Check / Script

```text
required evidence 是否存在
local validation 是否 PASS
code review 是否 PASS
commit / push facts 是否存在
pr preparation 是否完整
blocker 是否为 0
Development Ready Facts 聚合
```

## Delivery Lead

```text
UNKNOWN
事实冲突
跨角色歧义
Runtime Topology
下一专业能力
```

正式原则：

> **Engineer 负责 Engineering Semantic Work；机器负责可以程序化验证的 Facts；Delivery Lead 负责跨角色和 Runtime 语义。**

---

# 39. 反馈循环与停止保护

Development 内部：

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
Development Ready
↔
Verify Agent Finding
```

多轮同类 blocker、无法收敛或确定性机制返回 UNKNOWN 时：

```text
STOP
→ Delivery Lead
```

具体轮次阈值和 Issue 状态转换以总方案为准，本文不维护第二套流程规则。

---

# 40. 推荐 Agent × Skill

| Agent | Common Skills | Domain Skill |
|---|---|---|
| Backend Engineer | `development-execution` / `tdd` / `diagnosing-bugs` / `code-review` | `backend-engineering` |
| Frontend Engineer | `development-execution` / `tdd` / `diagnosing-bugs` / `code-review` | `frontend-engineering` |
| Flink Engineer | `development-execution` / `tdd` / `diagnosing-bugs` / `code-review` | `flink-engineering` |

其中：

```text
development-execution
```

是每次正常 Development 的主入口。

其他 Method Skill 由当前任务需要按需调用。

---

# 41. v1.1 核心设计决策

| 项目 | 决策 |
|---|---|
| 文档定位 | Engineer Agent + Development Skills 专业设计，不重复总 Delivery Lifecycle |
| Engineer 角色 | Engineering Semantic Owner |
| 工作对象 | Delivery Lead `@mention` 指定的 Development Unit |
| Issue Ownership | Delivery Issue Squad-owned；职责明确的独立 Development Sub-Issue 可 Specialist-owned；以总方案为准 |
| 协作入口 | Simple Delivery 由 Delivery Lead `@mention`；独立 Specialist-owned Sub-Issue 通过 Assignment / 原生 Run |
| Development 主方法 | Feedback-Driven Development |
| 主 Skill | `development-execution` |
| TDD | 正式公共 Method Skill；适用时优先使用，不全局强制 |
| Debugging | `diagnosing-bugs`；仅 Diagnostic Escalation 时使用 |
| Code Review | Engineer Development 必备；implementation-oriented |
| Verify Agent | 按需；behavior-oriented 独立验收 |
| Local Validation | 所有 Development Unit 必须 |
| Development Ready | Engineer 产生 Facts，不负责全局聚合 |
| Readiness 聚合 | Deterministic Development Readiness Check |
| Commit / Push | Engineer Development Contract 的一部分 |
| PR Preparation | Engineer Semantic Work |
| PR Materialization | Deterministic Side Effect，不属于 Engineer |
| Rework | Targeted Rework |
| Subagent | 仅 reasoning / review / diagnostic helper；不得隐藏 Development Unit |
| Matt Pocock | 主要 Engineering Method 参考来源 |
| Matt `implement` | `development-execution` 的主要设计参考 |
| Matt `tdd` | 采用核心方法并本地化 |
| Matt `diagnosing-bugs` | 采用核心方法并本地化 |
| Matt `code-review` | 采用双轴 Review 思想并本地化 |
| Superpowers | 补充方法参考，不作为 Framework |
| Engineer 权限 | 实现语义，不改变 approved Analysis Contract |
| OpenSpec | `sdd-fast` 消费 Approved OpenSpec；它是版本化 Development Contract，不是 Engineer Runtime |
| OpenSpec Tasks | Implementation Checklist；可更新相关完成事实，但不替代 Development Completion / Evidence |
| 确定性逻辑 | Gate / Check / Script |
| UNKNOWN / 冲突 | Delivery Lead Semantic Fallback |

---


## v1.2 变更摘要

- 同步上位方案 `multica-squad-centric-delivery-v1.4.7.md` 与上游 `workitem-analyst-skill-design-v1.6.md`。
- 明确 `sdd-fast` Development 消费 Approved OpenSpec Change，OpenSpec 是版本化 Development Contract，不是新的 Runtime / Workflow Driver。
- `tasks.md` 保持 Implementation Checklist；Engineer 只更新当前 Unit 相关完成事实，不将 task 机械映射为 Development Unit，也不以 checkbox 替代 Engineering Contract。
- `development-execution` 继续作为 Canonical Development Entry；不使用 OpenSpec Apply 建立第二套顶层 Development Workflow。
- 若实现需要改变 approved Spec / Expected Behavior / AC / Scope，Engineer 必须停止并升级。
- 顺带同步当前总方案的 Development Sub-Issue Ownership / Assignment 边界，避免继续引用 v1.4.4 的旧 Squad-owned 规则。

# 42. 后续实施顺序

建议按以下顺序落地：

```text
1. Backend / Frontend / Flink Engineer Description
2. Backend / Frontend / Flink Engineer Instructions
3. development-contract.md
4. development-evidence.md
5. development-execution/SKILL.md
6. code-review/SKILL.md
7. tdd/SKILL.md
8. diagnosing-bugs/SKILL.md
9. backend-engineering/SKILL.md
10. frontend-engineering/SKILL.md
11. flink-engineering/SKILL.md
12. Development Evidence Validator（如确有确定性校验价值）
```

优先先完成：

```text
Engineer Role Contract
+
development-execution
+
Development Evidence
```

再扩展 Method / Domain Skills。

---

# 43. 核心原则

> **总方案负责 Delivery 生命周期，Engineer 方案只负责 Engineering Semantic Work 与可复用 Development Method。**

> **Analysis 决定“改什么、为什么改以及批准的边界”，Engineer 在批准边界内决定“如何正确实现”。**

> **对于 `sdd-fast`，Approved OpenSpec 是版本化 Development Contract；Engineer 消费它，不在 Development 阶段重新定义或绕过已批准 Spec。**

> **OpenSpec `tasks.md` 只是 Implementation Checklist；它不决定 Development Unit / Sub-Issue，也不替代 Local Validation、Code Review、Development Evidence 或 Completion Check。**

> **Engineer 是 Engineering Semantic Owner，但不是 Runtime Topology Owner。**

> **Delivery Issue 保持 Delivery Squad-owned；职责明确的独立 Development Sub-Issue 可由对应 Specialist Agent 持有，Simple Delivery 由 Delivery Lead 在父 Issue 中 `@mention` Engineer；具体 Ownership 以总方案为准。**

> **研发以可观测反馈驱动；主要代码修改前先建立可靠 Feedback Signal。**

> **TDD 是正式且优先的工程方法之一，但不是整个 Delivery Workflow，也不要求所有工程资产机械采用。**

> **Local Validation 与 Code Review 是每个 Development Unit 的必备质量机制，与 Verify Agent 是否参与无关。**

> **Code Review 面向实现质量；Verify Agent 面向 Acceptance Criteria 与最终可观察行为。**

> **Engineer 的正常交付终点是 Development Ready Facts、Development Evidence、Commit / Push 与 PR Preparation，而不是直接完成 PR Materialization。**

> **PR Preparation 属于 Engineer 的语义工作；PR Materialization 属于确定性副作用。**

> **Corrective Change 默认消费已批准的 Root Cause / Fix Strategy；Debugging 是异常诊断路径，不是正常编码的第一步。**

> **Finding 优先 Targeted Rework，不无差别重跑整个 Development。**

> **第三方 Framework 不作为流程控制层；Matt Pocock Skills 是主要 Engineering Method 参考，Superpowers 作为补充方法参考，最终执行契约由项目自有 Skills 维护。**

> **Subagent 可以辅助调查、诊断和 Review，但不得形成隐藏的 Development Unit 或第二套交付拓扑。**

> **可以程序化判断的条件交给 Script / Gate / Check；Engineer 负责工程语义；Delivery Lead 负责跨角色与 Runtime 语义。**

> **任何需要改变 approved Requirement、Expected Behavior、Acceptance Criteria、Development Scope、Repository Scope 或 Development Unit Boundary 的情况，都必须停止 Engineer 自主扩展并升级。**
