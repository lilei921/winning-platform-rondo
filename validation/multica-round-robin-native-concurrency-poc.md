# Multica Round Robin + Native Concurrency 验证方案

> Version: 1.0.0  
> Date: 2026-10-14  
> Status: NOT_RUN（验证规程，尚无本地执行结果）  
> 关联候选设计：`docs/multica/multi-squad-coordination-design.md`（v0.1.2）  
> 范围：检验“Squad Coordinator 不管理 WAIT / Capacity，只做 Round Robin；并发与排队完全交给 Multica”是否安全。**不修改 01–07 或正式 Multica 配置。**

## 0. 验证结论的判定规则（先阅读）

必须分开回答两个不同问题：

1. **运行时结论（Runtime Scheduling）**：Agent / Daemon / `local_directory + in_place` 是否可靠限制并发 Run？
2. **交付安全结论（Delivery Isolation）**：一个 Issue 在 `analysis_review`、`blocked`、`in_review` 等无活跃 Run 的阶段，能否防止其他 Issue 对其本地工作区产生干扰？

> 不能用第一个问题 PASS 推出第二个问题 PASS。特别是 `max_concurrent_tasks` 是 **Agent 级**属性，Squad 并无独立的 `max_concurrent_tasks` 配置；`in_place` 的锁主要保护同时写同一目录的 **Run**，不提供跨多次 Run 的 **Issue 生命周期独占**。

**最终决策 Gate：**

- `DIRECT_RR_SAFE`：所有高风险情形都证明 Issue 间完整工作区隔离（根仓 + 相关独立业务子仓）、恢复正确，或有等效、可核查的安全机制；不依赖“人工保证不会冲突”。
- `DIRECT_RR_UNSAFE`：任何可复现的跨 Issue Git/Artifact 污染、复用错误工作目录或审核期交错写入，均判不适合在当前 `in_place` 架构下直接上线。
- `INCONCLUSIVE`：没有捕获到重叠、未能构造审核期场景、缺乏可对账 Run/文件证据或测试被环境阻断。

每项 Case 另记 `PASS / FAIL / BLOCKED / NOT_RUN`（表示测试是否达到其验收条件），**与最终安全结论分开记录**。

## 1. 执行边界与环境

**强制隔离：**

- 新建专用 `POC Workspace + Project`；如复用历史 `Spike Workspace`，须证明所有 Issue / Agent / Runtime / Autopilot 均受本轮隔离控制，且不会触及正式项目。禁止写入 `winning-df` / `winning-dps-df` 等正式 Workspace 的 Issue、Agent、Squad、Autopilot。
- Project `local_directory` 必须指向**全新临时测试仓库**，不得绑定真实 `D:\UserProgram\winning-platform-monorepo`、真实业务子仓或用户日常开发目录；禁止执行真实 TFS Sync、PR、OpenSpec 正式 Change。
- POC Agent 只能操作测试仓库内 `poc/` 和虚拟 `business-service/`；不得访问真实源码、生产密钥、MCP/TFS API。
- 禁止为了让测试通过而删除历史 Run、强行 `rerun`、盲目重试或绕过权限。仅对本轮创建的对象有变更授权。
- 在结果报告中记录当前 CLI / Daemon 版本与 Git commit（若可见）。先运行 CLI `--help` 核对本机是否支持下列参数；**当前安装版本是最终依据**。

**建议资产：** 同一个临时 Project，下建 `POC DS01`（Lead + Worker A + Worker B），两个 Worker 绑定同一 Daemon / Runtime；可选 `POC DS02`（验证轮询）。Agent 预设为仅执行显式 POC 指令；不要加载真实交付 Skill。`POC DS01` Leader 接单时仅根据特定测试 Issue 路由指定 Worker，不创建真实子 Issue / PR / TFS 任务。不要将 POC Leader 当作业务 Delivery Lead 正式实例。

**最低测试环境：** 一台 Windows 或 Linux 机器、Multica CLI 与 Daemon、两个 POC Worker、一个独立 Local Directory 即可完成核心 S11-01～S11-05。两机器仅用于可选 S11-06。

