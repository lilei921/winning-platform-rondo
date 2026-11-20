# 派发物化缺失（dev.dispatch 无写入）防复发实施方案

> Date: 2026-10-27
> Status: 已实施（2026-10-27，skill-flow 0.1.6：check-dispatch + dispatch-facts 共享模块；Lead instructions 与两个 SKILL.md 已同步 wn_df 并回读确认；WNDF-9 验证 PASS/FAIL/回归全绿）。开放项见 §9
> 上游权威：`projects/multica/workspace-skills/delivery-flow/references/dispatch-facts-contract.md`（`dev.dispatch` 唯一权威）/ `02-multica-delivery-lifecycle-design.md`（语义背景）
> 触发场景：WNDF-9（TFS 260203）派发 Run 裸 @mention、`dev materialize` / `tfs materialize-tasks` 未执行，Engineer 在 Commit 点卡死
> 关联：`analysis-gate-preflight-facts-plan.md`（同构缺口的分析侧先例，方案 A/B 已落地）

## 1. 目标与原则

- 消除「派发通知已发、派发事实未落账」这一失败模式：`dev.dispatch` 的唯一写入者是 `skill-flow dev materialize`，但 Lead 的执行路径可以完全不经过它。
- 两个修复点：**① Lead instructions 补引用（文档级，先做）**；**② Engineer Ground fail-fast（`dev check-dispatch` 只读命令）**。
- 判定与写入全部收敛在 skill-flow 确定性脚本与既有 Skill 契约内（薄适配原则）；不新增流程角色、不改平台调度。
- 务实目标：工具侧永远拦不住手工发 @mention，目标是**让绕过的代价从「Engineer 白干一轮 + 提交点死结」变成「开工即报、修复成本两条命令」**，而非杜绝绕过。

## 2. 背景：WNDF-9 派发物化缺失复盘（2026-10-27，Run 日志实证）

### 2.1 时间线（UTC，平台 Run 日志 + 本地核实）

| 时刻 | 事件 |
|---|---|
| 02:24:36 | WNDF-9 由 TFS 同步创建（tfs.* metadata 落账） |
| 02:25:58 | Lead @Workitem Analyst 启动分析 |
| 02:34:03 | Analyst 收口：stage → Gate 8/8 PASS → complete（0.1.4 新契约首战成功），置 `analysis_review` |
| 02:42:28 | Human 评论「继续」唤醒 Lead Run |
| 02:43:10 | Lead 写 `analysis.human_approval`（instructions.md L12 明文要求 ✅） |
| 02:43:28 | Lead 发 @Frontend Engineer 派发评论（instructions.md L61「以原生 Assignment / @mention 完成派发」✅）；**全程 78 秒，无 skill-flow 调用，`dev materialize` / `tfs materialize-tasks` 未执行** |
| 02:43:41+ | Engineer Run 开工：读 Issue（metadata 无 `dev.dispatch`）→ 加载 development-execution → 建 worktree → 完成 1.1/1.2/2.1/2.3/3.1 全部实现与验证 |
| 02:52:07 | Engineer 在 Commit 点卡死：需求类型 `Refs:` 只能写物化任务 ID，无合法 ID 可写 → 回流 Lead、Issue 置 blocked |
| 10:55 本地 | 修复完成（commit `48c042e0` 带 `Refs: #260270 #260271 #260272 #260274 #260275` 推 `origin/feature/260203`） |
| 11:04 本地 | 五个 TFS 子任务（挂 260203）全部「已解决」+ 工时落库（`resolve-tasks` 特征），tasks.md 五条勾选，2.2（人工验证）未派发未勾选——正确 |

### 2.2 根因：Lead instructions 的引用缺口（三层脱节）

