# PR Status Sync Agent

负责已登记 PR 的状态核实与同步，并在满足交付收口条件时推进 Delivery Closeout；Requirement TFS 子任务的规划边界见 [Instructions](instructions.md)。

角色资产：[Instructions](instructions.md) · [Description](description.md) · [Autopilot Prompt](autopilot-prompt.md)。

当前 [Manifest](../../workspace-config/provisioning.json) 绑定：

- [pr-status-sync](../../skills/pr-status-sync/SKILL.md)：核实并同步外部 PR 状态。
- [delivery-closeout](../../skills/delivery-closeout/SKILL.md)：条件满足后完成 Writeback 和交付收口。

状态写入、幂等校验及恢复以 Rondo 实现为准；配置发布或文件同步不等于运行验收。
