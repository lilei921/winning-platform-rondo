/** Requirement business commits are derived from verified completed PRs, not old candidates. */
import { FailError, UnknownError } from "../../cli/errors.js";
import { runCommand } from "../../clients/spawn.js";
import { TfsClient as FlowTfsClient } from "../../clients/tfs.js";
import { TfsClient as ApiTfsClient } from "../../tfs/client.js";
import { readAnalysisSource } from "../analysis/source.js";
import { approvedRequirementScope } from "../delivery/requirement-mode.js";
import { verifyCloseoutPrs, type VerifiedCloseoutPr } from "../delivery/closeout-pr.js";
import { commitTaskOwners, prChangedCommits, type VerifiedRepo } from "../../tfs/api/commit-facts.js";
import type { PlannedCommit } from "./requirement-tasks.js";

export interface AvailableCommit extends PlannedCommit {
  repo: string; project: string; projectId: string; repoId: string; owners: number[];
  changed_paths: string[]; message: string;
}
export interface RequirementInspection {
  approvedTasks: string; commits: AvailableCommit[];
}

/** Read the immutable approved tasks directly from the checked Git commit, never latest archive content. */
export function approvedTasksAtCommit(root: string, commit: string, changeRef: string): string {
  const shown = runCommand(["git", "show", commit + ":openspec/changes/" + changeRef + "/tasks.md"], root);
  if (shown.status !== 0 || !shown.stdout.trim()) throw new UnknownError("批准版 tasks.md 在根仓指定 Commit 中不存在或不可读");
  return shown.stdout;
}

export async function inspectRequirementCommits(
  md: Record<string, string>, rootRepo: string,
  api = new ApiTfsClient(), flow = new FlowTfsClient(), verified?: VerifiedCloseoutPr[],
): Promise<RequirementInspection> {
  const source = readAnalysisSource(md);
  const approvedTasks = approvedTasksAtCommit(rootRepo, source.commit, source.change_ref);
  const prs = verified ?? await verifyCloseoutPrs(md, api, flow, approvedRequirementScope(md, rootRepo));
  const commits: AvailableCommit[] = [];
  for (const { pr, repo } of prs) {
    const changed = await prChangedCommits(api, repo, pr.pr_id);
    for (const item of changed) {
      commits.push({ repo_key: pr.repo_key, ...item,
        repo: repo.repo, project: repo.project, projectId: repo.projectId, repoId: repo.repoId,
        owners: await commitTaskOwners(api, repo, item.sha) });
    }
  }
  const ids = commits.map(c => c.repo_key + "/" + c.sha);
  if (!commits.length || new Set(ids).size !== ids.length) {
    throw new UnknownError("真实 PR 业务 Commit 为空或存在重复");
  }
  return { approvedTasks, commits };
}

export async function currentCommitOwners(api: ApiTfsClient, commit: AvailableCommit): Promise<number[]> {
  const repo: VerifiedRepo = { project: commit.project, repo: commit.repo,
    projectId: commit.projectId, repoId: commit.repoId };
  return commitTaskOwners(api, repo, commit.sha);
}
