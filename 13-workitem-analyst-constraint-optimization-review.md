# Multica 13 — Workitem Analyst 约束评审与最小优化方案

> 状态：设计方案已实施并迁入本仓库；**运行时验收尚未完成**
> 原始评审基线：2026-11-21；实施目标：`winning-platform-rondo/main`
> 原则：[01 统一设计规范](01-multica-openspec-design-guideline.md)：Specialist Focus、Outcome First, Bounded Autonomy、One Rule One Owner、KISS、YAGNI、Minimal Sufficient
> 范围：Workitem Analyst Instructions、已绑定 Skills 与现有 Rondo / OpenSpec 契约；本方案仅指导后续最小 Prompt 优化

## 1. 结论

**不降低专业质量及工程安全要求；减少无必要的方法限制、重复检查解释和辅助报告。**

当前 Agent / Skills 的总体结构合理。Workitem Analyst 对准确、可实施、可验证的 Engineering Contract 负责，可按需组合专业 Skill。需要优化的主要是少数执行型 Skill 的**规则密度**，而非架构和文件长度；`instructions.md`、`spec-preparation/SKILL.md`、`analysis-completion/SKILL.md` 分别约 43、41、71 行，不能因文字密集就认定全部需要重写。尚无 A/B 运行数据证明 Prompt 冗长实际造成质量或性能下降。

**实施建议：**
- **P0**：针对 `spec-preparation` 只删除已被原生机制覆盖、且不会造成操作歧义的重复解释；保留写入前提与专业判断。
- **P1**：针对 `analysis-completion` 精简重复错误解释，准确保留 Stage、Gate、本地 Commit、Rondo Complete 的实际执行契约。
- **按需**：`workitem-analyst/instructions.md` 若经文件级 Diff 确认确有重复，再微调 Verify Recommendation；没有实质收益则不改。
- **不改**：`bug-analysis`、`requirement-analysis`、`workspace-preparation`、`codebase-explorer`（除非真实样例显示多余查询）、Skill 绑定、01/03、Rondo、Schema、Gate。

本次**不新增 Agent、Skill、Review Run、状态、脚本、额外结果文件或质量 Gate**。

## 2. 事实与规则 Owner

当前 [绑定清单](workspace-config/provisioning.json) 为 Workitem Analyst 声明 6 个 Skill：`codebase-explorer`、`bug-analysis`、`requirement-analysis`、`spec-preparation`、`analysis-completion`、`workspace-preparation`。仓内配置是绑定意图；实际 Multica Workspace 是否已同步必须独立回读，不能从文件存在推定。

| 规则层级 | 唯一职责 | 必须保留的判断 |
| --- | --- | --- |
| Agent Instructions | 长期专业目标、授权、交付边界 | 专业判断、何时澄清、能否提交审核 |
| 专业 Skill（Explorer / Bug / Requirement） | 按需调查、诊断、需求分析方法 | 关键证据充分性、正确性及风险 |
| `spec-preparation` | 调用 OpenSpec 准备当前 Change | 正确 Root / Workspace / Change / 授权；只消费当前 Schema |
| OpenSpec Schema / Instruction / Template | Artifact 内容、结构、依赖及合法 skip | 必须具备哪些真实工件与内容 |
| Rondo / OpenSpec CLI | 已实现的确定性 Identity、Validation、Gate、发布及状态写入 | 以真实 CLI 结果为准，不能伪造 PASS |
| Human | 产品选择与批准 | 未获批准不能自动授权研发 |

**关键区分：** “CLI 已有检查”不代表 Agent 可以跳过**调用前提**。例如 `rondo change resolve-identity` 会解析身份并拒绝冲突，但不自动为随后的 OpenSpec 写入选择正确 `cwd`、确认写入授权。`rondo analysis validate` 也不判定 Root Cause、Conditional Design、Task Verification 的专业语义质量。**CLI PASS ≠ 专业 Review PASS ≠ Human Approval。**

规则分类：
- **Hard Constraint**：身份、Root / Workspace / Schema、授权、不可交换的副作用顺序、有效 Gate、真实状态回读及安全停止。
- **Outcome Contract**：行为与规则准确、Root Cause 有可信证据、Scope 清楚、Tasks 可实施与验证、未决风险能交接。
- **Recommended Method**：是否全面追踪调用链、固定诊断步骤、方案比较数量、证据表述详略、是否展开可选参考；由 LLM 按任务决定。