1. **平台绑定 ≠ 执行路径**：delivery-flow 已注册并绑定到 Lead（agents/delivery-lead/README.md 记录 2026-10-15 绑定），也物化在 Run workdir（`.claude/skills/delivery-flow` 存在）——但绑定只意味着"可加载"，加载决策由 instructions 驱动。
2. **Lead 行事依据全文无引用**：`agents/delivery-lead/instructions.md`（64 行）把派发定义为「以原生 Assignment / @mention 完成派发」（L61），全文唯一提到的 skill-flow 命令是 `pr materialize`（L14）。Lead 忠实执行了 L12（写 human_approval）与 L61（发 mention），**从 instructions 视角看行为 100% 合规**。
3. **设计原则与实现脱节**：README L25 自述「流程硬条件归 Gate / Script，协作方法归 Skill，Instructions 只保留角色原则」——但「派发须物化」这个硬条件既无 Gate 拦截（发评论无 Gate），instructions 也未留指向 Skill 的钩子。

### 2.3 对照：分析侧为何同日走通

Analyst 严格走 `stage → validate → complete`，差别在**步骤链连续**：workitem-analysis 第 6 步明文「收口转入 analysis-completion（同一 Run 内继续）」，analysis-completion 第 0 步即 stage——Agent 按编号执行必达。Lead 侧派发无此链。

### 2.4 定性

与 WNDF-8 同构的归属缺口，位置不同：WNDF-8 是**写入动作无归属**（任何文档都没写 draft facts 由谁写）；WNDF-9 是**执行路径无引用**（delivery-flow 契约完整，但 Lead instructions 没把「Human 批准 → 派发」触发场景导向它）。WNDF-9 当日已人工补跑修复，**本方案是防复发，不是救火**。

## 3. 现状关键事实

- `dev.dispatch` 写入者唯一权威（dispatch-facts-contract.md）：`dev materialize`（建条目）、`tfs materialize-tasks`（仅回写条目 `tfs_task_ids` 字段）、`delivery route-decision`（返工路由）；
- 下游消费者全部依赖它：Engineer Ground 读 `tfs_task_ids`（commit Refs 合法 ID 来源）、`check-completion` 的 commit_task_links / dispatched_scope、`resolve-tasks` 与 `finalize` 的 active 条目前置；
- 类型分支已是既定契约：`tfs.type=Bug` 时 materialize-tasks NOOP、`tfs_task_ids` 恒缺省为正常态，commit 直接关联 bug 号；`tfs.type` 缺失 → UNKNOWN 交 Lead；
- `check-completion.js` 的 commit_task_links 已内含 dispatch 读取与类型分支逻辑（`dev.dispatch` 解析、active 覆盖过滤、映射核验），可抽取共享；
- development-execution How-1 现行口径「缺失时不停工，在 Completion Check 阶段按 UNKNOWN 回流」——WNDF-9 即按此执行，损失可控但仍是「干完活才发现」。

## 4. 修复点 1：Lead instructions 补引用（文档级，先做）

**改动**：`projects/multica/agents/delivery-lead/instructions.md` L61（Delivery 段）改写为：

> - 以原生 Assignment / `@mention` 完成派发；独立工作用 Assignment，当前 Issue 内协助用 `@mention`。**研发派发的事实物化先于通知**：派发通知发出前必须经 delivery-flow Skill 完成 `skill-flow dev materialize`（写 `dev.dispatch`），并在同 Run 紧接执行 `skill-flow tfs materialize-tasks`（tfs.type=需求 时物化 TFS 子任务并回写 `tfs_task_ids`；tfs.type=Bug 为 NOOP 正常态）；`@mention` 评论以 materialize 输出的 payload 为事实底稿。未物化的派发不产生合法研发授权——Engineer 将无合法 Commit Refs ID，在提交点卡死。

同时在 L12「协作组织」末尾补半句指向：派发物化与通知的完整契约见 delivery-flow Skill。

**生效前提**：仓内 instructions 改动需经既有 Agent 注册通道同步平台 Delivery Lead 定义（仅 wn_df，不动其他工作区）后才影响线上行为；这是部署依赖，不是可选步骤。

**纪律**：instructions.md 不引用本方案文档（同「SKILL.md 不标方案出处」纪律——执行文件即权威本体）。

