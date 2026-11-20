# delivery-flow 方案（缺口⑤：派发物化 + Human Decision 路由）

> 当前契约提示（2026-10-22）：本文旧 `repos/`、`df-*` 示例与实测输出均为历史记录；当前仓库身份与路径以根仓 `docs/config/repo-context.yaml` 及 `multica-delivery-operations-guide.md` §3.5 为准。

> 状态：**已实施并验收（2026-10-15）**。平台注册：Skill `delivery-flow` `8f2861fd-74c0-412b-9e07-994006701d29`，已绑定 Delivery Lead（`0304a20b-…`）。实测记录见 §6。
> 上游权威：02 §6.3–§6.4（Human Comment 理解边界）/ §7（Development 物化）/ §11.2（PR Abandoned 后 Human Decision 路由）；01（机制层）。
> 关联：`docs/pr-status-sync-plan.md`（缺口⑥，abandoned 确定性停止的产出是本方案的输入）；`workspace-skills/pull-request/references/pr-facts-contract.md`（既有事实契约范式）。

## 0. 定位与范围切分

ops guide 缺口⑤ 原文：`delivery-flow` 其余脚本（materialize-development / route-verify-result / route-human-decision / task-close）+ `delivery-gate` 其余门禁脚本。逐项核对 02 后的范围裁定：

| 项 | 02 依据 | 裁定 |
|---|---|---|
| `materialize-development.ts` | §7（含 §7.3 恢复表、§7.4 Owner、§7.5 Stage） | **本方案实施** |
| `route-human-decision.ts` | §11.2（NEXT 契约 + 路由表 + UNKNOWN 条件 + 验收清单） | **本方案实施** |
| `route-verify-result.ts` | §9.5/§9.6——输入是 Verification Report（`verify_agent.required=true` 才存在） | **并入缺口④**（Verify Agent）一起做，输入契约同源 |
| `validate-verification.ts`（delivery-gate） | §9.5 Verification Gate | **并入缺口④**，同上 |
| `evaluate-pr-transition.ts` / `evaluate-completion.ts` | §12.1 / §12.3 明文"属于 finalize-delivery 内部确定性检查" | **不另建**——已由 finalize-delivery.ts 承载（F 系列已验） |
| `check-development-completion.ts` | 资产树归 delivery-gate | **维持现状**——已在 development-execution（Engineer 按 Task Set 调用，与 evidence 契约同 Skill 内聚）；资产树差异记录为已接受偏差 |
| `task-close` | 02 全文仅资产树出现两次（§13 表、附录 A），**无语义定义** | **退回文档缺口**（与 CANCEL_DELIVERY 同属"02 待补定义"），不凭空实现 |

当前手工缺口：Lead 派发时无确定性输入校验（task_refs 是否属于当前 Change、Owner 是否合法靠语义判断）；PR abandoned 停止后（pr-status-sync 已落地 blocked + Squad），Human 给出 NEXT 后的路由全靠 Lead 手工执行，无幂等保护（重复处理同一 Decision 可能二次派发——02 §11.2 明文禁止）。

## 1. 设计约束（红线）

1. **语义/确定性分界**（02 §6.3–§6.4、§11.2）：Lead 负责理解 Human 自然语言评论并得出结构化 `NEXT`；脚本只消费结构化输入做硬条件校验、确定性状态写入与路由指令输出，**不解析自然语言**。
2. **单次触发**（02 §11.2）：同一 Human Decision 重复处理不得产生第二次执行；以触发评论 ID 为稳定事件身份，已处理 → NO-OP。
3. **确定性脚本一律 TS 单文件零构建零 npm 依赖**；退出码 0 成功 / 2 单项失败 / 3 UNKNOWN / 64 用法；stdout 只出 JSON，日志走 stderr。
4. **`--no-start` 纪律**：脚本的一切写入（create/assign/status）默认 `--no-start`；唯一例外是 Sub-Issue 依赖已满足时的**激活**（backlog→todo，这本来就是启动信号，02 §7.2）。
5. **不发明派发策略**：脚本只校验并落实 Lead 已确定的 Owner / task_refs / Projection，不自行选择成员、不重组 Task Set、不推断是否需要 Sub-Issue（02 §7 末段）。

## 2. 资产布局

