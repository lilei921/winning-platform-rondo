---
title: LEI-64 Analysis Publish Gate 与执行效率优化方案
status: proposed
created_at: 2026-11-25
updated_at: 2026-11-25
baseline: cd9273de916e4482a04e4640fffaf57009beb47b
---

# 17 — Analysis Publish Gate 与执行效率优化方案

## 1. 目标与范围

以 [LEI-64 本次回放](projects/replay/20261125-LEI-64/replay.md) 为唯一运行事实，对照当前 main 源码及 [01 设计原则](01-multica-openspec-design-guideline.md)，解决 Analysis 执行时间过长、发布错误阻断与职责偏移。遵循 First Principles、KISS、YAGNI、Specialist Focus、Native First、One Rule One Owner、Minimal Sufficient。

核心决策（已确认）：最小校验、信任 Git 原生完整性机制。首次 Requirement Analysis Publish 使用 Git 原生的固定 Commit 及远端分支可达性证明发布结果，不再用 TFS REST API 逐文件回读正文、重复计算 Digest。保留真实 Analysis Gate、候选工程契约一致性、授权、并发保护、固定来源、Human Approval。原方案仅保存设计；PR #67 合并后的实施状态及后续未完成增量见 §9。

## 2. 回放事实与耗时

TFS 268376：DF 集成调度作业迁移失败日志缺少详细异常信息。Wayfinder 已定位 DfJobMigration.java，Lead 明确复用定位并按需判断前端影响。Analyst 实际使用 remote-codegraph、remote-filesystem、remote-ripgrep，不能将本次归因为 MCP 未使用。

| 阶段 | 耗时 | 占比 | 工具调用 |
|---|---:|---:|---:|
| 上下文加载与环境探测 | 53s | 4.2% | 14 |
| 工程调查与准备 | 319s | 25.1% | 46 |
| OpenSpec 工件生成 | 223s | 17.6% | 23 |
| Gate 预检查及本地提交 | 19s | 1.5% | 2 |
| Publish 失败及排障 | 655s | 51.6% | 35 |
| 合计 | 1269s | 100% | 120 |

Analyst 17:41:43–18:02:52，人工取消，未正常完成。Wayfinder 111s，Lead 54s，阶段有重叠。数据为轮次级墙钟时间，不代表单工具耗时。来源：[Run 快照](projects/replay/20261125-LEI-64/evidence/runs.json)、[Analyst Timeline](projects/replay/20261125-LEI-64/workitem-analyst/20261125-1741-e5e21a79/timeline.md)、[Replay JSON](projects/replay/20261125-LEI-64/workitem-analyst/20261125-1741-e5e21a79/replay.json)。

关键证据：17:51:38 validate，17:51:46 本地 commit，17:51:57 首次 publish；#87 修正路径后仍失败；#90 Gate PASS；#91 全局 grep 超时；#103 本地与远端 Digest 不同；#106 定位 proposal.md 中顿号被两个 U+FFFD 替换；#110 同一固定 SHA 的同一正文五次读取中两次损坏、三次正常。后续循环发布均未确认成功。回放中本地工件与发布 SHA 的 Change 无 Git Diff，tasks.md 与 .openspec.yaml 字节数一致，proposal.md 12812 与 12815 字节不一致。新建 Change 有源码缺陷及 Identity NOT_FOUND 的依据，不能仅凭已删除的历史 Change 判定 no-change。

## 3. P0 — 发布 Gate 过度校验

### 3.1 当前实现及原始目的

源码：[publish.ts](rondo/src/commands/analysis/publish.ts)、[published-source.ts](rondo/src/commands/analysis/published-source.ts)、[root-git.ts](rondo/src/commands/runtime/root-git.ts)、[gate-evidence.ts](rondo/src/commands/analysis/gate-evidence.ts)。

当前首次 Requirement 发布：
1. evaluateAnalysisGate 消费本次 Facts 与本地 Change，运行真实 Gate，获得 schema、change_digest、metadata_digest。
2. publishChange 以远端目标分支为基线投影当前 Change 的已提交差异，validateTree 使用 committedContract 校验候选 SHA 的实际 Git Tree 与 Gate 一致。
3. Push 后重新 Fetch，merge-base --is-ancestor(candidate, observed) 确认候选 SHA 已在远端目标分支；复用/恢复分支同样验证候选及可达性。
4. publish.ts 再调用 readPublishedContract：TFS REST list + 逐文件 read，重算 Digest 与 Schema，额外核对 tasksObjectId。
5. 登记固定 analysis.source、Gate PASS，进入 analysis_review。

