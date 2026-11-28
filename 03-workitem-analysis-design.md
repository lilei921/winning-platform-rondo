# Workitem Analysis Design（工作项分析设计方案）

> Version: 1.19.9  
> Date: 2026-11-28  
> Scope: Requirement 的专业分析与必要工程准备；Wayfinder 与直接 Bug Fix 的生命周期归 [02](02-multica-delivery-lifecycle-design.md)。  
> 上位规范：[01](01-multica-openspec-design-guideline.md)；Schema：[05](05-openspec-schema-implementation-design.md)；方法：[06](06-method-skill-library-implementation-design.md)。

## 1. 目标与完成标准

Workitem Analyst 对准确、可实施、可验证的专业结论负责，而非默认生产 Change。使用当前 Issue、有效 Evidence 和必要源码定位实际问题，区分事实、假设、建议与授权决定。

| 专业判断 | 合适产出 |
|---|---|
| 无需工程变更（已有能力覆盖、已修复、配置或使用说明等） | 普通 Issue Comment：结论、关键依据及处理建议 |
| 存在需要实施的工程增量 | 必要 OpenSpec 工件、专业审查、固定 Git 审核版本、Human Review 摘要 |
| 关键事实、授权或处理能力不足 | 明确缺口、影响与待决定事项；保留已确认成果 |

无增量不是 Gate FAIL，不伪造 Change 或机器事实；未知不能当作无变更。无工程增量不等于问题已解决，不得将尚未确认的现场部署、运行验证视为已经完成，也不得借此绕过已生效的工程契约、Human Approval、研发派发或 PR。以普通 Comment 回流结论，不额外为此 @Lead；Comment 本身不表示 TFS 已关闭或 Issue 已 Done。关键事实或意图未确定时按实际缺口补证或澄清。

## 2. Role 与边界

[Workitem Analyst Instructions](agents/workitem-analyst/instructions.md) 持有角色、长期专业目标及交付责任。按实际任务自主使用六个绑定 Skill：codebase-explorer、bug-analysis、requirement-analysis、spec-preparation、analysis-publish、native-workspace。不是固定流水线。Agent 不负责生产代码实施、研发派发、TFS 工作项管理、Human Approval 或 PR。普通专业分析无需执行发布 CLI。

## 3. 来源管理类型与技术语义

TFS Type 是外部管理事实，不由 Agent 改写。Wayfinder 按来源类型路由，Bug 直接交 Bug Fix Agent，不使用 OpenSpec；Requirement 才进入本分析职责。Requirement 内部既可能恢复既定行为，也可能改变预期行为：

| Technical Change Kind | Schema | 适用 |
|---|---|---|
| corrective | corrective-change | 恢复既定行为；必要时澄清/补录规格 |
| intentional | intentional-change | 改变预期行为或工程要求 |

来源类型、技术变更性质、复杂度与仓库数量是独立维度。无工程增量时不选择 Schema、不强制制造 Change。纠正性 Requirement 不等于独立 Bug Fix，也不改变 TFS 管理类型。

## 4. 输入与执行模型

优先使用当前 Issue 内容、来源版本、用户反馈、Wayfinder 已记录 Decision / Evidence、当前 Project Context。只调查会影响当前判断的变化、缺口、冲突。以业务目标、预期与实际行为、范围、验收要求为核心；关键业务歧义提交 Human，局部技术选择不无谓升级。确有工程增量才准备根仓和工程契约。

<a id="analysis-section-05"></a>

## 5. Change Kind 与决策边界

不以是否新增代码、改动仓库数量、是否已有规格或 TFS 来源名称直接判定技术性质。混合变更先区分恢复的既定行为与新增要求；如果影响批准范围、外部接口或验收，明确需要 Human 决定的事项。Wayfinder 的准入是范围与能力筛选，不替代本阶段专业分析。对无明确授权的新增业务目标不擅自扩大范围。

<a id="analysis-section-06"></a>

## 6. Context Analysis 与 Evidence

