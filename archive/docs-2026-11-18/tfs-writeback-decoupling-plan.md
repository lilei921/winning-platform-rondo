# Multica 剥离 TFS 写操作：统一收口 writeback

> 2026-10-30 用户裁定（方案 A）：**PR 审核通过前对 TFS 工作项写动作为零**（唯一例外是 `pr materialize` 建 PR 时的工作项关联，那是交付物本身）；所有写操作收敛到 PR 通过后一个 skill + 一个脚本完成。研发期 commit `Refs:` 统一挂 `tfs.id`（需求/Bug 同一规则，对齐既有 Bug 模式）；子任务在收口时创建即解决，并在创建时把本次交付的 commit 以 Artifact Link 挂到对应任务上——TFS 侧最终呈现：需求下挂任务、任务带工时、任务「开发」栏挂真实 commit，任务级追溯粒度不因延后建任务而丢失。

## Context

当前 multica 交付流程中，对 TFS 工作项的写操作散布在 5 个时点（analysis 回写「已分析」、派发时建子任务置「活动」、PR 物化前置子任务「已解决」+工时、finalize 回写父项），且存在语义缺陷：PR 未过审就把子任务置「已解决」落工时，PR abandoned 后留下无人回收的"已解决"任务。

### PR 通过后 writeback 状态链（用户确认；2026-10-30 review 修正为全链）

| 对象 | 状态链（完整有序路径） | 附带动作 |
|---|---|---|
| 需求子任务（Task） | 已建议 → 活动 → 已解决 | OE=预估尾注；解决时 RemainingWork=0、CW=OE；创建后挂 commit Artifact Link |
| 需求（Requirement） | 已建议 → 活动 → 已分析 → 已解决 | 收口评论 |
| Bug | 已建议 → 活动 → 已解决 | 收口评论 |

执行顺序：子任务链先走完，再走父项链（父项解决要求子项已全部解决）。每跳先回读、已在目标态跳过、断点续走——新交付起点为「已建议」（方案 A 砍掉了 analysis 的「已分析」回写），在途 legacy 交付可能已停在「已分析」，同一逐跳回读逻辑天然兼容。

### commit ↔ 任务关联（2026-10-30 用户补充裁定）

- **机制**：TFS 工作项 Artifact Link（`vstfs:///Git/Commit/<projectId>/<repoId>/<sha>`）。writeback 建/认领子任务后，对该任务 PATCH 一组 commit 链接（幂等：已存在的链接跳过）。链接按 仓库 GUID + SHA 寻址，与分支无关——PR 完成后源分支删除不影响（服务端 commit 对象由 PR 引用 `refs/pull/*` 持有，不会被 GC；squash 合并同样有效）；writeback 只需 sha，不读 commit 内容、不需要分支存在。
- **映射来源**（不发明新事实）：`dev.dispatch` **全部条目**（含失效——ENGINEERING 返工后失效 dispatch 的 commit 仍在 PR 里）的 `task_refs` × 各研发 Run `evidence.json` 的 `commits[]`（repo_path + sha）。粒度为**派发级**：一对一派发精确关联；一个 dispatch 含多个 task_ref 时，该组 commits 关联到其中每个任务（语义真实但略宽，接受）。注意：任务**创建**仍只按 active 条目 task_refs 并集，链接映射才用全部条目。
- **evidence 发现约定**（2026-10-30 review 补充，需回写 development-evidence-contract）：writeback 只扫描 Change 目录（含 archive 后位置，复用 finalize 的 resolveChangeDir 模式：live 不在则查 `changes/archive/*<ref>`）下的 `evidence*.json`，合并其 `commits[]`；散落在代码仓验证目录、未进 Change 目录的 evidence 不参与关联（列入输出 `evidence_missed` 提示，不阻断）。
- **repo 解析**：evidence `commits[].repo_path` → registry `repo_key` → `tfs_repo`；业务仓 commit 的 repo_path 多为 worktree 路径（`.worktrees/<issue>-<repo_id>`），按命名约定反解 repo_key。**根仓 commit 显式跳过**（openspec 根仓无 tfs_repo、无 PR，不属关联范围，记 skipped 而非 failed）；registry 中无 tfs_repo 或反解不出的条目列入 `commit_link_failed`，不阻断。
- **失败处理**：commit 链接是追溯性增强、非硬契约（硬契约是状态链+工时+父项回写）。链接失败记入输出 `commit_link_failed`（含 ref/id/sha/error），**不阻断 PASS**，交人工补；任务建/置态/工时/父项失败照旧 UNKNOWN 断点续走。

