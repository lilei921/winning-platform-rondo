---
name: pr-status-sync
description: 核实已登记 PR 的外部状态并同步可信的终态事实；适用于定时巡检或按需手动复核。
---

# PR Status Sync

## 输入

- 已登记 PR 的 Issue，以及可访问 Multica / TFS 的 `rondo`。
- 配置：本 Skill 目录下 `config/repo-registry.json` 的绝对路径。

## 执行

```bash
rondo pr reconcile-status --config "<config-path>"
```

仅复核指定 Issue 时附加 `--issue <KEY>`。已完成 Issue 的残留 pending 使用 `--recover-done` 单独扫描，不与 `--issue` 并用。

命令负责 PR 身份、状态回核和事实同步。读取返回结果，不自行修改状态、指派或推断 Review 意见。

## 结果处理

- exit 0、`result=PASS` 且 `failures` 为空表示命令无单项失败，仍须逐项检查 `actions[]`。
- `finalize` / `resume_finalize` 表示待收口，不表示交付完成；本能力到状态同步结束。
- `noop` 表示无需动作；`stopped_abandoned` 表示已停止，重复事件不覆盖后续人工处理。
- exit 2、`failures` 非空或逐项 `unknown` 时，报告受影响 Issue 及原因；exit 3 表示结果未知。停止受影响事项，不盲目重试写入或回滚已确认动作。

## 输出

汇总扫描范围和已确认动作，逐项列出失败、未知事项及原因。
