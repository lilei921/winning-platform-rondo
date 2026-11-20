# M01 专用测试准备单（已获授权）

仅服务于 [M01](M01.md)，不是 08 的实施任务。2026-11-13 用户明确回复“授权按准备单创建并执行”。授权前 Project 无 Resource、Workspace 无 Agent、Project 无 Issue；实际创建结果和执行证据以 M01 报告为准。

## 拟新增资源

| 对象 | 精确范围 |
| --- | --- |
| Workspace | `rondo-test` / `60eb8cf4-31be-4a34-b744-8ef6a0bcf15d` |
| Project | `winning-platform-monorepo` / `d43bbc9d-4cc2-4cee-8f92-70c993ffbf97` |
| Git Resource | 仅一个根仓；`resource_type=github_repo`；URL 为下列 registry 原值；`ref=rondo` |
| Runtime | `Codex (lileipc)` / `c55feddd-7910-480a-8f9f-9d6180b1f061`，本机当前 Daemon `01a01965-2f6a-72fe-899f-3e7556c5d51d` |
| 测试 Agent | 新建私有 `M01 checkout 验证器`，并发 1，使用 Runtime 默认模型和权限；不附加生产交付 Skill 或自定义凭据 |
| 测试 Issue / Run | 新建 `[M01] TFS 原生 checkout 与重入验证`，关联上述 Project，只指派该验证器；只主动启动一次，不主动重跑；平台内置重试如有发生须记录 |
| 保留与清理 | 保留测试 Issue、Run 日志、Resource 和 checkout 供复核；不自行删除 cache / worktree，不删除原有资源；是否复用或清理由后续明确决定 |

无凭据 URL：

```text
http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_git/winning-platform-monorepo
```

选择 `rondo` 只用于本次 checkout ref 验证；不改变远端默认分支 `master`，不认定它是 08 的权威发布分支。普通终端已只读核验该 ref 存在，HEAD 为 `4765e6d807d6de52ca5b0f7c70060ffcccc0c446`。

## 测试 Agent Instruction 草案

你是隔离测试环境中的 Git checkout 机制验证器。仅执行所分配 Issue 的验证步骤，收集可复核、脱敏的证据。只允许在当前真实 Task 的工作目录使用 Multica 原生 checkout；不修改生产交付事实或凭据配置。前置条件缺失时返回 NOT_RUN；实际命令失败时记录退出码、错误类别和保留下来的状态，不通过 reset、clean、fresh 或手工 clone 绕过问题。

## 测试 Issue 内容草案

本次仅验证 M01：真实 Multica Task 内的 TFS 根仓 Resource 注入、原生 checkout 和同 Task 重入。目标只限上述 Workspace、Project、Runtime、根仓 URL 与 `rondo` ref。

1. 记录真实 Run / Task ID、Runtime / Daemon 身份、当前工作目录和 CLI / Git 版本。对 `MULTICA_TOKEN`、`MULTICA_DAEMON_PORT` 仅记录是否存在，不打印值。确认目录属于本 Task、可废弃，不是用户的共享在研工作树；否则停止。
2. 检查 Task 注入的 Project / Resource manifest，仅输出 Project ID、resource_type、去凭据 URL、ref。记录调用前根仓是否已经存在；不得仅根据 Resource 存在就声称自动 checkout。
3. 若已自动检出，先采集其身份和状态；若未检出，从 Task 工作目录显式执行 `multica repo checkout <已核对的根仓URL> --ref rondo`。不得从用户主工作区执行。记录退出码、脱敏错误和返回的实际路径，不手工 clone、不使用 `--fresh`。
4. 对实际返回路径执行 `git rev-parse --show-toplevel`、`git rev-parse HEAD`、`git branch --show-current`、`git status --porcelain`，读取并脱敏 origin；确认仓库身份和 ref 基线。只要使用了合法 Task 临时分支，就不能因分支名不是 rondo 判失败。
5. 在同一 Task 的同一调用目录再次执行相同普通 checkout。对比路径、HEAD、分支、status，核实是否重入及既有内容是否保留。不创建、修改跟踪文件，不引入提交。本次不伪造未提交修改来扩大写入范围。
6. 失败时分别判断 URL 校验、Git 认证、Daemon 网络或 Task 路径权限错误；不能从普通终端结果推定 Task 结果。不得添加凭据、变更 Git helper、重启 Daemon、修改 Project Resource 或换工作区重试。
7. 输出环境、实际命令、脱敏证据、PASS / FAIL / NOT_RUN、限制及最小建议。通过 Run 最终输出返回证据，不追加生产评论、状态、Metadata 或工时，不触发其他 Agent。

本次允许的持久化副作用仅为测试资源创建、平台自身的该测试 Run 生命周期，以及原生 checkout 所需的 Task 目录 / Daemon Git cache。不得 push、创建或合并 PR、修改 TFS Work Item、改生产 Issue 或生产 Agent。双 Run 隔离、脏树 / 未推送提交保留和四类业务 Agent 覆盖若未实际执行，须明确未验收。
