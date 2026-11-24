# Multica Native Workspace 最小可行性验证报告

- 日期：2026-11-24
- Runtime：Windows 11 / PowerShell
- Multica：`0.11.1`，commit `e1fe10d66`
- Rondo：`@winning/rondo 1.2.37`
- 专用验证 Issue：`LEI-54`（Task A）、`LEI-55`（Task B）
- Task A Run：`01a20c2e-ddff-79e1-8b02-4d22c9622805`
- Task B 成功 Run：`01a20c34-1070-7265-9c4f-7b10524fcb98`
- 原则：所有 PASS/FAIL 均来自当前 Runtime 的实际命令结果；Rondo 中未执行的写命令仅作只读源码兼容性判断。

## 1. 验证结论

### 1.1 总结论

**Native Workspace 已具备在隔离 Task 内统一管理“一个工程根仓 + 多个嵌套业务子仓”的基础能力，可以作为替代现有独立 Clone / Rondo 手工 Worktree 准备机制的基础，但还不能无改造接管全部 Rondo 流程。**

已实际证明：

- TFS 根仓和已登记 TFS 业务仓均可通过 `multica repo checkout <url> --ref <ref>` 检出。
- 在根仓目录执行子仓 Checkout，会形成预期的直属嵌套目录。
- 同一 Task 可同时持有根仓、`frame`、`frame-web`，各仓有独立工作树和本地 Task Branch。
- 首次 Checkout 会以指定远端 ref 为起点；重复 Checkout 复用工作树、只 fetch remote refs，并保护未提交文件。
- 本地 Task Branch 的 Commit 可通过 `HEAD:refs/heads/<candidate>` 发布到不同名远端 Candidate。
- 新 Task 可用该远端 Candidate 首次 Checkout 并准确续接同一 Commit；Task 工作区相互隔离。

### 1.2 实际阻塞与边界

1. **业务仓必须先对 Workspace 可用。** 未登记的 `common` Checkout 实际失败：`repo is not configured for this workspace`。本次 `repo list` 只显式列出根仓，而 `frame` 等 Project Resource 可成功 Checkout，因此 Skill 不能仅凭 `repo list` 判断可 Checkout 集合，也不能假定任意 `repo-context.yaml` 条目均可直接使用。
2. **Checkout 必须运行于 daemon Task 上下文。** 非 Task 终端依次报 `MULTICA_DAEMON_PORT not set`、`MULTICA_TOKEN not set`；本次最终验证由获授权创建的 LEI-54/55 daemon Task 执行。
3. **已有 Checkout 重入不是 ref 切换命令。** 即使重新传 `--ref <candidate>`，同一 Task 的已有工作树仍保持原 Task Branch，仅 fetch remote refs。
4. **没有目标目录参数。** 目标位置完全由当前工作目录决定；编排时必须显式控制 cwd。
5. **Rondo Bug 路径存在结构性不兼容。** 当前实现要求业务仓 `.git` 为目录、common dir 等于 `<repo>/.git`，并要求本地分支名等于 `feat/<tfs.id>`；Native Checkout 实际是 `.git` 文件的 linked worktree，本地分支为 `agent/<agent>/<task-suffix>`。
6. Requirement PR Preparation 的静态约束与 Native 形态基本相容，但本次未使用正式 Issue 执行端到端交付命令，因此不能宣称该命令整体 PASS。

## 2. 验证结果矩阵

