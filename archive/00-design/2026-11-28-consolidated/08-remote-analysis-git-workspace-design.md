# 08｜远程源码分析与 Git 工作区：分阶段实施

08-A 已完成隔离 Bug 正向 E2E，完整矩阵仍有缺口。08-B 的 PR #128 提供既有实现基线，2026-11-19 确认的常驻根仓分支与单需求发布修复待实施、待验收。[08-B 修复方案](08b-requirement-root-branch-and-publish-plan.md)

本系列遵循 [01 统一设计规范](01-multica-openspec-design-guideline.md)。08-A 代码与执行资产已在本地实现，实施与切换进度见 [08-A 实施记录](validation/new/08a-implementation-2026-11-14.md)和 [Runtime 报告](validation/new/08a-runtime/README.md)。

## 1. 阶段与结果

| 阶段 | 当前目标 | 方案 |
| --- | --- | --- |
| **08-A：共享基础 + Bug Fix（P0）** | 建立两阶段共用的 Wayfinder 准入、原生 checkout 就绪校验、三个远程 MCP 优先读取及必要业务仓准备能力；真实 TFS Bug 跨 Runtime 完成交付 | [08-A 实施方案](08a-remote-analysis-bug-fix-foundation.md) |
| **08-B：Requirement（P1）** | Analyst 在常驻根仓 + MCP 编写 OpenSpec，Commit / Push 并回读成功后进入 Human Review；Engineer 开工同步本机根仓，再以同级业务 Git Worktree 研发并同 Run 创建 PR；跨 Runtime Archive | [08-B 实施方案](08b-requirement-remote-git-delivery.md) |

**共享基础的完成条件**：Wayfinder 对 Bug / Requirement 的准入、恢复与唯一交接均通过，远程 MCP 授权与读取可用。08-A 的既有工作区机制独立验收；08-B Requirement 使用各 Runtime 常驻工作区，不以每 Run 根仓 Checkout 为前提。

**08-A 的完成条件**：共享基础通过，并至少完成一个真实 Bug 的 Wayfinder → Bug Fix Agent → PR 合并 → 无原工作区 PR Status Sync 收口；授权、Git 运行条件及部分成功恢复均通过。Requirement 的研发 / 工件发布闭环不属于 08-A 验收。

**08-B 的完成条件**：真实 Requirement 经共享 Wayfinder 准入与交接后，完成 Analyst → Human → Lead → Engineer → PR Status Sync 跨 Runtime 闭环，且不会破坏已验收的共享基础与 Bug 路径。

## 2. 职责与依赖

