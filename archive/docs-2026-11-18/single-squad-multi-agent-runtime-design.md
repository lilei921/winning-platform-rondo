# Multica 单 Squad · 多 Agent 实例 · 多 Runtime 设计方案

> Version: 0.3.0  
> Date: 2026-10-14  
> Status: Architecture Selected / Selector Design Pending PoC（组织模型已选定；Selector、正式 Runtime / Git / OpenSpec 交接尚未实施验收）  
> Scope: 单 Workspace / Project / Delivery Squad 中，为 Workitem Analyst、Backend Engineer、Frontend Engineer 按需配置同职责多 Agent 实例，分别绑定可用 Runtime；Delivery Lead 负责语义角色 / Task Set，确定性 Selector 负责实例选择，Lead 使用 Multica 原生机制派工。  
> Authority: 01–07 仍是正式工程契约与生命周期的权威来源；本文是并发部署专项设计，不新增交付状态机或改变现网配置。

## 1. 结论与设计边界

**选择一个 Delivery Squad + 一个 Delivery Lead（语义编排）+ 无状态确定性 Agent Selector（实例选择）+ 同职责多 Agent 实例 + Agent 级 Runtime 绑定。**

- Workitem Analyst、Backend Engineer、Frontend Engineer 均可按需求横向增加 `-01`、`-02` 等独立 Agent；Flink Engineer、Verify Agent 暂按实际容量配置，初期可共享一实例。
- 同职责实例复用同一专业 Role Contract、Project Skills 和工程流程，只按实例配置 Runtime、环境能力与必要权限。
- Delivery Lead 负责判断所需专业角色、已批准 Task Set 和技术依赖；**确定性 `agent-selector`** 依据现有 Owner、Roster、能力及 Runtime 事实返回具体 Agent ID；Delivery Lead 据此使用精确 `@mention` 派工。
- Selector 是当前 Lead Run 内调用的**只读工具 / 脚本（拟实施）**，不是新增 Agent / Run / Scheduler；继续复用 Multica 原生 Run / Queue / Assignment，不增加专业 Squad、子级 Leader、Coordinator、`WAIT` Status 或额外容量状态表。
- 多个 Issue 可同时处于 Analysis、Human Review、Development 等不同生命周期；**Agent 并发、Run 并发、工作目录并发和 Git 变更隔离是四个不同问题**。
- 不修改 TFS Sync → Wayfinder → Delivery Squad → Analysis Gate / Human Review → Development → Verify（按需）→ PR / Finalize 的既有闭环。
- 保留 OpenSpec `<semantic-slug>-<tfs-id>`、`task_refs`、同一 Delivery / Repository 唯一有效 Engineer、按业务 Repository 分别提交 PR 的契约。

本文件中的 Analyst Pool、Backend Pool、Frontend Pool 是 **Roster 中相同职责成员的逻辑分组**，不是 Multica 新建的 Pool / Team 对象，也不要求 Nested Squad。

## 2. 目标拓扑

```text
Multica Workspace / Project：Winning Platform
  └─ Delivery Squad（唯一）
       └─ Delivery Lead（唯一；决定 Role / Task Set / Dependencies）
            ├─ agent-selector（只读脚本；选择具体 Agent，不是 Squad 成员）
            ├─ Analyst Pool（逻辑）
            │    ├─ Workitem Analyst-01 ── Runtime-A
            │    └─ Workitem Analyst-02 ── Runtime-B
            ├─ Backend Pool（逻辑）
            │    ├─ Backend Engineer-01 ── Runtime-A
            │    └─ Backend Engineer-02 ── Runtime-B
            ├─ Frontend Pool（逻辑）
            │    ├─ Frontend Engineer-01 ── Runtime-A
            │    └─ Frontend Engineer-02 ── Runtime-B
            ├─ Flink Engineer-01（按需扩展）
            └─ Verify Agent-01（按需；是否启用由 Human 决定）

Squad 外：TFS Sync Agent、Wayfinder Agent、PR Status Sync Agent（原职责不变）
```

