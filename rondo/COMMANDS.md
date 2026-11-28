---
title: Rondo CLI 命令参考
status: active
---

# Rondo CLI 命令参考

`rondo`（npm 包：`@winning/rondo`）是面向 Multica 研发交付的确定性 CLI，提供交付校验、执行、事实管理及平台运维能力。

具体可用命令以当前安装版本的 `rondo --help` 为准；本页按命令组介绍用途、参数和关键约束，不维护随版本变化的命令数量。

## 1. 命令格式与约定

```bash
rondo --version
rondo --help
rondo workitem --help
rondo doctor --help
```

- 命令通常采用 `rondo <group> <command> [options]`；`doctor` 直接位于顶层。
- 下面的 `<...>` 表示必填值，`[...]` 表示可选项，`a|b` 表示取其中一种。排版分行的命令需合并为一行执行。
- 显式 `--root-repo` 与 `--openspec-root` 路径可使用绝对路径或相对当前 cwd 的路径；`--root-repo` 仍须指向实际 Git 根仓，`--openspec-root` 可指向根仓或其 OpenSpec 目录。持久环境变量 `RONDO_WORKSPACE_PATH` 仍要求绝对路径。支持环境变量回退的命令只在未提供 `--root-repo` 时回退，显式空路径或缺值拒绝。
- 业务命令默认输出 JSON，可统一显式传入全局 `--output json`（仅支持 `json`）；诊断信息走 `stderr`。非法或缺失输出格式返回 `64`，参数错误信息走 `stderr`。`doctor` 默认输出文本，支持 `--output json`，兼容 `--format json` / `--format text`，冲突格式拒绝。帮助信息不属于业务 JSON 输出。
- 退出码：`0` 成功或无须重复执行、`2` 前置条件不满足（FAIL）、`3` 结果不能确认（UNKNOWN）、`64` 命令用法错误。具体结果以命令输出为准。
- `--help` / `-h` 输出当前命令的帮助到 stdout，退出码为 0，不执行实际操作；缺少必填参数或用法错误仍返回 64。

