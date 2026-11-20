---
title: Single Squad · Multi Runtime PoC — 验证结果 (2026-10-14)
status: in-progress
contract: single-squad-multi-runtime-poc
owners: llei921
multica_workspace: multica-single-squad
multica_workspace_id: cabca166-0b02-4551-8ce6-b8a2bb5b39b6
sop: projects/multica/validation/single-squad-multi-runtime-poc.md
date: 2026-10-14
---

# Single Squad · Multi Runtime PoC — 验证结果

> 本文件按 `docs/multica/validation/single-squad-multi-runtime-poc.md` v1.1.0 跟踪测试进展,
> 状态字段一律从 SOP 默认 `NOT_RUN` 开始,
> 必须有真实 Run ID、Runtime ID、Daemon ID、cwd、git SHA、git status 才写 PASS。

## 0. 环境快照

| 对象 | 值 |
|---|---|
| Multica CLI | 0.6.2 (commit `7ab92d7622ecd81d179a8d83ae2dea74835a5069`) |
| Daemon 标识 | `01a1388d-0bb8-71cf-9345-91b2cf078618` (server-97 / test220-pg-db1) 当前 session |
| Workspace | `multica-single-squad` (`cabca166-0b02-4551-8ce6-b8a2bb5b39b6`) |
| Project (Linux) | `winning-platform-monorepo` (`9aa7f581-0a55-4562-a8b1-41d19406a188`),资源 `7833c79f-...` → `/root/workspace/winning-platform-monorepo`(in_place) |
| Project (Windows) | `winning-platform-monorepo-fire` (`ff3d8c17-0e4e-49cd-ba48-c6772bc095e2`),资源 `235034e7-...` → `D:\UserProgram\winning-platform-monorepo-fire`(in_place) |
| Squad | `PoC Squad (multica-single-squad)` (`acff463b-1fed-4cae-b6dd-16731a53c9e1`) |
| Lead Agent | `POC Lead` (`6b205cc6-ee94-45d5-9e72-3e17273cd29f`),runtime `b68c6447-...` (server-97 Linux),`max_concurrent_tasks=2` |
| Backend-01 (Linux) | `POC Backend-01 (Linux)` (`00e6774a-ca9d-4fec-b4a5-f3cb7b82f534`),runtime `b68c6447-...`,daemon `01a1388d-...`,`max_concurrent_tasks=1` |
| Backend-02 (Windows) | `POC Backend-02 (Windows)` (`2b3a87b0-1ab8-451f-8a64-601b5089c0b0`),runtime `d1de152c-...`,daemon `01a01965-...`,`max_concurrent_tasks=1` |
| Analyst-01 (Linux) | `POC Analyst-01 (Linux)` (`e5dd9241-3355-48bd-b2ea-1cdeb70c935a`),runtime `b68c6447-...`,daemon `01a1388d-...`,`max_concurrent_tasks=1` |
| Analyst-02 (Windows) | `POC Analyst-02 (Windows)` (`d895cc06-539e-4a44-b9a0-c3c60bbf6fe4`),runtime `d1de152c-...`,daemon `01a01965-...`,`max_concurrent_tasks=1` |
| 共启动 Worktree | root commit `0864e2c4d861c8889e4d2e371994373bf80cfec5` (`single-squad-multi-agent-runtime-design`),branch `fire` (两台机器上同一 SHA,可同步基线对比) |

注:Linux 项目资源的 `daemon_id` 字段填的是 `d1de152c-...`(Windows runtime_id),label 为 `(lileipc claude)` —— 元数据 label 不一致,但 BE01 经 Server-97 runtime 仍能正确落地到 `/root/workspace/winning-platform-monorepo`,所以**不影响派工路径**。Windows 项目资源用真 daemon_id `01a01965-...`。建议后续写一个一致性维护 SOP 步骤(资源创建时把 daemon_id 与 runtime 标签校对一致)。

## 1. 案例结果表

