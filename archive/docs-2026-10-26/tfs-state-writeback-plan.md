# tfs-state-writeback 方案（TFS 需求/任务状态随流水线回写）

> 状态：**已实施并验收（2026-10-20，SW-1~SW-11 全过；SW-8 为代码级实证，全链待下次真实 finalize 回填）**。
> 上游权威：02 §5.4（分析收口）/ §7（派发）/ §9（Lead 汇总）/ §12（finalize）；01（Reference-not-Replication）。
> 关联：`docs/tfs-task-materialization-plan.md`（任务物化，产出 `tfs_task_ids`——本方案任务状态写的身份源）；`docs/tfs-task-commit-linkage-plan.md`（Commit 关联）；`workspace-skills/tfs-sync/config/sync-config.json`（状态名实测集与同步入口）。
> 用户裁定（2026-10-19）：① 派发即激活；② 任务"已解决"Lead 侧写；③ 状态只写到"已解决"为止（不写已验证/已关闭）；④ 跳态不预验证，失败如实 UNKNOWN；⑤ 平面隔离延续（TFS 写失败不阻塞交付主流程）。
> 2026-10-19 并入：根仓归档 push 静默假成功缺陷修复（§4.6；实证：根仓 dev ahead origin/dev 4，FOMA-37 全链产物未推送，finalize 却报 `pushed: true`）。
> 2026-10-19 并入（用户裁定）：任务预估时长（§4.7：tasks.md `[预估: Nh]` 尾注**必填**、N≤6h，Gate 强制，物化写 TFS 工时字段+描述）与 TFS 任务标题简化（§4.8：源头约定首分句 ≤30 字短标题 + 物化脚本 80 字符截断兜底）。
> 2026-10-20 并入（用户裁定，推翻 §4.7 原"CompletedWork 不写"结论）：任务置"已解决"时脚本确定性落库 **CompletedWork=OriginalEstimate、RemainingWork=0**（§4.3 扩展；`set-state --complete-with-estimate`，已是目标态仍核对补齐，工时漂移重跑自愈）。语义：本流程任务工时为**预估口径**（OE=RW 创建即写、CW=OE 解决即写），非实际工时填报——实际工时仍属管理侧人工（§7）。

## 0. 背景与定位

**现状**：TFS 状态写只有一个点——`finalize-delivery.ts` 第 8 步把需求置"已解决"。任务物化（TF 系列）与 Commit 关联（CL 系列）落地后，管理侧在 TFS 能看到需求下的任务与代码链接，但**状态不动**：任务永远停在"已建议"，需求从"活动"直接跳"已解决"（FOMA-37 实证），"已分析"从未写。

**目标**：把 TFS 状态机与流水线事件对齐，管理侧看 TFS 即可知进度：

```text
需求：已建议 ──(人工拖拽，同步入口)──▶ 活动 ──▶ 已分析 ──▶ 已解决 ──▶ (已验证/已关闭：不写)
任务：已建议 ──▶ 活动 ──▶ 已解决 ──▶ (已关闭：不写)
```

**定位**：TFS 状态是**管理平面**产物，交付平面（状态机/门禁/验收/收口）不消费它。红线同任务物化：TFS 写失败不阻塞、不回滚交付事实，修复靠重跑（set-state 天然幂等）。

## 1. 设计约束（红线）

1. **平面隔离**：任一 TFS 状态写失败 → 该段 UNKNOWN，已落账的交付事实（analysis.* / dev.dispatch / 归档）不回滚；修复后重跑同脚本自愈。
2. **幂等**：set-state 服务端幂等；所有写点可安全重跑，不新增防重 metadata（例外见 §4.3 的讨论与裁定）。
3. **跳态不预验证**（用户裁定④）：不预先实证状态机迁移表；写时按目标态直接 set-state，TFS 拒绝 → 如实 UNKNOWN 交 Lead/Human。
4. **状态只到"已解决"**（用户裁定③）：不写"已验证"/"已关闭"；需求的验证/关闭与任务的关闭留给管理侧人工。
5. **TFS 写点集中**：只动三个既有/新脚本（complete-analysis / materialize-tfs-tasks / 新增 resolve-tfs-tasks），不把 TFS 依赖扩散进 Engineer 侧 Skill（用户裁定②）。
6. **确定性脚本基线**：TS 单文件零构建零依赖；退出码 0/2/3/64；stdout 只出 JSON，日志走 stderr；PAT 不出现在任何输出。