```text
workspace-skills/delivery-flow/              # 新 Skill，绑定 Delivery Lead
  SKILL.md                                   # 薄契约 + 固定路由表（脚本输出 → Lead 动作）
  config/repo-registry.json                  # 第四份副本（openspec_root / repos_root；同步纪律同既有三份）
  scripts/
    materialize-development.ts               # 派发输入校验 + Sub-Issue 物化 + 派发事实持久化
    route-human-decision.ts                  # PR abandoned 后 Human NEXT 的确定性路由
  references/
    dispatch-facts-contract.md               # dev.dispatch / dev.decision 事实契约（唯一权威）

agents/delivery-lead/README.md               # 登记 delivery-flow 注册记录
```

## 3. 事实契约（references/dispatch-facts-contract.md）

Issue metadata 新增两个 key（JSON，Reference-not-Replication，内容与 Issue/评论只互相引用不双写）：

| key | 写入者 | 内容 |
|---|---|---|
| `dev.dispatch` | materialize-development | 数组，每项 `{task_refs, engineer_id, projection: parent\|sub_issue, sub_issue_ref?, dispatched_at, dispatch_key, active: true}`；`dispatch_key = <issue>#<task_refs 排序拼接>#<engineer_id>` |
| `dev.decision` | route-human-decision | 数组，每项 `{comment_id, reason, next, routed_to, applied_at}`；`comment_id` 即幂等身份 |

ENGINEERING 返工的"Completion Fact 失效"（02 §11.2）落地为：对应 `dev.dispatch` 条目 `active: false` + `invalidated_by: <comment_id>`，历史保留不删除。

## 4. 脚本契约

### 4.1 `materialize-development.ts`

```bash
node scripts/materialize-development.ts --config config/repo-registry.json \
  --issue <KEY> --change-ref <ref> --task-refs 1.1,1.2 \
  --engineer-id <agent-uuid> [--projection parent|sub-issue] \
  [--depends-on <sub-issue-key>] [--activate]
```

确定性校验（任一不过 → exit 2，逐项 reason）：

1. Issue 存在且可读取；`analysis.route` / 批准事实存在（Human Approval 是语义事实，脚本只查 Lead 传入的 `--approved-comment-ref` 已在 Issue 评论中存在）；
2. `openspec/changes/<change_ref>/tasks.md` 存在，且每个 `task_ref` 编号在文中可定位（Native First：只查原生编号行，不解析语义）；
3. `--engineer-id` 是已注册 Agent（`agent get` 回读）；
4. 幂等：同 `dispatch_key` 且 `active:true` 的派发已存在 → NO-OP（输出既有事实），不重复派发。

落实动作：

- **projection=parent**（默认）：写 `dev.dispatch`；输出 mention payload（change_ref / task_refs / 根仓绝对路径 / 领域提示），**评论由 Lead 发**（语义内容归 Lead，02 §6.3）；
- **projection=sub-issue**：创建 Sub-Issue（parent、完整输入写 description、assignee=engineer、status backlog `--no-start`）→ 回读核对 → 写 `dev.dispatch`（含 `sub_issue_ref`）；`--depends-on` 存在且该 Sub-Issue 未 done → 保持 backlog（不激活）；无依赖或加 `--activate`（依赖已满足由 Lead 判断后重跑）→ `backlog → todo`（唯一不带 `--no-start` 的写入，即启动信号）。

UNKNOWN（exit 3）：CLI/平台故障、回读不一致、Sub-Issue 创建结果未知（先查 Issue 列表核实，不盲目重建，02 §7.3）。

### 4.2 `route-human-decision.ts`

```bash
node scripts/route-human-decision.ts --config config/repo-registry.json \
  --issue <KEY> --comment-id <触发评论 id> \
  --next ANALYSIS|ENGINEERING|RECREATE_PR|CANCEL_DELIVERY \
  [--reason REJECTED|DISCARDED] [--affected-task-refs 1.1,1.2]
```

前置校验：Issue 当前 `blocked` 且 metadata 有 `pr.abandoned`（本脚本 v1 只服务 02 §11.2 场景；其他 Human Decision 场景 02 未定义路由，不泛化）；同 `comment_id` 已在 `dev.decision` → NO-OP（02 §11.2 幂等）。

路由表（先写 `dev.decision`，后执行状态动作——persist-before-act）：

