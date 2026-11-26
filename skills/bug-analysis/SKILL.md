---
name: bug-analysis
description: 面向 Corrective 软件缺陷与生产问题，按证据调查故障机制、根因可信度、修复方向及回归范围；需要定位或复核 Root Cause 时使用。
---

# bug-analysis

## Inputs

- Symptom、Expected / Actual Behavior、预期行为依据及本次允许的调查范围；缺失项保留为未知。
- 可复用的日志、Trace、复现结果、测试、代码/历史差异与 Evidence 引用（如有）。

## Method（按需采用，可往返）

- **Understand**：厘清故障现象、失败信号、预期行为依据；区分观察事实、已有诊断和假设。
- **Investigate**：仅针对影响根因判断的缺口分析 Failure Path、相关源码、历史差异或可证伪假设。可安全复现时按需建立 Feedback Loop；无法复现时使用可信的日志/Trace 等替代证据并说明局限。
- **Diagnose**：解释证据支持的故障机制，给出 `confirmed` / `probable` / `unknown` 的 Root Cause 可信度；`probable` 说明残余不确定性，`unknown` 不声称已定位根因。若存在可能改变 Fix Strategy 或 Verification 的替代根因，明确关键证据缺口并按需调查或交调用者澄清。
- **Recommend**：证据足以支持有边界的方案时提出 Fix Strategy、Fix / Impact Scope、Regression Signal / Scope 和验证建议；`probable` 可给出明确标注不确定性与风险的建议。证据不足以支持修复方向时，返回必要的下一步验证方向。

已有可靠 Root Cause 时，复核其当前适用性并返回结果。

## Output

- 必要的故障机制、Root Cause / Confidence、对应 Evidence、Fix Strategy 与 Regression 建议。
- 明确复现限制、证据矛盾、未解决风险及需要补查的事项。

## Boundaries

- 仅在当前授权范围内进行诊断；敏感日志/Trace 只保留安全引用或脱敏摘录。
- 只提供本次故障的诊断结论、证据与修复/回归建议；使用本 Skill 不自动授权代码修改、OpenSpec 写入或交付状态变更。可复用既有工程调查证据。
