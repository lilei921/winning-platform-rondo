# Bounded Diagnosis（有界诊断升级）

> **本文件为有界诊断升级方法的唯一权威**（语义背景：04 §12.2 进入条件与边界、§6.4 Diagnostic Method 调用契约，根级现行版 `projects/multica/04-engineer-development-design.md`）。本文件是 `development-execution` 的内部 Method，只产生当前 Finding / Evidence，不拥有 Run / Issue / 交付状态。

## Use When（进入条件，04 §12.2）

- Root Cause Evidence 与代码事实冲突；
- 修复后原 Failure 仍存在，或出现新增 Failure；
- 无法形成必要反馈（Signal 建立失败）；
- 依赖 / 环境显著偏离批准假设；
- 影响范围可能超过批准边界。

**不进入**：`root_cause.status=probable` 本身不构成重分析理由（04 §12.2）——只有新事实影响已批准 Fix Strategy / Scope / Verification 正确性时才实质升级。

## Input

- 观察到的 Failure（症状、Expected / Actual）；
- 当前 `task_refs`、Approved Fix Strategy、Candidate / Code Context、现有 Evidence、允许的诊断范围。

## Procedure（有界）

```text
Observed Failure
→ Reproduction / Feedback（可行时）
→ Minimal Failure Path
→ Hypotheses + Discriminating Evidence
→ New Finding / Effect on Approved Analysis
→ 批准边界内继续 OR STOP / Escalate
```

上述 Procedure 是本目录可实际加载的 Project-native 有界诊断方法，由 `development-execution` 按需使用；不依赖当前未配置的 `bug-analysis` Runtime Skill 或跨 Skill 文件发现，也不创建新 Agent/Workflow。

## Output

- Reproduction / Feedback Signal、Hypotheses、Finding、Evidence Refs；
- 受影响 `task_refs` / Scope、残余不确定性、是否冲突于已批准 Analysis。

## Allowed Effects

- 按当前 Engineer 权限做有界检查（读代码、跑复现、加临时观测）。

## Forbidden Effects（04 §6.4）

- 不修改 Multica Status、不创建 Issue / Agent、不擅改 Corrective Proposal 或批准 Scope；
- 不在 Development 中生成新的 Corrective Proposal、不重复完整 Requirement Analysis；
- 不无界重试：同类 Finding / Blocker **诊断上限 3 轮**，不收敛即停止升级（04 §12.3）。工具报错与文件目视事实矛盾时，第 1 轮必须先排除解析层假阳性（行尾 CRLF / 编码 / 编号重复），再最小复现验证；禁止修改工具源码或绕过目标文件继续执行。

## Stop

- 证据不足 → 返回 UNKNOWN / blocker；
- 新事实推翻已批准 Contract → 停止自主修复并升级（交 Delivery Lead 协调 Workitem Analyst / Human）；
- 诊断范围必须越出批准边界 → 停止，报 Goal / Reason / Scope Impact。
