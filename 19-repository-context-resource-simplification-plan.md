# 19 — Repository Context 与 Multica Project Resource 职责收敛方案

日期：2026-11-27  
分析基线：dev @ dac6c332ad0893c488f00df3164345dddc8affad；2026-11-27 补充 Review（dev 实际源码及 docs/config/project-resources.yaml）  
状态：目标方案已确认，未实施。

## 1. 目标与原则

遵循 01 设计原则、First Principles、KISS、YAGNI、Native First、One Rule One Owner、Specialist Focus。以 Multica Project Resource 统一管理仓库配置及业务定位线索，取消独立运行时仓库映射和人为简写标识。Agent 负责语义决策，Skill 负责按需复用的方法，Rondo CLI 负责确定性校验、执行及交付事实管理。

| 职责 | 唯一权威来源 |
|---|---|
| 仓库业务职责及语义线索 | Project Resource 顶层 label；实际行为以源码为准 |
| 当前 Project 可用仓库、URL、初始版本 | Project Resource 的 resource_ref.url、resource_ref.ref |
| PR Target 的配置来源 | Project Resource 的 resource_ref.default_branch_hint（Rondo 交付契约） |
| Requirement 获批仓库范围 | 已批准 .openspec.yaml 的 x-repositories |
| Bug 研发范围 | 诊断结论及已固定 Bug Scope（如有） |
| 实际工作树 | Multica 原生 repo checkout 返回路径及当前 Git |
| 已准备及实际 PR、远端身份及分支 | 已有 pr Metadata 与 TFS 实际状态 |
| 根仓分析来源与归档 | analysis.source |

Resource 准入与 Issue 授权是不同职责。Resource 缺失或 Native Checkout 失败按实际异常处理；不得利用其他配置绕过当前 Project 的资源范围。原生 Checkout 可能回退 Workspace 资源，不据此扩大业务授权。

不新增 Skill、独立语义知识文件、Registry、Resolver Service、Gate、Metadata、Resource Snapshot、兼容层或同步服务。

**范围边界**：docs/config/project-resources.yaml 的内容修正由用户另行处理，不属于本方案实施工作包。现有 YAML 仅作为 Resource 配置准备或参考清单，不作为 Agent / CLI 运行时输入；不为它新增同步或生成机制。实施前以实际 Project Resource 核实字段可取得性及适用范围，不要求所有原仓库都登记到每个 Project。

## 2. P0：Resource label 与 Skill 收敛

### 2.1 业务语义直接使用 Resource label

使用 Resource 顶层 label 自然表达业务模块、前后端职责、常用别称及必要功能线索。当前 docs/config/project-resources.yaml 中的 label 粒度总体适用，例如：

- winning-dps-df-dataintegration：数据集成后端（又称集成调度、调度中心）：采集、ETL、数据同步、作业流程设计、任务调度、数据源、集群管理、执行引擎接入。
- winning-dps-df-dataintegration-web：数据集成前端（又称集成调度、调度中心）：ETL、数据同步、作业与集成流程设计、任务配置、数据源、集群及执行引擎相关页面与交互。

label 仅提供语义调查线索，不是授权规则、完整功能清单或确定性路由条件。不要求独立 responsibility、keywords、aliases、repo_type、not_responsible_for 字段，不进行机器关键词匹配。涉及多仓或职责交叉时，由 Agent 结合实际源码确定工程影响。

不创建 codebase-explorer/references/repository-context.md，不维护 label 的第二份运行时副本，不要求每次 Run 全文注入或重复读取 Resource。优先使用 Multica 原生已提供的 Project 上下文；实际验证 label 在无根仓 Checkout 的 Wayfinder / Analyst Run 中可完整取得。若不可取得，先核实原生查询能力及实际限制，不预建兼容层。

### 2.2 三个 Skill 的最小调整

仅替换当前执行场景中相关描述，保留其他有效职责、方法及必要边界：

