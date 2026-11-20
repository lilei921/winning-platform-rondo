# Issue Admission Decision Contract

定义 Issue 准入判断语义、有效 Decision 读取规则及 `/note` Comment 数据契约。不规定特定 Agent、Issue 来源或交付阶段的 Status / Assignment / Run 操作。

## 准入依据

以当前 Issue 及其关联的有效准入规则、授权信息和可信 Evidence 为依据，按需判断；适用规则无法确认时不得自行推定符合准入条件：

| 维度 | 需要判断的事实 |
| --- | --- |
| Business Scope | Issue 是否属于适用的业务或处理范围 |
| Repository Discovery | 是否存在可信的候选 Repository / Capability 及必要工程边界 |
| Repository Accessibility | 所需工程资源是否可访问或能够获得授权 |
| Processing Capability | 当前可用的专业能力、工具及工程条件是否能够承接该事项 |
| Admission Boundary | 是否存在明确的准入限制或需要 Human 决定的事项 |

以上是判断维度，不要求填写五套独立 Metadata；调查到足以形成结论的证据即可停止。

## Decision 语义

按以下顺序形成唯一结论：

1. `unsupported`：已有可引用的业务范围、授权、能力或准入限制等硬性排除证据，且不能通过一般信息澄清解除。
2. `eligible`：有充分可信证据证明符合当前适用的准入条件，且不存在已证实的硬性阻断。
3. `needs_human`：关键准入条件仍存在可澄清或需 Human 决定的缺口；说明具体问题及重新评估条件。

尚未定位最终修改文件、未查清根因、暂未找到 Repository、工具故障、待开通权限、仓库数量或任务复杂度，均不能单独证明 `unsupported`。不影响准入的深层专业问题可以作为未知项保留，不要求在准入阶段解决。

## Decision Comment 契约

在当前 Issue 以 `/note` 记录：

- `decision`、简要 `rationale`、关键事实、必要的 `evidence_refs` 和 `unknowns`；
- 相关的 `candidate_repositories`（如涉及 Repository，`repo_id` 为身份、`repo_path` 为定位）；
- Issue 关联的来源身份和版本（如存在，保留可核实的原始字段与值，不要求固定来源类型）；
- `needs_human` 的待确认事项与恢复条件，或 `unsupported` 的硬性排除依据；
- 重新评估替代已有 Decision 时的 `supersedes`（原 Decision Comment 引用），以及存在明确 Human 补充 Comment 时的 `resume_ref`。

Evidence 应能够定位到 Issue、Repository / Ref / Commit / File / Symbol、Router / Spec 或其他可信来源；区分已证实事实、假设与未知项，不复制长源码或原始日志。

**有效 Decision**：同时检查顶层 Comment 和回复线程，结合已有 Decision 引用、适用的来源版本、`supersedes` / `resume_ref` 以及实际 Comment 关系判定，不以最新顶层 Comment 直接替代有效性判断。
