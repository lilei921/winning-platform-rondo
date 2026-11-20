# Multica Agent 配置资产

本目录维护 Multica Agent 的角色说明、长期执行指令与 Autopilot Prompt。协作配置见 [Squad 索引](../squads/README.md)，执行方法见 [Workspace Skill 索引](../skills/README.md)。

当前 Requirement 研发统一由 `Engineer` 承担完整 Change，使用 `change-development` 完成实现、验证与 PR 交付；独立 Bug 继续由 `Bug Fix Agent` 处理。旧研发角色暂保留源文件，见下方待整理清单。

## 当前使用的 Agent

| Agent | 定位 | 配置入口 |
| --- | --- | --- |
| Delivery Lead | Delivery Squad Leader，负责交付协调、阶段边界与异常处理。 | [说明](delivery-lead/README.md) · [Description](delivery-lead/description.md) · [Instructions](delivery-lead/instructions.md) |
| Wayfinder Agent | Squad 外的 Intake Triage，探索准入证据并受控移交。 | [说明](wayfinder-agent/README.md) · [Description](wayfinder-agent/description.md) · [Instructions](wayfinder-agent/instructions.md) |
| Workitem Analyst | 分析 Requirement 的意图与工程影响，准备可审核的 OpenSpec Change。 | [说明](workitem-analyst/README.md) · [Description](workitem-analyst/description.md) · [Instructions](workitem-analyst/instructions.md) |
| Engineer | 承担已批准 Change 的完整研发、开发侧验证和 PR 交付。 | [说明](engineer/README.md) · [Description](engineer/description.md) · [Instructions](engineer/instructions.md) |
| Bug Fix Agent | 对已授权 TFS Bug 完成诊断、修复、验证与 PR 交付。 | [说明](bug-fix-agent/README.md) · [Description](bug-fix-agent/description.md) · [Instructions](bug-fix-agent/instructions.md) |
| TFS Sync Agent | Squad 外的 Autopilot 适配器，同步 TFS Work Item 与 Delivery Issue。 | [说明](tfs-sync-agent/README.md) · [Description](tfs-sync-agent/description.md) · [Instructions](tfs-sync-agent/instructions.md) · [Autopilot Prompt](tfs-sync-agent/autopilot-prompt.md) |
| PR Status Sync Agent | 核实、同步已登记 PR 的外部状态并交付异常与待处理结果。 | [说明](pr-status-sync-agent/README.md) · [Description](pr-status-sync-agent/description.md) · [Instructions](pr-status-sync-agent/instructions.md) · [Autopilot Prompt](pr-status-sync-agent/autopilot-prompt.md) |

## 暂不使用，保留待整理

| Agent | 状态 | 配置入口 |
| --- | --- | --- |
| Backend Engineer | 研发职责已收敛到 Engineer；已移出 manifest，源文件保留待整理。 | [说明](backend-engineer/README.md) · [Description](backend-engineer/description.md) · [Instructions](backend-engineer/instructions.md) |
| Frontend Engineer | 研发职责已收敛到 Engineer；已移出 manifest，源文件保留待整理。 | [说明](frontend-engineer/README.md) · [Description](frontend-engineer/description.md) · [Instructions](frontend-engineer/instructions.md) |

`Backend Engineer` / `Frontend Engineer` 已从 manifest 的 Agent 和 Squad 成员清单移除，三个专用 Skill 也不再受管；其 Instructions、Skills 及参考文件暂保留。`rondo workspace provision` 不自动删除远端多余对象或成员，因此仓内清理不表示已完成平台停用。Flink Engineer、Verify Agent 尚未登记，实际平台状态需回读核实。

## 文件职责与配置来源

| 文件 | 用途 |
| --- | --- |
| `<agent>/description.md` | 平台展示用的角色简介。 |
| `<agent>/instructions.md` | Agent 的长期职责、边界、原则与交付要求。 |
| `<agent>/autopilot-prompt.md` | Autopilot 触发时使用的任务提示词，仅相关 Agent 提供。 |
| `<agent>/README.md` | 角色资产说明及注册、维护记录。 |
| [_shared/review-checklist.md](_shared/review-checklist.md) | Agent / Skill 资产评审清单。 |

Agent 名称、可见性、Skill 绑定及 Squad 关系由 [provisioning.json](../workspace-config/provisioning.json) 维护，本页不另设绑定矩阵。各 Agent README 中的注册记录用于历史溯源；Workspace 的对象 ID 映射见 [_shared/workspaces/](../workspace-config/workspaces/)，远端实际状态需回读核实。

## 维护与发布入口

- 修改职责与边界时编辑对应 `instructions.md`；执行方法及其契约在绑定 Skill 中维护。
- 新增 Agent 或调整绑定时同步修改 manifest；更新本页的配置入口。
- 内容质量按根仓 [Agent 指令与 Skill 编写规范](../../../docs/conventions/agent-authoring.md) 和 [评审清单](_shared/review-checklist.md) 核对。
- Agent、Squad、Autopilot 配置通过 `rondo workspace provision --workspace <name>` 收敛；Skill 内容使用 `rondo workspace sync`。操作入口见 [Workspace 同步操作手册](../archive/docs-2026-11-18/workspace-sync-operations-guide.md)，具体行为以 `rondo` 实现为准。

规范性契约引用 Skill 内的 `references/` 或 `rondo` 实现；根级 [01 统一设计规范](../01-multica-openspec-design-guideline.md) 与 [02 交付生命周期设计](../02-multica-delivery-lifecycle-design.md) 仅作语义背景。
