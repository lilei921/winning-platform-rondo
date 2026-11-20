---
name: tfs-writeback
description: 经 Delivery Prepare 后，通过 Rondo 将 Requirement TFS 子任务、估时和 Commit 独占关系写回并回读验证；保留 Bug 与旧路线。
---

# TFS Writeback

本 Skill 只说明 `rondo tfs writeback` 的使用入口；业务分组由 PR Status Sync Agent 决定，确定性校验与 TFS API 副作用由 Rondo 执行。

## 前提

- PR 全部完成、`delivery finalize --phase prepare` 已 PASS；有效 `tfs.id`、`tfs.type` 及对应 Change / Bug 交付事实。
- 配置来自本 Skill 的 `config/repo-registry.json`。新 Change-level Requirement 远端读取批准版 `tasks.md`、归档 Evidence、已完成 PR 和业务 Commit；Bug 无需 OpenSpec。
- **生产独占门禁**：TFS 2018 的 Commit→Work Item 反向查询须先完成真实跨 Project 验证，启用 `RONDO_TFS_REVERSE_QUERY_VERIFIED=1`；所有参与写入的 Runtime 必须配置同一个已验证支持原子创建的共享目录 `RONDO_TFS_COLLECTION_LOCK_DIR`。未满足时 `UNKNOWN`，不进行新 Requirement 写回。

## 新 Requirement

```bash
rondo tfs writeback --config "<config-path>" --issue <KEY> --inspect
rondo tfs writeback --config "<config-path>" --issue <KEY> --task-plan "<plan.json>"
# 已保存计划的断点恢复
rondo tfs writeback --config "<config-path>" --issue <KEY>
```

`--inspect` 只读，输出已核验 PR Commit 的身份、变更路径和已有关联 Task；Agent 选择有实际业务意义的提交，Rondo 验证来源与独占性，不强制分配无关提交。计划中每项填写 `summary`、`estimate_hours`（0.5–4h）、`source_refs`、`commits: [{repo_key, sha}]`。一个 Commit 只分配一个 TFS Task；一个 Task 可包含多个不同 Commit；任务总数 1–5 且不超过可用唯一 Commit 数。

Rondo 在创建前校验并保存 `delivery.tfs_task_plan`；按 `<原需求标题> - <summary>` 创建 TFS Task，以父链和 Description 中的稳定标记恢复，不依赖标题认领。每条 Commit 仅关联计划指定的 Task（不广播给其他 Task 或父需求），双向回读及独占核验通过后才解决子任务，回填 `RemainingWork=0`、`CompletedWork=OriginalEstimate`，最终解决父需求。Complete 再次只读核验。已保存计划不得静默修改。

## Bug 与旧 Requirement

```bash
rondo tfs writeback --config "<config-path>" --issue <KEY>
```

Bug 不创建 TFS 子任务；旧 `dev.dispatch` Requirement 维持原有映射、估时兼容与 Commit 尽力关联行为。两条旧路线不接受 `--task-plan` 或 `--inspect`。

## 结果及恢复

只在 Rondo 返回 `result=PASS`，且 `delivery.tfs_written` 与外部 TFS 已确认一致时视为 Writeback 成功。缺计划、估时无依据、Commit 归属冲突是 `FAIL`；网络、反向查询、跨 Runtime 锁、ArtifactLink 回读不可信是 `UNKNOWN`。任何一个都不能推进 Issue Done。

恢复先回读已存在子任务、稳定标识、工时与 Commit 链接，仅补未确认部分；不得重建或覆盖人工修改的任务，不以 Mock 结果代替 TFS 2018 实际验收。
