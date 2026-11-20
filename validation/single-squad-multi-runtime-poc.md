# Multica 单 Squad · 多 Agent 实例 / Runtime 原生派工验证 SOP

> Version: 1.2.0  
> Date: 2026-10-14  
> Status: NOT_RUN（仅给出可执行实验，全部 Case 默认 NOT_RUN）  
> Parent Proposal: [单 Squad 多 Agent 实例 / Runtime 设计](../archive/docs-2026-11-18/single-squad-multi-agent-runtime-design.md)\
> Boundary: **只在隔离 Multica Workspace / Project 与临时 Git 仓库测试；不修改 01–07、旧多 Squad 方案、正式 Agent/Skill/Runtime/TFS Issue，不接入正式 TFS Sync 或真实业务仓库。**

## 0. 验证问题与实验结论

要确认的并非“是否可以把几个 Engineer 添加到同一 Squad”这一单点能力，而是整个链路：

```text
Issue → Squad → Leader（确定 Role / Scope / Dependencies）
  → agent-selector（只读查询 Owner / Roster / Runtime / Queue → 具体 Agent ID）
  → Leader 精确 @Workitem Analyst / @Engineer（具体实例）
  → 绑定的 Windows / Linux Runtime
  → 本机 Project local_directory
  → Git 预检 / 开发 / 持久化
  → Engineer 回报 / 后续恢复 / Verify / Finalize
```

**关键假设（等待实测）**：

- H1：一个 Squad 可以有 Analyst-01/02、Backend-01/02、Frontend-01/02 等同职责不同 Agent，`@mention` 可以准确路由，且同职责实例不需要维护多套 Skill。
- H2：`max_concurrent_tasks=1` 正确限制**同一个 Agent**的 Run；其他 Agent / Daemon 可正常运行。
- H3：Lead 负责 Role / Task Set 语义；在当前 Lead Run 中调用拟实现的**只读确定性 Selector** 选择具体 Agent。Selector 能授权获取必需 Owner / Roster / Runtime / Capability 事实；Queue 不可读取时仅在硬条件可证实时稳定退化，不增加 Agent Run / 状态库。
- H4：Analyst-01/02 可分别承接不同 Issue 的独立 Change ID；文件冲突较小，但同一 `in_place` 根仓仍可能串行 Run，跨 Runtime 的审批基线不能依赖未提交的本地文件。
- H5：Git 跨 Run 与跨机器交接不会污染其他 Issue；**这是最终可用性的必要条件，而非 H2 的自然推论**。
- H6：Human Approval 后 OpenSpec 基线、研发中间 Progress 和 Finalize 可跨机器持久化、恢复；如果不能，标为 NOT_READY。

## 1. 环境准备与禁止事项

### 1.1 测试环境

| 对象 | 需要的隔离资源 | 记录值 |
| --- | --- | --- |
| Multica Server / Workspace | 临时 Workspace，不能绑定正式 TFS / Autopilot | `<WORKSPACE_ID>` |
| Project | 临时 Project，关联临时根仓 | `<PROJECT_ID>` |
| Delivery Squad | 一支 PoC Squad，1 个 Lead | `<SQUAD_ID>` / `<LEAD_AGENT_ID>` |
| agent-selector（拟实施） | Lead Run 可调用的只读脚本 / 方法；不作为 Squad 成员，也不直接创建 Run | `<SELECTOR_ENTRYPOINT>` / `<SELECTOR_RESULT>` |
| Workitem Analyst | 两个同职责实例，分别绑定可核实的 Runtime；共享专业 Skills | `<ANALYST_01_ID>` / `<ANALYST_02_ID>` |
| Backend-01（Windows） | 一个 Windows Runtime + Agent，`max_concurrent_tasks=1` | `<WIN_AGENT_ID>` / `<WIN_RUNTIME_ID>` / `<WIN_DAEMON_ID>` |
| Backend-02（Linux） | 一个 Linux Runtime + Agent，`max_concurrent_tasks=1` | `<LIN_AGENT_ID>` / `<LIN_RUNTIME_ID>` / `<LIN_DAEMON_ID>` |
| Frontend-01/02 | 两个同职责实例；具备受控的 Node / Browser 能力，按 Runtime 可用性测试 | `<FRONTEND_01_ID>` / `<FRONTEND_02_ID>` |
| Git 根仓 | 新建临时 Git Repo，带 `AGENTS.md` 与 `openspec/changes/` | `<POC_ROOT_REMOTE>` |
| 业务子仓 | 在根仓子目录放置独立的临时 Git Repo，非 Submodule | `poc-backend/` / `<POC_BUSINESS_REMOTE>` |
| Issue | 7 个纯测试 Issue，测试 TFS ID 使用虚构编号 | A–G |

