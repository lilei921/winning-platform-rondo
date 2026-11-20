本次 Prepare 驱动的首次执行失败已定位为测试脚本参数问题：Node `--import` 在 Windows 应使用 file URL，原脚本传入了 D:\ 绝对路径，CLI 在加载故障注入器时 exit 1，尚未进入 Rondo 或产生归档/TFS 副作用。控制端已将参数改为 pathToFileURL(...).href；没有修改 Gate 或预期结果。

请先将 M10-prepare-runtime-evidence.json 和 prepare-push-before-metadata.stderr.log 分别备份为 M10-prepare-before-import-fix.json、prepare-before-import-fix.stderr.log，随后立即重跑相同 `node D:/UserProgram/winning-platform-monorepo/projects/multica/validation/new/08-mechanism-results/M10-e2e/runtime-driver.mjs prepare TEST-13`。仍按 1200 秒 clone / 1500 秒驱动上限等待完成，失败证据保留，成功后上传报告与故障注入日志。不手改 TEST-13 任何事实，无须再次确认。
