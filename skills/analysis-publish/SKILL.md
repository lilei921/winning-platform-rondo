---
name: analysis-publish
description: 将已完成的 OpenSpec 工程契约发布为固定 Git 审核版本，并提交 Human Review。
---

# analysis-publish

## Inputs / Preconditions

- 当前 Issue 已获授权，专业分析和唯一 OpenSpec Change 已完成。
- 根仓已基于适用工程版本准备就绪。
- `<facts.json>` 是 Change 目录外的临时 CLI 输入，包含 `change_kind`、`change_ref`、`verify_agent`；Intentional 还需 `ai_review.verdict`。
- `<config>` 为本 Skill 的 `config/repo-registry.json`；`runtime.workspace_id` 与当前 Workspace 一致。

## Execution

本次 Facts 示例（Intentional 场景，实际值须来自专业判断）：

```json
{
  "change_kind": "intentional",
  "change_ref": "job-migration-detail-error-log-268376",
  "verify_agent": {
    "recommendation": "not_required",
    "reason": "当前开发侧验证可覆盖已识别风险",
    "focus_refs": ["tasks.md"]
  },
  "ai_review": { "verdict": "APPROVED" }
}
```

按需预检查（结果输出至 stdout，不生成文件）：

```bash
rondo analysis validate --issue <issue> --facts <facts.json> --openspec-root "<root>" --workspace-id <workspace> --registry-config "<config>"
```

Requirement 模式需先在当前根仓工作分支提交本次新增或修订的必要审核工件，复用已有效提交的版本。只提交实际涉及的工件，不夹带其他 Change、无关文件或临时 Facts，不重复手工 Push。例如在根仓仅修订 Proposal 时：

```bash
git add -- openspec/changes/<change_ref>/proposal.md
git commit --only -m "analysis: <change_ref>" -- openspec/changes/<change_ref>/proposal.md
```

按本次实际工件选择提交路径。使用已准备的实际根仓路径（当前 cwd 已是根仓时可用 `.`），发布 TFS Requirement 审核版本：

```bash
rondo analysis publish --mode requirement --issue <issue> --facts <facts.json> \
  --registry-config "<config>" --workspace-id <workspace> --root-repo "<root>"
```

仅 TFS Requirement 使用 `--mode requirement`，其他流程沿用其适用入口。`validate` 仅在需要诊断时使用；`publish` 执行最终 Gate、Git 发布与审核登记。已处于 `analysis_review` 时核对已登记的审核事实，不重新执行 Gate 或读取工件。`publish` 不发布 Issue 评论。

`publish` 返回 `PASS` 后，使用返回的 `analysis_source` 固定来源，在当前 Issue Comment 提供简明审核摘要：目标/方案、影响范围、Independent Verify Recommendation 及依据、风险/待决、`change_ref`、完整 Commit 和 Gate。OpenSpec 工件通过固定 Git 来源引用，默认不重复导出或上传附件；Human 明确要求时除外。Comment 触发的 Run 回复本次触发线程；审核重放或评论发布结果不明时，先核对当前线程是否已有相同 `change_ref` 和 Commit 的摘要，已有则不重复发布；使用 `--content-file` 时以实际 cwd 解析路径；结果不明时回读确认，不重复发布。

原生 Comment 示例（在当前 Runtime 对应的 Workspace 执行；线程回复时使用 `--parent <comment-id>`）：

```bash
multica issue comment add <issue> --content-file "<summary-file>" --workspace-id <workspace> --output json
```

## Acceptance / Stop

- `publish` 返回 `result=PASS` 即确认审核版本发布完成，无需重复核对 CLI 已确认的后置条件；检查返回的 `diagnostics` 并按专业影响处理有意义的原生诊断；发现工程契约存在实质缺陷时，如实报告并按既有审核修订机制处理，不宣称契约无问题。Agent 的审核交付还需确保摘要发布成功。
- `analysis.source` 由 Rondo 写入，包含 `repo_url`、`branch`、`commit`、`change_ref`。固定发布来源包括仓库、分支、完整 Commit 和 Change Ref；不得手填或以可变 HEAD 代替。
- `FAIL` 按实际原因处理，不绕过 Gate；`UNKNOWN` 中可明确修正的输入问题按原因处理，发布结果不明时先回读状态和固定来源，仅在符合现有 `publish` Replay / 恢复条件时重试确认。CLI 内部故障或外部基础设施异常时，保留已完成工件及已知 Commit，在当前 Issue Comment 说明实际进展与阻断原因，停止发布；不排查 CLI 内部实现、不循环重试。不复用旧 PASS 或自行补写 Metadata。仅评论发布失败时先回读原生线程并按需补齐，不重新执行已成功的 Gate/Git 发布。
- 不新增 Gate、Review、Handoff 等过程性持久化工件；临时 Facts 不提交 Git 或 Archive。
- Human Approval 属于后续独立决定；本 Skill 不负责研发派发、代码实现或 TFS 回写。
