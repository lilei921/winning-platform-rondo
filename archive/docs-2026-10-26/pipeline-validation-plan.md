# 交付流水线分级测试方案

> 目的：按"脚本 → 单角色 → 半自动链路 → 端到端"四级验证流水线，每级有明确通过标准，失败时知道停在哪。
> 工作区：北落师门（`c126b180-9ac5-42be-81f9-38499cf8a793`）。前提：`analysis_review` 状态已创建（✅ 2026-10-13 已验证）。

## 通用原则

- 测试 Issue 标题统一前缀 `[TEST]`，测完一律 `cancelled`，不留垃圾；
- 所有脚本写入遵守 `--no-start` 纪律（除 L2 故意触发唤醒外）；
- 每级记录实际输出，与设计预期对照；UNKNOWN 一律视为不通过（不允许"当放行"）。

---

## L0 脚本离线冒烟（已完成 ✅）

| 用例 | 预期 | 状态 |
|---|---|---|
| 三脚本缺参数 | exit 64 + 用法提示 | ✅ 已验证 |
| `complete-analysis.ts` 遇 `gate.result=FAIL` | exit 2，拒绝写状态 | ✅ 已验证 |
| `reconcile-workitem.ts` 配置缺失 / TFS 命令失败 | exit 3 + UNKNOWN JSON | ✅ 已验证 |

## L1 确定性脚本链路（真实 Issue + 手工驱动，约 30 分钟）—— ✅ 已完成（2026-10-13，6/6 通过）

目标：不经过 Agent Run，直接验证 Gate 与收口脚本在真实工作区行为正确。

**准备**：

1. 手工创建测试 Delivery Issue 并补 TFS 身份 metadata（模拟 tfs-sync 产物）：

   ```bash
   multica issue create --title "[TEST] L1 脚本链路" --status backlog --output json
   multica issue metadata set <id> --key tfs.id --value '"999001"' --output json
   multica issue metadata set <id> --key tfs.type --value "Requirement" --output json
   ```

2. 建一个 OpenSpec Change fixture（本地目录即可，不入业务仓）：

   ```text
   /tmp/openspec-fixture/changes/test-l1/
     proposal.md   （含 Expected / Root Cause / Fix Strategy / Regression Scope 小节）
     tasks.md      （含任务项 + Verification 段落）
   ```

**用例**：

| # | 操作 | 预期 | 实测 |
|---|---|---|---|
| L1-1 | 跑 `validate-analysis.ts`（缺 `analysis.*` metadata） | exit 2 FAIL，reasons 列出缺失项 | ✅ exit 2，缺失项齐全 |
| L1-2 | 补齐 `analysis.route=bug-fix` / `analysis.change_ref=test-l1` / `verify_agent.*` 后重跑 | `openspec_validate` 项 UNKNOWN（无 openspec CLI）→ 整体 exit 3 | ✅ exit 3（commandExists 探测生效） |
| L1-3 | 装 openspec CLI 或接受该项后重跑 | exit 0 PASS | ✅ exit 0，7 项全 PASS（openspec 1.13.2 + skip_specs fixture） |
| L1-4 | 构造 facts.json（gate.result=PASS）跑 `complete-analysis.ts` | exit 0；Issue status=`analysis_review`；metadata 回读一致 | ✅ exit 0，9 键写入 + 状态 + 回读一致 |
| L1-5 | 重复跑 `complete-analysis.ts`（幂等性） | exit 0，无重复副作用 | ✅ exit 0 |
| L1-6 | facts 缺字段 / gate=FAIL | exit 2 拒写，Issue 状态不变 | ✅ 两条路径均 exit 2，状态保持 analysis_review |

**通过标准**：6 用例全过；UI 上 Issue 停在"分析审核"列。— **已达成**；测试 Issue FOMA-4 已 cancelled，fixture 已删除。

**L1 中修复的问题**（三脚本同步修复）：

