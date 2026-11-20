# 12 — Issue Closeout Prepare 精简与 Archive 根仓复用方案

> Status: Proposed（仅设计；尚未实施或真实环境验收）  
> Date: 2026-11-20  
> Scope: PR Status Sync Autopilot / `issue-closeout` / Rondo Archive、TFS Writeback 兼容；Engineer Worktree Release 作为独立实施项

## 1. 目标与不可放宽的契约

将 Closeout 收敛为**全部 PR 终态核实 → OpenSpec Archive / Push / 远端回读 → TFS Writeback → Issue Done**，不重复 Analysis / Engineer 的专业质量检查。

- **PR 铁律**：当前 Issue 登记的每一个 PR 都必须由 TFS 确认 `completed`，PR 身份、仓库、源/目标分支必须正确；其他状态或未知时停止。
- **Archive 必须先于 TFS 写入**：Requirement 的当前 `change_ref` 必须已在正确的远端根仓分支完成归档并回读；Archive 留在 `Prepare`，**不后移到 Complete**。独立 Bug 不需要根仓或 OpenSpec Archive。
- **保留 `finalize.pending`**：由 PR 完成事件关联本次收口；仅在 Archive、Push、回读均确认后登记 `prepared_change_ref`。重复运行依据远端事实继续，不凭上次本地目录推断成功。
- **TFS 独立 Hard Gate**：TFS 工作项身份、1–5 个子任务、工时、真实 PR 业务 Commit、Commit→TFS Task 独占、TFS 写回/回读与幂等性不放宽。
- **不得带入额外状态体系**：不新增 Agent、Skill、Workspace Manager、跨 Run Clone Cache、批次 Metadata、锁服务或并行归档框架。

依据：[01 统一设计原则](01-multica-openspec-design-guideline.md) 的 KISS、YAGNI、Specialist Focus、Minimal Sufficient、One Rule One Owner 和 Deterministic First，以及 [10 TFS 子任务](10-tfs-subtask-estimation-design.md)。

## 2. 减少重复检查，不删除必要事实

| Closeout 现有规则 | 目标 |
| --- | --- |
| PR 终态 / 身份 | **保留**：所有 PR `completed`，从 TFS 回读，不依赖声称或推断 |
| 合并源 `sourceCommitId` 与旧 `candidate_commit` 相等 | **移除该相等断言**；不影响真实 PR Commit 来源、仓库身份和 TFS 独占校验 |
| `analysis.human_approval`、AI Review、Analysis Gate | **移除 Closeout 的重复校验**；由上游阶段负责 |
| Independent Verify / `verify_agent.required` | **按已确定决定移除 Closeout 阻断**；这是实质性规则放宽，不等于上游已执行 Verify |
| 工程完成、`tasks.md` 勾选、Validation / Code Review / Evidence 质量 | **移除 Closeout 的重复 Gate**；Engineer 在 PR 创建前验收 |
| 旧业务 Hub / Workspace Reconciliation | **移除**，Closeout 不负责 Engineer Git 现场 |
| OpenSpec Archive / Git Push / 远端回读 | **保留 Hard Gate**：准确 Change、限制提交范围、不覆盖远端、不捏造结果 |
| `finalize.pending` / TFS 回读 | **保留**，用于恢复与防重复写入 |

这里删除的只是**质量及 Candidate 相等的重复断言**，并非删除批准版工件的**读取身份**、归档目标分支、安全 Git 操作或真实业务 Commit 归属验证。特别是 `analysis.source.commit` 仍用于定位批准版 `tasks.md`，而非作为归档时需要 Checkout 的旧 HEAD。

## 3. Owner 与执行流程

| Owner | 唯一职责 |
| --- | --- |
| `pr-status-sync` / `rondo pr reconcile-status` | 只负责 PR 外部状态回核、同步和输出 `finalize` / `resume_finalize`；不 Clone |
| PR Status Sync Agent（当前 Autopilot Run） | 读取待处理 Issue 的 `analysis.source`，按 Repo+Branch 分组，顺序调用单 Issue `issue-closeout`；组结束时触发安全清理 |
| `issue-closeout` | 单 Issue 的 Prepare、TFS 子任务规划与 Writeback、Complete；消费已有组根仓路径，不拥有整个批次 |
| Rondo 的受控 Git / Archive 能力 | 确定性 Clone、Git 认证与身份核实、Archive / Push / 远端回读、安全 Cleanup |
| Multica Issue / TFS / Git | 分别保持交付状态、工作项/PR 事实、已发布 Change/Commit 的权威来源 |

