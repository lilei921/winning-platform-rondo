# domain-engineering-skills 方案（缺口①：专业 engineering Skill + 04 方法层落地）

> 当前契约提示（2026-10-22）：本文旧 `repos/`、`df-*` 示例与实测输出均为历史记录；当前仓库身份与路径以根仓 `docs/config/repo-context.yaml` 及 `multica-delivery-operations-guide.md` §3.5 为准。

> 状态：**已实施并验收（2026-10-15）**。平台注册记录见 `agents/backend-engineer/README.md` / `agents/frontend-engineer/README.md`（Skill `backend-engineering` `bd5c50a5-c0b5-4fc2-96aa-fb8617ad4ceb`、`frontend-engineering` `27b3c58e-9364-47d7-a687-01a0a6fa95e2`；development-execution `28da55b0-…` 已重 upsert）。实测记录见 §7。
> 上游权威：`docs/04-engineer-development-design.md` v1.15.3（专业过程与实施契约）；02 §7/§8（派工与研发执行）；`docs/agent-skill-review-checklist.md`（R1–R8）。
> 内容来源：本方案不重写专业方法，只做 04 已定稿内容 → Skill 资产的映射与补强（映射表见 §3）。

## 0. 定位

补齐 Engineer 的专业方法层。现状：`development-execution`（统一执行骨架）已落地并验收，但三名 Engineer 没有领域方法 Skill（`agents/backend-engineer/README.md` 等登记"专业方法，待实现"），methods 模块（TDD / code-review 双轴 / 有界诊断等）只存在于 04 文本中。

```text
Engineer Agent（五段式 instructions，已注册）
  → development-execution（执行骨架，已注册）+ methods/（本次新增）
  → backend-engineering / frontend-engineering（领域方法，本次新增）
```

## 1. 设计约束（红线）

1. **04 为内容权威**：Skill 文件只承载 04 已定稿内容的小节级抽取与操作化，不新造专业规则；与 04 冲突时改资产不改 04（04 修订走 §5）。
2. **Skill = 可复用执行契约**：SKILL.md 最小化（When/Input/How/Validation/Output/Failure）；方法细节在 `methods/` / `references/`，不内嵌进 SKILL.md 或 Agent instructions。
3. **Skill 之间不互相调用**：development-execution 与 domain skill 的协作靠"同 Agent 双绑定、物化目录同 workdir"的文件引用（已被 pr-status-sync → finalize-delivery 的 same-run 调用验证），方法派发选择由 development-execution 的 Method Dispatch 段承担（04 §13.3）。
4. **无脚本则不强行脚本化**：本方案资产全是方法文本（md），不新建确定性脚本；唯一例外是复用既有 `check-development-completion.ts`（不动）。
5. **Domain Skill 边界**（04 §13.4）：只管"该技术领域如何正确实现"；不决定 Route / Human Review / Runtime Projection / Sub-Issue / PR Materialization / Delivery Completion。

## 2. 资产布局

```text
workspace-skills/backend-engineering/
  SKILL.md                          # When/Input/How/Validation/Output/Failure 薄契约
  references/feedback-signals.md    # 04 §5.3：后端最小可靠反馈信号清单
  references/local-validation.md    # 04 §7.2 的后端命令映射（项目实际工具为准，占位待填）
  references/review-standards.md    # 04 §8.3 工程标准轴的后端细化

workspace-skills/frontend-engineering/   # 同构三份 references（04 §5.4 / §7.2 / §8.3）

workspace-skills/development-execution/
  methods/tdd.md                           # 04 §6.2
  methods/codebase-design.md               # 04 §6.3
  methods/code-review.md                   # 04 §8（双轴审查 + Finding 五要素）
  methods/verification-before-completion.md# 04 §6.5
  methods/bounded-diagnosis.md             # 04 §12.2 有界诊断升级
  SKILL.md                          # 微调：Method Dispatch 段（见 §4）
```

既有资产改动：`agents/backend-engineer/README.md`、`agents/frontend-engineer/README.md` 登记注册 ID；`docs/04-engineer-development-design.md` 吸收 ops guide §3.5（见 §5）；ops guide 缺口① 状态更新。

## 3. 内容来源映射（04 → 资产）

