---
title: 09-A 专题｜Repository Scope 权威来源与执行期维护方式分析
version: 1.0.0
status: draft
created_at: 2026-11-19
updated_at: 2026-11-19
owner: winning\li_lei
---

# 09-A 专题｜Repository Scope 权威来源与执行期维护方式分析

**状态**　2026-11-19 完成代码级核查，结论待 Human 决策，本次不改机制。

**触发问题**　LEI-40（TFS 266607）由 Multica Desktop 执行时，提出"把受影响的仓库范围维护在 `proposal.md` 的 `## Repository Scope` 章节下"，并追问是否可以把受影响仓库改为维护在结构化数据内（例如 `openspec/changes/<change>/.openspec.yaml`）。

**文档边界**　本文只记录基于当前代码与配置的核查结论、可选路径及其代价，**不构成实施决定**，也不修改任何契约文件。规范归属仍由 [01 设计原则](01-multica-openspec-design-guideline.md)、[05 OpenSpec Schema](05-openspec-schema-implementation-design.md)、[09 统一 Engineer](09-unified-engineer-development-design.md) 维护；本文不另立第二套真源。

---

## 1. 核心结论

**`proposal.md` 的 `## Repository Scope` 在执行期是冻结的授权上限，不是"执行期可维护的清单"。** 把它改放到 `.openspec.yaml` 并不能解除冻结，只是在两个同等受约束的位置之间搬运，不产生收益，且额外引入被上游 schema 剥离、逐字基线比对和真源分裂三项成本。

执行期"实际修改了哪些仓库"已经有结构化落点，不需要新造：`Change` 顶层每仓一份的 `evidence-<repo_id>.json`（字段见 [change-development Skill](workspace-skills/change-development/SKILL.md)），以及 Issue metadata 的 `pr_prep` 候选集。

---

## 2. 核查证据

### 2.1 唯一机器可读来源就在 proposal.md

`tools/rondo/src/commands/dev/requirement-guard.ts:58`：

```ts
/** The sole machine-readable scope is a list of repo_id under Proposal's Repository Scope. */
export function parseRepositoryScope(proposal: string): string[] {
```

解析规则（`requirement-guard.ts:59-73`）：

- 必须存在 `## Repository Scope` 章节；
- 章节内每一行只允许 `- repo_id: <id>` 或 `- <id>` 形式；
- 任何说明性文字、缩进子项都会直接抛 `Repository Scope 必须逐行列出唯一 repo_id: ...`；
- 不允许重复、不允许为空。

范围被用于三处授权判定：

| 位置 | 判定 |
| --- | --- |
| `requirement-guard.ts:97-102` | 逐个 repo_id 必须在 `docs/config/repo-context.yaml` 注册表中存在，否则 `批准的 Repository Scope 在 Registry 中不存在` |
| `requirement-guard.ts:108` | 目标仓必须在范围内，否则 `repo_id X 超出批准的 Repository Scope` |
| `dev/change-completion.ts:63` | PR Candidate 的 `repo_key` 必须落在范围内，否则 `PR Candidate 的 repo_key 不在批准 Repository Scope` |

### 2.2 执行期 proposal.md 被基线逐字比对，不可改

`tools/rondo/src/commands/dev/change-completion.ts:107-118`：

```ts
const approvedFiles = contractFiles(approvedList, prefix);
const currentFiles  = contractFiles(currentList, prefix);
if (JSON.stringify(approvedFiles) !== JSON.stringify(currentFiles))
  throw new FailError("当前 Change 契约文件清单与获批准版本不一致");
for (const file of approvedFiles) {
  // Engineers can refine *non-material* design, not Proposal, Specs or task wording.
  if (file === "design.md") continue;
  ...
  if (normalizeContractText(file, before) !== normalizeContractText(file, after))
    throw new FailError("Change 契约实质内容已变化，须重新 Human Review: " + file);
}
```

即：**已批准 commit 与研发发布 commit 之间的 proposal.md / tasks.md / specs 必须逐字一致，只有 `design.md` 豁免。** Engineer 在执行期修改 proposal.md 会直接导致 `rondo dev check-change` 与 `rondo pr materialize` 失败。

`.openspec.yaml` 在归档路径上受同一约束（`tools/rondo/src/commands/delivery/remote-artifacts.ts:146-149`）：

