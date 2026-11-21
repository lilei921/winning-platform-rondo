# PR Status Sync 2026-11-21 回放修复方案

> 状态：设计方案（未实施）
>
> 范围：LEI-49 / PR #3947 真实回放；Requirement Closeout 的 TFS Inspect、根仓 Clone、CLI 探测与 Daemon 可选上报。
>
> 原始证据：[回放概览](replay.md) · [复盘](20261121-1601-01a1fd20/review.md) · [异步与平台事件](evidence/workflow-events.json)
>
> 原则：遵守 [01 设计原则](../../01-multica-openspec-design-guideline.md) 的 KISS、YAGNI、Specialist Focus、One Rule One Owner、Native First 和 Minimal Sufficient。仅修复已证实的问题，保留现有 Hard Gate、外部写入回读及安全清理机制。

## 1. 事实与结论

- 2026-11-21 16:01:42–16:13:28（北京时间），`PR Status Sync` 扫描到 LEI-49。PR #3947 对账 PASS，`delivery finalize --phase prepare` PASS，OpenSpec Archive 提交 `de3ac0d…` 已推送 `main` 并回读确认。
- `rondo tfs writeback --inspect` 返回 `UNKNOWN`，Issue 保持 `in_review`，保留 `finalize.pending.prepared_change_ref`。未执行真实 TFS Writeback 或 Complete。已确认的归档不得在恢复时盲目重做。
- 两个针对同一 `analysis.source.repo_url + branch` 的 Clone 分别于 16:03:20 和 16:04:05 启动，16:11:30 和 16:11:56 成功；均已安全清理。回放中存在 12 次对第二个异步会话的轮询。重复 Clone 增加资源消耗，但不能直接断言节省的墙钟等于一次 Clone 的完整耗时。
- 五个叶子 `--help` 返回非零、一次工作目录内 `rg --files` 未匹配，均未阻断交付；Daemon 的 `context-receipt` 与 `rate-limits` 两个可选上报返回 404 并被跳过。

## 2. P0 — TFS Inspect UNKNOWN

### 2.1 已确认的根因

调用链为 `writeback --inspect → inspectRequirementCommits → commitTaskOwners`。在发出 Commit 反向 API 请求前，[commit-facts.ts](../../rondo/src/tfs/api/commit-facts.ts) 要求 `RONDO_TFS_REVERSE_QUERY_VERIFIED === "1"`；本次执行未满足该前置，因此主动返回 `UNKNOWN`。**这不是 TFS 实际查询返回 UNKNOWN，也不能证明 API 不支持跨 Project。**

实际写入还有另一独立门禁：[collection-lock.ts](../../rondo/src/tfs/collection-lock.ts) 需要 `RONDO_TFS_COLLECTION_LOCK_DIR` 指向所有写入 Runtime 共享且验证过原子创建语义的目录。本次停在 Inspect，尚未验证共享锁运行状态。

### 2.2 最小处理

1. 在真实 TFS 2018 Update 3.2 Collection、实际 Agent 身份下，用隔离测试 Commit/Task 验证 `fromCommitId=toCommitId + includeWorkItems` 的返回结构及准确性。
2. 至少覆盖无关联、同 Project Task、跨 Project Task、重复关联、权限不可见/删除项、写后双向回读，并检查 API 返回的间接关联是否会影响 Task 直接 ArtifactLink 判断。不能把不可见/部分返回当作空 Owner。
3. 所有可能写入的 Runtime 共同验证同一个共享锁目录具备跨进程/跨机器原子独占能力；`RONDO_TFS_COLLECTION_LOCK_DIR` **不能设在单个 Run 的 workdir**。
4. 两项验收完成后，才在持久 Runtime 环境配置 `RONDO_TFS_REVERSE_QUERY_VERIFIED=1` 和共享锁目录，恢复 Inspect → Writeback → Complete。若真实测试发现 API 不兼容，仅修复 `commitTaskOwners` 的具体兼容点。

禁止绕过 `UNKNOWN`、仅查询当前 Issue、以 Mock 结果代替跨 Project 验收，或为此提前新建关联索引数据库/锁服务。

