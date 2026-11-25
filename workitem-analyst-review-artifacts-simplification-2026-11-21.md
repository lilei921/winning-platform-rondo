# Multica + OpenSpec 过程工件精简与交付事实归属方案

> 状态：设计目标态，待研发实施；**本文档不代表代码已修改或 E2E 已通过**  
> 日期：2026-11-21  
> 规范依据：[01-multica-openspec-design-guideline.md](01-multica-openspec-design-guideline.md)，特别是第 1.2、1.3、1.6 节  
> 对照样本：`2026-11-20-knowledge-job-system-name-filter-265593`、`2026-11-20-knowledge-query-validation-266607` 的用户提供的归档目录清单  
> 原则：KISS、YAGNI、Specialist Focus、Native First、One Rule One Owner、Reference not Replication、Outcome First、Minimal Sufficient  
> 边界：**暂不以 02–12 历史方案作为新增工件的必要性依据**；仅把当前 Rondo 源码当作需要改造的现状，不把现有文件依赖误认为目标架构的必要性

## 1. 最终决策

**OpenSpec Change 只保存真正需要长期消费的 Engineering Contract；Review、Gate、Handoff、Validation、PR Preparation 等运行/交付事实不因为发生过就生成同名 Markdown/JSON。**

已确认六项目标态：

| 序号 | 当前文件/事实 | 目标态 | 权威 Owner |
| --- | --- | --- | --- |
| D1 | `ai-review.md`、`ai_review.verdict`、必填 `findings_ref` | **只保留 Intentional 的 `analysis.ai_review.verdict`**；无独立 Review 文件，不再强制 Findings 文件引用 | Multica Issue Metadata |
| D2 | `analysis-handoff.json` | **不提交、不归档**；Analysis Facts 直接使用已有 Multica Metadata；如执行工具需要结构化输入，只做非持久化输入 | Multica |
| D3 | `evidence.md`、`evidence/` | **不生成通用 Evidence 文件**；代码、OpenSpec、Issue、运行/测试事实用稳定引用连接，必要根因/业务事实写进现有 Artifact | OpenSpec / Git / 原始来源 |
| D4 | `logs/analysis-gate-result.json` | **保留真实 Analysis Gate，不保存 Gate JSON 到 OpenSpec**；失败返回原因，通过后将 PASS 与固定 `analysis.source.commit` 绑定 | Rondo 校验；Multica 保存结果 |
| D5 | `evidence-<repo_id>.json` | **不提交、不归档**；保留每仓 Candidate、实际 Validation、Code Review、Blocking Finding 等最小可核实的交付事实 | Git + Multica Runtime |
| D6 | `pr-description-<repo_id>.md` | **不提交、不归档**；从现有权威数据形成描述，PR 创建时交给 TFS，最终描述由 TFS PR 持有 | TFS PR |

另保留原方案的 Human 改进：当前 Multica Issue 向 Human 展示**一条简明、绑定固定 Git Commit 的审核摘要**，不额外生成 `analysis-summary.md`。

### 1.1 最小 OpenSpec 目标结构

```text
openspec/changes/<change_ref>/
├── .openspec.yaml
├── proposal.md
├── tasks.md
├── specs/                        # Schema/行为变化需要时
│   └── <capability>/spec.md
└── design.md                     # 有真实技术决策且适用时
```

具体 Artifact 由当前 OpenSpec Schema/Instruction 决定；**不为了压缩文件数而省略真正必要的 Specs、Design 或 Verification Tasks**。没有其他过程性目录或强制报告。OpenSpec Archive 保留相同的最小工程契约及原生归档结果。

### 1.2 依据 01 做 Owner 判断

