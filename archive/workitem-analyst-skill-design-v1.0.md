# Workitem Analyst Skill 设计方案

> Version: 1.0  
> Date: 2026-09-21  
> Scope: Multica Delivery Squad 中 Workitem Analyst Agent 的 Skill 拆分、执行驱动、上下文分析与 Review 机制  
> Status: Baseline

## 1. 目标

Workitem Analyst 负责 Delivery Issue 的需求 / Bug 分析阶段。

本方案从现有 `winning-platform-monorepo` 的 `fire`、`requirement-analysis`、`requirement-brainstorm`、`requirement-review`、`bug-analysis`、根级 `AGENTS.md`、`docs/router/*` 与 `code-intelligence` / CodeGraph 中提炼已有有效机制。

迁移到 Multica 后，不复制旧 Harness 的全局 Workflow Runtime、Stage Machine 和 `workflow-runner`。

核心原则：

> **Workitem Analyst 负责 Analysis 内部的专业执行，不负责整个 Delivery 生命周期编排。**

> **Multica 保存当前工作事实；Skill 定义方法；脚本负责确定性校验；Delivery Lead 负责 Analysis 之外的跨角色协调。**

---

## 2. Workitem Analyst 的职责边界

### 2.1 负责

- 读取当前 Delivery Issue / Analysis 上下文；
- 区分 Requirement / Bug；
- 构建并维护 Context Pack；
- Requirement 的需求澄清、方案探索、影响分析和验收标准分析；
- Bug 的复现路径、根因证据链、假设验证和修复策略分析；
- 形成 Development Task Graph；
- Requirement 的独立 AI Review 闭环；
- Analysis Package 组装、确定性校验与发布；
- Human Review Reject 后的 targeted rework。

### 2.2 不负责

- 全局 Delivery Workflow；
- Analysis → Development 的全局生命周期切换；
- 创建 / 分配 Development Sub-Issue；
- 选择具体 Engineer；
- 代码实现、Verify、PR、Merge；
- Delivery Completion；
- 维护第二套 workflow state。

---

## 3. Superpowers 的处理原则

原有 Requirement 与 Bug 分析分别依赖：

- `superpowers:brainstorming`
- `superpowers:systematic-debugging`

新方案不再将 Superpowers 作为 Workitem Analyst 的运行时硬依赖。

采用：

> **保留方法，移除依赖。**

### 3.1 Requirement

吸收 `brainstorming` 中有效的方法：

- 需求澄清；
- 多方案探索；
- 推荐方案与理由；
- 关键约束；
- Open Questions；
- 人工决策点。

这些方法直接成为 `requirement-analysis` 的 Procedure，不再运行时调用 `superpowers:brainstorming`。

### 3.2 Bug

吸收 `systematic-debugging` 的核心方法：

```text
Root Cause Investigation
→ Pattern Analysis
→ Hypothesis & Verification
→ Fix Strategy
→ Regression Scope
```

这些步骤直接成为 `bug-analysis` 的方法，不再要求运行时调用 Superpowers。

---

## 4. 最终 Skill 结构

```text
Workitem Analyst
│
├── workitem-analysis
├── context-analysis
├── requirement-analysis
├── bug-analysis
├── development-planning
├── requirement-review
└── analysis-completion
```

| Skill | 定位 |
|---|---|
| `workitem-analysis` | Analysis Driver / Canonical Entry |
| `context-analysis` | 跨阶段上下文分析与 Context Pack 构建 |
| `requirement-analysis` | Requirement 专业语义分析 |
| `bug-analysis` | Bug 根因分析与假设验证 |
| `development-planning` | Development Task Graph 设计 |
| `requirement-review` | Requirement 独立 Reviewer Subagent |
| `analysis-completion` | Analysis Package / Gate / Publish |

---

## 5. 为什么使用 `context-analysis`

原方案使用 `analysis-context`，本版调整为：

```text
context-analysis
```

原因：

1. Context Pack 不只服务 Analysis 阶段；
2. Development、Verify、Requirement Review 等阶段后续都可能复用；
3. Skill 的核心动作是“分析当前工作对象的工程上下文”，而不是表达“Analysis 阶段的 Context”。

