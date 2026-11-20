# Workitem Analyst 配置资产

Delivery Squad 的分析成员：负责当前 Issue 的需求与问题分析、技术变更性质判断、研发准备、Verify Recommendation 和人工审核提交。执行边界与交付要求见 [instructions.md](instructions.md)，专业设计见 [03 Workitem Analysis](../../03-workitem-analysis-design.md)。

## 资产

- [description.md](description.md)：用于 Agent 展示。
- [instructions.md](instructions.md)：长期角色职责与边界。
- [codebase-explorer](../../skills/codebase-explorer/SKILL.md)：按需定位工程事实与依赖。
- [bug-analysis](../../skills/bug-analysis/SKILL.md)：Corrective 根因诊断。
- [requirement-analysis](../../skills/requirement-analysis/SKILL.md)：Intentional 需求探索与方案分析。
- [spec-preparation](../../skills/spec-preparation/SKILL.md)：CLI-only 工程工件准备。
- [analysis-completion](../../skills/analysis-completion/SKILL.md)：分析收口与状态写入。

**Retired（保留源文件）：** 原 [workitem-analysis](../../skills/workitem-analysis/SKILL.md) 不再是 Workitem Analyst 的有效执行 Skill，已退出受管清单与 Agent 绑定，目录及 References 暂不删除；现有远端对象需根据实际 Workspace Provision / 回读确认未再绑定。

## 注册与维护

Agent、Skill 绑定及 Squad 成员由 [provisioning.json](../../workspace-config/provisioning.json) 维护；使用 `rondo workspace provision` 收敛平台对象，`rondo workspace sync` 发布 Skill 内容。远端状态须回读确认，仓内记录不代表当前 Runtime 或工作区发布结果。

Issue 的入口分流以 [rondo delivery handoff](../../../../tools/rondo/src/commands/delivery/handoff.ts) 为准。

分析在当前 Delivery Issue 内完成，不新建 Analysis Child Issue；工程依据沉淀到当前 OpenSpec Change 的适用工件中。TFS Type、Technical Change Kind 和 OpenSpec Schema 是不同维度。Workitem Analyst 提供 `change_kind`，由 `analysis-completion` 持久化为 Multica Issue Metadata `analysis.change_kind`，供交付记录和统计；当前 OpenSpec Change 的 Schema 仍是工程契约依据，Gate 核对二者一致。提交 `analysis_review` 后等待 Human Analysis Review，不自行启动研发。
