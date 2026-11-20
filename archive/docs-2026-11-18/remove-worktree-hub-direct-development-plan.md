# 去除业务仓 worktree 模式落地方案（契约 + Skill 层，脚本不动）

> 日期：2026-11-03。范围：**只改 `projects/multica/workspace-skills/` 下的契约与 Skill 文档**；`tools/skill-flow` 脚本一行不动。目标：业务仓研发从「每 Issue×仓 应用层 worktree」改为「枢纽克隆内直接切分支开发」，同时补上失去隔离后的并发纪律。

## 1. 背景

现行模式：派发后 `skill-flow pr worktree create` 在 `<root_repo>/.worktrees/<issue>-<repo_id>/` 建独立工作树，checkout `feat/<tfs-id>`，finalize 时回收。契约权威为 `pull-request/references/worktree-isolation-contract.md`。

目标模式：Engineer 直接在常驻枢纽克隆 `<root_repo>/<repo_path>/` 内 `switch -c feat/<tfs-id>` 开发、提交、推送；PR 合并后由现有 finalize 把枢纽切回目标分支并 `branch -d` 清理。

附带收益：worktree 模式下空工作树无依赖，Engineer 须手工为 node_modules 做 junction 才能跑 lint/build（WNDF-43 实测耗时环节）；枢纽直检后依赖现成，本地验证摩擦下降。

## 2. 脚本兼容性依据（已核实，脚本零改动可行）

| 脚本 | worktree 相关行为 | 新模式下 |
|---|---|---|
| `delivery/finalize.ts` | worktree 回收段有 `if (existsSync(wt))` 守卫 | worktree 不存在即静默跳过；「枢纽对齐 target → ff-only → branch -d」段天然适配新模式，且变为必经路径 |
| `tfs/writeback.ts` | repo_path 反解：枢纽路径与 worktree 路径为 OR 关系 | evidence `repo_path` 写枢纽路径即可解出 repo_key |
| `dev/check-completion.ts` | repo_path 白名单：枢纽路径与 `.worktrees` 子目录并列合法 | 枢纽路径照样 PASS |
| `pr/worktree.ts` | 独立命令，无其他命令调用 | 成为死代码，留着无害；删除留待下次 CLI 发版顺手做，不在本方案 |

结论：流程语义完全由 Skill 层承载，薄适配器架构下脚本向后兼容，不需要同步发版。

## 3. 新模式操作语义（写进契约的内容）

**开工（替代 worktree create，Engineer 在 Ground 阶段执行）**：

```bash
git -C <root_repo>/<repo_path> fetch origin
git -C <root_repo>/<repo_path> status --porcelain   # 必须为空；非空 → UNKNOWN 停止，不自行清理
git -C <root_repo>/<repo_path> switch -c feat/<tfs-id> origin/<目标分支>
# 分支已存在（上次在途）→ switch feat/<tfs-id> 挂接即可，不自动 rebase 目标分支
# （与旧 worktree create「分支已存在 → 直接挂接」行为一致；目标分支已前进需同步时交 Lead 语义决策）
```

缺少 `default_target_branch` 时必须显式给出目标分支，不猜默认分支（沿用原 worktree create 的纪律）。

**收尾（现有 finalize 已覆盖，无需新步骤）**：`switch <target_branch>`（脏树 → UNKNOWN 拒切）→ `pull --ff-only` → `git branch -d feat/<tfs-id>`（绝不 -D）。

**三条新增硬纪律**（替代 git 强制的同分支互斥与工作树隔离）：

1. **同仓串行**：同一 daemon 上同一业务仓同一时刻只允许一个在研 Issue。派发侧（delivery-flow）打中已在研仓时排队或改派，不并发进场（判据与动作见 §4.8）。
2. **净树开工、净树收尾**：开工前 `status --porcelain` 为空才允许 `switch`；研发结束提交并推送干净后才报 READY。枢纽脏树会让 finalize UNKNOWN，属安全行为但会卡人工。
3. **分析侧只读远端引用**：研发期间枢纽克隆躺在 `feat/<tfs-id>` 上，工作树内容是在研状态。Analyst / 探索类 Run 读取业务仓时一律以 `origin/<目标分支>` 引用为准（`git show origin/<branch>:<path>`、`git log origin/<branch>`），不读工作树当前文件，避免把别人在研分支的内容当作交付事实。

## 4. 逐文件改动清单

### 4.1 `pull-request/references/worktree-isolation-contract.md`（改名 + 整篇改写）

