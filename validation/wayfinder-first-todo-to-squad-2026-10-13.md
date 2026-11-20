# 首次 `todo + Wayfinder → todo + Squad` 自动启动验证

> 日期：2026-10-13（Asia/Shanghai）  
> 环境：隔离 Workspace `Wayfinder Resume POC 2026-10-13`（`ce606e9f-253a-4819-90d7-aa447a3431a5`）；Multica CLI 0.6.1 / commit `2ea01ae4e`  
> 判定：**首次自动派工路径 PASS**；正式 Workspace 验收仍未执行。首次 Decision Comment 的 `/note` 格式在本轮未满足。

后续 [WFP-10 UI Mention 重测](./wayfinder-todo-ui-mention-to-squad-2026-10-13.md)在 `todo + Wayfinder` 基线上取得真实 Mention、正确 `/note` 回复和唯一 Lead Run 的端到端证据；本文件保留 WFP-9 direct Run 的原始结果。

## 范围与基线

本轮只验证首次准入时，Wayfinder 在已有 `todo + Wayfinder` 上用**一次** `issue update --status todo --assignee-id <Squad>` 改派后，目标 Lead 是否自动启动一次。与前轮 `WFP-8` 从 `blocked + Wayfinder` 恢复的路径不同。

- Issue `WFP-9`：`01a133cd-777c-7815-b842-d79254ec1902`；虚拟来源 `POC-WI-009`、`Fixture System I`、`fixture-repo-I`，描述中预置完整的虚拟范围、负责人和只读授权事实。
- Wayfinder：`27d02f0b-d1dd-49ea-962a-1dc3765a0abf`；Squad：`59debd72-213c-41cc-82a9-2ad8da9df675`；Lead：`7b1b0fae-bad8-4ceb-af4f-1b73ff42299e`。仅用隔离 Agent 与 Runtime；不访问真实 TFS、业务仓库、PR 或 OpenSpec。
- `WFP-9` 以 `backlog + Wayfinder` 停放，初始 Comment、Run、Issue Wakeup 为空；Workspace Autopilot 为空。Wayfinder 指令限定只处理 `WFP-9`，禁止 `in_progress` 和重复副作用。

## 实际回读

| 顺序 | 证据 |
|---|---|
| 首次启动 Wayfinder | 成员执行一次 `issue status WFP-9 todo`，**不带** `--no-start`。Issue revision 3 回读为 `todo + Wayfinder`；仅创建首个 Wayfinder direct Run `01a133ce-5972-74fa-9aec-85367e71e1ff`（`05:48:43Z` 创建，`05:48:45Z` 开始）。未借助 Human Comment/Mention 或 `rerun`。 |
| Decision | Wayfinder 以顶层 Comment `01a133cf-3c1c-7a0d-8586-2db70792a5d7`（`05:49:41Z`）写入 `decision=eligible`、虚拟来源版本、授权依据及目标 Squad，回读后 Issue revision 4 仍为 `todo + Wayfinder`，Run 列表没有新增 Wayfinder Run。**偏差：Comment 内容以 `Triage Decision v1` 开头，没有要求的 `/note` 前缀；不得把本轮计为 `/note` 静默性验证。** |
| 单次改派 | Wayfinder Run 工具记录仅一次变更命令：`multica issue update WFP-9 --status todo --assignee-id 59debd72-213c-41cc-82a9-2ad8da9df675 --workspace-id ce606e9f-253a-4819-90d7-aa447a3431a5 --output json`，没有 `--no-start`，也没有分开的 `status`、`assign` 或 `rerun` 写入。`05:49:54Z` Issue revision 5 回读为 `todo + Squad`；时间线仅新增 Wayfinder → Squad 的 `assignee_changed`，Status 原本已是 `todo`。 |
| Lead 自动启动 | 改派同秒创建唯一 Lead direct Run `01a133cf-6fac-7265-8cb1-def606f361f1`，`05:49:55Z` 开始，`05:50:59Z` 完成并回报 Run ID。Wayfinder Run 于 `05:50:12Z` 完成。最终 Run 列表只有这两条已完成 Run，Issue 保持 `todo + Squad`；Lead 评论为 `01a133d0-4061-7d82-962b-8d76996bbf2e`。 |

Lead 与 Wayfinder Run 约重叠 17 秒。Wayfinder 工具记录在单次 Update 后只有 Run 回读，没有继续写交付事实。本测试观察到预期的**首次自动启动恰好一次**，没有人工补启动。

## 结论边界

隔离环境中的首次 `todo + Wayfinder → todo + Squad` 自动启动 **PASS**。这一结果补足了 `WFP-8` 未覆盖的起点，并支持以单次 Status/Assignee Update 作为首次交接的唯一启动动作。

正式 Workspace 仍须用其实际 Agent/Squad/Runtime 配置和隔离测试 Issue 重验同一起点、Decision 持久化、一次 Update、唯一 Lead Run 与失败对账。`WFP-9` 的 Decision 缺少 `/note` 前缀，正式验收必须单独检查 Comment 内容和不会意外唤醒 Agent；本轮不能代替生产配置、真实 TFS 来源、重复触发或故障恢复验收。