## 2. 状态映射表（唯一权威映射）

| 对象 | 跳转 | 流水线事件 | 写点脚本 | 调用方 |
|---|---|---|---|---|
| 需求 | 已建议→活动 | 人工在 TFS 拖拽（tfs-sync 同步入口：`活动 + AssignedTo=@me`） | 不写（上游动作） | 人工 |
| 需求 | 活动→**已分析** | Analysis Gate PASS、Analysis Handoff Facts 落账 | `complete-analysis.ts` 扩展（§4.1） | Workitem Analyst |
| 需求 | 已分析→已解决 | PR 合并 + Change 归档 | `finalize-delivery.ts` 第 8 步（**已有，不改**） | Delivery Lead |
| 任务 | 已建议→**活动** | 派发物化（任务创建/复用/认领成功） | `materialize-tfs-tasks.ts` 扩展（§4.2） | Delivery Lead |
| 任务 | 活动→**已解决** | Lead 汇总：全部 active dispatch 研发完成 | **新增** `resolve-tfs-tasks.ts`（§4.3） | Delivery Lead |
| 需求/任务 | →已验证/已关闭 | 不写（用户裁定③，管理侧人工） | — | 人工 |

**说明**：

- 需求"已分析"写点选在 `complete-analysis.ts` 而非派发时："已分析"语义 = 分析完成（Gate PASS），与 Human 批准无关；批准只是派发前置。若 Human 驳回重分析，需求停留"已分析"——分析确已发生过，语义不错。
- 任务"活动" = 派发即激活（用户裁定①）：任务被创建/复用/认领的那一刻已派给 Engineer，语义成立；不追求"Engineer Run 真正开工"的精确时机（那会要求 development-execution 引入 TFS 写依赖，违反红线 5）。
- 任务"已解决" = Lead 汇总点（用户裁定②）：全部 active dispatch 报告完成（Completion Check PASS 经 Lead 收齐）后统一写；单个任务不随单 Engineer 完成单独写——任务解决是交付判定的下游，Lead 是唯一有全局视图的判定者（02 §9）。

## 3. 事实契约

**不新增 metadata key**。身份与幂等全部复用既有事实：

- 任务身份：`dev.dispatch[].tfs_task_ids`（materialize-tfs-tasks 已写）；
- 需求身份：`tfs.id`；
- 幂等：set-state 服务端幂等，重跑同目标态是 NO-OP；不写 `delivery.tfs_tasks_resolved` 类防重标记（见 §4.3 裁定）。

## 4. 契约

### 4.1 `complete-analysis.ts` 扩展（需求 → 已分析）

现有动作（写 analysis.* metadata + status=analysis_review + 回读）之后追加：

1. 读 metadata `tfs.id`；缺失或非正整数 → 跳过 TFS 段（output 标注 `tfs_state: "skipped"`），**不影响**已有结果的 PASS（无 tfs.id 的 Issue 本就不在 TFS 同步链上）；
2. `tfs-cli workitem set-state --id <tfs.id> --state 已分析`；
3. 成功 → output 加 `tfs_state: "已分析"`；失败 → **exit 3 UNKNOWN**（analysis.* 与 status 已落账不回滚，输出如实区分两段结果），修复后重跑本脚本自愈（metadata 重写幂等 + set-state 幂等）。

### 4.2 `materialize-tfs-tasks.ts` 扩展（任务 → 活动）

逐 task_ref 物化（created/reused/adopted）之后、回写 metadata 之前/之后均可（建议之后，保持"先事实后状态"），对每个 resolved 任务 ID：

```
tfs-cli workitem set-state --id <taskId> --state 活动
```

- 全部成功 → output 加 `state_set: { "<ref>": "活动" }` 汇总；
- 任一失败 → exit 3 UNKNOWN（沿用既有暂存输出 `created/reused/adopted`，加 `state_set`/`state_failed` 明细；metadata 回写若已成功不回滚）；重跑经 reused 路径再次补写状态，自愈；
- **返工复用场景**（TF-5）：旧任务可能已是"已解决"——新 dispatch 复用时同样尝试置"活动"（`已解决→活动` 是否被状态机允许不预验证，裁定④；被拒则 UNKNOWN 交 Human）。

