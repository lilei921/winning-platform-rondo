# openspec-schema-landing 方案 v2（缺口⑦ schema 部分：05 实施交付物落地，单仓版）

> 状态：**方案定稿（2026-10-23，单仓适配修订 + schema 补强），待评审后开发**。
> 本版 supersede 2026-10-15 v1：① 落地目标仓由 `multica_spec` 改为**本 monorepo**（单仓裁定，2026-10-23；10-22 repo-context 对齐后流水线 `openspecRoot` 派生自根仓）；② schemas/templates 已提前落地本仓并实测核验，§3 由"新增"改为"核验收尾 + 偏差回填"；③ 创建命令更正为 `openspec new change --schema`（v1 开放问题 1 关闭）；④ 脚本结果枚举 → 退出码映射补齐（v1 评审缺口）；⑤ 新增 schema 补强三项与 design 条件位实测结论（2026-10-23 第二轮分析，§3.2）。
> 上游权威：`docs/05-openspec-schema-implementation-design.md` v1.5.2（Schema/模板/任务契约/进度更新）；01（机制层）；02 §8/§12（流程层）。
> 范围：schemas 核验收尾 + schema 补强（§3.2）+ 两个确定性脚本落地 + 文档对齐 + O 系列验收。**剩余缺口⑦ = 03 新建 + 06 新建 + CANCEL_DELIVERY 归属，不在本方案。**

## 0. 定位与现状（2026-10-23 实测）

把 05 已定稿的 Schema/模板/任务进度契约落成可执行资产。单仓现实下的实测现状：

- **已落地**：本仓 `openspec/schemas/{intentional-change, corrective-change}/`（commit `0da5bcb0` 等，2026-10-13）——`schema validate` 双 PASS、`schema which` 解析为项目级、内容与 05 基线核验一致（核验记录与偏差清单见 §3）。
- **未落地**：`resolve-change-identity` 与 `update-task-progress` 两个确定性脚本在任何仓均不存在；`change_ref` 解析只有 finalize 内联子集（`finalize-delivery.ts` 的 `resolveChangeDir`），`tasks.md` checkbox 串行写入只有 05 文本。
- **文档**：`projects/multica/docs/` 当前被 `projects/multica/.gitignore` 的 `/docs/*` 忽略，不在版本控制内；04/05 的 versioned 入库命名依赖 docs 入库裁定（前置 P0，见 §5）。

```text
本仓 winning-platform-monorepo（分支 multica）：
  openspec/schemas/{intentional,corrective-change}/      ← 已存在，§3 核验
  openspec/config.yaml                                    ← 加一行项目级说明指向 schemas
  projects/multica/scripts/resolve-change-identity.ts     ← 新增，05 §5.2/§5.3（裁决 D1/D3）
  projects/multica/scripts/update-task-progress.ts        ← 新增，05 §11（裁决 D2/D3）
```

## 1. 设计约束（红线）

1. **05 为内容权威**：schema.yaml / templates 以 05 §6.3 / §7.3 / §8 为准，不新造结构；落地资产与 05 文本的偏差（含已存在的 `apply.requires` 偏差，§3）必须回填 05，与 OpenSpec 1.13.2 原生行为冲突时以实测为准并回写 05（05 §0 P1-3 纪律）。
2. **确定性脚本一律 TS 单文件零构建零 npm 依赖**（CLAUDE.md 约定 4）——05 §18 的 `.py` 文件名视为历史笔误（裁决 D1）。
3. **Native First**（05 P0-2）：不造 `AC-xxx`/`VR-xxx` 平行身份、不强制 `[T-xxx]`、不重做原生 validation。
4. **脚本基线语义**：退出码 0 成功 / 2 单项失败 / 3 UNKNOWN / 64 用法；stdout 只出 JSON，日志走 stderr。结果枚举到退出码的映射见 §4 映射表。
5. **process-scoped 锁**：tasks.md patch 锁必须是进程生命周期、可自恢复形态（05 §11.3 精神），与 finalize 的根仓 mkdir 临界区（人工可介入的长临界区）是两个场景（裁决 D2）。
6. **入库纪律**：全部资产落本仓当前工作分支 `multica`；显式路径暂存、AI Commit 格式、只提交本方案路径；**push 需推送授权**（分支当前未推送远端）。schemas/scripts 提交走人工 commit，不入 finalize 自动路径（§8 开放问题 3）。

