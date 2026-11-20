# Wayfinder `needs_human` 恢复机制：方案与可行性验证 v1.0

> 日期：2026-10-13  
> 项目：`winning-platform-monorepo` / `docs/multica`  
> 适配基线：仓库现有设计；Multica CLI / Daemon 0.6.1（项目 2026-10-12 Spike 记录）  
> 验证范围：`Human Comment + 显式 @Wayfinder + 增量重新准入`。**本文为方案与静态核实记录，不代表已经在真实 Multica Workspace 做完端到端测试。**

## 1. 结论与设计取舍

**结论：平台原生能力具备实施基础，端到端业务闭环尚待真实 Workspace POC。**

- Human 使用同一 Delivery Issue 的评论，选择真正的 `@Wayfinder` Agent Mention。
- Issue 处于 `needs_human` 时保持 `status=blocked`、`assignee=Wayfinder Agent`，等待明确的重新准入请求。
- Wayfinder 新 Run 读取最新有效 Triage Decision、Human 回复及 TFS 最新来源、相关 Evidence；只复核受影响的准入维度，必要时增量执行 `codebase-explorer`。
- 先通过同一 Issue 的顶层 `/note` Comment 持久化最新 Decision，**回读成功后**才按决策变更 Assignment / Status。历史 Decision 不覆盖，以 `supersedes` 和 `resume_ref` 关联。
- 仍输出 `eligible | needs_human | unsupported`，分别执行 Squad 交接、继续阻塞、关闭当前自动交付路径。任何 Human 信息本身都不视作自动交付批准，更不代表编码授权。
- 不引入新的 Issue 类型、自定义状态、轮询 Autopilot、独立 State Machine、`resume-triage` Skill 或额外 Truth Store。

### 必须澄清的运行语义

1. **显式 Mention 是推荐的可靠唤醒入口，但不是唯一可能的原生触发路径。**普通顶层评论可路由至 Issue 当前 Agent Assignee；回复 Agent 评论可路由至该 Agent。Skill 必须根据请求语义判定是否真的需要重新准入，不能因为出现新 Run 就直接解除 `blocked`。
2. `/note` 可屏蔽直接 Comment Mention/Assignee 路由；但 Multica 上游 Issue #9047 指出：0.6.1 启用特定 `comment.created` Wakeup 时仍可能捕获 `/note`。POC 必须禁用适用的评论事件 Wakeup，且实测没有意外 Run。
3. 0.6.1 `IssueService.WillEnqueueRun` 的 Status 触发主要依赖 `prevStatus=backlog`；不能依赖 `blocked → todo` 产生 Run。上游 Issue #8795 有相关故障复现。因此重新准入用 Mention，而 `eligible` 后的首次 Squad 激活采用受控的 `backlog → todo`。
4. Multica 的 Run 和 Issue Status 分离，Agent 仍可能显式写状态。恢复 Run 必须遵守“准入未完成，不写 `in_progress`”；需在隔离 Workspace 验收。

## 2. 最小流程与角色责任

```text
Wayfinder initial decision=needs_human
  -> /note + readback
  -> Issue: blocked, assignee=Wayfinder
  -> Human 评论补充事实 + 显式 @Wayfinder（在 UI 选择真实 Mention）
  -> 新 Wayfinder Run
     -> 检查 Issue 仍为入口阶段、blocked、Owner=Wayfinder
     -> 核对触发 Comment / 最新 TFS Changed Date / 已有证据
     -> 增量探索与重新准入 Decision
     -> /note（含 supersedes, resume_ref）+ readback
     -> eligible: backlog --no-start -> assignee=Squad --no-start -> todo 单次激活
       或 eligible + manual_start: 保持 backlog 等待人工排期
     -> needs_human: 继续 blocked，更新具体待确认点
     -> unsupported: 使用已配置的 unsupported 终态，不改 TFS 终态
```

**责任划分：**

