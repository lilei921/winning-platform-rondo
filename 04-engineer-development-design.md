# Engineer Development Design（工程师研发设计方案）

> Version: 1.15.6  
> Date: 2026-11-28  
> Scope: 统一 Engineer 的 Requirement 研发与直接 Bug Fix 的公共工程质量、Native Workspace、Candidate、PR 交付。  
> 依据：[01](01-multica-openspec-design-guideline.md)、[02](02-multica-delivery-lifecycle-design.md)、[05](05-openspec-schema-implementation-design.md)。

## 1. 专业目标与完成标准

Engineer 对已批准 Change 的正确、可维护、可验证实现负责；一次正常派发以整个 Change 为工作单元，跨技术栈按真实依赖执行。不按 Backend/Frontend/Flink 或 Task Set 固定拆分。Bug Fix Agent 直接诊断、修复及 PR，不使用 OpenSpec。两者共用 native-workspace、pull-request，专业授权与证据保持差异。

完成意味着实际代码、适用验证、Code Review、必要工程进度与真实 PR 引用已交付，而非存在某个文件或 Run 结束。无法完成说明阻断和保留成果，不擅自批准、关闭、合并 PR 或管理 TFS 子任务。

## 2. Role / Agent Model

[Engineer](agents/engineer/instructions.md) 负责整个获批工程契约、软件实现、验证审查、研发工件发布及 PR。[Bug Fix Agent](agents/bug-fix-agent/instructions.md) 对当前获授权 Bug 的根因、修复、回归及 PR 负责。Lead 只协调授权与交接，业务任务仍由专业成员实施。可按需复用专业方法，独立验收不替代开发质量。

## 3. 输入、批准与范围

- Requirement：使用 `rondo openspec read --file <Change内相对路径>` 按固定 analysis.source 读取批准版本；Human Approval 与固定 Commit 一致。授权仓库是批准 .openspec.yaml 的 x-repositories，完整 Git/TFS 仓库名称。
- Bug：当前直接授权 Issue、Expected/Actual Behavior、可信根因、修复范围与已有 Evidence；已固定 bug.required_repos 时必须遵守。首次多仓准备固定完整必要集合。
- Project Resource 提供 URL 与 ref，实际工作树由原生 Checkout 返回，使用真实 Git 身份。批准范围、Resource 可用集合、实际修改仓及登记 PR 各有不同语义。

不能将允许修改所有仓误作必须在每仓建 PR。实质改变批准行为、接口、验收、范围或修复方向时停止受影响工作并重新授权；非实质技术设计细化允许。依据 Human 明确批准的豁免判断任务状态，不把未执行项伪装为已完成。

## 4. 研发执行

以实际源码、项目规范和获批要求建立事实基线。优先复用现有代码、测试及有效 Evidence；按风险选择小步修改、反馈与验证。确需本地工程仓时使用 [native-workspace](skills/native-workspace/SKILL.md)，不强制为只读调查 Checkout。工程根仓与业务仓平级、独立 Git，按实际返回路径工作。保留 Task Branch，Candidate 分支统一 feature/<tfs.id>；已经存在的 Candidate 优先续接。不得因 Checkout 或跨 Runtime 恢复失败强制 Reset 或清理原成果。

## 5. Ground 与反馈

确定当前变更的可观察目标、实际代码基线、相关依赖和有效反馈信号。优先局部可重复验证，例如服务单元测试、API/契约检查、前端行为与交互测试、Flink 作业适用的配置/数据流验证；不因技术栈强制创建新 Agent 或工具。长耗时构建优先 Runtime 原生任务管理，避免重复等待和轮询。纠正性修复应建立能识别原故障的反馈；无法复现用可信替代证据说明局限。

## 6. 增量实现与工程方法

优先 Small Change → Focused Feedback → Next Change。TDD 适用于可稳定自动验证的行为：针对性 RED、最小 GREEN、安全 Refactor；不以任意测试失败冒充 RED，也不为形式测试内部实现细节。按需使用局部 Design、接口 Seam、Adapter、数据流与测试可达性；不因采用设计方法启动无关重构。Engineer 在批准范围内自主选择实现细节；诊断新事实推翻批准要求时升级。具体方法的组织与来源归 [06](06-method-skill-library-implementation-design.md)。

## 7. Development Verification

验证分为任务级、必要的跨任务/模块/仓库集成或回归、Human 要求的 Independent Verification；后者不是 Engineer 验证的替代品。根据实际技术栈、改动和风险选择足以支持当前完成声明的测试/构建/回归。不得仅因已有 checkbox、历史 PASS 或远程镜像就声明当前 Candidate 已验证。

PR Prepare 时 Requirement 必须提供 validation.command；Bug 有适用本地命令时提供。CLI 执行实际命令并登记结果，无需事前填写 PASS。Bug 确无适用命令才允许提供真实替代验证 PASS、引用及原因、范围、结果、局限；失败不得降级为替代证据。同一 Candidate 已有命令失败时重新执行命令。研发过程中的必要调试和验证不受限制。

## 8. Code Review 与定向返工

双轴审查：Specification / Fix Alignment（是否符合获批需求、修复和范围、必要验证）与 Engineering Standards（复杂度、重复、可维护性、安全、错误处理、测试质量及回归）。审查绑定当前 Candidate / Diff 和工程契约，区分阻塞与非阻塞 Finding。Blocking Findings 必须真实解决并复核；未解决的非阻塞项说明风险（blocking:false 与 risk_note 或 risk_ref）。

合法 skip_specs 不伪造规格覆盖；存在 Design 时核对获批决策；Bug 检查原故障修复、影响范围及回归。已勾选任务应有实际依据；不将审查时尚未勾选本身作为失败。返工针对实际 Finding、受影响验证与候选版本复核，不默认全量重复；实质合同偏差回 Human 决定。

