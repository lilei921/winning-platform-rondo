/** Read pinned remote Engineering Contract files for Analysis and Development. */
import { FailError, UnknownError } from "../../cli/errors.js";
import { TfsClient } from "../../tfs/client.js";
import { repositoryUrl } from "../analysis/source.js";

interface GitItem { path: string; commitId: string; objectId: string; isFolder?: boolean; content?: string; gitObjectType?: string }
type ReaderClient = Pick<TfsClient, "config" | "rawRequest">;
const fullSha = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{40}$/.test(v);

/** 各平台统一拒绝路径穿越、Windows 特殊文件和潜在 NTFS 流，不依赖 URL 编码隐藏路径。 */
function safePath(path: string): void {
  if (!path.startsWith("/") || path.split("/").slice(1).some(p => !p || p === "." || p === ".." ||
      /[\\:\x00-\x1f<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p) || p.toLowerCase() === ".git")) {
    throw new UnknownError("远端工件包含不安全路径，拒绝物化");
  }
}

export class RemoteArtifactReader {
  readonly repoUrl: string;
  private api: string;
  constructor(raw: string, private client: ReaderClient = new TfsClient()) {
    const repo = repositoryUrl(raw); const configured = new URL(client.config.serverUrl);
    const parts = repo.pathname.split("/");
    if (repo.origin !== configured.origin || parts.slice(0, -4).join("/").toLowerCase() !==
        configured.pathname.replace(/\/+$/, "").split("/").slice(0, -1).join("/").toLowerCase()) {
      throw new UnknownError("远端根仓与配置的 TFS 服务不一致，拒绝发送凭据");
    }
    this.repoUrl = repo.href;
    this.api = `${repo.origin}${parts.slice(0, -2).join("/")}/_apis/git/repositories/${parts.at(-1)}`;
  }
  private async get(resource: string, query: Record<string, string>): Promise<unknown> {
    const url = new URL(`${this.api}/${resource}`);
    Object.entries({ ...query, "api-version": "4.1" }).forEach(([k, v]) => url.searchParams.set(k, v));
    let response;
    try { response = await this.client.rawRequest(url.href, "GET"); }
    catch { throw new UnknownError("远端工件读取连接失败，未回退本地或其他版本"); }
    if (response.statusCode === 404) throw new FailError("固定版本的远端工件不存在或不可见");
    if (response.statusCode !== 200) throw new UnknownError(`远端工件读取 HTTP ${response.statusCode}`);
    if (Buffer.byteLength(response.body) > 32 * 1024 * 1024) throw new UnknownError("远端工件响应超过读取上限");
    try { return JSON.parse(response.body); } catch { throw new UnknownError("远端工件响应不是合法 JSON"); }
  }
  async list(commit: string, scope: string): Promise<GitItem[]> {
    safePath(scope);
    if (!fullSha(commit)) throw new UnknownError("远端读取必须固定完整 commit");
    const response = await this.get("items", { scopePath: scope, recursionLevel: "Full", "versionDescriptor.versionType": "commit", "versionDescriptor.version": commit }) as { value?: unknown };
    if (!response || !Array.isArray(response.value) || response.value.length > 6000) throw new UnknownError("工件目录响应非法或超过数量上限");
    const seen = new Set<string>();
    for (const item of response.value) {
      if (!item || typeof item.path !== "string" || item.commitId !== commit ||
          (item.path !== scope && !item.path.startsWith(`${scope}/`)) || !fullSha(item.objectId) || seen.has(item.path)) {
        throw new UnknownError("工件目录响应的 commit、路径或对象身份不一致");
      }
      safePath(item.path); seen.add(item.path);
    }
    return response.value;
  }
  async read(commit: string, path: string): Promise<string> {
    safePath(path);
    if (!fullSha(commit)) throw new UnknownError("远端读取必须固定完整 commit");
    const item = await this.get("items", { path, includeContent: "true", "versionDescriptor.versionType": "commit", "versionDescriptor.version": commit }) as GitItem;
    if (!item || item.commitId !== commit || item.path !== path || item.isFolder || !fullSha(item.objectId) || typeof item.content !== "string") {
      throw new UnknownError("远端工件响应的 commit、路径或正文不一致");
    }
    return item.content;
  }
}
