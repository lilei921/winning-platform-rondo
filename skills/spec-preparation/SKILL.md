---
name: spec-preparation
description: 使用项目 OpenSpec CLI 与当前 Schema / Artifact Instruction 安全新建、补全或定向修订 Change 工件；需要将已有专业结论准备为实现前工程契约时使用。
---

# spec-preparation

## When / Inputs

- 当前 Issue 的身份和授权、已确认的 Technical Change Kind 与当前 Change 的 Schema（首次准备时按项目契约确定并持久化）、可追溯专业结论、Evidence、已持久化的 `change_ref` 与来源 `tfs.id`（如有）。
- 针对 New / Prepare / Revise 的真实需求；无需修改工件时仅核实并返回当前有效状态。
- 本 Skill 的 `config/repo-registry.json` 由 `rondo workspace sync` 按目标 Workspace 渲染并发布。运行前必须确认此配置可读取且 `runtime.workspace_id` 与当前 Issue 所在 Workspace 一致；缺失或不匹配即停止，不借用其他 Skill 的配置或猜测路径。
- 使用当前常驻根仓中的项目级 OpenSpec Schema。

## Method（按需选择，不是固定流水线）

- **Inspect & Reuse**：定位当前 Change、已有 Artifact 与未满足的工程契约。已有可信结论、已完成工件和有效证据直接复用，不为走流程重建。
- **Create / Complete**：仅当 Resolver 返回 `NOT_FOUND` 且身份、Schema 和创建授权明确时新建 Change。已知可信数字型 `tfs.id` 时以 kebab-case 的 `<semantic-slug>-<tfs.id>` 命名，TFS ID 必须为末尾独立段；核对拟用 ID 后执行 `openspec new change <id> --schema <schema>`。对新建或已有 active Change，仅补齐实际需要的 Artifact。
- **Revise & Reconcile**：明确授权的返工仅修订受影响 Artifact；按实际变更检查相关上游/下游的 Requirement、Design、Tasks 和验证要求，保留仍然有效的内容。

## Invariants（依据本次操作适用）

- **Root / Change Identity**：确认 `root_repo` 在当前项目分支就绪；路径存在不等于准备成功，必要时使用 `workspace-preparation`，未就绪不得写入。执行 `rondo change resolve-identity --openspec-root <root> --change-ref <stable-id> --tfs-id <tfs.id> --expect-schema <schema>`，只传已知身份，两个身份已知时须同时提供。`ACTIVE_FOUND` 复用（旧引用失效时可依据 TFS ID 恢复并报告）；仅 `NOT_FOUND` 且获授权时可新建；`ARCHIVED_FOUND` / `CONFLICT` / `INVALID` / UNKNOWN 停止，不通过新建规避冲突。Change 已存在或 Issue 为 `in_progress` 不代表写入授权。
- **Root / Schema / Dependencies**：全部 `openspec` 命令显式使用已核实根仓作为 `cwd`，不依赖 Agent 当前目录。写入前检查 `openspec/changes/`、`openspec/schemas/<schema>/schema.yaml`，以 `openspec schema which <schema> --json` 确认 Schema 来自当前项目；`new change --json`、`status --json`、`instructions --json` 返回的 Root / Workspace 必须一致，遇到 `implicit`、错误来源或未知结果即停止。按当前 `apply.requires` 和各 Artifact `requires` 核对传递依赖，结合 Artifact State / Instruction / Template 处理合法省略；是否存在 Spec-level Delta 根据预期行为的实际变化判断；Conditional Design 和合法 `skip_specs` 依专业语义与原生状态判断，不自建 Artifact Graph 或额外标志。
- **Minimal Safe Write**：按照当前 Instruction / Template、已确认结论和真实依赖准备 Artifact。对 `specs/**/*.md` 确认具体 Capability 文件位于当前 Change 内；即使 `specs=done` 也核对 Proposal 要求的实际文件。只修改获授权内容，不将 Glob 当文件名、不覆盖无关有效工件；需要 Design 时先确定关键决策再定稿相关 Tasks，不需要时不生成空 Design。
- **Targeted Rework**：修改前核对来源反馈、受影响范围与当前批准边界。发现必须新增未授权业务选择，或实质改变已批准 Goal / Scope / Acceptance / Verification 时，停止越界写入并交调用者按既有 Lead / Human 接口处理；合法授权范围内的普通修订不逐文件重复询问。
- **Engineering Contract**：用当前 Schema 的 Instruction 和 Template 表达已经确认的专业结论。两类 Change 的 Repository Scope 均在 `.openspec.yaml` 顶层 `x-repositories` 维护，`repo_id` 从 `docs/config/repo-context.yaml` 选取。需要判断任务粒度或验证深度时，参考[工程任务写法](references/tasks-md-authoring-contract.md)。
- **Validation / Outcome**：完成前在同一根仓运行 `openspec validate <id> --type change --strict --no-interactive --json`，并回读 `openspec status --change <id> --json`。结合退出码、结构化结果和实际文件核对 Root、必要 Artifact、合法 skipped、Conditional Design 及相关内容一致性。FAIL / UNKNOWN / 来源不符时保留现场并报告，不宣称通过；CLI PASS 不能代替专业 Review、Analysis Gate 或 Human Approval。
- **CLI-only / Safe Recovery**：只用已授权的 CLI / Schema，不调用 `/opsx:*` 或 OpenSpec 原生 AI Skill/Command；无法安全满足委托则报告阻断，不自行绕过。创建结果未知时先以已知身份（两者均有则同时提供）回查 Change 和目录，写入结果未知时先回读 Artifact，确认缺失后才恢复，不能盲目重做。

## Optional Review Reference

- 对 Intentional 工件准备完成后的跨工件一致性校核，可按需参考 `references/contract-consistency-review.md`；专业语义与最终 `ai_review` 结论由调用者负责。Reference 是否被调用不作为 Gate。

## Output / Stop

- 返回当前唯一 `change_ref`、已核实根仓、实际新建或修订的**具体 Artifact 路径**、最新原生状态与 Validation 结果、合法省略依据、Evidence/未决事项；不创建平行 Preparation Result Markdown、Change Metadata Schema 或 Multica Stage。
- 只维护当前 OpenSpec Change 工件，不执行生产代码、Issue 审批/状态操作或 Archive / Commit / Push。
