---
name: rondo-sync
description: Use when synchronizing Multica workspace assets — Skill、Agent、Squad、Project、Autopilot、MCP、workspace 仓库注册表、Project Resource label — into the winning-* workspaces that the admin user belongs to, or into explicitly named workspaces. 触发词：同步 workspace、同步 agent 和 skill、把 skill 同步到 workspace、Multica 同步、provision workspace、设置 Project Resource label。
metadata:
  author: winning\li_lei
  version: 1.9.0
---

# Multica Workspace Sync

把仓内 `workspace-config/provisioning.json` 声明、由 `skills/` `agents/` `squads/` `mcps/` 承载的 Multica 资产供给到目标 workspace，并回读校验同步结果。

## 何时使用

- 需要把仓内 Skill / Agent / Squad / Project / Autopilot 同步到 admin 所属的 `winning-*` workspace。
- 需要把上述资产同步到个别指定 workspace。
- 需要确认某 workspace 的 Skill 文件与 Agent 绑定是否与仓内一致。
- 需要为 workspace 的 Agent 补齐 TFS 环境变量（TFS_URL / TFS_COLLECTION / TFS_PAT）。
- 需要为 workspace 供给 workspace 级仓库注册表（`multica repo add`，只增不维护）。
- 需要按 `docs/config/project-resources.yaml` 的 label 对齐当前 Project 中仓库 Resource 的 label。
- 需要回读校验一批 workspace 的 MCP / 仓库注册表 / Project / Project Resource label / Agent / Skill / Squad / Autopilot / runtime 绑定是否与 manifest 一致（`check_workspaces.py`，只读）。

不适用：修改仓内 Skill 内容本身（改 `skills/` 后再走本流程）、Issue 派发与交付流程（在 Multica 内由 Squad 与 Skill 负责）、业务子仓开发。

## 目标 workspace 的确定

默认目标 = **成员包含 admin、且 slug 以 `winning-` 开头的全部 workspace**。发现方式：

1. `multica workspace list` 取全部可见 workspace；
2. 按 slug 前缀筛选；
3. 逐个 `multica workspace member list`，命中成员 name 或 email 为 admin 的即为目标。

目标清单与成员角色以本次 CLI 查询为准，不沿用历史 workspace 数量。

指定 workspace 名称、成员或前缀时按参数覆盖：

| 参数 | 默认 | 用途 |
| --- | --- | --- |
| 位置参数 | 空 | 显式给出 workspace 名称，覆盖自动发现 |
| `--member` | `admin` | 按成员名或邮箱筛选；也可传 `ydx` 等同事账号 |
| `--prefix` | `winning-` | slug 前缀筛选；传空字符串关闭 |

## 前置条件

| 条件 | 不满足时 |
| --- | --- |
| `multica` CLI 已安装并 `multica login` | 停止，提示先登录 |
| 本机有 `npm`，且 `<repo>/rondo/package.json` 存在 | 同步脚本默认先打包并全局安装 rondo（见「执行」步骤 0）；缺失或失败会在写平台前停止 |
| Python ≥ 3.7 且当前解释器已安装 PyYAML | Windows 通常用 `python -m pip install PyYAML`，Linux 通常用 `python3 -m pip install PyYAML`；Rondo 复用启动同步脚本的解释器 |
| 目标 workspace 已存在且有 runtime | runtime 是 workspace 级对象，需先在该 workspace 启动 daemon 注册 |
| manifest 含 `mcp_servers` 时：当前账号在目标 workspace 为 owner/admin，或可按下文临时提权 | member 角色会在 MCP 供给处失败，见「MCP 供给权限」 |

## 执行

本 Skill 随仓分发在 `.claude/skills/rondo-sync/`。在 Windows 的 PowerShell 中，从仓库根目录执行：

```powershell
python .claude/skills/rondo-sync/scripts/sync_workspace.py
```

Linux 上将本页命令中的 `python` 替换为 `python3`。Skill 正文和附属文件使用 UTF-8 保存，同步时统一为无 BOM、LF 换行的文本。