## 2. 资产布局（单仓）

```text
本仓（已存在，核验收尾）
  openspec/schemas/intentional-change/schema.yaml + templates/{proposal,spec,design,tasks}.md
  openspec/schemas/corrective-change/schema.yaml + templates/{proposal,spec,tasks}.md

本仓（新增）
  projects/multica/scripts/resolve-change-identity.ts   # 05 §5.2/§5.3
  projects/multica/scripts/update-task-progress.ts      # 05 §11

文档对齐（projects/multica/docs/，见 §5，前置 P0）
  02 链接修复；05 回填（六项）；04/05 versioned 入库命名；ops guide 缺口⑦ 更新
```

`openspec/config.yaml` 加一行项目级说明指向 schemas（不改动既有 context 内容）。

## 3. Schemas 落地状态（已完成，附核验记录与偏差回填清单）

核验日期 2026-10-23，基线 05 v1.5.2，CLI OpenSpec 1.13.2：

| 资产 | 核验结果 |
|---|---|
| `intentional-change/schema.yaml` | 与 05 §6.3 **逐字节一致**（diff 为空）；templates 符合 §8.1/§8.3/§8.4/§8.5（Why/Goal/Scope/Capabilities 章节、design 条件生成约束、原生 checkbox 无 T-xxx）；`schema validate` PASS；`schema which` = project 级 |
| `corrective-change/schema.yaml` | artifact graph 符合 §7.1（proposal → specs → tasks，无 design）；templates 符合 §8.2/§8.3/§8.5（Root Cause status+evidence、Specification Relation 决策、原生 Delta Heading）；`schema validate` PASS。存在两处与 §7.3 文本的偏差，见下 |
| skip_specs 语义实测 | 一次性测试 Change（`skip_specs: true` + 无 delta）：`openspec validate` PASS（"zero deltas accepted"）；`openspec status` 显示 `[~] specs (skipped)`，依赖链（`tasks requires: [specs]`）不断裂，判定 "All planning artifacts complete"。测试 Change 已清理 |

**corrective-change 两处偏差（方向均正确，随 §5 回填 05 §7.3）：**

1. instruction 由英文简版扩写为中文详版——内容来自 §8.2 模板契约，属增强；
2. **结构性偏差：`apply.requires` 由 `[proposal, specs, tasks]` 改为 `[proposal, tasks]`**——为 `skip_specs` 场景让路的有意修正（05 §7.4 要求 skipped specs 可满足 `apply.requires`），实测必需。

### 3.1 design 条件位的实测边界（2026-10-23 源码 + 实测）

OpenSpec 1.13.2 的 schema 格式（`artifact-graph/types.d.ts` 的 zod 定义）artifact 仅支持 `id/generates/description/template/instruction/requires` 六字段，**无 conditional/optional 机制**——design 的条件性只能是 instruction 文本约束（与内置 spec-driven schema 同限制，符合 05 §8.4 "条件性由 Analysis Gate 承载、不设 skip_design" 的设计）。实测事实：

- 无 design.md 的 intentional change：`validate` PASS，但 `status` 永远显示 `3/4`，`instructions` 总引导补 design（进度展示噪音）；
- **archive 不检查 design 存在**（源码确认：archive 只校验 delta specs + tasks 进度）——非阻塞。

