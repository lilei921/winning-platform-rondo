# Squad Coordinator PoC 复核结果

> 归档说明（2026-10-15）：原始 JSON 证据已按清理要求移除；本文保留复核结论与关键事实，原始命令输出不能再从本目录复核。

> 日期：2026-10-14（Asia/Shanghai）  
> 依据：[验证方案](./squad-coordinator-validation-plan.md) v1.0.0  
> 说明：本文件复核并补测同日[初次报告](./squad-coordinator-poc-result-2026-10-14.md)。初次报告的 PASS 标记不能直接用作退出判定。

## 环境与隔离

- CLI：`multica 0.6.1`，commit `2ea01ae4e`；本地 `multica daemon status` 为 `stopped`。`runtime list` 中 Daemon metadata 报 `cli_version=0.6.2`；Server 版本未独立核实。
- Workspace：`Squad Coordinator PoC 20261014`，`46b5f7c9-9434-4982-9b4a-6cb4fb6ae63b`。
- Project：`Squad Dispatch PoC`，`6d07bdd9-c7b9-4e21-a688-95b79df9ce5c`。
- Coordinator：`0b85b3b8-f422-41d7-9f29-4be3cef0e7cd`；Squad A：`926aa7ff-3900-4741-bf26-26808fc00a56`；Squad B：`3d0a6c02-d26c-4a08-9553-5a959ab3acfe`。
- 全部新增 Issue 和 Agent 都在上述隔离 Workspace/Project。未连接真实 TFS、PR 或业务仓。没有提交、推送或删除 POC 资源。
- S01 探针 Agent：本机 `7551188c-356e-4e54-a5a4-fe438bd329a1`；远端 Claude（失败）`a32ad02d-1136-4e8b-a750-650aafe844ef`；远端 OMP `7a106e21-ef13-43ac-b92c-4fa87dbf0f71`。对应 Runtime：本机 `efc2f71c-5ce4-4acc-9274-3fe2504edc90`，远端 Claude `911bbd34-e188-454c-a550-b97678e61514`，远端 OMP `0a64b1f9-f237-4005-b163-fe0c743ed2c9`。

复核时的 23 条只读 CLI 命令、退出码、脱敏 JSON、Revision、Run 时间及 Timeline 曾存于证据附件；初次 S02–S05 的原始 JSON 曾存于 `fixtures/2026-10-14/`。这些过程数据现已清理，下文保留当时记录的结论与关键事实。

## 判定矩阵

| Case | 复核结果 | 关键事实 |
| --- | --- | --- |
| S02 | 初次 FAIL；新 Fixture PASS | SQC-1 有 1 条 direct Lead Run 和 1 条 comment Lead Run；SQC-8 经指令修正后只有 1 条 Lead B Run。 |
| S03 | 初次证据不足；新 Fixture PASS | SQC-4 的旧指令把 `Mode=WAIT` 写死；SQC-10 读取 A=2、B=1 的占用后保持 `todo + Coordinator`。 |
| S04 | **FAIL**（自动恢复） | 初次 cron 将新建的 SQC-5 改派；补测 SQC-16 先 WAIT，B 队释放后两次自然 cron 均只读扫描，没有改派。 |
| S05 | **FAIL**；容量预检补测通过 | SQC-6 和 SQC-7 同时占用 A，超过 `capacity=1`。更新 POC Agent 后，SQC-9 读到 A=2 并 WAIT；尚未重测“空闲时两个请求竞争同一 Slot”的完整场景。 |
| S01 | **BLOCKED（严格判据）** | LILEIPC 与 test220-pg-db1 上的 POC Run 重叠，临时 Git 仓、分支和 marker 独立；但尚无两台**物理机器**身份与本地磁盘挂载的独立证明。 |
| S06 / S07 / S08 / S09 | NOT_RUN | 注入、可选 Mention、跨机 Git/OpenSpec 集成未执行。 |

**退出判定：`DESIGN_CHANGE_REQUIRED`。** S04 自动恢复和原 S05 容量约束均失败。容量检查只有 Agent 侧读后写，尚无原子 Slot Claim。不能标记 `CORE_MECHANISMS_PASS`。S01 的跨 Host 操作成功，但未证明不同物理机器，故不标记 `MULTI_MACHINE_PASS`。

## 初次报告需要纠正的事实