## 改动清单

### 1. skill-flow CLI（`tools/skill-flow`，本 monorepo 根仓）

**新增 `skill-flow tfs writeback --issue <KEY> --config "<config-path>"`**，幂等，步骤：
1. **任务物化**（现 `tfs materialize-tasks` 逻辑）：按 active `dev.dispatch` 的 task_refs 并集 + tasks.md `[预估: Nh]` 尾注创建子任务（标题截断/孤儿认领逻辑原样搬移，见 `tasks-md-authoring-contract.md` §1-2）；**存量映射兼容**：条目已有 `tfs_task_ids`（在途交付）时复用认领，不新建
2. **commit 关联**（新增）：按上文机制把 evidence commits 挂到对应任务；Bug 无任务面 → skipped
3. **任务解决**（现 `tfs resolve-tasks` 逻辑）：逐任务走 已建议→活动→已解决，`set-state --complete-with-estimate` 落 CW=OE、RemainingWork=0
4. **父项回写**（现 finalize 内部 TFS 步骤）：需求走 活动→已分析→已解决、Bug 走 已建议→活动→已解决 + 收口评论；`delivery.tfs_written` 幂等键语义不变（含"状态已写评论未写不置位"的部分成功规则）

旧命令 `materialize-tasks` / `resolve-tasks` 在 CLI 保留一个版本作恢复入口（标 deprecated），SKILL 文档中移除调用点。

**`skill-flow analysis complete`**：删除对 Requirement 的 TFS 状态回写，输出不再含 `tfs_state`。

**`skill-flow dev check-completion` 的 `commit_task_links`**：需求的 `Refs:` 核验从"属于 tfs_task_ids 任务集合且覆盖 task_refs"改为"含 `#<tfs.id>` 且不引用其他工作项 id"（即与 Bug 分支合并为同一规则）；**过渡兼容**：active dispatch 条目存在 `tfs_task_ids`（在途交付）时沿用旧规则核验。

**`skill-flow dev check-dispatch`**：`no_mappings/unmapped_refs` 映射核验分支**整体删除**（2026-10-30 review 简化）——映射核验的意义是保证 commit `Refs:` 合法性，新规则下 `Refs: #<tfs.id>` 恒合法；legacy commit 的核验由 check-completion 直接读 `dev.dispatch.tfs_task_ids`，不经过 check-dispatch。

### 2. tfs-cli（`tools/tfs-cli`）

- **新增 `workitem link-commits` 子命令**：`--id <任务id> --repo <tfs_repo> --sha <sha...>`；repo 名→GUID 解析、ArtifactLink（`vstfs:///Git/Commit/...`，rel `ArtifactLink` / name `Commit`）PATCH；幂等（已存在同 sha 链接跳过，输出 linked/skipped/failed 明细）
- **`set-state` 从单跳硬编码升级为按类型有序链逐跳 walk**（2026-10-30 review 修正）：现状仅 `已建议→已解决` 经「活动」一跳硬编码（`workitem.ts:131`），不覆盖需求链。按类型定义完整链——任务/Bug：`已建议→活动→已解决`；需求：`已建议→活动→已分析→已解决`——逐跳回读当前态、跳过已过跳、顺序补走。**需求链中 已建议→活动、已分析→已解决 是否被过程模板允许直连属未知**，须逐跳合法性实测（见验证项 3），不允许的跳如实 UNKNOWN 不猜测绕行
- 改完 `npm run build:exe` 重建 SEA exe（现状：原生 exe 部署，`~/.tfs-cli/bin` 入 PATH）

### 3. workspace-skills 文档（`projects/multica/workspace-skills/`）

