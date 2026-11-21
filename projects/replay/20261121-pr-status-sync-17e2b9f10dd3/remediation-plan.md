# PR Status Sync 2026-11-21 回放修复方案

> 状态：**TFS P0 生产验证已完成（当前同机部署）**；Clone workdir 与异步执行修复待实施；LEI-49 正式收口待验收。
>
> 范围：LEI-49 / PR #3947 Requirement Closeout；只处理回放中确认的 TFS Inspect 门禁、Clone 路径及重复启动，记录非阻断异常的处置结论。
>
> 依据：[回放概览](replay.md) · [复盘](20261121-1601-01a1fd20/review.md) · [运行事件](evidence/workflow-events.json) · [TFS P0 生产验收](../../../validation/tfs-writeback-p0-validation-2026-11-21.md)（[证据](../../../validation/tfs-writeback-p0-validation-2026-11-21.evidence.json)）。
>
> 原则：遵循 [01 设计原则](../../../01-multica-openspec-design-guideline.md)：KISS、YAGNI、Specialist Focus、One Rule One Owner、Native First、Minimal Sufficient。保留现有 Hard Gate、外部写入回读和安全清理，不扩散成 TFS/Git/Workspace 架构重构。

## 1. 背景与已确认事实

- 2026-11-21 16:01:42–16:13:28（北京时间）运行中，PR #3947 状态对账、`delivery finalize --phase prepare`、OpenSpec Archive Push 与远端回读均已 PASS；归档 Commit `de3ac0d…`。LEI-49 保持 `in_review`，`finalize.pending.prepared_change_ref=variable-value-scope-query-267307`；**尚未实际 TFS Writeback 或 Complete**。恢复时不盲目重做已确认的 Archive/Push。
- 该次 `rondo tfs writeback --inspect` 在 `commitTaskOwners()` 发出 TFS 反查请求**之前**，因 `RONDO_TFS_REVERSE_QUERY_VERIFIED !== "1"` 主动返回 `UNKNOWN`。它反映的是当时的运行配置，不是 TFS API 报告“不支持跨 Project”。
- 同一 `analysis.source.repo_url + branch` 在 16:03:20 与 16:04:05 两次启动 Clone；两份分别于 16:11:30 与 16:11:56 完成并安全清理。重复调用增加资源消耗；不能直接认为去重可缩短完整一次 Clone 的墙钟。
- 当时 Clone 使用 `os.tmpdir()`，位于 `C:\Users\lilei\AppData\Local\Temp`，而 Multica Task 的运行目录位于 `D:\Multica\...\task-17e2b9f10dd3\workdir`。
- 五次叶子 `--help` 非零、一次 `rg --files` 未匹配、两次 Daemon 可选上报 HTTP 404 **均非收口阻断原因**。

## 2. TFS P0：已验证能力与恢复边界

### 2.1 2026-11-21 16:30 生产验收结论

生产 Agent 在 `winning-lilei` / `lileipc` 使用实际 TFS 身份，完成只读反查和共享锁竞争测试，结果 PASS：

- `commitTaskOwners()`：跨 Project Task `258124`、同 Project Task `267393` 的反向结果均与 Task 正向 `ArtifactLink` 一致；与需求 `267307` 关联的 Commit 不被误判为 Task Owner。
- LEI-49 / PR #3947 的**指定样本 Commit** `73c89eb14315ba5ca4765c73755aa9a40d9e31ef` 返回空 Task Owner；这**不等于**已完成全部 PR Commit 的 `--inspect`。
- 不存在 Commit 返回 `UNKNOWN`；批量回读包含不存在的 Work Item ID 时返回 HTTP 404，而非静默认定为无 Owner。
- Codex 与 Claude 两个独立 Run 在**同一台 Windows 主机**竞争同一锁键时互斥成功、释放后可重新获取；不代表已验收跨机器共享文件系统。
- 生产 PR Status Sync Agent 已配置并回读确认 `RONDO_TFS_REVERSE_QUERY_VERIFIED=1` 和 `RONDO_TFS_COLLECTION_LOCK_DIR=D:/Multica/rondo-tfs-locks`；后续生产探测确认两者传入子进程，跨 Project 反查和测试锁操作 PASS。

以上结论与样本细节只由[生产验收记录](../../../validation/tfs-writeback-p0-validation-2026-11-21.md)维护，不在本方案重复建立一套验收事实。

### 2.2 边界与处理