- **Engineering Truth**：业务意图、行为差异、Root Cause / Fix Strategy、设计、任务与必要 Verification，写入 OpenSpec 原生工件。
- **Delivery Truth**：Review Verdict、Gate、Candidate、验证结论、Approval、PR/Issue 状态，优先写入 Multica 原生 Issue、Metadata、Run Result、Comment；Git 与 TFS PR 各自保存实际版本/PR。
- **Method ≠ Artifact**：AI Review、Code Review、Bug Analysis、Validation、Handoff 都是活动；不能因为执行过就新建同名文件。
- **View ≠ Truth Store**：Human 摘要从工程事实和交付事实渲染，不复制工程正文，也不新建一个要同步维护的对象。

**必要性判断**：该事实是否已存在可靠 Owner？是否有后续消费者真正需要长期读取该内容？是否有不可替代的工程信息？若没有，则不持久化。

## 2. 六项决策的依据、具体约束与最小修改

### D1. AI Review：Verdict 必须真实，Review 文档不必要

**现状**：
- `analysis/facts.ts` 和 `analysis/validate.ts` 要求 Intentional 的 `verdict` 与非空 `findings_ref`。
- `delivery/finalize.ts` 在收口时再次要求 `findings_ref` 非空。
- 这导致“即使没有 Finding，也要找引用/制造文档”的风险；`ai-review.md` 本身不是 OpenSpec Schema Artifact。

**目标**：
- Intentional 由 Workitem Analyst 完成专业 AI 自查，仅输出 `analysis.ai_review.verdict = APPROVED | NEEDS_REVISION`。
- Corrective 必须完成根因、修复策略、回归范围的一致性自查，不额外强制 Verdict 字段或 `corrective-review.md`。
- 有关键问题：直接修改 Proposal/Specs/Design/Tasks，或通过 Issue/Run 反馈阻断；无 Finding 不生成空报告。
- `NEEDS_REVISION` 不允许进入 Human Approval；`APPROVED` 不替代 Human Approval、Independent Verification，也不意味着专业判断一定正确。
- **取消 `analysis.ai_review.findings_ref` 的必填 Gate/Closeout 条件**。不创建替代的 `review-result.json` 或 Review Metadata 对象。

**最小改动**：`facts.ts`、`validate.ts`、`gate-evidence.ts`、`delivery/finalize.ts` 及相应测试与少量 Prompt。新 Gate 不消费旧 `findings_ref`；旧 Issue 中残留该字段不应影响新流程，确有在途冲突时才定向处理；不批量清理 Metadata、不回写已发布历史。

### D2. Analysis Handoff：不落地文件，使用已有 Metadata

**现状**：`rondo analysis stage` / `complete` 通过 `--facts <facts.json>` 读取输入；`analysis-handoff.json` 可以位于 Change 内，且 `gate-evidence.ts` 会在其存在时将其纳入 `change_digest`。

**目标**：
- Stage 后的 `change_ref`、`change_kind`、`verify_agent`、`ai_review.verdict` 等事实以**当前 Issue Metadata** 为准；后续命令应核对该来源，不把临时输入另当作权威事实。
- 只要求 `analysis-handoff.json` **不进入 OpenSpec / Git / Archive**。现有 CLI 若需要 `--facts`，可继续使用一次性临时输入；无需为消除临时文件而重构 `stage` / `complete` 参数或新增生命周期机制。
- Git 的 Change 下没有 `analysis-handoff.json`；Gate 摘要只覆盖实际工程契约及适用的真实来源引用。

**最小改动**：优先调整必要的 Prompt 与 `gate-evidence.ts` 工件选择；`stage.ts` / `complete.ts` 仅在实际妨碍去持久化或 Gate 校验时修改。专业分析结论仍由 OpenSpec 持有；已归档版本不批量删除。

### D3. Evidence Markdown：取消通用文件，证据融入工程契约或引用

**现状**：真实样本出现 `evidence.md`，还可能有 `evidence/` 或 `validation/`、`review/` 等过程材料；目录存在不能自动证明其内容冗余。

