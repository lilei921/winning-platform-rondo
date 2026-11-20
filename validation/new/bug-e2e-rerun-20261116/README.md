# Bug Fix 根因排查与隔离复验（2026-11-16）

状态：**只读查询重试修复已实施并发布；当时的完整隔离复验通过，故障外部干预 0 次。工具等待提示词随后撤回，不再计为已验证的必要修复。**

后续验证：删除提示词后已另建 TT-19 / TFS 265199 / PR #3797 完整复跑，长命令等待及真实收口均通过，故障人工干预 0 次。详见[撤回后的隔离复验报告](../bug-e2e-withdrawal-20261116/README.md)；本报告保留上一轮的时间、对象和历史证据，不混用两轮结果。

2026-11-16 11:43（Asia/Shanghai）独立回读：TT-15 为 done，pending 已清除；PR #3796 completed/succeeded；TFS Bug 265186 已解决/已修复、rev 7，只有一条收口历史。正常初始派单、PR 审阅/合并和阶段启动由控制端执行；没有纠错评论、steer、cancel/rerun 或控制端代跑缺失的同步/修复/收口步骤。此结论属于一次按需完整流程验收，不代表定时调度或长期网络稳定性已验证。

最终 4 个 Run 均为 completed；TT-14 / TT-16 验收 Runner 为 in_review，业务 TT-15 为 done，无残留活跃 Run。最后收口 Run 于 11:44:14 结束。

## 根因与修复

### Skill 为什么不一致

仓库源文件、平台 Skill 对象和 Run 注入的技能快照是不同交付物。Git 提交不会自动发布平台 Skill；`workspace provision` 管对象和绑定，`workspace sync` 才同步文件。

平台 codebase-explorer 最后更新于 2026-11-14 16:31:00（北京时间）。同日 17:52:38 的 `a9737a2f` 提交加入首次 Resource-only Task 的原生 checkout 规则；11-16 10:06:21 的 `8cdc8412` 又更新了只读探索说明。平台实际正文仍为旧的「只使用已提供根仓、重入不执行 checkout」说明。因此确认是内容发布落后于仓内提交，而非仅根据时间戳推测或已证明的 Run 缓存问题。无法仅凭现有记录判定由谁漏发。

还发现原 rondo-tt overlay 固定云端 server，但没有命名 profile；当前默认 CLI 已改为内网。正式 sync 显式传 desktop profile 时被既有跨 profile 保护拒绝。不能证明这是历史漏发的原因。本轮没有弱化该保护或改变用户默认配置，使用原生 CLI 的显式 server/profile/workspace，定向更新两个 Skill 正文并回读逐字核对。发布：codebase-explorer 11:11:30、finalize-delivery 11:11:34，原 Skill ID 和绑定不变。

### 1. Writeback 成功但收口停止：已定位执行错误，撤回 Skill 提示词补丁

原始 Codex session 中，Agent 使用 `text(r.output)` 输出 `exec_command` 返回对象的一部分。Writeback 的 `yield_time_ms=30000` 到期时，进程尚在运行；外层工具显示 Script completed，只打印了部分 stdout，`session_id` 与 `exit_code` 没被展示。Agent 没有等待同一进程，转而将 Runner 标为 blocked。平台最终 tool_result 中的 PASS 是后台进程后续完成事实，不等于 Agent 当时收到了该完整结果。

证据：原 Run `01a1e243-3c5d-75e9-9c4b-94e9ea71d72f`；02:51:49Z 的 exec 调用、02:52:19Z 的部分输出、02:52:42Z 的 blocked 调用；平台 seq 28 最终 PASS。先前报告「漏认成功结果」的表述由此细化为返回对象裁剪造成生命周期信息丢失，尚无证据归因于 Multica 丢失最终事件。

当时在 finalize-delivery 中增加了保留完整工具返回值、等待同一进程结束的说明，并在复验中观察到 35 秒命令正确等待完成。该规则属于原生工具调用契约，不属于交付收口的业务规则；一次成功复验不能证明新增提示词是必要条件，也不能证明该执行错误已被永久修复。按用户后续决定删除该说明，保留原有取得最终 exit 0、result=PASS 才继续的业务门禁。原始故障证据及当时的验证结果保持不变；若再次发生，应调查工具返回信息的传递和执行逻辑，而不是继续叠加业务 Skill 提示词。