- Windows `shell:true` 拼接命令行导致含空格/中文/引号的参数被拆散（`accepts 1 arg, received 3`）→ 改为 `where.exe` 解析真实路径：`.exe` 走 `shell:false`（libuv 正确转义），`.cmd/.bat` shim 走 `shell:true` + 手动 CRT 引用；
- `where.exe` 首行可能是无扩展名 shim（如 `openspec`），直接 spawn 会 ENOENT → 优先选带 `.exe`/`.cmd`/`.bat` 扩展名的解析结果。

## L2 半自动链路（Lead + Analyst + Backend Engineer 真实 Run，首个真实需求）—— ✅ 已完成（2026-10-13，FOMA-5，全段走通至 done）

目标：验证 Squad 唤醒、@mention 派发、Agent 按 Instructions 行动。**暂不依赖 Engineer**（未注册）。

**步骤**：

1. 选一个**真实但小**的 TFS 需求（或手工建 Issue 贴上需求描述），assign 给 `Delivery Squad`；
2. `multica issue status <id> todo`（**不带 --no-start**，故意触发唤醒）；
3. 观察点：
   - Lead 是否被唤醒、是否 @Workitem Analyst 后结束 Run（不驻留）；
   - Analyst 是否按 workitem-analysis 契约产出 OpenSpec Change + Handoff Facts；
   - Gate 是否被调用、FAIL/UNKNOWN 是否被正确处理（不硬闯）；
   - 状态是否准确落在 `analysis_review`；
4. 人工在 Issue 评论批准 → Lead 唤醒推进派发；
5. 预期止步点：Lead 发现无 Engineer 可派，应**报告缺口而非臆造**（验证 Boundary 有效）。

**通过标准**：全程无越权（Analyst 没自行批准、Lead 没替 Analyst 分析）；每步在 Issue 上留痕。— **已达成**。

**L2 实测记录（FOMA-5，构造需求：config.yaml 缺项目上下文，模拟 tfs.id=999002）**：

| 观察点 | 实测 |
|---|---|
| todo 触发唤醒 | ✅ Lead 06:04:43 唤醒，读 Issue 后评论 `@Workitem Analyst`（含明确分析对象与根仓位置），Run 结束不驻留 |
| Analyst 分析链 | ✅ 判 route=`sdd-fast`（理由：context 空是模板初始态，属 Intentional 非 Corrective——判断合理）；产出 `openspec/changes/tfs-999002-fill-project-context/`；Gate 7/7 PASS 落 `analysis-gate-result.json`；发布 Analysis Package 摘要评论；9 键 metadata 写入 + `analysis_review` 回读确认 |
| Lead 对 analysis_review 的反应 | ✅ 第二次唤醒评估后 `no_action`（等 Human，不启动研发不重复委派），Squad evaluation 留痕 |
| 人工批准 → 派发 | ✅ 第三次唤醒：查实 Squad Roster 仅 Lead+Analyst，**如实报告 Engineer 缺口、拒绝越权代实施**，Issue 置 `blocked`，@Human 给出下一步（增 Engineer 成员后按 Parent Issue Runtime 派发，无需重新分析） |

**遗留**：FOMA-5 停在 `blocked`，待 Squad 增加 Engineer 成员后可继续走完派发段（同时验证"无需重新分析"的续跑）。
— ✅ 已续跑完成（2026-10-13）：Backend/Frontend Engineer 注册入队后，人工回复解除 blocked，链路走通至 `done`：