上述 Runtime-A / B 仅是示意：可以位于不同机器，也可以共用 Daemon。**每个 Agent 绑定一个指定 Runtime，不意味着不同 Agent 必须绑定不同 Runtime，更不意味着同一 Daemon 的目录自动隔离。** 一台机器若共用 `local_directory + in_place`，即使 Analyst-01 与 Backend-01 是两个 Agent，普通 Run 仍可能因同一真实目录而串行。

初期建议数量：

| Role | 实例 | 部署策略 | 并发建议 |
| --- | --- | --- | --- |
| Delivery Lead | 1 | 保留现有协调入口，不单独复制 | 继续按现有控制配置 |
| Workitem Analyst | Analyst-01 / 02 | 不同 Runtime 或可验证隔离的工作目录 | 每实例 `max_concurrent_tasks=1` |
| Backend Engineer | Backend-01 / 02 | 绑定具备相应 JDK、构建工具及业务仓权限的 Runtime | 每实例 `max_concurrent_tasks=1` |
| Frontend Engineer | Frontend-01 / 02 | 绑定具备 Node / 浏览器验证能力的 Runtime | 每实例 `max_concurrent_tasks=1` |
| Flink Engineer | 先 1，按需增加 | 只在相关工具链就绪时扩容 | 每实例 `1` |
| Verify Agent | 先 1 | 可独立取得固定 Candidate Commit / Evidence | 每实例 `1` |

不用在所有机器预先创建每种角色；**先有 Runtime 的真实执行能力，再注册可派工 Agent**。Agent 名称仅用于人类辨识，派工、日志和核验以 Agent ID / Runtime ID 为准。

## 3. 配置与能力契约

### 3.1 共享与差异

| 配置项 | 同职责 Agent 之间 | 责任归属 |
| --- | --- | --- |
| Description / Instructions | 共享同一角色语义；实例名不同但职责不漂移 | 01 + 03 / 04 |
| Project Skills / Method Skills | 共享；不得复制和维护 N 套 Analyst / Engineer Workflow | 03 / 04 / 06 |
| Runtime ID / Daemon / OS / 工具链 / Repository 权限 | 各实例独立配置及验收 | Multica / 运行环境 |
| Issue / Change / Task Set | 每次派工携带具体 ID 与可读取的批准事实 | Multica Issue + OpenSpec |
| Concurrency | 每实例先设为 1；Daemon 和目录另受约束 | Multica 原生能力 |

`Squad Instructions` 只声明“Lead 决定角色 / Task Set，调用只读 Selector，按返回的 Agent ID 精确 Mention；异常停止或协调移交”的简短协作规则。Selector 选择策略由本设计与后续脚本契约维护，不把筛选、排序算法重复写入 Prompt。专业 Skill 不感知其它同职责 Agent，也不自行调度。

### 3.2 Runtime / Project Resource

同一 Project 可以根据 Daemon 分别登记本机 `local_directory`，分别核验 `cwd`、Git 根仓及业务仓、权限与 Runtime Online 状态。现有 Multica 0.6.1 的 `in_place` 与目录互斥行为需按安装版本 PoC 回读。

```text
Runtime-A / Windows  -> D:/PoC/winning-platform-monorepo
Runtime-B / Linux    -> /srv/poc/winning-platform-monorepo
                         |-- AGENTS.md
                         |-- openspec/
                         |-- winning-dps-df-.../  (独立业务 Git 仓)
```

**根仓与子仓是独立 Git Repository**，根仓 `.gitignore` 排除业务子仓。对根仓执行 `git worktree` 只隔离根仓，不会自动创建业务子仓 Worktree；若采用 Worktree 模式，必须对所涉及业务仓分别完成 Checkout / Branch 隔离与验证。不能把根仓 Worktree 当成完整可运行的业务工作区。

## 4. Lead 语义决策 + 确定性 Agent Selector

### 4.1 决策边界

