---
name: issue-closeout
description: 在 PR 终态满足收口条件后，依序 Prepare、Requirement 任务规划、TFS Writeback、Complete；Bug 沿用原流程。
---

# Issue Closeout

## 输入

- PR 状态同步明确返回 `finalize` 或 `resume_finalize` 的 Issue `<KEY>`。
- `rondo`、本 Skill 的 `config/repo-registry.json` 绝对路径；远端 OpenSpec 读取方式见[配置说明](references/remote-artifacts.md)。

## 执行

先执行：

```bash
rondo delivery finalize --phase prepare --issue <KEY> --config "<config-path>"
```

仅 `result=PASS` 且 `status=prepared` 时继续；`already=done` 直接结束。

**新 Change-level Requirement（`tfs.type=需求`）**：

1. 使用 `rondo analysis read --issue <KEY> --config "<config-path>" --file tasks.md` 获取**批准版**工程任务；它不是最新 checkbox 进度。
2. 执行 `rondo tfs writeback --issue <KEY> --config "<config-path>" --inspect`，读取 PR Commit 的仓库身份、SHA、变更路径及现有 Task 归属；根据实际修改选择业务 Commit，不为凑数分配无关提交。
3. 基于 `tasks.md`、执行证据及真实业务 Commit，形成 JSON 计划：`tasks: [{summary, estimate_hours, source_refs, commits:[{repo_key,sha}]}]`。归并为 1–5 项，每项 0.5–4h、引用有效工程任务、至少一个独占 Commit；未选中的 PR Commit 无需分配。不要调整 `tasks.md` 或制造 Commit。
4. 首次调用 `rondo tfs writeback --issue <KEY> --config "<config-path>" --task-plan "<plan.json>"`。中断恢复优先复用 Issue 已保存计划，直接重跑不带 `--task-plan`；不可自行覆盖已有计划。

**Bug 与旧 `dev.dispatch` Requirement**：不生成新计划，继续使用原入口：

```bash
rondo tfs writeback --issue <KEY> --config "<config-path>"
```

Writeback 必须为 `result=PASS`，再执行：

```bash
rondo delivery finalize --phase complete --issue <KEY> --config "<config-path>"
```

要求 Complete 返回 `result=PASS`、`status=done` 且 `pending` 已清理。

## 停止与恢复

- 任一步 `FAIL`、`UNKNOWN`、退出码非 0 或外部回读不可信，停止，不将未知结果视为成功。
- 新 Requirement 的 Commit 全局独占检查、关联和工时由 Rondo 确定性强制；执行环境无法验证 TFS 2018 反向查询或跨 Runtime 排他写入时保持 `UNKNOWN`，不手工绕过。
- 重跑遵循 Rondo 的已确认计划和 TFS 实际状态，不重复创建子任务、链接 Commit 或评论。Bug 的 `route_archive=skipped` 为正常结果。

## 输出

报告 Prepare、规划依据、Writeback 与 Complete 的已确认结果；失败时提供阻断原因和仍待验证的 TFS 事实。
