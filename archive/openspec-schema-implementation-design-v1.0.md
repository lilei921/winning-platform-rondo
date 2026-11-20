# OpenSpec Schema Implementation Design v1.0

> Status: Implementation Baseline  
> Scope: Project-level OpenSpec Schema, Templates, Task Contract and lifecycle integration  
> Related baseline: `multica-squad-centric-delivery-v1.4.15.md`, `workitem-analyst-stage-design-v1.14.md`, `engineer-development-stage-design-v1.10.md`, `multica-design-guideline-v1.10.md`

---

# 1. Purpose

本方案是项目 OpenSpec Engineering Contract 的实施级权威设计。

它直接用于实现：

```text
openspec/schemas/corrective-change/
openspec/schemas/intentional-change/
OpenSpec Change 创建与读取
Artifact Templates
Task Identity / task_refs
Task Progress 更新
Apply Context
Artifact 写权限
Validation / Archive
```

核心边界：

> **OpenSpec = Engineering Truth**  
> **Multica = Delivery Truth**

OpenSpec Schema 不负责 Multica Route、Status、Assignment、Human Approval、Agent / Squad 调度、PR 状态或 Runtime Projection。

---

# 2. Implementation Principles

## 2.1 Schema 表达 Engineering Contract

Schema 负责：

```text
Artifact 类型
Artifact dependency
Artifact output path
Artifact template
Artifact instruction
Apply prerequisites
Tracked task file
```

不使用 Schema 表达 Delivery Workflow。

## 2.2 Explicit Contract over Implicit Assumption

项目要求为硬约束的 Artifact，显式列入 `apply.requires`。

`artifact.requires` 用于 Artifact 构建依赖；`apply.requires` 用于实现阶段准入。两者职责不同。

## 2.3 No Parallel Truth

以下事实只有一个 Owner：

```text
Expected Behavior / Scenario / AC / Verification Requirements
→ Specs（Intentional）
→ Bug Analysis（Corrective）

Root Cause / Fix Strategy
→ Bug Analysis

Technical Design
→ Design（Intentional）
→ Corrective Supporting Design（按需）

Implementation Checklist / Progress
→ tasks.md
```

Multica 仅保存必要引用和 Runtime Facts。

## 2.4 Task Progress Is Not Runtime State

```text
Multica
= running / blocked / retry / owner / run history

tasks.md
= planned engineering work + completed engineering work
```

不把 `tasks.md` 当作实时运行面板。

---

# 3. Canonical Mapping

```text
change_kind = corrective
→ schema = corrective-change
→ route = bug-fix | production-fix

change_kind = intentional
→ schema = intentional-change
→ route = sdd-fast
```

约束：

- Schema 由 Technical Change Kind 决定；
- TFS Type、Route、Repository 数量、PR 数量不决定 Schema；
- 一个 Delivery Issue 默认对应一个 active OpenSpec Change；
- Change ID 在首次 Preparation 时确定；
- 后续 Analysis Rework / Development Rework 使用同一个 Change；
- Schema 不在不同 Agent / Run 中重新选择。

---

# 4. Project Layout

```text
openspec/
├── schemas/
│   ├── corrective-change/
│   │   ├── schema.yaml
│   │   └── templates/
│   │       ├── bug-analysis.md
│   │       ├── proposal.md
│   │       ├── spec.md
│   │       └── tasks.md
│   │
│   └── intentional-change/
│       ├── schema.yaml
│       └── templates/
│           ├── proposal.md
│           ├── spec.md
│           ├── design.md
│           └── tasks.md
│
└── changes/
    └── <change-id>/
        ├── .openspec.yaml
        └── ...
```

Schema 以 Project 级版本为准。执行前使用安装版本 CLI 确认实际解析来源，不允许用户级同名 Schema 静默覆盖项目 Contract。

---

# 5. Change Identity Contract

每个自动 Route 的 Delivery 默认只有一个 active Change。

最小身份：

```yaml
change_ref:
  id: <stable-change-id>
  path: openspec/changes/<stable-change-id>
  schema: corrective-change | intentional-change
```

规则：