| 决策 | Owner | 约束 |
| --- | --- | --- |
| 当前阶段、有效审核与 Gate | 现有 Delivery Lifecycle / Gate | Selector 不参与业务审批、阶段流转 |
| 本次需要的 Role、`task_refs`、Repository Scope、Dependencies | Delivery Lead | 有现成明确 Route / 已批准分工时直接复用；语义不明由 Lead / Specialist 处理 |
| 同 Role 中的具体 Agent ID | 确定性 `agent-selector`（拟实施） | 只读当前权威事实；不改变 Role、Task Set、Owner 或 Issue 状态 |
| 精确 `@mention` / 必要 Sub-Issue Assignment | Delivery Lead + Multica Native | Selector 只返回选择结果，不直接写 Comment / Issue / Run |
| Git 工作区、OpenSpec Artifact 的可写性 | 执行 Agent + 现有工程安全检查 | 资源选择不等于安全锁或跨机 Artifact 同步 |
| 专业返工、Owner 变更、异常升级 | Delivery Lead | 原 Owner 优先，需安全交接时显式协调 |

`Workitem Analyst` 已是明确 Analysis Role 时不要求 Lead 重做分类；已批准的 Repository / Task Set 可以直接提供专业需求。只有跨专业边界、依赖或审核意见存在歧义时，Lead 才做新的语义判断。**Lead 不再逐个查询 Agent 队列并主观比较空闲度**。

### 4.2 Selector 的最小输入 / 输出契约

`agent-selector` 是**拟新增的确定性方法**；当前文档只给出行为契约，不宣称脚本、Multica CLI 接口或 Lead 工具权限已就绪。实现时优先作为 Lead 已有工具链的一次本地 Script 调用，避免多一个 Agent Run。

输入只传本次语义决策所需的少量字段（示例，非 Multica 原生 API 格式）：

```json
{
  "issue_id": "ISSUE-101",
  "role": "Backend Engineer",
  "repository": "winning-dps-df-frame",
  "change_ref": "sample-900001",
  "task_refs": ["1.1", "1.2"],
  "required_capabilities": ["java", "maven"]
}
```

Analysis 尚无 `task_refs` 时可省略 `change_ref` / `task_refs`；已有分派与 Owner **必须从权威 Issue / Assignment / Run / Handoff 事实读取并核验**，不能仅信任调用者的 `owner_agent_id` 提示。OS、Repository 权限、工具链要求只使用已明确的工程约束；不得靠文件名或 Agent Display Name 猜测。

Selector 需要读取（只读）：

- 当前 Squad Roster 中的 Agent ID / Role 和可解析的原生 Mention 身份；
- 已有同一 Issue / Repository / Task Set 的有效分派事实与活跃 Run，及返工关联；
- 候选的 Runtime / Daemon Online、已核验的 Project Resource / Repository 权限 / 必备工具链能力；
- 可授权读取时的 Agent Run / Queue；缺失此**可选负载数据**时走稳定的确定性退化，不能假称在线状态等于空队列。

其中 Runtime 工具链与 Repository 访问能力必须来自可复核的环境事实或现有受控配置；若尚无机器可读能力来源，先在 PoC 中验证或补最小配置映射，不为 Selector 建独立数据库或第二套事实源。

返回三类**本次调用结果**，不是新的 Multica Status：

| `decision` | 含义 | 后续动作 |
| --- | --- | --- |
| `SELECTED` | 已选择唯一、满足硬条件的 Agent；`selection_reason` 区分 `reuse_owner` / `least_queue` / `stable_fallback` | Lead 核对既有派工后精确 Mention / 按已确定 Projection Assignment |
| `NO_AVAILABLE` | 已确认无满足 Role / 能力 / Online 等硬条件的实例 | 不派工；维持原 Issue 事实，必要时交 Lead 协调 |
| `UNKNOWN` | 必需事实、权限或 Owner / Git 交接安全性无法确认 | 停止自动分派，交 Lead / Human / Specialist 补证据 |

`SELECTED` 示例：