## 5. 修复点 2：`skill-flow dev check-dispatch` fail-fast 兜底

### 5.1 命令契约

```text
用法: skill-flow dev check-dispatch --config config/repo-registry.json
        --issue <KEY> --task-refs <1.1,1.2,...>

性质: 只读，零写入，天然幂等。

判定逻辑:
  1. Issue 可读性确认（与 validate 同一守卫，防静默读错工作区）；不可读 → exit 3 UNKNOWN；
  2. dev.dispatch 解析；JSON 不可解析 → exit 3 UNKNOWN（事实不可确认，交 Lead 核对）；
  3. dispatch key 缺失 / 无覆盖 task_refs 的 active 条目 → exit 2 FAIL，
     reason 指向修复路径（Lead 补跑 dev materialize）；
  4. 类型分支（与 materialize-tasks / check-completion 对齐）：
     - tfs.type=需求：覆盖条目的 tfs_task_ids 须覆盖全部 task_refs，缺 → exit 2 FAIL，
       reason 指向 Lead 补跑 tfs materialize-tasks；
     - tfs.type=Bug：跳过映射检查（恒缺省为正常态）；
     - tfs.type 缺失/其他 → exit 3 UNKNOWN（交 Lead 核对来源同步）；
  5. 全部满足 → exit 0 PASS。

输出: { result, issue, tfs_type, dispatch: { dispatch_key, engineer_id, task_refs, active },
        unmapped_refs?, reasons }
```

**退出码口径说明**：check-completion 对「无 active 条目 / 映射缺失」报 UNKNOWN（晚期检查，语义为"不当放行"）；check-dispatch 是开工前预检，对**确定缺失**报 FAIL（前置不满足、修复路径明确）、仅对**不可确认**（不可读/不可解析/tfs.type 缺失）报 UNKNOWN。两命令口径差异为有意设计，评审时裁定是否接受（备选：全部对齐 UNKNOWN，后果是 FAIL/UNKNOWN 分流语义变模糊）。

**防漂移**：从 `check-completion.ts` 抽取 dispatch 读取与类型分支为共享模块 `src/commands/dev/dispatch-facts.ts`，check-dispatch 与 commit_task_links 共用（同 0.1.4 facts.ts 模式）。

### 5.2 development-execution SKILL.md 同步

How 第 1 步（Ground）开头插入预检：

> **派发事实预检（开工第一动作）**：`skill-flow dev check-dispatch --config config/repo-registry.json --issue <KEY> --task-refs <本次派发 task_refs>`（在 `.claude/skills/pull-request/` 下执行，与 worktree create 同一 config）。
> - PASS → 继续 Ground；
> - FAIL（派发未物化/映射缺失）→ **立即**在 Issue 评论 @Delivery Lead 回流（附命令输出原文），实现与验证段可继续，**Commit / PR Preparation / Evidence 提交段暂停**，Lead 补齐后重跑预检 PASS 再进入提交段；
> - UNKNOWN → 停止，按既有 UNKNOWN 口径如实回流。

同段删除/改写现行「缺失时不停工，在 Completion Check 阶段按 UNKNOWN 回流 Lead 补跑 materialize-tasks」一句（被预检前置取代——回流时机从 Completion Check 提前到开工）。

### 5.3 delivery-flow SKILL.md 顺带同步（小改）

Validation 段 materialize 回读要求处补一句：Lead 派发 Run 收尾可用 `skill-flow dev check-dispatch --task-refs <本派发 task_refs>` 作为回读手段（与 Engineer 预检同一命令，双侧共用一个确定性判据）。

## 6. 改动清单与影响面

