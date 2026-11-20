# Multica Agent / Squad / Instructions / Skill 设计规范

> Version: 1.4  
> Scope: Multica Workspace 中 Agent、Squad、Autopilot Prompt、Agent Instructions、Squad Instructions、Skill 以及相关执行上下文的设计  
> Date: 2026-09-29

本规范用于指导后续配置设计与评审，约定内容职责和设计原则。具体实现、触发机制、调度方式及运行时适配由后续方案确定；文中的 Gate / Route 等设计约定不表示相关机制已经实现。

---

## 1. 目的

本规范用于统一 Multica 中以下资产的职责和设计方式：

- Agent Description
- Squad / Squad Instructions
- Agent Instructions
- Autopilot Prompt
- Skill
- Workspace Context
- Project / Issue Context
- Deterministic Gate / Route

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

### Native First

先使用 Multica 已有的 Assignment、Squad、Comment、Parent / Child、Stage 与 Run 能力。简单稳定的成员分工写入 Leader 可见的协作规则；规则能够程序化不代表必须新增脚本。仅为明确的业务校验、批量处理、副作用幂等或恢复需求增加 Script / Gate，不预设第二套 Runtime、全局锁或事务框架。

### Greenfield First

只描述当前目标状态。除非当前系统明确要求兼容，否则不维护历史方案、旧术语、迁移路径、版本差异或兼容分支。

### Minimal Sufficient

只保留影响职责、决策、执行、验证、输出或停止条件的信息。删除后不影响正确执行的内容不进入配置资产。

### Contract First

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

---

## 1.2 Canonical Terminology

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

### 1.2.1 Squad / Agent Canonical Names

| Concept | Canonical Name | Object Type | 允许的关系描述 | 禁止作为同一实体的第二名称 |
|---|---|---|---|---|
| 研发交付协作单元 | `Delivery Squad` | Squad | Squad | Delivery Team / Delivery Group |
| Delivery Squad Leader | `Delivery Lead` | Agent | Leader / Squad Leader | Delivery Lead Agent / Lead |
| 分析成员 | `Workitem Analyst` | Agent | Member | Analyst / Workitem Analyst Agent |
| 后端研发成员 | `Backend Engineer` | Agent | Member / Engineer | Backend Agent |
| 前端研发成员 | `Frontend Engineer` | Agent | Member / Engineer | Frontend Agent |
| Flink 研发成员 | `Flink Engineer` | Agent | Member / Engineer | Flink Agent |
| 验证成员 | `Verify Agent` | Agent | Member | Verify / Verifier / Verification Agent |
| TFS 同步 | `TFS Sync Agent` | Agent | Squad 外 Agent | Sync Agent |

其中 `Leader`、`Member`、`Squad Leader`、`Engineer`、`Specialist Agent` 只能用于描述类型、关系或角色类别；当指向具体 Multica 配置对象时，必须使用对应 Canonical Name。

### 1.2.2 Delivery Object Canonical Names

| Concept | Canonical Name | 含义 | 不再作为正式名称使用 |
|---|---|---|---|
| TFS 来源对象 | `TFS Work Item` | 外部工作项 | Work Item（上下文不明确时） |
| 完整交付对象 | `Delivery Issue` | 一个 TFS Work Item 在 Multica 中的完整交付对象 | Parent Issue / Parent |
| 独立逻辑研发单元 | `Development Unit` | 独立 Owner、推进、验证与完成的逻辑单元 | Development Task |
| 独立 Multica 子任务 | `Development Sub-Issue` | Development Unit 需要独立生命周期时创建的 Sub-Issue | Development Issue / Child Issue |
| 仓库级修改对象 | `Repository Change` | 某个 Repository 的代码修改与交付范围 | Repo Task / Repository Unit |
| 仓库级代码交付对象 | `PR` | 一个 Repository 的 Pull Request | — |

正式关系：

```text
Delivery Issue
    ↓
1..N Development Unit
    ↓
1..N Repository Change
    ↓
每个发生代码变更的 Repository Change 对应独立 PR
```

多个 Repository 不等于多个 Development Sub-Issue；Sub-Issue 只用于表达真正独立的 Development Unit。

### 1.2.3 Status Key 与 Display Name

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

### 1.2.4 Analysis Route Canonical IDs

当前一级 Analysis / Delivery Route 统一为：

