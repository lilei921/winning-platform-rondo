# Multica 多成员工作区与 TFS 同步方案对比评审（A / B）

> 状态：独立设计方案（待实现与 PoC 验证）  
> 编写日期：2026-10-27  
> 范围：方案 A（单 Workspace、多 Project、一个 TFS Sync）与方案 B（每人一个 Workspace、一个 Project、独立 TFS Sync）；同一服务器、独立 in_place 目录  
> 设计基线：`01–07` 方案及现有 `projects/multica/`、`tools/skill-flow/`、`tools/tfs-cli/`  
> 评审状态：**双方案待决**。本文为设计、实现与团队评审材料，**不代表当前代码已实现或机制已验收**；不覆盖 01–07 原方案，也不修改生产部署。


## 评审总览

### 两种备选方案

| 维度 | 方案 A：单 Workspace + 多 Project | 方案 B：每人一个 Workspace |
| --- | --- | --- |
| 组织模型 | 一个团队 Workspace，成员分别拥有独立 Project | 每位成员一个 Workspace，内部一个业务 Project |
| Squad / Agent / Skill | Workspace 内同一套平台对象 | 各 Workspace 是不同平台对象，**共用仓库配置源文件**并通过 `provision/sync` 同步 |
| TFS Sync | **仅一个** `run_only`，不绑定任何成员业务 Project | **每 Workspace 一个** `run_only`，建议绑定本 Workspace 业务 Project |
| WIQL 身份 | 服务账号 PAT 查团队范围，按 `AssignedTo` 分发 | 每成员 PAT 查询 `AssignedTo = @me` |
| 新 Issue 归属 | 根据确定性成员 → Project 映射 | 同步到当前 Workspace 的唯一业务 Project |
| 认证边界 | 统一查询 PAT + Project 研发 PAT | Workspace/Project 成员 PAT；各自负责查询与研发 |
| 本地代码 | 每个 Project 一个真实目录，使用 `in_place` | 每个 Workspace 对应的 Project 一个真实目录，使用 `in_place` |
| 本地并发 | 不同物理目录并行，同一目录串行 | 不同物理目录并行，同一目录串行 |
| TFS 改派 | 同一 Workspace 内可发现跨 Project 同源记录，报告冲突；本期不迁移 | 跨 Workspace 缺少天然全局去重，旧 Issue 易滞留或产生重复 |
| 团队可见性 | 同 Workspace 的 Issue / 交付状态便于汇总 | 需要跨 Workspace 汇总，并考虑访问权限 |
| 自定义实施 | 团队 WIQL、身份映射、跨 Project 幂等、多 Project provision、Project PAT | Workspace 级部署/配置发布、成员 PAT 显式选择、Autopilot Project 绑定 |
| 平台对象规模 | 较少 | 与成员数量线性增长 |
| 主要风险 | 统一路由准确性、改派和跨 Project 历史数据 | 独立 Workspace 资产漂移、跨 Workspace TFS 改派与重复 |

### 共同前提（两方案均需满足）

1. 所有成员项目在**同一台服务器**上运行，`skill-flow`、`tfs-cli`、Multica Daemon 及基础 Runtime 可共用，但应验证 Daemon 对多个 Workspace 的授权与 Runtime 注册行为。
2. 成员目录是**独立真实 Git 工作副本**。不同 Project/Workspace ID 若指向相同真实目录，不能实现目录隔离。
3. 同一业务 Git Remote、共享知识库/研发规范不等于共享物理工作副本；远端 PR 合并冲突不会被本地 `in_place` 自动消除。
4. `in_place` 的锁作用于真实目录，跨目录并发仍受 Daemon、Agent、系统资源限制。必须在实际部署版本验证，而不只根据文档推断。
5. TFS PAT 不可进入 Git、Workspace Skill File、Issue Metadata、Agent Prompt、命令行参数或日志；缺凭据时停止，**不能回退为其他成员身份**。
6. 继续使用现阶段 `backlog + Delivery Squad` 的同步入口；Wayfinder、Verify 仍按原实施节奏，不因方案比较扩展本期范围。
7. 现有 `skill-flow workspace provision/sync` 是复用资产的基础，但**配置在源文件共享**与**平台对象真实共享**必须区分。

### Multica CLI Workspace 选择与并发安全（方案 A/B 共用）

**结论**：同一服务器上的多个进程可以共用已安装的 `multica` CLI；Workspace 是单条命令的显式目标，不需要为每个 Workspace 安装另一套 CLI。此处解决的是 **Multica API 操作对象隔离**，不等于 TFS PAT、文件系统或操作系统身份隔离。

按 Multica 官方 CLI `resolveWorkspaceID`，Workspace 选择优先级为：

1. 当前命令的 `--workspace-id <uuid>`；
2. 该进程的 `MULTICA_WORKSPACE_ID` 环境变量；
3. 人工 CLI 当前 Profile 中保存的默认 Workspace。

在 Daemon 管理的 Agent 执行上下文中，**没有用户 Profile 默认 Workspace 的兜底**：缺少显式参数和 Daemon 注入的环境变量时，应报错。`--workspace-id` 只指定目标 Workspace，**不授予访问权限**；Agent Run 的任务级凭据不得被用来跨 Workspace 越权。

统一执行约束：

- **Workspace-scoped 自动化命令**（Issue / Agent / Skill / Project / Autopilot 等）一律显式提供 `--workspace-id`；`skill-flow workspace provision/sync --workspace <name>` 中的 `--workspace` 是仓库 overlay 名称，不是 Multica CLI 的 `--workspace-id`，脚本必须先解析真实 UUID。
- 不在 Agent、Skill、Autopilot 或并发脚本中执行 `multica workspace switch` 或 `multica config set workspace_id`。它们改变**共享 Profile 的默认 Workspace**，可能令另一条未显式传参的命令静默访问错误对象。`MULTICA_WORKSPACE_ID` 可用于**独立进程的环境**，不作为服务器级共享环境变量来回切换。
- 当前 `tools/skill-flow/src/clients/multica.ts` 的 `ws()` 在缺少 `cfg.workspace_id` 时返回空数组；`run(args)` 也仅透传参数，**不会自动追加 Workspace ID**。后续实现应要求 Workspace-scoped 操作缺失 ID 即 `UNKNOWN`，并逐个核对直接调用 `run()` / `runJson()` 的入口都有显式 Workspace ID。
- 共享 Daemon 可监听多个**已授权** Workspace，在每个被监视的 Workspace 注册自己的 Runtime；这并不要求为每个 Workspace 额外启动一个 Daemon。若不同成员需要独立 CLI 登录身份、隔离 Token 或配置目录，应选择不同 `--profile` / OS 身份并评估是否使用独立 Daemon；`--workspace-id` 不是认证隔离机制。
- 每个 Project 的 `local_directory + in_place` 仍必须指向互不重叠的真实目录；多个 CLI 查询虽然能并行，**同机共享的配置文件写入、`workspace sync` 渲染和凭据文件**仍需自己的隔离/串行规则。

Windows PowerShell 示例（不同进程可同时执行，无须修改默认 Workspace）：

```powershell
multica issue list --workspace-id "<workspace-a-uuid>" --output json
multica issue list --workspace-id "<workspace-b-uuid>" --output json
```

安全性要求：任何脚本不得因为 `workspace_id` 缺失而退回默认 Profile、默认 Project 或另一个成员的 Workspace；权限不足、目标不存在和 Workspace ID 不一致，都应停止写入并显式报告。

