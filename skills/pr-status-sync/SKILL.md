---
name: pr-status-sync
description: 核实已登记 PR 的外部状态并同步可信的终态事实。
---

# PR Status Sync

## 执行

```bash
rondo pr reconcile-status
```

指定 Issue 时使用 `--issue <KEY>`；恢复已完成 Issue 的残留 `finalize.pending` 时使用 `--recover-done`，两者不可同时使用。

## 结果

根据 `actions[]` 理解各 Issue 的结果：

- `finalize` / `resume_finalize`：存在待处理的交付收口事项。
- `noop`：无需后续操作。
- `stopped_abandoned`：PR 已放弃，停止自动推进。
- `unknown`：PR 状态或登记事实尚未确认。

出现异常时，核实原因并根据实际情况处理；未经确认的结果不作为后续操作依据。
