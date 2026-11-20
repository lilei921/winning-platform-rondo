# Monorepo repo-context 对齐实施记录（2026-10-22）

> 状态：**本地改造与离线验证完成；平台发布、真实存量迁移和 E2E 未执行**。方案整体尚未完成，后续阶段须按独立授权门禁执行。

## 1. 基线与边界

- 实施方案：源仓 `D:\WN_Platform\works\gitee_repos\multica\plans\monorepo-repo-context-alignment-plan.md`。
- 目标仓：`D:\WN_Platform\works\win60_repos\DF\winning-platform-monorepo`。
- 目标分支 / 基线 Commit：`multica` / `f0aced151d215f935f52dddd532ee6f137242e4a`。
- 保留上一阶段资产迁移形成的暂存变更；本方案修改主要体现为其后的 unstaged diff，另新增 `scripts/migrate-repo-keys.ts` 与本文。
- 未修改根 `AGENTS.md`、根 `.gitignore`、`docs/config/repo-context.yaml`、`tools/repo_registry.py` 或业务子仓；未删除源仓资产。
- 未读取、输出或保存 `~/.multica/config.json` 及其 token。

## 2. 实际变更

### 2.1 配置与身份

- `sync-workspace.ts` 通过既有 `tools/repo_registry.py --workspace <root> list` 读取根仓 `docs/config/repo-context.yaml`，校验查询契约、必需字段、重复 `repo_id/repo_path` 和直接子目录约束；Python 子进程显式使用 UTF-8。
- `repo-registry.base.json` 只保留 `runtime` 与 `delivery` overlay。`repo_path/tfs_project` 来自 repo-context，`tfs_repo/default_target_branch` 仅来自 delivery overlay；陈旧键和覆盖 repo-context 字段均拒绝。
- root-workspace 不进入业务 registry；其余 11 个仓全部纳入。五份 `repo-registry.json` 按 `repo_id` 排序并逐字节一致，本地多文件写入采用临时文件、同目录替换和失败恢复。
- Facts 字段名继续使用 `repo_key`，其值约定为 repo-context 的 `repo_id`；`repo_path` 只表示根仓直接子目录，`tfs_repo` 只表示 TFS 远端身份。

### 2.2 运行时路径与门禁

- 六份 `RuntimePaths` 均删除 `reposRoot` 及 `repos` 校验分支，保留运行时根仓解析与 `openspecRoot` 派生。
- 业务 hub 统一为 `<root_repo>/<repo_path>`；Issue worktree 统一为 `<root_repo>/.worktrees/<issue>-<repo_id>`；Finalize lock 统一为 `<root_repo>/.multica/locks/root-finalize.lock`。
- worktree 缺省 base 仍取 `default_target_branch`，未配置且未显式传 `--base` 时 FAIL；非 Git hub、非法 `repo_path`、未知 `repo_key` 和分支冲突均安全停止。
- Development Evidence 只精确分类根仓自身、已登记直接业务子仓和根 `.worktrees` 直接子目录。仅根仓自身豁免 `Refs:`；未登记目录、嵌套路径和仓外路径不能获得豁免。
- PR Materialize、PR Status Sync 和 Human Decision 的交付字段缺失校验已对齐新 registry；未改变 PR 终态、事件、状态机或 `--no-start` 语义。

### 2.3 Skill 与文档

- 已同步 `workitem-analysis`、`pull-request`、`finalize-delivery`、`development-execution` 的 SKILL 契约，以及 PR/Finalize/Development Facts 与 Evidence 参考。
- `codebase-explorer` 和 `multica-workspace-bootstrap` 只更新本地契约，未加入 `managed_skills`；`workitem-triage` 未修改。
- backend/frontend 领域参考保留历史实测，只明确 `df-dataintegration → dataintegration` 与 `df-dataintegration-web → dataintegration-web`；未猜测 `df-metadata-web/df-dataasset-web` 的新身份。
- 当前操作/设计文档已改为直接子仓模型；五份历史方案仅增加当前契约提示，未改写历史验收事实。

### 2.4 存量迁移工具

新增 `scripts/migrate-repo-keys.ts`：

- 默认 dry-run，只有显式 `--apply` 才写 metadata；只处理 `pr_prep/current_pr/pr.abandoned/finalize.pending`，不执行全 metadata 字符串替换。
- 仅内置上述两个明确旧键映射；`done/cancelled` 默认跳过，未知旧键、`pr_history`、非法 JSON、重复或新旧键冲突、Facts 集合不一致均 UNKNOWN。
- 同步重算 abandoned/completed event key，并校验其 Issue、repo、PR 身份及与 `current_pr` 的一致性。
- apply 前二次回读，备份写入仓外受控目录；按固定 key 顺序写入并逐 key 回读，最终核对 status/Owner；支持部分写入后的幂等恢复。
- 不写 status/assignee，不创建或修改 Run、TFS、PR、Git 对象。

## 3. 本地渲染结果

执行：