| Case | Issue | 状态 | Run ID | Runtime / cwd | Git SHA / Diff 摘要 | 证据 | 下一步 |
|---|---|---|---|---|---|---|---|
| **P01** 多 Agent / 多 Runtime 同 Squad | (静态检查) | **PASS** | n/a | Lead + BE01(server-97) + BE02(lileipc) + AL01(server-97) + AL02(lileipc) 全部可见于 `squad member list` | n/a | `squad member list` 返回 5 个 agent,squad_id=`acff463b-...` | 全角色 Ready |
| **P02** A → Windows Backend / B → Linux Backend | MS-1 / MS-2 | **PASS** | MS-1 worker `01a1399b-383a-7683-ae3e-17b44dec9bb9`;MS-2 worker `01a139ab-9933-7928-a303-63ad49d9edfb` | MS-1 cwd `D:\UserProgram\winning-platform-monorepo-fire`,Runtime `d1de152c-...` Daemon `01a01965-...`;MS-2 cwd `/root/workspace/winning-platform-monorepo`,Runtime `b68c6447-...` Daemon `01a1388d-...` | HEAD `0864e2c4...`(两机一致)| MS-1 评论 `01a139a1-dfed-...`;MS-2 评论 `01a139ae-a3e6-...` | 完成 |
| **P03** 同 Agent 并发=1 队列 | MS-3 / MS-4 (TFS-900003 / TFS-900004) | **PASS** | MS-3 BE02 `01a139b2-9a7e-7ad1-b92c-7e5394799a2a` `[09:16:14 → 09:20:37]`;MS-4 BE02 `01a139b2-f93a-781a-ac58-7196aebab18d` `[09:20:39 → 09:22:55]` | 全 BE02 / Runtime `d1de152c-...` | HEAD `0864e2c4...`(无变化,新 work 仅 untracked) | MS-4 队列态: `started_at=null, dispatched_at=null, status="queued"`,Lead 自己引用 `trigger_outcomes.reason_code=queued` | 完成 |
| **P04** 同机不同 Agent 写同一 in_place 目录 | (未分配) | **NOT_RUN** | — | — | — | — | 需要 BE02 + AL02 写同一 Windows in_place 目录下不同 Change ID,验证运行时不冲突 |
| **P05** Lead 选员依据 Roster/role 派工 | MS-1 / MS-2 | **PASS** | 同 P02 | 同 P02 | Lead 的 mention 完全基于 `backend-linux` / `backend-windows` role + agent UUID 精确匹配 | MS-1 Lead 评论 `01a1399b-382a-...`;MS-2 Lead 评论 `01a139ab-9919-...` — 注释明确带 agent UUID 精准 mention | 完成 |
| **P06** 多 Analyst 各自独立 Change 目录 | MS-5 / MS-6 | **PASS** | MS-5 AL02 `01a139bc-3949-7b9a-a3ed-14003c2021da` `[09:26:39 → 09:30:42]`;MS-6 AL01 `01a139bc-5445-7dbb-af76-1d9fbdef2bc1` `[09:26:47 → 09:28:41]` | MS-5 cwd Windows in_place,Runtime `d1de152c-...`;MS-6 cwd Linux in_place,Runtime `b68c6447-...` | Windows 侧产生 `openspec/changes/poc-900005/`;Linux 侧产生 `openspec/changes/poc-900006/`,两目录互不可见 (跨 Runtime in_place) | MS-5 评论 `01a139bc-...` (Worker);MS-6 评论内容见 Lead 总结 | 完成 |
| **P07-P08** 未提交 dirty worktree 复用 / 安全 recover | (未分配) | **NOT_RUN** | — | — | — | — | 需要 BE02 留 dirty + 后续 BE02 / AL02 检测到 dirty 后拒绝混入,或独立 branch recover |
| **P09-P11** 跨机 OpenSpec 批准 / 进度 / Finalize | MS-7 / MS-8 / MS-9 | **MIXED** | MS-7 worker `01a13d11-33de-72fc-85dd-8f9d2ed24b2d` (Windows AL02);MS-8 worker `01a13d11-84b5-74b0-acde-632cd281ff86` (Linux BE01);MS-9 worker `01a13d12-0ed9-73cc-ba3e-e682b559b99d` (Windows AL02) | MS-7 cwd `D:\UserProgram\winning-platform-monorepo-fire`,commit `9d09ad4f`;MS-8 cwd `/root/workspace/winning-platform-monorepo`,`poc-900005/` 缺,`origin/fire` 仍 `0864e2c4`;MS-9 cwd `D:\UserProgram\winning-platform-monorepo-fire` | MS-7 commit `9d09ad4f` 含 5 个 poc-900005 文件 + change_meta status=approved;MS-8 Linux 侧 `poc-900005/` 完全缺失,`origin/fire` 也无 history;MS-9 9 项预检查全列,Check #6 阻断 → NOT_READY | MS-7 评论 `01a13d13-9549-...`;MS-8 评论 `01a13d15-10f6-...`;MS-9 评论 `01a13d1c-9662-...`;Lead recovery note `01a13d1d-265a-...` | P09 PASS (commit baseline 落);P10 BLOCKED (无 POC remote → parity 不可达);P11 PASS (NOT_READY 正确 STOP + 4 类 sync 恢复方法) |
| **P12** PR Changes Requested 唤醒同一 Engineer | (未分配) | **NOT_RUN** | — | — | — | — | 需要在隔离 WS 模拟 PR comment 并验证恢复路径 |
| **P13** Linux Runtime Offline / cwd 错误时合理派工 | (未分配) | **NOT_RUN** | — | — | — | — | 需要真停掉 server-97 守护进程或挪走 project local_path,验 Lead 不误指派 |
| **P14** Mention / Sub-Issue 重复触发 | (未分配) | **NOT_RUN** | — | — | — | — | 需要测平台是否去重 |
| **P15** 候选 Commit 跨机 Verify | (未分配) | **NOT_RUN** | — | — | — | — | 需要 git remote + 跨机 fetch 流程 |
| **P16** Analyst-01/02 同时执行不同 Issue | MS-5 / MS-6 | **PASS** | 同 P06 | 同 P06 | 时间轴并行 `[09:26:39 → 09:30:42]` 与 `[09:26:47 → 09:28:41]` 无重叠 | P06 | 完成 |
| **P17** 多 Frontend Agent | (无 Agent) | **NOT_RUN** | — | — | — | — | 当前 Squad 仅 1 Lead + 2 Backend + 2 Analyst,**无 Frontend 实例**;确认本 PoC 不强制覆盖 P17 (SOP 标注"按需") |
| **P18** Analyst Reject / Offline 转派 | (未分配) | **NOT_RUN** | — | — | — | — | 需要 analyst reject 后重新派工,或停跑 AL01 看 AL02 是否安全接续 |

