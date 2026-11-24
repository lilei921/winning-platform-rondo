# Workspace 管理机制解耦与 Registry 退役优化方案

> 状态：已确认 Native 优先实施；第一阶段完成 native-workspace，第二阶段再完成 persistent-workspace。Native 基础 Spike 已完成（PASS 9、PARTIAL 2、FAIL 1，未登记仓库为非目标）；第一阶段待研发和端到端验证。2026-11-24。
> 依据：[01 统一设计规范](../../01-multica-openspec-design-guideline.md) v1.16.13；原始分析基线 main Tree `0fb95275b6ffc6bcfb086fe797ac2a2790222740`。
> 验证依据：[Native Workspace Spike 实测报告（2026-11-24）](../../validation/native-workspace-spike-20261124.md)，Multica 0.11.1（e1fe10d66）、Rondo 1.2.37，LEI-54 / LEI-55。
> 本方案整合此前 Registry 退役、根仓准备统一及完整仓库管理机制解耦设计。未修改生产代码。

## 1. 目标及原则

**Repository Management is independent of Work Item Type.**

Bug / Requirement 是业务处理类型；Native / Persistent 是本地仓库管理机制。两者正交，根仓和子仓采用同一种管理机制，不按 Issue 类型决定 Clone、Checkout 或 Worktree。

建立两个完整、可独立绑定的 Skill：

```text
skills/
├── native-workspace/
│   └── SKILL.md
└── persistent-workspace/
    └── SKILL.md
```

- `native-workspace`：根仓和业务子仓均使用 Multica Native Checkout。
- `persistent-workspace`：常驻根仓 + 业务基础 Clone + 按 Issue 隔离的业务 Worktree。
- 两者均支持 Bug Fix Agent、Workitem Analyst、Engineer；Workitem Analyst 按需只准备根仓。
- 不按根仓/子仓、Bug/Requirement 拆分 Skill；不引入 Module 路由。
- 最终退役原 `workspace-preparation` 及其 Registry JSON，不复制给新 Skill。第一阶段先完成 Native 完整交付闭环，不以 Persistent 实现为前置条件；第二阶段再实现 Persistent。未迁移的现有部署及在途任务仍使用原有可用路径，确认无消费者后才删除旧资产。

遵守 First Principles、KISS、YAGNI、Native First、Specialist Focus、One Rule One Owner、Reference not Replication、Minimal Sufficient、Greenfield First、Right-sized Composition。

## 2. 当前实现与实际耦合

| 场景 | 根仓 | 业务子仓 |
| --- | --- | --- |
| Bug Fix | Native Checkout | 独立 Clone，feat/<tfs.id> |
| Requirement A | Native Checkout | Clone + Worktree，feature/<tfs.id> |
| Requirement B | 常驻根仓 | Clone + Worktree，feature/<tfs.id> |

当前 [workspace-preparation/SKILL.md](../../skills/workspace-preparation/SKILL.md) 同时描述上述路径；[dev/prepare.ts](../../rondo/src/commands/dev/prepare.ts) 按 mode=bug/requirement 直接选择不同 Git 准备算法，且依赖 --config。

其他必要兼容点：

