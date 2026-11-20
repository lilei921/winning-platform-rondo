# Wayfinder `needs_human` 恢复：单次 Update 端到端验证

> 日期：2026-10-13（Asia/Shanghai）  
> 对照：[WFP-7 状态先行、指派启动](./wayfinder-needs-human-resume-assignment-start-e2e-2026-10-13.md)  
> 判定：**隔离 Workspace 的 `needs_human → eligible → Squad Lead` 单次 Update 分支 PASS**；完整 P01–P10 矩阵和生产级故障恢复仍未验收。

## 1. 目标与隔离对象

只验证一处设计差异：Wayfinder 在评论触发的 Run 中，回读 `eligible` Decision 后，用**一次** `multica issue update` 同时将 `blocked + Wayfinder` 变更为 `todo + Squad`，并自动创建唯一 Lead Run。不得分开执行 `issue status`、`issue assign` 或人工 `rerun`。

- 隔离 Workspace：`Wayfinder Resume POC 2026-10-13`，UUID `ce606e9f-253a-4819-90d7-aa447a3431a5`；Multica CLI 0.6.1，commit `2ea01ae4e`。
- Issue：`WFP-8`，UUID `01a133ac-39a6-7ba7-8455-b2a50f0185c1`；虚拟来源 `POC-WI-008`、`Fixture System H`、`fixture-repo-H`。没有访问真实 TFS、Repository、PR 或生产 Agent。
- Wayfinder：`27d02f0b-d1dd-49ea-962a-1dc3765a0abf`；目标 Squad：`59debd72-213c-41cc-82a9-2ad8da9df675`；Lead：`7b1b0fae-bad8-4ceb-af4f-1b73ff42299e`。
- Workspace Autopilot 与 `WFP-8` Wakeup 列表为空；Codex Runtime 在线。

## 2. Comment、Update 与 Run 证据

| 顺序 | 实际回读 |
|---|---|
| 基线 | `WFP-8` 以 `backlog + Wayfinder` 创建。初始顶层 `/note` Decision `01a133ac-bcf1-7d4c-99d3-d320c9441ffb` 为 `needs_human`；停放 `blocked --no-start` 后 Issue revision 4，Run 列表为空。 |
| 真实 Mention | Human 从 UI 建议列表选择 Wayfinder；顶层 Comment `01a133ad-94fc-7b7e-9bb6-7920fa8cbd9e` 持久化 `mention://agent/27d02f0b-d1dd-49ea-962a-1dc3765a0abf`。只创建 Wayfinder 评论 Run `01a133ad-9506-7b04-99c1-46005f5bcf10`；Issue 仍为 `blocked + Wayfinder`。 |
| 新 Decision | Wayfinder 于 `05:13:51Z` 在触发 Comment 线程发布 `/note` 回复 `01a133ae-6b76-716e-906e-495550fc6e3e`，`parent_id` 指向 Human Comment，`source_task_id` 指向 Wayfinder Run。内容含 `decision=eligible`、虚拟来源版本、三项补齐证据、旧 Decision 的 `supersedes`、Human Comment 的 `resume_ref`。线程回读成功；Note 后 Issue revision 为 6，仍是 `blocked + Wayfinder`，没有额外 Run。 |
| **单次 Update** | Run 工具记录只有一次写入命令：`multica issue update WFP-8 --status todo --assignee-id 59debd72-213c-41cc-82a9-2ad8da9df675 --workspace-id ce606e9f-253a-4819-90d7-aa447a3431a5 --output json`，**没有** `--no-start`。未调用单独的 `issue status` / `issue assign` / `issue rerun`。Update 回读 revision 7、`status=todo`、`assignee=Squad`。 |
| 派工 | Issue 时间线在同一个 `05:14:03Z` 记录 `blocked → todo` 与 Wayfinder → Squad；同秒自动创建唯一 Lead Run `01a133ae-9cd0-7901-8212-5df5d674fc29`。Lead 于 `05:14:04Z` 开始，`05:15:24Z` 完成并回报 Run ID。Wayfinder Run 于 `05:14:53Z` 完成。最终 Run 列表恰有一条 Wayfinder、一条 Lead，Issue 为 `todo + Squad`。Lead 顶层回报 Comment `01a133af-b7cc-70bc-a9fe-c6267b799ed1` 将最终 Issue revision 增至 8。 |

此次仅观察到一次 Update 请求和一次 Issue revision 变更（6→7）同时带来两个字段的新值；时间线虽分别列出 Status 与 Assignee 事件，但没有单独的 `todo + Wayfinder` Issue revision 或独立写请求。此 POC 支持“单次 Update 消除前次两步交接中可回读的中间状态”的设计判断；它不单凭外部读数证明服务器内部事务隔离的所有性质。

## 3. 判定与剩余边界

**单次 Update 的本次端到端分支 PASS。** 真实 UI Mention、`/note` 回复持久化和回读、一次状态加指派 Update、自动创建且完成的唯一 Lead Run，均有实际 Issue / Comment / Run / 工具命令证据。相较 `WFP-7`，它少一次 Issue 写请求，不留下可回读的 `todo + Wayfinder` 中间 revision。

- Lead 在 Wayfinder 完成前启动，两条 Run 约重叠 49 秒；Run 工具记录没有 Wayfinder 在 Update 后继续写交付事实。单次 Update **没有消除跨 Agent Run 重叠**。
- 如果 Update 返回超时或未知，仍须先回读 Decision、Issue revision、Owner/Status 与 Run 再决定动作；本次未注入此类故障，不能宣称故障恢复已通过。
- 重复 Mention/编辑、`tfs.changed_at` 变更、Runtime/Access 故障和 `unsupported` 终态仍未验证。隔离 Workspace 使用虚拟事实，不构成正式 TFS 或 Repository 权限验收。
- 原方案要求恢复 Decision 为顶层 `/note`；已验证的评论触发 Run 只能将 Decision 写作触发线程的回复。设计文档和 `workitem-triage` 的 Decision 检索与写入规则仍需同步修订。
- **正式 Workspace 首次启动仍需单独验收**：本轮起点是 `blocked + Wayfinder`。[WFP-9](./wayfinder-first-todo-to-squad-2026-10-13.md)验证了 direct Run 的首次改派；[WFP-10](./wayfinder-todo-ui-mention-to-squad-2026-10-13.md)在同一隔离 Workspace 补充真实 UI Mention、正确 `/note` 回复和 `todo + Wayfinder → todo + Squad` 的唯一 Lead Run，但均未使用正式配置。在正式配置的隔离测试 Issue 上，应先回读有效且格式正确的 Decision、当前 Owner/Status 与空的 Lead Run 列表，再由 Wayfinder 执行一次不带 `--no-start` 的 Status/Assignee Update；回读更新前后 Issue revision、时间线与 Lead Run，要求目标 Squad 的 Lead 恰好自动启动一次，且无人工 `rerun` 或重复派工。失败或结果未知时先对账，不得凭 `todo + Squad` 字段宣称启动成功。

因此推荐把**回复式 Decision + 单次 `issue update --status todo --assignee-id <Squad>`**作为后续设计候选，并补齐剩余验收项后再考虑正式 Workspace 部署。