`pr reconcile-status` 的现有返回形状不改；Autopilot 仅在同 Run 获取 `finalize` / `resume_finalize` 后按需准备工作区。Bug 直接执行现有单 Issue Closeout，无需 Clone。

```text
PR Status Sync Agent
  └─ pr reconcile-status
       ├─ noop / unknown / abandoned → 按现有机制报告或停止
       ├─ 独立 Bug → issue-closeout（不准备根仓）
       └─ Requirement：逐 Issue 读 analysis.source
            → 按 repo_url + branch 分组
            → 每组 Git Clone 一次
            → 每个 Issue 顺序执行：
               Prepare（PR completed → Archive → Push → 远端回读 → prepared）
               TFS Writeback（含 Inspect / 规划 / Commit 独占）
               Complete（TFS 回读 → Issue done → 清 pending）
            → 本组不再需要根仓时安全 Cleanup
```

## 4. Requirement Archive 根仓：同 Repo + Branch 复用

### 4.1 输入与分组

仅使用每个 Issue 的 `analysis.source`：

| 字段 | 用途 |
| --- | --- |
| `repo_url` | 指定权威 TFS 根仓，并与已核实的 Git Origin / Push 地址对应 |
| `branch` | 当前 Issue 的 OpenSpec 归档目标分支 |
| `commit` | 批准版工件的不可变 Commit；读取批准版 `tasks.md` 时使用 |
| `change_ref` | 只处理本 Issue 对应的唯一 Change |

同一 Autopilot Run 按既有仓库身份规则识别 `repo_url + branch`：相同的分组**只 Clone 一次**，不同 Repo 或 Branch 不共享可变工作树。只做 Run 内临时分组，**不新建分组状态或存储**；Group 是环境复用单位，Issue 仍是 Archive、`finalize.pending`、TFS Writeback 和 Done 的最小原子业务单位。

当前 Issue 的目标分支取自 `analysis.source.branch`；禁止使用 Autopilot 全局 `RONDO_WORKSPACE_BRANCH`、默认 `main`、另一个 Issue 的分支或当前本地 HEAD 猜测。若对应分支没有此 Change（活跃或唯一归档目录），应明确返回 `UNKNOWN`，不在其他分支搜索并自动归档。

### 4.2 受控 Clone 与顺序归档

按组从 `analysis.source.repo_url` Clone 指定分支，目录只在当前 Run 临时使用：

```bash
git clone --single-branch --branch "<analysis.source.branch>" \
  "<analysis.source.repo_url>" "<repo-branch-group-root>"
```

- 复用 Rondo 现有 `runAuthenticatedGit` / TFS 认证机制，不通过 Skill 手动拼接 PAT。**同一受控认证还必须用于后续 Fetch / Push**，不能 Clone 成功后退化为未认证的普通 Git。Clone 的 URL/Branch 必须核对 Git Top-Level、Origin/Push Identity 和 HEAD。
- 默认使用包含所需历史的 Clone（**不强制 `--depth 1`**）：本地读取批准版 `tasks.md` 需要 `analysis.source.commit` 可达。若 Commit 不在本地历史，应按已确认的源获取，不允许从最新 `tasks.md` 冒充批准版本；无法确认则停止。
- 同组 Issue **顺序**执行完整的单 Issue Closeout；下一 Issue 开始前核实 Git 现场与最新远端分支状态（安全 Fetch / Fast-forward），以及该 Issue 自己的 Change。上一 Issue 的 Archive Push 不替代下一 Issue 的 PR/Archive 检查。
- 同组中 Archive / Push 的 Git 状态未知且无法安全继续时，**停止本组**，保留现场；其他 Repo+Branch 组可继续。若某 Issue 已确认归档而 TFS Writeback 失败，Git 状态安全时可处理同组其他 Issue，失败 Issue 留待下轮恢复。
- 远端其他 Run 仍可能同时 Push，继续使用现有非强制 Push、Git 分叉检测和必要的安全重试；不增加分布式锁。单组工作树不并行 Archive。