## 3. P1 — Clone 必须创建在 Multica 当前 Run 的 workdir

### 3.1 证据与原因

本次回放 `replay.json.cwd` 为：

```text
D:\Multica\desktop-172.17.1.97-8080\winning-lil-b39bad65de56\task-17e2b9f10dd3\workdir
```

现有 [closeout-root.ts](../../rondo/src/commands/delivery/closeout-root.ts) 在 `cloneCloseoutRoot` 中使用：

```typescript
mkdtempSync(join(tmpdir(), "rondo-closeout-"))
```

而 `verifyCloseoutRoot`、`cleanupCloseoutRoot` 也要求 `realpathSync(dirname(root)) === realpathSync(tmpdir())`。因此仅修改 Agent Prompt、传不同 `--root-repo` 或在 Clone 后手动移动目录都不可行。这里需要使用 **当前 Multica Run 的 task workdir**，不是 Analysis/Engineer 的常驻 `RONDO_WORKSPACE_PATH`，也不是 TFS Collection 共享锁目录。

### 3.2 推荐方案：显式 workdir，受控子目录

- 在现有 `rondo delivery root-clone` 增加必需的 `--workdir <absolute-path>`，由 PR Status Sync Agent 传当前 Task 的真实 workdir；缺失、路径不存在或不可信时明确失败，不静默退回系统 Temp。无需增加全局环境变量、长期 Clone 缓存或新的 Workspace Skill。
- `cloneCloseoutRoot` 在已验证的 workdir 下用 `mkdtempSync(join(workdir, "rondo-closeout-"))` 创建**独立子目录**，不可直接把 Git 克隆到已有 workdir 根目录。
- 在现有 `.git/rondo-closeout-owner.json` 中保留此次 Clone 的规范化 `workdir` 作为清理边界，继续记录 `token/repo_url/branch/commit/change_ref`。`root-clone` 继续返回 `root_repo` 与 `cleanup_token`，后续 Prepare/Inspect/Complete 的 `--root-repo` 语义保持不变。
- 将验证和清理逻辑中固定 `tmpdir()` 的父目录检查调整为：**根仓必须是 owner 记录的 workdir 的一级子目录**；使用规范化绝对路径和真实路径核对，不接受目录符号链接或越界路径；同时继续验证 `rondo-closeout-` 前缀、`.git` 所有权标记、Origin、Branch、批准 Commit、Cleanup token、无 Git 操作和未推送/未保存工作。只允许删除受控子目录，绝不删除 workdir 自身。
- Agent 从本次任务已知的工作目录取得绝对路径，示例：

```powershell
$workdir = (Get-Location).Path  # 确认当前位于 Multica Task workdir
rondo delivery root-clone --issue LEI-49 --config "<config-path>" --workdir "$workdir"
```

- 推荐输出结构：

```text
<multica-task-workdir>/
  rondo-closeout-XXXXXX/  # 同一 repo_url + branch 分组复用
  rondo-closeout-YYYYYY/  # 仅其他分组需要时创建
```

- **不用更改 `TEMP`/`TMP` 环境变量**：它们影响其他子进程，而且多次独立 PowerShell 调用不能假定继承临时环境修改。也不建议仅依赖隐式 `process.cwd()` 作为永久接口，因为 CLI 可能从其他目录调用。
- 版本切换时，若旧 Run 尚有 Temp Clone，应先使用原命令完成安全清理；不要为历史临时目录加入永久的宽松路径回退。现有回放的两份旧 Clone 已清理。

### 3.3 关键验收

