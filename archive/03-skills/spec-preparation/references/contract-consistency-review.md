# Intentional Artifact Consistency Review（按需参考）

**用途**：在已有专业需求结论与当前 OpenSpec Change 的基础上，按需检查实际受影响工件之间的一致性。本文件是可复用的只读检查参考，**不是独立 Reviewer Skill、Run 或 Gate**，不决定专业需求意图。

- **Goal / Scope ↔ Proposal / Specs**：核实当前已确认的意图、范围与 Spec-level 行为变化相符；无 Delta 时只在合法 `skip_specs` 条件下省略，不制造 Requirement。
- **Specs ↔ Tasks / Verification**：实际存在的 Requirement + Scenario 与实现任务、各 Task 验证方式和必要的 Change-level Verification 对应；不存在 Specs 时使用当前适用 Proposal、主规格与 Tasks 的验证依据。
- **Conditional Design ↔ Tasks**：当前变化实际需要技术决策时应有足够 Design 支撑；不适用时不为检查制造空 Design。涉及 API、权限、数据、兼容或迁移的关键选择与 Tasks 一致。
- **Evidence / Decisions / Risk**：已确认业务决定与专业推荐、未解决问题保持区分；新证据或定向返工改变结论时只复核受影响范围，关键 blocker 不能被工件完整性掩盖。

## 验证适度性

依据 [任务写法契约的验证方式选择](tasks-md-authoring-contract.md#2-验证方式选择)，检查：

- 验证范围是否对应实际改动及可解释的回归风险？
- 是否优先复用了现有、足以证明行为的验证方式？
- 是否把 Spec 场景数量、页面可见变化或缺少测试框架，直接当成必须 E2E 的依据？
- 若要求真实环境或完整业务链路，是否说明其必要性及环境依赖？
- 是否明确区分开发完成条件与人工验收建议？

发现过度验证要求时，由工件维护方在提交人工审核前修订任务；已批准契约的调整按现有变更流程处理。本参考不直接修改工件或审批事实。

最终专业 Review、Verdict / Findings 与交付事实的 Owner 由调用方的 Agent Instructions / 现有交付契约决定，本 Reference 不产生或写入这些结果。具体 Artifact 格式、路径、依赖、Template 和 Schema 要求始终来自当前 OpenSpec CLI / Schema；本文不重复定义。
