# Multica 研发任务闭环方案 v1.4.7

> 目标：基于 Multica 原生 Squad、Issue、Run、`@mention`、Sub-Issue、Stage、自定义 Status 与 Autopilot 能力，构建“需求同步 → 分析 → Analysis Review → 研发 → 按需独立验收 → PR 提交 → 等待合并 → 归档”的研发闭环。  
> 核心原则：**Squad 负责角色协作，Sub-Issue 负责独立交付单元，Deterministic Gate 负责硬条件，Multica 负责运行与状态。**

> Terminology：本方案中的 Squad、Agent、Issue、Status、Route、Gate 等名称统一遵循 `multica-design-guideline-v1.4.md` 的 Canonical Terminology；本方案不维护第二套全局术语。

> Updated: 2026-09-28

---

# 1. 设计目标

整个研发任务默认作为一个完整的 **Delivery Issue** 管理。

一个 TFS Work Item 默认对应一个 Delivery Issue，并由 **Delivery Squad** 负责协作执行。

研发过程中：

- Workitem Analyst、各专业 Engineer、Verify Agent 等角色变化，不因为角色变化创建新的 Issue；
- Engineer 的 Local Validation 与 Code Review 属于 Development 必备质量机制，与 Verify Agent 是否参与无关；
- Verify Agent 是按需参与的 **behavior-oriented 独立验收者**，不依赖 Engineer 的实现过程，从 Acceptance Criteria / Verification Requirements 出发验证最终行为；
- Integration / E2E Verification 不再作为独立 Post-Merge 阶段，而是 Verify Agent 在需要时采用的验证方式；
- 只有出现真正能够独立推进、独立验证边界、独立失败 / 重试和独立完成的交付单元时，才创建 Development Sub-Issue；
- **Workitem Analyst 负责技术分析与研发准备，不以掌握 Squad Roster、选择成员或生成最终执行 Task Graph 为 Analysis 前提；**
- **`sdd-fast` 使用 OpenSpec 作为 Versioned Change Contract；OpenSpec 承载被批准的行为变化与研发准备，不承担 Multica Runtime、成员分工、Sub-Issue、Stage 或 Delivery Status；**
- **Delivery Lead 在已批准的技术与验收边界内，结合当前 Roster 正常承担成员选择、工作分工与交接；独立工作使用 Assignment，当前 Issue 内协作使用 `@mention`；**
- **启动、Assignment、`@mention` 与 Parent / Stage 回流优先复用 Multica；简单成员分工由协作规则表达，业务硬条件、物化、副作用与幂等由必要的 Script / Gate 承担；**
- **Deterministic First，Semantic Fallback 适用于明确硬条件与可靠事实；专业分析、成员选择和协作安排由相应 Agent 正常承担，不以脚本先返回 `UNKNOWN` 为前提；**
- **确定性机制返回 `UNKNOWN` 或出现事实冲突时，Delivery Lead 协调适当的 Specialist / Human 查明原因、补充信息；不得据此覆盖明确 `FAIL` 或替代人工批准；**
- Delivery Lead 不替代 Workitem Analyst、Engineer、Verify Agent 的专业工作，但负责决定当前需要哪种专业能力、如何组织成员协作以及何时需要 Human；
- PR 审核过程由 TFS / PR Platform 管理；Multica 不复制外部 Review 状态机。`pr-status-sync` 只依据 TFS 实际可观测的 PR `status` 检测终态：`completed` 表示正常完成，`abandoned` 表示当前 PR 已无法继续并进入人工决策；`active` 保持等待，未知或异常数据返回 `UNKNOWN`。

---

# 2. 总体架构

```text
                     TFS / PR Platform
                             │
                Autopilot / External State Sync
                             │
                             ▼
                      Multica Runtime
                             │
                       Delivery Issue
                    Owner = Delivery Squad
                             │
                             ▼
                       Delivery Lead
                    首次分析委派 / 当前协调
                             │
                    @Workitem Analyst
                             │
                             ▼
                       Analysis Package
                 技术范围 / 约束 / 研发准备 / AC
                             │
                        Analysis Gate
                             │
                     Human Analysis Review
                             │
                             ▼
                       Delivery Lead
                批准边界 + 当前 Roster → 分工与委派
                             │
              原生操作 / 必要脚本落实已确定安排
                             │
               ┌─────────────┴──────────────┐
               ▼                            ▼
        Simple Delivery               Complex Delivery
      父 Issue @Engineer             独立 Development Sub-Issues
               │                     默认 Specialist-owned
               │                            │
               └─────────────┬──────────────┘
                             ▼
                    Engineering Contract
                实现 / Local Validation / Code Review
               Commit / Push / PR Preparation / Evidence
                             │
                  Development Completion Check
                             │
                 Multica 原生协作 / Parent 回流
                             │
                             ▼
                  Parent Delivery / Delivery Lead
                             │
               Verify Agent（按已批准要求参与）
                             │
                     PR Materialization
                             │
                       PR Status Sync
                             │
                    Finalize / Delivery Done
```

## 2.1 Agent 定位与介绍

以下为各 Agent 的职责摘要；具体执行边界见 §3、§7、§10、§15–§18。`Delivery Squad` 是协作单元，不是另一个 Agent。

| Agent | 在交付中的位置 | 定位与主要工作 | 交付与边界 |
|---|---|---|---|
| **Delivery Lead** | Delivery Squad 的 Leader；父 Delivery 的协调入口 | 读取已批准的技术与验收要求、当前 Roster 和执行事实，选择成员，组织必要分工，确定 Owner、Assignment / `@mention` 与交接顺序；处理跨角色问题 | 形成可执行的协作安排并持续协调；不重复专业分析、不编写生产代码、不替代验收或 Human Approval，也不管理底层 Run 调度 |
| **Workitem Analyst** | Squad 分析成员 | 完成 Requirement / Bug Analysis、技术范围与依赖分析、Fix Strategy / Solution、研发准备、AC 和 Verification Requirements；按需提出技术拆分及能力需求建议 | 交付 Analysis Package 与 Verify Agent Recommendation；不负责选择当前小队成员、确定最终 Sub-Issue 分工或输出强制的运行 Task Graph |
| **Backend Engineer** | 后端专业成员；可作为独立 Sub-Issue Owner | 在已批准范围与当前 Unit 内完成后端实现、Local Validation、Code Review 和整改 | 交付 Commit / Push、PR Preparation 与 Development Evidence；不重新定义需求或决定整个 Delivery 的分工 |
| **Frontend Engineer** | 前端专业成员；可作为独立 Sub-Issue Owner | 在已批准范围与当前 Unit 内完成前端实现、本地与必要浏览器验证、Code Review 和整改 | 交付当前 Unit 的工程成果与 Evidence；不把技术步骤自行扩展成新的交付任务 |
| **Flink Engineer** | Flink / 流处理专业成员；可作为独立 Sub-Issue Owner | 在已批准范围与当前 Unit 内完成流处理实现、相关行为验证、Code Review 和整改 | 交付当前 Unit 的工程成果与 Evidence；涉及已批准 Contract / Scope 的实质变更时升级 |
| **Verify Agent** | 按需参与的 Delivery-level 验收成员 | 从 AC / Verification Requirements 出发，对明确候选 Commit Set 进行独立行为验收，并归因 Finding | 交付 Verification Report 与失败证据；不替代 Engineer 的 Local Validation / Code Review，不修改生产代码 |
| **TFS Sync Agent** | Squad 外的 Autopilot Thin Adapter | 通过 `tfs-sync` 获取 TFS 原始事实、调用确定性同步并汇总结果 | 初始化 Delivery Issue 为 Squad-owned、`backlog`；不主动启动研发、不修改既有执行 Ownership |
| **PR Status Sync Agent** | Squad 外的 Autopilot Thin Adapter | 读取已登记 PR 的外部终态，调用确定性 reconcile 与有界 finalize | 回写已确认事实并恢复未完成副作用；不解释普通 Review 意见、不推断 abandoned 的业务原因 |

## 2.2 协作与执行边界

> **Workitem Analyst 让工作在技术上清楚；Delivery Lead 让工作在协作上可执行；Engineer 实现当前工作；Verify Agent 按需独立验收；Script 保障明确硬条件和副作用；Multica 承担实际运行。**

技术分析、协作安排和工程实现不合并成一个笼统的规划职责，也不要求新增三份计划文档。技术内容保留在 Analysis Package / OpenSpec；协作安排保存在现有 Issue、Owner、Sub-Issue、Stage 与必要交接说明中；详细实现由 Engineer 在批准边界内决定。

Human 批准技术与验收边界。Leader 的正常成员选择与协作安排无需先等待 Script 返回 `UNKNOWN`；已有明确安排时直接复用。需要改变批准边界时，按 §9.1 返回相应 Specialist / Human。

---

# 3. 核心职责模型

系统分为六个核心层次。

## 3.1 Multica Runtime

负责：

- Issue；
- Status；
- Assignee；
- Squad；
- Agent Run；
- `@mention`；
- Sub-Issue；
- Stage；
- Comments；
- Metadata；
- Autopilot；
- Run History。

Multica 是研发流程状态的主要持久化载体。

---

## 3.2 Delivery Squad

负责一个研发任务内部的多角色协作。

推荐成员：

```text
Delivery Squad

Leader
└── Delivery Lead

Members
├── Workitem Analyst
├── Backend Engineer
├── Frontend Engineer
├── Flink Engineer
└── Verify Agent
```

Delivery Issue 默认分配给 Delivery Squad。

---

## 3.3 Delivery Lead

Delivery Lead 是 Delivery Squad 的 Leader，负责在已批准的技术与验收边界内组织分工、委派与交接，并协调执行中的跨角色问题。

核心定位：

> **Parent Delivery Coordination：技术方案由 Workitem Analyst 准备；成员选择与协作安排由 Delivery Lead 负责；已确定动作由原生能力和必要脚本落实。**

Delivery Lead 的职责包括：

- 读取当前 Delivery Issue / Development Sub-Issue 的事实、已批准 Analysis Package、现有协作安排与当前 Squad Roster；
- 结合工作内容、成员角色和能力选择执行者；已有明确且仍有效的分工时直接复用，不要求每次重新选择；
- 判断哪些工作需要独立 Owner、推进与完成，按需组织 Development Sub-Issue；不按技术步骤数、Repository 数量或 PR 数量机械拆分；
- 父 Delivery 保持 Squad-owned；明确独立工作直接 Assignment 给 Specialist，当前 Issue 内的专业协作使用 `@mention`；只有 Unit 本身需要持续多角色协作时才 Squad-owned；
- 尊重已批准技术依赖与约束，安排协作顺序、允许的并行工作和必要 Stage；不把运行时调用关系自动当作开发完成依赖；
- 调用原生能力和必要 Script / Gate，落实已确定的协作安排、校验硬条件并执行副作用；不要求为正常成员选择先运行通用 Router；
- 在父 Delivery Issue 上协调按批准要求执行的 Verify、结果回流、受影响 Unit 的定向返工以及后续 PR / Completion；
- 遇到事实冲突、输入不足或 `UNKNOWN` 时，协调适当的 Specialist / Human 查明原因、补充信息或调整执行安排；需要改变批准边界时停止相应推进并升级。

Delivery Lead 不负责：

- 替代 Workitem Analyst 重新调查已确认根因、重做需求分析或另选技术方案；
- 替代 Engineer 决定类 / 函数拆分、详细实现步骤、生产代码、正式 Local Validation 或 Code Review；
- 替代 Verify Agent 完成 Acceptance Verification，或替代 Human Approval / Business Decision；
- 把所有明确的 Development Sub-Issue 强制交给 Squad，或介入 Specialist-owned Sub-Issue 的每个内部开发步骤；
- 实现底层 Run 队列、调度器、全局事务或第二套 Workflow Runtime；
- 覆盖明确 Gate `FAIL`，或把 `UNKNOWN` 当作自行放宽硬条件的权限。

成员选择、工作分工和交接是 Leader 的正常协作职责，不仅是异常兜底。`Deterministic First，Semantic Fallback` 的适用范围见 §27：可靠规则已决定的结论不重复裁量；本来需要专业或协作语义判断的工作，直接由相应角色承担。

Delivery Lead 每次 Run 应保持短生命周期：

```text
读取当前事实 / 已批准边界 / 现有协作安排
    ↓
├─ 已有安排或结果仍有效
│    → 复用；等待或只补尚未完成的动作
│
├─ 当前确需成员选择、分工或交接
│    → 结合 Roster 作出有边界的协作决定
│    → 原生派发 / 必要脚本落实
│
├─ 当前动作有明确硬条件
│    → 使用相应 Gate / Check；不重新裁量可靠结果
│
└─ 事实冲突、输入不足或无法安全推进
     → 协调适当的 Specialist / Human
    ↓
结束 Run
```

以上是按当前问题选择处理方式，不是每次 Run 必须执行的四步流水线。不长期驻留等待其他 Agent；按 §12.2 识别尚需执行的工作，无新增动作时记录 `no_action` 并结束，不重复规划或机械重放已派发工作。

---

## 3.4 Specialist Agent

专业 Agent 负责具体工作。

```text
Workitem Analyst
    = 需求 / Bug 分析与研发准备
    = 技术范围、依赖、约束与实现建议
    = 定义 Acceptance Criteria / Verification Requirements
    = 提出 Verify Agent Required / Not Required
    = 按需提出技术拆分建议，不决定最终小队分工

Backend / Frontend / Flink Engineer
    = 研发实现
    = Local Validation
    = Code Review
    = Development Evidence

Verify Agent
    = 按需独立验收
    = behavior-oriented
    = Acceptance / Runtime / Integration / E2E Verification（按需）
```

专业 Agent 不承担整个研发流程的全局编排。Workitem Analyst 不以读取 Squad Roster 或掌握具体成员配置为 Analysis 前提；Engineer 在当前工作范围内决定实现细节，不替代 Delivery Lead 组织整体分工。

---

## 3.5 Deterministic Gate

负责程序化、确定性的判断。

包括：

```text
Analysis Gate
Task Graph Gate
Development Completion Check
Verification Gate（仅 Verify Agent required 时）
PR Transition Gate
Delivery Completion Gate
```

`Task Graph Gate` 仅在存在已明确的任务 / 依赖结构时检查结构硬条件，不判断成员是否最适合执行，也不要求每个 Analysis 先生成完整执行 Task Graph。它不承担技术或协作规划。

统一返回：

```yaml
result: PASS | FAIL | UNKNOWN
reasons:
  - ...
```

统一语义：

```text
PASS
→ 当前 Gate 控制的转换可以继续

FAIL
→ 当前条件明确不满足
→ 按该 Gate 自己定义的 wait / rework / stop / recovery 处理

UNKNOWN
→ 当前规则无法可靠判断
→ Delivery Lead / Human
```

不同 Gate 的 `FAIL` 不强制映射为同一种行为，例如：

```text
Analysis Gate FAIL
→ Workitem Analyst targeted rework

Development Completion Check FAIL
→ 当前 Development Unit 未满足完成契约，按明确缺失条件 targeted rework

Verification Gate FAIL
→ Engineer targeted rework

PR Transition Gate FAIL
→ 等待或补齐缺失条件

Delivery Completion Gate FAIL
→ 不允许关闭
```

Agent 不允许覆盖一个明确的 Gate `FAIL`。

---

## 3.6 External State Sync

负责同步 Multica 外部事实。

当前主要包括：

```text
TFS Work Item
PR status = completed
PR status = abandoned
```

PR 的一般 Review 过程、Changes Requested、Approved、Review Feedback 等属于 TFS / PR Platform 自己的审核过程，Multica 不复制，也不作为自动路由输入。

PR 外部事实统一以 provider 返回的 `status` 为权威字段：

```text
active
= 当前 PR 仍在外部流程中
= NO-OP

completed
= Success Event
= 当前 PR 正常完成

abandoned
= Exceptional Stop Event
= 当前 PR 已无法沿现有路径继续，但无法仅根据该事实判断是“审核拒绝”还是“主动丢弃”

其他值 / 字段异常 / 身份不一致
= UNKNOWN
```

`mergeStatus`、`mergeCommitId`、`mergeCommitMessage` 只作为辅助证据，不得替代 `status=completed` 判断 PR 完成。

External State Sync 只负责识别、校验、持久化并回流这些外部事实，不推断 `abandoned` 的业务原因。`REJECTED / DISCARDED` 只属于后续 Human Decision，不属于 TFS 同步事实。

---

# 4. Issue 模型

采用：

> **Deliverable-oriented Issue Model**

而不是按流程阶段拆 Issue。

默认只有：

```text
Delivery Issue
```

简单任务：

```text
Delivery Issue
└── 无 Sub-Issue
```

复杂任务：

```text
Delivery Issue
│
├── Backend Delivery
├── Frontend Delivery
└── Flink Delivery
```

不默认创建：

```text
Analysis Issue
Verify Issue
PR Issue
Integration Verify Issue
```

角色变化不等于新的 Issue。

---

# 5. TFS Sync

TFS Sync 由 Multica Autopilot 触发，采用 **Thin Agent Adapter + Deterministic Script**：

```text
Multica Autopilot
      ↓
TFS Sync Agent（Thin Adapter）
      ↓
tfs-sync deterministic script
      ↓
Structured Result
      ↓
END
```

TFS Sync Agent 不自行做同步业务判断，主要负责调用确定性能力并返回结果。

确定性同步负责：

1. 查询符合条件的 TFS Work Item；
2. 创建对应 Delivery Issue；
3. 写入 TFS 原始上下文；
4. 设置：
   - assignee = Delivery Squad
   - status = backlog
5. 保持同步幂等；
6. 已存在 Issue 时只更新 TFS 管理字段；
7. 不修改已有 Issue 的执行状态和负责人；
8. 不主动启动研发。

推荐 metadata：

```yaml
source: tfs
tfs.id: "<work-item-id>"
tfs.type: "<Requirement|Bug>"
tfs.url: "<url>"
tfs.changed_at: "<changed-date>"
```

