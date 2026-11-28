# 15 — Agent / Skill / Rondo CLI 职责边界优化方案

> 日期：2026-11-25
> 基线：PR #57 合并 Commit `cc63ab2`；PR #58 二次 Review
> 设计依据：[01 设计原则](01-multica-openspec-design-guideline.md)

## 1. 目标与职责

Agent 对专业结果负责；Skill 提供可复用场景方法及必要工具输入输出；CLI 执行确定性操作、校验与事实登记。Agent 可直接使用 CLI，Skill 不是强制中间层。遵循 KISS、YAGNI、Specialist Focus、One Rule One Owner、Native First、Minimal Sufficient、Right-sized Execution。

## 2. 最小修复

### 2.1 Requirement 研发工件

Engineer 依据真实研发与验证结果直接更新 `tasks.md` 的完成状态，保持已批准的任务正文和编号，提交当前 Change 的研发工件并使用 `rondo dev publish` 发布；非实质性 Design 细化使用 `--minor-design`。保持现有批准边界；具体参数按需使用 CLI Help，Native 根仓发布须提供实际根仓路径。删除 pull-request 中的 Requirement Artifact Publication，不新增 Skill。Tasks 可随研发进度更新；PR Materialization 前全部 Tasks 完成且研发工件已发布，不人为固定发布与 PR Preparation 的顺序。

### 2.2 专业验证与 CLI 验证

原 `pr prepare` 在运行验证命令前要求 `validation.result=PASS`，迫使未执行的命令提前声明成功或重复验证。

- 有命令时：Agent 提供 `command`、`summary`（范围及必要局限）；无需预填 result，若提供则必须为真实 PASS。CLI 实际执行成功后形成 PASS、exit_code、Candidate 和 source；失败不得降级或登记成功事实。
- Requirement 必须提供命令。Bug 确无适用本地命令时，必须提供真实替代验证 PASS、summary、evidence_refs 及原因、范围、结果和局限。
- Bug Root Cause、Regression、Code Review、Evidence、Blocking Findings 等专业要求保持不变；不得以尚未执行的命令作为 Regression PASS 的唯一依据。研发调试及必要专业验证不受限制。
- Bug 专业输入在执行验证命令前完整校验，仅允许待执行命令的 local_validation.result 缺省。
- 实际命令非零退出后，重新核验授权、Candidate 及当前仓库事实，使用现有 local_validation 登记 FAIL 与真实退出码；Requirement 保留 pr_prep 仓库项，Bug 使用 bug.delivery 并保留已有诊断证据，避免多仓漏交付。首次明确失败也登记失败事实，不登记成功；Bug 首次准备按现有规则固定交付仓集合。Bug 同一 Candidate 的失败不得以无命令替代证据覆盖。写入未确认返回 UNKNOWN；输入错误或命令未能启动不伪造失败结果。
- 保持现有 Metadata 结构、Candidate 核验、授权和 Gate；Bug readiness 拒绝明确失败的 Evidence，Requirement 复用现有 PASS Gate。不新增验证命令、Skill、缓存或生命周期。

### 2.3 PR Skill

Inputs 只描述所需专业 Facts，不重复 Agent 角色职责。Candidate 保留 Fetch/Push 使用方法、非强制 Push、Fetch 不合并与 Bug Refs 尾注；删除分支映射和远端回读机制说明。

PR Preparation 保留 Facts 示例、实际验证及多仓输入契约；Submission 消费全部交付仓准备完成的事实，Bug 使用 ready_for_pr，Requirement 还需研发工件发布。CLI 负责 PR 创建、关联、登记、状态转换及回读；Skill 不要求重复逐字段核验。

Abandoned PR Recovery 根据 Human 明确决定调用 `rondo pr resume`。CLI 仅核验并恢复 PR Facts，原生状态恢复及 Run 交接由相应 Agent 协调。REWORK 重新准备受影响仓，RECREATE_PR 复用未变 Candidate 和有效 Evidence。意图或恢复结果不明时核实当前事实并向 Human 确认。

## 3. 实施范围

- `agents/engineer/instructions.md`
- `skills/pull-request/SKILL.md`
- `rondo/src/commands/pr/prepare.ts`、`pr/validation.ts`、`bug/evidence.ts`、`bug/scope.ts`
- `rondo/COMMANDS.md`（同步现有命令输入说明）
- `rondo/test/workspace-preparation-assets.test.mjs`
- `rondo/test/dev-pr-prep.test.mjs`
- `rondo/test/bug-prepare-pr-cli.test.mjs`、`rondo/test/bug-scope.test.mjs`

不改变其他 Agent、Skill、Provisioning、OpenSpec Schema、Metadata、Git 工作区管理、PR Materialization、Delivery Closeout 或 Human Approval。静态断言保护必要归属和绑定，不以固定句式约束 LLM。

## 4. 验收

1. Engineer 无需 PR Skill 即可更新和发布研发工件；非实质性 Design 与 Commit 条件不丢失。
2. 命令验证无需预填 PASS；真实执行失败必须登记明确 FAIL，既有 PASS 不得继续通过 Gate，多仓事实不丢失；Bug 替代证据和专业质量契约不弱化。
3. 多仓准备完整、恢复 PASS/NOOP 与 RECREATE_PR 使用语义正确。
4. 不新增命令、Skill、Metadata 或固定调用链。
5. 执行现有构建和针对性测试（PR Preparation、Bug CLI、静态资产、研发发布、Completion、Recovery）；未能执行的测试或真实环境回放明确披露。