1. 创建前先检查是否已有唯一 active Change；
2. 0 个 → 创建；
3. 1 个 → 复用；
4. 多个候选或无法唯一对应 → `UNKNOWN`，停止创建；
5. Analysis Reject、Development Rework 不创建平行 Change；
6. Archive 不改变 Change ID；
7. Runtime Projection 只引用 Change，不复制 Change 内容。

`.openspec.yaml` 至少持有当前 Schema；Corrective 无 Spec-level change 时显式记录 `skip_specs: true`。

---

# 6. `intentional-change` Schema

## 6.1 Artifact Graph

```text
             proposal
             /      \
         specs      design
             \      /
              tasks
                |
              apply
```

## 6.2 Artifact Ownership

| Artifact | Output | Owns |
|---|---|---|
| `proposal` | `proposal.md` | Why、Goal、Scope、Capabilities、Impact |
| `specs` | `specs/<capability>/spec.md` | Expected Behavior、Rules、Scenarios、AC、Verification Requirements |
| `design` | `design.md` | Approach、Technical Decisions、Contracts/Data、Dependencies、Risks、Compatibility |
| `tasks` | `tasks.md` | Implementation checklist、developer-side validation tasks、task progress |

## 6.3 Executable Schema Baseline

```yaml
name: intentional-change
version: 1
description: Intentional behavior change contract

artifacts:
  - id: proposal
    generates: proposal.md
    description: Change intent, scope and impact
    template: proposal.md
    instruction: |
      Describe why the change is needed, the approved goal and scope,
      affected capabilities, and expected impact.
      Do not duplicate detailed behavior, design or implementation tasks.
    requires: []

  - id: specs
    generates: specs/**/*.md
    description: Delta specifications for intended behavior changes
    template: spec.md
    instruction: |
      Define changed expected behavior, rules, scenarios,
      acceptance criteria and verification requirements.
      Do not describe implementation details.
    requires:
      - proposal

  - id: design
    generates: design.md
    description: Technical design for the approved behavior change
    template: design.md
    instruction: |
      Define the implementation approach, technical decisions,
      contracts/data, dependencies, compatibility and relevant risks.
      Keep depth proportional to complexity.
    requires:
      - proposal

  - id: tasks
    generates: tasks.md
    description: Trackable implementation checklist
    template: tasks.md
    instruction: |
      Break the approved specs and design into implementation tasks.
      Every task must have a stable project task id.
      Do not include Multica assignment, status, PR or delivery workflow.
    requires:
      - specs
      - design

apply:
  requires:
    - proposal
    - specs
    - design
    - tasks
  tracks: tasks.md
  instruction: |
    Implement only the assigned task_refs within the approved change.
    Read the relevant context files and preserve approved behavior.
```

项目语义：

```text
Specs = required
Design = required
skip_specs = not allowed for normal sdd-fast
```

Required 不等于 Heavy。简单 Change 的 `design.md` 可以很短，但必须包含真实技术决策。

---

# 7. `corrective-change` Schema

## 7.1 Artifact Graph

```text
bug-analysis
      |
   proposal
      |
 specs / skipped
      |
    tasks
      |
    apply
```

## 7.2 Artifact Ownership

| Artifact | Output | Owns |
|---|---|---|
| `bug-analysis` | `bug-analysis.md` | Expected/Actual、Reproduction/Failure Path、Root Cause/Evidence、Fix Strategy、Fix/Regression Scope、AC、Verification Requirements |
| `proposal` | `proposal.md` | Why fix、Fix scope summary、Impact、Spec relation |
| `specs` | `specs/<capability>/spec.md` | 需要长期补录/澄清的既定行为 |
| `tasks` | `tasks.md` | Fix implementation checklist、developer-side regression/validation tasks、task progress |

## 7.3 Executable Schema Baseline

