# 12｜Multica Native Repo 工作区准备方案

> **状态**：设计方案，待最小 Spike 验证（2026-11-20）；不代表 Runtime 或交付验收已通过。
>
> **依据**：[01 统一原则](01-multica-openspec-design-guideline.md)、[11 Workspace Preparation](11-workspace-preparation-skill-design.md)、[08-B Requirement 交付](08b-requirement-remote-git-delivery.md)、[08-B 根仓发布](08b-requirement-root-branch-and-publish-plan.md)、[09 Engineer](09-unified-engineer-development-design.md)。

## 1. 目标与边界

探索将 **Multica Native Repo Checkout** 作为现有 `workspace-preparation` Skill 的一种**环境准备 Method**，优先代替 Requirement 流程中 Rondo 自建的持久根仓与业务 Worktree 准备，不重构 Git 交付。

**结论**：Multica 源码支持 Project 多 Git Resource、Task 内按需 Checkout、独立 Task Branch 和不同仓库的嵌套 Checkout；但与当前 Rondo 的本地分支、业务候选发布约束尚未端到端兼容。先验证再接入，不直接切换默认模式。

- **Multica**：创建、复用、隔离本地 Checkout / Task Branch。
- **Rondo**：保留批准 Scope 校验、OpenSpec 单 Change 远端发布、Candidate Push/SHA 回读及 PR/TFS 交付。
- **OpenSpec / Multica Issue**：继续分别作为 Engineering Truth / Delivery Truth；不建立第三套事实源。
- **Skill**：按需选择准备方法、消费实际路径和报告 `PASS/FAIL/UNKNOWN`；不复制 Git 算法，也不要求固定 Skill 调用链。

原有 Bug Fix Native Checkout + Rondo Clone、Requirement 持久根仓 + Rondo Worktree 暂不退役。本方案不新增 Agent、Manager、Runtime、Metadata、Schema、Gate 或独立工作流。

## 2. 角色与工作区

| 角色 | 本地准备 | 专业职责 |
| --- | --- | --- |
| Wayfinder | 无；通过只读 MCP 取证 | 准入判断，不操作本地 Git |
| Workitem Analyst | 按需 Native Checkout 根仓 | 编辑、校验 OpenSpec；通过既有 Analysis Complete 发布 |
| Engineer | 按需 Native Checkout 根仓，再按批准 Scope Checkout 业务仓 | 读取批准 SHA、实现、验证、Commit、通过既有交付入口发布 |
| Bug Fix Agent | 保持现有模式 | 本方案不强制迁移 |

### 2.1 Project Resource 与 Scope

项目管理者预先配置根仓及业务仓的 `github_repo` Resources；其 URL 可以是 Runtime 能访问的 **TFS Git URL**，不要求 GitHub 托管。Resource 的 `ref` 是 Checkout **起始版本**，不是本地工作分支或最终 Push 目标。

- **Resource**：仓库可用性与默认起点；不会自动 Checkout 全部仓库，也不代表当前 Issue 的写授权。
- **`docs/config/repo-context.yaml` / Rondo Registry**：已有 `repo_id`、`repo_url`、`repo_path`、交付目标分支等权威映射；不复制第二份映射。
- **已批准 `.openspec.yaml/x-repositories`**：Engineer 允许修改的仓库范围上限。复用 Rondo 的 `guardRepository()` 等既有确定性校验，不靠提示词单独授权。

根仓目前使用 TFS Git 权威 URL；不能未经验证用 GitHub 镜像替代并对同一源执行 Rondo Publish，否则 Origin 身份核验会失败。内网 Git 认证必须在执行 Task 的 Runtime 上真实验证。

### 2.2 Checkout 方法和结果

在有效的 Multica Daemon Task 中，按需执行：

```bash
# 从 Task workdir Checkout 根仓；使用命令返回的实际路径
multica repo checkout <root-url> --ref main

# 进入已确认的根仓目录；每一个业务仓均从该目录执行，不在上一个业务子仓内执行
cd <actual-root-path>
multica repo checkout <business-url> --ref <verified-base-ref>
```

预期根仓包含 `openspec/`，业务仓位于根仓下的独立子目录。实际目录以 CLI 返回的路径为准，并核对 `repo_path` 映射、Git Top-Level、Origin/Push URL、根仓对业务仓目录的 Ignore/Tracking 边界；不推测名称，不自动 Symlink 或清理。

