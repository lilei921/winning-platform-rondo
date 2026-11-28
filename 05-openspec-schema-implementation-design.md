# OpenSpec Schema Implementation Design（OpenSpec Schema 实施设计）

> Version: 1.5.5  
> Date: 2026-11-28  
> Scope: OpenSpec 工程契约、Schema、Artifact、Task、发布及归档。  
> 实施状态见 [07](07-multica-openspec-implementation-roadmap.md)。

<a id="openspec-schema-section-00"></a>
<a id="openspec-schema-section-01"></a>
<a id="openspec-schema-section-02"></a>

## 1. 定位与实施原则

OpenSpec 保存需要实施的 Requirement 的 Engineering Contract；Multica 保存交付事实及授权，Rondo 执行确定性校验和 Git/TFS 操作。直接 Bug Fix 与无工程增量的分析不强制创建 Change。不得为交付过程重复创建 OpenSpec Artifact、运行状态、报告或事实源。

本方案遵循 [01](01-multica-openspec-design-guideline.md)，专业分析见 [03](03-workitem-analysis-design.md)，研发与 PR 见 [04](04-engineer-development-design.md)，跨阶段生命周期见 [02](02-multica-delivery-lifecycle-design.md)。

<a id="shared-config-schema-rules"></a>
<a id="openspec-schema-section-03"></a>
<a id="openspec-schema-section-04"></a>

## 2. Schema 与项目结构

- 项目配置：[openspec/config.yaml](openspec/config.yaml)，通用默认 Schema 不等于本项目业务 Change 的选择。
- 需要工程变更时显式使用 `openspec new change <id> --schema <schema>`；选择 `corrective-change` 或 `intentional-change` 取决于实际工程意图，不由 TFS 类型或是否新增代码机械决定。
- 项目级 Schema、Template 是运行契约的实际定义，以 [openspec/schemas/](openspec/schemas/) 为准。Rondo 的 `openspec install-schema` 提供安装能力；当前项目实际可用 Schema 通过原生状态及 instructions 确认。
- 工件遵循原生 Schema 依赖和当前模板，以中文表达，保留专业标识与关键字。无需额外的工作流 DSL 或 Schema Registry。

<a id="openspec-schema-section-05"></a>

## 3. Change Identity 与 Repository Scope