- Human：补充或确认权威事实，明确要求重新准入；不是直接操作交付状态或签发编码授权。
- Wayfinder Agent：解释 Human 意图和权限证据、增量探索、作出 Triage Decision；不承担 Analysis Route、正式 Solution 或编码。
- `workitem-triage` Skill：实施前置检查、Evidence 复用、Decision Comment 的引用及交接停止条件；`codebase-explorer` 只在证据不足或失效时调用。
- 确定性 CLI/API：读回 Issue / Comment / Run，依据明确 Decision 执行受控 Assignment / Status；不得盲重试副作用。
- Delivery Lead：仅在 `eligible` 且满足启动策略后接手，不参与 `needs_human` 的首轮恢复。

## 3. POC 的隔离准备

- 使用独立测试 Workspace、独立测试 Agent `POC Wayfinder` 与 `POC Delivery Squad`（只有一个轻量 Lead）。不使用正式 TFS、不写业务 Repository、不创建真实 PR。
- 固定/记录 Server commit、CLI/Daemon 版本、Workspace、Agent UUID、Run ID、Comment ID、Issue 状态时间线。测试 Agent 的 Runtime 在线，Human 具有 Mention Access。
- 关闭测试范围内的 `comment.created` Wakeup / 自动同步 / 其他自动派工。只使用测试 Issue；若无法排除 Wakeup，**不要进行静默 `/note` 的测试或真实移交**。
- 给 Wayfinder 授予 Issue/Comment 读写与必要的只读测试仓库访问权；禁止写代码、创建 OpenSpec Change 或触发其他专业成员。
- 预置**虚拟 TFS 来源信息**（如 `POC-WI-001`、`tfs.changed_at=2026-10-13T09:00:00+08:00`），一个经确认的只读测试 Repository 与一个待确认的候选系统。不要冒充真实 TFS 权威数据。
- 预置或由 Agent 产生首个 `needs_human` `/note` Decision，回读并将 Issue 停放 `blocked`、Owner 设为 Wayfinder。此处建议先使用 `backlog` 创建以避免意外首轮触发，之后 `blocked --no-start`。

### 人工及 CLI 核对入口

```bash
multica version
multica auth status
multica workspace list
multica agent list --output json
multica squad list --output json

# 仅示意：<POC-ID> 应是隔离 Workspace 的测试 Issue
multica issue get <POC-ID> --output json
multica issue comment list <POC-ID> --output json
multica issue runs <POC-ID> --output json

# 测试隔离前提下，先检查是否有执行中 Run，再进行受控初始状态准备
multica issue status <POC-ID> blocked --no-start

# 恢复触发：请使用 Multica UI 评论输入框真实选择 @POC Wayfinder；
# 单纯 CLI --content '@POC Wayfinder' 不是可靠 Mention。
```

> 参数以安装版 `multica <command> --help` 为准。POC 期间**不要**尝试用 `blocked → todo` 代替显式 Mention；历史 Run 的 Retry 也不是首选恢复入口。

## 4. 测试矩阵与验收标准

