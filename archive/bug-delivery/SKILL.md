---
name: bug-delivery
description: 已授权 TFS Bug 的受控 Git Fetch/Push、Candidate 核对和修复验证后的 PR Preparation。
---

# Bug Delivery

## Inputs

- 已授权的 `tfs.type=Bug` Issue、目标 `repo_key` 和当前 Task 的实际根仓路径。
- 本技能 `config/repo-registry.json` 的绝对路径，以及可用的 `rondo`、Git、已绑定目标 Workspace 的 `multica` 和认证配置；缺失或不可访问时停止。

## Git Fetch / Push

确认当前 Task 的根仓及已授权业务工作树可用。已固定的 `bug.required_repos` 不可自行改变。

完成修复和验证后，网络 Git 操作使用现有校验与认证：

```bash
rondo bug git --operation fetch --config "<repo-registry.json>" --issue <KEY> --repo <repo_key> --root-repo "<平台实际根仓路径>"
rondo bug git --operation push --config "<repo-registry.json>" --issue <KEY> --repo <repo_key> --root-repo "<平台实际根仓路径>"
```

fetch 仅更新远端事实、不整合；push 仅非强制推送已核验 HEAD。失败或未知时先回读远端，不重复无法确认的写入；认证值不得进入 URL、参数或日志。

## PR 准备条件

- 修复、必要回归、Local Validation 和 Code Review 已完成。
- 准备好已 Push 的 Candidate Commit（含 `Refs: #<tfs.id>` 尾注）、PR 标题及符合 [Evidence Contract](references/bug-evidence-contract.md) 的最小 JSON。

## PR Preparation

1. 明确本次 Bug 涉及的全部 `repo_key`。多仓时，**首次** `pr-prepare` 通过 `--required-repos <repo1,repo2>` 提供完整集合；单仓可省略该参数。
2. 每仓将本次验证 JSON 放入 Bash 变量 `evidence_json`，通过 UTF-8 stdin 执行：

   ```bash
   printf '%s' "$evidence_json" | rondo bug pr-prepare --config "<repo-registry.json绝对路径>" \
     --issue <ISSUE-KEY> --repo <repo_key> --candidate-commit <40位SHA> \
     --evidence - --title "<PR标题>" \
     --root-repo "<平台实际根仓路径>"
   ```

   无可靠 UTF-8 管道时，使用系统临时目录中的 UTF-8 JSON 文件，改传 `--evidence "<绝对路径>"`；不放入 Task 工作目录或 Git。

   自定义分支须确认归属后指定 `--source-branch` / `--target-branch`。PR 描述默认由命令生成；确需补充审核信息时才用 `--description <可访问的PR描述文件>`。
3. **所有 Repository 均准备完成且最终 `ready_for_pr=true`** 后执行：

   ```bash
   rondo pr materialize --issue <ISSUE-KEY> --config "<repo-registry.json绝对路径>"
   ```

   回读 `current_pr` 和 Issue `in_review`，确认所有必要仓库均有对应 PR。

## Validation & Recovery

- `pr-prepare` 与 `materialize` 均须取得 exit 0 且 `result=PASS`；`ready_for_pr=false` 时继续准备其他仓库，不得提前创建 PR。
- `FAIL`（exit 2）修正明确的输入或前置条件缺口；`UNKNOWN`（exit 3）先核对读取或写入结果。候选 SHA / PR 身份冲突时停止，不盲目重复物化。

## Output

- 同一候选已有有效 Issue 摘要时复用；最终回复只给结果和 Issue / PR 引用。

## Abandoned PR

仅当 Human 在当前 Issue 明确授权，且全部当前 PR 均确认 `abandoned` 时，按决定恢复：

```bash
rondo bug resume --config "<repo-registry.json绝对路径>" --issue <ISSUE-KEY> \
  --human-comment-id <评论ID> --next REWORK|RECREATE_PR
```

- `REWORK`：重新诊断、修复和验证，并重新执行 PR Preparation。
- `RECREATE_PR`：仅复用未变更的 Candidate Commit 和有效 Evidence，重新执行 PR Materialization；候选已变则要求重新授权返工。
- PR 状态混合、Human 授权不可确认或命令返回 FAIL / UNKNOWN 时停止；按实际 PR 和 Issue 事实恢复，不擅自覆盖。
