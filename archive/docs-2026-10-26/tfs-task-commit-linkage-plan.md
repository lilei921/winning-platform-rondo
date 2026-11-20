# tfs-task-commit-linkage 方案（Commit Message `#任务ID` 自动关联 TFS 任务）

> 状态：**已实施并验收（2026-10-19）**。CL-0 机制实证全过、CL-1～CL-10 验收全过；实测记录见 §3 与 §7。
> 上游权威：02 §8.1（Commit/Push：提交信息含关联引用）；01（Reference-not-Replication）。
> 关联：`docs/tfs-task-materialization-plan.md`（任务物化，产出本方案消费的事实 `tfs_task_ids`）；`workspace-skills/delivery-flow/references/dispatch-facts-contract.md`（`dev.dispatch[].tfs_task_ids` 唯一权威）；`workspace-skills/development-execution/references/development-evidence-contract.md`（commits[] 契约）。
> 当前路径契约（2026-10-22）：`repo_key = repo_id`，业务 hub 为 `<root_repo>/<repo_path>`，worktree 为 `<root_repo>/.worktrees/<issue>-<repo_id>/`；只有根仓自身豁免 `Refs:`。§7 的初版路径问题与修复记录为历史实测，不代表现行目录。

## 0. 背景与定位

**现状**：

1. 派发后 `materialize-tfs-tasks.ts` 已在 TFS 父需求（`tfs.id`）下建好任务子项，并把 `task_ref → tfs任务id` 映射写入 `dev.dispatch[].tfs_task_ids`（已验收 TF-1～TF-9）。
2. PR 物化只挂父需求：`materialize-pr.ts --work-items <tfs.id>`。PR 是仓库级对象，多仓场景下不能把父需求下全部任务挂到每个仓的 PR。
3. Commit Message 当前只有原则性要求（development-execution SKILL 第 5 步"含 TFS Work Item / Delivery Issue 关联引用"），**无规范格式、无确定性校验、Engineer 无事实来源可查任务 ID**。
4. 结果：TFS 任务子项与代码提交之间无关联，管理侧看不到"任务 → 代码"的追溯链。

**目标**：每个业务仓 Commit 的提交信息携带其实现的 TFS 任务 ID（`#<id>`），利用 TFS Git 推送时的原生自动关联机制建立 Commit ↔ 任务链接；并用确定性脚本在 Completion Check 门禁强制核验。

**定位**：Commit 关联是**交付平面的完成判据**（证据链一环），但其依赖的事实（`tfs_task_ids`）来自管理平面产物。两平面的隔离原则（TFS 故障不阻塞派发）通过 §5.3 的条件门禁语义保持。

## 1. 设计约束（红线）

1. **语义/确定性分界**："这个 Commit 实现哪些 task_ref" 是 Engineer 的语义判断，脚本不推断；脚本只校验"声明的 ID 属于当前 Issue 的合法集合、格式合规、覆盖完整"。
2. **Reference-not-Replication**：Commit ↔ 任务的关联事实只存在于两处原生位置——Commit Message（git 事实）与 TFS 工作项链接（TFS 事实）；evidence.json / metadata 不复制链接清单，校验脚本现场从 `git log` 提取。
3. **不改写已 push 历史**：规范只约束新 Commit；任何场景禁止 `rebase`/`--amend` 已推送提交（见 §6 异常恢复）。
4. **确定性脚本基线**：TS 单文件零构建零依赖；退出码 0/2/3/64；stdout 只出 JSON，日志走 stderr。
5. **不引入 repo ↔ task_ref 映射表**：任务实现落在哪个仓是分析/派发期的语义事实（repo-context 候选定位），本方案不为 Commit 关联新增确定性映射配置；校验只核对"ID ∈ 本 Issue 合法集合"。
6. **OpenSpec 根仓豁免**：根仓（proposal/tasks/evidence 等工程真相产物）的 Commit 不要求 `#任务ID`；规范只作用于 `repo-registry.json` registry 内的业务仓。

## 2. 当前事实与缺口

| 事实 | 位置 | 状态 |
|---|---|---|
| `task_ref → tfs任务id` 映射 | `dev.dispatch[].tfs_task_ids`（delivery-flow 写入） | ✅ 已有，唯一权威 |
| 分支命名 | `feat/<tfs.id>`（父需求级） | ✅ 已有，不变 |
| PR ↔ 父需求链接 | `materialize-pr.ts --work-items <tfs.id>` | ✅ 已有，不变 |
| Commit ↔ 任务链接 | 无 | ❌ 本方案补齐 |
| Commit Message 格式规范 | 无（仅原则性文字） | ❌ 本方案定义 |
| Commit 关联确定性核验 | 无 | ❌ 本方案新增 |

