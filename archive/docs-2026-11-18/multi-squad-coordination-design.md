# Multica 多小队协同与调度设计方案（Squad Coordinator）

> Version: 0.1.2  
> Date: 2026-10-14  
> Status: Proposal / PoC Pending（候选设计，未实施、未验收）  
> Scope: 单一 Multica Workspace / Project 内，多个独立 Delivery Squad 的容量感知、Issue 分配、跨队协调与异常恢复；首期以 Windows / Linux 等多机器、各 Daemon 独立 Local Directory 的单 Slot 部署实现执行隔离。  
> Relationship: **本文为独立探索方案，不修改、不覆盖现行 01–07 主方案，也不表示现有 Runtime / Agent / Skill 配置已经调整。** 后续需经 PoC、评审后再决定是否纳入主方案。

## 1. 背景与设计目标

本方案关注的是**多个 Squad 之间的协调与分配**；多机器只是首期的执行隔离部署方式，不是 Squad Coordinator 的职责定义边界。

现有工作区由根 Git 仓库管理 `AGENTS.md`、`openspec/`、共享知识及 AI Coding 资产，业务代码位于根目录下的多个**独立 Git 子仓库**。Multica Project 目前主要关联根工作区。若多个 Delivery Issue 在同一台机器、同一个 `in_place` 工作目录中运行，会遇到执行排队、Git 状态冲突及子仓修改相互污染等问题。

本方案限定在**暂不考虑单台机器上多个 Issue 并发写入**的前提下，采用“多台机器，每台机器一个 Delivery Squad，同一时间一个占用中的 Delivery Issue”的方式获得并行能力。

目标：

1. 保留现有根仓 + 独立业务子仓的完整本地协同工作区，不要求立即重构为多层 Worktree。
2. 保留 Wayfinder、Delivery Lead、Workitem Analyst、Engineer、Verify Agent 的专业职责。
3. 多台机器共用一个 Multica Workspace / Project，由统一协调入口选择有能力且空闲的 Squad。
4. 以 Multica 原生 Issue / Squad / Run / Runtime 为状态来源，以小型确定性脚本处理容量判断和指派。
5. 遵循 KISS：先做 `capacity=1`、单调度入口、定时对账，不引入新的数据库、分布式锁、全局 Workflow Runtime。
6. 在 Windows / Linux 混合环境中保留单 Project，由 Multica 原生 Project Resource 按 Daemon 解析不同绝对路径，而不是拆分平台 Project 或将路径写进共享 Instructions。

非目标：

- 不实现真正的 Nested Squad（Squad 包含 Squad）。
- 不自动迁移正在执行或有未持久化改动的 Issue 到另一台机器。
- 不在初版实现多机同一个 Issue 的协同写代码。
- 不修改 01–07、OpenSpec Schema、TFS Sync 机制、业务子仓及现有 Multica 配置。

## 2. Multica 原生能力与边界

| 能力 | 可复用机制 | 边界 |
| --- | --- | --- |
| 统一任务控制面 | Workspace / Project / Issue / Comment / Run | 不自动解决不同机器本地文件同步 |
| 小队路由 | Issue Assign to Squad → Squad Leader | Squad 本身不是 Runtime；不会广播执行给所有成员 |
| 机器执行 | Agent → Runtime → Daemon | Agent 的执行目标依赖绑定的 Runtime |
| 读取小队与成员 | `squad list/get/member list` | 没有原生统一的 Squad Busy/Idle 容量对象 |
| 读取 Issue 负载 | `issue list --assignee-id`（分页） | Issue 归属与 Run 是否正在运行是两件事 |
| 读取 Run / Runtime | `issue runs --active`、`runtime list` | 运行状态是瞬时快照，不是机器 Slot 原子预订 |
| 自动触发 | Assignment Trigger、Autopilot | 需验证实际部署版本的触发、定时频率与权限 |
| 父子任务 | Parent–Child Issues / Stage | 用于真实独立交付，不用于模拟 Squad 层级 |

