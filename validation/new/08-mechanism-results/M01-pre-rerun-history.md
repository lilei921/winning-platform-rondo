# M01 — Multica 原生 TFS Git checkout 验证结果

> 历史记录：用户于 2026-11-13 明确要求全部重新验证，本文旧 TEST-2 / TEST-3 结论不再作为当前验收依据。本轮以 TEST-4 起的新证据及计划 §6.1 为准。

- 日期：2026-11-13，Asia/Shanghai
- 验证工具：Codex Desktop / Windows PowerShell + 真实 Multica Codex Task
- 对应：08 v0.9 §5.1 / V05
- 当前机制状态：**PASS（当前 Windows / Codex Runtime，原生 cache 就绪条件下）**。TEST-3 的首次 checkout 与同 Task 干净状态重入均通过；TEST-2 的超时保留为历史调用失败，不判机制不可行。
- 证据层级：真实 Task 中的机制验证；不代表 Rondo 适配或端到端验收
- 执行范围：仅 M01；未执行 M02–M12

## 环境与基线

| 项目 | 实测值 |
| --- | --- |
| PowerShell / Git | `7.6.9` / `2.54.0.windows.1` |
| Multica CLI | `0.8.1`，build `2026-11-06T10:12:35Z`，Windows amd64 |
| 本机 Daemon | `01a01965-2f6a-72fe-899f-3e7556c5d51d`；普通权限外只读查询为 `running`，CLI `0.8.1` |
| Rondo / Node.js / OpenSpec | `1.2.20` / `v22.22.2` / `1.13.2` |
| Multica 服务 | `http://172.17.1.97:8080` |
| 用户指定 Workspace | `rondo-test` / `60eb8cf4-31be-4a34-b744-8ef6a0bcf15d` |
| 用户指定 Project | `winning-platform-monorepo` / `d43bbc9d-4cc2-4cee-8f92-70c993ffbf97` |
| 实际 Runtime | `Codex (lileipc)` / `c55feddd-7910-480a-8f9f-9d6180b1f061`；归属上述本机 Daemon；`codex-cli 0.166.0`；查询为 `online` |
| 同名另一 Runtime | `b432692a-8613-461c-9144-14488bda1ee3`；Daemon `c6f44f56-d190-42db-ae86-e7be0eea7588`；未选为本次测试目标 |
| 控制端 Task Context | 普通终端的 `MULTICA_TOKEN`、`MULTICA_DAEMON_PORT`、`MULTICA_TASK_ID`、`MULTICA_RUN_ID` 均不存在；未在普通终端执行 checkout |
| 测试 Task Context | 真实 Task 内 Token / Port 存在，Task ID 与平台 Run ID 一致；仅记录凭据是否存在；实际 `checkout_mode=isolated` |
| 本地工作区 | `D:\UserProgram\winning-platform-monorepo`；分支 `rondo`；HEAD `4765e6d807d6de52ca5b0f7c70060ffcccc0c446` |
| 原有未跟踪文件 | 验证开始时 `git status --short` 为 `?? projects/multica/validation/new/`；保留原有方案文件 |

计划引用的 08 v0.9 已通过 GitHub 连接器读取 `lilei921/winning-platform-monorepo/main`，返回 blob SHA `ccb57d9380725cd7b5d116121e023e30ba29cc43`，与计划一致；重点阅读 §5.1。本地文件仍是 v0.8，blob SHA `2dc3f1408eb9ec5706dea600db58e38f77739feb`。本次未拉取、切分支或覆盖本地文件。

## 已执行操作及证据

本节是授权创建测试资源前的只读前置核验；查询目标已显式携带测试 Workspace ID。完整 TFS URL 来自 `docs/config/repo-context.yaml` 的 `root.repo_url`，没有根据路径猜测。之后经用户明确授权执行的创建与真实 Task 见下一节。

