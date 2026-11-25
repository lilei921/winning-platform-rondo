---
title: Rondo CLI 命令参考
status: active
---

# Rondo CLI 命令参考

`rondo`（npm 包：`@winning/rondo`）用于 Multica 交付流程中的 OpenSpec Change 管理、工程分析与开发、Bug 交付、TFS Work Item 与 Git PR 操作、Workspace 配置和运行环境检查。

具体可用命令以当前安装版本的 `rondo --help` 为准；本页按命令组介绍用途、参数和关键约束，不维护随版本变化的命令数量。

## 1. 命令格式与约定

```bash
rondo --version
rondo --help
rondo delivery --help
rondo doctor --help
```

- 命令通常采用 `rondo <group> <command> [options]`；`query`、`doctor` 直接位于顶层。
- 下面的 `<...>` 表示必填值，`[...]` 表示可选项，`a|b` 表示取其中一种。排版分行的命令需合并为一行执行。
- 显式 `--root-repo` 与 `--openspec-root` 路径可使用绝对路径或相对当前 cwd 的路径；`--root-repo` 仍须指向实际 Git 根仓，`--openspec-root` 可指向根仓或其 OpenSpec 目录。持久环境变量 `RONDO_WORKSPACE_PATH` 仍要求绝对路径。支持环境变量回退的命令只在未提供 `--root-repo` 时回退，显式空路径或缺值拒绝。
- 业务命令默认输出 JSON，可统一显式传入全局 `--output json`（仅支持 `json`）；诊断信息走 `stderr`。非法或缺失输出格式返回 `64`，参数错误信息走 `stderr`。`doctor` 默认输出文本，支持 `--output json`，兼容 `--format json` / `--format text`，冲突格式拒绝。帮助信息不属于业务 JSON 输出。
- 退出码：`0` 成功或无须重复执行、`2` 前置条件不满足（FAIL）、`3` 结果不能确认（UNKNOWN）、`64` 命令用法错误。具体结果以命令输出为准。
- `--help` 的具体输出和退出方式取决于子命令；可通过 `rondo --help` 和各命令组的 `--help` 查看入口。

