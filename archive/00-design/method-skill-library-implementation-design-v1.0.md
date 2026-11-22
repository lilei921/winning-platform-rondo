# Method Skill Library Implementation Design v1.0

> Status: Implementation Baseline  
> Scope: Internal engineering method modules used by Project Skills  
> Related baseline: `multica-squad-centric-delivery-v1.4.15.md`, `workitem-analyst-stage-design-v1.14.md`, `engineer-development-stage-design-v1.10.md`, `multica-design-guideline-v1.10.md`

---

# 1. Purpose

本方案定义 Project Skills 如何内置、调用和治理可复用 Engineering Methods。

核心模型：

```text
Multica
= Delivery Runtime Owner

OpenSpec
= Engineering Contract Owner

Project Skill
= Stage Entry + Context + Policy + Method Dispatch

Internal Method Module
= Reusable Engineering Method
```

核心原则：

> **Method 是 Project Skill 的内部实现模块，不是独立 Runtime Skill。**

第三方 Matt / Superpowers 内容不作为 Multica Agent 可独立发现、独立调用或接管流程的 Skill 暴露。

---

# 2. Why Internal Method Modules

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

因此 Method 的调用权必须属于 Project Skill。

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

# 3. Ownership

## 3.1 Multica

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

## 3.2 OpenSpec

Owns：

```text
Proposal
Specs
Design
Bug Analysis
AC
Verification Requirements
Tasks
Change-specific Engineering Truth
```

## 3.3 Project Skill

Owns：

```text
Stage procedure
Context assembly
Method selection
Method invocation
Project constraints
Truth persistence
Stop / escalation
```

## 3.4 Internal Method Module

Owns only：

```text
how to perform one engineering method
```

Method 不直接：

```text
assign
change Multica status
create Sub-Issue
choose Route
archive Change
merge PR
create another workflow
dispatch hidden agents
```

---

# 4. Physical Structure

## 4.1 Development

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

## 4.2 Corrective Analysis

```text
bug-analysis/
├── SKILL.md
├── methods/
│   ├── diagnosing-bugs.md
│   └── systematic-debugging.md   # optional supplement
├── references/
├── scripts/
└── tests/
```

Method 文件不是 Workspace/Agent 对外 Skill：

```text
没有独立 Skill registration
没有独立 Agent binding
没有独立 Multica entry
```

只有父 Project Skill 可以读取并调用。

---

# 5. Method Implementation Modes

只保留两种实现模式。

## 5.1 Vendored

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

## 5.2 Project-native

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

# 6. Initial Method Decisions

| Method Capability | Source | Mode | Parent Skill | Reason |
|---|---|---|---|---|
| `diagnosing-bugs` | Matt | Project-native | `bug-analysis` / Development escalation | 原方法有自己的触发与 handoff；项目只需要 feedback → hypothesis → evidence → root cause → regression discipline |
| `systematic-debugging` | Superpowers | Project-native supplement | `bug-analysis` | 只保留 no-guess / evidence-first / root-cause discipline，不采用其 workflow ownership |
| `tdd` | Matt | Project-native | `development-execution` | 原方法包含 seam confirmation 与外部方法依赖；项目必须从 approved OpenSpec AC/VR 与当前 task_refs 驱动 |
| `codebase-design` | Matt | Vendored | `development-execution` | 当前上游主要是 vocabulary/reference，适合作为内部 reference method |
| `code-review` | Matt | Project-native | `development-execution` | 保留 Standards + Spec 双轴；删除 subagent topology 与外部 spec discovery |
| `verification-before-completion` | Superpowers | Project-native | `development-execution` / Verify | 核心纪律简单：completion claim 必须有 fresh evidence |

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

# 7. Method Module Contract

每个 `methods/*.md` 使用相同最小结构：

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

# 8. Source Governance

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

# 9. Dispatch Ownership

父 Project Skill 是唯一 Method Dispatcher。

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

