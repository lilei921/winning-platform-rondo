# LEI-67 / LEI-68 Engineer 执行效率最小充分优化方案

> 日期：2026-11-26；状态：P0-1、P0-2 已实施，待完整项目测试与真实环境复测；其余事项待审核实施。
> 范围：Engineer 的 Requirement 研发交付，以两次 Replay 为依据。遵循 01 设计原则：Native First、KISS、YAGNI、One Rule One Owner、Specialist Focus、Minimal Sufficient。
> 本方案不替代已保存的 [LEI-68 豁免与 PR 登记流程根治方案](./LEI-68-豁免与PR登记流程根治方案.md)；该问题在其专项方案中统一实施，避免重复 PR 和规则 Owner。

## 1. 事实与耗时

依据 [LEI-67 Replay](../../projects/replay/20261126-LEI-67/replay.md)、[LEI-68 Replay](../../projects/replay/20261126-LEI-68/replay.md) 及其 Engineer replay.json、evidence/runs.json。

| 阶段 | LEI-67 | LEI-68 |
| --- | ---: | ---: |
| Run 累计时间（排除全部 Run 间隔） | 73:09 | 58:12 |
| 工具调用 | 278 | 258 |
| 初始调查及实现 | 5:09 | 14:22 |
| 构建、测试与修复 | 48:03 | 19:58 |
| API 429 及失败 Run | 8:13 | — |
| Commit、发布、Checkout 身份处理 | 7:33 | — |
| 契约调查、最终测试、Git | — | 3:45 |
| Tasks、Evidence、Completion、Publish | — | 6:08 |
| PR 准备、物化及回帖 | 4:11 | 7:41 |
| 后续豁免及 PR 登记返工 | — | 6:18 |

统计按公开事件划分互斥窗口，不代表纯 LLM 或 CPU 时间。LEI-67 导出核验 PARTIAL；LEI-68 另一次失败 Run 无开始时间，不计入累计。不能把全部失败 Run 或构建耗时视为浪费。

主要根因：构建环境及等待策略不稳定；Native Checkout 归属错误绑定当前 Run ID；新旧 Completion 契约并存；Human 豁免和 PR 登记恢复不完整。

## 2. 优先级与最小实施范围

| 优先级 | 事项 | Owner |
| --- | --- | --- |
| P0-1 | 修复 Native Checkout 合法续跑 | Rondo CLI、native-workspace Skill |
| P0-2 | 收敛旧式 Completion 契约 | Rondo CLI |
| P0-3 | 稳定 Maven / pnpm 验证环境 | 业务仓、Runtime |
| P0-4 | Human 豁免、PR 物化与登记恢复 | 专项方案 Owner |
| P1-1 | Engineer Instructions 局部修订 | Engineer |
| P1-2 | 避免同一 Candidate 重复最终验证 | pull-request Skill、CLI |
| P2 | Provider 配额异常、CLI 局部性能 | Runtime / CLI（按证据） |

## 3. P0-1：Native Checkout 合法续跑

### 3.1 事实

LEI-67：首次 Run 01a21561-ef2e-7058-b921-9bf5ab105abc，最终 Run 01a21665-29de-7550-a865-fe2ca8919923；两者 Issue、Engineer、Workspace、Runtime、Session 与绝对 work_dir 相同。分支 agent/engineer/9bf5ab105abc 继续存在，但 CLI 要求尾号 fe2ca8919923。14:09:25 发布失败，14:13:01 推送再次失败，最终 Engineer 为满足校验手工创建新分支。

LEI-68：首次 Run 01a216af-40cd-7d7c-8122-379c00c48b95，续跑 Run 01a216f4-2fcc-7d84-b09d-fba7467c7696；同一 Issue、Engineer、Workspace、Runtime、Session 与绝对 work_dir。16:25:35 发布失败，16:26:42 --fresh 重新 Checkout，随后再次修改 Tasks 并提交。此类恢复不是常规交付必要步骤。

当前 assertNativeTaskCheckout() 将 branch suffix 与当前 MULTICA_TASK_ID 绑定，assertPlatformCheckoutIdentity() 也要求 manifest task_id 与当前 Run 一致。Multica 保留工作目录和分支，而 Run ID 改变，二者契约冲突。

### 3.2 最小规则：直接删除重复身份校验

Multica 是 Native Checkout 的创建、隔离、复用和生命周期管理 Owner。Rondo 消费平台已经提供的工作区，不再根据 Checkout 的创建 Run、分支尾号或历史 Run 推断其归属。当前 Run 的执行授权与 Checkout 创建 Run 无需相同。

直接删除普通 Native Checkout 校验中的两条错误前提：
- 本地 agent/ 分支尾号必须等于当前 MULTICA_TASK_ID 的尾号。
- 平台 Checkout manifest 的 task_id 必须等于当前 MULTICA_TASK_ID。

保留现有 daemon 管理上下文、Issue/Agent 身份（已有调用方提供时）、路径及 Git 根目录检查、已有 isolated mode / manifest workspace 一致性、实际 HEAD 与平台返回分支或 manifest 分支的一致性。保留各具体操作已有的当前 Run 授权、Origin/Push URL、批准 Commit、Repository Scope、Candidate 与发布契约检查。分支格式识别仅用于现有 Native/Legacy 路径区分，不作为 Run 归属判断。

正常首次执行和续跑采用同一规则；不新增历史 Run 查询、续跑分支、Run 归属证明、缓存、额外 work_dir 字段契约或 Metadata。Multica 保留的 Checkout 直接复用，包括原分支、dirty 修改、未推送 Commit 与构建产物。

