# Multica 交付流水线实践指导手册

> 本文是 `01-multica-openspec-design-guideline-v1.16.3.md` 与 `02-multica-delivery-lifecycle-design-v1.6.6.md` 两份设计文档的**落地操作手册**，汇总了实施过程中对执行模型、并发规则、状态操作、写回边界等关键问题的全部结论。
>
> 配套文档：
> - `00-design-docs-interpretation.md` — 设计文档解读
> - `agent-skill-review-checklist.md` — Agent/Skill 评审校验清单
> - `flow-review-tfs-to-delivery-2026-10-12.md` — 流程评审与差距清单

---

## 1. 架构总纲：双事实源

| 事实源 | 记什么 | 类比 |
|---|---|---|
| **OpenSpec**（Engineering Truth） | 系统应该是什么样、为什么这么做：规格、提案、设计、任务 | 记"理" |
| **Multica Issue**（Delivery Truth） | 流程走到哪了、谁决定的、证据是什么：状态、审批、门禁结果、协调 | 记"事" |
| **Git 仓库** | 代码本身 | 记"货" |

四条铁律：

1. **Reference-not-Replication**：一处放内容，另一处只放指针（路径/URL），禁止全文复制；
2. **No Third Truth Store**：不引入第四个事实库；
3. **One Rule One Owner**：一条规则只有一个权威出处，其他文档引用而非复述；
4. **冲突即停止**：不建全局锁，撞车就停、上报、人工协调。

---

## 2. 执行模型：Issue / Run / Session

### 2.1 三个概念必须分开

| 概念 | 是什么 | 生命周期 |
|---|---|---|
| **Issue** | 交付事实对象：状态、负责人、metadata、评论 | 长期存在，全程载体 |
| **Run** | 一次 Agent 执行（某 Agent 在某 Issue 上被唤醒跑一轮） | 一次唤醒一次 |
| **Session** | 底层模型会话 + 本地工作目录上下文 | 实现细节，可被复用 |

**一个 Issue 上会跑很多个 Run**：

```text
Delivery Issue #1（父）上的 Run 序列：
  Run 1: Delivery Lead（todo 触发唤醒）→ 理解需求，@Analyst
  Run 2: Workitem Analyst → 分析，产出结论
  Run 3: Lead（分析完成事件唤醒）→ 推进 analysis_review
  Run 4: Lead（人工批准后）→ 派发开发
  Run 5: Lead（子任务完成信号）→ Development Completion Check
  Run 6: Lead → PR Materialization ...
```

### 2.2 Session 复用规则

**复用粒度 = 同一个 Agent 在同一个 Issue 上的前后 Run**，典型场景：

```text
Backend Engineer 在子 Issue #1-1 上：
  Run 1：建分支、改了一半代码、发现需求歧义 → 提问，Run 结束
         Session 进入 waiting_local_directory（工作目录保留：分支、未提交改动、对话上下文）
  Run 2（Lead 澄清后唤醒）：复用同一目录，从断点继续干活
```

| 场景 | 是否复用 | 原因 |
|---|---|---|
| 同 Agent + 同 Issue 的后续 Run | ✅ 复用 | 半成品现场要保留 |
| 不同 Agent（如 Verify Agent 进场） | ❌ 新 Session | 独立验证需要"干净的眼睛" |
| 同 Agent + 不同 Issue | ❌ 新 Session | 工作现场本就不该共享 |

**设计推论（写 Instructions/Run Intent 时）**：不要假设 Agent 记得"上一次对话"。跨 Agent 100% 不记得；同 Agent 跨 Run 复用只是优化不是契约——按"能从 Issue 恢复全部所需上下文"来写。

### 2.3 Issue 是唯一的公共白板

不同 Agent 是不同 Session，互相看不到对方对话。接力完全靠 Issue：

```text
每个 Agent 的工作循环：
  醒来 → 读 Issue（正文/评论/metadata/仓库文件）→ 干活 → 写回 Issue → 睡下
```

**规则：跨 Agent 的信息必须物化到 Issue（评论/正文/metadata/仓库文件），不允许只存在于某个 Session 的对话里。** Session 随时会死，Issue 永存——这是可审计、可恢复的基础。

---

## 3. 并发模型

### 3.1 唯一的串行规则（01 §2.4，已对 0.6.1 源码核验）

```text
串行约束只存在于：同一个 Issue + 同一个 Agent 的多次执行（领取时串行）
不同 Issue 之间：互不阻塞
不同 Agent 之间：互不阻塞
```

### 3.2 多个父 Issue 在 todo：天然并发，无需排队

N 个父 Issue 同时在 `todo` → N 个独立的 Delivery Lead Run 并行推进。真正的瓶颈不在 Multica：