目标是 Human 审核通过 Gate 的同一版本，而非证明 TFS REST API 可重复返回同一正文。Commit SHA 绑定 Tree 与 Blob；第 2、3 步已经提供目标所需的证据。第 4 步重复证明 Git 内容完整性，额外耦合 HTTP/PAT/JSON/UTF-8，构成 LEI-64 错误阻断。

### 3.2 最小校验契约（已确认）

Gate 只判断本次交付是否满足继续推进的必要硬条件。每项校验必须对应一个独立、真实的失败风险；同一事实一旦由权威机制证明，不再通过另一条链路重复证明。优先删除校验，而不是用新的校验替换旧校验。

正常首次 Requirement Analysis Publish 只保留三个逻辑检查：

| 最小检查 | 必须证明 | 实现归属 |
|---|---|---|
| Analysis Gate | 当前授权、必要 Facts、Change 身份及工程契约有效，原生 OpenSpec 校验通过 | 现有 evaluateAnalysisGate，仅执行一次 |
| Git 发布 | 候选 Commit 包含本次通过 Gate 的契约，且已发布至正确远端目标分支 | 现有 committedContract / validateTree 与 publishChange 的 Git 可达性证明 |
| 审核登记 | 当前 Issue 仍允许提交审核，固定 source 与 PASS 对应，审核状态登记成功 | 现有 Issue/Metadata 机制 |

上述为三个事实边界，不新增三个 Gate 或固定 Skill 调用链。专业语义由 Agent 判断，不将专业判断改造为机械 Gate。候选版本仅需一次与本次 Gate 契约的一致性检查；已有 Git Tree / Blob 身份能证明的内容不额外计算新摘要。保留当前必要的 Digest 比较以覆盖工作树与候选版本可能不同的风险，不另造摘要协议。

正常流程：真实 Gate → 通过候选一致性检查的 Git Publish → 登记固定 analysis.source、PASS 与审核状态。

**明确删除：** 发布后的 TFS REST 目录读取、逐文件正文读取、远端 Digest、远端 Tasks Blob ID 对账及为这些检查服务的重复本地读取。不得改用 REST HEAD/GET、额外 git show、再次 fetch 或其他等价检查变相恢复同一校验。已由 publishChange 证明的仓库、分支和候选可达性直接消费其结果。不得要求候选等于共享分支最新 HEAD。

**保留必要保障：** 本次真实 Gate（不信任旧 PASS）、候选契约一致性、正确发布目标、Git Push/Fetch 可达性、单 Change 授权范围、并发冲突保护、审核身份/状态和固定来源、独立 Human Approval。不仅凭 Push 退出码宣称成功，不以可变 HEAD 代替固定候选 SHA。现有身份/Facts/状态核验只保留副作用边界必要检查；相同快照上的重复核验按调用链就地合并，不能为追求最少调用而移除跨副作用的必要并发保护，也不扩展为 Metadata 子系统重构。

实施判断：若删除某项校验后，既没有新增未覆盖的真实风险，也没有破坏必要授权、工程质量或审核版本正确性，则删除。正常路径不预执行 validate，不要求 Agent 复核 CLI 已确认结果；异常恢复按实际风险处理，不把恢复检查叠加到正常路径。

### 3.3 恢复、重放及消费边界

- 首次 Requirement 发布：移除 publish.ts 中最终 readPublishedContract / tasksObjectId 对账；以已通过 validateTree 且已确认可达的结果为准，不再重复本地全量校验。
- 有已保存 source 的发布恢复：复用现有 Git fetch、固定 SHA 可达性、当前远端 Change Tree 兼容性及 committedContract，确认 Gate/Facts 一致后才复用；不得把任意旧 Commit 或已变化的 Change 当成本次版本。无需为恢复额外引入 REST 正文通道。
- 已进入 analysis_review 的幂等重放：不重复 Gate、不重新发布；核对已有 PASS、固定来源与 Facts、身份、状态。无需默认逐文件读取正文；若当前分支已有明确来源失效证据则报告，不宣称恢复成功。仅在确实需要诊断时按现有读取能力读取指定 SHA，不要求为重放临时 checkout 根仓。
- 下游 Human/Engineer/Verifier 真正消费固定工程契约时，保留 rondo analysis read、RemoteArtifactReader 及固定 SHA、路径、对象身份、凭据边界等必要验证。读取失败仍如实报告，不回退可变分支或本地未批准内容。
- 非 Requirement 入口仅在确认具备同等 Git 候选一致性与远端可达性证明后复用上述原则；不扩大本次改造范围或削弱其他入口保障。
- 不新增证据文件、摘要 Metadata、Gate 状态、远端验证协议或新 CLI。原有 readPublishedContract 若无实际调用方再清理，不为删除函数而改造其他消费者。