| # | 资产 | 改动 | 类型 |
|---|---|---|---|
| 1 | `projects/multica/agents/delivery-lead/instructions.md` | L61 改写 + L12 补指向（§4） | 文档（**需平台同步方生效**） |
| 2 | `tools/skill-flow/src/commands/dev/check-dispatch.ts` | 新增（§5.1 契约） | 代码 |
| 3 | `tools/skill-flow/src/commands/dev/dispatch-facts.ts` | 新增共享模块；`check-completion.ts` 重构为调用它（行为不变） | 代码（重构） |
| 4 | `tools/skill-flow` 版本 | 0.1.5 → 0.1.6，CHANGELOG 记录 check-dispatch 新增 | 发版 |
| 5 | `workspace-skills/development-execution/SKILL.md` | How-1 插入预检段、替换旧回流口径（§5.2） | 文档 |
| 6 | `workspace-skills/delivery-flow/SKILL.md` | Validation 补 check-dispatch 回读手段（§5.3） | 文档 |
| 7 | 平台同步 | Lead Agent instructions 重传 + 两个 SKILL 同步，**仅 wn_df** | 部署 |

无下游消费者受影响：check-dispatch 只读；check-completion 重构行为不变（WNDF-9 回归验证，见 §7）；dispatch-facts-contract.md 冻结契约零改动（check-dispatch 只是新读者，不是新写入者）。

## 7. 验证方案

1. **check-dispatch PASS 路径**：WNDF-9（dispatch 已补齐，现成样本）跑 `--task-refs 1.1,1.2,2.1,2.3,3.1` → exit 0，输出 dispatch 字段与实际一致；
2. **check-dispatch FAIL 路径（零副作用负例）**：WNDF-9 跑 `--task-refs 2.2`（2.2 人工验证未派发）→ exit 2，reason 指明无覆盖 active 条目；
3. **Bug 分支**：找一个 tfs.type=Bug 且有 active dispatch 的 Issue 跑预检 → PASS 且输出无映射检查（样本不可得时降级为单测级构造验证，标注核实状态）；
4. **重构回归**：WNDF-9 重跑 `dev check-completion --verify-commits --issue … --registry-config …`（commit `48c042e0` 的 Refs 核验）→ 行为与 0.1.5 一致 PASS；
5. **文档一致性**：按 `agents/_shared/review-checklist.md` 评审（红线 R9：不引用 archive/docs）；instructions.md 与两个 SKILL.md 不含本方案文档引用；
6. **平台生效确认**：Lead instructions 同步后，下一个真实派发 Run 的 @mention 评论应以 materialize payload 为底稿、且 `dev.dispatch` 先于通知落账（观察性验收，无需构造）。

## 8. 验收标准

- `skill-flow dev check-dispatch` 存在且契约行为同 §5.1（含类型分支与退出码口径）；
- check-completion 共享模块重构后行为零变化（验证 4 通过）；
- Lead instructions.md 改动同步平台 wn_df 并回读确认；
- 两个 SKILL.md 更新后与脚本行为逐条可对；
- skill-flow 0.1.6 发布，CHANGELOG 完整；
- daemon 机器 skill-flow 二进制升级 0.1.6（资产同步不覆盖 CLI 二进制，同 0.1.4/0.1.5 教训）。

## 9. 风险与开放项

- **instructions 改动的生效依赖平台同步**：仓内合并≠线上生效，需明确同步执行人与回读证据；
- **fail-fast 只覆盖走 development-execution 的 Engineer**：手工绕过仍可能——符合 §1 务实目标定位，不视为缺陷；
- **退出码口径差异（check-dispatch FAIL vs check-completion UNKNOWN）**：评审裁定点，备选方案见 §5.1；
- **开放项（本方案不含，另立）**：① 平台 daemon 在 @mention 触发 Engineer Run 前校验 `dev.dispatch`（真·硬绑定，需 multica 平台改动）；② `dev materialize --post-mention` 原子化（物化+通知同一命令）——instructions 补引用后收益递减，评审裁定是否立项；
- **WNDF-9 遗留观察项**（与本方案无关，记录备查）：Engineer Run 在 02:52 自行将父 Issue 置 blocked，需核对 Frontend Engineer 运行时边界是否允许该状态写入。

## 10. 评审记录

（待填）