**顺序**：先验证单 Squad 中 Analyst / Backend 的多实例及原生派工，再增加 Frontend 同职责实例测试；有第二台机器后才执行完整跨机。没有第二台机器时跨机 Case 均标 **NOT_RUN**，不能假设 PASS。

POC Git 目录建议：

```text
Windows: D:\PoC\multica-single-squad\
Linux:   /srv/poc/multica-single-squad/
  ├── AGENTS.md
  ├── .git/                              # 临时根仓
  ├── openspec/changes/
  │   ├── backend-a-900001/
  │   └── backend-b-900002/
  └── poc-backend/
      ├── .git/                          # 独立业务子仓；不是 Submodule
      └── sample.txt
```

根仓 `.gitignore` 中忽略 `poc-backend/`。两台机器可以有独立 Clone；若需要相互同步，仅使用**测试专用 Remote**，不要对正式 Git Origin Push。初始化时先为根仓和业务子仓分别创建至少一个 Commit，并记录 Baseline SHA。

**禁止操作**：真实业务仓库中的 `git reset --hard`、`git clean -fd`、`git stash pop`、强制 `checkout`、`push --force`；任何正式 TFS 任务、真实 PR 或真实 Schema 修改。遇到意外写入正式目录立即 STOP 并保留证据，不继续实验。

### 1.2 只读盘点命令

先在每台机器回读身份和环境：

```bash
multica daemon status --output json
multica runtime list --output json
multica project resource list <PROJECT_ID> --output json
multica squad get <SQUAD_ID> --output json
multica squad member list <SQUAD_ID> --output json
multica agent get <WIN_AGENT_ID> --output json
multica agent get <LIN_AGENT_ID> --output json
```

必要时在隔离 Workspace 中创建 PoC Agent 并绑定各 Runtime；原生 CLI 示例：

```bash
multica agent create --name "Workitem Analyst POC 01" --runtime-id <WIN_RUNTIME_ID> --max-concurrent-tasks 1 --output json
multica agent create --name "Workitem Analyst POC 02" --runtime-id <LIN_RUNTIME_ID> --max-concurrent-tasks 1 --output json
multica agent create --name "Backend Engineer POC Windows" --runtime-id <WIN_RUNTIME_ID> --max-concurrent-tasks 1 --output json
multica agent create --name "Backend Engineer POC Linux" --runtime-id <LIN_RUNTIME_ID> --max-concurrent-tasks 1 --output json

multica squad member add <SQUAD_ID> --member-id <WIN_AGENT_ID> --type agent --role backend-windows --output json
multica squad member add <SQUAD_ID> --member-id <LIN_AGENT_ID> --type agent --role backend-linux --output json
```

两台机器使用相同的 `PROJECT_ID`，但不同 `daemon_id / local_path`；已绑定相同 Daemon 目录时不要重复 Add。Project Resource 的背景约束见父方案 §3.2；具体 CLI 参数必须以目标安装版本的帮助与回读为准。本 PoC 不改正式资源。

每个 PoC Agent 的 Instructions 限定：只准修改本测试 Project、只准测试文件、必须回报真实 `cwd` / `git status` / Git SHA，不得访问正式业务仓库。Lead 负责 Role / Task Set 语义，调用只读 Selector 获取 Agent ID 后从 Roster 精确 Mention；不能使用自然语言假装调用其他 Agent。Selector 本身**不得**执行 Mention、Issue Update、状态变更或 Run 创建。若当前尚无 Selector 代码 / 授权能力，对应 Case 标为 NOT_RUN / BLOCKED，不把人工比较候选视为脚本 PASS。

