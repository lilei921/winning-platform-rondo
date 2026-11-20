# 单一 TFS MCP 的 PR 关键事件验证与分析方案

## 1. 本轮结论

2026-09-24 **重新调用** `winning-tfs-2018-mcp.tfs_get_pull_request` 查询 2640、2946、2928。本轮不使用其他 PR provider，也不复用旧查询作为当前事实。

该接口能够提供 [Multica v1.3.5](../../archive/multica-squad-centric-delivery-v1.3.5.md) §17–§24 所需的主要 PR 快照输入。**当前样本分别支持普通等待、完成、弃用的判定；本轮没有 active 且拒绝的实时样本，Reject 分支仅通过官方票值定义和合成用例验证。**

已执行 **32 项离线候选规则检查，全部通过**：3 项新查询快照、16 项合成单 PR 边界、7 项合成聚合、6 项合成 Gate。结果见 [validation-results.json](validation-results.json)。这不是生产同步器或 Multica 端到端验收。

本轮仅进行 TFS 读取和根仓验证资料更新；未修改 PR、发评论、修改 Multica Issue、切换业务仓分支或修改 v1.3.5 原文。

## 2. 新查询快照


| 数据文件                         | status    | reviewers | mergeStatus                | 事件判定                  |
| ---------------------------- | --------- | --------- | -------------------------- | --------------------- |
| [pr-2640.json](pr-2640.json) | active    | []        | succeeded，且有 mergeCommitId | NO_OP，继续等待            |
| [pr-2946.json](pr-2946.json) | completed | []        | succeeded，且有 mergeCommitId | SUCCESS               |
| [pr-2928.json](pr-2928.json) | abandoned | vote=-10  | 未返回                        | EXCEPTIONAL_STOP，终态优先 |


三次查询于 **2026-09-24 02:19:15 UTC（北京时间 10:19:15）** 返回；独立请求不是跨 PR 的原子快照。各文件顶层就是工具返回的 PR 对象，保持原字段和值，仅做 JSON 解析和格式化。这是 MCP payload，不是未经工具加工的 TFS HTTP 响应。

[manifest.json](manifest.json) 记录工具名、调用参数、请求开始/返回时间、文件 SHA-256、方案摘要和本轮验证范围。2946、2928 的 payload 与之前保留的同名快照一致，但两者均已重新查询，不能将“值未变”理解为“未查询”。

三个 PR 只确认属于同一仓库；没有证据表明属于同一个 Delivery，禁止直接将三者组合写成真实 required PR 集合。

## 3. 本轮确认的技术事实



### 3.1 合并过程成功不等于 PR 已完成

2640 当前 `status=active`，同时：

- `mergeStatus=succeeded`
- `mergeCommitId=972a7f73e928122c6bb39b89be7abe2d463c6cf0`
- 没有 completedDate

因此不能用 mergeStatus、mergeCommitId 或 mergeCommitMessage 判断交付已完成。完成事实必须来自 `status=completed`；2640 当前应保持 NO_OP。

2946 的 `status=completed` 且 reviewers=[]，表明完成事件也不能依赖“至少有人批准”的额外推断。

### 3.2 弃用终态优先于拒绝票

2928 的 `status=abandoned`，reviewer.vote=-10。按照 v1.3.5 的终态优先原则，应进入 Exceptional Stop，交人工决定后续动作；不能先进入普通 Reject 回流，也不能直接取消整个需求。

### 3.3 voteDescription 的错误仍存在

