# LEI-68 豁免与 PR 登记流程根治方案

> 更新日期：2026-11-26
> 依据：LEI-68 与两次 PR Status Sync 回放、当前 Rondo CLI、01 设计原则及两版方案 Review。
> 事故已人工补登 current_pr（#4065 / #3978）并完成归档；不代表自动恢复已实现。
> 实施状态：P0-1 已合并（#79）；P0-2 已合并（#81）；P0-3 本分支实施。

## 一、根因

- Human 批准只登记 Independent Verification，未登记 Task Waiver；二态 checkbox 无法区分未执行且待完成、未执行但获准豁免。契约冻结也不允许附加注解。
- PR 创建与 current_pr 批量登记跨系统非原子；部分成功或登记失败造成事实丢失。Completed PR 不应依赖仍存在的源分支。
- reconcile-status 对登记缺失静默排除，无法识别和恢复已有 PR。

## 二、设计与实施范围

### P0-1 — Task Waiver（已合并）

- 在现有 analysis.human_approval 增加可选 waived_tasks: string[]，缺省为空；复用 by / at / comment_ref / source，不建立独立审批对象。
- Lead 从真实 Human 批准意见理解明确豁免，使用 analysis approve --waive-tasks 3.1,3.2 登记。CLI 校验编号属于固定 Analysis Commit 的 tasks.md；同一批准评论不能改变决定，已登记的同一决定幂等重试不重复读取远端 Tasks；更新决定使用明确的新批准评论及完整豁免集合，沿用现有批准状态边界。
- 豁免仅改变已列任务的本轮执行义务，不改变产品行为、Scope、必要验收要求，不自动取消 Independent Verification、Candidate Validation 或 Code Review。
- Engineer 未执行的豁免任务保持 [ ]；已执行完成才勾选。PR Materialize 与 Archive 使用同一个任务判定：所有任务均已完成或获准豁免。非豁免未完成任务必须阻断。
- OpenSpec 原生 archive --yes 继续使用，前提是项目 Guard 已确认不存在待处理任务；不伪造勾选，不绕过原生规格校验。安装版本须实测。
- TFS Task 规划依据实际业务改动和已批准的工程任务，保持现有职责，不增加豁免专项校验、输出字段或归档读取。现行 dev check-completion / contract-hash 旧体系不扩展。
- 无新 Agent、Skill、状态机、独立 Metadata 或任务工件。

### P0-2 — PR Materialize 事实管理（已合并）

- 复用 pr_prep、current_pr；逐仓持久化已核实的 PR 身份，全部交付仓准备和登记完整才进入 in_review。区分事实登记与状态转换。
- 已有 PR 按 ID 或限定仓库/源目标分支查询，Active 核实 Candidate，Completed 核实最终 Source Commit 与 Candidate、Work Item Link，不要求源分支存在。无已有 PR 才允许 Materialize 创建；歧义或不一致返回 UNKNOWN，禁止重复创建。
- 不新增 pr register、--accept-merged、PR Registry 或事务状态。PR 身份核实与 Human 合并/工程授权分离。
- 复用现有授权快照、写前检查和回读，发现并发漂移即停止；部分登记禁止提前收口，Status Sync 检查 current_pr / pr_prep 集合完整性。

### P0-3 — PR Status Sync 定向恢复（本次实施）

- 复用 P0-2 的 CLI 内部核实/登记方法，针对 in_review 或存在部分 current_pr / finalize.pending 的 blocked Issue 定向核实已有 PR；仅补登确认 Candidate 和既有 Work Item Link 的 Active / Completed PR；不创建缺失 PR，不修改 TFS 关联，不解除 blocked，不全量扫描研发中的 Issue。
- 缺失或部分登记显式返回异常原因，不能 PASS/included:0 静默忽略；复用 unknown Action，正常未纳入与 active noop 分开。
- 只有 in_review 且全部实际交付仓 PR 事实完整、状态均 completed 时写 finalize.pending；保留既有 Abandoned、Closeout Gate 与幂等机制，不重复工程质量校验。
- 对 in_progress 的定向恢复优先由 Engineer 重试 Materialize；常规 Sync 不扩展扫描范围。

## 三、回归验收

P0-1：合法豁免不勾选仍可 Materialize / Archive；未批准、无效编号或其他未完成任务阻断；相同批准重复登记幂等，不能同评论改写；无豁免行为不变；归档保持原始 checkbox，实际安装 OpenSpec 归档验证；保持 TFS 正常收口。附带修复现有 extractTaskText 的任务编号前缀匹配缺陷，仅调整分隔符匹配并补充回归。

P0-2：多仓部分成功保留登记；写入失败后恢复；Completed PR 删除源分支后可恢复；Candidate/Work Item/身份冲突不覆盖、不重复创建。

P0-3：缺失和部分登记可观测、可定向恢复；部分 PR completed 不触发 finalize；blocked 仅有 pr_prep 时跳过；已完成 Issue 幂等。

## 四、范围边界

Runtime Task 环境适配、CLI 输出参数统一、旧 Evidence Check 清理、Replay 凭据脱敏另行处理。本次仅实现 P0-3 定向恢复，不扩展 Status Sync 扫描范围，不重新操作已 done 的 LEI-68。

## 五、事实锚点

- LEI-68 Human 评论：01a216ad-e874-757f-b3b2-caca838cbb2c、01a216e2-c504-7844-9da1-faf3fa1ab852。
- PR #4065 / #3978；current_pr 人工补登后 Closeout 成功。
- 代码：analysis/approve.ts、delivery/verify-decision.ts、dev/change-completion.ts、delivery/requirement-mode.ts、delivery/finalize.ts、pr/materialize.ts、pr/reconcile-status.ts。
