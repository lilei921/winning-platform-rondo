---
name: tfs-writeback
description: TFS 收口统一回写。PR 全部 completed 后，把本次交付的全部 TFS 写操作一次收齐——需求子任务创建（含工时）、commit 关联（Artifact Link）、子任务置「已解决」落工时、父项（需求/Bug）状态链逐跳推进与收口评论。由 finalize-delivery 作为 steps.tfs_writeback 内部调用；也可 standalone 作恢复入口（断点续走、孤儿认领、在途 legacy 交付兼容）。PR 审核通过前不得对 TFS 工作项执行任何写操作。
---

# tfs-writeback

薄适配器方法：确定性逻辑全部收编为 `rondo tfs writeback` 子命令，本文件只定义调用契约。
定位（2026-10-30 用户裁定，方案 A）：**PR 审核通过前对 TFS 工作项写动作为零**（唯一例外是 pr materialize 建 PR 时的工作项关联，那是交付物本身）；本 Skill 是全部 TFS 写操作的唯一收口。旧的 `rondo tfs materialize-tasks` / `rondo tfs resolve-tasks` 在 CLI 保留标 deprecated，仅作在途交付恢复入口，正常流程不得调用。

## Preconditions / Inputs

- 默认配置：`config/repo-registry.json`（相对于本 Skill 目录）；通过 `--config` 传入该配置文件路径。
- Issue metadata 齐备：`tfs.id`（正整数）、`tfs.type`（需求/Bug）。OpenSpec Delivery 需要 `analysis.change_ref`；独立 Bug Delivery 需要完整 `bug.required_repos`、已验证的 `bug.delivery` / PR 身份和 `finalize.pending.prepared_kind=bug / prepared_bug_digest`，不依赖 Change。Bug Prepare 必须已核实合并 PR 的实际 Source Commit == 已验证的 Candidate Commit。Requirement 仍需 `dev.dispatch` 至少一条 `active:true` 条目且 `task_refs` 非空。
- PR 已全部 completed，必须经对应模式的 `delivery finalize --phase prepare` 写入并回读当前准备标记；standalone 调用也不得绕过。
- 仅 Requirement 需读取 OpenSpec `tasks.md` 与适用的任务估算要求；独立 Bug 不创建 TFS Task，也不使用 `tasks.md`。
- 无 Project 的 Requirement 可配置 `runtime.workspace_id` 与 `runtime.root_branch`，按 `finalize-delivery/references/remote-artifacts.md` 从固定 Commit 的远端归档读取 tasks/Evidence；需要稳定的 `repo_key + repo_url + 完整 SHA`。无需原 Runtime 目录，仍须真实 Prepare 成功及 PR/批准/证据复核。

## Procedure

```bash
rondo tfs writeback --config "<config-path>" --issue <KEY>
```

使用本地 OpenSpec 工件时，追加 `--root-repo "<实际根仓路径>"`；独立 Bug 和已配置的远端工件模式不需要本地根仓。

单命令执行四步（每步幂等、断点续走；顺序硬约束：子任务全部解决后才走父项链）：

1. **任务物化（仅 需求）**：按 active dev.dispatch 的 task_refs 并集 + tasks.md 预估尾注创建/复用/认领 TFS 子任务（标题前缀 `[<issueKEY> <ref>]`，孤儿认领防重复），映射回填 `dev.dispatch[].tfs_task_ids`；存量映射（legacy 在途交付）直接复用。Bug → 本步 skipped。
2. **commit 关联（仅 需求，best-effort）**：扫描 Change 目录（含归档后位置）顶层 `evidence*.json` 的 `commits[]`，按**全部** dispatch 条目（含失效）的 task_refs 归并 sha，经 `rondo workitem link-commits` 把 commit 以 Artifact Link 挂到对应任务（按仓库 GUID + SHA 寻址，与分支无关——PR 完成后源分支删除不影响）。根仓 commit 显式跳过；链接失败记 `commit_link_failed`，**不阻断**。
3. **任务解决（仅 需求）**：逐任务 `set-state 已解决 --complete-with-estimate`（rondo 按任务链 已建议→活动→已解决 逐跳中转；落库 RemainingWork=0、CompletedWork=OriginalEstimate）+ 回读核对。
4. **父项回写**：需求链 已建议→活动→已分析→已解决、Bug 链 已建议→活动→已解决（rondo 逐跳 walk）+ 收口评论；`delivery.tfs_written` 为评论防重键（状态已写评论未写时不置位，重试补评论）。

## Validation

- 退出码 `0`（PASS）；回读确认：
  - 需求：各子任务 state=已解决 且 RemainingWork=0 且 CompletedWork=OriginalEstimate（OE 缺失项列入 `estimate_missing`，不视为失败）；任务「开发」栏挂有本次交付 commit 的 Artifact Link（`commit_links.linked`；`commit_link_failed` 非空属放行项，交人工补）；
  - 父项（需求/Bug）state=已解决，且存在收口评论；`delivery.tfs_written=true`；
- 幂等：同一 Issue 连跑两次，第二次各步全 skipped/复用（无重复建任务、无重复评论、无重复链接）。

## Output

- `{ result, issue, parent, tfs_type, tasks_materialized?: {created, reused, adopted}, commit_links?: {linked, skipped, commit_link_failed, evidence_missed, ...}, tasks_resolved?: {resolved, estimate_missing}, parent_writeback: {status, ...} }`；
- Bug：`tasks_materialized` / `commit_links` / `tasks_resolved` 为 `skipped_bug`，仅 `parent_writeback`；独立 Bug 的成功准备身份通过 `prepared_bug_digest` 核对，不需要 OpenSpec Archive。
- FAIL/UNKNOWN 原样附 reason；UNKNOWN 输出已落账部分的事实（created/reused/adopted/resolved），不得盲目重建。

## Error Handling / Stop Conditions

- `result=FAIL`（exit 2）：前置不满足（tfs.id 非法 / 无 active dispatch / task_refs 不可定位 / 预估尾注缺失或非法 / 父项不存在）——**零创建**，修正输入后重跑；
- `result=UNKNOWN`（exit 3）：部分写入失败（任务创建后 metadata 回写失败 / 置态失败 / 回读不符 / 父项链中途失败）——如实列明已落账事实；修复后**重跑本命令幂等自愈**（孤儿认领 + 逐跳断点续走），不得手工补写 metadata 绕过；
- `commit_link_failed` 非空但其余通过 → 仍 PASS（exit 0）：commit 关联是追溯性增强、非硬契约，交人工补链接；
- `estimate_missing` 非空 → 仍 PASS：OE 缺失任务仅落 RemainingWork=0，如实回流。