**推论（Gate 契约约束）：任何 Gate / Completion Check 不得把 `openspec status` 的 "All planning artifacts complete" 作为就绪信号**——无 design 的变更永远到不了该状态。随 §5 回填 05 §16 附注。

### 3.2 schema 补强项（2026-10-23 分析新增，随本方案实施）

三项均为"让 agent 在每个环节读到的第一手指引就是正确纪律"，防下游 Gate 兜底漏检；改动同步回填 05：

| # | 补强 | 内容 | 依赖 |
|---|---|---|---|
| S1 | **apply instruction 指向进度脚本**（两个 schema） | 现有文案"成功后更新任务复选框"会引导 agent 直接编辑 tasks.md、绕过 05 §11 single-writer 锁。改为："checkbox 更新必须经 `projects/multica/scripts/update-task-progress.ts`，不直接编辑 tasks.md" | §4 脚本落地后实施（本方案内） |
| S2 | **tasks 模板/instruction 补派工约束**（两个 schema） | 补 05 §10.1 / §8.5 rule 5-6：① 有效派工期间已被引用的任务编号与正文保持稳定，增补/取消/替换/重编号须经受控 Analysis/Coordination；② 已批准取消的任务不假勾 `[x]`，保留原编号与批准引用、转不参与进度的 Markdown 历史记录。即本方案 §3（v1）承诺的"项目级派工定位约束"，当前模板缺失 | 无 |
| S3 | **corrective tasks instruction 对齐 checkbox 解析规则** | 补 intentional 已有而 corrective 缺失的原生解析规则：`- [~]`/`- [-]`/空 `- []` 均视为未完成、无 checkbox 行不被跟踪——corrective 变更同样需要进度可信 | 无 |

**明确不补强**：specs instruction 的调查纪律长文（05 核心可执行基线，修订须走 05 流程）；schema instruction 与模板注释的既有重复（原生模式，收益有限）。

## 4. 两个 TS 脚本契约与冲突裁决

### 裁决 D1：resolver 语言 Python → TypeScript

05 §5.2/§18 写 `resolve-openspec-change.py`。按 CLAUDE.md 约定 4 落地为 TS（零依赖、可擦除类型）。05 §5.2 标题与 §18 清单随 §5 回填修订。

### 裁决 D2：tasks.md 串行锁形态

05 §11.3 禁"需人工清理的长期 lock marker"。落地形态：**同目录临时锁文件 `tasks.md.patch-lock`**——`fs.openSync(wx)` 原子抢占 + 写入 owner（pid/时间戳）+ 有界重试（间隔 ~200ms，上限 30s，超时返回 BUSY）+ 进程退出清理 + stale 探测（pid 不可活**或**锁龄 >120s → 判 stale，可接管并记录）。进程崩溃残留可自恢复，不依赖人工清理，符合 05 §11.3 精神；措辞修订随 §5 回填（禁令限定为"正常路径不得依赖人工清理的长期锁"）。

finalize 的根仓 `mkdir .multica/locks/root-finalize.lock`（UNKNOWN 不偷锁，路径为 10-22 对齐后契约）是**长临界区、跨步骤、需人工核对**的另一场景，维持不变；05 §11.3 与 ops guide §3.5 的表述收敛写进 05 回填。

### 裁决 D3：脚本位置（单仓适配，v2 新增）

05 §4/§18 的根仓 `scripts/` 调整为 **`projects/multica/scripts/`**，与 10-22 迁移后的流水线脚本同一资产层（`provision-workspace.ts` / `sync-workspace.ts` / `migrate-repo-keys.ts`）；05 §4/§18 随 §5 回填。`--openspec-root` 参数指向本仓根（默认为当前根仓解析结果），脚本本身不硬编码仓路径。

### 结果枚举 → 退出码映射（v1 评审缺口，本版补齐）

`resolve-change-identity.ts`（05 §5.2 五枚举）：