- [prepare-workspace.ts](../../rondo/src/commands/dev/prepare-workspace.ts)：Bug checkout 校验要求独立 .git 目录、指定本地分支和 Git Common Directory。
- [requirement-worktree.ts](../../rondo/src/commands/dev/requirement-worktree.ts)：已有基础 Clone、候选续接、Worktree 隔离与回收算法，可复用为通用 Worktree 能力。
- [bug/git.ts](../../rondo/src/commands/bug/git.ts)、[bug/pr-prepare.ts](../../rondo/src/commands/bug/pr-prepare.ts)：强依赖独立 Clone 及本地 feat 分支，不能直接用于 Worktree 或 Native 子仓。
- [dev/pr-prepare.ts](../../rondo/src/commands/dev/pr-prepare.ts)：通过 root/repo_path 推导基础仓，部分验证消费实际路径。
- [pr/materialize.ts](../../rondo/src/commands/pr/materialize.ts)：Requirement PR 登记后包含 Worktree 清理，需将清理职责从业务类型解耦。
- [dev/requirement-guard.ts](../../rondo/src/commands/dev/requirement-guard.ts)：已有 Engineer、批准 Change、Scope、Registry 范围校验，必须保留。
- [runtime/check-checkout.ts](../../rondo/src/commands/runtime/check-checkout.ts)：仅检查本地 Git 根目录及 AGENTS.md，不查询 Multica 或核验 Task/Actor/Workspace 身份。
- [workspace/sync.ts](../../rondo/src/commands/workspace/sync.ts)：现有 Registry 渲染和远端 Skill 文件差异对账。
- [workspace-config/provisioning.json](../../workspace-config/provisioning.json)：现有三个 Agent 绑定 workspace-preparation；仓内 Provisioning 默认配置与实际 Project Resource 不应混同。用户已确认目标项目实际登记了根仓及全部业务子仓（当前根仓 ref 为 master，业务子仓 ref 为 dev）。

## 3. Native Workspace（第一阶段实施）

已知部署前提：目标 Project Resources 已登记全部需要的根仓及业务子仓。不验证未登记仓库的 Checkout，不新增资源登记机制。Native 的 Checkout URL 与首次起始 ref 取自已登记 Resource；repo-context.yaml 提供 Repository ID、工程语义及路径映射，核对所选 Resource 的仓库身份。Resource ref 是 Checkout 起点，不自动等同于 PR Target Branch；现有交付分支策略继续有效。Resource URL/ref 的完整机器读取接口尚未实测；实现时检查当前 CLI/API/原生上下文及已有 Rondo 能力，不能用 repo list 代替，也不假定未知接口。若 CLI 不能直接读取，优先复用已核实的原生上下文作为明确输入（只在实际必要时补最小参数，并保持 URL 与批准映射/授权一致）；不新增 Resource 查询服务或配置副本。不能确认输入时报告真实阻塞。

### 3.1 已验证事实与实施边界

| 实测项 | 结果及设计影响 |
| --- | --- |
| 已登记 TFS 根仓、frame、frame-web | PASS；根仓在 Task workdir 下，业务仓在根仓 cwd 下形成直属子目录，沿用 repo_path；根仓忽略且不跟踪业务仓 |
| Git 形态与隔离 | PASS；每仓 .git 为文件，linked worktree 共享对应仓的 daemon bare cache，Task Branch 与工作树隔离；不硬编码实际 D 盘路径 |
| Checkout CLI | 仅支持 `<url> [--ref <branch, tag, or commit>] [--fresh]`，无 --output json 或目标目录参数；必须在 daemon Task 内显式控制 cwd |
| 首次 ref 与 Candidate 跨 Task 续接 | PASS；新工作树 HEAD 与指定远端 ref 一致，发布不同名远端分支及 SHA 回读已实测成功 |
| 同 Task 重复 Checkout | PASS（复用语义）；Kept 保持工作树/分支/HEAD，仅 Fetch remote refs，不切换 ref；untracked 临时文件保护已实测，未发布 Commit 保护及 fetch_error 等仍纳入回归 |
| 仓库可用范围 | common 未登记时 FAIL；repo list 仅列根仓但已登记子仓可成功 Checkout，不作为完整 Resource 清单；不另建可用性预检或 Clone 兜底 |
| Rondo 兼容性 | PARTIAL；check-checkout 实测 PASS，Bug Git/PR Preparation 的独立 Clone 和同名分支约束不兼容；Requirement PR Preparation 仅静态判断基本兼容，正式交付尚未验证 |

上述基础证据足够进入第一阶段开发；不再开展广泛 Spike。未验证的 Resource URL/ref 获取接口、实际业务根仓映射/交付目标策略、已批准版本可读取性、重入分歧及正式交付写操作，在实现与回归中核实。Spike 不是端到端交付 PASS。

### 3.2 根仓

复用当前 Task 的 Native Checkout；首次在 Task workdir 执行：

```powershell
multica repo checkout <root-url> --ref <resource-ref>
rondo runtime check-checkout --root-repo "<actual-root>"
```

