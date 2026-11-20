# Engineer Run 效率优化落地方案（Frontend Engineer 耗时/token 治理）

> 状态：2026-11-03 已实施——P0-1（local-validation 两条契约）、P0-2（frontend/backend instructions 并行纪律）、P1-1（dev pr-prep，skill-flow 1.0.6，5 桩测试通过）、P1-2（development-execution 引用）、P2-1（scripts/run-profile.py，经 WNDF-43 归档验证）全部落地；端到端验证待 WNDF-52 Engineer Run（§6）
> 依据：`projects/multica/logs/WNDF-43/`（ANALYSIS-frontend-engineer.md + 07-frontend-engineer-implement 消息归档）
> 日期：2026-11-03
> 姊妹篇：`analyst-run-efficiency-optimization-plan.md`（Analyst 侧，已实施并验证）
> 评审：2026-11-03 对抗性审核 R1-R6 已应用——OpenSSL 主建议反转（legacy-provider 优先于切 Node 16，实测 Node 22/24 有效）、lint 规则去除基线对比表述、收益口径下修（-35%→-27%）、验证改分段指标为主、补验证 fallback、声明 pr_prep 竞态 non-goal
> 复核：2026-11-03 正向复核 F1-F5 已应用——OpenSSL 前置条件化（仅 Node ≥17，Node ≤16 未知选项启动即失败）、pr-prep 签名补 `--config`、合计口径注明取下界、段切分与总时长对账、P0-2/P1-1 验收基线写死为 WNDF-43 实测 tool_use 计数（pr_prep 段原估 ~9 轮校正为实测 13 轮）

## 1. 背景与证据基线

WNDF-43（TFS 261015，sdd-fast）Frontend Engineer Run `01a1867f-077d-75d5-8eed-0103461e03e4`（tasks 1.1/1.2 实现）：

- 耗时 **18.5m**（07:10:53→07:29:21 UTC），152 条消息（65 tool_use / 22 text），约 70-87 轮
- 用量：input 70,324 / output 20,402 / **cache_read 3,427,328**（k3）
- 时间切分：**LLM 推理 15.6m（84%）** + 工具执行 2.8m（16%）

核心机制与 Analyst Run 同构且更极端：轮数是耗时与 cache_read 的共同乘数（前缀 ~40-50k/轮），工具执行几乎不耗时，**压轮数即压一切**。三个浪费段合计 ~10m（54%）、~36-39 轮（~50%）。

### 阶段切分（实测）

| 段 | 耗时 | 性质 |
| --- | --- | --- |
| seq 1-21 准入/dispatch 预检 | 1.7m | 合理 |
| seq 25-43 开工+定位+Edit | 1.9m | 合理（实现一次命中） |
| seq 45-81 验证环境挣扎 | **5.2m（28%）** | 浪费段① |
| seq 84-98 取证+提交推送 | 1.5m | 基本合理 |
| seq 101-128 pr_prep | **3.6m（19%）** | 浪费段② |
| seq 131-145 completion 往返 | **1.2m（6%）** | 浪费段③（已修复） |
| seq 148-152 回流评论 | 0.5m | 合理 |

注：七段合计 15.6m；与总时长 18.5m 的差值 ~2.9m 为六个段间间隙（工具序列之间的 LLM 思考/过渡，合计 ~169s）及段内推理余量，不构成独立段，也不作为优化对象。

### 已证伪的干扰项（防止方案建立在错误前提上）

| 初判 | 证伪证据 | 真相 |
| --- | --- | --- |
| 工具执行慢 | 工具总耗时 2.8m（16%），含两次全仓 build | 瓶颈在 LLM 轮数，不在命令执行 |
| 实现质量差致返工 | Edit 一次命中（177-181 行），零实现返工 | 浪费全部在验证环境与交付契约环节 |
| multica server 抖动 | 本 Run 无超时/空响应记录 | 与 Analyst Run 归因 1 无关 |

### 已被后续变更消除的归因（不计入本方案收益）

| 归因 | Run 中损失 | 消除方式 |
| --- | --- | --- |
| tasks 勾选悖论（check 判未勾选 FAIL ↔ skill 要求 PASS 后才准勾选） | 1.2m、~8 轮 | 0897133b（skill-flow 1.0.5）：改 `task_identity`，未勾选不再 FAIL |
| worktree 干净检出无 node_modules → 接驳三连试 | ~2m、~6 轮 | a4b55daa：废除 worktree，枢纽克隆直检分支（自带 node_modules） |

## 2. 待整改归因（未闭合）

