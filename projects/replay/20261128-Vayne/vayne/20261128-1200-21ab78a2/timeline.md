---
title: 工具调用事件序列表 · 21ab78a2
contract: SessionReplay
version: 1.1.0
status: active
created_at: 2026-11-28
updated_at: 2026-11-28
owner: winning\li_lei
---

# 工具调用事件序列表 · 21ab78a2-ac53-4bc2-a949-391a37092e00

> 数据源：`replay.json`（与本目录 `replay.md` 同源）。
> 时间轴为 **UTC**；会话 `2026-11-28T04:00:01.909000+00:00 → 2026-11-28T04:00:25.952000+00:00`，共 24s。
> 事件粒度：轮次级（assistant turn 时间戳，同一轮内并行工具共享时间戳）。
> 域：MAIN = 主线程，SUB = 子代理。

## 重复统计（相同文档 / 脚本的重复读取与执行，>=2 次）

无重复项：所有文档 / 脚本 / pattern 均只出现 1 次。

## 完整事件序列表（3 条，按时间升序）

| # | 时间(UTC) | 域 | 工具 | 对象 | 结果 |
| --- | --- | --- | --- | --- | --- |
| 1 | 04:00:10 | MAIN | `PowerShell` | & "$env:MULTICA_CLI_PATH" autopilot get b1186fa2-1948-448b-b724-15108fff71cd --output json | ✓ |
| 2 | 04:00:10 | MAIN | `PowerShell` | $c = Get-Command rondo -ErrorAction SilentlyContinue; if ($c) { $c.Source } else { "rondo NOT found in PATH" }; Write-Output "MULTICA_CLI_PATH=$env:MULTICA_CLI_PATH" | ✓ |
| 3 | 04:00:18 | MAIN | `PowerShell` | rondo runtime reconcile | ✓ |
