import { repositoryUrl } from "../analysis/source.js";

/** TFS 路径大小写不敏感；规范化编码后比较整个仓库身份，不能仅比较仓名。 */
export function canonicalRepositoryIdentity(raw: string): string {
  const url = repositoryUrl(raw);
  return `${url.origin}${url.pathname.split("/").map(p => decodeURIComponent(p)).join("/")}`.toLowerCase();
}
