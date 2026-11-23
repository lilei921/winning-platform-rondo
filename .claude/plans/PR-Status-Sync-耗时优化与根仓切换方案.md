# PR Status Sync 耗时优化与根仓切换方案

> 状态：方案已形成，待用户确认两个设计选择后实施。
> 日期：2026-11-23
> 依据：run `01a20697`（2026-11-23 12:08:45–13:00:24）的 daemon 日志、codex 本地日志、thread_items 命令耗时，以及 Rondo 源码逐文件调研。

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
- 同轮对照：`multica repo checkout` 拉同一个 monorepo URL 只花 **21.6s**，因为它复用 daemon bare cache，是增量 worktree。

### 1.4 42 分钟僵死的根因（codex 本地日志）

- 12:17:58 采样流被重置（`os error 10054`）
- 12:18:05 SSE stream error ×3、12:18:11 HTTP GET 失败 ×6
- 12:18:14 `request timed out`，`responses_retry` 2/5，随后卡在连接 Responses WebSocket，再无日志
- daemon 全局 `agent_timeout=0s`、`idle_watchdog=2h`、`tool_watchdog=2h`、`codex_semantic_inactivity=2h` —— 所有看门狗都是 2 小时，42 分钟静默不会触发任何中止

---

## 二、已确认的关键事实

| 事实 | 证据 |
|---|---|
| TFS 远端默认分支是 master，master = main = `09c04918` | `git ls-remote --symref HEAD` → `refs/heads/master` |
| daemon bare cache 过期：HEAD 仍指向 main（`f77b9d0…`），需刷新 | `D:\Multica\default\.repos\<workspace>\winning-platform-*.git` |
| `sameAnalysisSource()` **不比较 branch**，只比 repo_url/commit/change_ref | `rondo/src/commands/analysis/source.ts:51-53` |
| 平台 checkout 的 HEAD 是 `agent/<agent>/<task-id前12位>`，不是 master | `.git/config` 有 `[multica] checkout-mode = isolated` |
| `finalize.ts:356-369` 从 **HEAD** 取分支用于归档推送，`:453-455` push 该分支；`confirmPublishedArchive` 从 `source.branch` 回读 | 直接用平台 checkout 会把归档推到 agent 分支再从 master 回读，必然失败 |
| 身份信号可用：`checkout-mode=isolated`、任务分支尾号、`MULTICA_TASK_ID/WORKSPACE_ID`、task root manifest；checkout 内无 owner marker | Explore 调研 |
| 还有第二条 clone 路径 `remote-artifacts.ts:156-166`（已有 `--depth 1`） | 要"彻底"需一并处理 |
| 生产调用 root-clone 只有一处 | `agents/pr-status-sync-agent/instructions.md:7` |

---

## 三、方案总览

### P0 · 立即止血（用户决定：**暂不处理**）

```powershell
multica config set agent_timeout 15m
multica config set agent_idle_watchdog 3m
multica config set agent_tool_watchdog 8m
multica config set codex_semantic_inactivity_timeout 3m
multica daemon restart
```

效果：本次场景 12:18:14 断连后约 3 分钟即可失败，总耗时 51 分钟 → 约 13 分钟。
注意：这是 daemon 全局配置，影响所有 agent run。

### P1–P4 · 彻底方案（当前待实施）

目标：根仓来源唯一化为 `multica repo checkout`（daemon bare cache + worktree，~22s）；`source.branch` 统一为 master；直接 `git clone` 降级为 fallback。

**注意：彻底方案只解决 clone 慢，不解决尾部 42 分钟僵死**（那是 P0 的范围）。

---

## 四、彻底方案 · 分阶段

### Phase 1 · 数据迁移

1. 批量把 active Requirement 的 `analysis.source.branch` 从 `main` 改为 `master`，commit 不变：
   ```
   multica issue metadata set <id> --key analysis.source --type string --value '<json>'
   ```
2. **不动** `analysis.human_approval.source`（里面 `branch=main` 是批准时的历史快照）、`dev.publication`、`pr_prep`。`sameAnalysisSource` 不比 branch，审批链不受影响。
3. 写迁移说明评论/metadata：注明"迁移时 main 与 master 同指 09c04918，仅更新追溯分支标签，commit 与批准内容未变"。
4. 刷新 daemon bare cache（执行一次 `multica repo checkout <url> --fresh`）。
5. 可仿 `rondo/src/commands/workspace/migrate-repo-keys.ts` 写带 dry-run + 回读的批量脚本。

### Phase 2 · 根仓来源重构（核心）

