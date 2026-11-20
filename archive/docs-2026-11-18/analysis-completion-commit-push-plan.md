# analysis-completion 提交推送当前 Change 方案

状态：已批准（2026-11-03），待实施

## 背景与问题

分析产物（Change 正文、draft Facts、Gate Result JSON）当前只以未提交 WIP 形态落在根仓工作区：

- workitem-analysis / analysis-completion 全程零 git 操作，产物由 Agent 与 CLI 以普通文件写入持久共享根仓工作树；
- 进入 `analysis_review` 前没有任何提交，审核基线不可追溯、换 daemon / 工作区后产物不可见、返工修订无版本记录；
- 既有设计中根仓提交只有两个时点（Human APPROVED 批准基线、Finalize 归档），分析收口时点缺位。

## 目标

在 analysis-completion 收口时提交并推送当前 Change：

- **首次分析与定向返工都执行**——两条路径本就汇聚于 `skill-flow analysis complete`（无独立返工技能），在该命令内实现即全覆盖；
- **推送成功后才允许进入 `analysis_review`**——push 失败按环境性 UNKNOWN（exit 3）处置，Issue 状态停留 `in_progress`；
- 只提交本 Change 路径白名单（`openspec/changes/<change_ref>/`），不夹带根仓内其他在飞 Delivery 的合法 WIP。

## 既有模式（复用，不新造）

| 能力 | 复用来源 |
| --- | --- |
| 分支探测 / 白名单 add / 幂等 push / 有界 rebase 重试 ≤3 | `tools/skill-flow/src/commands/delivery/finalize.ts` `routeArchive`（L268-346） |
| 根仓路径解析（唯一事实源=平台 local_directory 资源） | `tools/skill-flow/src/clients/runtime-paths.ts` `resolveRuntimePaths` |
| 错误分类（环境 UNKNOWN exit 3 / 前置 FAIL exit 2） | `tools/skill-flow/src/cli/errors.ts` |
| git spawn | `tools/skill-flow/src/clients/spawn.ts` `runCommand` |

关键先例：

- push 目标 = `symbolic-ref --short HEAD` 探测的当前检出分支，禁硬编码 master（finalize §4.6 实证缺陷：dev 检出下 push master 静默假成功）；
- `git add -A -- <路径白名单>`，禁 `git add .`；
- push 前 `rev-list origin/<branch>..HEAD --count` 判幂等；失败 `pull --rebase` 重试 ≤3，仍失败 UNKNOWN 且本地 Commit 保留（恢复只补 push）。

## 实施内容

### 1. CLI：`tools/skill-flow/src/commands/analysis/complete.ts`

- 新增可选参数 `--root-repo`（仅本地测试/人工应急，与 finalize 同语义）。
- 配置读取改用 `clients/config.ts` `loadConfig`；`assertRegistryWorkspace` 的 workspace_id 一致性校验保留（stage.ts 同引用，签名不动）。
- `main()` 的 `if (writable)` 块内、**写 metadata / 状态之前**插入 `commitAndPushChange()`：
  1. `resolveRuntimePaths(cfg, { issue, rootRepoArg, need: ["openspec"] })` 解析根仓；
  2. `symbolic-ref --short HEAD` 取当前分支（detach HEAD → UNKNOWN）；
  3. `porcelainPaths` 快照，白名单 = `openspec/changes/<change_ref>/` 前缀；
     - 不拒绝根仓其他未提交 WIP（分析期根仓合法持有在飞 Delivery 的 WIP，与 finalize 归档时点不同）；
     - `git add -A -- openspec/changes/<change_ref>/` 后用 `git diff --cached --name-only` 核对暂存区 ⊆ 白名单，有外来已暂存内容 → UNKNOWN（拒绝夹带，不自动 unstage）；
  4. 白名单内无改动 → `committed: "skipped_no_changes"`（幂等重放）；
  5. 有改动 → commit，message 沿用 finalize 风格：`analysis: <change_ref> (<issue-key> / tfs <tfs.id>)`（tfs.id 取自 Issue metadata，缺失时省略该段）；
  6. push：rev-list 幂等判断 → `git push origin <branch>` → 失败 `pull --rebase` 重试 ≤3 → 仍失败 UNKNOWN（本地 Commit 保留）。
- push 成功后才执行现有 metadata 写入 + `issue status analysis_review` + 回读确认。metadata 写失败后的重放天然幂等（无新改动跳过 commit、rev-list=0 跳过 push）。
- 输出 JSON 增加 `root_commit: { branch, committed, pushed }` 段；PASS 契约其余字段不变。
- 守卫重放路径（已处 `analysis_review` 且 Facts 一致 → `writable=false`）不做任何 git 操作。

### 2. 共享 git helper：`tools/skill-flow/src/clients/git.ts`（新建）

从 finalize.ts 抽出 `git` / `gitOk` / `porcelainPaths` 三件套供 complete 使用（finalize、worktree.ts 已有两份重复实现，**本次不回改**，控制回归面；porcelainPaths 保留"不得 trim 整体 stdout"注释——porcelain 首列状态位会被 trim 吃掉）。

### 3. 技能：`projects/multica/workspace-skills/analysis-completion/SKILL.md`

- frontmatter description 补充提交推送职责；
- Procedure 第 4 步：说明 complete 会将 `openspec/changes/<change_ref>/` 提交到根仓当前分支并推送（白名单提交、不夹带其他 WIP、无改动幂等跳过），**推送成功后才写入 `analysis_review`**，输出含 `root_commit` 段；
- Validation 增加：根仓远端可见本次 Change 提交（`root_commit.pushed=true`）；
- Error Handling 增加：commit/push 失败属环境性 UNKNOWN——按既有 UNKNOWN 规则处置（≥15s 原样重试一次，仍失败停止交 Delivery Lead）；push 重试耗尽时本地 commit 保留，恢复重跑 complete 只补 push；
- 不改 workitem-analysis SKILL（返工已汇聚到 analysis-completion 收口，无需重复表述）。

### 4. 版本与测试

- `tools/skill-flow/package.json` → 1.0.9（package-lock 同步），`CHANGELOG.md` 新增条目。
- `test/mock-multica.cjs` 扩展：`issue metadata list`、`issue status <s> --no-start`、`issue get` 返回 `status` 字段。
- 新增 `test/analysis-complete.test.mjs`（沿用 dev-pr-prep.test.mjs fixture 模式：bare remote + 根仓 + MOCK_ROOT_REPO；facts fixture 预置 stage 已写入的 draft metadata）：
  1. 首次分析：Change 新文件 → exit 0 PASS，提交已推送到 bare remote，status=analysis_review；
  2. 返工：重置 in_progress、修改 Change 文件再跑 → 第二个提交推送成功；
  3. push 失败（移除 remote）→ exit 3 UNKNOWN，status 保持 in_progress，本地 commit 保留；
  4. 无改动重放 → PASS 且 `committed=skipped_no_changes`。

## 验证

1. `cd tools/skill-flow && npm run build && npm test`（现有 14 例 + 新增 4 例全绿）。
2. 契约自检：`node dist/index.js analysis complete` 缺参 → exit 64，usage 含 `--root-repo`。
3. 部署（不在本提交内）：test220 daemon 主机按既有手动流程安装新版 tgz 并重启 daemon（沿用 1.0.8 未随仓发布 tgz 的惯例）。

## 不在范围

- 不回改 finalize.ts / worktree.ts 的重复 git 封装；
- 不更新 03 设计文档 §12.1 契约描述（SKILL 即权威本体）；
- analysis-repo-sync-plan（分析前拉取）仍是独立待裁定方案，与本方案解耦。
