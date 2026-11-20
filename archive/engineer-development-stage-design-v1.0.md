# Multica 研发阶段 / Engineer 层设计方案

> Version: 1.0  
> Date: 2026-09-25  
> Scope: Multica Delivery Squad 中 Development 阶段的 Engineer 执行模型、研发方法、验证闭环与职责边界  
> Status: Draft Baseline

> 本方案基于 `multica-squad-centric-delivery-v1.3.6`、`workitem-analyst-skill-design-v1.5` 与 `multica-design-guideline-v1.4`。  
> 本版本只定义 Development / Engineer 层的目标设计，不引入第三方 Framework；Superpowers、Matt Pocock Skills 等只作为 Engineering Method 的参考来源。

---

# 1. 目标

Development 阶段负责：

> **将经过 Analysis、Human Review 并已形成明确 Development Scope 的 Development Unit，可靠地转化为经过本地验证、可交给 Verify Agent 独立验证的代码变更。**

核心目标：

- 不在 Engineer 阶段重复 Requirement Analysis、Root Cause Analysis、Solution Design；
- 以 Development Unit 作为 Engineer 的主要工作边界；
- 采用 Feedback-Driven Development，而不是绑定某一个固定编码 Framework；
- TDD 作为优先使用的 Engineering Method，而不是整个 Development Workflow；
- Engineer 自身 Local Validation 与 Verify Agent 的 Independent Verification 明确分层；
- 失败采用 Targeted Rework，不无差别重跑整个 Development；
- 不在 Engineer 内部再建立第二套 Agent Orchestration；
- 第三方 Skills 只借鉴方法，不成为 Multica Delivery Runtime 的控制层。

---

# 2. 与总体 Delivery 架构的关系

当前整体模型：

```text
TFS Work Item
      ↓
Delivery Issue
      ↓
Workitem Analyst
      ↓
Analysis Package
      ↓
Analysis Gate
      ↓
Human Analysis Review
      ↓
Delivery Lead
      ↓
Development Topology / Development Unit
      ↓
Engineer
      ↓
Development Execution
      ↓
Verify Agent
      ↓
PR
      ↓
PR / Completion Flow
```

Development 不重新定义：

```text
Analysis Route
Issue Lifecycle
Sub-Issue Lifecycle
PR Lifecycle
Delivery Completion
```

这些继续由：

```text
Multica Runtime
Delivery Lead
Deterministic Gate / Route
External State Sync
```

负责。

---

# 3. Engineer 的正式工作对象

Engineer 默认处理：

```text
Development Unit
```

而不是直接处理完整的：

```text
Delivery Issue
```

## 3.1 Simple Delivery

当一个 Delivery Issue 只有一个隐式 Development Unit：

```text
Delivery Issue
≈
1 Development Unit
```

Engineer 可以直接在当前 Delivery Issue 中工作。

## 3.2 Complex Delivery

存在多个真正独立的 Development Unit 时：

```text
Delivery Issue
├── Development Unit A
├── Development Unit B
└── Development Unit C
```

需要独立生命周期的 Development Unit 才物化为：

```text
Development Sub-Issue
```

跨 Repository 本身不构成拆分条件。

---

# 4. Development 输入契约

Engineer 不从原始需求重新开始分析，而是消费已经通过 Human Analysis Review 的 Development-Ready Package。

## 4.1 Common Inputs

至少包括：

```text
Development Scope
Repository Scope
Acceptance Criteria
Verification Requirements
Dependencies
Relevant Context
```

## 4.2 Corrective Change

适用于：

```text
bug-fix
production-fix
```

额外输入：

```text
Root Cause
Root Cause Status
Fix Strategy
Fix Scope
Regression Scope
Evidence
```

Engineer 默认接受已经批准的 Root Cause / Fix Strategy，不重新执行完整 Bug Analysis。

## 4.3 Intentional Change

适用于：

```text
sdd-fast
```

额外输入：

```text
Requirement Analysis
Selected Solution
proposal.md
spec / delta spec（按需）
tasks.md
design.md（按需）
```

