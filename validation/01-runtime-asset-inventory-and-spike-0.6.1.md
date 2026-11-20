# Step 01 — 现有资产盘点与 Multica Runtime Spike 操作规程

> Version：1.0  
> Date：2026-10-12  
> Environment：Multica 0.6.1 / OpenSpec 1.13.2 / Windows PowerShell  
> Status：操作规程；2026-10-12 隔离 Runtime Spike 续验后，**Step 01 Exit Gate 已通过，正式 Workspace 尚未达到部署就绪**。结果与证据见[执行记录](./01-runtime-asset-inventory-and-spike-result-2026-10-12.md)。下方表格保留操作模板口径，不代表本轮结论。

## 1. 目标与范围

本步骤仅回答两个问题：

1. **Asset Inventory（资产盘点）**：设计所需的 Workspace / Squad / Agent / Skill / Autopilot / Project / Schema / Script，哪些已存在、哪些未实现、哪些已验证？
2. **Runtime Spike（运行时小实验）**：Multica 0.6.1 能否真正完成 Leader 启动、真实 @mention、Human Review 回流、跨 Agent/Run 工程文件读取，以及安全的串行和恢复？

不在这一步新建 Workflow Runner、专业 Skill、Gate、业务 Schema、PR/Finalize，**不得对真实 TFS / 正式 Delivery Issue / 生产代码做实验**。优先复用已有验证，不重复做源码层全面分析。

**已有基线：**

- [01–06 最新方案实施就绪分析（2026-10-11）](./01-06-implementation-readiness-2026-10-11.md)
- [Multica 0.6.1 Issue / Run 重试与复用核验（2026-10-09）](./issue-run-retry-reuse-0.6.1-2026-10-09.md)
- [01 统一规范](../01-multica-openspec-design-guideline-v1.16.3.md)
- [02 Delivery 方案](../02-multica-delivery-lifecycle-design-v1.6.6.md)
- [03 Analysis 方案](../03-workitem-analysis-design-v1.19.1.md)
- [05 OpenSpec Schema 方案](../05-openspec-schema-implementation-design.md)

2026-10-11 的本地核验已得到 Multica 0.6.1（commit 2ea01ae4e）与 OpenSpec 1.13.2；当时目标 Schema 和多项确定性脚本尚未在仓库发现。2026-10-09 的锁定版本源码/测试证明了部分去重、重试与 Session/Workdir 规则，**但不能替代真实 Issue 的派发、回流、故障测试**。不要直接把历史结论写为本轮 PASS。

## 2. 准备工作

- 使用隔离的 Spike Project、临时 Spike Squad，Leader = Spike Lead，Member = Spike Analyst。
- 两名测试 Agent 只允许进行受控读写测试，不得访问真实 TFS、修改生产代码、创建正式 PR 或关闭正式 Delivery。
- 为文件持久化实验准备独立、可销毁的测试工作目录；不要在根仓已有文件上覆盖写入。
- 记录测试所用 profile、Workspace ID、Project ID、Issue ID、Agent ID、Run ID、实际 cwd；保护 token 和凭据，不将完整 CLI 配置或 Session 密钥提交到文档。
- 所有修改 Issue 的操作只针对已核实 ID 的测试 Issue。发生 API 超时应先回读再决定是否重试。
- 以本机 **0.6.1 CLI --help** 和实际返回为操作依据；在线文档可能更新。

## 3. 操作 A：环境和资产盘点（只读）

### A1. 检查版本、profile 与 Daemon

在 winning-platform-monorepo 根目录执行：

~~~powershell
git rev-parse --show-toplevel
git status --short

multica version
openspec --version

# 2026-10-09 记录使用 Desktop 独立 profile；如本机不同请替换
$ProfileName = "desktop-api.multica.ai"
multica --profile $ProfileName config show
multica --profile $ProfileName auth status
multica --profile $ProfileName daemon status
multica --profile $ProfileName workspace list
multica --profile $ProfileName runtime list
~~~

