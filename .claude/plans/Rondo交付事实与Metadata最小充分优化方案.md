# Rondo 交付事实与 Metadata 最小充分优化方案

- 日期：2026-11-26
- 状态：设计待实施
- 范围：Repository Scope、PR Facts、Metadata 与直接消费者
- 原则：First Principles、KISS、YAGNI、Native First、One Rule One Owner；遵循 01 统一设计规范。
- 本文为唯一研发方案，整合 PR #84 原方案与 PR #85，后续不维护两套设计契约。

## 1. 目标与现状

消除重复事实、无意义的跨对象一致性校验、重复远端读取及已退役机制的维护成本。保留实际授权、质量、版本绑定、外部副作用及恢复所需的独立事实。

同一事实只保存一次；不同生命周期的事实保持独立。允许有明确实际收益且来源固定的必要投影，不建立第二权威来源。One Rule One Owner 不等于 One Issue One Object。

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

## 2. P0-1：PR Facts 统一

### 2.1 统一 Metadata

将 `pr_prep`、`current_pr`、`bug.delivery` 收敛为一个 Multica Issue Metadata Key：`pr`。值为 JSON 数组，每个 repo_key 对应一条记录，支持多仓。保留 `bug.required_repos`（Bug 实际交付范围）、`pr.abandoned`、`bug.resume`、`finalize.pending` 等具有独立语义的现有事实，不另建历史表或状态机。

Requirement 与 Bug 共用 PR Record；专业质量要求及业务流程仍按各自现有契约执行。Requirement 批准 Scope 可以大于实际交付仓库集合，不强制为所有批准仓库创建 PR。

### 2.2 最小数据结构

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

### 2.3 PR Preparation 与 Materialization

#### 2.3.1 pr prepare

核对授权和 Candidate → 执行适用 Validation → 按 repo_key 写入 pr。

Requirement、Bug 均写同一结构。验证失败记录真实 FAIL，不保留相同 Candidate 的旧 PASS。保留其他仓库最新事实；不允许覆盖已经登记的 PR 身份或将旧验证事实绑定到新 Candidate。保留现有必要的回读确认及并发变化检测；目前 Metadata set 为整值写入，不能将普通回读误认为原子 CAS，不新增锁服务，复用现有执行边界。

#### 2.3.2 pr materialize

读取 pr → 执行适用 Gate → 逐仓创建/复用 TFS PR → 确认外部身份及 Work Item 关联 → 更新同条记录的 pr_id、pr_url → 全部确认后 Issue 进入 in_review。

每次成功登记立即持久化；后续仓库失败不能清除已登记事实。重试优先按已登记 ID 核实；缺少登记时沿用现有外部 Active/Completed PR 查找及身份校验，禁止盲目重复创建。in_review 路径保持现有只读核验语义。

#### 2.3.3 进一步缩小登记失败窗口（实施时独立验证）

当前创建 PR 后还需要查询、身份核验、Branch HEAD、Work Item 关联等操作，其中失败可能导致 PR 已存在但未登记。统一数据结构不提供跨 TFS 与 Multica 的原子事务。

建议评估：一旦确认 PR 外部身份即可先登记 pr_id、pr_url，再完成 Work Item 关联；所有仓库的关联及必要交付条件确认后才进入 in_review。重试通过已登记 ID 恢复关联。若采用此顺序，必须同步调整 Status Sync / Closeout 准入，尤其 blocked Issue 不得仅因 PR 已登记且 completed 就越过尚未确认的关联。优先复用既有状态与外部核验，不新增中间状态或补偿服务。若现有机制不能充分保证准入，保留原登记顺序，不为提前登记增加复杂状态机。

pr create 仍是底层 TFS API 能力；本方案不强制合并 CLI 命令。

### 2.4 受控恢复与研发授权

- RECREATE_PR：仅清除当前 pr 记录的 pr_id、pr_url，保留 Candidate、Preparation 和专业证据；现有 Human Decision、外部 abandoned 身份及 Candidate 不变核验保留。
- REWORK：清空 pr，重新研发与验证。
- 保留 bug.resume 原始 PR 决策快照及 pr.abandoned 事件；保持恢复幂等、先持久化决定再执行副作用、回读确认后恢复 in_progress。
- authorized-checkout、bug/authorization 等检查是否存在已登记 PR，而非检查 pr 数组是否为空。不得因第一次 Preparation 而阻止其他仓库的准备。
- 不扩展现有受控恢复的适用场景或授权。

