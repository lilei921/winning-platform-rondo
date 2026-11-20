# Multica Engineer / Development 阶段设计方案

> Version: 1.12  
> Date: 2026-10-05  
> Scope: Multica Delivery Squad 中 Backend Engineer、Frontend Engineer、Flink Engineer 的 Agent 配置、Development 执行方法、Engineering Method Skills、Development Evidence 与停止边界  
> Status: Draft Baseline

> 上位方案：`02-multica-squad-centric-delivery-v1.4.17.md`  
> 上游分析方案：`03-workitem-analyst-stage-design-v1.15.md`  

> Terminology：本方案中的 Squad、Agent、Issue、Status、Route、Gate 等公共名称统一遵循 `01-multica-design-guideline-v1.11.md` 的 Canonical Terminology；本方案只维护 Engineering / Development 领域术语。

> Architecture Principle：本阶段遵循 [Runtime-Centric Delivery + Artifact-Centric Engineering](01-multica-design-guideline-v1.11.md#runtime-artifact-principle)；Engineer 以 OpenSpec Engineering Truth 作为技术实现与验证依据，以 Multica Delivery Truth 获取批准、分工、状态与 Verify 决策，不建立第三套工程输入。
---

<a id="engineering-stage-scope"></a>

# 1. 文档定位

本文只设计 **Engineer / Development 专业层**。“Development 阶段”是 Delivery 生命周期中的专业工作区段，不对应 Multica 原生 Stage。文档层职责见 [指导手册](01-multica-design-guideline-v1.11.md#document-ownership)；Stage 使用规则仍由主方案 §14 维护。

本文负责回答：

```text
Engineer 是谁？
Engineer 负责什么 / 不负责什么？
Engineer 收到什么输入？
一次 assigned Task Set 应该如何实现？
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
02-multica-squad-centric-delivery-v1.4.17.md
```

为权威来源。

正式原则：

> **总方案定义 Delivery 生命周期；Engineer 方案只定义 Engineering Semantic Work。**

> **Engineer 的工作范围由 `change_ref + task_refs + relevant artifact refs + Multica Runtime Context` 确定；Task Set 是引用范围，不是独立 Runtime 对象。**

> **同一规则只维护一个权威来源，遵守 One Rule, One Owner。**

> **技术实现只消费 OpenSpec / Supporting Artifact 中的 Engineering Truth；批准、Owner、Status、Verify Decision 等只消费 Multica Delivery Truth；二者通过引用连接。**

---

# 2. Engineer 在整体交付中的定位

当前总方案已经明确：

```text
Workitem Analyst
= 需求与问题分析及研发准备
+ 澄清目标、业务场景、行为规则、范围与验收要求
+ 按 Route 形成必要规格、方案或修复依据

Delivery Lead
= Parent Delivery Coordination
+ 批准边界内的成员选择 / 分工 / 交接
+ 跨角色协调与 Semantic Fallback

Engineer
= Engineering Semantic Owner

Verify Agent
= Optional Independent Verification Executor

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

> **在已批准 Development Context 与当前 assigned Task Set 边界内，完成工程实现、工程级验证、Implementation-oriented Code Review、代码整改和 Development Evidence。**

---

<a id="engineering-work-object"></a>

# 3. Engineer 的工作对象

Engineer 的工程工作对象是当前明确分配的 **OpenSpec Task Set**，正式交接使用 `change_ref + task_refs + relevant artifact refs + Multica Runtime Context` 表达。Task Set 是一组 OpenSpec Tasks 的引用范围，不建立独立持久化对象或状态。

Engineer 可以通过两种 Runtime Projection 接收同样的工程契约：

| Runtime Projection | 入口 | Engineer 的完成边界 |
|---|---|---|
| Parent Issue Runtime | 父 Delivery Issue 保持 Squad-owned；Delivery Lead `@mention` Engineer，并明确 `task_refs` | 完成 assigned Task Set 的 Engineering Contract，写回结果，不关闭父 Delivery |
| Isolated Runtime | 需要独立 persistent runtime state 时创建 Development Sub-Issue，并 Assignment 给对应 Specialist | 完成该 Sub-Issue 引用的 `task_refs` 与 Engineering Contract，按授权完成当前 Sub-Issue |

多个 Engineer、多个 Task Group、多个 Repository 或并行开发本身不要求 Development Sub-Issue。Sub-Issue 只在需要独立 Owner / Status / Block / Retry / Completion / Stage 时使用。

同一 Task Set 只使用一个正常触发入口；已通过 Sub-Issue Assignment 启动时，不再在父 Issue `@mention` 同一 Engineer 执行相同 `task_refs`。Engineer 不自行改变 Runtime Projection。

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

根据 [指导手册：Agent Description](01-multica-design-guideline-v1.11.md#mechanism-agent-description)，Description 只承担 UI / Discoverability 职责，不承担执行规则。官方依据由手册集中维护。

## 5.1 Backend Engineer

```text
负责被分配的后端 OpenSpec Tasks 的代码实现、本地验证、Code Review、整改和 Development Evidence 交付。
```

## 5.2 Frontend Engineer

```text
负责被分配的前端 OpenSpec Tasks 的代码实现、本地验证、Code Review、整改和 Development Evidence 交付。
```

## 5.3 Flink Engineer

```text
负责被分配的 Flink / 流处理 OpenSpec Tasks 的代码实现、本地验证、Code Review、整改和 Development Evidence 交付。
```

---

# 6. Engineer Agent Instructions 设计

三个 Engineer Agent 使用指导手册的同构 Instructions；接收范围与平台事实见 [Agent Instructions](01-multica-design-guideline-v1.11.md#mechanism-agent-instructions)，绑定方法的复用方式见 [Skills](01-multica-design-guideline-v1.11.md#mechanism-skills)：

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

你负责当前通过 Assignment 或 @mention 明确交付的 OpenSpec Task Set 的工程实现语义，
在已经批准的 Analysis / Development Context 边界内完成代码实现、
本地验证、Code Review、整改以及 Development Evidence。

你负责在明确的需求、方案和约束下“如何正确实现”，不负责重新决定
“需求应该是什么”或“整个 Delivery 应该如何组织”；发现影响实现的需求缺口时反馈澄清，不自行猜测。
```

## 7.2 Core Responsibilities

```text
- 在独立 Engineer Run 中读取当前 `task_refs` 对应的已批准 Change 与工程任务；Corrective 根据 Proposal 中的 Root Cause / Fix Strategy / Regression Scope 恢复既定行为，Intentional 根据 Requirement / Scenario 实现。
- 建立适合当前修改的可靠 Feedback Loop。
- 采用小步、可验证的方式完成生产代码实现，并在批准边界内同步相关设计细节与任务进度。
- 为每个 assigned Implementation Task 完成 task-level verification；被分配 Change-level Verification Task 时按其 Contract 执行 Integration / Regression / E2E 等组合验证。
- 完成 Required Local Validation 与 implementation-oriented Code Review。
- 处理 Development 内部 Review Finding，以及 Independent Verify Agent 返回且可归因到当前 Task Set 的 Engineering Finding。
- 完成 Commit / Push、PR Preparation 与 Development Evidence。
- 向当前工作 Issue / Sub-Issue 写回 Progress / Result，不越权关闭父 Delivery。
```

## 7.3 Boundaries

Engineer 不得：

```text
- 重新定义 Intentional Requirement / Scenario 或 Corrective Expected Behavior / Regression Scope。
- 擅自改变 approved Development Scope。
- 擅自改变 `task_refs`、approved scope 或 Runtime Projection。
- 创建或删除 Development Sub-Issue。
- 决定下一专业 Agent 或 Verify Agent 是否 required。
- 把 Local Validation、OpenSpec Native Verify 或某一种 Integration / E2E 方法误写成 Independent Verify Agent 的同义词。
- 覆盖 Deterministic Gate / Check 的明确 FAIL。
- 直接承担 PR Materialization、PR Status Sync 或 Delivery Completion。
- 使用隐藏 implementation agent 绕过 Multica 的 Runtime Projection 或形成未受控的并行执行边界。
```

## 7.4 Execution Principles

```text
- 以当前 Issue / Sub-Issue、approved logical Analysis Package、当前 `task_refs` 对应 OpenSpec Artifact 与代码事实为准。
- 接收方必须读取当前可访问的批准产物；不得假定 Workitem Analyst 会话自动继承。影响正确实现的关键歧义、新证据冲突或必要输入缺口，交 Delivery Lead 协调 Workitem Analyst / Human 澄清。
- 编码前先明确 Feedback Signal；可稳定自动测试的行为优先使用 TDD。
- Corrective Change 优先建立 Regression Signal，再实施最小必要修复。
- 每个 Implementation Task 都要完成自己的 Verification；Change-level Verification Task 只在被明确分配时执行。
- Regression / Integration / E2E 是 Verification Method，不绑定 Verify Agent；默认由当前 Task 的责任执行者完成。只有已批准 Independent Verification 且 Change-level Verification Task 被父 Delivery 明确投影给 Verify Agent 时，才由 Verify Agent 执行，不由 Engineer 自行转交。
- 所有实现必须完成 Local Validation 与 Code Review。
- Code Review 面向 Implementation；Verify Agent 只在 `verify_agent.required=true` 时作为独立验证执行者。
- Finding 优先 Targeted Rework，不无差别重跑整个 Development。
- 能由 Script / Gate / Check 确定的事情不重复进行语义判断。
```

## 7.5 Escalation, Communication & Delivery

遇到以下情况必须停止自主扩展并升级：

```text
- 当前 Task Set 的必要业务规则、预期行为、范围或 Acceptance Contract 不明确，无法据此正确实现；
- approved Analysis 与当前代码事实明显冲突；
- Root Cause / Fix Strategy 无法成立；
- 实际修改需要改变 Intentional Requirement / Scenario，或 Corrective Expected Behavior / Regression Scope；
- 实际影响范围明显超出 Development Scope；
- 需要扩大未批准的 Task Scope / Repository Scope；
- 无法建立可靠 Feedback / 必要 Verification；
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

若当前 `task_refs` 包含 Change-level Verification Task，其 PASS / FAIL Evidence 同样属于当前工程交付；是否还需要 Independent Verify Agent 由已批准 `verify_agent.required` 决定。

<a id="engineering-input"></a>

# 8. Development 输入契约

Engineer 与 Workitem Analyst 保持独立 Agent / Run，通过持久化、已批准的逻辑 Analysis Package（OpenSpec Engineering Truth + Multica Delivery Truth + 必要 Evidence References）交接；必要读取属于工程职责，不依赖共享会话。复用已完成问题 / 需求分析，不从原始 TFS Work Item 重做一遍，也不在 OpenSpec 外重建一套详细规格、设计或实施计划。

输入来自已经完成 Analysis Review 并由 Delivery Lead Runtime Projection 明确分派的当前 OpenSpec Task Set。上游专业准备标准见 `03-workitem-analyst-stage-design-v1.15.md` §1.2。

上游 Verify Recommendation 只决定是否需要 **Independent Verify Agent**；Engineer 不从 Route 或原始推荐自行重算 `verify_agent.required`。Task Verification、Local Validation、Code Review 与必要 Change-level Verification 不因 `verify_agent.required=false` 而取消。

## 8.1 Common Inputs

至少应能获得：

```text
Assigned Task Set Goal / task_refs
相关需求 / 问题场景、预期行为与已确认规则
Requirement / Fix Scope 与 Development Scope
Repository Scope
Relevant Context / Evidence References
Dependencies
当前 Acceptance Contract：Intentional Requirement / Scenario；Corrective Expected Behavior / Regression Scope
当前 Tasks 中每项 task-level verification，以及被分配的 Change-level Verification Task
Target Role
当前唯一 OpenSpec Change / 已批准根仓基线引用
Multica Analysis Handoff Facts / Review / Gate 引用
当前 `task_refs` 与适用 Design / Spec / Evidence 引用
```

## 8.2 Corrective Change

适用于 `bug-fix` / `production-fix`。额外消费：

```text
Corrective proposal.md
  - Expected / Actual
  - Root Cause / Status / Evidence
  - Fix Strategy / Fix Scope
  - Regression Scope
当前 tasks.md
条件性 Specs / Supporting Design（如有）
```

`bug-analysis` 是上游 Method，不再要求 `bug-analysis.md` Artifact。没有新增 Delta 不构成失败；独立 Design 不是 `corrective-change` 默认 Schema 前置。缺少必需 Change、Tasks、根因 / 修复 / 回归依据或可确认的原生准备结果时必须停止，交回 Workitem Analyst。

Corrective 合法 `skip_specs` 时，不制造 Requirement / Scenario Coverage；Engineer 依据 Proposal 的 Expected Behavior / Regression Scope 和 Tasks 中的 Verification 执行修复并形成 Evidence。

## 8.3 OpenSpec 输入与更新（按当前 Change Schema）

Engineer 开始时读取当前 `.openspec.yaml` 与 Schema，不能重新选择 Technical Change Kind。

允许在批准边界内：

```text
细化 design.md 的实现级技术细节（Intentional）
细化 tasks.md 描述 / Verification procedure
完成自己被分配的 task_refs
按受控更新机制勾选完成状态
补充与当前实现直接相关的 Evidence 引用
```

Human Approval 后 top-level `T-xxx` Identity 按 OpenSpec Schema Implementation v1.3 冻结。Engineer 不并行新增 / 重编号 top-level Task；确需新增工程任务或改变组合 Verification Contract 时，返回受控 Analysis / Coordination 路径。

以下属于实质 Contract 变化，必须停止并升级：

```text
Intentional Requirement / Scenario 改变
Corrective Expected Behavior / Root Cause / Fix Strategy / Regression Scope 改变
批准 Scope / Capability / external Contract 改变
删除或实质降低 required Verification
新增未批准 Repository / Capability
```

Task checkbox 写入不能替代语义 Completion Check，也不能表示 Multica Runtime Status。

## 8.4 Rework

Development 内的 Code Review / Independent Verify Finding 优先 targeted rework：

```text
读取 Finding + current candidate
→ 定位受影响 task_refs
→ 修复
→ 重新执行受影响 Task Verification / Local Validation
→ Code Review
→ 更新候选 Commit / Evidence
```

如果 Finding 证明上游 Acceptance Contract、Root Cause / Fix Strategy 或批准 Scope 本身需要改变，则停止 Engineering Rework，返回既有 Analysis / Human Review；不得由 Engineer 通过改 Spec / Proposal 偷渡新的需求。

# 9. Development 核心方法

三条自动 Route 使用统一 OpenSpec Change；Corrective 保留根因与回归导向，Intentional 保留规格导向，所有 assigned Task Set 均采用 Feedback-Driven Development。统一产物与反馈不是替代关系：

```text
规格驱动
→ 明确要实现什么、什么结果才正确

反馈驱动
→ 通过小步实现与持续验证，确认实现符合规格或 Fix Strategy
```

不引入替代 Multica 的第二套全局运行与协作框架。

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

是所有 assigned Task Set 的必备环节，与 Verify Agent 是否 required 无关。

---

# 12. Ground

Engineer 开始实现前必须读取当前 Task Set 的权威输入。

至少确认：

```text
当前 Task Set 有明确的人工批准与 Delivery Lead 交接依据，附加前置条件已满足
Goal 与当前 Task Set 相关业务 / 问题场景明确
当前 Acceptance Contract 可读取：Intentional Requirement / Scenario；Corrective Expected Behavior / Regression Scope
Development Scope / Repository Scope 明确
当前 task_refs 与适用 Proposal / Spec / Design / Tasks 可对应
每个 Implementation Task 的 Verification 可读取
被分配 Change-level Verification Task 时其范围、环境与预期 Evidence 可读取
Dependencies 满足当前启动条件
目标 Repository / Branch 可安全操作
```

全部自动 Route 同时确认当前 Change / 已批准根仓基线与当前授权修订可对应，Supporting Evidence 仍适用于当前代码、行为与验证范围。Corrective 额外确认 Root Cause / Status / Evidence 与 Fix Strategy；Intentional 额外确认 Requirement / Scenario 与 Selected Solution。

正常情况下不重新执行 Requirement Analysis、Solution Exploration、完整 Root Cause Analysis 或 Development Topology Planning。存在影响正确实现的业务规则、范围或验收缺口时，提出具体问题和影响，由 Delivery Lead 协调 Workitem Analyst / Human 补充；不得静默猜测。

# 13. Establish Feedback

主要实现前建立当前 Task Set 的最小可靠 Feedback Loop。Corrective 从故障 / 回归场景与 Acceptance Contract、Intentional 从规格场景与 Acceptance Contract 选择反馈，包含相关错误、权限或边界场景；可稳定自动测试时使用 TDD，否则选择适合当前工程资产的可靠检查。不能只验证“文件编译成功”而遗漏已要求验证的行为。

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

Corrective 优先恢复 / 建立原始 Failure / Regression Signal：

```text
读取 Corrective Proposal 的 Expected / Actual / Root Cause / Fix / Regression Scope
→ 复现或建立可观测 Failure Signal（可行时）
→ 将当前 Implementation Task 的 Verify 与 Failure Signal 对齐
→ 实施最小修复
→ 证明 Regression Signal 从 FAIL → PASS
→ 执行相关正常 / 边界场景
```

当当前任务必须与其他 Task / Repository 组合后才能证明完整行为时，不在本地假装闭合；按已分配 Change-level Verification Task 或父级后续执行边界交付。

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

但不得因此改变 approved Analysis Contract 的实质性行为、范围和约束；所有自动 Route 按 §8.3 同步当前 Tasks 和适用 Design。

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

# 15.1 Development Verification

`Development Verification` 是 Engineer 为证明当前 assigned Task Set 已达到工程完成条件而承担的开发侧验证总称，不是新的 OpenSpec Artifact 或 Delivery Stage。

```text
Development Verification
=
Task-level Verification
+ 当前 Engineer 被分配的 Change-level Verification Task（如有）
+ Local Validation
```

其中：

- Task-level Verification 随每个 Implementation Task 始终存在，由当前 Assigned Engineer 负责；
- Change-level Verification Task 只有组合行为无法由单 Task 证明时才存在；若该 Task 当前分配给 Engineer，则属于其 Development Verification；若因已批准 Independent Verification 改由 Verify Agent 执行，则不属于该 Engineer 的 Development Completion 前置；
- CI / script / test runner 是 Engineer 或 Verify Agent 使用的执行机制，不是独立责任角色；
- OpenSpec Native Verify 是 Change-level Artifact-to-Implementation consistency capability，不属于每个 Engineer Task Set 的 mandatory Development Verification。

因此：

```text
Development Completion
=
Implementation
+ Development Verification
+ Code Review
+ Development Evidence
+ Commit / Push
+ PR Preparation
```

---

# 16. Local Validation

Engineer 必须完成 Developer-side Local Validation。

至少根据当前 Task Set / Repository / Verification Contract 执行：

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

它不等于额外的独立 Acceptance Verification，但必须覆盖当前 Task Set 被分配的开发侧验证要求。`verify_agent.required=false` 不取消这些要求；存在需要独立验收的新风险时按既有流程升级，不自行降低标准。

---

<a id="engineering-code-review"></a>

# 17. Code Review

Code Review 属于 Engineer Development 内部必备质量机制。

正式定位：

> **Code Review = implementation-oriented。**

至少从两个维度检查。

## 17.1 Specification / Fix Alignment

### 公共检查（所有 Route）

```text
实现是否落在当前 task_refs / approved scope
每个 Implementation Task 的 Verify 是否有当前候选版本 Evidence
已分配 Change-level Verification Task 是否按 Contract 执行
是否存在 Scope Drift / Stale Evidence
Tasks checkbox 与实际完成事实是否一致
```

### Corrective Mode（`bug-fix` / `production-fix`）

```text
实现是否符合 Corrective Proposal 的 Root Cause / Fix Strategy
Expected Behavior 是否恢复
Regression Scope 是否覆盖
合法 skip_specs 时是否避免伪造 Spec Coverage
存在 Delta 时 Requirement / Scenario 是否仍成立
```

### Intentional Mode（`sdd-fast`）

```text
实现是否符合 Requirement / Scenario
Design 的 required 技术决策是否落实
Implementation / Verification Tasks 是否覆盖规格行为
未修改的主规格约束是否保持
```

Code Review 是 implementation-oriented；它可以复用 OpenSpec Native Verify 的结构 / 语义发现，但不能把工具 PASS 当成真实 Runtime / Integration / E2E 已执行。

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

全部自动 Route 将适用的 OpenSpec 完整性、Fix / 规格正确性和设计一致性检查吸收到上述现有 Review；可复用原生检查或结果，但不额外完整重复同类审查。Finding 使用现有格式并引用受影响的规格 / Tasks / Code，纯代码阅读不证明 Runtime / Integration / E2E 实际通过。原生 Validation 只覆盖工具支持的结构约束，也不能代替此语义 Review。[^e-openspec-verify]

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
重新执行整个 assigned Task Set
```

---

# 19. Commit / Push

Engineer 在 Development Ready 前完成当前 Task Set 所要求的：

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

若 Verify Agent 已 PASS 后代码又发生实质变化，则旧 Verify PASS 的有效性由总方案 / Verification Gate 规则决定，Engineer 不自行绕过。规格或验收标准的实质变化同样触发有效性复核。

当前 Task Set 对 Design / Tasks 的更新按根仓 Git 规则提交，仅包含当前工作允许的修改；不得夹带其他任务改动，也不为 OpenSpec 根仓产物创建独立 PR。

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

<a id="engineering-evidence"></a>

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
    Acceptance Contract-01: COVERED
    Acceptance Contract-02: COVERED

  deviations:
    - ...

  known_risks:
    - ...

  blockers:
    - ...

  pr_preparation:
    ready: true | false
```

三条自动 Route 在现有 `implementation`、`acceptance_coverage` 和 `local_validation.checks` 中补足引用，使当前 Task Set 的 Fix / Regression Scenario、适用规格场景与 Acceptance Contract 能追到下列信息；`COVERED` 不能只是无依据的标签，不另建追踪文件或任务状态表。

| 必需追踪信息 | 使用现有内容承载 |
|---|---|
| Fix / Requirement / Scenario 与 Acceptance Contract | Corrective 使用 Corrective Proposal、故障 / 回归范围及适用规格引用；Intentional 使用规格路径 / 标题；均对应现有 Acceptance Contract |
| 当前 Task Set 的相关工程任务 | 使用 Tasks 任务组 / 编号 |
| 实现位置 | `implementation` 说明及 Repository / 文件引用 |
| 验证方法、结果与证据 | `local_validation.checks` / Review Finding 中的执行记录或 Artifact 引用 |
| 所针对的代码和规格范围 | 既有 `candidate_commit`、相关规格引用 / Git 记录、报告中的验收范围说明 |

此表定义报告内容，不强制增加新字段或审批版本绑定。只报告当前 Task Set 已验证的内容；独立验收尚未执行时不得宣称其已 PASS。复用旧 Evidence 必须说明对当前候选版本及要求为何仍然有效。

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
[ ] 当前 Task Set 必要 Implementation Tasks 完成，Fix / 适用规格 / 任务 / 证据对应且无未处理偏差
[ ] 分配给当前 Task Set 的 required Verification Tasks 已完成并有有效 Evidence
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

Engineer 不负责聚合全部 Task Set 或判定整个 Delivery 完成；父级按总方案读取各 `task_refs` 的当前 Development Result、required Change-level Verification 完成事实以及必要 Sub-Issue 状态，按 `verify_agent.required` 决定是否追加 Independent Verification，再推进 PR / Finalize。

---

<a id="engineering-completion"></a>

# 23. Development Completion Check 边界

`Development Completion Check` 是总方案的确定性完成检查，不属于 Engineer Semantic Decision，也不另设 `Development Readiness Check` 副本。

Engineer 提供当前 Task Set 的 Implementation、Task-level Verification、分配到当前 Task Set 的 Change-level Verification、Local Validation、Code Review、Finding 处理、Commit / Push、PR Preparation、Evidence 和 blocker；三条自动 Route 均提供当前 Tasks 完成及 Fix / Acceptance Contract / 适用规格覆盖证据、必要原生校验结果。脚本核对必需引用和专业结果，不凭 checkbox 推断正确性。Corrective 保留根因对应与 Regression Evidence；合法省略的 Delta / Design 不是完成失败，必需 Change / Tasks / 证据缺失则不能通过。

当前 assigned Task Set 的工程执行方法在交付后调用 Check；Parent Issue Runtime 记录 Task Set Completion Fact，Isolated Runtime 则按授权完成当前 Sub-Issue，统一以总方案 §11–§15 为准。Check PASS 与状态写入成功分别确认，父 Delivery 不因单个 Task Set 完成而直接关闭。

本章不维护另一套全局聚合、Verify required 路由或 PR 完成条件。

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
Approved Change / Root Cause / 当前 Tasks
        ↓
Regression Feedback
        ↓
Minimal Necessary Fix
        ↓
Regression Validation
        ↓
Code Review（Fix / 任务 / 适用规格一致性）
        ↓
Tasks / 必要 Design / Evidence 更新
        ↓
Development Ready
```

Engineer 默认消费已批准 Root Cause / Fix Strategy 和轻量 Change，在独立 Run 中按当前 Task Set 的 Tasks 实施，不另起 requirement-analysis / spec-preparation。Root Cause 被新证据推翻时按 §25 升级，不修改分析文件使其迎合现有实现。

---

## 24.2 Intentional Mode

适用于：

```text
sdd-fast
```

`development-execution` 在本模式承担规格驱动实现：

```text
读取当前 Task Set 的相关主规格 / Delta、Design / Tasks 与 Acceptance Contract
       ↓
明确本轮规格场景、任务范围及所需验证
       ↓
建立 Feedback，按规格小步实现
       ↓
依据规格场景及验收要求执行 Local Validation
       ↓
Code Review / Targeted Fix
       ↓
同步任务进度与批准边界内的设计细节
       ↓
Development Evidence / Development Ready
```

正常入口仍为 `development-execution`。可以直接调用 `/opsx:apply`，也可以实现相应语义；不以命令是否被调用作为完成标准。两种方式均遵循当前 Task Set 范围、§8.3 产物更新权限和既有 Engineering Contract。

复用原生 Apply 时显式限定当前任务组及停止边界；原生方法面向 Change 的待办任务，不能假定它自动理解 Multica 的 Task Set 分工。当前 Task Set 的任务完成后结束本次工程工作，不继续领取其他 Task Set 的剩余任务。[^e-openspec-apply]

可稳定测试的 Behavior 优先使用 TDD；Required Local Validation、Code Review、Commit / Push、PR Preparation 和 Evidence 要求保持不变。

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

由于 Corrective Change 的 Root Cause Analysis 已经在 Workitem Analyst 阶段完成，Engineer 不默认重新执行完整 Corrective Proposal。

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
Acceptance Contract
```

则停止 Development，交回 Delivery Lead 协调 Workitem Analyst / Human。

---

# 26. Engineering Method 技术选型

OpenSpec 是三条自动 Route 的统一变更模型；Corrective 使用专用轻量产物与根因 / 回归方法，Intentional 使用完整规格驱动方法，不只是外部文档附件。项目不引入替代 Multica 运行与协作职责的第二套全局 Runtime。

正式选择：

```text
Multica
= Runtime / Collaboration / State

OpenSpec（bug-fix / production-fix / sdd-fast）
= 统一 Change / Tasks / Git 基线 / Archive
+ Corrective 轻量产物 / Intentional 规格驱动方法

Feedback-Driven Development
= 小步实现与持续反馈

项目自有 Engineer Design / development-execution
= 当前 assigned Task Set 的工程执行契约
= 调用 OpenSpec 原生能力或实现相应语义

其他第三方 Engineering Skills
= TDD / Review / Diagnostic 等方法参考来源
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
- 实现阶段不擅自重定义已批准行为与范围；允许按 §8.3 细化设计与任务；
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

`sdd-fast` 中 Workitem Analyst 的需求分析与 OpenSpec 准备是同一职责的连续落实，不表示需求必须先在 OpenSpec 外全部定稿。Engineer 复用这些结果并在批准边界内实施、反馈和细化，不另起一轮上层需求规划。

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
assigned Task Set
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
assigned Task Set 的公共工程执行方法；消费统一 Change，按 Corrective / Intentional 重点结合反馈完成工程闭环。
```

## 30.2 Preconditions / Inputs

至少要求：

```text
当前 assigned Task Set
Approved Development Context
Development Scope
Repository Scope
Acceptance Contract
Verification Contract
必要依赖
当前 Change / Tasks / 适用原生产物及原生准备结果
```

## 30.3 Procedure

Corrective 的 Ground、Implement、Local Validate 与 Evidence 按 §24.1，Intentional 按 §24.2 执行；两者的 Tasks / 适用 Design 按 §8.3 更新。具体调用原生能力还是实现相应语义，不改变以下完成流程。

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

全部自动 Route 同时确认当前 Task Set 的必要 Tasks 已完成，Fix / Regression Scope 或相关主规格 / Delta 场景和 Acceptance Contract 有对应实现与验证依据，Tasks / 适用 Design 已按权限更新，偏差已处理。无需等待整个 Change 的其他 Task Set 完成，也不得以本 Task Set READY 宣称整个 Change 或 Delivery 已完成。

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

执行 §17.1 的公共检查，并按当前 Task Set 的 Route / Mode 选择 Corrective 或 Intentional 专项；Rework 沿用原适用范围。不在本节维护第二份清单；Corrective 适用轻量 Change 契约，不强制增加不适用的 Delta、Design 或 Intentional Review。

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

> **Domain Skill 定义“这个技术领域如何正确实现”，development-execution 定义“一个 assigned Task Set 如何完成工程闭环”。**

---

# 35. Code Review、Verification 与 Verify Agent 的正式边界

根据总方案：

```text
Task Verification / Local Validation / Code Review
= Development 必备

Change-level Verification Task
= 组合行为按需建立，Responsibility Executor 可为 Engineer；当已批准 Independent Verification 与 Task 范围重合时也可为 Verify Agent

CI / script / test runner
= Verification Execution Mechanism，不是 Task Owner

Verify Agent
= Optional Independent Verification Executor
```

## Engineer / Code Review 关注

```text
实现是否正确
是否符合 Corrective Proposal / Requirement / Scenario / Design
Repository Standards
复杂度
Test Quality
Scope Drift
静态 Contract Risk
当前 task_refs 的 Verification Evidence
```

## Verify Agent 关注

仅当：

```text
verify_agent.required = true
```

才额外进行 independent verification。它消费当前批准的 OpenSpec Acceptance / Verification Contract，对固定候选 Commit Set 独立验证最终行为、Runtime / Integration / E2E 等指定范围并输出 Evidence / Finding。

Verify Agent 不拥有 Requirement / Scenario / Verification Task，不负责定义“验什么”，也不替代 Engineer 的 task-level verification、Local Validation 或 Code Review。

因此：

```text
Required Task Verification
+
Local Validation PASS
+
Code Review PASS
```

是 Development Ready 的前置条件。若 `verify_agent.required=true`，父 Delivery 在全部 required Task Sets Ready 后再调度独立 Verify Agent；`required=false` 只取消独立执行者，不取消任何必要验证。

OpenSpec Native Verify 属于 Change-level Artifact-to-Implementation Verification，可作为工程检查的一部分，但不属于每个 Engineer Task Set 的默认必经步骤；它不自动替代真实 Runtime Integration / E2E，也不等同于 Independent Verify Agent。`verify_agent.required=true` 时由 Verify Agent 在 Independent Verification 中执行或复用当前候选版本结果；`required=false` 时仅在 Project / Change Contract 明确要求或需要 Change-level consistency audit 时按需执行。

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
把需要独立 Runtime State 的工作隐藏为 Engineer 内部 implementation subagent
```

正式原则：

> **Subagent 可以辅助推理和 Review，但不得绕过 Multica Runtime Projection、扩大 `task_refs` 或形成隐藏的持久化执行边界。**

如果一项工作实际上具备：

```text
独立边界
独立失败 / 重试
独立完成
独立验证边界
```

是否为某个 Task Set 创建 Development Sub-Issue 属于 Delivery Lead Runtime Projection Decision，不属于 Engineer 内部私有编排。

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
Acceptance Contract
External Contract
Development Scope
Assigned Task Set / Approved Scope Boundary
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
当前 Task Set 的 Development Completion Facts 检查
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

# 41. 核心设计决策

| 项目 | 决策 |
|---|---|
| 文档定位 | Engineer Agent + Development Skills 专业设计，不重复总 Delivery Lifecycle |
| Engineer 角色 | Engineering Semantic Owner |
| 上游分析 | Workitem Analyst 形成持久化批准产物；Engineer 在独立 Run 读取当前版本并复用，不重建详细计划或依赖共享会话 |
| 工作对象 | 通过 Assignment 或当前 Issue 中 `@mention` 明确交付的 assigned Task Set |
| Issue Ownership | Delivery Issue Squad-owned；职责明确的独立 Development Sub-Issue 可 Specialist-owned；以总方案为准 |
| 协作入口 | Parent Issue Runtime 由 Delivery Lead `@mention`；独立 Specialist-owned Sub-Issue 通过 Assignment / 原生 Run |
| Development 主方法 | `sdd-fast` 规格驱动实现；所有 Task Set 结合 Feedback-Driven Development |
| 主 Skill | `development-execution` |
| TDD | 正式公共 Method Skill；适用时优先使用，不全局强制 |
| Debugging | `diagnosing-bugs`；仅 Diagnostic Escalation 时使用 |
| Code Review | Engineer Development 必备；implementation-oriented |
| Verify Agent | 按需；behavior-oriented 独立验收 |
| Local Validation | 所有 assigned Task Set 必须 |
| Development Ready | Engineer 产生 Facts，不负责全局聚合 |
| 完成检查 | 当前 Task Set 使用 Development Completion Check；父级聚合与后续交付只引用总方案 |
| Commit / Push | Engineer Development Contract 的一部分 |
| PR Preparation | Engineer Semantic Work |
| PR Materialization | Deterministic Side Effect，不属于 Engineer |
| Rework | Targeted Rework |
| Subagent | 仅 reasoning / review / diagnostic helper；不得隐藏 assigned Task Set |
| Matt Pocock | 主要 Engineering Method 参考来源 |
| Matt `implement` | `development-execution` 的主要设计参考 |
| Matt `tdd` | 采用核心方法并本地化 |
| Matt `diagnosing-bugs` | 采用核心方法并本地化 |
| Matt `code-review` | 采用双轴 Review 思想并本地化 |
| Superpowers | 补充方法参考，不作为 Framework |
| Engineer 权限 | 实现语义，不改变 approved Analysis Contract |
| OpenSpec | 全部自动 Route 统一 Change / Tasks；Corrective 保留根因 / 回归导向与轻量契约，Intentional 保留规格导向 |
| OpenSpec Tasks | 当前 Task Set 的工程实现与开发侧验证清单；有范围、有证据，不包含等待 Verify / PR / Archive |
| 确定性逻辑 | Gate / Check / Script |
| UNKNOWN / 冲突 | Delivery Lead Semantic Fallback |

---


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

<a id="engineering-acceptance"></a>

## 42.1 规格驱动实现验收

后续实施至少验证以下场景；本次文档更新未运行这些测试。

| 场景 | 应满足的行为 |
|---|---|
| `bug-fix` / `production-fix` 缺少必需 Change / Tasks / 准备结果（分别验证） | 停止正式工程推进并反馈缺口；不补造分析或默默按无 Change 方式交付 |
| 两类修复缺少必要回归证据，或需要改变已批准 Expected Behavior | 按原有质量与升级规则处理，不因轻量 Change 而放行 |
| 修复任务进入 Rework | 更新同一 Change 的当前 Tasks 与受影响证据，保留 Corrective 重点，不重复分析或变成完整 SDD 流程 |
| 一个 Change 分配两个 Task Set | 双方只处理自己的 Tasks / Fix / 规格范围，单 Task Set 可先完成，不覆盖另一 Task Set 的任务更新 |
| Corrective 合法 skip_specs / 省略 Design | 按已验收准备结果消费，不制造无意义产物；既有行为与回归证据仍必须满足 |
| Workitem Analyst 与 Engineer 在不同 Run / 目录 | Engineer 从持久化根仓基线与授权修订读取当前输入，不依赖 Workitem Analyst 会话或未提交文件 |
| Engineer 必需跨 Run 读取与针对新事实的复核 | 不因 Token 指标省去；只避免重复整轮分析和无关历史加载 |
| 只读 Delta 会遗漏已有权限或兼容性约束 | Ground 同时读取相关主规格，验证未改变的必要约束 |
| 任务全部勾选但没有对应测试 / 运行证据 | 完成检查不放行无依据的 Coverage，补充相应验证 |
| 上游需求与问题分析已充分，直接派发当前 Task Set | 从现有结论、规格或 Fix Strategy 开始实施，不重新从 TFS 开展整轮需求分析 |
| 当前状态 in_progress，但原始意见要求分析修改 / 再次审核 | 不当作研发批准；停止编码并交 Delivery Lead 核对当前交接 |
| 明确批准依据缺失，或附加前置条件尚未满足 | 不以 Gate PASS、Agent 自述或字段标签替代 Human 授权 |
| 关键业务规则 / 范围 / 验收要求仍有影响实现的歧义 | 提交具体问题和证据并澄清，不静默猜测或通过修改规格迎合实现 |
| 局部设计 / 测试细化 | 在批准边界内更新相关任务与设计，不重跑完整 Analysis |
| 行为或验收要求变化、代码 Commit 未变 | 升级所需审批并重新评估受影响 Evidence，不自动沿用 PASS |
| Verify Agent 不需要 | 必要规格场景仍有开发侧证据，不能免除验证 |
| 原生 Apply 或自有执行语义 | 都遵守当前 Task Set 范围和相同 Engineering Contract，不重复实施其他 Task Set |
| Specialist-owned Sub-Issue 直接启动 | 从当前任务及绑定方法取得完整上下文，不依赖父级 Mention 或共享会话 |

---

# 43. 核心原则

> **总方案负责 Delivery 生命周期，Engineer 方案只负责 Engineering Semantic Work 与可复用 Development Method。**

> **Workitem Analyst 把需求与问题分析清楚并做好研发准备，Human 确认需要批准的需求、方案和验收边界；Engineer 复用这些依据，在边界内决定如何正确实现，不重新猜测需求或复制详细计划。**

> **全部自动 Route 消费统一 OpenSpec Change：Corrective 按已批准根因 / Fix Strategy / Tasks 恢复既定行为，Intentional 按规格 / Design / Tasks 实现；均以有效工程反馈证明完成。**

> **OpenSpec `tasks.md` 同时承载 Implementation Task 与按需的 Verification Task；Engineer 可在批准边界内细化任务说明、更新进度和设计，但 Human Approval 后不得并行新增、重编号或复用顶层 `T-xxx` Identity。任务不机械映射 Development Sub-Issue，也不替代 Local Validation、Code Review、Evidence 或 Completion Check。**

> **Engineer 是 Engineering Semantic Owner，但不是 Runtime Topology Owner。**

> **Delivery Issue 保持 Delivery Squad-owned；职责明确的独立 Development Sub-Issue 可由对应 Specialist Agent 持有，Parent Issue Runtime 由 Delivery Lead 在父 Issue 中 `@mention` Engineer；具体 Ownership 以总方案为准。**

> **研发以可观测反馈驱动；主要代码修改前先建立可靠 Feedback Signal。**

> **TDD 是正式且优先的工程方法之一，但不是整个 Delivery Workflow，也不要求所有工程资产机械采用。**

> **Local Validation 与 Code Review 是每个 assigned Task Set 的必备质量机制，与 Verify Agent 是否参与无关。**

> **Code Review 面向实现质量；必要 Verification 优先由 Task Verification / Change-level Verification 闭合。`verify_agent.required=true` 时，Verify Agent 以批准后的 Acceptance Contract、Verification Tasks / Focus 与固定候选版本为输入执行独立行为验收。**

> **Engineer 的正常交付终点是 Development Ready Facts、Development Evidence、Commit / Push 与 PR Preparation，而不是直接完成 PR Materialization。**

> **PR Preparation 属于 Engineer 的语义工作；PR Materialization 属于确定性副作用。**

> **Corrective Change 默认消费已批准的 Root Cause / Fix Strategy；Debugging 是异常诊断路径，不是正常编码的第一步。**

> **Finding 优先 Targeted Rework，不无差别重跑整个 Development。**

> **统一 Change Model 不合并 Workitem Analyst / Engineer 的 Agent 或 Run；文档持久化与接收方必要读取是交接基线。项目 Skill 可调用 OpenSpec 原生能力或实现相应语义，不替代 Multica 的运行与协作。**

> **Subagent 可以辅助调查、诊断和 Review，但不得形成隐藏的 assigned Task Set 或第二套交付拓扑。**

> **可以程序化判断的条件交给 Script / Gate / Check；Engineer 负责工程语义；Delivery Lead 负责跨角色与 Runtime 语义。**

> **任何需要改变 approved Requirement / Scenario、Expected Behavior、Acceptance Contract、Regression Scope、Development Scope、Repository Scope 或 Assigned Task Set / Approved Scope Boundary 的情况，都必须停止 Engineer 自主扩展并升级。**

---

## 专业方法来源

Multica 公共机制及官方 URL 统一引用 [指导手册](01-multica-design-guideline-v1.11.md#official-source-index)。以下保留 OpenSpec 专业方法来源，原有核对日期不表示本次完成安装版本验收。

[^e-openspec-apply]: OpenSpec 官方 [Apply 工作方法公开模板](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/src/core/templates/workflows/apply-change.ts)，2026-09-29 核对。Task Set 范围限制是本项目适配要求，不假定原生方法识别 Multica Sub-Issue。
[^e-openspec-verify]: OpenSpec 官方 [Verify 工作方法公开模板](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/src/core/templates/workflows/verify-change.ts)，2026-09-29 核对。与 Code Review / 独立验收的分工是本项目设计；原生语义检查不等于真实运行测试。

---

## v1.12 变更摘要

- 正式定义 `Development Verification = Task-level Verification + Engineer-owned Change-level Verification Task（按需）+ Local Validation`；Code Review、Evidence、Commit / Push、PR Preparation 继续作为 Development Completion 的并列条件。
- Task-level Verification 明确由 Assigned Engineer 负责；Change-level Verification Task 默认可投影给 Engineer，在已批准 Independent Verification 与范围重合时也可由父 Delivery 投影给 Verify Agent。
- CI / script / test runner 明确为 Verification Execution Mechanism，不作为 Task Owner；Engineer 不自行把本应承担的验证转交 Verify Agent。
- OpenSpec Native Verify 不属于每个 Task Set 的 mandatory Development Verification；`verify_agent.required=true` 时由 Verify Agent 执行或复用，`false` 时只在明确要求或 Change-level consistency audit 需要时运行。
- 对齐 Delivery v1.4.17 与 OpenSpec Schema Implementation v1.3；Analysis v1.15、Guideline v1.11 保持不变。

## v1.11 变更摘要

- 对齐 OpenSpec Schema Implementation v1.2 与 Analysis v1.15：Engineer 不再消费独立 `bug-analysis.md`、AC / VR Identity；Corrective 从 `proposal.md` 读取 Expected / Actual、Root Cause / Fix Strategy / Regression Scope，Intentional 从 Requirement / Scenario 读取 Acceptance Contract。
- `tasks.md` 正式同时包含 Implementation Task 与按需 Change-level Verification Task；每个 Implementation Task 必须有 task-level verification，只有组合后的 Change 才能证明行为时才需要独立 Verification Task。
- Regression / Integration / E2E 统一定义为 Verification Method，不再与 Verify Agent 角色绑定；Engineer / CI 在授权范围内可以执行。
- Verify Agent 收窄为 **Optional Independent Verification Executor**；`verify_agent.required=true` 只表示父 Delivery 需要额外独立验收，不取消 Engineer 的 Task Verification / Local Validation / Code Review。
- OpenSpec Native Verify 定位为 Artifact-to-Implementation Verification，可被工程检查复用，但不替代真实 Runtime Integration / E2E 或 Independent Verify Agent。
- Human Approval 后冻结 top-level `T-xxx` Identity；Engineer 只在受控边界内细化任务描述、Verification procedure 和 checkbox，不并行新增 / 重编号 top-level Task。
- Ground、Code Review、Development Completion、Evidence、Rework 与核心原则同步到 Native Acceptance / Verification Model；不修改 Agent / Skill 实现资产。

## v1.10 变更摘要

- 对齐指导手册的 **Runtime-Centric Delivery + Artifact-Centric Engineering** 顶层原则，明确 Engineer 不建立第三套工程输入；本次同版本修订不改变版本号。
- 对齐 **OpenSpec = Engineering Truth / Multica = Delivery Truth**：Engineer 的技术输入以已批准 OpenSpec Change 为准，Multica Handoff Facts 只提供 Route、批准、分工、Verify 等 Delivery Facts。
- Verification Requirements 不再从独立 Structured Result 读取；Corrective 从 Bug Analysis、Intentional 从 Spec / Delta Spec 读取。
- Engineer 不依赖第三套 Analysis Contract Store；跨 Run 交接只需要 OpenSpec 引用 + Multica delivery facts + 必要 Evidence references。
- 本次仅更新设计文档，不修改 Engineer Instructions、Skills、Gate、脚本或 OpenSpec Schema。

---

# v1.9 变更摘要

- 对齐 Analysis v1.13 的 Artifact Model：Engineer 交接输入改为已批准的 **OpenSpec Change + Analysis Handoff Facts + Supporting Evidence / Review Facts**，不依赖 `requirement-analysis.md`、`requirement-review.md` 或 `analysis-package.md`。
- Intentional Development 继续以 Proposal / Specs / Design / Tasks 为正式技术输入；Selected Solution 从 Proposal / Design 与批准后的 Analysis Result 读取，避免重建第二套 Requirement 文档。
- Corrective 继续消费 Bug Analysis / Proposal / Tasks 与合法 Specs done/skipped；AC 与 Verification Requirements 均以 Bug Analysis 为权威；Multica 交接只引用其 AC / VR，并提供 Verify Recommendation / Focus 等 Delivery Facts。
- Verify Agent 输入边界进一步明确：AC 定义验收结果，Verification Requirements 定义必须验证的内容，Verification Focus 定义独立验收重点；`verify_agent.required=false` 仍不取消开发侧验证。
- `intentional-change` 的 Specs / Design 继续是 Required Artifact；只有当前 Schema 明确允许的省略（如 Corrective `skip_specs`）才可作为合法输入，不以“文档精简”放宽 Schema。
- 本次只同步 Development 设计契约，不修改 Engineer Instructions、Skills、Scripts 或其他实现资产。

---

## v1.8 变更摘要

- 对齐 Technical Change Kind Schema 命名：Corrective=`corrective-change`，Intentional=`intentional-change`；Engineer 只读取 Change 已持久化 Schema，不自行重选。
- `intentional-change` 作为项目级 `sdd-fast` Development Contract：Proposal / Specs / Design / Tasks 全部必需，Design 深度按复杂度伸缩；缺任一 Artifact 不进入正式工程执行。
- `corrective-change` 继续消费 Bug Analysis / Proposal / Tasks 与 Specs done/skipped；独立 Design 不作为默认前置，批准交接引用附加设计时才消费。
- 明确 Apply Ready / CLI exit code 不等于 Human Approval、Engineering Ready 或 Development Complete；Engineer 继续依据批准上下文、当前 Task Set、Validation 与 Engineering Contract 工作。
- 现有项目 `sdd` 不作为当前 `sdd-fast` Engineer 输入 Schema；已有 `schema: sdd` Change 的兼容与未来定位由主方案 / Analysis 统一管理。
- 配套主方案 v1.4.13、Analysis v1.12、指导手册 v1.8；本次仅更新设计契约，不发布生产 Schema 或执行真实业务开发。

---

# v1.7 变更摘要

- 对齐 OpenSpec `1.13.2` 与分型 Schema：Corrective 使用 `corrective`，Intentional 使用 `spec-driven`；Engineer 读取 Change 已持久化 Schema，不重新路由。
- Corrective 输入正式包含 Schema Artifact `bug-analysis`、Proposal、Tasks 和适用 Specs；独立 Design 只在批准交接明确引用时读取，不作为默认完成前置。
- `skip_specs` 只表示本 Change 无 Specs Artifact，不免除既定 Expected Behavior、Regression Signal、Local Validation、Code Review 或 Evidence。
- 其余 Engineering Contract、assigned Task Set 边界、按需 Verify、PR Preparation、Targeted Rework 与跨 Run 交接保持不变。
- 同步主方案 v1.4.12、Analysis v1.11 与指导手册 v1.7；本次仅更新设计，未运行自定义 Schema 接入验收。

---

## v1.6 变更摘要

- 三条自动 Route 共用 Change 生命周期与 Tasks 交接；Engineer 按 Change 中已持久化的 Schema 消费产物，Corrective=`corrective`、Intentional=`spec-driven`。
- Ground 明确跨 Run 的持久化批准基线与接收方当前读取；不依赖 Workitem Analyst 会话，不因缺失准备而重做整轮 Analysis。
- Code Review、Evidence、Development Completion Check 与 Rework 同步到轻量 Change；合法省略不误判失败，必需任务 / 证据缺口不得放行。
- 原有 Local Validation、Code Review、按需 Verify、PR Preparation、角色权限与 Targeted Rework 不变；不新增完整 OpenSpec Review 链。
- 同步主方案 v1.4.11、Analysis v1.10 与指导手册 v1.6；仅更新设计，未部署或执行运行验收。

---

<a id="historical-changes"></a>

## 历史版本记录

以下 v1.6 及更早记录保留当时含义，旧文件名、旧规则与旧来源核对日期不作为 v1.7 的执行依据。当前规则见正文。

## v1.5 变更摘要

- 更新主方案 v1.4.10、指导手册 v1.5 和 `workitem-analyst-stage-design-v1.9.md` 的引用。
- 修正“只维护 Analysis 领域术语”的复制残留，明确 Engineering / Development 专业范围及其与 Multica 原生 Stage 的区别。
- 平台 Assignment、Mention、Instructions、Skills 与 Run 机制统一引用指导手册，保留本阶段完整输入和停止边界。
- Verify 推荐引用 Analysis 专业契约，最终 required 与执行规则对齐主方案，不由 Engineer 按 Route 重新决定；工程方法、Evidence 和历史摘要保留。
- 本次为文档对齐，未更新平台中的 Agent 配置或生成执行 Skill，未运行工程 / Multica 接入验收。

## v1.4 变更摘要

- 同步人工审核语义与研发授权输入：Lead 理解自然语言意见，Engineer 消费明确批准及条件的交接；不以状态值、Gate PASS 或 Agent 自述作为独立批准依据。
- 同步 Workitem Analyst 的需求与问题分析、研发准备定位；Ground 复用明确的目标、场景、规则与验收，关键需求缺口定向澄清，局部实现选择由 Engineer 细化。
- 将 Code Review 明确为公共检查 + Route 专项；Corrective 输入、完成检查及 Rework 不要求 OpenSpec 产物，并同步方法摘要和回归验收，版本号保持不变。
- 将当前 Task Set 的主规格 / Delta、任务范围、开发侧验证及证据引用落实到 Ground、实施、Review 和完成契约，不绑定 Apply 命令。
- OpenSpec 一致性检查融入现有 Code Review；Evidence 能追踪规格场景、任务、实现、验证结果和候选版本。
- Tasks 仅表示工程实现与开发侧验证；当前 Task Set 不等待其他 Task Set 或业务 PR，按实际事实更新任务，不虚假勾选。
- 规格 / 验收要求实质变化时重新判断旧证据，不仅检查代码 Commit 是否改变。
- 修正 §3 / Instructions 中仅限 Squad-owned 与 Mention 的旧规则；统一使用总方案的 Development Completion Check，不维护 Readiness 聚合副本。
- 本次只更新专业设计和验收要求，未生成执行 Skill、部署配置或运行测试。

以下为历史版本记录，不作为当前执行规则。

## v1.3 变更摘要

- `sdd-fast` 从读取 OpenSpec 文档明确为按规格驱动实现，Feedback-Driven Development、TDD、Local Validation 和 Code Review 继续保留。
- 可以调用 `/opsx:apply`，也可以由 `development-execution` 实现相应语义；不绑定特定命令。
- 允许批准边界内的设计细化与任务更新；改变已批准行为、范围、关键约束或验收要求时仍升级，Evidence 体现相关规格场景的实现与验证。

以下为历史版本记录，当前执行规则以正文为准。

## v1.2 变更摘要

- 同步上位方案 `multica-squad-centric-delivery-v1.4.7.md` 与上游 `workitem-analyst-skill-design-v1.6.md`。
- 明确 `sdd-fast` Development 消费 Approved OpenSpec Change，OpenSpec 是版本化 Development Contract，不是新的 Runtime / Workflow Driver。
- `tasks.md` 保持 Implementation Checklist；Engineer 只更新当前 Task Set 相关完成事实，不将 task 机械映射为 assigned Task Set，也不以 checkbox 替代 Engineering Contract。
- `development-execution` 继续作为 Canonical Development Entry；不使用 OpenSpec Apply 建立第二套顶层 Development Workflow。
- 若实现需要改变 approved Spec / Expected Behavior / AC / Scope，Engineer 必须停止并升级。
- 顺带同步当前总方案的 Development Sub-Issue Ownership / Assignment 边界，避免继续引用 v1.4.4 的旧 Squad-owned 规则。
