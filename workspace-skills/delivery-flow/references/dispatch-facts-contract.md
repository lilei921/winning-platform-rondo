# delivery-flow Facts 契约（metadata）

Delivery Issue 上与派发 / Human Decision 路由相关的两个 metadata key（均为 string 类型存储的 JSON）。
本文件是这两个 key 的唯一权威定义（One Rule, One Owner）；写入者只有 `rondo dev materialize`、`rondo delivery route-decision` 与 `rondo tfs writeback`（仅写 `dev.dispatch` 条目的 `tfs_task_ids` 字段）。
Reference-not-Replication：事实只存指针与状态标记，语义内容（任务描述、Human 决定原文）留在 Issue 评论 / OpenSpec Change，不双写。

## `dev.dispatch`（rondo dev materialize 写入）

JSON 数组，每次派发出一条：

```json
[
  {
    "dispatch_key": "FOMA-31#1.1,1.2#59a97d2d-8104-4687-b520-2a505fcb4c68",
    "task_refs": ["1.1", "1.2"],
    "engineer_id": "59a97d2d-8104-4687-b520-2a505fcb4c68",
    "engineer_name": "Backend Engineer",
    "projection": "parent",
    "sub_issue_ref": null,
    "change_ref": "tfs-256462-xxx",
    "approved_comment_ref": "01a13e3e-…",
    "dispatched_at": "2026-10-15T08:00:00.000Z",
    "active": true
  }
]
```

| 字段 | 说明 |
|---|---|
| `dispatch_key` | 幂等身份：`<issue KEY>#<task_refs 排序后逗号拼接>#<engineer_id>`。同 key 且 `active:true` 的派发已存在 → 重跑 NO-OP，不重复派发 |
| `task_refs` | 本次派发的 tasks.md 原生编号集合（排序存储） |
| `engineer_id` / `engineer_name` | 承接 Agent 的 UUID 与显示名（name 供 Lead 组 @mention，脚本不消费） |
| `projection` | `parent`（父 Issue @mention 派发，默认）/ `sub_issue`（独立 Development Sub-Issue） |
| `sub_issue_ref` | projection=sub_issue 时的 Sub-Issue KEY；parent 时为 null |
| `change_ref` / `approved_comment_ref` | 派发依据的指针（Change 与批准评论），只引用不复制内容 |
| `analysis_source` | 新派发必填，保存 `analysis.source` 的仓库、分支、commit、change_ref 快照；与 Human 批准及当前来源核对，不复制任务正文。来源契约见 `references/analysis-source-contract.md`；历史缺失条目不允许通过 NOOP/激活补猜版本 |
| `active` | `true` = 当前有效；被 Human Decision ENGINEERING 返工失效后置 `false` 并加 `invalidated_by`（触发评论 id），**历史保留不删除** |
| `rework_comment_ref` | 可选。仅返工再派发条目携带：记录本条目由哪条触发评论恢复（= 对应 `dev.decision` 的 `comment_id`）。首派条目无此键 |
| `tfs_task_ids` | 可选。`{ "<task_ref>": <TFS 任务 id> }`——本派发各 task_ref 在 tfs.id 需求下物化的 TFS 任务子项。**2026-10-30 TFS 剥离（tfs-writeback-decoupling-plan）后**：唯一写入者为 `rondo tfs writeback`，在 PR 全部 completed 后的收口统一回写中创建子任务并回填本字段；**开发期本字段恒缺省为正常态**（需求/Bug 同——开发期 commit `Refs:` 统一挂 `#<tfs.id>`，不依赖子任务存在）。tfs.type=Bug 恒缺省（Bug 交付不建 TFS 子任务，tfs-bug-delivery-task-skip-plan §4.1）。**legacy 在途交付**：派发期已由旧 `tfs materialize-tasks`（deprecated，仅作恢复入口）写入的映射保持有效，writeback 复用/认领不新建。ENGINEERING 失效时**不动**本字段（已建 TFS 任务保留），新 dispatch 覆盖同 task_ref 时复用既有 id 不新建（本条规则以此处正文为准；历史溯源：tfs-task-materialization-plan §3，原文档已归档） |

## `dev.decision`（rondo delivery route-decision 写入）

JSON 数组，每个已处理的 Human Decision 一条：

```json
[
  {
    "comment_id": "01a13e4f-…",
    "reason": "REJECTED",
    "next": "ENGINEERING",
    "affected_task_refs": ["1.1"],
    "routed_to": "rework_parent_mention",
    "applied_at": "2026-10-15T09:00:00.000Z"
  }
]
```

| 字段 | 说明 |
|---|---|
| `comment_id` | 触发评论 id，**即幂等身份**：已有 `completed_at` 或已被后续重叠 Decision 取代 → NOOP；未完成时按原派发身份恢复，不能只凭存在就跳过 |
| `next` | `ANALYSIS` / `ENGINEERING` / `RECREATE_PR` / `CANCEL_DELIVERY`（Lead 从 Human 评论解析出的结构化结果，脚本不解析自然语言） |
| `reason` | `REJECTED` / `DISCARDED`，可空 |
| `affected_task_refs` | ENGINEERING 路由的受影响 Task Set；其他路由为 null |
| `routed_to` | 实际执行的路由指令（见 SKILL.md 路由表） |
| `target_dispatch` | ENGINEERING 首次落账时记录的原派发快照；恢复时须核对 dispatch_key、Change、派发时间、Engineer、批准来源及 Sub-Issue。该快照不构成新派发 |
| `completed_at` | 所有脚本侧后置动作完成后写入的 ISO8601 标记；同评论再次到达不重开已经完成的返工 |

例外：`CANCEL_DELIVERY` **不写任何事实**（02 §11.2：取消的专项契约未定义，脚本零写入，只输出 `hold_for_human` 指令）。

## 失效语义

ENGINEERING 返工 = 把命中的 `dev.dispatch` 条目置 `active:false` + `invalidated_by:<comment_id>`，**并追加一条同 `dispatch_key` 的新 `active:true` 条目**（携 `rework_comment_ref:<comment_id>`，其余字段整体继承失效条目）——失效与恢复一笔写完，不存在"零 active 派发"窗口期。语义上是"恢复同一派发"而非重复派发：同 key 已有 active 条目时 `rondo dev materialize` 重跑仍 NO-OP。
Decision 先持久化原派发快照，再一笔更新失效与再派发事实。若在这两步之间中断，凭快照定位唯一原派发再补写；旧格式无快照仅在 blocked 且派发时间不晚于 Decision、目标唯一时恢复。存在多个候选、目标被替换或无法确认已完成轮次时 UNKNOWN，不猜测、不重开已完成任务。
首跑和恢复均核对原派发、`target_dispatch` 快照及已恢复派发的 `analysis_source` 与当前 `analysis.source` 一致；来源已变化或缺失时 UNKNOWN，不能恢复旧版本。仅当前来源、批准记录与派发历史均无来源字段时保留旧数据返工规则，不据此补猜版本。
同 `comment_id` 未完成且未被后续决定取代时，重跑 route-decision 按 `dev.decision.routed_to` 做后置条件核对：路由动作全部落地 → NOOP；有缺口（dispatch 未恢复 / 评论未补发 / 状态未流转等）→ 只补缺口（`mode=repair`），不产生重复 active 条目。
Engineer 的历史 Evidence 文件本体保留在 Change 目录不动；"失效"只标记派发/完成结论不再有效，不删除任何历史。