```ts
const approvedSchema = await reader.read(source.commit, `${live}/.openspec.yaml`);
if (normalizeContractText(".openspec.yaml", approvedSchema) !== normalizeContractText(".openspec.yaml", await reader.read(commit, `${prefix}/.openspec.yaml`)))
  throw new FailError("最新/归档 Schema 偏离批准基线");
```

**两个候选位置在"执行期能否改"这一点上完全等价，都冻结。** 迁移不改变语义。

### 2.3 执行期的真实仓库范围已有结构化载体

`projects/multica/workspace-skills/change-development/SKILL.md`：

> 每个实际修改的仓库在 Change 顶层保存一份 `evidence-<repo_id>.json`，字段与 `rondo dev check-change` 契约一致

```json
{
  "change_ref": "<change_ref>",
  "repo_key": "<repo_id>",
  "candidate_commit": "<full SHA>",
  "commits": [{"repo_key": "<repo_id>", "repo_url": "<Registry repo_url>", "sha": "<full SHA>"}],
  "local_validation": {"result": "PASS", "summary": "..."},
  "code_review": {"result": "PASS", "summary": "...", "findings": []},
  "blockers": []
}
```

`change-completion.ts:129-135` 从 Change 目录收集 `evidence*.json`，校验 `repo_key` 身份唯一且 `change_ref` 一致，再交给 `validateChangeDelivery` 做"候选 ⊆ 批准范围"的判定。

**结论：授权上限（proposal.md）与实际触及范围（evidence-<repo_id>.json）是两个不同的事实，本来就分属两个载体，不需要合并。**

### 2.4 范围扩大必须由 Human 决定（Bug 流程的同规则先例）

`tools/rondo/src/commands/bug/prepare-pr.ts:191-193`：

```ts
if (persisted && JSON.stringify(requiredBugRepos(persisted)) !== JSON.stringify(required))
  throw new FailError("Bug Repository Scope 已固定，扩大或收缩范围需要 Human 决定");
```

Bug 流程把范围固化在 Issue metadata `bug.required_repos`（JSON 数组，`tools/rondo/src/commands/bug/scope.ts:39`），是"范围用结构化数据承载"的既有先例；但它同样**不允许执行期自行扩大**。Requirement 流程的等价约束是"停在原地重新审批"，而不是执行期改写。

### 2.5 `.openspec.yaml` 不适合承载授权语义

| 维度 | 核查结果 |
| --- | --- |
| 上游 schema | `@fission-ai/openspec@1.13.2` 的 `ChangeMetadataSchema`（`dist/core/change-metadata/schema.js`）是 `z.object({schema, created?, goal?, affected_areas?, initiative?, skip_specs?, retire_capabilities?})`，**非 strict**：未知键被 zod 静默 strip |
| 写回行为 | `writeChangeMetadata`（`dist/utils/change-metadata.js:44`）写的是 `yaml.stringify(parseResult.data)`——被 strip 掉的自定义字段在重写时彻底消失 |
| 可用字段语义 | 唯一容得下数组的 `affected_areas` 是"影响领域"，与"**授权修改上限**"语义错位：区域可被描述，上限是许可 |
| 读取路径 | `tools/rondo/src/commands/analysis/change-schema.ts:42-56` 的 `parseChangeSchema` 只取顶层 `schema:` 字段，且要求唯一——新增业务字段不会被现有解析器消费 |
| 冻结性 | 归档路径逐字比对基线（见 2.2），与 proposal.md 同等冻结 |
| 审批绑定 | Human 审核的载体是 proposal.md 文本；范围移走会造成"人审的"与"机器认的"分裂 |

### 2.6 改造成本落在已发布包上

解析函数位于全局安装的 `@winning/rondo@1.2.27` 的 `dist/commands/dev/requirement-guard.js`，不是本仓源码。改变真源意味着：

1. 修改 `tools/rondo/src/commands/dev/requirement-guard.ts` 并发版；
2. 全局重新安装（执行期运行环境即依赖此包，见 `openspec/changes/knowledge-query-experience-266607/logs/repository-scope-compatibility.json` 记录的 `parser.version`）；
3. 同步 `openspec/schemas/intentional-change/schema.yaml` 与 `corrective-change/schema.yaml` 的 Instruction 与模板；
4. 同步 `projects/multica/workspace-skills/spec-preparation` 与 `change-development` 的 Skill 文本；
5. 调整归档基线比对逻辑。