| result | 含义 | exit |
|---|---|---|
| `ACTIVE_FOUND` / `ARCHIVED_FOUND` / `NOT_FOUND` | 合法确定性答案 | 0 |
| `CONFLICT` | >1 合法候选，禁止取第一个 | 2 |
| `INVALID` | 候选损坏 / schema 与 `--expect-schema` 不符 | 2 |
| — | 参数用法错误 | 64 |
| — | 未预期 IO / 环境错误 | 3 |

`update-task-progress.ts`（05 §11.2 五枚举，**BUSY 必须实现**——有界等待后不得无限阻塞）：

| result | 含义 | exit |
|---|---|---|
| `UPDATED` | 本次勾选成功 | 0 |
| `ALREADY_COMPLETE` | 目标已勾，幂等跳过 | 0 |
| `BUSY` | 锁有界重试（30s）后仍不可获得 | 2 |
| `CONFLICT` | 结构异常（目标行变化/消失/编号重复等，05 §11.4），不假勾 | 2 |
| `INVALID` | 输入 / Change / tasks.md contract 非法 | 2 |
| — | 参数用法错误 | 64 |
| — | 未预期 IO / 环境错误 | 3 |

### `resolve-change-identity.ts`

```bash
node projects/multica/scripts/resolve-change-identity.ts --openspec-root <root> [--change-ref <ref>] [--tfs-id <id>] [--expect-schema <name>]
```

- 只读：不创建/不修改任何 Change 与 Multica 事实（05 §5.2/§5.6）；
- 主查找：persisted `change_ref` → 校验 id/path/schema → `ACTIVE_FOUND`；不可解析 → 恢复查找（active first，排除 `archive/`），按 `<semantic-slug>-<tfs-id>` 稳定 TFS ID 后缀匹配候选（05 §5.1）；
- archive fallback：`archive/<YYYY-MM-DD>-<id>` 日期前缀剥脱后按逻辑 ID 匹配（本仓 archive 实证命名，如 `2026-09-11-datasource-ip-fuzzy-query-245614`）；
- 恢复查找候选 `>1` = CONFLICT，禁止取第一个；候选损坏或 schema 不符 = INVALID，禁止自动创建掩盖异常；
- stdout：`{ "result": "ACTIVE_FOUND", "change_ref": "...", "path": "...", "archived": false, "schema": "..." }`。

### `update-task-progress.ts`

```bash
node projects/multica/scripts/update-task-progress.ts --openspec-root <root> --change-ref <ref> --check <1.1,1.2>
```

- 锁内重读最新 tasks.md（05 §11.3），只允许 `[ ] → [x]`；只勾指定且当前未勾的项；已勾 → `ALREADY_COMPLETE` 幂等跳过；
- 显式 `task_refs` 必须在当前有效任务中存在且唯一；脚本不把未批准新任务自动纳入完成范围（05 §11.2）；
- 原子写入：同文件系统临时文件 + flush + rename + 写后回读核对；
- 同任务/结构冲突（05 §11.4）：目标行在锁内重读时已变化/消失/编号重复 → `CONFLICT`，不假勾；
- stdout：`{ "result": "UPDATED", "checked": ["1.1"], "skipped_already": ["1.2"] }`；
- 不写 git、不 commit（根仓提交归 finalize，04 §11.2）。

## 5. 文档对齐（前置 P0：docs 入库裁定）

**P0（前置，属缺口 A3，不在本方案内裁定）**：`projects/multica/docs/` 当前被 `/docs/*` 忽略。裁定其版本控制归属（解除忽略入库或另定家）之前，本节 1–4 只做本地编辑，不提交。