### 4.3 现有 Rondo 调用链必须适配

1. **`finalize.ts`**：显式 `--root-repo` 目前会走旧本地业务 Hub/Workspace Reconciliation，必须从新 Requirement Closeout 删除。`routeArchive()` 当前根据本地 HEAD 决定 Push 分支；进入 Archive 前应确定性确认该 HEAD 等于本 Issue 的 `analysis.source.branch`，并且 Repo URL/Origin 正确。
2. **认证与回读**：显式 `--root-repo` 的 `RuntimePaths` 当前不自动携带 `gitRemoteUrl`。Archive 的 Fetch/Push 必须继承受控 TFS Git 认证；完成 Push 后回读**远端目标分支**上的归档目录/内容，不能仅看本地 `openspec archive` 或 Push 退出码。可使用已有 Git / 远端读取能力，不另建双套 Archive 机制。
3. **`writeback.ts` / `requirement-commits.ts`**：去除从 `verifyRemoteRequirement()` 或后续 Commit Inspect 绕回的 AI Review / Analysis / Engineer Gate、旧 Candidate 相等比较。以**已完成 PR 的权威 PR Commit 列表**提供真实业务 Commit，保留仓库/PR 身份、Commit 存在性与 TFS Task 全球独占；不得通过缺失 Candidate 就自动认定 Commit 合法。
4. **批准版 `tasks.md`**：现行 `inspectRequirementCommits()` 通过 `RemoteArtifactReader` 调 TFS Git API 获取 `analysis.source.commit` 的文件。新 Clone 路径优先从已核实的 Git Commit 读取批准版工件；不能把先通过 TFS API 物化整份 Change 作为 Clone/Closeout 的必要前置。TFS API 可继续用于 PR / Work Item / Commit 的权威事实核验。
5. **`Complete` / 重入**：新路径的 `Prepare / Writeback / Complete` 消费该组相同的 `--root-repo`；`Complete` 仅核实归档已在远端、TFS 写入真实完成并转换 Issue 状态。已 `done` 的恢复路径也不能因已经移除的旧 Analysis Gate 再次阻断。
6. **最低代码改动原则**：只复用/局部提取 Rondo 的受控 Clone、归档和清理能力。若现有命令无法安全对外执行受控 Clone/Cleanup，可在 Delivery 现有 CLI 范围提供最小入口；不建立通用 Git Workspace Manager，不改变 `pr reconcile-status` 的状态检测算法。

### 4.4 本组完成后的 Clone Cleanup

**Cleanup 时机：本组最后一个需要该 Clone 的 Prepare / Writeback / Complete 已结束，或本组已确定停止。** 不能在单个 Issue Archive 后立即删除；即使 TFS Writeback 失败，若 Git 现场可确认安全且本组已不再使用该目录，也可以清理，下轮从远端及 `finalize.pending` 恢复。

Rondo 安全清理只需确认：① 是当前 Run 创建的受控临时目录，且路径未越界；② Git 工作树/暂存区干净；③ 本地无未 Push Commit，且无正在使用该目录的操作。满足后删除并确认目录不存在；无法确认、存在 WIP 或未发布 Commit 时保留现场并报告。不得 `reset --hard`、`clean -fd` 或强制删除其他人的根仓。

Cleanup 只释放本轮临时 Clone，不创建 Cleanup 状态、独立任务或后台机制。

## 5. Engineer Worktree Release：独立实施

另一个已确认设计：Engineer 在 `pr materialize` 创建/复用本 Issue 所有 PR、回读 `current_pr` 且 Issue 进入 `in_review` 后，立即安全释放**业务 Worktree**，不等待 PR Merge。

