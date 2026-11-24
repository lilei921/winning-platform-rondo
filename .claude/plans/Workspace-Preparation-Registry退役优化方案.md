# Workspace 管理机制解耦与 Registry 退役优化方案

> 状态：已确认设计方向及 Skill 命名，待实施与真实 Runtime 验证。2026-11-24。
> 依据：[01 统一设计规范](../../01-multica-openspec-design-guideline.md) v1.16.13；原始分析基线 main Tree `0fb95275b6ffc6bcfb086fe797ac2a2790222740`。
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
- 退役原 `workspace-preparation` 及其 Registry JSON，不复制给新 Skill。

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
- [workspace-config/provisioning.json](../../workspace-config/provisioning.json)：现有三个 Agent 绑定 workspace-preparation，默认 Project Resource 主要登记根仓。

## 3. Native Workspace

### 3.1 根仓

复用当前 Task 的 Native Checkout；首次在 Task workdir 执行：

```powershell
multica repo checkout <root-url> --ref <resource-ref>
rondo runtime check-checkout --root-repo "<actual-root>"
```

URL 与 ref 来自 Project Resource；未指定 ref 时省略参数。使用实际返回路径。check-checkout 仅描述本地就绪检查，不增加额外身份机制。根仓 Checkout 起点、本地 Task Branch、OpenSpec 远端发布目标是不同概念，保留现有发布契约。

### 3.2 业务子仓

使用已授权 Repository 的 URL 和已核实的基线：

```powershell
multica repo checkout <business-repo-url> --ref <base-ref>
```

在已就绪根仓目录下按需准备业务仓，实际路径以 Multica 返回为准，不推测目录，不由 Rondo 额外创建 Clone 或 Worktree。

远端 Candidate 已存在时从已核实 Candidate 继续；首次从明确的目标分支开始。Native Task Branch 不必与远端 Candidate 同名。保留候选续接、实际 HEAD、Origin、授权、非强制发布、远端 SHA 回读等已有交付要求。

Multica 管理本地工作区及其生命周期，Rondo 负责必要的确定性校验和正式 Candidate 发布，不重建平台 Checkout / Cache / 清理机制。已有 Checkout 的 kept / fetch_error 等结果不能直接等同于最新基线，不覆盖本地 WIP。

真实 Runtime 必须验证 TFS URL/凭据、业务仓是否需要 Project Resource 登记、嵌套 Checkout、重复 Checkout、Candidate 续接及 Native 本地工作树与交付兼容。未验证前不得认定完整 Native 路径已可用。

