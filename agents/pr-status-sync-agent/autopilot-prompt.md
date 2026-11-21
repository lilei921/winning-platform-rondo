使用 `pr-status-sync` Skill 完成本轮 PR 状态同步，仅对确认返回 `finalize` / `resume_finalize` 的 Issue 执行 `issue-closeout`，并报告最终结果及待处理事项。

需要根仓的 Requirement 在本 Run 内按 `analysis.source.repo_url + branch` 分组；每组通过 `rondo delivery root-clone --issue <KEY> --config "<config-path>"` 准备一次根仓，保留 `root_repo` 和 `cleanup_token`。组内逐 Issue 顺序执行 `issue-closeout`，复用相同的 `--root-repo`。不同分支不共用根仓，不使用 Multica Repo 或 `workspace-preparation`。

Archive / Git 状态不可确认时停止本组；仅 TFS 写回失败且 Git 状态安全时，可继续本组其他 Issue。不同分组独立处理。每组结束或停止、确认根仓不再使用后，执行 `rondo delivery root-cleanup --root-repo "<root_repo>" --token "<cleanup_token>"`；清理失败则保留现场并报告原因，不强制删除。
