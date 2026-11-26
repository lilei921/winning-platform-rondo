# Rondo 交付事实与 Metadata 最小充分优化方案

- 日期：2026-11-26
- 状态：设计待实施
- 范围：现行交付契约及其直接消费者
- 原则：First Principles、KISS、YAGNI、Native First、One Rule One Owner；遵循 01 统一设计规范。

## 1. 目标与边界

删除重复事实、退役机制及其派生校验，保留必要的授权、工程质量、版本绑定、外部身份和故障恢复。Agent 聚焦专业职责与语义决策，Skill 聚焦可复用方法，Rondo CLI 聚焦确定性执行和事实管理。

事实归属：OpenSpec 持有工程契约，Multica 持有交付与协作事实，TFS 持有外部 PR/Work Item 事实。不同生命周期的独立事实不因字段相似而合并；同一事实不重复保存。优先复用原生 Assignment、Run、Comment 和 Git 固定对象。

## 2. P0-1：退役旧 Task Set 派发机制

### 2.1 删除范围

现行 Requirement 使用 Change 级 Engineer 及 Multica 原生指派/Run，不需要自建 Task Set 派发。实际代码仍注册旧命令（rondo/src/index.ts），并存在对应消费者：

- dev materialize：dev/materialize.ts。
- dev check-dispatch：dev/check-dispatch.ts、dev/dispatch-facts.ts。
- tfs materialize-tasks、tfs resolve-tasks：旧派发关联 TFS Task 的实现。
- dev.dispatch 及 task_refs 覆盖、active/失效历史、工程师快照、旧 Sub-Issue 投影、tfs_task_ids 等旧事实与专用校验。
- analysis/publish、analysis/approve、delivery/verify-decision、dev/requirement-guard、delivery/requirement-mode、pr/materialize 等直接消费者中的旧派发兼容逻辑；完整仓库检索补齐遗漏。
- delivery route-decision 中依赖旧 Dispatch 的 ENGINEERING 返工、Sub-Issue 激活及恢复逻辑；dev.decision 中对应的 affected_task_refs、target_dispatch 等旧派发字段。

退役条件：确认真实在途 Issue 不依赖旧机制；如有，先按旧版本完成或进行必要的一次性转换。不得静默把旧 Issue 当作新交付处理，不建设长期兼容层。现行 CLI 的非旧派发能力不在删除范围。

### 2.2 保留有效人工返工能力

不直接删除 delivery route-decision 或所有 dev.decision 记录。该命令仍有 ANALYSIS、RECREATE_PR、人工安全停止等有效能力。Lead 解释 Human Comment，按现行 Change 级契约使用原生指派及 Run；CLI 仅负责必要的确定性状态/PR 事实修改。删除旧 Task Set 选择与派发快照，不新建通用返工对象、历史表或路由框架。

对于需要修改交付事实的操作，继续使用已有人工决定引用、当前事实核验和必要的幂等保护。保留有效的批准、PR 废弃及候选绑定；重试不得通过旧评论解除后来产生的阻塞。未有现行自动返工契约的场景保持人工处理，不扩大自动化范围。

PR 重建和返工的数据更新在 P0-2 同步适配；P0-1 不提前改写 PR 数据契约。Requirement 的 RECREATE_PR 仅针对当前已确认 abandoned 的 PR，其他仓库已登记的有效 PR 保留，候选变化仍按现行人工/研发路径处理。不得依据历史 abandoned 事件移除后来创建的 PR。

### 2.3 现行事实归属

| 事实 | Owner |
| --- | --- |
| Engineer 指派、执行身份 | Multica 原生 Assignment / Run |
| Change 身份 | analysis.source（P0-3 精简） |
| 研发任务 | OpenSpec tasks.md |
| TFS 子任务、工时与 Commit 绑定 | delivery.tfs_task_plan |

## 3. P0-2：统一 PR Facts

### 3.1 统一结构

将 pr_prep、current_pr、bug.delivery 合并为 Multica Issue Metadata `pr`，值为 JSON 数组，每个 repo_key 一条。Requirement 与 Bug 共用持久化记录，专业质量契约仍按各自现行要求。保留 bug.required_repos：它定义独立的完整交付范围，不能由已准备/已登记 PR 反推。Requirement 批准 Scope 可以大于实际交付范围，不能强制所有批准仓库生成 PR。

示意类型，复用现有 Fact 类型：

