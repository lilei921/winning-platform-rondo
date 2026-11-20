# M02 修复后独立 Run 生命周期验证

用户已授权 M02 修复后连续重验。本 Task 使用 rondo-test、Project winning-platform-monorepo、Runtime Codex (lileipc)；Git Resource main。只操作当前 Task 自己的目录，不读取或修改 TEST-7 目录，控制端单独比较其 before/after。

根仓 URL：http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_git/winning-platform-monorepo。

1. 记录 Task/Runtime/Daemon 身份、MULTICA_TOKEN/DAEMON_PORT 存在性（不输出值）、有效 sandbox_mode/approval_policy/windows.sandbox。必须仍为 workspace-write/never/mxc。
2. 原生 multica repo checkout <根仓URL> --ref main；记录路径、完整 HEAD、分支、.git/common-dir、origin、status。不得 fresh 或手工 clone 根仓。root 必须位于当前 Task，不能等于 TEST-7 的 test-7-96ff82e8f4e9/workdir/winning-platform-monorepo。
3. 读取当前根仓 registry 的 common.repo_path/.repo_url；确认初次 checkout 不含 child。再次原生普通 checkout 后仍不含 child，root 身份/状态保持。记录“新 Run 不会自动迁移上一个 Run 的子仓”。
4. 在本 Task validation-fixture 下自主创建 seed 和 bare（命令级 user.name/email，只提交本地标记），并 clone 到 root/<common.repo_path>。Git 调用必须显式使用 C:\Users\lilei\.multica\tools\mingit-busybox-2.54.0\cmd\git.exe，为该 Git 子进程 env.PATH 前置该便携 cmd 与 mingw64/bin；不修改系统/Task/Daemon PATH，不伪造 MULTICA 变量。配套 sh.exe 与 busybox.exe 必须同 Hash ab90c8f11cb814b8915f07d4ad2a0b910f5ba82a8aec9a575eb393c0ec29cc32。先 sh.exe -c 'exit 0'，clone 开启仅本地路径 GIT_TRACE；不请求提权，不让控制端代建 fixture。
5. 校验 child 独立 .git/top-level/common-dir、origin 本地 bare、HEAD 与 seed 一致，根仓既有 ignore 命中且 root status 为空。保留现场，不访问真实业务 Git origin，不远端 Push。
6. 证据写在 workdir/validation-evidence/M02-independent-evidence.json 和 report.md，包含命令时间/cwd/argv/exit/脱敏输出、assertions、root/child 身份、trace。根仓不得创建 Commit。只给实际证据支持的状态，Rondo dev prepare 仍 NOT_RUN。

严禁生产 Git/PR/Work Item/Issue Metadata 变更，不重启 Daemon，不改 Agent/Skill，不自行创建额外 Run，不发布额外评论。
