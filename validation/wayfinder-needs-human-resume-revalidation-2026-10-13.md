# Wayfinder `needs_human` 恢复重测：`/note` 回复与自动启动

> 日期：2026-10-13（Asia/Shanghai）  
> 前次结果：[首次 POC 记录](./wayfinder-needs-human-resume-poc-result-2026-10-13.md)  
> 重测结论：**`/note` 回复持久化与准入交接通过；`auto_start` 未自动创建 Lead Run，端到端 Exit Gate 仍为 FAIL。**

后续将启动动作改为**在 `todo` 下直接指派 Squad**，由 Wayfinder 评论 Run 执行的 [WFP-7 端到端重测](./wayfinder-needs-human-resume-assignment-start-e2e-2026-10-13.md) 已通过该 `eligible` 分支。本文件保留 `WFP-5` 状态启动失败和 `WFP-6` 组件试验的原始判定。

## 1. 隔离对象与变更点

- 沿用隔离 Workspace `Wayfinder Resume POC 2026-10-13`（`ce606e9f-253a-4819-90d7-aa447a3431a5`）、Multica CLI 0.6.1（commit `2ea01ae4e`）、Codex Runtime `1d37b0bc-73a0-4b17-bf18-cef114f70009` 和只回报身份的 Lead `7b1b0fae-bad8-4ceb-af4f-1b73ff42299e`。
- 新建 `WFP-5`（`01a13346-03d8-7606-ac16-69170ed0f3c9`），使用虚拟 `POC-WI-005`、`Fixture System E` 和 `fixture-repo-E`，无真实 TFS/Repository/PR 操作。初始 Decision 是成员发布的顶层 `/note` `01a13346-a12d-73b1-b171-04c7f10f77d5`；回读后停放 `blocked`。
- 本轮候选修正：**评论触发的 Wayfinder Run 把新 Decision 写为触发 Human Comment 下的 `/note` 回复**，带 `--parent`、`supersedes`、`resume_ref`；回读后才交接。它与原方案要求的“顶层 `/note`”不同。
- Workspace 的 Autopilot 和 `WFP-5` Wakeup 均为空。`unsupported` 自定义状态仍未配置；本轮只重测 `eligible + auto_start`。

## 2. UI Mention 与 Agent 身份取证

Human 在 UI 发送前三次均确认 Trigger Preview 只显示所选 Agent。前两次为 `WFP-5` 评论 `01a13348-21ed-7394-b819-7b6acad5151e`、`01a13349-ed96-787b-9890-da5026d8e2a5`；回读发现两条持久化 Mention 均指向旧 Agent UUID `27d02f0b-d1dd-49ea-962a-1dc3765a0abf`，与当时预期的新建 Agent `986ce95e-1296-4631-ae32-cd7d42cf0be7` 不同。对应 Run `01a13348-21f8-755e-9c76-fad4f438e6f2`、`01a13349-eda2-74ae-a411-84db11de5c58` 已取消；取消后回读仍为 `blocked`，未产生新 Decision 或 Lead Run。仅凭现有证据不能断定是 UI、输入操作还是预览与持久化不一致。

为消除目标歧义，将旧 Agent UUID `27d02f0b-d1dd-49ea-962a-1dc3765a0abf` 改为只处理 `WFP-5` 的回复式重测指令，并以 `--no-start` 设为 `WFP-5` Owner。第三次 Human UI 评论 `01a1334b-e04b-7daa-9a43-228d1038bbbb` 持久化了真正的 `mention://agent/27d02f0b-d1dd-49ea-962a-1dc3765a0abf`，仅创建该 Agent 的评论触发 Run `01a1334b-e057-70c3-9c00-7920316aea26`。Mention 当时没有改变 `blocked` 或 Owner。

## 3. Decision 与交接回读

