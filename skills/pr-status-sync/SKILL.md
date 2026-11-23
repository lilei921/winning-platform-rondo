---
name: pr-status-sync
description: 核实已登记 PR 的外部状态并同步可信的终态事实。
---

# PR Status Sync

## 执行

使用当前 Multica Run 的 `MULTICA_WORKSPACE_ID`、`MULTICA_SERVER_URL`，可通过 `MULTICA_CLI_PATH` 指定 CLI（默认 `multica`）。手动执行需提供相同环境及 CLI 认证。

```bash
rondo pr reconcile-status
```

指定 Issue 时附加 `--issue <KEY>`；恢复已完成 Issue 的残留 `finalize.pending` 时使用 `--recover-done`，两者不可同时使用。

## 结果

- exit 0 / `result=PASS` 仅表示没有单项执行失败；仍须逐项检查 `actions[]`。
- `finalize` / `resume_finalize`：待交付收口，不代表交付完成。
- `noop`：无需动作；`stopped_abandoned`：已停止，不重复处理。
- `unknown`、`failures[]` 非空或 exit 2：停止受影响 Issue 的推进；exit 3：本轮扫描不可信。
- 失败或 UNKNOWN 时主动核实原因；确认安全后可重试或恢复，无法确认时停止并报告。