因此：

```text
context-analysis
= reusable engineering context analysis
```

输出仍以 `context-pack.md` 为主，它不是 Requirement 私有资产。

---

## 6. `context-analysis` 的定位

`context-analysis` 是本项目的：

> **Engineering Context Grounding Capability**

推荐目录：

```text
context-analysis/
├── SKILL.md
├── modules/
│   ├── repository-routing.md
│   ├── external-knowledge.md
│   └── code-investigation.md
├── scripts/
│   └── validate-context.py
├── references/
│   └── context-pack-schema.md
└── templates/
    └── context-pack.md
```

---

## 7. Repository 定位：AGENTS.md 是一级入口

根级 `AGENTS.md` 第 1 章已经定义“工作区仓库与边界”，维护：

- Repository 名称；
- 类型；
- 主要职责；
- 业务关键词；
- 不负责的范围。

并明确要求各 Skill 的项目定位逻辑从该表动态读取关键词，不再硬编码。

因此 `context-analysis` 的 Repository Routing 必须首先使用：

```text
AGENTS.md §1 工作区仓库与边界
```

而不是直接从 `docs/router/overview.md` 开始。

### 7.1 一级 Repository Routing

输入：

```text
Issue / TFS Work Item
External Knowledge
```

根据 `AGENTS.md §1` 识别：

```text
candidate_repositories
candidate_domains
frontend/backend/flink/common
```

原则：

- 不在 Skill 中维护 repository → keyword 的重复映射；
- 不硬编码当前仓库清单；
- 新增子仓后，只更新 `AGENTS.md`；
- Skill 动态读取当前工作区定义。

---

## 8. 渐进式 Context 加载顺序

正式顺序：

```text
① Current Work Item / Issue
        ↓
② external-knowledge.md
        ↓
③ Root AGENTS.md §1
   Repository / Domain Routing
        ↓
④ Target Repository Instructions
   （存在子仓 AGENTS.md / 项目说明时按需读取）
        ↓
⑤ docs/router/overview.md
        ↓
⑥ docs/router/*-mapping.md
        ↓
⑦ code-intelligence / CodeGraph
        ↓
⑧ caller / callee / impact analysis
        ↓
⑨ Exact Source Read
        ↓
⑩ ripgrep / code search fallback
```

形成：

```text
业务事实
→ 人工补充知识
→ 仓库定位
→ 模块 / API 路由
→ 代码知识图谱
→ 精确源码证据
```

---

## 9. AGENTS.md 与 docs/router 的边界

### AGENTS.md

回答：

```text
这个需求大概率属于哪个 Repository / Domain？
```

主要解决：

- Monorepo 一级仓库定位；
- frontend / backend / flink / common 等边界；
- 仓库职责；
- 业务关键词。

### docs/router/overview.md

回答：

```text
在已经基本确定 Repository 后，
具体页面 / API / Controller / 调用入口在哪里？
```

主要解决：

- 前后端调用路由；
- Controller Mapping；
- API Mapping；
- 页面 / 模块入口。

正式顺序：

```text
AGENTS.md
→ docs/router
→ CodeGraph
→ Source
```

---

## 10. Code Intelligence / CodeGraph

`context-analysis` 继续保留原项目的 Code Intelligence 设计。

优先描述抽象能力：

```text
code-intelligence.repo_status
code-intelligence.search_symbols
code-intelligence.get_context
code-intelligence.find_callers
code-intelligence.find_callees
code-intelligence.impact_analysis
code-intelligence.list_files
```

Skill 不绑定具体 `mcp__codegraph-*` 名称，Provider 映射由项目配置负责。

---

## 11. 搜索降级顺序

```text
AGENTS.md repository routing
        ↓
docs/router
        ↓
code-intelligence
        ↓
exact source read
        ↓
code search / ripgrep fallback
```

禁止一开始全 Monorepo grep。

当 CodeGraph 已定位目标符号时，不再进行无目的全仓搜索。

---

