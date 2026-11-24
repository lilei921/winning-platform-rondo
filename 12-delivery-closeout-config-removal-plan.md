# 12 Delivery Closeout 无配置化优化方案

- 状态：待实施（设计 Review 后修订）
- 日期：2026-11-24
- 范围：`skills/delivery-closeout`、Rondo Closeout CLI 及直接相关的事实生产与 Workspace 发布
- 上位规范：[01 统一设计规范](01-multica-openspec-design-guideline.md)

## 1. 目标与裁决

Delivery Closeout 面向已经登记 PR 的 Issue，完成 Prepare、TFS Writeback 与 Complete。收口不是工程准备，不需要维护全量业务仓库目录或重新选择目标分支。

取消 `skills/delivery-closeout/config/repo-registry.json` 和 Closeout 两个命令的 `--config` 参数。Rondo 从当前 Multica Run、Issue Metadata、已核验的根仓和 TFS 实时事实取得必要输入。

**仅支持当前 Change-level Requirement 和 Direct Bug。项目尚处研发阶段，无正式业务存量需要迁移；不保留旧 `dev.dispatch` Requirement 的 Closeout 路径，不提供旧配置兼容、回退或迁移机制。** 不以此为由删除其他命令或 Skill 独立消费的共享能力。

不改变收口阶段边界、PR 完成核验、Archive/Push/Readback、TFS Task/Commit 独占关联、工时、幂等恢复及 Done 后置条件。收敛重复的上游工程质量检查，只保留收口必要事实与 Hard Gate。

## 2. 当前源码证据

基于仓库 main 的现行源码（Rondo package.json 为 1.2.37 时核查）：

- [delivery-closeout/SKILL.md](skills/delivery-closeout/SKILL.md) 要求每次 finalize 和 writeback 传入挂载 JSON。
- [repo-registry.json](skills/delivery-closeout/config/repo-registry.json) 含 runtime 及 25 个业务仓映射，与 change-development、workspace-preparation 的生成文件内容相同（Blob `9b0815ad0cdf5e3f911ac4fd256d8c28e9c0ed07`）。这些文件是 Workspace 配置渲染投影，不是三套独立的权威 Registry。
- [runtime-context.ts](rondo/src/clients/runtime-context.ts) 的 `resolveMulticaRuntime()` 已读取当前 Workspace、Server 和 CLI 路径；[reconcile-status.ts](rondo/src/commands/pr/reconcile-status.ts) 已不使用 Registry，并调用 `parseTfsPrWebUrl()` 解析 current_pr 后实时核验。
- [finalize.ts](rondo/src/commands/delivery/finalize.ts) 使用 loadConfig、requireRepo、prTransitionGate、deliveryCompletionGate；旧路径还执行 reconcileWorkspace、旧 Evidence 检查及远端工件兼容路径。
- [writeback.ts](rondo/src/commands/tfs/writeback.ts) 与 [requirement-commits.ts](rondo/src/commands/tfs/requirement-commits.ts) 使用 Registry 解析仓库、确认 PR 真实业务 Commit；旧 dispatch 使用本地 repo_path 反解任务 Commit。
- [change-completion.ts](rondo/src/commands/dev/change-completion.ts) 的 validateChangeDelivery 依赖 registry 中的 repo_url 和 default_target_branch。新路线首次 Prepare 的实际代码仍调用 deliveryCompletionGate；不要把文档描述的 Gate 简化误认为所有实际检查已删除。
- [workspace/sync.ts](rondo/src/commands/workspace/sync.ts) 的 REPO_REGISTRY_SKILLS 包含 delivery-closeout，单删文件会被重新生成。现有 sync 支持删除远端多余 Skill 文件。
- [dev/pr-prep.ts](rondo/src/commands/dev/pr-prep.ts)、[bug/prepare-pr.ts](rondo/src/commands/bug/prepare-pr.ts) 当前 pr_prep 没有业务 repo_url，Requirement target_branch 还可能省略；[pr/materialize.ts](rondo/src/commands/pr/materialize.ts) 通过上游 Registry 选择仓库和目标分支，并登记经过规范化的 current_pr URL。

