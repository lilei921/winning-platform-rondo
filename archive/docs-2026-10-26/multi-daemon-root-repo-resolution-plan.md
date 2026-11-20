# multi-daemon-root-repo-resolution 方案（项目 local_directory 运行时寻址）

> 状态：**全部阶段已实施（2026-10-22，阶段 1 `3800b4d` / 阶段 2 `33b75bb` / 阶段 3+4 见当日本后续 commit）。R-13（Linux 服务器形态）因无 Linux daemon 环境未实测，待首台 Linux daemon 上线时按 §3.10 runbook 验收**。
> 上游权威：`docs/01-…guideline…` / `docs/02-…lifecycle…`（机制与流程）；`docs/multica-delivery-operations-guide.md`（根仓挂载与并发实测）；`docs/workspace-skill-portability-plan.md`（base + overlay 分层）；`docs/agent-skill-review-checklist.md`（Agent/Skill 评审红线）。
> 实证基线：Multica CLI 0.6.4；`project resource list --output json` 已实证返回结构化 `resource_type` / `daemon_id` / `execution_mode` / `local_path`；`winning-dps-df` 已实证为多 daemon 工作区。
> 用户裁定（2026-10-21）：形成完整落地方案，暂不开发。**更新（2026-10-22）：用户裁定按本方案实施阶段 1+2，§11 开放决策点全部采纳建议项**。
> 当前契约修订（2026-10-22）：仓库映射改为根仓 `docs/config/repo-context.yaml`，业务仓为根仓直接子仓，worktree 为 `<root_repo>/.worktrees/<issue>-<repo_id>/`；`RuntimePaths` 不再包含 `reposRoot`。§0–§3 的旧路径背景、分阶段记录和 R 系列实测保留为历史证据，当前路径与配置以本节提示、§4 及 operations guide 为准。

## 0. 背景与定位

当前 `workspace-skills/_shared/repo-registry.base.json` 仍把三个机器路径烘焙为共享 base：

```json
{
  "repos_root": "D:/WN_Platform/works/gitee_repos/multica_spec/repos",
  "openspec_root": "D:/WN_Platform/works/gitee_repos/multica_spec/openspec",
  "root_repo": "D:/WN_Platform/works/gitee_repos/multica_spec"
}
```

该形态在单开发机上可用，但存在三个结构性问题：

1. **双事实源**：平台项目资源已经记录 `local_directory`，base 再写一份机器路径，二者可能漂移；
2. **多 daemon 不可表达**：同一项目在不同 daemon 上路径不同，共享 base 只能保存其中一份；
3. **服务器部署成本高**：换服务器、换根目录都要改 base、重新渲染并同步所有 Skill。

同时，路径解析只解决“当前执行节点如何找到根仓”，不解决跨机器文件同步。完整方案必须同时定义：

- 路径事实源与解析契约；
- 多 daemon 下如何选择当前节点的路径；
- 哪些交付链路允许跨 daemon，哪些必须固定在同一 daemon。

## 1. 概念边界

### 1.1 daemon 与 Runtime

- **daemon**：某台机器上实际运行的 `multica daemon` 后台进程，负责接收任务、启动 Agent、执行 Skill；
- **Runtime**：daemon 按 Agent Provider 注册到平台的执行者记录（Claude / Codex / OMP / OpenClaw 等）。

一个 daemon 可以注册多个 Runtime。判断路径归属必须使用 **`daemon_id`**，不能使用 Runtime ID，也不能按 Runtime 条数推断机器数。

### 1.2 local_directory

`local_directory` 是“项目 + daemon”维度的本地挂载资源：

```text
同一个 Multica 项目
├─ daemon A（Windows 开发机）→ D:\...\multica_spec
└─ daemon B（Linux 服务器）  → /srv/...\multica_spec
```

路径不同是正常形态。平台资源记录的是**当前 daemon 看到的根仓路径**，不是全局唯一路径。

### 1.3 路径派生约定

根仓是唯一路径锚点：

```text
root_repo       = <项目在当前 daemon 上的 local_directory>
openspec_root   = <root_repo>/openspec
repo_context    = <root_repo>/docs/config/repo-context.yaml
hub             = <root_repo>/<repo_path>
worktree        = <root_repo>/.worktrees/<issue>-<repo_id>
finalize_lock   = <root_repo>/.multica/locks/root-finalize.lock
```

