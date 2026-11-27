# 14 — Pull Request 共用 Skill 与公共执行契约收敛方案

- 日期：2026-11-24
- 状态：设计方案修订，待实施；本次仅更新方案
- 源码基线：[main @ 6cd81c0](https://github.com/lilei921/winning-platform-rondo/tree/6cd81c0953cf0941c6fe35a21986e19527f72f72)
- 设计依据：[01 设计原则](01-multica-openspec-design-guideline.md)、[Native Workspace 设计](12-native-repo-workspace-preparation-design.md)
- 决策：系统尚未上线，按 Greenfield First 直接建设目标态，不为本次被替换的历史命令、分支、输入格式或工作区路径设计兼容、迁移或双轨机制。

## 1. 目标与边界

将 bug-delivery 与 change-development 收敛为 pull-request Skill，同时退役两份 Registry，统一真正公共的 PR 执行契约。

Bug 与 Requirement 的本质区别是修改目标、工程授权及专业验收；不是 Git Push、Candidate 核验、PR Preparation 或 PR 创建方式。只收敛后者，不合并 Agent、不统一专业工程过程、不增加通用工作流。

目标：已完成实现和必要验证的授权代码变更 → 可信 Candidate → PR Preparation → PR 创建或复用 → Issue in_review。

保留当前 Bug / Requirement 的授权、工程质量、Completion、PR 提交条件、现有 Independent Verification 执行边界、TFS Writeback 和 Closeout 业务语义。Bug 不再写入或依赖 analysis.change_kind=corrective：tfs.type=Bug 已表达业务类型，不新增替代分类字段。已有有效能力优先复用，不因统一入口而降低校验强度。

## 2. 当前实现与真实差异

以下结论基于固定源码基线，核对了 [Bug Skill](skills/bug-delivery/SKILL.md)、[Requirement Skill](skills/change-development/SKILL.md)、[Native Workspace](skills/native-workspace/SKILL.md)、[Bug 授权](rondo/src/commands/bug/authorization.ts)、[Requirement 授权](rondo/src/commands/dev/requirement-guard.ts)、[Native Prepare](rondo/src/commands/dev/prepare.ts)、[Bug Git](rondo/src/commands/bug/git.ts)、[Bug PR Prepare](rondo/src/commands/bug/pr-prepare.ts)、[Requirement PR Prepare](rondo/src/commands/dev/pr-prepare.ts)、[Bug Scope](rondo/src/commands/bug/scope.ts)、[Requirement Completion](rondo/src/commands/dev/change-completion.ts)、[Materialize](rondo/src/commands/pr/materialize.ts)、[PR Resume](rondo/src/commands/pr/resume.ts)、[PR Status Sync](rondo/src/commands/pr/reconcile-status.ts) 和 [Worktree](rondo/src/commands/dev/requirement-worktree.ts)。

| 比较项 | Bug 当前实现 | Requirement 当前实现 | 对齐可能性 / 必要性 | 裁决 |
| --- | --- | --- | --- | --- |
| 授权依据 | 活跃 Task、直接指派、TFS 来源、状态与 Bug Scope | 活跃 Engineer Run、Human Approval、Analysis Gate、固定 Change 与 Scope | 部分 / 高 | 复用公共 Run 身份检查；保留各自专业授权 |
| 工程工作 | 根因诊断、修复、必要回归，无 OpenSpec | 获批契约、实现、验收及 Tasks 更新 | 低 / 无 | 保持 Agent 专业分工 |
| 公共质量要求 | Evidence PASS、Code Review、Findings 可省略、空 blockers | 实际 Validation、Code Review、Findings 必须为数组、空 blockers | 高 / 高 | 统一共同校验规则，findings 无内容时默认为空数组 |
| Candidate | 远端 SHA、本地 Candidate、Native HEAD、唯一 Refs 尾注 | 远端 SHA、本地 HEAD、实际 Validation 前后检查 | 高 / 高 | 统一 Candidate / 工作树绑定；保留 Bug Refs 尾注及 Requirement TFS 子任务 Commit 归属 |
| Git Fetch / Push | rondo bug git 受控网络操作 | Git 命令由 Agent 执行，提示词要求回读远端 | 高 / 高 | 统一 rondo dev git，复用现有受控实现 |
| Candidate Branch | feat/<tfs.id> | feature/<tfs.id> | 高 / 高 | 统一 feature/<tfs.id>，不保留旧分支规则 |
| PR Preparation | rondo bug pr-prepare | rondo dev pr-prepare --mode requirement | 高 / 高 | 统一 rondo pr prepare，内部按 Issue 类型检查 |
| 输入 JSON | Evidence，含根因、修复、回归、local_validation、review | Delivery Facts，含 validation.command、review、description | 高 / 高 | 统一公共 Facts，Bug 补充专业事实 |
| 验证机制 | CLI 验证结论结构与引用字段，不执行实际测试 | CLI 在实际 Candidate Checkout 执行 validation.command 并核验退出码 | 高 / 高 | 复用真实执行能力；Bug 允许可信替代证据，不虚报机器验证 |
| 多仓交付 | required_repos = pr_prep = bug.delivery 的仓库集合 | 实际 PR 仓库属于批准 Scope，Tasks / Completion 检查工程完成 | 部分 / 高 | 统一完整交付原则；保留必交仓集合与允许修改范围的不同语义 |
| PR 创建 | pr materialize，Bug Gate，外部 active PR 复用 | pr materialize --mode requirement，Completion Gate，优先核对 pr | 高 / 高 | 统一入口、PR 身份、回读及幂等创建；保留适用 Gate |
| PR Description | CLI 默认格式化 bug.delivery，支持本地 description_ref | Engineer 编写，pr_prep.description 持久化 | 高 / 高 | 统一 Agent 编写，保存正文并原样提交 |
| 交付事实存储 | bug.required_repos、bug.delivery、pr_prep，部分 Candidate 身份重复；额外写 corrective | OpenSpec、dev.publication、pr_prep | 部分 / 中 | 公共输入和逻辑统一；保留必要事实，不重复存储 Validation / Review，不迁移 bug.delivery；取消 Bug corrective 冗余分类 |
| Abandoned PR 恢复 | Bug 保留全组 abandoned 边界 | Requirement 仅恢复对应 abandoned 仓 | 共用 | 统一 PR Facts 恢复；原生协调状态和执行 |
| Worktree | Native Checkout | Native Checkout；materialize 仍有历史 Rondo 自建 Worktree 清理分支 | 高 / 高 | 统一 Native 所有权，删除本 PR 路径的旧清理逻辑 |

当前两个 Skill 内 repo-registry.json 的 Blob SHA 均为 `9b0815ad0cdf5e3f911ac4fd256d8c28e9c0ed07`，内容相同（Runtime + 25 个业务仓库映射）。Native prepare 已能直接读取权威根仓映射；继续生成和核对副本没有必要。

## 3. 职责与数据归属

- Bug Fix Agent：Expected / Actual Behavior、Root Cause、最小修复、回归、专业验证及审查。
- Engineer：读取固定获批 OpenSpec、实现、验证与审查、更新已验证 Tasks、准备当前 Change 的研发工件提交。退役 change-development 后，最小补充现有 Instructions / 命令入口中尚未覆盖的职责；不新增研发 Skill。
- pull-request：已完成实现的 Candidate 发布、PR Facts、必要提交前置操作、PR Preparation / Materialization 与结果处理。验证策略和 PR 文案的语义由当前专业 Agent 决定。
- native-workspace：按需准备当前 Task 的根仓和业务工作树；不承担 PR 创建。Multica 管理原生工作区的生命周期。
- Rondo CLI：当前 Runtime、授权、仓库 / Candidate 身份、确定性执行、事实写入、PR 创建或复用。Skill 不复制内部算法。
- OpenSpec 持有工程契约与 Tasks；Git 持有代码；Multica Issue 持有当前交付事实；TFS 持有 PR 与 Work Item 实际状态。

## 4. 目标 CLI

以下为实施后的目标用法，非当前 main 已支持的接口。

| 命令 | 职责 |
| --- | --- |
| rondo dev prepare --workspace native | 保持现有 Native 业务仓准备，统一 Candidate Branch |
| rondo dev git | 受控 Fetch / 非强制 Push，替代 bug git |
| rondo pr prepare | 统一 PR Preparation，替代 bug pr-prepare / dev pr-prepare |
| rondo dev publish | Requirement 工程工件发布，无 Registry |
| rondo dev check-change | 按需独立 Completion Check，无 Registry |
| rondo pr materialize | 统一 PR 创建或复用，内部执行适用 Gate |
| rondo pr resume | 统一 PR Facts 恢复，无 Registry |
| rondo openspec read | 从当前 Issue 读取获批工件，无 Registry |
| rondo change update-progress | 已无 Registry 依赖，保持不变 |

以 tfs.type 为唯一专业路径选择依据（Bug / 需求）；Requirement 使用当前 Issue 的 analysis.source.change_ref 及固定发布来源。分支和已登记交付事实用于校验而非推断业务类型。无需让 Agent 为公共 Git / PR 命令重复传 --mode、--change-ref、--config 或自行选择授权机制。未知类型、冲突事实不得进入默认旧路径。

三个被替换命令收敛为两个；不是新增并行 facade。同步调整所有有效调用方、测试、帮助及文档，不保留针对未上线历史接口的别名或参数兼容。明确属于其他功能的命令不借本次重构退役。

### 4.1 Candidate 与受控 Git

统一远端 Candidate Branch 为 `feature/<tfs.id>`；不再根据 Bug / Requirement 区分 feat / feature，不提供额外自定义候选分支或目标分支覆盖机制。以一个最小 Candidate Branch 函数统一应用于 Native prepare、Git Push、PR Preparation、Materialization、Gate、恢复与有关校验；不新增 Branch Policy。同步核查 requirement-mode 等下游消费者，保留各自必要工程契约与准备事实检查。旧 feat 分支及测试 Replay 不迁移、不作为运行回退；不删除远端历史分支。

PR Target Branch 来自指定版本 repo-context.yaml.default_target_branch。Multica Resource ref、本地 Task Branch、Candidate Branch、PR Target Branch 是不同事实；不能混用。

```bash
rondo dev git --operation fetch --issue <KEY> --repo <repo_id> --root-repo "<root>"
rondo dev git --operation push --issue <KEY> --repo <repo_id> --root-repo "<root>"
```

Fetch 按需使用，更新已核实的目标分支远端事实，不自动整合；Push 使用当前实际 Candidate HEAD 非强制发布到统一远端分支，回读远端完整 SHA。复用现有认证、服务边界、授权和工作树核验。网络结果未知先核实外部事实。普通 Git status/diff/add/commit 不封装。

### 4.2 PR Preparation

```bash
rondo pr prepare --issue <KEY> --repo <repo_id> \
  --root-repo "<root>" --candidate-commit <sha> \
  --facts "<temporary-json>" --title "<title>"
```

按需提供 --validation-cwd，缺省为实际授权业务仓；Bug 多仓首次提供 --required-repos <repo1,repo2>，单仓可省略。Requirement 不接受 --required-repos。--facts 支持 UTF-8 临时文件及现有非交互 stdin 读取方式，不依赖特定 Shell。

采用直接的 Bug / Requirement 分支及小型公共校验函数，不引入 Strategy / Provider / Adapter 注册机制。先核实当前 Runtime、专业授权、仓库映射、实际工作树、分支及完整 Candidate SHA，校验真实 Facts，执行适用 Validation；在写入前复核授权、本地及远端 Candidate 与本仓已有事实，保留他仓条目，写入后回读。远端 Candidate 或授权发生变化不得覆盖。Bug 保留原 ready_for_pr / required_repos 结果语义，只有全部必要仓准备完成才允许物化。保留 Bug Refs: #<tfs.id> 唯一尾注要求，不强制扩展到 Requirement Commit。

### 4.3 公共 Facts 与必要 Bug 专属事实

公共输入（示例仅说明格式，不是指定项目测试命令）：

```json
{
  "validation": {
    "result": "PASS",
    "command": ["npm", "test"],
    "summary": "实际验证范围、结果和必要局限"
  },
  "code_review": {
    "result": "PASS",
    "summary": "针对本次 Candidate 的专业审查结论",
    "findings": []
  },
  "blockers": [],
  "description": "专业 PR 描述：变更、验证、剩余风险"
}
```

Bug 在同一 JSON 中补充以下现有专业字段（不是另一份输入文件）：

```json
{
  "expected_behavior": "预期行为",
  "actual_behavior": "实际异常",
  "root_cause": {
    "confidence": "confirmed",
    "summary": "根因结论",
    "evidence_refs": ["真实证据引用"]
  },
  "fix_summary": "修复内容",
  "regression": {
    "result": "PASS",
    "summary": "实际回归或可信替代验证结论",
    "evidence_refs": ["真实证据引用"]
  }
}
```

Bug 还需在公共 validation / code_review 中提供 evidence_refs，以保留现有 Bug Finalization 可核查证据。root_cause 为 probable 时保留 remaining_risk，不能以仍可能推翻修复的关键假设放行。Requirement 工程事实由已批准 OpenSpec 持有，不重复构造 expected/actual/root_cause 等字段。

公共 Code Review：无 findings 时归一为空数组；未解决 Blocking Finding 不通过；未解决 Non-blocking Finding 必须 blocking:false 且有 risk_note 或 risk_ref；blockers 必须显式为空数组。共享现有校验，不要求 Agent 在 JSON 重复填写 Issue、repo 或 Candidate SHA。外层 --candidate-commit 必须是 Agent 实际完成审查的完整 SHA，CLI 将审查事实与其绑定，候选改变须重新核实审查，不得复用过时 PASS。

Validation 与 Evidence 真实、可核查，不保存完整日志或敏感信息。临时 Facts 不进入 Git、OpenSpec 或 Archive。

### 4.4 统一 Validation 能力

提取并复用现有 verifyAndExecuteValidation 的公共能力：验证工作目录归属于当前授权业务仓，实际 Origin、HEAD 与 Candidate 一致，检查已跟踪内容在验证前后无未提交变化，执行命令并检查退出码，结束后复核 Candidate。保留 Native Task 所有权和远端 SHA 核验。

- 公共输入 validation.result 必须为 PASS，且 summary 非空。若提供 command，必须是非空合法命令数组，由 CLI 实际执行并以退出码和 Candidate 核验作为机器结果；空数组、非法命令或执行失败不得自动降级为 Evidence-only PASS。
- Requirement：validation.command 必须提供，CLI 实际执行成功后才能记录 PASS；不放宽当前 Completion Gate。
- Bug：可执行的本地验证采用同一能力。不能安全重现原始故障时，允许真实、适用的替代验证；确无可执行本地验证命令时可省略 command，但必须提供 PASS 的真实专业结论、evidence_refs，summary 说明原因、范围、结果与局限。Evidence-only 不是机器执行结果；不能掩盖失败或以不足的证据放行。CLI 负责验证确定性结构与执行结果，Agent 对替代验证真实性和充分性负责。不新增验证模式字段、失败历史记录或验证策略配置。
- Agent 自主选择与风险相称的方法、范围及命令，不统一 npm/mvn 等工具，也不规定完整构建或固定测试套件。CLI 执行的 Candidate Validation 是确定性提交检查；Agent 不因提示词重复执行同一项检查，但专业调查、修复反馈、回归或其他必要验证仍按实际需要执行。

统一输入、校验及存储。Validation / Review 均保存在每仓 pr 记录。机器执行时记录实际 command、exit_code、Candidate、source=rondo pr prepare，Requirement Completion 对应更新；Bug Evidence-only 保留原 result / summary / evidence_refs，不伪造机器执行字段。无需新 Metadata Key 或额外 Evidence 报告。

### 4.5 Description 与 Metadata

两场景均由专业 Agent 编写 PR Description，CLI 仅检查必要完整性、保存pr.description 正文并原样提交，不固定 Markdown 模板，不持久化 description_ref 或本地描述文件。Bug 根因、修复、回归及风险等仍应反映在描述中。

保留现有必要顶层 Metadata Key，不新增 Key 或数据服务。事实归属：

| 事实 | Bug | Requirement |
| --- | --- | --- |
| Repository / Candidate / Branch、Title、Description | pr | pr |
| Validation / Code Review | pr.local_validation / code_review | pr.local_validation / code_review |
| Expected / Actual、Root Cause、Fix、Regression | pr | 不适用 |
| 必要交付仓集合 | bug.required_repos | 获批 Scope + 实际 pr |
| 工程发布 | 不适用 | dev.publication |

Bug 在同一 pr 记录中绑定 Candidate、Branch 与专业证据，不跨对象对账。Bug Finalization 需要 regression、local_validation、code_review 的真实 PASS、summary、evidence_refs，及完整行为、修复和根因事实；映射公共输入时不得遗漏。Bug 不再写入或回读确认 analysis.change_kind=corrective。同步删除 Bug 开工对 change_kind 的冲突检查、Bug Finalization 的 corrective 强制要求、bugDeliveryDigest 的 change_kind 成分；复用 tfs.type、无 OpenSpec Change 的事实、Scope、Candidate 与现有状态约束。保留其他实际授权及禁止混入 OpenSpec Analysis Gate 的检查。Digest 其余成员及 Closeout / TFS Writeback 的必要完整性检查不变。不清理其他场景的 change_kind 或 01 的 Technical Change Kind 术语，不增加历史 Metadata 迁移。

退役两个旧准备命令的输入格式、Bug 专用描述生成路径和 file: 引用；不新增历史格式转换器。

### 4.6 Requirement Publish / Completion

Engineer 使用 openspec read 读取固定批准版本，依据实际研发与验证结果直接更新 `tasks.md` 的完成状态，提交当前 Change 的研发工件；不重复手工 Push 根仓，不创建永久验证报告。

```bash
rondo openspec read --issue <KEY> --file proposal.md
rondo dev publish --issue <KEY> --root-repo "<root>"
```

dev publish 负责批准契约一致性及远端 Git 发布确认，登记绑定完整 Analysis Source 的 `dev.publication`；只有确属非实质性 Design 细化才使用 `--minor-design`。

pr materialize 内部执行 Completion Check，消费有效发布回执、固定研发版本 Tasks 与开发侧质量，不重复比较批准契约与研发契约。Independent Verification 决定及现有 Closeout 阻断仍按当前实际执行边界处理（assertRequirementPrepareGate / assertBugFinalizationFacts），不宣称已有完整 PR 前独立验证流程，也不在本次补建。

### 4.7 PR Materialization

```bash
rondo pr materialize --issue <KEY>
```

根据当前 Issue 类型执行适用提交条件，复用现有公共创建 / 复用逻辑。Bug 核对全部 required_repos 及 pr 的身份和证据；Requirement 重新检查获批 Scope、固定映射、Tasks、发布、Candidate 与真实验证及现有 Completion。Requirement 的 pr.repo_url 和目标分支须与批准映射一致。

状态与授权：todo / in_progress 的 PR 写入要求当前授权 Bug Fix Agent / Engineer 的有效 Run、TFS 身份和适用提交条件；复用现有身份检查与业务授权，不直接套用会阻断已有 PR 重入的开工检查。in_review 仅核实已完整登记的 PR 及 Work Item 关联，确认已提交结果，不创建或修补外部事实。blocked、done、canceled、未知状态及收口中（finalize.pending / delivery.tfs_written=true）不允许新 PR 写入；abandoned 后按 Human 决定恢复 PR Facts 和原生状态。写入前复核 Issue 状态、授权与准备事实，最终登记前复核未变化；不建锁或新状态机。

两场景统一核实已登记 pr 与外部 PR 身份、源目标分支、远端 Candidate。先核实全部待提交仓的 TFS Collection / Project / Repository 身份，拒绝不同 repo_key 指向同一真实仓库；不为此增加 Metadata。对已存在或创建返回 existing 的 PR，同样回读核对身份与适用状态，不直接信任返回结果。

PR 新建与复用都必须核实原 TFS Work Item 已存在准确的 PR ArtifactLink（Project GUID / Repository GUID / PR ID）。复用现有 Work Item 侧读回 / ArtifactLink 能力：已关联则复用，缺失且当前仍授权写入则补挂并回读，失败或未知不放行。修复当前 tfs/api/pr.ts 的 existing 路径直接返回、materializeOne 复用 PR 跳过关联的缺口；不新增独立命令、状态或重试框架。全部必要 PR 和 Work Item 关联确认后，登记 pr，回读并进入 in_review。错误或部分成功按实际外部事实安全重试，不盲目重复创建或覆盖。CLI 不替代 Human Review、Merge 或 Closeout。

不需要 --mode、--change-ref、--root-repo、--config。Materialization 不准备本地根仓、不负责 Native Worktree 清理；删除当前 PR 路径中 Rondo 自建 Worktree 的旧清理调用。不删除其他仍有独立用途的能力，不强制清理未发布成果。

### 4.8 多仓语义与恢复

Bug：首次准备固定实际必要交付仓集合，全部准备后提交；保留 bug.required_repos 与 pr 仓库集合完整性规则。Requirement：x-repositories 是允许修改范围，实际提交集合可以为非空子集；Tasks / Completion 核实工程目标，不为未实际修改的仓库创建空 PR，不新增 required_repos。

PR Status Sync 记录 abandoned 并停止于 blocked。按 Human 决定恢复当前 PR Facts：

```bash
rondo pr resume --issue <KEY> --comment-id <id> --next REWORK|RECREATE_PR
```

REWORK 使失效准备事实失效；RECREATE_PR 核实 Candidate 未变且复用有效 Evidence。Bug 保留全部当前 PR 已确认 abandoned 的边界，Requirement 保留其他有效仓及实际交付范围。仅更新 `pr`；Human Comment 与已有 Abandoned 事件提供授权依据，Issue 状态与 Agent 交接使用 Multica 原生能力。重复执行不得移除新 PR 或自动解除阻塞。

## 5. Registry 退役与权威来源

| 事实 | 来源 |
| --- | --- |
| Multica CLI、Server、Workspace | 现有 resolveMulticaRuntime()：MULTICA_CLI_PATH（默认 multica）、MULTICA_SERVER_URL、MULTICA_WORKSPACE_ID |
| Rondo CLI | 当前 CLI / PATH |
| Bug 仓库映射 | 已核验根仓 HEAD 中 docs/config/repo-context.yaml |
| Requirement 仓库映射 | analysis.source.commit 中 docs/config/repo-context.yaml |
| repo_key / repo_path / repo_url | repo_id / repo_path / repo_url |
| tfs_project / tfs_repo | 已核实映射与 Repository URL；TFS 实际身份按需核实 |
| PR Target Branch | default_target_branch |
| Requirement Scope | 固定版本 .openspec.yaml.x-repositories |
| PR Preparation | 已核实 pr；Bug 同时保留 bug.required_repos |
| PR 身份 / 状态 | pr / TFS API；Bug 恢复时 original_prs |

直接复用 [resolveMulticaRuntime](rondo/src/clients/runtime-context.ts)，不查询 Delivery Squad。Runtime 缺失或跨 Workspace / Actor / Issue 身份冲突不得回退静态配置。

复用 [readNativeRepoMapping](rondo/src/commands/dev/native-prepare.ts) 及 validatePrepareRepo、实际工作树校验。Bug 使用当前已核实 Project Resource 对应的 Task 根仓已提交 HEAD，Requirement 固定获批 Commit；禁止读取未提交 YAML 或回退其他版本。dev git / pr prepare 复用 Native prepare 已有根仓身份核验：当前 Task 所有权、Origin / Push URL；Requirement 根仓 URL 与 analysis.source.repo_url 一致且 HEAD 包含获批 Commit。保留业务仓身份、路径、TFS Collection、目标分支与授权核验；无需 assertNativeDeliveryMapping 比较 Registry 副本。

Requirement approvedChange / guardRepository 继续核对全部获批 repo_id 是否已登记；dev publish、dev check-change、pr materialize 使用获批版本映射。无本地根仓的 Completion / Materialization 复用 [RemoteArtifactReader](rondo/src/commands/delivery/remote-artifacts.ts).read(source.commit, "/docs/config/repo-context.yaml")；本地 Git 和远端读取共用最小 YAML 解析函数，分别保留已有身份 / 服务边界与固定版本核验。不新增 Repository Service、Provider、缓存或第二套配置。Bug Materialization 信任经授权 CLI 在 Preparation 核验后登记的 pr.repo_url，同一记录绑定 Candidate / Branch，由 TFS API 核实实际仓库和 Candidate；不重新 Checkout。该边界依赖现有 Issue Metadata 写入权限与可信 Runtime，不声称 TFS 可反向证明未保存的根仓映射或防御任意 Metadata 篡改。不增加仓库身份证明副本、签名或 Receipt。

Bug Resume 使用 pr / original_prs 的 PR URL、ID、分支和外部 abandoned 状态，pr 准备记录仍存在时核实其仓库身份，不将已清空的事实设为必然前提。复用已有 [PR Status Sync](rondo/src/commands/pr/reconcile-status.ts) / [Closeout PR](rondo/src/commands/delivery/closeout-pr.ts) 的身份解析及核验能力，不复用 completed 状态要求。

openspec read 直接使用 Runtime + analysis.source；change update-progress 已无 Registry 依赖。

[workspace/sync.ts](rondo/src/commands/workspace/sync.ts) 的 REPO_REGISTRY_SKILLS 移除 bug-delivery、change-development、pull-request，防止自动生成新 Registry。保留 workspace-config/repo-registry.base.json 及其他实际 Registry 消费者（如 analysis-completion、spec-preparation、change-handoff）；本次不改造整个 Workspace 配置体系。

## 6. Skill 目标结构

```text
skills/
  pull-request/
    SKILL.md
```

```yaml
---
name: pull-request
description: 为已完成实现和验证的代码变更准备并创建 PR，适用于 Bug 和 Requirement。
---
```

建议正文仅包含 Inputs、Candidate Push、PR Preparation（公共 Facts + Bug 专属事实）、Requirement Publish、PR Materialization、Result / Recovery。必要 Facts 格式内联，不再保留 bug-evidence-contract.md 或 config/repo-registry.json。实际 SKILL.md 使用执行者视角，不写历史演进、CLI 内部算法、跨 Agent 总控规则或固定专业方法链。

输出实际 PR / Issue 引用、Candidate 和必要的验证 / 风险结论；复用已有 Issue 摘要。明确失败修正缺口，结果未知核实外部事实，不虚报完成。

## 7. 实施范围与顺序

### 阶段一：CLI 目标态收敛

1. 核查最新 main 和当前有效调用点，统一 Native Candidate Branch 为 feature/<tfs.id>（dev/prepare、相关 Git / PR / Gate 及测试）；不迁移远端旧分支，不增加兼容路径。
2. 复用当前 Runtime、根仓指定版本映射读取与授权检查，取消目标 CLI 对 Registry 文件的依赖。公共 Run 身份检查仅提取真正相同部分，不改变 Bug 直接指派与 Requirement 获批契约。
3. 将 bug git 收敛为 dev git，将 bug / dev pr-prepare 收敛为 pr prepare，复用 Candidate、Validation、Review、Facts 与写入回读逻辑；保留必要的专业分支。更新 Completion 对新机器验证来源的检查，保证原有强度。
4. pr materialize 统一 Issue 驱动入口，消除旧 mode / config / root-repo 参数及旧清理路径；补齐状态 / 授权与真实仓库身份检查、已有 PR 回读和创建 / 复用后的 Work Item 关联确认。
5. dev publish、dev check-change、openspec read、pr resume 无配置化；保留工程发布、Completion 与恢复语义。取消 Bug 的 analysis.change_kind=corrective：删除被替换的 bug/pr-prepare 写入和回读、bug/authorization.ts 中依赖、bug/finalize-facts.ts 强制校验及 Digest 成分；同步相关回归测试，不改变其他场景分类。
6. 删除被替换命令注册、旧输入及描述引用路径；更新有效调用点、命令帮助、next 提示及回归测试。不要为旧路径建设兼容层；若共享代码还有其他当前功能消费者，仅调整本次涉及的调用，不扩大清理范围。

### 阶段二：Skill 合并与资产退役

创建 pull-request/SKILL.md，删除 bug-delivery、change-development 及其配置与独立 Evidence Reference。更新 workspace-config/provisioning.json 的 managed_skills 和两 Agent 绑定；删除 Registry 生成名单中的三个名称，更新必要 Agent Instructions、README、COMMANDS.md、当前有效设计与测试引用。

核实新 Skill 注册、绑定与旧资产解绑退役。workspace/provision.ts 的 workspace_preparation_skill Overlay 不能再将 Bug Fix Agent / Engineer 切换到 workspace-preparation，最小调整两 Agent 的有效绑定；其他 Agent 的配置选择不动。现有 Provision 将未受管远程 Skill 标记为 unmanaged 而非自动删除；Sync 只清理受管 Skill 内文件。通过现有平台能力核实两旧 Skill 无消费者后退役，不新增垃圾回收机制，不默认删除 Git 文件即已删除平台资产。不改写历史 Archive、Replay、Validation Evidence。不变更其他 Skill 或独立工作流。

## 8. 验收

| 场景 | 必须满足 |
| --- | --- |
| Native Workspace / Branch | Bug 与 Requirement 均使用 feature/<tfs.id>，保留 Multica Task Branch；不使用旧 feat 回退，不将 Resource ref 当 PR 目标 |
| Runtime / Scope | 无 Registry 即可运行；错误 Task / Actor / Workspace / Issue、越权仓库、未知类型、根仓与批准来源不符、错误映射或目标分支不放行 |
| Candidate | 本地实际工作树、远端完整 SHA、审核事实一致；非强制 Push，异常回读；Bug 保留 Refs 尾注 |
| Validation | Requirement 实际命令执行及 Completion 不降级；Bug 机器验证与 Evidence-only 正确区分；空/非法/失败命令不得降级；缺少真实 PASS / 引用不通过；Candidate 或授权变化不写入有效 PASS |
| 公共 Facts | Review/Findings/Blockers 规则一致；Validation / Review 仅存 pr，完整事实可通过 Bug Finalization；Description 正文可跨 Run 复用，无 file: 依赖 |
| Bug 分类退役 | 无 analysis.change_kind 时可完整开工、准备、创建 PR、Resume、Finalize 及 TFS Writeback；不再写入、检查或将该字段纳入 Bug Digest；其他冲突检查仍生效 |
| 多仓 | Bug 必要仓集合完整；Requirement 实际仓属于批准 Scope，不强制无改动仓 PR；保留他仓事实 |
| Requirement Completion | 固定获批映射、Tasks、dev.publication、实际验证与现有适用 Gate；不需本地 Checkout 即可检查 |
| PR Materialization | 两类 Issue 均通过同一入口；已有 PR 核验、远端 HEAD、实际 TFS 身份正确；重复实际仓库拒绝；blocked / 收口 / 终态拒绝写入，in_review 只核实；新建或复用 PR 均核实 Work Item 关联，创建成功但关联失败重试可补挂并回读，全部成功后才 in_review |
| PR Resume | REWORK / RECREATE_PR、Human 授权、Bug 全组边界、Requirement 定向恢复、单次事实写入、旧评论不影响新 PR |
| Worktree | 不依赖本地根仓物化 PR，不删除 Multica Native Worktree |
| 配置 / Skill | 新 Skill 只有 SKILL.md；两研发 Agent 始终绑定 native-workspace 与 pull-request，不受旧 Overlay 切换影响；旧 Skill、绑定及 Registry 投影退役，不重新生成；其他有效消费者不受影响 |
| 回归 | 当前 Bug / Requirement Native prepare、Git、PR、Completion、Resume、Closeout、TFS Writeback 与 Workspace Sync / Provision 相关测试通过 |

以实际构建、测试和运行回读作为验收依据。未实际执行的验证或平台同步不得宣称通过。

## 9. 非目标与 01 原则复核

不合并 Agent；不为 Bug 引入 OpenSpec；不统一 Scope 业务语义、TFS Commit 关联方式或所有专业验证方法；不开发通用 PR Resume；除统一 pr 外不新增 Metadata Key、状态机、流程编排、配置服务、缓存或固定 Skill 调用链。不重构独立 Closeout / TFS Writeback / Workspace 体系。

| 原则 | 落实 |
| --- | --- |
| KISS / YAGNI | 公共入口与实际公共实现收敛，删除配置副本；不统一非公共专业事实或过早抽象 |
| Greenfield First | 未上线，直接采用统一分支和命令契约，无历史兼容、迁移、双轨 |
| One Rule, One Owner | Runtime、工程映射、交付事实、TFS 实际事实各有归属；公共校验只维护一次；Bug 不重复保存类型、Validation 或 Review |
| Native First | Multica 原生 Checkout 及生命周期，复用当前 Runtime |
| Specialist Focus | Agent 专业实现与审查；Skill 聚焦 PR；CLI 承担确定性操作 |
| Contract First | 统一必要公共契约，保留真实专业授权、证据及 Gate |
| Minimal Sufficient / Outcome First | 只提供必要输入与操作；无重复 Completion、无固定测试方法或额外报告 |

目标：Skill 2 → 1；Skill 内 Registry 2 → 0；3 个被替换命令 → 2 个公共命令；Candidate Branch 规则 2 → 1；Bug 冗余分类写入 1 → 0；新增顶层 Metadata Key 0。

本方案仅更新设计，未实施代码改造或运行验证。
