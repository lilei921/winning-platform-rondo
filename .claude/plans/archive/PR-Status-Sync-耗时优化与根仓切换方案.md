# PR Status Sync 耗时优化与根仓切换方案

> 状态：真实 task 只读验证已完成。组内顺序复用已有本地验证，跨 Run 同分支收口仍有阻断项，真实写入验收待完成。
> 日期：2026-11-23
> 依据：run `01a20697`（2026-11-23 12:08:45–13:00:24）的 daemon 日志、codex 本地日志、thread_items 命令耗时，Rondo 源码逐文件调研，以及 LEI-49 真实 task 验证。

---

## 一、问题诊断

### 1.1 总览

| 项 | 值 |
|---|---:|
| 平台记录总耗时 | 51分39秒（12:08:45 → 13:00:24） |
| 状态 | failed（`task failed`） |
| Agent 有效活动时间 | 9分05秒（12:08:44 → 12:17:49） |
| 静默僵死时间 | **42分35秒（82.4%）** |

### 1.2 有效执行期耗时分解

| 阶段 | 时间 | 耗时 |
|---|---|---:|
| 启动（claimed → runtime_started） | 12:08:44–12:08:45 | 0.5s |
| 环境探测（17 条小命令） | 12:09:00–12:10:22 | ~82s |
| `rondo pr reconcile-status` | 12:10:22 | 2.2s |
| **`rondo delivery root-clone`** | 12:10:35–12:17:11 | **396.5s** |
| Prepare 17.4s + TFS Writeback inspect 8.7s | 12:17:17–12:17:49 | 26s |

30 次 `exec_command` 累计 458s，clone 一项占 86.5%；72 次 `reasoning`，推理约 86s；`skills_ready` 只有 47ms。

### 1.3 clone 为什么耗时 396 秒

- `rondo/src/commands/delivery/closeout-root.ts:137-138`：`git clone --single-branch --no-tags --branch <branch>`，**无 `--depth`/`--filter`**，超时硬编码 20 分钟。
- 残留产物实测：pack **394.7 MB**、27,862 个对象、1,336 个 commit，工作区仅 20 MB —— 98% 流量是历史对象。
- 395 MB ÷ 396 s ≈ **1 MB/s**（到 TFS 2018 内网 HTTP 的实际吞吐）。
- 同轮对照：`multica repo checkout` 拉同一个 monorepo URL 只花 **21.6s**，因为它复用 daemon bare cache。

### 1.4 42 分钟僵死的根因（codex 本地日志）

- 12:17:58 采样流被重置（`os error 10054`）
- 12:18:05 SSE stream error ×3、12:18:11 HTTP GET 失败 ×6
- 12:18:14 `request timed out`，`responses_retry` 2/5，随后卡在连接 Responses WebSocket，再无日志
- daemon 全局 `agent_timeout=0s`、`idle_watchdog=2h`、`tool_watchdog=2h`、`codex_semantic_inactivity=2h` —— 所有看门狗都是 2 小时，42 分钟静默不会触发任何中止

---

## 二、真实环境验证（2026-11-23，已完成只读验证）

2026-11-23 14:14–14:15，在 LEI-49 上通过评论触发真实 daemon task run `01a2070a-4796-7a93-8a93-c6553ed738e5`，完成以下只读验证。

| 验证项 | 结果 |
|---|---|
| task 凭证 `MULTICA_DAEMON_PORT` / `MULTICA_TOKEN` | 均为 True |
| 平台 `multica repo checkout` 在 task 内退出码 | **0，耗时约 18 秒** |
| checkout 路径 / 初始分支 | `verify-checkout/winning-platform-monorepo` / `agent/pr-status-sync-agent/c6553ed738e5` |
| `fetch origin master` | 退出码 0 |
| `git switch -c master origin/master` | 退出码 0，HEAD `09c04918` |
| 批准 commit `5e804cf…` 是 master 祖先 | 是（退出码 0） |
| 归档目录 `2026-11-21-variable-value-scope-query-267307` | 存在（退出码 0） |

该 Run 证明单个 checkout 能检出当时可用的 `master`，并校验批准 commit 和归档目录。LEI-49 实际收口目标为 `analysis.source.branch = main`。

### 2.1 实施期真实 run 修正（2026-11-23 15:39–15:52，LEI-49 两轮验收）

