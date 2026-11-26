# PR 交付事实统一最小充分优化方案

- 日期：2026-11-26
- 状态：设计待实施
- 范围：Rondo CLI 的 PR 交付事实及直接消费者
- 原则：First Principles、KISS、YAGNI、One Rule One Owner；遵循 01 统一设计规范。

## 1. 目标与现状

每个实际交付 Repository 的 Candidate、专业质量事实和外部 PR 身份属于同一个交付对象的不同事实维度。当前 `pr_prep`、`current_pr` 与 Bug 专用 `bug.delivery` 分别持久化，导致 repo_key、source_branch、target_branch、candidate_commit 等重复存储，以及多组仓库集合、分支及候选身份的关联校验。

基于 main 分支实际实现：
- `rondo/src/commands/pr/prepare.ts`：Requirement 写入 pr_prep，Bug 成功后分别写入 bug.delivery 和 pr_prep；验证失败写入相应记录。
- `rondo/src/commands/pr/materialize.ts`：读取 Preparation、创建或复用 PR，核对外部身份和 Work Item 关联后逐仓登记 current_pr，全部登记后设置 in_review。
- `rondo/src/commands/pr/reconcile-status.ts`：对比两组仓库集合以阻止部分登记触发收口。
- `rondo/src/commands/delivery/closeout-pr.ts`：关联两组记录，重复校验内部身份。
- `rondo/src/commands/bug/scope.ts`、`bug/finalize-facts.ts`：存在三组事实的集合与 Candidate 一致性校验。
- `rondo/src/commands/bug/resume.ts`、`dev/authorized-checkout.ts`、`bug/authorization.ts`：依赖 current_pr 是否存在或清空。
- `rondo/src/commands/dev/change-completion.ts`、`delivery/requirement-mode.ts`、`delivery/finalize.ts`：直接消费上述事实。

目标：每个 Repository 只有一条权威 PR 交付记录，减少重复存储及由其引入的校验。保留实际业务授权、质量、交付完整性、外部身份与终态约束。

## 2. P0-1：统一 Metadata

将 `pr_prep`、`current_pr`、`bug.delivery` 收敛为一个 Multica Issue Metadata Key：`pr`。值为 JSON 数组，每个 repo_key 对应一条记录，支持多仓。保留 `bug.required_repos`（Bug 实际交付范围）、`pr.abandoned`、`bug.resume`、`finalize.pending` 等具有独立语义的现有事实，不另建历史表或状态机。

Requirement 与 Bug 共用 PR Record；专业质量要求及业务流程仍按各自现有契约执行。Requirement 批准 Scope 可以大于实际交付仓库集合，不强制为所有批准仓库创建 PR。

## 3. P0-2：最小数据结构