当人工确认任务可以执行时：

```text
backlog → todo
```

因为 Delivery Issue 由 Delivery Squad 持有，Multica 按 Squad 原生机制启动 Delivery Lead。

---

# 6. Delivery Issue 启动

Delivery Issue 默认由 Delivery Squad 持有。

人工将 Delivery Issue 从 `backlog` 启动后，由 Multica 按 Squad 原生机制唤醒 Delivery Lead。首次进入交付流程且尚未开展 Analysis 的 Delivery Issue，由 Delivery Lead 直接通过 `@mention` 将专业分析工作交给 Workitem Analyst：

```text
Delivery Issue
assignee = Delivery Squad
        ↓
人工启动
        ↓
Multica 启动 Delivery Lead
        ↓
Delivery Lead 按 Squad 协作规则
        ↓
@Workitem Analyst
        ↓
Workitem Analyst 执行 workitem-analysis
```

本阶段不设置独立 `start-analysis.py` 或通用启动 Router。

职责边界：

```text
Multica
= Issue 启动与 Squad Leader Run

Delivery Lead
= 初始成员协调与 @mention

workitem-analysis
= Analysis 输入检查、专业分析与停止条件

Analysis Gate
= Analysis 产物与硬条件校验
```

已有 Analysis、Review、Development 或其他执行进展的 Delivery Issue，再次唤醒 Delivery Lead 时应根据当前事实继续协调，不因重新进入 Leader Run 而重复启动首次 Analysis。

Delivery Lead 遵循 Multica Squad 原生协议维护当前 Issue 状态并在派发后结束本次 Run；项目方案不复制一套额外的启动状态机。

---

## 6.1 Delivery Issue 状态模型

当前 Delivery 生命周期使用 Multica Issue Status 作为面向人的主要可见状态。

推荐核心状态：

```text
backlog
→ todo
→ in_progress
→ analysis_review          # Display Name: Analysis Review
→ in_progress
→ in_review            # PR 已提交，等待 TFS 终态；abandoned 时进入 blocked
→ done
```

其中：

```text
analysis_review
```

是正式 Status Key，Display Name 为 `Analysis Review`，category=`started`，用于正常的 Analysis Human Gate。

```text
blocked
```

只表示真实阻塞，不用于正常审核等待。

Issue Status 与 Agent Run 生命周期分离；Run 完成不等于 Issue 自动完成。

---

# 7. Analysis

Analysis 在当前 Delivery Issue 内完成，不默认创建 Analysis Child Issue。

Delivery Issue 在 Analysis 执行期间：

```text
assignee = Delivery Squad
status   = in_progress
```

Workitem Analyst 不直接根据 TFS `Bug / Requirement` 二分专业方法，而是结合 TFS 管理类型与技术变更语义进行路由：

```text
TFS Bug
→ bug-fix
→ bug-analysis

TFS Requirement + Corrective Change
→ production-fix
→ bug-analysis

TFS Requirement + Intentional Change
→ sdd-fast
→ requirement-analysis
→ spec-preparation
→ requirement-review

Large / New Major Module
→ sdd-standard / Human
→ 当前版本不自动推进
```

其中：

```text
TFS Type
= 公司管理事实，不由 Agent 修改

Change Kind
= Workitem Analyst 的技术语义判断

Route
= 分析 / 研发方法选择
```

Repository 数量不决定 Route；`bug-fix`、`production-fix`、`sdd-fast` 均允许跨 Repository。

Analysis Package 根据 Route 至少包含：

```text
Context Pack
Problem / Requirement
Current Behavior
Expected Behavior
Root Cause（Corrective）
Solution / Fix Strategy
Impact / Fix Scope
Development Scope / Repository Scope
Acceptance Criteria
Verification Requirements
技术依赖与约束（如有）
实现建议 / OpenSpec Tasks（按 Route 和需要）
技术拆分建议（按需）
Risks
Open Decisions
Verify Agent Recommendation
```

Workitem Analyst 负责让技术工作足够清楚，以供 Human 审核、Delivery Lead 组织协作及 Engineer 实现；不要求在 Analysis 结束时冻结最终运行分工。

技术准备应回答：

```text
为什么改，改什么，哪些内容不在本次范围内？
涉及哪些 Repository、接口、数据或行为？
哪些技术约束、接口或产物必须先成立？
哪些修改必须保持一致，哪些范围可能独立实施？
Engineer 需要哪些 Fix Strategy、实现建议或 OpenSpec Tasks？
应满足哪些 AC，如何验证？
```

需要说明专业能力时，描述工作本身的技术要求，例如“涉及 Flink 状态恢复与事件时间处理，需要验证 Checkpoint 恢复后的行为”；不强制指定当前 Squad 中的 Agent、Agent ID 或角色映射。Delivery Lead 结合当前 Roster 判断由谁承担及怎样组织。

`Development Plan` 若用于描述研发准备，仅表示技术范围、约束与实现建议；不作为必须提交的独立 Artifact，不等于 Multica 执行 Task Graph。Analysis 不强制产出 `development_plan.units`、`DEV-*` 编号或 `role_requirement` 调度字段。

复杂任务可以在现有 Analysis Package 中提出技术拆分建议，说明建议范围、关联 AC、技术依赖和拆分理由；建议不与 Development Sub-Issue 一一对应。简单 Corrective Change 已有充分 Fix Strategy / Fix Scope / Regression Scope 时，不额外生成完整 Task Graph。

OpenSpec `tasks.md` 保持技术实现检查清单的定位，不直接充当 Multica 分工表。最终 Owner、独立工作项、Assignment / `@mention` 和必要 Stage，由 Delivery Lead 在批准边界内结合当前小队确定，见 §10；不要求 Workitem Analyst 复制 Leader 的组织上下文。

`Verify Agent Recommendation` 至少明确：

```yaml
verify_agent:
  recommendation: required | not_required
  reason: ...
  verification_focus:
    - AC-...
    - ...
```

判断不按 Route 预设默认结果。Workitem Analyst 根据 Acceptance Criteria、Verification Requirements、技术范围与约束、跨系统行为和可验证性给出推荐，不以最终成员分工或 Sub-Issue 数量已确定为前提。

典型判断：

```text
范围小、行为单一、已有可靠 Regression / Runtime Feedback、
Engineer 的 Local Validation + Code Review 可以充分闭合验收目标
→ 推荐 NOT REQUIRED

多个关键 Acceptance Criteria、多个技术修改范围共同形成最终行为、
跨系统 / Contract / Event / Schema、复杂状态流、
或需要 Runtime / Integration / E2E 行为验收
→ 推荐 REQUIRED
```

因此 `bug-fix`、`production-fix`、`sdd-fast` 都可能得到 `REQUIRED` 或 `NOT REQUIRED`。

`sdd-fast` 额外按需要包含：

```text
proposal.md
spec / delta spec
tasks.md
design.md（按需）
requirement-review
```

Workitem Analyst 最终 Summary 必须显式打印：

```text
Development Scope / Constraints: ...
Technical Decomposition Suggestion: ...（确有拆分建议时）
Verify Agent Recommendation: REQUIRED | NOT REQUIRED
Reason: ...
Verification Focus: ...
```

分析结果通过 Artifact / Comment 写回 Delivery Issue。


## 7.1 OpenSpec Integration

OpenSpec 只作为 `sdd-fast` 的版本化 Change Contract 接入当前 Delivery，不新增独立 Workflow、Issue、Stage、Agent 或审批状态。

职责边界：

```text
Workitem Analyst
→ 在 Analysis 中创建 / 更新 OpenSpec Change
→ 形成 proposal / spec or delta spec / tasks / design（按需）

Human Analysis Review
→ 批准当前 Analysis Package 中的技术、行为与验收边界
→ 不维护第二套 OpenSpec Approval State

Delivery Lead
→ 消费 Approved OpenSpec 与其他批准上下文组织协作
→ 不把 OpenSpec tasks 机械转换为 Development Sub-Issue

Engineer
→ 在当前 Development Unit 范围内消费 Approved OpenSpec
→ OpenSpec tasks 作为 Implementation Checklist，不作为 Runtime Topology

Verify Agent
→ 可读取 Approved Spec / Delta Spec 作为 Behavior Source
→ 仍按 Acceptance Criteria / Verification Requirements 独立验收
```

OpenSpec Artifact 保存在根仓并由 Git 跟踪。`sdd-fast` Analysis 获得 Human `APPROVED` 后，应将批准的 OpenSpec Change 提交到根仓，形成稳定的 Development 输入；该根仓提交不属于业务 `Repository Change`，不进入 required PR 集合，也不创建独立 PR。

正式边界：

```text
业务代码 Repository Change
→ Branch / Commit / Push / PR

OpenSpec Root Repository Artifact
→ Git Commit
→ No Independent PR
```

OpenSpec 的 Change Identity、Artifact 深度、Preparation / Review 方法与 Rework 规则由 Workitem Analyst 领域方案维护；总方案只维护其跨角色生命周期与交付边界。

---

# 8. Analysis Deterministic Gate

Workitem Analyst 完成后执行 Analysis Gate。

Gate 根据当前 Analysis Route 检查必需产物，不负责判断业务语义正确性。不得因为缺少最终 Agent、Sub-Issue 分工、Stage 编号或完整执行 Task Graph，就将技术准备充分的 Analysis 判为 FAIL；技术依赖和约束本身的必要输入仍按当前 Route 检查。

通用检查包括：

```text
Context 是否存在
Repository Scope 是否存在
Acceptance Criteria / Verification Requirements 是否满足当前 Route 要求
required artifact 是否存在
Verify Agent Recommendation 是否存在
无 unresolved blocker
```

Corrective Change：

```text
Root Cause Status
Fix Strategy
Fix Scope
Repository Scope
Verification Requirements
```

SDD-fast：

```text
Requirement Analysis
proposal.md
tasks.md
spec-required 时 spec 存在
design-required 时 design 存在
requirement-review APPROVED
Acceptance Criteria
Verification Requirements
```

统一结果：

```yaml
result: PASS | FAIL | UNKNOWN
reasons:
  - ...
```

处理：

```text
FAIL
→ @Workitem Analyst
→ targeted rework

UNKNOWN
→ Delivery Lead / Human

PASS
→ Delivery Issue status = analysis_review
→ STOP
```

`analysis_review` 是 Multica Workspace 中新增的自定义 Issue Status Key；其显示名称为 `Analysis Review`：

```text
key          = analysis_review
display_name = Analysis Review
category     = started
```

它用于在 Board / List 中独立展示所有等待人工分析审核的 Delivery Issue。

---

# 9. Human Analysis Review

`analysis_review`（Display Name：`Analysis Review`）是 Delivery Issue 的正式 Human Gate。

进入审核时：

```text
assignee = Delivery Squad
status   = analysis_review
```

Human Analysis Review 审核完整 Analysis Package，包括：

```text
Requirement / Root Cause / Solution
Repository Scope
Acceptance Criteria
Verification Requirements
技术依赖、约束与研发准备
技术拆分建议（如有）
Verify Agent Recommendation
Risks / Open Decisions
```

不再维护第二套：

```text
analysis.review_status = waiting | approved | rejected
```

审核决策通过顶层 Comment 表达，并由 Multica Squad 原生机制唤醒 Delivery Lead。评论判定统一遵循 §9.4。

审核沿用当前 Analysis Package、Human Comment 和 Human Review 流程，不引入 revision / hash 绑定或审批快照。批准后的实质性方案变更必须回到既有 Analysis / Human Review 流程，不得直接视为已经获批。

## 9.1 Human Approve

Reviewer：

```text
APPROVED

<可选说明>
```

Delivery Lead 被唤醒后首先调用：

```text
apply-analysis-review.py
```

确定性处理：

```text
status = analysis_review
+ Analysis Gate = PASS
+ 本次待处理 Human Comment 明确表达 APPROVED
→ APPROVED
```

然后：

```text
APPROVED
→ sdd-fast: Commit Approved OpenSpec Change 到根仓（不创建 PR）
→ status = in_progress
→ 进入 Development 协作安排 / Materialization

UNKNOWN
→ Delivery Lead 语义判断 / Human
```

Human `APPROVED` 表示接受当前 Analysis Package 中的需求理解、Root Cause / Solution、技术范围、关键约束、AC、Verification Requirements 及 Verify Agent Recommendation；`sdd-fast` 时同时接受当前 OpenSpec Change 所表达的行为与技术边界。

`sdd-fast` 的 Approved OpenSpec Change 在进入 Development 前提交到根仓 Git，作为后续 Development 的稳定输入。该 Commit 不创建独立 PR，也不进入业务 required PR 集合。

Delivery Lead 在这些批准边界内组织成员与任务，不等于重新审批技术方案，也不默认增加第二次分工审批：

| 协作决定或变化 | 处理 |
|---|---|
| 选择符合要求的具体成员 | Delivery Lead 结合当前 Roster 决定 |
| 将技术工作组织为一个或多个独立工作项，且不改变批准范围、技术约束和验收要求 | Delivery Lead 决定，按需物化 |
| 技术条件允许时安排并行或顺序执行 | Delivery Lead 决定，不机械把调用关系转为完成依赖 |
| 改变 Expected Behavior、外部 Contract、技术方案的实质结论或已批准 Scope | 返回 Workitem Analyst / Human |
| 删除验收要求、降低已批准验证要求或取消必需 Verify Agent | 返回既有 Analysis / Human Review，不得自行放宽 |
| 现有技术假设不成立，必须改动技术方案才能推进 | 由相应 Specialist 补充事实，返回 Workitem Analyst / Human |

如果当前任务明确要求 Human 批准人员分工、执行顺序或某项拆分方式，该明确要求同样属于批准边界；不得以“协作决定”为由绕过。技术拆分建议本身不自动冻结 Sub-Issue 数量或 Agent 配置，已批准的强制技术约束则必须保留。

Workitem Analyst 不允许自行批准自己的 Analysis。

## 9.2 Human Reject

Reviewer：

```text
REJECTED

Reason:
- ...

Expected Change:
- ...
```

Delivery Lead 被唤醒后同样先调用：

```text
apply-analysis-review.py
```

确定性处理：

```text
REJECTED
→ status = in_progress
→ @Workitem Analyst
→ 携带 Reason / Expected Change
```

普通讨论或补充信息返回 `NO_ACTION`；只有明确要求执行审核动作，但必要信息缺失、决定冲突或无法安全执行时，才返回 `UNKNOWN`，由 Delivery Lead 澄清。处理边界遵循 §9.4。

Workitem Analyst 根据 Feedback Area 做 Targeted Rework：

```text
Context / Repository Evidence
→ context-analysis

Root Cause / Fix Scope
→ bug-analysis

Requirement / Solution / Impact
→ requirement-analysis

技术范围 / 技术依赖 / 约束 / Verification Requirements
→ workitem-analysis 中对应的技术准备部分

Proposal / Spec / Tasks / Design
→ spec-preparation
```

修正完成后重新：

```text
analysis-completion
→ Analysis Gate
→ PASS
→ status = analysis_review
→ Human Analysis Review
```

Reject 不触发整套 Analysis 无差别重跑。针对已经批准的 Analysis，仅涉及成员选择或协作安排、且不改变批准边界的反馈，由 Delivery Lead 处理，不要求 Workitem Analyst 为修改 Agent 分工重新执行专业分析。明确的 `REJECTED` 仍按既有审核流程处理，不得视为已批准并直接启动研发。

## 9.3 `blocked` 的使用边界

`blocked` 不用于正常 Human Analysis Review。

只用于真正无法继续的异常，例如：

```text
关键输入缺失
外部依赖不可用
权限 / 环境问题
无法获得必要证据
无法可靠定位责任范围
多轮失败且无法自主解决
```

---

## 9.4 Human Comment 判定与停止边界

`apply-analysis-review.py` 与 `route-human-decision.py` 共用以下处理契约：

| 评论情况 | 处理 |
|---|---|
| 明确表达已有的合法审核 / 路由动作，且必要条件满足 | 按现有 `APPROVED`、`REJECTED` 或 `NEXT` 规则执行 |
| 普通讨论、备注或补充信息，没有要求改变流程 | `NO_ACTION`，保持状态，不派发后续阶段 |
| 明确要求执行流程动作，但必要信息缺失、决定冲突或无法可靠确定对象 | `UNKNOWN`，不推进，由 Delivery Lead 澄清缺失信息或冲突 |

判定针对本次待处理评论中的明确决定。不得仅因正文、引用或历史讨论出现 `APPROVED`、`REJECTED`、`NEXT` 等关键词就触发动作，也不得将历史决定当作新的流程请求。沿用现有明确决定格式，不扩展复杂的自然语言审批语法。

`NO_ACTION` 只表示本次评论不要求流程转换，不是 Issue Status，不新增 Metadata。普通问题可以回答，补充信息作为上下文保留；纯备注无需另发确认评论。

`UNKNOWN` 不自动改变 Issue Status，不自动设置 `blocked`，也不授予 Agent 代替 Human 作出批准或路由决定的权限。分析审核说明不明确时保持 `analysis_review`；PR Abandoned 后决定不明确时保持既有 `blocked`，只澄清当前缺失信息。

已有 Gate 的 `FAIL` 仍按该 Gate 的规则处理，不转换成 `UNKNOWN`，不得借评论语义判断绕过硬条件。

上述规则由现有脚本与 Delivery Lead 执行，不新增评论分类 Agent、路由服务或独立状态表。

---

# 10. Development 协作安排 / Materialization

Human Analysis Review APPROVED 后，Delivery Lead 在父 Delivery Issue 中读取已批准的技术与验收要求，并结合当前小队组织执行。

技术输入来自已批准 Analysis Package：

```text
TFS Type / Analysis Route
Solution / Fix Strategy
Development Scope / Repository Scope
技术依赖与约束
Approved OpenSpec Change Reference（sdd-fast）
实现建议 / OpenSpec Tasks（按需）
技术拆分建议（如有）
Acceptance Criteria / Verification Requirements
verify_agent.recommendation / reason / verification_focus
```

