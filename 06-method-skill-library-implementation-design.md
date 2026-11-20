# Method Skill Library Implementation Design（方法 Skill 库实施设计）

> 注：业务仓 worktree 模式已于 2026-11-03 废止，并发写隔离以 `workspace-skills/pull-request/references/repo-write-isolation-contract.md` 为准；本文相关叙述仅作历史背景。

> Version: 1.4.3  
> Scope: Project Skills（项目技能）使用的 Internal Engineering Method Modules（内部工程方法模块）  
> Date: 2026-11-07  
> Author: winning/li_lei

> Status（状态）: Implementation Baseline（实施基线）  
> Related Baseline（关联基线）: [02-multica-delivery-lifecycle-design.md](02-multica-delivery-lifecycle-design.md), [03-workitem-analysis-design.md](03-workitem-analysis-design.md), [04-engineer-development-design.md](04-engineer-development-design.md), [01-multica-openspec-design-guideline.md](01-multica-openspec-design-guideline.md), [05-openspec-schema-implementation-design.md](05-openspec-schema-implementation-design.md)

## 目录

- [1. Purpose（目的）](#method-section-01)
- [2. Why Internal Method Modules（为什么使用内部方法模块）](#method-section-02)
- [3. Ownership（归属）](#method-section-03)
- [4. Physical Structure（物理结构）](#method-section-04)
- [5. Method Implementation Modes（方法实现模式）](#method-section-05)
- [6. Initial Method Decisions（初始方法决策）](#method-section-06)
- [7. Method Module Contract（方法模块契约）](#method-section-07)
- [8. Source Governance（来源治理）](#method-section-08)
- [9. Dispatch Ownership（调度归属）](#method-section-09)
- [10. Defect Diagnosis Techniques（缺陷诊断技巧，非独立模块）](#method-section-10)
- [11. `tdd` Module（测试驱动开发模块）](#method-section-11)
- [12. `codebase-design` Module（代码库设计模块）](#method-section-12)
- [13. `code-review` Module（代码审查模块）](#method-section-13)
- [14. `verification-before-completion` Module（完成前验证模块）](#method-section-14)
- [15. Method Effects and Permissions（方法副作用与权限）](#method-section-15)
- [16. Method Result Persistence（方法结果持久化）](#method-section-16)
- [17. Failure / Stop Contract（失败 / 停止契约）](#method-section-17)
- [18. No Global Method Registry in v1（v1 不建立全局方法注册表）](#method-section-18)
- [19. Project Skill Integration（项目 Skill 集成）](#method-section-19)
- [20. Implementation Deliverables（实施交付物）](#method-section-20)
- [21. Acceptance Tests（验收测试）](#method-section-21)
- [附录 A. External Method References（外部方法参考）](#method-appendix-a)
- [附录 B. Version History（历史版本记录）](#method-appendix-b)

---

<a id="method-section-01"></a>

# 1. Purpose（目的）

本方案定义本项目已采用的 Project Skill 内部 Engineering Method 组织、按需引用与治理方式。Method 是可选的工程技巧组织方式，不是 Multica 原生独立对象；此实现方案不要求所有 Skill 创建内部 Method 模块。

核心模型：

```text
Multica
= Delivery Runtime Owner（交付运行时归属）

OpenSpec
= Engineering Contract Owner（工程契约归属）

Agent（专业智能体）
= Professional Goal（专业目标） + 结果责任 + Skill 选择

Project Skill（项目技能）
= Reusable Work Method Package（可复用工作方法包：适用场景、必要准备、步骤、资料、工具、结果使用方式与适用的停止条件） + 按需增加的局部 Outcome / Validation / Dispatch

Internal Method Module（内部方法模块）
= Reusable Engineering Method（可复用工程方法）
```

核心原则：

> **当前项目的 `methods/` 是 Project Skill 可选的内部工程方法组织方式，不是独立的 Multica Runtime 对象。**

第三方 Matt / Superpowers 内容不作为 Multica Agent 可独立发现、独立调用或接管流程的 Skill 暴露。

<a id="section-1-1"></a>

## 1.1 Skill Extraction（能力提取）与 Right-sized Execution（按规模适配）

本节与 [03 §14](03-workitem-analysis-design.md#analysis-section-14) 对齐，结束 Analysis Skill 是否必须保留历史七个顶层 Skill 的待决状态；**不再要求七 Skill 固定链**。决定是否创建独立 Project Skill 时，依次核查：

1. 能否明确真实的 What + When，并以最小充分方式说明准备条件、执行方法、结果使用或提交方式与适用的停止条件？结果型 Skill 可定义区别于 Agent Professional Goal 的局部 Capability Outcome，但不是所有 Skill 的必填项。
2. 能否跨任务/角色复用，或作为独立场景方法长期维护？不要求必须已有多个 Agent 绑定，也不强制独立 Artifact。
3. 独立抽取是否减少耦合与重复，而不是增加固定流程、隐式跨 Skill 调用或启动成本？
4. 该内容是专业能力还是单个 Skill 内的工程技巧 / 可确定性脚本？后者优先保留为 Internal Method / Script。

当前 `bug-analysis`、`requirement-analysis`、`codebase-explorer`、`spec-preparation` 已作为独立 Skill 源文件由 Workitem Analyst 按需组合；`analysis-completion` 负责提交并调用 Analysis Gate；Workitem Analyst 不需要额外绑定 `delivery-gate`。原 `workitem-analysis` 已退役并保留历史源文件；`requirement-review` 属按需专业活动，不因历史命名自动注册独立 Skill。新增 Skill 不强制引入新的 Run、Stage、Method Registry 或 Artifact。

**Right-sized Execution**：Agent 按证据充分性、变更影响和风险决定调查深度与可选方法；Skill 内完整 Procedure 仅在存在真实依赖时定义硬顺序。批准、必要验证、可靠 Evidence、Gate 和有副作用的状态写入仍是 Hard Constraints，不能因小任务省略。

---

# 2. Why Internal Method Modules（为什么使用内部方法模块）

项目需要的是：

```text
Debugging method
TDD method
Code design vocabulary
Code review method
Completion verification discipline
```

不需要第三方：

```text
workflow dispatch
subagent topology
ticket lifecycle
planning lifecycle
branch / PR lifecycle
human approval workflow
spec ownership
```

因此 Agent 根据当前专业目标选择适用 Skill；在已选的场景 Skill 内，由该 Skill 指导内部 Method 的选择与调用。Method 不反向决定 Agent 的完整工作流。

例如：

```text
development-execution
    ↓
internal method dispatch
    ├── tdd
    ├── codebase-design
    ├── code-review
    └── verification-before-completion
```

Agent 不直接看到这些 Method 作为同级入口。

---

<a id="method-section-03"></a>

# 3. Ownership（归属）

## 3.1 Multica（交付运行时）

Owns：

```text
Run
Assignment
Status
Squad collaboration
Human Review
Runtime Projection
Verify decision
PR / Delivery lifecycle
```

## 3.2 OpenSpec（工程契约）

Owns：

```text
Intentional Proposal / Requirement / Scenario / Design
Corrective Proposal（Expected / Actual / Root Cause / Fix / Regression Scope）
Implementation Tasks
Task-level / Change-level Verification Tasks
Change-specific Engineering Truth
Supporting Evidence references
```

不建立平行 `AC-xxx` / `VR-xxx` Identity。`bug-analysis` 代表可独立提取的诊断能力或专业方法，但不是 OpenSpec Artifact；有 Specs 时 Requirement + Scenario 构成 Acceptance Contract（验收契约）。

## 3.3 Project Skill（项目技能）

Owns：

```text
What + When / 可复用方法与资料
适用输入与 Context Assembly（按需）
必要的专业步骤及 Method Selection（按需）
结果如何使用或提交，以及适用的 Stop / Escalation 条件（最小充分）
独立 Validation / Output Artifact（仅在实际交付场景需要时）
按既有 Artifact Owner 写入或引用专业结果（适用时，不另建同名产物）
```

## 3.4 Internal Method Module（内部方法模块）

Owns only：

```text
how to perform one engineering method
```

Method 不直接：

```text
assign
change Multica status
create Sub-Issue
choose Technical Change Kind / Schema
archive Change
merge PR
create another workflow
dispatch hidden agents
```

---

<a id="method-section-04"></a>

# 4. Physical Structure（物理结构）

## 4.1 Development（研发）

```text
development-execution/
├── SKILL.md
├── methods/
│   ├── tdd.md
│   ├── codebase-design.md
│   ├── code-review.md
│   └── verification-before-completion.md
├── references/
│   └── development-contract.md
├── scripts/
│   └── validate-development-evidence.py
├── templates/
│   └── development-evidence.md
└── tests/
```

## 4.2 Corrective Analysis（现行单文件 Skill）

当前 `bug-analysis/SKILL.md` 已独立存在并绑定 Workitem Analyst，提供按证据和复杂度选择的因果诊断方法，不再规划 `methods/diagnosing-bugs.md` 或 `methods/systematic-debugging.md`。

```text
bug-analysis/
└── SKILL.md
```

反馈信号、可证伪假设与差异调查均是可选的诊断技巧，而非必须选择的内部 Method 链；复杂故障才深化调查，简单故障可复用可信诊断结论。

---

<a id="method-section-05"></a>

# 5. Method Implementation Modes（方法实现模式）

只保留两种实现模式。

## 5.1 Vendored（内置副本）

适用于：

- 上游 Method 本身接近纯方法 / reference；
- 与项目 Runtime 冲突很少；
- 只需要删除少量不允许行为。

做法：

```text
选择固定 upstream commit
→ 提取方法内容
→ 放入父 Skill 的 methods/
→ 删除 workflow side effects
→ 记录 source / deviations
```

Vendored 不代表原文无修改复制。

## 5.2 Project-native（项目原生）

适用于：

- 原 Skill workflow 成分较重；
- 包含自动 subagent / user interaction / issue/spec discovery；
- 项目只需要核心 reasoning discipline。

做法：

```text
保留方法语义
→ 按项目 Input / Output / Constraints 自定义实现
```

Project-native 不依赖第三方 Runtime 行为。

---

<a id="method-section-06"></a>

# 6. Initial Method Decisions（初始方法决策）

| Method Capability | Source | Mode | Parent Skill | Reason |
|---|---|---|---|---|
| `tdd` | Matt | Project-native | `development-execution` | 原方法包含 seam confirmation 与外部方法依赖；项目必须从 approved OpenSpec AC/VR 与当前 task_refs 驱动 |
| `codebase-design` | Matt | Vendored | `development-execution` | 当前上游主要是 vocabulary/reference，适合作为内部 reference method |
| `code-review` | Matt | Project-native | `development-execution` | 保留 Standards + Spec 双轴；删除 subagent topology 与外部 spec discovery |
| `verification-before-completion` | Superpowers | Project-native | `development-execution` / Verify | 核心纪律简单：completion claim 必须有 fresh evidence |

**Corrective 诊断说明：** Matt / Superpowers 的诊断技巧已按需要吸收到 `bug-analysis/SKILL.md` 的通用方法中，不再作为待部署 Method 项目。

以下不进入内部 Method Library：

```text
writing-plans
executing-plans
subagent-driven-development
dispatching-parallel-agents
using-git-worktrees
finishing-a-development-branch
implement
to-spec
to-tickets
triage
wayfinder
```

它们与 Multica Runtime、OpenSpec Contract 或 Project Stage ownership 重叠。

---

<a id="method-section-07"></a>

# 7. Method Module Contract（方法模块契约）

对于需要独立维护输入、方法及副作用边界的 `methods/*.md`，推荐下列结构；**只保留适用字段，不以标题齐全作为验收门槛**：

```markdown
# <Method Name>

## Purpose
## Use When
## Inputs
## Method
## Output
## Allowed Effects
## Forbidden Effects
## Stop Conditions
## Source
```

不要求建立统一持久化 Invocation Object。

Method 直接消费父 Skill 当前已经持有的：

```text
change_ref
task_refs
relevant OpenSpec refs
repository / code scope
approved constraints
current evidence
```

---

<a id="method-section-08"></a>

# 8. Source Governance（来源治理）

Vendored Method 顶部记录：

```yaml
source:
  provider: matt-skills
  repository: https://github.com/mattpocock/skills
  upstream_ref: <commit-or-tag>
  upstream_path: <path>
mode: vendored
```

Project-native：

```yaml
source:
  inspired_by:
    - provider: matt-skills
      upstream_ref: <commit-or-tag>
      upstream_path: <path>
mode: project-native
```

原则：

- 固定 upstream commit/tag；
- 上游升级不会自动改变项目 Method；
- 更新只通过 Review 后手动吸收；
- Project Method 的行为由当前文件定义；
- 不要求实时跟随上游 Skill。

---

<a id="method-section-09"></a>

# 9. Dispatch Ownership（调度归属）

在同一已选 Project Skill 内，可由 Skill 提供内部 Method 选择指导，Agent 按实际任务采纳；**Agent 负责跨 Skill 的选择及整体专业结果**。Method 不自行创建独立调用链，单纯方法文件也无需注册成新的 Multica Skill。

例如 `development-execution/SKILL.md`：

```text
Ground
→ Establish Feedback

Concrete behavior + suitable test seam
→ methods/tdd.md

Architecture / seam question materially affects implementation
→ methods/codebase-design.md

Implementation candidate ready
→ methods/code-review.md

Before completion claim
→ methods/verification-before-completion.md
```

现行 `bug-analysis/SKILL.md` 直接提供按需的 Root Cause 诊断；仅复杂或证据矛盾时再选择可证伪假设、反馈信号等技巧，不依赖额外的 Method 文件。

内部 Method 不得自主：

```text
dispatch another Method
dispatch another Agent
create another workflow
```

需要其他 Method 时返回建议给父 Skill，由父 Skill决定。

---

<a id="method-section-10"></a>

# 10. Defect Diagnosis Techniques（缺陷诊断技巧，非独立 Method 模块）

本节记录 `bug-analysis` 采用的可选技巧，不代表需要创建 `diagnosing-bugs` 的 Skill / Method 文件。

适用时可以缩小失败路径、建立可信 Feedback Signal、提出可证伪假设并核对区别性证据。无法安全复现时允许用日志、Trace 与历史差异判断，并明确可信度和未决风险。已有可信 Root Cause 时只核对当前适用性，不重复完整调查。

诊断输出为 Root Cause / Confidence、Evidence、Fix Strategy、Regression 建议和必要未知项。其结果由调用者依据当前职责使用；`bug-analysis` 不直接写 OpenSpec Artifact、业务代码或 Multica Delivery State。

<a id="method-section-11"></a>

# 11. `tdd` Module（测试驱动开发模块）

## Purpose（目的）

对适合自动测试的具体行为进行小步 test-first 实现。

## Inputs（输入）

```text
assigned task_refs
relevant OpenSpec contract:
  Intentional Requirement / Scenario
  or Corrective Expected Behavior / Regression Scope
current Task verification
current code scope
current test conventions
```

## Method（方法）

```text
1. Determine observable behavior and test seam from approved contract
2. Establish RED
3. Implement minimum GREEN
4. Continue one behavior / vertical slice at a time
5. Keep tests behavior-oriented
6. Perform safe implementation cleanup when needed
```

测试 seam 优先从 approved Spec / Corrective Proposal / Design / current code contract 推导；只有无法可靠确定且会影响正确性时才升级，不把每次人工确认作为硬前置。

## Output（输出）

```text
tests_changed
implementation_changed
red_evidence
green_evidence
remaining_risks
```

## Constraints（约束）

```text
do not redefine expected behavior
do not expand approved scope
do not create another plan
do not commit/push as part of the Method itself
```

<a id="method-section-12"></a>

# 12. `codebase-design` Module（代码库设计模块）

Mode：

```text
Vendored reference method
```

作用：

```text
module
interface
seam
depth
adapter
locality
testability
```

它是设计词汇和原则，不是 Session Driver。

父 `development-execution` 决定何时读取。

不得因为读取该 Method 自行启动架构重构流程。

---

<a id="method-section-13"></a>

# 13. `code-review` Module（代码审查模块）

## Purpose（目的）

对当前候选实现进行两个独立维度的审查：

```text
Standards
Spec / Contract
```

## Inputs（输入）

```text
fixed_point / approved baseline
current diff
project standards
approved OpenSpec refs
assigned task_refs
```

## Method（方法）

```text
1. Fix the review baseline
2. Review repository/project standards compliance
3. Review approved OpenSpec contract compliance
4. Record findings independently by axis
5. Identify blocking findings
```

不使用第三方默认的 parallel subagent topology；并行与 Agent 调度归 Multica / Project Skill。

## Output（输出）

```text
baseline
standards_findings
spec_findings
blocking_findings
```

## Constraints（约束）

```text
read/review only by default
no hidden subagent
no issue creation
no scope expansion
no spec discovery outside approved OpenSpec refs unless parent Skill requests context lookup
```

---

<a id="method-section-14"></a>

# 14. `verification-before-completion` Module（完成前验证模块）

## Purpose（目的）

任何 PASS / completed claim 必须由当前候选版本的 fresh evidence 支撑。

## Inputs（输入）

```text
claim
current OpenSpec Task / Verification Task
approved Acceptance Contract
required checks
current candidate version
```

## Method（方法）

```text
1. Identify evidence required for the claim
2. Execute or read the current required checks
3. Confirm results belong to the current candidate
4. Reject stale / inferred success
5. Return supported and unsupported claims
```

## Output（输出）

```text
checks
evidence_refs
failed_checks
supported_claims
unsupported_claims
```

Method 不等于 Independent Verify Agent，也不决定 `verify_agent.required`。它只约束任何执行者在声明 Task / Development / Verification 完成前必须拥有当前有效证据，可被 Engineer 或 Verify Skill 复用。

<a id="method-section-15"></a>

# 15. Method Effects and Permissions（方法副作用与权限）

实际工具权限由 Parent Agent / Project Skill 控制。

Method 文件只声明允许/禁止的工程副作用。

Baseline：

| Method | Code Write | Test Write | Command Run | OpenSpec Write | Multica Mutation | Hidden Agent |
|---|---:|---:|---:|---:|---:|---:|
| tdd | yes | yes | yes | no direct contract mutation | no | no |
| codebase-design | no by itself | no | optional read | no | no | no |
| code-review | no by default | no | read/check | no | no | no |
| verification-before-completion | no implementation mutation | no | yes | no | no | no |

父 Skill 持有最终权限与持久化责任。Corrective 的 `bug-analysis` 提供诊断指导，本身不授予代码修改或交付写入权限。

---

<a id="method-section-16"></a>

# 16. Method Result Persistence（方法结果持久化）

Method Output 不自动成为 Artifact。

父 Project Skill 根据 OpenSpec Engineering Truth / Multica Delivery Truth 的归属决定：

```text
bug-analysis 专业诊断结论（Analysis）
→ 由 spec-preparation 维护 Corrective proposal.md

Engineer 复用的诊断 Evidence
→ 当前研发证据与 Finding

TDD implementation/test changes
→ code repository

code-review findings
→ Development Review Result / Evidence

completion verification evidence
→ Development Evidence
→ 或 Independent Verification Report（由 Verify Agent 执行时）
```

不创建：

```text
tdd-result.md
debugging-result.md
method-result.json
method-run state
acceptance.md
verification-requirements.md
```

除非某类 Evidence 本身有长期保存必要。

<a id="method-section-17"></a>

# 17. Failure / Stop Contract（失败 / 停止契约）

Method 必须停止并返回给父 Skill，而不是自行改变流程：

```text
expected behavior unknown
approved scope insufficient
OpenSpec contract conflicts with code facts
required permission missing
method would require unapproved scope change
method would require another Agent / workflow
evidence insufficient for requested claim
```

父 Skill 再决定：

```text
continue
select another internal Method
return to Analysis
escalate to Delivery Lead / Human
```

---

<a id="method-section-18"></a>

# 18. No Global Method Registry in v1（v1 不建立全局方法注册表）

第一版不建立：

```text
method-library.yaml
global method registry
runtime method discovery
```

原因：

- Parent Skill 已经是唯一 Dispatcher；
- Method 数量有限；
- 映射写在父 Skill 中更直接；
- 避免再维护一份 routing truth。

未来只有出现以下需求才引入 Registry：

```text
同一 capability 多种可切换实现
workspace-level configuration
A/B Method experiment
大量 Project Skills 共用同一可变专业策略
```

---

<a id="method-section-19"></a>

# 19. Project Skill Integration（项目 Skill 集成）

## 19.1 `bug-analysis`（现行专业 Skill）

`bug-analysis/SKILL.md` 已存在，负责 Corrective 问题的 Root Cause、证据可信度、Fix Strategy 和 Regression 建议。由 Workitem Analyst 根据当前证据按需使用；简单问题不必运行完整诊断流程，复杂问题可深化调查。

不要求 `methods/diagnosing-bugs.md`、`methods/systematic-debugging.md` 或 `bug-analysis.md`。专业成果由 `spec-preparation` 写入当前正确的 OpenSpec 工件；`bug-analysis` 不承担完整 Analysis、代码修改与交付状态控制。

## 19.2 `development-execution`

负责：

```text
OpenSpec apply context
assigned task_refs
implementation flow
method dispatch
Development Evidence
task completion handoff
```

内部使用：

```text
tdd
codebase-design
code-review
verification-before-completion
```

## 19.3 `verify`

Verify 可以复用 `verification-before-completion` 的 fresh-evidence discipline，但其角色取决于调用上下文：

```text
OpenSpec Native Verify
= Change-level Artifact-to-Implementation verification

Project Verify Skill / Verify Agent
= 当 verify_agent.required=true 时执行 independent verification
= 可以执行被明确分配且与 independent focus 重合的 Change-level Verification Task
```

Method 不自行决定独立性要求，不把 Integration / E2E 绑定到 Verify Agent；这些只是当前 Verification Task 可选择的方法。Verification Task 的 Contract 始终由 OpenSpec `tasks.md` 持有，Verify Agent 只是可能的 Runtime Executor。CI / script / test runner 是 Execution Mechanism，不是 Task Owner。

---

<a id="method-section-20"></a>

# 20. Implementation Deliverables（现行交付结构）

Corrective Analysis 采用单文件 `bug-analysis/SKILL.md`，没有额外 Debugging Method 文件。已有 `development-execution` 的内部 Method 是否需要保留，依据其自身的复用与维护收益独立判断，不要求两类 Skill 使用相同的目录层级。

新增 Method 必须证明独立维护价值；不按历史计划预建文件，也不创建新的 Runtime 入口。

<a id="method-section-21"></a>

# 21. Acceptance Tests（验收测试）

至少用以下场景验证。

## Case A（场景 A）— Straightforward Intentional Change（直接的意图性变更）

```text
development-execution
→ tdd
→ code-review
→ verification-before-completion
```

无 Method 获得 Runtime ownership。

## Case B（场景 B）— Corrective Root Cause（纠正性根因分析）

简单 Bug 直接复用可信 Root Cause 与 Evidence，按需由 `spec-preparation` 更新 Corrective Proposal / Tasks。不得为了执行内部 Method 再做全量调查。

## Case C（场景 C）— Hard Repeated Bug（复杂重复缺陷）

复杂重复 Bug 在 `bug-analysis` 内按需采用可证伪假设、日志 / Trace 和反馈循环，不创建独立 Method，也不要求固定假设数量。证据仍不足时返回未知和下一步验证建议。

## Case D（场景 D）— Code Review（代码审查）

验证：

```text
approved OpenSpec = Spec axis source
project standards = Standards axis source
no hidden subagent
no external issue/spec guessing
```

## Case E（场景 E）— Upstream Skill Changes（上游 Skill 变化）

上游 Matt/Superpowers 更新。

期望：

```text
project behavior unchanged
until manual Review updates internal Method
```

## Case F（场景 F）— Forbidden Workflow Behavior（禁止的工作流行为）

若上游内容包含：

```text
dispatch subagent
create ticket
create plan
commit/push
ask user as mandatory workflow step
```

Vendoring / Project-native 实现必须剔除或由父 Skill 显式重新定义。

---

## Case G（场景 G）— Change-level Verification（变更级验证）

```text
1.1 backend implementation + own verification evidence
2.1 frontend implementation + own verification evidence
3.1 E2E verification only when combined behavior cannot be proven by 1.1 / 2.1 independently
```

期望：

```text
Verification Task stays in tasks.md
no verification.md / acceptance.md
responsibility executor may be Engineer
or Verify Agent when approved independent verification overlaps the task
CI / script / test runner = execution mechanism, not task owner
Verify Agent does not own the Verification Task contract
```

当 Verify Agent 执行当前 Change 的 3.1 且其 Evidence 同时满足 Independent Verification（独立验证） Contract（验证契约） 时，一次执行可以同时完成 3.1 与对应独立验收范围；编号按 [05](05-openspec-schema-implementation-design.md) 的 Native First Task Reference 约定定位，不引入 `T-xxx` 或固定 `Verify:` 字段。不得为了角色形式要求 Engineer 先重复执行相同 E2E。

---

<a id="method-appendix-a"></a>

# 附录 A. External Method References（外部方法参考）

当前 Matt `tdd` 明确把自己描述为 reference rather than driver；`codebase-design` 也是 reference，而 `code-review` 当前实现包含 parallel sub-agents。这进一步支持本项目采用“内部 Method Module + Project Skill 驱动”的结构，而不是直接暴露第三方 workflow Skill。

Reference:
- https://github.com/mattpocock/skills
- https://github.com/mattpocock/skills/blob/main/docs/engineering/tdd.md
- https://github.com/mattpocock/skills/blob/main/docs/engineering/code-review.md
- https://github.com/mattpocock/skills/blob/main/docs/engineering/diagnosing-bugs.md
- https://github.com/mattpocock/skills/blob/main/docs/engineering/codebase-design.md

---

<a id="method-appendix-b"></a>

# 附录 B. Version History（历史版本记录）

## v1.4.1 变更摘要

- 仅调整章节结构：增加章节目录，§20 改为 Implementation Deliverables，§21 改为 Acceptance Tests。
- 原 §22 External Method Notes 调整为附录 A；v1.4 / v1.2 / v1.1 历史摘要合并至附录 B。
- 原有 Method / Skill 设计、实施契约、技术决策及待决事项均保持不变。

---

## v1.4 变更摘要

- `Project Skill = Stage Entry + ...` 改为 `Project Skill = Professional Work Entry + ...`，避免与 Multica 原生 Stage（阶段）发生术语冲突；正文可简称 Entry。
- 03 / 06 的 Analysis Skill / Method 层级问题登记为 Deferred Design Note；本版不调整现有 Skill 结构、Dispatcher 或 Method Module 边界。
- 同步 Guideline、Delivery、Analysis、Development、OpenSpec Schema Implementation 引用。

---

## v1.2 变更摘要

- 对齐 OpenSpec Schema Implementation、Delivery 与 Engineer，明确 Verification Task Contract 与 Runtime Executor 分离。
- 保留 Verify Agent 作为 Change-level Verification Task 合法 Runtime Executor 的能力，但仅在已批准 Independent Verification 与该 Task 范围重合时使用；Verify Agent 不拥有 Task Contract 定义权。
- CI / script / browser / test runner 收敛为 Verification Execution Mechanism，不再与 Engineer / Verify Agent 并列为责任 Owner。
- Change-level Verification Task 由 Verify Agent 执行且 Evidence 满足独立验收契约时，可一次执行同时完成 Task 与重合的 Independent Verification Scope，避免机械重复 Integration / E2E。
- OpenSpec Native Verify 继续是 Change-level Artifact-to-Implementation verification；`verify_agent.required=true` 时由 Verify Agent 执行或复用，`false` 时不默认强制。

---

## v1.1 变更摘要

- 对齐 OpenSpec Schema Implementation：`bug-analysis` 明确为 Method / Project Skill，不再产生同名 Artifact；Analysis 中确认的 Root Cause / Fix / Regression Contract 进入 Corrective `proposal.md`。
- OpenSpec Ownership 删除独立 AC / Verification Requirements 与 Bug Analysis Artifact，改为 Requirement / Scenario、Corrective Proposal、Implementation / Verification Tasks 与 Evidence。
- `tdd` 输入改为 Intentional Requirement / Scenario 或 Corrective Expected Behavior / Regression Scope + 当前 Task Verification。
- `verification-before-completion` 明确为 fresh-evidence Method，可由 Engineer / Verify Skill 复用，不等于 Verify Agent，也不决定 `verify_agent.required`。
- Method Result Persistence 明确：completion evidence 根据执行上下文进入 Development Evidence（研发证据） 或 Independent Verification Report；不创建 `acceptance.md` / `verification-requirements.md`。
- 新增 Change-level Verification 验收场景：只有组合行为无法由单 Task 证明时才在 `tasks.md` 增加 Verification Task，执行者可为 Engineer / CI / Verify Agent。
- 不修改 Method Dispatcher / Runtime Ownership 原则，不引入全局 Method Registry。
