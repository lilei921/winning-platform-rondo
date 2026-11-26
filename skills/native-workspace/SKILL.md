---
name: native-workspace
description: 需要本地工程仓时，准备 Multica 原生根仓及其下的业务仓工作区，供只读调查或获授权的研发使用。
---

# Native Workspace

## 根仓

根据当前 Project 上下文确定工程根仓，从对应 Project Resource 核实 URL 和初始 ref。需要本地根仓时，在当前 Task workdir 执行：

```text
multica repo checkout <root-url> --ref <resource-ref>
rondo runtime check-checkout --root-repo "<实际返回的根仓路径>"
```

使用原生命令返回的实际根仓路径。首次 Requirement 分析必须有明确的 Resource 分支；其他场景 Resource 未指定 ref 时可省略 `--ref`。已有同一 Change 的 `analysis.source` 时，按 `analysis.source.repo_url` 和 `analysis.source.branch` 准备根仓；Engineer 还需核实根仓包含已批准的 `commit`。

优先复用 Multica 已有的 Checkout，保留工作树及已有研发成果。业务仓统一位于实际根仓目录下，按需准备，不自动检出其他仓库；只读 MCP 已满足调查需要时，不强制本地 Checkout。

## 只读业务仓

从已登记 Project Resource 核实 URL 和初始 ref，并与根仓已提交的 `docs/config/repo-context.yaml` 仓库身份对应。仅需只读调查且确实需要本地业务仓时，在实际根仓目录执行：

```text
multica repo checkout <business-url> --ref <resource-ref>
```

使用原生命令返回的实际业务仓路径。无 ref 时可省略 `--ref`。

## 研发业务仓

已确定需要修改的业务仓，直接使用以下命令准备研发工作树，不先单独 Checkout。根据 Project Resource 和根仓映射核实 `repo_id`、初始 ref：

```text
rondo dev prepare --workspace native --issue <KEY> --repo <repo_id> --root-repo "<root>" --resource-ref <resource-ref>
```

已有远端 Candidate 时可省略 `--resource-ref`；无 Candidate 时必须提供已核实的初始分支。

使用命令返回的 `path` 作为代码修改、验证及提交的工作区；`branch` 为远端 Candidate，`local_branch` 为 Multica 管理的本地 Task Branch。已有同一业务仓的只读 Checkout 时，由此命令核验并复用兼容的工作树。

## 异常处理

已有 Checkout 重入不切换 ref。准备失败或事实无法确认时保留现场，按实际异常处理；不得通过手工 Clone、强制重置或清理绕过限制。需要从已发布 Candidate 续接且现有工作树不兼容时，报告差异并协调适用的恢复方式，保留未发布成果。
