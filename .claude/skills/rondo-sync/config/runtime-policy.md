# Vayne Runtime Policy 配置说明

[runtime-policy.json.example](./runtime-policy.json.example) 为 `RONDO_RUNTIME_POLICY` 的参考 JSON 模板。实际配置由各 Workspace 的 Vayne Agent Environment Variables 独立维护，仓内模板不是运行时配置来源。

## 字段

| 字段 | 说明 |
| --- | --- |
| JSON Key | 当前 Workspace 内的准确 Agent Name |
| primary_runtime_id | 优先使用的本机 Runtime UUID |
| fallback_runtime_id | 本机离线时使用的备用服务器 Runtime UUID |

每个 Agent 独立设置主备，允许共享 Runtime；两个 ID 必须不同且属于当前 Workspace，首版限定相同 Provider。未配置的 Agent 不参与协调，Vayne 自身不纳入策略。

## 配置与维护

使用 [rondo-sync Skill 的 Vayne 主备 Runtime 策略维护流程](../SKILL.md#vayne-主备-runtime-策略维护) 查询、修改及回读配置。首次配置参考模板；后续修改以 Multica 已有策略为准，只修改目标 Agent。

- 更换电脑或服务器时调整对应 ID；正常上下班无需修改。
- 删除 Agent 对应节点可停止管理该 Agent；`{}` 可清空策略，禁用 Autopilot Trigger 可暂停定时协调。上述操作不自动恢复当前 Runtime 绑定。
- 配置生效无需重新发布 Rondo；后续 Vayne Run 消费新策略。
- 在 Multica 界面可直接修改 Vayne 的 `RONDO_RUNTIME_POLICY` 单个环境变量。使用原生 CLI 时必须保留其他 custom_env 键和值。

首次启用前，管理员完成固定服务器绑定和现网验收。在 Vayne Run 中使用 `rondo runtime reconcile --dry-run` 核实计划；原生权限及 Run 迁移等 PoC 通过后方可启用定时协调。详见 [黑灯计划](../../../../20-lights-out-plan.md)。

不保存生产 Runtime ID、完整 custom_env 或凭据至仓库，不新增配置同步机制。