## 12. External Knowledge

继续保留：

```text
external-knowledge.md
```

用于承载代码和 TFS 中无法可靠推导的信息，例如：

- 产品经理补充；
- 客户现场事实；
- 历史 Requirement；
- 已确认业务规则；
- 兼容性要求；
- 数据迁移约束；
- 人工决策。

规则：

```text
存在 → 必须加载并记录来源
不存在 → context-pack 中明确 external_knowledge = none
存在但无法读取 → Context Readiness 不得直接 PASS
```

---

## 13. Context Pack

`context-analysis` 的主要产物：

```text
context-pack.md
```

推荐结构：

```markdown
# Context Pack

## Work Item
## External Knowledge
## Repository Routing
## Repository Boundaries
## Entry Points
## Router Evidence
## Code Evidence
## Call Paths
## Existing Patterns
## Acceptance Signals
## Constraints
## Open Questions
## Evidence Gaps
## Source Inventory
```

Context Pack 是跨阶段 Artifact，可被：

```text
requirement-analysis
bug-analysis
development-planning
requirement-review
Engineer
Verify
```

按需读取。

---

## 14. Requirement 执行链

```text
workitem-analysis
        ↓
context-analysis
        ↓
requirement-analysis
        ↓
development-planning
        ↓
requirement-review
        │
        ├── APPROVED
        │       ↓
        │ analysis-completion
        │
        └── NEEDS_REVISION
                ↓
         targeted rework
                ↓
         requirement-review
```

最后：

```text
analysis-completion
        ↓
Analysis Gate
        ↓
Human Analysis Review
```

---

## 15. Bug 执行链

Bug 不默认执行独立 AI Review：

```text
workitem-analysis
        ↓
context-analysis
        ↓
bug-analysis
        ↓
development-planning
        ↓
analysis-completion
        ↓
Analysis Gate
        ↓
Human Analysis Review
```

---

## 16. 为什么 Bug 不需要独立 AI Review

Requirement 的主要风险是：

```text
方案是否合理？
边界是否完整？
是否遗漏重要影响？
Task Graph 是否符合设计意图？
```

因此独立 Reviewer 有价值。

Bug 不同。`bug-analysis` 本身采用：

```text
Evidence
→ Root Cause Hypothesis
→ Verification
→ Pattern Comparison
→ Root Cause Confirmation
```

即已经具备“提出假设 → 证据验证 → 推翻或确认”的反馈机制。

因此 Bug 的质量控制采用：

```text
bug-analysis 内部 Hypothesis Verification
        +
analysis-completion Deterministic Gate
        +
Human Analysis Review
```

第一版不再增加独立 AI Reviewer。

---

## 17. Bug Analysis 内部验证要求

`bug-analysis` 必须明确区分：

```text
Observation
Hypothesis
Evidence
Verification
Conclusion
```

建议输出：

```yaml
root_cause:
  status: confirmed | probable | unknown
  summary: ...
  evidence:
    - ...
  rejected_hypotheses:
    - ...
```

只有存在可追溯 Evidence 时才能声明：

```text
root_cause = confirmed
```

若根因仍为 `probable/unknown` 且继续开发风险较高：

```text
→ STOP / Human Decision
```

---

## 18. Requirement Review

原 `requirement-review` 的 Independent Reviewer 思路继续保留。

推荐使用：

```text
read-only Reviewer Subagent
```

Reviewer 只负责 Review，不修改 Analysis Artifact。

### 输入

```text
context-pack.md
requirement analysis draft
Development Task Graph
decision requests / resolved decisions
相关 Evidence
```

### 输出

```yaml
verdict: APPROVED | NEEDS_REVISION

issues:
  - id:
    severity:
    area:
    description:
    evidence:
    suggestion:
    auto_fixable:
```

`area` 至少支持：

```text
context
requirement
solution
impact
acceptance_criteria
task_graph
verification
risk
```

---

## 19. Reviewer Subagent 的边界

Subagent 是 Workitem Analyst 一次 Run 内部的临时执行单元，不是 Multica Squad Member，也不拥有 Issue。