### 归因 E1【主因】构建/验证环境契约缺失（5.2m 段中 ~3m 在枢纽克隆新模式下仍复发）

Run 中实际发生：

- **Lint 基线债自证**（seq 63-71，~1.5m）：`npm run lint` 全仓 838 个既有错误 → agent 无法判断是否自己引入 → 错误分布统计 + 文件级 eslint + `git stash` 后全仓重跑对比 + `stash pop`，3 次全仓 lint + 2 次文件级 eslint，只为证明「债是既有的」。
- **Node 版本踩坑**（seq 74-81，~1.5m）：`npm run build` 报 `error:0308010C:digital envelope routines::unsupported`（本机默认 Node 24，Vue 2 + webpack 4 仓的 md4 hash 与 OpenSSL 3 不兼容）→ 找 `.nvmrc`（无）→ 探测 `nvm root` → 发现 `D:\WN_Platform\tools\nvm\v16.20.2` → 切 Node 16 重跑成功。

契约缺口（已核实）：`frontend-engineering/references/local-validation.md`（验证命令唯一权威）只写 `npm run build` / `npm run lint`，未写：

1. 此类 Vue 2 + webpack 4 仓在 Node ≥17 下构建必败（`error:0308010C`）及其确定性处置；
2. Lint 全仓既有债的判定规则——agent 每个 Run 都要重新自证一次。

### 归因 E2【次因】pr_prep 写入程序未写死（3.6m 段）

Run 中实际发生（seq 104-128）：

- CLI 能力探测 4 连：`issue update --help` → `issue --help | grep meta` → `metadata --help` → `metadata set --help`（~1m）；
- **两段写入**：seq 116 先 set pr_prep（无 `description_ref`）→ 补写 pr-description 文件 ×3+Edit（seq 119-126）→ seq 128 重写 pr_prep。

契约现状：`pull-request/references/pr-facts-contract.md` 有完整 schema，`development-execution/SKILL.md:42` 有「合并本仓 pr_prep metadata」要求，但**无可执行命令序列**——ls-remote 核 HEAD → 写描述文件 → 单条 metadata set → 回读，这 ≥4 步固定顺序操作未脚本化（§3 杠杆②）。

### 归因 E3【结构性】串行单发工具调用

两个 Run 共 110 次 tool_use 几乎全为串行单发；无依赖读取（入口事实、契约文件、代码定位）未并行。读密集段（准入、取证）可省 30-50% 轮数，零开发成本。

### 归因 E4【小额】入口/取证回读（~0.7m、~4 轮）

seq 1-5 入口三连读（issue get + comment list roots + thread）；seq 84-88 提交前回读自己刚写的 spec。不单独立项，随 E3 一并约束。

## 3. 整改项

### P0-1 local-validation.md：补 OpenSSL 兼容与 Lint 基线两条契约（归因 E1）

- 范围：`projects/multica/workspace-skills/frontend-engineering/references/local-validation.md`
- 内容：
  1. **工具链事实增补**：此类 Vue 2 + webpack 4 仓在 Node ≥17 下 `npm run build` 必现 `error:0308010C`（OpenSSL 3 与 webpack 4 md4 不兼容）；统一处置为构建/验证命令前置 **`NODE_OPTIONS=--openssl-legacy-provider`**（2026-11-03 实测 Node 22/24 有效）。**仅当 `node -v` ≥17 时前置**——该选项 Node 17 才引入，Node ≤16 视为未知选项、进程启动即失败，无需且不可加；命令形态按 POSIX shell（bash）书写，cmd/PowerShell 形态不同（daemon 与本地 agent 运行时均走 bash）。切 Node 16 仅作备选并按当前运行时解析——**契约不写机器路径**（生产 daemon 172.17.1.97 无 nvm，ThinkBook 路径对其他运行时无效）。适用范围：datamodel-web 经 WNDF-43 Run 实证；其余 DF web 仓按同构推断，首跑验证后回填本表（原实测仅 dataintegration/metadata/dataasset-web 三仓）；
  2. **Lint 判定规则**：只对改动文件执行 `npx eslint <改动文件>`；**仅 `git diff` 触及行上的新增错误判 FAIL**，文件内既有错误忽略；**不执行全仓 `npm run lint`**（~838 个既有错误属基线债，不判 FAIL，亦不做 stash/临时检出对比自证——「建立改动前基线」正是要消灭的行为）。
- 验收：下一个前端 Engineer Run 无 `error:0308010C` 诊断循环、无全仓 lint 执行、无 stash/临时检出行为；build/lint 合计执行 ≤2 次。
- 收益：~3m + ~10 轮 / 每个前端 Run。

