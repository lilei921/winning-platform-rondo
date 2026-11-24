# 09｜Unified Engineer Development Design（基于 OpenSpec Change 的单 Agent 研发与 PR 提交）

> 状态：PR #128 已实现 Change 级研发的基础入口。2026-11-19 确认的根仓分支与单需求发布修复待实施、待验收。
> Scope: Requirement Development；`change_ref` 是唯一正常派发输入；一个 `Engineer` 在一次正常 Run 内完成研发与 PR 创建；TFS 子任务由 Delivery 独立管理
> 上位规范：[01 设计原则](01-multica-openspec-design-guideline.md)、[02 Delivery](02-multica-delivery-lifecycle-design.md)、[03 Analysis](03-workitem-analysis-design.md)、[04 Development](04-engineer-development-design.md)、[05 OpenSpec](05-openspec-schema-implementation-design.md)、[06 Method / Skill](06-method-skill-library-implementation-design.md)
> 根仓运行契约与修复验收分别见 [08-B Requirement 跨 Runtime 交付](08b-requirement-remote-git-delivery.md) 和 [常驻根仓分支与单需求发布修复方案](08b-requirement-root-branch-and-publish-plan.md)。08-B §7.1 记录了既有本地 Desktop 实验及其适用范围。
> 资产边界：新增独立 `Engineer` Agent 与 `change-development` Skill，不修改、不绑定或依赖旧 Engineer Instructions / Skills；Analysis 保留现有 Workitem Analyst，按 08-B §3.2–§3.5 规划定向优化。共享 Rondo 必须保持旧执行入口可用。

## 1. 最终模型

**一个 Engineer Agent、一个 OpenSpec Change、一次正常派发、同一个 Run 完成研发并创建 PR。**

**本期前提：同一需求不会同时派发两个 Engineer。** 同一业务 Worktree 的并发写入不纳入本期设计或验收，不新增写锁或执行权协调机制。不同需求使用各自的业务 Worktree 并发研发，向同一根仓分支发布时，Rondo 按 08-B 只发布当前 Change 的已提交差异。前一 Run 结束后可复用相同需求的业务 Worktree。

```text
Workitem Analyst → 持久化根仓中准备并发布 OpenSpec → Human Approval
Delivery Lead -- @Engineer(change_ref) -->
  Engineer
    → 按获批 analysis.source.commit 读取 proposal / specs / design / tasks.md
    → 核对当前 Multica Run、Human Approval 与 Repository Scope
    → 准备常驻根仓和授权业务仓的 Worktree，根据 tasks.md 完成研发、必要验证与 Code Review
    → 对实际有代码变更的各仓 Commit / Push / PR Preparation
    → 在常驻根仓保存 Tasks、Evidence、PR 描述的已验证改动
    → 基于远端同名分支最新提交发布当前 Change 差异 → 回读并登记研发交付 SHA
    → Change 级 Completion Check → rondo pr materialize（创建/复用当前 Change 所需 PR）
    → 在 Issue 一次性回流 PR URL / Evidence / 实际结果 → 结束 Run
PR Status Sync → PR 终态核实 → Archive → TFS Writeback → Issue Done
```

**明确取消的概念和传参**：