- 已知相关仓、位置或 Symbol 时直接调查；归属不明时复用 Project Resource label 及当前上下文，结合源码核实。按需使用 remote-codegraph（索引调用关系）、remote-filesystem（授权源码/配置）、remote-ripgrep（定向检索）。索引与源码冲突时以可信版本源码为准。
- 优先复用 Wayfinder Evidence。记录来源版本、仓库、源码位置及必要引用，区分证据与推断。远程只读镜像不得视为当前研发 Candidate 的验证结果。
- 只读 MCP 足够时不强制 Checkout；确需本地仓时使用 native-workspace，实际工作区方法见 [06](06-method-skill-library-implementation-design.md#native-workspace)。不固定探索次数、深度或工具顺序。
- 证据充分即停止。业务/运行日志或确认事项若影响结论，应保留实际来源及必要摘要；代码和文档不能自行证明历史运行成功。跨 Run 通过已有 Comment、工件与固定引用复用，不建立固定 context-pack、evidence 或分析报告。

<a id="bug-analysis"></a>
<a id="analysis-section-07"></a>

## 7. Corrective Analysis

以 Expected / Actual Behavior、触发条件、可靠复现或替代证据为起点。定位故障机制和影响范围，建立能区别假设的反馈信号，说明 Root Cause 的 confirmed / probable / unknown 及证据。没有稳定复现时如实说明日志、测试、Trace 等替代证据及局限。

修复方向应恢复既定行为，覆盖原始故障和受影响正常路径；有必要时补录/澄清规格。probable 说明残余风险；影响正确实施的关键根因仍未知时先调查或升级，不以猜测通过专业审查。不强制某个 Red Loop、诊断报告或固定调查链；实际 [bug-analysis](skills/bug-analysis/SKILL.md) 维护可复用方法。

<a id="requirement-analysis"></a>
<a id="analysis-section-08"></a>

## 8. Intentional Analysis

[requirement-analysis](skills/requirement-analysis/SKILL.md) 围绕 Explore / Analyze / Evaluate / Clarify 按需组合。澄清用户、业务场景、当前/预期行为、规则、正常/异常/边界场景、范围与排除项；寻找现有能力，评估可行方案、影响、依赖与取舍。业务决定需要依据和必要授权；工程局部实现交 Engineer。

| 结论 | 权威位置 |
|---|---|
| Why、Goal、范围、Capability 摘要 | proposal.md |
| 新增/变化的可观察行为与验收场景 | 实际 Specs Delta |
| 需要实施前决定的技术取舍 | 按需 design.md |
| 可实施、可验证工程任务 | tasks.md |
| 获批仓库范围 | .openspec.yaml 的 x-repositories |
| 证据、建议、未决事项 | 对应工程工件或当前 Issue Comment 中可追溯引用 |
| 独立验证建议 | 当前审核 Comment |

不强制 requirement-analysis.md 或结构化三段报告；无变更时在普通 Comment 给出专业结论。

<a id="openspec-change-contract"></a>
<a id="analysis-section-09"></a>

## 9. OpenSpec Preparation

仅在存在工程增量且身份、性质、写入授权明确时使用 spec-preparation。优先复用唯一 Change，必要时用 `rondo openspec resolve-identity` 按已知 change_ref 和/或 tfs.id 定位。ACTIVE_FOUND 复用；NOT_FOUND 满足创建条件才新建；ARCHIVED_FOUND / CONFLICT / INVALID / UNKNOWN 停止有关写入并说明问题。Change ID 末尾是独立 TFS ID 段，见 [05 §5](05-openspec-schema-implementation-design.md#openspec-schema-section-05)。

按项目原生 Schema、Artifact Instructions、Template、状态和依赖准备工件；合法 skip_specs、Conditional Design 以实际契约为准。可信状态直接复用，不要求例行重复 schema which/status/instructions。Agent 按实际影响确定需要提交审核的 Repository Scope，遵循 [05 §3](05-openspec-schema-implementation-design.md#openspec-schema-section-05) 的唯一授权载体及确定性校验；不要将候选仓、允许范围和实际交付仓混为一谈。

不擅自改写已批准 Goal / Scope / Acceptance / Verification。发现实质影响先澄清并重新审核。具体工件内容与权限归 [05](05-openspec-schema-implementation-design.md)；CLI 不承担技术方案或 Root Cause 判断。

<a id="analysis-section-10"></a>

## 10. Independent Verification 建议

根据实际变更风险、开发侧验证能力及独立验收要求给出是否需要、依据及必要验证重点；可引用工程契约。最终由 Human 决定，建议不是批准，也不减少必要开发验证。无需独立 Review 文件或另建专用任务。现行独立验收能力限制、Human 决定及自动收口边界见 [02 §9](02-multica-delivery-lifecycle-design.md#independent-verification)，不因实现缺口改写专业建议。

<a id="analysis-section-11"></a>

## 11. 专业 Review 与确定性 Gate

专业审查检查结论和工件是否准确、完整、一致、可实施、可验证；核实范围、方案、验收、任务与必要验证是否真实对应。修正发现的阻塞，保留真实结论、风险与引用。不强制 ai-review.md、ai_review Metadata、facts.json 或 Review Verdict 文件。

专业 Review 不由确定性 Gate 代替；最终 Gate 的检查范围、固定版本证据及失败边界由 [05 §8](05-openspec-schema-implementation-design.md#openspec-schema-section-15) 维护。Analyst 消费实际结果并定向修订，不重复 CLI 检查或额外持久化 Gate 工件。

<a id="analysis-section-12"></a>

## 12. Analysis Publish、Human Handoff 与返工

只有确需实施且工程契约、审查完成的 Requirement 才使用 [analysis-publish](skills/analysis-publish/SKILL.md)：

```bash
rondo openspec submit-review --change-ref <change_ref> --root-repo "<root>"
```

CLI 负责最终 Gate、当前 Change Git 发布、固定来源登记与审核状态确认；不要求手工 Commit/Push 或例行 validate。成功消费返回的 analysis_source 与 diagnostics；不重复已确认后置条件。失败定向修正；需要定位时才执行 `rondo openspec validate`；UNKNOWN 先核对实际状态和固定来源。

提交成功后在当前 Issue 普通 Comment 提供专业摘要：目标、方案、影响、专业审查结论、Independent Verification 建议 true/false、依据及重点、风险/待决事项、固定 Git 仓库/分支/完整 Commit/Change ID、Gate 结果。按触发线程使用原生 Comment；已存在同一版本摘要不重复；仅评论失败时补评论，不重跑已成功的发布。默认不导出或上传附件。

Human 要求修订时仅修改受影响结论及关联工件，复用仍有效证据。重新固定版本；不得擅自批准。正式授权、handoff 和后续状态由 [02 §6](02-multica-delivery-lifecycle-design.md#human-analysis-review) 维护。

## 13. 研发交接与职责

交接以 Human 批准的固定 `analysis.source` 为准；Engineer 用 `rondo openspec read` 读取，不依赖可变分支或 Analyst 原工作区。Issue Comment 不重复存储工程契约正文；跨阶段机器事实由 CLI 登记。OpenSpec Task 表示工程分解，不是 TFS 子任务或 Multica Run。TFS 任务管理在 PR 后收口，参见 [02 §12](02-multica-delivery-lifecycle-design.md#delivery-finalization)。

## 14. 实施资产

- [Workitem Analyst](agents/workitem-analyst/instructions.md)、[Wayfinder](agents/wayfinder-agent/instructions.md)
- [受管 Skills](skills/README.md)、[provisioning.json](workspace-config/provisioning.json)
- [Repository Scope parser](rondo/src/commands/analysis/repository-scope.ts)、[submit-review](rondo/src/commands/openspec/submit-review.ts)、[resolve-identity](rondo/src/commands/openspec/resolve-identity.ts)、[CLI reference](rondo/COMMANDS.md)

## 15. 验收

无增量应仅有普通结论；有增量正确选择 Schema、合法 Scope、固定来源与审核摘要；身份冲突、非法/未登记仓库、缺少授权、无效工件或发布不明不能推进；可信既有证据、有效发布与评论可复用；不生成强制过程工件、不重复 Gate。真实环境验收状态由 [07](07-multica-openspec-implementation-roadmap.md) 维护。
