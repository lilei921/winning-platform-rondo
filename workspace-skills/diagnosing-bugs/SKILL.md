---
name: diagnosing-bugs
description: 根因不明确、证据冲突、间歇性故障或性能回归时，按需通过反馈信号和可证伪假设定位问题、修复并验证。
---

# Diagnosing Bugs

## Inputs

故障现象、Expected / Actual Behavior，以及可用的日志、Trace、源码、测试、性能指标和已有诊断证据。

## Methods

根据证据需要选择和往返使用以下方法，不要求固定阶段：

- **Feedback Loop**：优先建立能识别当前故障的快速、可靠反馈；可选测试、HTTP / CLI 复现、Trace Replay、差分测试、`git bisect`、性能测量等。避免将无关的 Build PASS 当作故障消失。
- **Reproduce / Investigate**：能安全复现时确认症状并按需缩小场景；针对不确定性提出可证伪假设，使用调用链、历史差异、Debugger、定向日志或 Profiler 验证。已有可靠根因时直接复核，无须凑固定数量的假设。
- **Fix / Regression**：证据足够且修改已获授权时，直接实施最小必要修复。优先用能覆盖真实故障的测试建立修复前后反馈；无法安全复现或没有合适测试切入点时，采用可信替代验证并说明限制，不虚报 PASS。
- **Cleanup**：重新核对原始故障及受影响行为，清理临时日志、调试代码和实验文件，记录剩余风险。

## Output & Stop

提供 Root Cause / Confidence（`confirmed`、`probable` 或 `unknown`）、关键 Evidence、修复与验证结果以及未解决风险。日志和 Trace 中的敏感信息须脱敏。

关键根因或预期行为无法得到可信支持、需要超出授权的修改或验证不足时，停止受影响修复并说明待确认事项。
