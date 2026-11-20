# Multica + OpenSpec 设计方案解读

> 本文是对 `docs/` 中两份设计文档的解读笔记，非正式设计规范。
> 解读对象：
> - `01-multica-openspec-design-guideline-v1.16.3.md`（统一设计规范，2026-10-09）
> - `02-multica-delivery-lifecycle-design-v1.6.6.md`（研发交付生命周期设计方案，Draft Baseline 未部署，2026-10-09）

---

## 1. 总体关系

两份文档构成一个**两级文档体系**，描述"基于 Multica（AI 智能体协作平台）+ OpenSpec（规格驱动开发工具）+ TFS（Azure DevOps 工作项 / PR 平台）的 AI 研发自动交付流程"：

| | 文档 01（指导手册，v1.16.3） | 文档 02（Delivery 主方案，v1.6.6） |
|---|---|---|
| 定位 | **上位设计规范 / 元规则** | **业务流程方案**（应用 01 的规则） |
| 回答的问题 | 每类资产（Agent Instructions、Skill、Autopilot Prompt、OpenSpec Schema…）应该写什么、不该写什么、边界在哪里 | 一个 TFS 工作项从同步到交付归档，完整生命周期怎么流转 |
| 类比 | 宪法 / 设计哲学 | 依据宪法制定的业务流程法 |

文档 02 大量引用 01 的具体条目（如 `#mechanism-assignment`、`#runtime-artifact-principle`），并明确"不维护第二套术语表"——01 是权威，02 只引用不复制。01 的 §1.5.2 还定义了完整的文档族谱：

| 文档 | 权威维护内容 |
|---|---|
| 01 指导手册 | 组合架构原则、统一术语、跨系统职责边界、Multica 配置规范、OpenSpec 公共机制、官方来源引用规范 |
| 02 Delivery 主方案 | 跨角色生命周期、人工授权、状态转换、任务组织、TFS、Stage、Verify、PR 与收口 |
| 03 Workitem Analysis 设计方案 | 分析角色与方法、OpenSpec Engineering Truth、Analysis Gate 细项 |
| 04 Engineer Development 设计方案 | 工程方法、本地验证、Code Review、Evidence |
| 05 OpenSpec Schema 实施设计 | Schema YAML、Artifact Graph、Template、Validation / Archive 实施契约 |
| 06 Method Skill Library 实施设计 | Skill 内部 Engineering Method Module 的组织与治理 |

**注意：03–06 目前在 `docs/` 中不存在**，是被引用但尚未入仓的下游文档。

---

## 2. 文档 01：统一设计规范解读

核心价值是防止 AI Agent 系统工程中的典型腐化，可归纳为四层。

### 2.1 核心架构原则（§1.2）

全文最重要的一句话：

> **Multica = Delivery Truth（交付事实：谁、什么时候、什么状态）；OpenSpec = Engineering Truth（工程事实：需求、规格、设计、任务、证据）。**

配套规则：

- **Reference, not Replication**——两个事实域只用稳定引用连接，不复制对方正文；
- **No Third Truth Store**——禁止为"交接方便"新建第三套带独立 schema / 生命周期 / 状态的对象；
- **One Rule, One Owner**——每条规则只有一个权威定义位置，其他地方只能引用；
- **Skill ≠ Artifact、Summary ≠ Truth Source**——执行名为 `bug-analysis` 的方法，不意味着必须生成 `bug-analysis.md`；
- 全局原则：Native First、KISS、Greenfield First、Minimal Sufficient、Contract First。

### 2.2 资产分层职责（§4–§8）

每个配置资产钉死在一个职责上：

```text
Agent Description  = 展示用（不进 Prompt！）
Workspace/Project Context = 共享长期上下文
Autopilot Prompt   = 本次 Run 的触发意图（2~5 句话）
Squad Instructions = 只给 Leader 看的协作契约（成员收不到）
Agent Instructions = 角色契约（我是谁/我管什么/我在哪里停止）
Skill              = 可复用执行方法（SKILL.md 保持最小充分）
Issue              = 本次具体工作
Gate/Route/Script  = 确定性判断与执行
LLM                = 只做语义推理
```

Agent Instructions 采用**五段式**：

```text
# Role
# Core Responsibilities
# Boundaries
# Execution Principles
# Escalation, Communication & Delivery
```

强调两个写作原则：

- **Boundary-first**：优先明确"Agent 到哪里必须停止"，而不是"还能做什么"；
- **Role-oriented 而非 Workflow-oriented**：写"我是谁、我的判断原则"，不写 `A → B → C → D` 流程。

### 2.3 决策边界（§9）

三分法：

