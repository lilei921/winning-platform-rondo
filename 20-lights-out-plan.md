# 20 黑灯计划（Lights-out Plan）

> 日期：2026-11-27
> 状态：设计方案，待实施及真实环境 PoC
> 基线：dev；遵循 [01 设计规范](01-multica-openspec-design-guideline.md)
> 范围：Delivery Squad、Wayfinder Agent、Bug Fix Agent 的 Agent 级主备 Runtime 自动协调。

## 1. 目标与边界

办公期间优先使用员工本机 Runtime；本机关机、休眠或 Multica 确认离线后，切换到已配置的服务器 Runtime；本机恢复后，在不打断正常执行的前提下切回主 Runtime。保留现有 Agent ID、Squad、Issue Assignment、交付流程与原生 Run 管理。

采用独立基础设施 Agent「黑灯守卫」+ Multica Autopilot + Rondo CLI。黑灯守卫永久绑定服务器 Runtime，不加入 Delivery Squad，不负责 Issue 诊断、业务恢复、OpenSpec、PR 或任务重试。TFS Sync Agent、PR Status Sync Agent 本次保持现状。

## 2. Agent 与 Autopilot

| 项目 | 约定 |
| --- | --- |
| Agent Name | 黑灯守卫 |
| Agent 目录 | agents/lights-out-guardian/ |
| Autopilot | 黑灯守卫 |
| Mode | run_only |
| Runtime | 固定服务器 Runtime（每 Workspace 明确配置） |
| Max Concurrent Tasks | 1 |
| Rondo CLI | rondo runtime reconcile |

Description：维护工作区内 Agent 的 Runtime 可用性，根据主备配置自动执行 Runtime 切换，保障无人值守期间的研发工作持续运行。

Instructions：负责当前 Workspace 内受管 Agent 的 Runtime 自动协调。执行 `rondo runtime reconcile` 完成 Runtime 自动协调，简洁报告切换及需要人工处理的异常。

Autopilot Prompt：执行 Runtime 自动协调。

时区 Asia/Shanghai，每日 08:00–10:00、17:00–19:00，每 10 分钟一次（含端点，共 26 次）。标准 Cron 表达式：

```cron
*/10 8-9,17-18 * * *
0 10,19 * * *
```

先核实现网 Multica 是否支持多个 Trigger 及 Cron 时区；若不支持则选择原生支持的等价调度，不增加自建 Scheduler。现有 provision 不自动启用 Trigger，按当前供给纪律完成 PoC 后由管理员启用。暂不区分工作日及节假日。窗口外不巡检，晚于 19:00 离线、白天意外离线或窗口结束前未完成 failback 等情况需等待下次巡检或人工处理。

## 3. 每个 Agent 独立主备策略

主备配置按 Workspace 独立维护。若通过现有 workspace-config/workspaces/<workspace>.json 供给，使用以下结构（也可直接将内层对象配置到黑灯守卫 custom_env，见 §3.1）。以下 ID 均为示例，不是生产配置：

```json
{
  "runtime_policy": {
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
}
```

每个 Agent 单独选择目标；允许共享 Runtime，不要求一对一。以 manifest 中的 Agent 名称解析当前 Workspace 中的真实 Agent ID，写入时使用 ID。未配置的 Agent 不管理；黑灯守卫自身无条件不参与切换。主备均须属于目标 Workspace、具备授权、建议使用相同 Provider 并一次性验收执行环境。不得用当前绑定反推 Primary，也不按机器名称猜测 ID。

配置只表达期望策略，不保存 current_runtime_id、last_switch_time、运行状态或历史计数。当前绑定及在线状态由 Multica 提供。

### 3.1 RONDO_RUNTIME_POLICY

黑灯守卫的 Agent custom_env 中配置 RONDO_RUNTIME_POLICY，值为 JSON 字符串，内容为上述 runtime_policy 对象本身（不包含外层 runtime_policy 键）。

```typescript
interface AgentRuntimePolicy {
  primary_runtime_id: string;
  fallback_runtime_id: string;
}
type RuntimePolicy = Record<string, AgentRuntimePolicy>;
```

Rondo 使用 JSON.parse 解析，Key 为 Workspace 内 Agent Name，Value 仅包含两个真实 Runtime UUID。通过现有 resolveMulticaRuntime() 从 MULTICA_WORKSPACE_ID 与 MULTICA_SERVER_URL 获取当前 Workspace 上下文，再从原生 Agent 列表解析真实 Agent ID。无需在策略中重复配置 workspace_id、agent_id、enabled 或实时状态。无配置、空对象不执行切换；非法 JSON 或无效策略不得猜测写入。配置不得管理黑灯守卫自身。

Workspace overlay 作为供给配置，按需把 runtime_policy 投影为黑灯守卫的 RONDO_RUNTIME_POLICY；供给只更新该键、保留其他 custom_env。也可由管理员直接配置黑灯守卫 env（若采用人工配置模式，不再在 overlay 重复维护相同策略；避免两个配置源同时修改）。两种方式选择其一。首版优先复用现有手工配置能力，批量供给有实际需求再扩展。黑灯守卫首次创建或人工绑定时显式选择服务器 Runtime，后续供给不得覆盖此绑定。

## 4. Rondo CLI 原生实现

不新增 Skill，也不单独分发 MJS。Rondo 已使用 TypeScript + Node.js ESM，编译后随现有 dist/ 及 Rondo 发布流程交付。黑灯守卫所在服务器需安装包含新命令的 Rondo 版本，不依赖根仓 checkout 或 Skill Bundle。