- codebase-explorer — 定位归属：归属不明确时，参考当前 Project Resource 的仓库职责与业务描述，识别候选仓库；按需通过 docs/router/ 定位页面、接口和服务入口。结合源码核实实际行为，已有可靠证据直接复用。
- spec-preparation — Repository Scope：根据已确认的工程影响范围，在当前 Change 的 .openspec.yaml 顶层维护非空、去重的业务仓完整名称列表。不重复开展归属调查。
- native-workspace — 只读业务仓：需要本地调查时，从当前 Project Resource 获取仓库 URL 和初始 ref，使用 Multica 原生 Checkout 准备。研发业务仓：Requirement 依据已批准的 x-repositories 确定修改范围；Bug 依据诊断结论及已固定 Bug Scope（如有）确定范围。从 Project Resource 获取对应仓库 URL 和初始 ref。使用实际 Checkout 路径，保留 Candidate 续接、工作树复用和研发成果保护。

Agent Instructions 原则上不修改；其他 Skill 只同步实际受影响的命令参数及仓库名称示例。使用现有 workspace sync 下发变更，不增加固定 Skill 调用链。Instructions / SKILL.md 只描述当前有效契约，不陈述退役机制或迁移历史。

## 3. P1：完整仓库名称作为统一标识

原 repo-context.yaml 有 25 个业务仓，所有 repo_path 均等于 URL 中的真实仓库名称，亦均满足 winning-dps-df- + 原 repo_id。简写不提供独立价值。

统一 repo_id、repo_key 的值为完整 Git/TFS 仓库名称，保留既有字段名、x-repositories 字符串列表和 CLI --repo 参数。

```yaml
x-repositories:
  - winning-dps-df-dataintegration
  - winning-dps-df-dataintegration-web
```

```text
rondo pr prepare --repo winning-dps-df-dataintegration ...
```

从 Resource URL 的仓库路径段获取真实名称（按 URL 语义解码），不硬编码前缀，不引入别名映射。当前 Project 内名称须唯一；如同名对应不同 URL，则核实实际资源，不自动猜测。URL 仍是实际远端仓库身份；完整名称不是跨 Project 的全局唯一 ID。根仓角色不作为业务仓 Scope；依据实际根仓身份排除，而非仅禁止旧简写 root。

变更范围：OpenSpec 示例与解析消费者、CLI --repo、Bug Scope、PR Facts repo_key、交付完成和收口比较、相关配置及测试。现有 parseRepositoryScope 正则已支持完整名称，不新增 Schema。现有 migrate-repo-keys.ts 使用旧 pr_prep/current_pr 等结构，不直接复用或扩展为常驻兼容机制。

在途交付优先完成后统一切换；不得改写已批准 Change Commit。确需迁移时专项核实 Scope、Bug Scope、pr、finalize 数据并按实际需要重新审批受影响契约。已归档、完成、取消记录不批量修改，不双写新旧 ID。

## 4. P2：取消 Rondo 独立运行时仓库映射

### 4.1 字段收敛

| 当前映射字段 | 目标来源 |
|---|---|
| repo_id / repo_key | Resource URL 中完整仓库名称 |
| repo_url | resource_ref.url；已有交付使用已登记实际 URL |
| repo_path | 原生 Checkout 返回路径；已有工作树按实际原生布局及 Git 身份定位 |
| tfs_repo / tfs_project / tfs_collection | 从 TFS URL 获取，保留受控认证边界 |
| default_target_branch | resource_ref.default_branch_hint；已准备 PR 使用 pr.target_branch |
| repo_type、responsibility、keywords、not_responsible_for | Resource 顶层 label 中必要语义 |

Rondo 将 default_branch_hint 等价解释为 PR Target；这是 Rondo 交付契约，而非 Multica 自身强制 PR 策略。ref 仅表示初始 Checkout 版本，不作为 PR Target 的隐式回退。不硬编码 dev 或引入全局默认配置。需要确定目标分支时，若 hint 缺失或不能确定有效目标，按实际异常处理，不新增独立预检 Gate。

### 4.2 原生 Resource 与根仓身份

复用 runtime/root-git.ts 中 resolveProjectRootBranch 已有的 .multica/project/resources.json 读取、Project 身份与 URL 匹配机制。按实际调用需要提取最小共用读取逻辑，非 Task 场景按需使用可取得的原生 Project Resource 查询能力。不建设新通用服务或持久化 Registry，不依赖根仓 Checkout 才能读取 Resource。

