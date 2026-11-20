# Delivery Lead 配置资产

Delivery Lead 是 `Delivery Squad` 的 Leader，负责协作交接、阶段边界和异常升级，不替代 Specialist 或确定性 Gate。

## 当前资产

- [Description](description.md)：平台展示说明。
- [Instructions](instructions.md)：长期 Role Contract。
- [Squad Instructions](../../squads/delivery-squad/squad-instructions.md)：Leader-only 协作规则。
- [Agent / Skill / Squad manifest](../../workspace-skills/_shared/provisioning.json)：唯一绑定来源。

Lead 按 Instructions 协调成员；已批准 Change 的研发交接操作见 [change-handoff](../../workspace-skills/change-handoff/SKILL.md)。PR 技术交付由 Engineer 完成，PR 状态同步与交付收口由 PR Status Sync Agent 承担。

## 发布与验收

Agent / Squad 通过 `rondo workspace provision --workspace <name>` 收敛，Skill 通过 `rondo workspace sync --workspace <name>` 发布；发布后须回读 Workspace 对象。当前仓内配置不代表远端已同步。

审核依据：[01 统一规范](../../01-multica-openspec-design-guideline.md)与[资产评审清单](../_shared/review-checklist.md)。
