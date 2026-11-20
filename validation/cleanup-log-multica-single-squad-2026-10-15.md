---
title: Multica Single-Squad PoC Cleanup Log (2026-10-15)
contract: multica-single-squad-poc
status: closed
date: 2026-10-15
created_at: 2026-10-15
updated_at: 2026-10-15
owner: winning\li_lei
related_workspace: multica-single-squad (cabca166-0b02-4551-8ce6-b8a2bb5b39b6)
related_squad: acff463b-1fed-4cae-b6dd-16731a53c9e1 (archived)
related_projects:
  - 9aa7f581-0a55-4562-a8b1-41d19406a188 (deleted)
  - ff3d8c17-0e4e-49cd-ba48-c6772bc095e2 (deleted)
related_issues: [MS-1, MS-2, MS-3, MS-4, MS-5, MS-6, MS-7, MS-8, MS-9]
result_doc: projects/multica/validation/single-squad-multi-runtime-result-2026-10-14.md
flow_doc: projects/multica/validation/flow-2026-10-15/p01-p02-multi-backend-routing-flow.md
---

# Multica Single-Squad PoC Cleanup Log (2026-10-15)

User-requested cleanup after 2026-10-14 / 2026-10-15 PoC validation of
`docs/multica/validation/single-squad-multi-runtime-poc.md` v1.1.0. Scope per
explicit user approval:

1. **保留验证的报告和结论** — 两个核心文档原样留存
2. **撤销两个 PoC commit + 删除 5 个 `openspec/changes/poc-900xxx/` 目录**
3. **删除 Squad / 两个 Project / 把 9 个 Issue 翻到 `cancelled`**
4. **Workspace 元数据标记为 `[CLEANED ...]`**(CLI 不支持 `workspace delete`)

所有操作都限定在 PoC 工作区 / 隔离资源,**没有改动 01–07 / 旧多 Squad 设计 /
正式 Agent / Skill / Runtime / TFS Issue**,也没有 push 到真实 TFS
(`tfs2018-web.winning.com.cn`)。

## 1. 保留的物(报告 + 结论)

| 文件 | 行数 | 说明 |
|---|---|---|
| `docs/multica/validation/single-squad-multi-runtime-result-2026-10-14.md` | 128 | 主结果文档,含全部 Case 结果表、G1–G4 决策门、关键观察、P09-P11 跨机 OpenSpec + Finalize 详细链路 |
| `docs/multica/validation/flow-2026-10-15/p01-p02-multi-backend-routing-flow.md` | 187 | P01 / P02 Lead 派工流程文档(时序 + 决策机制 + 决策树) |
| `docs/multica/validation/cleanup-log-multica-single-squad-2026-10-15.md`(本文件) | — | 清理记录 |

三份文件全部以 **untracked** 状态留在工作树:
- 不进 commit history
- 不污染 `fire` 分支起点
- 任何 `git status --porcelain` 都能看到它们

`git rev-parse HEAD` 仍是 `0864e2c4 single-squad-multi-agent-runtime-design`,
与 `origin/fire` 一致。

## 2. 平台对象 — 清理结果

### 2.1 9 个 Issue 全部 cancelled

| Issue | 旧状态 | 终态 | Cleanup comment id |
|---|---|---|---|
| MS-1 (TFS-900001) | in_review | cancelled | `01a13d78-c416-...` |
| MS-2 (TFS-900002) | in_review | cancelled | `01a13d78-c790-...` |
| MS-3 (TFS-900003) | in_review | cancelled | `01a13d78-cadc-...` |
| MS-4 (TFS-900004) | in_review | cancelled | `01a13d78-ce45-...` |
| MS-5 (TFS-900005) | in_review | cancelled | `01a13d78-d1bc-...` |
| MS-6 (TFS-900006) | in_review | cancelled | `01a13d78-d520-...` |
| MS-7 (TFS-900007) | in_review | cancelled | `01a13d78-d87b-...` |
| MS-8 (TFS-900008) | blocked | cancelled | `01a13d78-dbdf-...` |
| MS-9 (TFS-900009) | in_review | cancelled | `01a13d78-df1c-...` |

每条 cleanup comment 文本一致,都指引到结果文档和流程文档的相对路径。

### 2.2 两个 Project 全部 delete

- `9aa7f581-0a55-4562-a8b1-41d19406a188`(`winning-platform-monorepo`,Linux) → `Project ... deleted.`
- `ff3d8c17-0e4e-49cd-ba48-c6772bc095e2`(`winning-platform-monorepo-fire`,Windows) → `Project ... deleted.`
- 复检 `multica project list` 返回 `[]`

### 2.3 Squad 归档

- `acff463b-1fed-4cae-b6dd-16731a53c9e1`(`PoC Squad (multica-single-squad)`) → `{"deleted": true}`
- 复检 `multica squad list` 返回 `[]`

### 2.4 Workspace 元数据

CLI **不支持 `workspace delete`**(只暴露 `get / list / create / update / switch / mcp / member`)。
沿用 2026-10-14 S11 PoC cleanup log 的处理方式 — 改 name + description 让 reviewer
一眼看出 PoC 已关闭:

- **name**: `multica-single-squad [CLEANED 2026-10-15: 9 PoC issues cancelled, squad archived, projects deleted, results retained at docs/multica/validation/]`
- **description**: `PoC closed 2026-10-15. Result doc: docs/multica/validation/single-squad-multi-runtime-result-2026-10-14.md (128 lines). Flow doc: docs/multica/validation/flow-2026-10-15/p01-p02-multi-backend-routing-flow.md (187 lines).`
- **id / slug / issue_prefix** 不变(id = `cabca166-0b02-4551-8ce6-b8a2bb5b39b6`)

Workspace 本身的对象记录会保留(直到平台自动 archive 策略触发),但语义上已
无法再触发任何 leader / worker run(没有 project 资源、没有 squad、没有 in_progress issue)。

## 3. Git 工作树 — 清理结果

### 3.1 Linux 端(/root/winning-platform-monorepo/)

- `fire` HEAD 从 `c2c1bda3 POC F (TFS-900006)` 通过 `git reset --hard 0864e2c4` 回到 `0864e2c4 single-squad-multi-agent-runtime-design`
- `openspec/changes/poc-900006/`(MS-6 / AL01 scaffold 4 个文件)→ `rm -rf`
- `git reflog` 仍能查到 `c2c1bda3` 与之前存在的 `9d09ad4f` 影子(对象未 gc),如需彻底消除可 `git reflog expire --expire=now --all && git gc --prune=now --aggressive`——本轮**不**自动跑(因为这是不可逆操作,SOP 鼓励保留 reflog 以防"再撤销")

### 3.2 Windows 端 — 留给 lileipc 那台机器

Windows 端(lileipc runtime `d1de152c-...`,daemon `01a01965-...`)的 in_place 工作树
在 `D:\UserProgram\winning-platform-monorepo-fire` 上,PoC 期间在 `fire` 上产生过:

- 4 个 untracked 目录:`openspec/changes/poc-900001/`、`poc-900003/`、`poc-900004/`(未提交)和
  `poc-900005/`(已被 AL02 在 MS-7 时本地 commit 到 `9d09ad4f`)
- 1 个 PoC commit:`9d09ad4f762456320e750df3c5974a06250efcac`(P09 approve+commit baseline)

**这些清理操作不能在 Linux 这一侧完成**,因为 Linux 端的工作树既看不到 Windows 的
untracked 目录(没 push),也看不到 Windows 的 commit `9d09ad4f` 的存在(Linux
本地 commit graph 也没有这个对象)。需要由 Windows 上的 lileipc daemon 端(或
人工在 lileipc 上)执行对等清理:

```powershell
# 在 lileipc Windows 端:
cd D:\UserProgram\winning-platform-monorepo-fire
git status --porcelain
# 预期看到 4 个 ?? openspec/changes/poc-90000{1,3,4,5}\

git reset --hard 0864e2c4        # 撤销 9d09ad4f,回到 origin/fire 起点
Remove-Item -Recurse -Force openspec/changes/poc-900001
Remove-Item -Recurse -Force openspec/changes/poc-900003
Remove-Item -Recurse -Force openspec/changes/poc-900004
Remove-Item -Recurse -Force openspec/changes/poc-900005
git status --porcelain          # 预期为空
```

本轮在 Linux 端**没有**做这条操作,因为无法触达 Windows 工作树。等 lileipc 那台
机器的 cleanup 由对应 owner 执行。

## 4. 保留 / 清理的对应关系

| 类别 | 保留 | 清理 |
|---|---|---|
| 结果文档(本仓 `docs/`) | 2 份 + cleanup log | — |
| 平台 issue | — | 9 条 cancelled |
| 平台 project | — | 2 个 deleted |
| 平台 squad | — | 1 个 archived |
| 平台 workspace | 元数据标 `[CLEANED ...]`,description 指向结果文档 | (CLI 不支持 delete) |
| Git commit(Linux) | `0864e2c4` 起点不变 | 撤销 `c2c1bda3` |
| Git commit(Windows) | — | 待 lileipc 端撤销 `9d09ad4f` |
| Git 工作树 `poc-900006/`(Linux) | — | 删除 |
| Git 工作树 `poc-900001/003/004/005/`(Windows) | — | 待 lileipc 端删除 |
| 真实 TFS 推送 | 从未发生 | 仍未发生(`origin/fire` = `0864e2c4`,两边本地均领先但未 push) |
| 01–07 / 旧多 Squad 设计 / 正式 Agent | 未触碰 | 未触碰 |

## 5. 安全规则遵守

- ✅ 真实 TFS 推送:0 次(从 PoC 起到现在)
- ✅ 真实业务仓:未触达
- ✅ 01–07 文档:未修改
- ✅ Multica 正式 Skill / Runtime / Agent / Squad 配置:未修改
- ✅ Platform 资源清理走的是 `multica project delete` / `multica squad delete`(归档)/ `multica issue status cancelled` CLI,无任何直接 DB / 文件系统操作
- ✅ reflog / git history 中的 `9d09ad4f` / `c2c1bda3` 对象未主动 gc 清除,留一条 "再撤销" 余地
- ✅ 结果文档与流程文档保留 untracked,不污染 `fire` 分支
- ✅ 未 kill 任何 `multica` 守护进程(daemon 仍 `running`)