1. **04/05 versioned 入库命名**：04 内容已吸收 §3.5 并 bump **v1.15.4**（domain-engineering-skills 方案已实施，2026-10-15），直接重命名为 `04-engineer-development-design-v1.15.4.md`；05 随本方案回填后重命名为 `05-openspec-schema-implementation-design-v1.5.3.md`；04/05 内部互链统一为 versioned 文件名；
2. **02 链接修复**：`04-…-v1.15.2` → v1.15.4（L42/L162/L1477 等多处）、`05-…-v1.5.1` → v1.5.3（L895/L958）；03 链接保持悬挂，待 03 成文；
3. **05 回填（八项）**：① §7.3 `apply.requires` 去 specs 偏差（§3 实测依据）；② §16 附注 F0 实测事实（archive `YYYY-MM-DD-<name>` 命名、`specsUpdated` 标志、`--json` 形状）+ **design 条件位实测**（schema 格式无 conditional 机制、`status` 3/4 噪音、archive 不查 design、Gate 不得依赖 "All planning artifacts complete"，§3.1）；③ §5.2/§18 resolver 语言与文件名修订（D1）；④ §11.3 锁措辞收敛（D2）；⑤ §4/§18 脚本位置修订（D3）+ §18 `tests/` 暂缓标注（见 §7）；⑥ §0 P1-2 标记为 Resolved by finalize-facts 契约（指针到 `workspace-skills/finalize-delivery/references/finalize-facts-contract.md`）；⑦ §7.3/§8.5/§10.1 记录 S1–S3 补强（apply instruction 指向进度脚本、tasks 派工约束、corrective checkbox 解析规则对齐）；⑧ §6.3/§7.3 instruction 文本与补强后资产的一致性核对（偏差以回填为准）；
4. **ops guide 缺口⑦ 更新**：04/05 移出缺口⑦，schema 落地状态刷新为 v2 口径；剩余 = 03/06 新建 + CANCEL_DELIVERY 归属。

## 6. 验收（O 系列，单仓版）

测试纪律：全部在本仓用一次性测试 Change（`schema-test-<tfs-id>`）验证，验收后移除；不动真实 `specs/`；archive 类用例验收后还原 `archive/` 并记录清理方式。

| # | 用例 | 预期 | 状态 |
|---|---|---|---|
| O1 | `openspec schema validate` 两 Schema + `schema which` 项目级解析 | 双 PASS；which 显示项目级路径（非用户级） | **PASS（2026-10-23 复核）** |
| O2 | `openspec new change schema-test-<id> --schema intentional-change`（v1 的 `openspec change create` 不存在，命令已更正） | 生成 `.openspec.yaml` 指定 schema；按模板生成 proposal/spec/design/tasks 后 `openspec validate <change>` PASS | **PASS（2026-10-23）**：`openspec new change schema-test-900001 --schema intentional-change` + 四件套 validate PASS，测试 Change 已清理 |
| O3 | corrective 同 O2，含 `skip_specs:true` 无 delta 用例 | validate PASS；archive 不产生 specs 变化（与 F0 `specsUpdated:false` 互证） | **PASS（2026-10-23）**：skip_specs validate/status PASS；archive 后 `openspec/specs` 零变化、落盘 `archive/2026-10-23-schema-test-900002`（日期前缀实证）；archive 已还原 |
| O4 | resolver 五结果 | persisted ref→ACTIVE_FOUND；仅 archive 存在→ARCHIVED_FOUND（日期前缀剥脱）；无→NOT_FOUND；双候选→CONFLICT（不取第一个）；schema 不符→INVALID；退出码符合 §4 映射 | **PASS（2026-10-23）**：五枚举全过；退出码 0/0/0/2/2 与用法 64 实测符合映射 |
| O5 | update-task-progress 幂等 | 勾 2 项→UPDATED/checked；重跑→ALREADY_COMPLETE/skipped_already；tasks.md 其余行零变化 | **PASS（2026-10-23）**：UPDATED→ALREADY_COMPLETE 幂等，exit 0，其余行零变化 |
| O6 | patch 锁并发 + stale | 两进程同时 patch 同 change：串行成功无 lost update；持锁占用时第二调用 30s 后 BUSY（exit 2）；kill 持锁进程 → stale 探测接管并记录 | **PASS（2026-10-23）**：并发串行无 lost update；BUSY 有界 30s exit 2；dead-pid stale 接管并记录。**实测记录（开放问题 2）**：Windows 下 MSYS `$!` pid ≠ Windows pid，`process.kill(pid,0)` 须以 Node 进程自身 pid 为准；锁龄 >120s 兜底有效 |
| O7 | 负向（05 §19 子集） | 篡改任务行后 patch → CONFLICT 不假勾；templates 缺章 → schema validate FAIL | **PASS（2026-10-23）**：编号重复 / 目标行消失 / `[~]` 标记均 CONFLICT（exit 2）不假勾；缺 template 文件 schema validate FAIL |
| O8 | 文档对齐核验 | 02 中 04/05 链接可解析；05 回填节与实测一致；git 历史含 04/05 versioned 入库（依赖 P0） | **PASS（2026-10-23，git 半段待 P0）**：01/02/04/05 链接全部可解析（01 同类陈旧链接一并修复）；05 八项回填与实测一致；versioned 入库待 P0 裁定 |
| O9 | schema 补强回归（§3.2 S1–S3） | 补强后 `schema validate` 双 PASS；`openspec instructions apply --json` 输出含 update-task-progress.ts 指引（S1）；两个 tasks 模板/instruction 含编号稳定与取消不假勾约束（S2）；corrective tasks instruction 含 checkbox 解析规则（S3）；补强前后模板生成的测试 Change `validate` 均 PASS | **PASS（2026-10-23）**：四项全部实测成立 |

