# 删除工具等待提示词后的隔离全流程复验（2026-11-16）

状态：**PASS。删除工具等待提示词后，隔离全流程正常收口；故障人工干预 0 次。**

2026-11-16 13:48（Asia/Shanghai）独立回读：业务 TT-19 为 done、pending 已清除；PR #3797 completed/succeeded；TFS Bug 265199 已解决/已修复、rev 7，只有一条收口历史。4 个 Run 全部 completed，最后一个于 13:47:40 结束。正常派单、PR 审阅/合并与阶段启动仍由控制端执行，此结果不等同于定时无人值守流程已经验证。

## 验证目标与边界

使用 CLI 在云端 rondo-tt 新建隔离对象，验证删除 finalize-delivery 的通用工具等待说明后，真实 Runtime 能否从 TFS 同步、Wayfinder 准入、Bug Fix、PR 交付走到 TFS 回写及 Issue 收口。收口前包含 35 秒无副作用命令，首次 yield_time_ms=1000；任务仅给命令及采样参数，不提供 session/cell 等待方法、不要求输出完整返回对象，也不另行注入已删除的提示词。

正常初始派单、阶段启动和控制端 PR 审阅/合并属于正常流程操作。执行中纠错评论、steer、cancel/rerun、代跑缺失步骤计为故障人工干预；两者分别记录。单次结果不用于证明提示词的因果作用或长期稳定性。本轮未冻结模型行为及所有环境变量，不能视为仅改变提示词的严格对照实验。

## 隔离对象

