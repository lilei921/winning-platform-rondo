# TFS Git 远程分支与文件读写能力验证方案

> 日期：2026-11-12\
> 项目：Multica / Rondo\
> 执行环境：企业内网 Windows + PowerShell（本地 Codex 可辅助执行）\
> 范围：**TFS Git / Azure DevOps Server Git 的远程 REST API**；不涉及 GitHub，不要求本地 Clone、Checkout 或 Git worktree。\
> 状态：**2026-11-12 已完成 T01–T09、T11 的 API 功能实测；T10、T12 未执行。** T11 已用另一独立分支补齐中文、空格、#、% 及组合路径读写并清理。实际使用 Python 客户端及 API 4.0，未运行本文 PowerShell 脚本，认证方式与本文要求的差异及异常恢复详见[验证结果](./TFS-Git-Remote-Validation-Result.md)。下文保留原方案设计，不代表所有前置条件与脚本已经验收。

## 1. 验证目标与边界

验证以下问题是否在当前企业 TFS Git 仓库中真实可用：

1. **远程读**：通过 REST API 查询 Git 仓库、分支 HEAD 和指定文件内容。
2. **远程建分支**：基于现有基准分支 Commit SHA 创建独立测试分支，不进行本地 Clone。
3. **远程写**：在测试分支新增和修改文件，通过 `Pushes - Create` 自动生成 Commit，随后读回校验。
4. **并发保护**：使用 `oldObjectId` 执行乐观并发检查，旧 SHA 提交应被拒绝，不应覆盖新提交。
5. **远程 PR**：从测试分支创建指向基准分支的 Pull Request，并读取 PR ID/状态；**不得合并**。
6. **清理**：将测试 PR 标记为 `abandoned`，删除测试分支，核实基准分支未被测试脚本写入。

### 明确不验证

- 不验证本地 Git Clone、worktree、`rondo dev prepare`、编译、单元测试或运行时执行。
- 不修改生产源码、已有 `tasks.md`、OpenSpec 文件或业务分支。
- 不将测试 PR 合并到 `main` / `dev` / `master`。
- 不验证 MCP Transport；此处验证的是 **TFS Git REST API 能力**，未来是否包装为 Rondo CLI 或 MCP，另行决策。
- 不把 Azure DevOps Services 云端 API 的功能直接等同于企业内部旧版 TFS 的实测能力。

## 2. 前置条件

### 2.1 服务器与目标仓库

从 Web UI / 管理员获取以下实际配置（不要猜测）：

| 参数 | 说明 | 示例（占位） |
|---|---|---|
| `CollectionUrl` | 已包含 TFS Collection 的 URL | `https://tfs.example.local/tfs/DefaultCollection` |
| `Project` | Team Project 名称或 ID | `MyProject` |
| `Repository` | **TFS Git** 仓库名或 Repository ID | `MyBusinessRepo` |
| `BaseBranch` | 仓库已有分支；可为 `main`、`dev`、`master` | `dev` |
| `ApiVersion` | 该 TFS Server 实际支持的 REST API 版本 | `4.1` |
| `AuthMode` | `PAT` 或 `Windows`（集成认证） | `PAT` |
| `ReadPath` | 目标分支上已存在的文本文件 | `/README.md` |

**重要**：`CollectionUrl` 与 `Project` 不可重复拼接。REST API 的一般形态是：

```text
{CollectionUrl}/{Project}/_apis/git/repositories/{Repository}/{resource}?api-version={ApiVersion}
```

例如：

```text
https://tfs.example.local/tfs/DefaultCollection/MyProject/_apis/git/repositories/MyBusinessRepo/refs?api-version=4.1
```

该 URL 仅用于演示，请替换为企业实际路径。

### 2.2 版本适配

