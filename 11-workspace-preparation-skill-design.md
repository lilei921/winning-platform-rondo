# 11｜Workspace Preparation Skill 独立化设计

> **状态**：设计方案，待实施和验证（2026-11-19）。
>
> **依据**：[01 统一原则](01-multica-openspec-design-guideline.md)、[08-A Bug Fix](08a-remote-analysis-bug-fix-foundation.md)、[08-B Requirement](08b-requirement-remote-git-delivery.md)、[09 Engineer](09-unified-engineer-development-design.md)。

## 1. 目标与边界

新增 `workspace-preparation` Skill，将分散在 Agent Instructions 和专业 Skills 中的**本地 Git 工作区准备方法**收敛为一个可复用能力。

保留两套既有机制：

- **Bug Fix**：Multica Native Checkout 准备 Task 根仓；需要本地修改或验证时，由 Rondo 按需 Clone 业务仓。
- **Requirement**：Rondo 准备 Runtime 持久根仓；需要修改业务代码时，按 TFS ID 准备或复用业务 Worktree。

Skill 只说明**何时准备、调用哪个现有入口、如何使用结果及失败时如何停止**。Multica / Rondo 继续负责实际 Checkout、Git 操作和确定性校验；业务授权、研发、Commit/Push、OpenSpec 发布、PR 均归现有 Owner。

不新增 Agent、Runtime、Workspace Manager、Metadata、状态机或独立准备结果文件。无需本地工作树的只读调查继续使用已有 MCP，不强制 Checkout / Clone。

## 2. Skill 方法

**名称及位置**：`projects/multica/workspace-skills/workspace-preparation/SKILL.md`，frontmatter `name: workspace-preparation`。

**Description 建议**：按需准备或复用已授权的本地 Git 工作区；适用于 Bug Fix 的 Native Checkout / 业务仓 Clone，以及 Requirement 的持久根仓 / 业务 Worktree。

### Bug Fix

1. 需要本地根仓时，复用当前 Multica Task 的原生 Checkout。首次检出使用 Project Resource 的 URL，在已配置 ref 时显式传入 `--ref`，并使用平台返回的实际路径。
2. 调用 `rondo runtime check-checkout --root-repo <root>` 核实根仓就绪。
3. 需要本地业务源码时，对已授权的仓库调用：

   `rondo dev prepare --mode bug --config <config> --issue <issue> --repo <repo_key> --root-repo <root>`

### Requirement

1. 需要本地 OpenSpec 根仓时，调用 `rondo runtime prepare-root`；使用返回的 `root_repo`，根仓分支按既有 `RONDO_WORKSPACE_BRANCH` 配置。
2. 需要修改业务仓的 Engineer，对已授权的 `repo_id` 调用：

   `rondo dev prepare --mode requirement --config <config> --issue <issue> --change-ref <change_ref> --repo <repo_id> --root-repo <root>`

3. Workitem Analyst 仅准备所需根仓；不因 OpenSpec 分析而创建业务 Worktree。

**结果处理**：使用实际返回的根仓或业务仓路径；`PASS` 仅表示本次准备成功。`FAIL` / `UNKNOWN` 时按工具反馈核实并保留现场，不自行清理、覆盖或假定成功。

以上是按场景选用的方法，不是所有 Agent 必须完整执行的步骤链。仓库身份、授权范围、分支命名、重入与并发安全以现有 Multica / Rondo 及 08-A、08-B 契约为准，不在 Skill 中复制实现规则。

## 3. Agent 绑定及现有 Skill 精简

在 `workspace-config/provisioning.json` 的 `managed_skills` 增加 `workspace-preparation`，并为以下 Agent 追加绑定：

| Agent | 使用场景 |
| --- | --- |
| Bug Fix Agent | Native Checkout、业务仓准备 |
| Workitem Analyst | Requirement 持久根仓准备 |
| Engineer | Requirement 持久根仓、业务 Worktree 准备 |

不新增 Wayfinder、Delivery Lead、TFS Sync Agent、PR Status Sync Agent 绑定，也不调整已退役 Agent / Skill。

| 执行资产 | 本次修改 |
| --- | --- |
| `agents/bug-fix-agent/instructions.md` | 删除 Checkout 具体步骤；保留需要本地修复时使用 `workspace-preparation` 的简短入口 |
| `workspace-skills/bug-delivery/SKILL.md` | 移除业务仓准备方法；保留 Git Fetch/Push、Candidate 与 PR Preparation |
| `workspace-skills/spec-preparation/SKILL.md` | 移除根仓准备方法；保留 OpenSpec `cwd`、Schema、Artifact 和 Validation 的自身校验 |
| `workspace-skills/analysis-publish/SKILL.md` | 移除根仓准备方法；保留 Analysis Gate、Commit、Publish 与结果回读 |
| `workspace-skills/change-development/SKILL.md` | 移除根仓和业务 Worktree 准备方法；保留研发、验证、Evidence、Git 交付与 PR |

Workitem Analyst、Engineer 的 Instructions 仅在确有必要时增加一句本地工作区使用提示，不复制完整 Procedure。

**专业 Skill 保持独立**：它们消费已确认的实际工作区路径，不依赖“另一个 Skill 必须在本次 Run 中先执行过”的隐藏状态；路径不可用时，由当前 Agent 按需调用 `workspace-preparation`，不增加强制 Skill 调用链。各专业 Skill 自身的授权、工件和交付校验不迁移。

## 4. 必需的配置接入

当前 `tools/rondo/src/commands/workspace/sync.ts` 使用 `REPO_REGISTRY_SKILLS` 显式指定 `config/repo-registry.json` 的渲染目标。

**实施时必须将 `workspace-preparation` 加入该名单**，否则新 Skill 虽已注册，`rondo dev prepare --config` 仍可能缺少本 Skill 的 Registry 文件。复用当前 `repo-context.yaml`、Registry Base、Workspace Overlay 与既有 `provision / sync`，不增加新的配置源。

更新 `workspace-skills/README.md` 中的 Skill 说明和绑定入口即可；其他文档不复制本 Skill 的操作方法。

## 5. 实施与验收

实施范围限定为：

1. 新建 `workspace-preparation/SKILL.md`（按需准备、结果、停止条件；不附加专用脚本或新 Schema）。
2. 修改 `provisioning.json`、`workspace/sync.ts` 及现有 Agent/Skill 的重复准备提示词。
3. 在测试 Workspace 使用既有 Provision / Sync，回读 Skill 内容、Registry 和三个 Agent 的真实绑定。升级已有 Workspace 时，若 `bug-delivery` 仍显示旧描述，用 `multica skill update <skill-id> --workspace-id <workspace-id> --description "<当前 frontmatter 描述>"` 更新。
4. 验证 Bug Fix 原生 Checkout + 按需 Clone，Requirement Analysis 持久根仓，以及 Engineer 业务 Worktree；覆盖复用与准备失败，确认原交付能力未退化。

本次**不修改** Git Clone / Worktree / Publish 的实现，不调整 PR、TFS、Verify Metadata 或审批流程。共享根仓并发及独立发布仍按 08-B 专项契约验收，不因 Skill 抽取宣称已解决。

**完成标准**：仓库准备方法集中到 `workspace-preparation`；专业 Agent/Skill 不再重复维护 Checkout、Clone、Worktree 准备规则；配置渲染和实际绑定可用，两套现有研发路径保持正常。
