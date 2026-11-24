# 14 — Pull Request 共用 Skill 优化方案

- 日期：2026-11-24
- 状态：设计草案，待评审；本次仅保存方案，不实施
- 设计依据：[01 设计原则](01-multica-openspec-design-guideline.md)
- 关联：[11 Workspace Preparation](11-workspace-preparation-skill-design.md)、[Native Workspace 设计](12-native-repo-workspace-preparation-design.md)、[09 Engineer 研发设计](09-unified-engineer-development-design.md)

## 1. 目标与结论

将 `bug-delivery` 与 `change-development` 收敛为一个共用 Skill：`pull-request`，供 Bug Fix Agent 与 Engineer 使用。其边界从已完成实现与必要验证的授权代码变更开始，到 PR 创建或复用、确认 Issue 进入 in_review 为止。只提供 PR Preparation、必要提交前置操作、PR Materialization 及结果处理；按 Bug / Requirement 场景保留必要差异。

统一 Skill 不等于统一业务流程、Evidence Schema、CLI 或 Agent。遵循 KISS、YAGNI、Specialist Focus、One Rule One Owner、Native First、Minimal Sufficient、Right-sized Execution 和 Contract First。避免把 Skill 演变成整个交付生命周期的总控流程。

此前独立的 `bug-evidence-contract.md` 合并建议纳入本方案，不再单独实施。

## 2. 当前实现与真实差异

依据当前 main 的 [bug-delivery](skills/bug-delivery/SKILL.md)、[change-development](skills/change-development/SKILL.md)、[Bug Fix Agent](agents/bug-fix-agent/instructions.md)、[Engineer](agents/engineer/instructions.md)、[Bug PR Prepare](rondo/src/commands/bug/pr-prepare.ts)、[Requirement PR Prepare](rondo/src/commands/dev/pr-prepare.ts)、[PR Materialization](rondo/src/commands/pr/materialize.ts) 和 [Provisioning](workspace-config/provisioning.json)。

| 能力 | Bug | Requirement |
| --- | --- | --- |
| 授权依据 | 已授权 TFS Bug、Repository Scope | Human Approval、固定版本 OpenSpec Change、x-repositories |
| 工程工作 | 根因诊断、缺陷修复、必要回归 | 读取获批契约、实现与更新 Tasks |
| 公共质量要求 | 实际验证、Code Review、处理 Blocking Findings | 同左 |
| Candidate | Commit / Push、完整 SHA | Commit / Push、完整 SHA |
| PR Preparation | rondo bug pr-prepare | rondo dev pr-prepare --mode requirement |
| 输入 | Evidence JSON，包含根因、修复、验证结论与引用 | Delivery Facts JSON，包含 validation.command、Code Review、PR Description |
| 验证机制 | 校验 Agent 提供的结论和引用结构；不自动验证引用真实性或重跑测试 | 在真实 Candidate Checkout 执行 validation.command，检查退出码和 Candidate |
| 多仓交付 | 首次准备固定 required_repos；全部 ready_for_pr | 获批 Repository Scope、Publish、Completion Check |
| PR 创建 | rondo pr materialize | rondo pr materialize --mode requirement |
| 恢复 | Human 授权的 bug resume | 按现有 Requirement 机制 |
| Worktree | 不涉及 Requirement Worktree 清理 | 当前 materialize 成功后受控清理 |

PR 创建或复用、关联 TFS Work Item、登记 current_pr、全部登记成功后转 in_review 已由公共 CLI 承担。无需在 Skill 中复制内部算法。

## 3. 方案选择

| 方案 | 评价 |
| --- | --- |
| 保留两个 Skill，仅各自精简 | 改造成本低，但交付方法和说明持续重复 |
| 保留两个 Skill，再新增 pr-delivery | 形成三个 Skill；公共确定性 PR 操作已有 CLI，额外组合收益不足 |
| 合并为 pull-request，内部区分两种场景 | 推荐；减少一个 Skill，不新增调用链、状态、命令或数据结构 |

