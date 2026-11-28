# 08-B｜Requirement：Runtime Workspace 与 Git Worktree（KISS 方案）

> **设计状态**　PR #128 提供了常驻根仓与业务 Worktree 的实现基线。2026-11-19 确认的[常驻根仓分支与独立发布修复方案](08b-requirement-root-branch-and-publish-plan.md)已纳入下文，待实现、下发及真实 Runtime 验收。适用阶段为 Requirement Analysis 与 Development。[08-A Bug Fix](08a-remote-analysis-bug-fix-foundation.md) 与归档沿用各自的 checkout 流程。
> 依据：[01](01-multica-openspec-design-guideline.md)、[05 OpenSpec](05-openspec-schema-implementation-design.md)、[09 统一 Engineer](09-unified-engineer-development-design.md)。
> 执行资产边界：09 独立新增 `Engineer` 与 `change-development`，不依赖旧 Engineer Skills；Workitem Analyst 保留需求分析与 OpenSpec 准备，不参与 TFS 子任务管理。执行资产已在 PR #128 独立实现；本方案仍是运行行为的权威契约。

## 1. 核心原则与流程

**Analysis 和 Development 共用项目配置的根仓分支，在选定根仓内编辑工件。每次只发布当前 Change 的已提交差异，远端回读成功后才提交 Human Review 或研发交付。业务代码按 TFS 需求 ID 使用 Worktree，根仓不按 Issue 创建 Worktree。**

~~~text
服务器 A — Workitem Analyst
  Rondo 核对持久化根仓与规范基线 → 按需通过只读 MCP 核实业务代码
  → 需求分析 → 编写 OpenSpec Change → Professional Review / Validation / Gate
  → Rondo 提取当前 Change 的已提交差异 → 基于远端同名分支最新提交发布 → 回读实际 SHA
  → Human Approval

Delivery Lead → @Engineer(change_ref)

服务器 B — Engineer
  准备本机根仓 → 按 analysis.source.commit 读取已批准 Change
  → 创建/复用子仓 Worktree → 实现 / 验证 / Review
  → Commit / Push 业务代码 → 独立发布当前 Change 的 Tasks / Evidence / PR 描述 → 记录交付 SHA
  → 同一 Run 创建 PR → 回流结果

服务器 C（或 A/B）— PR Status Sync
  PR 终态 → OpenSpec Archive → TFS Writeback → Done
~~~

跨服务器不共享磁盘：OpenSpec 通过远端**根仓 Git**交接，审批与执行身份通过 **Multica** 交接，业务 Candidate 通过**业务 Git 分支/Commit/PR**交接。无需增加同步服务、额外审批快照、分布式锁或 Workspace Manager。

09 的 `change_ref` 是 Lead 唯一正常派发输入；新 Engineer 使用独立 `change-development` Skill 完成整个 Change 的研发任务，不建立 `task_refs` 或新 `dev.dispatch` 派发事实，直接使用 Multica 原生 `@Engineer(change_ref)`。Lead 不在研发完成与 PR 创建之间二次派发；原 Backend / Frontend Engineer 及其 Skills、旧 Rondo 接口保持不变。

**本期前提：同一需求不会同时派发两个 Engineer。** 同一业务 Worktree 的并发写入不在本期设计及验收范围，不新增目录锁或执行权协调机制。不同需求可使用各自的业务 Worktree 并发研发，向项目配置的根仓分支独立发布工件，远端竞争按 §3.1 处理。前一 Run 结束后可复用原业务 Worktree。

## 2. 每个 Runtime 的常驻工作区

根仓目录由本机 `RONDO_WORKSPACE_PATH` 定位，显式提供 `--root-repo` 时直接使用传入路径，不增加两者的一致性校验。项目统一设置 `RONDO_WORKSPACE_BRANCH`，通过 `custom_env` 下发给所有 Agent。不同机器可使用不同目录。以下示例将该项目的根仓分支设为 `dev`。

~~~json
{
  "RONDO_WORKSPACE_PATH": "D:/UserProgram/winning-platform-monorepo",
  "RONDO_WORKSPACE_BRANCH": "dev"
}
~~~

