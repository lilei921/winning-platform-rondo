# tfs-cli 方案（流水线 TFS 工具封装）

> 状态：**已验收（2026-10-14，C0–C6 + L3-1/2/3 全过，见 §7）**。实现于 `services/tfs-cli/`（azure-devops-node-api 6.6.3 + marked；tsc 构建，`dist/index.js` 入口）。
> 定位：为交付流水线 5 个 TFS 触点提供**确定性 CLI**，替代 `sync-config.json` 中的占位命令（`tfs-mcp query-workitems`），解锁 L3 及缺口 ②③⑥。
> 决策记录：① CLI 落 `services/tfs-cli/`；② 基于 `azure-devops-node-api`（复用 `services/tfs-mcp/src/tools/` 核心逻辑）；③ Analyst 取证增强（P2）待 CLI 完成后再议。

## 1. 设计约束（红线）

1. **退出码基线**：0 成功 / 2 单项失败 / 3 UNKNOWN；stdout 只出 JSON；日志走 stderr（对齐仓内脚本约定，`reconcile-workitem.ts` 直接消费）。
2. **鉴权注入**：TFS base URL / collection / project / PAT 由环境变量或 config 文件注入；**PAT 永不走命令行参数**（进程列表可见），永不出现在 stdout/stderr。
3. **输出即契约**：每个子命令的 JSON 形状一经定稿不再变；字段名与 02 设计文档的 metadata / PR Facts 契约对齐。
4. **CLI 层无业务判断**：幂等编排（如 PR 创建重试先查外部事实）留在 Skill 脚本层；CLI 只如实执行 + 如实返回。
5. **TFS 2018 目标**：API 版本、分页、Basic Auth（PAT）按 TFS 2018 实测调通为准；不假设 Azure DevOps Services 行为。

## 2. 命令面（P0 + P1 共 8 个子命令）

```text
tfs-cli query --wiql "<WIQL>"                          # P0 触点① Run 0 同步入口
tfs-cli repo get --name <repo> [--project <p>]         # P1 触点③ 身份校验
tfs-cli branch get --repo <r> --name <b>               # P1 触点③ 分支存在性校验
tfs-cli pr create --repo <r> --source <b> --target <b> --title <t> \
                 [--description-file <f>] [--work-items <id,id>]   # P1 触点③
tfs-cli pr get --id <n> [--repo <r>]                   # P1 触点③④ status 终态判定
tfs-cli pr list --repo <r> [--status <active|completed|abandoned>] [--source-branch <b>]  # P1 触点④
tfs-cli workitem set-state --id <n> --state <s>        # P1 触点⑤ finalize 回写
tfs-cli workitem comment --id <n> --text-file <f>      # P1 触点⑤ 评论回流
```

P2（暂缓，CLI 验收后再议）：`workitem get --id [--relations] [--attachments-dir]`——Analyst 补充取证。

## 3. 输出契约（stdout JSON）

### 3.1 `query`（对齐 `reconcile-workitem.ts` 的 REQUIRED_WI_FIELDS）

```json
[
  { "id": 255512, "type": "Requirement", "title": "...", "url": "http://tfs/.../255512",
    "state": "Approved", "changedDate": "2026-10-13T08:00:00Z" }
]
```

WIQL 返回的工作项字段映射规则：URL 由 base URL + id 构造（TFS 2018 WIQL 不直接返回 web URL，tfs-mcp 已有构造逻辑可移植）。

### 3.2 `repo get` / `branch get`

```json
{ "found": true, "repo": { "id": "<guid>", "name": "...", "project": "...", "defaultBranch": "refs/heads/dev" } }
{ "found": true, "branch": { "name": "dev", "commit": "<sha>" } }
```

`found:false` 时退出码 2（身份校验失败是明确失败，不是 UNKNOWN）；TFS 不可达/凭据无效 → 3。

### 3.3 `pr create`

```json
{ "created": true, "pr": { "id": 3253, "url": "...", "repo": "...", "sourceBranch": "...", "targetBranch": "...",
  "status": "active", "workItems": [255512] } }
```

已存在同 source→target 的 active PR（TFS 2018 拒绝重复创建）：如实返回 `{"created": false, "existing": {...}}`，退出码 0——**重复创建判定交给调用方**（CLI 不擅自复用）。

### 3.4 `pr get` / `pr list`

```json
{ "id": 3253, "status": "active|completed|abandoned", "mergeStatus": "...", "mergeCommitId": "...",
  "sourceBranch": "...", "targetBranch": "...", "url": "...", "workItems": [255512] }
```

`status` 原样透传（`pr-status-sync` 只认 active/completed/abandoned 三值，其余由它判 UNKNOWN）；`mergeStatus`/`mergeCommitId` 仅辅助证据（02 §573）。

### 3.5 `workitem set-state` / `workitem comment`

```json
{ "id": 255512, "previousState": "Approved", "state": "Done" }
{ "id": 255512, "commentAdded": true }
```