```text
bug-fix
production-fix
sdd-fast
sdd-standard
```

`hotfix` 当前不建模为独立 Route / Policy。

### 1.2.5 Gate Canonical Names

当前交付方案统一使用：

```text
Analysis Gate
Verification Gate
PR Transition Gate
Development Completion Check
Delivery Completion Gate
```


### 1.2.6 Naming Usage Rules

后续所有 `multica-squad-centric-delivery`、`workitem-analysis`、Agent Instructions、Squad Instructions、Skill、Config、Script 和 Artifact 遵循以下规则：

1. 指向具体 Multica 对象时，使用 Canonical Name，不使用简称或角色关系替代名称；
2. 配置、状态判断和脚本使用 Canonical Key / ID，不使用 Display Name；
3. `Analyst` 不再作为 `Workitem Analyst` 的别名；
4. `Verify` 仅可表示验证动作；指 Agent 时必须写 `Verify Agent`；
5. `Engineer` 仅可作为 Backend / Frontend / Flink Engineer 的角色类别；指具体 Agent 时使用完整名称；
6. `Parent Issue`、`Development Issue` 不再作为正式交付对象名称；
7. 下游方案只引用本节定义，不独立维护第二份全局术语表；
8. 新增术语时优先更新本节，再同步修改引用方案，遵守 **One Rule, One Owner**。

---

# 2. Multica 官方机制核实

## 2.1 Agent Description

Multica 官方明确说明：

**Agent Description 是面向团队的简短介绍，只显示在 Agent 列表和详情页，不会进入 AI Coding Tool 的执行 Prompt。**

因此：

> Agent Description 是 UI / Discoverability 信息，不是 Agent 的执行规则。

不能依赖 Agent Description 对 Agent 行为进行约束。

---

## 2.2 Agent Instructions

Multica 官方定义：

> Instructions 用于定义 Agent 的职责、工作方式、边界和交付要求，并且 **Used on every run**。

官方进一步明确，Instructions 通常应该描述：

- Agent 负责什么、不负责什么；
- 收到工作后首先检查什么；
- 允许修改什么；
- 如何交付结果；
- 什么情况下需要向成员确认。

因此此前的两个判断可以确认：

### 结论 A

> **Agent Instructions 应主要描述 Agent 长期稳定的职责、边界、工作原则和交付要求。**

这是 Multica 官方明确支持的设计方式。

### 结论 B

> **Agent Instructions 会在每次 Run 中提供给 Agent。**

这也是官方明确行为。

因此从工程角度进一步推导：

> Instructions 应尽量保持稳定、精炼，避免放入大量仅部分场景才需要的流程、操作手册和参考资料。

“精炼”属于本规范的工程建议，不是 Multica 官方硬性长度要求。

---

# 3. Skill 的官方定位

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

# 4. 不应只有三层：完整配置边界

Multica 实际还存在 Workspace、Project 和 Issue 级 Context。

官方说明：

- **Workspace Context** 会提供给 Workspace 中的所有 Agent，适合团队背景、产品约定以及长期有效的公共要求；
- 一次性的执行要求应该放在对应 Issue 中。
- Project Description 适合项目级目标、技术边界和交付约定，而只属于单个 Issue 的要求应放在 Issue 中。
- Issue 本身保存目标、背景、要求、Acceptance Criteria、讨论和执行历史。

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

## 4.1 Squad / Squad Instructions

对于需要多个 Agent 协作完成同一个工作对象的场景，本规范增加 Squad 维度。

### Squad

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

### Squad Instructions

Squad Instructions 是：

> **提供给 Leader 的 Collaboration Contract：由 Leader 执行的协调、路由、交接与升级规则。**

Multica 的 Squad Instructions 只提供给 Leader，不自动广播给 Member。Leader Run 还会收到原生 Squad Operating Protocol 与 Roster；成员角色说明帮助 Leader 选择执行者，不代替 Member 的执行指令、不授予权限，也不自动给成员绑定 Skill。此处描述注入范围，不声明所有任务共享一个 Prompt 或会话。[^g-squad]

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
- 当前 Issue 的具体需求和 Acceptance Criteria；
- 已有权威 Script / Gate 维护的状态机副本；
- 仅写在这里却期待 Member 自行遵守的专业执行义务。