- Change ID 为 kebab-case，末尾独立数字段等于正整数 TFS ID，例如 `fix-mapping-12345`。唯一身份由根仓、Change ID 及 `.openspec.yaml` Schema 确定。
- `rondo openspec resolve-identity` 按已有 Change 引用或 TFS ID 查找；ACTIVE_FOUND 复用；NOT_FOUND 且允许创建时才新建；ARCHIVED_FOUND、CONFLICT、INVALID 或无法确认时停止重复创建/修改，报告实际事实。
- `.openspec.yaml` 中 `x-repositories` 是已批准的业务仓授权范围。非空、唯一，使用完整 Git/TFS 仓库名称，必须对应当前 Project Resource，排除工程根仓。它不表示每个仓库都必须修改或创建 PR；实际 PR 由 `pr` 事实登记。
- Resource 的 label/url/ref 由 Multica 提供；不从 proposal 中解析授权、不从本地独立 Registry 恢复仓库范围、不复制该范围到 Issue Metadata。Root Resource、Issue Context 与 Checkout 的公共规则见 [01](01-multica-openspec-design-guideline.md)、[06](06-method-skill-library-implementation-design.md#native-workspace)。

```yaml
schema: intentional-change
x-repositories:
  - winning-dps-df-example
```

原生 OpenSpec 可能重写 Change metadata；必须验证实际版本对扩展键的保留，不以另建平行 Scope 解决未知行为。缺失或被改变时停止授权相关操作。

<a id="openspec-schema-section-06"></a>
<a id="section-6-3"></a>
<a id="openspec-schema-section-07"></a>

## 4. Artifact Graph 与最小工件

| Artifact | intentional-change | corrective-change |
|---|---|---|
| proposal.md | 必需 | 必需 |
| specs/**/*.md | 有规格增量时编写 | 有规格增量时编写 |
| design.md | 按需 | 无此 Artifact |
| tasks.md | 必需 | 必需 |

- Intentional：proposal 无依赖；specs、design 依赖 proposal；tasks 依赖 specs；apply.requires 为 tasks。
- Corrective：proposal 无依赖；specs 依赖 proposal；tasks 依赖 specs；apply.requires 为 proposal、tasks。
- 两种 Schema 的 apply 均跟踪 tasks.md。无规格级行为变化时可在 `.openspec.yaml` 使用 `skip_specs: true`；corrective 仅恢复实现且既有规格充分时可跳过 Specs。不要用 skip_specs 隐藏真实规格增量。
- Design 按跨模块、接口、数据、架构或实施风险实际需要决定，不强制为每次小改动生成。运行时 readiness 由原生 OpenSpec 状态及 Rondo 校验决定，不从文件数量推断。

实际定义：[intentional-change/schema.yaml](openspec/schemas/intentional-change/schema.yaml)、[corrective-change/schema.yaml](openspec/schemas/corrective-change/schema.yaml)。

<a id="openspec-schema-section-08"></a>

## 5. Template Contracts

**Proposal**：明确问题、实际证据、目标行为、范围及影响；corrective 明确 Expected/Actual、已确认根因或仍未知的边界、修复方向；intentional 说明业务意图、当前和目标行为。不得伪造已确认事实。Scope 机器授权仍由 Change metadata 持有。

**Specs Delta**：路径为 `specs/<capability-path>/spec.md`。已有 capability 使用准确路径，新路径使用 kebab-case。新增 capability 提供 `## Purpose`（至少 50 字符）。ADDED/MODIFIED Requirements 使用 SHALL/MUST，并包含至少一个可验证 Scenario；MODIFIED 给出完整目标 Requirement，保留未修改的 Scenario。REMOVED 给出 Reason、Migration；全部需要退役的 capability 已批准，且删除最后一条 Requirement 时按 Schema 使用 `retire_capabilities: true`。RENAMED 明确 FROM/TO 的准确标题，不制造冲突。遵循原生 Delta 语义。

**Design**：只记录实施需要的技术选择、边界及重要约束，不复制 Proposal、Specs 或 Tasks。

<a id="section-8-5"></a>
<a id="openspec-schema-section-09"></a>
<a id="section-9-4"></a>
<a id="task-identity-contract"></a>
<a id="openspec-schema-section-10"></a>
<a id="section-10-2"></a>

## 6. Tasks 与验证契约

tasks.md 是同一 Change 的工程任务列表，使用唯一数字编号（如 1.1、1.2），每项描述预期结果及验证方式；不按 Agent 类型、PR 数量或 TFS 子任务强制分组。验证包含必要任务级验证、按实际影响选择的 Change 级集成/回归/E2E，以及 Human 要求时的独立验收。独立验收不替代 Engineer 自身验证，不强制另建工件或固定角色。

批准后任务编号、正文及授权范围不变。任务复选框仅表示已实际完成；Human 明确豁免的未执行任务保持未勾选，以 `analysis.human_approval.waived_tasks` 作为豁免事实。需要实质调整任务或契约时重新获得授权。Native OpenSpec 的状态或 validate 成功不能单独证明交付完成。

<a id="task-progress-update"></a>
<a id="openspec-schema-section-11"></a>
<a id="section-11-1"></a>
<a id="openspec-schema-section-12"></a>
<a id="openspec-schema-section-13"></a>

## 7. 固定版本、修改权限与研发发布

| 操作 | Owner | 边界 |
|---|---|---|
| 准备及修订分析工件 | Workitem Analyst | 形成真实可审核契约；按反馈修改 |
| 提交 Human Review | Rondo openspec submit-review | 校验并发布本次 Change，记录固定来源 |
| 批准/豁免 | Human；Lead 按决定执行 workitem approve | 绑定确定的审核版本 |
| 读取批准版本 | Engineer / openspec read | 不以当前可变分支代替批准 Commit |
| 更新研发工件 | Engineer / openspec publish | 真实 Tasks 进度；允许明确的非实质性 Design 细化 |
| Archive | PR Status Sync / Rondo | PR 完成后按收口契约执行 |

`analysis.source` 记录 repo_url、branch、commit、change_ref；后续使用该固定版本。Engineer 执行 `rondo openspec publish` 发布当前 Change 的研发差异，非实质 Design 细化才使用 `--minor-design`。不得夹带其他 Change、不随意修改已批准内容；以 `dev.publication` 登记成功事实。授权、范围、发布和 PR 不重复维护。

<a id="openspec-schema-section-14"></a>
<a id="openspec-schema-section-15"></a>

## 8. Analysis Gate 与证据

正常审核使用 `rondo openspec submit-review`；最终 Gate 执行必要身份、Schema、Scope、工程工件及 OpenSpec Strict Validation，并在发布完成后登记可信审核来源。`rondo openspec validate` 用于按需诊断，不另设常规重复 Gate。确定性校验不替代专业判断。

当前 Gate Evidence 对 Change metadata、proposal、tasks、存在的 design 与 specs Markdown 计算工程契约证据；关联必要来源 metadata 与 change_ref。具体哈希、归一化和比较以 [gate-evidence.ts](rondo/src/commands/analysis/gate-evidence.ts) 和 [validate.ts](rondo/src/commands/openspec/validate.ts) 为准。机器校验失败或发布结果不确定不得推进审核。

专业依据、风险、剩余问题、验证建议与审查结论可通过工件或普通 Issue Comment 引用；无需强制额外 facts.json、ai_review、独立 Review/Handoff 文档。OpenSpec Engineering Contract 不承载 PR/TFS 交付状态。

<a id="openspec-schema-section-16"></a>

## 9. Archive Contract

仅 Requirement 在 PR 已确认完成后进入归档准备。以批准的 `analysis.source` 固定根仓及版本为基础，按 [02 §12](02-multica-delivery-lifecycle-design.md) 的收口顺序执行；使用 `rondo repo prepare-archive` 获取实际根仓。校验 Task 完成或真实批准豁免、适用验证与 PR 事实、当前契约和授权研发差异。

- 有 Delta Specs 时按原生 Archive 语义更新主规格；合法 skip_specs 时不制造规格变化。
- 仅提交当前 Change 的归档及适用主规格变化，不夹带无关修改。已有归档或部分成功时先核实外部事实，复用已成功动作。
- 归档/Commit/远端回读失败或 UNKNOWN 不得宣布完成；Issue done 还必须满足独立的 TFS Writeback / Complete 条件。
- 契约一致性检查按 [contract-files.ts](rondo/src/commands/delivery/contract-files.ts) 规范化文本（换行与 tasks checkbox），以实际代码约束为准。

<a id="openspec-schema-section-17"></a>
<a id="openspec-schema-section-18"></a>
<a id="openspec-schema-section-19"></a>
<a id="openspec-schema-section-20"></a>

## 10. 实现与验收

以 Schema YAML、模板及 [Rondo OpenSpec 实现](rondo/src/commands/openspec/) 为执行契约。验收覆盖：corrective 有/无 Delta；intentional 有/无规格级增量和必要 Design；跨仓 Scope；Change 唯一性、恢复及冲突；固定审批、未批准修改、真实 Task 进度与豁免；发布竞态、归档回读及错误恢复；扩展 metadata 的原生兼容。验收状态与剩余事项归 [07](07-multica-openspec-implementation-roadmap.md)。