## 7. 明确不做

- 03（Analysis 设计）/ 06（Method-Skill 库）新建；CANCEL_DELIVERY 定义；
- resolver 与 finalize `resolveChangeDir` 的合并重构（finalize 内联子集维持现状；10-22 对齐刚改过 RuntimePaths，更不宜现在动；后续若第三处需要再抽共用）；
- Schema Evolution 策略（05 P2-1 Open 维持）；
- `tests/` 目录的测试框架建设（验收以 O 系列手动执行记录替代，与既有 F/S 系列同纪律；05 §18 回填标注暂缓）；
- 用户级 OpenSpec 配置的清理或治理；
- docs 入库裁定本身（前置 P0，属缺口 A3）；
- 下游 Skill 同步的实施（见 §9，本方案只交付脚本与契约）。

## 8. 开放问题

1. ~~`openspec change create` 对项目 schema 的支持形状~~ → **已关闭（2026-10-23 实测）**：1.13.2 无 `openspec change create`，创建入口为 `openspec new change <name> --schema <name>`，`--schema` 支持项目级 schema；v1 降级预案移除。
2. **stale 锁的接管阈值**：pid 存活探测在 Windows 的可靠性（`process.kill(pid,0)` 语义、pid 复用风险）需 O6 实测；不可靠时以"锁龄 >120s"为准。
3. **schemas/scripts 是否进 finalize allowed paths**：本方案落地时根仓提交走**人工 commit**（非 finalize 自动路径）；是否纳入留待实际使用后再议。
4. **docs 入库裁定（P0）**：`projects/multica/docs/` 的版本控制归属，属缺口 A3，未裁定前 §5 不提交。

## 9. 下游跟进（本方案验收后，独立方案）

05 §18 第二段：schemas/scripts + 验收完成后，同步修改 Workitem Analyst / Engineer / Delivery Lead / Verify Agent 相关 Skill 与 02：

- Analyst / delivery-flow：`change_ref` 解析改调 `resolve-change-identity.ts`（替换各自内联查找逻辑）；
- development-execution：任务进度更新改调 `update-task-progress.ts`（Completion Check PASS 后）；
- Verify Agent 路线（缺口④）复用同一进度脚本；
- 02 对应段落指针更新。

此项与缺口④（Verify Agent + acceptance-verification）有依赖关系，建议合并立项。