- 派发消息只含 `change_ref`，不传仓库清单或任务编号列表；当前 Issue、Run、执行者等身份由 Multica Runtime 提供。
- 不再按部分 OpenSpec Tasks 拆分 Engineer 工作单元：不创建 Task Set 派发、任务子 Issue、跨多个 Engineer 的任务 Owner 分配，也不再使用 `task_refs` 作为派发、Runtime Metadata 或完成检查的契约字段。
- `tasks.md` 的编号和 checkbox 仅用于工程任务定位、实现与进度；不建立新的 `task_refs` 派发层，也不要求与 TFS 子任务一一对应。TFS 子任务为独立的外部管理对象，由 PR Status Sync Agent 在收口阶段根据实际业务 Commit 规划 1–5 个，Rondo 负责硬校验与写回；不能无计划默认创建。详见 [10 方案](10-tfs-subtask-estimation-design.md)。Workitem Analyst 和 Engineer 不负责调整 OpenSpec Task 粒度。
- `Repository Scope` 仅限定允许修改的仓库，Engineer 根据实际实现判断本次修改哪些仓库；Rondo 从已批准的 `.openspec.yaml` 与 Registry 读取授权，不为新路线另建 `repo_keys` 派发事实。
- 正常路径不需要 Engineer 开发完成后先向 Lead 汇报，再被第二次 `@Engineer` 才能创建 PR。任务发生真实中断或需要返工时使用已有恢复能力，不等于重新拆分工作单元。
- 新 `Engineer` 仅在明确选用本方案时承担 Change 级工作；现有 `Backend Engineer`、`Frontend Engineer` 及其 Agent Instructions / Skills 独立保留，不作为新路线的依赖，也不因新增角色被自动改派。

## 2. 唯一事实源与职责

| 内容 | Owner / 权威来源 | 目标约束 |
| --- | --- | --- |
| Requirement / Scenario、Proposal / Specs / Design / `tasks.md`、研发验证依据 | OpenSpec Change | 当前 Change 是唯一工程工作单元，Engineer 读取所有适用研发任务 |
| Human Approval、当前 Agent / Run、`current_pr`、Issue 状态 | Multica | Lead 使用原生 `@mention` 派发；新路线不新增 `dev.dispatch` 物化 |
| Repository Identity 与授权范围 | 已批准 `.openspec.yaml` 的 `x-repositories` + Rondo Registry | Scope 是授权上限；Engineer 决定实际修改仓库，Rondo 只校验身份和越权 |
| 当前仓库真实实现/构建/测试/CI | 业务 Git Repository | Engineer 以当前工作树和 Candidate 为准，不按仓库类别猜测命令 |
| Local Validation、Code Review、实现/PR 文案语义 | Engineer | 仅在批准边界内自主做技术决策 |
| 关键副作用前的身份 / 授权检查、Git / 进度 / PR 操作与回读 | Rondo | 只做确定性检查，不代替 Engineer 判断需要修改哪些仓库 |
| Independent Verify 与 Human 决定 | Verify Agent / Human，由 Lead 协调 | 本期不实现新的 Independent Verify 闭环，保留已有 `required=true` 阻断 |
| PR 状态巡检、Archive、TFS Writeback、Issue Done | PR Status Sync / Delivery + Rondo | TFS 子任务由 Delivery 独立管理；不得反向约束 OpenSpec Tasks |

Repository Scope 仅以经 Human 批准的 `.openspec.yaml` 的 `x-repositories` 中所列 `repo_id` 为准，映射根仓 `repo-context.yaml`；Design / Tasks 可说明实现位置，但不新增授权。它是**可修改仓库的上限**，不要求每个 Scope 仓库产生 Commit / PR。Engineer 根据实际工程任务决定变更仓库并提供 Candidate / Evidence；Rondo 校验实际交付仓库均在授权范围内、Candidate / PR Preparation 一致，不从 Tasks 自然语言推断必改仓库。Scope 缺失、冲突或 Registry 无法映射时停止并交 Lead 协调，不另建授权事实存储。

## 3. 新 Engineer Agent 与独立 Skill

新增独立 `Engineer`，不复用或修改现有 `Backend Engineer`、`Frontend Engineer` 的 Agent Instructions，也不修改或绑定旧 `development-execution`、`pull-request` 及领域 Skills。新 Agent 的职责仍是软件工程实施，不承担需求分析、团队调度、独立验收或外部管理收口。

**Name**：`Engineer`；**Professional Goal**：完成正确、可维护、可验证的软件变更与必要代码交付。Multica 将其配置为 Delivery Squad Member 是运行时协作关系，不写入 Agent Instructions。

### 3.1 Agent Instructions 目标稿

~~~markdown
# Role & Goal

