# Wayfinder Agent 配置资产

Wayfinder Agent 是 Delivery Squad 外的 Intake Triage Agent；不加入 Squad Roster，也不配置 Autopilot。当前研发测试阶段，TFS Sync 初始化后保持 `backlog + Wayfinder Agent`，Human 手动改 `todo`；研发结束后的目标态仍由 TFS Sync 自动改 `todo`。两者均保留 Wayfinder Agent Assignee，由 Multica 原生状态触发首次准入；具体边界见 [02 阶段约定](../../02-multica-delivery-lifecycle-design.md#wayfinder-entry-stages)，正式 Workspace 尚待联调与验收。受控恢复按 [Handoff Contract](../../skills/workitem-triage/references/multica-handoff-contract.md)执行。

| 文件 | 用途 |
| --- | --- |
| [description.md](description.md) | Multica Agent Description，仅展示 |
| [instructions.md](instructions.md) | 长期 Role Contract |
| [workitem-triage](../../skills/workitem-triage/SKILL.md) | 准入判定与 `/note`，`eligible` 后调用 `rondo delivery handoff` 受控交接 |
| [codebase-explorer](../../skills/codebase-explorer/SKILL.md) | 只读工程探索与 Evidence |

注册名称、`visibility=workspace` 和两项 Skill 绑定，以 [provisioning.json](../../workspace-config/provisioning.json) 为准。通过 `rondo workspace provision --workspace <name>` 注册与收敛，再执行 `rondo workspace sync --workspace <name>` 同步 Skill 内容；这些命令不自动启用 TFS Sync 的新入口。

**上线边界**：正式使用前需核对 `unsupported` 自定义状态、Wayfinder 的 Runtime / CodeGraph / Repository 权限、首次 TFS Sync Assignment、`/note` 顶层与回复回读、按来源类型单次 `todo + Bug Fix Agent / Delivery Squad` 交接及对应唯一 Bug Fix Agent / Delivery Lead Run。`unsupported (closed)` 的显式恢复须单独 E2E 验证。隔离 POC 不代表正式 Workspace 已验收。

验收用例见 [Wayfinder 资产与集成验证清单](../../validation/wayfinder-asset-acceptance-2026-10-28.md)。
