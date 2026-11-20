# M03 无 Project 的固定 SHA 读取验证

这是用户授权的隔离验证，不是业务交付。仅执行当前 Issue 的验收，禁止 checkout 根仓或把本机开发目录当作 Task 根仓，不修改生产 Issue/TFS/Git。

测试来源是历史已发布、归档前的真实 tasks.md；当前 Issue 的 analysis.source 是专门准备的验证指针，不代表一次新的生产需求批准。负向 Issue 的 Commit 为故意无效值。

1. 在当前 Task workdir 记录 cwd、Runtime/Run ID；确认 Issue 没有 Project、工作目录没有 .git。
2. 正向 Issue 是当前 Issue；读取描述末尾给出的负向 Issue 标识。运行已审阅的验证脚本：`node D:/UserProgram/winning-platform-monorepo/projects/multica/validation/new/08-mechanism-results/m03-runtime-validation.mjs <当前Issue标识> <负向Issue标识> M03-runtime-evidence.json`。脚本会在当前 cwd 生成仅包含 Multica CLI 路径和测试 workspace ID 的配置，并调用已安装 Rondo CLI。
3. 核对固定批准 Commit、API 4.0/4.1 独立回读 Hash；不存在文件、无效 Commit、穿越路径须安全失败。脚本只做 GET，不能读取或打印凭据值。
4. 输出简短结论和完整证据文件路径。若失败，记录实际原因，不更改 sandbox、权限或凭据，不用控制端代执行或本地 tasks.md 替代远端响应。

此任务不要求执行 OpenSpec、CodeGraph 或修改业务代码，也不要求创建其他 Agent。
