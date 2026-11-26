import { candidateBranch } from "../pr/candidate-branch.js";
/**
 * Independent Bug delivery repository scope and preparation consistency checks.
 * Only a subset of common PR Facts is validated here; provider state is checked
 * separately by the existing PR materialization and finalization commands.
 */
import { FailError, UnknownError } from "../../cli/errors.js";
import { readPrRecords } from "../pr/facts.js";

function parseArray<T>(raw: string | undefined, key: string): T[] {
  if (raw === undefined) throw new FailError("缺少 " + key);
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new UnknownError(key + " 不是合法 JSON"); }
  if (!Array.isArray(value)) throw new FailError(key + " 必须是数组");
  return value as T[];
}
function uniqueNames(values: unknown[], what: string): string[] {
  if (values.some(v => typeof v !== "string" || !/^[a-zA-Z0-9_.-]+$/.test(v))) {
    throw new FailError(what + " 包含非法 Repository ID");
  }
  const items = values as string[];
  if (items.length === 0 || new Set(items).size !== items.length) {
    throw new FailError(what + " 必须为非空、无重复的 Repository 列表");
  }
  return [...items].sort();
}
function exactly(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v,i) => v === b[i]);
}

export function requiredBugRepos(raw: string | undefined): string[] {
  return uniqueNames(parseArray<unknown>(raw, "bug.required_repos"), "bug.required_repos");
}

/** Called before ANY external PR creation, for all participating repositories. */
export function assertBugReadyForPr(md: Record<string,string>): string[] {
  if (md["tfs.type"] !== "Bug" || md["analysis.source"] !== undefined) {
    throw new FailError("不是无 OpenSpec Bug Issue，不能使用 Bug PR Gate");
  }
  const required = requiredBugRepos(md["bug.required_repos"]);
  const records = readPrRecords(md.pr);
  if (!exactly(required, uniqueNames(records.map(p => p.repo_key), "pr")))
    throw new FailError("Bug PR 准备不完整：required_repos / pr 仓库集合不一致");
  const tfsId = Number(md["tfs.id"]);
  if (!Number.isSafeInteger(tfsId) || tfsId <= 0) throw new FailError("TFS Bug ID 无效");
  for (const p of records) {
    if (p.local_validation?.result === "FAIL") throw new FailError(p.repo_key + ": Bug Candidate 验证失败，须重新验证");
    if (p.source_branch !== candidateBranch(tfsId) || !p.target_branch || !/^[0-9a-f]{40}$/i.test(p.candidate_commit ?? ""))
      throw new FailError(p.repo_key + ": Bug Candidate 身份无效");
  }
  return required;
}

/** A managed Agent's actual identity, not its claimed name, grants direct Bug entry. */
export function assertBugAgentAssignment(
  assigneeId: string | null | undefined,
  rawAgents: unknown,
): void {
  const agents = Array.isArray(rawAgents) ? rawAgents : (rawAgents as {agents?:unknown})?.agents;
  if (!Array.isArray(agents)) throw new UnknownError("当前 Workspace Agent 列表不可核实");
  const matches = agents.filter(a=>a && typeof a === "object" &&
    (a as {name?:unknown}).name === "Bug Fix Agent" &&
    typeof (a as {id?:unknown}).id === "string");
  if (matches.length !== 1) throw new UnknownError("当前 Workspace 缺少唯一有效的 Bug Fix Agent");
  if (!assigneeId || assigneeId !== (matches[0] as {id:string}).id) {
    throw new FailError("Issue 未有效指派给当前 Workspace 的 Bug Fix Agent，不授权执行");
  }
}
