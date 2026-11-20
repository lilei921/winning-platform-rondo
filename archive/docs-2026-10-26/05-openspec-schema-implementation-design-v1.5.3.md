# OpenSpec Schema Implementation Design（OpenSpec Schema 实施设计）

> Version: 1.5.3\
> Scope: Project-level OpenSpec Schema（项目级 OpenSpec 模式）、Templates（模板）、Task Contract（任务契约）与 Lifecycle Integration（生命周期集成）  
> Date: 2026-10-23  
> Author: winning/li_lei

> Status（状态）: Implementation Baseline（实施基线）— Verification Model Convergence（验证模型收敛）  
> OpenSpec Runtime Baseline（运行时基线）: `1.13.2`  
> Related Baseline（关联基线）: [02-multica-delivery-lifecycle-design.md](02-multica-delivery-lifecycle-design.md), [03-workitem-analysis-design.md](03-workitem-analysis-design.md), [04-engineer-development-design-v1.15.4.md](04-engineer-development-design-v1.15.4.md), [01-multica-openspec-design-guideline.md](01-multica-openspec-design-guideline.md)

## 目录

- [0. Implementation Review Status（实施评审状态）](#openspec-schema-section-00)
- [1. Purpose（目的）](#openspec-schema-section-01)
- [2. Implementation Principles（实施原则）](#openspec-schema-section-02)
- [3. Canonical Mapping（统一映射）](#openspec-schema-section-03)
- [4. Project Layout（项目结构）](#openspec-schema-section-04)
- [5. Change Identity Contract（变更身份契约）](#openspec-schema-section-05)
- [6. intentional-change Schema](#openspec-schema-section-06)
- [7. corrective-change Schema](#openspec-schema-section-07)
- [8. Template Contracts（模板契约）](#openspec-schema-section-08)
- [9. Verification Contract（验证契约）](#openspec-schema-section-09)
- [10. Task Reference Contract（任务引用契约）](#openspec-schema-section-10)
- [11. Task Progress Update（任务进度更新）](#openspec-schema-section-11)
- [12. Artifact Write Permission Matrix（工件写权限矩阵）](#openspec-schema-section-12)
- [13. Apply Context Contract（Apply 上下文契约）](#openspec-schema-section-13)
- [14. Supporting Evidence（补充证据）](#openspec-schema-section-14)
- [15. Validation Contract（校验契约）](#openspec-schema-section-15)
- [16. Archive Contract（归档契约）](#openspec-schema-section-16)
- [17. Schema Evolution（Schema 演进）](#openspec-schema-section-17)
- [18. Implementation Deliverables（实施交付物）](#openspec-schema-section-18)
- [19. Acceptance Cases（验收场景）](#openspec-schema-section-19)
- [20. External Contract Notes（外部契约说明）](#openspec-schema-section-20)
- [附录 A. 版本记录（非现行实施规则）](#openspec-schema-appendix-a)

---

<a id="openspec-schema-section-00"></a>

# 0. Implementation Review Status（实施评审状态）

本版本在 v1.3 基础上继续收敛 Verification Executor 与 OpenSpec Native Verify 的责任边界。继续坚持 OpenSpec 原生 `Requirement / Scenario / tasks / verify` 语义，不创建平行 AC / VR Identity；Change-level Verification Task 保持角色无关，由 Multica 选择 Runtime Executor，Verify Agent 仅在独立验收需要时参与。

| ID | Priority（优先级） | Review Item（评审项） | v1.5 Status（状态） | Current Decision（当前决策） |
|---|---|---|---|---|
| `P0-1` | P0 | OpenSpec 版本基线 | **Resolved** | 固定 `OpenSpec 1.13.2`，所有 Schema / CLI / Validation / Archive 测试以该版本为实施基线 |
| `P0-2` | P0 | OpenSpec 原生 Template Contract 粒度不足 | **Resolved (Native First)** | 沿用原生 Proposal / Delta Spec / Markdown checkbox 与可读编号；不强制 `[T-xxx]`、固定 `Verify:` 或平行 Acceptance ID；仅对实际派发的任务编号、引用及进度修改做必要确定性检查 |
| `P0-3` | P0 | AC / Verification Requirements 缺少稳定 Identity Contract | **Resolved by Native Model** | 不再设计 `AC-xxx` / `VR-xxx` 平行 Identity；有 Specs 时以 Requirement + Scenario 作为 Acceptance Contract（验收契约），验证执行要求进入 `tasks.md` |
| `P0-4` | P0 | Change Identity 的查找、创建、恢复不够确定 | **Resolved** | 参考 monorepo `fire-router.py`：只读 deterministic resolver、active-first、archive fallback、冲突/损坏不猜测、create-after-NOT_FOUND、可从部分失败恢复 |
| `P0-5` | P0 | 并行 Engineer 更新共享 `tasks.md` 可能 lost update | **Resolved** | Engineer 可并行实现，但 checkbox 持久化通过 change-scoped single-writer critical section 串行执行；已派发任务的原生可读编号在有效派工期间保持稳定 |
| `P1-1` | P1 | OpenSpec Apply Context 与 Project Development Context 边界 | Open | 后续专项讨论；当前 [§13](#openspec-schema-section-13) 继续作为接口基线 |
| `P1-2` | P1 | Archive 与 `finalize-delivery` 的实施接口偏薄 | **Resolved by finalize-facts 契约** | 实施接口由 finalize-facts 契约承载（`projects/multica/workspace-skills/finalize-delivery/references/finalize-facts-contract.md`），不复制 Delivery [主方案](02-multica-delivery-lifecycle-design.md)状态机 |
| `P1-3` | P1 | Validation 负向 / 恢复测试覆盖不足 | Open | 按已收口的 Native First 契约补任务定位、进度修改与负向 / 恢复回归，不新增强制 Markdown Grammar |
| `P2-1` | P2 | Schema Evolution 可能引入不必要迁移复杂度 | Open | 后续讨论是否收缩为 v1 schema freeze / breaking change 禁止策略 |
| `P2-2` | P2 | Artifact Write Permission 与阶段方案存在规则重复 | Open | 后续按 One Rule, One Owner（单一规则、单一归属） 评审是否进一步收缩 |

当前实施顺序：

```text
已固化
→ P0-1 Runtime Baseline
→ P0-3 Native Acceptance / Verification Model
→ P0-4 Change Identity Resolver
→ P0-5 Task Progress Serialization

本轮收口
→ P0-2 Native Template Contract：原生结构 + 最小项目级派工约束
```

P0-2 已按 Native First 收口；不新增一套强制 `Verify:` 或 `T-xxx` Grammar。Project Validator 只校验当前确需派发 / 更新的任务编号是否可唯一解析、相关引用是否存在、checkbox 是否可安全更新；语义充分性由专业 Review / Gate 判断。实现与异常恢复仍须通过 [§19](#openspec-schema-section-19) 回归测试。

---

<a id="openspec-schema-section-01"></a>

# 1. Purpose（目的）

本方案是项目 OpenSpec Engineering Contract 的实施级权威设计。

它直接用于实现：

```text
openspec/schemas/corrective-change/
openspec/schemas/intentional-change/
OpenSpec Change 创建与读取
Artifact Templates
Task Number Reference / task_refs
Task Progress 更新
Apply Context
Artifact 写权限
Validation / Archive
```

核心边界：

> **OpenSpec = Engineering Truth（工程事实）**  
> **Multica = Delivery Truth（交付事实）**

OpenSpec Schema 不负责 Multica Route、Status、Assignment、Human Approval（人工批准）、Agent / Squad 调度、PR 状态或 Runtime Projection（运行时投影）。

---

<a id="openspec-schema-section-02"></a>

# 2. Implementation Principles（实施原则）

## 2.1 Schema（模式）表达 Engineering Contract（工程契约）

Schema 负责：

```text
Artifact 类型
Artifact dependency
Artifact output path
Artifact template
OpenSpec Artifact Instruction
Apply prerequisites
Tracked task file
```

不使用 Schema 表达 Multica Delivery Workflow。Artifact Instruction Assembly（工件生成上下文装配）的公共边界见[统一规范 §3.3](01-multica-openspec-design-guideline.md#artifact-instruction-assembly)；Skill 与 Artifact Contract 的消费和规则归属见[统一规范 §3.4](01-multica-openspec-design-guideline.md#skill-artifact-contract-boundary)。Schema YAML / Template 的实施契约仍由本文维护。

## 2.2 Explicit Contract over Implicit Assumption（显式契约优于隐式假设）

Schema 必须显式表达 Artifact dependency、conditional instruction 与 native apply entry；项目级 Human / Gate 准入不得靠“文件通常会存在”这类隐式假设。

`artifact.requires` 用于 Artifact 构建依赖；`apply.requires` 定义 OpenSpec 原生 Apply 何时可进入。Conditional Artifact 可以依照自身 instruction 明确省略，因此项目额外的语义硬条件由 Analysis Gate 校验，不为此建立第二套 Artifact 状态。

## 2.3 No Parallel Truth（不建立平行事实源）

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

## 2.4 Task Progress Is Not Runtime State（任务进度不是运行状态）

```text
Multica
= running / blocked / retry / owner / run history

tasks.md
= planned engineering work + completed engineering work
```

不把 `tasks.md` 当作实时运行面板。

## 2.5 Runtime Baseline（运行时基线）

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

<a id="shared-config-schema-rules"></a>

## 2.6 公共配置与 Schema 专属规则

`openspec/config.yaml` 只维护公共 context 与真正跨 Schema 共用的 Artifact rules。Corrective / Intentional 的专属内容要求放入各自 Schema instruction / template，避免共享 Artifact ID 导致规则串扰。

| 位置 | 权威内容 | 边界 |
|---|---|---|
| `openspec/config.yaml` | 公共项目 context、两类 Change 均适用的 Artifact rules | 不放仅适用于 Corrective 或 Intentional 的章节要求，不维护 Artifact 依赖图或 Delivery 状态 |
| 各项目 Schema instruction / template | 对应 Change Kind 的产物内容、专业写法与条件性说明 | Corrective Proposal 的根因 / 修复要求与 Intentional Proposal 的能力变更要求分别维护 |
| `schema.yaml` | Artifact 集合、依赖与 Apply 前置 | 不在公共 config、Route Config 或 Skill 中复制依赖图 |

公共 rules 按 Artifact ID 匹配；两套 Schema 共享 `proposal`、`specs`、`tasks` 时，不能仅凭 ID 相同认定专业规则共用。Preparation 使用当前 Change 已确定的 Schema 读取指令；发现公共规则夹带专属要求时，应修正配置归属，不为满足错误规则制造无关章节或空产物。

实施验收应分别读取 Corrective / Intentional 的产物指令：公共规则在两者中均可用，专属要求只进入对应 Schema。Analysis 的配置使用边界见 [03 §9.3](03-workitem-analysis-design.md#openspec-configuration)，公共配置与 Schema 专属规则由本节统一维护；P0-2 已按 Native First 收口，不另增强制 Markdown Grammar。

---

<a id="openspec-schema-section-03"></a>

# 3. Canonical Mapping（统一映射）

```text
change_kind = corrective
→ schema = corrective-change
→ route = bug-fix | production-fix

change_kind = intentional
→ schema = intentional-change
→ route = sdd-fast
```

约束：

- Schema 由 Technical Change Kind（技术变更类型） 决定；
- TFS Type、Route、Repository 数量、PR 数量不决定 Schema；
- 一个 Delivery Issue 默认对应一个 active OpenSpec Change；
- Change ID 在首次 Preparation 时确定；
- 后续 Analysis Rework / Development Rework 使用同一个 Change；
- Schema 不在不同 Agent / Run 中重新选择。

---

<a id="openspec-schema-section-04"></a>

# 4. Project Layout（项目结构）

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

projects/multica/scripts/
├── resolve-change-identity.ts
└── update-task-progress.ts

tests/   # 暂缓建设：验收以 O 系列手动执行记录替代（openspec-schema-landing-plan §7）
├── schema/
├── change-identity/
└── task-contract/
```

Schema 以 Project 级版本为准。执行前必须同时确认 OpenSpec 版本为 `1.13.2` 且 `schema which` 解析到项目级 Schema，不允许用户级同名 Schema 静默覆盖项目 Contract。

---

<a id="openspec-schema-section-05"></a>

# 5. Change Identity Contract（变更身份契约）

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

## 5.1 Change ID Convention（变更 ID 约定）

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

## 5.2 Deterministic Resolver（确定性解析器）

提供只读确定性脚本（2026-10-23 落地为 TS 单文件零 npm 依赖，landing 方案裁决 D1/D3）：

```text
projects/multica/scripts/resolve-change-identity.ts
```

设计参考 monorepo `.harness/scripts/fire-router.py` 的查找原则，但只解决 OpenSpec Change Identity，不引入旧 Harness Runtime / Workflow State。

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

### 5.2.1 Primary Lookup（主查找）— persisted `change_ref`（持久化变更引用）

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

### 5.2.2 Recovery Lookup（恢复查找）— active first（活动变更优先）

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

## 5.3 Archive Fallback（归档回退）

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

## 5.4 Create Contract（创建契约）

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

## 5.5 Partial Failure Recovery（部分失败恢复）

创建与关联采用可恢复顺序，不建设 Change Mapping Store。

### Case A（场景 A）— Change 创建成功，`change_ref` 写回失败

下一次运行：

```text
change_ref missing
→ Recovery Lookup
→ 唯一 active candidate found
→ ACTIVE_FOUND
→ 修复 Multica change_ref
```

不得再次创建 Change。

### Case B（场景 B）— `change_ref` 存在，但 Change 已 Archive（归档）

```text
primary path missing
→ archive fallback by change_ref.id
→ ARCHIVED_FOUND
→ caller 修复当前 archive path / reference
```

不得重新应用 Delta，不得新建同 ID Change。

### Case C（场景 C）— duplicate / corrupt / schema mismatch（重复 / 损坏 / 模式不匹配）

```text
CONFLICT / INVALID
→ STOP
→ Delivery Lead / Human 处理
```

不得以“重新创建一个干净 Change”作为恢复方式。

## 5.6 Resolver Implementation Boundary（解析器实施边界）

`resolve-change-identity.ts` 只承担：

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

没有 Spec-level 行为变化时，`skip_specs: true` 的持久化仍按 OpenSpec `1.13.2` 原生 Contract 执行；Resolver 只校验，不自行推导该值。

---

<a id="openspec-schema-section-06"></a>

# 6. intentional-change Schema

## 6.1 Artifact Graph（工件依赖图）

```text
             proposal
             /      \
    specs / skipped  design [conditional]
             \      /
              tasks
                |
              apply
```

## 6.2 Artifact Ownership（工件归属）

上图 Design → Tasks 表示存在 Design 时的内容输入；原生硬依赖以 [§6.3](#section-6-3) YAML 的 `tasks.requires = [specs]` 为准。

| Artifact | Output | Owns |
|---|---|---|
| `proposal` | `proposal.md` | Why、Goal、Scope、Capabilities、Impact |
| `specs` | `specs/<capability>/spec.md` | 有 Spec-level 行为变化时持有 Delta Requirements / Scenarios；无 Delta 时合法 skipped |
| `design` | `design.md` | Conditional；满足设计条件时持有 Approach、Technical Decisions、Contracts/Data、Dependencies、Risks、Compatibility |
| `tasks` | `tasks.md` | Implementation Tasks、task-level verification、按需 Change-level Verification Tasks、task progress |

<a id="section-6-3"></a>

## 6.3 Executable Schema Baseline（可执行 Schema 基线）

````yaml
name: intentional-change
version: 1
description: Intentional change artifact contract
artifacts:
  - id: proposal
    generates: proposal.md
    description: 描述本次变更的初始提案文档
    template: proposal.md
    instruction: |
      创建 proposal 文档，用于明确本次变更为什么有必要。

      章节：
      - **Why（为什么）**：用 1-2 句话说明问题或机会。这个变更解决什么问题？为什么现在要做？
      - **Goal（目标）**：描述预期达到的效果和可观察结果。
      - **Scope（范围）**：在 In Scope / Out of Scope 中列明新增、修改或移除内容；破坏性变更使用 **BREAKING** 标记。
      - **Capabilities（能力）**：明确哪些规格将被创建或修改：
        - **New Capabilities（新增能力）**：列出将引入的能力。每项能力都会生成新的 `specs/<capability-path>/spec.md`。对本次新引入的路径段使用 kebab-case（例如 `user-auth` 或 `identity/user-auth`），并遵循项目现有的规格组织方式。
        - **Modified Capabilities（修改能力）**：列出 REQUIREMENTS 发生变化的现有能力。仅当规格层面的行为发生变化时才列出，而不是仅有实现细节变化。每项都需要对应的 delta spec 文件。必须使用 `openspec/specs/` 下现有能力的准确路径；如果没有需求变化，则留空。
      - **Impact（影响）**：受影响的代码、API、依赖或系统。
      - **Open Decisions（待定决策）**：仅保留不影响规格、选定方案和任务拆分的可延后问题，没有则省略。

      重要：Capabilities 章节非常关键。它建立 proposal 阶段与 specs 阶段之间的契约。
      填写之前必须先调查现有规格：先运行 `openspec list --specs` 获取项目的能力清单，
      再对可能相关的能力运行
      `openspec show "<spec-id>" --type spec --json --no-scenarios`；该命令只返回能力的
      purpose 和 requirement 文本，而不会把完整 spec 文件都拉入上下文。只有在使用已注册的
      独立 store 时，才在这两个命令后追加 `--store "<id>"`，并始终保留 `--type spec`：
      否则当 change 与 spec 同名时会产生 ambiguous-item 错误。没有 `--specs` 的
      `openspec list` 只列出进行中的 change，不会列出项目已经覆盖的 specs。
      应复用现有 capability 的准确路径，而不是创建含义近似的重复名称。
      过滤后的读取只适合作为概览。在判断现有规格已经覆盖什么、哪些内容应该修改之前，
      必须使用 `openspec show "<spec-id>" --type spec` 完整读取每个相关 spec，包括 scenarios
      （`--store` 规则相同）。这里列出的每个 capability 都必须有对应的 spec 文件。

      每个 change 必须至少声明一个 capability（新增或修改），或者显式选择不生成 specs：
      如果 change 没有任何 delta，且 `.openspec.yaml` 没有设置 `skip_specs: true`，
      `openspec validate` 会拒绝该 change。只有在不存在规格层面的行为变化时
      （纯重构、工具调整、文档修改）才使用 `skip_specs: true`。Specs 描述行为；
      如果行为没有变化，就不应该修改 spec。不要为了通过校验而虚构 requirement。

      保持简洁（1-2 页）。重点说明“为什么”，不要展开“怎么实现”——实现细节属于 design.md。

      这是后续工作的基础——适用的 specs、design 和 tasks 都建立在它之上。
    requires: []

  - id: specs
    generates: "specs/**/*.md"
    description: 本次变更的详细规格
    template: spec.md
    instruction: |
      创建规格文件，用于定义系统应该做什么。

      Spec 是行为契约，不是实现计划。

      适合写入 spec 的内容：
      - 用户或下游系统依赖的可观察行为
      - 输入、输出和错误条件
      - 外部约束（安全、隐私、可靠性、兼容性）
      - 可以测试或明确验证的场景

      不要写入 spec 的内容：
      - 内部类名或函数名
      - 库或框架的选择
      - 逐步实现细节
      - 详细执行计划（这些属于 design.md 或 tasks.md）

      快速判断：如果实现方式发生变化，但对外可见行为没有变化，那么该内容通常不应写入 spec。

      Proposal 的 Capabilities 章节中每列出一个 capability，就创建一个对应的 spec 文件。
      `<capability-path>` 是相对于 `specs/` 的规格目录（例如 `user-auth` 或
      `identity/user-auth`）。必须保留完整路径：
      - 新增能力：使用 proposal 中的准确路径创建 `specs/<capability-path>/spec.md`。Proposal 中本次新引入的任何路径段都必须使用 kebab-case。遵循项目现有组织方式；如果项目当前是扁平结构，不要额外增加新的 domain 层级。
      - 修改能力：在 `specs/<capability-path>/spec.md` 创建 delta 时，必须使用 `openspec/specs/<capability-path>/` 下现有能力的准确路径。编写 delta 前先运行 `openspec list --specs` 确认该路径；只有对已注册的独立 store 才追加 `--store "<id>"`。路径拼错或自行虚构路径，会指向一个不存在的 capability，而不是原本想修改的 capability。不要移动或重命名 capability。

      除非该 change 的 `.openspec.yaml` 设置了 `skip_specs: true`
      （不存在规格层面的行为变化），否则至少必须存在一个 spec 文件；
      没有该标记的 zero-delta change 会被 `openspec validate` 拒绝。
      如果 proposal 没有列出任何 capability，同时也没有设置 `skip_specs`，应先回到 proposal 修正。

      Delta 操作（必须使用 ## 标题）：
      - **ADDED Requirements**：新增需求
      - **MODIFIED Requirements**：行为发生变化——必须包含更新后的完整内容
      - **REMOVED Requirements**：废弃功能——必须包含 **Reason** 和 **Migration**
      - **RENAMED Requirements**：仅名称变化——使用 FROM:/TO: 格式

      格式要求：
      - 每个 requirement 使用：`### Requirement: <name>`，后接需求描述
      - 规范性需求使用 SHALL/MUST（避免 should/may）
      - 每个 scenario 使用：`#### Scenario: <name>`，内容采用 WHEN/THEN 格式
      - **关键要求**：Scenario 必须严格使用 4 个井号（`####`）。使用 3 个井号或项目符号会静默失败。
      - 每个 requirement 必须至少包含一个 scenario。

      仅新增 capability：delta spec 的第一个章节必须是 `## Purpose`，
      用一到两句话（至少 50 个字符，否则 `openspec validate --strict` 会报告内容过短）
      说明该 capability 的用途。Archive 时，这段内容会被复制到新创建的主 spec 中；
      如果缺失，新主 spec 会保留 `TBD ... Update Purpose after archive` 占位符，
      需要人工补充。不要在现有 capability 的 delta 中添加 `## Purpose`——
      该 spec 已经有 Purpose，而且 delta 中的 Purpose 会被忽略。
      如果需要修改现有 capability 的 Purpose（包括遗留的 `TBD` 占位符），
      直接编辑 `<planningHome.root>/openspec/specs/<capability-path>/spec.md`。
      `planningHome.root` 来自 `openspec instructions ... --json` 的返回结果。
      始终使用该字段，而不要使用相对于仓库的路径：如果 change 位于某个 store 中，
      无论它来自 `--store`、项目 `store:` 指针还是全局默认 store，该字段都会解析到正确的 store；
      否则会解析到当前仓库。不要自行判断属于哪种情况，该字段已经完成了解析。

      MODIFIED requirements 工作流程：
      1. 在 `<planningHome.root>/openspec/specs/<capability-path>/spec.md` 中找到现有 requirement（使用与上文相同的 store-aware root）
      2. 复制完整的 requirement 块（从 `### Requirement:` 开始，包含其全部 scenarios）
      3. 粘贴到 `## MODIFIED Requirements` 下，并修改为新的行为
      4. 确保标题文本与原 requirement 完全匹配（忽略空白差异）

      常见错误：使用 MODIFIED 时只复制部分内容，会在 archive 时丢失原有细节。
      如果只是新增关注点而没有改变既有行为，应使用 ADDED，而不是 MODIFIED。

      示例（新增 capability，因此第一个章节是 `## Purpose`）：
      ```
      # Spec Delta

      ## Purpose

      允许用户以可移植格式将自己的数据导出产品。

      ## ADDED Requirements

      ### Requirement: 用户可以导出数据
      系统 SHALL 允许用户以 CSV 格式导出自己的数据。

      #### Scenario: 成功导出
      - **WHEN** 用户点击“导出”按钮
      - **THEN** 系统下载包含全部用户数据的 CSV 文件

      ## REMOVED Requirements

      ### Requirement: 旧版导出
      **Reason**: 已由新的导出系统替代
      **Migration**: 使用新的导出端点 /api/v2/export
      ```

      Specs 应当可测试——每个 scenario 都可以成为潜在测试用例。
    requires:
      - proposal

  - id: design
    generates: design.md
    description: 包含实现细节的技术设计文档
    template: design.md
    instruction: |
      仅在以下任一条件成立时创建设计文档：
      - 跨多个服务或模块的横切变更，或引入新的架构模式。
      - 引入新的外部依赖，或数据模型发生重大变化。
      - 存在安全、性能或迁移复杂性。
      - 编码前有需要通过技术决策消除的歧义。

      章节（仅保留适用内容）：
      - **Approach**：描述实现方案和相关现状约束，不重复 Proposal 动机。
      - **Technical Decisions**：记录关键选择、理由与备选方案。
      - **Contracts / Data**：记录接口、数据模型和外部契约变化。
      - **Dependencies**：说明新增或变化的依赖。
      - **Compatibility / Migration**：记录兼容、部署、迁移与回滚安排（如适用）。
      - **Risks**：记录风险、取舍和缓解措施。
      - **Verification Considerations**：说明影响验证范围及方式的技术事项。

      可安全延后、且不改变 Specs、实现方案或任务拆分的问题可补充 Open Questions；
      会影响这些内容的关键问题必须在形成任务前解决。
      重点解释技术决策及其依据，不重复 Proposal / Specs 或逐行实现步骤。
    requires:
      - proposal

  - id: tasks
    generates: tasks.md
    description: 可跟踪的实现任务清单
    template: tasks.md
    instruction: |
      创建任务列表，将实现工作拆分成可执行任务。

      若存在 design.md，编写 tasks 前先检查其中的 Open Questions。如果任何问题会改变实际要构建的内容，
      必须先与用户解决，不要把未说明的假设直接写进任务列表。

      **重要：必须严格遵循下面的模板格式。** Apply 阶段会解析 checkbox 格式跟踪进度。
      复选框中只有 `x` 时表示完成，不区分大小写，也允许任意空格，因此 `- [ x]` 也算完成。
      其他所有标记，包括 `- [~]`、`- [-]` 和空的 `- []`，都视为未完成。
      没有 checkbox 的行完全不会被跟踪。

      派工约束：
      - 进入有效派工后，已被引用的任务编号与正文保持稳定；增补、取消、替换或重编号
        必须由受控 Analysis / Coordination 处理，并核对受影响派工、引用与 Evidence。
      - 已批准取消或替换且无需再执行的任务不得虚假勾选 `[x]`；保留原编号、取消原因与
        批准引用，转为不参与 checkbox 进度的 Markdown 历史记录，编号不复用。

      指南：
      - 将相关任务放在带编号的 ## 标题下分组
      - 每个任务都必须是 checkbox：`- [ ] X.Y Task description`
      - 任务应足够小，能够在一个 session 内完成
      - 按依赖关系排序（哪些工作必须先完成？）
      - 每个任务都必须说明如何验证其完成（测试、命令、可观察行为或交付产物）。
        验证方式直接写在该任务的 checkbox 描述中。只有当验证覆盖多个实现任务的更广泛集成或系统行为时，
        才创建独立的验证任务。
      - 每个任务组都必须同时交付该组工作本身所需要的测试和文档。
        不要把测试或文档统一堆到最后一个组中——如果后面的组第一次验证前面某组的工作，
        一旦失败，就会跨越中间所有组产生返工。若某组工作本身不需要测试或文档，
        例如脚手架或依赖设置，则无需强行添加。最后一个组只用于集成检查，
        不能代替前面各组本应完成的测试和文档。

      示例：
      ```
      # Tasks

      ## 1. 初始化

      - [ ] 1.1 创建新的模块结构，并验证预期文件均已生成
      - [ ] 1.2 向 package.json 添加依赖，并验证依赖安装成功

      ## 2. 核心实现

      - [ ] 2.1 实现数据导出函数，并验证导出测试通过
      - [ ] 2.2 添加 CSV 格式化工具，并验证单元测试覆盖引号和分隔符处理
      - [ ] 2.3 在 docs/export.md 中记录导出 API，并验证文档中的命令可以按说明执行
      ```

      根据 Proposal、实际存在的 Delta Specs、适用的现行 Specs 和 Design（若存在）形成任务。
      有 Delta 时以其行为契约为准；合法跳过 Delta 时，不制造 Spec 或验收场景。
      存在 Design 时按已确定的技术方案拆分任务。
    requires:
      - specs

apply:
  requires: [tasks]
  tracks: tasks.md
  instruction: |
    读取上下文文件，逐项处理尚未完成的任务。任务 checkbox 更新必须经
    `node projects/multica/scripts/update-task-progress.ts`（05 §11 single-writer
    确定性 patch，锁内重读 + 原子写入），不得直接编辑 tasks.md 勾选进度。
    如果遇到阻塞或需要澄清的信息，暂停执行。
````

项目语义：

```text
Proposal = required
Specs = required when spec-level delta exists; otherwise skipped
Tasks = required
Design = conditional
skip_specs = allowed only when no spec-level behavior change
```

Design 条件沿用 `spec-driven` 的原生语义：跨模块 / 新架构模式、新外部依赖 / 显著数据模型变化、Security / Performance / Migration complexity，或存在需要在编码前固化的 Technical Ambiguity。条件均不满足时直接省略 `design.md`，不创建空模板，也不增加 `skip_design` / `design_required` 等第二套状态。

`tasks.requires = [specs]` 只声明 OpenSpec 能以原生状态判断的硬依赖；合法 `skip_specs: true` 会让 Specs 显示 skipped 并满足依赖，不要求空 Spec；`design.md` 是条件性工件，未满足生成条件时不阻塞 Tasks。当专业分析认定需要 Design，`spec-preparation` 必须在形成 Tasks 之前生成该 Design，Analysis Gate 检查其存在性与内容合法性。`apply.requires = [tasks]` 仅用于原生 Apply readiness（就绪信息）和 task tracking。仅当无 Spec-level 行为变化时允许 `skip_specs: true`，不得用它省略应当写入的新建或修改行为；现有 Analysis / Review 负责专业判断。

---

<a id="openspec-schema-section-07"></a>

# 7. corrective-change Schema

`corrective-change` 采用 rapid-style 的轻量 Artifact Graph（工件依赖图），但保留项目必须的条件性 Specs 能力。`bug-analysis` 继续作为 Analysis Method，不再作为独立 OpenSpec Artifact；其最终确认的工程事实由 Corrective `proposal.md` 持有。

## 7.1 Artifact Graph（工件依赖图）

```text
   proposal
      |
 specs / skipped
      |
    tasks
      |
    apply
```

## 7.2 Artifact Ownership（工件归属）

| Artifact | Output | Owns |
|---|---|---|
| `proposal` | `proposal.md` | Problem、Expected/Actual、Reproduction/Failure Path、Root Cause/Evidence、Fix Strategy、Fix/Regression Scope、Impact、Spec relation |
| `specs` | `specs/<capability>/spec.md` | 需要长期补录/澄清的既定行为，以 OpenSpec Requirement + Scenario 表达 |
| `tasks` | `tasks.md` | Fix implementation tasks、每 Task 验证方法、按需 Regression / Integration / E2E Verification Tasks、task progress |

## 7.3 Executable Schema Baseline（可执行 Schema 基线）

```yaml
name: corrective-change
version: 1
description: Lightweight corrective change contract

artifacts:
  - id: proposal
    generates: proposal.md
    description: Problem, root cause, fix strategy and regression scope
    template: proposal.md
    instruction: |
      编写 Corrective Proposal，说明故障原因及恢复既定行为的修复方案。

      内容要求：
      - Problem：描述故障场景、触发条件、Expected Behavior 与 Actual Behavior，
        并引用既定 Spec、业务规则或其他可靠的预期行为依据。
      - Reproduction / Failure Path：记录最小复现场景、故障路径及失败信号；
        无法复现时说明替代证据与局限。
      - Root Cause：标明 confirmed、probable 或 unknown，
        列出支撑结论的证据；probable 需说明剩余不确定性。
      - Fix Strategy：说明针对根因恢复既定行为的方案与关键取舍。
      - Scope：明确 Fix Scope、Regression Scope 及受影响的 Repository / Module；
        覆盖原始故障、正常路径和与故障机制相关的异常及边界场景，
        给出适用的验证范围与可观察通过标准。
      - Impact：说明实际相关的兼容性、数据、依赖、性能、安全及发布影响。
      - Specification Relation：说明是否需要补录或澄清既定行为的长期 Spec；
        有 Delta 时列出准确的 Capability 路径，无 Delta 时说明依据。

      引用关键诊断证据，不展开完整排查记录或逐项实现任务。
      不把未经证实的根因假设写成确定结论，不引入新的产品行为。

    requires: []

  - id: specs
    generates: "specs/**/*.md"
    description: Optional delta specifications for established behavior
    template: spec.md
    instruction: |
      仅在需要补录或澄清长期有效的既定行为时生成 Delta Spec。
      不存在需要持久化的规格增量时，Specs 应合法跳过。

      以现行完整 Spec 与 Proposal 中的行为依据为准：
      - 已有 Capability 使用其准确路径和 Requirement 标题。
      - 新增 Capability 仅用于补录有证据支持的既定行为，路径使用 kebab-case。
      - ADDED 用于补录已有但未记载的行为约束。
      - MODIFIED 包含原 Requirement 的完整内容及全部 Scenario。
      - REMOVED 说明 Reason 和 Migration。
      - RENAMED 仅用于名称变更，明确 FROM 和 TO。

      Requirement 使用 SHALL/MUST 描述行为约束，每项至少包含一个
      可验证的 Scenario，使用 WHEN/THEN 表达触发条件与结果。

      只写对外可观察的行为、输入输出、错误条件及外部约束，
      不写实现步骤、技术选型或任务。
      不以规格澄清引入新的产品行为。

    requires:
      - proposal

  - id: tasks
    generates: tasks.md
    description: Corrective implementation and verification tasks
    template: tasks.md
    instruction: |
      根据 Proposal 和实际存在的 Delta Specs 编写修复与验证任务。

      Apply 阶段按原生 checkbox 解析跟踪进度：复选框中只有 `x` 表示完成
      （不区分大小写，允许任意空格，`- [ x]` 也算完成）；其他所有标记，
      包括 `- [~]`、`- [-]` 和空的 `- []`，均视为未完成；没有 checkbox 的行
      完全不会被跟踪。

      - 按依赖关系排序，任务粒度应便于独立完成和验证。
      - Implementation Task 明确修复动作、完成条件和自身验证方式。
      - Verification Task 明确验证范围、执行方式和通过标准。
      - 将必要的测试与文档更新安排在相关任务组内。
      - 仅当单项任务无法证明组合后的行为时，增加独立的
        Regression / Integration / E2E Verification Task。

      任务须覆盖原始故障与必要的回归范围，不扩大修复目标，
      不创建无实际工作的任务。

      派工约束：
      - 进入有效派工后，已被引用的任务编号与正文保持稳定；增补、取消、替换或重编号
        必须由受控 Analysis / Coordination 处理，并核对受影响派工、引用与 Evidence。
      - 已批准取消或替换且无需再执行的任务不得虚假勾选 `[x]`；保留原编号、取消原因与
        批准引用，转为不参与 checkbox 进度的 Markdown 历史记录，编号不复用。

    requires:
      - specs

apply:
  requires:
    - proposal
    - tasks
  tracks: tasks.md
  instruction: |
    读取 Proposal、适用的 Delta Specs 和 tasks.md。
    逐项完成未完成的任务，执行相应验证；成功后任务 checkbox 更新必须经
    `node projects/multica/scripts/update-task-progress.ts`（05 §11 single-writer
    确定性 patch，锁内重读 + 原子写入），不得直接编辑 tasks.md 勾选进度。
    遇到阻塞或验证失败时，记录问题并停止受影响任务。
```

> 2026-10-23 实测回填（landing 方案 §3）：上方基线即当前资产 `openspec/schemas/corrective-change/schema.yaml` 的实际内容。与 v1.5.2 文本的两处偏差方向均正确：① proposal instruction 由英文简版扩写为中文详版（内容来自 §8.2 模板契约，属增强）；② **`apply.requires` 由 `[proposal, specs, tasks]` 修正为 `[proposal, tasks]`**——为 `skip_specs` 场景让路（§7.4 要求 skipped specs 可满足 `apply.requires`，OpenSpec 1.13.2 实测必需）。

## 7.4 Specs Decision（规格决策）

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

<a id="openspec-schema-section-08"></a>

# 8. Template Contracts（模板契约）

> **P0-2 — Resolved / Native First**：以 OpenSpec `1.13.2` 原生模板、Delta Spec Heading、普通 Markdown checkbox 及任务编号为准；不创建独立 `AC-xxx` / `VR-xxx`，不增加强制 `[T-xxx]`、`Verify:` 或任务级 YAML Block。项目只补充必要内容与已派发任务的可定位约束；Parser 不重做原生 Validation 或专业语义判断。

## 8.1 Intentional（意图性变更）`proposal.md`

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

Proposal 只表达 Why、Goal、Scope、Capabilities、Impact 与必要的 Open Decisions，不重复完整 Requirement / Scenario、技术实现或任务清单。Capabilities 使用 New / Modified 的准确路径；无 Spec-level 行为变化时不虚构 Requirement，并使用原生 `skip_specs`。标题用于人和后续 Agent 阅读；除原生要求及实际引用需要外，不增加强制字段解析器。

## 8.2 Corrective（纠正性变更）`proposal.md`

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

Corrective Proposal 持有 Expected / Actual、Root Cause / Evidence、Fix Strategy 和 Regression Scope。详细排查日志保留为 Supporting Evidence；不新增 RC / FS / RS Identity。合法 `skip_specs` 不要求虚构 Requirement 或 Scenario。

## 8.3 `spec.md`

Delta Spec 沿用 OpenSpec `1.13.2` 原生 Markdown：

```markdown
## ADDED Requirements

### Requirement: <requirement name>
The system SHALL ...

#### Scenario: <scenario name>
- **WHEN** ...
- **THEN** ...
```

`MODIFIED / REMOVED / RENAMED` 继续遵循原生 Delta 规则。Requirement + Scenario 是 Acceptance Contract；不增加 `AC-xxx`、`VR-xxx`、`R-xxx` 或 `S-xxx`。需要精确引用时，使用 Capability Spec 路径和当前原生 Requirement / Scenario Heading（含标题）共同定位，且必须能唯一解析；标题发生影响定位的变动时复核相关引用与证据，不做模糊匹配。引用的序列化表达可由现有 Multica 字段载体承载，不额外规定一套平行 Spec ID Grammar。

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

仅在满足 Conditional Design 生成条件时存在；不增加 `skip_design`，也不创建空占位文件。Design 必要但缺失，由 `spec-preparation` / Analysis Gate 阻止推进。

<a id="section-8-5"></a>

## 8.5 `tasks.md`

使用 OpenSpec 原生编号与 checkbox，例如：

```markdown
# Tasks

## 1. Backend

- [ ] 1.1 实现订单取消接口，并增加 API 测试覆盖有效状态与拒绝场景
- [ ] 1.2 实现取消权限检查，并验证无权限请求被拒绝

## 2. Frontend

- [ ] 2.1 增加订单取消入口及状态 / 错误提示，补充组件测试

## 3. Integration

- [ ] 3.1 验证 UI、API 和持久化组合后的完整取消行为
```

规则：

1. Task 是普通 OpenSpec checkbox，编号如 `1.1`、`2.1`；编号是**项目选择使用的模板可读编号**，不是 OpenSpec 原生不可变 Task ID。
2. 不强制 `[T-xxx]`、固定 `Verify:` 字段、`Verification:` 子块或专门的任务元数据结构。任务描述应清楚到能指导执行和判断完成；必要测试可直接写入描述，也可依据相应 Spec / Proposal / 项目测试规范决定具体方式。
3. 每个 Implementation Task 的完成仍须有真实 Task-level Verification Evidence；跨 Task / Module / Repository 等组合行为只有在确实需要时才额外列为普通 Change-level Verification Task。
4. 任务分组不定义 Multica Owner、Status 或 Sub-Issue；运行时由 Delivery Lead 为明确范围选择执行者。简单单 Engineer 可引用整个当前批准 Task 范围；精确派发时使用当前 `change_ref` + 稳定可读编号。
5. Analysis / Human Approval 前可正常整理编号。进入有效派工后，已被引用的编号与正文应保持稳定；增补、取消、替换或重编号必须由受控 Analysis / Coordination 处理并核对派发 / Evidence 的影响。
6. 已批准取消 / 替换且无需再执行的 Task，不得虚假标成 `[x]`；保留原编号、取消原因与批准引用，转为不参与原生 checkbox 进度的 Markdown 历史记录。是否满足 Archive 由 [§19](#openspec-schema-section-19) 真实回归验证，不能凭格式推断。

2026-10-23 Schema 补强（landing 方案 §3.2 S1–S3）已落进两个 schema 资产：apply instruction 指向 `projects/multica/scripts/update-task-progress.ts`（S1）；tasks 模板与 instruction 补上述 rule 5–6 派工约束（S2）；corrective tasks instruction 补齐原生 checkbox 解析规则（S3）。

本项目**不使用 `/opsx:apply` 执行研发**。Engineer 通过 `development-execution` 消费已批准的 OpenSpec Artifacts 与当前分派范围；OpenSpec `apply` 配置和 `instructions apply --json` 仅可用于上下文读取、原生就绪及任务进度信息。

---

<a id="openspec-schema-section-09"></a>

# 9. Verification Contract（验证契约）

OpenSpec 定义 Verification Contract（验证契约）；Multica 决定 Runtime Executor。必须区分 **Contract Owner / Responsibility Executor / Execution Mechanism**：

```text
OpenSpec
├─ Requirement / Scenario（验什么）
├─ Implementation Task + required Verification Evidence（单 Task 如何证明）
└─ Change-level Verification Task（组合行为如何证明，按需）

Multica Runtime Projection
└─ Responsibility Executor
   ├─ Engineer
   └─ Verify Agent（仅当该 Verification Task 被纳入已批准 Independent Verification）

Execution Mechanism
└─ test / CI / script / browser / runtime environment / E2E runner ...
```

`CI / deterministic tooling` 是执行机制或 Evidence 生产能力，不是 Verification Contract Owner，也不自动成为 Multica Runtime Owner。

Change-level Verification Task 本身不绑定角色。由 Engineer 执行时用于闭合 Development Contract；由 Verify Agent 执行时，可以同时作为 Independent Verification（独立验证） 的一部分，但不改变该 Task 的 OpenSpec Engineering Truth。

## 9.1 Level 1（层级 1）— Task-level Verification（任务级验证）

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

## 9.2 Level 2（层级 2）— Change-level Verification（变更级验证）

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

## 9.3 Level 3（层级 3）— Independent Verification（独立验证）

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

<a id="section-9-4"></a>

## 9.4 OpenSpec Native Verify Boundary（OpenSpec 原生验证边界）

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

Native Verify 不应由每个 Engineer / 每个 Task Set（任务集合） 重复执行。它的合理时点是当前候选 Change 已形成、required Implementation Tasks 以及由 Engineer 负责的 required Verification Tasks 已完成之后。

当 `skip_specs: true` 时，Spec-dependent checks 不适用；不能把未执行的 Requirement / Scenario coverage 当作 PASS。Corrective 必须依靠实际 Task Verification / Regression Evidence 证明修复正确。

---

<a id="task-identity-contract"></a>

<a id="openspec-schema-section-10"></a>

# 10. Task Reference Contract（任务引用契约）

## 10.1 Native Number（原生任务编号约定）

`tasks.md` 使用原生 checkbox 与模板中的人类可读编号：

```markdown
- [ ] 1.1 实现服务端操作及相应 API 测试
- [ ] 1.2 增加权限处理及拒绝场景验证
- [ ] 2.1 实现前端交互及组件测试
```

- 编号如 `1.1`、`1.2` 是当前 `tasks.md` 的**可读定位值**，不是 OpenSpec CLI 提供的持久 Task ID；不新增 `T-xxx` 或全局 ID Registry。
- 只在任务需由多个 Agent 精确派工、完成回写或定向返工时使用 `change_ref + task_refs`，其中 `task_refs` 为当前已批准且可唯一解析的编号字符串。单 Engineer 全量执行可使用已批准的整个 Task 范围，不必机械生成每项引用列表。
- 已派发任务的编号在该派工有效期间保持不变；当前文档中编号缺失、重复或不唯一时，拒绝精确派发 / checkbox patch，不以任务标题或顺序猜测。
- Requirement / Scenario 精确定位使用 Capability Spec 路径 + 原生标题层级；Corrective 可用 `proposal.md` 与既有 Heading 定位。所有引用须能定位到当前可读内容，不创建 AC / VR / R / S ID。

```yaml
change_ref: <change-id>
task_refs: ["1.1", "1.2"]  # 只有精确派工时才需要
```

`Task Set` 是本次分派范围，不是单独持久化实体。任务进度 checkbox 更新统一经 `projects/multica/scripts/update-task-progress.ts`（§11），不直接编辑 tasks.md。

<a id="section-10-2"></a>

## 10.2 Approved Task Mutation（已批准任务变更）

Human Approval 前，Workitem Analyst 可以对编号、分组、描述进行正常整理；不要求提前为所有草案任务冻结 Identity。

Human Approval / 派发后：

- Engineer 只消费当前批准范围并通过受控脚本更新其负责的 checkbox，不擅自新增 / 删除 / 重编号已派发任务，或修改批准的行为 / 验证边界。
- 受控追加任务时应优先使用新编号并保持已有有效引用；需要改变已派发编号或正文时，Delivery Lead 协调 Workitem Analyst 先撤销或重新核对受影响的派工、引用及 Evidence。
- 取消 / 替换任务时，保留原编号与批准依据的可追溯历史记录，不虚假勾选，也不将该历史记录作为新待完成 checkbox。编号不复用，避免与历史引用冲突。
- 如果调整影响 Requirement / Scenario、Corrective Expected / Fix / Regression Scope 或已批准范围，按 [02](02-multica-delivery-lifecycle-design.md) 的既有 Analysis / Human Review 边界重新批准。

不建设 Task ID Allocator、独立 Task Registry、Task 状态机或新的 Workflow。

<a id="task-progress-update"></a>

<a id="openspec-schema-section-11"></a>

# 11. Task Progress Update（任务进度更新）

<a id="section-11-1"></a>

## 11.1 Default Model（默认模型）

不建立 Task Completion Store，不建立中央 Writer Agent，不保存中间 completion artifact。

多个 Runtime Executor 可以按 [02 §7](02-multica-delivery-lifecycle-design.md#development-materialization) 的分派约束完成不同 Task Set；不同业务 Repository 的 Engineer 可以并行实现，独立验收场景下被明确分配的 Change-level Verification Task 也可由 Verify Agent 执行。对同一个持久共享根仓工作区的 `tasks.md` 写入统一采用 **single-writer critical section**，不因不同 Run 创建进度副本：

```text
Engineer：当前任务 Evidence → Development Completion Check PASS ─┐
                                                              ├─ update-task-progress.ts
Verify：已执行的 assigned Verification Task + 有效 Evidence ────┘
        ↓
Change-scoped serialized write → read-back verify
        ├─ Engineer：发布前核对检查依据 → Task Set READY
        └─ Verify：Verification Gate 检查当前 Task Completion / Report / Evidence
```

两条路径的业务条件分别由 [02 §8](02-multica-delivery-lifecycle-design.md#development-execution) / [§9.9](02-multica-delivery-lifecycle-design.md#section-9-9) 维护；Verify 的任务进度写入不以 Verification Gate PASS 为前置，也不额外经过 Engineer 的 Development Completion Check。此处持久化只表示受控文件写入与回读，**不等于根仓 Git Commit**；初始批准基线与最终统一提交按 [02 §6.1](02-multica-delivery-lifecycle-design.md#section-6-1) / [§12.4](02-multica-delivery-lifecycle-design.md#final-completion) 执行。共享修改丢失或关键 Evidence 不可读时，caller 停止并交 Delivery Lead 恢复，不能凭旧 READY 重放 checkbox。

## 11.2 Deterministic Patch（确定性补丁更新）

提供（2026-10-23 落地为 TS 单文件零 npm 依赖，landing 方案裁决 D1/D3；路径 projects/multica/scripts/）：

```text
projects/multica/scripts/update-task-progress.ts
```

输入：

```text
change_ref
task_refs
expected_action = complete
```

脚本只执行确定性 checkbox patch，不判断任务是否语义完成；Engineer 的调用依据是 Development Completion Check PASS，Verify Agent 的调用依据是已分配验证任务的实际执行结果与当前有效 Evidence，详见 [§11.1](#section-11-1)。脚本不生成 READY 或 Verification Gate PASS。当派发范围是“当前已批准的全部任务”而没有逐条 `task_refs` 时，caller 必须先从获批 `tasks.md` 确定本轮需完成的任务编号集合，并传入脚本；脚本不把未批准的新任务自动纳入完成范围。

正常 Procedure：

```text
取得当前 Change 的 tasks.md 独占写入权
→ 读取最新 tasks.md
→ 解析当前带 checkbox 的任务编号（如 1.1）
→ 校验显式 task_refs 在当前有效任务中存在且唯一
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
- `CONFLICT`：目标编号重复、已派发目标内容发生不允许的结构变化或当前 patch 无法安全应用；
- `INVALID`：输入、Change 或 `tasks.md` Contract 非法。

## 11.3 Controlled Serialization（受控串行化）

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

实现必须使用 **process-scoped exclusive file lock 或等价的进程退出可释放机制**；正常路径不得依赖需人工清理的长期 lock marker。2026-10-23 落地形态（landing 方案裁决 D2）：同目录 `tasks.md.patch-lock`——`wx` 原子抢占 + 写入 owner（pid / 时间戳）+ 有界重试（约 200ms 间隔、上限 30s，超时 BUSY）+ 进程退出清理 + stale 探测（pid 不可活或锁龄 >120s 可接管并记录），进程崩溃残留可自恢复。finalize 的根仓 mkdir 临界区（长临界区、跨步骤、需人工核对）是另一场景，维持不变。

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

## 11.4 Same-task and Structural Conflicts（同任务与结构冲突）

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
任务编号重复
目标 task line 无法唯一解析
并行 Development 期间出现影响当前有效派工的未授权任务新增 / 删除 / 重编号
任务正文发生无法解释的 Contract 变化
```

## 11.5 Update Frequency（更新频率）

`tasks.md` 不承担实时进度。

默认只在当前责任执行者取得本轮任务所需完成证据后批量更新一次。Engineer 按 [§11.1](#section-11-1) 先通过 Development Completion Check，再 Patch / 回读并核对发布依据，之后才形成 READY；Verify Agent 只更新已实际完成且证据有效的 assigned Verification Tasks，回读后再由 Verification Gate 检查。失败或未完成任务不勾选；Patch 未确认时 Engineer 不得发布 READY，Verification Gate 不得 PASS，但可保留已形成的实际验证报告与 Evidence。单纯写入失败恢复时可复用仍有效的验证证据，不机械重做验证。

---

<a id="openspec-schema-section-12"></a>

# 12. Artifact Write Permission Matrix（工件写权限矩阵）

| Artifact | Analysis | Development | Verify | Archive |
|---|---|---|---|---|
| `proposal.md` | Write | Read；Corrective 发现 Root Cause / Fix Strategy 等批准事实有问题则停止并升级 | Read | Preserve |
| `specs` | Write | 默认 Read；Requirement / Scenario 实质变化必须回 Review | Read | Apply/Archive |
| `design.md` | Write | 可在批准边界内细化 implementation detail | Read | Preserve |
| `tasks.md` task body | Write；Approval 前可创建/细化 | Approval 后默认 Read；执行时消费 Task + Verify；新增 Top-level Task 必须返回受控 Analysis / Rework 边界 | Read / Execute assigned verification tasks | Preserve |
| `tasks.md` checkbox | Initial | 通过 deterministic patch 更新 assigned task_refs | 通过同一受控机制更新被明确分配的 verification task_refs | Must be complete |

Engineer 对 Design / Tasks 的细化不能改变批准的 Engineering Contract。`tasks.md` 正文没有固定 `Verify:` 字段；Verification Evidence 来自实际测试 / Review / 当前候选版本，而不是字段存在性。

---

<a id="openspec-schema-section-13"></a>

# 13. Development Context from OpenSpec（从 OpenSpec 获取研发上下文）

Development 启动时至少取得：

```text
change_ref
schema
assigned task_refs
OpenSpec `instructions apply --json` 的只读 `contextFiles`（如适用）
approved baseline reference
登记的持久共享根仓路径、当前受控修订与尚未最终提交的进度（如有）
relevant Supporting Evidence references
```

Intentional 必须可读取：

```text
proposal
specs
tasks
design（仅在当前 Schema 条件要求生成时）
```

Corrective 必须可读取：

```text
proposal
tasks
specs（done 时）
```

Specs skipped 时不得伪造文件。

后续 Run 必须读取同一登记共享工作区的当前 Artifact，并区分已提交批准基线和获准的未提交研发修改；不得只从批准 Commit 重建一份缺少当前进度的副本。目录不可达、受控修改丢失或关键 Evidence 不可读时停止并交 Delivery Lead，不能凭历史完成结果猜测恢复。工作区访问能力仍须实测，本文不承诺 Runtime 自动共享目录。

额外 Supporting Design / Evidence 不属于 Schema Artifact 时，必须由稳定引用显式交接。`apply.requires` / `apply.tracks` 仅保留原生 readiness 与 checkbox tracking 语义；**`/opsx:apply` 不作为本项目研发执行入口**。实现、Task Set 控制、Evidence 与 Completion 均由 `development-execution` 及 [04](04-engineer-development-design-v1.15.4.md) 专业契约承担。

---

<a id="openspec-schema-section-14"></a>

# 14. Supporting Evidence（补充证据）

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

<a id="openspec-schema-section-15"></a>

# 15. Validation Contract（校验契约）

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

Schema 命令在当前 OpenSpec 文档中仍标记为 experimental，因此项目不是“动态跟随 CLI”，而是把已锁定的 `1.13.2` 行为作为本实施 Contract。任何版本升级必须重新运行本节与 [§19](#openspec-schema-section-19) Acceptance Cases。

实现完成后的 OpenSpec Native Verify 属于语义 Verification，不替代本节结构验证，也不自动替代真实 Integration / E2E；`/opsx:verify` 与不使用的 `/opsx:apply` 是不同能力。其报告必须区分实际检查、Not applicable 与 Not verified；尤其 `skip_specs: true` 时不得把 Spec-dependent checks 记为通过。

---

<a id="openspec-schema-section-16"></a>

# 16. Archive Contract（归档契约）

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

Archive 只处理 Engineering Artifact 生命周期；Delivery Issue 最终状态仍由 Multica [主方案](02-multica-delivery-lifecycle-design.md)控制。按 [02 §12.4](02-multica-delivery-lifecycle-design.md#final-completion)，Finalize 在同一登记共享根仓中归档，并将当前 Delivery 的授权研发修改、归档结果及适用主规格更新统一提交 Git；只处理明确范围，不夹带其他 Change 或暂存项。已有归档 / Commit 先回读后恢复缺失动作，不能重复应用 Delta；Commit 失败或结果 UNKNOWN 时不得关闭 Delivery。Engineer 的中间 Task Set READY 不要求这个最终 Commit 已完成。

### 附注：2026-10-23 实测事实（F0 与 design 条件位）

OpenSpec `1.13.2` 实测（landing 方案 §3/§3.1）：

- **Archive 命名**：`openspec archive` 落盘为 `archive/<YYYY-MM-DD>-<change-id>/`，日期为归档当天；逻辑 Change ID 不变，Resolver 剥脱日期前缀后匹配（§5.3）。
- **`specsUpdated` 标志 / `--json` 形状**：archive 的 JSON 输出含 `specsUpdated` 布尔标志；`skip_specs: true` 无 delta 的 Change 归档后 `specsUpdated: false`，不产生规格变化。
- **design 条件位无原生机制**：项目级 schema 格式（artifact-graph zod 定义）artifact 仅支持 `id/generates/description/template/instruction/requires` 六字段，无 conditional/optional 机制；design 的条件性只能由 instruction 文本与 Analysis Gate 承载（与内置 spec-driven schema 同限制，符合 §8.4 不设 `skip_design` 的设计）。
- **status 进度噪音**：无 design.md 的 intentional change `validate` PASS，但 `status` 永远显示 `3/4`，`instructions` 总引导补 design；**archive 不检查 design 存在**（archive 只校验 delta specs + tasks 进度），非阻塞。
- **Gate 契约约束**：任何 Gate / Completion Check 不得把 `openspec status` 的 "All planning artifacts complete" 作为就绪信号——无 design 的变更永远到不了该状态。

---

<a id="openspec-schema-section-17"></a>

# 17. Schema Evolution（Schema 演进）

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

<a id="openspec-schema-section-18"></a>

# 18. Implementation Deliverables（实施交付物）

第一批实施资产：

```text
openspec/schemas/corrective-change/schema.yaml
openspec/schemas/corrective-change/templates/*
openspec/schemas/intentional-change/schema.yaml
openspec/schemas/intentional-change/templates/*
projects/multica/scripts/resolve-change-identity.ts   # 原 resolve-openspec-change.py，TS 化（裁决 D1/D3）
projects/multica/scripts/update-task-progress.ts      # TS 化（裁决 D1/D3）
tests/   # 暂缓建设：验收以 O 系列手动执行记录替代（openspec-schema-landing-plan §7）
tests/schema/
tests/change-identity/
tests/task-contract/   # native checkbox / 编号定位 / patch / 冲突
tests/verification-contract/   # 验证 Evidence 与引用边界
```

~~完成上述资产与 Acceptance Cases 后，再同步修改 Workitem Analyst / Engineer / Delivery Lead / Verify Agent 相关 Skills 与 Delivery 主方案~~（已收口 2026-10-23：Workitem Analyst 步骤 3 创建闭环、Engineer 步骤 9 Task Progress Patch、delivery-flow materialize-development resolver 恢复与 02 §5.3.1/§8 指针均已接线，Verify Agent 预留调用时机见冻结契约 `development-execution/references/change-progress-script-contract.md`；实施方案 `change-identity-progress-wiring-plan.md`，验收 W1–W6）；Verify Agent 不再作为固定 Schema Stage，而作为按需 Independent Verification Executor。

---

<a id="openspec-schema-section-19"></a>

# 19. Acceptance Cases（验收场景）

## Case A（场景 A）— Corrective（纠正性变更） / no spec delta（无规格增量）

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

## Case B（场景 B）— Corrective（纠正性变更） / spec clarification（规格澄清）

```text
proposal
delta spec
tasks
apply
```

Archive 后长期规格正确更新。

## Case C（场景 C）— Intentional（意图性变更） / small change（小改动）

当不存在独立 Technical Design Decision：

```text
proposal
spec
design omitted (conditional)
tasks
apply
```

验证：

- Design 的四类触发条件均不适用；
- 不创建空 `design.md`，也不写 `skip_design`；
- `tasks.requires=[specs]` 不因设计文件缺省而阻塞；
- Tasks 可以直接从 Proposal / Specs 与现有代码约束形成；
- Analysis Gate 能确认省略依据。

## Case D（场景 D）— Intentional（意图性变更） / design required by condition（满足设计条件）

例如跨模块、新架构、新依赖 / 数据模型变化或 Security / Performance / Migration complexity：

```text
proposal
spec
design
tasks
apply
```

验证：`design.md` 记录真实 Technical Decisions、Trade-offs 与必要 Migration / Compatibility 约束，Review / Gate 不允许用空模板代替。

## Case E（场景 E）— Cross-repository Intentional（跨仓库意图性变更）

同一个 Change：

```text
Backend task_refs
Frontend task_refs
multiple PRs
```

Repository 数量不改变 Schema。

## Case F（场景 F）— Multi-Engineer Task Progress（多工程师任务进度）

```text
Backend Run → 1.1,1.2
Frontend Run → 2.1,2.2
```

期望：

```text
两个 Engineer Run 可以并行实现 / 验证
→ checkbox persistence 进入 change-scoped single-writer critical section
→ 后进入的 writer 读取前一个 writer 已提交的最新 tasks.md
→ 不发生 lost update
→ 不建设 completion store
```

两名 Engineer 分别负责不同业务 Repository，按 [02 §7](02-multica-delivery-lifecycle-design.md#development-materialization) 保持同仓唯一责任。分别验证 Check PASS 后才 Patch、回读前不发布 READY、发布前依据变化时重新检查；后续新 Run 应能读取共享根仓的受控未提交进度。根仓未最终 Commit 不阻塞 READY，修改丢失则停止并交 Lead，不能用旧结果自动补勾。

## Case G（场景 G）— Same-task Conflict（同任务冲突）

两个 Runtime 同时引用当前 Change 的任务 `1.2`。

期望：

```text
Runtime Projection 不应形成重复正常分配
→ conflict / UNKNOWN
→ Delivery Lead 协调

若第二个 patch 到达时 1.2 已完成
→ ALREADY_COMPLETE
→ 不重复写入、不伪造第二次完成
```

## Case H（场景 H）— Task Mutation After Approval（批准后的任务变更）

Engineer 在 Development 期间发现需要追加原批准范围之外的任务 `2.3`。

期望：

```text
Engineer 不直接改写已批准任务正文或擅自追加任务
→ STOP automatic mutation
→ 返回 Delivery Lead / Workitem Analyst
→ 受控追加
→ Contract / Scope 改变时重新 Human Review
```

验证：

- 旧 `task_refs` 可追溯；
- 已派发编号保持稳定，变更时受控核对旧引用；
- 不要求新的 `T-xxx` 分配器；
- Scope / Contract 变化按 Review 规则处理；
- 经批准取消 / 替换的任务保留非 checkbox 历史记录及批准依据，不伪造完成，Archive 不得把它误计为当前 required incomplete task；实现后以原生 Task Progress / Archive 回归验证。

## Case I（场景 I）— Task-level Verification Only（仅任务级验证）

单一 Backend Task 的行为可由该 Task 自身测试完整证明。

期望：

```text
Implementation Task + actual task-level verification evidence
→ no extra Verification Task
→ Assigned Engineer completes verification using appropriate test / CI / tooling evidence
```

不得为了“存在验证阶段”机械增加 Integration / E2E Task。

## Case J（场景 J）— Change-level Integration / E2E Verification（变更级集成 / 端到端验证）

Frontend、Backend 与 Persistence 分别由不同 Task 实现，最终用户行为只有组合后才能观察。

期望：

```text
Implementation Tasks
+ one Change-level Verification Task
→ verifies composed behavior
```

Verification Task 仍属于 `tasks.md`，不创建 `verification.md` / `acceptance.md`。

## Case K（场景 K）— Independent Verification Optionality（独立验证可选性）

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

## Case L（场景 L）— Change Identity Recovery（变更身份恢复）

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

## Case M（场景 M）— Runtime Baseline Drift（运行时基线漂移）

```text
OpenSpec != 1.13.2
或 schema which 不指向 Project Schema
→ Acceptance FAIL
→ 不执行 Schema / Archive 写操作或任何未授权研发动作
```

## Case N（场景 N）— Verification Task Executor Projection（验证任务执行者投影）

普通 Change-level 任务 `3.1` 与最终 E2E 行为对应。

```text
verify_agent.required = false
→ 3.1 assigned to Engineer
→ Engineer executes E2E using test/CI/runtime tooling

verify_agent.required = true
+ 3.1 overlaps Independent Verification Focus
→ 3.1 may be assigned to Verify Agent
→ one execution may satisfy both 3.1 completion and the overlapping independent verification scope
```

验证：

- `tasks.md` 中的 3.1 验证要求不因 Executor 改变；
- CI / test runner 只是执行机制，不拥有 Task；
- Engineer Evidence 不自动升级为 Independent Verification PASS；
- Verify Agent 执行 3.1 时可通过受控 `update-task-progress.ts` 更新该已分配 verification task_ref。
- 3.1 的实际验证与有效 Evidence 先于 Patch，Patch / 回读先于 Verification Gate；不以 Gate PASS 或 Engineer Completion Check 作为 Verify 写入前置。
- 写入失败时保留有效报告与 Evidence，先回读恢复；进度未确认前 Gate 不得 PASS，也不因单纯写入失败重复执行已有效完成的验证。

## Case O（场景 O）— OpenSpec Native Verify Execution（OpenSpec 原生验证执行）

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
- `skip_specs=true` 时 Spec-dependent checks 为 `NOT_APPLICABLE`；
- `/opsx:apply` 不参与当前项目 Development，`development-execution` 必须只执行批准的派发范围；原生 `instructions apply --json` 只用于只读上下文 / 进度检查。

---

## Case P（场景 P）— Intentional / no spec-level delta（无规格级行为增量）

当现有规格保持正确且本次不改变对外行为，仅涉及实现、工具或文档调整：

```text
proposal = done
specs = skipped (skip_specs: true)
design = done / omitted (conditional)
tasks = done
apply = ready
```

验收：
- Proposal 说明没有 Spec-level 行为变化的依据，不虚构 Capability；
- `.openspec.yaml` 显式设置 `skip_specs: true`，原生 status 回读为 skipped；
- `tasks.requires=[specs]` 接受 skipped，Design 仍按条件生成或省略；
- `openspec validate`、Archive 接受合法 zero-delta，不制造 Specs；
- 验证依据 Approved Proposal、适用的现行 Specs、Tasks 与真实 Evidence；新 Delta Coverage 为 Not applicable；
- 实际改变对外可观察行为时必须取消 skip 并编写 Delta Spec。

---

<a id="openspec-schema-section-20"></a>

# 20. External Contract Notes（外部契约说明）

当前 OpenSpec 官方 Schema Contract 明确区分：

```text
artifact.requires
= 原生构建硬依赖；不可凭 instruction 文字把缺失的必需依赖视为 done。条件性 Design 应从 tasks.requires 的硬依赖中移出，并由专业 Preparation / Gate 核对

apply.requires
= artifacts required before native apply readiness；不等同项目级 Human / Gate 准入，也不授权调用 `/opsx:apply`

apply.tracks
= Markdown checkbox task tracking file
```

`skip_specs: true` 在锁定的 OpenSpec `1.13.2` 中允许 Specs 被标记 skipped，并满足 Corrective / Intentional 的 Specs 依赖（需回归验证）；不得将真正的 Spec-level 行为变化标为 skipped。Intentional Design 不使用 `skip_design`：`tasks.requires` 仅保留 `specs`，需要 Design 的专业条件由 Preparation / Analysis Gate 实施；后续 OpenSpec 升级时重新验证。两种 Schema 均不调用 `/opsx:apply` 执行开发。

Reference:
- https://openspec.dev/docs/schemas/schema-yaml
- https://github.com/Fission-AI/OpenSpec/blob/main/docs/agent-contract.md
- https://github.com/Fission-AI/OpenSpec/blob/main/docs/cli.md

---

<a id="openspec-schema-appendix-a"></a>

# 附录 A. 版本记录（非现行实施规则）

## v1.5 Review Update Summary（评审更新摘要）

本版相对 v1.4 的主要变化：

- `intentional-change` 恢复 OpenSpec `spec-driven` 的 Conditional Design 语义：Proposal / Specs / Tasks 必需，Design 仅在存在真实 Technical Design Decision 时生成。
- Design 条件固定为四类：Cross-cutting / Architecture、Dependency / significant Data Model、Security / Performance / Migration、以及编码前需要固化的 Technical Ambiguity；条件不满足时不创建 `design.md`。
- 不引入 `skip_design` / `design_required`；保留 `tasks.requires=[specs,design]` 的 planning dependency，同时将 `apply.requires` 收敛为 `[tasks]`，由 Preparation / Analysis Gate 确认 Conditional Design 省略合法。
- 新增稳定 `<a id="task-identity-contract">` anchor，供 Development 方案引用，避免正文绑定具体 Schema Implementation 版本号。
- 同步当时 Guideline、Delivery、Analysis、Development 的已决规则；版本摘要仅为历史，不替代本次 §8 / §10 的 Native First Task Reference 契约。

---

## v1.3 Review Update Summary（评审更新摘要）

本版相对 v1.2 的主要变化：

- 明确区分 Verification Contract、Responsibility Executor 与 Execution Mechanism；CI / script / test runner 不再被描述成 Contract Owner 或 Runtime Owner；
- Change-level Verification Task 保持角色无关，Multica 可将其分配给 Engineer，或在已批准 Independent Verification 与该 Task 重合时分配给 Verify Agent；
- 明确 Verify Agent “可以执行 Verification Task，但不拥有 Verification Task 的定义权”；Task Contract 始终由 OpenSpec `tasks.md` 持有；
- 当 Verify Agent 执行的 Change-level Verification Task 同时覆盖 Independent Verification Focus 时，允许一次执行同时满足 Task Completion 与对应独立验收范围，避免机械重复 E2E / Integration；
- Task Progress 更新从 Engineer-only 表述收敛为 assigned executor，可由 Verify Agent 通过同一受控机制完成其 verification task_refs；
- `/opsx:verify` 明确为可选 Change-level Artifact-to-Implementation Verification：`verify_agent.required=true` 时由 Verify Agent 执行或复用当前候选版本结果；`required=false` 时默认不强制，仅在 Project / Change Contract 明确要求或需要 Change-level consistency audit 时执行；
- Related baseline 更新到 Delivery、Analysis、Engineer、Guideline。

---

## v1.2 Review Update Summary（评审更新摘要）

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

---

## Addendum 2026-10-23：裁决 D3 修订（skill-flow 收编）

按 `skill-flow-cli-plan.md`（机器安装模式），裁决 D1/D3 的"TS 单文件、位置 projects/multica/scripts/"
部署约定由 npm 包 `@winning/skill-flow`（`tools/skill-flow/`）收编 supersede：

- `resolve-change-identity.ts` → `skill-flow change resolve-identity`
- `update-task-progress.ts` → `skill-flow change update-progress`

§5（Change Identity）与 §11（Task Progress Update）的全部语义契约（查找顺序、result 枚举、
退出码、锁机制、创建闭环）不变，详见
`workspace-skills/development-execution/references/change-progress-script-contract.md` 同日 addendum。
迁移窗口期原路径保持可用；窗口期结束后原路径移除（plan §8.1 硬顺序）。
