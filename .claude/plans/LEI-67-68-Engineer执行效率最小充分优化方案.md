# LEI-67 / LEI-68 Engineer 执行效率最小充分优化方案

> 日期：2026-11-26；状态：设计方案，待审核、实施及真实环境复测。
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

### 3.2 目标与最小规则

当前 Run 用于证明本次写入授权；平台管理的工作目录用于证明 Checkout 归属。Checkout 创建者可以是同一 Issue / Agent / Workspace / Runtime / work_dir 的较早 Run。分支尾号用于识别 Checkout 创建 Run，不代表当前执行授权。继续复用原工作树、分支、dirty 修改、未推送 Commit 以及构建产物；不改变远端 Candidate 或 PR Target 规则。

优先复用已有 assertEngineerExecution() 的活跃 Run 查询结果，检查当前 Run 属于该 Issue、Agent、Workspace，并以平台提供的绝对 work_dir 和 daemon_task_context.json 核对实际 workdir（规范化真实路径，Windows 不区分大小写）。不能以传入 root 的 dirname 自证归属。

对 Engineer Requirement 的 Native Checkout：
- 保留当前 Run 的合法授权、daemon 管理标记、Issue/Agent 身份、路径边界、非 symlink、Git 根目录、仓库 Origin/Push URL、批准 Commit 与 Repository Scope、Candidate 安全及现有发布契约。
- 保留平台 agent/ 分支形态、明确的 isolated mode 与已有 manifest 的内部一致性检查；平台 Checkout 输出的分支应与实际 HEAD 一致。
- 当前分支尾号匹配当前 Run 时走现有正常校验。
- 尾号不匹配或 manifest task_id 指向旧 Run 时，仅在同一 Issue 的平台 Run 记录能证实 Checkout 创建 Run 与当前 Run 属于同一 Agent、Workspace、Runtime、规范化绝对 work_dir 时允许复用；旧 Run 不必仍活跃。manifest 存在时核对其 task_id、workspace_id、checkout_branch；缺失时用唯一匹配旧 Run 的分支尾号及可信 workdir 事实。拒绝跨 Issue/Agent/Workspace/Runtime/workdir、歧义或缺少证据的复用。
- 只在需要确认旧 Run 时查一次该 Issue 的历史 Run，单命令内根仓和业务仓复用查询结果；不做跨命令缓存或新增持久化记录。历史记录中缺少可核验 work_dir/runtime 等关键事实时返回 UNKNOWN，保留现场。
- 不全局放宽 assertPlatformCheckoutIdentity()：PR Status Sync/Closeout 的 Task 级规则保持原样。Bug 与其他消费者保持现有契约，除非另有实测需要。
- 实施前在真实 Multica Runtime 核实 active/all runs 命令输出及字段可用性；当前 Replay 证实历史记录有这些字段，但未独立验证活跃 Run 响应是否一定提供绝对 work_dir。若不提供，不从相对目录或分支名猜测；采用平台提供的可信等价上下文，否则停在 UNKNOWN。

### 3.3 最小代码改动

- clients/native-checkout.ts：区分当前 Run 授权与 Checkout 创建 Run 归属；Engineer 路径接收已经核实的当前 Run/必要的历史 Run 证据，复用现有底层严格检查，避免全局删掉尾号判断。不要让校验函数自建分支或修改 Git。
- commands/dev/requirement-guard.ts：将已查询的合法活跃 Run 作为函数结果供调用者复用；仅在旧 Checkout 需要时查询历史 Run；同一命令内共享，不建立新 Registry。
- commands/dev/prepare.ts、authorized-checkout.ts、prepare-workspace.ts、native-prepare.ts：将已核验的 Engineer Checkout 上下文传给根仓及业务仓校验，保持路径/仓库/批准版本校验；Git Fetch/Push 与 PR Prepare 复用 authorized-checkout。
- commands/dev/publish.ts、commands/runtime/root-git.ts：将同一已授权 Issue/Run 上下文传入 Native 发布检查，防止根仓校验仍旧阻塞续跑；非 Engineer 调用不改变。
- skills/native-workspace/SKILL.md：一句说明“同一 Issue 的合法续跑优先复用 Multica 已保留的 Checkout，保留工作树和提交。”不描述 CLI 内部校验算法。
- 现有测试：首 Run、同 workdir 合法续跑、跨 Issue/Agent/Workspace/Runtime/workdir 拒绝、历史 Run 不可确认 UNKNOWN、manifest 冲突拒绝、根仓及业务仓同时复用、保留 WIP/未推送提交、dev publish/git push/pr prepare 续跑、Closeout 旧行为不变。

无新增命令、Metadata、工作区 Owner Marker、工作区管理器、分支命名算法、自动 reset/clean/fresh。真实验收使用 LEI-67/68 同类场景，不要求重放已完成的生产 Issue。

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

保持授权、批准版本、仓库边界、真实测试、Review、PR 登记与归档质量。按 Run 累计时间排除人工等待；比较工具调用量、构建次数、续跑成功率、PR 准备与物化错误。LEI-67 同类任务目标 20–30 分钟，LEI-68 同类任务目标 15–25 分钟；仅为复测目标，不承诺收益或强制时限。P0-1 优先验证两个复现场景不再要求人工改分支或 --fresh，不丢失任何研发成果。方案保存不等于代码已修改或测试已执行。
