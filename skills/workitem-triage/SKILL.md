---
name: workitem-triage
description: 基于可信证据判断 Issue 准入、记录 Decision，并在适用时交接；用于首次评估、重评或交接恢复。
---

# Workitem Triage

## Assessment

基于当前 Issue、适用的来源、准入规则、授权及已有 Decision，按 [Decision Contract](references/decision-contract.md) 判断 `eligible`、`needs_human` 或 `unsupported`。按需补查影响结论的事实，证据充分即可停止；不要求固定工具、调查顺序或定位最终改动点。

已有有效 Decision 且无相关变化时复用；明确重评或关键来源、证据、授权变化时增量复核。仅恢复交接时不重复发布 Decision。

## Record

发布 `/note` 前确认 Issue 身份、来源版本及关键事实仍适用；如发生实质变化，先修正判断。按 Decision Contract 记录；有明确 Human 补充 Comment 时回复对应线程，否则使用顶层 Comment。回读已发布内容与 Comment 引用（含适用的回复关系）；结果不明时先查询，不重复发布。

## Handoff

仅对原始 TFS 准入 Issue 执行以下交接动作：

- `eligible` 且当前有效 `/note` 已回读确认：使用本 Skill 的 `config/repo-registry.json` 绝对路径执行：

  ```bash
  rondo delivery handoff --config "<本技能目录>/config/repo-registry.json" --issue <KEY>
  ```

- `needs_human`：保留 Wayfinder Assignee，保持或设置 `blocked`，说明待确认事项和恢复条件。
- `unsupported`：保留 Wayfinder Assignee；确认 `unsupported` Status 的 Category 为 `closed` 后设置该状态，不修改 TFS Work Item。

Human 在原 Issue 补充信息并将 Status 恢复为 `todo`、保留 Wayfinder Assignee 后，由 Multica 原生机制触发重新准入。非 TFS 入口只记录 Decision，不调用交接命令。

目标映射、Assignment 和 Run 核验由 Rondo 负责。退出码 `0` 且结果为 `PASS / NOOP` 才表示交接确认，不代表下游 Run 已完成。来源、权限或写入结果不明，或命令返回 `FAIL / UNKNOWN` 时，停止受影响操作并先回读，不手工改派或重复触发。

## Output

返回 Decision Comment 引用、结论、关键依据和未决项；执行交接时附 CLI 结果与 Run 引用。不生成独立准入报告。