```json
{
  "decision": "SELECTED",
  "agent_id": "<agent-uuid>",
  "selection_reason": "least_queue",
  "evidence": ["roster", "runtime_status", "agent_tasks"],
  "note": "non_reserving_snapshot"
}
```

真实输出须保留事实来源 / 查询时间或可回读引用；**不将 Selector 的瞬时选择写成持久 Owner 或资源预订**。当前 Issue 中被记录的有效分派仍以 Multica 原生事实为准。

### 4.3 选择算法与停止边界

按以下优先级，不能颠倒：

1. **Existing Owner First**：同 Issue 的 Analysis 返工优先复用原 Analyst；同 Delivery / Repository 的 Engineer 必须复用当前唯一有效 Owner。若其 Runtime Offline、旧 Run 未结束或未提交 Git / Artifact 无法安全交接，返回 `UNKNOWN` 或 `NO_AVAILABLE`，交 Lead 决定是否受控移交；**不得悄悄改派给另一个空闲实例**。
2. **Eligibility Filter**：没有既有 Owner 时，依据 Role、明确的 `required_capabilities`、目标 Repository 权限、工具链、OS 硬需求及 Runtime Online 过滤。缺少必需可读事实返回 `UNKNOWN`，不猜测；明确不满足条件的候选被排除。
3. **Queue-Aware Ranking**：对合格候选读取可用的 Run / Queue 数量，优先队列较短者；只读 `working/idle` 不保证队列为空，不进行原子 Slot 预订。
4. **Stable Fallback**：只有排队数据缺失、但 Role / 能力 / Online 等全部硬条件可证实时，才按固定 Agent ID 顺序选择，交给 Multica 原生队列。多个候选负载相同时同样按稳定 ID 决定，不引入轮询计数器或数据库。
5. **One Trigger**：Lead 在派工前回读是否已有相同 `task_refs` 的有效 Mention / Assignment / Run；如已派工，只补缺失动作或 NO-OP，不重复触发。需要独立 Sub-Issue 时复用现有 02 的 Runtime Projection / Owner 规则。

**只读选择不是锁**。两次同时运行的 Selector 可能选择同一 Agent，Multica 负责排队；Selector 不得实现排他锁、抢占、创建 Run、重试、状态迁移、自动换 Owner、Git 清理或跨 Runtime 工件同步。幂等派工仍依赖既有原生事实回读和必要 Gate，不能用 `SELECTED` 冒充“已派发成功”。

### 4.4 原生派工流程

```text
Delivery Lead 读取 Issue / Human Approval / OpenSpec
   ├─ 已有明确 Role / Task Set → 复用既有事实
   └─ 存在语义问题 → Lead / Specialist 判断 Role / Scope / Dependencies
                 ↓
      agent-selector(只读)：Roster → Owner → Eligibility → Queue
                 ↓
      SELECTED      NO_AVAILABLE       UNKNOWN
         │              │                 │
         ▼              └──────┬──────────┘
Lead 回读触发事实             停止当前派工并协调
         ↓
按精确 Roster Mention @Agent 或既有 Sub-Issue Assignment
         ↓
      Multica Native Run / Queue / Runtime
```

Lead 的 `@mention` 必须使用 Squad Roster 提供的准确 Member Mention 标识，不能把 `agent_id` 直接拼成普通文本 `@Backend-02` 冒充原生触发。真实 Mention 成功与 Run 启动需分别回读；重复触发、网络结果 UNKNOWN 先查当前 Issue / Run 事实后补缺失动作。

### 4.5 典型并发

| Issue | Lead 输出 Role | Selector 实例结果 | Development |
| --- | --- | --- | --- |
| ISSUE-A | Workitem Analyst | Analyst-01 | Backend-01 |
| ISSUE-B | Workitem Analyst | Analyst-02 | Backend-02 |
| ISSUE-C | Workitem Analyst | Analyst-01（原生排队） | Frontend-01 |
| ISSUE-D | Workitem Analyst | Analyst-02（原生排队） | Frontend-02 |

