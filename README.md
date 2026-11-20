# Multica + OpenSpec 研发协作资料

本目录集中维护 Multica + OpenSpec 的设计方案、配置文本、工具与验证资料。本页只提供阅读导航和目录维护规则；技术设计、实现契约及待决项由对应专题文档维护。

索引核对日期：2026-11-19。以下“最新”指本目录内的最新设计版本，不表示方案已实现、配置已发布或 Workspace 已完成同步。

## 定位与阅读顺序

Multica 组织交付运行与角色协作，OpenSpec 承载工程契约与工件。组合架构与规则归属由 [统一设计规范](01-multica-openspec-design-guideline.md#document-ownership) 维护。

首次阅读建议按 **01 统一规范 → 02 研发闭环 → 03 Analysis → 04 Development** 的顺序；实施 Schema 与模板时阅读 **05**，实施工程方法模块时阅读 **06**。

进入实施阶段前，先核对[执行前工程准备](#执行前工程准备)，再以 **[07 实施推进路线](07-multica-openspec-implementation-roadmap.md)** 作为 Backlog、并行工作线与里程碑入口；工程准备未就绪时，不进入研发任务派发。

**文档边界**：01–06 维护架构、阶段与工程实施契约；07 只维护实施顺序、优先级、验收里程碑、风险与阶段性进展，不替代上游设计，也不作为运行结果的独立事实源。实际验证结论以 `validation/` 中的执行证据为准。

## 执行前工程准备

**范围与状态**：待实施。先覆盖 `dataintegration-web` 与 `frame`。根仓脚本负责准备与预检编排；子仓维护工具版本、依赖配置及构建、测试命令。

**执行时机**：首次接入或环境基线变化时执行完整准备；每单派发前执行轻量预检，仅补齐缺失或变化项。

| 要做的事情 | 完成条件 |
| --- | --- |
| 检查运行权限与 Git 认证 | Delivery Lead、Engineer、PR Status Sync Agent 在各自实际运行环境中能访问所需仓库、写入工作目录并读取远端；不能以维护终端的检查结果替代。 |
| 固定前端工程基线 | 固定 Node、包管理器、依赖源和锁文件；私包及下载地址可用；业务仓枢纽克隆冻结安装不改变锁文件，组件测试、Lint 和构建通过。 |
| 固定 Java 工程基线 | 固定 JDK、Maven 和测试 profile；目标 JUnit/TestNG 测试实际执行，报告互不覆盖，JaCoCo 数据有效；测试失败必须返回失败。 |
| 预热并复用依赖缓存 | 提前下载前端依赖及 Maven 依赖、插件；各业务仓枢纽克隆独立维护 `node_modules`、`target` 和测试输出，不在每个 Run 重复全量安装。 |
| 保存可复用的验证证据 | 记录源码内容、依赖、工具链、命令和相关配置的指纹，以及测试数量、结果和日志；输入一致时可复用成功证据，变化后重新验证。 |

**派发条件**：未就绪时停止派发并报告具体缺口。失败、零目标测试或中断不得记为通过。

## 核心设计与实施规划文档（01–09）

索引不重复维护版本号；文档版本以各专题正文声明为准，实际部署与运行基线以配置快照和验证证据为准。

| 文档 | 说明 |
| --- | --- |
| [Multica + OpenSpec 统一设计规范](01-multica-openspec-design-guideline.md) | 组合架构、公共术语、系统边界、规则归属与配置规范。 |
| [研发交付生命周期设计方案](02-multica-delivery-lifecycle-design.md) | 跨角色协作、人工审核、研发组织、验证、PR 与交付收口。 |
| [Workitem Analysis 设计方案](03-workitem-analysis-design.md) | 分析职责、专业方法、产物准备、审核提交与返工边界。 |
| [Engineer Development 设计方案](04-engineer-development-design.md) | 工程实现、验证、代码审查、证据与研发完成要求。 |
| [OpenSpec Schema 实施设计](05-openspec-schema-implementation-design.md) | Schema、工件模板、任务契约及校验与归档接口。 |
| [Method Skill Library 实施设计](06-method-skill-library-implementation-design.md) | 内部工程方法模块的组织、装配、调用与来源治理。 |
| **[Multica + OpenSpec 实施推进路线](07-multica-openspec-implementation-roadmap.md)** | **实施管理入口**：Step 01 盘点结论、OpenSpec Foundation / Multica Runtime 两条并行工作线、16 Step 实施 Backlog、集成准入、里程碑与 Pilot；不替代 01–06 的权威规则。 |
| [08 远程源码分析与 Git 工作区](08-remote-analysis-git-workspace-design.md) | 远程分析与 Git 工作区的分阶段实施。 |
| [08a 远程分析与 Bug Fix 共享基础](08a-remote-analysis-bug-fix-foundation.md) | 共享基础与 Bug Fix 交付设计。 |
| [08b Requirement 跨 Runtime 交付](08b-requirement-remote-git-delivery.md) | 需求交付的远程 Git 协作设计。 |
| [08-B 专题：常驻根仓分支与单需求发布修复方案](08b-requirement-root-branch-and-publish-plan.md) | 已确认、待实施。涵盖项目分支配置、切换前本地保存、逐需求发布、远端 SHA 回读及独立验收。 |
| [09 统一 Engineer Development 设计](09-unified-engineer-development-design.md) | 基于 OpenSpec Change 的单 Agent 研发与 PR 提交。 |
| [09-A 专题：Repository Scope 权威来源与执行期维护方式分析](09a-repository-scope-authority-analysis.md) | 核查结论，决策待定。分析 `proposal.md` `## Repository Scope` 在执行期的冻结语义、`.openspec.yaml` 承载授权范围的代价，以及 A/B/C 三条路径。 |

2026-10-11 已将 04 的同仓唯一 Engineer / 按需唯一 Sub-Issue、持久共享工作区、完成发布顺序与最终根仓提交同步到 02 的生命周期、01 的交接原则及 05 的读写接口，并修正 02 / 03 对 Conditional Design 硬依赖的旧描述。05 P0-2 已按 Native First 收口，04 §7.3 已明确由 `development-execution` 执行研发及 Native Verify 策略；06 的 Analysis Skill 层级专项仍暂缓。以上是设计文档同步，实际 Skill / Script、配置发布与运行验收仍需单独完成。

### Wayfinder Agent / Skill 源文件（已纳入 manifest，正式 Workspace 待部署验收）

入口约定：**研发测试阶段**初始化后停放 `backlog + Wayfinder Agent`，Human 手动改 `todo`；**目标态**仍由 TFS Sync 自动改 `todo`，均保留 Wayfinder 指派。阶段边界与验收以 [02 阶段约定](02-multica-delivery-lifecycle-design.md#wayfinder-entry-stages)为准。`eligible` 后按来源类型单次交接 Bug Fix Agent / Delivery Squad，并回读对应 Run；`needs_human` 停放于 `blocked`，Human 补充信息后改 `todo`、保留 Wayfinder 指派，按现行契约恢复。隔离 E2E 证据不等于正式 Workspace 部署验收。

[Wayfinder Agent](agents/wayfinder-agent/README.md) 已有 Description / Instructions，并在 manifest 绑定 [`codebase-explorer`](workspace-skills/codebase-explorer/SKILL.md) 与 [`workitem-triage`](workspace-skills/workitem-triage/SKILL.md)。二者不修改 Workitem Analyst 的 `context-analysis`；当前源码保持研发测试入口，目标自动入口须另行接入与验收。正式 Workspace 的配置发布与真实 Run 联调仍未验收，仓内实现不等于已部署。

Wayfinder 与 Bug Fix 按 [08-A 共享基础](08a-remote-analysis-bug-fix-foundation.md) 使用原生 checkout。Requirement 的 Workitem Analyst 和统一 Engineer 需要准备常驻根仓时，使用 [08-B 工作区约定](08b-requirement-remote-git-delivery.md)。只读和派发不触发 Git 准备。

## Squad / Agent / Skill 配置资产（squads/、agents/、workspace-skills/）

2026-10-26 起，Squad、Agent 与 Skill 的现行配置以这三个目录内的源文件为准（原 20–34 号配置文档已归档至 `archive/squad-agent-docs-2026-10-26/`，编号段 20–39 废止）。平台侧发布经 `rondo workspace sync` 同步，现行命令入口见 [工具说明](tools/README.md)；原操作说明已归档，见 [历史索引](archive/README.md)。

### Project（projects/）

[业务交付项目描述](projects/description.md) 保存发布到 Multica Project Description 的项目用途与目录访问边界。该文件是本地维护源，保存不代表已发布；不由上述 Agent / Skill 同步说明推定其已自动同步。

### Squad（squads/）

| 资产 | 说明 |
| --- | --- |
| [Delivery Squad](squads/delivery-squad/squad-instructions.md) | Squad Instructions（仅 Leader 接收）：成员协作关系、角色路由、协作交接与 Gate 约定。 |

### Agent（agents/）

每个 Agent 目录含 `description.md`（平台 Agent Description）、`instructions.md`（Agent Instructions 执行指令）、`README.md`（绑定 Skill 清单与维护记录）；Autopilot 驱动的 Agent 另含 `autopilot-prompt.md`。新增/修改评审规则见 [agents/_shared/review-checklist.md](agents/_shared/review-checklist.md)。

| Agent | Description 摘要 |
| --- | --- |
| [delivery-lead](agents/delivery-lead/README.md) | 研发交付阶段边界推进、跨任务协调与异常处理，确保交付流程正确闭环。 |
| [wayfinder-agent](agents/wayfinder-agent/README.md) | Squad 外的入口准入判断、工程探索与受控交接。 |
| [workitem-analyst](agents/workitem-analyst/README.md) | 需求与问题分析、技术路由判断及研发准备，产出可审核的 Analysis Package 并提交人工分析审核。 |
| [backend-engineer](agents/backend-engineer/README.md) | 后端实现成员：在已批准范围与 assigned task_refs 内完成后端实现、Local Validation、Code Review 与整改，交付 Commit/Push、PR Preparation 与 Development Evidence。 |
| [frontend-engineer](agents/frontend-engineer/README.md) | 前端实现成员：同一研发闭环，覆盖前端实现、本地与必要浏览器验证。 |
| [tfs-sync-agent](agents/tfs-sync-agent/README.md) | 定时同步 TFS Work Item 并初始化 Delivery Issue 的自动驾驶薄适配器（含 Autopilot Prompt）。 |
| [pr-status-sync-agent](agents/pr-status-sync-agent/README.md) | 核实和同步已登记 PR 状态，交付异常及待处理结果（含 Autopilot Prompt）。 |

### Skill（workspace-skills/）

Agent ↔ Skill 绑定矩阵唯一来源：[`_shared/provisioning.json`](workspace-skills/_shared/provisioning.json)；registry / sync 渲染底稿与各 Workspace 定义在 `_shared/` 下维护。各 Skill 目录含 `SKILL.md` 及按需的 `references/` / `methods/` / `config/`。

| Skill | 说明 |
| --- | --- |
| `delivery-flow` | Development 派发物化、TFS 任务物化/解决汇总、PR Abandoned 后 Human Decision 路由。 |
| `delivery-gate` | 确定性门禁集合（当前实现 Analysis Gate，其余随阶段补齐）。 |
| `pull-request` | PR 物化。 |
| `issue-closeout` | 在交付条件满足后顺序调用 Rondo Prepare、TFS Writeback、Complete 完成 Issue 收口。 |
| `workitem-analysis` | 需求与问题分析方法：路由判断、Change 身份解析与创建、Engineering Truth 沉淀、Verify 推荐。 |
| `analysis-completion` | 分析收口：Analysis Gate 先行，PASS 后发布 Facts、写入并回读 analysis_review、TFS 需求置已分析。 |
| `development-execution` | 研发统一执行骨架（Ground → Implementation → Local Validation → Code Review → Commit/Push → PR Preparation → Evidence → Completion Check → Task Progress Patch）。 |
| `backend-engineering` / `frontend-engineering` | 后端 / 前端领域方法：反馈信号选择、本地验证命令映射、工程标准审查依据；与 development-execution 配套。 |
| `tfs-sync` | 同步符合条件的 TFS Work Item 并初始化对应 Delivery Issue。 |
| `pr-status-sync` | 已登记 PR 的状态核实与终态事实同步；交付收口由独立 `issue-closeout` 能力处理。 |
| `codebase-explorer` / `workitem-triage` | Wayfinder 准入配套（已纳入仓内 manifest，平台发布与 E2E 待验证）：代码库探索、准入评估与受控交接。 |

## 工具、快照与验证资料

| 入口 | 范围 |
| --- | --- |
| [DF-7 交付流程修复实施计划](../plans/df7-delivery-remediation-plan.md) | 当前代码核实结果、修复优先级、任务依赖与验收矩阵；计划状态，不代表已经实施或部署。 |
| [DF-4 范围同步与进度回流实施计划](../plans/df4-delivery-remediation-plan.md) | 任务取消、有效派发、Completion 顺序及里程碑回流的核实结果、实施依赖和验收标准；标明与 DF-7 公共任务的契约差异。 |
| [TFS MCP 能力对比](validation/tfs-mcp-capability-comparison.md) | MCP 接口能力、版本核查与证据限制。 |
| [Step 01：资产盘点与 Runtime Spike 结果](validation/01-runtime-asset-inventory-and-spike-result-2026-10-12.md) | Multica 0.6.1 隔离 Spike R01–R05 的实测证据、正式部署缺口与后续条件；对应 07 的 Step 01。 |
| [Wayfinder WFP-8 单次 Update E2E](validation/wayfinder-needs-human-resume-single-update-e2e-2026-10-13.md) | 隔离 Workspace `needs_human → eligible → Lead` 自动指派正常分支 PASS；生产故障恢复尚待验收。 |
| [PR 关键事件验证](validation/pr/README.md) | PR 快照、候选规则检查与验证结果。 |
| [需求详情与附件获取验证](validation/workitem/README.md) | TFS 详情与附件获取验证及已知限制。 |

快照与验证资料的适用版本、采集时间和限制以各自说明为准；它们不代表当前远端状态或最新方案已经完成部署与验收。

## 历史版本与归档

2026-11-18 将顶层除 01–09 系列（含 08a、08b）与本导航页外的 22 份文档统一归档至 [本次归档索引](archive/docs-2026-11-18/README.md)。子目录中的配置、工具、模板和验证资料继续按原职责维护；归档不表示原计划已实施或通过验证。

已归档的方案和配置见 [archive/ 历史索引](archive/README.md)，仅供追溯。2026-10-10 将 Analysis v1.17 / v1.18.1、Development v1.14 / v1.15 / v1.15.1 共 5 份旧版移入归档；同日追加归档 OpenSpec Schema v1.5、Method Skill Library v1.4。顶层按系列保留当前设计版本；版本号按系列独立管理，不将其他系列的低版本号视为过期。

维护规则：

1. 新版替代旧版时，将旧版移入 `archive/`，保留版本文件名与历史正文，并更新本页和历史索引。
2. 未归档方案只能引用当前未归档版本，禁止通过链接、文件名、关联基线或章节引用依赖已归档文档。归档时必须将未归档方案的引用更新到当前版本，并核对链接文字、章节号与锚点；历史版本的文件入口统一放在归档索引中。版本记录中的历史名称与章节含义不改写为当前规则。
3. 同文件内的旧版 Prompt 单独拆出归档，当前文件仅保留最新版本。
4. 顶层文档采用“两位编号 + 连字符 + 文档名称”：01–09 为核心设计与实施规划文档（含 08a、08b 扩展设计，其中 07 是实施路线图）。原 20–39 编号段（Squad / Agent / 外部同步配置）已于 2026-10-26 废止，10 份配置文档保留编号归档至 `archive/squad-agent-docs-2026-10-26/`；Squad / Agent / Skill 现行配置以 `squads/`、`agents/`、`workspace-skills/` 目录内源文件为准，不再占用顶层编号。
5. 顶层保留 01–09 系列设计文档（含 08a、08b）与 `README.md`；其他独立文档按批次归入 `archive/` 并维护归档索引。现有子目录资产保留原名与职责，归档文档保留原文件名。
6. 本页只维护入口和职责摘要，不在当前文档索引中重复维护版本号；版本声明与技术规则在对应专题文档维护，操作步骤在对应工具或子目录说明中维护。历史归档与验证证据中的版本号保留，用于追溯实际基线。
7. 方案之间的引用和文内章节引用使用相对 Markdown 超链接；章节引用定位到目标锚点，优先复用已有锚点。连续引用须明确所属文档，章节范围可分别链接起止章节。调整章节时同步核对链接文字、章节号与锚点；历史记录和代码示例不机械改链到现行章节。

`scripts/`、`tests/` 与 `validation/` 分别承担工具、测试或证据职责，不随旧版设计文档一并归档。

验证资料记录当时的验证对象，继续指向实际验证过的历史版本；修复其路径时不改写验证基线或将历史证据视为当前方案的验收结果。
