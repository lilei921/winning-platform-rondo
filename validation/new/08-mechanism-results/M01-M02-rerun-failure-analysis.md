# 本轮首次失败与恢复依据（2026-11-13）

> **2026-11-14 适用范围复审**：本文保留 08 v0.9 当轮失败现场、恢复过程及当时源码判断，不是当前实施清单。M02 自主 clone 的 MSYS 阻塞后来已通过显式兼容 Git 工具调用修复，最终结果以 [M02](M02.md) 为准。当前 [08-A §2.1、§2.3](../../../08a-remote-analysis-bug-fix-foundation.md) 仅消费并检验 Multica 原生 checkout，另行验证业务仓准备，不据此为 Agent 新增 cache / checkout 恢复实现。

旧 TEST-2 / TEST-3 不作为本轮验收依据。当前 Project Resource 的 ref 为 `main`。

## TEST-4 实测

- Workspace `rondo-test`，Project `winning-platform-monorepo`，Runtime `Codex (lileipc)`。
- Issue `TEST-4` / `01a1d2f7-1170-7db0-88a9-cf4af76d8a6f`；Run `01a1d2f7-1194-711e-8a65-d94092ff9604`。
- 原生后台 clone：11:32:45.505 开始；11:33:06.762 失败，Git exit 128，无法连接 TFS 8080，约 21 秒。随后 cache 路径不存在。没有手工删除或填充 cache。
- Task 的首次原生 checkout：11:35:22.796417 至 11:35:23.055105，exit 1，`checkout failed: repo is configured but not synced`。没有返回实际根仓路径，M02 未执行。
- Task、Resource、Runtime、Daemon 身份核对成功；根仓获取没有通过。平台 Run 最终 completed 仅表示执行结束，不表示 M01 PASS；测试 Issue 的工作流状态由测试 Agent 推进至 in_review。
- [Task 证据](M01-M02-rerun-A-evidence.json)的源文件与本地副本 SHA-256 均为 `90f0c93d1e18891085d10df9822a22b4bf9580eb1011e47347f17b535308ba3a`；[控制端复核](M01-M02-rerun-A-controller-check.json)确认根仓仍不存在。
- [Daemon 日志](M01-M02-rerun-A-daemon-log.txt)补充了 Task 本身未能获取的底层网络错误。不能将网络连接失败写为 URL 校验或 Git credential 失败，也不能据此断言 TFS Git 协议不兼容。

## 只读对照与原生恢复

11:37:14 至 11:37:20，控制端按原网络环境执行只读 ls-remote 成功。11:38:22 至 11:38:23，控制端仅对一个 Git 子进程禁用代理后再次只读访问成功，见[直连证据](M01-M02-rerun-direct-network-check.json)。两次均未修改系统、Git 或 Daemon 配置。

两次与执行前 refs 一致：

| ref | 完整 Commit |
| --- | --- |
| main | dfdaf33fa58355332259524266045d1052ef9dea |
| master / HEAD | f77b9d050426f54d136424591697a018e56f1494 |
| rondo | e21292336401e74eb0e58d29776e9b9815a46d59 |

控制端连通不代表 Daemon 已恢复，必须重新以真实 Task 取证。已在同一测试 Project 新建一次有界恢复 Run：`TEST-5` / `01a1d2fc-da1d-7d67-8a0f-2edfc29c0259`，Run `01a1d2fc-da3a-796b-9584-f8f23e188c07`。只允许平台原生准备 cache，等待就绪后按[恢复执行单](M01-M02-rerun-A2-request.md)完整重新验证。

## 部署源码核对

固定部署 Commit：`b1ea927def6490c43bedff537b6f4ed9a47fa828`。以下是源码行为说明，不替代执行结果：

- [daemon.go](https://github.com/multica-ai/multica/blob/b1ea927def6490c43bedff537b6f4ed9a47fa828/server/internal/daemon/daemon.go#L3315)（blob `a3f23cd1953b1040b9c30c15e6dccfb83db33287`）：`registerTaskRepos` 在领取 Task 时注册 Project 仓库；缓存缺失时后台同步，因此新 Run 可以原生触发恢复。
- 同文件 `ensureRepoReady`（L3898–3963）：检查失败后刷新 workspace 仓库，并同步响应中的 `resp.Repos`。当前 `multica repo list` 返回 `[]`，Project Resource 仍存在。由代码可推断：仅配置在 Project 的仓库首次后台同步失败后，单纯重复同 Task checkout 不一定会重新同步该仓。这是恢复能力缺口，不能用无界重试掩盖。
- [cache.go](https://github.com/multica-ai/multica/blob/b1ea927def6490c43bedff537b6f4ed9a47fa828/server/internal/daemon/repocache/cache.go#L26)（blob `c391abe152d49fad728a594b05d79081d257ccbd`）：远程 Git 子进程继承 Daemon 环境并禁用交互；没有修改凭据或代理。此次网络失败的更底层原因尚未确认，不能仅由控制端代理设置反推 Daemon 的环境。

后续 TEST-5/6 已重新取得真实证据：[M01 机制 PASS](M01.md)；M02 当时的二级仓与生命周期 PoC 见[修复前历史记录](M02-pre-autonomous-history.md)。当时 Task 自主 clone 又暴露 MSYS 沙箱权限失败，由控制端提供本地 fixture 后完成其余机制验证，自主准备问题尚未修复。**后续状态已更新**：TEST-7/8 使用显式 BusyBox MinGit 在原沙箱内自主 clone 成功，最终 [M02 修复后报告](M02.md) 已取代此处的未修复结论；默认 MSYS 兼容限制仍按该报告保留。

未改产品源码、Project Resource、Agent 指令、系统代理或凭据，未重启 Daemon，未向 TFS 执行写操作。本次失败证据永久保留；三轮原始 JSON 的副本与源文件逐字节 Hash 一致，见[证据清单](M01-M02-evidence-manifest.json)。
