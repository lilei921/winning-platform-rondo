# L4 并发压测方案（Run 级并行上限实测）

> 目的：实测当前安装版本（CLI 0.6.1 + 本机单 daemon）的 Run 并行上限与排队行为，为放量提供容量基线。
> 依据：02 §8.2.3（安装版本并发与重试验收）；预实验 FOMA-6/7 已证实 2 Run 真并行（见 `pipeline-validation-plan.md` L4）。
> 工作区：北落师门（`c126b180-9ac5-42be-81f9-38499cf8a793`）；Project：WN Platform 交付（`c1255c2d-…`）。

## 背景与假设

| 层 | 参数 | 默认 | 待验证问题 |
|---|---|---|---|
| Agent 定义 | `--max-concurrent-tasks`（注册/更新时可配，1–50） | 6 | 同 Agent 第 7 个 Run 是否排队 |
| daemon | `daemon start --max-concurrent-tasks` | 未确认 | 是否存在独立全局总闸、默认值多少 |
| 物理资源 | 本机 CPU/内存 + 模型 API 429/配额 | — | 放量前的真实瓶颈 |

预实验结论（FOMA-6/7）：单 daemon 单挂载点（in_place）下 2 个同 Agent Run 对同一嵌套仓真并行，无 `waiting_local_directory`；官方文档的目录互斥表述在本版本未复现。

## 通用纪律

- 测试 Issue 统一 `[TEST] L4-` 前缀，测完一律 `cancelled`；
- 探针任务一律**本地 commit 不 push**，测完对 4 个克隆统一 `git reset --hard origin/<branch>` 还原；
- 每 15s 轮询所有测试 Issue 的 run 状态，原始数据落盘（JSON）；
- 压测期间采样本机 `claude`/`node` 进程数与内存占用；
- UNKNOWN / failed / 429 一律记录为不通过项，不豁免。

## 阶段 1：同 Agent 饱和（核心用例）

**目的**：验证单 Agent 配额 6 的拐点与递补行为。

**步骤**：

1. 建 8 个 `[TEST] L4-sat-N` Issue（N=1..8），assign Delivery Squad，status backlog；
2. 同一秒批量评论 `@Backend Engineer`：探针任务（在 `repos/df-dataintegration` 建 `probe-l4-N.txt` + 本地 commit，不 push，完成后评论报告）；
3. 持续轮询至全部 Run 完成。

**预期**：6 个 `running` + 2 个排队（dispatched/waiting）；前 6 完成后递补。

**观测指标**：

| 指标 | 取数方式 | 记录 |
|---|---|---|
| 并发曲线 | 15s 轮询 run 状态 | running 数时间轴 |
| 排队时长 | `started_at - created_at` per Run | 逐 Run 记录 |
| 递补行为 | 第 7/8 Run 启动时刻 vs 前 6 完成时刻 | 无缝递补 or 延迟 |
| 异常 | run status / error 字段 | failed/429/timeout 计数 |
| 机器负载 | PowerShell `Get-Process claude,node` | 峰值进程数/内存 |

**通过标准**：并发曲线在 6 出现明确拐点；无 failed/429；递补行为符合预期。

## 阶段 2：跨 Agent 混压（探测 daemon 总闸）

**目的**：探测 daemon 是否存在独立全局上限及其值。

**步骤**：

1. 6 个 Issue @Backend Engineer + 4 个 Issue @Frontend Engineer（探针任务同阶段 1，前端写 `repos/df-dataintegration-web`）+ 2 个 Issue 仅 `todo`（触发 Lead Run）；
2. 全部同时触发，持续轮询。

**预期分叉**：

- 若 daemon 无独立总闸或 ≥12：12 个 Run 同时 `running`；
- 若 daemon 总闸 = G：同时 `running` 数封顶 G，其余排队——G 即实测总闸值。

**通过标准**：实测出 daemon 总闸值（或确认无独立总闸）；跨 Agent 配额互相独立（Frontend 排队不占 Backend 名额）。

## 阶段 3（可选）：长任务稳定性

2~3 个**真实交付型** Issue 并发（非探针，走分析+研发链），观察长 Run（10min+）并发下的内存增长、Session 复用正确性、共享 `tasks.md` 写冲突表现（02 §1293 机制未实现，预期可能暴露冲突——暴露即记录，不当失败）。

## 产出回填

- 实测数据汇总表 → 本文档"实测结果"节；
- 吞吐上限与建议并发值 → `multica-delivery-operations-guide.md` §3.2 / §8；
- 若发现平台行为与设计假设冲突 → 同步修订操作手册相关段落。

## 实测结果

### 阶段 1（2026-10-13，FOMA-8~15，8 Issue 同时 @Backend Engineer）—— ✅ 通过（附重要修正）

**并发与递补**：

| 指标 | 实测 |
|---|---|
| Backend 峰值并发 | **6**（09:38:28），与 `max_concurrent_tasks=6` 精确吻合——**配额在本版本生效**（修正预实验期的"是否生效未知"） |
| 递补行为 | 无缝：#7 在 #1 完成后 1s 内启动，#8 在 #2 完成后 ~8s 启动 |
| 启动阶梯 | 前 6 个 Run 以 ~10-15s 间隔依次 spawn（09:37:14→09:38:28），为 spawn 串行化而非配额排队 |
| 全平台峰值并发 | **11**（6 Backend + 5 Lead comment 评估 Run；Lead 每 Issue 自动跟 2 个评估 Run，独立配额互不挤占） |
| 单 Run 时长 / token | 79–196s；~250k–700k（cache_read 为主） |
| 失败 / 429 | **0 / 0**（24/24 Run completed：8 Backend + 16 Lead） |
| 机器负载采样 | ⚠️ 漏采（本轮未执行 PowerShell 采样，阶段 2 补） |

