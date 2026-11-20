---
title: Round Robin + Native Concurrency PoC Result (2026-10-14)
contract: S11-RR-POC
status: active
created_at: 2026-10-14
updated_at: 2026-10-14
owner: winning\li_lei
---

# Round Robin + Native Concurrency PoC 结果

> 归档说明（2026-10-15）：本报告引用的 `fixtures/` JSON、日志和临时文本已清理；分项 `result.md` 与本报告保留。原始过程输出不能再从本目录复核。

- **Date / OS:** 2026-10-14 / Windows 11 Home China 10.0.26300 (win32, PowerShell + Git Bash)
- **Multica CLI / Daemon version:** CLI `0.6.2` (commit `7ab92d762`, built 2026-10-13T10:45:01Z, go1.26.9 windows/amd64)
- **POC Workspace:** `f82ad313-09ac-4444-acf3-7d086bc43298` (`rr-native-c-7d086bc43298`)
- **POC Project:** `6d065e40-1d41-417c-a065-9429150c41de` (`S11-RR-fixture`, planned)
- **POC Project resource:** `7b311538-f326-4464-89be-079075b5d64d` — `local_directory` = `D:\multica-poc\rr-fixture`, `execution_mode: in_place`, `daemon_id: 01a01965-…` (Main daemon)
- **Fixture Root / Child Repository:**
  - Root repo: `D:\multica-poc\rr-fixture` — HEAD `649b237` (`RR PoC baseline`), contents unchanged from baseline (no commits during test)
  - Child repo: `D:\multica-poc\rr-fixture\business-service` — HEAD `4c38ce0` (`biz baseline`), contents unchanged from baseline
- **POC Squad / Agent / Runtime IDs:**
  - Squad `DS01`: `979f6c0f-…`
  - Agent S11 Worker A: `79e4eee1-5ad9-43f0-8cc6-d218e16be303` (profile daemon, `max_concurrent_tasks: 2` round; set to `1` for S11-05 then restored)
  - Agent S11 Worker B: `6b681a5d-7fca-4374-b08c-ae4a5224e23d` (`max_concurrent_tasks: 2`)
  - Agent S11 Leader: `c504a0d5-a97d-46ea-bc75-b7cd12afdded` (`max_concurrent_tasks: 1`)
  - Runtime (lileipc): `857171d7-769a-4a78-a03e-ca3d370b5cd6` (profile daemon process PID 49696)
  - Main daemon process: PID 30748 (incidentally handled some tasks; see S11-03 / S11-05)

| Case | Result | Issue IDs | Run IDs | 核心证据 | 问题 |
|---|---|---|---|---|---|
| S11-01 | **PASS** | — | — | `00-baseline/result.md` + `squad-ds01.json` / `agent-*.json` / `project-resources.json` | Squad 无 `capacity` / `max_concurrent_tasks`；并发控制只在 Agent / Daemon / `local_directory` 锁上 |
| S11-02 | **FAIL** | RRNC-1 (`01a13914-d940-7b4a-87cd-42a5798d3b4f`), RRNC-2 (`01a13914-e910-7f04-84b9-074dd28cd3c7`) | RRNC-1 / RRNC-2 完整时间序列（见 `01-S11-02-concurrency/result.md`） | `01-S11-02-concurrency/result.md` + `lock-A-start.txt` / `lock-A-end.txt` / `lock-B-start.txt` / `lock-B-end.txt` / `daemon-main.log` + `daemon-profile.log` | 锁是 per-daemon-process：Main 与 profile 两个 daemon 同时获得 `D:\multica-poc\rr-fixture` 的 `local_directory: lock acquired`；Worker A 与 Worker B 在 23 秒内并发写入同一共享 `poc/` 目录 |
| S11-03 | **FAIL** | RRNC-3 (`01a1391f-c668-7c89-815e-0058dfaec006`), RRNC-4 (`01a1391f-f430-7d3f-8cc3-6d7e91443948`) | RRNC-3 `01a13920-7d07-7be5-a8a1-31466d08caf3` (Leader), RRNC-4 `01a1391f-f440-71cc-b63b-01c2d8e8173c` (Worker A) | `02-S11-03-leader-dispatch/result.md` + `leader-dispatch.txt` + `RRNC-3-task-trace.log` + `daemon-main-S11-03.log` + `daemon-profile-S11-03.log` | Main daemon 派发 Leader 时**不获取** `local_directory` 锁，给 Leader 的是 `C:\Users\lilei\multica_workspaces_…\workdir`（per-task workdir）；但 Leader Agent 用绝对路径写到共享 `D:\multica-poc\rr-fixture\poc/`，与 Worker A 在 11 秒重叠窗口内并发写同一目录 |
| S11-04 | **FAIL** ★ | RRNC-5 (`01a13927-2447-7b63-b709-3d636cb38f38`), RRNC-6 (`01a13927-3a28-712d-8bcb-a644c3594c24`), RRNC-7 (`01a13927-42d8-7d01-999f-880d1a60b06b`) | RRNC-5 `01a13927-76c8-7c44-b8ca-2305d7116fcb`, RRNC-6 `01a1392a-d433-7082-b926-eecd714ccce2`, RRNC-7 `01a1392d-2a78-797c-80c2-c0fbefef2e4e` | `03-S11-04-review-pollution/result.md` + `RRNC-5-comments.json` + `RRNC-6-comments.json` + `RRNC-7-comments.json` | A 写 `OWNER=A` → A 状态 `blocked` → B 写 `OWNER=B`（同一 `in_place` 工作树）→ A 恢复 Run 看到 **`OWNER=B`**，证明 A 的 `blocked` 工作树未被运行时保护 |
| S11-05 | **FAIL** | RRNC-8 (`01a13931-c69d-7900-b271-13d554ec9f3b`), RRNC-9 (`01a13931-ce29-77e2-a96f-9e50231e7c39`), RRNC-10 (`01a13931-d5e9-761a-a3f4-710363e975fe`) | RRNC-8 `01a13931-ffcd-7155-acf6-b982da846c25`, RRNC-9 (见 `RRNC-9-comments.json`), RRNC-10 `01a1393a-a10d-75ac-802a-6c5de8fdf336` | `04-S11-05-max-concurrent-one/result.md` + `RRNC-8-comments.json` + `RRNC-9-comments.json` + `RRNC-10-comments.json` | `max_concurrent_tasks=1` 也不解决问题：A 写 `OWNER=A` → A blocked → B 写 `OWNER=B`（顺序、零重叠）→ A 恢复 Run 看到 `OWNER=B`。并发限制只能管 overlap，不能管顺序重用同一 `in_place` 工作树 |
| S11-06 | **NOT_RUN** | — | — | `05-S11-06-multi-squad/result.md` | 单机 POC 范围外；精神被 S11-03 的双 daemon 同机拓扑部分覆盖 |
| S11-07 | **NOT_RUN** | — | — | `06-S11-07-isolated-worktrees/result.md` | 没有 per-Issue worktree 基础设施；精神被 S11-04/05 覆盖 |

