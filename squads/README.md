# Multica Squad 配置资产

本目录维护 Squad 的协作指令。Squad 是协作单元，Agent 角色配置见 [Agent 索引](../agents/README.md)，执行方法见 [Workspace Skill 索引](../workspace-skills/README.md)。

当前 Requirement 研发由单一 `Engineer` 承担完整 Change。下表与 [provisioning manifest](../workspace-skills/_shared/provisioning.json) 的成员声明一致；实际 Workspace 成员与发布状态需回读核实。

## Squad 索引

| Squad | 指令源文件 | Leader | Members |
| --- | --- | --- | --- |
| Delivery Squad | [squad-instructions.md](delivery-squad/squad-instructions.md) | Delivery Lead | Workitem Analyst、Engineer |

Wayfinder Agent 与 Bug Fix Agent 在 Squad 外处理准入与独立 Bug 修复；TFS Sync Agent 与 PR Status Sync Agent 在 Squad 外通过 Autopilot 运行。

Backend / Frontend Engineer 已从 manifest 的 Agent 和成员清单移除，角色与 Skill 源文件保留待整理。`rondo workspace provision` 仅新增成员或更新 Role，不自动移除远端旧成员；目标 Workspace 的实际 Roster 需另行核实。

## 指令边界

[Delivery Squad Instructions](delivery-squad/squad-instructions.md) 维护成员选择、当前 Issue 内的 `@mention` 协作、交接、人工等待与异常升级原则，仅由 Leader 接收。Member 的执行义务由其自身 [Agent Instructions](../agents/README.md) 与绑定 Skill 承载。

Leader 与成员名单由 [provisioning.json](../workspace-skills/_shared/provisioning.json) 的 `squad` 字段维护；本页表格提供配置索引，不代表远端发布状态。交付门禁、事实字段与确定性行为见对应 [Skill](../workspace-skills/README.md) 的契约及 `rondo` 实现。

## 维护与发布入口

- 调整协作原则时编辑 `delivery-squad/squad-instructions.md`；调整 Leader 或成员时修改 manifest，并核对对应 Agent 资产。
- 涉及 Member 职责变化时同步检查其 Agent Instructions 与绑定 Skill，避免仅在 Squad Instructions 中定义执行义务。
- 配置发布使用 `rondo workspace provision --workspace <name>`；操作入口见 [Workspace 同步操作手册](../archive/docs-2026-11-18/workspace-sync-operations-guide.md)，具体行为以 `rondo` 实现为准。
- 修改后按 [资产评审清单](../agents/_shared/review-checklist.md) 核对角色边界与跨资产一致性；[01 统一设计规范](../01-multica-openspec-design-guideline.md) 与 [02 交付生命周期设计](../02-multica-delivery-lifecycle-design.md) 仅作语义背景。
