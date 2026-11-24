# 15 — Agent / Skill / Rondo CLI 职责边界优化方案

> 日期：2026-11-24  
> 状态：待实施（仅保存方案）  
> 基线：PR [#57](https://github.com/lilei921/winning-platform-rondo/pull/57)，Review Commit `4db626c`，合并 Commit `cc63ab2`  
> 设计依据：[01 设计原则](01-multica-openspec-design-guideline.md)  
> 范围：Engineer、Bug Fix Agent、pull-request Skill 及对应现有静态测试

## 1. 目标与原则

从第一性原理出发，明确专业职责、场景方法和确定性执行的归属，减少不必要的提示词与重复执行，而非单纯追求 Instructions 字数最少。

遵循 KISS、YAGNI、Specialist Focus、One Rule One Owner、Native First、Deterministic First、Minimal Sufficient、Right-sized Execution。

| 层次 | Owner 职责 |
| --- | --- |
| Agent | 专业判断、实施、验证、授权范围内决策、专业交付 |
| Skill | 可复用场景的执行方法及必要工具输入输出 |
| Rondo CLI | 确定性校验、执行、事实登记、回读和恢复 |

Agent 可以直接调用 CLI；Skill 不是强制中间层。存在前置依赖不代表属于同一能力。Skill 可以描述必要的工具使用契约，但不重复实现 CLI 的校验与副作用。

## 2. Review 发现与修复

### 2.1 P1 — Requirement 研发工件发布归属

现状：PR #57 将 Tasks 更新与研发工件发布命令整体迁入 pull-request Skill 的 Requirement Artifact Publication 章节。

问题：Tasks 更新属于研发过程，研发工件发布有独立工程语义。PR Materialization 消费已发布成果，不因此拥有研发工件管理职责。将其纳入 PR Skill 会扩大能力范围，也不利于研发中途按需更新 Tasks。

证据：`rondo/src/commands/change/update-progress.ts` 更新任务完成事实；`rondo/src/commands/dev/publish.ts` 核验并发布研发工件、登记 `dev.publication`；`rondo/src/commands/dev/change-completion.ts` 的 `checkPublishedChange` 由 PR Materialization 消费。

修复：
- 删除 pull-request Skill 中整个 Requirement Artifact Publication 章节。
- Engineer Responsibilities 使用简短指引：根据实际研发成果使用 `rondo change update-progress` 更新 Tasks，使用 `rondo dev publish` 发布研发工件。
- 保留 `rondo analysis read` 简短启动指引；不复制完整命令参数。具体使用契约参照 CLI Help 和 [COMMANDS.md](rondo/COMMANDS.md)。
- 保留非实质性 Design 细化的授权边界；改变获批行为、接口或验收要求时停止受影响工作并重新审核。
- PR Submission 仅消费 Requirement 已发布研发工件这一前置事实。不新增研发 Skill，不新增 CLI 命令。

### 2.2 P1 — Abandoned PR Recovery 语义决策与后续执行

现状：恢复方法已从 Bug Fix Agent Instructions 移至 pull-request Skill，归属正确；恢复结果后的操作还不够明确。

证据：`rondo/src/commands/bug/resume.ts` 校验 Human 评论身份、PR 状态、Candidate、Evidence，恢复状态并返回 `PASS` 或适用的 `NOOP`；不解释 Human 评论的业务意图，不执行后续专业修复。

建议 Skill 内容：

````markdown
# Abandoned PR Recovery（Bug）

根据当前 Issue 中 Human 明确的恢复决定，选择对应方式：

```bash
rondo bug resume --issue <KEY> --human-comment-id <id> --next REWORK|RECREATE_PR
```

恢复成功后：

- `REWORK`：重新诊断、修复、验证并交付。
- `RECREATE_PR`：直接执行 `rondo pr materialize --issue <KEY>`。

恢复意图不明确时，向 Human 确认。
````

RECREATE_PR 复用已核验的未变 Candidate 和有效 Evidence，不重复 Checkout、验证、Push 或 PR Preparation。恢复失败或事实不明时按实际结果核实处理；不擅自改变 Human 决定，不手工补写 CLI 管理的 Metadata。无需新建恢复 Skill。

### 2.3 P1 — PR Submission 避免重复核验

现状：Skill 要求确认 PR、Work Item 关联、current_pr 和 in_review。

证据：`rondo/src/commands/pr/materialize.ts` 已负责 PR 创建或核实、Work Item 关联、current_pr 登记与回读、状态更新与回读。

建议内容：

````markdown
# PR Submission

完成必要的 PR Preparation；Requirement 需已发布研发工件。

```bash
rondo pr materialize --issue <KEY>
```

根据返回结果确认 PR 交付情况；出现异常时核实原因并处理。
````

Bug 的 ready_for_pr 是可供 Agent 消费的 CLI 输出，不是 Agent 应自行维护的状态。保留必要的准备完整性，不重复实现 Gate 或强制逐字段回读。

### 2.4 P1 — 专业验证与确定性验证

现状：Skill 同时要求完成专业验证与 Code Review，并由 CLI 在 Candidate 中实际执行验证命令，容易引导不必要的重复验证。

证据：`rondo/src/commands/pr/prepare.ts` 的 validatePrFacts 核验输入契约，并调用 `pr/validation.ts` 执行实际命令、核验 Candidate 和登记结果。

| 事项 | Owner |
| --- | --- |
| 验证哪些业务行为、选择测试方法与命令 | Agent |
| Root Cause、Regression、Code Review、风险判断 | Agent |
| Facts 的输入格式与必填字段校验 | CLI |
| 在指定 Candidate 实际执行提供的验证命令 | CLI |
| Candidate 对应关系、结果回读与登记 | CLI |

修复：调整 Skill Inputs 与 PR Preparation 的描述，强调提供真实、有效、与当前 Candidate 对应的专业 Facts；CLI 执行提供的验证命令，不额外要求 Agent 为形式完整性重复运行相同命令。不能将未执行或未确认的结果写成 PASS；保留现有真实证据要求与必要的专业验证。保留 Requirement 必填命令、Bug 替代证据的适用条件、失败不得降级、Facts JSON 及 Bug Evidence 字段、Blocking Findings 和风险记录要求。无 CLI 契约变更。

### 2.5 P2 — Candidate 章节简化

保留 fetch / push 的命令示例、非强制发布以及 Fetch 不合并的使用语义。保留 Bug Commit 的唯一 Refs 尾注要求（由 Agent 创建 Commit，CLI 校验）。删除不必要的内部机制描述：Push 如何回读远端 SHA、Candidate Branch 自动命名规则、Task Branch 与 PR 源分支的重复解释。CLI 的分支选择与校验机制保持不变。

### 2.6 P2 — 修正静态测试归属断言

`rondo/test/workspace-preparation-assets.test.mjs` 当前将三个命令全部固定在 pull-request Skill 中。

调整现有断言：
- Engineer 保留 analysis read、change update-progress、dev publish 的简短调用指引。
- pull-request 保留 bug resume、dev git、pr prepare、pr materialize 等 PR 交付方法。
- 不在 Agent Instructions 重复完整 PR 恢复命令或工作区准备细节。
- 保留原有 Skill 绑定、工作区方法 Owner、旧 Skill 退役等断言。

不新增测试框架，不以文字形式强制无价值的抽象。

## 3. 修改范围

| 文件 | 修改 |
| --- | --- |
| agents/engineer/instructions.md | 恢复简短的 Tasks 更新和研发工件发布命令引用 |
| skills/pull-request/SKILL.md | 删除研发工件发布章节，优化 Preparation、Submission、Recovery 和 Candidate |
| rondo/test/workspace-preparation-assets.test.mjs | 调整职责归属断言 |

Bug Fix Agent Instructions 保持 PR #57 的版本。native-workspace、其他 Agent、其他 Skill、CLI、Schema、Metadata、Gate、Provisioning 配置、运行机制均不在本轮范围内。

## 4. 验收

1. Engineer 可直接读取批准契约、更新 Tasks、发布研发工件，不因这些动作必须加载 PR Skill。
2. Bug 与 Requirement 均可通过现有 pull-request Skill 准备并提交 PR；Bug 可根据明确 Human 决定恢复，RECREATE_PR 不重复研发准备。
3. 真实授权、必要验证、专业证据、Candidate 身份及交付 Gate 不被弱化。
4. Skill 不要求 Agent 重复 CLI 已完成的确定性核验，不创建新的 Skill、封装或固定调用链。
5. 差异限定为上述三个文件；执行现有针对性静态测试，检查 PR Facts / Recovery 与 Requirement Publication 契约未被改变。真实环境回放如未执行，明确说明，不伪称通过。

## 5. 设计取舍

保持专业结果 Owner 的职责完整性，而非消除所有文字重复。Agent 的简短必要 CLI 指引符合 01 §6.2；Skill 的专业方法与 CLI 输入输出说明属于按需使用指导；CLI 继续负责确定性约束。避免把 pull-request 扩张为综合研发交付 Skill。

本文件仅保存 Review 方案，不代表第二轮优化已实施。PR #57 已按原版本合并。