1. **S02 不能标 PASS。** `multica issue runs 01a1384f-c5c0-7587-85dd-0b19988d7b73 --output json` 有 Lead A direct Run `01a13850-e594-7d38-9a12-a0a58cf76b54`（completed）和 comment Run `01a13851-2b12-704a-a67c-0e9058ea2ef4`（queued）。方案要求“恰好一条目标 Lead Run”，queued 也属于已创建的 Run。Timeline 只有一条 Coordinator Comment；初次报告所称“两条 HANDOFF Comment”不符合 `sqc-1-timeline.json`。
2. **S03 初次结果只证明状态稳定。** 线上 POC Agent 当时的 `instructions` 为固定 `Mode=WAIT → 不 update`，没有读取 A/B 占用的步骤。SQC-4 的最终状态正确，不能单凭自述证明容量驱动的 WAIT 决策。
3. **S04 初次没有证明 WAIT 自动恢复。** 6 条自然 schedule Autopilot Run 最终均 completed，最初把新建的 `Mode=HANDOFF` SQC-5 改派，之后扫描 NO-OP；其输出明确跳过原 WAIT Issue SQC-4。初次报告的“第 2/3 次仍 running”和“WAIT 队列自动恢复”已被实时回读否定。
4. **S05 原因是线上指令缺失。** `multica agent get 0b85... --output json` 的旧 `instructions` 明确规定 SCAN 对命中的 HANDOFF 直接改派，没有容量预检。磁盘 `fixtures/2026-10-14/coordinator.md` 写有容量预检，但当时没有同步到线上 Agent。不能归因于“Codex 缓存旧 instruction”；初次 S05 Run 的 Coordinator 使用的是 Claude Runtime `efc2f71c-...`。

## 隔离补测命令与结果

所有下面的 `create`、`status`、`agent update` 与只读回查 CLI 均返回退出码 0。Run 的实际结果以 `issue runs`、`issue get`、`issue timeline` 为准；不把 Agent 自述单独当作 PASS 证据。

### S02-R：二次接力

先在 POC Coordinator Agent 上更新 `instructions`（线上回读 `max_concurrent_tasks=1`），要求分页读取目标 Squad 占用、一次 `issue update --status todo --assignee-id`、回读后结束。新建 `SQC-8`，Issue ID `01a13896-1b50-7ddc-aa48-78c3176cdc9d`，初始 `backlog + Coordinator`。一次执行：

```powershell
multica issue status 01a13896-1b50-7ddc-aa48-78c3176cdc9d todo --output json
multica issue runs 01a13896-1b50-7ddc-aa48-78c3176cdc9d --output json
multica issue timeline 01a13896-1b50-7ddc-aa48-78c3176cdc9d --output json
```

Revision 初始 1，激活后 2，Coordinator 单次改派后 3。Timeline 于 `04:06:26Z` 记录 Coordinator → Squad B；Coordinator Run `01a13896-3cbb-70c7-823d-1e01416e40bb` 在 `04:05:34–04:06:47Z`，Lead B direct Run `01a13897-0f44-7e04-975e-0e6d38d5fd81` 在 `04:06:26–04:08:18Z`。两者重叠约 21 秒，`runs` 只有这两条，没有额外 Lead comment Run；Owner 为 Squad B，Status 为 `todo`。**新 Fixture PASS；原 SQC-1 的 FAIL 原样保留。**

### S03-R / S05-R3：占用驱动 WAIT

SQC-9（`01a13896-5edf-7da2-8173-5c30a3b86465`）在 SQC-8 激活后 13 秒触发，Coordinator `max_concurrent_tasks=1`；其 Run `01a13896-6e83-7aea-a49b-641c1e573098` 排队，`04:06:48–04:07:57Z` 执行。A 队列表完整返回 `has_more=false`、总 4 条，SQC-6/7 为顶层 `todo`，SQC-1/2 为 `done`，故占用为 2。SQC-9 保持 Revision 2→3（仅 Comment）、`todo + Coordinator`，Timeline 无 `assignee_changed`，Runs 只有 Coordinator。此项验证**已占用时能 WAIT**，不能抵消原 S05 超配事实。

SQC-10（`01a13897-7473-752a-8616-77ca18516ccf`）的 Run `01a13897-8ae1-7c67-a79f-9e4c6d4faee2` 于 `04:07:58–04:09:10Z` 完成。Coordinator 读取 A 队占用 2（SQC-6/7）、B 队占用 1（SQC-8），两队均满；Issue 保持 `todo + Coordinator`，Timeline 无改派事件，Runs 无 Lead。**S03 新 Fixture PASS。**

### S01：双机器探针

在同一 POC Project 创建各自绑定不同 Runtime 的 POC Agent，并通过 `backlog → todo` 同时触发：

- 本机 LILEIPC：Runtime `efc2f71c-5ce4-4acc-9274-3fe2504edc90`，SQC-11 Run `01a13898-2439-763d-9aba-5fddcf0b86b9`，`04:07:37–04:08:42Z`；workdir 为 `C:\Users\lilei\multica_workspaces_desktop-api.multica.ai\squad-coord-6cb4fb6ae63b\sqc-11-5fddcf0b86b9\workdir`，marker 读回 hostname `LILEIPC`。
- 第二机 test220-pg-db1：Runtime `0a64b1f9-f237-4005-b163-fe0c743ed2c9`，SQC-13 Run `01a13898-932f-7073-9052-dd68ef2cc6d7`，`04:08:06–04:08:56Z`；workdir 为 `/root/multica_workspaces/squad-coord-6cb4fb6ae63b/sqc-13-dd68ef2cc6d7/workdir`，marker 读回 hostname `test220-pg-db1`。两个 Run 重叠 36 秒，路径分别在 Windows 和 Linux 本地目录。
- 首次远端 Claude Runtime `911bbd34-...` 的 SQC-12 Run 失败，错误为 `Claude Code refuses bypassPermissions under root/sudo privileges`。保留该失败 Fixture，不在原 Issue 上 rerun；改用第二机 OMP Runtime 新建 SQC-13。

