---
title: Rondo CLI 命令参考
status: active
updated_at: 2026-11-19
---

# Rondo CLI 命令参考

`rondo`（npm 包：`@winning/rondo`）用于 Multica 交付流程中的 OpenSpec Change 管理、工程分析与开发、Bug 交付、TFS Work Item 与 Git PR 操作、Workspace 配置和运行环境检查。

其中 12 个命令组包含 44 个子命令，`query` 和 `doctor` 为顶级命令。

## 1. 命令格式与约定

```bash
rondo --version
rondo --help
rondo delivery --help
rondo doctor --help
```

- 命令通常采用 `rondo <group> <command> [options]`；`query`、`doctor` 直接位于顶层。
- 下面的 `<...>` 表示必填值，`[...]` 表示可选项，`a|b` 表示取其中一种。排版分行的命令需合并为一行执行。
- 业务命令的 `stdout` 通常为 JSON，诊断信息输出到 `stderr`；`doctor` 默认输出文本，可使用 `--format json`。帮助信息不属于业务 JSON 输出。
- 退出码：`0` 成功或无须重复执行、`2` 前置条件不满足（FAIL）、`3` 结果不能确认（UNKNOWN）、`64` 命令用法错误。具体结果以命令输出为准。
- `--help` 的具体输出和退出方式取决于子命令；可通过 `rondo --help` 和各命令组的 `--help` 查看入口。

### 1.1 Multica 连接配置

多数交付命令使用 `--config <repo-registry.json>`，其中 `runtime` 用于定义 Multica CLI、Workspace 和环境：

```json
{
  "runtime": {
    "multica_cli": "multica",
    "workspace_id": "<workspace-id>",
    "delivery_squad_id": "<delivery-squad-id>",
    "multica_server_url": "<server-url>"
  },
  "registry": {}
}
```

- `runtime.workspace_id` 指定工作区，避免操作落入 CLI 默认 Workspace。
- `runtime.multica_profile` 用于选择命名的 Multica 连接配置；已绑定 `multica_server_url` 的配置需保持连接身份一致。
- `registry` 按仓库键维护业务仓库路径、TFS 仓库名、项目和目标分支等信息；具体字段要求因命令而异。
- 使用 `rondo workspace sync` 可为受管 Skill 生成所需的配置文件；`workitem-triage` 使用该配置调用 `rondo delivery handoff`。

### 1.2 TFS 连接配置

TFS 相关命令使用以下环境变量，或从 `config/tfs.config.json` 读取连接参数：

| 环境变量 | 作用 |
| --- | --- |
| `TFS_PAT` | 访问令牌，不作为命令行参数传递 |
| `TFS_SERVER_URL` | 完整的 TFS Collection URL，优先于 `TFS_URL` |
| `TFS_URL` | TFS 基础地址，不包含 Collection |
| `TFS_COLLECTION` | Collection 名称 |
| `TFS_PROJECT` | 默认 TFS Project，可由命令的 `--project` 覆盖 |
| `TFS_CLI_CONFIG` | 指定 TFS 配置文件路径 |

TFS 配置按环境变量优先、配置文件其次的规则读取。配置文件可包含 `url`、`collection`、`project`、`token`；连接令牌不应写入命令或日志。

## 2. 命令总览

| 命令组 | 子命令 | 数量 | 主要用途 |
| --- | --- | ---: | --- |
| `change` | `resolve-identity`、`update-progress` | 2 | Change 身份解析、任务进度 |
| `analysis` | `stage`、`validate`、`complete`、`read` | 4 | 分析事实、Gate、审核提交和工件读取 |
| `dev` | `materialize`、`prepare`、`check-dispatch`、`check-completion`、`check-change`、`publish`、`pr-prep`、`contract-hash` | 8 | 旧派发与新 Change 研发准备、发布、验证 |
| `bug` | `prepare-pr`、`git`、`resume` | 3 | 独立 TFS Bug 修复交付 |
| `tfs` | `writeback`、`materialize-tasks`、`resolve-tasks`、`reconcile-workitem` | 4 | TFS 工作项同步与交付回写 |
| `pr` | `materialize`、`worktree`、`reconcile-status`、`create`、`get`、`list` | 6 | PR 创建、查询、状态对账及 Worktree |
| `delivery` | `handoff`、`route-decision`、`finalize` | 3 | 准入交接、人工决策路由与交付收口 |
| `workspace` | `provision`、`sync`、`migrate-repo-keys`、`check-daemon` | 4 | Workspace 资源供给、同步及检查 |
| `runtime` | `resolve-root-repo`、`check-checkout`、`prepare-root` | 3 | 根仓库定位、就绪检查与持久根仓安全同步 |
| `repo` | `get` | 1 | 查询 TFS Git 仓库 |
| `branch` | `get` | 1 | 查询 TFS Git 分支 |
| `workitem` | `set-state`、`comment`、`create`、`link-commits`、`download-attachment` | 5 | TFS Work Item 操作 |
| 顶级 | `query`、`doctor` | 2 | WIQL 查询、环境体检 |
| **合计** | **46 个命令** | **46** | |

