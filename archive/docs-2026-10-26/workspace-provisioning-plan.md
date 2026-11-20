# workspace-provisioning 方案（平台对象供给自动化 + 全资产收敛同步）

> 状态：**已实施并验收（2026-10-21，P-1~P-7 全过；演练工作区 = 1021_test，对拍基准 = 北落师门）**。
> 上游权威：`docs/workspace-skill-portability-plan.md`（§7 原排除项，本方案解除）；CLAUDE.md 核心约定 1（双事实源 / Reference-not-Replication）/ 约定 4（确定性脚本基线）。
> 用户裁定（2026-10-21）：① 一期全做——Skill×11 / Agent×6 / Squad×1 / Autopilot×2 / Project×1 全部纳入自动化；② 先落方案文档，暂不开发；③ Agent/Squad/Autopilot 漂移语义 = update-if-drift（全对象收敛，非只增不改）；④ 同步语义 = 收敛式，执行层叠加回读式 diff（禁记忆式 diff）。
> 前置事实：对象创建所需 CLI 已经 1020_test 演练（MG-5）全部实证，并对安装版 `--help` 逐条复核（2026-10-21，见 §2.3）；portability 方案 §6 偏差 4（注册辅助脚本二次运行覆盖首批 skill ID）实证"手工转抄 ID"是真实事故源。

## 0. 背景与定位

**现状**：迁移一个新工作区 = 手工建 21 个平台对象（Skill×11 / Agent×6 / Squad×1 / Autopilot×2 / Project×1）→ 手工把 14 个 ID（workspace_id + delivery_squad_id + project + skills×11）抄进 overlay → 跑 `sync-workspace.ts`。两个痛点：

1. **对象创建手工化**：21 个对象逐个 CLI/界面操作，顺序依赖（Skill→Agent→Squad）靠人记；
2. **ID 转抄手工化**：14 个 ID 从命令输出抄进 JSON，偏差 4 已实证此环节会出覆盖事故。

**前提变化**：portability 方案 §7 当时排除"对象创建自动化"的唯一理由是"CLI 能力未验证"；MG-5 已把 `skill create` / `agent create` / `squad create|update|member add` / `project create` / `autopilot create` 全部跑通，自动化前提具备。

**目标**：迁移新工作区收敛为**两条命令**（provision → sync），ID 零转抄，全部资产（Skill 内容 + Agent/Squad/Autopilot 配置）实现"仓内 = 权威、平台 = 镜像"的收敛同步。

**定位**：与 sync-workspace 同级的**仓维护工具**，不进平台物化；不改变任何 Skill 契约、Agent 五段式契约、脚本行为；sync-workspace.ts 本体语义不变（仅叠加执行层优化，见 §1.3）。

## 1. 统一同步模型（全仓库一句话纪律）

### 1.1 语义层：收敛式（不可让渡）

- **仓内 = 资产唯一权威，平台 = 镜像，方向单向**：仓内 → 平台。永远不做反向 pull，不做双向合并——平台侧手工改动一律视为**待纠正的事故**而非待合并的输入；确需保留的平台改动，正确路径是人工搬回仓内走评审/commit，再同步；
- **无本地同步状态**：不记"上次推过什么"（该记录本身是新的漂移源：丢失/错误/换机器即错乱）；
- **回读平台实际状态参与比对**：平台可能被脚本之外的手改动（Web UI），只有回读能发现外部漂移；
- **幂等可重入**：任意时刻、任意中途失败后重跑，收敛到同一结果。

### 1.2 执行层：回读式 diff（优化，叠加在收敛语义之上）

每类对象的同步动作统一为四分类：

| 比对结果 | 动作 | 输出列 |
|---|---|---|
| 平台与仓内一致 | 跳过 | `unchanged` |
| 平台与仓内不符 | update / 重新 upsert 覆盖 | `updated` |
| 仓内有、平台无 | create | `created` |
| 平台有、仓内未声明 | **不删**，列明提示 | `unmanaged_remote` |