允许：

- 读取 Analysis Draft；
- 读取 Context Pack；
- 重新验证 Code Evidence；
- 调用 Code Intelligence；
- 精读源码；
- 输出 Review Artifact。

禁止：

- 修改 Analysis Draft；
- 修改生产代码；
- 修改 Delivery Issue 状态；
- 修改 TFS；
- 推进 Delivery 生命周期。

---

## 20. Requirement Review 回环

推荐最多 2 rounds：

```text
Round 1
  ↓
NEEDS_REVISION
  ↓
Targeted Rework
  ↓
Round 2
  ↓
APPROVED
```

Round 2 仍存在重大问题：

```text
→ blocked / Human Escalation
```

不建立独立 Workflow Runtime。

---

## 21. Targeted Rework

Reviewer 返回 `area` 后，`workitem-analysis` 只重跑受影响能力：

```text
context
→ context-analysis

requirement / solution / impact / acceptance_criteria
→ requirement-analysis

task_graph / verification
→ development-planning
```

禁止 Review FAIL 后全量重跑 Analysis。

---

## 22. Requirement Analysis

`requirement-analysis` 负责：

```text
Requirement Understanding
Clarification
Solution Exploration
Selected Solution
Impact Analysis
Acceptance Criteria
Constraints
Risks
Open Decisions
```

原 `superpowers:brainstorming` 的有效方法直接内化。

以 `context-pack.md` 作为主要 Grounding Input。

---

## 23. Bug Analysis

`bug-analysis` 负责：

```text
Symptom
Expected vs Actual
Reproduction
Failure Path
Root Cause Investigation
Pattern Analysis
Hypothesis & Verification
Affected Scope
Fix Strategy
Regression Scope
Acceptance Criteria
Verification Requirements
```

原 `superpowers:systematic-debugging` 的有效方法直接内化。

---

## 24. Development Planning

原 `development-task-planning` 正式改名：

```text
development-planning
```

负责：

```text
Development Task Graph
Repository
Role
Dependencies
Acceptance Criteria Mapping
Verification Requirements
Contracts
```

不负责：

```text
具体代码修改步骤
具体实现顺序
测试 CLI
创建 Multica Sub-Issue
```

Development Task Graph Materialization 属于 Analysis Approved 后的 Delivery Lead。

---

## 25. Analysis Completion

`analysis-completion` 负责：

### Assemble

组装：

```text
Problem / Requirement
Current Behavior
Expected Behavior
Root Cause（Bug）
Solution
Impact Scope
Repository Scope
Acceptance Criteria
Development Task Graph
Dependencies
Verification Requirements
Risks
Evidence
Open Decisions
```

### Validate

确定性检查：

```text
required fields
repository scope
AC
task graph
depends_on
cycle
verification requirements
unresolved decision
```

输出：

```yaml
result: PASS | FAIL | UNKNOWN
reasons:
  - ...
```

### Publish

PASS 后：

```text
写 Analysis Artifact
写 Issue Summary
analysis.review_status = waiting
STOP
```

等待 Human Analysis Review。

---

## 26. `workitem-analysis` Driver

`workitem-analysis` 是 Workitem Analyst 唯一 Canonical Entry。

它不持久化自己的 workflow state。

```text
读取当前 Multica Issue / Artifact / Review Feedback
        ↓
计算下一能力
        ↓
执行对应 Skill
        ↓
重新读取事实
        ↓
继续或停止
```

典型 Route：

```text
Context 缺失 / 过期
→ context-analysis

Requirement + Analysis 缺失 / 过期
→ requirement-analysis

Bug + Root Cause 未完成
→ bug-analysis

Development Task Graph 缺失 / 过期
→ development-planning

Requirement Draft 未 Review
→ requirement-review

Requirement Review NEEDS_REVISION
→ targeted rework

Requirement Review APPROVED
→ analysis-completion

Bug Analysis 完成
→ analysis-completion

Human Decision Required
→ STOP

Completion Gate PASS
→ STOP / waiting Human Review
```

---

## 27. 推荐目录

