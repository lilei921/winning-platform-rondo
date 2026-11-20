# Multica 资产迁移记录（2026-10-22）

## 1. 迁移基线

- 方案：`plans/multica-assets-migration-to-monorepo-plan.md`（源仓）。
- 源仓：`D:\WN_Platform\works\gitee_repos\multica`。
- 源分支 / Commit：`dev_1020` / `3be022637cb605d5a84e661ee9cba9cb6648d196`。
- 目标仓：`D:\WN_Platform\works\win60_repos\DF\winning-platform-monorepo`。
- 目标分支 / Commit：`multica` / `f0aced151d215f935f52dddd532ee6f137242e4a`。
- 迁移范围：`agents/`、`squads/`、`scripts/`、`workspace-skills/` 共 71 个 Git 跟踪文件，以及 `docs/` 的 25 个配套文档。
- 未迁移：源仓忽略配置、`.git/`、`.claude/`、探针数据、本地凭证和 `services/`。

## 2. 原有资产保护

迁移前记录目标原有 18 个 `scripts/`、`workspace-skills/` 跟踪文件的 SHA-256。

迁移后验证结果：

- 旧 `workspace-skills/tfs-sync/` 的 13 个文件已整体移动至 `archive/legacy-workspace-skills/tfs-sync/`，内容 hash 全部不变。
- `scripts/export_multica_workspace.py` 保持原路径、原内容。
- `codebase-explorer/`、`workitem-triage/`、`multica-workspace-bootstrap/` 保持原路径、原内容。
- 目标原有 18 个文件全部能够在原路径或约定的归档路径通过 hash 校验。
- 根仓 `.gitignore`、`CLAUDE.md`、`AGENTS.md` 以及 `projects/multica/README.md`、既有顶层文档、`.agents/`、`managed-skills/`、`workspace-export/`、`validation/` 均未修改。
- `projects/multica` 之外没有 tracked diff。

归档说明见 `archive/legacy-workspace-skills/README.md`。

## 3. 迁移适配

### 显式受管 Skill

在新迁入的 `workspace-skills/_shared/provisioning.json` 中增加 `managed_skills`，仅登记以下 11 个新流水线 Skill：

```text
analysis-completion
backend-engineering
delivery-flow
delivery-gate
development-execution
finalize-delivery
frontend-engineering
pr-status-sync
pull-request
tfs-sync
workitem-analysis
```

新迁入的 `scripts/provision-workspace.ts` 已改为只供给该清单，不再按 `workspace-skills/` 目录自动扩大管理范围。清单包含名称合法性、重复项和 `SKILL.md` 存在性校验；Agent 绑定的 Skill 必须全部在清单内。

目标原有的三个非冲突 Skill 不进入新供给范围；平台多出的对象仍只报告为 `unmanaged_remote`，不自动删除。

### 局部忽略规则

新增 `projects/multica/.gitignore`，只忽略六份由 `sync-workspace.ts` 生成的本地配置，不修改 monorepo 根 `.gitignore`。

### 文档

源仓 25 个 `docs/` 跟踪文档已迁入 `projects/multica/docs/`，未覆盖或修改目标顶层既有文档。两套文档本次不做语义合并。

## 4. 本地验证结果

| 检查 | 结果 |
| --- | --- |
| 源资产 hash | 69 个文件与源仓一致；仅 `provision-workspace.ts`、`provisioning.json` 存在方案内适配 |
| 配套文档 hash | 25 / 25 一致 |
| 目标原有资产 hash | 18 / 18 一致，其中旧 `tfs-sync` 13 个文件位于归档路径 |
| TypeScript 语法 | 16 / 16 通过 `node --check` |
| JSON 解析 | 7 / 7 通过 |
| `managed_skills` | 11 项，无重复、无缺失、Agent 绑定全部覆盖，未包含目标三个原有 Skill |
| 离线 dry-run | PASS，渲染六份配置；三个原有 Skill 仅列入 `skipped_unregistered` |
| 本地渲染 | `--local-only` PASS，六份配置生成成功 |
| 忽略规则 | 六份配置均被 `projects/multica/.gitignore` 正确忽略，tracked status 为空 |
| 渲染幂等 | 第二次 dry-run 六份配置均为“无变化” |

源仓现有渲染配置对应 `beiluoshimen`，本次目标验证使用 `1022_test`；两者比较时只有对应工作区、项目和 Squad ID 不同，不属于迁移内容差异。

## 5. 平台只读预演

执行对象：隔离工作区 `1022_test`。

### provision dry-run

```text
result: PASS
created: []
updated: []
unmanaged_remote: []
overlay_written: false
exit: 0
```

11 个受管 Skill 以及 manifest 中的 Agent、Squad、Project、Autopilot 均为 `unchanged`；未包含目标三个原有 Skill，未执行平台写入或 overlay 写入。

### sync check

```text
result: DRIFT
exit: 2
checked: 11 个受管 Skill
skipped_unregistered:
  - codebase-explorer
  - multica-workspace-bootstrap
  - workitem-triage
```

共检出 21 项平台内容漂移：

- `delivery-flow`：5 项；
- `development-execution`：3 项；
- `finalize-delivery`：3 项；
- `pr-status-sync`：3 项；
- `pull-request`：4 项；
- `workitem-analysis`：3 项，其中 `config/repo-registry.json` 和 `scripts/resolve-root-repo.ts` 在平台缺失。

这些漂移是迁入本地资产与平台当前内容之间的差异，留待独立发布阶段审查和收敛。本次只执行 `list` / `get` 等只读命令，未运行正式 `provision-workspace.ts` 或 `sync-workspace.ts`，未修改平台。

## 6. 本次未执行

- 未执行 Multica 平台创建、更新、删除或 Skill 文件 reconcile。
- 未执行 TFS / Delivery E2E。
- 未删除或清理源仓资产。
- 未提交或推送任何 Git 变更。

## 7. 后续发布边界

正式发布前需单独确认，并先备份平台状态、审查上述 21 项漂移。正式同步新版 `tfs-sync` 时，reconcile 可能删除远端旧 Python 文件；该行为不属于本次本地迁移，未在本次执行。