仅在准备常驻根仓时使用这两项配置。分支变量缺失时保留工作区，提示补齐后继续；旧 `--branch` 与配置不同时提示所采用的项目分支，继续执行。只读 Issue 和派发等步骤不操作 Git。Task 的 cwd、身份和权限仍由 Multica 管理；普通 PowerShell 的环境设置不代表新 Run 已收到配置。

Windows/Linux 各服务器可使用不同绝对路径，逻辑仓库身份由 `repo-context.yaml` 与 Rondo Registry 统一确定。本次实测范围是同一 Windows 主机的 Codex / Claude；Codex 有效策略为 `danger-full-access / never`，Claude 有效策略记为 UNKNOWN，不将结果外推为严格沙箱已通过。

~~~text
<workspace>/
├── .git/                               # 根仓
├── openspec/changes/<change_ref>/
├── docs/config/repo-context.yaml
├── winning-dps-df-frame/               # 业务基础 Clone
├── winning-dps-df-frame-12345/         # TFS 12345 的 Worktree
├── winning-dps-df-frame-12346/
├── winning-dps-df-frame-web/           # 前端基础 Clone
└── winning-dps-df-frame-web-12345/     # TFS 12345 的前端 Worktree
~~~

基础 Clone 常驻，正常 Run 不重复 Clone 根仓或全部业务仓。沿用 Git Root / Origin、仓库授权及写入权限检查。当前根仓 `.gitignore` 已覆盖 `/winning-dps-df-*/`，运行时仍以 Git 实际结果校验业务基础仓与 Worktree 均被忽略。

Analysis 直接使用该根仓的 `openspec/`、`docs/config/repo-context.yaml` 及项目级 `openspec/schemas/`。本期不以用户全局 OpenSpec Schema / Template 安装作为前置条件，也不维护第二份 Schema 版本。Analyst 不创建业务 Worktree；代码探索使用已授权只读 MCP。

## 3. Analysis：OpenSpec Commit / Push 是交接前置条件

Workitem Analyst 在 §2 选定的根仓中，基于实际需求、OpenSpec 规格和授权的只读代码证据，在 `openspec/changes/<change_ref>/` 准备适用的 Proposal、Specs、Conditional Design、`tasks.md` 与必要 Evidence，并完成专业 Review、OpenSpec Validation 和 Analysis Gate。其工程编辑范围限当前获准 Change，业务批准由 Human 负责。

**只有以下三件事均完成，才能进入 Human Review 和后续 Development：**

1. 专业 Review、适用的 OpenSpec Validation 和 Analysis Gate 实际 PASS；关键业务决策、Repository Scope 与验证要求已足以供 Human 审核。
2. Rondo 保存当前 Change 的合法工件，只取该目录内已提交的新增、修改、删除，基于远端同名分支最新提交发布。其他需求的本地历史不参与本次发布。
3. 远端成功回读本次已提交 Change；Push 竞争按 §3.1 恢复，确认发布前不得交接；无法确认或恢复失败时停止交接。

**继续复用 `analysis.source = repo_url + branch + commit + change_ref`。** `branch` 记录实际发布分支，`commit` 记录远端回读确认的本次发布 SHA，可与本地保存 SHA 不同。批准后 Engineer 按该 SHA 读取工件。checkbox、Evidence、PR 描述及已批准范围内的非实质性 Design 细化可以更新，新远端 SHA 单独记入研发交付记录。只有行为、接口、验收要求或 Repository Scope 等需求规格发生实质变化，才重新进行分析发布和审批。

### 3.1 根仓按路径提交与 Push 竞争恢复

Analysis 和 Development 在常驻根仓编辑工件。每次正式发布以一个 `change_ref` 为单位，发布目标为 `origin/<RONDO_WORKSPACE_BRANCH>`。

1. 在选定的根仓完成本次编辑。Analysis Publish 在最终 Gate 通过后由 Rondo 按路径保存当前 Change 的合法工件，已有有效 Commit 时复用；保留其他需求的暂存和工作区内容。Development 保持其现有提交契约。切换分支前保存各需求的操作另见 §3.2。
2. 仅提取 `openspec/changes/<change_ref>/` 内本次已提交的新增、修改和删除。即使同一本地 Commit 同时包含 A 和 B，发布 A 时也只取 A 的差异。未提交内容、其他需求和目录外共享文件留在本地。
3. Fetch 远端同名分支，以其最新提交为基线应用上述差异。用普通 Push 发布本次结果。远端基线为 R、本地历史为 R → B → A 时，可以生成远端 R → A′ 并保留本地 B 和 A。其他需求的本地提交无需先行清理、审核或推送。
4. Git Fetch 确认候选 Commit 在正确目标分支可达，登记本次实际发布的 SHA。Analysis 在 Push 前核对候选契约与本次 Gate 一致，发布后不重复通过 REST 读取工件正文。分析交接记录在 `analysis.source`，研发阶段的新 SHA 记录在本次交付中，原批准版本保持固定。

