# TFS Git REST API：并发拒绝、PR 生命周期与特殊字符路径验证记录

日期：2026-11-12，Asia/Shanghai。

结果：**T09、T07、T08、T11 实测 PASS**。首轮验证并发拒绝与 PR 生命周期；随后在另一独立分支补齐 T11 中文 / 特殊字符路径新增、修改与回读（§6）。两轮均只使用 TFS Git REST API，测试分支均已清理；PR 未合并，之前的验证分支保留且 HEAD 未变。

## 1. 授权与执行边界

首轮用户明确要求补齐 T09、T07–T08，使用新的独立测试分支，不合并 PR、不删除之前的 API 验证分支，并整理结果。后续另行授权补齐 T11，仍要求新分支、API 操作及完成后清理。对应[原验证方案](TFS-Git-Remote-REST-API-Validation-Plan-2026-11-12.md)中的测试编号。§1–§3 保留首轮参数及异常事实；T11 的独立记录见 §6，汇总矩阵按最新覆盖更新。

所有远程 Git 操作均通过 HTTP API 完成。Python 客户端从 `C:\Users\lilei` 运行，使用 `-B -I`；未调用本地 Git、clone、checkout、worktree 或读取本地业务源码。仅在结束后编辑本地验证文档；未将报告提交到 TFS，未改动业务源码、OpenSpec 或 tasks.md。

