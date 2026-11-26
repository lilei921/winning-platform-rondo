---
name: analysis-publish
description: 将已完成的 OpenSpec 工程契约发布为固定 Git 审核版本，并提交 Human Review。
---

# analysis-publish

## Inputs / Preconditions

当前 Issue 已获授权，专业分析、审查及唯一 OpenSpec Change 已完成，根仓基于适用工程版本准备就绪。已知 `change_ref`；`<config>` 为本 Skill 的 `config/repo-registry.json`，其中 `runtime.workspace_id` 与当前 Workspace 一致。

## Execution

使用实际根仓路径（当前 cwd 为根仓时可用 `.`），执行：

```bash
rondo analysis publish --issue <issue> --change-ref <change_ref> \
  --registry-config "<config>" --workspace-id <workspace> --root-repo "<root>"
```

CLI 根据当前 Issue 的 `tfs.type` 确定发布路径，负责最终 Gate（含 OpenSpec Strict Validation）、Git 发布、事实登记及审核状态确认。无需手工 Git Add、Commit、Push 或例行预校验；不手填 `analysis.source`，不以可变 HEAD 代替固定来源。

## Result & Human Review

- **PASS**：消费返回的 `analysis_source`，无需重复核对 CLI 已确认的后置条件。按实际专业影响处理 `diagnostics`；发现实质工程契约缺陷时如实报告并按现有审核修订机制处理。
- **FAIL**：根据实际原因修正工程契约或输入，必要时使用 `rondo analysis validate` 或 OpenSpec 原生命令定向诊断，不绕过 Gate。
- **UNKNOWN**：处理可明确修正的问题；发布结果不明时先确认 Issue 状态和固定来源，按实际结果恢复。外部环境或 CLI 故障无法解决时保留工件及已知 Commit，报告实际阻断，不反查 CLI 内部实现或循环重试。

发布确认后，在当前 Issue Comment 提供必要的目标/方案、影响范围、专业审查结论、Independent Verification 建议及依据和必要验证重点、风险/待决事项、固定 Git 来源（仓库、分支、完整 Commit、Change ID）及 Gate 结果。通过固定来源引用工件，默认不另行导出或上传附件，Human 明确要求时除外。

使用 Multica 原生 Comment（Comment 触发的 Run 回复本次触发线程，线程回复使用 `--parent <comment-id>`）：

```bash
multica issue comment add <issue> --content-file "<summary-file>" --workspace-id <workspace> --output json
```

`--content-file` 路径按实际 cwd 解析。审核重放或评论结果不明时，核对当前线程是否已有同一 Change、Commit 的审核摘要；已有则不重复发布。仅评论失败时补齐评论，不重跑已成功的 Gate/Git 发布。审核摘要成功提交后结束本轮。

Human Approval 由 Human 决定；本 Skill 不负责研发派发、代码实现、TFS 回写或新增过程性持久化工件。