URL 与 ref 来自 Project Resource；未指定 ref 时省略参数。使用实际返回路径。check-checkout 仅描述本地就绪检查，不增加额外身份机制。根仓 Checkout 起点、本地 Task Branch、OpenSpec 远端发布目标是不同概念，保留现有发布契约。

### 3.3 业务子仓

使用已授权 Repository 的 URL 和已核实的基线：

```powershell
multica repo checkout <business-repo-url> --ref <base-ref>
```

业务仓通过 `rondo dev prepare --workspace native` 执行：复用已有业务授权，解析仓库映射及候选分支，确定 Checkout 起点，在已就绪根仓目录下调用 Multica 原生 Checkout，并核验实际返回路径。上面的 multica 命令仅说明内部原生机制，不要求 LLM 自行拼接查询或绕过授权。实际路径以平台返回为准，不推测目录，不由 Rondo 额外创建 Clone 或 Worktree。调用使用现有 Multica CLI 前缀与 Task 环境，显式设置子进程 cwd 为已核验根仓。复用 `delivery/closeout-root.ts` 的 `parsePlatformCheckoutOutput` 等已有能力（按实际首次/Kept 输出补齐解析和测试）；无 JSON 输出、无目标目录参数；不复制 Closeout 专用归档逻辑。返回路径必须与 `validateBusinessPath` 核验的直属业务仓路径一致，不需新建路径映射或普遍新增 `--repo-dir`。

远端 Candidate 已存在时从已核实 Candidate 继续；确认不存在时使用已登记 Resource 的明确初始 ref（核对现有交付目标策略，不把 ref 自动等同 PR Target）。查询失败不能视作不存在。Native Task Branch 不必与远端 Candidate 同名。首次 Checkout 核验 HEAD 与所选远端基线一致；重入时 `Kept` 不是 ref 切换，核验当前 Task 归属及实际 HEAD。已有 Candidate 时以 `git merge-base --is-ancestor <candidate-sha> HEAD` 等 Git 证据判断是否包含必需的远端 Candidate，允许合法本地新提交，不要求 HEAD 恒等于远端 SHA。无 Candidate 的重入保护原有效基线及本地成果，不强制追平新目标分支；若基线不明、远端事实无法确认或历史不相容，则保留现场并明确差异，根据已有安全方式处理，必要时由 Agent/Human 协调新 Task 从已发布 Candidate 续接，不自动切换 Task 或丢弃未发布成果。保留实际 HEAD、Origin、授权、非强制发布及远端 SHA 回读。

Multica 管理本地工作区及其生命周期，Rondo 负责必要的确定性校验和正式 Candidate 发布，不重建平台 Checkout / Cache / 清理机制。已有 Checkout 的 kept / fetch_error 等结果不能直接等同于最新基线，不覆盖本地 WIP。不得默认使用 --fresh、reset、clean、自动 rebase、force push；不为同 Task ref 切换开发独立机制。

已登记 TFS 仓库 Checkout、嵌套、多仓、重复 Checkout、untracked 保护、首次 Candidate ref、跨 Task 隔离及测试分支发布均有 Spike 证据。第一阶段只补足真实交付及边界回归，不重复无关验证。

## 4. Persistent Workspace（第二阶段设计，暂不实施）

第一阶段不通用化现有 Worktree 算法、不实现 Bug Worktree、不创建 persistent-workspace Skill、不改造 Persistent 回收能力。保留原有可用路径，第二阶段依据实际需求复用第一阶段已完成的授权及交付兼容能力。

### 4.1 根仓

```powershell
rondo runtime prepare-root
```

使用 RONDO_WORKSPACE_PATH 与 RONDO_WORKSPACE_BRANCH，依赖已存在的常驻根仓，不负责首次 Clone。复用当前 Origin 核验、Fetch、分支切换、安全 Fast-forward 和 WIP 保护算法。

### 4.2 业务子仓

Bug 与 Requirement 均使用常驻基础 Clone + 按 Issue 隔离的业务 Worktree。目录沿用现有约定：

