---
name: change-handoff
description: 需求变更获批后，在当前 Issue 登记获批版本并发布实施请求。
---

# 研发交接

使用本 Skill 的 `config/repo-registry.json`。Multica CLI 沿用配置中的连接信息，工作区取 `runtime.workspace_id`。

## 核对批准依据

确认 `analysis.gate.result=PASS`。根据当前 Issue 的人工批准评论，核对获批 Change 和版本分别与 `analysis.change_ref`、`analysis.source` 一致，并确认批准人对独立验收的决定。

需要核对工程内容时，使用 `rondo analysis read --config "<配置绝对路径>" --issue <issue> --file proposal.md` 读取获批版本的 Proposal，其他工件按需读取。批准意见含糊、版本不符或所需工件读取失败时，停止并说明具体原因。

## 登记批准记录

将以下字段作为 JSON 字符串写入当前 Issue 的 `analysis.human_approval`：

- `decision` 固定为 `approved`。
- `by`、`at`、`comment_ref` 分别取批准人、批准时间（ISO 8601）和批准评论 ID。
- `verify_agent_required` 取批准人确认的布尔值。
- `source` 取获批版本的 `repo_url`、`branch`、`commit`（完整 SHA）和 `change_ref`。

已有记录与本次批准完全一致时直接复用。写入后回读，确认整条记录与本次批准一致后再继续。

## 发布实施请求

1. 检查同一获批版本的交接评论和 Run。已有有效交接时，直接返回原评论引用。
2. 首次获批且 Issue 处于 `analysis_review` 时，使用 `--no-start` 更新为 `in_progress` 并回读确认。Issue 已处于 `todo` 或 `in_progress` 时沿用当前状态。其余情况或状态写入未确认时，停止并说明原因。
3. 发布前确认当前 `analysis.source` 仍与批准记录的 `source` 一致。在当前 Issue 使用原生 `@Engineer` Mention 发布实施请求，附上 `change_ref`、批准评论引用及适用的附加条件。实施范围引用获批 Proposal。

发布成功后返回评论引用。操作中断或结果不明时，先回读当前记录，只补未完成项。
