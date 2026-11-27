# 20 黑灯计划（Lights-out Plan）

> 日期：2026-11-27
> 状态：设计方案，待实施及真实环境 PoC
> 基线：dev；遵循 [01 设计规范](01-multica-openspec-design-guideline.md)
> 范围：Delivery Squad、Wayfinder Agent、Bug Fix Agent 的 Agent 级主备 Runtime 自动协调。

## 1. 目标与边界

办公期间优先使用员工本机 Runtime；本机关机、休眠或 Multica 确认离线后，切换到已配置的服务器 Runtime；本机恢复后，在不打断正常执行的前提下切回主 Runtime。保留现有 Agent ID、Squad、Issue Assignment、交付流程与原生 Run 管理。

采用独立基础设施 Agent `Vayne`（黑灯计划的 Runtime 守卫）+ Multica Autopilot + Rondo CLI。Vayne 永久绑定服务器 Runtime，不加入 Delivery Squad，不负责 Issue 诊断、业务恢复、OpenSpec、PR 或任务重试。TFS Sync Agent、PR Status Sync Agent 本次保持现状。

## 2. Agent 与 Autopilot

| 项目 | 约定 |
| --- | --- |
| Agent Name | Vayne |
| Agent 目录 | agents/vayne-agent/ |
| Autopilot | Vayne |
| Mode | run_only |
| Runtime | 固定服务器 Runtime（每 Workspace 明确配置） |
| Max Concurrent Tasks | 1 |
| Rondo CLI | rondo runtime reconcile |

Description：负责 Agent 主备 Runtime 自动协调，保障无人值守期间的研发工作持续运行。

Instructions：负责当前 Workspace 的 Runtime 自动协调。执行 `rondo runtime reconcile`，简洁报告 Runtime 切换结果及需要人工处理的异常。

Autopilot Prompt：执行 Runtime 自动协调。

时区 Asia/Shanghai，每日 08:00–10:00、17:00–19:00，每 10 分钟一次（含端点，共 26 次）。标准 Cron 表达式：

```cron
*/10 8-9,17-18 * * *
0 10,19 * * *
```

当前上游 CLI 支持原生 schedule Trigger 和 IANA 时区。管理员在 PoC 通过并完成服务器绑定、主备策略配置后，使用以下命令添加两个 Trigger（显式指定目标 Workspace）：

```bash
multica autopilot trigger-add <autopilot-id> --workspace-id <id> --kind schedule --cron "*/10 8-9,17-18 * * *" --timezone Asia/Shanghai
multica autopilot trigger-add <autopilot-id> --workspace-id <id> --kind schedule --cron "0 10,19 * * *" --timezone Asia/Shanghai
```

现网支持情况须核实，不增加自建 Scheduler。现有 provision 不自动启用 Trigger，按当前供给纪律完成 PoC 后由管理员启用。暂不区分工作日及节假日。窗口外不巡检，晚于 19:00 离线、白天意外离线或窗口结束前未完成 failback 等情况需等待下次巡检或人工处理。

## 3. 每个 Agent 独立主备策略

每个 Workspace 的 Vayne 独立维护 `RONDO_RUNTIME_POLICY`，由管理员直接在 Multica Agent Environment Variables（custom_env）中配置。值为下列 JSON 对象的字符串形式；以下 ID 均为示例，不是生产配置：

```json
{
  "Delivery Lead": {
    "primary_runtime_id": "<local-a>",
    "fallback_runtime_id": "<server-a>"
  },
  "Workitem Analyst": {
    "primary_runtime_id": "<local-b>",
    "fallback_runtime_id": "<server-a>"
  },
  "Engineer": {
    "primary_runtime_id": "<local-c>",
    "fallback_runtime_id": "<server-b>"
  },
  "Wayfinder Agent": {
    "primary_runtime_id": "<local-a>",
    "fallback_runtime_id": "<server-a>"
  },
  "Bug Fix Agent": {
    "primary_runtime_id": "<local-c>",
    "fallback_runtime_id": "<server-b>"
  }
}
```

每个 Agent 单独选择目标；允许共享 Runtime，不要求一对一。以配置中的 Agent Name 匹配当前 Workspace 原生 Agent 列表中的真实 Agent ID，写入时使用 ID。未配置的 Agent 不管理；Vayne 自身无条件不参与切换。主备均须属于目标 Workspace、具备授权，首版限定相同 Provider，并在配置时一次性验收执行环境。若当前绑定的其他 Runtime 与目标 Provider 不兼容，也不自动改绑，避免平台修改模型配置。不得用当前绑定反推 Primary，也不按机器名称猜测 ID。

配置只表达期望策略，不保存 current_runtime_id、last_switch_time、运行状态或历史计数。当前绑定及在线状态由 Multica 提供。

### 3.1 RONDO_RUNTIME_POLICY

`RONDO_RUNTIME_POLICY` 是 Vayne 专属环境变量，值为上述 JSON Object 的字符串形式，无外层包装。