| 发现 | 实测事实 | 方案修正 |
|---|---|---|
| checkout 输出分流 | 根仓路径写 **stdout**；`Checked out … (branch: …)` 写 **stderr** | Rondo 同时解析 stdout + stderr；不能再只读 stdout |
| linked worktree 形态 | 新版 daemon（0.11.1）的 checkout 是 linked worktree。`.git` 文件指向 `<repo>.git/worktrees/<name>`，多个 worktree 的 `--git-common-dir` 同为 `.repos/<workspace-id>/<repo>.git`。该形态无 `[multica] checkout-mode=isolated` | 身份证据改为：完整 checkout 读 `[multica] checkout-mode=isolated`；linked worktree 用「公共目录位于 `.repos/<workspace-id>/`」+「workdir 下 `.multica/daemon_task_context.json` 的 managed_by/issue/agent 匹配」判定 isolated |
| 环境变量 | 当前 daemon task 环境**没有** `MULTICA_REPO_CHECKOUT_MODE` | **用户决定：删除该校验**，不再依赖该环境变量；`MULTICA_TASK_ID` / `MULTICA_WORKSPACE_ID` 仍保留 |
| 分支尾号 | 平台分支为 `agent/<agent>/<MULTICA_TASK_ID 去连字符后的末 12 位>`；同一 Task 再次 checkout 会追加 `-<时间戳>` | 尾号按**末 12 位**核对，并允许纯数字时间戳后缀；拒绝其它后缀 |
| 本地分支落后 | daemon bare cache 中已有同名本地分支且可能落后于远端（LEI-49 实测 `main=7af3c09b`、`origin/main=09c04918`）；`git switch main` 会复用旧本地分支 | switch 后必须比较本地与 `origin/<branch>`：落后则 `git merge --ff-only` 快进；分叉或快进失败即拒绝 |
| prepare 耗时 | 失败发生在解析阶段，退出前实测约 7.8s（平台 checkout 已完成） | 解析修复后该阶段仍为秒级，无全量 clone |

### 2.2 补充验证（2026-11-23）

| 场景 | 证据与结果 |
|---|---|
| 真实 Multica 缓存中 `main` 的占用情况 | 只读检查 LEI-49 的 monorepo bare cache。`git worktree list --porcelain` 显示 `rondo-closeout-LEI-49-2WkkkR/winning-platform-monorepo` 仍检出 `refs/heads/main`，HEAD 为 `7af3c09b`，工作目录存在，未发现 Rondo 所有权标记。另一 LEI-49 checkout 位于同一个 `--git-common-dir`，HEAD 仍在 `agent/...`。缓存中的 `origin/main` 和 `origin/master` 均为 `09c04918`。 |
| 单个 worktree 切到 `main` 并提交 | 在临时 bare cache 下建立两个 linked worktree。`main` 可用时，A 执行 `git switch main` 和 `git commit` 均成功。B 能读到 A 更新后的共享 `refs/heads/main`，B 自己的 HEAD 仍在 agent 分支。 |
| 同一 Run 的多个 Issue 顺序复用一个根仓 | PR Status Sync Agent 按 `analysis.source.repo_url + branch` 分组，每组准备一次，逐条复用同一 worktree。每个 Issue 的提交、push 和远端回读完成后，下一个 Issue 从更新后的 HEAD 继续。`closeout-stage-a.test.mjs` 已覆盖 3 个 Issue 共用根仓，分别模拟归档、提交、push 并确认各自的远端目录。 |
| 同一 bare cache 的两个 worktree 切同一个分支 | A 检出 `main` 后，B 执行 `git switch main` 返回 128，报 `main is already used by worktree`。A 离开 `main` 后，B 才能切入，并会读到 A 留在本地 `main` 的未推送提交。 |
| 两个独立本地分支推同一个远端 `main` | A、B 从同一基线各提交一个不同文件。A 普通 push 成功，B 返回 1，被 Git 拒绝。B 的本地提交仍在。在最新远端基线上重新应用 B 的变更并 push，回读确认两个文件均在远端。 |

