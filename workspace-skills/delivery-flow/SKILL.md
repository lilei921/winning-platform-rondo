---
name: delivery-flow
description: Development 派发物化与 PR Abandoned 后 Human Decision 路由。当 Delivery Lead 在当前 Issue 上通过 `@mention + task_refs` 派发专业工作需要确定性校验与回读，或 blocked Issue 上 Human 给出重分析/返工/重建 PR/取消决定后需要确定性路由时使用。（2026-10-30 TFS 剥离：派发期不再物化 TFS 子任务，PR 物化前不再置「已解决」——全部 TFS 写操作收敛到 PR 通过后的 tfs-writeback Skill。）
---

# delivery-flow

薄适配器方法：确定性逻辑全部收编为 `rondo` 子命令（npm 包机器安装，安装与版本细节由包自描述），本文件只定义调用契约。
语义/确定性分界：Lead 负责语义决策（选 Owner、定 task_refs、理解 Human 评论得出 NEXT）；脚本只校验、落实、路由，**不解析自然语言、不发明派发策略**。

## Preconditions / Inputs

- 默认配置：`config/repo-registry.json`（相对于本 Skill 目录）；通过 `--config` 传入该配置文件路径。
- 目标项目与所需仓库可被 `rondo` 访问；
- 派发场景：当前 Issue 有真实 Human Approval 评论，Change 已建立且包含 `tasks.md` 原生 Task ID。Delivery Lead 判断 Human 是接受 Analyst 的 Independent Verify Recommendation 还是明确 Override；按 `references/finalize-facts-contract.md`（本包镜像，权威属 finalize-delivery） 将批准及最终 `verify_agent_required`（JSON boolean）投影为 `analysis.human_approval`，写入必填的 `comment_ref` 并回读。决定不明确时澄清，不推断 `false`。Lead 将同一评论引用传入 `--approved-comment-ref`；`rondo dev materialize` 核对来源后写入并回读 `verify_agent.required`，然后才派发。
- 路由场景：Issue 当前 `blocked` 且 metadata 有 `pr.abandoned`（pr-status-sync 的产出）；
- metadata 事实契约：`references/dispatch-facts-contract.md`（`dev.dispatch` / `dev.decision`，唯一权威）。
- 固定版本来源与读取遵循 `references/analysis-source-contract.md`（本包镜像，权威属 analysis-completion）。

## Procedure

**派发物化（Lead 派发）**：

先执行 `rondo analysis read --config "<config-path>" --issue <KEY> --file tasks.md`，按返回的来源、原生任务编号、依赖和 Roster 决定分工；必要时读取同一来源的 proposal、design 或 specs。核对真实 Human 批准的版本，将该来源快照写入 `analysis.human_approval.source`。读取或版本核对失败时停止，不从本地工作树、默认分支或旧评论补猜。

**同仓串行预检（Lead 派发前执行，语义职责，脚本不校验）**：对本次派发涉及的每个业务仓，通过子进程 `cwd` 指定绝对路径 `<root_repo>/<repo_path>`，执行 `git rev-parse --abbrev-ref HEAD`；Windows MXC 下 Git 参数中不得保留 `-C`，Lead 主进程仍在原工作目录运行。结果非该仓 `default_target_branch`（即枢纽躺在某 `feat/<tfs-id>` 上）视为同仓在研。同时核对 Issue metadata `dev.dispatch` active 条目的仓集合。任一命中时不并发派发：排队等前序 Issue finalize（枢纽切回目标分支即释放），或改派其他仓的任务（并发写隔离契约：`references/repo-write-isolation-contract.md`（本包镜像，权威属 pull-request Skill））。命令失败时保留原始错误并停止派发，不将访问拒绝当作仓库不存在，也不扩大沙箱权限。

```bash
rondo dev materialize --config "<config-path>" \
  --issue <KEY> --change-ref <ref> --task-refs 1.1,1.2 \
  --engineer-id <agent-uuid> --approved-comment-ref <comment-uuid> \
  --projection parent
```

当前常规派发仅使用 `--projection parent`，不在 Squad 内创建 Sub-Issue 或改派 Issue Assignee；旧 `sub-issue` 分支作为已存在的实现暂留。脚本在首派、NOOP、激活及写入前核对 Gate PASS、批准评论、最终 Verify Decision、Change 和来源快照，并从远端固定 commit 校验 task_refs。新派发记录 `analysis_source`，不读取本地 tasks.md 或自动替换 Change。其余验证通过后才写入并回读 `verify_agent.required`，随后落实派发。缺失或冲突时停止。

派发物化即派发收尾——TFS 子任务在派发期不再创建（2026-10-30 TFS 剥离）：开发期 commit `Refs:` 统一挂 `#<tfs.id>`（需求/Bug 同一规则），子任务创建、commit 关联、置「已解决」与工时落库全部由 PR 通过后的 `tfs-writeback` Skill 统一执行（由 finalize-delivery 作为 `steps.tfs_writeback` 调用）。

**Human Decision 路由（blocked Issue 上 Human 评论唤醒 Lead 后）**：

Lead 理解评论得出结构化 NEXT，然后：

