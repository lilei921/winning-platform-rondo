/** 确定性同步 TFS Work Item 至当前 Multica Workspace 的目标 Project。 */
import { mkdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { TfsClient } from "../../clients/tfs.js";
import { resolveMulticaRuntime, type MulticaRuntime } from "../../clients/runtime-context.js";
import { MulticaClient as SharedMulticaClient } from "../../clients/multica.js";
import { attachmentIdentity } from "../../tfs/attachments.js";

const REQUIRED_WI_FIELDS = ["id", "type", "title", "url", "state", "changedDate"] as const;

// 已存在 Issue 时允许更新的 TFS 管理字段（metadata key）。
// 执行字段（status / assignee / 运行事实）绝不更新。
const MANAGED_METADATA_KEYS = ["tfs.type", "tfs.url", "tfs.changed_at"] as const;

interface WorkItemAttachment {
  url: string;
  name?: string | null;
  comment?: string | null;
}

interface WorkItem {
  id: string | number;
  type: string;
  title: string;
  url: string;
  state: string;
  changedDate: string;
  /** TFS 全量字段原样透传（tfs-cli query 2026-10-28 增量契约）；旧版查询命令可能缺失 */
  fields?: Record<string, unknown>;
  /** relations 中 AttachedFile 解析结果；与 fields 同批引入 */
  attachments?: WorkItemAttachment[];
  [key: string]: unknown;
}

const INTAKE_AGENT = "Wayfinder Agent";
const MAX_ITEMS_PER_RUN = 50;

interface SyncResult {
  created: Array<Record<string, unknown>>;
  updated: Array<Record<string, unknown>>;
  skipped: Array<Record<string, unknown>>;
  failed: Array<Record<string, unknown>>;
  /** UNKNOWN 也返回本轮已确认事实与未处理项，不把已创建但未收口误报为成功。 */
  result?: "UNKNOWN";
  reason?: string;
  unprocessed?: Array<{ tfs_id: string }>;
}

function log(msg: string): void {
  process.stderr.write(msg + "\n");
}

async function queryWorkItems(tfs: TfsClient, wiql: string): Promise<WorkItem[]> {
  const raw = await tfs.run(["workitem", "query", "--wiql", wiql], "TFS 查询");
  if (!Array.isArray(raw)) throw new UnknownError("TFS 查询结果不是 JSON 数组");
  const items: WorkItem[] = [];
  raw.forEach((wi, i) => {
    const missing = REQUIRED_WI_FIELDS.filter((k) => !(k in (wi as object)));
    if (missing.length > 0) {
      throw new UnknownError(`Work Item 第 ${i} 项缺少字段 [${missing.join(", ")}]（身份不可确认，整体停止）`);
    }
    // 正文内嵌的 TFS attachment 图片在此并入附件列表，后续正文渲染与物化管线统一消费
    items.push(withInlineImages(wi as WorkItem));
  });
  const limit = MAX_ITEMS_PER_RUN;
  if (items.length > limit) {
    log(`查询结果 ${items.length} 项，本次只处理前 ${limit} 项`);
    return items.slice(0, limit);
  }
  return items;
}

function buildMetadata(wi: WorkItem): Record<string, string> {
  return {
    source: "tfs",
    "tfs.id": String(wi.id),
    "tfs.type": String(wi.type),
    "tfs.url": String(wi.url),
    "tfs.changed_at": String(wi.changedDate),
  };
}

/**
 * HTML → 可读文本（确定性转换，非语义理解）：br/块级闭合标签 → 换行，剥离其余标签，
 * 解码常见实体（&amp; 必须最后解码），压缩空行。原始 HTML 保留在 TFS 侧，Issue 正文
 * 是可读投影（validation/workitem/README.md §6.1：按展示需要另行生成可读文本）。
 * <img> 在剥标签前转占位：TFS attachment 内嵌图指向附件段（由 withInlineImages 物化），
 * 外链图保留原 URL，均不做文件名回填以保持确定性。
 */
function htmlToText(html: string): string {
  return html
    .replace(/<img\b[^>]*?\bsrc="([^"]+)"[^>]*>/gi, (_m, src: string) =>
      TFS_ATTACHMENT_URL_RE.test(src) ? "[图片: 见附件段]" : `[图片: ${src}]`)
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** U+FFFD 替换字符计数（validation/workitem/README.md §5：源返回可能自带乱码，只标注不猜字修正）。 */
function countReplacementChars(s: string): number {
  // 用 charCodeAt 而非字面量/正则转义，避免 U+FFFD 字符本身在源码中被编辑器吞掉
  let n = 0;
  for (const ch of s) if (ch.charCodeAt(0) === 0xfffd) n++;
  return n;
}