## 2. 测试 Issue 与任务注入

| Issue | 模拟业务 / 路由 | 指派目标 | 专用测试内容 |
| --- | --- | --- | --- |
| A = TFS-900001 | 后端 Change A | Backend-Windows | `openspec/changes/backend-a-900001/`，`poc-backend/sample.txt` |
| B = TFS-900002 | 后端 Change B | Backend-Linux | `openspec/changes/backend-b-900002/`，另一测试分支 |
| C = TFS-900003 | Backend-Windows 第二个 Run | Backend-Windows | 用来测试 Agent 排队、同机不同 Issue |
| D = TFS-900004 | 审核中 Change | Analyst-01 | 验证 Analysis / Git Baseline 的交接 |
| E = TFS-900005 | PR Changes Requested / Rework | 原 Backend Engineer | 验证固定 Owner 和恢复同一 Branch |
| F = TFS-900006 | 独立并行 Analysis Change | Analyst-02 | 验证同职责实例与不同 Change 无覆盖 |
| G = TFS-900007 | Frontend 并发 / 恢复 | Frontend-01/02 | 验证两个实例的工具链、Runtime / Git 归属 |

在临时 Workspace 中可通过：

```bash
multica issue create --title "POC A Backend" --description "测试任务，仅修改临时 Git 仓库" --status todo --assignee-id <SQUAD_ID> --project <PROJECT_ID> --output json
multica issue create --title "POC B Backend" --description "测试任务，仅修改临时 Git 仓库" --status todo --assignee-id <SQUAD_ID> --project <PROJECT_ID> --output json
```

以上触发真实 Leader Run；为了精确控制时间，先只创建 A，确认后再创建 B/C。A/B 的 OpenSpec Change 必须与各自测试 TFS ID 唯一对应。不要用真实 TFS Sync 创建数据。

**观测命令**：

```bash
multica issue get <ISSUE_ID> --output json
multica issue runs <ISSUE_ID> --output json
multica issue runs <ISSUE_ID> --active --output json
multica issue comment list <ISSUE_ID> --output json
multica agent tasks <ENGINEER_AGENT_ID> --output json
multica runtime list --output json
```

Member Status API：`GET /api/squads/<SQUAD_ID>/members/status`。它存在于源码，但 CLI 中未见对应 `squad member status` 子命令；通过已授权的 Desktop / Web 登录会话或经授权的 HTTP 客户端进行只读访问。**不得把登录 Cookie、Token 或私有配置写入证据文件。** 如果无法授权调用，则记为该观测子项 FAIL / NOT_RUN，并用 CLI Agent Tasks 补充，不能假装 Agent 自带该能力。

## 3. Case 矩阵与期望结论

状态全部从 `NOT_RUN` 开始；PASS 必须有本机事实 / Run ID / Git 差异支撑。