| 实际限制 | 说明 | 对策 |
|---|---|---|
| **模型配额** | LLM API 的 RPM / TPM / 并发连接 / 余额上限；撞限表现为 Run 报 429 中途失败，**不是自动排队** | 按账号额度反推并行数；额度不明先 2~3 个并行跑一整轮观察 |
| **本机 Daemon/Runtime 资源** | Run 在本机执行，占 CPU/内存/工作目录 | 普通开发机建议同时 2~3 个 Issue |
| **共享资源业务冲突** | 同仓库分支冲突、归档撞主规格 | 冲突即停止 + 人工协调，不建锁 |

**节流手段**：`backlog` 就是天然队列（停放不启动）；`tfs-sync` 的 `max_items_per_run` 控制入库速度；人工控制 `todo` 数量。三层足够。

**L4 实测修正（2026-10-13，CLI 0.6.1，详见 `l4-concurrency-load-test-plan.md`）**：

- **每 Agent `max_concurrent_tasks`（默认 6）实测生效**：超出排队、完成即无缝递补（1~8s）；各 Agent 配额独立互不占；
- **单 daemon 未见全局总闸**：实测 14 个 Run（跨 3 Agent）真并发、0 失败、0 429；
- **另一瓶颈是 daemon 串行 spawn**：~5-10s 拉起一个 Run（全 Agent 共享），大批量同时触发时呈阶梯启动；
- 机器负载温和：14 并发 Run ≈ 22 个 claude/node 进程 / 4.94GB；
- **容量估算**：Lead 评估 Run 放大系数 ≈ 每 Issue 每轮评论 2 个 Lead Run，规划按 `总 Run ≈ Engineer Run × 3`。

### 3.2.1 派发评论的路径纪律（L4 实测教训，红线）

Run 的 workdir 是临时目录，挂载的 `local_directory` 以**绝对路径指针**写在 workdir `CLAUDE.md` 资源段。实测：派发评论只写相对路径（如 `repos/df-dataintegration`）时，Agent 定位成功率仅 50%——失败表现为在临时 workdir 里 `git init`（产物随 Run 销毁）或**写进挂载点外的真实源仓**。

**派发/触发评论必须**：

1. 给出目标仓的**绝对路径**（与 Project 资源挂载路径一致）；
2. 显式声明"仓已存在，**禁止 git init**、禁止操作其他任何路径"；
3. 要求先 `git rev-parse` 确认再动手。

绝对路径修正后实测 10/10 落仓正确。

**例外：Skill 内部引用不走绝对路径**（2026-10-14 实测）。平台会把 Agent 绑定 Skill 的 files 物化进 Run workdir 的 `.claude/skills/<skill-name>/`（目录结构保留），因此 SKILL.md 引用自身 `scripts/`、`config/` 一律用**相对路径**（与仓内资产逐字一致，可直接 diff 核对）；只有引用 Skill 之外的仓外工具（如 tfs-cli）才用绝对路径，且该路径属于环境配置值、应落在 config 文件而非 SKILL.md 文本。改动 Skill 脚本/配置后必须重新 `multica skill files upsert`（平台侧不自动同步仓内）。

> 一次完整交付的模型消耗 ≈ Lead 多轮 Run + Analyst Run + N 个 Engineer Run + 可选 Verify Run ≈ 几十到上百次调用、几十万 token。3 个 Issue 并行 ≈ 3 倍瞬时流量。

### 3.3 派发形态：父 Issue Runtime 为默认，子 Issue 是例外（02 §7）

**默认形态**：Parent Delivery Issue + `@Engineer` + `task_refs`——包括并行开发在内，绝大多数交付全程零子 Issue：

```text
Lead 在父 Issue 内同时放单（02 §7 原生支持 @评论并行）：
  ├─ @Backend Engineer + task_refs     ┐
  ├─ @Frontend Engineer + task_refs    ├─ 无阻塞依赖时可以并行
  └─ @Flink Engineer + task_refs       ┘

  串行规则仍只管"同 Issue+同 Agent"：不同 Engineer 并行无碍；
  限制是同一 Agent 在父 Issue 上同时只有一个 Run（同角色多任务串行）。
```

**例外形态**：Development Sub-Issue，仅当 Task Set 需要**独立的 persistent runtime state**（02 §7.2 唯一判定标准）：

```text
独立 Owner / 独立 Status / 独立 Block / 独立 Retry / 独立 Completion / 独立 Stage 回流
```

**明确不构成创建理由的**（02 §55 / §584 明文否决）：任务数量多、多 Engineer、多 Repository、多 PR、前后端并行。典型正当理由：Task Set 工期长需独立跟踪阻塞/重试/完成；需长期由一位 Specialist 独立 Own（Specialist-owned）；Task Set 本身需持续多角色协调（Squad-owned，Lead 进入其中协调）。

