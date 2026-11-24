---
name: native-workspace
description: 按需准备 Multica 原生根仓和业务仓工作区，供当前 Task 分析、修复和研发使用。
---

# Native Workspace

## 根仓

需要本地工程根仓时，在当前 Task workdir 使用已登记 Project Resource 的 URL 和初始 ref：

```text
multica repo checkout <root-url> --ref <resource-ref>
rondo runtime check-checkout --root-repo "<实际返回的根仓路径>"
```

Resource 未指定 ref 时省略 `--ref`。Engineer 准备已批准 Change 时，核实根仓包含 `analysis.source.commit`；需要从已发布版本开始时，以已批准的来源分支为起点。

复用当前 Task 的已有 Checkout。Workitem Analyst 仅需本地 OpenSpec 工件时准备根仓即可；只读调查不强制 Checkout。

## 业务仓

从已登记 Project Resource 核实 URL 和初始分支，并与根仓已提交的 `docs/config/repo-context.yaml` 仓库身份对应。需要本地业务仓时执行：

```text
rondo dev prepare --workspace native --issue <KEY> --repo <repo_id> --root-repo "<root>" --resource-ref <resource-ref>
```

Requirement 追加 `--change-ref <change_ref>`。已有远端 Candidate 时可省略 `--resource-ref`；无 Candidate 时必须提供已核实的初始分支。

使用命令返回的 `path` 作为实际业务工作区；`branch` 为远端 Candidate，`local_branch` 为 Multica 管理的本地 Task Branch。

## 异常处理

已有 Checkout 重入不切换 ref。准备失败或事实无法确认时保留现场，按实际异常处理；不得通过手工 Clone、强制重置或清理绕过限制。需要从已发布 Candidate 续接且现有工作树不兼容时，报告差异并协调适用的恢复方式，保留未发布成果。
