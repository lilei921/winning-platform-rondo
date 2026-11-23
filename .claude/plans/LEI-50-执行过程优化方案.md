# LEI-50 执行过程优化方案（仅方案，暂不执行）

> 生成日期：2026-11-23
> 范围：优化点 1、2、3、5、6（优化点 4「代码定位绕路」与 Run2 取消原因调查不在本次范围）
> 状态：待评审，**未修改任何代码、配置或平台对象**

## 0. 源文件权威性与一处重要修正

| 位置 | 角色 | 证据 |
| --- | --- | --- |
| `D:\ai-project\winning-platform-rondo`（本仓库） | **唯一权威源**：`skills/`、`agents/`、`rondo/`、`workspace-config/` | 运行时 `codex-home/skills/workitem-triage/SKILL.md` 与本仓库 `skills/workitem-triage/SKILL.md` 逐字节一致 |
| `D:\UserProgram\winning-platform-monorepo\projects\multica\workspace-skills\`、`tools\rondo\` | **过时副本**：仍保留已删除的 `references/decision-contract.md`、`multica-handoff-contract.md`，且 handoff.ts 仍是要求 `--config` 的旧实现 | 与本仓库 handoff.ts 不同：`rondo/src/commands/delivery/handoff.ts:100-128` 现在从 `MULTICA_WORKSPACE_ID` / `MULTICA_SERVER_URL` 取运行环境，并强制校验 `MULTICA_AGENT_ID` 为 Wayfinder |

**已删除文件**（不要再引用）：
- `skills/workitem-triage/references/decision-contract.md` — 提交 `f815b0e`（2026-11-22）删除，Decision 语义与 `/note` 契约已内联到 `skills/workitem-triage/SKILL.md:8-64`。
- `skills/workitem-triage/references/multica-handoff-contract.md` — 同提交删除，交接契约已内联到 `agents/wayfinder-agent/instructions.md:11-18`。
- `skills/workitem-triage/config/repo-registry.json` — 提交 `b2631c6`（2026-11-22）删除；handoff 不再需要 `--config`。
- 这些文件仅存于 `archive/03-skills/`（归档，只读审计）和 monorepo 旧副本。

**Run1 的真实偏差**：seq35/39 从 `$env:RONDO_WORKSPACE_PATH` 读取 monorepo 旧版 `handoff.ts` 和 `multica-handoff-contract.md`；seq52 读旧版 `delivery-flow/config/repo-registry.json`（workspace_id 虽同但配置形态过时）；seq57 据此生成 `handoff-config.json`；seq59 做 BOM 清理翻车；seq68 调用 **monorepo 旧 dist** 的 `delivery handoff --config ./handoff-config.json`。两套代码/文档漂移是后续大量无效调用的**共同根因**。

**旧副本是如何被读到的（环境变量链路）**：

1. Run1 seq22 主动枚举 `Get-ChildItem Env: | Where-Object { $_.Name -match 'RONDO|CLI_PATH' }`，seq24 得到 `RONDO_WORKSPACE_PATH=D:\UserProgram\winning-platform-monorepo`、`RONDO_WORKSPACE_BRANCH=main`。
2. 该变量由 daemon 注入：运行时 `codex-home/config.toml` 的 `shell_environment_policy` 为 `inherit='all'`，`include_only` 白名单含这两个变量；daemon 由桌面端拉起，其历史任务的 `local_directory` / `workdir` 均指向该目录（持久根仓本地检出）。
3. `codebase-explorer` 要求「归属不明时读 `docs/config/repo-context.yaml`」，运行时 brief 声明项目为 `winning-platform-monorepo`，Agent 于是把该路径当根仓，读了 `AGENTS.md`、`repo-context.yaml`，进而发现 `tools/rondo/` 和 `projects/multica/workspace-skills/` 的旧副本。
4. remote-filesystem MCP 把同一根仓映射为 `/root/workspace/winning-platform-monorepo`（seq19/26），同源但只用于读文档。

---

## 1. 证据基线

| 项 | Run1（Wayfinder / Workitem Triage） | Run2（Bug Fix Agent） |
| --- | --- | --- |
| Run ID | `01a2061f-fb64-7772-86d4-545e647d6b22` | `01a20623-49fc-76df-8725-28fef1cb1bf0` |
| 时间 | 09:58:56 → 10:02:30（3m34s） | 10:01:46 → 10:03:10（人工取消） |
| 消息 / 工具调用 | 79 条 / 34 次 | 29 条 / 13 次 |
| Token | input 81,539 + cache read 994,944 + output 5,026 | 未上报 |
| 结果 | `/note`=eligible，handoff PASS | 仍在环境探测，未进入修复 |

关键时间线：10:01:34 发布 `/note`（含「交接结果将在本条评论补齐」占位）；10:01:35 回读；10:01:44 handoff PASS 并创建 Run2；10:01:45 转 `todo` + 指派；10:01:58 `comment update` 改写 `/note`（seq72）；10:02:44 Run2 自行转 `in_progress`；10:03:10 取消。

---

## 2. 优化点 1：handoff 后回写 `/note`，构成重复触发风险

### 根因

`issue comment update` 的契约是「Changing the content is a new trigger... cancels runs this comment triggered that are still in flight and re-enqueues every agent the new body mentions.」`/note` 正文提到 Bug Fix Agent，handoff 之后的 update 与刚创建的 Run2 形成竞争窗口。问题源于流程要求「先发布回读 `/note` 再 handoff」，但又把交接结果塞回同一条 `/note`。

### 方案（纯文档，改本仓库两处）

1. `skills/workitem-triage/SKILL.md` 的 `## Record` 段（约 62-64 行）：加入硬约束——`eligible` 的 `/note` 首次发布即写全；**`rondo delivery handoff` 之后禁止对同一 Comment 执行 `comment update`**；删除任何「结果待补」占位语。
2. `agents/wayfinder-agent/instructions.md` 的 `Decision & Delivery` 段（第 13-18 行）：明确交接结果由 CLI 的 `PASS / NOOP` 输出和最终回复承载（第 18 行已有此要求），不回写 Issue；需要补充事实时另发**非 `/note`** 评论，且正文不提及下游 Agent 名称。
3. 可选（CLI）：`rondo/src/commands/delivery/handoff.ts` 的 PASS/NOOP JSON 增加 `handoff_brief`（`repo_key`、`target_file`、`evidence_head`、`note_comment_id`），给 Agent 一个不改 `/note` 也能留交接证据的载体。