其中：

```text
tasks.md
=
Implementation Checklist
```

不等于 Development Sub-Issue。

---

# 5. Development 核心方法：Feedback-Driven Development

本方案不把 Development 绑定到：

```text
TDD Framework
Superpowers Framework
Matt Pocock Framework
Subagent-driven Development
```

统一采用：

> **Feedback-Driven Development**

核心思想：

```text
明确当前行为目标
        ↓
建立可观测 Feedback
        ↓
小步修改
        ↓
快速反馈
        ↓
继续修改 / 修正
        ↓
满足 Development Contract
```

Feedback 可以来自：

```text
Unit Test
Regression Test
Integration Test
Contract Test
Compiler
Type Check
Lint
Build
Browser
API Invocation
Runtime Reproduction
Schema Validation
Flink Test Harness
其他项目级验证能力
```

重点不是统一使用某一种测试技术，而是：

> **在编码开始前明确：什么信号能够证明本次修改正在向正确方向推进。**

---

# 6. Development Execution Model

Engineer 的标准执行模型统一为六个步骤：

```text
Development Unit
       ↓
1. Ground
       ↓
2. Establish Feedback
       ↓
3. Implement
       ↓
4. Validate
       ↓
5. Review
       ↓
6. Handoff
       ↓
Verify Agent
```

这是一种 Reusable Execution Method，不是新的全局 Workflow Engine。

---

# 7. Step 1 — Ground

Engineer 开始编码前必须读取当前 Development Unit 的权威输入。

检查：

```text
Development Scope 是否明确
Repository Scope 是否明确
Acceptance Criteria 是否明确
Verification Requirements 是否明确
依赖是否满足
目标 Repository 是否可访问
当前 Workspace / Branch 是否可安全修改
```

Corrective Change 额外检查：

```text
Root Cause Status
Fix Strategy
Regression Scope
```

Intentional Change 额外检查：

```text
Spec
Tasks
Design（如果 required）
```

Engineer 不应默认重新执行：

```text
Requirement Analysis
Brainstorm
Solution Exploration
Architecture Design
Root Cause Analysis
Implementation Planning
```

只有实际代码事实与已批准 Analysis 明显冲突时，才允许进入 Diagnostic / Analysis Escalation。

---

# 8. Step 2 — Establish Feedback

Engineer 在主要代码修改前，应建立本次任务的最小可靠 Feedback Loop。

例如：

## Backend

```text
Unit Test
Integration Test
Contract Test
Build
API Reproduction
```

## Frontend

```text
Type Check
Unit / Component Test
Browser Behavior
E2E
```

## Flink

```text
Unit Test
Test Harness
Sample Event
Schema Compatibility
Integration Test
```

## Corrective Change

优先建立：

```text
Regression Signal
```

目标：

```text
修复前
→ RED / 可复现失败

修复后
→ GREEN / 失败消失
```

无法建立可靠反馈时不得盲目进行大范围修改，应返回 `UNKNOWN` 或升级。

---

# 9. Step 3 — Implement

Development 默认采用：

> **Incremental Vertical Implementation**

即：

```text
Small Behavior / Small Change
        ↓
Feedback
        ↓
Next Small Behavior / Change
        ↓
Feedback
```

避免：

```text
一次修改大量文件
        ↓
最后统一验证
```

## 9.1 TDD

TDD 作为优先 Engineering Method 使用于：

```text
业务规则
Domain Logic
Backend Service Behavior
Pure Function
API Contract
Bug Regression
可稳定自动测试的行为变化
```

推荐：

```text
Behavior
→ RED
→ GREEN
→ Refactor
→ Next Behavior
```

不要求所有资产机械执行 TDD。

以下场景可使用其他 Feedback：

```text
复杂 UI / Layout
配置文件
Migration
SQL
Generated Code
环境集成
外部系统交互
```

原则：

> **优先测试 observable behavior / public contract，不为了满足 TDD 形式而测试 implementation detail。**

