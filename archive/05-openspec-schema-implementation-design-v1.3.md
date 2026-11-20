# OpenSpec Schema Implementation Design v1.3

> Status: Implementation Baseline — Verification Model Convergence  
> OpenSpec Runtime Baseline: `1.13.2`  
> Scope: Project-level OpenSpec Schema, Templates, Task Contract and lifecycle integration  
> Related baseline: `02-multica-squad-centric-delivery-v1.4.17.md`, `03-workitem-analyst-stage-design-v1.15.md`, `04-engineer-development-stage-design-v1.12.md`, `01-multica-design-guideline-v1.11.md`

---

# 0. Implementation Review Status

本版本在 v1.2 基础上继续收敛 Verification Executor 与 OpenSpec Native Verify 的责任边界。继续坚持 OpenSpec 原生 `Requirement / Scenario / tasks / verify` 语义，不创建平行 AC / VR Identity；Change-level Verification Task 保持角色无关，由 Multica 选择 Runtime Executor，Verify Agent 仅在独立验收需要时参与。

| ID | Priority | Review Item | v1.3 Status | Current Decision |
|---|---|---|---|---|
| `P0-1` | P0 | OpenSpec 版本基线 | **Resolved** | 固定 `OpenSpec 1.13.2`，所有 Schema / CLI / Validation / Archive 测试以该版本为实施基线 |
| `P0-2` | P0 | OpenSpec 原生 Template Contract 粒度不足 | **Pending Discussion** | Artifact 边界已收敛；最终 `proposal.md` / Delta Spec / `tasks.md` 的 parser-level Markdown Contract 待专项细化 |
| `P0-3` | P0 | AC / Verification Requirements 缺少稳定 Identity Contract | **Resolved by Native Model** | 不再设计 `AC-xxx` / `VR-xxx` 平行 Identity；有 Specs 时以 Requirement + Scenario 作为 Acceptance Contract，验证执行要求进入 `tasks.md` |
| `P0-4` | P0 | Change Identity 的查找、创建、恢复不够确定 | **Resolved** | 参考 monorepo `fire-router.py`：只读 deterministic resolver、active-first、archive fallback、冲突/损坏不猜测、create-after-NOT_FOUND、可从部分失败恢复 |
| `P0-5` | P0 | 并行 Engineer 更新共享 `tasks.md` 可能 lost update | **Resolved** | Engineer 可并行实现，但 checkbox 持久化通过 change-scoped single-writer critical section 串行执行；批准后冻结 top-level Task Identity |
| `P1-1` | P1 | OpenSpec Apply Context 与 Project Development Context 边界 | Open | 后续专项讨论；当前 §13 继续作为接口基线 |
| `P1-2` | P1 | Archive 与 `finalize-delivery` 的实施接口偏薄 | Open | 后续只补 Integration Contract，不复制 Delivery 主方案状态机 |
| `P1-3` | P1 | Validation 负向 / 恢复测试覆盖不足 | Open | 在 P0-2 定稿后统一补 parser-level 与负向测试矩阵 |
| `P2-1` | P2 | Schema Evolution 可能引入不必要迁移复杂度 | Open | 后续讨论是否收缩为 v1 schema freeze / breaking change 禁止策略 |
| `P2-2` | P2 | Artifact Write Permission 与阶段方案存在规则重复 | Open | 后续按 One Rule, One Owner 评审是否进一步收缩 |

当前实施顺序：

```text
已固化
→ P0-1 Runtime Baseline
→ P0-3 Native Acceptance / Verification Model
→ P0-4 Change Identity Resolver
→ P0-5 Task Progress Serialization

继续专项讨论
→ P0-2 Native Template Contract
```

P0-2 未定稿前，不实现依赖最终 Markdown grammar 的强校验器，不用临时格式形成新的兼容负担。

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
Intentional Expected Behavior / Requirement / Scenario
→ Specs

Corrective Expected / Actual / Root Cause / Fix Strategy / Regression Scope
→ Corrective proposal.md

Technical Design
→ Design（Intentional）
→ Corrective Supporting Design（按需）

Implementation Checklist / Verification Tasks / Task Progress
→ tasks.md
```

项目不再维护独立 `AC-xxx` / `VR-xxx` Truth：

- 有 Specs 时，OpenSpec `Requirement + Scenario` 构成 Acceptance Contract；
- 每个 Implementation Task 的验证方式写在该 Task 中；
- 必须跨 Task / Module / Repository / User Journey 才能完成的验证，作为同一 `tasks.md` 中的 Change-level Verification Task；
- 是否需要独立 Verify Agent 属于 Multica Delivery Policy，不属于 OpenSpec Engineering Truth。

Multica 仅保存必要引用、执行者选择和 Runtime Facts。

## 2.4 Task Progress Is Not Runtime State

```text
Multica
= running / blocked / retry / owner / run history

