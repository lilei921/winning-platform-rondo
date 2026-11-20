# 旧版 Workspace Skills 归档

## tfs-sync

- 原始路径：`projects/multica/workspace-skills/tfs-sync/`
- 归档日期：2026-10-22
- 归档原因：与从 `D:\WN_Platform\works\gitee_repos\multica` 迁入的新 TypeScript 流水线存在资产和流程语义冲突。
- 旧流程：`tfs-mcp + Python + Wayfinder`，同步后激活 `todo + Wayfinder Agent`。
- 新流程：`tfs-cli + TypeScript + Delivery Squad`，新建 Issue 初始化为 `backlog + Delivery Squad`。

归档时整个目录原样移动，文件内容未修改。本目录仅用于历史追溯，不参与 `provision-workspace.ts` 和 `sync-workspace.ts` 的对象供给或内容同步。

目标 monorepo 原有的 `.agents/skills/tfs-sync/`、`managed-skills/` 及既有设计文档不在本次归档范围内，均保持原路径、原内容。既有历史文档不代表本次迁入流水线的当前同步基线。
