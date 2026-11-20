# tfs-mcp 与 winning-tfs-2018-mcp 能力对比

调研日期：2026-09-24

校正基线：2026-09-24 用户完成两个 MCP 仓库的 `git pull` 后，按配置路径重新启动临时 MCP 进程核查。当前安装版本、会话工具缓存差异和验证结果见第 8 章；附件专题见第 9 章。

## 1. 调研范围与结论

面向新的 AI coding 环境，以当前项目涉及的接口和业务场景作为需求样本，不考虑现有项目对两个 MCP 的配置依赖与迁移成本。

**两个 MCP 的主要功能高度重叠，但当前均不能原样完整替代对方。只启用一个可行，是否需要增强取决于目标流程。**

- `tfs-mcp` 更适合作为通用字段写入的基础，主要需要补齐完整字段读取、修订历史和字段允许值查询。
- `winning-tfs-2018-mcp` 读取能力更完整，已支持完成日期和父项变更；若要覆盖任意必填字段、工时维护、PR 显式关联，仍需补齐通用字段写入与关联能力。附件下载还需修复文件名与 gzip 处理。
- 若限定为查询、分析、评审、附件处理和常规更新，原样只用 `winning-tfs-2018-mcp` 可以满足较多场景。
- 若要求完整覆盖本次对比的能力集合，任意一个原样单独启用都存在缺口。

## 2. 证据范围与限制

本次核查包括：

1. 升级前会话暴露的工具数为 47／48；升级后重新启动临时进程执行 `tools/list`，实际安装版本为 **47／50**。会话旧 schema 未刷新，不能作为升级后的完整工具清单。
2. 本机实际配置所指向的安装代码：前者检查 `dist` 运行代码，后者检查 JavaScript 服务实现。
3. 对同一工作项 `244432` 执行两个详情接口的只读查询，比较返回结构。
4. 参考项目已有的验证与故障记录，但不将项目的 provider 选择策略等同于 MCP 本身的能力限制。

本次没有执行线上创建、更新、上传或 PR 创建等写入测试。升级后补充了临时目录附件下载、WIQL 原始字段、修订历史、单次修订及关系查询验证。因此，业务写入能力的判断仍来自工具契约与实现；历史写入故障是否在当前环境仍然存在，需要单独验证。结论限定于本次本机安装版本，不代表所有同名发行版本。公开网络检索未成功，本报告不据此判断上游最新版本。

“未支持”或“缺失”均指当前公开 MCP 工具入口缺少相应能力，不表示底层 TFS REST API 无法实现。

## 3. 接口能力对照