<a id="development-section-09"></a>

## 9. Candidate 与 PR 交付

使用 [pull-request Skill](skills/pull-request/SKILL.md)，命令参数以 [COMMANDS](rondo/COMMANDS.md) 与 Help 为准。

### 9.1 Git Candidate

按需 `rondo repo fetch --repo <repo_id> --root-repo "<root>"`（只 Fetch，不合并）；在原生工作树完成真实 Commit 后 `rondo repo push --repo <repo_id> --root-repo "<root>"`，非强制 Push，CLI 核对授权和 Candidate。Bug Commit 保留唯一 Refs: #<tfs.id> 尾注。统一远端 Candidate feature/<tfs.id>；新 PR Target 是 Resource ref；已准备 PR 使用登记的 source_branch/target_branch。原生工作树不由 PR 创建或删除。

### 9.2 Prepare

每个实际交付仓提供 Facts（系统临时 UTF-8 JSON 或 stdin，不进入 Git）：
```json
{
  "validation": {"command": ["npm", "test"], "summary": "实际验证范围及必要局限"},
  "code_review": {"result": "PASS", "summary": "针对候选版本的审查", "findings": []},
  "blockers": [],
  "description": "变更、验证及剩余风险"
}
```
Bug 同时提供 expected_behavior、actual_behavior、fix_summary、root_cause（confirmed/probable、summary、evidence_refs，probable 补 remaining_risk）、regression（PASS、summary、evidence_refs）以及 validation/code_review 的证据引用。不得以未执行命令作为专业 Regression PASS。

```bash
rondo pr prepare --repo <repo_id> --root-repo "<root>" --candidate-commit <sha> --facts "<temporary-json>" --title "<title>"
```

按需指定 --validation-cwd；多仓 Bug 首次用 --required-repos 固定必要仓集合。Requirement 只准备获批范围内实际修改的仓。真实命令失败不得登记成功；按实际结果恢复。CLI 在 Issue 的单一 `pr` JSON Array 中按 repo_key 登记准备事实，包含 repo_url、source_branch、target_branch、candidate_commit、title、description、local_validation、code_review 等；外部身份在 Materialize 成功后补充 pr_id/pr_url，不另建准备集合和当前 PR 集合。真实类型以 [facts.ts](rondo/src/commands/pr/facts.ts) 与 [prepare.ts](rondo/src/commands/pr/prepare.ts) 为准。

### 9.3 Materialize

Bug 按 ready_for_pr 确认必要仓完整；Requirement 的适用 Tasks 已完成或由 Human 明确豁免且研发工件已发布。执行 `rondo pr materialize`。CLI 核验适用 Gate、逐仓创建或幂等恢复真实 PR、确认 Work Item 关联并登记；全部登记才进入 in_review。返回结果异常时核对实际外部结果，不手工改事实绕过。PR 状态与 abandoned 恢复由 [02 §11](02-multica-delivery-lifecycle-design.md#pr-status-sync) 维护。

## 10. Engineering Evidence

验证、审查、Bug 根因/回归及 PR 描述使用真实结果和引用。Git 持有代码及不可变版本；Issue pr 保存跨 Run 消费的最小事实，TFS 持有正式 PR 描述。临时输入不生成 evidence-<repo>.json、pr-description-<repo>.md 或额外 Review 文件。Candidate 或契约发生影响证据有效性的实质变化时刷新受影响检查；仍有效的证据复用，不制造重复执行。

## 11. Requirement 研发工件与完成

Engineer 依据真实完成结果直接更新 tasks.md checkbox，批准正文和编号不变；未执行的豁免项保持未勾选。提交当前 Change 研发工件后：

```bash
rondo openspec publish --root-repo "<实际根仓>"
```

非实质性 Design 细化才用 --minor-design。CLI 发布当前 Change 已提交差异至批准分支并登记 dev.publication；不能用其他 Change 的改动代替。研发工件发布与每仓 PR Prepare 可按实际依赖安排，Materialize 时全部适用条件满足。不能用默认逐 Task checkpoint 替代工程完成。

## 12. 异常与权限边界

Git、授权、验证、PR 或来源不明时停止受影响操作，保留已有成果，核实实际结果及影响。已获批的任务和范围不可擅自扩大；Human 明确允许的局部设计细化、定向返工在授权边界内完成。跨 Runtime 以固定来源和登记 Candidate 恢复，不依赖上一 Run 的本地绝对路径。未确认新 Run 或外部写入时不盲目重试。

## 13. 实施资产

- [Engineer](agents/engineer/instructions.md)、[Bug Fix Agent](agents/bug-fix-agent/instructions.md)、[native-workspace](skills/native-workspace/SKILL.md)、[pull-request](skills/pull-request/SKILL.md)。
- [PR Prepare](rondo/src/commands/pr/prepare.ts)、[Validation](rondo/src/commands/pr/validation.ts)、[Materialize](rondo/src/commands/pr/materialize.ts)、[Requirement Guard](rondo/src/commands/analysis/requirement-guard.ts)、[Publish](rondo/src/commands/openspec/publish.ts)。
- [Candidate Branch](rondo/src/commands/pr/candidate-branch.ts)、[Bug Scope](rondo/src/commands/bug/scope.ts)。

## 14. 验收

单仓/多仓 Requirement、直接 Bug、无命令 Bug 替代验证、命令失败、越权仓库、Task 豁免、固定版本和 Candidate 变化、部分 PR 写入失败恢复均以实际结果核验。PR 终态及收口另按 [02](02-multica-delivery-lifecycle-design.md)。真实环境验收与待验证项见 [07](07-multica-openspec-implementation-roadmap.md)。
