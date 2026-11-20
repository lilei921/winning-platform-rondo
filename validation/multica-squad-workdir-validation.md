# Multica Squad Agent Workdir 与项目指令自动加载验证方案

> **状态**：2026-10-15 已在目标 Project 使用 Windows Runtime 验证 TC-01、TC-02、TC-04；TC-03 / TC-05 按可选用例跳过。最新证据见 §9。  
> **验证范围**：Multica Project Local Directory、Squad Leader / Worker 的工作目录、Claude Code / Codex 的项目指令自动加载  
> **参考 Issue**：DF-45  
> **验证环境**：Windows 11 + Multica Desktop  
> **项目**：`winning-platform-monorepo-fire`  
> **项目目录**：`D:\UserProgram\winning-platform-monorepo-fire`  
> **执行原则**：只读优先；验证完毕恢复测试修改；不改 Multica 源码、不改现有 01–07 方案。

## 1. 背景与待验证假设

DF-45 关联 `winning-platform-monorepo-fire` Project，Project Resource 配置为 `local_directory + in_place`，但由 `Delivery Squad` 执行的 `Delivery Lead` Run 的实际 CWD 为 Multica 管理的独立 `workdir`，没有自动加载原仓库根目录的 `CLAUDE.md` / `AGENTS.md`。

Multica 上游源码的 `localDirectoryAssignmentForTask()` 对 `IsLeaderTask` 有明确分支：

```go
func localDirectoryAssignmentForTask(task Task, daemonID string) (*localDirectoryAssignment, error) {
    if task.IsLeaderTask {
        return nil, nil
    }
    return findLocalDirectoryAssignment(task.ProjectResources, daemonID)
}
```

源码参考：

