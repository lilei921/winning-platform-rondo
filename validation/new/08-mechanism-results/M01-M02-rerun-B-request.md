# M01 / M02 全量重新验证：独立 Run B

用户已授权在 rondo-test / winning-platform-monorepo / Codex (lileipc) 连续重验 M01、M02。本 Run 验证不同 Task 工作目录隔离和嵌套子仓生命周期，只操作自己的新 Task。控制端负责 A2 现场的只读前后核对。证据不得沿用旧 TEST-2/TEST-3。

## 固定身份

- Workspace：60eb8cf4-31be-4a34-b744-8ef6a0bcf15d；Project：d43bbc9d-4cc2-4cee-8f92-70c993ffbf97。
- Runtime：c55feddd-7910-480a-8f9f-9d6180b1f061；Daemon：01a01965-2f6a-72fe-899f-3e7556c5d51d。
- Resource：eee149cc-9c37-415c-a1d8-b0c3b3b56585，github_repo，ref=main。
- 根仓 URL：http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_git/winning-platform-monorepo。
- Run A2：TEST-5，Task 01a1d2fc-da3a-796b-9584-f8f23e188c07。
- A2 workdir：C:\Users\lilei\multica_workspaces\rondo-test-8ef6a0bcf15d\test-5-f8f23e188c07\workdir。
- A2 的 root 为上述 workdir/winning-platform-monorepo，child 为 root/winning-dps-df-common；root HEAD=dfdaf33fa58355332259524266045d1052ef9dea，fixture HEAD=828d42779530b781c4b65bc0e1a6ad7b811eb0a8。A2 的本地 clone 因 MSYS 沙箱权限失败，由控制端提供 fixture 后再由真实 Task 验证重入；本轮不重复 clone 或声称该限制已修复。

## 顺序执行

1. 在本 Task 的 validation-evidence/ 保存 M01-M02-run-B-evidence.json 及简洁报告。每条命令记录 cwd、argv、时间、退出码、脱敏 stdout/stderr。只记录凭据存在性，不记录 Token、Daemon 端口值、原始环境或凭据 URL。核对本 Task/Issue/Agent/Runtime/Daemon/Resource；目录必须不同于 A2，且无 reparse point。没有真实 Task 或身份不符就停止。
2. 记录 A2 身份作为比较对象；控制端已经独立读取其 root/child 的 top-level、HEAD、branch、origin、common-dir、status 及 tracked/untracked marker Hash，运行完成后会再次核对。你不要访问或修改 A2 的目录。
3. 记录本 Task 初始目录是否已有根仓。由本 Task cwd 执行 multica repo checkout <URL> --ref main，记录返回的实际路径；不得 --fresh 或手工 clone 根仓。核对 root 的 Git top-level、完整 HEAD、origin/main、分支、脱敏 origin、.git/common-dir、status，确认与 A2 不共享工作树或 Git common-dir。
4. 从本轮根仓 registry 读取 common.repo_path，确认子路径安全；在进行任何业务 clone 前检查此子目录是否自动存在，记录 A2 的脏修改/标记是否自动出现。如果不存在，明确记录：新 Task 原生根仓未带回本机未发布的嵌套子仓。
5. 记录 B 的目录与 Git 身份、git check-ignore 命中的原有规则以及 git ls-files 不含 child 内容。再从相同 B Task cwd 重复普通 root checkout，检查 root 身份和干净状态是否保留、child 是否依然不存在。不得在 B 创建或 clone child；子仓重新 prepare 不属于本轮新增验证范围。
6. 输出机器可读逐项 assertions 以及独立结论：M01 跨 Run 隔离、M02 新 Task 子仓是否自动出现。A2 现场完整性由控制端另行验证，未完成前不能自行宣称全量 M02 PASS。说明未发布改动不会自动跨 Task 搬迁，Rondo dev prepare 命令、跨机器和真实业务认证仍未验收，A2 的沙箱自主 clone 失败仍保留。最终交付只在本测试 Issue，注明证据绝对路径及 SHA-256。

禁止 Push、远端 Git 写入、PR、TFS Work Item 修改、生产记录/配置/Agent/Skill 变更、fresh/reset/clean、cache 填充或删除、重启 Daemon、额外 Run。普通 PowerShell 不可冒充 Task。失败保留现场并如实区分机制失败与前置条件缺失，不无限重试。