---

# 10. Step 4 — Local Validation

Engineer 完成主要实现后必须执行 Developer-side Validation。

至少根据当前项目和 Verification Requirements 检查：

```text
Targeted Tests
Relevant Regression Tests
Build
Compile / Type Check
Lint
Required Runtime Check
Required Contract Check
```

Engineer Local Validation 回答：

> **当前代码是否已经达到“值得交给 Verify Agent”的状态？**

它不等于正式验证。

正式边界：

```text
Engineer Local Validation
≠
Verify Agent Independent Verification
```

类似传统研发中的：

```text
Developer Test
≠
QA / Independent Verification
```

---

# 11. Step 5 — Review

Engineer 完成本地验证后，需要对当前 Diff 进行一次 Development-level Review。

Review 至少从两个轴检查：

## 11.1 Specification Alignment

```text
是否满足 Development Scope
是否覆盖 Acceptance Criteria
是否符合 Spec / Fix Strategy
是否存在 Scope Drift
是否遗漏必要行为
```

## 11.2 Engineering Standards

```text
是否符合 Repository Conventions
是否引入不必要复杂度
是否存在明显重复实现
是否破坏已有 Contract
Test 是否验证正确层级
是否存在明显 Regression Risk
```

该 Review 可以：

- 由 Engineer 自检；
- 使用 read-only reviewer subagent；
- 使用独立 review Skill。

但不得通过隐藏的 implementation subagent 创建新的未建模 Delivery Owner。

---

# 12. Step 6 — Handoff

Engineer 不以：

```text
开发完成
```

作为唯一交付信息。

应形成 Development Evidence / Development Report。

推荐结构：

```yaml
development:
  result: READY_FOR_VERIFY | BLOCKED | UNKNOWN

  repositories:
    - repository: ...
      branch: ...
      changed_files:
        - ...

  implementation:
    summary: ...

  validation:
    checks:
      - name: ...
        result: PASS | FAIL
        evidence: ...

  acceptance_coverage:
    AC-01: COVERED
    AC-02: COVERED

  deviations:
    - ...

  known_risks:
    - ...

  unresolved:
    - ...
```

只有：

```text
result = READY_FOR_VERIFY
```

且必要 Local Validation 已通过时，才：

```text
@Verify Agent
```

---

# 13. 三种 Development Mode

不为 `bug-fix / production-fix / sdd-fast` 分别建设三套编码 Workflow。

统一使用 `development-execution`，内部区分三种执行模式。

## 13.1 Corrective

适用于：

```text
bug-fix
production-fix
```

执行重点：

```text
Approved Root Cause
        ↓
Regression Feedback
        ↓
Minimal Fix
        ↓
Regression Validation
        ↓
Review
        ↓
Verify
```

原则：

> Engineer 的默认任务是实现已批准 Fix Strategy，而不是重新寻找 Root Cause。

## 13.2 Intentional

适用于：

```text
sdd-fast
```

执行重点：

```text
Spec / AC
      ↓
Feedback Setup
      ↓
Vertical Behavior Slice
      ↓
Implementation
      ↓
Local Validation
      ↓
Review
      ↓
Verify
```

TDD 在可稳定测试的行为上优先使用。

## 13.3 Rework

来源包括：

```text
Verify Finding
明确的 PR / Human Engineering Feedback
```

执行：

```text
Finding
   ↓
定位受影响范围
   ↓
Targeted Fix
   ↓
Targeted Validation
   ↓
必要 Regression
   ↓
重新 Handoff Verify
```

不得无差别重新执行整个 Development Unit。

---

# 14. Debugging 的新定位

由于 Corrective Change 已经在 Analysis 阶段完成：

```text
Observation
Hypothesis
Evidence
Verification
Root Cause
Fix Strategy
```

因此 Development 不默认执行完整 systematic debugging。

正常流程：

```text
Approved Root Cause
→ Regression Signal
→ Implement Fix
```

仅当出现以下情况时进入 Diagnostic Escalation：

