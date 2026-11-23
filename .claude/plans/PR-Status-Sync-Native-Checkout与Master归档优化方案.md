# PR Status Sync — Native Checkout 与 Master 归档优化方案

> 日期：2026-11-23  
> 状态：方案已保存，待实施与真实写入验收  
> 仓库：`lilei921/winning-platform-rondo`  
> 原则：第一性原理、KISS、YAGNI、Native First、One Rule One Owner、Specialist Focus  
> 范围：Requirement Closeout 的根仓准备、OpenSpec Archive、Git 发布与校验；**不修改代码、不实施本方案**。  
> 旧版研究与实验记录见 [归档版：PR-Status-Sync-耗时优化与根仓切换方案](archive/PR-Status-Sync-耗时优化与根仓切换方案.md)，仅保留历史证据，不作为本次实施基线。

## 一、目标与边界

**目标**：复用 Multica 原生 `repo checkout` 和 daemon bare cache，将根仓直接置于当前 Task 的 `workdir/<root-repo-name>/`，从最新远端 `master` 基线执行 OpenSpec 归档，并明确向远端 `master` 发布、回读；删除 Rondo 对 Checkout 生命周期的重复管理。

本次不做：旧 Issue 的 `analysis.source.branch` 数据迁移、Bug 收口链路改造、Engineer Worktree 改造、跨 Run 分布式锁、Runtime 超时配置（该问题另立处理）、新的 Manifest/Registry 或复杂自动恢复框架。

**最小正确性条件**：根仓与授权仓库一致；Worktree 可安全切换；批准 Commit 可达；只提交本 Issue 授权变更；Push 到预期远端目标；远端 Archive 回读确认后才进行 TFS Writeback/Complete。

## 二、已核实的事实

### 2.1 Replay 与性能

- `projects/replay/20261123-pr-status-sync-352455e42d54`：2026-11-23 12:08 Run 的 `root-clone` 耗时 396.46 秒，完成 Prepare 和 TFS Inspect 后 Session 中断，实际 Writeback/Complete/清理未执行；当轮平台 checkout 已在 `workdir/winning-platform-monorepo/` 直接得到根仓。
- `projects/replay/20261123-LEI-49`：14:14 只读 Run 里 Multica checkout 约 18 秒，`fetch origin master`、`switch -c master origin/master`、批准 Commit 祖先验证与归档目录核对成功；**仅证明只读链路，不等于写入验收通过**。
- LEI-49 后续三轮真实验证依次暴露：checkout 路径/分支分流到 stdout/stderr；linked worktree 无 `multica.checkout-mode`；共享本地 `main` 落后远端 28 个 Commit。三轮均未完整收口。
- `verify-checkout/` 是验证时人工创建的目录；现行 Rondo `closeout-root.ts` 实际创建 `rondo-closeout-<issue>-*/<repo>/`，不是期望路径。

### 2.2 必须规避的 Git 行为

- Multica 新版 checkout 可为 linked worktree，多个 Worktree 共享 bare cache。
- 一个 Worktree 检出本地 `master` 后，其他 Worktree 不能同时正常 `git switch master`；不能用 `--ignore-other-worktrees` 绕过保护。
- 两个 Run 从同一远端基线独立提交并 Push，后发者可能收到 Non-Fast-Forward 拒绝；安全拒绝优于覆盖。
- 当前 `routeArchive()` 按本地 HEAD 分支确定 Push 目标；切为 Task 专属分支后必须显式将远端目标固定为 `master`。

## 三、目标架构与职责

```text
<Multica Task Workdir>/
├── .multica/daemon_task_context.json
├── .claude/
├── AGENTS.md
└── winning-platform-monorepo/     # multica repo checkout 返回的实际路径
    ├── .git                       # 可为 linked-worktree gitfile
    └── openspec/
        ├── changes/
        └── specs/
```

