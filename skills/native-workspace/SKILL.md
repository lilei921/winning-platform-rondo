---
name: native-workspace
description: 需要本地工程仓时，准备 Multica 原生工程根仓与业务仓工作区，供只读调查或获授权的研发使用。
---

# Native Workspace

## 根仓

根据当前 Project 上下文确定工程根仓，从对应 Project Resource 核实 URL 和初始 ref。需要本地根仓时，在当前 Task workdir 执行：

```text
multica repo checkout <root-url> --ref <resource-ref>
rondo runtime check-checkout --root-repo "<实际返回的根仓路径>"
```

使用原生命令返回的实际根仓路径。首次 Requirement 分析必须有明确的 Resource 分支；其他场景 Resource 未指定 ref 时可省略 `--ref`。已有同一 Change 的 `analysis.source` 时，按 `analysis.source.repo_url` 和 `analysis.source.branch` 准备根仓；Engineer 还需核实根仓包含已批准的 `commit`。

优先复用 Multica 已有的 Checkout，保留工作树及已有研发成果。根仓与业务仓均为当前 Task workdir 的直属独立 Git 仓，按需准备，不自动检出其他仓库；只读 MCP 已满足调查需要时，不强制本地 Checkout。

## 只读业务仓

从当前 Project Resource 核实仓库 URL 和初始 ref。优先复用已取得的 Project 上下文，必要时使用原生 Resource 查询。仅需只读调查且确实需要本地业务仓时，在当前 Task workdir 执行：

```text
multica repo checkout <business-url> --ref <resource-ref>
```

使用原生命令返回的实际业务仓路径，核实 Git Origin 与 Resource 仓库身份一致。无 ref 时可省略 `--ref`。

## 研发业务仓

根据当前 Issue 的授权范围确定实际修改的业务仓。Requirement 以已批准版本的 `.openspec.yaml` 中 `x-repositories` 为准；Bug 按诊断结论及已固定的 Bug Scope（如有）确定范围。使用完整 Git/TFS 仓库名称标识，核实当前 Project Resource 中对应仓库的 URL 和初始 ref。

通过 `rondo repo get-branch --project <project> --repo <repo> --branch feature/<tfs.id>` 查询远端 Candidate。存在则使用 Candidate 分支；明确不存在时使用 Project Resource 的 `ref`。该 `ref` 也是新 PR 的目标分支。无法确认所需分支时，先核实实际原因。

在当前 Task workdir 执行：

```text
multica repo checkout <business-url> --ref <ref>
```

使用返回的实际路径和 Multica 本地 Task Branch。首次 Checkout 核对 HEAD 与所选 ref；已有 Checkout 优先复用，核实其来源，存在远端 Candidate 时确认 HEAD 包含该 Candidate Commit。重入只 Fetch，不自动切换 ref。保留未提交和未发布成果；遇到不兼容工作树或旧嵌套 Checkout 时先核实并协调恢复，不强制重置、清理或另建重复工作树。

Requirement 根仓须包含批准 Commit。研发后的远端写入及 PR 交付由 `pull-request` 和 Rondo 的相应命令完成；准备不写入批准或交付 Metadata。

## 异常处理

原生 Checkout / Fetch 失败或仓库身份、基线无法确认时，停止受影响的研发操作，保留现场并按实际异常处理。