### 2. 派发后未启动：领取响应不确定，上一轮恢复观察不足

10:36:51 daemon 收到 Bug Fix wakeup；10:36:58 记录 WS claim 结果不确定并延迟 HTTP fallback；10:37:22 已进入 HTTP fallback。服务端任务处于 dispatched，而本机没有启动该任务，符合领取可能已提交但响应丢失的状态。不能由此推出 daemon 永久卡死。

Desktop 0.9.0 对应 commit `8cd8a2db9` 的 WS 实现明确把已提交领取的恢复交给 stale reclaim；同版本服务端源码的 dispatched 回收阈值为 300 秒。上一轮 10:40:06 人工取消早于该阈值，因此**上一轮没有验证自动回收是否失效**。云端实际部署的回收配置未直接取得，不将参考源码视作线上配置证明。本轮如出现同类状态至少观察完整回收窗口，不提前 cancel/rerun；未修改云端服务或重启共享 daemon。

源码：[WS 领取](https://github.com/multica-ai/multica/blob/8cd8a2db9/server/internal/daemon/wsrpc.go)、[回收阈值](https://github.com/multica-ai/multica/blob/8cd8a2db9/server/cmd/server/runtime_sweeper.go)。

### 3. CLI 网络不稳定：网络设备根因未确认；已修复错误放大点

原始故障确有 TLS handshake timeout、Could not reach、context deadline exceeded。Rondo 大部分只读查询使用共享退避，但 `resolveIntakeAgentId()` 的 agent list 没有启用 transient，导致一次瞬断就让整轮同步 UNKNOWN。

修复该单点启用已有只读退避，不新增写入重试。两条新回归分别注入 TLS 错误与空 stdout，旧构建均失败；新构建两者均通过，且只创建一个 Issue，重跑为 skipped。构建通过，相关正文/附件/Skill 引用检查共 25 项通过。

修复也已部署到本机安装的 Rondo：只替换 `dist/commands/tfs/reconcile-workitem.js`，部署前确认与旧安装仅有本次已验证差异并备份，部署后 SHA-256 与测试构建一致。包版本仍为 1.2.24，此为本机补丁，未发布 npm 包；身份见 `evidence/installed-rondo-patch.json`。

CLI 0.8.2 与 Desktop 自带 0.9.0 各自开/关 `GODEBUG=tlsmlkem=0`，每组 2 次只读对照，共 8 次均成功。因此不能确认版本差异或 ML-KEM 分包是本机网络根因。本轮统一使用官方 Desktop 0.9.0 CLI，并沿用进程级兼容选项；不改系统网络、不宣称已修好代理/防火墙。官方 [TLS 排查说明](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/troubleshooting.mdx) 仅作为候选原因参考。

## 复验范围与判定

- Workspace：rondo-tt / `3158546f-5b79-4042-baec-20cdac7d9d31`，服务 `https://api.multica.ai`。
- TFS Bug：265186；目标 `codex/bug-e2e-rerun-20261116`；seed `6617e2ba3a244897e02d41dc27d62092eb3969ce`。
- 同步 Runner：TT-14 / `01a1e258-4a34-7339-ac77-68a685919ddf`。
- 业务 Issue：[TT-15](https://multica.ai/rondo-tt/issues/01a1e25f-8965-7830-a3af-e466f10c73de)。
- 只测试 Node 隔离 fixture 和交付流程，不代表生产 Java 行为验证。
- 初始派单、明确授权的 PR 审阅/合并和阶段启动是正常测试操作；执行中补充解法、steer、cancel/rerun、控制端代跑缺失步骤计为故障干预。分别记录正常门禁与故障干预，不能据一次通过宣称稳定性已完全解决。
- 保留旧 TT-11/12/13 和 TFS 265136，使用全新对象；不修改 dev。

## 执行记录

| 阶段 | 结果 | 关键事实 |
| --- | --- | --- |
| TFS Sync | PASS，自主恢复 | Run `01a1e258-4a5a-7308-9aed-09d36b73e73c`；首次 shell 使用 Stop 把 stderr 日志当成异常。Agent 自行只读检查现场、调整执行方式，再次同步成功创建 TT-15；重复同步 skipped=1 / failed=0；无外部纠错 |
| Skill 注入 | PASS | Wayfinder 实际 codex-home 中 codebase-explorer 与仓内源文件规范化文本一致；见 `evidence/codebase-injection.json` |
| Wayfinder | PASS | Run `01a1e260-b2a8-7609-ac86-85ade854792c`；自主原生 checkout、check-checkout PASS；Decision `01a1e265-fc5e-753e-9d19-fe55a02d538e`；handoff PASS，无补充供应指令 |
| 自动交接 / 领取启动 | PASS | Bug Fix Run `01a1e267-0700-7304-9247-a620f6930827` 于 03:29:25Z dispatched，03:29:26Z running；无需取消、重派或重启 daemon。本轮没有复现 WS 领取丢失，因此不宣称已验证该故障的自动回收 |
| Bug Fix | PASS | Run `01a1e267-0700-7304-9247-a620f6930827`；基线失败到修复通过；重复 dev prepare 为 changed=false；仅 fixture 实现及新增测试两个文件；原始回归保留 |
| 独立审阅 / 测试 | PASS | 控制端核验完整 diff；原始 regression PASS，node --test 23/23；候选 `8cd911520ff2d0051930209672907dc33653352b` |
| PR 创建幂等 | PASS | #3796 首次 reused=false，重复 reused=true；未产生第二个 PR |
| 未合并门禁 | PASS | Prepare 返回 FAIL/exit 2，原因 active PR，不进入 TFS 回写 |
| 合并 | PASS | PR #3796 completed/succeeded；merge `6c69504c40a1204e42a54dee7005efa4dafd718a`；dev 仍为 `0a2857e17d2a146a6c0b5440a993a3acfc9b9473` |
| 长命令生命周期 | PASS | TT-16 Run `01a1e26e-771f-761f-b317-c3be1df0d151`；首次参数 yield_time_ms=1000（Windows 实际约 10 秒）；保留 session_id=53554，在同一 cell=4 内续取，三次 wait 后取得 exit_code=0 与 LONG_COMMAND_PASS。未重新发起命令 |
| PR 状态同步 / Prepare / Writeback | PASS | 同 Run 顺序执行；Prepare 为 prepared / mode=bug，Writeback 为 PASS / 已解决；未把部分输出判为 UNKNOWN |
| Complete / 幂等 | PASS | 同 Run Complete PASS/done、pending_cleared=done；再次 Prepare PASS/already=done；独立最终回读 Bug 仍 rev 7、单条收口历史 |

## 结论与剩余边界

- 已修复并验证：TFS 准入 Agent 只读查询缺少退避重试；当时两个相关 Skill 正文发布与实际注入一致。
- 长命令结果：已定位返回对象裁剪导致的生命周期信息丢失，当时复验正确等待并完成收口；不能将成功归因于新增提示词。该提示词已从业务 Skill 撤回，本次删除未重新执行业务 E2E，也未改动底层工具执行逻辑，不宣称此类执行错误已根治。
- 本轮没有复现派发停滞；Bug Fix 在派发后 1 秒启动。没有注入 WS 断线，也没有取得云端 sweeper 的线上配置，不能宣称领取丢失的自动回收已通过故障注入验证。
- 网络传输的具体设备/链路原因仍未确认；8 次对照请求均通过，不能证明某个 TLS 开关或版本升级消除了历史网络故障。只读查询的容错缺口已通过注入测试验证。
- PowerShell stderr/Stop 异常在本轮出现一次，Agent 自主核对后恢复。普通 profile 噪声、提交标题 `#265186 AI-BUG-FIX ...` 的格式偏差仍存在，未将其宣称修复。
- 两个 Skill 为定向原生 CLI 更新；旧 overlay 的命名 profile 迁移限制仍存在，未弱化跨环境保护，也未声称整个工作区所有 Skill 文件已全量收敛。
- 本轮仍为独立单仓 Node fixture，多个 Run 使用同一 Codex Runtime；不覆盖生产 Java、多仓、PR abandoned、跨物理 Runtime 或定时无人值守执行。

## 证据与改动

`evidence/` 保存前次原始工具生命周期、本轮长命令的 session/cell 完整等待、两个 Skill 实际注入比对、同步/PR/收口结果、最终 Issue/Run/TFS/分支事实、网络对照和本机安装补丁哈希。

最初仓内产品改动包含 finalize-delivery 提示词和两处重试代码/测试；提示词现已撤回，保留的代码修复位于 `tools/rondo/src/commands/tfs/reconcile-workitem.ts` 与 `tools/rondo/test/tfs-reconcile-attachments.test.mjs`。已审阅完整差异：重试仅用于准入清单读取，写入顺序和幂等认领保持原实现；两项新增回归在旧构建失败、新构建通过，相关检查共 25 项通过，git diff --check 无错误。隔离业务 Commit/PR 已按授权推送合并；根仓修复和两轮报告已提交为 `ed66524a`，后续撤回另行提交，不改写历史证据。

## 后续发布一致性验收（2026-11-16 13:10，Asia/Shanghai）

用户要求提交推送修复与报告，并确认工作区发布的 Skill 与仓内一致。本次范围扩展为 manifest 中全部 **17 个受管 Skill、64 个文件**（17 份正文、37 份支持文件、10 份生成配置），已回读全部文件并按 SHA-256 比对，最终 **PASS、零漂移、无多余文件**。未受管、已退役资产和 Agent instructions 不在该一致性结论内。

初次审计发现 17 处真实差异：3 份 Skill 正文与 1 份契约内容落后、4 份支持文件缺失，以及 9 份 repo-registry 缺少当前 repo-context 中的 repo_url。全部按仓内版本发布；未删除文件或对象、未调整 Agent 绑定。另将本次修改的 finalize-delivery 正文统一为 Git 提交使用的 LF 换行并重新发布回读，保证与提交内容字节一致。

生成配置使用 `rondo workspace sync --workspace rondo-tt --local-only` 从现有 overlay 与仓内事实源渲染；平台操作始终显式指定 Desktop CLI 0.9.0、profile `desktop-api.multica.ai`、server `https://api.multica.ai` 和工作区 UUID。旧 overlay 的 profile 绑定限制未修改，未运行全量 provision。通过原生 CLI 的 `skill get --with-content`、`skill files list`、`skill update --content-file` 与 `skill files upsert` 完成审计、差异发布及独立回读。当前 CLI 正文响应没有 content_hash，因此直接对返回的 content 计算 SHA-256；支持文件使用回读的 content_hash，不因缺少字段而跳过正文核对。

发布前 17 个 Skill 的引用完整性检查通过。此次没有改动修复代码，不重复执行已通过的 25 项相关测试；全量发布一致性属于新增资产验收，并非重新跑一次业务 E2E，前述 TT-15 全流程结论保持其原测试范围。

证据：`evidence/skill-publication-before.json` 记录全部发布前哈希及 17 处差异；`evidence/skill-publication-updates.json` 记录 17 处更新；`evidence/skill-publication-after.json` 记录该次 64 个文件的仓内/平台一致哈希，包含当时带提示词的 LF 正文哈希。这些是撤回前的历史证据，不能用作撤回后的发布证明。仓内生成配置为忽略文件，按已提交的事实源和 overlay 可重建，不将本机运行配置加入 Git。

## 提示词撤回后的发布验收

删除提示词及报告结论修订已提交并推送为 `f8d8774d`，随后通过显式云端 profile/server/workspace 的 CLI 更新原 finalize-delivery 对象。保留原有业务门禁，未调整对象 ID、绑定或其他 Skill 内容。

重新回读全部 17 个受管 Skill、64 个文件，结果 PASS、零漂移；其中 54 个仓内文件直接对照该 Git 提交的内容计算 SHA-256，10 份配置对照当前仓内事实源和 rondo-tt overlay 的渲染结果。证据见 `evidence/skill-publication-after-withdrawal.json`，旧验收证据保持原样。本次验证范围为文档差异、Skill 引用完整性及发布一致性，未重新执行业务 E2E。
