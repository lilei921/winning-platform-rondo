# PR Status Sync 耗时优化与根仓切换方案

> 状态：方案已 review，含阻断级问题修正；待实施。
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

## 二、真实环境验证（2026-11-23 14:14–14:15，已完成）

在 LEI-49 上通过评论触发真实 daemon task run `01a2070a-4796-7a93-8a93-c6553ed738e5`，只读验证：

| 验证项 | 结果 |
|---|---|
| task 凭证 `MULTICA_DAEMON_PORT` / `MULTICA_TOKEN` | 均为 True |
| 平台 `multica repo checkout` 在 task 内退出码 | **0，耗时约 18 秒** |
| checkout 路径 / 初始分支 | `verify-checkout/winning-platform-monorepo` / `agent/pr-status-sync-agent/c6553ed738e5` |
| `fetch origin master` | 退出码 0 |
| `git switch -c master origin/master` | 退出码 0，HEAD `09c04918` |
| 批准 commit `5e804cf…` 是 master 祖先 | 是（退出码 0） |
| 归档目录 `2026-11-21-variable-value-scope-query-267307` | 存在（退出码 0） |

**结论：平台 checkout → 切分支 → 校验链路在真实 task 内成立**；该 run 未做任何写入。

---

## 三、方案 Review 结论

### 3.1 阻断级问题（必须修正）

1. **`remote-artifacts.ts` 的 clone 不能删**。它是 Bug/无 root-repo 收口路径的 `--depth 1` 浅克隆（`finalize.ts:675-680,776`、`remote-artifacts.ts:165`），不是 395MB 全量。删除会破坏 Bug 收口。**本方案不涉及它。**
2. **`multica repo checkout` 会复用同名 checkout**。daemon 启动时已 checkout 到 agent 分支；Rondo 若在同一目录调用会拿到 agent 分支目录，切分支会干扰 agent。**Rondo 必须在独立子目录里调用 checkout**（先建子目录再 `cd` 进去）。
3. **`assertManagedLocation` 不兼容子目录**：`closeout-root.ts:22-26` 要求 `dirname(root) === owner.workdir`。子目录 checkout 时需让 `owner.workdir` 记录该子目录，或放宽为"是 workdir 的子目录"。
4. **`verifyCloseoutRoot` 的 `basename.startsWith("rondo-closeout-")` 必须改写**：平台 checkout 目录名为 `winning-platform-monorepo`，永不匹配。改为：位于受控子目录内 + 弱校验四条件。
5. **测试需可注入 backend**：`closeout-stage-a.test.mjs:83-251` 直接测 `cloneCloseoutRoot`，改为平台 checkout 后无法本地跑。需要抽象 `prepareRoot(source)` 接口，单测注入 fake。

### 3.2 需澄清/补充

| # | 问题 | 证据 |
|---|---|---|
| 6 | 迁移范围（已决定不做，见下文） | — |
| 7 | `requirementBranch()` 读环境变量 `RONDO_WORKSPACE_BRANCH`，不是硬编码 | `root-git.ts:78-82` |
| 8 | `git switch -c <branch> origin/<branch>` 非幂等，需 `git switch <branch> \|\| git switch -c <branch> origin/<branch>` | — |
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
| 存量 Issue 迁移 main→master | **不做** | `source.branch` 保持原值；根仓必须切到 `source.branch` 而不是硬编码 master |
| 非平台 fallback | **方案 B：彻底删除** | Rondo 收口只能在 Multica task 内运行 |
| 身份校验 | **弱方案 B + 强方案接口** | 四条件交叉验证；预留 manifest 接口 |

### 迁移不做的直接技术后果

存量 Issue（如 LEI-49）的 `analysis.source.branch = main`。因此：

- 根仓准备时**切换到 `source.branch`**（LEI-49 → `main`），而不是硬编码 master。
- `verifyGitRoot:96-97` 的 `HEAD == source.branch` **保持原样**，不需要改双模式。
- `routeArchive` 从 HEAD 派生分支 → 得到 `main`，push `origin main`；`confirmPublishedArchive` 从 `source.branch`(main) 回读 `origin/main`。远端 `main` 与 `master` 同指 `09c04918`，全部自洽。
- **前提**：远端 `main` 分支必须保留且与 `master` 持续对齐。若将来删除 `main`，则必须先做迁移。
- 结论：**不迁移反而让方案更简单**——`finalize.ts` 和 `verifyGitRoot` 都不必改。