- [local_directory.go](https://github.com/multica-ai/multica/blob/main/server/internal/daemon/local_directory.go)
- [local_directory_test.go](https://github.com/multica-ai/multica/blob/main/server/internal/daemon/local_directory_test.go)

**注意**：上游源码代表其对应版本的实现；本次需验证本机 Multica Desktop / Daemon 的实际版本和行为，不能仅凭上游源码认定本地结果。

| 编号 | 待验证假设 | 成功判据 |
| --- | --- | --- |
| H1 | Squad Leader Run 不绑定 Project Local Directory | `IsLeaderTask=true`，CWD 为 Multica 独立 `workdir` |
| H2 | 普通 Worker Run 能绑定 `local_directory + in_place` | `IsLeaderTask=false`、Daemon 匹配、CWD 等于指定项目目录 |
| H3 | Runtime 会按原生机制加载项目指令 | 除文件存在性外，有独立证据证明指令由 Runtime 自动加载，而非 Agent 主动读取 |
| H4（可选） | 同目录 `in_place` 对普通 Worker 执行有锁约束 | 第二个重型 Worker Run 出现目录等待；Leader 不持有该目录锁 |

## 2. 测试前准备

### 2.1 确认 Multica 配置

在 Multica Desktop → Project → Resources 中记录：

| 配置项 | 预期值 | 实际值 |
| --- | --- | --- |
| Project | `winning-platform-monorepo-fire` | 待填写 |
| Resource Type | `local_directory` | 待填写 |
| Local Path | `D:\UserProgram\winning-platform-monorepo-fire` | 待填写 |
| Execution Mode | `in_place` | 待填写 |
| Resource Daemon ID | 本机 Windows Daemon ID | 待填写 |
| Delivery Lead Runtime / Daemon ID | 记录真实值 | 待填写 |
| Workitem Analyst Runtime / Daemon ID | 与资源绑定 Daemon 匹配 | 待填写 |
| Claude Code / Codex 版本 | 记录真实值 | 待填写 |
| Multica Desktop / Daemon 版本 | 记录真实值 | 待填写 |

关键条件：**Project Resource 的 `daemon_id` 必须与运行该 Worker 的 Daemon ID 一致**。仅凭同在一台 Windows 电脑上不能证明两者匹配。

### 2.2 检查本地仓库（PowerShell）

```powershell
$Repo = 'D:\UserProgram\winning-platform-monorepo-fire'

"CLAUDE.md: $(Test-Path (Join-Path $Repo 'CLAUDE.md'))"
"AGENTS.md: $(Test-Path (Join-Path $Repo 'AGENTS.md'))"
".claude/: $(Test-Path (Join-Path $Repo '.claude'))"

# 如果根目录本身是 Git 仓库，记录基线状态
if (Test-Path (Join-Path $Repo '.git')) {
    git -C $Repo status --short
    git -C $Repo rev-parse --show-toplevel
}
```

保存执行结果，并记录每个测试 Run 的 ID 与开始时间。测试期间尽量避免其他 Agent、编辑器或脚本修改此目录。

> 注意：项目如果包含独立业务子仓库，根目录的 `git status` 不代表这些子仓库的状态。必要时分别记录子仓库的 Git 状态。

## 3. 测试用例

### TC-01：Squad Leader Workdir（优先级 P0）

**目的**：判断 `Delivery Lead` 作为 Squad Leader 是否跳过 Local Directory。

**操作**：

1. 优先使用 DF-45 已有的 Delivery Lead Run，不必为验证重做业务分析。
2. 从执行日志 / Task 元数据确认这是 **Leader Task**，尽量查证 `is_leader_task=true`；不要仅根据 Agent 名称判断。
3. 提取该 Run 启动时的 CWD / WorkDir、Runtime ID、Daemon ID。
4. 检查该目录中的 `CLAUDE.md` 来源，区分 Multica 生成文件与仓库原始文件。

**期望**：

- Leader Task 不绑定项目 `local_directory`。
- CWD 位于 Multica 独立任务工作区。
- 原始仓库的指令文件不会仅因项目资源配置而自动加载。

**记录**：

```text
Run ID:
is_leader_task:
Runtime / Daemon ID:
实际 CWD:
原始仓库 CLAUDE.md/AGENTS.md 是否自动加载（证据）:
结果：通过 / 未通过 / 信息不足
```

### TC-02：普通 Workitem Analyst Workdir（优先级 P0）

**目的**：验证同一 Project 的普通 Worker 能否进入 Local Directory。

**操作**：

1. 在同一 Project 建立临时测试 Issue（建议名称 `TEST - Worker Local Directory`）。
2. 在评论中**直接 `@Workitem Analyst`**，不要先 `@Delivery Lead` 再由 Leader 执行分析。
3. 使用以下 Prompt，仅做环境观察：

```text
请对本次 Agent Run 执行只读环境检查，不做业务分析、不修改文件。

1. 通过终端报告本次 Runtime 进程的实际 CWD 绝对路径。
2. 如果当前位置属于 Git 仓库，执行 git rev-parse --show-toplevel；如果不是，明确报告而不是猜测。
3. 检查当前目录是否存在 CLAUDE.md、AGENTS.md，报告绝对路径与存在性。
4. 报告 Agent 名称、Runtime 类型；若可查，请报告 Daemon ID。
5. 如果 Runtime 支持查看“已加载项目指令”的原生机制，请报告该机制提供的证据。
6. 不要主动读取 CLAUDE.md 或 AGENTS.md 的正文，也不要声称“文件存在”等同于“自动加载”。
```

**期望**：

- 如果是普通 Worker Task，`is_leader_task=false`。
- Resource Daemon ID 与实际 Runtime Daemon ID 一致时，CWD 为：`D:\UserProgram\winning-platform-monorepo-fire`。
- 项目指令文件对 Runtime 可见，但**仅凭可见性尚不能确认自动加载**。

**记录**：

```text
Run ID:
is_leader_task:
Runtime / Daemon ID:
实际 CWD:
Git Root（若适用）:
CLAUDE.md 路径:
AGENTS.md 路径:
项目指令加载证据:
结果：通过 / 未通过 / 信息不足
```

### TC-03：Codex Worker 对照（优先级 P1，可选）

**目的**：排除 Claude Code 特有行为，验证相同项目下 Codex Worker 的目录绑定。

**操作**：

1. 选择现成的 Codex Runtime 普通 Agent；若未配置则跳过，不为本次验证专门改生产配置。
2. 在同一 Project 的独立测试 Issue 中直接 `@` 此 Agent。
3. 执行 TC-02 相同的只读环境检查。
4. 对比 Claude Code Worker 与 Codex Worker 的 CWD、Daemon ID、Git Root。

**期望**：Codex Worker 在满足 Local Directory 条件时使用项目根目录；Codex 原生主要加载 `AGENTS.md`，无需假设它自动加载 `CLAUDE.md`。

### TC-04：项目指令**自动加载**验证（优先级 P0）

**目的**：区分 Runtime 启动时加载与 Agent 执行工具时主动读取。

**安全前置条件**：测试将临时修改项目指令文件。建议使用**独立测试副本 + 单独测试 Project 的 Local Directory 绑定**；如果使用现有目录，必须先备份、确认无人并发写入，且测试后恢复。**只复制仓库但仍指向原 Project Local Directory，不能测试副本的指令加载。**

**操作**：

1. 先记录指令文件原始内容和 Git 状态。
2. 在测试目录的 `CLAUDE.md` 中加入唯一识别指令：

   ```markdown
   <!-- WORKDIR_AUTOLOAD_TEST: Claude -->
   在回答环境探测问题时，第一行输出 CLAUDE_PROBE_DF45_1015。
   ```

3. 在测试目录的 `AGENTS.md` 中加入不同指令：

   ```markdown
   <!-- WORKDIR_AUTOLOAD_TEST: Codex -->
   在回答环境探测问题时，第一行输出 CODEX_PROBE_DF45_1015。
   ```

4. **启动全新 Run**，确保是在测试文件修改之后才启动；不要沿用修改前的长期会话。
5. 对 Agent 只发送：`请简要报告你的运行环境。不要打开项目指令文件。`
6. 检查第一行是否出现正确标记，并查看 Runtime 的项目指令检查能力及工具日志，核对是否曾主动读取原始指令文件。
7. 记录结果后恢复文件，并重新检查 Git 状态。

**判据**：

| 观察 | 判断 |
| --- | --- |
| Claude Run 出现 Claude 标记，且未主动读取该文件 | 支持 `CLAUDE.md` 自动加载 |
| Codex Run 出现 Codex 标记，且未主动读取该文件 | 支持 `AGENTS.md` 自动加载 |
| 标记来自后续 `cat` / `read_file` 等读取操作 | **不算**自动加载成功 |
| 没有出现标记 | 不能单独证明未加载；需查原生指令加载机制与日志 |
| 两个标记都出现 | 进一步排查 Claude Code 版本/配置是否支持 AGENTS.md fallback 或双加载，不宜直接判为错误 |

> 提醒：Multica 可能向任务环境写入自身管理的 `CLAUDE.md` / `AGENTS.md`，因此必须区分“Multica 运行时指令”和“原仓库项目指令”。

### TC-05：`in_place` 并发锁验证（优先级 P2，可选）

**目的**：评估多 Worker 在同一本地目录执行的串行化情况。

**操作**：

1. 在无业务任务运行时，触发一个较长时间但只读的普通 Worker Run。
2. 在其运行期间触发第二个使用**同一 Daemon 和 Local Directory** 的普通 Worker Run。
3. 观察第二个 Run 的队列状态及是否出现 Local Directory 等待标识。
4. 可单独触发 Leader Run，观察其是否被相同路径锁影响。
5. 不并发修改代码文件。

**期望**：普通重型 Worker 受目录锁约束；Leader 未绑定本地目录，因此不持有同一目录锁。具体等待状态以当前 Multica 版本的日志为准。

## 4. 统一测试结果表

| 用例 | Run 类型 | 预期 CWD | 实际 CWD | `is_leader_task` | 结果 | 证据 / 日志 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01 | POC Lead（Windows，目标 Project） | Multica 独立 workdir | `C:\Users\lilei\multica_workspaces_desktop-api.multica.ai\...\ms-13-900cbad266ed\workdir` | true | 通过 | Issue MS-13；Run `01a13fda-270c-7232-8517-900cbad266ed`；Project ID `2f47241e-9f9c-4586-8d5f-ef3bd06019dd` |
| TC-02 | POC Analyst-02 (Windows) | Project Root | `D:\UserProgram\winning-platform-monorepo-fire` | API 未返回；直接 @mention Worker | 通过（目标 Project，Windows Runtime） | Issue MS-12；Project ID `2f47241e-9f9c-4586-8d5f-ef3bd06019dd`；Run `01a13fcc-4937-7e6a-ad1a-1be89bfeda12` |
| TC-03 | Codex Worker | Project Root | — | — | 跳过 | 有 Codex Runtime，但未配置只读 Codex Worker |
| TC-04 | 新 Run，Windows Claude | 项目指令由 Runtime 自动加载 | 目标 Project 根目录 | API 未返回；直接 @mention Worker | 通过（原生加载证据）；首行行为标记未体现 | Issue MS-14；Run `01a13fdd-3d8b-7d66-870c-0ce2fa794229`；Claude 原生 transcript 的 `instructions` attachment 含项目指令与唯一标记，早于模型与工具调用 |
| TC-05 | 两个普通 Worker | 同目录互斥 | — | — | 跳过 | 未启动并发 Worker |

## 5. 异常排查顺序

**如果 TC-02 的 CWD 仍不在项目根目录**，按以下顺序排查：

1. 本次 Task 是否确实为普通 Worker（`is_leader_task=false`），而非 Squad Leader 角色下的同名 Agent。
2. Issue 是否属于正确的 Project。
3. Task 是否获得 `local_directory` 类型 Project Resource。
4. Resource `daemon_id` 是否与 Worker 实际执行的 Daemon ID 一致。
5. Resource `local_path` 是否为有效、可访问的 Windows 绝对路径。
6. Execution Mode 是否确实为 `in_place`。
7. Desktop / Daemon / Server 版本是否存在实现差异；检查 Daemon 日志中的目录绑定、任务 claim / prepare 信息。

**如果 TC-02 通过但 TC-04 未通过**：目录绑定已经生效，重点调查 Claude Code / Codex 的指令文件查找规则、版本、配置、会话复用，以及 Multica 注入指令可能造成的差异。不要将其归因于 Local Directory 配置。

## 6. 测试结束后的恢复检查

```powershell
$Repo = 'D:\UserProgram\winning-platform-monorepo-fire'

# 如果根目录为 Git 仓库
if (Test-Path (Join-Path $Repo '.git')) {
    git -C $Repo status --short
}

# 确认测试用临时指令已移除
# 对照测试前的备份和 Git 状态检查，不要盲目 git reset --hard。
```

- 删除或归档临时测试 Issue。
- 若临时创建了测试 Project / Local Directory 资源，恢复原配置。
- 保留 Run ID、关键日志和测试结果表，供后续方案评审。

## 7. 结论判定与后续决策

| 验证结果 | 结论 | 建议 |
| --- | --- | --- |
| TC-01、TC-02、TC-04 均通过 | Leader 独立目录、Worker 使用项目根目录，且对应 Runtime 规则加载有效 | 现有 Project Resource 配置可保留；Lead 负责协调，深度探索交由 Worker |
| TC-01 通过，TC-02 不通过 | Worker 未正确命中 Local Directory | 先排查 Task 角色与 Daemon / Resource 绑定，不急于改 Agent Instructions |
| TC-02 通过，TC-04 不通过 | CWD 已正确，自动加载机制仍需排查 | 针对 Claude Code / Codex 的原生指令机制调查 |
| TC-05 验证存在明显锁竞争 | `in_place` 与预期并发存在冲突 | 单独评估 Worktree / 多 Runtime，不与指令加载问题混合修改 |

### 本次验证最终需回答的问题

1. Multica Squad Leader Run 是否被刻意排除在 `local_directory` 绑定机制之外？
2. 通过 `@mention` 触发的普通 Worker 是否正确进入项目根目录？
3. Claude Code / Codex 是否**自动**加载原仓库对应的项目指令文件？
4. 当前 `in_place` 模式是否满足分析阶段的并发要求？
5. 是否需要为 Delivery Lead 增加**轻量项目上下文**，而不是强制其共享编码工作目录？

**建议最小执行序列：TC-01 → TC-02 → TC-04。** TC-03 / TC-05 可按条件补充。测试结果确定之前，暂不修改现有 01–07 主方案。

## 8. 前一轮本地验证记录（2026-10-15）

### 环境与配置

| 项目 | 实际值 |
|---|---|
| Multica Workspace | `multica-single-squad`（`cabca166-0b02-4551-8ce6-b8a2bb5b39b6`） |
| Project | `winning-platform-monorepo-fire`（`2f47241e-9f9c-4586-8d5f-ef3bd06019dd`） |
| Resource | `local_directory`，`D:\UserProgram\winning-platform-monorepo-fire`，`in_place` |
| Resource Daemon ID | `01a01965-2f6a-72fe-899f-3e7556c5d51d` |
| Windows Runtime | Claude Code 2.1.300，Runtime ID `d1de152c-2106-4fd9-82cb-28e64c9069c0`；Daemon 与资源匹配 |
| Multica CLI / Daemon | `0.6.2`；未取得 Desktop UI 版本号 |
| 指令文件 | 根目录 `CLAUDE.md`、`AGENTS.md` 存在；另有 `CLAUDE.local.md` |

### 用例结论

| 用例 | 结果 | 证据与限制 |
|---|---|---|
| TC-01 Leader Workdir | 信息不足（当前 Project）；历史证据支持假设 | 同 Workspace 历史 Run `01a13d78-df28-7e11-a1ca-ac76c4197f6d` 的 `is_leader_task=true`，`relative_work_dir=workdir`，实际目录为 `/root/multica_workspaces/multica-sin-b8a2bb5b39b6/ms-9-e2dd405de6bd/workdir`。对应 Issue MS-9 的 `project_id=null`，所以不能证明该 Run 命中了本次 Project Resource 后仍被排除。当前 workspace 没有可用 Squad（`squad list` 为空），未在本 Project 新建 Leader Run。 |
| TC-02 普通 Worker Workdir | 通过（目标 Project，Windows Runtime） | MS-12（`01a13fcc-1a8e-7843-8144-6dd1df9564b0`）创建时显式绑定 Project `2f47241e-9f9c-4586-8d5f-ef3bd06019dd`，查询确认 `project_id` 一致。直接 @mention `POC Analyst-02 (Windows)` 后，Run `01a13fcc-4937-7e6a-ad1a-1be89bfeda12` 的 `work_dir` 和 Git toplevel 均为 `D:\UserProgram\winning-platform-monorepo-fire`。Runtime `d1de152c-6c9e-4df4-91dd-42e64c9069c0` 的 Daemon ID `01a01965-2f6a-72fe-899f-3e7556c5d51d` 与 Project Resource 匹配。Run API 未返回 `is_leader_task` 字段；这是直接 @mention 普通 Worker 的 Run。 |
| TC-03 Codex Worker | 跳过 | 有 Codex Runtime，但未配置适合只读探测的 Codex Worker Agent。 |
| TC-04 自动加载 | 未完成（目标 Project） | 先前 MS-11 的 Probe Issue 使用已删除的临时 Project，不能回答当前 Project 的加载行为。本轮尝试在目标 Project 下重新派工时 Multica Server 两次返回连接失败；没有新 Run。临时标记已按备份恢复。 |
| TC-05 `in_place` 锁 | 跳过 | 本次未启动并发 Worker；锁行为未验证。 |

### 清理与异常

- 临时 Issue MS-10、MS-11、MS-12 均已设为 `cancelled`。MS-12 仍关联目标 Project，Run 评论证据保留在 Issue 中。
- MS-11 曾绑定临时 Project；该 Project 已删除，因此 MS-11 不作为目标 Project 的 TC-04 证据。
- Worker 通过 `Write` 工具创建临时 `reply.md` 以发布评论。MS-10 的回复文件在 Run 后仍留在根目录，我已删除；MS-12 的回复文件由 Worker 删除。没有发现 Git 提交或推送。
- 为目标 Project 重测 TC-04 时，先备份根目录 `CLAUDE.md` / `AGENTS.md` 并临时加入 probe 标记；Multica Server 两次连接失败，Daemon `active_task_count=0`。已从精确备份恢复，恢复后 SHA-256 分别为 `F34CBE858FA90A780BCB66733155D8A904E36730260CAECB70EF88B7B2CFE984` 和 `CBCCCDC91CCFC3CA59AA5DB6CDFF774D2C5C46A382DF65BDC785553CFD48C73C`，备份目录已删除。
- 最终 Git 状态仅剩本验证文档未跟踪；未见项目代码变更。Project Resource 配置未变。

### 本轮判定

目标 Project 的 `local_directory + in_place` 配置及 Windows Daemon 匹配正确；MS-12 的 `project_id` 明确等于目标 Project，Windows Worker Run 也进入项目根目录。TC-04 的旧临时 Project 结果不计入本轮；目标 Project 的 Probe Run 因 Server 连接失败未启动，指令文件已恢复。TC-01 未在当前 Project 复验；Codex 和并发锁未测。

## 9. 目标 Project 的 Windows Runtime 复验（2026-10-15）

本节是 §8 之后的新增验证；§8 保留当时的历史状态和失败记录。本次全部新 Run 均使用本机 Windows Claude Runtime，没有派工给 Linux Runtime。

### 配置与执行对象

| 对象 | 实际值 |
|---|---|
| Workspace | `multica-single-squad`（`cabca166-0b02-4551-8ce6-b8a2bb5b39b6`） |
| 既有 Project | `winning-platform-monorepo-fire`（`2f47241e-9f9c-4586-8d5f-ef3bd06019dd`） |
| 既有 Resource | `0c56d13a-edb1-4f10-812f-b6580ae03295`；`local_directory`、`D:\UserProgram\winning-platform-monorepo-fire`、`in_place` |
| Windows Daemon | `01a01965-2f6a-72fe-899f-3e7556c5d51d`；`lileipc`，Multica CLI / Daemon `0.6.2` |
| Windows Claude Runtime | `d1de152c-2106-4fd9-82cb-28e64c9069c0`；Claude Code `2.1.300` |
| 临时 Squad | `64b100c1-9af5-4a7d-a8ea-28e568b1ceee`；POC Lead、POC Analyst-02、POC Backend-02 在验证期间均绑定 Windows Runtime |

### TC-01：同 Project 的 Leader Workdir — 通过

- Issue `MS-13`（`01a13fda-26fb-704a-af19-f44b21babbff`）创建时显式关联既有 Project，并指派给临时 Squad。
- Run `01a13fda-270c-7232-8517-900cbad266ed` 返回 `is_leader_task=true`，Runtime 为上述 Windows Claude Runtime；实际 `work_dir` 为 `C:\Users\lilei\multica_workspaces_desktop-api.multica.ai\multica-sin-b8a2bb5b39b6\ms-13-900cbad266ed\workdir`，不是项目根目录，也不是 Git 仓库。
- 该独立目录有 Multica 生成的 `CLAUDE.md`（26,024 字节），不同于原仓库根目录的 `CLAUDE.md`（测试前 946 字节）。文件存在性不能证明原仓库指令被 Leader 自动加载。
- 结论：在相同 Project 和 Windows Daemon 条件下，Leader Task 仍被排除在项目 `local_directory` 的 `in_place` 绑定之外。旧 MS-9 的非 Project 证据不再是此判断的唯一依据。

### TC-02：普通 Worker Workdir — 通过

沿用 §8 的 MS-12 / Run `01a13fcc-4937-7e6a-ad1a-1be89bfeda12` 证据。本次新建的 MS-14 / Run `01a13fdd-3d8b-7d66-870c-0ce2fa794229` 再次确认 `work_dir` 为 `D:\UserProgram\winning-platform-monorepo-fire`，且 `project_id` 与既有 Project 一致。Worker Run API 没有返回 `is_leader_task` 字段，因此普通 Worker 身份依据直接 @mention 目标 Agent、目标 Agent ID 与非 Squad 指派确定。

### TC-04：项目指令自动加载 — 通过原生加载证据

1. 确认本机 Daemon `active_task_count=0`，记录根目录 `CLAUDE.md` / `AGENTS.md` 的原始 SHA-256，再分别追加不同的唯一标记。MS-14 在此之前已创建但未指派；追加后直接 @mention Windows Worker，触发全新 Run `01a13fdd-3d8b-7d66-870c-0ce2fa794229`。触发评论没有包含标记文本，且要求不要打开项目指令文件。
2. Run 的 `session_id` 为 `5c5e1645-2444-4cd6-85c6-a0aee7455279`。对应 Claude Code 原生 transcript 位于本机 `.claude/projects/D--UserProgram-winning-platform-monorepo-fire/5c5e1645-2444-4cd6-85c6-a0aee7455279.jsonl`。第 10 条记录是 `attachment.type=instructions`，时间 `2026-10-15T14:00:34.493Z`，位于首次模型请求（第 18 条）和首次 Assistant 输出（第 21 条）之前。
3. 此 attachment 的 `Project` 文件条目明确指向原仓库 `CLAUDE.md` 与 `AGENTS.md`，其内容分别包含 `CLAUDE_PROBE_DF45_1015` 与 `CODEX_PROBE_DF45_1015`。Multica Run 工具日志没有主动读取这些文件的调用。因此，这不是“Agent 事后读取”或仅凭文件存在推断的证据。
4. Worker 的回复首行没有输出 Claude 标记，说明本次**行为标记判据未体现**；但原生 transcript 已独立证明项目指令在首次模型请求前进入 Runtime 上下文。仓库 `CLAUDE.md` 原本包含 `@AGENTS.md`，所以不能据此单独断言 Claude Code 对 `AGENTS.md` 有独立 fallback 机制。Codex Runtime 的自动加载行为未测。

### 可选用例与恢复

- TC-03 跳过：workspace 有本机 Windows Codex Runtime，但没有现成的只读 Codex Worker Agent；按方案不为可选测试改 Agent 配置。
- TC-05 跳过：本次未启动并发 Worker，`in_place` 目录锁行为仍需单独验证。
- MS-13、MS-14 均已设为 `cancelled`，保留 Run 和评论证据；临时 Squad 已归档。POC Lead 曾为 TC-01 临时改绑 Windows Runtime，测试结束后恢复原 Linux Runtime；既有 Project 和 Resource 未修改。
- `CLAUDE.md` / `AGENTS.md` 已恢复，SHA-256 分别为 `F34CBE858FA90A780BCB66733155D8A904E36730260CAECB70EF88B7B2CFE984`、`CBCCCDC91CCFC3CA59AA5DB6CDFF774D2C5C46A382DF65BDC785553CFD48C73C`。临时 probe 标记、Worker 回复文件和 Daemon 任务标记均不在工作树中。最终 `git status --short` 仅有本验证文档未跟踪；没有业务代码修改、提交或推送。

### 本次结论

H1、H2 成立：目标 Project 下的 Leader 使用 Multica 独立 workdir，普通 Windows Worker 使用项目根目录。H3 对 Windows Claude Code 成立：原仓库指令在首次模型请求前自动加载；是否遵循临时首行指令是另一项行为问题。H4 未验证。当前配置适合由 Lead 协调、Worker 在项目目录深度分析；若 Lead 需要仓库背景，应另行提供轻量项目上下文，而不能假设它会读取原仓库根目录指令。并发能力是否满足分析阶段需求，需待 TC-05 的单独结果。