组织与执行输入来自当前事实：

```text
当前 Squad Roster / 成员角色与能力
已有 Owner / Sub-Issue / Stage / 协作安排
当前 Run、交付结果与必要环境事实
```

不要求 Workitem Analyst 在 Analysis Package 中复制 Roster 或预先选定全部执行者；也不从历史会话假定当前成员配置。

职责边界：

| 主体 | 负责的判断或动作 | 不负责 |
|---|---|---|
| Workitem Analyst | 技术分析、研发准备、技术依赖与约束；按需提出技术拆分和能力需求建议 | 选择当前成员、确定最终 Issue 分工或运行调度 |
| Human | 批准技术与验收边界，以及任务明确要求人工决定的事项 | 默认不逐项审批正常成员选择和委派 |
| Delivery Lead | 在批准边界内结合 Roster，组织独立工作项、选择 Owner、确定 Assignment / `@mention` 与协作顺序 | 重复专业 Analysis、编写详细实现步骤或管理底层 Run 队列 |
| Script / Gate | 检查明确硬条件，落实已确定安排，执行对象写入、关联、状态变更与幂等恢复 | 根据自由文本自行决定分几项、谁最合适或技术依赖意味着什么 |
| Multica | Issue Ownership、派发、Run、原生 Parent / Stage 回流 | 自动理解并制定项目业务分工 |

Delivery Lead 的协作判断是正常工作，不需要先调用一个通用 Router 并等待 `UNKNOWN`。已有明确分工规则或仍有效安排时直接沿用；当前确有选择时，结合工作与 Roster 决定。

工作对象的组织方式：

```text
当前工作可由一个主要 Engineer 在父 Delivery Issue 内完成
且不需要独立生命周期
→ Simple Delivery
→ 父 Issue 保持 Squad-owned，@对应 Engineer

确有多个需要独立 Owner、推进与完成的 Development Unit
→ Complex Delivery
→ 按已确定分工创建 Development Sub-Issue
```

判断是否需要独立 Development Unit，仍依据独立 Owner、推进、验证边界、失败 / 重试和完成需求。技术步骤数量、Repository 数量或 PR 数量不单独决定拆分；技术拆分建议可以采用，也可以在不改变批准边界的前提下合并或调整为适合当前小队的分工。

技术依赖约束协作安排，但不自动等于完成依赖。例如接口契约已确定且技术条件允许时，前后端可以并行实现；确需前置 Unit 完成的工作才使用相应等待关系和 Stage。必要技术事实不足时交相应 Specialist 补充，不由脚本猜测。

协作安排直接保存在现有父 Issue 的必要说明、Owner、Sub-Issue、Stage 与交接内容中。简单任务可仅写明执行者、范围引用和交付要求；复杂任务才补充各独立工作的边界和顺序。不新增独立协作计划文件、`runtime-topology.yaml`、规划 Agent 或另一套持久化 Task Graph。

`materialize-development.py` 的输入是**已经明确的协作安排及批准上下文**，只执行必要的确定性检查与物化：

```text
检查批准上下文与当前已确定 Unit 的必需输入可读取
校验已选 Owner 的身份及已有对象 / 关联
如存在明确任务 / 依赖结构，检查其结构硬条件
准备当前已确定 Unit 的执行说明，保留技术范围 / AC 引用
Recommendation → verify_agent.required
按需创建 Development Sub-Issue：Parent + 明确 Owner + Description + backlog
保存已明确 Stage / Dependency，补齐必要 TFS Task / 产物关联
回读确认当前 Unit 的必需输入完整
仅激活当前已确认依赖满足的 Sub-Issue：backlog → todo
```

成员是否适合、技术拆分是否合理、自然语言约束是否允许某种协作方式，由相应 Agent 负责；脚本不把这些语义结论伪装成确定性校验。角色到 Agent 的映射只有在现有规则已明确、身份可唯一解析时才直接应用，不能据此新建一套 Workitem Analyst 必须维护的成员映射表。

明确硬条件不满足时返回 `FAIL`；必要身份、输入或结果无法可靠确认时返回 `UNKNOWN` 并停止相关副作用。缺少成员选择或分工决定时，交 Delivery Lead 补齐协作安排，而不是要求 Workitem Analyst 补交完整运行 Task Graph。

Simple Delivery 不为了判断“一个 Unit 应如何投影”强制增加脚本调用；仅落实本次确有需要的确定性动作，例如按 TFS 类型创建 Task、保存已批准 Verify 要求和必要交付关联，然后使用原生 `@mention` 委派。

Development Sub-Issue 的 Owner 规则：

```text
职责明确、单一专业 Owner
→ 直接分配对应 Specialist Agent

Development Unit 本身需要持续多角色协作、动态交接
或现有成员无法唯一承担整体 Owner
→ 分配 Delivery Squad
```

选择 Squad-owned 不代表专业能力缺口已经解决；确无可用能力或权限时，按现有异常规则交 Human。父 Delivery Issue 的整体协调与子 Unit 的内部协作仍分开，见 §12.1。

Verify Recommendation 仍按已批准结果转换：

```text
recommendation = REQUIRED
→ verify_agent.required = true

recommendation = NOT REQUIRED
→ verify_agent.required = false
```

Recommendation 缺失或与 Approved Package 冲突时返回 `UNKNOWN`，交 Delivery Lead 协调 Workitem Analyst / Human。分工调整不赋予 Leader 降低已批准验证要求的权限；发现新风险影响验收要求时，按 §9.1 返回相应 Specialist / Human。

TFS Task 创建只依据原始 TFS 类型：

```text
TFS Bug
→ 不创建 TFS Task

TFS Requirement
→ 按 Requirement 规则创建 TFS Task
```

`production-fix` 虽使用 `bug-analysis`，仍遵守 Requirement 的 TFS 管理规则。

## 10.1 Development Sub-Issue 创建与激活

本节只保证正常初始化路径中“准备完整后再启动”，不要求多个 Issue、附件和 TFS 操作全部成功或全部回滚。

`materialize-development.py` 使用 Multica 原生能力完成以下顺序，不新增 Bootstrap Script、Skill、Agent 或状态机：

```text
准备完整 Unit Contract
→ 创建当前已确定的 Sub-Issue：Parent + 明确 Owner + Description + backlog
→ 写入已确定的 Stage / Dependency 与必要关联
→ 补齐必需 TFS Task / Artifact / Attachment（如有）
→ 回读确认完整
→ 仅激活依赖已满足的 Unit：backlog → todo
```

Unit Contract 至少包含 Goal、Development Scope、Repository Scope、相关 Analysis、AC、已明确的依赖与技术约束、Verification Requirements、已选 Owner 与交付要求。Owner 和协作依赖由 Delivery Lead 结合批准上下文确定，不要求 Workitem Analyst 提供 `role_requirement`。可以随创建请求保存的内容应一并保存；不先创建空壳并启动，再逐项补上下文。

Owner 可以在创建为 `backlog` 时直接保存，不必为了暂不执行先留空，再重复 Assignment。Squad-owned 的例外 Unit 同样遵循此顺序。

原生能力的使用约定：

| 操作 | 使用方式 |
|---|---|
| 创建并保存 Owner，但暂不执行 | 创建为固定 Status Key `backlog`；不依赖 `issue create --no-start` |
| 仅记录负责人或其他更新，不希望本次写入触发 Run | 按支持的命令使用 `issue assign / update / status --no-start`；API 更新使用 `suppress_run=true` |
| 正式启动已准备完整且依赖满足的 Unit | `issue status <sub-issue-id> todo`，不使用 `--no-start`；API 激活不抑制 Run |

`--no-start` / `suppress_run` 只作用于当前请求，不是持久化停止标志，也不会取消已经开始的 Run。不得用自定义 `initializing` 状态替代固定 `backlog` 并假定具有相同的派发行为。

`backlog` 不是全局执行锁。准备期间只写 Description、字段及必要关联，不发布会触发执行的普通评论或 `@mention`，不调用 Run / Rerun；不得依赖它隔离其他人或自动化主动发起的执行。

当前在批准边界内已确定的子任务及父子 / Stage 关系，应先登记完整，再启动当前可执行部分。依赖未满足的 Unit 保持 `backlog`；不要求提前创建尚无法细化的未来工作。Stage 编号不替代此激活控制。

同一份工作只保留一条正常启动路径：激活已分配的 Sub-Issue 后，不再在父 Issue 上 `@mention` 同一个 Specialist 执行该工作。

## 10.2 准备失败与激活恢复

创建成功不等于所有必需关联或附件均已可用；回读只确认当前 Unit 的执行输入完整，不重复专业 Analysis，也不新增独立 Bootstrap Gate。

| 当前情况 | 处理 |
|---|---|
| Issue 已创建，必需输入、关联或附件不完整 | 保留 `backlog`，修复缺失项；不得激活 |
| 当前已确定的部分子任务创建失败 | 保留已创建的 `backlog` 任务；恢复时先核对已有 ID / 关联，仅补缺失项 |
| 激活请求超时，结果无法确认 | 先读取 Issue 与 Run；不得立即重复 Assignment、`@mention` 或 Rerun |
| 无法可靠确认任务身份、输入完整性或当前执行事实 | 返回 `UNKNOWN`，交 Delivery Lead / Human |

允许未激活的半成品暂存；不建设跨系统补偿事务或初始化锁。Issue 写入与 Run 创建不被视为一个项目级原子事务；安装版本可支持的具体恢复动作应经验证后使用。

## 10.3 安装版本验收

以下是实施验收要求，不表示已在当前安装的 CLI / Server 上完成测试。原生参数以安装版本 `--help` 和 API Contract 为准；能力不符合时停止并报告，不临时绕开启动边界。

| 场景 | 验收要求 |
|---|---|
| 创建带 Owner 的 `backlog` 子任务，并执行准备写入 | 正常初始化路径不启动 Specialist |
| 必需输入或附件缺失 | 保留 `backlog`，不激活 |
| 已确定子任务及关联完整，仅部分依赖满足 | 只激活允许执行的 Unit；不因额外 Assignment / Mention 重复启动 |
| 准备完成后 `backlog → todo` | 产生预期 Specialist Run；抑制启动的更新与正式激活行为可区分 |

---

# 11. Simple Delivery

典型条件：

```text
一个 Development Unit
一个主要 Engineer Owner
不存在多个需要独立生命周期的研发单元
```

Simple Delivery 可以涉及一个或多个 Repository / PR；Repository 数量本身不改变 Simple / Complex 判断。

此时不创建 Development Sub-Issue，当前 Development Unit 隐含在父 Delivery Issue 中：

```text
Delivery Issue
assignee = Delivery Squad
    ↓
Delivery Lead
    ↓
@对应 Engineer
    ↓
Implementation
    ↓
Local Validation
    ↓
Code Review
    ↓
Commit / Push
    ↓
PR Preparation
    ↓
Development Evidence
    ↓
Development Completion Check
```

`Development Completion Check` 只判断当前 Development Unit 的 Engineering Contract 是否完成：

```text
Implementation Complete
+ Local Validation PASS
+ Code Review PASS
+ Review Findings 已处理
+ Commit / Push 完成
+ PR Preparation 完整
+ Development Evidence 完整
+ 无 Development blocker
```

Simple Delivery 中，Check PASS 只表示隐式 Development Unit 已完成，不将父 Delivery Issue 置为 `done`。父级继续承担 Delivery-level Verify、PR Materialization、PR Completion 与最终关闭；再次被唤醒时按 §12.2 检查已派发工作与有效结果，不重复执行。

处理：

```text
PASS + verify_agent.required=false
→ 父 Delivery 流程进入 PR Materialization

PASS + verify_agent.required=true
→ Delivery Lead @Verify Agent

FAIL
→ 按明确缺失条件由 Engineer targeted rework

UNKNOWN
→ Delivery Lead 语义判断 / Human
```

所有 required PR 注册完成后：

```text
Delivery Issue → in_review
```

---

# 12. Complex Delivery

当 Delivery Lead 根据已批准技术范围、约束、当前成员与协作需求，确认存在多个需要独立 Owner、推进和完成的 Development Unit 时，创建 Development Sub-Issue。不要求这些工作项事先由 Workitem Analyst 逐项定义，也不把 Analysis 的技术步骤机械转换为 Sub-Issue。

推荐结构：

```text
Delivery Issue
assignee = Delivery Squad
│
├── DEV-Backend
│   assignee = Backend Engineer
│
├── DEV-Frontend
│   assignee = Frontend Engineer
│
└── DEV-Flink
    assignee = Flink Engineer
```

如果某个 Development Unit 本身需要持续多角色协调或无法唯一确定 Owner，该 Sub-Issue 才分配给 Delivery Squad。

每个 Development Sub-Issue 保存：

```text
Goal
Repository Scope
Relevant Analysis
Acceptance Criteria
Dependencies
Contracts
Verification Requirements
已选 Owner / 当前交付要求
```

Development Sub-Issue 的完成契约限定为 **Engineering Contract 完成**，至少包括：

```text
Implementation Complete
Local Validation PASS
Code Review PASS
Review Findings 已处理
Commit / Push 完成
PR Preparation 完整
Development Evidence 完整
无 Development blocker
```

完成后执行确定性的 `Development Completion Check`：

```text
PASS
→ 当前 Development Sub-Issue 进入完成状态

FAIL
→ 当前 Specialist targeted rework

UNKNOWN
→ Delivery Lead / Human
```

Check PASS 后的 `done` 写入由当前交付方法按已批准的 Engineering Contract 和授权执行。这是本项目的完成规则，不是 Multica 在 Run 正常结束时自动置 `done`；Check 本身也不等于状态已经写入。状态写入后必须回读确认。

Development Sub-Issue 的完成不表示整个 Delivery 完成：

```text
Development Sub-Issue done
= 当前独立 Development Unit 的工程成果已经交付

Delivery Issue done
= 整个 TFS Work Item 已完成 Analysis、必要 Verify、PR 与最终交付闭环
```

当 required Development Sub-Issue 达到 Multica 原生父子 / Stage 完成条件时，使用 Multica 原生机制通知父 Delivery Issue，并在父 Delivery Issue 的协调上下文继续整体 Delivery：

```text
子任务批次 / Stage 满足原生通知条件
        ↓
Multica 原生父级回流
        ↓
Parent Delivery Issue / Delivery Lead
        ↓
回读当前 required Units / Evidence / Verify / PR Facts
        ↓
├─ 尚有 required Unit 未完成 → 处理依赖或等待
├─ 相同工作已派发 / 正在执行 → 不重复派发
├─ 已有有效 Verify PASS / 已登记 PR → 复用或恢复后续步骤
├─ 整体条件满足且仍需执行 → Verify / PR Materialization
└─ 无新增动作 → no_action / 结束
```

不再要求 Specialist 为正常 Development Completion 额外在父 Issue 维护一套 `Development Complete` 回流状态或自定义父级通知协议。

PR Materialization 是确定性副作用，不属于 Development Sub-Issue 的专业完成契约；它在父 Delivery 流程满足整体条件后统一执行。

## 12.1 父级协调与原生调度边界

Development Sub-Issue 只推进当前 Unit；Delivery-level 聚合、Verify / PR 推进统一在父 Delivery Issue 中协调。例外的 Squad-owned Sub-Issue 也不得在子级 Run 中直接推进整个 Delivery。

正常完成回流复用 Multica 原生 Parent / Stage 机制，不额外发送 `Development Complete` 评论或 `@Delivery Squad` 作为重复完成触发。任务启动与同一工作的唯一派发路径遵循 §10.1。

项目复用 Multica 原生待执行任务去重、同一 Issue + 同一 Agent 的任务串行领取及连续事件处理，不另建 Parent Lock、CAS、Transition Claim 或第二套 Runtime State。

边界必须保持：

- 同一 Issue / Agent 的调度约束，不扩展为整棵父子树、不同 Agent 或外部 API 的事务锁；父级可以有正常的后续 Run，不要求 Run 总数等于 1。
- 原生父级通知只触发重新评估，不代表业务 Gate 已通过。`cancelled` 可满足原生终态条件，但不得据此将 required Unit 视为工程交付成功；父级仍检查必需范围与 Evidence。
- 原生通知不作为“保证送达且只送一次”的事务消息；通知失败不等于子任务状态回滚。安装版本存在可复现缺陷时针对该缺陷处理，不先建设项目级消息系统。

## 12.2 当前事实与副作用幂等

Delivery Lead 每次被唤醒，只决定“现在尚需做什么”，不得机械重放完整流程。本规则同时适用于 Simple Delivery 的父级继续处理。

| 当前事实 | 处理 |
|---|---|
| required Unit 尚未全部成功完成 | 处理当前依赖或等待，不启动整体 Verify / PR |
| 当前候选成果与验收范围对应的 Verify 已派发且尚未结束 | 等待，不再次派发相同验收 |
| 当前候选成果已有仍有效的 Verify PASS | 复用结果，检查后续尚需执行的动作 |
| 候选 Commit 或验收范围发生变化 | 按当前契约重新检查证据有效性，不无条件沿用旧 PASS |
| required PR 已存在并正确登记 | 不再创建相同 PR；必要时只恢复未完成操作 |
| 本次更新不改变下一步 | 记录 `no_action` 并结束 |
| 无法可靠确认 Run / Report / PR 是否对应当前工作 | 返回 `UNKNOWN`，不得猜测已完成或直接重复派发 |

优先读取已有 Run、Development Evidence、Candidate Commit、Verification Report 和 `current_pr`，不增加 `transition_state`、`claimed_by` 或另一套阶段状态。

原生调度去重不替代业务幂等。PR Materialization 虽不绑定某个 Specialist，仍由父 Delivery 流程保留明确的正常调用路径；“谁可以调用”不表示多个入口可以无协调地同时创建同一 PR。