### 1.1 创建一次性 Git Fixture（包含独立业务子仓）

在受控的测试目录中创建以下结构（例如 Windows `D:\multica-poc\rr-fixture` 或 Linux `/srv/multica-poc/rr-fixture`，必须符合 Multica Local Directory 路径校验和写权限要求）：

```text
rr-fixture/                     # 临时 Git 根仓
  AGENTS.md                     # POC 限定：不得操作 fixture 之外
  poc/
    shared-contract.md          # 初始内容 BASE
  .gitignore                    # 忽略 business-service/
  business-service/             # 单独 git init 的业务子仓（非 submodule）
    contract.txt                # 初始内容 BASE
```

由本地 Agent 创建两个各含一个基线 Commit 的独立 Git 仓库；`.gitignore` 加 `business-service/`。仅提交虚拟测试内容，并在开始前记录两个仓库各自的 `HEAD`、`git status --short`、绝对路径。**注意：根仓 `git status` 干净不意味着被忽略的业务子仓干净，必须分别检查。**

### 1.2 只读基线与专用资源绑定

```bash
multica --version
multica daemon status --output json
multica --workspace-id <POC_WORKSPACE_ID> runtime list --output json
multica --workspace-id <POC_WORKSPACE_ID> squad list --output json
multica --workspace-id <POC_WORKSPACE_ID> agent list --output json
multica --workspace-id <POC_WORKSPACE_ID> project resource list <POC_PROJECT_ID> --output json
```

未绑定时，仅在专用 POC Project 下添加：

```bash
multica --workspace-id <POC_WORKSPACE_ID> project resource add <POC_PROJECT_ID> \
  --type local_directory \
  --local-path <ABSOLUTE_POC_FIXTURE_PATH> \
  --daemon-id <POC_DAEMON_ID> \
  --execution-mode in_place \
  --label "POC-RR-in-place"
```

