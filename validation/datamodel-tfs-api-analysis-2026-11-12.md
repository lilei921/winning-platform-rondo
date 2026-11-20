# datamodel 跨前后端静态分析：纯 TFS API 复验记录

验证及整理日期：2026-11-12，Asia/Shanghai。

性质：**已发生的只读静态分析复验**，不是业务修复、测试执行或 Multica 跨 Runtime 验收。

结果：仅从 TFS Git API 读取远端内容，在固定前后端 Commit 上复现原 MCP 案例的主要结论；本次分析未读取本地业务代码、未准备业务 Git 工作区、未修改或提交业务代码。

> 历史基线：本文保留 2026-11-12 的 API 复验事实、统计和结果，不作为当前默认源码访问流程。2026-11-14 复核后，当前执行规则以 [08-A §2.2 / §4](../08a-remote-analysis-bug-fix-foundation.md)为准：业务源码优先 `remote-codegraph`、`remote-filesystem`、`remote-ripgrep`；TFS Git API 仅在 MCP 不可用或明确需要最新 / 历史版本时按需兜底。旧 API-first、每次固定版本及请求计量要求不沿用为 P0 门槛。

## 1. 任务、依据与比较边界

同题复验：GA2612 封版测试——数据模型数仓可视化中，SQL / 自定义 SQL 写错只提示系统异常，未展示具体错误。用户提供的环境为[数据工厂测试页面](http://172.17.0.56:8888/webui-datafactory/product)，院区卫宁集团；未提供可核对的 TFS 工作项编号、现场响应、异常日志及部署 Commit。

基线为[原远程 MCP 验证记录](datamodel-remote-mcp-analysis-2026-11-12.md)。原分析会话 `01a1cdc2-c520-70b3-9a80-6218878a09bb`，分析 turn `01a1ce42-c357-70a2-aaf9-44055696b8ac`，2026-11-12 13:37:24–13:41:06，共 222 秒。原记录依据调用参数、完成状态与分析结论整理，未恢复完整原始 MCP 响应或可复核的完整源码 SHA。

本次依据当前会话的 TFS HTTP 响应、固定版本源码摘录和逐请求计量整理。**执行前已知原分析结论及部分文件 / 符号名称，是带先验信息的同题复验，不是盲测。** 两轮源码是否为同一 Commit 无法确认，不能用结果一致代替版本一致证明。本文不复制凭据或完整会话。

## 2. 实际访问方式与源码基线

使用现有环境凭据 `TFS_PAT`，通过 Python HTTP 客户端请求 TFS Git REST API `4.0`。客户端在 `C:\Users\lilei` 运行，采用 `-B -I`；业务源码只从 API 响应进入内存处理。未调用 Git、CodeGraph、filesystem / ripgrep MCP、浏览器或数据库读取业务代码。客户端运行在本机不等于读取本地 checkout；本记录与方案的后续本地 Markdown 编辑不属于源码分析请求。

先在线读取根仓 registry、路由与原案例，再核对业务仓身份、解析 `dev`、列目录和读取文件。映射文档未命中 `visualQuery`，随后依据目录候选及已知线索定位源码，不能将其描述成无提示的全仓语义发现。

| 来源 | 仓库身份与固定 Commit |
| --- | --- |
| 根仓上下文 | `winning-platform-monorepo`；`722c5ea1e96f941f6990c3cb709ae7eb93527649` |
| 后端 | `winning-dps-df-datamodel`；repository ID `ce714b07-8c1e-4789-ba2c-3a60e91de594`；`dev` → `e7113b38add646043372dd6af7886e9b30bd8fd0` |
| 前端 | `winning-dps-df-datamodel-web`；repository ID `6d499182-b58f-48cc-b738-977cfd1b8198`；`dev` → `506c2492393195306529c1816f1268d46821614f` |

业务仓位于 `http://tfs2018-web.winning.com.cn:8080/tfs` 的 `WN_Data_Platform` collection、`WiNEX_Data_Governance` project。根仓配置来源与业务仓所属项目分别核对，未以根仓项目猜业务仓地址。上述根仓版本的 registry 已含相关业务仓 `repo_url`；这不代表 GitHub 协作分支及所有 Runtime 的 registry 工具均已支持该字段。

复验使用的请求形态如下，认证仅经请求头传递，省略凭据：

```text
GET {project-base}/_apis/git/repositories/{repository}?api-version=4.0
GET {project-base}/_apis/git/repositories/{repository}/refs?filter=heads/dev&api-version=4.0
GET {project-base}/_apis/git/repositories/{repository}/items?scopePath=/&recursionLevel=Full&versionDescriptor.versionType=commit&versionDescriptor.version={sha}&api-version=4.0
GET {project-base}/_apis/git/repositories/{repository}/items?path={encoded-path}&includeContent=true&versionDescriptor.versionType=commit&versionDescriptor.version={sha}&api-version=4.0
```

所有业务目录 / 文件请求均绑定完整 Commit；最终后端文件响应的 `commitId` 也与指定 SHA 一致。后端目录返回 659 条、前端 275 条条目，包含目录元数据，不是源码文件覆盖数。两个 SHA 只构成分析快照集合，未证明属于同一部署组合。

## 3. 固定版本上的静态证据

以下均为上述远端 Commit 的仓内相对路径与行号，**不是本机文件引用**。后端 `dataVisual/` 的完整前缀为 `winning-dps-df-datamodel-service/src/main/java/com/winning/dps/df/datamodel/dataVisual/`。

| 环节 | 远端源码位置 | 实际发现 |
| --- | --- | --- |
| 自定义 SQL 输入 | 前端 `src/views/dataModel/visualQuery/components/TableRelation.vue:129–134,309–315` | 文本绑定 `cond.content`，支持添加脚本条件 |
| 查询参数 | 前端 `src/views/dataModel/visualQuery/components/QueryCondition.vue:456–505` | `getExecuteParams()` 构造 `joinList`，484–490 将脚本去空白后加入 `andConditions` |
| 页面请求 | 前端 `src/views/dataModel/visualQuery/index.vue:928–977` | `handleExecuteQuery()` 组装参数并调用 `executeQuery`；971–973 的空 catch 注释说明错误交给请求层处理，避免重复提示 |
| 实际 API 与请求层入口 | 前端 `src/api/visualQuery/index.js:1–2,466–489` | 使用 `w-vue-middle/api/axios`；查询为 `/api/v2/visualization/query`，导出为 `/download` 且 `responseType=blob`；本地 `./axios` 导入被注释 |
| SQL 拼装 | 后端 `dataVisual/util/SqlBuilderUtil.java:52,144–163` | 将自定义 `andConditions` 加入 JOIN 条件并以 AND 连接 |
| 查询执行 | 后端 `dataVisual/service/impl/VisualDataQueryServiceImpl.java:206–281` | 直接取得 JDBC Connection，构造 SQL、prepare / execute、执行 COUNT；SQLException 在该层继续抛出 |
| COUNT 路径 | 同文件 `:332–343` | COUNT 使用 JDBC、try-with-resources；该方法未 catch 后替换异常消息 |
| SQL 异常提示 | 同文件 `:169–178` | SQLException 有消息时包装为“SQL执行失败：”加原消息；空消息给检查条件 / 自定义 SQL 的提示。其他 Exception 使用“服务异常，请稍后重试” |
| Controller 与响应体 | 后端 `dataVisual/controller/VisualDataQueryController.java:38,78–106`；`winning-dps-df-datamodel-common/src/main/java/util/ApiResult.java:59–64` | 查询入口调用 `dynamicQuery`，catch 后 `ApiResult.error(e.getMessage())`；响应封装为 code=1 与 msg。common 是本后端仓内模块，不是额外独立仓 |
| 导出异常损失 | 后端 `dataVisual/service/impl/VisualDataQueryServiceImpl.java:458–461,505–507`；Controller `:134–158` | 导出服务仍包装通用“导出异常”提示；Controller 的异常分支仅设置 400 / 500，未在这些分支写出结构化错误正文 |
| 导出前端处理 | 前端 `src/views/dataModel/visualQuery/index.vue:995–1019` | 当前导出处理把返回数据包装为 Blob 下载；该处理函数未解析错误正文。共享请求拦截器的处理仍未知 |
| 已有测试源码 | 后端 `winning-dps-df-datamodel-service/src/test/java/com/winning/dps/df/datamodel/dataVisual/service/impl/VisualDataQueryServiceImplTest.java:104–188` | 包含语法 / 字段 / COUNT 错误、cause、空消息、非 SQL 异常、后处理、参数校验和成功路径的测试定义；本次未运行 |

还读取了前端 `CLAUDE.md`、`package.json`、`ResultTable.vue` 与未启用的 `src/api/visualQuery/axios.js`，用于规范、依赖和调用边界核对。`package.json:49` 声明 `w-vue-middle` 为 `^1.0.351`，不等于部署时实际安装版本；不能把未启用的 axios 文件当作真实公共拦截器。

由以上证据得到：

1. **查询主链已具备 SQL 详情透传。** 当前固定 `dev` 源码支持该判断，不能据此认定 GA2612 已部署修复，或认定现场通用错误必由同一 catch 产生。
2. **导出链有明确的信息损失环节。** 与原 MCP 结论一致，但原现场描述未明确发生在导出操作，不能把它写成已证实的现场根因。
3. **公共请求层仍是缺口。** 实际导入的共享包实现、部署版本和现场响应均未核实，不能确认最终弹窗展示内容。
4. 已读取的查询链直接使用 JDBC，未观察到该链转发 dataengine / dataintegration；这不是全项目调用关系排除证明。

后续修复前应先核对部署 SHA、实际接口响应与日志。若确认涉及导出，再联合处理服务异常详情、Controller 错误正文和前端 Blob 错误识别，保持单次提示及一致错误契约。不能将所有非 SQL 异常无差别暴露，也不能把数据库报错位置直接当作用户输入框的准确位置。本次没有实施这些建议。

## 4. 请求数、耗时与 MCP 比较

### 4.1 本次请求账本

| 阶段 | HTTP GET 次数 | HTTP 耗时合计 | 响应正文 bytes | 计量说明 |
| --- | ---: | ---: | ---: | --- |
| 上下文准备 | 3 | 约 0.247 秒 | 未纳入正式汇总 | 根仓原案例、registry、路由；在正式计时前 |
| 首轮预探测 | 7 | 未保留可复核分项统计 | 未纳入正式汇总 | 身份 / ref / 目录 / 映射；输出过大截断，后续重新请求 |
| 正式：映射、仓库身份、ref、目录 | 7 | 0.5668 秒 | 602,022 | 1 个映射 + 2 个身份 + 2 个 ref + 2 个目录 |
| 正式：首次源码 / 元数据读取 | 13 | 1.9177 秒 | 218,594 | 后端 5 个、前端 8 个不同文件 |
| 正式：补证与重读 | 7 | 1.1766 秒 | 192,660 | 补充上下文、恢复截断摘录及最后核实 COUNT / service wiring |
| **正式计量小计** | **27** | **3.6611 秒** | **1,013,276** | 全部 HTTP 200；不是本次全部请求 |
| **本次全部请求** | **37** | **未完整计量** | **未完整计量** | 3 + 7 + 27，不能把准备请求隐藏在正式计量外后宣称只用了 27 次 |

正式计量区间墙钟时间为 **173.107 秒（约 2 分 53 秒）**，从正式批次开始到最后一次源码取证结束，包含该区间的工具调度、输出处理及分析时间，**不含前 10 次准备 / 预探测请求及其分析时间**。完整任务端到端时间未被连续计量，不能补造。

HTTP 耗时是逐请求客户端计时之和，不含模型思考时间；正文 bytes 是响应正文长度，不是含请求头、传输压缩等因素的网络线上流量。正式批次按请求串行执行，未验证并发优化。20 次内容读取覆盖 13 个不同业务仓文件（包括规范、依赖元数据与测试），不是 20 个不同源码文件。

本次存在工具输出截断：首轮预探测因此重发，正式读取中也有大段前端输出未完整呈现，随后按目标行段补证 / 重读。没有把截断部分当作已阅读证据。若提供持久的同版本内容缓存和有界摘录，可减少重复请求；这是改进方向，**没有实测优化后的请求数或耗时**。

### 4.2 同题结果比较

| 维度 | 原 MCP 案例 | 本次纯 TFS API | 可得结论 |
| --- | --- | --- | --- |
| 静态结果 | 查询已透传、导出仍丢信息、部署 / 请求层待核实 | 复现相同主要结论，补充固定版本行号及 COUNT 核查 | 本题的核心静态分析可以通过 API 内容完成 |
| 调用数量 | 24 次 MCP：CodeGraph 9、filesystem 6、ripgrep 9 | 37 次 HTTP GET，正式计量为其中 27 次 | MCP 工具调用与 HTTP 请求不是等价单位；未还原 MCP 内部 IO |
| 时间 | 分析 turn 墙钟 222 秒；无 HTTP 合计 | 正式区间 173.107 秒；27 次 HTTP 合计 3.6611 秒 | 起止范围不同，不能计算有效加速比或宣称 API 更快 |
| 源码版本 | dev 工作区，完整 SHA / 索引一致性无法复核 | 两仓固定完整 SHA，目录和内容均按 Commit 读取 | API 版本取证更明确；不代表两次源码相同 |
| 定位能力 | 图谱提供符号、调用关系和测试线索 | 路径元数据、源码静态关联，且有原结果提示 | 未证明 API 替代复杂动态分派 / 全量影响图谱 |
| 工作区依赖 | 远程镜像与索引；未读本机业务代码 | 不需要镜像、索引或本机业务 checkout | 曾支撑 v0.7 的默认 API 阅读设想；当前作为按需 API 兜底能力的证据 |

## 5. 已验证与未验证

**已验证**：在现有凭据和网络下，TFS Git API 可核对仓库身份、解析 ref、按固定 Commit 列目录并读取文件；仅凭远端内容完成本题的跨前后端静态关联，不读取本地业务代码。

**未验证**：GA2612 部署 SHA、实际公共 axios 拦截器、现场错误响应 / 日志、测试运行、构建、动态复现、完整调用图、API 并发 / 缓存优化、无先验大型任务的定位成本，以及只读账号、路径白名单、权限负向与真实 Multica Runtime 集成。本次不包含分支创建或写 API 验证，也不借用此前独立写入实验替代这些只读结论。

## 6. 历史方案落点与当前适用范围

后续独立写入实验已补齐 T09、T07–T08，见 [TFS API 并发拒绝与 PR 生命周期验证记录](tfs-git-api-pr-cas-validation-2026-11-12.md)。该实验使用新的测试分支并完成清理，不改变本文只读分析的请求统计与验证范围。

当时的 08 方案 v0.7 据此采用以下策略；它们记录历史设计决定，已由当前 [08 总览](../08-remote-analysis-git-workspace-design.md)与 08-A / 08-B 的阶段方案取代：

- 阅读和静态分析默认走固定 Commit 的 TFS API；将仓库身份、版本、路径与行号作为证据。
- CodeGraph 按需增强复杂符号 / 调用关系；索引版本无法对应时只作线索，回到目标 Commit 内容复核。
- 授权编码、构建、测试或本地复现时，再准备业务 Git 工作区。根仓 OpenSpec 工件编辑、Gate、发布和 Archive 的工程环境按原职责保留。
- 适配器、权限控制、请求预算与真实 Runtime 验收仍待实施；本次案例不将方案验收状态从 `NOT_RUN` 改为通过。

当前以 08-A 的三 Remote MCP 优先路线执行，不因本文曾采用固定 Commit 和逐请求计量，要求每个 Bug 重复 API 复查或建设性能 / 同步监控。MCP 授权根须实时取得，不能复用历史服务器路径或本地 Task checkout 路径；仓库身份 / 相对路径沿用 `repo-context.yaml`，目标分支沿用现有 Rondo Registry 的 `default_target_branch`，不新增配置副本。

本文证明 API 在当时环境下可按固定版本读取并支撑本题静态分析；权限负向、真实 Multica Runtime 与跨 Runtime 收口仍须按当前阶段验收，不能由本文或后续独立 API 写入实验的 PASS 替代。