仅记录版本、Server 地址（可脱敏）、profile 名、Workspace 和 Daemon/Runtime 在线情况；**不要粘贴含 token 的 config show 原始输出**。

如果默认 multica daemon status 返回 stopped，先核对 Desktop 独立 profile，不能推断 Desktop 实际 Daemon 未运行。无需在这个阶段执行 setup、restart、update。

| 检查项 | 目标 | 实际 | 证据 | 测试结果 |
|---|---|---|---|---|
| Multica CLI | 0.6.1；核对 commit | 待填 | 命令输出 | NOT_RUN |
| OpenSpec | 1.13.2 | 待填 | 命令输出 | NOT_RUN |
| Server / Profile / Workspace | 连接目标测试 Workspace | 待填 | 已脱敏输出 | NOT_RUN |
| Daemon / Runtime | 真实在线且 Agent 可用 | 待填 | status、runtime list | NOT_RUN |
| Git 根仓 | cwd 正确，原有修改已识别 | 待填 | rev-parse、status | NOT_RUN |

### A2. 盘点 Multica 资产

~~~powershell
multica --profile $ProfileName project list
multica --profile $ProfileName agent list
multica --profile $ProfileName squad list
multica --profile $ProfileName skill list
multica --profile $ProfileName autopilot list
~~~

核查以下实际配置、ID、绑定、版本与可用性：

| 资产 | 应满足的契约 | 实际 / ID / 证据 | 资产状态 |
|---|---|---|---|
| Delivery Squad | Leader = Delivery Lead | 待填 | 未核验 |
| Delivery Lead | Squad Leader，协调与审核回流 | 待填 | 未核验 |
| Workitem Analyst | 专业分析 Agent | 待填 | 未核验 |
| Backend / Frontend / Flink Engineer | 专业研发 Agent | 待填 | 未核验 |
| Verify Agent | Human 批准后按需参与 | 待填 | 未核验 |
| TFS Sync Agent / Autopilot | Squad 外；新 Issue 保持 backlog | 待填 | 未核验 |
| PR Status Sync Agent / Autopilot | Squad 外；按外部 PR 状态对账 | 待填 | 未核验 |
| analysis_review | 自定义 Status Key；Category = started | 待填 | 未核验 |
| Analysis / Development / Gate Skills | 文件、登记、Agent 绑定、Run 可读分开核验 | 待填 | 未核验 |

资产状态记录为 EXISTS / PARTIAL / MISSING / VERIFIED / BLOCKED。**存在本地 Skill 文件、登记到 Multica、已绑定 Agent 且实际 Run 可读取**是三个不同层次。远端 CLI 不可连接时应标记 BLOCKED，不得推断远端一定没有部署。

### A3. 盘点仓库文件和项目 Schema

~~~powershell
Get-ChildItem .\openspec -ErrorAction SilentlyContinue
Get-ChildItem .\openspec\schemas -ErrorAction SilentlyContinue
Get-ChildItem .\.agents\skills -ErrorAction SilentlyContinue

openspec schema which corrective-change
openspec schema which intentional-change

$TargetNames = @(
  "resolve-openspec-change.py",
  "update-task-progress.py",
  "materialize-development.py",
  "check-development-completion.py",
  "materialize-pr.py",
  "reconcile-pr-status.py",
  "finalize-delivery.py"
)
Get-ChildItem . -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $TargetNames -contains $_.Name } |
  Select-Object FullName
~~~

当目标 Schema 尚未创建，schema which 失败应记录 MISSING，不应为了“盘点通过”创建占位文件。对已存在的 TFS Sync 资产核对具体代码、配置和测试，不重写已验证的同步逻辑。

