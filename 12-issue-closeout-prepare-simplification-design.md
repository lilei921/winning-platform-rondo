# 12 — Issue Closeout Prepare 收口门禁精简与 Worktree 释放方案

> Status: Proposed（仅设计，尚未实施 / 验收）  
> Date: 2026-11-20  
> Scope: `issue-closeout` / Rondo Finalize、PR Status Sync Autopilot 的 Requirement 根仓准备与多 Issue 隔离、Engineer Worktree 释放；不改变 PR Review/Merge、TFS 子任务 KPI 或 OpenSpec 原生 Archive

## 1. 设计结论

`Prepare` 仅负责**已登记 PR 的最终交付事实、OpenSpec 归档及 `finalize.pending` 恢复事实**，不重新执行 Analysis / Engineer 已有的质量与授权 Gate。

- **铁律**：本次交付登记的**全部 PR 均已由 TFS 确认 `completed`**；不能用仅 `closed`、本地分支状态或 Metadata 声称代替。`abandoned`、`active` 或未知均不得自动收口。
- **必须归档**：有 OpenSpec Change 的交付，`Prepare` 仍执行/核验 Archive、Git Push 与远端回读成功后，才允许 TFS 写入；**不将 Archive 后移到 Complete**。独立 Bug 不存在 OpenSpec Change，维持 `route_archive=skipped`。
- **必须保留**：`finalize.pending` 及 PR 完成事件的绑定和幂等恢复；只有 Archive（或独立 Bug 的准备事实）确认成功后，才写入可供 TFS Writer 使用的 `prepared_*` 标记。
- **Closeout 根仓来源**：仅对需要 OpenSpec Archive 的 Requirement，按**当前 Issue 的 `analysis.source.repo_url` / `branch`** 独立执行原生 `git clone`，不使用 Multica `repo checkout`，不绑定 `workspace-preparation`；不同 Issue 不共享可变根仓。
- **TFS 写入安全独立**：Work Item 类型与身份、已保存任务计划、真实业务 Commit 的准确仓库/SHA、Commit→TFS Task 全球唯一归属、工时、回读与恢复仍由 `tfs writeback` 负责，不能因为缩小 Prepare 而删除。

上位原则：[01 — 设计规范](01-multica-openspec-design-guideline.md) 的 KISS、Specialist Focus、One Rule One Owner、Minimal Sufficient 和 Native First。

## 2. Prepare 检查边界

| 检查 | 目标规则 | 归属 |
| --- | --- | --- |
| 登记 PR 的身份和终态 | **保留 Hard Gate**：有效 `current_pr`，逐个 TFS 回读，仓库 / PR ID / 分支对应且全部 `completed` | PR Status Sync / Prepare |
| 合并源 Candidate SHA = 研发登记 Candidate | **从 Closeout 删除**；不因 `sourceCommitId` 缺失或与旧 Candidate 不相等而阻断 | Engineer / PR 创建前保证交付候选；Closeout 仍以真实已合并 PR 识别业务 Commit |
| `analysis.human_approval` | **不在 Prepare / Writeback / Complete 重新校验** | Analysis 授权与 Engineer PR 准入 |
| `analysis.ai_review` | **删除收口检查** | Analysis |
| `verify_agent.required` / Independent Verify | **删除收口检查**；不再让 `required=true` 单独阻断自动 Finalize | 具体 Verify 交付能力应另行负责，本次不补建 |
| `analysis.gate.result`、Change Kind / Schema 交叉一致性 | **删除收口重复 Gate**；保留定位当前 Change / Archive 必需的最小身份检查 | Analysis；Archive 仅关心目标 Change 是否可明确定位 |
| `tasks.md` 完成、Local Validation、Code Review、Evidence 质量 | **删除收口重复验收**；由 `dev check-change` 和 `pr materialize` 在创建 PR 前把关 | Engineer / PR 创建 |
| 业务仓 Hub 对账 / Worktree 回收 / 源分支删除 | **从 Prepare 删除**；不能误删 Closeout 为 Archive 单独 Clone 的根仓 | Engineer PR 创建后的业务 Worktree Release |
| Closeout Archive 根仓 | **按 Issue 独立 `git clone`**，使用 `analysis.source` 的 Repo URL 和 Branch；确认目录内 Change 唯一且来源可信 | `issue-closeout` 编排，Git / Archive 由 Rondo 或原生命令执行 |
| OpenSpec Archive、限定范围 Commit / Push / 远端回读 | **保留 Hard Gate**，不得夹带其他 Change、强制覆盖或只凭本地 Archive 判成功 | Prepare |
| `finalize.pending` | **保留**：PR 事件一致性、准备成功标记与幂等恢复 | Prepare / Complete |

