---
name: issue-replay
description: 为 Multica Desktop 或 Multica CLI 的指定 Issue 生成执行回放，关联全部 Run 与本地 Codex / Claude session，输出回放、工具时间线及覆盖核验；需要分析时复用 session-replay。适用于“生成 TT-26 回放记录”“回放 Multica Issue”“复盘 Issue 执行过程”。
---

# Issue 回放

将指定 Multica Issue 的执行历史落盘到 `projects/replay/<YYYYMMDD>-<Issue>/`。日期采用北京时间。平台与原始日志只读；产物区分平台状态快照、Run 完成消息和实际回放证据。

## 定位目标

- 使用用户提供的 Issue 编号或完整 UUID，以及明确的 profile、Workspace。优先复用当前对话已确认的环境；缺少或有歧义时，读取已有 CLI 配置中的环境信息或询问，不输出、复制认证信息。
- Desktop 与 CLI 使用同一套 `multica` 只读命令。Desktop 使用其已配置的 profile；CLI 使用用户实际配置的 profile，不根据 Issue 前缀猜环境，不自动登录或改配置。
- 支持本地 Codex 与 Claude transcript。根据 Run 的 provider 元数据选择来源；没有声明时只接受唯一匹配的 provider，冲突时保留缺口。优先按 Run 的 `result.work_dir`、`work_dir` 查找相邻 `codex-home` / `claude-home`，补查默认 home；Claude 还支持 `CLAUDE_CONFIG_DIR` 与 `work_dir/.claude`。按完整 session ID 查找 `projects/*/<session-id>.jsonl` 及同名 session 目录内的子代理。
- 脚本依赖相邻的 [session-replay](../session-replay/SKILL.md)。依赖缺失时先报告，不复制一份解析器或误导出当前聊天。

## 生成记录

从根工作区运行，替换以下占位参数：

```powershell
python .agents/skills/issue-replay/scripts/issue_replay.py TT-26 --profile <profile> --workspace-id <workspace-uuid>
```

可选参数：

- `--cli <可执行文件>`：指定 Multica CLI；默认使用 `MULTICA_CLI_PATH` 或 PATH 中的 `multica`。
- `--server-url <URL>`：显式指定服务端；缺省遵循 CLI profile（存在 `MULTICA_SERVER_URL` 时沿用并记录）。
- `--codex-home <目录>` / `--claude-home <目录>`：补充对应 provider 的本地 home，可重复指定，不修改运行配置。
- `--out-root <目录>`：更换回放根目录，适用于隔离验证或不同 Workspace 出现同日同编号冲突。
- `--full`：不截断公开消息与工具结果文本；默认沿用共享导出器的截断设置。任何模式都不导出隐藏 thinking 或签名。

脚本读取 Issue、全部 Run 及本次 Run 对应的 Agent 名称；通过相同 profile、Workspace 的 `multica agent get` 查询，只保存 ID、名称和采集时间，不保存 Agent 配置或环境变量。以完整 session ID 关联日志；同一 session 的多个 Run 只导出一次，多个 rollout 合并。不会默认排除子代理。日志与身份不能匹配时留明缺口，不用目录名、最新会话或其他 Issue 替代证据。

输出结构：

```text
projects/replay/<YYYYMMDD>-<Issue>/
├── replay.md
├── issue-replay.json
├── evidence/
│   ├── issue.json
│   ├── runs.json
│   ├── agents.json
│   └── source-manifest.json
├── wayfinder/
│   └── <时间-session前缀>/
│       ├── replay.json
│       ├── replay.md
│       └── timeline.md
└── bug-fix/
    └── <时间-session前缀>/
        ├── replay.json
        ├── replay.md
        └── timeline.md
```

Agent 分组直接位于 Issue 根目录，没有 `sessions` 中间层：