| 功能／场景 | tfs-mcp | winning-tfs-2018-mcp | 差异与影响 |
|---|---|---|---|
| 单个工作项详情 | `tfs_get_workitem` 返回固定字段；支持 `collection`、`embedImages` | `tfs_get_work_item` 返回常用字段及完整 `fields` | 后者适合读取自定义字段；前者可下载正文内嵌图片 |
| 批量工作项读取 | `tfs_get_work_items` | `tfs_get_work_items` | 都支持批量读取，不应据此假定返回字段完全相同 |
| 关键词搜索 | `tfs_search_work_items` 提供关键词、项目 | 同名接口另有类型、创建／修改时间范围、数量限制 | 后者直接筛选更丰富；前者可用 WIQL 表达复杂条件 |
| WIQL 查询 | `tfs_query_wiql` 支持普通与链接查询，固定字段格式化 | 增加 `returnRawFields`，可按 SELECT 返回字段引用名作为键；链接查询保留 source/target/linkType | 新版后者可用于定向自定义字段读取，已实测 |
| 保存的查询 | `tfs_run_saved_query` 返回查询结果 | 同名工具有结果时写入本地 JSON，返回路径、总数和预览；`project` 必填 | 后者返回契约不同，不能继续假定直接返回工作项数组；无结果时也不会创建文件 |
| 父子与关联关系 | `tfs_get_relations` 支持 `parent`、`children`，默认查询子项 | 支持 `parent`、`children`、`all`；children 包含关联需求，all 还包含附件元数据 | 不能将后者 children 结果全当作子任务；两者仍无 predecessor/successor 参数 |
| 创建需求／任务并关联父项 | `tfs_create_workitem` 支持通用 `fields`、区域、迭代、父项 | 提供 `finishDate`、Bug 分类／测试环境及其他预设参数，无通用 `fields` | 完成日期已有入口；其他未预设的必填字段仍受限 |
| 更新工时、完成日期、自定义字段 | `tfs_update_workitem` 支持 `updates` 字段字典 | 支持 `finishDate`、CMMI 注释、阻止状态／原因、知识库标记等预设字段，无通用 `updates` | 前者可写通用字段；后者工时与任意自定义字段入口仍缺失，但完成日期已支持 |
| 已有工作项变更父项 | 无专用关系写入入口，`updates` 只构造字段 PATCH | `tfs_update_work_item(parentWorkItemId)` 可移除旧父项并挂到新父项 | 后者 schema 与实现已确认；本次不修改线上关系 |
| 回写需求分析 | `updates["Winning.Demand.Analysis"]` | `requirementAnalysis` | 两者代码都有实现；后者历史未持久化问题需复测 |
| 状态更新 | `tfs_change_state` 或通用更新 | `tfs_update_work_item_state` 或综合更新 | 两者均有能力；需遵守目标项目状态机与必填字段规则 |
| 指派人、评论 | `tfs_assign`、`tfs_add_comment`，也可通用更新 | `tfs_update_assigned_to`、`tfs_add_comment`，也可综合更新 | 核心功能均具备 |
| 标签追加 | `tfs_add_tags` 的公开参数是分号分隔字符串；实现合并已有标签 | `tfs_add_tags` 支持数组／字符串并合并 | 参数适配差异，不是功能缺失 |
| 附件列表、下载、上传 | 三类工具齐全；下载保留样本文件名并解 gzip | 三类工具齐全；附件专用列表丢失样本文件名，下载未解 gzip | 工具数量相同不代表行为等价，下载实测见第 9 章；未实测上传 |
| 工作项关联提交 | `tfs_get_work_item_commits`，支持包含子项 | 同名接口，支持包含子项 | 两者均可支撑需求代码追踪 |
| PR 详情与提交 | `tfs_get_pr`、`tfs_get_pr_commits` | `tfs_get_pull_request`、`tfs_get_pull_request_commits` | 工具名及参数要求不同，核心功能均具备 |
| PR 列表、变更、关联项、评论 | `tfs_list_prs`、`tfs_get_pr_diffs`、`tfs_get_pr_workitems`、`tfs_add_pr_comment` | 同名接口均具备 | 两者均可支撑 PR 评审；变更列表不等于完整源码 diff |
| 创建 PR 并显式关联工作项 | `tfs_create_pr` 提供 `workItems`；先创建再尝试关联 | `tfs_create_pr` 没有 `workItems` 参数 | 前者有参数和实现，但不能仅凭创建成功认定关联成功 |
| 已有 PR 显式追加工作项关联 | 未暴露独立工具 | 未暴露独立工具 | 两者均需增强；创建接口不能当作已有 PR 更新接口 |
| 工作项修订历史／转派记录 | 未暴露对应工具 | `tfs_get_work_item_revisions` 增加字段变化、需求类型变化、`includeChanges` 和额外 `fields` | 已实测；额外字段参数用于读取历史，不是通用写入参数 |
| 单次修订 | 未暴露对应工具 | 新增 `tfs_get_work_item_revision` | 返回 rev、history、changedDate、changedBy；不是该版本的完整字段快照 |
| 需求变更集汇总 | 无同名聚合工具，可组合已有提交／PR 查询 | 新增 `tfs_get_requirement_changesets`，提供 summary/commits/files 与分支过滤 | 已核查 schema 和实现，尚未验证实际聚合准确性；分支判断含提交消息启发式逻辑 |
| 字段允许值／下拉选项 | 未暴露对应工具 | `tfs_get_field_allowed_values` | 后者可查询字段元数据与选项 |
| 从本地文件更新说明 | 没有专用文件入口，需传文本 | `tfs_update_description_from_file` | 后者避免大段文档经过模型上下文 |
| TFVC 文件、目录、变更集、分支 | 支持；文件接口有 `savePath`，另有 `tfs_download_tfvc_files` 批量落盘 | 支持；文件以文本／Base64 返回，无对应直接落盘和批量下载入口 | 前者更适合大文件和批量代码下载 |

## 4. 两边的能力缺口

### 4.1 tfs-mcp

| 缺口 | 对流程的影响 | 建议 |
|---|---|---|
| 详情接口不保留完整原始 `fields`，也不返回顶层 `rev` | 能写任意字段，但不能通过当前详情接口完整读回；影响工时、完成日期、自定义字段的校验 | 返回 `fields`、`rev`，可增加字段选择参数控制响应体积 |
| 无修订历史查询工具 | 无法直接查询历史状态和转派记录 | 增加工作项 revisions 接口 |
| 无字段允许值查询工具 | 无法动态发现产品等下拉字段选项 | 增加字段元数据／allowed values 接口 |
| 无从文件写入说明的专用工具 | 长文档需要读取后作为工具参数传递 | 增加 filePath 写入入口 |
| PR 创建与工作项关联不是原子操作，关联失败反馈不足 | PR 创建成功可能掩盖关联失败 | 返回逐项关联结果，并使用关联查询校验 |
| 无已有 PR 追加关联的独立工具 | 关联遗漏后无法通过现有专用接口补齐 | 增加 PR 工作项关联接口 |