| 服务器版本 | 优先尝试的 API 版本 |
|---|---|
| TFS 2017 RTW / Update 1 / Update 2 | `3.0` / `3.1` / `3.2` |
| TFS 2018 RTW / Update 1 | `4.0` |
| TFS 2018 Update 2 / Update 3 | `4.1` |
| Azure DevOps Server 2019 | `5.0` |
| Azure DevOps Server 2020 | `6.0` |
| Azure DevOps Server 2022 | `7.0` |
| Azure DevOps Server 2022.1 | `7.1` |

> **兼容性注意**：微软现行统一 REST 参考以较新版本为主。随附脚本按 `Refs`、`Items`、`Pushes`、`Pull Requests` 常见 JSON 契约编写，推荐先在 **TFS 2018（API 4.0/4.1）及更高版本**的测试仓库尝试；TFS 2017 及更旧版本需先核对对应历史 API 文档、认证方式与响应格式，不应直接认定脚本兼容。即便服务器版本满足条件，也需以实际请求结果为准。

### 2.3 身份与权限

最小权限原则：对**测试仓库**或可受控的分支授予验证账号必要权限。

- 读取：`Read`。
- 创建测试分支：`Create branch`。
- 在测试分支提交文件：`Contribute`，并确保分支级权限允许。
- 创建、放弃 PR：满足项目的 Pull Request 权限及分支策略。
- 清理测试分支：满足删除分支所需权限；具体由 TFS Server 版本与仓库权限决定。

推荐使用专用测试仓库；如使用业务仓库，务必采用唯一命名的隔离测试分支，且禁止合并测试 PR。

**安全要求**：

- PAT 只在 PowerShell 交互式提示中输入；不要写入 Markdown、命令行参数、仓库文件或日志。
- 使用 PAT 时必须通过 HTTPS；如内部 TFS 仅提供 HTTP，请先配置受信任 HTTPS 入口，或经管理员批准评估 `Windows` 集成认证，不得在明文 HTTP 上传 PAT。
- 不要将 TFS 内部地址、PR 内容或企业源码公开上传到外部系统。
- PowerShell 5.1 / 7+ 均可用于测试；脚本未在企业实际 TFS 环境中执行验证。

## 3. 测试设计

### 3.1 核心验证矩阵

| ID | 优先级 | 验证项 | 接口 | 预期结果 |
|---|---|---|---|---|
| T01 | P0 | 查询 Repository | `GET /repositories/{id}` | 返回正确的仓库 ID 与名称 |
| T02 | P0 | 查询基准分支 HEAD | `GET /refs?filter=heads/<base>` | 返回精确分支与 40 位 Commit SHA |
| T03 | P0 | 读取已有文本文件 | `GET /items` | 分支、路径、文件内容正确 |
| T04 | P0 | 创建测试分支 | `POST /refs` | `success=true`；新分支 HEAD 等于基准 SHA |
| T05 | P0 | 远程新增文件并 Commit | `POST /pushes` | 新 Commit 出现；文件读回内容一致 |
| T06 | P0 | 远程修改文件并 Commit | `POST /pushes` | HEAD 再次变化；修改内容读回一致 |
| T07 | P0 | 创建 PR | `POST /pullrequests` | 返回 PR ID；来源、目标分支正确；未合并 |
| T08 | P0 | 放弃 PR 并清理分支 | `PATCH /pullrequests/{id}`、`POST /refs` | PR 为 `abandoned`；测试分支不存在 |
| T09 | P1 | 旧 HEAD 并发写入检查 | `POST /pushes` | 旧 `oldObjectId` 被拒绝，分支 HEAD 不变 |
| T10 | P1 | Web UI 可观察性 | TFS Web UI | 能看到测试分支、Commit、PR 及清理结果 |
| T11 | P1 | 中文/特殊字符文件 | `POST /pushes` + `GET /items` | UTF-8、路径转义准确（追加专项验证） |
| T12 | P1 | 权限边界 | 低权限账号 | 仅有 Read 权限不能建分支或写入（追加专项验证） |

T01–T08 构成远程读写和 PR 的最小闭环。T09 关系到未来 `tasks.md` 安全更新，应在架构决策前完成。

### 3.2 约定的隔离命名

