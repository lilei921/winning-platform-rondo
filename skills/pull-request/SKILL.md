---
name: pull-request
description: PR 物化。当 Delivery Issue 的全部 required 研发任务完成、Delivery Lead 需要把 PR Preparation Facts 落为 TFS PR 时使用。
---

# pull-request

薄适配器方法：确定性逻辑全部收编为 `rondo` 子命令，本文件只定义调用契约（并发写隔离契约唯一权威：`references/repo-write-isolation-contract.md`）。

## Preconditions / Inputs

- 默认配置：`config/repo-registry.json`（相对于本 Skill 目录）；通过 `--config` 传入该配置文件路径。
- Issue metadata 必须已有 `pr_prep`（契约见 `references/pr-facts-contract.md`）。
- 目标项目与所需仓库可被 `rondo` 访问；
- 枢纽克隆 `<root_repo>/<repo_path>/` 就位（`repo_key = repo_id`，`repo_path` 来自 registry，root_repo 为运行时解析结果）；rondo 可用（凭证在本机 config，不进平台）。

## Procedure

**PR 物化（Lead 协调）**：

```bash
rondo pr materialize --issue <KEY> --config "<config-path>"
```

脚本行为（由脚本保证）：校验 candidate_commit == 分支 HEAD → 核对外部 PR 事实（已存在则复用登记）→ 需创建时建 PR 并关联 TFS 工作项 → 回写 `current_pr` → 全部 required 仓登记完成 → Issue → `in_review`（--no-start）。

## Validation

- `rondo pr materialize` 退出码 `0` 且 `result=PASS`：每个 `prs[]` 项回读 `current_pr` 已登记、Issue 状态 = `in_review`。

## Output

- `rondo pr materialize`：`{ result: "PASS", issue, status: "in_review", prs: [...] }`；
- Agent 汇总本次执行结果；FAIL/UNKNOWN 原样附 reason。

## Error Handling / Stop Conditions

- `result=FAIL`（exit 2）：按逐项 reason 处理（repo_key 未登记 / 分支未推送 / description_ref 不支持等），不绕过；
- `result=UNKNOWN`（exit 3）：交 Delivery Lead 语义判断——仅"需改代码 / rebase / HEAD 不一致原因查明"才重新 @Engineer，TFS 临时失败与幂等恢复不需要 Engineer；
- PR Title/Description 语义不由本 Skill 修改。