| 序号 | 命令或步骤 | 实际结果 |
| --- | --- | --- |
| 1 | `$PSVersionTable.PSVersion.ToString()`、`git --version`、`multica --version`、`rondo --version`、`openspec --version` | 版本如上；命令均可用 |
| 2 | `git status --short`、`git rev-parse HEAD`、`git symbolic-ref HEAD` | 记录现有未跟踪方案、完整 HEAD 和分支；没有修改 Git refs |
| 3 | `python tools/repo_registry.py get root` | `status=ok`，`repo_status=present`；工具当前未输出 `repo_url`，直接核对 YAML 中已存在的值 |
| 4 | `multica repo checkout --help` | 有原生 checkout 入口和 `--ref`；帮助声明使用 Daemon bare cache / worktree，并说明普通重入保留脏树、未跟踪文件、未推送提交或当前 Task 分支。这是 CLI 契约，尚未实测 |
| 5 | `multica workspace list --output json` | 找到用户指定 `rondo-test`；未修改默认 Workspace |
| 6 | `multica project list --workspace-id 60eb8cf4-31be-4a34-b744-8ef6a0bcf15d --output json` | 存在指定 Project |
| 7 | `multica project resource list d43bbc9d-4cc2-4cee-8f92-70c993ffbf97 --workspace-id 60eb8cf4-31be-4a34-b744-8ef6a0bcf15d --output json` | exit 0，原始 JSON 为 `[]`；尚无 Git Resource，URL / ref 也未配置 |
| 8 | `multica agent list --workspace-id 60eb8cf4-31be-4a34-b744-8ef6a0bcf15d --output json` | 空列表；Wayfinder、Analyst、Engineer、Bug Fix Agent 的实际关联均无从验收 |
| 9 | `multica issue list --project d43bbc9d-4cc2-4cee-8f92-70c993ffbf97 --workspace-id 60eb8cf4-31be-4a34-b744-8ef6a0bcf15d --fields id,identifier,title,status,project_id,assignee_id --output json` | `issues=[]`、`total=0`、`has_more=false`；没有测试 Issue / Run |
| 10 | `multica runtime list --workspace-id 60eb8cf4-31be-4a34-b744-8ef6a0bcf15d --output json`、`multica daemon status --output json` | Runtime、Daemon 版本及归属如上；Runtime metadata 宣告 `local-worktree-v1`、`checkout-keeps-work-v1`，不能代替真实执行 |
| 11 | 设置仅对子进程生效的非交互选项后，`git -c credential.interactive=never ls-remote --symref <root.repo_url> HEAD refs/heads/master refs/heads/rondo` | 前置两次 exit 0 且 refs 一致；真实 Run 后又回读一次，`rondo` 已被另一提交推进，见下表。普通终端读取成功不证明 Task / Daemon 可认证 |
| 12 | 读取 `runtime-paths.ts`、`runtime/resolve-root-repo.ts` 当前源码 | 默认仍仅解析 `local_directory(in_place)`；属于计划 §5 已知实现差异，不判为原生 checkout 机制 FAIL |

TFS 根仓身份：`WN_Data_Platform / DP-01-数据仓库 / winning-platform-monorepo`。

| 远端 ref | Run 前完整 Commit | Run 后回读完整 Commit |
| --- | --- | --- |
| `HEAD` → `refs/heads/master` | `bb13f482ff7a3c01936f596942dd7d36cc6ece86` | 相同 |
| `refs/heads/master` | `bb13f482ff7a3c01936f596942dd7d36cc6ece86` | 相同 |
| `refs/heads/rondo` | `4765e6d807d6de52ca5b0f7c70060ffcccc0c446` | `21e3c1688846d8fe6c9918c824a992416393874d` |

TFS Commit API 4.0 只读核对返回 HTTP 200：新提交父节点为上述旧 `rondo` SHA，说明为“提交会话分析记录”，提交时间 `2026-11-13T02:30:53Z`。本测试无 Git Push / Git REST 写请求，也没有执行 Commit；不归因于具体外部操作者，不宣称远端所有 refs 前后不变。该变化不改变本次请求超时的事实，但复验必须重新记录基线。本地控制端 HEAD 和分支始终不变。

## TEST-2 首次真实 Task 验证（保留历史）

用户指定 `rondo-test / winning-platform-monorepo / lileipc codex`，并明确回复“授权按准备单创建并执行”。仅创建 [准备单](M01-run-request.md) 中的隔离测试对象：

