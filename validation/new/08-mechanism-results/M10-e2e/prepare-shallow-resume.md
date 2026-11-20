补充：已核对 projects/multica/validation/pr/README.md；完成字段确实为 status。PR #3773 实际 status=completed、Source Commit 精确匹配，完成条件已满足。

当前工作区 Rondo 构建已把临时归档 clone 改为 `--depth 1 --no-tags`，保留固定分支和 HEAD 校验；历史批准正文仍由完整 SHA API 核对。完整历史约 375 MiB，无须为本次临时归档下载。现有正在执行的 full clone 请等待它明确结束，不要并发再开 clone。

若本次 full clone 返回超时/失败：先另存证据为 `M10-clone-preflight-full-before-shallow.json`。若自有 `.rondo-finalize-s2CBZd` 仍存在，确认源和目标绝对路径均为当前 workdir 的直接子目录后，用 PowerShell Move-Item -LiteralPath 将其改名为 `M10-failed-full-clone-s2CBZd`，完整保留现场；不删除其中内容，不操作其他 Task。再运行同一个 runtime-clone-preflight.mjs，实际会使用浅克隆。PASS 后连续运行 runtime-driver.mjs prepare TEST-13。此前原始 Credential Manager 失败证据不要覆盖。新失败仍如实报告。