- **文件改名**为 `repo-write-isolation-contract.md`：改写后语义已与 worktree 无关，保留旧名会诱导 Agent 按文件名猜语义。引用方仅 4 处（`pull-request/SKILL.md`、`development-execution/SKILL.md`、`frontend/backend-engineering/SKILL.md`），同步更新（见 4.2/4.3/4.5）。

- 标题改为「并发写隔离契约：根仓临界区串行 + 业务仓枢纽直检分支（冻结）」，冻结日期更新为改写日。
- 保留「背景」段（平台 in_place 事实不变），删除其中「嵌套业务仓吃不到」推导出的 worktree 结论。
- 隔离策略表「业务仓」列：`应用层自建 worktree` → `枢纽克隆内直接 checkout 每 Issue 特性分支 + 同仓串行派发 + 净树开工/收尾纪律`。
- 目录结构图：删 `.worktrees/<issue>-<repo_id>/` 行；`<repo_path>/` 注释从「fetch 枢纽（不开发）」改为「常驻枢纽 = 唯一工作树，研发在其内切特性分支进行」。
- 要点改写：
  - 原 0（目录约定）：保留 repo-context 权威与挂载点内纪律，删 worktree 路径约定；
  - 原 1（脚本职责）：改为「分支创建/对齐/清理由 finalize 等确定性脚本收口，开工切分支为 Agent 按契约执行的三步（fetch / 净树检查 / switch）」；
  - 原 2（同分支互斥）：改为「git 不再强制互斥——解法单元是**同仓串行派发 + 净树检查**，不是共享分支」；
  - 原 3（语义冲突谁也无解）：原样保留；
  - 原 4（落地状态）：改为「2026-11-03 起业务仓研发改为枢纽直检分支；`skill-flow pr worktree` 命令保留但不再使用（死代码，待 CLI 发版移除）；`.worktrees/` 遗留目录由人工核查清空后删除」。

### 4.2 `pull-request/SKILL.md`（摘除 worktree 职责）

- frontmatter description：删「与业务仓 worktree 生命周期管理」及「Engineer 研发开工建工作树（worktree create）也用本 Skill」，收缩为纯 PR 物化。
- L13 前置：删「worktree create 不以 `pr_prep` 为前置条件」。
- Procedure：删 L27-35 整个「worktree 生命周期」命令段。
- Validation：删 L40-41 worktree create/remove 两条。
- Output：删 L46 `skill-flow pr worktree` 输出契约。
- Error Handling：删 L53「worktree 冲突（同分支被占用）UNKNOWN，不擅自换分支」。
- L8 括号内契约引用路径更新为 `references/repo-write-isolation-contract.md`（契约改名，见 4.1）。

### 4.3 `development-execution/SKILL.md`（L30 开工步骤替换）

「业务仓工作树」一条整段替换为「业务仓分支准备」：

> 在枢纽克隆 `<root_repo>/<repo_path>/` 内按 `pull-request` Skill 的并发写隔离契约（`references/repo-write-isolation-contract.md`）执行开工三步：`fetch origin` → `status --porcelain` 为空（非空 → UNKNOWN 停止，不自行清理）→ `switch -c feat/<tfs-id> origin/<目标分支>`（分支已存在则 `switch` 挂接即可，不自动 rebase 目标分支——与旧 worktree create 行为一致；目标分支已前进需同步时回流 Lead 语义决策）。研发全程在该枢纽克隆内进行；同一业务仓同一时刻仅允许本 Issue 在研（同仓串行）；收尾前提交并推送干净。

### 4.4 `development-execution/references/development-evidence-contract.md`（两处口径）

- L47 `commits[].repo_path`：删「或 worktree 路径 `root_repo/.worktrees/<issue>-<repo_key>`」，只留枢纽路径。
- L48：删「及 `root_repo/.worktrees/<直接子目录>`」，业务仓范围只写 `root_repo/<已登记 repo_path>`。

### 4.5 `frontend-engineering/SKILL.md`、`backend-engineering/SKILL.md`（L17 相同一行）

「目标业务仓 worktree（研发一律在 worktree 内进行；…）」→「目标业务仓枢纽克隆 `<root_repo>/<repo_path>/`（研发在其内切特性分支进行；契约唯一权威：`pull-request/references/repo-write-isolation-contract.md`）」。

### 4.6 `frontend/backend-engineering/references/local-validation.md`

- frontend L12 标题：「（在 worktree 根执行）」→「（在业务仓枢纽克隆根执行）」。
- backend L14 表头「命令（在 worktree 根执行）」同样改写。