tasks.md
= planned engineering work + completed engineering work
```

不把 `tasks.md` 当作实时运行面板。

## 2.5 Runtime Baseline

当前实施版本固定：

```text
OpenSpec = 1.13.2
```

约束：

- `schema.yaml`、Templates、`skip_specs`、`artifact.requires`、`apply.requires`、`apply.tracks`、Validation 与 Archive 行为均以 `1.13.2` 为准；
- 实现与 CI / 本地 Acceptance Test 必须先确认 `openspec --version` 为 `1.13.2`；
- `openspec schema which` 必须解析到当前 Project 的 `openspec/schemas/...`，不得被用户级同名 Schema 静默覆盖；
- OpenSpec 升级属于显式工程变更，必须重新执行 Schema / Apply / Archive 回归，不允许执行环境自行漂移到其他版本；
- 本方案不为多个 OpenSpec 版本同时维护兼容分支。

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

scripts/
├── resolve-openspec-change.py
└── update-task-progress.py

tests/
├── schema/
├── change-identity/
└── task-contract/
```

Schema 以 Project 级版本为准。执行前必须同时确认 OpenSpec 版本为 `1.13.2` 且 `schema which` 解析到项目级 Schema，不允许用户级同名 Schema 静默覆盖项目 Contract。

---

# 5. Change Identity Contract

每个自动 Route 的 Delivery 默认只有一个 active OpenSpec Change。

正常关联事实由 Multica 保存，OpenSpec 不增加第二份 Delivery Mapping：

```yaml
analysis:
  change_ref:
    id: <stable-change-id>
    path: openspec/changes/<stable-change-id>
    schema: corrective-change | intentional-change
```

`.openspec.yaml` 只保存 OpenSpec 自身需要的 Change / Schema metadata；不得为了 Change 查找把 Multica Status、Assignment、Review 或 Runtime State 复制进去。

## 5.1 Change ID Convention

新建自动 Route Change 时，默认 Change ID 使用：

```text
<semantic-slug>-<tfs-id>
```

例如：

```text
datasource-duplicate-optimize-244432
```

其中 TFS ID 后缀只承担稳定外部身份锚点和恢复查找能力：

```text
TFS ID
≠ Technical Change Kind
≠ Route
≠ Schema
```

Change ID 首次创建后保持稳定；Analysis Rework、Development Rework 不重命名、不新建平行 Change。Archive 改变存放路径时不改变逻辑 Change ID。

## 5.2 Deterministic Resolver

提供只读确定性脚本：

```text
scripts/resolve-openspec-change.py
```

设计参考历史 `fire` 分支中 `fire-router.py` 的查找原则，但只解决 OpenSpec Change Identity，不引入当前工作区已退役的 Runtime 或 Workflow State。

输入至少包括：

```text
tfs_id
expected_schema（已知时）
change_ref（Multica 已保存时，优先）
```

结构化结果：

```text
ACTIVE_FOUND
ARCHIVED_FOUND
NOT_FOUND
CONFLICT
INVALID
```

Resolver 只读取和校验，不创建 Change、不修改 Multica、不修改 OpenSpec Artifact。

### 5.2.1 Primary Lookup — persisted `change_ref`

若 Multica 已保存 `change_ref`：

```text
读取 change_ref
→ 校验 id / path
→ 读取 .openspec.yaml / OpenSpec status
→ 校验 schema
→ 成功：ACTIVE_FOUND
```

`change_ref` 是正常路径，不应每次 Run 都扫描整个 `openspec/changes/` 重新推断身份。

若引用路径不存在、已移动或不可解析，不立即创建新 Change，进入 Recovery Lookup。

### 5.2.2 Recovery Lookup — active first

当 `change_ref` 缺失或当前 path 无法解析时：

```text
openspec/changes/
→ 排除 archive/
→ 查找 ID 与当前 TFS ID 稳定对应的候选 Change
→ 校验候选 .openspec.yaml / schema
```

规则与 `fire-router.py` 相同：

```text
0 个合法 active candidate
→ 继续 archive fallback

1 个合法 active candidate
→ ACTIVE_FOUND
→ 允许 caller 修复 Multica change_ref

>1 个合法 candidate
→ CONFLICT
→ 禁止按目录顺序取第一个

候选目录 / metadata 损坏
或 schema 与 expected_schema 冲突
→ INVALID
→ 禁止自动创建新 Change 掩盖异常
```

## 5.3 Archive Fallback

active 未找到时，再检查 OpenSpec archive。

OpenSpec Archive 允许物理目录增加日期等归档前缀，但逻辑 Change ID 保持不变。Resolver 以 `change_ref.id`（存在时）或稳定 TFS ID 后缀进行确定性匹配，并校验候选内容。

```text
0 个 archive candidate
→ NOT_FOUND

1 个 archive candidate
→ ARCHIVED_FOUND

>1 个 archive candidate
→ CONFLICT
```

`ARCHIVED_FOUND` 不表示可以重新激活 Change。Resolver 只返回事实；当前 Delivery 是否仅修复归档引用、是否属于异常 reopen，由 Delivery 生命周期规则处理。

## 5.4 Create Contract

只有 Resolver 明确返回：

```text
NOT_FOUND
```

且当前 Analysis 已明确：

```text
change_kind
schema
TFS Work Item identity
```

才允许创建新 Change。

创建顺序：

```text
resolve
→ NOT_FOUND
→ 生成 <semantic-slug>-<tfs-id>
→ 使用 OpenSpec 1.13.2 创建指定 schema 的 Change
→ 回读 .openspec.yaml / status
→ 校验 change id + schema
→ 写入 Multica analysis.change_ref
→ 回读确认
```