## 3. 事实来源与职责

| 信息 | 权威来源或取得方式 |
| --- | --- |
| Multica Workspace / Server / CLI | resolveMulticaRuntime()；缺失 Workspace 或 Server 返回 UNKNOWN，不回退默认 Workspace |
| TFS 服务与凭证 | 现有 TFS Client 环境配置（保留既有机制）；不放入 Skill |
| TFS Work Item | Issue tfs.id / tfs.type 与 TFS 回读 |
| OpenSpec 根仓和发布分支 | analysis.source.repo_url / branch / commit / change_ref，配合当前 Task 原生 Checkout 与 Git 核验 |
| 业务 PR | current_pr 中 repo_key / pr_id / pr_url / source_branch / target_branch |
| 预期业务仓与分支 | 已核验的 pr_prep 仓库身份、实际目标分支；Requirement 结合 analysis.source.commit 固定的 Repository Scope |
| PR 外部事实 | TFS PR API；按配置 Collection、Project、Repository、PR ID 查询，核对分支及 completed |
| 真实仓库与 Commit | TFS 实时确认 Project GUID + Repository GUID；Requirement 按已核验 PR ID 读取真实业务 Commit，关联身份为 Project GUID + Repository GUID + 完整 SHA |
| 任务计划与完成 | 已批准 tasks.md、delivery.tfs_task_plan、TFS 子任务及工时/关联的实际回读 |

runtime.rondo 不消费；repo_path 在当前新收口中不需要；tfs_repo/tfs_project 不再静态复制；default_target_branch 是上游 PR 准备的策略，不是 Closeout 的实时策略。不得把 analysis.source.repo_url 当作业务仓 URL。

Agent 只负责协调同组根仓复用、语义规划 TFS 子任务与异常调查。Skill 只提供最小执行方法。CLI 承担运行身份解析、事实核验、副作用及幂等。

## 4. 实施方案

### 4.1 Runtime

finalize / writeback 复用 resolveMulticaRuntime() 和现有 MulticaClient、TFS Client；不使用 resolveRuntimeContext() 的 Squad 查询。删除这两个命令对静态 config 的要求；旧参数应返回用法错误，而非静默忽略。done 残留 pending 恢复只读取需要的事实，不依赖业务仓配置或根仓；保持已有最小回核。

### 4.2 PR 与仓库身份

复用 parseTfsPrWebUrl()、canonicalRepositoryIdentity()、assertTfsRepository()、verifiedRepo() 等现有能力。按 current_pr 逐项解析并核验，无需枚举 25 个仓库。

**不可用同一条 current_pr URL 同时充当预期仓库和实际仓库的独立证明。** 最小必要的事实补齐：由现有 PR Preparation CLI 将已核验的无凭据业务 repo_url 和实际 target_branch 写入已有 pr_prep 条目并回读；Requirement 与 Direct Bug 均适用，不新增 Metadata Key。目标分支由 PR Preparation CLI 按 Requirement / Direct Bug 各自现行策略确定并写入，不新增 Agent 输入。PR Materialize 在创建或复用 PR 前使用现有 Registry 核验已固定的仓库身份和目标分支，一致才继续；登记 current_pr 时沿用现有 URL 规范化及回读机制。不要把工作区路径、全量 Registry 或凭据写入 Metadata。

