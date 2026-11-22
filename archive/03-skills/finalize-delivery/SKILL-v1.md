---
name: finalize-delivery
description: 核实 PR 全部 completed 后的工程交付条件、外部 TFS Writeback 与 Issue Done；OpenSpec Delivery 归档 Change，独立 Bug Delivery 直接核验 PR / Bug Evidence。
---

# finalize-delivery

## Preconditions / Inputs

- 目标 Issue（`--issue <KEY>`）与配置 `config/repo-registry.json`（相对于本 Skill 目录）。
- 已登记的交付事实；Requirement/OpenSpec 遵循 `references/finalize-facts-contract.md`，独立 Bug 路径遵循 `bug-delivery/references/bug-evidence-contract.md`。两者不混用身份与 Gate。
- 无 Project 的远端 OpenSpec 收口：配置显式 `runtime.workspace_id`、`runtime.root_branch`（固定权威分支的短名称），根仓 URL 来自已批准的 `analysis.source.repo_url`。不把 `analysis.source.branch` 自动当作最新进度分支。配置示例及边界见 `references/remote-artifacts.md`。未配置 `root_branch` 时沿用现有本地根仓解析。

- PR Status Sync 无 Project，`max_concurrent_tasks=1`，复用原生排队；不要求独立 Bug 提供根仓或 Archive。
- Runtime 诊断只读取必要身份字段；不得批量输出环境变量或配置内容，`MULTICA_TOKEN`、PAT 等认证值仅检查是否存在，不进入日志、评论或证据附件。

## Procedure

当前外部 PR Status Sync Run 按以下**必要副作用顺序**执行三个独立的 Rondo 能力；不是三个 Agent Run 或 Multica Stage，也不在本 Skill 重实现 TFS 管理：

```bash
rondo delivery finalize --phase prepare --issue <KEY> --config "<config-path>"
rondo tfs writeback --issue <KEY> --config "<config-path>"
rondo delivery finalize --phase complete --issue <KEY> --config "<config-path>"
```

1. **Prepare**：必须回读实际 PR 终态并核实交付证据，再写入/回读 `finalize.pending` 的受控准备标记。OpenSpec Delivery 原样核对工作区并 Archive / Commit / Push，然后记录 `prepared_change_ref`；独立 Bug Delivery 不解析 OpenSpec / 根仓，改为核对 `bug.required_repos` 与各仓 `bug.delivery`、`pr_prep`、PR 身份和外部 TFS 已合并 `sourceCommitId` 与已验证 `candidate_commit` 一致，再记录 `prepared_kind=bug`、`prepared_bug_digest`。若 TFS API 无法提供最终 Source Commit 或发现不一致，停止 TFS Writeback。必须取得 exit 0、`result=PASS`、`status=prepared` 才能调用 TFS 写回。已有 `done` 时仅核对既有完成事实，不重放 TFS。
2. **TFS Writeback**：独立外部管理能力，消费已批准工程引用，负责 Requirement Task 创建/复用、工时管理、Commit Link、状态与父项回读。必须取得 exit 0 与 `result=PASS`，FAIL/UNKNOWN 立即停止，不调用 Complete。
3. **Complete**：仅在 TFS Writeback PASS 后调用；CLI 核对对应模式的 Prepare 成功事实、`delivery.tfs_written=true` 与实际 PR 终态，并经 TFS 只读查询验证父项及适用子任务。OpenSpec Delivery 仍须核对已归档 Change；独立 Bug Delivery 核对未漂移的 `prepared_bug_digest`，不要求 Archive。最后发布摘要、回读 Issue `done`、清理 pending。

恢复时仍按该顺序安全重放：Prepare 对已归档的本 Change 仅回读与核实 Git 推送；TFS Writeback 对已存在任务只核对并补齐；Complete 仅补未完成 Multica 写入。TFS 评论先按本次 Issue / PR 的稳定引用读取完整 History，再补缺失动作；查询失败或旧评论无法确认时停止。已有本次交付摘要直接复用，确认没有才发布；Comment ID 不作唯一依据，不要求补存 ID 才能继续。不得因其中一步成功就宣称整个 Delivery 完成。

## Validation

- 三个命令各自退出码为 `0`、`result=PASS`；首个必须 `status=prepared`，第二个必须 TFS 写回 PASS，最后必须 `status=done` 且 pending 已清理。Bug 的 `route_archive=skipped` 是合法结果，不得误判缺归档。已有 `done` 的恢复以 `already=done` 和 pending 清理结果为准。
- 具体事实字段及后置条件遵循 `references/finalize-facts-contract.md`，不把中间步骤成功视为全部完成。

## Output

- `{ result, issue, status?, already?, steps?, reason? }`，附已确认的动作、跳过项或失败原因。

## Error Handling / Stop Conditions

- `FAIL`（退出码 `2`）：停止，按已返回的前置条件缺口处理后再调用。
- `UNKNOWN`（退出码 `3`）：停止受影响操作，说明身份、事实或副作用结果的不确定性；不盲目重放写入。
- 中途失败不回滚已确认副作用；再次调用时由命令读取现有事实并恢复。不处理 `abandoned` 的后续业务决定。
