# Multica Squad 配置资产

本目录维护 Squad 的协作指令。Squad 是协作单元，Agent 角色配置见 [Agent 索引](../agents/README.md)，执行方法见 [Workspace Skill 索引](../workspace-skills/README.md)。

本页按 2026-10-26 的仓内源文件与 [provisioning manifest](../workspace-skills/_shared/provisioning.json) 整理；实际 Workspace 成员与发布状态需回读核实。

## Squad 索引

| Squad | 指令源文件 | manifest 中的 Leader | manifest 中的 Members |
| --- | --- | --- | --- |
| Delivery Squad | [squad-instructions.md](delivery-squad/squad-instructions.md) | Delivery Lead | Workitem Analyst、Backend Engineer、Frontend Engineer |

Wayfinder Agent 在 Squad 外通过 Issue Assignment / Human 显式 Mention 运行；TFS Sync Agent 与 PR Status Sync Agent 在 Squad 外通过 Autopilot 运行。

当前 Squad Instructions 还描述了 Flink Engineer 与 Verify Agent 的协作职责；它们尚未纳入 manifest，且没有对应的仓内 Agent 配置。是否可派发应以目标 Workspace 的实际 Roster 为准。

## 指令边界

[Delivery Squad Instructions](delivery-squad/squad-instructions.md) 维护成员选择、当前 Issue 内的 `@mention` 协作、交接、人工等待与异常升级原则，仅由 Leader 接收。Member 的执行义务由其自身 [Agent Instructions](../agents/README.md) 与绑定 Skill 承载。

Leader 与成员名单由 [provisioning.json](../workspace-skills/_shared/provisioning.json) 的 `squad` 字段维护；本页表格仅为该配置的导航摘要。交付门禁、事实字段与确定性行为见对应 [Skill](../workspace-skills/README.md) 的契约及 `rondo` 实现。

## 维护与发布入口

- 调整协作原则时编辑 `delivery-squad/squad-instructions.md`；调整 Leader 或成员时修改 manifest，并核对对应 Agent 资产。
- 涉及 Member 职责变化时同步检查其 Agent Instructions 与绑定 Skill，避免仅在 Squad Instructions 中定义执行义务。
- 配置发布使用 `rondo workspace provision --workspace <name>`；操作入口见 [Workspace 同步操作手册](../workspace-sync-operations-guide.md)，具体行为以 `rondo` 实现为准。
- 修改后按 [资产评审清单](../agents/_shared/review-checklist.md) 核对角色边界与跨资产一致性；[01 统一设计规范](../01-multica-openspec-design-guideline.md) 与 [02 交付生命周期设计](../02-multica-delivery-lifecycle-design.md) 仅作语义背景。