### 4.3 新增 `resolve-tfs-tasks.ts`（任务 → 已解决，delivery-flow Skill）

```bash
node scripts/resolve-tfs-tasks.ts --config config/repo-registry.json --issue <KEY>
```

确定性流程：

1. **前置**（任一不过 → exit 2 零写入）：Issue 可读；`dev.dispatch` 至少一条 `active:true` 条目；全部 active 条目的 task_refs 并集**每个 ref 都有** `tfs_task_ids` 映射（缺 → FAIL，提示先重跑 materialize-tfs-tasks 补齐）；
2. **逐任务置态 + 工时落库**（2026-10-20 用户裁定扩展）：对全部 active 条目 `tfs_task_ids` 的 ID 并集（去重），`set-state 已解决 --complete-with-estimate`——同一 PATCH 确定性落库 **CompletedWork=OriginalEstimate、RemainingWork=0**；幂等核补：已是"已解决"态不早退，仍核对 RW≠0 / CW≠OE 并补写（工时漂移重跑自愈）；OE 缺失 → 只写 RW=0，列入 `estimate_missing` 如实回流（不视为失败）；
3. **回读核对**：`query --wiql` 按 ID 集回读（query 输出已扩展 `originalEstimate/remainingWork/completedWork` 三字段），state 不为"已解决"、RW≠0、或 OE 存在而 CW≠OE 的列入 `failed`（OE 缺失不核对 CW）；
4. 输出 `{result, resolved: {ref: id}, failed: [...], estimate_missing: [...]}`；全部已解决且工时齐 → exit 0；任一置态失败/回读不符 → exit 3 UNKNOWN（部分成功如实列明，重跑幂等自愈）。

**调用时机**（写入 delivery-flow SKILL.md 路由表）：Lead 收齐全部 active dispatch 的完成声明（各 Engineer Completion Check PASS 回流）后、PR 物化前调用；exit 3 不阻塞 PR 物化（平面隔离），如实回流交 Human。

**裁定：不写防重 metadata**。理由：① set-state 幂等，重跑无害；② 回读核对已提供确定性验证；③ `delivery.tfs_written` 式标记是为了防**评论**重复（评论非幂等），状态写无此问题。

### 4.4 finalize-delivery.ts：TFS 段不改；归档 push 段修复见 §4.6

需求 → 已解决已有（第 8 步 TFS 回写），不改。任务关闭不写（裁定③）。
但 2026-10-19 实证发现归档 push 段存在静默假成功缺陷（根仓工作分支 ≠ master 时归档产物永不推送），修复并入本方案，见 §4.6。

### 4.5 SKILL / 文档改动面

| 资产 | 改动 |
|---|---|
| `analysis-completion/scripts/complete-analysis.ts` | §4.1 TFS 段 |
| `analysis-completion/SKILL.md` | 输出契约补 `tfs_state`；UNKNOWN 自愈说明 |
| `delivery-flow/scripts/materialize-tfs-tasks.ts` | §4.2 状态段 |
| `delivery-flow/scripts/resolve-tfs-tasks.ts` | 新增（§4.3） |
| `delivery-flow/SKILL.md` | 路由表补 resolve-tfs-tasks 调用时机与 UNKNOWN 处置 |
| `finalize-delivery/scripts/finalize-delivery.ts` | §4.6 归档 push 分支目标修复（TFS 回写段不改） |
| `delivery-gate/scripts/validate-analysis.ts` | §4.7 预估尾注必填校验（缺注/越界/位置非法 → FAIL） |
| `workitem-analysis/SKILL.md` | §4.7/§4.8 tasks.md 写法契约：`[预估: Nh]` 尾注必填 + 首分句 ≤30 字短标题约定 |
| `services/tfs-cli`（本机服务） | §4.7 `workitem create --estimate` 扩展（OriginalEstimate/RemainingWork）；§4.3 `workitem set-state --complete-with-estimate` 扩展（幂等核补 CW=OE / RW=0）+ `query` 输出扩展三工时字段；改后重新 build |
| `docs/multica-delivery-operations-guide.md` | 当前实施状态补状态回写一节 |
| 平台侧 | analysis-completion（`skill update` + files upsert）、delivery-flow（files upsert ×2 脚本 + SKILL update）、finalize-delivery（files upsert 脚本）、delivery-gate（files upsert 脚本 + SKILL update）、workitem-analysis（skill update）同步 |

