# Workspace Preparation Registry 退役优化方案

> 状态：待实施、待实际业务根仓验证。日期：2026-11-24。
> 分析基线：winning-platform-rondo main Tree `0fb95275b6ffc6bcfb086fe797ac2a2790222740`；01 统一设计规范 v1.16.13。
> 本文为方案，不代表代码已修改或运行验证通过。

## 1. 目标与结论

退役 `skills/workspace-preparation/config/repo-registry.json`，删除 `rondo dev prepare` 对 Skill 级 JSON 的依赖。保留必要的业务仓库配置及现有 Git 准备、授权、幂等和安全边界。

遵循 First Principles、KISS、YAGNI、Native First、Specialist Focus、One Rule One Owner、Reference not Replication、Minimal Sufficient、Greenfield First。不是全局 Registry 退役，不增加 Agent、Skill、Gate、Metadata、状态机或配置服务。

## 2. 当前实现与证据

- [workspace-preparation/SKILL.md](../../skills/workspace-preparation/SKILL.md)：Bug / Requirement 的 `dev prepare` 均需要 `--config`，根仓 checkout、check-checkout、prepare-root 不需要。
- [dev/prepare.ts](../../rondo/src/commands/dev/prepare.ts)：读取 Registry，构造 MulticaClient，解析业务仓，再按模式执行授权和 Git 准备。
- [prepare-workspace.ts](../../rondo/src/commands/dev/prepare-workspace.ts)：消费 repo_path、repo_url、tfs_repo、tfs_project、default_target_branch；校验 TFS URL、目录、目标分支及已有 checkout。
- [requirement-worktree.ts](../../rondo/src/commands/dev/requirement-worktree.ts)：业务基础 Clone 与 feature/<tfs.id> Worktree。
- [requirement-guard.ts](../../rondo/src/commands/dev/requirement-guard.ts)：核验当前 Engineer Run、批准 Change、x-repositories 及 Registry 登记范围。
- [runtime-context.ts](../../rondo/src/clients/runtime-context.ts)：已有 resolveMulticaRuntime()，从环境解析当前 Runtime，不查询 Squad。
- [repo-context.yaml](../../docs/config/repo-context.yaml)：已有 25 个业务仓及根仓的身份与路径映射，尚无 default_target_branch。
- [repo-registry.base.json](../../workspace-config/repo-registry.base.json)：25 个业务仓当前目标分支均为 dev。
- [workspace/sync.ts](../../rondo/src/commands/workspace/sync.ts)：根据 repo-context、base 和 Workspace Overlay 生成 Skill Registry，已有远端文件差异删除能力。
- [01 统一设计规范](../../01-multica-openspec-design-guideline.md)。

当前 Registry 是派生配置，不是独立事实源。Workitem Analyst 仅准备根仓时无需 Registry；Bug Fix Agent 和 Engineer 准备业务仓时才需要仓库映射。

## 3. 目标态信息来源

| 字段 | 权威来源 / 处理 |
| --- | --- |
| multica_cli | MULTICA_CLI_PATH，默认 multica |
| multica_server_url | MULTICA_SERVER_URL |
| workspace_id | MULTICA_WORKSPACE_ID |
| rondo | 无需配置，命令本身 |
| repo_id / repo_key | 权威 repo-context.yaml 的 repo_id |
| repo_path、repo_url | 权威 repo-context.yaml |
| tfs_repo、tfs_project | 合法 TFS URL 解析；保留已有身份核验，已有 tfs_project 应与 URL 一致 |
| default_target_branch | repo-context.yaml 显式业务策略 |

复用 resolveMulticaRuntime()，不使用额外查询 Delivery Squad 的 resolveRuntimeContext()。不硬编码 dev，不把 Remote HEAD 或 Project Resource ref 当成 PR Target Branch。

当前 Multica Project Resource 默认主要登记根仓，不要求重新登记全部业务仓或建立新映射。Native Checkout 模式与现有持久根仓/Worktree 模式均保留。

### 实施前提

Rondo GitHub 配置仓与实际内网 TFS 业务根仓不是同一事实域。实施前核实实际业务根仓已提交的 docs/config/repo-context.yaml 覆盖所需业务仓、URL、路径和目标分支，并验证批准版本的映射可读取。不能将 Rondo 仓库配置存在视作所有 Runtime 已具备条件。

在现有 repo-context.yaml 及对应全量清单补充 default_target_branch。保留其他字段和现有仓库策略。仍消费 Registry 的 Skill 由现有 Workspace Sync 从同一权威字段生成目标分支，避免 base 与 YAML 双写；不擅自改变其他 Skill 的输出契约。实际部署根仓与派生 Registry 的数据一致性需在实施前确认。

## 4. CLI 改造

移除 dev prepare 必填 --config，目标命令：

```powershell
rondo dev prepare --mode bug --issue <issue> --repo <repo_key> --root-repo "<root>"
rondo dev prepare --mode requirement --issue <issue> --change-ref <change_ref> --repo <repo_id> --root-repo "<root>"
```

内部流程：

