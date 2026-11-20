# workspace-skill-portability 方案（Skill 资产工作区无关化 + 同步时注入）

> 状态：**已实施并验收（2026-10-20，MG-1~MG-6 全过；迁移演练工作区 = 1020_test，用户裁定）**。
> 上游权威：CLAUDE.md 核心约定 3（Skill = 可复用执行契约）/ 约定 4（确定性脚本基线）；`docs/01-…guideline…`（Reference-not-Replication）；`docs/agent-skill-review-checklist.md`（评审依据）。
> 关联：`docs/tfs-state-writeback-plan.md`（repo-registry.json 四副本纪律的出处之一）；各 Skill README 的"upsert 同步纪律"段落（已改写为 sync-workspace.ts）。
> 用户裁定（2026-10-20）：① Skill 资产应做到工作区无关；② 工作区特异性只在同步平台时显式注入；③ 裁定点 1/3/4 采纳推荐（渲染产物 gitignore / skills 映射进 overlay / §3.5 硬编码清理并入）；④ MG-5 演练工作区 = `1020_test`（`c08d05e3-c606-4eaa-852d-35ae5180c205`）。
> 评审修订（2026-10-20）：① 四副本现状实测不同形状（§3.3 更正）；② 同步脚本补平台侧文件 reconcile（§3.4 第 5 步）；③ overlay 声明为平台对象 ID 的机器权威（§3.2）；④ MG-3 预期与"脚本零改动"对齐（§6）；⑤ 改动面补 CLAUDE.md；⑥ dry-run diff 走 stderr；⑦ MG-5 验收可行性入开放问题（§8.6，已裁定）。
> 当前契约修订（2026-10-22）：repo-registry 改为 `repo-context.yaml + repo-registry.base.json 的 runtime/delivery overlay + workspace overlay` 单向渲染，共五份；`repo_key = repo_id`，`repo_path` 来自 repo-context。原方案的四副本与 MG 实测记录保留为历史证据。

## 0. 背景与定位

**现状**：工作区特异性（`workspace_id` / `delivery_squad_id` / `project`）以具体值形态**烘焙在仓内 5 份 config 里**（`repo-registry.json` ×4：delivery-flow / pull-request / finalize-delivery / pr-status-sync；`sync-config.json` ×1：tfs-sync），并作为 skill files upsert 到平台。后果：

1. 仓内资产不是"通用资产"——任何工作区 UUID 散落在配置里，迁移等于改值 + 逐份 upsert + 祈祷四副本没漂移；
2. 四副本靠**人肉纪律**保持同步（各 README 明写），无机器保证；
3. 迁移到新工作区时，哪些值要改、改几处、按什么顺序，全靠经验（本会话已做过一次完整分析，结论：5 份 config 的 3 类字段 + 平台对象全量重建）。

**目标**：仓内 Skill 资产工作区无关化——`workspace_id` / `delivery_squad_id` / `project` 从仓内 config 抽离为**按工作区一份的 overlay**；同步平台时由脚本渲染（base + overlay → 各 Skill config → upsert），本地运行同样经渲染产物。**平台侧 per-workspace 副本不可消灭**（Skill 是 workspace 级对象），但工作区特异性被压缩到"一次渲染注入"。

**定位**：这是资产仓的**部署层工具**，不改变任何脚本行为、Skill 契约、metadata 事实；config 的**字段形状一字不动**，只是值的来源从"人肉维护"变"渲染产物"。

## 1. 设计约束（红线）

1. **脚本 config 消费契约不变**：`repo-registry.json` / `sync-config.json` 的字段形状、缺项 UNKNOWN 语义、相对路径读法全部不动——9 个 Skill 的脚本零改动（唯一例外见 §4.5 的 SKILL.md 硬编码路径清理，可选）。
2. **显式 workspace 纪律不动摇**：脚本继续从渲染产物读 `workspace_id` 并显式拼 `--workspace-id`；**不**改成跟随 CLI 默认 profile（静默读错风险，sync-config `cli_note` 既定结论）。
3. **确定性脚本基线**：同步/渲染脚本 TS 单文件零构建零 npm 依赖；退出码 0/2/3/64；stdout 只 JSON，日志 stderr。
4. **凭证不进渲染范围**：TFS PAT 仍在 `services/tfs-cli/config/tfs.config.json`（已 gitignore）；overlay 只含平台对象 ID（无敏感信息，可提交——现状 README 已大量记录同类 ID）。
5. **平台对象生命周期不自动化**：注册 Agent/Skill/Squad/Autopilot 仍手工（或另案），本方案只接管"对象已存在后的内容同步"。

