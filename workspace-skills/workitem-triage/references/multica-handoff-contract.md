# Multica Issue 准入结果交接契约

本契约适用于当前 Multica Delivery 入口；准入语义与 `/note` 内容遵循 [Decision Contract](decision-contract.md)。Wayfinder 负责专业准入判断和发布 `/note`，`rondo` 负责 `eligible` 后的确定性目标映射与交接。

## 交接前提

- 仅在当前 Issue 的准入结论为 `eligible` 且本轮 `/note` 已写入并回读成功后，调用 `rondo delivery handoff`。CLI 不重新解析准入结论、不要求机器可读 Decision 或 Evidence。
- 当前 Issue 必须属于 TFS 准入入口；不得覆盖其他已进入有效处理流程的 Owner / Status。
- 交接前若发现 TFS 来源发生可能影响准入的实质变化，由 Wayfinder 复核其专业结论；CLI 只消费 Issue 中当前的 `tfs.type` 来源事实。

## 交接动作

- `eligible`：Wayfinder 调用 `rondo delivery handoff --config <本 Skill 目录>/config/repo-registry.json --issue <当前 Issue>`。CLI 内部依据 `tfs.type` 确定唯一的目标 Agent / Squad、核对当前 Workspace 身份，并通过**一次** Multica Issue Update 设置 `status=todo` 与 `assignee=<目标 ID>`；不使用 `--no-start`。Wayfinder 不自行查询目标 ID、手工改派或重复发启动信号。
- `needs_human`：保持 Wayfinder Agent 为负责人，设置 `status=blocked`（不启动），说明待确认问题和恢复条件。
- `unsupported`：保持 Wayfinder Agent 为负责人；实际需要写入时核对 `unsupported` Status 的 Category 为 `closed`，再更新状态（不启动）；不修改原 TFS Work Item。

## 回读与恢复

- CLI 回读 Issue 的目标 Owner、Status 及原生 Assignment Trigger 创建的下游 Run（Bug Fix Agent 或 Delivery Lead）。`PASS / NOOP` 表示交接已确认；Run 仅被创建或排队，不等于执行完成。
- CLI 返回 `FAIL / UNKNOWN` 时停止受影响动作，记录原因；写入响应丢失或已指派但 Run 未确认时，先回读对账，不重新执行 Update。已完成的交接不得把下游 Issue 重置为 `todo`。
- `/note` 发布失败或结果未知时，Wayfinder 先回读 Comment，不调用交接命令。仅恢复已有有效 Decision 的交接时，不重复发布 Comment。
- Human 在原 Issue 补充信息并将 Status 改为 `todo`，保留 Wayfinder Agent Assignee，由 Multica 原生状态触发重新准入；必要时仅增量复核证据，不另建 Issue。