1. 获取当前 Multica Runtime，读取 Issue 并执行现有身份及授权检查。
2. 确定并核验根仓，读取权威仓库映射。Bug 使用可确认的根仓已提交映射；Requirement 优先复用已批准 analysis.source.commit 对应映射，避免相同 repo_id 在批准后指向不同仓库。不新增快照 Artifact 或 Metadata。
3. 解析目标 Repository，保持合法 TFS URL、身份、目录、目标分支等必要校验。
4. Requirement 保留批准 Change、全量 Scope 登记及目标仓 Scope 校验；保持 verify_agent.required 等现有副作用语义。尽量通过内部构造现有 Guard 可消费的数据结构实现，避免改变其他调用方。
5. Bug 继续调用 prepareBusinessWorkspace()；Requirement 继续调用 prepareRequirementWorktree()。
6. 返回现有 PASS / FAIL / UNKNOWN 及实际路径契约。

仅新增最小内部映射读取函数，优先复用已有 YAML 解析能力。保留现有 feat/<tfs.id> 与 feature/<tfs.id> 分支策略、候选续接、目录边界、Origin 校验及 dirty/unpushed 保护。不得把缺失映射猜测为合法仓库。

## 5. Skill 目标内容（建议）

```markdown
---
name: workspace-preparation
description: 按需准备或复用授权的本地 Git 工作区，支持根仓 Checkout、Bug Fix 业务仓 Clone 和 Requirement Worktree。
---

# Workspace Preparation

仅在需要本地工作树时使用。

## 根仓准备

优先复用当前 Task 的 Native Checkout。尚未检出时，使用 Project Resource 的 URL 和 ref：

    multica repo checkout <root-url> --ref <resource-ref>

Resource 未指定 ref 时省略 --ref。

使用实际 Checkout 路径核实根仓：

    rondo runtime check-checkout --root-repo "<root>"

Requirement 常驻根仓模式可使用：

    rondo runtime prepare-root

## Bug Fix

需要修改业务源码时，使用当前 Issue、目标 Repository 和根仓路径准备业务仓：

    rondo dev prepare --mode bug --issue <issue> --repo <repo_key> --root-repo "<root>"

## Requirement

Workitem Analyst 按需准备根仓即可。

Engineer 根据已批准 Change 的 Repository Scope 准备业务 Worktree：

    rondo dev prepare --mode requirement --issue <issue> --change-ref <change_ref> --repo <repo_id> --root-repo "<root>"

## Result

使用成功返回的实际工作区路径。

准备失败或结果不明确时，根据工具反馈核实并处理异常，不覆盖已有工作成果。
```

Skill 不承担 Runtime 解析、Workspace 身份核验、映射解析、配置生成或 Git 算法。

## 6. 实施范围

| 优先级 | 模块 | 改动 |
| --- | --- | --- |
| P0 | docs/config/repo-context.yaml 及全量清单、实际业务根仓 | 完善目标分支字段及覆盖范围 |
| P0 | rondo/src/commands/dev/prepare.ts | 移除 --config，复用 Runtime 与权威映射 |
| P0 | dev/prepare-workspace.ts | 适配输入来源，保留必要校验 |
| P0 | dev/requirement-guard.ts | 保持批准和 Scope 约束 |
| P0 | skills/workspace-preparation/SKILL.md | 精简命令与说明 |
| P0 | skills/workspace-preparation/config/ | 删除 |
| P0 | workspace/sync.ts | 从 REPO_REGISTRY_SKILLS 移除 workspace-preparation；统一目标分支事实来源 |
| P0 | 相关测试 | 验证配置退役及两条路径 |
| P1 | rondo/COMMANDS.md、11/12 设计文档 | 更新受影响的现行契约 |

复用 Workspace Sync 的远端文件差异删除能力；不新建迁移脚本。确认配置不再被生成或同步回平台。

## 7. 验收

- 实际业务根仓与批准版本的仓库映射完整、可读取，目标分支明确。
- Bug / Requirement 无 --config 正常准备及重入；返回实际路径。
- 无效身份、未批准仓库、未登记映射、错误 URL / 路径 / 分支等仍按现有契约拒绝或报告 UNKNOWN，且不覆盖已有成果。
- Clone / Worktree 的已有分支续接、dirty/unpushed 保护及 Origin 校验不退化。
- Workspace Sync 不再生成该 Skill JSON，已上传文件由原生差异同步清理。
- 其他 Skill 的 Registry 消费与现有 PR Preparation、PR Materialize、Delivery Closeout、TFS Writeback 契约保持正确；验证目标分支与准备基线一致。
- 更新受影响命令文档及测试；运行 Rondo Build 和相关回归测试，并区分本地测试与真实 Runtime 验证。

## 8. 非目标与设计审查

不改 Git 分支策略、Clone/Worktree 算法、Agent 职责、OpenSpec Schema、PR Materialize、Delivery Closeout、TFS Writeback，不借此退役其他 Skill Registry。

不新增 Registry Service、registry resolve CLI、RONDO_REGISTRY_PATH、公共 JSON 副本、配置缓存、Repository Metadata、每 Issue 快照、全 TFS 仓库自动发现或双模式 --config 兼容层。无明确兼容需求时不保留旧入口。

设计结论：保留必要业务配置，消除不必要的配置传递。Runtime 归 Multica，仓库映射归已有工程事实源，确定性执行归 Rondo，Skill 仅提供按需准备方法及结果消费。