禁止：

```text
先创建多个候选再选择
因 Human Reject 创建新 Change
因 Development Rework 创建新 Change
因 change_ref 暂时缺失直接创建新 Change
用 title 相似度猜测已有 Change
```

## 5.5 Partial Failure Recovery

创建与关联采用可恢复顺序，不建设 Change Mapping Store。

### Case A — Change 创建成功，`change_ref` 写回失败

下一次运行：

```text
change_ref missing
→ Recovery Lookup
→ 唯一 active candidate found
→ ACTIVE_FOUND
→ 修复 Multica change_ref
```

不得再次创建 Change。

### Case B — `change_ref` 存在，但 Change 已 Archive

```text
primary path missing
→ archive fallback by change_ref.id
→ ARCHIVED_FOUND
→ caller 修复当前 archive path / reference
```

不得重新应用 Delta，不得新建同 ID Change。

### Case C — duplicate / corrupt / schema mismatch

```text
CONFLICT / INVALID
→ STOP
→ Delivery Lead / Human 处理
```

不得以“重新创建一个干净 Change”作为恢复方式。

## 5.6 Resolver Implementation Boundary

`resolve-openspec-change.py` 只承担：

```text
validate input
find active candidate
find archive candidate
validate identity / schema
return structured result
```

不承担：

```text
Route decision
Human Approval
Change content generation
Artifact mutation
Multica status mutation
Archive execution
```

这样保持与 `fire-router.py` 相同的设计性质：**deterministic lookup 是只读能力，创建与副作用由明确的 caller 在 resolver 结果之后执行。**

Corrective 无 Spec-level change 时，`skip_specs: true` 的实际持久化仍按 OpenSpec `1.13.2` 原生 Contract 执行；Resolver 只校验，不自行推导该值。

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
| `specs` | `specs/<capability>/spec.md` | OpenSpec Requirements、Rules、Scenarios；作为行为与验收 Contract |
| `design` | `design.md` | Approach、Technical Decisions、Contracts/Data、Dependencies、Risks、Compatibility |
| `tasks` | `tasks.md` | Implementation Tasks、task-level verification、按需 Change-level Verification Tasks、task progress |

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
      Define changed expected behavior using OpenSpec-native requirements
      and scenarios. Scenarios must be testable and form the acceptance
      contract. Do not duplicate implementation or verification procedure details.
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
      Each implementation task must state how its completion is verified.
      Add a separate change-level verification task only when the required
      behavior cannot be verified within one implementation task.
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

`corrective-change` 采用 rapid-style 的轻量 Artifact Graph，但保留项目必须的条件性 Specs 能力。`bug-analysis` 继续作为 Analysis Method，不再作为独立 OpenSpec Artifact；其最终确认的工程事实由 Corrective `proposal.md` 持有。

## 7.1 Artifact Graph

```text
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
| `proposal` | `proposal.md` | Problem、Expected/Actual、Reproduction/Failure Path、Root Cause/Evidence、Fix Strategy、Fix/Regression Scope、Impact、Spec relation |
| `specs` | `specs/<capability>/spec.md` | 需要长期补录/澄清的既定行为，以 OpenSpec Requirement + Scenario 表达 |
| `tasks` | `tasks.md` | Fix implementation tasks、每 Task 验证方法、按需 Regression / Integration / E2E Verification Tasks、task progress |

## 7.3 Executable Schema Baseline

```yaml
name: corrective-change
version: 1
description: Lightweight corrective change contract with root-cause-first proposal

artifacts:
  - id: proposal
    generates: proposal.md
    description: Corrective engineering contract
    template: proposal.md
    instruction: |
      Establish the problem, expected versus actual behavior, reproducible
      failure path when available, root cause with evidence, fix strategy,
      fix/regression scope, impact and specification relation. Keep detailed
      investigation logs in referenced evidence rather than duplicating them.
    requires: []

  - id: specs
    generates: specs/**/*.md
    description: Delta specifications only when established behavior needs durable clarification
    template: spec.md
    instruction: |
      Record only proven existing behavior that requires durable specification.
      Express durable behavior as OpenSpec-native requirements and scenarios.
      Do not invent a behavior change to satisfy the schema.
    requires:
      - proposal

  - id: tasks
    generates: tasks.md
    description: Trackable corrective implementation and verification checklist
    template: tasks.md
    instruction: |
      Break the approved fix strategy into implementation tasks.
      Each implementation task must state its verification method.
      Add a separate regression/integration/E2E verification task only when
      the required behavior must be verified across multiple tasks, modules,
      repositories, systems or a complete user journey.
      Every task must have a stable project task id.
      Do not include Multica assignment, status, PR or delivery workflow.
    requires:
      - specs

apply:
  requires:
    - proposal
    - specs
    - tasks
  tracks: tasks.md
  instruction: |
    Implement only the assigned task_refs according to the approved root cause,
    fix strategy, regression scope and task verification contract.
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

本地验收必须确认当前安装版本中 skipped `specs` 可满足 artifact dependency 和 `apply.requires`。当 `specs` 被合法 skipped 时，Spec-dependent Verification 不得伪装为已验证；Corrective 的行为回归证明主要来自 `tasks.md` 中的 task-level / change-level verification 及实际 Evidence。