## 3. Change 与 Analysis

### 3.1 `rondo change`

```bash
rondo change resolve-identity --openspec-root <path> [--change-ref <ref>] [--tfs-id <id>] [--expect-schema <name>]
rondo change update-progress --openspec-root <path> --change-ref <ref> --check <1.1,1.2,...>
```

| 命令 | 功能 |
| --- | --- |
| `change resolve-identity` | 根据 Change Ref 或 TFS ID 定位 OpenSpec Change，并可校验 Schema |
| `change update-progress` | 将 `tasks.md` 中指定任务标记为完成；已完成任务保持不变 |

### 3.2 `rondo analysis`

```bash
rondo analysis stage --issue <id> --facts <facts.json> --workspace-id <id> [--registry-config <repo-registry.json>] [--multica <cli>] [--profile <name>]
rondo analysis validate --issue <id> --openspec-root <path> --workspace-id <id> [--out <path>] [--registry-config <repo-registry.json>] [--multica <cli>] [--profile <name>]
rondo analysis complete [--mode requirement] --issue <id> --facts <facts.json> --registry-config <repo-registry.json> --workspace-id <id> [--multica <cli>] [--root-repo <path>] [--profile <name>]
rondo analysis read --config <repo-registry.json> --issue <KEY> --file <Change内相对路径>
```

| 命令 | 功能 |
| --- | --- |
| `analysis stage` | 将分析结果暂存到 Issue Metadata，不直接推进审核状态 |
| `analysis validate` | 核对 Analysis Facts，在指定根仓对当前 Change 运行 OpenSpec 严格校验，并核实返回的根仓和 Change 身份 |
| `analysis complete` | Requirement 使用 `--mode requirement` 核验 Gate，向项目根仓分支发布当前 Change 已提交的审核工件，并登记可回读的 `analysis.source` |
| `analysis read` | 按 Issue 中的 `analysis.source` 读取指定版本的 `tasks.md`、`proposal.md`、`design.md` 或 Spec，属于只读操作 |

`stage`、`validate`、`complete` 面向当前分析事实；涉及 `--workspace-id` 的命令需保证其与配置中的 Workspace 身份一致。

Requirement 的 `analysis complete` 和 `dev publish` 使用 Git 2.45 或更高版本，依赖 `git merge-tree` 对三个目录树的三方合并支持。

远端已包含本次改动但无法从历史确定其本地来源时，首次发布会创建一笔文件差异为零的 Git 提交，记录来源 SHA。重试会复用这笔提交的远端 SHA。

## 4. Development 与 Bug

### 4.1 `rondo dev`

```bash
rondo dev materialize --config <repo-registry.json> --issue <KEY> --change-ref <ref> --task-refs <1.1,1.2> --engineer-id <uuid> --approved-comment-ref <uuid> [--projection parent|sub-issue] [--depends-on <issue-key>] [--activate] [--root-repo <path>]
rondo dev check-dispatch --config <repo-registry.json> --issue <KEY> --task-refs <1.1,1.2> [--change-ref <ref>] [--engineer-id <uuid>]
rondo dev check-completion --openspec-root <path> --change-ref <ref> --task-refs <1.1,1.2> --evidence <evidence.json> [--verify-commits] [--issue <KEY> --registry-config <repo-registry.json> [--root-repo <path>]]
rondo dev pr-prep --config <repo-registry.json> --issue <KEY> --repo <repo_key> --change-ref <ref> --candidate-commit <sha> --title <title> [--target-branch <branch>] [--source-branch <branch>] [--description <path>]
rondo dev contract-hash --openspec-root <path> --change-ref <ref>
rondo dev prepare --mode requirement --config <repo-registry.json> --issue <KEY> --change-ref <ref> --repo <repo_key> [--root-repo <path>]
rondo dev publish --config <repo-registry.json> --issue <KEY> --change-ref <ref> [--root-repo <path>] [--minor-design]
rondo dev check-change --config <repo-registry.json> --issue <KEY> --change-ref <ref>
```