命名采用 `pull-request`（Git 原生领域术语），职责由 Skill Description 和执行说明限定，覆盖 Candidate 核验、PR Preparation 与 PR Materialization。验证方法、代码实现、需求理解、根因诊断、工作区准备、Human Review、PR Merge、状态巡检与 Delivery Closeout 均不是本 Skill 的职责。Requirement 的 Publish / Completion Check 仅作为 PR 提交所需的既有前置操作。

## 4. 职责与流程

- Bug Fix Agent：根因诊断、缺陷修复、必要回归、专业质量判断和代码交付结果。
- Engineer：理解已批准工程契约、实现、集成、验证、更新已验证 Tasks 和代码交付结果。
- pull-request：当前场景所需 PR 输入、Candidate 核验、提交前置操作、CLI 使用及 PR 结果处理。
- Workspace Skill：按需准备授权工作区；保持独立，使用实施时已生效的 workspace-preparation / native-workspace 契约，不复制 Git 工作区准备算法。
- Rondo CLI：身份、授权、Candidate、确定性校验、交付事实登记、PR 创建或复用和现有状态更新。
- Multica Issue / Git / PR / OpenSpec：分别保留已有交付事实、代码事实、审核载体、Requirement 工程契约。
- PR Status Sync / delivery-closeout：保持既有收口职责，不进入本 Skill。

公共提交前提：代码修改、必要验证与 Code Review 已完成，Blocking Findings 已解决，实际 Candidate 已 Commit；完成必要 Push 后按当前场景准备 PR，全部必要仓库就绪后创建或复用 PR，确认结果。Agent 自主选择诊断、编码与测试方法，不将研发活动写成 PR Skill 的执行步骤。

原 change-development 中的研发专属要求不可随旧 Skill 退役而丢失：Engineer Instructions 最小补充通过 rondo analysis read 读取固定获批 Change，以及通过 rondo change update-progress 更新已验证 Tasks 的职责和命令入口。先确认当前有效 Instructions / 工具说明是否已覆盖，已有内容不重复。不新增研发 Skill 或固定调用链。

## 5. Skill 结构

```text
skills/
  pull-request/
    SKILL.md
    config/
      repo-registry.json
```

复用现有 Registry 配置供给，是否仍需该配置以实施时实际命令为准。不新增 Schema、Template、Script、Reference 或独立状态。

建议 Skill 定义：

```yaml
---
name: pull-request
description: 为已完成实现和验证的代码变更准备并创建 PR，适用于 Bug 和 Requirement。
---
```

建议 SKILL.md 结构：

- Inputs
- Submission Preconditions
- Bug PR Preparation（必要 Git Push、Evidence、PR Preparation、Abandoned PR Recovery）
- Requirement PR Preparation（Delivery Facts、PR Preparation、Publish & Completion）
- PR Materialization
- Result & Recovery

公共原则集中表达，场景章节自包含必要差异，不复制 Agent 长期职责、CLI 内部 Metadata 算法或历史演进说明。

### 5.1 Bug PR Preparation

保留已授权 TFS Bug、真实根仓、Repository Scope、Candidate Commit（含 Refs: #<tfs.id>）及 PR 标题等前提。现有受控 Git Push 用于提交 Candidate；Fetch 仅在提交前核对远端事实确有需要时使用，不强制执行或接管工作区准备。研发过程中需要 Fetch 时仍可使用同一既有命令，不依赖 PR 准备已开始。

```bash
rondo bug git --operation fetch --config "<config>" --issue <KEY> --repo <repo_key> --root-repo "<root>"
rondo bug git --operation push --config "<config>" --issue <KEY> --repo <repo_key> --root-repo "<root>"
```

Fetch 仅更新远端事实，不整合；Push 非强制。失败或未知时先核实远端，认证信息不得进入 URL、参数或日志。

将最小 Evidence 示例直接纳入 Skill，删除独立 [bug-evidence-contract.md](skills/bug-delivery/references/bug-evidence-contract.md)。示例仅说明格式，不代表真实结果：

