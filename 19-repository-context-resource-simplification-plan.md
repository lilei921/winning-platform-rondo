# 19 — Repository Context 与 Multica Project Resource 职责收敛方案

日期：2026-11-27  
分析基线：dev @ dac6c332ad0893c488f00df3164345dddc8affad  
状态：目标方案已确认，未实施。实施前核实实际 Resource 配置、在途交付及外部消费者。

## 1. 目标与原则

遵循 01 设计原则、KISS、YAGNI、Native First、One Rule One Owner、Specialist Focus。取消独立运行时仓库映射和人为简写标识，将确定性资源配置与 LLM 业务语义知识分离。复用 Multica 原生能力及已有交付事实，不新增 Skill、Registry、Resolver、Gate、Metadata、Resource Snapshot、兼容层或同步服务。

| 职责 | 唯一权威来源 |
|---|---|
| 仓库业务职责、必要边界与语义线索 | codebase-explorer/references/repository-context.md，实际行为以源码为准 |
| 当前 Project 可用仓库、URL、初始版本 | Multica Project Resource 的 url、ref |
| PR Target | Project Resource 的 default_branch_hint（Rondo 交付契约） |
| Requirement 获批仓库范围 | 已批准 .openspec.yaml 的 x-repositories |
| Bug 研发范围 | 诊断结论及已固定 Bug Scope（如有） |
| 实际工作树 | Multica 原生 repo checkout 返回路径及当前 Git |
| 实际 PR、远端身份及分支 | 已有 pr Metadata 与 TFS 实际状态 |
| 根仓分析来源与归档 | analysis.source |

Resource 准入与 Issue 授权是不同职责。Resource 缺失或原生 Checkout 失败按实际异常处理；不得利用其他配置绕过当前 Project 的资源范围。原生 Checkout 可能回退 Workspace 资源，取决于实际版本与配置，不据此扩大业务授权，不新增重复 Gate。

## 2. P0：业务语义知识与 Skill 收敛

### 2.1 唯一语义知识文件

在现有 codebase-explorer Skill 内直接维护 Markdown 附属文件：

```text
skills/codebase-explorer/
├── SKILL.md
└── references/
    └── repository-context.md
```

每个仓库以完整 Git/TFS 仓库名称为标题，正文用自然语言描述业务职责，融入有价值的原 keywords；只在存在归属混淆时说明必要的不负责范围。保留原 YAML 的有效语义，不要求独立 keywords、repo_type、not_responsible_for 字段，不引入匹配规则或机器解析契约。

示例：

```markdown
## winning-dps-df-dataintegration

数据集成调度后端，负责数据采集、ETL、作业流程设计、任务调度、数据同步、数据源、集群管理和执行引擎接入。

## winning-dps-df-dataintegration-web

数据集成调度前端，负责流程设计、调度中心、任务配置、数据源及执行引擎相关页面与交互。
```

Markdown 是业务语义知识的唯一维护源，不包含 URL、路径、TFS 项目、分支等运行时配置。无需将知识塞入 Resource label 或 Project description，无需每次 Run 全文注入。

复用现有 workspace sync 的普通 Skill 附属文件上传、差异检测和回读机制，不新增 YAML 投影、复制或生成逻辑。无需硬编码 Claude/Codex 路径。

### 2.2 三个 Skill 的调整

- codebase-explorer：业务归属不明确时，参考本 Skill 的 references/repository-context.md，结合实际源码确定候选仓库；按需使用 docs/router/ 定位入口，证据充分直接复用。仅以 Project Resource 确认可执行的仓库。
- spec-preparation：根据已确认的工程影响范围与当前 Project Resource，在 Change 的 .openspec.yaml 顶层维护非空、去重的完整业务仓名称列表；不重复调查归属，不读取根仓 YAML。
- native-workspace：只读业务仓按当前 Project Resource 获取 URL 和初始 ref；研发 Requirement 以批准 x-repositories 为范围，Bug 按诊断及已固定 Bug Scope（如有），从 Resource 获取 URL、ref；使用原生 Checkout 返回的实际路径，保留必要的 Candidate 复用和研发成果保护。删除两处 YAML 引用。

