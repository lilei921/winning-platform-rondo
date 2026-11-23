# session-replay · analyze 模式

对已有回放产物做问题分析，并把确定性指标和归因报告都写入同一回放目录。

## 第 1 层：确定性指标

```powershell
python .agents/skills/session-replay/scripts/replay_analyze.py [<回放目录或replay.json>]
```

留空取 `projects/replay/` 下最新导出。脚本打印报告并默认写入 `<回放目录>/metrics.md`。

统一入口按 `replay.json.provider` 分派 Claude/Codex 时间解析器；旧产物没有 `provider` 时，按 transcript 路径和事件 schema 自动识别。来源判定以回放产物为准，与当前运行时无关。

常用参数：

- `--format json`：输出并留档 `metrics.json`。
- `--out <path>`：指定输出位置。
- `--no-save`：只打印，不落盘。
- `--repeat-threshold N`：重复命令阈值，默认 2。
- `--rework-threshold N`：文件返工阈值，默认 3。

指标包括：时长分解、重复命令、失败聚类、子任务健康度、文件返工、用户输入点、工具分布。不要先通读大型 `replay.md`。

事件明细（取证辅助，与 metrics 同级留档）：

```powershell
python .agents/skills/session-replay/scripts/session_timeline.py [<回放目录或replay.json>]
```

留档为 `<回放目录>/timeline.md`（完整工具调用序列表：时间/域/工具/对象/结果，按时间升序）。对象列对 Task / MCP·TFS / CodeGraph 做语义化描述；回放数据中 TFS 工作项标题乱码时，可先经 TFS 现查后用 `--tfs-titles '{"<工作项ID>": "<标题>"}'` 补注。

## 第 2 层：归因

将每个可疑点归到恰好一类：

| 类别 | 识别特征 | 修复位置 |
| --- | --- | --- |
| 契约缺失 | 参数盲试、schema 不匹配、未知字段 | 对应工具接口定义、技能说明、脚本参数校验与错误提示 |
| 外部不稳定 | 网络、外部服务、偶发空响应 | 重试与入参规范化；必要时外部缺陷 |
| 流程设计缺陷 | 高频成功调用、轮询或状态推进往返 | 对应流程脚本的批量处理、检查点与恢复机制 |
| 一次性失误 | 单次、无模式、成本低 | 不修，写入“已忽略” |

每项结论必须引用时间戳、工具名或错误签名。另检查初始诉求与最终结果是否发生意图偏移。

重复调用不能仅凭命令相同直接归为流程空转。只有同一命令发生在同一执行阶段，且输入不变、输出不变、任务状态没有推进时，才能归因为空转；同一命令在不同阶段成功推进任务状态属于有效的流程执行，不是重复劳动。

## 第 3 层：取证

只对 P0/P1 回 `replay.md` 对应时间戳附近取证。P2/P3 不扩展读取，避免让大体积时间线污染分析。

优先级：

- P0：系统性、稳定复现、修复落点明确。
- P1：系统性但成本中等，或需要修改脚本逻辑。
- P2：效率问题，不影响正确性。
- P3：通用增强，不是本会话特有问题。

## 第 4 层：生成 review.md

analyze 模式必须写 `<回放目录>/review.md`，即使结论是“未发现需治理问题”。问题、证据、用户纠正和改进建议统一记录在这份报告中。使用以下结构：

```markdown
---
title: 会话复盘 · <session前8位>
contract: SessionReplay
version: 1.0.0
status: active
created_at: <YYYY-MM-DD>
updated_at: <YYYY-MM-DD>
owner: winning\li_lei
---

# 会话复盘 · <session-id>

| 项 | 值 |
| --- | --- |
| 回放目录 | `projects/replay/<dir>/` |
| 初始诉求 | `<first_prompt>` |
| 时长 / 轮次 / 调用 | <从 metrics.md 概览抄录> |
| 真实耗时 | <机器执行 + 模型思考 + 子代理 effort 合计（AI 团队总投入口径），数值取自 metrics.md 时长分解> |

## 结论

<1-2 句说明结果是否正确、是否发生意图偏移>

## 问题清单

| # | 现象 | 归因 | 证据 |
| --- | --- | --- | --- |
| 1 | <带数字的可观测现象> | <四类之一> | <时间戳 / 工具名 / 错误签名> |

已忽略（一次性失误）：<列举并说明不修原因；没有则写“无”>

## 优化方案

| 优先级 | 动作 | 落点 | 预期 |
| --- | --- | --- | --- |
| P0 | <可直接执行的动作> | <文件路径> | <量化收益> |

## 后续

<建议优先动作及原因；值得保留的用户纠正或确认及其证据>
```

对话中只返回浓缩结论、问题、方案和 `review.md` 路径，不重复粘贴 `metrics.md`。

## 边界

- 只读 `replay.json` / `replay.md`。
- 只向回放目录写 `metrics.md` / `timeline.md` / `review.md`。
- hook 状态为“不可用”时只陈述缺少历史审计，不推断阻断次数。
- 不自动实施优化方案；后续执行按用户明确指令另行开展。