同步默认以 **打包 → 全局安装 → 清理 shim** 开始，确保各 workspace 的 Agent 使用最新的全局 `rondo`：在 `rondo/` 执行 `npm pack --silent` 与 `npm install -g <tarball>`，再用 `npm prefix -g` 定位全局目录并删除 `rondo.ps1`（仅 Windows，文件不存在则跳过；非 Windows 不执行删除）。前置步骤失败会在写平台前整体停止；`--dry-run` 只打印计划，不打包、不安装、不删除。脚本自身执行 provision / sync 时仍优先使用本仓 `rondo/dist/index.js`（打包经 `prepack` 会重新构建）。

仓库路径只在本次运行中确定，不要求用户配置全局变量：

1. 用户提供路径时，用 `--repo-root <仓库根目录>`；否则先从当前目录上溯，再尝试脚本目录上溯，以 `workspace-config/provisioning.json` 为标记。
2. 无法定位时，**询问用户仓库根目录路径**，收到后通过 `--repo-root` 传入；不要要求用户设置 `MULTICA_REPO_ROOT`。
3. 输入路径无效时提示重新输入，不回落到其他仓库。调用 Rondo 时以选定仓库为工作目录，并屏蔽子进程继承的旧 `MULTICA_REPO_ROOT`，不修改用户的环境变量。

显式输入路径的示例（也适用于 check / 仓库注册表脚本）：

```powershell
python .claude/skills/rondo-sync/scripts/sync_workspace.py winning-lfw --repo-root "D:/ai-project/winning-platform-rondo" --dry-run
```

常用参数：

| 参数 | 用途 |
| --- | --- |
| `--repo-root <路径>` | 本次使用的仓库根目录；路径未知时先询问用户 |
| `--member <name/email>` | 改用其他成员筛选 workspace |
| `--prefix <前缀>` | 改用其他 slug 前缀 |
| `--runtime-id <uuid>` | 固定 runtime；缺省时沿用该 workspace 既有 Agent 的绑定，无既有绑定时在在线 runtime 中随机取一个 |
| `--disable-runtime-skills <auto\|always\|never>` | 禁用 runtime 继承 Skill 的策略，默认 `auto`（对所有绑定 workspace 内 runtime 的 Agent 执行，含同事机器） |
| `--discovery-timeout <秒>` | runtime skill 发现超时，默认 120 秒 |
| `--skip-workflow` | （默认开启）provision 跳过 workflow 检查与状态供给；97 服务端无 workflow API，必须保持跳过 |
| `--with-workflow` | 恢复 workflow 检查与状态供给；仅在服务端支持 workflow API 时使用 |
| `--skip-tfs-env` | 跳过默认的 Agent TFS 环境变量补齐步骤 |
| `--skip-repos` | 跳过默认的 workspace 仓库注册表供给步骤 |
| `--skip-resource-labels` | 跳过默认的 Project Resource label 对齐步骤 |
| `--dry-run` | 只预演，不打包/安装、不写平台与仓内 overlay |

执行同步前先完成一次全局前置步骤（面向所有 workspace，失败则整体停止）：

0. **打包与全局安装 rondo** — 在 `rondo/` 执行 `npm pack --silent` 与 `npm install -g <tarball>`，并通过 `npm prefix -g` 定位全局目录、删除 `rondo.ps1`（仅 Windows）。

每个 workspace 依次执行下列步骤，任一步失败即停止该 workspace 并计入失败数，其余 workspace 继续：