Windows PowerShell 请用单行命令或以反引号替代 Bash 的行末 `\`；`--local-path` 需引用为合法字符串。**如果该 Project / Daemon 已有对应资源，先只读对账，不重复添加。** 每次 Run 回读：Project ID、Daemon ID、Runtime ID、Agent ID、Issue ID、`cwd`、根仓和业务子仓 HEAD。**所有 Workspace 级 CLI 读取与写入都必须显式指定 `--workspace-id <POC_WORKSPACE_ID>`；不要依赖 CLI 当前默认 Workspace。**

## 2. 测试矩阵

| Case | 验证目标 | 前置要求 | 关键预期 |
| --- | --- | --- | --- |
| **S11-01** | 原生并发控制作用域 | 只读 Agent / Squad / Daemon 配置 | 无 Squad 级并发参数；Agent / Daemon / Local Directory 各司其职 |
| **S11-02** | `in_place` 的 Worker Run 串行 | 同机同 Project / Daemon / 真实目录，两条 Worker Run 重叠申请 | 后到 Worker 进入 `waiting_local_directory` 或先被上游并发队列挡住；同目录写入不交叉 |
| **S11-03** | Squad Leader 是否可并行接单 | 一个 Worker 长 Run，占用目录；同 Squad 新 Issue 派给 Leader | 新 Leader Run 能被调度；不因为 Worker 目录锁而保持整个 Issue 被占用 |
| **S11-04** | 审核期工作区是否安全 | A 已结束 Run，停 `blocked`（或已配置的 `analysis_review`）；B 属于同 Squad | B 可以进入同一目录；如更改 A 的保留文件则交付隔离 FAIL |
| **S11-05** | Agent 并发数是否等于 Issue 并发数 | 只改 POC Agent 并发为 1；A 等待人工 | B 仍可能在 A 的 Run 间隙执行，Agent 限制不提供 Issue 锁 |
| **S11-06（可选）** | Round Robin 与两机跨 OS 路由 | 2 Squads / 2 Daemons / Local Directories | 4 个 Issue 按规则交给目标 Squad；验证两个独立目录隔离、Runtime 不串机 |
| **S11-07（条件测试）** | 完整 Issue 隔离的替代机制 | 已设计独立 Issue 工作区及恢复机制 | 同 Squad 多 Issue 各自恢复正确的根仓 + 业务子仓；否则 NOT_RUN |

**重要：** S11-02/03 可以证明 Multica 调度机制的具体事实，只有 S11-04/05/07 能决定是否允许取消 Capacity WAIT。

## 3. 逐项测试步骤与验收

### S11-01：确认 Squad 没有原生并发阈值

1. 对照 POC Squad 详情和 `multica --workspace-id <POC_WORKSPACE_ID> squad get <SQUAD_ID> --output json`，检查是否存在独立 `capacity` / `max_concurrent_tasks`。
2. 检查 `multica --workspace-id <POC_WORKSPACE_ID> agent get <WORKER_ID> --output json` 的 `max_concurrent_tasks`，回读 Daemon 运行配置与 Project Resource 的 `execution_mode`。
3. 记录结论：若 Squad 没有独立限制，不能将 `Squad max_concurrent=1` 写作实施前提；Agent 上限、Daemon 上限和目录锁各自控制不同层面。

**PASS：** 获取真实 API/CLI 配置，明确不存在可用的 Squad 级阈值，并列出有效的三个执行限制；若部署版本有新字段，以原生实际行为为准并更新发现。

### S11-02：同目录 Worker Run 是否真正串行

1. 将 POC Worker A、B 绑定相同 Daemon 上的 Runtime；POC Agent 并发上限至少为 2，Daemon Run 并发上限也至少为 2，避免上层队列掩盖目录锁的行为。
2. 建立两个独立 POC Issue，确保都属于专用 Project。先以 `backlog` 创建；通过 Issue Assignment 或真实 `@mention` 明确启动 Worker A 与 Worker B（启动操作不可带 `--no-start`）。
3. Worker A 的测试指令：在 fixture `poc/` 下创建 `lock-A-start.txt`，记录 Run ID / UTC 时间 / `cwd`，保持 Run 活跃一段足以观测的时间（建议 30～60 秒），再写 `lock-A-end.txt`；不可操作 fixture 之外。
4. A 开始后立即启动 Worker B，B 在相同 fixture 的 `poc/` 下完成同类型日志。
5. 在第二条 Run 排队时，连续回读两条 Issue 的 `issue runs --active` 与 Run Timeline，核对 `waiting_local_directory` / `running` / `queued`，以及标记文件出现的顺序。

```bash
multica --workspace-id <POC_WORKSPACE_ID> issue runs <ISSUE_A_ID> --active --output json
multica --workspace-id <POC_WORKSPACE_ID> issue runs <ISSUE_B_ID> --active --output json
multica --workspace-id <POC_WORKSPACE_ID> issue timeline <ISSUE_A_ID> --output json
multica --workspace-id <POC_WORKSPACE_ID> issue timeline <ISSUE_B_ID> --output json
```

**PASS：** 两条 Run 各自产生持久化证据，证明存在等待且没有同时持有同一路径写锁；如果只观察到 Agent / Daemon 的 `queued` 而没有 `waiting_local_directory`，记录 **PARTIAL / BLOCKED**，调高测试环境并发并重测。**不要根据开始/结束 Comment 的时间代替文件与 Run 状态证据。**

### S11-03：Leader 能否在 Worker 忙碌时继续接单

1. 新建或重新触发 **POC 专用 Worker 长 Run**，让 Worker A 在同一 POC 目录中保持 Run 活跃。不得假定 S11-02 的 Run 仍在执行。
2. 新建 Issue C，以 `backlog` 创建并指定 `POC DS01`，通过一次状态切换为 `todo` 触发 Squad Leader；不调用人工 `rerun`。
3. 在 Worker A 未结束前，记录 Issue C 的唯一 Leader Run ID、状态、是否从 `queued` 进入 `running`、该 Run 的 `cwd`；不得假定 Leader 与 Worker 使用同一目录。
4. 依据真实 Leader 行为确认其是否能够进一步委派，而非将新 Issue 自动挡在 “Squad 忙” 的原生关口。

```bash
multica --workspace-id <POC_WORKSPACE_ID> issue status <ISSUE_C_ID> todo --output json
multica --workspace-id <POC_WORKSPACE_ID> issue runs <ISSUE_C_ID> --output json
```

**PASS（机制确认）：** Worker A 仍在运行时，Leader C 已实际运行或作出调度；若 Leader 因自身 Agent/Daemon 并发资源被阻塞，应区分这类上层资源等待与 `local_directory` 锁。观察到的 Leader 不持有该目录锁与官方源码一致，但不能仅凭源码直接记本机 PASS。

### S11-04：最关键——两个 Issue 跨人工审核期的文件污染

**这是风险验证，不是生产操作。只使用测试 fixture。**

1. Issue A 已由 POC Agent 完成一次 Analysis Run，在根仓 `poc/shared-contract.md` 和独立业务子仓 `business-service/contract.txt` 写入 `OWNER=A`、`ISSUE=A` 标记，**故意保留为未提交的测试修改**。本地 CLI 回读 `git diff` / `git status`（根仓和业务子仓分别检查）。
2. 将 A 置于 `blocked --no-start`；若 POC Workspace 已配置 `analysis_review`，可额外用该状态再测一轮。确保 A 目前 `issue runs --active` 为空。此时 **A 未完成交付**，但没有活跃 Run。
3. 将 Issue B 指派给同一个 POC Squad / Worker。B 的受控测试指令先读取两份文件、记录是否看到 `OWNER=A`，随后**仅在这两份 POC 文件中**改写为 `OWNER=B`、`ISSUE=B`，留下证据；不进行 Git commit / reset / clean。
4. B 的 Run 结束后，回读 A 的工作目录文件、两个 Git 状态和 A 的 Issue Status。确认 A 仍处于审核等待，但其工作区内容是否已被 B 改写。
5. 触发 A 的 POC 恢复 Run，指令仅验证 `OWNER=A` 和原始 Git Base 是否仍可恢复；**不自动修复、重置或覆盖 B 的修改**。记录识别结果。

```bash
multica --workspace-id <POC_WORKSPACE_ID> issue status <ISSUE_A_ID> blocked --no-start --output json
multica --workspace-id <POC_WORKSPACE_ID> issue runs <ISSUE_A_ID> --active --output json
multica --workspace-id <POC_WORKSPACE_ID> issue get <ISSUE_A_ID> --output json
# 根仓：git status --short；git diff -- poc/shared-contract.md
# 子仓：git -C business-service status --short；git -C business-service diff -- contract.txt
```

**实施可行性判定：**

- B 成功覆盖 A 仍需保留的两份文件、A 恢复时看到 B 的内容：`Delivery Isolation = FAIL`，`Direct RR = UNSAFE`。这不表示 Multica 目录锁失效，而是证明其作用域只有 Run。
- 若 B 被某一明确、可复现的原生 Issue 级机制阻止，在确认与人工偶然阻止无关后，记录实现与证据，再考虑放行。
- 若 B 自主拒绝改写但平台未阻止：此结果 **INCONCLUSIVE**，不能把 Agent 的善意决策当成调度安全保证。

### S11-05：Agent / Daemon 并发数不能补齐审核期保护

1. 仅将**POC Worker** 的 `max_concurrent_tasks` 设为 `1`；不要修改正式 Agent，更不要直接重启共享生产 Daemon 来改变机器全局并发。
2. 重复 S11-04（使用新的临时 Git Fixture 基线），确保 A 的 Run 已完成、状态停在审核等待。再提交 B Run。
3. 观察 B 是否依然可启动、修改 A 的遗留文件。记录 A/B 的 Run 重叠时段是否为零。

```bash
multica --workspace-id <POC_WORKSPACE_ID> agent update <POC_WORKER_ID> --max-concurrent-tasks 1 --output json
multica --workspace-id <POC_WORKSPACE_ID> agent get <POC_WORKER_ID> --output json
```

**PASS（风险机制确认）：** 即使 Agent Run 完全不重叠，B 仍能在 A 未完成 Delivery 时进入共享目录；若发生交叉污染，最终 `Direct RR = UNSAFE`。完成后把 POC Worker 的并发参数恢复到原值，保存前后回读。

### S11-06（可选）：真正的两个 Squad Round Robin 分发

该 Case 需要两个 POC Squad。两机/跨 OS E2E 还要求两个 Daemon 分别指向自己的 Local Directory；**单机模拟两个 Squad 只能证明控制面分配规则，不能证明机器隔离或负载分摊。**

1. 创建 4 个独立测试 Issue `RR-1 … RR-4`（实际编号以 CLI 返回为准），均先置 `backlog`。
2. 在无其他能力限制的条件下，采用固定且可回放的映射：`RR-1 → DS01`、`RR-2 → DS02`、`RR-3 → DS01`、`RR-4 → DS02`。每个 Issue 使用单次 `status=todo + assignee-id=<SQUAD_UUID>` 更新。
3. 回读每个 Issue Owner、Status、Leader Run ID，确保没有错误交给其他 Squad、没有重复自动 Run。
4. 如果还没有 `Squad Coordinator` 的实际执行脚本，明确标记本轮为 **手动 Round Robin 路由模拟**，**不得宣称 Coordinator 自动调度 PASS**。
5. 观察 Runtime Offline：直接 Round Robin 即使平均分配，也可能将 Issue 分给离线 Runtime。分别记录“只检查 OS/Capability、在线”的简单过滤是否必要。

```bash
multica --workspace-id <POC_WORKSPACE_ID> issue update <POC_ISSUE_ID> \
  --status todo --assignee-id <TARGET_SQUAD_UUID> --output json
