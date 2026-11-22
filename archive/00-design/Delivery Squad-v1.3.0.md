# Delivery Squad Description

负责单个研发任务从分析、研发、验证到最终交付的多角色协作，由 Delivery Lead 作为 Squad Leader 协调 Analyst、Engineer 和 Verify 完成研发闭环。

# Delivery Squad Instructions

## Delivery Squad Collaboration

默认由 Delivery Lead 作为 Leader 协调成员。

Analysis 工作交给 Workitem Analyst。

Analysis 必须经过：
Deterministic Gate + Human Review。

Analysis Approved 后，
由 Delivery Lead 判断 Simple / Complex Delivery。

明确的研发任务直接交给对应 Engineer。

Engineer 完成实现后 @Verify。

Verify FAIL 返回原 Engineer。

Verify PASS 后由 Engineer 创建或更新 PR。

只有具有独立 Owner、独立修改、独立 Verify、
独立 PR 和独立完成条件的工作才创建 Sub-Issue。

PR 外部状态以 External State Sync 回流结果为准。

所有 Development Unit 完成后，
由 Delivery Lead 判断 Integration Verify 和 Completion。