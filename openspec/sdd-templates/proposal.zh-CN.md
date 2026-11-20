# Proposal（提案）

## Why（为什么）

<!-- 说明本次变更的动机。它解决什么问题？为什么现在需要做？ -->

## What Changes（变更内容）

<!-- 描述将发生哪些变化。明确说明新增能力、修改内容或移除内容。 -->

## Capabilities（能力）

### New Capabilities（新增能力）
<!-- 本次引入的能力。对新引入的路径段使用 kebab-case，
     例如 user-auth 或 identity/user-auth，并遵循项目现有的 spec 组织方式。
     每项能力都会创建 specs/<capability-path>/spec.md。 -->
- `<capability-path>`: <该能力覆盖内容的简要说明>

### Modified Capabilities（修改能力）
<!-- REQUIREMENTS 发生变化的现有能力，而不仅仅是实现变化。
     仅当 spec 层面的行为发生变化时才在这里列出。每项都需要一个 delta spec 文件。
     使用 openspec/specs/ 下现有能力的准确路径。如果没有 requirement 变化，则留空。
     如果一个 change 完全没有 capability（纯重构、工具或文档变更），必须在
     .openspec.yaml 中设置 `skip_specs: true`；否则 openspec validate 会拒绝
     zero-delta change。不要为了通过校验而虚构 requirement。 -->
- `<existing-capability-path>`: <正在变化的 requirement>

## Impact（影响）

<!-- 受影响的代码、API、依赖和系统 -->
