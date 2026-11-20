# Wayfinder `needs_human` 恢复 POC 实测记录

> 执行日期：2026-10-13（Asia/Shanghai）  
> 对应方案：[wayfinder-needs-human-resume-poc.md](./wayfinder-needs-human-resume-poc.md)  
> Exit Gate：**FAIL**。真实 Mention 可以唤醒 Wayfinder，但评论触发的 Run 不能写方案要求的顶层 `/note` Decision，因而不能完成该版端到端交接。

后续针对 `/note` 回复和自动启动的重测见[同日重测记录](./wayfinder-needs-human-resume-revalidation-2026-10-13.md)；本文件保留首次 POC 的原始判定。

## 1. 环境与隔离边界

| 项目 | 实测事实 |
|---|---|
| CLI | `multica 0.6.1`，commit `2ea01ae4e`，build `2026-10-01T10:25:57Z` |
| Server commit / Daemon | Server commit 未取得；Desktop 管理的 Codex Runtime 在线并实际完成 Run。单独执行 `multica daemon status` 显示 `stopped`，不能据此推断 Desktop Runtime 离线。 |
| 隔离 Workspace | `Wayfinder Resume POC 2026-10-13`，`ce606e9f-253a-4819-90d7-aa447a3431a5`，Issue 前缀 `WFP` |
| Agent / Squad | Wayfinder `27d02f0b-d1dd-49ea-962a-1dc3765a0abf`；Lead `7b1b0fae-bad8-4ceb-af4f-1b73ff42299e`；Squad `59debd72-213c-41cc-82a9-2ad8da9df675` |
| Runtime | Codex `1d37b0bc-73a0-4b17-bf18-cef114f70009`，创建时及执行中在线 |
| 自动触发 | Workspace 的 Autopilot 列表为空；`WFP-1`、`WFP-2` 的 Issue Wakeup 列表为空。未访问正式 Workspace 的业务 Issue。 |
| 来源与权限 | `POC-WI-001` 等均为虚拟来源；仓库名、Owner 与授权均为测试文本，未连接真实 TFS 或测试 Repository，也未创建 PR。 |

## 2. 核心证据

### 真实 Mention 与失败的 Decision 写入

1. `WFP-1`（`01a13338-f225-76da-b7c2-b07bbde01308`）以 `backlog + Wayfinder` 创建。初始顶层 `/note` Decision `01a13339-1f4b-7468-b752-9076c516fd11` 回读成功；改为 `blocked --no-start` 后 Run 列表为空。
2. Human 在 UI 建立真实 Agent Mention，发送前 Trigger Preview 仅显示 `POC Wayfinder 20261013`。回读的顶层 Human Comment `01a1333b-3b71-71ff-81a7-ea5be965ff1a` 包含 `mention://agent/27d02f0b-d1dd-49ea-962a-1dc3765a0abf`。仅创建 Wayfinder Run `01a1333b-3b7d-78a2-acb7-ae724997d932`；Mention 本身未改 Owner 或 Status。
3. Wayfinder 在 Run 中判断测试回复覆盖了初始 Decision 的三个缺口，但执行顶层 Comment 写入时收到原始错误：`Request conflict: comment-triggered tasks cannot create top-level comments; set parent_id (--parent) to 01a1333b-3b71-71ff-81a7-ea5be965ff1a or a coalesced comment id`。
4. Agent 将错误回复在触发线程（Comment `01a1333c-460d-71fe-b701-e84303409cd5`），未发布新 Decision，也未交接。最终回读仍为 `status=blocked`、`assignee=POC Wayfinder`；`WFP-1` 没有 Lead Run。

这与本机 `multica issue comment add --help` 的限制一致：评论触发的 Agent Run 必须用 `--parent` 回复触发评论。初始 Decision 由成员在 Run 外创建，不能证明恢复 Run 也能创建顶层 Decision。

### 普通评论、证据不足与静默 Note

- `WFP-2`（`01a13339-e0f5-7e24-b903-d8d25c193ecd`）的普通顶层咨询 Comment `01a1333a-5341-7cb6-b48a-462a6f6ac4ff` 启动 Wayfinder Run `01a1333a-5351-7ea0-b3a5-ed5d1f9c48c4`。Agent 回复缺少具名 Owner 和访问批准；Issue 保持 `blocked + Wayfinder`，没有 Squad Run。
- 显式要求重新评估但证据仍不足的 Comment `01a1333d-289a-7c43-9458-cf7be4d61014` 启动 Run `01a1333d-28a9-711a-bba9-003e34864a8d`。Agent 说明范围、Owner、访问批准仍缺失，继续阻塞。
- `WFP-2` 额外收到一条指向 `Fixture System B / POC-WI-001` 的真实 Mention Comment `01a1333c-0f32-73d5-83b0-744aa78d7cfa`。对应 Run `01a1333c-0f3f-7532-a6bb-dee029639aa3` 识别其与本单 `Fixture System C / POC-WI-002` 不匹配，未放行。
- 成员写入顶层 `/note` 探针 `01a1333b-f818-7920-b2cc-b896146cc4c7` 后，Run 列表未因该 Note 新增 Run；事后 Wakeup 列表仍为空。未取得 UI 的空 Trigger Preview 截图，因此 P10 仅为部分验证。

