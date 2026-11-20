# pr-status-sync 方案（缺口⑥：PR 状态同步与收口触发）

> 当前契约提示（2026-10-22）：本文旧 `repos/`、`df-*` 示例与实测输出均为历史记录；当前仓库身份与路径以根仓 `docs/config/repo-context.yaml` 及 `multica-delivery-operations-guide.md` §3.5 为准。

> 状态：**已实施并验收（2026-10-15）**。平台注册记录见 `agents/pr-status-sync-agent/README.md`（Skill `8207ef10-d015-4b98-a0ae-be1453f94c12`、Agent `619b9fec-a529-4570-8e74-bd9870a06c93`、Autopilot `a040f26f-e89d-47e3-834e-97881ed705d8`）。
> 依赖：`docs/finalize-delivery-plan.md`（缺口③，本方案的收口动作由其承载，已实施并验收）。
> 上游权威：02 §11（PR Status Sync 运行模型与终态检测）/ §11.1（active=NO-OP 纪律）/ §11.2（abandoned 确定性停止）/ §11.4（幂等与恢复）；本文不复制其语义，只做落地映射。
> 关联决策：`docs/pull-request-capability-plan.md`（`current_pr` 事实契约）；`agents/tfs-sync-agent/`（Autopilot + Thin Adapter + reconcile 脚本的既有范式）。

## 0. 定位

补齐闭环的触发段：PR 合并发生在 TFS 侧（人工动作），需要有人定时发现终态并驱动收口。

```text
Multica Autopilot（cron）
  → PR Status Sync Agent（Thin Adapter，零业务判断）
  → reconcile-pr-status.ts（确定性终态检测 + 事实写入）
  → 全部 completed：写 finalize.pending → 同一 Run 调 finalize-delivery.ts（02 §11.3 same-run finalize）
  → 任一 abandoned：确定性停止（blocked + Squad + pending_event），等 Human Decision
  → active / 其他：NO-OP / UNKNOWN
```

02 §11 红线逐条落到本方案：只读 provider `status` 做终态检测；active 时不根据 Review 意见/投票/mergeStatus 改变任何流向、不写评论、不唤醒任何人（§11.1）；机器不推断 abandoned 的业务原因（§11.2）；处理终态前先持久化 pending_event / event_key（§11.4）。

## 1. 设计约束（红线）

1. **Thin Adapter**：Agent 只触发脚本、读结构化结果、按 SKILL.md 的固定路由调用 finalize；PR 业务含义、Review 意见、abandoned 原因一律不解释（02 §11 明文）。
2. **确定性逻辑全在脚本**：TS 单文件、零构建、零 npm 依赖、可擦除类型注解；退出码 `0` 成功 / `2` 单项失败 / `3` UNKNOWN / `64` 用法错误；stdout 只出 JSON。
3. **TFS 交互一律经 tfs-cli**（`pr get`）；Multica 交互经 CLI；脚本不直接碰 TFS API。
4. **幂等优先**（§11.4）：终态处理先写 pending_event；同 event_key 已应用 → NO-OP；恢复依据当前事实回读，不凭上轮日志。
5. **Skill 自包含**：config 为 repo-registry 同形状副本（第三份，同步纪律同 finalize 方案 §2）；finalize 脚本不内嵌调用——**由 Agent 按路由在同一 Run 内调用**（两个 Skill 都绑定到本 Agent，物化目录可读，见 §4）。

## 2. 资产布局

```text
workspace-skills/pr-status-sync/
  SKILL.md                        # 薄契约 + 固定路由表（reconcile 结果 → 动作）
  config/
    repo-registry.json            # runtime / repos_root / registry（repo_key → tfs_repo / tfs_project）
  scripts/
    reconcile-pr-status.ts        # 唯一脚本：扫描 → 终态检测 → 事实写入 → 输出路由指令

agents/pr-status-sync-agent/
  description.md
  instructions.md                 # 五段式；Boundary-first：不解释 PR 语义、不改代码、不做路由判断
  README.md                       # 平台实例 ID 登记表
```

与 02 §13 资产树一致（`pr-status-sync/` 独立 Skill）。既有资产改动：`agents/pr-status-sync-agent/README.md` 登记平台实例；ops guide §8 缺口⑥ 状态更新。

## 3. 扫描集与事实契约

**扫描集**（02 §11：`status = in_review` 或 pending_event exists）：

```text
issue list --status in_review（等待外部 PR 结果）
+ issue list --status blocked（abandoned 停止后的幂等复核）
→ 逐个 issue get 读 metadata：有 current_pr 或 finalize.pending 才纳入
```

