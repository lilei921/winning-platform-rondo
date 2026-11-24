# finalize-delivery Facts 契约（metadata）

Delivery Issue 上与收口相关的 metadata key（均为 string 类型存储；JSON 值见各表）。**本文件为 finalize metadata 投影契约的唯一权威**；语义背景：02 §11.3 / §11.4 / §12（根级现行版 `02-multica-delivery-lifecycle-design.md`）。

## 消费的既有事实

| key | 来源 | finalize 用途 |
|---|---|---|
| `tfs.id` / `tfs.type` | tfs-sync | TFS 回写身份；缺失 → UNKNOWN |
| `analysis.change_ref` / `analysis.source` | analysis-completion | Requirement 定位唯一批准 Change 与根仓、分支、完整 Commit；从批准 Commit 读取 Repository Scope 和 tasks.md |
| `analysis.gate.result` | analysis-completion | Requirement 首次 Prepare 必须为 PASS；不重复上游质量核验 |
| `analysis.verify_agent.recommendation` | analysis-completion | Analyst 初始专业建议，仅供 Human 审核；Finalize 不按此字段决定是否必须独立验收 |
| `verify_agent.required` | `rondo dev materialize` | Human 已批准的最终执行事实（Metadata string `"true"` / `"false"`），必须与 `analysis.human_approval.verify_agent_required` 一致；缺失、冲突或非法 → UNKNOWN；true 且独立验收未实现/无当前有效 PASS → UNKNOWN，不放行 |
| `current_pr` | pull-request / `rondo pr materialize` | required PR 集合；逐条回核终态与身份；`repo_key` 值须为 repo-context 的 `repo_id` |
| `pr_prep` | 两种 `pr-prepare` | 已核验业务仓 `repo_url` 与实际 `target_branch`；结合 current_pr URL 和 TFS 实时事实验证 PR 身份与终态 |
| `bug.delivery` | Bug Fix Agent | Direct Bug 交付证据及真实合并源 Candidate 核验 |
| `delivery.tfs_task_plan` | `rondo tfs writeback` | Requirement 任务计划与实际 PR Commit 独占关联；重试复用 |

## 本方案写入的事实

### `analysis.human_approval`（Delivery Lead 派发研发时写入）

```json
{"decision":"approved","by":"<人工>","at":"<ISO8601>","comment_ref":"<批准评论ID>","verify_agent_required":false,"source":{"repo_url":"<规范仓URL>","branch":"<推送分支>","commit":"<完整SHA>","change_ref":"<Change ID>"}}
```

Delivery Lead 基于真实 Human 评论，将同意 Analyst 推荐或明确 Override 后的最终 Independent Verification Decision 写为 `verify_agent_required`（JSON boolean）；`comment_ref`、`by`（批准人）、`at`（ISO8601 时间）均必填，须与派发命令的 `--approved-comment-ref` 一致。CLI 核对可确认的字段形状与评论存在性；评论的语义和作者授权由 Delivery Lead 在现有 Human Review 机制中确认，不从关键词或脚本推断。无明确最终决定时先澄清，不推断 false。派发前 `rondo dev materialize` 验证批准评论存在、Human 决定及引用一致，再投影 `verify_agent.required` 并回读，之后才写入 `dev.dispatch` / 创建 Sub-Issue。已投影结果冲突时安全停止；已经有 active `dev.dispatch` 且新 Human 评论仅调整独立执行者要求时，允许按新评论重新调用相同 `rondo dev materialize`，只修改最终 `verify_agent.required`，原派发评论、任务和 Sub-Issue 保持不变。原有批准评论不能自行被改写为相反 boolean，必须有新评论作为授权依据。
Requirement Closeout 仅接受当前 `analysis.source` 及匹配的批准来源（仓库、Commit、Change）；不支持旧 `dev.dispatch` 收口。

Finalize 只消费上述最终执行事实和对应批准来源；当前 Verify Agent / Independent Verification Gate 尚未实现，`true` 一律安全停止，不将 Analyst 原始 Recommendation 或任意测试结果冒充独立验收。

### `finalize.pending`（`rondo delivery finalize --phase prepare` 在收口副作用开始前写入）

```json
{"event_keys":["<issue>#<repo_key>#<pr_id>#completed","..."],"recorded_at":"<ISO8601>","prepared_change_ref":"<change_ref>"}
```

- 02 §11.4 pending_event 的平铺投影；`repo_key` 段使用 repo-context 的 `repo_id`；**存在即表示尚需对账**，即使 Issue 已离开 `in_review`；
- §12.4 后置条件全部确认后由脚本删除；
- 已存在 → 恢复模式：按当前事实只补缺失步骤，不重放已完成副作用。Issue 已 `done` 时仅确认现有完成事实并清理残留 pending，不重新准备根仓。Direct Bug 继续使用已有 `prepared_kind` 与 `prepared_bug_digest`。

### `delivery.summary_comment_id`（`rondo delivery finalize` 写回）

Final Summary 评论 ID。重试时核对已发布摘要，避免重复评论。

### `delivery.tfs_written`（独立 `rondo tfs writeback` 完成父项回写时置位）

TFS 父项回写（状态链 + 收口评论）完成标记，值 `true`；完整 writeback 的父项段完成标记（Requirement 子任务与工时、Commit 关联以 `delivery.tfs_task_plan` 和 TFS 回读为凭）。父项段已整体完成（含评论）才置位；部分成功（状态已写、评论未写）时不置位，重试补评论。

## 收口顺序与中断恢复

1. Requirement 读取已批准来源及 Repository Scope，核对 Human 决策、必要 Hard Gate、PR 身份与终态及 tasks.md 完成状态；Direct Bug 核对现有交付事实和真实合并 Candidate。
2. Requirement 持久化 pending，复用 Multica Native Checkout，保存当前 Change 的合法修改、Archive、Push 到 analysis.source.branch 并回读确认。Direct Bug 不操作根仓。
3. 已移动到唯一归档目录但尚未 commit/push 时，只允许本次 Change 的源目录、精确归档目录与本次关联 Spec 路径；其他归档或无关 WIP 必须 UNKNOWN，不夹带提交。
4. PR Status Sync Agent 同 Run：`delivery finalize --phase prepare` → 独立 `rondo tfs writeback` → `delivery finalize --phase complete`。TFS writeback 全部 PASS 且必要状态回读后才追加 Final Summary，再回读并置 done / 清理 pending；归档或回写失败时不得提前发布完成摘要。

Closeout 使用当前 Multica Runtime，不读取 Repository Registry。上游 Engineering Completion 和 PR 准入规则不变。
