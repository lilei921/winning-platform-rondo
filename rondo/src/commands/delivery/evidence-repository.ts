import { UnknownError } from "../../cli/errors.js";
import { repositoryUrl } from "../analysis/source.js";

export interface EvidenceRepository { repo_path: string; repo_url?: string; tfs_repo?: string; tfs_project?: string }
export interface EvidenceCommit { repo_key?: string; repo_url?: string; repo_path?: string; sha?: string }

/** TFS 路径大小写不敏感；规范化编码后比较整个仓库身份，不能仅比较仓名。 */
export function canonicalRepositoryIdentity(raw: string): string {
  const url = repositoryUrl(raw);
  return `${url.origin}${url.pathname.split("/").map(p => decodeURIComponent(p)).join("/")}`.toLowerCase();
}

/** 跨 Runtime 只认登记仓库和完整 SHA；旧绝对路径可保留诊断，但不参与身份判断。 */
export function resolveStableEvidenceCommit(registry: Record<string, EvidenceRepository>, commit: EvidenceCommit, serverUrl?: string): {
  key: string; repo: string; project: string; sha: string;
} {
  const key = commit.repo_key;
  const repo = key ? registry[key] : undefined;
  if (!key || !repo?.repo_url || !commit.repo_url || !/^[0-9a-f]{40}$/i.test(commit.sha ?? "")) {
    throw new UnknownError("远端 Evidence commit 必须包含已登记 repo_key、repo_url 和完整 SHA");
  }
  if (canonicalRepositoryIdentity(repo.repo_url) !== canonicalRepositoryIdentity(commit.repo_url)) {
    throw new UnknownError(`Evidence ${key} 仓库身份与 registry 不一致`);
  }
  const url = repositoryUrl(repo.repo_url);
  const parts = url.pathname.split("/").map(p => decodeURIComponent(p));
  // PR/ArtifactLink API 使用当前 TFS Collection；不能把同名的另一服务仓库映射到这里。
  if (serverUrl) {
    const configured = new URL(serverUrl);
    const configuredPath = configured.pathname.replace(/\/+$/, "").split("/").map(p => decodeURIComponent(p)).join("/");
    if (url.origin !== configured.origin || parts.slice(0, -3).join("/").toLowerCase() !== configuredPath.toLowerCase()) {
      throw new UnknownError(`Evidence ${key} 仓库不属于当前 TFS Collection，拒绝错仓关联`);
    }
  }
  const name = parts.at(-1)!; const project = parts.at(-3)!;
  if ((repo.tfs_repo && repo.tfs_repo.toLowerCase() !== name.toLowerCase()) ||
      (repo.tfs_project && repo.tfs_project.toLowerCase() !== project.toLowerCase())) {
    throw new UnknownError(`registry ${key} 的 repo_url 与 TFS 仓库/项目身份矛盾`);
  }
  return { key, repo: name, project, sha: commit.sha!.toLowerCase() };
}