## 3. 六个问题域及逐项修复

以下将原 WIA-01～WIA-14 归并到六个问题域，保留每个原问题的决策对应，**不代表要执行 14 次独立修改**。

### A. Agent 职责与 Verify Recommendation（WIA-01、WIA-02、WIA-12）

**现状/问题**：Agent Instructions 已明确 Professional Goal、按需 Skill、事实/假设区分和授权边界。Independent Verification 的理由在 Instruction、03 设计与 Handoff 中有所重复，但 43 行 Instruction 并无明显整体过长问题。

**建议**：
- 保留 Workitem Analyst 的专业端到端责任，不拆分 Review Agent / Preparation Agent。
- 只在确有重复时压缩 `required / not_required` 判定说明；保留“独立执行是否有实质增量、剩余风险是否需要额外覆盖”的专业判断，不把 Change Kind、仓库数或测试类型当作自动触发条件。
- `analysis-completion` 负责提交结构化 `verify_agent` 事实，不重新作出首次推荐；`not_required` 不减免开发侧验证。
- 若现有内容已经足够简洁，**不修改 Agent Instructions**。

**保留的约束**：未经批准不得作产品关键选择、代码实现、外部 TFS 管理、Issue 审批与 PR 合并；没有证据不能宣称确定结果。

### B. 代码调查与专业分析（WIA-03、WIA-04、WIA-05）

**现状/问题**：`bug-analysis` 已允许不能复现时使用可信替代证据、`confirmed/probable/unknown` 可信度及有条件修复建议；`requirement-analysis` 已明确四类 Method 不是固定阶段、简单需求无需多个方案。`codebase-explorer` 的证据展示可能被误读为必须完整展开，但尚无运行数据证明该问题。

**建议**：
- **保留** `bug-analysis`、`requirement-analysis`；TFS Requirement 也可能技术上是 Corrective，不能因此移除 Bug Analysis。
- Codebase Explorer 以“提供足以复核关键结论的证据”为准；文件、Symbol、版本、跨仓调用关系按实际风险展开。只有观察到冗余查询时才修改。
- `probable` 可以明确标注不确定性并提出有条件建议；若未排除的其他根因会实质改变 Fix Strategy / Verification，继续调查或请求澄清。

**保留的约束**：关键事实可信、未知项透明、专业结论不被工具查询次数或工件数量代替。

### C. Spec Preparation 的规则密度及 Owner（WIA-06、WIA-07、WIA-08）

**现状/问题**：[当前 Skill](skills/spec-preparation/SKILL.md) 在单段 `Invariants` 中同时列出 Resolver、Root、Schema、依赖闭包、Glob、定向返工和 Validation。重复解释机械实现确有精简空间，但多项是有效调用前提，并非冗余。

**建议只做局部文字精简，不大幅重构**：
1. 保留：正确且就绪的 `root_repo`、`runtime.workspace_id` 配置、OpenSpec 命令显式正确 `cwd`、当前项目 Schema 与写入授权。
2. 保留：身份解析结果。`ACTIVE_FOUND` 复用；仅 `NOT_FOUND` 且有创建授权时才 New；`ARCHIVED_FOUND / CONFLICT / INVALID / UNKNOWN` 不以新建掩盖异常；已知双身份同时提供。
3. 保留：从当前 OpenSpec Artifact State / Instruction / Template 取得实际契约，基于现有依赖与专业条件补齐文件；`x-repositories` 是 Engineer 后续修改范围授权。
4. 保留：Conditional Design、是否真正需要 Spec-level Delta、实际 Capability Spec 文件与 Tasks / Verification 覆盖的**LLM 语义判断**；`status` 的 `done/skipped` 不能代替内容检查。
5. 保留：严格 OpenSpec Validation、Status 回读、失败或未知停止；CLI PASS 不能替代专业 Review。
6. **可精简**：重复的 CLI 内部计算说明、重复提醒、全文列举的实现级异常解释；但不能删掉唯一可执行命令、恢复前必须回读的语义或必要参数。

简单 Change 不制造空 `design.md`、虚假 Specs、无价值的 Verification Task；复杂 Change 允许专业深化。方法不必固定为 New → Prepare → Revise 流水线。

