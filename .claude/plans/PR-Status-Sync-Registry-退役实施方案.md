# PR Status Sync Registry 退役实施方案

**日期** 2026-11-23

**状态** 待实施、待验收

删除 `skills/pr-status-sync/config/repo-registry.json`，让 `rondo pr reconcile-status` 直接使用当前 Multica Run 的 Workspace 和服务地址，从 Issue 的 `current_pr` 定位待查 PR，以 TFS API 的返回结果判定状态。后续 `issue-closeout` 继续使用其自己的 Registry 执行根仓准备、归档、收口和 TFS Writeback。此项改动可独立于[根仓切换方案](PR-Status-Sync-耗时优化与根仓切换方案.md)实施。

## 一、目标契约

```text
rondo pr reconcile-status
rondo pr reconcile-status --issue <KEY>
rondo pr reconcile-status --recover-done
```

- Autopilot 使用当前 Run 注入的 `MULTICA_WORKSPACE_ID`、`MULTICA_SERVER_URL` 和可选的 `MULTICA_CLI_PATH`，默认 CLI 名称为 `multica`。手动调用显式设置同一组环境变量，CLI 已具备访问该环境的认证。Workspace 或服务地址缺失时返回 `UNKNOWN`（exit 3），在任何 Issue 读写前停止。
- `--issue` 与 `--recover-done` 互斥。退役后传入 `--config` 返回用法错误（exit 64），避免旧调用在迁移遗漏时被静默接受。
- 常规巡检继续分页扫描 `in_review` 和 `blocked`，逐条读取 Issue metadata。`done` 只通过定向调用或 `--recover-done` 处理残留 `finalize.pending`，该路径无需 TFS 查询或认证。Agent 继续根据 `actions[]` 驱动收口，`result=PASS` 仍需逐项检查 `unknown`。
- Issue 决定查询哪些 PR，配置好的 TFS 客户端决定请求发往哪个 collection，TFS API 决定 PR 的真实身份和状态。Materialize 在可信 Registry 下绑定 `repo_key` 与真实 TFS PR；Reconcile 不根据 URL 猜测逻辑 `repo_key`。`repo_key` 继续用于交付关联和事件键，`current_pr` 字段形状保持兼容。[对账命令](../../rondo/src/commands/pr/reconcile-status.ts) · [生命周期契约 `11](../../02-multica-delivery-lifecycle-design.md#pr-status-sync)

## 二、开发任务

### 1. 抽取 Multica 运行环境解析

- [ ] 在 [runtime-context.ts](../../rondo/src/clients/runtime-context.ts) 抽出 `resolveMulticaRuntime()`，从环境变量返回必填的 `workspace_id`、`multica_server_url` 以及 `multica_cli`。CLI 路径规则沿用 [delivery handoff](../../rondo/src/commands/delivery/handoff.ts) 的约定。
- [ ] 让 `resolveRuntimeContext()` 调用该函数，再按现有规则查询唯一有效的 Delivery Squad，并继续返回 `rondo` 和 `delivery_squad_id`。`pr reconcile-status` 只使用 `resolveMulticaRuntime()`。Issue 列表、回读和写入使用相同的 Workspace 和服务地址。
- [ ] 从 [reconcile-status.ts](../../rondo/src/commands/pr/reconcile-status.ts) 移除 `loadConfig`、`RegistryConfig` 和仓库映射检查。更新参数校验、用法和命令说明，保留现有结构化输出和退出码契约。

### 2. 复用 current_pr 的链接回查 TFS

- [ ] 在 [TFS PR 查询层](../../rondo/src/tfs/api/pr.ts) 附近实现一处链接解析，供物化和对账复用。识别配置 collection 下的 `<project>/_git/<repository>/pullrequest/<id>`。用 URL 解析器校验协议、来源和 collection 路径边界，逐段解码项目及仓库名，校验正整数 PR ID 与 `current_pr.pr_id` 一致。查询参数不参与身份判定。
- [ ] 继续使用现有 TFS 连接和 PAT，仅在有 PR 需要回查时读取配置。用 URL 解析出的 project、repository 和 ID 调用现有 TFS PR 查询。请求地址取 [TFS 连接配置](../../rondo/src/tfs/config.ts)，避免将凭据发送到 Issue metadata 中随意填写的地址。
- [ ] 在指定 project 和 repository 内核对返回的 PR ID、源分支和目标分支，再读取 provider 状态。格式无法解析、collection 不符、查无 PR、分支或 ID 不符、状态不可识别时，记录受影响 Issue 的 `UNKNOWN` 和具体原因。全局查询失败继续按现有退出码处理。
- [ ] 在 [materialize.ts](../../rondo/src/commands/pr/materialize.ts) 的新建和复用路径统一校验 `pr_url`。链接缺失或无法解析为受支持格式时，仅在本次 TFS 查询已通过可信 Registry 核对 PR ID / 分支后生成规范链接；可解析链接与已核实的 project、repository 或 PR ID 冲突时返回 `UNKNOWN`，不得静默改写。所有条目校验通过后才保存 `current_pr` 并进入 `in_review`。已创建 PR 但登记未完成时沿用现有认领逻辑，重试时恢复登记。
- [ ] 保留原有聚合顺序 `abandoned → unknown → 全部 completed → noop`，并沿用 `issue#repo_key#pr_id#status`。已确认 abandoned 仍按现有规则停止推进，且保留 Assignee。只有全部当前 PR 均确认 completed 才写入 `finalize.pending`。重试复用已登记事件。

### 3. 更新 Skill 和发布清单

- [ ] 更新 [pr-status-sync Skill](../../skills/pr-status-sync/SKILL.md) 和 [CLI 命令文档](../../rondo/COMMANDS.md)，移除 `--config` 调用及旧文件路径，写明 Run 和手动执行的环境要求。
- [ ] 在 [Agent 指令](../../agents/pr-status-sync-agent/instructions.md) 及 [issue-closeout Skill](../../skills/issue-closeout/SKILL.md) 明确，`root-prepare`、`delivery finalize` 和 `tfs writeback` 使用当前 Workspace 挂载的 `issue-closeout/config/repo-registry.json` 的绝对路径。
- [ ] 在 [workspace sync](../../rondo/src/commands/workspace/sync.ts) 的 `REPO_REGISTRY_SKILLS` 中移除 `pr-status-sync`，并删除仓库内的旧 JSON。部署前核对实际 `SKILLS_ROOT` 不再残留该文件（包括曾被渲染但未清理的本地文件），否则同步可能再次上传。无需新增长期黑名单。保留 Workspace Overlay 里的 Skill ID、Autopilot 绑定和 `issue-closeout` 的配置生成。

## 三、上线前盘点存量

已抽查的 3 条历史交付证据包含可解析的项目、仓库和 PR ID，且已有编码路径样本。真实 Autopilot 环境和当前待巡检 Issue 的覆盖率需在发布前确认。

1. 对目标 Workspace 分页列出 `in_review` 和 `blocked` 的 Issue，回读 `current_pr`。记录有效、缺失、格式异常和 collection 不匹配的条目。对可解析条目抽样用 TFS API 核对 PR 身份，至少覆盖 Bug、Requirement 及含中文或空格的项目路径。
2. 对仅 URL 缺失或格式异常且 PR 身份已独立确认的条目，通过可信 Registry 和 TFS API 核实 project、repository、ID 和分支后，仅补齐 `pr_url`。如 ID、`repo_key` 或分支事实冲突，不得仅改 URL 掩盖问题；无法确认时保持 `UNKNOWN`。写回前检查 `current_pr` 是否仍为盘点时的值，避免覆盖并行登记。
3. 直接复用可解析的存量记录。只有实际发现规范链接仍无法覆盖受支持的路由或仓库改名场景，才评估为新登记补充 TFS Project / Repository ID。无需为正常切换新增长期兼容配置或定期迁移任务。

## 四、验收

在 `rondo` 目录运行 `npm run build` 和 `npm test`。回归用例优先补在 [现有对账测试](../../rondo/test/pr-reconcile-status-classify.test.mjs) 和 [发布测试](../../rondo/test/workspace-environment.test.mjs)。

| 验收面 | 通过条件 |
| --- | --- |
| CLI 与 Workspace | 无 `--config` 可启动。缺少 Workspace 或服务地址时 exit 3，且无 Issue 读写。PR 对账无需 Delivery Squad。原 `runtime get-context` 输出契约可用。 |
| PR 查询 | 中文、空格和百分号编码的规范链接可定位。错误来源、同源不同 collection、URL 与登记 ID 不符、回查身份或分支不符均可诊断，且无法触发完成收口。 |
| 聚合、重试与恢复 | `active` 无写入。所有 PR completed 仅产生一次 pending，重试返回 `resume_finalize`。abandoned 事件幂等且保留 Assignee。混合状态沿用现有优先级。`done` 残留 pending 的恢复无需 TFS。 |
| 资产生成与发布 | 同步 `pr-status-sync` 时不再生成旧 JSON，远端旧附件被删除，`--check` 返回 `PASS`。`issue-closeout` 仍能读取自己的 Registry。 |
| 真实测试 Workspace | 在实际 Autopilot Run 确认环境注入和 TFS 认证。用有存量登记的测试 Issue 验证无配置巡检及手动恢复。各用一个符合条件的 Bug 和 Requirement 验证从 `finalize` 接续到收口完成。 |

## 五、切换与回滚

1. **测试 Workspace 先行。** 在旧 Run 结束后升级 Rondo，发布 Agent 指令和新 Skill，确认真实对账与收口验收通过，再安排生产切换。
2. **逐 Workspace 切换。** 待旧 Run 结束并避开下一轮 Autopilot 启动窗口。先升级该 Runtime 的 Rondo，再通过现有 Agent 供给流程发布更新后的指令，随后同步 `pr-status-sync`。同一窗口内完成版本配套，避免旧 Skill 调用已取消的 `--config`，或旧 CLI 收到无配置调用。
3. **回读并观察首轮。** 确认实际本地旧文件不存在，同步报告旧附件已删除；仅 `--check=PASS` 不足以证明退役（本地和远端同时残留也可能一致）。随后运行 `--check`，观察首轮 Autopilot 的 Workspace、`actions[]`、`failures[]` 和收口结果。相关命令见 [Workspace CLI](../../rondo/COMMANDS.md)。

```powershell
rondo workspace sync --workspace "<name>" --skill pr-status-sync
rondo workspace sync --workspace "<name>" --skill pr-status-sync --check
```

4. **回滚。** Workspace 绑定错误、存量 PR 大面积无法定位、收口配置无法取得或首轮无法确认时，暂停受影响 Workspace 的切换。用发布前版本恢复 Rondo、Agent 指令、Skill 和该 Workspace 对应的 Registry，回读资产后恢复巡检。保留已写入的 `finalize.pending` 和 `pr.abandoned`，由原事件键接续，避免重复处理。

**完成标准**　仓库和已切换 Workspace 中的 `pr-status-sync` 都没有这份 JSON，真实 Autopilot 和手动恢复可在无 `--config` 的情况下运行，Bug 和 Requirement 的交付收口均通过验收。