这些路径都是目录约定，不是独立事实，不应再作为独立配置项维护；`repo_key = repo_id`，`repo_path` 只从 repo-context 的渲染结果取得。

### 1.4 平台共享与本地状态边界

平台共享：Issue、评论、状态、metadata、对象配置。

平台**不自动共享**：各 daemon 上的 `openspec/`、业务直接子仓、`.worktrees/`、未提交修改、本地锁文件。路径解析正确不代表另一台机器上的交付产物存在。

## 2. 目标

1. **机器路径从 Skill 配置中移除**：最终 `_shared/repo-registry.base.json` 不再包含 `repos_root` / `openspec_root` / `root_repo`；
2. **以平台项目资源为路径事实源**：脚本运行时按 Issue/Project + 当前 daemon 解析 `local_directory`；
3. **多 daemon 可安全部署**：Windows、Linux、Docker 内路径可以不同；脚本不取第一条、不按路径存在性猜测；
4. **目录约定统一派生**：所有消费方从 `root_repo` 派生 `openspec_root`、`repo_context`、业务 hub、`.worktrees` 与 finalize lock；不再派生 `repos_root`；
5. **失败语义明确**：缺项目、缺挂载、daemon 身份不明确、路径无效均 UNKNOWN / exit 3，零写入，不回退到旧开发机路径；
6. **部署边界显式化**：同一交付项目的完整流水线默认固定在同一个交付 daemon；路径解析不伪装成分布式文件同步。

## 3. 实证基线

### 3.1 CLI 查询能力

Multica CLI 0.6.4 已实证：

```bash
multica --workspace-id <workspace-id> project resource list <project-id> --output json
```

返回 `local_directory` 资源：

```json
{
  "resource_type": "local_directory",
  "resource_ref": {
    "daemon_id": "<daemon-id>",
    "execution_mode": "in_place",
    "local_path": "<当前 daemon 上的根仓路径>"
  }
}
```

`project get` 只返回资源数量，不返回路径；路径查询必须使用 `project resource list`。

### 3.2 现有 Run 指针不是长期契约

Run workdir 的 `CLAUDE.md` 资源段包含绝对路径指针，但它是生成文本，不是结构化 API。脚本不得把解析 Markdown 当作长期契约；它只能作为人工排查线索。

### 3.3 多 daemon 实证

`winning-dps-df` 工作区实测：

- 21 条 Runtime 记录；
- 7 个不同 `daemon_id`；
- 当前 3 条 Runtime 在线，归属 2 个 daemon；
- 同一个 daemon 可同时注册 Claude、Codex、OMP、dsh 等多条 Runtime。

因此该工作区不能采用“项目只有一条 local_directory”的简化假设；长期实现必须支持按 `daemon_id` 匹配。

### 3.4 当前路径消费面（2026-10-22 更新）

实际使用本地路径的脚本：

| 消费方 | 实际使用 |
|---|---|
| `delivery-flow/scripts/materialize-development.ts` | `openspecRoot`、`rootRepo` |
| `delivery-flow/scripts/materialize-tfs-tasks.ts` | `openspecRoot` |
| `workitem-analysis/scripts/resolve-root-repo.ts` | `rootRepo`、`openspecRoot`、`repo_context` |
| `pull-request/scripts/worktree.ts` | `rootRepo` + registry `repo_path`、根仓 `.worktrees` |
| `finalize-delivery/scripts/finalize-delivery.ts` | `rootRepo`、`openspecRoot`、registry `repo_path`、根仓 `.worktrees` 与 `.multica/locks` |
| `development-execution/scripts/check-development-completion.ts` | `rootRepo`、registry `repo_path`、根仓 `.worktrees`，用于 commit 路径分类与根仓精确豁免 |

仅消费 registry 身份、不解析本地根仓路径的消费方：

- `delivery-flow/scripts/route-human-decision.ts`；
- `pull-request/scripts/materialize-pr.ts`；
- `pr-status-sync/scripts/reconcile-pr-status.ts`。

文档消费点：

- `workitem-analysis/SKILL.md` 从本 Skill resolver 输出的 `repo_context` 定位根仓 `docs/config/repo-context.yaml`，按 `repo_id/repo_path` 交接候选仓。

## 4. 目标架构

### 4.1 最终配置形态

`repo-registry.base.json` 最终只保留运行时入口与 delivery overlay；仓库身份、语义和路径不再在 base 双写：