```text
agents/
  lights-out-guardian/
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

在 rondo/src/index.ts 的 runtime 命令组注册 reconcile，复用现有 Commander、resolveMulticaRuntime()、multicaPrefix() 和 clients/spawn.ts 的 runJson/runCommand，不新增进程执行框架。维护 CLI Help / COMMANDS.md 中必要的命令说明。manifest 只登记黑灯守卫和 Autopilot，黑灯守卫 skills 为空，不注册新 Skill。

```bash
rondo runtime reconcile
rondo runtime reconcile --dry-run
```

## 5. 确定性切换逻辑

Rondo CLI 负责 UTF-8、JSON、原生 Multica CLI 读取与写入、状态判断、结果确认。显式指定当前 workspace-id，不拼接 shell 字符串，不由 LLM 选择 Runtime。复用现有统一进程执行层及异常约定。

```bash
multica runtime list --workspace-id <id> --output json
multica agent list --workspace-id <id> --output json
multica agent update --workspace-id <id> <agent-id> --runtime-id <runtime-id> --output json
```

每次 Run 单次执行：读策略及原生状态 → 逐 Agent 选择目标 → 必要活跃 Run 保护 → 原生改绑 → 核实结果 → 输出简洁 JSON。支持 --dry-run。未变化不写入，部分失败不阻断无关 Agent，失败或未知结果可在后续巡检重新核实。

| Primary | Fallback | 行为 |
| --- | --- | --- |
| 可用 | 任意 | 优先 Primary；当前在线 Fallback 有活跃 Run 时延后切回 |
| 明确不可用 | 可用 | 改绑 Fallback |
| 明确不可用 | 不可用/未知 | 保持现有绑定 |
| 未知 | 任意 | 保持现有绑定 |

使用 Multica 原生健康状态，不额外维护心跳及稳定计数器；在线不等于模型、凭据及工具链就绪，配置阶段完成主备环境验收。查询失败、权限不足或事实不明确时不猜测、不盲目写入。Failover 不主动取消旧 Run，Failback 不抢占正常 Run；原生队列、重试、恢复由 Multica 管理。活跃 Run 查询失败时不执行在线 Runtime 间的切回。无额外状态机、任务重试、数据库或独立调度器。

## 6. 必须验证的平台行为

当前 Multica 上游 main 的 server/internal/handler/agent.go 与 server/pkg/db/queries/agent.sql 实现 ReassignPendingAgentTasksToRuntime，改绑事务中迁移 queued/deferred，dispatched/running/waiting_local_directory 保留原 Runtime。此前核验的 0.6.1 对应 commit 2ea01ae4e 未发现此迁移，领取要求 Agent 与 Run runtime_id 一致。因此不能以当前上游源码代替现网版本验收。若现网不支持待派发 Run 自动迁移，先升级到具备原生能力的版本或明确限制适用范围，不用数据库补写或自行 rerun 掩盖。

Runtime 切换不迁移本机未提交代码、CLI Session 或本地工作目录。跨机接续依赖已持久化工程事实及现有 native-workspace 能力。现有权限、Provider、Model/Thinking Level、Rondo CLI、TFS/Git 与构建工具需兼容；不同 Provider 可能触发平台清空不兼容模型配置，首版避免跨 Provider。

真实 PoC 验证：
- 本机在线/离线、恢复、双方离线、查询失败和重复执行。
- queued/deferred 原生迁移并可领取；dispatched/running 原生终结或恢复，不重复执行；服务器活跃 Run 不被抢占。
- 主备跨机真实执行、已持久化成果接续、原生 Runtime 绑定和权限（尤其黑灯守卫自身 Run 凭据是否允许更新其他 Agent）。
- 服务器 Rondo CLI 真实可调用、custom_env 注入、两段 Autopilot Trigger。
- 多 Agent 独立选择，固定黑灯守卫不被动态协调或现有同步脚本改绑。

## 7. 实施范围与顺序

1. P0：完成现网版本、权限、Rondo 命令执行环境与 Cron 的最小 PoC。
2. P0：新增 Agent、rondo runtime reconcile 命令及单元测试；注册 manifest；按 Workspace 配置每 Agent 主备及黑灯守卫固定服务器绑定；通过现有 Rondo 发布流程供给服务器。
3. P0：按需调整 provision 的固定绑定及配置投影，并最小调整 .claude/skills/rondo-sync/scripts/sync_workspace.py 的 bind_agent_runtime，避免批量改绑覆盖受管主备策略及黑灯守卫固定绑定。保留非本次受管对象的既有行为，不改变交付 workflow。
4. P1：隔离 Workspace 端到端验收后逐 Workspace 配置并启用 Autopilot。未配置主备策略的 Workspace 不执行切换。
5. P2：仅有实际问题时再考虑防抖、额外告警或向 Multica 上游提原生主备需求。

本计划仅保存设计；不包含生产 Agent/Autopilot 创建、配置写入、部署或代码实施。配置字段、传输方式及 CLI 入口以 PoC 核实为准。

## 8. 参考实现

- Rondo: [workspace sync](rondo/src/commands/workspace/sync.ts)、[workspace provision](rondo/src/commands/workspace/provision.ts)、[sync_workspace.py](.claude/skills/rondo-sync/scripts/sync_workspace.py)、[provisioning manifest](workspace-config/provisioning.json)
- Multica: [Agent handler](https://github.com/multica-ai/multica/blob/main/server/internal/handler/agent.go)、[Agent SQL](https://github.com/multica-ai/multica/blob/main/server/pkg/db/queries/agent.sql)
- 既有版本核验：[Run 重试与复用](validation/issue-run-retry-reuse-0.6.1-2026-10-09.md)