### 3.3 最小代码改动

- rondo/src/clients/native-checkout.ts：修改 assertNativeTaskCheckout()，不再调用含当前 Task ID / 分支尾号绑定的 assertPlatformCheckoutIdentity() 来判定普通 Native Checkout；以现有必要检查替代其中剩余的 isolated mode、workspace 一致性约束。不要伪造当前 Task ID 作为 Checkout 创建身份。保留实际分支一致性检查。该公共入口的全部调用方自然获得正确的复用语义，不增加 Engineer 专用续跑策略或参数传递链。
- Closeout：assertPlatformCheckoutIdentity() 仍有独立消费者，本次保留其现有 Task 级契约；不改归档分支算法。若后续真实回放证明存在同类冲突，再单独收敛。普通 Native Checkout 的共享校验改动也会影响调用它的 Bug 等场景，因此补必要回归，而非增加场景开关。
- skills/native-workspace/SKILL.md：将复用表述改为“优先复用 Multica 已有的 Checkout，保留工作树及已有研发成果。”不解释 CLI 内部算法，不新增操作步骤。
- 现有测试：首次 Run、同一工作区换 Run ID 后旧分支/旧 manifest task_id 仍可用、根仓及业务仓复用、dirty/WIP/未推送提交保留、dev publish/git push/pr prepare 正常续跑；现有不合法 daemon 上下文、Issue/Agent 不一致、workspace/branch manifest 冲突、路径越界、Git/Origin 错误仍拒绝；Closeout 现有行为不变。

不修改各调用方的 Run 查询及授权契约，不引入新命令、Workspace Manager、Owner Marker、Registry、分支命名算法或自动 reset/clean/fresh。不新增历史 Run 读取；原方案的活跃 Run work_dir 字段验证不再是实施依赖。真实验收使用 LEI-67/68 同类场景，不要求重放已完成的生产 Issue。

## 4. P0-2：收敛 Development Completion

正常 Requirement 的权威事实：tasks.md（实际完成状态及合法豁免）、dev.publication（已发布研发 Commit）、pr_prep（Candidate 级真实验证与专业 Review）。保留 pr materialize 的 checkPublishedChange()，不另设 Completion Gate。

Engineer 可直接更新 tasks.md checkbox，dev publish 继续校验批准内容不被篡改；不恢复旧 change update-progress 入口。核实全部消费者及在途依赖后退役 dev check-completion、dev contract-hash 和无人使用的旧实现。正常交付不新增 evidence.json、validation/commands.md、validation/review.md、独立 PR Description 文件。PR 专业 Facts 通过现有 pr prepare 临时输入传递。不要删除现有发布契约校验或必需的收口事实。专项豁免方案需同步以当前存活的 Completion 检查为唯一 Owner，避免对待退役检查追加逻辑。

## 5. P0-3：工程验证环境

优先治理 dataintegration / dataintegration-web 的现有项目配置和验证入口：Maven 定向构建、实际依赖状态决定 -am、处理损坏 class/JaCoCo 中间产物、正确传递退出码；长命令使用 Runtime 原生任务管理，避免多重等待和同一工作树边构建边修改。前端固定兼容 Node/pnpm、统一内网 registry，安装和测试分离，复用 pnpm Store，按项目既有格式配置进行最小差异验证。不要将 clean、skip JaCoCo、skip Spotless 或固定命令模板强制推广到所有项目；不增加通用构建系统或新 Agent/Skill。

## 6. P0-4：Human 豁免与 PR 恢复

由 LEI-68 专项方案承接：批准事实中的合法 task waiver 与已完成任务共同满足交付，未执行任务保持未勾选；PR 事实可追溯、幂等登记，已合并或源分支删除时按真实 PR Candidate 身份核实恢复。current_pr 登记未确认不宣告正常交付成功。不新增重复恢复入口或绕过授权。具体实现与专项方案统一审核，不在本方案中重复建设。

## 7. P1 / P2

- P1-1：Engineer Instructions 只补准确的 analysis read 参数示例、工程证据充分即可实施、长耗时验证保持对象及结果可信；不再增加固定操作链。
- P1-2：保留 pr prepare 的 Candidate 最终真实验证；移除形式化重复 Completion。同一 Candidate 重复 Prepare 如已有 CLI 可信验证事实，可在命令与执行条件一致、授权有效、无影响验证的修改时评估最小复用；不新增 Evidence Store，不接受单纯自报 PASS。
- P2：明确配额耗尽由 Runtime/Provider 终止或回退；根据测量合并单命令内重复读取的固定事实，不建跨 Run 缓存。

## 8. 验收及边界

保持授权、批准版本、仓库边界、真实测试、Review、PR 登记与归档质量。按 Run 累计时间排除人工等待；比较工具调用量、构建次数、续跑成功率、PR 准备与物化错误。LEI-67 同类任务目标 20–30 分钟，LEI-68 同类任务目标 15–25 分钟；仅为复测目标，不承诺收益或强制时限。P0-1 优先验证两个复现场景不再要求人工改分支或 --fresh，不丢失任何研发成果。P0-1、P0-2 已提交（2c75771、434f05b）。隔离验收：从 PR 分支复现并核对 Git blob SHA 的 contract-files.ts 与其单元测试，5/5 PASS；使用同一版本 native-checkout.ts 与真实 Git（独立测试使用 spawnSync 替代 execa 传输层），普通 checkout、linked worktree 两组续跑与边界 smoke test 2/2 PASS。完整 npm run build / npm test、真实 Multica Runtime 与新 CLI 发布尚未验证。其余优化事项仍为方案。