| 判断性质 | 执行者 |
|---|---|
| 输入明确、规则明确、结果有限（确定性决策） | Script / Gate / Route，LLM 不许再判断一遍 |
| 需要语义理解（语义决策） | 对应专业 Agent 或 Leader |
| 批准、改变边界（人工决策） | Human；`UNKNOWN` 和语义兜底都不授予绕过人工批准的权力 |

### 2.4 反模式目录（§10）与评审清单（§11）

12 个具名反模式，本质是两类的枚举：

1. **用 Prompt 模拟状态机**：Super Prompt、Workflow-as-Prompt、Leader-as-Workflow——最终与确定性状态机双写漂移；
2. **重复定义**：Duplicate Rules、Implicit Squad Inheritance、Reference-in-SKILL——同一规则多处维护导致版本漂移。

附录的**来源引用规范**很有特色：每条 Multica 官方机制标注核对日期，区分"官方手册 / 公开源码 / 项目约定 / 待验证项"，并明确 **"文档核对 ≠ 安装版本运行验收"**——防止把读到的文档当成已验证事实。

---

## 3. 文档 02：研发交付生命周期解读

一个 TFS 工作项从同步到关闭的完整流水线设计（**Draft Baseline，未部署**）。

### 3.1 端到端流程

```text
TFS Sync（Autopilot 定时，薄适配器 + 确定性脚本，幂等）
  → 创建 Delivery Issue（Squad-owned, backlog）
  → 人工 backlog→todo，唤醒 Delivery Lead
  → @Workitem Analyst 分析（产出 OpenSpec Change + 交付事实）
  → Analysis Gate（确定性检查）
  → status=analysis_review，Human 自然语言审核
  → 批准 → Delivery Lead 分工（@Engineer + task_refs，或按需 Sub-Issue）
  → Engineer：实现 → 本地验证 → Code Review → Commit/Push → PR Preparation → Evidence
  → Development Completion Check
  → 按需 Verify Agent 独立验收（Verification Gate）
  → PR Materialization（确定性脚本建 PR）→ in_review
  → PR Status Sync（Autopilot 轮询 provider status）
  → 全部 completed → same-run finalize（对账 / 归档 / TFS 回写 / done）
```

状态模型：

```text
backlog → todo → in_progress → analysis_review → in_progress → in_review → done
                                                              （PR abandoned → blocked）
```

§2.3.1 给出单工程师理想路径的 **7 次 Run** 具体示例（Run 0 TFS Sync → Run 6 PR 合并收口；需要独立验证则 9 次），并注明计数口径与"不是固定配额"。

### 3.2 角色分工

| Agent | 定位 | 关键边界 |
|---|---|---|
| **Delivery Lead**（Leader） | 轻量协调者：理解人工意见、在批准边界内选成员/分工/交接 | 既不是纯异常处理器，也不是工作流引擎；不替代专业分析和人工批准 |
| **Workitem Analyst** | 分析 + 研发准备 | 提交审核后必须结束 Run 等待人工，不得自行批准 |
| **Backend/Frontend/Flink Engineer** | 共享 `development-execution` 方法，完成完整 Engineering Contract | 不决定整个 Delivery 是否完成，不关闭父 Issue |
| **Verify Agent** | **按需**的独立验收者 | `verify_agent.required=true` 才介入；Analyst 推荐、Human 最终决定 |
| **TFS Sync / PR Status Sync Agent** | Squad 外薄适配器 | Agent 不做业务判断，逻辑全在确定性脚本 |

### 3.3 关键设计决策（§14 摘要精华）

1. **一个 TFS Work Item = 一个 Delivery Issue**，不按角色/阶段拆 Issue；角色变化不新建 Issue。
2. **OpenSpec `tasks.md` 是唯一工程任务分解**；Multica 只用 `task_refs` 投影分派，不建第二套任务模型。Development Sub-Issue 只在"需要独立运行状态（Owner/Status/Retry/Stage）"时创建——多任务、多工程师、多仓库、多 PR **都不构成创建理由**。
3. **四维解耦**：

   ```text
   TFS Type（公司管理事实）
   ≠ Technical Change Kind（corrective | intentional）
   ≠ Route（bug-fix | production-fix | sdd-fast）
   ≠ Schema（corrective-change | intentional-change）
   ```

   TFS Bug 和 Requirement+修复可以走同一条 corrective 路线。