### P0-2 工程师 instructions：并行读取纪律（归因 E3）

- 范围：`projects/multica/agents/frontend-engineer/instructions.md` Execution Principles 段（Backend Engineer 同款则同步 `_shared`）
- 内容：增补一条——无依赖的读取/探查在同一轮内并行发起（多 tool_use 单轮），不串行逐个等待；入口事实（Issue、Comments、Change 文件）首轮一次读齐。
- 验收：下一个 Run 的准入+取证段工具轮 ≤9 次——基线写死为 WNDF-43 归档实测：准入段（seq 1-21）11 次 tool_use、取证段（seq 84-98）7 次，合计 18 次；且无「读 A→想→读 B→想→读 C」链。
- 收益：~1m + ~5-8 轮 / Run，零开发（**低置信度假设**——instructions 原则对执行体行为的约束力未经验证，以 A/B 实测为准，不达预期不视为缺陷）。

### P1-1 skill-flow dev pr-prep：一段写入脚本化（归因 E2，§3 杠杆②）

- 范围：`tools/skill-flow/src/commands/dev/pr-prep.ts`（新增）
- 内容：一条命令完成全序列——读取既有 `pr_prep`（保留其他仓条目）→ `git ls-remote` 核候选分支 HEAD == candidate_commit → 按模板生成/核对 `pr-description.md`（落 `openspec/changes/<change_ref>/`）→ 单条 `multica issue metadata set` 合并写入 → 回读核对。命令签名含 `--config "<config-path>"`（沿用 Entry Guard 的 repo-registry 配置，与 check-dispatch 对齐），`repo_key` 合法性校验与本地 `repo_path` 解析均经 registry。输出契约沿用「stdout 纯 JSON / stderr 日志 / 0=PASS 2=FAIL 3=UNKNOWN」；读类调用复用 P0 瞬态重试（`transient: true`）。
- 设计理由：≥3 步固定顺序的确定性操作脚本化是消除探测轮与两段写入的标准手法（同 check-completion 模式）；skill 层只留一句调用说明。
- 验收：
  1. 桩测试：既有 pr_prep 含他仓条目时合并不覆盖；
  2. candidate_commit ≠ 分支 HEAD 时 FAIL 且不写 metadata；
  3. 端到端：Engineer Run 的 pr_prep 段从 13 次工具轮（WNDF-43 seq 101-128 实测 tool_use 数，原估 ~9 轮已校正）压到 ≤3 轮（含失败分类处置）。
- 收益：~1.5m + ~4 轮 / 每个需 PR 的 Run（脚本只接管确定性管道：核 HEAD、合并写、回读；pr-description 的语义撰写仍归执行体——若改以模板生成换取更多轮数，属质量换效率的权衡，本方案不采纳）。
- non-goal：多仓并发 pr_prep 的读-改-写竞态为既有问题（当前手工流程同存），本项不修复也不恶化。

### P1-2 development-execution SKILL：引用 pr-prep 命令（归因 E2 配套）

- 范围：`projects/multica/workspace-skills/development-execution/SKILL.md` PR Preparation 步骤
- 内容：改为「执行 `skill-flow dev pr-prep --config "<config-path>" --issue <KEY> --repo <repo_key> --change-ref <ref> --candidate-commit <sha>`」一句，删除自然语言描述的多步程序；FAIL 时按 reasons 分类（HEAD 不一致回流 Lead / 其他 UNKNOWN 停止）。
- 依赖：P1-1。

### P2-1 验证活动画像入库（可选）

- 内容：把本方案的段切分口径（准入/实现/验证/交付/回流）固化为 run-messages 分析脚本（`projects/multica/scripts/` 或 skill-flow dev 子命令），后续任何 Run 一键出「阶段耗时 × 轮数 × cache_read」对照表，替代手工 Python 分析。
- 收益：后续每次优化评审省 ~30m 人工分析；不直接影响 Run 本身。

### 不实施项

- **tasks 勾选悖论修复、worktree 模式废除**：已由 0897133b / a4b55daa 完成，本方案不重复。
- **入口三连读合并为 skill-flow 命令**：小额（~0.5m），且入口读取形态随派发类型变化，契约化收益不抵成本。

## 4. 实施顺序与依赖

```
P0-1 (local-validation 两条契约)   ── 独立，几行字，最先做
P0-2 (instructions 并行纪律)       ── 独立，零风险
P1-1 (dev pr-prep 脚本) ──→ P1-2 (development-execution 引用)
P2-1 (画像脚本)                    ── 独立，最后
```

