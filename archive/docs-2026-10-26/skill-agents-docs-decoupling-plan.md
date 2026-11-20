# workspace-skills / agents 对 docs/ 规范引用脱钩方案

- 日期：2026-10-26
- 状态：已实施（2026-10-26，阶段 0–5 完成；本文件随 docs/ 归档）
- 背景来源：TFS 259862 复盘 → AGENTS.md 治理讨论 → multica 资产引用现状分析

## 1. 背景与问题

`projects/multica/docs/` 定位为**文档与方案**（历史过程资产），后续可能整体删除。但当前 `workspace-skills/` 与 `agents/` 中存在大量指向 docs/ 的**规范性引用**——技能把方案文档当契约本体、把 docs/ 独有的操作指南当现行权威。docs/ 一旦删除，删除的不只是历史，还包括现行规范本身。

已确认的三类问题：

1. **规范本体在方案文档里**：Refs 尾注格式的"规范全文"指向 `docs/tfs-task-commit-linkage-plan.md` §4.2；tasks.md 预估尾注规则指向 `docs/tfs-state-writeback-plan.md` §4.7。方案删除 = 规范丢失。
2. **现行操作指南只在 docs/ 存在**：`multica-delivery-operations-guide.md`（ops guide，§3.5 worktree 纪律被 5 个技能引用）、`agent-skill-review-checklist.md`（delivery-lead 修改纪律）在根级无对应物。
3. **权威关系倒挂**：backend/frontend 六个 references 文件以"内容权威：04 §x（照录）"开头，权威在 docs 快照可能混淆的设计文档，而非技能自身。

## 2. 目标状态

引用规则（脱钩完成后作为纪律写入相关 SKILL 与 AGENTS）：

1. `workspace-skills/` 与 `agents/` **禁止引用 `projects/multica/docs/` 下任何路径**（含版本化快照）。
2. 规范性内容的唯一权威位置是：**技能内部 `references/` 冻结契约** 或 **`skill-flow` 脚本实现**；设计文档（根级 01–07 现行版）只作语义背景，引用时注明"语义背景"，不作内容权威。
3. 历史溯源信息（设计依据、验收记录）允许保留，但必须标注"历史溯源"，且不得被执行路径依赖。
4. 根级编号设计文档（`projects/multica/01–07`）为现行版保留；docs/ 下版本快照随清理删除。

范围排除：`codebase-explorer`、`multica-workspace-bootstrap` 等引用的**根仓** `docs/config/repo-context.yaml`、`docs/router/` 是根工作区文档，不在本方案的"docs/"语义内，不改动。

## 3. 现状盘点（2026-10-26 基线）

### 3.1 docs/ 内容三分法

| 分类 | 文件 | 处置 |
| --- | --- | --- |
| 版本快照（根级已有现行版） | `01-...-v1.16.3.md`、`02-...-v1.6.6.md`、`04-...-v1.15.4.md`、`05-...-v1.5.3.md` | 阶段 4 删除 |
| 方案/plan（历史过程资产） | 各 `*-plan.md`、`00-design-docs-interpretation.md`、`*-alignment-2026-10-22.md`、`asset-migration-2026-10-22.md`、`flow-review-...md` 等 | 含规范的先提取（阶段 1），随后删除 |
| 操作指南/检查单（**非方案，docs/ 独有**） | `multica-delivery-operations-guide.md`、`tfs-cli-operations-guide.md`、`workspace-sync-operations-guide.md`、`agent-skill-review-checklist.md` | 逐节判定迁移（阶段 2），不直接删 |

### 3.2 规范性引用清单（A 类：规范本体在 docs/）

| 规范主题 | 当前权威位置 | 引用方 |
| --- | --- | --- |
| Commit `Refs:` 尾注格式 + 禁用关键字 | `docs/tfs-task-commit-linkage-plan.md` §4.2 | development-execution/SKILL.md §How-5、development-evidence-contract.md、backend/frontend-engineer README |
| `commit_task_links` 检查语义 | 同档 §4.4 | development-execution/SKILL.md §How-8 |
| TFS 需求状态回写（→已分析） | `docs/tfs-state-writeback-plan.md` §4.1 | analysis-completion/SKILL.md |
| TFS 任务解决回写 | 同档 §4.3 | delivery-flow/SKILL.md |
| tasks.md 写法（`[预估: Nh]` 必填、首分句 ≤30 字） | 同档 §4.7/§4.8 | delivery-gate/SKILL.md、workitem-analyst README |
| 并发写隔离 / worktree 纪律 / 枢纽克隆 | `docs/multica-delivery-operations-guide.md` §3.5 | development-execution、backend-engineering、frontend-engineering、pull-request、finalize-delivery（共 5 处） |
| 机器安装 / skill-flow 收编模式 | `docs/skill-flow-cli-plan.md` | delivery-flow、change-progress-script-contract.md |
| provision 字段来源说明 | `docs/workspace-provisioning-plan.md` | 4 个 agents README |
| workspace sync 同步纪律 | `docs/workspace-skill-portability-plan.md` | delivery-lead / pr-status-sync-agent / tfs-sync-agent README |
| multi-daemon 根仓解析 | `docs/multi-daemon-root-repo-resolution-plan.md` §4 | delivery-flow/SKILL.md |
| agents 修改前检查单 | `docs/agent-skill-review-checklist.md` | delivery-lead/README.md |

