继续 M10 实际验证。控制端已按 status 字段回读 PR #3773=completed，Source Commit 精确为 5df24d44cc22bf2dfd2c4d45164c5bd8aad00479；fixture-state.json 已保存。无需用户再次授权。

Rondo 已修复本次 Git Credential Manager 拒绝访问：临时归档根仓仅通过 Git 子进程环境复用已有 TFS 配置，精确 URL 范围认证，不改 sandbox、不写凭据文件、不打印凭据。已重新构建且 7/7 相关测试通过。

请在真实 Task 内依次执行：

1. 如果旧 M10-clone-preflight.json 存在，先复制为 M10-clone-preflight-before-auth-fix.json 保留失败证据。
2. 如当前 Task 下 `.rondo-finalize-OEGtsS` 存在，先确认其绝对路径是当前 workdir 的直接子目录，并确认目录为空；仅为空时用 PowerShell `Remove-Item -LiteralPath <已验证路径>` 非递归删除。若非空请报告，不删除任何内容。其他 Task 的目录不操作。
3. `node D:/UserProgram/winning-platform-monorepo/projects/multica/validation/new/08-mechanism-results/M10-e2e/runtime-clone-preflight.mjs`
4. preflight PASS 后立即运行 `node D:/UserProgram/winning-platform-monorepo/projects/multica/validation/new/08-mechanism-results/M10-e2e/runtime-driver.mjs prepare TEST-13`，无需停顿确认。

成功报告与附件：M10-clone-preflight.json、M10-prepare-runtime-evidence.json、M10-injected-failures.jsonl。失败保持事实原样并报告具体 reason。不要手动修改 TEST-13 状态或 prepared/pending/tfs_written。当前 Runner TEST-14 可解除 blocked 执行，完成后 in_review；不要改其他 Task。