```text
Root Cause 无法复现
Root Cause Evidence 与当前代码事实冲突
Fix Strategy 实施后问题仍存在
出现新的 Failure
无法建立可靠 Feedback
实际影响范围明显超出 Analysis
```

此时可以使用借鉴自：

```text
systematic-debugging
diagnosing-bugs
```

的诊断方法。

但诊断只解决当前执行阻塞，不自动改写已批准 Analysis。

如果诊断结果实质推翻：

```text
Root Cause
Requirement
Solution
Development Scope
Repository Scope
```

则必须停止 Development，并返回：

```text
Delivery Lead / Workitem Analyst
```

---

# 15. Root Cause Status 与 Development Preflight

Corrective Change 的 Root Cause 可能为：

```text
confirmed
probable
unknown
```

推荐 Development 处理：

## confirmed

```text
直接建立 regression feedback
→ implement
```

## probable

```text
先验证关键 hypothesis
→ 能确认后继续
→ 无法确认则 Diagnostic Escalation
```

## unknown

```text
禁止直接猜测性修改
→ Diagnostic Escalation
→ 必要时返回 Analysis
```

后续可再决定该规则最终归属：

```text
Analysis Gate
或
Development Preflight Gate
```

v1.0 暂由 Development Preflight 承担。

---

# 16. Engineer 与 Verify Agent 的边界

## Engineer

负责：

```text
实现代码
建立 Feedback Loop
TDD / 其他开发方法
Developer-side Validation
Diff Review
修复 Verify Finding
提交 Development Evidence
```

## Verify Agent

负责：

```text
独立验证
Acceptance Criteria Verification
Verification Requirements
Build / Test / Runtime Verification
Cross-Repository Verification
Integration Verification
独立发现 Regression / Contract 问题
```

核心原则：

> **Engineer 证明“我有充分理由认为它已经实现正确”；Verify Agent 独立证明“交付结果实际满足要求”。**

Engineer 的 PASS 不得替代 Verify PASS。

---

# 17. Code Review 的定位

当前不急于新增独立 Reviewer Agent。

优先采用：

```text
Verify Agent
├── code-review
└── development-verification
```

其中：

## code-review

关注：

```text
Spec Alignment
Repository Standards
Complexity
Scope Drift
Test Quality
Static Code Risk
```

## development-verification

关注：

```text
Acceptance Criteria
Runtime Behavior
Build / Test
Regression
Contract
Integration
Verification Requirements
```

后续如果 Code Review 的职责、生命周期或负载明显独立，再考虑独立 Reviewer Agent。

---

# 18. Subagent 使用边界

不采用：

```text
subagent-driven-development
```

作为默认研发模式。

原因：

- Multica 已有 Specialist Agent；
- Development Unit 已表达独立 Owner；
- Development Sub-Issue 已表达独立生命周期；
- Verify Agent 已承担独立验证；
- 再由 Engineer 创建 hidden implementation owner 会形成第二套不可见的 delivery topology。

允许：

```text
Read-only Investigator
Code Search
Standards Reviewer
Test Reviewer
Architecture Reviewer
Diagnostic Helper
```

核心规则：

> **Subagent for reasoning/review is allowed. Hidden Development Unit is not.**

---

# 19. 第三方 Skills 的正式边界

本方案不依赖第三方 Framework。

## 19.1 Matt Pocock Skills

重点参考：

```text
implement
tdd
diagnosing-bugs
code-review
```

借鉴：

- implement 不重新打开已经确定的 upstream plan；
- TDD 使用 vertical slice；
- 先建立 feedback loop；
- code review 区分 specification 与 standards；
- debugging 从可复现反馈开始。

不直接采用其完整：

```text
grill
spec
ticket
implementation
```

上层流程。

这些职责已经由当前 Analysis / Multica 承担。

## 19.2 Superpowers

重点参考：

```text
test-driven-development
systematic-debugging
verification-before-completion
receiving-code-review
```

不作为默认采用：

