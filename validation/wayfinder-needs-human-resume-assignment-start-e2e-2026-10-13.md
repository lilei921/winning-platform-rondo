# Wayfinder `needs_human` 恢复：指派启动端到端重测

> 日期：2026-10-13（Asia/Shanghai）  
> 前序证据：[首次 POC](./wayfinder-needs-human-resume-poc-result-2026-10-13.md) · [回复式与状态启动重测](./wayfinder-needs-human-resume-revalidation-2026-10-13.md)  
> 判定：**隔离 Workspace 的 `needs_human → eligible → Squad Lead` 指派启动分支 PASS**；原方案要求的全部 P01–P10 和生产级故障恢复尚未验收。

后续的 [WFP-8 单次 Update 对照](./wayfinder-needs-human-resume-single-update-e2e-2026-10-13.md) 已通过同一 `eligible` 分支，且只用一次 Issue 写请求；本文件保留 WFP-7 两步交接的实测事实。

## 1. 本次验证的变更

前次 `WFP-5` 已证实：评论触发 Run 可以写 `/note` 回复并交接 Owner，但 `backlog --no-start → Squad --no-start → todo` 未自动创建 Lead Run。`WFP-6` 的成员 CLI 组件测试证实，在 `todo` 下**不带 `--no-start` 指派 Squad**会立即创建 Lead Run。

本次新建隔离 Issue `WFP-7`（`01a1336d-5deb-7d2d-ae19-1ac443012868`），由**评论触发的 Wayfinder Run 自身**按下列顺序执行，验证完整恢复链：

```text
Human UI 真实 Mention
→ Wayfinder 增量重评估
→ 触发评论下 /note Decision 回复并回读
→ todo --no-start（Wayfinder Owner）并回读，无新 Run
→ 指派 Squad（不带 --no-start）并回读，作为唯一 Lead 启动动作
```

Workspace `ce606e9f-253a-4819-90d7-aa447a3431a5`，Multica CLI 0.6.1 / commit `2ea01ae4e`；Wayfinder `27d02f0b-d1dd-49ea-962a-1dc3765a0abf`，Squad `59debd72-213c-41cc-82a9-2ad8da9df675`，Lead `7b1b0fae-bad8-4ceb-af4f-1b73ff42299e`。无 Autopilot 或 `WFP-7` Wakeup；Runtime 在线。`POC-WI-007`、`Fixture System G` 和 `fixture-repo-G` 均为虚拟测试事实，未访问真实 TFS、业务仓库或 PR。

## 2. 可回读证据

| 顺序 | 事实 |
|---|---|
| 基线 | `WFP-7` 以 `backlog + Wayfinder` 创建。初始顶层 `/note` Decision `01a1336d-e384-7e74-a077-b3b80ed15bfd` 记录 `needs_human` 和三个缺口；停放 `blocked --no-start` 后 Run/Wakeup 均为空。 |
| UI Mention | Human 在 UI 选择 `POC Wayfinder 20261013`；顶层评论 `01a1336e-c27e-7025-a1d5-fac9dc67cc12` 回读含 `mention://agent/27d02f0b-d1dd-49ea-962a-1dc3765a0abf`。仅启动 Wayfinder 评论 Run `01a1336e-c28b-7e32-a3e2-53e5ccb606fa`，Mention 本身没有改变 `blocked + Wayfinder`。 |
| Decision | `04:05:05Z`，Wayfinder 写入 `/note` 回复 `01a1336f-77d8-7025-b69c-848ced403418`；`parent_id` 为上述 Human 评论，`source_task_id` 为 Wayfinder Run；内容含 `decision=eligible`、虚拟来源时间、三项补齐证据、初始 Decision 的 `supersedes` 和 Human 评论的 `resume_ref`。线程回读成功，未因此新增 Run。 |
| 状态先行 | Wayfinder Run 消息中的实际命令为 `issue status WFP-7 todo --no-start`。时间线于 `04:05:21Z` 记录 `blocked → todo`；此时仍由 Wayfinder 持有，未新增 Run。 |
| 指派启动 | 实际命令为 `issue assign WFP-7 --to-id 59debd72-213c-41cc-82a9-2ad8da9df675`，**没有** `--no-start`。时间线于 `04:05:34Z` 记录 Wayfinder → Squad；同秒自动创建唯一 Lead Run `01a1336f-e887-7124-bb36-953830a11fd9`。没有人工 `rerun`。 |
| 最终回读 | Wayfinder Run 于 `04:05:51Z` 完成；Lead Run 于 `04:06:50Z` 完成并回报自身 Run ID。`issue runs` 仅有这两条 Run；Issue 保持 `todo + Squad`，Lead 评论为 `01a13370-e911-7c31-ad64-66a3678110b5`。 |

Wayfinder 的实际 CLI 工具记录中，`/note` 写入为 `issue comment add ... --parent <Human Comment ID>`；`todo` 命令有 `--no-start`，Squad 指派命令没有。Status/Owner 时间线、Comment 线程和 Run 列表与这些命令一致。Lead 在 `04:05:35Z` 开始，Wayfinder 到 `04:05:51Z` 才完成，存在约 16 秒的 Run 重叠；回读未见 Wayfinder 在指派后继续写交付事实。

## 3. 结论与边界

**本次 `eligible + 指派启动` 端到端分支 PASS。** 真实 UI Mention、Wayfinder `/note` 回复持久化及回读、单次 Squad 指派自动启动、唯一 Lead Run 均有实际 Comment/Issue/Run 证据。它消除了前两轮在同一分支上的顶层评论写入障碍和状态启动缺口。

此结果不能直接升级为整个方案或生产级 PASS：

- 原方案仍规定恢复 Decision 写在**顶层**，而已验证的评论触发 Run 必须写在 Human 触发线程下；“最新有效 Decision”的查询需覆盖回复。
- `todo --no-start` 到 Squad 指派之间有短暂 `todo + Wayfinder` 中间态。若指派失败，需先回读并对账，不能把仅有 `todo` 误报为已交接。
- Wayfinder 与 Lead Run 短暂重叠；跨 Agent 事务、重复 Mention/编辑、来源 `changed_at` 更新、写入结果未知、Runtime/Access 故障等场景仍待验证。
- 隔离 Workspace 仍无 `unsupported` 自定义终态；本次未验证该分支，也未使用真实 TFS/Repository 权限证据。

因此应修订原方案中的 Decision 位置、最新 Decision 检索和唯一启动动作，再补齐剩余 POC 矩阵，之后才可讨论正式 Workspace 部署。
