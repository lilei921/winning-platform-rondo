# TFS Sync Agent 配置资产

TFS Sync Agent 是 Squad 外的 Autopilot 薄适配器；TFS 来源同步和 Issue 初始化由确定性 `tfs-sync` 方法执行。

## 资产

- [Description](description.md)：展示角色定位。
- [Instructions](instructions.md)：稳定职责与停止边界。
- [Autopilot Prompt](autopilot-prompt.md)：单次同步意图。
- [tfs-sync Skill](../../skills/tfs-sync/SKILL.md)：命令、回读与失败恢复。
- [配置及绑定来源](../../workspace-config/provisioning.json)：Managed Skill 与 Agent / Autopilot 配置。

## 同步入口

新建 Delivery Issue 以 `backlog + Wayfinder Agent` 初始化 TFS 来源和附件；完成回读即同步完成，Issue 保持 backlog 停放，不做状态激活（准入由 Human 在 Issue 上 Mention Wayfinder 触发）。已有普通 Issue 只同步来源管理事实，不重置 Owner / Status；未完成初始化的 pending Issue 通过 `tfs-sync` 恢复收口。

实现已更新到 `rondo tfs reconcile-workitem`，但正式 Workspace 的配置发布、首次 Wayfinder Run、失败恢复和端到端准入尚未验收，不得视为已上线。

## 发布

配置由 `rondo workspace sync` 从共享底稿与 Workspace overlay 渲染；对象通过 `rondo workspace provision` 管理。操作见[同步手册](../../archive/docs-2026-11-18/workspace-sync-operations-guide.md)，验收见[Wayfinder 验收清单](../../validation/wayfinder-asset-acceptance-2026-10-28.md)。
