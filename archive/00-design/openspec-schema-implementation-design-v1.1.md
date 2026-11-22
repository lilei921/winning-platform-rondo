# OpenSpec Schema Implementation Design v1.1

> Status: Implementation Baseline — Review Follow-up  
> OpenSpec Runtime Baseline: `1.13.2`  
> Scope: Project-level OpenSpec Schema, Templates, Task Contract and lifecycle integration  
> Related baseline: `multica-squad-centric-delivery-v1.4.15.md`, `workitem-analyst-stage-design-v1.14.md`, `engineer-development-stage-design-v1.10.md`, `multica-design-guideline-v1.10.md`

---

# 0. Implementation Review Status

本版本将 v1.0 实施评审发现的问题纳入当前实施基线。已明确的问题直接修改对应 Contract；尚未充分讨论的问题只登记为 Open Item，不使用临时假设提前固化。

| ID | Priority | Review Item | v1.1 Status | Current Decision |
|---|---|---|---|---|
| `P0-1` | P0 | OpenSpec 版本基线 | **Resolved** | 固定 `OpenSpec 1.13.2`，所有 Schema / CLI / Validation / Archive 测试以该版本为实施基线 |
| `P0-2` | P0 | OpenSpec 原生 Template Contract 粒度不足 | **Pending Discussion** | 保留现有内容职责，最终 `proposal.md` / `spec.md` 等原生可执行格式待专项细化 |
| `P0-3` | P0 | AC / Verification Requirements 缺少稳定 Identity Contract | **Pending Discussion** | 不在本版预设 ID 方案；待专项讨论后补入 Template / Reference Contract |
| `P0-4` | P0 | Change Identity 的查找、创建、恢复不够确定 | **Resolved** | 参考 monorepo `fire-router.py`：只读 deterministic resolver、active-first、archive fallback、冲突/损坏不猜测、create-after-NOT_FOUND、可从部分失败恢复 |
| `P0-5` | P0 | 并行 Engineer 更新共享 `tasks.md` 可能 lost update | **Resolved** | Engineer 可并行实现，但 checkbox 持久化通过 change-scoped single-writer critical section 串行执行；批准后冻结 top-level Task Identity |
| `P1-1` | P1 | OpenSpec Apply Context 与 Project Development Context 边界 | Open | 后续专项讨论；当前 §12 继续作为接口基线 |
| `P1-2` | P1 | Archive 与 `finalize-delivery` 的实施接口偏薄 | Open | 后续只补 Integration Contract，不复制 Delivery 主方案状态机 |
| `P1-3` | P1 | Validation 负向 / 恢复测试覆盖不足 | Open | 在上述两个复杂 P0 定稿后统一补测试矩阵 |
| `P2-1` | P2 | Schema Evolution 可能引入不必要迁移复杂度 | Open | 后续讨论是否收缩为 v1 schema freeze / breaking change 禁止策略 |
| `P2-2` | P2 | Artifact Write Permission 与阶段方案存在规则重复 | Open | 后续按 One Rule, One Owner 评审是否进一步收缩 |

当前实施顺序：

```text
先实现 / 固化
→ P0-1 Runtime Baseline
→ P0-4 Change Identity Resolver
→ P0-5 Task Progress Serialization

专项讨论后再固化
→ P0-2 Native Template Contract
→ P0-3 AC / VR Identity Contract
```

P0-2、P0-3 未定稿前，不实现依赖其最终格式的强校验器，不用临时格式形成新的兼容负担。

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

> **P0-2 — Pending Discussion**：本节当前先固定 Artifact 的职责与最小内容范围；`proposal.md` / `spec.md` 等是否以及如何完全采用 OpenSpec 1.13.2 的原生可执行 Markdown grammar，将在专项讨论后固化。P0-2 完成前，不把当前示例模板视为最终 parser-level Contract。

