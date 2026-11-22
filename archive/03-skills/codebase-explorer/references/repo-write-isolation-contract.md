> 本包镜像；权威来源：pull-request/references/repo-write-isolation-contract.md。

# 业务仓准备与共享检出隔离契约

> **权威来源为本文件**。`development-execution`、`backend-engineering`、`frontend-engineering`、`codebase-explorer`、`delivery-flow` 使用包内镜像；修订后同步各镜像。

**路径与并发范围**：根仓使用 Multica 原生 checkout 返回的实际路径，后续命令显式传入。本契约约束同一检出目录中的并发写入及业务仓分支生命周期，不要求 Project 本地挂载或全项目同一 daemon。

## Task 独立业务仓

- Engineer 使用 `rondo dev prepare` 在当前 Task 根仓下准备获准的业务仓，以返回的 `path`、`branch` 为准。Requirement 同时传入 `change_ref`、`task_refs`，目标仓须在当前有效派发的 `repo_keys` 内；Bug 沿用 Bug 授权。
- 首次准备创建或续接 `feat/<tfs.id>`；同身份重入只校验已有检出，保留修改和未推送 Commit，不自动 fetch、rebase 或 reset。后续远端操作使用 `rondo dev git` / `rondo bug git` 的受控认证。
- 同仓串行派发仍适用。Lead 按批准的任务仓库范围、相关 active 派发和依赖协调；Engineer 在自己的 Task 工作区实现，不要求 Lead 探测其他 Run 的 Git 目录。
- 下节的净树切分支、切回目标分支与删除特性分支只适用于共享检出，不用于回收 Task 独立业务仓；其他完成、PR 与归档契约保持各自职责。

## 共享检出

已有共享枢纽仍遵循以下占用检查和收口约束；本地检查由访问该工作区的 Engineer / Runtime 执行。

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
1. **分支生命周期分工**：开工通过运行时受控认证更新目标分支 refs → `status --porcelain` 为空（非空 → UNKNOWN 停止，不自行清理）→ `switch -c feat/<tfs-id> origin/<目标分支>`；分支已存在（上次在途）则 `switch` 挂接即可，**不自动 rebase 目标分支**（目标分支已前进需同步时回流 Delivery Lead 语义决策）。收口（枢纽切回目标分支、ff-only 对齐、`git branch -d`，绝不 -D）是 finalize 确定性脚本职责，不靠 Agent 自觉；
2. git 不再强制同分支互斥（单一工作树下同一分支本就只有一个检出）——**解法单元是"同仓串行派发 + 净树检查"，不是共享分支**；直推共享分支的场景（根仓 Archive Commit）只能短临界区串行；
3. **同仓串行**：共享同一业务工作树的同一时刻只允许一个在研 Issue，派发预检判据与动作见 `delivery-flow` Skill；**净树开工、净树收尾**——开工前 `status --porcelain` 为空才允许 `switch`；收尾提交并推送干净后才报 READY（枢纽脏树会让 finalize UNKNOWN，属安全兜底但卡人工）；
4. **分析侧只读远端引用**：研发期间枢纽躺在 `feat/<tfs-id>` 上，工作树内容是在研状态。Analyst / 探索类 Run 读业务仓一律以 `origin/<目标分支>` 引用为准（`git show origin/<branch>:<path>`、`git log origin/<branch>`），不读工作树当前文件；
5. 单工作树只串行化仓内研发；改同一文件同一段的语义冲突谁也无解，只是在 PR 合并点暴露；
