# 流程评审：TFS 需求自动拉取 → 最终交付

> 评审对象：`docs/02-multica-delivery-lifecycle-design-v1.6.6.md` 定义的端到端交付流程
> 评审依据：`docs/01-multica-openspec-design-guideline-v1.16.3.md` 的原则与机制边界
> 评审日期：2026-10-12
> 结论：**设计自洽、质量高；属于"自动执行 + 人工把关"的半自动流水线，非无人值守；当前为设计基线，实现与验收未到位。**

---

## 1. 评审结论（摘要）

> **流程设计符合要求：闭环完整、边界清晰、人工闸门位置合理、失败恢复严谨。**
> **当前状态是"可评审的设计基线"，距离"可运行的自动化交付"差的是：下游方案 + Skill/Script 实现 + 安装版本验收，而不是流程本身的设计缺陷。**

"自动化"的实际形态：

```text
自动：TFS 同步、分析执行、Gate 检查、研发执行、PR 创建、状态对账、收口归档
人工：启动（backlog→todo）、分析批准、PR 审核合并（TFS）、abandoned 决策、异常升级
```

---

## 2. 链路逐段评审

### 2.1 TFS → Delivery Issue（自动化，成熟）

```text
Autopilot 定时 → TFS Sync Agent（薄适配器）→ reconcile-workitem.ts → backlog
```

- ✅ 模式正确：Agent 不做业务判断；幂等、身份校验、"已存在只更新管理字段、不动执行状态"全部在确定性脚本里；
- ✅ 明确不主动启动研发，防止"同步即开工"；
- ⚠️ 此段之后流程停止：`backlog → todo` 是**人工动作**（02 §4.1）。自动化拉取只到入库为止，启动靠人。

### 2.2 启动 → 分析（自动唤醒，设计简洁）

```text
人工 todo → Multica 原生唤醒 Delivery Lead → @Workitem Analyst → 分析
```

- ✅ 无多余启动脚本（`start-analysis.ts` 已在演进中移除），复用 Squad 原生机制；
- ✅ 分析路由四维解耦（TFS Type ≠ Change Kind ≠ Route ≠ Schema），TFS Bug 与需求型修复正确汇合到 corrective；
- ⚠️ 分析质量完全取决于 03 文档定义的 `workitem-analysis` 方法族——**03 不在仓**，是当前最大实现缺口。

### 2.3 Analysis Gate → 人工审核（人工闸门 #1，必要且严谨）

- ✅ 三段式职责干净：Gate 查硬条件 → Analyst 写状态并回读 → Human 自然语言决定 → Lead 语义理解；
- ✅ 反作弊设计到位："引文含 APPROVED 不算批准"、"Agent 自述不算批准"、"`in_progress` 不是批准证据"；
- ✅ Verify Agent 决策权清晰：Analyst 推荐 → Human 终裁 → 确定性落成 `verify_agent.required`；
- ⚠️ 这是**强制性人工阻塞点**——有意的质量设计，需在预期管理上对齐，不是缺陷。

### 2.4 研发投影 → 执行 → 聚合（最见功力的一段）

- ✅ `task_refs` 引用 OpenSpec `tasks.md`，不建第二套任务模型；Sub-Issue 仅在需要独立运行状态时创建——扼杀"任务一多就拆 Issue"的腐化路径；
- ✅ Local Validation + Code Review 与 Verify Agent 解耦，质量底线不依赖独立验收是否启用；
- ✅ Run Boundary Contract 防止为确定性动作白白开 Run；
- ⚠️ **共享 `tasks.md` 并发写入**：方案只写了"受控写入 / 串行化机制由后续实现采用"，多 Engineer 并行时的 checkbox 冲突方案**尚未定义**；
- ⚠️ 父级回流依赖"经安装版本验证能回流到 Squad Leader 的路径"——02 §8.2.3 自标注**未验收**。

### 2.5 独立验证（按需，三层模型合理）

- ✅ Task 级 → Change 级 → 独立验收三层递进；"Integration/E2E 是方法不是阶段"；
- ✅ 证据失效规则（§9.7）与循环保护（§9.9，≥3 轮升级人工）防止无限返工和旧证据滥用；
- ✅ Verify Agent 启动的"自锁"问题（等所有任务完成才能启动 Verify，但 Verify 自己拥有部分任务）已在 v1.4.17 修复。

