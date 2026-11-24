---
name: native-workspace
description: 按需准备 Multica 原生根仓和业务仓工作区，供当前 Task 分析、修复和研发使用。
---

# Native Workspace

## 根仓

根据当前 Project 上下文确定工程根仓，从对应 Project Resource 核实 URL 和初始 ref。需要本地根仓时，在当前 Task workdir 执行：

```text
multica repo checkout <root-url> --ref <resource-ref>
rondo runtime check-checkout --root-repo "<实际返回的根仓路径>"
```

使用原生命令返回的实际根仓路径。首次 Requirement 分析必须有明确的 Resource 分支；其他场景 Resource 未指定 ref 时可省略 `--ref`。已有同一 Change 的 `analysis.source` 时，按 `analysis.source.repo_url` 和 `analysis.source.branch` 准备根仓；Engineer 还需核实根仓包含已批准的 `commit`。

优先复用当前 Task 的已有 Checkout。根仓与业务仓分别按需准备，不自动检出其他仓库；只读 MCP 已满足调查需要时，不强制本地 Checkout。

## 业务仓

从已登记 Project Resource 核实 URL 和初始 ref，并与根仓已提交的 `docs/config/repo-context.yaml` 仓库身份对应。只读调查确实需要本地业务仓时，在实际根仓目录执行：

```text
multica repo checkout <business-url> --ref <resource-ref>
```

使用原生命令返回的实际业务仓路径。无 ref 时可省略 `--ref`。

获授权的 Bug 修复或 Requirement 研发使用：

```text
rondo dev prepare --workspace native --issue <KEY> --repo <repo_id> --root-repo "<root>" --resource-ref <resource-ref>
```

Requirement 追加 `--change-ref <change_ref>`。已有远端 Candidate 时可省略 `--resource-ref`；无 Candidate 时必须提供已核实的初始分支。

使用命令返回的 `path` 作为实际业务工作区；`branch` 为远端 Candidate，`local_branch` 为 Multica 管理的本地 Task Branch。

## 异常处理

已有 Checkout 重入不切换 ref。准备失败或事实无法确认时保留现场，按实际异常处理；不得通过手工 Clone、强制重置或清理绕过限制。需要从已发布 Candidate 续接且现有工作树不兼容时，报告差异并协调适用的恢复方式，保留未发布成果。
