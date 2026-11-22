---
name: spec-preparation
description: 使用项目 OpenSpec CLI 与当前 Schema / Artifact Instruction 安全新建、补全或定向修订 Change 工件；需要将已有专业结论准备为实现前工程契约时使用。
---

# spec-preparation

## When / Inputs

- 当前 Issue 的身份和授权、已确认的 Technical Change Kind 与当前 Change 的 Schema（首次准备时按项目契约确定并持久化）、可追溯专业结论、Evidence、已持久化的 `change_ref` 与来源 `tfs.id`（如有）。
- 针对 New / Prepare / Revise 的真实需求；无需修改工件时仅核实并返回当前有效状态。
- 本 Skill 的 `config/repo-registry.json` 由 `rondo workspace sync` 按目标 Workspace 渲染并发布。运行前必须确认此配置可读取且 `runtime.workspace_id` 与当前 Issue 所在 Workspace 一致；缺失或不匹配即停止，不借用其他 Skill 的配置或猜测路径。
- 本项目使用 OpenSpec `1.13.2` 与项目级 Schema；CLI / 运行根仓须由当次事实核实，不能使用用户级同名 Schema 或隐式 Root 代替。

## Method（按需选择，不是固定流水线）

- **Inspect & Reuse**：定位当前 Change、已有 Artifact 与未满足的工程契约。已有可信结论、已完成工件和有效证据直接复用，不为走流程重建。
- **Create / Complete**：仅当确定性 Resolver 返回 `NOT_FOUND` 且身份、Schema 与创建授权均已确认时新建唯一 Change。已知可信数字型 `tfs.id` 时，先根据变更语义生成 kebab-case 的 `semantic-slug`，再将 New ID 构造为 `<semantic-slug>-<tfs.id>`；TFS ID 必须作为末尾独立段，例如 `visual-query-sql-errors-264104`，不能写成 `tfs-264104-visual-query-sql-errors`。创建前核对拟用 ID 的 `-<tfs.id>` 后缀，再执行 `openspec new change <id> --schema <schema>`；`NOT_FOUND` 仅表示未找到已有 Change，不代表拟用名称合法。对于新建或已有 active Change，只根据当前依赖和专业条件补齐实际必需的文件。
- **Revise & Reconcile**：明确授权的返工仅修订受影响 Artifact；按实际变更检查相关上游/下游的 Requirement、Design、Tasks 和验证要求，保留仍然有效的内容。

这些是条件性方法，不是 New → Prepare → Revise 的必经顺序；真实的依赖、写入授权和 Validation 不能省略。

## Invariants（依据本次操作适用）

- **Root / Change Identity**：使用 Multica 原生 checkout 返回的实际根仓路径；已有检出直接复用，尚未检出时在当前 Task workdir 执行 `multica repo checkout <已登记根仓 URL>`，沿用资源 ref。后续命令显式传入同一路径，目录及所需文件不可用时停止受影响操作。通过 `rondo change resolve-identity --openspec-root <root> --change-ref <stable-id> --tfs-id <tfs.id> --expect-schema <schema>` 解析唯一 Change（只有一个身份时只传已知参数；**两个身份已知时同时传入**）。由 CLI 确定性拒绝冲突并校验稳定身份：`ACTIVE_FOUND` 复用，旧引用失效时可按 TFS ID 恢复并报告依据；`NOT_FOUND` 且身份、Schema 和创建授权明确时才允许 New；`ARCHIVED_FOUND` / `CONFLICT` / `INVALID` / UNKNOWN 停止，不以创建新 Change 掩盖异常。Change 存在或 Issue 为 `in_progress` 不自动构成写入授权。
- **Root / Schema / Dependencies**：所有 `openspec` 命令均在上面核实的**根仓工作目录**执行，命令执行器必须显式设置该 `cwd`，不能沿用 Agent 的任意工作目录；写入前确认存在当前根仓的 `openspec/changes/` 与 `openspec/schemas/<schema>/schema.yaml`，用 `openspec schema which <schema> --json` 核实 Schema 来源为当前项目。`new change --json`、`status --json`、`instructions --json` 的 Root 信息须与已解析根仓一致，若 Root 为 `implicit`、解析为其他 Workspace/Store 或结果未知则停止，不能继续写入。读取当前 Artifact State / Instruction，从 `apply.requires` 沿各 Artifact `requires` 确认**传递依赖闭包**；独立判断 Conditional Design 的适用性，并按原生状态/行为依据处理合法 `skip_specs`，不自建第二份 Artifact Graph 或 `design_required` / `skip_design`。
- **Minimal Safe Write**：依据当前返回的 Instruction / Template、已确认专业结论和实际内容依赖准备工件。对 `specs/**/*.md` 等 Glob 要确定**具体 Capability 路径**并核实位于当前 Change 内；即使 `specs=done` 也核对 Proposal 声明的全部应有文件。只补缺失文件或修改获授权内容；不将 Glob 写成文件名、不重写无关有效文件。满足 Design 条件时先处理其关键决策再定稿受影响 Tasks；否则不制造空 Design。
- **Targeted Rework**：修改前核对来源反馈、受影响范围与当前批准边界。发现必须新增未授权业务选择，或实质改变已批准 Goal / Scope / Acceptance / Verification 时，停止越界写入并交调用者按既有 Lead / Human 接口处理；合法授权范围内的普通修订不逐文件重复询问。
- **Engineering Contract**：Corrective 消费有依据的 Expected / Actual、Root Cause 可信度、Fix Strategy、Regression Scope；Intentional 消费 Goal / Rules / Scenario / Scope 和必要方案决定。每个 Implementation Task 有可执行的验证方式，仅组合行为需要时设 Change-level Verification Task。Tasks 写法以 `references/tasks-md-authoring-contract.md` 为当前唯一规范来源；工程拆分、依赖与验证要求不受 TFS 工时/6h 管理规则约束，不为 TFS 增加预估尾注。
- **Validation / Outcome**：声明准备完成前在同一根仓运行 `openspec validate <id> --type change --strict --no-interactive --json` 并重新运行 `openspec status --change <id> --json`；核对退出码、结构化结果、Root、必要 Artifact、Glob 实际文件集合、合法 skipped、Conditional Design 与受影响工件一致性。FAIL / UNKNOWN、Root 不符或结果不可解释时保留有效产物并报告缺口，不宣称通过。OpenSpec Validation PASS 不等于专业 Review、Analysis Gate 或 Human Approval PASS。
- **CLI-only / Safe Recovery**：不调用 `/opsx:*` 或 OpenSpec 原生 AI Skill/Command。若当前指令要求无法通过已授权的 CLI / Schema 方法安全完成的委托，报告不支持的依赖，不自行绕过。创建命令超时或结果未知时先以**双身份**重新查询 Change 和实际目录，不能立即重复 New；已有 Artifact 的写入结果未知时先回读现状，只补确实缺少的内容。

## Optional Review Reference

- 对 Intentional 工件准备完成后的跨工件一致性校核，可按需参考 `references/contract-consistency-review.md`；专业语义与最终 `ai_review` 结论由调用者负责。Reference 是否被调用不作为 Gate。

## Output / Stop

- 返回当前唯一 `change_ref`、已核实根仓、实际新建或修订的**具体 Artifact 路径**、最新原生状态与 Validation 结果、合法省略依据、Evidence/未决事项；不创建平行 Preparation Result Markdown、Change Metadata Schema 或 Multica Stage。
- 只维护当前 OpenSpec Change 工件，不执行生产代码、Issue 审批/状态操作或 Archive / Commit / Push。