| Case | 类型 | 测试动作 | PASS 判据 |
| --- | --- | --- | --- |
| **P01** | P0 Native | 在一个 Squad 增加同 Role 的两个 Backend Agent，分别绑 Windows / Linux Runtime | Roster 中两个不同 Agent UUID / Runtime；Leader 精确 Mention 语法可获取 |
| **P02** | P0 Native | Issue A 指派给 Squad，Lead Mention Windows Backend；B Mention Linux Backend | 每个 Issue 的 Worker Run `agent_id` / `runtime_id` / `daemon_id` 均正确，没有误派或重复启动 |
| **P03** | P0 Native | Windows Backend 运行 A 时再次触发 C，Agent 并发设 `1` | 同 Agent 不出现重叠 running；C 进入队列并在 A 结束后执行 |
| **P04** | P0 Native | 同机两个不同 Agent 都写同一个 `in_place` 实目录 | 后到 Run 出现 `waiting_local_directory` 或其他可确认的串行事实；目录写入不交叠 |
| **P05** | P0 Dispatch | Lead 只提交 Role / Scope，Selector 从 Owner / Roster / Runtime / Queue 事实选择 Agent ID；Lead 原生 Mention | 相同事实结果稳定且来源可回读；Selector 没有副作用，实际 Worker Run 归属正确；`idle` 不被当作空队列 |
| **P06** | P1 Analysis | Analyst 在独立 Change 目录分别写入 A、B 的 `proposal.md` / `tasks.md` | 文件路径不交叉、Change ID 唯一；记录实际 Run 是否因 `in_place` 串行 |
| **P07** | **P0 Safety** | A 写入业务子仓后不提交并结束 Run，触发同机 C | C 在动手前检测“另一 Issue 遗留的 Dirty Worktree / Branch”，拒绝混合提交或修改 |
| **P08** | P0 Safety | A Commit/Push 后 C 接管同一机器业务子仓，再恢复 A | 具备 A/C 各自 Branch + Candidate SHA 证据；只有在状态干净时允许安全切换，恢复 A 不混入 C |
| **P09** | **P0 Handoff** | Analyst 本地创建 D Change，Human 审批后 Lead 尝试当前定义的批准基线操作 | 回读 Lead 实际 `cwd`；若未绑定 Change 所在 Local Directory，不虚报成功；有受控执行者完成 Baseline Commit 才能证明后续可消费 |
| **P10** | **P0 Handoff** | Windows 已批准 Baseline Commit/Push，Linux Engineer 读取 D Change | Linux 能回读同一 Commit、`proposal.md`、`tasks.md`、`change_ref`，拒绝仅依赖 Windows 未提交文件 |
| **P11** | **P0 Handoff** | Linux Engineer 在开发中更新 D `tasks.md` / Evidence，然后 Windows 执行 Finalize 预检查 | 真实远端可读取相同 Task Progress / Evidence，未同步时明确 STOP；不得误归档或 `done` |
| **P12** | P1 Recovery | A 的 PR 收到 Changes Requested，B 已在其他机器开发；Lead 唤醒原 Engineer | 恢复 A 原 Agent、Branch、Candidate；不因“当前 idle”重分配到另一个 Agent |
| **P13** | P1 Failure | Linux Runtime Offline / 项目目录映射错误，再尝试派发 B | Selector 排除不可用实例；缺必需 Resource 事实返回 UNKNOWN，不盲选 Windows；Lead 不重复派发 |
| **P14** | P1 Trigger | 通过 Parent Mention 与按需 Sub-Issue Assignment 模拟重复触发风险 | 同一 `task_refs` 仅一次正常派工；重复路径被识别并停止 |
| **P15** | P1 Verify | 固定 Candidate Commit 后，跨机器 Verify（若需） | Verify 在独立 Runtime 能获取准确候选代码及证据；不能取得时 STOP |
| **P16** | **P0 Analyst** | 将 D / F 分别派给 Analyst-01 / Analyst-02，同时执行不同 Issue | 有两个准确 Agent / Runtime / Run ID，独立 Change ID、Git 基线和任务写入；如同目录被串行，明确记录而非假报并行 |
| **P17** | P1 Frontend | 两个 Frontend Agent 分别绑定不同可用 Runtime / 工作目录执行前端测试任务 | 真实 Agent / Runtime / cwd、工具链及浏览器验证事实；不得混用业务仓 Branch 或输出 |
| **P18** | P1 Analyst Recovery | D 的 Analysis 被 Human 驳回后再次派工，或 Analyst-01 Offline 后安全转 Analyst-02 | Selector 原 Owner 优先；原 Owner 不可用时不自动更换，Lead 确认旧 Run 已结束、Change / 未提交事实可获取后才能受控移交 |
| **P19** | **P0 Selector** | 固定 Roster + Runtime 快照，重复运行相同 Role / Scope 输入 | 两次返回同一 `SELECTED.agent_id`；包含事实来源，零新 Agent/Run/Issue Comment 和零持久状态写入 |
| **P20** | **P0 Selector** | 已有有效 Backend-01 Owner，但 Backend-02 空闲；触发原 Task Set 返工 | 返回 Backend-01 的 `reuse_owner`；若旧 Run 活跃或交接不安全，返回 `UNKNOWN`，不得悄悄转交 Backend-02 |
| **P21** | **P0 Selector** | 全部候选繁忙；单独移除 Queue 可读性 | Queue 可读时选择最少队列；仅 Queue 不可读时按稳定 Agent ID 退化，Multica 自行排队、不新增 WAIT / Scheduler |
| **P22** | **P0 Selector** | 无匹配 Role / Runtime 全部明确 Offline；以及缺失必要权限 / 能力配置 | 分别返回 `NO_AVAILABLE` / `UNKNOWN`，不得随机选人或宣称派发成功 |
| **P23** | **P0 Dispatch Safety** | Selector 先返回 `SELECTED`，再模拟重复 Lead Run / 已存在 Sub-Issue Assignment | Lead 派工前回读有效触发事实，重复时 NO-OP；真实 Mention / Run 分别可查；Selector 不调用派工 API |

