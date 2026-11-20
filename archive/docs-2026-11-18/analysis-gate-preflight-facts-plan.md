# Analysis Gate 前置 Facts 写入与 openspec-root 语义收口实施方案

> Date: 2026-10-26
> Status: 方案 A 已实施（skill-flow 0.1.4：新增 `analysis stage`、complete ai_review 放宽为仅 sdd-fast 必填、SKILL.md 同步）；方案 B 已实施（skill-flow 0.1.5：`--openspec-root` 统一为根仓路径语义 + 全命令防御性归一 `resolveOpenspecRootDir`，覆盖 validate / resolve-identity / update-progress / check-completion 四个直接消费命令，四个 SKILL.md 措辞同步；评审 F3/F4 已修）；方案 C（并发防护）未实施，运维约定已写入 analysis-completion SKILL.md
> 上游权威：`02-multica-delivery-lifecycle-design.md` §5.4（Analysis Gate 公共契约）/ §12.1（analysis-completion 收口）
> 触发场景：TFS 260203（WNDF-8）Analysis Gate FAIL 复盘暴露两处契约缺口 + 一处并发操作风险

## 1. 目标与原则

- 消除 Analysis Gate 的「鸡生蛋」缺口：Gate 读 Issue metadata `analysis.*`，而现行唯一写入者 `analysis complete` 又以 Gate PASS 为前置——draft Facts 的写入责任必须显性化、确定性化。
- 消除 `--openspec-root` 参数语义歧义：传根仓路径必 FAIL 且报错路径有误导性，CLI 应防御性归一或给出明确报错。
- 判定与写入全部收敛在 skill-flow 确定性脚本内（薄适配原则），Agent 语义流程不变。
- 幂等：任何新增/修改的命令重复执行结果相同；兼容存量已收口 Issue（同族 WNDF-5/259862 形态不受影响）。

## 2. 背景：WNDF-8 Gate FAIL 实测复盘（2026-10-26）

### 2.1 时间线

| 时刻 | 事件 |
|---|---|
| 14:39 | 平台/本地跑 `skill-flow analysis validate --issue 01a178a0-… --openspec-root <根仓>` → **FAIL**，10 条 reasons |
| 复盘 | OpenSpec Change `dataelement-add-vertical-layout-260203` 三件产物（proposal/specs/tasks）齐全且 `openspec validate --strict` 通过，产物本身无问题 |
| 补验 | 手动写入 7 个 draft `analysis.*` metadata 后重跑 Gate → identity / verify_recommendation / ai_review 转 PASS，但 change 等 5 项仍 FAIL：`Change 目录不存在: <根仓>\changes\…` |
| 修正 | `--openspec-root` 改指 `<根仓>/openspec` → **8/8 PASS** |
| 事故 | 本地会话与另一执行体（平台 Run 或人工）并行操作同一 Issue：`analysis complete` 在本地不知情时被执行（revision 17→29），随后本地按「撤回」删除 metadata，造成 `status=analysis_review` 但 analysis.* 缺键、gate.reasons_ref 死引用的不一致态，最终彻底回滚（status→in_progress、TFS 已分析→活动、清键、删评论） |

### 2.2 根因归纳

| # | 缺口 | 性质 | 证据 |
|---|---|---|---|
| A | **draft Facts 写入无归属**：Gate（`validate`）从 Issue metadata 读 `analysis.route/change_ref/verify_agent.*/ai_review.*`；唯一写这些键的脚本 `complete` 以前置条件拒绝 `gate.result≠PASS`。SKILL.md 未规定「Agent 在 Gate 前手写 draft metadata」这一步 | 流程契约缺口（鸡生蛋） | `dist/commands/analysis/validate.js` checkIdentity/checkVerifyRecommendation/checkAiReview；`dist/commands/analysis/complete.js` loadFacts 前置校验 |