- **回读式 diff ≠ 记忆式 diff**：比对依据是平台实际状态（`list` / `get` 回读），不是本地缓存的推送记录；换机器、断点续跑、平台被手工改，全部安全；
- **删除语义分两层**：Skill **文件级**多出仍 delete（portability 既定，文件无历史资产）；**对象级**多出不删只列明——对象删除波及 Run 历史与绑定关系，风险不对等，留人工处置。

### 1.3 sync-workspace 的执行层小改进（随本方案一并实施）

- **hash 预比对**：upsert 前先取 `files list` 的 `content_hash` 与仓内比对，一致跳过——省掉未变文件传输。语义一字不动（回读校验保留），纯属执行优化；
- **`--check` 纯检测模式**：只回读比对、输出 drift 清单、零写入；exit 2 表示存在漂移。用于审计"平台是否被动过"。

### 1.4 漂移纠正的标准答案

平台侧改了 Skill 内容 / Agent instructions / 绑定关系：不需要发现，下一次 provision / sync 自动纠回（`updated` 清单如实列明纠正了哪个文件/哪个字段）；想只看不改 → `--check`。

## 2. provision-workspace.ts 契约

### 2.1 用法

```text
node scripts/provision-workspace.ts --workspace <name> --slug <slug>
                                    [--create-workspace] [--runtime-id <uuid>]
                                    [--dry-run]

--workspace  overlay 名（workspaces/<name>.json），同时作为输出目标
--slug       工作区 slug；脚本经 workspace list 自解析 workspace_id（UUID 零转抄）
--create-workspace  工作区不存在时先 workspace create（默认不存在则 exit 3 列明）
--runtime-id 指定 agent 创建用 runtime；缺省时 runtime list 唯一则自动取，多个则 exit 3 列明
--dry-run    只出 created/updated/unchanged 预演清单，零创建零写盘
```

退出码 0/3/64；stdout 只 JSON；日志走 stderr（基线纪律，同 sync-workspace）。

### 2.2 流程（顺序即 MG-5 实证依赖序）

```text
0. workspace list 按 slug 解析 workspace_id；--create-workspace 时先建再解析；
   后续所有命令显式带 --workspace-id（红线：显式 workspace 纪律不动摇）；
1. runtime list 校验目标工作区有可用 runtime（runtime 是 workspace 级对象，
   portability §6 偏差 3）；解析 --runtime-id 或唯一自动取；
2. Skill ×N：skill list 回读 → 仓内 workspace-skills/ 目录枚举对拍（名字）→
   缺则 skill create --name --description --content-file SKILL.md → 取 ID；
3. Agent ×6：agent list 回读 → 按 manifest 声明的显示名对拍 →
   缺则 agent create --runtime-id --model --description --instructions（仓内文件注入）；
   已存在则 update-if-drift（instructions / description 回读比对，不符则 agent update）；
   随后 agent skills set 按 manifest 绑定清单收敛（set = 替换式，天然收敛）；
4. Squad ×1：squad list 对拍 → 缺则 squad create --leader →
   squad update --instructions（squads/delivery-squad/squad-instructions.md 注入）→
   member list 对拍，缺则 member add（leader 由 create 落定，不重复 add）；
5. Project ×1：project list 对拍（按 title）→ 缺则 project create；
6. Autopilot ×2：autopilot list 对拍 → 缺则 autopilot create --agent --mode run_only
   --title --description（agents/<name>/autopilot-prompt.md 注入）；
   **不加 trigger**（MG-5 安全纪律保留：防 cron 误触发真实 TFS 同步）；
7. 原子写 overlay：workspace_id / delivery_squad_id / project / skills 全映射，
   全部 ID 来自 create/list 的 JSON stdout 解析，**脚本是 overlay 唯一写入者**，
   整文件一次写入（消灭偏差 4 事故类：无人工合并环节、无第二写入者）；
   中途失败：已获得的 ID 落盘 + exit 3 列明缺项（reconcile 幂等，重跑断点续建）；
8. 输出 { result, workspace, created/updated/unchanged/unmanaged_remote 分对象明细,
        overlay_written: true|false, next: "node scripts/sync-workspace.ts --workspace <name>" }。
```

### 2.3 CLI 实证状态