```typescript
interface PrEntry {
  repo_key: string;
  repo_url: string;
  source_branch: string;
  target_branch: string;
  candidate_commit: string;
  title: string;
  description: string;
  local_validation: ValidationFact;
  code_review: CodeReviewFact;

  // Bug 专业事实
  expected_behavior?: string;
  actual_behavior?: string;
  root_cause?: RootCauseFact;
  fix_summary?: string;
  regression?: RegressionFact;

  pr_id?: number;
  pr_url?: string;
}
```

- 保留真实 PASS/FAIL 及 Validation、Review 与 Candidate 的绑定，Bug 专业证据要求不变。
- tfs_id 直接消费 Issue 的 tfs.id，不重复持久化。输入身份冲突及外部 Work Item 关联核验保留。
- blockers 是 Preparation 的输入约束，现行合法 Preparation 要求为空。保留输入判断及未解决阻塞时拒绝交付，删除持久化的空数组及其重复校验；现有证据校验器若仍消费该输入，应调整持久化读取逻辑，不将缺失或非法输入默认为已通过。
- pr_id/pr_url 成对有效，表示已确认外部 PR 身份及必要 Work Item 关联；未登记时均缺失。不能以 pr 非空判断已登记或准备成功。
- 仅新增必要的共享类型、解析和更新方法。repo_key 唯一；保留必要的结构、外部身份与授权校验。不新增状态、时间戳、Schema Version 或 readiness 持久化。

### 3.2 Preparation

pr prepare：核对授权与 Candidate → 执行适用 Validation → 按 repo_key 写入 pr。

验证失败必须记录真实 FAIL，不保留同一 Candidate 的旧 PASS。Bug 的命令验证失败后不能用替代自报 PASS 绕过；不同 Candidate 不复用旧质量事实。保留其他仓库的最新记录，不覆盖已登记 PR 的身份或候选；沿用现有并发变化检测与必要的写入确认。Metadata 整值写入及回读不是原子 CAS，不新增锁服务，复用当前执行边界。

### 3.3 Materialization

pr materialize：读取 pr → 适用 Gate → 逐仓创建或复用 TFS PR → 确认外部身份、Candidate 及 Work Item 关联 → 补充同一条记录的 pr_id/pr_url → 全部确认后 Issue 进入 in_review。

保持现有副作用顺序：不提前登记 PR 身份，不新增中间状态、补偿任务或 Recovery Agent。每仓完整确认后立即登记；后续仓库失败不得丢失前面已登记的事实。重试优先使用已登记 PR；缺少登记时按现有 Active/Completed PR 查询、身份核验与复用机制处理，不盲目重复创建。in_review 仍为现有只读核验路径。

数据结构统一不能消除 TFS 与 Multica 之间的非原子失败窗口；本次不为此修改执行顺序或合并 CLI 命令。pr create 保留底层 TFS API 能力。

### 3.4 受控恢复及研发授权

- Bug RECREATE_PR：保留原 Candidate 和有效专业证据，只解除现有受控恢复范围内已确认 abandoned 的 PR 身份绑定。保持当前全组 abandoned 等前置条件，不扩大适用范围。
- Bug REWORK：按现有受控恢复条件清空 pr，重新研发验证。
- Requirement RECREATE_PR：对当前已确认 abandoned 的对应记录仅清除 pr_id/pr_url；保留其他有效登记及准备事实。沿用人工决定、外部状态和 Candidate 核验，不将历史事件误作当前事件。
- Bug resume、pr.abandoned 及有效人工恢复事实保留。先记录必要决定，再执行副作用并回读确认；不得覆盖后续轮次的事实。
- authorized-checkout、bug/authorization 等以是否存在已登记 PR 判断研发授权，不因 pr 有已准备记录就阻止其他仓库准备。其他授权约束保持。
- 适配 route-decision 的有效路径；不新建返工或恢复模型。

### 3.5 下游 Gate、Status Sync 与 Closeout

删除跨 pr_prep/current_pr/bug.delivery 的数量、集合、分支、候选身份对账及重复解析。保留批准 Scope、实际验证、Review、Bug required_repos、全部实际交付仓库准备与登记完整性、外部 PR 身份及必要终态/候选核验。

Status Sync 读取统一 pr，仅核实 TFS 状态与交付准入：
- 无登记且无待收口事实：正常跳过；现有状态或 pending 表明事实缺失时 UNKNOWN。
- 部分登记：不得收口；保持既有 abandoned 优先处理语义。
- 外部状态或身份不可信：UNKNOWN。
- 全部登记且外部 PR 均 completed、满足现行准入：Closeout。
- 其余 NOOP。

