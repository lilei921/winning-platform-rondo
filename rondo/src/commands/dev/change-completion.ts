import { candidateBranch } from "../pr/candidate-branch.js";
/** Change-level PR admission: approved contract, recorded delivery progress and per-repo evidence. */
import { FailError, UnknownError } from "../../cli/errors.js";
import type { BaseRegistryConfig } from "../../clients/config.js";
import { MulticaClient } from "../../clients/multica.js";
import { RemoteArtifactReader } from "../delivery/remote-artifacts.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";
import { sameAnalysisSource, type AnalysisSource } from "../analysis/source.js";
import { approvedChange, readDevelopmentCommit } from "./requirement-guard.js";
import { readApprovedVerifyDecision } from "../delivery/verify-decision.js";

export interface PrPrep {
  repo_key: string; repo_url?: string; source_branch: string; target_branch?: string;
  candidate_commit: string; title: string; description?: string;
  local_validation?: { result?: string; summary?: string; command?: string[]; exit_code?: number; candidate_commit?: string; source?: string };
  code_review?: { result?: string; candidate_commit?: string; summary?: string; findings?: Array<{ resolved?: boolean; blocking?: boolean; risk_note?: string; risk_ref?: string }> };
  blockers?: string[];
}
interface RepoConfig { repo_path?: string; repo_url?: string; default_target_branch?: string }
export interface Completion {
  change_ref: string; branch: string; commit: string;
  task_count: number; repo_keys: string[]; candidates: Record<string, string>;
}

function parseJson(text: string, label: string): unknown {
  try { return JSON.parse(text); } catch { throw new FailError(label + " 不是合法 JSON"); }
}
export function readTaskProgress(text: string): Map<string, boolean> {
  const refs = new Map<string, boolean>();
  for (const line of text.split(/\r?\n/)) {
    const checkbox = /^[ \t]*[-*+][ \t]+\[([^\]]*)\]/.exec(line);
    if (!checkbox) continue;
    if (!/^[ xX]$/.test(checkbox[1])) throw new FailError("tasks.md 存在无效 checkbox: " + line.trim().slice(0, 100));
    const task = /^[ \t]*[-*+][ \t]+\[([ xX])\][ \t]+(\d+(?:\.\d+)*)(?=[ \t]|$)/.exec(line);
    if (!task) throw new FailError("tasks.md 存在未编号的 checkbox 任务: " + line.trim().slice(0, 100));
    if (refs.has(task[2])) throw new FailError("tasks.md 编号重复: " + task[2]);
    refs.set(task[2], task[1] !== " ");
  }
  if (refs.size === 0) throw new FailError("当前 Change 缺少可验证的 Implementation Task");
  return refs;
}

export function assertWaiverRefs(progress: ReadonlyMap<string, boolean>, waivedTasks: readonly string[]): void {
  const invalid = waivedTasks.filter(ref => !progress.has(ref));
  if (invalid.length) throw new FailError("豁免任务不在 tasks.md: " + invalid.join(", "));
}

export function checkedTaskProgress(text: string, waivedTasks: readonly string[] = []): number {
  const progress = readTaskProgress(text);
  assertWaiverRefs(progress, waivedTasks);
  const waived = new Set(waivedTasks);
  const incomplete = [...progress].filter(([ref, done]) => !done && !waived.has(ref)).map(([ref]) => ref);
  if (incomplete.length) throw new FailError("仍有未完成的研发任务: " + incomplete.join(", "));
  return progress.size;
}