| 命令 | 功能 |
| --- | --- |
| `dev materialize` | 将已确定的 Task Set、Engineer 和依赖关系物化为研发派发事实，可选 Parent / Sub-Issue 投影 |
| `dev check-dispatch` | 只读核对任务分工、当前有效派发和工程师身份 |
| `dev check-completion` | 检查任务完成、验证 Evidence 和可选 Commit 关联 |
| `dev pr-prep` | 核对候选 Commit，写入 PR 准备事实；不直接创建 PR |
| `dev contract-hash` | 计算当前 Change 契约文件的 SHA-256 摘要，供工程验证引用 |
| `dev prepare` | 新 Requirement 用持久根仓和 `feature/<tfs.id>` Worktree；旧 Bug 使用原有默认模式 |
| `dev publish` | 发布当前 Change 已提交的 Tasks / Evidence / PR 描述，回读远端 SHA 并登记 `dev.publication`。非实质性 Design 细化使用 `--minor-design` |
| `dev check-change` | 按批准版本与登记的研发交付版本核验 Change 全部 Tasks、Candidate、Review 与 Evidence |

### 4.2 `rondo bug`

```bash
rondo bug prepare-pr --config <repo-registry.json> --issue <KEY> --repo <repo_key> --candidate-commit <40-SHA> --evidence <evidence.json|-> --title <title> [--description <path>] [--required-repos <repo1,repo2>] [--source-branch <branch>] [--target-branch <branch>] [--root-repo <path>]
rondo bug git --config <repo-registry.json> --issue <KEY> --repo <repo_key> --root-repo <path> --operation fetch|push
rondo bug resume --config <repo-registry.json> --issue <KEY> --human-comment-id <id> --next REWORK|RECREATE_PR
```

| 命令 | 功能 |
| --- | --- |
| `bug prepare-pr` | 核验 Bug 交付范围、Root Cause、回归验证、本地验证、Code Review 和 Commit，写入 `bug.delivery` 与 `pr_prep` |
| `bug resume` | 根据 Human Comment，对处于 `blocked` 且 PR 已确认 `abandoned` 的 Bug Issue 进行受控恢复 |
| `bug git` | 在当前 Bug Run 授权下受控 Fetch 或非强制 Push 候选分支 |

`bug prepare-pr` 支持从 stdin 读取 JSON（`--evidence -`）或现有本地文件；Issue / TFS ID / Repository / Candidate SHA 由 CLI 核实，可从输入 JSON 省略，显式冲突时拒绝。必要验证 Gate 不变。`bug prepare-pr` 不创建 PR；准备条件满足后使用 `rondo pr materialize`。`bug resume` 的 `REWORK` 表示重新修复，`RECREATE_PR` 表示重建 PR；恢复状态本身不等于启动新 Run。

## 5. Delivery 与 PR

### 5.1 `rondo delivery`

```bash
rondo delivery handoff --config <repo-registry.json> --issue <KEY>
rondo delivery route-decision --config <repo-registry.json> --issue <KEY> --comment-id <uuid> --next ANALYSIS|ENGINEERING|RECREATE_PR|CANCEL_DELIVERY [--reason REJECTED|DISCARDED] [--affected-task-refs <1.1,1.2>]
rondo delivery finalize --phase prepare|complete --issue <KEY> --config <repo-registry.json> [--root-repo <path>]
```

| 命令 | 功能 |
| --- | --- |
| `delivery handoff` | Wayfinder 准入通过后依据 Issue 的 `tfs.type` 将 Issue 交给目标 Agent / Squad，并回读原生 Run |
| `delivery route-decision` | 根据已确定的 Human Decision 执行交付返工、重建 PR 等确定性动作 |
| `delivery finalize` | `prepare` 核验交付并准备收口；`complete` 在外部回写完成后核验并结束交付 |

`delivery handoff` 的映射规则：

| `tfs.type` | 交接目标 |
| --- | --- |
| `Bug` | `Bug Fix Agent` |
| `Requirement`、`需求` | `Delivery Squad` |

`handoff` 执行一次 `status=todo + assignee` 更新，通过 Multica 原生机制启动对应 Run。它不重新判断 Wayfinder 的 `eligible` 结论，也不解析 `/note` 或 Evidence。若无法确认结果则返回 `UNKNOWN`，不盲目重复交接。

### 5.2 `rondo pr`

