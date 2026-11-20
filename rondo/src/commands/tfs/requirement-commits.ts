/** Requirement business commits are derived from verified completed PRs, not old candidates. */
import { FailError, UnknownError } from "../../cli/errors.js";
import { runCommand } from "../../clients/spawn.js";
import { assertTfsRepository } from "../../clients/authenticated-git.js";
import { TfsClient as FlowTfsClient } from "../../clients/tfs.js";
import { TfsClient as ApiTfsClient } from "../../tfs/client.js";
import { readAnalysisSource } from "../analysis/source.js";
import type { EvidenceRepository } from "../delivery/evidence-repository.js";
import { commitTaskOwners, prChangedCommits, verifiedRepo, type VerifiedRepo } from "../../tfs/api/commit-facts.js";
import type { PlannedCommit } from "./requirement-tasks.js";

export interface AvailableCommit extends PlannedCommit {
  repo: string; project: string; projectId: string; repoId: string; owners: number[];
  changed_paths: string[]; message: string;
}
export interface RequirementInspection {
  approvedTasks: string; commits: AvailableCommit[];
}

function readArray(raw: string | undefined, label: string): any[] {
  let value: unknown;
  try { value = JSON.parse(raw ?? "null"); } catch { throw new UnknownError(label + " 非法 JSON"); }
  if (!Array.isArray(value)) throw new FailError(label + " 缺失或不是数组");
  return value;
}

/** Read the immutable approved tasks directly from the checked Git commit, never latest archive content. */
export function approvedTasksAtCommit(root: string, commit: string, changeRef: string): string {
  const shown = runCommand(["git", "show", commit + ":openspec/changes/" + changeRef + "/tasks.md"], root);
  if (shown.status !== 0 || !shown.stdout.trim()) throw new UnknownError("批准版 tasks.md 在根仓指定 Commit 中不存在或不可读");
  return shown.stdout;
}

export async function inspectRequirementCommits(
  registry: Record<string, EvidenceRepository & { default_target_branch?: string }>, md: Record<string, string>,
  rootRepo: string, api = new ApiTfsClient(), flow = new FlowTfsClient(),
): Promise<RequirementInspection> {
  const source = readAnalysisSource(md);
  const changeRef = md["analysis.change_ref"];
  if (!changeRef || source.change_ref !== changeRef) throw new FailError("批准来源与当前 Change 不一致");
  const approvedTasks = approvedTasksAtCommit(rootRepo, source.commit, changeRef);
  const prs = readArray(md.current_pr, "current_pr");
  const preps = readArray(md.pr_prep, "pr_prep");
  if (!prs.length || prs.length !== preps.length) throw new FailError("current_pr/pr_prep 仓库数量不一致");
  const commits: AvailableCommit[] = [];
  const seenRepo = new Set<string>();
  for (const pr of prs) {
    if (!pr || typeof pr.repo_key !== "string" || !registry[pr.repo_key]?.repo_url ||
        !Number.isSafeInteger(pr.pr_id) || pr.pr_id <= 0 ||
        typeof pr.source_branch !== "string" || typeof pr.target_branch !== "string") {
      throw new FailError("current_pr 缺少合法的仓库、PR 身份或分支");
    }
    if (seenRepo.has(pr.repo_key)) throw new FailError("同一仓库登记了重复 PR");
    seenRepo.add(pr.repo_key);
    const registered = registry[pr.repo_key];
    const matches = preps.filter(p => p?.repo_key === pr.repo_key);
    if (matches.length !== 1 ||
        matches[0].source_branch !== pr.source_branch ||
        (matches[0].target_branch ?? registered.default_target_branch ?? "dev") !== pr.target_branch) {
      throw new FailError("current_pr 与已登记 PR Preparation 的仓库或分支不一致");
    }
    const url = assertTfsRepository(registered.repo_url!, api.config.serverUrl);
    const segments = url.pathname.split("/").map(decodeURIComponent);
    const repoName = segments.at(-1)!;
    const project = segments.at(-3)!;
    if ((registered.tfs_repo && registered.tfs_repo.toLowerCase() !== repoName.toLowerCase()) ||
        (registered.tfs_project && registered.tfs_project.toLowerCase() !== project.toLowerCase())) {
      throw new FailError("PR 登记仓库与 TFS registry 身份不一致");
    }
    const repo = await verifiedRepo(api, project, repoName);
    const live = await flow.run(
      ["pr", "get", "--id", String(pr.pr_id), "--repo", repo.repo, "--project", repo.project],
      `读取已完成 PR ${pr.pr_id}`,
    ) as { id?: number; status?: string; sourceBranch?: string; targetBranch?: string };
    if (live?.id !== pr.pr_id || live.status !== "completed" ||
        live.sourceBranch !== pr.source_branch || live.targetBranch !== pr.target_branch) {
      throw new UnknownError(`PR ${pr.pr_id} 外部状态或身份与 current_pr 不一致`);
    }
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