| 对象 | 命令 | 实证 |
|---|---|---|
| Skill | `skill create --name --description --content-file`（默认 JSON 输出含 id） | MG-5 + `--help` 复核 |
| Agent | `agent create --name --runtime-id --model --description --instructions`；`agent skills set` | MG-5 + `--help` 复核 |
| Squad | `squad create --name --leader`（无 instructions flag，建后 `squad update --instructions` 补）；`squad member add` | MG-5 + `--help` 复核 |
| Project | `project create --title` | MG-5 + `--help` 复核 |
| Autopilot | `autopilot create --agent --mode --title --description` | MG-5 + `--help` 复核 |
| Workspace | `workspace create --name --slug`；list/switch 按 UUID（portability 偏差 1） | `--help` 复核 |
| update 类 | `agent update` / `autopilot update` 的字段级 flag 形状 | **实施前对照安装版 `--help` 核验**（CLAUDE.md 纪律，不凭本文档假设） |

## 3. 资产来源与 manifest

### 3.1 仓内自描述优先（零新增声明的部分）

| 数据 | 来源 |
|---|---|
| Skill 名单 + content + files | `workspace-skills/` 目录枚举（与 sync-workspace 同一事实源） |
| Agent description / instructions | `agents/<dir>/description.md` / `instructions.md` |
| Squad instructions | `squads/delivery-squad/squad-instructions.md` |
| Autopilot run prompt | `agents/<dir>/autopilot-prompt.md`（tfs-sync-agent / pr-status-sync-agent 已有） |

### 3.2 manifest（新增 `workspace-skills/_shared/provisioning.json`，只声明仓内无法自描述的）

```json
{
  "agents": [
    { "dir": "delivery-lead",       "name": "Delivery Lead",       "model": "<裁定点 8.3>",
      "visibility": "workspace",
      "skills": ["delivery-flow", "delivery-gate", "pull-request", "finalize-delivery"] },
    { "dir": "workitem-analyst",    "name": "Workitem Analyst",    "visibility": "workspace",
      "skills": ["workitem-analysis", "analysis-completion", "delivery-gate"] },
    { "dir": "backend-engineer",    "name": "Backend Engineer",    "visibility": "workspace",
      "skills": ["development-execution", "backend-engineering", "pull-request"] },
    { "dir": "frontend-engineer",   "name": "Frontend Engineer",   "visibility": "workspace",
      "skills": ["development-execution", "frontend-engineering", "pull-request"] },
    { "dir": "tfs-sync-agent",      "name": "TFS Sync Agent",      "visibility": "workspace",
      "skills": ["tfs-sync"] },
    { "dir": "pr-status-sync-agent","name": "PR Status Sync Agent","visibility": "workspace",
      "skills": ["pr-status-sync", "finalize-delivery"] }
  ],
  "squad": { "name": "Delivery Squad", "leader": "Delivery Lead",
             "members": ["Workitem Analyst", "Backend Engineer", "Frontend Engineer"] },
  "project": { "title": "<TFS 同步目标项目名，同 sync-config 的 multica 语义>" },
  "autopilots": [
    { "title": "TFS 定时同步", "agent": "TFS Sync Agent",      "mode": "run_only",
      "prompt_file": "agents/tfs-sync-agent/autopilot-prompt.md",
      "schedule_note": "*/15 * * * * Asia/Shanghai（登记用，trigger 不自动加）" },
    { "title": "PR 状态同步",  "agent": "PR Status Sync Agent", "mode": "run_only",
      "prompt_file": "agents/pr-status-sync-agent/autopilot-prompt.md",
      "schedule_note": "*/15 * * * * Asia/Shanghai（同上）" }
  ]
}
```

- **绑定清单以仓内已存在的 Skill 为准**：README 中提及但未落地的 Skill（如 delivery-lead README 的 `development-task-materialization` / `task-close`）不列入 manifest；manifest 引用了仓内不存在的 Skill 目录 → exit 3 列明（防呆）；
- **Squad 成员以 manifest 为准**：README 另列 Flink Engineer / Verify Agent，但仓内无对应 agent 资产，不列入；manifest 引用了未创建的 agent → exit 3 列明；
- manifest 中 skills 引用的寻址：同一 provision 运行内先建 Skill 后绑 Agent，直接用本次解析的 ID 映射，无需经 overlay 中转。

