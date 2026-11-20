# TFS Bug 交付免建子任务优化实施方案

> Date: 2026-10-26（同日经一轮评审修订，见 §10）
> Status: Draft（已评审事实，未开发）
> 上游权威：`02-multica-delivery-lifecycle-design.md` §7"按 TFS Type 补齐必要 TFS Task / 关联"（设计语义已预留类型分支，本方案是实现补齐，非架构变更）
> 触发场景：TFS Bug（如 251174）走 multica 自动化交付时，不应在 TFS 下创建子任务，但 PR 须基于 bug 号关联

## 1. 目标与原则

- `tfs.type=Bug` 的 Delivery：不创建 TFS 子任务、不强制 `[预估: Nh]` 尾注；PR 仍基于 bug 号关联（**PR 侧已满足，零改动**）。
- `tfs.type=需求`：现有行为完全不变。
- 判定全部收敛在 skill-flow 确定性脚本内（薄适配原则），Delivery Lead / Workitem Analyst 的语义流程不变。
- 兼容历史数据：改动前已建子任务的 Bug 交付（存在 `tfs_task_ids` 映射）不受影响，仍走既有核对与置态。

## 2. 现状（skill-flow 0.1.2 实测，2026-10-26）

| 环节 | 现状 | 证据 |
|---|---|---|
| `tfs reconcile-workitem` | 已把 `tfs.type` 写入 Issue metadata（managed keys 之一） | `dist/commands/tfs/reconcile-workitem.js` MANAGED_METADATA_KEYS |
| `tfs materialize-tasks` | 不读 `tfs.type`，Bug 与需求一样按 task_refs 建子任务，强制 `[预估: Nh]` 尾注（缺注 exit 2 零创建） | `src/commands/tfs/materialize-tasks.ts` 全文无 type 判断 |
| `tfs resolve-tasks` | 前置要求全部 task_refs 有 `tfs_task_ids` 映射，缺 → exit 2 FAIL | `src/commands/tfs/resolve-tasks.ts` |
| `analysis validate`（Analysis Gate） | `task_estimates` 检查无条件强制逐 task 行末 `[预估: Nh]`（0<N≤6），bug-fix Route 同样被卡 | `src/commands/analysis/validate.ts` checkTaskEstimates |
| `dev check-completion` | `commit_task_links` 检查（`--issue` + `--registry-config` 启用）：commit `Refs: #<id>` 须属于 `tfs_task_ids` 集合且覆盖全部 task_refs；**无 `tfs_task_ids` → UNKNOWN**，Engineer 无法 READY | `src/commands/dev/check-completion.ts` commit_task_links |
| `delivery finalize` | `tfsTasksResolvedGate`：active dispatch 的 task_refs 缺映射 → FAIL；skipped 仅限"无 dev.dispatch / 无 active 条目" | `src/commands/delivery/finalize.ts` tfsTasksResolvedGate |
| `pr materialize` | 创建 PR 时 `--work-items <tfs.id>` 关联工作项；分支 `feat/<tfs-id>`。**Bug 场景已满足"基于 bug 号生成 PR"，无需改动** | `src/commands/pr/materialize.ts` |

关键结论：预估尾注的唯一下游消费者是 `materialize-tasks`；Bug 免建任务后，`task_estimates` 对 Bug 交付成为纯负担，必须同步放宽，否则 Analysis Gate 阶段就会 FAIL。

另一处关键事实：Commit Message `Refs:` 尾注现行规范（`development-execution/SKILL.md`）只允许写 `#<任务id>`（来自 `tfs_task_ids`），且明文禁止写父工作项 ID。Bug 免建任务后 Engineer 无合法 ID 可写，必须为 Bug 定义替代口径（见 §4.5）。

## 3. 判定数据源

Issue metadata `tfs.type`（`reconcile-workitem` 已作为 managed key 写入；存量 Issue 重跑同步即补齐）。

**读取不到 `tfs.type` 时一律 UNKNOWN（exit 3）停止，不默认按需求建任务**——防止静默误判产生垃圾子任务。

## 4. 代码改动（5 处，均在根仓 `tools/skill-flow/src/`，改后 tsc 构建发布 0.1.3）

### 4.1 `commands/tfs/materialize-tasks.ts` — 入口加类型分支

```text
读取 Issue metadata tfs.type：
  Bug       → { result: "NOOP", reason: "tfs_type_bug_skip" }，exit 0
              （零创建、跳过 [预估:Nh] 前置校验、不写 tfs_task_ids）
  需求      → 现有逻辑不变
  缺失/其他 → UNKNOWN（exit 3），交 Delivery Lead
```

