# PR Status Sync Agent 配置资产

本目录维护 PR 状态核实与同步的角色配置；Agent 对状态核实结果及异常交付负责，不承担完整交付流程的定义。

## 资产

- [Description](description.md)、[Instructions](instructions.md)、[Autopilot Prompt](autopilot-prompt.md)。
- [pr-status-sync](../../workspace-skills/pr-status-sync/SKILL.md)：PR 状态核实与同步。
- [issue-closeout](../../workspace-skills/issue-closeout/SKILL.md)：具备收口条件时使用的独立交付能力。
- [provisioning.json](../../workspace-skills/_shared/provisioning.json)：Agent、Skill 绑定和 Autopilot 配置的唯一来源。

PR 的终态聚合、幂等和状态副作用由 `rondo` 实现；Agent 不独立解释 abandoned 或 PR Review 的业务语义。Skill 内配置相对自身目录定位，不规定某一 Agent Runtime 的物化目录。

## 发布与验收

运行 `rondo workspace provision --workspace <name>` 和 `rondo workspace sync --workspace <name>` 后回读远端对象及配置。历史部署记录不作为当前 Workspace 验收依据；操作见[同步手册](../../archive/docs-2026-11-18/workspace-sync-operations-guide.md)。