以下为示意类型，实施时复用现有 Fact 类型，不新增通用框架。

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
  blockers?: string[];

  // Bug 专业事实，按现有契约提供
  expected_behavior?: string;
  actual_behavior?: string;
  root_cause?: RootCauseFact;
  fix_summary?: string;
  regression?: RegressionFact;

  // 外部 PR 身份
  pr_id?: number;
  pr_url?: string;
}
```

- 沿用现有字段名；local_validation 必须能表达实际 PASS / FAIL，Code Review、Evidence 与 Candidate 绑定要求不变。
- tfs_id 从 Issue 的 tfs.id 获取，不重复存储；外部 PR 与 Work Item 关联仍需核实。现有输入身份冲突校验保留。
- pr_id、pr_url 成对存在且有效，不能单凭非空 pr 判定已登记。合法 Preparation 由现有质量 Facts 判断，不持久化 ready_for_pr。
- 不新增 status、prepared_at、schema_version、materialize_pending、registration_status。TFS 为 PR 外部状态权威来源。
- 定义简单共享读取及更新方法，校验 JSON、repo_key 唯一性等必要数据边界。不将 CLI 回执或临时对象变为另一事实来源。
- 保留现有 blockers 契约：Requirement 及需要该字段的专业校验必须获得真实空数组；不要以可选类型绕过现有硬条件。

## 4. P0-3：PR Preparation 与 Materialization

### 4.1 pr prepare

核对授权和 Candidate → 执行适用 Validation → 按 repo_key 写入 pr。

Requirement、Bug 均写同一结构。验证失败记录真实 FAIL，不保留相同 Candidate 的旧 PASS。保留其他仓库最新事实；不允许覆盖已经登记的 PR 身份或将旧验证事实绑定到新 Candidate。保留现有必要的回读确认及并发变化检测；目前 Metadata set 为整值写入，不能将普通回读误认为原子 CAS，不新增锁服务，复用现有执行边界。

### 4.2 pr materialize

读取 pr → 执行适用 Gate → 逐仓创建/复用 TFS PR → 确认外部身份及 Work Item 关联 → 更新同条记录的 pr_id、pr_url → 全部确认后 Issue 进入 in_review。

每次成功登记立即持久化；后续仓库失败不能清除已登记事实。重试优先按已登记 ID 核实；缺少登记时沿用现有外部 Active/Completed PR 查找及身份校验，禁止盲目重复创建。in_review 路径保持现有只读核验语义。

### 4.3 进一步缩小登记失败窗口（实施时独立验证）

当前创建 PR 后还需要查询、身份核验、Branch HEAD、Work Item 关联等操作，其中失败可能导致 PR 已存在但未登记。统一数据结构不提供跨 TFS 与 Multica 的原子事务。

建议评估：一旦确认 PR 外部身份即可先登记 pr_id、pr_url，再完成 Work Item 关联；所有仓库的关联及必要交付条件确认后才进入 in_review。重试通过已登记 ID 恢复关联。若采用此顺序，必须同步调整 Status Sync / Closeout 准入，尤其 blocked Issue 不得仅因 PR 已登记且 completed 就越过尚未确认的关联。优先复用既有状态与外部核验，不新增中间状态或补偿服务。若现有机制不能充分保证准入，保留原登记顺序，不为提前登记增加复杂状态机。

pr create 仍是底层 TFS API 能力；本方案不强制合并 CLI 命令。

## 5. P0-4：受控恢复与研发授权

- RECREATE_PR：仅清除当前 pr 记录的 pr_id、pr_url，保留 Candidate、Preparation 和专业证据；现有 Human Decision、外部 abandoned 身份及 Candidate 不变核验保留。
- REWORK：清空 pr，重新研发与验证。
- 保留 bug.resume 原始 PR 决策快照及 pr.abandoned 事件；保持恢复幂等、先持久化决定再执行副作用、回读确认后恢复 in_progress。
- authorized-checkout、bug/authorization 等检查是否存在已登记 PR，而非检查 pr 数组是否为空。不得因第一次 Preparation 而阻止其他仓库的准备。
- 不扩展现有受控恢复的适用场景或授权。

## 6. P0-5：下游 Gate

删除 pr_prep/current_pr/bug.delivery 之间的仓库数量、集合、分支、Candidate 等内部关联一致性校验及重复解析。复用专业 Facts 校验，保留以下实际业务条件：
- 有效授权、Repository Scope 与必要质量事实；
- Candidate 与 Validation/Code Review 的绑定，实际验证失败不能降级；
- 全部实际交付仓库完成准备、全部 PR 已登记；
- 外部 PR Repository/Project/Branch/ID 等身份、Work Item 关联及必要的终态与 Candidate 核验；
- Bug required_repos 完整覆盖，Requirement 按批准 Scope 内的实际交付仓库处理。

适配 Development Completion、Bug Gate、Closeout、授权及恢复等直接消费者。Bug finalize digest 以统一后的事实为输入，并保证已存在 finalize.pending 的恢复契约不被破坏。

## 7. P0-6：Status Sync 与 Closeout

Status Sync 读取 pr，查询 TFS 实际状态，不重新判断研发质量、不准备或创建 PR：
- 无已登记 PR 且无待收口事实：正常跳过；若现有状态或 pending 表明事实破损，明确 UNKNOWN。
- 部分登记：不得收口。
- abandoned：保留现有异常处理及事件幂等规则。
- 外部身份或状态不可确认：UNKNOWN。
- 全部实际交付仓库已登记、外部 PR 均 completed 且满足现有交付准入：Closeout。
- 其余：NOOP。

Closeout 直接消费统一 PR 记录，不再进行内部双/三对象关联；保留现有必要外部确认、TFS Writeback、OpenSpec Archive 与 pending 恢复规则。

## 8. P0-7：实施、迁移、验证及文档

实施前在完整仓库搜索 pr_prep、current_pr、bug.delivery 及相关类型、CLI 输出和测试 fixtures，确认所有直接消费者及运行配置。GitHub 全仓代码搜索此前未返回有效结果，当前评审不是引用穷举。

先确认真实环境是否存在使用旧契约、尚未结束或待收口的 Issue。若无，直接切换；若有，仅针对实际存量做一次性转换，验证 repo_key、Candidate、PR 身份及 finalize.pending/digest 一致性，必要时先按旧契约完成正在收口的 Issue。避免新旧版本混用导致写入覆盖。不建设长期双读双写兼容层，不默认引入迁移框架，不改已完成历史 Issue（除实际需要恢复 pending 外）。

更新 02 Delivery 生命周期、CLI 命令参考及受影响的文档和测试。Agent Instructions 聚焦专业职责，Pull Request Skill 聚焦当前方法及 CLI 使用，不叙述历史机制或重复内部 JSON Schema。Rondo CLI 负责确定性事实管理；TFS 保持外部状态权威。

最小验收：
1. 单仓/多仓 Requirement 与 Bug 的 Preparation、Materialization、Status Sync、Closeout。
2. Validation FAIL 覆盖旧 PASS，未准备的仓库不影响合法后续准备。
3. 多仓部分成功、Metadata 登记失败、外部创建结果不确定、重试复用以及状态更新失败；不能重复创建、覆盖其他仓库事实或提前收口。
4. RECREATE_PR 保留 Candidate/Evidence，REWORK 清空交付事实；保留人工授权和恢复幂等。
5. 若采用提前登记，覆盖 Work Item 关联失败、blocked/in_review 状态及 Closeout 不提前触发。
6. 存量迁移仅在实际存在需要处理的 Issue 时验证，重点是 pending/digest。
7. 运行相关单元/集成测试及全量现有测试，确认无残留有效旧字段消费者。

## 9. 非目标

不新增 PR 生命周期状态机、Schema Version、PR Registry、Recovery Agent、通用 Repository Fact Framework；不扩展业务 Gate，不改变 TFS/Multica/OpenSpec 的事实归属，不强制合并 CLI 命令。

本方案已根据 main 核心源码及 01 设计原则进行 Review；尚未穷尽全仓引用、执行测试或读取真实远端 Issue Metadata。提前登记的副作用顺序为待验证项。本文仅保存研发基线，不代表代码已实施。