**不改**：finalize-delivery.ts 的 TFS 回写段、development-execution（Engineer 侧零 TFS 依赖，红线 5）、tfs-sync（同步入口不变——需求离开"活动"后即出同步范围，交付事实已由 Issue 承载，实测 FOMA-37 无冲突）。

### 4.6 finalize-delivery.ts 归档 push 修复（2026-10-19 实证缺陷）

**实证发现**（2026-10-19，`git fetch` 后核实）：根仓 `multica_spec` 当前检出 dev 分支，ahead origin/dev 4 个提交——FOMA-37 全链产物（分析 Change + Gate PASS、研发证据 ×2、archive commit 17314fe）**只在本地**；本地 master == origin/master。即 finalize 已报告 `pushed: true`，但归档产物从未到达 Gitee 远端。

**根因**：`routeArchive` 的 git 操作三处硬编码 master——归档前 `pull --rebase origin master`（L385）、推送判定 `rev-list origin/master..HEAD --count`（L414）、推送 `push origin master`（L416）。HEAD=dev 时：`rev-list origin/master..HEAD` 永不为 0（dev 领先 master）→ 执行 `push origin master` → 推的是**本地 master 分支**（== origin/master，NO-OP，exit 0 "Everything up-to-date"）→ `detail.pushed = true` 假成功，循环退出。dev 上的归档提交始终未被推送，且无任何告警。

**影响**：
- 工程真相（分析/证据/归档）仅存本机，Gitee 远端缺失；换机或磁盘故障即丢失——双事实源的 OpenSpec 一极无异地备份；
- 对流水线自身无即时影响（in_place 读本机仓，Run cwd 即根仓，内部一致）；
- 存量补齐幂等：修复后重跑 finalize（或人工 `git push origin dev` 一次）即可，push 本身幂等；
- 同类风险（非脚本问题）：资产仓 multica 本地 dev 有未推送提交（683719a / 5955a87），人工推送即可。

**修复**（确定性，无新配置）：
1. `routeArchive` 进入临界区后先 `git symbolic-ref --short HEAD` 探测当前分支名；detach HEAD → exit 3 UNKNOWN；
2. `pull --rebase` / `rev-list` / `push` 三处的 `master` 全部替换为探测到的分支名（推之前核对 `origin/<branch>..HEAD`）；
3. 幂等/重试/兜底语义不变：push 失败 `pull --rebase` 有界重试 ≤3，仍失败 → UNKNOWN（"本地 Commit 保留，恢复时只补 push"）。

**边界**：本修复只承诺"推当前工作分支"；根仓分支策略（dev 是否长期工作分支、与 master 的归一节奏）不在本方案裁定，见 §8 开放问题 4。

### 4.7 任务预估时长（`[预估: Nh]` 尾注，用户裁定：必填 + TFS 工时字段与描述）

**链路**：Analyst 在 tasks.md 每个 task 声明**行末**尾注 `[预估: Nh]`（N 为正数、≤6h）→ Analysis Gate 强制校验 → 物化时写 TFS 工时字段。6h 上限的价值不在估算精度，在**拆分纪律**——超过 6h 说明粒度太粗，Gate 打回重拆（机器可判定）。

**格式契约**（唯一权威正则，Gate 与物化共用同一定义）：

```text
行末匹配：/\s*\[预估:\s*(\d+(?:\.\d+)?)\s*h\]\s*$/i
合法：N > 0 且 N ≤ 6；尾注必须在 task 声明行行末（不在行末 = 格式非法）
```