| 顺序 | 事实 |
|---|---|
| 新 Decision | Wayfinder 于 `03:26:56Z` 写入回复 `/note` `01a1334c-8b26-7ca4-a8a6-08613c25b32c`；`parent_id=01a1334b-e04b-7daa-9a43-228d1038bbbb`、`source_task_id=01a1334b-e057-70c3-9c00-7920316aea26`；内容含 `decision=eligible`、来源时间、三个补齐维度、旧 Decision 的 `supersedes` 和 Human 评论的 `resume_ref`。CLI 按线程回读成功。写入后 Issue 仍为 `blocked`，没有因 `/note` 新增 Run。 |
| 停放 | 时间线显示 Wayfinder 于 `03:27:12Z` 将 `blocked → backlog`，命令带 `--no-start`。 |
| 交 Owner | `03:27:25Z` 将 Wayfinder Owner 改为 Squad `59debd72-213c-41cc-82a9-2ad8da9df675`，命令带 `--no-start`；随后回读 `backlog + Squad`。 |
| 预期启动 | `03:27:37Z` 将 `backlog → todo`，Run 消息确认该命令**未带** `--no-start`。Wayfinder 于 `03:28:01Z` 完成；之后多次回读 `issue runs` 和 Lead Agent 任务列表，均无 `WFP-5` Lead Run。Issue 保持 `todo + Squad`。 |
| 受控补启动 | 确认无活动 Run、Owner 为 Squad、Decision 已持久化后，`03:30:22Z` 对 `WFP-5` 仅执行一次 `multica issue rerun`。它创建唯一 Lead Run `01a1334f-af7a-71cc-ab82-9b57d34a2b2c`，`03:32:17Z` 完成并回报身份；此 Run 的来源是人工补启动，**不能**计为 `todo` 自动启动。 |

时间线只证明状态/Owner 写入与顺序；Run 列表和 Lead 输出证明自动派发缺失及人工补启动生效。前次 `WFP-4` 由成员在 Run 外执行同样的 `backlog --no-start → Squad --no-start → todo` 曾自动创建 Lead Run；这提示触发上下文可能影响行为，**原因尚未确认**。

## 4. 判定

| 验证点 | 结果 |
|---|---|
| UI 真实 Mention → 单个 Wayfinder 评论 Run | **PASS**（第三次目标 UUID 与回读一致） |
| 评论触发 Run 发布 `/note` 回复并回读关联关系 | **PASS** |
| `/note` 回复不额外唤醒 Agent | **PASS**（本轮无 Wakeup，Run 列表无新增 Wayfinder Run） |
| Decision 持久化后按 `backlog --no-start → Squad --no-start → todo` 交接 | **PASS**（Status / Owner 时间线） |
| `auto_start` 仅一次正常激活并自动形成 Lead Run | **FAIL**（没有自动 Lead Run） |
| 对账后一次 `rerun` 人工补启动 | **PASS**，但属于恢复动作 |

**Exit Gate 仍为 FAIL。** 回复式 Decision 可替代顶层写入，然而自动派工路径仍缺失真实 Lead Run 证据。若第一版采用 `manual_start`，可在 Wayfinder 交接后停于 `backlog`，由完成后的独立控制入口回读并执行一次启动；该完整恢复流程仍须以新 Issue 再测。若坚持 `auto_start`，需查明评论触发的 Agent Run 中执行 `backlog → todo` 为何未派发，并证明修正后不会重复启动。

原方案中的“所有 Decision 都在顶层 `/note`”需要区分首次直派 Run 与评论触发的恢复 Run；`最新有效 Decision` 的查询也须覆盖顶层及回复，依 `supersedes` / 来源版本选取。本轮未修改正式 Workspace、TFS、业务 Repository 或 PR。

## 5. 追加验证：指派时不使用 `--no-start`

针对“是否试过不使用 `--no-start`”的追问，创建独立 `WFP-6`（`01a1336a-18e8-765c-9c73-5aacdc178fcc`）。成员在 Run 外发布明确标注 **COMPONENT FIXTURE, not Agent Decision** 的 `eligible` `/note` `01a1336a-4c74-73c0-b471-6b1fe983d14f`，停放 `blocked + Wayfinder`，Run 列表为空。

1. 先执行 `issue status WFP-6 todo --no-start`：回读 `todo + Wayfinder`，Run 列表仍为空，避免旧 Owner 提前启动。
2. 再执行 `issue assign WFP-6 --to-id 59debd72-213c-41cc-82a9-2ad8da9df675`，**不带 `--no-start`**：回读 `todo + Squad`，立即只创建一个 Lead Run `01a1336a-bfad-7215-8c78-be27e5a6ff40`，该 Run 于 `04:01:09Z` 完成并回报身份。时间线显示 `todo` 写入在 `03:59:42Z`，Squad 指派在 `03:59:56Z`；Run 与指派同时创建。

**结论边界：**以“指派 Squad”为唯一启动动作在成员 CLI 的隔离组件测试中可行。这不能证明 `WFP-5` 的自动启动失败由 `--no-start` 本身引起；`WFP-5` 的 `todo` 命令确实没有该参数。尚未在 Wayfinder 的评论触发 Run 内验证“先 `todo --no-start`，再不带 `--no-start` 指派 Squad”的完整路径，故端到端 Exit Gate 不变。
