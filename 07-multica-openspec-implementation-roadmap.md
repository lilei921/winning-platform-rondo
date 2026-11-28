# Multica + OpenSpec 工程实施推进计划

> Date: 2026-11-28  
> Version: 1.3.8  
> 核对基线：dev @ `6a2a3af4f5209d8c9d4483d84820c143754d516d`（本次文档整合前）。  
> Scope: 实现对齐、实施顺序及验收；不另定义领域契约。

## 1. 定位与权威

01–06 分别拥有设计原则、交付生命周期、专业分析、研发交付、OpenSpec 契约及 Skill 方法；07 只维护实现对齐及尚待验证的事项。原有 [实施跟踪表](https://docs.google.com/spreadsheets/d/1DGW-nhkyQGpjZHXnrMQI2yUpJrN83LkLzwOCEf0QE/edit) 属于历史推进记录，本次不更新外部表格；不以旧 Step 数量或工作包作为现行 Gate。设计确认、仓内实现、部署、隔离验证及实际运行验收是不同状态。

## 2. 当前实施资产与对齐

以下“仓内有实现”指基线文件、配置和源码可核对，不代表本次重新执行测试或正式环境验收通过。

| 能力 | 主要实现证据 | 实际运行仍须确认 |
|---|---|---|
| TFS 同步与准入 | [TFS Sync](agents/tfs-sync-agent/instructions.md)、[Wayfinder](agents/wayfinder-agent/instructions.md)、[CLI 命令参考](rondo/COMMANDS.md) | 目标 Project、真实来源同步、accepted/needs_human/unsupported 交接 |
| 分析与审核 | [Analyst](agents/workitem-analyst/instructions.md)、[OpenSpec 命令](rondo/src/commands/openspec/) | 无增量 Comment、真实工程增量、固定审核来源与 Human Approval |
| 原生工作区与 Resource | [native-workspace](skills/native-workspace/SKILL.md)、[native-checkout.ts](rondo/src/clients/native-checkout.ts) | Windows/实际 Runtime 原生 Checkout、Resource ref、身份和重入 |
| 统一研发与 Bug | [Engineer](agents/engineer/instructions.md)、[Bug Fix](agents/bug-fix-agent/instructions.md)、[pull-request](skills/pull-request/SKILL.md) | 单/多仓、实际验证、豁免、失败与跨 Runtime 恢复 |
| OpenSpec Schema | [Schema 与模板](openspec/schemas/)、[OpenSpec 实现](rondo/src/commands/openspec/) | 安装版本、Schema 原生状态、扩展 metadata 保留 |
| PR 状态与收口 | [PR Status Sync](agents/pr-status-sync-agent/instructions.md)、[workitem-finalize](skills/workitem-finalize/SKILL.md) | TFS PR 终态、归档、真实回写、Commit 独占及幂等 |
| Runtime 主备 | [Vayne](agents/vayne-agent/instructions.md)、[reconcile.ts](rondo/src/commands/runtime/reconcile.ts)、[provisioning](workspace-config/provisioning.json) | 实际平台切换 PoC、主备配置、Autopilot 实际触发 |
| Skill / Agent 同步 | [provisioning.json](workspace-config/provisioning.json)、[rondo-sync](.claude/skills/rondo-sync/SKILL.md) | 实际 Workspace 配置回读、运行版本与绑定 |

Independent Verification 仍有实现缺口：受管配置未注册 Verify Agent，当前 Rondo 能登记/消费验收要求，但未实现独立 PASS 的消费闭环。要求独立验收时按 [02 §9](02-multica-delivery-lifecycle-design.md#independent-verification) 阻断自动 Finalize；此项不是单纯配置或 Runtime E2E 待确认。只在实际需要且获得授权时另行补齐能力，本次不新增实现。

## 3. 实施顺序

1. 核对 Workspace、Agent/Squad、Skill/MCP、CLI 及 Project Resource 的实际配置与版本。
2. 验证 TFS 同步、准入与直接 Bug 的完整交付；Requirement 分别验证无增量出口、分析审核、批准与研发。
3. 验证多仓、授权 Scope、PR 准备/物化、真实外部状态及最终收口；再验证跨 Runtime 恢复、异常和独立验收的适用场景。
4. Vayne 可独立进行 PoC；在实际平台能力、主备绑定、模型兼容及运行行为确认后人工启用 Autopilot。
5. 依据真实运行证据修复实际缺陷，不引入与当前问题无关的新服务、Agent、Skill、状态或配置层。

这不是强制串行运行流程；各实现模块在满足真实依赖时可独立验证。

## 4. 最小验收矩阵

| 场景 | 应核实的结果 |
|---|---|
| TFS 同步 | 当前 Project，WIQL，来源版本/附件，重复同步不误建 Issue |
| Wayfinder | 三维准入、accepted 分流，需人处理/unsupported 有真实依据，暂时故障不误判 |
| 无工程增量 | 普通 Comment，不制造 Change，不把部署待确认当作解决，不绕过已生效的工程契约或交付授权 |
| Requirement 分析 | 正确 Schema/Scope/Identity、最小工件、一次最终 Gate、固定来源可读取 |
| Human Approval | 评论与 Commit 一致；独立验证明确决定；真实豁免编号可消费 |
| Independent Verification（当前限制） | Requirement 要求为 true 或独立 Bug 字符串要求为 "true" 时，Finalize 返回 UNKNOWN，不归档、不写回；完整 PASS 消费尚待按实际需求实现 |
| Native Workspace | 根仓/业务仓平级，真实路径、正确 ref/Origin、已有成果可复用，不误改其他工作区 |
| 研发与 PR | 授权内单/多仓 Candidate，真实验证和 Code Review，任务实际进度、豁免不误勾选；部分 PR 写入恢复 |
| 直接 Bug | 不使用 OpenSpec；按 Bug Scope 修复，真实回归/替代验证，唯一 Refs 尾注、登记 PR |
| PR 状态同步 | 扫描符合条件 Issue，active/未知不推进，abandoned 记录事实；全部 completed 才收口 |
| 收口 | 按 02 §12 核实固定来源归档、任务/Commit、TFS 目标状态与工时、父项评论；Bug 直接回写；Complete 核对真实外部条件与最终摘要，重复执行不重复创建摘要 |
| 恢复与幂等 | 部分成功、网络中断、已完成残留 pending、重复运行、授权冲突及 UNKNOWN 均安全处理 |
| Runtime 主备 | 主在线优先、主明确离线切备、主恢复切回；双离线 FAIL、未知 UNKNOWN；已绑定不重复写；失败隔离、配置错误 |
| Runtime PoC | 核实改绑对执行中 Run、排队、离线恢复、跨 Provider 模型及 Autopilot 固定服务器 Runtime 的实际影响，不用静态代码推断平台保证 |
| OpenSpec 原生兼容 | 实际安装版本、skip_specs、原生 validate/archive、`x-repositories` 扩展字段不被意外丢失 |

## 5. 既有验证证据与局限

- [08-A 实施记录](validation/new/08a-implementation-2026-11-14.md) 与 [隔离 Runtime 验证](validation/new/08a-runtime/README.md)：历史 Bug/Wayfinder/远程 MCP 验证证据；使用当时版本和配置，不代表本次基线所有路径通过。
- [Native Workspace Spike](validation/native-workspace-spike-20261124.md)：原生工作区能力证据；实际 Runtime 的恢复、配置及当前平级布局仍以当前实现和回读为准。
- 已有回放用于针对性定位异常和优化耗时；不得把历史回放的成功、隔离测试或代码存在等同正式环境 E2E。

本次是设计整合与静态实现核对，不改变应用代码、Schema、Agent Instructions、Skill 或部署配置，不新增 CI 或运行时机制。

## 6. 08–20 专项方案合并索引

按现行实现收敛有效契约，旧机制、阶段实施记录及已被取代的候选设计不再作为现行规则。编号存在 a/b 及同号多份文档，共 19 份；按文件逐份映射如下。

| 原专项 | 合并归属 | 保留或收敛的内容 |
|---|---|---|
| 08-remote-analysis-git-workspace-design.md | 01/03/04/06 | 远程只读调查、按需原生工作区、跨 Run 固定事实 |
| 08a-remote-analysis-bug-fix-foundation.md | 02/04/06/07 | Wayfinder 分流、直接 Bug、历史验收证据 |
| 08b-requirement-remote-git-delivery.md | 02/03/04/05/06 | Requirement 固定分析版本、研发交付与恢复 |
| 08b-requirement-root-branch-and-publish-plan.md | 03/04/05/06 | 固定根仓来源、当前 Change 发布；不保留常驻根仓机制 |
| 09-unified-engineer-development-design.md | 02/04 | 统一 Engineer 与实际仓库交付 |
| 09a-repository-scope-authority-analysis.md | 01/05 | Scope 权威归获批 .openspec.yaml，实际 PR 单独登记 |
| 10-tfs-subtask-estimation-design.md | 02/07 | 真实任务/Commit 规划、工时、幂等回写 |
| 11-workspace-preparation-skill-design.md | 06 | 工作区准备职责，由 Native Workspace 实现取代 |
| 12-delivery-closeout-config-removal-plan.md | 02/06 | PR 状态事实驱动的收口，不需独立 Registry |
| 12-native-repo-workspace-preparation-design.md | 01/06 | 原生 Checkout，实际工作区与 Resource |
| 12-native-workspace-consumer-alignment-plan.md | 03/04/05/06 | 按返回路径消费 Checkout，移除旧工作区依赖 |
| 13-workitem-analyst-constraint-optimization-review.md | 03/06 | 专业聚焦、只读按需、最小充分分析 |
| 14-pull-request-skill-design.md | 02/04/06 | 统一 PR、真实 Candidate/验证与单一事实 |
| 15-agent-skill-cli-boundary-review.md | 01/04/06 | 语义决策、场景方法与确定性操作分层 |
| 16-analysis-no-change-and-efficiency-optimization-plan.md | 02/03/07 | 无工程增量出口、准入前置、减少重复检查 |
| 17-workitem-analyst-review-artifacts-simplification-2026-11-21.md | 01/03/04/05 | 最小工程工件、普通 Comment 与事实归属 |
| 18-workitem-analyst-skill-boundary-review.md | 03/06 | Agent 与分析 Skill 的最小职责 |
| 19-repository-context-resource-simplification-plan.md | 01/03/04/05/06/07 | Resource label/url/ref、完整仓名、Scope 与实施验证 |
| 20-lights-out-plan.md | 02/07 | Vayne、Runtime Policy、确定性切换及剩余 PoC |

原专项保留于 [历史设计归档](archive/00-design/2026-11-28-consolidated/)，原始内容不修改。历史方案中的相对路径按原提交上下文阅读；可通过基线 commit 查看其原始完整目录。归档不意味着所有旧专项均已完成真实运行验收。