### 2.5 下游 Gate

删除 pr_prep/current_pr/bug.delivery 之间的仓库数量、集合、分支、Candidate 等内部关联一致性校验及重复解析。复用专业 Facts 校验，保留以下实际业务条件：
- 有效授权、Repository Scope 与必要质量事实；
- Candidate 与 Validation/Code Review 的绑定，实际验证失败不能降级；
- 全部实际交付仓库完成准备、全部 PR 已登记；
- 外部 PR Repository/Project/Branch/ID 等身份、Work Item 关联及必要的终态与 Candidate 核验；
- Bug required_repos 完整覆盖，Requirement 按批准 Scope 内的实际交付仓库处理。

适配 Development Completion、Bug Gate、Closeout、授权及恢复等直接消费者。Bug finalize digest 以统一后的事实为输入，并保证已存在 finalize.pending 的恢复契约不被破坏。

### 2.6 Status Sync 与 Closeout

Status Sync 读取 pr，查询 TFS 实际状态，不重新判断研发质量、不准备或创建 PR：
- 无已登记 PR 且无待收口事实：正常跳过；若现有状态或 pending 表明事实破损，明确 UNKNOWN。
- 部分登记：不得收口。
- abandoned：保留现有异常处理及事件幂等规则。
- 外部身份或状态不可确认：UNKNOWN。
- 全部实际交付仓库已登记、外部 PR 均 completed 且满足现有交付准入：Closeout。
- 其余：NOOP。

Closeout 直接消费统一 PR 记录，不再进行内部双/三对象关联；保留现有必要外部确认、TFS Writeback、OpenSpec Archive 与 pending 恢复规则。

## 3. P0-2：Repository Scope 读取优化

### 3.1 当前事实与问题

Requirement 的 Repository Scope 权威来源为获批 Analysis Commit 中的 openspec/changes/<change-ref>/.openspec.yaml：

```yaml
x-repositories:
  - frame
  - frame-web
```

这是经 Human Approval 批准的仓库范围上限，不等于实际交付仓库集合。实际交付仓库由 pr 记录；不得要求所有批准仓库都创建 PR，不得用 Scope 初始化 pr。

当前代码：
- rondo/src/commands/analysis/repository-scope.ts：解析 x-repositories。
- rondo/src/commands/analysis/publish.ts、analysis/validate.ts：核验并发布 Scope。
- rondo/src/commands/dev/requirement-guard.ts：approvedChange 通过 readAnalysisArtifact 读取远端获批版本。
- rondo/src/commands/dev/prepare.ts、dev/authorized-checkout.ts：已有本地根仓及批准 Git 对象时仍调用 guardRepository 远端读取同版 Scope。
- rondo/src/commands/dev/publish.ts、dev/change-completion.ts、pr/materialize.ts：直接或间接使用 approvedChange。
- rondo/src/commands/delivery/requirement-mode.ts：Closeout 已使用本地 git show 读取批准版本。

真正问题是已冻结的 Scope 被多个命令重复读取；具体耗时尚未测量。

### 3.2 首选：本地固定 Commit 优先

有已准备且身份确认的根仓、批准 Git 对象时，直接读取：

```bash
git show <approved-commit>:openspec/changes/<change-ref>/.openspec.yaml
```

复用现有解析和 Repository Scope 校验。无本地批准对象的场景继续读取固定 Commit 的远端文件；不读取未提交工作树或浮动分支。对于本地身份冲突、无效契约等真实错误，不将远端回退作为绕过校验的途径。

不新增 Metadata Key、缓存文件或缓存服务。优先复用已有 Git 对象及当前执行上下文。

### 3.3 可选：Scope 投影至 analysis.source（暂缓）

仅在实测跨 Run 的固定版本读取仍存在显著开销、且投影有实际收益时考虑。示意：

```json
{
  "repo_url": "https://tfs/.../_git/root",
  "branch": "develop",
  "commit": "<analysis-sha>",
  "change_ref": "<change-ref>",
  "repositories": ["frame", "frame-web"]
}
```

由 analysis publish 从已校验、已提交的 .openspec.yaml 提取，随对应固定 Commit 一次登记。OpenSpec 仍为权威来源，CLI 是投影唯一写入者，Agent 不独立修改仓库列表。消费时不再逐次远端对账。若采用，须同步审查 AnalysisSource 的解析、版本绑定、批准及发布快照的消费者，避免扩大重复数据。

