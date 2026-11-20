---
name: change-development
description: 依据已批准的 OpenSpec Change 执行代码实现、开发侧验证与 PR 技术交付；需要跨一个或多个授权仓库完成研发时使用。
---

# Inputs

- 当前 Issue 的 `change_ref`、已批准的 Proposal / Specs / Design / `tasks.md` 与 `.openspec.yaml` 的 `x-repositories`（Repository Scope）。
- 本 Skill `config/repo-registry.json`（从 Skill 根目录解析）、实际核实的根仓与授权业务仓路径、构建测试工具。
- Root / 业务 Git 的 TFS PAT 由既有 `TFS_CLI_CONFIG` 或 `TFS_PAT` 提供；缺凭据时停止，不将 PAT 写入 Change、Registry 或命令参数。

# Approach

## Understand

通过 `rondo analysis read --file <path>` 按已批准的 `analysis.source.commit` 读取 Proposal、Specs、适用的 Design 和 Tasks，确定修改范围与验证目标。本地操作使用已就绪的项目分支根仓，以及当前获批 Change 准备成功的业务 Worktree。准备结果不明时按需使用 `workspace-preparation`。如本机缺少待更新的 Tasks 或 Design，只从批准版本取回对应文件，保留已有本地修改。

## Implement

仅在已确认的授权业务 Worktree 内按实际依赖实现代码、测试和必要文档。复用已有实现，避免无关重构。必要的非实质性 Design 细化可以保留；改变行为、接口、验收或授权范围须重新审批。

## Validate

针对实际风险执行测试、构建、静态检查或运行验证，完成 Code Review，修复 Blocking Findings。只通过 `rondo change update-progress` 勾选已有真实验证依据的任务。

## Deliver

对实际修改的仓库 Commit / Push 并记录完整 Candidate SHA；更新 Change 顶层 `evidence-<repo_id>.json`、`pr-description-<repo_id>.md` 与 Tasks 进度。在根仓按具体路径本地提交本次研发工件，保留其他暂存内容。发布成功后按 Change 完成检查创建或复用 PR。

# CLI Operations

```bash
# <config> 为本 Skill 的 config/repo-registry.json；<root> 为已确认在项目分支就绪的实际 root_repo
rondo analysis read --config "<config>" --issue <issue> --file tasks.md

rondo change update-progress --openspec-root "<root>" --change-ref <change_ref> --check <verified_task_ids>

# 首先完善 Change 内 pr-description-<repo_id>.md；pr-prep 只生成缺失文件的草稿
rondo dev pr-prep --mode requirement --config "<config>" --issue <issue> --repo <repo_id> \
  --change-ref <change_ref> --root-repo "<root>" --candidate-commit <sha> --title "<title>"

rondo dev publish --config "<config>" --issue <issue> --change-ref <change_ref> --root-repo "<root>"
rondo dev check-change --config "<config>" --issue <issue> --change-ref <change_ref>
rondo pr materialize --mode requirement --config "<config>" --issue <issue> --change-ref <change_ref>
```

仅当确属非实质性 Design 细化且需要发布时，使用 `rondo dev publish ... --minor-design`；不能用该参数放行实质性需求变化。`dev.publication.commit` 记录本次研发交付，工程契约仍来自获批的 `analysis.source.commit`。

# Minimal Evidence

每个实际修改的仓库在 Change 顶层保存一份 `evidence-<repo_id>.json`，字段与 `rondo dev check-change` 契约一致：

```json
{
  "change_ref": "<change_ref>",
  "repo_key": "<repo_id>",
  "candidate_commit": "<full SHA>",
  "commits": [{"repo_key": "<repo_id>", "repo_url": "<Registry repo_url>", "sha": "<full SHA>"}],
  "local_validation": {"result": "PASS", "summary": "<真实验证及结果>"},
  "code_review": {"result": "PASS", "summary": "<真实审查结论>", "findings": []},
  "blockers": []
}
```

字段必须对应同一真实 Candidate；有未解决的 Blocking Finding、验证失败或证据不足时不得写 PASS。PR 描述须包含实际修改、验证及可追溯引用，不提交自动生成的空草稿。

# Output / Stop

输出可审查的实现、真实验证与 Review 结论、实际已完成任务、Candidate / PR / Evidence 引用及剩余风险。无法确认批准来源、仓库授权、业务分支、必要验证或外部写入结果时，保留现场并报告，不自行改写发布历史。