`bug-analysis/SKILL.md`：

```text
Known defect
→ methods/diagnosing-bugs.md

Repeated failed fixes / weak causal evidence
→ methods/systematic-debugging.md
```

内部 Method 不得自主：

```text
dispatch another Method
dispatch another Agent
create another workflow
```

需要其他 Method 时返回建议给父 Skill，由父 Skill决定。

---

# 10. `diagnosing-bugs` Module

## Purpose

形成可靠 Root Cause，而不是根据症状直接修改。

## Inputs

```text
problem / symptom
expected behavior
actual behavior
code / runtime context
existing evidence
approved scope
```

## Method

```text
1. Establish a reproducible feedback signal when feasible
2. Minimise the failing path
3. Form evidence-backed hypotheses
4. Instrument / inspect discriminating evidence
5. Identify root cause
6. Define regression signal
7. Produce fix-oriented findings
```

## Output

```text
reproduction / feedback_signal
hypotheses_tested
root_cause
evidence_refs
regression_signal
unresolved
```

父 Skill 决定这些内容写入 `bug-analysis.md` 还是只作为 Development finding。

## Constraints

```text
no route change
no Multica mutation
no hidden agent
no direct scope expansion
no production-code fix before sufficient causal evidence
```

---

# 11. `tdd` Module

## Purpose

对适合自动测试的具体行为进行小步 test-first 实现。

## Inputs

```text
assigned task_refs
relevant Spec / Bug Analysis
AC / Verification Requirements
current code scope
current test conventions
```

## Method

```text
1. Determine observable behavior and test seam from approved contract
2. Establish RED
3. Implement minimum GREEN
4. Continue one behavior / vertical slice at a time
5. Keep tests behavior-oriented
6. Perform safe implementation cleanup when needed
```

测试 seam 优先从 approved Spec / Design / current code contract 推导；只有无法可靠确定且会影响正确性时才升级，不把每次人工确认作为硬前置。

## Output

```text
tests_changed
implementation_changed
red_evidence
green_evidence
remaining_risks
```

## Constraints

```text
do not redefine expected behavior
do not expand approved scope
do not create another plan
do not commit/push as part of the Method itself
```

---

# 12. `codebase-design` Module

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

# 13. `code-review` Module

## Purpose

对当前候选实现进行两个独立维度的审查：

```text
Standards
Spec / Contract
```

## Inputs

```text
fixed_point / approved baseline
current diff
project standards
approved OpenSpec refs
assigned task_refs
```

## Method

```text
1. Fix the review baseline
2. Review repository/project standards compliance
3. Review approved OpenSpec contract compliance
4. Record findings independently by axis
5. Identify blocking findings
```

不使用第三方默认的 parallel subagent topology；并行与 Agent 调度归 Multica / Project Skill。

## Output

```text
baseline
standards_findings
spec_findings
blocking_findings
```

## Constraints

```text
read/review only by default
no hidden subagent
no issue creation
no scope expansion
no spec discovery outside approved OpenSpec refs unless parent Skill requests context lookup
```

---

# 14. `verification-before-completion` Module

## Purpose

任何 PASS / completed claim 必须由当前候选版本的 fresh evidence 支撑。

## Inputs

```text
claim
Verification Requirements
required checks
current candidate version
```

## Method

```text
1. Identify evidence required for the claim
2. Execute or read the current required checks
3. Confirm results belong to the current candidate
4. Reject stale / inferred success
5. Return supported and unsupported claims
```

## Output

```text
checks
evidence_refs
failed_checks
supported_claims
unsupported_claims
```

Method 不替代 Verify Agent；它只约束 completion claim 的证据标准。

---

# 15. Method Effects and Permissions

实际工具权限由 Parent Agent / Project Skill 控制。

Method 文件只声明允许/禁止的工程副作用。

Baseline：