**目标**：
- 不生成通用 `evidence.md`、`evidence/`、`validation/*.md`、`review/*.md` 或人工阅读用重复报告。
- 关键业务规则、Root Cause、Fix Strategy、影响范围、Verification 已应由 Proposal/Specs/Design/Tasks 表达；源码可以关联固定 Commit/代码位置。
- **代码与文档不能独自证明历史运行结果**：生产日志、测试执行与外部业务确认如对结论有实质影响，保留可信运行/Issue/原始来源引用与必要的摘要，不虚构“已验证”。
- 不增加“必须生成 Supporting Evidence”例外机制；只有确有不可替代的长期工程事实且无法用原生 Artifact 表达时，才个案评估，不能再用通用 Evidence 文件承载流程日志。

**最小改动**：只修正实际诱导建文件的 Workitem Analyst / 相关 Skill 指导，不对 Agent 增加禁止独立思考或固定调查步数的限制。

### D4. Analysis Gate：真正执行，失败反馈，成功绑定固定版本

**现状**：
- `analysis/validate.ts` 的 `--out` 当前限定为 `logs/analysis-gate-result.json`。
- `analysis/publish.ts`、`analysis/published-source.ts`、`analysis/gate-evidence.ts` 依赖固定文件、Check 集合、Metadata/Change Digest，并在远端 Git Commit 中重读。
- 因此现在不能“删 JSON、保留原 CLI”而宣称 PASS。

**目标**：
1. `rondo analysis validate` 可保留为只读预检查：输出 `PASS / FAIL / UNKNOWN` 与直接原因，**不写入 OpenSpec**。
2. **唯一最终可信 Gate 入口是 `rondo analysis publish`**：它必须对本次待发布的 Engineering Contract 执行真实 Gate；外部预检查结果和 Metadata 中的 `PASS` 均不能替代最终 Gate。
3. 发布前核实 Issue / Workspace / Change / Schema / Analysis Facts 与被检查内容的一致性；发布时确认最终 Git Commit 的工程正文与本次 Gate 实际检查的正文一致，内容变化、远端冲突或身份不明时停止并返回 `FAIL/UNKNOWN`。
4. 仅在固定 Commit 已回读且与 Gate 通过的内容一致后，记录 `analysis.gate.result=PASS` 与 `analysis.source`，再进入 Human Review；不得只写两个字段就声称已验证。
5. Gate 未通过：直接反馈具体检查项及原因，不写 PASS、不进入 `analysis_review`，不保存失败 JSON。
6. 重放/中断恢复只核对当前已保存的**固定 Git Commit**和对应 Metadata，必要时对该固定版本重新执行 Gate；不得用可变 `HEAD` 或旧 PASS 放行。

**不做**：新 Gate Token、Gate Receipt Service、签名文件、第三个事实源或额外状态机。保留必要质量与授权约束，删除的是**文件载体**，不是版本完整性保障。

**最小改动**：`validate.ts`、`complete.ts`、`gate-evidence.ts`、`published-source.ts` 和 Gate 相关调用/测试；简化现行 `gate.reasons_ref` 文件路径依赖。若存在真实验证/发布竞态，优先通过 Git 固定 Commit 的内容回读消除，不扩大为平台事务系统。

### D5. Per-repo Evidence：不再写 JSON，但真实交付核验不能减少

**现状**：
- `change-development/SKILL.md` 要求每仓 `evidence-<repo_id>.json`。
- `dev/change-completion.ts`、`delivery/requirement-mode.ts`、`delivery/current-evidence.ts` 等代码读取 Change 内 Evidence；`dev/check-completion.ts` 还消费其 Validation、Code Review、Commit、Contract Binding 等段落。
- `dev/publish.ts` 会把这类 JSON 作为研发工件一起发布。

