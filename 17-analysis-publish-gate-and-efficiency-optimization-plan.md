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

核心决策：首次 Requirement Analysis Publish 使用 Git 原生的固定 Commit 及远端分支可达性证明发布结果，不再用 TFS REST API 逐文件回读正文、重复计算 Digest。保留真实 Analysis Gate、候选工程契约一致性、授权、并发保护、固定来源、Human Approval。此次仅保存方案，不实施代码或 Skill 改造。

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

### 3.2 最小充分契约

| 必须证明的事实 | 唯一权威 |
|---|---|
| 当前 Issue/授权/专业 Facts 合法，Change 符合契约 | 本次 Analysis Gate |
| 最终候选的工程契约与 Gate 一致（含必要 Evidence） | committedContract + validateTree |
| 目标仓库、分支正确，候选已发布 | publishChange 的 Git Fetch/可达性证明 |
| 审核指向固定版本 | analysis.source（repo_url、branch、commit、change_ref） |
| 审核事实、身份、状态未被并发覆盖 | 现有 Issue/Metadata 写入前后核对 |

正常流程：真实 Gate → 候选 Git Tree 一致性 → Git Push/Fetch 验证可达 → 固定 source、Gate PASS、审核状态。无需 REST 正文回读、远端 Digest 或单独 tasks Blob ID 对账。不以 push 退出码单独证明成功，不以可变 HEAD 替代候选 SHA，不要求候选等于共享分支最新 HEAD。保留并发安全、只发布当前 Change、禁止未授权文件、Schema/身份校验及 EOL 归一化。不得删除真实 Gate 或仅信任旧 PASS。

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
- 正常首次 Requirement Publish：Git 候选通过真实 Gate，远端目标分支可达，即使 TFS 正文接口模拟损坏或不可用仍可正常发布；不发出冗余正文读取。
- 候选 Schema、必要工件或 Evidence Digest 不匹配，目标仓库/分支不符，Git Push 未确认或候选不可达：拒绝审核状态，不写错误 PASS/source。
- 共享目标分支因其他 Change 前进且候选仍可达时允许成功；保持现有冲突/未授权工件保护。
- 恢复/重放幂等、旧源变化/身份/Facts 冲突保护与 Human Approval 精确 SHA 契约不回退；审批后的下游按固定 SHA 读取仍正常。
- HTTP 响应中文/emoji 字节跨 Chunk 不损坏；现有非文本请求、超时/错误与重试不受影响。
- 基础设施异常不引导 Analyst 排障工具内部，不机械重试；回流真实结果。
- 同等复杂度回放：消除 655s 异常排障链，首次 publish 前 614s 作为对照基线；4–6 分钟为优化目标而非硬约束或已验证指标，不能以耗时换取工程质量下降。

本方案不新增 Gate、Agent、Skill、Workflow、Metadata Schema 或机械执行上限；不改 no-change、Bug Fix、TFS Closeout、PR 等无关业务。本次只保存方案，未执行回归或真实 Multica 回放。
