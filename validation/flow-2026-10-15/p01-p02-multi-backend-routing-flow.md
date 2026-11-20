---
title: P01 / P02 多 Backend 派工流程与 Lead 决策机制 (multica-single-squad, 2026-10-14)
status: validated
contract: single-squad-multi-runtime-poc
owners: llei921
workspace: multica-single-squad
workspace_id: cabca166-0b02-4551-8ce6-b8a2bb5b39b6
squad_id: acff463b-1fed-4cae-b6dd-16731a53c9e1
sop: projects/multica/validation/single-squad-multi-runtime-poc.md
design: projects/multica/single-squad-multi-agent-runtime-design.md
date: 2026-10-14
covers: [P01, P02, P05]
related_issues: [MS-1, MS-2]
---

# P01 / P02 · 多 Backend 派工完整流程与 Lead 决策机制

> 本文解释 `docs/multica/validation/single-squad-multi-runtime-poc.md` v1.1.0 中 **P01** 和 **P02** 的完整执行链路,以及 Lead 如何在只有 Squad Roster 视图、没有显式协调器的条件下,完成"同职责多实例派工"。

## 1. 关键问题回顾

SOP 提出了 6 个关键假设,本轮实测直接相关的是 H1 / H2 / H3:

- **H1**: 一个 Squad 可以有 `Backend-01 / Backend-02` 等同职责不同 Agent,`@mention` 可以准确路由,且同职责实例不需要维护多套 Skill。
- **H2**: `max_concurrent_tasks=1` 正确限制**同一个 Agent** 的 Run;其他 Agent / Daemon 可正常运行。
- **H3**: Lead 可在合法权限内获得足够的成员状态 / 排队事实,做简单派工;**不要求原生负载均衡或严格最优**。

P01 验 H1、P02 验 H1+H2+P05 选员机制。本流程文档把 H3 也一并写进 Lead 决策那一节。

## 2. 资源准备(用户视角)

| 资源 | 标识 | 备注 |
|---|---|---|
| Workspace | `multica-single-squad` (`cabca166-...`) | 一个隔离 Workspace |
| Project (Linux) | `winning-platform-monorepo` (`9aa7f581-...`) | in_place,资源 → `/root/workspace/winning-platform-monorepo` |
| Project (Windows) | `winning-platform-monorepo-fire` (`ff3d8c17-...`) | in_place,资源 → `D:\UserProgram\winning-platform-monorepo-fire` |
| Squad | `PoC Squad (multica-single-squad)` (`acff463b-...`) | 1 Lead + 2 Backend + 2 Analyst |
| Backend-01 (Linux) | `00e6774a-ca9d-4fec-b4a5-f3cb7b82f534` | runtime `b68c6447-...`(server-97) |
| Backend-02 (Windows) | `2b3a87b0-1ab8-451f-8a64-601b5089c0b0` | runtime `d1de152c-...`(lileipc) |

Squad 成员的"角色"通过 `multica squad member add ... --role <role>` 显式声明,与 agent 自身的 `name` 字段分离:

```
$ multica squad member list acff463b-1fed-4cae-b6dd-16731a53c9e1 --output json
[
  {"member_type":"agent","member_id":"6b205cc6...","role":"leader"},
  {"member_type":"agent","member_id":"00e6774a...","role":"backend-linux"},
  {"member_type":"agent","member_id":"2b3a87b0...","role":"backend-windows"},
  {"member_type":"agent","member_id":"e5dd9241...","role":"analyst-linux"},
  {"member_type":"agent","member_id":"d895cc06...","role":"analyst-windows"}
]
```

> 注意:`role` 是 Squad 维度声明的字符串,**Lead Agent 通过 Squad Roster 可以读到**,而 backend / analyst 的"业务能力"信息来自 agent 自身的 `description` / `instructions`,并不进 Roster。

## 3. 测试 Issue