**@评论并发的适用边界**：适合异角色并行开发与轻量协作；代价是任务级状态粒度由父 Issue 评论承载（独立阻塞、独立负责人、独立完成证据都做不到）——需要这些时，那就是"需要独立 persistent runtime state"，按标准建子 Issue。

**子 Issue 存在时的协调**：子 Issue 之间无横向交接（不互相 @、不读对方 Session），一切协调走父 Issue 的 Lead（hub-spoke）；依赖用契约前置（写进双方 Issue 正文）或 Lead 顺序放单解决；子 Agent 卡住 → 自己 Issue 标 `blocked` + 写清原因 → 唤醒 Lead 协调。

### 3.4 并发判定与决策分工

**触发机制**：并发不是自动的，是 Lead 放单方式决定的——父 Issue 内同时 @多个成员，或同时启动多个子 Issue，即并发；捂着分批放即串行。

**放单前判定清单（同时满足才并发，无论哪种形态）**：

| 条件 | 反例（→ 串行） |
|---|---|
| 无数据/接口依赖 | 前端要等后端接口真实可用 |
| 契约可先固化 | 接口形状要边做边摸索 |
| 代码物理隔离（不同仓库/模块/文件） | 都改同一个文件 |
| OpenSpec 写入面不重叠 | 都改同一 spec 的同一节 |
| 验证互不依赖 | 端到端验证必须两者都完成 |

一票否决：**改同一文件/同一 spec 节的，不并发**。

**决策分工**：Analyst 给出任务边界与依赖分析（Sub-Issue 分工与 Stage 安排不作为 Analysis 必交输入，02 §990）→ 人工在 `analysis_review` 批准范围 → Lead 负责成员选择、Sub-Issue 判定与放单时机。Lead 不发明并行策略，只按"独立运行状态需要"判定是否物化子 Issue。

### 3.5 并发写隔离：根仓临界区串行 + 业务仓 worktree（设计决策，2026-10-14 定稿；路径契约 2026-10-22 更新）

**背景**：Run 的 workdir 是每 Run 一次性空目录（仅 `.claude/`、`.multica/`、`CLAUDE.md`），平台 `in_place` 模式不把挂载仓复制/链接进去；平台级 `execution_mode: worktree` 只对挂载点仓（根仓）生效，且业务子仓与 `.worktrees/` 在根仓 `.gitignore` 中，嵌套业务仓吃不到。因此并发写隔离只能在应用层做，策略按仓的**收敛机制**分流：

| | 根仓（OpenSpec monorepo） | 业务仓（根仓直接子仓） |
|---|---|---|
| 收敛机制 | 直推 master，无 PR（02 §12.4） | 特性分支 + PR 合并（02 §10） |
| 事实可见性 | 各角色跨 Run 实时共读 `openspec/changes/` 当前状态 → **必须单工作树** | Issue 内自治 → 可拆 |
| 并行隔离手段 | 按 Issue 分目录（`openspec/changes/<change_ref>/`）+ commit 临界区串行化（脚本内 flock，或 push 失败 `pull --rebase` 重试兜底） | **应用层自建 worktree**：派发时 `git worktree add .worktrees/<issue>-<repo_id> -b feat/<tfs-id> origin/<目标分支>`，收口时 `worktree remove` |
| 冲突暴露点 | commit/push 瞬间（秒级，重试排队） | PR 合并时（Lead 协调返工，标准 git 协作模型） |

**要点**：

0. **目录结构约定**：仓库身份与路径以 `<root_repo>/docs/config/repo-context.yaml` 为准，Facts 的 `repo_key` 值等于 `repo_id`。嵌套克隆保留为常驻**枢纽**（`<root_repo>/<repo_path>/`，只 fetch/push、寄存 worktree 管理数据、工作树长期干净，不在里面开发）；worktree 放 `<root_repo>/.worktrees/<issue>-<repo_id>/`（`.gitignore` 内），随 Issue 创建、随 finalize 回收。**克隆与 worktree 都在根仓挂载点内**——平台每 daemon 每项目仅允许一个 `local_directory`，根仓是唯一路径锚点；in_place 模式下 Agent 物理上可写挂载点外路径（L4 sat-4 越界实例），纪律上禁止：
   ```text
   <root_repo>/
   ├─ openspec/ ...                     ← 根仓本体，直推 master，不用 worktree
   ├─ docs/config/repo-context.yaml     ← repo_id / repo_path 唯一映射源
   ├─ <repo_path>/                      ← 常驻直接子仓 = fetch 枢纽（不开发）
   ├─ .worktrees/<issue>-<repo_id>/     ← 每 Issue×仓 工作树（checkout feat/<tfs-id>）
   └─ .multica/locks/root-finalize.lock ← 根仓 finalize 临界区
   ```