1. **Analysis Gate 扩展**（`delivery-gate/scripts/validate-analysis.ts`，用户裁定：必填）：逐 task 声明行校验——缺尾注 / N≤0 / N>6 / 尾注不在行末 → Gate FAIL（理由列明 ref 与原因）；
2. **物化扩展**（`materialize-tfs-tasks.ts`）：
   - 前置校验：全部待物化 ref 的行文本含合法尾注，任一缺失/非法 → **exit 2 零写入**（与 §4.3 前置风格一致；正常流程 Gate 已拦截，此前置防绕过）；
   - 标题剥离尾注（见 §4.8）；描述文件追加一行 `预估: Nh`；
   - tfs-cli `workitem create` 扩展 `--estimate <hours>`：创建时写 `Microsoft.VSTS.Scheduling.OriginalEstimate` 与 `RemainingWork`（均为 N）；**CompletedWork 创建时不写**——在任务置"已解决"时由 `set-state --complete-with-estimate` 确定性落库 CW=OE（§4.3，2026-10-20 用户裁定，推翻原"CompletedWork 不写"结论；本流程工时为预估口径，实际工时填报仍属人工，§7）；
   - reused/adopted 路径**不补写**工时（既有任务的预估值以其创建时为准，避免重写历史事实）。
3. **tfs-cli 扩展**（`services/tfs-cli`，本机服务，改后重新 build）：create 的 PATCH doc 追加两个 `/fields/` add op；字段 reference name 以英文寻址（与本地化无关），SW-9 实测核验本实例可用性。

### 4.8 TFS 任务标题简化（用户裁定：源头约定 + 脚本兜底）

**现状**：TFS 标题 = `[<issueKEY> <ref>] ` + tasks.md 原生行文本全文（`extractTaskText`），含实现细节，过长。

**两层修法**：

1. **源头约定**（`workitem-analysis/SKILL.md` 写法契约）：task 声明首分句为"动作+对象"短标题（≤30 字），实现细节进 task 描述/验收条件——不机器校验（分句边界是语义判定，不确定），靠约定 + 下层兜底；
2. **脚本兜底**（`materialize-tfs-tasks.ts`）：标题正文（剥离预估尾注后）确定性截断——`TITLE_TEXT_MAX = 80` 字符，超出截断 + `…`；prefix `[<issueKEY> <ref>]` 不参与截断（身份前缀完整保留）；**完整行文本**追加进 TFS 描述（一行 `Task: <原生行文本>`，标注来源 tasks.md，TFS 侧不丢信息）。

**兼容性**：孤儿认领按 `title.startsWith(prefix)` 匹配（materialize-tfs-tasks.ts:303），截断只发生在 prefix 之后，认领路径不受影响（SW-10 覆盖）。存量已创建任务不改标题（重写历史事实无收益）。

## 5. 关键场景语义

| 场景 | 行为 |
|---|---|
| 正常流 | 需求：活动→已分析（分析收口）→已解决（finalize）；任务：已建议→活动（派发）→已解决（Lead 汇总） |
| Human 驳回重分析 | 需求停留"已分析"（分析确曾完成）；重分析后 complete-analysis 重跑，set-state 幂等 NO-OP |
| ENGINEERING 返工 | 任务复用旧 ID（TF-5）；新 dispatch 物化时重试置"活动"（已解决→活动，跳态不预验证，被拒则 UNKNOWN 交 Human） |
| 多 dispatch（前后端） | resolve-tfs-tasks 按 active 条目并集一次性置全部任务；Lead 在**全部** dispatch 完成后调用一次 |
| 部分任务置态失败 | UNKNOWN 输出 `failed` 明细；重跑本脚本幂等补齐，不影响已解决的任务 |
| TFS 全程不可达 | 各写点独立 UNKNOWN；交付主流程（分析落账/派发/收口）不受阻，修复后逐脚本重跑补齐 |

## 6. 验收（SW 系列，2026-10-20 实测全过）

测试纪律：只用专用测试工作项（TFS 256462 及其下测试任务，或新建专用测试需求）；验收后任务状态恢复/标注、测试 Issue 取消并清 `tfs.id`。