| 工程资产 | 实际路径 / 缺失说明 | 状态 | 对应推进步骤 |
|---|---|---|---|
| corrective-change / intentional-change | 待填 | 未核验 | Step 02 |
| Change Resolver | 待填 | 未核验 | Step 02 |
| Task Progress Writer | 待填 | 未核验 | Step 02 |
| Analysis Skills / Gate | 待填 | 未核验 | Step 04–05 |
| Development Projection / Skills | 待填 | 未核验 | Step 06–07 |
| PR Sync / Finalize | 待填 | 未核验 | Step 08 |
| TFS Sync | 待填 | 未核验 | 复用 / 必要修复 |

## 4. 操作 B：Multica 0.6.1 Runtime Spike

**说明：以下 R01–R05 是待执行操作，未预先标记 PASS。**

先使用测试 Project 创建测试 Issue，或通过本机 CLI --help 确认支持的命令：

~~~powershell
multica --profile $ProfileName issue create --help
multica --profile $ProfileName issue assign --help
multica --profile $ProfileName issue status --help
multica --profile $ProfileName issue comment add --help
multica --profile $ProfileName issue runs --help
~~~

### R01：backlog → todo 是否只启动 Squad Leader（P0）

1. 创建测试 Issue：status = backlog，Assignee = Spike Squad；如使用 CLI 指派，需确认 --no-start 语义。
2. 回读 Issue 和 runs，确认在 backlog 时未启动。
3. 由人工将测试 Issue 改为 todo。
4. 记录新 Run ID、Agent ID、Issue status / assignee 和时间线。

~~~powershell
multica --profile $ProfileName issue get <ISSUE_ID> --output json
multica --profile $ProfileName issue runs <ISSUE_ID> --output json
# 核对本机 help 后，仅对隔离测试 Issue 执行：
multica --profile $ProfileName issue status <ISSUE_ID> todo
~~~

**PASS：** Spike Lead 收到预期首个 Run，Spike Analyst 未抢跑，Issue 仍归 Spike Squad。仅状态变化不算 PASS。

### R02：真实 @mention 是否启动 Specialist（P0）