multica --workspace-id <POC_WORKSPACE_ID> issue get <POC_ISSUE_ID> --output json
multica --workspace-id <POC_WORKSPACE_ID> issue runs <POC_ISSUE_ID> --output json
```

**PASS：** 4 个 Issue 的目标分配符合顺序、所有启动记录唯一且可复核；这**不自动代表无需 WAIT、无需 Worktree 就安全**。

### S11-07（条件测试）：取消 WAIT 的安全前提

只在已具备“每个 Issue 独立的根仓 + 每个相关业务子仓 + 回流/恢复路径”方案时执行。

1. 为 A 和 B 创建完全独立的工作区，包括根仓、独立业务子仓、OpenSpec Artifact，记录所有 Repo 的 Head / Branch / 路径。
2. A 在审核期退出 Run；B 修改相同逻辑路径；A 再次启动。
3. 验证 A/B 不互读未提交文件、A 能恢复它自己的 OpenSpec / 子仓分支，且各自后续 PR 所属 Repository 正确。
4. 如果只使用根仓的 `worktree`，而独立业务子仓没有同步隔离，**不可视为通过**。

**PASS：** 有真实、持续的 Issue 级全工作区隔离证据。未实现这种隔离则 `NOT_RUN`，不必为验证单独开发完整系统。

## 4. 证据要求

在 `docs/multica/validation/round-robin-native-concurrency-result-YYYY-MM-DD.md` 中保留：

- 环境：时间、Workspace/Project UUID、Daemon/Runtime UUID、CLI/Daemon 版本、测试 OS、POC fixture 的两个真实 Git 路径；仅记录非敏感值。
- 每项测试：Issue ID、Squad ID、Agent ID、Run ID（包括启动时刻/结束时刻）、Timeline、Run Status、实际 cwd、关键 CLI 命令与退出码。
- S11-02：`waiting_local_directory` 与文件时间顺序的直接证据；无法捕获要说明。
- S11-04/05：**两个 Git 仓库**的 `HEAD` / `status --short` / `diff`；A 中断、B 写入、A 恢复三个时点的文件内容及 SHA256。
- 调度表：Issue → Squad → Leader → Worker → Runtime → Project Local Directory；如有失败，记录首次失败证据，不靠补救成功掩盖失败。
- 分别给出 `Run Scheduling`、`Delivery Isolation`、`Direct Round Robin Feasibility` 三个结论；`PARTIAL/BLOCKED` 不能写成总体 PASS。

## 5. 失败处理与清理

- `MULTICA_*` 运行时凭据、Token、MCP Secret、个人路径中的敏感信息不得写入报告。
- CLI 返回超时或未知状态时，先 `issue get`、`issue runs`、`issue timeline` 对账；不盲目重试写操作。
- 只停止 POC Issue 的活跃 Run；不要改变正式 Agent / Runtime 设置，不删除非 POC 的文件。
- 保留本轮证据后，再由本地操作者决定是否归档 POC Agent/Squad/Issue 与删除 POC fixture；不得自行删除正式资源、分支或改动。
- 如 POC 使用的版本与 `0.6.1` 或所引用源码不同，明确标注差异与重新核实的行为。

## 6. 结果报告模板

```markdown
# Round Robin + Native Concurrency PoC 结果

