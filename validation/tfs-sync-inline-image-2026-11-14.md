# TFS Sync 内嵌图片修复与现场验收

日期：2026-11-14（Asia/Shanghai）。本记录分为 1.2.22 的附件传输验收与 1.2.23 的图片显示补验，本机最终安装版本为 1.2.23。首次验收只确认了上传、下载和幂等，不能据此宣称页面图片已可见。

## 故障与修复

- TFS 264839 的 Bug 重现步骤包含 `tmp4792.png`。同一工作项在单项查询和跨项目批量查询中返回不同项目路径的图片 URL；失败运行使用的路径返回 404，而同一附件 GUID 的集合级接口可读取有效图片。
- 附件下载器根据可信 collection 与 GUID 构建标准下载地址，支持路径 GUID、`FileNameGUID` 查询参数和 HTML 实体。发送 PAT 前拒绝异源、跨集合及无效 GUID。
- 同步层只接受成功退出且 `path/name/size` 与实际本地文件一致的下载结果。下载失败不能进入上传；明确失败保留 pending 并继续下一工作项。
- 附件按来源 collection 与 GUID 识别，兼容旧正文 URL 映射，项目路径变化不重复上传；冲突映射仍停止核对。上传结果未知时保留已完成、当前部分处理及未处理项。
- 上传成功后响应丢失或后续附件失败时，恢复认领已有裸引用，只补缺失附件，不重建 Issue。

主要代码：

- [附件身份与下载地址](../../../tools/rondo/src/tfs/attachments.ts)
- [附件下载器](../../../tools/rondo/src/tfs/api/workitem.ts)
- [同步与恢复](../../../tools/rondo/src/commands/tfs/reconcile-workitem.ts)
- [附件同步回归](../../../tools/rondo/test/tfs-reconcile-attachments.test.mjs)
- [下载 HTTP 测试](../../../tools/rondo/src/tfs/api/download-attachment.test.ts)

## 自动化验证与部署

- `npm run build`：通过。
- `npm test`：397 项，384 通过、0 失败、13 跳过。跳过项为 Windows 符号链接场景 1 项、指定 OpenSpec 环境不可用的场景 10 项、未配置只读现场路径的场景 2 项；这些场景未计为通过，与本次附件链路无关。
- 完整回归启动后新增了“上传已落库但响应丢失”的测试；对最终 `tfs-reconcile-attachments.test.mjs` 另跑专项，9/9 通过、0 跳过。新增测试整体还包括 4 项附件纯函数与 3 项本地 HTTP 下载测试。
- 代码审查与附件下载安全审查通过，无阻塞问题；`git diff --check` 通过。
- 通过本地 tgz 离线安装到 `D:/UserApp/nvm/node_global`，安装后 `rondo --version` 为 1.2.22。已核对全局安装的三个生产 JS 文件与通过验证的构建 SHA-256 一致。安装包只含 `package.json` 与 `dist/`，未包含凭据配置。
- 本机更新未发布到 npm registry；旧 1.2.20 分发包仍保留。

## 现场执行范围

- 云端服务：`https://api.multica.ai`，profile：`desktop-api.multica.ai`。
- Workspace：`743b9b30-8a0d-4311-9f05-8ca306b2cdc9`；Project：`6df7a000-45b3-457d-abd1-b0a0cbd4b7a9`。
- 原 Skill 配置依赖 Desktop 的运行时凭据；手动验收使用本地配置副本显式指定已登录云端 profile。
- TFS 264839 在失败后已转派，原 `AssignedTo=@me` 查询不再包含它。按用户明确要求恢复 RLL-19，本次配置保留原查询条件并额外 `OR [System.Id] = 264839`，两轮均实际处理 `[253103,260986,262296,262301,264839]`。
- 未修改后台 Agent 配置、原同步规则、TFS 指派，也未启动下游 Agent。

## 两轮同步验收

RLL-19 的 Issue ID 始终为 `01a1d898-80e0-703c-8af5-29eee8e6f7ed`。