```text
brainstorming
writing-plans
executing-plans
subagent-driven-development
using-git-worktrees
finishing-a-development-branch
```

原因是这些能力与：

```text
Workitem Analyst
Delivery Lead
Development Unit
Multica Runtime
Verify Agent
PR Lifecycle
```

存在职责重叠。

---

# 20. 推荐 Skill 方向

v1.0 先定义能力边界，不立即拆得过细。

建议后续优先设计：

```text
workspace-skills/

├── development-execution/
│   ├── SKILL.md
│   ├── templates/
│   │   └── development-report.md
│   └── references/
│       └── development-contract.md
│
├── development-verification/
│   └── SKILL.md
│
├── code-review/
│   └── SKILL.md
│
└── pull-request/
    └── SKILL.md
```

可选 Method Skill：

```text
tdd/
diagnosing-bugs/
```

这些 Method Skill 不控制 Delivery Lifecycle。

---

# 21. Engineer Agent 与专业 Agent

继续保留：

```text
Backend Engineer
Frontend Engineer
Flink Engineer
```

三个 Specialist Agent。

共享：

```text
development-execution
```

并按专业领域增加能力，例如：

```text
Backend Engineer
├── development-execution
└── backend-engineering

Frontend Engineer
├── development-execution
└── frontend-engineering

Flink Engineer
├── development-execution
└── flink-engineering
```

不要复制三套完整 Development Workflow。

专业 Skill 只处理领域方法：

```text
Java / Spring
Vue
Flink
Database
API
Frontend Browser
Streaming
```

公共 Development Loop 由 `development-execution` 统一。

---

# 22. Deterministic Development Gate

能够确定性判断的条件不交给 LLM。

推荐后续增加 Development Preflight / Handoff Check。

至少检查：

```text
required inputs exist
required repository is known
required local validation completed
no blocker
development result == READY_FOR_VERIFY
required evidence exists
```

统一结果：

```yaml
result: PASS | FAIL | UNKNOWN
reasons:
  - ...
```

处理：

```text
PASS
→ @Verify Agent

FAIL
→ Engineer targeted rework

UNKNOWN
→ Delivery Lead / Human
```

该 Gate 不判断：

```text
代码设计是否优雅
Root Cause 是否业务上合理
Requirement 是否应该改变
```

这些仍属于语义判断。

---

# 23. Engineer 的技术决策权限

Engineer 可以自主决定：

```text
Implementation Detail
函数 / 类拆分
局部重构
测试组织
局部算法实现
非 Contract 级内部结构
最小必要依赖调整
```

前提：

```text
不改变 approved Expected Behavior
不改变 Acceptance Criteria
不改变外部 Contract
不扩大 Development Scope
不改变 Repository / Development Unit 边界
不推翻 approved Root Cause / Solution
```

如果实际实现要求改变：

```text
Requirement
Expected Behavior
Contract
Root Cause
Selected Solution
Development Scope
Repository Scope
Acceptance Criteria
```

则：

```text
STOP
→ Delivery Lead
→ 必要时 Workitem Analyst
```

原则：

> **Engineer owns implementation decisions, not product / analysis decisions.**

---

# 24. Feedback Loop Protection

Engineer ↔ Verify Agent 的反馈循环需要保护。

推荐：

```text
verification_round >= 3
AND
同类 blocker 重复
```

则：

```text
STOP
→ blocked
→ @Delivery Squad
→ Delivery Lead
```

Delivery Lead 再判断：

```text
继续 Engineering
返回 Analysis
外部依赖
Human Decision
```

不得无限 Engineer ↔ Verify 循环。

---

# 25. 推荐执行模型

```text
                     Human-approved Analysis
                              │
                              ▼
                       Development Unit
                              │
                              ▼
                           Engineer
                              │
                    ┌─────────┴─────────┐
                    │                   │
                  Ground        Establish Feedback
                    │                   │
                    └─────────┬─────────┘
                              ▼
                   Incremental Implement
                              │
                    TDD where applicable
                              │
                              ▼
                       Local Validation
                              │
                              ▼
                          Diff Review
                              │
                              ▼
                    Development Evidence
                              │
                              ▼
                         Handoff Gate
                              │
                              ▼
                         Verify Agent
                              │
                  ┌───────────┴───────────┐
                  │                       │
                FAIL                     PASS
                  │                       │
           Targeted Rework               PR
                  │
                  └────────→ Verify
```

