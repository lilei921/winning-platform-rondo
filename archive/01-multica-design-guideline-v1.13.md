# Multica Agent（智能体） / Squad（小队） / Instructions（指令） / Skill（技能）设计规范

> Version: 1.13  
> Scope: Multica 设计文档、Workspace（工作区）中 Agent / Squad / Instructions / Skill 及执行上下文的设计；公共原生机制、官方来源与引用规范  
> Date: 2026-10-07  
> Author: winning/li_lei

本规范用于指导后续配置设计与评审，约定内容职责和设计原则。具体实现、触发机制、调度方式及运行时适配由后续方案确定；文中的 Gate（门禁） / Route（路由）等设计约定不表示相关机制已经实现。

---

## 1. 目的

本规范用于统一 Multica 中以下资产的职责和设计方式：

- Agent Description（智能体描述）
- Squad / Squad Instructions（小队 / 小队指令）
- Agent Instructions（智能体指令）
- Autopilot Prompt（自动驾驶提示词）
- Skill（技能）
- Workspace Context（工作区上下文）
- Project / Issue Context（项目 / 事项上下文）
- Deterministic Gate / Route（确定性门禁 / 路由）

核心目标是避免：

- Agent Prompt 过长；
- Prompt、Skill、Workflow 重复定义同一规则；
- LLM 承担本可由确定性逻辑完成的决策；
- 不同层级配置发生职责重叠；
- Workflow 变化后 Prompt 与实际流程产生漂移。

核心原则：

> **Agent Description 说明“这个 Agent 是干什么的”；Squad 定义“哪些 Agent 作为一个协作单元工作”；Squad Instructions 定义“Leader 如何组织成员协作与交接”；Autopilot Prompt 定义“为什么触发这次 Run、这次 Run 要完成什么”；Agent Instructions 定义“这个 Agent 是谁、负责什么以及如何做决策”；Skill 定义“某类工作具体怎么做”；Issue 定义“这一次具体要做什么”；Deterministic Gate / Route 决定“满足什么条件才能继续以及确定性的下一步是什么”。**

## 1.1 全局编写原则

以下原则适用于 Agent Description、Squad Instructions、Agent Instructions、Autopilot Prompt、Skill 及相关配置资产。具体资产不重复抄写这些原则。

### Native First（原生优先）

先使用 Multica 已有的 Assignment、Squad、Comment、Parent / Child、Stage 与 Run 能力。简单稳定的成员分工写入 Leader 可见的协作规则；规则能够程序化不代表必须新增脚本。仅为明确的业务校验、批量处理、副作用幂等或恢复需求增加 Script / Gate，不预设第二套 Runtime、全局锁或事务框架。

### Greenfield First（目标态优先）

只描述当前目标状态。除非当前系统明确要求兼容，否则不维护历史方案、旧术语、迁移路径、版本差异或兼容分支。

### Minimal Sufficient（最小充分）

只保留影响职责、决策、执行、验证、输出或停止条件的信息。删除后不影响正确执行的内容不进入配置资产。

### Contract First（契约优先）

直接定义职责、输入、规则、流程、输出和停止条件。默认不写背景叙述、设计过程、方案比较、设计理由或重复说明。

统一表达方式：

```text
必须……
不得……
仅当……才……
如果……则……
输入……
输出……
失败时……
```

规则优先于提醒，契约优先于解释。

<a id="runtime-artifact-principle"></a>

### Runtime-Centric Delivery（以运行时为中心的交付） + Artifact-Centric Engineering（以工件为中心的工程）

本项目的跨系统信息架构遵循：

> **充分利用 Multica 的 runtime-centric 协作能力 + OpenSpec 的 artifact-centric 技术契约。**

其权威边界为：

> **OpenSpec = Engineering Truth（工程事实）。**

> **Multica = Delivery Truth（交付事实）。**

具体约束：

- **Engineering Truth**：Requirement / Scenario、Corrective Expected Behavior / Root Cause / Fix / Regression Scope、设计、Implementation / Verification Tasks、Evidence，以及 Engineer / Verification Executor 后续需要长期消费的技术事实，优先由 OpenSpec Change 或明确的 Supporting Artifact 持有；
- **Delivery Truth**：Route、Status、Assignment、Review、Approval、Gate、`verify_agent.required` / Independent Verification（独立验证） Result、Run、Sub-Issue 以及协作与交付事实，优先使用 Multica 原生 Issue / metadata / custom property / comment / status / assignment / run result 承载；
- **Reference, not Replication（引用而非复制）**：两个事实域通过稳定引用连接，不为了交接、展示或方便读取而复制对方的正文事实；
- **No Third Truth Store**：不得仅为跨阶段交接新增拥有独立 schema、lifecycle、version、status 或 reconciliation 的第三套 Contract Store / Runtime Object / Workflow State；
- **One Rule, One Owner（单一规则、单一归属）**：新增事实前先判断它属于 Engineering Truth 还是 Delivery Truth，再放入对应权威 Owner；如果只是摘要、交接或展示，则只保存引用或 View。

该原则是后续设计 Agent、Squad、Skill、Gate、Artifact、Metadata 和跨 Run Handoff 时的**第一归属判断规则**，与 Native First、Deterministic First / Semantic Fallback、One Rule / One Owner 同级使用。具体 Method / Artifact / Runtime Fact / View 分类见 §1.5。

---

## 1.2 Canonical Terminology（统一术语）

本规范同时作为当前 Multica 研发交付方案的 **Canonical Terminology（统一术语）** 权威来源。

核心规则：

> **一个实体只维护一个正式名称。Name、Object Type、Role / Relationship、Display Name 必须区分，不得互相替代。**

例如：

```text
Name       = Delivery Lead
Object Type = Agent
Squad Role = Leader
Squad      = Delivery Squad
```

`Squad Leader` 描述的是关系，不是 `Delivery Lead` 的第二个正式名称。

### 1.2.1 Squad / Agent Canonical Names（小队 / 智能体统一名称）

| Concept | Canonical Name | Object Type | 允许的关系描述 | 禁止作为同一实体的第二名称 |
|---|---|---|---|---|
| 研发交付协作单元 | `Delivery Squad` | Squad | Squad | Delivery Team / Delivery Group |
| Delivery Squad Leader | `Delivery Lead` | Agent | Leader / Squad Leader | Delivery Lead Agent / Lead |
| 分析成员 | `Workitem Analyst` | Agent | Member | Analyst / Workitem Analyst Agent |
| 后端研发成员 | `Backend Engineer` | Agent | Member / Engineer | Backend Agent |
| 前端研发成员 | `Frontend Engineer` | Agent | Member / Engineer | Frontend Agent |
| Flink 研发成员 | `Flink Engineer` | Agent | Member / Engineer | Flink Agent |
| 独立验证成员 | `Verify Agent` | Agent | Member / Independent Verification Executor | Verify / Verifier / Verification Agent |
| TFS 同步 | `TFS Sync Agent` | Agent | Squad 外 Agent | Sync Agent |

其中 `Leader`、`Member`、`Squad Leader`、`Engineer`、`Specialist Agent` 只能用于描述类型、关系或角色类别；当指向具体 Multica 配置对象时，必须使用对应 Canonical Name。

<a id="delivery-object-terminology"></a>

### 1.2.2 Delivery Object Canonical Names（交付对象统一名称）

| Concept | Canonical Name | 含义 |
|---|---|---|
| TFS 来源对象 | `TFS Work Item` | 外部工作项 |
| 完整交付对象 | `Delivery Issue` | 一个 TFS Work Item 在 Multica 中的完整交付对象 |
| 工程变更契约 | `OpenSpec Change` | 当前变更的 Engineering Truth 容器 |
| 工程任务 | `OpenSpec Task` | `tasks.md` 中的 Implementation Task 或按需 Verification Task |
| 实现任务 | `Implementation Task` | 产生代码、配置或其他工程修改，并包含与该任务对应的 Task-level Verification |
| 变更级验证任务 | `Verification Task` | 仅在完整行为必须跨 Task / Module / Repository / System / User Journey 组合后验证时创建；Regression / Integration / E2E 是可选验证方法，不是独立 Stage |
| 独立验证活动 | `Independent Verification` | `verify_agent.required=true` 时由 Verify Agent 对固定候选版本执行的独立行为验收；属于 Delivery Activity，不是新的 OpenSpec Artifact 或 Multica Stage |
| 本次分派范围 | `Task Set` / `task_refs` | 某次 Engineer Run 被明确分配的一组 OpenSpec Tasks；是引用集合，不是独立持久化对象 |
| 独立运行子任务 | `Development Sub-Issue` | 当一组 `task_refs` 的执行需要独立 Owner / Status / Block / Retry / Completion / Stage 时创建的 Multica Sub-Issue |
| 仓库级修改对象 | `Repository Change` | 某个 Repository 的代码修改与交付范围 |
| 仓库级代码交付对象 | `PR` | 一个 Repository 的 Pull Request |

正式关系：

```text
Delivery Issue
    ↓
OpenSpec Change
    ↓
tasks.md / OpenSpec Tasks
    ↓
Delivery Lead Runtime Projection
    ├─ Parent Issue + @mention + task_refs
    └─ Development Sub-Issue + task_refs（仅需独立 Runtime State 时）
    ↓
Repository Change
    ↓
每个发生代码变更的 Repository Change 对应独立 PR
```

OpenSpec Tasks 表达工程工作分解；Multica 只投影执行者与运行方式。Task 数量、Task Group、Engineer 数量、Repository 数量或 PR 数量都不自动要求创建 Development Sub-Issue。

### 1.2.2a OpenSpec Change（变更）、Technical Change Kind（技术变更类型）与 Schema（模式）

`OpenSpec Change` 是变更及其 Artifact Contract，不是 Multica Issue、Run 或审批状态。OpenSpec Tasks 表达工程工作；Multica 通过 `task_refs` 将其投影为 Agent Run 或按需的 Development Sub-Issue。当前映射与生命周期由主方案 §7.1、§10–§14 维护。

必须区分四个概念：

```text
TFS Type
= 公司管理事实

Technical Change Kind
= corrective | intentional

Delivery / Analysis Route
= bug-fix | production-fix | sdd-fast | sdd-standard

OpenSpec Schema
= 当前 Change 的 Artifact Contract
```

Schema 解决“一个 Change 有哪些 Artifact、如何依赖、生成指令和 Apply 前置是什么”；Route 解决“当前任务应使用哪种专业分析 / 研发路径”。Schema 不决定 Owner、Human Approval（人工批准）、Verify required、Issue Status、PR 生命周期或任务优先级。

### 1.2.2b Canonical OpenSpec Schema IDs（统一 OpenSpec Schema 标识）

当前正常自动 Route 的 Schema ID 统一为：

| Technical Change Kind（技术变更类型） | Canonical Schema ID | 当前 Route |
|---|---|---|
| `corrective` | `corrective-change` | `bug-fix` / `production-fix` |
| `intentional` | `intentional-change` | `sdd-fast` |

项目 Schema ID 使用 kebab-case，并采用当前统一的 `<technical-change-kind>-change` 双单词命名风格。双单词是本项目 Canonical Naming 约定；不将其描述成 OpenSpec 的通用强制长度规则。

Schema ID 必须表达 **Technical Change Contract**，不得使用以下维度替代：

```text
TFS Type        → bug / requirement
Delivery Route  → bug-fix / production-fix / sdd-fast
紧急程度        → hotfix / urgent
复杂度          → simple / complex
```

因此：

```text
TFS Bug
→ change_kind = corrective
→ route = bug-fix
→ schema = corrective-change

TFS Requirement + Corrective
→ route = production-fix
→ schema = corrective-change

TFS Requirement + Intentional
→ route = sdd-fast
→ schema = intentional-change
```

Change 首次准备时持久化 Schema，后续 Workitem Analyst、Engineer、Finalize 从 `.openspec.yaml` / 原生事实读取，不在每个 Run 重新推断。

现有项目级 `sdd` Schema 不是上述 Canonical Schema ID。它继续服务已有 active / archived Change 的解析与历史兼容，并可作为未来 Full-SDD / `sdd-standard` 候选重新评审；当前不把它映射到 `sdd-fast`，也不因命名相似而自动迁移。

当前 OpenSpec 使用 **统一 Change Model + 分型项目 Schema**。Schema 专业产物定义位于 Analysis 方案 §9、§26，本手册只维护 Canonical ID、职责边界和跨文档命名规则。

<a id="status-terminology"></a>

### 1.2.3 Status Key（状态键）与 Display Name（显示名称）

配置、Metadata、Script、Gate、Route 中必须使用 **Status Key**；UI 和面向人的自然语言说明可以使用 **Display Name**。