---

# 8. Template Contracts

> **P0-2 — Pending Discussion**：本节已经固定 Artifact 职责、OpenSpec 原生语义和最小内容范围；`proposal.md` / Delta Spec / `tasks.md` 的最终 parser-level Markdown grammar 仍待专项讨论后锁定。P0-2 完成前，示例模板不是最终语法实现。

> **Native Acceptance Decision**：不再设计独立 AC / Verification Requirements Artifact，也不建立 `AC-xxx` / `VR-xxx` Identity。存在 Specs 时以 `Requirement + Scenario` 作为 Acceptance Contract；验证执行要求进入 `tasks.md`。

## 8.1 Intentional `proposal.md`

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

## 8.2 Corrective `proposal.md`

```markdown
# Proposal

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

## Impact

## Specification Relation
- Existing specification already correct / no durable delta required
- Established behavior requires durable clarification / delta spec required

## Supporting Evidence References
```

要求：

- Root Cause 不得只写 symptom；
- Evidence 可追溯，详细排查日志放 Supporting Evidence，不把 Proposal 变成调查流水账；
- Fix Strategy 必须对应 Root Cause；
- Regression Scope 明确必须防止的回归范围；
- `Specification Relation` 只判断是否需要长期 Spec Delta，不用新增 AC / VR Identity。

## 8.3 `spec.md`

规格文件优先采用 OpenSpec 原生 Delta Spec 语义：

```text
ADDED / MODIFIED / REMOVED / RENAMED Requirements
→ Requirement
→ Scenario
```

其中：

```text
Requirement
= 需要长期成立的行为 / 规则

Scenario
= 可观察、可测试的行为实例
= Acceptance Contract 的原生表达
```

不再额外增加：

```text
Acceptance Criteria
Verification Requirements
```

作为平行正文层。如何严格采用 OpenSpec 1.13.2 的 Delta Markdown grammar 由 P0-2 最终锁定。

## 8.4 `design.md`

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

## 8.5 `tasks.md`

`tasks.md` 同时允许两类 Task：

```text
Implementation Task
Verification Task
```

默认规则：

1. 每个 Implementation Task 必须包含自己的最小可靠验证方式；
2. 能归属于单个 Implementation Task 的验证，不创建额外 Verification Task；
3. 只有必须在多个 Task / Module / Repository / System 组合完成后才能证明的行为，才增加 Change-level Verification Task；
4. Regression / Integration / E2E 是 Verification Method，不绑定某个 Agent；
5. 是否由独立 Verify Agent 执行属于 Multica Delivery Policy。

建议格式：

```markdown
# Tasks

## Backend

- [ ] [T-001] Implement cancellation endpoint.
      Verify: API test covers allowed and rejected state transitions.

## Frontend

- [ ] [T-002] Add cancellation action.
      Verify: browser/component test covers visible state and error handling.

## Change-level Verification

- [ ] [T-003] Verify cancellation end-to-end across UI, API and persistence.
      Required only because the final behavior spans multiple implementation tasks.
```

如果最终行为已经被 T-001 / T-002 各自的验证完整证明，则不得为了流程形式机械增加 T-003。

---

# 9. Verification Contract

OpenSpec 定义 Verification Contract；Multica 决定 Runtime Executor。必须区分 **Contract Owner / Responsibility Executor / Execution Mechanism**：

```text
OpenSpec
├─ Requirement / Scenario（验什么）
├─ Implementation Task + Verify（单 Task 如何证明）
└─ Change-level Verification Task（组合行为如何证明，按需）

Multica Runtime Projection
└─ Responsibility Executor
   ├─ Engineer
   └─ Verify Agent（仅当该 Verification Task 被纳入已批准 Independent Verification）

Execution Mechanism
└─ test / CI / script / browser / runtime environment / E2E runner ...
```

`CI / deterministic tooling` 是执行机制或 Evidence 生产能力，不是 Verification Contract Owner，也不自动成为 Multica Runtime Owner。

Change-level Verification Task 本身不绑定角色。由 Engineer 执行时用于闭合 Development Contract；由 Verify Agent 执行时，可以同时作为 Independent Verification 的一部分，但不改变该 Task 的 OpenSpec Engineering Truth。

## 9.1 Level 1 — Task-level Verification

始终存在。每个 Implementation Task 在完成前必须有适合该工程资产的可靠验证，例如：

```text
Unit Test
Regression Test
Integration Test
Contract Test
Build / Type Check / Lint
Browser Interaction
API Invocation
Runtime Reproduction
Flink Test Harness
```

验证方法属于 Task Completion Contract，不要求独立 Artifact。

## 9.2 Level 2 — Change-level Verification

仅当以下条件之一成立时创建独立 Verification Task：

```text
最终行为必须组合多个 Implementation Task 后才能观察
跨 Frontend / Backend / DB / MQ / 外部系统
跨 Repository
多个 Engineer 各自只能证明局部 Task Set
需要完整 User Journey / E2E
Corrective 修改公共组件，需要统一 Regression Scope
状态机 / 异步 / 流式链路无法由单 Task 验证
```

原则：

> **能归属于一个 Implementation Task 的验证，写回该 Task；只有组合后的 Change 才能证明的行为，才建立 Change-level Verification Task。**

