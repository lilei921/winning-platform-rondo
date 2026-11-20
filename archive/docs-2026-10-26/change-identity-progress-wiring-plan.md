# change-identity-progress-wiring 方案（Change 创建闭环与进度脚本接线：05 §18 下游 Skill 同步）

> 状态：**方案定稿（2026-10-23），待评审；暂不开发**。
> 上游权威：02 v1.6.6 §5.3（Route→Schema 映射）/§7–§8（派工与研发执行）；05 v1.5.2 §5（Change Identity）/§11（任务进度）/§18 第二段（Skill 同步）；`openspec-schema-landing-plan.md` v2 §9。
> 前置事实：`openspec-schema-landing` **已实施落地**（commit `0fd5f095`，2026-10-23）——`projects/multica/scripts/resolve-change-identity.ts` 与 `update-task-progress.ts` 可用，schema 补强 S1–S3 已进两个 schema，验收 O1–O9 全过；docs 对齐因 P0（docs 未入库）仅本地编辑。
> 范围：把两个确定性脚本接进三个已注册 Skill + 冻结 Verify 复用契约 + 平台同步。Verify Agent 本体（缺口④）不在本方案。

## 0. 定位与现状断点

landing 交付了"找对 Change"（resolver）与"安全写进度"（patch 脚本）两个只读/确定性能力，但**消费方 Skill 的文本仍停在脚本不存在时的写法**，闭环未通：

| 消费方 | 现状断点（实测原文） | 后果 |
|---|---|---|
| `workitem-analysis` | Preconditions 仍写"`change_ref` 尚未存在时，按 05 基线创建；**05 未定稿前按 `openspec/change/<tfs-id>` 约定路径**" | Analyst 无确定的 resolver → NOT_FOUND → `openspec new change --schema` 闭环可执行步骤；临时路径约定与 05 §5.1 命名契约不符 |
| `development-execution` | 步骤 2 仅一句"checkbox 更新遵循受控写入"，无脚本调用、无时机与异常语义 | agent 可能直接编辑 tasks.md，绕过 05 §11 single-writer 锁（schema 补强 S1 只在 apply instruction 层面提示，研发方法未落地） |
| `delivery-flow/materialize-development.ts` | change_ref 校验为内联存在性检查 + metadata 一致性比对，不可解析即 FAIL | 缺 05 §5.5 的恢复语义：可唯一恢复的引用被一刀切 FAIL，交人工的成本高于设计预期 |
| Verify 路线（缺口④） | 无资产 | 共用脚本调用契约若不在本方案冻结，缺口④立项时会各定一套、返工 |

finalize-delivery 的内联 `resolveChangeDir` 按 landing 方案 §7 **维持现状不合并**（长临界区场景，且 10-22 对齐刚改过 RuntimePaths）。

## 1. 设计约束（红线）

1. **只接线，不改语义**：Route 判定（Analyst 技术语义判断）、02 §5.3 映射、05 §5.4 创建禁令、05 §11 进度语义均不变；发现契约本身不足时停止回流，不在 Skill 里打补丁。
2. **脚本为唯一入口**：`change_ref` 解析只调 `resolve-change-identity.ts`；tasks.md checkbox 写入只调 `update-task-progress.ts`。Skill 文本不得保留平行的自建查找/写入逻辑（delivery-flow 内联段删除，finalize 除外）。
3. **确定性失败语义**：CONFLICT/INVALID/BUSY 一律显式处理（STOP / UNKNOWN / 有界重试），不降级为猜测、不静默取第一个。
4. **平台同步纪律**：三个 Skill 均在 `managed_skills` 清单内，改动后必须经 `sync-workspace.ts` 渲染 → 平台 upsert/reconcile → content_hash 回读复核；先 dry-run。
5. **评审自检**：改动按 `agent-skill-review-checklist.md` R1–R8 / S1–S12 / X1–X6 自检——本方案不新增 Agent、状态机分支或跨 Skill 调用，只调整既有 Skill 的调用契约。
6. **入库纪律**：资产改动落本仓当前分支，显式路径暂存；docs 改动受 P0 约束仅本地编辑。

## 2. 改动点清单

