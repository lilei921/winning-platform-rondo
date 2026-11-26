# 18 — Workitem Analyst 与 Skills 职责边界优化方案

> 评审基准：main @ 84da2080e39e2a00ee4c1d682c3a53c0d0c83f0f；01 设计规范 v1.16.13。
> 范围：Workitem Analyst、实际绑定的六个 Skills、直接消费的 Analysis CLI。P0 与 P1 已实施；P2 待后续确认。

## 1. 设计结论

保留现有架构和六个 Skills，不新增 Agent、Skill、Stage、Gate、Metadata、过程工件或 Comment 封装。Agent 对专业分析及语义决策负责；Skill 提供可按需复用的方法；Rondo CLI 处理确定性校验、执行及事实登记；OpenSpec 持有工程契约，Multica 持有交付事实。遵循 First Principles、KISS、YAGNI、Specialist Focus、One Rule / One Owner、Native First、Outcome First。

专业分析的目标是判断真实问题、是否存在工程增量及如何验证。无需变更时普通 Comment；确有工程增量时准备 OpenSpec 并发布 Human Review；关键事实或授权不足时报告缺口及待决定事项，不将未知误判为无变更。

## 2. P0 — 补齐确定性校验

| 问题 | 证据 | 最小修复 |
| --- | --- | --- |
| Issue 与 Change 归属 | `analysis/validate.ts` 的 Identity 只检查 tfs.id 存在、类型与 Schema；`change/resolve-identity.ts` 已使用末尾独立 TFS ID 段 | 最终 Gate 核对实际传入 Change ID 与当前正整数 tfs.id 的后缀匹配，共用既有匹配规则，ID 合法性对齐下游批准/研发契约 |
| Repository Scope | `analysis/repository-scope.ts` 只解析非空、去重、合法格式的字符串列表 | Acceptance Contract 仅核对当前 Scope 的 repo_id 在根仓 `docs/config/repo-context.yaml` 中已登记；不审计无关条目。不登记为 FAIL，映射不可读或无法识别为 UNKNOWN。Requirement 复用现有候选 Git Tree/固定来源恢复检查，核对实际固定版本的成员关系；Legacy 在已发布版本确认时核对。 |

仅扩充现有 Identity / Acceptance Contract，不新增检查阶段，不远程查询、不要求 LLM 重复核验。本地 Gate 失败不得 Commit/Push 或登记审核；Requirement 候选版本检查失败不得 Push 或登记审核，保留已完成的本地 Change Commit。保持 Schema、专业判断、OpenSpec Strict Validation、发布工件一致性及 Human Approval 机制。有效旧审核重放仍消费已登记固定事实，不重新执行 Gate。

验证：正确后缀通过、其他 TFS ID/无后缀/非法 TFS ID 拒绝；合法已登记范围通过、未登记名称拒绝、权威文件缺失/无效不能放行；无关异常条目不阻塞合法 Scope；本地映射与最终候选或恢复来源不一致时，按实际固定版本阻断，已登记审核重放不重复执行；现有格式校验、合法 skip_specs 和发布路径回归。测试 fixture 按当前契约建立本地映射和 Change ID。

## 3. P1 — Instructions 与 Skills 收敛（已实施）

- Workitem Analyst：核心职责明确工程增量决策；区分无需变更、确需变更、事实/授权不足。合并重复证据原则；Independent Verification 建议只表达变更风险、开发侧验证能力及独立验收要求，保留 Human 决定；按需使用已授权 Remote MCP，确需本地仓时使用 native-workspace。保留授权、专业审查、真实证据及交付边界。
- codebase-explorer：MCP 具体用途归属此 Skill；Agent 仅保留简短使用原则；仅核实与当前结论相关的跨仓契约。保留只读及证据充分即停止。
- bug-analysis：保留独立专业方法及 confirmed/probable/unknown，不强制 Red Loop 或诊断报告。
- requirement-analysis：保留 Explore/Analyze/Evaluate/Clarify；P2 可精简 Confirmed/Recommended/Unresolved 输出组织，不要求固定报告。
- spec-preparation：保留 Change 身份解析、授权及原生 Schema/Artifact 来源；可信已确认信息直接复用，按需核实，不固定 schema which/status/instructions 调用次数；具体 Artifact 内容归属 Schema；简明消费 Resolver 结果，冲突或未知停止写入。
- analysis-publish：保留轻量执行型 Skill，CLI 负责 Gate、Git、事实及重放；PASS 提交专业审核摘要，FAIL 修正实际问题，UNKNOWN 确认结果或报告阻断，保留评论幂等和真实停止条件。不封装原生 Comment。
- native-workspace：保持共享能力与现有架构，不修改。
- CLI：`analysis publish` 根据当前 Issue 的 `tfs.type` 自动选择原有发布路径；常规调用不再传 `--mode requirement`。旧参数仅兼容与来源类型一致的调用，不能选择或覆盖路径。保持 Requirement 的 Git、身份、Gate、审核及恢复机制；不改其他 CLI 的 Mode。

P1 实施保留必要的原生命令、参数及安全边界，不以提示词字数为验收标准；更新 CLI 使用文档和相关测试，不再要求 Skill 重复最终 Strict Validation。保留 `bug-analysis`、`requirement-analysis`、`native-workspace` 原有实现。

## 4. P2 — 清理（待实施）

精简 requirement-analysis 输出描述；确认无其他引用后删除 spec-preparation/config/repo-registry.json（与 analysis-publish 配置 Blob 相同）；修正 Workitem Analyst README 中 workspace-preparation 与实际 native-workspace 绑定的漂移。不新增公共配置抽象。

## 5. 明确非目标

不合并专业 Skills，不恢复 ai_review/facts.json/持久化 Gate，不修改工作区架构、交付流程或 Human Approval，不固定调查方法及深度。不将根因、业务意图、技术方案和仓库影响语义决策转移到 CLI。后续以真实回放验证质量和耗时。