### 验收

- 新 Run 中 `/note` 只有一次 `comment add`，无后续 `comment update`，revision 保持 1；
- 交接结果出现在 Run 最终回复与 CLI 输出；
- 下游 Run 无因 comment 变更导致的取消/重排队记录。

---

## 3. 优化点 2：Run2 重复 Run1 的调查

### 根因

`agents/bug-fix-agent/instructions.md:19` 已有「优先复用当前 Issue 中仍有效的准入与工程证据」，但 `/note` 是自然语言，下游没有可直接消费的结构化入口，于是重新 `issue get`、读评论、加载 3 个 skill、改 status、checkout、查 help（seq3-29）。

### 方案

1. **CLI**（`rondo/src/commands/delivery/handoff.ts`）：PASS 后写 Issue metadata `delivery.handoff_brief`（JSON 字符串，含 `repo_id`、`repo_path`、`target_file`、`evidence_head`、`note_comment_id`、`tfs_id`）；写入成功再执行原有 Assignment Update；写入失败按 UNKNOWN 处理，不触发交接。metadata 写入不会启动 Run。
2. **下游 instructions**（`agents/bug-fix-agent/instructions.md`， Working Principles 之前）：新增「入口证据」段——首步 `multica issue metadata get <id> --key delivery.handoff_brief`（无 key 时回退读 `/note`），直接以 `repo_id` 作为 `repo_key`、`target_file` 作为首要目标；不再全量扫 `docs/config/repo-context.yaml`；Assignment Trigger 已设 `todo`，Agent 不重复 `issue status in_progress`。
3. **回退**：旧 Issue / 手工交接无该 metadata 时按现状执行，不阻断。

### 验收

- Run2 前 5 次工具调用内完成「读 brief → checkout → 定位目标文件」；
- Run2 不再自行改 Issue status；
- 无「已指派但 brief 缺失」中间态。

---

## 4. 优化点 3：运行时反复探测命令契约

### 根因

Run1 至少 4 次 `--help`：seq21 `multica --help`、seq53 `comment --help` + `comment add --help`、seq56 `comment update --help`、seq35 `rondo ... handoff --help`；Run2 又查 `rondo runtime check-checkout --help`、`rondo dev prepare --help`。Skill 正文只写命令名，不写完整 flag。

### 方案（本仓库文档，不新建 `_shared` 目录）

在现有 SKILL.md 内就地补「命令速查」小节，条目直接写全参数，避免跨文件漂移：

- `skills/workitem-triage/SKILL.md`：`multica issue get <id> --output json`、`multica issue comment list <id> --roots-only --summary --compact --output json`、`multica issue comment add <id> --content-file <file> --output json`、`rondo delivery handoff --issue <KEY>`（**不带 `--config`**，从 Runtime 环境取身份）。
- `skills/workspace-preparation/SKILL.md`：补 `multica repo checkout <url> --ref <ref>`、`rondo runtime check-checkout --root-repo "<path>"`、`rondo dev prepare --mode bug --config "<skill config>" --issue <KEY> --repo <repo_key> --root-repo "<path>"`。
- `skills/bug-delivery/SKILL.md`：补 `rondo bug git --operation fetch|push ...` 与 `rondo bug prepare-pr ... --evidence -` 的完整形态（正文已有，统一加 `--output json` 约定）。

规则：仅当 CLI 升级导致参数失效时才允许查 `--help`，并同步更新速查表。

### 验收

- 新 Run 无纯 `--help` 探测调用（flag 失效除外）；
- 速查表命令在 Windows 上逐条复制可执行；
- 不引用已删除的 references 或 monorepo 旧文档。

---