| 资产 | 改动 |
|---|---|
| `workspace-skills/workitem-analysis/SKILL.md` | Preconditions 删除临时路径约定，写入 §3.1 创建闭环四步；Procedure 第 2 步路由判断后接 schema 映射与创建；Error Handling 补 CONFLICT/INVALID/ARCHIVED_FOUND 停止语义 |
| `workspace-skills/development-execution/SKILL.md` | 步骤 2 末句与 Output/Evidence 契约具体化为 §3.2：Completion Check PASS 后、发布 READY 前调 `update-task-progress.ts`，含五枚举处理与 Evidence 记录 |
| `workspace-skills/delivery-flow/scripts/materialize-development.ts` + SKILL 契约 | change_ref 不可解析分支由内联 FAIL 改为调 resolver 恢复（§3.3）；其余校验（tasks.md 存在、task_ref 可定位、metadata 一致、NOOP）不变 |
| `workspace-skills/development-execution/references/`（或 `_shared/references/`）新增 `change-progress-script-contract.md` | 冻结两脚本调用契约（命令、枚举、退出码、处理表），Verify 路线（缺口④）与本方案三 Skill 共同引用，一处维护 |
| 02 / 05 文档 | 仅补指针：02 §5.3.1 与 §8 相关段标注"实施资产见本方案接线"；05 §18 第二段标记已收口。受 P0 约束本地编辑 |

## 3. 接线契约

### 3.1 workitem-analysis：Change 创建闭环（本方案核心）

Preconditions 中 `change_ref` 段替换为以下确定流程（Analyst 在路由判断完成、schema 确定后执行）：

```text
① 解析根仓：resolve-root-repo.ts（既有）→ openspec_root
② 身份解析：
   node projects/multica/scripts/resolve-change-identity.ts \
     --openspec-root <root> \
     [--change-ref <metadata analysis.change_ref，存在时>] \
     [--tfs-id <tfs.id>] \
     --expect-schema <02 §5.3 映射结果>
③ 按枚举处理：
   ACTIVE_FOUND    → 采用其 change_ref；metadata 缺失/不一致 → 交 analysis-completion 回写修复（05 §5.5 Case A，禁止重建）
   ARCHIVED_FOUND  → STOP：不重新应用 Delta、不新建同 ID Change（05 §5.5 Case B），交 Delivery Lead 判定
   NOT_FOUND       → 仅当路由判断已完成（change_kind/schema/TFS 身份明确）才允许 ④
   CONFLICT/INVALID→ STOP（UNKNOWN），交 Delivery Lead / Human（05 §5.5 Case C），禁止取第一个、禁止新建掩盖
④ 创建（仅 NOT_FOUND 后）：
   openspec new change <semantic-slug>-<tfs-id> --schema <corrective-change|intentional-change>
   → 回读 .openspec.yaml 校验 id + schema
   → change_ref 进入 Analysis Handoff Facts，由 analysis-completion 写回并回读确认
```

Route→schema 映射直接引用 02 §5.3（`bug-fix`/`production-fix`→`corrective-change`；`sdd-fast`→`intentional-change`），**不按 TFS Type 机械二分**的既有纪律不变；05 §5.4 禁令逐条保留（Human Reject / Development Rework / change_ref 暂时缺失均不新建，不用 title 相似度猜测）。

### 3.2 development-execution：任务进度接线

步骤 2 末句"checkbox 更新遵循受控写入"具体化为：

```text
时机：Development Completion Check PASS 之后、发布 READY 之前（05 §11.5：Patch 未确认不得发布 READY）
命令：
  node projects/multica/scripts/update-task-progress.ts \
    --openspec-root <root> --change-ref <change_ref> --check <本轮完成的 task_refs>
task_refs 来源：本轮实际完成且证据有效的 assigned 任务；失败/未完成任务不传入；脚本不自动扩大范围
枚举处理：
  UPDATED / ALREADY_COMPLETE → 继续；ALREADY_COMPLETE 在 Evidence 标注（可能存在重复 Runtime，05 §11.2）
  BUSY                       → Skill 级有界重试（≤3 次，间隔 ≥30s）；仍 BUSY → UNKNOWN 暂停发布 READY，已形成的验证证据保留可复用（05 §11.5）
  CONFLICT / INVALID         → STOP 交 Delivery Lead，不假勾、不覆盖
Evidence：脚本 stdout JSON 原文记入 evidence.json 的对应 task 条目
```