| 文件:行 | 改动 | 必须/可选 |
|---|---|---|
| `closeout-root.ts:17-27,64-82` | Owner 增加 `provenance/task_id/workspace_id/base_ref`；身份门接受平台 checkout，用 `checkout-mode=isolated` + 任务分支尾号 + `MULTICA_TASK_ID` + `issue runs --active` 交叉验证；仍拒绝任意用户目录 | 必须 |
| `closeout-root.ts:84-105` | `verifyGitRoot` 双模式：只读准入受控 agent 分支，写模式要求 HEAD 为目标分支或 marker 登记的 closeout 分支；commit 祖先、origin 校验保留 | 必须 |
| `closeout-root.ts:130-166` | `cloneCloseoutRoot` 默认改调 `multica repo checkout <url> --ref master`，解析文本返回路径，写自己的 token marker；直接 `git clone` 降级为 `--local-clone` fallback | 必须 |
| `closeout-root.ts:168-209` | 平台根 cleanup **不 rmSync**（worktree 归 daemon），只验 token、释放 marker；legacy clone 保留原删除逻辑 | 必须 |
| **`finalize.ts:326-351,356-369,445-456`** | **`syncArchiveBranch`/`routeArchive` 增加显式 `targetBranch = source.branch`，fetch/upstream/push 全部用它，HEAD 只作 provenance** | 必须 |
| `writeback.ts:761-776` | 接受平台根（经共享 verify），确认回读分支来自 `source.branch` | 必须 |
| `native-checkout.ts:8-16` | 增加平台 checkout 只读校验入口（manifest/branch/task binding），不求值 clone | 必须 |
| `remote-artifacts.ts:156-166` | 默认不再自行 clone，改走平台 checkout；仅显式 fallback 保留 | 可选（要彻底则必须） |
| `finalize.ts:674-686,778-779,814` | 保持强制 `--root-repo` 和 verify；向 archive/readback 传 source.branch | 必须 |

### Phase 3 · 新写入固定 master

| 文件:行 | 改动 |
|---|---|
| `analysis/complete.ts:186-204,217` | `analysis.source.branch` 显式固定 master，不取 agent HEAD |
| `runtime/root-git.ts:78-82,409-415` | `requirementBranch()` 默认值/环境变量改为 master |
| `dev/publish.ts:56-57` | 项目根仓分支校验对齐 master |
| `skills/issue-closeout/config/repo-registry.json:2-7`、`skills/pr-status-sync/config/repo-registry.json:2-7` | 如需启用远端工件模式，补 `runtime.root_branch="master"` |

### Phase 4 · Agent / Skill / 测试

| 文件:行 | 改动 |
|---|---|
| `agents/pr-status-sync-agent/instructions.md:7` | 改为 `multica repo checkout <url> --ref master` + `rondo runtime check-checkout`；禁止 Agent 自行删平台 worktree |
| `skills/issue-closeout/SKILL.md:10-12,17,25,33,39,47,56` | 声明根仓来自平台 checkout；所有命令复用同一 `--root-repo`；清理由平台负责 |
| `skills/workspace-preparation/SKILL.md:12-22,30-36,44-48` | Requirement 路径改为平台 checkout |
| `rondo/test/closeout-stage-a.test.mjs:83-251` | 增加平台 checkout fixture、任务绑定误判、cleanup 不删目录用例 |
| `rondo/test/08a-foundation.test.mjs:106-138` | 增加平台 checkout 形态测试 |
| `rondo/COMMANDS.md:257-263` | 更新 check-checkout/prepare-root/root-clone 契约说明 |

---

## 五、待用户拍板的设计选择

1. **身份校验强度**
   - **强方案**：请 Multica 平台在 checkout 的 `.git/multica-checkout.json` 写 owner manifest（workspace/task/agent/base_ref）。最干净，但需改平台（不在本仓库）。
   - **弱方案**（纯 Rondo 侧）：用现有 `checkout-mode=isolated` + 任务分支名尾号 + `MULTICA_TASK_ID` + `issue runs --active` 交叉验证。够用但依赖平台产物格式稳定。

2. **非平台环境 fallback**
   - 建议保留 `--local-clone` / `RONDO_CLOSEOUT_CLONE=local`，默认走平台 checkout。两条 backend 产出同一 `RuntimePaths` + 同一 owner marker schema，统一进 `verifyCloseoutRoot` → `routeArchive` → `confirmPublishedArchive`，不引入第二套状态机。
   - 另一选择：彻底删除本地 clone，Rondo 只能在 Multica 平台上收口。

---

## 六、预期收益

| 项 | 当前 | 方案后 |
|---|---:|---:|
| 根仓准备 | 396s | ~22s |
| 单次 run（clone 慢问题） | ~51min | ~10min（若同时做 P0） |
| 尾部僵死 | 42min | 仍存在，除非做 P0 |

---

## 七、实施前检查清单

- [ ] 用户确认身份校验强度（强/弱）
- [ ] 用户确认是否保留本地 clone fallback
- [ ] 刷新 daemon bare cache，确认 master 引用为 09c04918
- [ ] 盘点所有 active Requirement 的 `analysis.source.branch=main` 的 Issue
- [ ] 迁移前备份 metadata（可回读原值）
- [ ] 更新测试 fixture，先跑 `rondo` 完整测试
- [ ] 用 LEI-49 做真实 Multica Run 验收（不凭单元测试宣称 PASS）