/** Gate: each repo has a pinned candidate and Rondo-executed validation, not self-declared PASS. */
export function validateChangeDelivery(prep: PrPrep[], scope: string[], tfsId: number, registry: Record<string, RepoConfig>): Record<string, string> {
  if (!Array.isArray(prep) || prep.length === 0) throw new FailError("没有实际代码 Candidate；不自动无 PR Finalize");
  const candidates: Record<string, string> = {};
  for (const entry of prep) {
    const key = entry?.repo_key;
    const repo = registry[key];
    if (!scope.includes(key) || !repo?.repo_url) throw new FailError("PR Candidate 的 repo_key 不在批准 Repository Scope: " + key);
    if (key in candidates) throw new FailError("PR Preparation 仓库重复: " + key);
    if (entry.source_branch !== candidateBranch(tfsId) ||
        !/^[0-9a-f]{40}$/.test(entry.candidate_commit ?? "") ||
        typeof entry.title !== "string" || !entry.title.trim() ||
        typeof entry.description !== "string" || !entry.description.trim() ||
        typeof entry.target_branch !== "string" || !entry.target_branch.trim() || entry.target_branch === entry.source_branch ||
        entry.description.includes("补 TFS 工作项 id") ||
        !entry.repo_url || canonicalRepositoryIdentity(entry.repo_url) !== canonicalRepositoryIdentity(repo.repo_url) ||
        entry.target_branch !== repo.default_target_branch) {
      throw new FailError("PR Preparation 缺少真实 Candidate 或 Engineer 专业描述: " + key);
    }
    const validation = entry.local_validation;
    if (validation?.result !== "PASS" || validation.source !== "rondo pr prepare" ||
        validation.exit_code !== 0 || validation.candidate_commit !== entry.candidate_commit ||
        !validation.summary?.trim() || !Array.isArray(validation.command) || validation.command.length === 0 || validation.command.some(x=>typeof x!=="string"||!x.trim())) {
      throw new FailError("缺少与 Candidate 一致的 Rondo 实际执行验证结果: " + key);
    }
    const review = entry.code_review;
    if (review?.result !== "PASS" || review.candidate_commit !== entry.candidate_commit || !review.summary?.trim() || !Array.isArray(review.findings) ||
        !Array.isArray(entry.blockers) || entry.blockers.length) {
      throw new FailError("Code Review 或 Blocking Findings 未通过: " + key);
    }
    if (review.findings.some(f => !f || (f.resolved !== true &&
        (f.blocking !== false || !(f.risk_note?.trim() || f.risk_ref?.trim()))))) {
      throw new FailError("Code Review 存在未解决 Blocking Finding: " + key);
    }
    candidates[key] = entry.candidate_commit;
  }
  return candidates;
}

/** Consume the approved publication receipt and check completion at its pinned Development SHA. */
export async function checkPublishedChange(
  cfg: BaseRegistryConfig, multica: MulticaClient, issueKey: string, expectedSource: AnalysisSource, expectedPrep: string,
  readerFactory: (url: string) => RemoteArtifactReader = url => new RemoteArtifactReader(url),
): Promise<Completion> {
  const change = await approvedChange(cfg, multica, issueKey, true);
  const source = change.source;
  if (!sameAnalysisSource(source, expectedSource)) throw new UnknownError("批准来源在读取映射期间变化");
  const changeRef = source.change_ref;
  const reader = readerFactory(source.repo_url);
  const md = change.issue.metadata ?? {};
  if (md.pr_prep !== expectedPrep) throw new UnknownError("PR Preparation 在检查期间变化");
  const commit = readDevelopmentCommit(md, source);
  const prefix = "/openspec/changes/" + changeRef;
  const tasks = await reader.read(commit, prefix + "/tasks.md");
  const taskCount = checkedTaskProgress(tasks, readApprovedVerifyDecision(md).waivedTasks);
  const rawPrep = parseJson(md["pr_prep"] ?? "null", "pr_prep");
  if (!Array.isArray(rawPrep)) throw new FailError("缺少 PR Preparation");
  const candidates = validateChangeDelivery(rawPrep as PrPrep[], change.scope, change.tfsId, cfg.registry as Record<string, RepoConfig>);
  const latest = multica.getIssue(issueKey).metadata ?? {};
  if (["analysis.source", "analysis.human_approval", "dev.publication", "pr_prep"].some(key => latest[key] !== md[key])) {
    throw new UnknownError("完成检查期间批准、研发发布记录或 PR 候选发生变化，请重新检查");
  }
  return { change_ref: changeRef, branch: source.branch, commit, task_count: taskCount, repo_keys: Object.keys(candidates).sort(), candidates };
}