### 4.2 `commands/tfs/resolve-tasks.ts` — 前置条件放宽

```text
tfs.type=Bug：
  全部 task_refs 无 tfs_task_ids 映射 → NOOP（不再 exit 2）
  存在映射（历史已建任务）           → 维持现有置「已解决」+ 工时落库逻辑（保守核对，不丢历史）
tfs.type=需求：现有逻辑不变
```

### 4.3 `commands/delivery/finalize.ts` — `tfsTasksResolvedGate` 加 skipped 分支

```text
tfs.type=Bug 且全部 task_refs 无映射 → { checked: false, note: "tfs.type=Bug，无 TFS 任务面" }（skipped）
tfs.type=Bug 且存在映射              → 维持现有回读核对（历史兼容）
tfs.type=需求                         → 现有逻辑不变
```

不改此项，跳过建任务的 Bug 会在 finalize 被"缺映射"FAIL 卡死——连锁改动中最隐蔽的一处。

### 4.4 `commands/analysis/validate.ts` — `task_estimates` 按类型分型

```text
metadata tfs.type=Bug → task_estimates 输出 skipped（不强制尾注；已写尾注不报错，向后兼容存量 Change）
tfs.type=需求         → 现有强制不变（0<N≤6 拆分纪律保留）
```

注意：`checkTaskEstimates` 当前只接收 `changeDir`，需把 Issue metadata（或仅 `tfs.type`）透传进函数——签名小改，调用点在同文件 main 流程内（`getMetadata` 已在读取 Issue metadata，数据源现成）。

### 4.5 `commands/dev/check-completion.ts` — `commit_task_links` 加 Bug 口径（评审发现的关键遗漏）

不改此项，Bug 交付的 Engineer 在 Completion Check 阶段被 UNKNOWN 卡死（无 `tfs_task_ids` → "任务物化未完成"），**比 finalize 那处更早爆雷**。

```text
tfs.type=Bug：
  commit_task_links 不再核验 task_ref ↔ TFS 任务 id 映射；
  改为核验：每个业务仓 commit 的 Refs: 尾注行含 #<tfs.id>（bug 号）
    → 与"基于 bug 号生成 PR"语义一致，TFS 侧天然形成 Bug ↔ Commit ↔ PR 关联链
  映射缺失不再 UNKNOWN；缺 Refs: 或指向其他 id → FAIL
tfs.type=需求：现有逻辑不变
tfs.type 缺失：UNKNOWN（不默认按需求核验）
```

**连带规范变更**（语义层，需随代码同步）：Bug 交付的业务仓 commit `Refs:` 尾注改写 `#<bug号>`——现行"禁写父工作项 ID"规则对 Bug 场景反转（bug 号即交付主体本身）。需求场景规则不变。

## 5. 契约 / 文档同步（根仓，7 处）

| 文件 | 改动 |
|---|---|
| `workspace-skills/delivery-flow/SKILL.md` | materialize-tasks / resolve-tasks 脚本行为补 Bug NOOP 分支；Validation 补"Bug 时 `tfs_task_ids` 缺省为正常态" |
| `workspace-skills/finalize-delivery/SKILL.md` | Delivery Completion Gate 描述补 Bug skipped 口径 |
| `workspace-skills/delivery-gate/SKILL.md` | 检查项表中 `task_estimates` 补"tfs.type=Bug → skipped"口径 |
| `workspace-skills/development-execution/SKILL.md` | Commit `Refs:` 规范补 Bug 口径（写 `#<bug号>`）；check-completion 契约段补 Bug 核验规则 |
| `development-execution/references/development-evidence-contract.md` | commit ↔ 任务关联核验描述补 Bug 口径 |
| `delivery-flow/references/dispatch-facts-contract.md` | `tfs_task_ids` 条目：明确"仅 tfs.type=需求 物化；Bug 恒缺省" |
| `finalize-delivery/references/finalize-facts-contract.md` + `workitem-analysis/references/tasks-md-authoring-contract.md` + `workitem-analysis/SKILL.md` | finalize Gate 口径同步；`[预估: Nh]` 改为"tfs.type=需求 必填；Bug 可选"（tasks-md-authoring-contract 标头的被引用清单顺带核对） |

`02-multica-delivery-lifecycle-design.md` §7 措辞语义已兼容，建议补一句明确"Bug 不建子任务"消除歧义（语义背景文档，非执行依赖）。

## 6. 验证矩阵（实施后的验收场景）