```yaml
name: corrective-change
version: 1
description: Corrective change contract with root-cause-first analysis

artifacts:
  - id: bug-analysis
    generates: bug-analysis.md
    description: Root cause, fix and verification contract
    template: bug-analysis.md
    instruction: |
      Establish expected versus actual behavior, reproducible failure path
      when available, root cause with evidence, fix strategy, fix/regression
      scope, acceptance criteria and verification requirements.
    requires: []

  - id: proposal
    generates: proposal.md
    description: Concise corrective change manifest
    template: proposal.md
    instruction: |
      Summarize why the defect must be fixed, change scope and impact,
      and reference the bug analysis. Do not duplicate root cause or AC/VR.
    requires:
      - bug-analysis

  - id: specs
    generates: specs/**/*.md
    description: Delta specifications only when established behavior needs durable clarification
    template: spec.md
    instruction: |
      Record only proven existing behavior that requires durable specification.
      Do not invent a behavior change to satisfy the schema.
    requires:
      - proposal

  - id: tasks
    generates: tasks.md
    description: Trackable corrective implementation checklist
    template: tasks.md
    instruction: |
      Break the approved fix strategy into implementation and regression tasks.
      Every task must have a stable project task id.
      Do not include Multica assignment, status, PR or delivery workflow.
    requires:
      - specs

apply:
  requires:
    - bug-analysis
    - proposal
    - specs
    - tasks
  tracks: tasks.md
  instruction: |
    Implement only the assigned task_refs according to the approved
    root cause, fix strategy and verification requirements.
```

## 7.4 Specs Decision

```text
Existing spec already correct
→ skip_specs: true

Investigation proves missing/unclear existing constraint
→ create delta spec
→ remain corrective

Expected behavior cannot be proven
→ STOP / clarification

Desired behavior changes
→ STOP corrective
→ reclassify intentional
→ Human Review
```

`skip_specs: true` 是显式 Change metadata。运行时必须通过 OpenSpec status / instructions 确认 `specs` 为 skipped；不得仅因文件不存在自行推断。

本地验收必须确认当前安装版本中 skipped `specs` 可满足 artifact dependency 和 `apply.requires`。

---

# 8. Template Contracts

## 8.1 `bug-analysis.md`

```markdown
# Bug Analysis

## Problem
### Scenario
### Expected Behavior
### Actual Behavior

## Reproduction / Failure Path

## Root Cause
- Status: confirmed | probable | unknown
- Summary:
- Evidence:
- Rejected hypotheses: (optional)

## Fix Strategy

## Scope
### Fix Scope
### Regression Scope
### Repository / Module Impact

## Acceptance Criteria

## Verification Requirements

## Supporting Evidence References
```

要求：

- Root Cause 不得只写 symptom；
- Evidence 可追溯；
- Fix Strategy 对应 Root Cause；
- AC 定义修复后正确结果；
- Verification Requirements 定义必须证明的行为和证据。

## 8.2 Intentional `proposal.md`

```markdown
# Proposal

## Why
## Goal
## Scope
### In Scope
### Out of Scope

## Capabilities
## Impact
## Open Decisions
```

Proposal 不保存完整行为规则、详细设计或任务列表。

## 8.3 Corrective `proposal.md`

```markdown
# Proposal

## Why
## What Changes
## Impact
## Bug Analysis
## Specification Relation
```

保持 Change Manifest 角色。

## 8.4 `spec.md`

规格文件负责：

```text
Requirement / Behavior
Business / Contract Rules
Normal Scenario
Boundary Scenario
Error Scenario
Acceptance Criteria
Verification Requirements
```

AC / Verification Requirements 与当前 capability/scenario 对齐，不复制到 Design / Tasks。

## 8.5 `design.md`

```markdown
# Design

## Approach
## Technical Decisions
## Contracts / Data
## Dependencies
## Compatibility / Migration
## Risks
## Verification Considerations
```

简单 Change 允许省略不适用章节正文，但不得用空模板代替真实 Design。

## 8.6 `tasks.md`

建议格式：

```markdown
# Tasks

## Backend

- [ ] [T-001] Implement cancellation endpoint.
- [ ] [T-002] Enforce valid state transition.
- [ ] [T-003] Add regression tests for cancellation.

## Frontend

- [ ] [T-004] Add cancellation action.
- [ ] [T-005] Render cancelled state.

## Validation

- [ ] [T-006] Run required integration validation.
```

---

# 9. Task Identity Contract

## 9.1 Task ID

Task ID 格式：

```text
T-001
T-002
...
```

规则：