配置安装、TFS 连接、Multica Workspace 和 Project Resource 的说明见 [README.md](README.md#5-运行期配置)。本页仅保留命令调用契约。

**Issue 定位**：绑定 Issue 的 Run 中，单 Issue 命令的 `--issue <key-or-id>` 可省略；Rondo 根据 Multica 提供的 `MULTICA_TASK_CONFIG_ROOT` 定位同级 `workdir/.multica/daemon_task_context.json`，读取当前 Agent 对应的 `issue_id`。显式参数优先；无法确认上下文时返回 `UNKNOWN`，请显式指定。批量 `pr reconcile-status` 省略 `--issue` 仍表示扫描；Autopilot 收口命令须明确指定 Issue。

## 2. 命令总览

| 命令组 | 子命令 | 主要用途 |
| --- | --- | --- |
| `pr` | `prepare`、`materialize`、`resume`、`reconcile-status`、`create`、`get`、`list` | PR 准备、创建、查询及状态对账 |
| `workspace` | `provision`、`sync-skills` | Workspace 资源供给与 Skill 同步 |
| `runtime` | `get-context`、`check-checkout`、`check-daemon`、`reconcile` | Runtime / Daemon、Checkout 检查及主备协调 |
| `openspec` | `resolve-identity`、`install-schema`、`validate`、`read`、`submit-review`、`publish` | OpenSpec Change、Schema 与工程工件管理 |
| `repo` | `get`、`get-branch`、`fetch`、`push`、`prepare-archive` | Git 仓库查询、准备与受控操作 |
| `workitem` | `sync-issue`、`apply-decision`、`approve`、`finalize`、`writeback`、`set-state`、`comment`、`create`、`link-commits`、`download-attachment` | 工作项同步、准入、批准、收口及回写操作 |
| 顶级 | `doctor` | 环境体检 |

## 3. OpenSpec

### 3.1 `rondo openspec`

```bash
rondo openspec resolve-identity --openspec-root <path> [--change-ref <ref>] [--tfs-id <id>] [--expect-schema <name>] [--output json]
rondo openspec install-schema
rondo openspec validate [--issue <key-or-id>] --change-ref <id> --openspec-root <path> [--workspace-id <id>] [--multica <cli>]
rondo openspec read [--issue <key-or-id>] --file <Change内相对路径>
rondo openspec submit-review [--issue <key-or-id>] --change-ref <id> [--root-repo <path>] [--target-branch <branch>]
rondo openspec publish [--issue <key-or-id>] [--root-repo <path>] [--minor-design]
```

| 命令 | 功能 |
| --- | --- |
| `openspec resolve-identity` | 根据 Change Ref 或 TFS ID 定位 OpenSpec Change，并可校验 Schema |
| `openspec install-schema` | 将随包分发的 Schema 安装到 OpenSpec 用户全局目录 |
| `openspec validate` | 按需只读诊断 Issue 与 Change 身份、Schema、工程工件及 OpenSpec Strict Validation；正常提交由 `submit-review` 执行最终 Gate，无需预先调用 |
| `openspec read` | 按 Issue 中固定的 `analysis.source` Commit 读取指定版本的 OpenSpec 工件，不跟随可变分支 |
| `openspec submit-review` | 根据 Issue 类型校验并发布当前 Change 的审核版本，核实固定 Git 来源，登记 `analysis.source` 与 Gate 事实，并进入 `analysis_review` |
| `openspec publish` | 按已批准的 `analysis.source.branch` 发布当前 Change 已提交的 Tasks / Design，确认远端 Git SHA 并登记绑定完整 `analysis.source` 的 `dev.publication`。非实质性 Design 细化使用 `--minor-design` |

`openspec install-schema` 把随 Rondo 包分发的 `openspec/schemas` 安装到 OpenSpec 用户全局目录（`XDG_DATA_HOME` / `%LOCALAPPDATA%` / `~/.local/share` 下的 `openspec/schemas`）。同名 Schema 直接覆盖，其他 Schema 不受影响；不访问网络、不做 OpenSpec CLI 校验。SEA 单文件运行不支持该命令。

`openspec validate` 仅用于按需诊断，不持久化 Gate 结果；`openspec submit-review` 直接指定 Change ID，Change Kind 由 Schema 推导，专业审查与独立验证建议不作为 CLI 输入。Requirement 首次 Native 发布使用当前根仓 Project Resource 的 `ref`；同一 Change 已有 `analysis.source` 时沿用其固定分支，`--target-branch` 不得覆盖。提交审核成功后，固定来源由下游按需读取。

Requirement 的 `openspec submit-review` 和研发工件 `openspec publish` 使用 Git 2.45 或更高版本，依赖 `git merge-tree` 对三个目录树的三方合并支持。

远端已包含本次改动但无法从历史确定其本地来源时，首次提交审核会创建一笔文件差异为零的 Git 提交，记录来源 SHA。重试会复用这笔提交的远端 SHA。

## 4. Git 仓库操作：`rondo repo`

```bash
rondo repo get --repo <name|id> [--project <project>]
rondo repo get-branch --repo <name|id> --branch <branch> [--project <project>]
rondo repo fetch [--issue <key-or-id>] --repo <repo_id> --root-repo <path>
rondo repo push [--issue <key-or-id>] --repo <repo_id> --root-repo <path>
rondo repo prepare-archive --issue <KEY>
```

| 命令 | 功能 |
| --- | --- |
| `repo get` | 按仓库名称或 ID 读取 TFS Git 仓库信息 |
| `repo get-branch` | 查询指定 TFS Git 分支及其 HEAD |
| `repo fetch` | 受控 Fetch 当前授权仓库的目标分支，不执行合并 |
| `repo push` | 非强制 Push 当前授权 Candidate，确认远端 SHA |
| `repo prepare-archive` | 在 Task `workdir/<repo-name>` 复用 Multica Checkout，建立 Task 独立本地归档分支，返回 `root_repo` |

`repo prepare-archive` 使用当前 Run 的 Multica Runtime（`MULTICA_WORKSPACE_ID`、`MULTICA_SERVER_URL`），仅用于 Requirement OpenSpec Change，必须在 Multica Task workdir 内运行。CLI 从平台提供的有效 `MULTICA_TASK_ENV_FILE` 补齐缺失的 Task 环境（包括 `MULTICA_TASK_ID`），不覆盖已有有效值；无法确认必要身份时返回 UNKNOWN。优先复用现有 Checkout，必要时直接调用 `multica repo checkout`，校验平台 isolated/Task/Workspace 身份、Origin/Push URL 与 `analysis.source.commit` 的可达性；本地归档分支按 Task 和来源分支隔离。Fetch、普通 Push（`HEAD:refs/heads/<analysis.source.branch>`）及 Readback 均指向 `analysis.source.branch`。不使用 Owner Marker、Cleanup Token 或 `root-cleanup`；平台 Worktree 由 Multica 管理。

## 5. PR

### 5.1 `rondo pr`

```bash
rondo pr prepare [--issue <key-or-id>] --repo <完整仓库名称> --root-repo <path> --candidate-commit <sha> --facts <json|-> --title <title> [--validation-cwd <path>] [--required-repos <repo1,repo2>]
rondo pr materialize [--issue <key-or-id>]
rondo pr resume [--issue <key-or-id>] --comment-id <id> --next REWORK|RECREATE_PR
rondo pr reconcile-status [--issue <KEY> | --recover-done]
rondo pr create --repo <name|id> --source <branch> --target <branch> --title <title> [--description-file <path>] [--work-items <id,id>] [--project <project>]
rondo pr get --repo <name|id> --id <pr-id> [--project <project>]
rondo pr list --repo <name|id> [--status active|completed|abandoned] [--source-branch <branch>] [--top <n>] [--project <project>]
```

| 命令 | 功能 |
| --- | --- |
| `pr prepare` | 核对授权、Candidate 与专业 Facts，执行提供的验证命令并登记 PR Preparation；有命令时无需预填 `validation.result`，Bug 无命令时须提供真实替代验证 PASS |
| `pr materialize` | 核验适用 Gate，逐仓创建或恢复已有 Active / Completed PR、确认 Work Item 关联并在 pr 的对应仓库记录补充 pr_id / pr_url；全部登记后进入 in_review，in_review 仅核验已登记事实 |
| `pr resume` | 根据 Human Comment 核验 abandoned PR 并恢复 PR Facts；不修改 Issue 状态或启动 Run |
| `pr reconcile-status` | 从当前 Run Workspace 扫描 Issue 的 `pr` 已登记记录，核实 `completed` / `abandoned` 等外部状态，不使用 Registry |

`pr reconcile-status` 使用 `MULTICA_WORKSPACE_ID`、`MULTICA_SERVER_URL`（可选 `MULTICA_CLI_PATH`，默认 `multica`）；手动执行需具有相同环境及 CLI 认证。
| `pr create` | 在 TFS Git 仓库创建 PR，支持已有 PR 的幂等识别 |
| `pr get` | 根据仓库和 PR ID 查询 TFS PR |
| `pr list` | 按仓库、状态、源分支等条件查询 TFS PR 列表 |

## 6. 工作项

### 6.1 `rondo workitem`：同步、准入与收口

```bash
rondo workitem sync-issue --wiql "<WIQL>" [--initial-status backlog|todo]
rondo workitem apply-decision [--issue <key-or-id>] --decision <accepted|needs_human|unsupported>
rondo workitem approve [--issue <key-or-id>] --comment-id <ID> --commit <SHA> --verify-required true|false [--waive-tasks 3.1,3.2]
rondo workitem finalize --phase prepare|complete --issue <KEY> [--root-repo <path>]
rondo workitem writeback --issue <KEY> [--root-repo <path>] [--inspect | --task-plan <plan.json>]
```

| 命令 | 功能 |
| --- | --- |
| `workitem sync-issue` | 依据 WIQL 查询 TFS Work Item，并创建或更新对应 Multica Issue 及其来源内容 |
| `workitem apply-decision` | 执行 Wayfinder 已记录的 Decision：通过时按 `tfs.type` 交接并回读原生 Run，其他结果保留 Wayfinder 并设置对应状态 |
| `workitem approve` | 根据真实 Human 评论、获批 Commit 和明确的独立验收决定登记 Human Approval；按需记录完整任务豁免集合，并回读后将审核中的 Requirement 转入 `in_progress`，不启动 Run |
| `workitem finalize` | `prepare` 核验交付并准备收口；`complete` 在外部回写完成后核验并结束交付 |
| `workitem writeback` | 按交付事实回写 TFS 工作项、任务状态、工时及关联信息 |

`workitem sync-issue` 使用当前 Multica Runtime 与 `RONDO_PROJECT_TITLE`，每轮按 Title 唯一解析目标 Project；默认新建 Issue 停放 `backlog`，显式 `todo` 在初始化完成后激活。每轮最多处理 50 项。

`workitem approve` 使用当前 Multica Runtime，要求 Gate 已通过，并核对真实成员批准评论、获批 Commit 及明确的独立验收决定；`--waive-tasks` 记录 Human 明确批准的完整任务豁免集合，并按固定批准版 Tasks 核验编号。同一评论可幂等重试，不允许改写已登记决定。成功回读后将审核中的 Issue 转入 `in_progress`，不发 Mention、不启动 Run，也不要求 Registry、Agent 或 Run 身份参数。

`workitem apply-decision` 的映射规则：

| `tfs.type` | 交接目标 |
| --- | --- |
| `Bug` | `Bug Fix Agent` |
| `Requirement`、`需求` | `Delivery Squad` |

`accepted` 执行一次 `status=todo + assignee` 更新，通过 Multica 原生机制启动对应 Run。它不重新判断 Wayfinder 的 `accepted` 结论，也不解析 `/note` 或 Evidence。若无法确认结果则返回 `UNKNOWN`，不盲目重复交接。

`workitem apply-decision` 接受 `--decision` 和可选 `--issue`。`needs_human` / `unsupported` 保留 Wayfinder Assignee，分别设置 `blocked` / `unsupported`，不启动新 Run。Workspace 与服务端从 `MULTICA_WORKSPACE_ID`、`MULTICA_SERVER_URL` 读取；CLI 路径可选 `MULTICA_CLI_PATH`（默认 `multica`），并校验 `MULTICA_AGENT_ID` 必须是当前 Workspace 的 Wayfinder Agent。缺失或身份不符返回 `UNKNOWN`，不使用默认 Workspace。交接目标始终从当前 Workspace 查询。完整说明见 `rondo workitem apply-decision --help`。

交付收口的常用调用顺序：

```bash
rondo repo prepare-archive --issue <KEY>
rondo workitem finalize --phase prepare --issue <KEY> --root-repo <path>
rondo workitem writeback --issue <KEY> --root-repo <path> --inspect
rondo workitem writeback --issue <KEY> --root-repo <path> --task-plan <plan.json>
rondo workitem finalize --phase complete --issue <KEY> --root-repo <path>
```

已有任务计划时省略 `--task-plan`。Direct Bug 不执行 prepare-archive / inspect，不传 root-repo 或 task-plan，仅执行 prepare、writeback、complete。收口命令使用当前 Multica Runtime，无 Registry 配置。

### 6.2 `rondo workitem`：基础查询与操作

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
rondo workspace sync-skills --workspace <name> [--skill <skill>] [--profile <name>] [--dry-run] [--check]
```

| 命令 | 功能 |
| --- | --- |
| `workspace provision` | 根据 Workspace 配置创建或核对 Agent、Skill、Squad、Project 和工作流对象，并记录对象 ID |
| `workspace sync-skills` | 将本地受管 Skill 内容同步到 Multica Workspace |

`workspace provision` 的 `--dry-run` 只预览；`workspace sync-skills --dry-run` 只预览，`--check` 用于检测同步差异。工作区配置按 `--workspace` 指向对应 Overlay。研发工作区统一按 Project Resource 和实际 Checkout 准备；Provision 不注入 `RONDO_WORKSPACE_BRANCH`，仅为 TFS Sync Agent 按分组补齐缺失的 `RONDO_PROJECT_TITLE`，已有值及其他环境变量保留。

受管 Skill 或 Agent 绑定发生变化时，先执行 `rondo workspace provision --workspace <name>` 更新绑定和 Overlay，再执行 `rondo workspace sync-skills --workspace <name>` 同步内容。此次 `workitem-triage` 退役后，核对 Wayfinder 仅绑定 `codebase-explorer`、Overlay 不再登记旧 Skill；不自动删除其他未受管平台 Skill。

Workitem Analyst、Engineer 和 Bug Fix Agent 绑定 `native-workspace`，直接使用 Multica Native Checkout。执行 provision 前核实 CLI、实际 TFS 根仓映射及批准版本；供给并同步 Skill 后验证实际交付。

### 7.2 `rondo runtime`

```bash
rondo runtime get-context
rondo runtime check-checkout --root-repo <path>
rondo runtime check-daemon --workspace-id <id>
rondo runtime reconcile [--dry-run]
```

`runtime check-daemon` 检查 `MULTICA_DAEMON_ID` 是否配置、该 Daemon 是否登记在指定 Workspace 的 Runtime 中，并输出当前 Rondo 版本。它不检查 Project Resource、Agent 亲和或 Workspace 挂载；不接受无关的 `--project-id`。

`runtime get-context` 只读获取当前 Multica Agent Run 的 Runtime 信息（`multica_cli`、`multica_server_url`、`workspace_id`、`rondo`、`delivery_squad_id`）。Workspace 和 Server 来自当前 Run 环境变量；按名称 `Delivery Squad` 在当前 Workspace 查找唯一有效 Squad。缺少环境或无法确认目标时返回 `UNKNOWN`（exit 3）；不依赖 `repo-registry.json`，不支持从外部终端猜测默认 Workspace。

`runtime check-checkout` 只读检查调用者指定的根仓，返回规范根仓路径，核对 `AGENTS.md` 和适用的 Native Task Checkout 身份。不执行检出或分支切换。

`runtime reconcile` 从当前 Workspace 与 `RONDO_RUNTIME_POLICY`（Agent Name → `primary_runtime_id` / `fallback_runtime_id` 的 JSON Object）读取策略，依据 Multica 原生 Runtime `online` / `offline` 状态协调 Agent 绑定。仅在目标不同时改绑，不校验主备及当前绑定的 Provider 是否一致（跨 Provider 可能触发平台清空不兼容的模型配置，由管理员在策略侧评估），不管理 Run，不改绑 Vayne 自身。`--dry-run` 只返回计划。无策略、异常及未确认写入分别按现有退出码契约报告。启用前须通过[黑灯计划](../02-multica-delivery-lifecycle-design.md#runtime-reconcile)的现网原生能力验收。

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
| 配置 | `openspec_root`、`tfs_config`、`daemon_env` |
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