| # | 用例 | 预期 | 实测（2026-10-20，测试 Issue FOMA-39/40，父项 256462，任务 258512/258513） |
|---|---|---|---|
| SW-1 | 正常流全链 | 测试 Issue 走 complete-analysis → 需求"已分析"；materialize-tfs-tasks → 任务"活动"；resolve-tfs-tasks → 任务"已解决"；回读全部一致 | ✅ complete-analysis `tfs_state:已分析`（256462 回读一致）；materialize created{9.1:258512, 9.2:258513} + state_set 全"活动"；resolve PASS + 回读两任务"已解决" |
| SW-2 | 幂等 | 三个写点各自重跑 → NO-OP / 同结果，无重复副作用 | ✅ 三脚本重跑均 PASS 同结果（set-state changed:false NO-OP；materialize reused 路径） |
| SW-3 | 无 tfs.id | complete-analysis 跳过 TFS 段（`tfs_state: skipped`），主结果 PASS 不受影响 | ✅ FOMA-40 PASS + `tfs_state:"skipped"` |
| SW-4 | TFS 段失败（构造） | 各写点 exit 3 UNKNOWN，已落账事实不回滚；修复后重跑自愈 | ✅ TFS_URL 指向坏地址 → exit 3 + `tfs_state:"failed"` + delivery 段信息完整保留；恢复后重跑 PASS 自愈 |
| SW-5 | resolve 前置 | 有 active 条目缺 tfs_task_ids → exit 2 零写入 | ✅ 清映射后 exit 2 + 明确提示"先重跑 materialize-tfs-tasks 补齐"；重跑 materialize 经 adopted 补齐后 resolve PASS |
| SW-6 | 返工跳态 | 已解决任务被新 dispatch 复用 → 置"活动"：成功则记录实证结果，被拒则 UNKNOWN 如实输出（裁定④，两种结果都接受并回填本文档） | ✅ **实证：`已解决→活动` 被本实例状态机允许**——两任务成功回"活动"，开放问题 1 关闭（无需 reopen 路径） |
| SW-7 | 部分失败 | 构造单个任务置态失败 → UNKNOWN + failed 明细，其余任务已解决；重跑补齐 | ✅ 塞坏 ID（9.2→99999999）→ exit 3 + failed 明细（9.1 正常已解决）；恢复映射重跑 PASS 补齐 |
| SW-8 | 归档 push 分支目标 | 根仓检出非 master 分支（如 dev）执行 finalize 归档段 → push 目标为当前分支，远端对应分支确实收到归档提交，`rev-list origin/<branch>..HEAD` 归零；detach HEAD → UNKNOWN | ✅ 代码级实证：`symbolic-ref --short HEAD`=dev；修复后判定 `rev-list origin/dev..HEAD`=4（正确识别未推送，对比修复前 `origin/master..HEAD`=9 永≠0 的误判源）；三处命令全部 branch 变量化；detach→UNKNOWN 代码路径明确。**全链实证（真实 finalize 走归档段）待下次交付回填** |
| SW-9 | 预估时长 | Gate：缺尾注 / N>6 / 尾注不在行末 → FAIL 且理由列明 ref；合法 → 物化后 TFS 任务 OriginalEstimate=RemainingWork=N、描述含 `预估: Nh` 行、标题不含尾注；绕过 Gate 构造缺注物化 → exit 2 零写入；reused/adopted 不补写工时 | ✅ Gate 三用例 FAIL 分型正确（缺注/8h 越界/不在行末）；物化前置 exit 2；258512 工时=2、258513 工时=4（OriginalEstimate=RemainingWork），描述含 `预估: Nh` 行，标题无尾注；**工时字段本实例可用（开放问题 5 关闭）**；reused/adopted 路径不写工时（代码保证） |
| SW-10 | 标题简化 | >80 字符行文本物化 → 标题截断 + `…`、prefix 完整、描述含完整行文本；截断标题任务清除 metadata 记录后重跑物化 → adopted 认领（不重建）；存量任务标题不变 | ✅ 258513 标题=prefix(14)+80 字符+`…`=95 字符，描述含完整行文本（108 字符含尾注）；清映射重跑 → adopted{9.1:258512, 9.2:258513} 同 ID 不重建 |
| SW-11 | 已解决工时落库（2026-10-20 裁定） | ① 已解决任务 RW≠0/CW=null 时 set-state --complete-with-estimate → changed:true，同一 PATCH 补 RW=0/CW=OE；② 重跑 → changed:false（幂等）；③ resolve 全链 PASS 且输出 estimate_missing；④ 人为制造工时漂移（RW 改回非 0）后重跑 resolve → 自愈 PASS、回读 RW=0/CW=OE | ✅ ① 258512 changed:true（RW 2→0、CW null→2）、258513 changed:true（RW 4→0、CW null→4）；② 258512 重跑 changed:false；③ resolve（FOMA-39）PASS + `estimate_missing:[]`，回读核对含三工时字段；④ 258513 RW 人为改回 4 → 重跑 resolve PASS，回读 RW=0/CW=4（自愈）；query 新字段输出实证正常 |