**目标**：
- **Git** 持有真实 Repository URL、Commit SHA、分支和代码变更；**Multica** 持有 Candidate 与 Validation、Code Review、Blocking Findings 等交付结果。
- 首先核实 Multica Engineer Run Result 在 Run 结束后能否被 PR Preparation / Closeout **跨 Run 稳定回读**，以及是否能关联 `repo_key + candidate_commit`。能满足则直接复用；不能满足时，仅在现有 `pr_prep` 等交付事实载体中补最少的 Validation / Code Review 结果和来源引用，不新建 `dev.evidence` 对象或独立 Evidence Service。
- 最小消费事实为仓库与 Candidate 身份、真实 Validation 结论和来源、Code Review 结论、未解决 Blocking Findings；其值必须对应同一个 `repo_key + candidate_commit`，且后续 Runtime 能回读。
- Rondo 继续核验授权 Repository Scope、真实 Candidate SHA/分支、检查结果与 Candidate 的对应关系、未解决 Blocking Finding、已批准与交付 Git 契约一致；**单独的 Agent 自报 `PASS` 不构成充分证据**。无法核实则 `FAIL/UNKNOWN`，不得放行。
- `contract_files` 的逐文件 Hash Map 不再作为每仓 JSON 传递；Rondo 可比较批准版本与已发布研发版本的实际 Git 契约（已有 `change-completion.ts` 中的相关能力）。

**最小改动**：`change-development` Skill、`dev/change-completion.ts`、当前 Requirement 路径的 `delivery/requirement-mode.ts` 和实际消费调用处、`dev/publish.ts` 的执行工件选择及测试。仅当旧 `current-evidence.ts` 是本次真实调用链时才改，不借机重构历史 Task-level 路线。

**实施前置检查**：当前尚未确认 Multica Run Result 能否在 Run 结束后被另一 Runtime 按 Candidate 稳定读取。先验证该能力并确定**唯一现有事实消费位置**，再改 Development Gate；不能把“将来可能从 Run 读取”当成已实现契约。

### D6. PR Description：不进 Git，最终属于 TFS PR

**现状**：
- `dev/pr-prep.ts` 缺省创建 `pr-description-<repo>.md`，在 `pr_prep.description_ref` 登记 `change:...`。
- `dev/change-completion.ts` 强制检查该文件已发布且非空。
- `pr/materialize.ts` 从远端固定 Commit 读取 Markdown；但同一模块已有创建 TFS PR 所用的**临时 Description File**能力。

**目标**：
- **Engineer 负责 PR 的专业变更摘要、验证结果与风险说明**；Rondo 只核对来源与 Candidate、按 TFS 必需格式组装并提交，不承担方案分析或 Diff 语义写作。
- **直接提交 TFS PR**；如 TFS CLI 必须使用 `--description-file`，只生成调用期间的临时文件，并使用现有清理能力。
- PR 正文只由 TFS PR 持有；Multica 保存 PR ID、URL、Source/Target、Candidate 与当前状态等原生交付引用。
- 不保留 `pr_prep.description_ref=change:...`，不要求远端 Git 有 `pr-description-<repo>.md`；失败/未知时优先回读外部 PR 并确认分支与身份，避免重复创建。

**最小改动**：`dev/pr-prep.ts`、`dev/change-completion.ts`、`pr/materialize.ts` 与少量交付 Skill 文案/测试。D5 与 D6 **作为同一次 Completion / PR Admission 链路改造验收**，不能留下要求另一类旧文件的中间状态；不得跳过 Candidate、Approval、Validation 核验。

## 3. Human 结果展示（保留原方案）

Human 在当前 Issue 一处看到摘要，不再打开机器日志、Review/Evidence 报告：

```md
### Analysis Ready — Awaiting Human Review

- 目标/问题：……
- 方案/根因：……
- 影响仓库与范围：……
- 关键验证与 Verify Recommendation：……
- 风险/待决：……
- 固定审核版本：<change_ref> @ <full commit>
- Analysis Gate：PASS
```

- 只在真实 Gate、Git 固定来源和 Issue Metadata 回读可信后，发布/确认该摘要；选择 Human 实际可见的原生 Run Result 或 Issue Comment。
- 不建立 `analysis-summary.md`、Review Agent、评论注册表或新的审核状态。
- Gate/版本提交成功但摘要尚不可见时，如实告知并补充原生展示；不能说 Human 已完成 Approval。

## 4. 简化后的交付流程