- **不再将 TFS 反查/当前同机锁重复验收列为本轮 P0 开发待办**；不改 [commit-facts.ts](../../../rondo/src/tfs/api/commit-facts.ts) 和 [collection-lock.ts](../../../rondo/src/tfs/collection-lock.ts) 的门禁/独占算法。
- 权限不可读、一个 Commit 关联多个 Task 等极端真实样本尚未完整覆盖。保留现有 Fail Closed 与双向回读，若在真实操作中出现对应 `UNKNOWN` 再按具体证据处理；不以未覆盖边界替代当前流程的实际 Gate。
- **部署边界**：`D:/Multica/rondo-tfs-locks` 已验证的是当前同机 Runtime。若新增其他主机承担 TFS Writer，应先验证所有 Writer 可访问同一具备原子独占能力的共享锁目录；单机目录不能直接当作跨机器锁。
- 使用已注入配置重新执行**完整的** `rondo tfs writeback --inspect`，核对批准版 `tasks.md`、真实已完成 PR 的全部业务 Commit、Owner 与 `saved_plan`。若再返回 `UNKNOWN`，诊断该次原因，不预设仍是配置变量缺失。
- 实际 Writeback 仍须在 Collection Lock 内重新检查 Owner、执行任务写回并正反双向回读；`--inspect` 或只读生产探测 PASS 都不等于 Writeback PASS。

## 3. P1：Clone 使用当前 Multica Task workdir

### 3.1 原因和职责

现有 [closeout-root.ts](../../../rondo/src/commands/delivery/closeout-root.ts) 使用 `mkdtempSync(join(tmpdir(), "rondo-closeout-"))` 创建 Clone，`verifyCloseoutRoot()` 和 `cleanupCloseoutRoot()` 也固定检查 `tmpdir()` 父目录。因此只修改 Agent Prompt、手动移动 Clone 或修改 `TEMP/TMP` 都不能正确解决。

目标目录是**当前 Multica Agent Run 的 Task workdir**，不是 Analysis/Engineer 常驻的 `RONDO_WORKSPACE_PATH`，更不是 `RONDO_TFS_COLLECTION_LOCK_DIR`。

### 3.2 最小实现

1. 在 `rondo delivery root-clone` 增加必需的 `--workdir <absolute-path>`。由 PR Status Sync Agent 从当前 Run 的可靠执行上下文获取并传入；不能把任意 `cwd` 默认当成 Task workdir。缺失或不是有效目录时明确失败，**不回退系统 Temp**。
2. `cloneCloseoutRoot()` 接收 workdir，使用 `mkdtempSync(join(validatedWorkdir, "rondo-closeout-"))` 创建**workdir 的独立一级子目录**，不在 workdir 根目录直接 Clone。
3. 复用原有 `.git/rondo-closeout-owner.json`，仅增加规范化 `workdir` 字段；继续记录原有 `token/repo_url/branch/commit/change_ref`，不新增 Manifest/Registry。Clone 返回的 `root_repo`、`cleanup_token`，以及后续 `--root-repo` 的契约不变。
4. `verifyCloseoutRoot()` 与 `cleanupCloseoutRoot()` 仅替换硬编码 `tmpdir()` 的父目录判定：核对真实、规范化路径，确认根仓是 Owner Marker 记录的 workdir 下**一级受控子目录**，拒绝符号链接/越界等不可信路径。在 Windows 下正确处理路径分隔符、大小写与规范化。**复用**现有 Origin、Branch、批准 Commit、Cleanup token、Git 锁/WIP、远端已推送等安全检查，不重新发明一套。
5. `root-cleanup --root-repo ... --token ...` 保持不变；只删除确认属于本次 Clone 的子目录，绝不删除 workdir 或其他分组的 Clone。执行异常时按现有策略保留现场；旧 Temp Clone 若仍存在须先按原有安全机制处理，不引入永久性宽松回退。

命令形态：

```powershell
rondo delivery root-clone --issue LEI-49 --config "<config-path>" --workdir "<当前 Multica Task workdir 的绝对路径>"
```

目标结构：

```text
<task-workdir>/
  rondo-closeout-XXXXXX/    # 同一 repo_url + branch 组内复用
  rondo-closeout-YYYYYY/    # 仅不同分组需要时创建
```

### 3.3 验收

- Clone 的 `root_repo` 位于当前 Task workdir 直接子目录下，不再落到 `AppData/Local/Temp`。
- 已有 Prepare/Inspect/Complete 继续使用相同 `--root-repo`，Archive Push 与远端回读不退化。
- 同组多 Issue 一次 Clone、不同组各自独立；Cleanup 不删除 workdir 及其他组。
- 错 token、越界/符号链接、伪造 Owner Marker、脏工作区、未推送 Commit、未完成 Git 操作均拒绝不安全清理并保留现场。
- 扩展现有 `rondo/test/closeout-stage-a.test.mjs`，运行 Build、相关单测和完整测试；最后在 Windows Multica Desktop 的真实 Run 验证实际目录。测试 fixture 通过不等于生产 workdir 行为已验收。