| ID | 场景 / 操作 | 必须观察到的结果 | 结论等级 |
|---|---|---|---|
| P01 | `blocked` + Wayfinder Owner；Human UI 选择真实 `@Wayfinder` 并要求重新准入 | Trigger Preview 仅显示 Wayfinder；创建或合并到其 Run；初始 Owner/Status 不因 Mention 变化 | 核心必过 |
| P02 | Wayfinder 响应纯咨询、或 Human 仅提供尚不足以恢复的资料 | 不绕过 `blocked`；不启动 Squad；给出阻塞缺口（即使普通评论产生了 Run） | 核心必过 |
| P03 | Human 提供满足准入的可信归属与权限证据 | Agent 读取 Human 与最新 TFS，增量评估输出 `eligible`；不重做全部无关探索 | 核心必过 |
| P04 | 先写 `/note` Decision 再读回，启用 `auto_start` | 决策 Comment 可定位并关联旧 Decision 与 Human 评论；Squad 只获得一次有效首次派工；没有提前启动 | 核心必过 |
| P05 | `eligible` + 人工排期 | Squad Owner + `backlog`；Lead 无自动新 Run；人工启动后才运行 | 核心必过 |
| P06 | Human 信息仍不充分 | 新 Comment 解释剩余缺口；`status=blocked`；Owner=Wayfinder；没有 Squad Run | 核心必过 |
| P07 | 确认不可支持（明确硬性排除证据） | 产生 `unsupported` Decision；关闭当前自动路径；不修改 TFS Work Item 终态 | 核心必过 |
| P08 | 多次 Mention、重复评论、编辑含 Mention 的评论 | 可以出现额外或合并的 Wayfinder Run，但相同有效输入不得重复形成新的有效交接或多次启动 Squad | 核心必过 |
| P09 | 在准入判定后模拟 TFS Changed Date 更新 | 旧证据不得直接放行；应复核变化后再发布有效 Decision | 核心必过 |
| P10 | `/note` 静默性；包括空触发预览与 Run 列表 | 在禁用 Wakeup 的隔离配置下不会意外启动 Agent；若启用 Wakeup 则记录已知平台风险，不算 PASS | 核心必过 |
| P11 | Decision Comment 已持久化、Assignment/Status 写入失败或返回未知 | 再次运行先回读 Comment/Owner/Status/Run，只补缺失动作；不重复发布结论和派工 | 后续强化 |
| P12 | Agent Access 被拒、Runtime 离线、交接期 Wayfinder/Lead 重叠 | 显示明确失败/排队状态；不误报已恢复；交接后 Wayfinder 不再写交付事实 | 后续强化 |

**验收方法：**不能只看 Agent 自述或 Run Completed。P01–P10 必须提供真实 Issue / Run / Comment 和目标 Lead Run 的回读证据，才可判“隔离 Workspace POC 通过”。P11–P12 在第一轮可列为待验证，但不得因此宣称生产级幂等或故障恢复全部通过。

## 5. POC Agent 的最小 Instructions（测试专用）

```text
你是 POC Wayfinder，只处理测试 Issue 的入口准入与重新准入。
- 收到评论后，先读取 Issue Status、Assignee、最新有效 Triage Decision、触发评论及来源 Changed Date。
- 只有 Issue 仍由你持有、处于入口准入阶段，且 Human 明确要求重新准入时，才进行新的 Triage Decision。
- 普通评论、纯咨询、证据仍不充分时，不解除 blocked；可以回复澄清，但不得启动 Squad。
- 首先复核旧 Evidence；仅对失效和受影响维度做增量探索；不写生产代码或创建 OpenSpec Change。
- Decision 仅为 eligible / needs_human / unsupported，并给出证据和未决问题。
- 先写同一 Issue 顶层 /note，回读后执行受控交接。无效或未知副作用先查询事实，不盲目重复。
- 正常重新准入不把 blocked 预先改为 in_progress；交接后不得继续修改交付事实。
- 不得调用真实 TFS 或正式业务 Agent；任何无法验证的条件停止并报告。
```

真实实施时这些稳定边界分别放入 Agent Instructions 与 `workitem-triage` Skill；不建议长久保留此 POC 专用 Agent。

## 6. `eligible` 的受控交接顺序（测试版）

```text
前置：Owner=Wayfinder, Status=blocked, no conflicting Delivery Run
1. Issue 来源版本与最新有效 Decision 再次核对。
2. `/note` Decision 已存在且回读成功（若上次成功，本次复用原 Comment）。
3. `status = backlog --no-start`，回读。
4. `assignee = Delivery Squad --no-start`，回读。
5a. auto_start: `status = todo`（只执行一个预期触发），回读 Lead Run。
5b. manual_start: 维持 backlog，确认没有 Lead Run。
6. Wayfinder 结束本轮后不再写交付事实。
```

注意：原生平台不提供跨 Agent 的事务锁，自动启动时仍可能有短暂 Run 重叠；应确保最后一次 Status 写入之后 Wayfinder 无额外副作用，并在 P12 验证。如果此重叠无法接受，第一版使用 `manual_start`（`backlog`）收口，人工确认原 Run 已结束后启动 Squad。

## 7. 验证报告模板

