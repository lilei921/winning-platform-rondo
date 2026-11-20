# M01 复验：原生 cache 就绪后的 checkout 与同 Task 重入

2026-11-13 用户明确授权继续定位本次 checkout 超时，解除阻塞后复验 M01。复用现有测试 Project、Resource、Agent 和 Runtime，新建一个隔离测试 Issue / Run；保留 TEST-2 的超时证据，不修改其历史报告。

## 固定测试范围

- Workspace：`rondo-test` / `60eb8cf4-31be-4a34-b744-8ef6a0bcf15d`。
- Project：`winning-platform-monorepo` / `d43bbc9d-4cc2-4cee-8f92-70c993ffbf97`。
- Resource：`eee149cc-9c37-415c-a1d8-b0c3b3b56585`，`github_repo`，`ref=rondo`。
- Agent：`9915af88-b5ce-42c2-9c3b-227d768c5bc0`；Runtime：`c55feddd-7910-480a-8f9f-9d6180b1f061`；Daemon：`01a01965-2f6a-72fe-899f-3e7556c5d51d`。
- 无凭据根仓 URL：`http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_git/winning-platform-monorepo`。
- 控制端刚回读的 `rondo` Commit：`21e3c1688846d8fe6c9918c824a992416393874d`；`master` / 远端默认 HEAD：`bb13f482ff7a3c01936f596942dd7d36cc6ece86`。本地 HEAD 应与 Task 内可确认的目标 ref 对照，不能假设浮动分支不会变化。

## 已完成的排查

TEST-2 的首次请求于 10:36:49 超时。原生后台 clone 于 10:29:42 启动，cache 的约 416 MB pack 于 10:37:13 才完成，ref 布局于 10:37:16 更新。控制端现已只读确认 bare cache、`+refs/heads/*:refs/remotes/origin/*`、完整 `origin/rondo` SHA，以及 `git fsck --connectivity-only --no-reflogs` exit 0。

未手工 clone、未填充或改写 cache、未修改凭据或超时、未重启 Daemon。现在具备复验条件。前次请求超时是一次调用失败，不能直接判定 TFS checkout 机制不可行。

## 执行要求

1. 核对当前真实 Task 身份、Runtime、Daemon、独立工作目录及 Resource manifest，凭据只记录是否存在。记录调用前是否已有根仓，不能把 Resource 存在当作已 checkout。只在本 Task 工作目录操作。
2. 从同一 Task 工作目录执行一次 `multica repo checkout <上述根仓URL> --ref rondo`，记录开始/结束时间、耗时、exit code、脱敏 stdout/stderr、实际返回路径。不要用 `--fresh` 或手工 Git clone。
3. 成功后，在返回路径执行 `git rev-parse --show-toplevel`、`git rev-parse HEAD`、`git branch --show-current`、`git status --porcelain`；核对脱敏 origin 与 URL、完整 Commit 与 `origin/rondo`。如果 origin 路径不同，查清隔离 checkout 的 remote 语义后报告，不擅自修改 Git 配置。记录 `.git` 是目录还是指针文件，用于识别实际隔离模式。
4. 从第一次调用的相同 Task 工作目录再次执行同一条普通 checkout，重新采集上述身份、路径、HEAD、分支与 status，对比是否复用以及是否保留原状态。不要构造脏树、修改跟踪文件或创建 Commit。
5. 如任一 checkout 失败，保留现场并区分调用失败与机制结论；缺乏证据时机制状态为 NOT_RUN。不要无限重试、重启 Daemon、修凭据、修改 Resource 或触发其他 Agent。
6. 生成脱敏 JSON 证据，至少含两个调用的完整时间、退出码和输出、前后 Git 身份、Resource、Task / Runtime / Daemon 身份及未覆盖项。命名为 `M01-retest-evidence.json`，保存在本 Task 内；通过最终结果交付，可在本测试 Issue 发布一次结果及证据附件。

只允许本测试 Task 的原生 checkout / fetch / cache 行为和本测试 Issue 的证据交付。禁止 Push、PR、TFS Work Item 写入、生产 Issue / Agent 变更、reset、clean、fresh、cache 删除或人工改写。脏树/未推送提交保留、冷 cache 从零准备的时限改进及四类业务 Agent 覆盖未执行时须明确列出，不能因本次热 cache 通过而宣称均已修复。