有副作用的 capability 必须处理自身重试：已完成项不重复执行，结果不确定时先查询事实，再补未完成项。PR 创建与回写恢复遵循 §17.2；收口恢复遵循 §22.1–§22.3，不引入通用事务框架。

## 12.3 安装版本并发与重试验收

以下验收尚未执行；本方案依赖的原生能力应在安装版本确认，不将设计约定写成已完成的运行验证。

| 场景 | 验收要求 |
|---|---|
| 多个子任务近同时完成 | 父级可继续处理；同一父 Issue / Delivery Lead 无重叠执行 |
| 父级运行期间又收到完成事件或评论 | 后续信息得到处理，不重复派发同一工作；允许后续 Run |
| Verify 已派发后父级再次被唤醒 | 相同候选成果和验收范围不重复启动 Verify |
| PR 创建成功但回写失败，再次执行 | 不重复创建 PR，恢复正确关联 |

---

# 13. Development Sub-Issue 分配

Development Sub-Issue 的 Owner 由 Delivery Lead 结合当前 Unit 的技术内容、协作模式及当前 Roster 选择。成员选择是正常协作职责；现有分工规则明确且成员能力匹配时直接沿用，不要求每次重新推理。

典型安排：

```text
后端独立工作
+ 当前 Backend Engineer 能承担该范围
→ Assignment 给 Backend Engineer

前端独立工作
+ 当前 Frontend Engineer 能承担该范围
→ Assignment 给 Frontend Engineer

Flink / 流处理独立工作
+ 当前 Flink Engineer 能承担该范围
→ Assignment 给 Flink Engineer
```

以上是结合工作和已配置成员的安排示例，不是要求 Workitem Analyst 输出 `role_requirement` 的路由表。已选成员的 ID / 身份解析与校验可以由工具或脚本完成；脚本不替代“谁适合当前工作”的协作判断。

如果 Development Unit 本身存在：

```text
持续跨角色协作
Owner 无法唯一确定
需要多成员动态路由
需要由 Leader 持续协调成员交接
```

则：

```text
assignee = Delivery Squad
```

由 Delivery Lead 通过 `@mention` 协调 Specialist。

统一原则：

```text
Delivery-level Coordination
→ Parent Delivery Issue / Delivery Squad

明确的独立专业工作
→ Specialist-owned Development Sub-Issue

需要持续多角色协调的独立工作
→ Squad-owned Development Sub-Issue
```

Assignment 表达长期 Issue Ownership；`@mention` 表达当前 Issue 内的临时协作或成员交接。不得仅为了保持形式上的 Squad 循环，将职责已经明确的 Development Sub-Issue 强制分配给 Delivery Squad。Owner 保存、准备与唯一激活路径遵循 §10.1；整体推进与防重复规则遵循 §12.1–§12.2。

当前只按专业职责选择已配置的 Agent，不定义跨个人 CLI / Runtime 的动态选路、负载均衡或自动故障迁移；基础运行环境与权限按现有配置和异常规则处理。

---

# 14. Stage

Stage 只用于真正 Development Units 之间的完成依赖。不存在完成依赖的 Unit 可以并行，不人为增加 Stage。

Workitem Analyst 说明技术依赖与约束；Delivery Lead 在这些约束内确定协作顺序。运行时调用关系不自动等于开发完成依赖，不能仅因“前端调用后端”就要求 Frontend Engineer 等 Backend Engineer 全部完成。已确定的完成依赖才映射为 Stage，脚本只落实和检查该关系，Multica 按原生条件回流父级。

例如：

```text
DEV-Backend
    ↓ 完成 Engineering Contract
DEV-Frontend
DEV-Flink
```

可以表示为：

```text
Stage 1
└── DEV-Backend

Stage 2
├── DEV-Frontend
└── DEV-Flink
```

由于 Development Sub-Issue 的正常终点已经定义为 Engineering Contract 完成，Stage 的推进条件可以与 Multica 原生子任务完成语义保持一致。Stage 编号不是启动锁；后续 Unit 的激活遵循 §10.1。收到 Stage 通知后，父级按 §12.1–§12.2 检查依赖、必需交付事实与当前已执行动作，不无条件启动整体 Verify / PR。

Stage 不用于表达：

```text
Analysis
→ Development
→ Verify
→ PR
```

这些属于父 Delivery Issue 的 Delivery 生命周期。

返工保持既有 Stage 编号和依赖关系；不得因一个 Unit 重开而自动回退全部 Stage。后续已启动或已完成 Unit 是否受影响，按 §16.7 的证据边界判断。

当前不建模基于中间 Artifact、Contract 或 Commit 的提前解锁机制。需要前置 Unit 的任务等待该 Unit 完成，不增加第二套依赖模型。

---

# 15. Engineer Execution

各专业 Engineer 负责当前 Development Unit 的完整 Engineering Contract。

必须包含：

```text
Ground / 读取已批准 Development Context
Feedback Setup
Implementation
Required Local Validation
Code Review
Review Finding Fix
Development Evidence
Commit
Push
PR Preparation
```

正式原则：

> **Local Validation + Code Review 是 Development 必备环节，与 Verify Agent 是否参与无关。**

Engineer Local Validation 关注：

```text
Targeted Test
Regression Test
Build / Compile / Type Check / Lint
Required Runtime Check
Required Contract Check
```

Code Review 关注：

```text
Specification / Fix Strategy Alignment
Acceptance Criteria Coverage
Scope Drift
Repository Standards
Complexity
Contract Risk
Test Quality
Regression Risk
```

Code Review 可以由 Engineer 自检、read-only reviewer subagent 或独立 review Skill 承担，不形成新的隐藏 Development Owner。

Engineer 完成工程工作后输出结构化 Development Evidence，并满足当前 Unit 的 Development Completion Contract：

```text
[ ] Implementation Complete
[ ] Required Local Validation PASS
[ ] Code Review PASS
[ ] Review Findings 已处理
[ ] Development Evidence 完整
[ ] Commit / Push 完成
[ ] PR Preparation 完整
[ ] 无 Development blocker
```

PR Preparation 至少包含每个 required Repository Change 的：

```text
Repository / Repository ID
Source Branch
Target Branch
Candidate Commit
PR Title
PR Description / Description Reference
TFS Work Item / Delivery Issue 关联信息
```

职责终点根据工作对象不同：

```text
Engineer 工作在 Development Sub-Issue
→ Development Completion Check PASS
→ Sub-Issue 完成
→ 由 Multica 原生父子 / Stage 机制回流父级

Engineer 工作在父 Delivery Issue（Simple Delivery）
→ Development Completion Check PASS
→ 记录隐式 Development Unit complete facts
→ 父 Delivery Issue 保持进行中
→ Delivery Lead 继续 Verify / PR / Completion
```

Engineer 不负责：

```text
决定整个 Delivery 是否完成
决定 Delivery-level Verify 是否 required
执行 PR Materialization 的业务语义判断
关闭父 Delivery Issue
```

PR Materialization 消费 Engineer 已准备的 PR Facts，由父 Delivery 流程在整体条件满足后调用确定性 capability。

---

# 16. Verify Agent

Verify Agent 是按需参与的 **Delivery-level、behavior-oriented 独立验收者**。

核心原则：

> **Verify Agent 不依赖 Engineer 的实现过程，从 Acceptance Criteria / Verification Requirements 出发，独立验证最终交付行为确实成立。**

Verify Agent 不承担：

```text
Implementation Code Review
Repository Style Review
类 / 函数拆分评价
实现是否优雅
替代 Engineer 的 Local Validation
替代 Engineer 修复代码
```

Verify Agent 关注：

```text
Acceptance Criteria
Verification Requirements
用户可观察行为
API / Runtime Behavior
Contract Behavior
Cross-Repository Behavior
Integration Behavior
E2E Behavior
```

Integration / E2E 不再是独立 Post-Merge Stage，而只是 Verify Agent 根据当前 Verification Requirements 选择的验证方式。

## 16.1 是否需要 Verify Agent

由 Workitem Analyst 在 Analysis Package 中提出：

```yaml
verify_agent:
  recommendation: required | not_required
  reason: ...
  verification_focus:
    - ...
```

Human Analysis Review 对该 Recommendation 一并审核。Human `APPROVED` 后确定性物化为：

```text
verify_agent.required = true | false
```

判断原则不按 `bug-fix / production-fix / sdd-fast` 预设默认值，而是回答：

> **当前交付是否值得增加一个独立于实现者、从 Acceptance Criteria / Verification Requirements 出发的 behavior-oriented 验收视角？**

## 16.2 Verify 输入

Verify Agent 开始前必须满足：

```text
所有 required Development Units = Development Complete
Acceptance Criteria 可读取
Verification Requirements 可读取
verify_agent.required = true
所有待验证 Repository 的 Branch / Commit SHA 已固定
```

Verify Agent 基于明确的候选代码版本验证，不依赖 PR 已经创建。派发或复用验收前，父级遵循 §12.2 检查当前候选成果与验收范围对应的 Run / Report，避免因重复唤醒而重复验收。

## 16.3 Integration / E2E Verification

当最终 AC 需要多个 Development Unit 组合后才能验证时，Verify Agent 可以构造临时 Verification Workspace / Environment：

```text
Required Branch / Commit Set
        ↓
Temporary Verification Workspace
        ↓
Runtime / Integration / E2E Scenario
        ↓
Behavior Evidence
```

该过程不是正式 Merge，不改变目标分支，不创建额外 Delivery Stage。

## 16.4 Verify PASS

Verify Agent 输出结构化 Verification Report：

```yaml
verification:
  result: PASS
  verified_commits:
    - repository: ...
      commit: ...
  acceptance_coverage:
    AC-01: PASS
    AC-02: PASS
  evidence:
    - ...
```

Verify Agent 写回结果后，由 Squad 原生机制让 Delivery Lead 继续协调。

Delivery Lead 首先调用 Verification Gate：

```text
verify_agent.required = true
+ Verification Report.result = PASS
+ verified commit set 与当前候选 commit set 一致
+ required AC / Verification Requirements 已覆盖
```

处理：

```text
PASS
→ Delivery Lead 调用 PR Materialization

FAIL
→ 按 §16.5–§16.8 定位受影响 Unit
→ 在原工作 Issue 上准备并触发定向返工

UNKNOWN
→ Delivery Lead 进行语义判断
→ 必要时 @Engineer / @Workitem Analyst / Human
```

## 16.5 Verify FAIL / UNKNOWN

Verify Agent 在父 Delivery Issue 保存 Verification Report，并对 Finding 做专业归因。报告必须能对应本次验收的候选 Commit Set；每个返工请求至少包含：

```yaml
issues:
  - id: VERIFY-001
    development_unit: DEV-Backend
    description: ...
    evidence: ...
    expected_correction: ...
```

父级根据当前事实处理：

| 情况 | 处理 |
|---|---|
| 工程问题、受影响 Unit 明确、修复不改变已批准范围 | 在原 Unit 上定向返工，见 §16.6 |
| 仅验证环境、数据或工具不可用，尚未证明代码有缺陷 | 停止验收，恢复验证条件；不得仅据此重开全部研发任务 |
| Finding 无法可靠归因，或与当前候选版本不一致 | `UNKNOWN`，由 Delivery Lead 澄清 |
| 需要改变 Expected Behavior、AC、Contract 或 Development Scope | 返回 Workitem Analyst / Human，按既有 Analysis Review 处理 |

Verify Agent 不修改生产代码、不自行批准新的范围。父级保存 `verification.result = fail | unknown` 及报告引用；未取得当前有效 PASS 前不得进入需要该验收的 PR Materialization。

## 16.6 Development Sub-Issue 定向重开

同一 Unit 的修正复用原 Sub-Issue，不创建重复研发任务，不重建 TFS Task，不改变 Parent、原 Owner、Stage 和已批准范围。

标准过程：

```text
父级读取当前 Verify Report / Finding
→ 准备所有受影响 Unit 的返工输入
→ 将这些 Sub-Issue 置为 in_progress，不启动 Run
→ 回读确认输入与状态
→ 为每个尚未执行该修正请求的 Owner 触发一次原生 Run
→ Specialist targeted rework
```

返工输入保存在原 Sub-Issue 的 Description / Artifact 引用中，包括 Report / Finding、失败证据、预期修正、原 Candidate Commit 和必要回归范围。保留原有 Goal / AC / Approved Context，不用返工说明覆盖整个任务契约。

`done → in_progress` 只表示重开，不能假定它必然启动 Agent。准备写入使用安装版本支持的 `--no-start` / `suppress_run`。默认 Specialist-owned 路径为：[^d-trigger]

```bash
# 返工说明已合并到当前 Sub-Issue；输入写入不得另行触发运行。
multica issue status <sub-issue-id> in_progress --no-start
multica issue rerun <sub-issue-id>
```

这两个动作不是事务；以已有 Report 引用 / Finding ID 识别修正请求，在最后触发前回读任务与现有 Run。若同一修正请求已排队、运行或完成，不再派发；调用超时先查询 Run 与结果，不盲目再发一次。多个 Unit 返工时先完成全部重开和输入准备，再开始激活，避免短暂的旧完成集合被当作整体完成。

只保留一个正常触发入口：采用上述 `rerun` 后，不再重新 Assignment，也不在父 Issue 同时 `@Engineer` 执行同一修正。例外的 Squad-owned Unit 仍回到该子 Issue 的原生 Squad 协调入口，不把其实现工作搬到父 Issue。

`issue rerun` 是新一次执行，不等于重做整个 Development。它不保证续用旧会话或目录；Specialist 必须从保存的 Branch / Commit 和当前任务上下文恢复修复基线，只处理 Finding 及必要回归。[^d-runs]

## 16.7 完成事实、证据与 Stage 的有效性

重开后，Sub-Issue 的非完成状态立即使该 Unit 不再满足整体完成条件。旧 `development.result = complete` 缓存、旧 Check PASS、旧验收记录不得覆盖当前未完成状态。

保留旧 Commit 和 Evidence 作为修复基线及执行记录，不伪造或删除历史结果；它们不能代表新候选版本已完成检查。Specialist 交付新 Commit 后，必须更新 Local Validation、Code Review、PR Preparation 与 Development Evidence，再执行 Development Completion Check。

代码 Commit Set 变化时，旧 Verify PASS 不再能作为当前候选版本的通过依据。无代码变化也不能直接忽略尚未解决的 Finding；必须由 Verify Agent 对当前验收要求给出有效结论。

Stage 处理保持最小范围：

| 后续 Unit 的情况 | 处理 |
|---|---|
| 尚未启动，所需前置 Unit 已重开 | 保持 `backlog`，等待完成依赖重新满足 |
| 已完成，Evidence 显示不受本次修复影响 | 保留 `done`，不重跑 |
| 已完成，Evidence 显示工程成果受影响 | 只重开该受影响 Unit |
| 正在运行，其输入已失效或继续执行会产生错误 | Delivery Lead 协调停止对应原生 Run，再更新输入；修改 Issue 状态本身不会停止 Run |

不自动重置 Stage、不清空全部完成记录、不级联重开所有后续任务。是否改变已批准 Contract / Scope 的问题仍交 Workitem Analyst / Human，不在返工中自行扩展依赖模型。[^d-assign]

## 16.8 重新完成与再次验收

Specialist 修正后完成 Local Validation、Code Review、Commit / Push、PR Preparation 和 Development Evidence，Development Completion Check PASS 后，按授权将原 Sub-Issue 再次写为 `done`。

非终态重新进入终态、且满足 Parent / Stage 条件时，复用原生父级回流。父级必须重读全部 required Unit、当前 Commit Set 和未解决 Finding，不根据旧 Stage 通知重复启动已经完成的工作。原生通知不作为保证送达且只送一次的消息；异常恢复沿用 §12.1–§12.3，不靠反复切换 `done` 制造通知。[^d-child]

全部 required Units 再次成功完成后，父级按 §12.2 派发一次当前验收。复验覆盖失败场景及必要 Regression / Integration 范围，不无差别重跑所有工作；复用未受影响的证据时，报告必须说明其对当前候选版本仍有效，不能仅把旧 PASS 改挂到新 Commit Set。

Simple Delivery 没有可重开的子任务：父 Issue 保持 `in_progress`，清除隐式 Unit 的当前 `complete` 结论，在父 Issue 准备相同返工输入后由 Delivery Lead `@` 原 Engineer；不得 `rerun` 父 Issue 后假定会直接运行 Engineer。

本节适用于当前 Delivery 尚未结束的验收返工。最终交付后由正常 QA 发现的新问题，仍创建新的 TFS Work Item / Delivery，不自动重开已结束的整个交付。

安装版本至少验收：单 Unit 重开、多个 Unit 同轮重开、准备或触发中断后恢复、重复 Finding 不重复派发、Stage 前置重开不级联重跑、旧 PASS 不放行新 Commit、重新完成后的父级回流。本次文档更新未执行这些运行测试。

---

# 17. PR Preparation / Materialization 与映射

PR 是 Repository 级交付对象。

正式原则：

```text
每个发生代码变更并需要交付的 Repository
→ 独立 Branch
→ 独立 PR
```

PR 交付拆成两个职责，不新增 Workflow Stage：

```text
PR Preparation
= Engineer Semantic Work

PR Materialization
= Deterministic Side Effect
```

## 17.1 PR Preparation

Engineer 在声明当前 Development Unit 完成前完成：

```text
Local Validation PASS
Code Review PASS
Commit / Push
PR Preparation
```

每个 required Repository Change 至少准备：

```yaml
repository: ...
repository_id: ...
source_branch: ...
target_branch: ...
candidate_commit: ...
pr:
  title: ...
  description: ...
  ready: true
```

PR Title / Description 属于 Engineer 对本次代码修改的语义准备。

## 17.2 PR Materialization

当满足：

```text
所有 required Development Units Complete
+ verify_agent.required = false
```

或：

```text
所有 required Development Units Complete
+ verify_agent.required = true
+ Verification Gate PASS
```