Closeout：
1. 校验 current_pr、pr_prep 唯一 repo_key、必要字段及本次 PR 仓集合一致。Requirement 从当前已核验根仓通过 `git show <analysis.source.commit>:openspec/changes/<change_ref>/.openspec.yaml` 读取批准版 Repository Scope，复用 parseRepositoryScope()；不以当前归档目录中的 Scope 替代批准范围。实际交付仓集合可以是批准范围的子集。
2. 将 PR URL 限定到配置 TFS Collection，解析 Project、Repository、PR ID，并与 pr_prep.repo_url 的规范化仓库身份、source_branch、target_branch 比对。调用 TFS API 确认真实仓库、PR 身份、分支与状态。不能仅比较仓名或 SHA，不能信任任意 URL 并向其发送凭证。
3. 使用 verifiedRepo() 返回的 Project GUID + Repository GUID 按真实仓库身份判重。现行一仓一 PR 模型下，不允许不同 repo_key 指向同一真实仓库；GUID 仅在运行时使用，不新增 Metadata 字段。不同 Project 下同名仓库可独立交付。
4. Requirement 的业务 Commit 直接按已核验的仓库及 PR ID 查询，保持 prChangedCommits(api, repo, prId) 的现有用法，不额外核验 Candidate 是否属于 PR Commit 列表或等于合并源 Commit；Candidate 的研发验证仍由上游负责。Direct Bug 保留既有 Candidate/实际合并源 Commit 核验，不扩展至 Requirement。
5. inspectRequirementCommits 消费已核验的本次 PR 仓身份，读取实际 PR Commit 与占用事实。TFS 链接和反向验证仍以 Project GUID + Repository GUID + 完整 SHA 为真实身份；任务计划仍使用 repo_key + SHA。
6. 优先复用现有小型函数，必要时共享一个 Closeout 专用 PR 身份核验函数。各命令根据实际需要查询外部事实，同一命令内复用结果；不新增跨 Run 缓存、通用 Registry Resolver、服务或从 Issue 反推的动态 Registry。工程侧 validateChangeDelivery 及其授权规则保持原位，不为 Closeout 重构上游 Gate。

研发阶段原有测试 Issue 如缺新的 pr_prep 仓库身份，按新流程重新准备验证，不引入历史兼容、回填脚本或推断性认领。所有身份缺失、冲突、不可见或回读异常必须阻断相关外部写入。

### 4.3 Requirement 与 Bug 收口

- Requirement：保留当前 Task 的 Multica Native Checkout；同组按 analysis.source.repo_url + branch 复用根仓；--root-repo 必填。Archive、普通 Push、远端回读以 analysis.source.branch 为准；不得操作平台 Worktree 生命周期。
- Bug：保留 Direct Bug Prepare/Complete 及 bug.delivery、pending digest、真实合并 Candidate 核验；不需要根仓、不归档、不创建子任务。
- Writeback：保留 Inspect 读取批准 Commit 版本 tasks.md、真实 PR Commit 和已保存计划；新计划 1–5 个 Task，每项 0.5–4h，独占真实业务 Commit；保存计划及恢复、父子项身份、工时、双向关联、父项评论、delivery.tfs_written 等原有逻辑不变。
- Complete：保留 PR 状态、Prepare 标记、远端 Archive、TFS 真实完成回读、Summary、Issue done 和 pending 清理。done 残留恢复无需根仓，不重复外部写入。
- Requirement 首次 Prepare 不再调用完整的 deliveryCompletionGate() / validateChangeDelivery() 来重复审核上游工程质量；只保留必要的既有授权、Hard Gate 与归档前提：当前交付模式及 Change 身份、已批准来源、必要审批/Analysis PASS 事实、Independent Verification 的现行阻断规则、Issue blocked 阻断、批准 Repository Scope、有效 PR 事实及归档所需 tasks.md 完成状态。不得重新执行 Analysis、Local Validation、Code Review，或重复校验 PR Description、Review Findings、验证命令和 Candidate 工程证据。上游质量规则不变；不将已通过的质量检查重建为 Closeout Gate。
- Writeback 沿用现有 Prepare 标记、远端 Archive 回读、Issue 写入前一致性检查及任务关联验证。本次不新增 pr_prep 写入前二次比较、不额外扩展 pending 事件核验到 Writeback、不新增 Requirement Digest、Snapshot、Version Token 或锁；保留现有 Direct Bug digest 与各阶段原有必要恢复检查。

### 4.4 直接删除旧 Closeout 路线

只在 finalize/writeback 及其 Closeout 专用实现范围内删除：
- 旧 dev.dispatch Task Set Requirement 分支、旧 dispatch 任务物化/解决与旧 Evidence repo_path 反解；
- 旧 Closeout 枢纽仓对账、业务 worktree 回收、源分支清理；
- 旧 runtime.root_branch 远端工件兼容分支及仅供其使用的临时归档 clone；
- 两个命令的 loadConfig、--config、Registry 专属入参及相关旧测试。