```json
{
  "runtime": {
    "multica_cli": "multica",
    "tfs_cli": ["tfs-cli"]
  },
  "delivery": {
    "<repo_id>": {
      "tfs_repo": "<tfs repo>",
      "default_target_branch": "main"
    }
  }
}
```

`sync-workspace.ts` 从根仓 `docs/config/repo-context.yaml` 渲染完整 `registry`：`repo_id` 为 key，`repo_path/tfs_project` 来自 context，delivery overlay 只补 `tfs_repo/default_target_branch`。workspace overlay 继续注入工作区级字段（如 `workspace_id` / `delivery_squad_id`），不注入机器路径。渲染产物继续 gitignore。

### 4.2 RuntimePaths 内部契约

各实际消费路径的脚本在启动时解析出统一的内部结构：

```ts
interface RuntimePaths {
  rootRepo: string;
  openspecRoot: string;
  projectId: string;
  daemonId: string | null;
  source: "explicit_arg" | "project_resource";
}
```

`RuntimePaths` 只存在于进程内，不写入平台配置，不写入 Issue metadata，不做跨进程持久缓存。

### 4.3 解析链

有 Issue 上下文的脚本按以下顺序解析：

```text
显式 --root-repo（仅本地测试 / 人工应急）
  ↓ 未提供
issue get <issue> → project_id
  ↓
project resource list <project_id>
  ↓
筛选 resource_type=local_directory 且 execution_mode=in_place
  ↓
按当前 daemon_id 匹配（多资源时必需）
  ↓
root_repo = resource_ref.local_path
  ↓
派生 openspec_root / repo_context，并按需解析 repo_path、.worktrees 与 finalize lock
```

关键规则：

1. 所有平台调用显式携带渲染产物中的 `runtime.workspace_id`，不依赖 CLI 默认工作区；
2. Issue 缺少 `project_id` → UNKNOWN，不从父 Issue 或标题猜测；
3. 无 Issue 上下文的调用必须显式传 `--project-id`，或由人工传 `--root-repo`；
4. `--root-repo` 只作为命令行覆盖项，用于本地测试和应急；不写入 `_shared`、overlay 或平台 Skill 配置；
5. 解析失败不得回退到旧静态路径；回滚只能通过 Git 恢复旧版本配置与脚本。

### 4.4 当前 daemon_id 获取契约

多资源场景必须知道“当前脚本运行在哪个 daemon”。目标优先级：

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | 平台向 Run 环境注入当前 daemon ID | 最干净，需确认/补齐平台能力 |
| 2 | CLI 提供结构化的当前 daemon 查询 | 需 CLI 能力；不得读取 `~/.multica/config.json` |
| 3 | 每个 daemon 的 OS/服务环境变量 `MULTICA_DAEMON_ID` | 过渡期可落地；非敏感、非路径，随 daemon 环境继承给脚本 |

本方案把 `MULTICA_DAEMON_ID` 定义为**部署变量约定**，不假设 CLI 0.6.4 已自动注入。每个 daemon 配置后应校验其值能在 `runtime list --output json` 的 `daemon_id` 中找到。

禁止的推断方式：

- 不取资源列表第一条；
- 不用“路径在本机存在”判断归属；
- 不用 hostname / `device_info` / Runtime 在线状态推断当前 daemon；
- 不解析 `~/.multica/config.json`（含凭证，且不是公开契约）；
- 不解析 Run workdir 的 `CLAUDE.md`。

### 4.5 资源选择矩阵

| 资源情况 | 当前 daemon_id | 行为 |
|---|---|---|
| 0 条 local_directory | 任意 | UNKNOWN：项目未在当前 Runtime 体系挂载根仓 |
| 1 条 | 未配置 | 单 daemon 模式允许使用，返回该资源的 daemon_id |
| 1 条 | 已配置且匹配 | 使用 |
| 1 条 | 已配置但不匹配 | UNKNOWN：当前 daemon 未挂载该项目 |
| 多条 | 未配置 | UNKNOWN：存在多 daemon 挂载，无法确定当前归属 |
| 多条 | 已配置且唯一匹配 | 使用匹配项 |
| 多条 | 已配置但无匹配 | UNKNOWN：当前 daemon 未挂载该项目 |
| 当前 daemon 多条匹配 | 已配置 | UNKNOWN：违反“每 daemon 每项目唯一 local_directory”约束 |

### 4.6 路径校验

解析得到 `root_repo` 后：