**验收**：可在正确 Root 创建/复用唯一 Change；错误身份/授权时拒绝危险写入；可合法跳过不需要的工件，且必要的工程内容仍可实施和验证。

### D. Analysis Completion 的执行语义及恢复（WIA-09、WIA-10）

**现状/问题**：[当前 Skill](skills/analysis-completion/SKILL.md) 存在对 CLI 内部字段校验和错误码处理的重复描述。旧方案中“Stage → Gate → 发布 → Complete”容易误导：**Requirement 的远端发布、远端 Gate/Commit 核验和 `analysis_review` 状态写入由 `rondo analysis complete` 实施**。

**正确的执行依赖**：
1. `rondo analysis stage`：输入**不带 `gate`** 的 Draft Facts，写入并回读当前 Issue Metadata。
2. `rondo analysis validate`：执行 Gate，将真实结果写入当前 Change 的 `openspec/changes/<change_ref>/logs/analysis-gate-result.json`。
3. Gate PASS 后，在 Facts 中填入真实 `gate.result`、`gate.reasons_ref`；只暂存、**本地 Git Commit 当前 Change 必要审核文件和 Gate Result**，避免包含无关变更。
4. `rondo analysis complete --mode requirement`：由 Rondo 完成远端发布、固定来源核验、`analysis.source` 落账、`analysis_review` 状态变更与回读。不可在该步骤外再安排一套重复 Push 流程。

**精简边界**：仍保留上述不可交换顺序、CLI 必要命令及 `--workspace-id` / `--registry-config` / `--root-repo` 等实际参数、Gate 后工件变化需要重新 Gate、未知结果先回读再恢复。可删除冗长的内部哈希/metadata 算法描述和无依据的固定等待时间；不能据此推定 CLI 已提供完整自动恢复。`FAIL / UNKNOWN` 不得当成 PASS，不能无限重试或手工伪造 Metadata。

**验收**：本地 Commit、远端固定版本与 `analysis.source.commit` 一致；状态确为 `analysis_review`；中断重跑不能覆盖后续有效事实。

### E. 专业 Review 与最小交付产物（WIA-11，补充原方案遗漏）

**现状/问题**：03 设计区分 Corrective 一致性检查、Intentional AI Review、OpenSpec Validation、Analysis Gate 和 Human Approval，职责不同；但对真实执行输出的 `logs`、Evidence、`ai_review`、Human Summary 是否需要额外文件缺少直接判断。不能为了“专业”而制造多份人类不会阅读的报告。

| 产物/事实 | 处理 | 理由 |
| --- | --- | --- |
| Proposal / Specs / Tasks | 依当前 Schema 按需保留 | 工程内容的权威来源 |
| `design.md` | 有实际设计决策才生成 | 避免空文档 |
| `facts.json` / Handoff Facts | 保留当前 Stage/Complete 所需结构，可使用现有约定位置 | 现有 CLI 输入与跨 Run 事实 |
| Intentional `ai_review` | 保留必要 Verdict、Findings 引用；引用应真实、可回读 | 当前 Gate 要求 `APPROVED` 与非空 `findings_ref`，但并不证明专业结论正确 |
| `logs/analysis-gate-result.json` | **必须保留**当前固定路径 | Rondo Gate / Complete 的确定性契约；不能因“少文档”取消 |
| 其他 Debug Logs、独立 `ai-review.md`、`evidence-validation.md` 等 | **非默认必需**；没有诊断/复核价值不创建 | 避免平行工程事实及噪声 |
| Supporting Evidence | 优先引用已有可信来源，必要时脱敏摘录 | 不复制源码、Trace 或已存在正文 |
| Human Review Summary | 简短展示，不另建 `analysis-summary.md` | Human 需要可决策的结果而非全量中间工件 |

**关于 AI Review**：现有 `rondo analysis validate` 仅做 `verdict`、`findings_ref` 的确定性检查；专业 Review 仍必须完成。可以将简要 Findings 记录到当前 Issue / Run Result / Comment 等可回读事实并提供真实引用，**不能把任意非空占位字符串当作充分 Evidence**。若没有问题，可明确“无阻断 Finding”并引用实际 Review 结论；不要求另起 Markdown，也不新增 Review Agent/Run。