| NEXT | 确定性动作 | 输出指令 |
|---|---|---|
| `ANALYSIS` | Issue → `in_progress`（--no-start） | `mention_analyst`（Lead 在 Issue 发 @Workitem Analyst 评论） |
| `ENGINEERING` | 校验 `--affected-task-refs` 恰好命中一条 `active` dispatch（不唯一/不存在 → UNKNOWN）；该 dispatch `active:false` + `invalidated_by`；parent 投影 → Issue → `in_progress`；sub_issue 投影 → 原 Sub-Issue `done→in_progress` 重开 + 在 Sub-Issue 发结构化返工评论（固定模板：comment_ref / affected task_refs / 契约引用） | `rework_parent_mention` 或 `rework_sub_issue_activated` |
| `RECREATE_PR` | 逐仓核对登记分支 HEAD == `current_pr` 记录的 candidate_commit（git ls-remote，确定性）；全部未变 → 输出 `rematerialize_pr`（Lead 调 pull-request Skill 重新物化）；任一已变 → 不自行处理，输出 `needs_engineering`（语义修改属 Engineer，02 §11.2 RECREATE_PR 边界） | `rematerialize_pr` / `needs_engineering` |
| `CANCEL_DELIVERY` | 无任何状态写入（02：专项契约未定义） | `hold_for_human`（Lead 保持安全停止，交 Human） |

UNKNOWN（exit 3）：NEXT 必需信息缺失、affected Task Set 不唯一、原 Projection/Owner 无法确认、事实冲突（02 §11.2 的 UNKNOWN 清单逐条映射）——保持当前状态，输出已查明事实。

### 4.3 SKILL.md 固定路由表（Lead 侧）

| 脚本输出 | Lead 动作 |
|---|---|
| `dispatch_payload`（parent） | 以 payload 为事实底稿发 @Engineer 评论（可补语义上下文） |
| `sub_issue_created` / `sub_issue_activated` | 无追加动作；结果回流父 Issue |
| `mention_analyst` | 发 @Workitem Analyst 评论（含 Human 决定摘要与修正方向——语义归 Lead） |
| `rework_parent_mention` | 单次 @原 Engineer 返工评论（不重复派发） |
| `rework_sub_issue_activated` | 无追加动作（Sub-Issue 重开即触发） |
| `rematerialize_pr` | 调 pull-request Skill 重新物化 |
| `needs_engineering` / `hold_for_human` / UNKNOWN | 如实回流，不自行补救 |

## 5. 平台注册

1. `multica skill create` delivery-flow + `skill files upsert`（scripts×2 / config / references）；
2. 绑定到 Delivery Lead（`0304a20b-…`）；
3. `agents/delivery-lead/README.md` 登记。

## 6. 验收（DF 系列）

测试纪律：只用指定测试工作项（新测试 Issue + TFS 256462 既有测试对象）；Sub-Issue / 状态变更验收后清理恢复；`pr.abandoned` 事实可构造（手写 metadata）后擦除。

| # | 用例 | 预期 | 实测（2026-10-15，测试 Issue FOMA-31 + Sub-Issue FOMA-32，验收后均已取消） |
|---|---|---|---|
| DF-1 | parent 派发校验通过 | 写 `dev.dispatch`，输出 payload；`--approved-comment-ref` 不存在 → FAIL | ✅ PASS（payload 含 mention_target/change_ref/task_refs/根仓路径）；伪 comment-id → exit 2 逐项 reason |
| DF-2 | task_refs 校验 | 不存在的编号 / 不属于当前 Change → exit 2 逐项 reason | ✅ `9.9` 不可定位 → exit 2；metadata `analysis.change_ref` 与 `--change-ref` 不一致 → exit 2 |
| DF-3 | parent 派发幂等 | 同 dispatch_key 重跑 → NO-OP，dispatch 数组不增 | ✅ NOOP rc=0，dev.dispatch 保持 1 条 |
| DF-4 | Sub-Issue 物化 | 创建 backlog Sub-Issue（不启动），回读一致，dispatch 含 sub_issue_ref | ✅ FOMA-32 创建（backlog / parent / assignee 回读一致），`awaiting_dependency=FOMA-30`；Backend runs 数不变（18），零触发 |
| DF-5 | 依赖门控与激活 | `--depends-on` 未完成 → 保持 backlog；依赖完成后 `--activate` 重跑 → todo，Specialist Run 真实触发（轮询证实），无重复 Run | ✅ `--activate` 重跑 → FOMA-32 backlog→todo，Backend 新 Run `01a13e76`（18→19，单次），Run 完成后 Engineer 自转 in_review |
| DF-6 | ANALYSIS 路由 | 构造 blocked + pr.abandoned → `in_progress` + `mention_analyst`；同 comment-id 重跑 → NO-OP | ✅ PASS + `dev.decision` 落账；重跑 NOOP（带出 prior 路由信息） |
| DF-7 | ENGINEERING 路由（parent） | dispatch 失效（active:false）+ Issue in_progress + 单次返工指令；重复执行不二次派发 | ✅ `FOMA-31#1.1,1.2#…` active=false + invalidated_by 落账，历史保留；`rework_parent_mention` + rework_target 输出；重跑 NOOP |
| DF-8 | ENGINEERING 路由（Sub-Issue） | 原 Sub-Issue 重开（done→in_progress）触发新 Run；父 Issue 不误触发同 task_refs | ✅ FOMA-32 done→in_progress，结构化返工评论落 Sub-Issue（`01a13e7a-0724`），新 Backend Run `01a13e7a-0732`（19→20，单次）；父 Issue 保持 blocked 未被路由 |
| DF-9 | RECREATE_PR | 分支 HEAD 未变 → `rematerialize_pr`；人为推进分支 → `needs_engineering` | ✅ 未变：`rematerialize_pr` + abandoned 条目从 current_pr 移除；commit-tree 推进 HEAD 后：`needs_engineering` 含逐仓 changed 明细。测试分支 feat/df09-256462 验收后已删 |
| DF-10 | CANCEL_DELIVERY / UNKNOWN | CANCEL → 零写入 + `hold_for_human`；affected 不唯一、缺 comment-id、Issue 非 blocked 等 → exit 3 零写入 | ✅ CANCEL：`dev.decision` 5→5 不变、status 不变；伪 comment-id / affected 命中 2 条 active dispatch / 非 blocked → 均 exit 3 零写入（decisions 保持 5） |