Runtime Executor 由 Multica Projection 决定：

```text
normal development closure
→ Assigned Engineer

approved independent verification overlaps this task
→ Verify Agent may be assigned this Verification Task
```

若 Verify Agent 执行该 Verification Task，并且其执行范围、候选版本与 Evidence 同时满足 Independent Verification Contract，则一次执行可以同时满足该 Task Completion 与对应独立验收范围，避免 Engineer 与 Verify Agent 为形式重复运行同一 Integration / E2E。反之，已有 Engineer Evidence 不自动等于 Independent Verification PASS。

## 9.3 Level 3 — Independent Verification

独立性要求属于 Delivery Policy，不属于新的 OpenSpec Artifact。

```text
independent_verification_required = false
→ Engineer 完成所有 required Development Verification
→ 可使用 CI / deterministic tooling 作为执行机制

independent_verification_required = true
→ Multica 调度 Verify Agent 作为 Independent Verification Executor
```

Verify Agent 不拥有 Requirement、Scenario 或 Verification Task 的定义权；它消费当前批准的 OpenSpec Artifact，对明确候选版本执行独立验证并输出 Evidence / Finding。

当某个 Change-level Verification Task 与 Independent Verification Focus 重合时，Multica 可以直接将该 Task 分配给 Verify Agent。此时 Verify Agent 是该 Task 的 Runtime Executor，但 Task Contract 仍由 OpenSpec `tasks.md` 持有。

## 9.4 OpenSpec Native Verify Boundary

OpenSpec 原生 `/opsx:verify` 用于检查 Change Artifact 与实现之间的 Completeness / Correctness / Coherence。它可以消费 `tasks.md`、Specs 和 Design，并尊重 `skip_specs`。

边界：

```text
OpenSpec Native Verify
= Change-level Artifact-to-Implementation Verification

OpenSpec Native Verify
≠ Task-level Verification
≠ 真实 Integration Environment
≠ E2E Runtime Test Runner
≠ 独立 Verify Agent
```

执行规则：

```text
verify_agent.required = true
→ Verify Agent 在 Independent Verification 中执行或复用当前候选版本的有效 Native Verify 结果

verify_agent.required = false
→ 默认不强制 Native Verify
→ 仅当 Project / Change Contract 明确要求，或 Engineer 需要 Change-level consistency audit 时按需执行一次
```

Native Verify 不应由每个 Engineer / 每个 Task Set 重复执行。它的合理时点是当前候选 Change 已形成、required Implementation Tasks 以及由 Engineer 负责的 required Verification Tasks 已完成之后。

当 `skip_specs: true` 时，Spec-dependent checks 不适用；不能把未执行的 Requirement / Scenario coverage 当作 PASS。Corrective 必须依靠实际 Task Verification / Regression Evidence 证明修复正确。

---

# 10. Task Identity Contract

## 10.1 Task ID

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

## 10.2 Task Mutation

### Analysis / Approval 前

Workitem Analyst 可以根据分析结果创建、细化和追加 Top-level Task，但仍遵守：

```text
Task ID 一旦创建不重编号
Task ID 不复用
删除改为显式 superseded / no-longer-required
```

### Human Approval 后

进入并行 Development Runtime 后，冻结当前批准基线的 **Top-level Task Identity**：

```text
Engineer 不得新增 T-xxx
Engineer 不得删除 T-xxx
Engineer 不得重编号 T-xxx
Engineer 不得把自己的局部实现步骤升级成新的 Top-level Task
```

Engineer 的正常 Task 写入只包括：

```text
通过 deterministic patch 更新 assigned task_refs 的 checkbox
```

局部实现细节、临时调试步骤、测试组织等不要求为了可见性新增 Top-level Task ID。

如果实现中发现确实需要新的独立 Engineering Task：

```text
STOP 当前自动 Task Mutation
→ 报告新增工作的 Goal / Reason / Scope Impact
→ Delivery Lead 协调 Workitem Analyst 在受控边界追加 Task
→ 若改变 Requirement / Scenario、Expected Behavior、Root Cause / Fix Strategy、Regression Scope 或 Approved Scope
   → 回到相应 Human Review 边界
```

新 Task 的分配发生在受控 Analysis / Rework 边界，不由多个并行 Engineer 自主竞争下一个 `T-xxx`，因此 v1 不建设 Task ID Allocator / Task Registry。

不再需要执行的 Task 不静默删除；保持 ID 可追溯，并以明确的 superseded / no-longer-required 说明收口。对应 Change 必须有可追溯的依据。

---

# 11. Task Progress Update

## 11.1 Default Model

不建立 Task Completion Store，不建立中央 Writer Agent，不保存中间 completion artifact。

多个 Runtime Executor 可以并行完成不同 Task Set；正常 Implementation Task 由 Engineer 执行，独立验收场景下被明确分配的 Change-level Verification Task 也可由 Verify Agent 执行。对共享 `tasks.md` 的最终持久化统一采用 **single-writer critical section**：

```text
Engineer Run A ─┐
                  ├─ parallel implementation / validation
Engineer Run B ─┤
Verify Run     ──┘  # only assigned verification task_refs
        ↓
各自 Development Completion Check
        ↓
update-task-progress.py
        ↓
change-scoped serialized write to tasks.md
```

