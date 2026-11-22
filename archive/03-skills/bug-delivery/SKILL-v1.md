---
name: bug-delivery
description: 已授权 TFS Bug 的业务仓准备、受控 Git 交付和修复验证后的 PR Preparation。
---

# Bug Delivery

## 业务仓准备

先按 `codebase-explorer` 校验平台原生根仓并通过远程 MCP 调查。确认 Repository 属于本 Bug 的授权范围后，使用本 Skill 的 Registry 绝对路径执行：

```bash
rondo dev prepare --config "<repo-registry.json>" --issue <KEY> --repo <repo_key> --root-repo "<平台实际根仓路径>"
```

PASS 返回实际业务仓路径、`branch=feat/<tfs.id>`、HEAD 与 changed。复用时保留 dirty / unpushed；已有错误分支、origin、越界路径或不完整 clone 时停止，不清理、重置或自动整合。已固定 `bug.required_repos` 不可自行扩大；首次诊断不要求提前固定 Scope。Requirement 的 prepare 授权留待 08-B。

Runtime 管理员可通过 `RONDO_GIT_EXECUTABLE`（兼容 Git 的绝对路径）、`RONDO_GIT_PATH_PREFIX`（子进程 PATH 前缀）提供工具；不得写入共享 Registry 或绕过沙箱。认证沿用 `TFS_CLI_CONFIG` / 既有 TFS 环境配置，PAT 不进 URL、参数或日志。

完成修复和验证后，后续网络 Git 操作使用相同校验与认证：

```bash
rondo bug git --operation fetch --config "<repo-registry.json>" --issue <KEY> --repo <repo_key> --root-repo "<平台实际根仓路径>"
rondo bug git --operation push --config "<repo-registry.json>" --issue <KEY> --repo <repo_key> --root-repo "<平台实际根仓路径>"
```

fetch 仅更新目标远端事实、不整合；push 仅非强制推送已核验 HEAD 到本 Bug 候选分支。prepare 本身不 push。失败/未知时先回读远端，不重复无法确认的副作用。未 push 的本地内容不会自动迁移到其他 Task。

## Preconditions

- 当前 Issue 为 `tfs.type=Bug`，目标 Repository 已检出且允许修改；修复、必要回归、Local Validation 和 Code Review 已完成。
- 准备好 Candidate Commit（已 Push，Commit Message 包含 `Refs: #<tfs.id>`）、PR 标题，以及符合 [Evidence Contract](references/bug-evidence-contract.md) 的 JSON。需要自定义 PR 描述时另提供描述文件。
- 使用本 Skill `config/repo-registry.json` 的绝对路径；配置缺失或不可访问时停止。

## PR Preparation

1. 明确本次 Bug 涉及的全部 `repo_key`。多仓时，**首次** `prepare-pr` 通过 `--required-repos <repo1,repo2>` 提供完整集合；单仓可省略该参数。
2. 每个 Repository 分别执行：

   ```bash
   rondo bug prepare-pr --config "<repo-registry.json绝对路径>" \
     --issue <ISSUE-KEY> --repo <repo_key> --candidate-commit <40位SHA> \
     --evidence <bug-evidence.json> --title "<PR标题>" \
     --root-repo "<平台实际根仓路径>"
   ```

   共享 prepare / git 使用默认候选分支；已有自定义分支的交付仅在归属可核实时向 prepare-pr 指定 `--source-branch` / `--target-branch`；需要自定义描述时追加 `--description <PR描述文件>`，并确保执行 PR 物化的 Runtime 能读取该文件。未提供描述时，PR 物化使用已核实的 `bug.delivery` 生成内容。
3. **所有 Repository 均准备完成且最终 `ready_for_pr=true`** 后执行：

   ```bash
   rondo pr materialize --issue <ISSUE-KEY> --config "<repo-registry.json绝对路径>"
   ```

   回读 `current_pr` 和 Issue `in_review`，确认所有必要仓库均有对应 PR。

## Validation & Recovery

- 两个入口均须取得 exit 0 且 `result=PASS`；`ready_for_pr=false` 时继续准备其他仓库，不得提前创建 PR。
- 返回 FAIL / UNKNOWN 或候选 SHA、PR 身份冲突时停止；先核对 Issue 和外部 PR 的实际事实，再决定是否重试，不盲目重复物化。

## Abandoned PR

仅当 Human 在当前 Issue 明确授权，且全部当前 PR 均确认 `abandoned` 时，按决定恢复：

```bash
rondo bug resume --config "<repo-registry.json绝对路径>" --issue <ISSUE-KEY> \
  --human-comment-id <评论ID> --next REWORK|RECREATE_PR
```

- `REWORK`：重新诊断、修复和验证，并重新执行 PR Preparation。
- `RECREATE_PR`：仅复用未变更的 Candidate Commit 和有效 Evidence，重新执行 PR Materialization；候选已变则要求重新授权返工。
- PR 状态混合、Human 授权不可确认或命令返回 FAIL / UNKNOWN 时停止；按实际 PR 和 Issue 事实恢复，不擅自覆盖。