父 Delivery 流程在上述整体条件满足后，通过明确的正常调用路径调用确定性的 `pull-request` capability。PR Materialization 不绑定某个 Specialist Agent；调用者须提供已准备 Facts 和当前 Delivery 上下文，不因此允许多个入口无协调地同时创建同一 PR。调用前按 §12.2 检查当前事实与已执行动作。

标准过程：

```text
读取 PR Preparation Facts / current_pr
↓
逐仓校验 Repository / Branch / Candidate Commit
↓
确认 Branch HEAD 与 candidate_commit 一致
↓
核对当前 PR 与外部事实：已存在则复用 / 恢复登记，仅补缺失项
↓
确需创建时调用 TFS / PR API
↓
校验返回身份
↓
写回 current_pr
↓
全部 required PR 注册完成
↓
Issue → in_review
```

PR Materialization 必须幂等；多个 Repository 可以一次处理，失败重试只补未完成项。外部 PR 已创建但 `current_pr` 回写失败时，重试必须先确认外部事实并恢复登记，不能因本地记录缺失直接再建 PR；无法可靠确认身份或结果时返回 `UNKNOWN`。

如果确定性 Materialization 返回：

```text
PASS
→ in_review

FAIL
→ 按明确失败原因处理；不得绕过

UNKNOWN
→ Delivery Lead 语义判断
```

只有出现新的 Engineering Semantic Work 时才重新 `@Engineer`，例如：

```text
Branch HEAD != candidate_commit 且原因不明
需要 rebase / conflict resolution
PR 前置检查暴露代码问题
必须修改代码 / 测试 / PR Preparation
Repository / Branch Fact 冲突
```

以下问题不需要 Engineer：

```text
TFS / PR API 临时失败
网络超时
幂等恢复
metadata 回填
可确定性的字段 / 身份校验
```

当 Verify required 时，PR Materialization 必须基于已验证候选 Commit Set；代码实质变化会使旧 Verify PASS 失效。

一个 Delivery Issue / Development Sub-Issue 可以关联多个 Repository Change；每个 Repository Change 保存一个当前 required PR。

所有 required PR 成功登记后才进入：

```text
in_review
```

---

# 18. PR Status Sync

PR 审核发生在 TFS / PR Platform。Multica 不复制审核过程；`pr-status-sync` 只读取已登记的 current required PR，并依据 provider `status` 做确定性终态检测。

运行模型：

```text
Multica Autopilot
      ↓
PR Status Sync Agent（Thin Adapter）
      ↓
reconcile-pr-status.py
      ↓
Structured Result
```

Thin Agent 不自行解释 PR 业务含义，只调用确定性脚本并应用结构化结果。

查询：

```text
status = in_review
或 current_pr.sync.pending_event exists
```

脚本执行：

```text
读取 Project / Repository ID / PR ID
↓
tfs-mcp 查询 PR
↓
校验 PR / Repository / Project 身份
↓
provider_status ?
├─ active     → NO-OP
├─ completed  → Completion Evaluation
├─ abandoned  → Exceptional Stop
└─ 其他       → UNKNOWN
```

多个 required PR 聚合：

```text
任一 current_pr = abandoned
→ Exceptional Stop

否则任一 current_pr = UNKNOWN
→ UNKNOWN

否则全部 current_pr = completed
→ Completion

否则
→ NO-OP
```

## 18.1 普通审核过程

`provider_status = active`：

```text
NO-OP
```

不根据以下内容改变 Delivery 流向：

```text
Changes Requested
Approved
Review Feedback
mergeStatus
mergeCommitId
mergeCommitMessage
```

不写 Comment、不唤醒 Delivery Lead / Engineer；等待下一次 Autopilot。

## 18.2 PR Abandoned

检测到：

```text
provider_status = abandoned
```

确定性处理：

```text
持久化 Abandoned Fact
↓
pending_event / event_key
↓
Issue.status = blocked
↓
assignee = Delivery Squad
↓
STOP，等待 Human Decision
```

机器不推断 abandoned 的业务原因。

Human 提交流程决定时，顶层 Comment 必须明确：

```text
Reason:
- REJECTED | DISCARDED

NEXT:
- ANALYSIS
- ENGINEERING
- RECREATE_PR
- CANCEL_DELIVERY
```

因为 Issue 是 Squad-owned，Human Comment 按 Multica 原生机制唤醒 Delivery Lead。普通讨论或补充信息按 §9.4 返回 `NO_ACTION`，不得仅因没有 `NEXT` 就视为异常。

Delivery Lead 调用：

```text
route-human-decision.py
```

确定性路由：

```text
NEXT = ANALYSIS
→ status = in_progress
→ @Workitem Analyst

NEXT = ENGINEERING
+ affected Development Unit 唯一明确
→ status = in_progress
→ @对应 Engineer

NEXT = RECREATE_PR
+ Candidate Commit Set 未变化
→ PR Materialization

NEXT = RECREATE_PR
+ Candidate Commit Set 已变化
→ @对应 Engineer

NEXT = CANCEL_DELIVERY
→ Cancellation Handler / Policy
```

明确要求执行流程动作，但存在以下情况时：

```text
NEXT 或该动作必需信息缺失
affected Unit 不唯一
事实冲突
无法可靠判断 Commit Set 是否可沿用
Human Decision 与当前状态不一致
```

则：

```text
route-human-decision.py → UNKNOWN
↓
保持当前状态，不执行该流程动作
↓
Delivery Lead 澄清缺失信息 / 冲突，必要时请求 Human
```

若回 ANALYSIS，新 Analysis 再次通过 Human Review 后，以新的技术范围、约束、AC / Verification Requirements 及 Verify Recommendation 为准；Delivery Lead 只在相关新事实影响现有分工时调整协作安排，不默认重建全部任务。

若回 ENGINEERING，Engineer 修复后重新 Local Validation / Code Review / Commit / Push / Development Complete；如 Verify required 且 Commit Set 变化，旧 Verify PASS 失效。

## 18.3 PR Completed

只有：

```text
provider_status = completed
```

才表示单个 current PR 成功完成。

所有 required current PR 都 completed 后：

```text
PR Status Sync Run
↓
持久化 Completion Facts / pending_event
↓
same-run 调用 finalize-delivery.py
```

`finalize-delivery.py`：

```text
PR Transition Check
↓
Post-Merge Workspace Reconciliation
↓
Delivery Completion Check
↓
Final Summary Render
↓
TFS Close
↓
Delivery Issue Done
```

Happy Path 不为这些确定性步骤额外唤醒 Delivery Lead。

如果：

```text
UNKNOWN
事实冲突
需要跨角色协调
无法确定安全恢复动作
```

则：

```text
→ Delivery Squad / Delivery Lead
→ Delivery Lead Semantic Decision
```

## 18.4 幂等与恢复

每个 current PR 使用稳定 `event_key`：

```text
owner issue
repository
PR ID
provider terminal status
```

处理终态前先写：

```yaml
current_pr:
  sync:
    pending_event: abandoned | completed
    event_key: "..."
```

进入收口前，必须持久化本次 Completion Facts 及相应 `pending_event`。只有 §22 的收口后置条件全部确认后，才清除本次事件。中途失败保留该标记；恢复扫描必须包含有待处理事件的 Issue，即使它已不在 `in_review`，也不能丢失最后的登记恢复。该标记只表示尚需对账，不记录另一套 Workflow Stage。

核心幂等规则：

```text
active
→ NO-OP

abandoned + same event already applied
→ NO-OP

abandoned + pending_event
→ 恢复 blocked / Delivery Squad / metadata 一致性

all current required PR completed
+ completion already finalized
→ NO-OP

all completed
+ finalize pending
→ 恢复 finalize-delivery

query / identity / schema UNKNOWN
→ 不推进、不覆盖已有可靠事实
```

PR Status Sync 不修改代码、不理解 Review 意见、不推断 abandoned 原因。

---

# 19. PR Transition Gate

PR Transition Gate 属于 `finalize-delivery` 内部的确定性检查，不要求独立 Agent Run。

推荐规则：

```python
def pr_transition_ready(ctx):
    acceptance_ok = (
        not ctx.verify_agent_required
        or ctx.verify_agent_pass
    )

    return (
        ctx.all_required_development_units_complete
        and acceptance_ok
        and all(ctx.required_current_pr_completed)
        and ctx.unresolved_blocker == 0
    )
```

结果：

```text
PASS
→ 继续 deterministic finalize

FAIL
→ 不允许关闭
→ 根据明确缺失条件等待 / 修复

UNKNOWN
→ 停止 finalize
→ 升级 Delivery Lead
```

Gate 本身只判断硬条件；若 `UNKNOWN` 背后需要理解跨角色事实或决定下一步专业能力，由 Delivery Lead 进行语义路由。`all_required_development_units_complete` 必须结合当前 Unit 状态与有效 Engineering Evidence 判断；被重开的 Unit、尚未解决的 Finding 或被取消但仍属 required 的 Unit，均不得算作成功完成。

---

# 20. Post-Merge Workspace Reconciliation

PR Transition Gate PASS 后，由 `finalize-delivery` 对登记且当前运行有权操作的本地工作区执行 Merge 后对齐。仓库 / 工作目录身份、权限和是否有其他执行占用必须可确认；不得以另一台机器或任意同名目录代替当前工作区。无法安全操作时停止并交 Delivery Lead，不新增跨 Runtime 自动迁移。

每个 required Repository：

```text
For each required Repository:
    git fetch --prune origin
    git switch <target_branch>
    git pull --ff-only origin <target_branch>
```

工作区已经满足当前目标状态时不重复切换。远程 Source Branch 已删除时，本地 Source Branch 可按团队策略安全清理；不存在即跳过，安全删除被拒绝则保留。该可选清理失败不覆盖已完成的代码交付，也不允许强删：

```text
git branch -d <source_branch>
```

不得默认使用：

```text
git branch -D
```

以下情况不得强行对齐：

```text
working tree 非 clean
target_branch 不存在
pull 无法 fast-forward
Repository 状态与记录不一致
```

处理原则：

```text
可确定的恢复动作
→ Script 处理

无法安全恢复 / 事实冲突 / 需要语义判断
→ UNKNOWN
→ Delivery Lead
```

不得使用 `reset --hard` 等破坏性操作掩盖冲突。

Merge 后不再自动执行 Integration Verify。后续 QA / 测试发现的新问题形成新的 TFS Work Item / Delivery。

---

# 21. Delivery Completion Gate

Delivery Completion Gate 属于 `finalize-delivery` 内部确定性检查。Gate PASS 表示可以执行收口；不表示摘要、归档、TFS 回写和最终 `done` 已完成。这些后置条件按 §22 回读确认。

关闭 Delivery Issue 前确认：

```text
[ ] Analysis Gate PASS
[ ] Human Analysis Review 已批准
[ ] 所有 required Development Units = Development Complete
[ ] 所有 Development Units Local Validation PASS
[ ] 所有 Development Units Code Review PASS
[ ] verify_agent.required=false，或 Verify Agent PASS
[ ] Verify PASS 对应当前候选 Commit Set（如果 required）
[ ] 所有 required current PR provider_status = completed
[ ] Post-Merge Workspace Reconciliation 成功
[ ] 无 unresolved blocker
```

统一输出：

```yaml
result: PASS | FAIL | UNKNOWN
```

```text
PASS
→ Final Completion

FAIL
→ 不允许关闭

UNKNOWN
→ 停止 deterministic finalize
→ Delivery Lead 语义判断 / 协调
```

---

# 22. Final Completion

Completion Gate PASS 后，`finalize-delivery` 按当前事实完成：

```text
Render / Persist Final Delivery Summary
→ 归档当前 Route 要求的产物
→ sdd-fast: OpenSpec Archive + 根仓 Git Commit（不创建 PR）
→ 更新 TFS Work Item 及已有、按规则应关闭的关联 Task
→ 保存 PR / Verify / Artifact 关联结果
→ 回读确认所有必需动作成功
→ Delivery Issue = done
→ 清除本次 completion pending_event
```

Final Delivery Summary 默认由结构化 Facts 模板化生成，不依赖 LLM。摘要只陈述已确认事实；在最终写入之前不得宣称交付已关闭。当前方案不默认增加 Final Human Confirmation。

`in_review` 表示 required PR 已注册、等待外部结果；全部 PR 完成后的正常收口也可以在该状态内执行，不新增 `finalizing` 状态。


## OpenSpec Archive（sdd-fast）

`sdd-fast` 的 Route Archive 具体包含 OpenSpec Archive。只有业务交付已经满足当前 Final Completion 前置条件后，才将该 Change 归档为已实现的版本化行为资产。

```text
required Development Units complete
+ required Verify PASS（如 required）
+ required business PR completed
        ↓
OpenSpec Archive
        ↓
root repository Git Commit
        ↓
继续 Final Completion
```

OpenSpec Archive / Commit 不创建独立 PR，也不把根仓加入业务 required PR 集合。它是 Final Completion 的收口副作用之一。

以下情况不得将 Delivery 标记为 `done`：

```text
OpenSpec Change 无法唯一确认
OpenSpec Archive / Validation FAIL
根仓身份或工作区无法安全确认
Archive 后 Git Commit 失败
Archive / Commit 结果无法可靠确认
```

明确失败返回 `FAIL`；身份、结果或安全状态无法可靠确认时返回 `UNKNOWN`。业务 PR 已经 `completed` 的事实不回滚；恢复时重新查询根仓 / OpenSpec 当前事实，只补未完成的 Archive / Commit / 关联写回。

## 22.1 最小恢复模型

`finalize-delivery` 是一次有界调用：读取当前事实、检查、补齐缺失动作、输出结构化结果后结束。由现有 PR Status Sync Run 调用；后续 Autopilot 或人工重试可以再次调用同一入口。

恢复时重新执行必要的只读检查和安全 Guard，跳过已确认完成的副作用，只补未完成项。不得从“上次第几步”盲目继续，也不得为了恢复而重跑 Analysis、Development 或 Verify。

不新增 `finalize-state.json`、持久化 `current_step`、全局事务、补偿引擎、长期轮询循环或新的 Workflow Runtime。恢复依据优先使用 TFS / PR 当前事实、Multica 当前记录、已有 Artifact 引用与本地工作区状态；无法可靠确认的操作不得仅根据上一轮日志认定成功。

## 22.2 各动作的重试与后置条件

| 动作 | 必须确认的事实 | 再次调用时如何处理 |
|---|---|---|
| PR Transition / Completion Check | 当前 required Units、有效 Verify、current PR 终态及无 blocker | 重新检查；不把旧 PASS 当作跳过当前 Guard 的依据 |
| Workspace Reconciliation | 登记工作区可安全操作，目标分支和远程状态符合 §20 | 已对齐则跳过；未对齐则安全补齐；脏目录、权限或身份冲突时停止 |
| Summary / Artifact | 当前 Delivery 的摘要与产物存在、内容正确、引用可读取 | 按既有 ID / 稳定目标更新或补齐，不重复追加相同评论、附件或归档记录 |
| Route Archive | 当前 Route 要求的产物已归档且仍可读取 | 已归档不重复移动；部分成功时先核对源与目标再恢复，不破坏仅存副本 |
| OpenSpec Archive / Root Commit（sdd-fast） | 当前 Change 已正确归档，根仓 Commit 可确认且与本 Delivery 对应 | 已归档 / 已提交则复用；结果未知先查询 Git / OpenSpec 事实，只补未完成动作；不创建 PR |
| TFS 回写 | 当前 Work Item / 已有关联 Task 符合该类型的关闭规则 | 已符合则跳过；部分完成只补缺失对象；不新增 Task，不覆盖无关字段或撤销人工状态 |
| Delivery Issue Done | 上述必需动作均已确认，父 Issue 为 `done` | 未完成则最后写入；请求结果未知先回读，不再次触发新交付 |
| Pending 清理 | 对应事件的收口后置条件均已成立 | 只清理该事件；清理失败保留恢复入口 |

摘要与归档使用当前 Delivery / Artifact 的稳定身份；不得以“每次执行生成新文件名 / 新评论”代替恢复。已确认的工作区对齐结果与必需对象引用写入现有收口 Artifact，供最终写入及遗留事件恢复核对，不增加步骤状态表。外部操作已成功、Multica 引用回写失败时，优先找到并复用已存在对象，不盲目重新创建。

普通网络故障允许工具级有限重试；本轮仍失败时保留 pending 并结束，后续再恢复。已经成功的 PR 合并、TFS 更新和归档不做补偿回滚。

明确缺失条件按 `FAIL` 停止后续写入；身份、权限、证据或外部状态无法可靠确认时返回 `UNKNOWN`，交 Delivery Lead / Human。需要人工处理的真实阻塞使用现有 `blocked`，但不得每次轮询重复通知或再次启动专业返工。普通重试不更改已完成 Development Sub-Issue。

若父 Issue 已是 `done` 且存在 pending，仅执行收口事实核对和遗留引用 / 事件清理；不能因为本地会话目录已被回收就自动重开它。必需后置条件确实缺失或当前事实冲突时停止并交人工，不把异常伪装成成功，也不自动重新关闭 TFS。

## 22.3 安装版本恢复验收

本节是项目执行契约，不表示 Multica 自动提供跨 TFS、Git、Artifact 的事务。以下运行测试尚未执行：

| 场景 | 预期 |
|---|---|
| TFS 已更新，父 Issue 最后一次 `done` 写入失败 | 恢复时不重复研发、不重建 PR、不回滚 TFS，只补未完成写入 |
| 摘要 / 归档只完成一部分 | 核对既有对象后补齐，不重复产物、不丢引用 |
| 父 Issue 已 `done`，pending 清理失败 | 下一次扫描仍能恢复，核实后清理，不重新交付 |
| 工作区脏、被占用或来源不明 | 停止，不 `reset --hard` / 强删，不切换其他任务的分支 |
| 完整重复运行 finalize | 不重复副作用；已有合法结果保持不变 |

Run 成功、PR completed、Delivery Issue done 是不同事实。调用方只根据上述后置条件报告收口成功。

