---
name: analysis-completion
description: 将已完成的 Analysis Engineering Contract 经真实 Gate 和固定 Git 来源提交 Human Review。
---

# analysis-completion

## Inputs / Preconditions

- 当前 Issue 已获授权，专业分析和唯一 OpenSpec Change 已完成。
- 根仓已在当前项目分支准备就绪；必要时使用 `workspace-preparation`，不能仅凭目录存在判断。
- `<facts.json>` 是 Change 目录外的临时 CLI 输入，包含 `change_kind`、`change_ref`、`verify_agent`；Intentional 还需 `ai_review.verdict`。
- `<config>` 为本 Skill 的 `config/repo-registry.json`；`runtime.workspace_id` 与当前 Workspace 一致。

## Execution

提交 Analysis Facts：

```bash
rondo analysis stage --issue <issue> --facts <facts.json> --workspace-id <workspace> --registry-config "<config>"
```

按需预检查（结果输出至 stdout，不生成文件）：

```bash
rondo analysis validate --issue <issue> --openspec-root "<root>" --workspace-id <workspace> --registry-config "<config>"
```

发布 TFS Requirement 审核版本：

```bash
rondo analysis complete --mode requirement --issue <issue> --facts <facts.json> \
  --registry-config "<config>" --workspace-id <workspace> --root-repo "<root>"
```

仅 TFS Requirement 使用 `--mode requirement`，其他流程沿用其适用入口。`validate` 只用于预检查；`complete` 负责最终真实 Gate、Git 发布、固定来源核对及原生 Issue 审核摘要。需要补充专业结论时在当前 Issue Comment 说明，不另建报告。

## Acceptance / Stop

- 仅当 `complete` 返回 `result=PASS`，且 `analysis.gate.result=PASS`、Issue 状态 `analysis_review`、固定来源和审核摘要均可回读时，才声明审核发布完成。
- `analysis.source` 由 Rondo 写入，包含 `repo_url`、`branch`、`commit`、`change_ref`。来源身份由 `repo_url + commit + change_ref` 确定，`branch` 用于追溯；不得手填或以可变 HEAD 代替。
- `FAIL`、`UNKNOWN` 或 Gate、Workspace、来源、状态无法核对时停止，不复用旧 PASS 或自行补写 Metadata。
- 不新增 Gate、Review、Handoff 等过程性持久化工件；临时 Facts 不提交 Git 或 Archive。
- Human Approval 属于后续独立决定；本 Skill 不负责研发派发、代码实现或 TFS 回写。
