/** 无 Project 的交付工件：显式权威分支只解析一次，之后所有读取固定完整 Commit。 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, lstatSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { FailError, UnknownError } from "../../cli/errors.js";
import { TfsClient } from "../../tfs/client.js";
import { runAuthenticatedGit as runAuthenticatedRootGit } from "../../clients/authenticated-git.js";
import type { RuntimePaths } from "../../clients/runtime-paths.js";
import { readAnalysisSource, repositoryUrl, type AnalysisSource } from "../analysis/source.js";
import { computeContractFiles, normalizeContractText } from "./contract-files.js";

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
  async pin(branch: string): Promise<string> {
    if (typeof branch !== "string" || !branch || branch.startsWith("-") || branch.startsWith("refs/") ||
        /[\s~^:?*\[\\\x00-\x1f]/.test(branch) || branch.includes("..") || branch.includes("@{") ||
        branch.split("/").some(p => !p || p.startsWith(".") || p.endsWith(".") || p.endsWith(".lock"))) {
      throw new UnknownError("runtime.root_branch 必须是显式固定的合法分支名");
    }
    const response = await this.get("refs", { filter: `heads/${branch}` }) as { value?: unknown };
    if (!response || !Array.isArray(response.value)) throw new UnknownError("TFS 分支列表非法");
    const hits = response.value.filter(v => v?.name === `refs/heads/${branch}`);
    if (hits.length !== 1 || !fullSha(hits[0].objectId)) throw new UnknownError("权威分支不存在或身份不唯一");
    return hits[0].objectId;
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

// 保持旧调用者兼容；认证实现与 Bug 业务仓准备共用。
export { authenticatedGitEnvironment as rootGitEnvironment, runAuthenticatedGit as runAuthenticatedRootGit } from "../../clients/authenticated-git.js";

/** 只清理由本次调用创建的唯一临时目录；发现链接保留现场，不递归越界。 */
export function ownedTemporaryRoot(prefix: string): { root: string; dispose: () => void } {
  const parent = realpathSync(process.cwd()); const root = mkdtempSync(join(parent, prefix));
  return { root, dispose: () => {
    if (dirname(resolve(root)) !== parent || realpathSync(root) !== root) throw new UnknownError("临时目录身份变化，拒绝清理");
    const inspect = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name); const info = lstatSync(p);
        if (info.isSymbolicLink()) throw new UnknownError("临时目录存在链接，保留现场");
        if (info.isDirectory()) inspect(p);
      }
    };
    inspect(root); rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } };
}

export interface DeliveryArtifacts {
  source: AnalysisSource; branch: string; commit: string; archived: boolean;
  changeDir: string; paths: RuntimePaths; dispose: () => void;
}

