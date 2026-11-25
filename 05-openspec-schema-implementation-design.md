# OpenSpec Schema Implementation Design（OpenSpec Schema 实施设计）

> Version: 1.5.4\
> Scope: Project-level OpenSpec Schema（项目级 OpenSpec 模式）、Templates（模板）、Task Contract（任务契约）与 Lifecycle Integration（生命周期集成）  
> Date: 2026-11-06  
> Author: winning/li_lei

> Status（状态）: Implementation Baseline（实施基线）— Verification Model Convergence（验证模型收敛）  
> OpenSpec Runtime Baseline（运行时基线）: `1.14.2`  
> Related Baseline（关联基线）: [02-multica-delivery-lifecycle-design.md](02-multica-delivery-lifecycle-design.md), [03-workitem-analysis-design.md](03-workitem-analysis-design.md), [04-engineer-development-design.md](04-engineer-development-design.md), [01-multica-openspec-design-guideline.md](01-multica-openspec-design-guideline.md)

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
| `P0-1` | P0 | OpenSpec 版本基线 | **Resolved** | 固定 `OpenSpec 1.14.2`，所有 Schema / CLI / Validation / Archive 测试以该版本为实施基线 |
| `P0-2` | P0 | OpenSpec 原生 Template Contract 粒度不足 | **Resolved (Native First)** | 沿用原生 Proposal / Delta Spec / Markdown checkbox 与可读编号；不强制 `[T-xxx]`、固定 `Verify:` 或平行 Acceptance ID；仅对实际派发的任务编号、引用及进度修改做必要确定性检查 |
| `P0-3` | P0 | AC / Verification Requirements 缺少稳定 Identity Contract | **Resolved by Native Model** | 不再设计 `AC-xxx` / `VR-xxx` 平行 Identity；有 Specs 时以 Requirement + Scenario 作为 Acceptance Contract（验收契约），验证执行要求进入 `tasks.md` |
| `P0-4` | P0 | Change Identity 的查找、创建、恢复不够确定 | **Resolved** | 参考历史 `fire` 分支的 resolver：只读 deterministic resolver、active-first、archive fallback、冲突/损坏不猜测、create-after-NOT_FOUND、可从部分失败恢复 |
| `P0-5` | P0 | 并行 Engineer 更新共享 `tasks.md` 可能 lost update | **Resolved** | 当前 Change 由一个 Engineer 维护任务进度；保留 Git 发布并发保护与稳定原生任务编号 |
| `P1-1` | P1 | OpenSpec Apply Context 与 Project Development Context 边界 | Open | 后续专项讨论；当前 [§13](#openspec-schema-section-13) 继续作为接口基线 |
| `P1-2` | P1 | Archive 与 `issue-closeout` 的实施接口偏薄 | Open | 后续只补 Integration Contract，不复制 Delivery [主方案](02-multica-delivery-lifecycle-design.md)状态机 |
| `P1-3` | P1 | Validation 负向 / 恢复测试覆盖不足 | Open | 按已收口的 Native First 契约补任务定位、进度修改与负向 / 恢复回归，不新增强制 Markdown Grammar |
| `P2-1` | P2 | Schema Evolution 可能引入不必要迁移复杂度 | Open | 后续讨论是否收缩为 v1 schema freeze / breaking change 禁止策略 |
| `P2-2` | P2 | Artifact Write Permission 与阶段方案存在规则重复 | Open | 后续按 One Rule, One Owner（单一规则、单一归属） 评审是否进一步收缩 |

当前实施顺序：

```text
已固化
→ P0-1 Runtime Baseline
→ P0-3 Native Acceptance / Verification Model
→ P0-4 Change Identity Resolver
→ P0-5 Task Progress Ownership

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

OpenSpec Schema 不负责 Multica 协作路由、Status、Assignment、Human Approval（人工批准）、Agent / Squad 调度、PR 状态或 Runtime Projection（运行时投影）。

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

不使用 Schema 表达 Multica Delivery Workflow。Artifact Instruction Assembly（工件生成上下文装配）的公共边界见[统一规范 §3.3](01-multica-openspec-design-guideline.md#artifact-instruction-assembly)；Skill 与 Artifact Contract 的消费和规则归属见[统一规范 §3.4](01-multica-openspec-design-guideline.md#skill-artifact-contract-boundary)。本方案记录工件的用途和取舍，实际依赖、生成指令与模板以项目级 Schema 文件为准。

### Agent Goal 与 OpenSpec Change Goal 的归属边界

Agent Instructions 的 Professional Goal（长期专业目标）与 Skill 的 Capability Outcome（局部能力目标）不属于 OpenSpec Schema 或 Artifact Field；本次变更的 Why / Goal / Scope 仍由 Proposal 等现有 Engineering Truth 持有。Skill 依据当前 Schema / Artifact Instruction / Template 准备产物，不另加 `agent_goal`、`skill_goal`、目标专用 Markdown、第二套 Acceptance Identity 或必填 Schema 字段。

本次 Goal Ownership 规范调整**不修改** `intentional-change`、`corrective-change` 的 Artifact Graph、Template Grammar、Native Validation 与 Archive 契约。

## 2.2 Explicit Contract over Implicit Assumption（显式契约优于隐式假设）

Schema 必须显式表达 Artifact dependency、conditional instruction 与 native apply entry；项目级 Human / Gate 准入不得靠“文件通常会存在”这类隐式假设。

`artifact.requires` 用于 Artifact 构建依赖；`apply.requires` 定义 OpenSpec 原生 Apply 何时可进入。Conditional Artifact 可以依照自身 instruction 明确省略，因此额外的条件性工件适用性须由 `spec-preparation` 与 Workitem Analyst 专业 Review 判定；现行 Rondo Analysis Gate 只检查其能够确定性核实的内容，不为此建立第二套 Artifact 状态。

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

- 新增或修改的行为用 OpenSpec `Requirement + Scenario` 说明验收条件，纯删除或重命名使用对应的 Delta 操作。
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
OpenSpec = 1.14.2
```

约束：

- `schema.yaml`、Templates、`skip_specs`、`artifact.requires`、`apply.requires`、`apply.tracks`、Validation 与 Archive 行为均以 `1.14.2` 为准；
- 实现与 CI / 本地 Acceptance Test 必须先确认 `openspec --version` 为 `1.14.2`；
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
| `schema.yaml` | Artifact 集合、依赖与 Apply 前置 | 不在公共 config、重复映射配置或 Skill 中复制依赖图 |

公共 rules 按 Artifact ID 匹配；两套 Schema 共享 `proposal`、`specs`、`tasks` 时，不能仅凭 ID 相同认定专业规则共用。Preparation 使用当前 Change 已确定的 Schema 读取指令；发现公共规则夹带专属要求时，应修正配置归属，不为满足错误规则制造无关章节或空产物。

实施验收应分别读取 Corrective / Intentional 的产物指令：公共规则在两者中均可用，专属要求只进入对应 Schema。Analysis 的配置使用边界见 [03 §9.3](03-workitem-analysis-design.md#openspec-configuration)，公共配置与 Schema 专属规则由本节统一维护；P0-2 已按 Native First 收口，不另增强制 Markdown Grammar。

---

<a id="openspec-schema-section-03"></a>

# 3. Canonical Mapping（统一映射）

```text
change_kind = corrective
→ schema = corrective-change

change_kind = intentional
→ schema = intentional-change
```

约束：

- Schema 根据 Workitem Analyst 对 Technical Change Kind（技术变更类型）的专业判断首次确定，并持久化到当前 Change；
- TFS Type、Repository 数量、PR 数量不决定 Schema；
- 一个 Issue 默认对应一个 active OpenSpec Change；
- Change ID 在首次 Preparation 时确定；
- 后续 Analysis Rework / Development Rework 使用同一个 Change；
- Schema 不在不同 Agent / Run 中重新选择。
- `analysis.change_kind=corrective|intentional` 由 `rondo analysis publish` 从通过 Gate 的当前 Change Schema 推导并持久化到 Multica Issue Metadata，供统计使用；Agent 不重复传入分类字段。它不写入 `.openspec.yaml` 作为额外字段，也不新增执行 Route。

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

tools/rondo/src/commands/change/resolve-identity.ts    # 当前 Change Identity Resolver

tests/
├── schema/
├── change-identity/
└── task-contract/
```

Schema 以 Project 级版本为准。执行前必须同时确认 OpenSpec 版本为 `1.14.2` 且 `schema which` 解析到项目级 Schema，不允许用户级同名 Schema 静默覆盖项目 Contract。

---

<a id="openspec-schema-section-05"></a>

# 5. Change Identity Contract（变更身份契约）

每个允许自动处理的 Delivery 默认只有一个 active OpenSpec Change。

正常关联事实由 Multica 保存，OpenSpec 不增加第二份 Delivery Mapping：

```yaml
analysis:
  change_ref: <stable-change-id>     # 当前 Issue Metadata 保存的字符串引用
  change_kind: corrective | intentional

# 具体路径由根仓 + Change ID 解析；Schema 由该 Change 的 .openspec.yaml 确认
```

`.openspec.yaml` 只保存 OpenSpec 自身需要的 Change / Schema metadata；不得为了 Change 查找把 Multica Status、Assignment、Review 或 Runtime State 复制进去。

## 5.1 Change ID Convention（变更 ID 约定）

新建获准准备的 Change 时，默认 Change ID 使用：

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
≠ Schema
```

Change ID 首次创建后保持稳定；Analysis Rework、Development Rework 不重命名、不新建平行 Change。Archive 改变存放路径时不改变逻辑 Change ID。

## 5.2 Deterministic Resolver（确定性解析器）

当前只读确定性入口为 `rondo change resolve-identity`，实现位于 `tools/rondo/src/commands/change/resolve-identity.ts`；历史 Python Script 不再是现行入口。它只解析 OpenSpec Change 身份，不引入新的 Runtime 或 Workflow State。

```text
rondo change resolve-identity --openspec-root <root> \
  [--change-ref <stable-change-id>] [--tfs-id <number>] \
  [--expect-schema <corrective-change|intentional-change>]
```

`--change-ref` 与 `--tfs-id` 至少提供一个；两者均已知时**同时传入**，不能仅因 `change_ref` 存在就忽略来源身份。`--openspec-root` 必须是经核实的当前项目根仓；`--expect-schema` 已知时传入。成功返回稳定 Change ID、路径、Schema 及当前查找结果。

结构化结果：

```text
ACTIVE_FOUND
ARCHIVED_FOUND
NOT_FOUND
CONFLICT
INVALID
```

Resolver 只读取和校验，不创建 Change、不修改 Multica、不修改 OpenSpec Artifact。当已存在的 `change_ref` 与同时提供的 `tfs.id` 后缀冲突时，返回 `CONFLICT`，不得接受或继续准备；仅在旧引用对应路径失效时才按可信 `tfs.id` 恢复查找，并保留恢复依据。

### 5.2.1 Primary Lookup（主查找）— persisted `change_ref`（持久化变更引用）

若 Multica 已保存 `change_ref`：

```text
读取 change_ref
→ 校验 id / path
→ 读取 .openspec.yaml / OpenSpec status
→ 校验 schema
→ 成功：ACTIVE_FOUND
```

`change_ref` 是正常定位使用的稳定 Change ID，不是目录路径；不应每次 Run 都扫描整个 `openspec/changes/` 重新推断身份。但两种身份均提供时，必须核对稳定后缀一致，不能让已存在但属于其他 TFS ID 的 Change 通过 Primary Lookup。

若引用路径不存在、已移动或不可解析，不立即创建新 Change，进入 Recovery Lookup。

### 5.2.2 Recovery Lookup（恢复查找）— active first（活动变更优先）

当 `change_ref` 缺失或当前 path 无法解析时：

```text
openspec/changes/
→ 排除 archive/
→ 查找 ID 与当前 TFS ID 稳定对应的候选 Change
→ 校验候选 .openspec.yaml / schema
```

规则与历史 `fire` 分支中 `fire-router.py` 的查找原则相同：

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

OpenSpec Archive 允许物理目录增加日期等归档前缀，但逻辑 Change ID 保持不变。Resolver 以 `change_ref` 稳定字符串 ID（存在时）或可信 TFS ID 后缀进行确定性匹配，并校验候选内容。

```text
0 个 archive candidate
→ NOT_FOUND

1 个 archive candidate
→ ARCHIVED_FOUND

>1 个 archive candidate
→ CONFLICT
```

`ARCHIVED_FOUND` 不表示可以重新激活 Change。Archive Fallback 同样必须核对已提供的双身份与预期 Schema，冲突不得作为恢复成功。Resolver 只返回事实；当前 Delivery 是否仅修复归档引用、是否属于异常 reopen，由 Delivery 生命周期规则处理。

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
→ 使用 OpenSpec 1.14.2 创建指定 schema 的 Change
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
→ archive fallback by change_ref（稳定字符串 ID）
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

`rondo change resolve-identity` 只承担：

```text
validate input
find active candidate
find archive candidate
validate identity / schema
return structured result
```

不承担：

```text
Technical Change Kind decision
Human Approval
Change content generation
Artifact mutation
Multica status mutation
Archive execution
```

这样保持历史 resolver 的设计性质：**deterministic lookup 是只读能力，创建与副作用由明确的 caller 在 resolver 结果之后执行。**

没有 Spec-level 行为变化时，`skip_specs: true` 的持久化仍按 OpenSpec `1.14.2` 原生 Contract 执行；Resolver 只校验，不自行推导该值。

---

<a id="openspec-schema-section-06"></a>

# 6. intentional-change Schema

适用于主动改变预期行为的工程变更，也适用于有明确目标但保持对外行为不变的内部调整。

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

上图 Design → Tasks 表示有关键技术决策时，任务应体现该决定。原生硬依赖见 [§6.3](#section-6-3)。

| Artifact | Output | Owns |
|---|---|---|
| `proposal` | `proposal.md` | 变更目标、范围、仓库授权，以及有 Delta 时涉及的 Capability |
| `specs` | `specs/<capability>/spec.md` | 需写入长期规格的 Delta，没有规格变化时可跳过 |
| `design` | `design.md` | 实现前需要确定的技术取舍，以及影响实施的约束 |
| `tasks` | `tasks.md` | Implementation Tasks、task-level verification、按需 Change-level Verification Tasks、task progress |

<a id="section-6-3"></a>

## 6.3 Executable Schema Baseline（可执行 Schema 基线）

[Intentional Schema](../../openspec/schemas/intentional-change/schema.yaml) 定义工件依赖与生成指令。Proposal 和 Tasks 是最小工件集。涉及长期规格的变化时增加 Delta Spec，否则在当前 Change 的 `.openspec.yaml` 中设置 `skip_specs: true`。

仅当技术决策会影响实施或验收时，补写 Design 并据此形成相关任务。Design 的适用性由专业分析判断。

---

<a id="openspec-schema-section-07"></a>

# 7. corrective-change Schema

适用于需要 OpenSpec、且目标是恢复既定行为的工程变更。诊断依据及修复方向由 Proposal 持有。

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
| `proposal` | `proposal.md` | 预期与实际行为、根因及依据、修复方向、回归范围和仓库授权 |
| `specs` | `specs/<capability>/spec.md` | 需要长期补录或澄清的既定行为 |
| `tasks` | `tasks.md` | Fix implementation tasks、每 Task 验证方法、按需 Regression / Integration / E2E Verification Tasks、task progress |

## 7.3 Executable Schema Baseline（可执行 Schema 基线）

[Corrective Schema](../../openspec/schemas/corrective-change/schema.yaml) 定义工件依赖与生成指令。现有规格已能说明正确行为时，Proposal 和 Tasks 即可交代如何恢复并验证。是否需要补录长期规格见下节。

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

## 8.1 Intentional（意图性变更）`proposal.md`

[Intentional Proposal 模板](../../openspec/schemas/intentional-change/templates/proposal.md) 说明期望达到的结果和范围，有 Delta 时列出对应的 Capability。两类 Change 均在 `.openspec.yaml` 顶层 `x-repositories` 中列出可修改的 `repo_id`，取值来自 [repo-context.yaml](../../docs/config/repo-context.yaml)；Proposal 不再维护第二份仓库清单。

## 8.2 Corrective（纠正性变更）`proposal.md`

[Corrective Proposal 模板](../../openspec/schemas/corrective-change/templates/proposal.md) 将故障现象、根因依据与验证修复是否有效的条件放在一起。证据只能支撑可能根因时，说明剩余的不确定性，引用需要复查的证据。

## 8.3 `spec.md`

[Intentional Spec 模板](../../openspec/schemas/intentional-change/templates/spec.md) 和 [Corrective Spec 模板](../../openspec/schemas/corrective-change/templates/spec.md) 均使用 OpenSpec 原生 Delta。新增或修改行为时用 Requirement 和 Scenario 表达。纯删除用 `REMOVED`，纯改名用 `RENAMED`，无需为这两种操作编造 Scenario。需要精确引用时，使用 Capability 路径和对应条目。

## 8.4 `design.md`

[Intentional Design 模板](../../openspec/schemas/intentional-change/templates/design.md) 记录会影响实施的关键技术决定及理由。设计已经明确、可依现有实现惯例完成时，直接省略该文件。

<a id="section-8-5"></a>

## 8.5 `tasks.md`

[Intentional Tasks 模板](../../openspec/schemas/intentional-change/templates/tasks.md) 和 [Corrective Tasks 模板](../../openspec/schemas/corrective-change/templates/tasks.md) 使用带稳定编号的 checkbox，记录可执行的工程结果及完成依据。单个任务能覆盖的验证放在该任务里，组合后才能观察到的行为按需列独立验证任务。

编号用于定位和受控进度更新，批准后的变更与勾选见 [§10](#openspec-schema-section-10) 和 [§11](#openspec-schema-section-11)。

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

仅当单个实现任务无法证明组合后的行为时，才单列验证任务。下列场景可能需要这类验证：

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
- 已派发任务的编号在该派工有效期间保持不变；当前文档中编号缺失、重复或不唯一时，拒绝无法确认身份的任务操作，不以任务标题或顺序猜测。
- Requirement / Scenario 精确定位使用 Capability Spec 路径 + 原生标题层级；Corrective 可用 `proposal.md` 与既有 Heading 定位。所有引用须能定位到当前可读内容，不创建 AC / VR / R / S ID。

```yaml
change_ref: <change-id>
task_refs: ["1.1", "1.2"]  # 只有精确派工时才需要
```

`Task Set` 是本次分派范围，不是单独持久化实体。

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

当前获批准的 Change 由 Engineer 负责整体实现和任务完成状态。根据实际研发与验证结果直接编辑 `tasks.md`，保持已批准任务正文、编号与范围不变；可随实际进度更新，不要求固定工具或批量更新时机。

不建立独立任务进度存储、写入命令、中央 Writer Agent 或文件锁。独立 Verify 的专业结论按其批准范围回流，不替代 Engineer 的研发任务完成判断。

## 11.2 Publish and Completion（发布与完成）

Engineer 提交必要研发工件并通过 `rondo dev publish` 发布固定研发版本。发布检查允许 checkbox 变化，拒绝批准契约实质漂移；`rondo pr materialize` 内部核验完整 Tasks、Candidate、Validation 和 Code Review。checkbox 不替代实际工程验证或 Independent Verification。

## 11.3 Concurrent Work（并发边界）

同一 Issue 保持唯一有效研发委派。发布冲突由现有 Git 并发保护处理；发生事实冲突时保留成果并协调，不覆盖已批准契约或其他 Change。

## 11.4 Task Identity（任务身份）

任务编号必须稳定且唯一；缺失、重复、非法或未完成任务按现有 PR 准入条件拒绝。不得凭旧结果虚假勾选。

## 11.5 Update Frequency（更新频率）

仅标记实际完成的任务，不要求一次性批量勾选。TFS 子任务、估算与工时由 `rondo tfs writeback` 管理，不属于 OpenSpec checkbox 更新职责。

---

<a id="openspec-schema-section-12"></a>

# 12. Artifact Write Permission Matrix（工件写权限矩阵）

| Artifact | Analysis | Development | Verify | Archive |
|---|---|---|---|---|
| `proposal.md` | Write | Read；Corrective 发现 Root Cause / Fix Strategy 等批准事实有问题则停止并升级 | Read | Preserve |
| `specs` | Write | 默认 Read；Requirement / Scenario 实质变化必须回 Review | Read | Apply/Archive |
| `design.md` | Write | 可在批准边界内细化 implementation detail | Read | Preserve |
| `tasks.md` task body | Write；Approval 前可创建/细化 | Approval 后默认 Read；执行时消费 Task + Verify；新增 Top-level Task 必须返回受控 Analysis / Rework 边界 | Read / Execute assigned verification tasks | Preserve |
| `tasks.md` checkbox | Initial | Engineer 按真实完成结果直接更新 | Read；独立验证结论按批准范围回流 | Must be complete |

Engineer 对 Design / Tasks 的细化不能改变批准的 Engineering Contract。`tasks.md` 正文没有固定 `Verify:` 字段；Verification Evidence 来自实际测试 / Review / 当前候选版本，而不是字段存在性。

---

<a id="openspec-schema-section-13"></a>

# 13. Development Context from OpenSpec（从 OpenSpec 获取研发上下文）

当前 Requirement 研发以已批准的整个 Change 为单位。根据 `analysis.source` 读取批准版本的 Proposal、Tasks、实际存在的 Delta Specs 和适用的 Design。Specs 已合法跳过时，使用 Proposal 和现行规格中的行为依据。有关键 Supporting Evidence 时保留可读取的引用。

继续研发时还需核对最新已发布的进度与 Evidence。工作区准备和发布见 [08-B](08b-requirement-remote-git-delivery.md)，Engineer 的执行与受控勾选见 [09](09-unified-engineer-development-design.md)。OpenSpec 的 `apply.requires` 和 `apply.tracks` 用于读取就绪状态和任务进度。

仍按 Task Set 派发的在途工作，沿用 [04](04-engineer-development-design.md) 中的 `assigned task_refs` 与工作区约定。

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
→ 必须为 1.14.2

openspec schema which
→ 必须解析到当前 Project Schema

openspec schema validate
openspec templates --json
openspec status --change <id> --json
openspec instructions <artifact> --change <id> --json
openspec instructions apply --change <id> --json
openspec validate <id> --type change --strict --json
```

对 `specs/**/*.md` 等 Glob，OpenSpec 原生 `specs=done` 不表示 Proposal 声明的每个 Capability Spec 均已存在；具体文件集合与 Conditional Design 的适用性由 `spec-preparation` / Workitem Analyst 专业 Review 核对，当前 `rondo analysis validate` 主要检查可确定的存在性、格式、原生 skip 与 CLI Validation，不提供完整语义覆盖保证。

Schema 命令在当前 OpenSpec 文档中仍标记为 experimental，因此项目不是“动态跟随 CLI”，而是把已锁定的 `1.14.2` 行为作为本实施 Contract。任何版本升级必须重新运行本节与 [§19](#openspec-schema-section-19) Acceptance Cases。

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

Archive 只处理 Engineering Artifact 生命周期；Issue 最终状态仍由 Multica [主方案](02-multica-delivery-lifecycle-design.md)控制。按 [02 §12.4](02-multica-delivery-lifecycle-design.md#final-completion)，Finalize 在同一登记共享根仓中归档，并将当前 Delivery 的授权研发修改、归档结果及适用主规格更新统一提交 Git；只处理明确范围，不夹带其他 Change 或暂存项。已有归档 / Commit 先回读后恢复缺失动作，不能重复应用 Delta；Commit 失败或结果 UNKNOWN 时不得关闭 Delivery。Engineer 的中间 Task Set READY 不要求这个最终 Commit 已完成。

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
tools/rondo/src/commands/change/resolve-identity.ts  # 当前 Change Identity 实现
tests/schema/
tests/change-identity/
tests/task-contract/   # native checkbox / 编号定位 / 契约一致性
tests/verification-contract/   # 验证 Evidence 与引用边界
```

完成上述资产与 Acceptance Cases 后，再同步修改 Workitem Analyst / Engineer / Delivery Lead / Verify Agent 相关 Skills 与 Delivery [主方案](02-multica-delivery-lifecycle-design.md)；Verify Agent 不再作为固定 Schema Stage，而作为按需 Independent Verification Executor。

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

- 当前实现可沿用既有做法，任务可直接执行；
- 不创建空 `design.md`，也不写 `skip_design`；
- `tasks.requires=[specs]` 不因设计文件缺省而阻塞；
- Tasks 可以直接从 Proposal / Specs 与现有代码约束形成；
- Workitem Analyst 在专业 Review 中确认 Design 省略依据；现行确定性 Gate 不直接判断其必要性。

## Case D（场景 D）— Intentional（意图性变更） / design required by condition（满足设计条件）

例如数据迁移需要先决定如何兼容旧记录，决定会影响实施与验证：

```text
proposal
spec
design
tasks
apply
```

验证：`design.md` 记录真实 Technical Decisions、Trade-offs 与必要 Migration / Compatibility 约束；专业 Review 不允许用空模板代替，不能将 Gate PASS 当作语义完整性的证明。

## Case E（场景 E）— Cross-repository Intentional（跨仓库意图性变更）

同一个 Change：

```text
Backend task_refs
Frontend task_refs
multiple PRs
```

Repository 数量不改变 Schema。

## Case F（场景 F）— Change Task Progress（Change 任务进度）

Engineer 按实际完成结果更新 checkbox；跨仓库实现仍由同一获授权 Engineer 负责。发布保留任务正文、编号与其他 Change，PR 准入检查所有必需任务完成。

## Case G（场景 G）— Concurrent Conflict（并发冲突）

发现同一 Issue 重复有效委派或 Git 发布冲突时，保留成果并协调，不覆盖其他工作。

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
OpenSpec != 1.14.2
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
- 独立验证结果按批准范围回流；Engineer 根据真实研发与验证结果维护 Tasks。

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

`skip_specs: true` 在锁定的 OpenSpec `1.14.2` 中允许 Specs 被标记 skipped，并满足 Corrective / Intentional 的 Specs 依赖（需回归验证）；不得将真正的 Spec-level 行为变化标为 skipped。Intentional Design 不使用 `skip_design`：`tasks.requires` 仅保留 `specs`，是否需要 Design 由专业分析和 Review 判断；后续 OpenSpec 升级时重新验证。两种 Schema 均不调用 `/opsx:apply` 执行开发。

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
