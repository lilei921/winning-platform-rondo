---
name: tfs-sync
description: 使用 tfs-mcp 获取 TFS Work Item 原始事实，并通过确定性脚本幂等同步为 Multica Delivery Issue；用于 Autopilot 定时同步或手动执行 TFS → Multica 同步。
---

# TFS Sync

## Preconditions / Inputs

执行前必须具备：

- `tfs-mcp` 可用；
- Multica CLI 可用；
- `config/config.toml` 可读取；
- Multica Project、Delivery Squad 与独立 Wayfinder Agent 可唯一解析；
- `[delivery].wayfinder_agent` 已配置为实际 Agent ID 或精确名称；缺失时禁止回退 Squad。
- TFS Work Item 完整详情可获取为 JSON。

配置优先级：

```text
Run 参数
→ Agent 环境变量
→ config/config.toml
```

TFS 访问只使用 `tfs-mcp`。

## Procedure

1. 读取 `config/config.toml` 中 `[tfs].wiql`，通过 `tfs-mcp` 查询 Work Item ID。
2. 对每个 ID 获取完整 Work Item JSON，并原样保存：

   ```text
   <run-dir>/raw/<TFS_ID>.json
   ```

   同一 Run 内的后续处理只读取该快照。

3. 执行确定性同步：

   ```bash
   python scripts/sync-run.py --run-dir <run-dir> --apply
   ```

4. 读取 `<run-dir>/summary.json`，按脚本结果交付本次同步汇总。

脚本负责 Identity、ChangedDate、Create / Reconcile、Creation Validation、幂等恢复和批次汇总。不得由 LLM 重新判断脚本已经能够确定的同步结果。

本 Skill 只同步 TFS 来源事实：新建 Issue 在 `backlog + Wayfinder Agent` 完成初始化回读，随后仅一次将 `backlog → todo` 激活 Wayfinder Intake Triage。**同步完成态为 `todo + Wayfinder Agent`**（随后 Wayfinder 可正常变更）。不得启动 Squad / Analysis / Development / Verify / PR，也不得对已有 Issue 重跑 Wayfinder。

## Validation

执行完成必须满足：

- `summary.json` 已生成；
- 每个已处理 Work Item 都有确定性 result；
- 新建或创建恢复的 Delivery Issue 的 `creation_validation = PASS`；
- 新建 Issue 先保持 `status = backlog`、`assignee = Wayfinder Agent`，并回读确认 TFS 来源身份、ChangedDate 和 Owner；
- 仅 `creation_validation = PASS` 后发出一次 Wayfinder 激活；校验 `activation_validation` 的回读结果，`UNKNOWN` 必须明确报告，不盲目重试；
- 已存在 Delivery Issue 的 `status` 与 `assignee` 未被同步逻辑修改；
- `FAIL / UNKNOWN / ERROR / CONFLICT` 不得解释为成功。

Delivery Issue 身份、TFS-owned fields 和 CLI 约束需要核实时，按需读取：

- `references/metadata-schema.md`
- `references/multica-cli-contract.md`

## Output

本次 Run 输出：

```text
<run-dir>/
├── raw/
├── rendered/
├── results/
└── summary.json
```

`summary.json` 还提供 `creation_validation`（初始化证据）与 `activation_validation`（Wayfinder 激活回读证据）；后者 PASS 不代表 Wayfinder Triage 已完成或实际 Run 已成功。

`summary.json.result`：

```text
COMPLETED
PARTIAL_FAILURE
FAILED
```

Runtime 文件只用于本次同步的确定性处理、诊断和安全重试，不作为 Delivery Workflow State。

## Error Handling / Stop Conditions

批次停止：

- `tfs-mcp` / TFS 整体不可用；
- Multica CLI 或必要 capability 不可用；
- Project 无法唯一解析；
- Delivery Squad / Wayfinder Agent 无法唯一解析；
- Multica 无法可靠读取。

单项停止：

- TFS 必填字段缺失；
- Delivery Issue 身份冲突；
- ChangedDate 无法解析；
- 创建 / 更新 / metadata / assign 失败；
- Creation / Activation Validation 为 `FAIL / UNKNOWN`。

可重试的读取类暂态错误按配置重试；创建或激活写入结果未知时不得盲目重复写入，需先回读 Issue / Run 再人工定位。已有 Issue 仅更新 TFS-owned fields，不重置 Owner / Status 或重新激活 Wayfinder。

配置示例（写入本机未跟踪的 `config/config.toml`，使用实际 Agent 名称或 ID）：

```toml
[delivery]
squad = "Delivery Squad"
wayfinder_agent = "Wayfinder Agent"
# 或 wayfinder_agent_env = "WAYFINDER_AGENT_REF"
```

缺少 Wayfinder 配置即停止，不默认选择任意 Agent。

单项失败后是否继续批次由 `config/config.toml` 中 `[runtime].stop_on_item_failure` 控制。