1. **provision**（`rondo workspace provision`，默认带 `--skip-workflow`）— 供给 Skill / Agent / Squad / Project / Autopilot 对象，并把解析到的对象 ID 写入 `workspace-config/workspaces/<name>.json` overlay。Rondo 按 workspace slug 在内存中合并分组 Project / MCP 配置，不改写共享 manifest。
2. **sync**（`rondo workspace sync`）— 按 Workspace overlay 渲染 TFS 同步配置，upsert Skill 文件并逐文件回读校验。
3. **绑定 Agent runtime**（仅当显式传入 `--runtime-id`）— provision 只在**新建** Agent 时使用 `--runtime-id`，已存在的 Agent 保留原 runtime；显式指定 runtime 时必须额外改绑，否则该参数对已供给的 workspace 无效。
4. **禁用 runtime skills** — 关闭 Agent 从 runtime 继承的本地 Skill，避免与仓内 Skill 重复暴露；覆盖所有绑定 workspace 内 runtime 的 Agent（含同事机器），先预览再落盘。是否执行见下节。
5. **补齐 Agent TFS 环境变量**（`provision_agent_tfs_env.py`）— 为全部 Agent 补齐 `TFS_URL` / `TFS_COLLECTION` / `TFS_PAT`，只增不改；规则与凭据红线见下节。`--dry-run` 会透传给该步骤；`--skip-tfs-env` 可整体跳过。
6. **供给 workspace 仓库注册表**（`provision_workspace_repos.py`）— 按 manifest 的 `workspace_repos` 段执行 `multica repo add`，只增不维护；`--dry-run` 会透传；`--skip-repos` 可整体跳过。
7. **对齐 Project Resource label**（`provision_project_resource_labels.py`）— 按 `docs/config/project-resources.yaml` 的 `label` 设置目标 Project 中匹配仓库的 `github_repo` Resource；全量对齐、写入后回读；`--dry-run` 会透传；`--skip-resource-labels` 可整体跳过。

同步不再设置 `RONDO_WORKSPACE_PATH` 和 `RONDO_WORKSPACE_BRANCH`，也不主动删除 Agent 已有的这两个配置。

## workspace 分组

`provisioning.json` 的 `workspace_groups` 段按 workspace slug 分组，决定各组的**默认 Project** 与**仓库注册表**：

- `df`：winning-lilei / lnn / lbs / ydx / dengkai / dangbo / lfw / lwm / lintao。Project `winning-platform-monorepo`，仓库为同名 monorepo（分支 main）。df 即顶层默认值，组内不再重复声明。
- `bi`：winning-heyan / zqa / hxg / wangyue / lyf5。组内覆盖 Project `winning-base-winex-bi-monorepo` 与同名仓库（分支 main）。
- 未分组 workspace（如 winning-admin、winning-dps-df）一律回落顶层默认（df）。

生效机制：

- **Project**：Rondo provision 以 `--slug`（未传时用 `--workspace`）匹配分组，将组 `project` 覆盖到顶层默认；未覆盖的 `workspace_branch` 等字段继续继承。共享 manifest 全程不改写。旧版遗留的 `provisioning.json.group-swap.bak` 在正式同步启动时恢复；`--dry-run` 遇到该备份会停止并提示先恢复，保持零写入。
- **MCP**：组 `mcp_servers` 替换顶层清单，组条目的 `connection_file` 替换模板默认连接引用；显式 workspace overlay 的连接引用优先级最高。连接仍从 `mcps/connections/*.local.json` 读取，工具白名单与批准策略仍由共享模板决定。
- **仓库注册表**：`provision_workspace_repos.py` 按 slug 解析分组，组的 `workspace_repos` 覆盖顶层默认，只增不维护。

## workspace 仓库注册表供给

主同步流水线的默认步骤（每个 workspace 最后执行）；也可单独按需执行：

```bash
python .claude/skills/rondo-sync/scripts/provision_workspace_repos.py [workspace] [--dry-run]
# 默认目标 winning-admin
```

规则：

- **只增不维护**：URL 已存在于 workspace 仓库注册表（`multica repo list`）时视为已配置，一律保留原描述不更新、不改动；仅补注册表中不存在的 URL。纠错场景先 `multica repo remove` 再重跑本步骤。
- **声明来源**：`workspace-config/provisioning.json` 的 `workspace_repos` 段（顶层默认，即 df 组）与 `workspace_groups.<组>.workspace_repos`（组覆盖，如 bi）；两者都缺或为空则整步跳过，向后兼容。
- 命令通过 `MULTICA_WORKSPACE_ID` 定向目标 workspace，不改动 CLI 默认工作区。
- 写入后回读 `multica repo list` 校验 URL 已进入注册表。
- **`multica repo add` 与 `workspace mcp add` 同为 owner/admin 级操作**：同事 workspace 里 admin 只有 member 角色时会被 403（`You do not have permission...`），处置方式与「MCP 供给权限」节相同（owner 本人执行，或临时提权后立即还原）。