1. 业务仓 worktree 的创建/回收是**确定性脚本职责**（挂在 `development-execution` / `pull-request` 脚本内，孤儿 worktree 定期清理），不靠 Agent 自觉；
2. git 禁止同一分支被两个 worktree 同时 checkout——**解法单元是"worktree + 每 Issue 特性分支"，不是共享分支**；直推共享分支的场景（根仓 Archive Commit）worktree 无解，只能短临界区串行；
3. worktree 只解决工作区/`.git` 互斥；改同一文件同一段的语义冲突谁也无解，只是在 PR 合并点暴露；
4. 落地状态：worktree 生命周期脚本（`pull-request` Skill 的 `worktree.ts`）已落地验收（2026-10-14，P1 通过）；业务仓研发开工一律走 worktree，in_place 共享模式废止。

---

## 4. 状态机与操作

### 4.1 状态映射表（机器逻辑只用 Key，不用显示名）

| 状态 Key | 中文显示名 | 类别 | 含义 |
|---|---|---|---|
| `backlog` | 待规划 | unstarted | 停放：同步入库后等待人工启动，**不触发任何 Run** |
| `todo` | 待办 | unstarted | **启动信号**：进入即触发 Squad Leader |
| `in_progress` | 进行中 | started | 研发执行中 |
| `analysis_review` | 分析审核 | started（**自定义**） | 分析完成，等人工审批，未动工 |
| `in_review` | 审核中 | started | PR 已建，等 TFS 侧评审合并 |
| `blocked` | 已阻塞 | started | 卡住，原因须写在 Issue 上 |
| `done` | 已完成 | completed | 交付闭环 |
| `cancelled` | 已取消 | cancelled | 废弃 |

### 4.2 两个"审核"的顺序与区别

```text
backlog → todo → in_progress → 【分析审核】 → in_progress → 【审核中】 → done
                              审"分析结论"                审"代码PR"
```

| | 分析审核 `analysis_review`（前） | 审核中 `in_review`（后） |
|---|---|---|
| 时机 | Analyst 产出结论后、**动工前** | 代码完成、PR 创建后、**合并前** |
| 审什么 | 需求理解、路由/Schema、任务拆分 | 代码质量、PR 合规 |
| 谁来审 | 人（硬门禁） | TFS 评审流程（人）+ PR Status Sync 回写 |
| 卡住代价 | 未写代码，代价小 | 代码已写完，返工代价大 |

设计意图：把"理解错需求"这种最贵的错误挡在动工之前。

### 4.3 关键操作

**创建自定义状态**（CLI 不支持，须 Web UI）：Workspace Settings → Issue Statuses，Key=`analysis_review`，显示名=`分析审核`，Category=`started`。看板列顺序建议：`待规划 → 待办 → 进行中 → 分析审核 → 审核中 → 已完成`。

**backlog → todo（全流程唯一的人工启动动作）**：
- Web UI 拖拽到"待办"列，或
- `multica issue status <issue-id> todo`（**不要加 `--no-start`**——加了这个请求级抑制标记就不会唤醒 Squad）。

同步/脚本写入一律带 `--no-start`；人工启动一律不带。

---

## 5. 写回边界：Issue vs OpenSpec

总规则：**过程事实写 Issue，工程内容落 OpenSpec，代码进 Git。一条信息只有一个家。**

### 5.1 按阶段的落盘清单

| 阶段 | 写回 Issue | 落 OpenSpec |
|---|---|---|
| ① TFS Sync | 正文（TFS 原文）、metadata（`tfs.id`/`tfs.type`/`tfs.url`/`tfs.changed_at`）、status=backlog | 不落 |
| ② 分析 | 结论**摘要**（评论）、决策 metadata（route/schema/change-id）、status→analysis_review、change 目录**指针** | `proposal.md` / `design.md` / `tasks.md` / spec deltas（全文在这） |
| ③ 审批 | 批准/打回决定与理由、批准人、时间、status | 打回时的文档修订 |
| ④ 派发 | 派发评论（@Engineer + `task_refs`，默认形态）；按需才建子 Issue（正文=任务说明+契约、父子关联） | `tasks.md` 任务与派发对象的对应关系 |
| ⑤ 开发 | 进展节点、阻塞及原因、完成回报+证据链接、status | `tasks.md` 勾选、spec delta 随偏差同步修订 |
| ⑥ 门禁 | **结构化门禁结果评论**：PASS/FAIL/UNKNOWN + 证据链接（每次一份） | 门禁发现缺漏时补齐文档 |
| ⑦ PR | PR URL（metadata）、status→in_review、合并确认 | 无新增 |
| ⑧ 闭环 | status→done、交付小结+PR链接+归档指针、幂等记录（`pending_event`/`event_key`） | **archive**：change 归档进主规格 |

### 5.2 三问自检