当前 Analysis Human Gate 的正式定义为：

| 属性 | 值 |
|---|---|
| Status Key | `analysis_review` |
| Display Name | `Analysis Review` |
| Category | `started` |

因此：

```text
status = analysis_review
```

是机器可执行 / 可判断的正式写法；`Analysis Review` 只用于 Board、List、UI 和自然语言展示。

当前 Delivery 生命周期涉及的 Status Key 统一使用：

```text
backlog
todo
in_progress
analysis_review
in_review
blocked
done
```

不得再建立 `analysis.review_status = waiting | approved | rejected` 等第二套 Analysis Review 状态。

### 1.2.4 Analysis Route Canonical IDs（分析路由统一标识）

当前一级 Analysis / Delivery Route 统一为：

```text
bug-fix
production-fix
sdd-fast
sdd-standard
```

`hotfix` 当前不建模为独立 Route / Policy。

<a id="gate-terminology"></a>

### 1.2.5 Gate Canonical Names（门禁统一名称）

当前交付方案统一使用以下名称；对应控制职责由主方案维护，本节只维护正式名称，不表示这些 Gate 是 Multica 内置功能：

```text
Analysis Gate
Development Completion Check
Verification Gate
PR Transition Gate
Delivery Completion Gate
```

当前控制职责与适用范围见 [主方案：Deterministic Gate](02-multica-squad-centric-delivery-v1.4.19.md#delivery-gates)。


### 1.2.6 Naming Usage Rules（命名使用规则）

后续所有 `multica-squad-centric-delivery`、`workitem-analysis`、Agent Instructions、Squad Instructions、Skill、Config、Script 和 Artifact 遵循以下规则：

1. 指向具体 Multica 对象时，使用 Canonical Name，不使用简称或角色关系替代名称；
2. 配置、状态判断和脚本使用 Canonical Key / ID，不使用 Display Name；
3. `Analyst` 不再作为 `Workitem Analyst` 的别名；
4. `Verification` / `Verify` 可表示验证活动；`Regression / Integration / E2E` 是 Verification Method；指 Agent 时必须写 `Verify Agent`，其正式角色是按需 Independent Verification Executor；
5. `Engineer` 仅可作为 Backend / Frontend / Flink Engineer 的角色类别；指具体 Agent 时使用完整名称；
6. `Parent Issue`、`Development Issue` 不再作为正式交付对象名称；
7. 下游方案只引用本节定义，不独立维护第二份全局术语表；
8. 新增术语时优先更新本节，再同步修改引用方案，遵守 **One Rule, One Owner**。


### 1.2.7 Bilingual Terminology Rule（中英文术语标注规则）

面向人的设计文档中，核心英文概念首次出现或作为章节标题出现时，统一采用 **English Term（中文说明）**。中文用于降低阅读成本，英文继续承担 Canonical Name、标准名或跨文档检索锚点。

规则：

1. 架构、流程、职责、契约等概念性术语应补中文说明，例如 `Canonical Terminology（统一术语）`、`Runtime Projection（运行时投影）`、`Engineering Truth（工程事实）`；
2. Agent / Squad / OpenSpec Artifact 等正式对象名称保留英文正式名，可在首次出现时补中文语义，不另造第二个 Canonical Name；
3. 代码标识符、CLI 参数、Status Key、Route ID、Schema ID、文件名、路径、YAML / JSON 字段和值不翻译、不改写；
4. 同一小节内已经解释过的术语不要求每次重复括注，避免括号噪声；
5. 下游设计文档遵循本规则，不单独维护另一套中英文术语表。

---

<a id="design-document-scope"></a>

## 1.3 设计文档与执行资产

本手册同时约定设计基线和执行资产的内容边界，两者不使用同一精简尺度。

### 1.3.1 Design Document Header（设计文档头）

01–19 核心设计文档统一使用以下头部格式；版本号不再重复写入一级标题：

```markdown
# <Document Title>

> Version: <version>  
> Scope: <scope>  
> Date: YYYY-MM-DD  
> Author: winning/li_lei
```

`Status`、`Related Baseline`、`Runtime Baseline` 等文档特有元数据放在标准头之后的独立引用块中，不打乱上述四个固定字段。

| 资产 | 保留内容 | 不承担的内容 |
|---|---|---|
| 主方案 / 阶段设计文档 | 当前职责、输入、规则、流程、输出、停止与验收要求；帮助理解现行设计的必要业务背景 | 独立维护其他文档已经拥有的完整规则 |
| Agent / Squad Instructions、Autopilot Prompt | 对实际接收者长期或本次运行必需的约束 | 历史记录、冗长背景、完整专业 Procedure |
| `SKILL.md` | 当前方法的最小充分执行契约及按需引用 | 版本演进、完整设计说明、整份官方手册 |
| 历史变更记录 | 当时的变更、旧名称和版本引用 | 当前授权、状态机、产物要求或执行依据 |

必要业务背景可以在设计文档中完整保留。例如，公司对 TFS Bug / Requirement 的绩效、工作量和 Task 管理差异，是理解管理类型与技术语义分离的依据；不因它不是执行步骤而压缩或删除，也不要求各 Skill 重复加载。

设计文档可以保留最终执行模型、决策表和核心原则，作为当前规则的摘要视图；跨阶段摘要须与主方案对齐或引用主方案，不独立改写详细契约。删除跨文档内容前先确认权威来源完整覆盖；未覆盖的必需规则先确定归属，不直接删除。

历史摘要允许暂时保留在独立区域，明确不作为当前执行规则。升级当前版本时不把历史版本号和旧设计改写成现行内容；正文中的废弃方案理由和未来假设不因有历史区而继续重复维护。

<a id="document-ownership"></a>

## 1.4 文档体系与权威归属

| 文档 | 权威维护的内容 | 其他文档的使用方式 |
|---|---|---|
| 本手册 | 编写原则、公共术语、配置边界、Multica 原生机制及官方依据、来源引用规范 | 引用具体条目，保留必要使用约束，不复制完整公共机制 |
| [Delivery 主方案](02-multica-squad-centric-delivery-v1.4.19.md) | 跨角色生命周期、人工授权、状态转换、任务组织、TFS、Stage 使用、Verify 批准、PR 与最终收口 | 阶段文档保留自己的输入输出和停止边界，引用跨阶段流程 |
| [Workitem Analyst / Analysis 阶段方案](03-workitem-analyst-stage-design-v1.17.md) | 分析角色、输入、分类与方法、OpenSpec Engineering Truth、Multica Analysis Handoff Facts、Verify 推荐生成、Analysis Gate（分析门禁） 细项、提交与定向返工 | 主方案维护交付摘要，引用详细专业契约 |
| [Engineer / Development 阶段方案](04-engineer-development-stage-design-v1.14.md) | 当前 assigned Task Set（任务集合） 的工程方法、Local Validation（本地验证）、Code Review（代码审查）、Evidence、工程交付与技术决策边界 | 主方案引用专业契约，不复制全部实现与检查方法 |

“上位方案”不表示所有专业细则都必须放在主方案。按规则适用范围确定唯一维护位置；规则归属与实际执行它的 Agent / Script 分开定义。发现冲突时按明确归属核对，无法确认则提出修正，不以文档层级或新版本号静默覆盖业务含义。

阶段设计中的“Analysis 阶段”“Development 阶段”指 Delivery 生命周期的专业工作区段，不对应 Multica 原生 Stage。原生机制见 [Parent / Child 与 Stage](#mechanism-parent-stage)，本项目的使用规则由主方案维护。

---

## 1.5 Method（方法）、Artifact（工件）、Runtime Fact（运行事实）与 View（视图）的边界

本节落实 [§1.1 Runtime-Centric Delivery（以运行时为中心的交付） + Artifact-Centric Engineering（以工件为中心的工程）](#runtime-artifact-principle) 的全局原则。为避免“每执行一个 Skill 就生成一个同名文档”，也避免为了去文档化又创造第三套 Contract Store，专业阶段统一只区分四类概念：

| 概念 | 定义 | 设计要求 |
|---|---|---|
| Method / Skill | 如何调查、分析、Review 或执行 | Skill 名称不自动要求同名 Markdown；方法本身不是持久化对象 |
| Artifact | 后续角色长期消费的专业事实与证据，例如 OpenSpec Proposal / Spec / Design / Tasks、必要 Evidence | `bug-analysis` 等 Method 不因名称自动成为 Artifact；专业事实只保留一个 Owner，Corrective 最终结论进入 Proposal |
| Runtime / Handoff Fact | 路由、审核、Gate、批准、Assignment、Status、Verify 是否执行等交付事实 | 优先使用 Multica Issue / metadata / custom property / comment / run result 等原生能力；不另造独立对象生命周期 |
| View / Summary | 面向人的摘要与展示 | 从 Artifact + Runtime Fact 渲染，不成为新的 Truth Source |

本节不重新定义跨系统原则；Engineering Truth / Delivery Truth 的权威定义见 §1.1。这里进一步约束：

> **Skill ≠ Artifact。**

> **Summary / View ≠ Truth Source。**

Supporting Evidence（补充证据） 是 Artifact 或 External Reference 的一种，不单独形成新的架构层；Package 只是“当前审核 / 交接需要读取的一组现有事实”的普通集合概念，不是 Domain Type，也不自动创建 `<package>.md`。

判断是否新增持久化内容时依次询问：

```text
1. 这是 Engineering Truth 还是 Delivery Truth？
2. Engineering Truth 是否已经有 OpenSpec / Supporting Artifact Owner？
3. Delivery Truth 是否可以直接由 Multica 原生 Issue / metadata / comment / run result 承载？
4. 是否只是为了展示或交接而复制已有事实？如果是，只保留引用或 View。
5. 新增对象是否会引入自己的 schema / lifecycle / version / status / reconciliation？如果会，默认不要新增。
```

删除固定 Markdown 不等于删除 Contract；应先把技术事实迁移到明确 Artifact Owner，把交付事实映射到 Multica 原生事实，再取消重复载体。

# 2. Multica 官方机制核实

<a id="mechanism-agent-description"></a>

## 2.1 Agent Description（智能体描述）

**官方机制：** Description 是显示在 Agent 列表和详情中的团队介绍，不进入 AI 编程工具的执行 Prompt。不能依赖它约束 Agent 行为。

来源：[创建和配置智能体](#source-agent-config)，文档核对日期 2026-09-29。具体角色描述按 §5 编写。

<a id="mechanism-agent-instructions"></a>

## 2.2 Agent Instructions（智能体指令）

**官方机制：** Instructions 在每次执行提供给对应 Agent，适合描述职责和禁止事项、开始检查、修改边界、交付方式与需向成员确认的情况。

**本项目约定：** Instructions 维护稳定 Role Contract；详细可复用执行方法属于 Skill，五段式结构是本手册约定，不是官方固定模板或长度限制。

来源：[创建和配置智能体](#source-agent-config)，文档核对日期 2026-09-29。

<a id="mechanism-assignment"></a>

## 2.3 Assignment（分派）、启动与请求级暂不启动

**官方机制：** Assignment 改变长期 Ownership；当前评论范围的协助使用 `@mention`，不改变 Owner。分配给 Squad 时首先启动 Leader，不自动并行启动全部成员。固定 `backlog` 在正常创建 / 分配路径停放任务；自定义状态即使属于 `unstarted`，也不继承该特殊行为。

“暂不启动”只抑制本次请求。官方手册列出 `issue assign / update / status --no-start`；一次流程有多次写入时分别处理，不能把一次抑制当作后续操作的持久化开关。改 Owner 或 Status 不取消已经运行的 Run；正常交接需要启动新 Owner 时，不应误用暂不启动。

来源：[Assignment](#source-assignment)、[CLI](#source-cli)、[状态触发公开实现入口](#source-issue-trigger)，文档核对日期 2026-09-29。API 的 `suppress_run` 字段及各写入口行为须以团队安装版本的 API Contract 和实测确认；不能仅据 CLI flag 推断所有 API 都接受该字段。

**本项目约定：** 一个工作只采用一个正常派发入口；具体准备、状态写入、启动顺序及恢复由主方案 / Skill 定义。本条不授予成员额外状态写入权限，不构成全局锁。

<a id="mechanism-issue-run"></a>

## 2.4 Issue Status（事项状态）与 Run（运行）生命周期

**官方机制：** Issue 保存工作目标和交付状态，Run 保存一次执行；一个 Issue 可以有多次 Run。Run 正常结束本身不将 Issue 自动置为 `done`。状态更新、重新执行与取消 Run 是不同动作；`issue rerun` 为当前 Owner 重新排队一次执行，不等于恢复全部旧会话状态。

原生去重、连续评论合并及同一目标的后续执行不应扩大解释为父子树、不同 Agent 或外部系统的事务锁。运行成功、状态写入成功和业务交付完成分别确认。

来源：[Runs](#source-runs)、[Assignment](#source-assignment)、[评论路由](#source-mentions)、[CLI](#source-cli)，文档核对日期 2026-09-29。

**版本验收：** 同一 Issue / Agent 在实际派发入口下的串行行为、重试、会话与目录恢复，须验证安装版本；不把去重描述当作 exactly-once 交付承诺。

<a id="mechanism-custom-status"></a>

## 2.5 自定义 Issue Status（事项状态）

**官方机制：** Workspace owner / admin 可在 Settings → Issue Statuses 管理自定义状态；状态有生命周期分类，API / CLI 使用 Key，UI 显示名称。自定义状态只继承分类语义，不自动继承固定 `backlog`、`in_review`、`blocked` 或 `in_progress` 的特殊触发、完成或恢复行为。Board / List 按具体状态区分，而非只按分类合并。

Key 在创建状态时确定，修改 Display Name 不改变 Key；部署和调用前回读实际 Key。分类字段的实际枚举值以安装版本的 API Contract 核对，不复制一套推测的枚举映射。

来源：[Issues / Custom statuses](#source-issues)，文档核对日期 2026-09-29。

**本项目约定：** `analysis_review` / `Analysis Review` / `started` 的正式名称见 §1.2.3；它表示什么业务等待、由谁写入和何时离开由主方案维护。该状态不是 Multica 内置的人工批准引擎，也不提供全局暂停能力。

<a id="mechanism-parent-stage"></a>

## 2.6 Parent / Child（父子事项）与 Stage（阶段）

**官方机制：** 子 Issue 独立推进；满足原生子任务批次 / Stage 终态条件时，父 Issue 收到完成通知并由其负责人继续处理。Stage 按子任务分组，原生终态包括 `done` 和 `cancelled`；没有 Stage 的子任务作为一个批次。通知不代表父业务目标已完成，也不直接将所有后续工作启动。

公开 `issue_child_done.go` 实现将父级通知作为已成功状态更新旁的 best-effort 动作；通知错误不回滚该状态更新。具体进入终态条件、父级过滤和去重细节与实现版本相关，不作为不带版本的事务保证。

来源：[Issues](#source-issues)、[Parent / Stage 公开实现](#source-child-done)。文档及公开实现核对日期 2026-09-29；源码入口尚未锁定 commit，须在安装版本验收。

**项目使用边界：** 以 [主方案 §14](02-multica-squad-centric-delivery-v1.4.19.md#delivery-stage) 为准，Stage 只用于需要独立 Runtime State 的 Development Sub-Issues 之间的完成依赖。原生 `cancelled` 不等于相关 Task Set 工程成功；父级仍核对有效 Evidence。项目不复制第二套通知状态机，不依靠反复切换终态制造通知。

<a id="mechanism-comments"></a>

## 2.7 Comment（评论）、Mention（提及）与 Squad（小队）回流

**官方机制：** 真正的 Mention 使用编辑器选择或平台返回的 mention 标识，纯文本 `@name` 不是执行触发。Mention 不改变当前 Issue 的 Owner 或 Status。普通回复按讨论上下文路由；符合回退条件的顶层评论可交给当前 Agent Owner 或 Squad Leader，显式 Mention 会影响回退目标。

连续评论可合并到待处理运行，目标正在执行时可形成后续运行；平台不因此决定业务协作何时结束。不是每一条评论或回复都必然唤醒 Leader，不能把回复成员线程当作可靠的父级审核通知。

来源：[Comments](#source-comments)、[Mention / Reply 路由](#source-mentions)、[Squads](#source-squads)，文档核对日期 2026-09-29。实际触发以当前上下文、预览、Access 和安装版本为准，不复制完整原生触发表。

**本项目约定：** 人审决定仍来自真实 Human 意见；评论触发不是批准。领域方案定义审核入口与原始反馈引用，成员 Skill 定义输出和停止条件。

<a id="mechanism-cli-version"></a>

## 2.8 CLI / API（命令行 / 接口）与安装版本

**官方机制：** CLI 手册提供公共命令入口；准确参数与输出以安装版本各命令的 `--help` 为准。`issue rerun`、状态写入和 `cancel-task` 是不同入口。

来源：[CLI](#source-cli)，文档核对日期 2026-09-29。

**本项目约定：** 脚本读取结构化结果，不解析面向人的终端表格。调用前确认 CLI / Server、API Contract、目标 Workspace 及权限。只能为已核实可用的入口编写可执行步骤；能力不一致时停止并报告，不用任意替代操作绕过启动或授权边界。公开文档、源码版本与本地运行验收分别记录，规则见 [官方机制与来源引用规范](#official-reference-policy)。

<a id="mechanism-autopilot"></a>

## 2.9 Autopilot（自动驾驶）与 Run Intent（运行意图）

**官方机制：** Autopilot 可按配置的计划或事件启动执行；Run 的触发仍通过 Multica 运行机制完成。

来源：[Runs / Trigger sources](#source-runs)、[Autopilots](#source-autopilots)，文档核对日期见来源索引。

**本项目约定：** Autopilot Prompt 的四类信息由 §24 维护。定时 TFS / PR 同步、Thin Adapter、具体幂等与停止边界属于主方案及对应 Skill；计划触发本身不证明外部同步、业务 Gate 或交付完成。

---

<a id="mechanism-skills"></a>

# 3. Skill（技能）的官方定位

官方来源：[Skills](#source-skills)，文档核对日期 2026-09-29。以下方法分层与最小执行入口原则是本项目约定。

Multica 官方将 Skill 定义为：

> 可复用的一组工作方法，由 `SKILL.md` 以及可选的 scripts、templates、references 等支持文件组成。

官方对 **Agent Instructions 与 Skill** 的划分非常明确：

| | Agent Instructions | Skill |
|---|---|---|
| 适合保存 | Agent 长期职责、边界、交付要求 | 某类工作的可复用步骤、资料和工具 |
| Scope | 属于一个 Agent，每次 Run 提供 | 可绑定多个 Agent，并分别启停 |
| 典型示例 | “只 Review 前端代码，不直接修改” | Accessibility checklist + report template |

官方还明确建议 `SKILL.md` 描述：

- Skill 什么时候适用；
- 开始前检查什么；
- 执行步骤；
- 结果以什么形式提交；
- 什么情况下停止并询问成员。

因此本项目正式采用：

> **Agent Instructions = Role Contract**  
> **Skill = Reusable Execution Contract**

其中必须区分：

```text
Skill
= 完整的可复用能力目录
= SKILL.md + 可选 config / scripts / references / templates / tests

SKILL.md
= Agent 执行该方法时需要读取的最小执行说明
```

`SKILL.md` 不是 Skill 的全部内容，也不应承担整个 Skill 目录中所有知识的汇总职责。

核心原则：

> **SKILL.md 只保存正确执行当前方法所必需的最小充分信息。**

详细知识、参数、确定性实现和模板应按职责拆分到支持文件，避免每次执行都把全部背景和参考资料加载进上下文。

---

<a id="mechanism-shared-context"></a>

# 4. 不应只有三层：完整配置边界

Multica 实际还存在 Workspace、Project 和 Issue 级 Context。官方来源：[Workspace](#source-workspaces)、[Project](#source-projects)、[Issues](#source-issues)，文档核对日期 2026-09-29。

官方说明：

- **Workspace Context** 会提供给 Workspace 中的所有 Agent，适合团队背景、产品约定以及长期有效的公共要求；
- 一次性的执行要求应该放在对应 Issue 中。
- Project Description 适合项目级目标、技术边界和交付约定，而只属于单个 Issue 的要求应放在 Issue 中。
- Issue 本身保存目标、背景、要求、讨论和执行历史；在本项目中，Issue 保存 Source Requirement（源需求）与 Delivery Facts，并通过稳定引用关联 OpenSpec 中的 Canonical Engineering Acceptance Contract（权威工程验收契约），不复制其正文。

因此推荐形成以下完整分层：

以下分层仅表示内容职责划分，不表示 Multica 官方的 Prompt 注入顺序、指令优先级或覆盖关系。

```text
Workspace Context
    │
    │ 团队级长期规则
    ↓
Project Context
    │
    │ 项目级长期约束
    ↓
Autopilot Prompt
    │
    │ Run Intent / Trigger Contract
    ↓
Squad Instructions（当前 Run 以 Squad Leader 身份执行时）
    │
    │ Collaboration Contract
    ↓
Agent Instructions
    │
    │ Agent-specific Role Contract
    ↓
Skill
    │
    │ Reusable Execution Contract
    ↓
Issue / Comment
    │
    │ 本次工作的 Goal / Context / AC
    ↓
Run
```

其中 `Squad Instructions` 表示由 Leader 接收的内容职责层，不表示全队共享的注入顺序。Member 不因加入 Squad 而自动继承该层；未自动注入也不等于绝对不可通过工具读取，但执行契约不能依赖这种隐含读取。

其中：

```text
Agent Description
```

仅承担 UI 展示作用，不属于执行 Prompt 规则层。

对于当前研发交付架构，还增加一个独立维度：

```text
Deterministic Gate / Guard / Route
```

负责可以程序化、确定性判断的流程控制。

<a id="mechanism-squad"></a>

## 4.1 Squad（小队） / Squad Instructions（小队指令）

对于需要多个 Agent 协作完成同一个工作对象的场景，本规范增加 Squad 维度。

### Squad（小队）

Squad 是：

> **多个 Agent 的协作单元 / Collaboration Unit。**

Squad 本身不是 Agent，不承担某个具体专业角色。

典型结构：

```text
Delivery Squad
│
├── Leader
│   └── Delivery Lead
│
└── Members
    ├── Workitem Analyst
    ├── Backend Engineer
    ├── Frontend Engineer
    ├── Flink Engineer
    └── Verify Agent
```

因此必须区分：

```text
Delivery Squad
= Squad / 协作容器

Delivery Lead
= Agent；在 Delivery Squad 中承担 Leader 关系

Workitem Analyst / Backend Engineer / Frontend Engineer / Flink Engineer / Verify Agent
= Delivery Squad Member Agents
```

不得将 Squad 与 Leader Agent 视为同一个配置对象。

### Squad Instructions（小队指令）

Squad Instructions 是：

> **提供给 Leader 的 Collaboration Contract：由 Leader 执行的协调、路由、交接与升级规则。**

Multica 的 Squad Instructions 只提供给 Leader，不自动广播给 Member。Leader Run 还会收到原生 Squad Operating Protocol 与 Roster；成员角色说明帮助 Leader 选择执行者，不代替 Member 的执行指令、不授予权限，也不自动给成员绑定 Skill。此处描述注入范围，不声明所有任务共享一个 Prompt 或会话。（来源见 [Squads](#source-squads)；文档核对日期 2026-09-29。）

主要回答：

```text
哪些成员一起工作？
谁是 Leader？
什么时候把工作交给哪个角色？
什么时候等待 Human？
什么时候创建独立 Sub-Issue？
什么时候需要 Leader 介入？
什么时候可以进入 Squad-level Completion？
```

适合保存：

- Leader / Member 的协作关系；
- 成员之间的交接原则；
- 角色选择和语义路由原则；
- Sub-Issue 的创建原则；
- Human Review / Approval 的等待边界；
- Leader 介入和异常升级条件；
- Squad-level Completion 的协作原则。

不适合保存：

- Specialist 的专业执行步骤；
- 代码实现方法；
- Verify 的详细检查 Procedure；
- Gate 算法和状态判断实现；
- 当前 Issue 的具体需求、Source Requirement 或 OpenSpec Acceptance Contract 正文；
- 已有权威 Script / Gate 维护的状态机副本；
- 仅写在这里却期待 Member 自行遵守的专业执行义务。

本节属于本项目基于 Multica Squad 能力制定的工程约定，不表示 Multica 官方规定了固定的 Squad Instructions Markdown 模板。

## 4.2 Squad Leader（小队负责人）与 Member（成员）边界

Squad Leader 是普通 Agent 在 Squad 中承担的协调角色，不是独立 Workflow Runtime。

Leader 适合负责：

```text
读取当前事实
理解人工自然语言意见中的决定、条件与反馈；不代替人工批准
判断当前需要哪种专业能力
@mention / handoff 对应 Member
处理歧义、冲突和跨角色问题
处理 Deterministic Route 无法可靠判断的语义问题
在 Squad-level Completion 条件满足后完成收口
```

Leader 不应默认承担：

```text
替代 Workitem Analyst 做正式分析
替代 Engineer 完成生产代码
在 required=true 时替代 Verify Agent 做独立验证
替代 Human Approval
覆盖明确的 Deterministic Gate FAIL
通过 Prompt 维护一套完整 Workflow Engine
```

Member 负责自己的专业工作，不承担整个 Squad 的全局编排。

职责明确、需要一个 Agent 持续负责的独立工作直接 Assignment 给该 Agent；当前 Issue 内的临时协助用 `@mention`。只有工作本身需要持续多角色协调或 Owner 不能明确时才使用 Squad。父 Issue 属于 Squad，不要求每个子 Issue 也属于 Squad。（来源见 [Squads](#source-squads)；文档核对日期 2026-09-29。）

同一个 Leader Agent 在父子 Issue 上的 Run 是不同的工作上下文。子级协调当前交付单元，父级协调其整体目标；不能将“子 Issue 的 Leader 被唤醒”当成“父 Issue 已经收到回流”。正常回流优先使用已核实的原生机制。

同一工作只选一个正常触发入口。状态写入、任务触发与任务取消是不同操作；不以改状态代替显式启动或取消，也不同时用子任务激活和父级 Mention 派发同一工作。

## 4.3 Squad Instructions（小队指令）与 Agent Instructions（智能体指令）的边界

| 资产 | 主要接收者 / 执行者 | 回答的问题 |
|---|---|---|
| Squad 配置 / Role Description | Leader 用于选择协作者 | 哪些成员一起工作，各自适合什么工作 |
| Squad Instructions | 当前以 Leader 身份执行的 Agent | 如何选择成员、交接、等待 Human 与协调异常 |
| Agent Instructions | 对应 Agent | 我负责什么、允许做什么、何时停止 |
| 绑定 Skill | 调用该方法的 Agent | 具体方法、Validation、Evidence 与 Output |
| Issue / Sub-Issue | 当前工作的执行者 | 本次 Goal、Scope、AC、依赖与上下文引用 |
| Comment / Handoff | 本轮请求的处理者 | 新 Finding、修正方向或额外限制 |
| Gate / Script | 确定性执行入口 | 硬条件是否满足，副作用如何安全执行与恢复 |

Member 必须执行的长期职责与停止边界写入该 Agent 的 Instructions；详细方法与输出契约放入其绑定 Skill。不得只在 Squad Instructions 中维护 Member 的执行义务。

Agent Instructions 可以引用方法的权威 Skill；无需再复制整套 Procedure。多个 Agent 使用同一方法时，绑定同一 Skill，不复制多份实现。Workspace / Project Context 仅保存对应范围真正共享的规则，不因“想让成员看见”就把完整 Delivery Workflow 放入公共上下文。（来源见 [Skills](#source-skills)。）

## 4.4 注入与派发规则

Leader 派发只补充本轮必要的目标、范围、顺序和约束，不转述完整 Issue，不复制完整 Squad Instructions 或 Member Skill。原生协议、Roster 与项目自有规则应区分，不维护一份会与平台漂移的原生协议副本。

Member 通过自身 Instructions、明确绑定的 Skill、当前 Issue / Comment 与可访问的权威产物获得执行契约。直接 Assignment 启动的 Specialist 也必须能够独立执行，不依赖先经过 Leader 转述。加入 Squad 不意味着自动继承 Leader Instructions、Squad Instructions、其他成员 Skill、工具权限或会话。

配置 Review 同时检查两个问题：规则的权威定义在哪里；执行该规则的 Agent 是否稳定获得该定义或必要引用。One Rule, One Owner 不等于只能把所有规则放在 Leader 可见的位置。

对来源不明确或无法获得的必需输入，执行者应停止并说明缺口，不假设它已经通过父级会话自动传递。

---

# 5. Agent Description（智能体描述）规范

## 5.1 定位

Agent Description 只回答：

> **这个 Agent 是干什么的？**

它面向 Workspace 成员，而不是执行中的 LLM。

---

## 5.2 推荐内容

推荐只描述：

```text
主要职责 + 主要处理对象 + 必要时补充核心目标
```

推荐控制在 **一句话**。

例如：

```text
负责研发交付阶段边界推进、跨任务协调与异常处理，确保交付流程正确闭环。
```

---

## 5.3 Agent Description（智能体描述）不应该包含

不要放：

- Workflow；
- Gate 判断；
- 操作步骤；
- Tool 使用方法；
- Skill 使用方法；
- Exception Playbook；
- Prompt Rules；
- 当前任务的 Source Requirement / Acceptance Contract；
- 当前任务信息。

### 判断原则

删除这段 Agent Description 后：

> Agent 的实际执行行为不应该发生变化。

否则说明本应属于 Instructions 的规则错误地写进了 Agent Description。

---

# 6. Agent Instructions（智能体指令）规范

## 6.1 定位

Agent Instructions 是：

> **Agent 的长期 Role Contract。**

回答：

```text
Who am I?
What do I own?
What do I not own?
How should I make decisions?
When should I stop / escalate?
How should I deliver?
```

而不是：

```text
整个 Workflow 怎么运行？
```

---

# 7. Agent Instructions（智能体指令）推荐结构

统一采用以下五部分。

Instructions 可以保留每次执行都必需的简短启动检查和交付动作；详细操作步骤与可复用流程放入 Skill，避免重复维护。

## 7.1 Role（角色）

定义 Agent 在整个系统中的定位。

通常只需要 1～3 个短段落。

应该包含：

- 是谁；
- 核心定位；
- 在系统中的责任位置；
- 必要的总体原则。

例如：

```text
你是 Multica 研发交付流程中的 Delivery Lead，
负责阶段边界协调、跨任务协调和异常处理。

你正常承担人工意见理解、成员选择和协作交接；涉及硬条件和写入时复用原生工具及必要 Gate。
不替代人工批准或 Specialist 专业判断，不要求语义工作先等待脚本返回 UNKNOWN。
```

---

## 7.2 Core Responsibilities（核心职责）

只描述该 Agent **长期 Owner 的职责**。

建议：

```text
3～5 项核心职责
```

每项描述 **What**，不要展开大量 **How**。

例如：

```text
- 阶段边界推进
- 跨任务协调
- 异常与语义决策
- 最终交付闭环
```

不要在这里开始写：

```text
第一步执行 A
第二步执行 B
第三步创建 C
第四步检查 D
```

那已经属于 Skill 或 Workflow。

---

## 7.3 Boundaries（职责边界）

这是 Multica Agent Prompt 中非常重要的一部分。

明确：

```text
What NOT to do
```

例如：

```text
不得直接修改生产代码。
不得在 required=true 时替代 Verify Agent 完成独立验证。
不得替代人工批准 PR。
不得覆盖 Deterministic Gate FAIL。
```

职责边界通常比额外增加能力描述更重要。

原则：

> **Agent 要知道自己应该停止在哪里。**

---

## 7.4 Execution Principles（执行原则）

主要定义 Agent 的长期决策原则，也可包含每次必需的简短检查，不展开详细执行流程。

适合保存：

- 信息源优先级；
- Source of Truth；
- 决策优先级；
- 修改范围原则；
- Evidence 原则；
- Fail-safe 原则；
- 最小变更原则；
- 确定性机制与 LLM 判断的关系。

例如：

```text
以 Multica 当前事实状态为准，不根据历史会话推测当前状态。

能由 Deterministic Gate / Route 判断的事情，不进行额外语义判断。

失败时优先 targeted rework，不无差别重新执行全部任务。
```

这些规则在不同任务中长期成立，因此适合放 Instructions。

---

## 7.5 Escalation, Communication & Delivery（升级、沟通与交付）

建议将原来的：

```text
Escalation & Communication
```

扩展为：

```text
Escalation, Communication & Delivery
```

原因是 Multica 官方明确把 **Delivery Requirements** 归入 Instructions。

这里定义：

### Escalation（升级）

什么时候必须停止自主推进：

```text
UNKNOWN
责任归属不明确
关键证据缺失
规则冲突
需要人工批准
超出权限
```

### Communication（沟通）

与 Agent / Member 沟通时需要提供什么：

```text
事实
问题
Evidence
下一步
责任人
```

### Delivery（交付）

Agent 最终如何交付：

```text
Issue Comment
Artifact
PR
Status Update
TFS Update
Runtime / Handoff Fact
```

这里定义 **交付契约**，但不要重新描述整个执行步骤。

---

# 8. Agent Instructions（智能体指令）标准结构

统一使用：

```text
# Role
# Core Responsibilities
# Boundaries
# Execution Principles
# Escalation, Communication & Delivery
```

对应关系：

```text
负责什么 → Core Responsibilities
不负责什么 → Boundaries
长期判断规则 → Execution Principles
停止 / 升级 → Escalation
沟通与交付 → Communication & Delivery
```

---

# 9. Skill（技能）规范

## 9.1 定位

Skill 回答：

> **这类事情具体怎么做？**

Skill 应以 **Capability / Method / Scenario** 为中心，而不是以 Agent 身份为中心。

例如：

```text
tfs-sync
delivery-flow
pr-transition
integration-verification
workitem-analysis
```

比：

```text
delivery-lead-helper
engineer-behavior
```

更适合作为 Skill。

本项目进一步将 Skill 定义为：

> **Reusable Execution Contract：对一类任务的触发条件、输入、执行方法、验证方式、输出和失败处理进行可复用约定。**

一个 Skill 原则上只回答六个问题：

```text
When?
→ 什么时候应该使用？

Input?
→ 开始前需要什么？

How?
→ 具体怎么执行？

Validation?
→ 怎么知道执行正确完成？

Output?
→ 最终交付什么？

Failure?
→ 失败、阻塞或无法判断时怎么办？
```

## 9.2 Skill（技能）与 SKILL.md

必须区分整个 Skill 与入口文件：

```text
<skill>/
├── SKILL.md
├── config/       # optional
├── scripts/      # optional
├── references/   # optional
├── templates/    # optional
└── tests/        # optional
```

职责统一为：

| 资产 | 职责 |
|---|---|
| `SKILL.md` | 最小执行说明与方法边界 |
| `config/` | 环境参数、可配置策略、路由表 |
| `scripts/` | 确定性计算、校验、同步、Gate / Route 实现 |
| `references/` | Schema、API、Mapping、Contract、详细说明 |
| `templates/` | 输出模板与结构化 Artifact 模板 |
| `tests/` | 确定性逻辑和脚本的回归测试 |

原则：

> **Skill 可以完整，SKILL.md 必须克制。**

同时必须区分 Method 与 Artifact：Skill 定义“怎么做”，不因为 Skill 名称是 `requirement-analysis`、`requirement-review`、`context-analysis` 就默认要求生成同名 Markdown。Artifact 是否存在由下游 Contract 和 §1.5 的 Owner / 持久化原则决定。

---

# 10. SKILL.md 推荐结构

## 10.1 Frontmatter（前置元数据）

推荐使用：

```yaml
---
name: <skill-name>
description: <做什么 + 什么时候使用>
---
```

`description` 应尽量同时表达：

```text
What
+ When
```

因此正文通常不再重复大段 `Purpose / When to Use`。

## 10.2 正文结构

统一推荐：

```text
# Skill Name

## Preconditions / Inputs

## Procedure

## Validation

## Output

## Error Handling / Stop Conditions
```

各部分只回答一个问题：

| Section | 回答的问题 |
|---|---|
| Preconditions / Inputs | 开始前必须具备什么？输入从哪里来？ |
| Procedure | 为完成任务需要执行哪些步骤？ |
| Validation | 如何判断结果正确、完整、可交付？ |
| Output | 最终产生什么 Artifact / Result / State Change？ |
| Error Handling / Stop Conditions | 失败、UNKNOWN、缺输入、权限不足或无法安全继续时怎么办？ |

Multica 官方明确要求的核心内容仍然覆盖：

```text
什么时候使用
开始前检查什么
执行步骤
结果形式
什么时候停止并询问成员
```

本规范将 `Validation` 作为统一章节，用于承载 Completion Check、Evidence Check、Test、Gate 或确定性校验。

不要求每个 Skill 都单独维护 `Deterministic Checks` 章节；存在确定性检查时，应在 `Validation` 中说明调用什么 Gate / Script 以及如何解释结果。

## 10.3 Minimality Principle（最小化原则）

`SKILL.md` 遵循：

> **Minimum Sufficient Instruction：只保留正确执行当前方法所需要的最小充分信息。**

判断某段内容是否应留在 `SKILL.md`，统一询问：

> **Agent 在执行这个 Skill 时，如果不知道这段内容，是否会影响正确执行或安全停止？**

如果答案是否定的，通常应删除或移出 `SKILL.md`。

这不是追求最短文本，而是减少与当前执行无关的信息、重复规则和上下文负担。

## 10.4 Progressive Disclosure（渐进披露）

Skill 内容采用按需加载：

```text
Level 1
name + description
        ↓ Skill 被选中

Level 2
SKILL.md
最小执行方法
        ↓ 确实需要

Level 3
config / scripts / references / templates
详细参数、实现与知识
```

因此：

- 不要为了执行一个简单任务，要求 Agent 预先阅读整个 references；
- `SKILL.md` 只引用本次执行可能需要的支持文件；
- 只有实际需要字段、Contract、Mapping、模板或脚本行为时才读取对应文件；
- 不建立多层深链式引用，避免 Agent 为找到一个规则连续打开大量文件。

---

# 11. Skill（技能）应该保存什么

## 11.1 SKILL.md 中适合保存

### Preconditions / Inputs（前置条件 / 输入）

例如：

```text
需要哪些输入
输入来源是什么
必需工具 / 权限是否可用
开始前必须满足什么条件
```

### Procedure（执行步骤）

只保存完成任务所必需的执行步骤，例如：

```text
读取什么
调用什么能力
执行什么动作
何时进入下一步
```

Procedure 应描述到 **Agent 可以正确执行** 的粒度，不应把确定性算法逐行翻译成自然语言。

如果一段逻辑具有：

```text
输入明确
规则明确
结果有限
可以程序化
```

应优先实现为 Script / Gate / Route；`SKILL.md` 只说明：

```text
什么时候调用
输入什么
如何解释结果
失败怎么办
```

### Validation（校验）

定义完成标准，例如：

```text
Artifact 是否存在
Evidence 是否完整
Schema 是否有效
Test 是否通过
Gate 是否 PASS
Completion Criteria 是否满足
```

### Output（输出）

定义最终交付契约，例如：

```text
Artifact
Runtime / Handoff Fact
Issue Comment
Metadata Update
Status Change
PR / Verification Report
```

### Error Handling / Stop Conditions（错误处理 / 停止条件）

只定义方法自身的异常处理：

```text
可重试错误如何处理
单项失败是否继续
何时 FAIL
何时 UNKNOWN
何时停止
何时交给 Human / Delivery Lead
```

## 11.2 支持文件中适合保存

| 内容 | 推荐位置 |
|---|---|
| 环境参数、Project / Squad ID、可配置策略 | `config/` |
| Gate、Validate、Route、Sync 等确定性逻辑 | `scripts/` |
| API Contract、Metadata Schema、Repository Mapping | `references/` |
| Analysis / Verification / Handoff 输出模板 | `templates/` |
| 确定性行为回归验证 | `tests/` |

原则：

> **SKILL.md 描述方法；支持文件承载细节和实现。**

---

# 12. Skill（技能）不应该承担什么

Skill 不应该重复定义已有的角色职责、公共规则或权威流程：

```text
你是谁
你的长期职责是什么
谁是你的长期 Owner
其他位置已维护的研发流程规则
Workspace 全局规则是什么
某个 Issue 本次具体要做什么
```

上述 Agent 身份与长期职责边界属于 Agent Instructions；当前任务属于 Issue；公共规则属于 Workspace / Project Context；已有确定性状态转换属于 Gate / Route / Script。

## 12.1 SKILL.md 默认不应包含

```text
历史沿革
版本迁移过程
方案比较
设计讨论
为什么当初这样设计
旧方案为何废弃
架构背景介绍
CHANGELOG
完整 API / Schema 文档
大段 CLI 帮助
环境配置值
可程序化算法的自然语言展开
与当前 Procedure 无关的大量示例
```

这些信息即使有保存价值，也应进入 Design Doc、ADR、Git History、CHANGELOG、`references/`、`config/` 或 `scripts/`，而不是放在执行入口中。

## 12.2 不要重复 Agent（智能体）身份

不要在每个 Skill 开头重复：

```text
你是 Delivery Lead……
你的职责是……
你不能……
```

方法自身的限制与停止条件仍然必须保留，例如：

```text
本发布方法不得跳过发布前检查。
```

这是 Method Constraint，不是 Agent Role。

## 12.3 不要维护第二套 Workflow（工作流）

可复用流程可以由 Skill 承载；已有权威 Route / Gate / Workflow 定义时，Skill 只描述如何调用或使用，不复制一套相同状态机。

尚未程序化且确实属于该 Skill 的流程，可以暂时由 Skill 作为唯一规则来源；后续迁移为确定性实现后，应删除重复的自然语言算法，只保留调用和结果处理说明。

## 12.4 写作风格

Skill 应直接进入执行契约：

```text
Inputs
→ Procedure
→ Validation
→ Output
→ Error Handling
```

避免使用大量说明性提醒：

```text
注意……
再次注意……
特别提醒……
务必牢记……
```

应改成可执行约束：

```text
必须……
不得……
仅当……才……
如果……则停止……
FAIL 时不得继续……
```

可以程序化保证的约束，应优先进入 Script / Gate，而不是依赖 LLM 记住提醒。

---

# 13. “Agent / Squad Instructions（指令）不要复制 Workflow（工作流）”原则

这是本规范最重要的工程原则之一。

## 错误方式

在 Agent Instructions 或 Squad Instructions 中完整维护：

```text
Analysis PASS
→ Create Development Issue
→ Engineer
→ Verify
→ FAIL
→ Engineer
→ Verify
→ PASS
→ PR
→ Review
→ Merge
→ Required Verification（按需 Independent Verify）
→ Completion
```

这相当于又用自然语言实现了一套 Workflow Engine。

最终系统会存在：

```text
Deterministic Workflow
        +
Prompt Workflow
```

两套状态机。

随着流程演进，两者极容易发生漂移。

---

## 正确方式

Agent Instructions 只描述角色原则，Squad Instructions 只描述协作原则，例如：

```text
Delivery Lead 在当前负责的 Issue 上组织专业协作，
不重复 Specialist 已完成的专业判断。

已有可靠 Gate / Route 结果时按结果处理；
无法归因、事实冲突或无法安全推进时协调 Specialist / Human。
```

具体：

```text
PASS 后去哪
FAIL 后去哪
需要哪些字段
Issue 如何变状态
下一 Agent 是谁
```

已有业务硬条件由对应 Gate / Script 统一定义，Skill 描述调用与结果处理，不维护副本。简单固定的成员分工可由 Squad Instructions 作为唯一协作规则来源，并使用原生派发，不必为每次交接创建独立 Route 脚本。

尚未程序化的流程可以由 Skill 承载，并作为该流程的唯一规则来源；后续程序化时，应将规则统一迁移到 Gate / Route，Skill 保留调用说明和必要引用。

---

# 14. LLM Decision（语义决策）与 Deterministic Decision（确定性决策）边界

对于当前 Multica 架构，进一步统一如下。

## Deterministic Decision（确定性决策）

满足以下特征：

```text
输入明确
规则明确
结果有限
可以程序化
不需要理解模糊语义
```

例如：

```text
provider_status == completed
当前候选成果对应的 Verify result == PASS
所有 required child issue 的完成状态与有效 Evidence
required fields 是否存在
repository → engineer role mapping
```

应该由：

```text
Gate
Guard
Route
Script
API State
```

处理。

不要让 LLM 再判断一次。

---

## LLM Semantic Decision（LLM 语义决策）

适用于：

```text
人工自然语言意见表达什么决定、附加条件、修正方向及是否需要再次确认
需求是否发生实质变化
PR Feedback 是否推翻原 Analysis
Finding 属于哪个 Task Set / Runtime Projection
多个 Task 是否存在语义冲突
是否需要重新拆分任务
失败 Evidence 能否可靠归因
```

这些语义问题由相应专业 Agent 或 Leader 根据职责处理；Agent Instructions 定义长期判断与停止原则，具体分析方法属于 Skill。

---

## 14.1 结果语义与人工决定

Gate 的 `FAIL` 表示明确不满足条件，由该 Gate 定义等待、返工、停止或恢复，不统一解释为重跑。`UNKNOWN` 表示无法可靠判断，不授予 Agent 绕过 Human Approval 的权限。

Human 作出审核决定；自然语言意见的意图、条件和修正方向由负责该协作的 Agent 结合原文与当前上下文理解，方法归属现有 Skill。不先要求脚本识别关键词，也不要求语义理解必须等待确定性失败；明确采用结构化操作协议的独立场景仍按该协议校验，但不得把自然语言默认当作这种协议。

评论没有表达流程动作时使用 `NO_ACTION`；普通问题可以回答。只认可方向、附有未满足条件或要求再审，不自动等于允许进入下一阶段；意图、来源或条件不清先澄清，不自动将 Issue 置为 `blocked`。引文、历史评论和 Agent 自述不能充当新的 Human 批准。

语义理解形成的摘要或 JSON 是执行输入，不会因此成为确定性审核事实。保留真实人工来源及必要上下文；工具只校验可确认的身份、权限、当前状态、前置条件和写入结果，不能保证模型解释必然正确。具体状态与权限由领域方案定义，不新增通用评论解析器、审批状态表或固定文本口令。

# 15. 各配置层的正式职责边界

| 层 | 解决的问题 | 生命周期 | 典型内容 |
|---|---|---|---|
| Agent Description | 这个 Agent 干什么 | 长期 | 一句话角色介绍 |
| Workspace Context | 我们这个团队怎么工作 | Workspace 长期 | 团队背景、公共约定 |
| Project Context | 这个项目有什么统一约束 | Project 生命周期 | 项目目标、技术边界 |
| Squad | 哪些 Agent 作为一个协作单元工作 | Squad 生命周期 | Leader / Members |
| Squad Instructions | Leader 如何组织成员协作 | Squad 长期，仅提供给 Leader | Collaboration / Handoff / Escalation |
| Agent Instructions | 这个 Agent 是谁、负责什么、如何判断 | Agent 长期 | Role / Boundary / Principles |
| Skill | 这一类工作怎么做 | 可复用 | Procedure / Checklist / Tool |
| Issue | 这一次具体要做什么 | 单项工作 | Goal / Context / AC |
| Comment | 本轮新增什么信息 | 单次交互 | Feedback / Request |
| Gate / Route | 能否继续、确定性的下一步是什么 | Runtime | PASS / FAIL / Route |

---

# 16. 一个规则到底应该写在哪里

后续设计时，应分别判断“规则归属”和“执行方式”，两者不是互斥选项。

## 16.1 规则归属：在哪里定义、由谁维护

| 内容性质与适用范围 | 定义位置 |
|---|---|
| 所有 Agent 长期需要的公共约定 | Workspace Context |
| 某个 Project 共享的目标与约束 | Project Context |
| 哪些 Agent 组成长期协作单元 | Squad |
| 由 Leader 执行的成员协作、交接与升级原则 | Squad Instructions |
| 某个 Agent 的长期职责与边界 | Agent Instructions |
| 某类工作可复用的方法与流程 | Skill |
| 当前 Issue 特有的目标、要求与 AC | Issue |

选择与规则内容和适用范围相符的位置作为权威定义；其他位置可以引用，不独立维护重复版本。

在 Squad 场景下进一步约定：

```text
单个 Agent 的长期职责
→ Agent Instructions

Leader 执行的跨成员协作原则
→ Squad Instructions

Member 自身必须履行的职责与交付义务
→ 该 Agent Instructions / 绑定 Skill

专业执行方法
→ Skill

机器可确定的状态转换
→ Gate / Route / Script

当前任务要求
→ Issue
```

## 16.2 执行方式：如何执行或验证

| 判断性质 | 执行或验证方式 |
|---|---|
| 输入和规则明确、可以程序化的检查或路由 | Deterministic Gate / Guard / Route / Script |
| 需要语义理解和上下文判断 | Agent Semantic Decision |
| 明确要求人工批准或必须由人决定 | Human Decision |

例如，Project Context 定义“交付必须通过验证”的要求，Gate 承担相应检查，Agent Instructions 引用该要求并约束 Agent 不得绕过检查。它们分别承担规则定义、程序检查和角色约束，不应各自重写一套判断标准。

确定性流程按 §13 选择唯一规则来源；是否以及如何程序化，由后续实施方案确定。

Agent Description 不参与上述规则归属与执行方式判断。

因为 Agent Description 只负责：

```text
让人知道这个 Agent 是做什么的。
```

---

## 16.3 可恢复副作用与返工

Script 的确定性不等于重复调用无副作用，更不等于跨系统原子事务。按以下最小规则设计：

- 恢复先查询权威事实；重新检查必要 Guard，跳过已确认完成的副作用，只补未完成项。部分成功可以保留，不默认补偿回滚。
- 能从外部对象、Artifact 引用或当前 API 状态确认的结果不另建步骤状态表；确需恢复标记时复用现有任务记录和最小 pending 事实，不复制完整生命周期。
- 一个脚本调用有界执行并返回；调度与重试由原生 Runtime / 既有自动化驱动，不在脚本里长期等待或创建另一套 Workflow Runtime。
- 任务重开与执行启动分开；先准备修正输入，再使用一个原生触发入口。正常返工复用原工作对象、Owner 和已批准边界，不创建重复任务。
- 状态写入须明确负责的 Agent / 方法及有限权限，Gate 返回不等于写入完成；分别确认产物、状态与后续派发结果。仅为一次已授权写入不必新增协调 Run；失败或超时先回读，不覆盖后续人工操作或重复派发。
- 旧 Evidence 保留其原版本含义，不自动证明新候选成果通过；只重做受影响范围和必要回归。语义变化超出批准范围时升级，不以返工替代审批。

副作用排序、完成后置条件、具体状态键和返工命令由领域方案 / 对应 Skill 定义，本规范不复制 Delivery 的状态机。

## 16.4 跨 Run（运行）交接与成本边界

Workitem Analyst 与 Engineer 保持不同 Agent / Run。必要分析产物的写入、批准基线持久化、接收方读取当前版本及其职责内的独立判断，属于多角色交接的正常成本；不能以 Token / 时间优化为由合并角色、取消必要证据、假定会话自动共享或压缩掉审核信息。

交接应提供当前工作对象、批准依据、权威产物位置、适用版本 / 修订范围、当前 `task_refs` / Tasks 与验证要求。文件必须在接收方的授权环境中可访问，不以另一个 Run 的临时绝对路径或未提交目录作为唯一来源；同一资料被不同角色按职责读取，不自动等于重复分析。

优化对象是同一详细内容的多份维护、无新事实的整轮重做、无关历史和全量文档加载、重复派发，以及仅为文档包装 / 机械收口新增的专业接力。正常角色交接和实际有价值的专项审查仍然保留；不设置通用的 Run 数或文档长度硬上限。

评估新增机制的成本时，以保留相同角色、批准与工程质量要求的流程为对照，分别观察 Run、模型请求、工具调用、输入 / 缓存 / 输出用量、主动执行时间与等待 / 返工时间。使用既有遥测，不新增 Token Gate 或以成本指标绕过执行契约。具体产物深度和可合并的工具步骤由领域 Skill 定义，原生方法要求的当前文件核对不能省略。

# 17. Agent Prompt（智能体提示词）风格规范

统一要求：

> **短、硬、明确。**

推荐使用：

```text
必须……
不得……
优先……
仅当……才……
如果……则停止……
以 X 为事实来源……
无法确定时……
```

避免：

```text
请仔细分析……
充分考虑……
综合判断……
尽可能合理地……
根据实际情况灵活处理……
```

后者缺少可执行约束。

---

# 18. Role-oriented（角色导向），而不是 Workflow-oriented（工作流导向）

Agent Instructions 应：

> **Role-oriented**

描述：

```text
我的职责是什么
我的权限在哪里
我什么时候介入
我的判断原则是什么
```

而不是：

> **Workflow-oriented**

详细描述：

```text
A → B → C → D → E
```

---

# 19. Principle-oriented（原则导向），而不是 Procedure-oriented（流程步骤导向）

Instructions 应描述：

```text
以当前事实状态为准
优先确定性规则
失败优先 targeted rework
不得绕过 Gate FAIL
```

Skill 描述：

```text
Step 1
Step 2
Step 3
```

以上是内容的主要归属，不要求 Instructions 完全没有步骤。每次必需的简短检查可保留在 Instructions，详细步骤与可复用方法放入 Skill，避免重复定义。

---

# 20. Boundary-first（边界优先），而不是 Capability-first（能力优先）

设计 Agent 时，不应该不断增加：

```text
Agent 还能做什么？
```

而应该优先明确：

```text
Agent 到哪里必须停止？
什么事情属于别人？
什么事情只能由 Human 决定？
什么事情必须交给 Deterministic Gate？
```

这样可以减少 Agent 之间的职责竞争和流程漂移。

---

# 21. 常见 Anti-Patterns（反模式）

### Super Prompt（超级提示词）

一个 Agent Instructions 写数百行，同时包括：

```text
角色
流程
Skill
工具说明
场景手册
Workflow
状态机
模板
Reference
```

应拆层。

---

### Workflow-as-Prompt（将工作流写成提示词）

通过大量：

```text
IF A THEN B
IF B THEN C
```

让 LLM 模拟状态机。

应该优先迁移至 Deterministic Gate / Route。

---

### Skill-as-Agent（把 Skill 当 Agent）

Skill 中大量写：

```text
你是谁
你的职责是什么
你不能做什么
```

如果这些内容重复定义 Agent 的身份与长期职责，说明 Agent Instructions 和 Skill 边界混乱。方法自身的限制与停止条件仍应保留在 Skill。

---

### Task-as-Instructions（把任务写进长期指令）

将某一个具体需求、本次临时操作的 Repository、Source Requirement 或本次 OpenSpec Acceptance Contract 写进 Agent Instructions。

本次 Goal / Context / Source Requirement 应放入 Issue；Canonical Engineering Acceptance Contract 由 OpenSpec Engineering Truth 持有，Issue 只保存必要引用。仓库上下文按适用范围放入 Issue 或 Project Context。若某个 Agent 长期负责特定 Repository，则该仓库范围可以作为 Agent Instructions 的职责边界。

---

### Squad-as-Agent（把 Squad 当 Agent）

把 Squad 当成一个普通 Agent，并让它同时承担分析、研发、验证等所有专业职责。

错误示例：

```text
Delivery Squad 是一个 Agent，
负责分析、编码、验证和关闭任务。
```

正确关系：

```text
Delivery Squad
= 多 Agent 协作单元

Delivery Lead
= Agent；在 Delivery Squad 中承担 Leader 关系

Workitem Analyst / Backend Engineer / Frontend Engineer / Flink Engineer / Verify Agent
= Delivery Squad Member Agents
```

### Leader-as-Workflow（把 Leader 当工作流）

在 Leader Agent Instructions 中完整维护整个研发状态机，例如：

```text
Analysis → Review → Development → Verify → PR → Merge → Completion
```

这样会把 Leader 演化成 Prompt-based Workflow Runner。

正确方式：

```text
Delivery Lead Instructions
= Leader 的职责、边界和语义介入原则

Squad Instructions
= 成员协作原则

Skill
= 专业执行方法

Gate / Route
= 确定性状态转换
```

### Skill-as-Design-Document（把 Skill 当设计文档）

把 `SKILL.md` 写成设计文档，例如包含：

```text
背景
历史方案
设计理由
方案比较
版本演进
未来规划
```

这会让执行入口被说明性内容淹没。

正确方式：

```text
SKILL.md
= 当前可执行方法

Design Doc / ADR / Git History
= 为什么演进成当前方法
```

原则：

> **Skill 说明现在怎么做，不负责解释方案是怎么讨论出来的。**

---

### Reminder-Pile（提醒堆积）

在 Skill 中不断追加：

```text
注意……
重要……
再次强调……
千万不要……
```

说明约束没有被结构化。

应优先改写为明确 Constraint / Stop Condition；可以确定性检查的规则进一步迁移到 Script / Gate。

---

### Reference-in-SKILL（在 SKILL 中堆叠参考资料）

把完整 Metadata Schema、API 字段、Repository Mapping、CLI 帮助或大量 Contract 直接复制进 `SKILL.md`。

正确方式：

```text
SKILL.md
→ 说明何时需要该知识
→ 引用对应 references 文件
```

详细资料按需读取，不应成为每次 Skill 执行的默认上下文。

---

### Implicit Squad Inheritance（隐式继承 Squad 规则）

把仅提供给 Leader 的 Squad Instructions 当成 Member 的自动执行契约，或认为加入 Squad 就继承 Skill / 权限。

必须检查实际接收者；Member 的职责放自身 Instructions，方法放绑定 Skill，当前要求放 Issue / Comment。不要用每次派发复制整份配置来补救。

---

### Duplicate Rules（重复规则）

同一条规则在以下位置分别独立定义、维护：

```text
Workspace Context
Agent Instructions
Skill
Workflow
```

后续容易出现版本漂移。

原则：

> **One Rule, One Owner。**

即一条规则只有一个权威定义和维护归属，允许其他位置引用或使用从权威定义生成的摘要；不要求同一规则只能出现一次。

---

# 22. 推荐的 Agent Instructions（智能体指令）大小

Multica 官方没有规定 Instructions 的行数或 Token 上限。

本规范不设置硬性行数限制。

但由于 Instructions：

> **每次 Run 都会提供给 Agent**

因此建议：

```text
只保留长期、高频、行为约束性强的内容。
```

判断一段内容是否应该留在 Instructions，可以问：

> **这个规则是否值得在这个 Agent 的每一次 Run 中都出现？**

如果答案是：

```text
不是
```

通常就应该移到：

```text
Skill
Issue
Project Context
Reference
Script
```

中的某一层。

---

# 23. Agent 配置 Review Checklist（评审清单）

以后新增或 Review 任一 Multica 配置资产时，先检查：

### 全局

- 新增事实是否先判断为 Engineering Truth 或 Delivery Truth，并放入对应权威 Owner？
- Engineering Truth 是否优先落入 OpenSpec / canonical Supporting Artifact，而不是复制到 Multica 形成第二份技术契约？
- Delivery Truth 是否优先使用 Multica 原生 Runtime Fact，而不是为交接新增第三套 Contract Store / Runtime Object / Workflow State？
- 执行资产是否只描述当前目标状态，没有历史兼容和版本迁移内容？设计文档的必要背景与历史区按 §1.3 分开检查。
- 是否只保留影响职责、决策、执行、验证、输出或停止条件的信息？
- 是否直接定义 Contract，而不是背景、设计过程、方案比较和解释？
- 是否存在删除后不影响正确执行的说明性内容？
- 是否先核实原生能力，而不是为简单交接或状态写入建立新的 Runtime / 事务 / 锁？

然后按资产类型检查：

### 设计文档

- 是否引用并遵循 §1.1 的 Runtime-Centric Delivery + Artifact-Centric Engineering，而不是在局部方案重新定义另一套 Truth Model？
- 是否明确 Method / Artifact / Runtime Fact / View 的边界？
- Package 是否被误实现为新的 Domain Object 或重复的 `<package>.md`？
- Summary 是否只是渲染视图，而非第二个 Truth Source？

- 必要业务背景是否按设计理解需要保留，而非机械套用 `SKILL.md` 的长度要求？
- 主方案与阶段方案是否有明确权威归属；删除重复前是否确认原规则被完整覆盖？
- 摘要、模型图与正文是否一致，是否以精确引用替代独立规则副本？
- 历史摘要是否与当前规则分区，旧名称和版本引用是否只保留其历史含义？
- Multica 公共机制是否引用本手册的具体条目，而不是在各方案独立维护官方 URL 清单？
- 是否区分已核实官方机制、项目约定及未完成的安装版本验收？

### Autopilot Prompt（自动驾驶提示词）

- 是否只描述 Run Intent，而不是实现流程？
- 是否明确执行目标、Skill、停止边界和最终输出？
- 是否没有复制 Agent Instructions / Skill Procedure？
- 是否没有写死环境配置和脚本细节？

### Agent Description（智能体描述）

- 是否一句话即可理解 Agent 的用途？
- 是否没有承担执行约束？

### Squad（小队） / Squad Instructions（小队指令）

- Squad 是否代表真实的多 Agent 协作单元？
- Leader 是否明确？
- Members 是否明确？
- 是否把 Squad 与 Leader Agent 混为同一个对象？
- Squad Instructions 是否只描述由 Leader 执行的协作、交接和升级原则？
- Member 必须执行的规则是否稳定进入其 Instructions / 绑定 Skill，而不是只对 Leader 可见？
- Role Description 是否仅作为 Leader 的成员选择上下文，没有被当作权限或 Member Instructions？
- 是否正确区分 Assignment 与 Mention，避免对同一工作使用两个启动入口？
- 是否把 Specialist 的专业 Procedure 写进 Squad Instructions？
- 是否复制了 Deterministic Route / Workflow？
- 是否因为角色切换而错误创建 Sub-Issue？
- 是否明确什么时候 Leader 才需要介入？
- 是否明确什么时候需要 Human Decision？

### Instructions（指令）

- Role 是否明确？
- Core Responsibilities 是否只有长期职责？
- Boundaries 是否明确？
- Execution Principles 是否稳定？
- Escalation 条件是否明确？
- Delivery 要求是否明确？
- 是否复制了 Workflow？
- 是否包含大量 Procedure？
- 每次必需的简短检查与详细 Skill 流程是否区分清楚？
- 是否包含当前 Issue 特有信息？
- 是否与其他 Agent 职责重叠？
- Specialist 直接接收 Issue 时是否具有完整执行契约，不依赖 Leader 的隐式转述？

### Skill（技能）

- 是否把 Skill 名称错误地绑定为必须生成同名 Markdown？
- 输出是否优先更新已有权威 Artifact / Multica Runtime Fact，而非制造第二份 Requirement / Spec / Design / Review？

- `description` 是否同时说明 **What + When**？
- 是否明确 Preconditions / Inputs？
- Procedure 是否只包含完成任务所需的执行步骤？
- 是否定义 Validation / Completion Criteria？
- 是否定义明确的 Output Contract？
- 是否定义 Error Handling / Stop / Escalation Conditions？
- 是否保留方法自身的限制，并避免重复 Agent Instructions？
- 是否没有复制 Workspace / Project 公共规则？
- 是否没有包含当前 Issue 特有信息？
- 是否没有维护第二套 Workflow / Route？
- 可确定逻辑是否尽可能由 Script / Gate / Route 承担？
- 环境参数和可配置策略是否进入 Config？
- Schema / API / Mapping / Contract 是否进入 References？
- 输出模板是否进入 Templates？
- 是否避免历史说明、方案比较、设计讨论和 CHANGELOG？
- `SKILL.md` 是否只包含正确执行该方法所需的最小充分信息？
- 删除任一说明性段落后，如果不影响正确执行，该段落是否应移出 `SKILL.md`？
- 含副作用的方法是否明确已成功、结果未知及部分失败的恢复方式，并复用既有对象身份？
- 返工是否保留批准边界，并区分旧 Evidence 与当前候选成果？

### Workflow（工作流） / Gate（门禁）

- 可以程序化判断的事情是否仍交给 LLM？
- PASS / FAIL / UNKNOWN 是否明确，普通无动作评论是否避免被当成异常？
- Route 是否有唯一事实来源？
- 规则归属与执行方式是否分别明确，跨层引用是否指向同一权威定义？
- Prompt 中是否又维护了一套重复 Workflow？
- 是否区分原生运行去重、业务幂等与跨系统事务，且没有夸大保障范围？
- Gate PASS 是否与实际副作用完成分开确认，强制保护是否落实到受保护操作入口？
- 自然语言人工意见是否由相应 Agent 理解并保留来源，而非关键词匹配或以模型 JSON 冒充人工授权？
- 状态写入责任、有限权限、回读与失败恢复是否明确，等待审核是否避免被误解释为批准或完成？

---


# 24. Autopilot Prompt（自动驾驶提示词）规范

## 24.1 定位

Autopilot Prompt 是：

> **Run Intent / Trigger Contract。**

它回答：

```text
为什么触发这次 Run？
这次 Run 要完成什么？
使用哪个 Skill / Capability？
做到什么程度可以结束？
```

Autopilot Prompt 不承担 Agent Role、Skill Procedure、配置参数或确定性流程实现。

这属于本项目的工程约定，不代表 Multica 官方规定了固定的 Autopilot Prompt 模板。

---

## 24.2 Autopilot Prompt（自动驾驶提示词）只维护四类信息

Autopilot Prompt 原则上只维护以下四类内容：

### 1. 执行目标

说明本次自动运行要完成什么工作。

例如：

```text
执行一次 TFS Work Item 同步。
```

### 2. 使用哪个 Skill（技能）

明确本次 Run 应使用的可复用执行方法。

例如：

```text
执行 `tfs-sync` Skill。
```

### 3. 本次 Run（运行）的边界

只描述本次自动运行必须停在哪里，不复制完整 Workflow。

例如：

```text
同步并初始化 Delivery Issue；保持 backlog，不启动 Delivery Squad 或后续研发。
```

### 4. 最终交付要求

说明 Run 结束时需要输出什么。

例如：

```text
输出同步汇总以及必要的失败、冲突信息。
```

因此推荐模板：

```text
执行 <skill>，完成 <本次执行目标>。

使用当前 Runtime 配置，严格按照 Skill 及其确定性机制执行。

本次运行边界为 <停止边界>。

最后输出 <交付结果>。
```

Autopilot Prompt 通常应保持很薄，推荐约 2～5 句话即可表达完整 Run Intent。

---

## 24.3 Autopilot Prompt（自动驾驶提示词）不应该维护什么

不要在 Autopilot Prompt 中重复维护：

```text
Agent 长期职责和边界
完整 Workflow
具体 Procedure
CLI 命令
脚本调用细节
WIQL / API 查询细节
Collection / Project 等环境配置值
Metadata Schema
幂等状态表
Gate 判断算法
Agent Routing Table
当前 Issue 的详细 AC
```

这些内容分别属于：

```text
Agent Instructions
Skill
Config
Script / Gate / Route
Issue
```

判断原则：

> **如果 Skill 的实现方式、脚本名称、CLI 参数或环境配置变化后，Autopilot Prompt 也必须跟着修改，通常说明 Prompt 写得过深。**

---

## 24.4 Autopilot Prompt（自动驾驶提示词）与其他层的关系

统一采用以下职责模型：

| 层 | 回答的问题 | 典型职责 |
|---|---|---|
| Autopilot Prompt | 为什么触发这次 Run、这次 Run 要完成什么 | Trigger / Run Intent |
| Squad | 哪些 Agent 一起工作 | Collaboration Unit |
| Squad Instructions | Leader 如何组织协作、交接和升级 | Leader-executed Collaboration Contract |
| Agent Instructions | 我是谁、负责什么、在哪里停止 | Role Contract |
| Skill | 这一类工作具体怎么做 | Execution Method |
| Config | 当前环境和可配置参数是什么 | Parameters |
| Script / Gate / Route | 可以确定性判断和执行什么 | Deterministic Execution / Control |
| Multica | 当前真实执行状态是什么 | Issue / Status / Stage / Run State |

进一步浓缩为：

```text
Autopilot = Trigger / Run Intent
Squad = Collaboration Unit
Squad Instructions = Leader-executed Collaboration Contract
Agent Instructions = Role
Skill = Method
Config = Parameters
Script / Gate / Route = Deterministic Execution
Multica = State
```

其中 LLM 只承担需要语义理解的部分：

```text
LLM = Semantic Reasoning
```

Autopilot Prompt 不应成为另一个 Workflow Prompt，也不应复制 Skill。

---

## 24.5 与 Issue（事项）的区别

Autopilot Prompt 描述的是：

```text
这一类定时 / 自动 Run 为什么被触发，以及运行边界是什么。
```

Issue 描述的是：

```text
这一次具体工作对象的 Goal / Context / Source Requirement
+ 必要的 OpenSpec Engineering Contract Reference。
```

Canonical Engineering Acceptance Contract 由 OpenSpec 持有；Issue 不复制 Requirement / Scenario 等工程契约正文。因此不要把某个具体 Work Item 的需求内容、Repository、Acceptance Contract 正文或一次性指令写进 Autopilot Prompt。

---

## 24.6 Review Checklist（评审清单）

Review 一个 Autopilot Prompt 时检查：

- 是否明确了本次 Run 的目标？
- 是否明确引用了对应 Skill / Capability？
- 是否明确了停止边界？
- 是否明确最终输出？
- 是否复制了 Agent Instructions？
- 是否复制了 Skill Procedure？
- 是否写死环境配置值？
- 是否包含 CLI / Script 实现细节？
- 是否把 Autopilot Prompt 写成了 Workflow Engine？

原则：

> **Autopilot Prompt 负责触发意图，不负责实现流程。**

---

# 25. 最终规范

整个 Multica 配置体系统一遵循：

```text
Agent Description
= Discoverability

Workspace / Project Context
= Shared Context

Autopilot Prompt
= Trigger / Run Intent

Squad
= Collaboration Unit

Squad Instructions
= Leader-executed Collaboration Contract

Agent Instructions
= Role Contract

Skill
= Reusable Execution Contract

Config
= Parameters

Issue
= Work Contract

Script / Deterministic Gate / Route
= Deterministic Execution / Control

Multica
= Runtime State

LLM
= Semantic Reasoning
```

全局编写遵循：

> **Native First.**

> **Greenfield First.**

> **Minimal Sufficient.**

> **Contract First.**

进一步按资产职责划分：

> **Trigger belongs to Autopilot Prompt.**

> **Collaboration unit belongs to Squad.**

> **Leader coordination rules belong to Squad Instructions; Member obligations belong to their own Instructions / bound Skills.**

> **Role belongs to Agent Instructions.**

> **Reusable execution contract belongs to Skill.**

> **Parameters belong to Config.**

> **Task belongs to Issue.**

> **Deterministic flow belongs to code / Gate / Route.**

对于 Skill 进一步统一：

> **SKILL.md = Minimal Execution Instructions.**

> **Description = What + When.**

> **Procedure defines how; Script / Gate implements deterministic logic.**

> **Detailed knowledge belongs to config / references / templates / scripts and is loaded on demand.**

对于专业产物进一步统一：

> **Method belongs to Skill; engineering truth belongs to its canonical Artifact; delivery truth belongs to Multica runtime facts; Evidence stays in its Artifact or reference; Package is only a read-set concept; Summary is a rendered view.**

> **Deleting a duplicate document must never delete the underlying execution / verification contract.**

这应作为后续设计和 Review 所有 Multica Squad、Agent、Skill 和研发交付流程的统一边界规范。

---

<a id="official-reference-policy"></a>

# 26. 官方机制与来源引用规范

## 26.1 集中维护范围

Multica 公共机制的准确含义、官方 URL、来源支持范围和核对信息，由本手册统一维护。主方案与阶段方案引用具体机制条目，不各自维护第二套原生行为说明或 URL 清单。

各方案继续维护自己的使用方式、职责、授权、输入输出、执行约束、停止条件与验收要求；集中官方依据不意味着把 Delivery 状态机、专业 Procedure 或所有运行日志移入本手册。OpenSpec 等专业方法来源由对应领域文档维护，并遵循同一引用规范。

## 26.2 何时必须引用

设计依赖平台的实际接收者、触发、Ownership、状态分类、权限、执行、回流、取消、恢复或版本参数时，在首次定义依赖或关键使用处引用本手册的具体条目。仅在文件头笼统写“遵循本手册”不能替代关键机制的来源定位。

保留正确执行所需的短约束和必要摘要，不把 Skill 写成链接清单；无须每次 Run 预读整份手册或整站文档。使用稳定标题 / 显式锚点，优先直接到达权威条目，避免多层深链。

示例：

```markdown
状态提交使用安装版本已验证的请求级暂不启动能力；
发布与状态分别回读确认，失败时不得报告提交成功。
原生行为见 [Assignment 与启动](01-multica-design-guideline-v1.13.md#mechanism-assignment)。
本项目的提交权限与具体步骤由 Analysis 阶段方案维护。
```

## 26.3 来源类别与结论边界

| 类别 | 如何写 | 不得推导为 |
|---|---|---|
| 官方操作手册 / API 文档 | 说明来源直接支持的能力及条件 | 所有安装版本已支持、项目场景已验收 |
| 官方公开实现 | 记录文件、函数 / 范围及实际核对的 tag / commit；尚未锁定时明确标注 | `main` 永不变化，注释等同所有运行路径 |
| 本项目约定 | 明确哪些角色、授权或业务条件由本项目定义，并指向其 Owner | 官方规定了本项目流程或模板 |
| 版本前提 / 待验证项 | 说明需确认的能力和不满足时的停止方式 | 已经部署、已经测试通过 |
| 本地运行证据 | 记录环境、版本、操作、实际结果与日志引用 | 超过该场景和版本范围的普遍保证 |

优先采用准确且与所述行为相符的官方手册；只有手册不足以支持必要实现细节时再引用公开实现。来源内容或版本不一致时，不拼接成不存在的统一行为；保留差异并要求核对安装版本。不能用官方“支持自定义状态”证明本项目已经实现人工审批，也不能用 `--no-start` 证明整棵任务树被锁住。

## 26.4 核对信息与版本验收

来源条目至少维护：机制用途、官方页面 / 源码链接、核对日期、结论范围及是否需要本地验收。依赖源码细节的长期契约应锁定实际核对的 release tag 或 commit；未获得固定版本时明确“未锁定，仅供检索与核对”，不得填入猜测的 SHA。

文档核对与安装验证分别记录。适配验收应覆盖实际 CLI / Server 版本、Workspace / Agent 权限、触发入口、预期与实际 Run / Status 结果；本手册可保存已验证适用范围和验收记录引用，详细日志留在对应实现的验收记录。

本版来源索引中的“2026-09-29 核对”仅表示公开资料核对，**不表示已在团队安装的 Multica 上运行测试**。本次未取得可确认的源码固定 commit；保留公开实现入口并标注该限制，不将其设为部署验收结论。

## 26.5 维护与评审

平台升级、入口改变或发现实际行为不一致时，先更新本手册对应机制条目，再检查引用方案及实际 Skill 的影响。业务规则变化更新其领域 Owner，不因改一个平台链接而重写全部专业文档。

评审同时确认：URL 是否支持所述结论；版本和接收者范围是否准确；项目使用约束是否仍完整；实际执行者能否稳定获得自己的契约；摘要与权威条目是否漂移。

---

<a id="official-source-index"></a>

# 27. 官方来源索引

本节只维护来源与支持范围，机制说明位于前文对应条目。所有外部页面按需查阅，不要求执行者逐一打开。本项目新增的文档分层、五段式 Instructions、Gate / Route 分工与审核流程不是官方固定模板。

| 来源 | 官方手册 / 公开实现 | 支持范围与核对信息 |
|---|---|---|
| <a id="source-agent-config"></a>Agent 配置 | [创建和配置智能体](https://multica.ai/docs/zh/agents-create) | §2.1–§2.2：Description 展示用途、Instructions 每次执行及职责 / 交付边界。2026-09-29 文档核对。 |
| <a id="source-skills"></a>Skills | [Skills](https://multica.ai/docs/zh/skills) | §3、§4.3：方法复用、显式绑定、Instructions 与 Skill 的边界。2026-09-29 文档核对。 |
| <a id="source-workspaces"></a>Workspace | [工作区](https://multica.ai/docs/zh/workspaces) | §4：Workspace Context 的共享范围。2026-09-29 文档核对。 |
| <a id="source-projects"></a>Project | [项目](https://multica.ai/docs/zh/projects) | §4：Project Description、资源和 Issue 上下文边界。2026-09-29 文档核对。 |
| <a id="source-squads"></a>Squad | [Squads](https://multica.ai/docs/squads) | §4.1：Leader-first、Leader-only Instructions、Roster、Access 与协作边界；评论细节并读 §2.7。2026-09-29 文档核对。 |
| <a id="source-assignment"></a>Assignment | [Assign issues to agents](https://multica.ai/docs/assigning-issues) | §2.3：Ownership、固定 Backlog、请求级暂不启动及不取消已有 Run。2026-09-29 文档核对。 |
| <a id="source-issues"></a>Issues / Status | [Issues](https://multica.ai/docs/issues) | §2.4–§2.6：Issue / Run、自定义状态分类与 Key、Parent / Child / Stage。2026-09-29 文档核对。 |
| <a id="source-runs"></a>Runs | [Runs](https://multica.ai/docs/tasks) | §2.4：运行记录、触发、结束、失败 / 重试与停止。2026-09-29 文档核对。 |
| <a id="source-comments"></a>Comments | [Comments](https://multica.ai/docs/comments) | §2.7：评论、讨论、真实 Mention 与其非 Ownership 语义。2026-09-29 文档核对。 |
| <a id="source-mentions"></a>Mention / Reply | [Mention agents](https://multica.ai/docs/mentioning-agents) | §2.7：普通回复路由、触发预览、连续评论合并及范围限制。2026-09-29 文档核对。 |
| <a id="source-cli"></a>CLI | [Using the CLI](https://multica.ai/docs/cli) | §2.3、§2.8：命令入口、结构化输出及安装版本 `--help` 边界。2026-09-29 文档核对。 |
| <a id="source-autopilots"></a>Autopilot | [Autopilots](https://multica.ai/docs/autopilots) | §2.9：自动触发入口；具体配置按安装版本验收。2026-09-29 文档核对。 |
| <a id="source-issue-trigger"></a>Issue trigger | [issue_trigger.go](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/service/issue_trigger.go) | `WillEnqueueRun`：创建 / 分配与状态提升触发的区分。2026-09-29 检视公开入口；未锁定 commit，不替代本地验收。 |
| <a id="source-child-done"></a>Parent / Stage | [issue_child_done.go](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/handler/issue_child_done.go) | `notifyParentOfChildDone`：终态 / Stage 条件与 best-effort 边界。2026-09-29 检视公开入口；未锁定 commit。 |
| <a id="source-squad-briefing"></a>Squad 注入实现 | [squad_briefing.go](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/handler/squad_briefing.go) | §4.1 的公开实现追踪入口；未锁定 commit。手册结论与本地实际注入分别核对。 |
| <a id="source-cli-implementation"></a>CLI 实现 | [cmd_issue.go](https://raw.githubusercontent.com/multica-ai/multica/main/server/cmd/multica/cmd_issue.go) | 调查 `rerun`、状态与更新命令的公开入口；`main` 可变且检索版本可能滞后，参数以安装版 `--help` / API Contract 为准。 |

---

# v1.13 变更摘要

- 收敛 Acceptance Contract Ownership：Multica Issue 保存 Goal / Context / Source Requirement、讨论与 Delivery Facts，并通过稳定引用关联 OpenSpec；Canonical Engineering Acceptance Contract 由 OpenSpec Engineering Truth 持有，不在 Issue / Instructions / Autopilot 中复制正文。
- 明确 TFS / Issue 中的验收描述属于 Source Requirement / Input，经过 Analysis 固化后的 Requirement / Scenario 或 Corrective Expected Behavior / Regression Scope 才构成工程执行使用的权威验收契约。
- 同步最新 Delivery / Analysis / Development 文档引用；不改变 Agent / Squad / Skill / Gate 的既有职责边界。

---

# v1.11 变更摘要

- Canonical Engineering Truth 对齐 OpenSpec Native Acceptance / Verification Model：不再把独立 AC / Verification Requirements 作为默认领域对象；有 Specs 时以 Requirement + Scenario 表达 Acceptance Contract，验证执行要求由 `tasks.md` 承载。
- `OpenSpec Task` Canonical Definition 扩展为 Implementation Task 或按需 Verification Task；Verification Task 仍是 Engineering Truth，不是 Multica Runtime Object。
- `bug-analysis` 明确为 Method；Corrective 最终 Expected / Actual、Root Cause / Fix Strategy / Regression Scope 进入 `proposal.md`，不再把 `bug-analysis.md` 作为默认 Artifact。
- `Regression / Integration / E2E` 明确定义为 Verification Method；`Verify Agent` Canonical Role 收窄为 **Optional Independent Verification Executor**，不拥有验收标准，也不是固定阶段。
- Multica Delivery Truth 中保留 `verify_agent.required` 与 Independent Verification Result；该事实决定是否增加独立执行者，不复制 OpenSpec Verification Contract（验证契约）。
- Anti-Pattern、文档权威归属、Method / Artifact 边界与命名规则同步更新；其他 Multica 原生机制与 Instructions / Skill 写作规范不变。

# v1.10 变更摘要

- 将 **Runtime-Centric Delivery + Artifact-Centric Engineering** 提升为顶层信息架构原则，并明确其作为后续 Agent / Skill / Gate / Artifact / Handoff 设计的第一归属判断规则；本次同版本修订不改变版本号。
- 将 v1.9 的六类 Artifact taxonomy 收敛为 **Method / Artifact / Runtime Fact / View** 四类，避免术语与概念层过度扩张。
- 新增总原则：**OpenSpec = Engineering Truth，Multica = Delivery Truth**。
- `Structured Result` 不再作为独立架构层；跨阶段 Route / Review / Gate / Approval / Assignment / Verify Decision 优先映射到 Multica 原生 Issue / metadata / custom property / comment / run result。
- Supporting Evidence 归入 Artifact / Reference；Package 降为普通 read-set 概念，不成为 Domain Type。
- 明确禁止仅为交接创建拥有独立 schema / lifecycle / version / status / reconciliation 的中间对象。
- 本次仅更新设计规范，具体 Multica 字段映射与执行资产留待方案稳定后统一实现。

---

# v1.9 变更摘要

- 新增 Method / Artifact / Runtime Fact / View 的统一边界，明确 **Skill ≠ Artifact、Logical Package ≠ Markdown、Summary ≠ Truth Source**。
- 新增持久化文件判定规则：优先复用现有权威 Artifact / Runtime / Handoff Fact；只有下游确需长期读取且没有合适 Owner 时才新增文件。
- 明确删除重复文档不等于删除 Contract；AC、Verification Requirements、Review Findings、Route / Scope 等必要信息必须先有明确 Owner。
- Analysis / Development 跨 Run 交接优先组合Engineering Artifact、Multica Runtime Facts 与 Evidence References，不建立第二套 Requirement / Spec / Design / Plan。
- 文档与 Skill Review Checklist 增加“同名 Skill 是否错误绑定同名 Markdown”“Logical Package 是否被文件化”“Summary 是否形成第二 Truth Source”等检查。
- 文档权威归属同步到主方案 v1.4.14、Analysis v1.13、Engineer v1.9；Multica 原生机制、OpenSpec Schema 与实现资产本轮不变。

---

# v1.8 变更摘要

- 新增 Canonical OpenSpec Schema IDs：`corrective-change` / `intentional-change`，直接映射 Technical Change Kind；项目采用 kebab-case `<kind>-change` 双单词命名风格。
- 明确双单词是项目命名规范，不误写为 OpenSpec 对所有 Schema ID 的通用强制规则。
- 正式拆分 TFS Type、Technical Change Kind、Delivery / Analysis Route、OpenSpec Schema 四个维度；Schema 不再使用 `corrective` 或 Route 名 `sdd-fast` 作为正常 ID。
- 当前映射：`corrective` → `corrective-change` → `bug-fix | production-fix`；`intentional` → `intentional-change` → `sdd-fast`。
- 现有 `sdd` 保留已有 Change 兼容和 Full-SDD / `sdd-standard` 候选定位，不进入当前正常 Route 映射、不迁移历史 Change。
- 同步主方案 v1.4.13、Analysis v1.12、Engineer v1.8；Multica 原生机制及 Instructions / Skill 分层规则不变。

---

# v1.7 变更摘要

- OpenSpec 设计正式采用“统一 Change Model + 分型 Schema”：Corrective=`corrective`，Intentional=`spec-driven`。
- 明确 Schema 与 Route 的职责边界：Schema 定义 Artifact / Dependency / generation / Apply 前置，Route 定义技术语义与专业方法；Schema 不成为新的 Runtime 或审批层。
- Change 创建后持久化 Schema，跨 Agent / Run 读取，不依赖上游会话重新解释；TFS 类型与 Schema 不直接绑定。
- 公共 config rules 只维护跨 Schema 真正共享的 Artifact 规则，专业写法归各 Schema instruction / template，遵守 One Rule, One Owner。
- 同步主方案 v1.4.12、Analysis v1.11、Engineer v1.7；Multica 原生机制本身无变化。

---

# v1.6 变更摘要

- 明确 OpenSpec Change 不是新的 Issue / Unit / Run / 审批对象；Corrective 轻量契约只由 Analysis 专业方案维护。
- 新增跨 Run 交接与成本边界：保留独立角色、必要持久化及接收方读取，优化重复分析 / 副本 / 无价值接力，而非强制减少 Run。
- 同步主方案 v1.4.11、Analysis v1.10、Engineer v1.6 的交叉引用；不复制专业产物清单或改变 Multica 原生机制。
- 本次为设计规范更新，不表示 Agent 配置、安装版本或 Token / 耗时已通过运行验收。

---

<a id="historical-changes"></a>

## 历史版本记录

以下 v1.6 及更早记录保留当时含义，旧文件名、旧规则与旧来源核对日期不作为 v1.7 的执行依据。当前规则见正文。

# v1.5 变更摘要

- 区分设计基线与执行资产；允许设计文档保留必要业务背景、对齐的总结视图及独立历史摘要区。
- 明确指导手册、Delivery 主方案、Analysis 与 Development 阶段方案的权威归属，引用具体规则而非笼统按文档层级覆盖。
- 集中维护 Multica 原生机制、官方 URL、支持范围和核对信息；各方案保留项目契约和精确内部引用。
- 统一当前 `analysis_review`、Gate 名称及与主方案的引用；区分生命周期专业阶段与 Multica 原生 Stage。
- 新增来源类别、可变源码、安装版本验证和维护规则；公开资料核对不等于运行验收，不要求每次 Run 加载整份手册。
