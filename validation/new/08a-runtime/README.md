# 08-A 真实 Runtime 与隔离 Bug E2E（2026-11-14）

本轮已修复 Python Registry 的两项 schema 断言，并完成一个隔离 Bug 的真实 Wayfinder → Bug Fix → PR 合并 → Codex 中断 → Claude 恢复 → Done。**这证明本轮隔离交付链闭环，不代表 08-A 所有验收项或生产切换通过。08-B 继续暂缓。**

后续 TT-9 已按用户批准修复 rondo-tt 的 remote-ripgrep 限定授权，并由 Bug Fix Agent 完成三个 remote MCP 的真实主路径调用及隔离回归，见[补充验收](remote-mcp-followup.md)。

## 授权、范围与改动

用户指定 Multica desktop、workspace `rondo-tt`、TT-5，要求隔离验收；随后允许测试 Commit / Push / PR 按正常流程，并明确批准隔离 PR 3786 合并及继续验收。根工作区 08-A 实现未提交、未推送、未全局安装或发布。

- Registry 通用清单的 `repo_url` 改为 optional，与已有可选字段实现一致；`.example` 中 17 个未配置远端的登记仓不猜填地址。`dev prepare` 仍强制要求合法 URL。YAML、schema 测试及配置说明同步修正。
- 修复真实 TFS 2018 `web/wi.aspx?pcguid=…&id=…` 来源链接兼容：仅请求配置 Collection 的 Work Item API，核对返回 Bug 身份及权威 HTML 链接，不向来源 URL 发送凭据。
- 实测 Desktop 0.9.0 仅下发 Resource 清单，不能视为 Task checkout 完成。首次缺仓时使用 Task 内的平台原生 `multica repo checkout`；已有目录只校验，不自行 clone、Bootstrap 或使用 `--fresh`。执行资产和 08 文档按此事实修正。
- 恢复测试驱动与故障注入脚本在本目录；故障只发生于固定 TT-6 的子进程边界，不伪造外部成功、PR 状态或最终 Metadata。

## 本地验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Python Registry | 26 PASS / 0 FAIL，两项 schema 失败已消除 | [日志](../08a-local-validation/python-registry-fixed.log) |
| TypeScript build | PASS | 当前本机构建 1.2.23 |
| 本轮定向 Node 回归 | 24 PASS / 0 FAIL：08-A 基础、Bug prepare-pr、分析 Skill | [日志](../08a-local-validation/runtime-followup-node.log) |
| 隔离 Bug 修复 | 原回归先失败后通过；新增 12 项用例由 7 PASS / 5 FAIL 变为 12 PASS | [开发侧记录](bug-fix-validation.md)；控制端另行阅读完整两文件差异并复跑通过 |
| Skill / 格式 | quick_validate、git diff --check 通过 | 未用本地检查替代 Runtime 验收 |

首轮完整回归 414 PASS / 3 SKIP / 0 FAIL 保留在[历史实施记录](../08a-implementation-2026-11-14.md)，不与本轮定向测试累加。

## 对象与真实执行

工作区 `3158546f-5b79-4042-baec-20cdac7d9d31`；Desktop Daemon 0.9.0，同一 Windows 机器 `lileipc`。本轮没有跨机器证据。

| 对象 | 实际结果 |
| --- | --- |
| TT-5 / 生产 Bug 264839 | 只读 Runtime 采证。原生 checkout 请求超时，根仓缺失时 check-checkout 正确拒绝；Wayfinder 置 blocked，未交接生产修复。CodeGraph / filesystem 成功，ripgrep 被审批策略拒绝 |
| TT-6 / 隔离 Bug 265022 | 手动 backlog → todo，Wayfinder 有效 eligible `/note` 回读后由 handoff 产生唯一 Bug Fix Run；不是预置 Gate |
| Wayfinder Run | `01a1d944-159f-7e27-bf23-d8df686edf44`，Codex；原生 checkout 与身份校验 PASS；镜像无新 fixture 时读取固定测试 commit 的 TFS API |
| Bug Fix Run | `01a1d948-a673-7784-8153-87fd10f2637f`，Codex；实际 dev prepare 首次 changed=true、重入 false；修复、测试、受控 fetch/push、prepare-pr、materialize 均 PASS |
| 测试 PR | [3786](http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/WiNEX%20DataFactory/_git/winning-dps-df-frame/pullrequest/3786?_a=overview)，`feat/265022 → codex/08a-acceptance-20261114`；用户批准后 completed |
| TT-7 / Codex PR Status Sync | Run `01a1d957-152e-7217-8b94-42a7edcb2c9e`，无 Project / 根仓，10/10 断言 PASS |
| TT-8 / Claude PR Status Sync | Run `01a1d959-f95f-72c6-8334-f1b3528b27e9`，不同 Runtime、独立目录、无 Project / 根仓，20/20 断言 PASS |
| TT-9 / Bug Fix MCP 补充验收 | 新 Run `01a1d96f-6a40-7709-b4ee-7455a7a2ea95`，三 MCP 共 7 次成功调用，隔离 fixture 12 PASS 及原回归 PASS；保留前一失败 Run 作对照 |