## 4. 改动面

| 资产 | 改动 |
|---|---|
| `scripts/provision-workspace.ts` | 新增（§2；基线纪律：TS 单文件零依赖，0/3/64，stdout 只 JSON） |
| `workspace-skills/_shared/provisioning.json` | 新增（§3.2） |
| `scripts/sync-workspace.ts` | 执行层小改：hash 预比对跳过未变文件 + `--check` 检测模式（§1.3），语义不变 |
| `docs/workspace-skill-portability-plan.md` | §7 删除"对象创建不自动化"条目（本文档落库时先行标注，实施时改写 §5 迁移场景为两条命令） |
| 各 Agent README | "Multica 注册方式"段改写为"provision 脚本注入，本节为字段来源说明"；注册记录表维持人工登记（overlay 权威不变） |
| `CLAUDE.md` | 迁移指引改写为 provision → sync 两条命令 |
| 9+2 个 Skill / 6 个 Agent 的脚本与契约 | **零改动** |

## 5. 关键场景语义

| 场景 | 行为 |
|---|---|
| 迁移新工作区 | `workspace create`（或 `--create-workspace`）+ 确认 runtime → `provision --workspace <name> --slug <slug>` → `sync-workspace --workspace <name>` → 完；Autopilot trigger 需要时手工 `trigger-add` 一条 |
| 改 Skill 内容 | 改仓内 → `sync-workspace`（现状不变） |
| 改 Agent instructions / 绑定 / Squad instructions / Autopilot prompt | 改仓内 → 重跑 `provision` → update-if-drift 纠回（`updated` 列明） |
| 平台被手工改动 | 下一次 provision / sync 自动覆盖纠回；只审计不改 → `sync-workspace --check` |
| 中途失败（断网/KILL） | 重跑 provision：已建对象复用不重建，overlay 断点续写，exit 3 列明剩余缺项 |
| 部分注册的工作区 | reconcile 天然支持：缺什么建什么，与 overlay 渐进注册语义一致 |
| 多工作区并存 | 每工作区一次 provision；overlay 各自独立；互不影响 |

## 6. 验收（P 系列，2026-10-21 实测全过；测试工作区 = 1021_test `4ade3a5c-865a-4ce9-a388-087a0026a1bd`）

| # | 用例 | 预期 | 实测（2026-10-21） |
|---|---|---|---|
| P-1 | 空场全流程 | provision 后：21 对象建成，overlay 14 ID 齐备且与平台 list 逐一对得上 → sync 全过（hash 回读一致） | ✅ provision：skill×11 / agent×6 / squad×1（+成员×3）/ project×1 / autopilot×2 全建，overlay 一次写入 14 ID；sync 11 Skill PASS |
| P-2 | 幂等 | 重跑 provision：零 created/updated，全部 unchanged，overlay 无 diff，exit 0 | ✅ 21 对象全 unchanged，overlay git diff 为空 |
| P-3 | 偏差 4 场景 | 模拟中途失败 → 重跑 → 已建对象复用不重建、ID 不丢，overlay 最终完整 | ✅ manifest 注入非法 autopilot mode → step 6 失败：exit 3 列明原因且 `overlay_written: true`（已获 ID 落盘）；恢复 manifest 重跑 → PASS 零重复创建，平台 mode 保持 run_only |
| P-4 | 对拍 | 与对拍基准逐对象比对（绑定/成员/instructions 语义等价） | ✅ 与**北落师门现役实例**逐 agent 比对：6 agent 绑定清单完全一致。**附带发现**：1020_test（MG-5 手工注册）欠绑定 5 处（Lead 缺 delivery-flow/delivery-gate/pull-request，Backend 缺 pull-request，Analyst 缺 delivery-gate）——手工注册漂移的实证，对拍基准据此裁定为北落师门 |
| P-5 | dry-run | 零创建零写盘，预演清单准确 | ✅ 空场 dry-run：21 对象列入 created，`overlay_written: false`，磁盘无 overlay 文件 |
| P-6 | 漂移纠正 | 平台侧手工改一个 Skill 文件 + 一个 Agent instructions → 重跑 → 分别列入 updated 并回读一致；`--check` 能只读报告漂移（exit 2） | ✅ agent update 注入篡改 instructions → provision 报 `updated: agent/TFS Sync Agent (instructions)` 并纠回；files upsert 注入篡改文件 + 多余文件 → `sync --check` 报 DRIFT exit 2 逐条列明 → 正常 sync 重传纠正 + delete 多余 → 再 `--check` PASS |
| P-7 | unmanaged_remote | 平台侧手工建一个仓内未声明的对象 → 重跑不删，列入 unmanaged_remote | ✅ 手工建 `stale-manual-skill` → provision 列 `unmanaged_remote: [skill/stale-manual-skill]`，对象仍在（事后已手工清理） |