```typescript
interface AgentRuntimePolicy {
  primary_runtime_id: string;
  fallback_runtime_id: string;
}
type RuntimePolicy = Record<string, AgentRuntimePolicy>;
```

Rondo 使用 JSON.parse 解析，Key 为 Workspace 内 Agent Name，Value 仅包含两个真实 Runtime UUID。通过现有 resolveMulticaRuntime() 从 MULTICA_WORKSPACE_ID 与 MULTICA_SERVER_URL 获取当前 Workspace 上下文，再从原生 Agent 列表解析真实 Agent ID。无需在策略中重复配置 workspace_id、agent_id、enabled 或实时状态。无配置、空对象不执行切换，并明确报告未配置或空策略；非法 JSON 或非对象整体配置不执行任何写入。单个 Agent 配置无效、无法解析、Runtime 缺失或 Provider 不兼容时，报告该项异常并继续处理其他有效项。配置不得管理 Vayne 自身。

首版仅采用 Multica 原生 custom_env 人工配置，作为主备策略唯一来源；不在 Workspace overlay 重复维护，不增加配置投影、同步脚本或 Registry。后续确有批量配置需求时再评估 rondo-sync。首次 provision 按既有机制创建 Vayne，管理员随后人工绑定服务器 Runtime、设置 max concurrent tasks=1 和主备策略，再启用 Autopilot。既有 provision 不改写已存在 Agent 的 runtime_id，保持原样；sync_workspace.py 的 bind_agent_runtime 增加排除 Vayne 的条件。无需新增固定 Runtime 配置字段或通用供给机制。

## 4. Rondo CLI 原生实现

不新增 Skill，也不单独分发 MJS。Rondo 已使用 TypeScript + Node.js ESM，编译后随现有 dist/ 及 Rondo 发布流程交付。Vayne 所在服务器需安装包含新命令的 Rondo 版本，不依赖根仓 checkout 或 Skill Bundle。

```text
agents/
  vayne-agent/
    description.md
    instructions.md
    autopilot-prompt.md
rondo/
  src/
    commands/
      runtime/
        reconcile.ts
        reconcile.test.ts
```

在 rondo/src/index.ts 的 runtime 命令组注册 reconcile，复用现有 Commander、resolveMulticaRuntime()、multicaPrefix() 和 clients/spawn.ts 的 runJson/runCommand，不新增进程执行框架。维护 CLI Help / COMMANDS.md 中必要的命令说明。manifest 只登记 Vayne 和 Autopilot，Vayne skills 为空，不注册新 Skill。

```bash
rondo runtime reconcile
rondo runtime reconcile --dry-run
```

Help Description：根据 Agent 主备策略自动协调 Runtime 绑定。只提供 reconcile 及 --dry-run；人工改绑使用 Multica 原生能力。

## 5. 确定性切换逻辑

Rondo CLI 负责 UTF-8、JSON、原生 Multica CLI 读取与写入、状态判断、结果确认。显式指定当前 workspace-id，不拼接 shell 字符串，不由 LLM 选择 Runtime。复用现有统一进程执行层及异常约定。

```bash
multica runtime list --workspace-id <id> --output json
multica agent list --workspace-id <id> --output json
multica agent update --workspace-id <id> <agent-id> --runtime-id <runtime-id> --output json
```

每次 Run 单次执行：读策略及原生状态 → 逐 Agent 选择目标 → 原生改绑 → 核实结果 → 输出简洁 JSON。支持 --dry-run。未变化不写入，部分失败不阻断无关 Agent，失败或未知结果可在后续巡检重新核实。

| Primary | Fallback | 行为 |
| --- | --- | --- |
| 可用 | 任意 | 优先 Primary |
| 明确不可用 | 可用 | 改绑 Fallback |
| 明确不可用 | 不可用/未知 | 保持现有绑定 |
| 未知 | 任意 | 保持现有绑定 |

直接使用 Multica Runtime 原生 status：online 表示可用，offline 表示明确不可用；缺失对象、查询失败或其他状态不推断为 offline。无需使用 last_seen_at 自建心跳阈值。在线不等于模型、凭据及工具链就绪，配置阶段完成主备环境验收。

在第 6 节现网原生迁移能力验收通过的前提下，Failover 和 Failback 使用同一个原生 agent update，目标与当前绑定相同则 NO-OP。无需读取 agent tasks、分页扫描活跃 Run 或等待 Agent 空闲；已派发任务保留在原 Runtime，后续任务及待派发任务由 Multica 原生调度。Rondo 不取消、重试、迁移或管理 Run，不增加状态机、数据库、防抖或独立调度器。

仅输出必要结构化结果，示例：

```json
{
  "result": "PASS",
  "changed": [
    {
      "agent": "Engineer",
      "from": "<local-runtime-id>",
      "to": "<server-runtime-id>"
    }
  ],
  "errors": []
}
```

无变化时 changed 为空；配置异常、无可用 Runtime 或未确认写入须如实报告，复用现有 FAIL/UNKNOWN 及退出码契约，不能将未确认的改绑记为 changed。--dry-run 只报告计划，不写入、不将计划视为已执行；不新增独立报告文件或 Metadata。