## 11.2 Deterministic Patch

提供：

```text
scripts/update-task-progress.py
```

输入：

```text
change_ref
task_refs
expected_action = complete
```

脚本只执行确定性 checkbox patch，不判断任务是否语义完成；完成判断来自 Development Completion Check。

正常 Procedure：

```text
取得当前 Change 的 tasks.md 独占写入权
→ 读取最新 tasks.md
→ 解析 [T-xxx]
→ 校验 task_refs 存在且唯一
→ 校验当前操作只允许 checkbox [ ] → [x]
→ 在临时文件生成 patch 后原子替换 tasks.md
→ 回读确认目标 task_refs 状态
→ 释放写入权
```

输出至少区分：

```text
UPDATED
ALREADY_COMPLETE
BUSY
CONFLICT
INVALID
```

其中：

- `ALREADY_COMPLETE`：目标 Task 已完成；不重复改写，由 caller 判断是否存在重复 Runtime；
- `BUSY`：当前 Change 正有另一个 writer，当前调用不无限等待；
- `CONFLICT`：Task ID 重复、目标内容发生不允许的结构变化或当前 patch 无法安全应用；
- `INVALID`：输入、Change 或 `tasks.md` Contract 非法。

## 11.3 Controlled Serialization

v1 不采用“多个 Engineer 各自读文件后乐观覆盖”的模型，也不建设全局锁服务。

要求：

```text
锁粒度 = 当前 Change 的 tasks.md
锁用途 = 极短的 checkbox persistence critical section
锁生命周期 = 当前脚本进程
锁事实 = transient technical synchronization
         ≠ Workflow State
         ≠ Delivery Truth
```

实现必须使用 **process-scoped exclusive file lock 或等价的进程退出可释放机制**。不得使用需要人工清理的长期 lock marker 作为正常方案。

取得锁失败时使用有界等待 / 重试；仍不可获得则返回 `BUSY`，由当前 Run 稍后重试或上层协调，不长期阻塞 Agent Run。

进入锁以后必须重新读取最新 `tasks.md`；不能使用锁外缓存内容执行写入。

原子写入要求：

```text
write temp file in same filesystem
→ flush
→ atomic replace
→ read-back verify
```

此机制只序列化 `tasks.md` 的短写入窗口，不阻止 Backend / Frontend / Flink Engineer 并行编码、验证或处理不同 Repository。

## 11.4 Same-task and Structural Conflicts

同一 `task_ref` 不应同时分配给两个正常 Runtime。Runtime Projection 已发生重复时属于 Delivery 协作冲突，而不是由文件写锁解决。

```text
same task concurrently assigned
→ 上层视为 conflict / UNKNOWN
→ Delivery Lead 协调
```

若第二个 patch 到达时目标已为 `[x]`，脚本返回 `ALREADY_COMPLETE`，不得通过再次写入制造“第二次完成”事实。

以下结构异常返回 `CONFLICT` / `INVALID`，不得覆盖：

```text
Task 缺失
Task ID 重复
目标 task line 无法唯一解析
并行 Development 期间出现未授权 Top-level Task 新增 / 删除 / 重编号
任务正文发生无法解释的 Contract 变化
```

## 11.5 Update Frequency

`tasks.md` 不承担实时进度。

默认只在当前责任执行者已经取得该 `task_refs` 所需完成证据后批量更新一次：Engineer 依据 Development Completion Contract；Verify Agent 仅对被明确分配的 Verification Task 依据 Independent Verification / Verification Gate 结果更新。

---

# 12. Artifact Write Permission Matrix

| Artifact | Analysis | Development | Verify | Archive |
|---|---|---|---|---|
| `proposal.md` | Write | Read；Corrective 发现 Root Cause / Fix Strategy 等批准事实有问题则停止并升级 | Read | Preserve |
| `specs` | Write | 默认 Read；Requirement / Scenario 实质变化必须回 Review | Read | Apply/Archive |
| `design.md` | Write | 可在批准边界内细化 implementation detail | Read | Preserve |
| `tasks.md` task body | Write；Approval 前可创建/细化 | Approval 后默认 Read；执行时消费 Task + Verify；新增 Top-level Task 必须返回受控 Analysis / Rework 边界 | Read / Execute assigned verification tasks | Preserve |
| `tasks.md` checkbox | Initial | 通过 deterministic patch 更新 assigned task_refs | 通过同一受控机制更新被明确分配的 verification task_refs | Must be complete |

Engineer 对 Design / Tasks 的细化不能改变批准的 Engineering Contract。

---

# 13. Apply Context Contract

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
proposal
tasks
specs（done 时）
```

Specs skipped 时不得伪造文件。

额外 Supporting Design / Evidence 不属于 Schema Artifact 时，必须由稳定引用显式交接。

---

# 14. Supporting Evidence

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

# 15. Validation Contract

Schema 实现后必须通过：

```text
openspec --version
→ 必须为 1.13.2

openspec schema which
→ 必须解析到当前 Project Schema