| 验证项 | 结果 | 实际证据 | 限制或问题 |
|---|---|---|---|
| TFS 根仓 Checkout | PASS | `winning-platform-monorepo` 成功；HEAD 与 `origin/master` 均为 `f95ea97c84a085bfb3d40d7b2ec1a600da62ceb3` | 必须在 daemon Task 内；没有目标目录参数 |
| TFS 子仓 Checkout | PASS | `frame` / `frame-web` 均从 TFS URL 成功，HEAD 分别等于各自 `origin/dev` | 仅验证已授权、可用仓库 |
| 嵌套目录支持 | PASS | 在根仓 cwd 执行后形成 `winning-platform-monorepo/winning-dps-df-frame[-web]` | 位置依赖 cwd，不能通过 CLI 参数另指目录 |
| 未登记业务仓 Checkout | FAIL | `common` 返回 `checkout failed: repo is not configured for this workspace`，未生成目录 | 必须先将仓库纳入 Workspace 可用范围；未用 Clone 绕过 |
| 多业务仓 Checkout | PASS | 根仓、frame、frame-web 同时存在，工作树/分支独立；第二次 Checkout 未影响已有仓 | 本地分支名均由 Task 统一生成，仓间以不同 Git common dir 隔离 |
| 指定远端 ref | PASS | 根仓 `master`、业务仓 `dev`、Task B Candidate 首次 Checkout 的 HEAD 均与指定远端 ref 一致 | 只适用于首次/新工作树；已有 Checkout 重入不会切换 ref |
| 重复 Checkout | PASS | 返回 `Kept the existing checkout`，路径、分支、HEAD 不变；明确只 fetch remote refs | 不复用为“切换分支”语义；本次未触发 `fetch_error` |
| 未提交成果保护 | PASS | untracked 临时文件在第三次 Checkout 后仍存在，HEAD/分支不变；仅该临时文件已清理 | 未使用会破坏成果的 `--fresh` |
| Candidate 续接 | PARTIAL | Task B 首次 Candidate Checkout 精确续接 `5fc9101f...`；Task A 已有 Checkout 重入则保持原分支 | 跨 Task 首次续接 PASS；同 Task 已有工作树 ref 切换不支持 |
| 跨 Task 隔离 | PASS | Task B 使用新 workdir 和 `agent/engineer/7b10524fcb98`；未继承根仓、frame-web 或 common | bare cache 是共享的，工作树与本地分支隔离 |
| Candidate 发布 | PASS | 非强制 Push 新分支成功，`ls-remote` SHA 等于本地 HEAD `5fc9101f...`；测试后远端分支已删除并回读为空 | 仅唯一授权测试分支，未创建 PR |
| Rondo 兼容性 | PARTIAL | `runtime check-checkout` 对实际 Native 根仓 PASS；其他命令完成帮助与源码约束检查 | Bug Git/PR 路径不兼容 linked worktree 和 Task Branch；未执行正式交付写操作 |

## 3. 实际目录结构

```text
D:\Multica\default\
├─ .repos\a9469044-700c-4206-80d2-b39bad65de56\
│  ├─ winning-platform-beb3a9efac54.git\          # 根仓 bare/common Git 目录
│  │  └─ worktrees\winning-platform-monorepo\     # Task A 根仓 Git dir
│  ├─ winning-dps-df-f-447fa33b85dc.git\          # frame common Git 目录
│  │  ├─ worktrees\winning-dps-df-frame\          # Task A frame Git dir
│  │  └─ worktrees\winning-dps-df-frame1\         # Task B frame Git dir
│  └─ winning-dps-df-f-da5de050add3.git\          # frame-web common Git 目录
│     └─ worktrees\winning-dps-df-frame-web\      # Task A frame-web Git dir
└─ winning-lil-b39bad65de56\
   ├─ lei-54-4d22c9622805\workdir\                # Task A workdir
   │  └─ winning-platform-monorepo\               # 根仓工作树，.git 为文件
   │     ├─ AGENTS.md
   │     ├─ docs\config\repo-context.yaml
   │     ├─ winning-dps-df-frame\                 # frame 工作树，.git 为文件
   │     └─ winning-dps-df-frame-web\             # frame-web 工作树，.git 为文件
   └─ lei-55-7b10524fcb98\workdir\                # Task B 全新 workdir
      └─ winning-dps-df-frame\                    # 仅本 Task 主动 Checkout 的 frame
```

根仓、业务仓、Task workdir 的关系：

- 根仓是 Task A workdir 的直属子目录。
- 业务子仓是根仓工作树的直属子目录，但 Git 元数据不属于根仓。
- 每个工作树的 `.git` 都是文本指针文件；`git-dir` 位于对应 common dir 的 `worktrees/` 下。
- 同一仓跨 Task 共用 bare cache/common dir，但使用不同 worktree Git dir 和本地 Task Branch。
- 根仓 `.gitignore:8` 的 `/winning-dps-df-*/` 规则忽略业务子仓；`git ls-files` 无输出，根仓不会意外跟踪子仓。

关键分支与 SHA：