> **P0-3 — Pending Discussion**：AC / Verification Requirements 已被 Analysis Handoff / Verify Focus 跨 Run 引用，但稳定 ID / namespace / superseded 规则尚未定稿。本版不预设 `AC-xxx` / `VR-xxx` 的最终实现。

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
→ 若改变 Expected Behavior / AC / VR / Root Cause / Fix Strategy / Approved Scope
   → 回到相应 Human Review 边界
```

新 Task 的分配发生在受控 Analysis / Rework 边界，不由多个并行 Engineer 自主竞争下一个 `T-xxx`，因此 v1 不建设 Task ID Allocator / Task Registry。

不再需要执行的 Task 不静默删除；保持 ID 可追溯，并以明确的 superseded / no-longer-required 说明收口。对应 Change 必须有可追溯的依据。

---

# 10. Task Progress Update

## 10.1 Default Model

不建立 Task Completion Store，不建立中央 Writer Agent，不保存中间 completion artifact。

多个 Engineer 可以并行实现不同 Task Set，但对共享 `tasks.md` 的最终持久化采用 **single-writer critical section**：

```text
Engineer Run A ─┐
                ├─ parallel implementation / validation
Engineer Run B ─┘
        ↓
各自 Development Completion Check
        ↓
update-task-progress.py
        ↓
change-scoped serialized write to tasks.md
```

## 10.2 Deterministic Patch

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

## 10.3 Controlled Serialization

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

## 10.4 Same-task and Structural Conflicts

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

## 10.5 Update Frequency

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
| `tasks.md` task body | Write；Approval 前可创建/细化 | Approval 后默认 Read；新增 Top-level Task 必须返回受控 Analysis / Rework 边界 | Read | Preserve |
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

Schema 命令在当前 OpenSpec 文档中仍标记为 experimental，因此项目不是“动态跟随 CLI”，而是把已锁定的 `1.13.2` 行为作为本实施 Contract。任何版本升级必须重新运行本节与 §15 Acceptance Cases。

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

## Case H — Change Identity Recovery

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

## Case I — Runtime Baseline Drift

```text
OpenSpec != 1.13.2
或 schema which 不指向 Project Schema
→ Acceptance FAIL
→ 不执行 Schema / Apply / Archive 写操作
```

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
scripts/resolve-openspec-change.py
scripts/update-task-progress.py
tests/schema/
tests/change-identity/
tests/task-contract/
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

`skip_specs: true` 在当前锁定的 OpenSpec `1.13.2` 中作为项目已确认的实施基线：Specs 处于 skipped 状态并满足依赖及当前 `apply.requires` 组合；该行为必须进入回归测试，后续 OpenSpec 升级时重新验证。

Reference:
- https://openspec.dev/docs/schemas/schema-yaml
- https://github.com/Fission-AI/OpenSpec/blob/main/docs/agent-contract.md
- https://github.com/Fission-AI/OpenSpec/blob/main/docs/cli.md


---

# v1.1 Review Update Summary

相对 v1.0：

- 锁定 OpenSpec `1.13.2` 为唯一 Runtime / Schema 实施基线；
- 将 Change Identity 从原则描述升级为确定性 Resolver Contract，参考 monorepo `fire-router.py` 的 active-first / archive-fallback / conflict-no-guess / partial-failure-recovery 模式；
- 新建 Change 默认使用 `<semantic-slug>-<tfs-id>`，Multica `analysis.change_ref` 仍是正常关联事实，Resolver 仅承担缺失 / 路径变化时的确定性恢复；
- 并行 Engineer 仍可并行实现，但 `tasks.md` checkbox 更新改为 change-scoped single-writer critical section；
- Human Approval 后冻结 Top-level Task Identity，Engineer 不再并行新增 / 删除 / 重编号 `T-xxx`，避免 Task ID allocation race；
- `P0-2 Native Template Contract` 与 `P0-3 AC / VR Identity Contract` 明确标记为待专项讨论，本版本不使用临时方案提前固化。
