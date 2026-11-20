# M10 另一 Runtime 的归档读取与当前 CLI 前置能力验证

用户授权使用 TFS 260986 作为测试工作项。本 Task 无 Project，在另一可用 Runtime Claude (lileipc) 执行，只做本说明规定的只读能力探测。

在当前 Task 工作目录运行 `node D:/UserProgram/winning-platform-monorepo/projects/multica/validation/new/08-mechanism-results/m10-runtime-boundary.mjs <当前Issue标识>`。该脚本验证 M09 原 temporary-finalize 目录已经不存在，从既有本地私有 remote 读取归档 tasks.md/Evidence 并比对 Hash；然后真实调用已安装 Rondo Prepare、Writeback、Complete，预期均在缺 Project 根仓时 UNKNOWN，最后回读 260986 和 Issue Metadata 检查无写入。

这是前置能力探测，不是模拟 Prepare 成功。不要编造 PR、finalize.pending、delivery.tfs_written 或生产批准事实；不要手动将本 Issue 设为 done；不要写入 TFS，尚未实现的远端工件读取适配须记录为端到端 NOT_RUN。当前验证不要求实施 Rondo 源码变更。

报告 Run/Runtime ID、证据完整路径和 Hash。禁止恢复原临时目录、创建生产分支、改 sandbox/权限/凭据；不要创建其他 Agent。