**父需求不再进 Commit Message** 的裁定：父需求已由 PR `--work-items` 挂载；TFS 任务与父需求之间已有 Hierarchy 父子链接，任务级 Commit 链接经父子关系即可上卷到需求视图。Commit 里再写 `#<tfs.id>` 会把每个提交都挂到需求上，制造噪音链接。Commit Message 只写任务 ID。

## 3. 前置实证：TFS 2018 自动关联机制（CL-0，实施前必做）

TFS Git 在 **push 时**解析 Commit Message 中的 `#<workitem-id>` 并建立工作项 ↔ Commit 链接。本实例实测结果（2026-10-19，df-dataasset-web `feat/cl0-probe` 4 个空提交 → DP-05 项目任务 258235/258236/258257）：

| # | 待实证问题 | 实测结果 |
|---|---|---|
| CL-0.1 | 基本关联 | ✅ push 后任务 relations 出现 `ArtifactLink`（`vstfs:///Git/Commit/…`，name=`Fixed in Commit`）。**异步延迟约 3~5 分钟**（push 后 3 分钟尚无链接，5 分钟出现） |
| CL-0.2 | **跨 Team Project** | ✅ 仓在 `WiNEX_Data_Governance`、任务在 `DP-05-数据资产管理软件`，链接正常建立——生产场景（全部业务仓与需求跨项目）成立 |
| CL-0.3 | 尾注行解析 | ✅ 4 个提交首行均无 ID、ID 全在 `Refs:` 尾注行，链接全部建立 |
| CL-0.4 | 多 ID | ✅ `Refs: #258235 #258236` → 两个任务各得一条链接 |
| CL-0.5 | 无效 ID | ✅ `#99999999` push 成功、无任何任务出现该 commit 链接，无副作用 |
| CL-0.6 | 状态关键字 | ✅ `Fixes #258257` 建立了链接，但任务 state 保持 `已关闭` 未变——本实例**无状态变迁副作用**；规范禁令仍保留（防未来升级/防习惯蔓延） |
| CL-0.7 | 重复引用 | ✅ 258235 被 2 个 commit 引用 → 恰好 2 条链接（每 commit 一条），无重复爆炸 |

清理：探测分支 `feat/cl0-probe` 远端/本地均已删除；三个测试任务已评论标注 CL-0 测试用途（原已关闭）。测试 commit 随分支删除在仓内不可达，任务上的链接保留（ArtifactLink 指向悬空 commit，无副作用）。
**注**：DP-05 项目无 Git 仓，"同项目关联"未单独验证（跨项目已过，同项目为其子集）；REST 在 DP-05 建仓返回 404，放弃该验证路径。

## 4. 契约设计

### 4.1 事实流（Engineer 从哪拿任务 ID）

```text
materialize-tfs-tasks.ts（派发时，已有）
  → dev.dispatch[].tfs_task_ids = {"1.1": 258235, "1.2": 258236}     ← 唯一事实源
        ↓ Engineer Ground 阶段读取
development-execution SKILL 第 1 步（Ground）新增动作：
  multica issue get <KEY> --output json → 取 dev.dispatch 中
  「active:true 且 engineer_id=自己 且 task_refs 与本次派发一致」的条目
  → 得本次 Task Set 的 {task_ref: tfs任务id} 映射
        ↓ Commit 时
Engineer 语义判断本 commit 实现哪些 task_ref → 尾注写对应 #id
        ↓ Completion Check
check-development-completion.ts 现场 git log 提取 #id 集合核验（§4.4）
```

- Engineer **不记忆、不转述**任务 ID，每次 Ground 从 metadata 现查；
- Sub-Issue 投影同样读父 Issue 的 `dev.dispatch`（Sub-Issue 投影的 dispatch 条目就写在父 Issue 上，天然可达）；
- `tfs_task_ids` 缺失（任务物化失败未补齐）时的门禁语义见 §5.3。

### 4.2 Commit Message 规范（Canonical 格式）

```text
<首行：常规语义摘要，不要求含 ID>

<正文，可选>

Refs: #258235 #258236
```

规则：