| 工作树 | 本地分支 | HEAD / 起点 |
|---|---|---|
| Task A 根仓 | `agent/engineer/4d22c9622805` | `f95ea97c84a085bfb3d40d7b2ec1a600da62ceb3` = `origin/master` |
| Task A frame | `agent/engineer/4d22c9622805` | 初始 `76fe702536f44cb2df9347e1d60e49a852003dd5` = `origin/dev` |
| Task A frame-web | `agent/engineer/4d22c9622805` | `4d612919f997f2c82e8b2446cc466af3dc616179` = `origin/dev` |
| Task A Candidate | `agent/engineer/4d22c9622805` | 新 Commit `5fc9101f8f1c7014582ffc37b39fe97fb5f1fd3b`，父提交为上述 dev 起点 |
| Task B frame | `agent/engineer/7b10524fcb98` | `5fc9101f8f1c7014582ffc37b39fe97fb5f1fd3b` = 指定远端 Candidate |

## 4. 关键命令及返回结果

### 4.1 CLI 实际能力

```powershell
multica --version
multica repo checkout --help
```

实际确认参数只有：

```text
multica repo checkout <url> [--ref <branch, tag, or commit>] [--fresh]
```

没有 `--output`、目标目录或手工 Task Branch 参数。Task A 初次探测 `--output json` 实际返回 `unknown flag: --output`，随后按真实帮助去掉该参数完成验证。

### 4.2 根仓与业务子仓

```powershell
multica repo checkout <root-url> --ref master
# Checked out ... -> <task-a-workdir>\winning-platform-monorepo
# (branch: agent/engineer/4d22c9622805)

Set-Location <task-a-workdir>\winning-platform-monorepo
multica repo checkout <frame-url> --ref dev
multica repo checkout <frame-web-url> --ref dev
```

原生返回分别指向根仓下的 `winning-dps-df-frame`、`winning-dps-df-frame-web`。独立 `git rev-parse HEAD` 与 `git rev-parse origin/<ref>` 回读一致，详见第 3 节。

### 4.3 未登记业务仓

```powershell
multica repo checkout <common-url> --ref dev
```

```text
checkout failed: repo is not configured for this workspace
```

未生成目录，未用额外 Clone、移动目录或手工 Worktree 绕过。

### 4.4 重复 Checkout 与未提交保护

无临时文件时第二次 Checkout：

```text
Kept the existing checkout ... (branch: agent/engineer/4d22c9622805,
this task's branch; 0 uncommitted files, 0 unpushed commits):
nothing was reset, cleaned, or switched; only remote refs were fetched.
```

创建唯一临时文件后，状态为：

```text
?? .multica-native-workspace-spike-task-a.tmp
```

第三次 Checkout 返回 `1 uncommitted file`，其余语义相同。Checkout 后：

```text
AFTER_THIRD_TEMP_EXISTS=True
BRANCH=agent/engineer/4d22c9622805
HEAD=76fe702536f44cb2df9347e1d60e49a852003dd5
```

仅删除本次临时文件后，`TEMP_EXISTS=False`，status 为空。

### 4.5 Candidate 发布、回读及清理

```powershell
git -C <frame> add -- .multica-native-workspace-spike-candidate.tmp
git -C <frame> commit -m 'AI-EVAL chore: 验证 Native Workspace Candidate 发布'
git -C <frame> push origin HEAD:refs/heads/spike/native-workspace-20261124-a94f6c2e
git -C <frame> ls-remote origin refs/heads/spike/native-workspace-20261124-a94f6c2e
```

```text
[agent/engineer/4d22c9622805 5fc9101] AI-EVAL chore: 验证 Native Workspace Candidate 发布
 * [new branch]      HEAD -> spike/native-workspace-20261124-a94f6c2e
5fc9101f8f1c7014582ffc37b39fe97fb5f1fd3b  refs/heads/spike/native-workspace-20261124-a94f6c2e
```

本地分支与远端分支不同名，发布不要求同名。验证结束后：

```powershell
git -C <frame> push origin --delete refs/heads/spike/native-workspace-20261124-a94f6c2e
git -C <frame> ls-remote origin refs/heads/spike/native-workspace-20261124-a94f6c2e
```

返回 `[deleted]`，随后 `ls-remote` 无输出；本地 HEAD 保持 `5fc9101f...`。

### 4.6 Candidate 重入与跨 Task 首次续接

Task A 已有 Checkout 重入：

```powershell
multica repo checkout <frame-url> --ref spike/native-workspace-20261124-a94f6c2e
```

