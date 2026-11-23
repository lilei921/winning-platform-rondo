---
name: session-replay
description: Use when reviewing, replaying, exporting, or analyzing a Codex or Claude task/session, including requests such as 会话复盘、回放会话、分析这次任务、session replay or transcript analysis.
metadata:
  author: winning\li_lei
  version: 1.1.2
---

# session-replay

Codex 会话导出与跨平台回放分析入口。分析已有产物时以 `replay.json` 的来源为准，不能根据当前运行时猜测来源；平台差异只留在 transcript 解析层。

指定 Multica Issue 的全部 Run 回放使用 [issue-replay](../issue-replay/SKILL.md) 关联来源；本技能负责会话解析、导出与分析。

## 模式路由

| 用户意图 | 模式 | 加载 |
| --- | --- | --- |
| “导出/导入这次会话”“回放刚才任务” | export | `modules/export.md` |
| “分析这次回放”“复盘一下”，且已有回放目录 | analyze | `modules/analyze.md` |
| “复盘这次任务”，且没有现成产物 | export → analyze | 先后加载两个模块 |

Codex 的 export 实现是从本地 transcript **导入并落盘**。不要把“复盘”降级成只生成 `replay.md`；analyze 模式必须形成完整证据链。

## 默认行为：导入并落盘

- 未提供 session ID：使用 `CODEX_SESSION_ID`，其次 `CODEX_THREAD_ID`；无需询问或要求用户确认。
- 直接运行导入命令：

```powershell
python .agents/skills/session-replay/scripts/session_export.py
```

默认在 `projects/replay/<时间>-<session前8位>/` 生成：

- `replay.json`：结构化回放数据
- `replay.md`：可读时间线

完成后报告 session ID 和产物路径。

详细导出流程见 [modules/export.md](modules/export.md)。

## 指定历史会话

用户提供完整 session ID 或唯一前缀时直接执行，不再二次确认：

```powershell
python .agents/skills/session-replay/scripts/session_export.py --session <session-id>
```

只有用户要求选择历史会话但没有给 ID 时，才列出候选：

```powershell
python .agents/skills/session-replay/scripts/session_export.py --list
```

## 完整证据链

| 产物 | 用途 | 生成者 |
| --- | --- | --- |
| `replay.md` | 人读时间线、定点取证 | `session_export.py` |
| `replay.json` | 统一结构化回放 | `session_export.py` |
| `metrics.md` | 第 1 层确定性指标 | `replay_analyze.py` |
| `timeline.md` | 结构化事件序列表（完整工具调用明细：时间/域/工具/对象/结果，人读 / 定点取证） | `session_timeline.py` |
| `review.md` | 归因结论与优化方案 | Codex 按 `modules/analyze.md` 写入 |

用户要求分析或复盘结论时，必须加载 [modules/analyze.md](modules/analyze.md)，生成 `metrics.md`、`timeline.md` 和 `review.md`。不得顺带执行优化动作。

## 供 Issue 回放复用

`scripts/replay_verify.py` 提供 `source_fingerprints`、`verify_replay`，核验公开 `item_completed` 事件及子代理覆盖；返回不支持格式、坏行、未知事件和消息/工具差异，不把缺口视为通过。调用方负责记录导出前后哈希并判断来源稳定性。

`scripts/claude_session.py` 为 Issue 回放提供 Claude 来源发现、多文件合并和公开事件核验；实际会话解析与 Markdown 渲染复用工作区 `.claude/skills/session-replay/scripts/session-export.py`。该适配器始终排除隐藏 thinking，包括 full 模式。

## 边界

- 原始 transcript 只读，来源为 `$CODEX_HOME/sessions` 和 `$CODEX_HOME/archived_sessions`。
- 同一 session 的多个 rollout 文件按 `session_meta.session_id` 合并，不能只取最新文件。
- Codex transcript 不是稳定接口；未知事件跳过，不能因单条事件变化导致整个复盘失败。
- 不读取、展示或推断 `Reasoning.raw_content`、`encrypted_content` 等隐藏推理；只使用公开消息和工具结果。
- hook 审计只统计结构化日志中明确标记的阻断；历史会话无审计记录时显示“不可用”，不得伪报为 0。
- transcript 可能包含敏感内容，默认不要提交或上传原始回放产物。