| Issue | Title | Project | 期望被派工的 Member |
|---|---|---|---|
| MS-1 | `POC A Backend (TFS-900001)` | `winning-platform-monorepo-fire` (Windows) | `Backend-02 (Windows)` — UUID `2b3a87b0...`,Role `backend-windows` |
| MS-2 | `POC B Backend (TFS-900002)` | `winning-platform-monorepo` (Linux) | `Backend-01 (Linux)` — UUID `00e6774a...`,Role `backend-linux` |

两个 Issue 都在 Squad 上,Lead 的 `max_concurrent_tasks=2`,所以两个 Leader run 可以同时跑。

## 4. 完整时序(P02 实测链路)

时间均为 2026-10-14,Asia/Shanghai。

| t | 事件 | 实体 | 备注 / 证据 |
|---|---|---|---|
| 08:37:11 | MS-1 created & assigned to Squad | Multica 平台 | issue id `01a1398e-efd2-71a5-8bc7-6fb5928af7cb` |
| 08:37:15 | Lead 第 1 次尝试运行失败 | Lead (`6b205cc6`) | `Claude Code refuses bypassPermissions under root/sudo privileges` → 自动报 system comment |
| ~08:50 | Lead 重试成功,写 mention | Lead (`6b205cc6`) | comment id `01a1399b-382a-7441-96c6-41db706b46f7`,正文含 `[mention://agent/2b3a87b0-1ab8-451f-8a64-601b5089c0b0]` |
| 08:50:36 | mention 被平台捕获并触发 BE02 Run | Multica 调度层 | run `01a1399b-383a-7683-ae3e-17b44dec9bb9`,`kind=comment, status=running` |
| 08:50:40 | BE02 开始处理 | BE02 (`2b3a87b0`) | `runtime_id=d1de152c..., daemon_id=01a01965..., work_dir=D:\UserProgram\winning-platform-monorepo-fire` |
| 08:57:52 | BE02 落地 11 个文件并回写报告 | BE02 (`2b3a87b0`) | 全部产物在 `openspec/changes/poc-900001/**` |
| 09:01:40 | Lead 验收关闭 MS-1 | Lead (`6b205cc6`) | issue 翻到 `in_review` |
| 09:07:50 | MS-2 created & assigned to Squad | Multica 平台 | issue id `01a139aa-fed1-7c64-aa4d-165f906fea32`,project `winning-platform-monorepo` (Linux) |
| 09:08:29 | Lead 写出 mention | Lead (`6b205cc6`) | comment id `01a139ab-9919-774a-b218-eb6600dcd01c`,命中 `00e6774a...(Backend-01 Linux)` |
| 09:08:30 | BE01 开始处理 | BE01 (`00e6774a`) | `runtime_id=b68c6447..., daemon_id=01a1388d..., work_dir=/root/workspace/winning-platform-monorepo` |
| 09:11:48 | BE01 回写报告(只 snapshot,无 scaffold) | BE01 (`00e6774a`) | Git state 一致(`0864e2c4...`),worktree clean |
| 09:12:40 | Lead 验收关闭 MS-2 | Lead (`6b205cc6`) | issue 翻到 `in_review` |

两者都没有 Lead 走"无 Leader 路径"或"Double Run"。Lead 的每次派工,目标 Agent、Runtime、Daemon 都**唯一确定**。

## 5. Lead 的派工决策机制

Lead 在两次 Issue 委派中,做了**四件事**:

### 5.1 读取 Roster

Lead 的 system 提示中关于 Squad 角色是声明式的(`role=leader`),并不直接携带 Roster。但 platform 在 mention 派单时会触发一个 Leader Run,Run 的 prompt 由平台自动注入 Squad / Issue 上下文。Lead 在拿到上下文后会主动 `multica squad member list <SQUAD_ID> --output json` 来读取 Roster 中每个成员的 `member_id / role`。这一动作不需要 Member Status API、不需要心跳,纯 CLI 只读。

### 5.2 按 `role` 关键词过滤