表中 Development 也须各自通过 Role / Task Set 和 Selector 选择；结果仅是逻辑示例，**并不代表同物理目录可并行**。Issue 进入 `analysis_review` 不长期占用整个 Squad 的机器 Slot。

### 4.6 Run / Session 成本

Selector 作为当前 Lead Run 内的只读脚本调用，**不增加 Agent 或 LLM Run**。同职责实例数量本身也不创建 Run；每次真正的 `@mention` / Assignment 才触发 Multica 原生 Run。相较 Lead 自行比较多 Agent，主要变化是增加一次轻量脚本查询，而不新增专业 Leader 层。

Run 与底层 Codex / Claude Code Session 不可简单一一对应。容量与效果按实际 Run、原生队列时长、Selector 返回率 / 失败率及 Token 使用量评估，不按实例数量直接推算 Session。

## 5. 并发隔离分层：不能只靠 Concurrency=1

| 层次 | 控制与安全边界 | 不提供的保证 |
| --- | --- | --- |
| Agent Run | `max_concurrent_tasks=1` 限制**单实例**同时执行 | 不限制同 Runtime 的其他 Agent，也不保留整个 Issue 的独占权 |
| Daemon / Directory | `in_place` 的同真实目录 Run 互斥；Daemon 另有资源上限 | Run 结束后不保护其他 Issue 的遗留 Dirty Git 状态 |
| Analysis Artifact | 每个 Change 使用独立 `openspec/changes/<change-id>/` | 根仓 Index、主规格、Schema / Config 仍可能冲突 |
| Business Git | 每个 Issue 的业务仓 Branch / Checkout / Worktree 必须可辨识 | 同机共享一个 Dirty Worktree 不会因 Agent 不同而安全 |
| Task Progress | 05 规定 Change-scoped single-writer critical section + Patch / Readback | 跨机器各有一套本地文件时，该临界区**不自动跨机器生效** |
| Root Git / Finalize | 批准 Baseline、Archive 和授权文件 Commit 必须从权威 Git 事实回读 | 不保证各台机器的未提交 OpenSpec 文件自动同步 |

Engineer / Analyst 写入前均须检查实际 `cwd`、Git Repository 身份、Branch / HEAD、`git status`、当前 Issue / Change 归属、授权文件范围。若发现其他 Issue 遗留修改或无法确认工作树来源，**STOP**，不得自动 `reset --hard`、强制 Checkout、盲目 Stash 或把他人文件一并 Commit。

## 6. 两个必须保留的跨 Runtime 交接 Gate

### 6.1 Analysis → Human Approval → Approved Baseline

现行 02 要求 Human Approval 后由 Delivery Lead 对批准基线负责并组织根仓 Commit。Squad Leader Run 不能被假定与 Analyst Run 使用同一个本地 Project `cwd`。当 Analyst-01 与 Analyst-02 的工作目录不同，**Change 目录存在于某一个 Runtime 不代表 Lead 或另一个 Runtime 直接可见**。

正式闭环前应确认：

- 已审核 Change 内容和批准来源能在被授权的 Root Git 写入环境中读取；
- 批准范围内根仓 Commit 的文件归属、分支、推送 / 回读得到可靠保证，且不夹带其它 Issue 的修改；
- 开发 Runtime 获取并校验**相同的 Approved Baseline Commit**，不能仅凭 Issue Comment、绝对路径或本机孤立 Commit 认定交接完成；
- 多 Analyst 并行批准不同 Change 时，根仓提交与同步不能相互覆盖。

现阶段不擅自指定新 Root Writer Agent 或新锁系统；是否用现有受控执行入口、Git 同步或其它最小机制，依据 PoC 决定。

### 6.2 Development → `tasks.md` → Verify / Finalize

02 / 04 / 05 允许研发期间的受控 OpenSpec 进度保存在可跨 Run 持续读取的共享根仓，最终由 Finalize 统一提交与归档。但**多台机器的同名根仓目录不是一个共享文件系统**；`tasks.md`、Design 与 Evidence 的未提交修改无法自然传播。