**Human Summary 最小内容**：①需求/问题结论；②实施范围与主要方案；③验证建议（含是否独立 Verify）；④未决事项/风险；⑤Change 和 Gate 来源引用。若某项无实际内容可简要写“无”，不需要展开为独立报告。

Professional Review 只判断 **Correctness、Consistency、Implementability、Verifiability**。它可以在同一分析过程中完成，不强制重复遍历全部 Artifact；真实阻断项不能被省略。**Human Approval 始终独立保留**。

### F. 不扩散的边界（WIA-13、WIA-14）

- `03` 设计文档有历史说明，但并非当前每次 Run 都自动注入的 Agent Instructions；本轮不重写 03。
- `tfs.type` 是来源类型，`analysis.change_kind` 是技术分类，OpenSpec Schema 是工程工件契约；不可混同。
- 只读 MCP 调查无需先准备本地 Git；写 OpenSpec 必须确认根仓及授权。
- `x-repositories`、Change Identity、真实 Gate、Human Approval 和后续发布来源不可随意放宽。
- 本仓库的 Skill 位于 `skills/`；本轮不进行目录迁移或兼容分支改造。

## 4. 文件级实施决策

| 文件 | 决策 | 最小动作 |
| --- | --- | --- |
| `skills/spec-preparation/SKILL.md` | **P0：局部精简** | 优先删机械实现重复描述；保留写入前提、语义审查和失败约束 |
| `skills/analysis-completion/SKILL.md` | **P1：局部精简** | 正确说明本地 Commit 与 `complete` 发布职责；精简重复错误说明 |
| `agents/workitem-analyst/instructions.md` | **按需** | 只有发现真正重复的 Verify 文案时微调 |
| `codebase-explorer`、`bug-analysis`、`requirement-analysis`、`workspace-preparation` | **不改** | 已有适当专业自治及安全边界 |
| `01`、`03`、OpenSpec Schema、Rondo、Gate、Binding | **不改** | 不新增机制或扩大本轮变更 |

本文件是**实施依据，不是新增执行 Gate**。后续若没有可证实的冗余和实际收益，对应文件可不修改。

## 5. 最小验收范围（实施后验证）

| 场景 | 通过条件 |
| --- | --- |
| 简单 Intentional | 不强制多方案、空 Design、独立辅助报告；结果可实施、可验证 |
| Corrective | 复用证据，可信度准确；不强制复现或固定诊断路径 |
| 复杂或已有 Change | 按需深入、复用或定向修订，Scope / `x-repositories` 与专业验证不缺失 |
| 身份冲突、Root 错误或 Gate FAIL/UNKNOWN | 不错误写入、不伪造 PASS、不错误发布；已提交审核能回读真实来源 |

优先复用现有测试和一次代表性真实/隔离 Workspace 检查。可对比无效搜索/工具调用、额外文档、Human 返工与 Gate 失败原因；**不设缺乏基线支持的 Token/耗时下降目标，不新增 A/B 测试框架**。只有实际执行过的用例才可写 PASS。

## 6. 最终修复原则

> **保留结果与授权，放宽分析方法；保留真实机器契约，删除重复操作说明；保留可追溯专业 Review，减少无意义的报告和 Logs。**

工作项分析完成的标准是：**准确、可实施、可验证、可追溯、未越权，并能让 Human 通过简洁摘要做出决策**。不是 Skill 调用次数、文档数量或检查清单的长度。

---

## 参考源码

- [Workitem Analyst Instructions](agents/workitem-analyst/instructions.md)
- [Skill Binding Manifest](workspace-config/provisioning.json)
- [Spec Preparation](skills/spec-preparation/SKILL.md)
- [Analysis Completion](skills/analysis-completion/SKILL.md)
- [Bug Analysis](skills/bug-analysis/SKILL.md)
- [Requirement Analysis](skills/requirement-analysis/SKILL.md)
- [Analysis Source Contract](skills/analysis-completion/references/analysis-source-contract.md)
- [03 Workitem Analysis Design](03-workitem-analysis-design.md)
- [Rondo Identity Resolver](rondo/src/commands/change/resolve-identity.ts)
- [Rondo Stage](rondo/src/commands/analysis/stage.ts)
- [Rondo Gate](rondo/src/commands/analysis/validate.ts)
- [Rondo Complete](rondo/src/commands/analysis/complete.ts)
- [Rondo Facts](rondo/src/commands/analysis/facts.ts)