## 5. 优化点 5：PowerShell 引号转义与 BOM 处理

### 根因（修正）

并非单纯的 PowerShell 技巧问题：当前 handoff **不需要 `--config`**，Run1 因读 monorepo 旧文档才去复制配置、去 BOM、用 `node -e` 拼字符串（seq57→59 报 `SyntaxError`，seq60 补救），三步全是多余。

### 方案

1. **主方案**：按优化点 3 修正命令速查表，明确 `rondo delivery handoff --issue <KEY>` 无配置文件；Wayfinder instructions 第 14 行现已是此写法，保持唯一口径。旧文档中的 `--config` 示例一律清除。
2. **防御性**（低优先）：`rondo/src/clients/config.ts:39` 的 `JSON.parse(readFileSync(path, "utf8"))` 在解析前剥离前导 BOM，并加中文注释说明 Windows PowerShell 兼容；补一条 BOM 输入回归测试。此改动对其他仍使用 `--config` 的命令（如 `dev prepare`）也有价值。
3. **文档约定**：确需生成 JSON 配置时，用 `[System.IO.File]::WriteAllText(path, json, (New-Object System.Text.UTF8Encoding($false)))` 一次写无 BOM 文件；禁止 `node -e` 内联字符串拼接与事后去 BOM。

### 验收

- 同类 Run 中不再出现 `handoff-config.json`、`node -e` 与 BOM 清理；
- config.ts 现有测试全过，新增 BOM 输入测试通过。

---

## 6. 优化点 6：重复读取

### 根因（修正）

不只是「同一资源读多次」，而是**多源漂移**：Agent 通过 `RONDO_WORKSPACE_PATH` 找到 monorepo 旧副本的 references、config、handoff 源码和 dist，与本仓库权威源交叉读取，才产生 seq39/43/52 的重复读配置和源码、`issue get` 3 次、同一关键词 4 种工具搜索。

### 方案

1. **消除漂移入口**：在 `agents/wayfinder-agent/instructions.md` 和 `skills/codebase-explorer/SKILL.md` 写明：Skill 契约、Agent 指令、rondo 命令以**当前 Task 运行时加载的 skill/agent 文件和 `PATH` 上的 rondo** 为准；不从 `RONDO_WORKSPACE_PATH` 读取 skill 文档或 rondo 实现。建议给 monorepo 旧目录加 `DEPRECATED.md` 指向本仓库（需先确认该目录是否被其他流程依赖）。
2. **配置检查**：本仓库 `skills/workitem-triage/` 已无 config，无需修 workspace_id；现有其他 skill config 中 `a9469044-...` 与目标 Workspace 一致。`skills/workitem-analysis`（`743b9b30...`）与 `skills/tfs-writeback`（`ec70611d...`）用途不同，**不改动**。
3. **一次读取、上下文复用**：在 `skills/codebase-explorer/SKILL.md:14-20` 加硬规则——同一 Run 内同一 Issue / Comment / 配置 / 源码只读一次；写后回读只取变化字段（`--compact` / `--summary`）；`issue status` 返回已含完整 Issue 时不再 `issue get`；已知精确线索时直接一次 remote-ripgrep + 一次文件读取，不先做宽泛 codegraph。

### 验收

- 同类 Run 工具调用从 34 降到 ≤20，`cache_read_tokens` 从 ~995K 降到 ~500K 以下；
- `issue get` 每 Run ≤1 次；
- 日志中不再出现 `RONDO_WORKSPACE_PATH` 下的 skill 文档 / rondo dist 读取。

---

## 7. 实施顺序与依赖

| 顺序 | 项 | 修改文件（本仓库） | 依赖 |
| --- | --- | --- | --- |
| 1 | 优化 1 文档 | `skills/workitem-triage/SKILL.md`、`agents/wayfinder-agent/instructions.md` | 无 |
| 2 | 优化 3、5 主方案 | 三个 SKILL.md 的命令速查 | 无 |
| 3 | 优化 6.1、6.3 | `agents/wayfinder-agent/instructions.md`、`skills/codebase-explorer/SKILL.md` | 2 |
| 4 | 优化 2.1 + 1 可选 | `rondo/src/commands/delivery/handoff.ts` | 1 |
| 5 | 优化 2.2 | `agents/bug-fix-agent/instructions.md` | 4 |
| 6 | 优化 5.2 防御性 | `rondo/src/clients/config.ts` + 测试 | 无，可与 4 并行 |

发布边界：`workspace-config/provisioning.json` 为受管清单；先在隔离测试 Workspace 执行 `rondo workspace provision --dry-run`，再分步 provision / sync、回读 Skill 内容与 runtime 身份，最后 E2E；不在生产 Workspace 自动全量 Provision。

## 8. 本次明确不做

- 不修改任何文件（本文件除外）；
- 不同步 Skill、不调用 `rondo delivery handoff` 或其他写平台对象的命令；
- 不调查 Run2 被人工取消的原因；
- 不处理优化点 4（代码定位绕路）；
- 不引用 `archive/03-skills/` 或 monorepo 旧副本作为规则源。