| 场景 | 期望 |
|---|---|
| Bug 全流程（新建）：分析 → 派发 → 研发 → 汇总 → PR → finalize | Gate `task_estimates=skipped`；commit `Refs: #<bug号>` 核验 PASS；materialize/resolve 均 NOOP；finalize gate skipped；PR 关联 bug 号；TFS Bug 置「已解决」 |
| 需求全流程回归 | 与现状完全一致（建任务、Refs 任务 id 核验、置已解决、工时落库、finalize 核对 PASS） |
| 历史 Bug（改动前已建任务、有映射） | resolve-tasks 正常置已解决；finalize gate 正常核对，不 skipped |
| Bug 交付 commit 未写 `Refs: #<bug号>` 或写了他项 id | commit_task_links FAIL，Engineer 补 commit message 后重跑 |
| 缺 `tfs.type` 的旧 Issue | 三处脚本均 UNKNOWN，不建任务、不 FAIL 死 |
| Bug 但 tasks.md 写了预估尾注 | 不报错（向后兼容存量 Change） |

## 7. 发布步骤

1. `tools/skill-flow` 改码 → `npm run build`（tsc）→ 版本 0.1.2 → **0.1.3**；
2. 本机全局重装 `@winning/skill-flow`——**两处安装位置都要更新**（2026-10-26 排查发现并存）：
   - `C:\Program Files\nodejs\node_modules\@winning\skill-flow`
   - `D:\WN_Platform\tools\nvm\v24.14.1\node_modules\@winning\skill-flow`
3. 契约文档提交根仓；Skill 文档如有平台侧物化副本需同步上传；
4. 用真实 Bug（如 251174 置「活动」后）跑端到端验证。

## 8. 风险与注意

- **双安装位置**：两处 skill-flow 并存，发布遗漏会导致不同 daemon 行为不一致；
- Bug 免建任务后，TFS 侧 Bug 不再有任何工时落库（现状由子任务承载）——若管理侧要求 Bug 记工时，需评估 finalize 置「已解决」时是否带 `--complete-with-estimate`；默认不加，先与管理口径确认；
- `sdd-standard` 不自动推进，不在本次范围；
- TFS 父项（Bug 本身）的终态回写不受影响：finalize 仍置「已解决」+ 评论，「已验证/已关闭」留给 QA/人工。

## 9. 改动清单速览

| # | 位置 | 类型 | 改动 |
|---|---|---|---|
| 1 | `tools/skill-flow/src/commands/tfs/materialize-tasks.ts` | 代码 | tfs.type=Bug → NOOP |
| 2 | `tools/skill-flow/src/commands/tfs/resolve-tasks.ts` | 代码 | Bug 无映射 → NOOP；有映射维持核对 |
| 3 | `tools/skill-flow/src/commands/delivery/finalize.ts` | 代码 | tfsTasksResolvedGate 增加 Bug skipped 分支 |
| 4 | `tools/skill-flow/src/commands/analysis/validate.ts` | 代码 | task_estimates 按 tfs.type 分型（Bug → skipped） |
| 5 | `tools/skill-flow/src/commands/dev/check-completion.ts` | 代码 | commit_task_links：Bug 改为核验 `Refs: #<bug号>` |
| 6 | delivery-flow / finalize-delivery / delivery-gate / development-execution SKILL.md | 文档 | 同步类型分支语义与 Bug commit 规范 |
| 7 | dispatch-facts / finalize-facts / development-evidence / tasks-md-authoring 契约 + workitem-analysis/SKILL.md | 文档 | `tfs_task_ids` Bug 缺省口径；预估尾注"需求必填 / Bug 可选" |
| 8 | `02-multica-delivery-lifecycle-design.md` §7 | 文档（可选） | 补"Bug 不建子任务"明确句 |

## 10. 评审记录（2026-10-26）

首轮评审结论：**1 个关键遗漏 + 2 个文档遗漏**，已全部并入正文：

1. 🔴 **遗漏 `dev check-completion` 的 `commit_task_links`**（代码改动点 #5）：Bug 无 `tfs_task_ids` 时该检查 UNKNOWN，Engineer 无法 READY，交付卡死在研发完成阶段——比 finalize 处更早爆雷。已补 §4.5（含 Bug commit `Refs: #<bug号>` 的规范反转决策）。
2. 🟡 文档清单遗漏 `delivery-gate/SKILL.md`（task_estimates 检查项表）与 `development-execution` 两个文件（Commit `Refs:` 规范 / evidence 契约），已补入 §5。

已核实无误的论断：`tfs.type` 为 managed metadata key（同步自动补写）；PR 侧 `--work-items <tfs.id>` 已满足 bug 号关联；`checkTaskEstimates` 透传 metadata 可行（`getMetadata` 现成）。
