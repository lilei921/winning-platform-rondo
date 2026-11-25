# Skill 方法目录

本目录保存 Multica Workspace 使用的独立 Skill 及其支持文件。Skill 负责方法和执行指导；Agent 职责见 [agents/](../agents/README.md)，Workspace 配置见 [workspace-config/](../workspace-config/provisioning.json)。

**受管清单**以 `workspace-config/provisioning.json` 的 `managed_skills` 为准，Agent 绑定以 `agents[].skills` 为准。下表是源码导航，不代表远端已发布或绑定成功。

## 当前受管 Skills

| Skill | 主要用途 |
| --- | --- |
| [analysis-completion](analysis-completion/SKILL.md) | 分析门禁通过后的事实发布与 Analysis 收口 |
| [bug-analysis](bug-analysis/SKILL.md) | Corrective 问题根因与修复建议分析 |
| [bug-delivery](bug-delivery/SKILL.md) | Bug 修复的 Git 交付与 PR 准备 |
| [change-development](change-development/SKILL.md) | Engineer 对完整 Change 的实现、验证及 PR 交付 |
| [codebase-explorer](codebase-explorer/SKILL.md) | 代码库只读探索与影响分析 |
| [diagnosing-bugs](diagnosing-bugs/SKILL.md) | 基于证据定位和验证 Bug |
| [delivery-closeout](delivery-closeout/SKILL.md) | PR 终态后的 TFS Writeback 与 Issue 收口 |
| [pr-status-sync](pr-status-sync/SKILL.md) | 外部 PR 状态核实与同步 |
| [requirement-analysis](requirement-analysis/SKILL.md) | Intentional 需求澄清与方案分析 |
| [spec-preparation](spec-preparation/SKILL.md) | 通过 OpenSpec CLI 准备和修订 Change 工件 |
| [tfs-sync](tfs-sync/SKILL.md) | TFS Work Item 与 Issue 同步 |
| [workspace-preparation](workspace-preparation/SKILL.md) | Bug / Requirement 需要的 Git 工作区准备与复用 |

## 已归档或保留但不受管

| 资产 | 说明 |
| --- | --- |
| [tfs-writeback](../archive/03-skills/tfs-writeback/SKILL.md) | 历史方法资产；当前由 `delivery-closeout` 使用 Rondo Writeback 命令，不单独发布为受管 Skill |
| [workitem-analysis](../archive/skills-2026-11-24/workitem-analysis/SKILL.md) | 已归档的退役 Skill，仅供历史追溯 |
| [development-execution](../archive/skills-2026-11-24/development-execution/SKILL.md)、[backend-engineering](../archive/skills-2026-11-24/backend-engineering/SKILL.md)、[frontend-engineering](../archive/skills-2026-11-24/frontend-engineering/SKILL.md) | 已归档的旧 Task Set / 分角色研发方法，已由统一 Engineer 路线替代 |
| [delivery-flow](../archive/skills-2026-11-24/delivery-flow/SKILL.md)、[delivery-gate](../archive/skills-2026-11-24/delivery-gate/SKILL.md)、[pull-request](../archive/skills-2026-11-24/pull-request/SKILL.md) | 已归档的旧协作与交付方法 |

以上资产不在当前 `managed_skills` 或 Agent 绑定中。未关联现行 Agent 的 7 项源码已于 2026-11-24 移至 `archive/skills-2026-11-24/`；归档不表示远端旧对象已被删除。

## 目录约定

- `SKILL.md`：能力、适用场景与最小充分的执行方法。
- `references/`、`methods/`：需要时读取的参考资料和局部方法。
- `config/`：Skill 使用的配置；具体读取与渲染以 Rondo 实现为准。

运行配置底稿位于 [workspace-config/](../workspace-config/)；业务逻辑与工具命令以 Skill 正文和 Rondo 为准。新增规则遵守 [01 统一设计规范](../01-multica-openspec-design-guideline.md) 的专业聚焦、KISS 与 One Rule One Owner 原则。

## 发布与检查

从仓库根目录执行：

```bash
# Agent 绑定或受管清单变更
rondo workspace provision --workspace <name>

# 发布指定 Skill
rondo workspace sync --workspace <name> --skill <skill-name>

# 仅渲染、检查漂移
rondo workspace sync --workspace <name> --local-only
rondo workspace sync --workspace <name> --check
```

命令说明见 [rondo/](../rondo/README.md)。部署结果应以目标 Workspace 回读为准，不以仓库文件存在作为验收证据。
