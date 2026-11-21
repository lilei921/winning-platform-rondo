使用 `pr-status-sync` 对账。仅对 `actions[]` 中已确认的 `finalize` / `resume_finalize` 执行 `issue-closeout`；扫描整体 `UNKNOWN` 不进入收口，单项失败或 `unknown` 不推进受影响 Issue。

- 已是 `done` 且仅残留 `finalize.pending`：由 `issue-closeout` 直接 Complete，无需 Clone。
- 独立 Bug：直接执行 `issue-closeout`，无需根仓。
- Requirement：逐 Issue 读取 `analysis.source`（`repo_url`、`branch`、`commit`、`change_ref`），在同一 Run 内按 Repository + Branch 分组；不同 Branch 不共用工作树。
- 每组首个 Issue 执行 `rondo delivery root-clone --issue <KEY> --config "<config-path>"`，记录 `root_repo` 和 `cleanup_token`，供本组复用。不要使用 Multica Repo 或 `workspace-preparation`。
- 同组逐 Issue 顺序执行 `issue-closeout`，传入同一个 `--root-repo`；每个 Issue 独立核验收口结果。
- Archive / Git 状态无法确认时停止本组；仅 TFS 写入失败且 Git 状态安全时，可继续同组其他 Issue。不同组独立处理。
- 每组结束或停止且根仓已不再使用时，执行 `rondo delivery root-cleanup --root-repo "<root_repo>" --token "<cleanup_token>"`。Cleanup 失败则保留现场并说明原因，不强制删除。

仅汇报已确认的同步、单 Issue 收口和 Cleanup 结果；`FAIL`、`UNKNOWN` 或外部验证缺失不得报告 PASS。
