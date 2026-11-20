# Multica Agent Description / Instructions / Skill 设计规范

> Version: 1.1  
> Scope: Multica Workspace 中 Agent、Autopilot Prompt、Agent Instructions、Skill 以及相关执行上下文的设计  
> Date: 2026-09-20

本规范用于指导后续配置设计与评审，约定内容职责和设计原则。具体实现、触发机制、调度方式及运行时适配由后续方案确定；文中的 Gate / Route 等设计约定不表示相关机制已经实现。

---

## 1. 目的

本规范用于统一 Multica 中以下资产的职责和设计方式：

- Agent Description
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

> **Agent Description 说明“这个 Agent 是干什么的”；Autopilot Prompt 定义“为什么触发这次 Run、这次 Run 要完成什么”；Instructions 定义“这个 Agent 是谁、负责什么以及如何做决策”；Skill 定义“某类工作具体怎么做”；Issue 定义“这一次具体要做什么”；Deterministic Gate / Route 决定“满足什么条件才能继续以及确定性的下一步是什么”。**

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

因此可以正式采用：

> **Agent Instructions = Role Contract**  
> **Skill = Execution Method / Playbook**

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
Agent Instructions
    │
    │ Agent-specific Role Contract
    ↓
Skill
    │
    │ Reusable Execution Method
    ↓
Issue / Comment
    │
    │ 本次工作的 Goal / Context / AC
    ↓
Run
```

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

正常流程由确定性机制推进。
只有阶段切换、异常、歧义或确定性规则无法继续推进时，你才介入。
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

# 8. 为什么推荐这五部分

因此推荐的统一结构是：

```text
# Role

# Core Responsibilities

# Boundaries

# Execution Principles

# Escalation, Communication & Delivery
```

这个结构不是 Multica 官方规定的 Markdown 模板，而是本项目基于 Multica 官方 Instructions 定位制定的工程规范。

它基本一一覆盖官方强调的内容：

```text
负责什么
→ Core Responsibilities

不负责什么
→ Boundaries

收到任务首先检查什么
→ Execution Principles

允许做什么 / 修改什么
→ Boundaries + Execution Principles

如何交付
→ Communication & Delivery

什么时候询问成员
→ Escalation
```

因此可以作为本项目的统一 Agent Instructions 模板。

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

---

# 10. SKILL.md 推荐结构

可以统一采用：

```text
# Skill Name

## Purpose / When to Use

## Preconditions / Inputs

## Procedure

## Deterministic Checks

## Outputs

## Stop / Escalation Conditions

## References / Scripts
```

其中 Multica 官方明确要求的核心内容是：

```text
什么时候使用
开始前检查什么
执行步骤
结果形式
什么时候停止并询问成员
```

本规范额外增加：

```text
Inputs
Deterministic Checks
References / Scripts
```

用于适配当前 Harness / Multica 研发交付架构。

---

# 11. Skill 应该保存什么

适合放：

### Procedure

```text
如何实例化 Development Task
如何创建 Issue
如何回写 TFS
如何创建 / 更新 PR
如何执行 Integration Verify
```

### Checklist

```text
Completion Check
Verification Checklist
PR Readiness Check
```

### Tool Usage

```text
multica CLI
tfs-mcp
git
CodeGraph
测试脚本
```

### Templates

```text
Analysis Result
Verification Result
Issue Comment
Handoff
```

### Reference

```text
API conventions
repository mapping
TFS field mapping
```

### Scripts

特别适合保存：

```text
gate.py
validate.py
route.py
sync.py
```

等确定性工具。

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

因此不要在每个 Skill 开头重复：

```text
你是 Delivery Lead……
你的职责是……
你不能……
```

上述 Agent 身份与长期职责边界属于 Agent Instructions。Skill 仍应描述方法自身的适用范围、操作限制和停止条件，例如“本发布方法不得跳过发布前检查”。

可复用的研发流程可以由 Skill 承载；已有权威流程定义时，Skill 应引用或说明如何使用它，避免独立维护另一份相同规则。

Skill 应直接进入：

```text
When to use
Inputs
Procedure
Outputs
Stop conditions
```

---

# 13. “Prompt 不要复制 Workflow”原则

这是本规范最重要的工程原则之一。

## 错误方式

在 Agent Instructions 中完整维护：

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

Instructions 只需要描述：

```text
正常 Engineer ↔ Verify 闭环由既定 Route 推进，
Delivery Lead 不介入。