```text
workspace-skills/
│
├── workitem-analysis/
│   ├── SKILL.md
│   ├── scripts/
│   │   └── resolve-analysis-route.py
│   └── references/
│       └── analysis-routing.md
│
├── context-analysis/
│   ├── SKILL.md
│   ├── modules/
│   │   ├── repository-routing.md
│   │   ├── external-knowledge.md
│   │   └── code-investigation.md
│   ├── scripts/
│   │   └── validate-context.py
│   ├── references/
│   │   └── context-pack-schema.md
│   └── templates/
│       └── context-pack.md
│
├── requirement-analysis/
│   ├── SKILL.md
│   └── modules/
│       ├── clarification.md
│       ├── solution-analysis.md
│       └── impact-analysis.md
│
├── bug-analysis/
│   └── SKILL.md
│
├── development-planning/
│   ├── SKILL.md
│   └── scripts/
│       └── validate-task-graph.py
│
├── requirement-review/
│   ├── SKILL.md
│   └── references/
│       └── review-schema.md
│
└── analysis-completion/
    ├── SKILL.md
    ├── scripts/
    │   └── validate-analysis.py
    ├── references/
    │   └── analysis-package-schema.md
    └── templates/
        └── analysis-package.md
```

---

## 28. 最终执行模型

### Requirement

```text
Delivery Lead
   ↓
@Workitem Analyst
   ↓
workitem-analysis
   ↓
context-analysis
   ↓
requirement-analysis
   ↓
development-planning
   ↓
requirement-review
   ↓
┌───────────────┬─────────────────┐
│ APPROVED      │ NEEDS_REVISION  │
│               ↓                 │
│         targeted rework         │
│               ↓                 │
│        requirement-review       │
└───────────────┴─────────────────┘
   ↓
analysis-completion
   ↓
Deterministic Analysis Gate
   ↓
Human Analysis Review
```

### Bug

```text
Delivery Lead
   ↓
@Workitem Analyst
   ↓
workitem-analysis
   ↓
context-analysis
   ↓
bug-analysis
   │
   ├── Root Cause Investigation
   ├── Pattern Analysis
   ├── Hypothesis
   └── Verification
   ↓
development-planning
   ↓
analysis-completion
   ↓
Deterministic Analysis Gate
   ↓
Human Analysis Review
```

---

## 29. 最终设计决策

| 项目 | 决策 |
|---|---|
| Superpowers | 不再作为运行时硬依赖 |
| brainstorming | 方法吸收到 `requirement-analysis` |
| systematic-debugging | 方法吸收到 `bug-analysis` |
| Context Skill | 使用 `context-analysis` |
| Context Pack | 保留，并升级为跨阶段共享 Artifact |
| Repository 一级定位 | 根级 `AGENTS.md` §1 |
| Router | Repository 定位后使用 `docs/router/*` |
| Code Intelligence | 保留，当前 provider 为 CodeGraph |
| ripgrep | 仅 fallback |
| Requirement Review | 保留 Independent Reviewer Subagent |
| Bug Review | 不增加独立 AI Review |
| Bug 质量闭环 | Hypothesis Verification + Analysis Gate + Human Review |
| Development Planning | 使用 `development-planning` |
| Review Rework | targeted rework，不全量重跑 |
| Workflow State | 不新建第二套 Analysis Runtime |
| Human Review | Requirement / Bug 都保留最终 Human Analysis Review |

---

## 30. 核心原则总结

> **Context 是跨阶段资产，不属于 Requirement 私有能力。**

> **仓库定位先读 AGENTS.md，再下钻 Router 和 Code Intelligence。**

> **Requirement 需要独立 Reviewer；Bug 优先依靠可证伪的根因假设验证。**

> **Superpowers 保留方法，不保留流程控制权。**

> **Workitem Analyst 内部由 `workitem-analysis` 做轻量 Driver，不建设新的 Workflow Engine。**

> **能够程序化判断的完整性和图合法性问题交给 Deterministic Gate；语义分析交给 Agent。**

> **Analysis 结束后停止在 Human Review 边界，不自行进入 Development。**