不重新执行专业质量判断，不创建 PR，不承担上游登记补救。Closeout 消费统一记录，保留现有外部确认、OpenSpec Archive、TFS Writeback 与恢复契约。Bug Digest 仅随新的 pr 输入自然调整，不单独重构 Digest 算法。

主要消费者：pr/prepare.ts、pr/materialize.ts、pr/reconcile-status.ts、bug/scope.ts、bug/finalize-facts.ts、bug/resume.ts、dev/authorized-checkout.ts、bug/authorization.ts、dev/change-completion.ts、delivery/requirement-mode.ts、delivery/route-decision.ts、delivery/closeout-pr.ts、delivery/finalize.ts、tfs/writeback.ts。

## 4. P0-3：精简 Analysis 发布事实

### 4.1 删除重复 Change ID

删除独立 analysis.change_ref，发布后仅通过 analysis.source.change_ref 消费。发布前使用当前 CLI --change-ref 等已有输入；保留 Change 身份、TFS 关联和路径安全校验，不为临时校验额外保存 Metadata。

同步 analysis/source.ts、analysis/facts.ts、analysis/validate.ts、analysis/publish.ts、analysis/gate-evidence.ts、identity resolver、dev、delivery、TFS Writeback 等消费者以及 Bug 对 OpenSpec 事实冲突的判断。Gate Digest 应绑定当前实际输入与版本，不依赖已删除的持久化字段。未发布阶段不得要求已有 analysis.source；无 Change 的合法路径与异常缺失区分，不默认降级为其他交付模式。

### 4.2 Gate 与 Source 的归属

当前 analysis publish 在替换 Source 时必须先撤销旧 Gate PASS、登记新 Facts，再写 PASS 并回读（analysis/publish.ts L267–303）。这是多键更新的真实成本。

默认保留 analysis.gate.result。实施 P0-3 时核对其完整写入者、失效路径和 Multica 原生 Trigger/过滤/运行配置。仅当确认 Gate PASS 只是同一次成功 Analysis Publication 的回执、没有独立生命周期或必要独立消费者时，直接把 gate_result 合入 analysis.source，与来源一次登记，取消独立 Key 及旧的跨键一致性步骤。若不能确认，保持现行独立 Gate 及其版本失效顺序，不另设对象或替代状态。

无论是否合并，不能让旧 PASS 授权新的未校验 Source，不能将 Source 非空直接当作 Gate PASS；保留真实 Gate、发布确认与人工批准的不同职责。

### 4.3 保留独立快照

analysis.change_kind 用于交付分类统计，保留。analysis.human_approval.source 是人工批准版本快照，dev.publication.analysis_source 是研发依据版本快照，均保留完整 repo/branch/commit/change 身份绑定。不为缩短 JSON 而改变授权或发布语义。

## 5. P0-4：消除 Requirement 的重复 Verify Decision

Requirement 唯一最终决定为 analysis.human_approval.verify_agent_required（Boolean），通过 readApprovedVerifyDecision 消费。删除 Requirement 对 verify_agent.required 的重复写入、dev prepare 补写及 assertProjectedVerifyDecision 等重复投影一致性校验。明确的批准、来源绑定、Task Waiver、缺失/非法值处理保持，不从 Analyst Recommendation 推断。

Bug 不经过 Requirement Human Approval，bug/finalize-facts.ts 直接消费 verify_agent.required，因此保留 Bug 现有独立验证契约及其 Gate。不强行为 Bug 新增审批对象，不全局删除该 Key。

删除 Requirement 投影前核对真实 Trigger、过滤及运行配置；存在依赖时先同步消费者。若无法安全调整，暂不删除投影，不为消除投影增加额外机制。

## 6. P1-1：Repository Scope 读取优化

权威来源始终是获批 Analysis Commit 下 openspec/changes/<change-ref>/.openspec.yaml 的 x-repositories，例如：

```yaml
x-repositories:
  - frame
  - frame-web
```

表达批准范围上限，而非实际交付仓库。当前 dev/prepare.ts 和 dev/authorized-checkout.ts 已有本地 Git 对象，却通过 requirement-guard.ts 读取远端同版 Scope。

已有身份确认的本地根仓及批准 Git 对象时，直接 git show <approved-commit>:openspec/changes/<change-ref>/.openspec.yaml；无本地对象的场景沿用固定 Commit 远端读取。不得使用未提交工作树或浮动分支，也不得因真实身份冲突、无效契约而回退绕过校验。复用现有解析和 Scope 核验，不为此准备额外根仓。