## Project Resource label 供给

主同步流水线的默认步骤（每个 workspace 最后执行）；也可单独按需执行：

```bash
python .claude/skills/rondo-sync/scripts/provision_project_resource_labels.py winning-lilei
python .claude/skills/rondo-sync/scripts/provision_project_resource_labels.py winning-lilei --dry-run
# 默认目标 winning-admin
```

规则：

- **声明来源**：`docs/config/project-resources.yaml` 的 `repos[]`，`repo_url` → `label`；缺文件、缺字段或同一 URL 对应不同 label 时停止该步骤，不猜测。
- **Project 定位**：按 workspace slug 解析 `provisioning.json` 的分组 `project.title`（组覆盖顶层默认），在目标 workspace 内按标题精确匹配；项目不存在则停止（先由 provision 创建），不新建项目。
- **匹配范围**：仅 `resource_type=github_repo` 且 `resource_ref.url` 与 `repo_url` 精确相等（仅忽略首尾空白与尾部 `/`）的 Resource；非仓库类型或 URL 未命中者只 `[INFO]`，不改。
- **全量对齐**：label 与 YAML 不一致即执行 `multica project resource update <project-id> <resource-id> --label <label>`，包含覆盖已有手写 label；一致则 `[SKIP]`。不新增/删除 Resource，不改 `ref`、`default_branch_hint`、`position`。
- 写命令不重试；有写入时统一回读 `multica project resource list` 一次校验，未命中记 `[FAIL]` 并使该步骤退出码非零（主流水线按 per-workspace 失败计数）。
- **`project resource update` 与 `repo add` 同为 owner/admin 级操作**；同事 workspace 权限不足时按「MCP 供给权限」节处理，不要盲目重试。
- 业务语义知识的唯一维护源仍是 codebase-explorer 的 `references/repository-context.md`，label 只是仓库清单的确定性摘要，不承载额外语义契约。

## Agent TFS 环境变量供给

主同步流水线的默认步骤（每个 workspace 最后执行）；也可单独按需执行：

```bash
python .claude/skills/rondo-sync/scripts/provision_agent_tfs_env.py [workspace] [--dry-run]
# 默认目标 winning-admin
```

规则：

- **只增不改**：TFS 键一旦在 Agent `custom_env` 中存在（无论值是什么，包括空字符串），即视为用户已配置，一律保留原值不改动，仅补不存在的键；三键都存在的 Agent 直接 `[SKIP]`。既有非 TFS 键不受影响。纠错场景用 `--force-tfs-pat` 仅重写 TFS_PAT 为策略值，需明确意图。
- **取值来源**：
  - `TFS_URL` = `http://tfs2018-web.winning.com.cn:8080/tfs`（base，不含 collection）
  - `TFS_COLLECTION` = `WN_Data_Platform`
  - `TFS_PAT` 按 workspace 区分：先查本机 `config/tfs-pat.yaml` 的 `pats` 表，按 `winning-<owner>` 取该 owner 自己的 PAT（非标准 slug 仅按脚本中的显式别名映射）；未登记时，`winning-admin` / `winning-lilei` 回退本机 Git extraheader，其他 workspace 用占位值 `not config`。
- **凭据红线**：不得把本机 Git PAT 下发到同事 workspace；不使用 Multica 登录 token 冒充 TFS PAT。真实值仅从本机不入库的 PAT 配置或 Git 凭据读取，经 `--custom-env-stdin` 管道传递，不打印、不进命令行、不写 overlay。
- 写入后逐 Agent 回读校验，只比对键与值是否生效，不输出值。
- 权限与 `env set` 一致（agent owner 或 workspace owner/admin）；同事 workspace 遇 403 时按「MCP 供给权限」节的提权/转交思路处理，不要盲目重试。

## MCP 供给权限

manifest 登记 `mcp_servers` 时，provision 会自动按模板供给 workspace MCP 并绑定到 Agent（同事 workspace 配什么 MCP 不逐个问）。两个前提：