| 续跑观察点 | 实测 |
|---|---|
| Lead 续跑不重新分析 | ✅ Run#4 直接按 Parent Issue Runtime 派发 `@Backend Engineer` + `task_refs 1.1–1.3` + Change-level 2.1，复述批准边界与 verify not_required |
| Backend Engineer 执行 | ✅ Ground（取证可溯源至 CLAUDE.md/docs）→ 实现（仅 context 段，schema 未动）→ Local Validation（YAML parse + `openspec validate --all` exit 0）→ 2.1 逐 Scenario 复核 6/6 PASS（确定性检查）→ Code Review 0 Findings → Commit `4aaf0e9` 推送 multica_spec master → 结构化 Development Evidence 回流 |
| Lead 聚合收口 | ✅ Run#5 核对 task_refs 覆盖/Evidence/Commit/PR 判定（根仓产物不建独立 PR）/verify not_required → `in_review` 请 Human 验收；**如实标注 Development Completion Check 确定性脚本未实现（⏳），未伪装已执行** |
| 人工验收收口 | ✅ 验收评论 → `done`；Archive/finalize-delivery 能力未实现，本次以人工验收替代（缺口已记录） |

**L2 结论**：设计内全角色链路（Lead×5 Run / Analyst×1 / Backend×1，共 7 Run）行为全部符合预期；两个能力缺口（Development Completion Check 脚本、finalize-delivery/Archive）已被 Agent 如实上报而非臆造，列入后续实现。

**前置**：Lead/Analyst 的 Run 环境能访问 OpenSpec 根仓（MCP 或工作目录挂载，需先配置）。
— ✅ 已就绪（2026-10-13）：Project「WN Platform 交付」`c1255c2d-aaf0-4c32-a3a3-5c811ad40e37` 已创建（lead=Delivery Lead），
OpenSpec 根仓 `D:\WN_Platform\works\gitee_repos\multica_spec` 已 `openspec init` 并以 `local_directory`（in_place）挂载到本机 Runtime `d6968c17-...`（resource `41278b18-8996-4e4c-9873-424f06ce5652`）。
L2 测试 Issue 须建在该 Project 下，Run 才会获得该工作目录。

## L3 端到端入口（TFS Sync）

**前置**：`sync-config.json` 填入真实 Project ID 与 TFS 查询命令。

| # | 操作 | 预期 |
|---|---|---|
| L3-1 | 首次跑 `reconcile-workitem.ts` | 创建 backlog Issue，metadata 完整，exit 0 |
| L3-2 | 立即重跑（幂等） | 全部 skipped，exit 0 |
| L3-3 | 改 TFS 侧字段后重跑 | 仅管理字段更新，执行字段不动 |
| L3-4 | 注册 TFS Sync Agent + Autopilot 定时触发 | 自动产出与 L3-1 一致 |

## L4 并发与容量验收（02 §8.2.3）—— ✅ 阶段 1/2 已完成（2026-10-13）

**正式压测方案与实测结果**：`docs/l4-concurrency-load-test-plan.md`。核心结论：Agent 配额 6 生效且无缝递补；单 daemon ≥14 并发无全局总闸、0 失败、0 429；spawn 阶梯 ~5-10s/Run；暴露并修正"派发评论必须钉死绝对路径"红线（已回填操作手册 §3.2/§3.2.1）。阶段 3（长任务并发稳定性）保留为放量前可选项。

**预实验已完成（2026-10-13，FOMA-6/7 探针）**：单 daemon + 单挂载点（in_place）下，两个 Backend Engineer Run 对**同一嵌套仓**真实并发执行成功（同秒起跑、无 `waiting_local_directory`、git 层天然串行落定无冲突）。官方文档所述 in_place 目录互斥在当前安装版本未复现。L4 正式验收关注点相应调整为：并发上限（`max-concurrent-tasks`）、多 Issue 全链路（非探针）下的资源占用与稳定性、以及共享 `tasks.md` 受控写入机制（02 §1293，仍待实现）。

---

## 建议执行顺序

```text
L1（今天可做，全脚本级）→ L2（需先配 OpenSpec 根仓访问）→ L3（需 TFS 配置）→ L4（放量前）
```

L1 全部可以在当前环境立即执行，不需要任何新角色。要现在开始跑 L1 吗？