实施偏差记录：

1. **projection 存储值规范化**：首版把 CLI 参数值 `sub-issue` 原样存入 `dev.dispatch`，与契约值 `sub_issue` 不一致（DF-4 实测暴露）——已修为参数→契约值映射后存储，并修正 FOMA-31 上的污染条目；
2. **NOOP 检查顺序**：首版 blocked 前置先于幂等检查，导致"同 comment-id 重跑"在状态已流转后报 UNKNOWN 而非 NOOP（DF-6 实测暴露）——已调整为：评论存在性 → 幂等 NOOP（带出 prior）→ blocked/pr.abandoned 场景前置；UNKNOWN 零写入性质不变；
3. **`issue create` 无 `--no-start`**：Sub-Issue 创建采用"不带 assignee 创建 + `issue assign --no-start`"两段式，避免 create 时指派触发 Run（DF-4 实测零触发证实）；
4. **DF-10"缺 comment-id"口径**：必填 flag 缺失属用法错误 exit 64（基线语义）；DF-10 按"comment-id 不可确认（不在评论列表）→ exit 3"验收，与 UNKNOWN 清单语义一致。

## 7. 明确不做

- `route-verify-result.ts` / `validate-verification.ts`（并入缺口④，输入契约同源）；
- `evaluate-pr-transition.ts` / `evaluate-completion.ts`（finalize-delivery 内部已承载）；
- `task-close`（02 无定义，退回文档缺口）；
- Sub-Issue 依赖的**自动 watcher**（依赖完成自动激活）——Lead 在聚合时重跑 `--activate`；实测证明高频再议；
- 自然语言评论解析（Lead 语义职责，02 §6.3）。

后续补做（2026-10-19）：TFS Task 创建已由 `docs/tfs-task-materialization-plan.md` 落地并验收（TF-1～TF-9），包括 `materialize-tfs-tasks.ts`、tfs-cli `workitem create`、孤儿认领与返工复用；不再属于本清单。

## 8. 开放问题

1. **ENGINEERING 返工的旧 Evidence 处理**：02 §11.2 要求"保留历史 Evidence"——`dev.dispatch` 失效标记已保留历史；Evidence 文件本体保留在 Change 目录，本方案不动；
2. **`--approved-comment-ref` 的语义强度**：脚本只验证评论存在，批准语义由 Lead 担保（02 §6.4：工具只保障明确后的检查）——若实测发现 Lead 传错引用，再考虑加关键词提示（仍不解析语义）；
3. **dispatch 事实与父 Issue 聚合的关系**：finalize-delivery 目前不消费 `dev.dispatch`；是否把"所有 active dispatch 均已 READY"纳入收口前置，留待 L5 端到端验证时评估。
