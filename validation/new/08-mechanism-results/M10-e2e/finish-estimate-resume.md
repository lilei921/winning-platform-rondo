继续 M10，不需要用户补充资源。已确认首次 Writeback 的中断恢复复用了专用子任务 264845；真实 TFS 在解决 Task 时强制 OriginalEstimate，原 fixture 未提供此管理字段，UNKNOWN 是正确结果。不要修改 Rondo 去伪造或忽略工时 Gate。

用户已授权 260986 作为测试工作项并自主准备前置。控制端提供 configure-test-estimate.mjs：仅核对 TEST-13 映射、264845 标题与父项 260986 后，以 revision CAS 为此专用测试 Task 设置 OriginalEstimate=1h / RemainingWork=1h，并在 History 明确“测试 fixture 管理数据，非生产实际工时”。它不更改状态，不重建任务，不修改工程契约。

请在真实 Runtime 依次：

1. 把 M10-finish-runtime-evidence.json、writeback-recovered.stdout.json、writeback-recovered.stderr.log 备份为 M10-finish-before-estimate.json、writeback-before-estimate.stdout.json、writeback-before-estimate.stderr.log，保留第一次故障日志。
2. `node D:/UserProgram/winning-platform-monorepo/projects/multica/validation/new/08-mechanism-results/M10-e2e/configure-test-estimate.mjs`
3. 立即重跑 `node D:/UserProgram/winning-platform-monorepo/projects/multica/validation/new/08-mechanism-results/M10-e2e/runtime-driver.mjs finish TEST-13`。该驱动会再次注入状态写入前的失败并恢复，核对复用同一任务、精确 Commit Link、重复 Writeback 无 TFS revision 变化，以及摘要已持久化但 Done 前中断后的恢复。

全部真实执行，不能手动写 pending/tfs_written/Done。成功上传原始证据与测试估算前置记录；异常仍如实报告，不停顿询问已授权动作。
