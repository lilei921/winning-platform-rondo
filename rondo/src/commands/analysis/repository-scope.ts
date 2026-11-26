/** Machine-readable Repository Scope for an OpenSpec Change. No runtime or approval state. */
import { parse as parseYaml } from "yaml";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/** 校验 Scope 仅引用当前根仓的已登记 repo_id，不查询远端或判断业务影响。 */
export function assertRegisteredRepositoryScope(scope: string[], rootRepo: string): void {
  const mapping = join(rootRepo, "docs", "config", "repo-context.yaml");
  let document: unknown;
  try {
    document = parseYaml(readFileSync(mapping, "utf8"), { uniqueKeys: true });
  } catch (error) {
    throw new UnknownError("无法读取根仓 Repository Scope 权威映射 docs/config/repo-context.yaml: " + String(error));
  }
  const repos = document && typeof document === "object" && !Array.isArray(document)
    ? (document as Record<string, unknown>).repos : undefined;
  if (!Array.isArray(repos) || !repos.every(repo => repo && typeof repo === "object" &&
    !Array.isArray(repo) && typeof repo.repo_id === "string" && /^[a-z][a-z0-9-]*$/.test(repo.repo_id))) {
    throw new UnknownError("根仓 docs/config/repo-context.yaml 缺少有效 repos/repo_id 映射");
  }
  const registered = new Set<string>(repos.map(repo => repo.repo_id));
  const missing = scope.filter(id => !registered.has(id));
  if (missing.length) {
    throw new FailError("x-repositories 包含根仓 docs/config/repo-context.yaml 未登记的 repo_id: " + missing.join(", "));
  }
}