这里“删除 Candidate 校验”特指**收口时不再将最终 PR 源提交与旧 `candidate_commit` 做相等断言**，并非允许为 TFS KPI 使用伪造或来源不明的 Commit。`tfs writeback --inspect` 应从真实已完成 PR 的提交范围取得业务 Commit，保留仓库身份、SHA、PR 归属和 Commit 独占的确定性核验；不得继续以“等于准备时 Candidate”为必要前提。

**已知语义变化**：删除 Independent Verify 检查后，即使批准事实中 `verify_agent.required=true`，Closeout 也可能自动完成。此项是明确的规则放宽，不能解释成“Verify 已由其他阶段自动验收”；本次不实现 Verify 新闭环。

## 3. 目标流程

```text
Engineer
  → 实现 / Local Validation / Code Review / Commit / Push
  → dev publish → dev check-change
  → pr materialize：全部 PR 创建/复用、current_pr 回读、Issue=in_review
  → 安全释放业务 Worktree（失败保留现场，不回退 PR）

PR Review / Merge（必要时另起 Engineer Run，重建 Worktree 返工）
  → pr reconcile-status：全部 PR completed → finalize / resume_finalize
  → issue-closeout
       - 独立 Bug：不准备根仓
       - Requirement + OpenSpec：读取当前 Issue 的 analysis.source
         → 在当前 Autopilot Task 内为此 Issue 独立 git clone repo_url@branch
         → 核实 Origin / 分支 / Change 及最终发布版本
       1. delivery finalize --phase prepare --root-repo <当前 Issue 的根仓路径>
          - 逐仓 PR completed / 身份回核
          - 核对或建立 finalize.pending
          - Requirement：Archive → Git Push → 远端回读
          - 确认后标记 prepared
       2. Requirement：inspect → 规划或复用 TFS Task Plan
       3. tfs writeback：子任务/Commit 独占/工时/父项回写和回读
       4. delivery finalize --phase complete：核对 TFS 已写入 → Summary → Issue done → 清 pending
       - Requirement 的 Prepare / Writeback / Complete 使用**同一个** --root-repo；
         成功后安全释放该 Issue 的归档临时根仓，失败保留诊断现场
```

`Complete` 不重新运行 Engineer、Approval、Analysis Gate、Verify 等质量检查；对 TFS 是否真正写成、归档是否仍可从权威远端确认和 Issue 状态转换保持可信回读。归档失败时**停止于 Prepare**，绝不提前写 TFS。

## 4. PR Status Sync Autopilot：按 Issue 准备归档根仓

### 4.1 触发与权威输入

`pr reconcile-status` 仍只核实 PR/TFS 状态，不执行 Git。仅当返回当前 Issue 的 `finalize` 或 `resume_finalize`、并确认该 Issue 有待归档的 OpenSpec Change 时，`issue-closeout` 才准备根仓；独立 Bug 无需根仓。

仓库和分支**只能**来自当前 Issue 持久化的 `analysis.source`：