只读实测：工作项 `244432` 的 `tfs_get_workitem` 返回固定顶层字段，没有原始 `fields`；`winning-tfs-2018-mcp` 同一工作项的详情返回 65 个原始字段，包含 `Microsoft.VSTS.Scheduling.FinishDate` 和 `Winning.Demand.Analysis`。

此外，`tfs-mcp` 的 WIQL 查询也会经过固定字段格式化，不能通过改变 SELECT 字段就保证拿到任意自定义字段值。

### 4.2 winning-tfs-2018-mcp

| 缺口 | 对流程的影响 | 建议 |
|---|---|---|
| 创建接口没有通用 `fields` | 研发中心等未预设必填字段仍无法传入；完成日期已由 `finishDate` 支持，不能继续列为缺失 | 给 `tfs_create_work_item` 增加字段字典 |
| 综合更新没有通用 `updates` | 预计工时、实际工时、剩余工时及未预设自定义字段仍无法直接写入；完成日期已支持 | 给 `tfs_update_work_item` 增加字段字典 |
| PR 创建没有 `workItems`，也没有独立关联接口 | 无法通过工具显式保证需求／任务与 PR 关联完整 | 增加创建时关联及已有 PR 关联接口，写后重读验证 |
| 没有正文图片自动下载参数 | 分析截图型需求时需要额外下载处理 | 按需求增加内嵌图片提取与落盘能力 |
| TFVC 文件没有直接落盘／批量下载入口 | 大文件内容进入 MCP 响应，增加上下文和传输开销 | 增加 `savePath` 和批量下载接口 |
| 详情接口没有顶层 `rev` | 直接获得当前工作项修订号不方便，需额外查询或采用其他版本锚点 | 在详情中保留 TFS 原始修订号 |
| 附件专用列表取名与下载解码不完整 | 无 fileName 查询参数时丢失文件名／扩展名；gzip 内容可能原样落盘 | 优先读取关系 attributes.name，补充大小、gzip 解码与文件校验 |

完整开发闭环示例：

> 创建子任务 → 写入预计工时 → 开发完成 → 写入实际工时和完成日期 → 关闭任务 → 创建 PR 并关联需求／任务。

升级后创建与更新完成日期已有入口；Task 创建还支持父项日期继承及默认日期回填。但是工时、其他任意字段和 PR 显式关联仍有缺口，不能据此认定整条链路完整可用。

## 5. 历史问题与当前实现的区分

| 事项 | 已有证据 | 本次判断 |
|---|---|---|
| `tfs-mcp` 标签参数不兼容 | 项目契约记录了禁用策略；当前公开 schema 接受字符串，实现会追加合并标签 | 属于参数适配问题，不能认定前者不支持标签追加 |
| `winning-tfs-2018-mcp` 需求分析未持久化 | 项目有返回成功但未持久化的历史记录；当前代码确实构造 `Winning.Demand.Analysis` PATCH | 保留为待复测可靠性问题，不能认定当前代码没有该功能 |
| `winning-tfs-2018-mcp` 创建 Task 失败 | 历史记录涉及指派人格式和完成日期必填；新版已有 `finishDate` 与日期回填逻辑 | 撤回“完成日期无法传入”的结论；其他必填字段、身份格式和线上创建结果仍需验证 |
| `winning-tfs-2018-mcp` PR 查询 HTTP 400 | 历史记录为缺少 `project` 参数；当前接口有该参数 | 调用时提供正确项目与仓库，不应当作不支持 PR 查询 |
| `tfs-mcp` 专用状态更新异常 | 历史记录出现将日期值误填到状态字段；代码含必填字段失败后的自动补日期逻辑 | 不据此否定全部状态更新能力；通用更新与专用快捷接口应分别验证 |
| `tfs-mcp` PR 工作项关联 | 当前实现先创建 PR，再发关联请求；关联异常仅记录日志，关联请求结果也未逐项校验 | 不能把创建成功当作关联成功，应独立读取关联项确认 |

另有项目文档使用 `predecessor`／`successor` 关系方向，但新版两个 MCP 的公开关系参数仍未提供这些枚举值。winning 新版已明确支持关联需求及 all 下的附件元数据，应与前置／后继关系区分。

