---
name: change-development
description: 根据已批准的 OpenSpec Change 完成一个或多个授权仓库的实现、实际验证、Code Review 和 PR 交付。
---

# Inputs / Boundaries

- 当前 Issue 的 `analysis.source`、Human Approval、当前 OpenSpec Change 与 `.openspec.yaml.x-repositories`；本 Skill 的 `config/repo-registry.json`。
- 仅对已批准的 Repository Scope 内代码进行修改。需要本地 Git 时按需使用 `workspace-preparation`；不以文件存在代替仓库/分支就绪核验。
- 不修改已批准行为、验收或授权范围；实质变更退回原有 Human Review。

# Work

1. 通过 `rondo analysis read` 读取固定 Commit 中的 Proposal、Specs、必要 Design、Tasks，按专业判断实现；更新本地代码与测试。
2. 在实际 Candidate Checkout 完成 Local Validation 与 Code Review，解决 Blocking Findings；记录完整 Candidate SHA，并核对远端分支。
3. 对已验证任务使用 `rondo change update-progress`。OpenSpec 只更新原有工程契约与进度，不创建独立 Evidence/Review 报告。
4. 仅一次按仓库形成 PR Preparation Facts，并最终通过现有 Completion、PR 和 Closeout Gate。

## Requirement PR Preparation

准备 **Change 目录外的临时** `<delivery-facts.json>`（作为 CLI 输入，禁止 Commit / Push / Archive）：

```json
{
  "validation": {
    "command": ["npm", "test"],
    "summary": "具体执行的验证、覆盖范围与结果"
  },
  "code_review": {
    "result": "PASS",
    "summary": "针对当前 Candidate 的专业审查结论",
    "findings": []
  },
  "blockers": [],
  "description": "Engineer 编写的 PR 专业变更摘要、验证结果及剩余风险"
}
```

验证命令和工作目录由 Engineer 依据真实项目选择；例中的 `npm test` 不是统一强制测试方式。Rondo 在实际 Candidate Checkout 执行 `validation.command`，核验仓库身份、HEAD、测试退出码、Code Review 和 Blocking Findings，然后将每仓 Candidate/验证/审查/描述存入 **现有 Issue metadata `pr_prep`**。不接受单靠手写 PASS。

```bash
rondo dev pr-prep --mode requirement --config "<config>" --issue <issue> --repo <repo_id> \
  --change-ref <change_ref> --root-repo "<root>" --candidate-commit <sha> --title "<title>" \
  --delivery-facts "<temporary-json>" --validation-cwd "<candidate-checkout>"

rondo dev publish --config "<config>" --issue <issue> --change-ref <change_ref> --root-repo "<root>"
rondo dev check-change --config "<config>" --issue <issue> --change-ref <change_ref>
rondo pr materialize --mode requirement --config "<config>" --issue <issue> --change-ref <change_ref>
```

只有确属非实质性 Design 细化才允许 `dev publish --minor-design`。多仓分别对各自的 Candidate 完成绑定；实际代码由 Git 持有，交付事实由 Multica 持有，最终 PR Description 由 TFS PR 持有。

## Stop / Output

输出实际修改、Candidate 完整 SHA、真实验证与 Code Review 结论、Blockers、已完成 Tasks 和 PR 结果。验证失败、Candidate 不匹配、仓库越界、Approval 不明或外部写入状态未知时停止，保留现场并报告。不得持久化 `evidence-<repo_id>.json` 或 `pr-description-<repo_id>.md`，也不使用替代性的永久过程工件。