Output 契约同步：OpenSpec 根仓的"tasks.md 任务事实更新"明确为"经 `update-task-progress.ts` 写入 + 回读核对"。

### 3.3 delivery-flow：resolver 接入派发闸口

`materialize-development.ts` 现有校验保留（tasks.md 存在、每个 task_ref 原生编号可定位、metadata `analysis.change_ref` 与 `--change-ref` 一致、NOOP 检查）。仅把"change 目录不可解析"分支改为：

```text
change_ref 目录不可解析
→ 调 resolve-change-identity.ts（--change-ref + --tfs-id）
→ ACTIVE_FOUND（唯一恢复）→ 以 resolver 结果为准继续，FAIL 事实记录恢复路径
→ ARCHIVED_FOUND / CONFLICT / INVALID / NOT_FOUND → FAIL（含枚举与原由），交 Lead；不创建、不派发
```

闸口性质不变：materialize 只校验与物化，**不创建 Change**。

### 3.4 Verify 路线契约预留（不建本体）

新增 `change-progress-script-contract.md` 统一承载：两脚本命令签名、五枚举+退出码映射、§3.2 处理表、以及 Verify 专用语义——"Verify 只更新已实际执行且证据有效的 assigned Verification Tasks，不以 Verification Gate PASS 为前置，不经过 Engineer 的 Development Completion Check"（05 §11.1）。缺口④（Verify Agent + acceptance-verification + route-verify-result/validate-verification）立项时直接引用本契约，不另定。

## 4. 平台同步纪律

三个改动 Skill（workitem-analysis / development-execution / delivery-flow）均在 `managed_skills` 清单：

```bash
node projects/multica/scripts/sync-workspace.ts --workspace <目标工作区> --dry-run   # 先审
node projects/multica/scripts/sync-workspace.ts --workspace <目标工作区>             # 渲染+upsert+reconcile+hash 回读
```

同步后平台复核：三 Skill 的 content_hash 与本地渲染一致；Agent 绑定关系不变（Analyst/Lead/Backend/Frontend 既有绑定不增删）。

## 5. 验收（W 系列）

纪律：隔离工作区 + 一次性测试 Issue/Change（`wire-test-<tfs-id>`）；不触真实 Issue metadata 与真实 specs/；验收后清理。

| # | 用例 | 预期 |
|---|---|---|
| W1 | 创建闭环正路径：metadata 无 change_ref + 唯一 active 候选 | resolver→ACTIVE_FOUND，回写修复；另跑 NOT_FOUND 场景：`openspec new change --schema` 创建→回读校验→change_ref 写回回读确认，schema 与 02 §5.3 映射一致 |
| W2 | 创建闭环负向：双候选 / 仅 archive 存在 | CONFLICT→STOP 不创建不取第一个；ARCHIVED_FOUND→STOP 不重建（05 §5.5 B/C） |
| W3 | 进度接线：两"Engineer"并行勾同一 Change 不同 task_refs；重复勾；持锁占用 | 无 lost update；重复→ALREADY_COMPLETE 且 Evidence 有标注；BUSY 重试 3 次仍占用→UNKNOWN 且不发布 READY、证据保留 |
| W4 | delivery-flow 恢复与闸口：change_ref 可唯一恢复 / 不可恢复 | 可恢复→派发继续且事实记录恢复路径；不可恢复→FAIL 含枚举；全路径不创建 Change |
| W5 | 平台同步一致性 | dry-run 差异符合预期；正式同步后三 Skill content_hash 平台=本地；绑定不变 |
| W6 | 契约完整性 | `change-progress-script-contract.md` 的命令签名与两脚本 `--help` 实际输出一致；SKILL 内引用路径存在；R1–R8/S1–S12/X1–X6 自检无新增违例 |

## 6. 明确不做

- Verify Agent 本体、`acceptance-verification` Skill、route-verify-result / validate-verification（缺口④，复用 §3.4 冻结契约）；
- finalize-delivery 内联 `resolveChangeDir` 的合并重构（landing §7 既定）；
- 两个 schema 与模板的内容变更（landing 已收口；再改走 05 修订流程）；
- `openspec/schemas/sdd/`（opsx 流程资产，不纳入本次接线）；
- 03 / 06 新建、CANCEL_DELIVERY 归属、docs 入库（P0，缺口 A3）、TFS 侧任何变更。