| 资产 | 04 来源 | 落地形式 |
|---|---|---|
| `backend/frontend-engineering/SKILL.md` | §13.4 领域边界 + §2.2 | 薄契约；How 只列"按 development-execution 骨架执行，领域方法见 references/" |
| `references/feedback-signals.md` | §5.3 / §5.4（+ §5.2 总原则一段引述） | 近乎照录，操作化为"选择最小可靠 Signal 的决策清单" |
| `references/local-validation.md` | §7.2 + §7.4 | 五问 Evidence 要求照录；命令映射按目标业务仓实际工具链填写（本方案开发时调研 DF 仓实际构建/测试命令，填不出的一律 UNKNOWN 不虚构） |
| `references/review-standards.md` | §8.1–§8.3 | 双轴中"工程标准轴"的领域细化（后端：迁移安全/事务/兼容；前端：类型/交互/构建） |
| `methods/code-review.md` | §8 全节 | 双轴审查法 + Finding 五要素（ID/Severity/Area/Evidence/Suggestion）+ 定向修复纪律 |
| `methods/tdd.md` / `codebase-design.md` / `verification-before-completion.md` / `bounded-diagnosis.md` | §6.2 / §6.3 / §6.5 / §12.2 | 单项方法，含启用条件（04 §13.3：由 Method Dispatch 决定，方法不自链） |
| evidence contract 核对 | §10.2 / §10.3 | 既有 `references/development-evidence-contract.md` 逐字段对照，缺项补、冲突报（不静默双写） |

## 4. development-execution 微调

SKILL.md 只加一段 Method Dispatch（04 §13.3 已定语义）：

```text
方法派发（由本 Skill 决定，方法之间不互调）：
- 行为可自动测试 → methods/tdd.md
- 重要局部设计决策 → methods/codebase-design.md
- 候选实现可审查 → methods/code-review.md（Step 4 的方法本体）
- 声明完成前 → methods/verification-before-completion.md
- 证据冲突/修复后原失败仍在 → methods/bounded-diagnosis.md（有界，产出 Finding/Evidence，不扩张 Scope）
```

不动既有 8 步流程与脚本契约；`pr_prep` / worktree 挂钩保持现状。

## 5. 04 文档吸收 ops guide §3.5（随本方案一并修订 04）

1. §5.1 Ground 补一条：业务仓研发先建 worktree（`repos/.worktrees/<issue>-<repo_key>/`），枢纽仓只 fetch/push；
2. §13.3 Procedure 行补 worktree 生命周期（Ground 建 / finalize 收）；
3. §9.2 补实施契约指针：`pr_prep` / `current_pr` 字段契约权威 = `workspace-skills/pull-request/references/pr-facts-contract.md`；
4. §11.2 补一句：根仓直推共享分支的 Archive Commit 走 finalize 的 mkdir 临界区（与 tasks.md checkbox 的 change-scoped 串行是两个不同边界）。

04 版本号 v1.15.3 → v1.15.4，变更摘要追加。

## 6. 平台注册

1. `multica skill create` backend-engineering / frontend-engineering + `skill files upsert`（references×3）；
2. development-execution 重新 upsert（SKILL.md + methods×5）；
3. 绑定：backend-engineering → Backend Engineer（`59a97d2d-…`），frontend-engineering → Frontend Engineer（`51440aa8-…`）；
4. 两名 Engineer README 登记表更新。

## 7. 验收（E 系列）

测试纪律：真实 Run 试跑只用指定测试工作项； Evidence 试跑产物验收后清理。

