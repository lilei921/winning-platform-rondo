---
name: analysis-completion
description: 将已完成的 Analysis Engineering Contract 经真实 Gate 和固定 Git 来源提交 Human Review。
---

# analysis-completion

## Inputs / Preconditions

- 当前 Issue 已获授权，专业分析和唯一 OpenSpec Change 已完成。
- 根仓已基于适用工程版本准备就绪。
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

Requirement 模式需先在当前根仓工作分支提交本次 Change 的必要审核工件（只提交当前 Change，不重复手工 Push）。发布 TFS Requirement 审核版本：

```bash
rondo analysis complete --mode requirement --issue <issue> --facts <facts.json> \
  --registry-config "<config>" --workspace-id <workspace> --root-repo "<root>"
```

仅 TFS Requirement 使用 `--mode requirement`，其他流程沿用其适用入口。`validate` 只用于预检查；`complete` 首次发布时执行最终真实 Gate、Git 发布和固定来源核对；已处于 `analysis_review` 时只核对固定审核版本，不重新执行 Gate。`complete` 不发布 Issue 评论。

`complete` 返回 `PASS` 后，Agent 基于固定 Git 来源，通过 Multica 原生可见渠道提供简明审核摘要：目标/方案、影响范围、Independent Verify Recommendation 及依据、风险/待决、`change_ref`、完整 Commit 和 Gate。Comment 触发的 Run 回复本次触发线程；发布前核对当前线程是否已有相同 `change_ref` 和 Commit 的摘要，已有则不重复发布；发布后回读确认。

## Acceptance / Stop

- 仅当 `complete` 返回 `result=PASS`，且 `analysis.gate.result=PASS`、Issue 状态 `analysis_review` 和固定来源均可回读时，才声明审核版本发布完成；Agent 的审核交付还需确认摘要在当前 Issue 可见。
- `analysis.source` 由 Rondo 写入，包含 `repo_url`、`branch`、`commit`、`change_ref`。来源身份由 `repo_url + commit + change_ref` 确定，`branch` 用于追溯；不得手填或以可变 HEAD 代替。
- `FAIL` 按实际原因处理，不绕过 Gate；`UNKNOWN` 先回读状态和固定来源，符合现有 `complete` Replay / 恢复条件时可重试确认，否则停止。不复用旧 PASS 或自行补写 Metadata。仅评论发布失败时先回读原生线程并按需补齐，不重新执行已成功的 Gate/Git 发布。
- 不新增 Gate、Review、Handoff 等过程性持久化工件；临时 Facts 不提交 Git 或 Archive。
- Human Approval 属于后续独立决定；本 Skill 不负责研发派发、代码实现或 TFS 回写。