```text
这条信息是"流程走到哪了/谁决定的/证据是什么"？  → Issue
这条信息是"系统应该是什么样/为什么这么做"？      → OpenSpec
两处都需要？                                     → 内容放一家，另一家只放指针
```

### 5.3 最常见错误（评审重点抓）

1. 把 proposal/design 全文贴进 Issue 评论 → 双份漂移；
2. 门禁结论只留在 Run 对话没落 Issue → 审计断链；
3. 分析结论只落 Issue 不落 OpenSpec → 系统真相丢失历史设计依据；
4. 归档延迟或跳过 → 主规格失真，Engineering Truth 崩塌。

---

## 6. Agent 与 Skill 划分标准

### 6.1 四个判定测试

| 测试 | Agent | Skill |
|---|---|---|
| 是否有**角色立场**（对什么结果负责） | ✅ | ❌ |
| 是否做**业务判断**（路由选择、拆分决策） | ✅ | ❌（只承载确定性逻辑） |
| 是否被**唤醒/指派**（Run 的主体） | ✅ | ❌（被 Agent 调用） |
| 是否可**跨角色复用**（如 pull-request 谁都可能用） | ❌ | ✅ |

### 6.2 写法标准

**Agent** = Description（一句话，仅 UI 展示）+ Instructions（五段式 Role Contract）：

```text
# Role                    一句话身份
# Core Responsibilities   职责清单
# Boundaries              不做什么（Boundary-first，最重要的一段）
# Execution Principles    执行原则
# Escalation, Communication & Delivery   升级、沟通与交付物
```

**Skill** = Reusable Execution Contract，`SKILL.md` 最小化（When/Input/How/Validation/Output/Failure），确定性逻辑下沉到 `skill-flow` CLI 子命令（历史：仓内 `scripts/`，已收编），渐进式披露（description → SKILL.md → config/references/templates）。

**薄适配器模式**：TFS Sync Agent、PR Status Sync Agent 不做业务判断，全部确定性逻辑在 skill-flow 子命令，Agent 只负责触发、读结构化结果、如实汇总。

**脚本基线（2026-10-23 起修订）**：确定性脚本已统一收编为机器安装的 `skill-flow` CLI（`@winning/skill-flow`，`tools/skill-flow/`，安装与升级见文末"skill-flow 安装与升级"节），调用形态 `skill-flow <group> <command>`。基线行为不变：退出码 `0` 成功 / `2` 单项失败 / `3` UNKNOWN / `64` 用法错误；stdout 只输出结构化 JSON，日志走 stderr；身份或环境不可确认时整体停止（UNKNOWN）而非猜测。（历史约定：2026-10-12 定稿的"TS 单文件零构建 `node scripts/xxx.ts` 直跑"已被 skill-flow 收编 supersede。）

### 6.3 角色全景

| 角色 | 类型 | 职责边界 |
|---|---|---|
| `TFS Sync Agent` | Autopilot 薄适配器（Squad 外） | 定时同步 TFS → backlog Issue，不启动研发 |
| `Delivery Squad` / `Delivery Lead` | Squad Leader | 阶段边界推进、派单、异常协调、闭环 |
| `Workitem Analyst` | Squad 成员 | 需求分析、路由/Schema 建议、任务拆分 |
| `Backend/Frontend/Flink Engineer` | Squad 成员 | 按子 Issue 开发，回报证据 |
| `Verify Agent` | Squad 成员（按需） | 独立验证（三层验证的第三层） |
| `PR Status Sync Agent` | Autopilot 薄适配器（Squad 外） | TFS PR 状态回写 Issue |

评审合规性对照 `agent-skill-review-checklist.md`（红线 R1–R8 + 清单 D/I/S/X 系列）。

---

## 7. 全流程一览（含门禁与人工点）

```text
TFS ──TFS Sync Agent(Autopilot)──▶ backlog Issue
                                     │ 人工拖到 todo ★唯一启动点
                                     ▼
                    Delivery Lead 唤醒 → @Workitem Analyst
                                     │ 分析 + OpenSpec change
                                     ▼
                 Analysis Gate ──▶ analysis_review
                                     │ 人工审批 ★最重要闸门
                                     ▼
                    Lead 派发（默认父 Issue 内 @Engineer + task_refs，可按需物化子 Issue）
                                     │
                                     ▼
                 Development Completion Check ──▶ (可选) Verify Agent
                                     │
                                     ▼
                 PR Materialization ──▶ in_review
                                     │ TFS 评审合并 ★人工
                                     ▼
                 PR Status Sync 回写 ──▶ finalize（幂等：pending_event/event_key）
                                     │ 归档 OpenSpec + status=done
                                     ▼
                                   done
```

人工门禁四处：**todo 启动、analysis_review 审批、TFS PR 合并、废弃决策**。其余环节自动化，但所有门禁只返回 PASS/FAIL/UNKNOWN，UNKNOWN 不得当作放行。