## 4. Persistent Workspace

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
rondo dev prepare --issue <issue> --repo <repo_id> --root-repo "<root>"
```

Requirement 继续提供必要的 --change-ref 或复用当前 Issue 已批准的明确引用，具体最小接口在实施时确认；业务授权与准备方式分别处理。复用现有 requirement-worktree.ts 核心算法，按既有业务候选分支传参，抽取通用业务 Worktree 准备能力。不新增 Workspace Provider 框架。

Rondo 负责已确认交付后的业务 Worktree 回收，适用于 Bug 与 Requirement；保护 dirty/unpushed 等未交付内容，不让清理失败改变已确认的 PR 登记结果。共享常驻根仓本身不具备按 Issue 的 OpenSpec 隔离，保留现有根仓发布及并发约束，不另建机制。

## 5. Skill 绑定及内容

通过现有 Multica 原生 Skill 绑定在部署时选择一种机制，同一 Workspace 的研发成员一致采用该机制。不让 LLM 根据业务类型或临时情况选择管理机制，不同时挂载两种 Skill。

| Agent | Native 部署 | Persistent 部署 |
| --- | --- | --- |
| Bug Fix Agent | native-workspace | persistent-workspace |
| Workitem Analyst | native-workspace | persistent-workspace |
| Engineer | native-workspace | persistent-workspace |

Agent Instructions 不硬编码具体机制，例如：

> 需要本地根仓或业务源码时，按需使用已绑定的工作区准备 Skill，以核实的实际路径开展工作。

Workitem Analyst 可仅描述本地 OpenSpec 根仓需求。专业交付 Skill 不重复定义 Checkout、Clone 或 Worktree 算法，不固定 Skill 调用链。

### native-workspace 目标内容

- Description：按需使用 Multica 原生机制准备或复用工程根仓和授权业务仓。
- 根仓：Project Resource URL/ref、Native Checkout、实际路径、根仓就绪检查。
- 业务仓：按需准备已授权仓库，使用已核实的起始 ref、实际 Checkout 路径，消费现有确定性校验与发布入口。
- Result：使用确认成功的实际路径，核实异常并保护已有工作成果。

### persistent-workspace 目标内容

- Description：按需准备或复用常驻工程根仓及按 Issue 隔离的授权业务 Worktree。
- 根仓：rondo runtime prepare-root。
- 业务仓：统一业务 Worktree 准备入口，Requirement 提供必要批准引用，使用实际返回路径。
- Result：使用确认成功的实际路径，核实异常并保护已有工作成果。

两个 Skill 不新增 config、modules、references、scripts，当前规模不需要。正式命令以兼容改造后的 CLI 为准，不提前在生产 Skill 中写入未实现命令。

## 6. Rondo CLI 解耦与交付兼容

- Issue 类型只决定授权、专业处理、交付事实；保留 assertBugExecution、assertBugStart、assertBugSource、guardRepository、批准 Change 和 Verify 决策投影等已有语义。
- Native 由 Multica 创建本地工作树；Persistent 复用现有 Worktree 算法。CLI 不按 Bug/Requirement 决定本地机制，不建立新动态路由层。
- Bug 的 feat/<tfs.id> 与 Requirement 的 feature/<tfs.id> 本次先保留；远端分支命名统一不在本次范围。
- Bug fetch/push、PR Preparation 与 Requirement PR Preparation 消费真实工作树路径、Git Repository Identity、Candidate SHA 和已批准/授权 Scope，不强制特定 .git 形态或本地分支等于远端候选分支。必要时新增最小显式路径参数，优先复用已有参数。
- Native 正式发布 Candidate 使用安全非强制 Push 和远端 SHA 回读；已有远端 Candidate 优先续接，不从目标分支覆盖已交付修改。
- Worktree 清理按管理机制归属：Native 由 Multica，Persistent 由 Rondo，沿用已确认 PR 登记后清理的契约。
- 保持 PR Materialize、Delivery Closeout、TFS Writeback、OpenSpec Schema 及现有业务交付语义，不进行无关重构。

## 7. Registry 退役

两种 Skill 均不携带 repo-registry.json，不新增公共 JSON 副本或配置服务。

| 字段 | 权威来源 |
| --- | --- |
| multica_cli | MULTICA_CLI_PATH，默认 multica |
| multica_server_url | MULTICA_SERVER_URL |
| workspace_id | MULTICA_WORKSPACE_ID |
| rondo | CLI 本身 |
| 根仓 URL/ref | Project Resource（Native）；已配置常驻根仓（Persistent） |
| repo_id、repo_path、repo_url | 权威 docs/config/repo-context.yaml |
| tfs_repo / tfs_project | 合法 TFS URL 解析，保留已有身份一致性校验 |
| default_target_branch | repo-context.yaml 显式业务分支策略 |
| 常驻根仓路径/分支 | RONDO_WORKSPACE_PATH / RONDO_WORKSPACE_BRANCH |
| 研发授权 / Scope | Multica Issue / 已批准 OpenSpec |

复用 [resolveMulticaRuntime()](../../rondo/src/clients/runtime-context.ts)，不查询 Delivery Squad。当前 Rondo repo-context.yaml 与 Registry 均包含 25 个业务仓，base 的目标分支均为 dev，但不能硬编码 dev 或将 Git Remote HEAD/Resource ref 当作交付目标分支。

在权威 repo-context.yaml 及对应全量清单增加 default_target_branch。实际内网业务根仓与 Rondo GitHub 配置仓不同，实施前必须核实所有目标根仓的已提交映射完整可读，不能假设已经存在。Requirement 使用可确认的批准版本对应映射，复用 analysis.source.commit，不新增 Snapshot Artifact。Bug 使用可确认的根仓已提交映射。其余仍消费 Registry 的 Skill 保持原输出契约，Workspace Sync 从同一权威字段渲染，避免 base/YAML 双写，核验准备基线与 PR Target 一致。

移除 dev prepare 对 --config 的依赖；现有 Guard 可在内部消费相同的数据结构，保持 Scope 和 Runtime 校验。移除 REPO_REGISTRY_SKILLS 中 workspace-preparation，不向新 Skill 注入 JSON。复用现有同步/供给能力完成新 Skill 绑定和旧 Skill 解绑；旧远端 Skill 是否需显式退役须核实，不能假定 unmanaged Skill 会被自动删除。

本次不是全局 Registry 退役。其他交付命令如仍需要 Registry，可继续消费既有配置，除本次必要的路径、授权、目标分支一致性适配外不扩大范围。

## 8. 分阶段实施

| 阶段 | 目标 | 最小实施范围 |
| --- | --- | --- |
| 1 | 解耦业务类型与工作区机制 | Registry 退役、通用 Worktree、实际路径消费、Bug Worktree 兼容 |
| 2 | Native 完整支持 | 根仓及子仓 Native Checkout、远端 Candidate 续接/发布、PR 兼容、真实 Runtime 验证 |
| 3 | Skill 收敛 | 注册 native-workspace / persistent-workspace，调整三个 Agent 的 Instructions 和绑定，退役 workspace-preparation |

阶段实施期间保留仍在使用的可用路径；两种目标机制具备相应验证结果后再切换部署和退役旧 Skill。不为未来维护永久双套兼容入口。

涉及文件：repo-context.yaml 及全量清单/实际业务根仓、dev/prepare.ts、prepare-workspace.ts、requirement-worktree.ts、requirement-guard.ts、bug/git.ts、bug/pr-prepare.ts、dev/pr-prepare.ts、pr/materialize.ts、两个新 SKILL.md、旧 workspace-preparation、三个 Agent Instructions、provisioning.json、workspace/sync.ts、受影响测试及 COMMANDS.md / 11、12 现行设计契约。只修改实际受影响的部分。

## 9. 验收标准

- 两种管理机制分别覆盖 Bug 与 Requirement；Workitem Analyst 按需准备根仓即可。
- 同一机制下根仓与子仓统一管理；Agent 仅绑定选定 Skill，Instructions 与具体机制解耦。
- 新 Skill 无 Registry JSON；dev prepare 无 --config；映射、目标分支、实际根仓及批准版本来源可核实。
- 四条组合路径（Native Bug、Native Requirement、Persistent Bug、Persistent Requirement）验证首次准备、重入、远端候选续接、真实路径、Git 发布及 PR Preparation/Materialize。
- 授权、批准 Scope、仓库身份、候选 SHA、Origin、路径边界、dirty/unpushed 保护不退化；不覆盖已有工作。
- Native 不重复创建或回收业务 Worktree；Persistent 按 Issue 隔离并按现有交付事实回收。
- 根仓 OpenSpec 发布目标及批准源 SHA 契约保持不变。
- Workspace Sync 不再生成旧 Registry，旧 Skill 解绑/退役和新绑定核实；其他 Skill 配置及交付收口不受影响。
- 运行 Build、相关回归测试及真实 Multica/TFS 环境验证；区分设计预期、代码测试和真实端到端结果。

## 10. 非目标

不新增 Skill Router、Workspace Manager Agent、Workspace Provider/Adapter Factory、Runtime 管理层、RONDO_WORKSPACE_MODE、RONDO_REGISTRY_PATH、Registry Service、配置缓存、路径 Metadata、每 Issue 配置快照、全 TFS 仓库发现、额外 Gate 或状态机。

不统一 Bug/Requirement 专业交付流程或远端分支命名，不改 OpenSpec Schema，不重写 Git 算法，不扩散至全局 Registry 退役、PR Status Sync 或 TFS Writeback。

**最终设计：两个完整且互斥绑定的 Skill（native-workspace / persistent-workspace），两种完整仓库管理机制，共用现有工程事实与业务授权/交付契约。**