- Date / OS:
- Multica CLI / Daemon version:
- POC Workspace / Project:
- Fixture Root / Child Repository:
- POC Squad / Agent / Runtime IDs:

| Case | Result | Issue IDs | Run IDs | 核心证据 | 问题 |
|---|---|---|---|---|---|
| S11-01 | NOT_RUN | | | | |
| S11-02 | NOT_RUN | | | | |
| S11-03 | NOT_RUN | | | | |
| S11-04 | NOT_RUN | | | | |
| S11-05 | NOT_RUN | | | | |
| S11-06 | NOT_RUN | | | | |
| S11-07 | NOT_RUN | | | | |

## Three Verdicts
- Run Scheduling: PASS / FAIL / INCONCLUSIVE
- Delivery Isolation: PASS / FAIL / INCONCLUSIVE
- Direct Round Robin Feasibility: DIRECT_RR_SAFE / DIRECT_RR_UNSAFE / INCONCLUSIVE

## Recommendations
- Can remove Coordinator WAIT/Capacity now? YES / NO / NOT_YET
- Minimum required isolation or guard:
- Remaining PoC items:
```

## 7. 本地 Agent 执行指令（可直接复制）

> 阅读本验证方案，以及 `docs/multica/multi-squad-coordination-design.md`。仅在隔离 POC Workspace / Project 和全新临时 Git 根仓、独立业务子仓中执行。先做只读盘点及 CLI 参数核对，再按 S11-01、S11-02、S11-03、S11-04、S11-05 执行；S11-06/07 条件不足则明确 NOT_RUN。所有有副作用操作仅限 POC 对象和目录。每项保留真实 CLI、Run、Timeline、Git HEAD/status/diff 证据。重点检查 A 在审核期结束 Run 后，B 是否能改动 A 保留的根仓与独立业务子仓文件。不得把 Run 串行认定为 Issue 隔离。结果写入 `docs/multica/validation/round-robin-native-concurrency-result-YYYY-MM-DD.md`。不修改 01–07、独立候选设计、正式 Multica 配置、TFS、业务仓库；不提交/合并 PR，发现问题先记录并停止危险写入。

## 8. 本方案依据

- [Multica Squads：Leader 触发与 Squad 并发边界](https://github.com/multica-ai/multica/blob/2ea01ae4e/apps/docs/content/docs/squads.mdx)
- [Multica Project Resources：`in_place` 串行锁与 Worktree](https://github.com/multica-ai/multica/blob/2ea01ae4e/apps/docs/content/docs/project-resources.mdx)
- [Multica Daemon Local Directory：Leader 不绑定 Local Directory；锁是 Run 级](https://github.com/multica-ai/multica/blob/2ea01ae4e/server/internal/daemon/local_directory.go)
- [Multica Daemon / Runtime 并发限制](https://github.com/multica-ai/multica/blob/2ea01ae4e/apps/docs/content/docs/daemon-runtimes.mdx)
- [Multica Issue CLI：`--active`、`--no-start`、`--assignee-id`](https://github.com/multica-ai/multica/blob/2ea01ae4e/server/cmd/multica/cmd_issue.go)

> 此为验证规程，不是 Multica 环境执行报告；上述测试的实际结果均尚未验证。
