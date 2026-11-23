---
name: session-replay
description: 导出并回放分析 Claude Code 会话 transcript，识别返工、无效工具调用、意图偏移、可沉淀经验，产出优化方案。触发词："导出会话"、"回放会话"、"分析这次会话"、"session-replay"、"复盘这次任务"、"分析回放"。
metadata:
  author: winning\li_lei
  version: 0.4.2
---

# session-replay

会话复盘入口。所有产物集中写在 `projects/replay/<导出目录>/`，不修改仓库任何其他文件，不通过 hook 自动触发——只在用户显式要求时执行。

指定 Multica Issue 的全部 Run 回放使用 [issue-replay](../issue-replay/SKILL.md) 关联来源；单个 Claude Code 会话的导出和分析按下述流程执行。

## 两种模式

| 场景 | 模式 | 加载文件 |
|---|---|---|
| "导出这次会话"、"回放一下刚才的任务" | export | `modules/export.md` |
| "分析这次回放"、"复盘一下"、已有导出产物 | analyze | `modules/analyze.md` |
| "复盘这次任务"（无现成产物） | export → analyze | 两个都加载，先导后析 |

判断依据：`projects/replay/` 下是否已有目标会话的导出产物。有就直接 analyze，不要重复导出。

## 何时使用

- 用户想知道某次任务过程中有没有绕路、返工、被 hook 拦截
- 用户想把一次会话的问题转成可执行的优化方案

不用于：日常代码开发、TFS/OpenSpec 工作流本身。

## 产物

一次完整复盘在 `projects/replay/<YYYYmmdd-HHMM>-<session前8位>/` 下留五份，构成证据链：

| 文件 | 层级 | 产出方 |
|---|---|---|
| `replay.md` | 原始时间线（人读 / 定点取证） | `scripts/session-export.py` |
| `replay.json` | 结构化转录 | `scripts/session-export.py` |
| `metrics.md` | 第 1 层确定性指标 | `scripts/replay-analyze.py` |
| `timeline.md` | 结构化事件序列表（完整工具调用明细：时间/域/工具/对象/结果，人读 / 定点取证） | `scripts/session-timeline.py` |
| `review.md` | 归因结论 + 优化方案 | LLM 按 `modules/analyze.md` 模板写 |

三个脚本只读源数据，只往回放目录写，可以放心直接执行。

## 复盘结论的保存

问题、证据、用户纠正和改进建议统一记录在当前回放目录的 `review.md`，保留优先级、修复位置及建议先做哪一项的理由。原始回放、指标和事件时间线与报告同目录保存，后续实施按用户明确指令另行开展。

## 硬约束

- 不要把 `replay.md` 整体读进上下文——它常有几十万字符。分析走 `replay-analyze.py`，取证走定点 grep。
- 不要主动删除 `projects/replay/` 下的产物；用户要求清理时先确认再删。
- analyze 只产出方案，不自动执行优化动作。
