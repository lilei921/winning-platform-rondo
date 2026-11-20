# 隔离 Bug Fix 全流程验收（2026-11-16）

状态：**隔离完整链路在受控恢复后通过；无人干预稳定性验收不通过。**

后续根因排查见 [修复与复验报告](../bug-e2e-rerun-20261116/README.md)：原始工具响应被裁剪，导致 Agent 未保留长命令的 session/退出状态；派发在 5 分钟参考回收窗口之前已被控制端取消，故本轮不能证明自动回收失效。曾增加的工具等待提示词随后从业务 Skill 撤回；后续一次成功复验不能证明该提示词必要或此类执行错误已根治。以下保留当时观察和恢复过程，不将其当作最终根因判定。

2026-11-16 10:55（Asia/Shanghai）最终回读：TT-12 为 `done`，`finalize.pending` 已清除；PR #3795 为 `completed/succeeded`；TFS Bug 265136 为「已解决 / 已修复」、rev 7。再次 Prepare 返回 `already=done`，TFS 修订号与唯一收口历史均未变化。TT-11、TT-13 验收 Runner 为 `in_review`，三者均无活跃 Run。测试过程中确有网络、派发和 Agent 结果误判，需要控制端恢复，不能视为无人值守成功。

用户授权新建隔离样例，执行测试分支 Commit、Push、PR 创建和合并、TFS 回写与 Issue 收口。按用户要求仅使用 CLI，不操作桌面窗口。

## 环境与对象