function fieldText(wi: WorkItem, field: string): { kind: "missing_fields" | "empty" | "ok"; text: string } {
  if (!wi.fields) return { kind: "missing_fields", text: "（查询结果未含 fields——查询命令需升级为含 fields/attachments 契约的 tfs-cli query 后重跑本同步补齐）" };
  const v = wi.fields[field];
  if (typeof v !== "string" || v.trim() === "") return { kind: "empty", text: "（空）" };
  return { kind: "ok", text: htmlToText(v) };
}

/** 已知内容字段全集（正文投影、乱码统计、内嵌图片提取都以此为界）。
 *  顺序即缺省渲染顺序；新增字段时三处语义自动覆盖。 */
const KNOWN_CONTENT_FIELDS = [
  { field: "System.Description", label: "需求详细信息" },
  { field: "Winning.Demand.Analysis", label: "需求分析" },
  { field: "Microsoft.VSTS.TCM.ReproSteps", label: "重现步骤" },
  { field: "Microsoft.VSTS.CMMI.Symptom", label: "症状" },
] as const;

/** 各工作项类型的主投影字段：无论是否为空都渲染小节（保留"（空）"占位语义）。
 *  TFS 本地化类型名中 "Bug" 不本地化；需求/任务等未登记类型走缺省，保持既有行为。 */
const PRIMARY_FIELDS_BY_TYPE: Record<string, readonly string[]> = {
  Bug: ["Microsoft.VSTS.TCM.ReproSteps", "Microsoft.VSTS.CMMI.Symptom"],
};
const DEFAULT_PRIMARY_FIELDS: readonly string[] = ["System.Description", "Winning.Demand.Analysis"];

/** 正文投影小节：类型主字段（含空占位）+ 主字段之外非空的已知内容字段（兜底防丢内容）。 */
function contentSections(wi: WorkItem): Array<{ field: string; label: string; text: string }> {
  const primaryNames = PRIMARY_FIELDS_BY_TYPE[wi.type] ?? DEFAULT_PRIMARY_FIELDS;
  const sections: Array<{ field: string; label: string; text: string }> = [];
  for (const f of KNOWN_CONTENT_FIELDS) {
    if (!(primaryNames as readonly string[]).includes(f.field)) continue;
    sections.push({ field: f.field, label: f.label, text: fieldText(wi, f.field).text });
  }
  for (const f of KNOWN_CONTENT_FIELDS) {
    if ((primaryNames as readonly string[]).includes(f.field)) continue;
    const t = fieldText(wi, f.field);
    if (t.kind === "ok") sections.push({ field: f.field, label: f.label, text: t.text });
  }
  return sections;
}

/** TFS attachment API 的 URL 特征（内嵌图片物化只认此类，外链图不下载）。
 *  两种实际形态（2026-11-10 实测）：
 *  `.../_apis/wit/attachments/{guid}?fileName=x.png`（GUID 在路径段）与
 *  `.../_apis/wit/attachments?FileNameGUID={guid}&FileName=x.png`（GUID 在查询串，无路径段）。 */
const TFS_ATTACHMENT_URL_RE = /\/_apis\/wit\/attachments(?:\/|\?|$)/i;

/** 从内容字段 HTML 提取内嵌的 TFS attachment 图片，视同 AttachedFile 并入附件管线。
 *  src 中的 HTML 实体（&amp;）先解码：TFS 富文本把查询串里的 & 转义存储（2026-11-10 实测），
 *  不解码会导致下载 URL 与 fileName 参数解析双双失真。 */
function extractInlineImages(html: string): WorkItemAttachment[] {
  const out: WorkItemAttachment[] = [];
  for (const m of html.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"[^>]*>/gi)) {
    const url = m[1].replace(/&amp;/gi, "&");
    if (!TFS_ATTACHMENT_URL_RE.test(url)) continue;
    const fileName = url.match(/[?&]fileName=([^&]+)/i);
    const guid = url.match(/attachments\/([0-9a-f-]+)/i) ?? url.match(/[?&]FileNameGUID=([^&]+)/i);
    out.push({
      url,
      name: fileName ? decodeURIComponent(fileName[1]) : `inline-image-${(guid?.[1] ?? "unknown").slice(0, 8)}`,
      comment: "（正文内嵌）",
    });
  }
  return out;
}

/** 实际 HTML 内嵌图片是展示依据；不根据附件注释或扩展名猜测图片。 */
function inlineImages(wi: WorkItem): WorkItemAttachment[] {
  const inline: WorkItemAttachment[] = [];
  for (const { field } of KNOWN_CONTENT_FIELDS) {
    const v = wi.fields?.[field];
    if (typeof v === "string") inline.push(...extractInlineImages(v));
  }
  return inline;
}