## 6. 单 MCP 选型建议

| 方案 | 可行性与前提 |
|---|---|
| 原样只启用 `tfs-mcp` | 可以支撑主要开发操作，但完整自定义字段回读、历史查询和字段选项查询存在缺口 |
| 原样只启用 `winning-tfs-2018-mcp` | 适合查询、分析、评审及预设字段更新；缺通用字段写入与显式 PR 关联，附件下载需先修复文件名与 gzip 问题 |
| 增强后只启用 `tfs-mcp` | 优先补完整字段与 revision 返回、修订历史、字段允许值、PR 关联结果反馈 |
| 增强后只启用 `winning-tfs-2018-mcp` | 同样可行；优先补通用 `fields`、`updates`、PR 关联、附件正确落盘，复测需求分析持久化；完成日期无需从零补接口 |

如果尚未确定实现基础，`tfs-mcp` 已有通用写入能力，适合作为默认候选。如果已倾向 `winning-tfs-2018-mcp`，可在其现有读取能力上补齐写入，不必为这些缺口长期同时启用两个服务，也不需要重写整个 MCP。

### 仅采用 winning-tfs-2018-mcp 的建议验收清单

以下为后续验收计划，不表示本次已执行：

1. 创建需求／任务时能传入项目要求的额外必填字段，并建立父子关系。
2. 能更新 `OriginalEstimate`、`CompletedWork`、`RemainingWork`、`FinishDate` 等字段，并通过完整 `fields` 读回验证。
3. 写入 `Winning.Demand.Analysis` 后重读确认持久化；HTML 规范化差异与内容丢失应分别判断。
4. 标签追加保留旧值，重复追加不产生重复标签。
5. 状态转换符合目标项目流程，失败能够返回具体字段或状态约束。
6. 创建 PR 后检查工作项关联完整；部分关联失败有明确反馈，可通过独立接口补齐。
7. 附件上传后能够列出并下载；修订历史、字段允许值查询在目标项目可用。

## 7. 能力专题：获取工作项内容与 tfs-sync

讨论日期：2026-09-24。状态：升级后复核仍支持本节读取建议，winning 另增加 `radCenter` 顶层字段及 WIQL 原始字段模式；尚未修改 `tfs-sync` 的 provider 约定、配置或实现，也未执行切换后的同步验证。

后续需要的能力按独立专题继续对比和讨论。每个专题分别记录场景、接口差异、当前实现、建议与待验证项；本节仅针对工作项内容获取，不代表整体 MCP 选型已最终确定。

### 7.1 场景与推荐

目标是获取尽可能完整的工作项内容，保存为本次同步的来源快照，供 Multica Delivery Issue 初始化和后续需求／Bug 分析使用。

**该场景更推荐 `winning-tfs-2018-mcp`：它保留完整 `fields`，能够提供验收标准、Bug 复现步骤及其他自定义字段。** 前文将 `tfs-mcp` 作为默认候选，是考虑完整开发流程的通用写入能力；读取内容时，应优先考虑字段完整性。

`tfs-sync` 当前明确规定只使用 `tfs-mcp`，并要求 WIQL 仅发现 ID，再逐项获取详情 JSON、原样落盘。这是现有 skill 的执行约定，不是两个 MCP 读取能力的比较结论。

需要区分“原样保存 MCP 返回的 JSON”与“保存完整 TFS 原始响应”：`tfs-mcp` 返回前已裁剪字段，落盘不会恢复被裁剪内容；`winning-tfs-2018-mcp` 虽保留 `fields`，其详情仍是格式化结果，不包含全部原始顶层结构。

### 7.2 内容字段与同步链路对照

| 内容 | tfs-mcp 当前详情接口 | winning-tfs-2018-mcp 当前详情接口 | tfs-sync 当前处理 |
|---|---|---|---|
| 标题、类型、状态、描述、ChangedDate | 返回固定顶层字段 | 返回顶层字段，并保留 `fields` | 已标准化和同步 |
| 验收标准 | 固定返回结构未包含该字段 | 返回 `acceptanceCriteria`，原始值也在 `fields` 中（源工作项存在该字段时） | 已读取 `acceptanceCriteria`／`Microsoft.VSTS.Common.AcceptanceCriteria` 并渲染 |
| Bug 复现步骤 | 固定返回结构未包含该字段 | 可从 `fields["Microsoft.VSTS.TCM.ReproSteps"]` 读取（源工作项存在该字段时） | 已读取并渲染，但当前 provider 未提供该值 |
| 需求分析 | 返回 `demandAnalysis`，保留 HTML | 返回纯文本 `requirementAnalysis`；原始 HTML 保留在 `fields["Winning.Demand.Analysis"]` | 尚未映射，也未渲染到 Delivery Issue 正文 |
| 区域、迭代 | 返回 `areaPath`、`iterationPath` | 可从完整 `fields` 获取 | 标准化函数兼容顶层名称和字段引用名 |
| 其他自定义字段 | 仅提供预设字段 | 保留完整 `fields` | 当前只消费明确列出的字段，新增内容需明确映射 |
| 正文内嵌图片 | `embedImages` 只扫描描述、需求分析；不扫描 Bug 复现步骤 | 完整 fields 可保留复现步骤中的图片地址，但无自动下载参数 | 当前 HTML 转纯文本逻辑未保留图片地址；实测案例见 7.6 |
| 超链接 | HTML 正文中可含链接 | HTML 正文中可含链接 | 当前转换只保留可见文字，不保留链接目标 |

