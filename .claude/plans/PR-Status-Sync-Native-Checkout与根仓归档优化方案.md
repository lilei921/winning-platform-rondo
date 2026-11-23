# PR Status Sync — Native Checkout 与根仓归档优化方案

> 日期：2026-11-23  
> 状态：设计方案，待实施与真实写入验收  
> 范围：Requirement Closeout 的根仓准备、OpenSpec Archive、Git 发布及回读  
> 原则：遵循 [01 统一设计规范](../../01-multica-openspec-design-guideline.md) 的 Native First、KISS、YAGNI、One Rule One Owner、Specialist Focus、Minimal Sufficient  
> 历史调查、性能数据及试验详见 [归档的旧版方案](archive/PR-Status-Sync-耗时优化与根仓切换方案.md)，旧版不再作为实施基线。

## 一、目标与边界

复用 Multica 原生 `repo checkout` 及其缓存，将根仓直接放在当前 Task `workdir/<repo-name>/`，消除 Rondo 自建的 `rondo-closeout-*` 临时父目录、Owner Marker、Cleanup Token 与额外清理步骤，减少 Closeout 耗时。

**唯一分支契约**：

- `analysis.source.repo_url`：根仓身份。
- `analysis.source.branch`：已批准工件的**来源分支，同时也是 OpenSpec Archive 的远端目标分支**；Fetch、Push、Readback 都使用它。
- `analysis.source.commit`：不可变的批准版本；必须可从目标分支当前基线追溯。
- `analysis.source.change_ref`：本 Issue 唯一的 OpenSpec Change。

不新增 `archiveTargetBranch`、`archive_branch` Metadata 或独立的 Branch Registry。实现中若需要局部变量，`targetBranch = source.branch` 即可，不建立第二个规则 Owner。**如以后统一归档到 `master`，须先从 Analyst 的分析发布源头统一分支；本次 Closeout 不做 `main → master` 映射，也不改写历史 Issue。**

本次不调整 Bug Closeout、Engineer Worktree、上游 Analysis/Engineer 质量 Gate 或 Runtime Session 超时策略；不引入分布式锁、自动 Rebase、额外状态机。

## 二、执行契约

### 2.1 Native Checkout 与 Task 归属

1. 当前 Task `workdir` 内调用 `multica repo checkout <source.repo_url>`，使用 CLI 实际返回的根仓绝对路径；仅接受其直属于当前 Task workdir 的仓库目录，兼容普通 Checkout 和 linked worktree。
2. 同一 Task 已有有效 Checkout 时先复用，不为同一仓库重复创建 Worktree；不同 `repo_url + source.branch` 组顺序处理，切组前确保前一组已完成并且工作区适合切换。
3. Rondo 校验 Task/Workspace 上下文、平台 Checkout 来源、Git Origin 与 Push URL、工作区状态；当前 Task 的 Run 事实可核实时按 Task 级验证。**不要要求同一批次的每个 Issue 各自拥有当前 PR Status Sync Task 的 Active Run**。每个 Issue 另行校验自己的 `analysis.source`、批准 Commit 与 Change。
4. 已有 Checkout 存在未确认提交、非预期改动或被其他流程占用时，不强制 Reset/Clean/切换；返回可诊断的 `UNKNOWN`，保留现场。不自行 Clone 作为绕过路径。
5. Rondo 不再写入 `rondo-closeout-owner.json`，不返回 `cleanup_token`，不调用 `root-cleanup`；仅在确认无在途调用方依赖后删除 `root-clone` 别名。Checkout 生命周期归 Multica，但不假定 Task 结束即刻回收 Worktree，Rondo 绝不删除平台 Worktree。

### 2.2 分支准备与重复调用

1. 按 `source.repo_url + source.branch` 分组。对每组 Fetch 最新 `origin/<source.branch>`，检验 `source.commit` 是该远端基线的祖先；远端分支缺失或批准 Commit 不可达时拒绝归档，不自行改用 `master`。
2. 在平台 Checkout 内使用**当前 Task + 目标分支**作用域的本地归档分支（命名实现遵守 Git Ref 规则）；从 `origin/<source.branch>` 建立，避免多个 Worktree 争抢共享本地 `main` 或 `master`。本地分支不代表远端发布目标。
3. 首次准备：工作区安全时创建分支。重复准备：发现同一 Task/目标分支的归档分支则验证并复用；存在未确认本地 Commit 时不重建或覆盖。已有归档先核对远端事实，再决定是否需要继续。
4. 同 Run、同仓库、同目标分支的多个 Issue 按顺序复用同一工作树；逐 Issue 完成 Archive、Commit、Push、Readback 后再处理下一个。

### 2.3 Archive、Push、Readback