不同 Change 共享 Git Index。遇到短暂 `index.lock` 等本地写锁竞争时，沿用单次 Git 写命令最多 3 次尝试（含首次）的约定。每次重试前确认上次操作结果，保留持续占用的锁及工作区。远端分支竞争按下表处理。

| Push / 回读结果 | Rondo 的确定性处理 |
| --- | --- |
| 回执丢失、断连或同一次发布重跑 | 先回读远端历史。确认已发布时复用该次实际 SHA，即使分支 HEAD 后来属于另一个需求，也不重复提交或 Push。确认尚未发布后才基于最新远端重试，结果仍不明时保留现场。 |
| 远端分支已前进，当前差异可以无损应用 | 在最新远端基线上重新应用本 Change 的差异，保留双方改动并自动继续。常驻根仓中的本地提交和工作区保持原状。 |
| 当前需求内容冲突 | 暂停本次发布，保留双方内容，报告文件和具体冲突差异。其他需求继续推进。 |
| 认证、权限或分支策略拒绝 | 报告实际错误，待对应外部条件恢复后先回读再继续。 |

Engineer 按批准 SHA 读取工件并核对授权范围。消费研发成果时使用此次交付的远端 SHA，可回溯到批准基线及允许的更新。

### 3.2 Analysis 开工：基线与权限

Analysis 与 Development 共用以下准备步骤。

1. 按 §2 解析目录与配置分支，Fetch 并确认目标。若本地缺少目标分支，先确认远端同名分支存在。本地与远端均无该分支时保留现场，提示维护者核对名称。
2. 需要切换时，暂存和提交之前先检查目标分支是否被其他 Worktree 占用。若已占用，报告分支名和占用目录，等维护者释放后继续。
3. 在原分支按需求分别暂存并提交已有改动；无法归属的共享改动单独做一笔本地提交。这些保存提交不 Push。完成保存后在选定目录切换，缺少本地分支时从远端同名分支创建跟踪分支。原分支干净时可直接切换。已在配置分支时跳过保存和切换。本期不处理跨分支迁移当前需求改动。
4. 能安全 Fast-forward 就更新。仅有历史分叉时保留本地提交和工作区，不自动 merge、rebase 或 reset，继续处理当前需求。核对本次工作实际使用的项目 Schema、Template、现行 Specs 和 Repository Mapping；核实工件与规范时使用可确认的版本。

Workitem Analyst 的调查和工件准备继续沿用以下边界。

- Workitem Analyst 通过 `remote-codegraph`、`remote-filesystem`、`remote-ripgrep` 按需核实业务行为与影响。MCP 是只读调查入口，不要求业务子仓先 Checkout 到本次 Task，也不负责业务 Worktree 或源码修改。
- 技术变更性质由 Analyst 依据实际目标判断；普通 Requirement 使用 `intentional-change`，属于恢复既定行为的 Requirement 可选择现有 Corrective 分析能力。TFS 类型本身不自动决定 Schema。
- 本期 OpenSpec CLI 以根仓为明确工作目录，消费当前 Change 的项目级 Schema / Artifact Instruction / Template，不从用户全局同名 Schema 取代项目契约。

### 3.3 Workitem Analyst Agent Instructions（目标稿）

Instructions 仅表达长期专业职责与结果边界；不写 Workspace、Squad、Run 时序、Git 分支、OpenSpec 发布算法。保留 Agent 级只读 MCP 可用能力，避免 Skill 未加载时无法选择代码调查工具。

~~~markdown
# Role & Goal

你是 Workitem Analyst，负责澄清需求意图、分析工程影响，形成准确、可实施、可验证的工程要求。

# Core Responsibilities