测试基线 `7e01dea45a4c7ed28a3c27653321780b2e4186d6`；修复候选 `977f1d853947e32c5fa7aba43838b0574c06c54c`；合并 `4c6ae108d065433a5a4bd38a6b3d29510bfa4d88`。全部仅位于 frame 的隔离分支；`dev` 前后均为 `0a2857e17d2a146a6c0b5440a993a3acfc9b9473`。

PR Status Sync 并发始终为 1。Codex Run 结束后临时切换 Claude，Claude Run 结束后已恢复原 Codex / `gpt-6-luna` 绑定，见[配置回读](pr-sync-agent-restored.json)。未触发正式 Autopilot，不能据此宣称定时触发部署已验收。

## 故障与恢复证据

- 合并前控制端 Prepare 返回 FAIL，原因是 PR active；无提前完成事实。
- TT-7 真实 reconcile-status 返回 finalize，Prepare 返回 prepared、route_archive=skipped。Writeback 前调用 Complete 返回 UNKNOWN，拒绝 Done。
- TFS 评论写成功后、`delivery.tfs_written` 保存前，子进程直接退出 86。快照确认评论 1 条、Bug 已解决、标记缺失、Issue 未 Done。
- TT-8 首先读取此前成功副作用，在相同标记窗口注入保存失败；再次快照仍只有 1 条评论。正常恢复只补标记，TFS rev 始终为 7。
- Complete 真实发布摘要后，注入摘要 ID 保存失败；确认摘要 1 条、ID 缺失、Issue 未 Done。重试按内容复用摘要，完成 Done 并清 pending，ID 仍缺失但不阻塞；再次重放为 already=done，评论、摘要与 TFS rev 均不变。

证据：[Codex 10 项断言](codex-interrupt-evidence.json)、[Claude 20 项断言](claude-recover-evidence.json)、[独立 Issue 回读](final-issue.json)、[TFS / PR / 分支回读](external-readback.json)。

## 验收边界与剩余项

| 项目 | 本轮判定 |
| --- | --- |
| 隔离 Bug 正向 E2E | PASS，真实 Agent、Git、TFS PR、用户审核合并、跨 Runtime Writeback / Done |
| 08A-V01 | NOT_RUN（PARTIAL_EVIDENCE）：Bug 手动入口和唯一交接通过；Requirement 入口、恢复、来源变化及重复唤醒矩阵未补齐 |
| 08A-V02 | NOT_RUN（PARTIAL_EVIDENCE）：TT-6 Wayfinder / Bug Fix 身份校验与重入通过；TT-5 原生供应超时；dirty/unpushed 等全部负向尚未在真实 Runtime 重验 |
| 08A-V03 | PARTIAL：后续 TT-9 Bug Fix 三 MCP 真实主路径 PASS，ripgrep 限定授权已生效；Wayfinder 在修正配置下尚未重验，见[补充验收](remote-mcp-followup.md) |
| 08A-V04 | NOT_RUN（PARTIAL_EVIDENCE）：真实首次 clone、复用、fetch、push、prepare-pr 已通过；越界、错误 origin、clone 中断等完整 Runtime 矩阵仍缺，本地测试不能替代 |
| 08A-V05 | NOT_RUN（PARTIAL_EVIDENCE）：隔离正向全链已闭环，active PR 与未 Writeback 拒绝已观察；candidate 漂移拒绝和重复 PR 物化的真实 Runtime 子项未补齐 |
| 08A-V06 | PASS：真实评论成功后的进程中断、标记保存失败、另一 Runtime 读取并恢复，评论计数不变 |
| 08A-V07 | FAIL：MCP 权限矩阵未完成；另发现 Claude 诊断批量输出环境变量，Task token 进入平台运行日志。本地副本已脱敏，正式证据不含 token；未删除/改写平台日志，不宣称日志已修复或凭据已轮换 |
| 08A-V08 | NOT_RUN：本轮手动入口，不替代目标态 TFS Sync 自动首次准入 |
| 08-F02 | NOT_RUN（PARTIAL_EVIDENCE）：Bug 摘要发布后 ID 保存失败的真实恢复 PASS；查询失败等完整 Runtime 子项及 Requirement 新回归未补齐 |
| 08-F03 | NOT_RUN：仅同机不同 Runtime，未独立机器接续 |

对 Task token 日志问题，已补充 finalize-delivery 的诊断约束：仅读取必要身份字段，不输出环境变量全集，认证值只检查存在性。此为本地修订，尚未发布并重验，不能关闭 V07。remote-ripgrep 原始拒绝为 `MCP tool call requires approval, but approval policy is never`；后续经用户明确批准，限定 rondo-tt 仅启用并自动批准 search，TT-9 Bug Fix 已真实重验通过，详见[补充验收](remote-mcp-followup.md)。V07 仍未关闭。

## 生产事实与收尾

本轮没有向生产 Bug 264839 写状态、评论或 Commit Link。最终回读发现它由 rev 8 / 已建议变为 rev 12 / 已解决；TFS 增量审计显示操作人为 `y.dx(袁东旭)`，并记录引擎版本说明，属于本轮期间的外部变更。详见[增量审计](production-drift-readback.json)。不能表述为生产状态保持不变，也没有回滚他人操作。

TT-5 保持 blocked 且无交付标记；TT-6 done，265022 已解决；TT-7 / TT-8 为验收 Runner。测试分支、工作项、PR 和原始现场保留供复核，没有清理他人的工作。08-B 未推进，根仓实现没有提交或推送。