```text
RONDO_WORKSPACE_PATH/
├── docs/
├── openspec/
├── <repo_path>/             # 基础 Clone
└── <repo_path>-<tfs.id>/    # 业务 Worktree
```

目标态调用示意（非当前可执行契约）：

```powershell
rondo dev prepare --workspace persistent --issue <issue> --repo <repo_id> --root-repo "<root>"
```

Requirement 继续显式提供 `--change-ref <change_ref>`，复用现有批准身份核验；业务授权与准备方式分别处理。复用现有 requirement-worktree.ts 核心算法，按既有业务候选分支传参，抽取通用业务 Worktree 准备能力。不新增 Workspace Provider 框架。

Rondo 负责已确认交付后的业务 Worktree 回收，适用于 Bug 与 Requirement；保护 dirty/unpushed 等未交付内容，不让清理失败改变已确认的 PR 登记结果。共享常驻根仓本身不具备按 Issue 的 OpenSpec 隔离，保留现有根仓发布及并发约束，不另建机制。

## 5. Skill 绑定及内容

第一阶段仅创建和供给 native-workspace，在验证通过的目标 Workspace 中，将 Bug Fix Agent、Workitem Analyst、Engineer 的原 workspace-preparation 绑定替换为 native-workspace；不等待 persistent-workspace。第二阶段才创建和供给 persistent-workspace。表中为最终目标态，不表示第一阶段已存在两种新 Skill。原 Skill 对尚未迁移的部署保留现有绑定及必要配置；若全部消费者已迁移，可在第一阶段退役原 Skill，无需等第二阶段。

通过现有 Multica 原生 Skill 绑定在部署时选择一种机制，同一 Workspace 的研发成员一致采用该机制。不让 LLM 根据业务类型或临时情况选择管理机制，不同时挂载两种 Skill。

| Agent | Native 部署 | Persistent 部署 |
| --- | --- | --- |
| Bug Fix Agent | native-workspace | persistent-workspace |
| Workitem Analyst | native-workspace | persistent-workspace |
| Engineer | native-workspace | persistent-workspace |

Provisioning 当前通过 manifest.agents[].skills 和 `multica agent skills set` 收敛绑定。第一阶段只配置 Native 已验证部署所需的实际绑定；仅当存在必须同时保留旧部署的事实时，才利用现有 Overlay / workspace_groups 处理最小绑定差异。第二阶段确有不同 Workspace 部署需求时，再补充最小绑定覆盖能力，不提前设计两种新 Skill 的动态选择，不另建模式配置，不查询 Agent Skill 反推 CLI 参数。新 Skill 先供给并核实可用，再解绑旧 Skill；unmanaged 不等于自动删除。

Agent Instructions 不硬编码具体机制，例如：

> 需要本地根仓或业务源码时，按需使用已绑定的工作区准备 Skill，以核实的实际路径开展工作。

Workitem Analyst 可仅描述本地 OpenSpec 根仓需求。专业交付 Skill 不重复定义 Checkout、Clone 或 Worktree 算法，不固定 Skill 调用链。同时更新 `bug-delivery`、`change-development` 中旧 Skill 引用、平台根仓/持久根仓限定及 Worktree 回收描述，使其仅消费已就绪根仓、真实业务工作树路径及交付命令。不得将另一种管理机制的说明写入当前 Skill。

### native-workspace 目标内容

- Description：按需使用 Multica 原生机制准备或复用工程根仓和授权业务仓。
- 根仓：Project Resource URL/ref、Native Checkout、实际路径、根仓就绪检查。
- 业务仓：固定调用 `rondo dev prepare --workspace native --issue <issue> --repo <repo_id> --root-repo "<root>"`；Requirement 追加 `--change-ref <change_ref>`；使用返回的实际路径。
- Result：使用确认成功的实际路径，核实异常并保护已有工作成果。

### persistent-workspace 目标内容（第二阶段）