- 澄清业务目标、预期行为、规则、范围与验收条件。
- 根据实际问题调查现有规格与代码事实，评估技术影响及必要取舍。
- 明确受影响的 Repository Scope、关键依赖、风险与待授权决策。
- 准备并审查适用的 OpenSpec 工程工件，提出有依据的 Independent Verify Recommendation。

# Working Principles

- 区分已确认事实、假设和建议；复用有效结论，只调查关键缺口。
- 按问题复杂度选择调查、分析和设计深度，不强制固定方法链。
- 不把局部实现细节无必要地升级为业务决策，不以文档齐全替代专业判断。

# MCP 使用

按需使用已授权的 remote-codegraph、remote-filesystem、remote-ripgrep 获取只读工程证据；以实际源码和已确认的业务要求为准。

# Boundaries & Delivery

- 不负责生产代码修改、研发分工、业务批准或外部交付管理。
- 关键意图、范围或授权不能确认时说明缺口，不将推测写成已确认要求。
- 交付一致的 OpenSpec Change、必要证据引用、验证建议与未决事项；提交结果未经实际核实，不宣称完成。
~~~

该目标稿聚焦 Requirement；如果同一 Workitem Analyst 继续处理 Requirement 的 Corrective 场景，保留必要的纠正性问题分析职责，不另建 Agent。

### 3.4 Analysis Skills 规划（保留按需组合，不创建综合 Skill）

| Skill | 调整 | 唯一能力边界 |
| --- | --- | --- |
| `requirement-analysis` | 保留并轻量优化 | 澄清 Intentional 业务目标、规则、Scenario、范围、Repository 影响与必要方案取舍；不负责 OpenSpec 写入、Git 或 Multica 状态 |
| `codebase-explorer` | 直接复用 | 按需通过只读 MCP 定位业务实现、接口和影响，事实够用即停止 |
| `spec-preparation` | 重点优化 | 消费已确认的专业结论与项目级 Artifact Contract，使用 OpenSpec CLI New / Prepare / Revise 当前 Change；根仓路径由 Rondo 提供，不再要求 Multica 原生 checkout；不负责 Commit / Push |
| `analysis-publish` | 重点优化 | 调用 Analysis Stage / Gate / Complete，确认远端 Change 已发布、固定 `analysis.source` 和 `analysis_review` 已回读；Git 锁、Push 历史与重试算法属于 Rondo，不复制进 Skill |
| `bug-analysis` | 按需保留 | 仅在 Requirement 实质为 Corrective 时进行根因诊断；不强制普通 Intentional 使用 |
| `workitem-analysis` | 继续 Retired | 不恢复旧的综合 Workflow Skill |

不因执行顺序新建 `analysis-workflow` / `requirement-delivery` Skill；不把不同专业能力机械合并成单体 Skill，也不要求每个 Skill 生成同名 Markdown。Skills 不复制 OpenSpec Schema 的 Artifact Graph、Template 或字段规则。

### 3.5 最小 CLI、工程交接与停止条件

Requirement 调用沿用以下 CLI 入口。根仓准备和分析发布在修复后按 §2、§3.1–§3.2 执行。

~~~bash
# 从 Agent 配置准备常驻根仓，后续命令的 <root> 使用返回的 root_repo
rondo runtime prepare-root

# 已有：唯一 Change 解析、工件准备与原生检查
rondo openspec resolve-identity --openspec-root "<root>" --change-ref <change_ref> --tfs-id <tfs.id> --expect-schema <schema>
openspec status --change <change_ref> --json
openspec instructions <artifact-id> --change <change_ref> --json
openspec validate <change_ref> --type change --strict --no-interactive --json

# 已有：提交审核入口；Analysis Complete 需完成 §3.1 改造后使用
rondo analysis stage --issue <issue> --facts <facts.json> --workspace-id <workspace-id> --registry-config "<config>"
rondo analysis validate --issue <issue> --openspec-root "<root>" --workspace-id <workspace-id> --registry-config "<config>" --out openspec/changes/<change_ref>/logs/analysis-gate-result.json
rondo analysis publish --mode requirement --issue <issue> --facts <facts.json> --workspace-id <workspace-id> --registry-config "<config>" --root-repo "<root>"
rondo analysis read --config "<config>" --issue <issue> --file tasks.md
~~~

