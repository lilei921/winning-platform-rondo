# PR Facts 契约（Multica Issue Metadata）

已有 `pr_prep` 和 `current_pr` 是 PR 交付的唯一持久 Metadata；不新增独立 Evidence JSON 或 PR Description Markdown。

## Requirement `pr_prep`

`rondo dev pr-prepare --mode requirement` 由当前 Engineer 在授权仓库的真实 Candidate Checkout 上执行验证后，按 `repo_key` 写入已有 `pr_prep` JSON 数组。每仓包含：

```json
{
  "repo_key": "frame",
  "repo_url": "http://tfs.example/tfs/Collection/Project/_git/repo",
  "source_branch": "feature/42",
  "target_branch": "dev",
  "candidate_commit": "<完整 40 位 Git SHA>",
  "title": "Engineer 的 PR 标题",
  "description": "变更摘要、验证结果及剩余风险",
  "local_validation": {
    "result": "PASS",
    "summary": "实际执行过的验证与结果",
    "command": ["npm", "test"],
    "exit_code": 0,
    "candidate_commit": "<同一 Candidate SHA>",
    "source": "rondo dev pr-prepare"
  },
  "code_review": {
    "result": "PASS",
    "candidate_commit": "<同一 Candidate SHA>",
    "summary": "Engineer 对 Candidate 的专业审查结论",
    "findings": []
  },
  "blockers": []
}
```

`validation.command` 仅是示例，验证工具由 Engineer 依据仓库选择。Rondo 核对批准范围、来源仓库、远端分支 HEAD、实际 Checkout Commit、Validation 退出码与 Code Review Findings。未解决 Blocking Finding、Code Review 非 PASS、Candidate 漂移或验证失败必须阻断。

`description` 是 PR 创建前的必要交付输入，Rondo 仅转换为短期临时文件，**TFS PR 保存正式描述**。若 PR 已存在，则复用外部事实，不从 Git 读取 `pr-description-<repo>.md`。多仓分别维护一项；不可混淆 Candidate。

## 现有 Legacy / Direct Bug

保留原有 `description_ref=file:<path>` 和对应流程兼容，不在本次重构。Requirement 不使用 `description_ref=change:...`。

## `current_pr`

`rondo pr materialize` 在真实 TFS PR 创建/复用后继续记录 `repo_key`、`pr_id`、`pr_url`、`source_branch`、`target_branch`。读取外部 active PR 状态、源目标分支和 Candidate 一致性；事实冲突时 UNKNOWN，不由 Rondo 私自重建。Requirement 与 Direct Bug 的 `pr_prep` 均固定已核验的 `repo_url` 和实际 `target_branch`；Materialize 创建或复用前核对这些身份。Closeout 从 `current_pr.pr_url` 解析 TFS 身份，与 `pr_prep` 核验并读取真实 PR 终态。
