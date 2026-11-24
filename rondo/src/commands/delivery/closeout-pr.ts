/** Closeout consumes pinned PR Preparation and TFS facts; no Repository Registry. */
import { FailError, UnknownError } from "../../cli/errors.js";
import { assertTfsRepository } from "../../clients/authenticated-git.js";
import { TfsClient as FlowTfsClient } from "../../clients/tfs.js";
import { TfsClient as ApiTfsClient } from "../../tfs/client.js";
import { parseTfsPrWebUrl } from "../../tfs/api/pr.js";
import { verifiedRepo, type VerifiedRepo } from "../../tfs/api/commit-facts.js";
import { assertMergedBugSource } from "../bug/finalize-facts.js";

export interface CloseoutPr {
  repo_key: string;
  pr_id: number;
  pr_url: string;
  source_branch: string;
  target_branch: string;
}
interface PreparedPr {
  repo_key: string;
  repo_url: string;
  source_branch: string;
  target_branch: string;
}
export interface VerifiedCloseoutPr {
  pr: CloseoutPr;
  repo: VerifiedRepo;
}

function readList<T>(raw: string | undefined, label: string): T[] {
  let value: unknown;
  try { value = JSON.parse(raw ?? "null"); }
  catch { throw new UnknownError(label + " 非法 JSON"); }
  if (!Array.isArray(value) || !value.length ||
      value.some(item => !item || typeof item !== "object" || Array.isArray(item) ||
        typeof item.repo_key !== "string" || !item.repo_key.trim())) {
    throw new FailError(label + " 缺少有效仓库身份");
  }
  if (new Set(value.map(item => item.repo_key)).size !== value.length) throw new FailError(label + " repo_key 重复");
  return value as T[];
}

/** Verify exact repo/PR/branch identity, then pin the live GUID pair in memory only. */
export async function verifyCloseoutPrs(
  md: Record<string, string>,
  api = new ApiTfsClient(), flow = new FlowTfsClient(),
  approvedScope?: string[], expectedBugSources?: Map<string, string>,
): Promise<VerifiedCloseoutPr[]> {
  const prs = readList<CloseoutPr>(md.current_pr, "current_pr");
  const preps = readList<PreparedPr>(md.pr_prep, "pr_prep");
  if (prs.length !== preps.length) throw new FailError("current_pr/pr_prep 仓库集合不一致");
  const seen = new Set<string>();
  const verified: VerifiedCloseoutPr[] = [];
  for (const pr of prs) {
    const prep = preps.find(p => p.repo_key === pr.repo_key);
    if (!prep || (approvedScope && !approvedScope.includes(pr.repo_key))) {
      throw new FailError("PR 仓库不在 PR Preparation 或批准 Repository Scope: " + pr.repo_key);
    }
    if (!Number.isSafeInteger(pr.pr_id) || pr.pr_id <= 0 ||
        typeof pr.source_branch !== "string" || !pr.source_branch.trim() ||
        typeof pr.target_branch !== "string" || !pr.target_branch.trim() ||
        prep.source_branch !== pr.source_branch || prep.target_branch !== pr.target_branch) {
      throw new FailError("current_pr 与 PR Preparation 的 PR 身份或分支不一致");
    }
    if (typeof prep.repo_url !== "string" || !prep.repo_url.trim() ||
        typeof pr.pr_url !== "string" || !pr.pr_url.trim()) {
      throw new FailError("PR Preparation 或 current_pr 缺少仓库 URL");
    }
    const expected = assertTfsRepository(prep.repo_url, api.config.serverUrl);
    const parts = expected.pathname.split("/").map(decodeURIComponent);
    const location = parseTfsPrWebUrl(pr.pr_url, api.config.serverUrl);
    if (!location || location.prId !== pr.pr_id ||
        location.project.toLowerCase() !== parts.at(-3)!.toLowerCase() ||
        location.repository.toLowerCase() !== parts.at(-1)!.toLowerCase()) {
      throw new FailError("current_pr URL 的 Collection、Project、Repository 或 PR ID 与 PR Preparation 不一致");
    }
    const repo = await verifiedRepo(api, location.project, location.repository);
    const identity = repo.projectId + "/" + repo.repoId;
    if (seen.has(identity)) throw new FailError("不同 repo_key 指向同一真实 TFS Repository");
    seen.add(identity);
    const live = await flow.run(
      ["pr", "get", "--id", String(pr.pr_id), "--repo", repo.repoId, "--project", repo.project],
      "核对已登记 PR " + pr.pr_id,
    ) as { found?: boolean; id?: number; status?: string; sourceBranch?: string; targetBranch?: string; sourceCommitId?: string | null };
    if (live?.found === false || live?.id !== pr.pr_id ||
        live.sourceBranch !== pr.source_branch || live.targetBranch !== pr.target_branch) {
      throw new UnknownError("PR " + pr.pr_id + " 外部身份或分支与 current_pr 不一致");
    }
    if (live.status === "active") throw new FailError("PR " + pr.pr_id + " 尚未完成");
    if (live.status !== "completed") throw new UnknownError("PR " + pr.pr_id + " 未确认 completed");
    if (expectedBugSources) assertMergedBugSource(pr.repo_key, live.sourceCommitId, expectedBugSources.get(pr.repo_key));
    verified.push({ pr, repo });
  }
  return verified;
}