- Description：按需准备或复用常驻工程根仓及按 Issue 隔离的授权业务 Worktree。
- 根仓：rondo runtime prepare-root。
- 业务仓：固定调用 `rondo dev prepare --workspace persistent --issue <issue> --repo <repo_id> --root-repo "<root>"`；Requirement 追加 `--change-ref <change_ref>`；使用返回的实际路径。
- Result：使用确认成功的实际路径，核实异常并保护已有工作成果。

两个 Skill 不新增 config、modules、references、scripts，当前规模不需要。正式命令以兼容改造后的 CLI 为准，不提前在生产 Skill 中写入未实现命令。

## 6. Rondo CLI 解耦与交付兼容

以下为两阶段最终契约。第一阶段仅实现 Native 路径及其实际需要的公共逻辑，第二阶段再增加 Persistent 路径。不为第二阶段预建接口、抽象类、空分支或占位命令。

### 6.1 统一准备入口

```powershell
rondo dev prepare --workspace native --issue <issue> --repo <repo_id> --root-repo "<root>"
rondo dev prepare --workspace persistent --issue <issue> --repo <repo_id> --root-repo "<root>"
```

Requirement 两种机制均追加 `--change-ref <change_ref>`。`--workspace native|persistent` 为必填机制参数，无隐式默认；各 Skill 固定传入自己的机制。新 Native 入口不使用旧 `--mode bug|requirement` 和 `--config`，业务类型从当前 Issue 的 `tfs.type` 获取，不新增 Runtime Mode 环境变量。第一阶段不实现 --workspace persistent；仅保留仍有实际消费者的旧入口与调用契约，不扩建兼容层，消费者迁移完成后删除。

内部直接复用现有授权逻辑（assertBugExecution、assertBugStart、assertBugSource、guardRepository），确认 Repository Scope 与仓库映射后，再按 workspace 参数执行 Native Checkout 或现有 Worktree 算法。不新增 Provider、Router、Adapter Factory、额外 Gate。Unsupported Issue 类型明确拒绝。

Requirement 成功准备业务工作树后，沿用现有 verify_agent.required 投影规则（缺失才写入，已有冲突继续由现有 Guard 处理），Native 与 Persistent 共用，不在 Skill 内重复定义。保留 PASS/FAIL/UNKNOWN、实际 path 等必要结果及既有失败语义。

### 6.2 交付命令兼容

| 命令 | 最小改造 |
| --- | --- |
| bug git | 沿用已核实 root/repo_path，接受当前 Task Native linked worktree；本地 Task Branch 与远端 Candidate 解耦，保留受控 fetch / 非强制 push |
| bug pr-prepare | 沿用直属子仓路径；核验实际 Native 工作树、仓库身份、当前授权、候选及远端 SHA，不强制独立 .git 目录或本地与远端分支同名 |
| dev pr-prepare | Spike 证明 Native 目录满足现有 hub/.git 存在约束，静态判断与 Candidate Validation 兼容；先实际验证现有命令，复用 --validation-cwd，只修真实不兼容点，不预先重构 |
| pr materialize | 第一阶段确保 Native 不触发 Rondo Worktree 回收，保留现有 Requirement 回收路径；第二阶段再将回收通用化为 Bug / Requirement 的 Persistent Worktree 回收 |

Spike 已验证现有 root/repo_path 目录契约，第一阶段默认不新增 --repo-dir 等路径参数。Requirement 复用 --validation-cwd；只有实际路径缺口有证据时才补充最小输入。路径仅在当前 Run 中消费，不写路径 Metadata，不新增 Checkout Manifest。命令名以最新源码注册及实际 --help 为准：Spike 安装版 1.2.37 中 bug prepare-pr / dev pr-prep 与仓内命名有差异；核实后统一本次受影响调用，不借此重构命令体系。