- ID 在单个 Change 内唯一；
- 正式引用必须与 `change_ref` 成对使用；
- ID 创建后不重编号；
- 新增 Task 使用新的 ID；
- 已被 Runtime Projection 引用的 ID 不复用；
- Task Group / Markdown 顺序可调整，但 ID 保持不变。

Runtime 交接：

```yaml
change_ref: <change-id>
task_refs:
  - T-001
  - T-002
```

`Task Set` 只是这组 `task_refs` 的描述，不拥有独立 ID、Status 或 Lifecycle。

## 9.2 Task Mutation

允许：

```text
在批准边界内细化描述
增加实现细节
增加新的 Task ID
```

涉及以下变化必须回到相应 Review 边界：

```text
Expected Behavior 改变
AC / Verification Requirements 改变
Root Cause / Fix Strategy 实质改变
Approved Scope 实质扩大
```

不再需要执行的 Task 不静默删除；保持 ID 可追溯，并以明确的 superseded / no-longer-required 说明收口。对应 Change 必须有可追溯的批准依据。

---

# 10. Task Progress Update

## 10.1 Default Model

不建立 Task Completion Store，不建立中央 Writer Agent，不保存中间 completion artifact。

默认：

```text
Engineer Run
→ 执行 assigned task_refs
→ Local Validation / Code Review
→ Development Completion Check
→ deterministic task patch
→ 直接更新 tasks.md
```

## 10.2 Deterministic Patch

建议提供：

```text
scripts/update-task-progress.py
```

输入：

```text
change_ref
task_refs
expected_action = complete
```

Procedure：

```text
读取最新 tasks.md
→ 解析 [T-xxx]
→ 校验 task_refs 存在且唯一
→ 校验只修改当前 task_refs
→ 将对应 checkbox [ ] → [x]
→ 原子写文件
→ 回读确认
```

脚本不判断任务是否“语义上完成”；完成判断来自 Development Completion Check。脚本只做确定性文件变更。

## 10.3 Optimistic Concurrency

不建设锁服务。

写入前总是读取最新 `tasks.md`。

若文件在提交前发生变化：

```text
重新读取最新版本
→ 重新定位当前 task_refs
→ 重放本次 checkbox patch
```

如果其他修改不涉及当前 `task_refs`，允许继续。

如果同一个 Task ID 出现：

```text
重复修改
状态冲突
Task 缺失
Task ID 重复
Task 内容发生不可解释变化
```

返回 `FAIL` / `UNKNOWN`，不覆盖。

## 10.4 Update Frequency

`tasks.md` 不承担实时进度。

默认只在当前 Engineer Run 的 Task Set 满足 Development Completion Check 后批量更新一次。

---

# 11. Artifact Write Permission Matrix

| Artifact | Analysis | Development | Verify | Archive |
|---|---|---|---|---|
| `bug-analysis.md` | Write | Read；发现结论问题则停止并升级 | Read | Preserve |
| `proposal.md` | Write | Read | Read | Preserve |
| `specs` | Write | 默认 Read；行为/AC/VR 变化必须回 Review | Read | Apply/Archive |
| `design.md` | Write | 可在批准边界内细化 implementation detail | Read | Preserve |
| `tasks.md` task body | Write | 可在批准边界内细化/增加 Task | Read | Preserve |
| `tasks.md` checkbox | Initial | 通过 deterministic patch 更新 assigned task_refs | Read | Must be complete |

Engineer 对 Design / Tasks 的细化不能改变批准的 Engineering Contract。

---

# 12. Apply Context Contract

Development 启动时至少取得：

```text
change_ref
schema
assigned task_refs
OpenSpec apply contextFiles
approved baseline reference
relevant Supporting Evidence references
```

Intentional 必须可读取：

```text
proposal
specs
design
tasks
```

Corrective 必须可读取：

```text
bug-analysis
proposal
tasks
specs（done 时）
```

Specs skipped 时不得伪造文件。

额外 Supporting Design / Evidence 不属于 Schema Artifact 时，必须由稳定引用显式交接。

---

# 13. Supporting Evidence

只有后续阶段必须长期读取、且不适合写入现有 Artifact 正文的内容才作为 Supporting Artifact / Reference。

