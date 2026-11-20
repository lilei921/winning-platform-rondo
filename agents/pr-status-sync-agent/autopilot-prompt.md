使用 `pr-status-sync` 调用 `rondo pr reconcile-status`，核实并同步外部 PR 状态；不自行推断 PR completed。

只处理 `actions[]` 中明确返回 `finalize` / `resume_finalize` 的 Issue：

- Issue 已经是 `done` 且只需恢复残留 `finalize.pending`：直接调用 `rondo delivery finalize --phase complete --issue <KEY> --config "<config-path>"`，无需 Clone。
- 独立 Bug：直接调用 `issue-closeout`，无需根仓。
- 有 OpenSpec Change 的 Requirement：逐 Issue 读取其 `analysis.source`（`repo_url`、`branch`、`commit`、`change_ref`），仅在同一 Run 内按 Repository + Branch 分组。不同 Branch 不共用工作树。
- 每组对第一个 Issue 执行 `rondo delivery root-clone --issue <KEY> --config "<config-path>"`，只 Clone 一次，保存返回的 `root_repo` 和 `cleanup_token` 供本组使用。不要使用 Multica Repo 或 `workspace-preparation`。
- 在同一组中逐 Issue **顺序**使用 `issue-closeout`，Prepare、Writeback、Complete 都显式使用本组相同的 `--root-repo`。每个 Issue 单独验证 PR、Archive、TFS 与 `finalize.pending`，不得用其他 Issue 的结果代替。
- 某 Issue 的 Archive / Git 状态不可确认时停止本组；若 Archive 已确认、仅 TFS 写入失败，可在 Git 状态安全时继续本组其它 Issue。不同分组可独立继续。
- 本组结束或停止、确认无命令继续使用根仓后，执行 `rondo delivery root-cleanup --root-repo "<root_repo>" --token "<cleanup_token>"`。Cleanup 拒绝时保留现场并记录目录与原因，不强制删除。

仅汇总本轮可确认的同步、单 Issue 收口和 Cleanup 结果；`UNKNOWN`、`FAIL` 或真实外部验证缺失不得报告 PASS。