```text
Workitem Analyst
  ├─ OpenSpec Proposal / Specs / Tasks / 必要 Design
  ├─ 专业自查；Intentional: ai_review.verdict
  └─ Rondo Stage → Validate (只反馈结果) → Complete
       ├─ FAIL / UNKNOWN → 反馈原因，停止
       └─ 最终 Gate PASS + 同一 Git 固定版本核验
             → Multica Gate PASS + analysis.source
             → Human Summary / Human Approval

Engineer
  ├─ 根据已批准 OpenSpec 实现并 Commit / Push
  ├─ 真实 Validation / Code Review / Blocking Findings
  ├─ 提供专业 PR 摘要与风险说明
  └─ Git Candidate + 可跨 Run 回读的 Multica 交付事实
       → Rondo Completion Gate（D5/D6 同一闭环）
       → Rondo PR Materialize（仅格式化/临时 Description）
       → TFS PR（描述/状态/Review 的权威来源）
       → 现有 Closeout → OpenSpec Archive
```

注意：这里是**已有角色与命令的执行关系**，不新增 Agent、Workflow Stage 或跨系统状态。Human Approval 继续是独立授权，AI Review/Gate PASS 均不得替代。

## 5. 改造范围与顺序（只改真实依赖）

| 阶段 | 必须完成的变化 | 验证重点 |
| --- | --- | --- |
| P0 Analysis | D1–D4：Verdict 保留、无 Review/Handoff/Evidence/Gate 文件；Complete 真实复核 Gate 和 Git 固定版本；Human 摘要可读 | Intentional、Corrective、FAIL/UNKNOWN、发布竞态、Human Approval |
| P1 Development + PR | **D5/D6 同一交付链路验收**：Git + 可跨 Run 消费的最小事实取代每仓 Evidence JSON；Engineer 提供 PR 专业摘要，Rondo 直接提交 TFS PR，不发布 Description Markdown；Completion/Closeout 均不依赖旧文件 | 单仓/多仓 Candidate、Validation/Review、Blocking Finding、PR Create/Reuse/异常回读、Closeout |
| E2E | 真实 Requirement 从 Analysis → Human Approval → Engineer → PR → Closeout → Archive | 六类文件均未落盘；工程契约与外部事实真实可回读 |

优先级只是**实施顺序**，不是新状态机。先验证 Multica Run Result 的跨 Run 读取能力，必要时在已有交付 Metadata 补最少字段；**D5/D6 不能拆成会留下旧文件依赖的两个半成品**。只修改真实使用当前 Requirement Change 的 CLI、Skill 与测试，不借机改造 Direct Bug 或历史 Task-level 路线。

## 6. 最小验收矩阵

| ID | 场景 | 通过条件 |
| --- | --- | --- |
| A1 | Intentional 无 Finding | `analysis.ai_review.verdict=APPROVED`，无 `ai-review.md` / 必填 `findings_ref`；Gate 真实执行 |
| A2 | Intentional 有 Blocking Finding / Corrective 证据不足 | 真实问题可反馈，`NEEDS_REVISION` 或必要 FAIL/UNKNOWN 不被冒充 PASS |
| A3 | Analysis Handoff / Review / Evidence | Change 不新增 `analysis-handoff.json`、`evidence.md`、`validation/*.md`、`review/*.md` |
| A4 | Gate 的版本一致性 | 无 `logs/analysis-gate-result.json`；最终 Gate 校验的正文必须与固定 `analysis.source.commit` 一致；变更正文、错误身份、重复 Complete/中断不能错误放行 |
| A5 | Human Approval | 当前 Issue 的简明摘要可读，关联真实 `analysis.source.commit`；批准引用固定版本 |
| A6 | 单仓/双仓 Engineer | 无 `evidence-<repo>.json`；每仓 Candidate、真实 Validation/Review 结果及来源可由后续 Runtime 回读，无法跨 Candidate 冒用；不接受无来源的自报 PASS |
| A7 | PR Create / Reuse | 无 `pr-description-<repo>.md`；专业摘要由 Engineer 提供，Rondo 提交到 TFS PR；与 A6 同一 Completion/PR 链路通过，重试不制造重复 PR |
| A8 | Closeout / Archive | 无六类过程文件；仍可核实实际 PR、Candidate、任务进度与固定批准契约 |
| A9 | 已发布旧版本 | 既有固定 Git Commit 不回写、不批量删除；真实在途兼容需求单独评估，不成为新流程默认分支 |

