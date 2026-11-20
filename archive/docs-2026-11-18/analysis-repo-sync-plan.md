# analysis-repo-sync 方案（分析阶段业务仓基线对齐）

> 注：业务仓 worktree 模式已于 2026-11-03 废止（契约：`workspace-skills/pull-request/references/repo-write-isolation-contract.md`）。本文「Engineer 在 `.worktrees/` 开发、主检出停在默认分支」的假设不再成立——研发期间枢纽克隆躺在特性分支上，分析侧读取一律以 `origin/<目标分支>` 引用为准。本文其余内容仅作历史背景。
>
> 状态：**待裁定，暂不开发（2026-10-28）**。
> 上游权威：AGENTS.md §4（代码定位）/§6（实施与验证）；02 设计 §12.2（工作区对齐纪律：ff-only、禁强删）；01 设计（Deterministic First、Native First）。
> 前置事实：分析链路已核实（2026-10-28）——分析读取的是 daemon 主机持久本地检出（平台项目 local_directory 资源），非 bootstrap per-Run 工作区；全链路无任何"分析前拉取最新"步骤，唯一 `git pull --ff-only` 在 finalize §12.2 合并后对账。

## 0. 背景与定位

**现状缺口**：`workitem-analysis` Procedure 第 1 步要求"读取相关仓库现状"，但实际读到的是 daemon 主机持久检出的**当前残留状态**：

```text
workitem-analysis Procedure 第1步（SKILL.md:21）
  → skill-flow runtime resolve-root-repo          # resolve-root-repo.ts：纯路径解析，零 Git 写操作
  → 根仓 = 平台项目 local_directory(in_place) 资源  # runtime 主机持久检出
  → 读根仓 docs/config/repo-context.yaml 选仓
  → 按 repo-registry.json 的 repo_path 进入业务仓读代码   # 无 fetch/pull，读到什么算什么
```

**后果**：Issue 被打回重跑分析、或同主机检出被多 Issue 复用时，分析结论建立在过时代码上——可能判断"bug 还在""函数不存在"，而 dev 实际已修复；整个 Analysis Package 失真。

**需求**：执行业务仓代码分析之前，获取当前默认分支最新代码。

**定位**：仓维护侧确定性脚本 + Skill 编排修订；不改变 Gate 契约、facts 契约、bootstrap 工作区模型、finalize §12.2。

## 1. 需求语义界定

| 概念 | 界定 | 事实源 |
|---|---|---|
| 当前默认分支 | 每仓 `default_target_branch`（当前全部为 `dev`） | 渲染版 `repo-registry.json`（投影自 `_shared/repo-registry.base.json` delivery overlay），禁止 Agent 用 `git remote show` 自行猜测 |
| 执行分析之前 | workitem-analysis Procedure 第 1 步"读取相关仓库现状"之前 | SKILL.md 插入点 |
| 获取最新 | `fetch --prune` + `switch <default_branch>` + `pull --ff-only` 三步 | 见 §3 选型理由 |
| 禁止操作 | `reset --hard` / `clean -fd` / `branch -D` / stash / 自动 commit | 与 §12.2 纪律一致 |

## 2. 选型：fetch 与 pull 不是二选一

**不能只用 fetch**：fetch 只更新远端跟踪引用（`origin/dev`），工作树文件不动；而分析的三类读码工具——`rg`、`codegraph_explore` 索引、Agent 直接 Read——全部消费工作树。只 fetch 等于没做。

**不能只用 pull**：pull = fetch + merge 合一，裸用有三个问题：

1. **失败归因模糊**：拆开前，pull 失败无法区分网络问题（fetch 阶段）与本地状态问题（merge 阶段）；拆开后 UNKNOWN 报告可精确到"卡在哪"；
2. **失去变更前检查点**：fetch 后可先比对 HEAD 与 origin/dev——相同则跳过 pull（省锁占用）；落后则先查工作树干净再 pull；分叉则直接 UNKNOWN（比让 git 报错清晰）；
3. **重试经济性**：fetch 幂等无副作用，撞锁重试只重跑 fetch；pull 变为纯本地操作。

**结论**：三步串联，各步失败语义独立：

```text
git fetch --prune origin     ← 拿最新账本 + 清幽灵分支（安全，可重试）
git switch <default_branch>  ← 确保站在默认分支（检出可能上次停在别处）
git pull --ff-only           ← 工作树快进到账本位置（唯一写工作树的操作）
```

## 3. 关键约束