| 字段 | 取证 |
|---|---|
| Workspace / Server commit / CLI / Daemon | 待填写 |
| POC Issue / Wayfinder / Squad UUID | 待填写 |
| 初始 `blocked` 事实与 Comment ID | 待填写 |
| Human Comment ID、真实 Mention 与 Preview | 待填写 |
| Wayfinder Run ID、状态时间线 | 待填写 |
| 最新 Decision `/note` ID、回读结果 | 待填写 |
| Assignment / Status 的回读结果 | 待填写 |
| Lead Run ID 与是否重复启动 | 待填写 |
| P01–P12 结果及失败原因 | 待填写 |
| Exit Gate | `NOT_RUN` / `BLOCKED` / `PASS` / `FAIL` |

**2026-10-13 实测判定：**本文件原有的顶层 `/note` 和状态启动顺序未通过，见[首次记录](./wayfinder-needs-human-resume-poc-result-2026-10-13.md)与[回复式重测](./wayfinder-needs-human-resume-revalidation-2026-10-13.md)。[WFP-7 两步指派启动](./wayfinder-needs-human-resume-assignment-start-e2e-2026-10-13.md)和[WFP-8 单次 Update](./wayfinder-needs-human-resume-single-update-e2e-2026-10-13.md)均通过 `needs_human → eligible → Squad Lead` 隔离分支。WFP-8 用触发评论下的 `/note` 回复保存 Decision，再以一条 `issue update --status todo --assignee-id <Squad>` 完成交接并自动创建唯一 Lead Run，没有 WFP-7 的独立 `todo + Wayfinder` 中间 revision。P01–P10 全矩阵尚未完成，不能按本文件原版直接上线。

**正式 Workspace 首次启动门槛：**上述 `WFP-8` 从 `blocked + Wayfinder` 出发；[WFP-9](./wayfinder-first-todo-to-squad-2026-10-13.md)在本隔离 Workspace 验证了 direct Run 的首次改派，[WFP-10](./wayfinder-todo-ui-mention-to-squad-2026-10-13.md)补充了真实 UI Mention、正确 `/note` 回复和 `todo + Wayfinder → todo + Squad` 自动创建唯一 Lead Run。它们仍不能代替正式 Workspace 的生产配置验收。正式验收应在隔离测试 Issue 上回读起点、有效且格式正确的 Decision、空的 Lead Run 列表；由 Wayfinder 执行一次目标 Update 后，回读 Issue revision、Status/Assignee 时间线与目标 Lead Run。只有 Lead 自动启动恰好一次、无需人工 `rerun`，才判该门槛通过。若 Update 返回未知或未见 Lead Run，先回读对账并停止盲重试。

## 8. 已核查来源

- Multica 官方 Mention 路由：https://multica.ai/docs/mentioning-agents
- Multica 官方 Comment 机制：https://multica.ai/docs/comments
- Multica 官方 Issues 与 Status 行为：https://multica.ai/docs/issues
- Multica 官方 Assignment 与 `--no-start`：https://multica.ai/docs/assigning-issues
- Multica 官方 CLI：https://multica.ai/docs/cli
- Multica 0.6.1 `WillEnqueueRun` 源码：https://github.com/multica-ai/multica/blob/2ea01ae4ef55de4310b99af192d2dbd367832883/server/internal/service/issue_trigger.go
- Multica 0.6.1 `/note` 路由：https://github.com/multica-ai/multica/blob/2ea01ae4ef55de4310b99af192d2dbd367832883/server/internal/handler/comment.go
- Multica Issue #8795（`blocked → todo` 不自动派工）：https://github.com/multica-ai/multica/issues/8795
- Multica Issue #9047（`/note` + `comment.created` Wakeup 捕获风险）：https://github.com/multica-ai/multica/issues/9047
- 项目隔离 Spike 记录：https://github.com/lilei921/winning-platform-monorepo/blob/main/docs/multica/validation/01-runtime-asset-inventory-and-spike-result-2026-10-12.md
- 项目 02 §4.1.1：https://github.com/lilei921/winning-platform-monorepo/blob/main/docs/multica/02-multica-delivery-lifecycle-design.md