runtime/root-git.ts 当前 assertRootLayout、rootGitUrls、目标分支目录检查及规范文件检查均存在旧 YAML 依赖；resolveProjectRootBranch 又间接调用 rootRepositoryUrl 读取 YAML。应一并移除：

- 删除根仓及目标分支必须包含 repo-context.yaml 的要求。
- 删除将该 YAML 纳入未提交规范文件检查的逻辑，保留真实 OpenSpec Schema / Specs / 根仓结构要求。
- 首次分析发布依据当前 Project Resource 与实际 Git Origin 确定根仓 URL、ref；已有分析、研发发布及归档依据 analysis.source 确定预期根仓身份及来源分支。
- 保留实际 Fetch / Push URL 与预期仓库身份一致性检查、现有 Native Task 边界及工程发布保护。

### 4.3 Scope 校验收敛

- analysis/repository-scope.ts 保留非空字符串列表、格式、去重；完整名称排除实际工程根仓。
- analysis/validate.ts 不再读取 YAML 校验成员关系。
- analysis/publish.ts 在现有首次或新分析发布路径，一次核对当前 Scope 中的完整仓库名称能对应唯一、适用的当前 Project Resource，排除根仓；删除固定 Git 版本 YAML 成员校验。不对已完成发布的幂等回读重复执行无关资源审计。
- dev/requirement-guard.ts 保留批准来源、批准 Scope 及当前操作仓库是否越界的检查，删除每次校验整个 Scope 是否仍存在于 Registry 的循环。
- 后续实际 Checkout、Git Fetch / Push、PR Prepare 仅核实当前操作涉及仓库的必要配置及真实身份，不重复审计全量 Resource，不从 label 推导授权，不新增 Gate。

### 4.4 研发及 PR 事实消费

| 阶段 | 消费的权威事实 |
|---|---|
| Native Checkout / Git Fetch / Push | 批准 Scope 或 Bug Scope、当前 Project Resource、实际 Git 工作树及 Candidate |
| PR Prepare | 当前操作仓库的 Resource、Candidate、必要工程验证及审查结果；登记现有 pr 事实 |
| Dev Publish / PR Materialize | 批准 Scope、研发发布事实、已准备 pr 的 repo_key、repo_url、source_branch、target_branch、candidate_commit 及必要验证事实 |
| PR Status Sync / Closeout | 已登记 pr、实际 TFS PR；归档依据 analysis.source |

具体变更：

- dev/native-prepare.ts：随消费者迁移删除 readNativeRepoMapping、parseRepoMapping、assertNativeDeliveryMapping、readApprovedRepoMapping；不再读取本地或远端固定 Commit 的仓库映射。
- dev/authorized-checkout.ts、dev/prepare-workspace.ts、dev/git.ts、pr/prepare.ts：使用实际 Resource 和 Git，保留授权、Candidate、TFS Server/Collection 认证、仓库身份、有效 PR Target、远端写入安全边界。复用现有 URL 解析及认证实现，移除独立路径映射和重复 TFS 字段校验。
- dev/publish.ts、dev/change-completion.ts、pr/materialize.ts：删除固定批准版 YAML 依赖，不再以 Registry 重新推导已准备 PR 的 URL 或 Target。复用受控 pr prepare 写入的事实，保留批准 Scope、实际候选、必要任务完成、验证、审查及 TFS 远端身份校验。核实恢复、重入及非 Agent 调用路径；不为已经具备全部事实的操作引入额外 Resource 依赖。
- pr/reconcile-status.ts、delivery/closeout-pr.ts 已通过 pr 的 repo_url、pr_id、source_branch、target_branch 回核实际 TFS PR，保持现有模式。

批准 Commit 固定工程契约，不需要固定整个仓库注册表。在途交付期间不将对应 Resource 指向不同仓库，不改变其 PR Target。已准备 PR 不因 label 或初始 ref 变化而重新推导交付配置。发生资源撤销、身份或目标分支实质变化时，按实际授权异常处理，不自行迁移或绕过授权。不引入 Resource Snapshot 或额外 Metadata。