### 3.3 节号权威引用（B 类：指向编号设计文档）

- "内容权威：04 §5.2/§5.4/§7.2/§7.4/§8.3"：backend-engineering 与 frontend-engineering 共 6 个 references 文件；
- "上游权威：05 §5/§11"：development-execution/references/change-progress-script-contract.md；
- "02 §x 为权威 / 落地"：development-execution、delivery-flow、finalize-delivery、pr-status-sync、delivery-gate、pull-request 各 SKILL.md。
- 根级存在 01–07 现行版（已核实 04、05 均在根级），docs/ 内为版本快照。B 类不丢规范，但存在**解析歧义**（archive/ 与 docs/ 有几十份同族版本）。

### 3.4 溯源性引用（C 类）

agents/*/README.md 的"设计依据 `docs/02-...-v1.6.6.md`"、"验收记录见 `docs/finalize-delivery-plan.md` §7"等。删除 docs/ 后变为死链，不伤执行。

## 4. 迁移映射设计

### 4.1 新建冻结契约文件（A 类规范内化）

| 新建文件 | 承接内容 | 内容来源 |
| --- | --- | --- |
| `development-execution/references/commit-task-linkage-contract.md` | Refs 尾注格式、禁用关键字、豁免范围、commit_task_links 检查语义 | tfs-task-commit-linkage-plan §4.2/§4.4 **照录**（不改语义），标注冻结日期与来源 |
| `analysis-completion/references/tfs-state-writeback-contract.md` | 需求→已分析回写、任务解决回写的状态映射与前置条件 | tfs-state-writeback-plan §4.1/§4.3 照录 |
| `workitem-analysis/references/tasks-md-authoring-contract.md` | `[预估: Nh]` 行末尾注（0<N≤6h）、首分句 ≤30 字短标题 | tfs-state-writeback-plan §4.7/§4.8 照录 |
| `pull-request/references/worktree-isolation-contract.md` | 枢纽克隆语义、`.worktrees/<issue>-<repo_id>/` 路径契约、create/prune 纪律、临界区串行 | ops guide §3.5 照录 |
| `agents/_shared/review-checklist.md`（或根级 `agent-skill-review-checklist.md`） | D / I / X 组检查 | docs/agent-skill-review-checklist.md 平移 |

### 4.2 引用改写映射（A 类引用方）

| 文件 | 现引用 | 改为 |
| --- | --- | --- |
| development-execution/SKILL.md §How-5/§How-8 | `docs/tfs-task-commit-linkage-plan.md` §4.2/§4.4 | `references/commit-task-linkage-contract.md` |
| development-execution/references/development-evidence-contract.md | 同上 §4.2 | 同技能 references 内契约 |
| backend-engineer / frontend-engineer README | 同上 | 指向技能 references（或删除该说明，README 只留注册事实） |
| analysis-completion/SKILL.md | `docs/tfs-state-writeback-plan.md` §4.1 | `references/tfs-state-writeback-contract.md` |
| delivery-flow/SKILL.md | 同档 §4.3；`docs/skill-flow-cli-plan.md`；multi-daemon 方案 §4 | 分别指向 analysis-completion 契约（跨技能引用 references 允许，路径相对根）；CLI 安装与 daemon 解析改为 `_shared/` 一小节或删除细节留脚本自描述 |
| delivery-gate/SKILL.md、workitem-analyst README | §4.7/§4.8 | `workitem-analysis/references/tasks-md-authoring-contract.md` |
| 5 处 `ops guide §3.5` | docs/multica-delivery-operations-guide.md | `pull-request/references/worktree-isolation-contract.md` |
| delivery-lead/README.md | `docs/agent-skill-review-checklist.md` | 迁移后新位置 |
| 各 README 的 provisioning / portability 方案引用 | docs/*-plan.md | 标注"历史溯源"或直接删除（字段来源以 `_shared/provisioning.json` 自描述为准） |

### 4.3 节号引用处置（B 类：权威反转）

- references 文件头统一从"内容权威：04 §x（照录）"改为："**本文件为对应领域细则的唯一权威**；语义背景见 04（根级现行版 `projects/multica/04-engineer-development-design.md`）§x"。已照录的内容就地成为正文，不再以设计文档为内容权威。
- SKILL.md 中"02 §8.1 为权威，此处不重复定义"类措辞：保留语义引用但统一格式"语义背景：02 §8.1（根级现行版）"；执行性内容（步骤、命令、判定枚举）必须在技能自身或 references 内完备，不允许"必须读 02 才能执行"。
- 任何引用禁止指向 docs/ 版本快照路径。

### 4.4 溯源引用处置（C 类）

agents README 的"设计依据 / 验收记录"统一改指根级现行版编号文档，或标注"历史溯源（文档已归档）"。不追求逐一保真。

## 5. 分阶段实施步骤

> 顺序硬约束：**阶段 4（删 docs/）必须在阶段 1–3 全部验收通过后执行**。ops guide 拆解（阶段 2）前不得删除 docs/。

### 阶段 0：基线冻结

```bash
rg -n "docs/" projects/multica/workspace-skills projects/multica/agents > docs-citation-baseline.txt
rg -n "ops guide|0[2457] ?§" projects/multica/workspace-skills projects/multica/agents >> docs-citation-baseline.txt
```

基线文件存本方案同目录，作为验收对照。

### 阶段 1（P0）：A 类契约内化

1. 按 §4.1 新建 4 个 references 契约文件（照录、标注冻结日期 2026-10-26 与来源方案档）；
2. 按 §4.2 改写引用方（development-execution、analysis-completion、delivery-gate、delivery-flow、workitem-analyst/backend-engineer/frontend-engineer README）；
3. 验证：`rg "tfs-task-commit-linkage-plan|tfs-state-writeback-plan" workspace-skills agents` 归零；
4. **平台同步**：SKILL.md 是已注册技能的 content 源，改动后执行 `skill-flow workspace sync --workspace beiluoshimen`（逐受影响技能），回读校验。

### 阶段 2（P0）：ops guide 与 checklist 拆解

1. 新建 `pull-request/references/worktree-isolation-contract.md`，迁入 ops guide §3.5；改写 5 处引用；
2. ops guide 其余章节逐节判定：现行操作（如 Root Repo Resolution、多 daemon 约定）迁入对应技能 references 或 `_shared/`；历史背景（设计决策过程）不做迁移，随 docs 清理；
3. `tfs-cli-operations-guide.md` / `workspace-sync-operations-guide.md` 当前**无技能引用**（已核实），直接判定：内容若仍现行则平移到根级，否则归档；
4. `agent-skill-review-checklist.md` 平移到 `agents/_shared/review-checklist.md`，改写 delivery-lead README 引用；
5. 验证：`rg "operations-guide|agent-skill-review-checklist" workspace-skills agents` 归零；平台同步同阶段 1。

### 阶段 3（P1）：权威反转与溯源标注

1. 6 个 engineering references 文件头按 §4.3 改写；
2. 各 SKILL.md 的"02 §x 为权威"措辞统一为"语义背景"格式；
3. agents README 溯源引用按 §4.4 处理；
4. 验证：`rg "内容权威：0[245]" workspace-skills` 归零；`rg "docs/0[245]-" agents` 归零。

### 阶段 4（P2）：docs/ 清理

1. 复跑阶段 0 的两条 rg，与基线对照：除标注"历史溯源"的行外全部归零；
2. docs/ 整体移入 `projects/multica/archive/docs-2026-10-26/`（先归档不硬删，保留一个迭代观察期）；
3. 根仓 AGENTS 落盘（`AGENTS.draft.md` → `AGENTS.md`，其导航行已只指根级现行文档与 workspace-skills）。

### 阶段 5：防回归

1. 在 `agents/_shared/review-checklist.md`（迁移后的检查单）新增一条："SKILL / agents 不得新增对 `projects/multica/docs/` 的引用"；
2. 在 AGENTS.md 或 multica 技能公共说明中加入 §2 的四条引用规则。

## 6. 验收标准

1. `rg -n "docs/" projects/multica/workspace-skills projects/multica/agents` 结果中，除标注"历史溯源"的行外为零；
2. 新契约文件头部均含冻结日期、来源方案档、"本文件为唯一权威"声明；
3. 受影响技能经 `skill-flow workspace sync` 同步并回读校验通过；
4. 抽查三条链路的可执行性：development-execution（Ground→Commit→Check）、analysis-completion（Gate→回写）、delivery-lead（provision→sync）——技能文本自包含，不读 docs/ 可执行。

## 7. 风险与注意

- **语义保真**：契约内化一律照录不改写；确需修订的另走评审，不与迁移同期做。
- **平台漂移**：SKILL.md 改动不跑 `workspace sync` 会造成仓内与平台注册内容漂移——每阶段收尾必须同步，这本身就是现行纪律（见各 README）。
- **跨技能 references 引用**：允许（如 delivery-gate 引 workitem-analysis 的契约），但路径用相对 workspace-skills 根的稳定路径，且被引文件header 标注"被以下技能引用"清单。
- **archive/ 同族版本干扰**：改写引用时禁止指向 archive/；验收 grep 需同时覆盖 `archive/` 路径模式。