## 2. 配置分层模型（唯一权威拆分）

| 层 | 字段 | 变化维度 | 存放 |
|---|---|---|---|
| 仓库语义与路径层 | `repo_id / repo_type / repo_path / responsibility / keywords / not_responsible_for / tfs_project / tfs_collection` | 接新业务仓、调整语义或路径 | 根仓 `docs/config/repo-context.yaml`（唯一映射源） |
| 交付层 | 按 `repo_id` 配置的 `tfs_repo / default_target_branch` | 启用 PR/TFS 交付、调整目标分支 | base 的 `delivery` overlay |
| 机器层 | `runtime.multica_cli` / `runtime.tfs_cli` / tfs-sync 的 `tfs.query_command` | 换机器 | base 的 `runtime` |
| ~~机器路径~~ | ~~`repos_root` / `openspec_root` / `root_repo`~~ | — | **已退场**（multi-daemon-root-repo-resolution-plan 阶段 4）：根仓路径运行时由平台项目 `local_directory` 资源解析，不进任何配置 |
| 工作区层 | `runtime.workspace_id` / `runtime.delivery_squad_id` / tfs-sync 的 `multica.project` | 迁工作区 | overlay（每工作区一份） |
| 实例寻址层 | 各 Skill 在目标工作区的平台 ID | 迁工作区 | overlay（`skills` 映射） |

说明：

- **机器层当前并入 base**（单 Runtime 现状）；真出现第二执行机器时再拆 machine overlay，不在本方案做（§7）。机器路径已不再是配置层问题：多 daemon 各自的平台 `local_directory` 资源即事实源（见 multi-daemon-root-repo-resolution-plan）。
- **实例寻址层进 overlay** 的理由：同步脚本要用 `skill update <id>` / `files upsert <id>` 寻址平台副本，ID 是工作区实例数据，天然属于 overlay；这也让 overlay 成为"该工作区部署了什么的机器可读登记处"。
- tfs-sync 的 `multica.squad` 是 Squad **名字**而非 ID，只要新工作区 Squad 同名即便携，留 base。

## 3. 目标形态

### 3.1 目录结构

```text
workspace-skills/
  _shared/
    repo-registry.base.json        # runtime + delivery overlay（不含 repo_id/repo_path 第二份映射）
    sync-config.base.json          # tfs-sync 用（tfs 块 + multica.cli/squad/initial_status + sync 块）
    workspaces/
      beiluoshimen.json            # 北落师门 overlay（含 skills 寻址映射）
      <新工作区>.json               # 迁移时唯一新增文件
scripts/
  sync-workspace.ts                # 渲染 + 平台同步（新 Top-level scripts/，仓维护工具，非 Skill 资产）
```

### 3.2 overlay 契约（`workspaces/<name>.json`）

```json
{
  "workspace_id": "<uuid>",
  "delivery_squad_id": "<uuid>",
  "project": "<uuid>",
  "skills": {
    "delivery-flow": "<skill uuid>",
    "pull-request": "<skill uuid>",
    "finalize-delivery": "<skill uuid>",
    "pr-status-sync": "<skill uuid>",
    "tfs-sync": "<skill uuid>",
    "delivery-gate": "<skill uuid>",
    "analysis-completion": "<skill uuid>",
    "workitem-analysis": "<skill uuid>",
    "development-execution": "<skill uuid>"
  }
}
```

- `project` 仅 tfs-sync 消费；`delivery_squad_id` 仅 pr-status-sync 消费（渲染时统一注入全部 4 份 repo-registry，见 §3.3）；
- `skills` 映射允许部分填：只同步已注册的 Skill，缺项跳过并列明（`skipped_unregistered`），不视为失败——支持渐进注册；
- **权威声明（X1）**：overlay 是平台对象 ID 的**机器权威**（同步脚本消费）；各 Agent README 的注册记录表是人工登记，以 overlay 为准回填，两处不一致时以 overlay 为准。

### 3.3 渲染规则