**实施偏差（与方案文字不一致处，均为对齐实测 CLI 行为）**：

1. **skill 各子命令按 CLI 默认工作区解析**（0.6.1 实测：`skill get` / `files list` 不带 `--workspace-id` 时跨工作区报 not found）——sync-workspace.ts 全部平台调用注入显式 `--workspace-id <overlay.workspace_id>`（红线 2 对齐；属存量潜在缺陷修复，非新增语义）；
2. **manifest 无 `model` 字段**：现行实例 `model=""`（runtime default），agent create 不传 `--model`（§8.3 关闭）；
3. **Agent 漂移比对免单独 get**：`agent list` 输出直接含 instructions/description/skills/visibility 全字段；SKILL.md 漂移用 `skill get` 的 `content_hash` 比对（替代无条件 update）；
4. **文本比对归一化**：仓内文件读入统一去 BOM、CRLF→LF，比对忽略行尾空白（平台回读无尾换行，防假漂移）；
5. `autopilot list` 输出为 `{autopilots: [...]}` 包装形状（与 files list 裸数组不同），脚本兼容两种形状；
6. §8.4 裁定：`--check` 随一期并入 sync-workspace（纯检测 exit 2，P-6 覆盖）；hash 预比对上线后收敛工作区全量 sync 从"全量重传"降为"44 文件全跳过零写入"（北落师门回归实测）。

## 7. 明确不做

- Autopilot **trigger 自动添加**（MG-5 安全纪律：防 cron 误触发真实 TFS 同步；trigger-add 手工一条）；
- 平台**对象级删除/归档**自动化（unmanaged_remote 只列明，人工处置；波及 Run 历史，风险不对等）；
- 反向同步（平台 → 仓内 pull）与双向合并（§1.1，结构性排除）；
- 记忆式 diff / 本地同步状态记录（§1.2）；
- README 注册记录表自动生成（文档性质，overlay 权威不变）；
- 机器层 overlay 拆分、存量 Issue 跨工作区迁移（portability §7 既定，不受影响）。

## 8. 开放问题 / 裁定点

1. ~~一期范围~~ **已裁定（2026-10-21）**：全做（Skill/Agent/Squad/Autopilot/Project）。
2. ~~Agent/Squad/Autopilot 漂移语义~~ **已裁定（2026-10-21）**：update-if-drift 全对象收敛。
3. ~~manifest 中各 Agent 的 `model` 值~~ **已关闭（2026-10-21 实测）**：现行实例 `model=""`（runtime default），manifest 不设 model 字段，agent create 不传 `--model`。
4. ~~`--check` 是否随一期并入 sync-workspace~~ **已裁定（2026-10-21）**：并入（P-6 覆盖）。
5. ~~`agent update` / `autopilot update` 字段级 flag 形状~~ **已关闭（2026-10-21 核验）**：均为内联字符串 flag（无 file 注入），instructions ≤5.5KB 内联可行；`agent skills set --skill-ids` 逗号分隔替换式；`squad member add --member-id --type agent`。
6. ~~`project.title` 的权威值~~ **已关闭（2026-10-21 实测）**：`WN Platform 交付`（北落师门 c1255c2d），已回填 manifest。
7. Squad 成员范围：manifest 现列 3 成员（仓内有资产者）；Flink Engineer / Verify Agent 待其 agent 资产入仓后再加入 manifest。