- **Multica**：Checkout 创建与复用、bare cache/worktree 生命周期。Rondo 不额外 mkdir `verify-checkout` 或 `rondo-closeout-*` 目录，不删除平台 worktree。
- **Rondo root-prepare**：使用当前 Task workdir 调用/复用 `multica repo checkout <repo-url>`，以 CLI 返回的绝对路径为准，验证路径与任务上下文/Origin，Fetch `origin/master`，准备 Task 隔离归档分支，验证批准 Commit。该命令只返回需要的 `root_repo` 等有效信息，不再提供 `cleanup_token`。
- **Rondo finalize**：执行授权范围内的 Archive、Commit、Push 到 **远端 master**、远端 Readback，保留必要业务 Gate。
- **Multica Task/Daemon**：负责 Worktree 回收；Rondo 不通过 marker/token 模拟另一套所有权协议。

**不要把远端 master 与本地 master 混为一谈**。本地推荐从最新 `origin/master` 建立 `rondo/archive/<task-id>`（或经过验证可用的平台 Task 专属分支）作为归档工作分支，发布使用 `HEAD:refs/heads/master`。若希望直接复用平台原生 `--ref master`，必须先验证真实 daemon 的 Checkout、重复调用、linked worktree 和分支占用语义；未验证前不作为前置假设。

## 四、实施步骤

### P0 — 目录与生命周期归属

1. 调整 `rondo/src/commands/delivery/closeout-root.ts`：在 Task workdir 直接 Checkout，根仓直属 workdir；重复调用复用本 Task 已存在的有效 Checkout，不创建第二个受控目录。
2. 删除 `rondo-closeout-*` 前缀校验、`rondo-closeout-owner.json`、`Owner`/token 和仅释放标记的 `root-cleanup`；清理无在途依赖的 `root-clone` 兼容别名。历史实验/残留目录不自动删除。
3. 保留最小、安全且有实际业务意义的验证：根仓真实路径处于当前 Task workdir 直属目录、当前 Task/Workspace 上下文可核实、Git Origin/Push URL 对应 `source.repo_url`、工作区干净、分支合法。
4. 不依赖平台内部 agent 分支尾号、时间戳或可选 checkout-mode 配置来重复推断所有权；平台返回路径和当前 Task 上下文是入口证据，Git 身份与内容才是业务校验。

**边界**：如 workdir 下已有平台 Checkout 且有未提交改动或正在被本 Task 其它流程使用，禁止强制切换、清理或重置；返回可诊断错误，不转而自行 Clone。

### P1 — 远端 master 的端到端契约

1. `analysis.source.branch` 仅作为**批准来源分支**，`analysis.source.commit` 为固定批准版本；现存 LEI-49 等历史 Issue 不改写其 metadata。
2. 对 Requirement Closeout 显式采用远端 `master` 作为 **Archive Target**。先 Fetch `origin/master`，要求 `source.commit` 是归档基线的祖先，并核对 Change 的活跃/归档目录唯一性。
3. 本地归档分支使用 Run/Task 作用域，避免争抢共享本地 `refs/heads/master`。同 Run 同仓库统一目标分支的多个 Issue 顺序使用同一 Worktree；逐 Issue Commit、Push、Readback。
4. 修改 `finalize.ts` 的 `routeArchive` / `syncArchiveBranch`，禁止从 `symbolic-ref HEAD` 推导远端目标；显式 Fetch、对齐、普通 Push `HEAD:refs/heads/master`。
5. `closeout-root.ts` 的 `verifyGitRoot`/ `confirmPublishedArchive` 以及 `tfs/writeback.ts` 必须使用一致的远端 `master` 回读；本地 HEAD 可以是 Task 专属分支。
6. 只有远端 Archive 路径唯一、内容与本地发布版本一致，并且 Prepare 标记回读通过，才允许 TFS Writeback；Complete 再次核实远端归档与 TFS 真实状态。
7. 后续新分析的权威分支是否统一为 `master` 属于独立切换工作；本次不隐式依赖 `main` / `master` 长期同步。

### P2 — 并发、安全恢复与约束