实际仍返回 `Kept the existing checkout`、`nothing was ... switched`，本地分支保持 `agent/engineer/4d22c9622805`。远端 tracking ref 已 fetch 到 Candidate SHA，但不能据此声称发生了 ref 切换。

Task B 全新 workdir 首次 Checkout 同一命令：

```text
Checked out ... -> D:\Multica\default\winning-lil-b39bad65de56\lei-55-7b10524fcb98\workdir\winning-dps-df-frame
(branch: agent/engineer/7b10524fcb98)
```

```text
HEAD=5fc9101f8f1c7014582ffc37b39fe97fb5f1fd3b
origin/spike/native-workspace-20261124-a94f6c2e=5fc9101f8f1c7014582ffc37b39fe97fb5f1fd3b
status=## agent/engineer/7b10524fcb98...origin/spike/native-workspace-20261124-a94f6c2e
```

Candidate 标记文件内容可读取，且最后变更 Commit 正是 Task A HEAD。Task B workdir 中根仓、frame-web、common 均不存在。

### 4.7 Rondo 只读兼容检查

实际执行：

```powershell
rondo runtime check-checkout --root-repo <task-a-native-root>
```

```json
{"result":"PASS","rootRepo":"D:/Multica/default/winning-lil-b39bad65de56/lei-54-4d22c9622805/workdir/winning-platform-monorepo","changed":false}
```

用户所述命令在当前版本的准确入口为：

- `rondo bug git`：存在。
- `rondo bug prepare-pr`：实际入口；`rondo bug pr-prepare --help` 只显示 bug 命令组帮助。
- `rondo dev pr-prep`：实际 CLI 入口；源码注册名为 `pr-prepare`，帮助输出沿用手写用法文本。

未执行会修改正式 Issue Metadata、创建 PR 或改变交付状态的命令。

## 5. Rondo 兼容性分类

### 5.1 实际只读验证

- `rondo runtime check-checkout`：**PASS**。其实现只要求绝对路径位于 Git 根仓且 `AGENTS.md` 可读，Native linked worktree 满足该条件（`rondo/src/commands/runtime/check-checkout.ts:8-18`，`rondo/src/clients/native-checkout.ts:8-17`）。

### 5.2 只读源码检查确认的 Rondo 限制

- `rondo bug git` 与 `rondo bug prepare-pr` 都调用 `validateBusinessCheckout`（`rondo/src/commands/bug/git.ts:25-33`，`rondo/src/commands/bug/pr-prepare.ts:207-215`）。
- 该校验强制 `.git` 是目录、common dir 等于 `<repo>/.git`，并要求本地分支名等于交付分支（`rondo/src/commands/dev/prepare-workspace.ts:39-49`）。Native 的 `.git` 文件与 `agent/...` Task Branch 均不满足。
- `rondo dev pr-prep` 只要求业务仓 `.git` 存在，因此可接受 linked worktree 的文件形态（`rondo/src/commands/dev/pr-prepare.ts:269-279`）。
- Requirement 模式通过远端 Candidate HEAD == `candidate_commit`、Validation checkout HEAD == Candidate 及工作树干净来约束实际版本，不要求本地分支与远端同名（`rondo/src/commands/dev/pr-prepare.ts:281-306`）。Native Task Branch + 显式远端 Candidate 的模型与该事实校验相容。
- Requirement 的业务仓准备仍由 `requirement-worktree.ts` 先 Clone 基础仓再创建 `<repo>-<tfs.id>` Worktree（`rondo/src/commands/dev/requirement-worktree.ts:78-126`）。若切换到 Native，应替换这一准备段，而不是把 Native worktree 继续当作旧“基础 Clone + 子 Worktree”模型处理。

以上后三项是静态约束结论，不是正式 Issue 端到端 PASS。

## 6. 最小改造建议

### 6.1 可直接使用 Multica 原生机制

1. 在 Task workdir 检出根仓：`multica repo checkout <root-url> --ref <resource-ref>`。
2. 使用 Checkout 返回的根仓路径作为 cwd，再逐个 Checkout 已授权业务仓，形成嵌套目录。
3. 使用 `--ref` 选择新工作树的基线或已有远端 Candidate。
4. 同 Task 重入依赖原生 `Kept` 语义保护 dirty、untracked、unpublished 工作成果。
5. 使用 `git push origin HEAD:refs/heads/<delivery-candidate>` 发布不同名交付分支，并通过 `ls-remote` 回读 SHA。
6. 跨 Task 续接在新 Task workdir 首次 Checkout Candidate；不要复用旧工作树并期待 `--ref` 切换。

