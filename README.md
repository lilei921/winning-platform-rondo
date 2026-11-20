# Multica + OpenSpec

本仓库维护 Multica + OpenSpec 研发协作所需的设计文档、Agent / Skill / MCP 配置，以及 Rondo CLI。本文只提供**现行入口与职责导航**；具体规则以对应设计文档、配置或实现为准。

## 目录导航

| 目录 | 用途 |
| --- | --- |
| [agents/](agents/README.md) | Agent 角色描述和长期 Instructions |
| [squads/](squads/README.md) | Squad 协作 Instructions |
| [skills/](skills/README.md) | Skill 方法及支持文件 |
| [mcps/](mcps/README.md) | MCP 模板与连接文件说明 |
| [workspace-config/](workspace-config/provisioning.json) | Workspace 受管 Manifest、底稿和 Overlay |
| [rondo/](rondo/package.json) | Rondo CLI 源码、构建和测试 |
| [tools/](tools/README.md) | Rondo 安装、使用与命令参考 |
| [openspec/](openspec/config.yaml) | OpenSpec Schema 和模板 |
| [projects/](projects/description.md) | Multica Project 描述资产 |
| [validation/](validation/) | 实际验证材料 |
| [archive/](archive/README.md) | 历史资料索引 |

Workspace 的受管 Agent、Skill、MCP 与 Squad 配置以 [provisioning.json](workspace-config/provisioning.json) 为准。源文件存在不代表远端已发布；执行结果以目标 Workspace 回读和实际验证为准。

## 设计文档

按工作需要阅读，不把历史方案直接当作当前运行契约。

| 文档 | 主要内容 |
| --- | --- |
| [01 统一设计规范](01-multica-openspec-design-guideline.md) | 系统边界、职责归属与设计原则 |
| [02 交付生命周期](02-multica-delivery-lifecycle-design.md) | 阶段协作和交付边界 |
| [03 Workitem Analysis](03-workitem-analysis-design.md) | 分析与需求澄清 |
| [04 Engineer Development](04-engineer-development-design.md) | 工程开发与验证 |
| [05 OpenSpec Schema](05-openspec-schema-implementation-design.md) | Change 工件及 Schema |
| [06 Method Skill Library](06-method-skill-library-implementation-design.md) | Skill 方法资产设计 |
| [07 实施路线](07-multica-openspec-implementation-roadmap.md) | 实施规划和验收入口 |
| [08 远程分析与 Git 工作区](08-remote-analysis-git-workspace-design.md) | 远程分析和工作区总体方案 |
| [08-A Bug Fix 基础](08a-remote-analysis-bug-fix-foundation.md) | Bug 修复和共享基础 |
| [08-B Requirement 远程 Git 交付](08b-requirement-remote-git-delivery.md) | 跨 Runtime 的需求交付 |
| [08-B 根仓分支与发布](08b-requirement-root-branch-and-publish-plan.md) | Requirement 根仓分支和发布修复 |
| [09 统一 Engineer](09-unified-engineer-development-design.md) | Change 级单 Engineer 研发 |
| [09-A Repository Scope](09a-repository-scope-authority-analysis.md) | 受影响仓库范围的权威来源分析 |
| [10 TFS 子任务](10-tfs-subtask-estimation-design.md) | 子任务、工时和 Commit 归属 |
| [11 Workspace Preparation](11-workspace-preparation-skill-design.md) | Git 工作区准备能力解耦 |
| [12 Issue Closeout Prepare 精简](12-issue-closeout-prepare-simplification-design.md) | PR 终态与归档硬闸门、Worktree 释放时机 |

## 配置与使用

- **职责**：Agent Instructions 定义角色边界，Squad Instructions 定义协作方式，Skill 提供专业方法；遵循 [01 设计规范](01-multica-openspec-design-guideline.md)。
- **发布**：修改受管对象或绑定时使用 `rondo workspace provision`；同步 Skill 时使用 `rondo workspace sync`，具体参数见 [工具使用说明](tools/README.md) 和 [命令参考](tools/COMMANDS.md)。
- **验证**：仓内修改、配置发布和真实运行是不同状态；不以文件存在或历史验证结果代替最新验收。