不新增 analysis.repositories 或 requirement.required_repos 等平行权威字段。不同时实施两套 Scope 优化；本期首选 3.2。

## 4. P0-3：删除重复 analysis.change_ref

当前独立 analysis.change_ref 与 analysis.source.change_ref 重复，readAnalysisSource 依赖两者并进行一致性校验，analysis publish 分别登记。

目标：发布后的 Change 身份统一由 analysis.source.change_ref 提供。发布前的 Analysis Validation 使用 CLI 当前 --change-ref 等已有输入，保留必要 Change 身份和路径安全校验，不为临时校验额外持久化字段。

实施前核对 analysis publish、analysis validate、gate-evidence、change-schema、dev、delivery finalize、TFS writeback、Skill、原生 Trigger/过滤、CLI 输出及测试等直接消费者。确保 Gate 与 Source 仍绑定当前审核版本，避免新 Source 与旧 PASS 混用；未发布阶段不得误要求已有 analysis.source。删除重复字段写入及跨字段一致性校验。

## 5. P0-4：删除重复 verify_agent.required

当前 analysis.human_approval.verify_agent_required 为 Boolean，独立 verify_agent.required 为字符串 true/false；analysis approve 双写，dev prepare 存在补写逻辑，assertProjectedVerifyDecision 专门检查两者一致。

Requirement 以 Human Approval 中的 verify_agent_required 为唯一权威决定。统一通过 readApprovedVerifyDecision(md).required 消费，删除投影的重复写入、补写与一致性校验。保留明确的 Human Decision、批准来源绑定和缺失/非法值处理，不从 Analyst Recommendation 推断。

实施前核实 Multica 原生 Trigger、过滤条件、运行配置和其他直接消费者；若存在依赖，先调整消费者再删除。Bug 不经过 Requirement 的批准契约，继续保持现有独立验证策略，不因删除 Requirement 投影而削弱 Bug Gate。

证据：rondo/src/commands/analysis/approve.ts、delivery/verify-decision.ts、dev/prepare.ts、delivery/requirement-mode.ts、bug/finalize-facts.ts。

## 6. P0-5：清理 dev.dispatch 旧派发机制

当前 Requirement 已采用 Change 级 Engineer 与 Multica 原生 Assignment / Run，但仍有旧 Task Set 派发事实、active 覆盖校验、工程师身份和 tfs_task_ids 映射等兼容逻辑。

当前残留：
- rondo/src/commands/dev/dispatch-facts.ts、dev/check-dispatch.ts。
- rondo/src/index.ts 中 dev check-dispatch 注册。
- delivery/verify-decision.ts、dev/requirement-guard.ts、delivery/requirement-mode.ts、analysis/publish.ts、analysis/approve.ts、pr/materialize.ts 中的旧派发消费者或防混用约束。
- tfs/materialize-tasks.ts 中旧派发与 TFS 子任务关联逻辑。

确认无实际在途 Issue 依赖后，删除旧 Metadata、命令、实现、消费者、文档及测试。避免保留长期兼容分支。若有在途依赖，先完成旧交付或进行必要的一次性转换，再退役；不能将旧 Issue 静默当作新交付处理。

新交付的事实归属：
- Engineer 指派及执行身份：Multica 原生 Assignment / Run。
- Change 身份：analysis.source。
- 研发任务：OpenSpec tasks.md。
- TFS 子任务拆分、工时及 Commit 绑定：delivery.tfs_task_plan。

不改变现有 Change 级 Engineer 业务流程，也不重新设计 Task 机制。

## 7. P1：可选优化（暂缓）

### P1-1：analysis.human_approval.source

完整复制 analysis.source，但该快照有独立价值：绑定被批准的具体仓库、分支、Commit 与 Change，不允许后续 Source 更新自动获得原授权。

仅在其他来源身份已可靠固定时考虑将快照简化为 approved_commit；仅比较 Commit 不必然等价于当前完整身份绑定。当前保留完整快照。

### P1-2：dev.publication.analysis_source

当前记录完整 AnalysisSource 与已发布研发 Commit。两个 Commit 语义不同，不能合并，也不能删除整个 dev.publication。