不修改 Agent Instructions，不新增强制 Skill 调用链或 Resource Gate。验证 Skill 文件同步、重复同步无变化、文件更新正常下发及无根仓 Checkout 时可按需读取。实际 Runtime 下发需验证。

## 3. P1：完整仓库名称作为统一标识

当前 YAML 有 25 个业务仓（逐条核实，修正此前 24 个的统计），所有 repo_path 均等于 URL 中的真实仓库名称，亦均满足 winning-dps-df- + 原 repo_id。简写不提供独立价值。

统一 repo_id、repo_key 的值为完整 Git/TFS 仓库名称，保留既有字段名、x-repositories 字符串列表和 CLI --repo 参数。

```yaml
x-repositories:
  - winning-dps-df-dataintegration
  - winning-dps-df-dataintegration-web
```

```text
rondo pr prepare --repo winning-dps-df-dataintegration ...
```

从 Resource URL 的仓库路径段获取真实名称（按 URL 语义解码），不硬编码前缀，不引入别名映射。当前 Project 内名称须唯一；如同名对应不同 URL，则核实实际资源，不自动猜测。URL 仍是实际远端仓库身份；完整名称不是跨 Project 的全局唯一 ID。根仓角色不作为业务仓 Scope。

变更范围：OpenSpec 示例与解析消费者、CLI --repo、Bug Scope、PR Facts repo_key、交付完成和收口比较、相关配置及测试。现有 parseRepositoryScope 正则已支持完整名称，不新增 Schema。现有 migrate-repo-keys.ts 使用旧 pr_prep/current_pr 等结构，不直接复用或扩展为常驻兼容机制。

在途交付优先完成后统一切换；不得改写已批准 Change Commit。确需迁移时专项核实 Scope、Bug Scope、pr、finalize 数据并按实际需要重新审批受影响契约。已归档、完成、取消记录不批量修改，不双写新旧 ID。

## 4. P2：取消 Rondo 独立运行时仓库映射

### 4.1 字段收敛

| 当前映射字段 | 目标来源 |
|---|---|
| repo_id | Resource URL 中完整仓库名称 |
| repo_url | resource_ref.url |
| repo_path | 原生 Checkout 返回路径；已有工作树按实际原生布局及 Git 身份定位 |
| tfs_repo | 从 TFS URL 获取 |
| tfs_project | 从 TFS URL 获取 |
| tfs_collection | 从 TFS URL 获取，保留受控认证边界 |
| default_target_branch | resource_ref.default_branch_hint |
| repo_type、responsibility、keywords、not_responsible_for | 必要语义融入 repository-context.md |

Rondo 将 default_branch_hint 等价解释为 PR Target；这是已确认的交付契约，不是 Multica 自身强制 PR 策略。ref 仅表示初始 Checkout 版本，不作为 PR Target 的隐式回退。当前 25 个业务仓旧 default_target_branch 均为 dev，但不将 dev 硬编码或新增全局默认配置；实施前核实各实际 Resource 的 default_branch_hint 已正确填写。需要 Fetch 目标分支或创建 PR 时，若 hint 缺失或不能确定有效目标分支，按实际异常处理，不新增独立预检 Gate。

### 4.2 CLI 变更边界