1. 必须是当前操作系统语义下的绝对路径；
2. 目录必须存在；
3. 必须是 Git 根仓（用 `git -C <root> rev-parse --show-toplevel` 归一化比对）；
4. 仅在脚本实际消费时校验 `openspec/`、`docs/config/repo-context.yaml` 或 registry 指定的直接业务子仓：
   - 只创建 worktree 的脚本不强制 `openspec/`；
   - 只读写 OpenSpec 的脚本不强制业务子仓；
   - `repo_path` 必须是根仓直接子目录，越界、嵌套路径和 root 条目作为业务仓均拒绝；
5. Windows / Linux 路径分别用当前进程的 `path` 语义归一化；不把 Git Bash `/d/...` 当作平台存储格式；
6. 校验失败 → UNKNOWN / exit 3，列明资源 ID、project_id、daemon_id 与失败项，不输出无关环境信息。

## 5. 多 daemon 部署语义

### 5.1 路径不同不等于状态可用

以下部署在路径解析层面成立：

```text
daemon：开发机  → D:\WN_Platform\...\multica_spec
daemon：服务器  → /srv/multica_spec
```

但如果 Analysis 在开发机写入 `openspec/changes/X`，Development 在服务器执行，服务器上并不会自动出现该目录。Multica 只共享 Issue 事实，不同步本地文件。

### 5.2 推荐部署模式：项目交付链路亲和

当前流水线的推荐约束：

> **同一交付项目的 Analysis、Development、PR、Finalize 全链路，绑定在同一交付 daemon 的 Runtime 体系上。**

同一 daemon 下的 Claude / Codex / OMP 等多个 Runtime 可以共用同一 `local_directory`；不同 Agent Provider 不构成跨机器接力。

该模式保留现有本地锁、worktree 与 OpenSpec 单工作树语义，改造成本最低。

### 5.3 可选模式：按项目隔离 daemon

不同 daemon 分别负责不同项目/根仓时，可以各自配置自己的 `local_directory`。路径解析按 `daemon_id` 独立工作，不要求文件共享。

### 5.4 暂不承诺：同一 Issue 跨 daemon 接力

同一 Issue 跨 daemon 接力需要额外能力：

- 共享文件系统，或通过 Git 提交/推送/拉取显式交接；
- 跨机器并发锁（现有 `<root_repo>/.multica/locks/root-finalize.lock` 只能锁本机）；
- worktree 位置无关化与回收归属；
- OpenSpec 根仓多写者合并策略。

这些不是本方案的一期范围；没有上述能力时，跨 daemon 接力视为不支持场景。

## 6. 分阶段落地

### 阶段 0：评审与部署裁定（当前阶段）

确认以下决策后再开发：

1. 是否采用 `local_directory` 作为根仓路径唯一事实源；
2. 当前 daemon_id 的过渡期来源（推荐 `MULTICA_DAEMON_ID` 部署变量）；
3. 生产项目是否接受“同一项目交付链路固定同一 daemon”的约束；
4. 多 daemon 验收使用哪个测试工作区与测试项目；
5. `workitem-analysis` 是否纳入 repo-registry 渲染并新增本 Skill 的根目录解析脚本。

本阶段不改 Skill、不改 `_shared`、不同步平台。

### 阶段 1：路径派生收敛

先不引入平台查询，只消除三个路径的重复配置：

1. 各脚本统一从 `root_repo` 派生 `openspecRoot` / `reposRoot`；
2. base 暂时只保留 `root_repo`，删除 `openspec_root` / `repos_root`；
3. 清理 `pr-status-sync`、`route-human-decision`、`materialize-pr` 中无实际消费的字段与校验；
4. 本地回归现有单 daemon 流程。

该阶段仍不是最终目标，但先消除“三个值不一致”的风险。

### 阶段 2：单 daemon 项目资源解析

引入 RuntimePaths resolver：

1. 支持 Issue → project_id → `project resource list`；
2. 项目只有一条 `local_directory` 时无需 daemon 环境变量；
3. 支持显式 `--root-repo` 测试覆盖；
4. 所有实际路径消费方切换为 resolver；
5. 解析失败一律 UNKNOWN，不回退静态路径。

该阶段可在单 daemon 测试工作区先验收。

### 阶段 3：多 daemon 选择与部署变量