/** 按 collection + 附件 GUID 去重；批量查询造成的项目路径变化不改变附件身份。 */
function withInlineImages(wi: WorkItem): WorkItem {
  const inline = inlineImages(wi);
  if (!wi.attachments && inline.length === 0) return wi;
  const byUrl = new Map<string, WorkItemAttachment>();
  for (const a of [...(wi.attachments ?? []), ...inline]) {
    const key = attachmentIdentity(a.url);
    if (!byUrl.has(key)) byUrl.set(key, a);
  }
  return { ...wi, attachments: [...byUrl.values()] };
}

/** 附件映射：稳定的 TFS 附件身份 → Multica 副本；正文仍保留原 URL 以便追溯。 */
interface AttachmentEntry { name: string; multicaUrl: string | null }
type AttachmentMap = Map<string, AttachmentEntry>;

/** 附件段格式行（渲染器与解析器同源，格式只许从这里两端同步改）：
 *  `- <name> — [TFS 原始](<tfsUrl>) / [Multica 副本](<multicaUrl>)`（副本可缺省） */
function renderAttachmentLine(name: string, tfsUrl: string, multicaUrl: string | null, comment?: string | null): string {
  const base = `- ${name} — [TFS 原始](${tfsUrl})`;
  const copy = multicaUrl ? ` / [Multica 副本](${multicaUrl})` : "";
  return base + copy + (comment ? `（备注：${comment}）` : "");
}

/** 保留映射行并另写原生图片语法，让 Multica 渲染实际图片；文件名只作替代文本。 */
function renderInlineImage(name: string, multicaUrl: string): string {
  const alt = name.replace(/[\\[\]]/g, "\\$&").replace(/[\r\n]+/g, " ");
  return `![${alt}](${multicaUrl})`;
}

/** 已物化的旧内嵌图片可能只有普通链接：缺少原生展示引用时仅刷新正文，不重新上传。 */
function inlineImageDisplayPending(wi: WorkItem, map: AttachmentMap, body: string): boolean {
  const displayed = new Set([...body.matchAll(/!\[[^\n]*?\]\((\S+)\)/g)].map(m => m[1]));
  return inlineImages(wi).some(image => {
    const copy = map.get(attachmentIdentity(image.url))?.multicaUrl;
    return copy != null && !displayed.has(copy);
  });
}

function buildIssueBody(wi: WorkItem, attachMap?: AttachmentMap): string {
  // TFS 原始上下文写入 Issue 正文；不含任何本项目流程规则。
  const lines = [
    "## Source Requirement（TFS 原始事实）",
    "",
    `- TFS Work Item: ${wi.id}`,
    `- Type: ${wi.type}`,
    `- State: ${wi.state}`,
    `- URL: ${wi.url}`,
    `- Changed: ${wi.changedDate}`,
    "",
    "## Title",
    "",
    String(wi.title),
    "",
  ];

  const sections = contentSections(wi);
  for (const s of sections) {
    lines.push(`## ${s.label}（${s.field}）`, "", s.text, "");
  }

  lines.push("## 附件");
  lines.push("");
  if (!wi.attachments) {
    lines.push("（查询结果未含 attachments——同 fields 契约缺口）");
  } else if (wi.attachments.length === 0) {
    lines.push("（无附件）");
  } else {
    const imageIds = new Set(inlineImages(wi).map(image => attachmentIdentity(image.url)));
    for (const a of wi.attachments) {
      const name = a.name ?? "（未命名附件）";
      const identity = attachmentIdentity(a.url);
      const mapped = attachMap?.get(identity);
      lines.push(renderAttachmentLine(mapped?.name ?? name, a.url, mapped?.multicaUrl ?? null, a.comment));
      if (mapped?.multicaUrl && imageIds.has(identity)) {
        lines.push("", renderInlineImage(mapped.name, mapped.multicaUrl), "");
      }
    }
  }
  lines.push("");

  // 乱码标注（不自动猜字修正，交 Workitem Analyst 核实）：覆盖全部实际渲染的内容字段
  const mojibake = sections.reduce((n, s) => {
    const raw = wi.fields?.[s.field];
    return n + (typeof raw === "string" ? countReplacementChars(raw) : 0);
  }, 0);
  if (mojibake > 0) {
    lines.push(`> ⚠ 源字段含 ${mojibake} 处 U+FFFD 替换字符（TFS 源数据乱码，未做猜字修正，以 TFS 原文为准）。`);
    lines.push("");
  }
  return lines.join("\n");
}

/** 从既有正文重建附件映射（正文即映射）。识别三种行：
 *  1. 本版格式行（含/不含 Multica 副本链接）；
 *  2. 旧版清单行 `- name — <url>`（2026-10-28 初版遗产，视为已识别但未物化）；
 *  3. 任意位置的裸引用（`![name](url)` 或旧式 `!file[name](url)`）——上传成功但正文未及重写的崩溃遗留，按文件名认领。 */
