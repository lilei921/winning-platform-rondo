# 19 — Repository Context 与 Multica Project Resource 职责收敛方案

日期：2026-11-27  
基线：dev @ dac6c332ad0893c488f00df3164345dddc8affad  
状态：设计方案已保存，未实施。完整仓库名称统一标识正式纳入本方案，实施前核实在途交付及切换条件。

## 1. 目标与原则

遵循 01 设计原则、KISS、YAGNI、Native First、One Rule One Owner。消除 Agent 对工程根仓 repo-context.yaml 的非必要读取及别名映射，不新增 Skill、Registry、Resolver、Gate、Metadata 或同步服务。

| 职责 | 权威来源 |
|---|---|
| 业务归属、职责、关键词、边界 | repo-context.yaml + 源码证据 |
| 当前 Project 可用的仓库、URL、初始 ref | Multica Project Resource |
| 当前 Requirement 获批仓库范围 | 已批准 .openspec.yaml 的 x-repositories |
| 工作树准备、实际路径 | Multica 原生 repo checkout |
| PR Target | 当前交付配置；不将 Resource ref 自动等同于 PR Target |

Multica 原生资源准入不能代替 Issue 的业务授权。Resource 缺失时按原生异常处理；不得利用 YAML 扩展当前 Project 的资源范围。原生 Checkout 是否回退 Workspace 资源取决于实际版本和配置；不新建重复 Gate。

## 2. P0：Skill 层最小充分改造

1. `rondo/src/commands/workspace/sync.ts`：复用现有生成文件和 skill files upsert 能力，将唯一维护源 `docs/config/repo-context.yaml` 下发到 `codebase-explorer/references/repo-context.yaml`。只对同步范围中的 codebase-explorer 生成；沿用既有差异检测与回读机制。附属文件不单独人工维护，不写死 Claude/Codex 路径。
2. `skills/codebase-explorer/SKILL.md`：归属不明确时，读取本 Skill 的 references/repo-context.yaml，依据职责与边界确定候选仓库；按需通过 docs/router/ 定位入口。证据充分直接复用。
3. `skills/spec-preparation/SKILL.md`：Repository Scope 根据已确认的工程影响范围和当前 Project Resource，在 Change 的 .openspec.yaml 顶层维护非空、去重的业务仓 repo_id 字符串列表。删除根仓 YAML 直接引用。
4. `skills/native-workspace/SKILL.md`：只读业务仓按 Project Resource 获取 URL 和初始 ref；研发 Requirement 以批准 x-repositories 为范围，Bug 按诊断及已固定 Bug Scope（如有），从 Project Resource 获取对应 URL 和初始 ref。删除两处 YAML 引用，保留 Candidate、Checkout 复用、研发成果保护及实际异常处理。

本阶段不改 Agent Instructions、Schema、Metadata 结构、原生 Checkout、CLI 交付授权和 PR Target。验证同步有附属文件、重复同步无变更、源文件变化正常更新、未选中 Skill 不生成、无根仓 Checkout 的 Agent 可读附属文件。实际 Runtime 下发需验证。

## 3. P1：完整仓库名称作为统一标识

### 3.1 选择理由

当前 24 个业务仓的 repo_id 均对应实际仓库名称，例如 dataintegration → winning-dps-df-dataintegration。简写只是人为别名，不提供独立业务语义。将 repo_id、repo_key 的值统一为完整 Git/TFS 仓库名称；保留字段名称、x-repositories 字符串列表、CLI --repo 参数。根仓 root 作为角色保留，不属于业务仓 Scope。仓库名称须在当前 Project 内唯一；如实际资源存在同名不同 URL，则不能直接按名称消歧，应停止并核实，不提前引入全局 ID 体系。

```yaml
x-repositories:
  - winning-dps-df-dataintegration
  - winning-dps-df-dataintegration-web
```

```text
rondo pr prepare --repo winning-dps-df-dataintegration ...
```

名称从当前 Resource 仓库 URL 的仓库路径段取得（使用实际 URL 语义，必要时解码）；不硬编码 winning-dps-df- 前缀，不增加别名兼容层。URL 仍为实际 Git 仓库身份，完整名称不是跨 Project 的全局唯一身份。

### 3.2 变更范围

- 仓库源配置：docs/config/repo-context.yaml、repo-context.yaml.example；同步 workspace-config/repo-registry.base.json 的 delivery 键及生成配置。核查工具、路由、Schema 示例、Skill、命令示例和测试中的旧标识。repo_path、repo_url、TFS 仓库实际名称不改。
- OpenSpec：x-repositories 值变更；repository-scope.ts 现有正则支持完整名称。仍保留非空、去重、业务仓范围与批准 Scope 校验。
- CLI：registry 查找键、--repo、Bug Scope、PR Facts 的 repo_key、交付完成和收口比较统一使用完整名称。检查硬编码示例和相关测试。现有 migrate-repo-keys.ts 使用旧 pr_prep/current_pr 等结构，与 dev 当前 pr 对象不一致，不直接复用或扩展为常驻兼容机制。
- 交付状态：已批准 Change 的 Commit 不改写；已有活跃 Issue 的旧 Scope / Bug Scope / PR / finalize 数据须一致处理。优先在旧交付完成后整体切换；若必须迁移在途任务，需专项核实并重新审批受影响契约，不仅改 Metadata。已完成、取消和归档历史不批量修改。不要双写新旧 ID。
- Multica Resource：不重建仓库资源，不变更真实 URL、ref、权限或资源 ID；需实测当前 Project Resource 提供的 URL、实际 Checkout 和同名情况。

### 3.3 实施顺序

优先盘点所有活跃交付并完成或暂停在途任务，再一次性修改配置、生成物、契约示例、运行时消费者和测试，同步 Skill 后启用新版。P0 可独立实施，不等待命名切换。P1 不与删除 CLI 映射耦合为一个大改造。

## 4. P2：CLI 内部 YAML 依赖单独收敛

当前源码：
- analysis/repository-scope.ts、analysis/validate.ts、analysis/publish.ts：YAML 成员校验。
- dev/native-prepare.ts：从固定 Git Commit 读取 URL、路径、TFS 身份、PR Target。
- dev/authorized-checkout.ts、dev/git.ts、pr/prepare.ts：通过上述映射验证实际工作树与授权仓库。
- dev/publish.ts、pr/materialize.ts：通过 readApprovedRepoMapping 读取批准版本映射。

完整仓库名消除别名转换，但不自动消除 PR Target 或固定版本身份需求。先明确 Resource 版本与实际身份、PR Target 来源、非 Agent/Autopilot 场景可取得的数据，再删除重复成员关系校验和读取。保留批准 Scope、实际 URL、远端写入与 PR Target 的必要校验。不增加新 Registry、Resource Gate 或 Metadata 快照。当前阶段不实施。

## 5. 已核实证据与局限

- dev 上述 Skill 与 CLI 源码；24 个业务仓的现有 repo_id、repo_path 对应关系；所有业务仓当前 default_target_branch 为 dev，但不据此假定 Resource ref 等价。
- validation/native-workspace-spike-20261124.md 记录未登记 common 的 Checkout 报错 repo is not configured for this workspace；Project Resource 中 frame 等可成功 Checkout。
- replay 20261126 LEI-67/68 可证实至少 6 次 Agent 直接读取、11 次 CLI 内部读取；工具结果截断，实际次数可能更多。
- 当前未核对线上各 Project Resource 实例、活跃 Issue 状态或 Runtime 下发实测；未修改实现。
