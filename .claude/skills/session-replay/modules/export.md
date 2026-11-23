# session-replay · export 模式

把 Claude Code 会话 transcript 导出为可回放的 `replay.md` + `replay.json`。

## Step 1. 确认导出目标

默认导出**当前会话**。若终端可见 session-id（比如用户刚看到过），或用户明确要求某次历史会话，用 `--session <id>`。

先列出候选，帮用户确认（尤其历史会话较多时）：

```bash
python .claude/skills/session-replay/scripts/session-export.py --list --limit 10
```

## Step 2. 导出

当前会话（推荐，默认跳过仍在写入的自身会话）：

```bash
python .claude/skills/session-replay/scripts/session-export.py --last --skip-current
```

指定历史会话：

```bash
python .claude/skills/session-replay/scripts/session-export.py --session <session-id>
```

产物：`projects/replay/<YYYYmmdd-HHMM>-<session前8位>/`

目录复用规则：相同完整 session ID 再次导出时原位更新；不同完整 session ID 即使前 8 位相同，也写入带数字后缀的新目录。导出命令不提供额外覆盖选项。

- `replay.md` — 人读时间线（user/assistant/tool 调用/hook 拦截，均已按工具类型截断）
- `replay.json` — 结构化统计（tools 计数、files_touched、hook_blocks、tokens、每轮 turns 明细），供 `replay-analyze.py` 消费

`replay.json` 也是目录身份完整性元数据，任何成功导出都会写入；因此 `--format md` 仍会生成 `replay.json`，此时 `--format` 只表示额外生成面向阅读的 `replay.md`。

常用参数：

- `--no-subagents` 跳过子代理会话（会话很大且不关心子代理细节时）
- `--full` 不截断任何内容（体积会显著变大，仅在需要完整还原工具输出时用）
- `--format json` 只要结构化数据

> 注意：`--no-subagents` 会让后续 analyze 丢失子代理健康度维度，除非明确不需要，否则不要加。

## Step 3. 交接

导出完成后报告产物路径，并询问是否立即进入分析。用户确认后加载 `modules/analyze.md`。

不要在导出后直接通读 `replay.md`——分析有独立的收敛流程。
