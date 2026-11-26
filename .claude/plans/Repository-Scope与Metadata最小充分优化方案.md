# Repository Scope 与 Metadata 最小充分优化方案

- 日期：2026-11-26
- 状态：设计待实施
- 关联方案：[PR #84：PR 交付事实统一最小充分优化方案](https://github.com/lilei921/winning-platform-rondo/pull/84)
- 原则：First Principles、KISS、YAGNI、Native First、One Rule One Owner；遵循 01 统一设计规范。

## 1. 目标

消除重复事实、无意义的跨对象一致性校验、重复远端读取及已退役机制的维护成本。保留实际授权、质量、版本绑定、外部副作用及恢复所需的独立事实。

同一事实只保存一次；不同生命周期的事实保持独立。允许有明确实际收益且来源固定的必要投影，不建立第二权威来源。One Rule One Owner 不等于 One Issue One Object。

## 2. P0-1：PR Facts 统一（引用 PR #84）

将 pr_prep、current_pr、bug.delivery 收敛为 pr，具体数据结构、执行顺序、Bug 恢复、Status Sync、Closeout 与测试以 PR #84 为准。本方案不重新定义其契约。

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

保留 finalize.pending；在 PR #84 统一 pr 后，按新的事实结构评估 Bug Digest 输入是否可简化。不取消必要恢复保护，不为统一而引入额外状态或泛化机制。

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
| P0-1 | PR Facts 统一 | 引用 PR #84，待实施 |
| P0-2 | Scope 优先读取本地固定 Commit | 待实施 |
| P0-3 | 删除重复 analysis.change_ref | 待实施 |
| P0-4 | 删除重复 verify_agent.required | 确认运行依赖后实施 |
| P0-5 | 删除 dev.dispatch 旧机制 | 确认无在途依赖后实施 |
| P1-1 | Human Approval Source 快照简化 | 暂缓 |
| P1-2 | Development Publication Source 快照简化 | 暂缓 |
| P1-3 | Closeout Digest 简化 | 暂缓 |

本专项与 PR #84 保持独立设计文档，不重复维护其详细契约。研发时协调字段及消费者变更，避免两个专项重复修改或引入临时双轨契约。

## 10. 最小验收与边界

- 全仓检索旧字段及 CLI 命令引用，核对真实运行配置和在途 Issue；不默认引入历史数据迁移框架。
- Scope：覆盖本地固定批准 Commit、有无本地对象、版本/仓库身份冲突、越权及多仓实际交付；比较优化前后实际远端读取次数与必要耗时。
- Change 身份：覆盖未发布分析、首次发布、重放、重新分析批准、研发与归档。
- Verify Decision：覆盖明确 true/false、缺失/非法值、批准版本变化及 Task Waiver，确认 Bug 不被错误放行。
- Dispatch：确认新 Engineer 原生指派、TFS 子任务、Commit 绑定与收口不依赖旧机制。
- 保留必要授权、质量 Gate、外部身份核验与恢复语义。运行相关及全量现有测试，更新权威设计、CLI 文档与必要 Skill/Instructions；不在执行提示词中解释历史演进。

本方案依据 2026-11-26 GitHub main 核心源码 Review。尚未穷尽全仓引用、核实真实 Multica 运行配置与在途 Issue，未测量 Repository Scope 读取耗时。仅保存方案，未实施代码或执行测试。
