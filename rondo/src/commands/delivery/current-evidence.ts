import { readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { FailError, UnknownError } from "../../cli/errors.js";
import { verifyContractFiles, type ContractFiles } from "./contract-files.js";
import { resolveStableEvidenceCommit, type EvidenceCommit, type EvidenceRepository } from "./evidence-repository.js";

interface Evidence {
  change_ref?: string;
  task_refs?: string[];
  commits?: EvidenceCommit[];
  contract_files?: ContractFiles;
}

/** 解析服务端数组事实；损坏不能退化成“没有约束”。 */
function arrayFact<T>(raw: string | undefined, key: string): T[] {
  let value: unknown;
  try { value = raw ? JSON.parse(raw) : []; }
  catch { throw new UnknownError(`metadata ${key} 不是合法 JSON`); }
  if (!Array.isArray(value) || value.some(v => !v || typeof v !== "object")) {
    throw new UnknownError(`metadata ${key} 不是有效事实数组`);
  }
  return value as T[];
}

/** 只要求当前有效证据覆盖交付；过期记录保留，不按文件时间推断新旧。 */
export function assertCurrentEvidence(
  registry: Record<string, EvidenceRepository>, md: Record<string, string>,
  changeDir: string, changeRef: string, rootRepo: string, issueKey?: string, requireStableIdentity = false,
): void {
  const active = arrayFact<{ active?: boolean; change_ref?: string; task_refs?: string[] }>(md["dev.dispatch"], "dev.dispatch")
    .filter(d => d.active === true);
  if (!active.length || active.some(d => d.change_ref !== changeRef || !Array.isArray(d.task_refs) ||
    !d.task_refs.length || d.task_refs.some(r => typeof r !== "string" || !r.trim()))) {
    throw new UnknownError("缺少当前 Change 的有效 active 派发，或派发引用其他 Change；不能确认 Evidence 覆盖");
  }
  const refs = [...new Set(active.flatMap(d => d.task_refs!))];
  const candidates = arrayFact<{ repo_key?: string; candidate_commit?: string }>(md.pr_prep, "pr_prep");
  for (const c of candidates) {
    if (!c.repo_key || !registry[c.repo_key]?.repo_path || !/^[0-9a-f]{40}$/i.test(c.candidate_commit ?? "")) {
      throw new UnknownError("pr_prep 缺少有效候选仓库或完整提交 SHA");
    }
  }
  const normalized = (p: string): string => {
    const value = resolve(p);
    return process.platform === "win32" ? value.toLowerCase() : value;
  };
  const matches = (ev: Evidence, index: number): boolean => {
    const c = candidates[index];
    const repo = registry[c.repo_key!];
    const allowed = [normalized(join(rootRepo, repo.repo_path))];
    // 与 writeback 相同：已登记枢纽仓或当前 Issue 的确定性独立 worktree。
    if (issueKey) allowed.push(normalized(join(rootRepo, ".worktrees", `${issueKey}-${c.repo_key}`)));
    return Array.isArray(ev.commits) && ev.commits.some(commit => {
      if (!commit) return false;
      if (requireStableIdentity || commit.repo_key !== undefined || commit.repo_url !== undefined) {
        try {
          const identity = resolveStableEvidenceCommit(registry, commit);
          return identity.key === c.repo_key && identity.sha === c.candidate_commit!.toLowerCase();
        } catch { return false; } // 不合法记录不贡献覆盖；仍须有完整有效替代证据。
      }
      return typeof commit.repo_path === "string" && isAbsolute(commit.repo_path) && allowed.includes(normalized(commit.repo_path)) &&
        typeof commit.sha === "string" && /^[0-9a-f]{7,40}$/i.test(commit.sha) &&
        c.candidate_commit!.toLowerCase().startsWith(commit.sha.toLowerCase());
    });
  };

  const relevant: Array<{ file: string; ev: Evidence; candidates: number[]; problem?: Error }> = [];
  for (const file of readdirSync(changeDir).sort()) {
    if (!/^evidence.*\.json$/i.test(file)) continue;
    let ev: Evidence;
    try { ev = JSON.parse(readFileSync(join(changeDir, file), "utf8")); }
    catch { continue; } // 损坏记录不能贡献覆盖，下面仍要求完整有效覆盖。
    if (!ev || ev.change_ref !== changeRef || !Array.isArray(ev.task_refs) ||
      !ev.task_refs.every(r => typeof r === "string" && r.trim()) || !ev.task_refs.some(r => refs.includes(r))) continue;
    const coveredCandidates = candidates.map((_, i) => i).filter(i => matches(ev, i));
    if (candidates.length && !coveredCandidates.length) continue;
    let problem: Error | undefined;
    if (!ev.contract_files?.files || Object.keys(ev.contract_files.files).length === 0) {
      problem = new UnknownError(`Evidence ${file} 缺 contract_files；核验当前候选后运行 rondo dev contract-hash 补齐`);
    } else {
      const result = verifyContractFiles(changeDir, ev.contract_files);
      if (!result.ok) problem = new FailError(`Evidence ${file} 契约文件核验不过（${result.kind}）: ${result.problems.join("；")}`);
    }
    relevant.push({ file, ev, candidates: coveredCandidates, problem });
  }

  const valid = relevant.filter(e => !e.problem);
  // 有当前有效替代证据时不要求重写历史；没有替代时保留缺字段/哈希错误的三态语义。
  for (const ref of refs) {
    if (valid.some(e => e.ev.task_refs!.includes(ref))) continue;
    const problem = relevant.find(e => e.ev.task_refs!.includes(ref) && e.problem)?.problem;
    if (problem) throw problem;
    if (candidates.length && !relevant.length) {
      throw new FailError(`当前候选仓库/提交无匹配 Evidence，不能覆盖 active 任务 ${ref}`);
    }
    throw new UnknownError(`缺覆盖 active 派发的 Evidence（task_refs: ${ref}）——补齐当前有效 Evidence 后重跑`);
  }
  for (const [index, c] of candidates.entries()) {
    if (valid.some(e => e.candidates.includes(index))) continue;
    const problem = relevant.find(e => e.candidates.includes(index) && e.problem)?.problem;
    if (problem) throw problem;
    throw new FailError(`pr_prep ${c.repo_key} 候选提交 ${c.candidate_commit} 无当前有效 Evidence 覆盖`);
  }
}
