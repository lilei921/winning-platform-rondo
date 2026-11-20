# M03 — 固定批准版本读取

- 日期：2026-11-13；状态：**NOT_RUN（真实已批准测试 Issue 路径）**。
- 当前工具：Rondo 1.2.20。只读检查 rondo-test 全部 6 个可见 Issue 时，均无 analysis.source / analysis.change_ref；[查询证据](M03-issue-preconditions.json)。没有创建虚假批准事实。
- 在仅含 runtime 配置的独立目录真实执行 `rondo analysis read --config ... --issue TEST-7 --file tasks.md`，exit 3、UNKNOWN、原因“缺少 analysis.change_ref”；没有回退本地根仓。[实际命令](M03-missing-source-cli.json)。

现有 analysis-read/source 与 Bug Candidate 回归共 18 项：控制端沙箱初跑 15 PASS / 3 HTTP fixture timeout；相同测试在获批控制端环境重跑 **18/18 PASS**，[完整日志](M03-M11-adapter-regression.log)。这证明 mock 边界下固定 SHA、正文校验、错误版本、缺失文件、穿越路径、错误服务及缺凭据安全失败；不替代真实 Issue 的验收。

[M08](M08.md) 已通过已安装 Rondo TfsClient，以 API 4.0 和 4.1 回读同一固定根仓 Commit 的 Evidence，内容 Hash 相同；这是 HTTP 兼容旁证，不是 `analysis read` 完整路径。

缺少：合法已批准测试 Issue 的 analysis.source 与可读 tasks.md。用户提供的 TFS 260986 是 Work Item，不能代替 Multica analysis.source。机制未判 FAIL；获得来源后补跑真实正向、缺失文件、无效 Commit 路径。