## 4. P0 — 修复真实 UTF-8 缺陷

已核对 [TfsClient.rawRequestOnce](rondo/src/tfs/client.ts) 完整源码：`let data = ''; res.on('data', (c) => (data += c));`。Buffer 隐式转换为字符串会在每个 HTTP Chunk 独立解码，中文多字节跨 Chunk 时产生 U+FFFD；与回放一致。此缺陷不只是 Gate 问题，下游真实远端正文及 TFS JSON 读取仍可能受影响。

最小修复：收集 Buffer 后一次性 UTF-8 解码，或使用 Node 原生 res.setEncoding('utf8') 的流式解码。优先沿用现有 rawRequestBufferOnce 的 Buffer 拼接方式，不增加依赖或通用网络框架。保留现有超时、错误、重试和认证契约。增加跨 Chunk 中文、emoji、多次读取一致性回归；不可通过忽略替换字符、放宽 Digest、避用中文或增加重试掩盖错误。

## 5. P0 — 专业职责与异常处理

Agent 负责业务理解、工程证据、技术决策和真实工程契约；Skill 负责场景方法；CLI 负责确定性校验、执行、事实管理及受控恢复。LEI-64 Analyst 在发布失败后进入 Rondo 安装目录、源码、临时 Node 调试脚本、重复发布，完全超出本次业务专业目标。

[analysis-publish](skills/analysis-publish/SKILL.md) 现有 UNKNOWN 回查/恢复规则已存在，定向简化为：发布失败时修正明确可处理的输入或工程契约问题；工具或外部基础设施异常，记录错误及已完成工作并回流；仅对明确可恢复或结果未知的操作按已有契约确认结果，不进行工具源码排障或盲目循环。保留现有 Comment 回流，避免额外委派、状态机或全局调用次数限制。不在多个 Agent Instructions 重复规则。

## 6. P1 — 首次发布前执行效率

- spec-preparation：当前 Skill 已明确按需而非固定流水线，Review LEI-64 中重复查询 Identity、Schema、Template、历史 Change、status/help 的实际原因，优先复用现有定位和当前原生 Instruction；必要 Schema 来源与工件依赖仍核对。减少无实际价值的重复操作，不新增 OpenSpec 包装命令，不限制专业调查深度。
- analysis-publish：当前独立 validate 已是按需预检查，不再将其视作必经。当前 Requirement publishCommittedChange 明确消费已提交 Change（git log / HEAD / Tree），因此保留一次必要的本地 Commit；不手工 Push，不重复 Commit。删除手工 Commit 或将其自动化不是本次必需，避免改变 Git 发布算法。原生 OpenSpec Strict Validation 由最终 Gate 保证，额外诊断按需。
- codebase-explorer / native-workspace：已存在只读 MCP 按需使用语义；优先复用 Wayfinder 具体定位，按实际仓库可用性选择本地或 Remote MCP，证据充分停止。不强制 CodeGraph、不强制 checkout 子仓；只针对已证实路径混用问题改必要说明，不新增路由器或探测命令。
- 工程方案：聚焦日志缺陷、异常链/必要堆栈、敏感信息风险及前端是否需修改。以真实必要性决定设计、测试和 Spec-level Delta，不设置 Proposal 字数或工具调用硬上限。

## 7. P2 — CLI 使用契约

LEI-64 resolve-identity 使用未知 --output 参数；正确示例现已存在，默认 JSON 即可，不扩展 CLI。publish --root-repo . 与 validate --openspec-root . 语义不同；先核对 native checkout 的绝对路径安全前提，若可安全归一化则统一输入路径，否则仅明确现有示例。与 P0 解耦，不做全局参数体系改造。

## 8. 研发范围与验收

优先修改 publish.ts（必要时 published-source.ts）、tfs/client.ts、直接受影响的回归测试及 analysis-publish Skill；仅在实际证据需要时小幅调整 spec-preparation/codebase-explorer。更新 [03](03-workitem-analysis-design.md) 及 [08b](08b-requirement-remote-git-delivery.md) 中要求候选与远端正文重复核对的描述，使规则由对应权威文档维护。保留既有 Git 发布算法和 Metadata/审批契约。