本节属于本项目基于 Multica Squad 能力制定的工程约定，不表示 Multica 官方规定了固定的 Squad Instructions Markdown 模板。

## 4.2 Squad Leader 与 Member 边界

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
替代 Analyst 做正式分析
替代 Engineer 完成生产代码
替代 Verify 做正式验证
替代 Human Approval
覆盖明确的 Deterministic Gate FAIL
通过 Prompt 维护一套完整 Workflow Engine
```

Member 负责自己的专业工作，不承担整个 Squad 的全局编排。

职责明确、需要一个 Agent 持续负责的独立工作直接 Assignment 给该 Agent；当前 Issue 内的临时协助用 `@mention`。只有工作本身需要持续多角色协调或 Owner 不能明确时才使用 Squad。父 Issue 属于 Squad，不要求每个子 Issue 也属于 Squad。[^g-squad]

同一个 Leader Agent 在父子 Issue 上的 Run 是不同的工作上下文。子级协调当前交付单元，父级协调其整体目标；不能将“子 Issue 的 Leader 被唤醒”当成“父 Issue 已经收到回流”。正常回流优先使用已核实的原生机制。

同一工作只选一个正常触发入口。状态写入、任务触发与任务取消是不同操作；不以改状态代替显式启动或取消，也不同时用子任务激活和父级 Mention 派发同一工作。

## 4.3 Squad Instructions 与 Agent Instructions 的边界

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

Agent Instructions 可以引用方法的权威 Skill；无需再复制整套 Procedure。多个 Agent 使用同一方法时，绑定同一 Skill，不复制多份实现。Workspace / Project Context 仅保存对应范围真正共享的规则，不因“想让成员看见”就把完整 Delivery Workflow 放入公共上下文。[^g-skills]

## 4.4 注入与派发规则

Leader 派发只补充本轮必要的目标、范围、顺序和约束，不转述完整 Issue，不复制完整 Squad Instructions 或 Member Skill。原生协议、Roster 与项目自有规则应区分，不维护一份会与平台漂移的原生协议副本。

Member 通过自身 Instructions、明确绑定的 Skill 和当前 Issue / Comment 获得执行契约。直接 Assignment 启动的 Specialist 也必须能够独立执行，不依赖先经过 Leader 转述。加入 Squad 不意味着自动继承 Leader Instructions、Squad Instructions、其他成员 Skill、工具权限或会话。

配置 Review 同时检查两个问题：规则的权威定义在哪里；执行该规则的 Agent 是否稳定获得该定义或必要引用。One Rule, One Owner 不等于只能把所有规则放在 Leader 可见的位置。

对来源不明确或无法获得的必需输入，执行者应停止并说明缺口，不假设它已经通过父级会话自动传递。

---

# 5. Agent Description 规范

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

## 5.3 Agent Description 不应该包含

不要放：

- Workflow；
- Gate 判断；
- 操作步骤；
- Tool 使用方法；
- Skill 使用方法；
- Exception Playbook；
- Prompt Rules；
- Acceptance Criteria；
- 当前任务信息。

### 判断原则

删除这段 Agent Description 后：

> Agent 的实际执行行为不应该发生变化。

否则说明本应属于 Instructions 的规则错误地写进了 Agent Description。

---

# 6. Agent Instructions 规范

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

# 7. Agent Instructions 推荐结构

统一采用以下五部分。

Instructions 可以保留每次执行都必需的简短启动检查和交付动作；详细操作步骤与可复用流程放入 Skill，避免重复维护。

## 7.1 Role

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

## 7.2 Core Responsibilities

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

## 7.3 Boundaries

这是 Multica Agent Prompt 中非常重要的一部分。

明确：

```text
What NOT to do
```

例如：

```text
不得直接修改生产代码。
不得替代 Verify Agent 完成正式验证。
不得替代人工批准 PR。
不得覆盖 Deterministic Gate FAIL。
```

职责边界通常比额外增加能力描述更重要。

原则：

> **Agent 要知道自己应该停止在哪里。**

---

## 7.4 Execution Principles

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

## 7.5 Escalation, Communication & Delivery

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

### Escalation

什么时候必须停止自主推进：

```text
UNKNOWN
责任归属不明确
关键证据缺失
规则冲突
需要人工批准
超出权限
```

### Communication

与 Agent / Member 沟通时需要提供什么：

```text
事实
问题
Evidence
下一步
责任人
```

### Delivery

Agent 最终如何交付：

```text
Issue Comment
Artifact
PR
Status Update
TFS Update
Structured Result
```

这里定义 **交付契约**，但不要重新描述整个执行步骤。

---

# 8. Agent Instructions 标准结构

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

# 9. Skill 规范

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

## 9.2 Skill 与 SKILL.md

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

---

# 10. SKILL.md 推荐结构

## 10.1 Frontmatter

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

## 10.3 Minimality Principle

`SKILL.md` 遵循：

> **Minimum Sufficient Instruction：只保留正确执行当前方法所需要的最小充分信息。**

判断某段内容是否应留在 `SKILL.md`，统一询问：

> **Agent 在执行这个 Skill 时，如果不知道这段内容，是否会影响正确执行或安全停止？**

如果答案是否定的，通常应删除或移出 `SKILL.md`。

这不是追求最短文本，而是减少与当前执行无关的信息、重复规则和上下文负担。

## 10.4 Progressive Disclosure

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

# 11. Skill 应该保存什么

## 11.1 SKILL.md 中适合保存

### Preconditions / Inputs

例如：

```text
需要哪些输入
输入来源是什么
必需工具 / 权限是否可用
开始前必须满足什么条件
```

### Procedure

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

### Validation

定义完成标准，例如：

```text
Artifact 是否存在
Evidence 是否完整
Schema 是否有效
Test 是否通过
Gate 是否 PASS
Completion Criteria 是否满足
```

### Output

定义最终交付契约，例如：

```text
Artifact
Structured Result
Issue Comment
Metadata Update
Status Change
PR / Verification Report
```

### Error Handling / Stop Conditions

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

# 12. Skill 不应该承担什么

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

## 12.2 不要重复 Agent 身份

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

## 12.3 不要维护第二套 Workflow

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

# 13. “Agent / Squad Instructions 不要复制 Workflow”原则

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
→ Integration Verify
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

# 14. LLM Decision 与 Deterministic Decision 边界

对于当前 Multica 架构，进一步统一如下。

## Deterministic Decision

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

## LLM Semantic Decision

适用于：

```text
人工自然语言意见表达什么决定、附加条件、修正方向及是否需要再次确认
需求是否发生实质变化
PR Feedback 是否推翻原 Analysis
Finding 属于哪个 Development Unit
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