## 4. P1：重复 Clone 与异步结果不明确

已确认：第一次 Clone 的 Agent 可见工具结果不足以可靠跟踪原进程（`exit=undefined`），随后 Agent 在同组发起第二次 Clone。**尚未确认**原始工具是否提供追踪标识、或包装器是否遗漏了已有字段，不能直接将其归因于包装器缺陷。

- **Agent Instructions Owner**：同一 `repo_url + branch` 分组只保持一个进行中的 Clone；异步执行时沿用工具实际提供的任务/会话标识轮询或核实原任务。结果不明确时先检查原调用，不能因输出暂缺便重启；明确完成后保存并复用 `root_repo/cleanup_token`。分组结束或停止、确认不再使用后执行安全 Cleanup，失败时保留现场。
- **工具包装器 Owner（按需）**：只在证明确实丢失了已有的运行标识、完成状态或退出码时局部修复。不要把某工具的 `session_id` 定为通用业务接口。
- 不创建 Clone Registry、全局 Clone 缓存、跨 Run 状态机或分布式 Clone 锁。异步重复启动的验收优先在 Multica 真实 Run 中检查调用记录；不为模拟 Agent 决策而重构 Rondo 单元测试。

## 5. 非阻断异常：记录处置，不纳入本次研发

| 事件 | 结论 |
| --- | --- |
| 五次叶子 `--help` 非零 | 优先使用已挂载 Skill 的命令契约；不为本次问题修改 Rondo CLI 帮助/退出码。 |
| `rg --files` 无匹配、退出码 1 | 正常语义；配置在挂载 Skill 的 `config/repo-registry.json`，不新增文件发现机制。 |
| Daemon `context-receipt`、`rate-limits` HTTP 404 | 本次可选上报被跳过但未阻断收口；若平台确有功能损失，由 Multica Server/Daemon Owner 独立处理，不在 Rondo/Agent 添加兜底。 |

## 6. 实施边界与 LEI-49 验收

| 顺序 | Owner / 范围 | 工作 |
| --- | --- | --- |
| 1（已完成） | TFS 集成与当前同机 Runtime | 真实跨 Project 反查、同机共享锁验证和生产变量注入，证据见第 2 章；不重复作为开发任务。 |
| 2 | `rondo/src/commands/delivery/closeout-root.ts` | `--workdir`、受控 Clone 子目录、Owner Marker 与目录边界验证；沿用现有安全清理。 |
| 3 | `agents/pr-status-sync-agent/instructions.md` | 提供当前 Run workdir；保持一组一个进行中 Clone、异步结果核实及安全 Cleanup。 |
| 4 | 现有 Rondo 测试及真实 Multica Run | 目录隔离、清理安全、组内复用、完整 Closeout 复核；包装器问题有实证才另行修改。 |

### LEI-49 恢复验收顺序

1. 回读 PR #3947、已发布 Archive Commit 和 `finalize.pending`，确认现有 Prepare 事实；避免重复提交已成功的 Archive/Push。
2. 在受控根仓上执行完整 `--inspect`；核对获批 `tasks.md`、所有 PR 业务 Commit/Owner 及已有计划。**该步骤的 TFS 验证不必等待 Clone workdir 代码修复才可进行**，但必须使用当前版本认可的受控根仓及原有安全清理机制。
3. 按 `issue-closeout` Skill 恢复已有计划或规划 1–5 个子任务（0.5–4h），在锁内执行实际 Writeback 并正反回读；只在非 Inspect 返回 `PASS` 后进行 Complete。
4. Complete 再验证 TFS 和远端归档，Issue 达到 `done`、`finalize.pending` 按现有契约清理；停止使用根仓后安全 Cleanup。
5. 在 workdir 修复部署后的真实 Run 中单独确认 Clone 路径、同组去重及清理行为；不能用一次只读 Probe 或仅单元测试宣称完整交付验收通过。

**不改** `issue-closeout` 的单 Issue 收口职责；不改 `finalize`/TFS Writeback 业务 Gate，不重写 Git Clone/分支算法，不引入新 Agent、Skill、状态表或缓存。

> 本文是修订后的实施方案；截至引用的生产验收记录，TFS P0 同机验证已完成，**不代表 LEI-49 已完成实际 TFS Writeback/Complete，也不代表 Clone/异步修复已经实施**。