审查函数调用方后才删除不再使用的 helper/import；仍被其他命令使用的 remote-artifacts、Evidence、materialize-tasks、resolve-tasks 等共享实现不做全局清理。旧或不完整 Requirement 不得误判为 Bug，也不得回退旧路线。保留明确 FAIL/UNKNOWN 语义。

### 4.5 目标命令

Requirement：

```bash
rondo delivery root-prepare --issue <KEY>
rondo delivery finalize --phase prepare --issue <KEY> --root-repo "<root_repo>"
rondo tfs writeback --issue <KEY> --root-repo "<root_repo>" --inspect
rondo tfs writeback --issue <KEY> --root-repo "<root_repo>" --task-plan "<plan.json>"
rondo tfs writeback --issue <KEY> --root-repo "<root_repo>"
rondo delivery finalize --phase complete --issue <KEY> --root-repo "<root_repo>"
```

最后一个无 task-plan 的 writeback 用于已有计划恢复，不要求首次写入后再执行一遍。Bug 只执行不带 root-repo 的 prepare、writeback、complete。done 残留 pending 只执行无 root-repo 的 complete。

plan.json 是 Agent 的一次性任务规划业务输入，不是配置文件，保留其现有格式和校验。

### 4.6 PR Preparation 命名统一

仅统一两个既有 PR Preparation 命令的命名：

| 当前命令 | 目标命令 |
| --- | --- |
| `rondo dev pr-prep` | `rondo dev pr-prepare` |
| `rondo bug prepare-pr` | `rondo bug pr-prepare` |
| `rondo pr materialize` | 保持不变 |

两个 Preparation 命令分别保留在 dev / bug 命令组，沿用各自专业实现及既有输入、输出契约（§4.2 必要的事实补齐除外）。不合并实现、不保留旧命令 Alias、不修改 `pr_prep` / `current_pr` Metadata Key。同步更新 CLI 注册、Help、Usage、现行 Skill/Agent 命令引用、文档及测试；源码文件及注册函数按新名称统一，仅修改直接相关引用。`pr materialize`、底层 `pr create/get/list` 和其他 PR 命令名称保持不变。现有 Metadata 中的验证来源标识若引用命令名，生产方与校验方须同步更新，避免破坏既有 Gate。

## 5. 文件与发布范围

| 资产 | 变更 |
| --- | --- |
| skills/delivery-closeout/SKILL.md | 删除 config-path 约定及所有 --config 参数，其余方法与职责保留 |
| skills/delivery-closeout/config/repo-registry.json | 删除 |
| rondo/src/commands/workspace/sync.ts | 从 REPO_REGISTRY_SKILLS 移除 delivery-closeout；复用现有远端文件删除机制，不新增专属清理 |
| rondo/src/commands/delivery/finalize.ts | Runtime、PR 核验、精简 Requirement 首次 Prepare Gate、删除旧 Closeout 分支 |
| rondo/src/commands/tfs/writeback.ts | Runtime、真实业务事实、删除旧 dispatch Writeback 分支 |
| rondo/src/commands/tfs/requirement-commits.ts | 使用核验后的 PR 仓身份 |
| rondo/src/commands/delivery/requirement-mode.ts | 现行 Requirement 判定及批准版 Repository Scope 核验；删除仅供 Closeout 重复上游质量检查的代码 |
| rondo/src/commands/dev/pr-prep.ts、bug/prepare-pr.ts、pr/materialize.ts | 必要的预期仓库、实际分支事实固定和交叉校验；前两个命令及文件统一为 pr-prepare，pr materialize 保持名称不变 |
| rondo/src/index.ts、相关 Skill / Agent 调用及测试 | 仅同步 PR Preparation 新命令名和直接相关引用 |
| 共享 helper 与测试 | 只修改直接相关调用点，删除确无调用的旧 Closeout 实现与测试 |
| rondo/COMMANDS.md、README.md | 更新现行命令及无配置调用例外；不维护历史过程 |
| 02 / 10 等现行设计文档 | 仅同步受影响的收口契约、CLI 示例和旧 dispatch 兼容表述；不重写其他阶段 |