验收：
- 正常首次 Requirement Publish：仅执行一次真实 Gate；候选一致性检查与 Git 发布可达性证明由现有发布链路完成，直接消费结果。即使 TFS 正文接口模拟损坏或不可用仍可正常发布；不发出冗余正文读取，不新增等价的替代校验。
- 候选 Schema、必要工件或 Evidence Digest 不匹配，目标仓库/分支不符，Git Push 未确认或候选不可达：拒绝审核状态，不写错误 PASS/source。
- 共享目标分支因其他 Change 前进且候选仍可达时允许成功；保持现有冲突/未授权工件保护。
- 恢复/重放幂等、旧源变化/身份/Facts 冲突保护与 Human Approval 精确 SHA 契约不回退；审批后的下游按固定 SHA 读取仍正常。
- HTTP 响应中文/emoji 字节跨 Chunk 不损坏；现有非文本请求、超时/错误与重试不受影响。
- 基础设施异常不引导 Analyst 排障工具内部，不机械重试；回流真实结果。
- 同等复杂度回放：消除 655s 异常排障链，首次 publish 前 614s 作为对照基线；4–6 分钟为优化目标而非硬约束或已验证指标，不能以耗时换取工程质量下降。

本方案不新增 Gate、Agent、Skill、Workflow、Metadata Schema 或机械执行上限；不改 no-change、Bug Fix、TFS Closeout、PR 等无关业务。原方案记录时尚未执行回归或真实 Multica 回放；后续实施状态见 §9。


## 9. 后续增量 — 研发 Change 参数收敛与旧 Task Set 退役

### 9.1 最新实现核对与范围