| 属性 | 用途 |
| --- | --- |
| `repo_url` | 唯一根仓地址；校验 Clone 的 Fetch / Push Origin 身份 |
| `branch` | 该 Issue 的 OpenSpec 归档目标分支，也是 Clone 指定的远端分支 |
| `commit` | 原批准版本指针；用于溯源，不强制归档 Checkout 回旧提交 |
| `change_ref` | 本次必须存在的唯一 OpenSpec Change，归档范围限于它 |

归档版本应反映该 Issue **最终已经发布**的 Change 进度与证据（必要时参照 `dev.publication.commit`），而不是仅使用早期批准 SHA；不能根据另一 Issue、Autopilot Task 当前 HEAD、`RONDO_WORKSPACE_BRANCH`、默认 `main` 等推测目标分支。若当前目标分支未包含所需 Change，报告明确的 `UNKNOWN`；不得遍历其他分支寻找相似目录。

### 4.2 Git Clone 与隔离

在当前 Autopilot Task 的可写工作目录内，**每个 Issue 使用独立的根仓目录**。同一根仓 URL、不同 Issue / Branch 也不共用可变 Checkout。按对应 Issue 的 `analysis.source.branch` 执行原生 Git Clone：

```bash
git clone --single-branch --branch "<analysis.source.branch>" \
  "<analysis.source.repo_url>" "<issue-scoped-root>"
```

优先复用 Rondo 已有认证 Git / Clone 能力（`remote-artifacts.ts` / `runAuthenticatedRootGit`），不复制 PAT 处理方法，不引入 Multica `repo checkout` 或新的 Workspace Manager。现有 `checkoutArchiveRoot()` 要求事先物化 TFS API 工件，实施时应最小化复用其认证 Clone 部分，**不要让远端 API 物化失败继续成为本地 Clone 的必经前置**。

Clone 后确认实际 Git Top-Level、Origin/Push URL、HEAD 当前本地分支与 `analysis.source.branch` 相等，以及当前/归档 Change 的唯一性；对重复执行，仅复用同一 Issue 且身份、分支和工作树状态可确认的目录，不自动 reset / clean / force checkout。

推荐布局（示意，不规定 CLI 自动创建的真实目录名）：

```text
autopilot-task-workdir/
  LEI-101/root-repo/   # main
  LEI-102/root-repo/   # dev
  LEI-103/root-repo/   # release/2026
```

不同 Issue 的失败隔离，单个 Issue 报错不自动改变其他 Issue 的根仓。若 Autopilot 重新执行于新 Task Workdir，可重新 Clone 并通过权威远端及 `finalize.pending` 恢复，不依赖上次 Task 的本地目录。归档完整成功且本地无未发布提交/修改时可安全回收本次临时 Clone；失败或存在未确认的本地改动时保留现场供核查。

### 4.3 Rondo 现有接口的最小兼容修复

- `issue-closeout` 将该 Issue **同一** `--root-repo <path>` 传给 `delivery finalize --phase prepare`、`tfs writeback` 和 `delivery finalize --phase complete`，避免后一阶段重新进入远端工件物化模式。
- 当前显式 `--root-repo` 会走旧本地路径的业务 Hub / Workspace Reconciliation；按 §2 删除这一非收口职责，否则即使 Clone 成功也可能因业务仓不存在而失败。
- 当前 `routeArchive()` 默认向本地 HEAD 分支 Push；本方案直接 Clone 指定目标分支，且归档执行前必须**显式核对** HEAD 与该 Issue 的 `analysis.source.branch` 一致。保留现有 Archive 安全检查、Git Push、远端回读和 `finalize.pending`。
- 远端同分支可能被其他 Issue 的 Archive 推进；继续使用既有 Fetch / Fast-forward / 非强制 Push 的冲突与重试规则，不能因为各 Issue 本地隔离就放弃远端并发保护。
- 不要求改变 Engineer 的 Root / Worktree 管理、Analysis 发布或 PR Status Sync 状态检测；若现有 Git Auth 无法被 Skill 安全复用，只在 Rondo 内补一个最小的受控 Clone 调用入口，不引入独立仓库管理框架。