1. **`Refs:` 尾注行**为规范位置：独立一行，`Refs:` 前缀 + 空格分隔的 `#<id>` 列表（首行与正文出现 `#id` 同样会被 TFS 解析，但 Completion Check 只认 `Refs:` 行，保证机器可判定的唯一位置）；
2. **只写任务 ID**：本 commit 实际实现的 task_ref 对应的 TFS 任务 ID，一个或多个；不写父需求 ID（§2 裁定），不写 Issue KEY（Issue 侧追溯走 evidence/PR 描述，不走 TFS 链接）；
3. **禁用状态变迁关键字**：`fix/fixes/fixed/close/closes/closed/resolve/resolves/resolved #id` 一律禁止（任务状态流转由交付流程管理，不经 git 提交；CL-0.6 实证本实例行为后此禁令仍保留）；
4. **一个 commit 可关联多个任务**（一次提交实现多个 task_ref）；**一个任务可被多个 commit 引用**（任务跨多个提交完成）；
5. 每个**业务仓** commit 至少关联一个任务 ID；根仓 commit 豁免（§1.6）。

### 4.3 development-evidence-contract 扩展

`commits[]` 条目**不新增字段**——任务关联事实由校验脚本现场从 `git log --format=%B` 提取（Reference-not-Replication，evidence 不复制 commit 内容）。契约文档只补一段规则说明：

- `commits[].repo_path` 从"可选"升级为：凡 `--verify-commits` 与 Commit 关联核验开启时**必填**（脚本需要在仓内读 commit message）；
- 明确根仓 commit（`repo_path` = openspec 根仓）不参与 `#任务ID` 核验。

### 4.4 Completion Check 扩展（check-development-completion.ts）

新增检查项 `commit_task_links`（在现有 `commits` 检查之后执行）：

**输入新增**：`--issue <KEY>` + `--registry-config <repo-registry.json>`（用于读 `dev.dispatch` 与识别业务仓集合；`--issue` 缺省时本检查跳过，向后兼容旧调用）。

**确定性流程**：

1. 读 Issue metadata `dev.dispatch`，取「`active:true` 且 task_refs 覆盖本次 `--task-refs`」条目的 `tfs_task_ids` 并集 → **合法 ID 集合 L** 及其 `task_ref → id` 映射；
   - 无任何 active 条目携带 `tfs_task_ids` → 本检查 UNKNOWN（理由：任务物化未完成，见 §5.3）；
2. 对 evidence `commits[]` 先按绝对路径确定性归类：`repo_path == root_repo` 为根仓并豁免；`root_repo/<已登记 repo_path>` 或 `root_repo/.worktrees/<直接子目录>` 为业务仓；其他路径 FAIL，不按整个 root 前缀豁免。对业务仓 commit 执行 `git log -1 --format=%B <sha>`，提取 `^Refs:\s*(#\d+\s*)+$` 行的 ID 集合：
   - 业务仓 commit 无合法 `Refs:` 行 → FAIL（漏写）；
   - `Refs:` 行存在但含 ∉ L 的 ID → FAIL（写错/越权引用其他 Issue 的任务）；
   - 含禁用状态关键字（`fix(es|ed)?|close(s|d)?|resolve(s|d)?\s+#\d+`，大小写不敏感）→ FAIL；
3. **覆盖检查**：本次 `--task-refs` 中每个 task_ref 的任务 ID 至少出现在一条业务仓 commit 的 `Refs:` 行 → 未覆盖的 FAIL（理由列出缺失 task_ref）；
4. 结果聚合进现有 `{result, checks, reasons}` 输出；FAIL=exit 2，UNKNOWN=exit 3。

**明确不判**：`Refs:` 行里 ID 与 commit 实际改动内容的对应关系（语义，归 Code Review / Human）；任务在 TFS 侧是否已关闭（已关闭任务的链接依然合法——返工复用场景任务可能处于任何状态）。

### 4.5 SKILL / 文档改动面

| 资产 | 改动 |
|---|---|
| `development-execution/SKILL.md` | 第 1 步 Ground 增加"读 dev.dispatch 取本 Task Set 的 tfs_task_ids"；第 5 步 Commit/Push 改为引用 §4.2 规范（Canonical 格式 + 禁令）；第 8 步 Completion Check 命令行增加 `--issue --registry-config` |
| `development-execution/references/development-evidence-contract.md` | §4.3 的 `repo_path` 规则与核验说明 |
| `development-execution/scripts/check-development-completion.ts` | §4.4 检查项 |
| `docs/multica-delivery-operations-guide.md` | 当前实施状态补 Commit ↔ 任务关联一节 |
| 平台侧 | development-execution Skill（`skill files upsert`：脚本 + SKILL.md + 契约）同步；Backend/Frontend Engineer 无需改 Instructions（约束在 Skill） |

**不改**：`materialize-tfs-tasks.ts`、`dispatch-facts-contract.md`（`tfs_task_ids` 字段契约不变，本方案只是新增消费方）；`materialize-pr.ts`（PR 仍只挂父需求）；Agent Instructions。