1. **根仓不能无脑 pull**：02 设计明确"研发期间获准的 OpenSpec 修改保存到跨 Run 可读取的持久共享根仓工作区"——根仓工作树**合法持有在飞 Delivery 的未提交 WIP**。根仓对齐必须先 `status --porcelain` 查净，非净则 UNKNOWN 停止交 Delivery Lead，不 stash、不覆盖。
2. **业务仓主检出预期干净**：Engineer 在 `.worktrees/<issue>-<repo_id>/` 独立工作树开发（worktree-isolation-contract），主检出应停在默认分支。ff-only 对齐安全；若非净同样 UNKNOWN，不强清。
3. **并发**：同 daemon 主机多 Issue 的 Run 共享同一份检出。Git 锁文件（`.git/index.lock`、`refs/heads/*.lock`）保证最坏结果是一方报错退出而非脏数据；临界区秒级，撞锁概率低。**处理策略 = 脚本内带随机抖动的有限重试**（lock 类失败等待 2-10s 随机值，重试 ≤2 次，仍失败则 UNKNOWN），不新增分布式锁/队列。升级路径（实测撞锁频繁时）：分析改用每 Issue 只读 worktree（`worktree add --detach <dir> origin/<branch>`），契约与 Engineer 工作树同源，一期不做。
4. **失败语义**：任何一仓对齐失败 = UNKNOWN 停止，**不得静默用过时代码继续分析**——否则本需求形同虚设。
5. **残留死锁**：Run 被强杀可能留下 `.lock` 残文件导致后续持续报错；脚本 UNKNOWN 报告中须列明锁文件路径，人工确认无 git 进程后删除，脚本不自动删锁。

## 4. 方案设计

### 4.1 新增确定性命令 `skill-flow repo sync-defaults`

Deterministic First：对齐逻辑全在脚本，Agent 只做编排与选仓判断。

```text
用法：skill-flow repo sync-defaults --config config/repo-registry.json
        --root-repo <path> [--repo <repo_id> ...] [--include-root] [--all]
输入：repo-registry.json（渲染版，含 registry[repo_id].repo_path / default_target_branch）
行为（逐仓，repo 参数未给时按 --all/--include-root 决定范围）：
  1. git -C <repo> fetch --prune origin              # 失败（含锁）→ 抖动重试 ≤2 次 → UNKNOWN
  2. 比对 HEAD vs origin/<default_branch>
     相同 → 记 skipped（已最新），跳过后续
  3. git -C <repo> status --porcelain                # 非净 → UNKNOWN（列明路径，不动）
  4. git -C <repo> switch <default_branch>           # 已在该分支则跳过
  5. git -C <repo> pull --ff-only                    # 失败 → UNKNOWN
输出（stdout JSON）：{ result, repos: [{ repo_id, path, branch, action: synced|skipped,
                     head_before, head_after }], failures: [{ repo_id, stage, reason }] }
退出码：0 PASS（含全部 skipped）/ 3 UNKNOWN（逐仓列明 stage: fetch|dirty|switch|pull）/ 64 用法错误
纪律：stdout 只 JSON，日志走 stderr；锁类 UNKNOWN 须列明锁文件路径。
实现位置：tools/skill-flow/src/commands/repo/sync-defaults.ts（commander 注册，同 provision/sync 模式）
```

### 4.2 `workitem-analysis` SKILL.md 修订

Procedure 第 1 步前插入"**代码基线对齐**"（两阶段，选仓是 Agent 语义判断，脚本保持确定性）：

```text
0a. resolve-root-repo（既有）→ 得 root_repo / repo_context
0b. 根仓对齐：sync-defaults --include-root
    UNKNOWN → 停止，交 Delivery Lead（根仓可能持有他 Delivery WIP，不强行对齐）
0c. 读 repo-context.yaml（此刻起路由数据为最新）→ 语义选仓得候选 repo_id 集
0d. 候选仓对齐：sync-defaults --repo <id> ...
    UNKNOWN → 停止，交 Delivery Lead；不得在陈旧基线上继续分析
1.  Context Analysis（原第 1 步，此刻起读码 = 对齐后基线）
```

Error Handling 增补：对齐 UNKNOWN → 停止，Issue 列明失败仓与 stage，交 Delivery Lead；禁止跳过对齐直接分析、禁止改用本地残留状态。

### 4.3 `workitem-analyst` instructions.md 轻量补充

Execution Principles 增一条："**分析结论基于已对齐的默认分支基线**；基线对齐失败不得继续分析，基线 SHA 留痕可查。"角色定义、Boundaries 不动。