1. 在真实 Multica Task workdir 执行一次 Clone，返回的 `root_repo` 是 workdir 的**直接子目录**，且不再出现在 `C:\Users\...\AppData\Local\Temp`。
2. Prepare、Inspect、Complete 仍能使用相同 `--root-repo`，原有 Git Source/Branch/Commit 核验、归档 Push/回读完整保留。
3. 同分组多个 Issue 复用一个根仓；不同分组可以各有一个独立 Clone。
4. 正常 Cleanup 只删除对应受控子目录，workdir及其他 Clone 保持不变；错误 token、伪造标记、越界路径、符号链接、Git 未结束、未推送内容或脏工作区均拒绝删除并保留现场。
5. 单元测试覆盖目录边界、Clone 复用调用与清理拒绝；在 Windows Multica Desktop 真实 Run 中验收。单纯改测试 fixture 的 `tmpdir()` 不等于完成实际验收。

## 4. P1 — 重复 Clone 与异步进程状态

根因不是 Rondo 必须管理 Clone 池：第一次工具调用的包装器只呈现 `exit_code/output`，结果为 `exit=undefined`，没有把可追踪异步状态完整传给 Agent；Agent 随后启动同组第二次 Clone。

- **Agent Instructions Owner**：同一 `repo_url + branch` 分组仅维护一个执行中的 Clone；获取异步 `session_id` 后轮询同一进程，明确完成且返回 `root_repo/cleanup_token` 后进入 Prepare；状态未知先核实原调用，不以输出暂缺为理由重启。
- **工具包装器 Owner**：确认 `session_id`、running/finished 状态和退出码均完整传给调用方。只在证明确实丢失字段时修复包装器。
- 保留目前的组内复用、组终止后受控清理和异常保留现场。不要新增 Clone Registry、跨 Run 状态机或全局缓存。

## 5. P2 — 其余非阻断异常

- **五次叶子 `--help`**：现有 Rondo CLI 多处禁用 Commander 叶子帮助并保留自有参数/退出码契约。优先从 Skill 读取可用命令，避免 Agent 用无效探测代替文档；若多次复现产生实际运维成本，再集中统一帮助行为及测试，不纳入本次核心修复。
- **`rg --files` exit 1**：当前 Task workdir 无匹配文件是正常退出语义；配置实际位于挂载 Skill 的 `config/repo-registry.json`。无需修复 `rg` 或新增文件发现机制。
- **Daemon 两个 HTTP 404**：`context-receipt` 与 `rate-limits` 可选上报在服务端返回 404 并跳过。本次未阻断。由 Multica Server/Daemon Owner 核对端点及版本兼容；不在 Rondo/Agent 添加重试或协议兜底。

## 6. 建议实施顺序及改动边界

| 顺序 | Owner / 文件 | 最小修改 |
| --- | --- | --- |
| 1 | TFS 集成与 Runtime 运维 | 实测 Commit 反向关联及共享锁；通过后配环境变量，不先改算法 |
| 2 | `rondo/src/commands/delivery/closeout-root.ts` | Clone 增加 `--workdir`；受控子目录创建、owner 标记、验证与安全清理适配 |
| 3 | `agents/pr-status-sync-agent/instructions.md` | Clone 命令提供 workdir；保持单组单 Clone，保留/轮询异步会话 |
| 4 | 相关 Rondo 单测 + Windows Multica 实际 Run | 验证目录边界、清理安全、分组复用和恢复 |
| 后续按需 | CLI 帮助、Daemon/Server、工具包装器 | 仅有真实复现问题时局部修复 |

不改 `issue-closeout` 的职责归属，不重写 `finalize`/Writeback 业务 Gate，不改 Git clone 协议/分支选择算法，不引入新 Skill、状态表或额外管理 Agent。

## 7. LEI-49 恢复标准

- 复核已确认的 PR #3947、远端归档 Commit 和 `finalize.pending`，不重复已完成的 Archive/Push。
- 只启动一次受控 Clone，位置为当前 task workdir 一级子目录；成功后组内复用。
- 真实 TFS 2018 验收及共享锁就绪后，`--inspect` 返回可核验的业务 Commit/Task Owner；独占计划写回成功且双向回读 PASS，才能 Complete。
- Issue 转为 `done`；`finalize.pending` 依现有契约清理；临时 Clone 安全清理。

> 本文仅保存修复方案；不代表代码已实施、TFS 真实跨 Project 能力已验证或 LEI-49 已完成收口。