1. 为每个 daemon 配置非敏感的 `MULTICA_DAEMON_ID`；
2. resolver 启动时校验该 ID 存在于目标工作区 `runtime list`；
3. 项目存在多条 `local_directory` 时按 `daemon_id` 唯一匹配；
4. 补齐服务器/Linux 路径形态验收；
5. 在部署手册中记录 daemon 环境变量配置与重启要求。

如平台后续提供官方 Run 注入变量，可把同一契约切换到官方来源，脚本解析逻辑不变。

### 阶段 4：配置最终收敛

1. 从 `_shared/repo-registry.base.json` 删除 `root_repo`；
2. 最终 base 只剩 `runtime` + `registry`；
3. 更新各 SKILL.md 前置条件与路径说明；
4. 更新 `docs/workspace-sync-operations-guide.md` 和相关操作手册；
5. 渲染产物确认不含任何机器路径后，再执行平台同步；
6. 用 grep 审计仓内、渲染产物、平台 Skill 文件三层不再出现旧开发机路径。

## 7. 改动面

| 资产 | 计划改动 |
|---|---|
| `workspace-skills/_shared/repo-registry.base.json` | 阶段 1 删除 `openspec_root` / `repos_root`；阶段 4 删除 `root_repo` |
| `delivery-flow/scripts/materialize-development.ts` | 接 RuntimePaths resolver；实际消费 `openspecRoot` / `rootRepo` |
| `delivery-flow/scripts/materialize-tfs-tasks.ts` | 接 RuntimePaths resolver；实际消费 `openspecRoot` |
| `delivery-flow/scripts/route-human-decision.ts` | 删除无实际消费的路径字段，不接 resolver |
| `pull-request/scripts/worktree.ts` | 接 RuntimePaths resolver；实际消费 `rootRepo`、registry `repo_path` 与根仓 `.worktrees` |
| `pull-request/scripts/materialize-pr.ts` | 删除无实际消费的 `repos_root` 字段 |
| `finalize-delivery/scripts/finalize-delivery.ts` | 接 RuntimePaths resolver；实际消费 `rootRepo/openspecRoot`、registry `repo_path`、根仓 `.worktrees` 与 finalize lock |
| `development-execution/scripts/check-development-completion.ts` | 接 RuntimePaths resolver；用于 commit 路径分类与根仓豁免 |
| `pr-status-sync/scripts/reconcile-pr-status.ts` | 删除无实际消费的路径字段与过度校验 |
| `workitem-analysis` | 纳入必要的渲染配置；使用本 Skill 根目录解析入口，SKILL.md 改为先解析并读取 `docs/config/repo-context.yaml`，不引用其他 Skill 的静态 `root_repo` |
| 各相关 `SKILL.md` | 配置前置条件从“机器路径完整”改为“项目已挂载当前 daemon 的 local_directory” |
| `docs/tfs-cli-operations-guide.md` | 不涉及路径解析；仅补交叉链接（如需要） |
| `docs/workspace-sync-operations-guide.md` | 补多 daemon 部署与 `MULTICA_DAEMON_ID` 配置 runbook |
| `README.md` | 文档导航补本方案 |
| `scripts/sync-workspace.ts` | 从根仓 repo-context 单向渲染 registry，合并 base runtime/delivery 与 workspace overlay；保持五份目标与受管 Skill 范围 |
| `scripts/provision-workspace.ts` | 不接管 local_directory 创建；项目资源是环境挂载事实，继续平台/运维侧配置 |
| TFS 凭证配置 | 零改动；`TFS_*` 与 `MULTICA_DAEMON_ID` 都是 daemon 环境，但后者非敏感 |

### 7.1 单文件纪律下的 resolver 复用

仓内约定确定性脚本为 TypeScript 单文件、零构建、零 npm 依赖。本方案不引入新的共享运行时包。resolver 作为小而稳定的代码块落入各实际消费脚本的现有 CLI 封装中；跨脚本一致性由验收用例保证。若未来平台提供统一 Run Context API，再整体替换 resolver 内部实现，调用方契约不变。

## 8. 迁移与回滚

### 8.1 迁移顺序

1. 在测试工作区完成阶段 1～3；
2. 平台项目为测试 daemon 配置 `local_directory`；
3. 为测试 daemon 配置并验证 `MULTICA_DAEMON_ID`；
4. 本地渲染并跑无真实 TFS 写入的脚本验收；
5. 平台同步测试工作区；
6. 选择测试 Issue 验证只读解析与最小真实链路；
7. 生产工作区按同样步骤切换；
8. 生产切换后删除旧静态路径并同步。