脚本会自动生成唯一名称：

```text
测试分支：refs/heads/verify/multica-remote-git-<timestamp>-<random>
测试文件：/.multica-validation/tfs-remote-git-<timestamp>-<random>.md
PR 标题：[VALIDATION - DO NOT MERGE] TFS REST API <run-id>
```

**所有文件写入仅发生在测试分支。** 建分支之前先读取基准分支的 SHA，测试期间无任何针对基准分支的 Push 请求。

## 4. 执行步骤（推荐：PowerShell 脚本）

原方案引用脚本：`validate-tfs-git-remote.ps1`。本次迁移的文档中未附该脚本；实际验证使用 Python HTTP 客户端，详见验证结果。

脚本按 `ReadOnly` → `Full` → `Cleanup` 三个阶段执行，**不会自动启动清理，也不会合并 PR**。`Full`、`Cleanup` 需要明确的写入/清理开关。

### Step 0：准备执行环境

将 Markdown 文件和 `.ps1` 放到同一目录。启动 PowerShell，切换到该目录，确认可连接企业 TFS Server：

```powershell
$PSVersionTable.PSVersion
Get-ChildItem .\validate-tfs-git-remote.ps1

# 在 Windows PowerShell 的当前进程内允许执行本脚本（如企业策略允许）
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

如果企业禁止修改脚本执行策略，遵守企业安全策略，不要强行绕过。

### Step 1：设置实际参数

```powershell
$common = @{
    CollectionUrl = 'https://tfs.example.local/tfs/DefaultCollection'
    Project       = 'MyProject'
    Repository    = 'MyBusinessRepo'
    BaseBranch    = 'dev'
    ApiVersion    = '4.1'     # 以真实 TFS Server 版本为准
    AuthMode      = 'PAT'     # 或 Windows
    StateFile     = '.\tfs-remote-git-validation-state.json'
}

# 必须替换为基准分支上真实存在的文本文件：
$readPath = '/README.md'
```

如果 `AuthMode='PAT'`，脚本启动时提示隐藏输入 PAT。请勿将其作为参数写在命令历史中。

### Step 2：只读验证（T01–T03）

```powershell
.\validate-tfs-git-remote.ps1 @common -Mode ReadOnly -ReadPath $readPath
```

**检查**：

- `[PASS] repository resolved`；仓库 ID/名称与 TFS Web UI 一致。
- `[PASS] base branch resolved`；分支名正确，SHA 为 40 位。
- `[PASS] read existing file`；路径正确，并与 Web UI 中同分支文件内容对应。
- `[DONE] Read-only validation completed`；未发生任何写入。

如果失败，**先停止**；排查 URL、Collection、Project、Repository、BaseBranch、API 版本、身份认证和 Read 权限，不要继续执行写操作。

### Step 3：完整远程写入验证（T04–T07、可选 T09）

```powershell
.\validate-tfs-git-remote.ps1 @common `
    -Mode Full `
    -ReadPath $readPath `
    -AllowWrite `
    -TestStaleHead
