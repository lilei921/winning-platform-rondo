# 12 — Issue Closeout Prepare 收口门禁精简与 Worktree 释放方案

> Status: Proposed（仅设计，尚未实施 / 验收）  
> Date: 2026-11-20  
> Scope: `issue-closeout` / Rondo Finalize、Requirement Worktree 释放；不改变 PR Review/Merge、TFS 子任务 KPI 或 OpenSpec 原生 Archive

## 1. 设计结论

`Prepare` 仅负责**已登记 PR 的最终交付事实、OpenSpec 归档及 `finalize.pending` 恢复事实**，不重新执行 Analysis / Engineer 已有的质量与授权 Gate。

- **铁律**：本次交付登记的**全部 PR 均已由 TFS 确认 `completed`**；不能用仅 `closed`、本地分支状态或 Metadata 声称代替。`abandoned`、`active` 或未知均不得自动收口。
- **必须归档**：有 OpenSpec Change 的交付，`Prepare` 仍执行/核验 Archive、Git Push 与远端回读成功后，才允许 TFS 写入；**不将 Archive 后移到 Complete**。独立 Bug 不存在 OpenSpec Change，维持 `route_archive=skipped`。
- **必须保留**：`finalize.pending` 及 PR 完成事件的绑定和幂等恢复；只有 Archive（或独立 Bug 的准备事实）确认成功后，才写入可供 TFS Writer 使用的 `prepared_*` 标记。
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
| 本地 Hub Fetch / Fast-forward、Workspace 对账 / Worktree 回收 / 源分支删除 | **从 Prepare 删除** | Engineer PR 创建后的 Worktree Release |
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
       1. delivery finalize --phase prepare
          - 逐仓 PR completed / 身份回核
          - 核对或建立 finalize.pending
          - Requirement：Archive → Git Push → 远端回读
          - 确认后标记 prepared
       2. Requirement：inspect → 规划或复用 TFS Task Plan
       3. tfs writeback：子任务/Commit 独占/工时/父项回写和回读
       4. delivery finalize --phase complete：核对 TFS 已写入 → Summary → Issue done → 清 pending
