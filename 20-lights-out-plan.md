# 20 黑灯计划（Lights-out Plan）

> 日期：2026-11-27
> 状态：设计方案，待实施及真实环境 PoC
> 基线：dev；遵循 [01 设计规范](01-multica-openspec-design-guideline.md)
> 范围：Delivery Squad、Wayfinder Agent、Bug Fix Agent 的 Agent 级主备 Runtime 自动协调。

## 1. 目标与边界

办公期间优先使用员工本机 Runtime；本机关机、休眠或 Multica 确认离线后，切换到已配置的服务器 Runtime；本机恢复后，在不打断正常执行的前提下切回主 Runtime。保留现有 Agent ID、Squad、Issue Assignment、交付流程与原生 Run 管理。

采用独立基础设施 Agent「黑灯守卫」+ Multica Autopilot + 确定性 MJS。黑灯守卫永久绑定服务器 Runtime，不加入 Delivery Squad，不负责 Issue 诊断、业务恢复、OpenSpec、PR 或任务重试。TFS Sync Agent、PR Status Sync Agent 本次保持现状。

## 2. Agent 与 Autopilot

| 项目 | 约定 |
| --- | --- |
| Agent Name | 黑灯守卫 |
| Agent 目录 | agents/lights-out-guardian/ |
| Autopilot | 黑灯守卫 |
| Mode | run_only |
| Runtime | 固定服务器 Runtime（每 Workspace 明确配置） |
| Max Concurrent Tasks | 1 |
| Skill | runtime-reconcile |

Description：维护工作区内 Agent 的 Runtime 可用性，根据主备配置自动执行 Runtime 切换，保障无人值守期间的研发工作持续运行。

Instructions：负责当前 Workspace 内受管 Agent 的 Runtime 自动协调。使用 runtime-reconcile Skill 执行协调，根据脚本结果简洁报告切换及需要人工处理的异常。

Autopilot Prompt：执行 Runtime 自动协调。

时区 Asia/Shanghai，每日 08:00–10:00、17:00–19:00，每 10 分钟一次（含端点，共 26 次）。标准 Cron 表达式：

```cron
*/10 8-9,17-18 * * *
0 10,19 * * *
```

先核实现网 Multica 是否支持多个 Trigger 及 Cron 时区；若不支持则选择原生支持的等价调度，不增加自建 Scheduler。现有 provision 不自动启用 Trigger，按当前供给纪律完成 PoC 后由管理员启用。暂不区分工作日及节假日。窗口外不巡检，晚于 19:00 离线、白天意外离线或窗口结束前未完成 failback 等情况需等待下次巡检或人工处理。

## 3. 每个 Agent 独立主备策略

复用 workspace-config/workspaces/<workspace>.json。以下 ID 均为示例，不是生产配置：

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

### 3.1 配置如何进入 Runtime

Workspace overlay 是主备策略的管理来源，但 Autopilot 的 workdir 不保证存在 Rondo 根仓。建议利用现有 Agent custom_env 机制，将当前 Workspace 的 runtime_policy JSON 投影为黑灯守卫专属 RONDO_RUNTIME_POLICY。脚本从环境变量读取，并限定在当前 Workspace；不把各 Workspace 的策略写入共享 Skill 文件。供给时仅更新该键，保留其他 env；修改主备策略后需要同步该投影。固定服务器 Runtime ID 可在黑灯守卫首次供给时显式指定或由管理员绑定，供给不得把它改到本机。

此为拟定的配置传输方式，待 PoC 核实 custom_env 注入及 CLI 写权限；不再创建额外配置文件或运行时事实库。

## 4. Skill 与脚本的原生供给

```text
agents/
  lights-out-guardian/
    description.md
    instructions.md
    autopilot-prompt.md
skills/
  runtime-reconcile/
    SKILL.md
    scripts/
      runtime-reconcile.mjs
```

测试放在非生产 Skill 包的测试目录，避免现有全量文件同步上传测试。SKILL.md 只说明调用包内 scripts/runtime-reconcile.mjs 并消费结构化结果，不复述切换规则，不让 LLM 决策。

当前 rondo workspace sync 只遍历 skills/<skill>/，SKILL.md 经 skill update 上传，其余文件经 skill files upsert --path ... --content-stdin 上传，并做文件 Hash 回读；Agent 目录的 scripts 不在现有上传范围。故 runtime-reconcile 必须作为极简 Skill 资产包供给（除非改用外置服务器安装或新增发布入口，本方案不采用）。

在 workspace-config/provisioning.json 注册 managed_skills、黑灯守卫及其唯一绑定 Skill、Autopilot；复用 rondo workspace provision 与 rondo workspace sync。Runtime 实际加载路径由 Multica 原生 Skill 机制决定，使用包内相对路径定位脚本，不假定 cwd 是仓库，不要求每次 clone。

## 5. MJS 切换逻辑

MJS（Node.js、零第三方依赖）使用 UTF-8 读取、JSON 解析和 child_process 参数数组调用原生 CLI；显式指定 workspace-id，不拼接 shell 字符串。不由 LLM 选择 Runtime。外部 CLI 输出编码及错误处理仍须核实。

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
- Skill 文件上传、Runtime 真实读取并执行 MJS、custom_env 注入、两段 Autopilot Trigger。
- 多 Agent 独立选择，固定黑灯守卫不被动态协调或现有同步脚本改绑。

## 7. 实施范围与顺序

1. P0：完成现网版本、权限、Skill 供给与 Cron 的最小 PoC。
2. P0：新增 Agent、极简 Skill 与 MJS 单元测试；注册 manifest；按 Workspace 配置每 Agent 主备及黑灯守卫固定服务器绑定。
3. P0：最小调整 provision/config 投影和 .claude/skills/rondo-sync/scripts/sync_workspace.py 的 bind_agent_runtime，避免批量改绑覆盖受管主备策略及黑灯守卫固定绑定。保留非本次受管对象的既有行为，不改变交付 workflow。
4. P1：隔离 Workspace 端到端验收后逐 Workspace 配置并启用 Autopilot。未配置主备策略的 Workspace 不执行切换。
5. P2：仅有实际问题时再考虑防抖、额外告警或向 Multica 上游提原生主备需求。

本计划仅保存设计；不包含生产 Agent/Autopilot 创建、配置写入、部署或代码实施。配置字段、传输方式及脚本入口以 PoC 核实为准。

## 8. 参考实现

- Rondo: [workspace sync](rondo/src/commands/workspace/sync.ts)、[workspace provision](rondo/src/commands/workspace/provision.ts)、[sync_workspace.py](.claude/skills/rondo-sync/scripts/sync_workspace.py)、[provisioning manifest](workspace-config/provisioning.json)
- Multica: [Agent handler](https://github.com/multica-ai/multica/blob/main/server/internal/handler/agent.go)、[Agent SQL](https://github.com/multica-ai/multica/blob/main/server/pkg/db/queries/agent.sql)
- 既有版本核验：[Run 重试与复用](validation/issue-run-retry-reuse-0.6.1-2026-10-09.md)