本次不重构 PR 交付、Human Approval、Candidate Validation、Code Review、Task Completion、TFS 收口等无关机制。

## 5. P3：退役配置清理与统一切换

实际消费者迁移后，删除不再使用的 repo-context.yaml、repo-context.yaml.example、独立 repo-registry 生成配置、映射函数及仅为其存在的 CLI 参数；同步命令帮助、Skill 示例、实际受影响配置及测试。保留与仓库映射无关且仍有消费者的 runtime/TFS 配置。

删除前核查 workspace sync/provision、TFS Sync、repo_registry.py、docs/router、外部业务工程根仓及仍有实际用途的命令（包括 analysis publish 的 --registry-config）是否消费旧 YAML、Registry 或简写标识。外部仓库资产不属于本仓可直接删除范围；协调实际消费者后再清理。若有尚未迁移的真实消费者，明确记录并保留必要资产，不提前删除，也不新增长期兼容层。

不修改历史归档和回放记录，不修改 docs/config/project-resources.yaml。

## 6. 实施顺序与最小验收

P0/P1/P2/P3 为逻辑研发工作包，不新增运行流程阶段。先核实实际 Resource、原生字段取得方式与活跃交付情况，再按依赖实施 Skill、完整名称、CLI 迁移和清理；在途任务完成或明确处理后统一切换，不长期并行维护两套映射。

最小验收：

1. 实际 Runtime 可按需取得当前 Project Resource 的 label、url、ref、default_branch_hint；无根仓 Checkout 的 Wayfinder / Analyst 可使用 label 与源码定位仓库。
2. Requirement 以完整名称完成分析发布和批准；未登记或歧义仓库不能作为新的有效 Scope 发布；根仓不作为业务仓 Scope。
3. Requirement / Bug 的原生 Checkout、Git Fetch / Push、PR Prepare 正常，越权及真实仓库身份不符时拒绝受影响操作；无关 Resource 不影响当前仓库执行。
4. Dev Publish、PR Materialize、多仓交付、重入与 PR 恢复、PR Status Sync / Closeout 正常，已准备 PR 使用已登记实际事实。
5. 缺失所需 Resource 或 Target 时按实际操作报错；不新增重复 Gate。运行时交付链不再读取旧仓库 YAML 或独立 Repository Registry。
6. 现有 Skill 同步与必要回归测试通过。非必要不使用 GitHub Actions。

实际 Resource 配置内容修正由用户单独处理，不纳入本方案实施或文件变更。

## 7. 已核实证据与局限

- docs/config/repo-context.yaml：25 个业务仓，repo_path 等于 URL 仓库名称；旧 PR Target 均为 dev。
- docs/config/project-resources.yaml 已提供自然语言 label 示例，可承担原业务语义线索；该文件不是线上 Resource 实例，本方案不修正其内容。
- rondo/src/commands/runtime/root-git.ts:43-108、216-249：根仓布局、Origin、分支发布及规范检查依赖 YAML；resolveProjectRootBranch 已读取原生 Task Project Resource。
- rondo/src/commands/analysis/repository-scope.ts、validate.ts、publish.ts、dev/requirement-guard.ts：存在多阶段 YAML / Registry 成员校验。
- rondo/src/commands/dev/native-prepare.ts、authorized-checkout.ts、publish.ts、change-completion.ts、pr/materialize.ts：存在固定 Commit 映射读取及已准备交付事实与 Registry 的重复比较。
- validation/native-workspace-spike-20261124.md：未登记 common 的 Checkout 报错 repo is not configured for this workspace，Project Resource 中 frame 等可成功 Checkout。
- 原方案记录 replay 20261126 LEI-67/68 至少 6 次 Agent 直接读取、11 次 CLI 内部读取；日志截断可能低估。
- 尚未核实线上全部 Project Resource 实例、label 与 default_branch_hint 的实际下发、活跃 Issue、外部 YAML 消费者及所有 Agent 的实际配置。本次仅更新设计，不实施代码或线上配置变更。
