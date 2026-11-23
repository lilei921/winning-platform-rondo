---
name: workspace-preparation
description: 按需准备或复用授权的本地 Git 工作区，支持 Bug Fix Native Checkout 与业务仓 Clone、Requirement 持久根仓与业务 Worktree。
---

# Workspace Preparation

仅在需要本地工作树时使用。只读 MCP 能完成的调查无需准备仓库。下文业务仓命令中的 `<config>` 为本 Skill 的 `config/repo-registry.json` 绝对路径，使用前确认 `runtime.workspace_id` 匹配当前 Workspace。

## Bug Fix

需要本地根仓时，复用当前 Task 的 Native Checkout。首次检出在 Task workdir 使用 Project Resource 的 URL 和 ref；Resource 未指定 ref 时省略 `--ref`：

```bash
multica repo checkout <root-url> --ref <resource-ref>
```

使用实际 Checkout 路径核实根仓就绪：

```bash
rondo runtime check-checkout --root-repo "<root>"
```

需要本地业务源码时，使用检查返回的 `rootRepo`、当前 Bug Issue 和已授权的 `repo_key` 准备或复用业务仓：

```bash
rondo dev prepare --mode bug --config "<config>" --issue <issue> --repo <repo_key> --root-repo "<root>"
```

## Requirement

需要本地 OpenSpec 工件时，优先使用当前 Task 的平台 checkout：尚未检出时在 Task workdir 执行 `multica repo checkout <root-url> --ref <项目分支>`，使用实际返回路径，并用 `rondo runtime check-checkout --root-repo "<root>"` 校验；已有检出直接复用，不重复 checkout，也不手工 `git clone`。常驻根仓模式仍可用 `rondo runtime prepare-root`（读取 `RONDO_WORKSPACE_PATH` 与 `RONDO_WORKSPACE_BRANCH`）。Workitem Analyst 准备根仓即可。

Engineer 修改业务源码时，使用当前 Issue、获批的 `change_ref` 及其 `x-repositories` 内的 `repo_id`。已有适用于当前 Issue、批准版本和仓库的成功准备结果时，使用其 Worktree `path`。首次准备、仅有目录或上次准备中断时，调用同一入口：

```bash
rondo dev prepare --mode requirement --config "<config>" --issue <issue> --change-ref <change_ref> --repo <repo_id> --root-repo "<root>"
```

## Result / Stop

Rondo 命令退出码为 0 且 `result=PASS` 时使用其实际路径。Requirement 根仓的当前分支须与项目配置一致，平台 checkout 必须通过 `check-checkout` 身份校验；业务仓使用 `dev prepare` 返回的 `path`。

`FAIL` / `UNKNOWN`、Workspace 不匹配、授权或路径不明时，停止受影响的操作，保留现场并按工具反馈核实。