---

## 8. 当前实施状态

> 更新至 2026-10-20。验证进度细节见 `pipeline-validation-plan.md`（L0/L1/L2 已全过）。

### 已完成

- [x] `agents/delivery-lead/`（description / instructions / README + skill 绑定清单）
- [x] `squads/delivery-squad/squad-instructions.md`
- [x] `agents/tfs-sync-agent/` + `workspace-skills/tfs-sync/`（SKILL.md / reconcile-workitem.ts / sync-config.json / metadata-contract.md）
- [x] 状态映射表定稿；`analysis_review` 已在北落师门 UI 创建并经 CLI 核验（Key=`analysis_review`）
- [x] 角色注册（北落师门）：Delivery Lead `0304a20b-…`、Workitem Analyst `3f0cf369-…`、Backend Engineer `59a97d2d-…`、Frontend Engineer `51440aa8-…`；Delivery Squad `093cf20a-…`（Instructions 已注入，四成员入队）
- [x] Skill 第一批（分析链）：`workitem-analysis`、`analysis-completion`（+complete-analysis.ts）、`delivery-gate`（+validate-analysis.ts，Analysis Gate）——已注册并绑定（Analyst 三个全绑，Lead 绑 delivery-gate）
- [x] Skill 第二批（研发链）：`development-execution` `28da55b0-…`（+check-development-completion.ts 确定性 Completion Check + Evidence 契约）——已注册并绑定 Backend/Frontend Engineer
- [x] CLI flag 已对照 0.6.1 核验：metadata 走 `issue metadata set`，`--output json`，create 无 `--no-start`（backlog 停放语义由平台承担）；Windows 子进程须 where.exe 解析 + CRT 引用（L1 实测修复）
- [x] 交付 Project「WN Platform 交付」`c1255c2d-…` 已建，OpenSpec 根仓 `D:\WN_Platform\works\gitee_repos\multica_spec` 以 local_directory/in_place 挂载本机 Runtime；`sync-config.json` 已填真实 workspace/project ID
- [x] 业务仓接入（2026-10-13）：4 个 DF 业务仓以 **agent 专用克隆**聚合在根仓 `repos/` 子目录（根仓 `.gitignore` 忽略，克隆 origin 直连 TFS，连通性已验证）——`repos/df-metadata-web`、`repos/df-dataasset-web`、`repos/df-dataintegration-web`（前端）、`repos/df-dataintegration`（后端）。**平台限制实录**：每 daemon 每 Project 仅允许一个 `local_directory`（`Request conflict` 实测），故采用"根仓内嵌套克隆"单挂载点方案
- [x] **并发实测（2026-10-13，FOMA-6/7 探针，CLI 0.6.1 本机 daemon）**：与官方文档"in_place 同目录 Run 串行"的表述**相反**——两个 Backend Engineer Run（不同 Issue、同一挂载点、**同一嵌套仓**真实 git 写）同时启动、全程并行（09:03:22 同秒起跑），无一进入 `waiting_local_directory`；两笔 commit 由 git 自身串行落定、无冲突。**结论修正**：当前安装版本下并发不受目录锁限制，瓶颈只在 daemon `max-concurrent-tasks`（默认 6）；官方文档描述的互斥行为或为其他版本/场景。L4 验收以本实测口径为准，不再预设串行
- [x] 分级验证 L0/L1/L2 全过（FOMA-5 全链路：todo → 分析 → analysis_review → 人工批准 → 派发 → 研发 → in_review → 人工验收 → done，7 次 Run 行为全部符合设计）

### 剩余能力缺口（按依赖排序）