权威依据：
- [Multica CLI and Agent Daemon Guide — Working with multiple workspaces](https://github.com/multica-ai/multica/blob/main/CLI_AND_DAEMON.md#working-with-multiple-workspaces)
- [Multica CLI `resolveWorkspaceID` 实现](https://github.com/multica-ai/multica/blob/main/server/cmd/multica/cmd_agent.go)
- [仓内 `MulticaClient` 当前实现](../../../../tools/skill-flow/src/clients/multica.ts)

### 评审决策状态

**未决：A / B 均为候选方案。** 本文保留 A 的完整设计与实现清单，新增 B 的完整设计与验证安排；选择依据见后文“团队联合评审与决策记录”。

如果团队明确要求 **一个 TFS Sync Autopilot / Run 覆盖所有成员**，A 是直接匹配该约束的方案；B 的天然模型为各 Workspace 独立同步。若 B 也强制“只有一个全局 Sync”，必须另建 Workspace 外服务或跨 Workspace 授权调度，本次**不把该变体算作 B 的简单实现**。

## 方案 A：单 Workspace、统一 TFS Sync、多 Project
### A0. 架构定义与设计边界

若团队选择方案 A，采用如下架构：

1. **一个 Multica Workspace**，复用一套 Delivery Squad、Agent、Skill 与安装于同一服务器的 `skill-flow`/`tfs-cli`。
2. **只有一个 TFS Sync Autopilot（`run_only`）**，不绑定任何成员业务 Project；它使用服务器级统一 PAT，按团队范围 WIQL 拉取 TFS Work Item。
3. **由确定性代码读取 TFS `AssignedTo` 并映射目标 Multica Project**；Issue 创建在对应 Project，而不是创建后再依赖 Agent 移动。
4. **每位成员一个 Multica Project 与独立真实 Git 工作副本**，Project Resource 采用该服务器的 `local_directory + in_place`。
5. **研发交付阶段使用 Project 级独立 PAT**，由 Issue 的 `project_id` 定位 Project Resource，再加载该 Project 本地私有凭据。不得因凭据缺失退回服务器统一 PAT。
6. **跨 Project 可并行；同一真实目录内重量级 Run 串行**（受 Multica 实际锁语义、Agent 和 Runtime 并发限制约束）。
7. **新增 TFS Work Item 分发；已有 Issue 不自动跨 Project 迁移**，避免破坏运行中交付事实、OpenSpec、PR 与历史。
8. 本期保留现有同步的 `backlog + Delivery Squad` 停放语义；**不在本专项引入 Wayfinder / Verify 的实现或改造**。

方案 A 用 Project 解决运行边界、目录冲突和 TFS 身份归属；保留共享 Workspace 内的单个 Squad/Agent/Skill/TFS Sync，而不是为每人复制平台对象。

方案 A 的所有 Workspace-scoped CLI 操作同样遵守前文通用 `--workspace-id` 规则；`--project` 是业务 Project 选择，**不能代替 Workspace ID**。

### A1. 背景、目标与非目标

#### A1.1 当前限制（以 2026-10-27 仓库 `main` 为准）

- `sync-config.base.json` 使用 `[System.AssignedTo] = @me`，`@me` 绑定当前 PAT 的 TFS 身份，无法作为团队统一同步入口。
- `tfs-cli/src/commands/query.ts` 虽然在 WIQL 中可查询 `System.AssignedTo`，但返回的 Work Item JSON **没有 `assignedTo` 字段**。
- `reconcile-workitem.ts` 以固定 `multica.project` 查询/创建 Issue，无法按 TFS 负责人路由。
- `workspace/sync.ts` 把 `overlay.project` 渲染到共享 `tfs-sync/config/sync-config.json`，与多 Project 共享 Skill 冲突。
- `workspace/provision.ts` 的 `manifest.project` / `overlay.project` 是单 Project 结构。
- `tfs-cli/src/config.ts` 的 PAT 读取优先级为 `process.env.TFS_PAT || file.token`；同一服务器设置统一 PAT 后，Project 本地 `token` 会被覆盖。
- `reconcile-workitem.ts` 当前超出 `max_items_per_run=50` 后直接取前 50 项；扩大到团队范围可能长期遗漏排在后面的 Work Item。
- 交付链中还有 TFS Task、PR、Finalize 等多个 CLI 调用点；仅改 TFS Sync 不能实现 Project 级 PAT 隔离。

#### A1.2 目标

- 一次定时查询覆盖 TFS 团队成员，按负责人确定性路由到各自 Project。
- 复用 Workspace 级资产及现有 OpenSpec 研发闭环，不复制配置对象。
- 一台 Daemon 服务多个不同本地目录，跨目录并发而不相互污染。
- TFS 查询 PAT 与研发写操作 PAT 职责清晰；明文凭据不进入 Git、Skill Files、Issue Metadata、Agent Prompt 或命令行参数。
- 同步幂等、可恢复，能识别 TFS 改派、缺少成员映射、身份歧义及旧 Issue。
- 最小侵入现有方案；先 PoC，再发布生产配置。

#### A1.3 非目标

- 不实现跨 Project 自动迁移正在交付的 Issue。
- 不修改 01–07 的通用阶段模型，不同步引入 Wayfinder/Verify。
- 不开发中心任务调度器，不依赖 Agent 进行 `AssignedTo` 语义猜测。
- 不把多个 Project 放在同一个真实 `local_directory` 并指望 Project ID 自动隔离文件。
- 不宣称 Project 级 PAT 是操作系统级安全沙箱；同 Daemon 账号可读取的其他本地目录仍需额外文件权限保护。

### A2. 目标架构和运行边界

```text
Multica Workspace
├─ 共享 Delivery Squad / Lead / Analyst / Engineer / Skills
├─ TFS Sync Autopilot (1 个，run_only，无业务 Project 绑定)
│   └─ TFS Sync Agent → tfs-sync → skill-flow tfs reconcile-workitem
│       ├─ TFS 服务账号 PAT（服务器级）
│       ├─ 团队 WIQL / TFS AssignedTo
│       └─ Workspace Project Routing（确定性映射）
│           ├─ AssignedTo A → Project A → Issue A
│           ├─ AssignedTo B → Project B → Issue B
│           └─ AssignedTo C → Project C → Issue C
└─ Delivery Squad 处理各 Project 内的 Issue
    ├─ Project A → local_directory A (in_place) → 独立 Git / PAT-A
    ├─ Project B → local_directory B (in_place) → 独立 Git / PAT-B
    └─ Project C → local_directory C (in_place) → 独立 Git / PAT-C

同一 Server / Multica Daemon / 已安装的 CLI 工具
```

| 对象 | 级别 | 是否共享 | 说明 |
| --- | --- | --- | --- |
| `TFS Sync Autopilot` | Workspace | 1 个 | `run_only`；不绑定成员业务 Project |
| `TFS Sync Agent` / `tfs-sync` | Workspace | 共享 | Thin Adapter，业务路由放在确定性脚本 |
| `Delivery Squad` / Engineer | Workspace | 共享 | 仍受 Agent、Daemon 实际并发上限限制 |
| `Multica Project` / Issue | Project | 每人独立 | TFS 负责人决定新 Issue 落点 |
| `local_directory` / Git 工作副本 | Project + Daemon | 不共享真实目录 | 每 Project 唯一物理路径，`in_place` |
| TFS Sync PAT | Server/Service | 统一 | 只供 Workspace 级 TFS 查询 |
| Delivery PAT | Project 本地 | 不共享 | 处理该 Project 的 TFS Task、PR、状态回写 |
| `repo-registry.json` | Workspace Skill 文件 | 共享 | 运行时由 Issue/project 解析实际根仓目录 |
| `sync-config.json` | Workspace Skill 文件 | 共享 | 保存查询范围、路由映射，不包含 PAT |

**Multica 行为依据**：`local_directory + in_place` 对同一真实目录的重量级运行采用串行等待；不同真实目录不会因为该目录锁相互阻塞。无 Project 绑定的 `run_only` 不继承成员业务 Project 的本地目录，运行依赖 Daemon 分配的工作目录。应在当前安装的 Multica 版本上做 E2E 验证，不能只凭设计推定。
- https://multica.ai/docs/project-resources
- https://multica.ai/docs/autopilots
- https://github.com/multica-ai/multica/pull/7553

### A3. 配置契约：一个共享源，多个成员映射

#### A3.1 建议的配置分层

保留现有 `_shared` 渲染路径，不直接手改生成的 `config/sync-config.json`：

| 配置层 | 目标结构 | 责任 | 是否含秘密 |
| --- | --- | --- | --- |
| `workspace-skills/_shared/provisioning.json` | `projects[]`（后续扩展） | Project 逻辑键及标题；继续管理共享 Agent/Squad/Autopilot | 否 |
| `workspace-skills/_shared/workspaces/<workspace>.json` | `projects: {key: projectId}`（由 provision 生成） | 当前 Workspace 下逻辑 Project 到真实 ID 的映射 | 否 |
| `workspace-skills/_shared/sync-config.base.json` | `tfs.query_command` + `routing.assigned_to_project` | TFS 团队范围、稳定身份到逻辑 Project Key 的分配 | 否 |
| 生成的 `tfs-sync/config/sync-config.json` | 合并 Workspace ID、`routing`、Project IDs | Sync 运行输入，上传为 Workspace Skill File | 否 |
| 成员仓 `.local/tfs.config.json` | `token` / `url` / `collection` | 研发阶段 TFS 凭据，**仅保留在服务器本地** | **是** |

示意（`sync-config.base.json` 中关键字段；真实 WIQL 和身份待验证）：

```json
{
  "tfs": {
    "query_command": [
      "tfs-cli",
      "query",
      "--wiql",
      "SELECT [System.Id], [System.WorkItemType], [System.Title], [System.AssignedTo], [System.State], [System.ChangedDate] FROM WorkItems WHERE [System.WorkItemType] <> '' AND [System.State] <> '已验证' AND [System.State] <> '已关闭' AND [System.AssignedTo] IN GROUP '[TEAM]\\Developers' ORDER BY [System.Id]"
    ]
  },
  "routing": {
    "assigned_to_project": {
      "DOMAIN\\zhangsan": "member-a",
      "DOMAIN\\lisi": "member-b"
    }
  },
  "multica": {
    "cli": "multica",
    "squad": "Delivery Squad",
    "initial_status": "backlog"
  },
  "sync": {
    "managed_fields_only_on_existing": true,
    "batch_size": 50
  }
}
```

上例 `[TEAM]\Developers`、`DOMAIN\zhangsan` 都是**占位符**，不是当前 TFS 实例中已验证存在的组或账号。JSON 文件中的反斜杠必须按 JSON 转义。`batch_size` 是拟新增字段，不是当前已实现字段。

建议 `provisioning.json` 将现有单个 `project` 演进为：

```json
{
  "projects": [
    { "key": "member-a", "title": "Delivery - Member A" },
    { "key": "member-b", "title": "Delivery - Member B" }
  ]
}
```

对应 Workspace overlay 由 `provision` 自动生成：

```json
{
  "workspace_id": "<workspace-id>",
  "projects": {
    "member-a": "<project-a-id>",
    "member-b": "<project-b-id>"
  }
}
```

初期 PoC 可手工创建两个 Project 并提供一份受校验的 ID 映射，**但不能将手工映射与 provision 的生成映射长期并列维护**。长期权威来源分别是：`provisioning.projects`（有哪些 Project）、`routing.assigned_to_project`（哪个 TFS 身份投递到哪个 Project）；`overlay.projects` 只是平台 ID 投影。

#### A3.2 WIQL 的最小语义变化

**仅扩大 `AssignedTo` 范围，其余 WorkItemType / State 筛选口径沿用当前生效配置，另行评审后才调整。**

- 原：`[System.AssignedTo] = @me`（解析为服务器统一 PAT 所属账号）。
- 首选：`[System.AssignedTo] IN GROUP '<已验证的团队或安全组>'`。
- 回退：若当前 TFS 2018 实例、SDK 或组织组配置不支持稳定的 `IN GROUP` 查询，则由配置中的成员身份生成显式 `OR` 条件；不让 LLM 拼接。
- 如成员跨多个 TFS Team Project，需确认 `queryByWiql` 使用的 `teamContext`、`TFS_PROJECT` 默认值与权限范围；必要时按 TFS Team Project 查询后归并。单个 TFS Collection 内 `System.Id` 通常唯一，不同 Collection 必须纳入来源标识。
- 服务账号须具有查询全部目标成员 Work Item 的权限；查询失败是 `UNKNOWN`，不得假定“没有任务”。

参考：https://learn.microsoft.com/zh-cn/azure/devops/boards/queries/query-by-workflow-changes?view=azure-devops

#### A3.3 TFS Identity 契约

`tfs-cli query` 需显式返回可路由的身份，建议新增：

```json
{
  "id": 123456,
  "assignedTo": {
    "displayName": "张三",
    "uniqueName": "DOMAIN\\zhangsan"
  }
}
```

这是**目标契约示意**。先用当前 TFS 2018 SDK 实测 `System.AssignedTo` 的实际形态（string / IdentityRef / 其他），再决定字段解析；必须保留现有 `id/type/title/url/state/changedDate/project` 等消费者字段。以稳定 `uniqueName` / 唯一账号标识匹配，不能只依赖可能重名的 `displayName`。

配置加载时做一次确定性校验：成员身份不可重复；各逻辑 Project Key 必须能映射到唯一有效 Project ID；Project 属于当前 Workspace；Project Resource 对当前 Daemon 可定位。不满足则**在产生写入前**明确返回 `UNKNOWN`。

#### A3.4 PAT 分层与安全边界

**Sync 模式**：`TFS Sync Autopilot` 使用服务器运行环境的 `TFS_PAT`（统一服务账号），用于查询团队，不因目标 Issue Project 改写。

**Delivery 模式**：每个 Project 根仓下单独存放 `.local/tfs.config.json`，例如：

```json
{
  "url": "http://tfs.example.local:8080/tfs",
  "collection": "WINNING-6.0",
  "token": "<PROJECT_PAT>"
}
```

拟对 `tfs-cli` 增加明确的 `TFS_CONFIG_FILE` 模式：
1. 运行时按 `issue.project_id → project resource local_directory` 定位成员仓，基于真实规范路径加载私有文件。
2. 子进程仅传 `TFS_CONFIG_FILE=<绝对路径>`（作为 **environment**，不是 CLI 参数），`tfs-cli` 在显式文件模式严格读取其中 `token/url/collection/project`；忽略 inherited `TFS_PAT` 等可能污染身份的全局 `TFS_*`，失败禁止任何 fallback。
3. 旧的全局模式保持向后兼容：无 `TFS_CONFIG_FILE` 时延续环境变量 `TFS_PAT` 优先、工具安装目录文件兜底。
4. 对路径和权限做校验：只接受当前 Project 实际根仓下约定的文件，不允许配置任意路径读取别人的 PAT；PAT 禁止写入 stdout/stderr、trace、Issue、PR 描述与命令行参数。
5. 将 `.local/` 加入根仓 `.gitignore`；所有成员工作副本均须生效，并设置服务器 ACL。不通过 `workspace sync` 上传本地凭据到 Multica。
6. 注意**同一个 OS 账号/Daemon 不构成强安全隔离**。若成员之间必须互相不可读，需要分别设置 OS 身份或更严格的运行沙箱。

### A4. 确定性执行流程

#### A4.1 Workspace 级唯一 TFS Sync

```text
1. Autopilot(run_only, no project) → TFS Sync Agent
2. Skill 调用 skill-flow tfs reconcile-workitem --config <实际 Skill config 路径>
3. 加载 Workspace ID + 团队 WIQL + routing + Project ID 投影
4. 使用全局 TFS_PAT 查询 Team Work Items（一次或按 TFS Team Project 分组）
5. 解析 / 归一化 AssignedTo，解析目标 Project ID
6. 在 Workspace 已登记 Project 中查找同源 tfs.id（含旧项目）
7. 不存在 → 在目标 Project 创建 backlog / Delivery Squad Issue，逐键写来源 metadata
8. 已存在且 Project 未变化 → 按现有 managed-fields-only 策略更新
9. 已存在且 Project 改变 → routing_conflict，不自动迁移或再创建
10. 汇总 created/updated/skipped/failed，回读必要事实并输出
```

**关键不变量**：

- 只允许 `skill-flow` 执行路由/创建；Agent 不推断 TFS 负责人、Project 或目录。
- `workspace_id` 和目标 `project_id` 显式传入 Multica CLI；无默认 Workspace/Project fallback。
- 一次同步中的 Work Item 路由唯一，未知成员与身份歧义返回 `unmapped` / `routing_conflict`，不得投递默认 Project。
- 只有在**整个已管理 Project 集合**检查重复后才创建；查询集合必须包括迁移前历史 Project。不能只查新目标 Project。
- 已有 Issue 的状态、负责人、交付元数据不被 TFS Sync 覆盖；仅更新约定的来源管理字段。
- 继续保留当前 `backlog + Delivery Squad` 语义；和 Wayfinder 的后续衔接不属于此次改造。

#### A4.2 跨 Project 幂等与改派

使用来源键 `(collection, tfs.id)` 作为逻辑身份；初始单 Collection 可继续使用现有 `tfs.id` metadata，必要时增加 `tfs.collection` 而**不删除旧键**。迁移前先核验 Workspace 历史数据是否存在重复。

| 状态 | 行为 | 写入 |
| --- | --- | --- |
| 未存在 | 按 `AssignedTo` 路由，目标 Project 中创建 Issue | 创建 + 来源 metadata，回读 |
| 已存在，目标相同 | 校验变更，仅更新允许的 TFS 管理字段 | `updated` 或 `skipped` |
| 已存在，目标不同 | 认定 TFS 改派或路由配置变化；不迁移、不复制、不改 Owner | 记录 `routing_conflict`、保留原 Issue |
| 未匹配成员或身份含糊 | 报告 `unmapped`，不得写默认 Project | 无 |
| 历史多个 Issue 同源 | 身份不唯一，停该事项并报告 | 无 |
| 平台无法可靠列出/查询历史 Issue | `UNKNOWN`，停止本次新建 | 无 |

禁止用“目标 Project 内没有记录”替代全 Workspace 幂等。TFS 改派后的后续迁移属于单独裁决事项：至少要考虑运行中的 Run、OpenSpec、Sub-Issue、PR 和根仓持久化事实。

并发重复触发时，为单 Workspace 的 Sync 配置串行执行/互斥锁；不能假定 Autopilot 或 CLI 自带全局唯一写入约束。跨 Daemon 扩展时需升级互斥方案，当前单服务器可先采用可恢复的进程锁或平台已有机制。

#### A4.3 批量与公平性

现有 `max_items_per_run=50` 直接 `slice(0, 50)` 的行为不适合团队同步，尤其当前按 `System.Id` 升序时易使靠后任务长期饥饿。

首期建议**全量拉取候选 ID、内部按 `batch_size` 分批对账，单次尽量完成整批快照**，并控制运行时长与查询上限；若必须跨 Run 限量，须设计可靠的持久游标/续扫机制。达到限制但未处理完时必须在输出中报告 `incomplete` / `remaining`，不可返回“全部成功”。不得单纯把上限设大作为长期方案。

#### A4.4 各 Project 的研发交付链

进入业务 Project 后，下游从当前 `Issue.project_id` 确定根仓和凭据，而不是从当前进程环境或 `workspace overlay.project` 推断。

```text
Issue.project_id
    ↓
resolveRuntimePaths（复用现有 Project Resource 解析）
    ├─ Workspace / Daemon 身份
    ├─ local_directory / in_place 的真实根仓
    └─ .local/tfs.config.json
    ↓
ProjectScopedTfsClient（仅将当前 Project 凭据传给 tfs-cli 子进程）
    ├─ TFS Work Item / Task 读取写入
    ├─ PR 创建、查询及状态对账
    └─ Finalize 阶段的 TFS 状态回写
```

TFS 调用一律经共用客户端注入 Project 上下文：`materialize-tasks`、`resolve-tasks`、`pr materialize`、`pr reconcile-status`、`delivery route-decision`、`finalize` 等必须一起核对。**如果某命令批量处理多个 Project 的 Issue，则按 Issue 创建独立的 ProjectScopedTfsClient，不能把第一个 Project 的 PAT 复用到整批。**

### A5. 实现改造清单

| 优先级 | 具体文件 / 组件 | 改造责任 |
| --- | --- | --- |
| P0 | `tools/tfs-cli/src/commands/query.ts` | 读取并返回 `AssignedTo` 的稳定身份；保持现有查询返回契约 |
| P0 | `workspace-skills/_shared/sync-config.base.json` | WIQL 扩展团队范围；增加 `routing.assigned_to_project`（不含 PAT） |
| P0 | `tools/skill-flow/src/commands/tfs/reconcile-workitem.ts` | 按 `AssignedTo` 路由到 Project；全已管 Project 幂等；改派/未映射处理；分批与输出 |
| P0 | `tools/skill-flow/src/commands/workspace/sync.ts` | `tfs-sync` 配置不再从 `overlay.project` 固定渲染单一目标 Project；渲染 IDs 与路由 |
| P0 | `tools/skill-flow/src/commands/workspace/provision.ts`、`_shared/provisioning.json` / `workspaces/*.json` | 多 Project 逻辑键 / ID 投影；PoC 可先手动管理两个 Project，正式实现需自动收敛 |
| P0 | `tools/tfs-cli/src/config.ts` | 显式 `TFS_CONFIG_FILE` 模式与禁止回退策略；保留现有统一 PAT 模式 |
| P0 | `tools/skill-flow/src/clients/spawn.ts`、`clients/tfs.ts` | 支持只给指定子进程传凭据文件环境变量；不向终端打印凭据 |
| P0 | `tools/skill-flow/src/clients/runtime-paths.ts` | 复用并收敛 Project ID → Project Resource → Root Repo 的权威解析；验证映射指向当前 Daemon |
| P0 | TFS 业务命令调用点 | 从当前 Issue 获取 Project，并注入 ProjectScopedTfsClient；拒绝错误身份回退 |
| P1 | `workspace-skills/tfs-sync/SKILL.md`、TFS Sync Agent、Autopilot Prompt | **最小化**同步契约和结果说明；不复制确定性路由逻辑或强绑 Claude/Codex 路径 |
| P1 | 根仓 `.gitignore`、部署操作手册 | 忽略 `.local/` 凭据、ACL 和每个 Project 的配置/启动操作 |
| P1 | 测试与运行证据 | TFS 2018 身份 / 组查询、配置漂移、跨项目 E2E、权限和并发验证 |

**实现原则**：不新建第二套 TFS 路由脚本；`tfs-sync` 继续是跨 Claude Code / Codex / Pi 的薄方法入口，复杂规则集中在 `skill-flow`。不把本设计搬进冗长 Agent Instructions。

### A6. 异常、权限与运营边界

| 场景 | 预期处理 |
| --- | --- |
| 服务器 TFS Sync PAT 无效 / 无团队查询权限 | Sync `UNKNOWN`（退出 3），零新建；禁止当作空集合 |
| 当前成员 Project PAT 缺失/过期 | 下游 TFS 操作 `UNKNOWN`，绝不退回服务器 PAT 或其他成员 PAT |
| TFS AssignedTo 为空/无法规范化 | `unmapped`，单项失败，不投递其他成员 |
| 映射到不存在的 Project / 不属于 Workspace | 在同步写入前配置校验失败 |
| 同源 Issue 命中多个 Project | `routing_conflict` / 身份冲突，零迁移，人工修复 |
| TFS 任务从 A 改派 B | 维持旧 Project 中的 Issue，报告冲突，需专门迁移方案 |
| 运行目录缺失/资源不在 Daemon | 下游 `UNKNOWN`；不得猜测目录 |
| Project A/B 实际指向相同真实路径 | 部署校验失败；两个 Project ID **不等于**两份独立目录 |
| 多 Run 操作同一真实 Project 根仓 | 依赖 `in_place` 对重量级 Run 的串行等待；与人工本机编辑不互锁 |
| 多 Project 分别向同一个业务 Git 分支提 PR | 本地不互相覆盖，但远端分支/PR 合并冲突仍可能发生 |
| 同时触发两个 TFS Sync | 工作区级互斥 + 幂等检查，避免重复创建 |
| `run_only` 无 Project | 不可假设存在成员本地目录；共享 Skill 文件定位和 CLI PATH 必须在真实 Run 验证 |

不在 Skill、项目描述、日志、命令行、Issue Metadata 中存放明文 PAT。服务器服务账号应只授予完成同步查询所需权限；如果它同时具备写权限，也不能当作下游操作的默认身份。

### A7. PoC、验收矩阵与实施顺序

#### Phase A：TFS 与平台机制验证（**必须先做**）

1. 同一服务账号 PAT 执行 `@me` 与团队 `IN GROUP` 查询，确认团队组名、成员清单、多个 TFS Team Project 的范围和 TFS 2018 返回身份的准确形式；验证无权限/空结果区分。
2. Multica 建两个成员 Project，分别绑定不同、真实且非符号链接别名的 `in_place` 根仓；同一 Workspace、同一 Agent/Runtime。
3. 验证 `run_only` TFS Sync Autopilot 不绑定 Project 时可以运行并读取 Workspace Skill File 的配置；验证 CLI 运行目录不依赖业务仓。
4. 验证 Project A/B 同时启动重量级 Run 能并发，同一 Project 两个重量级 Run 后者等待；检查 Agent/Daemon 限额。
5. 验证 `issue list/create` 以显式 `--workspace-id` 和 `--project` 参数跨 Project 路由，确认历史 Issue 搜索覆盖。

#### Phase B：同步最小闭环

1. 返回 `assignedTo`；生成稳定身份 → 逻辑 Project → Project ID 的映射。
2. 一个 TFS Sync Run 查询至少两个成员的真实 Work Item；分别创建 `backlog + Delivery Squad` 的 Issue。
3. 第二次重跑无重复；同一 TFS ID 历史 Issue 不因修改配置而在新 Project 创建副本。
4. 验证未映射、重名、TFS 改派、跨 Project 历史重复、查询失败、超限分批不饿死。
5. 检查 `workspace sync --check` 不把 PAT 上传平台，生成配置和真实平台 Skill Files 哈希一致。

#### Phase C：Project PAT 的交付闭环

1. Project A/B 各部署独立 `.local/tfs.config.json`，确认全局 `TFS_PAT` 同时存在时仍分别以 A/B 身份操作。
2. 两个 Project 分别执行 TFS Task 物化、查询、PR 创建/状态回读、Finalize；TFS 审计日志可确认正确属主。
3. 删除 Project B PAT：B 失败且不回退，A 和 Workspace 统一同步不受影响。
4. 核对 `in_place` 根仓 Git/OpenSpec 状态、业务仓 PR、真实物理路径无交叉污染。

#### 验收标准（DoD）

- 1 个未绑定业务 Project 的 TFS Sync Autopilot，1 套共享 Squad/Agent/Skill。
- 至少 2 名 TFS 用户映射到 2 个 Multica Project，且使用不同的真实目录。
- TFS Sync PAT 与下游 Project PAT 独立，配置/日志/平台文件不泄漏。
- TFS Work Item 幂等一致，不产生跨 Project 重复；改派有显式冲突结果。
- 至少 2 个不同 Project 的交付可并发，同 Project 运行满足目录锁实测语义。
- 统一执行链的 TFS 操作均按当前 Project 认证；缺失凭据不兜底。
- 全部验证记录真实命令、版本、测试对象、返回结果与人工审核结论；未验证项不得标“已实现”。

### A8. 变更、发布与回退

- 本方案先独立落库，**不修改 01–07**，不启用或修改定时 Trigger，不访问生产 TFS 写入。
- 实施先分支与 PR：第一批只做路由和同步；第二批覆盖 Project PAT 全交付链；第三批补 provision/文档与回归。合并须以 PoC 证据为前提。
- 发布采用 `skill-flow workspace provision` 后 `workspace sync` 和 `--check` 审计；每一步核对目标 Workspace/Project ID。旧 `overlay.project` 在迁移时保留兼容读取，只在确认已托管多 Project 且数据清理通过后废弃。
- 回退顺序：暂停 TFS Sync Trigger → 保留已有各 Project Issue（不删除、不批量搬迁）→ 将查询范围切回原单用户 WIQL/单 Project 入口或停止自动同步 → 恢复原 CLI/配置快照；已创建的 Issue 只人工核对，不按脚本盲删。
- 单服务器、多目录带来的磁盘空间、Git 更新、系统账号访问权限和运行队列长度应纳入运维监测。

### A9. 待验证/待裁决项

以下不应作为已证实的事实：

1. **TFS 2018 实际团队组名和 `IN GROUP` 支持性**：需本地真实查询；若无稳定组，采用名单生成式 WIQL。
2. **`System.AssignedTo` 身份返回契约**：需验证 SDK 返回 string/对象及实际稳定键，才能锁定 JSON Schema。
3. **跨多个 TFS Team Project/Collection 的覆盖口径**：需评估当前 `TFS_PROJECT`/`teamContext` 的作用，确认 `tfs.id` 唯一域。
4. **当前 Multica 版本无 Project `run_only` 的 Skill 配置物化与回收行为**：必须通过实际 Run 验证。
5. **成员改派时已有 Issue 如何迁移**：本期不自动迁移；下一期如确有业务需要单独设计迁移 Gate。
6. **规模较大时同步批次持久续扫**：优先实测团队任务量及运行时长，再判断是否需要 durable cursor。
7. **Project PAT 配置文件访问权限**：明确 Daemon OS 身份、ACL、审计和凭据轮换流程。

### A10. 主要实现与规范引用

本地代码权威（核对日期 2026-10-27）：

- [TFS 查询输出](../../../../tools/tfs-cli/src/commands/query.ts)
- [TFS CLI 凭据读取](../../../../tools/tfs-cli/src/config.ts)
- [Work Item 同步实现](../../../../tools/skill-flow/src/commands/tfs/reconcile-workitem.ts)
- [Workspace Skill 配置渲染](../../../../tools/skill-flow/src/commands/workspace/sync.ts)
- [Workspace 资产 provision](../../../../tools/skill-flow/src/commands/workspace/provision.ts)
- [Project Root 解析](../../../../tools/skill-flow/src/clients/runtime-paths.ts)
- [TFS 子进程调用客户端](../../../../tools/skill-flow/src/clients/tfs.ts)
- [现行共享 TFS 配置](../../workspace-skills/_shared/sync-config.base.json)
- [现行 Workspace manifest](../../workspace-skills/_shared/provisioning.json)
- [TFS Sync Skill](../../workspace-skills/tfs-sync/SKILL.md)
- [Workspace 同步操作手册](workspace-sync-operations-guide.md)

外部机制依据：

- [Multica Project resources / local_directory](https://multica.ai/docs/project-resources)
- [Multica Autopilots](https://multica.ai/docs/autopilots)
- [Multica issue #7550 / PR #7553：run_only Project 绑定问题与修复](https://github.com/multica-ai/multica/pull/7553)
- [Microsoft Azure Boards：按 Team / Group 的 Assigned To 查询](https://learn.microsoft.com/zh-cn/azure/devops/boards/queries/query-by-workflow-changes?view=azure-devops)


## 方案 B：每位成员一个 Workspace、一个独立 Project

### B1. 目标、决策边界与适用条件

本方案的**成员级隔离边界是 Workspace**，不是 Project。每位成员拥有自己的 Workspace、一个业务 Project、独立 Issue/Run、独立 TFS PAT 和物理工作副本；同一服务器共用 Daemon、CLI 软件与 Git 仓库源头。

**适用条件**：TFS 任务长期按成员负责人分配，成员相对独立完成分析、编码与交付；接受每个 Workspace 定时执行自己的 TFS Sync，团队视图可借助外部汇总。

**不适合的条件**：统一 TFS Sync 是不可妥协的约束；或大量 TFS 任务需要频繁跨成员移交、集中调度和同一个 Multica Workspace 看板。

本方案坚持 **一个 Git/配置权威源，N 套各 Workspace 平台对象**；不让不同 Workspace 复制维护 N 份独立的 Agent Instructions 和 Skill 实现。

### B2. 拟定拓扑与目录

```text
Server（共享 Multica Daemon / Runtime、skill-flow / tfs-cli）
├─ Workspace A
│  ├─ Delivery Squad / Lead / Analyst / Engineer / TFS Sync Agent（独立平台对象）
│  ├─ TFS Sync Autopilot A (run_only，绑定 Project A)
│  │  └─ @me + PAT-A → Project A → Issue A
│  └─ Project A → local_directory (in_place)
│     └─ D:\multica\member-a\winning-platform-monorepo\
│        ├─ .local\tfs.config.json  # PAT-A，不入库、不上传 Skill
│        ├─ openspec\
│        └─ winning-dps-df-*\
├─ Workspace B
│  ├─ 同名 Squad / Agent / Skill（另一组平台对象）
│  ├─ TFS Sync Autopilot B (run_only，绑定 Project B)
│  │  └─ @me + PAT-B → Project B → Issue B
│  └─ Project B → local_directory (in_place)
│     └─ D:\multica\member-b\winning-platform-monorepo\
│        ├─ .local\tfs.config.json  # PAT-B
│        └─ openspec\ / winning-dps-df-*\
└─ Workspace C / Project C / 独立目录 ...
```

注意：以上目录为 **Windows 示例路径**，跨 Windows/Linux 部署时取相应系统合法绝对路径，不能把具体成员目录写入共享 Skill Instruction。

如果官方 `run_only` Project 绑定影响实际工作目录选择，应显式把每个 Workspace 的 `TFS Sync Autopilot` 绑定到其唯一 Project；这与 A 中“唯一不绑定业务 Project 的同步 Run”不同。项目绑定与 `in_place` 锁、Skill Files 的实际物化位置均需 E2E 验证。

### B3. 配置来源：复用现有单 Project `provision/sync`

当前代码已支持以 `--workspace <name>` 为入口分别创建/同步各 Workspace 的平台对象：`_shared/provisioning.json` 为一个 `project`；`_shared/workspaces/<name>.json` 保存该 Workspace 的 `workspace_id / project / skills / squad` IDs；`sync-config.base.json` 通过 `workspace sync` 渲染当前 Workspace 下固定 `multica.project`。

建议**保留现有单 Project 结构**，不执行 A 的 `projects[]` 改造。两位成员使用同一份 `provisioning.json`，但两个 Workspace 各自产生独立的对象 ID。

示例操作（前提：各 Workspace 已创建并存在可用 Runtime）：

```bash
skill-flow workspace provision --workspace member-a
skill-flow workspace sync --workspace member-a

skill-flow workspace provision --workspace member-b
skill-flow workspace sync --workspace member-b
```

这些命令只是**现有能力示意**，生产前还要绑定正确 Runtime、Project Resource、Autopilot Project 和 PAT。当前 `provision.ts` 的 Autopilot 创建未传 `--project`，因此**不能声称上面两组命令已完成正确的 TFS Sync Run 目录绑定**。

**本方案的最小改动**：

1. `provision/sync` 继续按 Workspace 名和现有 overlay 管理平台资产；在 `provision` 的 Autopilot 定义/收敛逻辑补入“绑定本 Workspace 唯一 Project”的明确字段，不能仅靠 Web UI 手改后被 provision 覆盖。
2. `sync-config.base.json` 保持原 `[System.AssignedTo] = @me` 以及现有 `WorkItemType / State` 条件；每个 Workspace 生成自己的 `workspace_id` 和固定 `project`。
3. 同一根仓 `workspace-skills/tfs-sync/config/sync-config.json` 是 `workspace sync` 的**共用本地渲染中间产物**：在一台服务器上并行运行多个 Workspace 的 `sync` 可能互相覆盖。首期**串行执行各 Workspace 的 `provision/sync` 发布**，每个 Workspace 发布后立即回读/`--check`。如需并行发布，必须改造渲染 staging 为按 Workspace 独立目录，不能只引入并行循环。
4. 多 Workspace 同步发布后，核对 `Skill` 与 `Agent` 名称/版本一致，Workspace ID、Project ID、Autopilot Project 绑定各不相同；变更共享源文件后对所有目标 Workspace 发布并审计差异。

#### B3.1 同一服务器的多 Workspace CLI 使用与验收

本节继承前文“Multica CLI Workspace 选择与并发安全”，只补充方案 B 独有的场景：

1. 成员 A/B 各使用自己的 `workspace_id`（来自 `workspaces/<name>.json`），调用 `multica` 时显式传 `--workspace-id`。`Workspace A 的 Project ID` 绝不能与 `Workspace B 的 Project ID` 混用。
2. 一个已获授权的 Daemon 监视两个 Workspace 时，由其创建两个 Workspace 中各自的 Runtime；核对 `Agent → Runtime → Project local_directory` 绑定。**不能仅凭一个 Daemon 在线就认定两个 Workspace 已正确注册、授权和目录挂载**。
3. 共享 `provisioning.json` 和 Skill 源文件只表示“配置源共用”；两套 Workspace 平台对象及 ID 仍独立。`workspace provision/sync --workspace <name>` 可以分别部署，但共用本地渲染路径，**首次发布和更新先串行执行**，每个 Workspace 同步后执行 `--check`。不要在同一源目录并行渲染。
4. 当前 `MulticaClient.ws()` 缺少 `workspace_id` 会返回 `[]`，可能在人工 CLI 场景误用默认 Workspace；应修改为硬失败并检查 `MulticaClient.run()` 的调用者是否自行带上 ID。该项属于**待实施代码改造**，文档规范不是程序已经具备的防护。
5. `multica` 命令的 `--workspace-id` **只路由 Multica 请求**，不会自动让 `tfs-cli` 选择另一份 PAT。TFS Sync 和 TFS Task/PR/Finalize 的凭据仍按 B5 的 `TFS_CONFIG_FILE` 进程级规则隔离；不接受全局 `TFS_PAT` 继承覆盖。

最小验证矩阵：

| 验证 | 操作 | 通过条件 |
| --- | --- | --- |
| CLI 目标隔离 | A/B 两个进程同时执行带不同 `--workspace-id` 的 `issue list` | 结果分别属于各自 Workspace，且不更改 Profile 默认值 |
| 默认配置扰动 | 人工更改 Profile 默认 Workspace，随后重跑显式 `--workspace-id` 命令 | 两个命令仍分别访问 A/B；自动化不调用 `workspace switch` |
| 缺失 ID / 无权限 | 模拟空 `workspace_id` 或未授权的 Workspace | 确定性失败，不调用默认 Workspace，也不产生写入 |
| 共享 Daemon | 单 Daemon 监听 A/B，分别执行 Agent Run | 两个 Workspace Runtime、项目目录和执行日志对应正确 |
| 发布隔离 | 依次 `provision/sync` A、B，分别进行 `--check` | 两者的 Workspace/Project ID 不混淆，平台 Skill 内容一致 |
| 凭据隔离 | A/B 分别查询各自 `@me` 并完成 TFS 写回 | A/B 审计身份不同；缺失 B PAT 不回退到 A 或服务器 PAT |

### B4. TFS 同步链路（每个 Workspace 一个 TFS Sync）

```text
Workspace A / TFS Sync Autopilot A
    → Project A 绑定的 run_only（使用 A 的真实 local_directory）
    → tfs-sync Skill（Workspace A 内独立实例）
    → skill-flow tfs reconcile-workitem
    → tfs-cli: @me + PAT-A
    → Issue 仅在 Workspace A / Project A 创建、更新

Workspace B 同理；仅查询 @me + PAT-B，写入 B 内的 Project B
```

同步语义优先**沿用当前实现**：`tfs-cli query` 输出 `id/type/title/url/state/changedDate`，`reconcile-workitem` 继续使用配置中的固定 `multica.project`；无需 A 的 `AssignedTo → Project` 映射，也无需修改查询 JSON 添加 `assignedTo` 才能实现分流。

注意：`@me` 是 TFS 根据执行所用 PAT 识别的账户，不是 Multica Workspace 的“当前成员”。因此 B 的正确性完全依赖每个 Workspace 的 TFS Sync 进程**确实使用该 Workspace 的 PAT**。一个安装于服务器的全局 `TFS_PAT` 不能被自然继承后误用。

无 Workspace/Project 绑定的 `run_only` 不会自动在成员目录中运行；如果无法从 Run 得到可靠 Project ID，必须由部署配置明确提供，绝不猜目录或根据成员名字模糊匹配。

### B5. Workspace 级 PAT 选择与整个研发交付闭环

建议 A、B 共用一项底层能力：为 `tfs-cli` 提供**显式、进程级的 `TFS_CONFIG_FILE` 模式**，并在 `skill-flow` 中复用对当前 Project Resource 的根仓路径解析。

在 B 中：
1. TFS Sync 的 `workspace_id → 固定 project_id → local_directory` 解析本地 `.local/tfs.config.json`；
2. Engineer / Analyst / PR / Finalize 通过 `Issue.project_id` 定位同一个文件；
3. 对 `tfs-cli` 子进程显式注入凭据文件路径，避免继承 Daemon 的 `TFS_PAT`；显式配置文件缺失或无效时 `UNKNOWN`，禁止回退；
4. 其他 Workspace 的 PAT 不可经共享 `provision/sync` 模板上传，不能通过 Skill File、Prompt 或 Issue metadata 泄露；
5. 每个 Workspace 的 PAT 用户权限必须与该成员的 TFS 范围一致，且具有该成员所需 Task、PR 和回写权限。

建议先统一改造 `clients/tfs.ts`、`clients/spawn.ts`、`tfs-cli/src/config.ts`，再逐项检查所有 TFS 调用点，避免只在 `tfs-sync` 使用成员 PAT，而 Finalize 仍取服务器统一 PAT。

`.local/` 不提交 Git，必须更新 `.gitignore` 并设置服务器文件 ACL。Workspace 是 Multica 业务对象隔离，**不是同一 Daemon 操作系统身份下的文件访问沙箱**。

### B6. 幂等、改派与团队管理缺陷

- **Workspace 内幂等**：现有 `tfs.id` 匹配方案在各自 Workspace 继续有效；`max_items_per_run` 仍可能发生同 Workspace 内超过限制后的长尾遗漏，应优化查询/分批或结果状态，不以“成员少”作为无问题的证明。
- **跨 Workspace 改派**：TFS #10001 原为 A 的 `@me` 命中并创建 Issue A-10；改派 B 后，A 不再查询到它，B 会看到并在 Workspace B 创建 Issue B-20。两条 Issue 在各自 Workspace 看来都合法，跨 Workspace **没有原生全局唯一校验**。不要宣称 B 在未增加额外机制时天然不重复。
- **最小处理政策**：本期不自动迁移、关闭或删除旧 Workspace 的 Issue；将 TFS 改派造成的潜在重复作为显式运营风险，采用人工核对/交接规则，并在团队评审中决定这是否可接受。
- **如果要求自动防重复**：必须引入跨 Workspace 只读索引/统一同步服务/人工确认 Gate，属于新的实现工作；不能计入“B 基本零改造”的估算。
- **团队可见性**：Workspace 隔离带来独立 Issue 与 Run 历史，跨 Workspace 的单一看板、团队负载统计、工程审查和知识回流都需要组织层流程或报表补充。
- **对象漂移**：一套共享源要同步 N 次；已有 `provision/sync` 的幂等和 `--check` 是基础，但其现有单点渲染产物必须处理并发发布风险，且 N 个 Workspace 的 runtime/授权/Autopilot Trigger 分别维护。
- **同目录锁代价**：每 Workspace 内 TFS Sync Run 如果绑定业务 Project 且在 `in_place` 执行，可能等待长时间 Engineer Run；需测定定时 Trigger 是否积压、跳过或被延迟。

### B7. B 的代码影响评估

| 优先级 | 组件 | B 的实际改动 |
| --- | --- | --- |
| P0 | `tools/tfs-cli/src/config.ts` | `TFS_CONFIG_FILE` 显式来源、环境覆盖优先级与禁止 fallback |
| P0 | `tools/skill-flow/src/clients/tfs.ts`、`clients/spawn.ts` | 子进程环境级注入，保证跨 Workspace / Project PAT 不串用 |
| P0 | `tools/skill-flow/src/clients/runtime-paths.ts` | 为无 Issue 的 TFS Sync 明确项目路径解析入口；已有 Issue 继续按 `issue.project_id` |
| P0 | `tools/skill-flow/src/commands/tfs/reconcile-workitem.ts` | 查询使用当前 Workspace PAT；验证配置目标 Project 与实际 Workspace/Autopilot Project 一致 |
| P0 | 所有下游 TFS 消费点 | TFS Task / PR / Finalize 等以当前 Issue 的 Project PAT 执行 |
| P0 | `tools/skill-flow/src/commands/workspace/provision.ts`、`_shared/provisioning.json` | `run_only` Autopilot 显式绑定当前 Workspace Project，配置变更可被 provision 收敛 |
| P1 | `tools/skill-flow/src/commands/workspace/sync.ts` | 首期顺序发布+回读；若要多 Workspace 并行同步再做独立 staging |
| P1 | 根仓 `.gitignore`、运维手册、最小 Skill Contract | 防止凭据泄露、记录每 Workspace 的安装/轮换/同步方式 |
| 条件 | 跨 Workspace TFS 改派索引/控制 | 如团队决定不允许人工处理重复，增加跨 Workspace 去重设计；**非本期已解决项** |

**现有可直接复用**：`manifest.project` 单 Project；`overlay.project`；每 Workspace 的 `provision/sync`；`[System.AssignedTo] = @me`；`reconcile-workitem` 的固定 Project 幂等与 Issue 创建/更新策略。B 的主要代码工作是身份隔离和部署边界，而不是“零改动”。

### B8. B 的 PoC、验收与回退

#### Phase B1：两个 Workspace 原生边界

1. 同一台服务器创建 Workspace A/B；各自 provision 同名 Squad/Agent/Skill，并注册/授权 Runtime。
2. 各建一个 Project，分别挂载不同真实 `local_directory + in_place`，核验 `MULTICA_DAEMON_ID`、Resource 归属和不同物理路径。
3. TFS Sync Autopilot A/B 绑定各自 Project，实测 Run 使用正确目录与 Skill File。
4. 不同 Workspace 同时运行长任务，同 Workspace 第二个 Run 等待；观察单 Daemon 共享资源和限额。

#### Phase B2：TFS 身份与同步

1. 设置 PAT-A/PAT-B，确保全局环境仍可能存在 `TFS_PAT` 的情况下，`@me` 分别解析 A/B。
2. 两个 Workspace 各自 TFS Sync，A/B 产生对应 Issue，重复执行各自幂等；不发生错投。
3. 删除或置错 PAT-B，B 的同步与写操作返回 `UNKNOWN`、不回退 PAT-A/服务器 PAT，A 独立正常。
4. 在实际 TFS 修改 Work Item 负责人 A→B，确认 A 中旧 Issue 的残留及 B 新 Issue 的重复风险，形成可审核的人工处理步骤。
5. 交付链 E2E：两 Workspace 分别处理 TFS Task、PR 和 Finalize，并核实 TFS 审计账号。

#### Phase B3：统一发布与运维验收

1. 连续执行每个 Workspace 的 `workspace provision/sync`，每次 `--check` 验证且不把 PAT 同步平台。
2. 更新一次共享 `SKILL.md` / Agent 指令，批量、**串行**发布到 A/B，核验两边配置一致且 `workspace_id/project` 不混淆。
3. 评估团队是否接受双 Autopilot、跨 Workspace 看板缺口与改派人工处置。
4. 回退：停对应 Workspace Trigger → 保留已创建 Issue → 回滚该 Workspace 的运行配置和 PAT 注入改动，不跨 Workspace 批量删除。

**B 的验收门槛**：每人一个独立 Workspace/Project/目录/PAT；平台资产源文件共享且可同步；A/B 真实并发与目录锁符合部署版本；从 TFS Sync 到 PR/Finalize 全链条不串用账号；改派重复风险有明确团队接受/治理决策。

## 团队联合评审与决策记录

### C1. 关键取舍（建议按优先顺序讨论）

| 评审问题 | 方案 A 的回答 | 方案 B 的回答 | 团队需确认 |
| --- | --- | --- | --- |
| **是否必须只有一个 TFS Sync Run？** | 是，天然契合（统一服务账号查询 + 路由） | 否，通常每 Workspace 一个；若硬要统一需新增跨 Workspace 服务 | 硬约束还是偏好？ |
| 团队主要需要一个统一的研发看板吗？ | 更直接，同 Workspace 下多 Project | 需要跨 Workspace 汇总 | 是否纳入实施目标？ |
| TFS Work Item 改派是否频繁？ | 同 Workspace 可检测同源历史 Issue；不自动迁移 | 不同 Workspace 无自动统一视图，重复风险更高 | 人工处置是否接受？ |
| 配置管理是否允许 N 套平台对象？ | N 个 Project，Agent/Squad/Skill 真共享 | 每 Workspace 一套对象，可通过一份源文件自动同步 | 能否容忍配置漂移与发布成本？ |
| 谁负责 TFS 认证与轮换？ | 查询服务账号 + 各 Project 成员账号 | 各 Workspace 成员账号 | 是否已有专人/流程？ |
| 需要哪些权限隔离？ | 同 Workspace 的 Project 权限需单独设计 | Workspace 业务层更独立；OS 级仍共用 | 哪些资料必须不可见？ |
| 同机并发的首要目标？ | 每 Project 真实目录隔离 | 每 Workspace/Project 真实目录隔离 | 两方案均需原生实测 |
| 哪条路线落地更快？ | 路由/幂等/多 Project provision 实施较多 | 借用现有单 Project manifest、`@me` 和多 Workspace provision，通常改动较少 | 以 PoC 工时与缺陷为准 |

### C2. 推荐的选型逻辑（条件式，不预选）

- **选 A**：只有一个 TFS Sync 是硬性约束；强调团队统一管理、集中可见、频繁改派、统一的 TFS → Multica Issue 身份治理。应接受路由和跨 Project 幂等的实现成本。
- **选 B**：成员间大多独立闭环、允许 N 个 Sync Autopilot、希望沿用当前 `@me` 和每 Workspace 单 Project 设计，且接受跨 Workspace 改派人工交接与团队汇总成本。
- **两个都不能直接满足**：要求一个 Sync、N 个互不可见的 Workspace、自动跨 Workspace 去重/改派，以及零新增中心服务。这些约束组合需要单独设计跨 Workspace 事件/身份治理层。

共同优先实施的底座只有两块：**Project/Workspace 的真实目录隔离验证**与 **`tfs-cli` Project 级显式 PAT 选择及完整 TFS 调用链回归**。A 的路由和 B 的多 Workspace 自动化可分别以 PoC 对比，不应在未选型前全部投入生产开发。

### C3. 建议团队现场验证对照（相同输入、相同指标）

| 场景 | 测试方法 | A 合格条件 | B 合格条件 |
| --- | --- | --- | --- |
| 两名成员同步 | 两名 TFS AssignedTo 各一条真实 Work Item | 单次统一查询后分别进入不同 Project | 两个独立 Sync 分别进入所属 Workspace |
| 重复同步 | 相同 Work Item 连续触发两次 | Workspace 跨 Project 不重复 | 各 Workspace 内不重复 |
| 改派 A→B | 新/旧 Issue 已存在条件下重分配 | 旧 Issue 保留，路由冲突明确报告 | 旧、新 Workspace 均可定位并呈现重复风险，人工操作流程可执行 |
| 身份隔离 | 配错/删除 PAT-B | B 写操作失败、不回退 A/服务账号 | B Sync+写操作失败、不回退 A/其他账号 |
| 本地并发 | 两成员不同目录同时编码；同成员发第二 Run | 跨目录可运行，同目录不覆盖 | 跨目录可运行，同目录不覆盖 |
| 发布成本 | 修改一处共享 Skill 并部署到两名成员 | 一次 Workspace Skill 更新 | 两个 Workspace 依次更新且内容一致 |
| 运维恢复 | 中断同步 / 重跑 / 重启 Daemon | 跨 Project 仍幂等、不重复 | 单 Workspace 恢复不影响其他 Workspace |
| 生产边界 | 无真实写入的预演与只读验证 | 通过后才开放实际写入 | 通过后才开放实际写入 |

每项记录：Multica/Daemon/CLI 版本、测试时间、Workspace/Project ID、真实物理目录、Work Item ID、退出码、Issue 回读、TFS 审计身份和影响范围。所有秘密只记录“已验证/未验证”，**不记 PAT 原值**。

### C4. 评审决策记录（待填写）

| 项目 | 结论 |
| --- | --- |
| 评审日期 | 待定 |
| 参与角色 | 研发负责人 / Multica 运维 / TFS 管理员 / 实施工程师（待确认） |
| 最终选择 | **待定：方案 A / 方案 B / 补充验证** |
| “一个 TFS Sync”约束 | 待确认：硬约束 / 可放宽 |
| 跨成员 TFS 改派频率及处理人 | 待确认 |
| 统一 Issue/Run 看板要求 | 待确认 |
| 共享 Daemon 和各 Workspace Runtime 权限验证 | 待验证 |
| TFS 2018 AssignedTo / WIQL 团队查询 | 待验证（A 必需） |
| 真实目录级并发锁验证 | 待验证（A/B 均必需） |
| 明文凭据的路径、ACL 和轮换责任 | 待确定 |
| 实施范围与阶段 | 待团队评审确认 |
| 审核结果 / PR | 待填写 |

**评审完成之前，本文保持“双方案待决”，不启动定时 Trigger、不变更现有生产 TFS 写入身份，也不修改原 01–07 文档。**

### C5. 参考与验证纪律

- 当前工程事实以本文前文列出的 `tools/tfs-cli`、`tools/skill-flow`、`workspace-skills/_shared` 代码为准；外部方案、历史草稿不能替代现场运行证据。
- Multica 官方关于 `run_only` 与 Project Resource 的相关历史问题： https://github.com/multica-ai/multica/issues/7550 和 https://github.com/multica-ai/multica/pull/7553 ；该 PR 的修复描述说明**绑定 Project 会影响 Run 工作目录选择**，但并不证明“所有安装版本/所有 Daemon 均已验收”。
- 现有 `workspace-sync-operations-guide.md` 已要求多 Workspace 每个独立执行 `provision/sync`。是否能由同一 Daemon 可靠服务多个 Workspace，仍应在当期安装版本/认证配置下验收。
