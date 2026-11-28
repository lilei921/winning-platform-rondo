---
name: pull-request
description: 为 Bug 和 Requirement 准备、提交及按需恢复 PR 交付。
---

# Inputs

以下为正常 PR 准备和提交的输入；Abandoned PR 恢复按对应章节处理。

- 当前 Issue、已授权的业务工作树、实际根仓路径及待交付 Candidate。`repo_id` / `repo_key` 使用 Project Resource URL 中的完整 Git/TFS 仓库名称。
- 当前 Candidate 对应的专业 Facts：验证范围与方法、Code Review 结论及适用的 Bug Evidence。

# Candidate

按需更新远端事实；提交业务代码后以非强制方式发布 Candidate（Bug Commit 保留唯一 `Refs: #<tfs.id>` 尾注）。

```bash
rondo repo fetch --repo <repo_id> --root-repo "<root>"
rondo repo push --repo <repo_id> --root-repo "<root>"
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

按项目选择验证命令；Requirement 必须提供。提供 `validation.command` 时，由 `rondo pr prepare` 执行并登记实际结果，无需预填 `validation.result`。Bug 确无适用本地验证命令时可省略 command，此时须提供真实的 `result: PASS`、替代验证、证据引用及原因、范围、结果和局限；命令执行失败不得降级；当前 Candidate 存在命令验证失败事实时须重新执行验证命令。未解决 Non-blocking Finding 需标明 `blocking:false` 并提供 `risk_note` 或 `risk_ref`。

Bug 在同一 Facts 中补充 `expected_behavior`、`actual_behavior`、`fix_summary`、`root_cause`（confidence 为 confirmed/probable、summary、evidence_refs；probable 补充 remaining_risk）、`regression`（PASS、summary、evidence_refs），以及 validation / code_review 的 evidence_refs。证据应真实可核查；Regression、Code Review 等专业 PASS 必须有已确认的依据，不以尚未执行的命令作为成功证据。

```bash
rondo pr prepare --repo <repo_id> --root-repo "<root>" --candidate-commit <sha> --facts "<temporary-json>" --title "<title>"
```

使用临时 Facts 文件时，保留至 `pr prepare` 执行结束。

CLI 在 Issue 的 `pr` 中按仓库登记准备事实，`blockers` 为空是输入条件。提交成功后在同一记录补充外部 PR ID / URL。

验证工作目录按需使用 `--validation-cwd "<path>"`。多仓 Bug 首次准备通过 `--required-repos <repo1,repo2>` 固定完整交付仓集合；后续不得擅自改变。Requirement 仅准备批准范围内实际修改的仓库。

# PR Submission

完成全部实际交付仓的 PR Preparation；Bug 根据 `ready_for_pr` 确认准备完整性；Requirement 的研发工件已发布，所有 Tasks 已完成或由 Human Approval 明确豁免。

```bash
rondo pr materialize
```

根据返回结果确认 PR 交付情况；出现异常时核实原因并处理，不通过手工修改交付事实绕过检查。

# Abandoned PR Recovery

Human 明确授权当前待恢复仓库后，恢复 PR Facts：

```bash
rondo pr resume --comment-id <id> --next REWORK|RECREATE_PR
```

- `REWORK`：使失效准备事实失效；Requirement 保留实际交付仓范围及其他有效 PR，Bug 保留固定必要仓集合并重新准备。按 Human 意图开展分析或研发，实质契约变化重新批准。
- `RECREATE_PR`：Candidate 未变化且专业证据有效时，仅解除 abandoned PR 的登记身份，之后执行 `rondo pr materialize`。
- Bug 仅自动恢复全部当前 PR 已确认 abandoned 的集合；混合状态由 Human 决定。

核对恢复结果后，使用 Multica 原生状态操作恢复 Issue，再按需原生交接或继续当前授权 Run。状态恢复与新 Run 启动分别确认，避免重复触发。若写入结果未知，回读当前 `pr` 与 Human 决定；不凭旧评论解除新的阻塞。分析变化涉及调整既有交付仓范围或其他有效 PR 时，由 Human 明确处理，不自动丢弃记录。取消交付保持停止。

