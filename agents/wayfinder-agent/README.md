# Wayfinder Agent

Delivery Squad 外的准入评估 Agent。根据可信证据判断 Issue 是否适合进入后续处理，不替代正式分析或研发，也不修改源码。

角色资产：[Instructions](instructions.md) · [Description](description.md)。

当前 [Manifest](../../workspace-config/provisioning.json) 绑定：

- [workitem-triage](../../skills/workitem-triage/SKILL.md)：准入判断、结果记录和受控移交。
- [codebase-explorer](../../skills/codebase-explorer/SKILL.md)：必要时的只读代码探索。

代码调查可按需使用已授权 MCP。首次入口和异常恢复以适用的 Skill 契约、Issue 当前状态及 Rondo 回读为准；不以历史 POC 结果代替目标 Workspace 验收。