## 7. 开放问题

1. **change_ref 回写时机**：创建发生在 Analysis Gate 之前，Gate 失败时 Change 已存在——按 05 §5.5 Case A 属可恢复状态（下次 Run 唯一候选修复），本方案按此执行；如需"Gate 失败即清理"另行裁定（当前不建清理动作，避免误删已批准基线）；
2. **BUSY 重试参数**：建议 Skill 级 ≤3 次、间隔 ≥30s（脚本内部已有 30s 有界等待）；W3 实测后可调；
3. **sdd schema 的进度写入**：本仓第三个 schema（opsx 流程）的 tasks.md 是否同样强制经脚本更新——建议暂不强约束，待 opsx 流程与主流水线关系明确后裁定。

## 8. 依赖与顺序

```text
openspec-schema-landing（已完成，0fd5f095）
→ 本方案：3.1 / 3.2 / 3.3 可并行开发，3.4 为文档（先行，供三处引用）
→ W1–W6 验收
→ 平台同步（§4）+ hash 复核
→ 缺口④ 立项（引用 §3.4 契约，不重复定义）
```

与缺口 A2（平台发布链路 E2E）无代码依赖，但真实放量前建议 A2 的隔离 E2E 已覆盖本接线路径。

---

## 9. 实施与验收记录（2026-10-23，已收口）

实施：§3.4 冻结契约 `development-execution/references/change-progress-script-contract.md` 新建；§3.1 workitem-analysis 步骤 3 创建闭环接线（Preconditions 与 Error Handling 同步）；§3.2 development-execution 步骤 9 Task Progress Patch 接线（步骤 2 / Output / Failure 同步）；§3.3 materialize-development resolver 恢复接入（`runResolver` + `change_ref_recovery` 输出，delivery-flow SKILL 脚本行为同步）；02 §5.3.1/§8 与 05 §18 指针更新（docs 未入库 P0，本地编辑）。

实施中修复 1 处缺陷：materialize-development `runResolver` 初版误传 `paths.openspecRoot`（…/openspec）给 resolver 的 `--openspec-root`（语义为根仓，脚本自 join `openspec/changes`），W1 实测暴露后改为 `paths.rootRepo`。

验收（全部 PASS，一次性 `wire-test-*` 资产与测试 Issue FOMA-42 已清理/取消）：

| # | 结果 |
|---|---|
| W1 | NOT_FOUND→`openspec new change wire-test-create-999001 --schema corrective-change`→`.openspec.yaml` 回读 schema 一致→resolver 主查找/恢复查找均 ACTIVE_FOUND |
| W2 | 双候选 CONFLICT rc=2 列明候选不取第一个；archive-only ARCHIVED_FOUND rc=0 返回逻辑 ID 不重建；`--expect-schema` 不符 INVALID rc=2 |
| W3 | 顺序 UPDATED→重复 ALREADY_COMPLETE（`skipped_already`）；4 路并行勾不同 task_refs 全部 UPDATED 无 lost update；活 pid 持锁 → 30s 有界重试后 BUSY rc=2 零写入；死 pid stale 锁接管成功；目标行不存在 CONFLICT rc=2 |
| W4 | 一次性 Issue FOMA-42（已取消）：stale `analysis.change_ref` 经 resolver ACTIVE_FOUND 恢复→PASS，`change_ref_recovery` 记录 from/to/via，dispatch 条目用解析后 ref，重跑 NOOP；不可解析→FAIL 含 `resolver=NOT_FOUND`，全路径零创建（openspec/changes 与 archive 均无残留） |
| W5 | `sync-workspace.ts --workspace beiluoshimen --dry-run` PASS（渲染 diff 为既有 CRLF 漂移，`--local-only` 后 git 无可见变更）；正式同步 PASS（11 Skill synced）；`--check` 回读 drifts=[]；新契约文件已确认在平台 development-execution files 列表 |
| W6 | 两脚本 `--help` 与冻结契约签名一致；SKILL 引用路径全部存在；R1–R8/S1–S12/X1–X6 自检无新增违例（枚举处理表唯一权威在契约文档，SKILL 只留角色时机与引用；Route→Schema 映射 owner 仍为 02 §5.3） |