> **缺口 A 的历史证据（2026-10-26 晚补充，北落师门 FOMA-37 / TFS 258296 复盘）**：该缺口并非新引入——multica 工具仓 `9f3c8f8`（2026-10-13，核心 Skill 第一批）首版 `validate-analysis.ts` 即从 metadata 读 analysis.*，同版 `complete-analysis.ts` 已强制 `gate.result==="PASS"` 前置，关键结构与现行一致（metadata 读取点 + PASS 前置逐行比对，非全文 diff）。北落师门 FOMA-35（10-16）/ FOMA-37（10-19）Gate PASS，是因为执行 Agent 发现 Gate 依赖后**即兴手工补写** draft metadata（证据：FOMA-37 metadata draft 键与 gate 键共存；Gate 输出手工落盘为 change 内 `analysis-gate-result.json`；07:16 评论记录状态手工补写）。WNDF-8 是同一缺口首次遇到「严格按 SKILL.md 执行、不即兴补步」的 Agent 而原形毕露——**缺口是真实契约缺陷，此前被 Agent 经验掩盖**。
| B | **`--openspec-root` 语义偏差**：参数名字面义为「OpenSpec 根仓」，实际实现 `join(openspecRoot, "changes", changeRef)` 并以之为 cwd 跑 `openspec validate`，期望的是 `openspec/` 目录本身；传根仓路径时报错 `Change 目录不存在: <根仓>\changes\…`，把用户引向错误方向 | CLI 健壮性 + 文档缺口 | `dist/commands/analysis/validate.js` checkChange / checkOpenSpecValidate；同族 WNDF-5 的 gate.reasons_ref 记录为 `--openspec-root openspec` |
| C | **并发操作无防护**：本地会话与平台 Run 可同时读写同一 Issue 的 metadata/status，无 revision/ETag 检测，回滚操作可 silently 破坏另一执行体刚落账的事实 | 运行时治理缺口（本次靠人工兜底） | 时间线「事故」行 |

## 3. 现状关键事实（skill-flow 0.1.3）

- `analysis validate` 只读：Issue metadata + Change 目录 + `openspec validate --strict`，不写任何状态；
- `analysis complete` 动作序列：写 9 个 `analysis.*` 键（7 个 facts 键 + `gate.result/gate.reasons_ref`）→ `status=analysis_review`（--no-start）→ 回读确认 → TFS 段置「已分析」；
- `complete` 的 metadata 写入是**逐键幂等**的——即 draft 键若已由其他途径写入同值，`complete` 重写无副作用（方案 A 的兼容性基础）；
- 同族 WNDF-5（259862）metadata 完整形态证明：draft 键与 gate 键共存是设计内的终态，本方案不是新语义，是把缺失的中间态正规化；
- `multica issue metadata set --key --value --type string` 单键写入能力已具备，draft 写入无平台侧阻塞点。

## 4. 方案 A：draft Facts 写入收口（核心缺口）

### 4.1 候选方案对比

| 方案 | 内容 | 优点 | 缺点 |
|---|---|---|---|
| A1 纯文档补齐 | 在 `workitem-analysis` / `analysis-completion` SKILL.md 写明「Gate 前由 Agent 用 `multica issue metadata set` 写入 7 个 draft 键」 | 零代码改动，当天可落地 | 7 次 CLI 调用靠 Agent 手工拼装，键名/值格式（focus_refs 必须是 JSON 数组字符串）无确定性保障，写错即 Gate FAIL 且报错不指向笔误；**已有实证**：同一文档约定下 FOMA-37（10-19）Agent 即兴补步成功、WNDF-8（10-26）Agent 严格按文档执行失败——纯文档方案的执行确定性不足 |
| **A2 新增 `skill-flow analysis stage`（推荐）** | 新增确定性命令：`skill-flow analysis stage --issue <id> --facts <facts.json>`，facts 为**不含 gate 段**的 Handoff Facts；脚本校验字段 → 写 7 个 draft 键 → 回读确认 | 键名/格式/回读全确定性；与 complete 共用 loadFacts 校验逻辑（子集）；幂等；Agent 只需维护一个 facts.json（后续 complete 复用同文件补 gate 段） | skill-flow 加一个命令，需发版 |
| A3 validate 支持 `--facts` | Gate 改为读 facts 文件而非 Issue metadata | 消除中间态 | 违背「Gate 检查平台事实（Issue 上的记录）而非本地文件」的设计语义；draft 不落账则 Gate 之后、complete 之前 Issue 上仍无分析事实可读 |

