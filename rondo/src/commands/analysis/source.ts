/** 分析来源只保存 Git 指针；读取方始终固定 commit，不追随分支或本地工作树。 */
import { createHash } from "node:crypto";
import { FailError, UnknownError } from "../../cli/errors.js";
import { TfsClient } from "../../tfs/client.js";

export interface AnalysisSource {
  repo_url: string;
  branch: string;
  commit: string;
  change_ref: string;
}

/** URL 不得含凭据；只接受当前实现明确支持的 TFS Git HTTP(S) 地址。 */
export function repositoryUrl(raw: unknown): URL {
  try {
    if (typeof raw !== "string" || !raw || /[\s\\]/.test(raw)) throw new Error();
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    url.pathname = url.pathname.replace(/\/+$/, "");
    const parts = url.pathname.split("/");
    if (parts.length < 5 || parts.at(-2) !== "_git" || parts.slice(1).some(p => !p || /[/\\?#%]/.test(decodeURIComponent(p)))) throw new Error();
    return url;
  } catch {
    // 不输出原始 URL，避免把意外携带的认证信息写进日志。
    throw new UnknownError("分析来源 repo_url 必须是无凭据、无查询参数的 TFS Git HTTP(S) 地址");
  }
}

/** Repository name is the decoded final segment of the actual TFS Git URL. */
export function repositoryName(raw: unknown): string {
  return decodeURIComponent(repositoryUrl(raw).pathname.split("/").at(-1)!);
}

export function parseAnalysisSource(raw: unknown, changeRef?: string): AnalysisSource {
  let value: unknown;
  try { value = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch { throw new UnknownError("analysis.source 不是合法 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UnknownError("缺少有效 analysis.source，须重新提交分析审核");
  const s = value as Record<string, unknown>;
  const url = repositoryUrl(s.repo_url);
  if (typeof s.branch !== "string" || !s.branch.trim() || /[\s\x00-\x1f]/.test(s.branch) ||
      typeof s.commit !== "string" || !/^[0-9a-f]{40}$/.test(s.commit) ||
      typeof s.change_ref !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s.change_ref) ||
      (changeRef !== undefined && s.change_ref !== changeRef)) {
    throw new UnknownError("analysis.source 分支、完整 commit 或 Change 身份非法/不一致");
  }
  return { repo_url: url.href, branch: s.branch, commit: s.commit, change_ref: s.change_ref };
}

export function readAnalysisSource(md: Record<string, unknown>): AnalysisSource {
  return parseAnalysisSource(md["analysis.source"]);
}

/** 固定发布来源：仓库、分支、Commit 与 Change 必须一致。 */
export function sameAnalysisSource(a: AnalysisSource, b: AnalysisSource): boolean {
  return a.repo_url === b.repo_url && a.branch === b.branch && a.commit === b.commit && a.change_ref === b.change_ref;
}

export function analysisArtifactPath(source: AnalysisSource, file: string): string {
  if (!file || /[\\%?#\x00-\x1f]/.test(file) || file.split("/").some(p => !p || p === "." || p === "..")) {
    throw new FailError("--file 必须是当前 Change 内的相对文件路径，不得穿越目录");
  }
  return `/openspec/changes/${source.change_ref}/${file}`;
}

export interface AnalysisArtifact { source: AnalysisSource; path: string; object_id: string; content: string; sha256: string }

/** 仅 GET；先校验服务边界，再使用现有 PAT，防止 metadata 将凭据发往其他主机。 */
export async function readAnalysisArtifact(source: AnalysisSource, file: string): Promise<AnalysisArtifact> {
  const path = analysisArtifactPath(source, file);
  const repo = repositoryUrl(source.repo_url);
  let client: TfsClient;
  let configured: URL;
  try {
    client = new TfsClient();
    configured = new URL(client.config.serverUrl);
  } catch {
    throw new UnknownError("TFS 凭据或服务配置无效，无法读取规范");
  }
  const parts = repo.pathname.split("/");
  const collectionBase = parts.slice(0, -4).join("/");
  const configuredBase = configured.pathname.replace(/\/+$/, "").split("/").slice(0, -1).join("/");
  if (repo.origin !== configured.origin || collectionBase.toLowerCase() !== configuredBase.toLowerCase()) {
    throw new UnknownError("analysis.source 与配置的 TFS 服务不一致，拒绝发送凭据");
  }
  const url = new URL(repo.href);
  url.pathname = parts.slice(0, -2).join("/") + "/_apis/git/repositories/" + parts.at(-1) + "/items";
  for (const [key, value] of Object.entries({ path, includeContent: "true", "versionDescriptor.versionType": "commit", "versionDescriptor.version": source.commit, "api-version": "4.1" })) url.searchParams.set(key, value);
  let response;
  try { response = await client.rawRequest(url.href, "GET"); }
  catch { throw new UnknownError("TFS 规范读取失败（连接或超时），未回退本地文件"); }
  if (response.statusCode === 404) throw new FailError("指定 commit 下的规范文件不存在或不可见");
  if (response.statusCode !== 200) throw new UnknownError(`TFS 规范读取 HTTP ${response.statusCode}，未回退其他版本`);
  let item;
  try { item = JSON.parse(response.body); }
  catch { throw new UnknownError("TFS 规范响应不是合法 JSON"); }
  if (!item || typeof item !== "object" || Array.isArray(item) || item.commitId !== source.commit || item.path !== path || item.isFolder || typeof item.content !== "string" || !/^[0-9a-f]{40}$/.test(item.objectId)) {
    throw new UnknownError("TFS 规范响应的 commit、路径或正文不匹配");
  }
  return { source, path, object_id: item.objectId, content: item.content, sha256: createHash("sha256").update(item.content).digest("hex") };
}

/** 只识别原生 checkbox 编号，不解释任务语义；重复编号不是可派发契约。 */
export function taskReferences(text: string): string[] {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(/^\s*- \[[ xX]\]\s+(\S+)/gm)) {
    const ref = match[1].replace(/\.$/, "");
    counts.set(ref, (counts.get(ref) ?? 0) + 1);
  }
  const duplicate = [...counts].filter(([, count]) => count > 1).map(([ref]) => ref);
  if (duplicate.length) throw new FailError(`tasks.md 原生任务编号重复: ${duplicate.join(", ")}`);
  return [...counts.keys()];
}

export function locateTaskRefs(text: string, refs: string[]): string[] {
  const available = new Set(taskReferences(text));
  return refs.filter(ref => !available.has(ref));
}
