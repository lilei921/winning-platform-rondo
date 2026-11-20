# Analysis Gate 检查清单

> 此文件位于 retired Skill 的历史目录，供代码检查清单引用；当前执行入口为 analysis-completion，不能恢复 workitem-analysis 派发。
> 事实源：`tools/rondo/src/commands/analysis/validate.ts`；修改检查项时同步本文件。

命令：`rondo analysis validate --issue <issue> --openspec-root <根仓> --workspace-id <id> --registry-config <config> --out openspec/changes/<change_ref>/logs/analysis-gate-result.json`

- stdout 为纯 JSON，包含 `result/checks/reasons`；PASS 还绑定工具版本、Issue、Workspace、Change、change_kind、Schema、工件摘要及 metadata 摘要。
- 退出码：0=PASS，2=FAIL，3=UNKNOWN，64=参数错误；UNKNOWN 优先于 FAIL，二者均不可放行。
- `--out` 只允许当前 Change 的固定日志路径，由根仓解析，不依赖 cwd。Complete 必须核对实际文件，不能伪造 PASS。

## 检查项（8 项）

| 检查名 | 通过条件 |
| --- | --- |
| `identity` | `tfs.id` 有值、`tfs.type` 支持；`analysis.change_kind` 为 corrective/intentional 并与 Schema 一致；Bug 不得采用 intentional-change |
| `change` | `analysis.change_ref` 是合法稳定身份，目录存在，`.openspec.yaml` 为 corrective-change 或 intentional-change |
| `acceptance_contract` | Corrective 的 proposal 包含 Expected Behavior、Root Cause、Fix Strategy、Regression Scope；Intentional 包含 Requirement/Scenario Delta Specs。Intentional 缺 Specs 只在原生 OpenSpec status 返回同根仓、同 Change、同 Schema 的 specs=skipped 时允许 |
| `tasks` | tasks.md 有 checkbox 任务和 Verification/验证内容 |
| `task_estimates` | 每个编号任务行末有 `[预估: Nh]`，0<N≤6；tfs.type=Bug 跳过 |
| `verify_recommendation` | recommendation 为 required/not_required；reason 非空；focus_refs 为非空字符串的 JSON 数组。该专业建议不代替 Human 最终执行决定 |
| `ai_review` | Intentional 必须 APPROVED 且 findings_ref 非空；Corrective 跳过 |
| `openspec_validate` | 在指定 OpenSpec 根执行 `openspec validate <change_ref> --strict` 成功；CLI 不可用为 UNKNOWN。skip_specs 必须满足原生 Schema 契约，不绕过校验 |

## 失败与恢复

- FAIL：按 reasons 修 facts（经 analysis stage）或工程工件后重跑 Gate；不得直接写 metadata 绕过检查。
- UNKNOWN：环境错误只作有界重试；身份或证据不能确认时交 Delivery Lead，不把未知当批准。
- Gate 后修改被审核工程工件、Review Evidence 或 Facts，须重新 stage/validate；只补约定 Handoff 顶层 gate 字段不使结果失效。
