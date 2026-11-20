---
name: delivery-gate
description: 调用已实现的交付确定性检查；当 Analysis 需进入 Human Review 时使用 Analysis Gate，研发完成检查使用 development-execution。返回 PASS/FAIL/UNKNOWN，不做语义判断。
---

# delivery-gate

本 Skill 提供已实现的 Analysis Gate 调用契约；Development Completion Check 的执行契约由 `development-execution` Skill 维护。未实现的 Gate 不作为可调用命令。

## validate-analysis 契约

### Preconditions / Inputs

- `--workspace-id <id>`：必须显式提供目标 Workspace，不使用 Multica CLI 默认工作区。
- `--issue <id>`：Delivery Issue，metadata 已含 `analysis.change_kind`（`corrective` / `intentional`）、`analysis.change_ref` / `analysis.verify_agent.*`，Intentional 按当前 Schema 提供 `analysis.ai_review.*`。draft 键由 `rondo analysis stage` 落账，本 Gate 只读不写；不再消费独立 `analysis.route`。
- `--openspec-root <path>`：**根仓路径**（CLI 自动归一到其 `openspec/` 子目录；兼容直接传 `openspec/` 目录。Change 位于归一后的 `<root>/changes/<change_ref>/`）。

### Procedure

```bash
rondo analysis validate --issue <issue-id> --openspec-root <path> --workspace-id <id>
```

检查项：

| 检查项 | 内容 |
|---|---|
| `identity` | `tfs.id` / `tfs.type` 有效，Multica Issue 的 `analysis.change_kind` 与当前 OpenSpec Change Schema 一致；不允许的 TFS Bug + Intentional 组合 FAIL；不得仅由 TFS Type 推断 Technical Change Kind |
| `change` | `analysis.change_ref` 为安全、稳定 ID，Change 目录与 `.openspec.yaml` 可读取，Schema 为项目支持的 `corrective-change` / `intentional-change`；未知或损坏则 STOP |
| `acceptance_contract` | Intentional：Specs 的 Requirement / Scenario 或经原生状态确认的合法 skipped；Corrective：Proposal 的 Expected Behavior / Root Cause / Fix Strategy / Regression Scope |
| `tasks` | tasks.md 存在、含任务项、含 Verification 内容 |
| `task_estimates` | 逐 task 声明行强制 `[预估: Nh]` 行末尾注（必填，0<N≤6h；缺注/越界/不在行末 → FAIL 并列明 ref——6h 上限是拆分纪律；下游消费者为 PR 通过后的 tfs-writeback 任务物化）；**tfs.type=Bug → skipped 不强制（Bug 不建 TFS 子任务，尾注无下游消费者）** |
| `verify_recommendation` | recommendation/reason/focus_refs 完整（focus_refs 为非空字符串引用数组；专业语义仍由 Analyst 审核） |
| `ai_review` | `intentional-change` 必须有 `verdict=APPROVED` 和非空 `findings_ref`；Corrective 无此必选检查；NEEDS_REVISION → FAIL |
| `openspec_validate` | `openspec validate <change> --strict`（CLI 不可用 → UNKNOWN） |

### Output

- stdout：`{ result: PASS|FAIL|UNKNOWN, checks: [...], reasons: [...] }`；PASS 时额外输出 `issue_id`、`workspace_id`、`change_ref`、`change_kind`、`schema`、`change_digest` 与 `metadata_digest`，供 Complete 回核同一执行对象、工程产物及已审核的 Issue Facts。工件摘要覆盖 Proposal / Design / Tasks / Specs、约定 Handoff 的专业字段及 Metadata 显式引用的当前 Change Review Evidence；未引用的运行日志不影响摘要。排除 Gate Result 自身及 `analysis-handoff.json` 的顶层派生 `gate` 字段；外部 Evidence 的定位符由 Metadata Digest 绑定，不宣称其外部文件内容已被 Hash。Handoff 路径和写入顺序见 `analysis-completion`。
- 退出码：`0` PASS / `2` FAIL / `3` UNKNOWN。

### Error Handling / Stop Conditions

- 任一检查 UNKNOWN → 整体 UNKNOWN：停止提交，交 Delivery Lead / Human（UNKNOWN 不得当放行）；
- 任一 FAIL → 列出缺失项，交 Workitem Analyst targeted rework；
- 当前 Gate 只作已实现的结构检查与 OpenSpec 原生校验；专业语义由 Workitem Analyst 判断。

## 通用规则（所有门禁）

- Gate 消费已有专业结论，不凭"Artifact 存在 / CLI 退出码 / 字段齐全"替代语义判断；
- Gate 结果必须结构化落到 Issue 评论（含 reasons_ref），不留 Run 对话里；
- 任何 Agent 不得覆盖 FAIL，不得把 UNKNOWN 当放行。Gate Result 必须由实际命令生成并存储于本次 Change 的约定日志路径，Complete 会拒绝跨 Issue / Schema / 工件快照的旧结果。