---

# 26. 与 Analysis 的正式边界

## Analysis

负责：

```text
What
Why
Current / Expected Behavior
Root Cause
Solution
Scope
Repository Scope
Acceptance Criteria
Verification Requirements
Spec / Tasks / Design
Human Approval
```

## Development

负责：

```text
How to implement within approved boundaries
Feedback Loop
Code
Tests
Local Validation
Diff Review
Development Evidence
```

## Verify

负责：

```text
Independent Evidence
Acceptance Verification
Regression Verification
Runtime / Integration Verification
PASS / FAIL
```

---

# 27. v1.0 核心设计决策

| 项目 | 决策 |
|---|---|
| Development 上层 Framework | 不引入第三方 Framework |
| 主方法 | Feedback-Driven Development |
| Engineer 工作对象 | Development Unit |
| Analysis 重做 | 默认禁止 |
| Implementation Planning | 不新增独立阶段 |
| TDD | 优先 Method，不是全局 Workflow |
| Debugging | 仅作为 Diagnostic Escalation |
| Corrective 默认动作 | Consume Root Cause → Regression → Minimal Fix |
| Intentional 默认动作 | Spec / AC → Vertical Implementation |
| Rework | Targeted Rework |
| Engineer Local Validation | 必须 |
| Verify Agent | 独立验证，不被 Local Validation 替代 |
| Code Review | 先作为 Verify / Review Skill，不急于新增 Agent |
| Subagent | 可用于 reasoning/review；不得形成 hidden Development Unit |
| Matt Pocock | 方法参考，不作为 Framework |
| Superpowers | 方法参考，不作为 Framework |
| 第三方 Skill | 不作为 Delivery Runtime 权威规则源 |
| Deterministic Check | 进入 Gate / Script |
| Feedback Loop | Development 核心机制 |
| Failure | FAIL targeted rework；UNKNOWN 升级 |
| 多轮失败 | blocked → Delivery Lead |
| Engineer 权限 | Implementation Decision，不改变 approved Analysis Contract |

---

# 28. 后续设计项

下一阶段需要继续细化：

1. `development-execution` Skill 的正式 Input / Procedure / Validation / Output / Error Handling；
2. Development Report / Evidence Schema；
3. Development Preflight / Handoff Gate；
4. TDD Method 的本地化版本；
5. Diagnostic Escalation / `diagnosing-bugs` Method；
6. Code Review 与 Verify Agent 的最终边界；
7. Backend / Frontend / Flink 专业 Engineering Skill；
8. Branch / Worktree / 双层 Git 在 Development Unit 中的具体处理；
9. Multi-Repository Development Unit 的执行顺序与本地 Workspace 策略；
10. Engineer Technical Decision Boundary 的更细 Contract。

---

# 29. 核心原则

> **Analysis decides what should change; Engineer decides how to implement it within the approved boundary.**

> **Development is driven by feedback, not by a large prompt or a third-party workflow framework.**

> **TDD is a preferred engineering method, not the Delivery Workflow itself.**

> **Engineer Local Validation does not replace independent Verify.**

> **A Development Unit is the bounded unit of engineering work; hidden implementation ownership must not bypass Multica.**

> **Subagents may assist reasoning and review, but must not silently create a second delivery topology.**

> **Corrective work consumes approved Root Cause by default; debugging is an escalation path, not the normal first step.**

> **Failures should trigger targeted rework, not full workflow replay.**

> **Deterministic conditions belong to Gate / Script; semantic engineering judgment belongs to the Engineer or Verify Agent.**

> **Third-party Skills are references and method sources; Multica and project-owned Skills remain the authoritative execution model.**
