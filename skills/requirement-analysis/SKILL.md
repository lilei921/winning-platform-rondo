---
name: requirement-analysis
description: 面向 Intentional Requirement，按需探索现有业务与工程环境，分析需求目标、预期变化、规则、方案与影响；需要需求探索、方案评估或关键意图澄清时使用。
---

# requirement-analysis

## Inputs

- 当前 Requirement / Issue 的目标、来源、已确认决定、授权范围和业务约束。
- 已有业务规则、OpenSpec Specs、系统能力、代码事实及可信 Evidence（如有）。

## Method（按需采用，可往返）

- **Explore**：优先复用已有事实；按需要调查业务规则、相关 Specs、系统能力和实现约束，发现现状/目标差异、可复用机会、规则冲突、风险与未知项，只补影响当前判断的缺口。
- **Analyze**：分析真实目标、预期变化、用户场景、正常/异常/边界规则、In/Out Scope、影响及可验证结果；纯内部调整无 Spec-level Delta 时不制造新的 Requirement / Scenario。
- **Evaluate**：存在实质取舍时比较可行方案、既有能力复用、外部 Contract、依赖及风险，给出有证据支持的推荐及理由；简单需求不强制多个方案。
- **Clarify**：可核实的事实先自行调查；未获授权的关键产品意图或业务选择，即使技术事实充分，也须向调用者返回依据、选项、推荐及影响，供有权者决定。

## Output

按当前需求返回有依据的专业结论、方案建议及必要的验证考虑，区分已确认事实、建议和待授权决定；说明影响当前判断的事实缺口、规则冲突或待决事项。

## Boundaries

- 面向 Intentional 的业务目标、预期行为和方案澄清；不根据 TFS Type 字面分类，发现与既定行为或授权冲突时返回可复核事实供调用方判断。
- 现有代码不自动代表未来产品意图；不越权作出产品决策，不诊断 Corrective Root Cause。
- 不创建/修改 OpenSpec Artifact，不写 Multica Status / Approval / Handoff；工程结果由调用者交给对应工件准备能力消费。