## 5. 关键场景语义

### 5.1 多仓（前后端双 dispatch）

父 Issue 两条 active dispatch（Backend `1.1,1.2` / Frontend `2.1,2.2`），各自 `tfs_task_ids` 独立。后端 Engineer 只在后端仓提交、`Refs:` 只写后端任务 ID；前端同理。Completion Check 按**本次派发的 task_refs**取合法集合，天然隔离：后端 commit 写前端任务 ID → ∉ L → FAIL。PR 仍各仓挂父需求，任务级追溯由 Commit 链接承载，无需把任务挂上 PR。

### 5.2 返工复用任务 ID

ENGINEERING 返工使旧 dispatch `active:false` 但 `tfs_task_ids` 保留；新 dispatch 复用同一批任务 ID（TF-5 已验）。返工后的新 commit 继续 `#<同一任务id>`：TFS 任务上追加新 Commit 链接，旧链接保留——历史提交曾是该任务的工作记录，链接语义天然正确，无需任何清理。

### 5.3 任务物化缺失时的门禁语义（平面隔离的落地）

- `dev.dispatch` 有 active 条目但**无** `tfs_task_ids`（materialize-tfs-tasks 失败未补齐）→ `commit_task_links` UNKNOWN（exit 3）→ Engineer 不当放行、回流 Lead；
- Lead 修复路径即既有自愈：重跑 `materialize-tfs-tasks.ts`（幂等/孤儿认领），补齐后 Engineer 重跑 Completion Check；
- 由此 TFS 侧持续故障会**间接**阻塞完成声明——这是有意裁定：Commit 关联一旦成为规范，完成判据就依赖任务 ID 事实存在；平面隔离仍成立（派发不被阻塞、已落账事实不回滚），被阻断的只是"完成声明"这一交付平面判据，且恢复路径确定（重跑一次脚本）。

### 5.4 已关闭/已删除任务的引用

任务被管理侧关闭（如管理性清理）不影响 Commit 链接建立与校验（校验只认 `tfs_task_ids` 事实，不回查 TFS 任务状态）；任务被**物理删除**时旧链接失效但 git 历史不变——不视为交付平面事件，不处理。

## 6. 异常与恢复

| 场景 | 检测点 | 处置 |
|---|---|---|
| Commit 前忘记查/写 ID | Completion Check FAIL（漏写） | commit 未 push：`--amend` 补 `Refs:` 行后重跑检查 |
| Commit 已 push 才发现漏写/写错 | Completion Check FAIL（`--verify-commits` 在仓内核验的是已 push 的 SHA） | **禁止改写已 push 历史**。恢复路径：① 该分支尚无 PR → Human 批准后可删除远端分支、本地修正后重新 push（视为未发布）；② 已有 PR → 由 Lead/Human 决策：接受例外（Human 在 Issue 评论明示豁免，Evidence 记录）或废弃 PR 重来。不设计自动补救 |
| 写错成其他 Issue 的任务 ID | FAIL（∉ L） | 同上，按是否已 push 分流 |
| 同一 task_ref 多 commit 分布多仓 | 覆盖检查按 task_ref 粒度 | 天然支持，无需特殊处理 |
| TFS 自动关联未生效（push 成功但任务无链接） | Completion Check **不检测**（校验以 git 事实为准，TFS 链接是平台原生机制的产物） | CL-0 实证即为此兜底；运行期若发现机制失效，属平台事故，Human 介入，方案层面不设计补偿写入 |
| `git log` 读取失败 / evidence 缺 repo_path | UNKNOWN | 修正后重跑，不绕过 |

## 7. 验收用例（CL 系列，实施后排期）

测试纪律：只用专用测试工作项与测试分支；验收后测试分支删除、测试任务评论标注并关闭、测试 Issue 取消并清除 `tfs.id`（吸取 FOMA-36 残留教训）；不触碰他人工作项。