CLI 无"按 metadata key 存在性过滤"能力（0.6.1），故按状态粗筛后逐 Issue 回读确认；当前项目 Issue 量级下开销可忽略。`done` 且 pending 残留的 Issue 不在状态扫描内——由 finalize-delivery 自身的恢复纪律覆盖（02 §12.4.3 末行），本方案不另建扫描通道（见开放问题 1）。

**消费的既有事实**：`current_pr`（pull-request 写回）、`finalize.pending`（finalize-delivery 契约）、`tfs.id`。

**本方案写入的事实**：

| key | 时机 | 内容 |
|---|---|---|
| `pr.abandoned` | 检测到 abandoned 时（写 blocked 之前） | JSON `{repo_key, pr_id, event_key, detected_at}`；event_key = `<issue>#<repo_key>#<pr_id>#abandoned`（§11.4 稳定事件身份） |
| `finalize.pending` | 全部 completed 且尚未写过时 | 形状同 finalize 方案 §3（event_keys = 逐仓 `<issue>#<repo_key>#<pr_id>#completed`）；**先于任何收口副作用**（§11.4） |

## 4. 脚本契约 `reconcile-pr-status.ts`

```bash
node scripts/reconcile-pr-status.ts --config config/repo-registry.json [--issue <KEY>]   # 无 --issue = 全量扫描
```

单 Issue 流程（02 §11 的确定性投影）：

```text
读 Issue + metadata（无 current_pr 且无 finalize.pending → 跳过，不计入结果）
→ 逐 current_pr 项：tfs-cli pr get 回核身份（repo / pr_id / 分支与登记一致；不符 → UNKNOWN）
→ 聚合（02 §11 聚合规则）：
    任一 abandoned → 该仓：写 pr.abandoned（event_key 已存在 → NO-OP 跳过）
                     → Issue status=blocked（--no-start）+ assignee=Delivery Squad
                     → 输出 action: "stopped_abandoned"
    任一 UNKNOWN   → 不推进、不覆盖已有事实 → action: "unknown"
    全部 completed → finalize.pending 已存在 → action: "resume_finalize"
                     否则写 finalize.pending → action: "finalize"
    否则           → action: "noop"（§11.1：不写评论、不唤醒）
→ 汇总输出
```

stdout：

```json
{ "result": "PASS",
  "scanned": 3,
  "actions": [
    {"issue": "FOMA-28", "action": "finalize", "event_keys": ["FOMA-28#df-dataintegration#3339#completed"]},
    {"issue": "FOMA-29", "action": "noop", "detail": "1/2 PR active"}
  ],
  "failures": [] }
```

退出码：`0` 全部处理成功（noop 也是成功）/ `2` 存在单项明确失败（failures 逐项 reason）/ `3` 扫描本身不可信（CLI/TFS 全局故障）/ `64` 用法错误。

**Agent 固定路由**（写在 SKILL.md，Thin Adapter 唯一的"流程知识"）：

| reconcile 输出 | Agent 动作 |
|---|---|
| `action: "finalize" \| "resume_finalize"` | 同一 Run 内调 finalize-delivery Skill：`node .claude/skills/finalize-delivery/scripts/finalize-delivery.ts --issue <KEY> --config .claude/skills/finalize-delivery/config/repo-registry.json`；其结果 FAIL/UNKNOWN 原样汇总，不自行处置 |
| `action: "stopped_abandoned"` | 不追加任何动作（blocked + Squad 已生效，等 Human Comment 唤醒 Lead；route-human-decision 属缺口⑤） |
| `action: "noop"` | 结束 Run，不写评论 |
| `action: "unknown"` / exit 3 | 汇总进 Run 结果，不推进、不重试轰炸；连续 UNKNOWN 由 Autopilot 周期自然覆盖 |

## 5. 调用链与平台注册

```text
Autopilot（cron，建议 */15 * * * *，与 TFS 定时同步同频）
  → PR Status Sync Agent（runtime 同 TFS Sync Agent，本地 daemon）
  → SKILL.md 固定路由：reconcile →（按需）finalize
```

注册内容（照 tfs-sync 范式）：

1. `multica skill create` pr-status-sync + `skill files upsert`（scripts / config）；
2. 创建 Agent `PR Status Sync Agent`（五段式 instructions），绑定 Skill `pr-status-sync` **与 `finalize-delivery`**（same-run finalize 的物化前提）；
3. 创建 Autopilot `PR 状态同步`（cron + 触发指令：执行 reconcile 并按路由表处理）；
4. 实例 ID 登记进 `agents/pr-status-sync-agent/README.md`。

`--no-start` 纪律贯穿全部写入；reconcile 不创建任何 Issue/Run。

## 6. 验收（S 系列）

