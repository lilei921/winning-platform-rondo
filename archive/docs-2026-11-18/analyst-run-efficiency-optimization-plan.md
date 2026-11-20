# 分析 Run 效率优化落地方案（Workitem Analyst 耗时/token 治理）

> 状态：方案待评审，暂不开发
> 依据：`projects/multica/logs/WNDF-43/`（WNDF-43 全量执行记录归档 + ANALYSIS-workitem-analyst.md）
> 日期：2026-11-02

## 1. 背景与证据基线

WNDF-43（TFS 261015，sdd-fast）Workitem Analyst Run `01a1866d-b0a4-719f-84cd-0dd8e8c31537`：

- 耗时 13.1m（06:51:39→07:04:47 UTC），125 条消息、67 次 LLM 生成事件
- 用量：input 65,821 / output 15,453 / cache_read 3,013,632（k3）
- 时间切分：LLM 推理 8.6m（67%）+ 工具执行 4.3m（33%）
- 阶段切分：准入 0.4m / 代码定位 2.0m / OpenSpec 撰写 2.9m / **Analysis Gate 6.3m（48%）** / 收口 1.0m

核心机制：**67 轮 agentic loop 中每轮重读全量前缀**，轮数是耗时与 cache_read 的共同乘数——第 N 轮注入 2k token ≈ fresh 2k + 后续每轮 cache_read 复计（本 Run 约 ×55）。约 20 轮（30%）由下文归因 1-3 的非必要事件贡献。

### 已证伪的归因（防止方案建立在错误前提上）

| 初判 | 证伪证据 | 真相 |
| --- | --- | --- |
| validate stdout 混入日志行需刮取 | `cli/output.ts` 契约 stdout=JSON/stderr=log；seq 105/110 落盘文件为合法 JSON | Agent 的 tail/grep 过滤属多余防御，非失败原因 |
| Bash/Read 输出 GBK 乱码致信息不可用 | 记录文件 UTF-8 复核（seq 65/85/99），无 U+FFFD、无乱码 | 乱码系分析侧 Windows GBK 控制台渲染假象 |
| 大文件全量读 | seq 20/29/31/39 均带 offset/limit | 实际为范围读，仅存在重叠回读（见归因 5） |

## 2. 归因清单（源码 + 日志双证，按损失排序）

### 归因 1【主因】multica CLI 传输层失败未反映到退出码，且无重试

- 事实链：07:00–07:03 server 抖动窗口 → CLI 超时文案走 stderr、**stdout 置空、退出码仍为 0/2** → skill-flow `runJson`（spawn.ts:52-60）走到 `JSON.parse("")` 抛 `Unexpected end of JSON input` → Gate 判 UNKNOWN（validate.ts:282，裁决本身正确）。
- 日志证据：seq 105/110 落盘 reason 原文；seq 111 直接 `multica issue get` 复现 `Request timed out ... MULTICA_HTTP_TIMEOUT`；seq 113 sleep 15 后 seq 115 同命令 PASS。
- 放大效应：Agent 误诊为落盘格式问题，validate 连跑 5 次（seq 84/93/100/106/115），抖动窗口直接损耗 ~2.5m 工具等待 + ~10 轮推理，合计 ~3.5-4m。
- 未闭合：server 侧抖动根因（需 172.17.1.97 服务端日志，独立调查线）。

### 归因 2【缺口】analysis-completion SKILL 两项契约未写死

- **Gate 结果落盘路径**：SKILL 步骤 3 仅说「写入 facts 的 gate.reasons_ref」，未规定路径。seq 95 thinking 原文「Let me check how a previous analysis recorded gate.reasons_ref」→ grep archive 考古（seq 96/98）→ 自造 `mkdir logs/` + 管道落盘（seq 100）。~4-6 轮、~1m，且 archive 已有 `analysis-facts.json` 不一致先例，路径有发散风险。
- **UNKNOWN 处置分类**：SKILL 仅「UNKNOWN：停止并交 Delivery Lead」，未区分真未知（openspec CLI 缺失）与环境瞬态（超时/空响应）。Agent 对后者无规则可依，自行探测+sleep 重试（seq 109-115，~10 轮、2.5m）；换执行体可能反向不一致（抖动升级协调轮 / 真未知死循环重试）。

### 归因 3【缺口】ai_review.verdict 值域未写在生产者 skill