## 2. 决策门判定

| Gate | 包含 Case | 当前 | 备注 |
|---|---|---|---|
| **G1 Native Feasibility** | P01 / P02 / P03 / P05 / P16 | **PASS** | 单 Squad 多同职责实例、原生 `max_concurrent_tasks=1` 队列、Roster 精确 Mention 派工全部在 case 实测中复现 |
| **G2 Engineering Safety** | P07 / P08 / P06 Git 风险 | **PARTIAL** | P06 文件隔离已观察,但 P07-P08 dirty worktree 检测未实测,不能直接写 PASS |
| **G3 End-to-End Handoff** | P09 / P11 | **PASS** (with one BLOCKED sub-case at P10) | P09 AL02 commit baseline + change_meta approved 通过;P11 9 项预检查在 Check #6 正确 STOP 返回 NOT_READY,无 archive/done/push;P10 因 POC 缺失 remote 跨机不可达,Lead 主动 `blocked` 而非伪造 SHA |
| **G4 Operations** | P12 / P13 / P14 / P15 / P17 / P18 | **NOT_RUN** | Recovery / Offline / 重复触发 / Verify / Frontend / Analyst 转派均未跑 |

## 2.1 P09-P11 跨机 OpenSpec + Finalize 详细链路

| t (Asia/Shanghai) | 事件 | 实体 | 证据 |
|---|---|---|---|
| 2026-10-15 00:57:57 | MS-7 Leader run 启动 | Lead | 派发 mention 到 AL02 |
| 00:58:19 | Lead 写 MS-7 mention | Lead | comment `01a13d11-33ce-...`,带 AL02 UUID `d895cc06...` |
| 00:59:16 | Lead 同时写 MS-9 mention (pre-check 演练) | Lead | comment `01a13d12-0eca-...`,目标同样为 AL02 |
| 01:00:56 | AL02 完成 MS-7 commit baseline | AL02 | HEAD `0864e2c4` → `9d09ad4f762456320e750df3c5974a06250efcac`,`change_meta.status = approved`,未推送(无 POC remote) |
| 01:01:09 | AL02 worker run 完成 | 平台 | run `01a13d11-33de-...` status=completed |
| 01:01~01:04 | Lead 验收失败一次后重试成功 | Lead | run `01a13d15-f9d9-...` completed,MS-7 状态翻 `in_review` |
| 01:02:33 | BE01 完成 MS-8 read-side 报告 | BE01 | Linux 侧 `poc-900005/` 不存在,`origin/fire` 也无 history → 无法生产 parity diff,主动声明 limitation |
| 01:05:08 | Lead 把 MS-8 锁在 `blocked`,不伪造 SHA | Lead | comment `01a13d17-7106-...` 显式说明:"Leaving the issue blocked so the upstream decision ... stays visible" |
| 01:05:13 | MS-9 AL02 worker 开始跑(等 MS-7 释放) | AL02 | run `01a13d12-0ed9-...` started |
| 01:10:46 | AL02 写 Finalize pre-check 结果 | AL02 | **9 项预检查**全列出,Check #6 "Linux sync evidence missing in tasks.md §5" 阻断,显式 NOT_READY,未做 archive / done / push |
| 01:10:47 | Lead 接受,开始写 recovery note | Lead | Lead MS-9 第二轮 run 启动 |
| 01:11:22 | Lead recovery note 完成 | Lead | comment `01a13d1d-265a-...` 给出 4 类 sync 方法:tarball / manual patch / `git format-patch` + `git am` / POC remote fetch |

