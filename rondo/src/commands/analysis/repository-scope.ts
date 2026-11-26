/** Machine-readable Repository Scope for an OpenSpec Change. No runtime or approval state. */
import { parse as parseYaml } from "yaml";
import { FailError, UnknownError } from "../../cli/errors.js";

export function parseRepositoryScope(rawMetadata: string): string[] {
  let metadata: unknown;
  try {
    metadata = parseYaml(rawMetadata, { uniqueKeys: true });
  } catch (error) {
    throw new FailError(".openspec.yaml YAML 解析失败: " + String(error));
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new FailError(".openspec.yaml 根节点必须是 YAML Map");
  }
  const repos = (metadata as Record<string, unknown>)["x-repositories"];
  if (!Array.isArray(repos) || repos.length === 0) {
    throw new FailError(".openspec.yaml 必须包含非空 x-repositories（Repository Scope）");
  }
  const ids = new Set<string>();
  for (const id of repos) {
    if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new FailError("x-repositories 必须逐项列出合法 repo_id（字符串列表），例如 x-repositories: [dataintegration]，不接受对象或仓库 URL");
    }
    if (ids.has(id)) throw new FailError("x-repositories 存在重复 repo_id: " + id);
    ids.add(id);
  }
  return [...ids];
}

export const REPOSITORY_CONTEXT_PATH = "docs/config/repo-context.yaml";

/** 仅核对当前 Scope 的成员关系；不审计无关仓库或判断业务影响。 */
export function assertRegisteredRepositoryScope(scope: string[], readMapping: () => string): void {
  if (scope.includes("root")) throw new FailError("x-repositories 仅包含业务仓，不能包含工程契约根仓 root");
  let document: unknown;
  try {
    document = parseYaml(readMapping(), { uniqueKeys: true });
  } catch (error) {
    throw new UnknownError("无法读取根仓 Repository Scope 权威映射 docs/config/repo-context.yaml: " + String(error));
  }
  const repos = document && typeof document === "object" && !Array.isArray(document)
    ? (document as Record<string, unknown>).repos : undefined;
  if (!Array.isArray(repos)) {
    throw new UnknownError("根仓 docs/config/repo-context.yaml 缺少 repos 列表");
  }
  const registered = new Set<string>();
  for (const repo of repos) {
    if (repo && typeof repo === "object" && typeof repo.repo_id === "string") registered.add(repo.repo_id);
  }
  if (repos.length && !registered.size) {
    throw new UnknownError("根仓 docs/config/repo-context.yaml 无可识别的 repo_id");
  }
  const missing = scope.filter(id => !registered.has(id));
  if (missing.length) {
    throw new FailError("x-repositories 包含根仓 docs/config/repo-context.yaml 未登记的 repo_id: " + missing.join(", "));
  }
}
