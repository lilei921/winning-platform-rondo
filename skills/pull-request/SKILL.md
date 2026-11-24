---
name: pull-request
description: 为 Bug 和 Requirement 准备、提交及按需恢复 PR 交付。
---

# Inputs

以下为正常 PR 准备和提交的输入；Abandoned PR 恢复按对应章节处理。

- 当前 Issue、已授权的业务工作树、实际根仓路径及待交付 Candidate。
- 依据实际风险完成适用的专业验证和 Code Review，解决 Blocking Findings。

# Candidate

按需更新远端事实；提交业务代码后以非强制方式发布 Candidate（Bug Commit 保留唯一 `Refs: #<tfs.id>` 尾注）。

```bash
rondo dev git --operation fetch --issue <KEY> --repo <repo_id> --root-repo "<root>"
rondo dev git --operation push --issue <KEY> --repo <repo_id> --root-repo "<root>"
```

Fetch 不合并，push 回读远端 Candidate SHA。Candidate Branch 为 `feature/<tfs.id>`；当前 Task Branch 不是 PR 源分支。

# PR Preparation

为每个实际交付仓提供专业 Facts（系统临时目录 UTF-8 JSON，或 stdin `--facts -`，不提交 Git）。

```json
{
  "validation": {
    "result": "PASS",
    "command": ["npm", "test"],
    "summary": "实际验证范围、结果与必要局限"
  },
  "code_review": {
    "result": "PASS",
    "summary": "针对 Candidate 的审查结论",
    "findings": []
  },
  "blockers": [],
  "description": "专业 PR 描述：变更、验证及剩余风险"
}
```

按项目选择实际验证命令；Requirement 必须提供，CLI 在 Candidate 中执行并核验结果。Bug 确无可执行本地验证命令时可省略 command，但应提供真实替代验证、证据引用及原因、范围、结果和局限；已提供命令执行失败不得降级。未解决 Non-blocking Finding 需标明 `blocking:false` 并提供 `risk_note` 或 `risk_ref`。

Bug 在同一 Facts 中补充 `expected_behavior`、`actual_behavior`、`fix_summary`、`root_cause`（confidence 为 confirmed/probable、summary、evidence_refs；probable 补充 remaining_risk）、`regression`（PASS、summary、evidence_refs），以及 validation / code_review 的 evidence_refs。证据应真实可核查。

```bash
rondo pr prepare --issue <KEY> --repo <repo_id> --root-repo "<root>" --candidate-commit <sha> --facts "<temporary-json>" --title "<title>"
```

验证工作目录按需使用 `--validation-cwd "<path>"`。多仓 Bug 首次准备通过 `--required-repos <repo1,repo2>` 固定完整交付仓集合；后续不得擅自改变。Requirement 仅准备批准范围内实际修改的仓库。

# Requirement Artifact Publication

根据实际完成的研发任务更新 Tasks：

```bash
rondo change update-progress --openspec-root "<root>" --change-ref <ref> --check <task-refs>
```

提交当前 Change 的研发工件并发布：

```bash
rondo dev publish --issue <KEY> --change-ref <ref> --root-repo "<root>"
```

仅存在非实质性 Design 细化时使用 `--minor-design`。Tasks 可随实际研发进度更新。PR 提交前完成研发工件发布，不重复手工 Push 根仓。

# PR Submission

Bug 所有必要仓库准备完成（ready_for_pr=true）；Requirement 当前 Change 的研发 Tasks / Design 已发布。

```bash
rondo pr materialize --issue <KEY>
```

确认 PR 及 Work Item 关联、`current_pr` 和 Issue `in_review`。FAIL / UNKNOWN 时按实际候选、授权和外部事实修复或恢复，不盲目覆盖或重复创建。

# Abandoned PR Recovery（Bug）

根据 Human 明确的恢复决定执行：

```bash
rondo bug resume --issue <KEY> --human-comment-id <id> --next REWORK|RECREATE_PR
```

- `REWORK`：重新诊断、修复及验证，再准备 PR。
- `RECREATE_PR`：复用未变的 Candidate 和有效的 Evidence，重新交付 PR。

根据实际恢复结果继续处理；无需在恢复前重新准备 Candidate。
