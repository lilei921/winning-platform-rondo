# Multica 0.6.1 Issue / Run 重试与复用核验

核验日期：2026-10-09（Asia/Shanghai）。对应 [统一设计规范 §2.4](../01-multica-openspec-design-guideline-v1.16.1.md#mechanism-issue-run)。

## 1. 结论与证据范围

§2.4 的谨慎表述成立。安装版本确有同一 Issue + Agent 串行领取、有限自动重试、条件式 Session / 工作目录复用机制；这些机制不提供业务 exactly-once 保证。

本次完成安装版本实查、匹配 commit 的源码核验及上游定向测试（27 个顶层测试通过，另 1 个测试因 Windows 假程序启动失败而未能完成断言）。未向业务 Issue 派发试验任务，未停止 / 重启线上 Daemon，未做线上故障注入。下述源码结论不冒充真实入口端到端验收。

| 实查对象 | 结果 |
|---|---|
| `multica version` | `0.6.1`，commit `2ea01ae4e`，构建时间 `2026-10-01T10:25:57Z`，Windows amd64 |
| `GET https://api.multica.ai/health` | `status=ok`，`commit=2ea01ae4e`，`started_at=2026-10-01T10:24:04Z`；这是响应实例的构建证据，不证明整个云端集群逐节点一致 |
| `multica --profile desktop-api.multica.ai daemon status --output json` | `status=running`，`cli_version=0.6.1`，`launched_by=desktop`，查询时 active task 为 0 |
| 当前工作区 Runtime | 本机 Claude 与 Codex online；上报底层版本分别为 `2.1.283` 与 `0.160.1`；均声明 `checkout-keeps-work-v1` |
| 当前工作区业务记录 | 列表仅返回 `DF-2`（backlog）；`multica issue runs DF-2 --output json` 返回 `[]`，不足以提供实际派发行为证据 |
| 历史本机日志 | 可见 `resume_session=true`、`reuse_workdir=true` 及多个 Run 使用相同 Session 的记录；这些记录跨工作区且未逐条锁定当时版本，仅为补充线索，不计入本版本验收通过项 |

默认 profile 的 `multica daemon status` 返回 stopped；实际桌面 Daemon 使用独立 profile。二者不能混用。

源码锁定为 [`2ea01ae4ef55de4310b99af192d2dbd367832883`](https://github.com/multica-ai/multica/tree/2ea01ae4ef55de4310b99af192d2dbd367832883)，不以可变 `main` 代替安装版本。

## 2. 串行、去重和手动重跑

`TaskService.claimTask` 在事务内锁定 Agent 行，再检查并发配额并领取。`ClaimAgentTask` 排除同一 Issue + Agent 已有 `dispatched`、`running`、`waiting_local_directory` 的情况。因此 Agent 的 `max_concurrent_tasks=6` 不表示其能在同一 Issue 同时执行 6 个 Run；不同 Issue 可以使用剩余配额，不同 Agent 也可在同一 Issue 并行。

评论 pending 唯一索引是 `(issue_id, agent_id, comment_thread_id)`。同一讨论线程的连续评论可以合并，不同线程可以保留不同待执行项；最终领取仍受 Issue + Agent 串行约束。去重不等于每条评论独立运行，也不等于丢弃所有后续信息。

手动 rerun 对目标 Agent、目标讨论线程的未开始任务作取消 / 替换，再排队新的 Run。正在运行或等待目录锁的 Run 保留；要中断，应使用独立的 cancel 操作。因此连续点击 rerun 不能解释成“把正在执行的进程原地重新启动”。

源码：[领取事务](https://github.com/multica-ai/multica/blob/2ea01ae4ef55de4310b99af192d2dbd367832883/server/internal/service/task.go#L3499)、[领取 SQL](https://github.com/multica-ai/multica/blob/2ea01ae4ef55de4310b99af192d2dbd367832883/server/pkg/db/queries/agent.sql#L749)、[线程去重索引](https://github.com/multica-ai/multica/blob/2ea01ae4ef55de4310b99af192d2dbd367832883/server/migrations/452_agent_task_pending_thread_unique.up.sql)、[rerun 排队测试](https://github.com/multica-ai/multica/blob/2ea01ae4ef55de4310b99af192d2dbd367832883/server/internal/service/rerun_queue_behind_active_test.go#L63)。

## 3. 三种不同层级的重试

| 层级 | 触发与限制 | Run / 恢复来源 |
|---|---|---|
| Server 自动重试 | `runtime_offline`、`runtime_recovery`、`timeout`、`codex_semantic_inactivity`、`agent_error.provider_network`、`skill_bundle_unavailable`，并检查预算及任务类型 | 新 Run，`retry_of_task_id` 指向前次，`attempt` 增加；继承必要的任务 / 评论来源 |
| 用户手动 Retry / rerun | 行级 Retry 指定源 Run；CLI `issue rerun` 未提供源 Run 参数 | 新 Run；行级使用 `rerun_of_task_id`，面向历史 Agent；无来源 rerun 面向当前 Owner / Leader |
| Daemon 的会话恢复失败回退 | 恢复会话被拒绝或命中特定不可恢复历史错误，且未观察到工具执行等条件成立 | 同一 Run 内可再启动一次新 Session；不是 Server 的新 Run 重试 |

一般自动重试上限默认为 **首次 + 1 次重试，共 2 次**。模型服务网络故障在默认预算下为 **首次 + 立即重试 + 约 5 秒后最后一次，共 3 次**；显式 `max_attempts <= 1` 不会被扩展。其他自定义预算仍需读取 Run 实际字段。`runtime_offline` 的恢复任务先 deferred，需等 Runtime 健康状态恢复；不是只等固定 1 秒就强行执行。

认证、配额、一般配置错误、普通业务失败和主动取消不在自动重试白名单内；`timeout` 与底层 `agent_error.agent_timeout` 不能混为同一个错误码。Autopilot run-only 与 Triage 有独立规则，不套用普通 Issue 的自动重试。手动动作也不能被自动重试次数上限解释为永久禁止再次运行。

若人工重跑已占据相应 pending 槽位，自动重试会让位，因此一次可重试失败也不保证一定创建重试 Run。

源码：[重试白名单、预算、退避及会话安全规则](https://github.com/multica-ai/multica/blob/2ea01ae4ef55de4310b99af192d2dbd367832883/server/internal/service/task.go#L5224)、[创建重试 SQL](https://github.com/multica-ai/multica/blob/2ea01ae4ef55de4310b99af192d2dbd367832883/server/pkg/db/queries/agent.sql#L461)、[Run 内恢复回退条件](https://github.com/multica-ai/multica/blob/2ea01ae4ef55de4310b99af192d2dbd367832883/server/internal/daemon/daemon.go#L9091)。

## 4. Session 与目录分别判断

| 场景 | CLI Session | 工作目录 |
|---|---|---|
| 普通后续 Run / 安全的自动重试 | 查询同 Issue + Agent 最近可恢复 Session；同 Runtime 才传递会话 ID | 可使用所选历史记录的目录；自动重试不能一概说成严格恢复指定父 Run 的完整快照 |
| 对历史 Run 点击 Retry | 读取指定源 Run；不会随意取该 Issue 最新 Run；源 Agent 保持不变 | 尽力复用指定源 Run 的目录 |
| 无源 Run 的 `issue rerun` | 新 Session | 不请求旧托管目录；依当前配置准备，固定本地路径可以仍相同 |
| 上下文溢出、无效历史、Codex 卡死等恢复不安全故障 | 不复用故障 Session | 可继续使用原目录中的已写文件；新会话与旧目录可同时成立 |
| 换 Runtime / 原目录不存在 / 会话存储丢失 | 不承诺继续旧 Session；缺少 Codex rollout 时清除恢复指针并提示连续性缺口 | 跨 Runtime 只提供候选路径，不传输文件；不可达或不符合归属检查时重新准备 |

托管目录不仅要“存在”：Daemon 还校验其位于托管根目录、目录形态、Workspace / Issue 或 Chat / Agent 的 provenance 与标记，并处理目录锁。配置的 `local_directory` 走专门的 Prepare / 锁 / 可选 worktree 流程，不能直接套用托管目录恢复规则。

Claude 等会话依赖可访问的工作目录 / 会话存储；Codex 另查任务 `CODEX_HOME` 下的 rollout。仅在服务端记录到 `session_id`，不足以证明底层 CLI 已成功恢复；应继续看实际执行日志与 Session ID。

源码：[领取时选择恢复来源](https://github.com/multica-ai/multica/blob/2ea01ae4ef55de4310b99af192d2dbd367832883/server/internal/handler/daemon.go#L2900)、[最近可恢复 Session 查询](https://github.com/multica-ai/multica/blob/2ea01ae4ef55de4310b99af192d2dbd367832883/server/pkg/db/queries/agent.sql#L1041)、[目录与会话可达性](https://github.com/multica-ai/multica/blob/2ea01ae4ef55de4310b99af192d2dbd367832883/server/internal/daemon/daemon.go#L6576)、[托管目录归属检查](https://github.com/multica-ai/multica/blob/2ea01ae4ef55de4310b99af192d2dbd367832883/server/internal/daemon/daemon.go#L6789)。

## 5. 为什么不是 exactly-once

例如某个 Run 已成功创建 PR，但在完成回报前网络断开。平台可能把它标记失败并安排重试；新 Run 或新 Session 仍可能再次执行“创建 PR”。队列唯一索引、串行领取、会话复用都不能替外部系统撤销或确认第一次写入。

执行方法应先回读可验证结果，按稳定业务标识查重或对账；不能仅凭“Run failed”判定“副作用未发生”，也不能凭“恢复了旧 Session”判定“不会再做一次”。目录恢复保留的是当前文件状态，不是事务回滚或时点快照。

## 6. 测试与剩余验收

在锁定 commit 的源码副本中，以 Windows / Go 1.26.6 执行上游已有测试，没有改写测试或产品实现：

| 测试组 | 结果 |
|---|---|
| `pkg/taskfailure`：不可恢复历史、认证方法解析异常与查询规则一致性 | 4 个顶层测试 PASS |
| `internal/daemon`：目录归属、缺失目录、Windows junction、Codex rollout、Session 可达性、Run 内新会话回退条件 | 17 个顶层测试 PASS |
| `internal/service`：网络故障重试预算 / 退避、错误分类、不可自动重试故障、Triage 排除、不可恢复历史 | 6 个顶层测试 PASS |
| `TestRunTaskReusesPriorWorkdirForFreshSession` | FAIL（测试夹具无法启动）。上游 `newLeaderReuseTestDaemon` 创建名为 `claude` 的 `#!/bin/sh` 假程序；本机 Windows 报 `executable file not found in %PATH%`，尚未执行到目录复用断言；既不能计 PASS，也不能据此判定产品恢复逻辑失败 |
| 数据库领取并发、行级 Retry 的 Handler 集成测试、真实派发入口故障注入 | 未执行，不计 PASS |

通过组的复现命令（源码副本的 `server/` 目录）：

```powershell
go test ./pkg/taskfailure ./internal/daemon -run 'Test(UnresumableHistory|AuthMethodUnresolved|ShouldReusePriorWorkdir|GateCodexResumeToRolloutPresence|GateResumeToReachableSession|ShouldRetryWithFreshSession)' -count=1 -json
go test ./internal/service -run '^Test(ProviderNetworkRetrySchedule|TaskFailureClassifiers|RuntimeCLITimeoutIsNotAutoRetried|EnvironmentPrepareFailureIsNotAutoRetried|ResumeUnsafeFailureEmptyHistoryMessage|RetryEligibleExcludesTriageRuns)$' -count=1 -json
```

本次原始通过日志临时保存在 `%TEMP%/multica-verify-retry-reuse-tests.jsonl` 与 `%TEMP%/multica-verify-retry-policy-tests.jsonl`；长期证据以本记录的版本、命令和结果为准。源码副本位于 `%TEMP%/multica-verify-2ea01ae4e`。

尚需在隔离测试 Issue / Agent 中逐项采集下列证据，才可声明实际入口验收通过：

| 用例 | 检查点 |
|---|---|
| 运行中，同线程连续评论；再另起线程 | 合并评论 ID；待执行 Run 数量；同 Issue + Agent 的领取 / 执行时段不重叠 |
| 同 Issue 不同 Agent | 可独立执行，验证没有错误扩大为 Issue 全局锁 |
| 正常完成后普通追问 | 新 Run ID；恢复 Session ID；工作目录及预置文件仍在 |
| 可重试基础设施故障 / provider_network | `retry_of_task_id`、attempt、预算、退避；失败回报与副作用回读 |
| 行级 Retry，随后更换 Issue Owner | 仍指向源 Run 的 Agent；安全会话恢复；目录保留 |
| 无源 Run 的 CLI rerun | 当前 Owner / Leader；新 Session；配置相符的目录行为；运行中任务未被中断 |
| 会话损坏但目录保留 | 新 Session；原文件保留；没有重新使用损坏会话 |
| 测试目录 / rollout 缺失 | 恢复明确降级；当前配置重新准备；连续性缺口可观察 |

每次记录 Server commit、Daemon / CLI / 底层 CLI 版本、真实派发入口、Issue / Agent / Runtime / Run ID、线程 / 评论 ID、attempt、retry / rerun 来源、状态时间线、Session ID、实际 cwd 和文件校验值。只观察 Run 状态或 HTTP 200 不足以覆盖以上验收。

官方文档交叉核对：[Runs](https://multica.ai/docs/tasks)、[Mention agents](https://multica.ai/docs/mentioning-agents)、[CLI](https://multica.ai/docs/cli)。上述具体规则以本记录锁定 commit 的源码证据为准。