# 17. Agent Prompt 风格规范

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

# 18. Role-oriented，而不是 Workflow-oriented

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

# 19. Principle-oriented，而不是 Procedure-oriented

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

# 20. Boundary-first，而不是 Capability-first

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

# 21. 常见 Anti-Patterns

### Super Prompt

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

### Workflow-as-Prompt

通过大量：

```text
IF A THEN B
IF B THEN C
```

让 LLM 模拟状态机。

应该优先迁移至 Deterministic Gate / Route。

---

### Skill-as-Agent

Skill 中大量写：

```text
你是谁
你的职责是什么
你不能做什么
```

如果这些内容重复定义 Agent 的身份与长期职责，说明 Agent Instructions 和 Skill 边界混乱。方法自身的限制与停止条件仍应保留在 Skill。

---

### Task-as-Instructions

将某一个具体需求、本次临时操作的 Repository 或本次 Acceptance Criteria 写进 Agent Instructions。

本次需求与 AC 应放入 Issue；仓库上下文按适用范围放入 Issue 或 Project Context。若某个 Agent 长期负责特定 Repository，则该仓库范围可以作为 Agent Instructions 的职责边界。

---

### Squad-as-Agent

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

### Leader-as-Workflow

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

### Skill-as-Design-Document

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

### Reminder-Pile

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

### Reference-in-SKILL

把完整 Metadata Schema、API 字段、Repository Mapping、CLI 帮助或大量 Contract 直接复制进 `SKILL.md`。

正确方式：

```text
SKILL.md
→ 说明何时需要该知识
→ 引用对应 references 文件
```

详细资料按需读取，不应成为每次 Skill 执行的默认上下文。

---

### Implicit Squad Inheritance

把仅提供给 Leader 的 Squad Instructions 当成 Member 的自动执行契约，或认为加入 Squad 就继承 Skill / 权限。

