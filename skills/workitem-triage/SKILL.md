---
name: workitem-triage
description: 基于可信证据判断 Issue 准入、记录 Decision，并在适用时交接；用于首次评估、重评或交接恢复。
---

# Workitem Triage

## Assessment

依据当前 Issue、适用规则、授权和可信证据，按需判断业务范围、候选 Repository / Capability、访问条件、处理能力与准入限制。这些是判断维度，不是必填检查表；规则或授权不明时不能直接认定 `eligible`。

- `unsupported`：已有可信的硬性排除依据，且不能通过一般信息补充解除。
- `eligible`：证据足以支持准入，且没有已确认的硬性阻断。
- `needs_human`：关键条件仍需澄清或由 Human 决定，说明问题与恢复条件。

暂未找到 Repository、工具故障、权限待开通、未定位根因或任务复杂度不能单独证明 `unsupported`；不影响准入的技术细节留待后续分析。

已有 Decision 时，结合来源版本、顶层与回复 Comment 关系，以及适用的 `supersedes` / `resume_ref` 判断其有效性，不仅凭最新顶层 Comment。无相关变化则复用；明确重评或关键来源、证据、授权变化时增量复核。仅恢复交接时不重复发布 Decision。

## Record

在当前 Issue 用 `/note` 记录 `decision`、简要 `rationale`、关键事实和必要的 `evidence_refs`；存在未知项时说明 `unknowns`。根据实际情况补充：

- 可核实的来源身份与版本，以及相关 `candidate_repositories`（`repo_id` 表示身份、`repo_path` 表示定位）。
- `needs_human` 的待确认问题和恢复条件，或 `unsupported` 的硬性排除依据。
- 替代旧 Decision 时用 `supersedes` 引用原 Decision Comment；Human 补充触发恢复时用 `resume_ref` 引用对应 Human Comment。

证据应可追溯，区分事实、假设与未知项；不复制长源码或原始日志。发布前核对 Issue 身份、来源和关键事实仍适用；有实质变化时先修正结论。有明确 Human 补充 Comment 时回复对应线程，否则使用顶层 Comment。回读内容、Comment 引用和适用的回复关系；结果不明时先查询，不重复发布。

## Handoff

仅对原始 TFS 准入 Issue 执行以下交接动作：

- `eligible` 且当前有效 `/note` 已回读确认：使用本 Skill 的 `config/repo-registry.json` 绝对路径执行：

  ```bash
  rondo delivery handoff --config "<本技能目录>/config/repo-registry.json" --issue <KEY>
  ```

- `needs_human`：保留 Wayfinder Assignee，保持或设置 `blocked`，说明待确认事项和恢复条件。
- `unsupported`：保留 Wayfinder Assignee；确认当前 Workspace 中 `unsupported` 是有效的终止状态后设置并回读，不修改 TFS Work Item。

`needs_human` 后，Human 在原 Issue 补充 Comment，由 Multica 原生 Comment Trigger 唤醒 Wayfinder；Wayfinder 增量评估并发布新 Decision，只有新结论为 `eligible` 且 `/note` 回读确认后才交接。Human 无须手动改 `todo`；唤醒未确认时不自行重放启动。非 TFS 入口只记录 Decision，不调用交接命令。

目标映射、Assignment 和 Run 核验由 Rondo 负责。退出码 `0` 且结果为 `PASS / NOOP` 才表示交接确认，不代表下游 Run 已完成。来源、权限或写入结果不明，或命令返回 `FAIL / UNKNOWN` 时，停止受影响操作并先回读，不手工改派或重复触发。

## Output

返回 Decision Comment 引用、结论、关键依据和未决项；执行交接时附 CLI 结果与 Run 引用。不生成独立准入报告。