- 模板在 `mcps/*.json`，连接凭据在 `mcps/connections/*.local.json`；后者不进 Git，必须在执行机上预先备齐。
- **`workspace mcp add` 是 owner/admin 级操作**。同事 workspace 里 admin 只有 member 角色，MCP 供给会被服务端 403 拒绝，且 rondo 会脱敏报成 `UNKNOWN: MCP <name> 创建 结果未知`。看到该报错先手动重跑对应 `multica workspace mcp add` 确认真实原因，不要盲目重试。

处置方式二选一：

1. **由 workspace owner 本人执行**：把 `mcps/connections/*.local.json` 交给 owner，在其账号下跑 `rondo workspace provision --workspace <name> --mcp-only`。
2. **临时提权**（有平台 DB 访问权、且在本机即服务端时）：把执行账号在目标 workspace 的角色提为 `admin`，供给完成后**立即还原为 member 并回读确认**：

```bash
# 提权 / 还原（role 取值 admin ↔ member）
psql -U multica -h 127.0.0.1 -d multica -c \
  "update member set role='<role>' where workspace_id=(select id from workspace where slug='<workspace>')
   and user_id=(select id from \"user\" where email='<执行账号邮箱>') returning role;"
```

DB 口令从服务端进程环境取（`POSTGRES_PASSWORD`）。提权窗口只覆盖本次供给，不得留作常态；无 DB 权限时走方式 1，不要绕过。

## runtime 归属与禁用范围

Agent 绑定的是**某台机器的** runtime，workspace 里可同时存在多台同事机器的 runtime。禁用 runtime skills 作用于各 Agent 实际绑定的 runtime，不是本次选中的那个——某台机器上装了几百个本地 Skill 时，禁用数量会随之放大。

**不区分 runtime 所在设备**：同事机器上的本地 Skill 同样会与仓内供给的 Skill 重复暴露，因此在 Agent 侧统一禁用；该操作只改 Agent 的禁用列表，不删改 runtime 机器上的文件。按 `--disable-runtime-skills auto`（默认）：

| Agent 绑定的 runtime 所在设备 | 是否禁用 |
| --- | --- |
| 本机（hostname 相同） | 执行 |
| 其他同事的机器 | 执行 |
| 全部绑定均已从 workspace 消失 | 跳过禁用，并打印 `[WARN]`；单个失效绑定由禁用脚本自行跳过 |

跳过时输出形如 `[SKIP] 禁用 runtime skills：Agent 绑定的 runtime 均已不在该 workspace，跳过禁用`。

需要无条件执行或彻底关闭时用 `--disable-runtime-skills always|never`。

同理，缺省不改动既有 Agent 的绑定；确需换绑时显式传 `--runtime-id`。

## 状态校验（check）

`check_workspaces.py` 把「校验」节的全部人工核对项自动化，只读回读、不写平台与仓内文件；
发现口径与主同步一致（缺省 = 成员含 admin 的 `winning-*`，支持位置参数 / `--member` / `--prefix`）：

```bash
python .claude/skills/rondo-sync/scripts/check_workspaces.py                # 全部目标 workspace
python .claude/skills/rondo-sync/scripts/check_workspaces.py winning-lfw    # 指定 workspace
```

校验维度与基准（`provisioning.json`，组覆盖优先于顶层默认）：

- **MCP**：`multica workspace mcp list` 与 manifest `mcp_servers`（组 `mcp_servers` 覆盖顶层）名称一致。
- **仓库注册表**：manifest `workspace_repos` 声明的 URL 均在 `multica repo list` 中；多余项只 `[INFO]`（只增不维护，不视为失败）。
- **Project**：分组 `project.title` 对应项目存在，且资源命中声明仓库——git URL 精确匹配，或 `local_directory` 的 label / local_path 含仓库名（本地路径资源判 OK，类型不符判 `[WARN]`，无资源判 `[FAIL]`）。
- **Project Resource label**：命中 `docs/config/project-resources.yaml` URL 的 `github_repo` 资源，label 必须与清单一致；不一致判 `[FAIL]`，未命中清单的资源不要求有 label。
- **Agent**：manifest `agents[]` 齐全、各 Agent Skill 绑定与 manifest 一致、`custom_env_key_count` ≥ 3（TFS 三键）。
- **runtime**：绑定失效（runtime 已不在 workspace）判 `[FAIL]`；分散绑定多个 runtime、绑定 runtime 离线判 `[WARN]`。
- **Skill**：`managed_skills` 均在册；多余（如历史残留的 `workitem-analysis`）只 `[INFO]`。
- **Squad**：`Delivery Squad` 存在且成员数 = `squad.members` + leader。
- **Autopilot**：manifest `autopilots` 均在且 active；无 trigger 属 MG-5 设计，不报警。

