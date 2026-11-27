# TFS Sync Agent

负责将 TFS Work Item 同步到 Multica Issue，是 Delivery Squad 外的 Autopilot Agent。

角色资产：[Instructions](instructions.md) · [Description](description.md) · [Autopilot Prompt](autopilot-prompt.md)。

当前 [Manifest](../../workspace-config/provisioning.json) 绑定 [tfs-sync](../../skills/tfs-sync/SKILL.md)。同步范围、Issue 初始化、异常恢复与回读方式由 Skill 和 Rondo 实现负责；Wayfinder 的后续准入评估是独立职责。

修改 Agent 及 Autopilot 配置后，通过 `rondo workspace provision` 发布并回读；源文件存在不代表已启用。