**注意**：P07 是一个应当暴露的安全风险测试。原生 Agent 并发数为 1 **并不能自行防止污染**；只有现行或 PoC 约束能让 C 的 Git 预检正确 STOP，P07 才能 PASS。如果 C 自动混入 A 的未提交代码，必须明确标 FAIL。

P09、P10、P11 是“单 Squad、多机器”可完整交付的核心。新增 P19–P23 是**确定性 Selector 可用性**的验收，不代表它当前已经实现。即便 P01–P05、P19–P23 PASS，也只能证明协作与派工；不能替代跨机器工程交接验收。

## 4. 分步操作与证据要求

### Step 1：单 Squad Roster 与 Selector 只读事实（P01、P05、P19–P22）

1. 在隔离 Workspace 新建一个 Squad，1 个 Lead；至少两名 Backend Agent，绑定不同 Runtime。
2. 使用 `squad member list`、`agent get` 截取两个 Agent ID、Runtime ID 和相同 `role=backend` 事实。
3. 从 Squad UI 或只读 Member Status API 对比 `working / idle / offline / unstable`，并与 `agent tasks` 返回的真实 queued / running 记录交叉核对。
4. 提供固定 `issue_id / role / repository / task_refs` 测试输入，要求 Selector 从**可授权的机器可读事实**查询 Owner、Role、Runtime、Capability、Queue，而不是 Lead 自行选 UUID；记录 Selector 的真实调用入口、输出、查询来源和状态。
5. P19–P22 依次注入相同快照、旧 Owner、Queue 不可读、全部候选 Offline 与必要事实缺失。验证 `SELECTED / NO_AVAILABLE / UNKNOWN` 与 `reuse_owner / least_queue / stable_fallback`；记录调用前后 Issue / Run / Comment 无新增副作用。
6. 确认 Lead Run 自身能调用该 Selector，不能用人的管理终端成功代替 Lead 权限验证；目前无脚本时明确 NOT_RUN。

### Step 2：Selector 选人 → Lead 原生派工（P02–P04、P23）

1. **P02 原生链路**：A 指派 Squad，触发 Leader；测试人员在已确认的 Roster 中指定 Backend-Windows，Lead 用精确 Mention UUID 下达最小工作，以便独立验证 Multica 原生机制。**P05 / P23 完整链路**：Lead 确定 Backend Role / Scope，读取 Selector 返回的唯一 Agent ID，再按 Roster 精确 Mention；Selector 返回非 SELECTED 时 STOP / 协调，不猜测目标。不能将 P02 原生 PASS 冒充 Selector PASS。
2. 观察 A 的 Leader Run、Worker Run、实际 Windows `cwd`。
3. A Worker 仍处于 running 时，创建 C 并让 Lead 指派给同一个 Windows Backend；回读队列。
4. 再让另一名同机临时 Worker Agent 请求写测试目录，确认 `in_place` 锁；不要为了制造并发而触碰正式代码。
5. 在 Linux 上触发 B；Windows / Linux 的 Work Directory 应各自独立，且各自通过真实 Agent Run 确认。
6. P23 通过重复 Lead Run / 已存在 Sub-Issue Assignment 注入重复派工风险，确认 Lead 派工前回读并 NO-OP；Selector 不触发第二个 Worker Run，不声称 SELECTED 就等于 Run 已启动。

