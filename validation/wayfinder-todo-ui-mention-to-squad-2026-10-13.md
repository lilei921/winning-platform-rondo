# `todo + Wayfinder → todo + Squad`：真实 UI Mention 端到端验证

> 日期：2026-10-13（Asia/Shanghai）  
> 环境：隔离 Workspace `Wayfinder Resume POC 2026-10-13`（`ce606e9f-253a-4819-90d7-aa447a3431a5`），Multica CLI 0.6.1 / commit `2ea01ae4e`  
> 判定：**本隔离环境的 UI Mention → Wayfinder 评论 Run → `/note` Decision → 单次改派 → 唯一 Lead Run 分支 PASS**。正式 Workspace 的配置验收仍未执行。

## 目标与基线

前轮 [WFP-9](./wayfinder-first-todo-to-squad-2026-10-13.md) 通过 `backlog → todo` 启动首个 Wayfinder direct Run，验证了首次改派；本轮 `WFP-10`（`01a133d8-3327-715d-b618-36a233f7a072`）补足**真实 UI Mention 启动评论 Run**的端到端证据。

`WFP-10` 使用虚拟 `POC-WI-010`、`Fixture System J` 和 `fixture-repo-J`，无真实 TFS、Repository、代码、PR 或 OpenSpec 操作。Wayfinder `27d02f0b-d1dd-49ea-962a-1dc3765a0abf`、目标 Squad `59debd72-213c-41cc-82a9-2ad8da9df675`、Lead `7b1b0fae-bad8-4ceb-af4f-1b73ff42299e` 均为隔离测试对象。

先以 `--no-start` 指派 Wayfinder，再以 `--no-start` 把 Issue 停在 **`todo + Wayfinder`、revision 3**；初始 Comment、Run、Issue Wakeup 为空，Workspace Autopilot 为空，Codex Runtime 在线。此状态准备不算自动触发证据。

## 回读证据

| 顺序 | 实际事实 |
|---|---|
| UI Mention | Human 在 UI 从建议列表选择 `POC Wayfinder 20261013`，发送前确认 Trigger Preview 仅显示该 Agent。顶层 Comment `01a133d9-f93f-724d-9e81-969c2ff65786` 回读含真实 `mention://agent/27d02f0b-d1dd-49ea-962a-1dc3765a0abf`；仅创建 Wayfinder **comment** Run `01a133d9-f94c-7753-ad17-26e740375d8f`（`06:01:25Z` 创建），Issue 仍为 `todo + Wayfinder`。 |
| Decision | Wayfinder 在该触发评论下写入回复 `01a133db-3900-7165-919f-2f117eda107d`（`06:02:47Z`）；内容以 `/note` 开头，含 `decision=eligible`、虚拟来源时间、Human 提供的范围/负责人/只读授权依据及启动策略。`parent_id` 等于 Human Comment ID，`source_task_id` 等于 Wayfinder Run ID。线程回读后 Issue 为 revision 5、`todo + Wayfinder`，没有额外 Run。 |
| 唯一改派 | Wayfinder Run 工具记录只有一次写入命令 `multica issue update WFP-10 --status todo --assignee-id 59debd72-213c-41cc-82a9-2ad8da9df675 --workspace-id ce606e9f-253a-4819-90d7-aa447a3431a5 --output json`，**不带 `--no-start`**；没有单独的 `issue status`、`issue assign` 或 `issue rerun`。`06:03:08Z` 回读 Issue 为 revision 6、`todo + Squad`。时间线只新增 Wayfinder → Squad 的 `assignee_changed`，Status 始终为 `todo`。 |
| Lead | 改派同秒自动创建唯一 Lead Run `01a133db-8a46-758a-9d84-26f6a05e6566`，`06:04:15Z` 完成并回报其 Run ID；Lead 顶层评论 `01a133dc-6619-7687-99a7-28989cca89ae`。Wayfinder Run 于 `06:03:30Z` 完成。最终 Run 列表仅此两条已完成 Run，Issue 仍为 `todo + Squad`；活动 Run 和 Wakeup 列表均为空。 |

Lead 于 `06:03:08Z` 启动，Wayfinder 到 `06:03:30Z` 才完成，约有 22 秒 Run 重叠。Wayfinder Run 的工具记录在单次 Update 后没有进一步写入交付状态。

## 判定与限制

**本次测试环境中的指定端到端路径 PASS。** 真实 UI Mention、评论触发 Run、正确格式且可回读的 `/note` Decision 回复、`todo + Wayfinder → todo + Squad` 的单次 Update、自动且唯一的 Lead Run 均由 Issue / Comment / Run / 工具命令交叉证明，无人工 `rerun`。

此 Issue 的 `todo + Wayfinder` 起点由 `--no-start` 预置，因此它证明的是**在该起点接受 UI Mention 后的首次 Squad 自动启动**；不是正式 Workspace 的 TFS Sync 初始化、真实 TFS 事实或真实 Repository 权限验收。重复 Mention、更新结果未知、故障恢复和跨 Agent Run 重叠控制也仍需单独验证。
