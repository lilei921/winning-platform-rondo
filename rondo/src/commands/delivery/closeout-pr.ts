/** Closeout consumes pinned PR Preparation and TFS facts; no Repository Registry. */
import { FailError, UnknownError } from "../../cli/errors.js";
import { assertTfsRepository } from "../../clients/authenticated-git.js";
import { TfsClient as FlowTfsClient } from "../../clients/tfs.js";
import { TfsClient as ApiTfsClient } from "../../tfs/client.js";
import { parseTfsPrWebUrl } from "../../tfs/api/pr.js";
import { verifiedRepo, type VerifiedRepo } from "../../tfs/api/commit-facts.js";
import { assertMergedBugSource } from "../bug/finalize-facts.js";
import { readPrRecords, isRegisteredPr, type RegisteredPr } from "../pr/facts.js";

export type CloseoutPr = RegisteredPr;
export interface VerifiedCloseoutPr {
  pr: CloseoutPr;
  repo: VerifiedRepo;
}

/** Verify exact repo/PR/branch identity, then pin the live GUID pair in memory only. */
export async function verifyCloseoutPrs(
  md: Record<string, string>,
  api = new ApiTfsClient(), flow = new FlowTfsClient(),
  approvedScope?: string[], expectedBugSources?: Map<string, string>,
): Promise<VerifiedCloseoutPr[]> {
  const records = readPrRecords(md.pr);
  const prs = records.filter(isRegisteredPr);
  if (!prs.length || prs.length !== records.length) throw new FailError("pr 登记不完整");
  const seen = new Set<string>();
  const verified: VerifiedCloseoutPr[] = [];
  for (const pr of prs) {
    if (approvedScope && !approvedScope.includes(pr.repo_key)) throw new FailError("PR 仓库不在批准 Repository Scope: " + pr.repo_key);
    if (typeof pr.source_branch !== "string" || !pr.source_branch.trim() ||
        typeof pr.target_branch !== "string" || !pr.target_branch.trim() ||
        typeof pr.repo_url !== "string" || !pr.repo_url.trim()) throw new FailError("pr 缺少仓库 URL 或分支");
    const expected = assertTfsRepository(pr.repo_url, api.config.serverUrl);
    const parts = expected.pathname.split("/").map(decodeURIComponent);
    const location = parseTfsPrWebUrl(pr.pr_url, api.config.serverUrl);
    if (!location || location.prId !== pr.pr_id ||
        location.project.toLowerCase() !== parts.at(-3)!.toLowerCase() ||
        location.repository.toLowerCase() !== parts.at(-1)!.toLowerCase()) {
      throw new FailError("pr URL 的 Collection、Project、Repository 或 PR ID 与仓库身份不一致");
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
      throw new UnknownError("PR " + pr.pr_id + " 外部身份或分支与 pr 不一致");
    }
    if (live.status === "active" || live.status === "abandoned") throw new FailError("PR " + pr.pr_id + " 尚未完成: " + live.status);
    if (live.status !== "completed") throw new UnknownError("PR " + pr.pr_id + " 未确认 completed");
    if (expectedBugSources) assertMergedBugSource(pr.repo_key, live.sourceCommitId, expectedBugSources.get(pr.repo_key));
    verified.push({ pr, repo });
  }
  return verified;
}
