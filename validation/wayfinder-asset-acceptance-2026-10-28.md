# Wayfinder Agent / Skills — 共享基础验收与历史清单

> **2026-11-14 适用范围修订（仅文档）**：Wayfinder 是 08-A / 08-B 的共享基础，能力验收以 [08-A §1.1、§2、§4](../08a-remote-analysis-bug-fix-foundation.md)为准，入口按 [02 阶段约定](../02-multica-delivery-lifecycle-design.md#wayfinder-entry-stages)区分：研发测试保留 `backlog`、Human 手动改 `todo`，研发结束后的目标态仍由 TFS Sync 自动改 `todo`。下方历史资产勾选、原始预期与 `NOT_RUN` 记录保留；旧表的环境 / 资源前提不是当前部署事实，历史自动入口记录也不证明当前目标态已验收。

## 当前共享基础待验项（2026-11-14）

当前 [Wayfinder 资产说明](../agents/wayfinder-agent/README.md)和 [TFS 来源契约](../workspace-skills/tfs-sync/SKILL.md#issue-的-tfs-来源字段)对应研发测试阶段；目标首次入口按上述 02 阶段约定验收，受控恢复沿用 [Handoff Contract](../workspace-skills/workitem-triage/references/multica-handoff-contract.md)。细项与 [08 当前待验矩阵](new/08-multica-mechanism-validation-acceptance-plan-2026-11-13.md)关联；本次未执行真实 Runtime 验证。

| Case | 验收范围 | 必须观察的结果 | 状态 |
| --- | --- | --- | --- |
| WF-S01 | 研发测试阶段首次准入 | TFS Sync 完成来源 / 附件初始化后停放于 `backlog + Wayfinder`；Human 手动将 Status 从 `backlog` 改为 `todo`，保留 Wayfinder Agent Assignee；回读原生状态触发的真实 Wayfinder Run | NOT_RUN |
| WF-S02 | Bug / Requirement 共享准入与交接 | 两类来源分别取得有效 `/note` 并回读；Bug 只交接 Bug Fix Agent，Requirement 只交接 Delivery Squad；核实对应唯一 Bug Fix Agent / Delivery Lead Run | NOT_RUN |
| WF-S03 | `needs_human` / `unsupported` 与恢复 | 暂缺证据不误判为不支持；Human 补充信息后按现行契约恢复，增量复核并正确关联 Comment，不覆盖下游已有有效事实 | NOT_RUN |
| WF-S04 | 来源变化 | 调查后来源发生实质变化时重新核实受影响结论，不以旧 Decision 交接 | NOT_RUN |
| WF-S05 | 重复触发、发布 / 交接结果未知 | 先回读 Issue、Comment、Assignment 与 Run，只补缺失动作，无重复 Decision 或目标 Run | NOT_RUN |
| WF-S06 | 原生根仓就绪 | 只校验 Multica 已提供的 checkout、实际路径及当前 Task / Project 身份；未就绪时停止受影响步骤，不调用 checkout 或自建 Bootstrap；重复检查保留修改与 Commit | NOT_RUN |
| WF-S07 | 三个远程 MCP 优先调查 | 正常源码调查优先 `remote-codegraph` / `remote-filesystem` / `remote-ripgrep`，核对当前授权根、仓库与分支；无索引时用远程读取 / 检索补足，不要求固定 Commit 或逐次 API 复查 | NOT_RUN |
| WF-S08 | 访问限制与条件兜底 | 越界 / 未授权读取被拒绝且不通过兜底绕过；仅在 08-A §2.2 条件下使用 TFS API；工具故障不直接判 `unsupported`，关键证据无法核实时说明未知项 | NOT_RUN |
| WF-S09 | 目标态自动首次准入与切换 | 初始化及来源 / 附件 / Owner 回读完成后，TFS Sync 单次自动改 `todo`、保留 Wayfinder 指派并回读唯一真实 Run；覆盖结果未知后的恢复、重复同步及切换时不重启已处理 Issue | NOT_RUN；目标态切换前独立验收，WF-S01 的手动结果不能替代 |

验收使用隔离 Issue，记录运行阶段、必要的 Issue / Comment / Run 身份、状态前后值及可复核源码位置。研发测试先验证 WF-S01 和共享能力；切换自动驱动目标态前补齐 WF-S09 及实际部署结果。历史 POC、静态资产检查与当前会话 MCP 只读探测均不替代真实 Wayfinder 验收。

## 历史基线与原始清单（保留）

> 2026-10-28。此文件是验收清单，不是 Runtime E2E 通过证据。所有远端发布、实际 TFS Sync 自动入口及真实 Run 用例均为 **NOT_RUN**。

## 本次研发范围（仓内资产）

- [x] Agent：`wayfinder-agent/description.md`、`instructions.md`、`README.md`。
- [x] Project Skills：`workitem-triage`、`codebase-explorer`，及 `workitem-triage/references/decision-contract.md`。
- [x] Manifest：`Wayfinder Agent` 独立于 Delivery Squad，绑定上述两个 Skill；无 Autopilot。
- [x] README：Agent / Squad / Skill 导航与仓内注册状态一致。
- [ ] 正式 Workspace `provision` / `sync`、Runtime 绑定、权限与实际状态回读。
- [x] 仓内 `skill-flow tfs reconcile-workitem` 已实现新建 `backlog + Wayfinder`、来源回读后单次 `todo` 激活和 pending 恢复；仍须真实 Workspace 联调。
- [ ] 正式环境全分支 E2E（含 TFS Sync 新入口和首次 Wayfinder Run）；尤其 `unsupported (closed)` 恢复。

## 语义与 Runtime 验收用例（需真实 Agent 执行并记录 Evidence）

| Case | 输入场景 | 期望 | 判定 |
| --- | --- | --- | --- |
| W01 | 已授权仓与可用 Backend Agent，尚未查清 Root Cause | `eligible`；保留未知根因交 Analyst | NOT_RUN |
| W02 | 多候选系统，归属不明但可能属于团队 | `needs_human`；明确归属问题和恢复条件 | NOT_RUN |
| W03 | 仓库临时无读取权限，可申请授权 | `needs_human`，不得冒充 `unsupported` | NOT_RUN |
| W04 | 有明确证据证实外部系统禁止小队修改 | `unsupported`；保留排除证据，TFS 原工作项不关闭 | NOT_RUN |
| W05 | 仅 CodeGraph 不可用，但精确源码足够支持准入 | 有限降级并说明工具限制，不因故障直接拒绝 | NOT_RUN |
| W06 | 已移交 Squad，重复唤醒 Wayfinder | NO-OP / STOP，不覆盖已有 Analysis 和 Owner | NOT_RUN |
| W07 | 来源 `tfs.changed_at` 在探索后实质变化 | 重查受影响事实，不以旧 Decision 交接 | NOT_RUN |
| W08 | Human 在 `blocked + Wayfinder` 下显式 Mention | 增量调查、`/note --parent` 回复、`supersedes` / `resume_ref` 正确 | NOT_RUN |
| W09 | `unsupported (closed)` 下显式 Mention | 必须先证实能创建 Run，不能用手工改状态模拟成功 | NOT_RUN |
| W10 | `eligible` 后 `rondo delivery handoff` | Comment 回读后只执行一次 `todo + 目标 Owner` Update，Bug 回读 Bug Fix Agent Run、Requirement 回读 Delivery Lead Run | NOT_RUN |
| W11 | `/note` 或 Update 请求超时 / 结果未知 | 先对账 Comment、Issue、Run，无重复 Decision / Assignment | NOT_RUN |
| W12 | Status Trigger 首次准入 `/note` 顶层 Comment 正确写入 | 内容以 `/note` 开头，回读 Comment；`comment.created` 不额外启动非预期 Run | NOT_RUN |
| W13 | Human 恢复的 `/note` 回复 | `--parent` 指向触发 Human Comment；`parent_id`、`supersedes` / `resume_ref` 回读一致，无额外 Wakeup | NOT_RUN |
| W14 | `in_place` Runtime / 多 daemon | 从本次挂载资源解析唯一根仓；有现成配置时可调用 `resolve-root-repo`，不假定 cwd 或特定 Agent 工具目录 | NOT_RUN |
| W15 | `worktree` / 挂载资源 Runtime | 使用当前 Run 可访问的根仓定位 `repo-context.yaml`，无需 `.claude/skills/` 路径、额外配置或固定 UUID | NOT_RUN |
| W16 | 无法唯一定位根仓、候选业务仓不可访问 | 明确记录源与访问限制；不得猜路径、跳过授权或把工具故障判为 `unsupported` | NOT_RUN |
| W17 | `unsupported` Status 尚未注册，当前决策为 `eligible` / `needs_human` | 不因无关 Status 预检阻止正常分支；实际需写 `unsupported` 时才检查 Category | NOT_RUN |
| W18 | 同一 Issue 的顶层与回复含多个 Decision | 结合 `tfs.id`、`tfs.changed_at`、`supersedes` / `resume_ref` 找到有效 Decision，不依赖最新顶层 Comment | NOT_RUN |
| W19 | 准入 Decision 的来源版本与证据 | `codebase-explorer` 核实 Repository 归属；`workitem-triage` 的 `/note` 包含 `tfs.id`、`tfs.changed_at`、`rationale` 与 Evidence 且回读成功 | NOT_RUN |

W14–W16 验证 Multica 如何提供工程资源，不规定 `codebase-explorer` 如何发现挂载或启动 Run；Repository 归属判断仍须遵守 `repo-context.yaml` 的项目映射规则。

## Codebase Explorer 工程能力验收（不绑定 Runtime 资源供应方式）

| Case | 输入场景 | 期望 | 判定 |
| --- | --- | --- | --- |
| C01 | 依据业务或接口线索判断 Repository 归属 | 按现有上下文定位根仓，读取 `docs/config/repo-context.yaml`，通过职责字段核实 `repo_id` / `repo_path`；不依赖 Runtime 挂载方式 | NOT_RUN |
| C02 | 需要核实跨仓调用链或复杂依赖 | 优先使用 CodeGraph 并结合源码验证；不可用时精确源码检索降级，说明未覆盖范围 | NOT_RUN |
| C03 | 根仓映射不可读、候选仓不可访问或身份无法证实 | 受影响的归属结论标为未知，不猜测 `repo_id`；其他可验证范围可继续只读探索 | NOT_RUN |

| C04 | 仅需定位单仓简单 Symbol 或文件 | 可直接源码检索，证据充分即停止，不强制启动 CodeGraph | NOT_RUN |

## 本次整改的静态 Review（2026-11-02）

仅检查仓内资产，不代替本表 W01–W19 的真实运行验收。应检查：

- Agent Instructions 保持五段式；`workitem-triage` 承担准入评估、`/note` 持久化和必要原子交接，首次/恢复触发方式依 02 §4.1；
- Decision Contract 定义五维语义、三类 Decision、有效 Decision 读取和 `/note` Comment 数据，不重复状态转换流程；
- `codebase-explorer` 不依赖 TFS、Wayfinder 或 Runtime 资源供应机制；涉及仓库归属应读取 `repo-context.yaml`，复杂跨仓关系优先使用 CodeGraph，W14–W16 仅验收 Multica 资源供应；
- `/note` 顶层 / 回复、`comment.created` Wakeup、来源新鲜度、唯一 Lead Run 与 UNKNOWN 对账都保留可测的验收要求；
- Asset / Manifest 原有 Wayfinder 两 Skill 绑定、Squad 外运行及不配置 Autopilot 的边界保持不变。

## 正式环境验收顺序

1. **配置预检**：核对 `provisioning.json`，验证对象和 Skill 内容的 `provision --dry-run` / `sync --check`；确认 Runtime / Project Resources、CodeGraph / 源码只读权限、`unsupported` Status Key / Category。不要仅凭仓内文件认为已发布。
2. **部署验收**：先 `skill-flow workspace provision --workspace <name>`，再 `skill-flow workspace sync --workspace <name>`；回读 Agent 绑定及两项 Skill 文件；不增加 Wayfinder Autopilot。
3. **隔离 Issue 验收**：优先用无真实 TFS 写入的测试 Issue，验证 W01–W19；记录 `workspace_id`、Issue、Comment、Run、状态前后值和来源 Ref。必要时参考既有 WFP-8 / WFP-9 / WFP-10，但隔离 POC 不替代正式结果。
4. **TFS Sync 联调**：只有确定性 `reconcile-workitem` 完成 Wayfinder 初始化 / 激活后，才验证真实自动入口；已有 Issue 只更新 TFS 管理字段，不改状态和 Owner。
5. **签收**：成功记录独立首次准入、`needs_human` 恢复、`unsupported` 重进、来源变更、重试和无重复 Lead Run 的实际证据。任一缺口继续标注 NOT_RUN / FAIL，不写 PASS。

## 技术边界

- `eligible` 是允许进入 Analysis，非 Human Approval / Development Ready。
- Wayfinder 不写 OpenSpec Change，不替代 Workitem Analyst，不创建新 Triage 状态机。
- TFS Sync 自动入口及 `unsupported` closed 恢复的正式 E2E 是本次仓内资产研发之后的**外部集成条件**，当前不可宣称通过。

## TFS Sync → Wayfinder 增量验收（代码实现后，均未在正式 Runtime 执行）

| Case | 输入 | 必须观察的结果 | 状态 |
| --- | --- | --- | --- |
| T01 | 新 TFS Work Item | 创建 `backlog + Wayfinder`；来源、附件和 Owner 回读后仅一次 `todo` Update | NOT_RUN |
| T02 | 初始化途中中断，`tfs.intake_pending=true` | 复用相同 `tfs.id`，补齐字段、附件后单次激活，不重复创建 Issue | NOT_RUN |
| T03 | 已存在非 pending 的 Squad / Analyst Issue | 只刷新 TFS 管理事实和来源正文，不改变 Status / Owner、不唤醒 Wayfinder | NOT_RUN |
| T04 | pending Issue 的 Owner 被人工改动 | UNKNOWN 并停止激活，不覆盖人工决定 | NOT_RUN |
| T05 | `todo` 更新成功、清 pending 失败 | 重试只回读并清 pending，不再次执行有副作用的 Update | NOT_RUN |
| T06 | 激活 Update 或回读结果未知 | 查验 Issue、Owner 和真实 Agent Run，不盲目重复激活或报告成功 | NOT_RUN |
| T07 | Wayfinder Agent 未唯一登记 / Workspace 配置缺失 | 创建前停止，零新 Issue | NOT_RUN |

**已知边界：** Multica Issue Create 不支持把 `tfs.id` 与 pending 事实原子写入；若在 Create 返回后、最初的身份 metadata 写入前崩溃，当前脚本无法仅凭 `tfs.id` 自动认领可能存在的无标记 Issue。正式上线前须增加对应孤儿识别/人工恢复验证。此边界未验收，不宣称完全幂等。

**结果口径：** `intake.run_verified=false` 仅表示已观察到 Issue 激活结果，**不是** Wayfinder Run 成功证据。正式 E2E 应回读 Run 身份、唯一性与启动结果，失败时保持未通过状态。