```bash
rondo delivery route-decision --config "<config-path>" \
  --issue <KEY> --comment-id <触发评论 uuid> \
  --next ANALYSIS|ENGINEERING|RECREATE_PR|CANCEL_DELIVERY \
  [--reason REJECTED|DISCARDED] [--affected-task-refs 1.1,1.2]
```

脚本行为（由脚本保证）：前置校验（blocked + pr.abandoned + 评论存在 + comment_id 幂等）→ 按固定路由表执行确定性状态写入 → 输出路由指令。

## 固定路由表（脚本输出 → Lead 动作）

| 脚本输出 | Lead 动作 |
|---|---|
| `mode=parent` + `payload` | 以 payload 为事实底稿在父 Issue 发 @Engineer 评论（可补语义上下文——语义归 Lead） |
| `mode=sub_issue`（activated / awaiting_dependency） | 无追加动作；结果回流父 Issue。依赖完成后重跑同参数加 `--activate` 激活 |
| `mode=activate` | 无追加动作（Sub-Issue 激活即触发 Specialist 执行） |
| `directive=mention_analyst` | 在 Issue 发 @Workitem Analyst 评论（含 Human 决定摘要与修正方向——语义归 Lead） |
| `directive=rework_parent_mention` | 派发已由脚本恢复（同 dispatch_key 新 active 条目，见 `redispatched`）；Lead 用 `rework_target` 在 Issue 单次发 @原 Engineer 返工评论（不再调 materialize 重复派发） |
| `directive=rework_sub_issue_activated` | 无追加动作（Sub-Issue 重开即触发返工执行） |
| `directive=rematerialize_pr` | 调 pull-request Skill `rondo pr materialize` 重新物化（已 abandoned 条目已从 current_pr 移除） |
| `directive=needs_engineering` | 候选提交已变，转 ENGINEERING 语义流程（Lead 重新理解 Human 意图，必要时重跑本脚本 NEXT=ENGINEERING） |
| `directive=hold_for_human` | 保持安全停止，交 Human（CANCEL 专项契约未定义） |

**研发派发后的纯 Verify Override**：若 Human 只改变是否需要额外独立 Verify Agent，不修改工程契约和既有 Task Sets，Delivery Lead 在原 Issue 上记录新 Human 评论并更新 `analysis.human_approval`（新 `comment_ref`、批准时间和最终 boolean）。使用原有 `--issue` / `--change-ref` / `--task-refs` / `--engineer-id` 调用 `rondo dev materialize`，将 `--approved-comment-ref` 换成新评论 ID；命令校验 Gate / Change / 评论来源及已有 active 派发，只更新并回读 `verify_agent.required`，返回 `NOOP`，不覆盖已有 `dev.dispatch.approved_comment_ref`、不重建 Sub-Issue 或启动新 Engineer。复用旧评论擅自改变 boolean、现有 Change 身份冲突时安全停止。

## Validation

- 各脚本退出码 `0`（PASS）或 NOOP（`result=NOOP`，exit 0）；
- materialize PASS：回读 metadata `dev.dispatch` 含新条目；sub_issue 时 Sub-Issue 回读 parent/assignee/status 一致；
- 派发收尾调用 `rondo dev check-dispatch --config "<config-path>" --issue <KEY> --task-refs <本派发 task_refs>` 作为统一回读手段（与 Engineer Ground 预检同一命令、同一判据；PASS 才视为派发完成）；
- route PASS：ANALYSIS/ENGINEERING(parent) 后 Issue = `in_progress`；ENGINEERING 后 `dev.dispatch` 存在同 dispatch_key 的新 active 条目（携 `rework_comment_ref`）；ENGINEERING(sub_issue) 后原 Sub-Issue 重开且返工评论存在；RECREATE_PR 后 `current_pr` 不再含 abandoned 条目；
- 幂等：同 dispatch_key / 同 comment_id 重跑 → `NOOP`（route 侧为后置条件核对：路由动作全部落地才 NOOP，有缺口则 `mode=repair` 只补缺口），无重复派发、无二次触发。

## Output

- materialize：`{ result, mode, dispatch, payload? | sub_issue?, activated?, awaiting_dependency? }`；
- route：`{ result, next, directive, ... }`（directive 见路由表）；
- Agent 汇总本次执行结果；FAIL/UNKNOWN 原样附 reason。

## Error Handling / Stop Conditions

- `result=FAIL`（exit 2）：派发输入校验不过（task_refs 不可定位 / 批准评论不存在 / engineer 未注册等）——修正输入后重跑，不绕过；
- `result=UNKNOWN`（exit 3）：route 的 UNKNOWN 分两类——前置校验不过（评论不存在 / 状态非 blocked / 缺 pr.abandoned 等）零写入；persist-before-act 中途断连可能已写 `dev.decision`，重跑会核对后置条件并补缺；无法唯一确认原派发或旧轮次状态时仍返回 UNKNOWN，保留事实供人工核对。其他 UNKNOWN 交 Lead 语义判断，仅查明原因后修正输入重跑，不手工补写 metadata 绕过；
- Sub-Issue 创建结果未知：先查 Issue 列表核实，不盲目重建；
- CANCEL_DELIVERY：脚本零写入，任何取消动作都不得由本 Skill 执行。