- `repo-registry.json`（×5）= 读取根仓 `docs/config/repo-context.yaml`（经 `tools/repo_registry.py list` 的只读 JSON 契约），合并 base 的 `runtime` 与 `delivery` overlay，再注入 overlay 的 `workspace_id` / `delivery_squad_id` 到 `runtime`；五份输出**逐字节相同**。`repo_id` 成为 registry key（Facts 字段仍名 `repo_key`），`repo_path/tfs_project` 来自 context，`tfs_repo/default_target_branch` 仅来自 delivery overlay；
- `sync-config.json`（×1）= sync-config.base 深合并 `workspace_id` / `project` 进 `multica`；
- 渲染产物写回各 Skill 的 `config/`（本地运行与平台 upsert 同源）；产物文件加 `.gitignore`——仓内不再提交任何含工作区 ID 的 config（详见 §8 裁定点 1）；
- context 缺字段、repo_id/repo_path 重复或非法、delivery overlay 含陈旧键，或 overlay 缺必需字段（`workspace_id` 等）→ exit 3 UNKNOWN，列明缺项，零写入；本地多配置采用临时文件 + 同目录 rename，失败不留半套配置。

### 3.4 同步脚本契约（`scripts/sync-workspace.ts`）

```text
用法：node scripts/sync-workspace.ts --workspace <name> [--skill <name>] [--local-only] [--dry-run]

流程：
1. 读根仓 `docs/config/repo-context.yaml`、base ×2 + workspaces/<name>.json；缺文件/缺字段或映射非法 → exit 3 UNKNOWN（列明缺项）；
2. 渲染 5 份 repo-registry + 1 份 sync-config 到各 Skill config/（本地写入，--dry-run 只出 diff、不写盘；
   diff 走 stderr，stdout 始终只出 JSON 摘要——基线纪律）；
3. --local-only 到此为止（本地运行就绪）；
4. 否则对 overlay.skills 已登记的每个 Skill（或 --skill 指定的一个）：
   multica skill update <id> --content-file <SKILL.md>
   multica skill files upsert <id> --path <p> --content-file <f>（scripts/config/references 全量）；
5. reconcile（评审修订，补删除语义）：skill files list 取平台侧清单，与仓内清单对比——
   平台多出而仓内不存在的文件一律 multica skill files delete（仓内为准，与渲染同源，
   无信息丢失风险），删除明细列入输出；不 delete 只靠 upsert 是半同步，
   仓内删/改名文件会在平台残留旧副本，长期必漂移；
6. 回读校验：skill files list 逐文件比尺寸；不一致 → exit 3 UNKNOWN 列明；
7. 输出 { result, workspace, synced: [...], skipped_unregistered: [...],
        deleted_remote: [...], files: {...} }。
```

- flag 形状（`skill update` / `files upsert` / 是否需要 `--workspace-id` 定位）**实施前对照安装版本 `multica --help` 核验**（CLAUDE.md 纪律；§8 开放问题 1）；
- 本脚本**不是** workspace skill，不进平台物化；它是仓维护工具，直接 `node` 直跑。

### 3.5 SKILL.md 硬编码路径清理（可选，建议并入）

`workitem-analysis/SKILL.md` 曾硬编码根仓绝对路径——机器层值混进了 content（content 逐字上传，无法渲染）。**当前最终形态**：workitem-analysis 纳入 repo-registry 渲染，使用本 Skill `scripts/resolve-root-repo.ts` 按 Issue → 平台 local_directory 资源运行时解析根仓并校验、输出 `docs/config/repo-context.yaml` 的 `repo_context` 路径，SKILL.md 不引用任何静态路径。

## 4. 改动面

| 资产 | 改动 |
|---|---|
| `workspace-skills/_shared/` | 新增 base ×2 + overlay ×1（北落师门，值取自现仓 config/README 注册记录） |
| `scripts/sync-workspace.ts` | 新增（§3.4，含 reconcile 删除语义） |
| 5 份存量 config | 转为渲染产物 + `.gitignore`；仓内删除已提交版本（git 历史仍在） |
| `workitem-analysis/SKILL.md` | §3.5 硬编码路径清理（可选） |
| 各 Skill README | "upsert 同步纪律"段落改写为"改 scripts/config 后跑 `sync-workspace.ts --workspace <name>`"；四副本同步纪律条目删除（机器保证）；注册记录表注明"以 `_shared/workspaces/<name>.json` overlay 为准" |
| `CLAUDE.md` | 仓库结构段补 `scripts/`（仓维护工具）与 `workspace-skills/_shared/`（base/overlay）两个新目录 |
| 仓 README（或 CLAUDE.md"环境"段） | 补"首次使用/切换工作区：先跑 `sync-workspace.ts --local-only` 渲染 config"指引（脚本零改动前提下，渲染提示不靠报错信息承载） |
| `docs/multica-delivery-operations-guide.md` | 实施状态补本方案一节 |
| `.gitignore` | 新增 5 份渲染产物路径 |
| 9 个 Skill 的脚本 | **零改动**（红线 1） |