4. **验证三层模型**：Task 级验证（每个实现任务必带）→ Change 级验证任务（仅组合行为才建）→ 独立验收（仅 Human 批准时）。Regression/Integration/E2E 是**方法**不是阶段，不绑定任何 Agent。
5. **PR 职责拆分**：PR Preparation（标题/描述等语义）= Engineer 工作；PR Materialization（调 API 建 PR）= 确定性副作用，不为建 PR 再唤醒 Engineer。
6. **人工审核是自然语言**：不搞关键词匹配或固定口令解析脚本，由 Delivery Lead 语义理解，但保留原始评论引用作追溯；`in_progress` 状态本身不能当批准证据。
7. **收口是有界幂等调用**：`finalize-delivery.ts` 每次重查当前事实、只补缺失副作用，不建状态机/事务框架；`pending_event/event_key` 保证部分失败后不丢恢复入口；明确禁止 `reset --hard`、禁止用 `--yes` 绕过归档检查。
8. **PR abandoned = 机器只报事实不猜原因**：置 `blocked` 等 Human 用 `Reason + NEXT`（ANALYSIS/ENGINEERING/RECREATE_PR/CANCEL_DELIVERY）决定，`route-human-decision.ts` 确定性路由；返工必须走**原 Runtime Projection** 单次触发，防双触发。

### 3.4 工程自律细节

- **Run Boundary Contract（§3.1.1）**：明确定义何时开新 Run、何时同 Run 完成；Multica Agent Run 与底层 CLI Session 不是一一对应。
- **循环保护（§9.9）**：verify 轮次 ≥3 且同类 blocker 重复 → `blocked` + 升级人工，禁止无限 Engineer↔Verify 循环。
- **证据失效规则（§9.7）**：候选 Commit Set 变化 → 旧 Verify PASS 默认失效；Contract 实质变化 → 即使代码没变也要重评证据。
- 全文反复出现的诚实标注：「本次文档更新未执行运行测试」「安装版本验收尚未完成」「CANCEL_DELIVERY 分支实施边界待明确」。

### 3.5 Gate 一览

| Gate | 触发点 | FAIL 处理 |
|---|---|---|
| Analysis Gate | 分析提交前 | Workitem Analyst 定向返工 |
| Development Completion Check | Engineer Task Set 完成时 | 当前 Task Set 定向返工 |
| Verification Gate（按需） | 独立验收后 | Engineer 定向返工 |
| PR Transition Gate | finalize 内部 | 等待 / 补齐条件 |
| Delivery Completion Gate | 关闭 Issue 前 | 不允许关闭 |

统一返回 `PASS | FAIL | UNKNOWN`；Agent 不允许覆盖明确的 `FAIL`；`UNKNOWN` 交 Delivery Lead / Human。

---

## 4. 整体评价与观察

### 4.1 最突出的特点

"防止 AI 系统腐化"的偏执贯穿始终：反复在每一处可能的缝隙上声明边界（谁不做什么、什么不等于什么、什么情况不许推断）。大量篇幅不是描述"做什么"，而是列举"不得这样做"——明显是踩坑后的沉淀。版本记录印证了多次收敛：

- Verify Agent：从"默认必经阶段"（v1.3.6 及以前）→ "Verification Policy 二选一"（v1.3.7）→ "按需独立验证执行者"（v1.4.16）；
- Delivery Lead：从"纯异常处理"到"完整规划 Owner"再到"轻量协调者"（v1.4.3 → v1.4.6 → v1.6.5）的摇摆收敛；
- 分析产物：从固定 Markdown 交付物收敛为"OpenSpec Change + Multica 交付事实 + 按需证据引用"（v1.4.14 → v1.4.15），取消独立的 AC-xxx / VR-xxx 身份体系。

### 4.2 当前状态 / 风险点

1. 文档 02 自述为 **Draft Baseline，未部署**；多处运行验收（安装版本并发/重试/回流恢复）标注为待执行。
2. `docs/` 中缺 03/04/05/06 四份被大量引用的下游方案——按此实施时这些是必要输入。
3. `CANCEL_DELIVERY` 分支明确未完成定义（§11.2 的实施边界待明确注记）。
4. 旧 `sdd` Schema 与 `sdd-standard` Route 存在但暂不自动推进，属于已知搁置项。
5. OpenSpec 实施基线锁定 `1.13.2`；Multica 已核对版本为 CLI/Daemon `0.6.1`（commit `2ea01ae4e`），但端到端并发/故障注入验收未完成。

---

## 5. 速查：一句话记住两个文档

> **01：每类资产只写自己该写的东西，每条规则只有一个 Owner，能确定的事不让 LLM 判断。**
>
> **02：一个 TFS 工作项一个 Delivery Issue，OpenSpec 管工程事实、Multica 管交付状态，人工在分析出口把关，其余环节能用脚本就不用 Agent、能同 Run 就不新开 Run。**
