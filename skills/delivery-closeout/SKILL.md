---
name: delivery-closeout
description: 对 PR 已合并的 Bug 和 Requirement 执行交付收口。
---

# Delivery Closeout

根据待收口 Issue `<KEY>` 的 `tfs.type`，选择 Bug 或 Requirement 流程；已为 `done` 的 Issue 按恢复流程处理。

根据已确认的待收口 Issue 执行 Prepare、TFS Writeback 和 Complete。按「结果处理」确认当前操作成功后继续。

## Bug 收口

逐条执行，确认当前操作成功后继续：

```bash
rondo delivery finalize --phase prepare --issue <KEY>
rondo workitem writeback --issue <KEY>
rondo delivery finalize --phase complete --issue <KEY>
```

## Requirement 收口

### 根仓准备

```bash
rondo delivery root-prepare --issue <KEY>
```

使用成功返回的 `root_repo` 执行后续操作。本轮相同 `analysis.source.repo_url` 和 `analysis.source.branch` 的 Issue 复用根仓，切换组时重新准备。

### Prepare

```bash
rondo delivery finalize --phase prepare --issue <KEY> --root-repo "<root_repo>"
```

### TFS Writeback

已确认存在保存的任务计划时，直接复用；否则执行 Inspect：

```bash
rondo workitem writeback --issue <KEY> --root-repo "<root_repo>" --inspect
```

Inspect 成功后，`saved_plan=true` 时复用已有计划；否则根据 `approved_tasks` 和 `commits` 规划 TFS 子任务。

#### 新建任务计划

- 根据已批准的工程任务和实际业务改动，合理归并为 1–5 个子任务。
- 每项提供准确、简洁且互不重复的任务总结，估时 0.5–4 小时。
- `source_refs` 引用已批准 `tasks.md` 中的任务编号。
- 使用 `owners` 为空的业务 Commit，每个任务至少关联一个 Commit，同一 Commit 不得重复分配。
- Commit 使用 Inspect 返回的 `repo_key` 和完整 `sha`。

将任务计划保存为 JSON 文件：

```json
{
  "tasks": [
    {
      "summary": "<任务总结>",
      "estimate_hours": 2,
      "source_refs": ["<任务编号>"],
      "commits": [
        {
          "repo_key": "<repo_key>",
          "sha": "<完整 Commit SHA>"
        }
      ]
    }
  ]
}
```

执行回写：

```bash
rondo workitem writeback --issue <KEY> --root-repo "<root_repo>" --task-plan "<plan.json>"
```

#### 复用已有计划

```bash
rondo workitem writeback --issue <KEY> --root-repo "<root_repo>"
```

### Complete

```bash
rondo delivery finalize --phase complete --issue <KEY> --root-repo "<root_repo>"
```

## 已完成 Issue 恢复

Issue 已为 `done` 且存在残留 `finalize.pending` 时，执行：

```bash
rondo delivery finalize --phase complete --issue <KEY>
```

## 结果处理

- Prepare：`result=PASS` 且 `status=prepared` 时继续。
- TFS Writeback：非 Inspect 的实际回写返回 `result=PASS` 时继续。
- Complete：`result=PASS` 且 `status=done` 时确认完成。
- Finalize 返回 `result=PASS` 且 `already=done` 时，结束当前 Issue。

遇到 `FAIL`、`UNKNOWN` 或执行异常时，核实原因及实际结果，根据情况处理并恢复；无法继续时，报告阻断原因及待处理事项。

不得绕过 CLI 校验或直接修改交付状态，不擅自删除、重置平台管理的工作区。