**边界**：此处 Clone 用于 Closeout Archive，与 §5 中 Engineer PR 创建后释放的业务 Worktree 是两类不同工作区，不得混同。

## 5. Engineer Worktree 释放时机与安全边界

### 5.1 释放时机

**Engineer 当次 Run 中，`rondo pr materialize` 确认全部 PR 已登记且 Issue 转为 `in_review` 后立即释放本地业务 Worktree。** 不等待 PR Merge；不用由跨 Runtime 的 PR Status Sync 删除另一个 Runtime 的工作目录。

清理对象仅为本 Issue 的业务 Worktree；**保留基础仓 Hub、本地和远端 `feature/<tfs.id>` 分支及远端提交**。Reviewer 要求返工时，继续通过既有 `rondo dev prepare --mode requirement` 在新 Run 创建/恢复同一分支 Worktree，不增加新恢复机制。

### 5.2 Remove 前置（仅数据安全）

1. 本次所有 PR 创建/复用及 `current_pr` / `in_review` 回读确认。
2. Worktree 必须能确认属于本 Issue / Repository，且工作区干净（无未提交、未暂存或未跟踪的待保留改动）。
3. Worktree 当前 HEAD 必须已被预期远端 Feature Branch 包含，避免删除尚未 Push 的本地提交；不能仅依据 `git status clean` 判断可删。
4. 使用 `git worktree remove`，不执行 `--force`、`reset --hard`、`clean -fd` 或强制删分支。

清理不成功时：**保留现场并报告**，不把已确认的 PR 创建判失败，不阻断 PR Review、Merge 或后续 Prepare。没有必要为此引入新的 Metadata Cleanup 状态、Agent、锁或后台任务。

### 5.3 现有实现差异与最小修复

- 新 Requirement `dev prepare` 当前使用：`<root>/<repo_path>-<tfs.id>`。
- 既有 `pr worktree remove` 仍定位旧路径：`<root>/.worktrees/<issue>-<repo_key>`。
- 两者不一致，**不能把旧 Remove 命令直接用于新 Requirement Worktree**。

优先扩展已有 `rondo pr worktree remove` 以正确识别 Requirement 布局和仓库身份，复用 Git 原生 Worktree 操作；由 `change-development` Skill 在 PR 创建成功后简要指导调用。不增加独立 Cleanup Skill / 命令组。旧 Worktree 和 Bug Native Checkout 保持原行为。

## 6. 最小实施范围

| 文件 / 能力 | 调整 |
| --- | --- |
| `rondo/src/commands/delivery/finalize.ts` | 删除重复的 Approval / AI Review / Verify / Analysis / Completion Gate；移除旧业务 Workspace Reconciliation；保留 PR 终态、Archive、pending；Requirement 按 Issue `analysis.source.branch` 归档且 `--root-repo` 可消费本地 Clone；Complete 不重复旧 Gate |
| `rondo/src/commands/delivery/remote-artifacts.ts` | 复用现有 Git 认证 / Clone 基础能力，按需支持直接从 `analysis.source` Clone 指定分支，不以 TFS API 工件物化作为 Clone 必经前置；保留归档前后必要的身份和远端回读检查，不重复 Analysis 质量 Gate |
| `rondo/src/commands/tfs/writeback.ts`、`requirement-commits.ts` | 去除 `verifyRemoteRequirement` 等重复质量校验和 Candidate 相等断言；保留归档事实、真实已完成 PR Commit 来源、全局独占和 TFS 写入验证 |
| `rondo/src/commands/pr/worktree.ts` | 现有 Remove 支持 Requirement 同级 Worktree，并在删除前确认 HEAD 已发布 |
| `skills/change-development/SKILL.md` | PR 创建成功后增加简短 Worktree Release 指引 |
| `skills/issue-closeout/SKILL.md` | 按 `finalize` / `resume_finalize` 读取当前 Issue 的 `analysis.source` 并为 Requirement 按需 Git Clone；把同一个 `--root-repo` 传给三段收口 CLI；精简重复 Gate 指引，保留原三段调用与 TFS 规划 |
| 相关测试 | 覆盖 Gate/Archive/Writeback/Worktree 和多个 Issue 不同分支的独立 Clone、重入与错误分支阻断，防止下游重复 Gate 或错误归档 |

