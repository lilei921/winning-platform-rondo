# Multica Engineer / Development 阶段设计方案

> Version: 1.6  
> Date: 2026-09-30  
> Scope: Multica Delivery Squad 中 Backend Engineer、Frontend Engineer、Flink Engineer 的 Agent 配置、Development 执行方法、Engineering Method Skills、Development Evidence 与停止边界  
> Status: Draft Baseline

> 上位方案：`multica-squad-centric-delivery-v1.4.11.md`  
> 上游分析方案：`workitem-analyst-stage-design-v1.10.md`  

> Terminology：本方案中的 Squad、Agent、Issue、Status、Route、Gate 等公共名称统一遵循 `multica-design-guideline-v1.6.md` 的 Canonical Terminology；本方案只维护 Engineering / Development 领域术语。
---

<a id="engineering-stage-scope"></a>

# 1. 文档定位

本文只设计 **Engineer / Development 专业层**。“Development 阶段”是 Delivery 生命周期中的专业工作区段，不对应 Multica 原生 Stage。文档层职责见 [指导手册](multica-design-guideline-v1.6.md#document-ownership)；Stage 使用规则仍由主方案 §14 维护。

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
multica-squad-centric-delivery-v1.4.11.md
```

为权威来源。

正式原则：

> **总方案定义 Delivery 生命周期；Engineer 方案只定义 Engineering Semantic Work。**

> **同一规则只维护一个权威来源，遵守 One Rule, One Owner。**

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

<a id="engineering-work-object"></a>

# 3. Engineer 的工作对象

Engineer 的工作对象是当前 Development Unit，其 Goal、Scope、AC、相关任务及批准上下文来自当前 Issue / Sub-Issue 和必要交接引用，不依赖共享父级会话。

| 工作方式 | Ownership / 入口 | Engineer 的完成边界 |
|---|---|---|
| Simple Delivery | 父 Delivery Issue 保持 Squad-owned；Delivery Lead 在父 Issue 中 `@mention` 对应 Engineer | 交付隐式 Unit 的工程成果与 Facts，不将父 Issue 置为 done |
| 独立、职责明确的 Unit | Development Sub-Issue 默认 Assignment 给对应 Specialist Agent，由原生 Run 执行 | Engineering Contract 和 Development Completion Check 满足后，按授权完成当前 Sub-Issue |
| Unit 本身需要持续多角色协调 | 例外 Sub-Issue 可 Squad-owned，Leader 在该子 Issue 内协调 | 仍只完成当前 Unit，不推进整个 Delivery |

同一工作只使用一个正常触发入口，不同时激活子任务并在父 Issue Mention 执行同一任务。Assignment、Mention 与 Run 的平台机制见 [指导手册：Assignment](multica-design-guideline-v1.6.md#mechanism-assignment)、[Issue / Run](multica-design-guideline-v1.6.md#mechanism-issue-run)。正常完成回流、重开与授权写入以总方案 §10–§16 为准；Engineer 不自行重建 Owner、Sub-Issue 或 Stage。

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

根据 [指导手册：Agent Description](multica-design-guideline-v1.6.md#mechanism-agent-description)，Description 只承担 UI / Discoverability 职责，不承担执行规则。官方依据由手册集中维护。

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

三个 Engineer Agent 使用指导手册的同构 Instructions；接收范围与平台事实见 [Agent Instructions](multica-design-guideline-v1.6.md#mechanism-agent-instructions)，绑定方法的复用方式见 [Skills](multica-design-guideline-v1.6.md#mechanism-skills)：

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

你负责当前通过 Assignment 或 @mention 明确交付的 Development Unit 的工程实现语义，
在已经批准的 Analysis / Development Context 边界内完成代码实现、
本地验证、Code Review、整改以及 Development Evidence。

你负责在明确的需求、方案和约束下“如何正确实现”，不负责重新决定
“需求应该是什么”或“整个 Delivery 应该如何组织”；发现影响实现的需求缺口时反馈澄清，不自行猜测。
```

## 7.2 Core Responsibilities

```text
- 在独立 Engineer Run 中读取当前 Unit 的已批准 Change、问题 / 需求结论与工程任务；Corrective 根据 Root Cause / Fix Strategy 恢复既定行为，Intentional 根据规格实现；两者均按 AC 和验证要求交付。
- 建立适合当前修改的可靠 Feedback Loop。
- 采用小步、可验证的方式完成生产代码实现，并在批准边界内同步相关设计细节与任务进度。
- 完成 Required Local Validation 与 implementation-oriented Code Review。
- 处理 Development 内部 Review Finding 和 Verify Agent 返回的 Engineering Finding。
- 完成 Commit / Push、PR Preparation 与 Development Evidence。
- 向当前工作 Issue / Sub-Issue 写回 Progress / Result，不越权关闭父 Delivery。
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
- 以当前 Issue / Sub-Issue、approved Analysis Package、当前 Unit 的规格 / 任务范围与代码事实为准。
- 接收方必须读取当前可访问的批准产物；不得假定 Workitem Analyst 会话自动继承。已明确的需求与问题结论直接复用，不重做整轮分析；影响正确实现的关键歧义、必要输入缺口或新证据冲突，交 Delivery Lead 协调 Workitem Analyst / Human 澄清。
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
- 当前 Unit 的必要业务规则、预期行为、范围或验收要求不明确，无法据此正确实现；
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

<a id="engineering-input"></a>

# 8. Development 输入契约

Engineer 与 Workitem Analyst 保持独立 Agent / Run，通过持久化、已批准的 Analysis Package / OpenSpec Change 交接；必要读取属于工程职责，不依赖共享会话。复用已完成问题 / 需求分析，不从原始 TFS Work Item 重做一遍，也不在 OpenSpec 外重建一套详细规格、设计或实施计划。

输入来自已经完成 Analysis Review 并被 Delivery Lead Materialize / Dispatch 的当前 Development Unit。上游专业准备标准见 `workitem-analyst-stage-design-v1.10.md` §1.2；本阶段确认这些结论足以支撑当前 Unit，而非再次执行完整 Analysis。

上游 Verify 推荐的生成契约见 [Analysis 方案 §16](workitem-analyst-stage-design-v1.10.md#verify-recommendation)；Engineer 消费主方案批准后的验证要求，不从 Route 或原始推荐自行重算 `verify_agent.required`。必要 Local Validation / Code Review 不受独立 Verify 是否需要的影响。

人工分析审核意见由 Delivery Lead 结合原始评论理解并形成当前交接，按总方案 §9 处理；Engineer 不另设评论解析器或代替 Human 批准。交接须能追溯当前明确批准的范围和已满足条件。`analysis_review`、Analysis Gate PASS、单独的 `in_progress` 或 Agent 自述都不是研发授权；批准和退回分析都可能进入 `in_progress`，缺少明确批准依据时先停止并交 Lead 澄清。

## 8.1 Common Inputs

至少应能获得：

```text
Development Unit Goal
相关需求 / 问题场景、预期行为与已确认规则
Requirement / Fix Scope 与 Development Scope
Repository Scope
Relevant Context
Dependencies
Acceptance Criteria
Verification Requirements
Target Role
当前唯一 OpenSpec Change / 已批准根仓基线引用
当前 Unit 的 Tasks 范围与适用 Design / Spec / 分析引用
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

Corrective 同样消费已批准的轻量 Change、Proposal、当前 Tasks 与 Bug Analysis / Evidence；适用 Design / 主规格 / Delta 一并读取。没有新增 Delta 或合法省略 Design 不构成失败，但缺少必需 Change、Tasks、根因 / 验证依据或可确认的原生准备结果时必须停止。缺失准备工作交回 Workitem Analyst，不由 Engineer 为过 Gate 伪造文档或重做一轮需求分析。最小产物与原生省略契约见 Analysis 方案 §9、§26。

<a id="engineering-openspec-input"></a>

## 8.3 OpenSpec 输入与更新（全部自动 Route）

本节适用于 `bug-fix`、`production-fix`、`sdd-fast`。根据 Approved OpenSpec Change 和当前 Route 实现；只读取当前 Unit 必需内容，但不得漏掉相关既有约束：

```text
OpenSpec Change Reference
Corrective：Bug Analysis / Root Cause / Fix Strategy / Regression Scope
Intentional：Requirement Analysis / Selected Solution
相关已有主规格及本次 Delta / Scenario（适用时）
proposal.md
design.md（如有）
tasks.md 中当前 Unit 的任务组 / 任务引用
当前 Unit 的 AC / Verification Requirements
```

正式边界：

```text
Bug Analysis / Root Cause Evidence（Corrective）
= 既定行为、故障路径、诊断与修复依据

Spec / Delta Spec（适用时）
= 预期行为与验证场景

Design / Tasks
= 实现方案、技术约束与实施任务

tasks.md
= Implementation Checklist
≠ Runtime Topology
≠ Development Sub-Issue Map
```

Engineer 按当前 Unit 的 Fix Strategy 或规格、适用 Design 与 Tasks 实现，以故障 / 回归场景或规格场景、AC / Verification Requirements 验证。未修改的已有约束仍有效；合法 skip_specs 只免除新增 Delta，不取消既定行为依据和回归验证。

接收方确认根仓 / Change 身份与已批准基线可对应，当前所读产物包含已授权修订；临时绝对路径、未持久化文件或过期副本不能作为唯一交接。无法读取时报告具体缺口，不猜测 Workitem Analyst 的结论，不自行换成原始 TFS 文本重新规划。

当前任务组 / Tasks 引用由派发说明或现有 Unit 范围确定。一个 Change 可由多个 Unit 执行；不得因看到其他 task 就自行扩展 Unit / Repository Scope，也不得不加范围限制地再次实施整个 Change。引用不清或覆盖责任冲突时由 Delivery Lead 澄清，不新增私有任务状态表。

产物更新按变更语义区分：

| 变化 | 处理 |
|---|---|
| 任务完成记录、批准范围内的任务细化、测试补充及局部设计细节 | Engineer 更新相关 Design / Tasks，并保持与规格和验收要求一致 |
| 改变已批准行为、External Contract、AC、关键技术约束、Root Cause / Fix Strategy / Selected Solution 的实质结论或 Scope | 停止相关自主扩展，由 Delivery Lead 协调 Workitem Analyst / Human，按既有审核流程处理 |
| 无法确认是否越过批准边界 | 停止并澄清，不自行视为已批准 |

Git Commit 记录版本，不把全部产物冻结为只读；相关更新继续由根仓 Git 跟踪，不单独创建 PR。OpenSpec checkbox 不替代 Development Completion Check、Local Validation、Code Review 或 Development Evidence。

任务完成后依据实际实现和验证更新相关 checkbox；细化、替换或取消任务时保留必要理由，不伪造完成、不删除仍须满足的要求。Tasks 只含工程实现和开发侧验证，其正式内容边界由 Workitem Analyst 方案 §23 维护；当前 Unit 不以等待独立 Verify、业务 PR 或 Archive 为完成条件。

涉及已批准行为 / Scope 的实质变更按上表升级，相关规格、设计、任务与验收要求一并修正。规格 / 验收要求变化即使不改变代码，也须按总方案重新判断 Evidence 有效性；不能仅以同一 Commit 沿用旧 PASS。

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

三条自动 Route 使用统一 OpenSpec Change；Corrective 保留根因与回归导向，Intentional 保留规格导向，所有 Development Unit 均采用 Feedback-Driven Development。统一产物与反馈不是替代关系：

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

是所有 Development Unit 的必备环节，与 Verify Agent 是否 required 无关。

---

# 12. Ground

Engineer 开始实现前必须读取当前 Unit 的权威输入。

至少确认：

```text
当前 Unit 有明确的人工批准与 Delivery Lead 交接依据，附加前置条件已满足
Goal 与当前 Unit 相关业务 / 问题场景明确
预期行为、适用规则与需求 / 修复范围明确
Development Scope 明确
Repository Scope 明确
Acceptance Criteria 可读取
Verification Requirements 可读取
Dependencies 满足当前启动条件
目标 Repository / Branch 可安全操作
```

全部自动 Route 共同确认：

```text
当前 Change / 已批准根仓基线与当前授权修订可对应
当前 Unit 的 Tasks、适用 Design / Spec 和分析引用可读取
Tasks 与当前 AC / 验证要求对应，原生准备 / 合法省略结果可确认
已有 Evidence 是否仍适用于当前代码、行为与验收范围
```

Corrective 额外确认 Root Cause / Status / Evidence、Fix Strategy 和 Regression Scope；Intentional 额外确认当前要实现的规格 / 场景及 Selected Solution。合法省略的 Delta / Design 不被追加为形式前置条件；必需内容缺失则停止并反馈，不由 Engineer 重做整轮准备。

正常情况下不重新执行：

```text
Requirement Analysis
Solution Exploration
完整 Root Cause Analysis
Development Topology Planning
```

存在影响正确实现的业务规则、范围或验收缺口时，提出具体问题和影响，由 Delivery Lead 协调 Workitem Analyst / Human 补充；不得静默猜测或用代码现状代替确认。局部算法、类 / 函数拆分、测试组织等属于本阶段可细化的实现选择，不因尚未提前决定就退回完整 Analysis。

---

# 13. Establish Feedback

主要实现前建立当前 Unit 的最小可靠 Feedback Loop。Corrective 从故障 / 回归场景与 AC、Intentional 从规格场景与 AC 选择反馈，包含相关错误、权限或边界场景；可稳定自动测试时使用 TDD，否则选择适合当前工程资产的可靠检查。不能只验证“文件编译成功”而遗漏已要求验证的行为。

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

它不等于额外的独立 Acceptance Verification，但必须覆盖当前 Unit 被分配的开发侧验证要求。`verify_agent.required=false` 不取消这些要求；存在需要独立验收的新风险时按既有流程升级，不自行降低标准。

---

<a id="engineering-code-review"></a>

# 17. Code Review

Code Review 属于 Engineer Development 内部必备质量机制。

正式定位：

> **Code Review = implementation-oriented。**

至少从两个维度检查。

## 17.1 Specification / Fix Alignment

同一个 `code-review` 方法先执行公共检查，再按当前 Route / Development Mode 选择专项检查；Rework 继承原 Unit 的适用范围，不因进入返工而转成 `sdd-fast`。

### 公共检查（所有 Route）

```text
当前 Unit 的实现是否正确、完整，是否满足已批准范围及 AC
必需开发侧验证是否具有适用于当前候选成果的结果与 Evidence
当前 Unit 的 Tasks 是否按实际实现 / 验证更新，适用 Design / Spec 是否一致
是否存在 Scope Drift 或未经批准的行为、接口及验收要求变化
```

### Corrective Mode（`bug-fix` / `production-fix`）

```text
是否落实已批准 Root Cause / Fix Strategy，修复是否针对已确认的故障路径
Fix Scope 是否适当，是否恢复既定 Expected Behavior 而非重新定义行为
故障场景、Regression Scope 及相关 AC 是否具有实现与回归验证依据
引用已有规格时，是否保留与本次修复相关的既定约束
```

检查轻量 Change 与实际修复一致，Tasks 没有遗漏必要回归；存在 Delta 时确认补录场景和未修改约束被保留。合法 skip / 省略不构成失败，不为 Corrective 补跑完整需求 Review；必需 Change / Tasks / Evidence 缺失则按实际缺口处理，不能因“轻量”放行。

### Intentional Mode（`sdd-fast`）

```text
是否符合相关主规格 / 本次 Delta 及当前 Unit 的 Requirement / Scenario
规格场景与 AC 是否具有实现与验证依据
当前必要 Tasks 是否遗漏，完成记录是否与工程事实一致
Design（如 required）的关键约束是否体现在实现中，局部修订是否已同步
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

若 Verify Agent 已 PASS 后代码又发生实质变化，则旧 Verify PASS 的有效性由总方案 / Verification Gate 规则决定，Engineer 不自行绕过。规格或验收标准的实质变化同样触发有效性复核。

当前 Unit 对 Design / Tasks 的更新按根仓 Git 规则提交，仅包含当前工作允许的修改；不得夹带其他任务改动，也不为 OpenSpec 根仓产物创建独立 PR。

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

三条自动 Route 在现有 `implementation`、`acceptance_coverage` 和 `local_validation.checks` 中补足引用，使当前 Unit 的 Fix / Regression Scenario、适用规格场景与 AC 能追到下列信息；`COVERED` 不能只是无依据的标签，不另建追踪文件或任务状态表。

| 必需追踪信息 | 使用现有内容承载 |
|---|---|
| Fix / Requirement / Scenario 与 AC | Corrective 使用 Bug Analysis、故障 / 回归范围及适用规格引用；Intentional 使用规格路径 / 标题；均对应现有 AC |
| 当前 Unit 的相关工程任务 | 使用 Tasks 任务组 / 编号 |
| 实现位置 | `implementation` 说明及 Repository / 文件引用 |
| 验证方法、结果与证据 | `local_validation.checks` / Review Finding 中的执行记录或 Artifact 引用 |
| 所针对的代码和规格范围 | 既有 `candidate_commit`、相关规格引用 / Git 记录、报告中的验收范围说明 |

此表定义报告内容，不强制增加新字段或审批版本绑定。只报告当前 Unit 已验证的内容；独立验收尚未执行时不得宣称其已 PASS。复用旧 Evidence 必须说明对当前候选版本及要求为何仍然有效。

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
[ ] 当前 Unit 必要 Tasks 完成，Fix / 适用规格 / 任务 / 证据对应且无未处理偏差
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

Engineer 不负责聚合全部 Development Unit 或判定整个 Delivery 完成；父级按总方案读取各 Unit 当前状态及有效结果，推进必要 Verify / PR / Finalize。

---

<a id="engineering-completion"></a>

# 23. Development Completion Check 边界

`Development Completion Check` 是总方案的确定性完成检查，不属于 Engineer Semantic Decision，也不另设 `Development Readiness Check` 副本。

Engineer 提供当前 Unit 的 Implementation、Local Validation、Code Review、Finding 处理、Commit / Push、PR Preparation、Evidence 和 blocker；三条自动 Route 均提供当前 Tasks 完成及 Fix / AC / 适用规格覆盖证据、必要原生校验结果。脚本核对必需引用和专业结果，不凭 checkbox 推断正确性。Corrective 保留根因对应与 Regression Evidence；合法省略的 Delta / Design 不是完成失败，必需 Change / Tasks / 证据缺失则不能通过。

当前 Unit 的工程执行方法在交付后调用 Check；PASS 后如何写当前 Sub-Issue 的完成状态、Simple Delivery 如何记录隐式 Unit 事实及原生回流，统一以总方案 §11–§12、§15 为准。Check PASS 与状态写入成功分别确认，父 Delivery 不因单个 Unit 完成而直接关闭。

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

Engineer 默认消费已批准 Root Cause / Fix Strategy 和轻量 Change，在独立 Run 中按当前 Unit 的 Tasks 实施，不另起 requirement-analysis / spec-preparation。Root Cause 被新证据推翻时按 §25 升级，不修改分析文件使其迎合现有实现。

---

## 24.2 Intentional Mode

适用于：

```text
sdd-fast
```

`development-execution` 在本模式承担规格驱动实现：

```text
读取当前 Unit 的相关主规格 / Delta、Design / Tasks 与 AC
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

正常入口仍为 `development-execution`。可以直接调用 `/opsx:apply`，也可以实现相应语义；不以命令是否被调用作为完成标准。两种方式均遵循当前 Unit 范围、§8.3 产物更新权限和既有 Engineering Contract。

复用原生 Apply 时显式限定当前任务组及停止边界；原生方法面向 Change 的待办任务，不能假定它自动理解 Multica 的 Unit 分工。当前 Unit 的任务完成后结束本次工程工作，不继续领取其他 Unit 的剩余任务。[^e-openspec-apply]

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
= 当前 Development Unit 的工程执行契约
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
Development Unit 的公共工程执行方法；消费统一 Change，按 Corrective / Intentional 重点结合反馈完成工程闭环。
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

全部自动 Route 同时确认当前 Unit 的必要 Tasks 已完成，Fix / Regression Scope 或相关主规格 / Delta 场景和 AC 有对应实现与验证依据，Tasks / 适用 Design 已按权限更新，偏差已处理。无需等待整个 Change 的其他 Unit 完成，也不得以本 Unit READY 宣称整个 Change 或 Delivery 已完成。

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

执行 §17.1 的公共检查，并按当前 Unit 的 Route / Mode 选择 Corrective 或 Intentional 专项；Rework 沿用原适用范围。不在本节维护第二份清单；Corrective 适用轻量 Change 契约，不强制增加不适用的 Delta、Design 或 Intentional Review。

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

根据总方案：

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

时仍必须经过独立 Acceptance Verification。`required=false` 也必须满足必要验证覆盖；检查责任及父级放行条件统一引用总方案 §16–§17。不得把原生 Verify 的代码风格检查转交给 behavior-oriented Verify Agent，或在已有 Code Review 后再次无差别完整 Review。

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
当前 Unit 的 Development Completion Facts 检查
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
| 工作对象 | 通过 Assignment 或当前 Issue 中 `@mention` 明确交付的 Development Unit |
| Issue Ownership | Delivery Issue Squad-owned；职责明确的独立 Development Sub-Issue 可 Specialist-owned；以总方案为准 |
| 协作入口 | Simple Delivery 由 Delivery Lead `@mention`；独立 Specialist-owned Sub-Issue 通过 Assignment / 原生 Run |
| Development 主方法 | `sdd-fast` 规格驱动实现；所有 Unit 结合 Feedback-Driven Development |
| 主 Skill | `development-execution` |
| TDD | 正式公共 Method Skill；适用时优先使用，不全局强制 |
| Debugging | `diagnosing-bugs`；仅 Diagnostic Escalation 时使用 |
| Code Review | Engineer Development 必备；implementation-oriented |
| Verify Agent | 按需；behavior-oriented 独立验收 |
| Local Validation | 所有 Development Unit 必须 |
| Development Ready | Engineer 产生 Facts，不负责全局聚合 |
| 完成检查 | 当前 Unit 使用 Development Completion Check；父级聚合与后续交付只引用总方案 |
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
| OpenSpec | 全部自动 Route 统一 Change / Tasks；Corrective 保留根因 / 回归导向与轻量契约，Intentional 保留规格导向 |
| OpenSpec Tasks | 当前 Unit 的工程实现与开发侧验证清单；有范围、有证据，不包含等待 Verify / PR / Archive |
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
| 一个 Change 分配两个 Unit | 双方只处理自己的 Tasks / Fix / 规格范围，单 Unit 可先完成，不覆盖另一 Unit 的任务更新 |
| Corrective 合法 skip_specs / 省略 Design | 按已验收准备结果消费，不制造无意义产物；既有行为与回归证据仍必须满足 |
| Workitem Analyst 与 Engineer 在不同 Run / 目录 | Engineer 从持久化根仓基线与授权修订读取当前输入，不依赖 Workitem Analyst 会话或未提交文件 |
| Engineer 必需跨 Run 读取与针对新事实的复核 | 不因 Token 指标省去；只避免重复整轮分析和无关历史加载 |
| 只读 Delta 会遗漏已有权限或兼容性约束 | Ground 同时读取相关主规格，验证未改变的必要约束 |
| 任务全部勾选但没有对应测试 / 运行证据 | 完成检查不放行无依据的 Coverage，补充相应验证 |
| 上游需求与问题分析已充分，直接派发当前 Unit | 从现有结论、规格或 Fix Strategy 开始实施，不重新从 TFS 开展整轮需求分析 |
| 当前状态 in_progress，但原始意见要求分析修改 / 再次审核 | 不当作研发批准；停止编码并交 Delivery Lead 核对当前交接 |
| 明确批准依据缺失，或附加前置条件尚未满足 | 不以 Gate PASS、Agent 自述或字段标签替代 Human 授权 |
| 关键业务规则 / 范围 / 验收要求仍有影响实现的歧义 | 提交具体问题和证据并澄清，不静默猜测或通过修改规格迎合实现 |
| 局部设计 / 测试细化 | 在批准边界内更新相关任务与设计，不重跑完整 Analysis |
| 行为或验收要求变化、代码 Commit 未变 | 升级所需审批并重新评估受影响 Evidence，不自动沿用 PASS |
| Verify Agent 不需要 | 必要规格场景仍有开发侧证据，不能免除验证 |
| 原生 Apply 或自有执行语义 | 都遵守当前 Unit 范围和相同 Engineering Contract，不重复实施其他 Unit |
| Specialist-owned Sub-Issue 直接启动 | 从当前任务及绑定方法取得完整上下文，不依赖父级 Mention 或共享会话 |

---

# 43. 核心原则

> **总方案负责 Delivery 生命周期，Engineer 方案只负责 Engineering Semantic Work 与可复用 Development Method。**

> **Workitem Analyst 把需求与问题分析清楚并做好研发准备，Human 确认需要批准的需求、方案和验收边界；Engineer 复用这些依据，在边界内决定如何正确实现，不重新猜测需求或复制详细计划。**

> **全部自动 Route 消费统一 OpenSpec Change：Corrective 按已批准根因 / Fix Strategy / Tasks 恢复既定行为，Intentional 按规格 / Design / Tasks 实现；均以有效工程反馈证明完成。**

> **OpenSpec `tasks.md` 指导实现与验证；Engineer 可在批准边界内细化任务、更新进度和设计。任务不机械映射 Development Sub-Issue，也不替代 Local Validation、Code Review、Evidence 或 Completion Check。**

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

> **统一 Change Model 不合并 Workitem Analyst / Engineer 的 Agent 或 Run；文档持久化与接收方必要读取是交接基线。项目 Skill 可调用 OpenSpec 原生能力或实现相应语义，不替代 Multica 的运行与协作。**

> **Subagent 可以辅助调查、诊断和 Review，但不得形成隐藏的 Development Unit 或第二套交付拓扑。**

> **可以程序化判断的条件交给 Script / Gate / Check；Engineer 负责工程语义；Delivery Lead 负责跨角色与 Runtime 语义。**

> **任何需要改变 approved Requirement、Expected Behavior、Acceptance Criteria、Development Scope、Repository Scope 或 Development Unit Boundary 的情况，都必须停止 Engineer 自主扩展并升级。**

---

## 专业方法来源

Multica 公共机制及官方 URL 统一引用 [指导手册](multica-design-guideline-v1.6.md#official-source-index)。以下保留 OpenSpec 专业方法来源，原有核对日期不表示本次完成安装版本验收。

[^e-openspec-apply]: OpenSpec 官方 [Apply 工作方法公开模板](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/src/core/templates/workflows/apply-change.ts)，2026-09-29 核对。Unit 范围限制是本项目适配要求，不假定原生方法识别 Multica Sub-Issue。
[^e-openspec-verify]: OpenSpec 官方 [Verify 工作方法公开模板](https://raw.githubusercontent.com/Fission-AI/OpenSpec/main/src/core/templates/workflows/verify-change.ts)，2026-09-29 核对。与 Code Review / 独立验收的分工是本项目设计；原生语义检查不等于真实运行测试。

---

## v1.6 变更摘要

- 三条自动 Route 共用当前 OpenSpec Change / Tasks 输入与产物更新规则；Corrective 保留根因、最小修复、Regression Signal 及轻量产物边界。
- Ground 明确跨 Run 的持久化批准基线与接收方当前读取；不依赖 Workitem Analyst 会话，不因缺失准备而重做整轮 Analysis。
- Code Review、Evidence、Development Completion Check 与 Rework 同步到轻量 Change；合法省略不误判失败，必需任务 / 证据缺口不得放行。
- 原有 Local Validation、Code Review、按需 Verify、PR Preparation、角色权限与 Targeted Rework 不变；不新增完整 OpenSpec Review 链。
- 同步主方案 v1.4.11、Analysis v1.10 与指导手册 v1.6；仅更新设计，未部署或执行运行验收。

---

<a id="historical-changes"></a>

## 历史版本记录

以下 v1.5 及更早记录保留当时含义，旧文件名、旧规则与旧来源核对日期不作为 v1.6 的执行依据。当前规则见正文。

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
- 将当前 Unit 的主规格 / Delta、任务范围、开发侧验证及证据引用落实到 Ground、实施、Review 和完成契约，不绑定 Apply 命令。
- OpenSpec 一致性检查融入现有 Code Review；Evidence 能追踪规格场景、任务、实现、验证结果和候选版本。
- Tasks 仅表示工程实现与开发侧验证；当前 Unit 不等待其他 Unit 或业务 PR，按实际事实更新任务，不虚假勾选。
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
- `tasks.md` 保持 Implementation Checklist；Engineer 只更新当前 Unit 相关完成事实，不将 task 机械映射为 Development Unit，也不以 checkbox 替代 Engineering Contract。
- `development-execution` 继续作为 Canonical Development Entry；不使用 OpenSpec Apply 建立第二套顶层 Development Workflow。
- 若实现需要改变 approved Spec / Expected Behavior / AC / Scope，Engineer 必须停止并升级。
- 顺带同步当前总方案的 Development Sub-Issue Ownership / Assignment 边界，避免继续引用 v1.4.4 的旧 Squad-owned 规则。