## 5. 关键场景语义

| 场景 | 行为 |
|---|---|
| 迁移新工作区 | 建 workspace + 确认 runtime（手工各一条）→ `node scripts/provision-workspace.ts --workspace <name> --slug <slug>`（建对象 + 生成 overlay，ID 零转抄）→ `node scripts/sync-workspace.ts --workspace <name>`（渲染 + 内容同步）→ 完（对象供给见 docs/workspace-provisioning-plan.md） |
| 接新业务仓 | 在根仓 repo-context 登记语义与 `repo_id/repo_path`；如需 PR/TFS 交付，再在 base 的 `delivery` 增加对应 overlay → 重跑同步（全部已登记工作区各自一次） |
| 搬根目录/换机器 | 配置当前 daemon 的项目 `local_directory` 资源与 `MULTICA_DAEMON_ID`；无需把机器路径写入 base → 重跑同步 |
| 本地运行（含验收测试） | clone 后先 `--local-only` 渲染 → 各脚本照常用相对路径 config；忘渲染 → 脚本 loadConfig UNKNOWN（"无法读取配置"），报错信息提示渲染命令 |
| 改脚本/SKILL.md | 重跑同步（不再逐文件手工 upsert） |
| 多工作区并存 | 每工作区一份 overlay；同步互不影响；仓内始终无工作区值 |

## 6. 验收（MG 系列，2026-10-20 实测全过）

测试纪律：迁移演练在用户指定的测试工作区 `1020_test`（`c08d05e3-c606-4eaa-852d-35ae5180c205`）执行；北落师门现役对象只做同内容幂等重传；演练产物（1020_test 全部注册对象）保留供后续复用/清理裁定。

| # | 用例 | 预期 | 实测（2026-10-20） |
|---|---|---|---|
| MG-1 | 渲染正确性 | `--local-only` 后：4 份 repo-registry 逐字节相同且与手工合并结果一致；sync-config 合并正确；缺 overlay 字段 → exit 3 列明缺项零写入 | ✅ 4 份 md5 全同；git diff 证实与提交版差异仅"数组展开格式化 + pull-request/finalize-delivery 补 squad_id（超集化）"；1020_test 缺 squad_id 时同步 delivery-flow → exit 3"overlay 缺少 delivery_squad_id"零写入（防呆实证） |
| MG-2 | 工作区无关性 | 全仓 grep（排除 `workspaces/*.json`、docs 历史验收记录、README 注册记录表）：无任何 workspace / squad / project UUID | ✅ 三 UUID 仅存于：overlay（beiluoshimen.json）、渲染产物（已 gitignore，`git ls-files` 证实 0 份 config 在库）、README 注册记录、docs 历史、`.l4-data`/`.probe-*`（已 gitignore 临时工件） |
| MG-3 | 本地运行 | 删除 5 份渲染产物 → 任一 Skill 脚本 → UNKNOWN 且列明缺失的配置路径；`--local-only` 渲染后 → 脚本前置通过 | ✅ 删产物后 resolve-tfs-tasks → exit 3"无法读取配置 …ENOENT"列明路径；重渲染后对 FOMA-39 幂等 PASS（exit 0） |
| MG-4 | 平台同步 | 对测试工作区跑全量同步 → files list 回读逐文件尺寸一致；构造平台侧多余文件 → 重跑同步 → 该文件被 delete 且列入 `deleted_remote`；重复跑 → 幂等 | ✅ 1020_test 全量 11 Skill PASS（content_hash 逐文件比对）；手工 upsert 陈旧文件 `scripts/STALE-should-be-deleted.json` → 重跑被 delete 且列入 deleted_remote；再重跑 deleted 为空（幂等） |
| MG-5 | 迁移演练 | 用测试工作区走完 §5"迁移新工作区"全流程 → 该工作区内 Skill 可运行 | ✅ 1020_test：Skill×11 注册 + sync 全过（hash 回读一致）；Agent×6（runtime `f83ab818`，该工作区自有）+ 绑定与北落师门逐一核对一致；Squad×1（instructions + 3 成员）；Autopilot×2（run_only）；project×1；渲染产物 workspace_id/project 指向 1020_test，只读寻址（issue list）成功。**偏差**：未跑真实 Run（Run 级验证待首个真实交付回填）；Autopilot 未加 trigger（防 cron 误触发真实 TFS 同步，trigger-add 一条命令可补） |
| MG-6 | 渐进注册 | overlay 只登记 3 个 Skill → 同步只动 3 个，其余列 `skipped_unregistered`，exit 0 | ✅ overlay 仅 delivery-gate 等 3 个时同步 delivery-gate → PASS，其余 8 个列 skipped_unregistered |

