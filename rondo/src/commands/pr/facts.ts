import { FailError, UnknownError } from "../../cli/errors.js";
export interface PrRecord {
  repo_key: string; repo_url: string; source_branch: string; target_branch: string;
  candidate_commit: string; title: string; description: string;
  local_validation?: { result?: string; summary?: string; command?: string[]; exit_code?: number; candidate_commit?: string; source?: string };
  code_review?: { result?: string; candidate_commit?: string; summary?: string; findings?: Array<{ resolved?: boolean; blocking?: boolean; risk_note?: string; risk_ref?: string }> };
  pr_id?: number;
  pr_url?: string;
}
export type RegisteredPr = PrRecord & { pr_id: number; pr_url: string };
export type PrIdentity = Pick<RegisteredPr, "repo_key" | "pr_id" | "pr_url" | "source_branch" | "target_branch">;

export function readPrRecords(raw: string | undefined): PrRecord[] {
  let value: unknown;
  try { value = JSON.parse(raw ?? "[]"); }
  catch { throw new UnknownError("pr 不是合法 JSON"); }
  if (!Array.isArray(value) || value.some(x => !x || typeof x !== "object" || Array.isArray(x) ||
      typeof x.repo_key !== "string" || !x.repo_key.trim()) ||
      new Set(value.map(x => x.repo_key)).size !== value.length)
    throw new FailError("pr 仓库身份非法或重复");
  for (const x of value) {
    if (x.pr_id === undefined && x.pr_url === undefined) continue;
    if (!Number.isSafeInteger(x.pr_id) || x.pr_id <= 0 || typeof x.pr_url !== "string" || !x.pr_url.trim())
      throw new FailError("pr 登记身份不完整: " + x.repo_key);
  }
  return value as PrRecord[];
}

export function isRegisteredPr(entry: PrRecord): entry is RegisteredPr {
  return entry.pr_id !== undefined && entry.pr_url !== undefined;
}

export function registeredPrs(raw: string | undefined): RegisteredPr[] {
  return readPrRecords(raw).filter(isRegisteredPr);
}

/** Preserve professional evidence while removing only the confirmed external binding. */
export function withoutPrIdentity(entry: PrRecord): PrRecord {
  const { pr_id: _id, pr_url: _url, ...prepared } = entry;
  return prepared;
}