显式指定目录时使用 `rondo runtime prepare-root --root-repo <root>`。此入口已存在，项目分支选择、切换前按需求保存、分叉保留等行为属于待实施修复。仅当任务需要准备常驻根仓时调用；Agent / Skill 消费 Rondo 返回的路径和状态。

Repository 授权来自 Human 批准的 Change `.openspec.yaml` 顶层 `x-repositories`（唯一 `repo_id` 清单），映射根仓 `repo-context.yaml`。Scope 是授权上限，Engineer 根据实现决定实际修改仓库；Rondo 校验越权与 Candidate / PR Preparation 一致性，不创建第二份仓库派发事实或解析自然语言决定必改仓库。该约定由 `spec-preparation` Skill 落实，不额外定义 Metadata Schema。

Analysis 的 `tasks.md` 按工程实际需要记录 PR 前 Implementation 与开发侧必要 Verification Tasks，数量和颗粒度由工程需求决定，**不受 TFS 子任务 1–5 个限制**，也不要求一一对应。Workitem Analyst 只负责准确、可实施的工程契约，不处理 TFS 子任务分合；PR 后 Independent Verify / CI 不作为 PR 前 checkbox。本期不新增独立 Verify 自动闭环。

关键业务决定、Repository Scope、验收范围不明确，或根仓基线 / Gate / Publish 结果不可确认时停止受影响操作。发布后以 `analysis.source = repo_url + branch + commit + change_ref` 固定审核版本；后续 Tasks 进度与 Evidence 更新不改写该已批准 Commit。

## 4. Development：启动时同步根仓

服务器 B 收到 `@Engineer(change_ref)` 后，使用 §3.5 的 `rondo runtime prepare-root` 入口执行 §3.2 的准备步骤。各机器使用同一项目分支；能安全快进时更新，历史分叉时保留本地状态继续。

Engineer 核对 Human Approval 与当前 `analysis.source`，通过 `rondo analysis read` 读取批准的远端 `analysis.source.commit` 及其 Change 工件。两台服务器的本地 HEAD 可以不同。后续正式发布直接在远端最新基线上应用本次已提交的 Change 差异，交付 SHA 与批准 SHA 分别记录。

## 5. 业务仓 Worktree、研发和 PR

Lead 确认 Human Approval 与 Change 后，直接 `@Engineer(change_ref)`；无须先物化新 `dev.dispatch`。Repository Scope 是批准的可修改仓库上限，Engineer 按实际实现确定改动仓库，Rondo 校验不越权。业务仓身份按 Registry `repo_path`，TFS ID 按 Issue Metadata，不从 Change 名称猜测。

| 对象 | 规则 |
| --- | --- |
| 基础仓 | `<workspace>/<repo_path>`，用于 Fetch 和 Worktree 管理，不直接修改需求代码 |
| Worktree | `<workspace>/<repo_path>-<tfs.id>`，与基础仓同级 |
| 业务基础分支与 PR 目标分支 | 沿用子仓 Registry 的 `default_target_branch`，默认 `dev`，与根仓的 `RONDO_WORKSPACE_BRANCH` 独立 |
| Requirement 分支 | `feature/<tfs.id>`；08-A Bug 的旧分支规则不变 |

Requirement `rondo dev prepare` 核对 Origin、目标分支、现有 Worktree 与候选分支后，使用 Git 原生能力；本地候选落后于远端时仅允许安全 Fast-forward，分叉或未推送修改保持现场并停止：

- **首次**：`git worktree add -b feature/<tfs.id> <path> origin/<target>`；若远端已有 `origin/feature/<tfs.id>`，则从已有候选恢复。
- **本地分支已存在、未被其他 Worktree 检出**：`git worktree add <path> feature/<tfs.id>`，不加 `-b`。
- **合法 Worktree 已存在**：直接复用，保留未提交或未 Push 的修改。
- **同一分支已被其他 Worktree 检出或身份冲突**：停止，不能 `--force`、`reset`、`clean`。不同 TFS ID 可在同一基础仓的不同 Worktree 并发开发。

~~~powershell
$hub = "D:\UserProgram\winning-platform-monorepo\winning-dps-df-frame"
$worktree = "D:\UserProgram\winning-platform-monorepo\winning-dps-df-frame-12345"
git -C $hub fetch origin
git -C $hub worktree add -b feature/12345 $worktree origin/<target-branch>
~~~