**实施偏差（与方案文字不一致处，均为对齐实测 CLI 行为）**：

1. `multica workspace switch` 按工作区**名字**报"not found"，按 **UUID** 成功（0.6.1 实测）——迁移操作一律用 UUID；
2. `skill files delete <skill-id> <file-id>` 无 `--output` flag（§8.2 核验纪律发现），sync-workspace.ts 按退出码判定，已修；
3. **Runtime 是 workspace 级对象**：1020_test 有独立 runtime（`f83ab818`，用户预建）；迁移清单须含"确认目标工作区有可用 runtime"，agent create 的 `--runtime-id` 用目标工作区的；
4. 注册辅助脚本（临时）第二次运行覆盖首批 skill ID 记录，导致 overlay 一度缺 3 个 Skill——操作层失误非方案缺陷，人工合并补齐后全量同步 PASS；正式迁移时建议一次性注册；
5. MG-5 未跑真实 Run、Autopilot 未加 trigger（两条均为主动安全选择，见 MG-5 实测列）。

## 7. 明确不做

- ~~平台对象（Agent/Skill/Squad/Autopilot）的**创建**自动化~~ **已解除（2026-10-21 用户裁定）**：CLI 能力已经 MG-5 全部实证，转由 `docs/workspace-provisioning-plan.md` 承接（对象供给 + update-if-drift 全资产收敛；本方案 §3.4 的 sync-workspace 语义不变，仅叠加 hash 预比对与 `--check` 执行层优化）；
- 机器层 overlay 拆分（单 Runtime 现状，第二机器出现时再议）；
- README 注册记录表的自动生成（文档性质，手工回填成本可接受）；
- 消灭平台侧 per-workspace 副本（平台模型决定，不可能）；
- 存量交付 Issue 的跨工作区迁移（Issue 是 project 级资产，不跟走——在途交付在旧工作区收尾或新工作区重建重跑物化，TFS 侧幂等/孤儿认领已实证）；
- 脚本 config 消费契约的任何修改（红线 1）。

## 8. 开放问题 / 裁定点

1. **渲染产物是否 gitignore**（推荐：gitignore + render-on-demand，仓内彻底无工作区值；备选：提交"当前工作区快照"降低本地摩擦）。**待用户裁定**。
2. `multica skill update` / `skill files upsert` / `skill files delete` 的目标寻址是否需 `--workspace-id`（skill ID 全局唯一则不需要）、`files delete` 的 flag 形状——实施前对照安装版本 `--help` 核验，不凭文档假设（CLAUDE.md 纪律）。
3. overlay 的 `skills` 寻址映射是否纳入（推荐纳入——同步脚本需要寻址；备选：同步时按名字 `skill list` 现查，多一次往返且依赖命名纪律）。**待用户裁定**。
4. §3.5 的 SKILL.md 硬编码清理是否并入本方案（建议并入，一次同步生效）。**待用户裁定**。
5. 北落师门现役 5 份 config 的切换窗口：渲染产物与现仓内容应逐字节等价（MG-1 覆盖），切换本身无平台动作（upsert 同内容幂等）；如有意外 drift，以渲染产物为准重传。
6. ~~MG-5 的测试工作区从哪来~~ **已关闭（2026-10-20 用户裁定）**：测试工作区 = `1020_test`（`c08d05e3-c606-4eaa-852d-35ae5180c205`），MG-5 已实测通过（含两条主动安全偏差，见 §6）。
