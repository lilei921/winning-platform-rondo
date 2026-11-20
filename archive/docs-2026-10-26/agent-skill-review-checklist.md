# Agent / Skill 评审校验清单

> 用途：新增或修改任何 Agent（Description / Instructions）与 Skill（SKILL.md 及支持文件）时的评审卡。
> 依据：`01-multica-openspec-design-guideline-v1.16.3.md` §5–§7、§9–§11。
> 用法：先过 [Part 1 红线](#part-1-红线一票否决)，任一命中即退回；再按资产类型过 [Part 2](#part-2-分类检查表)。

---

## Part 1. 红线（一票否决）

命中任意一条 = 不合格，无需继续评审：

| # | 红线 | 识别信号 |
|---|---|---|
| R1 | **Workflow-as-Prompt**：用自然语言维护状态机/流程 | Instructions 或 SKILL.md 出现 `A→B→C→D`、成串 `IF…THEN…` |
| R2 | **重复规则**：同一规则在两处以上各自定义（非引用） | 同一约束同时出现在 Instructions 和 SKILL.md / Context 中，措辞各自维护 |
| R3 | **可确定性判断交给 LLM** | 输入明确、规则明确、结果有限的检查写成了"请检查/确认…"而不是 Script / Gate |
| R4 | **Skill-as-Agent**：Skill 里定义角色身份 | SKILL.md 出现"你是 XX Agent / 你的职责是 / 你不能…"（方法自身的停止条件除外） |
| R5 | **Task-as-Instructions**：本次任务信息写进长期资产 | Instructions / SKILL.md 出现具体 Issue、具体仓库名、本次 Source Requirement |
| R6 | **Description 承担执行约束** | 删掉 Description 后 Agent 行为会变化 |
| R7 | **隐含继承假设** | Member 的执行义务只写在 Squad Instructions 里（Member 收不到） |
| R8 | **提醒堆积代替约束** | 连续出现"注意…/务必…/再次强调…"，没有对应的 Constraint / Stop Condition / Gate |

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
| I1 | 结构是否为五段式？ | `# Role / # Core Responsibilities / # Boundaries / # Execution Principles / # Escalation, Communication & Delivery` |
| I2 | Role 是否 1~3 个短段？ | 只说是谁、定位、责任位置 |
| I3 | Core Responsibilities 是否 3~5 项且只写 What？ | 没有"第一步…第二步…" |
| I4 | Boundaries 是否明确写了"不得 / 在哪里必须停"？ | 至少包含：不替代谁的工作、不覆盖 Gate FAIL、不替代人工批准（按角色适用） |
| I5 | Execution Principles 是否都是长期成立的原则？ | 事实来源、决策优先级、Fail-safe、最小变更等 |
| I6 | 是否每条都通过"每次 Run 测试"？ | 自问：这条值得**每次 Run** 都出现吗？不值得→移 Skill/Issue/Context/Script |
| I7 | 语言是否"短硬明确"？ | 用「必须/不得/仅当…才/如果…则停止」；无「仔细分析/充分考虑/灵活处理」 |
| I8 | 是否有详细 Procedure？ | 无；详细方法引用对应 Skill 名称即可 |
| I9 | Specialist 直接收 Issue 能否独立执行？ | 不依赖 Leader 转述也能获得完整执行契约 |
| I10 | Escalation 条件是否明确？ | 写明 UNKNOWN/责任不清/证据缺失/规则冲突/需人工批准/超权限时的停止动作 |
| I11 | Delivery 契约是否明确？ | 写明以什么形式交付（Comment / Artifact / Status Update / Fact） |

### 2.3 Skill / SKILL.md

| # | 判定问题 | 通过标准 |
|---|---|---|
| S1 | 命名是否以能力/方法/场景为中心？ | `tfs-sync`、`development-execution` ✅；`delivery-lead-helper` ❌ |
| S2 | frontmatter description 是否同时含 What + When？ | 读 description 就知道做什么、什么时候用 |
| S3 | 正文是否覆盖六问？ | When / Input / How / Validation / Output / Failure 均有对应章节（Preconditions / Procedure / Validation / Output / Error Handling） |
| S4 | 最小充分测试 | 逐段自问：不知道这段会不会影响正确执行或安全停止？不会→删或移到支持文件 |
| S5 | 确定性逻辑是否下沉？ | 可程序化的检查/计算在 `scripts/`，SKILL.md 只写何时调用、输入什么、如何解释结果 |
| S6 | 渐进披露 | 详细 Schema/API/Mapping 在 `references/`、参数在 `config/`、模板在 `templates/`；SKILL.md 只按需引用，无深链 |
| S7 | 是否无历史/设计理由/方案比较/CHANGELOG？ | 无（这些去设计文档 / ADR / Git History） |
| S8 | 是否无 Agent 身份重复？ | 无"你是…/你的职责是…"；方法自身限制（Method Constraint）允许保留 |
| S9 | 是否无第二套 Workflow / Route？ | 已有权威流程时只写调用与结果处理 |
| S10 | Skill 名 ≠ 强制产物名 | 不因 Skill 叫 `bug-analysis` 就要求生成 `bug-analysis.md`；输出更新已有权威 Artifact / Runtime Fact |
| S11 | 含副作用的方法是否写了恢复方式？ | 明确已成功 / 结果未知 / 部分失败各自怎么处理，复用既有对象身份 |
| S12 | Validation 是否可判定？ | 有明确的完成标准（Evidence 完整 / Gate PASS / 回读确认），不是"确认无误" |

### 2.4 跨资产一致性

| # | 判定问题 | 通过标准 |
|---|---|---|
| X1 | One Rule, One Owner | 每条规则有唯一权威位置；他处只引用（写明"见 XX"） |
| X2 | 术语是否用 Canonical Name？ | `Delivery Lead / Workitem Analyst / Verify Agent…`；无 `Analyst / Verifier / Lead` 等别名 |
| X3 | 状态用 Key 不用 Display Name？ | 配置/脚本/判断写 `analysis_review`，不写 `Analysis Review` |
| X4 | 跨系统术语带 Owner Prefix？ | 跨 Multica/OpenSpec 章节写 `Multica Agent Instructions` / `OpenSpec Artifact Instruction`，不裸写 `Instructions` |
| X5 | 多 Agent 共用方法是否绑定同一 Skill？ | 无复制多份（如三 Engineer 共用一个 `development-execution`） |
| X6 | Gate / Script 边界 | Gate 只返回 `PASS / FAIL / UNKNOWN` + reasons；Agent 不得被写成可覆盖 FAIL |

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
Instructions：身份？边界？原则？每条都值得每次 Run 出现吗？有流程步骤吗？
SKILL.md：    What+When？六问齐吗？最短吗？确定性下沉了吗？有角色定义吗？
共同：        一条规则一个 Owner 吗？名字是 Canonical 吗？状态用 Key 吗？
红线：        有 A→B→C 流程吗？有重复定义吗？确定性判断交给 LLM 了吗？
```