```bash
rondo pr materialize [--mode requirement --change-ref <ref>] --issue <KEY> --config <repo-registry.json>
rondo pr worktree create --config <repo-registry.json> --issue <KEY> --repo <repo_key> --branch <branch> [--base <target>] [--root-repo <path>]
rondo pr worktree remove --config <repo-registry.json> --issue <KEY> --repo <repo_key> [--root-repo <path>]
rondo pr worktree prune --config <repo-registry.json> (--project-id <id> | --root-repo <path>)
rondo pr reconcile-status --config <repo-registry.json> [--issue <KEY> | --recover-done]
rondo pr create --repo <name|id> --source <branch> --target <branch> --title <title> [--description-file <path>] [--work-items <id,id>] [--project <project>]
rondo pr get --repo <name|id> --id <pr-id> [--project <project>]
rondo pr list --repo <name|id> [--status active|completed|abandoned] [--source-branch <branch>] [--top <n>] [--project <project>]
```

| 命令 | 功能 |
| --- | --- |
| `pr materialize` | 创建/复用 PR；新 Requirement 需 `--mode requirement --change-ref` 并先执行 Change 级 Completion |
| `pr worktree` | 使用 `create`、`remove`、`prune` 管理本地 Git Worktree |
| `pr reconcile-status` | 对账已登记 PR 的外部状态，核实 `completed` / `abandoned` 等结果及后续收口条件 |
| `pr create` | 在 TFS Git 仓库创建 PR，支持已有 PR 的幂等识别 |
| `pr get` | 根据仓库和 PR ID 查询 TFS PR |
| `pr list` | 按仓库、状态、源分支等条件查询 TFS PR 列表 |

`pr worktree` 的 `create`、`remove` 和 `prune` 为一个命令的三种操作模式，命令总数按一个计算。

## 6. TFS 工作项与仓库

### 6.1 `rondo tfs`

```bash
rondo tfs reconcile-workitem --config <sync-config.json>
rondo tfs writeback --config <repo-registry.json> --issue <KEY> [--root-repo <path>]
rondo tfs materialize-tasks --config <repo-registry.json> --issue <KEY> [--root-repo <path>]
rondo tfs resolve-tasks --config <repo-registry.json> --issue <KEY>
```

| 命令 | 功能 |
| --- | --- |
| `tfs reconcile-workitem` | 依据同步配置查询 TFS Work Item，并创建或更新对应 Multica Issue 及其来源内容 |
| `tfs writeback` | 按交付事实回写 TFS 工作项、任务状态、工时及关联信息 |
| `tfs materialize-tasks` | 根据工程任务事实创建或复用对应 TFS Task |
| `tfs resolve-tasks` | 将已完成交付对应的 TFS Task 更新至已解决状态 |

交付收口的常用调用顺序：

```bash
rondo delivery finalize --phase prepare --config <repo-registry.json> --issue <KEY>
rondo tfs writeback --config <repo-registry.json> --issue <KEY>
rondo delivery finalize --phase complete --config <repo-registry.json> --issue <KEY>
```

### 6.2 顶级 WIQL 查询及 Git 仓库查询

```bash
rondo query --wiql "<WIQL>" [--project <project>]
rondo repo get --name <repo> [--project <project>]
rondo branch get --repo <name|id> --name <branch> [--project <project>]
```

| 命令 | 功能 |
| --- | --- |
| `query` | 执行 WIQL 查询并返回 TFS Work Item 数据 |
| `repo get` | 按仓库名称读取 TFS Git 仓库信息 |
| `branch get` | 查询指定 TFS Git 分支及其 HEAD |

### 6.3 `rondo workitem`

```bash
rondo workitem set-state --id <id> --state <state> [--complete-with-estimate] [--project <project>]
rondo workitem comment --id <id> --text-file <path> [--project <project>]
rondo workitem create --type <type> --title <title> --parent <id> [--description-file <path>] [--estimate <hours>] [--project <project>]
rondo workitem link-commits --id <id> --repo <name|id> --sha <sha,sha,...> [--project <project>]
rondo workitem download-attachment --url <attachment-url> --out <directory> [--name <file>]
```

| 命令 | 功能 |
| --- | --- |
| `workitem set-state` | 将 Work Item 更新到目标状态；`--complete-with-estimate` 同时核对并填写完成工时 |
| `workitem comment` | 读取本地文件内容并写入 TFS Work Item History |
| `workitem create` | 创建并关联父 Work Item 下的子工作项，可设置预估工时 |
| `workitem link-commits` | 将指定 Commit 通过 Artifact Link 关联到 Work Item，重复关联可跳过 |
| `workitem download-attachment` | 下载工作项附件，按文件内容识别并解压 gzip 数据 |

## 7. Workspace 与 Runtime

### 7.1 `rondo workspace`

