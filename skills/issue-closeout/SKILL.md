---
name: issue-closeout
description: 当 PR 状态同步返回 finalize 或 resume_finalize 时，完成或恢复 Bug、Requirement 的 TFS 回写与 Issue 收口。
---

# Issue Closeout

使用 PR 状态同步给出的 Issue `<KEY>`。下文 `<config-path>` 为当前 Workspace 渲染的本 Skill 配置 `config/repo-registry.json` 的绝对路径。

Requirement 默认由 Rondo 通过 TFS 读取并核验远端 OpenSpec 工件。使用本地工件时，在 `delivery finalize` 和 `tfs writeback` 命令中都追加 `--root-repo "<根仓绝对路径>"`。独立 Bug 无需根仓，`route_archive=skipped` 为正常结果。

## 1. Prepare

```bash
rondo delivery finalize --phase prepare --issue <KEY> --config "<config-path>"
```

`result=PASS` 且 `already=done` 时，报告已完成并结束。`result=PASS` 且 `status=prepared` 时，进入 TFS 回写。

## 2. TFS 回写

**独立 Bug 或已有任务计划的 Requirement**，直接执行回写。Rondo 会复用 Issue 已保存的计划。

```bash
rondo tfs writeback --issue <KEY> --config "<config-path>"
```

**首次规划的 Requirement**，先查看业务 Commit、变更路径、执行证据和现有 Task 归属。若不确定计划是否已保存，也可用此命令确认。

```bash
rondo tfs writeback --issue <KEY> --config "<config-path>" --inspect
```

若 `saved_plan=true`，使用上面的无计划参数命令恢复回写。若尚无计划，读取批准版工程任务。

```bash
rondo analysis read --issue <KEY> --config "<config-path>" --file tasks.md
```

根据批准版 `tasks.md` 确定工作范围，结合执行证据和 Commit 的实际改动，按业务成果归并为 1–5 个 TFS 子任务。每项估时 0.5–4 小时，引用可在 `tasks.md` 中定位的工程任务，并关联至少一个与该成果对应的独占业务 Commit。只分配能说明该项工作的提交。

将计划写入 `<plan.json>`，顶层为 `tasks` 数组。每项包含 `summary`、`estimate_hours`、`source_refs` 和 `commits`。每个 Commit 使用 Inspect 返回的 `repo_key` 和完整 `sha`。

```bash
rondo tfs writeback --issue <KEY> --config "<config-path>" --task-plan "<plan.json>"
```

## 3. Complete

实际回写返回 `result=PASS` 后执行 Complete。`--inspect` 的 `PASS` 只确认检查成功。

```bash
rondo delivery finalize --phase complete --issue <KEY> --config "<config-path>"
```

`result=PASS`、`status=done` 且 `pending` 已清理时，报告收口完成。若返回 `result=PASS` 且 `already=done`，报告已完成。

## 异常与恢复

遇到 `FAIL`、`UNKNOWN`、非零退出码或回读不一致时，暂停依赖该结果的操作。根据报错自主核查，在授权范围内修复后续跑。若写入结果不明，先核对 Issue 计划与 TFS 实际状态，再通过 Rondo 恢复。

报告 Issue 和已确认的结果。首次规划时简述任务归并与 Commit 选择依据。仍有阻断时，说明已完成的步骤、待确认的事实和恢复条件。