你是 Engineer，负责根据已确认的工程要求，完成正确、可维护、可验证的软件实现，并交付可供审查的代码变更。

# Core Responsibilities

- 理解当前工程要求、现有实现和修改范围，明确预期行为与技术约束。
- 在授权范围内完成必要的代码实现、集成和调整。
- 完成与变更风险相匹配的 Local Validation、Code Review 和问题修正。
- 提交可追溯的代码变更、验证结果及必要的 Pull Request。

# Working Principles

- 以已确认的工程要求、实际代码和可验证的事实为依据，不将假设当作结论。
- 优先复用现有实现，采用最小必要修改，遵循当前仓库的技术规范。
- 根据任务复杂度和技术栈自主选择实现、测试和审查方法，不强制固定工具或执行步骤。
- 验证结果必须真实且与当前代码一致，不以推测或自述代替验证。
- 遇到问题时优先定位原因并处理受影响范围，不进行无关重构。

# Boundaries & Delivery

- 不擅自改变已批准的业务行为、验收要求或修改范围。
- 不替代需求审批或独立验收，不负责代码合并后的交付管理。
- 关键工程要求不明确、必要验证无法完成或修改超出授权范围时，停止受影响的工作并说明原因。
- 交付实际代码变更、验证与审查结果、必要的 PR，以及尚未解决的问题和风险。
~~~

这份 Instructions 仅定义 Engineer 的长期专业职责与结果边界；不包含 Squad 身份、Run 时序、OpenSpec 交接、Rondo / MCP 名称或具体 Workspace 实现。这些由当前任务、技能和执行环境分别提供。

### 3.2 Workspace Skill / MCP 绑定（目标）

```json
{
  "dir": "engineer",
  "name": "Engineer",
  "visibility": "workspace",
  "mcp_servers": ["remote-codegraph", "remote-filesystem", "remote-ripgrep"],
  "skills": ["change-development"]
}
```

MCP 能力直接绑定 Agent，Skill 未加载时不影响 Agent 知道可用的只读代码探索入口。Skill 是否实际注册和启用，以 Workspace Provision / Sync 回读为准；仓内文件存在不等于已可运行。

### 3.3 新 `change-development` Skill（目标契约）

只新增一个工作型 Skill，以 OpenSpec Change 的工程实施为场景；不因 PR 是执行步骤而另建 Skill。Skill 只规定完成工程变更所需的方法与结果，不绑定使用者的 Agent、Squad、Run 或 Git 工作区方案。

~~~markdown
---
name: change-development
description: 根据已批准的 OpenSpec Change 完成软件实现、开发侧验证和代码交付；适用于将工程变更落实为可验证代码的场景。
---

# Inputs

- 已批准的 OpenSpec Change，包括适用的 Proposal、Specs、Design 和 tasks.md。
- 可访问且获得修改授权的代码仓库。
- 必要的工程上下文、验证要求及交付工具。

# Approach

## Understand

- 阅读工程契约，明确预期行为、实现任务、修改范围及验证要求。
- 检查相关代码、依赖与现有测试，复用仍然有效的分析和工程成果。
- 确认工作区与代码基线可用，不覆盖或破坏已有修改；必要时可在批准范围内细化非实质性的技术设计。

## Implement

- 根据任务依赖和实际代码结构自主选择实现顺序。
- 优先采用最小必要修改，遵循仓库现有架构、代码规范与接口契约。
- 按需选择测试驱动、增量实现、局部设计或问题诊断等方法，不强制固定方法链。

## Validate

- 针对变更行为及影响范围执行必要的测试、构建、静态检查或运行验证。
- 完成 Code Review，修复 Blocking Findings，并对受影响部分重新验证。
- 仅将有真实验证依据的开发任务标记为完成。
- 记录实际验证结果、适用的代码版本及未解决风险。

## Deliver