- Multica：`https://api.multica.ai`，profile `desktop-api.multica.ai`，workspace `rondo-tt` / `3158546f-5b79-4042-baec-20cdac7d9d31`。
- 用户默认内网 profile 未修改。
- TFS Bug：265136；业务 Issue：[TT-12](https://multica.ai/rondo-tt/issues/01a1e22f-ff1a-7189-8762-857e2787ab4f)。
- 同步验收 Runner：[TT-11](https://multica.ai/rondo-tt/issues/01a1e22b-ee5f-784d-b333-02ef931092d0)。
- 收口验收 Runner：[TT-13](https://multica.ai/rondo-tt/issues/01a1e243-3c4b-7297-9d8e-7b531f486acb)，无 Project，独立于开发 Run。
- 业务仓：frame / winning-dps-df-frame。测试目标：`codex/bug-e2e-20261116`。
- 测试基线：`060cd98b594018ef7288d55e5731829764cbec70`；建分支时 dev：`0a2857e17d2a146a6c0b5440a993a3acfc9b9473`。
- fixture：`.bug-e2e-20261116/quote-identifier.mjs` 与原始 `regression.mjs`；只验证 Node fixture 与交付流程，不代表生产 Java 行为验证。
- 本轮配置、请求与控制端证据：`tools/rondo/build/bug-e2e-20261116/`。

## 已验证阶段

| 阶段 | 结果 | 依据 |
| --- | --- | --- |
| CLI 目标身份 | PASS | workspace get 回读名称、UUID、前缀 TT 一致 |
| 隔离对象建立 | PASS | 新 Bug 265136 / rev 1；目标分支回读等于测试基线 |
| TFS Sync 首次恢复执行 | PASS | Run `01a1e22f-554e-7395-af8d-0c6050692914`，exit 0，created 1，failed 0；TT-12 backlog / Wayfinder / Project / 来源版本回读一致 |
| TFS Sync Runtime 重复执行 | UNKNOWN | exit 3，读取准入 Agent 时 CLI 无法连接平台，未发生已知重复写入 |
| 控制端同步幂等补验 | PASS | 相同配置 exit 0，created 0 / updated 0 / skipped 1 / failed 0；理由为字段、正文及附件无变化。不能替代 Runtime 网络稳定性验收 |
| Wayfinder | PASS | Run `01a1e232-afed-7cac-91bd-44ad1a3febd9`，固定 TFS 来源及 Commit 核验、原生根仓供应与身份校验 PASS；Decision `01a1e236-4cdb-7147-b588-4e52d9b98506` 为 eligible，handoff PASS |
| Bug Fix | PASS（恢复后） | Run `01a1e23a-2878-71c1-a29d-50b36f619181`，基线原始回归 exit 1；修复后回归和 21 组边界/类型转换检查 exit 0；prepare-pr PASS；PR 创建后 in_review |
| 开发准备幂等 | PASS | 重复 dev prepare 返回 changed=false，保留当前修改 |
| PR 创建幂等 | PASS | materialize 首次创建 #3795，重复返回同一 PR、reused=true |
| 独立审查与复验 | PASS | 控制端审查 candidate 对基线的完整 diff，仅实现及新增测试两文件；原始 regression.mjs 未改；独立原始回归、Node 测试运行通过 |
| 未合并收口门禁 | PASS | 控制端 finalize prepare 返回 FAIL / exit 2，原因 PR #3795 active；没有进入 writeback |
| PR 合并 | PASS | 外部只读回核 completed / succeeded；源和目标、candidate 均匹配；dev 保持测试前 SHA |
| PR 状态同步 | PASS | TT-13 Run `01a1e243-3c5d-75e9-9c4b-94e9ea71d72f`，scanned=1 / included=1，actions=finalize / failures=[] |
| 合并后 Prepare | PASS | 同 Run seq 23，prepared / mode=bug / route_archive=skipped，exit 0 |
| TFS Writeback | PASS | 同 Run seq 28，PASS / exit 0，已解决；控制端独立回读 Bug 265136 rev 7、已解决/已修复、一条收口历史 |
| Complete | PASS（恢复后） | Run `01a1e246-8199-79c6-9785-778cd211a187` seq 7，exit 0、PASS/done；TFS verification、summary、issue_done、pending_cleared 均 done；只补 Complete，未重放 TFS 写入 |
| 完成幂等 | PASS | 同 Run seq 9，再次 Prepare 返回 PASS/already=done、exit 0；控制端最终回读 Bug 仍 rev 7、单条收口历史 |

## 代码与 PR 证据

- [PR #3795](http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/WiNEX%20DataFactory/_git/winning-dps-df-frame/pullrequest/3795)：`feat/265136` → `codex/bug-e2e-20261116`。
- Candidate：`4e0592fa8391aeb4a6696dd50294cb918054baf4`。
- Merge：`67c18768955b5fca6db46a8d4e4ce4763206cc35`。
- 修复使用原模板字符串转换语义，把所有内嵌双引号加倍；覆盖空串、连续/首尾引号、多引号、中文、数字及对象转换、异常等。
- 合并前后分支和 TFS 关系只读证据：`tools/rondo/build/bug-e2e-20261116/postmerge.json`。合并后收口前 Bug 为「已建议」/ rev 4；已有 PR、candidate、merge Commit 的关联，尚无收口历史。
- 本轮只合并隔离目标；未清理源分支，便于复核。

## 已观察的问题及恢复

1. Runtime CLI 网络不稳定。首轮 TT-11 遇到 TLS handshake timeout；按 CLI 自身提示，在子进程设置 `GODEBUG=tlsmlkem=0` 后恢复首次同步成功，重复同步仍出现一次连接失败。没有修改系统设置、daemon 或共享 profile。
2. 派发未启动。Bug Fix 原 Run `01a1e237-0361-7552-8eea-4ee239681ea9` 在 10:37:05 派发后未开始，daemon 日志出现领取过程断线和结果不确定。10:40:06 取消原 Run，回读活跃列表为空后 rerun；新 Run 于 10:40:26 启动。保留原 Run，不将首次派发算作成功执行。
3. 执行资产版本差异。工作区发布的 codebase-explorer 仍使用旧的根仓供应说明，与本地新版不一致。本轮通过明确 Issue 指引允许首次 Resource-only Task 使用平台原生 repo checkout，再做身份校验；尚未更新工作区 Skill。
4. Windows PowerShell 默认 profile 加载产生 AuthorizationManager 错误，默认文件读取造成中文乱码；通过当前进程 `-NoProfile` 和显式 UTF-8 处理。
5. 收口 Agent 误判成功结果。TT-13 原 Run 的 seq 28 明确为 writeback PASS、EXIT_CODE=0，但最终回复仍称「未返回结构化结果或退出码」，将 Runner 置 blocked 并跳过 Complete。控制端保存原始 seq 23/26/28/36/37/38 到 `writeback-runtime-evidence.json`，只读 TFS 确认 rev 7 / 已解决 / 单条收口历史，再通过评论 `01a1e246-818f-7d52-b345-2647b040a93b` 恢复。这是本轮实际观察到的 Agent 结果消费问题；尚未定位为底层事件投递还是模型判读原因，不声称已修复。
6. 提交格式存在偏差。实际标题为 `#265136 AI-BUG-FIX fix: escape embedded quotes in isolated identifier fixture`，未以全局约定的 `AI-` 开头。提交包含 `Refs: #265136`，关联正常；未改写已推送历史。后续应统一工作区 Bug Fix 提示词与仓库格式约定。

优先整改：首先修复收口 Agent 对进行中命令/最终结果的处理与恢复判断，再处理 daemon 领取断线后的稳定恢复；同步工作区发布 Skill 与当前供应契约，并统一 Windows 无 profile、UTF-8 入口。网络兼容选项仅缓解，不能替代稳定性修复。以上问题本轮均仅记录和受控绕过，未修改 Multica/Rondo 产品代码或共享运行配置。

## 留存证据与范围

关键证据保存在本目录 `evidence/`：

- `final-issue.json`：TT-12 done、TFS written、pending=null。
- `final-external.json`：PR completed/succeeded、候选/合并 SHA、TFS 状态/关系/唯一历史、dev 与隔离分支。
- `final-runners.json`：三个测试 Issue 的终态与活跃 Run 数。
- `premerge-prepare.json`：未合并 PR 被门禁阻止；进程退出码 2 见本文验证记录。
- `writeback-runtime-evidence.json`：原 Run 的 Prepare/Writeback 成功结果与误判停止文本。
- `finalize-runtime-evidence.json`：恢复 Run 的 Complete 与 already=done 最终结果、退出码。
- `sync-control-repeat.json`：控制端同步幂等补验，不替代 Runtime 网络稳定性验收。

验收覆盖：单仓独立 Bug 正向交付、原始回归失败到修复成功、重复开发准备/PR 创建/完成、未合并门禁、网络和派发中断后的受控恢复、独立 Run 无根仓收口。未覆盖：生产 Java 业务、跨仓交付、废弃 PR 的 REWORK/RECREATE_PR、候选漂移、定时调度、不同物理 Runtime 间迁移。各阶段使用同一在线 Codex Runtime 的不同 Run，不将其宣称为不同 Runtime 迁移验证。TFS「已解决」是本交付契约终态，不等同人工 QA 验收「已关闭」。

TFS Sync 与 PR Status Sync 的自动化均无定时触发器。本次为按需测试，不声明定时无人值守链路通过。此前 TT-10 的三 MCP 失败不能直接当作当前结果：本轮 Wayfinder 与 Bug Fix 均实际成功调用 remote-filesystem；其他工具调用情况按最终记录报告。
