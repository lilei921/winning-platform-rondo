# tfs reconcile-workitem：按类型投影正文字段 + 内嵌图片物化

## Context

TFS 不同工作项类型的正文存在不同字段（实测同一项目 DP-01-数据仓库）：Bug 的内容在 `Microsoft.VSTS.TCM.ReproSteps`（重现步骤）和 `Microsoft.VSTS.CMMI.Symptom`（症状），`System.Description` / `Winning.Demand.Analysis` 常为空；需求则相反。当前 `rondo tfs reconcile-workitem` 的 Issue 正文固定只投影 `System.Description` + `Winning.Demand.Analysis`，导致 Bug 同步进 Multica 后正文显示"（空）"（实例：MULT-11 ← TFS 263397，详细内容 1351 字符在 ReproSteps 里丢失）。

第二个正交缺口：正文 HTML 里的内嵌图片（`<img src=".../_apis/wit/attachments/{guid}...">`）被 `htmlToText()` 的 `.replace(/<[^>]+>/g, "")` 无声剥掉。既有验证样本 TFS 244432（Bug）的 ReproSteps 含 1 个 `<img>`（`projects/multica/validation/tfs-mcp-capability-comparison.md:197`），只改字段投影截图照样丢——对封版测试类 Bug，截图恰恰是关键信息。

查询契约（`tools/rondo/src/tfs/api/query.ts`）已透传 TFS 全量 `fields`，**无需改动查询层**；改动集中在正文投影层与附件提取层。

## 改动一：按工作项类型投影字段

### `tools/rondo/src/commands/tfs/reconcile-workitem.ts`

**a. 新增类型字段映射表**（放在 `fieldText` 附近）：

```ts
/** 已知内容字段全集（渲染/乱码统计/图片提取都以此为界） */
const KNOWN_CONTENT_FIELDS = [
  { field: "System.Description", label: "需求详细信息" },
  { field: "Winning.Demand.Analysis", label: "需求分析" },
  { field: "Microsoft.VSTS.TCM.ReproSteps", label: "重现步骤" },
  { field: "Microsoft.VSTS.CMMI.Symptom", label: "症状" },
] as const;

/** 各类型的主投影字段（无论是否为空都渲染小节，保留"（空）"占位语义） */
const PRIMARY_FIELDS_BY_TYPE: Record<string, string[]> = {
  Bug: ["Microsoft.VSTS.TCM.ReproSteps", "Microsoft.VSTS.CMMI.Symptom"],
};
const DEFAULT_PRIMARY_FIELDS = ["System.Description", "Winning.Demand.Analysis"];
```

**b. 重写 `buildIssueBody` 的正文段**（当前 220-223 行）：
- 主字段 = `PRIMARY_FIELDS_BY_TYPE[wi.type] ?? DEFAULT_PRIMARY_FIELDS`（`wi.type` 为 TFS 本地化类型名，"Bug" 不本地化，需求/任务等走缺省，保持现有行为）；
- 非空兜底：主字段之外、`KNOWN_CONTENT_FIELDS` 内**有实际内容**（`fieldText` 返回 `kind === "ok"`）的字段追加为额外小节；
- 小节标题格式不变：`## {label}（{TFS字段名}）`；
- `missing_fields` 契约缺口提示逻辑不变。

**c. 乱码统计**（当前 241-243 行硬编码两个字段）：改为对**所有实际渲染到正文的字段**（主字段 + 兜底字段）的原始字符串统一 `countReplacementChars`，标注文案不变。

## 改动二：正文内嵌图片视同附件物化

### `tools/rondo/src/commands/tfs/reconcile-workitem.ts`

**a. 图片提取**：在 `htmlToText` 之前扫描 `KNOWN_CONTENT_FIELDS` 中各字段的原始 HTML，用正则提取 `<img src="...">`，筛出指向 TFS attachment API 的 URL（`/_apis/wit/attachments/{guid}`）。