配套动作（每次实施后）：技能/指令变更同步平台工作区（wn_df_1029 先行验证，wn_df 按既有同步纪律）；skill-flow 变更需 `npm run build` + 更新全局安装。

## 5. 预期收益（以 WNDF-43 Engineer Run 为基线）

| 项 | 回收 | 说明 |
| --- | --- | --- |
| P0-1 | ~3m + ~10 轮 | OpenSSL/lint 契约消灭诊断循环（枢纽克隆模式下仍复发项） |
| P0-2 | ~1m + ~5-8 轮（低置信） | 读密集段并行，以实测为准 |
| P1-1+P1-2 | ~1.5m + ~4 轮 | pr_prep 确定性管道；语义撰写留执行体 |
| 已修复项（基线外） | （1.2m + ~8 轮） | 0897133b/a4b55daa 天然生效，不计入本方案收益 |
| **合计** | **18.5m → ~13.5m（-27%）**；轮数 ~70-87 → ~55；cache_read 3.4M → ~2.5M（-26%） | 估算基线为同复杂度前端实现；分项合计 5.5m，合计行取下界 5.0m（收益段间可能重叠，不重复计） |

收益外溢：P0-1/P0-2/P1 对 Backend/Flink Engineer 同构生效（共用 development-execution 与 instructions 骨架）；P0-1 的 Node 契约同样消除人工开发的踩坑。

### 验收对照（WNDF-52 Engineer Run，2026-11-03，详见 logs/WNDF-52/ANALYSIS-frontend-engineer.md）

| 指标 | 目标 | 实测 | 判定 |
| --- | --- | --- | --- |
| OpenSSL 诊断循环 | 无 | node -v → legacy-provider 前置，build 一次 PASS | ✅ |
| stash/全仓 lint | 无 | stash 无；全仓 lint×2（读契约前旧惯性，此后转文件级） | ⚠️ 缺口=D2 加载时机 |
| 环境段 | ≤1.5m | 2.1m（剔除惯性 lint 后 ~1.1m） | ⚠️ 同上 |
| pr_prep 段 | ≤3 轮 | 1 次调用 PASS，PR 3598 端到端闭环 | ✅ |
| 准入+取证 | ≤9 次、无串行链 | 并行读生效，准入 1.7m→45s | ✅ |
| 总时长（参考） | ~13.5m | 13.7m（-26%）；方案外新缺陷 update-progress CRLF 循环 +4.6m（D1） | 参考 |

修复 D1（update-progress CRLF 正则）与 D2（验证前必读 local-validation）后，同复杂度 Run 预期 ~8-9m。

> 2026-11-03 D1/D2/D3 已修复（skill-flow 1.0.7，11/11 桩测试通过）：D1 CHECKBOX_LINE 行尾兼容 CRLF（重写行保留原行尾）+ reconcile-workitem 附件映射逐行剥 \r（同类排查，另三处免疫）；D2 development-execution Engineering Loop 前置 local-validation.md 必读；D3 check-completion 删 work_item_ref 存在性校验、evidence 契约改两者必填（死字段，PR 关联走 metadata tfs.id）。待下一个 Engineer Run 复验。

## 6. 验证方式

- **A/B 端到端（分段指标为主）**：WNDF-52（TFS 261056，同页不同按钮，复杂度与 WNDF-43 几乎一致）当前处于 `analysis_review`，批准后自然产生 Engineer Run。**主指标（本方案可归因）**：环境段 ≤1.5m 且无 openssl 诊断循环 / 无全仓 lint / 无 stash 对比；pr_prep 段 ≤3 轮；准入/取证段无串行单发链（P0-2 低置信项单独观察）。**参考指标（归因不可分）**：总耗时、总轮数、cache_read——WNDF-52 必然跑在枢纽克隆 + check-completion 1.0.5 之上，总量收益含 a4b55daa/0897133b 部分，不记入本方案成绩单。
- **验证 fallback**：WNDF-52 批准时间不可控；超过 2 个工作日未批准时，用同 fixture 新建测试 issue 直派 Engineer（绕过分析阶段），或顺延至下一个真实前端需求。
- **桩测试**：P1-1 按验收条覆盖合并/HEAD 不一致/回读三例。
- **回归**：确认 Lint 判定规则不被滥用为「跳过 lint」——改动文件 eslint 新增错误仍判 FAIL；P1-1 失败分类未被当成语义判断（脚本只出 PASS/FAIL/UNKNOWN）。
- 归档：WNDF-52 Engineer Run 消息归档至 `projects/multica/logs/WNDF-52/`，对照表追加到本方案 §5。