---

# 23. Agent / Squad / Skill 边界

公共配置定义以 `multica-design-guideline-v1.4.md` §4、§13、§16 为权威来源。本方案仅列交付场景的使用方式。

| 资产 | 执行主体 / 用途 | 当前交付内容 |
|---|---|---|
| Squad Instructions | 提供给当前 Run 的 Leader，定义协调与委派 | 首次分析委派、基于 Roster 的正常成员选择、批准边界内的工作分工与交接、已有安排复用、Human 等待与异常升级 |
| Agent Instructions | 提供给对应 Agent，定义长期职责与边界 | Workitem Analyst、Engineer、Verify Agent 各自的责任、禁止越界和停止条件 |
| 绑定 Skill | 对应 Agent 的可复用执行方法 | `workitem-analysis`、`development-execution`、`acceptance-verification` 等的步骤、Evidence 与输出契约 |
| Issue / Sub-Issue | 当前工作契约 | Goal、Approved Context、Repository Scope、AC、依赖、Candidate Commit、产物引用 |
| Comment / Handoff | 本轮新增的工作要求 | Finding、预期修正、必要协作信息；普通讨论不自动构成审批 |
| Script / Gate | 必要的硬条件与副作用 | Completion Check、PR Materialization、Sync、有限且可恢复的 Finalize |

Squad Instructions 不自动广播给 Member。Squad Role Description / Roster 帮助 Leader 选择成员，不替代 Member 的 Instructions，不自动赋予权限或绑定 Skill。成员可能通过工具读取其他资料，但不得据此假定这些规则已经进入其执行上下文。[^d-squad]

成员必须执行的输出、前置检查与停止要求，放在其 Agent Instructions 或绑定 Skill 中；其中详细方法统一由 Skill 维护。Backend / Frontend / Flink Engineer 共用的 `development-execution` 分别绑定给三个 Agent，不复制三份方法。

Leader 不在每次派发时复制完整 Squad Instructions / Skill，不要求所有 Member 先读取完整 Squad 配置。Issue 保存本次任务，Member 自有契约提供稳定方法，Leader 只补充本轮特有的协调信息。

Workitem Analyst 的技术分析不依赖当前 Roster 或具体 Agent 配置。它可以提出工作所需的技术能力建议，但不为承担 Leader 的成员选择职责而额外复制、注入或长期维护小队成员映射。

Specialist-owned Sub-Issue 直接启动时也必须具有完整的专业执行契约，不依赖先经历 Leader 派发；Simple Delivery 的 Member 通过同一方法交付，但不得据此关闭父 Delivery Issue。

---

# 24. 推荐 Agent × Skill

| Agent | Squad Role | 主要 Skill |
|---|---|---|
| Delivery Lead | Leader | delivery-flow / delivery-gate / development-task-materialization / pull-request / task-close |
| Workitem Analyst | Member | workitem-analysis / requirement-analysis / bug-analysis / analysis-completion |
| Backend Engineer | Member / Sub-Issue Owner | development-execution / backend-engineering |
| Frontend Engineer | Member / Sub-Issue Owner | development-execution / frontend-engineering |
| Flink Engineer | Member / Sub-Issue Owner | development-execution / flink-engineering |
| Verify Agent | Member | acceptance-verification |
| TFS Sync Agent | Squad 外 Thin Adapter | tfs-sync |
| PR Status Sync Agent | Squad 外 Thin Adapter | pr-status-sync |

说明：

- Delivery Lead 正常承担父 Delivery 的成员选择、工作分工、委派与交接；已有安排直接复用，明确硬条件使用 Gate / Check，不以 `UNKNOWN` 作为协作判断的准入条件。
- Workitem Analyst 输出技术分析与研发准备，按需提出技术拆分和能力需求建议；不负责最终成员选择、Sub-Issue 分工或强制生成执行 Task Graph。
- 职责明确的 Development Sub-Issue 默认直接分配给对应 Specialist Agent；只有 Unit 本身需要持续多角色协调时才 Squad-owned。
- Specialist 完成 Development Sub-Issue 的 Engineering Contract 后，通过确定性 Development Completion Check 进入完成状态；父级回流使用 Multica 原生父子 / Stage 机制。
- TFS Sync / PR Status Sync Agent 作为 Multica Autopilot 的 Thin Adapter；真正同步与 reconcile 逻辑放在确定性脚本中。
- Code Review 属于 Engineer Development 内部机制。
- `pull-request` 的 PR Materialization 是确定性副作用，不绑定某个 Specialist Agent；由父 Delivery 流程在整体 Gate 满足后调用。

---

# 25. 推荐 Skill 目录

```text
workspace-skills/
│
├── tfs-sync/
│   ├── SKILL.md
│   └── scripts/
│       └── reconcile-workitem.py
│
├── workitem-analysis/
├── requirement-analysis/
├── bug-analysis/
├── analysis-completion/
│
├── development-task-materialization/
├── development-execution/
├── backend-engineering/
├── frontend-engineering/
├── flink-engineering/
│
├── acceptance-verification/
│
├── pull-request/
│   ├── SKILL.md
│   ├── scripts/
│   │   └── materialize-pr.py
│   └── references/
│       └── pr-materialization-contract.md
│
├── pr-status-sync/
│   ├── SKILL.md
│   └── scripts/
│       └── reconcile-pr-status.py
│
├── delivery-flow/
│   ├── SKILL.md
│   ├── scripts/
│   │   ├── apply-analysis-review.py
│   │   ├── materialize-development.py
│   │   ├── route-verify-result.py
│   │   ├── route-human-decision.py
│   │   └── finalize-delivery.py
│   └── references/
│
├── delivery-gate/
│   ├── SKILL.md
│   ├── scripts/
│   │   ├── validate-analysis.py
│   │   ├── validate-task-graph.py
│   │   ├── check-development-completion.py
│   │   ├── validate-verification.py
│   │   ├── evaluate-pr-transition.py
│   │   └── evaluate-completion.py
│   └── references/
│
└── task-close/
```

设计原则：

```text
delivery-flow
= 确定性 review routing / materialization / finalize

delivery-gate
= 硬条件检查与 Development Unit Completion Check

Delivery Lead
= Parent Delivery Coordination
+ 正常成员选择 / 工作分工 / 委派与交接
+ 复用已有安排，调用必要确定性 capability
+ 协调冲突与 UNKNOWN，不替代专业判断

Specialist-owned Development Sub-Issue
= 独立 Engineering Contract

Sync Agent
= Thin Adapter

Specialist
= 专业语义工作
```

Delivery Issue 启动使用 Multica 原生 Squad Leader → Member 协作，不设置独立启动脚本。

不建设额外的全局 Workflow Runner。

---

# 26. 状态与事实来源

Multica 保存：

```text
Issue
Status
Assignee
Squad
Sub-Issue
Stage
Run
Comment
Metadata
Artifact
```

对于单个 Development Unit，建议保存最小 Engineering Facts：

```yaml
development:
  result: complete | blocked | unknown
  local_validation: pass | fail | unknown
  code_review: pass | fail | unknown
  candidate_commits:
    - repository: ...
      commit: ...
  pr_preparation_ready: true | false
  evidence_ref: ...
```

其中：

```text
development.result = complete
= 当前 Development Unit 的 Engineering Contract 已完成
= Local Validation PASS
+ Code Review PASS
+ Commit / Push
+ PR Preparation
+ Evidence 完整
```

对于 Development Sub-Issue，`Development Completion Check PASS` 后以该 Sub-Issue 的当前完成状态作为独立 Development Unit 生命周期的正式完成事实。重开时该事实立即不成立；旧 `development.result` / Check 结果仅可作为对应旧候选成果的记录，不能覆盖当前 Issue 状态。

对于 Simple Delivery，Development Unit 没有独立 Sub-Issue，因此 `development.result = complete` 作为父 Delivery Issue 中的 Development Fact 保存，但不改变父 Delivery Issue 的最终完成状态。返工时清除当前 complete 结论，保留旧 Evidence，完成新一轮 Check 后再记录；不增加 `reworking` 状态或版本绑定字段。

Verify 继续保存：

```yaml
verify_agent:
  required: true | false
  reason: ...
  verification_focus: []

verification:
  result: not_required | pending | pass | fail | unknown
  verified_commits: []
  evidence_ref: ...
```

其中：

```text
verify_agent.recommendation
= Workitem Analyst 提出的分析建议

verify_agent.required
= Human Analysis Review APPROVED 后由 Development Materialization 从已批准 Recommendation 确定性生成的执行事实

verification.result / verified_commits
= Verify Agent / Verification Gate 的 Delivery-level 验收事实
```

对于外部系统：

```text
TFS / PR Platform
= 外部事实来源

External State Sync
= TFS Work Item + PR provider status（active / completed / abandoned）事实回流入口

Multica
= 研发流程状态持久化载体
```

不得额外维护：

```text
workflow-state.json
current-stage.yaml
delivery-state.md
```

---

# 27. Deterministic Decision 与 Semantic Decision

## 27.1 原则的适用范围

保留 **Deterministic First，Semantic Fallback**，但不解释为“所有工作先交脚本，脚本失败后才允许 Agent 判断”。

> **明确规则与可靠事实已经决定的结论，不由 LLM 重新裁量；本来需要专业分析或协作判断的工作，由相应角色正常承担，不必先经过一个无法判断的脚本。**

Multica、Agent、Script 分别承担运行、语义工作与明确动作保障；确定性、语义性和 Human Decision 是判断性质的区别。它们不是要求每次依次经过的三层控制器。

| 当前问题 | 正常处理方式 | 边界 |
|---|---|---|
| 当前工作适合哪个成员、是否需要独立工作项 | Delivery Lead 结合批准范围与 Roster；已有明确安排时复用 | 不要求 Workitem Analyst 预先选择全部角色，不以 Router 返回 UNKNOWN 为前提 |
| Root Cause / Solution 是否成立，技术上必须遵守什么 | Workitem Analyst；新工程事实由相应 Specialist 提供 | 不交 Leader 重新执行专业分析 |
| 当前 Unit 的实现细节、反馈方法与工程整改 | Engineer | 不擅自改动批准范围或整体协作安排 |
| 当前 AC 是否实际满足、Finding 如何专业归因 | Verify Agent | 不用 Engineer 自述或字段存在替代独立验收 |
| 候选 Commit、必需 Evidence、对象身份是否满足明确条件 | 必要的 Script / Gate / Check | 只检查可核实硬条件，不覆盖 Human 或专业语义判断 |
| 已确定 Owner 的任务如何写入、关联和恢复 | Multica API / CLI，必要时由脚本封装幂等与校验 | 不在每次写入时重新规划分工 |
| Run 排队、执行、状态及 Parent / Stage 回流 | Multica 原生机制 | 不另建项目级运行调度器 |
| 是否批准 Analysis、是否允许改变已批准边界 | Human / 既有 Review 流程 | UNKNOWN 和语义兜底均不授予绕过批准的权限 |

## 27.2 Deterministic Decision

输入与规则明确、结果能够可靠检查，并且确有程序化保证价值的逻辑，交给已有 API 状态、Script / Gate / Check；平台已提供的运行机制直接复用，不在项目脚本中再实现一遍。

适用内容包括：

```text
必填字段与必要引用是否存在、可读取
已确定任务 / 依赖结构中的 ID、引用和 cycle 检查（按需）
已批准 Recommendation → verify_agent.required
已选择 Owner 的身份解析与校验
现有明确映射规则的直接应用（如有）
Development Completion Contract 的可检查条件
Development Sub-Issue 当前状态与有效 Evidence
Verify PASS 是否对应当前 Commit Set
Finding 已明确命中 Unit 时，读取该 Unit 的现有 Owner
PR Preparation 必填 Facts
Branch HEAD / candidate_commit 校验
PR Materialization / 外部对象身份 / 幂等恢复
PR status active / completed / abandoned
已明确 Human Decision 的合法动作与必要条件
PR Transition / Workspace Reconciliation 安全检查
Delivery Completion / TFS Close / Issue Done
```

成员是否适合、某项技术工作能否独立拆分、运行依赖是否需要变成开发完成依赖，不能仅凭自由文本被声称为确定性结论。Script 不自行进行这些判断，也不扩展为根据 Analysis 自动生成唯一分工的 Compiler。

简单固定的成员分工由 Leader 可见的协作规则维护并使用原生派发；确有明确映射时直接沿用，不为每次交接增加独立 Route Script。

## 27.3 Semantic Decision

### Workitem Analyst

负责：

```text
Corrective / Intentional
Root Cause
Requirement / Solution / Fix Strategy
Development Scope / Repository Scope
技术依赖与约束
实现建议 / OpenSpec Tasks（按 Route 和需要）
技术拆分与能力需求建议（按需）
Acceptance Criteria / Verification Requirements
Verify Agent Recommendation / Verification Focus
```

不要求掌握当前小队成员配置，不承担最终 Sub-Issue 数量、Owner、Stage 编号或 Assignment / Mention 的选择。技术准备不等于运行分工。

### Delivery Lead

负责批准边界内的正常协作判断：

```text
结合当前 Roster 选择适合的成员
哪些工作需要独立 Owner / 生命周期
Sub-Issue 应 Specialist-owned 还是 Squad-owned
Assignment / @mention 及必要交接
技术约束允许的并行 / 顺序与必要 Stage
复用现有分工；只在相关新事实改变安排时调整
跨角色冲突、无法归因的 Finding 及责任协调
输入不足或 UNKNOWN 应交哪个 Specialist / Human 处理
何时必须回到已批准边界的 Review
```

Leader 不是纯异常处理者，也不是所有技术规划的 Owner。选择成员与组织协作不必等到脚本返回 `UNKNOWN`；不重新调查已确认根因或替代 Engineer 编写详细实现步骤。

### Engineer

负责工程实现语义：

```text
Implementation Detail
局部设计与重构
实现步骤、测试策略与 Feedback 方法
Code Review 判断
代码修复
PR Preparation Semantic
```

### Verify Agent

负责 Delivery-level 验收语义：

```text
Acceptance Criteria 是否实际满足
Behavior / Runtime / Integration / E2E Evidence
Finding 的专业归因
```

### Human

负责：

```text
Analysis Approval / Rejection
技术与验收边界及其需要批准的变更
当前任务明确要求审批的人员 / 拆分 / 顺序（如有）
abandoned 的业务含义
ANALYSIS / ENGINEERING / RECREATE_PR / CANCEL_DELIVERY
其他明确要求人工批准的决策
```

## 27.4 Semantic Fallback 与停止边界

`UNKNOWN` 表示当前机制不能获得可靠结论。需要跨角色处理时由 Delivery Lead 协调适当的语义 Owner 查明原因、补充信息或安排修复；不要求 Leader 亲自承担所有专业诊断。

明确 `FAIL` 仍按对应 Gate 的等待、返工、停止或恢复规则处理。权限不足、必要批准缺失、证据不匹配等条件，不能因进入 Semantic Fallback 就获得豁免。

统一原则：

```text
原生运行与协作机制
→ 直接复用 Multica

已明确硬条件与可靠事实
→ 使用相应确定性结果，不再主观裁量

专业分析或协作选择
→ 由相应 Agent 正常承担，不先制造 UNKNOWN

已有安排或有效结果
→ 复用，不因新 Run 重复规划和派发

无法可靠继续 / 需要改变批准边界
→ 协调适当的 Specialist / Human，不能绕过硬条件
```

---

# 28. 反馈循环保护

Development 内部反馈循环：

```text
Engineer
→ Local Validation
→ Code Review
→ Finding
→ Targeted Fix
→ Local Validation
→ Code Review
→ Development Completion Check
```

Verify Agent required 时：

```text
Development Unit(s) Complete
↔
Verify Agent Acceptance Verification
```

Verify FAIL 且 Finding 能明确归因到已完成 Development Sub-Issue 时：

```text
Finding
→ 受影响 Development Sub-Issue 重新进入 in_progress
→ 对应 Specialist Targeted Rework
→ Local Validation
→ Code Review
→ Commit / Push
→ PR Preparation / Evidence Update
→ Development Completion Check
→ Sub-Issue 再次完成
→ Parent Delivery 重新评估 Verify
```

如果：

```text
verification_round >= 3
AND
同类 blocker 重复
```

则：

```text
Parent / affected Issue → blocked
      ↓
Delivery Lead
      ↓
Semantic Diagnosis / Human Escalation
```

不得无限 Engineer ↔ Verify 循环。父级重复推进遵循 §12.1–§12.2；定向重开、证据失效与 Stage 影响遵循 §16.5–§16.8；收口恢复遵循 §22.1–§22.3。只按实际验收轮次计入现有失败阈值，重复通知或脚本恢复不额外计为新验收。

---

# 29. 最终执行模型

## 简单 Delivery

```text
TFS Sync Autopilot
 ↓
Thin TFS Sync Agent → deterministic reconcile
 ↓
Delivery Issue
assignee = Delivery Squad
 ↓
人工启动 / Multica 启动 Delivery Lead
 ↓
@Workitem Analyst
 ↓
Analysis Package
+ 技术范围 / 约束 / 研发准备
+ Verify Recommendation
 ↓
Human Analysis Review
 ↓
Delivery Lead
 ↓
结合批准边界与当前 Roster 安排协作
└─ Simple Delivery：在父 Issue 委派当前 Engineer
 ↓
@Engineer
 ↓
Implementation
→ Local Validation
→ Code Review
→ Commit / Push
→ PR Preparation
→ Development Evidence
 ↓
Development Completion Check
 ↓
├─ Complete + Verify REQUIRED     → @Verify Agent
└─ Complete + Verify NOT REQUIRED → PR Materialization
 ↓
in_review
 ↓
PR Status Sync Thin Agent
 ↓
reconcile-pr-status.py
 ↓
all required PR completed
 ↓
same-run finalize-delivery.py
 ↓
TFS Done / Delivery Issue Done
```

## Complex Delivery