> 若要长期统一到 master：再单独做 Phase 1 迁移（或让新分析写入 master），届时根仓切换目标自然跟随 `source.branch`，逻辑不变。

---

## 五、最终方案 · 分阶段

### Phase 1 · 数据迁移 —— **不做**

保留 `analysis.source.branch` 原值；依赖远端 `master = main` 对齐。写一条平台说明即可（"当前根仓按 source.branch 切换，main/master 同指"）。

### Phase 2 · 根仓来源重构（核心）

| 文件:行 | 改动 |
|---|---|
| `closeout-root.ts:130-166` | `cloneCloseoutRoot` 改为 `prepareRoot(source)`：①在 `workdir` 下建受控子目录（如 `closeout-<issue>/`）并 `cd` 进去；②调用 `multica repo checkout <url>`（解析文本返回路径）；③`git fetch origin refs/heads/<source.branch>`；④`git switch <source.branch> \|\| git switch -c <source.branch> origin/<source.branch>`；⑤写 token marker。**删除直接 `git clone` 路径** |
| `closeout-root.ts:17-27` | `Owner` 增加 `provenance/task_id/workspace_id/base_branch`；`assertManagedLocation` 改为校验 `root` 位于 `owner.workdir` 的受控子目录内 |
| `closeout-root.ts:64-82` | `verifyCloseoutRoot` 删除 `basename.startsWith("rondo-closeout-")` 硬检查，改为：目录在受控子目录内 + 弱校验四条件（`checkout-mode=isolated`、HEAD 分支尾号等于 `MULTICA_TASK_ID` 前 12 位、`MULTICA_WORKSPACE_ID`、`issue runs --active`）；若存在 `.git/multica-checkout.json` 则优先用它（强方案接口）；repo_url / branch / commit 检查保留 |
| `closeout-root.ts:84-105` | `verifyGitRoot` **保持原样**（HEAD == source.branch），不引入双模式 |
| `closeout-root.ts:168-209` | 平台根 cleanup **不 `rmSync`**（worktree 归 daemon），只验 token、释放 marker；删除 legacy clone 删除逻辑 |
| `native-checkout.ts:8-16` | 增加平台 checkout 只读校验入口（弱校验 + manifest 接口） |
| `finalize.ts` / `writeback.ts` | **不改**。根仓切到 `source.branch` 后，现有 `routeArchive`/`syncArchiveBranch`/`confirmPublishedArchive` 全部正确 |
| `remote-artifacts.ts` | **不改**（Bug 收口路径，见 review 第 1 条） |

### Phase 3 · 新写入固定 master —— **取消**

迁移不做，则新分析继续沿用 `RONDO_WORKSPACE_BRANCH` 当前值。统一 master 作为独立后续项，不并入本方案。

### Phase 4 · Agent / Skill / 测试

| 文件:行 | 改动 |
|---|---|
| `agents/pr-status-sync-agent/instructions.md:7` | 改为：在受控子目录运行 `multica repo checkout`，切到 `analysis.source.branch`，把返回路径作为 `--root-repo`；禁止 Agent 自行删平台 worktree；**不再有 395MB 全量 clone** |
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
- [x] 真实 task 验证核心链路（LEI-49 run `01a2070a-4796...`）
- [ ] 确认远端 `main` 分支保留且与 `master` 持续对齐（迁移不做的前提）
- [ ] 实现 `prepareRoot` 可注入接口 + fake backend
- [ ] 更新 `assertManagedLocation` / `verifyCloseoutRoot` / cleanup 三处
- [ ] 更新 agent instructions 与两个 SKILL
- [ ] 先跑 `rondo` 完整测试（含 fake backend 用例）
- [ ] 用 LEI-49 做真实 Multica Run 验收（不凭单元测试宣称 PASS）