- 同 Run 逐 Issue 顺序处理；跨 Run 不增加分布式锁，依赖 Git Fast-Forward / Non-Fast-Forward 保护。不使用 force push。
- 远端在 Gate 后前进、Push 拒绝或本地发生分叉：先 Readback 判定本次是否已成功发布；未确认时返回 `UNKNOWN`，保留提交和 `finalize.pending`，从最新远端重新核验后恢复。**不自动 rebase 或覆盖他人提交**。
- 同 capability 的并发归档尤其需要复核 `openspec/specs/<capability>/` 最终内容，不能仅比较归档目录是否存在。
- 保留现有 PR Transition、变更范围/提交范围、远端 Readback、TFS Writeback 和 Complete 的必要 Gate；不重跑上游 Analysis/Engineer 质量 Gate。

## 五、文件范围

| 文件 | 变更 |
|---|---|
| `rondo/src/commands/delivery/closeout-root.ts` | Native Checkout 直放 workdir、最小身份校验、Task 隔离分支、master Readback；删除自定义 owner/cleanup |
| `rondo/src/clients/native-checkout.ts` | 精简重复且依赖平台内部格式的身份辅助检查 |
| `rondo/src/commands/delivery/finalize.ts` | 远端 master 显式发布目标；修正 `routeArchive`、`syncArchiveBranch` |
| `rondo/src/commands/tfs/writeback.ts` | 与统一远端归档校验契约保持一致 |
| `agents/pr-status-sync-agent/instructions.md` | 根仓分组/复用、删除 marker/cleanup 描述 |
| `skills/issue-closeout/SKILL.md` | 简化来源说明，保留 Prepare → TFS Writeback → Complete |
| `rondo/COMMANDS.md` | 更新 `root-prepare` 参数、输出与约束 |
| `rondo/test/closeout-stage-a.test.mjs`、`rondo/test/08a-foundation.test.mjs`、`rondo/test/finalize-contract.test.mjs` 等 | 目录、分支、跨 Run 竞争与恢复回归 |

`remote-artifacts.ts` 的 Bug/无 root-repo 路径不变；不扩散到其它 Agent 或多仓开发流程。

## 六、验收标准

| 场景 | 成功条件 |
|---|---|
| 真实 daemon Checkout | 根仓直属 `workdir/<repo>`，不新增 `rondo-closeout-*`，不触发完整 Git Clone |
| Task 内重复调用 | 不二次创建 Worktree、不清理或覆盖已有工作 |
| local master 被占用 | 使用独立本地分支，仍可从 `origin/master` 准备 |
| 历史 `source.branch=main` | 批准 Commit 在 master 祖先链中时可归档到 master，否则明确拒绝 |
| 单 Run 多 Issue | 每 Issue Archive、Commit、master Push、Readback 正确，顺序复用根仓 |
| 两个 Run 并发 | 不覆盖远端已有提交，冲突时安全停机/可恢复；验证不同和相同 capability |
| 已归档或 Push 响应丢失 | 确认远端事实后幂等续跑，不重复制造 Change |
| TFS Writeback/Complete | 仅在远端 master 归档确认后进行，状态回读一致 |
| Bug Closeout | 行为与现有实现一致 |

需分别完成自动化测试（包含 linked worktree 模拟）和真实 Multica daemon + 可写测试仓库验收。只读 Replay 成功不能替代真实 Archive/Push/TFS 完整闭环。

## 七、预期收益与决策

- 以 Multica daemon bare cache 取代旧全量 Clone；Replay 中同源 checkout 约 18–22 秒，而旧 Clone 为 396.46 秒（仅为实测参考，不保证所有环境同等耗时）。
- Checkout 目录结构与平台原生机制一致；减少临时目录、标记、清理协议和平台内部格式耦合。
- 归档目标明确为远端 `master`，本地 Task 分支隔离避免共享 `master` 占用。
- 不引入跨 Run 锁；接受 Git 原生的安全冲突与显式恢复。
- 原 Replay 另有约 42 分钟 Session 断连僵死问题，不属于本次根仓优化，避免将它误算为 Checkout 收益。

**决策**：以本文为后续实施基线；历史方案直接归档，不再修订。实施前必须先验证原生 Checkout 在 Task workdir 的重复调用行为，之后按 P0 → P1 → P2 完成最小修改与真实验收。
