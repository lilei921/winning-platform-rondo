---
name: workitem-triage
description: 对 Issue 进行准入评估，基于可信证据形成准入结论并通过 /note 记录；适用于首次评估或重新评估。
---

# Workitem Triage

## Inputs

- 当前 Issue、来源版本、适用准入规则及授权；已有 Comment、Decision 和证据。
- 已绑定目标 Workspace 的 `multica`（Issue、评论及状态读写）、`rondo`（交接）和必要工程资料访问权限。
- 执行交接时，使用本技能 `config/repo-registry.json` 的绝对路径；配置缺失或不可访问时停止交接。

## Assessment

按 [Decision Contract](references/decision-contract.md) 核实当前来源和已有 Decision 的有效性，只补查影响准入的缺失、变化或冲突事实。形成 `eligible`、`needs_human` 或 `unsupported` 结论，说明依据和未决项；暂缺证据或工具故障不等于 `unsupported`。证据足以判断准入时停止调查。

无重新评估触发且已有有效 Decision 时直接复用。明确要求重新评估，或出现来源、授权、证据变化及约定的恢复触发时，增量复核受影响结论。仅恢复交接时不重复调查或发布 Decision。

## Publication & Handoff

1. 写入前复核 Issue 身份、相关内容、来源版本及权限；有实质变化时先修正结论。
2. 按 Decision Contract 发布 `/note`。有明确 Human 补充 Comment 时回复对应线程，否则使用顶层 Comment；回读 Comment ID、内容及适用的 `parent_id`。仅恢复交接时，核实已有有效 `/note`。
3. 核对本技能的 [Handoff Contract](references/multica-handoff-contract.md)。适用且 `eligible`、`/note` 已回读确认时执行：

   ```bash
   rondo delivery handoff --config "<本技能目录>/config/repo-registry.json" --issue <KEY>
   ```

   `needs_human`、`unsupported` 的状态处理按该契约执行；不适用交接时只交付 Decision。交接目标与结果核验由命令负责，不手工改派或重复触发。

## Output

返回 Decision 引用、准入结论、关键理由和未决项；执行交接时附实际结果与 Run 引用。不生成独立准入报告。

## Validation & Stop Conditions

- Decision 符合准入契约，事实可追溯，未知项和限制已说明。
- `/note` 发布或回读未确认时不交接；先查询已有结果，不重复发布。
- 交接须取得退出码 `0` 且 `PASS / NOOP`；Run 创建或排队不代表任务完成。
- 关键事实冲突、权限不明或操作返回 `FAIL / UNKNOWN` 时停止受影响操作，说明原因及恢复条件，不猜测成功或重放未确认的写入。
