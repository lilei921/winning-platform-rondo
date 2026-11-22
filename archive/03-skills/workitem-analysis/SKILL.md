---
name: workitem-analysis
description: 分析 Delivery Issue 的目标、现状、技术变更性质及影响范围，形成可审核的 OpenSpec Change 与 Verify Recommendation；首次分析或定向返工时使用。
---

# workitem-analysis

> **Retired（已退役）**：此文件仅保留历史设计与任务写法参考，**不再由受管 Agent 加载或用于当前 Analysis 执行**。现行 Analysis 使用 Workitem Analyst 按需组合 `codebase-explorer`、`bug-analysis`、`requirement-analysis`、`spec-preparation`、`analysis-completion`；下面保留的旧 Route / Facts 写法不再适用。

## Preconditions / Inputs

- 当前授权的 Delivery Issue、TFS 来源、已有 Change / Analysis Facts 与反馈。
- 默认配置：`config/repo-registry.json`（相对于本 Skill 目录）。
- Analysis 命令使用配置中的 `runtime.workspace_id`。
- **CLI 版本下限：`rondo --version` ≥ 1.2.1**。低于此版本时 resolve-identity 首跑 NOT_FOUND 语义不成立：停止并交 Delivery Lead 升级 CLI，不猜测执行。供给/体检阶段以 `rondo doctor --require rondo_self` 拦截旧 CLI（WARN 按 FAIL 计，exit 2）。

## Procedure

1. 使用 `rondo runtime resolve-root-repo --config "<config-path>" --issue <issue-key>` 定位根仓；解析失败停止，不猜测路径。UNKNOWN 成因枚举：业务仓未挂载 local_directory 资源 / 多 daemon 环境缺 `MULTICA_DAEMON_ID` / 挂载路径无效 / 根仓 `docs/config/repo-context.yaml` 缺失。读取根仓 `docs/config/repo-context.yaml`，结合 Issue、已有有效 Wayfinder 证据与代码语义判断候选业务仓，不依赖关键词单独决策。准入交接的 unknowns 按标注分级处置：**blocking 项未闭合才允许停止交 Human；non-blocking 项不要求闭合**——在 proposal 的 Root Cause/假设段以 `probable` 标注，写明假设内容、依据、验证方式与验证环节（成为 Verify/实现阶段的显式检查点），不为其闭合做与修复方向无关的跨仓考古；存量未标注的 unknown 按 blocking 处理（保守默认）。
2. 澄清目标、当前与预期行为、规则、范围及验收；区分来源事实、观察、假设和建议。按 TFS 管理类型与技术语义判断 Route：Bug → `bug-fix`，Requirement + Corrective → `production-fix`，Requirement + Intentional → `sdd-fast`；超出自动处理范围（`sdd-standard`）交 Human。
3. 按 Route 确定 Schema（前两者为 `corrective-change`，后者为 `intentional-change`），使用 `rondo change resolve-identity` 查找当前 Change。逐值动作：
   - `ACTIVE_FOUND` → 复用其 `change_ref`；metadata 缺失/不一致由 analysis-completion 回写修复，禁止重建；
   - `ARCHIVED_FOUND` → **停止**：不重新应用 Delta、不新建同 ID Change，交 Delivery Lead 判定；
   - `CONFLICT` / `INVALID` → **停止**：禁止取第一个候选、禁止新建掩盖，交 Delivery Lead / Human；
   - `NOT_FOUND` → 仅此时且身份与 Schema 已确定才创建。**含全新根仓无 `openspec/changes/` 目录的首跑形态（rondo ≥1.2.1，exit 0），属合法 NOT_FOUND，按流程创建**；exit 3（openspec/ 定位不到，多为根仓路径传错）为 UNKNOWN，停止不猜测；
   - 创建禁令：Human Reject / Development Rework / change_ref 暂时缺失均不新建，不用 title 相似度猜测。
   执行 OpenSpec CLI 时使用已解析的根仓。
4. 按当前 OpenSpec Schema / Artifact Instruction / Template 沉淀分析与任务。Corrective 形成问题依据、根因、修复及回归范围；Intentional 形成 Requirement / Scenario 与适用的 Design / Tasks；`sdd-fast` 执行专业 AI Review。任务写法见 `references/tasks-md-authoring-contract.md`（按需读取）。Corrective 通常无 Spec-level 行为变化：在 `.openspec.yaml` 设置 `skip_specs: true`，不为通过校验虚构 Delta（schema 约定）。
5. 形成 Verify Recommendation（`required` / `not_required`）、Reason 与 Acceptance / Verification 引用；将当前 Change 引用及 draft Analysis Handoff Facts 交 `analysis-completion` 提交审核，不手工写 `analysis.*` metadata。Gate 确定性检查清单见 `references/analysis-gate-checks.md`（8 项检查与 FAIL/UNKNOWN 处置，提交前自查）。

## Validation

- 关键分析结论有可追溯依据，Change 与当前 Schema 一致；每个 Implementation Task 有对应验证方法。
- 适用的专业 Review 完成；确定性 Gate 由 `analysis-completion` 调用，不以字段齐全替代专业判断。

## Output

- 当前唯一 OpenSpec Change 与必要 Evidence 引用。
- draft Handoff Facts：`route`、`change_ref`、`verify_agent.{recommendation,reason,focus_refs}`；`sdd-fast` 增加 `ai_review.{verdict,findings_ref}`。
- Facts 值域速览：`route ∈ {bug-fix, production-fix, sdd-fast}`；`verify_agent.recommendation ∈ {required, not_required}`；`verify_agent.focus_refs` 为非空字符串的 JSON 数组；`ai_review.verdict ∈ {APPROVED, NEEDS_REVISION}`（仅 sdd-fast）。

## Error Handling / Stop Conditions

- 需求关键事实无法确认：记录缺口，交 Delivery Lead / Human；已有有效结论与 Change 应复用，不无差别重跑。
- 配置、工程身份或解析结果不确定：停止并报告；不复制其他 Workspace 配置，不新建 Change 掩盖冲突。