- 对实际代码修改形成 Commit，并按交付要求 Push。
- 保存可追溯的 Candidate、验证和 Review Evidence，更新实际完成的工程任务进度。
- 通过适用的确定性完成检查后，为需要代码审查的变更创建或复用 PR。
- 核实实际交付结果，提供代码、PR 和 Evidence 的有效引用。

# CLI Operations

使用 Rondo 完成确定性检查与交付操作；参数来自已确认的当前任务和配置，具体语法以实际安装的 CLI 为准。以下是已有的基础命令：

```bash
# 按批准来源读取工程任务
rondo analysis read --config "<config>" --issue <issue> --file tasks.md

# 计算当前 Change 的工程契约摘要（Evidence 需要时）
rondo dev contract-hash --openspec-root "<root>" --change-ref <change_ref>

# 只标记已取得有效验证依据的任务
rondo change update-progress --openspec-root "<root>" --change-ref <change_ref> --check <verified_task_ids>
```

`analysis read` 读取批准版本，不等于最新执行进度；`change update-progress` 只更新本地 `tasks.md`。继续执行前核对当前已发布的工件，交付前完成受控发布与回读。

通过 Rondo 核对批准来源与授权。只读工件和派发消息时不操作 Git。进入研发、需要常驻根仓时，通过 Rondo 准备根仓和业务工作区。研发完成后发布当前 Change 的进度与 Evidence，通过 Completion Check 才调用 `rondo pr materialize`。按当前可用的 Change 级 CLI 入口执行，不自行拼装不受支持的参数。

所需入口不存在、参数无法确认或 Gate 为 FAIL / UNKNOWN 时停止；外部操作结果未知时先回读，不盲目重试或覆盖成果。

# Validation

- 实现符合已批准的工程要求。
- 必要的开发侧验证与 Code Review 已完成，结果真实且对应当前 Candidate。
- 已完成任务、代码提交和工程证据一致。
- 必需的交付检查通过，相关结果可读取和复核。

# Output

- 已实现并验证的代码变更。
- 实际完成的工程任务进度和 Development Evidence。
- 必要的 Commit、PR 及其引用。
- 尚未解决的问题、验证限制与风险。

# Stop Conditions

- 工程契约或修改授权无法确认。
- 实现需要实质改变已批准的行为、范围或验收要求。
- 必要验证失败且无法解决。
- 关键工具操作失败或结果不确定，无法安全继续。

遇到上述情况时，保留已确认的成果，说明阻断原因；对不确定的外部操作先核实实际结果，不盲目重试或覆盖已有工作。
~~~

Workspace 路径、分支准备与根仓 Git 发布以 08-B 的运行契约为准。09 维护 Engineer 的研发交付职责与外部状态转换。Skill 仅给出所需的命令入口和最小调用约束，不依赖旧领域 Skill 或固定技术栈。

### 3.4 CLI 实现边界（设计文档，不写入 Skill）

下表区分 PR #128 提供的入口与本次修复后的目标行为。真实环境授权和读写仍须上线前核对。

| 能力 / 入口 | 当前情况 | 新路线所需结果 |
| --- | --- | --- |
| `runtime prepare-root` | 已有受控 TFS Git Fetch 入口，项目分支准备逻辑待修复 | Analysis / Development 共用常驻根仓准备。按项目配置的分支准备并 Fetch，安全时快进。历史分叉时保留本地提交和工作区，Engineer 仍按获批 SHA 读取。 |
| `analysis read` | 已支持 | 按获批 `analysis.source` 读取固定版本 Change 工件 |
| `dev contract-hash`、`change update-progress` | 已支持本地操作 | 获取契约摘要、受控更新已验证的原生 checkbox；进度仍需远端发布 |
| `requirement-guard` | 已实现独立新路径，不复用旧 `dev.dispatch` | 新 Change 级模式仅只读核对当前 Multica Actor / Run、Human Approval、Change、Repository Scope；不物化新 `dev.dispatch` |
| `dev prepare --mode requirement` | 已实现 Requirement Worktree，旧 Bug 模式保持 | 为 Requirement 准备或复用授权工作区，保留 Bug 原行为 |
| `dev publish` | 已有受控 Git 发布与远端回读入口，单需求差异发布待修复 | 发布已验证的 `tasks.md`、Evidence 与 PR 描述，回读并记录本次远端发布 SHA，保留获批分析 SHA。 |
| `dev pr-prepare --mode requirement`、`dev check-change` | 已实现独立 Change 级核验 | Change 级检查真实 Candidate、Evidence、原生 Tasks 全量进度与 PR Preparation，不使用派发 Task 编号集合 |
| `pr materialize --mode requirement` | 已实现新模式且旧路径独立 | 新模式在创建任何 PR 前整体校验 Completion、批准和实际有代码变更仓库的 Candidate / `pr_prep` 对账；支持远端 PR 描述，逐仓幂等恢复 |