```bash
node projects/multica/scripts/sync-workspace.ts --workspace 1022_test --local-only
node projects/multica/scripts/sync-workspace.ts --workspace 1022_test --dry-run
```

结果：

- 两次均 PASS；第二次六份配置全部“无变化”。
- registry 含 11 个非 root 仓：`common`、`dataengine`、`dataintegration`、`dataintegration-web`、`dataservice-api`、`dataservice-gateway`、`dataservice-web`、`datatransfer-core`、`frame`、`frame-web`、`modular`。
- `dataintegration` 与 `dataintegration-web` 合并 `tfs_repo` 和 `default_target_branch=main`；其余仓不伪造缺省交付分支。
- 五份 registry SHA-256 均为 `a205697774f7c880f5c5a9495fea5c8b4494d4f8038111e337be5b05eece14cc`。
- 五份 registry 与一份 `tfs-sync/config/sync-config.json` 均被 `projects/multica/.gitignore` 忽略。
- `codebase-explorer`、`multica-workspace-bootstrap`、`workitem-triage` 仍只列入 `skipped_unregistered`。

## 4. 离线验证证据

所有 Git 测试使用仓外临时根仓和本地 bare remote；所有 Multica 写入测试使用仓外状态文件和 fake CLI。未连接真实 TFS，未写入真实平台或真实 Issue metadata。

| 检查 | 结果 |
| --- | --- |
| TypeScript / MJS 语法 | 18 / 18 通过 `node --check` |
| base、provisioning、workspace JSON | 7 / 7 解析通过 |
| 渲染与 Analysis fixture | 15 项 PASS |
| worktree 与 Finalize 路径 fixture/静态契约 | 9 项 PASS |
| Development Evidence fixture | 8 项 PASS |
| repo key 迁移纯函数与 fake CLI | 18 项 PASS |
| **离线矩阵合计** | **50 / 50 PASS** |
| 活跃 TS / SKILL 旧路径扫描 | 无 `repo-map.yaml`、`reposRoot/repos_root`、旧 worktree/lock 路径消费 |
| `git diff --check` | 通过，无空白错误 |
| 根保护文件状态 | 根 `AGENTS.md`、根 `.gitignore`、repo-context 与查询工具均无状态变更 |

50 项矩阵覆盖：

- 正常渲染、root 排除、五份一致、连续 dry-run；陈旧 delivery key、非法 overlay、缺字段、重复 ID/路径、越界/嵌套/绝对/点路径和 context 缺失时零写入。
- resolver 输出 `repo_context` 且不含旧 `repo_map/repos_root`；context 缺失 UNKNOWN。
- worktree create/reused、分支冲突、dirty remove、回收、缺省/显式 base、空 prune、非 Git hub、非法路径与未知键；Finalize hub/worktree/lock 路径静态一致性。
- 根仓豁免、hub/worktree 强制 `Refs:`、未登记与仓外路径拒绝、非法任务 ID、禁用状态关键字、缺失 Evidence、dispatch/task_refs/tfs_task_ids 的既有 FAIL/UNKNOWN。
- 两个旧键、多 Facts 与 event 一致迁移、新键 NOOP、历史跳过、混合状态恢复、未知键/重复/冲突/非法 JSON/pr_history/pending 异常；fake CLI dry-run 零写入、apply 仓外备份与逐 key 回读、重跑 NOOP、仓内备份目录和跨工作区配置拒绝。

按 `agent-skill-review-checklist.md` 对本次变更范围自检：未新增 Agent、Workflow、状态分支或跨 Skill 调用；确定性路径/Schema 校验留在脚本，SKILL 只调整调用契约，未改变 Gate 覆盖边界。未发现新增 R1–R8、S1–S12、X1–X6 违例。

## 5. 存量只读盘点与迁移状态

方案阶段 0 对隔离工作区 `1022_test` 的只读盘点为：`backlog=2`，`todo/in_progress/analysis_review/in_review/blocked=0`；已扫描范围内未发现旧 `df-*` PR Facts，未执行 metadata 写入。因此该工作区本次已知的待迁移数量为 **0**，不代表其他工作区已完成盘点。

新增迁移工具目前只经过语法、`--help`、纯函数和 fake CLI 验证。**尚未对真实工作区运行该工具的 dry-run，也未执行 apply。**

## 6. 未执行事项与后续门禁

本次未执行：

- 真实存量 metadata dry-run/apply、平台备份或 Autopilot 暂停/恢复；
- 本方案变更后的正式 `provision-workspace.ts`、正式 `sync-workspace.ts` 或平台 reconcile；
- Analysis → Development → PR → PR Status Sync → Finalize 的真实隔离 E2E；
- Git commit/push，源仓资产清理，业务仓或 TFS 修改。

后续必须按方案顺序独立授权：平台备份并冻结相关写入 → 真实 migration dry-run 审查 →（单独确认）apply 与回读 → 隔离工作区 provision/sync 预演及发布 → 平台 hash 复核 → 隔离 E2E → 确认无 UNKNOWN 和旧键后再恢复自动写入。任一阶段失败不得由后续阶段掩盖。