**⚠️ 重要发现 1：指令遵循一致性缺陷（与并发数无关的机制问题）**

8 个相同探针任务中仅 4 个把 commit 落进正确的共享嵌套克隆：

- 4 成功（sat-2/3/6/8）：正确解析 CLAUDE.md 资源段的绝对路径，commit 落 `multica_spec/repos/df-dataintegration`；
- 3 失败（sat-1/5/7）：未找到挂载路径，**在 ephemeral workdir 内 `git init` 新仓**并 commit——产物随 workdir 销毁，完全丢失；
- 1 越界（sat-4）：**commit 落进了原始源仓** `win60_repos/DF/winning-dps-df-dataintegration` 的 `dev-test` 分支（已 `git reset --hard` 清除，未 push）。

根因：Run workdir 是临时目录，挂载的 `local_directory` 以**绝对路径指针**形式写在 workdir 的 `CLAUDE.md` 资源段；触发评论使用相对路径 `repos/df-dataintegration`，Agent 需自行解析拼接——8 个 Run 中只有一半做对。**结论：派发评论必须钉死绝对路径**（"仓库定位纪律"应写入派发契约）。

**⚠️ 重要发现 2：轮询口径修正**

采样脚本取每 Issue 最新 Run 状态，把 Lead 评估 Run 混入，一度误读为"8 Backend 并发、配额未生效"。以完整 runs 列表的 `[started_at, completed_at]` 区间扫描为准：Backend 峰值 = 6，配额生效。

**通过判定**：并发曲线在 6 出现明确拐点 ✅；递补无缝 ✅；无 failed/429 ✅；但暴露指令遵循缺陷（发现 1），阶段 2 触发评论改用绝对路径复测。

### 阶段 2（2026-10-13，FOMA-16~27，6 Backend + 4 Frontend + 2 Lead 同时触发）—— ✅ 通过

| 指标 | 实测 |
|---|---|
| 触发方式修正 | 派发评论钉死**绝对路径** + "禁止 git init/禁止其他路径"——**10/10 commit 全部落对仓**（ Backend 6 → `repos/df-dataintegration`，Frontend 4 → `repos/df-dataintegration-web`），阶段 1 的 4/8 定位失败问题消除 |
| 总 Run 数 | 32（6 BE + 4 FE + 22 LD），**32/32 completed，0 error / 0 429** |
| 全平台真并发峰值 | **14**（09:51:55，逐秒采样口径：BE 4 + FE 4 + LD 6）——**单 daemon 未见全局总闸**，至少 14 并发无排队 |
| 各 Agent 峰值 | BE 4（spawn 阶梯 + 快任务完成交错，未及 6 即开始回落）；FE 4/4 满；LD 6 = 配额上限 ✅（逐秒采样；区间扫描法因秒级粒度边界会虚高 +1，判读以逐秒采样为准） |
| 跨 Agent 配额独立 | ✅ FE 4 并发与 BE/LD 互不占名额；BE/FE 全程 0 排队 |
| spawn 速率 | ~1 Run / 5-10s 串行拉起（全 Agent 共享），是除配额外唯一观察到的吞吐限制 |
| 机器负载峰值 | **22 个 claude/node 进程 / 4.94GB**（09:52:08；基线 8 进程 / 1.06GB）——负载温和 |
| 单 Run 时长 | BE 52-89s，FE 58-71s；BE 分两波启动（09:50:47/53 + 09:51:42+）因 daemon 跨 Agent 串行 spawn 被 22 个 LD 评估 Run 插队 |

**通过判定**：daemon 总闸未触顶（≥14）✅；配额独立 ✅；无异常 ✅；负载数据已取得 ✅。

### L4 综合结论（阶段 1+2）

1. **并发模型实测**：瓶颈 = 每 Agent `max_concurrent_tasks`（默认 6，生效、无缝递补）+ daemon 串行 spawn（~5-10s/Run）；单 daemon 至少承载 14 并发 Run 无全局闸、无 429、负载温和（<5GB）。
2. **派发契约修订（红线级）**：触发/派发评论必须给出**绝对路径**并显式禁止 git init 与越界路径——相对路径下 Agent 定位成功率仅 50%（阶段 1），且可能污染挂载点外的真实源仓。
3. **Lead 评估 Run 放大系数**：每 Issue 每次评论触发约 2 个 Lead comment Run（派发评估 + 完成评估），容量规划按 `总 Run ≈ Engineer Run × 3` 估算。
4. **阶段 3（长任务稳定性）未执行**：探针均为分钟级短任务；真实交付型长 Run（10min+）并发下的内存增长与共享 `tasks.md` 写冲突仍未验证，保留为放量前可选项。

| 阶段 | 日期 | 配置 | 并发拐点 | 递补行为 | 异常 | 机器负载峰值 |
|---|---|---|---|---|---|---|
| 阶段 1 | 2026-10-13 | Backend 配额 6，8 Issue | 6 ✅ | 无缝（1s/8s） | 指令遵循 4/8 定位失败（3 丢失 + 1 越界，已清理） | 漏采 |
| 阶段 2 | 2026-10-13 | 6 BE + 4 FE + 2 Lead，12 Issue | 配额 6 各 Agent 独立 ✅；daemon ≥14 无总闸 | 无排队 | 0；绝对路径修正后 10/10 落仓 | 22 进程 / 4.94GB |