### 4.7 `workspace-skills/README.md`（L20）

pull-request 行描述：「将 PR Preparation Facts 物化为 PR，并管理业务仓 worktree 生命周期。」→「将 PR Preparation Facts 物化为 PR。」

### 4.8 派发侧约束落点（`delivery-flow/SKILL.md`）

「同仓串行」需要派发环节执行。delivery-flow 的派发物化是确定性脚本（「脚本不发明派发策略，语义归 Lead」），因此本约束写成 **Lead 的派发前语义预检**，在 `delivery-flow/SKILL.md` 派发物化段补一条：

> **同仓串行预检（Lead 派发前执行）**：对本次派发涉及的每个业务仓执行 `git -C <root_repo>/<repo_path> rev-parse --abbrev-ref HEAD`；结果非该仓 `default_target_branch`（即枢纽躺在某 `feat/<tfs-id>` 上）视为同仓在研。同时核对 Issue metadata `dev.dispatch` active 条目的仓集合。任一命中时不并发派发：排队等前序 Issue finalize（枢纽切回目标分支即释放），或改派其他仓的任务。脚本不校验本约束，属 Lead 语义职责。

此为新增条目，属本方案的必要配套，不是脚本改动。

### 4.9 分析侧只读约束落点（`codebase-explorer/SKILL.md`）

在 `codebase-explorer` 的读取纪律中补一条（对应 §3 纪律 3）：

> 读取业务仓源码时以 `origin/<目标分支>` 引用为准（`git show origin/<branch>:<path>` / `git log origin/<branch>`），不以枢纽克隆工作树当前状态为准——研发期间工作树可能躺在在研特性分支上。

### 4.10 `06-method-skill-library-implementation-design.md`（文首废止注记）

06 是现行设计文档且含 worktree 叙述，不改全文，仅在文首加一行注记消除漂移源：

> 注：业务仓 worktree 模式已于 2026-11-03 废止，并发写隔离以 `pull-request/references/repo-write-isolation-contract.md` 为准；本文相关叙述仅作历史背景。

## 5. 同步与验收

1. 上述文件改完后执行漂移检查：`skill-flow workspace sync --workspace wn_df --check`（只同步 wn_df，不动其他工作区）。
2. `skill-flow workspace sync --workspace wn_df` 发布。
3. 引用完整性检查：全仓 grep `worktree-isolation-contract` 应只剩历史档案命中；4 处引用方均指向新文件名。
4. 验收（下一个真实 Issue 端到端）：
   - Engineer Run 开工三步执行成功，evidence `commits[].repo_path` 为枢纽路径；
   - `dev check-completion --issue --registry-config` PASS；
   - PR 合并后 finalize 完成枢纽对齐与 `branch -d`，无 worktree 相关 UNKNOWN；
   - tfs-writeback commit↔任务关联成功（repo_key 反解命中枢纽路径）。
5. 历史 `.worktrees/` 目录人工核查无未提交工作后删除；根仓 `.gitignore` 的 `.worktrees/` 条目保留无害，可顺手清理。

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 同仓并发 Issue 共享工作树互相污染（未提交改动互见、分支互踩） | 同仓串行派发（4.8）+ 开工净树检查；finalize 脏树 UNKNOWN 兜底防吞工作 |
| 分析 Run 读到同仓在研分支内容，归属/实现事实张冠李戴 | 分析侧只读 `origin/<目标分支>` 引用（§3 纪律 3，落点 4.9） |
| finalize UNKNOWN 概率上升（Engineer 未提交干净） | 「收尾净树」写成硬验收，READY 前必查 |
| 旧契约/死代码诱导 Agent 走回 worktree | 契约改名 + 整篇改写（不留活口）；`pr worktree` 从 Skill 文档全量摘除 |
| 在途 Issue（已建 worktree）切换期混合态 | 在途 Issue 按旧模式走完 finalize（回收段有守卫，自然兼容）；新 Issue 一律新模式 |

## 7. 不在范围

- `tools/skill-flow` 脚本删除/修改（`pr/worktree.ts`、`index.ts` 注册、finalize 回收段、check-completion / writeback 的 worktree 分支）——留待下次 CLI 发版；
- Multica 平台配置（execution_mode 本就为 in_place，无需动）；
- `archive/`、`logs/`、`validation/` 历史档案；
- 根级编号设计文档的正文叙述更新（06 仅加文首废止注记，见 4.10；02/04 已核实无 worktree 引用）。
