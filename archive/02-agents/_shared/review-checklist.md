# Agent / Skill 评审校验清单

> 用途：新增或修改任何 Agent（Description / Instructions）与 Skill（SKILL.md 及支持文件）时的评审卡。
> 语义背景：`01-multica-openspec-design-guideline`（根级现行版 `projects/multica/01-multica-openspec-design-guideline.md`）§5–§7、§9–§11。
> 用法：先过 [Part 1 红线](#part-1-红线一票否决)，任一命中即退回；再按资产类型过 [Part 2](#part-2-分类检查表)。
> 历史溯源：本清单原位于 `docs/agent-skill-review-checklist.md`，2026-10-26 平移至本位置（内容未改），原文档已归档。

---

## Part 1. 红线（一票否决）

命中任意一条 = 不合格，无需继续评审：

| # | 红线 | 识别信号 |
|---|---|---|
| R1 | **Workflow-as-Prompt**：在 Agent / Squad Instructions 中完整维护交付状态机，或在 Skill 中复制已有 Workflow / Gate / Route | 与既有 Multica / Script / Gate 重复定义状态变迁、跨 Agent 路由或审批放行；尚未程序化的单一 Owner Skill 可以承载必要流程，专业 Method 的有序步骤和必要 CLI 顺序不构成违规 |
| R2 | **重复规则**：同一规则在两处以上各自定义（非引用） | 同一约束同时出现在 Instructions 和 SKILL.md / Context 中，措辞各自维护 |
| R3 | **已知确定性事实仍交 LLM 推断** | 已有可靠 API State / Tool / Script / Gate 可以提供的事实被要求由 LLM 重新猜测；不为直接读取的可靠事实强制新增 Script / Gate，受保护副作用仍需确定性约束 |
| R4 | **Skill-as-Agent**：Skill 里定义角色身份 | SKILL.md 出现"你是 XX Agent / 你的职责是 / 你不能…"（方法自身的停止条件除外） |
| R5 | **Task-as-Instructions**：本次任务信息写进长期资产 | Instructions / SKILL.md 出现具体 Issue、具体仓库名、本次 Source Requirement |
| R6 | **Description 承担执行约束** | 删掉 Description 后 Agent 行为会变化 |
| R7 | **隐含继承假设** | Member 的执行义务只写在 Squad Instructions 里（Member 收不到） |
| R8 | **提醒堆积代替约束** | 连续出现"注意…/务必…/再次强调…"，没有对应的 Constraint / Stop Condition / Gate |
| R9 | **新增 docs/ 引用** | SKILL / agents 资产新增对 `projects/multica/docs/` 的引用（规范性内容权威位置只能是技能内 `references/` 冻结契约或 `rondo` 脚本实现；详见根仓引用纪律） |

---

## Part 2. 分类检查表

每项给出**判定问题**；回答为"否"即不通过。

### 2.1 Agent Description

| # | 判定问题 | 通过标准 |
|---|---|---|
| D1 | 是否一句话能说清这个 Agent 干什么？ | 只含主要职责 + 主要处理对象 |
| D2 | 删掉它，执行行为会变吗？ | 不会（它只是 UI 展示） |
| D3 | 是否不含 Workflow / 步骤 / 工具用法 / 当前任务？ | 全部不含 |

### 2.2 Agent Instructions

| # | 判定问题 | 通过标准 |
|---|---|---|
| I1 | 是否具备完整的长期角色与工作契约？ | 六段式仅为推荐模板；允许合并章节或将 Goal 写入 Role，须清楚表达职责、工作方式、边界与交付 |
| I2 | Role 是否 1~3 个短段？ | 只说是谁、定位、责任位置 |
| I3 | 长期 Goal 与职责是否清楚、无当次任务内容？ | Goal 可以融入 Role；职责以 What 为主，允许每次都必需的简短检查，不复制完整专业 Procedure |
| I4 | Boundaries 是否明确写了"不得 / 在哪里必须停"？ | 至少包含：不替代谁的工作、不覆盖 Gate FAIL、不替代人工批准（按角色适用） |
| I5 | 工作方式 / Execution Principles 是否长期成立？ | 事实来源、方法选择、必要启动检查、决策优先级、Fail-safe 等；不重复 Skill 细节 |
| I6 | 是否每条都通过"每次 Run 测试"？ | 自问：这条值得**每次 Run** 都出现吗？不值得→移 Skill/Issue/Context/Script |
| I7 | 语言是否"短硬明确"？ | 用「必须/不得/仅当…才/如果…则停止」；无「仔细分析/充分考虑/灵活处理」 |
| I8 | 是否避免复制完整专业 Procedure？ | 每次执行都需要的简短步骤可保留；详细可复用操作使用 Skill，不要求只写 Skill 名称 |
| I9 | Specialist 直接收 Issue 能否独立执行？ | 不依赖 Leader 转述也能获得完整执行契约 |
| I10 | Escalation 条件是否明确？ | 写明 UNKNOWN/责任不清/证据缺失/规则冲突/需人工批准/超权限时的停止动作 |
| I11 | Delivery 契约是否明确？ | 写明以什么形式交付（Comment / Artifact / Status Update / Fact） |

### 2.3 Skill / SKILL.md

| # | 判定问题 | 通过标准 |
|---|---|---|
| S1 | 命名是否以能力/方法/场景为中心？ | `tfs-sync`、`development-execution` ✅；`delivery-lead-helper` ❌ |
| S2 | frontmatter description 是否同时含 What + When？ | 读 description 就知道做什么、什么时候用 |
| S3 | 是否提供当前方法需要的最小充分指导？ | What + When、必要准备、执行/使用方法、结果使用或提交方式及适用的停止/求助条件；不强制六个独立章节、Capability Goal 或 Artifact |
| S4 | 最小充分测试 | 逐段自问：不知道这段会不会影响正确执行或安全停止？不会→删或移到支持文件 |
| S5 | 是否优先复用已有确定性能力？ | 优先使用可靠 API State / Tool / Script / Gate；确需新建强制保护或确定性计算时才实现 Script / Gate，SKILL.md 说明调用、结果解释与失败处理 |
| S6 | 渐进披露 | 详细 Schema/API/Mapping 在 `references/`、参数在 `config/`、模板在 `templates/`；SKILL.md 只按需引用，无深链 |
| S7 | 是否无历史/设计理由/方案比较/CHANGELOG？ | 无（这些去设计文档 / ADR / Git History） |
| S8 | 是否无 Agent 身份重复？ | 无"你是…/你的职责是…"；方法自身限制（Method Constraint）允许保留 |
| S9 | 是否无第二套 Workflow / Route？ | 已有权威流程时只写调用与结果处理 |
| S10 | Skill 名 ≠ 强制产物名 | 不因 Skill 叫 `bug-analysis` 就要求生成 `bug-analysis.md`；输出更新已有权威 Artifact / Runtime Fact |
| S11 | 含副作用的方法是否写了恢复方式？ | 明确已成功 / 结果未知 / 部分失败各自怎么处理，复用既有对象身份 |
| S12 | 需要独立 Validation 时是否可判定？ | 交付/副作用型 Skill 有明确完成或回读标准；参考型可不设独立 Validation，但应说明资料如何正确使用及何时停止，不以标题存在判断质量 |
| S13 | 推荐方法与硬约束是否分开？ | 专业路径和执行深度依复杂度由 Agent 选择；批准、必要质量与副作用顺序不得绕过 |
| S14 | 新增硬约束是否有必要性依据？ | 可指出防止的真实风险、唯一 Owner 与为何不能复用现有规则；纯展示字段不能直接当 Gate |

| S15 | Skill 是否有可解释的复用与维护价值？ | 跨任务、跨 Agent 或独立场景即可；专业型可定义局部 Outcome，参考型不强制 Goal；Method/Script 够用则不新增 Skill |

### 2.4 跨资产一致性

| # | 判定问题 | 通过标准 |
|---|---|---|
| X1 | One Rule, One Owner | 每条规则有唯一权威位置；他处只引用（写明"见 XX"） |
| X2 | 术语是否用 Canonical Name？ | `Delivery Lead / Workitem Analyst / Verify Agent…`；无 `Analyst / Verifier / Lead` 等别名 |
| X3 | 状态用 Key 不用 Display Name？ | 配置/脚本/判断写 `analysis_review`，不写 `Analysis Review` |
| X4 | 跨系统术语带 Owner Prefix？ | 跨 Multica/OpenSpec 章节写 `Multica Agent Instructions` / `OpenSpec Artifact Instruction`，不裸写 `Instructions` |
| X5 | 共享方法与实际绑定是否一致？ | 多 Agent 使用同一 Skill，确认实际注册/绑定/启停状态；单 Agent 跨任务复用仍有效，不根据文件存在推断启用 |
| X6 | Gate / Script 边界 | Gate 只返回 `PASS / FAIL / UNKNOWN` + reasons；Agent 不得被写成可覆盖 FAIL |
| X7 | Outcome First, Bounded Autonomy | 质量结果可核验；专业方法可按情境替代；不可交换的授权与副作用顺序有唯一 Owner |
| X8 | Goal Ownership | Agent Professional Goal、Issue Task Goal 与 OpenSpec Change Goal 各在其 Owner；Skill 的 Capability Outcome 按适用性定义，能力组合与真实绑定一致 |

---

## Part 3. 评审结论模板

```text
评审对象：<Agent 名 / Skill 名>    版本/日期：< >
红线检查：PASS / 命中 R__（____）
分类检查：I/S/D/X 不通过项：____（附行号或段落）
结论：✅ 通过 / 🔧 修改后复审 / ❌ 退回重写
主要问题（最多 3 条）：
1.
2.
3.
```

---

## 附：30 秒快查版（给评审人贴在手边）

```text
Instructions：职责？工作方式？专业 Goal？边界？交付？每条都值得每次 Run 出现吗？有无重复完整 Procedure？
SKILL.md：    What+When？复用价值？适用内容充分吗？按需加载吗？有无重复角色身份？是否无谓增加目标/产物？
共同：        一条规则一个 Owner 吗？名字是 Canonical 吗？状态用 Key 吗？
红线：        有 A→B→C 流程吗？有重复定义吗？确定性判断交给 LLM 了吗？
```
