# 回放分析 · ae7629e9-82e3-4c63-b029-ab8053120d74

来源：`projects\replay\20261123-PR-Status-Sync-run-01a20802\pr-status-sync\20261123-1845-ae7629e9\replay.json`

## 概览

| 项 | 值 |
| --- | --- |
| 初始诉求 | `You are running as a local coding agent for a Multica workspace.

This task was triggered by an Autopilot in run-only mo` |
| 墙钟 | 0.04h（128s）|
| 墙钟机器执行 | 前台 58s + 后台 0s = 58s（1.0min）（占墙钟 45.7%）|
| 子代理补充 effort | 0s（0.0min）（不与墙钟相加）|
| assistant 轮次 | 10 |
| 工具调用（含子代理） | 12，失败 2（16.7%）|
| 子代理 | 0 个，累计 0s（占 0%）|
| 真实用户输入 | 1 次（含初始诉求）|
| hook 拦截 | 0 |
| output tokens | 6245 |

## 0. 时长分解（真实执行 vs 等待）

口径：从原始 transcript JSONL 逐事件配对 tool_use→tool_result 时间戳；配对结果按工具与 task_type 进入互斥墙钟 bucket；无工具覆盖的相邻活动事件 gap > 60s 归人工闲置，其余归模型思考（启发式，非精确计时）。

| 构成 | 时长 | 占比 | 说明 |
| --- | --- | --- | --- |
| 机器执行 · 前台工具 | 58s（1.0min） | 45.7% | 非等待型主线程工具 |
| 机器执行 · 后台任务 | 0s（0.0min） | 0.0% | TaskOutput task_type=local_bash |
| 等待用户 | 0s（0.0min） | 0.0% | AskUserQuestion 提问到回答 |
| 等待子代理 | 0s（0.0min） | 0.0% | agent wait 或 TaskOutput task_type=local_agent |
| 未分类等待 | 0s（0.0min） | 0.0% | 未知或缺失 task_type 的 TaskOutput |
| 模型思考/生成 | 70s（1.2min） | 54.3% | 事件间 gap ≤ 60s |
| 人工闲置 | 0s（0.0min） | 0.0% | 无工具覆盖的相邻活动事件 gap > 60s |
| **墙钟机器执行合计** | **58s（1.0min）** | **45.7%** | 前台 + 后台 |
| 补充 effort · 子代理 | 0s（0.0min） | - | subagents[].duration_seconds 累计，不与墙钟相加 |
| 闭合差 | 0s（0.0min） | - | 墙钟 − 以上合计（启发式口径允许舍入差） |

## 1. 重复命令（轮询 / 试错信号）

无（未达阈值）

## 2. 失败聚类（同类错误已合并）

| 次数 | 工具 | 错误签名 | 出现于 |
| --- | --- | --- | --- |
| 1 | PowerShell | Exit code 3 $ multica --server-url http:<path>:<num> issue get LEI-49 --workspace-id <guid | MAIN |
| 1 | PowerShell | Exit code 64 用法: rondo tfs writeback --config <repo-registry.json> --issue <KEY> 配置 runtim | MAIN |

样本入参：

- `PowerShell` @ 2026-11-23T10:46:48.338Z → `rondo tfs writeback --issue LEI-49 --config "D:/Multica/default/winning-lil-b39bad65de56/task-4aeb488365ad/workdir/.claude/skills/issue-closeout/config/repo-reg`
- `PowerShell` @ 2026-11-23T10:47:05.413Z → `rondo tfs writeback --help`

## 3. 子代理健康度

无子代理

## 4. 文件返工

无（未达阈值）

## 5. 用户输入点（初始诉求 + 中途干预）

- [2026-11-23T10:45:19.758Z] You are running as a local coding agent for a Multica workspace. This task was triggered by an Autopilot in run-only mode. There is no assigned Multica issue for this run. Autopilot run ID: 01a20802-9

## 6. 工具分布

| 工具 | 次数 | 失败 |
| --- | --- | --- |
| PowerShell | 7 | 2 |
| Skill | 2 | 0 |
| Glob | 2 | 0 |
| Read | 1 | 0 |

---

以上为第 1 层确定性指标。请继续按 `modules/analyze.md`：
第 2 层把每个可疑点归因到「契约缺失 / 外部不稳定 / 流程设计缺陷 / 一次性失误」，
第 3 层仅对 P0/P1 回 replay.md 时间线取证。