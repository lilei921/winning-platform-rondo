---
name: spec-preparation
description: 使用项目 OpenSpec CLI 与当前 Schema / Artifact Instruction 安全新建、补全或定向修订 Change 工件；需要将已有专业结论准备为实现前工程契约时使用。
---

# spec-preparation

## Inputs / Preconditions

- 当前 Issue 的身份、写入授权、已确认的 Technical Change Kind、当前 Change 的 Schema、可追溯专业结论与 Evidence，以及已知的 `change_ref`、`tfs.id`。首次准备时按项目契约确定并持久化 Schema。
- 本 Skill 的 `config/repo-registry.json` 由 `rondo workspace sync` 按 Workspace 发布；确认可读取且 `runtime.workspace_id` 与当前 Issue 所在 Workspace 一致，否则停止，不借用其他 Skill 配置或猜测路径。
- 写入前确认 `root_repo` 在当前项目分支真正就绪（路径存在不等于准备成功）；必要时使用 `native-workspace`。所有 `openspec` 命令均以已核实根仓为 `cwd`。

## Method（按需选择，不是固定流水线）

- **Inspect & Resolve**：查看当前 Change、Artifact 和未满足的契约，复用可信结论及有效工件。使用 `rondo change resolve-identity --openspec-root <root> [--change-ref <stable-id>] [--tfs-id <tfs.id>] [--expect-schema <schema>]`，仅传已知参数；两个身份已知时同时传入。`ACTIVE_FOUND` 复用（旧引用失效时可按 TFS ID 恢复并报告）；`ARCHIVED_FOUND` / `CONFLICT` / `INVALID` / UNKNOWN 停止，不新建规避冲突。
- **Create / Complete**：仅在 `NOT_FOUND` 且身份、Schema 与创建授权明确时新建。存在可信数字型 `tfs.id` 时，Change ID 使用 kebab-case `<semantic-slug>-<tfs.id>`，以 TFS ID 为末尾独立段；核对 ID 后执行 `openspec new change <id> --schema <schema>`。按当前 Artifact State 补齐实际需要的工件；无需修改时只返回有效状态。
- **Revise & Reconcile**：根据明确的返工反馈只修改受影响工件，检查相关上下游内容与验证要求，保留仍有效的结论；授权范围内的普通修订不逐文件重复确认。

## Artifact Contract & Safe Write

- **Schema 权威**：确认 `openspec/schemas/<schema>/schema.yaml` 属于当前根仓，并通过 `openspec schema which <schema> --json` 核实来源；以当前 `openspec status --change <id> --json`、`openspec instructions <artifact> --change <id> --json` 提供的 Artifact State、Instruction、Template 和依赖为准。核对 CLI 返回的可用来源信息；`implicit`、错误来源或未知结果不得用于写入。
- **实际依赖**：按当前 Artifact `requires` 准备工件；`apply.requires` 仅用于判断或报告 Apply Readiness，不作为工件写入前置。不自建 Artifact Graph。根据实际行为变化判断 Spec-level Delta；合法 `skip_specs`、Conditional Design 与其他省略以当前 Schema、专业语义和原生状态为准，不为填满文件清单制造 Artifact。
- **Repository Scope**：在当前 Change 的 `.openspec.yaml` 顶层维护 `x-repositories`，`repo_id` 从 `docs/config/repo-context.yaml` 选取；不在其他工件创建第二套授权范围。
- **最小写入**：使用当前 Instruction / Template 和已确认结论。`specs/**/*.md` 是生成模式而非文件名，需核对实际 Capability 文件；即使 `specs=done` 也应核对 Proposal 所要求的具体文件。只改获授权内容，不覆盖无关工件；需要技术决策时以必要 Design 支撑 Tasks，不需要时不生成空 Design。
- **Task 与验证方法**：按实际依赖和可验证结果组织任务；验证深度与变更风险匹配，优先复用足以证明行为的现有验证方式，必要或已批准要求时安排 E2E。具体任务格式与内容要求以当前 Artifact Instruction / Template 为准。
- **按需一致性核对**：修改后仅核对受影响 Artifact 的内容与依赖；发现专业结论、授权或关键决策冲突时报告调用方，不自行给出 Review Verdict 或新增 Gate。
- **授权边界**：Change 存在或 Issue 为 `in_progress` 不等于写入授权。返工若需要新增未授权业务选择，或实质改变已批准的 Goal / Scope / Acceptance / Verification，停止越界写入并返回调用方走既有 Lead / Human 决策；不自行批准。

## Validation / Recovery

- 完成前在同一根仓执行 `openspec validate <id> --type change --strict --no-interactive --json` 并回读 `openspec status --change <id> --json`；结合退出码、结构化结果、诊断信息和实际文件核对必要 Artifact、合法省略、内容一致性及来源。出现 `Archive would refuse this delta` 等归档冲突提示时核实并报告，不仅凭 CLI PASS 推断归档一定成功，也不将所有 INFO 自动视为阻断。FAIL / UNKNOWN 或来源不符时保留现场并报告；CLI PASS 不代替专业 Review、Analysis Gate 或 Human Approval。
- 创建结果未知时用已知身份回查 Change 和目录；写入结果未知时先回读实际 Artifact，确认缺失后才恢复，不能盲目重试。只用已授权 CLI / Schema，不调用 `/opsx:*` 或 OpenSpec 原生 AI Skill/Command。

## Output / Stop

- 返回唯一 `change_ref`、已核实根仓、实际新增或修订的具体 Artifact 路径、原生状态、Validation 结果、合法省略依据、Evidence 引用与未决事项；不另建 Preparation Result、Metadata Schema 或 Multica Stage。
- 本 Skill 仅准备当前 OpenSpec Change 工件，不执行生产代码修改、Issue 审批/状态变更、Archive、Commit 或 Push。
