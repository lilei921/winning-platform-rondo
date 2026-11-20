/** Read-only Requirement Commit candidates bound to completed PRs and delivered Evidence. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FailError, UnknownError } from "../../cli/errors.js";
import { TfsClient as FlowTfsClient } from "../../clients/tfs.js";
import { TfsClient as ApiTfsClient } from "../../tfs/client.js";
import { readAnalysisSource } from "../analysis/source.js";
import { RemoteArtifactReader } from "../delivery/remote-artifacts.js";
import { resolveStableEvidenceCommit, type EvidenceRepository } from "../delivery/evidence-repository.js";
import { commitTaskOwners, prChangedCommits, verifiedRepo, type VerifiedRepo } from "../../tfs/api/commit-facts.js";
import type { PlannedCommit } from "./requirement-tasks.js";

export interface AvailableCommit extends PlannedCommit {
  repo: string; project: string; projectId: string; repoId: string; owners: number[];
  changed_paths: string[]; message: string;
}
export interface RequirementEvidenceSummary {
  repo_key: string; file: string; candidate_commit: string;
  local_validation: string; code_review: string;
}
export interface RequirementInspection {
  approvedTasks: string; commits: AvailableCommit[]; evidence: RequirementEvidenceSummary[];
}

function readArray(raw: string | undefined, label: string): any[] {
  let value: unknown;
  try { value = JSON.parse(raw ?? "null"); } catch { throw new UnknownError(label + " 非法 JSON"); }
  if (!Array.isArray(value)) throw new FailError(label + " 缺失或不是数组");
  return value;
}

/** The approved task source is immutable; archived, checked boxes are NOT a substitute. */
export async function inspectRequirementCommits(
  registry: Record<string, EvidenceRepository & { default_target_branch?: string }>, md: Record<string, string>,
  changeDir: string, api = new ApiTfsClient(), flow = new FlowTfsClient(),
): Promise<RequirementInspection> {
  const source = readAnalysisSource(md);
  const changeRef = md["analysis.change_ref"];
  if (!changeRef || source.change_ref !== changeRef) throw new FailError("批准来源与当前 Change 不一致");
  const approvedTasks = await new RemoteArtifactReader(source.repo_url, api)
    .read(source.commit, `/openspec/changes/${changeRef}/tasks.md`);
  if (!approvedTasks.trim()) throw new FailError("批准版本的 tasks.md 为空");
  const preps = readArray(md.pr_prep, "pr_prep");
  const prs = readArray(md.current_pr, "current_pr");
  if (!preps.length || preps.length !== prs.length) throw new FailError("pr_prep/current_pr 缺失或数量不一致");
  const commits: AvailableCommit[] = [];
  const evidence: RequirementEvidenceSummary[] = [];
  const seenRepo = new Set<string>();
  for (const prep of preps) {
    if (!prep || typeof prep.repo_key !== "string" || !registry[prep.repo_key]?.repo_url ||
        typeof prep.candidate_commit !== "string" || !/^[a-f0-9]{40}$/i.test(prep.candidate_commit)) {
      throw new FailError("PR Preparation 缺少登记仓库或完整 Candidate SHA");
    }
    if (seenRepo.has(prep.repo_key)) throw new FailError("重复的 PR Preparation Repository");
    seenRepo.add(prep.repo_key);
    const pr = prs.find(x => x?.repo_key === prep.repo_key);
    if (!pr || !Number.isSafeInteger(pr.pr_id) || pr.pr_id <= 0 ||
        pr.source_branch !== prep.source_branch ||
        pr.target_branch !== (prep.target_branch ?? registry[prep.repo_key].default_target_branch ?? "dev")) {
      throw new FailError("已登记 PR 与 Preparation 的仓库或分支不一致");
    }
    // Identity derives from registry's canonical TFS URL, never a local path or loose repo name.
    const stable = resolveStableEvidenceCommit(registry, {
      repo_key: prep.repo_key, repo_url: registry[prep.repo_key].repo_url,
      sha: prep.candidate_commit,
    }, api.config.serverUrl);
    const repo = await verifiedRepo(api, stable.project, stable.repo);
    const cmd = ["pr", "get", "--id", String(pr.pr_id), "--repo", repo.repo, "--project", repo.project];
    const live = await flow.run(cmd, `读取已完成 PR ${pr.pr_id}`) as {
      id?: number; status?: string; sourceCommitId?: string; sourceBranch?: string; targetBranch?: string;
    };
    if (live?.id !== pr.pr_id || live.status !== "completed" ||
        live.sourceCommitId?.toLowerCase() !== prep.candidate_commit.toLowerCase() ||
        live.sourceBranch !== prep.source_branch ||
        live.targetBranch !== (prep.target_branch ?? registry[prep.repo_key].default_target_branch ?? "dev")) {
      throw new UnknownError(`PR ${pr.pr_id} 尚未核实 completed / Candidate 来源`);
    }
    const evidenceFiles = readdirSync(changeDir).filter(f => /^evidence.*\.json$/i.test(f));
    const matches: Array<{file:string; ev:any}> = [];
    for (const file of evidenceFiles) {
      let ev: any;
      try { ev = JSON.parse(readFileSync(join(changeDir, file), "utf8")); }
      catch { continue; }
      if (ev?.repo_key !== prep.repo_key || ev?.change_ref !== changeRef ||
          ev?.candidate_commit?.toLowerCase() !== prep.candidate_commit.toLowerCase() ||
          !Array.isArray(ev.commits) || ev.local_validation?.result !== "PASS" ||
          ev.code_review?.result !== "PASS" ||
          typeof ev.local_validation.summary !== "string" || !ev.local_validation.summary.trim() ||
          typeof ev.code_review.summary !== "string" || !ev.code_review.summary.trim() ||
          (ev.blockers !== undefined && (!Array.isArray(ev.blockers) || ev.blockers.length > 0))) continue;
      if (ev.commits.some((c: any) => {
        try {
          const id = resolveStableEvidenceCommit(registry, c, api.config.serverUrl);
          return id.key === prep.repo_key && id.sha === stable.sha;
        } catch { return false; }
      })) matches.push({file,ev});
    }
    if (matches.length !== 1) {
      throw new FailError(`PR ${pr.pr_id} Candidate 缺少唯一且已验证的归档 Evidence`);
    }
    evidence.push({ repo_key: prep.repo_key, file: matches[0].file,
      candidate_commit: stable.sha,
      local_validation: matches[0].ev.local_validation.summary,
      code_review: matches[0].ev.code_review.summary });
    const changes = await prChangedCommits(api, repo, pr.pr_id, stable.sha);
    for (const entry of changes) commits.push({
      repo_key: prep.repo_key, ...entry, repo: repo.repo, project: repo.project,
      projectId: repo.projectId, repoId: repo.repoId,
      owners: await commitTaskOwners(api, repo, entry.sha),
    });
  }
  const identities = commits.map(c => c.repo_key + "/" + c.sha);
  if (!commits.length || new Set(identities).size !== identities.length) {
    throw new UnknownError("可用业务 Commit 为空或存在重复");
  }
  return { approvedTasks, commits, evidence };
}

export async function currentCommitOwners(
  api: ApiTfsClient, commit: AvailableCommit,
): Promise<number[]> {
  const repo: VerifiedRepo = { project: commit.project, repo: commit.repo,
    projectId: commit.projectId, repoId: commit.repoId };
  return commitTaskOwners(api, repo, commit.sha);
}