只有出现无法归因、多轮失败、跨任务冲突或
Deterministic Route 无法判断时才介入。
```

具体：

```text
PASS 后去哪
FAIL 后去哪
需要哪些字段
Issue 如何变状态
下一 Agent 是谁
```

已有确定性规则应由 Deterministic Gate / Route 统一定义，Skill 描述如何调用或使用这些规则，不另行维护一套相同的路由判断。

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
PR merged == true
Verify result == PASS
所有 child issue == done
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
需求是否发生实质变化
PR Feedback 是否推翻原 Analysis
Bug 属于哪个 Development Task
多个 Task 是否存在语义冲突
是否需要重新拆分任务
失败 Evidence 能否可靠归因
```

这些才是 Agent Instructions 应定义判断原则的地方。

---

# 15. 各配置层的正式职责边界

| 层 | 解决的问题 | 生命周期 | 典型内容 |
|---|---|---|---|
| Agent Description | 这个 Agent 干什么 | 长期 | 一句话角色介绍 |
| Workspace Context | 我们这个团队怎么工作 | Workspace 长期 | 团队背景、公共约定 |
| Project Context | 这个项目有什么统一约束 | Project 生命周期 | 项目目标、技术边界 |
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
| 某个 Agent 的长期职责与边界 | Agent Instructions |
| 某类工作可复用的方法与流程 | Skill |
| 当前 Issue 特有的目标、要求与 AC | Issue |

选择与规则内容和适用范围相符的位置作为权威定义；其他位置可以引用，不独立维护重复版本。

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

以后新增或 Review 一个 Multica Agent / Autopilot 时，应检查：

### Autopilot Prompt

- 是否只描述 Run Intent，而不是实现流程？
- 是否明确执行目标、Skill、停止边界和最终输出？
- 是否没有复制 Agent Instructions / Skill Procedure？
- 是否没有写死环境配置和脚本细节？

### Agent Description

- 是否一句话即可理解 Agent 的用途？
- 是否没有承担执行约束？

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

### Skill

- 是否描述具体执行方法？
- 是否明确适用场景？
- 是否有 Preconditions？
- 是否有明确 Procedure？
- 是否定义 Output？
- 是否定义 Stop / Escalation Conditions？
- 是否保留方法自身的限制，并避免重复定义 Agent 的长期职责？
- 可确定的逻辑是否尽可能由 Script 承担？

### Workflow / Gate

- 可以程序化判断的事情是否仍交给 LLM？
- PASS / FAIL / UNKNOWN 是否明确？
- Route 是否有唯一事实来源？
- 规则归属与执行方式是否分别明确，跨层引用是否指向同一权威定义？
- Prompt 中是否又维护了一套重复 Workflow？

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
| Agent Instructions | 我是谁、负责什么、在哪里停止 | Role Contract |
| Skill | 这一类工作具体怎么做 | Execution Method |
| Config | 当前环境和可配置参数是什么 | Parameters |
| Script / Gate / Route | 可以确定性判断和执行什么 | Deterministic Execution / Control |
| Multica | 当前真实执行状态是什么 | Issue / Status / Stage / Run State |

进一步浓缩为：

```text
Autopilot = Trigger / Run Intent
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

Agent Instructions
= Role Contract

Skill
= Reusable Execution Method

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

进一步浓缩为六条原则：

> **Trigger belongs to Autopilot Prompt.**

> **Role belongs to Instructions.**

> **Method belongs to Skill.**

> **Parameters belong to Config.**

> **Task belongs to Issue.**

> **Deterministic flow belongs to code / Gate / Route.**

这应作为后续设计和 Review 所有 Multica Agent、Skill 和研发交付流程的统一边界规范。

---

## 官方参考

以下文档于 2026-09-20 核实；本规范中的五段式模板、规则归属和 Gate / Route 分工属于本项目的工程约定。

- [智能体](https://multica.ai/docs/zh/agents)：Agent 的定位和配置项。
- [创建和配置智能体](https://multica.ai/docs/zh/agents-create)：Agent Description 与 Instructions 的作用。
- [Skills](https://multica.ai/docs/zh/skills)：Skill 与 Instructions 的边界及内容建议。
- [工作区](https://multica.ai/docs/zh/workspaces)：Workspace Context 的适用范围。
- [项目](https://multica.ai/docs/zh/projects)：Project Description 与任务上下文的边界。
