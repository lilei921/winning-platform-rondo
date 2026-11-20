# Multica Workspace Skill 源文件

本目录维护 Multica Workspace 使用的 Skill 方法、支持文件与共享配置。角色配置见 [Agent 索引](../agents/README.md)，协作指令见 [Squad 索引](../squads/README.md)。

受管 Skill 以 [provisioning.json](#配置与绑定来源) 的 `managed_skills` 为准（tfs-writeback 暂作仓内方法资产，由 issue-closeout 的独立 Writeback 步骤调用，未单独纳入 managed_skills）。旧研发与 Lead 方法已移出受管清单，详见下方保留清单；源文件保留待整理。配置清理不表示已删除远端 Skill 对象。

## 当前路线使用的 Skill

| Skill | 用途 |
| --- | --- |
| [codebase-explorer](codebase-explorer/SKILL.md) | 按问题选择只读调查方法，核实功能、调用关系、实际版本与变更影响。 |
| [bug-analysis](bug-analysis/SKILL.md) | Corrective 故障的证据驱动根因诊断与回归建议；已列入 Analyst 仓内绑定，真实 Workspace 仍须回读确认。 |
| [change-handoff](change-handoff/SKILL.md) | 已获批 Change 的版本核对、批准记录与研发交接。 |
| [change-development](change-development/SKILL.md) | 单一 Engineer 的 Change 级研发方法，覆盖授权仓库中的实现、验证及 PR 技术交付。 |
| [workspace-preparation](workspace-preparation/SKILL.md) | 按需准备或复用 Bug Fix Native Checkout / 业务仓及 Requirement 持久根仓 / 业务 Worktree；供 Bug Fix Agent、Workitem Analyst 和 Engineer 使用。 |
| [diagnosing-bugs](diagnosing-bugs/SKILL.md) | 根据证据诊断 Bug，形成可验证的修复。 |
| [bug-delivery](bug-delivery/SKILL.md) | Bug 的受控 Git Fetch/Push、Candidate 核对和 PR Preparation。 |
| [workitem-triage](workitem-triage/SKILL.md) | 对 Issue 进行准入评估并通过 `/note` 记录 Decision；当前 Multica 交接操作按需遵循独立引用契约。 |
| [analysis-completion](analysis-completion/SKILL.md) | Analysis Gate 通过后发布分析交接事实，提交并回读 `analysis_review`。 |
| [pr-status-sync](pr-status-sync/SKILL.md) | 核实已登记 PR 的外部状态，同步可信终态事实并返回处理结果。 |
| [requirement-analysis](requirement-analysis/SKILL.md) | Intentional 需求探索、方案比较和关键决策澄清；已列入 Analyst 仓内绑定，真实 Workspace 仍须回读确认。 |
| [spec-preparation](spec-preparation/SKILL.md) | CLI-only 的 OpenSpec Change New / Prepare / Revise 与工件状态核对；已列入 Analyst 仓内绑定，真实 Workspace 仍须回读确认。 |
| [issue-closeout](issue-closeout/SKILL.md) | 对满足条件的 Issue 顺序调用 Rondo Prepare、TFS Writeback、Complete 完成最终收口。 |
| [tfs-sync](tfs-sync/SKILL.md) | 同步符合条件的 TFS Work Item 并初始化 Delivery Issue。 |

以下 Skill 由其他 Skill 内部调用，未单独纳入 `managed_skills`：

| Skill | 用途 |
| --- | --- |
| [tfs-writeback](tfs-writeback/SKILL.md) | 独立 TFS Writeback 的方法资产；由 issue-closeout 的 Writeback 步骤调用 CLI，不单独受管。 |

## 旧研发资产：保留待整理

Requirement 研发已收敛为 `Engineer` + `change-development`，Lead 按职责协调成员，使用 `change-handoff` 完成已获批 Change 的研发交接。下列 Skills 均已移出 `managed_skills` 和当前 Agent 绑定，正文与支持文件保留待整理。

| Skill | 保留范围 |
| --- | --- |
| [development-execution](development-execution/SKILL.md) | 已移出 `managed_skills`；原 Backend / Frontend Task Set 研发入口。 |
| [backend-engineering](backend-engineering/SKILL.md) | 已移出 `managed_skills`；保留后端领域方法与验证资料。 |
| [frontend-engineering](frontend-engineering/SKILL.md) | 已移出 `managed_skills`；保留前端领域方法与验证资料。 |
| [delivery-flow](delivery-flow/SKILL.md) | 旧 Task Set 派发和人工决定路由；正文及参考文件保持原样。 |
| [delivery-gate](delivery-gate/SKILL.md) | 旧 Lead 门禁方法；保留正文及参考文件。 |
| [pull-request](pull-request/SKILL.md) | 旧研发配套 PR 方法；保留正文及参考文件。 |

`repo-write-isolation-contract.md` 的维护源及其余镜像随这些旧资产暂保留，仅属于旧执行路径，不作为当前路线的公共约束。`codebase-explorer` 已不引用该文件，移除其包内副本；`change-development` 继续独立提供当前研发方法和必要 CLI 入口。

## 已退役但保留源文件

| Skill | 状态与用途 |
| --- | --- |
| [workitem-analysis](workitem-analysis/SKILL.md) | **Retired（D2 目标态）**：不再是 `managed_skills` 成员或任何 Agent 的新执行入口；保留历史 `SKILL.md`、`references/` 用于审计、在途 Run 追溯及授权回退。后续可维护历史档案，但不得作为现行规则 Owner；**本次不删除**。远端平台可能仍保留未受管 Skill 对象，不能把取消绑定等同删除对象。 |

## 配置与绑定来源

| 文件 / 目录 | 职责 |
| --- | --- |
| [workspace-config/provisioning.json](../workspace-config/provisioning.json) | 受管理 Skill、Agent 属性及绑定、Squad 成员、Project 与 Autopilot 定义的来源。 |
| [workspace-config/repo-registry.base.json](../workspace-config/repo-registry.base.json) | 仓库交付配置的渲染底稿。仓库元数据仍来自根仓 [repo-context.yaml](../../../docs/config/repo-context.yaml)。 |
| [workspace-config/sync-config.base.json](../workspace-config/sync-config.base.json) | TFS 同步配置的渲染底稿。 |
| [workspace-config/workspaces/](../workspace-config/workspaces/) | Workspace overlay，保存工作区及平台对象 ID 映射，由 provision 生成维护。 |

Agent ↔ Skill 绑定以 manifest 的 `agents[].skills` 为准，不在 README 中重复定义。渲染后的运行配置由 `rondo workspace sync` 按目标 Workspace 生成。

**仓内配置变更的发布边界：** `managed_skills` 决定 Workspace Provision 受管对象；取消 `workitem-analysis` 受管及 Agent 绑定是**退役而非删除**，平台现有 Skill 对象可能继续留存，但应不再出现在任何新运行的有效绑定中。变更先在隔离测试 Workspace 执行 `provision --dry-run`，再分步 Provision / Sync、回读新 Skill 文件、`runtime.workspace_id` 和 Analyst 绑定并验证 E2E；**不要在生产 Workspace 自动全量 Provision 或未经验证切换**。失败时恢复原 manifest / Agent Instructions 和有效 Skill 绑定，源文件始终保留。

## Skill 目录约定

- `SKILL.md`：能力说明、适用条件、输入、调用方法、验证、输出及失败处理。
- `references/`：按场景读取的方法、示例、事实字段与领域资料；资料中的适用条件不扩展为其他路线的约束。
- `methods/`：Skill 内部复用的工程方法；旧 `development-execution` 的方法文件随该 Skill 暂保留。
- `scripts/`：随 Skill 提供的脚本；已收编的确定性工具以 `rondo` 命令为入口。仓库准备方法由 [workspace-preparation](workspace-preparation/SKILL.md) 提供。
- `config/`：运行配置，按渲染与同步机制生成；不因源目录中没有生成文件而另建一份配置。

执行时按当前路线使用对应 Skill 和 `rondo` 调用契约；旧资产中的冻结说明不替代当前路线定义。`spec-preparation/references/tasks-md-authoring-contract.md` 是任务写法的**唯一有效维护源**；旧 `workitem-analysis/references/` 同名文件作为 Retired 历史兼容快照永久留在本次修改范围之外，不参与新 Skill 发布，不作为第二份规则 Owner。当前 Requirement 路线见 [09 统一 Engineer](../09-unified-engineer-development-design.md)；历史资料不作为新路线的执行依赖。

## 维护与同步入口

| 变更 / 目的 | 操作入口 |
| --- | --- |
| 新增受管理 Skill 或调整 Agent 绑定 | 更新 manifest，执行 `rondo workspace provision --workspace <name>`，再同步 Skill 内容。 |
| 发布 Skill 内容与支持文件 | `rondo workspace sync --workspace <name> [--skill <skill-name>]` |
| 只渲染本地配置 | `rondo workspace sync --workspace <name> --local-only` |
| 检查 Skill 内容漂移 | `rondo workspace sync --workspace <name> --check` |

操作说明见 [Workspace 同步操作手册](../archive/docs-2026-11-18/workspace-sync-operations-guide.md)，命令行为以 `rondo` 实现为准。新增或修改资产时，按 [编写规范](../../../docs/conventions/agent-authoring.md) 与 [评审清单](../agents/_shared/review-checklist.md) 核对职责、引用和跨资产一致性。