## 6. 必须验证的平台行为

Multica 上游 commit 392ca3d 的 server/internal/handler/agent.go 与 server/pkg/db/queries/agent.sql 实现 ReassignPendingAgentTasksToRuntime，改绑事务中迁移 queued/deferred，dispatched/running/waiting_local_directory 保留原 Runtime。对应测试 agent_runtime_switch_tasks_test.go 覆盖待派发任务迁移、拒绝改绑时保持任务，以及跨 Runtime 重试时旧 Session 归属；这里只核实源码，未执行上游测试。此前核验的 0.6.1 对应 commit 2ea01ae4e 未发现此迁移，领取要求 Agent 与 Run runtime_id 一致。因此不能以当前上游源码代替现网版本验收。若现网不支持安全的待派发 Run 迁移和已派发 Run 非抢占式执行，则不启用自动协调，优先升级至具备原生能力的版本；不用数据库补写或自行 rerun 掩盖。

Runtime 切换不迁移本机未提交代码、CLI Session 或本地工作目录。跨机接续依赖已持久化工程事实及现有 native-workspace 能力。现有权限、Provider、Model/Thinking Level、Rondo CLI、TFS/Git 与构建工具需兼容；不同 Provider 可能触发平台清空不兼容模型配置，首版不自动跨 Provider 改绑。

权限前置：真实 Vayne Autopilot Run 使用原生注入的 MULTICA_TOKEN，在隔离 Workspace 验证 runtime list、agent list、agent update 权限。上游 canManageAgent 要求 Agent Owner 或 Workspace Owner/Admin，Private Runtime 还要求相应访问授权（含 Agent Owner 的访问）。读取成功不代表改绑有权限。优先使用原生角色与 Runtime Sharing；若仍无法授权，不启用自动协调，不提前引入 PAT 代理或替代权限体系。

真实 PoC 验证：
- 本机在线/离线、恢复、双方离线、查询失败和重复执行。
- queued/deferred 原生迁移并可领取；dispatched/running/waiting_local_directory 留在原 Runtime，正常结束或原生恢复，不重复执行；服务器活跃 Run 不被抢占，并验证跨 Runtime 的 Agent 并发及同 Issue 串行约束。
- 主备跨机真实执行、已持久化成果接续、原生 Runtime 绑定和权限（尤其 Vayne 自身 Run 凭据是否允许更新其他 Agent）。
- 服务器 Rondo CLI 真实可调用、custom_env 注入、两段 Autopilot Trigger。
- 多 Agent 独立选择，固定 Vayne 不被动态协调或现有同步脚本改绑。

## 7. 实施范围与顺序

1. P0：完成现网版本、权限、Rondo 命令执行环境与 Cron 的最小 PoC。
2. P0：新增 Agent、rondo runtime reconcile 命令及单元测试；注册 manifest；通过现有 Rondo 发布流程供给服务器。
3. P0：仅在 .claude/skills/rondo-sync/scripts/sync_workspace.py 的 bind_agent_runtime 排除 Vayne，保留其他 Agent 既有行为；管理员完成 Vayne 固定服务器绑定、并发数与 RONDO_RUNTIME_POLICY 配置。无需扩展 provision 固定绑定策略。
4. P1：隔离 Workspace 端到端验收后逐 Workspace 配置并启用两个原生 Autopilot Trigger。未配置主备策略的 Workspace 不执行切换。
5. P2：仅有实际问题时再考虑防抖、额外告警或向 Multica 上游提原生主备需求。

本计划仅保存设计；不包含生产 Agent/Autopilot 创建、配置写入、部署或代码实施。首版配置方式与 CLI 入口按本文实施；现网能力、权限及原生 Run 迁移行为须通过 PoC 核实。

## 8. 参考实现

- Rondo: [workspace sync](rondo/src/commands/workspace/sync.ts)、[workspace provision](rondo/src/commands/workspace/provision.ts)、[sync_workspace.py](.claude/skills/rondo-sync/scripts/sync_workspace.py)、[provisioning manifest](workspace-config/provisioning.json)
- Multica（392ca3d）: [Agent handler](https://github.com/multica-ai/multica/blob/392ca3d8463bc1d4c2145b842563166918158403/server/internal/handler/agent.go)、[Agent SQL](https://github.com/multica-ai/multica/blob/392ca3d8463bc1d4c2145b842563166918158403/server/pkg/db/queries/agent.sql)、[Runtime switch tests](https://github.com/multica-ai/multica/blob/392ca3d8463bc1d4c2145b842563166918158403/server/internal/handler/agent_runtime_switch_tasks_test.go)、[Autopilot CLI](https://github.com/multica-ai/multica/blob/392ca3d8463bc1d4c2145b842563166918158403/server/cmd/multica/cmd_autopilot.go)、[Runtime handler](https://github.com/multica-ai/multica/blob/392ca3d8463bc1d4c2145b842563166918158403/server/internal/handler/runtime.go)
- 既有版本核验：[Run 重试与复用](validation/issue-run-retry-reuse-0.6.1-2026-10-09.md)