1. ~~**专业 engineering Skill**~~ ✅ **已实施并验收（2026-10-15）**：`backend-engineering`（`bd5c50a5-…`）/ `frontend-engineering`（`27b3c58e-…`）已注册绑定，各带 references×3（feedback-signals / local-validation 实测命令映射 / review-standards）；`development-execution` 补齐 methods×5（tdd / codebase-design / code-review / verification-before-completion / bounded-diagnosis）+ Method Dispatch 段；04 已吸收 §3.5 并 bump v1.15.4；E1–E6 全过（详见 `docs/domain-engineering-skills-plan.md` §7，含 mention 路由实测：无 Owner 的 Issue 上 `@Agent` 不路由、Squad-owned Issue 上正常唤醒）；
2. **`pull-request` capability**（02 §10.1 PR Materialization 确定性脚本）——**已实施并验收（2026-10-14）**：资产在 `workspace-skills/pull-request/`（materialize-pr.ts + worktree.ts + repo-registry.json + pr-facts 契约），P1–P6 全过（详见 `docs/pull-request-capability-plan.md` §7）；`development-execution` Ground/PR Preparation 两环节已挂钩；平台已注册并绑定 Delivery Lead + Backend/Frontend Engineer（注册记录见 `agents/delivery-lead/README.md`）；
3. **`finalize-delivery`**（OpenSpec Archive + 根仓 Commit + TFS 回写 + Delivery Issue 关闭，02 Run 6）——**已实施并验收（2026-10-15）**：资产在 `workspace-skills/finalize-delivery/`（finalize-delivery.ts + repo-registry.json + finalize-facts 契约），F0–F9 全过（详见 `docs/finalize-delivery-plan.md` §7，含 porcelain 首行解析与门禁先于 pending 两处实施偏差记录）；新增 metadata 契约 `analysis.human_approval`（Lead 派发时写）/ `finalize.pending` / `delivery.summary_comment_id` / `delivery.tfs_written`；平台已注册并绑定 Delivery Lead；
4. **Verify Agent + `acceptance-verification` Skill**——`verify_agent.required=true` 路线目前断链（L2 走的是 not_required）；
5. ~~**`delivery-flow` 其余脚本**~~ ✅ **已实施并验收（2026-10-15）**：Skill `delivery-flow`（`8f2861fd-…`）已注册并绑定 Delivery Lead——materialize-development.ts（派发校验 + Sub-Issue 物化 + `dev.dispatch` 事实）+ route-human-decision.ts（PR abandoned 后 NEXT 四路由 + `dev.decision` 幂等），DF-1~DF-10 全过（详见 `docs/delivery-flow-plan.md` §6，含 projection 值规范化 / NOOP 检查顺序两条实施偏差）；**范围裁定**：route-verify-result / validate-verification 并入缺口④（输入契约同源）；evaluate-pr-transition / evaluate-completion 已由 finalize-delivery 内部承载不另建；task-close 在 02 无定义，退回文档缺口；**TFS Task 补做（2026-10-19）**：新增 `materialize-tfs-tasks.ts` 与 tfs-cli `workitem create`，TF-1～TF-9 全过（详见 `docs/tfs-task-materialization-plan.md` §6），平台 SKILL / 脚本 / facts 契约已同步；**Commit ↔ 任务关联（2026-10-19）**：Commit Message `Refs: #任务ID` 尾注行规范 + Completion Check 新增 `commit_task_links` 检查（`--issue` + `--registry-config` 启用），CL-0 机制实证（跨项目自动关联成立，异步延迟 3~5 分钟）与 CL-1～CL-10 验收全过（详见 `docs/tfs-task-commit-linkage-plan.md`），development-execution 平台已同步；**TFS 状态回写 + 预估工时 + 标题简化（2026-10-20）**：`docs/tfs-state-writeback-plan.md` 已实施，SW-1～SW-11 全过——① complete-analysis 需求→已分析（`--registry-config` 取 tfs_cli，`tfs_state` 三段输出）；② materialize-tfs-tasks 任务→活动（先事实后状态，状态段失败 exit 3 重跑自愈；实证 `已解决→活动` 跳态允许）+ 前置 `[预估: Nh]` 尾注校验（缺注 exit 2）+ 标题剥离尾注/80 字符截断/描述含完整行文本与预估行 + tfs-cli `workitem create --estimate` 写 OriginalEstimate/RemainingWork（本实例字段可用）；③ 新增 resolve-tfs-tasks.ts（Lead 汇总点任务→已解决，前置缺映射 exit 2，回读核对，不写防重标记）+ **已解决工时落库（2026-10-20 裁定）**：`set-state --complete-with-estimate` 同一 PATCH 确定性落库 CompletedWork=OriginalEstimate、RemainingWork=0（已是目标态仍核对补齐，工时漂移重跑自愈；OE 缺失只写 RW=0 并列 `estimate_missing` 如实回流），resolve 回读核对扩展三工时字段（query 输出同步扩展）；④ Analysis Gate 新增 `task_estimates` 检查（尾注必填 0<N≤6h）；⑤ finalize-delivery 归档 push 修复（硬编码 master 曾在 dev 检出下静默假成功——根仓 dev ahead origin/dev 4 实证；改为 `symbolic-ref` 探测当前分支，SW-8 代码级实证，全链待下次真实 finalize 回填）；analysis-completion / delivery-flow / delivery-gate / workitem-analysis / finalize-delivery 平台已同步；**Skill 资产工作区无关化（2026-10-20）**：`docs/workspace-skill-portability-plan.md` 已实施，MG-1～MG-6 全过——配置三层拆分（`_shared/` base+overlay），工作区特异性只在 `scripts/sync-workspace.ts` 同步平台时注入（渲染 + upsert + reconcile 删除 + content_hash 回读校验一体）；5 份 config 转渲染产物并 gitignore，四副本同形机器保证；迁移演练在工作区 `1020_test` 完成（Skill×11 / Agent×6 / Squad×1 / Autopilot×2 全量注册，绑定与北落师门逐一核对一致）；
6. ~~**PR Status Sync Agent**~~ ✅ **已实施并验收（2026-10-15）**：资产在 `workspace-skills/pr-status-sync/`（reconcile-pr-status.ts + repo-registry 第三份副本）与 `agents/pr-status-sync-agent/`；S1–S7 全过（详见 `docs/pr-status-sync-plan.md` §6，含 TFS 全局故障探测/pending 破损标注/delivery_squad_id 配置项三条实施偏差）；平台已注册（Agent `619b9fec-…` + Autopilot `a040f26f-…` cron */15min），新增事实契约 `pr.abandoned`；
7. **设计文档 03–06**：04（研发设计 v1.15.4）/ 05（OpenSpec schema 实施 v1.5.3）已存在（尚未入库，已按 versioned 命名对齐为 `04-engineer-development-design-v1.15.4.md` / `05-openspec-schema-implementation-design-v1.5.3.md`，01/02/04/05 互链已修复）；其 schema/模板/任务进度交付物已按 `docs/openspec-schema-landing-plan.md` v2（2026-10-23 定稿，单仓版）**落地并验收（2026-10-23，O1–O9 全过）**——schemas 核验收尾 + S1–S3 补强（apply 指向进度脚本 / tasks 派工约束 / corrective checkbox 解析规则）+ `projects/multica/scripts/resolve-change-identity.ts` 与 `update-task-progress.ts` 落地（05 §5.2/§5.3/§11，含 CONFLICT/BUSY/stale 接管实测）；04 吸收 §3.5 由 `docs/domain-engineering-skills-plan.md` §5 承载。**剩余缺口⑦ = 03（Analysis 设计）新建 + 06（Method/Skill 库）新建 + CANCEL_DELIVERY 定义归属**（02 对 03 的引用仍悬挂）；
8. ~~L3 验证~~ ✅ 已完成（2026-10-14）：`services/tfs-cli/` 落地并验收（C0–C6，`docs/tfs-cli-plan.md` §7），`sync-config.json` 的 `tfs.query_command` 已接真实 CLI（**注意本 TFS 实例中文本地化**：类型 `需求/Bug`、状态 `活动` 等，WIQL 必须用本地化名称），L3-1/2/3（创建/幂等/管理字段更新）通过。**L3 剩余项**：同步入口已按用户决策收敛为 `State='活动' AND AssignedTo=@me`（2026-10-14，@me=PAT 属主 lintao；全量活动态 93 条含大量现场支持/文档类，不宜直接进流水线，后续按实际情况调整 WIQL）；
9. ~~L4 验证~~ ✅ 已完成（2026-10-13，阶段 1/2 通过）：并发模型、绝对路径派发纪律、容量系数均已实测回填（§3.2 / §3.2.1 / `l4-concurrency-load-test-plan.md`）。**仅余可选项**：阶段 3 长任务（10min+ 真实交付型 Run）并发稳定性与共享 `tasks.md` 写冲突验证，放量前建议补做。