### 关键判断点

- **P09 PASS**: Windows AL02 单 commit `9d09ad4f` 包含 `openspec/changes/poc-900005/` 全 5 个文件,`change_meta.status=approved`,无业务子仓变动,无 TFS 推送(原始 `origin` = `tfs2018-web.winning.com.cn` 是真实 TFS,禁止推)。
- **P10 BLOCKED (非 FAIL)**: Linux BE01 的 read-side 检查发现 `poc-900005/` 在 Linux 工作树不存在,`origin/fire` 也无 history,**两根仓间没有 POC-isolated git remote**,无法完成 "Linux fetch 同一 SHA 校验"。BE01 主动声明 limitation 不伪造,Lead 接受并把状态留为 `blocked`——这是 SOP §5.1 允许的合规形态(系统支持但前置条件不具备),不算测试失败。
- **P11 PASS**: 9 项预检查 → Check #6 阻断 → `NOT_READY` → 无 archive / done / push,完全符合 SOP §4 Step 4 §5 "未同步时明确 STOP；不得误归档或 done"。Lead 接着给出 4 类恢复路径(A: tarball / B: manual patch / C: `git format-patch` + `git am` / D: POC remote),排序按 blast-radius 升序,推荐 C 为默认。

### G3 的"半开锁"含义

G3 包含 P09/P10/P11。当前:

- **P09 已经把 Windows 端 OpenSpec 批准基线落到位**(commit-only,不 push),并保留了 `change_meta.approved` 标记;
- **P11 已经验证 "Finalize 预检在缺少 Linux evidence 时正确 NOT_READY"**,且主动不污染 status;这意味着,如果某条路径成功把 Linux 端 evidence 引入 Windows 工作树,Finalize 预检就能直接放行;
- **P10 暴露的唯一缺口是"Windows 提交 ↔ Linux 校验"之间的传输通道**。在没有 POC-isolated remote 的情况下,该缺口只能用 `git format-patch` + `git am` 或文件拷贝绕过——但这两种都属于"测试恢复步骤",不是"自动闭环"。这是把 G3 从"PASS 自动闭环"降到"PASS 半闭环,跨机自动递交仍需 POC remote"的真实根因。

结论:**有 POC-isolated remote ⇒ G3 完全 PASS;没有 ⇒ G3 通过 P09/P11 的手工恢复方案达到"PASS-with-documented-recovery"**,而非 "FAIL"。

## 3. 关键观察