仅在其他来源身份已可靠固定时考虑收敛为 analysis_commit + commit；当前保留完整快照，不以减少 JSON 字段为优化目的。

### P1-3：finalize.pending / Digest

Requirement 使用 prepared_change_ref，Bug 使用 prepared_kind / prepared_bug_digest，均承担外部副作用恢复和防止过期事实重放的真实职责。

保留 finalize.pending；在 P0-1 统一 pr 后，按新的事实结构评估 Bug Digest 输入是否可简化。不取消必要恢复保护，不为统一而引入额外状态或泛化机制。

## 8. 保留的独立事实

| Metadata | 业务价值 |
| --- | --- |
| analysis.source | 固定工程契约位置及版本 |
| analysis.change_kind | 技术语义分类 |
| analysis.gate.result | 确定性校验结果 |
| analysis.human_approval | 人工批准、独立验证决定及豁免 |
| dev.publication | 研发工件发布回执 |
| bug.required_repos | Bug 实际交付范围 |
| bug.resume | 人工恢复决定 |
| pr.abandoned | PR 废弃事件与幂等处理 |
| finalize.pending | 跨系统收口恢复事实 |
| delivery.tfs_task_plan | 已确定的子任务拆分、工时及 Commit 绑定 |
| delivery.tfs_written | TFS 外部回写回执 |

不得将所有独立事实合并为一个巨大 delivery 对象，避免扩大整值写入的覆盖范围及破坏独立生命周期。

## 9. 目标模型与实施顺序

Requirement 主要交付 Metadata：

```text
analysis.source
analysis.change_kind
analysis.gate.result
analysis.human_approval
dev.publication
pr
finalize.pending
delivery.tfs_task_plan
delivery.tfs_written
```

仅列主要事实，不包含 TFS 来源及其他协作字段。Bug 继续保留其独立范围和恢复契约。

| 编号 | 实施内容 | 状态 |
| --- | --- | --- |
| P0-1 | PR Facts 统一 | 待实施 |
| P0-2 | Scope 优先读取本地固定 Commit | 待实施 |
| P0-3 | 删除重复 analysis.change_ref | 待实施 |
| P0-4 | 删除重复 verify_agent.required | 确认运行依赖后实施 |
| P0-5 | 删除 dev.dispatch 旧机制 | 确认无在途依赖后实施 |
| P1-1 | Human Approval Source 快照简化 | 暂缓 |
| P1-2 | Development Publication Source 快照简化 | 暂缓 |
| P1-3 | Closeout Digest 简化 | 暂缓 |

按 P0-1 至 P0-5 分步实施，各阶段协调共享消费者和测试，避免临时双轨契约。P0-1 内部按 2.1–2.6 推进；P1 暂缓。

## 10. 实施、迁移及验收

### 10.1 PR Facts 专项验收

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

### 10.2 Scope 与 Metadata 专项验收

- 全仓检索旧字段及 CLI 命令引用，核对真实运行配置和在途 Issue；不默认引入历史数据迁移框架。
- Scope：覆盖本地固定批准 Commit、有无本地对象、版本/仓库身份冲突、越权及多仓实际交付；比较优化前后实际远端读取次数与必要耗时。
- Change 身份：覆盖未发布分析、首次发布、重放、重新分析批准、研发与归档。
- Verify Decision：覆盖明确 true/false、缺失/非法值、批准版本变化及 Task Waiver，确认 Bug 不被错误放行。
- Dispatch：确认新 Engineer 原生指派、TFS 子任务、Commit 绑定与收口不依赖旧机制。
- 保留必要授权、质量 Gate、外部身份核验与恢复语义。运行相关及全量现有测试，更新权威设计、CLI 文档与必要 Skill/Instructions；不在执行提示词中解释历史演进。



## 11. 非目标与当前边界

不新增 PR 生命周期状态机、Schema Version、PR Registry、Recovery Agent、通用 Repository Fact Framework；不扩展业务 Gate，不改变 TFS/Multica/OpenSpec 的事实归属，不强制合并 CLI 命令。



本方案依据 2026-11-26 GitHub main 核心源码及 01 设计原则 Review。尚未穷尽全仓引用、执行测试、核实真实 Multica 运行配置与在途 Issue，亦未测量 Repository Scope 读取耗时。提前登记 PR 身份为待独立验证项；Scope Metadata 投影及 P1 暂缓。本文仅为研发基线，未实施业务代码。