/** 只下载选定 Change；批准正文与最新进度分别读取，归档不能更改原批准契约。 */
export async function materializeDeliveryArtifacts(reader: RemoteArtifactReader, md: Record<string, string>, branch: string): Promise<DeliveryArtifacts> {
  const source = readAnalysisSource(md);
  if (source.repo_url !== reader.repoUrl) throw new UnknownError("批准来源与远端根仓身份不一致");
  const commit = await reader.pin(branch);
  const items = await reader.list(commit, "/openspec/changes");
  const live = `/openspec/changes/${source.change_ref}`;
  const roots = new Set<string>();
  for (const item of items) {
    if (item.path === live || item.path.startsWith(`${live}/`)) roots.add(live);
    const match = item.path.match(/^\/openspec\/changes\/archive\/([^/]+)(?:\/|$)/);
    if (match && (match[1] === source.change_ref || match[1].endsWith(`-${source.change_ref}`))) roots.add(`/openspec/changes/archive/${match[1]}`);
  }
  if (roots.size !== 1) throw new UnknownError("当前/归档 Change 身份不唯一或缺失，拒绝选择冲突工件");
  const prefix = [...roots][0]; const owned = ownedTemporaryRoot(".rondo-artifacts-");
  try {
    const selected = items.filter(x => !x.isFolder && x.path.startsWith(`${prefix}/`));
    if (!selected.length || selected.length > 500) throw new UnknownError("当前 Change 文件数量非法或超过上限");
    let bytes = 0;
    for (const item of selected) {
      const content = await reader.read(commit, item.path); bytes += Buffer.byteLength(content);
      if (bytes > 32 * 1024 * 1024) throw new UnknownError("当前 Change 工件超过读取总量上限");
      const file = join(owned.root, ...item.path.slice(1).split("/"));
      mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content);
    }
    const changeDir = join(owned.root, ...prefix.slice(1).split("/"));
    const current = computeContractFiles(changeDir).files;
    const approvedItems = await reader.list(source.commit, live);
    const approvedPaths = approvedItems.filter(x => !x.isFolder).map(x => x.path.slice(live.length + 1))
      .filter(p => ["proposal.md", "tasks.md", "design.md"].includes(p) || (p.startsWith("specs/") && p.endsWith(".md"))).sort();
    if (JSON.stringify(Object.keys(current).sort()) !== JSON.stringify(approvedPaths)) throw new FailError("最新/归档契约文件集合偏离批准基线");
    for (const file of approvedPaths) {
      const approvedText = await reader.read(source.commit, `${live}/${file}`);
      const hash = createHash("sha256").update(normalizeContractText(file, approvedText)).digest("hex");
      if (hash !== current[file] && file !== "design.md") throw new FailError(`最新/归档契约 ${file} 偏离批准基线`);
    }
    const approvedSchema = await reader.read(source.commit, `${live}/.openspec.yaml`);
    if (normalizeContractText(".openspec.yaml", approvedSchema) !== normalizeContractText(".openspec.yaml", await reader.read(commit, `${prefix}/.openspec.yaml`))) {
      throw new FailError("最新/归档 Schema 偏离批准基线");
    }
    return { source, branch, commit, archived: prefix !== live, changeDir,
      paths: { rootRepo: owned.root, openspecRoot: join(owned.root, "openspec"), projectId: "", daemonId: null, source: "remote_artifacts" }, dispose: owned.dispose };
  } catch (error) { owned.dispose(); throw error; }
}

/** Prepare 专用根仓，必须与已经核验的远端快照同 Commit；失败保留自有目录供诊断。 */
export function checkoutArchiveRoot(snapshot: DeliveryArtifacts): { paths: RuntimePaths; dispose: () => void } {
  const owned = ownedTemporaryRoot(".rondo-finalize-");
  const run = (args: string[], timeoutMs?: number) => {
    const result = runAuthenticatedRootGit(snapshot.source.repo_url, args, owned.root, timeoutMs);
    if (result.status !== 0) throw new UnknownError(`临时归档 Git 操作失败，现场保留于 ${owned.root}: ${result.stderr.slice(0, 400)}`);
    return result.stdout.trim();
  };
  // 归档只需权威分支当前快照及本次新增提交；批准正文已由固定 SHA API 独立核对。
  // 大根仓首次传输可超过通用命令的五分钟；仅 clone 放宽为有界二十分钟。
  run(["-c", "core.symlinks=false", "clone", "--depth", "1", "--no-tags", "--single-branch", "--branch", snapshot.branch, "--", snapshot.source.repo_url, "."], 1_200_000);
  if (run(["rev-parse", "HEAD"]) !== snapshot.commit) throw new UnknownError(`归档分支在读取后前进，停止并重新核验；现场 ${owned.root}`);
  const paths = { ...snapshot.paths, rootRepo: owned.root, openspecRoot: join(owned.root, "openspec"), gitRemoteUrl: snapshot.source.repo_url };
  // 相对路径来自刚下载的经过路径检查的快照，不接受调用方给出的旧绝对路径。
  const relativeChange = relative(snapshot.paths.rootRepo, snapshot.changeDir);
  if (JSON.stringify(computeContractFiles(join(owned.root, relativeChange)).files) !== JSON.stringify(computeContractFiles(snapshot.changeDir).files)) {
    throw new UnknownError("临时 checkout 正文与已核验工件不一致");
  }
  return { paths, dispose: owned.dispose };
}