```

该命令按以下顺序执行：

1. 再次读取 Repository 与基准分支；
2. 建立唯一测试分支：`POST /refs`，从基准 HEAD SHA 派生；
3. 在测试分支新增测试 Markdown：`POST /pushes`，产生第一个 Commit；
4. 通过 `GET /items` 按测试分支读取并校验全文；
5. 修改同一测试 Markdown：`POST /pushes`，产生第二个 Commit；
6. 再次读回校验全文；
7. 若开启 `-TestStaleHead`，使用已经过期的 HEAD SHA 重试提交，应被拒绝；
8. 创建仅供验证的 PR，来源为测试分支，目标为原基准分支；
9. 记录结果与 PR ID，不合并、不自动完成 PR。

**重要判定**：

- 建分支响应不能只看 HTTP 200，要检查 `success=true` 且 `updateStatus=succeeded`。
- 每次 Push 后，都应再次获取分支 HEAD，检查产生新的 Commit SHA，且 `GET /items` 返回的内容与写入的完整文本一致。
- `oldObjectId` 必须是写入前真实的目标分支 HEAD，不能使用基准分支固定 SHA 反复覆盖。
- 并发负面测试的 HTTP 400/409 只是候选现象；还要结合错误消息确认是**旧 HEAD / ref mismatch / non-fast-forward**，不能把无关参数错误算作通过。
- PR 必须有返回的 `pullRequestId`，源分支、目标分支正确；**不调用 PR Complete**。

脚本会保存本地状态文件 `tfs-remote-git-validation-state.json`（不含 PAT），用于审计和安全清理。**如果中途失败，不要重复执行 `Full` 并覆盖状态文件；先检查该文件、远程分支和 PR。**

### Step 4：在 TFS Web UI 核实（T10）

检查：

- 测试分支存在且以 `verify/multica-remote-git-...` 命名；
- 分支 Commit 历史至少包含两次测试文件变更；
- 最新测试文件内容包含 `Stage: edited` 和 `Verified: true`；
- PR 为测试标题，源/目标分支正确，可见文件 Diff；
- PR 未合并，基准分支没有测试文件。

如果当前 TFS Web UI 带有“Edit file / Commit”功能，也可以**仅在测试分支上**手动验证在线编辑。Web UI 编辑是可选项目，不影响 REST API 能力的独立结论。

### Step 5：放弃 PR、删除测试分支（T08）

核实 PR 仍未合并、测试分支没有其他人的提交后，单独执行：

```powershell
.\validate-tfs-git-remote.ps1 @common -Mode Cleanup -AllowCleanup
```

脚本会先校验状态文件对应的仓库/分支，并确认测试分支 HEAD 未被他人改变，然后：

1. 如果测试 PR 为 `active`，PATCH 为 `abandoned`；
2. 使用当前记录的测试分支 HEAD 作为 `oldObjectId`，以全零 SHA 为 `newObjectId`，删除测试分支；
3. 再次查询 refs，确认测试分支已不存在；
4. 将本地状态文件标记为 `Cleaned`，作为验证记录保留。

如果 PR 已被合并、分支 HEAD 发生变化或状态不一致，脚本**拒绝自动清理**，改由人工检查。

## 5. REST API 最小契约（便于 Codex 排查）

以下路径中的 `{repoApi}` 为：

```text
{CollectionUrl}/{Project}/_apis/git/repositories/{Repository}
```

### 5.1 查询分支

```http
GET {repoApi}/refs?filter=heads/dev&api-version=4.1
```

响应中找到 `name == "refs/heads/dev"` 的**精确匹配项**，记录 `objectId`。注意 `filter` 是前缀过滤，不能把 `dev-feature` 误判为 `dev`。

### 5.2 创建分支

```http
POST {repoApi}/refs?api-version=4.1
Content-Type: application/json
```

```json
[
  {
    "name": "refs/heads/verify/example-unique-name",
    "oldObjectId": "0000000000000000000000000000000000000000",
    "newObjectId": "<BASE_BRANCH_HEAD_SHA>"
  }
]
```

只有 `newObjectId` 指向的 Commit 在仓库中确实存在，才应创建成功。

### 5.3 直接新增文件并提交

```http
POST {repoApi}/pushes?api-version=4.1
Content-Type: application/json
```

```json
{
  "refUpdates": [
    {
      "name": "refs/heads/verify/example-unique-name",
      "oldObjectId": "<CURRENT_TEST_BRANCH_HEAD_SHA>"
    }
  ],
  "commits": [
    {
      "comment": "[validation] add test file",
      "changes": [
        {
          "changeType": "add",
          "item": { "path": "/.multica-validation/test.md" },
          "newContent": {
            "content": "# Remote API validation\nStage: added\n",
            "contentType": "rawtext"
          }
        }
      ]
    }
  ]
}
```

修改现有文件时，`changeType` 改为 `edit`，传入**修改后的完整文件内容**，并将 `oldObjectId` 更新为**刚查询到的测试分支最新 SHA**。这不是文本 Patch API。

### 5.4 读取指定分支上的文件

```http
GET {repoApi}/items?path=%2F.multica-validation%2Ftest.md&versionDescriptor.versionType=branch&versionDescriptor.version=verify%2Fexample-unique-name&includeContent=true&%24format=json&api-version=4.1
```

必须明确 `versionDescriptor.versionType=branch` 与 `versionDescriptor.version`，防止意外读取默认分支。路径和分支参数都应 URL Encode。

### 5.5 创建测试 PR

```http
POST {repoApi}/pullrequests?api-version=4.1
Content-Type: application/json
```

```json
{
  "sourceRefName": "refs/heads/verify/example-unique-name",
  "targetRefName": "refs/heads/dev",
  "title": "[VALIDATION - DO NOT MERGE] TFS REST API",
  "description": "Remote REST API test only. Do not merge."
}
```

### 5.6 清理 PR 与分支

```http
PATCH {repoApi}/pullrequests/{pullRequestId}?api-version=4.1
Content-Type: application/json
```

```json
{ "status": "abandoned" }
```

删除分支：

```http
POST {repoApi}/refs?api-version=4.1
Content-Type: application/json
```

```json
[
  {
    "name": "refs/heads/verify/example-unique-name",
    "oldObjectId": "<CURRENT_TEST_BRANCH_HEAD_SHA>",
    "newObjectId": "0000000000000000000000000000000000000000"
  }
]
```

> 上述 `api-version=4.1` 仅用于举例，不是所有 TFS Server 的通用值。执行时必须使用真实兼容版本。

## 6. 常见失败及判定

| 现象 | 主要排查点 | 是否说明该能力不支持 |
|---|---|---|
| 401 | PAT 无效、过期、认证方式不匹配；Windows 域认证失败 | 否，先修复认证 |
| 403 | 缺少 `Read`、`Contribute`、`Create branch` 或 PR 权限 | 否，属于授权问题 |
| 404 | Collection/Project/Repository 错误、分支或文件不存在；API 路径不兼容 | 待确认 |
| 400 | API 版本不匹配、JSON 契约不支持、分支策略限制、字段错误 | 待确认，查看响应体 |
| 409 / ref mismatch | 旧 `oldObjectId` 导致并发拒绝 | 对 T09 是预期行为（须核对错误内容） |
| PR 无法创建 | TFS 版本、PR 功能、权限、策略或目标仓库 | 独立记录，不能推断写文件失败 |
| Push 成功而读回内容不一致 | 分支/路径错误、文件内容编码或响应格式问题 | 不通过 |
| 清理失败 | PR 状态变化、HEAD 被他人更新、权限不足 | 不得强删；人工处理 |

**不要**通过关闭证书校验、全局禁用分支策略、开放生产主分支写权限等方式把测试“做通过”。

## 7. 验证报告模板

请 Codex 在同目录生成 `TFS-Git-Remote-Validation-Result.md`，至少保留如下信息：

```markdown
# TFS Git 远程 REST API 验证结果