可复用现有确定性实现，但新旧执行路径必须显式区分，不能靠缺失 `task_refs` 自动推断新模式。此表用于实施对齐，不作为 `SKILL.md` 的历史说明或额外执行流程。

## 4. 以 Change 为工作单元的执行契约

### 4.1 Multica 原生派发与授权

- 正常启动只使用当前 Issue 上的 `@Engineer(change_ref)`；Issue、Actor、Run 由 Multica 提供，不在消息中附加 Task 编号或仓库清单。
- **新路线不创建额外 `dev.dispatch`**，也不要求 Lead 先执行 Rondo Materialize；Lead 确认已获 Human Approval 后直接通过原生 `@mention` 派发。
- Rondo 仅在准备工作区、发布成果、Completion 与 PR 等关键操作前，校验当前 Multica Run / Engineer、`analysis.change_ref`、Approval 来源及获批 `.openspec.yaml` 的 `x-repositories`。无法确认时停止。
- 同一项目向所有 Agent 下发相同的 `RONDO_WORKSPACE_BRANCH`。Lead 派发和只读 Issue 均不操作 Git。Engineer 需要准备常驻根仓时才执行 08-B 的保存、切换与同步规则。显式 `--root-repo` 优先于 `RONDO_WORKSPACE_PATH`，项目分支配置优先于旧 `--branch`。业务仓复用基础仓及 `feature/<TFS ID>` Worktree，PR 目标仍由子仓配置决定，默认 `dev`。
- `tasks.md` 负责定义全部工程任务与当前 checkbox。Repository Scope 是授权上限；Engineer 判断实际需要修改的仓库，Rondo 校验候选与 PR 事实，不做业务语义推断。

### 4.2 实施与开发侧验证

Engineer 对获批 `tasks.md` 的全部 Implementation Tasks 和 PR 前必要的开发侧 Change-level Verification Tasks 负责。无需将每个 Task 单独派发；内部自主选择技术依赖和实现顺序。

**新路线的 `tasks.md` checkbox 只包含 PR 创建前应完成的研发和开发侧验证任务。** Analysis 应在任务编写时明确这条边界：能够在单 Task 内验证的行为直接写入该 Task，仅组合后的行为确有必要时另列 Change-level Verification Task。

**本期只实施 PR 前研发验证**：Engineer 完成开发侧必要验证；PR 后 Independent Verify 属于后续独立交付能力，本期不实现新的 Verify / Merge Gate 自动闭环。不得把 PR 后才可能完成的独立验收或 CI 强制写成 PR 前 checkbox；`verify_agent.required=true` 保留既有安全阻断，不视为已可自动完成。

技术栈由业务仓真实文件决定：

- Java / Spring / Gradle / Maven：核对实际 `pom.xml`、wrapper、build 配置、已有测试与 CI，不默认通用命令必定适用。
- Vue / JavaScript / TypeScript：核对 `package.json`、lockfile、现有 scripts、页面交互与可用测试。
- Flink、SQL、数据库迁移和跨仓接口：选择对真实改变有意义的兼容性、运行或集成反馈。
- 没有现成单测或运行环境时记录可核查的替代反馈；无法证明必需行为时停止，不能把 Build / Lint / OpenSpec Schema PASS 作为功能验收。

