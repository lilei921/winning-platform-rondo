# Multica Workspace Skill 源文件

本目录维护 Multica Workspace 使用的 Skill 方法、支持文件与共享配置。角色配置见 [Agent 索引](../agents/README.md)，协作指令见 [Squad 索引](../squads/README.md)。

受管 Skill 以 [provisioning.json](#配置与绑定来源) 的 `managed_skills` 为准（tfs-writeback 暂作仓内方法资产，由 finalize-delivery 内部调用，未单独纳入 managed_skills）。以下清单描述仓内配置，不代表远端发布或验收状态。

## 纳入管理清单的 Skill

| Skill | 用途 |
| --- | --- |
| [codebase-explorer](codebase-explorer/SKILL.md) | 按权威 Repository Mapping 与 CodeGraph 等工程方法定位功能、跨仓依赖及可追溯 Evidence。 |
| [bug-analysis](bug-analysis/SKILL.md) | Corrective 故障的证据驱动根因诊断与回归建议；已列入 Analyst 仓内绑定，真实 Workspace 仍须回读确认。 |
| [workitem-triage](workitem-triage/SKILL.md) | 对 Issue 进行准入评估并通过 `/note` 记录 Decision；当前 Multica 交接操作按需遵循独立引用契约。 |
| [analysis-completion](analysis-completion/SKILL.md) | Analysis Gate 通过后发布分析交接事实，提交并回读 `analysis_review`。 |
| [delivery-gate](delivery-gate/SKILL.md) | 确定性门禁入口；各门禁的实现状态与调用契约见 Skill 正文。 |
| [delivery-flow](delivery-flow/SKILL.md) | 研发派发与 PR abandoned 后的人工决定路由。 |
| [development-execution](development-execution/SKILL.md) | Engineer 共用的研发方法，覆盖实现、验证、审查、证据、完成检查及任务进度更新。 |
| [backend-engineering](backend-engineering/SKILL.md) | 后端反馈信号、本地验证与工程审查标准，与 `development-execution` 配套。 |
| [frontend-engineering](frontend-engineering/SKILL.md) | 前端反馈信号、本地及浏览器验证与工程审查标准，与 `development-execution` 配套。 |
| [pull-request](pull-request/SKILL.md) | 将 PR Preparation Facts 物化为 PR。 |
| [pr-status-sync](pr-status-sync/SKILL.md) | 核实已登记 PR 的外部状态，同步可信终态事实并返回处理结果。 |
| [requirement-analysis](requirement-analysis/SKILL.md) | Intentional 需求探索、方案比较和关键决策澄清；已列入 Analyst 仓内绑定，真实 Workspace 仍须回读确认。 |
| [spec-preparation](spec-preparation/SKILL.md) | CLI-only 的 OpenSpec Change New / Prepare / Revise 与工件状态核对；已列入 Analyst 仓内绑定，真实 Workspace 仍须回读确认。 |
| [finalize-delivery](finalize-delivery/SKILL.md) | required PR 完成后的工作区对账、OpenSpec 归档、根仓提交、TFS 统一回写及 Issue 关闭。 |
| [tfs-sync](tfs-sync/SKILL.md) | 同步符合条件的 TFS Work Item 并初始化 Delivery Issue。 |

以下 Skill 由其他 Skill 内部调用，未单独纳入 `managed_skills`：

| Skill | 用途 |
| --- | --- |
| [tfs-writeback](tfs-writeback/SKILL.md) | TFS 收口统一回写（2026-10-30 TFS 剥离）：PR 全部 completed 后由 finalize-delivery 调用，一次收齐子任务创建、commit 关联、工时与父项状态链；也可 standalone 作恢复入口。 |

## 已退役但保留源文件

| Skill | 状态与用途 |
| --- | --- |
| [workitem-analysis](workitem-analysis/SKILL.md) | **Retired（D2 目标态）**：不再是 `managed_skills` 成员或任何 Agent 的新执行入口；保留历史 `SKILL.md`、`references/` 用于审计、在途 Run 追溯及授权回退。后续可维护历史档案，但不得作为现行规则 Owner；**本次不删除**。远端平台可能仍保留未受管 Skill 对象，不能把取消绑定等同删除对象。 |

## 配置与绑定来源

| 文件 / 目录 | 职责 |
| --- | --- |
| [_shared/provisioning.json](_shared/provisioning.json) | 受管理 Skill、Agent 属性及绑定、Squad 成员、Project 与 Autopilot 定义的来源。 |
| [_shared/repo-registry.base.json](_shared/repo-registry.base.json) | 仓库交付配置的渲染底稿。仓库元数据仍来自根仓 [repo-context.yaml](../../../docs/config/repo-context.yaml)。 |
| [_shared/sync-config.base.json](_shared/sync-config.base.json) | TFS 同步配置的渲染底稿。 |
| [_shared/workspaces/](_shared/workspaces/) | Workspace overlay，保存工作区及平台对象 ID 映射，由 provision 生成维护。 |

Agent ↔ Skill 绑定以 manifest 的 `agents[].skills` 为准，不在 README 中重复定义。渲染后的运行配置由 `rondo workspace sync` 按目标 Workspace 生成。

**仓内配置变更的发布边界：** `managed_skills` 决定 Workspace Provision 受管对象；取消 `workitem-analysis` 受管及 Agent 绑定是**退役而非删除**，平台现有 Skill 对象可能继续留存，但应不再出现在任何新运行的有效绑定中。变更先在隔离测试 Workspace 执行 `provision --dry-run`，再分步 Provision / Sync、回读新 Skill 文件、`runtime.workspace_id` 和 Analyst 绑定并验证 E2E；**不要在生产 Workspace 自动全量 Provision 或未经验证切换**。失败时恢复原 manifest / Agent Instructions 和有效 Skill 绑定，源文件始终保留。

## Skill 目录约定

- `SKILL.md`：能力说明、适用条件、输入、调用方法、验证、输出及失败处理。
- `references/`：按需读取的事实字段、冻结契约与领域标准。
- `methods/`：Skill 内部复用的工程方法；当前由 `development-execution` 提供。
- `scripts/`：随 Skill 提供的脚本；已收编的确定性工具以 `rondo` 命令为入口。根仓准备遵循 [08 共享基础](../08a-remote-analysis-bug-fix-foundation.md)。
- `config/`：运行配置，按渲染与同步机制生成；不因源目录中没有生成文件而另建一份配置。

规范性内容以对应 Skill 的 `references/` 冻结契约或 `rondo` 实现为权威。`spec-preparation/references/tasks-md-authoring-contract.md` 是任务写法的**唯一有效维护源**；旧 `workitem-analysis/references/` 同名文件作为 Retired 历史兼容快照永久留在本次修改范围之外，不参与新 Skill 发布，不作为第二份规则 Owner。根级编号设计文档仅作语义背景；历史资料不作为执行依赖。

## 维护与同步入口

| 变更 / 目的 | 操作入口 |
| --- | --- |
| 新增受管理 Skill 或调整 Agent 绑定 | 更新 manifest，执行 `rondo workspace provision --workspace <name>`，再同步 Skill 内容。 |
| 发布 Skill 内容与支持文件 | `rondo workspace sync --workspace <name> [--skill <skill-name>]` |
| 只渲染本地配置 | `rondo workspace sync --workspace <name> --local-only` |
| 检查 Skill 内容漂移 | `rondo workspace sync --workspace <name> --check` |

操作说明见 [Workspace 同步操作手册](../workspace-sync-operations-guide.md)，命令行为以 `rondo` 实现为准。新增或修改资产时，按 [编写规范](../../../docs/conventions/agent-authoring.md) 与 [评审清单](../agents/_shared/review-checklist.md) 核对职责、引用和跨资产一致性。