| # | 用例 | 预期 | 实测（2026-10-19，测试 Issue FOMA-38，已取消，无 tfs.id） |
|---|---|---|---|
| CL-0 | §3 机制实证 0.1–0.7 | 全部达预期 | ✅ 全过，见 §3 表 |
| CL-1 | 单仓单任务正常流 | commit `Refs: #<id>` → push 后任务出现 Commit 链接；Completion Check PASS | ✅ commit `Refs: #258235 #258236` → `commit_task_links` PASS / exit 0；链接行为 CL-0 已实证 |
| CL-2 | 单 commit 多任务 / 多 commit 单任务 | 链接与覆盖检查均 PASS | ✅ 单 commit 双 ID（后端 1.1+1.2）与两 commit 各一 ID（前端 2.1/2.2）均 PASS |
| CL-3 | 多仓双 dispatch | 后端 commit 写后端 ID PASS；写前端 ID FAIL（∉ L） | ✅ 后端证据引用 `#258251`（前端任务）→ FAIL："引用了不属于本 Issue 当前派发合法集合的任务 #258251" |
| CL-4 | 漏写 `Refs:` 行 | FAIL，理由指名缺 task_ref；amend 后 PASS | ✅ 漏写 → FAIL（缺 Refs 行 + 1.1/1.2 未覆盖）；amend 补 `Refs:` 后 PASS |
| CL-5 | 写错 ID（不存在 ID） | FAIL（∉ L）；CL-0.5 已确认 TFS 侧无副作用 | ✅ `#99999999` → FAIL（∉ L + 未覆盖） |
| CL-6 | 状态关键字 `Fixes #id` | FAIL（规范禁令） | ✅ `Fixes #258235` → FAIL（含状态变迁关键字），即使 Refs 行本身合法 |
| CL-7 | 根仓 commit 豁免 | 根仓 commit 无 `Refs:` 不影响 PASS | ✅ evidence 混入根仓 commit（无 Refs 行）仍 PASS |
| CL-8 | `tfs_task_ids` 缺失 | UNKNOWN exit 3；补齐后 PASS | ✅ 删除 tfs_task_ids 后 UNKNOWN / exit 3（"任务物化未完成"）；恢复后 PASS |
| CL-9 | 返工复用 | 新 dispatch 复用旧任务 ID，新 commit 引用后任务链接追加、检查 PASS | ✅ 同 ID 重复引用 PASS（CL-0.7 已实证链接逐 commit 追加不爆炸） |
| CL-10 | 幂等 | Completion Check 重跑结果一致，零写入 | ✅ 同参数重跑结果一致（只读检查，天然零写入）；不带 `--issue` 的旧调用向后兼容（跳过本检查） |

实施偏差记录：

1. **路径归类收紧**：初版只按"在 repos_root 下"判业务仓、其余静默豁免——`/d/...` 形式 POSIX 路径会被误判为豁免而静默 PASS。已改为：repos_root 下 = 业务仓、root_repo 下 = 根仓豁免、**两者之外 = FAIL（路径无法归类）**，防静默豁免。
2. **CL-4 初测假失败**：测试脚本在 amend 后未更新 evidence 中的 sha（拿了旧 sha），重测修正后 PASS——非产品缺陷，记录备查。
3. **部分 task_ref 无映射的分型**：覆盖检查中"task_ref 无 tfs_task_ids 映射"为 UNKNOWN（物化缺失）、"有映射但未被 commit 覆盖"为 FAIL（漏写），两者分别归位。

验收清理：FOMA-38 已取消（从未设 tfs.id，无身份冲突风险）；两个验收 worktree 与 `feat/cl-accept` 分支已删除；`cl-acceptance-test` Change 已删除；CL-0 探测分支 `feat/cl0-probe` 已删除，三个测试任务已评论标注测试用途。OpenSpec 根仓与业务仓枢纽克隆工作树干净。

## 8. 开放问题

1. ~~**跨 Team Project 关联**~~ **已实证成立**（CL-0.2，2026-10-19）：仓在 WiNEX_Data_Governance、任务在 DP-05，链接正常建立，无需降级方案；唯一注意点是链接建立有 3~5 分钟异步延迟，Completion Check 不依赖 TFS 侧链接（只核 git 事实），不受影响；
2. **cherry-pick / 合并到其他分支**：同一 SHA 进入 main 后链接是否重复计数、release 分支的 commit 是否也强制 `Refs:`（main 上的合并 commit 由 PR 完成产生，其 message 由 TFS 生成——是否含 `#id` 取决于 PR 描述，本方案不约束合并 commit）；
3. **既有存量分支**：`feat/<tfs.id>` 上已 push 的无 `Refs:` 历史不追溯；规范自启用点起只约束新 commit（按 Issue 维度启用：启用后才派发的 Issue 适用）。

## 9. 实施顺序（已执行）

1. ✅ CL-0 机制实证（2026-10-19，全过）→ 结果已回填 §3；
2. ✅ check-development-completion.ts 扩展 + evidence 契约 + SKILL 更新（2026-10-19）；
3. ✅ CL-1～CL-10 验收与清理（2026-10-19）→ 结果已回填 §7；
4. 平台同步 development-execution Skill；ops guide 回填实施状态（见 §4.5 与 ops guide 当前实施状态节）。
