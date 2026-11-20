# M01 / M02 全量重新验证：Run A2

2026-11-13 用户要求：旧结果不可靠，M01 也全部重验；无问题时连续推进 M01、M02，不逐项停顿。此 Issue 是该授权测试的一部分。只在当前真实 Multica Task 的隔离 workdir 执行，不使用或改动 D:\UserProgram\winning-platform-monorepo 的工作树。

## 身份和范围

- Workspace：rondo-test / 60eb8cf4-31be-4a34-b744-8ef6a0bcf15d。
- Project：winning-platform-monorepo / d43bbc9d-4cc2-4cee-8f92-70c993ffbf97。
- Runtime：Codex (lileipc) / c55feddd-7910-480a-8f9f-9d6180b1f061；Daemon：01a01965-2f6a-72fe-899f-3e7556c5d51d。
- Git Resource：eee149cc-9c37-415c-a1d8-b0c3b3b56585，github_repo，当前 ref=main。不得沿用旧报告的 rondo。
- 根仓 URL：http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_git/winning-platform-monorepo。
- 控制端刚回读 main=dfdaf33fa58355332259524266045d1052ef9dea；浮动分支可能变化，必须以本次实际返回和 origin/main 核对。
- M02 只使用本 Task 内新建的本地一次性 Git fixture。业务测试路径使用本 Task 根仓 registry 的 common.repo_path，预计 winning-dps-df-common；真实 common.repo_url 仅只读记录，不访问、不 Push。fixture origin 明确标为本地测试身份，不能冒称真实业务仓认证通过。

## 执行与证据

证据放在 Task workdir 下的 validation-evidence/，不要放在根仓。逐步保存 M01-M02-run-A2-evidence.json 和简洁报告；每条命令记录 cwd、argv（脱敏）、开始/结束时间、exit code、stdout/stderr，文件证据使用 SHA-256。凭据只保存是否存在，不保存 Token、端口值、原始 env、credentials 或含用户信息 URL。不要加载旧 M01 结果作为证据。

1. 核对 Task marker、当前 cwd、Task/Issue/Agent/Runtime/Daemon 身份与 Resource manifest。仅记录 MULTICA_TOKEN、MULTICA_DAEMON_PORT 是否存在。确认目录无 reparse point，原生根仓调用前是否已存在；记录 CLI、Git、Rondo 版本。当前若非真实 Task 或身份不符，停止 NOT_RUN。
2. 在 Task cwd 执行 multica repo checkout <根仓URL> --ref main；不使用 --fresh，不手工 clone 根仓，不改变 cache。记录实际返回路径以及 git -C <root> rev-parse --show-toplevel、HEAD、branch --show-current、status --porcelain=v1 --untracked-files=all、脱敏 origin、origin/main、.git 类型和 common-dir。成功且身份吻合才继续。
3. 在相同 cwd 再执行普通 checkout，比较路径、HEAD、分支、status；保留完整原生命令结果。若存在 cached/fetch warning，单列记录，不隐去。
4. M01 脏树重入：在此可废弃 root 中选择一个已有跟踪文本文件（优先 README.md），将原始字节备份到 validation-evidence；追加唯一测试标记，并新增一个根仓未跟踪测试文件，记录各自 Hash、git diff 和 status。再执行同一普通 checkout，验证跟踪改动和未跟踪文件的内容、HEAD、分支、路径均保留。然后仅恢复自己备份的原始字节、删除自己创建的单个标记文件（路径必须验证位于本 Task root），不用 reset/checkout/clean。确认根仓 status 恢复原基线。不得创建根仓 Commit。M01 任一必需项不满足则保存结果并停止，不进行 M02。
5. M02 开始前读取当前 root 的 .gitignore 和 docs/config/repo-context.yaml，记录 common 的 repo_id/repo_path/repo_url。校验业务目标是 root 的直接子目录且不存在，git check-ignore -v <repo_path>/probe.txt 证明被既有规则忽略；不得修改 .gitignore 或 registry。规则不满足时停止并报告。
6. 仅在 Task workdir 的 validation-fixture/ 建立一个 seed Git 仓和一个本地 bare remote，内容只含标记 README.txt，允许此本地 fixture 的初始 Commit（命令级 user.name/user.email，不写全局配置）。将该本地 bare remote clone 到 root/<common.repo_path>，不使用真实 TFS origin，不注册第二个 Project Resource。该 clone 用于二级业务仓实验，不是绕过根仓原生 checkout。
7. 分别记录 root 和 child 的 Git top-level、.git 类型、common-dir、脱敏 origin、完整 HEAD、status。child 新建唯一未跟踪标记文件，并修改 fixture 的 README.txt，记录 Hash。确认 root status 与创建 child 前完全一致、root git ls-files 不含 child 内容，记录 git check-ignore 输出。
8. 再从相同 Task cwd 执行根仓普通 checkout，验证 root、child 的路径、HEAD、分支、origin、tracked/untracked 修改和 Hash 都保留，root status 不出现 child 源码。此步骤完成后保留 child 修改和 fixture，供下一独立 Run 的只读隔离核对；不得清理或改动平台 cache。
9. 输出机器可读 assertions、M01 和 M02 的独立状态。M02 同 Task 已覆盖，跨 Run 部分明确 NOT_RUN / pending controller Run B，不能提前总判 PASS。M01 未推送 Commit、冷 cache 从零准备、四类业务 Agent 未覆盖时逐条说明。最终回复证据绝对路径和 Hash，以及 root/child 路径、HEAD、标记 Hash，控制端会独立回读并启动 Run B。

禁止远程 Git 写入、Push、PR、TFS Work Item 修改、生产 Issue/Metadata/Assignment 修改、配置/Skill/Agent 指令变更、重启 Daemon、fresh/reset/clean、修改已有 Task 或其他人的目录。除本测试 Issue 的一次最终结果交付外不发布评论，不触发其他 Agent，不自行创建新 Run。命令失败保留现场，区分认证、网络、URL 校验、Daemon 超时；不要凭猜测修复或无限重试。

## 本轮恢复依据

TEST-4 的首次调用因后台 cache clone 在 11:33:06 连接 TFS 8080 失败而未取得根仓。11:37 代理路径、11:38 直连的只读 git ls-remote 均恢复成功，main SHA 未变。控制端按用户连续重验授权发起本次独立 Task，仅一次有界恢复测试；不得复用 TEST-4 结论。本 Task 会由平台原生注册流程重新触发 cache 同步，不得手工填充 cache。

先观察原生后台准备状态；冷启动同步可能耗时。可只读观察本 Task 的原生 cache 是否完成准备，给后台最多 10 分钟；每次等待不超过 30 秒，并记录开始/结束、是否在同步、日志或 Git bare 状态证据。只读查看此 workspace 此根仓的 cache，不改写。如准备失败立即保存具体错误，不要提前把等待时间当成 checkout 失败。cache 就绪后执行上述原生首次 checkout。若无法确认准备状态，只执行一次正常 checkout 并记录实际结果，不使用 fresh 或手工 clone 绕过。