典型内容：

```text
large logs
external documents
database evidence
performance traces
complex corrective design
```

原则：

```text
Reference, not Replication
```

外部原始资料不为“放在 Change 目录”而复制一份正文。

---

# 14. Validation Contract

Schema 实现后必须通过：

```text
openspec schema which
openspec schema validate
openspec templates --json
openspec status --change <id> --json
openspec instructions <artifact> --change <id> --json
openspec instructions apply --change <id> --json
openspec validate <id> --strict --json
```

注意：Schema 命令在 OpenSpec 当前文档中仍标记为 experimental；项目必须锁定安装版本，并以该版本 CLI Contract 为准。

---

# 15. Acceptance Cases

## Case A — Corrective / no spec delta

期望：

```text
bug-analysis = done
proposal = done
specs = skipped
tasks = done
apply = ready
```

验证 `skip_specs` 同时满足 dependency 与 `apply.requires`。

## Case B — Corrective / spec clarification

```text
bug-analysis
proposal
delta spec
tasks
apply
```

Archive 后长期规格正确更新。

## Case C — Intentional / small change

```text
proposal
spec
short but real design
tasks
apply
```

Design 不允许空模板。

## Case D — Cross-repository Intentional

同一个 Change：

```text
Backend task_refs
Frontend task_refs
multiple PRs
```

Repository 数量不改变 Schema。

## Case E — Multi-Engineer Task Progress

```text
Backend Run → T-001,T-002
Frontend Run → T-004,T-005
```

两个 Run 可以并行执行；各自收口时直接 deterministic patch 最新 `tasks.md`；无中间 completion store。

## Case F — Same-task Conflict

两个 Runtime 同时引用 `T-002`。

期望：

```text
不得 silent overwrite
→ FAIL / UNKNOWN
→ Delivery Lead 协调
```

## Case G — Task Mutation

运行中新增 `T-007` 或某 Task 被 superseded。

验证：

- 旧 `task_refs` 可追溯；
- Task ID 不重用；
- Scope/Contract 变化按 Review 规则处理。

---

# 16. Archive Contract

Archive 前至少满足：

```text
required OpenSpec validation PASS
tasks.md 无 pending required tasks
必要 Verify / PR Delivery conditions 已由 Multica 满足
```

Intentional：

```text
按 OpenSpec archive 语义处理 Delta Specs
```

Corrective：

```text
有 Delta → 按 OpenSpec archive 处理
skip_specs → 不制造规格变化
```

Archive 只处理 Engineering Artifact 生命周期；Delivery Issue 最终状态仍由 Multica 主方案控制。

---

# 17. Schema Evolution

Schema 修改遵循：

```text
新 Change
→ 使用当前项目 Schema

Active Change
→ 默认保持创建时 Schema 语义
```

影响 active Change 的 Schema 结构变更必须经过兼容性验证，不进行静默迁移。

至少验证：

```text
schema validate
status
instructions
apply context
task tracking
archive
```

---

# 18. Implementation Deliverables

第一批实施资产：

```text
openspec/schemas/corrective-change/schema.yaml
openspec/schemas/corrective-change/templates/*
openspec/schemas/intentional-change/schema.yaml
openspec/schemas/intentional-change/templates/*
scripts/update-task-progress.py
tests/schema/
```

完成上述资产与 Acceptance Cases 后，再修改 Workitem Analyst / Engineer / Verify Skills。

---

# 19. External Contract Notes

当前 OpenSpec 官方 Schema Contract 明确区分：

```text
artifact.requires
= planning dependency

apply.requires
= artifacts required before apply is ready

apply.tracks
= Markdown checkbox task tracking file
```

`skip_specs: true` 会使 Specs 处于 skipped 状态并满足依赖；项目仍需在锁定的本地 OpenSpec 版本上验证其与 `apply.requires` 的组合行为。

Reference:
- https://openspec.dev/docs/schemas/schema-yaml
- https://github.com/Fission-AI/OpenSpec/blob/main/docs/agent-contract.md
- https://github.com/Fission-AI/OpenSpec/blob/main/docs/cli.md