| 指标 | 修复前 | 第一轮后 | 第二轮后 |
| --- | --- | --- | --- |
| Issue revision | 8 | 13 | 13 |
| 图片副本数 | 0 | 1 | 1 |
| `tfs.intake_pending` | true | 已删除 | 已删除 |
| 状态 | backlog | backlog | backlog |
| Owner | Wayfinder Agent | 未改变 | 未改变 |

| 运行 | exit | created | updated | skipped | failed | 实际 create 调用 | 实际 upload 调用 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 第一轮 | 0 | 0 | 1 | 4 | 0 | 0 | 1 |
| 第二轮 | 0 | 0 | 0 | 5 | 0 | 0 | 0 |

项目 Issue 总数保持 12；完整分页回读确认 `tfs.id=264839` 始终只对应一个 Issue。第二轮正文、revision 与图片副本 ID 均未变化。创建和上传次数来自真实 CLI 调用日志，不以最终正文链接数量代替调用次数。

## 图片完整性

- Multica 附件 ID：`01a1d8e3-45ff-7313-914c-627d480ee1fd`。
- [图片副本](https://multica.ai/api/attachments/01a1d8e3-45ff-7313-914c-627d480ee1fd/download)通过已认证 CLI 成功下载。
- PNG 尺寸：1910 × 814；大小：124350 字节。
- TFS 原图与 Multica 副本的 SHA-256 完全一致：`78563021c0f1d4c06767efd89fb2ffc861ccbd220669cb2e6b50efae02b6e09d`。

## 图片显示补验

用户随后反馈仍看不到图片。Desktop 页面确认正文只有普通 `[Multica 副本](URL)` 链接；在浏览器直接打开受保护下载地址返回 `missing authorization`。同步重写正文时移除了上传后平台追加的原生图片引用，因此附件存在但正文不展示图片。

现场在 RLL-19 的原正文中追加 `![tmp4792.png](同一附件URL)`，没有新建 Issue 或重新上传。Issue revision 从 13 变为 14，附件 ID 保持 `01a1d8e3-45ff-7313-914c-627d480ee1fd`。用户已明确确认图片可以看到。

1.2.23 已将原生图片展示固化到同步正文投影：旧正文缺少展示时只更新正文；已有展示的附件引用不再作为未知裸引用误认领给同名新图片。新增 5 项展示回归，附件与正文两文件目标回归 19/19 通过，构建及增量代码审查通过。已离线安装本机，安装后的同步 JS 与验证构建哈希一致。

1.2.23 再次执行同一恢复范围同步：created=0、updated=0、skipped=5、failed=0，上传调用数为 0。回读 RLL-19 revision 仍为 14，正文原生图片引用与附件 ID 均保持不变。用户确认可见与本次回读共同完成展示验收，证据见 [图片展示验收结果](../../../tools/rondo/build/tfs-sync-image-2026-11-14/display-acceptance.json)。

## 本机证据

运行产物保存在忽略目录 `tools/rondo/build/tfs-sync-image-2026-11-14/`：

- [现场验收断言结果](../../../tools/rondo/build/tfs-sync-image-2026-11-14/live-acceptance.json)
- [完整测试日志](../../../tools/rondo/build/tfs-sync-image-2026-11-14/full-test.log)
- [最终附件专项日志](../../../tools/rondo/build/tfs-sync-image-2026-11-14/final-attachment-tests.log)
- [第一轮结果](../../../tools/rondo/build/tfs-sync-image-2026-11-14/round1-result.json)与[调用日志](../../../tools/rondo/build/tfs-sync-image-2026-11-14/round1-stderr.log)
- [第二轮结果](../../../tools/rondo/build/tfs-sync-image-2026-11-14/round2-result.json)与[调用日志](../../../tools/rondo/build/tfs-sync-image-2026-11-14/round2-stderr.log)
- [图片哈希与尺寸](../../../tools/rondo/build/tfs-sync-image-2026-11-14/image-integrity.json)

本次修复范围仅包括根仓 rondo 与直接相关说明、测试及验证记录；Git 提交与推送按用户的独立授权执行。