**本地分支占用**。linked worktree 可以在可用的 `main` 上正常提交。同一 bare cache 下，普通 `git switch` 拒绝检出其他 worktree 已占用的分支。`root-cleanup` 只删除所有权标记，已切到 `main` 的 worktree 在切离或被 daemon 移除前会继续占用该分支，串行启动的后续 Run 也可能卡在 `root-prepare`。现有 `switch -c` 回退会因同名分支已存在而失败。[Git switch](https://git-scm.com/docs/git-switch) · [Git worktree 引用规则](https://git-scm.com/docs/git-worktree#_refs)

**远端发布竞争**。不同缓存或独立本地分支均可先提交，随后争用同一个远端分支。即使两个 Issue 改动的文件完全不同，先发布的一方也会更新远端基线，后发布的一方可能在推送前检测到分叉，或收到 push 拒绝。两个 Issue 触及同一个 `openspec/specs/<capability>/` 时，还需要用最新基线检查归档后的规格内容。Rondo 构建及 4 项现有针对性测试通过，覆盖清理所有权标记、已有分叉、归档期间远端推进和 push 竞争。[Git push 规则](https://git-scm.com/docs/git-push#_push_rules)

### 2.3 上线前需补齐的保护与验收

- **根仓分支**。继续复用 daemon bare cache。每个 Run 的仓库与目标分支分组共用一个归档 worktree 和从最新 `origin/<source.branch>` 建立的本地归档分支，组内按 Issue 顺序提交、推送和回读。不同 Run 使用各自的本地归档分支。所有权校验分别核验本地归档分支与 `analysis.source.branch`。fetch、普通 push（`HEAD:refs/heads/<source.branch>`）和远端回读均显式使用 `source.branch`。禁止用 `--ignore-other-worktrees` 绕过 Git 的分支占用保护。
- **发布顺序**。同一远端仓库和目标分支的归档发布需跨 Run 串行，范围覆盖获取最新基线、门禁复核、归档提交、push 和远端回读。当前 `RootLock` 位于各自 worktree 下，Agent 的组内顺序也只覆盖单个 Run。外部写入仍可能推进远端，遇到分叉或 push 拒绝时保留提交与 pending，重新核验最新基线后再恢复。确认远端归档后方可推进 TFS 写回或关闭 Issue。
- **写入验收（待做）**。用真实 Multica daemon 和可写测试仓库，验证同一个 Run 在同一根仓内依次归档两个 Issue。再让同一 Workspace 的两个 Run 对同一目标分支并发发起归档，分别覆盖不同 capability 和同一 capability，确认后发布的 Issue 基于最新提交继续，远端保留两份归档且规格正确。补测首个 Run 完结后 worktree 尚存，以及归档完成但 push 前远端被外部推进的恢复路径。另需核验实际 TFS 目标分支的服务账号推送权限和分支策略。

---

## 三、方案 Review 结论

### 3.1 阻断级问题（必须修正）

1. **`remote-artifacts.ts` 的 clone 不能删**。它是 Bug/无 root-repo 收口路径的 `--depth 1` 浅克隆（`finalize.ts:675-680,776`、`remote-artifacts.ts:165`），不是 395MB 全量。删除会破坏 Bug 收口。**本方案不涉及它。**
2. **`multica repo checkout` 会复用同名 checkout**。daemon 启动时已 checkout 到 agent 分支；Rondo 若在同一目录调用会拿到 agent 分支目录，切分支会干扰 agent。**Rondo 必须在独立子目录里调用 checkout**（先建子目录再 `cd` 进去）。
3. **`assertManagedLocation` 不兼容子目录**：`closeout-root.ts:22-26` 要求 `dirname(root) === owner.workdir`。子目录 checkout 时需让 `owner.workdir` 记录该子目录，或放宽为"是 workdir 的子目录"。
4. **`verifyCloseoutRoot` 的 `basename.startsWith("rondo-closeout-")` 必须改写**：平台 checkout 目录名为 `winning-platform-monorepo`，永不匹配。改为：位于受控子目录内 + 弱校验（isolated 平台证据、Task/Workspace、分支尾号、活跃 Run；详见 2.1 修正）。
5. **测试需可注入 backend**：`closeout-stage-a.test.mjs:83-251` 直接测 `cloneCloseoutRoot`，改为平台 checkout 后无法本地跑。需要抽象 `prepareRoot(source)` 接口，单测注入 fake。

**跨 Run 的共享分支占用与并发发布是上线阻断项**。当前实现直接切到 `source.branch`，会占用共享本地分支，现有锁只覆盖单个 worktree。按第 2.3 节补齐分支隔离和发布顺序，再做同 Run 和跨 Run 的真实写入验收。

### 3.2 需澄清/补充

| # | 问题 | 证据 |
|---|---|---|
| 6 | 迁移范围（已决定不做，见下文） | — |
| 7 | `requirementBranch()` 读环境变量 `RONDO_WORKSPACE_BRANCH`，不是硬编码 | `root-git.ts:78-82` |
| 8 | 从远端引用建立独立本地归档分支，校验重试时对应的 Run 和提交基线 | 第 2.3 节 |
| 9 | 弱校验依赖平台 API `issue runs --active`，平台故障时收口会失败 | 第五节 |
| 10 | 平台 checkout 工作区必须干净才能 switch | — |
| 11 | `root-clone` 命令名与实现语义脱节，建议改名 `root-prepare` 或文档说明 | `instructions.md:7` |

### 3.3 已验证正确的假设

- 平台 checkout 的 origin / push URL 是真实 TFS 地址，且恰好 1 个 → `verifyGitRoot:91-94` 能过
- push 认证由 Rondo `runAuthenticatedRootGit` 注入（`finalize.ts:72-81`），不依赖平台 checkout 自带 credential
- master 包含批准 commit 和归档目录
- `sameAnalysisSource` 不比 branch（`analysis/source.ts:51-53`）

---

## 四、已确认决策

| 决策 | 结论 | 影响 |
|---|---|---|
| P0 超时配置 | **暂不做** | 尾部 42 分钟僵死仍存在，最坏情况仍是 ~51 分钟 |
| 存量 Issue 迁移 main→master | **不做** | `source.branch` 保持原值，作为远端发布和回读目标 |
| 非平台 fallback | **方案 B：彻底删除** | Rondo 收口只能在 Multica task 内运行 |
| 身份校验 | **弱方案 B + 强方案接口** | 交叉验证：isolated 平台证据（完整 checkout 配置 / daemon cache worktree + 任务上下文）、Task/Workspace、分支尾号、`issue runs --active`；预留 manifest 接口；**不使用 `MULTICA_REPO_CHECKOUT_MODE`** |

### 迁移不做的直接技术后果

存量 Issue（如 LEI-49）的 `analysis.source.branch = main`。因此：

- `source.branch` 是远端归档和回读的目标分支（LEI-49 → `main`）。归档 worktree 的本地分支按第 2.3 节独立管理。
- `verifyGitRoot` 需要核对本地归档分支的所有权以及批准 commit 的可达性。归档推送和 `confirmPublishedArchive` 的回读均使用 `source.branch`。
- **前提**：远端 `main` 分支必须保留且与 `master` 持续对齐。若将来删除 `main`，则必须先做迁移。

> 若长期统一到 `master`，单独做迁移，归档发布目标仍跟随 `source.branch`。

---

## 五、最终方案 · 分阶段

### Phase 1 · 数据迁移 —— **不做**

保留 `analysis.source.branch` 原值作为远端发布目标。`main` 和 `master` 在缓存快照中同指一个提交，发布到其中一条后需要平台同步才能持续对齐。

### Phase 2 · 根仓来源重构（核心）

| 文件:行 | 改动 |
|---|---|
| `closeout-root.ts:130-166` | `prepareRoot(source)` 在 `workdir` 下建受控子目录，调用 `multica repo checkout <url>` 并从 stdout/stderr 解析路径和分支。显式 fetch `source.branch` 后，当前代码直接切换共享本地目标分支。按第 2.3 节改为从远端引用建立独立本地归档分支，并写入所有权标记。 |
| `closeout-root.ts:17-27` | `Owner` 增加 `provenance/task_id/workspace_id`；`assertManagedLocation` 改为校验 `root` 位于 `owner.workdir` 的受控子目录内 |
| `closeout-root.ts:64-82` | `verifyCloseoutRoot` 删除 `basename.startsWith("rondo-closeout-")` 硬检查，改为：目录在受控子目录内 + 弱校验（isolated 平台证据、`MULTICA_TASK_ID` / `MULTICA_WORKSPACE_ID`、分支尾号=Task ID 末 12 位且允许 `-<时间戳>`、`issue runs --active`）；若存在 `.git/multica-checkout.json` 则优先用它（强方案接口）；repo_url / branch / commit 检查保留 |
| `closeout-root.ts:84-105` | `verifyGitRoot` 当前要求 `HEAD == source.branch`，改用独立归档分支时按第 2.3 节修订。 |
| `closeout-root.ts:168-209` | 平台根 cleanup **不 `rmSync`**（worktree 归 daemon），只验 token、释放 marker；删除 legacy clone 删除逻辑 |
| `native-checkout.ts:8-16` | 增加平台 checkout 只读校验入口（弱校验 + manifest 接口） |
| `finalize.ts` / `writeback.ts` | `routeArchive` 当前从本地 HEAD 识别远端目标并传给 `syncArchiveBranch`，需按第 2.3 节显式传入目标分支并串行发布。`confirmPublishedArchive` 已按 `source.branch` 回读。继续验证 `writeback.ts` 以远端归档事实为前提。 |
| `remote-artifacts.ts` | **不改**（Bug 收口路径，见 review 第 1 条） |

### Phase 3 · 新写入固定 master —— **取消**

迁移不做，则新分析继续沿用 `RONDO_WORKSPACE_BRANCH` 当前值。统一 master 作为独立后续项，不并入本方案。

### Phase 4 · Agent / Skill / 测试

| 文件:行 | 改动 |
|---|---|
| `agents/pr-status-sync-agent/instructions.md:7` | 在受控子目录运行 `multica repo checkout`，按第 2.3 节准备独立本地归档分支，返回路径作为 `--root-repo`。平台管理 worktree 生命周期。 |
| `skills/issue-closeout/SKILL.md:10-12,17,25,33,39,47,56` | 声明根仓来自平台 checkout；所有命令复用同一 `--root-repo`；清理由平台负责 |
| `skills/workspace-preparation/SKILL.md:12-22,30-36,44-48` | Requirement 根仓路径改为平台 checkout |
| `rondo/test/closeout-stage-a.test.mjs:83-251` | 抽象 `prepareRoot` 接口，注入 fake checkout backend；覆盖：受控目录、分支切换幂等、身份误判拒绝、cleanup 不删目录 |
| `rondo/test/08a-foundation.test.mjs:106-138` | 增加平台 checkout 形态测试 |
| `rondo/COMMANDS.md:257-263` | 更新 `root-clone`（建议改名 `root-prepare`）契约说明 |

---

## 六、预期收益

| 项 | 当前 | 方案后 |
|---|---:|---:|
| 根仓准备（Requirement） | 396s | **约 18s（真实 task 实测）** |
| 单次 run（clone 已解决） | ~51min（含 42min 僵死） | clone 不再主导；**但尾部僵死仍在，最坏仍 ~51min，除非做 P0** |
| Bug 收口 | 不受影响 | 不受影响 |

**风险提示**：只做本方案、不做 P0，下次网络断连仍会出现 ~42 分钟僵死。届时配置三行 `multica config set` + `daemon restart` 即可收敛。

---

## 七、实施前检查清单

- [x] 用户确认身份校验强度（弱方案 B + 强方案接口）
- [x] 用户确认非平台 fallback（方案 B：彻底删除）
- [x] 用户确认迁移（不做）
- [x] 用户确认 P0（暂不做）
- [x] 真实 task 只读验证 checkout、切到 `master`、核对 commit 和归档目录（LEI-49 run `01a2070a-4796...`）
- [x] 只读核实真实 Multica bare cache 的 `main` 占用，使用临时仓库复现 worktree 分支占用与远端发布竞争
- [ ] 完成独立归档分支、跨 Run 发布串行和远端推进后的恢复保护
- [ ] 确认远端 `main` 分支保留且与 `master` 持续对齐（迁移不做的前提）
- [ ] 实现 `prepareRoot` 可注入接口 + fake backend
- [ ] 更新 `assertManagedLocation` / `verifyCloseoutRoot` / cleanup 三处
- [ ] 更新 agent instructions 与两个 SKILL
- [ ] 先跑 `rondo` 完整测试（含 fake backend 用例）
- [ ] 在真实 Multica daemon 和可写测试仓库完成同 Run 顺序归档、跨 Run 并发归档及恢复验收（见第 2.3 节）