### 8.2 回滚

- 阶段 1～3 未删 `root_repo` 前：恢复 base 字段并重跑 `sync-workspace.ts` 即可；
- 阶段 4 后：通过 Git 回滚脚本与 base，再重跑平台同步；不设计“解析失败自动回退旧路径”，避免服务器误写开发机路径。

### 8.3 切换纪律

- 切换窗口内禁止平台手工补写路径；
- 渲染产物必须先本地检查，再同步平台；
- 多 daemon 项目未配置 `MULTICA_DAEMON_ID` 前，resolver 必须 UNKNOWN，不得猜测；
- 同一生产项目的 Agent/Runtime 绑定应先完成“同 daemon 亲和”检查。

## 9. 验收（R 系列；阶段 1+2 实测记录于 2026-10-22）

| # | 用例 | 预期 | 实测 |
|---|---|---|---|
| R-1 | 配置收敛 | base 与渲染产物不含 `repos_root` / `openspec_root` / `root_repo` 静态机器路径 | ✅ 阶段 1 范围通过：base 与渲染产物已删除 `repos_root`/`openspec_root`（key 序字节稳定，grep 无残留消费）；`root_repo` 按计划留待阶段 4 退场 |
| R-2 | 显式覆盖 | `--root-repo` 指向临时 Git 根仓时，各脚本使用该路径并完成本地 fixture 验收 | ✅ 通过（离线 fixture `/tmp/rr-fixture`）：worktree create → reused 幂等 → remove → prune 全周期 exit 0，路径全部取自 `--root-repo` 派生 |
| R-3 | 单 daemon 解析 | 项目仅一条 `local_directory` 时，不传 daemon 变量也能解析该路径 | ✅ 通过（2026-10-22，北落师门 / WN Platform 交付 / FOMA-40）：无 `MULTICA_DAEMON_ID` 时解析平台挂载 `D:\…\multica_spec` 成功（后续校验 FAIL exit 2 证明解析已过、tasks.md 路径取自平台资源）；`MULTICA_DAEMON_ID` 匹配挂载 daemon 时同样通过 |
| R-4 | 多 daemon 解析 | 项目存在多条资源且 `MULTICA_DAEMON_ID` 正确时，选择当前 daemon 的路径 | ✅ 通过（1017test 临时挂第二条 local_directory→fixture2）：选 daemon2 后 prune exit 0；藏起 fixture2 `repos/` 复跑 UNKNOWN 点名 fixture2 路径与资源 id——确证选中路径正确（测后资源已摘除） |
| R-5 | 多资源缺身份 | 多条资源但未配置 daemon 变量 → exit 3，零写入，明确提示无法确定归属 | ✅ 通过（同 R-4 环境）：exit 3，reason 明示 2 条挂载且未配置 `MULTICA_DAEMON_ID`，零写入 |
| R-6 | 身份不匹配 | `MULTICA_DAEMON_ID` 无对应项目资源 → exit 3，不使用其他 daemon 路径 | ✅ 通过：多挂载下无匹配 daemon → exit 3（reason 列明无匹配）；单挂载 + 不匹配 daemon → exit 3（reason 列明唯一挂载所属 daemon，未盗用） |
| R-7 | Issue 缺 project_id | exit 3，不从父 Issue/标题/默认项目猜测 | ◐ 逻辑就绪：平台 CLI 返回的 Issue 恒含 `project_id`，live 无法构造缺失态；缺失分支（exit 3、不猜测）与 R-3~R-6 共用同一 resolver 块，已经 `node --check` 与 R-8 同块回归 |
| R-8 | 路径校验 | 非绝对路径、目录不存在、非 Git 根、缺实际消费目录均 UNKNOWN | ✅ 5/5 通过：相对路径 / 目录不存在 / 非 Git 仓 / 指向仓内子目录 / 缺 `repos/` 消费目录，全部 exit 3 零写入、reason 精确。实施中发现并修复：Windows 8.3 短名导致 toplevel 字符串比对假阴性 → 根仓判定改用 `git rev-parse --show-prefix`（空=根仓），免疫短名/大小写/符号链接 |
| R-9 | 实际消费方回归 | materialize-development / materialize-tfs-tasks / worktree / finalize / check-development-completion 本地 fixture 全过 | ✅ 通过：worktree 离线 fixture 全周期（create/复用/remove/prune）+ 多挂载 prune live（R-4~R-6）；materialize-development live 解析成功（R-3，平台资源路径进入 tasks.md 校验）；其余 3 脚本共用同一 resolver 块，过 `node --check` 与无路径字段配置加载 |
| R-10 | 过度校验清理 | pr-status-sync、route-human-decision、materialize-pr 在最终 config 无路径字段时可运行 | ✅ 3/3 通过：三者加载仅含 `root_repo` 的渲染配置正常，失败点 = Issue 拉取 UNKNOWN（exit 3），非配置 |
| R-11 | workitem-analysis | 能在最终 config 形态下定位并读取根仓 `repo-map.yaml`，不引用其他 Skill 的静态 `root_repo` | ✅ 通过（2026-10-22）：workitem-analysis 纳入 repo-registry 渲染（runtime+registry，零机器路径）；新增本 Skill `scripts/resolve-root-repo.ts`（同一 resolver 块 + repo-map.yaml 校验）——live `--issue FOMA-40` exit 0 输出 repo_map 路径；daemon 不匹配 exit 3；repo-map 缺失 exit 3；用法错误 exit 64 |
| R-12 | 平台同步审计 | 平台 Skill 文件回读与仓内一致，且 grep 无旧开发机路径 | ✅ 通过（2026-10-22，北落师门）：平台同步后 `sync --check` PASS 零漂移（hash 回读逐字节一致）；仓内/渲染产物/平台三层 grep 无 `multica_spec` 等旧开发机路径（清理了 development-evidence-contract.md 示例中的最后一处） |
| R-13 | Linux 服务器形态 | Linux daemon 的 `/srv/...` 路径解析、Git 校验、派生路径全部通过 | ⛔ 环境受阻：当前无 Linux daemon。resolver 路径语义全部走 `node:path` 当前进程语义 + git 自身判定，无 Windows 专属假设；首台 Linux daemon 上线时按 ops guide §3.10 runbook + `check-daemon-setup.ts` 验收 |
| R-14 | 交付链路亲和检查 | 同一生产项目的 Analysis/Engineering/Finalize 相关 Runtime 归属同一 daemon；不满足时部署检查列明 | ✅ 通过（2026-10-22）：`scripts/check-daemon-setup.ts` 落地四项检查（daemon_env / daemon_registered / mount_uniqueness / delivery_affinity——项目 lead+活跃 Issue assignee 的 Runtime 同 daemon 且该 daemon 有挂载）；live 全 PASS；负例（变量缺失/错误 ID）FAIL 列明 |

