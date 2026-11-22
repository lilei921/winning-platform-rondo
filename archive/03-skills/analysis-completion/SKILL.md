---
name: analysis-completion
description: 将已完成的 Analysis Package 通过 Analysis Gate 提交人工审核；分析准备就绪或定向返工完成后使用，负责 Facts 落账、当前 Change 的根仓提交推送、审核发布及状态确认。
---

# analysis-completion

## Preconditions / Inputs

- 当前 OpenSpec Change、专业分析结果与 draft Handoff Facts 已就绪。
- 默认配置：`config/repo-registry.json`（相对于本 Skill 目录）。
- Analysis 三步均传入 `--registry-config "<config-path>"`，读取配置中的工作区和 Multica 环境，禁止改用默认环境。
- 规范来源及固定版本读取遵循 `references/analysis-source-contract.md`；complete 的推送与远端固定版本核验使用现有 TFS 连接配置。
- `<facts.json>` 是本次分析的 JSON 文件，包含 `change_kind`（`corrective` / `intentional`）、`change_ref`、`verify_agent` 与适用的 `ai_review`；不再要求或提交独立 `route`。若存入当前 Change，使用约定文件 `openspec/changes/<change_ref>/analysis-handoff.json`；也可放在 Change 目录外。stage 使用不含 `gate` 的 draft，Gate PASS 后在同一文件增加 `gate.{result,reasons_ref}`。

## Procedure

1. draft Facts 写入并回读：

   ```bash
   rondo analysis stage --issue <issue-key> --facts <facts.json> --workspace-id <workspace-id> --registry-config "<config-path>"
   ```

2. 在已解析的根仓执行 Analysis Gate，并将结果落盘。`--out` 的根仓相对路径由 CLI 根据 `--openspec-root` 解析，不依赖当前 `cwd`；仅允许当前 Change 的固定 Gate Result 位置：

   ```bash
   rondo analysis validate --issue <issue-key> --openspec-root <root-repo> --workspace-id <workspace-id> --registry-config "<config-path>" \
     --out openspec/changes/<change_ref>/logs/analysis-gate-result.json
   ```

3. 仅在 Gate PASS 后发布 Analysis Package 摘要、Change / Evidence 引用和 Gate 结果。摘要是 Issue View，不复制工程正文；facts 的 `gate.reasons_ref` 必须填写上述根仓相对路径（`openspec/changes/<change_ref>/logs/analysis-gate-result.json`）。Gate PASS 同时绑定 Issue / Workspace / Change Kind / Schema、当前 Change 工件和已审核的 Issue Facts；不得自行构造 PASS 内容或引用其他 Change 的结果。只补写约定 Handoff 的顶层 `gate` 不使结果失效；修改其他分析事实后须重新 stage 和 Gate。
4. 以根仓绝对路径收口并回读状态：

   ```bash
   rondo analysis complete --issue <issue-key> --facts <facts.json> \
     --registry-config "<config-path>" --workspace-id <workspace-id> --root-repo "<root-repo>"
   ```

   本步骤先回读实际 Gate Result 并确认身份、全部必要 PASS 检查项和当前 Change 工件摘要一致；若 Gate 后被审查的工程工件或显式引用的 Review Evidence 被修改，应重新运行 Gate；普通未引用的运行日志不属于证据快照。随后将当前 Change（`openspec/changes/<change_ref>/` 白名单路径）提交到根仓当前分支，以受控 TFS 认证推送；远端分支首次创建由命令处理，无须预先 push。核验远端固定版本并持久化、回读 `analysis.source` 后才进入 `analysis_review`；首次分析与定向返工都经此收口。提交只 add 本 Change 路径，不夹带其他在飞 Delivery 的未提交 WIP；无新改动时幂等跳过提交。已进入审核的重跑核验原来源，不重定向到当前 HEAD。输出含 `root_commit: { repo_url, branch, commit, committed, pushed }`。

## Validation

- Gate 确认服务端 `analysis.change_kind` 与当前 Change Schema 对应，并按 Schema 核对必要 Artifact 与专业 Review（Intentional 的 APPROVED AI Review 不得省略）；Complete 必须核对真实 Gate Result 的身份和工件摘要，不能仅凭 facts 中的 PASS 字符串提交。PASS 后 Package 与 Gate Result 在 Issue 上可读取。
- 当前 Change 已提交并推送根仓（`complete` 输出 `root_commit.pushed=true`，远端当前分支可见本次提交）。
- `complete` 返回 PASS 且 `analysis_review` 与 Facts 已回读；本 Skill 不执行 TFS 写入。
- `analysis.source` 已回读，可通过 `rondo analysis read` 获取固定版本的 tasks.md；审核摘要应引用该来源供 Human 确认。

## Output

- `{ result, issue, status, metadata_keys }`，成功后结束本次分析，不自动推进研发。

## Error Handling / Stop Conditions

退出码矩阵（三条命令共用语义，stdout 均为纯 JSON）：

| 退出码 | 语义 | 处置 |
| --- | --- | --- |
| 0 | PASS / 落账并回读一致 | 继续下一步 |
| 2 | FAIL：字段非法 / 检查未过 / 回读不一致 | 修 facts 或工件后**幂等重跑**；stage 拒绝 gate 段时移除后重跑；不得绕过 stage 手工 `issue metadata set`（键名/值格式无保障） |
| 3 | UNKNOWN：暂时性网络失败（超时、空响应、传输层错误） | 等待 ≥15s 原样重试一次；恢复后继续，不视为分析结论变化 |
| 3 | UNKNOWN：运行时或凭据错误、检查项本身未知（如 openspec CLI 不可用）或重试后仍 UNKNOWN | 停止并向 Delivery Lead 回流最后一次 reasons；环境由 Runtime 负责人修复，不把未知当批准 |
| 64 | 参数用法错误 | 对照命令用法修正调用 |

补充规则：

- Gate FAIL：针对缺失项返工后重新走本 Skill；metadata 缺失类先重跑第 1 步 stage 修正 draft 键。
- 配置不合法、Workspace 身份不匹配、Issue 已经进入后续阶段：停止，不覆盖状态。
- 根仓 commit / push 失败属环境性 UNKNOWN（exit 3）：保留工作区和本地 Commit，不进入 `analysis_review`。网络失败按上述规则重试一次；Git 运行时或凭据错误直接回流阻塞，由 Runtime 负责人修复后重跑 `complete`，不另写临时发布脚本。根仓暂存区混入本 Change 之外的内容时拒绝夹带提交，交人工清理暂存区后重跑。