### Step 3：多 Analyst 的 Analysis 产物与 Git 污染（P06–P08、P16、P18）

1. 使用 Analyst-01 / Analyst-02 分别在 D、F 对应 Change 目录创建不同的 `proposal.md` / `tasks.md`，回读两个真实 Run、准确 Runtime、路径和 `git diff`。若两个 Analyst 使用同一个 `in_place` 根目录，必须记录实际串行事实，不把不同 Change 目录误当作物理并发。审批返工时先复用 D 的原 Analyst；需改派时核对旧 Run、Git 与工件安全交接。
2. A Worker 在临时业务子仓留下**未 Commit 的标记**后完成 Run；记录 `git status --porcelain=v1`、`git branch --show-current`、`git rev-parse HEAD`。
3. C Worker 紧随其后进入同机器、同业务子仓，要求它先执行 Git 预检。预期：识别 A 的未提交内容与 Issue 身份不一致，**停止修改**。若默认 Skill 没做到，记 FAIL，并提供最小缺口，不能临时人为清理后宣布成功。
4. 使用隔离仓安全收敛 A 的变更并建立独立 Commit / Branch，再重测 C 的正常开发与 A 的恢复。禁止以强制切换或删除文件冒充安全恢复。

### Step 4：OpenSpec 批准基线与跨机器恢复（P09–P11）

1. Analyst 在 Windows 根仓写 D 的 OpenSpec Artifact，保留真实文件内容和 Git 状态。
2. 在测试 Issue 中记录模拟 Human Approval；使用当前 Leader Run **只读查看 `cwd` / Project Resource 选择**，验证是否能看到 D 的文件。
3. 如 Lead 没有正确本地根仓，不要求它强行提交。临时由已授权的 **人工 PoC 执行者**在隔离 Windows 根仓完成 Approved Baseline Commit 和 Push，记录 SHA。此步骤只证明数据传输，不证明正式“Lead 自动提交”已闭环。
4. Linux 机器 Fetch 固定 SHA，校验 `change_ref`、`proposal.md`、`tasks.md` 和准确 Git 基线；不能仅按远端默认 Branch 最新状态推断批准版本。
5. Linux 在自己的根仓中修改 D `tasks.md` 完成标记及测试 Evidence，但暂不提交；Windows 随后尝试读取并执行 **Finalize 预检（不得真实 `done`）**。预期 Windows 发现缺失的中间进度并 STOP，记录 `NOT_READY`。再手工验证候选的**最小受控同步方法**能否恢复事实（例如指定文件 Commit/Push/Fetch）；须区别“测试恢复步骤”与“自动闭环实现”。
6. 记录可能影响现行 02 / 04 的最小改动项；未经审批不改正式 Skill、Schema、根仓 Commit 时序。

### Step 5：返工、Offline、Frontend 实例与最终结果（P12–P15、P17–P18）

使用独立 Issue Comment 模拟 PR Changes Requested，回读固定 Engineer / Branch；人为停掉测试 Runtime 再测试 Offline，最后验证具有真实 Candidate SHA 的跨机 Verify。按 P17 补测 Frontend-01/02 真实 Runtime / cwd / Node 与浏览器能力；按 P18 检验 Analyst 返工与安全移交。若当前测试环境不支持相应触发方式，标 NOT_RUN 并说明缺口，不写 PASS。

## 5. 判定规则

### 5.1 状态定义

- **PASS**：满足 Case 的明确后置条件，且有真实命令输出 / Runtime / Git / Issue 证据。
- **FAIL**：系统支持但结果不满足，或观察到目录污染、错误 Runtime、重复执行、Git 事实误用。
- **NOT_RUN**：条件未具备或未执行。不能把官方机制、设计推断或人工模拟的结果计为自动 E2E PASS。
- **BLOCKED**：测试被权限、工具版本、离线或其他具体外部条件阻断；记录所需恢复条件，后续仍须重测。

### 5.2 决策 Gate