| 对象 | 实际记录 |
| --- | --- |
| Resource | `eee149cc-9c37-415c-a1d8-b0c3b3b56585`；`github_repo`；registry 根仓 URL；`ref=rondo` |
| 私有 Agent | `9915af88-b5ce-42c2-9c3b-227d768c5bc0` / `M01 checkout 验证器`；并发 1；未覆写模型或注入凭据 |
| Issue | `TEST-2` / `01a1d2bd-5780-7a2e-a75a-d5bc7b6d8134` |
| Run / Task | `01a1d2bd-578c-713c-ba66-457a3869580e` |
| 平台 Run 生命周期 | `10:29:46` → `10:39:32`，Asia/Shanghai；最终 `completed`，`attempt=1`，只有一个 Run；平台运行完成不等于机制验证通过 |
| Task 工作目录 | `C:\Users\lilei\multica_workspaces\rondo-test-8ef6a0bcf15d\test-2-457a3869580e\workdir` |
| 测试交付 | 一个最终评论 `01a1d2c6-0074-79b0-8e38-7deb9f11365a` 与一个脱敏 JSON 附件；测试 Issue 状态保留 `todo` |

实际创建命令：`multica project resource add <project> --type github_repo --url <root.repo_url> --ref rondo`；`multica agent create --runtime-id <上述Runtime> --permission-mode private --max-concurrent-tasks 1 ...`；`multica issue create --project <project> --assignee-id <上述Agent> --status todo --description-file M01-run-request.md ...`。均显式携带测试 Workspace ID；创建前后回读，无重复创建。

Task 原始脱敏证据已原样复制为 [M01-task-evidence.json](M01-task-evidence.json)，与源文件 SHA-256 一致：`e35bfd354932689adaa5c305a84ce4012e0f47920525b302fd5bd670c3de43d1`。[控制端证据](M01-controller-evidence.json)另保存 Run 最终状态、Daemon 日志摘录、远端 refs 与同期提交记录。

| 检查 | 结果 | 实测证据 |
| --- | --- | --- |
| Task 身份与隔离目录 | PASS | Task marker 与 Issue / Agent 相符；Run ID = Task ID；cwd 和父目录非 reparse point，无已有 Git 工作树 |
| Project Resource 注入 | PASS | `.multica/project/resources.json` 中 Project ID、唯一 Resource ID / 类型、URL / ref 与授权对象一致；控制端另行只读回读确认 |
| 自动 checkout 观察 | 未观察到 | 调用前仅 `.agent_context`、`.multica`、`AGENTS.md`；没有根仓目录，不能推广为所有 Runtime 均不自动 checkout |
| 首次显式 checkout | **FAIL** | 从真实 Task cwd 执行 `multica repo checkout <root.repo_url> --ref rondo`，只调用一次；`10:31:49.300` → `10:36:49.610`，约 **300.31 秒**；exit **1**；`connect to daemon: context deadline exceeded` |
| 返回路径与 Git 身份 | NOT_RUN | 未返回仓库路径，失败后仍无 `winning-platform-monorepo`；未执行仓内 top-level / HEAD / origin / status 核验 |
| 同 Task 重入 | NOT_RUN | 首次未建立 checkout，故未调用第二次；不得把第二次重试混称为重入验收 |
| 脏树、未推送提交、双 Run 隔离、四类业务 Agent | NOT_RUN | 本轮未构造这些场景 |
| 失败后 Daemon | PASS（健康探测） | 前后 `daemon status` 均正常，Daemon ID / PID 不变；不足以证明 checkout 后端流程正常 |

### 控制端补充日志与源码证据

本机 `C:\Users\lilei\.multica\daemon.log` 在 `10:29:42.380` 记录该 Workspace 的 `repo cache: cloning`，目标是其私有 cache 路径。随后 Task 启动；Agent 发起 checkout 时仍未产生本地根仓。控制端于 `10:36` 左右只读观察到 cache 内 `tmp_pack_IL2yJs`，12,513,365 bytes，最后写入时间 `10:30:03.775`；这仅证明留下了未完成准备的现场，不证明已完成 Git 认证或 clone。

源码核对固定在部署 CLI 的完整 Commit `b1ea927def6490c43bedff537b6f4ed9a47fa828`：