需要验证同一 Change 的 Patch / Readback 是否能被后续 Run / Verify / Finalize 在**真实指定执行环境**读到，尤其是 Backend-01 与 Frontend-02 分处不同 Runtime 的场景。失败或文件身份不明时保留 `NOT_READY`，不得从旧 `READY` 推断可以 Archive 或 Issue `done`。

此问题与 Analyst/Engineer 是否复制实例无关，是当前多机器交付 E2E 的独立关键缺口；如果必须改变根仓写入或中间提交时序，应先评审对 02 / 04 / 05 的影响。

## 7. 配置与实施顺序

1. 在**隔离 PoC Workspace / Project** 注册一个 Squad、一个 Lead、Analyst-01/02、Backend-01/02、Frontend-01/02（可先只上线其中一组），分别绑定真实 Runtime；同角色复用 Skills / Instructions，`max_concurrent_tasks=1`。
2. 验证 Lead 能在同一 Run 中调用**只读 `agent-selector`**：回读 Squad Roster、有效 Owner、Agent ID / Runtime ID、Daemon、Project Resource / 必备权限与 Queue；负载缺失但硬条件完整时允许稳定退化，缺硬条件时返回 `UNKNOWN`。
3. 实测分析并行、Backend 并行、同机 `in_place` 串行、跨机器安全交接；同机需要真并发时单独测试完整根仓 + 业务子仓 Worktree。
4. 验证 Selector 的 `SELECTED / NO_AVAILABLE / UNKNOWN`、Owner Affinity、重复 Mention、旧 Run 未结束、Offline、Human Review 返工、PR Changes Requested 和 Verify 的恢复行为；Selector 自身不触发 Run。
5. **只在 Selector 与 E2E Gate 通过后**，评审是否同步 02 §3.3 / §7 中“Lead 选择具体成员、脚本不选成员”的现行权威边界，以及 01/03/04/07 的最小变化；若跨机器 OpenSpec 存在缺口，再专项评审 05。本专项方案不直接修改 01–07。

示例 CLI（以安装版本帮助与真实回读为准）：

```bash
multica runtime list --output json
multica squad member list <SQUAD_ID> --output json
multica agent get <ANALYST_01_ID> --output json
multica agent tasks <ANALYST_01_ID> --output json
multica project resource list <PROJECT_ID> --output json
multica agent update <ANALYST_01_ID> --max-concurrent-tasks 1
multica agent update <BACKEND_01_ID> --max-concurrent-tasks 1
```

`working/idle`、Queue 及 Runtime 观测是不同来源；服务器存在成员状态接口，不保证 Lead Agent 已有可授权的调用权限。Selector 的接口、能力事实来源与 Lead Run 调用权限均为 PoC 验证对象。不得把人的 Desktop 可见状态当作脚本可调用，也不得把脚本选人成功当作 Multica 原生 Mention 已成功。

## 8. PoC 验收矩阵

