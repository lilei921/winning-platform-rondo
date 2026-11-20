> 本包镜像；权威来源：pull-request/references/repo-write-isolation-contract.md。

# 并发写隔离契约：根仓临界区串行 + 业务仓枢纽直检分支（冻结）

> **本文件为本规范的唯一权威**。冻结日期：2026-11-03。前身为 `worktree-isolation-contract.md`（2026-10-26 冻结，应用层 worktree 模式）；2026-11-03 起业务仓研发改为枢纽克隆内直检特性分支，本文整篇改写并改名，原文件仅作历史溯源。
> 被以下技能以包内镜像引用（2026-11-08 起，镜像头含出处；修订本文件后须重新同步各镜像）：`pull-request`（本包）、`development-execution`、`backend-engineering`、`frontend-engineering`、`codebase-explorer`、`delivery-flow`。

**路径与并发范围**：根仓使用 Multica 原生 checkout 返回的实际路径，后续命令显式传入。本契约约束同一检出目录中的并发写入及业务仓分支生命周期，不要求 Project 本地挂载或全项目同一 daemon。

| | 根仓（OpenSpec monorepo） | 业务仓（根仓直接子仓） |
|---|---|---|
| 收敛机制 | 按当前操作的发布分支提交，无 PR | 特性分支 + PR 合并（02 §10） |
| 事实可见性 | 跨 Run 消费已发布工件引用；本地操作使用显式根仓路径 | Issue 内自治 → 可拆 |
| 并行隔离手段 | 按 Issue 分目录（`openspec/changes/<change_ref>/`）+ commit 临界区串行化（脚本内 flock，或 push 失败 `pull --rebase` 重试兜底） | **枢纽克隆内直接 checkout 每 Issue 特性分支** + 同仓串行派发 + 净树开工/收尾纪律 |
| 冲突暴露点 | commit/push 瞬间（秒级，重试排队） | PR 合并时（Lead 协调返工，标准 git 协作模型） |

**要点**：

0. **目录结构约定**：仓库身份与路径以 `<root_repo>/docs/config/repo-context.yaml` 为准，Facts 的 `repo_key` 值等于 `repo_id`。业务仓使用 `<root_repo>/<repo_path>/` 中的检出，实际目录必须位于明确传入的根仓内；不得将未经核实的其他目录作为本次业务工作树：
   ```text
   <root_repo>/
   ├─ openspec/ ...                     ← 根仓本体，按操作约定发布
   ├─ docs/config/repo-context.yaml     ← repo_id / repo_path 唯一映射源
   ├─ <repo_path>/                      ← 常驻枢纽 = 唯一工作树（研发在其内切 feat/<tfs-id>）
   └─ .multica/locks/root-finalize.lock ← 根仓 finalize 临界区
   ```
1. **分支生命周期分工**：开工切分支为 Agent 按契约执行的三步——`fetch origin` → `status --porcelain` 为空（非空 → UNKNOWN 停止，不自行清理）→ `switch -c feat/<tfs-id> origin/<目标分支>`；分支已存在（上次在途）则 `switch` 挂接即可，**不自动 rebase 目标分支**（目标分支已前进需同步时回流 Delivery Lead 语义决策）。收口（枢纽切回目标分支、ff-only 对齐、`git branch -d`，绝不 -D）是 finalize 确定性脚本职责，不靠 Agent 自觉；
2. git 不再强制同分支互斥（单一工作树下同一分支本就只有一个检出）——**解法单元是"同仓串行派发 + 净树检查"，不是共享分支**；直推共享分支的场景（根仓 Archive Commit）只能短临界区串行；
3. **同仓串行**：共享同一业务工作树的同一时刻只允许一个在研 Issue，派发预检判据与动作见 `delivery-flow` Skill；**净树开工、净树收尾**——开工前 `status --porcelain` 为空才允许 `switch`；收尾提交并推送干净后才报 READY（枢纽脏树会让 finalize UNKNOWN，属安全兜底但卡人工）；
4. **分析侧只读远端引用**：研发期间枢纽躺在 `feat/<tfs-id>` 上，工作树内容是在研状态。Analyst / 探索类 Run 读业务仓一律以 `origin/<目标分支>` 引用为准（`git show origin/<branch>:<path>`、`git log origin/<branch>`），不读工作树当前文件；
5. 单工作树只串行化仓内研发；改同一文件同一段的语义冲突谁也无解，只是在 PR 合并点暴露；
6. **落地状态**：2026-11-03 起业务仓研发改为枢纽直检分支，应用层 worktree 模式废止；`rondo pr worktree` 命令保留但不再使用（死代码，待 CLI 发版移除）；`.worktrees/` 遗留目录由人工核查清空后删除。
