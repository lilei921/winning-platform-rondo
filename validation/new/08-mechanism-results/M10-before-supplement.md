# M10 — 删除临时目录后的 Writeback / Complete

- 日期：2026-11-13；状态：**NOT_RUN（端到端）**；已完成只读前置核对。
- 用户提供 [TFS 260986](http://tfs2018-web.winning.com.cn:8080/tfs/wn_data_platform/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_workitems?id=260986&_a=edit)；[只读记录](M10-test-workitem-readonly.json) 显示 rev 2，类型“需求”、状态“已建议”、项目 DP-01-数据仓库，标题“公版研发_DF框架_对接统一权限时，获取菜单接口去除language参数”，无关联。

阻碍不是再次索要 Work Item：当前代码前置能力尚未满足。finalize.ts 仍通过 resolveRuntimePaths 取得本地 openspec，访问业务 hub；writeback.ts 从本地 tasks.md/Evidence 读取，并以绝对 repo_path 反解 registry repo_key；current-evidence.ts 也校验本地 rootRepo 派生路径。尚无已实现的“无原临时目录、从已发布归档工件恢复”的完整适配。

[M09](M09.md) 只证明删除后 Git 工件可读；不能推定 TFS 子任务绑定、Commit 关联或 Issue Done 可用。本轮没有为 260986 编造 Finalize/PR/Evidence 事实，没有更改其状态、工时、评论或关联，也没有执行 Issue Done。

待最小适配完成后，用已确认的专用 Work Item/测试 Issue 与另一授权 Runtime 验证 Prepare→Writeback→Complete，并逐项验证三个中断恢复点。当前不引入新 Metadata 或状态机。
