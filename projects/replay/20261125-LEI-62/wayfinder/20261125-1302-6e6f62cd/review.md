---
title: 会话复盘 · 6e6f62cd
contract: SessionReplay
version: 1.0.0
status: active
created_at: 2026-11-25
updated_at: 2026-11-25
owner: winning\li_lei
---

# 会话复盘 · 6e6f62cd-094f-4351-b175-67f8d8b49fab

| 项 | 值 |
| --- | --- |
| 回放目录 | `projects/replay/20261125-LEI-62/wayfinder/20261125-1302-6e6f62cd/` |
| 初始诉求 | Multica 分配 LEI-62（TFS 268376），按 Wayfinder 角色完成准入评估与 Decision 记录 |
| 时长 / 轮次 / 调用 | 269s / 57 轮 / 59 次工具调用（失败 3） |
| 真实耗时 | 前台工具 60s + 模型思考/生成 210s + 子代理 0s = 270s |
| 证据文件 | `metrics.md`、`timeline.md`、`replay.json`、原始 transcript（见 `replay.json.transcript`） |

## 结论

Wayfinder 完成了准入判断（`eligible`）并执行交接，但全程 **0 次 remote-\* MCP 调用**：session 开始时 `mcp__remote-codegraph__codegraph_explore` 已作为直接工具暴露，`remote-filesystem` / `remote-ripgrep` 在 deferred tools 列表中；Agent 曾在思考中提到可用 remote-ripgrep / filesystem，随后转向本地 checkout + Grep/Read 路径，没有再回来加载或调用。不是 MCP 报错或权限拒绝——transcript 中没有相关失败事件。

## 问题清单

| # | 现象 | 归因 | 证据 |
| --- | --- | --- | --- |
| 1 | 工具数 59，remote-\* 调用 0；唯一 MCP 调用是 `mcp__tfs-mcp__tfs_get_workitem` 1 次 | 契约缺失 | `agents/wayfinder-agent/instructions.md:20-26` 与本次 runtime `CLAUDE.md:43-50` 只写"优先**按需**使用已授权 MCP"；`codebase-explorer/SKILL.md:17` 同时允许"只读检索、文件读取或已有 CodeGraph 索引"。没有"先 MCP、失败才 checkout"的硬顺序，也没有 Decision 证据回查要求 |
| 2 | 05:03:59z 思考明确说"we can also search via remote-ripgrep MCP or filesystem. Let me check what's available locally"，之后 05:03:43z checkout 根仓、05:04:08z checkout 业务仓、05:04:19z 用本地 Grep 搜中文日志文本，未再尝试 MCP | 契约缺失（同一根因的决策点） | transcript assistant 思考（line 134）、`timeline.md` #28/#32/#33；`ToolSearch` 全程仅 1 次且查询是 TFS 工具（timeline #30 / 05:03:58z） |
| 3 | 同一 Workspace 的历史 Wayfinder Run（LEI-49/52/53/56/57）各用 9–13 次 remote MCP；本次 Run 为 Claude provider，历史为 Codex provider。Claude runtime 中仅 remote-codegraph 直接暴露，remote-filesystem/ripgrep 需 ToolSearch；Codex runtime 中三者均为普通 McpToolCall | 流程设计缺陷 | 历史 `timeline.md` 的 `McpToolCall(server=remote-*)`；本次 `api-request-shape` 的 tools 列表与 `deferred_tools_delta`；`workspace-config/workspaces/winning-lilei.json` 三个 MCP 均已配置 |

已忽略（一次性失误）：3 次工具失败（`note` 子命令不存在、`issue list --limit 200`、Bash 语法）与 remote MCP 未使用无因果关系，不在此修。

## 优化方案

| 优先级 | 动作 | 落点 | 预期 |
| --- | --- | --- | --- |
| P1 | 把"优先按需"改成可执行的取证顺序：工程证据先 `remote-codegraph`（带 `projectPath`）→ `remote-filesystem` / `remote-ripgrep`；仅当 MCP 报错或明确无索引时才用 `multica repo checkout` + 本地 Grep/Read，并在 Decision 的 `evidence_refs` 注明回退原因 | `agents/wayfinder-agent/instructions.md:20-26`、`workitem-triage/SKILL.md`、`codebase-explorer/SKILL.md` 的调查方法 | 消除"考虑过 remote 但转到本地就不再回来"的决策漂移，让准入证据可核查 |
| P2 | 对齐 Claude runtime 的 MCP 暴露：在 ToolSearch 提示或 skill 中给出确切查询串 `select:mcp__remote-filesystem__*,mcp__remote-ripgrep__*`，或像 Codex 一样直接暴露只读工具；并在 Decision 记录模板加一项"remote MCP 使用/回退"自检 | Multica workspace MCP 配置 / runtime 模板 + 上述 instructions | 降低 deferred tool 发现成本；避免同一 Agent 在不同 provider 下工具行为不一致 |
| P3 | 回放核验增加"Agent 指令声明的必需工具与实际工具分布"对照，偏离时提示 | issue-replay 的分析模块 | 后续 Run 自动暴露同类偏离，无需人工翻 transcript |

## 后续

建议先做 P1：这次不是工具不可用，而是软性指令被本地路径绕过；只改 runtime 暴露不能约束 Agent 主动选择。P2 用于消除 Claude/Codex 差异，P3 用于长期监测。历史 Run 使用 remote MCP 的事实说明配置本身可用，无需先做连通性排查。