- 名称规范化为目录名（如 `Bug Fix Agent` → `bug-fix`）；同名、保留目录名或 Windows 保留名使用 ID 后缀区分。
- `agent_directories` 保存 Agent ID 到目录的稳定映射；Agent 改名更新展示名称，复用已有目录。
- 名称查询失败时显示 `agent-<ID前缀>` 并记录名称提示，不影响公开事件完整性结论；缺少 Agent ID 使用 `agent-unknown`。
- 同一 session 涉及多个 Agent 时放入 `shared`，入口列出全部 Agent，仍只导出一次。
- 入口按 Run 开始时间排列，展示 Agent、北京时间、Run 数、工具调用数及链接；完整 Run/session ID 放在对应关系表和 JSON 中。
- 已登记的旧 `sessions/<会话目录>` 自动迁至对应 Agent 目录。移动前校验源/目标在本 Issue 内及完整 session ID，遇到目标冲突停止；完整目录一起移动，保留人工分析文件。只清理迁移后为空的旧目录，逐步保存路径映射供中断重试。

任务级索引用 `issue-replay.json`；会话级 `replay.json` 保持共享格式。同一目录再次导出先校验 profile、显式服务地址、Workspace、Issue UUID；身份冲突停止并要求使用不同输出根目录，不覆盖其他任务。更新生成文件，保留人工 `review.md` 等内容；旧分析基于旧快照，不能自动当作本次结论。

## Autopilot 回放

同一套导出与核验也适用于 Autopilot 的 Run（如定时同步任务）：

```powershell
python .agents/skills/issue-replay/scripts/autopilot_replay.py <autopilot-uuid> --workspace-id <workspace-uuid> --last 1
```

- `--last N` 采集最近 N 次 Run，默认 1；`--profile` 可省略，缺省沿用 CLI 当前配置，其余只读参数与 Issue 模式一致。
- Autopilot Run 窗口采用 `triggered_at → completed_at`，Agent 取 Autopilot 的 assignee；原始字段保留在 `evidence/runs.json`，主体快照为 `evidence/autopilot.json`（含适配用的 `identifier`）。
- 单次 Run 目录为 `<YYYYMMDD>-<标题>-run-<Run前缀>/`，多次合并为 `<YYYYMMDD>-<标题>/`；索引仍复用 `issue-replay.json`，并以 `subject_type: autopilot` 区分。

## 验证与交付

- 退出码 `0`：快照覆盖完整；`2`：已落盘但有缺口；`1`：采集、身份校验或写入失败。
- `source-manifest.json` 记录来源路径、大小、SHA-256、公开工具事件 ID/次数/顺序、消息比对、各 provider 的 Run 执行区间覆盖、坏行、未支持事件和子代理核验。导出前后来源哈希变化时不报告完整。
- 运行中的 Run、缺失 session/log、不支持的 provider 或日志格式均明确报告 `partial`。旧版非 `item_completed` 日志可由共享导出器导出，但当前完整性核验不支持，不能标为完整。
- Codex 完整性按 `item_completed` 粒度及 `task_started/task_complete` 执行区间核验。`response_item` 中的 `exec` 编排外壳单独统计，注入的运行上下文不重复算作用户消息；只含旧格式的 rollout 或未被完成事件覆盖的其他旧工具/Assistant 消息标为缺口。
- Claude 复用 `.claude/skills/session-replay/scripts/session-export.py`，核验公开消息、`tool_use/tool_result` 的顺序、结果与错误标志，并合并恢复日志、检查子代理。每个 Run 必须匹配执行窗口内的公开请求与最终回复（首请求允许平台开始登记最多延迟 5 秒）；优先与平台最终输出比对，平台无输出时要求原生 `end_turn`。缺失结果、身份不符、未知事件、重复冲突或 Run 证据缺失均为 `partial`，不伪造 Codex 任务边界。
- `complete` 表示采集到的 Run 与公开完成事件覆盖通过，不表示 Issue 业务完成，也不表示回放是原始日志逐字副本。工具失败次数不等于回放生成失败。
- 仅要求生成记录时，交付入口路径、Run/session/工具调用数、覆盖结果和缺口，不通读整份大日志。

如果用户要求“分析/复盘结论”，按 [session-replay analyze](../session-replay/modules/analyze.md) 对索引中每个明确的 session 路径生成 `metrics.md`、`timeline.md`、`review.md`，再汇总 Issue 级结论。不能把任务级索引传给会话分析器，也不能使用“默认最新会话”替代指定来源。

提交、推送遵循仓库现有授权规范。只有用户要求时执行，检查本次产物的敏感内容，仅暂存本次文件；不将原始 transcript、认证配置或其他任务改动带入提交。脚本不执行 Git、平台评论、状态变更或任务重跑。
