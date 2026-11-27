---
name: spec-preparation
description: 使用项目 OpenSpec CLI 与当前 Schema / Artifact Instruction 安全新建、补全或定向修订 Change 工件；需要将已有专业结论准备为实现前工程契约时使用。
---

# spec-preparation

## Inputs / Preconditions

- 已明确存在需要实施的工程增量，当前 Issue 身份、写入授权、变更性质及专业结论与必要 Evidence 已明确；复用已知的 `change_ref`、`tfs.id`。首次准备时按已确认的变更性质选择 Schema：恢复既定行为使用 `corrective-change`，改变预期行为使用 `intentional-change`。
- 根仓 `root_repo` 已基于适用工程版本准备就绪；所有 `openspec` 命令以该根仓为 `cwd`。

## Method（按需选择，可往返）

- **Inspect & Resolve**：复用已确认的 Change 身份和有效工件；需要定位或核实身份时，使用 `rondo change resolve-identity --openspec-root <root> [--change-ref <stable-id>] [--tfs-id <tfs.id>] [--expect-schema <schema>]`，仅传已知参数，两个身份均已知时同时传入。命令返回 JSON。`ACTIVE_FOUND` 直接复用（旧引用失效时可按 TFS ID 恢复）；`NOT_FOUND` 按创建条件处理；`ARCHIVED_FOUND` / `CONFLICT` / `INVALID` 或结果未知时，停止相关写入并说明实际问题。
- **Create / Complete**：仅在 `NOT_FOUND` 且身份、Schema 和创建授权明确时新建。使用 kebab-case `<semantic-slug>-<tfs.id>`（TFS ID 为末尾独立段），执行 `openspec new change <id> --schema <schema>`。按当前 Artifact State 补齐实际需要的工件。
- **Revise & Reconcile**：根据明确反馈修订受影响工件及关联契约，复用仍有效的结论，不重做完整分析或逐文件重复确认授权。

## Artifact Contract & Safe Write

- **Schema / Artifact 权威**：使用当前根仓的 `openspec/schemas/<schema>/schema.yaml` 及 OpenSpec 原生 Artifact State、Instruction、Template、依赖。已有可信来源和状态直接复用；按实际需要使用以下命令获取或核实信息，不要求依次执行：

  ```bash
  openspec schema which <schema> --json
  openspec status --change <id> --json
  openspec instructions <artifact> --change <id> --json
  ```

  来源为 `implicit`、错误或无法确认时，不据此写入。
- **工件准备**：按当前 Artifact Instruction / Template 与原生 `requires` 准备工件；`apply.requires` 用于判断 Apply Readiness，不是工件写入前置。合法 `skip_specs`、Conditional Design 等取决于当前 Schema、专业语义及原生状态。`specs/**/*.md` 是生成模式而非文件名；有 Delta 时核对实际需要的 Capability 文件。任务内容、格式及验证方法遵循当前 Artifact Instruction / Template，验证深度与变更风险匹配。
- **Repository Scope**：根据已确认的工程影响范围，在当前 Change 的 `.openspec.yaml` 顶层维护非空、去重的业务仓完整 Git/TFS 仓库名称列表。

  ```yaml
  x-repositories:
    - winning-dps-df-dataintegration
  ```
- **授权与一致性**：只修改获授权内容，按需核对受影响工件及依赖。Change 存在或 Issue 为 `in_progress` 不等于写入授权；涉及新的业务选择或实质改变已批准 Goal / Scope / Acceptance / Verification 时，说明待决定事项，不越权写入或自行批准。

## Diagnosis / Recovery

按需核实实际工件、原生状态及来源，针对具体问题修订；无法解决时报告实际阻断。创建或写入结果不明时先回查身份或工件，确认实际状态后恢复。

## Output

返回当前唯一 Change ID、实际工件及必要的 Evidence、省略依据与未决事项。

## Boundaries

仅准备当前 OpenSpec Change 工件，不执行生产代码修改、Issue 状态变更、审批、Archive、Commit 或 Push。
