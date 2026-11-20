# Analyst Skill 命令契约回填方案（「命令世界观」修复）

> 状态：已评审（2026-11-07，有条件通过），按 §7 评审修订执行
> 依据：MULT-8（TFS 263181，production-fix）Workitem Analyst Run `01a1b54b-6e3d-7a5e-b919-84386e9f85f6` 全量 run-messages（282 条 / 139 次工具调用）；v1.0.0 与 multica 分支 skill 对比
> 日期：2026-11-07
> 前置：P0-1（resolve-identity 首跑修复）代码与测试已完成，待发布

## 1. 背景与证据基线

MULT-8 分析 Run：耗时 17.9m（09:16:21→09:34:18 UTC），用量 input 108,742 / output 78,233 / cache_read 6,677,120。

对照 `analyst-run-efficiency-optimization-plan.md`（WNDF-43 基线 13.1m，目标 ~8m）：P0 瞬态重试、P1-3/P1-4/P1-5 均已生效（本次无抖动窗口、validate 只跑 1 次、无 archive 考古），但总耗时反超基线。新增损耗按大小排序：

| 归因 | 日志证据 | 损失 |
| --- | --- | --- |
| A1 rondo CLI 源码考古 | seq 192/194（resolve-identity.js）、211/214（stage.js+facts.js）、241/243/244/246（validate.js+complete.js），共 7 次读 dist、36.7KB 入上下文 | ~2.5m + 7 轮 |
| A2 后台失控 grep | seq 103-105：跨 DF 根目录递归 grep 转后台，120s 超时卡死 + TaskStop | ~2.3m 纯浪费 |
| A3 `openspec validate` 首验 FAIL | seq 254（缺 delta）→ seq 256 补 `skip_specs: true` → seq 258 才过 | ~2 轮 + 返工 |
| A4 跨仓考古（工作区缺 metadata 后端仓） | seq 72-161 在 dataintegration / dataintegration-web / monorepo 三仓猎 driverType 语义 | ~4.5m（部分属真实分析） |

## 2. 根因判定（v1.0.0 对比结论）

A1/A3 的共同根因：**skill 契约在 30246a8e 精简时被切掉的恰是执行体做判断所需的三类信息**——

1. **该不该停**：结果完整值域 + 枚举之外真实失败形态；
2. **敢不敢跑**：命令副作用契约（写哪些事实、是否不可逆）、输出结构、退出码语义；
3. **会不会过**：Gate 检查清单、schema 校验约定（skip_specs）。

v1.0.0 保有其中大部分（facts JSON 值域示例、逐命令「脚本动作」、退出码矩阵、resolve-root-repo UNKNOWN 枚举、resolve-identity 五枚举逐值动作）；当前版仅剩命令形态。v1.0.0 契约块 + 当前版语义时效（rondo 名称、commit/push 收口、TFS 剥离、UNKNOWN 分类重试）合并即为目标态。

A1 中 seq 192/194 一段另叠加实现缺陷：resolve-identity 以 `changes/` 存在为探测准则，全新根仓首跑抛未捕获 UnknownError（不在 skill 任何枚举内）。**此缺陷已修复**（见 P0-1）。

## 3. 整改项

### P0-1 ✅ resolve-identity 首跑返回 NOT_FOUND（已完成，待发布）

- 范围：`tools/rondo/src/commands/change/resolve-identity.ts`
- 内容：`resolveOpenspecRootDir` 抛 UnknownError 时区分两种语义——`openspec/` 已定位仅缺 `changes/`（全新根仓）→ `NOT_FOUND` / exit 0 / 结构化 JSON；`openspec/` 定位不到（根路径传错）→ `INVALID` / exit 3（failUnexpected，不再裸堆栈）。
- 测试：`tools/rondo/test/change-resolve-identity.test.mjs` 5 用例（首跑 NOT_FOUND×2 形态 / 定位不到 exit 3 无堆栈 / 两个既有行为回归锚点），全量 68 测试通过。
- 待办：bump 1.2.1 → `npm pack` → 全局安装（需人工确认时机，影响在飞 agent 环境）。