官方源码/参考入口：

- [Multica Squad Reference](https://github.com/multica-ai/multica/blob/main/server/internal/service/builtin_skills/multica-platform/references/squads.md)
- [Multica Issues Reference](https://github.com/multica-ai/multica/blob/main/server/internal/service/builtin_skills/multica-platform/references/issues.md)
- [Multica Runtimes Reference](https://github.com/multica-ai/multica/blob/main/server/internal/service/builtin_skills/multica-platform/references/runtimes.md)
- [Multica Project Resources 官方说明](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/project-resources.mdx)
- [Multica Daemons and Runtimes 官方说明](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/daemon-runtimes.mdx)
- [Nested Squads 功能请求 #7509](https://github.com/multica-ai/multica/issues/7509)

**事实边界**：CLI/官方文档展示的是原生能力，不等于这些组合行为已经在当前部署版本完成 E2E；本方案中的机器容量、协调状态与调度策略均是项目级设计，不是 Multica 内置调度器。

## 3. 目标架构

```text
                    Multica Workspace / Project
                               │
TFS Sync → Wayfinder → eligible /note（写入并回读）
                               │
                      Squad Coordinator
                       /       |        \
                  Squad A   Squad B    Squad N
                     │         │          │
                  Daemon A  Daemon B   Daemon N
                  Machine A Machine B  Machine N
                     │         │          │
                  本地根仓  本地根仓    本地根仓
                  + 业务子仓 + 业务子仓  + 业务子仓
```

- **Wayfinder**：仅判断 `eligible | needs_human | unsupported`，负责证据持久化、来源版本核对及受控交接；不做机器资源调度。
- **Squad Coordinator Agent**：Squad 外、独立运行环境，负责接收 Eligible Issue、读取容量、选择 Squad、排队与异常对账；不做需求分析和代码开发。
- **Delivery Squad A/B/N**：每队在指定机器的 Daemon / Runtime 上完成本 Issue 的 Analysis → Human Review → Development → Verify → PR → Finalize；队内仍由 Delivery Lead 协调专业 Agent。
- **Multica**：Issue Owner、Status、Run、Comment 的事实来源；不复制其运行状态机。
- **Git**：跨机器代码与 OpenSpec 结果的最终集成渠道。机器本地未提交内容不会因 Multica Issue 状态变化自动同步。

首期约束：`1 Squad ↔ 1 Machine ↔ 1 Delivery Slot`。如果某机器已供其他任务使用、或同机还存在不受本调度器管理的写入活动，则不能声称 Slot 安全可用。


### 3.1 Cross-OS Project Resource（Windows / Linux 混合部署）

**结论：一个 Workspace、一个 Project，按 Daemon 分别绑定本机的 `local_directory`。** Project ID 不因操作系统不同而拆分；Squad 与 Agent 是 Workspace 级独立对象，各 Agent 绑定与本机 Daemon 对应的 Runtime。OS / 本地目录是执行环境属性，不是 Squad 名称或专业 Role Contract 的组成部分。

| 配置 | Windows：DS01 | Linux：DS02 |
| --- | --- | --- |
| Workspace / Project ID | 同一个 | 同一个 |
| Squad / Agent ID | 独立的 DS01 / 成员实例 | 独立的 DS02 / 成员实例 |
| Daemon / Runtime ID | Windows Daemon、Runtime | Linux Daemon、Runtime |
| Project `local_directory` | `D:\Projects\winning-platform-monorepo`（示例） | `/srv/projects/winning-platform-monorepo`（示例） |
| `execution_mode` | `in_place` | `in_place` |
| `AGENTS.md` / OpenSpec / Skills | 同一 Git 基线与共享 Workspace Skills | 同一 Git 基线与共享 Workspace Skills |
| 工作目录、CLI、凭据 | 本机独立 | 本机独立 |

**原生解析边界**：一个 Project 对同一 Daemon 最多绑定一条 Local Directory，但可对不同 Daemon 分别绑定。Agent Run 在有匹配绑定的 Daemon 上直接使用本地目录；**没有匹配绑定时，Multica 可能退回到 Project / Workspace Git Repository 的 Runtime-managed Checkout，而不是自动报错**。所以首期 Squad Dispatch 的 Ready Check 必须验证 Agent Runtime → Daemon → Project Resource → 实际工作目录映射，不能只根据 `Runtime Online` 假定执行位置正确。

#### 3.1.1 配置与回读（示例，非已执行命令）

两台机器均使用同一个 Multica Server / Workspace；目录须事先存在、可由对应 Daemon 读写，且不可选系统根目录、盘符根目录等禁止路径。通过本机 `daemon status --output json` 取得 **Daemon ID**，通过 `runtime list --output json` 取得 **Runtime ID**，两者不能混用。以下命令仅供 PoC，须替换真实 UUID、路径与 Workspace：

Windows PowerShell：

```powershell
multica daemon status --output json
multica runtime list --output json
multica project resource add <PROJECT_ID> `
  --type local_directory `
  --local-path "D:\Projects\winning-platform-monorepo" `
  --daemon-id <WINDOWS_DAEMON_ID> `
  --execution-mode in_place `
  --label "DS01-Windows"
```

Linux Bash：

```bash
multica daemon start             # 已运行时只检查状态，不重复启动
multica daemon status --output json
multica runtime list --output json
multica project resource add <PROJECT_ID> \
  --type local_directory \
  --local-path "/srv/projects/winning-platform-monorepo" \
  --daemon-id <LINUX_DAEMON_ID> \
  --execution-mode in_place \
  --label "DS02-Linux"
```

回读：

```bash
multica project resource list <PROJECT_ID> --output json
```

必须回读到相同 Project 下两条 `resource_type=local_directory`，`resource_ref.daemon_id` 不同且 `resource_ref.local_path` 符合对应 OS；`label` 仅用于识别，不参与 Daemon 路由。同一 Daemon 已有目录时应核对并使用 `project resource update`，**不要无条件重复 Add**。CLI 仅在已确认目标 Workspace / Project 后执行；本节不允许修改正式资源来做隔离验证。

#### 3.1.2 为什么首期选 `in_place`

根仓 `winning-platform-monorepo` 管理 `openspec/`、文档和知识库；其内部业务目录包含多个**独立 Git 仓库（非 Submodule）**。首期为了完整复用这棵本地工作区，两台机器均采用 `local_directory + in_place`：

- 同一台 Daemon 上，指向同一真实目录的 Run 按 Multica 原生锁串行执行；后到者可能进入 `waiting_local_directory`。这不是跨机器锁：Windows 和 Linux 的不同物理目录可以同时运行。
- `in_place` 不会自动切换分支、提交或推送；Agent 会直接看到该机器现有分支与未提交内容。进入新 Delivery 前必须验证工作目录无其他 Issue 遗留写入或分支冲突。
- `worktree` 是后续优化选项，但仅对受管的 Git 根仓创建 Worktree；根仓忽略的独立业务子仓不会因创建根仓 Worktree 而自动变成完整工作区。未设计子仓准备与隔离机制前，不作为本方案首期配置。
- 即使两机器共享 Project，未提交文件也不会自动同步；根仓 OpenSpec 批准基线、业务子仓提交和独立 PR 的跨机器交换仍遵循现行 Git 交付规则。

#### 3.1.3 OS Capability 与方法复用

`Squad Coordinator` 只判断目标 Squad 的已登记执行能力及 Runtime 是否可用；不直接为其他机器解析或创建目录。若 Issue 明确依赖 Windows-only / Linux-only 工具，作为 **Capability Filter（能力过滤）** 排除不匹配的小队。若仓库操作跨平台，则 Windows 与 Linux 都可作为候选。

Agent Instructions、Squad Instructions 和 Workspace Skills 仍保持共享 Role / Method Contract；不要为操作系统复制成两套长期维护的 Skill。脚本优先使用 `python3` 兼容的 Python / `pathlib`、项目标准构建命令；存在 Bash / PowerShell 分支时由本机执行环境选择。路径分隔符、大小写、换行符（`.gitattributes`）、可执行权限及 JDK / Maven / Node / Flink / AI Coding CLI 版本需要分别检查。

首次部署不得只凭 Server 返回 Online 就认定成功；需要在两台机器各自真实 Agent Run 中回读 `cwd`、`AGENTS.md`、`openspec/`、至少一个独立业务子仓、Git Commit、Daemon / Runtime ID 与工具链版本，确保运行在**预期的本地根仓**。如果解析到了托管 Checkout、错误 Daemon 或路径不可写，应按 `UNKNOWN` / Not Ready 拒绝调度，不允许静默继续编码。


## 4. 自动入口与手动入口

### 4.1 自动 TFS 入口（拟议变更）

现行基线是 `TFS Sync → Wayfinder eligible → Delivery Squad`。**只有在启用本候选方案时**，才将 eligible 后的交接目标替换为 Coordinator：

```text
TFS Sync → Wayfinder
  ├─ eligible      → todo + Squad Coordinator → Dispatch
  │                  ├─ 有空闲且匹配的 Squad → todo + 目标 Squad（自动启动 Leader）
  │                  └─ 暂无容量 → todo + Coordinator（待分配）
  ├─ needs_human   → blocked + Wayfinder（现行人工恢复机制）
  └─ unsupported   → unsupported（现行闭环，不改）
```

`eligible` 只保证符合交付准入，不保证立即拥有机器容量。“自动进入调度队列”不等于“立即启动 Delivery Lead”。

Wayfinder 在 Comment / Decision / TFS 来源有效性均已回读后，一次操作交给 Coordinator：

```bash
multica issue update <issue-id> \
  --status todo \
  --assignee-id <coordinator-agent-uuid>
```

Coordinator 选中目标 Squad 后，同样使用一次 Update，不带 `--no-start`，保持现行“Owner + Status 单次更新自动唤醒”思路。

### 4.2 待分配表示与运行副作用

候选队列态：`status=todo; assignee=Squad Coordinator`。该状态应表示“可以交付但尚未派给真实执行 Squad”，**不代表 Coordinator Run 必须持续运行**。

注意：Multica 的 Agent 可以在 Run 中修改 Issue Status，且失败任务可能产生服务端状态副作用。必须在 PoC 中验证 Coordinator 处理 `WAIT` 后能稳定保留/恢复该队列态、不会出现循环启动、错误转为 `in_progress` 或重复通知。若不满足，再评估使用 `backlog + Coordinator` 停放并通过扫描激活；此为可选退路，不能在验证前认定可用。

### 4.3 直接人工指派

现行主方案允许明确的 Direct Assignment 绕过 Wayfinder。此能力在候选方案中不自动废止。为避免绕过容量约束，首期多机器 Pilot 建议**人工直接指派前检查目标机器 Slot**；未经受控检查的直接指派不受 Coordinator 容量保障，需在运行规程中明确。

## 5. 小队繁忙程度：定义而非猜测

`Runtime Online`、`Runtime Running`、`Squad Occupied` 是不同维度。

| 维度 | 定义 | 来源 |
| --- | --- | --- |
| Ready | Squad、Leader、必要 Specialist Agent 可用；对应 Runtime / Daemon 在线，且 Project Resource 能解析到预期本机目录 | Squad / Agent / Runtime / Project Resource |
| Capable | 本次 Issue 的目标 Repository、必要工具、OS（如有硬约束）和执行权限可由该机器覆盖 | Wayfinder Evidence + Repo Registry + 配置 |
| Occupied | 小队已经持有尚未释放的顶层 Delivery Issue | Issue Owner + Status + Run 检查 |
| Available | `enabled && Ready && Capable && Occupied < capacity` | 确定性聚合 |

首期 `capacity=1`，**占用从接单开始，到交付终态且确认安全释放本地工作区为止**。以下状态默认占用：

- `todo + Delivery Squad`
- `in_progress`
- `analysis_review`（自定义分析审核）
- `blocked`（可能需要恢复/返工）
- `in_review`（PR 等待审核或合并）

`done`、`cancelled` 等终态只有在无活跃 Run、必要代码/Artifact 已持久化、工作区安全时才释放；`unsupported` 不占用正常 Delivery Slot。

统计时**仅计顶层 Delivery Issue**。一个 Delivery 下的多个 Engineer / Sub-Issue / Run 不重复消耗机器 Slot。若子 Issue 跨机器独立交付，则应升级容量规则，不在初版强行支持。

**严格限制**：读取到的 Run / Issue 数据只是快照。分页不完整、Runtime 状态不明确、Owner/父子关系冲突时返回 `UNKNOWN`，不能将“查不到”解释为“空闲”。

## 6. 目标选择策略

初版采用“硬过滤 + 确定性顺序”，不要 LLM 自主打分，也不根据过去的 Token 使用量猜测实时繁忙：

1. 过滤 `enabled=false`、Archived Squad、Archived/无绑定 Runtime 的必要 Agent、Daemon 离线。
2. 过滤 Repository / Capability（包括明确的 OS 限制）/ 权限不匹配的小队，要求该队所有必要 Agent Runtime 均对应正确 Daemon 且能映射到 Project Local Directory。
3. 过滤 `Occupied >= capacity` 的小队。
4. 多队可选时按 `least_recently_assigned`（最久未分配）或固定轮询；缺少历史时按配置顺序稳定回退。
5. 下发前回读目标 Issue Owner/Status/Triage 和目标 Squad Occupancy；变化则返回 `RETRY_LATER`，不强行指派。
6. 指派仅通过单次 `issue update --status todo --assignee-id <squad-id>`，不另外触发冗余 Run。

不按机器 CPU、预估代码量或 Agent 响应时间进行第一版权重评分；这些指标不能可靠替代实际交付资源占用。

### 6.1 配置示意（尚未创建真实文件）

```yaml
dispatch:
  capacity_model: exclusive_issue
  coordinator_max_concurrent_runs: 1
  retry_interval_minutes: 5  # 候选值，按当前版本 Autopilot 调度能力验证
  selection: least_recently_assigned

squads:
  - id: "<squad-a-uuid>"
    runtime_id: "<runtime-a-uuid>"
    daemon_id: "<windows-daemon-uuid>" # 必须与 Project local_directory 的 daemon_id 对齐
    platform: windows             # 项目级能力标签，非 Multica Squad 原生字段
    capacity: 1
    enabled: true
    repositories:
      - winning-dps-df-frame
      - winning-dps-df-frame-web

  - id: "<squad-b-uuid>"
    runtime_id: "<runtime-b-uuid>"
    daemon_id: "<linux-daemon-uuid>"
    platform: linux
    capacity: 1
    enabled: true
    repositories:
      - winning-dps-df-frame
      - winning-dps-df-dataintegration
```

真实能力应来自受控配置与 [Repo Registry](../../../../docs/config/repo-context.yaml) 等权威来源，不把业务仓库能力永久重复硬编码在多个 Agent Instructions 中。这里 `runtime_id` 是小队所属机器的定位线索，实际应检查 Leader 与需要执行任务的专业 Agent 的 Runtime 绑定，不假定 Squad 自己拥有单一 Runtime 字段。`daemon_id` 与 `platform` 也只是本方案的业务映射与能力标签，须与实际 Daemon、Project Resource 和 Agent Runtime 交叉核验；绝对路径由 Multica Project Resource 管理，不写入本调度配置。

### 6.2 调度伪代码（契约，不是已实现脚本）

```python
def dispatch(issue_id):
    issue = multica.get_issue(issue_id)
    if issue.assignee_id != COORDINATOR_ID or issue.status != "todo":
        return "SKIP"
    if not valid_current_eligible_decision(issue):
        return "STOP"

    candidates = []
    for squad in configured_squads:
        if not squad.enabled or not capabilities_match(issue, squad):
            continue
        if not all_required_runtimes_online(squad):
            continue
        occupancy = list_occupied_top_level_deliveries(squad)
        if occupancy.is_unknown:
            return "UNKNOWN"
        if occupancy.count < squad.capacity:
            candidates.append(squad)

    if not candidates:
        return "WAIT"

    target = least_recently_assigned(candidates)

    # 临近写入重新核验；普通读取不是原子 Slot Reservation。
    if not still_dispatchable(issue_id, target):
        return "RETRY_LATER"

    # 最后的关键副作用；可能取消本 Coordinator Issue Run。
    multica.issue_update(
        issue_id, status="todo", assignee_id=target.id
    )
    return "ASSIGNMENT_REQUESTED"
```

`ASSIGNMENT_REQUESTED` 不等于 Lead Run 成功；下一次对账必须确认 Owner / Status / Run 事实。超时或返回未知先回读，不盲目重复调用。

## 7. Agent / Skill / Script 责任边界

### 7.1 Squad Coordinator Agent

**Description**：负责多个 Delivery Squad 之间的容量感知、Issue 分配、跨队协作协调与异常恢复；不介入单个 Delivery Issue 内部的 Analysis、开发、Verify 或 PR 审核。

**Instructions（精简契约）**：

- 输入：Squad Coordinator 持有的 Issue、当前有效 Wayfinder Decision、Squad 配置、Issue/Run/Runtime 事实。
- 流程：核实准入 → 调用 `squad-dispatch` → 根据 `ASSIGN | WAIT | UNKNOWN | STOP` 处理 → 记录必要结果。
- `ASSIGN`：使用受控脚本执行 Owner/Status 单次更新，完成当前 Run；不能修改目标 Squad 的专业工作。
- `WAIT`：保持待分配队列，不设置 `blocked` / `unsupported`。
- `UNKNOWN`：先回读，必要时向 Human 报告；禁止双重指派。
- `STOP`：证据失效、权限不足、Owner 已变化时停止写操作。

### 7.2 `squad-dispatch` Skill（拟建）

拟议组织形式，仅用于未来实施，不在本次创建：

```text
skills/squad-dispatch/
  SKILL.md
  config/squad-coordinator.yaml
  scripts/dispatch.py
```

- `SKILL.md`：何时调用、输入/输出、执行顺序、异常处理，不堆历史和设计说明。
- `dispatch.py`：分页读取、聚合 Occupancy、验证 Runtime、按规则选择、条件检查、最终指派及结果分类。
- 配置：Squad UUID、Runtime 绑定/机器归属、容量、启停与覆盖 Repository。
- 输出：`ASSIGN | WAIT | UNKNOWN | STOP | SKIP`、目标 Squad ID、证据摘要和对账信息。
- Agent 不直接用自然语言猜测“哪个小队比较闲”。

### 7.3 Coordinator Runtime

Coordinator 应运行在独立控制节点，或者至少不与业务 Squad 共享有独占锁的 `in_place` 目录。它只需要 Multica 控制面及配置读取能力，无需完整业务仓库。

## 8. 触发、队列与跨小队协调

### 8.1 调度触发

- **新 Issue**：Wayfinder eligible 后的 Assignment Trigger 激活 Coordinator。
- **待分配队列**：候选定时 Autopilot（如每 5 分钟，频率和 `run_only` 实际支持需在当前版本验证）扫描 `todo + Coordinator` 事项并进行顺序尝试。
- **队列为空或全忙**：本轮正常结束，不重复写 Comment 或额外创建 Delivery Issue。

`coordinator_max_concurrent_runs=1` 仅约束 Coordinator 自身 Run 并发，**不等于跨入口原子机器资源锁**。首期约定 Coordinator 为唯一自动分配者；人工 Direct Assignment 按受控 SOP 处理。

### 8.2 跨 Squad 同步

- 任务进度和责任归属：依托 Multica Server 的 Issue / Comment / Run。
- 临时协助：通过 `@Squad` 通知对方 Leader；不改变当前 Issue Owner。
- 多个独立交付成果：必要时使用 Parent–Child Issues / Stage；不要为了模拟 Nested Squad 无条件拆子任务。
- 代码与 OpenSpec 变更：各机器使用独立 Git Branch / PR，保持根仓和业务子仓的 Git 边界；不直接在多机器间复制未提交文件。
- Agent / Skill 一致性：以 Git/Workspace 统一版本为源，机器仅有必要的 Runtime 和本地路径差异；禁止各小队长期分叉维护方法定义。

## 9. 异常与安全边界

| 场景 | 处理原则 |
| --- | --- |
| 全部 Squad 繁忙 | `WAIT`，Issue 留在待分配队列 |
| 某 Runtime 离线、必要成员不可用 | 该小队不可选；不得将 offline 当空闲 |
| 跨 OS Daemon 未绑定本 Project Local Directory，或回读执行路径错误 | 不接受退回 Runtime-managed Checkout；按 Not Ready / UNKNOWN 排除该 Squad |
| Issue 要求 OS 专用工具但候选 Squad 不匹配 | 按 Capability 过滤，全部不匹配则 WAIT / STOP 由准入证据决定，不跨平台强行执行 |
| Git 大小写、换行符、执行权限或脚本兼容性异常 | 停止有副作用操作、保留证据，在对应 OS 修复后重新验证 |
| Issue 已由其他 Squad 持有 | `SKIP`，不抢占 Owner |
| 刚分配后 Coordinator Run 被取消 | 预期可能发生；使用独立后续对账判定结果 |
| CLI Timeout 或状态不明 | 查询 Owner/Status/Run；无法证明则 `UNKNOWN` |
| 候选仓库/权限不可确认 | `STOP` 或 `UNKNOWN`，不擅自扩大执行范围 |
| 人工审核、PR 等待期间 | 默认仍占用 Slot，第一版不提前释放 |
| 工作区仍有未提交修改 | 不释放 Slot、不迁移到另一机器 |
| TFS 来源已发生实质变更 | 复用现行来源版本复核，不因之前 eligible 直接强行派工 |
| 多台机器各自修改同一文件 | 本地互不覆盖；通过 Git PR Integration 检查真实冲突 |

安全性约束：CLI 读取是瞬时快照，不提供 `compare-and-swap` 容量预订。第一版依赖单 Coordinator 自动入口及一机一 Slot 的操作规范；**如果未来开放多个并发调度器或允许大量绕过入口，必须另行设计原子 Slot Claim，不应宣称本方案满足强并发 exactly-once。**

## 10. PoC 设计与验收标准

前置：两台机器（可分别为 Windows / Linux）、各自独立的根仓/业务子仓、同一 Workspace/Project、两个独立 Delivery Squad、各自完整专业 Agent Runtime，另设 Coordinator Runtime；每台 Daemon 为该 Project 绑定自己的 Local Directory。Linux 与 Windows 的目录写权限、命令解释器和工具链分别核验。

| Case | 场景 | PASS 条件 |
| --- | --- | --- |
| C01 | A/B 均空闲，连续两个 eligible Issue | 分别分配且两个 Squad 可同时执行 |
| C02 | A 忙、B 空闲 | 新 Issue 仅分配 B |
| C03 | 两队都忙 | Issue 保持待分配、不错误设 blocked/unsupported |
| C04 | A 释放 Slot | 后续扫描自动将队列 Issue 分配给 A |
| C05 | B Runtime 离线 | B 不被选中，恢复在线后才可再次选择 |
| C06 | 重复触发 Coordinator / 超时重试 | 最终 Owner 唯一，不产生重复交付启动 |
| C07 | `analysis_review` / `in_review` / `blocked` | 仍算占用，直到显式满足释放条件 |
| C08 | 两机器同仓不同分支 | Git 本地隔离，PR 合并冲突可被识别 |
| C09 | Wayfinder 来源变化、旧 Decision | 不使用失效 eligible 继续指派 |
| C10 | Coordinator `WAIT` 运行结束 | 验证队列 Status 与下次扫描行为，无意外循环 Run |
| C11 | 直接指派绕过 Coordinator | 标识为受控例外；不得误计容量 |
| C12 | Issue 列表分页或 Runtime 数据读取异常 | `UNKNOWN`，不把查询失败当成空闲 |
| C13 / S10 | Windows + Linux 共享 Project，两个 Daemon 各自绑定 Local Directory | 同 Project 回读两条不同 Daemon 资源，两侧 Agent 分别在本机根仓读取 `AGENTS.md` / OpenSpec / 子仓，并可同时运行 |
| C14 | 某 Daemon 缺少 Project Local Directory 或映射错误 | 不误用 Git Checkout 或另一台机器目录；调度返回 Not Ready / UNKNOWN |
| C15 | 跨 OS 工具链与 Git 兼容性 | 两端脚本可执行、大小写/换行符/权限符合仓库要求，OS-only 任务准确过滤 |

验收记录必须区分 `PASS / FAIL / NOT_RUN`，不能把官方机制描述等同于项目 E2E PASS。

## 11. 实施顺序（未来，不属于本次工作）

1. 验证 Windows / Linux（或相同 OS 的不同机器）Daemon / Runtime / Project Local Directory 隔离；同一 Project 对每个 Daemon 绑定正确绝对路径，两队真实业务代码目录互不共享。
2. 验证独立 Squad 指派可以由 Multica 正常触发对应 Leader。
3. 用 CLI 手工汇总每队的顶层 Issue + Runtime，建立 `capacity=1` 的计算口径。
4. 验证 `todo + Coordinator` 的 Run 和 Status 副作用，确定 WAIT 队列表示。
5. 最小化实现 `squad-dispatch`；只支持确定性硬过滤和稳定选择。
6. 配置候选周期 Autopilot；执行 C01–C15 场景，含 Cross-OS 资源解析、无匹配目录时阻断和 OS Capability。
7. 形成对 01–07 的变更影响评估，经用户批准后才考虑合入正式设计。

## 12. 与现有 01–07 的关系

**本次仅保存候选方案，不实施、不接线、不改现有事实或文档。**

- 01：上位设计规范保持不变。
- 02：当前仍由 Wayfinder eligible 直接交给 Delivery Squad，候选的 Coordinator 转接未生效。
- 03/04/05：Analysis / Development / OpenSpec 现行契约保持不变。
- 06：不新增实际 Skill 或脚本。
- 07：不重排现行实施计划或改验收结论。

未来若本方案通过 PoC，再分别评审：Wayfinder 交接目标、Squad Machine / Capacity 契约、Cross-OS Project Resource 映射与 OS Capability、Coordinator Agent / Skill、定时调度、直接指派例外以及跨机 OpenSpec/Git 集成要求。

---

**设计结论**：首期采用“一个 Workspace / Project + 一个 Wayfinder + 一个独立 Squad Coordinator + N 个固定机器的 Delivery Squad”；通过 Multica 原生控制面读取负载，以 `capacity=1` 与确定性脚本完成分配。保留现有专业流程，并将真正的跨机事务/故障迁移留给后续实际需求。