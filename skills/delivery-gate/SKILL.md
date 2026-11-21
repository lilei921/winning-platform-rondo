---
name: delivery-gate
description: 执行已有的 Analysis 结构与 OpenSpec 原生质量 Gate；最终可信核验由 analysis complete 负责。
---

# delivery-gate

专业语义由 Workitem Analyst 判断；本 Skill 只负责已有确定性 Gate，不新增 Workflow、独立报告或中间状态。

## Analysis Gate（只读预检查）

在已完成 `rondo analysis stage`、确认实际 Root/Workspace/Change 就绪后：

```bash
rondo analysis validate --issue <issue> --openspec-root "<root>" --workspace-id <workspace> --registry-config "<config>"
```

验证 `identity`、`change`、`acceptance_contract`、`tasks`、`verify_recommendation`、`ai_review`、`openspec_validate`。Intentional 仅强制 `analysis.ai_review.verdict=APPROVED`，不要求独立 Findings Markdown；Corrective 按其 Proposal/Schema 验证。必要 Delta Specs 或已获 OpenSpec 原生确认的跳过状态由 OpenSpec 决定，不重复建立审批机制。

`validate` 从 stdout 返回 `PASS / FAIL / UNKNOWN`、检查清单和原因；不接受 `--out`，不生成 `logs/analysis-gate-result.json`。预检查 PASS **不是**可持久化或可复用的授权。

## 最终 Gate

`rondo analysis complete` 必须重新执行上述完整检查，核对当前 staged Metadata、工程契约及最终固定 Git Commit，再登记 `analysis.gate.result=PASS`、`analysis.source` 和原生 Issue Review 摘要。Human Approval 独立发生。

FAIL/UNKNOWN 应反馈真实原因并停止发布，不能凭缓存 PASS、Agent 自报状态或可变 HEAD 放行。Development Completion 的判断归相应 Development Skill，不在这里复制实现。
