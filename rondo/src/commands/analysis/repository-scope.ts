/** Machine-readable Repository Scope for an OpenSpec Change. No runtime or approval state. */
import { parse as parseYaml } from "yaml";
import { FailError } from "../../cli/errors.js";
import { projectBusinessRepository, type ProjectResource } from "../../clients/native-checkout.js";
import { assertTfsRepository } from "../../clients/authenticated-git.js";

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
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
      throw new FailError("x-repositories 必须逐项列出合法 repo_id（字符串列表），例如 x-repositories: [winning-dps-df-dataintegration]，不接受对象或仓库 URL");
    }
    if (ids.has(id)) throw new FailError("x-repositories 存在重复 repo_id: " + id);
    ids.add(id);
  }
  return [...ids];
}

/** Verify only the selected Scope against current Project Resources at publication. */
export function assertProjectRepositoryScope(scope: string[], resources: ProjectResource[], rootUrl: string, serverUrl: string): void {
  for (const key of scope) {
    const selected = projectBusinessRepository(resources, key, rootUrl);
    assertTfsRepository(selected.url, serverUrl);
  }
}
