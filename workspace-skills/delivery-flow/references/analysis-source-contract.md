> 本包镜像；权威来源：analysis-completion/references/analysis-source-contract.md。修改权威后同步本文件。

# Analysis Source 契约

本文件由 analysis-completion 维护，是 `analysis.source` 的唯一权威；delivery-flow 包内同名文件为发布镜像。

## 来源与写入

Delivery Issue metadata 的 `analysis.source` 是 string 类型 JSON，仅由 `rondo analysis complete` 写入：

```json
{
  "repo_url": "https://<tfs>/tfs/<collection>/<project>/_git/<repo>",
  "branch": "<实际推送分支>",
  "commit": "<完整40位Git SHA>",
  "change_ref": "<Change ID>"
}
```

- 根仓使用 Multica 原生 checkout 返回的实际路径，调用方显式传入；每次分析版本由 `analysis.source` 记录。
- `repo_url` 来自根仓 `origin` 的唯一实际推送地址，只接受无凭据的 TFS Git HTTP(S) URL。`branch` 取实际推送分支，`commit` 在 push / rebase 完成后取得。`change_ref` 必须等于 `analysis.change_ref`。
- complete 核验 Gate、最终提交及远端固定 commit 的任务文件、Schema 和 Gate Result，再写入并回读来源及审核 Facts，最后进入 `analysis_review`。逐个比较 Gate 工件与实际 Git blob，只允许 CRLF/LF 换行转换；Git clean filter 改写的不同正文不得发布。读取失败、权限失败、工件未完整提交或来源回读失败不得发布审核状态。
- 来源不得由 Analyst 手填，不写入本次提交自身的 Handoff 文件。输出 `root_commit` 增加 `repo_url`、`commit`，保留 `branch / committed / pushed`。
- 已在 `analysis_review` 的幂等重跑读取固定来源的 Schema 与 Gate，核对 Issue、Workspace、Change、Facts 和必需 PASS 检查；不依赖本地 Gate，不用本地 HEAD 覆盖。任务文件存在本身不足以证明审核通过。
- 来源已落账但状态切换失败时，若当前 Gate 的工件摘要、Facts 摘要均匹配固定版本，则复用原来源、不再提交或推送新 HEAD，输出 `root_commit.reused_source:true`。状态已写入但响应丢失时按上述审核重放恢复。合法返工重新 stage / Gate / complete 且审核包改变后产生新来源，旧批准不得沿用到新来源。
- 发布前回读状态和来源；中途离开 `in_progress` 或来源已被其他流程更新时停止，不覆盖新事实。多次 CLI 写入不具备事务/CAS 保证，未知结果须先回读再恢复。

## 只读命令

```bash
rondo analysis read --config "<config-path>" --issue <KEY> --file tasks.md
```

从配置绑定的 Multica 环境、Workspace 读取 Issue，按来源中的完整 commit 调用 TFS Git Items API 4.1。`--file` 是当前 Change 内相对路径，可读取 proposal、design、specs 等工件；禁止目录穿越。输出 `{result, source, path, object_id, content, sha256}`，正文保留中文及多行格式。

TFS 凭据复用现有配置。来源必须与配置的 TFS 服务 origin、服务基础路径一致；collection / project / repo 由来源 URL 确定，不使用工作项所属项目猜测。命令无需本地根仓挂载，零 Git / TFS / Multica 写入，不回退本地文件或其他分支。

## 批准与派发

- 仓库 URL、commit、change_ref 共同确定来源身份；branch 仅用于追溯。
- Delivery Lead 从真实 Human 评论确认批准的审核版本，将同一来源快照写入 `analysis.human_approval.source`；不能仅因当前 metadata 已变就把旧评论重新绑定新版本。
- `rondo dev materialize` 使用同一来源读取 tasks.md，校验原生 task_refs 与编号唯一性；新派发记录 `dev.dispatch[].analysis_source`。首派、NOOP、激活及写入前回读均检查来源一致，旧 active 派发不因 dispatch_key 相同而自动变成新版本。
- Sub-Issue 创建/指派后、派发落账及启动前再次核对来源；若中途变更则停止后续动作，保留已经创建的 backlog Sub-Issue 或已写派发供核对，不自动重建或启动。原生任务编号兼容数字和 `T1`、`FIX-2` 等既有格式。
- 批准快照用于确定工程契约，不代表实时进度；checkbox、Evidence、完成事实仍按既有开发与收口契约维护。
- 缺少来源的历史记录不能经新读取/派发命令猜测修复，应通过获准的分析审核流程补齐；仅当当前来源、批准来源及全部派发历史均无来源字段时，既有收口保持旧数据兼容。任一处曾出现来源字段后，其丢失或非法值不能降级为旧数据；批准及 active 派发须匹配当前来源，失效历史可保留旧来源。
- ENGINEERING 返工首跑和未完成恢复均核对目标派发、Decision 快照及已恢复派发的来源与当前来源一致；真正无来源的历史返工保留旧规则。已完成或被后续决定取代的旧回调只返回 NOOP，不产生副作用。

## 失败语义

文件不存在或不可见、路径非法、任务缺失或编号重复 → FAIL（2）；身份/来源不明、批准冲突、权限/连接异常或响应不可信 → UNKNOWN（3）；用法错误 → 64。前置校验失败不产生派发或激活副作用；执行中失败保留已落账事实，停止后续动作并回读恢复。