### 4.4 分析基线 SHA 留痕

对齐后每仓 `branch + head_after` 即分析基线。**建议落 OpenSpec Change 的 evidence 段**（沉工程事实的唯一的家），不进 Issue metadata——不动 Handoff Facts / Gate 契约。研发阶段对拍时有权威出处。

### 4.5（二期，可选）研发前对拍

Engineer 建 worktree 前复用 `sync-defaults` 对齐目标分支，并比对 `origin/<branch>` 当前 SHA 与分析基线 SHA：

- 一致 → 正常开工；
- 前进但 diff 不触及 Change 的 Fix/Regression Scope → 开工；
- 触及 → 停止交 Delivery Lead：定向返工 or 重返分析。

一期只留接口兼容（sync-defaults 输出含 head_after），对拍逻辑不在本期。

## 5. Issue 漂移场景处理矩阵

| 场景 | 处理 | 依赖 |
|---|---|---|
| A 已合并 dev，B 尚未分析 | B 对齐后自然读到含 A 改动的 dev | 本方案一期即可解决 |
| B 分析中途 A 合并 | 分析是快照语义，不追新；基线 SHA 留痕 + （二期）研发前对拍发现漂移 | §4.4 / §4.5 |
| B 分析结论被 A 整个失效（同 bug 已修） | Human `analysis_review` 审核 REJECTED 关闭；或二期对拍拦截 | 既有审核闸 |

## 6. 影响范围与不做的事

**改**：
- `tools/skill-flow`：新增 `commands/repo/sync-defaults.ts`（发新 tgz，runtime 主机正规安装）
- `projects/multica/workspace-skills/workitem-analysis/SKILL.md`：Procedure + Error Handling
- `projects/multica/agents/workitem-analyst/instructions.md`：一条 Execution Principle

**不改**：bootstrap（per-Run 工作区另一模型）、provision/sync 命令、analysis-completion / Gate / facts 契约、finalize §12.2、repo-registry 渲染结构（字段已够用）。

**生效路径**：Skill/Agent 改动后 `skill-flow workspace provision --workspace wn_df --slug wn-df`（agent instructions 漂移收敛）→ `skill-flow workspace sync --workspace wn_df`（SKILL.md 内容同步）。**只跑 wn_df**，不动北落师门与测试工作区（既定纪律）。

## 7. 验证方案（开发后）

| # | 场景 | 预期 |
|---|---|---|
| V-1 | 业务仓落后 origin/dev，跑 sync-defaults | synced，head_after == origin/dev，工作树干净 |
| V-2 | 已最新 | skipped，零写操作 |
| V-3 | 业务仓工作树有未提交修改 | UNKNOWN stage=dirty，工作树原样 |
| V-4 | 根仓持有他 Delivery 未提交 WIP | UNKNOWN stage=dirty（根仓），WIP 原样保留 |
| V-5 | HEAD 与 origin 分叉 | UNKNOWN stage=pull，无强制对齐 |
| V-6 | 两进程并发对齐同仓 | 一方撞锁重试后成功；重试耗尽则 UNKNOWN 且列明锁路径 |
| V-7 | 平台 Run 全链路：分析 Issue → 读码前各候选仓 HEAD == 当时 origin/dev | Change evidence 段基线 SHA 与远端一致 |
| V-8 | 对齐失败后重跑 | 幂等收敛，无半套状态 |

## 8. 待裁定决策点

| # | 决策点 | 建议 | 裁定 |
|---|---|---|---|
| D-1 | 对齐范围：仅候选仓（两阶段）vs 全量 27 仓 | 仅候选，`--all` 留备用 | 待定 |
| D-2 | 根仓非净策略 | UNKNOWN 停止，不 stash | 待定 |
| D-3 | 基线 SHA 载体 | 沉 Change evidence 段，不进 facts/Gate | 待定 |
| D-4 | 研发前对拍 | 二期，本期 sync-defaults 输出预留 head_after | 待定 |
| D-5 | 并发策略 | 一期有限重试；只读 worktree 作升级路径 | 待定 |

## 9. 实施顺序（裁定后）

1. `sync-defaults` 命令开发 + 本地夹具验证（V-1~V-6）；
2. skill-flow 打包安装至 runtime 主机（tgz 正规安装，daemon 无需重启——命令由 Run 内进程调用）；
3. SKILL.md / instructions.md 修订；
4. provision（agent 漂移收敛）+ sync 至 wn_df；
5. 平台真实 Issue 全链路验证（V-7/V-8）。