### 交接顺序的独立组件验证

`WFP-3` 和 `WFP-4` 的 `eligible` `/note` 由 POC 操作员明确标注为 **COMPONENT FIXTURE, not Agent Decision**；下表只证明 Multica 状态与派工机制，不构成 Wayfinder 端到端通过。

| Issue | 顺序及回读 | Lead Run |
|---|---|---|
| `WFP-3` / `01a1333d-c086-7e3d-b64d-85660f47b1df` | Note `01a1333d-faf8-7f3c-a031-0776b784a070` 回读；`blocked → backlog --no-start → Squad --no-start` 后无 Run；人工改 `todo` 后才启动 | 唯一 Run `01a1333f-49a1-733c-b9a4-71e46ce76f90`，已完成 |
| `WFP-4` / `01a1333d-c9c0-77ea-bbd7-841f126b7dfb` | Note `01a1333e-0183-7ed9-9f47-65b21e7a905b` 回读；两次 `--no-start` 后无 Run；一次 `backlog → todo` 启动 | 唯一 Run `01a1333f-0c12-7b22-b515-7c73f74cef21`，已完成 |

对隔离 Workspace 用非法但格式有效的 `poc_invalid` 状态 Key 查询，可用值只有 `backlog, todo, in_progress, in_review, blocked, done, cancelled`；没有方案要求的 `unsupported` 自定义终态，因此 P07 的前置条件不成立。

## 3. 测试矩阵

| ID | 结果 | 依据与限制 |
|---|---|---|
| P01 | **PASS** | UI 真实 Mention、单一 Wayfinder Run、Owner/Status 不变，见 `WFP-1`。 |
| P02 | **PASS** | 普通咨询触发 Run，但维持 `blocked` 且未启动 Squad，见 `WFP-2`。 |
| P03 | **PARTIAL** | Agent 将虚拟 Human 信息与既有 Decision 比较，认定缺口已覆盖；未读取真实 TFS/Repository，不能证明生产证据时效与增量探索。 |
| P04 | **FAIL** | 评论触发的 Wayfinder Run 被拒绝创建顶层 `/note`，无法持久化并回读新 Decision；`WFP-4` 仅证明后续派工顺序可用。 |
| P05 | **COMPONENT PASS** | `WFP-3` 在 `backlog` 无 Run，人工启动后仅一个 Lead Run；未由 Wayfinder Decision 引出。 |
| P06 | **PARTIAL** | 证据不足时继续 `blocked + Wayfinder` 并解释缺口；顶层新 Decision 受同一限制未持久化。 |
| P07 | **BLOCKED** | 隔离 Workspace 无 `unsupported` 自定义终态，未执行该分支。 |
| P08 | **NOT_RUN** | 未覆盖多次有效 Mention、编辑 Mention 或有效交接幂等；顶层 Decision 障碍先阻断该链路。 |
| P09 | **NOT_RUN** | 未模拟有效准入判定后的 `tfs.changed_at` 更新；跨 Issue 来源不匹配已被识别，但不等同于该场景。 |
| P10 | **PARTIAL** | 无 Issue Wakeup/Autopilot，CLI `/note` 未新增 Run；未取得 UI 空触发预览。 |
| P11 | **NOT_RUN** | 未注入持久化后 Assignment/Status 失败。 |
| P12 | **NOT_RUN** | 未注入 Access、Runtime 离线或交接 Run 重叠故障。 |

## 4. 判定与修正方向

**当前方案不能按原样上线。** `P01–P10` 核心必过条件中 P04 已实测失败，P07 前置配置缺失。安全停止逻辑有效：失败后 `WFP-1` 未写入新 Decision、未改派、未启动 Squad。

最小修正候选是将重新准入 Decision 写为触发 Human Comment 线程下的 `/note` **回复**（必须带 `--parent`），并调整“最新有效 Decision”的发现与回读规则；其静默性、引用关系和随后交接仍须另行实测。若必须坚持顶层 Comment，则需要由不处于 comment-triggered Run 上下文的确定性执行入口写入，并明确 Agent 与写入者的身份、权限和幂等边界。两种候选目前均**未验证通过**。

本次没有修改正式 TFS、正式 Workspace 的业务 Issue、业务子仓、PR 或生产 Agent。隔离 Workspace 与 `WFP-1` 至 `WFP-4` 保留供复核。
