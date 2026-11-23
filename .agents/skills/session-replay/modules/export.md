# session-replay · export 模式

把 Codex 本地 transcript 导入为可回放的 `replay.md` 与 `replay.json`。

## 1. 确认目标

默认使用当前会话：`CODEX_SESSION_ID`，其次 `CODEX_THREAD_ID`，无需询问或要求用户确认。

用户指定完整 session ID 或唯一前缀时直接使用。只有用户要求选择历史会话但没有提供 ID 时才列候选：

```powershell
python .agents/skills/session-replay/scripts/session_export.py --list --limit 10
```

## 2. 导入并落盘

当前会话：

```powershell
python .agents/skills/session-replay/scripts/session_export.py
```

指定历史会话：

```powershell
python .agents/skills/session-replay/scripts/session_export.py --session <session-id>
```

输出目录：`projects/replay/<YYYYmmdd-HHMM>-<session前8位>/`

目录复用规则：相同完整 session ID 再次导出时原位更新；不同完整 session ID 即使前 8 位相同，也写入带数字后缀的新目录。导出命令不提供额外覆盖选项。

- `replay.md`：user、assistant、工具调用、子任务和可用的 hook 阻断记录。
- `replay.json`：provider、tools、files_touched、hook_blocks、tokens、turns 和 subagents 等统一结构。

`replay.json` 也是目录身份完整性元数据，任何成功导出都会写入；因此 `--format md` 仍会生成 `replay.json`，此时 `--format` 只表示额外生成面向阅读的 `replay.md`。

常用参数：

- `--no-subagents`：明确不需要子任务健康度时跳过子任务。
- `--full`：不截断工具结果和用户输入，仅在需要完整取证时使用。
- `--format json`：只输出结构化数据。

不要默认添加 `--no-subagents`，否则 analyze 会缺少子任务健康度。

## 3. 交接

只要求导出时，报告 session ID 和两个产物路径后结束，不通读大型 `replay.md`。

用户要求“复盘/分析”时立即进入 `modules/analyze.md`，无需再次确认。

## Hook 可观测性

`.codex/hooks.json` 的 `SessionStart` / `SessionEnd` 审计用于标记新会话的观测覆盖。历史会话没有对应日志时，产物必须显示“不可用”。

任何会返回 `deny`、`decision: block` 或 exit code 2 的 Codex blocking hook，都必须在同一判定分支调用：

```powershell
python .codex/hooks/session-replay-audit.py --blocked --reason "<阻断原因>"
```

并把原 hook 输入 JSON 传入 stdin。审计脚本不会保存 prompt、命令或工具结果。