- 契约三层撕裂：`workitem-analysis/SKILL.md` Output 只有字段名（无值域）→ `delivery-gate/SKILL.md:34` 有值域（Analyst 未加载）→ `validate.ts:233` 强制 `APPROVED|NEEDS_REVISION`（FAIL 时才暴露）。
- 设计语义：PASS/FAIL 属确定性 Gate 词汇，APPROVED/NEEDS_REVISION 属专业审查词汇（02:885-887），刻意隔离（validate.ts:22）。
- 日志证据：Agent 凭直觉写 `"PASS"` → seq 84 Gate FAIL → seq 86/88 全域 grep 考古（~7k 字符噪声）→ seq 91 改 APPROVED → 复验。~4 轮、~1m，每个 sdd-fast 首提 Run 可重犯。

### 归因 4【结构】skill-flow 命令级联子进程开销

- validate 每次内部 spawn：`multica issue get` + `metadata list` + `openspec validate --strict`（Windows 进程冷启动 + HTTP 往返），单次工具等待 20-30s；本 Run validate×5 + stage + complete 级联显著。
- stage 级联：issue get + metadata list + N×metadata set（seq 83 输出可见）。

### 归因 5【纪律】读取/搜索精度（轻量，慢性病）

- index.vue 两次范围读重叠 140-170 行（~1.3k 字符）：未先 grep 钉行号（177-181）导致回读。
- 全域 `.claude/skills` grep `ai_review|verdict`：~7k 字符噪声（混入 wiki-ingest 等无关 skill）。
- `issue get` 全量 JSON（1.9k）进上下文 ×2 次。
- 量级诚实评估：全部优化约省 2k fresh input + ~100k cache_read（3% / 1.2%），非本 Run 瓶颈，但属每轮复入的前缀膨胀。

## 3. 整改项

### P0 skill-flow spawn 层：瞬态识别与一次重试（归因 1 的主修复）

- 范围：`tools/skill-flow/src/clients/spawn.ts`（runJson）
- 内容：读类命令（调用方传 `transient: true` 标记）遇「exit 0/2 且 stdout 为空/全空白」判定为瞬态故障，重试 1 次（间隔 ~3s）后再走 UNKNOWN；在 stderr 留 `[skill-flow] transient retry: <what>` 单行。
- 设计理由：「exit 0/2 + 空 stdout = 传输失败」的识别与重试可在本层完整闭环，**不依赖 multica CLI 修复**——CLI 是厂商分发的 Go 二进制（已核实：`multica 0.7.0, go1.27.3, windows/amd64`，自更新下载 release archive），其源码可得性与修改权限未确认，不能作为落地前提。
- 验收：
  1. 桩 CLI 首次空输出、二次正常时 runJson 返回正常结果且无 UnknownError；
  2. 持续空输出时抛 UnknownError 且 reason 含重试记录；
  3. **合法空输出不误判**：桩 CLI 对「业务上本就可为空」的输出形态（如空评论列表返回 `[]`、空 metadata 返回 `{}`）不触发重试——`transient` 判定仅限 stdout 完全为空/全空白，不含合法空 JSON。
- 收益：消灭归因 1 抖动感知（本 Run ~3.5m 大头），全 squad 所有 Run 受益；UNKNOWN 回归「真未知」语义，不再吞掉传输故障。

### P0-track multica CLI 缺陷上游报告（跟踪项，非实施项）

- 背景：归因 1 中 CLI 侧缺陷（传输失败以空 stdout + exit 0/2 混出、无重试）属 multica 厂商代码，本工作区不可直接修改。
- 内容：整理 §2 归因 1 的证据链（seq 105/110 reason 原文、seq 111 超时复现、spawn.ts 解析路径）作为缺陷报告提交上游；跟踪其修复（退出码语义、读重试），修复发布后回归验证并评估是否保留 P0 的重试层（建议保留作纵深防御）。
- 验收：缺陷报告已提交且含可复现步骤；上游版本修复记录归档于本方案附录。

### P1-3 analysis-completion SKILL：补两条契约

- 范围：`projects/multica/workspace-skills/analysis-completion/SKILL.md`（同步目标 wn_df 工作区）
- 内容：
  1. 步骤 3 写明：Gate 结果落盘至 `openspec/changes/<change_ref>/logs/analysis-gate-result.json`（原子写），`gate.reasons_ref` 填该相对路径；引用 P1-4 的 `--out` 命令形态；
  2. Error Handling 增补分类：UNKNOWN 且 reasons 为环境性失败（命令无法执行/超时/空响应/传输错误）时，等待 ≥15s 原样重试一次；仍 UNKNOWN 或属检查项本身未知时，停止交 Delivery Lead 并附最后一次 reasons 作证据。