- 复用 runtime/root-git.ts 中 resolveProjectRootBranch 已有的 .multica/project/resources.json 读取、Project 身份与 URL 匹配逻辑；按实际调用需要使用原生 Project Resource 查询能力，不建立新的通用服务或持久化 Registry。
- analysis/repository-scope.ts、analysis/validate.ts、analysis/publish.ts：删除基于 YAML 的重复成员校验及 Git 读取。保留 Scope 格式、批准边界及实际执行所需资源定位；不新增重复的 Resource Gate。
- dev/native-prepare.ts、dev/authorized-checkout.ts、dev/prepare-workspace.ts、dev/git.ts、pr/prepare.ts：不再从固定根仓 Commit 读取业务仓映射；使用 Resource、实际 Checkout、Git Origin 和 default_branch_hint，保留实际授权、Candidate、远端写入安全边界。移除不再使用的路径映射及重复 TFS 字段校验；复用已有 URL 解析和受控认证实现。
- dev/publish.ts、dev/change-completion.ts、pr/materialize.ts：按需使用当前 Issue Project Resource、获批 Scope、现有 pr 事实，删除 readApprovedRepoMapping 等固定 Git 版本 YAML 依赖；核实恢复、重入及非 Agent 调用路径的 Resource 可取得性。
- pr/reconcile-status.ts、delivery/closeout-pr.ts 已通过现有 pr 的 repo_url、pr_id、source_branch、target_branch 回核实际 TFS PR；保持该模式，不引入新的 Resource 依赖。归档继续依据 analysis.source。
- 保留真正需要的批准 Scope、实际 URL、TFS Server/Collection 认证边界、Candidate Branch、PR Target 及 PR 事实校验。不再校验完整全局 Registry，不重复读取语义知识文件。

批准 Commit 固定的是工程契约，不需要固定整个仓库注册表。采用最小运行约定：在途交付期间不将对应 Resource 指向不同仓库，不改变其 PR Target；已记录 PR 按已有事实恢复与收口。资源身份发生实质变化时先核实受影响授权，不自行迁移。暂不引入 Resource Snapshot 或额外 Metadata。

### 4.3 清理退役配置

实际消费者迁移后，删除不再使用的 repo-context.yaml、repo-context.yaml.example、独立 repo-registry 生成配置、映射函数及仅为其存在的 CLI 参数。保留与仓库映射无关且仍有消费者的 runtime/TFS 配置。

删除前核查 Rondo workspace sync/provision、TFS Sync、工具 repo_registry.py、docs/router、外部业务工程根仓等是否仍消费旧 YAML 或标识。外部仓库资产不属于本仓可直接删除范围；协调实际消费者后再清理，不修改历史归档、回放记录。若存在尚未迁移的真实消费者，明确记录，不提前删除，也不为其新增兼容层。Markdown 无需生成型附件。

## 5. 实施顺序与验收

P0/P1/P2 为逻辑工作包，而非必须各自独立上线的阶段。优先盘点实际 Resource 和活跃交付，再按依赖实施：

1. 建立 Markdown 语义知识文件，使用现有 Skill 同步机制下发。
2. 统一仓库完整名称，调整 spec-preparation/native-workspace 与全部运行时消费者，核实 Resource 的 URL、ref、default_branch_hint。
3. 迁移 CLI 消费者后清理旧映射及无用配置，避免先删仍被消费的文件。
4. 验证 Wayfinder/Analyst 按需读取本地知识、Requirement/Bug 范围、原生 Checkout、Git Fetch/Push、PR Prepare/Materialize、PR Status Sync/Closeout；验证缺失 Resource/Target 时的实际错误与已有恢复行为。覆盖完整名称及跨仓交付，检查运行时交付链不再读取 YAML。

在途任务完成或明确处理后统一切换运行时契约；不长期并行维护两套映射。测试遵循最小充分，非必要不使用 GitHub Actions。

## 6. 已核实证据与局限

- docs/config/repo-context.yaml：25 个业务仓；repo_path、URL 仓库名称、TFS Project 一致，旧 PR Target 全为 dev。
- runtime/root-git.ts:90-108 已读取 Task Project Resource；dev/native-prepare.ts 与 analysis/repository-scope.ts 等仍有固定版本 YAML 依赖。
- pr/materialize.ts、delivery/closeout-pr.ts、pr/reconcile-status.ts 已从 URL 或 PR 事实获取 TFS 身份。
- validation/native-workspace-spike-20261124.md：未登记 common 的 Checkout 报错 repo is not configured for this workspace，Project Resource 中 frame 等可成功 Checkout。
- replay 20261126 LEI-67/68 至少 6 次 Agent 直接读取、11 次 CLI 内部读取，日志截断可能低估。
- 尚未核实线上所有 Project Resource 实例、活跃 Issue、外部 YAML 消费者及实际 Runtime 下发；本方案仅设计，不修改实现。
