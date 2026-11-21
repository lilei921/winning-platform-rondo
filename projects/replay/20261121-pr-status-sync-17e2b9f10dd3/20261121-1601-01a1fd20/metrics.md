# 回放分析 · 01a1fd20-1e30-7cd1-89cd-f32064d7b29d

来源：`projects\replay\20261121-pr-status-sync-17e2b9f10dd3\20261121-1601-01a1fd20\replay.json`

## 概览

| 项 | 值 |
| --- | --- |
| 初始诉求 | `You are running as a local coding agent for a Multica workspace.

This task was triggered by an Autopilot in run-only mo` |
| 墙钟 | 0.19h（701s）|
| 墙钟机器执行 | 前台 565s + 后台 0s = 565s（9.4min）（占墙钟 80.7%）|
| 子代理补充 effort | 0s（0.0min）（不与墙钟相加）|
| assistant 轮次 | 7 |
| 工具调用（含子代理） | 38，失败 7（18.4%）|
| 子代理 | 0 个，累计 0s（占 0%）|
| 真实用户输入 | 1 次（含初始诉求）|
| hook 拦截 | 不可用（覆盖未知）|
| output tokens | 8583 |

## 0. 时长分解（真实执行 vs 等待）

口径：使用 Codex item_completed 的工具起止时间；配对结果按工具与 task_type 分类；各墙钟 bucket 互斥，事件间隙仅表示未被工具区间覆盖的时间（启发式），不等同于人工闲置或模型思考。

| 构成 | 时长 | 占比 | 说明 |
| --- | --- | --- | --- |
| 机器执行 · 前台工具 | 565s（9.4min） | 80.7% | 非等待型主线程工具 |
| 机器执行 · 后台任务 | 0s（0.0min） | 0.0% | TaskOutput task_type=local_bash |
| 等待用户 | 0s（0.0min） | 0.0% | AskUserQuestion 提问到回答 |
| 等待子代理 | 0s（0.0min） | 0.0% | agent wait 或 TaskOutput task_type=local_agent |
| 未分类等待 | 0s（0.0min） | 0.0% | 未知或缺失 task_type 的 TaskOutput |
| 未被工具区间覆盖的时间（启发式） | 136s（2.3min） | 19.3% | 仅表示区间未覆盖，不作活动归因 |
| **墙钟机器执行合计** | **565s（9.4min）** | **80.7%** | 前台 + 后台 |
| 补充 effort · 子代理 | 0s（0.0min） | - | subagents[].duration_seconds 累计，不与墙钟相加 |
| 闭合差 | 0s（0.0min） | - | 墙钟 − 以上闭合口径（允许舍入差） |

## 1. 重复命令（轮询 / 试错信号）

无（未达阈值）

## 2. 失败聚类（同类错误已合并）

| 次数 | 工具 | 错误签名 | 出现于 |
| --- | --- | --- | --- |
| 1 | CommandExecution | 目录: <path> Mode LastWriteTime Length Name ---- ------------- ------ ---- d----- <num>/11/2 | MAIN |
| 1 | CommandExecution | 用法: rondo pr reconcile-status --config <repo-registry.json> [--issue <KEY> \| --recover-don | MAIN |
| 1 | CommandExecution | 用法: rondo delivery finalize --phase prepare\|complete --issue <KEY\|id> --config <repo-regis | MAIN |
| 1 | CommandExecution |  | MAIN |
| 1 | CommandExecution | 用法: rondo tfs writeback --config <repo-registry.json> --issue <KEY> 配置 runtime.root_branch | MAIN |
| 1 | CommandExecution | rondo —— TFS <num> 确定性 CLI(stdout 只出 JSON;退出码 0/2/3/64) 配置(环境变量优先,config<path> 兜底): TFS_PA | MAIN |
| 1 | CommandExecution | $ multica --server-url http:<path>:<num> issue get LEI-49 --workspace-id <guid> --output j | MAIN |

样本入参：

- `CommandExecution` @ 2026-11-21T08:02:32.623Z → `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -Command Get-ChildItem -Force; rg --files -g 'repo-registry.json' -g 'tasks.md' -g 'analysis*' -g '*.j`
- `CommandExecution` @ 2026-11-21T08:03:02.274Z → `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -Command rondo pr reconcile-status --help`
- `CommandExecution` @ 2026-11-21T08:05:11.132Z → `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -Command rondo delivery finalize --help`
- `CommandExecution` @ 2026-11-21T08:05:11.132Z → `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -Command rondo delivery root-clone --help`
- `CommandExecution` @ 2026-11-21T08:05:11.132Z → `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -Command rondo tfs writeback --help`
- `CommandExecution` @ 2026-11-21T08:05:11.132Z → `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -Command rondo pr get --help`
- `CommandExecution` @ 2026-11-21T08:13:28.152Z → `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -Command rondo tfs writeback --issue LEI-49 --config 'D:/Multica/desktop-172.17.1.97-8080/winning-lil-`

### 独立命令异常信号

无

## 3. 子代理健康度

无子代理

## 4. 文件返工

无（未达阈值）

## 5. 用户输入点（初始诉求 + 中途干预）

- [2026-11-21T08:01:47.330Z] You are running as a local coding agent for a Multica workspace. This task was triggered by an Autopilot in run-only mode. There is no assigned Multica issue for this run. Autopilot run ID: 01a1fd1f-a

## 6. 工具分布

| 工具 | 次数 | 失败 |
| --- | --- | --- |
| CommandExecution | 38 | 7 |

---

以上为第 1 层确定性指标。继续按 analyze 模块做归因，并只对 P0/P1 回 replay.md 取证。