```text
Analysis Package
+ 技术范围 / 约束 / 研发准备
 ↓
Human Analysis Review
 ↓
Delivery Lead
 ↓
结合批准边界与当前 Roster 确定独立工作 / Owner / 顺序
 ↓
materialize-development.py 落实已确定安排
 ↓
Parent Delivery Issue          assignee = Delivery Squad
├─ DEV-Backend                 assignee = Backend Engineer；status = backlog
├─ DEV-Frontend                assignee = Frontend Engineer；status = backlog
└─ DEV-Flink                   assignee = Flink Engineer；status = backlog
 ↓
当前已确定子任务及必要关联完整 → 回读确认
 ↓
仅激活当前依赖满足的 Unit：backlog → todo
 ↓
各 Specialist 独立完成 Engineering Contract
 ↓
Development Completion Check
 ↓
各 Development Sub-Issue → done
 ↓
Multica 原生 Parent / Stage Completion 回流
 ↓
Parent Delivery Issue / Delivery Lead
 ↓
回读 required Units / Evidence / Candidate / Verify / PR Facts
 ↓
├─ 尚有 required Unit 未完成 → 处理依赖或等待
├─ 同一工作已派发 / 无新增动作 → 等待或 no_action / 结束
└─ 整体条件满足且仍需执行
    ├─ Verify REQUIRED 且无有效 PASS → @Verify Agent
    └─ Verify NOT REQUIRED 或已有有效 PASS → PR Materialization
 ↓
Verify Agent（仅当前确需新验收时）
 ↓
PASS → PR Materialization
FAIL → 原 Sub-Issue 准备返工输入 / 无启动重开 → 一次原生执行 → Specialist Targeted Rework
 ↓
Create required PR(s)
 ↓
in_review
 ↓
PR Status Sync Thin Agent
 ↓
same-run deterministic finalize
 ↓
Done
```

如果某个 Development Unit 本身需要持续多角色协调，可将该 Sub-Issue 分配给 Delivery Squad，由 Delivery Lead 在该 Unit 内协调成员；这属于例外拓扑，不改变 Parent Delivery 的整体协调职责。

Merge 后正常 QA / 测试发现的新问题形成新的 TFS Bug / Requirement。

---

# 30. 核心设计原则

> **一个 TFS Work Item 默认对应一个 Delivery Issue。**

> **Delivery Issue 默认由 Delivery Squad 持有；职责明确的 Development Sub-Issue 默认直接由对应 Specialist Agent 持有。**

> **只有 Development Unit 本身需要持续多角色协调或 Owner 无法唯一确定时，Development Sub-Issue 才由 Delivery Squad 持有。**

> **Delivery Lead 在批准边界内结合当前 Roster 正常承担成员选择、工作分工、委派与交接；不是仅在 UNKNOWN 时介入的异常处理者，也不替代专业技术规划或底层运行调度。**

> **Workitem Analyst 负责技术分析与研发准备，可以按需提出技术拆分和能力需求建议；不要求掌握 Roster、绑定具体角色或输出最终执行 Task Graph。**

> **OpenSpec 是 `sdd-fast` 的 Versioned Change Contract：Analysis 形成并经 Human Review 批准，Development 消费，Final Completion 归档；它不是 Multica Workflow Runtime。**

> **OpenSpec Artifact 由根仓 Git Commit 跟踪，不作为业务 Repository Change，不创建独立 PR，也不进入 required PR 集合。**

> **Human 批准技术与验收边界；Leader 在边界内组织协作。需要改变 Expected Behavior、Contract、Scope 或降低验收要求时，返回既有 Analysis / Human Review。**

> **Materialization 只落实已确定的协作安排；Script 检查硬条件、身份与幂等，不从 Analysis 自由文本自行决定任务拆分和成员选择。**

> **Deterministic First，Semantic Fallback 适用于明确硬条件与可靠事实；专业分析和协作选择由相应 Agent 正常承担，不要求先获得 UNKNOWN。明确 FAIL 不因语义兜底而被覆盖。**

> **Leader 减负依靠复用已有分工、避免重复分析与重复派发，不把正常协作职责转移给 Workitem Analyst 或通用 Router。**

> **Development Sub-Issue 的完成契约止于 Engineering Contract 完成：Implementation、Local Validation、Code Review、Commit / Push、PR Preparation 与 Development Evidence。**

> **Development Completion Check PASS 后，Development Sub-Issue 可以进入完成状态；这表示当前 Development Unit 完成，不表示整个 Delivery 完成。**

> **Development Sub-Issue 创建为 backlog，完成必要写入与回读后，仅激活依赖满足的 Unit；准备与激活复用原生能力，不新增 Bootstrap 事务、锁或状态机。**

> **Complex Delivery 优先复用 Multica 原生子任务 / Stage 完成机制回流 Parent Delivery，而不是维护额外 Development Ready 父级通知状态机。**

> **Multica 负责原生运行去重与同一 Issue / Agent 的串行调度；父级按当前事实继续协调；capability 负责副作用幂等。不新增 Parent Lock、CAS、Transition Claim 或第二套 Runtime State。**

> **Simple Delivery 没有独立 Sub-Issue；Development Completion 只形成父 Issue 内的 Development Fact，父 Delivery Issue 继续承担 Verify、PR 与最终关闭。**

> **Local Validation + Code Review 是 Development 必备环节，与 Verify Agent 是否参与无关。**

> **Code Review = implementation-oriented；Verify Agent = behavior-oriented。**

> **Verify Agent 是否需要由 Workitem Analyst 推荐，Human Analysis Review 确认，在所有 required Development Units 完成后进行 Delivery-level 独立验收。**

> **Verify Finding 命中已完成 Development Unit 时，只在原 Sub-Issue 准备输入、重开并单次触发 targeted rework；不级联回退整个 Stage，不沿用失效 Evidence。**

> **PR Preparation 属于 Engineer Semantic Work；PR Materialization 属于确定性副作用，不绑定某个 Specialist Agent。**

> **PR 是 Repository 级交付对象；每个代码变更 Repository 独立 PR。**

> **PR Completed 后由 PR Status Sync 当前 Run 执行有界 deterministic finalize；恢复时重查事实、只补未完成副作用，父 Issue 最后写 done，全部后置条件确认后清理 pending。**

> **TFS Sync / PR Status Sync 保留 Multica Autopilot Agent Run，但 Agent 仅作为 Thin Adapter，确定性逻辑进入 Script。**

> **Integration / E2E Verification 是 Verify Agent 的验证方式，不是独立 Post-Merge Stage。**

> **Stage 只用于 Development Units 之间基于完成条件的依赖，不用于表达 Delivery 生命周期阶段。**

> **Squad Instructions 只约束接收它的 Leader；Member 通过自身 Instructions、绑定 Skill 和当前 Issue 获得执行契约。**

> **不建设第二套全局 Workflow Runtime。**

---

# 31. 架构总结

最终架构：

```text
External Systems
      │
      ▼
Autopilot + Thin Sync Agent
      │
      ▼
Deterministic Sync Script
      │
      ▼
Delivery Issue
Owner = Delivery Squad
      │
      ▼
Delivery Lead
批准边界内的成员选择 / 分工 / 交接
      │
      ▼
Workitem Analyst
→ 技术分析 + 范围 / 约束 / 研发准备
      │
      ▼
Human Review
      │
      ▼
Delivery Lead
→ 结合当前 Roster，确定必要分工并落实
      │
      ├── Simple Delivery
      │     └── @Engineer on Parent Delivery
      │
      └── Complex Delivery
            ├── Specialist-owned Development Sub-Issue(s)
            ├── Squad-owned Sub-Issue(s) only when multi-role coordination is required
            └── backlog → 完成必要写入 / 回读 → 激活依赖满足的 Units
      │
      ▼
Engineering Contract
Implementation + Local Validation + Code Review
+ Commit / Push + PR Preparation + Evidence
      │
      ▼
Development Completion Check
      │
      ├── Simple → Development Fact Complete
      └── Sub-Issue → done
                      ↓
              Multica Parent / Stage 回流
      │
      ▼
Parent Delivery Coordination
按当前事实继续处理（无新增动作 → 结束）
      │
      ├── Verify required 且无有效 PASS → Verify Agent
      └── Verify not required / 已有有效 PASS
      │
      ▼
Deterministic PR Materialization
      │
      ▼
PR Status Sync
      │
      ▼
Deterministic Finalize
      │
      ├── PASS → Done
      └── UNKNOWN → Delivery Lead
```

核心职责：

```text
Workitem Analyst
= 技术分析与研发准备
+ 技术范围 / 依赖 / 约束 / AC / 验证要求
+ 按需技术拆分与能力需求建议

Delivery Lead
= Parent Delivery Coordination
+ 批准边界内的成员选择 / 工作分工 / 委派与交接
+ 复用已有安排，协调冲突与 UNKNOWN

Specialist-owned Development Sub-Issue
= 独立 Engineering Contract

Engineer
= Engineering Semantic Owner

Verify Agent
= Delivery-level Acceptance Semantic Owner

Script / Gate / Route
= Deterministic Control / Side Effect / Idempotency

Multica
= Issue / Parent-Child / Stage / Squad / Run / Assignment / @mention / Status Runtime
```

本方案优先复用 Multica 原生 Squad 启动、Issue Ownership、Parent / Child 与 Stage 完成机制。Workitem Analyst 形成技术准备，Human 批准技术与验收边界，Delivery Lead 结合当前成员组织协作，Engineer 在分配范围内决定实现细节；必要脚本落实已明确动作并检查硬条件，不替代专业或协作判断。

已有安排与有效结果优先复用；没有相关新事实，不重新分析、规划或派发。不新增三份计划文档、通用编译器、角色映射体系或第二套 Runtime。

---


# v1.4.7 变更摘要

本版本补充 OpenSpec 与当前 Delivery 架构的正式接入边界，不改变既有 Multica Runtime、Issue 生命周期、成员分工或业务 PR 模型。

- `sdd-fast` 正式使用 OpenSpec 作为 **Versioned Change Contract**；OpenSpec 不承担 Runtime、Assignment、Sub-Issue、Stage 或 Delivery Status。
- Workitem Analyst 在 Analysis 阶段创建 / 更新 OpenSpec Change；Human Analysis Review 一并批准其技术、行为与验收边界，不增加第二套 OpenSpec Approval State。
- Delivery Lead 消费 Approved OpenSpec 组织协作，但不得将 `tasks.md` 机械映射为 Development Sub-Issue。
- Engineer 在当前 Development Unit 内消费 Approved OpenSpec；`tasks.md` 只作为 Implementation Checklist。
- Approved OpenSpec Change 在 Human Review 通过后提交到根仓，形成稳定 Development 输入；根仓 Commit 不作为业务 Repository Change，不创建独立 PR。
- `sdd-fast` Final Completion 的 Route Archive 明确包含 OpenSpec Archive + 根仓 Git Commit；失败 / UNKNOWN 阻止最终 `done`，但不回滚已完成业务 PR。
- OpenSpec Change Identity、Artifact 深度、Preparation / Review / Rework 细节下沉到 Workitem Analyst 领域方案，遵守 One Rule, One Owner。

# v1.4.6 变更摘要

本次只调整技术准备、成员协作与确定性执行的职责边界，保留既有交付生命周期和运行机制。

- 在 §2 总体架构图下新增各 Agent 定位、主要工作与交付边界，并说明 Squad、Human、Script 与 Multica 的关系。
- Delivery Lead 收敛为批准边界内的父级协作职责；正常负责成员选择、必要任务分工与交接，不再以笼统的 Runtime Topology Owner 定义全部规划权，也不降为纯异常处理者。
- Workitem Analyst 保留研发准备、技术依赖、实现建议与按需拆分建议；不强制输出完整执行 Task Graph、`development_plan.units` 或 `role_requirement`，不依赖当前 Roster。
- Human Review 明确批准技术与验收边界；边界内的正常协作安排由 Leader 承担，明确要求人工审批的分工或顺序仍遵循该要求。
- `materialize-development.py` 继续落实已经明确的协作安排，不扩展为从 Analysis 自动推导唯一运行分工的 Compiler。
- 明确 Deterministic First，Semantic Fallback 的作用域：硬条件不重复裁量，专业与协作语义由相应角色正常承担，UNKNOWN 不授予绕过 FAIL 或人工批准的权限。
- 同步修订 §1、§3、§7–§10、§12–§14、§23–§25、§27、§29–§31 的契约、模板、流程与摘要，避免仅在角色说明中修改而下游继续依赖旧职责。

本次未调整 Status Key、Gate / Skill 集合、PR 同步与收口策略，也未改写配套规范、Analyst 或 Engineer 独立文档。实施前需将本次职责边界同步到相应 Instructions / Skills；本次仅完成文档更新，未执行 Multica CLI / Server 运行验收。

以下历史摘要保留版本记录，不作为当前执行规则；当前职责与流程以正文为准。

---

# v1.4.5 变更摘要

当前执行规则见正文：原生 Squad 启动与按职责分配；Engineering Contract 完成与父级回流；子任务准备 / 激活；父级防重复；Human Comment 处理；Leader / Member 注入边界；定向返工与事实驱动收口。版本号保持 v1.4.5。

## 实施参考

以下官方文档与公开实现用于核对原生行为；项目业务规则由正文定义。核对日期：2026-09-27。公开 `main` 不等于已安装版本，CLI 参数与运行行为仍需按各节验收。

