# datamodel SQL 错误提示问题：三个 remote MCP 的验证记录

记录整理日期：2026-11-12。  
性质：**已发生的远程静态代码分析案例**；不是实施计划，也不是 Multica 跨 runtime 交付验收。  
结果：三个 remote MCP 完成跨前后端仓库定位、源码与调用链分析，并输出修改建议；未修改业务代码。

> 历史基线：正文第 1–5 节保留 2026-11-12 的调用事实、结论与未验证项。2026-11-14 复核后，当前执行规则以 [08-A §2.2 / §4](../08a-remote-analysis-bug-fix-foundation.md)为准：业务源码优先 `remote-codegraph`、`remote-filesystem`、`remote-ripgrep`；TFS Git API 仅在 MCP 不可用或明确需要最新 / 历史版本时按需兜底。本文历史路径、固定版本建议及统计不构成额外的 P0 实施或验收要求。

## 1. 验证任务与来源

工作项标题：GA2612 封版测试——【数据模型】数仓可视化错误提示不明确；SQL 或自定义 SQL 写错时，仅提示系统异常，未提示具体错误。

用户提供的环境：[数据工厂测试页面](http://172.17.0.56:8888/webui-datafactory/product)，院区为卫宁集团。未提供可核对的工作项编号、现场接口响应、异常日志及部署 commit。

当时约束：**仅使用 codegraph-remote、filesystem-remote、ripgrep-remote 完成定位，说明涉及仓库、类及修改方案，暂不修改。**

| 来源项 | 标识 |
| --- | --- |
| 原始会话 | `01a1cdc2-c520-70b3-9a80-6218878a09bb`，标题“排查同步脚本与 workflow 问题” |
| Bug 分析 turn | `01a1ce42-c357-70a2-aaf9-44055696b8ac` |
| 分析时间 | 2026-11-12 13:37:24–13:41:06，Asia/Shanghai |
| 子仓图谱确认 turn | `01a1ce58-0d15-77e1-81e1-b62970f2bd84` |
| 本记录依据 | 上述 turn 的用户要求、24 条 MCP 调用参数与完成状态、公开进度及最终分析结论；2026-11-12 从会话记录回查整理 |

本次整理没有重新执行当年的查询来替代历史结果。会话读取接口没有返回这些 MCP 调用的完整原始响应正文，因此以下代码发现按当时分析结论记录；调用参数与状态可以交叉核对。未把无法从本次读取结果恢复的 SHA、索引摘要或返回正文补写成确定值。原会话含认证配置，不将整份会话复制到仓库。

## 2. 实际使用的工具与过程

分析 turn 中记录了 24 次 MCP 调用，全部调用状态为 `completed`：CodeGraph 9 次、filesystem 6 次、ripgrep 9 次。此状态表示调用完成，不单独等于每个检索命中或业务判断通过。

| 步骤 | 实际工具与输入 | 作用 / 当时结果 |
| --- | --- | --- |
| 选仓 | filesystem `read_multiple_files` 读取根仓 `docs/config/repo-context.yaml`、`docs/router/overview.md`；ripgrep 搜索 datamodel 页面映射 | 从职责与页面入口定位数据模型前后端 |
| 确认目录 | filesystem 分别列出 datamodel 和 datamodel-web 子仓目录 | 确认目标仓存在；当时后续说明确认后端仓存在 `.codegraph` |
| 语义定位 | CodeGraph 对两个子仓分别查询“数仓 可视化 自定义SQL” | 定位 `visualQuery` / `dataVisual`，没有只在根仓做泛化检索 |
| 前端调用链 | CodeGraph 查询 `handleExecuteQuery getExecuteParams executeQuery`；ripgrep 搜索自定义脚本和请求层 | 关联输入组件、执行参数、查询接口及统一错误展示边界 |
| 后端执行链 | CodeGraph 查询 `VisualDataQueryController.query`、`VisualDataQueryServiceImpl.dynamicQuery` 等；ripgrep 搜索 catch / throw / 方法签名 | 核对 JDBC、SQL 异常处理、Controller 响应封装 |
| 分支与依赖 | filesystem 读取两仓 `.git/HEAD`、`refs/heads/dev` 和前端 package.json；ripgrep 查询相关 Git 日志 | 当时结论基于远程 dev 工作区；未建立它与 GA2612 部署版本的对应关系 |
| 测试与导出 | CodeGraph 查询 `VisualDataQueryServiceImplTest`、`SqlBuilderUtil.buildJoinCondition`、`exportData`、`executeDynamicDatasourceExport` | 发现查询专项测试已存在，以及导出链路仍丢失错误详情 |

源码定位过程中未调用本地 shell 读取业务代码，未使用浏览器或数据库工具，也未使用其他 MCP。这里统计的范围是该 Bug 分析 turn，不包含此前的连接配置和之后的方案编写。

### CodeGraph 子仓查询的实际参数

以下为当时调用记录中的真实参数，不是为方案编造的示例：

```json
{
  "projectPath": "/root/winning-platform-monorepo/winning-dps-df-datamodel",
  "query": "VisualDataQueryServiceImpl.dynamicQuery",
  "maxFiles": 1
}
```

对应调用 ID：`exec-569efd2e-e99e-4266-8a0f-2818d0aa4ce1`。当时分析及后续确认指出，返回包含带行号源码、调用关系及相关测试线索。另一次按测试文件路径查询的调用 ID 为 `exec-8b50288e-8745-4c34-95ad-2690198fc5d1`。

当时服务配置根目录为 `/root/winning-platform-monorepo`，不妨碍通过 `projectPath` 定位子仓。用户后续消息中的 `inning-dps-df-datamodel` 少了首字母 `w`；当时实际查询成功的路径为 `winning-dps-df-datamodel`。该绝对路径仅为历史调用证据，当前访问须实时取得 MCP 授权根目录，不能直接复用它或本地 Task 的 checkout 路径。

该案例证明“根目录配置 + 显式子仓路径”能够完成这次查询；它没有证明任意子仓都已建图、任意索引均新鲜，或接口支持按 commit 自动选择源码。固定源码 / 索引版本是当时目标方案的要求，当前必要的版本记录与一致性处理以 08-A 为准。

## 3. 定位到的仓库与类

下列路径均为仓库内相对路径，指向**当时分析的远程工作区**，不是当前本机 checkout 的定位承诺。

| 仓库 | 路径 / 类 | 作用 |
| --- | --- | --- |
| `winning-dps-df-datamodel-web` | `src/views/dataModel/visualQuery/components/TableRelation.vue` | 自定义脚本输入 |
| 同上 | `src/views/dataModel/visualQuery/components/QueryCondition.vue` | `getExecuteParams()` 把脚本转为 `joinList[].andConditions` |
| 同上 | `src/views/dataModel/visualQuery/index.vue` | `handleExecuteQuery()` 发起查询，错误展示交给公共请求层 |
| 同上 | `src/api/visualQuery/index.js` | 查询和导出 API |
| `winning-dps-df-datamodel` | `winning-dps-df-datamodel-service/src/main/java/com/winning/dps/df/datamodel/dataVisual/util/SqlBuilderUtil.java` | 拼装字段、关联条件和自定义 SQL |
| 同上 | `winning-dps-df-datamodel-service/src/main/java/com/winning/dps/df/datamodel/dataVisual/service/impl/VisualDataQueryServiceImpl.java` | 查询、COUNT、导出与 JDBC 异常处理 |
| 同上 | `winning-dps-df-datamodel-service/src/main/java/com/winning/dps/df/datamodel/dataVisual/controller/VisualDataQueryController.java` | 查询结果及下载响应 |
| 同上 | `datamodel-common` 模块内的 `util.ApiResult` | 错误封装为 `{code: 1, msg: …}` |
| 同上 | `winning-dps-df-datamodel-service/src/test/java/com/winning/dps/df/datamodel/dataVisual/service/impl/VisualDataQueryServiceImplTest.java` | SQL 异常与正常查询的专项测试源码 |

`datamodel-common` 是数据模型仓内部模块，不是独立的 `winning-dps-df-common` 仓库。当时观察的查询链路直接使用 JDBC，未发现经过数据集成或数据引擎服务；这一结论限于该执行链路。

## 4. 当时的分析发现

### 4.1 查询主链路

```text
自定义脚本
→ QueryCondition.getExecuteParams()
→ handleExecuteQuery()
→ POST /api/v2/visualization/query
→ VisualDataQueryController.query()
→ VisualDataQueryServiceImpl.dynamicQuery()
→ executeDynamicDatasourceQuery()
→ JDBC 查询 / COUNT 查询
```

当时源码显示：

- 自定义脚本内容进入 `andConditions`，随后拼入 JOIN 条件；语法错误可以在数据库执行时产生 SQL 异常。
- 查询执行方法已经单独捕获并原样抛出 `SQLException`；`dynamicQuery()` 将其转换为包含数据库详情的“SQL执行失败”消息并保留 cause。
- Controller 使用 `ApiResult.error(e.getMessage())`，没有在此再次改成“系统异常”。
- 页面 catch 不重复弹窗，由公共请求层统一展示错误；实际公共依赖 `w-vue-middle/api/axios` 的实现没有核实。
- 测试源码已有自定义 SQL 语法错误、字段不存在、COUNT 失败、空错误消息和正常分页的覆盖。

因此，当时结论是**远程 dev 的查询主链路已经存在详情透传逻辑**，不能直接认定缺陷现场运行的是该版本，也不能认定现场根因已经锁定。

### 4.2 导出链路的确定性缺口

当时源码中 `executeDynamicDatasourceExport()` 将异常包装成“导出异常”，`exportData()` 再包装成“导出异常，请稍后重试”；Controller `download()` 仅设置 HTTP 400 / 500，没有返回具体错误正文。

这证明导出链路存在同类的信息丢失问题。原始重现描述没有明确提到导出，所以它是已定位的关联缺口，**不是已经证实的本次现场根因**。

### 4.3 当时提出的修改方向

1. 先核对 GA2612 发布包是否包含现有查询异常处理；缺失时纳入已有修复，已包含时结合实际异常栈检查包装分支。
2. 沿用 `code + msg` 契约，提供数据库能够返回的错误类型、对象及位置；生成 SQL 的位置不能直接映射为用户输入框位置。
3. 核对公共请求层是否展示响应 `msg`，确保具体错误只提示一次；不直接在页面叠加通用弹窗。
4. 导出 Service 保留 SQL 诊断，Controller 返回约定的错误体，前端识别错误响应而不是下载成 Excel。
5. 补充导出错误、前端消息展示和真实数据库联调验证；不暴露任意内部异常的敏感详情。

以上是当时的修改建议，本记录不表示已实施这些建议。

## 5. 验证结论及证据边界

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 三 remote MCP 共同完成一次业务源码定位 | 已验证 | 24 次调用记录与最终结果可核对 |
| 通过 registry / 路由选出前后端子仓 | 已验证 | 定位 datamodel、datamodel-web，并区分内部模块与独立仓库 |
| CodeGraph 显式指定 datamodel 子仓 | 已验证 | 真实调用参数及当时返回结论已记录 |
| 图谱、文本搜索、文件读取互相补足 | 已验证 | 形成输入、接口、JDBC、异常响应和测试源码的分析链 |
| 无本地业务源码读取、无业务代码修改 | 已验证（本次分析范围） | 该 turn 仅有三个 remote MCP 的读取 / 搜索调用 |
| 现场问题复现、接口响应、公共请求库行为 | 未验证 | 未访问页面、未取现场日志 / 响应 |
| 专项测试实际执行通过 | 未验证 | 只读取了测试源码，未运行测试 |
| GA2612 部署版本与分析源码一致 | 未验证 | 未取得发布版本映射 |
| 固定 commit、工作树无改动、索引与源码一致性 | 未形成完整验证证据 | 当时读取过 HEAD / dev refs，但本记录未恢复出 SHA；也没有完整的快照固定与索引新鲜度证明 |
| 服务端 supergateway 的真实进程参数、只读拒绝、鉴权负向测试 | 未验证 | MCP 可调用不能替代部署配置及安全边界验收 |
| Multica 多 runtime、并发 checkout、PR 与最终收口 | 未验证 | 本案例是单个 Codex 会话的远程静态分析 |

## 6. 历史结论与当前适用范围

本案例是[远程探索与 Git 工作区方案](../08-remote-analysis-git-workspace-design.md)的真实前置验证：远程 MCP 足以支持一次跨前后端的仓库定位、类 / 方法分析和修改建议，不要求 Agent 先检出业务代码到本机。

它同时暴露了版本限制：远程 dev 上已有处理，仍不足以解释测试环境现象。当时提出固定源码快照、记录完整 Commit、核对索引版本并关联发布版本；这些建议保留为历史方案背景。当前按 08-A 记录最少必要的仓库、分支、可取得版本及源码位置，说明未知或不一致；需要解释具体部署缺陷时再补对应版本证据，不要求每次分析固定快照或生成索引 / 性能报告。

仓库身份和相对路径取自 `docs/config/repo-context.yaml`；目标分支取自现有 Rondo Registry 的 `default_target_branch`，不能把远程镜像当前分支直接当作交付目标。MCP 授权根实时取得，再结合仓内相对路径定位服务器子仓；不新增一套仓库配置。

该记录独立于旧 bootstrap / 工作区 PoC，不复用其结果。原文引用的旧 08 方案“第 9 节”已由当前 [08-A §4](../08a-remote-analysis-bug-fix-foundation.md)及 [08-B §4](../08b-requirement-remote-git-delivery.md)的阶段验收取代；本案例没有完成这些跨 Runtime 验收，不能把本案例的已验证项目转换成新架构的完整通过状态。

## 7. 2026-11-14 本次会话只读探测

本次方案复核中，三个 Remote MCP 均完成最小只读调用：`remote-filesystem` 返回授权根 `/root/workspace/winning-platform-monorepo`，并读取远程 registry 与 datamodel HEAD / ref；`remote-codegraph` 显式指定该根下的 datamodel 子仓，取得 `VisualDataQueryServiceImpl.dynamicQuery` 带行号源码与调用线索；`remote-ripgrep` 在 datamodel-web 的 `package.json:49` 检出 `w-vue-middle: ^1.0.351`。

读取到的 datamodel 分支为 `dev`，ref 为 `0fced7354993d0eea6191f053c49c6b535d2070e`。这只是本次读取到的版本事实，不证明整个分析期间快照固定、工作树干净、全部索引一致或与部署版本一致；也不补写进 2026-11-12 的历史证据。

以上仅证明本次会话的调用可达性和局部读取能力，未执行写入、建索引、权限负向测试或真实 Multica Runtime 集成，不改变第 5 节历史验证状态。