### P1-1 workitem-analysis SKILL：回填三块契约

- 范围：`projects/multica/workspace-skills/workitem-analysis/SKILL.md`（同步目标：各工作区）
- 内容：
  1. 步骤 1 补 resolve-root-repo UNKNOWN 成因枚举（未挂载 local_directory / 多 daemon 缺 MULTICA_DAEMON_ID / 路径无效 / repo-context.yaml 缺失），照 v1.0.0 恢复，命令名保持 rondo；
  2. 步骤 3 恢复 resolve-identity 五枚举逐值动作（含「创建禁令」清单），并新增第六条：**`NOT_FOUND` 含全新根仓无 `changes/` 目录的首跑形态（rondo ≥1.2.1），属合法 NOT_FOUND，按流程创建**；
  3. Output 段补 facts 值域速览（route ∈ bug-fix|production-fix|sdd-fast；recommendation ∈ required|not_required；verdict ∈ APPROVED|NEEDS_REVISION，仅 sdd-fast）；
  4. **Preconditions 增加版本下限：`rondo --version` ≥ 1.2.1**（低于此版本时 resolve-identity 首跑语义不成立，停止并交 Delivery Lead 升级 CLI，不猜测执行）；版本检查并入 `rondo doctor --require` 体检子集，使供给阶段即可发现旧 CLI。
- 验收：下一个首跑分析 Run 无 resolve-identity 相关考古。

### P1-2 analysis-completion SKILL：回填 facts 示例与退出码矩阵

- 范围：`projects/multica/workspace-skills/analysis-completion/SKILL.md`
- 内容：
  1. Preconditions 恢复 facts JSON 完整示例（draft/gate 两阶段，值域同 P1-1）；
  2. stage / validate / complete 各补一行「脚本动作」（副作用契约：写哪些 metadata 键、回读、complete 的 commit/push 白名单语义）；
  3. 补退出码矩阵：exit 2=字段非法修 facts 重跑（幂等）；exit 3=环境性 UNKNOWN 按既有分类重试一次；complete exit 3 时本地 commit 保留、重跑幂等只补 push（现行语义，文档化）。
- 验收：新 Run 无 stage.js/facts.js/complete.js 源码读取。

### P1-3 新增 references/analysis-gate-checks.md（Gate 检查清单）

- 范围：`projects/multica/workspace-skills/workitem-analysis/references/analysis-gate-checks.md`（新增，随 skill 分发；analysis-completion 引用同一文件或各自 references 放副本）
- 内容：从 `tools/rondo/src/commands/analysis/validate.ts` 提取 8 项检查及适用条件：
  `identity`（analysis.route/change_ref 等 metadata 齐全）/ `change`（change_ref 目录存在）/ `acceptance_contract` / `tasks`（tasks.md 存在且任务结构合规）/ `task_estimates`（`[预估: Nh]` 尾注，0<N≤6，**tfs.type=Bug 时 skipped**）/ `verify_recommendation` / `ai_review`（**仅 sdd-fast 检查**）/ `openspec_validate`（CLI 不可用 → UNKNOWN）。
- 溯源约定：文件头注明「事实源 = validate.ts，改动 Gate 时同步本文件」；在 validate.ts 头部 docstring 加反向指针。
- 验收：新 Run 无 validate.js 源码读取；工件一次 PASS。

### P1-4 corrective-change schema：补 skip_specs 约定

- 范围：各根仓 `openspec/schemas/corrective-change/schema.yaml` + `templates/proposal.md`（对齐 intentional-change/schema.yaml:29/48-49 的既有表述）
- **前置步骤（强制，先做）**：确认 `openspec/schemas` 的权威来源与分发路径（根仓自带 vs 平台 provision 供给），以事实源为准改一处、同步其余；未确认前不动笔。
- 内容：写明「Corrective 通常无 Spec-level 行为变化，在 `.openspec.yaml` 设置 `skip_specs: true`；不为校验虚构 Delta」。
- 验收：下一个 production-fix/bug-fix Run 的 `openspec validate --strict` 一次通过（本次 seq 254→258 返工消失）。
- 可行性已实证：MULT-8 Run 中 corrective-change 设 `skip_specs: true` 后 validate 通过（seq 256-259），CLI 侧已支持，缺的仅是文档。