```json
{
  "expected_behavior": "预期行为",
  "actual_behavior": "实际异常",
  "root_cause": {
    "confidence": "confirmed",
    "summary": "根因结论",
    "evidence_refs": ["实际证据引用"]
  },
  "fix_summary": "修复内容",
  "regression": {"result": "PASS", "summary": "实际回归结果", "evidence_refs": ["实际证据引用"]},
  "local_validation": {"result": "PASS", "summary": "实际验证结果", "evidence_refs": ["实际证据引用"]},
  "code_review": {"result": "PASS", "summary": "实际审查结果", "evidence_refs": ["实际证据引用"]},
  "blockers": []
}
```

- probable 根因须说明 remaining_risk，可能推翻修复的关键替代根因不得放行。
- 真实、可核查的 Evidence References；不复制完整日志或敏感数据。替代验证说明依据与局限，不虚报 PASS。
- 未解决 Non-blocking Finding 使用 code_review.findings，记录 blocking:false 与 risk_note 或 risk_ref；Blocking Finding 必须先解决。无 Finding 时可省略 findings。blockers 显式为空数组。
- issue、tfs_id、repo_key、candidate_commit 由 CLI 核验，可省略；显式提供时必须匹配。
- 多仓逐仓记录验证事实，首次 pr-prepare 提供完整 --required-repos，已固定范围不得自行改变。

```bash
printf '%s' "$evidence_json" | rondo bug pr-prepare --config "<config>" \
  --issue <KEY> --repo <repo_key> --candidate-commit <sha> \
  --evidence - --title "<title>" --root-repo "<root>"
```

多仓首次追加 --required-repos <repo1,repo2>；无可靠 UTF-8 管道时使用系统临时 UTF-8 JSON 文件，改传 --evidence "<path>"，不得加入 Git。自定义分支保留现有显式参数和身份核验；默认 PR Description 由 CLI 生成，确有必要时才传 --description。全部仓库准备完成且 ready_for_pr=true 后物化。

Abandoned PR：仅 Human 明确授权且全部当前 PR 确认 abandoned 时执行：

```bash
rondo bug resume --config "<config>" --issue <KEY> --human-comment-id <id> --next REWORK|RECREATE_PR
```

REWORK 重新诊断、修复、验证及准备；RECREATE_PR 仅复用未变 Candidate 与有效 Evidence。状态混合、授权不明、候选变化等按现有规则停止受影响操作并核实，不覆盖事实。

### 5.2 Requirement PR Preparation

保留 analysis.source、Human Approval、获批 Change、x-repositories 的授权依据。消费 Engineer 已完成的实现、实际验证、Code Review 与 Tasks 更新结果；不在此 Skill 中规定读取 Change、编码或更新 Tasks 的研发过程。不另建永久 Evidence / Review 报告；实质契约变化退回 Human Review。

准备 Change 目录外的临时 delivery-facts.json，不 Commit / Push / Archive：

```json
{
  "validation": {
    "command": ["npm", "test"],
    "summary": "实际验证范围与结果"
  },
  "code_review": {
    "result": "PASS",
    "candidate_commit": "<实际审查的完整 Candidate SHA>",
    "summary": "实际审查结论",
    "findings": []
  },
  "blockers": [],
  "description": "专业变更摘要、验证结果及剩余风险"
}
```

验证命令和目录由 Engineer 按实际项目选择，示例不是固定测试要求。保留现有 CLI 在 Candidate Checkout 真实执行验证的机制，不降级为手写 PASS。多仓逐仓准备。

```bash
rondo dev pr-prepare --mode requirement --config "<config>" --issue <KEY> --repo <repo_id> \
  --change-ref <change_ref> --root-repo "<root>" --candidate-commit <sha> --title "<title>" \
  --delivery-facts "<temporary-json>" --validation-cwd "<candidate-checkout>"

rondo dev publish --config "<config>" --issue <KEY> --change-ref <change_ref> --root-repo "<root>"
rondo dev check-change --config "<config>" --issue <KEY> --change-ref <change_ref>
```

仅确属非实质 Design 细化才使用 --minor-design。保持现有发布、Completion Gate 与工件授权规则。

### 5.3 PR Materialization / Result

Bug：

```bash
rondo pr materialize --issue <KEY> --config "<config>"
```

Requirement：

```bash
rondo pr materialize --mode requirement --issue <KEY> --config "<config>" --change-ref <change_ref> --root-repo "<root>"
```