2928 同时返回 `vote=-10` 与 `voteDescription=未投票`。Microsoft 定义中 -10 表示 Rejected，0 才是 No vote。当前工具的显示描述不可靠，同步器应读取数值 vote，原始 JSON 则保留错误描述用于复核。[TFS API 4.1 投票定义](https://learn.microsoft.com/he-il/rest/api/azure/devops/git/pull-requests/get-pull-request?view=vsts-rest-tfs-4.1#identityrefwithvote)

本轮没有 active + -10 的实时样本；2928 只能证明“弃用优先于拒绝票”，不能算作 Reject 回流的线上覆盖。

### 3.4 completedDate 需要结合状态解释


| PR   | status    | completedDate                | 可使用的含义             |
| ---- | --------- | ---------------------------- | ------------------ |
| 2946 | completed | 2026-09-02T05:25:01.5956547Z | provider 报告的完成时间   |
| 2928 | abandoned | 2026-09-01T07:07:37.4083073Z | provider 报告的弃用关闭时间 |


不得看到 completedDate 就设置 merged_at。API 的 closedDate 本身覆盖完成、弃用等关闭情况；当前 wrapper 是否直接由该字段改名而来，尚未检查工具实现。[TFS API 4.1 PR 字段定义](https://learn.microsoft.com/he-il/rest/api/azure/devops/git/pull-requests/get-pull-request?view=vsts-rest-tfs-4.1#gitpullrequest)

工具没有返回投票发生时间。拒绝发生时间应保持未知；如需记录首次发现拒绝，用 rejection_observed_at，不冒充 rejected_at。

### 3.5 PR 快照无法反查完整 Delivery

三份 workItems 均为 []。这是本工具的返回事实，不宣称已经穷尽 TFS 的所有关联关系；标题/描述中的工作项编号也不能替代正式关系。Multica Issue、required PR 清单、Verify 证据和 Blocker 必须从相应事实来源获取。

## 4. 单一 provider 的采集与字段映射

固定调用工具：`winning-tfs-2018-mcp.tfs_get_pull_request`。


| 参数            | 本次值                                  |
| ------------- | ------------------------------------ |
| project       | DP-03-数据采集管理软件                       |
| repositoryId  | 9ebb3230-ca29-4a0c-a456-447623a9ccf4 |
| pullRequestId | 2640 / 2946 / 2928                   |


生产中按每个 PR 登记的项目与仓库传齐三个参数，不依赖默认仓库。当前 Collection 为 WN_Data_Platform，工具不接收 collection 参数；跨 Collection 时需另行确认 provider 配置和路由。


| 返回字段                                        | 归一化含义              | 处理约束                                        |
| ------------------------------------------- | ------------------ | ------------------------------------------- |
| pullRequestId、repository.id、project.id/name | PR 稳定身份            | 与请求和登记映射核对，不用标题匹配                           |
| sourceBranch / targetBranch                 | 源/目标分支             | 本工具样本不含 refs/heads/ 前缀；保留完整分支名              |
| status                                      | provider_status    | 当前接受 active/completed/abandoned，其他值 UNKNOWN |
| reviewers[].id + vote                       | 当前审核票              | 不依赖 voteDescription；仅 active 分支需要票数据        |
| completedDate                               | provider_closed_at | 按 status 决定是完成还是弃用，不无条件映射 merged_at         |
| mergeStatus / mergeCommitId                 | 辅助证据               | 不替代 status                                  |
| url                                         | pr_url             | 保存工具返回值                                     |
| 本地采集时间                                      | observed_at        | 不等同于事件发生时间                                  |


原始数据与内部派生字段分开。若内部沿用方案的 merged 值，显式定义 `completed → merged` 并保留 provider_status。不要引入其他 provider 的数字映射。

接口失败、身份不匹配、字段结构异常、分支与登记信息不一致时，记录 UNKNOWN，不冒充 NO_OP。源/目标分支变化需核实映射后重试；不能静默覆盖原目标分支。时间字段可在分类时缺省，但若 Gate 要求该证据，则缺失时阻断 Gate。

## 5. 确定性判定规则

第一版候选 Reject 策略：**active 且当前可信 reviewer 列表任一 vote=-10，即 REWORK**。这是候选团队策略，不是已批准的生产配置。当前快照不足以区分必选/可选 reviewer、投票历史或是否已审过最新提交；若需要这些保证，需增加 reviewer 策略和额外取数能力。

单 PR 判定：

1. 校验 PR/仓库/项目身份、状态及分支结构；错误 → UNKNOWN。
2. abandoned → EXCEPTIONAL_STOP，不受 reviewer 票影响。
3. completed → SUCCESS，不受历史拒绝票影响。
4. active 要求 reviewers 为可信数组；缺失/null/错误结构 → UNKNOWN。
5. active 的票值必须为整数 10、5、0、-5、-10，reviewer 必须有身份；未知值或错误类型 → UNKNOWN。
6. 可信数组中有 -10 → REWORK；否则，包括可信空数组 → NO_OP。

普通 10/5/0/-5 不触发关键事件。仅凭 mergeStatus=rejectedByPolicy 不能等同于 reviewer Reject。本 provider 未返回字符串 closed/merged；若未来出现，需要明确适配，当前规则先返回 UNKNOWN。

required PR 聚合：

1. 集合未定义、未完整解析或为空：不得成功；无需 PR 的任务应有独立显式决策。
2. 有已确认 EXCEPTIONAL_STOP → Exceptional Stop。
3. 否则有已确认 REWORK → Rework。
4. 否则有 UNKNOWN → UNKNOWN；不得因其他 PR 已完成而忽略失败查询。
5. 全部 SUCCESS → Completion 信号。
6. 其余 → NO_OP。

已知异常可先阻断交付，但不能因此声称未知 PR 已查明。PR Completion 只是唤醒信号；Gate 还需 required Verify PASS、无 unresolved blocker，并确保当前交付轮次已满足 Human Gate。

本轮三份样本假设组合时为 Exceptional Stop；该组合只是离线测试，不代表真实 Delivery 关系。

## 6. 通知与恢复方案

沿用 Multica Issue Metadata 保存所需事实，不引入独立 workflow runtime：

- 身份与范围：collection/project/repository/PR ID、source/target branch、owner issue、required PR 清单。
- 交付轮次：delivery_round、required 集合版本；重建 PR 时显式替换旧 required PR 并保留审计记录。
- 当前观测：status、reviewer ID/vote、observed_at、provider_closed_at。
- 事件和通知：稳定 event_key、pending/sent、comment_id、notified_at、原负责人。

正常扫描 in_review；另行恢复已记录的 pending 动作/通知，即使 Issue 已被上一次动作置为 blocked。否则会产生“状态已改但通知未发，后续不再扫描”的断点。

Reject/Abandon 路径：保存事实与原负责人一次 → 设置 Squad/blocked → 发送说明性 Comment → 等待 Human。重试不得覆盖原负责人。blocked 期间即便外部 PR 完成，也不自动绕过人工决定；明确的 Human 回流负责恢复流程。

通知采用稳定 event_key，至少区分 owner issue、交付轮次、required 集合版本、事件类型和 PR 身份。同一事件重试复用标识；新返工轮次产生新标识。

发送恢复流程：pending → 幂等更新必要状态 → 查询同事件 Comment → 缺失才发送 → 保存 comment_id/sent。必须先确认 Multica 的评论查询、稳定关联标识和并发控制能力；若发送结果未知又无法确认，应保留 pending/UNKNOWN 并人工核验，不能盲目重发。

单个 notified_at 无法保证恰好一次；需要按 Issue 串行或平台支持的条件更新。若发送评论会立即唤醒 Lead，还需在实际集成中验证事件事实、Issue 状态和唤醒时序。当前没有验证这些平台能力，不假定已有原子事务。

## 7. 本轮验证结果与边界


| 类型        | 数量  | 验证内容                                                                             |
| --------- | --- | -------------------------------------------------------------------------------- |
| 新查询快照     | 3   | active 空 reviewer → NO_OP；completed → SUCCESS；abandoned + -10 → Exceptional Stop |
| 合成单 PR 边界 | 16  | active Reject/普通票、终态优先、缺 reviewer、错误票类型、未知状态、身份与分支缺失                             |
| 合成聚合      | 7   | 多种事件优先级、全部完成、部分未知、空 required 集合                                                  |
| 合成 Gate   | 6   | 全通过、Verify 失败、有 Blocker、空集合、未知 PR、缺 Verify 证据                                    |
| 合计        | 32  | 全部通过                                                                             |


本轮在会话 JavaScript 中实际执行候选函数及断言，输入、预期和实际结果保存于 [validation-results.json](validation-results.json)。合成用例独立保存，未修改原始 JSON 伪装现场覆盖。

已验证：调用成功、字段可用性、三份新快照的候选分类、规则边界、JSON 与新返回 payload 一致、文件摘要和本地引用一致。

尚未验证：生产 pr-status-sync 实现、评论幂等/并发/超时恢复、真实 Human 回流、Squad 唤醒、真实 Verify/Blocker、真实跨仓 required PR 集合、Git 对齐、TFS 更新或归档。不得将 32 项通过解释为整条交付流程可上线。

## 8. 落地步骤与原方案修订建议


| 步骤                  | 实施内容                                      | 验收标准                            |
| ------------------- | ----------------------------------------- | ------------------------------- |
| 1. 固定接口             | pr-status-sync 统一调用本工具，传齐参数并核对身份          | 不混合 provider，失败/缺字段有 UNKNOWN 路径 |
| 2. 实现纯规则            | 单 PR 分类、required 集合聚合、Gate 输入校验           | 使用当前三份 JSON 与标明来源的合成边界用例        |
| 3. 确定团队策略           | reviewer 范围、最新提交有效性要求、交付轮次、替代 PR          | 明确 Reject 与重新审核语义               |
| 4. 实现可恢复通知          | event_key、pending/sent、评论查重、负责人/状态恢复      | 重复轮询、发送前后崩溃、并发与未知结果可控           |
| 5. 集成 Delivery Gate | 独立 Verify、Blocker、Human 决策及工作区检查          | 任一必要证据未知时不误关单                   |
| 6. 授权环境联调           | 等待、Reject、Abandon、Complete 和 Sub-Issue 回流 | 补齐本轮缺少的实时 Reject 与完整通知链路覆盖      |


对 v1.3.5：§17 增加稳定身份、来源时间和轮次；§18 明确票值策略、终态优先和 UNKNOWN；§18.4 补充通知恢复与 pending 扫描；§19 校验 required 集合完整性和无需 PR 的显式决策；§20–§21 保留 Git 与父子 Issue 回流的独立验证。

上述为分析建议，本轮未修改原方案和共享 contract。结论是单一 provider 的快照字段可支撑候选规则，实际交付闭环仍需按以上步骤实现和验收。