| Gate | 必须完成 | 允许得出的结论 |
| --- | --- | --- |
| G1 · Native Feasibility | P01–P04、P16 | 原生 Squad + 多职责 Agent + Mention + Concurrency=1 可用；不混入 Selector 脚本的通过判定 |
| G1-S · Selector Contract | P05、P19–P23 | Lead Role/Scope → 只读确定性选 Agent → Lead 原生派工可用；三态 / 原 Owner / 稳定退化 / 幂等均有证据 |
| G2 · Engineering Safety | P07、P08，且 P06 的公共 Git 风险有证据 | 不同 Issue 的跨 Run 业务 Git 状态不会被静默混写 |
| G3 · End-to-End Handoff | P09–P11 | 已批准 OpenSpec 与中间进度可跨 Runtime 恢复；Lead / Finalize 执行责任不依赖错误的目录假设 |
| G4 · Operations | P12–P15、P17、P18 按实际业务必要性验证 | 具备专业多实例、返工、异常恢复和可选 Verify 的运行条件 |

**决策**：
- G1 PASS 但 G1-S 未通过：只能认定原生多实例派工可行，**不能**认定 Selector 分派已实现。
- G1 + G1-S PASS 而 G2 / G3 未通过：**Agent Selection FEASIBLE，但 Cross-Machine Delivery NOT_READY**。可先评估同机隔离 PoC，不上线跨机全自动编码。
- G1、G1-S、G2、G3 均 PASS：可以考虑正式接入该 Selector，并单独评审 01–07 中尤其 02 §3.3 / §7 的“Lead 选择成员、脚本不选成员”权威约束；当前专项 PoC 不直接修改主方案。
- 关键 Case FAIL / BLOCKED：写出失败点与最小修复，不自行创建新架构、数据库、调度器，也不修改生产环境补测。

## 6. 验证结果文档模板

建议最终生成（只有本地真正执行后才填）：

```text
docs/multica/validation/single-squad-multi-runtime-result-YYYY-MM-DD.md
```

模板：

```markdown
# Single Squad Multi Runtime PoC Result
- Date:
- Multica Server / CLI / Daemon versions:
- Workspace ID / Project ID:
- Squad ID / Lead Agent ID:
- Windows Runtime ID / Daemon ID / Local Path:
- Linux Runtime ID / Daemon ID / Local Path:
- Root Repo Commit(s):
- Business Repo Commit(s):

## Case Results
| Case | Status | Issue ID | Run ID | Runtime / cwd | Git SHA / Diff | Evidence | Failure / Next Action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P01 | NOT_RUN | | | | | | |
...

## Verification Summary
- G1 Native Feasibility: PASS / FAIL / NOT_RUN
- G1-S Selector Contract: PASS / FAIL / NOT_RUN
- G2 Engineering Safety: PASS / FAIL / NOT_RUN
- G3 End-to-End Handoff: PASS / FAIL / NOT_RUN
- G4 Operations: PASS / FAIL / NOT_RUN

## Proposed Decision
- [ ] Single Squad + multi-agent + multi-runtime routing accepted
- [ ] Read-only deterministic Selector accepted
- [ ] Git cross-run handling ready
- [ ] OpenSpec cross-machine lifecycle ready
- [ ] Further targeted PoC required
- [ ] Do not modify 01–07 until explicit review
```

命令输出保留必要字段，证据附件不得包含 Token、Credential 或私有源码片段。Git 证据需要区分根仓与子仓两个 Repository，不能用根仓的 `git status` 推断业务子仓状态。

## 7. 给本地 Agent 的最小执行指令

> 在**确认临时 Workspace / Project / Git Root 全部隔离之后**，依照本 SOP 分阶段执行。先完成 P01–P04、P16（原生），单独验证 P05、P19–P23（Selector），再执行 P06–P11；P12–P15、P17、P18 根据条件开展。每一步使用真实 Multica Run、Git 事实和 Issue 证据，未执行的 Case 保持 NOT_RUN。仅测试，不修改 01–07、`multi-squad-coordination-design.md` 或正式 Multica 配置；失败时保留现场，不强制清理。生成独立 PoC Result 并分别判断 G1/G1-S/G2/G3/G4，尤其指出 Approval Root Git Commit 与跨机 `tasks.md` / Finalize 是否真正闭环。