### 7.3 当前内容遗漏发生在哪一层

1. **MCP 返回层**：`tfs-mcp` 的固定字段格式化会遗漏验收标准、复现步骤等字段。后续同步脚本即使已有读取逻辑，也无法恢复未返回的数据。
2. **同步映射层**：`normalize_workitem` 未消费 `demandAnalysis`、`requirementAnalysis` 或 `Winning.Demand.Analysis`；`build_delivery_description` 只渲染描述、验收标准和复现步骤。只换 MCP 不会自动补上需求分析。
3. **正文转换层**：`_TextExtractor` 将 HTML 转为纯文本，未处理图片地址、超链接目标。截图型需求与依赖链接说明的需求可能因此丢失关键上下文。

前两项由当前代码可直接确认；具体工作项是否受到影响，取决于源字段是否有内容。本次没有对全部工作项统计遗漏率。

### 7.4 建议方案

- 详情读取改用 `winning-tfs-2018-mcp`，原样保存含完整 `fields` 的 MCP 返回快照；明确其为 MCP 响应快照，避免称为完整 TFS REST 原始响应。
- 新版 `tfs_query_wiql(returnRawFields=true)` 可按 SELECT 读取字段；它不包含详情的所有上下文，不据此直接取消当前“发现 ID 后逐项取详情”的同步契约。
- 映射描述、验收标准、复现步骤和需求分析。需求分析优先使用原始 `fields["Winning.Demand.Analysis"]`，再进行确定性的内容转换。
- 保留 HTML 来源快照，并明确 Delivery Issue 正文的图片和链接展示策略。快照完整性与展示完整性分别验证。
- 增量同步继续使用 `ChangedDate`，不因更换 provider 改为 revision；现有身份和执行态保护规则保持适用。
- 附件、父子关系等按需求另外获取。完整 `fields` 不等于完整工作项上下文，附件文件也不会随字段详情自动下载。
- 修改时同步调整 skill 的 provider 限定、原始 JSON 契约及必要测试。当前标准化函数已经支持从 `fields` 按引用名取值，但尚不能据此宣称切换无需适配或已验证可用。

### 7.5 后续需单独讨论和验证的事项

| 事项 | 待确定／验证内容 |
|---|---|
| 同步正文范围 | 是否将需求分析和其他业务自定义字段作为必需内容 |
| 图片与链接 | 仅保留原始 HTML、输出可访问链接，还是下载后作为附件提供；需结合下游访问权限验证 |
| 附件与关系 | 初始化时获取哪些上下文，哪些留给后续分析阶段按需查询 |
| 集合与身份 | 切换后的查询与详情是否限定在正确集合，是否与 `tfs.collection` 身份一致 |
| 读取与标准化 | 用需求、Bug、Task 样本验证字段有值、无值及 HTML 内容的处理 |
| 已同步数据补齐 | 当前相同 ChangedDate 会 NO-OP；仅更换 provider／渲染逻辑不会自动补齐旧 Issue，需讨论受控刷新方式 |
| 幂等与执行态 | 验证更新内容时不改动既有负责人、状态、评论、子项及研发执行态 |

本节依据：`.agents/skills/tfs-sync/SKILL.md`、`references/runtime-json-contract.md`、`scripts/tfs_sync_common.py` 中的 `pick`、`normalize_workitem`、`_TextExtractor`、`build_delivery_description`，以及两个 MCP 的详情格式化实现。

### 7.6 实测案例：Bug 249512 的复现步骤内嵌图片

验证日期：2026-09-24。样本集合：`WN_Data_Platform`。本次通过当前会话连接执行只读详情、附件列表查询，以及 `tfs-mcp` 的 `embedImages=true` 调用；同时核对其图片扫描实现。未执行图片地址的独立下载，也未进行图片内容识别。