不修改 `workspace-preparation`，不给 PR Status Sync Agent 绑定该 Skill；不使用 Multica Native Repo Checkout 执行 Closeout。避免改动 Analysis / Engineer 的质量规则、OpenSpec Schema、TFS Task KPI 契约、PR 状态生命周期及其他无关 Skills。实现前先核对现有函数调用链，不以粗暴跳过整个 Helper 的方式误删归档或 TFS 必需的身份校验。

## 7. 验收重点

1. 任意 PR 未 `completed`、PR 身份不符、TFS PR 状态不可确认时，Prepare 不通过且不写 TFS。
2. PR 全部 `completed` 后，缺少旧 Candidate 相等证明、历史 AI Review / Analysis Gate / Verify 执行标记不再单独阻断；仅当前 Change 定位和归档所需事实必须有效。
3. Requirement Archive 失败、Push 未确认、远端无法确认唯一归档目录时，不产生 TFS 副作用；重跑只补未确认步骤。
4. 成功归档后，`finalize.pending` 持久、事件一致、`prepared_change_ref` 回读成功；TFS 部分成功时恢复不重复创建。
5. `tfs writeback` 继续核实真实 PR Commit 与 TFS Task 全局独占，且 Complete 只在 TFS 事实回读通过后设置 Issue `done`。
6. 所有 PR 创建成功后，干净且 HEAD 已 Push 的 Requirement Worktree 可释放；有 WIP、未 Push HEAD、路径/仓库不符则保留现场，但不回退已创建的 PR。
7. 释放后 Reviewer 请求返工，`dev prepare --mode requirement` 能复用保留的分支重建 Worktree。
8. 独立 Bug 继续跳过 OpenSpec Archive、无需 Clone 根仓；旧 `dev.dispatch` 路线不因新 Requirement 的 Worktree 清理而回归。
9. 单个 Autopilot Run 连续处理两个不同 `analysis.source.branch` 的 Requirement，各自只在独立 Clone 中归档、Push 正确目标分支，且不会错误复用上一个 Issue 的 Change / HEAD。
10. `analysis.source.branch` 不存在、目标分支无当前 `change_ref`、Origin 不符、最终发布版本不可确认时，仅当前 Issue 返回 `FAIL/UNKNOWN`，不搜索或切换其他分支，不执行 TFS Writeback。
11. 本地 Clone 进入 Archive 前 HEAD 分支必须与 `analysis.source.branch` 一致；安全归档后使用同一根仓贯穿 Prepare / Writeback / Complete，失败或出现未推送提交时保留现场。

**验证纪律**：以上是目标契约，不代表已通过测试或真实 Multica / TFS E2E；未经验证不得声明 PASS。

## 8. 不做

- 不将 Archive 后移到 Complete，也不让 Archive 变成 Best-effort。
- 不放宽 PR completed 铁律。
- 不撤销 TFS Commit 独占、工时和回读。
- 不新增 Cleanup Agent / Skill / Workflow、独立状态表或跨 Runtime 文件同步。
- 不为自动清理 Git 工作树使用强制删除。
- 不将 Multica Native Repo Checkout 用于 Closeout Archive，不依赖 Task Branch 归档，也不修改 `workspace-preparation` Skill 或 Agent 绑定。
- 不添加全局根仓分支配置、跨 Issue 共享 Checkout、通用 Workspace Manager 或新持久化状态。