| 参数 | 实际值 |
| --- | --- |
| Run ID | `20261112T114618Z-b2d34eb8` |
| 服务 | `http://tfs2018-web.winning.com.cn:8080/tfs` |
| Collection / Project | `wn_data_platform` / `DP-01-数据仓库` |
| Repository | `winning-platform-monorepo` |
| Repository ID | `1a978869-c496-4b14-af65-3c253c01b26f` |
| API 版本 | `4.0`；服务器精确产品 build / Update 未另行探测 |
| 认证 | 现有环境变量 `TFS_PAT`，仅在内存构造认证头；不记录密钥、不跟随重定向 |
| 基准分支 | `refs/heads/rondo` |
| 基准 HEAD，前后相同 | `f42bb4578e553d8a397b5579f6403159fcea9545` |
| 新测试分支，已删除 | `refs/heads/codex/tfs-api-pr-cas-verify-20261112T114618Z-b2d34eb8` |
| 唯一测试文件 | `/.multica-validation/tfs-api-pr-cas-20261112T114618Z-b2d34eb8.md` |
| 新增 Commit / Push ID | `72568388934c4e358a1c1814320b3c1e0106b742` / `120140` |
| 修改 Commit / Push ID | `3af85b748e2dadae05b0a86f6f118b765cc1e6ae` / `120141` |
| PR | [3760](http://tfs2018-web.winning.com.cn:8080/tfs/wn_data_platform/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_git/winning-platform-monorepo/pullrequest/3760)，最终 `abandoned` |
| 状态记录区间 | 19:46:18–19:48:09（UTC 11:46:18–11:48:09）；不作为性能基准 |

执行方式与原方案的差异：使用现有 Python HTTP 客户端和 `codex/` 分支前缀，未运行方案所称的 PowerShell 脚本。本次沿用 HTTP 内网入口和环境变量凭据，**不满足原方案“HTTPS + 交互输入 PAT”的要求**；功能通过不代表认证传输条件或权限边界通过。

## 2. 实际执行与判定证据

### T04–T06：准备独立分支与两次提交

1. `GET repository` 与 `GET refs` 核对仓库、基准分支以及旧验证分支；读取基准 Commit 的 README，核对返回 Commit 和非空内容。
2. 确认新分支名不存在，再 `POST refs`，`oldObjectId` 为全零，`newObjectId` 为基准 HEAD。HTTP 200，返回 `success=true`、`updateStatus=succeeded`；再次读取 refs 确认新分支等于基准 SHA。
3. 两次 `POST pushes` 分别新增、修改唯一测试 Markdown，均 HTTP 201；每次取得新 Commit，读取分支 HEAD 并按该 Commit 回读文件全文，与请求内容逐字匹配。

新增、修改内容的 UTF-8 SHA-256 分别为：

```text
added:  f54d992eef7dbfcfd24e016e6be11bcb9998812377ba3fda181806400c9e828e
edited: 30bff9a149d2c31992b13ade399c6835f1eba34b923df54eb1580006ecf8e9e2
```

### T09：旧 HEAD 写入拒绝 — PASS

已完成第二次提交后，向同一新测试分支发起第三次 `POST pushes`：文件是已存在路径，`changeType=edit`，内容拟把 `Stage: edited` 改成 `Stage: stale-overwrite-must-be-rejected`；**故意把 `oldObjectId` 设为第一次提交 `72568388…`，而实际 HEAD 已为 `3af85b74…`**。

服务端返回：

```text
HTTP 409
typeKey: GitReferenceStaleException
message: TF401028: 其他客户端已更新引用“refs/heads/codex/tfs-api-pr-cas-verify-20261112T114618Z-b2d34eb8”，因此无法更新。请重试。
```

随后回读确认：分支 HEAD 仍为 `3af85b748e2dadae05b0a86f6f118b765cc1e6ae`；文件全文与第二次成功提交一致，SHA-256 仍为 `30bff9a1…`。据错误类型、消息、HEAD 和内容共同判定拒绝成立，不是仅凭 409 认定通过。

这是顺序构造 stale HEAD 的乐观并发负向测试，未运行多客户端并发压测，也未验证发布冲突后的自动重试或语义合并。

### T07：创建 PR 并回读 — PASS

`POST pullrequests` 返回 HTTP 201、PR ID `3760`，再 `GET pullrequests/3760` 返回 HTTP 200。逐项核实：

- repository ID 正确；source 为本次独立测试分支，target 为 `refs/heads/rondo`。
- 状态为 `active`，`lastMergeSourceCommit.commitId` 为第二次提交 SHA。
- 标题含 `[VALIDATION - DO NOT MERGE]` 与 Run ID；未设置自动完成，未调用 `completed` 操作。

未主动指派 reviewer 或关联工作项。

### T08：放弃 PR、删除本次分支并核对保护对象 — PASS

清理前再次检查 PR 身份、source / target、`active` 状态、未启用自动完成，且分支 HEAD 等于本次已记录 SHA。

1. `PATCH pullrequests/3760`，唯一业务字段为 `status=abandoned`；返回 HTTP 200，并 GET 回读为 `abandoned`。
2. 再核对测试分支 HEAD；`POST refs` 使用当前 `3af85b74…` 作为 `oldObjectId`、全零作为 `newObjectId`。HTTP 200，返回 `success=true`、`updateStatus=succeeded`。
3. 精确分支名查询为空；再次读取 PR 为 `abandoned`，未启用自动完成。没有合并 PR，也没有删除旧验证分支。
4. 基准分支上该测试路径 GET 返回 404；另外按基准 Commit 列根目录，确认连 `/.multica-validation` 目录都不存在，目录条目的 Commit 均与基准一致。

| 保护分支 | 验证前与验证后相同的完整 HEAD |
| --- | --- |
| `rondo` | `f42bb4578e553d8a397b5579f6403159fcea9545` |
| `master` | `bb13f482ff7a3c01936f596942dd7d36cc6ece86` |
| 原 API 验证分支 `codex/tfs-api-rw-verify-20261112` | `722c5ea1e96f941f6990c3cb709ae7eb93527649` |
| 原 Git 验证分支 `codex/tfs-rw-verify-20261112` | `ff6810b787ec1b1fce3778731d2fdcd1ab556f73` |

所有 Push / ref 写请求只针对本次新分支。删除 ref 不代表擦除 Commit 对象或 PR 历史；PR 3760 作为 abandoned 记录保留。

## 3. 中途校验异常与恢复

清理操作完成后，最后的“基准分支不存在测试文件”检查错误地假设 404 必为 JSON，触发 `JSONDecodeError`。第一次只读复核又因假设错误正文应包含完整路径而断言失败。实际响应为 `Content-Type: text/html`，正文 1,135 bytes。

之后只做 GET 对账，确认 PR、分支和保护对象状态，并通过固定 Commit 的目录枚举补强文件不存在证据。**没有重建 PR、重复提交、重复 PATCH 或再次删除分支。** 这些异常属于客户端响应格式假设，不能隐瞒为脚本一次执行全通过；最终远端状态满足 T08。

按实际调用序列共 38 次 HTTP 请求：前置 3、分支和两次提交 9、T09 5、PR 创建 / 回读 4、首次清理与检查 10、两轮只读恢复分别 3 和 4。含预期 409、三次文件不存在的 404，以及恢复请求。仅 25 次请求保留了逐项计时输出，异常批次的 13 次请求未导出分项耗时，因此不报告完整 HTTP 耗时或性能比较。

## 4. 原方案覆盖状态

| ID | 状态 | 依据与边界 |
| --- | --- | --- |
| T01 | PASS | 本次重新核对 Repository ID / 名称 |
| T02 | PASS | 本次重新核对基准及测试分支完整 SHA |
| T03 | PASS | 本次固定基准 Commit 读取 README；跨前后端阅读另见原静态分析记录 |
| T04 | PASS | 本次独立分支创建与 HEAD 回读 |
| T05 | PASS | 新增测试文件、Commit、全文回读 |
| T06 | PASS | 修改测试文件、Commit、全文回读 |
| T07 | PASS | PR 3760 创建、source / target / 状态回读 |
| T08 | PASS | PR abandoned、新测试分支不存在、保护分支未变；客户端异常及恢复如上 |
| T09 | PASS | 409 + GitReferenceStaleException / TF401028，HEAD 与内容均未变 |
| T10 | NOT RUN | 按用户要求全程 API，未进行 Web UI 专项核对 |
| T11 | PASS | 后续独立分支专项验证 6 组中文、空格、#、% 及组合路径；新增、修改、全文回读通过，见 §6 |
| T12 | NOT RUN | 未使用低权限账号执行拒绝写入测试 |

T11 的 PASS 限于 §6 列出的路径用例，不代表所有字符与所有客户端均已覆盖。API 4.1、Windows 集成认证、HTTPS 入口、PowerShell 脚本兼容性、真实 Runtime / Rondo 集成均不在本次通过范围。

## 5. 对方案的意义

本次补齐了既有环境下 TFS API 的受控远程写入并发拒绝和 PR 生命周期证据，可作为 Rondo 确定性远程发布适配的依据。将其落地仍需仓库 / 路径授权、当前 HEAD 校验、冲突处理与部分成功后的回读对账；不得将本次 PASS 直接替换为 08 中真实 Runtime 的验收通过。

与[纯 TFS API 跨前后端静态分析记录](datamodel-tfs-api-analysis-2026-11-12.md)分别保留读、写验证边界；业务编码、构建、测试和复现所需 Git 工作区仍按 [08 方案](../08-remote-analysis-git-workspace-design.md)准备。

## 6. T11 补充验证：中文与特殊字符路径 — PASS

独立执行时间：2026-11-12 19:58:50–20:00:02，Asia/Shanghai。沿用 §1 的仓库、API 4.0、认证方式与客户端；未执行 Git 命令或读写本地业务代码。只在新测试分支写入隔离 Markdown 文件，未创建 PR。

| 参数 | 实际值 |
| --- | --- |
| Run ID | `20261112T115850Z-115ab2b7` |
| 新测试分支，已删除 | `refs/heads/codex/tfs-api-t11-paths-20261112T115850Z-115ab2b7` |
| 基准分支 / Commit | `rondo` / `f42bb4578e553d8a397b5579f6403159fcea9545` |
| 测试路径公共前缀 | `/.multica-validation/t11-20261112T115850Z-115ab2b7/` |
| 新增 Commit / Push ID | `722b8995eec7bc61eb4caf0644a863bc5b43939c` / `120146` |
| 修改 Commit / Push ID | `43cde17b8e8d8944c73ec964a2543991196b9921` / `120147` |

下列路径均相对于公共前缀；目录名和文件名都包含待测字符：

| 用例 | 路径 | 新增后回读 | 修改后回读 |
| --- | --- | --- | --- |
| 中文 | `中文目录/中文文件.md` | PASS | PASS |
| 空格 | `space dir/file name.md` | PASS | PASS |
| # | `hash#dir/file#name.md` | PASS | PASS |
| % | `percent%dir/file%name.md` | PASS | PASS |
| 组合 | `组合 中文 # %/报告 空格#百分%.md` | PASS | PASS |
| 字面量转义串 | `percent-escape%23%25/literal%23%25.md` | PASS | PASS |

**实际过程与校验**：

1. 读取仓库身份及全部分支，确认本次唯一分支不存在；创建分支返回 `success=true`、`updateStatus=succeeded`，回读 HEAD 等于基准 Commit。
2. 一次 `POST pushes` 新增全部 6 个文件，HTTP 201；每个文件内容含独立 Case ID、完整路径、`Stage: added` 及中文 / 特殊字符。逐文件按新增 Commit 读取，核对返回路径、Commit、完整内容和 UTF-8 SHA-256。
3. 第二次 `POST pushes` 修改全部 6 个文件，HTTP 201；更新为 `Stage: edited` 和不同内容。逐文件按修改 Commit 回读，同时按测试分支读取当前版本，均与预期内容一致；再按新增 Commit 回读，确认旧版本内容的 SHA-256 未变。
4. 两次提交后分别枚举测试目录，文件路径集合都精确等于上述 6 个路径；没有截断、错名或重复解码后写到其他路径的情况。

新增 / 修改 JSON 中的 `item.path` 使用原始字符；GET 使用 HTTP 客户端的查询参数编码，不手工拼接原始路径。检查实际请求 URL 无 fragment，查询参数解码后等于原始路径。实测编码为：空格 → `+`，`#` → `%23`，`%` → `%25`，字面量 `%23` / `%25` → `%2523` / `%2525`，中文采用 UTF-8 百分号编码。最后一组回读仍保留字面量 `%23%25`，没有被错误还原成 `#%`。

**清理与保护对象**：使用本次最终 HEAD `43cde17b…` 作为 `oldObjectId`、全零作为 `newObjectId` 删除本次分支；HTTP 200，`success=true`、`updateStatus=succeeded`。精确分支查询为空，结束时的 29 个原有分支名称与 HEAD 集合和执行前完全一致，包括：

- 原 API 验证分支仍为 `722c5ea1e96f941f6990c3cb709ae7eb93527649`。
- 原 Git 验证分支仍为 `ff6810b787ec1b1fce3778731d2fdcd1ab556f73`。
- `rondo`、`master` 均与 §2 保护对象表中的 SHA 一致。

按基准 Commit 枚举根目录，确认 `/.multica-validation` 不存在。仅删除本次分支引用，不宣称已物理擦除远端 Commit 对象。

**本轮无失败、无重试、无恢复操作。** 共 41 次 HTTP 请求：37 次 GET、4 次 POST（建分支、两次 Push、删分支），39 个 HTTP 200 和 2 个 HTTP 201；其中逐文件内容 GET 共 24 次。首轮 §3 的 38 次请求及两次校验异常保持独立，不混入本轮统计。

逐请求状态、实际编码路径、各文件新增 / 修改内容哈希及最终清理状态保存在 [T11 结构化证据](tfs-git-api-t11-paths-2026-11-12.evidence.json)。该文件不含凭据、认证头或业务源码。报告中的 PASS 不扩大为 Web UI、低权限账号、其他未列出字符、文件重命名或本地文件系统兼容性通过。
