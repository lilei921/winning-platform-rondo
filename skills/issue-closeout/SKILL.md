---
name: issue-closeout
description: PR 状态同步返回 finalize 或 resume_finalize 后，单 Issue 执行 Prepare、TFS Writeback 和 Complete；Requirement 消费已准备的根仓。
---

# Issue Closeout

消费 `pr-status-sync` 返回的 Issue `<KEY>`。配置 `<config-path>` 为当前 Workspace 的 `config/repo-registry.json` 绝对路径。

Issue 已经 `done` 且仅需清理残留 pending 时，直接执行不带根仓的 `delivery finalize --phase complete`，按 `already=done` 结束；无需根仓。

Requirement 的根仓由当前 Autopilot Run 按 `analysis.source.repo_url + branch` 通过 `rondo delivery root-prepare` 准备：Rondo 在 Task workdir 的受控子目录内调用平台 `multica repo checkout`，并切换到 `analysis.source.branch`。同组共用一次准备；本 Skill **不负责分组、准备根仓或删除 worktree**。Requirement 的全部命令都传相同的 `--root-repo "<root_repo>"`，Rondo 会逐 Issue 校验平台 checkout 身份（isolated 模式、Task/Workspace、平台分支尾号）、Origin、Branch、批准 Commit 及远端归档。独立 Bug 不传根仓。

## Prepare

```bash
rondo delivery finalize --phase prepare --issue <KEY> --config "<config-path>" --root-repo "<root_repo>"
```

Bug 去掉 `--root-repo`。若返回 `already=done`，结束该 Issue；`status=prepared` 才继续。所有 PR 必须由 TFS 确认 completed，Requirement 的 Archive/Push/远端回读属于 Prepare 的 Hard Gate；不要重做 Analysis / Engineer 质量 Gate。

已 Prepare 的 Requirement 使用同一命令恢复。Rondo 核对当前 PR 完成事件和 Change，回读远端归档成功后返回 `status=prepared`（`route_archive=skipped`），直接继续 TFS Writeback。只有 pending 缺少 Prepare 标记时才走完整归档流程。已确认的归档无法回读或事实冲突时，按异常流程处理。

## TFS Writeback

已确认有保存计划的 Requirement，直接执行本节的已有计划恢复命令。需要新计划或计划状态尚未确认时，先运行 Inspect。

```bash
rondo tfs writeback --issue <KEY> --config "<config-path>" --root-repo "<root_repo>" --inspect
```

Bug 不使用 `--inspect`，直接执行无规划参数的回写。Requirement Inspect 输出批准 Commit 版本的 `approved_tasks`、已完成 PR 的真实 Commit 列表和 `saved_plan`。若计划已保存，不重复规划；否则根据这些工程任务与实际改动，归并 1–5 个 TFS 子任务，每项估时 0.5–4 小时，引用准确的 `source_refs` 与独占业务 Commit。

新计划写入 `<plan.json>`：顶层 `tasks` 数组，每项含 `summary`、`estimate_hours`、`source_refs`、`commits`。Commit 使用 Inspect 返回的 `repo_key` 与完整 `sha`。

```bash
rondo tfs writeback --issue <KEY> --config "<config-path>" --root-repo "<root_repo>" --task-plan "<plan.json>"
```

已有计划使用以下命令恢复：

```bash
rondo tfs writeback --issue <KEY> --config "<config-path>" --root-repo "<root_repo>"
```

Bug 的回写命令同上，但去掉 `--root-repo`。只有非 Inspect 的实际写回返回 `result=PASS` 后才能 Complete。

## Complete

```bash
rondo delivery finalize --phase complete --issue <KEY> --config "<config-path>" --root-repo "<root_repo>"
```

Bug 去掉 `--root-repo`。Complete 核实远端归档与 TFS 回读，并完成 Summary、Issue Done、`finalize.pending` 清理；不重复 Archive 或上游质量 Gate。

## 异常

遇到 `FAIL`、`UNKNOWN`、非零退出或回读不一致时，主动核实原因及已确认的写入事实；未确认安全前不执行依赖操作。符合 Gate 和恢复条件后可安全续跑，否则报告阻断原因与恢复条件。

不伪造 Commit 或重复创建 Task。根仓由调用方通过 `rondo delivery root-cleanup` 释放所有权标记；平台 worktree 归 daemon 管理，不得删除目录或改动其它 checkout。
