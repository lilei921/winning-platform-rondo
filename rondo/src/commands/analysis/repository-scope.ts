/** Machine-readable Repository Scope for an OpenSpec Change. No runtime or approval state. */
import { parse as parseYaml } from "yaml";
import { FailError } from "../../cli/errors.js";
import { projectRepository, type ProjectResource } from "../../clients/native-checkout.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";
import { repositoryName } from "./source.js";

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
export function assertProjectRepositoryScope(scope: string[], resources: ProjectResource[], rootUrl: string): void {
  const rootIdentity = canonicalRepositoryIdentity(rootUrl);
  for (const key of scope) {
    if (key === repositoryName(rootUrl)) throw new FailError("x-repositories 不能包含工程契约根仓 " + key);
    const selected = projectRepository(resources, key);
    if (canonicalRepositoryIdentity(selected.url) === rootIdentity)
      throw new FailError("x-repositories 不能包含工程契约根仓 " + key);
  }
}