Worktree 的 `.git` 通常是**文件**，不是独立 Clone 的 `.git` 目录；用 Git Common Dir、Branch、Origin 和 Worktree List 核对归属。现有 `rondo dev prepare` 主要是 Bug 独立 Clone，Requirement Worktree 已实现；Bug 与 Requirement 均使用 `feature/<tfs.id>`。

新 Engineer 通过独立 `change-development` Skill，在同一个正常 Run 对实际需要修改的授权仓完成实现、Local Validation、Review、Commit / Push；再由 Rondo 按 §3.1 发布 `tasks.md` checkbox、合法 Design 细化、`evidence*.json`、`pr-description-<repo_key>.md`，回读并执行 Change 级 Completion Check，最后 `rondo pr materialize` 创建或复用所需 PR。创建前整体核对实际代码变更仓库的 Candidate / PR Preparation，无修改仓库不制造空 Commit / PR。发布无法确认时停止，不增加 Lead 二次派发。Evidence 以稳定的 `repo_key + repo_url + commit SHA` 识别，PR 描述从已 Push Change 恢复，不依赖原 Runtime 本地路径。Skill 不依赖旧 `development-execution`、`pull-request` 或领域 Skills。

不同服务器可以恢复**已 Push** 的业务候选分支；无法从远端恢复另一机器未提交或未 Push 的 WIP，这不影响正常 Analysis → Development 的跨服务器交接。

<a id="requirement-finalize"></a>

## 6. PR Status Sync 与独立 Verify

PR Status Sync 不需要访问 Engineer 本地 Worktree。继续由 Rondo 执行：

~~~bash
rondo workitem finalize --phase prepare --issue <KEY> --root-repo "<root_repo>"
rondo workitem writeback --issue <KEY> --root-repo "<root_repo>"
rondo workitem finalize --phase complete --issue <KEY> --root-repo "<root_repo>"
~~~

按远端 PR、OpenSpec 和 Delivery Facts 归档并收口，外部动作部分成功时先对账、只补缺失项，不引入跨服务器工作区机制。**TFS 子任务独立于 OpenSpec Tasks**：PR Status Sync Agent 在 Prepare PASS 后依据批准版 `tasks.md` 与真实业务 Commit 决定 1–5 个 TFS 子任务及估时；Rondo 执行独占关联、回读与恢复，**无有效计划不默认创建**。参见 [10 方案](10-tfs-subtask-estimation-design.md)。不让 Analyst / Engineer 管理 TFS 任务。

Archive 沿用既有独立临时 Clone、checkout、发布和回读流程。归档提交范围包含当前 Change 的归档变更及实际受影响的主规格；主规格冲突时保留现场。§3.1 的 Requirement 路径发布规则仅适用于 Analysis 和 Development。PR Status Sync 并发保持 `1`。

Independent Verify 新闭环本期暂不实施：`verify_agent.required=false` 走常规 PR Review / Merge；`required=true` 保持已有缺少 Verify PASS 时禁止自动 Finalize 的安全行为，不增加新的 Verify / TFS Merge Gate 方案，也不声称自动闭环。

08-A Bug 的独立 `bug.delivery`、Clone、PR 与无 Archive 收口保持不变。

## 7. 最小实施与验收

### 7.1 已完成的机制验证与本期边界

首轮 Desktop 最小验证完成五个真实 Run，确认 Agent `custom_env` 变量传递、Task 外目录与 Git 写入、新 Run / 同机另一 Provider 恢复及不同业务 Worktree 并发。该轮还验证了早期隔离发布 Worktree 的 Push 竞争与 Rebase 恢复。原始记录可从根仓历史读取，使用 `git show 881f45d7:projects/multica/validation/new/workspace-spike-20261118/README.md`。

根仓直接提交验证随后完成三个真实 Desktop Run。两个 Run 在同一普通根仓、不同 Change 目录执行四轮并发提交，8 个 Commit 各自只含对应目录，其他 staged / unstaged / untracked 内容得以保留。实际出现的 3 次 `index.lock` 竞争均在首次短暂重试后恢复，未创建额外 Worktree。一次 Push 发布了双方全部 8 个 Commit，另一对照也观察到其他未 Push 的先行 Commit 随之发布。这是当时直接推本地 tip 的结果。§3.1 的修复设计使 A 的差异可独立发布，需另行验证。历史记录见 `git show 881f45d7:projects/multica/validation/new/root-direct-publish-20261118/README.md`。

