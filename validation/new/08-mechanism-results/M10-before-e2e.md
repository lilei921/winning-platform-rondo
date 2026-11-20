# M10 — 删除临时目录后的 Writeback / Complete

- 日期：2026-11-13；总体状态：**NOT_RUN（端到端，缺当前 Rondo 的远端工件适配）**。跨 Runtime 归档读取与当前命令前置探测已完成。
- 用户明确授权 [TFS 260986](http://tfs2018-web.winning.com.cn:8080/tfs/wn_data_platform/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_workitems?id=260986&_a=edit) 作为测试工作项；已创建无 Project 的 TEST-12，绑定 tfs.id/type 与隔离 Change 名称。测试对象与另一 Runtime 已具备，无须再提供这两项资源。
- 本次使用另一在线 Runtime Claude (lileipc) `ff1ff20b-e112-4011-a8b3-f65a9472f5fa`；Run `01a1d352-1e2d-71c7-9a8a-cb23d3a1b0d8`。[准备记录](M10-M12-runtime-setup.json)、[脚本](m10-runtime-boundary.mjs)。

在真实 Task 确认原 M09 `temporary-finalize` 已删除，从私有 bare remote 的固定 Commit `df47bb6fd0fdc9b19ec6fe136818548b1403f847` 读取归档 `tasks.md`、`evidence/fixture.json`，Hash 均与 M09 一致。未重建旧目录，也未使用原 Engineer 工作目录。

真实执行已安装 Rondo 的 `delivery finalize --phase prepare`、`tfs writeback`、`delivery finalize --phase complete`，三个命令均 exit 3 / UNKNOWN：`Issue 缺少 project_id——不从父 Issue / 标题 / 默认项目猜测`。它们在持久化 Prepare、TFS 写入、Issue Done 之前停止；260986 前后均 rev 2 / 已建议 / 无关联，Issue Metadata 不变。修正后 **11/11 前置探测断言通过**，不表示 Writeback/Complete 通过。[原始证据](M10-runtime-boundary-evidence.json)。

初跑脚本误用 `evidence.json`，Git tree 实际为 `evidence/fixture.json`，造成该项 exit 128；只修正脚本路径，预期 Hash 和归档工件均未改变，在同一真实 Runtime 重跑通过。[初跑失败](M10-runtime-boundary-first-attempt.json)、[修正说明](M10-path-correction-steer.md)。

源码缺口仍为：finalize 依赖本地 openspec/hub；writeback 从本地 tasks/Evidence 读取并以绝对 repo_path 反解仓库；current-evidence 校验本地派生路径。计划 §2.1、§5 已将这些列为后续实施事项，本轮验证未改业务实现，也未编造 prepared/current_pr/delivery 事实。因此真实子任务绑定、Commit 关联、Issue Done 及三个中断恢复点仍 NOT_RUN；应先实现远端归档读取和稳定仓库身份适配，再使用已备 TEST-12 / 260986 补验。
