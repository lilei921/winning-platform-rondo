---
name: analysis-completion
description: 将已完成的 Analysis Engineering Contract 以真实 Gate 和固定 Git 来源提交 Human Review；不落盘 Gate、Review 或 Handoff 过程工件。
---

# analysis-completion

## Inputs / Preconditions

- 当前 Issue 的授权、真实专业结论、唯一 OpenSpec Change，以及可用的当前 Root、配置、Multica Workspace。
- `<facts.json>` 是 **Change 目录外的临时 CLI 输入**，包含 `change_kind`、`change_ref`、`verify_agent`，Intentional 还包含 `ai_review.verdict`。不需要 `ai_review.findings_ref`、`gate` 或 `analysis-handoff.json`。
- `<config>` 是本 Skill 发布的 `config/repo-registry.json`；`runtime.workspace_id` 必须等于当前 Workspace。

## Execution

确认根仓在本次项目分支真正就绪；仅路径存在不等于已准备成功。必要时使用 `workspace-preparation`。

```bash
rondo analysis stage --issue <issue> --facts <facts.json> --workspace-id <workspace> --registry-config "<config>"
```

按需预检查，输出直接在 stdout，不使用 `--out`：

```bash
rondo analysis validate --issue <issue> --openspec-root "<root>" --workspace-id <workspace> --registry-config "<config>"
```

`validate` 不构成可复用的 Gate 凭据。`complete` **再次执行相同的完整真实 Gate**，核对 staged Facts、OpenSpec 和当前工作树，比较将发布的 Commit 与远端固定版本，然后才写入 `analysis.gate.result=PASS`、`analysis.source` 并进入审核：

```bash
rondo analysis complete --mode requirement --issue <issue> --facts <facts.json> \
  --registry-config "<config>" --workspace-id <workspace> --root-repo "<root>"
```

仅在 TFS Requirement 使用 `--mode requirement`；现有其他流程保留其适用入口。Rondo 负责范围受限的 Git Commit/Push、来源回读及原生 Issue Comment 审核摘要。摘要呈现目标、方案、影响范围、验证建议、重要风险、固定 Git Commit 和 Gate 结果；专业风险或方案表达不足时由 Workitem Analyst 在现有 Issue Comment 补充，不新增报告。

## Acceptance / Stop

- 只在 `complete` 返回 `result=PASS`、Issue 确认为 `analysis_review`、`analysis.source.commit` 固定且摘要评论可回读后声明审核发布完成。Human Approval 是后续独立决定，不等于 AI Review/Gate。
- FAIL/UNKNOWN、Schema / Workspace / 来源不符、内容或 Metadata 变化、Git 版本无法核对时停止。不可将旧 PASS、可变 HEAD、外部虚构文件冒充本次 Gate。
- 不创建 `ai-review.md`、`analysis-handoff.json`、`evidence.md`、`logs/analysis-gate-result.json`、`analysis-summary.md`；仅允许临时本地 Facts 输入，不加入 Git/Archive。
- 本 Skill 不负责 TFS 回写、代码实现或 Human Approval。
