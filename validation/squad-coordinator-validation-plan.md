# Squad Coordinator — Multica 原生机制验证方案

> Version: 1.0.0  
> Date: 2026-10-14  
> Status: TEST PLAN / NOT_RUN  
> 对照方案：[Multica 多小队协同与调度设计](../archive/docs-2026-11-18/multi-squad-coordination-design.md) v0.1.1\
> 范围：单机验证协调与指派，再按条件验证多机器；**不得修改 01–07、正式 Multica Workspace、真实 TFS、业务代码和现有 Agent 配置**。

## 0. 给本地 Agent 的执行指令（可直接复制）

请阅读 `docs/multica/validation/squad-coordinator-runtime-validation-plan.md`，严格按本文进行隔离 PoC。先读取本机 Multica CLI / Daemon 版本与当前 Workspace，优先在**新建的 POC Workspace + Project** 构建虚拟 Agent、Squad、Issue，不使用真实 TFS / Git / PR。优先执行 S02 → S03 → S04 → S05，再按条件执行 S06–S09；多机器条件不具备时记 NOT_RUN。每项保存 CLI 命令、退出码、脱敏 JSON、Issue Revision、Timeline、Run ID/Agent ID、开始结束时间。不能因测试失败而用人工 rerun 或重复指派凑出 PASS；先记录失败证据，再在新的 Fixture 上重试。不要修改 01–07，不要提交、推送或合并代码。结束时仅生成独立的结果文档（§8），逐项标注 PASS / FAIL / BLOCKED / NOT_RUN，并说明实际版本下的原生行为与设计调整建议。

## 1. 核心假设与已知证据

本次要判断 Multica 原生能力是否足够支撑：

```text
Wayfinder eligible → Squad Coordinator → (ASSIGN → Delivery Squad Leader)
                                       └→ (WAIT → 待分配队列 → Autopilot Sweep)
```

**已知事实，不必原样重复做 WFP 测试**：

