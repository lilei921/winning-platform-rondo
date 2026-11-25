---
name: workitem-triage
description: 提供基于可信证据的 Issue 准入评估、Decision 判断与记录方法；适用于首次评估和增量重评。
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

### Decision 语义

依据准入证据形成以下结论：

- **`unsupported`**：存在明确且可信的硬性排除依据，当前无法进入自动交付。例如：
  - Issue 明确不属于支持的业务或处理范围。
  - 适用规则明确禁止自动处理，且不存在可行的授权路径。
  - 已确认所需 Repository / Capability 无法获得访问或修改授权。
  - 已确认当前交付体系不具备承接能力，且无可行的处理路径。

- **`needs_human`**：准入所必需的条件尚未确认，需要 Human 补充信息、澄清或决策。例如：
  - 业务范围、处理目标或责任归属不明确。
  - 多个候选 Repository / Capability 无法根据现有证据消歧。
  - 必要的访问权限或处理授权尚待确认。
  - 存在需要 Human 决定的准入限制或处理方式。

  应明确待确认事项及恢复条件，便于 Human 补充后增量重评。

- **`eligible`**：已有充分可信证据支持进入后续处理，且不存在已确认的硬性阻断。无需在准入阶段完成根因分析、技术设计或确定最终修改文件。

**判断边界：**

Repository 暂未定位、工具故障、权限待开通、根因未明或任务复杂度，均不能单独证明 `unsupported`。应先按需继续取证；关键条件需要 Human 确认时才使用 `needs_human`。

准入只判断是否具备进入后续处理的条件，不代表需求已获批准或承诺研发成功。

已有 Decision 时，结合来源版本、Comment 关系及 `supersedes` / `resume_ref` 判断有效性。无相关变化则复用；明确要求重评或关键来源、证据、授权发生变化时增量复核。

## Record

在当前 Issue 使用 `/note` 记录 `decision`、简要 `rationale`、关键事实和必要的 `evidence_refs`；存在未知项时说明 `unknowns`。

按需补充：

- 来源身份与版本、`candidate_repositories`（`repo_id` 表示仓库身份，`repo_path` 表示仓库位置）。
- `needs_human` 的待确认事项与恢复条件，或 `unsupported` 的硬性排除依据。
- 更新 Decision 时用 `supersedes` 引用原 Decision；基于 Human 补充信息恢复时用 `resume_ref` 引用对应 Comment。

证据应可追溯，区分事实、假设与未知项，不复制冗长源码或日志。

发布前确认 Issue、来源及关键事实仍然有效。有明确 Human 补充 Comment 时回复对应线程，否则发布顶层 Comment。

发布后回读 Decision 内容、Comment 引用和适用的回复关系；结果不明时先查询，不重复发布。不生成独立准入报告。
