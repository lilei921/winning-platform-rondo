# 资产同步操作手册（rondo workspace provision / sync 双命令）

> 定位：仓维护日常操作手册。方案权威：`docs/workspace-provisioning-plan.md`（对象供给 + 收敛模型）、
> `docs/workspace-skill-portability-plan.md`（配置分层 + 渲染同步）；冲突时以方案原文为准。
> 适用对象：在本仓维护 Skill / Agent / Squad / Autopilot 资产、或向新工作区迁移的人。

## 1. 两个脚本的分工（先记住这张表）

| | `rondo workspace provision` | `rondo workspace sync` |
|---|---|---|
| 管什么 | 平台**对象**：有没有、配置对不对 | Skill **内容**：每个文件与仓内是否逐字节一致 |
| 操作 | 建对象、update-if-drift 纠配置、生成 overlay | 渲染 config、upsert 文件、删平台多余文件、hash 回读校验 |
| 寻址 | 按**名字**（manifest 声明） | 按 **ID**（overlay 映射） |
| 删除语义 | **不删对象**（多出只列 `unmanaged_remote`） | 删文件（平台多出仓内没有的 → delete） |
| 何时跑 | 低频：迁工作区、改 Agent/Squad/Autopilot 资产 | 高频：每次改 Skill 内容后 |
| 依赖 | 无 | **依赖 provision 生成的 overlay** |

顺序固定：**先 provision（建对象拿 ID 写 overlay）→ 后 sync（按 overlay 寻址传内容）**。

类比：provision 是开店（注册、摆货架、贴门牌），sync 是上货（每天摆最新商品、撤过期品）。

## 2. 前置环境

```bash
export PATH="$PATH:/c/Users/ThinkBook/.multica/bin"   # Git Bash 每会话一次
node --version                                        # 普通 LTS 即可（rondo 运行 tsc 产物）
rondo --version                                  # 机器已安装（tools/rondo，npm link 或全局 tgz）
multica workspace list                                # 确认已登录
```

**脚本不依赖 CLI 默认工作区**（全部命令显式 `--workspace-id`），但手工跑 CLI 时注意 `multica config get` 里的默认工作区指向，避免误操作。`rondo workspace sync` 还要求 monorepo 根仓存在 `docs/config/repo-context.yaml` 与 `tools/repo_registry.py`，并能执行 Python；缺失或映射非法时 UNKNOWN、零写入。

## 3. 日常场景

### 3.1 改了 Skill 内容（scripts/ config/ references/ SKILL.md）

```bash
rondo workspace sync --workspace <name>              # 全部已登记 Skill
rondo workspace sync --workspace <name> --skill tfs-sync   # 只同步一个
```

hash 预比对只传变化的文件；平台被手工加的文件会列入 `deleted_remote` 并删除（仓内为准）。
**多工作区并存时，每个工作区各跑一次。**

若新增 Skill 同时修改了 `rondo` 的配置生成逻辑，发布前须确认实际使用的 CLI 已包含该修改，再做定向预览：

```bash
rondo workspace sync --workspace <name> --skill bug-delivery --dry-run
```

预览的 `rendered` 必须包含 `bug-delivery/config/repo-registry.json`；仅有 `result=PASS` 不能证明配置已生成。同步后回读该 Skill 的文件清单和配置内容，确认配置存在、工作区与仓库映射正确。不要用更新正在执行的 Agent 的 CLI 或技能目录来补救发布缺件；对已发布 Skill 定向补齐文件，已有运行保持原环境。

### 3.2 改了 Agent / Squad / Autopilot 资产（agents/ squads/ 下的 md，或 manifest）

```bash
rondo workspace provision --workspace <name>
```

不一致的字段列入 `updated` 并纠回（instructions/description/visibility/绑定/成员/prompt）。
绑定关系改 `workspace-skills/_shared/provisioning.json` 的 `skills` 数组（替换式收敛）。

### 3.3 审计平台漂移（只看不改）

```bash
rondo workspace sync --workspace <name> --check     # exit 0 收敛 / exit 2 有漂移，逐条列明
```

### 3.4 clone 后 / 换机器本地运行

```bash
rondo workspace sync --workspace <name> --local-only   # 只渲染 config 写本地，不动平台
```

rondo 命令报"无法读取配置"就是忘了这步。

### 3.5 迁移新工作区（完整 runbook）

```bash
# 0. 仅两件手工事：建工作区 + 确认 runtime
multica workspace create --name 1022_test --slug 1022-test
multica runtime list --workspace-id <uuid> --output json        # 为空则先在目标工作区注册 runtime

# 1. dry-run 预演（零创建零写盘）
rondo workspace provision --workspace 1022_test --slug 1022-test --dry-run
#    预期：21 对象列 created，overlay_written=false，磁盘无 1022_test.json

# 2. 正式 provision（建对象 + 生成 overlay，全程零抄 ID）
rondo workspace provision --workspace 1022_test --slug 1022-test
#    预期：created 21 项 + squad 成员 ×3；workspaces/1022_test.json 生成 14 个 ID

# 3. 内容同步
rondo workspace sync --workspace 1022_test
#    预期：7 份 repo-registry + 1 份 sync-config 渲染 + 11 Skill 全量同步 + hash 回读一致

# 4. 验证收敛
rondo workspace provision --workspace 1022_test        # 幂等：应全 unchanged
rondo workspace sync --workspace 1022_test --check     # 审计：应 PASS 零漂移

# 5.（需要时）Autopilot 加 trigger——永远手工，防 cron 误触发真实 TFS 同步
```