**实施偏差（与方案文字不一致处，均为收紧/对齐，语义不变）**：

1. `resolve-tfs-tasks.ts` 映射来源为**任意 dispatch 条目**（含失效）记录的第一个 id——与 materialize-tfs-tasks recordedId 查询逻辑对齐，避免失效条目持有唯一记录时误 FAIL；
2. `complete-analysis.ts` 新增可选 `--registry-config`（取 `runtime.tfs_cli`，方案未明写 tfs_cli 来源）；tfs.id 有效但未传该参数 → `tfs_state:"skipped_no_registry_config"`（向后兼容旧调用，SKILL.md 已要求必传）；
3. SW-2b 首次重跑遇 Multica CLI 偶发网络 UNKNOWN（非产品缺陷），重跑即 PASS——反向实证了"UNKNOWN 如实输出 + 重跑自愈"路径。

**清理记录**：258512/258513 评论标注测试产物（停"已解决"，管理侧人工关闭）；256462 恢复"活动"（验收前基线）；FOMA-39/40 取消且 FOMA-39 已清 tfs.id；测试 Change `sw-test-state-writeback` 已删，根仓工作区干净。

## 7. 明确不做

- "已验证"/"已关闭"写入（用户裁定③，管理侧人工）；
- 跳态合法性预验证（裁定④）；
- 任务"已解决"的 Engineer 侧写点（裁定②，保持 TFS 写点集中）；
- 防重 metadata 标记（§4.3 裁定）；
- 任务级**实际工时**填报——本流程工时三字段为**预估口径**（创建 OE=RW=N；已解决 CW=OE、RW=0 脚本确定性落库，§4.3 裁定）；实际工时归管理侧人工，脚本不写（原"CompletedWork 不写"结论已被 2026-10-20 裁定推翻并限缩为本条）；
- task 首分句 ≤30 字的机器校验——分句边界是语义判定，靠写法约定 + 截断兜底（§4.8）；
- 存量 TFS 任务的标题改写与工时补写（重写历史事实无收益）；
- 存量 Issue 的批量状态补写（如需，逐个手动触发对应脚本即可，天然幂等）；
- 根仓分支策略裁定（dev 是否长期工作分支、与 master 的归一节奏）——§4.6 只修复"推当前工作分支"，策略本身交 Human（§8 开放问题 4）；
- CANCEL_DELIVERY 的状态清理（02 未定义，交 Human）。

## 8. 开放问题

1. ~~**SW-6 的实测结果**~~（2026-10-20 关闭）：`已解决→活动` 被本实例状态机允许（258512/258513 实证），返工场景任务状态可正确回"活动"，无需 reopen 路径；
2. ~~**"活动→已分析"若被拒**~~（2026-10-20 关闭）：SW-1 实证 `活动→已分析` 成功（256462），需求侧迁移路径可用；
3. **需求"已解决"时机**：当前 finalize 在 PR 合并+归档后写；若管理侧期望 PR 合并即已解决（归档前），需把写点前移——观察实际使用反馈再定；
4. **根仓分支策略**：当前 dev 检出是长期形态还是临时？若长期，ops guide 及其他资产中"归档推 master"类假设需统一修订；SW-8 修复后脚本跟随当前分支，策略裁定不阻塞本方案实施；
5. ~~**工时字段实例核验**~~（2026-10-20 关闭）：`Microsoft.VSTS.Scheduling.OriginalEstimate/RemainingWork` 本实例可用（258512/258513 实证写入与回读一致），无需降级路径；
6. **SW-8 全链实证**：代码级实证已过，真实 finalize 走归档段（非 master 分支 push + 远端确实收到）待下次交付回填本文档。