### 6.2 Rondo 所需最小适配

1. `native-workspace` Skill 负责确定性顺序：读取 Project Resource/ref → 根仓 Checkout → 在返回根仓路径下 Checkout Registry 中已授权业务仓 → 记录路径、Task Branch、基线和 HEAD。
2. 业务仓选择前核实其对当前 Workspace 可用；未登记时明确停止或进入既有授权登记流程，不自动 Clone 绕过。
3. Bug 的 `validateBusinessCheckout` 增加 Native linked worktree 支持：接受 `.git` 文件，并校验 common dir 位于当前 Workspace 的 daemon `.repos/<workspace-id>/` 缓存，而不是要求 `<repo>/.git`。
4. 将“本地工作分支身份”与“远端交付 Candidate 身份”解耦。本地保留 Multica Task Branch；交付继续使用 Registry/Issue 决定的 Candidate，并以本地 HEAD、远端 Candidate SHA 和 Commit 内容核验实际一致性。
5. 保留 `validateBusinessPath` 的直接子目录、禁止链接、根仓未跟踪且必须忽略等检查；实际根仓 `.gitignore` 已满足 Native 嵌套要求。
6. Skill 必须明确禁止把已有 Checkout 的 `--ref` 重入当作切换 ref。需要新 Candidate 工作树时优先新 Task；不能默认使用 `--fresh`，因为它会丢弃未提交内容。

### 6.3 Native 机制自身限制

- 只能在有效 daemon Task 上下文运行并依赖 Task 凭据。
- 仓库必须对 Workspace 可用，不能任意 Checkout `repo-context.yaml` 中的全部 URL。
- 不支持目标目录参数；cwd 即编排契约。
- 同一 Task 重复 Checkout 默认保持原分支，不提供非破坏性的已有工作树 ref 切换。
- 本地分支由 Multica 管理，不能由 Checkout 指定为 `feat/<tfs.id>` 或 `feature/<tfs.id>`。

### 6.4 可退役的旧 Git 准备逻辑

在 Native Workspace 适配验收覆盖后，可退役新流程对以下“准备工作区”逻辑的依赖：

- `prepareBusinessWorkspace` 中为 Bug 独立 Clone、创建 `feat/<tfs.id>` 本地分支的部分。
- `prepareRequirementWorktree` 中基础仓 Clone + 每 Requirement 手工 `worktree add` 的部分。

不应在适配前删除旧实现；也不应让 Native worktree 经过旧的 `.git` 目录/common dir 假设。现有 Rondo closeout 已有 Native 根仓 Checkout 和 daemon cache 校验，可复用其身份检查思路（`rondo/src/commands/delivery/closeout-root.ts`）。

### 6.5 必须保留的安全与交付校验

- Issue/Agent/Task 授权、Bug/Requirement 范围与批准状态。
- Registry URL 与 TFS Project/Repository 身份、origin fetch/push URL 一致性。
- 根仓规范、OpenSpec/Change 布局和根仓未跟踪业务子仓的边界。
- dirty/untracked/unpushed 保护；禁止默认 `--fresh`、reset、clean、Force Push。
- Candidate 必须为完整 40 位 SHA，远端分支 HEAD 与 candidate 一致，本地可核实同一 Commit。
- Validation 在真实 Candidate 工作树执行，HEAD 与工作树在验证前后不变。
- Commit 唯一 `Refs: #<tfs.id>` 尾注、Code Review、Regression、Blocking Findings 和交付 Metadata 回读。
- PR Preparation、PR 创建和交付状态变更仍由现有受控命令负责，不能由 Workspace Skill 代替。

## 7. 验证现场与清理

- 专用 Issue/Run 的实际报告保留在 LEI-54、LEI-55 评论中。
- 唯一远端测试分支 `spike/native-workspace-20261124-a94f6c2e` 已删除，`ls-remote` 回读为空。
- Task A 用于未提交保护的临时文件已删除；Candidate Commit 仍保留在本地工作树供核查。
- 未创建 PR，未修改任何正式业务 Issue 的 Metadata 或交付状态。
- 未修改 Rondo CLI、Skill、业务源码及现有交付机制；本文件仅为验证报告。
