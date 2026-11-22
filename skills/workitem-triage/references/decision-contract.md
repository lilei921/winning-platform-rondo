# Issue Admission Decision Contract

本契约定义准入判断语义及 `/note` 记录，不定义 Multica Status、Assignment 或交接路由。

## Decision

结合当前 Issue、适用规则、授权及可信证据，按需判断业务范围、候选 Repository / Capability、访问条件、处理能力和准入限制。这些是判断维度，不是必须逐项执行的检查表；证据足以判断即可停止。适用规则或授权无法确认时，不得直接推定 `eligible`。

- `unsupported`：存在可信的硬性排除依据，且不能通过一般信息补充解除。
- `eligible`：可信证据支持准入，且不存在已确认的硬性阻断。
- `needs_human`：关键条件尚待澄清或需要 Human 决定；说明具体问题及恢复条件。

暂未发现 Repository、尚未定位根因或修改文件、工具故障、权限待开通、任务复杂度，都不能单独证明 `unsupported`。不影响准入的专业细节留给后续分析。

## Decision Comment

在当前 Issue 用 `/note` 记录 `decision`、简要 `rationale`、关键事实及必要的 `evidence_refs`；有未知或待确认事项时记录 `unknowns`。按实际情况补充：

- 可核实的 Issue 来源身份与版本；
- 相关 `candidate_repositories`（`repo_id` 表示身份，`repo_path` 表示定位）；
- `needs_human` 的待确认事项与恢复条件，或 `unsupported` 的硬性排除依据；
- 替代旧 Decision 时的 `supersedes`，以及 Human 补充触发恢复时的 `resume_ref`。

证据引用应可追溯，区分事实、假设与未知项，不复制长源码或原始日志。

判断已有 Decision 是否有效时，结合当前来源版本、顶层 Comment 与回复线程，以及适用的 `supersedes` / `resume_ref`；不能仅以最新顶层 Comment 为准。
