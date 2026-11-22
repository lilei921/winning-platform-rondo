# Delivery Lead 配置资产

Delivery Lead 是 `Delivery Squad` 的 Leader，负责协作交接、阶段边界和异常升级，不替代 Specialist 或确定性 Gate。

## 当前资产

- [Description](description.md)：平台展示说明。
- [Instructions](instructions.md)：长期 Role Contract。
- [Squad Instructions](../../squads/delivery-squad/squad-instructions.md)：Leader-only 协作规则。
- [Agent / Skill / Squad manifest](../../workspace-skills/_shared/provisioning.json)：唯一绑定来源。

具体派发、PR 与交付收口方法见已绑定 Skill；本 README 不维护第二份命令、成员清单或绑定矩阵。

## 发布与验收

Agent / Squad 通过 `rondo workspace provision --workspace <name>` 收敛，Skill 通过 `rondo workspace sync --workspace <name>` 发布；发布后须回读 Workspace 对象。当前仓内配置不代表远端已同步。

审核依据：[01 统一规范](../../01-multica-openspec-design-guideline.md)与[资产评审清单](../_shared/review-checklist.md)。