- 07 路线图中 Multica 0.6.1（commit `2ea01ae4e`）的 R01–R05 和 WFP-8/9/10 隔离测试取得限定范围 PASS，证明一次 Update 可以实现 `Wayfinder → Squad` 并启动 Leader，不证明 Coordinator 二次接力、多机器或队列自动恢复。
- [Multica 0.6.1 Issue handler](https://github.com/multica-ai/multica/blob/2ea01ae4e/server/internal/handler/issue.go)：**Reassignment 不自动取消旧 Run**，新旧 Run 可以短暂重叠；以本机安装版本实测为准。
- [Multica Autopilot service](https://github.com/multica-ai/multica/blob/2ea01ae4e/server/internal/service/autopilot.go)：`run_only` 在 Runtime 离线时可能形成 `skipped` Run。
- Squad 自身没有原生 `capacity=1`、自动负载均衡或 Slot Claim。`max-concurrent-tasks=1` 也不能替代业务占用事实。

## 2. 安全边界与准备

1. 创建**独立** Workspace，例如 `Squad Coordinator PoC 20261014`，独立 Project，例如 `Squad Dispatch PoC`；不要写入现有正式 `winning-df` 或 `winning-dps-df`。创建前先确认权限与当前 Workspace，不允许误将生产 Workspace 当测试区。
2. 创建 1 个 `POC Squad Coordinator Agent`、2 个 `POC Delivery Squad A/B`，各自 Leader 为 `POC Lead A/B`；如果需要完整 Wayfinder 链路，再加 `POC Wayfinder`。所有 Agent 只允许对 POC Issue 读写和回报 Run ID，不绑定真实 Analyst/Engineer/TFS/PR/业务代码 Skill。
3. Coordinator/Lead 在同机测试时使用**不同可写临时目录或不竞争的任务工作目录**。同一 `local_directory + in_place` 锁引起的等待，不能误判为调度算法串行。
4. 记录本机版本、Workspace/Project/Agent/Squad/Runtime UUID、所有测试 Issue、Autopilot/Trigger UUID。绝不记录 token、cookie 或敏感配置。
5. 建议固定三个 Mock Agent 行为：Coordinator 的 `HANDOFF` 模式只做一次 Update 然后停止写入；`WAIT` 模式不改派且不强行改 Status；`SCAN` 模式通过 `run_only` 扫描 POC 待分配 Issue。Lead 只记录 `Issue ID / Run ID / Agent ID / Trigger / 时间`，不做额外业务委派。需要 Comment 时优先使用隔离验证过的 `/note`，并确认不会唤醒额外 Agent。

### 2.1 CLI 基线核对（PowerShell）

```powershell
multica --version
multica daemon status
multica workspace list --output json
multica project list --output json
multica runtime list --output json
multica agent create --help
multica squad create --help
multica issue create --help
multica issue update --help
multica issue runs --help
multica autopilot create --help
multica autopilot trigger-add --help
```

如果 CLI 缺少参数，先用实际 `--help` 查找等价命令并在报告注明，禁止猜测参数；无法创建隔离 Workspace、Daemon Offline、必要权限不足则记 BLOCKED，不能回退到正式 Workspace 测试。

### 2.2 Fixture Registry（测试报告必须填写）

```yaml
workspace_id: <POC_WORKSPACE_UUID>
project_id: <POC_PROJECT_UUID>
coordinator_agent_id: <POC_COORDINATOR_UUID>
wayfinder_agent_id: <OPTIONAL_POC_WAYFINDER_UUID>
squad_a: {id: <POC_SQUAD_A_UUID>, leader: <LEAD_A_UUID>, capacity: 1}
squad_b: {id: <POC_SQUAD_B_UUID>, leader: <LEAD_B_UUID>, capacity: 1}
runtime_ids: [<UUID_1>, <UUID_2>]
autopilot_id: <OPTIONAL_POC_AUTOPILOT_UUID>
issues: {} # Case ID -> real Issue ID
```

## 3. 统一只读取证指令

```powershell
multica squad list --output json
multica squad get <SQUAD_UUID> --output json
multica squad member list <SQUAD_UUID> --output json
multica runtime list --output json
multica issue list --project <PROJECT_UUID> --assignee-id <SQUAD_UUID> --limit 100 --offset 0 --output json
multica issue list --project <PROJECT_UUID> --assignee-id <COORDINATOR_UUID> --limit 100 --offset 0 --output json
multica issue get <ISSUE_ID> --output json
multica issue runs <ISSUE_ID> --active --output json
multica issue runs <ISSUE_ID> --output json
multica issue comment list <ISSUE_ID> --roots-only --summary --compact --output json
multica issue timeline <ISSUE_ID> --output json
```

**特别注意**：`issue list` 必须依据 `has_more` 完整分页；返回截断、服务端错误或结果未知都不得当作 0 占用。`issue runs --active --siblings` 只用于观察指定 Issue 家族、并非全局锁，不可作为原子容量预订。

## 4. 单机 P0 验证（必做）

### S02 — Coordinator → Squad 二次接力与旧新 Run 重叠

**准备**：POC Issue 初始为 `backlog + Coordinator`，描述明确 `Case=S02, Mode=HANDOFF, TargetSquad=A`。回读初始 Owner、Status、Revision、Run 列表，应无历史 Run。

**操作**：一次 `multica issue status <ISSUE_ID> todo` 激活 Coordinator（不带 `--no-start`）；在 Coordinator Run **内部**先读回当前状态，再一次执行：

```powershell
multica issue update <ISSUE_ID> --status todo --assignee-id <SQUAD_A_UUID> --output json
```

不调用第二个 `status/assign/rerun`。随后核查 Issue Revision/Owner、Timeline、全部 Run，记录 Coordinator 与 Lead A Run 的重叠时间和写操作顺序。**PASS**：一次更新后 Owner 为 Squad A，自动生成且执行恰好一条目标 Lead Run；Coordinator 退出，改派之后不再写交付状态，不发生额外重复启动。**FAIL**：无自动启动、重复 Leader Run、旧 Run 越权回写或缺乏真实证据。可选再从 `POC Wayfinder → Coordinator → Squad` 做全链路，但不能把模拟 eligible 当成正式 Wayfinder 准入 PASS。

### S03 — 无容量时 WAIT 队列是否稳定

**准备**：用真实 POC Issue 归属预置 Squad A/B 均已占用；另建 `backlog + Coordinator` Issue，描述 `Case=S03, Mode=WAIT`。**操作**：一次 `backlog → todo` 启动 Coordinator；Coordinator 回读各队非终态顶层 Delivery Issue，因无容量返回 WAIT，不改派，不强制写 `blocked/unsupported`。Run 完成后再查 Owner/Status/Revision/Run/Timeline，重复只读扫描。

**PASS**：最后为 `todo + Coordinator`、能分页查到、无目标 Lead Run、无额外循环 Run。**若变为 `in_progress`**：S03 判 FAIL 并单列 S03-B 试验 `backlog + Coordinator` + Sweep 的替代排队模型；S03-B 通过也**不能**将 S03 记 PASS。禁止为使测试通过而在 Agent 退出前偷偷重置状态。

### S04 — `run_only` Autopilot 扫描已有 Issue 与自动恢复

**准备**：选一个 Coordinator-owned 待分配 POC Issue，至少一队具备空闲容量。新建**POC 专用** Autopilot：

```powershell
multica autopilot create --title "POC Squad Coordinator Sweep" --agent <COORDINATOR_UUID> --mode run_only --project <PROJECT_UUID> --description "仅扫描 POC Project 的待分配 Issue，幂等调度，不能创建新 Issue" --output json
multica autopilot trigger-add <AUTOPILOT_UUID> --kind schedule --cron "*/5 * * * *" --timezone "Asia/Taipei" --output json
```

**操作**：观察至少一次自然 Cron 到期，而不只手动 Trigger；记录 Autopilot Run 与 Coordinator Run，确认 Coordinator 从**无 Issue 上下文**的 `run_only` 扫描找到**已有**待分配 Issue，单次 Update 指派空闲 Squad；验证下一次 Sweep 不重复派工，也不创建额外 Delivery Issue。**PASS**：定时触发执行、扫描授权足够、改派成功、唯一目标 Leader Run、复扫 NO-OP。若 Autopilot Runtime 离线而 `skipped`，记录 BLOCKED / 实际行为，不能视为完成；不要擅自关闭共享正式 Daemon 注入故障。

### S05 — 单 Coordinator + `capacity=1` 并发分配

**准备**：Squad A `capacity=1`，Squad B 通过配置标记为不匹配；另准备两个 Coordinator-owned POC Issue 和真实可回读的当前占用状态。测试一轮 A 空闲、一轮 A 已占用。

**操作**：紧邻触发两个 Issue 的 Coordinator Run，并在另一个回合令新 Issue 的触发与 S04 Sweep 接近同时发生；将 POC Coordinator 的 `max-concurrent-tasks` 设为 1 并回读。检查两条 Run 是否排队，脚本的占用读取是否包含**顶层**非终态 Squad-owned Issue（`todo/in_progress/analysis_review/blocked/in_review`），不得把开发 Sub-Issue 重复计数。安全释放时必须确认 POC 占用 Issue 已终态、无活跃 Run、工作区可释放，方可开始新的一轮。

**PASS**：A 在任一时刻只有 1 个仍占用的顶层 Delivery Issue，第二个 WAIT；释放 Slot 后下一次扫描仅激活一个等待 Issue。**限制**：即使 PASS，也仅证明**单自动分配入口与该测试负载**，不能认定 Multica 自带全局原子 Slot Claim；若人工或另一个调度器可绕过分配，仍可能超额分配。

## 5. 扩展 Case（P1，按前置条件执行）

| Case | 目标 | 具体操作要点 | PASS 条件 |
| --- | --- | --- | --- |
| S06 | 指派结果 UNKNOWN、超时与重复触发 | 在**隔离**环境安全注入 CLI 请求超时 / 不明确响应；先读回 Owner、Status、Run，再判断是否需要补偿；重复 Trigger 后重查 | 无盲目重派、无第二个相同 Lead Run；确实无法确认时保留 UNKNOWN |
| S07 | Run / Runtime / Issue 占用信息可信度 | A 在线、B 离线；混合顶层与 Child Issue、`analysis_review`/`blocked`/`in_review`；检查分页、多 Agent Runtime 绑定 | 离线不会被当作空闲；Child 不重复计数；分页中断返回 UNKNOWN；未绑定的必要 Agent 不被视作 Ready |
| S08 | `@Squad` 临时协作（可选） | POC Issue 的负责人保持 Squad A，真实 Mention Squad B，核对 B Leader Run | B Leader 可被唤醒但不改变 Issue Owner；不混淆咨询与任务移交 |
| S01 | **两机器** / 同一 Project / 两套 Runtime | 第二台机器可用时分别运行 Daemon 并绑定各自的测试目录，A/B Agent Run 输出主机与实际工作目录，使用测试标记文件验证隔离 | 两台电脑同时执行，工作区和 Git 状态不交叉；不能通过同一网络共享盘伪造隔离 |
| S09 | 跨机器 Git / OpenSpec 集成（可选） | 仅在独立测试仓使用两机两个 Branch 分别修改互不冲突与冲突文件，测试 PR Integration；不触碰真实业务仓 | 各自本地互不污染；同文件合并冲突可以被识别，未提交 OpenSpec 不会凭空跨机同步 |

**S01/S09 需要第二台机器；条件未具备时记录 NOT_RUN，不阻断 S02–S05 单机核心结论。** S07 的“Runtime 离线”测试不能随意停止同时服务正式 Agent 的共享 Daemon；无法安全注入时只作只读验证，并把未测子项标为 NOT_RUN。

## 6. 判据与证据留存

每个 Case 至少记录：

1. Multica CLI / Daemon / Server 版本与实际测试 Workspace/Project ID。
2. 当前 Fixture Agent、Squad、Runtime、Issue ID；每次输入的 Triage Decision（明确区分**虚拟**和真实）。
3. **操作前后**的 Issue `status / assignee_type / assignee_id / revision`、完整 Timeline。
4. 每一条关键 CLI 的实际参数、时间、退出码、脱敏输出；不得单凭 Agent 自述代替证据。
5. Coordinator、目标 Lead 等所有相关 Run 的 ID、Trigger、状态、开始和结束时间；核实是否重复、重叠及各自写操作。
6. Autopilot 配置、真实调度到期时间、Run ID、是否 `skipped`，以及是否意外创建新的 Issue。
7. 测试结果 `PASS | FAIL | BLOCKED | NOT_RUN`，偏差原因和可能的最小设计修正建议。

**判定规则**：

- `CORE_MECHANISMS_PASS`：S02、S03、S04、S05 **全部 PASS**。
- `DESIGN_CHANGE_REQUIRED`：例如 S03 FAIL、S03-B 备用队列方案可行；须明确更改候选设计后重新验证，不能伪称 S03 PASS。
- `MULTI_MACHINE_PASS`：S01 PASS 且明确运行在不同物理机器；Git/OpenSpec 完整集成另需 S09 PASS。
- 任一要求的证据不完整，不应赋予 PASS；条件不足用 `BLOCKED` 或 `NOT_RUN`，明确区别。

## 7. 本次验证后的工作边界

- 仅允许创建隔离 POC 测试资产与结果报告；**不实施**正式 Coordinator Agent/Skill/Autopilot，更不接通真实 Wayfinder/TFS 自动入口。
- 使用真实 Agent Run 执行单次 `issue update`，不要用操作员手动改派来替代“Coordinator 在 Run 内改派”的验收。
- 不为掩盖 FAIL 而向已经失败的同一 Issue 多次 `rerun` / 重置状态；保留失败 Fixture，需重新验证时创建新的测试 Case。
- 禁止使用 `git reset --hard`、`git clean -fdx`、`multica repo checkout --fresh` 清理存在未知改动的目录。
- PoC 结束立即**暂停/禁用本次创建的定时 Autopilot**，回读确认不再触发；保留已产生的历史 Issue/Run/Comment 证据。
- 若需要删除 POC Workspace / Squad / Agent 等，先征得用户明确授权；不可删除此前已有的隔离 Workspace 或任何正式对象。
- 本地 Agent 可以新增验收报告和脱敏测试附件，**不得修改 01–07 或候选设计正文**。未经要求不要 Commit、Push、Merge。

## 8. 验收报告模板

在 `docs/multica/validation/` 新增 `squad-coordinator-poc-result-YYYY-MM-DD.md`，使用以下结构：

```markdown
# Squad Coordinator Multica PoC Result

## 环境
- 日期 / CLI / Daemon / Server 版本：
- Workspace / Project / Fixture UUID：
- 是否完全隔离、是否访问真实 TFS/仓库：

## 判定矩阵
| Case | 结果 | 关键证据（Issue / Run / Timeline / Logs） | 结论 |
| --- | --- | --- | --- |
| S02 | NOT_RUN | | |
| S03 | NOT_RUN | | |
| S04 | NOT_RUN | | |
| S05 | NOT_RUN | | |
| S06–S09 | NOT_RUN | | |

## S02–S05 详细过程与时间线
（命令、脱敏 JSON、Revision、Run 重叠、错误和回读）

## 源码 / 官方文档 / 实测差异
（只列真实发现，不基于推测）

## 风险及最小修正建议
（不直接修改正式配置或 01–07）

## 退出判定
CORE_MECHANISMS_PASS / DESIGN_CHANGE_REQUIRED / BLOCKED

## POC 资源与清理
（Autopilot 是否已暂停，仍保留哪些 Fixture）
```

## 9. 参考资料

- [独立设计方案](../archive/docs-2026-11-18/multi-squad-coordination-design.md)
- [07 实施路线图](../07-multica-openspec-implementation-roadmap.md)
- [WFP-8：needs_human 单次 Update](./wayfinder-needs-human-resume-single-update-e2e-2026-10-13.md)
- [WFP-9：首次 todo→Squad](./wayfinder-first-todo-to-squad-2026-10-13.md)
- [WFP-10：真实 Mention + /note](./wayfinder-todo-ui-mention-to-squad-2026-10-13.md)
- [Multica Issue Reference](https://github.com/multica-ai/multica/blob/2ea01ae4e/server/internal/service/builtin_skills/multica-platform/references/issues.md)
- [Multica Squad Reference](https://github.com/multica-ai/multica/blob/2ea01ae4e/server/internal/service/builtin_skills/multica-platform/references/squads.md)
- [Multica Runtime Reference](https://github.com/multica-ai/multica/blob/2ea01ae4e/server/internal/service/builtin_skills/multica-platform/references/runtimes.md)

**状态声明：本文件是待执行的验证计划；所有 Case 初始状态均为 NOT_RUN。**