### 4.3 Completion、进度和 Evidence

- Completion 是 **Change 范围的 PR 前研发结果**，不是一个局部 Task Set 的 READY。Rondo 从当前 `tasks.md` 和真实 Evidence 核验全部 Implementation / PR 前必要开发侧 Verification Tasks、代码候选、Code Review、PR Preparation 以及 blockers；不将 PR 后 Independent Verify PASS 提前作为创建 PR 的前置。
- 原生 `tasks.md` 编号只用于定位并受控更新 checkbox；可以保留 Rondo 对原生编号的底层定位功能，但不把编号包装成额外的派发身份或必填 Runtime 字段。
- Evidence 继续保存在 Change 顶层 `evidence*.json`。每个发生代码变更的 Repository 具有当前 Candidate、验证和 Review 依据。文件只保存该仓真实相关的证据和 Commit，避免在多仓场景将不相关 Commit 强行关联到 TFS 子任务。
- **Evidence 主身份是 `change_ref` + Repository / Candidate**，不要求逐份 Evidence 承载派发任务编号数组；在需要定位具体验证覆盖时引用 OpenSpec 原生任务位置或 Requirement / Scenario 即可，不建立新 Schema。
- 只有完成开发侧验证的任务才能受控勾选。Proposal / Specs / Tasks 正文及 Repository Scope 发生实质变化须回到 Human Review；Engineer 可在批准边界内细化 `design.md` 的非实质性技术实现细节，不改变行为、接口契约或验收要求。
- 当前 08-B 的跨 Runtime 发布和回读仍是 PR / Finalize 可靠消费的前置条件；新 Skill 使用由 Rondo 提供的 Change 级受控发布入口，不依赖 Engineer 上一次运行目录的 `file:<绝对路径>`。
- Engineer 在常驻根仓保存改动，Rondo 以远端同名分支最新提交为基线，只应用 `openspec/changes/<change_ref>/` 内已提交的新增、修改和删除。其他需求的提交留在本地，即便两者来自同一笔本地提交，也只取当前目录的差异。研发交付记录使用本次实际远端发布 SHA，可与本地保存 SHA 不同。`analysis.source.commit` 保留原批准 SHA，仅规格发生实质变化时重新走分析发布与审批。[08-B §3.1 发布规则](08b-requirement-remote-git-delivery.md#31-根仓按路径提交与-push-竞争恢复)
- 远端前进后，能无损应用差异就自动继续。当前 Change 的内容冲突只暂停该次发布，保留双方改动并报告具体差异。重试先回读远端历史，已发布则复用该次远端 SHA，确认尚未发布才基于最新远端提交重试。恢复后在原 Run 继续 Completion / PR。

### 4.4 PR 创建与本期交付边界

- Engineer 对**实际有代码变更**的授权业务仓分别准备 Branch、Candidate Commit、`pr_prep` 和技术描述；Repository Scope 内未修改的仓库不要求空 Commit 或空 PR。
- Rondo 创建任何 PR 前，先核对当前 Run / Approval、Change 级完成结果，并确认 Evidence 声明的所有实际代码变更仓库都有对应 Candidate / PR Preparation，且均在批准 Scope 内；不从自然语言推断必须修改的仓库。
- Engineer 在原 Run 调用 `rondo pr materialize` 创建或复用所需 PR，登记 `current_pr` 并流转 `in_review`，不需要第二次 Lead 派发。
- 本期自动闭环仅覆盖 `verify_agent.required=false` 的正常 PR Review / Merge；`required=true` 不实施新的 Verify 或合并阻断能力，沿用已有禁止无 PASS 自动 Finalize 的安全规则，后续单独处理。
- 无代码变更的合法 Change 不创建空 PR：Engineer 说明结果，交 Lead / Human 决定后续处理；本期不新增自动无 PR Finalize。
- 多仓 PR 部分成功或 API 回执不明时先回读 TFS PR 与 `current_pr`，只补未完成项，不重复创建。

## 5. 新 Rondo 契约与旧路径隔离

**新 Change 级执行路径不以修改旧 Agent / Skill 为代价。** 现有 Rondo 的 `--task-refs`、`dev.dispatch.task_refs` 等契约仍服务原 Backend / Frontend Engineer 路线。新 `Engineer` 采用显式可区分的 Change 级入口或模式，不以“缺少 `task_refs`”隐式推断新路线；共享 Git、TFS、PR 客户端与幂等能力可以复用，旧入口及 Bug Fix 路线必须保持可用。

| 位置 | 新路线的最小要求 |
| --- | --- |
| Engineer / Workspace Provisioning | 在 01 Canonical Name 中增补新 `Engineer` 正式 Agent，独立注册并绑定 `change-development`。项目分支配置下发给每个 Agent，按 §4.1 的任务范围生效。 |
| Change 级 Guard（不新增 Dispatch） | Lead 原生 `@Engineer(change_ref)`；Rondo 只读核对当前 Actor / Run、Approval、Change 和 Scope，不创建新 `dev.dispatch`；旧 Dispatch Contract 保持有效 |
| Analysis Workspace / 规范基线 | Analyst 与 Engineer 复用 `runtime prepare-root`。项目级 Schema / Specs 基线按 08-B 核对，根仓不按 Issue 建 Worktree。 |
| Analysis / Change Git 发布 | Requirement 分析通过 `analysis complete --mode requirement` 发布当前 Change 差异。分析来源记录实际远端分支及该次发布 SHA，获批后供 Engineer 跨 Runtime 读取。 |
| Analysis 专业执行资产 | 保留 Workitem Analyst，聚焦需求分析与可实施的 OpenSpec；定向优化 `requirement-analysis`、`spec-preparation` 和 `analysis-completion`，不参与 TFS 子任务拆分与数量控制 |
| Requirement `dev prepare` / `dev pr-prepare` | 按 08-B 使用 `feature/<tfs.id>` Worktree 及授权 Repository；旧 Bug Clone / 分支与原有 `feat/` 路线不变 |
| Change 级 Completion / Progress / Evidence | 从当前获批 `tasks.md` 核验应由研发完成的任务、Candidate 和 Evidence；原生编号仅定位 checkbox，不要求新 Evidence 携带派发任务数组；发布后可跨 Runtime 回读 |
| `rondo pr materialize` 的新入口 | 创建任何 PR 前校验 Change 级完成、Human Approval、当前 Engineer Run 与实际修改仓库的完整 Candidate / PR Preparation；保留幂等恢复及旧入口行为 |
| PR 描述与跨 Runtime | 从已 Push 的 Change 读取 PR 描述，不能仅依赖上一个 Runtime 的本机 `file:` 路径；保持已有远端 Finalize 机制 |
| 定向返工与 TFS Writeback | 返工按 Change / 实际 Repository / Candidate 定位；TFS 子任务由 PR Status Sync Agent 在收口阶段规划 1–5 个，Rondo 强制独占与回读；不按 OpenSpec Task 一对一生成、不由 Rondo 做语义拆分；旧返工与 Writeback 入口保持可用 |

**实施边界**：

- 只为新 `Engineer` 增加必要执行资产；不新建 Dispatch Materialize、第二套 Task、Change Status、Skill Registry、Workspace Manager 或 Delivery Runtime。
- 新旧 CLI 共享的能力允许内部提取公共函数，但必须保持旧命令参数、返回和行为契约；不得直接删除旧 `task_refs` 字段或改写原有 Skill 以迁就新设计。
- 新 Change 级入口已在 PR #128 实现，正常运行必须使用显式 `--mode requirement` 及已注册 Skill；尚须真实 Multica/TFS E2E 才可切换生产。
- 本修复的配置覆盖同一项目的所有 Agent，实际执行根仓准备与单需求发布的是 08-B Requirement 路线。Bug 与归档沿用各自 checkout 流程。正式切换前应明确新路线的权威定义并避免两种派发同时作用于同一 Issue。

## 6. 验收与切换

历史 Desktop 实验验证了 Agent `custom_env` 可达、持久目录及 Git 操作、跨 Run / 同机跨 Provider 恢复、不同业务 Worktree 并发，以及常驻根仓按路径提交时的 Index 竞争和 Push 携带历史的行为。其适用范围见 [08-B §7.1 历史验证](08b-requirement-remote-git-delivery.md#71-已完成的机制验证与本期边界)。本次修复另用新的测试 Issue 和测试仓验收，保留 LEI-35 现场。下表列出交付验收目标。

| 用例 | 必须满足 |
| --- | --- |
| 常驻根仓准备 | Analyst 和 Engineer 需要准备根仓时，在配置目录切换到项目分支，根仓不新增 Issue Worktree。分支被其他 Worktree 占用时，在暂存前报告分支与目录。检查切换前的保存提交留在原分支且未 Push。 |
| 唯一正常派发 | Lead 在 Issue 仅发送 `@Engineer(change_ref)`；Engineer 无需外部任务或仓库参数即可从当前已批准 Change 执行 |
| 单仓后端 / 前端 | 新 Engineer 只加载 `change-development`，从真实仓库获得验证方式；全部应由研发完成的任务闭合后同 Run 创建 PR |
| 双仓需求 | 一个 Change、一个 Engineer、一次正常 Run；实际修改的各仓独立 Candidate、验证、Review 和所需 PR；批准 Scope 的未修改仓不强制交付 |
| Repository Scope | 获批 `.openspec.yaml` 的 `x-repositories` 列表是唯一授权上限；Rondo 校验所有实际变更仓库均在范围内，不额外持久化仓库授权清单 |
| 开发侧完成检查 | 根据 `tasks.md` 全部 PR 前研发和开发侧必要验证任务及证据核验，不存在未分派任务遗漏；不得等待 PR 后 Independent Verify 才能创建 PR；原生 checkbox 只更新真实完成项 |
| TFS Writeback | PR Status Sync Agent 规划 1–5 个 TFS 子任务，Rondo 负责创建/复用、估时与 Commit 独占关联核验；与 `tasks.md` 数量无一对一关系，不要求 Analyst / Engineer 为此调整 Task |
| Independent Verify（本期范围外） | `required=true` 保留已有自动 Finalize 阻断；本期不实现新的 Verify 或 Merge Gate，不将其列为新路线自动闭环验收 |
| 失败恢复 | 已发布 PR / Git / Evidence 先回读对账；异常才启动新 Run，不制造重复 PR / Task / Issue |
| 根仓单需求发布 | 本地交错保存 A、B 后，单独发布 A 只带 A 的已提交差异，B 保留在本地。回读实际发布 SHA 后进入 Completion / PR。覆盖远端前进后无损应用、当前 Change 内容冲突和回执丢失后的重试。 |
| 跨 Runtime | Engineer 按 `analysis.source.commit` 读取获批 Change，后续消费方按研发交付记录读取进度、Evidence 和 PR 描述。验收分别核对两个远端 SHA。 |
| 新旧并存 | 旧 Backend / Frontend Agent、Skill 及原 Rondo `task_refs` 入口保持可用；新 Engineer 不加载旧 Skill，二者不对同一 Issue 重复派发 |
| 回归 | Bug Fix 路线、OpenSpec Native Validation / Archive、TFS PR 与 Writeback 不退化 |

PR #128 已提供 08-B 与 09 的初版程序及 Agent / Skill 配置。本次修复的实施顺序为项目分支下发和常驻根仓准备、Analysis 与 Development 的单需求发布和 SHA 回读、在新测试 Issue 和测试仓完成验收，最后按已有流程切换。Independent Verify 新闭环和无 PR 自动收口均保留原有边界。