**本轮机制探索结束，不追加机制验证作为方案实施的前置条件。** 同一 Worktree 并发写入按 §1 前提排除；Push 异常处理、路径贯通、Gate 与版本核对交由 Rondo 程序实现。Git 跨机器获取已发布成果使用既有能力，生命周期和清理边界按配置及实现核实，不扩展新的专项实验。

历史实验采用本地 bare remote、当前 Windows 权限配置和临时测试脚本，不能称为生产 TFS、严格沙箱、daemon 环境继承或 Rondo 全流程已验收。历史双写观察保留在证据中，不作为本期阻断项。本期采用已验证的 Agent `custom_env`；今后若改变注入方式或权限前提，再按实际不确定性决定是否需补验证。

### 7.2 后续程序实施与交付验收

本节覆盖既有工程交付范围及已确认的根仓修复。新增行为的实施、配置下发和验收均待后续执行。

| 位置 | 必需修改 |
| --- | --- |
| Runtime / Agent 配置 | 复用目录选择优先级，统一下发 `RONDO_WORKSPACE_BRANCH`，按 §3.2 准备常驻根仓 |
| Analysis 和 Development 发布 / Rondo | 共享 §3.1 的单 Change 差异发布与回读，分别登记分析批准来源和研发交付 SHA |
| Workitem Analyst / Analysis Skills | 聚焦需求分析和工程契约；定向修订现有 Instructions、`requirement-analysis`、`spec-preparation`、`analysis-publish`，保留 MCP 与 `codebase-explorer`；不处理 TFS 任务拆分、合并和数量 |
| OpenSpec Change Metadata | `.openspec.yaml` 的 `x-repositories` 明确唯一 Repository Scope；`tasks.md` 按工程需要表达 PR 前任务，不因 TFS 数量调整；项目级 Schema 随根仓 Git 管理，必要时同步修订 03 / 05 |
| 新 `Engineer` / `change-development` | 新建独立 Agent、Skill 与绑定；通过 Rondo 完成 Change 级研发、发布、Completion 和 PR，不依赖旧 Agent / Skills |
| Engineer 开工入口 | Fetch、可安全时 Fast-forward；否则按批准 Commit 安全读取当前 Change，不破坏其他 WIP |
| Requirement `dev prepare` / `dev pr-prepare` | 同级 `feature/<tfs.id>` Worktree 与候选分支，Git 重入和唯一检出 |
| 09 Completion / Evidence / TFS Writeback | 新路线采用显式 Change 级契约、稳定 Git 身份和跨服务器 PR / Finalize；PR Status Sync Agent 规划 1–5 个 TFS 子任务，Rondo 强制 Commit 独占，不要求与 OpenSpec Tasks 一一对应；旧 `task_refs` 和 Bug 路线保持可用 |

**修复验收使用新的测试 Issue 和测试仓，保留 LEI-35 现场。** 验证所选目录内按项目分支保存、切换、跟踪与同步；占用时须在暂存前报告目录。核对根仓没有新增 Issue Worktree，业务仓按 TFS ID 隔离。构造 A、B 交错提交及混合路径，确认只发布 A、保留 B；覆盖可兼容的远端推进、当前 Change 内容冲突与重试回读，分别核对实际分析和研发发布 SHA。具体验收场景见[修复方案](08b-requirement-root-branch-and-publish-plan.md)。

既有跨 Runtime 交付验收继续覆盖 Analysis / Approval、Engineer 读取获批 Change、业务 Worktree、同 Run 创建 PR，以及从远端证据独立 Archive / TFS Writeback / Done。保持 Schema 基线、Repository Scope、合法 Design 细化、未改仓无空 PR、TFS 子任务与工程 Tasks 解耦、同一业务分支唯一检出及旧接口回归验证。

**未经真实 Runtime E2E 不切换生产 Requirement。** 本设计不增加跨机器文件同步服务、分布式锁、额外 Snapshot 或新状态机。