- 仅清理确认属于该 Issue、工作树干净、HEAD 已推送至预期远端 Feature Branch 的 Worktree；保留 Git Hub 与本地/远端 Feature Branch，供 Review 返工时 `rondo dev prepare --mode requirement` 重新准备。
- 既有 `pr worktree remove` 的旧 `.worktrees/<issue>-<repo_key>` 布局与新 Requirement 的 `<root>/<repo_path>-<tfs.id>` 不一致，实施时最小扩展已有 Remove；不新增 Cleanup Skill。
- **本节与 PR Status Sync Clone Cleanup 完全独立**，不纳入第一阶段 Archive 修复的回归范围；不因本节存在而扩大本次 PR 的研发改动。

## 6. 最小实施范围与顺序

**阶段 A（先实施）：PR Status Sync Closeout 修复。**

| 修改处 | 必要动作 |
| --- | --- |
| `agents/pr-status-sync-agent/autopilot-prompt.md` / `skills/issue-closeout/SKILL.md` | 分组与单 Issue Closeout 职责清晰，简短说明共享 `--root-repo` 与 Cleanup |
| `rondo/src/commands/delivery/finalize.ts` | 去重复 Gate / Workspace 对账，保留 PR completed / pending / Archive，修复本地目标分支与 Git Auth/回读 |
| `rondo/src/commands/delivery/remote-artifacts.ts`、现有 Git Auth | 最小复用认证 Clone，不再要求先物化远端 Change 才能 Clone |
| `rondo/src/commands/tfs/writeback.ts`、`requirement-commits.ts`、必要的 `commit-facts.ts` | 保留真实 PR Commit 与 TFS 独占，删除重复 Candidate/质量 Gate；从批准 Commit 读取 `tasks.md` |
| 聚焦测试 | 多 Issue 同 Repo+Branch 一次 Clone、不同分支隔离、归档/认证、失败恢复、Cleanup 安全、TFS KPI |

**阶段 B（独立实施）：Engineer Worktree Release。** 仅调整 `rondo/src/commands/pr/worktree.ts`、`skills/change-development/SKILL.md` 和相关测试，不在阶段 A 同时改研发工作区生命周期。

不修改 `workspace-preparation`、Engineer/Analyst 质量规则、OpenSpec Schema、TFS KPI、PR 状态同步算法或其他无关 Skills。

## 7. 最小验收矩阵

| 场景 | 期望结果 |
| --- | --- |
| 同一 Repo+Branch 的 3 个 Requirement 都满足收口 | 仅 Clone 一次；每个 Issue 独立 Archive、Push、回读、Writeback、Complete |
| 同 Repo 不同 Branch，或不同 Repo | 分别 Clone；不跨分支查找 Change、错误 Push 或覆盖 |
| 有 PR 非 `completed` 或 PR 身份不一致 | 本 Issue 不归档、不写 TFS |
| Clone 成功但 Git Auth/Fetch/Push 失败，或目标分支无 Change | `UNKNOWN` / `FAIL`，无 TFS Writeback；Git 不安全时保留现场 |
| TFS Writeback 未成功、后续重入 | 归档已确认时可安全清理当前 Clone；下轮重新 Clone 并按 `finalize.pending` 恢复，无重复 TFS Task/Commit |
| 收口成功后的 Cleanup | 工作树干净、无未 Push Commit、目录归属可确认；删除本组 Clone，其他组不受影响 |
| Engineer Worktree Release（阶段 B） | PR 已登记后安全 remove；保留分支用于返工；未 Push 或 dirty 不强制删除 |

验收必须结合 Rondo Build / 对应单测和真实 Autopilot / TFS / Git 场景；文档不代表这些用例已通过。

## 8. 不做

- 不将 Archive 后移至 Complete、不放宽 PR `completed` 铁律，也不降低 TFS Commit 独占要求。
- 不采用 Multica Native Repo Checkout 做 Closeout，不给 PR Status Sync Agent 绑定 `workspace-preparation`。
- 不创建第二套 Archive 流程、跨 Run Clone Cache、Batch 状态机、持久 Metadata 或额外 Agent。
- 不为 Cleanup 使用强制 Git 操作；未知时保留现场。
