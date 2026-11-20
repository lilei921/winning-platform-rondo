# TEST-7 最小调用方式修正与继续验证

控制端已定位真实原因：当前部署 Multica 的 daemon.go/isBlockedEnvKey 明确忽略 custom_env.PATH。控制端正在撤回无效 PATH 配置；该阻止不应被写成工具包安装失败。保留初次 preflight FAIL 的原始证据，另存为 M02-autonomous-preflight-evidence.json / preflight-report.md 后继续本次 Task。不要丢弃或覆盖历史失败。

用户已授权修复 MSYS 并在真实 Runtime 内自主 clone。请将原 Issue 第 1 步“Get-Command 必须指向便携 Git，否则停止”替换为以下调用约定：

- Task 的默认 Git 不变，记录其解析路径。对于本次验证的 Git 子进程，显式执行 C:\Users\lilei\.multica\tools\mingit-busybox-2.54.0\cmd\git.exe；在 subprocess env 的 PATH 前置该工具的 cmd 和 mingw64\bin，仅作用于该子进程及其子进程。
- 例如 Python subprocess.run([absolute_git, ...], env={**os.environ, 'PATH': portable_cmd + os.pathsep + portable_bin + os.pathsep + os.environ.get('PATH','')}, ...)。这只是选用特定 Git/shell 工具组合，不改系统 PATH、Task/Daemon 配置、沙箱或 ACL，不设置/伪造 MULTICA 变量。
- 必须先验证 sh.exe/busybox.exe Hash 都为 ab90c8f11cb814b8915f07d4ad2a0b910f5ba82a8aec9a575eb393c0ec29cc32，并在同样子进程环境调用 sh.exe -c 'exit 0' 实测 exit 0。保留 GIT_TRACE，证明 clone 使用便携目录 sh.exe 和 git-upload-pack。
- multica repo checkout 仍使用平台注入的真实 CLI 与原 Task 环境，不使用该 Git 调用方式手工替代原生根仓 checkout。

按原 Issue 的步骤 2–7 自主完成 seed、bare、child 两次普通 clone、二级仓忽略/身份校验、child 脏修改、原生 root 重入与 Hash 核对。不得请求提权或让控制端代建 fixture。初次 preflight 失败和最终受控工具调用结果分别记录；effective sandbox 必须仍是 workspace-write + never + mxc。

最终 M02-autonomous-evidence.json / M02-autonomous-report.md 写明这是“显式兼容 Git 子进程调用”的修复，不是默认 PATH 已修复，也不是 Rondo dev prepare 已实现。保留所有 fixture 给下一独立 Run 核对。