必须检查实际接收者；Member 的职责放自身 Instructions，方法放绑定 Skill，当前要求放 Issue / Comment。不要用每次派发复制整份配置来补救。

---

### Duplicate Rules

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

# 22. 推荐的 Agent Instructions 大小

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

# 23. Agent 配置 Review Checklist

以后新增或 Review 任一 Multica 配置资产时，先检查：

### 全局

- 是否只描述当前目标状态，没有历史兼容和版本迁移内容？
- 是否只保留影响职责、决策、执行、验证、输出或停止条件的信息？
- 是否直接定义 Contract，而不是背景、设计过程、方案比较和解释？
- 是否存在删除后不影响正确执行的说明性内容？
- 是否先核实原生能力，而不是为简单交接或状态写入建立新的 Runtime / 事务 / 锁？

然后按资产类型检查：

### Autopilot Prompt

- 是否只描述 Run Intent，而不是实现流程？
- 是否明确执行目标、Skill、停止边界和最终输出？
- 是否没有复制 Agent Instructions / Skill Procedure？
- 是否没有写死环境配置和脚本细节？

### Agent Description

- 是否一句话即可理解 Agent 的用途？
- 是否没有承担执行约束？

### Squad / Squad Instructions

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

### Instructions

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

### Skill

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

### Workflow / Gate

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


# 24. Autopilot Prompt 规范

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

## 24.2 Autopilot Prompt 只维护四类信息

Autopilot Prompt 原则上只维护以下四类内容：

### 1. 执行目标

说明本次自动运行要完成什么工作。

例如：

```text
执行一次 TFS Work Item 同步。
```

### 2. 使用哪个 Skill

明确本次 Run 应使用的可复用执行方法。

例如：

```text
执行 `tfs-sync` Skill。
```

### 3. 本次 Run 的边界

只描述本次自动运行必须停在哪里，不复制完整 Workflow。

例如：

```text
同步并初始化 Parent / Analysis；Analysis 保持 backlog，不启动后续流程。
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

## 24.3 Autopilot Prompt 不应该维护什么

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

## 24.4 Autopilot Prompt 与其他层的关系

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

## 24.5 与 Issue 的区别

Autopilot Prompt 描述的是：

```text
这一类定时 / 自动 Run 为什么被触发，以及运行边界是什么。
```

Issue 描述的是：

```text
这一次具体工作对象的 Goal / Context / Acceptance Criteria。
```

因此不要把某个具体 Work Item 的需求内容、Repository、AC 或一次性指令写进 Autopilot Prompt。

---

## 24.6 Review Checklist

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

这应作为后续设计和 Review 所有 Multica Squad、Agent、Skill 和研发交付流程的统一边界规范。

---

## 官方参考

基础官方定位来源如下；Squad 注入与执行边界于 2026-09-27 结合官方文档和公开实现核对。五段式模板、规则归属、可恢复执行与 Gate / Route 分工属于本项目工程约定，不代表官方固定模板。公开 `main` 不能代替安装版本验收。

- [智能体](https://multica.ai/docs/zh/agents)：Agent 的定位和配置项。
- [创建和配置智能体](https://multica.ai/docs/zh/agents-create)：Agent Description 与 Instructions 的作用。
- [Skills](https://multica.ai/docs/zh/skills)：Skill 与 Instructions 的边界及内容建议。
- [工作区](https://multica.ai/docs/zh/workspaces)：Workspace Context 的适用范围。
- [项目](https://multica.ai/docs/zh/projects)：Project Description 与任务上下文的边界。

- [Squads](https://multica.ai/docs/squads)：Leader-only Squad Instructions、Roster、直接 Assignment 与 Squad 协作边界。
- [Tasks](https://multica.ai/docs/tasks)：Run 与 Issue 状态、重试和当前 Owner 的 rerun。
- [Assign issues](https://multica.ai/docs/assigning-issues)：请求级暂不启动、Ownership 与执行生命周期。

[^g-squad]: [Multica Squads](https://multica.ai/docs/squads)；[Squad briefing 公开实现](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/handler/squad_briefing.go)。实际注入根据本次 Run 的角色构建，不等于全部 Member 共享该上下文。
[^g-skills]: [Multica Skills](https://multica.ai/docs/skills)：Skill 显式绑定到 Agent，同一份 Skill 可服务多个 Agent。
