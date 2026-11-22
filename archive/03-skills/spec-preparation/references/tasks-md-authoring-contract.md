# OpenSpec tasks.md 工程任务写法契约

> D3-B（2026-11-10）现行规则：本 Reference 只维护 Engineering Contract；原 `workitem-analysis/references/tasks-md-authoring-contract.md` 为 Retired 历史快照，不再作为新 Run 的权威来源。TFS Task、工时与管理投影由外部 `rondo tfs writeback` 处理。

## 1. 工程 Task

- `tasks.md` 描述可实施的 Implementation Tasks，以及任务内必要的 Verification；只有多个 Task / Module / Repository / Journey 组合后才能证明的行为，才新增 Change-level Verification Task。
- 使用 OpenSpec 原生 checkbox 和稳定数字编号（如 `- [ ] 1.1 ...`），便于 Engineer 和后续 Tool 引用 `change_ref + task_refs`。明确任务范围、预期结果、依赖及足以证明完成的验证方法；不强制人为固定拆分步骤。
- 可在首句使用简短的“动作 + 对象”表述，让工程任务便于阅读；实施细节和验证要求必须足够清晰，不因标题简化丢失需求或验收信息。
- 任务粒度由工程独立性、真实依赖、可执行性与可验证性决定；**不因 TFS 任务数量、6h 上限、TFS 管理字段而拆分 OpenSpec Task**。
- 不强制 `[预估: Nh]` 或任何 TFS 工时字段；缺少工时绝不构成 Analysis Gate / Human Analysis Review 失败的理由。没有可信工程依据时不填造小时数。

## 2. 验证方式选择

- 根据实际改动及风险，选择足以证明任务完成的最小验证方式，优先复用目标仓现有测试能力。
- 区分开发必做验证与人工验收建议；只有开发必做项进入任务完成条件。
- Spec Scenario 描述预期行为，不自动要求逐项执行浏览器或端到端测试。
- 仅当关键行为依赖真实系统组合且现有较低层验证不足，或用户明确要求时，将端到端验证列为必做项；说明具体风险、已有验证的不足（如适用）及环境依赖。
- 上述规则同时适用于任务内验证和独立验证任务。

## 3. 外部管理引用（不属于本文写法要求）

TFS 的 `tfs.type` 管理规则、子任务创建/复用、字段填报与状态回读由 `rondo tfs writeback` 消费当前批准的工程引用并执行；允许无预估。已有合法 `[预估: Nh]` 尾注仅在旧工件中作为兼容输入，不据此要求新的 OpenSpec Tasks 添加尾注。真正的工时管理口径由外部 TFS 管理规则决定。

此处不创建并行 Task Mapping Store、新的 Task 实体或独立 Task Progress 规则。
