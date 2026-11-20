# Agent 配置

本目录维护 Multica Agent 的角色资产。职责与执行边界在各 Agent 的 `instructions.md` 中定义；专业方法由绑定的 [Skills](../skills/README.md) 提供，Squad 协作规则见 [squads/](../squads/README.md)。

## 当前受管 Agent

以下清单与 [provisioning.json](../workspace-config/provisioning.json) 的 `agents` 对应；实际 Workspace 状态需通过 Rondo 回读确认。

| Agent | 定位 | 文件 |
| --- | --- | --- |
| Delivery Lead | 交付协调、阶段交接和异常处理 | [README](delivery-lead/README.md) · [Instructions](delivery-lead/instructions.md) · [Description](delivery-lead/description.md) |
| Wayfinder Agent | Work Item 准入评估与受控移交 | [README](wayfinder-agent/README.md) · [Instructions](wayfinder-agent/instructions.md) · [Description](wayfinder-agent/description.md) |
| Workitem Analyst | Requirement 分析与 OpenSpec Change 准备 | [README](workitem-analyst/README.md) · [Instructions](workitem-analyst/instructions.md) · [Description](workitem-analyst/description.md) |
| Engineer | 已批准 Change 的完整开发、验证和 PR 交付 | [README](engineer/README.md) · [Instructions](engineer/instructions.md) · [Description](engineer/description.md) |
| Bug Fix Agent | Bug 诊断、修复、验证与 PR 交付 | [README](bug-fix-agent/README.md) · [Instructions](bug-fix-agent/instructions.md) · [Description](bug-fix-agent/description.md) |
| TFS Sync Agent | TFS Work Item 与 Multica Issue 同步 | [README](tfs-sync-agent/README.md) · [Instructions](tfs-sync-agent/instructions.md) · [Autopilot Prompt](tfs-sync-agent/autopilot-prompt.md) |
| PR Status Sync Agent | PR 状态同步与符合条件的 Issue 收口 | [README](pr-status-sync-agent/README.md) · [Instructions](pr-status-sync-agent/instructions.md) · [Autopilot Prompt](pr-status-sync-agent/autopilot-prompt.md) |

## 保留但不受管

[Backend Engineer](backend-engineer/README.md)、[Frontend Engineer](frontend-engineer/README.md) 的源码仍在仓库中，但不在当前 `agents` 或 Squad 成员清单中。现行 Requirement 研发由统一的 Engineer 承担。

## 文件与发布

| 文件 | 职责 |
| --- | --- |
| `description.md` | Agent 展示简介 |
| `instructions.md` | 长期职责、执行边界与交付约定 |
| `autopilot-prompt.md` | Autopilot 任务入口（仅适用 Agent） |
| `README.md` | 本地资产说明 |

Agent 名称、Skill / MCP 绑定、Squad 和 Autopilot 配置以 [workspace-config/provisioning.json](../workspace-config/provisioning.json) 为唯一维护入口；Workspace 对象 ID 在 [workspace-config/workspaces/](../workspace-config/workspaces/) 中维护。

修改角色资产后，通过 `rondo workspace provision --workspace <name>` 更新受管配置，按需通过 `rondo workspace sync --workspace <name>` 同步 Skill。Provision 不会自动删除远端未受管 Agent；仓内配置不等于实际部署状态。

编写原则参见 [01 统一设计规范](../01-multica-openspec-design-guideline.md)，不在本目录另设评审规则。