| ID | Priority | 验证事项 | 最小 PASS 证据 |
| --- | --- | --- | --- |
| S01 | P0 | 同一 Squad 配置两名 Workitem Analyst | 两个 Agent ID 与 Runtime 绑定、相同 Role / Skill、准确 Roster |
| S02 | P0 | Analyst-01/02 执行不同 Issue | 两个真实 Run、独立 Change ID、无互相覆盖、同机目录排队事实 |
| S03 | P0 | Lead 输出 Role / Scope，Selector 只读选具体实例 | 相同事实输入得到一致 Agent ID / Decision，包含来源；Lead 独立完成唯一精确 Mention |
| S04 | P0 | Backend-01/02 对不同 Issue 的同业务仓开发 | 独立 Branch / Git Worktree 或隔离 Checkout；候选 Commit 不混入对方变更 |
| S05 | P0 | Frontend-01/02 的 Runtime 映射 | 准确工具链 / 浏览器能力、Agent / Runtime / cwd 回读 |
| S06 | P0 | Concurrency / 同目录限制 | 单 Agent 不出现重叠 Running；同目录 `in_place` 不错误声称并行 |
| S07 | P0 | 人审批准后跨 Runtime 读取 OpenSpec Baseline | 可复核的批准依据 + 同一 Git Commit / Artifact |
| S08 | P0 | 跨 Runtime `tasks.md` / Evidence / Finalize | 真实进度可读取且不丢写；缺失时明确 STOP，不假 `done` |
| S09 | P1 | 返工 / Offline / Owner 更换 | 原 Owner 优先、旧 Run 结束确认、Git 状态安全交接、无重复执行 |
| S10 | P1 | Parent Mention / Sub-Issue Assignment | 同一 Task Set 不产生两个有效执行入口 |
| S11 | P0 | Selector 无状态、Owner Affinity、队列与退化 | 旧 Owner 优先；繁忙可排队；仅 Queue 缺失时稳定退化；没有持久 Slot / 新 Run |
| S12 | P0 | Selector 错误返回与真实权限 | 无可用候选为 `NO_AVAILABLE`；缺硬条件 / Owner 冲突为 `UNKNOWN`；脚本只读不派工 |

执行与证据收集参见 [单 Squad 多 Runtime 验证 SOP](../../validation/single-squad-multi-runtime-poc.md)。现有 SOP 针对 Engineer 的 P01–P15 测试保留；新增 Analyst / Frontend 多实例测试作为本方案的新增验收项。当前均为 **NOT_RUN**，不得将“原生机制可行”误写为“多 Runtime 交付链路已通过”。

## 9. 对 01–07 的影响评估

| 文档 | 预计影响 | 后续通过 PoC 后的最小调整 |
| --- | --- | --- |
| 01 Design Guideline | 低 | 同职责 Agent 可多实例；Skill / Instructions 共享；Runtime 独立 |
| 02 Delivery Lifecycle | 中 | PoC 后把“具体实例选择”下移 Selector；Lead 保留 Role / Task Set、Human Review、Owner 移交与原生派工；对齐 §3.3 / §7 当前的“脚本不选成员”描述 |
| 03 Workitem Analysis | 低 | Analyst 多实例但沿用同一个 Analysis Route / Gate / Human Review |
| 04 Engineer Development | 中 | 实例化派工、跨 Issue 同业务仓 Git 隔离、返工继续复用 Owner |
| 05 OpenSpec Schema | 视交接验证而定，可能较高 | 跨机器 Task Progress 写入一致性；未证明之前不改契约 |
| 06 Method / Skill Library | 极低 | 不复制专业 Method / Skill |
| 07 Implementation Roadmap | 中 | 把 Selector 三态、Owner Affinity、只读授权、多 Analyst / Engineer / Runtime PoC 加入已有 Foundation / 并发验收，保持原 16 Step 主结构 |

**不直接改动 01–07**：先对本设计做隔离验证，再按已验收事实更新各自权威章节。不得为解决同 Role 选人引入多 Squad 编排或新状态机。

## 10. 决议

采用 **Single Squad / Semantic Lead / Read-only Deterministic Agent Selector / Multiple Agent Instances / Native Queue** 作为目标组织模型。初始实例：2 个 Analyst、2 个 Backend、2 个 Frontend，Flink 与 Verify 按需扩展；Lead 负责跨角色语义编排与原生派工，Selector 只返回具体实例。

- **组织模型已选定**：不再以多 Squad Coordinator / Nested Squad 作为首选方案；Selector 仅是 PoC 待实施的只读方法，不是当前已部署的调度服务。
- **运行时交付尚未验收**：Run/Session、目录并发、业务子仓 Git、OpenSpec Baseline / Progress / Finalize 必须提供真实 PoC 证据。
- **保持 KISS**：先验证 Selector 的只读选择 / 权限、原生 Mention、Agent=1 与安全 Git 边界；遇到失败针对最小缺口整改，不预建 Scheduler、Pool 数据库或分布式锁。