该 Bug 的描述字段为空，图文内容实际位于 `Microsoft.VSTS.TCM.ReproSteps`。winning 返回的该字段 HTML 长度为 1219 个字符，含 1 个 `<img>` 标签；两个 MCP 的普通附件列表均为空。

| 验证项 | tfs-mcp | winning-tfs-2018-mcp |
|---|---|---|
| 调用详情接口 | `tfs_get_workitem(id=249512)` | `tfs_get_work_item(id=249512)` |
| 描述字段 | 空 | 空 |
| 复现步骤正文 | 未返回 | 完整保留于 `fields["Microsoft.VSTS.TCM.ReproSteps"]` |
| 复现步骤中的图片地址 | 未返回 | 获取到 1 个 img src |
| 自动获取图片 | `embedImages=true` 后 `images=[]`，下载图片数为 0 | 没有自动下载入口；取得地址不代表已下载图片 |
| 普通附件列表 | count=0 | 空数组 |

**原因已核实**：`tfs-mcp` 的图片扫描源只有 `description` 和 `demandAnalysis`，不包含 `ReproSteps`；此样本两个扫描字段都为空。因此，即使启用图片功能，也无法获取该 Bug 的复现文字和截图。普通附件列表为零同样不能用于判断正文没有图片。

**本场景推荐 winning 获取完整字段，再补充图片下载与模型读取步骤。** 建议处理链路为：

```text
获取完整 fields 快照
→ 读取 ReproSteps HTML，保留文字与图片位置关系
→ 提取 img src，并解码 HTML 实体（该样本地址包含 &amp;）
→ 使用 TFS 认证下载图片，正确处理 HTTP 内容编码
→ 验证文件后将图片交给模型分析
```

这条链路是待实现／验证的方案，不代表 winning 当前能独立完成。应分别验收“正文及图片地址已获取”“图片文件已下载”“模型已读取图片”，不能以返回 HTML 或 URL 替代后两个结果。

对 `tfs-sync` 的影响：更换详情 provider 可补回复现步骤，但当前 HTML 转纯文本逻辑仍会丢弃图片地址，需要单独增加图片保留／下载策略。若继续使用 `tfs-mcp`，则需要同时补齐 `ReproSteps` 字段返回及其图片扫描。

本案例只记录字段结构与图片数量，不在对比文档保存 Bug 正文、环境账号、密码或完整图片地址。普通附件获取仍按第 9 章结论评估，不能将“附件下载优先 tfs-mcp”套用到复现步骤内嵌图片。

## 8. 升级后的能力校正记录

### 8.1 版本基线与工具缓存

用户确认升级方式为对以下两个仓库执行 `git pull`。本次没有修改 MCP 安装代码、构建产物或认证配置。

| 项目 | tfs-mcp | winning-tfs-2018-mcp |
|---|---|---|
| 安装路径 | `C:/Users/lilei/.cache/WinCode/tfs-mcp` | `C:/Users/lilei/.cache/WinCode/mcp/winning-tfs-2018-mcp` |
| Git HEAD | `d1edf0c` | `73a8c16` |
| HEAD 提交时间 | 2026-05-18 | 2026-08-14 |
| 实际入口 | `dist/index.js` | `mcp-server.js` |
| 新进程自报版本 | 1.0.0 | 1.0.0 |
| 本会话缓存工具数 | 47 | 48 |
| 新进程 tools/list 工具数 | **47** | **50** |

两者仍自报 1.0.0，不能仅凭版本号判断升级。当前 `tfs-mcp` 入口及关键运行文件修改时间为 2026-05-27，在本次关注的接口上未发现新能力；winning 文件修改时间为 2026-09-24。Git 提交时间是上游提交日期，不是用户拉取时间。

会话中 winning 旧详情结果没有 `radCenter`，临时新进程已有该字段；结合 48／50 个工具的差异，说明当前会话连接／schema 尚未完整反映磁盘版本。后续使用新增工具前，需要重新连接 MCP 并刷新工具列表。新版结论以本次新进程结果为准。

工具签名、源码 SHA-256 和脱敏验证摘要曾记录于升级核查快照；该快照当前不在本目录中，无法从本报告复核。快照不包含凭据、工作项正文或附件内容；下载文件仅放在系统临时目录。

### 8.2 必须修正的旧结论