- Workspace：rondo-tt / `3158546f-5b79-4042-baec-20cdac7d9d31`，`https://api.multica.ai`，profile `desktop-api.multica.ai`。
- TFS Bug：265199；唯一业务仓 frame，Node fixture 目录 `.bug-e2e-withdrawal-20261116/`。
- 目标分支：`codex/bug-e2e-withdrawal-20261116`；seed `6a57a4c41d1bee7aa34fdef1da17a69cfa9dc962`。
- dev 基线：`0a2857e17d2a146a6c0b5440a993a3acfc9b9473`；不合并到 dev/main。
- 同步 Runner：TT-18 / `01a1e2cd-bdd9-75e8-b7a8-5e76a5665d77`。
- 业务 Issue：[TT-19](https://multica.ai/rondo-tt/issues/01a1e2d0-bf8e-7acf-9632-a2675d221f0c)。
- 收口 Runner：TT-20 / `01a1e2e2-849b-7b2a-b781-0bd4703dd19d`。
- [PR #3797](http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/WiNEX%20DataFactory/_git/winning-dps-df-frame/pullrequest/3797?_a=overview)：`feat/265199` → 隔离目标分支。
- Candidate：`e340c477577996244369f27640dfde0040173622`；Merge：`82247cd04482659f66b72a91b8debbe639fe7639`。

## 前置核验

已通过 CLI 回读 finalize-delivery 正文，与仓内撤回版相同，未包含被删除的说明。Desktop CLI 0.9.0、Codex Runtime 在线；保持上一轮进程级网络与 Git 兼容配置，不改系统配置或重启共享 daemon。使用全新分支、Bug、Runner，不复用旧业务对象。

## 执行记录

| 阶段 | 当前已确认事实 |
| --- | --- |
| TFS Sync | Run `01a1e2cd-bdf6-7e2d-a511-f00be72fac51`；首次 exit 0、created=1，重复 exit 0、skipped=1、failed=0；来源/Owner/Project/正文回读通过；Runner in_review、Run completed |
| Wayfinder | Run `01a1e2d2-ff12-7dc4-b529-dba9dab43bdb`；原生根仓 check-checkout PASS，注入 codebase-explorer 与仓内一致；远程镜像无新 fixture 后自主使用 TFS 固定 seed 读取证据 |
| 准入与交接 | Decision `01a1e2d8-3282-7b99-8f11-55b2c43bb171` 已发布并回读；handoff PASS；补记评论时 TLS 超时，自主回读并恢复，最终 revision=2 / final_content_verified=true |
| Bug Fix 启动 | Run `01a1e2d9-30e3-7bb3-a986-ef4874117f44`，05:34:07Z 派发、05:34:09Z 启动；无需取消重派或重启 daemon |
| 修复回归 | 基线原始 regression 失败；新增测试在修复前 3/5 失败，修复后原始 regression 和 5 组新增测试通过，含 25 个表驱动输入及转换/异常检查；原始回归未修改 |
| 开发准备幂等 | 同一个 session 39882 续取最终 exit 0 / PASS / changed=false，保留未提交修改；原始工具记录见 repeat-prepare-lifecycle.json |
| PR 交付幂等 | prepare-pr PASS；两次 materialize 均 PASS，首次 reused=false、第二次 reused=true，均为 PR #3797 |
| 控制端独立审阅 | 完整差异仅两文件，保留原始 regression；独立运行 regression 与 node --test，均 exit 0，5/5 通过，无未解决 Finding |
| 未合并门禁 | PR active 时 Prepare 返回 exit 2 / FAIL，明确等待合并；未写入 TFS 收口事实 |
| 隔离 PR 合并 | 已审阅 Candidate 与目标 seed 一致后合并，最终 completed/succeeded；dev 仍为原基线 |
| 撤回版 Skill 注入 | TT-20 Run `01a1e2e2-84b5-7673-84a3-6c0a3e204c6d` 实际注入的 finalize-delivery 与仓内一致，未含被删除的说明 |
| 长命令等待 | 同 Run 首次 yield_time_ms=1000，Windows 实际约 10 秒返回 session_id=11493；Agent 自主保留完整返回对象，使用 write_stdin 续取同一进程，最终 exit_code=0 / LONG_COMMAND_PASS。命令只启动一次 |
| PR 同步 / Prepare | 同 Run PR 同步 PASS、仅处理 TT-19、无 failures；Prepare PASS / prepared / mode=bug，归档 skipped 合法 |
| Writeback / Complete | 同 Run 依次 exit 0 / PASS；TFS 已解决；TT-19 done，pending 清除；摘要评论 `01a1e2e4-7abc-7c5b-8fc5-c5b73916cf7b` |
| 收口幂等 / 独立回读 | 同 Run 再次 Prepare PASS / already=done；控制端回读 TFS rev 7、单条收口历史、3 条不同 ArtifactLink，无重复回写 |

## 人工介入与剩余问题

- 故障人工干预 **0 次**：没有执行中纠错评论、steer、取消/重派 Run、重启 daemon、控制端代跑同步/修复/PR 物化/TFS 回写/Complete，也没有手工设置业务 done 或补交付标记。
- 正常控制端操作：独立样例建立、同步 Runner 启动、成功同步后的初始准入派单、PR 审阅与独立测试、未合并门禁、隔离 PR 合并、收口 Runner 启动。审阅/合并环节仍存在，不能用“0 次故障干预”表示整个流程无需任何人工门禁。
- 仍出现 PowerShell profile/编码噪声、CLI 参数错误、Skill 路径误读及附件位于工作目录外被拒绝；Agent 自行修正后继续，没有外部纠错。
- TLS handshake timeout 在 Wayfinder、Bug Fix 阶段再次出现，兼容选项没有消除故障；Agent 通过只读回读及已有重试恢复。控制端最后的 TFS refs 只读查询也经历重试后成功，网络稳定性仍未解决。
- 本轮未复现派发停滞，Bug Fix 派发后 2 秒启动；未注入 WS 领取断线，不评价 stale reclaim 故障恢复能力。
- 本轮实际 Writeback 正常完成；35 秒无副作用命令验证了 session 续取，没有在真实 TFS 写操作中人为注入超时。一次成功不能证明所有长命令边界永久可靠，也不能作提示词因果对照。
- 范围为单仓 Node fixture、同一 Codex Runtime 的独立 Run，未覆盖生产 Java、跨物理 Runtime、多仓、PR abandoned 或定时无人值守。

## 对提示词的结论

本次提供了删除后的正向证据：Agent 在没有该业务 Skill 提示词、也没有任务内等价等待指导的情况下，正确处理了进行中的命令并完成真实交付收口。本轮不需要恢复这句提示词。保留原有最终 exit 0 / PASS 业务门禁即可；后续若再现执行错误，仍应基于实际工具返回与执行记录定位，不能因本次通过而宣称根治。

## 证据与工作区变更

`evidence/` 保存初始任务说明、前置核验、实际 Skill 注入比对、两次同步、长命令及重复 prepare 的原始工具生命周期、准入/修复/收口关键结果、独立审阅、未合并门禁、最终 Issue/Run/TFS/分支事实及干预分类。

本轮未修改产品代码、Skill、Agent 或系统配置。隔离业务提交已推送、测试 PR 已合并；根仓交付范围仅为本报告与证据，以及上轮报告的后续验证链接，不包含其他任务的改动。