[^d-squad]: [Multica Squads](https://multica.ai/docs/squads)：Squad Instructions 的 Leader-only 接收边界、Roster 与原生协作协议。
[^d-trigger]: [Issue trigger 实现](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/service/issue_trigger.go) 与 [Assign issues](https://multica.ai/docs/assigning-issues)：状态写入、启动条件与请求级抑制；不将 `done → in_progress` 等同于 Run 启动。
[^d-runs]: [Multica Tasks](https://multica.ai/docs/tasks) 与 [CLI 实现](https://raw.githubusercontent.com/multica-ai/multica/main/server/cmd/multica/cmd_issue.go)：Issue、Run、retry / rerun 的区别，当前 Owner 的重新运行入口。
[^d-assign]: [Assign issues](https://multica.ai/docs/assigning-issues)：改状态或改 Owner 不会停止已开始的 Run。
[^d-child]: [Parent / Stage completion 实现](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/handler/issue_child_done.go)：子任务进入终态、Stage 条件、父级通知与 best-effort 边界。

---

# v1.4.4 变更摘要

相对 v1.4.3，本版本完成 Review P0 / P1 / P2 / P3 的收敛：

- Development Topology 调整为两层模型：
  - Workitem Analyst 输出 **Development Plan / Task Graph**；
  - Delivery Lead 拥有最终 **Multica Runtime Topology / Collaboration Decision**；
- Human Analysis Review 审核 Development Plan / Task Graph，但不直接批准最终 Runtime Topology；
- Delivery Lead 决定是否创建 Development Sub-Issue、是否需要 Stage、各 Specialist 的参与与 `@mention` 顺序；
- 所有 Development Sub-Issue 统一 `assignee = Delivery Squad`，不直接长期分配给 Specialist Agent；
- Specialist 统一通过 Delivery Lead `@mention` 工作，成员 Result / Progress Update 复用 Multica 原生机制重新唤醒 Leader；
- 不再设计额外 `@Delivery Squad` 的父级回流机制；
- `start-analysis.py` 正式接入 Delivery Issue 启动流程；
- `apply-analysis-review.py` 正式接入 Human Analysis Review 的 APPROVED / REJECTED 路径；
- `route-human-decision.py` 正式接入 PR Abandoned 后 Human `NEXT` 的确定性路由；
- `Development Completion Check` 统一更名并收敛为 `Development Readiness Check`；
- Gate `FAIL` 不再统一解释为 targeted rework，而由每个 Gate 定义 wait / rework / stop / recovery；
- TFS Sync / PR Status Sync 明确采用 **Multica Autopilot + Thin Agent Adapter + Deterministic Script**，避免为了完全无 Agent Run 再建设第二套 Runtime；
- PR Completed 后继续使用 PR Status Sync current-run 的 deterministic finalize；
- 修复重复的 `## 3.4 Specialist Agent` 标题等编辑问题；
- 两条核心原则保持不变：
  1. 能确定性化的业务规则、Gate、副作用、幂等、物化全部进入 Script；
  2. Happy Path 保留 Multica Squad 原生 Delivery Lead Run，Lead 优先使用确定性路由，确定性不足时承担完整语义协调职责。

---

# v1.4.3 变更摘要

> 本版本直接基于 `v1.4.1` 调整；此前生成的 `v1.4.2` 草案废弃，不作为本版本基线。

- 恢复并明确 Delivery Lead 的完整 Leader 定位：**Deterministic First，Semantic Fallback**；
- 保留“多 Agent 协作优先由 Delivery Lead 通过 `@mention` 协调”；
- 明确 Delivery Lead 在确定性 Route / Gate 无法可靠决定下一步、返回 `UNKNOWN`、出现事实冲突或跨角色歧义时，必须承担语义路由与协调职责；
- 区分 **专业语义工作** 与 **协调语义工作**：Workitem Analyst / Engineer / Verify Agent 负责各自专业领域，Delivery Lead 负责跨角色 routing / coordination semantic decision；
- 确定性规则、Gate、副作用、幂等、物化与完成检查继续全部下沉到 Script / Gate / Route；
- Delivery 启动与 Human Analysis Review 后保留 Squad 原生 Delivery Lead Run；Lead 优先调用确定性 route / materialization，必要时才语义判断；
- Development Readiness Check 正式定义为 Deterministic Script：Engineer 只产生 Ready Facts，Delivery Lead 被成员进展唤醒后调用 Check 并协调下一步；
- Complex Delivery 不再以“Engineer 最后一个 Ready Run 直接跨成员 dispatch”作为主路径；改为成员结果回流 Squad，由 Delivery Lead 依据 Readiness Check `@Verify Agent` 或触发 PR Materialization；
- Verify Agent 输出 Finding 的专业归因；明确 Development Unit → Engineer 的映射使用确定性 Route，无法归因时由 Delivery Lead 做语义协调；
- PR Materialization 保留确定性实现，但由 Delivery Lead 在 Ready / Verification Gate 满足后调用；不重新启动 Engineer 只为创建 PR；
- PR Completed 后继续采用 PR Status Sync same-run deterministic finalize，避免无语义价值的 Lead Run；若 Finalize 返回 `UNKNOWN` / 冲突，再升级 Delivery Lead；
- Delivery Lead 不再被定义为纯 Exception Handler，而是 **Squad Router + Semantic Coordinator + Exception Handler**。

---

# v1.4.1 变更摘要

相对 v1.4.0，本版本进一步减少 Happy Path 的 Agent Run 与 Token 开销：

- PR Materialization 改为 **same-run deterministic tail**，不再固定由 Delivery Lead 新 Run 触发；
- `verify_agent.required=false` 时，最后一个使全部 required Development Units 达到 `Development Ready` 的当前 Engineer Run 直接调用 `pull-request` capability；
- `verify_agent.required=true` 时，Verify Agent 在 Verification Gate PASS 后于当前 Run 尾部直接调用 `pull-request` capability；
- Complex Delivery 的 Specialist Agent 达到 `Development Ready` 后不再固定 `@Delivery Squad` 唤醒 Delivery Lead；改为写回 Ready Facts 并执行确定性的 Development Readiness Check；
- 尚有 Development Unit 未 Ready 时当前 Engineer Run 直接结束；当前 Run 使全部 required Units Ready 时，按 `verify_agent.required` 直接 `@Verify Agent` 或执行 PR Materialization；
- Delivery Lead 从正常 PR 创建 Happy Path 中移出，仅在 `UNKNOWN`、事实冲突、跨角色异常或无法可靠路由时介入；
- `pull-request` 改为 Engineer / Verify Agent 当前 Run 都可调用的共享确定性 capability；Delivery Lead 不再把它作为正常职责 Skill；
- PR Materialization 仍保持幂等、多 Repository 一次处理、Candidate Commit 校验与 current_pr 回填；PR Preparation 仍由 Engineer 在 Development Run 内完成；
- PR Materialization 发现需要 rebase、冲突解决、代码修改或其他 Engineering Semantic Work 时，仍定向回到对应 Engineer；纯 API / 网络 / 幂等恢复问题不启动 Agent；
- 不改变 Verify Agent 的 behavior-oriented 独立验收定位，不改变 Workitem Analyst Recommendation + Human Analysis Review 的 Verify 决策机制。

---

# v1.4.0 变更摘要

相对 v1.3.9，本版本进一步收敛 PR 创建责任与 Run 成本：

- 将 PR 交付正式拆分为 **PR Preparation** 与 **PR Materialization**，两者是职责边界，不新增 Workflow Stage；
- Engineer 在原 Development Run 内完成 PR Preparation：Repository / Source Branch / Target Branch / Candidate Commit / PR Title / Description / Work Item 关联等，避免后续 PR 创建重新加载代码上下文；
- `Development Ready` 增加 `PR Preparation 完整` 条件；Engineer 仍负责代码实现、Local Validation、Code Review、Commit / Push 与 PR 语义准备；
- Verify PASS 或无需 Verify 后，不再 `@` 每个 Engineer 启动新 Session 创建 PR；Delivery Lead 触发确定性的 `pull-request` capability 执行 PR Materialization；
- PR Materialization 一次读取所有 required Repository Change 的已准备 Facts，逐仓校验 Branch / Candidate Commit、调用 TFS / PR API、校验返回身份并写回 `current_pr`；
- 多 Repository PR 创建采用幂等处理：已成功创建并登记的 PR 不重复创建，失败重试只补未完成项；
- 只有 Branch HEAD 与 candidate commit 不一致、需要 rebase / conflict resolution、出现新的代码问题或其他 Engineering Semantic Work 时，才重新交给对应 Engineer；API 临时失败、网络错误和 metadata 恢复不启动 Engineer；
- `pull-request` Skill 从 Engineer 的主要 Skill 中移出，由 Delivery Lead 作为确定性 Materialization capability 触发；具体创建动作由 script / API 完成，不让 LLM 重复执行确定性副作用；
- `verify_agent.required=true` 时，PR Materialization 只能使用 Verify PASS 对应的候选 Commit Set；代码变化会使旧 Verify PASS 失效，并重新走 Local Validation + Code Review + Verify；
- 所有 required PR 成功登记后，Issue 才进入 `in_review`；后续 PR Status Sync / Completion 机制保持不变。

---

# v1.3.9 变更摘要

相对 v1.3.8，本版本进一步收敛 Verify Agent 决策与验证范围：

- 暂不设计“同一 Repository 多个候选 Branch 需要组合验证”的复杂场景；当前 Delivery 方案只要求 Verify Agent 基于各 required Repository 已固定的候选 Branch / Commit 执行验收；
- `bug-fix / production-fix` 不再硬编码默认 `Verify Agent: NOT REQUIRED`，`sdd-fast` 也不硬编码默认 `REQUIRED`；是否需要 Verify Agent 统一由任务的 Acceptance Criteria、Verification Requirements、Development Units、跨系统行为和可验证性决定；
- Workitem Analyst 只输出 `Verify Agent Recommendation: REQUIRED | NOT REQUIRED`、Reason 与 Verification Focus，不直接拥有最终批准权；
- Human Analysis Review 对 Recommendation 与整个 Analysis Package 一并审核；Human `APPROVED` 即表示接受该 Recommendation，不增加第二个 Verify 审批动作；
- Development Materialization 将已批准 Recommendation 确定性转换为 `verify_agent.required=true|false` 执行事实；Delivery Lead 只按批准结果执行，不重复做风险判断；
- 简单 Corrective Change 通常会推荐 `NOT REQUIRED`，但这只是常见分析结果而非 Route 默认；复杂 `bug-fix / production-fix` 同样可以推荐 `REQUIRED`；
- Workitem Analyst 最终 Summary 统一显式打印 `Verify Agent Recommendation`，用于 Human Review 时快速确认。

---

# v1.3.8 变更摘要

相对 v1.3.7，本版本重新收敛 Verify Agent 与 Development Quality Model：

- 删除 `Verification Policy = engineer | independent` 概念；Engineer Local Validation / Code Review 不再被视为 Verification Policy 的一种；
- 正式明确 **Local Validation + Code Review 是 Development 必备环节，与 Verify Agent 是否参与无关**；
- Verify Agent 收窄为 Delivery-level、behavior-oriented 独立验收者，只从 Acceptance Criteria / Verification Requirements 验证最终行为；
- `bug-fix / production-fix` 默认 `Verify Agent: NOT REQUIRED`；复杂 `sdd-fast`、跨系统行为、复杂 AC、Runtime / Integration / E2E 场景按 Analysis 决定；
- 是否需要 Verify Agent 由 Workitem Analyst 在 Analysis Package 中提出，并在最终 Summary 中显式打印；Human Analysis Review 对该结论一并确认；Delivery Lead 正常情况下只执行，不重新判断；
- Integration / E2E Verification 合并为 Verify Agent 的验证方式，删除独立 Post-Merge Integration Verify 阶段；
- Verify Agent 从“每个 Engineer 完成后参与”上移到“所有 required Development Units Ready 后按需参与”；
- Engineer 在 Development 阶段完成 Local Validation、Code Review、Commit / Push，形成固定候选 Branch / Commit Set，但暂不创建正式 PR；
- Verify Agent required 时，基于候选 Commit Set 做 Acceptance / Runtime / Integration / E2E Verification；PASS 后再由对应 Engineer 创建各 Repository PR；
- Verify FAIL 时只激活受影响 Development Unit，Engineer 修复后必须重新 Local Validation + Code Review + Commit / Push，再进入 Verify；
- PR 创建时点统一为：所有 required Development Units Ready，且 Verify Agent 不需要或 Verify PASS；所有 required PR 注册完成后才进入 `in_review`；
- Merge 后只执行 Post-Merge Workspace Reconciliation 与 Delivery Completion，不再自动做 Integration Verify；后续 QA / 测试发现的问题形成新的 TFS Work Item / Delivery；
- Verification Facts 增加候选 Commit Set / verified commit set 对齐，避免 Verify PASS 后代码变化仍沿用旧 Evidence。

---

# v1.3.7 变更摘要

相对 v1.3.6，本版本收敛 Development Verification 模型：

- 将“所有研发默认 Engineer → Verify Agent”调整为 **Verification 必须、Verify Agent 按需**；
- 新增 `Verification Policy`，当前仅保留 `engineer | independent` 两种模式，不增加多级复杂度；
- `engineer` 仅用于低风险 Corrective Change：Root Cause confirmed、Expected Behavior / Contract 不变、存在可靠 Regression Signal、Verification Requirements 可在当前 Development Unit 内闭合；
- `independent` 用于 `sdd-fast`、Root Cause 未确认、Contract / Schema / Migration / Event Change、跨系统边界、无法建立可靠 Feedback、显式独立验证要求等场景；
- Repository 数量本身不决定 Verification Policy；跨仓只有在形成 Contract / Integration Boundary 时才成为 Independent Verification 信号；
- Engineer Execution 改为 `Implementation → Local Validation → Review → Verification Policy`，不再默认直接 `@Verify Agent`；
- Policy=`engineer` 时，Engineer Local Validation + Development-level Review + Evidence 可以满足 Required Verification；
- Policy=`independent` 时，必须由 Verify Agent 独立验证，Engineer 不得自行降级；Targeted Rework 后仍按原 Policy 重新验证；
- `required_verify_pass` 统一抽象为 `required_verification_pass`，PR Transition Gate 与 Delivery Completion Gate 不再要求每个 Development Unit 必须存在 Verify Agent PASS；
- Integration Verify 保持独立机制，继续在 Merge 后根据跨 Repository / Contract / Event / 多 Development Unit 等组合风险按需执行；
- Simple Delivery 的定义进一步收敛为“单一 Development Unit”，不再把单 Repository / 单 PR 当作必要特征；
- Canonical Terminology 引用更新为 `multica-design-guideline-v1.4.md`；
- Squad、Sub-Issue、PR Status Sync、Abandoned Human Decision、Post-Merge Reconciliation 等 v1.3.6 核心机制保持不变。

---

# v1.3.6 变更摘要

相对 v1.3.5，本版本根据 TFS MCP 实际 PR 快照验证结果收敛 PR 状态模型：

- 取消机器层面的 `Rejected` Significant Event；正式以 provider `status=active|completed|abandoned` 作为 PR 状态事实，其他值或异常结构进入 `UNKNOWN`；
- `active` 统一 NO-OP；`completed` 为 Success Event；`abandoned` 为 Exceptional Stop Event，并进入 `blocked + Human Decision`；
- `Rejected / Discarded` 不再由 `pr-status-sync` 推断，只允许作为 Human 对 `abandoned` 原因的分类；Human 同时明确 `ANALYSIS / ENGINEERING / RECREATE_PR / CANCEL_DELIVERY` 等下一步；
- 删除 Reviewer Vote 相关设计；普通审核过程继续由 TFS 管理，不进入 Multica Delivery 状态模型；
- Completion 只认 `provider_status=completed`；`mergeStatus / mergeCommitId / mergeCommitMessage` 仅作为 provider 辅助信息，不得触发完成；
- `completedDate` 统一归一化为 `provider_closed_at`，必须结合 `provider_status` 解释，不再无条件映射为 `merged_at`；
- PR Metadata 从单一 `pr` 调整为 `current_pr + pr_history`：被 Abandoned / 替代的旧 PR 移入历史，新 PR 成为 current PR；Completion Gate 只检查 current required PR；
- 新增 PR 查询身份校验：PR ID、Repository、Project 与登记映射不一致时返回 `UNKNOWN`，不得依赖标题、描述或 TFS Work Item 反查 Delivery；
- 新增轻量 `current_pr.sync.pending_event / event_key` 恢复机制；Autopilot 除扫描 `in_review` 外，还需恢复 pending event，避免状态部分写入后永久失联；
- Abandoned 同步不写普通顶层 Comment；机器只负责 `blocked + Delivery Squad + facts`，真正唤醒 Delivery Lead 的 Trigger 改为后续 Human Decision Comment；
- PR Transition Gate 改为检查 `all(required_current_pr_completed)`，并明确 `UNKNOWN` 不允许关闭；
- 不改变 Squad、Delivery Lead、Analysis Review、Verify、Post-Merge Workspace Reconciliation 与最终 Completion 的总体架构。

---

# v1.3.5 变更摘要

相对 v1.3.4：

- 统一 PR 外部事件模型为 **PR Significant Event Model**，当前只识别 `Merged / Completed`、`Rejected`、`Abandoned / Closed` 三类会改变 Delivery 流向的事件；
- `Merged / Completed` 定义为 Success Event，`Rejected` 定义为 Rework Event，`Abandoned / Closed` 定义为 Exceptional Stop Event；
- 修正 §1、§3.6、§17、§18、§29、§30、§32、§33 等章节中“只处理两类事件”与 `Abandoned / Closed` 实际处理逻辑不一致的问题；
- `pr-status-sync` 增加 Significant Event 解析优先级：当前终态优先；多 PR 聚合按 `Abandoned / Closed` → 当前有效 `Rejected` → `all required PR Merged / Completed` → 否则 NO-OP；历史 Reviewer Reject 不覆盖已完成的 PR 终态；
- `Abandoned / Closed` 增加独立事实与幂等通知字段 `abandoned_at / abandonment_notified_at`，防止定时同步重复 Comment / 重复唤醒；
- `Abandoned / Closed` 继续进入 `blocked + Human Decision`，但不自动推断任务取消、重新创建 PR、回 Analysis 或回 Engineering；
- 不改变既有 PR Happy Path、Reject 回流机制、Delivery Lead 职责或 Completion Gate，仅做模型与表述一致性修订。

---

# v1.3.4 变更摘要

相对 v1.3.3：

- `pr-status-sync` 从仅检测 Merge 扩展为 PR Significant Event Detection；当前识别 `Merged / Completed`、`Rejected`、`Abandoned / Closed`，仍不复制完整 PR Review 状态机；
- 普通 `Active / Changes Requested / Approved / Reviewer Vote / Review Feedback` 继续忽略并 NO-OP；
- 任一 required PR 出现 `Rejected` 时，记录原负责人，将当前 Delivery Issue / Development Sub-Issue 置为 `blocked` 并交给 `Delivery Squad`，写入 Reject Facts 后停止自动推进；
- `pr-status-sync` 不判断 Reject 属于 Analysis 问题还是 Engineering 问题，该决策明确交给 Human；
- Human 通过顶层 Comment 使用 `REWORK: ANALYSIS` 或 `REWORK: ENGINEERING` 指定纠偏方向，复用 Squad Comment → Delivery Lead 唤醒机制；
- `REWORK: ENGINEERING` 只执行 Targeted Fix → Verify → PR；`REWORK: ANALYSIS` 回到 Workitem Analyst，并重新经过 Analysis Gate + Human Analysis Review；
- PR `Abandoned / Closed` 作为独立 Exceptional Stop Event 进入 `blocked + Human Decision`，不隐式推断为任务取消；未来如需取消语义，单独定义 Cancellation Policy；
- Reject / Abandon / Completion 同步均要求幂等通知，避免 Autopilot 重复 Comment / 重复唤醒。

---

# v1.3.3 变更摘要

相对 v1.3.2：

- PR 阶段进一步收敛：Multica 不再建模 `Changes Requested / Approved / Reviewer Vote / Review Feedback` 等 TFS PR 中间状态；
- 保留 `pr-status-sync` Skill 名称，但职责收敛为 PR Completion Detection；
- `status = in_review` 期间仅定时检查所有 required PR 是否已 `Merged / Completed`；未全部完成时 NO-OP；
- 所有 required PR 合并完成后，只写一次最终 Merge Facts，并向 Delivery Issue 写普通顶层 Comment；
- Delivery Issue 由 `Delivery Squad` 持有时，普通 PR Completion Comment 复用 Multica Squad 机制唤醒 `Delivery Lead`；
- Comment 只作为 Trigger；PR metadata 作为外部事实持久化；`PR Transition Gate` 负责确定性完成判断；
- PR Transition Gate 统一检查 `required_verify_pass + all(required_pr_merged) + no_unresolved_blocker`；
- 新增 Post-Merge Workspace Reconciliation：Merge 后切换 PR `target_branch`，执行 `fetch --prune + pull --ff-only`，本地 Source Branch 仅允许安全删除；
- `pr-status-sync` 不直接操作 Git 工作区，Merge 后本地对齐由 Delivery Lead 的收口流程负责；
- Complex Delivery 的 Development Sub-Issue 仍在全部完成后显式 `@Delivery Squad`，不假设普通 Comment 能跨 Sub-Issue 隐式唤醒父级 Delivery Lead。

---

# v1.3.2 变更摘要

相对 v1.3.1：

- 引用 `multica-design-guideline-v1.4.md` 的 Canonical Terminology，不再在本方案维护第二套全局术语；
- Squad 正式名称统一为 `Delivery Squad`，Leader Agent 正式名称统一为 `Delivery Lead`；
- 分析 Agent 正式名称统一为 `Workitem Analyst`，不再使用 `Analyst` 作为同一 Agent 的别名；
- 验证 Agent 正式名称统一为 `Verify Agent`；`Verify` 仅在表示验证动作时使用；
- `Development Issue` 统一改为 `Development Sub-Issue`；
- `Parent Completion Gate` 统一改为 `Delivery Completion Gate`；
- Analysis Review 的正式 Status Key 改为 `analysis_review`，Display Name 保持 `Analysis Review`，Category=`started`；
- 所有状态判断、流程文本和 Gate 条件统一使用 `analysis_review`；UI / 自然语言说明可显示 `Analysis Review`。