```

`Complete` 不重新运行 Engineer、Approval、Analysis Gate、Verify 等质量检查；对 TFS 是否真正写成、归档是否仍可从权威远端确认和 Issue 状态转换保持可信回读。归档失败时**停止于 Prepare**，绝不提前写 TFS。

## 4. Worktree 释放时机与安全边界

### 4.1 释放时机

**Engineer 当次 Run 中，`rondo pr materialize` 确认全部 PR 已登记且 Issue 转为 `in_review` 后立即释放本地业务 Worktree。** 不等待 PR Merge；不用由跨 Runtime 的 PR Status Sync 删除另一个 Runtime 的工作目录。

清理对象仅为本 Issue 的业务 Worktree；**保留基础仓 Hub、本地和远端 `feature/<tfs.id>` 分支及远端提交**。Reviewer 要求返工时，继续通过既有 `rondo dev prepare --mode requirement` 在新 Run 创建/恢复同一分支 Worktree，不增加新恢复机制。

### 4.2 Remove 前置（仅数据安全）

1. 本次所有 PR 创建/复用及 `current_pr` / `in_review` 回读确认。
2. Worktree 必须能确认属于本 Issue / Repository，且工作区干净（无未提交、未暂存或未跟踪的待保留改动）。
3. Worktree 当前 HEAD 必须已被预期远端 Feature Branch 包含，避免删除尚未 Push 的本地提交；不能仅依据 `git status clean` 判断可删。
4. 使用 `git worktree remove`，不执行 `--force`、`reset --hard`、`clean -fd` 或强制删分支。

清理不成功时：**保留现场并报告**，不把已确认的 PR 创建判失败，不阻断 PR Review、Merge 或后续 Prepare。没有必要为此引入新的 Metadata Cleanup 状态、Agent、锁或后台任务。

### 4.3 现有实现差异与最小修复

- 新 Requirement `dev prepare` 当前使用：`<root>/<repo_path>-<tfs.id>`。
- 既有 `pr worktree remove` 仍定位旧路径：`<root>/.worktrees/<issue>-<repo_key>`。
- 两者不一致，**不能把旧 Remove 命令直接用于新 Requirement Worktree**。

优先扩展已有 `rondo pr worktree remove` 以正确识别 Requirement 布局和仓库身份，复用 Git 原生 Worktree 操作；由 `change-development` Skill 在 PR 创建成功后简要指导调用。不增加独立 Cleanup Skill / 命令组。旧 Worktree 和 Bug Native Checkout 保持原行为。

## 5. 最小实施范围

| 文件 / 能力 | 调整 |
| --- | --- |
| `rondo/src/commands/delivery/finalize.ts` | 删除重复的 Approval / AI Review / Verify / Analysis / Completion Gate；移除本地 Workspace Reconciliation；保留 PR 终态、Archive、pending；Complete 不重复旧 Gate |
| `rondo/src/commands/delivery/remote-artifacts.ts` | 只保留定位与安全归档所需的远端 Change 身份 / 工件一致性，不再把批准版本质量复核混入 Archive（需逐项确认调用依赖） |
| `rondo/src/commands/tfs/writeback.ts`、`requirement-commits.ts` | 去除 `verifyRemoteRequirement` 等重复质量校验和 Candidate 相等断言；保留归档事实、真实已完成 PR Commit 来源、全局独占和 TFS 写入验证 |
| `rondo/src/commands/pr/worktree.ts` | 现有 Remove 支持 Requirement 同级 Worktree，并在删除前确认 HEAD 已发布 |
| `skills/change-development/SKILL.md` | PR 创建成功后增加简短 Worktree Release 指引 |
| `skills/issue-closeout/SKILL.md` | 精简 Prepare / Complete 的职责描述；保留原三段调用与 TFS 规划 |
| 相关测试 | 精确调整 Gate/Archive/Writeback/Worktree 用例，防止删除检查后仍在下游被相同检查阻断 |

避免改动 Analysis / Engineer 的质量规则、OpenSpec Schema、TFS Task KPI 契约、PR 状态生命周期及其他无关 Skills。实现前先核对现有函数调用链，不以粗暴跳过整个 Helper 的方式误删归档或 TFS 必需的身份校验。

## 6. 验收重点

1. 任意 PR 未 `completed`、PR 身份不符、TFS PR 状态不可确认时，Prepare 不通过且不写 TFS。
2. PR 全部 `completed` 后，缺少旧 Candidate 相等证明、历史 AI Review / Analysis Gate / Verify 执行标记不再单独阻断；仅当前 Change 定位和归档所需事实必须有效。
3. Requirement Archive 失败、Push 未确认、远端无法确认唯一归档目录时，不产生 TFS 副作用；重跑只补未确认步骤。
4. 成功归档后，`finalize.pending` 持久、事件一致、`prepared_change_ref` 回读成功；TFS 部分成功时恢复不重复创建。
5. `tfs writeback` 继续核实真实 PR Commit 与 TFS Task 全局独占，且 Complete 只在 TFS 事实回读通过后设置 Issue `done`。
6. 所有 PR 创建成功后，干净且 HEAD 已 Push 的 Requirement Worktree 可释放；有 WIP、未 Push HEAD、路径/仓库不符则保留现场，但不回退已创建的 PR。
7. 释放后 Reviewer 请求返工，`dev prepare --mode requirement` 能复用保留的分支重建 Worktree。
8. 独立 Bug 继续跳过 OpenSpec Archive；旧 `dev.dispatch` 路线不因新 Requirement 的 Worktree 清理而回归。

**验证纪律**：以上是目标契约，不代表已通过测试或真实 Multica / TFS E2E；未经验证不得声明 PASS。

## 7. 不做

- 不将 Archive 后移到 Complete，也不让 Archive 变成 Best-effort。
- 不放宽 PR completed 铁律。
- 不撤销 TFS Commit 独占、工时和回读。
- 不新增 Cleanup Agent / Skill / Workflow、独立状态表或跨 Runtime 文件同步。
- 不为自动清理 Git 工作树使用强制删除。