- **Wayfinder 是共享基础**：研发测试阶段，TFS Sync 初始化后保持 `backlog + Wayfinder`，Human 手动改 `todo`；研发结束后的目标态仍由 TFS Sync 自动改 `todo` 驱动，均保留 Wayfinder 指派。两阶段约定与验收以 [02 首次准入阶段约定](02-multica-delivery-lifecycle-design.md#wayfinder-entry-stages)为准，不能把目标态自动激活当成旧规则。有效结论分别交接 Bug Fix Agent / Delivery Squad。
- **根仓与业务工作区**。08-B 通过 `RONDO_WORKSPACE_PATH` 或显式 `--root-repo` 定位根仓。同一项目向所有 Agent 下发 `RONDO_WORKSPACE_BRANCH`，仅需准备常驻根仓时才切分支。Engineer 按 TFS ID 创建或复用子仓工作树，业务目标分支取子仓配置。08-A Wayfinder / Bug Fix 的工作区行为独立验收。
- **源码与仓库能力**。需求分析优先使用已授权的 `remote-codegraph`、`remote-filesystem`、`remote-ripgrep`。仓库身份与目录来自 `repo-context.yaml` 和 Rondo Registry。08-B Engineer 按远端 `analysis.source.commit` 读取获批 Change，再通过 `dev prepare` 准备业务工作树。
- **Bug 路线**：现有 `bug.delivery` 与业务 Git Commit / PR；不进入 OpenSpec、不要求根仓工件发布或 Archive。
- **Requirement 路线**：Analysis Gate 后必须 Commit、Push 当前 Change 并远端回读，才提交 Human Review；09 的统一 Engineer 只接收 `change_ref`，开工时先同步本机根仓、核对已批准 Change，再于同一个 Run 内使用同级 Worktree 完成研发及 PR 创建。Rondo 按 Change 受控发布，Archive 由 PR Status Sync 独立执行。
- **PR Status Sync 无 Project**：通过 Rondo 独立临时 Git 工作目录归档，完全不依赖原 Engineer Worktree；Bug 收口不需要 OpenSpec Archive。
- **Agent / Skill / CLI**：Agent 承担专业结果，Skill 提供最小必要方法，Rondo 处理确定性操作与 Gate；不新增运行时、状态机、审批快照或 Evidence 存储。

### 无 Project 的需求归档与恢复

PR Status Sync 调用 `prepare → tfs writeback → complete`。Prepare 按既有归档流程，在当前 Runtime 的独有临时目录 clone / checkout 权威分支，核验 Approval / PR / Tasks / Evidence，执行 OpenSpec Archive，仅提交本次 Change 及归档实际更新的主规格并 Push。回读确认远端归档后才登记 Prepare 成功，并清理已确认发布的临时根仓；结果不明时保留现场、先对账。

Writeback / Complete 读取远端归档和当前交付事实，无需保留该临时目录。正常同一 Run 顺序执行；机器 A 中断且确认已停止相关写入后，机器 B 可重新回读远端事实接续，不复制旧目录、不盲目重放已完成副作用。Runtime 仍须具备 Rondo、相关 Skill、Git / OpenSpec、配置、凭据、网络及可写临时目录。

**并发约定已确认**：PR Status Sync Agent 的 `max_concurrent_tasks` 固定为 `1`，复用 Multica 原生排队，Bug / Requirement 收口均按此执行。当前 Agent 已从 `6` 调整为 `1` 并回读确认；本方案不再扩展多个 PR Status Sync Run 并发收口的设计或专项验收，不新增锁或调度机制。Analyst 或 Engineer 发布可能推进远端分支，归档时按[既有归档流程](08b-requirement-remote-git-delivery.md#requirement-finalize)处理分支前进和主规格冲突。

**摘要恢复采用简单规则**：已有本次交付摘要就复用，确认没有才发布；查询失败或无法确认时停止。Comment ID 可保留作引用，不作为摘要是否存在的唯一依据，也不要求补存 ID 才能继续收口。该规则已完成本地代码适配，真实 Runtime 验证待执行；不新增字段或状态机。

具体流程、冲突处理及验收见 [08-B §6](08b-requirement-remote-git-delivery.md#requirement-finalize)。历史 M10 的 PASS 保留，仅证明固定批准 Commit 契约下的跨 Runtime 顺序接续及指定中断恢复；不同 Runtime 不等于不同机器。独立机器上的接续保留为 `NOT_RUN`，后续在另一台具备运行依赖、无法访问原工作目录的机器上验证；不由 M10 推定通过。配置回读、摘要规则及跨机器待验状态统一记录于 [共享收口确认与待验](validation/new/08-multica-mechanism-validation-acceptance-plan-2026-11-13.md#finalize-shared-validation)。

## 3. 目标架构与职责

本节描述共享基础、08-A 与 08-B 完成后的目标架构；实施与切换仍以各阶段验收条件为准。

~~~mermaid
flowchart TD
  W[TFS Work Item] --> F[Wayfinder 准入]
  F --> T{类型}
  M[remote MCP / 已同步业务源码] -.-> F
  T -->|Requirement| A[Workitem Analyst 根仓 + MCP 分析]
  A --> P[Rondo 仅发布当前 Change 至远端同名分支]
  P --> H[Human Approval]
  H --> L[Delivery Lead 一次派发 change_ref]
  L --> E[Engineer 同步根仓并在同级 Worktree 研发]
  WS[Runtime 持久化 Workspace] --> A
  WS --> E
  E --> EP[Rondo 发布 Tasks Evidence / PR 描述]
  EP --> PR[Engineer 同 Run 创建 PR]
  PR --> Q[PR Review / required Verify 在 Merge 前]
  T -->|Bug| B[Bug Fix Agent 08-A 原有机制]
  B --> Q
  Q --> S[PR Status Sync]
  S -->|Requirement merged| X[Rondo Archive / 主规格受控发布]
  S -->|Bug merged| Y[Bug Finalize 无 OpenSpec Archive]
  X --> Z[TFS Writeback / Issue Done]
  Y --> Z
~~~

| 角色 | 不变职责 | 本次工作区 / 读取边界 |
| --- | --- | --- |
| Wayfinder | 两类 TFS 工作项准入与交接 | 保持既有准入与只读 MCP 能力，是否使用根仓以实际 Runtime 为准，不受 08-B 新工作区要求约束 |
| Workitem Analyst | 需求分析、OpenSpec 工件、Analysis Gate / 发布 | 使用常驻根仓和只读 MCP，向远端同名分支发布当前 Change，记录实际分支与发布 SHA |
| Delivery Lead | Human 决定、一次派发、异常协调 | 远程读取已发布 Change，只发送 @Engineer(change_ref)，不操作 Git / PR |
| Engineer | 已批准 Change 的实现、验证、Review、Commit / Push 和 PR | 08-B 统一 Engineer，开工先 Fetch / 同步并核对批准 Change，再由常驻基础仓建立同级 <repo_path>-<tfs.id> Worktree；PR 在同一 Run 创建 |
| Bug Fix Agent | Bug 独立诊断、修复和 PR | 08-A 的现有 Checkout/独立 Clone 机制保持不变 |
| PR Status Sync | PR 状态核实和交付完成 | 无 Project，依赖 Rondo 隔离根仓操作；不访问 Engineer 原 Worktree |

这里的“不依赖 Project”是 **Lead / PR Status Sync 的执行职责与当前部署配置**，不代表 Multica 机制禁止 Agent 接收到 Issue 所属 Project 上下文。Project Context 的可见性不应成为本地 Git 是否存在的判断依据。

业务镜像可接受已知同步延迟。OpenSpec 交接只认已 Commit / Push 且远端回读成功的 Change 和现有固定批准 Commit；Engineer 开工同步本机根仓并核对来源。不同 Change 目录可并发编辑，Rondo 的受控发布不影响其他本地 WIP；业务基础仓只管理 Worktree。不为跨服务器交接新建 Artifact Store、锁服务或状态机。

## 4. 实施决定

1. **先完成共享基础与 08-A**：原生 checkout 就绪校验 → MCP 优先的只读调查与 Wayfinder 两类来源准入验收 → `rondo dev prepare` → Bug 修复 / PR → 跨 Runtime Finalize。纳入已知 Git Runtime 适配和 Writeback 中断恢复缺口；不把索引监控、完整计量或 API 增强自动列为 P0。
2. **实施 08-B**：Runtime 常驻工作区路径校验 → Analyst 根仓 + MCP → 当前 Change Commit / Push / 回读 → Human Approval → Engineer 开工同步根仓并核对批准内容 → 子仓同级 Worktree → 同 Run PR → 独立 Archive。继续使用可核对的固定批准 Commit。
3. **独立验收后再切换**：当前生产 Requirement 的 `analysis.source.commit` 等既有契约保持有效，不能在 08-A 中提前变更。只按本次修改范围调整 Agent、Skill、CLI 和配置。

本页维护阶段划分与关键职责边界；具体输入、规则、停止条件和验收分别由 08-A / 08-B 维护，已有流程细则引用 02–05。[validation 当前待验项与历史矩阵](validation/new/08-multica-mechanism-validation-acceptance-plan-2026-11-13.md)分别记录；历史 PASS 仅在原实验范围内有效，不作为本次集成已通过的证明。
