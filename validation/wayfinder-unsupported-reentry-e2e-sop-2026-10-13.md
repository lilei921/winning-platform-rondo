# Wayfinder `unsupported (closed)` 显式重新准入 E2E 验证

> 日期：2026-10-13
> 目标版本：Multica CLI 0.6.1（已知隔离 POC 版本；正式环境以安装版本为准）
> 验证状态：**NOT_RUN — 未执行**。本文是测试步骤，不是 PASS 记录。
> 范围：仅验证 closed Issue 的真实 Human Mention 能否触发 Wayfinder，以及 `eligible` 后是否能唯一交接给 Squad；不访问真实 TFS / Repository，不改动生产 Issue。

## 1. 前提与隔离对象

- 使用隔离 Workspace，Runtime / Daemon 在线；Wayfinder Agent、Delivery Squad 与 Leader 已可唯一解析。
- 读取自定义 Status Key `unsupported` 并确认 Category=`closed`；不能仅看 Display Name。
- 准备一条使用虚拟 TFS 身份、明确无业务副作用的测试 Delivery Issue，Assignee=Wayfinder；初始有效顶层 `/note` Decision 为 `unsupported`，包含明确排除依据、来源 `tfs.changed_at` 和 Comment ID，并回读确认。
- 将 Issue 设置为 `unsupported`；确认当前没有活跃 Wayfinder / Lead Run。记录 Issue ID、Owner、Status、revision、原 Comment ID 与 Run 列表。
- 设计一项可证实的虚拟条件变化（例如隔离环境中的模拟授权已确认），供 Human 评论说明恢复原因；不得虚构真实业务权限。

## 2. 正向 E2E 步骤

| 步骤 | 操作 | 必须回读的结果 |
|---|---|---|
| U01 | 在 `unsupported (closed) + Wayfinder` Issue 中，由 Human 在 UI 选择真实 `@Wayfinder` Mention，写明补充证据、变更理由和显式重新准入请求 | Human Comment ID / Mention 目标正确；Issue 不因发布评论自动变为 `todo` |
| U02 | 检查原生 Comment Trigger 是否创建 Wayfinder Run | 有且只有当前请求对应的 Wayfinder Run；如 closed Issue 不能评论、不能 Mention 或没有 Run，记录实际返回并直接判定该路径 **FAIL / BLOCKED** |
| U03 | Wayfinder 核对来源版本、有效旧 Decision 与恢复授权，仅增量探索模拟变化 | 新的 `eligible` 具有可追溯证据；不把旧 `unsupported` 当成永久事实 |
| U04 | Wayfinder 在 U01 的 Human Comment 线程发布 `/note` 回复，并回读 | Reply `parent_id` 指向 U01，包含 `decision=eligible`、`supersedes` 旧 Decision、`resume_ref` 指向 U01，检索顶层及回复可定位当前有效 Decision；`/note` 不额外唤醒 Agent |
| U05 | 按已验证的唯一交接动作执行 `issue update --status todo --assignee-id <Squad UUID>`，不带 `--no-start` | 单次写入后 Issue 为 `todo + Squad`；原生 Assignment Trigger 创建唯一 Lead Run |
| U06 | 检查全部 Issue、Comment、Run 和来源状态 | 没有重复 Wayfinder/Lead Run 或第二次交接；原始虚拟 TFS 身份未被改写，交接后 Wayfinder 不再写交付事实 |

**关键判定**：U01–U06 全部有实际回读证据才记 `PASS`。如果 U02 在 closed 状态无法触发，不能以人工先改 `todo`、强制 `rerun` 或模拟 Run 代替原路径 PASS；先记录实际限制，再讨论是否需要调整原设计。

## 3. 失败与防重检查

- Human Mention 或 Comment 返回未知时先查 Comment / Run，禁止重复提交而制造第二次触发。
- 若 Wayfinder 无法核实恢复授权或 TFS 来源发生实质变化，应停止交接，保留原 Decision / 当前状态和失败原因。
- U04 写入结果未知时先核查顶层与回复线程的 Comment，不重复生成 Decision。
- U05 Update 返回超时或结果未知时，先回读 Owner / Status / revision / Lead Run，不直接补写第二次 Update。
- 若当前安装版本阻止从 Category=`closed` 回到 `todo`，记录明确报错及 Status 配置，不自行增设恢复状态机。

## 4. 执行记录（待填写）

| 字段 | 实际结果 |
|---|---|
| Workspace / Multica 版本 | NOT_RUN |
| Issue ID / 原始 `unsupported` Decision Comment ID | NOT_RUN |
| Human Mention Comment ID / Wayfinder Run ID | NOT_RUN |
| 恢复 `/note` Reply ID / `supersedes` / `resume_ref` | NOT_RUN |
| 单次 Update 前后 Owner / Status / revision | NOT_RUN |
| Lead Run ID 与重复运行检查 | NOT_RUN |
| U01–U06 总结 | **NOT_RUN** |

参考：[02 §4.1.1 准入与恢复契约](../02-multica-delivery-lifecycle-design.md#delivery-intake)、[WFP-8 blocked 恢复实测](wayfinder-needs-human-resume-single-update-e2e-2026-10-13.md)、[WFP-9 首次 todo 交接实测](wayfinder-first-todo-to-squad-2026-10-13.md)。

> 结论边界：现有 WFP-8 / WFP-9 结果不能替代 `unsupported (closed)` 恢复测试。完成本用例之前，03/02 的 `unsupported` 恢复属于设计意图和待验收 Runtime 边界，不得宣称已经通过。