测试纪律：只用指定测试工作项；completed 终态用一次性 target 分支的真实测试 PR（验收后 abandon 清理分支）；abandoned 用例后恢复 Issue 状态。

| # | 用例 | 预期 | 实测（2026-10-15，FOMA-28 / TFS 256462） |
|---|---|---|---|
| S1 | 单仓 active PR | `noop`，零写入（无评论/无状态变化/无 pending） | ✅ PR 3346 active → `noop`（0/1），status/pending/pr.abandoned 均未动 |
| S2 | 单仓 PR completed（无 pending） | 写 `finalize.pending` + `action:finalize`；Agent same-run 调 finalize → 走通 finalize F1 全链 | ✅ PR 3347 completed → pending 写入 + `finalize`；同 Run 调 finalize-delivery → 全链 PASS（根仓 `844615e` push、TFS→已解决、Issue→done、pending 清除） |
| S3 | PR abandoned | 写 `pr.abandoned` + Issue→blocked + assignee=Squad；**重复扫描同 event_key → NO-OP**（不重复写 blocked、不重复通知） | ✅ PR 3346 abandon → `stopped_abandoned`（pr.abandoned + blocked + Squad 回读确认）；重扫 → `already_stopped` NO-OP，pr.abandoned 条目数不变 |
| S4 | 多仓：一 completed 一 active | 聚合 `noop`，不写 pending（§11：全部 completed 才算 Completion） | ✅ 两 active → `noop` 0/2；PR 3347 completed + PR 3348 active → `noop` 1/2，pending 均未写 |
| S5 | current_pr 登记与外部身份不符（pr_id 对不上 repo/分支） | UNKNOWN，零写入 | ✅ 篡改 source_branch → `unknown`（分支事实不符），零写入 |
| S6 | pending 残留恢复（预置 `finalize.pending`，PR 已 completed） | `action:resume_finalize`，finalize 只补缺失步骤 | ✅ S2 写 pending 后重扫 → `resume_finalize`，pending recorded_at 未变；finalize 恢复模式已在缺口③ F3/F4 全验 |
| S7 | Autopilot 触发端到端（手动 trigger 一次） | Run 完成且行为等于手动执行；Run 结果如实汇总 | ✅ run `01a13d78`：skill files 物化执行 PASS（空扫描集 noop），Run 结果按路由表如实汇总 |

实施偏差记录（对照 §3/§4）：

1. **TFS 全局故障探测**：`tfs attempts>0 且 0 成功 → exit 3`（扫描不可信）——方案只定义了 exit 3 语义，实现补了这条具体判定；
2. **pending 存在但 current_pr 缺失**：输出 `unknown`（事实状态破损，交 Lead）而非 `resume_finalize`——finalize 缺 current_pr 必然 UNKNOWN，提前如实标注；
3. **config 增加 `runtime.delivery_squad_id`**：abandoned 停止需指派 Squad，方案 §2 的 config 形状未含此项，实现补在 runtime 节（第三份 repo-registry 副本，同步纪律不变）；
4. **测试 PR 完成度**：本 TFS 实例 mergeStatus 卡 `queued` 时 REST PATCH completed 静默无效（同 finalize 验收记录），PR 3347 由网页端人工完成——TFS 侧事实，脚本只消费终态、不受影响。

## 7. 明确不做

- Review 意见 / 投票 / mergeStatus 的读取与反应（§11.1：active 时这些一律不改变流向）；
- abandoned 后的路由（`route-human-decision.ts` 属缺口⑤ delivery-flow；本方案只做到确定性停止）；
- CANCEL_DELIVERY（02 §11.2 明文待专项契约）；
- PR 合并动作本身（人工，02 §63）；
- 长驻轮询循环 / 新 Workflow Runtime（Autopilot 周期即节拍）。

## 8. 开放问题

1. **done+pending 残留的扫描盲区**：Issue 已 `done` 但 `finalize.pending` 清理失败时，状态扫描覆盖不到。finalize 方案 §4 步骤 0 已含"已 done 仅核对清 pending"入口，但缺触发源——v1 接受人工触发恢复；若实测发生率高，再扩扫描集（如 Autopilot 第二指令扫 `done` 近 N 天）；
2. **cron 频率**：`/15min` 与 TFS 同步同频是否合适？PR 终态时效要求低（合并后数分钟收口即可），初步同频，实测后调；
3. **并发互斥**：Autopilot 触发时若 Lead 正手动跑同一 Issue 的 finalize——finalize 脚本的根仓临界区锁已防写冲突，但 metadata 写入无锁；v1 依赖"两处调用同一幂等入口"收敛，不建互斥锁，实测出问题再议。