- [cmd_repo.go](https://github.com/multica-ai/multica/blob/b1ea927def6490c43bedff537b6f4ed9a47fa828/server/cmd/multica/cmd_repo.go) 的 `runRepoCheckout` 使用 5 分钟请求 context，并支持 repo-busy 等待。blob SHA：`87364368468c147aec406501dd4e138251363a26`。
- [cache.go](https://github.com/multica-ai/multica/blob/b1ea927def6490c43bedff537b6f4ed9a47fa828/server/internal/daemon/repocache/cache.go) 的 Git 操作超时常量为 10 分钟，远程 Git 子进程禁用终端和 GCM 交互。blob SHA：`c391abe152d49fad728a594b05d79081d257ccbd`。

**可确认的失败类型是 CLI→Daemon checkout 请求超时**。冷 cache 准备或等待可作为排查方向；尚无足够证据区分 cache 锁等待、TFS 数据传输、Git 子进程停滞或其他后端原因。没有返回 URL 校验、Git authentication 或路径 permission-denied 错误，也不能反向推定这些环节已通过。

### 连接异常与恢复

首次沙箱内 `runtime list` / `project list` 返回 `Could not reach the Multica server`，同一沙箱内 `daemon status` 为 `stopped`。经允许的沙箱外只读查询后，服务器可访问，Daemon 实际为 `running`。不把沙箱可见性问题记为 Multica 停机或 TFS checkout FAIL。

用户明确目标前，曾只读检查默认 Workspace 和已存在的 `TFS Git 原生资源验证 20261113` Workspace。后者有另一个正在运行的测试；未向其发消息、未修改、未触发或取消 Run，其结果不计入本次目标验收。

控制端准备期间有一次 PowerShell 变量误用 `$PID`，在只读 Resource 预检阶段终止，尚未执行创建；改用任务专属变量并重新回读空列表后才创建。`project workflow get` 另返回资源不存在，未因此改变 Workflow。Task 内首次 PowerShell profile 有权限告警，但 Issue 读取 exit 0，后续使用 `login:false`；未修改执行策略。上述异常均与最终 checkout 超时分别记录。

## 验收核对

- [x] 已核对目标 Workspace / Project / Runtime / Daemon / Task，以及设计基线。
- [x] 真实 Task 中的 Resource 注入已通过；已观察自动 checkout 状态并执行显式 checkout。
- [x] 原生 cache 就绪后，TEST-3 首次 checkout 成功。
- [x] 实际 checkout 路径、Git top-level / origin / HEAD 与原生 Git 非交互访问核对通过。
- [x] 同一 Task 重复普通 checkout 保留路径、分支、HEAD 和干净状态；脏树 / 未推送提交保留未构造。
- [ ] 不同测试 Run 的隔离行为（具备相应测试 Run 时）。
- [x] 仅进行已授权的测试对象创建、TEST-2 一次调用、TEST-3 两次调用，以及测试证据评论 / 附件；未改生产记录，未 push、commit、reset、clean、fresh、手工 clone 或重启 Daemon。
- [x] 保留两次测试的对象、Task 目录及平台管理的 cache；复验按用户后续明确授权执行，未擅自清理或额外重跑。
- [x] 已区分静态证据与真实 Runtime 证据；未执行项保持 `NOT_RUN`。

## 结论与设计决策

**M01 原生 checkout 机制 PASS，限当前 Windows / Codex Runtime 的 cache 就绪场景**。TEST-2 的请求超时源于原生冷 cache 准备尚未结束而 CLI 请求预算先耗尽；不能据此判原生机制不兼容 TFS。原始 Task JSON 与测试评论保留当时的调用结果。

本次通过等待平台自身的 cache 准备完成解除阻塞，没有改写 cache、修改凭据、重启 Daemon 或修改产品源码。冷 cache 首次准备可能超过 CLI 5 分钟预算的限制仍存在，**未修复或验收冷启动时限保障**；后续应将 cache 就绪检查与有界等待纳入运行策略，或独立评审上游超时适配，不据此次 PASS 宣称已具备该能力。详见 [超时定位记录](M01-timeout-analysis.md)。

Rondo 适配、完整 V05 的四类业务 Agent、脏树 / 未推送提交保留、双 Run 成功 checkout 隔离和 M02–M12 均不由此次复验自动推定通过。本轮到 M01 结束。

## TEST-3 复验结果

用户明确授权定位后复验，执行内容见 [复验执行单](M01-retest-request.md)。复用原 Project / Resource / Agent / Runtime，不修改生产配置。

| 项目 | 实测结果 |
| --- | --- |
| Issue / Run | `TEST-3` / `01a1d2d3-4c41-78de-9926-f0555e951ad9`；Run `01a1d2d3-4c67-729c-bcf3-0fa1f4f4c34a` |
| Run 生命周期 | `10:53:45` → `11:00:06`，Asia/Shanghai；最终 `completed`；`attempt=1` |
| 首次调用 | `10:56:21.271` → `10:56:38.574`；**17.303253 秒，exit 0** |
| 同 Task 第二次调用 | `10:57:59.514` → `10:58:04.784`；**5.269805 秒，exit 0**；CLI 明确返回 `Kept the existing checkout` |
| 两次调用命令 / cwd | 相同：`multica repo checkout <root.repo_url> --ref rondo`，从该 Task 的 `workdir` 调用 |
| 实际根仓 | `C:\Users\lilei\multica_workspaces\rondo-test-8ef6a0bcf15d\test-3-0fa1f4f4c34a\workdir\winning-platform-monorepo` |
| 两次分支 | `agent/m01-checkout/0fa1f4f4c34a`，保持不变 |
| 两次 HEAD / origin/rondo | `9bc060aaa4916887e394883705d04365753f258b`，保持不变 |
| origin | 与授权根仓 TFS URL 一致；无单独 pushurl |
| Git 元数据 | `.git` 是 Task 仓内独立目录；`git_common_dir=.git`；无 objects alternates。实际模式是 `isolated`，不能仅凭 CLI 帮助假定为共享 `.git` 的 worktree |
| 工作树 / 重入 | 两次 `status --porcelain` 均为空；路径、分支、HEAD 均不变；CLI 记录 0 uncommitted files、0 unpushed commits，仅 fetch remote refs |
| 原生 fetch 警告 | 两次输出均无 fetch-failed / cached-copy warning |

Task 证据的对比断言全部为 true；控制端在 Run 完成后另行只读核对 Git top-level、HEAD、分支、status 和 common-dir，与 Task 证据一致。[复验控制端证据](M01-retest-controller-evidence.json)保存最终 Run 状态、cache 检查、时间线、源码身份与 refs 变化。

证据：[M01-retest-evidence.json](M01-retest-evidence.json)。Task 原文件 SHA-256 为 `71128de0977dbcab7dbcea988739db0c19f72cd9b93d076ce88d0b941cfc5bb4`；工作区副本把 5 处 Daemon 端口值替换为存在性标记，并增加副本说明，其余证据不变。TEST-3 保留一个最终评论 `01a1d2d8-dba4-713c-88f8-742a7ad82254` 和附件 `01a1d2d8-db6e-735c-82ef-9605238c7b91`；Issue 状态未人为变更。

### 额外查询异常与并发 ref 变化

Task 内补充的直接 `git ls-remote --heads origin ...` 返回 exit 128 / `Empty reply from server`，已在 Task 证据单独记录。它不是两次成功的原生 checkout 请求；未将它伪报成功，也未因它再次否定原生 checkout。控制端稍后对同一 TFS URL 直接只读回查 exit 0，确认当前 `rondo` 与 checkout SHA 相同；Task 直接访问异常的具体原因未进一步定位。

| ref | 复验前控制端记录 | 复验后控制端回读 |
| --- | --- | --- |
| `rondo` | `21e3c1688846d8fe6c9918c824a992416393874d` | `9bc060aaa4916887e394883705d04365753f258b` |
| `master` / 远端默认 HEAD | `bb13f482ff7a3c01936f596942dd7d36cc6ece86` | `d47f9c1d494c2de323416332c25e9bbcfa0cc321` |

TFS API 4.0 对两个新 Commit 均返回 HTTP 200：`9bc060aa…` 为 `analysis: remove-sass-dependencies-264407 (ROND-12 / tfs 264407)`，时间 `10:55:45`；`d47f9c1…` 为“同步忽略文件”，时间 `10:59:12`。本轮无远端 Git 写请求，故只记录并发进展，不声称所有 refs 未变，不将 Issue 中较早的 `rondo` SHA 冒充实际 checkout SHA。控制端本地最终 HEAD 为 `21e3c1688846d8fe6c9918c824a992416393874d`，分支 `rondo`；未覆盖其他任务的本地变化。
