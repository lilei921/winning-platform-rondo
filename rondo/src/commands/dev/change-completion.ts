/** Change-level PR admission: approved contract, recorded delivery progress and per-repo evidence. */
import { FailError, UnknownError } from "../../cli/errors.js";
import type { BaseRegistryConfig } from "../../clients/config.js";
import { MulticaClient } from "../../clients/multica.js";
import { RemoteArtifactReader } from "../delivery/remote-artifacts.js";
import { normalizeContractText } from "../delivery/contract-files.js";
import { approvedChange, readDevelopmentCommit } from "./requirement-guard.js";

export interface PrPrep {
  repo_key: string; source_branch: string; target_branch?: string;
  candidate_commit: string; title: string; description?: string;
  local_validation?: { result?: string; summary?: string; command?: string[]; exit_code?: number; candidate_commit?: string; source?: string };
  code_review?: { result?: string; summary?: string; findings?: Array<{ resolved?: boolean; blocking?: boolean; risk_note?: string; risk_ref?: string }> };
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
function contractFiles(items: Array<{ path: string; isFolder?: boolean }>, prefix: string): string[] {
  return items.filter(i => !i.isFolder && i.path.startsWith(prefix + "/"))
    .map(i => i.path.slice(prefix.length + 1))
    .filter(p => [".openspec.yaml", "proposal.md", "tasks.md", "design.md"].includes(p) || (p.startsWith("specs/") && p.endsWith(".md")))
    .sort();
}
export function checkedTaskProgress(text: string): number {
  const refs = new Set<string>();
  const incomplete: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const checkbox = /^[ \t]*[-*+][ \t]+\[([^\]]*)\]/.exec(line);
    if (!checkbox) continue;
    if (!/^[ xX]$/.test(checkbox[1])) throw new FailError("tasks.md 存在无效 checkbox: " + line.trim().slice(0, 100));
    const task = /^[ \t]*[-*+][ \t]+\[([ xX])\][ \t]+(\d+(?:\.\d+)*)(?=[ \t]|$)/.exec(line);
    if (!task) throw new FailError("tasks.md 存在未编号的 checkbox 任务: " + line.trim().slice(0, 100));
    if (refs.has(task[2])) throw new FailError("tasks.md 编号重复: " + task[2]);
    refs.add(task[2]);
    if (task[1] === " ") incomplete.push(task[2]);
  }
  if (refs.size === 0) throw new FailError("当前 Change 缺少可验证的 Implementation Task");
  if (incomplete.length) throw new FailError("仍有未完成的研发任务: " + incomplete.join(", "));
  return refs.size;
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
    if (entry.source_branch !== "feature/" + tfsId ||
        !/^[0-9a-f]{40}$/.test(entry.candidate_commit ?? "") ||
        !entry.title?.trim() || !entry.description?.trim() ||
        entry.description.includes("补 TFS 工作项 id") ||
        (entry.target_branch && entry.target_branch !== repo.default_target_branch)) {
      throw new FailError("PR Preparation 缺少真实 Candidate 或 Engineer 专业描述: " + key);
    }
    const validation = entry.local_validation;
    if (validation?.result !== "PASS" || validation.source !== "rondo dev pr-prep" ||
        validation.exit_code !== 0 || validation.candidate_commit !== entry.candidate_commit ||
        !validation.summary?.trim() || !Array.isArray(validation.command) || validation.command.length === 0) {
      throw new FailError("缺少与 Candidate 一致的 Rondo 实际执行验证结果: " + key);
    }
    const review = entry.code_review;
    if (review?.result !== "PASS" || !review.summary?.trim() || !Array.isArray(review.findings) ||
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

/** Re-read a single pinned TFS Git snapshot, never mix approved content with another Runtime's worktree. */
export async function checkPublishedChange(
  cfg: BaseRegistryConfig, multica: MulticaClient, issueKey: string, changeRef: string,
  readerFactory: (url: string) => RemoteArtifactReader = url => new RemoteArtifactReader(url),
): Promise<Completion> {
  const change = await approvedChange(cfg, multica, issueKey, changeRef, true);
  const source = change.source;
  const reader = readerFactory(source.repo_url);
  const md = change.issue.metadata ?? {};
  const commit = readDevelopmentCommit(md, source);
  const prefix = "/openspec/changes/" + changeRef;
  const [approvedList, currentList] = await Promise.all([reader.list(source.commit, prefix), reader.list(commit, prefix)]);
  const approvedFiles = contractFiles(approvedList, prefix);
  const currentFiles = contractFiles(currentList, prefix);
  if (JSON.stringify(approvedFiles) !== JSON.stringify(currentFiles)) throw new FailError("当前 Change 契约文件清单与获批准版本不一致");
  for (const file of approvedFiles) {
    // Engineers can refine *non-material* design, not Proposal, Specs or task wording.
    if (file === "design.md") continue;
    const [before, after] = await Promise.all([reader.read(source.commit, prefix + "/" + file), reader.read(commit, prefix + "/" + file)]);
    if (normalizeContractText(file, before) !== normalizeContractText(file, after)) {
      throw new FailError("Change 契约实质内容已变化，须重新 Human Review: " + file);
    }
  }
  const tasks = await reader.read(commit, prefix + "/tasks.md");
  const taskCount = checkedTaskProgress(tasks);
  const rawPrep = parseJson(md["pr_prep"] ?? "null", "pr_prep");
  if (!Array.isArray(rawPrep)) throw new FailError("缺少 PR Preparation");
  const candidates = validateChangeDelivery(rawPrep as PrPrep[], change.scope, change.tfsId, cfg.registry as Record<string, RepoConfig>);
  const latest = multica.getIssue(issueKey).metadata ?? {};
  if (["analysis.source", "analysis.human_approval", "dev.publication", "pr_prep"].some(key => latest[key] !== md[key])) {
    throw new UnknownError("完成检查期间批准、研发发布记录或 PR 候选发生变化，请重新检查");
  }
  return { change_ref: changeRef, branch: source.branch, commit, task_count: taskCount, repo_keys: Object.keys(candidates).sort(), candidates };
}