复核基线：[main a60fbfe](https://github.com/lilei921/winning-platform-rondo/commit/a60fbfee1df4a35f97d5a1734287d42d52804124)。本节依据当前源码、[LEI-49 Engineer 实际执行记录](projects/replay/20261123-LEI-49/engineer/20261121-1443-01a1fcd8/timeline.md#L92-L114) 及当前原生 Issue 交接契约，不将历史回放当作新版本的运行验证。

[PR #67](https://github.com/lilei921/winning-platform-rondo/pull/67) 已合并：§3 Requirement 发布/恢复/审核重放的 REST 正文重复对账已删除（Legacy 路径保留原校验）；§4 HTTP 文本 Buffer 一次性 UTF-8 解码、§5 异常回流、§6 证据/Identity 复用与按需 validate、§7 显式根仓相对路径和全局 `--output json` 已有实现。未完成真实 Multica 回放和耗时目标验证，不把静态核对等同于回归通过。§2–8 保留为 LEI-64 的原始问题、决策及验收依据，不重复实施已合并修复。

当前 [Engineer Instructions](agents/engineer/instructions.md) 仍明确要求 `rondo change update-progress`；[native-workspace](skills/native-workspace/SKILL.md) 仍要求 Requirement prepare 追加 `--change-ref`。Lead 已使用原生 `@mention`，Engineer 消费整个已批准的 Change，不再按 `change_ref + task_refs + engineer_id` 分派 Task Set。Rondo 仍注册旧命令，09 方案也仍保留旧路线兼容设计。此次只收敛尚未修改的研发参数与退役机制，区分活跃命令和旧兼容路径；不改变 Bug Fix、Human Approval、Independent Verify、PR/Closeout 的有效业务能力。

[PR #69](https://github.com/lilei921/winning-platform-rondo/pull/69) 独立处理 Analysis `facts.json` 退役及专业审查字段收敛，本节不重复实施该 PR。Analysis 发布前尚无已批准的 `analysis.source`，需要显式 Change 身份；不要把研发阶段删除重复参数误扩展到 Analysis 阶段。

### 9.2 P0 — 取消独立 Task Progress Patch

[update-progress.ts](rondo/src/commands/change/update-progress.ts) 仅负责本地 `tasks.md` 编号定位、checkbox patch、进程级锁及幂等处理，并不判断任务真正完成。当前单 Engineer 负责整个 Change，原多 Engineer 并发写同一 Tasks 的设计前提已不存在（仍须维持当前 Issue 同一时点不重复有效委派及 Git 发布冲突保护）。保留工程事实，不保留额外进度写入体系。

- Engineer 根据实际研发与验证结果，直接使用原生文件编辑能力更新 `tasks.md` 完成状态，保持已批准任务正文、编号及范围不变；允许随进度更新，不要求一次性批量勾选，不规定工具或固定执行顺序。
- 退役 `rondo change update-progress`、专属 patch-lock 实现及命令注册/Help/专属测试；不新增替代命令、Skill、锁、Metadata 或 Task ID。
- 复用 `dev publish` 的批准契约一致性检查（`normalizeContractText` 允许 checkbox 变化但保留任务正文）与 PR Materialization 内部的 `checkedTaskProgress`（编号、格式、重复、全部完成）及实际 Candidate / Validation / Code Review Gate。不得将 checkbox 当作工程正确性的充分证据，不因去掉 patch 命令放宽发布授权或完成条件。
- Engineer Instructions 建议改为：“根据实际研发与验证结果更新 `tasks.md` 的完成状态，保持已批准的任务内容不变。提交研发工件并使用 `rondo dev publish --root-repo <实际根仓路径>` 发布；非实质性 Design 细化时使用 `--minor-design`。” 其他专业职责不变。

### 9.3 P0 — 以 Issue 为研发入口，消除重复 Change 参数

当前 [COMMANDS.md](rondo/COMMANDS.md) 和 [index.ts](rondo/src/index.ts) 确认以下 9 个命令接受 `--change-ref`：

| 命令 | 当前用途 | 目标 |
|---|---|---|
| change resolve-identity | Analysis Change 定位/恢复 | 保留可选参数及 TFS ID 定位 |
| change update-progress | 本地 Tasks checkbox patch | 删除，见 §9.2 |
| dev materialize | 旧派发物化 | P1 退役 |
| dev check-dispatch | 旧派发核验 | P1 退役 |
| dev check-completion | 旧 Task Set / Evidence 完成校验 | P1 退役 |
| dev contract-hash | 旧 Evidence 契约哈希 | P1 核实消费者后退役 |
| dev prepare | 研发业务仓准备 | 删除重复 `--change-ref` |
| dev publish | 研发工件发布 | 删除重复 `--change-ref` |
| dev check-change | 独立 Change 完成校验 | 删除独立入口，保留内部 Gate |

已批准的 Change 使用 Issue 中固定的 `analysis.source`；[requirement-guard.ts](rondo/src/commands/dev/requirement-guard.ts) 已读取该来源并检查 Human Approval、Actor/Run、Scope 等事实。无需 Agent 再获取、传递同一个 Change ID。

目标命令（保持现有其他必要参数）：

```text
rondo dev prepare --workspace native --issue <KEY> --repo <repo_id> --root-repo <root> --resource-ref <ref>
rondo dev publish --issue <KEY> --root-repo <root> [--minor-design]
rondo pr materialize --issue <KEY>
```

- `dev prepare` 的 Requirement / Bug 分流仍依据权威 Work Item 类型；已有远端 Candidate 时按现有契约可省略 resource-ref。仍有效的其他 prepare 入口同步收敛，不另造兼容分流；旧入口是否退役按 §9.4 实际消费者核实。
- `approvedChange`、`guardRepository` 等内部实现直接消费解析出的 source.change_ref，保持当前有效批准、授权、仓库映射、固定 SHA、状态及跨副作用来源变化保护；不以省参数为由取消一致性检查，不因重读得到另一个 Change 而静默继续执行。
- `dev publish` 消费同一获批来源定位工件及登记现有 dev.publication，保留候选契约验证和远端发布回读。§3 的 Analysis REST 去重不自动推广至研发发布。
- `pr materialize` 已内部调用 [checkPublishedChange](rondo/src/commands/dev/change-completion.ts)（[调用点](rondo/src/commands/pr/materialize.ts#L158)）；移除 `dev check-change` CLI 包装层及重复前置调用，不删内部检查或改变 PR 创建条件。实际消费者须核实后迁移，不新增另一个独立 Gate。
- 同步 native-workspace、COMMANDS、CLI Help 及受影响回归测试。保留 `change resolve-identity` 的可选显式 Change ID；PR #69 的 Analysis validate/publish 输入不在本节删除范围内。

### 9.4 P1 — 旧 Task Set 机制彻底退役

以下仍存在于 main，但不属于原生 Issue 整体 Change 研发链路。以旧 Backend/Frontend Engineer Task Set 路线确认不再使用为实施前提；先核实 workspace provisioning、在途 Issue、生产入口和实际消费者。如仍有真实使用或在途交付，明确报告并限定退役范围，不静默破坏其运行。不为假想兼容场景长期维护双路线。

| 旧入口/模块 | 处理 |
|---|---|
| dev materialize / materialize.ts | 删除独立派发物化 |
| dev check-dispatch / check-dispatch.ts | 删除旧派发预检 |
| dev check-completion / check-completion.ts | 删除旧 Task Set Evidence 校验 |
| dev contract-hash / contract-hash.ts | 核实无当前消费者后删除旧哈希入口及专属逻辑 |
| dev/dispatch-entry.ts、dev/dispatch-facts.ts | 删除旧派发专属数据契约及逻辑 |
| tfs materialize-tasks、tfs resolve-tasks | 删除基于 dev.dispatch 的旧入口及专属实现 |
| delivery route-decision | 清理 ENGINEERING 的 affected-task-refs / dispatch 恢复分支；其他有效决策能力逐项核实保留 |

- 清理 `dev.dispatch`、`dispatch_key`、Task Set Owner、`task_refs` 的派发语义及旧 Evidence 依赖；现有 verify-decision、analysis approve/publish、requirement-mode、PR 等模块中对旧派发的兼容分支/冲突保护仅在确认旧数据及有效调用不再依赖后清理，不能误删新路线授权或回流机制。
- 保留 [contract-files.ts](rondo/src/commands/delivery/contract-files.ts) 中当前 dev publish / PR Gate 使用的 normalizeContractText 等共享能力；旧 hash 函数按真实调用关系裁剪。
- 保留 OpenSpec 原生任务编号、checkbox、TFS Closeout 的 source_refs、实际 Commit 关联、任务规划与 writeback；不是删除所有包含 task_refs 字样的代码。TFS 子任务收口流程继续使用现有 delivery finalize / tfs writeback，不引入新的派发层。
- 对照 agents/backend-engineer、agents/frontend-engineer、agents/README、workspace provisioning 与 squads 确认退役范围；只删除不再使用的 Agent/配置，不修改无关角色。同步 01/02/04/05/09/15 及实际引用的当前设计文档，删除双路线与 Patch Lock 活跃契约；archive、历史回放与历史验证证据不重写。
- 清理 CLI 注册、Help、COMMANDS、专属测试和已失效兼容描述；共享测试中仍覆盖有效行为的断言迁移至当前入口，不通过整体删除测试规避回归。

### 9.5 暂不处理

保留内部 Change 身份。现有 `analysis.change_ref` 与 `analysis.source.change_ref` 重复存储值得后续评估，但当前 Analysis Validation / Approval、Closeout、TFS Writeback 仍依赖前者，本次不重构 Metadata，不迁移历史字段。保留固定来源及 `finalize.pending.prepared_change_ref` 归档完成事实；不新增 Change ID、事实文件、流程状态或替代派发机制。

### 9.6 增量验收

- Requirement 正常路径：原生 @Engineer 交接；依据 Issue 读取已批准工件、准备业务仓、研发与验证、直接编辑 Tasks、提交及发布研发工件、PR Prepare/Materialization。研发命令无需显式 change-ref；Publish 与 PR Prepare 无人为固定先后顺序。
- Tasks checkbox 可正常发布；任务正文/编号/范围漂移被拒绝；未完成任务、重复编号、非法 checkbox、缺失或失效 Candidate / Validation / Review 仍阻止 PR Materialization；不得创建无实际代码 Candidate 的 PR。
- Issue/Run/审批来源错误、Repository Scope 越权、发布期间来源变化、Git 冲突或错误目标仍按原契约拒绝；Bug Fix 原路径不引入 OpenSpec 参数或 Gate。
- 退役入口不再出现在 CLI Help / COMMANDS / 活跃 Agent 或 Skill；保留的内部 Gate、共享归一化逻辑、Human Approval、Independent Verify 安全边界、PR 状态同步与 TFS 归档写回通过回归。
- 以实际调用图及引用搜索确认无旧机制的未处理活跃消费者，运行 Rondo build/test；必要时验证实际 Multica Requirement 与 Bug Fix 回放。分别记录已验证事实和未执行项，不以方案保存视为实施完成。

本节是后续未实施事项的独立增量，P0 与 P1 可分别实施和审核；不重新实施 PR #67 已合并内容，不吞并 PR #69，不进行无关全局 CLI 或 Metadata 重构。
