---
name: issue-replay
description: 为 Multica Desktop 或 Multica CLI 的指定 Issue 生成执行回放，关联全部 Run 与本地 Codex / Claude session，输出 Agent 分组回放、工具时间线及覆盖核验；需要分析时复用 session-replay。适用于“生成 TT-26 回放记录”“回放 Multica Issue”“复盘 Issue 执行过程”。
---

# Issue 回放

这是 Claude Code 的发现入口；执行流程、输出契约与脚本统一维护在工作区 `.agents/skills/issue-replay/`。

1. 完整读取并遵循[共享 Skill](../../../.agents/skills/issue-replay/SKILL.md)，结合用户指定的 Issue、profile 和 Workspace 执行。
2. 从工作区根目录运行共享脚本；共享 Skill 内的相对链接以它所在的目录解析，不相对于本入口解析。
3. 按 Run 证据选择会话来源；在 Claude Code 中调用本技能，不代表目标日志来自 Claude。支持范围与缺口处理以共享 Skill 为准。需要分析时，按共享 Skill 引用的 analyze 模块处理明确的会话路径。

使用 `/issue-replay <Issue 及环境信息>`，也可由匹配描述的自然语言请求触发。