分级语义：`[OK]` 一致；`[INFO]` 多余项（owner 自有资产，不回滚）；`[WARN]` 可用性风险（runtime 离线、绑定分散、TFS 键不足、Squad 成员数不符）；`[FAIL]` 与 manifest 不一致。任一 `[FAIL]`/`[ERROR]` 该 workspace 计入失败，退出码非零，结尾汇总失败 / 仅告警 / 全通过清单。

## 校验

同步后回读目标 workspace，与其他已同步 workspace 对齐（以下逐项已由 `check_workspaces.py` 自动化，见「状态校验（check）」节）：

- Agent 数量与 `workspace-config/provisioning.json` 的 `agents[]` 一致，且 Skill 绑定数一致。
- 所有 Agent 绑定同一 runtime。
- workspace Skill 数量与 `managed_skills` 一致。
- `Delivery Squad` 存在，成员数与 `squad.members` + leader 一致。
- Project 标题符合分组：bi 组 workspace 为 `winning-base-winex-bi-monorepo`，其余（含未分组）为顶层默认 `winning-platform-monorepo`；同步期间共享 manifest 保持原文（不生成 `.group-swap.bak`）。
- manifest 含 `mcp_servers` 时：`multica workspace mcp list <name>` 数量与 manifest 一致；MCP 完整配置只写不可回读，overlay 中的 `mcp_servers` ID 是唯一本地记录。
- TFS 环境变量步骤输出无 `[FAIL]`：全部 Agent 的 `TFS_URL` / `TFS_COLLECTION` / `TFS_PAT` 三键均已配置（`[SKIP]` 或 `[OK  ]`）。
- 仓库注册表步骤输出无 `[FAIL]`：manifest `workspace_repos` 声明的 URL 均在 `multica repo list` 中（`[SKIP]` 或 `[OK  ]`）。
- Project Resource label 步骤输出无 `[FAIL]`：清单声明且已挂载的 `github_repo` 资源 label 与 `project-resources.yaml` 一致。

overlay 文件是仓内唯一记录平台对象 ID 的位置，随同步产生的新 overlay 必须提交。

## 边界

- 只写目标 workspace 的平台对象与仓内 overlay；不回滚已完成的步骤。
- 不新增/删除 Project Resource，不改 `ref` / `default_branch_hint`；label 更新按仓库清单全量对齐，不写回 `project-resources.yaml`。
- 不修改业务子仓代码，不改仓内 Skill 内容，不触发 Agent Run。
- runtime 必须在目标 workspace 内；跨 workspace 使用别处的 runtime id 会被拒绝。
- 未显式指定 `--runtime-id` 时不改绑既有 Agent 的 runtime，只在新建 Agent 时使用选中的 runtime。
- 禁用 runtime skills 只影响目标 Agent 自身绑定关系，不修改 runtime 机器上的文件；同事机器的 runtime 同样在禁用范围内。
- `skipped_unregistered` 中的 Skill（如 `tfs-writeback`）不在 `managed_skills` 清单内，不供给、不报错。

## 本地验证

修改本 Skill 或同步命令后运行：

```powershell
python -X utf8 -m unittest discover -s .claude/skills/rondo-sync/tests
cd rondo
npm run build
node --test test/workspace-root-layout.test.mjs test/workspace-environment.test.mjs test/workspace-mcp.test.mjs test/d1-analysis-skills.test.mjs dist/clients/required-statuses.test.js
```

这些回归使用临时目录与模拟 CLI，不访问真实平台。用户只要求维护同步能力时，先完成本地验证；实际发布按其指定的 workspace 范围执行。