**成功标准**：原生 OpenSpec Artifact 仍准确完整；Gate、Human Approval、Candidate 与验证事实依旧可信；新增的 OpenSpec Change/Archive 中默认没有 D1–D6 的过程性文件。没有真实 E2E 不得宣称实施完成。

### 6.1 两个真实归档样本的理论目标

| 样本 | 截图可见文件 | 目标可见文件 | 前提 |
| --- | --- | --- | --- |
| TFS 265593 | 11 | 4 | Proposal、Spec、Tasks、Design 均必要，其余 7 个文件不再持久化 |
| TFS 266607 | 10 | 4 | 同上，其余 6 个文件不再持久化 |

截图的 `tree` 默认隐藏 `.openspec.yaml` 等点文件；这里只比较截图中可见文件。**仅作参考，不作为固定文件数量的验收门槛。** 实际 Change 按必要的 OpenSpec Artifact 和可追溯工程事实判断；此为新流程理论目标，不清理已归档历史，也不代表运行测试结果。

## 7. 设计边界与反模式

**保留**：OpenSpec Schema/Artifact Graph、工程事实、可靠 Root Cause、必要 Validation、真实 Code Review、Candidate/Scope/Commit 一致性、Human Approval、失败三态、原有 Git/TFS 的安全外部副作用顺序。

**不新增**：
- 为六项文件再创建 `review.json`、`delivery-evidence.json`、`gate-receipt.json`、`summary.md`、新的 Metadata Schema / Service。
- 独立 Reviewer、Evidence Manager、Notification Manager、Gate State Machine。
- 无法证明必要的兼容层、历史批量迁移、临时文件统一清理框架。
- 将所有专业检查变成机械字段检查；把 `PASS` 字符串、Code Review 自述或 PR Description 当成真实授权或真实测试。

**文件责任归属规则**：
> OpenSpec 保存“要改变什么、依据与验证方式”；Git 保存“实际改动版本”；Multica 保存“由谁执行、交付与审核事实”；TFS PR 保存“PR 描述与最终审核”。通过固定引用连接，不复制正文。

## 8. 实施参考（事实核对，不是额外的设计原则）

- [01 统一设计原则](01-multica-openspec-design-guideline.md)
- [Workitem Analyst Instructions](agents/workitem-analyst/instructions.md)
- [Spec Preparation](skills/spec-preparation/SKILL.md)
- [Analysis Publish](skills/analysis-publish/SKILL.md)
- [Change Development](skills/change-development/SKILL.md)
- [Intentional Schema](openspec/schemas/intentional-change/schema.yaml)
- [Corrective Schema](openspec/schemas/corrective-change/schema.yaml)
- [Analysis Facts](rondo/src/commands/analysis/facts.ts)
- [Analysis Validate](rondo/src/commands/analysis/validate.ts)
- [Analysis Complete](rondo/src/commands/analysis/publish.ts)
- [Gate Evidence](rondo/src/commands/analysis/gate-evidence.ts)
- [Published Source](rondo/src/commands/analysis/published-source.ts)
- [Development Completion](rondo/src/commands/dev/change-completion.ts)
- [Development Publish](rondo/src/commands/dev/publish.ts)
- [Requirement Evidence](rondo/src/commands/delivery/requirement-mode.ts)
- [Current Evidence](rondo/src/commands/delivery/current-evidence.ts)
- [PR Preparation](rondo/src/commands/dev/pr-prep.ts)
- [PR Materialization](rondo/src/commands/pr/materialize.ts)
- [Delivery Finalize](rondo/src/commands/delivery/finalize.ts)
