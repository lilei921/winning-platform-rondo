> 本包镜像；权威来源：finalize-delivery/references/finalize-facts-contract.md。修改权威后同步本文件。

# finalize-delivery Facts 契约（metadata）

Delivery Issue 上与收口相关的 metadata key（均为 string 类型存储；JSON 值见各表）。**本文件为 finalize metadata 投影契约的唯一权威**；语义背景：02 §11.3 / §11.4 / §12（根级现行版 `projects/multica/02-multica-delivery-lifecycle-design.md`）。

## 消费的既有事实

| key | 来源 | finalize 用途 |
|---|---|---|
| `tfs.id` / `tfs.type` | tfs-sync | TFS 回写身份；缺失 → UNKNOWN |
| `analysis.change_kind` | analysis-completion | Multica Issue 持久化分类：`corrective` / `intentional`；正常 Finalize 须与当前 Change Schema 一致；`done` 的幂等回放只核对服务器端有效值及必要交付事实，不重新依赖可能已卸载的根仓 |
| `analysis.change_ref` | analysis-completion | 定位唯一 OpenSpec Change；读取其 `.openspec.yaml` 的 Schema（含归档恢复路径），当前只允许 `corrective-change` / `intentional-change` |
| `analysis.gate.result` | analysis-completion | 须 = `PASS`；Intentional 还须具有 `analysis.ai_review.verdict=APPROVED` 与非空 `analysis.ai_review.findings_ref` |
| `analysis.verify_agent.recommendation` | analysis-completion | Analyst 初始专业建议，仅供 Human 审核；Finalize 不按此字段决定是否必须独立验收 |
| `verify_agent.required` | `rondo dev materialize` | Human 已批准的最终执行事实（Metadata string `"true"` / `"false"`），必须与 `analysis.human_approval.verify_agent_required` 一致；缺失、冲突或非法 → UNKNOWN；true 且独立验收未实现/无当前有效 PASS → UNKNOWN，不放行 |
| `current_pr` | pull-request / `rondo pr materialize` | required PR 集合；逐条回核终态与身份；`repo_key` 值须为 repo-context 的 `repo_id` |
| `dev.dispatch` | delivery-flow（`rondo dev materialize`） | writeback 任务面来源（2026-10-30 TFS 剥离）：独立 `rondo tfs writeback` 按 active 条目 task_refs 并集创建/复用/认领 TFS 子任务并回填 `tfs_task_ids`，置「已解决」落工时并回读核对，再把本次交付 commit 以 Artifact Link 挂到任务上；tfs.type=Bug → 无任务面，仅父项回写。缺失或无 active 条目（需求）→ FAIL（前置，零创建）；legacy 在途交付已有 `tfs_task_ids` 映射 → 复用不新建 |

## 本方案写入的事实

### `analysis.human_approval`（Delivery Lead 派发研发时写入）

```json
{"decision":"approved","by":"<人工>","at":"<ISO8601>","comment_ref":"<批准评论ID>","verify_agent_required":false,"source":{"repo_url":"<规范仓URL>","branch":"<推送分支>","commit":"<完整SHA>","change_ref":"<Change ID>"}}
```

Delivery Lead 基于真实 Human 评论，将同意 Analyst 推荐或明确 Override 后的最终 Independent Verification Decision 写为 `verify_agent_required`（JSON boolean）；`comment_ref`、`by`（批准人）、`at`（ISO8601 时间）均必填，须与派发命令的 `--approved-comment-ref` 一致。CLI 核对可确认的字段形状与评论存在性；评论的语义和作者授权由 Delivery Lead 在现有 Human Review 机制中确认，不从关键词或脚本推断。无明确最终决定时先澄清，不推断 false。派发前 `rondo dev materialize` 验证批准评论存在、Human 决定及引用一致，再投影 `verify_agent.required` 并回读，之后才写入 `dev.dispatch` / 创建 Sub-Issue。已投影结果冲突时安全停止；已经有 active `dev.dispatch` 且新 Human 评论仅调整独立执行者要求时，允许按新评论重新调用相同 `rondo dev materialize`，只修改最终 `verify_agent.required`，原派发评论、任务和 Sub-Issue 保持不变。原有批准评论不能自行被改写为相反 boolean，必须有新评论作为授权依据。
当前 `analysis.source`、批准的 `source` 或任一派发历史出现来源字段时，必须有有效的当前来源、匹配的批准来源和 active 派发来源（仓库、commit、change_ref）；失效派发可保留旧来源。仅三处均无来源字段的历史交付可继续既有收口，不从当前 HEAD 补猜版本，也不能将新记录缺失或损坏的来源按旧数据放行。新派发始终必须提供来源。

Finalize 只消费上述最终执行事实和对应批准来源；当前 Verify Agent / Independent Verification Gate 尚未实现，`true` 一律安全停止，不将 Analyst 原始 Recommendation 或任意测试结果冒充独立验收。

### `finalize.pending`（`rondo delivery finalize --phase prepare` 在收口副作用开始前写入）

```json
{"event_keys":["<issue>#<repo_key>#<pr_id>#completed","..."],"recorded_at":"<ISO8601>","prepared_change_ref":"<change_ref>"}
```

- 02 §11.4 pending_event 的平铺投影；`repo_key` 段使用 repo-context 的 `repo_id`；**存在即表示尚需对账**，即使 Issue 已离开 `in_review`；
- §12.4 后置条件全部确认后由脚本删除；
- 已存在 → 恢复模式：按当前事实只补缺失步骤，不重放已完成副作用。Issue 已 `done` 时，必须先确认服务端的 `analysis.change_kind`、合法 `analysis.change_ref` 和 `analysis.gate.result=PASS`，再清理残留 pending；无效时不清理，拒绝返回假 PASS。

### `delivery.summary_comment_id`（`rondo delivery finalize` 写回）

Final Summary 评论 ID。重试时凭它跳过重复评论（02 §12.4.3：不重复追加相同评论）。存在即跳过 Summary 步骤。

### `delivery.tfs_written`（独立 `rondo tfs writeback` 完成父项回写时置位）

TFS 父项回写（状态链 + 收口评论）完成标记，值 `true`；2026-10-30 TFS 剥离后语义扩展为完整 writeback 的父项段完成标记（子任务段另有 `dev.dispatch[].tfs_task_ids` 与回读核对为凭）。父项段已整体完成（含评论）才置位；部分成功（状态已写、评论未写）时不置位，重试补评论。

## 收口顺序与中断恢复

1. 核对当前 Change Schema、Human 最终 Verify Decision、PR 终态与当前候选的 Evidence / contract_files 覆盖。
2. 持久化 pending；先保存当前 Change 的合法修改，再执行 OpenSpec archive、提交并推送归档结果。
3. 已移动到唯一归档目录但尚未 commit/push 时，只允许本次 Change 的源目录、精确归档目录与本次关联 Spec 路径；其他归档或无关 WIP 必须 UNKNOWN，不夹带提交。
4. PR Status Sync Agent 同 Run：`delivery finalize --phase prepare` → 独立 `rondo tfs writeback` → `delivery finalize --phase complete`。TFS writeback 全部 PASS 且必要状态回读后才追加 Final Summary，再回读并置 done / 清理 pending；归档或回写失败时不得提前发布完成摘要。

Evidence 的字段与当前覆盖规则由 development-execution 的 development-evidence-contract.md 定义；历史 Evidence 不删除、不为通过 Gate 改写其哈希。