openspec schema validate
openspec templates --json
openspec status --change <id> --json
openspec instructions <artifact> --change <id> --json
openspec instructions apply --change <id> --json
openspec validate <id> --strict --json
```

Schema 命令在当前 OpenSpec 文档中仍标记为 experimental，因此项目不是“动态跟随 CLI”，而是把已锁定的 `1.13.2` 行为作为本实施 Contract。任何版本升级必须重新运行本节与 §16 Acceptance Cases。

实现完成后的 OpenSpec Native Verify 属于语义 Verification，不替代本节结构验证，也不自动替代真实 Integration / E2E。其报告必须区分实际检查、Not applicable 与 Not verified；尤其 `skip_specs: true` 时不得把 Spec-dependent checks 记为通过。

---

# 16. Acceptance Cases

## Case A — Corrective / no spec delta

期望：

```text
proposal = done
specs = skipped
tasks = done
apply = ready
```

验证：

- `skip_specs` 同时满足 dependency 与 `apply.requires`；
- Root Cause / Fix Strategy / Regression Scope 均由 Corrective Proposal 持有；
- Spec-dependent Verify checks 为 Not applicable，而不是 PASS；
- 原始故障 / 回归场景由 Task Verification + Evidence 证明。

## Case B — Corrective / spec clarification

```text
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

期望：

```text
两个 Engineer Run 可以并行实现 / 验证
→ checkbox persistence 进入 change-scoped single-writer critical section
→ 后进入的 writer 读取前一个 writer 已提交的最新 tasks.md
→ 不发生 lost update
→ 不建设 completion store
```

## Case F — Same-task Conflict

两个 Runtime 同时引用 `T-002`。

期望：

```text
Runtime Projection 不应形成重复正常分配
→ conflict / UNKNOWN
→ Delivery Lead 协调

若第二个 patch 到达时 T-002 已完成
→ ALREADY_COMPLETE
→ 不重复写入、不伪造第二次完成
```

## Case G — Task Mutation After Approval

Engineer 在 Development 期间发现需要新增 `T-007`。

期望：

```text
Engineer 不直接追加 Top-level Task ID
→ STOP automatic mutation
→ 返回 Delivery Lead / Workitem Analyst
→ 受控追加
→ Contract / Scope 改变时重新 Human Review
```

验证：

- 旧 `task_refs` 可追溯；
- Task ID 不重用；
- 并行 Engineer 不竞争新的 `T-xxx`；
- Scope / Contract 变化按 Review 规则处理。

## Case H — Task-level Verification Only

单一 Backend Task 的行为可由该 Task 自身测试完整证明。

期望：

```text
Implementation Task + Verify
→ no extra Verification Task
→ Assigned Engineer completes verification using appropriate test / CI / tooling evidence
```

不得为了“存在验证阶段”机械增加 Integration / E2E Task。

## Case I — Change-level Integration / E2E Verification

Frontend、Backend 与 Persistence 分别由不同 Task 实现，最终用户行为只有组合后才能观察。

期望：

```text
Implementation Tasks
+ one Change-level Verification Task
→ verifies composed behavior
```

Verification Task 仍属于 `tasks.md`，不创建 `verification.md` / `acceptance.md`。

## Case J — Independent Verification Optionality

同一个 Verification Contract：

```text
low independence need
→ Multica assigns required Verification Task to Engineer
→ Engineer may use CI / deterministic tooling

high independence need
→ Multica may assign overlapping Change-level Verification Task to Verify Agent
→ Verify Agent executes it as part of Independent Verification
```

更换 Executor 不改变 OpenSpec Artifact Graph，也不创建新的 Engineering Truth。

## Case K — Change Identity Recovery

至少覆盖：

```text
1. Multica change_ref valid + active Change exists
   → ACTIVE_FOUND

2. change_ref missing + 唯一 <semantic-slug>-<tfs-id> active Change exists
   → ACTIVE_FOUND
   → caller 可修复 change_ref

3. create 已成功但 change_ref 写回失败
   → next run recovery lookup 找到同一 Change
   → 不重复创建

4. active 不存在 + 唯一 archive candidate
   → ARCHIVED_FOUND

5. multiple active / archive candidates
   → CONFLICT
   → 不按目录顺序猜测

6. .openspec.yaml 损坏 / schema mismatch
   → INVALID
   → 不创建新 Change 掩盖异常
```

## Case L — Runtime Baseline Drift

```text
OpenSpec != 1.13.2
或 schema which 不指向 Project Schema
→ Acceptance FAIL
→ 不执行 Schema / Apply / Archive 写操作
```

---

# 17. Archive Contract

Archive 前至少满足：

```text
required OpenSpec validation PASS
tasks.md 无 pending required tasks
必要 Verification / PR Delivery conditions 已由 Multica 满足；若要求 Independent Verification，则对应当前候选版本的结果必须有效
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

# 18. Schema Evolution

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

## Case M — Verification Task Executor Projection

Change-level `T-003` 与最终 E2E 行为对应。

```text
verify_agent.required = false
→ T-003 assigned to Engineer
→ Engineer executes E2E using test/CI/runtime tooling