### 3.6 接新业务仓 / 搬根目录 / 换机器

- **接新业务仓**：在 monorepo 根仓 `docs/config/repo-context.yaml` 登记 `repo_id/repo_path` 与语义字段；需要 PR/TFS 交付时，再在 `workspace-skills/_shared/repo-registry.base.json` 的 `delivery` 增加同 `repo_id` 的 `tfs_repo/default_target_branch`（base 不再维护第二份仓库映射）→ 每个已登记工作区各跑一次 §3.1 的 sync；
- **搬根目录 / 换机器**：仓内零改动——根仓路径事实源是平台项目 `local_directory` 资源。在平台把项目资源改挂到新路径/新 daemon，再跑一次 §3.10 部署检查即可。

### 3.10 多 daemon 部署与 MULTICA_DAEMON_ID（multi-daemon-root-repo-resolution-plan 阶段 3）

根仓路径运行时由 rondo 按 Issue/Project → 平台 `local_directory` 资源解析；多 daemon 同项目时靠 **`MULTICA_DAEMON_ID` 部署变量**消歧（非敏感、非路径）。

**新 daemon 上线 runbook**：

```bash
# 1. 启动 daemon，确认 Runtime 注册，取其 daemon_id
multica runtime list --workspace-id <ws> --output json | grep daemon_id

# 2. 平台侧：为项目挂载该 daemon 的 local_directory（in_place），每 daemon 每项目至多一条
multica project resource add <project-id> --type local_directory   --daemon-id <daemon-id> --local-path <本机根仓绝对路径> --execution-mode in_place

# 3. 本机持久化部署变量（Windows 用户级；Linux 写 daemon 的 service/shell 环境）
setx MULTICA_DAEMON_ID <daemon-id>        # 持久化；当前已开的进程不继承

# 4. 重启 daemon（让它继承新环境变量），然后跑部署检查
rondo workspace check-daemon --workspace-id <ws>
#    预期 PASS：daemon_env / daemon_registered / mount_uniqueness / delivery_affinity 四项全过
```

**纪律**：多挂载项目未配置 `MULTICA_DAEMON_ID` 时 resolver 一律 UNKNOWN（exit 3），不猜测；`delivery_affinity` FAIL（同一项目交付链路跨 daemon）时先调整 Agent→Runtime 绑定再投产，不强行跑。

### 3.7 新增 Skill / Agent

- **新增 Skill**：建 `workspace-skills/<name>/`（SKILL.md 含 frontmatter name+description）→ 各工作区跑 provision（建对象）+ sync（传内容）→ 需要绑定的在 manifest 对应 agent 的 `skills` 里加名，再跑 provision；
- **新增 Agent**：建 `agents/<dir>/`（description.md + instructions.md）→ manifest `agents` 加条目（dir/显示名/visibility/绑定清单）→ 各工作区跑 provision；
- **Squad 新成员**：先入 Agent（上一步）→ manifest `squad.members` 加显示名 → provision。

### 3.8 故障与断点恢复

provision 中途失败（断网/掐断）：**直接重跑同一条命令**。已建对象按名复用不重复创建，已获 ID 已落盘 overlay，exit 3 的输出列明缺项。无状态可腐坏——脚本不记任何"上次进度"，比对依据永远是平台实际状态。

### 3.9 清理测试工作区

对象级删除有意不自动化（波及 Run 历史）。手工：平台上归档/删除该工作区 → 删本地 `workspaces/<name>.json` → 完。

## 4. 安全网三件套

| 动作 | 命令 | 效果 |
|---|---|---|
| 干跑预演 | `workspace provision … --dry-run` | 零创建零写盘，输出 created/updated 预演清单 |
| 幂等重跑 | 同命令再跑一遍 | 已收敛对象全 unchanged，零副作用 |
| 漂移审计 | `workspace sync … --check` | 零写入，exit 2 逐条列平台与仓内的差异 |

## 5. 纪律与边界（违反即评审打回）

1. **仓内 = 唯一权威，方向永远仓内 → 平台**。平台手工改动一律视为待纠正事故；确需保留的改动，先人工搬回仓内再走同步，脚本永不做反向 pull；
2. **overlay 只由 provision 写**（它是唯一写入者），不手工编辑 ID；README 注册记录表是人工登记，以 overlay 为准；
3. **Autopilot trigger 永远手工加**（防 cron 误触发真实 TFS 同步）；
4. **平台对象不手工删脚本也不管**——`unmanaged_remote` 列出的多出对象人工处置；
5. 退出码约定：0 PASS / 2 漂移（--check）/ 3 UNKNOWN（列明原因，修复后重跑幂等）/ 64 用法错误。

## 6. 命令速查

| 目的 | 命令 |
|---|---|
| 迁移新工作区 | `rondo workspace provision --workspace <n> --slug <s>` → `rondo workspace sync --workspace <n>` |
| 改 Skill 后同步 | `rondo workspace sync --workspace <n> [--skill <s>]` |
| 改 Agent/Squad/Autopilot 后收敛 | `rondo workspace provision --workspace <n>` |
| 只渲染本地运行 | `rondo workspace sync --workspace <n> --local-only` |
| 漂移审计 | `rondo workspace sync --workspace <n> --check` |
| daemon 部署检查（R-14 亲和） | `rondo workspace check-daemon --workspace-id <id> [--project-id <id>]` |
| 干跑预演 | provision/sync 加 `--dry-run`（sync 的 dry-run 只覆盖渲染 diff） |