## 10. 明确不做

- 不实现跨 daemon 文件自动同步；
- 不支持无共享/无 Git 交接的同一 Issue 跨机器接力；
- 不把本地锁升级为分布式锁；
- 不在 `sync-workspace.ts` 渲染时查询并写入当前机器路径；
- 不把服务器或开发机路径写入 `_shared`、overlay、Issue metadata、评论或平台 Skill 配置；
- 不解析 Run workdir 的 `CLAUDE.md` 作为路径契约；
- 不读取 `~/.multica/config.json`；
- 不改变 TFS 凭证注入方式；
- 不在本方案中自动创建/修改项目 `local_directory` 资源；
- 不改变 OpenSpec 工程事实与 Multica Issue 交付事实的双事实源分工。

## 11. 开放问题 / 裁定点

1. **当前 daemon_id 的长期来源**：优先等平台/CLI 官方能力，还是长期采用 daemon 环境变量 `MULTICA_DAEMON_ID`。**待裁定**。
2. **生产交付链路亲和策略**：是否明文规定同一项目全链路 Agent 必须绑定同一 daemon 的 Runtime。**建议采纳，待裁定**。
3. **多 daemon 验收环境**：使用现有 `winning-dps-df` 的在线 daemon，还是新建隔离测试项目/测试工作区。**建议隔离环境，待裁定**。
4. **workitem-analysis 配置形态**：纳入完整 repo-registry 渲染，还是新增更小的 runtime-context 配置。**建议复用 repo-registry 渲染，减少 sync-workspace 特例，待裁定**。
5. **阶段 1 是否单独发布**：先删两个派生路径、保留 `root_repo`，再切平台解析；还是单 daemon 场景一次性切到资源解析。**建议分阶段，降低回归面，待裁定**。
6. **多 daemon 同项目并行写 OpenSpec**：若未来要求支持，需要另立共享存储/Git 交接与全局锁方案，不属于本方案验收范围。