## Three Verdicts

- **Run Scheduling: PASS** — Round Robin 分发本身按 Squad/Agent 配置正常工作；S11-02/03/04/05 中所有 RRNC Issue 都成功派发到目标 Agent，并被对应 Runtime 启动；没有出现 "Issue 未路由"、"路由到错误 Squad"、"Worker 永久 stuck" 等失败模式
- **Delivery Isolation: FAIL** — 三个层面的失败都观察到：(1) 锁是 per-daemon-process（S11-02），Main 与 profile 同时持有 `D:\multica-poc\rr-fixture` 锁；(2) per-task workdir 是装饰性的（S11-03、S11-05），Agent 用绝对路径即绕过；(3) `blocked` 不保护文件系统状态（S11-04、S11-05），后续 Issue 直接覆盖前序 Issue 的未提交写入
- **Direct Round Robin Feasibility: DIRECT_RR_UNSAFE** — 任何一种可复现的跨 Issue 污染、复用错误工作目录或审核期交错写入都会触发 `UNSAFE`；本轮 S11-02/03/04/05 全部命中

## Recommendations

- **Can remove Coordinator WAIT/Capacity now? NO** — 本轮证据已结构性地证伪"Multica native 机制可替代 Squad Coordinator 的 WAIT/Capacity"假设。Squad Coordinator 的 `squad_concurrency + per_member_max_concurrent` 仍是当前架构下唯一已知的串行化手段
- **Minimum required isolation or guard (minimum, not sufficient):**
  1. 强制 single-daemon-per-project（每个 Project 的 `local_directory.daemon_id` 唯一且与派发 daemon 一致），避免 per-daemon 锁漂移
  2. 强制 per-Issue worktree（runtime 在 `local_directory` 上为每个 Issue 创建独立 Git worktree），否则 `in_place` 模型无法提供 Issue 级隔离
  3. 强制 `commit + push` 写穿本地工作树，否则工作树内容跨 Run/跨 Issue 共享
  4. 即使上述三项全开，仍需 Coordinator 的 `squad_concurrency + per_member_max_concurrent` 做并发上限；它们是"必要不充分"条件
- **Remaining PoC items:**
  1. 在引入 per-Issue worktree 后重跑 S11-04/S11-05 验证修复
  2. 跨机器 S11-06（两台 host、各自 daemon、跨 OS 路由）
  3. Squad Coordinator 设计文档 (`docs/multica/multi-squad-coordination-design.md`) 中关于 `squad_concurrency + per_member_max_concurrent` 的字段已观察存在；可作为本轮证据的对照基线
  4. 本次"硬删除 POC 对象"操作日志应保留进 `multica-archive` 类账本

## 跨轮复用的关键发现

1. **per-daemon-process 锁**：Multica 当前 `local_directory: lock acquired` 是 daemon 进程内状态，**不跨进程同步**。任何依赖此锁做并发串行化的方案在双 daemon（即使是同一 host）下立即失效
2. **per-task workdir 是 cosmetic 而非安全边界**：Main daemon 派发未匹配 `daemon_id` 的 Issue 时给的 `C:\Users\lilei\multica_workspaces_…\workdir` 仅约束相对路径写入，绝对路径可绕过到共享 `in_place` 目录
3. **daemon 派发是不确定的**：同一 Agent 连续 Runs 不一定走同一 daemon（RRNC-8/9 走 profile，RRNC-10 走 main），证据来自 `work_dir` 字段差异
4. **`blocked` 是 workflow 状态，不保护文件系统**：S11-04/05 直接证伪"blocked 时工作区受保护"假设
5. **`max_concurrent_tasks` 只管 overlap，不管顺序重用**：`in_place` 模式下顺序 Issue 仍共享同一工作树