| Method | Code Write | Test Write | Command Run | OpenSpec Write | Multica Mutation | Hidden Agent |
|---|---:|---:|---:|---:|---:|---:|
| diagnosing-bugs | diagnostic only | yes, when useful | yes | no direct persistence | no | no |
| systematic-debugging | diagnostic only | optional | yes | no | no | no |
| tdd | yes | yes | yes | no direct contract mutation | no | no |
| codebase-design | no by itself | no | optional read | no | no | no |
| code-review | no by default | no | read/check | no | no | no |
| verification-before-completion | no implementation mutation | no | yes | no | no | no |

父 Skill 持有最终权限与持久化责任。

---

# 16. Method Result Persistence

Method Output 不自动成为 Artifact。

父 Skill 根据 Truth Ownership 决定：

```text
diagnosing-bugs root cause
→ bug-analysis.md

TDD implementation/test changes
→ code repository

code-review findings
→ Development Review Result / Evidence

completion verification evidence
→ Development Evidence / Verify Result
```

不创建：

```text
tdd-result.md
debugging-result.md
method-result.json
method-run state
```

除非某类 Evidence 本身有长期保存必要。

---

# 17. Failure / Stop Contract

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

# 18. No Global Method Registry in v1

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
大量 Project Skills 共用同一可变路由
```

---

# 19. Project Skill Integration

## 19.1 `bug-analysis`

负责：

```text
context
corrective policy
method dispatch
write OpenSpec bug-analysis
stop / escalation
```

内部使用：

```text
diagnosing-bugs
systematic-debugging（按需）
```

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

Verify 可以复用 completion evidence discipline，但不直接继承 Engineer 的实现方法或执行上下文。

---

# 20. Acceptance Tests

至少用以下场景验证。

## Case A — Straightforward Intentional Change

```text
development-execution
→ tdd
→ code-review
→ verification-before-completion
```

无 Method 获得 Runtime ownership。

## Case B — Corrective Root Cause

```text
bug-analysis
→ diagnosing-bugs
→ bug-analysis.md
```

Method 不创建独立分析 Artifact。

## Case C — Hard Repeated Bug

```text
diagnosing-bugs evidence insufficient
→ parent Skill selects systematic-debugging supplement
```

不是 Method 自己跳转。

## Case D — Code Review

验证：

```text
approved OpenSpec = Spec axis source
project standards = Standards axis source
no hidden subagent
no external issue/spec guessing
```

## Case E — Upstream Skill Changes

上游 Matt/Superpowers 更新。

期望：

```text
project behavior unchanged
until manual Review updates internal Method
```

## Case F — Forbidden Workflow Behavior

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

# 21. Implementation Deliverables

第一批：

```text
bug-analysis/
└── methods/
    ├── diagnosing-bugs.md
    └── systematic-debugging.md

development-execution/
└── methods/
    ├── tdd.md
    ├── codebase-design.md
    ├── code-review.md
    └── verification-before-completion.md
```

然后更新：

```text
bug-analysis/SKILL.md
development-execution/SKILL.md
engineer-development-stage-design
```

使它们只引用内部 Method，不再把 Matt/Superpowers 作为同级 Runtime Skill。

---

# 22. External Method Notes

当前 Matt `tdd` 明确把自己描述为 reference rather than driver；`codebase-design` 也是 reference，而 `code-review` 当前实现包含 parallel sub-agents。这进一步支持本项目采用“内部 Method Module + Project Skill 驱动”的结构，而不是直接暴露第三方 workflow Skill。

Reference:
- https://github.com/mattpocock/skills
- https://github.com/mattpocock/skills/blob/main/docs/engineering/tdd.md
- https://github.com/mattpocock/skills/blob/main/docs/engineering/code-review.md
- https://github.com/mattpocock/skills/blob/main/docs/engineering/diagnosing-bugs.md
- https://github.com/mattpocock/skills/blob/main/docs/engineering/codebase-design.md