第 2 项决定了它**无法在当前 LEI-40 执行窗口内生效**。

---

## 3. 可选路径

| 方案 | 内容 | 代价 | 风险 |
| --- | --- | --- | --- |
| **A 维持现状** | proposal.md 保持唯一授权上限；执行期实际范围用已有 `evidence-<repo_id>.json` 承载；文字说明留在 proposal.md 的独立说明章节 | 零改造 | 无新增。格式纪律依赖 Skill 文本与模板约束 |
| **B 增加派生 scope.json** | Change 目录新增 `scope.json` 作为**由 proposal.md 派生的只读镜像**，供工具便捷读取 | 需在 rondo 增加生成命令 + 发版 | 双载体需保证一致；不参与基线比对（`contract-files.ts` 只认 proposal/tasks/design/specs），若被误当真源会出现两套范围 |
| **C 换唯一真源到 Issue metadata** | 复刻 `bug.required_repos` 模式，读写 `requirement.required_repos`；proposal.md 该章节降级为展示 | rondo 发版 + 全局安装 + schema Instruction/模板改写 + Skill 同步 + 归档基线逻辑调整 | 审批载体与机器真源分裂；Human 审核的 proposal.md 不再是机器认的那份 |

### 3.1 方案 A 的既有佐证

LEI-40 本身已按 A 执行过一次修复（提交 `e0fc3a19`）：原 `## Repository Scope` 章节把说明文字放在 `- repo_id:` 的缩进子项下，`parseRepositoryScope` 直接拒绝；修复方式是把说明整体移到独立的 `## 仓库修改说明` 章节，只保留严格的两行 `repo_id`。核查证据见 `openspec/changes/knowledge-query-experience-266607/logs/repository-scope-compatibility.json` 与 `logs/verify-repository-scope.mjs`。

这说明 A 的实际痛点是**章节内的书写格式纪律**，而不是"缺少结构化载体"。

### 3.2 若后续决定走 B 或 C

- 需先确认该方案的优先级是否高于 [08-B 专题](08b-requirement-root-branch-and-publish-plan.md) 中"待实施"的根仓分支修复，避免两条变更线同时改动同一发布链路。
- B 与 C 都以 rondo 发版为前置条件，执行期窗口内不可用。
- 任何范围真源变更都需同步更新 `openspec/schemas/*/schema.yaml` 的 Instruction，否则后续 Agent 仍按旧格式生成 proposal.md。

---

## 4. 待决项

| 编号 | 待决问题 | 建议 |
| --- | --- | --- |
| D-1 | 是否接受 A（维持现状） | 建议接受。执行期仓库范围已有结构化载体，授权语义与实际范围本就应分离 |
| D-2 | 是否把"Repository Scope 章节只允许 `repo_id` 行"写成模板硬约束（当前依赖 Skill 文本约定） | 若接受 A，建议加强：在两个 Schema 的 proposal Instruction 中明确禁止在章节内写说明文字 |
| D-3 | 是否需要额外提供"执行期实际范围"的汇总视图 | 可选。当前可由 Change 目录的 `evidence-*.json` 文件名直接读出，无需新增聚合文件 |

---

## 5. 参考

- `tools/rondo/src/commands/dev/requirement-guard.ts` — `parseRepositoryScope`、`approvedChange`、`guardRepository`
- `tools/rondo/src/commands/dev/change-completion.ts` — 契约基线比对、`validateChangeDelivery`
- `tools/rondo/src/commands/delivery/remote-artifacts.ts` — `.openspec.yaml` 归档基线比对
- `tools/rondo/src/commands/delivery/contract-files.ts` — 契约文件清单与哈希
- `tools/rondo/src/commands/bug/prepare-pr.ts`、`tools/rondo/src/commands/bug/scope.ts` — Bug 流程 `required_repos` 先例
- `projects/multica/workspace-skills/change-development/SKILL.md` — `evidence-<repo_id>.json` 契约
- `projects/multica/workspace-skills/spec-preparation/SKILL.md` — Proposal 侧的 Repository Scope 生成约定
- `openspec/schemas/intentional-change/schema.yaml`、`openspec/schemas/corrective-change/schema.yaml` — Proposal Instruction
- `openspec/changes/knowledge-query-experience-266607/logs/repository-scope-compatibility.json` — 真实解析器验证记录
