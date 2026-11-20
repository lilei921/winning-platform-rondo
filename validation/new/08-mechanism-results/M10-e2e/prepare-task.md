# M10 真实 Runtime prepare

用户已授权使用 TFS 260986 和隔离测试分支连续完成 M10。这是执行测试任务，无需额外确认。

先执行 node D:/UserProgram/winning-platform-monorepo/projects/multica/validation/new/08-mechanism-results/M10-e2e/runtime-clone-preflight.mjs 并报告结果。当前隔离 PR #3773 在服务端 queued；本次先只执行 clone preflight，等待控制端下条消息确认 PR 真实完成后，再运行下面的完整 Prepare 驱动。

在当前 Task workdir 运行：

node D:/UserProgram/winning-platform-monorepo/projects/multica/validation/new/08-mechanism-results/M10-e2e/runtime-driver.mjs prepare TEST-13

脚本使用工作区已构建 Rondo、真实 Multica/TFS/OpenSpec/Git，并在进程边界注入一次失败验证恢复；仅子进程 PATH 使用已核验 BusyBox MinGit。保持现有 sandbox/凭据/Agent 配置。不要另行创建 Agent；不要手动写 Delivery Issue 的状态、prepared、pending、tfs_written 或摘要事实；不要更改脚本和源码。若脚本 FAIL，报告具体证据与失败，保留现场等待本轮控制端修复。成功后报告证据完整路径及 SHA256，并作为本 Runner Issue 附件发布。不要修改 Delivery TEST-13 的状态；当前 Runner 可以转 in_review。