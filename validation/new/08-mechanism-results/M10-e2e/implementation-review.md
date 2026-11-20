# M10 远端收口适配复核

范围是根仓 `tools/rondo` 与对应 workspace Skill 调用契约。业务仓只创建隔离测试分支、标记 Commit 和 PR #3773；没有修改生产分支或根仓工作区 Git 历史。

已复核的实现边界：

- 显式 `runtime.root_branch` 启用新 Requirement 路径；旧 Project/local_directory 与独立 Bug 路径保持兼容。
- 批准内容固定 `analysis.source.commit`，当前进度固定一次解析的权威分支 SHA；文件集合、规范正文、Schema、归档唯一性均核对，任务 checkbox 允许更新。
- Evidence 仓库由 `repo_key + repo_url + 完整 SHA` 确认；PR/ArtifactLink 还核对当前 TFS Collection，旧绝对路径不提供跨 Runtime 身份。
- PR 完成只依据 `status=completed`，精确核对分支与 Source Commit；`mergeStatus` 仅用于诊断。已复读 `projects/multica/validation/pr/README.md`。
- Prepare 真实浅克隆、OpenSpec Archive、限定路径提交、push、独立 API 回读后才写 prepared。其他分支前进不能被盲目快进放行。
- 独立 Writer 与 Complete 重新核验当前归档、批准、证据、PR、pending；Complete 只读核对真实 TFS 父子项后才完成 Issue。
- Git PAT 仅通过精确 URL 范围的子进程环境传入，禁止 HTTP 重定向，不写 argv、磁盘或全局凭据配置；网络 Trace 在认证调用内关闭。现有 Windows Credential Manager 不能在沙箱内枚举，已由此路径解决。
- 大根仓 clone 仅该调用使用 1200 秒上限，其他命令仍 300 秒；测试驱动外层为 1500 秒。控制端对照的 Git 子进程曾在父进程超时后继续完成，不能把父进程超时记为验收成功；已保存其日志并核对干净快照后清理三个控制端 clone。
- 临时目录清理只针对本次创建的真实路径，并拒绝链接；已确认 push 的 clone 与 API 工件缓存清理，未确认发布的现场保留。

最终构建完整回归：`rondo-final-full-regression.log`，369 项，366 PASS、3 SKIP、0 FAIL；构建成功。专项记录同时保留，不能把重叠用例重复相加。

验证限制：这里只承诺顺序重放和实际测试覆盖的中断位置，不声称支持多个 Writer 并发。M11 没有低权限身份，继续 NOT_RUN。本次使用工作区未发布构建，未更新全局安装或部署生产 Runtime 配置。