---

*生成日期：2026-10-12。本文是操作手册，设计权威以 01/02 原文为准；若冲突，以原文为准并修订本文。*

---

## skill-flow 安装与升级（2026-10-23 起）

workspace-skills 的 21 个确定性脚本已收编为 npm 包 `@winning/skill-flow`（仓内 `tools/skill-flow/`，
方案 `skill-flow-cli-plan.md`），调用形态从 `node <skill-dir>/scripts/xxx.ts` 变为 `skill-flow <group> <command>`。

### 安装（dev 机 / daemon 主机通用，与 tfs-cli 同一流程）

```bash
cd tools/skill-flow
npm pack                                  # prepack 自动 build，产出 winning-skill-flow-<version>.tgz
npm install -g winning-skill-flow-*.tgz   # 全局安装
```

执行环境只需普通 Node LTS（运行 tsc 产物，无 type-stripping 版本约束）。

### 升级纪律

- skill-flow 有提交 → 相关机器重跑 `npm pack && npm install -g winning-skill-flow-*.tgz`（先 bump version 便于追溯）。
- 版本核对：`skill-flow --version`；Gate 类命令（`analysis validate` / `dev check-completion`）
  输出固定携带 `tool_version` 字段，交付问题可追溯工具版本。
- daemon 主机巡检：`skill-flow workspace check-daemon` 含 `skill_flow` 检查项（报告当前版本）。
- registry 的 `runtime.skill_flow` 默认 `"skill-flow"`（PATH 解析）；非标准安装时配置绝对路径。

### 迁移窗口期

SKILL.md 与 agent 资产已全部切换（2026-10-23），仓内原脚本已移除，平台（beiluoshimen）已对账收敛；
测试工作区（1020/1021/1022/1023_test）未对账，如重新启用须先跑一次 `skill-flow workspace sync`。
