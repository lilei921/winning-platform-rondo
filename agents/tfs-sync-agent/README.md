# TFS Sync Agent

负责将 TFS Work Item 同步到 Multica Issue，是 Delivery Squad 外的 Autopilot Agent。

角色资产：[Instructions](instructions.md) · [Description](description.md) · [Autopilot Prompt](autopilot-prompt.md)。

当前 [Manifest](../../workspace-config/provisioning.json) 不绑定 Skill。Agent 直接执行 `rondo workitem sync-issue`，Instructions 定义查询范围与异常处理，Rondo 负责确定性同步、Issue 初始化及回读；Wayfinder 的后续准入评估是独立职责。

修改 Agent 及 Autopilot 配置后，通过 `rondo workspace provision` 发布并回读；源文件存在不代表已启用。
