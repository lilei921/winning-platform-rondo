# TFS Writeback P0 验收记录

2026-11-21（北京时间），在 Multica Desktop 的 `winning-lilei` 工作区完成生产 PR Status Sync Agent 的 TFS Commit 反查和共享锁验收。生产 Run 使用 `Codex (lileipc)`，于 16:30:50 完成，只读探测返回 `PASS`。 [生产验收证据](tfs-writeback-p0-validation-2026-11-21.evidence.json)

## TFS Commit 反查

使用生产 Agent 的 TFS 身份和 Rondo 的 `commitTaskOwners()`，通过 REST API 4.1 反查 Commit 对应的 Work Item，并回读 Task 的正向 `ArtifactLink`。

| 样本 | 实测结果 |
| --- | --- |
| 跨 Project Task `258124`，Task 位于 DP-03，Git 仓库位于 DP-01 | 查回 `[258124]`，与正向链接一致 |
| 同 Project Task `267393` | 查回 `[267393]`，与正向链接一致 |
| 已关联需求 `267307` 的 Commit | TFS 返回该需求，Rondo 过滤后得到空 Task 列表 |
| `LEI-49` 的 PR #3947，Commit `73c89eb14315ba5ca4765c73755aa9a40d9e31ef` | 查回空 Task 列表 |
| 不存在的 Commit | Rondo 返回 `UNKNOWN` |
| Work Item 批量回读包含不存在的 ID | TFS 返回 HTTP 404 |

负向样本使用不存在的记录。未调整真实 Task 的访问权限来模拟不可读场景。

## 共享锁

在 `rondo-test` 中用两个独立的 Run，调用 Rondo 的 `withCollectionWriterLock()`，对 `D:/Multica/rondo-tfs-locks` 下的同一测试锁键做竞争验证。

| Runtime | Agent Run | 结果 |
| --- | --- | --- |
| Codex（`lileipc`） | `01a1fd38-a4bb-7dff-a6d8-8373a97c5cab` | 成功持锁，待竞争方确认被拒绝后释放 |
| Claude（`lileipc`） | `01a1fd38-a50f-705a-be26-3b058cd4f197` | 持锁期间竞争被拒绝，释放后成功取得锁 |

两个 Runtime 位于同一台 Windows 主机，验收覆盖当前同机部署。锁竞争使用独立测试键，验收后无残留锁。

## 生产配置与状态

反查和锁验收通过后，仅更新 `winning-lilei` 的 PR Status Sync Agent，回读确认原有环境变量保留。

- `RONDO_TFS_REVERSE_QUERY_VERIFIED=1`
- `RONDO_TFS_COLLECTION_LOCK_DIR=D:/Multica/rondo-tfs-locks`

生产验收 Run `01a1fd3a-3bf4-73c0-90f7-6be4c5bca53b` 确认两个变量均已注入子进程。该进程重新查到跨 Project Task `258124`，确认 `LEI-49` 的 PR Commit 无关联 Task，并成功获取和释放测试锁。

采集时 `LEI-49` 仍为 `in_review`，保留 `finalize.pending.prepared_change_ref=variable-value-scope-query-267307`。本次验收未执行正式 TFS Writeback 或 Complete。