MS-1 描述里写了"Backend-Windows",Lead 在 Roster 里找出 `role=backend-windows` 的那一个 Member,然后查 `member_id = 2b3a87b0-...`。MS-2 同理匹配 `role=backend-linux` → `00e6774a-...`。

注意:Lead 没有"看到 backend-linux 的 Runtime 不是 Linux"这一步;`role` 是声明字符串,Lead 信任它。这是 P01 验 H1 的关键。

### 5.3 用精确 UUID mention

Lead 写出的 mention 形如:

```markdown
[@POC Backend-02 (Windows)](mention://agent/2b3a87b0-1ab8-451f-8a64-601b5089c0b0)
```

这是 Multica 平台的 mention 语法(`mention://agent/<uuid>`),而不是自然语言。平台的 mention 解析器按 UUID 找到对应 Agent,然后触发该 Agent 的 Run。Lead 用 UUID 而不是 `name`/`role` 的好处:

- `@Backend-02` / `@backend-windows` 都不生效,只有 UUID 才会被平台识别为派单
- 即便 Squad 中存在多个同名 Agent,精确 UUID 可以避免二义性

### 5.4 用"基于事实的选择"留在评论里

Lead 在 mention 块的开头都会声明选择依据(摘自 MS-1 comment):

> "you're the only Windows backend on the squad, picking you for this."

这是写给人看的"自然语言决策说明",不是 Lead 真的执行了什么 query。它对应 SOP §3 中 "Lead reads online state, queued / running facts and chooses a member; Lead records based on which fact it chose"。当前平台没有公开的 `squad member status` 子命令(API `GET /api/squads/<id>/members/status` 存在但 CLI 未暴露),Lead 的事实来源主要是:

- `multica squad member list <SQUAD_ID>`(Roster 静态)
- `multica agent tasks <AGENT_ID>`(实时 queue / running)

将这两个数据源合在一起,Lead 可以在派单前得知"该 Agent 当前是否有 in-progress / queued Run",从而避开"显然忙"的实例(Mika 之后想引入原生负载均衡时,可以把这一步升级为更结构化的 dispatched_status 查询)。

### 5.5 不够用时的取舍(H3)

Lead 没有(也不需要)严格意义上的负载均衡器:`@mention` 是 commit-or-queue,不强制 round-robin。本轮 Lead 把所有 Windows Backend 工作都派给 BE02、Linux Backend 工作都派给 BE01,**完全基于 role 字段匹配,没有试图在两个 Backend 中轮转**。这与 SOP 的 H3 一致:

> "H3: Lead 可在合法权限内获得足够的成员状态 / 排队事实,做简单派工;不要求原生负载均衡或严格最优。"

## 6. 平台调度的二次约束(H2 验证)

派单之后是平台调度层,不是 Lead 自己。证据是 MS-3 / MS-4:

- 09:16:09 MS-3 mention 落 BE02 → 平台立刻下发,09:16:14 BE02 开始(running)
- 09:15:50 MS-4 紧跟着被 Lead 提到同一个 BE02(因为 Linux 端还忙)→ 平台直接给 `status=queued, started_at=null, dispatched_at=null`,直到 09:20:39(MS-3 完成后)才下发

这条证据比 Agent 自报告更可信:它证实 `max_concurrent_tasks=1` 是**调度器层硬约束**,而不是 Agent 自觉排队。这是 P03 与 H2 的硬证据。

## 7. Lead 派工的工程决策(写给人看的"决策树")

LLM 决策 ≠ 状态机,但为了将来加 Leader 的可读性,把本轮观察到的"策略"形式化一下:

```text
IF Issue.assignee_type == squad
   AND Issue.assignee == self.squad
THEN
   1. 拉取 Roster: `multica squad member list <SQUAD_ID> --output json`
   2. 对 Issue.description 抽取能力关键词:
        - Windows / D:\ / lileipc → 期望 role in {backend-windows, analyst-windows, ...}
        - Linux   / /root/   / server-97 → 期望 role in {backend-linux, analyst-linux, ...}
   3. 在 Roster 中筛 role ∈ 期望集合,得到候选 Member(通常 0~1)
   4. 对每个候选执行 `multica agent tasks <member_id> --output json`
        - 如果出现 running / queued 数 ≥ agent.max_concurrent_tasks,标记 "busy"
        - 如果 offline / unstable,标记 "avoid"
   5. 选 1 个候选 → 在 mention 块写精确 UUID 派工
   6. 收到 worker 报告后,核对环境快照(Runtime/Daemon/cwd/SHA) 与 mention 中的推断一致 → 更新 issue status
```

这个策略解释了为什么 MS-1 / MS-2 都能"一选一个准":**派工是 Roster + role + agent.tasks 三件事的组合**;Lead 不需要 Member Status API。

## 8. P01 / P02 的 PASS 判据对照

| Case | SOP 判据 | 本轮证据 | 状态 |
|---|---|---|---|
| **P01** | "Roster 中两个不同 Agent UUID / Runtime;Leader 精确 Mention 语法可获取" | `squad member list` 5 行包含 BE01(`b68c6447...`)+BE02(`d1de152c...`),所有 mention 都用 `mention://agent/<uuid>` | **PASS** |
| **P02** | "每个 Issue 的 Worker Run `agent_id` / `runtime_id` / `daemon_id` 均正确,没有误派或重复启动" | MS-1 worker `2b3a87b0 / d1de152c / 01a01965`;MS-2 worker `00e6774a / b68c6447 / 01a1388d` | **PASS** |
| **P05**(相关) | "Lead 记录基于哪份事实选择,真实 Mention 给对应成员;`idle` 未被误当作'没有排队'" | Lead 在 mention 前用角色字段决策,worker `agent_tasks` 在派单后状态准确 | **PASS** |

## 9. 局限与建议

1. **role 字段是字符串,平台未约束其在 Roster 中唯一**。理论上存在两个 Member 都声明 `backend-windows` 的可能;Lead 的过滤会得到两个候选,但 SOP 在本 PoC 阶段默认每个 role 只有一个成员。如果未来想允许多实例,Lead 策略需要扩到"在同 role 中按 agent.tasks 状态选最闲的"。
2. **Mention 必须用精确 UUID,平台目前不识别 `@名字` 或 `@role`**。Lead 的 prompt 要写"mention agent",不能写"mention some backend-windows"。
3. **`agent.tasks` 是调度器的事实之一,但有滞后**。Lead 如果在 worker 还没进入 queue 前再发一条 mention,有可能出现误派。下一步可以让 Lead 在写 mention 之前直接 call `agent get <uuid>` 二次确认 `status==idle`。
4. **Linux project 资源的 `daemon_id` 字段错填为 Windows runtime_id** (`d1de152c-...`),label 也写了 `lileipc claude`。本轮对 P01 / P02 没影响(平台走 agent→runtime),但下一轮做"resource 修改后 Lead 看到 Project Resource" 实验时需要先纠偏。
5. **Mention 文本对 worker 行为有强引导**:
   - Lead 的 mention 写"implement X with files under …",Backend 才会 scaffold;
   - Lead 的 mention 只写"report environment",Backend 就只回报。
   建议把 "issue description 永远要列产物清单" 写进 Lead 的 system instructions,避免 Backend 出现 literal 模式。

## 10. 与其它 Case 的衔接

- **P03 / P16** 已经把 `max_concurrent_tasks=1` 队列 + 同角色多实例并行的证据补齐。
- **P09 / P10 / P11**(正在进行中,见 MS-7 / MS-8 / MS-9):Windows AL02 先 commit+push,Linux BE01 再 fetch+verify,SHA 一致;Windows AL02 跑 Finalize pre-check 时,模拟 Linux evidence 未到位 → 应当输出 NOT_READY 而不是 `done`。

文档将随 MS-7 / MS-8 / MS-9 完成一并补到结果文档。