SQC-14/15 为两个 Runtime Host 各自的临时 Git 状态补测，两个 Run 均从 `04:09:57Z` 开始。SQC-14（本机）于 `04:16:29Z` 完成，工作目录内新仓分支 `s01-local`，`git status --short` 为 `?? marker.txt`；操作员直接在该目录只读执行 `git status --short`、`git branch --show-current`、`git rev-parse --show-toplevel` 并回读 marker，结果一致。SQC-15（远端 Host）于 `04:11:40Z` 完成，Server Run 的 `work_dir` 为 `/root/multica_workspaces/.../sqc-15-b8a4e20cbd10/workdir`；Timeline Comment 记录临时仓分支 `s01-remote`、`git status --short` 为 `?? marker.txt`、`git remote -v` 为空。远端 Git 1.8.3.1 不支持 `git init -b`，Agent 改用 `git checkout -b`。跨 Host 隔离的技术子项通过；尚未独立证明 test220-pg-db1 是另一台物理机器、且 `/root/multica_workspaces` 不位于网络共享挂载。因此严格 S01 记 **BLOCKED**，S09 未验证。

### S04-R：真实 WAIT → 释放容量 → 自然 cron

新建 SQC-16（`01a1389d-9f4e-7b21-a7a1-8dc59e63962e`），`Mode=DISPATCH`，目标 Squad B、`Capacity=1`。当 SQC-8 占用 B 时，一次 `backlog → todo` 使 Coordinator Run `01a1389d-ae83-7413-9065-0e26fec6ff01` 于 `04:13:40–04:14:12Z` 执行；它回读到 B=1，SQC-16 保持 `todo + Coordinator`、Revision 3，没有 Lead Run。

确认 SQC-8 `issue runs --active` 返回 `[]` 后，执行 `multica issue status 01a13896-1b50-7ddc-aa48-78c3176cdc9d done --no-start --output json`，退出码 0。B 队分页列表 `has_more=false`，三条 Issue 均为 `done`，占用变为 0。随后启用 POC Autopilot，触发两条自然 schedule Run：`01a1389f-2076-7ed9-9b92-0bdb7f0a042a`（`04:15:15–04:16:32Z`）及 `01a138a0-2006-7369-96dc-7f97592ea8fc`（`04:16:20–04:17:39Z`）。两条 Run 的输出都识别到 SQC-16、B=0，却明确只做只读 SCAN，不调用 `issue update`。实时 `issue get` 回读 SQC-16 仍为 Revision 3、`todo + Coordinator`，`issue runs` 没有目标 Lead Run。

**S04 自动恢复 FAIL。** Autopilot 描述写“仅扫描”，旧线上 Agent 指令和新指令均有 SCAN 语义歧义；本轮 Run 把“扫描”解释为“不得分配”。第二条 Run 在 Autopilot 已暂停后才结束，其输出关于 SQC-4 状态的文字与实时 `issue get` 不符；结论以 Server Issue/Run 回读为准。`04:16:45Z` 已暂停 Autopilot，回读 `status=paused`，两条已触发 Run 最终均 completed。

## 风险和设计修正

1. Coordinator 必须把线上 Agent 指令和测试 fixture 作为同一版本管理，并在每轮测试前回读实际 `instructions`。仅改磁盘 Markdown 不会改变线上运行行为。
2. `Mode=WAIT` 的永久跳过与“容量释放后自动恢复”冲突。待分配 Issue 应保留可扫描的 dispatch 意图；Sweep 需明确要求在容量空闲时执行一次改派，而非“只读 SCAN”。S04-R 已证明仅把 Issue 改为 `Mode=DISPATCH` 仍不足以保证实际改派；需新 Fixture 验证修正后的线上 Autopilot 描述及 Agent 指令。
3. Agent 端 `issue list → update` 有并发窗口。`max-concurrent-tasks=1` 只能限制该 Agent 的运行数，不能防止手动或其他调度入口超配。多入口场景需服务端原子 Slot Claim 或等价串行化约束。
4. 已改派 Issue 上的 Coordinator `/note` 可能生成额外 comment Lead Run。把交接结果放在 Run 输出或在改派前写入不会唤醒 Leader 的专用记录；以真实 `issue runs` 回读为准。

## POC 资源和退出

原 Autopilot `5fc050f8-20ca-4e87-bd72-5270561fd135` 在 S04-R 中临时启用，观察两次自然触发后已于 `04:16:45Z` 暂停；回读 `status=paused`，cron trigger 仍 `enabled=true`。全部 Issue、Run、Comment 保留供审计；未删除资源。

验证方案 §0 引用的 `squad-coordinator-runtime-validation-plan.md` 在本目录不存在；实际执行依据是用户指定的 `squad-coordinator-validation-plan.md`。本次没有修改方案正文和 01–07。