保留实际 Git top-level、路径边界、Origin/Push URL、授权、候选身份和 SHA 校验；不得把仅凭 Origin 相同的其他 Issue 工作树当成本次工作树。Native 复用 `clients/native-checkout.ts` 中的 `platformTaskSuffix`、`isDaemonCacheWorktree`、`readDaemonTaskContext`、`assertPlatformCheckoutIdentity` 等适用能力，以及 Closeout 已有平台身份验证思路；核验当前 Task/Workspace、实际根仓与直属业务路径、Task Branch 和 cache 归属，不能仅凭 .git 文件或共用 cache 判定任务所有权。保持 `validateBusinessPath` 的路径/链接、根仓忽略与未跟踪检查；保留唯一 Origin/Push URL、实际 Git top-level 和授权校验。不新增身份系统。Persistent 的 Worktree 归属适配留第二阶段。移除不适用的独立 .git 目录及本地分支等于远端 Candidate 的条件，不删除必要校验。

保留 Bug feat/<tfs.id>、Requirement feature/<tfs.id> 及现有明确允许的 Bug 分支覆盖语义；不统一分支命名。Native 正式 Candidate 发布使用实际候选 SHA、安全非强制 Push（例如 HEAD:refs/heads/<candidate>）和远端回读；本地 Task Branch 不作为 PR Source Branch。保留现有 Commit Refs 尾注、Code Review、Regression、Blocking Findings、真实 Candidate Validation 及 Metadata 回读。

### 6.3 生命周期与恢复

第一阶段仅隔离 Native 与原有 Requirement Worktree 回收行为，禁止 Native 被 Rondo 清理；不重构回收算法。第二阶段将现有 Requirement Worktree 回收函数最小通用化，按已确认的本次交付工作树归属执行；仅处理能够确认的 Persistent 业务 Worktree，不能只凭 RONDO_WORKSPACE_PATH 存在或 .git 形态推断。Native 由 Multica 管理，不由 Rondo 回收。清理失败不改变已确认 PR 登记结果；保留 dirty/unpushed 及现有安全限制。不新增清理命令、Agent、状态或后台任务（若现有 materialize 参数不足，只补充实际必需的输入）。

- Bug REWORK / Requirement 返工：按已绑定机制续接已发布 Candidate，核实未发布本地工作。
- Bug RECREATE_PR：已有远端 Candidate 与既有交付事实满足条件时，不强制准备本地仓库。
- 多仓按实际需要分别准备；中断后重入原入口，不新增恢复流程。
- 无本地研发需求时，不强制准备工作区。

保持 PR Materialize、Delivery Closeout、TFS Writeback、OpenSpec Schema、根仓单 Change 发布和批准 SHA 等已有业务语义，不重构无关流程。

## 7. Registry 退役

两种 Skill 均不携带 repo-registry.json，不新增公共 JSON 副本或配置服务。

| 字段 | 权威来源 |
| --- | --- |
| multica_cli | MULTICA_CLI_PATH，默认 multica |
| multica_server_url | MULTICA_SERVER_URL |
| workspace_id | MULTICA_WORKSPACE_ID |
| rondo | CLI 本身 |
| 根仓 URL/ref | Project Resource（Native）；已配置常驻根仓（Persistent） |
| repo_id、repo_path | 权威 docs/config/repo-context.yaml |
| repo_url / 初始 Checkout ref | Native：已登记 Project Resource，仓库身份与现有映射核对；Persistent：权威 repo-context.yaml 与业务分支策略 |
| tfs_repo / tfs_project | 合法 TFS URL 解析，保留已有身份一致性校验 |
| default_target_branch | repo-context.yaml 显式业务分支策略 |
| 常驻根仓路径/分支 | RONDO_WORKSPACE_PATH / RONDO_WORKSPACE_BRANCH |
| 研发授权 / Scope | Multica Issue / 已批准 OpenSpec |

复用 [resolveMulticaRuntime()](../../rondo/src/clients/runtime-context.ts)，不查询 Delivery Squad。当前 Rondo repo-context.yaml 与 Registry 均包含 25 个业务仓，base 的目标分支均为 dev，但不能硬编码 dev 或将 Git Remote HEAD/Resource ref 当作交付目标分支。