**就绪前提**：

1. 当前 Task 授权有效，Checkout 路径属于该 Task；返回的仓库与配置 URL 匹配。
2. 确认所需基线的远端版本和本地实际 Git 状态。**Checkout 返回路径不等于成功同步到远端最新版本**：Multica 在 Fetch 失败时可能保留 Cache 的旧版本并报告 `fetch_error`。
3. Workitem Analyst 使用的 Schema/Specs/Repository Mapping 必须来自可确认的规范版本；Engineer 根据已批准的 `analysis.source.commit` 获取工程契约，业务仓按第 4 节核对实际 Candidate 基线。
4. 既有目录、dirty/untracked/unpushed Commit 必须保留。Native Checkout 返回 `kept` 时检查实际 HEAD 和来源；若不能确认适用于当前 Issue，不视为就绪。**不得用 `--fresh`、reset、clean、force push 自动覆盖现场。**

成功消费实际路径；无法确认身份、版本、授权或 Git 状态时停止受影响操作，报告 `FAIL/UNKNOWN`。就绪结果不等于 Analysis Gate、Human Approval 或 PR Gate PASS。

## 3. Workitem Analyst：根仓单 Change 发布

Multica Native Checkout 的本地 HEAD 通常是 `agent/<agent>/<task>` Task Branch。即使 `--ref main`，也**不要求 HEAD 等于 `RONDO_WORKSPACE_BRANCH`**。

| 概念 | Owner 与约束 |
| --- | --- |
| 本地 Task Branch | Multica 管理，用于编辑和 Commit |
| `RONDO_WORKSPACE_BRANCH` | Rondo 的**远端发布目标**，当前通常为 `main` |
| `analysis.source` | 正式发布后从远端回读的 `repo_url + branch + commit + change_ref`，而非本地 Task HEAD |

Workitem Analyst 在已核验的 Native 根仓编辑、校验并 Commit 当前 Change；`rondo analysis complete --mode requirement` 应沿用现有 `publishCommittedChange()`，**仅将当前 Change 已提交工件**定向发布到配置的远端分支，回读实际 SHA，维持批准版本及跨 Run 交接契约。

**最小兼容点**：当前 `root-git.ts` 的 `checkTarget()` 强制本地 Branch 与 `expectedBranch` 相同。Native 路径应移除此不适用的等名条件（或等效地按环境准备方式区分），但**保留** Git Root/Origin、远端目标 Branch、已提交 Change、Gate、冲突与重试安全、SHA 回读等校验；持久根仓原有分支就绪检查不改变。

Native 模式不调用 `rondo runtime prepare-root` 将 Task Branch 强行切回 `main`。也不允许以 `git push HEAD:main` 代替单 Change Publisher，因为会夹带无关 Commit。

Engineer 跨 Run 必须读取已批准的 `analysis.source.commit`；`dev.publication` 继续独立记录研发发布 SHA，不能覆盖批准 SHA。

## 4. Engineer：业务仓 Candidate 续接

业务仓的 Native Task Branch **不同于**远端 PR Source Branch `feature/<tfs.id>`；保留原有 PR Source/Target、TFS 和 Candidate SHA 契约，不要求本地同名。

按已批准 `x-repositories` 选择实际需要修改的仓库，并在 Checkout **前**确定起点：

| 远端状态 | Native Checkout 起点 | 预期后续 |
| --- | --- | --- |
| `feature/<tfs.id>` 不存在 | Registry 的 `default_target_branch`（通常为 `dev`） | 完成工作后首次创建远端 Candidate |
| `feature/<tfs.id>` 存在且可确认 | 该远端 Candidate 的版本 | 继续已有工作，不从 `dev` 丢弃已发布修改 |
| 远端状态、来源或分支关系不可确认 | 不判就绪 | 保留现场并停止 |

**`--ref feature/<tfs.id>` 仅决定 Task Branch 起点**，并不切换到该正式分支。跨 Run、跨 Runtime 以远端 Candidate 的已发布 Commit 为交接依据，不依赖其他 Agent 的本地目录。Native 已有 Checkout 若被保留（`kept`），不得假定传入新 `--ref` 就成功切换。