| 旧结论／旧基线 | 升级后校正 | 证据等级 |
|---|---|---|
| winning 暴露 48 个工具 | 当前磁盘版本新进程暴露 50 个工具 | tools/list 实测 |
| winning 不能传入或更新完成日期 | 创建、综合更新均有 `finishDate`；Task 创建可继承父项日期，必要时回填当天加 7 天 | schema＋实现；未线上写入 |
| winning 仅创建时能指定父项 | 综合更新新增 `parentWorkItemId`，可变更已有工作项父级 | schema＋实现；未线上改关系 |
| winning 仅有修订摘要 | 增加单次修订查询；摘要增加字段变化、需求类型变化及额外字段追踪 | 只读实测 |
| 查询结果只能按固定字段读取 | winning WIQL 增加 `returnRawFields`，按 SELECT 返回 TFS 字段引用名 | 只读实测 |
| 保存的查询可视为两者等价 | winning 现在将有结果的查询写入 JSON，返回路径／总数／预览 | schema＋实现；未执行真实 Saved Query |
| winning all 关系只有父子 | 还包括关联需求与附件元数据；children 也包括关联需求 | 实现；附件关系实测 |
| 附件下载只需补文件名 | winning 专用下载还会将 gzip 响应原样落盘 | 下载＋解压＋哈希比对实测 |

其他新增或扩展能力：

- `tfs_get_requirement_changesets`：需求及子项变更集聚合，支持 summary／commits／files 和分支过滤。本次未实测聚合数据与分支判定准确性。
- 搜索、我的任务、未关闭 Bug 增加创建时间筛选；客户查询还增加需求类型、产品、研发中心、描述等筛选。
- 综合更新增加 CMMI 注释及追加模式、阻止标记／原因、知识库标记等预设字段；Bug 创建增加缺陷分类、测试环境分类。
- 详情新增顶层 `radCenter`，仍保留原始 `fields`，仍未返回当前顶层 `rev`。

边界：修订接口的 `fields` 是“要读取的历史字段”，不是创建接口的通用写入 `fields`。单次修订查询只返回 history 等少量字段，不是历史版本完整快照。Task 默认回填日期是工具策略，不应当作业务约定日期；需要准确日期时应显式传入。

### 8.3 本次实测结果与未验证范围

样本工作项为 `244432`，两个新进程均使用 `WN_Data_Platform` 集合。

| 检查 | 结果 |
|---|---|
| tfs-mcp 详情 | 仍无原始 fields、rev 和验收标准顶层字段 |
| winning 详情 | 返回 65 个原始字段，包含验收标准入口及新增 radCenter；无顶层 rev |
| winning WIQL 原始字段模式 | 指定 ID 查询返回 1 项，键包括 System.Id、System.Title、Microsoft.VSTS.Scheduling.FinishDate、Winning.Demand.Analysis |
| winning 修订摘要 | 返回 23 次修订；可追踪 AssignedTo、RequirementType 和额外请求的 FinishDate |
| winning 单次修订 | revision 1 返回 rev、history、changedDate、changedBy；不返回完整 fields |
| winning all 关系 | 正确返回附件名称 brainstorm.md、大小 4897 字节 |
| 两者附件专用列表与下载 | 名称与 gzip 行为仍有差异，详见第 9 章 |
| winning 自带测试 | `node test.js`：56 项，49 通过、7 失败，退出码 1 |

7 个测试失败集中在旧函数签名、旧分发参数顺序及旧 `validateDate` 实现断言，与新增创建时间参数和 `validateDateSafe` 的当前实现不匹配。不能据此直接断言对应线上功能不可用，但也不能报告测试全部通过。本次没有修复上游测试。

未执行线上创建、字段更新、关系修改、上传、PR 创建／关联；未验证需求分析写后持久化、保存查询文件输出、变更集聚合的实际正确性。上述能力只标记为 schema／实现可用或待验证，不标记为端到端通过。

## 9. 能力专题：获取附件

### 9.1 升级后推荐

**当前版本直接获取并下载附件，仍优先推荐 `tfs-mcp`。** winning 的关系查询已能补充附件名称与大小，但它的附件专用列表和下载实现尚未复用这些元数据，也没有处理 gzip 解码。

若最终统一到 winning，优先修复文件名、gzip 解码和落盘校验；这些是当前实现缺陷，不需要因此长期保留两个 MCP。

### 9.2 同一附件的列表与下载验证

