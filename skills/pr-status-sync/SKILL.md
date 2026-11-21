---
name: pr-status-sync
description: 通过 Rondo 回核并同步已登记 PR 的外部状态。
---

# PR Status Sync

## 执行

使用本 Skill 的 `config/repo-registry.json` 绝对路径：

```bash
rondo pr reconcile-status --config "<config-path>"
```

指定 Issue 时附加 `--issue <KEY>`；恢复已完成 Issue 的残留 `finalize.pending` 时使用 `--recover-done`，两者不可同时使用。

## 结果

- exit 0 / `result=PASS` 仅表示没有单项执行失败；仍须逐项检查 `actions[]`。
- `finalize` / `resume_finalize`：待交付收口，不代表交付完成。
- `noop`：无需动作；`stopped_abandoned`：已停止，不重复处理。
- `unknown`、`failures[]` 非空或 exit 2：停止受影响 Issue 的推进；exit 3：本轮扫描不可信。
- 保留已确认的写入事实，不盲目重试或回滚。