在权威 repo-context.yaml 及对应全量清单增加 default_target_branch。实际内网业务根仓与 Rondo GitHub 配置仓不同，实施前必须核实所有目标根仓的已提交映射完整可读，不能假设已经存在。Requirement 使用可确认的批准版本对应映射，复用 analysis.source.commit，通过 `git show <approved-commit>:docs/config/repo-context.yaml` 获取（必要时从已核实的根仓 Fetch 该版本）。不扩大 readAnalysisArtifact() 的 Change 路径范围，不新增 Snapshot Artifact。Bug 使用可确认的根仓已提交映射。当前 repo-context.yaml 为工作区子集，.example 为全量清单；不自动回退、不猜测缺失映射。实施前确认实际业务根仓已提交映射及批准版本满足要求，旧批准版本缺字段时不得悄悄改变已批准仓库身份；切换前确认适用的现有在途任务，不新增永久兼容层。其余仍消费 Registry 的 Skill 保持原输出契约，Workspace Sync 从同一权威字段渲染，避免 base/YAML 双写。仅核对实际参与交付的仓库身份与目标分支，确保准备、PR Preparation、Materialize 一致；不建立全量配置对账机制。

第一阶段先使 Native dev prepare 不依赖 --config；现有 Guard 可在内部消费相同的数据结构，保持 Scope 和 Runtime 校验。native-workspace 不注入 JSON；仍有旧 Skill 消费者时保留现有 REPO_REGISTRY_SKILLS 中 workspace-preparation 的渲染，确认全部迁移后再移除该条目及文件。第二阶段 persistent-workspace 同样不注入 JSON。复用现有同步/供给能力完成新 Skill 绑定和旧 Skill 解绑；旧远端 Skill 是否需显式退役须核实，不能假定 unmanaged Skill 会被自动删除。

本次不是全局 Registry 退役。其他交付命令如仍需要 Registry，可继续消费既有配置，除本次必要的路径、授权、目标分支一致性适配外不扩大范围。

## 8. 分阶段交付计划（Native 优先）

### 第一阶段：完成 native-workspace

目标：Native 独立完成 Bug Fix、Workitem Analyst、Engineer 的实际交付闭环，可单独部署，不依赖 Persistent 改造。

| 步骤 | 实施内容 |
| --- | --- |
| 1.1 Native 最小 Spike（已完成） | 见 validation/native-workspace-spike-20261124.md；基础能力通过，明确 Kept 不切换 ref 与 Bug 结构性不兼容；无需再次大范围 Spike |
| 1.2 Native 准备入口 | 复用现有 Runtime、Resource 信息、Repository Mapping 和业务授权；实现 dev prepare --workspace native，不需要 Skill Registry JSON；保留 Requirement verify_agent.required 投影 |
| 1.3 交付最小适配 | 重点修复 Bug Git/PR Preparation；Requirement PR Preparation、根仓 OpenSpec 发布先验证现行实现，仅修真实不兼容点；Native 不执行 Rondo Worktree 清理；不改原有 Worktree 算法及回收机制 |
| 1.4 Skill 与部署 | 新增 native-workspace/SKILL.md；更新实际受影响的 Agent Instructions、bug-delivery、change-development、Provisioning 及 Sync；在目标部署完成原生绑定替换 |
| 1.5 回归与真实验证 | 验证 Native Bug、Native Requirement 两条完整交付链及 Workitem Analyst 根仓/OpenSpec 链；确认旧部署未被破坏，满足验收后独立交付第一阶段 |

第一阶段必要的 Registry 优化仅限 Native 准备不依赖 Skill JSON、权威映射及实际参与仓库的目标分支一致性；不提前迁移其他 Skill 的全部配置，不因未来 Persistent 需要而新增数据或公共抽象。

第一阶段明确不实施：persistent-workspace Skill、--workspace persistent、通用化 Worktree 准备算法、Bug Worktree、通用 Worktree 回收、双新 Skill 动态绑定机制。保留尚有消费者的旧入口、旧 Skill、JSON 及 Worktree 行为；若旧路径已无消费者，按实际情况退役，不为历史兼容长期保留。

剩余未验证项直接纳入第一阶段研发和回归，按实际事实处理；不默认增加 Clone/Worktree 兜底。未完成真实交付验证，不宣称 Native 已完成或切换未经验证的部署。无真实 Runtime/测试写入授权时，先完成代码及可运行测试，记录实际阻塞与待执行验证，不虚构 PASS 或修改正式 Issue。