1. 保留当前 PR Transition Gate、必要的 Delivery Completion Gate、变更范围校验与 OpenSpec Archive。只允许本 Change 及其实际涉及的 Specs 进入归档提交，禁止夹带其他 Issue 变更。
2. `routeArchive()` 与 `syncArchiveBranch()` 必须区分**本地 HEAD 分支**和**远端目标分支**。以 `source.branch` 为唯一远端目标，显式 Fetch、比较 Ahead/Behind、检验待推送 Commit 的影响范围。
3. 发布执行等价于 `git push origin HEAD:refs/heads/<source.branch>`，使用普通 Fast-Forward Push；不使用 Force Push，也不得继续使用 `git push origin <local-archive-branch>`。
4. Push 成功或收到不确定回执时，均以远端 `source.branch` 的 Archive 路径唯一性和树内容回读确认结果；`confirmPublishedArchive()`、Prepare、TFS Writeback、Complete 消费**同一**分支契约。仅在远端 Archive 已确认且 `finalize.pending.prepared_change_ref` 回读成功后才执行 TFS Writeback。
5. Complete 继续复核真实 TFS 状态和同一远端分支的 Archive，不能只凭本地文件或成功退出码判断完成。

### 2.4 并发与失败恢复

- 同 Run 顺序处理；跨 Run 依赖 Git Fast-Forward / Non-Fast-Forward 原生保护，不增加分布式锁或自动合并机制。
- 远端先行变化、Push 拒绝或本地分叉时：先回读确认目标 Change 是否已经成功发布；否则 `UNKNOWN`，保留未确认的本地 Commit 与 `finalize.pending`，停止该 Issue 的 TFS 写入。不得自动 Rebase、Force Push 或盲目重复 Archive。
- 后续恢复以远端事实为准，不假定上一次 Task 的 Worktree 仍存在。不同 Run 对同一 capability 的并发归档，还要核对最终 Specs，不只检查 Archive 目录是否存在。
- 现有锁只能保护单个 Worktree，不能据此宣称已实现跨 Run 串行。若真实验收证明仅靠安全拒绝不满足交付需求，再单独评估最小重试或同步策略。

## 三、最小实施范围

| 位置 | 必要改动 |
|---|---|
| `rondo/src/commands/delivery/closeout-root.ts` | 直接 Native Checkout；移除自建目录/Owner/Cleanup；最小 Task/Git 身份校验；按 `source.branch` 准备 Task 隔离分支并回读 |
| `rondo/src/commands/delivery/finalize.ts` | `routeArchive()`、`syncArchiveBranch()` 显式区分本地分支与 `source.branch` 远端目标；保留现有 Gate、提交范围及回读 |
| `agents/pr-status-sync-agent/instructions.md`、`skills/issue-closeout/SKILL.md`、`rondo/COMMANDS.md` | 更新 Checkout 目录、分组复用、返回值、Cleanup 与分支语义，不复制 CLI 规则 |
| 现有相关测试 | 覆盖 Checkout、幂等、Git 分支、并发与回读；更新受影响断言，不为本方案新建测试框架 |

仅当核实存在独立、错误的分支读取或重复身份限制时，再最小修改 `rondo/src/commands/tfs/writeback.ts`、`rondo/src/clients/native-checkout.ts`。`remote-artifacts.ts` 的 Bug/Remote 路径不动。

## 四、验收与停止条件

| 场景 | 预期 |
|---|---|
| 真实 Multica Task | 根仓直属 `workdir/<repo>`，无 `rondo-closeout-*` 父目录、Owner Marker 和额外 Clone |
| 同 Task 重复准备、同 Run 多 Issue | 复用 Checkout 与本地分支；每 Issue 独立 Archive、Push、Readback，不丢失未确认提交 |
| 来源分支不同 | `main` 的 Issue 归档到 `main`，`master` 的 Issue 归档到 `master`；各自 Fetch/Push/Readback 一致 |
| 本地共享分支被占用 | Task 隔离分支可准备，不借助 `--ignore-other-worktrees` |
| 跨 Run 并发、同 capability 冲突 | 不覆盖远端，分叉或非快进安全停止并可根据远端事实恢复 |
| Push 回执丢失、重试及历史批准版本 | 确认成功则幂等续跑；批准 Commit 不在目标分支祖先链则明确停止 |
| TFS Writeback / Complete | 仅在 `source.branch` 的真实归档确认后进行；Bug 行为不变 |

先通过现有 Rondo 自动化测试，再使用真实 Multica daemon 和可写测试仓库验证 Checkout、Archive、Push、远端 Readback 与 TFS Writeback/Complete。历史只读 Replay 不是完整写入验收。

## 五、预期收益

- 复用 Multica daemon Cache，降低大仓全量 Clone 成本；历史 Replay 中 Checkout 约 18 秒，而旧 Clone 为 396.46 秒，仅作为同场景参考。
- Rondo 不再维持第二套 Checkout 生命周期，减少路径、Owner Marker、Cleanup Token 与内部平台格式耦合。
- 每个 Issue 按批准的 `analysis.source.branch` 完成归档，保持 Analysis → Closeout → TFS Writeback 的分支事实一致。
- 不新增跨 Run 锁、Branch Registry、Archive Target Metadata 或通用恢复框架。

**后续实施以本方案为准；旧方案仅保留归档记录。**
