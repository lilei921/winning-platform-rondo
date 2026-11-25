---
name: pull-request
description: 为 Bug 和 Requirement 准备、提交及按需恢复 PR 交付。
---

# Inputs

以下为正常 PR 准备和提交的输入；Abandoned PR 恢复按对应章节处理。

- 当前 Issue、已授权的业务工作树、实际根仓路径及待交付 Candidate。
- 当前 Candidate 对应的专业 Facts：验证范围与方法、Code Review 结论及适用的 Bug Evidence。

# Candidate

按需更新远端事实；提交业务代码后以非强制方式发布 Candidate（Bug Commit 保留唯一 `Refs: #<tfs.id>` 尾注）。

```bash
rondo dev git --operation fetch --issue <KEY> --repo <repo_id> --root-repo "<root>"
rondo dev git --operation push --issue <KEY> --repo <repo_id> --root-repo "<root>"
```

Fetch 不执行合并。

# PR Preparation

为每个实际交付仓提供专业 Facts（系统临时目录 UTF-8 JSON，或 stdin `--facts -`，不提交 Git）。

```json
{
  "validation": {
    "command": ["npm", "test"],
    "summary": "验证范围及必要局限"
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

按项目选择验证命令；Requirement 必须提供。提供命令时无需预填 `validation.result`，CLI 在 Candidate 中执行并登记实际结果；无需为满足输入格式重复执行。Bug 确无适用本地验证命令时可省略 command，此时须提供真实的 `result: PASS`、替代验证、证据引用及原因、范围、结果和局限；命令执行失败不得降级；当前 Candidate 存在命令验证失败事实时须重新执行验证命令。未解决 Non-blocking Finding 需标明 `blocking:false` 并提供 `risk_note` 或 `risk_ref`。

Bug 在同一 Facts 中补充 `expected_behavior`、`actual_behavior`、`fix_summary`、`root_cause`（confidence 为 confirmed/probable、summary、evidence_refs；probable 补充 remaining_risk）、`regression`（PASS、summary、evidence_refs），以及 validation / code_review 的 evidence_refs。证据应真实可核查；Regression、Code Review 等专业 PASS 必须有已确认的依据，不以尚未执行的命令作为成功证据。

```bash
rondo pr prepare --issue <KEY> --repo <repo_id> --root-repo "<root>" --candidate-commit <sha> --facts "<temporary-json>" --title "<title>"
```

验证工作目录按需使用 `--validation-cwd "<path>"`。多仓 Bug 首次准备通过 `--required-repos <repo1,repo2>` 固定完整交付仓集合；后续不得擅自改变。Requirement 仅准备批准范围内实际修改的仓库。

# PR Submission

完成全部实际交付仓的 PR Preparation；Bug 根据 `ready_for_pr` 确认准备完整性，Requirement 还需完成全部 Tasks 并发布当前 Change 的研发工件。

```bash
rondo pr materialize --issue <KEY>
```

根据返回结果确认 PR 交付情况；出现异常时核实原因并处理，不通过手工修改交付事实绕过检查。

# Abandoned PR Recovery（Bug）

根据 Human 明确的恢复决定执行：

```bash
rondo bug resume --issue <KEY> --human-comment-id <id> --next REWORK|RECREATE_PR
```

恢复返回 `PASS` 或 `NOOP` 后：

- `REWORK`：重新诊断、修复及验证，再交付 PR。
- `RECREATE_PR`：直接执行 `rondo pr materialize --issue <KEY>`。

恢复意图不明确时向 Human 确认；异常按实际结果核实处理，不手工修改 CLI 管理的交付事实。
