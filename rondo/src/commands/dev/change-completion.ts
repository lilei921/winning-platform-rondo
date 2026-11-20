/** Change-level PR admission: approved contract, recorded delivery progress and per-repo evidence. */
import { FailError, UnknownError } from "../../cli/errors.js";
import type { BaseRegistryConfig } from "../../clients/config.js";
import { MulticaClient } from "../../clients/multica.js";
import { RemoteArtifactReader } from "../delivery/remote-artifacts.js";
import { normalizeContractText } from "../delivery/contract-files.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";
import { approvedChange, readDevelopmentCommit } from "./requirement-guard.js";

interface PrPrep {
  repo_key: string; source_branch: string; target_branch?: string;
  candidate_commit: string; title: string; description_ref: string;
}
interface Validation { result?: string; summary?: string }
interface Evidence {
  change_ref?: string; repo_key?: string; candidate_commit?: string;
  commits?: Array<{ repo_key?: string; repo_url?: string; sha?: string }>;
  local_validation?: Validation;
  code_review?: Validation & { findings?: Array<{ resolved?: boolean; blocking?: boolean; risk_note?: string; risk_ref?: string }> };
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

/** Do not accept a candidate solely because its hash is locally present. */
export function validateChangeDelivery(prep: PrPrep[], evidence: Record<string, Evidence>, scope: string[], tfsId: number, registry: Record<string, RepoConfig>): Record<string, string> {
  if (!Array.isArray(prep) || prep.length === 0) throw new FailError("没有实际代码 Candidate；本期不自动无 PR Finalize");
  const candidates: Record<string, string> = {};
  for (const entry of prep) {
    const key = entry?.repo_key;
    const expectedBranch = "feature/" + tfsId;
    const repo = registry[key];
    if (!scope.includes(key) || !repo?.repo_url) throw new FailError("PR Candidate 的 repo_key 不在批准 Repository Scope: " + key);
    if (key in candidates) throw new FailError("PR Preparation 仓库重复: " + key);
    if (entry.source_branch !== expectedBranch || !/^[0-9a-f]{40}$/.test(entry.candidate_commit) ||
        !entry.title?.trim() || entry.description_ref !== "change:pr-description-" + key + ".md" ||
        (entry.target_branch && entry.target_branch !== repo.default_target_branch)) {
      throw new FailError("PR Preparation 不符合 Requirement 分支 / Candidate / 远端描述契约: " + key);
    }
    const ev = evidence[key];
    if (!ev || ev.change_ref === undefined || ev.repo_key !== key || ev.candidate_commit !== entry.candidate_commit ||
        ev.local_validation?.result !== "PASS" || !ev.local_validation.summary?.trim() ||
        ev.code_review?.result !== "PASS" || !ev.code_review.summary?.trim() || (ev.blockers ?? []).length) {
      throw new FailError("缺少与 Candidate 一致且验证 PASS 的 Evidence: " + key);
    }
    if ((ev.code_review.findings ?? []).some(f => f.resolved !== true && (f.blocking !== false || !(f.risk_note?.trim() || f.risk_ref?.trim())))) {
      throw new FailError("Evidence 存在未解决的 Blocking Finding: " + key);
    }
    if (!Array.isArray(ev.commits) || !ev.commits.some(c => c.sha === entry.candidate_commit)) {
      throw new FailError("Evidence 未包含当前 Candidate Commit: " + key);
    }
    for (const c of ev.commits) {
      if (c.repo_key !== key || !c.repo_url || !/^[0-9a-f]{40}$/.test(c.sha ?? "") ||
          canonicalRepositoryIdentity(c.repo_url) !== canonicalRepositoryIdentity(repo.repo_url)) {
        throw new FailError("Evidence Commit 缺少稳定仓库身份或越界: " + key);
      }
    }
    candidates[key] = entry.candidate_commit;
  }
  for (const key of Object.keys(evidence)) {
    if (!(key in candidates)) throw new FailError("Evidence 中存在未准备 PR 的实际代码仓: " + key);
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
  const evidence: Record<string, Evidence> = {};
  const evidenceItems = currentList.filter(i => !i.isFolder && new RegExp("^" + prefix + "/evidence[^/]*\\.json$").test(i.path));
  for (const item of evidenceItems) {
    const ev = parseJson(await reader.read(commit, item.path), item.path) as Evidence;
    if (!ev || typeof ev !== "object" || Array.isArray(ev) || typeof ev.repo_key !== "string" ||
        ev.change_ref !== changeRef || Object.prototype.hasOwnProperty.call(evidence, ev.repo_key)) {
      throw new FailError("Evidence 文件身份非法、重复或 Change 不一致: " + item.path);
    }
    evidence[ev.repo_key] = ev;
  }
  const candidates = validateChangeDelivery(rawPrep as PrPrep[], evidence, change.scope, change.tfsId, cfg.registry as Record<string, RepoConfig>);
  for (const key of Object.keys(candidates)) {
    const file = prefix + "/pr-description-" + key + ".md";
    if (!currentList.some(i => i.path === file && !i.isFolder)) throw new FailError("缺少已发布的 PR Description: " + key);
    const description = await reader.read(commit, file);
    if (!description.trim() || description.includes("补 TFS 工作项 id")) throw new FailError("PR Description 尚未完善: " + key);
  }
  const latest = multica.getIssue(issueKey).metadata ?? {};
  if (["analysis.source", "analysis.human_approval", "dev.publication", "pr_prep"].some(key => latest[key] !== md[key])) {
    throw new UnknownError("完成检查期间批准、研发发布记录或 PR 候选发生变化，请重新检查");
  }
  return { change_ref: changeRef, branch: source.branch, commit, task_count: taskCount, repo_keys: Object.keys(candidates).sort(), candidates };
}