1. **资源 metadata 与 runtime 不一致不影响派工**: Linux project 资源的 `daemon_id` 指向 Windows runtime 的 `d1de152c-...`,但 BE01 通过 agent 自身的 runtime 绑定仍到达 `/root/workspace/winning-platform-monorepo`。这意味着派工路径以 agent→runtime 为准,project resource 的 `daemon_id` 字段在当前实现下未做严格约束。建议后续清理。本轮 MS-7 / MS-8 run 报告里 BE01 再次点名了这条 drift 并写进交付文档。
2. **Lead 的 mention 语义**: Lead 总是以 `[@agent-name](mention://agent/<uuid>)` 精确 mention,只是自述"role-based 选择"。取证不需要 Member Status API 也能正确路由 — 这与 SOP §1.2 的"记为该观测子项 FAIL / NOT_RUN"兼容(`squad member status` 是 nice-to-have,不是 dispatch 必须)。MS-8 中 BE01 找不到 MS-7 hash set 时,Lead 也没有越界伪造,直接接受 limitation。
3. **Agent 在严格 scope 上行为有差异**:
   - BE02 (Windows) 收到 issue 时会主动 scaffold + 落 OpenSpec 物(proactive)
   - BE01 (Linux) 收到同结构 issue 时只回报环境,不主动 scaffold(literal / conservative)
   - 这是 Lead 在 Lead 端**future dispatch** 时要把"既要回报也要落地"写在 mention 文本里 — P02 后续 case 只要在 mention 里强调产物落地,Backend 就会落。Lead 对 MS-3 / MS-5 / MS-6 显式补了"create proposal.md / tasks.md / spec.md"才能稳定落地。MS-5 之后 Lead 把这一约定固定下来:每次 mention 都先写 "Step 1: …, Step 2: …, Step 3: …" 让 worker 一上来就知道产物清单。
4. **平台调度层对 `max_concurrent_tasks=1` 的硬约束**: MS-4 在 MS-3 `running` 时被平台直接置 `queued` 而非并发 dispatch(`started_at=null, dispatched_at=null`)。这是一条最强证据,优于 agent 自描述。MS-7 同样:MS-9 mention 比 MS-7 mention 晚 1 分钟,MS-9 worker 等 AL02 释放才 start(00:59:16 → 01:05:13)。
5. **同根仓 / 同 Branch / 同 SHA 起跑,后期分化**: 起跑时 Windows 与 Linux 都在 `fire` 上同一 SHA `0864e2c4...`,但运行过程各自 commit 后,Windows 端 `fire` 推到 `9d09ad4f`,Linux 端 `fire` 推到 `c2c1bda3`。`origin/fire` 仍为 `0864e2c4`(两边都未 push)。这意味着:PoC 阶段 in_place 是"独立双克隆"模型,**除非引入 POC-isolated remote,否则跨机 visibility 必然不存在**(这是 P10 BLOCKED 的根因)。
6. **Finalize pre-check 的"9 项检查清单"是 P11 的硬证据**: AL02 把检查拆成可命名的 9 项(approval / artifacts / tasks / validation / Linux impl presence / Linux sync in tasks.md / delta→main sync / TFS push state / boundary guard),在 Check #6 阻断并**显式** NOT_READY —— 没有 archive,没有 done,没有 push。这是 SOP §4 Step 4 §5 的字面兑现。
7. **Lead 的"不伪造"行为覆盖三种缺口形态**: (a) Lead 在 MS-8 不可达时把 status 锁 `blocked` 而非 `in_review`;(b) BE01 在算不出 parity diff 时显式列"two stacked reasons"而非编 SHA;(c) MS-7 时缺 POC remote 故不 push 并把 `tfs_push: false` 写到 `.openspec.yaml`。这一致行为模式**正是 SOP §5.2 期望的"系统支持但结果不满足"合规标记**,而非 FAIL。

## 4. 后续推进顺序

下一轮按业务必要性继续(P04、P07-P11),尽量在一次大回合内完成:
1. **P04 / P07 / P08 工程安全**: BE02 留 dirty worktree → 下一轮 BE02(或 AL02) 应能识别并 STOP。
2. **P09 / P10 / P11 跨机 OpenSpec + Finalize**: Windows Analyst 提交 poc-900005 → Linux Engineer fetch 同一 SHA 验证 → Windows Finalize 预检校验同步事实。
3. **P18 Analyst 转派 / 离线**: 拉一台 AL01 离线,验 AL02 接续。
4. **P13 Offline / 错误 cwd**: 暂停 server-97 daemon 5-10 秒看派工是否被合理延迟。

P12 / P14 / P15 / P17 / 进一步可待前四组 PASS 后再立项。

## 5. 已知局限

- 没有 Frontend Agent 实例,P17 不能跑(SOP 写明可选)。
- 平台 API `GET /api/squads/<SQUAD_ID>/members/status` 在当前 CLI 中没有 `squad member status` 子命令;Lead 仅依据 `agent tasks` + Roster role 即可决策,故不对该 API 做形式化引用。
- `multica issue runs <id> --active` 标志位未测试其语义;观测用的是 `runs` 全量按状态过滤。
- Linux project 资源 `daemon_id` 字段填了 Windows runtime_id,看似无害但需归并清理。