### 4.2 推荐：A2 + A1 文档同步

**`skill-flow analysis stage` 契约草案**：

```text
用法: skill-flow analysis stage --issue <issue-id> --facts <facts.json>
        [--workspace-id <id>] [--multica <cli>]

facts.json（draft 形态，禁止含 gate 段——Gate 未跑即写 gate.result 视为契约违规）:
{
  "route": "bug-fix | production-fix | sdd-fast",
  "change_ref": "<openspec-change-id>",
  "verify_agent": { "recommendation": "required|not_required", "reason": "...", "focus_refs": ["..."] },
  "ai_review": { "verdict": "APPROVED|NEEDS_REVISION", "findings_ref": "..." }   // sdd-fast 必填；非 sdd-fast 可缺省
}

动作:
  1. 字段校验（复用 complete loadFacts 的字段规则，gate 段存在 → exit 2 拒绝）;
  2. Issue 可读性确认（防静默读错工作区，与 validate 同一守卫）;
  3. 逐键写入 7 个 analysis.* draft 键（不写 gate.*）;
  4. 回读确认全部一致。

退出码: 0 = 写入且回读一致; 2 = 前置/回读失败; 3 = UNKNOWN（Issue 不可读等）
幂等: 同值重写无变化；与后续 complete 的重写天然兼容。
```

**SKILL.md 文档同步（A1 部分）**：

- `workitem-analysis/SKILL.md` §Procedure 第 6 步「收口」前补一句：draft Facts 经 `skill-flow analysis stage` 落账（或注明 stage 由 analysis-completion 执行——归属见下）；
- `analysis-completion/SKILL.md` §Procedure 改为四步：**0. stage 写入 draft Facts** → 1. Gate → 2. gate.* 落入 facts → 3. complete；
- §Error Handling 补：stage 退出码 2 时按输出修正 facts 重跑（幂等）。

**stage 归属裁定建议**：放在 `analysis-completion` 的 Procedure 第 0 步（同一 Run 内 Gate 之前），而非 workitem-analysis——理由：draft 写入是「收口」动作的一部分，且 analysis-completion 已是 Gate/complete 的唯一入口，三步闭环在一个 Skill 内更不易漏步。workitem-analysis 只负责产出 facts.json 内容。

### 4.3 迁移兼容

- 存量已收口 Issue（含 WNDF-5）：不触碰；
- 进行中的 Issue（draft 键已被 Agent 手工写入，如本次 WNDF-8 补验场景）：stage 幂等重写，无冲突；
- `analysis validate` 行为零变化。

## 5. 方案 B：`--openspec-root` 语义修正

### 5.1 推荐：CLI 防御性归一 + 文档澄清

**`analysis validate` 入口归一逻辑**（`complete` 不涉及路径，仅 validate）：

```text
解析 openspecRoot:
  <root>/changes 存在           → 按现状使用
  不存在但 <root>/openspec/changes 存在
                                → 自动归一为 <root>/openspec，stderr 提示一行
                                  "openspec-root 已归一为 <root>/openspec（传入的是根仓路径）"
  两者都不存在                   → FAIL（exit 2），reason 明确列出探测过的两个路径，
                                  不再只报误导性的 join 结果
```

归一而非报错的理由：传根仓路径是符合参数名字面义的合理误用（本次实测即如此），防御性归一与 `tfs reconcile` 等命令的容错风格一致；stderr 提示保留可观察性，不静默。

### 5.2 文档同步

- `analysis-completion/SKILL.md` §Procedure 第 1 步命令块注释：`--openspec-root <根仓 openspec/ 目录>`（0.1.4 起兼容传根仓路径，自动归一）；
- 检查 `projects/multica/` 下其他引用 `analysis validate` 的资产（delivery-flow 等）同步措辞。

## 6. 方案 C：并发操作防护（建议暂缓，另立方案）

本次事故的直接原因是本地会话与另一执行体并行操作同一 Issue。候选方向（不在本方案内开发）：