| # | 用例 | 预期 | 实测（2026-10-15，测试 Issue FOMA-30，验收后已取消） |
|---|---|---|---|
| E1 | 评审清单自检 | 全部新/改资产过 `agent-skill-review-checklist.md` R1–R8，记录自检表 | ✅ R1–R8 全过；S/D/X 全过。唯一注意项：两份 `review-standards.md` 均照录 04 §8.3 通用维度段——属**有意双份**（Skill 自包含，Run 内读不到 docs/ 与对方 Skill），各文件已标注"照录 04 §8.3"权威指针，修订时同步改两处（同 repo-registry 三副本纪律） |
| E2 | 04 映射完整性 | §3 映射表每行可指认资产文件段落；04 被引小节无遗漏 | ✅ 8 行映射全部落位：SKILL.md×2（§13.4/§2.2）、feedback-signals×2（§5.3/§5.4）、local-validation×2（§7.2/§7.4+实测命令）、review-standards×2（§8.1–8.3）、methods×5（§6.2/§6.3/§8/§6.5/§12.2）、evidence 契约核对（E6） |
| E3 | 平台注册 + 物化 | 两 Skill 注册绑定成功；Run 确认 `.claude/skills/` 下三 Skill 物化齐全、相对路径可读 | ✅ Backend run `01a13e43` / Frontend run `01a13e48`：三 Skill（development-execution + 领域 + pull-request）物化齐全，methods×5 + references×3 相对路径逐个实际读取确认 |
| E4 | 方法派发可用 | Run 中 Method Dispatch 按条件选中 tdd.md / code-review.md，Finding 含五要素 | ✅ Backend run 纸面演练：纯函数任务正确选中 tdd（首选）→ codebase-design（条件）→ code-review（必经）→ verification-before-completion（必经）→ bounded-diagnosis（不触发）；示例 Finding 五要素 + blocking/resolution 齐全 |
| E5 | 前端等价核验 | 同 E4 或静态核验 references 可读可引用 | ✅ Frontend run：references×3 实际读取，正确引用"DF 前端仓无单测框架"约束并复述"不虚构测试命令/UNKNOWN 不隐式 PASS"纪律 |
| E6 | evidence 契约一致性 | 既有契约与 04 §10.2 逐字段对照，差异逐项有归属 | ✅ 对照结论：8 维度中 7 项"维持"（契约是机器可判定子集，Issue 引用/批准基线/changed_files/实现摘要/逐 task 细节/偏差风险由回流评论 + evidence_refs 承载，04 §10.2 允许）；1 项"补"——`code_review.findings[]` 增加五要素字段（id/axis/severity/area/evidence_ref/suggestion），与 methods/code-review.md 对齐；脚本只消费 `resolved`（已核实），加法兼容，已重 upsert |

实施偏差记录：

1. **E4/E5 执行形态**：按 §9 开放问题 2 降为"只读核验 Run"（不做真实编码派发）——派发真实研发任务需完整批准链（Human Approval + 已批准 Change），成本与风险不成比例；Run 内物化、读取、派发理解、Finding 结构均已实证；
2. **唤醒方式实测（已修正，探针验证）**：member 纯文本 `@Agent` mention **可以触发** Run，但前提是 Issue 有 Owner 路由上下文（Squad 或 Agent assignee）——无 assignee 的 Issue 上 mention 不路由（backlog / in_progress 两轮观察）；Squad-owned Issue 上 member mention 正常唤醒被 mention 的 Engineer（探针 run `01a13e52` 回复"已唤醒"），并伴随 Lead 评估 Run（run `01a13e53`，与 L4 观察一致）；Assignment 亦直接触发。**派发默认形态（Squad-owned 父 Issue + @Engineer + task_refs）成立，不受影响**；
3. **前端 run 附带发现**：Frontend Engineer 对重复派发正确幂等（识别同一触发评论不重复报告）；
4. **04 入库命名**：04 已按 v1.15.4 修订但文件名仍为未 versioned 的 `04-engineer-development-design.md`（untracked）；versioned 入库归 openspec-schema-landing 方案 §5 统一处理。

## 8. 明确不做

- `flink-engineering`：平台无 Flink Engineer（未注册），资产形状同构预留、本方案不建；
- 任何新确定性脚本 / Gate 改动（`check-development-completion.ts` 不动）；
- 04 的流程层语义改动（02 权威不变；§5 仅为吸收已落地的 §3.5 决策）；
- 真实业务仓的研发放量验证（属后续端到端验证，不在本方案）。

## 9. 开放问题

1. **references/local-validation.md 的命令映射**：DF 各业务仓的实际构建/测试命令需开发时逐仓调研；调研不到的项写 UNKNOWN 并登记，不虚构命令；
2. **E4/E5 真实 Run 成本**：合成 Task Set 试跑约 2 次 Engineer Run；若评审认为静态核验（E1/E2/E3/E6）足够，E4/E5 可降为抽查；
3. **methods 的 One Owner 与跨 Skill 可读性**：methods 归 development-execution；若未来某方法带领域分叉（如 flink 诊断），再评估是否下沉 domain skill，v1 不分叉。
