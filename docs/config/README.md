# Project Resource 配置

Multica 当前 Project Resource 是仓库配置和业务归属线索的来源。当前可用仓库、初始版本、PR Target 及业务线索分别由 `resource_ref.url`、`resource_ref.ref`、`resource_ref.default_branch_hint`、顶层 `label` 表达。

- [project-resources.yaml](./project-resources.yaml)：供资源配置准备和 label 对齐参考，不是 Agent 或 Rondo CLI 的运行时仓库映射。
- [project-resources.yaml.example](./project-resources.yaml.example)：配置参考示例。

Agent 按需使用当前 Project 的原生上下文或 `multica project resource list <project-id> --output json`。业务仓标识为 URL 中解码后的完整仓库名称，实际工程行为以源码为准。已批准的 Requirement Repository Scope 由 OpenSpec `x-repositories` 保存。

Workspace 和 TFS 资源供给配置仍由各自配置维护。