- 验收：新 Run 无 archive 考古行为；UNKNOWN 处置路径与 SKILL 文本一致。

### P1-4 skill-flow analysis validate：--out 落盘

- 范围：`tools/skill-flow/src/commands/analysis/validate.ts`
- 内容：新增 `--out <path>`：结果 JSON（无论 PASS/FAIL/UNKNOWN）原子写入（临时文件 + rename），目录不存在则创建；stdout 契约不变。
- 验收：`--out` 产物与 stdout JSON 逐字节一致；SKILL 示例命令可一条完成「执行 Gate + 落盘」。
- 收益：消灭管道落盘与考古（归因 2 前半），每次分析省 ~4-6 轮。

### P1-5 workitem-analysis SKILL：补 ai_review.verdict 值域

- 范围：`projects/multica/workspace-skills/workitem-analysis/SKILL.md` Output 段
- 内容：`ai_review.verdict ∈ {APPROVED, NEEDS_REVISION}`（专业审查词汇，禁用 PASS/FAIL 词汇，与 Gate 检查结果区分）。
- 验收：首个 sdd-fast Run 一次通过 Gate ai_review 项，无 grep 考古。
- 收益：消灭归因 3 循环（~4 轮、~1m / 每个 sdd-fast Run）。

### P2-6 读取/搜索纪律（skill 层一行约束）——❌ 不实施（2026-11-02 评审决定）

- 决定：阅读纪律属执行体通用能力，不写入 workitem-analysis SKILL；收益量级小（~3%），不足以抵消契约膨胀成本。

### P2-7 multica server：run-messages 记录逐 turn usage

- 范围：multica server 消息记录
- 内容：run-messages 每条 assistant 消息附带 input/output/cache token 计量。
- 收益：后续归因分析精确到轮，替代「消息数 × 均值」的估算。

### 独立调查线（不阻塞本方案）

- 172.17.1.97 multica server 2026-10-29 07:00–07:03 UTC 抖动根因（负载/GC/网络），捞服务端日志闭合归因 1 的最后一环。
- tfs-cli 已知 gzip chunk 截断（U+FFFD）缺陷，与本 Run 无关，单独跟踪。

## 4. 实施顺序与依赖

```
P0   (skill-flow spawn 瞬态重试)  ── 主修复，不依赖 CLI 修复
P0-track (CLI 缺陷上游报告)       ── 跟踪项，不阻塞任何批次
P1-4 (validate --out) ──→ P1-3 (analysis-completion SKILL 引用 --out)
P1-5 (verdict 值域)      ── 独立，一行改动，可最先做
P2-7                    ── 独立（P2-6 经评审不实施）
```

建议批次：第一批 P1-5（一行、零风险）+ P0（主因）；第二批 P1-4→P1-3；第三批 P2。P0-track 随 P0 实施时同步提交。

## 5. 预期收益（以 WNDF-43 Analyst Run 为基线）

| 项 | 回收 | 说明 |
| --- | --- | --- |
| P0（+P0-track） | ~3.5m + ~10 轮 | 抖动窗口不再进入 Agent 视野；CLI 缺陷走上游跟踪 |
| P1-3+P1-4 | ~1.5m + ~5 轮 | 落盘一条命令、UNKNOWN 有章可循 |
| P1-5 | ~1m + ~4 轮 | verdict 一次写对 |
| ~~P2-6~~ | — | 评审决定不实施 |
| **合计** | **13.1m → ~8m（-40%）**；轮数 67 → ~45；fresh input 省 ~20k；cache_read 省 ~1.2M | 估算基线为同复杂度 sdd-fast 分析 |

收益外溢：归因 1/2/4 修复作用于全部 squad 成员与所有命令（Delivery Lead 协调轮、Engineer 实现轮同样消费 skill-flow/multica）。

## 6. 验证方式

- 单元/契约：P0/P1-4 各自附桩测试（见验收条）。
- 端到端：修复后任选一个 sdd-fast TFS 需求跑完整分析 Run，对照本基线核对：validate 调用次数（5→1-2）、Gate 段耗时（6.3m→~2m）、无 archive 考古 grep、无 verdict 返工。
- 回归：run-messages 对比轮数与 cache_read；确认 UNKNOWN 语义未被重试吞掉（真未知场景仍停止上报）。