function parseAttachmentMap(body: string): { map: AttachmentMap; bareRefs: Array<{ name: string; url: string }> } {
  const map: AttachmentMap = new Map();
  const bareRefs: Array<{ name: string; url: string }> = [];
  const remember = (sourceUrl: string, entry: AttachmentEntry): void => {
    const key = attachmentIdentity(sourceUrl);
    const previous = map.get(key);
    if (previous?.multicaUrl && entry.multicaUrl && previous.multicaUrl !== entry.multicaUrl) {
      throw new UnknownError(`附件 ${sourceUrl} 的同一身份映射到多个 Multica 副本，停止以免重复上传`);
    }
    // 遗留无副本行不能覆盖已经确认的映射。
    if (!previous?.multicaUrl) map.set(key, entry);
  };
  // TFS 正文可能为 CRLF：逐行剥 \r，避免下游 $ 锚定正则失配（2026-11-03 CRLF 同类排查）
  for (const line of body.split("\n").map((l) => l.replace(/\r$/, ""))) {
    const mNew = line.match(/^- (.+?) — \[TFS 原始\]\((\S+)\)(?: \/ \[Multica 副本\]\((\S+)\))?/);
    if (mNew) { remember(mNew[2], { name: mNew[1], multicaUrl: mNew[3] ?? null }); continue; }
    const mOld = line.match(/^- (.+?) — (https?:\/\/\S+?)(?:（备注：.*）)?$/);
    if (mOld) { remember(mOld[2], { name: mOld[1], multicaUrl: null }); continue; }
    const mBare = line.match(/^!(?:file)?\[(.+?)\]\((\S+)\)$/);
    if (mBare) bareRefs.push({ name: mBare[1], url: mBare[2] });
  }
  return { map, bareRefs };
}

/** 平台上传附件后在正文尾部追加的引用形态（2026-11-10 实测为图片语法 `![name](url)`；
 *  早期契约为 `!file[name](url)`，两种都识别）。 */
const ATTACH_REF_RE = /!(?:file)?\[.+?\]\((\S+)\)/g;

/** 下载只写本地文件；确定失败可隔离到当前工作项，未知执行错误仍停止批次。 */
class AttachmentDownloadError extends Error {
  constructor(message: string, readonly sourceUrl: string, readonly unknown = false) { super(message); }
}

async function downloadAttachment(tfs: TfsClient, attachment: WorkItemAttachment, out: string): Promise<{ path: string; name: string; size: number }> {
  let raw: unknown;
  try {
    raw = await tfs.run(["workitem", "download-attachment", "--url", attachment.url, "--out", out,
      ...(attachment.name ? ["--name", attachment.name] : [])], "下载附件");
  } catch (exc) {
    throw new AttachmentDownloadError(String(exc), attachment.url, true);
  }
  const value = raw as { path?: string; name?: string; size?: number };
  if (!value || typeof value.path !== "string" || !value.path.trim() || typeof value.name !== "string" || !value.name.trim()
    || typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 0) {
    throw new AttachmentDownloadError(`下载结果缺少有效 path/name/size: ${JSON.stringify(raw)}`, attachment.url);
  }
  try {
    const file = statSync(value.path);
    if (!file.isFile() || file.size !== value.size) throw new Error("文件类型或大小与下载结果不一致");
  } catch (exc) {
    throw new AttachmentDownloadError(`下载产物无法确认: ${String(exc)}`, attachment.url);
  }
  return value as { path: string; name: string; size: number };
}

/** 附件物化：当前 TFS 附件中未物化（映射缺失或无副本链接）的 → TFS API 下载 → issue update
 *  --attachment 上传 → 从返回正文识别新副本 URL 记入映射。平台不去重，命中映射的绝不重传。
 *  返回映射与是否有物化变化。崩溃遗留裸引用按文件名认领；同名歧义 → UNKNOWN（交人工）。 */
