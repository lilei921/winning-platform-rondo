---
name: pull-request
description: 将已有 PR Preparation Facts 核验后创建或复用 TFS PR；专业描述只由 Engineer 提供。
---

# pull-request

本 Skill 不生成或保存 PR Description Markdown。确定性 PR Admission、TFS PR 创建及复用由 Rondo 负责，元数据形状见 `references/pr-facts-contract.md`。

## Requirement

`analysis.source` 已获独立 Human Approval，Engineer 已提交代码、完成真正的 Candidate Validation 与 Code Review，并由 `rondo dev pr-prep --mode requirement` 在 Issue 上保存逐仓 `pr_prep`。Change Tasks 已完成，`rondo dev publish` 已登记固定研发版本。

```bash
rondo dev check-change --config "<config-path>" --issue <KEY> --change-ref <change-ref>
rondo pr materialize --mode requirement --config "<config-path>" --issue <KEY> --change-ref <change-ref>
```

`check-change` 验证批准来源、固定研发版本、任务进度、逐仓 Candidate / Validation / Review / Blockers 与批准范围；`materialize` 在创建前重新执行相同 Gate，再核对 TFS 分支 HEAD，创建或复用 PR 并登记 `current_pr`。创建时将 Engineer Description 放进临时文件供 TFS CLI 使用，不写入 OpenSpec/Git。

## Legacy / Direct Bug

保持已有不指定 `--mode requirement` 的 `rondo pr materialize` 路径，不迁移历史 Task-level 工件。

## 结果与异常

仅当 Rondo 回读 `current_pr` 并将 Issue 转入 `in_review` 后报告物化成功。FAIL/UNKNOWN、Candidate 不符、缺少真实验证或未解决 Blocking Finding 时停止；不能把 Engineer 自报 PASS 当作独立验证。不修改专业 Title/Description 内容。