verify_agent.required = true
+ T-003 overlaps Independent Verification Focus
→ T-003 may be assigned to Verify Agent
→ one execution may satisfy both T-003 completion and the overlapping independent verification scope
```

验证：

- `tasks.md` 中的 T-003 Contract 不因 Executor 改变；
- CI / test runner 只是执行机制，不拥有 Task；
- Engineer Evidence 不自动升级为 Independent Verification PASS；
- Verify Agent 执行 T-003 时可通过受控 `update-task-progress.py` 更新该 assigned verification task_ref。

## Case N — OpenSpec Native Verify Execution

```text
verify_agent.required = true
→ Verify Agent executes or reuses valid current-candidate `/opsx:verify`
→ then performs required independent Runtime / Integration / E2E checks

verify_agent.required = false
→ no default mandatory `/opsx:verify`
→ run once only when Project / Change Contract explicitly requires it or a Change-level consistency audit is needed
```

验证：

- 不在每个 Engineer Task Set 后重复 Native Verify；
- Native Verify PASS 不替代真实 Integration / E2E Evidence；
- `skip_specs=true` 时 Spec-dependent checks 为 `NOT_APPLICABLE`。

---

# 19. Implementation Deliverables

第一批实施资产：

```text
openspec/schemas/corrective-change/schema.yaml
openspec/schemas/corrective-change/templates/*
openspec/schemas/intentional-change/schema.yaml
openspec/schemas/intentional-change/templates/*
scripts/resolve-openspec-change.py
scripts/update-task-progress.py
tests/schema/
tests/change-identity/
tests/task-contract/
tests/verification-contract/
```

完成上述资产与 Acceptance Cases 后，再同步修改 Workitem Analyst / Engineer / Delivery Lead / Verify Agent 相关 Skills 与 Delivery 主方案；Verify Agent 不再作为固定 Schema Stage，而作为按需 Independent Verification Executor。

---

# 20. External Contract Notes

当前 OpenSpec 官方 Schema Contract 明确区分：

```text
artifact.requires
= planning dependency

apply.requires
= artifacts required before apply is ready

apply.tracks
= Markdown checkbox task tracking file
```

`skip_specs: true` 在当前锁定的 OpenSpec `1.13.2` 中作为项目已确认的实施基线：Specs 处于 skipped 状态并满足依赖及当前 `apply.requires` 组合；该行为必须进入回归测试，后续 OpenSpec 升级时重新验证。

Reference:
- https://openspec.dev/docs/schemas/schema-yaml
- https://github.com/Fission-AI/OpenSpec/blob/main/docs/agent-contract.md
- https://github.com/Fission-AI/OpenSpec/blob/main/docs/cli.md


---

# v1.3 Review Update Summary

本版相对 v1.2 的主要变化：

- 明确区分 Verification Contract、Responsibility Executor 与 Execution Mechanism；CI / script / test runner 不再被描述成 Contract Owner 或 Runtime Owner；
- Change-level Verification Task 保持角色无关，Multica 可将其分配给 Engineer，或在已批准 Independent Verification 与该 Task 重合时分配给 Verify Agent；
- 明确 Verify Agent “可以执行 Verification Task，但不拥有 Verification Task 的定义权”；Task Contract 始终由 OpenSpec `tasks.md` 持有；
- 当 Verify Agent 执行的 Change-level Verification Task 同时覆盖 Independent Verification Focus 时，允许一次执行同时满足 Task Completion 与对应独立验收范围，避免机械重复 E2E / Integration；
- Task Progress 更新从 Engineer-only 表述收敛为 assigned executor，可由 Verify Agent 通过同一受控机制完成其 verification task_refs；
- `/opsx:verify` 明确为可选 Change-level Artifact-to-Implementation Verification：`verify_agent.required=true` 时由 Verify Agent 执行或复用当前候选版本结果；`required=false` 时默认不强制，仅在 Project / Change Contract 明确要求或需要 Change-level consistency audit 时执行；
- Related baseline 更新到 Delivery v1.4.17、Analysis v1.15、Engineer v1.12、Guideline v1.11。

---

# v1.2 Review Update Summary

本版相对 v1.1 的主要变化：

- `corrective-change` 删除独立 `bug-analysis` Artifact；Root Cause Analysis 保留为 Method，最终确认事实合并进入 Corrective `proposal.md`；
- Corrective Artifact Graph 收敛为 `proposal → specs/skipped → tasks → apply`，采用 rapid-style 轻量模型但保留条件性 Delta Spec；
- 取消独立 `AC-xxx` / `VR-xxx` Identity 设计；有 Specs 时使用 OpenSpec `Requirement + Scenario` 作为 Acceptance Contract；
- `tasks.md` 正式同时承载 Implementation Task 与按需 Verification Task；每个 Implementation Task 必须说明自己的验证方式；
- 只有跨 Task / Module / Repository / System / User Journey 才能验证的行为，才创建 Change-level Regression / Integration / E2E Verification Task；
- Integration / Regression / E2E 被定义为 Verification Method，不再与 Verify Agent 角色绑定；
- Verify Agent 降为 Multica 层的 Optional Independent Verification Executor，不拥有 OpenSpec Artifact，也不是固定 Schema Stage；
- 明确 OpenSpec Native Verify 是 Artifact-to-Implementation Verification，不能替代真实 Runtime Integration / E2E；`skip_specs` 时 Spec-dependent checks 应为 Not applicable；
- `P0-3 AC / VR Identity Contract` 关闭，唯一剩余复杂 P0 为 `P0-2 Native Template Contract`。