- skill-flow 写命令（stage/complete/status 类）支持 `--expect-revision <n>`：读后写带期望值，revision 漂移即 exit 3 交人工；
- 或平台侧同一 Issue 的 Run 串行化（锁/队列）。

建议：先立运维约定——**同一 Issue 的收口类命令（stage/validate/complete）只允许一个执行体**（平台 Run 优先，本地执行前先确认无活跃 Run）；revision 检测另立方案评审。本方案仅把该约定写入 `analysis-completion/SKILL.md` §Error Handling。

## 7. 改动清单与影响面

| 资产 | 改动 | 类型 |
|---|---|---|
| `tools/skill-flow/src/commands/analysis/stage.ts` | 新增（§4.2 契约） | 代码 |
| `tools/skill-flow/src/commands/analysis/complete.ts` | 抽取 loadFacts 字段校验为共享函数供 stage 复用；`metadataEntries` 拆出 draft 7 键子集 | 代码（重构，行为不变） |
| `tools/skill-flow/src/commands/analysis/validate.ts` | openspecRoot 归一 + 报错改进（§5.1） | 代码 |
| skill-flow 版本 | 0.1.3 → 0.1.4，CHANGELOG 记录 stage 新增与 validate 归一 | 发版 |
| `workspace-skills/analysis-completion/SKILL.md` | Procedure 加第 0 步 stage；openspec-root 注释；§Error Handling 加 stage 重试与并发约定（§6） | 文档 |
| `workspace-skills/workitem-analysis/SKILL.md` | §Procedure 第 6 步 / §Output 指向 stage 落账 | 文档 |
| references 冻结契约 | 若 draft 写入步骤进冻结契约需同步；裁定建议：stage 属执行细节，写 SKILL.md 即可，不动冻结契约 | 裁定待评审 |

无下游消费者受影响：`dev`/`pr`/`delivery` 各 Gate 只读终态键（含 gate.*），draft 中间态对它们不可见。

## 8. 验证方案

1. **stage 契约验证**：用 WNDF-8 facts（draft 段）跑 stage → 回读 7 键一致；重复跑 → 幂等无 diff；facts 混入 gate 段 → exit 2 拒绝；
2. **闭环回放（WNDF-8 场景）**：stage → validate（8/8 PASS）→ facts 补 gate 段 → complete → status=analysis_review + 9 键 + TFS 已分析，与 WNDF-5 终态形态比对一致；
3. **归一验证**：validate 传根仓路径 → 自动归一并 PASS（stderr 有提示）；传不存在路径 → FAIL 且 reason 列出两个探测路径；
4. **回归**：WNDF-5 已收口 Issue 上重跑 validate → 仍 PASS；对 tfs.type=Bug 的 Issue 跑 validate → task_estimates 分支行为不变；
5. **文档一致性**：grep `projects/multica/` 全部资产，无残留「根仓路径」歧义措辞。

## 9. 验收标准

- `skill-flow analysis stage` 存在且契约行为同 §4.2（含幂等与 gate 段拒绝）；
- `analysis validate` 传根仓路径或 openspec/ 目录均 PASS，错误路径的 FAIL reason 指向明确；
- 两个 SKILL.md 更新后与脚本行为逐条可对（按 `agents/_shared/review-checklist.md` 评审，红线 R9：不引用 archive/docs）；
- skill-flow 0.1.4 发布，CHANGELOG 完整；
- WNDF-8 按新流程重新收口成功（届时它仍是 in_progress，是现成的端到端验收样本）。

## 10. 风险与开放项

- **stage 与 complete 的 facts 校验规则漂移**：靠共享 loadFacts 字段校验函数消除（§7 重构项），评审时确认两处调用同一实现；
- **并发约定靠人守**：方案 C 未落地前，WNDF-8 类事故只能事后回滚兜底——本次已验证回滚路径可行（metadata/status/TFS 三段均可逆），但应限制在收口命令幂等的前提下；
- **开放项**：draft 写入是否进冻结契约（references/）、方案 C 是否立项、stage 是否同时被 `delivery-flow` 等其他 Skill 引用——评审时裁定。

## 11. 评审记录

（待填）