保留其他 Skill 的 Registry、Workspace base/overlay、Agent Instructions（仅同步必要命令引用）、Autopilot Prompt、provisioning 绑定、OpenSpec Schema/Template 和 task-plan JSON。不新增 Agent、Skill、CLI 能力或平台对象。

发布顺序：先构建/测试，将同一新版 Rondo CLI 部署到所有受影响的 Runtime（Engineer、Bug Fix Agent、PR Materialize 执行方、PR Status Sync Agent，以及执行 Workspace Sync 的环境）；再同步 delivery-closeout、change-development、bug-delivery 等实际受影响的 Skill 及必要的 Agent 命令引用。使用已更新的仓库工作副本，确认本地旧 JSON 不存在，并回读远端文件已删除。用新建测试 Issue 完整验证两类交付，避免旧 CLI 生成不完整 pr_prep 或与新 Skill 命令错配。不引入滚动兼容机制、Feature Flag 或迁移工具；真实 Workspace 发布单独执行和核验。

## 6. 验收

- Requirement 多仓完整收口与跨 TFS Project PR/Commit 解析；根仓正确归档到 analysis.source.branch，不切换为业务 PR target_branch。
- Bug 完整收口，不要求根仓或任务计划，Candidate 与真实合并源核验保持。
- Prepare 已归档重跑、任务计划恢复、子任务/Commit 关联部分成功恢复、Complete 重跑、done pending 清理；不重复归档或产生重复 TFS 副作用。
- 缺少 Runtime、错误 Collection、PR ID/分支/仓库冲突、repo_key 重复、不同 repo_key 指向相同 Project GUID + Repository GUID、repo_key 不在批准 Commit 的 Repository Scope、pr_prep 必要身份缺失/冲突、真实 Commit 不可确认时拒绝推进；不同 Project 下同名仓库正确区分。
- Requirement 按已核验 PR ID 读取真实业务 Commit，不增加 Candidate 归属校验；首次 Prepare 不重复上游专业质量 Gate，仍保留必要授权、阻断和归档完成条件。Writeback 不增加既有一致性检查的字段或新状态机制。
- 已有计划与新计划冲突、Commit 已被其他 TFS Task 占用、反向回读异常及工时越界仍阻断。
- 旧 dev.dispatch Requirement 明确不支持；不允许隐式回退或误归类为 Direct Bug。旧 --config 返回用法错误。
- workspace sync --local-only / --check 不再渲染 delivery-closeout Registry；真实 sync 后回读远端不存在该文件，其他 Skill 配置与绑定不受影响。
- 两个 pr-prepare 新命令可用，旧名称不再注册；现行 Skill 引用与 CLI 一致，pr materialize 和底层 TFS PR 命令名称与原契约保持不变（§4.2 必要身份核验除外）。
- TypeScript build、相关单元/集成测试与其他共享命令回归通过；最终在真实 Multica/TFS 环境分别验证 Requirement 和 Bug。未实际执行不视为通过。

## 7. 设计原则复核

- KISS：只保留 issue、root-repo、phase/inspect/task-plan 等本次必要输入。
- YAGNI：没有正式存量，不维护旧 Closeout 路径、不做迁移框架、配置兼容或 Registry 服务；不新增 Requirement Candidate/PR Commit 归属校验、不扩展 Writeback 一致性检查或持久化状态。
- Native First：复用 Multica Runtime、原生 Checkout、已有 Issue Metadata 及 TFS API。
- One Rule One Owner：上游固定交付身份和目标分支，CLI 核验外部事实，Agent 做语义规划，Skill 不维护环境与仓库目录。
- Specialist Focus：仅处理 Closeout 无配置化、直接相关的身份事实和重复 Gate 收敛；其他 Registry 使用和上游工程规则不扩散。

结论：静态 Registry 从 Delivery Closeout 完全退出，当前 Requirement 与 Direct Bug 的收口能力、真实事实验证及幂等安全保持不变。