### 第二阶段：完成 persistent-workspace

第一阶段 Native 交付稳定后，结合真实 Persistent 使用需求推进：

| 步骤 | 实施内容 |
| --- | --- |
| 2.1 Persistent 准备 | 复用 runtime prepare-root 与现有 requirement-worktree.ts，按实际差异通用化为 Bug / Requirement 业务 Worktree，提供 --workspace persistent |
| 2.2 交付与生命周期 | 复用第一阶段已完成的实际路径及候选校验；补充确有需要的 Persistent 归属核验与现有回收函数通用化 |
| 2.3 Skill 与绑定 | 新增 persistent-workspace/SKILL.md，按实际 Workspace 需求配置互斥绑定 |
| 2.4 回归与退役 | 验证 Persistent Bug、Persistent Requirement、Workitem Analyst，并回归 Native；退役仍保留的旧 workspace-preparation 及其 Registry/旧入口（确认无消费者） |

两个阶段均独立验收、独立交付。阶段是实施顺序，不是运行时 Gate、状态机或新的系统机制。只修改实际需要的代码和契约，不机械重写清单。

## 9. 分阶段验收标准

### 第一阶段 Native

- 复用 Spike 的已登记根仓、多业务仓、Task 隔离、首次 Candidate 续接、untracked 保护及测试分支发布证据；补足改造后原生输出解析（首次、Kept、失败/不明）、同 Task Candidate 基线相容/不相容、未发布 Commit 保护和 fetch_error 等回归。没有真实证据的场景不标记实测 PASS。
- Native Bug 与 Native Requirement 两条交付链通过首次准备、重入、多仓及部分失败、Candidate 发布、真实验证、PR Preparation、PR Materialize、返工恢复；Bug RECREATE_PR 不强制 Checkout。
- Workitem Analyst 可独立准备根仓和发布 OpenSpec；Requirement 保留批准源 SHA、原发布目标及 verify_agent.required 投影。
- native-workspace 无 Registry JSON，新 Native prepare 无 --config；实际参与仓库的映射、授权、目标分支、Origin、Push URL、候选 SHA 及路径边界正确。
- Native 不由 Rondo 创建额外 Clone/Worktree 或回收 Native Checkout；原有 Worktree 流程及未迁移部署保持可用。
- 目标 Workspace 仅绑定 native-workspace，不同时绑定旧准备 Skill；再次 Provisioning 不恢复错误绑定；已迁移专业 Skill 的现行调用契约正确。
- Build、相关回归及真实 Multica/TFS 验证通过。Persistent 未实施不影响第一阶段验收。

### 第二阶段 Persistent

- Persistent Bug / Requirement 两条路径及 Workitem Analyst 根仓路径通过验证；常驻根仓和按 Issue 隔离的业务 Worktree 正确复用、续接、安全回收。
- 复用 Native 阶段已完成的授权及交付适配，保持批准与候选校验，不引入无需求的公共框架。
- persistent-workspace 无 Registry JSON；两种机制在各自部署中互斥绑定，Native 回归无退化。
- 确认无旧消费者后删除原 workspace-preparation、其 Registry 注入和旧准备入口；其他 Skill 配置、PR Status Sync 和 TFS Writeback 不受影响。

## 10. 非目标

不新增 Skill Router、Workspace Manager Agent、Workspace Provider/Adapter Factory、Runtime 管理层、RONDO_WORKSPACE_MODE、RONDO_REGISTRY_PATH、Registry Service、配置缓存、路径 Metadata、每 Issue 配置快照、全 TFS 仓库发现、额外 Gate 或状态机。

不统一 Bug/Requirement 专业交付流程或远端分支命名，不改 OpenSpec Schema，不重写 Git 算法，不扩散至全局 Registry 退役、PR Status Sync 或 TFS Writeback。

**最终设计：两个完整且互斥绑定的 Skill（native-workspace / persistent-workspace），两种完整仓库管理机制，共用现有工程事实与业务授权/交付契约。**
