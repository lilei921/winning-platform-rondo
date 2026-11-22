---
name: workitem-triage
description: 对 Issue 进行准入评估，基于可信证据形成准入结论并通过 /note 记录；适用于首次评估或重新评估。
---

# Workitem Triage

## Preconditions / Inputs

- 当前 Issue 的描述及相关上下文；已有 Comment、Decision（如有）与关联 Evidence 按需复用。

## Assessment（专业准入评估，按需选择方法）

先依据 [Decision Contract](references/decision-contract.md) 读取当前 Issue、适用来源版本及已有 Decision，判断结论是否仍有效。重新评估既可由明确请求触发，也可由适用交接契约规定的重新准入事实触发（例如 Human 补充信息后按契约恢复 Issue 状态）；不能仅因存在历史 Decision 就跳过有效的重新准入。无重新评估触发且已有有效结论时直接复用，不重复调查或发布；如已有交接尚未完成或结果未知，则按交接契约回读并仅恢复缺失动作。重新评估时只核对影响当前结论的变化。

根据证据充分性按需采用以下方法，不将它们视为必须依次执行的阶段：

- **Understand（理解当前准入问题）**：识别当前 Issue 的业务范围、已知约束、已有准入结论和待确认的关键条件；区分来源事实、观察与假设。
- **Investigate（补充必要证据）**：复用当前 Issue / Comment / Evidence；缺少影响准入的工程事实时按需使用 `codebase-explorer`，只补查缺口、变化或冲突。工具故障、尚未定位最终文件或 Root Cause 不单独构成硬性排除。
- **Decide（形成专业判断）**：依据当前适用准入规则及可信 Evidence，按 Decision Contract 判断 `eligible` / `needs_human` / `unsupported`，说明理由、未决项和适用条件；不得把暂缺证据当成 `unsupported`。
- **Reconcile（修正受影响结论）**：发现 Issue 来源、授权或 Evidence 有实质变化时，按影响范围重新评估，不机械重做所有调查。

专业判断可以往返，不要求固定调查次数或 CodeGraph 调用；**取得足以支撑准入结论的证据即停止继续探索**。

## Decision Publication & Handoff（有副作用的必要顺序）

新发布或重新评估时，按以下必要顺序执行；若仅恢复已有有效 Decision 的交接，先核对已有 `/note` 的有效性与回读事实，跳过重复发布，仅完成尚缺且获授权的交接动作。顺序由事实新鲜度、持久化与交接依赖决定，不能随意交换：

1. **写入前复核**：确认 Issue 身份、影响 Decision 的内容与来源版本仍有效，核对适用权限；发生实质变化时仅补查受影响部分，无法确认则停止受影响写入。
2. **持久化并回读 `/note`**：根据 [Decision Contract](references/decision-contract.md) 在当前 Issue 以 `/note` 开头记录 Decision、理由和 Evidence。存在明确 Human 补充 Comment 时关联对应线程，否则使用顶层 Comment；必须回读 Comment ID、内容及适用的 `parent_id`。写入结果未知时先查询，不盲目重复发布。
3. **按适用契约交接并核验**：本轮 `/note` 已回读确认后，核对 [Multica Handoff Contract](references/multica-handoff-contract.md) 的适用条件。适用且 `eligible` 时，执行 `rondo delivery handoff --config <本 Skill 目录>/config/repo-registry.json --issue <当前 Issue>`；由 CLI 读取 `tfs.type`、确定目标并原子交接，Wayfinder 不再手工选择 Agent / Squad 或修改 Assignment。`needs_human` / `unsupported` 仍按交接契约处理；不适用时只交付 Decision。`FAIL / UNKNOWN` 时停止，不自行改派或重复触发。

## Validation

- 准入结论符合 Decision Contract，关键事实与 Evidence 可追溯，未知项和限制已说明。
- 新发布或重新评估产生的 `/note` 必须持久化并回读，关联的原 Decision 或 Human Comment 引用正确；仅恢复交接时核实已有 Decision 及其 Comment 引用有效，不重复发布。
- 执行了交接时，按相应交接契约核实结果；写入请求成功不替代结果回读。

## Output

- 当前 Issue 的 Decision Comment ID / 引用，以及 `decision`、`rationale`、必要的 `evidence_refs`、`unknowns` 和待确认事项。
- 适用时附交接结果引用；不生成独立 Triage Artifact。

## Error Handling / Stop Conditions

- 业务准入信息不足时按 Decision Contract 判断是否需要 Human；不得以工具故障或未经核实的假设作出硬性排除。
- Issue 关键事实冲突、操作权限不明或 `/note` 写入结果未知时，停止受影响操作并回查已有结果，避免重复写入。
- 交接失败或结果未知时，按适用交接契约安全停止与对账，不重复触发。