配置安装、TFS 连接、Multica Workspace 和 Repository Registry 的说明见 [README.md](README.md#5-运行期配置)。本页仅保留命令调用契约。

## 2. 命令总览

| 命令组 | 子命令 | 主要用途 |
| --- | --- | --- |
| `change` | `resolve-identity`、`update-progress` | Change 身份解析、任务进度 |
| `analysis` | `validate`、`publish`、`read`、`approve` | 分析事实、Gate、审核提交、工件读取和批准登记 |
| `dev` | `materialize`、`prepare`、`check-dispatch`、`check-completion`、`check-change`、`publish`、`pr-prepare`、`contract-hash` | 旧派发与新 Change 研发准备、发布、验证 |
| `bug` | `pr-prepare`、`git`、`resume` | 独立 TFS Bug 修复交付 |
| `tfs` | `writeback`、`materialize-tasks`、`resolve-tasks`、`reconcile-workitem` | TFS 工作项同步与交付回写 |
| `pr` | `materialize`、`worktree`、`reconcile-status`、`create`、`get`、`list` | PR 创建、查询、状态对账及 Worktree |
| `delivery` | `admission`、`route-decision`、`finalize` | 准入交接、人工决策路由与交付收口 |
| `workspace` | `provision`、`sync`、`migrate-repo-keys`、`check-daemon` | Workspace 资源供给、同步及检查 |
| `runtime` | `get-context`、`resolve-root-repo`、`check-checkout`、`prepare-root` | 当前 Run 上下文查询、根仓库就绪检查及准备 |
| `openspec` | `install` | 安装随包分发的 OpenSpec Schema 到用户全局目录 |
| `repo` | `get` | 查询 TFS Git 仓库 |
| `branch` | `get` | 查询 TFS Git 分支 |
| `workitem` | `set-state`、`comment`、`create`、`link-commits`、`download-attachment` | TFS Work Item 操作 |
| 顶级 | `query`、`doctor` | WIQL 查询、环境体检 |

## 3. Change 与 Analysis

### 3.1 `rondo change`

```bash
rondo change resolve-identity --openspec-root <path> [--change-ref <ref>] [--tfs-id <id>] [--expect-schema <name>] [--output json]
rondo change update-progress --openspec-root <path> --change-ref <ref> --check <1.1,1.2,...>
```

| 命令 | 功能 |
| --- | --- |
| `change resolve-identity` | 根据 Change Ref 或 TFS ID 定位 OpenSpec Change，并可校验 Schema |
| `change update-progress` | 将 `tasks.md` 中指定任务标记为完成；已完成任务保持不变 |

### 3.2 `rondo analysis`

```bash
rondo analysis validate --issue <id> --facts <facts.json> --openspec-root <path> --workspace-id <id> [--registry-config <repo-registry.json>] [--multica <cli>] [--profile <name>]
rondo analysis publish [--mode requirement] --issue <id> --facts <facts.json> --registry-config <repo-registry.json> --workspace-id <id> [--multica <cli>] [--root-repo <path>] [--target-branch <branch>] [--profile <name>]
rondo analysis read --issue <KEY> --file <Change内相对路径>
rondo analysis approve --issue <KEY> --comment-id <ID> --commit <SHA> --verify-required true|false
```

| 命令 | 功能 |
| --- | --- |
| `analysis validate` | 核对 Analysis Facts，在指定根仓对当前 Change 运行 OpenSpec 严格校验，并核实返回的根仓和 Change 身份 |
| `analysis publish` | Requirement 使用 `--mode requirement` 核验 Gate，向已确认的项目根仓分支发布当前 Change 已提交的审核工件（Native 首次发布取当前根仓 Project Resource ref；已有同 Change 来源使用固定分支，`--target-branch` 不得覆盖），并登记可回读的 `analysis.source` |
| `analysis read` | 按 Issue 中的 `analysis.source` 读取指定版本的 `tasks.md`、`proposal.md`、`design.md` 或 Spec，属于只读操作 |
| `analysis approve` | 登记已确认的 Human Approval 与独立验收决定，核对 Gate、当前审核版本及真实成员评论，回读事实后按需以 `--no-start` 进入 `in_progress`。使用当前 Multica Runtime，无 Registry、Agent 或 Run 身份参数，不发 Mention、不启动 Run；同一批准可幂等重试。 |

`validate`、`publish` 面向当前分析事实；涉及 `--workspace-id` 的命令需保证其与配置中的 Workspace 身份一致。

Requirement 的 `analysis publish` 和 `dev publish` 使用 Git 2.45 或更高版本，依赖 `git merge-tree` 对三个目录树的三方合并支持。

远端已包含本次改动但无法从历史确定其本地来源时，首次发布会创建一笔文件差异为零的 Git 提交，记录来源 SHA。重试会复用这笔提交的远端 SHA。

## 4. Development 与 Bug

### 4.1 `rondo dev`

```bash
rondo dev materialize --config <repo-registry.json> --issue <KEY> --change-ref <ref> --task-refs <1.1,1.2> --engineer-id <uuid> --approved-comment-ref <uuid> [--projection parent|sub-issue] [--depends-on <issue-key>] [--activate] [--root-repo <path>]
rondo dev check-dispatch --config <repo-registry.json> --issue <KEY> --task-refs <1.1,1.2> [--change-ref <ref>] [--engineer-id <uuid>]
rondo dev check-completion --openspec-root <path> --change-ref <ref> --task-refs <1.1,1.2> --evidence <evidence.json> [--verify-commits] [--issue <KEY> --registry-config <repo-registry.json> [--root-repo <path>]]
rondo dev git --operation fetch|push --issue <KEY> --repo <repo_id> --root-repo <path>
rondo dev contract-hash --openspec-root <path> --change-ref <ref>
rondo dev prepare --workspace native --issue <KEY> --repo <repo_id> --root-repo <path> [--resource-ref <branch>] [--change-ref <ref>]
rondo dev prepare --mode requirement --config <repo-registry.json> --issue <KEY> --change-ref <ref> --repo <repo_key> [--root-repo <path>]
rondo dev publish --issue <KEY> --change-ref <ref> [--root-repo <path>] [--minor-design]
rondo dev check-change --issue <KEY> --change-ref <ref>
```

| 命令 | 功能 |
| --- | --- |
| `dev materialize` | 将已确定的 Task Set、Engineer 和依赖关系物化为研发派发事实，可选 Parent / Sub-Issue 投影 |
| `dev check-dispatch` | 只读核对任务分工、当前有效派发和工程师身份 |
| `dev check-completion` | 检查任务完成、验证 Evidence 和可选 Commit 关联 |
| `dev git` | 受控 Fetch / 非强制 Push 当前授权 Candidate |
| `dev contract-hash` | 计算当前 Change 契约文件的 SHA-256 摘要，供工程验证引用 |
| `dev prepare` | Native 使用 Multica Checkout；Requirement 必须提供 `--change-ref`，无远端 Candidate 时须提供已核实的 `--resource-ref`。旧入口仅保留兼容 |
| `dev publish` | 按已批准的 `analysis.source.branch` 发布当前 Change 已提交的 Tasks / Design，回读远端 SHA 并登记 `dev.publication`。非实质性 Design 细化使用 `--minor-design` |
| `dev check-change` | 按批准版本与登记的研发交付版本核验 Change 全部 Tasks、Candidate、Review 与 Evidence |

### 4.2 `rondo bug`

```bash
rondo bug resume --issue <KEY> --human-comment-id <id> --next REWORK|RECREATE_PR
```

| 命令 | 功能 |
| --- | --- |
| `bug resume` | 根据 Human Comment，对处于 `blocked` 且 PR 已确认 `abandoned` 的 Bug Issue 进行受控恢复 |

`bug resume` 的 REWORK 表示重新修复，RECREATE_PR 仅复用未变 Candidate 与有效 Evidence。恢复状态不等于启动新 Run。

## 5. Delivery 与 PR

### 5.1 `rondo delivery`

```bash
rondo delivery admission --issue <KEY> --decision <accepted|needs_human|unsupported>
rondo delivery route-decision --config <repo-registry.json> --issue <KEY> --comment-id <uuid> --next ANALYSIS|ENGINEERING|RECREATE_PR|CANCEL_DELIVERY [--reason REJECTED|DISCARDED] [--affected-task-refs <1.1,1.2>]
rondo delivery finalize --phase prepare|complete --issue <KEY> [--root-repo <path>]
rondo delivery root-prepare --issue <KEY>
```

| 命令 | 功能 |
| --- | --- |
| `delivery admission` | 执行 Wayfinder 已记录的 Decision：通过时按 `tfs.type` 交接并回读原生 Run，其他结果保留 Wayfinder 并设置对应状态 |
| `delivery route-decision` | 根据已确定的 Human Decision 执行交付返工、重建 PR 等确定性动作 |
| `delivery finalize` | `prepare` 核验交付并准备收口；`complete` 在外部回写完成后核验并结束交付 |
| `delivery root-prepare` | 在 Task `workdir/<repo-name>` 复用 Multica Checkout，建立 Task 独立本地归档分支，返回 `root_repo` |

`delivery root-prepare` 使用当前 Run 的 Multica Runtime（`MULTICA_WORKSPACE_ID`、`MULTICA_SERVER_URL`），仅用于 Requirement OpenSpec Change，必须在 Multica Task workdir 内运行。优先复用现有 Checkout，必要时直接调用 `multica repo checkout`，校验平台 isolated/Task/Workspace 身份、Origin/Push URL 与 `analysis.source.commit` 的可达性；本地归档分支按 Task 和来源分支隔离。Fetch、普通 Push（`HEAD:refs/heads/<analysis.source.branch>`）及 Readback 均指向 `analysis.source.branch`。不使用 Owner Marker、Cleanup Token 或 `root-cleanup`；平台 Worktree 由 Multica 管理。`root-clone` 暂保留为 Native Checkout 兼容别名。

`delivery admission` 的映射规则：

| `tfs.type` | 交接目标 |
| --- | --- |
| `Bug` | `Bug Fix Agent` |
| `Requirement`、`需求` | `Delivery Squad` |

`accepted` 执行一次 `status=todo + assignee` 更新，通过 Multica 原生机制启动对应 Run。它不重新判断 Wayfinder 的 `accepted` 结论，也不解析 `/note` 或 Evidence。若无法确认结果则返回 `UNKNOWN`，不盲目重复交接。

`delivery admission` 接受 `--issue` 和 `--decision`。`needs_human` / `unsupported` 保留 Wayfinder Assignee，分别设置 `blocked` / `unsupported`，不启动新 Run。Workspace 与服务端从 `MULTICA_WORKSPACE_ID`、`MULTICA_SERVER_URL` 读取；CLI 路径可选 `MULTICA_CLI_PATH`（默认 `multica`），并校验 `MULTICA_AGENT_ID` 必须是当前 Workspace 的 Wayfinder Agent。缺失或身份不符返回 `UNKNOWN`，不使用默认 Workspace。交接目标始终从当前 Workspace 查询。完整说明见 `rondo delivery admission --help`。

### 5.2 `rondo pr`

```bash
rondo pr prepare --issue <KEY> --repo <repo_id> --root-repo <path> --candidate-commit <sha> --facts <json|-> --title <title> [--validation-cwd <path>] [--required-repos <repo1,repo2>]
rondo pr materialize --issue <KEY>
rondo pr worktree create --config <repo-registry.json> --issue <KEY> --repo <repo_key> --branch <branch> [--base <target>] [--root-repo <path>]
rondo pr worktree remove --config <repo-registry.json> --issue <KEY> --repo <repo_key> [--root-repo <path>]
rondo pr worktree prune --config <repo-registry.json> (--project-id <id> | --root-repo <path>)
rondo pr reconcile-status [--issue <KEY> | --recover-done]
rondo pr create --repo <name|id> --source <branch> --target <branch> --title <title> [--description-file <path>] [--work-items <id,id>] [--project <project>]
rondo pr get --repo <name|id> --id <pr-id> [--project <project>]
rondo pr list --repo <name|id> [--status active|completed|abandoned] [--source-branch <branch>] [--top <n>] [--project <project>]
```

| 命令 | 功能 |
| --- | --- |
| `pr prepare` | 核对授权、Candidate 与专业 Facts，执行提供的验证命令并登记 PR Preparation；有命令时无需预填 `validation.result`，Bug 无命令时须提供真实替代验证 PASS |
| `pr materialize` | 核验适用 Gate，创建或复用 PR 并确认 Work Item 关联；in_review 仅核验已登记事实 |
| `pr worktree` | 使用 `create`、`remove`、`prune` 管理本地 Git Worktree |
| `pr reconcile-status` | 从当前 Run Workspace 扫描 Issue 的 `current_pr`，核实 `completed` / `abandoned` 等外部状态，不使用 Registry |

`pr reconcile-status` 使用 `MULTICA_WORKSPACE_ID`、`MULTICA_SERVER_URL`（可选 `MULTICA_CLI_PATH`，默认 `multica`）；手动执行需具有相同环境及 CLI 认证。
| `pr create` | 在 TFS Git 仓库创建 PR，支持已有 PR 的幂等识别 |
| `pr get` | 根据仓库和 PR ID 查询 TFS PR |
| `pr list` | 按仓库、状态、源分支等条件查询 TFS PR 列表 |

## 6. TFS 工作项与仓库

### 6.1 `rondo tfs`

```bash
rondo tfs reconcile-workitem --config <sync-config.json>
rondo tfs writeback --issue <KEY> [--root-repo <path>] [--inspect | --task-plan <plan.json>]
rondo tfs materialize-tasks --config <repo-registry.json> --issue <KEY> [--root-repo <path>]
rondo tfs resolve-tasks --config <repo-registry.json> --issue <KEY>
```

| 命令 | 功能 |
| --- | --- |
| `tfs reconcile-workitem` | 依据同步配置查询 TFS Work Item，并创建或更新对应 Multica Issue 及其来源内容 |
| `tfs writeback` | 按交付事实回写 TFS 工作项、任务状态、工时及关联信息 |
| `tfs materialize-tasks` | 根据工程任务事实创建或复用对应 TFS Task |
| `tfs resolve-tasks` | 将已完成交付对应的 TFS Task 更新至已关闭状态 |

交付收口的常用调用顺序：

```bash
rondo delivery root-prepare --issue <KEY>
rondo delivery finalize --phase prepare --issue <KEY> --root-repo <path>
rondo tfs writeback --issue <KEY> --root-repo <path> --inspect
rondo tfs writeback --issue <KEY> --root-repo <path> --task-plan <plan.json>
rondo delivery finalize --phase complete --issue <KEY> --root-repo <path>
```

已有任务计划时省略 `--task-plan`。Direct Bug 不执行 root-prepare / inspect，不传 root-repo 或 task-plan，仅执行 prepare、writeback、complete。收口命令使用当前 Multica Runtime，无 Registry 配置。

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

`workspace provision` 的 `--dry-run` 只预览；`workspace sync --local-only` 只生成本地配置，`--check` 用于检测同步差异。工作区配置按 `--workspace` 指向对应 Overlay。只有绑定 `workspace-preparation` 的 Workitem Analyst / Engineer 才接收 `project.workspace_branch` 对应的 `RONDO_WORKSPACE_BRANCH`；不修改其他 Agent 的既有环境变量。

受管 Skill 或 Agent 绑定发生变化时，先执行 `rondo workspace provision --workspace <name>` 更新绑定和 Overlay，再执行 `rondo workspace sync --workspace <name>` 同步内容。此次 `workitem-triage` 退役后，核对 Wayfinder 仅绑定 `codebase-explorer`、Overlay 不再登记旧 Skill；不自动删除其他未受管平台 Skill。

研发 Agent（Engineer / Bug Fix Agent）绑定 `native-workspace`。执行 provision 前核实 CLI、实际 TFS 根仓映射及批准版本；供给并同步 Skill 后验证实际交付。其他仍支持旧准备方式的 Agent 可按实际情况使用既有 Overlay。

### 7.2 `rondo runtime`

```bash
rondo runtime get-context
rondo runtime resolve-root-repo --config <repo-registry.json> (--issue <KEY> | --project-id <id> | --root-repo <path>)
rondo runtime check-checkout --root-repo <path>
rondo runtime prepare-root [--root-repo <path>] [--branch <branch>]
```

`runtime get-context` 只读获取当前 Multica Agent Run 的 Runtime 信息（`multica_cli`、`multica_server_url`、`workspace_id`、`rondo`、`delivery_squad_id`）。Workspace 和 Server 来自当前 Run 环境变量；按名称 `Delivery Squad` 在当前 Workspace 查找唯一有效 Squad。缺少环境或无法确认目标时返回 `UNKNOWN`（exit 3）；不依赖 `repo-registry.json`，不支持从外部终端猜测默认 Workspace。

`runtime resolve-root-repo` 根据 Issue、Project 或指定路径解析根仓库位置，返回根仓及相关上下文路径信息。`check-checkout` 只读校验已有根仓。`prepare-root` 优先使用 `--root-repo`，省略时读取 `RONDO_WORKSPACE_PATH`。分支取必需的 `RONDO_WORKSPACE_BRANCH`，优先于 `--branch`。命令在原目录检查分支占用、按 Change 分别本地保存切换前的改动，并在安全时快进。历史分叉时保留本地提交和工作区。

### 7.3 `rondo openspec`

```bash
rondo openspec install
```

把随 rondo 包分发的 `openspec/schemas` 安装到 OpenSpec 用户全局目录（`XDG_DATA_HOME` / `%LOCALAPPDATA%` / `~/.local/share` 下的 `openspec/schemas`）。同名 Schema 直接覆盖，其他 Schema 不受影响；不访问网络、不做 OpenSpec CLI 校验。SEA 单文件运行不支持该命令。

## 8. 环境检查：`rondo doctor`

```bash
rondo doctor [--require <check1,check2,...>] [--output json | --format text|json] [--expect-openspec <version>] [--workspace-id <id> [--profile <name>]] [--network-sample <N>] [--network-interval <ms>]
```

`doctor` 为只读环境体检命令。默认检查基础环境；`network_baseline` 需按需显式启用。具体检查项以当前版本 `doctor --help` 和输出为准。

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
- 不指定 `--output json` 或 `--format json` 时输出人类可读的文本结果。