```bash
rondo workspace provision --workspace <name> [--slug <slug>] [--create-workspace [--display-name <name>]] [--runtime-id <uuid>] [--profile <name>] [--dry-run] [--skip-workflow]
rondo workspace sync --workspace <name> [--skill <skill>] [--local-only] [--profile <name>] [--dry-run] [--check]
rondo workspace migrate-repo-keys --workspace <name> [--issue <KEY>] [--config <path>] [--dry-run | --apply] [--backup-dir <directory>]
rondo workspace check-daemon --workspace-id <id> [--project-id <id>]
```

| 命令 | 功能 |
| --- | --- |
| `workspace provision` | 根据 Workspace 配置创建或核对 Agent、Skill、Squad、Project 和工作流对象，并记录对象 ID |
| `workspace sync` | 将本地受管 Skill 内容同步到 Multica Workspace，生成对应运行配置 |
| `workspace migrate-repo-keys` | 预览或实施 Workspace Issue 中的 Repository Key Metadata 变更；`--apply` 才写入 |
| `workspace check-daemon` | 检查 Daemon 环境变量、Runtime 注册、挂载唯一性和交付亲和条件 |

`workspace provision` 的 `--dry-run` 只预览；`workspace sync --local-only` 只生成本地配置，`--check` 用于检测同步差异。工作区配置按 `--workspace` 指向对应 Overlay。完整 provision 将 `_shared/provisioning.json` 中的 `project.workspace_branch` 下发为每个受管 Agent 的 `RONDO_WORKSPACE_BRANCH`。

### 7.2 `rondo runtime`

```bash
rondo runtime resolve-root-repo --config <repo-registry.json> (--issue <KEY> | --project-id <id> | --root-repo <path>)
rondo runtime check-checkout --root-repo <path>
rondo runtime prepare-root [--root-repo <path>] [--branch <branch>]
```

`runtime resolve-root-repo` 根据 Issue、Project 或指定路径解析根仓库位置，返回根仓及相关上下文路径信息。`check-checkout` 只读校验已有根仓。`prepare-root` 优先使用 `--root-repo`，省略时读取 `RONDO_WORKSPACE_PATH`。分支取必需的 `RONDO_WORKSPACE_BRANCH`，优先于 `--branch`。命令在原目录检查分支占用、按 Change 分别本地保存切换前的改动，并在安全时快进。历史分叉时保留本地提交和工作区。

## 8. 环境检查：`rondo doctor`

```bash
rondo doctor [--require <check1,check2,...>] [--format text|json] [--expect-openspec <version>] [--workspace-id <id> [--profile <name>]] [--network-sample <N>] [--network-interval <ms>]
```

`doctor` 为只读环境体检命令。默认检查 16 项，另有按需执行的 `network_baseline`，共 17 项可选检查。

| 类别 | 检查项 |
| --- | --- |
| 运行时 | `node_runtime`、`npm_registry_config` |
| CLI 工具 | `openspec_cli`、`rondo_self`、`git`、`python` |
| 服务连通性 | `internal_npm_registry`、`tfs_api`、`multica_api` |
| 配置 | `openspec_root`、`repo_registry`、`tfs_config`、`daemon_env` |
| 一致性 | `version_alignment`、`path_precedence`、`workflow_statuses` |
| 网络 | `network_baseline`（显式选用） |

常用示例：

```bash
rondo doctor --format json
rondo doctor --require tfs_api,multica_api --format json
rondo doctor --workspace-id <id> --require workflow_statuses --format json
rondo doctor --require network_baseline --network-sample 5 --network-interval 500 --format json
```

- `--require` 指定必须通过的检查项；被要求的检查结果不是 `PASS` 时退出码为 `2`。
- `--profile` 需与 `--workspace-id` 一起使用，影响 `workflow_statuses` 的 Multica 连接。
- `--network-sample`、`--network-interval` 仅用于 `network_baseline`，必须配合 `--require network_baseline`。
- 不指定 `--format json` 时输出人类可读的文本结果。

## 9. 常用命令示例

以下均为 CLI 调用示例，请替换占位符为实际 Workspace、Issue、Repository 和文件路径：

```bash
# Wayfinder 已完成准入后交接
rondo delivery handoff --config <repo-registry.json> --issue <KEY>

# 读取 Change 的任务清单
rondo analysis read --config <repo-registry.json> --issue <KEY> --file tasks.md

# 查看单个 Issue 对应的 PR 状态
rondo pr reconcile-status --config <repo-registry.json> --issue <KEY>

# 检查 Workspace Skill 是否存在同步差异
rondo workspace sync --workspace <name> --check

# 查询 TFS Git PR
rondo pr list --repo <repo> --status active --project <project>

# 检查 CLI 与 Multica/TFS 的运行环境
rondo doctor --require rondo_self,tfs_api,multica_api --format json
```
