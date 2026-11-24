---
name: delivery-closeout
description: 完成 Bug 和 Requirement 的交付收口，包括 TFS 回写、需求子任务规划及 OpenSpec 归档。
---

# Delivery Closeout

对待收口 Issue `<KEY>`，根据 `tfs.type` 选择 Bug 或 Requirement 流程。已为 `done` 的 Issue 按「已完成 Issue 恢复」处理。

Prepare 返回 `result=PASS`、`status=prepared` 后执行 TFS Writeback；实际回写（非 Inspect）返回 `result=PASS` 后执行 Complete。

Finalize 返回 `result=PASS`、`already=done` 时结束当前 Issue；Complete 返回 `result=PASS`、`status=done` 时确认收口完成。

## Bug 收口

### Prepare

```bash
rondo delivery finalize --phase prepare --issue <KEY>
```

### TFS Writeback

```bash
rondo tfs writeback --issue <KEY>
```

### Complete

```bash
rondo delivery finalize --phase complete --issue <KEY>
```

## Requirement 收口

### 根仓准备

```bash
rondo delivery root-prepare --issue <KEY>
```

使用成功返回的 `root_repo` 执行后续操作。相同 `analysis.source.repo_url` 和 `analysis.source.branch` 的 Issue 可复用已准备的根仓。

### Prepare

```bash
rondo delivery finalize --phase prepare --issue <KEY> --root-repo "<root_repo>"
```

### TFS Writeback

#### Inspect

尚未确认任务计划时，获取已批准的工程任务及实际业务 Commit：

```bash
rondo tfs writeback --issue <KEY> --root-repo "<root_repo>" --inspect
```

根据成功返回的 `approved_tasks`、`commits` 和 `saved_plan`，选择新建计划或复用已有计划。

#### 新建任务计划

根据已批准的工程任务及实际业务改动，规划 TFS 子任务：

- 合理归并为 1–5 个子任务，不超过可用业务 Commit 数量。
- 每个任务提供准确、简洁的任务总结，估时 0.5–4 小时。
- `source_refs` 引用已批准 `tasks.md` 中的任务编号。
- 每个任务至少关联一个真实业务 Commit，同一 Commit 不得分配给多个任务。
- Commit 使用 Inspect 返回的 `repo_key` 和完整 `sha`。

将任务计划保存为 JSON 文件，结构如下：

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
rondo tfs writeback --issue <KEY> --root-repo "<root_repo>" --task-plan "<plan.json>"
```

#### 复用已有计划

已确认存在保存的任务计划时，直接执行：

```bash
rondo tfs writeback --issue <KEY> --root-repo "<root_repo>"
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

## 异常处理

遇到 `FAIL`、`UNKNOWN` 或命令执行异常时，主动核实原因和实际结果，处理可解决的问题；确认后继续执行。收口中断时，可重新执行 Prepare 并按已确认的结果恢复。无法解决时，报告阻断原因及待处理事项。

不绕过 CLI 校验或直接修改交付状态，不擅自删除或重置平台管理的工作区。
