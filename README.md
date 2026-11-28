# Rondo

**Multica + OpenSpec · AI 原生研发协作工程**

以 Multica 为协作运行时，以 OpenSpec 为工程契约，通过 Agent、Skill 与 Rondo CLI 构建规范驱动、可验证、可追溯的研发交付体系。

## 核心架构

| 组件 | 职责 |
| --- | --- |
| Multica | Issue、Run、Agent 与 Squad 协作，维护 Delivery Truth |
| OpenSpec | Change、Schema 与 Artifact，维护 Engineering Truth |
| Skill / MCP | 专业方法、上下文获取与工具集成 |
| Rondo CLI | 确定性校验、Gate、Git / TFS 交付与 Workspace 管理 |

## 交付流程

```mermaid
flowchart LR
    A[Work Item] --> B[Analysis]
    B --> C[Human Review]
    C -->|Approved| D[Development & Validation]
    D --> E[PR]
    E --> F[Closeout & Archive]
```

以单一 Multica Issue 组织交付，以 OpenSpec Change 承载工程契约；专业判断由 Agent 负责，关键授权由 Human 决定，明确的硬条件由确定性机制校验。独立 Verification 按需参与。

完整流程与适用分支见 [交付生命周期](02-multica-delivery-lifecycle-design.md)。

## 工程结构

| 目录 | 职责 |
| --- | --- |
| [agents/](agents/README.md) · [squads/](squads/README.md) | 角色职责与协作 Instructions |
| [skills/](skills/README.md) · [mcps/](mcps/README.md) | 专业方法与工具配置 |
| [openspec/](openspec/config.yaml) | Schema 与 Artifact 模板 |
| [rondo/](rondo/README.md) | CLI 源码、构建、测试与使用说明 |
| [workspace-config/](workspace-config/) · [projects/](projects/description.md) | Workspace 受管配置与 Project 描述 |
| [validation/](validation/) · [archive/](archive/) | 实际验证与历史资料 |

## 设计文档

| 领域 | 阅读入口 |
| --- | --- |
| 总体架构 | [统一设计规范](01-multica-openspec-design-guideline.md) · [交付生命周期](02-multica-delivery-lifecycle-design.md) |
| 分析与研发 | [Workitem Analysis](03-workitem-analysis-design.md) · [Engineer Development](04-engineer-development-design.md) · [统一 Engineer](09-unified-engineer-development-design.md) |
| 规范与方法 | [OpenSpec Schema](05-openspec-schema-implementation-design.md) · [Method Skill Library](06-method-skill-library-implementation-design.md) |
| 工程交付 | [Git Workspace](08-remote-analysis-git-workspace-design.md) · [TFS 子任务](10-tfs-subtask-estimation-design.md) · [Workspace Preparation](11-workspace-preparation-skill-design.md) |
| 实施规划 | [Roadmap](07-multica-openspec-implementation-roadmap.md) |

<details>
<summary>专题设计与优化方案</summary>

- Git 交付：[Bug Fix 基础](08a-remote-analysis-bug-fix-foundation.md) · [Requirement 远程交付](08b-requirement-remote-git-delivery.md) · [根仓分支与发布](08b-requirement-root-branch-and-publish-plan.md) · [Repository Scope](09a-repository-scope-authority-analysis.md)
- Workspace 与 Closeout：[Native Repo 工作区准备](12-native-repo-workspace-preparation-design.md) · [Delivery Closeout 无配置化](12-delivery-closeout-config-removal-plan.md)
- 分析与工件优化：[Workitem Analyst 约束评审](13-workitem-analyst-constraint-optimization-review.md) · [过程工件精简](17-workitem-analyst-review-artifacts-simplification-2026-11-21.md)

</details>

## 配置与使用

安装及环境配置见 [Rondo CLI](rondo/README.md)，完整参数见 [命令参考](rondo/COMMANDS.md)。

| 命令 | 用途 |
| --- | --- |
| `rondo workspace provision` | 发布受管对象与绑定 |
| `rondo workspace sync` | 同步 Skill |

受管配置以 [provisioning.json](workspace-config/provisioning.json) 为准。具体运行契约以对应设计、配置与实现为准；设计方案、仓内实现、远端发布和运行验收是不同状态，实际结果以回读与验证为准。

---

**设计原则**：First Principles · KISS · YAGNI · Native First · One Rule One Owner