async function syncAttachments(
  client: MulticaClient,
  tfs: TfsClient,
  issueId: string,
  wi: WorkItem,
  existingBody: string,
): Promise<{ map: AttachmentMap; changed: boolean }> {
  const { map, bareRefs } = parseAttachmentMap(existingBody);
  const current = wi.attachments ?? [];
  let changed = false;
  // lastBody 随每次上传返回更新；新副本识别 = 上传后正文 !file 引用 − 上传前正文 !file 引用
  let lastBody = existingBody;

  // 1. 崩溃遗留裸引用认领：按文件名匹配"已识别但未物化"（含旧版清单行）的当前 TFS 附件；
  //    同名歧义（多个不同 TFS 附件同名）→ UNKNOWN；同一附件多条裸引用 → 认领首条，其余随重写清除
  const claimedCopies = new Set([...map.values()].map(entry => entry.multicaUrl).filter(url => url != null));
  for (const ref of bareRefs) {
    // 原生展示图片也是 ![name](url)，已映射的展示引用不能再认领给同名的新附件。
    if (claimedCopies.has(ref.url)) continue;
    const candidates = current.filter((a) => (a.name ?? "") === ref.name && !map.get(attachmentIdentity(a.url))?.multicaUrl);
    if (candidates.length === 1) {
      map.set(attachmentIdentity(candidates[0].url), { name: ref.name, multicaUrl: ref.url });
      claimedCopies.add(ref.url);
      changed = true;
      log(`attachment adopted from bare ref: ${ref.name}`);
    } else if (candidates.length > 1) {
      throw new UnknownError(`崩溃遗留附件引用 ![${ref.name}] 命中 ${candidates.length} 个同名 TFS 附件，无法认领（交人工核对）`);
    }
    // 0 个候选：已认领过/与当前 TFS 附件无关（如人工上传），重写正文时清除引用，平台附件本体保留
  }

  // 2. 未物化的当前 TFS 附件 → 下载 + 上传
  const pending = current.filter((a) => !map.get(attachmentIdentity(a.url))?.multicaUrl);
  const dlDir = join(tmpdir(), `tfs-sync-att-${process.pid}-${issueId}`);
  mkdirSync(dlDir, { recursive: true });
  try {
    for (const a of pending) {
      const dl = await downloadAttachment(tfs, a, dlDir);
      const knownRefs = new Set([...lastBody.matchAll(ATTACH_REF_RE)].map((m) => m[1]));
      const updated = client.uploadAttachment(issueId, dl.path);
      lastBody = String(updated.description ?? "");
      const fresh = [...lastBody.matchAll(ATTACH_REF_RE)].map((m) => m[1]).filter((u) => !knownRefs.has(u));
      if (fresh.length !== 1) {
        throw new UnknownError(`上传附件 ${dl.name} 后正文新增 !file 引用数=${fresh.length}（期望 1），副本身份不可确认`);
      }
      map.set(attachmentIdentity(a.url), { name: a.name ?? dl.name, multicaUrl: fresh[0] });
      changed = true;
      log(`attachment materialized: ${a.name ?? dl.name} -> ${fresh[0]}`);
    }
  } finally {
    try { rmSync(dlDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
  return { map, changed };
}

interface IssueRecord {
  id: string | number;
  metadata?: Record<string, string>;
  description?: string;
  [key: string]: unknown;
}

/** multica CLI 封装。flag 已对照 0.6.1 核验；升级 CLI 版本后须复核。 */
class MulticaClient {
  private client: SharedMulticaClient;
  private project: string;
  private initialStatus: string;
  private intakeAgentId: string | null = null;

  constructor(runtime: MulticaRuntime, projectTitle: string, initialStatus: string) {
    this.client = new SharedMulticaClient(runtime);
    const projects = this.client.run(["project", "list", ...this.client.ws(), "--output", "json"], "查询目标 Project", { transient: true });
    if (!Array.isArray(projects)) throw new UnknownError("Project list 结果不可识别");
    const matches = projects.filter(p => p?.title === projectTitle);
    if (matches.length !== 1 || typeof matches[0]?.id !== "string" || !matches[0].id.trim()) {
      throw new UnknownError(`Project ${projectTitle} 未唯一登记（匹配数=${matches.length}）`);
    }
    this.project = matches[0].id;
    this.initialStatus = initialStatus;
  }

  private ws(): string[] {
    return this.client.ws();
  }

  /** 使用当前 Workspace 中唯一的 Wayfinder Agent ID，避免名称漂移后静默派错人。 */
  resolveIntakeAgentId(): string {
    if (this.intakeAgentId) return this.intakeAgentId;
    // Agent 清单是只读查询，网络瞬断时使用共享退避；不把重试扩散到后续创建操作。
    const out = this.client.run(["agent", "list", ...this.ws(), "--output", "json"], "读取准入 Agent", { transient: true }) as Array<{ id?: string; name?: string }>;
    if (!Array.isArray(out)) throw new UnknownError("Agent list 结果不可识别");
    const hits = out.filter((a) => a.name === INTAKE_AGENT && a.id);
    if (hits.length !== 1) throw new UnknownError(`准入 Agent ${INTAKE_AGENT} 未唯一登记（匹配数=${hits.length}）`);
    this.intakeAgentId = String(hits[0].id);
    return this.intakeAgentId;
  }

  /** 只有本次创建且未完成初始化的 Issue 才可走受控恢复。 */
  private checkIntakeReady(issueId: string, wi: WorkItem): IssueRecord {
    const actual = this.client.getIssue(issueId) as IssueRecord;
    const meta = actual.metadata ?? {};
    const expected = buildMetadata(wi);
    const missing = Object.entries(expected).filter(([key, value]) => meta[key] !== value).map(([key]) => key);
    if (meta["tfs.intake_pending"] !== "true" || meta["tfs.body_at"] !== String(wi.changedDate) || missing.length > 0) {
      throw new UnknownError(`Issue ${issueId} 的 TFS 来源尚未完整回读（缺失/不一致：${missing.join(",") || "pending/body_at"}）`);
    }
    if (String(actual.assignee_id ?? "") !== this.resolveIntakeAgentId()) {
      throw new UnknownError(`Issue ${issueId} 的 Owner 已变化，停止自动收口`);
    }
    return actual;
  }

  /** 初始化完成收口：回读身份与 Owner 后清除 pending 标记，Issue 保持 backlog 停放，
   *  不做状态激活（准入由 Human Mention 触发）；todo 视为人工已提前处理，兼容放行。 */
  finalizeIntake(issueId: string, wi: WorkItem): { status: string } {
    const before = this.checkIntakeReady(issueId, wi);
    if (before.status !== "backlog" && before.status !== "todo") {
      throw new UnknownError(`Issue ${issueId} 不在可收口的 backlog/todo 状态（${String(before.status)}）`);
    }
    this.client.deleteMetadata(issueId, "tfs.intake_pending");
    const after = this.client.getIssue(issueId) as IssueRecord;
    if (String(after.assignee_id ?? "") !== this.resolveIntakeAgentId()) {
      throw new UnknownError(`Issue ${issueId} 收口后 Owner 未能回读为 Wayfinder，需人工核对`);
    }
    return { status: String(after.status) };
  }

  /**
   * 初始化收口后按配置激活：backlog 直接返回；todo 发一次不带 --no-start 的状态写，
   * 触发 Multica 原生 Run。启动信号不可重发，响应不确定时 setStatusWithStart 抛 UNKNOWN。
   */
  activateIssue(issueId: string): void {
    if (this.initialStatus === "backlog") return;
    this.client.setStatusWithStart(issueId, this.initialStatus, `Issue ${issueId} 初始化收口后激活`);
    const after = this.client.getIssue(issueId) as IssueRecord;
    if (String(after.status) !== this.initialStatus) {
      throw new UnknownError(`Issue ${issueId} 激活后状态回读为 ${String(after.status)}，期望 ${this.initialStatus}`);
    }
  }

  /** 按 metadata tfs.id 查找既有 Delivery Issue。返回 null 表示不存在。 */
  findByTfsId(tfsId: string): IssueRecord | null {
    // 实测（0.6.1，2026-10-14）：--metadata 走 pflag StringSlice（CSV 解析），
    // 裸双引号报 bare " in non-quoted-field；正确形式是 CSV 全引用：
    //   "tfs.id=""256462"""  →  解析出 tfs.id="256462"（双引号强制 string 匹配，
    //   与 metadata set --type string 的存储类型对齐；不带引号会按 number 嗅探、匹配不上）。
    const out = this.client.run(
      ["issue", "list",
       "--project", this.project,
       "--metadata", `"tfs.id=""${tfsId}"""`,
       ...this.ws(),
       "--output", "json"],
      `查找 Issue(tfs.id=${tfsId})`,
    );
    const issues: IssueRecord[] = Array.isArray(out)
      ? out
      : ((out as { issues?: IssueRecord[] }).issues ?? []);
    if (issues.length > 1) {
      throw new UnknownError(`tfs.id=${tfsId} 命中 ${issues.length} 个 Issue，身份不唯一`);
    }
    return issues[0] ?? null;
  }

  createIssue(wi: WorkItem, onCreated: (issue: IssueRecord) => void): IssueRecord {
    // create 无 --no-start：新建停放 backlog，完整初始化回读即完成，不做状态激活。
    const cmd = [
      "issue", "create",
      "--project", this.project,
      "--title", `[TFS ${wi.id}] ${wi.title}`,
      "--description", buildIssueBody(wi),
      "--assignee", INTAKE_AGENT,
      "--status", "backlog",
      ...this.ws(),
      "--output", "json",
    ];
    const created = this.client.run(cmd, `创建 Issue(tfs.id=${wi.id})`) as IssueRecord;
    if (created == null || created.id == null) {
      throw new UnknownError(`创建 Issue(tfs.id=${wi.id}) 返回缺少 id`);
    }
    // 先记录已确认的 Issue 身份；后续 metadata/附件失败也必须在结果中保留此事实。
    onCreated(created);
    // 首先登记稳定的外部身份，再记录最小恢复标记；失败后可按同一 tfs.id 接续初始化。
    this.client.setMetadata(String(created.id), "tfs.id", String(wi.id));
    this.client.setMetadata(String(created.id), "tfs.intake_pending", "true");
    const rest = buildMetadata(wi);
    delete rest["tfs.id"];
    this.setMetadata(String(created.id), rest);
    this.markBodySynced(String(created.id), wi);
    return created;
  }

  /** 正文投影书签：正文内容对应哪个 changedDate。缺失/不一致 = 正文过期需刷新（存量骨架正文由此确定性回填）。 */
  markBodySynced(issueId: string, wi: WorkItem): void {
    this.client.setMetadata(issueId, "tfs.body_at", String(wi.changedDate));
  }

  /** 逐键写入 metadata（CLI 粒度为单键；全部强制 string，与 find 的字符串匹配对齐）。 */
  setMetadata(issueId: string, metadata: Record<string, string>): void {
    for (const [k, v] of Object.entries(metadata)) {
      this.client.setMetadata(issueId, k, v);
    }
  }

  updateManagedFields(issueId: string, wi: WorkItem): void {
    const metadata = buildMetadata(wi);
    const patch: Record<string, string> = {};
    for (const k of MANAGED_METADATA_KEYS) patch[k] = metadata[k];
    this.setMetadata(issueId, patch);
  }

  /**
   * 刷新 Issue 正文为最新 TFS 原始上下文投影（issue update --description-file --no-start：
   * 正文是流转无关的来源事实，不触发 Run）。--allow-external-file：tmp 文件在 cwd 之外。
   * attachMap：附件映射（tfs url → Multica 副本），渲染附件段的副本链接。
   */
  updateBody(issueId: string, wi: WorkItem, attachMap?: AttachmentMap): void {
    const tmp = join(tmpdir(), `tfs-sync-body-${process.pid}-${issueId}.md`);
    writeFileSync(tmp, buildIssueBody(wi, attachMap), "utf8");
    try {
      this.client.run(
        ["issue", "update", issueId,
         "--description-file", tmp, "--allow-external-file", "--no-start",
         ...this.ws(), "--output", "json"],
        `刷新 Issue 正文(issue=${issueId}, tfs.id=${wi.id})`,
      );
    } finally {
      try { unlinkSync(tmp); } catch { /* 忽略 */ }
    }
  }

  /** 上传附件到 Issue（平台自动在正文尾部追加附件引用，实测为 `![name](url)`；
   *  返回更新后 Issue 供识别新副本 URL）。
   *  平台不去重：调用前必须确认映射缺失（syncAttachments 保证）。 */
  uploadAttachment(issueId: string, filePath: string): IssueRecord {
    return this.client.run(
      ["issue", "update", issueId,
       "--attachment", filePath, "--allow-external-file", "--no-start",
       ...this.ws(), "--output", "json"],
      `上传附件(issue=${issueId}, file=${filePath})`,
    ) as IssueRecord;
  }
}

async function reconcile(client: MulticaClient, tfs: TfsClient, wiql: string): Promise<SyncResult> {
  const result: SyncResult = { created: [], updated: [], skipped: [], failed: [] };
  const items = await queryWorkItems(tfs, wiql);
  client.resolveIntakeAgentId(); // 任何创建/写入前预检当前工作区的唯一准入 Agent

  for (const [index, wi] of items.entries()) {
    const tfsId = String(wi.id);
    let issueId: string | undefined;
    let createdThisRun = false;
    let stage = "lookup";
    try {
      const existing = client.findByTfsId(tfsId);
      if (existing === null) {
        stage = "create";
        const created = client.createIssue(wi, issue => { issueId = String(issue.id); createdThisRun = true; });
        issueId = String(created.id);
        // 附件物化：新建 Issue 正文尚无映射，从空正文起步；有附件则重写正文渲染副本链接
        if ((wi.attachments ?? []).length > 0) {
          stage = "attachments";
          const att = await syncAttachments(client, tfs, issueId, wi, "");
          client.updateBody(issueId, wi, att.map);
        }
        stage = "finalize";
        const intake = client.finalizeIntake(issueId, wi);
        client.activateIssue(issueId); // 仅本次新建：配置 todo 时收口后才发启动信号
        result.created.push({ tfs_id: tfsId, issue: created, attachments: (wi.attachments ?? []).length, intake });
        log(`created: tfs ${tfsId}`);
        continue;
      }

      issueId = String(existing.id);
      stage = "metadata";
      const current = existing.metadata ?? {};
      const desired = buildMetadata(wi);
      const managedSame = MANAGED_METADATA_KEYS.every((k) => current[k] === desired[k]);
      // 正文过期判定：书签 tfs.body_at ≠ 当前 changedDate（旧版骨架正文无书签 → 一次性回填）
      const bodyStale = current["tfs.body_at"] !== String(wi.changedDate);
      const intakePending = current["tfs.intake_pending"] === "true";
      // 崩溃若发生在 tfs.id / pending 写入之后、其他来源键写入之前，只补齐初始化事实。
      if (intakePending && current.source !== "tfs") {
        if (current.source != null) throw new UnknownError(`Issue ${issueId} pending 来源冲突，停止收口`);
        client.setMetadata(issueId, { source: "tfs" });
      }
      // 附件待物化判定：解析既有正文映射，当前 TFS 附件存在无副本链接者（旧清单行/新附件 → 一次性补齐）
      const existingBody = String(existing.description ?? "");
      // 仅识别旧版 create 写入的模板前缀，避免误改正文中合法的字面 \\n。
      const legacyEscapedBody = existingBody.startsWith("## Source Requirement（TFS 原始事实）\\n\\n- TFS Work Item:");
      const parsed = parseAttachmentMap(existingBody);
      const attachmentsPending = (wi.attachments ?? []).some((a) => !parsed.map.get(attachmentIdentity(a.url))?.multicaUrl);
      const imageDisplayPending = inlineImageDisplayPending(wi, parsed.map, existingBody);
      if (managedSame && !bodyStale && !legacyEscapedBody && !attachmentsPending && !imageDisplayPending && !intakePending) {
        result.skipped.push({ tfs_id: tfsId, issue_id: issueId, reason: "管理字段、正文与附件均无变化" });
        continue;
      }
      if (!managedSame) client.updateManagedFields(issueId, wi);
      stage = "attachments";
      const att = await syncAttachments(client, tfs, issueId, wi, existingBody);
      const bodyRefreshed = bodyStale || legacyEscapedBody || att.changed || attachmentsPending || imageDisplayPending;
      if (bodyRefreshed) {
        stage = "body";
        client.updateBody(issueId, wi, att.map);
        client.markBodySynced(issueId, wi);
      }
      // 仅本同步新建的 pending Issue 可恢复收口；其他存量 Issue 绝不改状态或 Owner。
      stage = "finalize";
      const intake = intakePending ? client.finalizeIntake(issueId, wi) : undefined;
      // 仅 pending 续接可补发启动信号；普通既有 Issue 的更新绝不重复激活
      if (intakePending) client.activateIssue(issueId);
      result.updated.push({
        tfs_id: tfsId, issue_id: issueId,
        managed_updated: !managedSame, body_refreshed: bodyRefreshed, attachments_materialized: att.changed,
        ...(intake ? { intake } : {}),
      });
      log(`updated: tfs ${tfsId} -> issue ${issueId}（managed=${!managedSame}, body=${bodyRefreshed}, attachments=${att.changed}）`);
    } catch (exc) {
      const unknown = exc instanceof UnknownError || (exc instanceof AttachmentDownloadError && exc.unknown);
      result.failed.push({ tfs_id: tfsId, ...(issueId ? { issue_id: issueId } : {}), created: createdThisRun,
        stage: exc instanceof AttachmentDownloadError ? "download" : stage,
        ...(exc instanceof AttachmentDownloadError ? { source_url: exc.sourceUrl } : {}),
        outcome: unknown ? "UNKNOWN" : "failed", error: String(exc) });
      if (unknown) {
        // 已确认写入不回滚；附完整进度供回读恢复，未处理项不得被当成 skipped。
        result.result = "UNKNOWN";
        result.reason = exc instanceof Error ? exc.message : String(exc);
        result.unprocessed = items.slice(index + 1).map(item => ({ tfs_id: String(item.id) }));
        log(`UNKNOWN: ${result.reason}`);
        return result;
      }
      // 下载等确定性单项失败不中断其余项，pending 留待修复后续接。
      log(`failed: tfs ${tfsId}: ${exc}`);
    }
  }

  return result;
}

async function main(wiql: string, initialStatus: string): Promise<number> {
  let result: SyncResult;
  try {
    const projectTitle = process.env.RONDO_PROJECT_TITLE?.trim();
    if (!projectTitle) throw new UnknownError("缺少 RONDO_PROJECT_TITLE");
    if (!wiql.trim()) throw new UnknownError("WIQL 不能为空");
    if (initialStatus !== "backlog" && initialStatus !== "todo") throw new UnknownError("initial_status 仅支持 backlog / todo");
    const client = new MulticaClient(resolveMulticaRuntime(), projectTitle, initialStatus);
    result = await reconcile(client, new TfsClient(), wiql);
  } catch (exc) {
    if (exc instanceof UnknownError) {
      log(`UNKNOWN: ${exc.message}`);
      process.stdout.write(JSON.stringify({ result: "UNKNOWN", reason: exc.message }) + "\n");
      return 3;
    }
    throw exc;
  }

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.result === "UNKNOWN") return 3;
  return result.failed.length === 0 ? 0 : 2;
}

/** 注册工作项同步命令。 */
export function registerTfsReconcileWorkitem(group: Command): void {
  group
    .command("sync-issue")
    .description("将 TFS 工作项同步为 Multica Issue")
    .requiredOption("--wiql <WIQL>", "TFS 查询范围")
    .option("--initial-status <status>", "新建 Issue 初始状态（backlog / todo）", "backlog")
    .action(async (opts: { wiql: string; initialStatus: string }) => {
      markLeafExecuted();
      throw new ExitSignal(await main(opts.wiql, opts.initialStatus));
    });
}