1. Spike Lead 从本次 Squad Roster 读取 Spike Analyst 的真实 UUID。
2. 在同一测试 Issue 发布真正的 Mention：格式示例为 [@Spike Analyst](mention://agent/<UUID>)；纯文本 @Spike Analyst 不触发。
3. 推荐在 UI 中选择目标并核对 Trigger Preview；如果用 CLI 发布 Markdown，必须事后从运行数据验证 Mention 真正被解析。
4. 回读 Run 和 Assignee。

**PASS：** Spike Analyst 新 Run 被触发，Issue 不被改派，Leader 不因自己的派活评论反复唤醒。

### R03：analysis_review 与 Human 顶层评论回流（P0）

1. 在**测试 Workspace** 确认 analysis_review Key 存在、Category 为 started；缺失时由测试环境 Owner 先配置。
2. Spike Analyst 发布测试分析完成的结果，将 Issue 状态写入 analysis_review 并回读。若使用 --no-start，先核对 CLI help。
3. 确认 Issue 未自动变为 in_review，未未经授权启动 Engineer。
4. Human 发布**无 @mention 的顶层评论**（不是对某 Agent 的线程回复），如：“批准本次测试分析，仅验证评论回流，不启动研发。”
5. 检查是否唤醒 Spike Lead 新 Run，并确认 Lead 能读取、理解意见。
6. 使用同一隔离环境补测：驳回、要求澄清、普通提问；核实普通评论不会被当成批准。

**PASS：** Analyst 正确提交并停在 analysis_review；Human 顶层评论回到 Lead；真正的授权与普通评论可区分；没有 Human Approval 时不启动研发。注意显示状态、评论内容与审批事实不可混同。

### R04：跨 Agent / Run 是否能读取持久文件（P0）

1. 给测试 Project 准备独立的持久目录，记录具体目录与运行模式。
2. Spike Analyst Run 写入 spike.txt（内容包含固定 marker、Run ID），回报绝对路径、hash 和 cwd。
3. Analyst 结束后，由 Spike Lead **新 Run** 按路径读取并回报同一文件的 hash。
4. 再触发新的 Analyst Run，比较 Session ID、Runtime / cwd 与读取结果。
5. 如果测试切换 Runtime，独立记录；不能默认跨不同物理机自动同步文件。

**PASS：** 后续 Run 不依赖旧模型 Session 记忆，可以通过稳定路径读到内容一致的文件。文件不可读时应 STOP / FAIL / UNKNOWN，而不是凭 Agent 声称“记得”算通过。

### R05：串行、重复回流与无重复副作用（P0）

1. 在同一线程连续发两条无副作用测试评论，查看 pending 与实际 Run 是否合并。
2. 测试 Agent 正运行时追加评论，观察是否进入后续 Run，而不是同 Issue + Agent 并发执行。
3. 检查不同线程、不同 Agent 的行为，避免错误地把平台串行解释为整个 Issue 的全局锁。
4. 针对同一审核消息重复到达，要求 Lead 先回读已处理结果再决定 NO-OP。
5. 模拟返回未知/超时只在无真实外部业务操作的测试任务中执行；先对账结果再重试。

**PASS：** 能证明本版本同 Issue + Agent 的合理串行和评论路由；重复业务动作被明确抑制。**平台 Run 去重不等于业务 exactly-once**。

### R06：Sub-Issue / Stage（P1，按需后移）

在 Development Runtime Projection 前，使用单独 Parent、两个 Child 和两个 Stage 验证 Stage 顺序、Parent 通知、done / cancelled 的不同业务含义。**不作为首个 Parent-only Pilot 的阻塞项**。

## 5. 证据记录、判定与退出条件

每个 Spike 至少记录：Server commit、CLI 版本、profile、Workspace、测试 Issue / Run / Agent / Comment IDs、触发入口、开始结束时间、实际 cwd、文件 hash（若涉及）、预期与实际的差异。不要提交敏感 token 或个人会话内容。

| ID | 核心验收 | 级别 | Issue / Run / Evidence | 结果 | 阻塞 |
|---|---|---|---|---|---|
| R01 | backlog → todo → Leader | P0 | 待填 | NOT_RUN | |
| R02 | 真实 Mention → Specialist | P0 | 待填 | NOT_RUN | |
| R03 | analysis_review → Human Comment → Lead | P0 | 待填 | NOT_RUN | |
| R04 | 跨 Agent / Run 持久文件 | P0 | 待填 | NOT_RUN | |
| R05 | 串行 / 重复回流 / 幂等 | P0 | 待填 | NOT_RUN | |
| R06 | Sub-Issue / Stage | P1 | 待填 | NOT_RUN | |

测试结果统一用 NOT_RUN / PASS / FAIL / UNKNOWN；资产状态统一用 EXISTS / PARTIAL / MISSING / VERIFIED / BLOCKED，不混用两套状态。

### Step 01 Exit Gate

- 现有资产清点完成，缺失项的 Owner / 后续 Step 明确；
- Multica CLI、Server、Daemon、Runtime 和 OpenSpec 版本 / 来源确实经过当前环境验证；
- **R01–R05 全部有真实执行证据且 PASS**（否则记录阻塞，不预先判定完成）；
- Human Review 不会在没有批准事实时启动 Development；
- 新 Agent Run 通过明确路径读取共享工程事实，不依赖前次 Session Memory；
- 对重复唤醒和未知副作用执行先回读、后补做的原则得到验证。

通过后进入 **Step 02：OpenSpec Foundation**（两套 Schema、Resolver、Task Progress Writer）。R06 可推迟到需要 Sub-Issue / Stage 的集成阶段。

## 6. 外部参考（运行版本实查优先）

- [Multica CLI](https://multica.ai/docs/cli)
- [Squad / Roster / Leader](https://multica.ai/docs/squads)
- [Agent Mention / Comment Routing](https://multica.ai/docs/mentioning-agents)
- [Issues / Status / Parent / Stage](https://multica.ai/docs/issues)
- [本仓 Multica 0.6.1 版本锁定证据](./issue-run-retry-reuse-0.6.1-2026-10-09.md)
