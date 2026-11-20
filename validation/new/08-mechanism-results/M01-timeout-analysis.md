# M01 checkout 超时定位与恢复记录

日期：2026-11-13，Asia/Shanghai。范围仅 M01；用户明确要求“超时不代表机制失败”，继续定位并在解决后复验。

## 结论与判定边界

TEST-2 的直接失败是 **CLI 的 5 分钟 checkout 请求预算耗尽**。其所依赖的原生冷 cache 后台准备仍在进行，直到请求超时后约 27 秒才完成 refs 布局。该 cache 随后通过 Git 连通性检查，证明后台准备最终成功，不能把本次超时直接归类为 TFS URL、认证或 checkout 机制不兼容。

本次恢复方式是等待原生后台准备完成、只读核对 cache 就绪，再在同一 Project / Runtime 发起新隔离 Task 复验。未手工 clone / 填充 cache、未修凭据、未扩大超时、未重启 Daemon、未修改产品源码。

**冷 cache 首次准备可能超过 5 分钟的可靠性限制仍存在**。本次解除已有环境阻塞不等于修改了该限制；热 cache 复验也不等于从零冷启动的时限测试通过。

## 时间线与实测事实

| 时间（Asia/Shanghai） | 事实与来源 |
| --- | --- |
| 10:29:42.380 | Daemon 日志记录该测试 Workspace 的 `repo cache: cloning` |
| 10:29:42.560 | Agent 启动，后台 cache 准备不阻止 Agent 开始运行 |
| 10:31:49.300 | Task 发起唯一一次 `multica repo checkout <root-url> --ref rondo` |
| 10:36:49.610 | 约 300.31 秒后 exit 1，`connect to daemon: context deadline exceeded` |
| 10:37:13.618–10:37:13.663 | cache 最终 `.pack/.idx/.rev` 文件写入完成；pack 大小 416,364,423 bytes |
| 10:37:13.845 | cache `config` 修改时间 |
| 10:37:16.620 | cache `packed-refs` 修改时间；比调用超时晚约 27.01 秒 |
| 后续只读复核 | bare repo 为 true；fetch refspec 为 `+refs/heads/*:refs/remotes/origin/*`；`origin/rondo=21e3c1688846d8fe6c9918c824a992416393874d`；`origin/master=bb13f482ff7a3c01936f596942dd7d36cc6ece86` |
| 后续完整性核验 | `git fsck --connectivity-only --no-reflogs` exit 0；32,942 个 pack 内对象，1 个 pack，garbage 0 |

日志与文件时间给出准备阶段耗时的证据，不是 HTTP 抓包或精确的 clone 函数返回时间。临时 pack 的 mtime 可能在文件关闭时才更新，不能用曾观察到的旧 mtime 断言下载停止。没有传输分项计时，因此不把耗时进一步归咎于 TFS 服务端打包、网络带宽、客户端解包或防病毒扫描中的某一项。

cache 目录：

```text
C:\Users\lilei\multica_workspaces\.repos\60eb8cf4-31be-4a34-b744-8ef6a0bcf15d\tfs2018-web.winning.com.cn%3A8080+tfs+WN_Data_Platform+DP-01-数据仓库+_git+winning-platform-monorepo.git
```

仅对该已观察到的目录执行只读 Git 检查。沙箱内 `git -C` 一度报 Permission denied，沙箱外同一只读命令成功；这是控制端沙箱访问差异，不能作为 Task / Daemon 的 ACL 故障证据。

## 等待链：固定部署版本源码核对

全部源码固定在安装版本 Commit `b1ea927def6490c43bedff537b6f4ed9a47fa828`，不以当前 main 代替部署版本：

1. [daemon.go](https://github.com/multica-ai/multica/blob/b1ea927def6490c43bedff537b6f4ed9a47fa828/server/internal/daemon/daemon.go#L3315) 的 `registerTaskRepos` 为未缓存的 Project repo 启动后台 `syncWorkspaceRepos`。该同步使用独立后台 context，不随一次 CLI checkout 请求结束而终止。
2. [cache.go](https://github.com/multica-ai/multica/blob/b1ea927def6490c43bedff537b6f4ed9a47fa828/server/internal/daemon/repocache/cache.go#L374) 的 `SyncContext` 持有对应仓库锁，完成 clone 和 ref 布局准备后才释放。Git 操作默认超时为 10 分钟。
3. [health.go](https://github.com/multica-ai/multica/blob/b1ea927def6490c43bedff537b6f4ed9a47fa828/server/internal/daemon/health.go#L430) 的 handler 先 `ensureRepoReady`，再进入 `CreateWorktreeContext`。后者须取得同一仓库锁，不能一边 clone 一边创建 Task checkout。
4. `Lookup/isBareRepo` 只以 HEAD 文件存在判缓存路径存在，不代表 clone 已完全结束；安全互斥由仓库锁提供。支持 `retry_busy` 的客户端遇到锁等待期限时，handler 可以返回 HTTP 503 / `repo-busy` / `Retry-After=2`，CLI 在同一个请求总预算内重试。
5. [cmd_repo.go](https://github.com/multica-ai/multica/blob/b1ea927def6490c43bedff537b6f4ed9a47fa828/server/cmd/multica/cmd_repo.go) 的 `runRepoCheckout` 对整个请求与重试循环固定使用 5 分钟 context。该预算短于本次冷 cache 剩余准备时间，因此会先返回 deadline exceeded。

结合实测时间与源码，**冷 cache 准备期间等待就绪 / 仓库锁、请求预算先耗尽**是得到证据支持的原因链。原 Run 没有保存逐次 HTTP 503 事件或 Go 堆栈，不能声称已观测到精确重试次数，或把等待完全限定在某一个内部锁语句。

源码 blob：`daemon.go=a3f23cd1953b1040b9c30c15e6dccfb83db33287`，`health.go=5ef71ab1919e15435328c6eb6903faa91fa4b5d5`；cache / CLI 源码 blob 见 M01 主报告。

## 复验

用户已授权按 [复验执行单](M01-retest-request.md)执行 TEST-3：`01a1d2d3-4c41-78de-9926-f0555e951ad9`，Run `01a1d2d3-4c67-729c-bcf3-0fa1f4f4c34a`。复用原生 cache，首次 checkout 成功后在同 Task、同调用目录重复普通 checkout，检查路径、origin、HEAD、分支与 status。

结果：**PASS（原生 cache 就绪条件下的 M01 checkout 与同 Task 干净状态重入）**。两次调用均 exit 0，分别耗时 17.303253 秒、5.269805 秒；两次路径、分支、HEAD 与工作树状态一致，第二次明确保留已有 checkout。Run 在 11:00:06 完成，attempt=1。

实际 HEAD 为 `9bc060aaa4916887e394883705d04365753f258b`，与 Task 内 `origin/rondo` 及控制端后续 TFS 远端回读一致。测试期间真实分支另有提交推进，未把执行单中的较早 SHA 当作实际版本。Task 内直接 `git ls-remote` 有 `Empty reply from server` 的独立异常，保留记录；它不改变两次原生 checkout 的通过结果。

证据与完整边界见 [M01 主报告](M01.md)及 [TEST-3 Task 证据](M01-retest-evidence.json)。本次解决了已有 cache 准备未完成造成的阻塞，**未改变源码中的 5 分钟请求 / 10 分钟 Git 操作预算，也未证明今后任意冷 cache 均可在首次请求内完成**。