### P1-6 Unknown 交接分级：blocking / non-blocking（评审后增补）

- 背景：MULT-8 Run 的 A4（~4.5m 跨仓考古）与 A2（~2.3m 失控 grep）的共同上游——准入报告委托了三条 unknown 但未标注性质，Analyst 默认当阻塞项逐一闭合；而「`dfDiDatasource/list` 返回是否含驱动类型」实为 non-blocking（修复方向不依赖该答案，前端证据链已自足：git 历史赋值曾存在 + 同接口 `.type` 在 dataverification 组件已被消费，seq 189）。
- 范围：
  1. `projects/multica/agents/wayfinder-agent/instructions.md`——扩展现有第 24 行原则（「可由后续 Analysis 解决且不影响准入的问题，保留为未知项交接」）：准入报告 `unknowns` 段每条**强制标注 `blocking: true/false` + 一句「不闭合会影响哪个决策」**；判据写死：答案会不会改变 Route / Fix Strategy / Scope；拿不准一律 `blocking: true`（保守默认）；
  2. `projects/multica/workspace-skills/workitem-analysis/SKILL.md` 步骤 1 补一条处置规则：**blocking 项未闭合才允许停止交 Human；non-blocking 项不要求闭合**，在 proposal 的 Root Cause/假设段标注 `probable` 并写明假设内容、依据、验证方式与验证环节（成为 Verify/实现阶段的显式检查点）；
  3. `projects/multica/agents/workitem-analyst/instructions.md` 同步一条 Boundary：不因 non-blocking unknown 未闭合而停止分析。
- 流程影响面（评审已确认可控）：不动状态机 / Gate / 收口命令（`validate.ts` 不检查 unknowns 段，零代码改动）；假设以明文进 proposal 且照常过 `analysis_review` 人工审核，放行权仍在 Human；存量 Issue 准入报告无标注时按 blocking 处理（保守，无回归）。
- 风险与对策：误分类（blocking 被标 non-blocking 致方向性返工）→ 判据写死 + 保守默认 + 人工审核兜底三层。
- 验收：下一个含 non-blocking unknown 的分析 Run 中，unknown 以假设形式进 proposal（含验证方式），无为其闭合而产生的跨仓考古；含 blocking unknown 的 Run 行为不变（未闭合即停止交 Human）。

### P2-5 rondo 子命令 help 补语义（纵深防御）

- 范围：`tools/rondo/src/commands/analysis/{stage,validate,complete}.ts`、`change/resolve-identity.ts`
- 内容：usage 行之外补三行：输出 JSON 结构、退出码语义、关键行为规则；`--help` 退出码归一（现为 0 与 64 混出）。
- 收益：skill 未加载或版本漂移时 CLI 自描述兜底。
- 优先级 P2：P1 落地后此为冗余层，可延后。

### 不实施项（评审建议）

- A2（失控 grep）不写入 skill：属执行体通用纪律（先例：P2-6 评审不实施），非契约缺口；其上游诱因（unknown 未分级导致的盲目闭合）由 P1-6 治理。
- A4 的工作区供给侧（metadata 后端仓本机缺失）不在本方案：归工作区供给问题（repo-registry 标注本机缺失、blocking unknown 显式留 Human）；其分析侧范围失控由 P1-6 治理。

## 4. 实施顺序与依赖

```
P0-1 发布 1.2.1（已完成代码，待人工确认全局安装时机）
P1-3（Gate 清单新文件，事实源提取）── 独立，可最先做
P1-1 / P1-2（回填，引用 P1-3）──── 可并行
P1-4（schema skip_specs）───────── 独立（前置：确认 schemas 事实源）
P1-6（unknown 分级）────────────── 独立（wayfinder/analyst 两处 instructions + workitem-analysis，随 sync 分发）
P2-5 ──────────────────────────── 最后，纵深冗余
批次建议：第一批 P0-1 发布 + P1-3 + P1-4；第二批 P1-1 + P1-2 + P1-6（随工作区 sync 分发）；第三批 P2-5。
```

