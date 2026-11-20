# Code Review（双轴审查方法）

> **本文件为 Code Review 方法的唯一权威**（语义背景：04 §8 全节，根级现行版 `projects/multica/04-engineer-development-design.md`）。本文件是 `development-execution` 的内部 Method（Engineering Loop 的 Review 方法），不注册为顶层 Skill。

## Use When

候选实现已固定（Candidate Commit 前），需要对当前 Diff 做 implementation-oriented 审查。所有 Route 的代码实现都必须审查（04 §8.1）；纯验证无代码修改的 Task Set 复用仍有效的审查事实，不重复审查（04 §7.1）。

## Input

- 当前 Diff（Review Snapshot：固定实际被审查的代码 + 工程契约引用）；
- `task_refs` / 批准契约（规格一致性轴的判定依据）；
- 领域 Skill 的 `review-standards.md`（工程标准轴的领域细化）。

## Procedure：双轴独立检查

**轴 1 · Specification / Fix Alignment（04 §8.2）**：当前 Diff 与 `task_refs` / Approved Scope 对应；每项 Implementation Task 有有效验证；无未解释的 Scope Drift / Stale Evidence；checkbox 不与事实冲突。注意：**任务尚未勾选是 Review 阶段的正常情况，不判 FAIL；已勾选却无有效 Evidence 才是阻断异常。**

**轴 2 · Engineering Standards（04 §8.3 + 领域 review-standards）**：按当前 Diff 适用维度检查（Conventions / Complexity / Duplication / Contract Risk / Error Handling / Test Quality / Regression Risk / Maintainability / Security）。

## Output

```yaml
result: PASS | NEEDS_FIX | UNKNOWN
review_baseline_ref: <candidate-and-contract-ref>
findings:
  - id: <stable-finding-ref>        # 当前 Review / Rework 内追踪用，非持久身份
    axis: specification-fix-alignment | engineering-standards
    severity: <severity>
    area: <code-or-task-ref>
    evidence_ref: <finding-evidence>
    suggestion: <targeted-fix-direction>
    blocking: true | false
    resolution: open | resolved
    resolution_evidence_ref: <recheck-evidence-if-resolved>
```

## Finding 处理纪律（04 §8.4）

- **Blocking Finding 必须真正解决并有复核证据**才能形成 Review PASS；
- Non-blocking Finding 可保持 `open`，但必须记录风险与对完成的影响；
- 误报经证据确认可标 `resolved` 并说明理由；
- 人工接受技术风险**不是** Finding Approval Status，不得覆盖 Blocking Finding；
- `NEEDS_FIX` 走定向修复：Finding ID + Evidence → Affected Scope → Targeted Fix → 受影响 Verification / Local Validation → Re-review，**不默认重跑整个 Task Set**；
- Finding 实质否定已批准 Expected Behavior / Root Cause / Requirement / Approved Scope → 不是代码修复，按 04 §12 升级；
- Commit / Push 后核对最终 Candidate 与 Review Snapshot：有实质影响 → 受影响范围 Targeted Re-review；无实质差异 → 复用原 PASS，不机械全量重跑。

## Allowed Effects

- 自审或受控只读 Reviewer Helper 辅助；产出 Findings 并驱动定向修复。

## Forbidden Effects

- 不因调用 Reviewer 产生隐藏的持久化 Owner / Sub-Issue / Run / 额外 Workflow（04 §8.3）；
- `PASS` 不代替 Runtime / Integration / E2E Evidence，也不代替 Independent Verification。

## Stop

- Review 依据不足（契约不可读 / Diff 不可还原）→ UNKNOWN，不猜；
- 跨 Contract / Scope 的 Finding → 停止审查结论，走升级路径。