Engineer 在 Task Branch 完成 Commit 后，Rondo 仅负责最小必要的**受控远端 Candidate 发布**：验证仓库身份、批准 Scope、远端分支、提交关系及候选 SHA；只允许不覆盖已发布变更的安全 Push，禁止 force push；并发前进或历史分叉时停止并保留现场。发布成功后回读 `feature/<tfs.id>` 实际 HEAD/SHA，由现有 `rondo dev pr-prep`、PR/TFS 流程继续消费。

**兼容点**：当前 `rondo dev prepare --mode requirement` 假定根仓下有完整业务基础 Clone、为每个 TFS ID 创建 sibling Worktree，不能直接用于 Native Checkout。Native 模式不重复 Clone/Worktree；仅适配现有准备/候选发布入口所需的路径与分支前提。现有 `pr-prep` 使用 `<root>/<repo_path>` 定位业务仓并核远端 SHA，需用实际路径验证，不重写 PR 契约。

## 5. 最小 Spike 与实施门槛

**先做隔离验证，不先改正式 Agent/Skill 配置。**

| 步骤 | 验证 | PASS 条件 |
| --- | --- | --- |
| S1：Native Checkout | 隔离 Project 配置根仓与 2 个业务仓；在目标 Runtime 实际 Checkout/嵌套/重入 | 有效凭据、真实路径、Origin、分支、Ignore、Fetch/Kept 语义均可确认；失败保留现场 |
| S2：Analysis 发布 | Native Task Branch 编辑并 Commit 一个 Change，验证既有 Publisher 的最小兼容点 | 只发布该 Change；远端分支与 `analysis.source` SHA 一致；其他 Change 不夹带 |
| S3：Engineer Candidate | 一次新 Candidate、一次从已有 Candidate 续接，并模拟远端前进 | `feature/<tfs.id>` SHA 可回读；失败不覆盖远端或本地；PR Preparation 可消费 |
| S4：启用前回归 | 在拟启用 Runtime 上验证 08-B/09 的批准、研发发布、PR 和必要失败路径 | 与现有 Engineering/Delivery 契约一致；未测部分明确标记，不能宣布完整 PASS |

**实施范围**：仅当 Spike 复现必要冲突时，最小调整 `workspace-preparation`、相关准备提示词和 Rondo 的局部分支/路径兼容点；现有 08-A、08-B 独立问题、Git 发布算法、TFS/Gate/Metadata 不借此扩散。若 Native 行为或安全交接无法证实，保留现有工作区准备方式。

## 6. 设计判断与风险

| 判断 | 说明 |
| --- | --- |
| Native First | 用 Multica 替代本地 Git 环境管理，不建立第二套 Runtime |
| Specialist Focus | Agent 只负责其专业产出；环境准备集中在原 Skill，交付由现有机制控制 |
| KISS / YAGNI | 不为第三种 Method 创建流程、状态机、Manager、配置源或通用 Git 抽象 |
| One Rule One Owner | Multica = 本地 Task Checkout；Rondo = 交付校验与远端发布；OpenSpec = 工程事实 |
| 首要风险 | Task Branch 与远端发布目标不同；现有 Rondo Branch/Path 前提不兼容 |
| 环境风险 | TFS Git 认证、Cache 旧基线、路径冲突、Windows/Linux Checkout 细节及跨 Task 未发布 WIP |

保留两个决策：**远端根仓发布目标沿用配置的 `main`（或实际项目分支）；业务 Candidate 沿用 `feature/<tfs.id>`。** 只有本地 Checkout 的归属及方式变化，不增加远端分支体系。

### 相关实现与官方依据

- 本项目：[workspace-preparation/SKILL.md](workspace-skills/workspace-preparation/SKILL.md)、[root-git.ts](../../tools/rondo/src/commands/runtime/root-git.ts)、[requirement-worktree.ts](../../tools/rondo/src/commands/dev/requirement-worktree.ts)、[pr-prep.ts](../../tools/rondo/src/commands/dev/pr-prep.ts)。
- Multica：[Project Resources](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/project-resources.mdx)、[Runtime Repo Checkout](https://github.com/multica-ai/multica/blob/main/server/internal/service/builtin_skills/multica-platform/references/runtimes.md)、[CLI](https://github.com/multica-ai/multica/blob/main/server/cmd/multica/cmd_repo.go)、[Cache/Worktree](https://github.com/multica-ai/multica/blob/main/server/internal/daemon/repocache/cache.go)。

**验收说明**：本文件为方案及预期验收标准。未执行真实 Multica Runtime Checkout、Rondo Build、测试或 PR/TFS 端到端验证。