## 5. 预期收益（以 MULT-8 分析 Run 为基线）

| 项 | 回收 | 说明 |
| --- | --- | --- |
| P0-1 | 消灭首跑裸异常 | seq 170-208 的崩溃→考古→试探链大部分不再发生 |
| P1-1+P1-2+P1-3 | dist 源码考古归零 | seq 192/194/211/214/241/243/244/246 共 7 次 |
| P1-4 | ~2 轮 | openspec validate 一次过 |
| P1-6 | 上限 ~4.5m（A4 的盲目闭合部分） | non-blocking unknown 带假设推进，不做方向无关的跨仓考古；实际回收取决于后续 Run 的 unknown 构成，不计入合计下限 |
| 成本 | +30~40 行 skill 文本 + 两处 agent instructions 各 1-2 行 | 每次分析 Run 多 ~1k token 加载，远小于回收 |
| **合计** | **17.9m → ~13.5-14m**（评审修订 R1：P0-1 与 A1 时段有重叠，收益不相加；A2 的执行体纪律改进不在内；P1-6 为上浮空间） | 对照 WNDF-43 目标 ~8m 的差距主要在 A4 真实分析量 |

## 6. 验证方式

- 单元/契约：P0-1 已附 5 用例；P2-5 附 cli-surface 锚点更新。
- 端到端：下一个全新根仓的 production-fix Run 对照本基线核对：无 `dist/**` 源码读取、resolve-identity 首跑 NOT_FOUND exit 0、`openspec validate` 一次通过、stage/validate/complete 无试探性调用；含 non-blocking unknown 时，unknown 以 probable 假设形式进 proposal（含验证方式与验证环节），无为其闭合的跨仓考古。
- 回归：run-messages 轮数与 cache_read 对比（评审修订 R2：139 次工具调用预计降至 ~125，而非 ~110——考古 7 次 + 崩溃链试探 ~4 轮 + validate 返工 2 轮 ≈ 减 13 轮；P1-6 生效时另有下浮空间）。

## 7. 评审修订记录（2026-11-07）

- **R1 收益重叠**：P0-1 与 A1 共享 seq 192/194 时段，合计收益改为不相加，目标区间修正为 ~13.5-14m。
- **R2 轮数估算**：139 → ~125（原 ~110 偏乐观）。
- **R3 版本下限守卫**：P1-1 新增 Preconditions 版本下限（rondo ≥1.2.1）+ 并入 `rondo doctor --require` 体检；低于下限停止交 Delivery Lead，防止旧 CLI 工作区遭遇「文档说 NOT_FOUND、实际裸堆栈」的反向困惑。
- **R4 P1-4 前置**：「确认 openspec/schemas 权威来源」从备注提升为强制前置步骤。
- **R5 已知语义瑕疵（不阻塞）**：修复后「openspec/ 定位不到」走 failUnexpected → `result: "INVALID"` + exit 3，与 docstring 中 INVALID=exit 2（候选损坏）词汇混用；受 `Answer` 五枚举类型约束暂保留，实施 P0-1 发布时在 docstring 补「exit 3 时 result 固定为 INVALID，语义以退出码为准」。
- **R6 P1-6 增补**：评审后讨论确认 A2/A4 的共同上游是「unknown 交接未分级」，新增 P1-6（blocking/non-blocking 分级）。流程影响面已评估：不动状态机/Gate/收口命令（零代码改动），假设明文进 proposal 照常过人工审核，存量无标注按 blocking 保守处理——放行权始终在 Human，变更性质是「判断从自由裁量上移为标注责任」。**P1-6 为评审后增补项，实施前需评审确认。**
- 评审核验记录：Gate 8 项检查清单与 validate.ts 逐条吻合；stage/complete 退出码矩阵与现行源码一致（v1.0.0 旧矩阵的 TFS 段已剥离，不可照搬）；resolveOpenspecRootDir 漏捕为单点缺陷（validate.ts 本有 catch），P0-1 修复无连带影响。
