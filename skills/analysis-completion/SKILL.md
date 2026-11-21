---
name: analysis-completion
description: 将已完成的 Analysis Package 通过 Analysis Gate 提交人工审核；分析准备就绪或定向返工完成后使用，负责 Facts 落账、真实 Gate、本地 Git Commit、Rondo 审核发布及状态确认。
---

# analysis-completion

## Preconditions / Inputs

- 当前 OpenSpec Change、专业分析结果与 draft Handoff Facts 已就绪。
- 默认配置：`config/repo-registry.json`（相对于本 Skill 目录）。
- Analysis 三步均传入 `--registry-config "<config-path>"`，读取配置中的工作区和 Multica 环境，禁止改用默认环境。
- 规范来源及固定版本读取遵循 `references/analysis-source-contract.md`。
- `<facts.json>` 是本次分析的 JSON 文件，包含 `change_kind`（`corrective` / `intentional`）、`change_ref`、`verify_agent` 与适用的 `ai_review`；不再要求或提交独立 `route`。若存入当前 Change，使用约定文件 `openspec/changes/<change_ref>/analysis-handoff.json`；也可放在 Change 目录外。stage 使用不含 `gate` 的 draft，Gate PASS 后在同一文件增加 `gate.{result,reasons_ref}`。

## Procedure

使用已确认在当前项目分支就绪的实际 `root_repo` 运行 Gate 与发布命令；仅路径存在不代表就绪，准备结果无法确认时按需使用 `workspace-preparation`，不依赖其他 Skill 的隐式执行状态。

1. draft Facts 写入并回读：

   ```bash
   rondo analysis stage --issue <issue-key> --facts <facts.json> --workspace-id <workspace-id> --registry-config "<config-path>"
   ```

2. 在已解析的根仓执行 Analysis Gate，并将结果落盘。`--out` 的根仓相对路径由 CLI 根据 `--openspec-root` 解析，不依赖当前 `cwd`；仅允许当前 Change 的固定 Gate Result 位置：

   ```bash
   rondo analysis validate --issue <issue-key> --openspec-root <root-repo> --workspace-id <workspace-id> --registry-config "<config-path>" \
     --out openspec/changes/<change_ref>/logs/analysis-gate-result.json
   ```

3. 仅 Gate PASS 后，在同一 Facts 文件补充真实的 `gate.result=PASS` 和 `gate.reasons_ref=openspec/changes/<change_ref>/logs/analysis-gate-result.json`。Draft Facts 变化须重新 stage 与 Gate，审核工件或引用的 Review Evidence 变化须重新 Gate；不得伪造或复用其他 Change 的 PASS。

4. 在根仓仅暂存并本地 Git Commit 当前 Change 的必要审核工件、Gate Result 及被 Gate 引用的 Change 内 Evidence；外部 Evidence 只保留可信引用，不复制为本地文件。不包含无关改动，也不改动其他暂存内容。然后执行：

   ```bash
   rondo analysis complete --mode requirement --issue <issue-key> --facts <facts.json> \
     --registry-config "<config-path>" --workspace-id <workspace-id> --root-repo "<root-repo>"
   ```

   Rondo `complete` 负责远端发布、固定来源核验、`analysis.source` 写入、`analysis_review` 状态变更及回读；不另外执行 Push 或手工写入审核状态。

## Validation

- 以真实 Gate Result 和 `complete` 返回值为准；Intentional 的专业 AI Review 必须有效，`FAIL` / `UNKNOWN` 不得视为 PASS。
- 成功后确认 Issue 为 `analysis_review`，Facts、Gate Result 和 `analysis.source` 可回读；`root_commit.commit` 与来源的 `analysis.source.commit` 一致，固定版本可用 `rondo analysis read` 核实。Human 审核引用该来源。
- 本 Skill 不执行 TFS 写入、不批准 Issue。

## Output

- 返回真实的 `{ result, issue, status, metadata_keys }` 及来源引用。`complete` 成功后提供简洁 Human Review Summary（结论、范围、验证建议、未决项 / 风险和已确认的 Change / Gate / Source 引用），供现有 Issue View / Run Result 展示，不新增 Artifact 或独立发布步骤；不自动推进研发。

## Error Handling / Stop Conditions

- `0` 且 `result=PASS` 才可继续；`2` / `FAIL` 按真实原因修正 Facts 或工件并重跑必要步骤；`64` 修正参数。不得绕过 stage 手写 Issue Metadata。
- `3` / `UNKNOWN`、超时或返回不明时，先回读当前 Issue、Facts / Gate Result、发布来源及状态，判断已有副作用后按真实结果恢复；无法确认时停止并说明阻断，不将未知当 PASS，也不盲目连续重试。
- Gate FAIL 或审核 Evidence 变化时重新 Gate；Draft Facts 变化时重新 stage 与 Gate；配置、Workspace 身份不符或 Issue 已进入后续阶段时停止，不覆盖更新事实。
- 发布冲突或核验失败时保留现场并报告差异；中断后按 `references/analysis-source-contract.md` 回读来源，再决定是否重跑 `complete`。