不新增 Scope Metadata、投影、缓存文件或服务。不预设计其他 Scope 方案。若收益有限，不扩大优化。

## 7. 目标 Metadata（主要交付事实）

| 事实 | Requirement | Bug |
| --- | --- | --- |
| analysis.source | 保留 | — |
| analysis.change_kind | 保留 | — |
| analysis.gate.result | 默认保留；满足 4.2 条件才合并 | — |
| analysis.human_approval | 保留 | — |
| dev.publication | 保留 | — |
| pr | 统一 | 统一 |
| bug.required_repos | — | 保留 |
| verify_agent.required | 删除重复投影（依赖确认后） | 保留现行契约 |
| pr.abandoned | 按需 | 按需 |
| 有效人工恢复事实 | 按需 | bug.resume 按需 |
| finalize.pending | 保留 | 保留 |
| delivery.tfs_task_plan | 保留 | — |
| delivery.tfs_written | 保留 | 保留 |

不包含 TFS 来源及其他协作字段。不同生命周期的对象保持独立，不合并为巨大 delivery JSON。

## 8. 实施顺序

| 编号 | 内容 | 状态 |
| --- | --- | --- |
| P0-1 | 退役旧 Task Set 派发及相关历史结构 | 确认在途依赖后实施 |
| P0-2 | 统一 PR Facts，适配有效恢复与直接消费者 | 待实施 |
| P0-3 | 删除重复 Change ID；按 4.2 决定 Gate 是否合并 | 待实施 |
| P0-4 | 删除 Requirement 重复 Verify Decision | 确认运行依赖后实施 |
| P1-1 | Scope 优先读取本地固定 Git Commit | 待实施 |

按顺序分步改造、Review 和验收；旧机制先退役，避免为即将删除的代码适配新模型。若存在实际旧路径依赖，先解决依赖，再推进受影响的数据契约切换。

## 9. 最小验收与部署边界

实施前完整检索旧字段、类型、命令、实际运行配置和消费者。先确认真实未完成或待收口 Issue；优先按旧契约完成，确有必要时仅做一次性转换并验证身份、pending/Digest 及授权。避免混合版本写入，不默认迁移历史已完成 Issue，不建立长期双读双写或迁移框架。

验收聚焦实际行为：
1. 原生 Engineer 指派/Run、现行 TFS 子任务与返工路径不依赖旧派发。确认仍有效的人工恢复能力未被删除。
2. 单仓/多仓 Requirement 与 Bug：Preparation、Materialization、Status Sync、Closeout；Bug 范围未齐不得创建 PR，Requirement 不强制全部批准 Scope。
3. Validation FAIL 覆盖旧 PASS，真实未解决 Blocker 不得进入合法 Preparation，Bug 命令 FAIL 不得降级。
4. 多仓部分成功、Work Item 关联失败、登记失败及状态更新失败后，按现行重试机制复用外部 PR，不重复创建、不提前收口。已登记记录不被其他更新覆盖。
5. RECREATE_PR / REWORK 保持当前授权与作用范围，其他有效 PR 不被错误清除；旧决策不得影响后续轮次。
6. Analysis 首次发布、重放、重新批准及归档；新 Source 不继承旧 PASS。Requirement Verify true/false、非法/缺失、Task Waiver 与 Bug 独立验证保护保持。
7. Scope 本地固定对象及无本地对象的远端路径，身份冲突、越权和错误处理；检查实际减少的远端读取。
8. 运行相关及现有全量测试。更新 01 中受影响的事实归属、02 主方案、CLI 文档、必要 Schema/Skill/Instructions 及实际运行配置；执行提示词只描述当前有效职责和方法，不叙述退役历史。

## 10. 非目标

不提前登记 PR 身份，不新增 PR 状态机、通用 Repository Fact Framework、Recovery Agent、第三事实存储、Scope 投影，不强制合并 PR 命令，不缩减独立 Source 快照，不独立重构 Closeout Digest，不扩大现有业务 Gate 或自动返工范围。

评审依据：PR #84 与 main 基线 af4c404f2cfc7e22e99fd7db6509be4f531a5de0 的实际核心代码。尚未穷尽全仓引用、核查真实 Multica Trigger/在途 Issue 或运行测试；Gate 合并、旧机制退役及 Requirement Verify 投影删除以明确前置核查结果为准。本文仅为研发设计，不代表代码已实施。
