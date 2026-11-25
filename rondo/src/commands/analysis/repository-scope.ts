/** Machine-readable Repository Scope for an OpenSpec Change. No runtime or approval state. */
import { parse as parseYaml } from "yaml";
import { FailError } from "../../cli/errors.js";

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
      throw new FailError("x-repositories 必须是 repo_id 字符串列表，例如 x-repositories: [dataintegration]，不接受对象或仓库 URL");
    }
    if (ids.has(id)) throw new FailError("x-repositories 存在重复 repo_id: " + id);
    ids.add(id);
  }
  return [...ids];
}