复用现有 CLI；从适用的实际根仓执行 Requirement Materialization，保留当前受控 Worktree 清理机制（以实施时 native-workspace 变更后的有效契约为准）。确认所有必要 PR 已登记、Issue 进入 in_review。明确失败修复缺口；外部写入未知先回读事实，保留现场，不盲目重试或覆盖。交付实际修改、验证结论、Candidate、必要 PR / Issue 引用和剩余风险；Requirement 补充已完成 Tasks。复用有效 Issue 摘要。

## 6. 不统一的事项

- 保留 bug pr-prepare 与 dev pr-prepare；不新建 pr prepare facade 或重新命名 CLI。
- 保留两种 JSON 契约。Bug 无 OpenSpec，需根因和回归证据；Requirement 已有工程契约，且实际执行 validation.command。强行统一会增加 Optional Fields、Conditional Schema、兼容逻辑。
- 不合并 Agent，不调整授权、Scope、Gate、Metadata Schema、PR Materialization、Delivery Closeout、Workspace 算法。
- 不引入固定 Skill 调用链、Route、状态或额外验证报告。

## 7. 实施范围与顺序

1. 重新读取实施基线，尤其是并行 native-workspace 改造后的实际命令和工作区契约；避免将旧路径重新引入。
2. 创建 pull-request Skill，合并必要说明，保留两场景功能和现有数据格式；退役 bug-delivery、change-development 及其独立 Evidence Reference。
3. 更新 workspace-config/provisioning.json 中 managed_skills 和 Bug Fix Agent / Engineer 绑定；保留其他 Skill。按第 4 节核查 Engineer Instructions，必要时最小补充原 Skill 的获批 Change 读取和 Tasks 更新职责，保留命令可发现性；Bug Fix Agent 的专业职责不变。
4. 核查并更新 Registry 渲染/配置投影、Workspace Sync / Provision、Agent README、当前有效设计文档、测试与其他实际名称引用。仅更新必要引用，不重写 archive、历史 replay 和 validation evidence。
5. 核实平台旧 Skill 解绑、删除与新 Skill 注册行为；优先复用现有机制，不默认删除 Git 文件即可退役平台 Skill。实施及平台发布按实际授权处理。

## 8. 验收

- 两 Agent 绑定共用 Skill，原有研发能力与命令入口不丢失；Engineer 可读取固定获批 Change 并更新已验证 Tasks，不依赖已退役 Skill；无活跃旧 Skill 引用或失效文件引用。
- Bug 单仓/多仓、Evidence、Git、Candidate、PR 创建或复用及 Abandoned PR 恢复行为不变。
- Requirement 的获批契约、Tasks 更新、Candidate 实际验证、Publish、Completion、PR 和适用清理行为不变。
- 两种输入 JSON 与原 validator 兼容；保留必要风险、Blocking Findings、授权和身份核验，不新增永久工件。
- 配置投影、Skill Manifest、Workspace Sync / Provision 与现有 Bug / Requirement PR、Completion、Closeout 回归测试通过。
- 同步到目标 Workspace 后核实新 Skill 内容、绑定和旧 Skill 退役情况；未实际同步或运行验证不得宣称已完成。

## 9. 01 原则复核

| 原则 | 方案落实 |
| --- | --- |
| KISS / YAGNI | 2 个 Skill 收敛为 1，不新增第三个 PR Skill 或统一 Schema |
| Specialist Focus | Agent 专业职责不变，Skill 聚焦 PR 准备与提交 |
| One Rule One Owner | 公共执行说明集中；CLI 负责机器校验，Agent 负责专业事实 |
| Native First | 复用 Multica、现有 Rondo CLI 和 Workspace 供给机制 |
| Minimal Sufficient | 仅保留必要输入、命令、场景差异和结果处理 |
| Right-sized Execution | 根据当前场景执行，专业方法自主选择 |
| Contract First | 保留真实有效的各自工程及交付契约 |
| Skill Extraction | 依据已有跨 Agent 复用，不按步骤人为新增能力 |

目标：Skill 数量 2 → 1；新增 CLI 命令 0；新增 Metadata 字段 0；保留两种专业交付场景。

本方案仅保存当前讨论结论，尚未实施或执行运行验证。
