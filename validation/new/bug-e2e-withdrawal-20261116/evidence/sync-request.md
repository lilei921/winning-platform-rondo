# 隔离 Bug 265199：TFS 同步验收

用户已授权在 rondo-tt 新建隔离样例，完整验证 Bug Fix 流程，包含测试分支提交、推送、PR 合并与 TFS 收口。当前任务只负责入口同步；后续由控制端触发 Wayfinder。

使用 tfs-sync Skill，采用调用方提供的配置：
`D:/UserProgram/winning-platform-monorepo/tools/rondo/build/bug-e2e-withdrawal-20261116/sync-config.json`

执行当前本机构建：
`node D:/UserProgram/winning-platform-monorepo/tools/rondo/dist/index.js tfs reconcile-workitem --config D:/UserProgram/winning-platform-monorepo/tools/rondo/build/bug-e2e-withdrawal-20261116/sync-config.json`

配置只查询新建 TFS Bug 265199，目标服务 https://api.multica.ai，workspace rondo-tt / 3158546f-5b79-4042-baec-20cdac7d9d31，profile desktop-api.multica.ai。核对这些边界后执行并回读来源字段、Project、Owner、intake 状态与正文。

首次结果明确成功后再执行一次相同同步，验证没有重复 Issue、重复附件或意外状态变化；若第一次是 UNKNOWN，先回读，不盲目重试。

新业务 Issue 保持 Skill 规定的 backlog / Wayfinder Agent，由控制端发起准入。当前同步 Runner 不做源码修复或 TFS 状态回写。

将两次退出码、created/updated/skipped/failed、业务 Issue ID、来源版本与实际回读结果保存为本 Task 的 JSON/Markdown 产物并回复。只检查必要身份，认证值仅检查存在性，不输出环境变量全集。完成后将本 Runner 置 in_review。

Windows 运行使用 -NoProfile 与显式 UTF-8，设置进程级 GODEBUG=tlsmlkem=0。Multica 使用配置中固定的 Desktop 自带 0.9.0 CLI。