set-state 幂等语义：当前状态已是目标值 → `{"id": ..., "state": "<same>", "changed": false}`，退出码 0（对齐 finalize"已符合则跳过"）。

## 4. 配置注入

```text
TFS_URL         http://tfs.winning.com.cn/tfs        （或环境实际地址）
TFS_COLLECTION  DefaultCollection
TFS_PROJECT     默认项目（可被 --project 覆盖）
TFS_TOKEN       PAT（仅此途径，禁止 --token 参数）
```

备选：上述四项也可放 `services/tfs-cli/config/tfs.config.json`（gitignore），env 优先于文件。

## 5. 与流水线的接线点

| 触点 | 接线方式 |
|---|---|
| ① Run 0 同步 | `sync-config.json` 的 `tfs.query_command` 改为 `["node","services/tfs-cli/dist/index.js","query","--wiql","SELECT ..."]`（或编译后单文件路径；最终形状以 CLI 落地为准）→ **解锁 L3** |
| ③ PR 物化 | `pull-request` capability（待实现）内部依次调 `repo get` / `branch get` 校验 → `pr create` → `pr get` 回读登记 |
| ④ PR 轮询 | `pr-status-sync`（待实现）调 `pr get` / `pr list` 读终态 |
| ⑤ Finalize 回写 | `finalize-delivery`（待实现）调 `workitem set-state` / `comment`，失败按 UNKNOWN 语义交人工 |

## 6. 实现要点

- 目录：`services/tfs-cli/`（独立 package，`azure-devops-node-api` 依赖；tsc 构建，`dist/index.js` 为入口；不追求零构建——区别于 `workspace-skills/*/scripts/` 的单文件纪律，因为 node-api 依赖不可避免）；
- 核心函数从 `services/tfs-mcp/src/tools/` 移植：`workitem.ts`（WIQL + URL 构造）、`pullrequest.ts`（createPullRequest 含 workItems 关联、getPullRequest）、`update.ts`（changeState/addComment）、`git.ts`（repo/branch 查询）；
- 去掉 MCP SDK 层与 TFVC/collection 管理/token 交互管理；
- 每个子命令先做 `--help` 自描述；参数校验失败退出码 64（对齐仓内脚本用法错误约定）。

## 7. 验收（并入 L3）

| # | 用例 | 预期 | 实测 |
|---|---|---|---|
| C0 | 用法错误（无参/未知命令/缺必需参数） | exit 64 + 用法提示 | ✅ 2026-10-14 三条路径全过 |
| C1 | `query` 跑通真实 Approved WIQL | exit 0，JSON 数组字段齐全 | ✅ 2026-10-14：**实例为中文本地化**（类型 `需求/任务/问题`，Bug 保持英文；状态 `已建议/已分析/活动/已解决/已验证/已关闭`），同步入口 WIQL 取 `State='活动'`（CMMI Approved 对应态），82 项契约字段齐全 |
| C2 | 接上 `reconcile-workitem.ts`（L3-1/2/3） | 创建/幂等/管理字段更新三态全过 | ✅ 2026-10-14（TFS 256462 → FOMA-28：创建 backlog+metadata 五键 ✓；重跑 skipped ✓；TFS 侧改状态后仅管理字段更新、正文不动 ✓）。**修一处**：`--metadata` 走 pflag StringSlice（CSV 解析），正确过滤形式为 `"tfs.id=""256462"""`（裸引号报错、不带引号按 number 嗅探匹配不上 string 存储值） |
| C3 | `pr create` + `pr get` 对测试仓 | 建 PR、回读 status=active；重复建返回 existing | ✅ 2026-10-14（winning-dps-df-dataintegration：PR 3334/3335 建/读/重复拦截 ✓，已 abandon + 删分支）。**修三处**：① PR 侧 workitems 端点本实例 404（tfs-mcp 吞错未暴露），关联改走工作项侧 ArtifactLink（`vstfs:///Git/PullRequestId/{proj}%2F{repo}%2F{pr}`）✓；② pr status 数字枚举→文本（1/2/3→active/abandoned/completed）；③ `branch get` 曾 `|| branches[0]` 误报 found:true，改精确匹配 |
| C4 | PAT 无效 / TFS 不可达 | exit 3 + UNKNOWN JSON，stderr 不含 token | ✅ 2026-10-14（假 PAT 收到 401，exit 3，无泄漏；服务器连通性同时验证） |
| C5 | `workitem set-state` 幂等 | 重复设置同状态 `changed:false` exit 0 | ✅ 2026-10-14（256462 已建议↔活动往返 changed:true，重复设 changed:false；含英文→中文状态名映射） |
| C6 | `workitem comment` | exit 0，评论落 TFS History | ✅ 2026-10-14（255512） |

## 8. 明确不做

- TFVC 全部；collection 交互管理；`tfs_get_my_tasks` 等专用查询（WIQL 泛化覆盖）；PR Review 过程读取/投票（02 §63：审核留在 TFS 平台）；`tfs_create_workitem`（finalize 明文"不新增 Task"）；附件上传。