| 检查项 | tfs-mcp | winning-tfs-2018-mcp |
|---|---|---|
| 专用列表中的名称 | brainstorm.md | attachment-0 |
| 专用列表中的大小 | 4897 字节 | 未返回 |
| all 关系查询中的附件元数据 | 详情保留原始 relations；专用父子查询不返回附件项 | 正确返回 brainstorm.md、4897 字节 |
| 实际下载文件名 | brainstorm.md | attachment-0 |
| 实际落盘大小 | 4897 字节 | 2482 字节 |
| 文件内容 | 已解压的 Markdown 原文 | gzip 数据，文件头为 1f8b |
| 内容一致性 | SHA-256：e2325139bd70d5b40b6d638117125708bcebcf1d1b7566578358153fb3c93cb4 | 手工在内存解压后为 4897 字节，与左侧逐字节一致 |

原因：tfs-mcp 使用关系 `attributes.name`，并根据 `Content-Encoding: gzip` 解压；winning 专用列表只从 URL 的 `fileName` 取名，该样本 URL 无此参数，下载函数直接将响应流写入文件。备注中存在原文件名不等于下载逻辑会使用它。

tfs-mcp 新进程首次下载返回 1 项失败但顶层 success=true；该次具体失败原因未保留。随后在当前连接和独立新进程各下载成功，内容一致，首次失败未复现，不能据此判定原因或计算稳定性。它的顶层成功标志不能替代 failCount／逐项结果检查，这一点仍成立。

### 9.3 下载行为与共同缺口

| 能力 | tfs-mcp | winning-tfs-2018-mcp |
|---|---|---|
| 指定目录、流式落盘 | 支持 | 支持 |
| gzip 解码 | 支持，样本已验证 | 未处理，样本已确认压缩数据原样落盘 |
| 请求超时 | 下载函数未显式设置 | 设置 60 秒请求超时；并非整个批次的硬性总耗时限制 |
| 重定向 | 未处理 | 最多 5 次跳转，但相对 Location 地址兼容不完整 |
| 部分失败反馈 | 逐项结果＋failCount；顶层始终 success=true | success／failed 数组 |
| 集合参数 | 附件工具没有 collection 参数，依赖默认集合 | 附件工具没有 collection 参数，依赖当前集合 |

两者共同缺少按稳定附件 ID 选择下载的公开入口、同名文件隔离、下载后大小／哈希校验及自动重试。专用列表和下载会分别读取工作项，没有消费同一附件 manifest 的入口。两者列表的 index／id 是数组序号，不能当作稳定附件标识。

正文内嵌图片与 AttachedFile 附件必须分别处理；下载所有附件并不意味着正文中的所有图片都已获取。Bug 249512 的实测中，两者附件列表均为空，但复现步骤中确有 1 张图片，详见 7.6。本专题不评估上传、替换和删除附件。

## 10. 证据位置

安装代码是本次机器上的版本快照；以下本机路径用于复核，不是可移植的上游源码地址。

| 证据 | 路径 |
|---|---|
| tfs-mcp 运行入口与工具 schema | `C:/Users/lilei/.cache/WinCode/tfs-mcp/dist/index.js` |
| tfs-mcp 工作项格式化与查询 | `C:/Users/lilei/.cache/WinCode/tfs-mcp/dist/tools/workitem.js` |
| tfs-mcp 字段更新、标签与创建 | `C:/Users/lilei/.cache/WinCode/tfs-mcp/dist/tools/update.js` |
| tfs-mcp PR 创建与工作项关联 | `C:/Users/lilei/.cache/WinCode/tfs-mcp/dist/tools/pullrequest.js` |
| tfs-mcp WIQL 底层处理 | `C:/Users/lilei/.cache/WinCode/tfs-mcp/dist/utils/tfs-client.js` |
| winning 工具 schema 与分发 | `C:/Users/lilei/.cache/WinCode/mcp/winning-tfs-2018-mcp/mcp-server.js` |
| winning 工作项详情、历史、字段选项与 PR | `C:/Users/lilei/.cache/WinCode/mcp/winning-tfs-2018-mcp/tfs-api.js` |
| winning 预设字段更新与创建 | `C:/Users/lilei/.cache/WinCode/mcp/winning-tfs-2018-mcp/tfs-update.js` |
| 项目历史验证与已知问题 | `fire` 分支中的旧 TFS Manager 契约（已退役） |
| 项目 PR 接口约定与历史问题 | `fire` 分支中的旧 SCM Manager 契约（已退役） |
| 工时、日期、必填字段的场景样本 | `.agents/skills/weekly-commit-summary/SKILL.md` |
| 升级后工具签名、源码指纹、脱敏验证摘要 | `docs/multica/validation/tfs-mcp-capability-recheck-2026-09-24.json` |
| tfs-mcp 附件实现 | `C:/Users/lilei/.cache/WinCode/tfs-mcp/dist/tools/attachment.js` |

本次详情对照只记录返回结构和字段存在性，未在文档保存工作项业务正文或认证信息。