### 2.6 PR → 合并 → 收口（人工闸门 #2 在外部系统，边界正确）

- ✅ Preparation（语义）/ Materialization（副作用）拆分——不为建 PR 重开 Engineer 上下文；
- ✅ PR 审核过程完全留给 TFS，Multica 只认 `active / completed / abandoned` 三个终态，不复制外部状态机；
- ✅ abandoned 只报事实不猜原因，Human 用 `NEXT` 决策，路由确定性化；
- ✅ 收口幂等恢复严谨：pending_event / event_key、只补缺失、禁 `reset --hard`、禁 `--yes` 绕归档；
- ⚠️ **PR 合并在 TFS 由人完成**——第二个人工闸门（外部系统）。

---

## 3. 总体判定

### 3.1 流程是否符合要求：符合

| 评审维度 | 结论 |
|---|---|
| 职责分离 | ✅ Analyst / Engineer / Verify / Lead 边界无重叠，互相不能替代 |
| 确定性 vs 语义 | ✅ 脚本管硬条件，Agent 管语义，Human 管批准，无混层 |
| 状态一致性 | ✅ 无第三套状态机；Dual Truth 用引用衔接 |
| 失败与恢复 | ✅ 幂等、pending_event、定向返工、循环保护均有契约 |
| 反腐化 | ✅ 预先封堵"方便但危险"的口子（关键词批准、自述放行、checkbox 充数等） |

### 3.2 人工闸门清单（预期管理用）

| # | 闸门 | 位置 | 性质 |
|---|---|---|---|
| 1 | `backlog → todo` 启动 | Multica | 有意设计：人工确认排期 |
| 2 | Human Analysis Review | Multica `analysis_review` | 有意设计：批准需求/方案/验收边界 |
| 3 | PR 审核与合并 | TFS（外部） | 公司既有流程 |
| 4 | PR abandoned 的 `NEXT` 决策 | Multica | 异常路径 |
| 5 | UNKNOWN / 循环不收敛升级 | Multica | 兜底 |

### 3.3 从设计到可运行的缺口

| 缺口 | 影响 | 优先级 |
|---|---|---|
| 03 / 04 / 05 / 06 下游方案不在仓 | 分析/研发/Schema/Skill 库无实施契约 | 高 |
| 19 个 Skill、约 12 个确定性脚本未实现 | 目前仅有 Delivery Lead 文本资产 | 高 |
| OpenSpec 两个项目 Schema 未建 | Gate 无检查对象 | 高 |
| Multica 0.6.1 安装版本验收未跑（02 §7.3 / §8.2.3 / §12.4.4） | 派发、回流、恢复的实际行为未证实；若原生机制与设计假设不符，Skill 实现可能返工 | **最高** |
| `CANCEL_DELIVERY` 分支未定义 | abandoned → 取消交付路径断裂 | 中 |
| `tasks.md` 并发写入机制未定 | 多 Engineer 并行时冲突 | 中 |

### 3.4 单点风险

**Delivery Lead 对人审自然语言的语义理解（02 §6.3）是全链路最"软"的一环。** 方案正确地拒绝了关键词匹配，但理解质量依赖模型能力。缓解措施已设计（保留原文引用、意图不明先澄清、批准必须可追溯），评审与验收时应重点覆盖自然语言变体场景（无关键词批准、有保留批准、普通提问混淆等，见 02 §6.5）。

---

## 4. 推进建议

1. **先跑安装版本验收**（02 §7.3 派发触发、§8.2.3 并发回流、§12.4.4 收口恢复）——验证原生机制与设计假设一致，避免 Skill 实现返工；
2. 补齐 03 / 04 / 05 / 06 下游方案（或最小可用的实施契约）；
3. 建 OpenSpec 项目 Schema（`corrective-change` / `intentional-change`）；
4. 实现 Skill 与确定性脚本，顺序建议：`tfs-sync` → `delivery-gate` → `workitem-analysis` 族 → `development-execution` → `pull-request` / `pr-status-sync` / `finalize-delivery`；
5. 定义 `tasks.md` 受控写入机制与 `CANCEL_DELIVERY` 专项契约。

---

*本评审基于设计文档静态分析，未执行运行验证。文档中自行标注的未验收项以原文为准。*
