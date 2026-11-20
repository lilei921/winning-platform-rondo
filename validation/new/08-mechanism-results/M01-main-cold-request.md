# M01 main 分支冷 cache 复验

用户已将 Project Resource ref 切换为 main，并授权清理之前的测试数据后重新验证，比较新分支是否准备得更快。控制端负责在启动本 Run 前将该测试 Workspace 的旧 cache 和 TEST-2 / TEST-3 工作目录移出活动路径，保留历史证据；不要在 Task 内自行删除任何 cache。

## 固定范围

- Workspace：`rondo-test` / `60eb8cf4-31be-4a34-b744-8ef6a0bcf15d`。
- Project：`winning-platform-monorepo` / `d43bbc9d-4cc2-4cee-8f92-70c993ffbf97`。
- Resource：`eee149cc-9c37-415c-a1d8-b0c3b3b56585`，`github_repo`，**ref=main**。
- Agent：`9915af88-b5ce-42c2-9c3b-227d768c5bc0`；Runtime：`c55feddd-7910-480a-8f9f-9d6180b1f061`；Daemon：`01a01965-2f6a-72fe-899f-3e7556c5d51d`。
- 无凭据 URL：`http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_git/winning-platform-monorepo`。
- 控制端前置记录：main=`dfdaf33fa58355332259524266045d1052ef9dea`；rondo=`9bc060aaa4916887e394883705d04365753f258b`；master/默认 HEAD=`f77b9d050426f54d136424591697a018e56f1494`。浮动分支若有推进，记录实际 SHA，不伪装成固定版本。

## 测试步骤

1. 先读 Issue；核对真实 Task marker、当前工作目录、Resource 的 Project/URL/ref，以及 Token / Daemon Port 是否存在。**Token 和 Port 只记录存在性，不记录值。** 确认是本 Task 独立目录后，尽早发起第一次 checkout；完整的平台身份查询和版本信息可在调用后补齐，避免长时间前置整理把冷准备变成热 cache 试验。
2. 从 Task 工作目录执行 `multica repo checkout <上述URL> --ref main`。记录 Task 启动时间、调用起止时间、耗时、exit code、脱敏 stdout/stderr和实际返回路径。不得使用 --fresh、手工 clone、shallow clone 或改超时参数。
3. 若第一次成功，采集 Git top-level、HEAD、当前分支、status、脱敏 origin、origin/main、.git 类型和 git common-dir；再从同一调用目录重复一次普通 checkout，比较路径/HEAD/分支/status是否保持。允许 Task 临时 agent 分支，不要求本地分支名为 main。
4. 若第一次只有 `context deadline exceeded`，将它记录为调用超时；后台冷准备可能继续。允许在同一 Task、相同 cwd / URL / ref 下**额外重试一次**普通 checkout；原生机制会负责等待与重入，不手工改 cache。若该次成功，再调用一次检查重入。总计最多 3 次 checkout，总墙钟等待不超过 16 分钟；其他明确错误直接停止。不得把超时本身判定为 TFS 机制不兼容。
5. 输出 `M01-main-cold-evidence.json`，记录每次调用、首个成功路径、重入比较、版本/身份、调用前是否存在根仓和全部异常。控制端会独立记录原生 cache 的克隆起点、pack体积、准备时间与远端 refs；**Task 不能仅凭自己的 checkout 耗时声称完整下载耗时或分支带来的因果加速**。
6. 通过最终结果交付证据，可在本测试 Issue 发布一次最终评论及脱敏附件。Issue 状态不人为更改；不触发其他 Agent。

禁止 Push、Commit、PR、TFS Work Item 写入、生产资源更改、reset、clean、fresh、cache 删除或人工填充、修改 Git helper/凭据/Daemon配置、重启服务。只允许当前测试 Task 的原生 checkout/fetch、只读身份检查与本测试 Issue 的证据交付。首次冷准备、后续热重试、同 Task 重入必须分别报告。四类业务 Agent、脏树/未推送提交保留不在本轮覆盖内。