**b. 注入附件管线**：提取的图片转为 `WorkItemAttachment`（`name` 取 src 的 `fileName` 参数，缺省用 `inline-image-{guid前8位}`；`comment` 标记来源如 `（正文内嵌）`），**并入 `wi.attachments`**——之后完全复用既有物化管线：`tfs-cli download-attachment` 下载 → `issue update --attachment` 上传 → 附件段渲染副本链接。幂等、防重、崩溃认领（裸 `!file` 按文件名）全部自动继承，不造第二套机制。

**c. 图片占位**：`htmlToText` 增加一步，在剥标签前把 `<img ...>` 替换为 `[图片: 见附件段]`，保留图文位置语义（不做图名回填，保持确定性）。

**d. 去重**：同一 attachment URL 既在 relations（AttachedFile）又在正文 `<img>` 出现时，按 URL 去重只物化一次（`attachments` 合并时以 URL 为键）。

**e. 非 TFS 图片**（外链 http 图片）：不下载不上传，正文中保留原 URL 文本占位 `[图片: {url}]`，避免把不可控外部资源物化进平台。

### 不改动的部分

`parseAttachmentMap` 解析格式、metadata 管理字段、刷新触发条件（`tfs.body_at` 书签机制会让既有 Issue 在 TFS 变更后自动刷新成新格式）、退出码语义。

## 契约文档更新

### `projects/multica/workspace-skills/tfs-sync/references/metadata-contract.md`

- 第 3 条：正文投影改为"按工作项类型选择主内容字段（Bug → `Microsoft.VSTS.TCM.ReproSteps` / `Microsoft.VSTS.CMMI.Symptom`；其他类型 → `System.Description` / `Winning.Demand.Analysis`），主字段之外已知内容字段非空时追加投影；乱码统计覆盖全部投影字段"。
- 第 4 条补充：正文 HTML 内嵌的 TFS attachment 图片视同 AttachedFile 附件，并入同一映射与物化流程（按 URL 去重）；非 TFS 外链图片不物化，正文保留 URL 占位。
- 第 37 行 `fields` 说明把 ReproSteps/Symptom 列进示例。

## 测试

`tools/rondo/test/` 新增 `tfs-reconcile-body-fields.test.mjs`（参照 `dev-pr-prep.test.mjs` / `mock-multica.cjs` 的既有模式，跑编译后 dist；mock 需视情况补 `issue list --metadata` 过滤与 `issue update --description-file` 支持，或仅在 create 路径验证）：
- Bug 样本（Description 空、ReproSteps 有内容）→ 正文含"## 重现步骤（Microsoft.VSTS.TCM.ReproSteps）"且有实际文本；
- 需求样本（Description + Demand.Analysis 有内容）→ 保持现有两小节格式不变（回归）；
- Bug 样本 Description 也有内容 → 追加 Description 小节（非空兜底）；
- ReproSteps 含 U+FFFD → 正文末尾乱码标注计数正确；
- 内容字段含 `<img src=".../attachments/{guid}?fileName=x.png">` → 该图进入附件段并物化，正文图片原位留 `[图片: 见附件段]`；同一 URL 在 AttachedFile 重复出现只物化一次；外链图片不物化、留 URL 占位。

## 验证

1. `npm run build`（tools/rondo）+ 新增测试通过；
2. 用 `projects/multica/workspace-skills/tfs-sync/config/sync-config.json` 指向的 multica_rondo 工作区，对 TFS 263397 重跑 `rondo tfs reconcile-workitem`（既有 Issue MULT-11 因正文格式变化经书签机制刷新），确认正文出现 ReproSteps 的实际内容（环境 URL、操作路径）；
3. 用 TFS 244432（ReproSteps 含 1 个内嵌 `<img>`）验证图片物化：Issue 附件段出现副本链接，正文有占位；
4. 对一个需求类工作项重跑，确认正文格式与改动前一致（回归）。