- 验证日期：
- TFS Server 产品/版本：
- API 版本：
- Collection/Project/Repository：
- 认证方式：PAT / Windows（禁止记录密钥）
- 基准分支：
- 基准 HEAD（测试前/后）：
- 测试分支：
- 测试文件：
- 新增 Commit SHA：
- 修改 Commit SHA：
- PR ID / 状态：
- 清理结果：

| ID | 状态（PASS / FAIL / BLOCKED / NOT RUN） | 证据（HTTP 状态、摘要、截图或链接） | 备注 |
|---|---|---|---|
| T01 | | | |
| T02 | | | |
| T03 | | | |
| T04 | | | |
| T05 | | | |
| T06 | | | |
| T07 | | | |
| T08 | | | |
| T09 | | | |
| T10 | | | |
| T11 | | | |
| T12 | | | |

## 结论

- 是否支持无 Clone 远程读：
- 是否支持无 Clone 远程分支创建：
- 是否支持无 Clone 远程增改文件 + Commit：
- 是否支持远程 PR 创建和清理：
- 乐观并发冲突防护是否可用：
- 阻塞项与最小修复建议：
- 对 Multica / Rondo 的建议：
```

报告不要包含 PAT、Authorization 请求头、完整源码内容或其他敏感凭据。

## 8. 对 Multica / Rondo 的设计决策规则

完成验证后再决定如何接入，不预先扩大 Agent 职责。

| 验证结果 | 对应建议 |
|---|---|
| T01–T03 通过 | 可评估以 TFS REST API 提供远程源码与 OpenSpec 文档读取，Lead 不依赖本地 Git。 |
| T04–T06、T09 通过 | 可评估将受控的 `tasks.md` 更新、简单文本变更封装为 Rondo 的确定性远程 Git 方法，使用 SHA 乐观锁。 |
| T07–T08 通过 | PR 创建、查询、放弃及分支生命周期可以交给外部确定性工具，不必把 Git 工作区管理分配给 Delivery Lead。 |
| 有读无写 | 继续使用远程只读接口；写入仍由既有本地 Git / Rondo 流程负责。 |
| 版本或权限不支持 | 记录精确失败接口、请求/响应信息；不要为了追求“纯远程”而破坏既有研发流程。 |

即便远程写入全部通过，**Engineer 的本地编译、测试、调试及多文件开发仍然可以保留 `rondo dev prepare`**。本验证不代表要以 REST API 全面替代本地工程执行。

## 9. 交给本地 Codex 的执行指令

> 请阅读 `TFS-Git-Remote-REST-API-Validation-Plan-2026-11-12.md`，使用 `validate-tfs-git-remote.ps1` 对企业 TFS Git 仓库进行远程 Git REST API 验证。
>
> 1. 先识别实际 Server 版本、Collection URL、Project、Repository、基准分支和可读取文件；PAT 由操作人员在终端交互输入，不得读取或记录明文密钥。
> 2. 先执行 `ReadOnly` 并核实 T01–T03；不通过则停止，不继续写入。
> 3. 再在明确授权后执行 `Full -AllowWrite`，且仅操作唯一 `verify/multica-remote-git-*` 测试分支；不得修改既有业务代码或 OpenSpec 文件；绝不合并测试 PR。
> 4. 逐项判定 T04–T10，不能仅凭 HTTP 2xx 判定成功。T11–T12 视条件追加。
> 5. 检查 PR 未合并与分支 HEAD 后执行 `Cleanup -AllowCleanup`；失败必须保留现场记录，不能强制删除。
> 6. 输出 `TFS-Git-Remote-Validation-Result.md`，说明是否可以用 TFS REST API 替换 Rondo 的部分远程读写操作，以及明确仍需本地 `rondo dev prepare` 的边界。
> 7. **本次任务仅验证，不修改 Multica Agent、Skill、Rondo 源码或现有方案文档。**

## 10. 官方参考

- [REST API 与 TFS/Azure DevOps Server 版本映射](https://learn.microsoft.com/en-us/rest/api/azure/devops/)
- [REST API Versioning](https://learn.microsoft.com/en-us/azure/devops/integrate/concepts/rest-api-versioning)
- [Git Refs - List](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/refs/list?view=azure-devops-rest-7.1)
- [Git Refs - Update Refs（创建/删除分支）](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/refs/update-refs?view=azure-devops-rest-7.1)
- [Git Items - Get](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/items/get?view=azure-devops-rest-7.1)
- [Git Pushes - Create（无 Clone 提交文件）](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pushes/create?view=azure-devops-rest-7.1)
- [Git Pull Requests - Create](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/create?view=azure-devops-rest-7.1)
- [Git Pull Requests - Update](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/update?view=azure-devops-rest-7.1)

**注意**：参考链接展示 7.1 版本契约；企业 TFS 2017/2018 等旧版必须切换到对应历史文档，并以实测为准。