| 文件 | 改动 |
|---|---|
| **新建** `tfs-writeback/SKILL.md`（+`config/repo-registry.json`） | 薄适配器契约：前置（PR 全 completed / finalize 上下文）、Procedure（单命令）、Validation（回读三条链终态+工时+commit 链接+父项+评论）、Output（created/reused/resolved/commit_linked/commit_link_failed/父项 state/comment_ref）、Error Handling（逐跳断点续走、链接失败不阻断、UNKNOWN 交 Lead）、幂等与孤儿认领说明；注明由 finalize-delivery 作为 `steps.tfs_writeback` 调用，也可 standalone 作恢复入口 |
| `delivery-flow/SKILL.md` | 删除「TFS 任务物化」「TFS 任务解决」两节及 description 中对应描述；dispatch 收尾回读只留 `dev check-dispatch` |
| `delivery-flow/references/dispatch-facts-contract.md` | `tfs_task_ids` 字段改为 legacy（在途交付兼容，新交付不再写入）；写入者列表去掉 `materialize-tasks` |
| `development-execution/SKILL.md` | 第 1 步 Ground：去掉 `tfs_task_ids` 读取与"缺映射暂停 Commit"分支；第 5 步 Refs 规则统一为 `#<tfs.id>`（需求/Bug 同一规则）；第 8 步 check-completion 描述同步 |
| `development-execution/references/development-evidence-contract.md` | 第 47-48 行 Refs 核验描述统一为父项 ID（含 legacy 过渡说明）；注明 `commits[]` 新增下游消费者（writeback 的 commit↔任务关联），字段契约本身不变；**补 evidence 落位约定**：须写入 Change 目录下的 `evidence*.json` 才参与 writeback 关联（散落代码仓验证目录的不参与） |
| `analysis-completion/SKILL.md` | 第 4 步去掉"按 TFS 类型执行适用回写"；Validation 去掉"TFS 状态同步成功"；Output 去掉 `tfs_state` |
| `finalize-delivery/SKILL.md` | `tfs_tasks_gate` 步骤替换为 `steps.tfs_writeback`（先执行 writeback 再回读，不再"FAIL 后人工补跑 resolve-tasks"）；Validation 中子任务核对改为 writeback 结果回读；description 同步 |
| `finalize-delivery/references/finalize-facts-contract.md` | `dev.dispatch` 消费行：从"须有 tfs_task_ids 映射且任务已解决"改为"writeback 步骤落账事实"；`delivery.tfs_written` 语义扩展为完整 writeback 完成标记 |
| `workitem-analysis/references/tasks-md-authoring-contract.md` | §1 链路"物化时写 TFS 工时字段"→"PR 通过后 writeback 写"；§2 脚本兜底主体从 materialize-tasks 改为 writeback；预估尾注仍为需求必填（消费者从物化脚本变为 writeback） |
| `delivery-gate/SKILL.md` | `task_estimates` 行消费者说明微调（"下游消费者"措辞指向 writeback） |

### 4. 设计文档同步（`projects/multica/02-multica-delivery-lifecycle-design.md`）

- 第 1317 行：派发时"按 task_refs 物化子任务"→ 统一为"PR/Commit 直接关联 tfs.id；子任务由收口 writeback 按需创建"（tfs-bug-delivery-task-skip-plan 模式升为通用规则）
- §12.4 第 2599 行、§12.4.3「TFS 回写」行：描述与 writeback 三步链对齐（含"可新建 Task"这一与现行"不新增 Task"相反的点，需改写）

### 5. 不做的事

- `tfs-sync`（intake）不动：本来就是 TFS 只读 + Issue 侧写入
- `pr materialize` 不动：PR 创建与工作项关联是交付物本身
- `pr-status-sync` 路由表不动：writeback 由 finalize 内部调用，不新增路由
- archive/ 与历史 plan 文档不回改

### 6. 在途交付兼容

- 已有 `tfs_task_ids` 映射、子任务已「活动/已解决」的 Issue：writeback 走 reused/adopted + 断点续走，天然幂等
- 旧 commit（Refs 挂任务 ID）：check-completion legacy 分支放行
- 已在 `in_review` 的 Issue：finalize 新版直接接管（writeback 幂等收口）

## 验证

1. **单元级**：skill-flow 新命令在测试 TFS 工作项上跑 writeback——需求（含 2 个子任务尾注）与 Bug 各一例，回读三条链终态、OE/CW/RemainingWork、任务上 commit Artifact Link 存在且可解析、父项评论
2. **幂等**：同一 Issue 连跑两次，第二次全 skipped/NO-OP；中途 kill（子任务已建未解决）后重跑，孤儿认领+断点续走
3. **tfs-cli**：`set-state` 需求链**逐跳**合法性实测（已建议→活动、活动→已分析、已分析→已解决 各跳分别验证），再验证全链 walk 与断点续走
4. **端到端**：各跑一个真实 Bug 交付和需求交付全链路，确认：PR 通过前 TFS 零写入（除 PR 关联）、PR 通过后 writeback 一次收齐、finalize PASS、Issue done
5. **回归**：`analysis complete` 输出不再含 tfs_state；`dev check-completion` 新 Refs 规则 PASS + legacy 映射 Issue 放行
