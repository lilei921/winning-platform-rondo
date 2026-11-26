# LEI-68 豁免与 PR 登记流程根治方案

> 保存日期：2026-11-26
> 触发场景：LEI-68 的 Human 豁免只存在于评论中，任务 3.1/3.2 无法在 tasks.md 表达"批准豁免"；PR 已合并、后端源分支已删除，`pr materialize` 无法登记 `current_pr`，`pr reconcile-status` 因缺少登记返回 `PASS / included: 0`，验收链路卡死，最终只能手工写 metadata 兜底。
> 当前状态：**方案已保存，代码未实施**（本轮落地改动已撤销）；平台侧 `current_pr` 已按方案 1 手工补登，两条已合并 PR（后端 #4065、前端 #3978）已登记。

## 一、结论

流程不合理，属于设计缺陷而非执行层问题：

1. 用两态 checkbox（未完成 / 已完成）表达三维事实（未完成 / 已执行 / 批准豁免），导致要么假勾、要么被门槛卡死；豁免理由还因发布契约锁定无法写入已发布工件。
2. 批准登记器只登记了独立验收决定（`verify_agent_required=false`），没有登记豁免范围，Human 的自然语言决定对 CLI 不可见。
3. `current_pr` 只有 `pr materialize` 一个登记入口，且要求源分支存在、HEAD 等于候选提交、PR 为 active——这些都是 PR 合并前才有的状态。一旦正常合并并被删除分支，登记窗口永久关闭；`reconcile-status` 明确只做对账、不补登记。

附带可观测性问题：`--issue` 模式下因缺少登记被静默排除，输出 `PASS / included: 0`，看起来成功实则空转。

## 二、根治方案

### P0 — 把豁免做成一等公民事实（治根）

- 扩展 `rondo analysis approve`，增加 `--waive-tasks 3.1,3.2`，把结构化的 `task_waivers[]`（`task_ref / reason / comment_ref / by / at`）写入 `analysis.human_approval`。豁免只能来自真实 Human 批准评论，不接受 Engineer 自述或 tasks.md 注解推断。
- `checkedTaskProgress` 与 `checkIdentity` 统一消费豁免集合：被豁免的 task 从"必须勾选"和"evidence 必须覆盖"中剔除。**未执行保持未勾选**，不再需要假勾，也不需要往已发布 tasks.md 塞注解，契约哈希问题自然消失。
- 豁免任务编号必须真实存在，否则 FAIL；重复豁免须幂等；同一批准评论不得改变已登记豁免内容。

### P1 — 把 PR 登记与 PR 创建解耦（治时序陷阱）

- 新增幂等命令 `rondo pr register --issue <KEY>`（对已合并 PR 恢复时要求显式 `--accept-merged`，把 Human 授权编码进命令）：
  - 从 `pr_prep` 的 `repo_url` + `candidate_commit` 出发，用 `pr list --status completed --source-branch <branch>` 按源/目标分支和候选提交定位 PR（含 completed）；
  - 回核 PR 身份、分支、工作项关联，校验 `sourceCommitId == candidate_commit`；
  - 写 `current_pr` 并回读确认（复用 `registerCurrentPr`），已有且一致时 NOOP；不创建 PR、不改远端分支。
- `pr materialize` 的 `checkHead` 在 completed 路径放宽：PR 已 completed 且 `sourceCommitId == candidate_commit` 时不再要求源分支存在。
- 结果：登记不再依赖"PR 还是 active"的短命窗口，正常交付顺序（先合并再收口）也能走通。

### P2 — 收口按事实判定，不按工具路径判定

- `finalize` / closeout 的门槛为：PR 已完成并关联工作项、契约已发布、验证与审查证据有效、Human 批准齐全——不关心 `current_pr` 是哪条命令写的。
- `materialize` 只是注册路径之一，不应成为收口的必要条件。
- 实施时优先通过 P1 建立可信 `current_pr` 事实，而不是直接削弱门槛；避免放宽后产生新的绕过路径。

### P3 — 让诊断说真话（治误导）

- `reconcile-status --issue` 遇到因缺少登记而被排除时，返回显式 `not_registered` + reason，计入 failures / 退出码 2，而不是静默 `PASS / included: 0`；常规扫描给出 `excluded` 计数与原因摘要。
- 输出中区分"未纳入""PR 仍 active 的 NOOP""已写 finalize 事实"三类结果，避免 Agent 把空转当成功。

## 三、落地顺序

1. **本次止血（已完成）**：按方案 1 补登 `current_pr`；把 Human 豁免决定补登成可审计的结构化事实（至少补评论锚定）。
2. **短期补丁**：P3 + P1，解除时序陷阱，成本最低、收益最大。
3. **中期根治**：P0 + P2，统一豁免语义和收口判据。
4. **回归防线**：每步补回归测试。

## 四、必须覆盖的回归场景

- Human 豁免部分任务 → tasks.md 中这些任务保持未勾选 → `checkPublishedChange` / `check-completion` 仍 PASS。
- 同一批准评论重复登记豁免幂等；不同评论篡改豁免被拒绝。
- PR 已合并 + 源分支删除 → `pr register --accept-merged` 能登记 `current_pr` → `pr reconcile-status` 回核 completed → 写 `finalize.pending` → `finalize`。
- `current_pr` 缺失时 `--issue` 对账返回 `not_registered` 且退出码 2，不写任何事实。
- `current_pr` 已存在且一致时 `pr register` NOOP；身份/分支/SHA 不一致时 FAIL/UNKNOWN，不覆盖。

## 五、相关事实锚点

- 代码：`rondo/src/commands/dev/change-completion.ts`（`checkedTaskProgress`、`checkPublishedChange`）、`rondo/src/commands/analysis/approve.ts`、`rondo/src/commands/delivery/verify-decision.ts`、`rondo/src/commands/pr/materialize.ts`、`rondo/src/commands/pr/reconcile-status.ts`、`rondo/src/tfs/api/pr.ts`。
- LEI-68：`analysis.human_approval` 只记 `verify_agent_required=false`；豁免决定见 Human 评论 `01a216ad-e874-757f-b3b2-caca838cbb2c` 与 `01a216e2-c504-7844-9da1-faf3fa1ab852`；已补登的 `current_pr` 含 #4065 / #3978。
