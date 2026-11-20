# 08-A remote MCP 主路径补充验收

2026-11-14，workspace `rondo-tt`，隔离 Runner `TT-9`。Bug Fix Agent 已在真实 Codex Runtime 实际使用三个 remote MCP，ripgrep 审批拒绝已在该工作区的限定配置下解决。此结果补齐 Bug Fix 的主路径证据，不代表完整 08-A、Wayfinder 重验或 V07 权限矩阵通过；08-B 继续暂缓。

## 配置修复及授权

- 原 remote-ripgrep `mcp-ripgrep 1.2.0` 的 tools/list 未声明只读 annotations，Runtime 在 `approval_policy=never` 下拒绝 search。
- 首次尝试 Agent `custom_args` 的单工具 approval_mode 未生效，TT-9 第一 Run 再现相同拒绝。Multica 的托管 MCP 会过滤 `-c mcp_servers.*`；其转换还将 `tools` 作为选择器处理，不能直接依赖 Codex 的逐工具配置透传。见 [Multica 实现](https://github.com/multica-ai/multica/blob/main/server/pkg/agent/codex.go)。无效 custom_args 已恢复为空。
- 共享配置更新首次被自动审批审查拒绝，没有执行。用户随后明确批准“工作区限定修改并继续验收”。经批准，仅更新 rondo-tt 的 remote-ripgrep 条目 `8d01edf1-e6ad-45fb-b14e-69da256e5133`：`enabled_tools=["search"]`、`default_tools_approval_mode="approve"`。现有 endpoint 和认证信息沿用，通过 stdin 传递，未输出或落入证据文件。影响此工作区所有绑定该条目的 Agent，其他 ripgrep 工具不启用。
- 新 Task 生成配置已回读：上述两项实际存在，`approval_policy=never`、`sandbox_mode=workspace-write` 保持。未修改全局 Codex 配置或远程服务实现，不能声称服务端 annotations 已修复。Codex 配置含义见 [官方 MCP 文档](https://developers.openai.com/codex/mcp)。

## 真实 Run 及工具证据

Actor：Bug Fix Agent `48590a02-c97d-410e-99e4-b5b58d2df66d`；Runtime `a1001c7d-0d5a-463e-8c5e-96b924ef6269`，Codex CLI 0.166.0。Issue `01a1d96a-c5eb-741b-a725-e6fe15615fdc`。

| Run | 结果 |
| --- | --- |
| `01a1d96a-c606-7511-ab03-4a5f6a128759` | filesystem 2、CodeGraph 2 次成功；ripgrep 1 次拒绝。保留失败现场，不重写为成功 |
| `01a1d96f-6a40-7709-b4ee-7455a7a2ea95` | 全新工作目录和会话，filesystem 3、CodeGraph 2、ripgrep 2 次成功 |

第二 Run 平台事件：filesystem 允许目录 `21→22`；CodeGraph `25→26`、`35→36`；ripgrep `41→42`、`51→52`；filesystem 源码读取 `47→50`、`48→49`（并发完成）。平台消息只提供完成摘要，完整源码结果另从本机 Runtime 原始 `McpToolCall` 事件提取，保留 timestamp、ordinal、参数、状态与返回内容，见 [原始 MCP 事件](remote-mcp-runtime-events.json)。不是控制端直接调用 MCP 或 HTTP 搜索替代。

[平台配对事件与测试输出](remote-mcp-platform-evidence.json) 和 [Agent 结构化报告](remote-mcp-agent-acceptance.json) 分别保留独立运行记录与 Agent 的交叉核对结论。

最终[平台回读](remote-mcp-run-readback.json)：新 Run `completed`、无运行错误，TT-9 为 `in_review`；TT-6 仍为 `done`。Agent 同时把报告作为 TT-9 附件保存，失败 Run 的历史记录保留。

实际调查使用 `/root/workspace/winning-platform-monorepo/winning-dps-df-dataintegration`。CodeGraph 定位 TableOutput / DfEngineParametersHelper 后，ripgrep 搜索 `quoteField|toTableOutput\(`，限定 Java、maxResults=3、maxCharacters=4000，返回 `DfEngineParametersHelper.java` 的 185、288、750 行。filesystem 读取该文件和 `TableOutput.java`，核对 `toTableOutput → new TableOutput → addMapping`。精确搜索 `quoteField` 正常返回 0 匹配；不能据此推定其他仓库或忽略文件不存在该符号。

远端源码是 Java 映射模型，TT-6 修复的是 frame 隔离分支的 JavaScript 引号转义 fixture，两者没有被混同为同一实现。远端分支/Commit 未确证，图谱符号行号与文件行号有偏差；本次以真实源码支持局部结论，不宣称最新版本一致性。

## 隔离回归与事实边界

Bug Fix Agent 在新 Run 中只读运行 TT-6 原 fixture：`quote-identifier.test.mjs` 12 PASS / 0 FAIL，`regression.mjs` PASS，两条命令退出码均为 0；三个 fixture 的前后 SHA-256 相同。新 Runner 不执行 checkout / dev prepare，不重开已完成的 Bug 265022 或 TT-6，不新增 Commit、Push、PR 或 TFS Writeback；此前完整 E2E 证据继续独立保留。

[外部只读回读](remote-mcp-external-readback.json) 与此前快照完全一致：生产 Bug 264839 rev 12、隔离 Bug 265022 rev 7，均已解决；PR 3786 completed、候选与合并 SHA 不变；生产 dev 为 `0a2857e17d2a146a6c0b5440a993a3acfc9b9473`。根仓未提交或推送。

本次只关闭 Bug Fix 正常主路径的审批阻碍。Wayfinder 尚未在修正配置下重验三 MCP；V07 的越界/敏感路径矩阵及此前 Claude Task token 平台日志问题仍未关闭，不以本次正常访问通过替代。
