---
name: workitem-triage
description: 基于可信证据判断 Issue 准入、记录 Decision，并在适用时交接；用于首次评估、增量重评或交接恢复。
---

# Workitem Triage

## Assessment

### 准入依据

依据当前 Issue、适用规则、授权和可信证据，按需评估以下维度：

- **Business Scope**：是否属于适用的业务或处理范围。
- **Repository Discovery**：是否存在可信的候选 Repository / Capability 及必要的工程边界。
- **Repository Accessibility**：所需工程资源是否可访问或能够获得授权。
- **Processing Capability**：当前专业能力、工具及工程条件是否能够承接。
- **Admission Boundary**：是否存在明确的准入限制或需要 Human 决定的事项。

以上是判断维度，不是必须逐项完成的检查表。证据足以支持判断即可停止调查；适用规则或授权不明时不能直接认定 `eligible`。

- `eligible`：证据足以支持准入，且没有已确认的硬性阻断。
- `needs_human`：关键条件需要 Human 澄清或决定，说明待确认事项和恢复条件。
- `unsupported`：存在可信的硬性排除依据，且不能通过一般信息补充解除。

Repository 尚未定位、工具故障、权限待开通、根因未明或任务复杂度，不能单独证明 `unsupported`。不影响准入的技术细节留待后续分析。

已有 Decision 时，结合来源版本、Comment 关系及 `supersedes` / `resume_ref` 判断有效性。无相关变化则复用；明确要求重评或关键来源、证据、授权发生变化时增量复核。仅恢复交接时不重复发布 Decision。

## Record

在当前 Issue 使用 `/note` 记录 `decision`、简要 `rationale`、关键事实和必要的 `evidence_refs`；存在未知项时说明 `unknowns`。

按需补充：

- 来源身份与版本、`candidate_repositories`（`repo_id` 表示仓库身份，`repo_path` 表示仓库位置）。
- `needs_human` 的待确认事项与恢复条件，或 `unsupported` 的硬性排除依据。
- 更新 Decision 时用 `supersedes` 引用原 Decision；基于 Human 补充信息恢复时用 `resume_ref` 引用对应 Comment。

证据应可追溯，区分事实、假设与未知项，不复制冗长源码或日志。

发布前确认 Issue、来源及关键事实仍然有效。有明确 Human 补充 Comment 时回复对应线程，否则发布顶层 Comment。

发布后回读 Decision 内容、Comment 引用和适用的回复关系；结果不明时先查询，不重复发布。

## Handoff

对准入 Issue 执行以下交接动作：

- `eligible`：确认当前有效 `/note` 已回读。适用 TFS 入口交接时，使用本 Skill 的 `config/repo-registry.json` 绝对路径执行：

  ```bash
  rondo delivery handoff --config "<本技能目录>/config/repo-registry.json" --issue <KEY>
  ```

- `needs_human`：保留 Wayfinder Assignee，保持或设置 `blocked`，说明待确认事项和恢复条件。

- `unsupported`：保留 Wayfinder Assignee，确认 `unsupported` 为当前 Workspace 有效的终止状态后设置并回读，不修改 TFS Work Item。

Handoff 退出码为 `0` 且结果为 `PASS / NOOP` 时确认交接，不代表下游 Run 已完成。`FAIL / UNKNOWN` 或结果不明时先回读核实，不手工改派或重复触发。

## Output

返回 Decision Comment 引用、结论、关键依据和未决项；执行 Handoff 时附 CLI 结果及可用的 Run 引用。不生成独立准入报告。
